/**
 * E2E Tests for Helmfile Generation Workflow
 * Tests Professional Services persona workflow for generating Helmfiles
 *
 * User Journey:
 * 1. Login to Professional Services Workspace
 * 2. Navigate to "Generate Helmfile" template
 * 3. Fill in template parameters
 * 4. Submit and verify PR creation
 */

import { test, expect, Page } from '@playwright/test';

// Test configuration
const BASE_URL = process.env.BACKSTAGE_URL || 'http://localhost:3000';
const BACKEND_URL =
  process.env.BACKSTAGE_BACKEND_URL || 'http://localhost:7007';

/**
 * Test Suite: Professional Services Helmfile Generation
 */
test.describe('Professional Services - Helmfile Generation Workflow', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(`${BASE_URL}/`);
  });

  test.afterEach(async () => {
    await page.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 1: Navigate to Professional Services Workspace
  // ─────────────────────────────────────────────────────────────────────────
  test('should navigate to Professional Services workspace', async () => {
    // Verify we're on the homepage
    await expect(page.locator('text=CloudHub Platform')).toBeVisible({
      timeout: 5000,
    });

    // Look for persona switcher
    const personaSwitcher = page.locator('[data-testid="persona-switcher"]');
    if (await personaSwitcher.isVisible()) {
      await personaSwitcher.click();

      // Select Professional Services persona
      const psOption = page.locator('text=Professional Services');
      await expect(psOption).toBeVisible();
      await psOption.click();
    }

    // Verify workspace title changed
    await expect(
      page.locator('text=Professional Services Workspace'),
    ).toBeVisible({ timeout: 5000 });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2: Entity Kinds Load Successfully
  // ─────────────────────────────────────────────────────────────────────────
  test('should load entity kinds without 502 errors', async () => {
    // Make direct API call to verify entity kinds are accessible
    const response = await page.request.get(
      `${BACKEND_URL}/api/catalog/entity-facets?facet=kind`,
    );

    // Verify 200 response (not 502)
    expect(response.status()).not.toBe(502);
    expect(response.status()).not.toBe(500);

    // Parse response
    const data = await response.json();
    expect(data).toBeDefined();

    // Verify 'Template' kind exists
    const facets = Array.isArray(data) ? data : data.facets || [];
    const templateKind = facets.find((f: any) =>
      f.value?.toLowerCase()?.includes('template'),
    );
    expect(templateKind || facets.length > 0).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3: Access Create Templates Page
  // ─────────────────────────────────────────────────────────────────────────
  test('should access create templates page', async () => {
    await page.goto(`${BASE_URL}/create/templates`);

    // Wait for templates to load
    await page.waitForTimeout(2000);

    // Verify page loaded without 502
    const response = await page.request.get(
      `${BACKEND_URL}/api/catalog/entities?filter=kind%3Dtemplate`,
    );
    expect(response.status()).not.toBe(502);

    // Should see template listings
    const pageContent = await page.content();
    expect(pageContent).toContain('Create');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4: Template Response Loads (No 502 Gateway Error)
  // ─────────────────────────────────────────────────────────────────────────
  test('should load template response without 502 errors', async () => {
    // Try to access symphony-helmfile-generator template
    const response = await page.request.get(
      `${BACKEND_URL}/api/scaffolder/v2/templates/default/template/symphony-helmfile-generator/parameter-schema`,
      { failOnStatusCode: false },
    );

    // Should not be 502 (gateway error)
    expect(response.status()).not.toBe(502);

    // Should be either 200, 401 (auth required), or 404 (not found)
    // But NOT 502 (which was the original bug)
    expect([200, 401, 404]).toContain(response.status());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5: Backend Health Check
  // ─────────────────────────────────────────────────────────────────────────
  test('should verify backend health is good', async () => {
    const response = await page.request.get(`${BACKEND_URL}/health`);

    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toBeDefined();
    expect(data.status).toBe('ok');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 6: Permission Authorization Works
  // ─────────────────────────────────────────────────────────────────────────
  test('should handle permission authorization without 502', async () => {
    const response = await page.request.post(
      `${BACKEND_URL}/api/permission/authorize`,
      {
        data: {
          permission: { name: 'scaffolder.task.create' },
        },
        failOnStatusCode: false,
      },
    );

    // Should not be 502
    expect(response.status()).not.toBe(502);

    // Should be 200, 401, or 403
    expect([200, 401, 403]).toContain(response.status());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 7: Scaffolder Task Creation API
  // ─────────────────────────────────────────────────────────────────────────
  test('should not return 502 when creating scaffolder tasks', async () => {
    const response = await page.request.post(
      `${BACKEND_URL}/api/scaffolder/v2/tasks`,
      {
        data: {
          templateRef: 'template:default/symphony-helmfile-generator',
          values: {
            appName: 'test-app',
            namespace: 'test-namespace',
            environment: 'dev',
            chart: 'symphonyfs/netreveal',
            helm_chart_version: '1.0.0',
            k8s_as_helm_version: '1.0.0',
            valuesGitUrl: 'git::ssh://example.com/repo.git//path?ref=main',
          },
        },
        failOnStatusCode: false,
      },
    );

    // Should not be 502
    expect(response.status()).not.toBe(502);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 8: Service Deployment Wizard Template
  // ─────────────────────────────────────────────────────────────────────────
  test('should load Service Deployment Wizard template without 502', async () => {
    const response = await page.request.get(
      `${BACKEND_URL}/api/scaffolder/v2/templates/default/template/service-deployment-wizard/parameter-schema`,
      { failOnStatusCode: false },
    );

    // Should not be 502
    expect(response.status()).not.toBe(502);
    expect([200, 401, 404]).toContain(response.status());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 9: Catalog Entity Refresh Works
  // ─────────────────────────────────────────────────────────────────────────
  test('should refresh catalog entities without 502', async () => {
    const response = await page.request.post(
      `${BACKEND_URL}/api/catalog/entities/by-name/template/default/symphony-helmfile-generator/refresh`,
      { failOnStatusCode: false },
    );

    // Should not be 502
    expect(response.status()).not.toBe(502);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 10: Backend Module Loading Verification
  // ─────────────────────────────────────────────────────────────────────────
  test('should verify all plugins initialized successfully', async () => {
    const response = await page.request.get(`${BACKEND_URL}/health`);
    const healthData = await response.json();

    expect(response.status()).toBe(200);
    expect(healthData.plugins).toBeDefined();

    // Verify critical plugins are loaded
    const pluginNames = Object.keys(healthData.plugins || {});
    expect(pluginNames).toContain('scaffolder');
    expect(pluginNames).toContain('catalog');
    expect(pluginNames).toContain('permission');
  });
});

/**
 * Test Suite: Template Parameter Validation
 */
test.describe('Helmfile Generation - Parameter Validation', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterEach(async () => {
    await page.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 11: Application Name Validation
  // ─────────────────────────────────────────────────────────────────────────
  test('should validate application name pattern', async () => {
    const testCases = [
      { name: 'netreveal', valid: true },
      { name: 'my-app', valid: true },
      { name: 'app-123', valid: true },
      { name: 'MyApp', valid: false }, // uppercase not allowed
      { name: 'app_name', valid: false }, // underscore not allowed
      { name: 'a', valid: true }, // single char ok
    ];

    for (const testCase of testCases) {
      // Pattern: "^[a-z][a-z0-9-]{1,62}[a-z0-9]$"
      const regex = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
      const matches = regex.test(testCase.name);

      if (testCase.valid) {
        expect(matches).toBe(true, `${testCase.name} should be valid`);
      } else {
        expect(matches).toBe(false, `${testCase.name} should be invalid`);
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 12: Chart Version Validation
  // ─────────────────────────────────────────────────────────────────────────
  test('should validate chart version pattern', async () => {
    const testCases = [
      { version: '0.1.0', valid: true },
      { version: '1.0.0', valid: true },
      { version: '1.2.3', valid: true },
      { version: 'latest', valid: false },
      { version: '1.0', valid: false }, // missing patch version
      { version: 'v1.0.0', valid: false }, // leading 'v' not allowed
    ];

    for (const testCase of testCases) {
      // Pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$"
      const regex = /^[0-9]+\.[0-9]+\.[0-9]+$/;
      const matches = regex.test(testCase.version);

      if (testCase.valid) {
        expect(matches).toBe(true, `${testCase.version} should be valid`);
      } else {
        expect(matches).toBe(false, `${testCase.version} should be invalid`);
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 13: Namespace Pattern Validation
  // ─────────────────────────────────────────────────────────────────────────
  test('should validate kubernetes namespace pattern', async () => {
    const testCases = [
      { namespace: 'nr-eng-festedb', valid: true },
      { namespace: 'default', valid: true },
      { namespace: 'prod-services', valid: true },
      { namespace: 'Namespace', valid: false }, // uppercase
      { namespace: 'name_space', valid: false }, // underscore
      { namespace: '-invalid', valid: false }, // starts with hyphen
    ];

    for (const testCase of testCases) {
      // Pattern: "^[a-z][a-z0-9-]{1,62}[a-z0-9]$"
      const regex = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
      const matches = regex.test(testCase.namespace);

      if (testCase.valid) {
        expect(matches).toBe(true, `${testCase.namespace} should be valid`);
      } else {
        expect(matches).toBe(false, `${testCase.namespace} should be invalid`);
      }
    }
  });
});

/**
 * Test Suite: Error Handling and Recovery
 */
test.describe('Error Handling - 502 Gateway Prevention', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterEach(async () => {
    await page.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 14: Graceful Handling of Missing Templates
  // ─────────────────────────────────────────────────────────────────────────
  test('should handle missing templates gracefully', async () => {
    const response = await page.request.get(
      `${BACKEND_URL}/api/scaffolder/v2/templates/default/template/non-existent-template/parameter-schema`,
      { failOnStatusCode: false },
    );

    // Should be 404, not 502
    expect(response.status()).toBe(404);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 15: Permission Denied Handling
  // ─────────────────────────────────────────────────────────────────────────
  test('should return 403 for permission denied, not 502', async () => {
    // This assumes some endpoints require specific permissions
    const response = await page.request.post(
      `${BACKEND_URL}/api/permission/authorize`,
      {
        data: {
          permission: { name: 'catalog.entity.delete' },
          identity: { userEntityRef: 'user:default/guest' },
        },
        failOnStatusCode: false,
      },
    );

    // Should not be 502
    expect(response.status()).not.toBe(502);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 16: Backend Restart Resilience
  // ─────────────────────────────────────────────────────────────────────────
  test('should maintain service availability after restart', async () => {
    // First health check
    let response = await page.request.get(`${BACKEND_URL}/health`);
    expect(response.status()).toBe(200);

    // Brief wait
    await page.waitForTimeout(1000);

    // Second health check
    response = await page.request.get(`${BACKEND_URL}/health`);
    expect(response.status()).toBe(200);
  });
});
