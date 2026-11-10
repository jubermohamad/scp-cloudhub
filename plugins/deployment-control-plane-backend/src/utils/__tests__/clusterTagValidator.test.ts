/**
 * Unit tests for ClusterTagValidator
 */

import { ClusterTagValidator } from '../../utils/clusterTagValidator';

describe('ClusterTagValidator', () => {
  describe('isCloudHubEligible', () => {
    it('should return true when both required tags are "true"', () => {
      const tags = {
        'cloudhub-enabled': 'true',
        'cloudhub-onboarded': 'true',
      };
      expect(ClusterTagValidator.isCloudHubEligible(tags)).toBe(true);
    });

    it('should return false when cloudhub-enabled is missing', () => {
      const tags = {
        'cloudhub-onboarded': 'true',
      };
      expect(ClusterTagValidator.isCloudHubEligible(tags)).toBe(false);
    });

    it('should return false when cloudhub-onboarded is missing', () => {
      const tags = {
        'cloudhub-enabled': 'true',
      };
      expect(ClusterTagValidator.isCloudHubEligible(tags)).toBe(false);
    });

    it('should return false when cloudhub-enabled is "false"', () => {
      const tags = {
        'cloudhub-enabled': 'false',
        'cloudhub-onboarded': 'true',
      };
      expect(ClusterTagValidator.isCloudHubEligible(tags)).toBe(false);
    });

    it('should return false when cloudhub-onboarded is "false"', () => {
      const tags = {
        'cloudhub-enabled': 'true',
        'cloudhub-onboarded': 'false',
      };
      expect(ClusterTagValidator.isCloudHubEligible(tags)).toBe(false);
    });

    it('should return false when both tags are "false"', () => {
      const tags = {
        'cloudhub-enabled': 'false',
        'cloudhub-onboarded': 'false',
      };
      expect(ClusterTagValidator.isCloudHubEligible(tags)).toBe(false);
    });

    it('should return false when tags is null', () => {
      expect(ClusterTagValidator.isCloudHubEligible(null)).toBe(false);
    });

    it('should return false when tags is undefined', () => {
      expect(ClusterTagValidator.isCloudHubEligible(undefined)).toBe(false);
    });

    it('should return false when tags is empty object', () => {
      expect(ClusterTagValidator.isCloudHubEligible({})).toBe(false);
    });

    it('should accept uppercase tag keys', () => {
      const tags = {
        'CLOUDHUB-ENABLED': 'true',
        'CLOUDHUB-ONBOARDED': 'true',
      };
      expect(ClusterTagValidator.isCloudHubEligible(tags)).toBe(true);
    });

    it('should accept mixed-case true values with whitespace', () => {
      const tags = {
        'cloudhub-enabled': ' True ',
        'cloudhub-onboarded': ' TRUE',
      };
      expect(ClusterTagValidator.isCloudHubEligible(tags)).toBe(true);
    });

    it('should require "true" string (not boolean)', () => {
      const tags = {
        'cloudhub-enabled': true as any,
        'cloudhub-onboarded': true as any,
      };
      expect(ClusterTagValidator.isCloudHubEligible(tags)).toBe(false);
    });
  });

  describe('getEligibilityReport', () => {
    it('should report all checks passed when eligible', () => {
      const tags = {
        'cloudhub-enabled': 'true',
        'cloudhub-onboarded': 'true',
      };
      const report = ClusterTagValidator.getEligibilityReport(tags);

      expect(report.isEligible).toBe(true);
      expect(report.enabled).toBe(true);
      expect(report.onboarded).toBe(true);
      expect(report.missingTags).toHaveLength(0);
    });

    it('should report missing tags', () => {
      const tags = {};
      const report = ClusterTagValidator.getEligibilityReport(tags);

      expect(report.isEligible).toBe(false);
      expect(report.enabled).toBe(false);
      expect(report.onboarded).toBe(false);
      expect(report.missingTags).toContain('cloudhub-enabled');
      expect(report.missingTags).toContain('cloudhub-onboarded');
    });

    it('should handle null tags', () => {
      const report = ClusterTagValidator.getEligibilityReport(null);

      expect(report.isEligible).toBe(false);
      expect(report.missingTags.length).toBeGreaterThan(0);
    });

    it('should detail which tag is false', () => {
      const tags = {
        'cloudhub-enabled': 'false',
        'cloudhub-onboarded': 'true',
      };
      const report = ClusterTagValidator.getEligibilityReport(tags);

      expect(report.isEligible).toBe(false);
      expect(report.enabled).toBe(false);
      expect(report.onboarded).toBe(true);
    });
  });

  describe('createCloudHubTags', () => {
    it('should create tags with both true by default', () => {
      const tags = ClusterTagValidator.createCloudHubTags();

      expect(tags['cloudhub-enabled']).toBe('true');
      expect(tags['cloudhub-onboarded']).toBe('false');
    });

    it('should create tags with specified values', () => {
      const tags = ClusterTagValidator.createCloudHubTags(true, true);

      expect(tags['cloudhub-enabled']).toBe('true');
      expect(tags['cloudhub-onboarded']).toBe('true');
    });

    it('should create disabled tags', () => {
      const tags = ClusterTagValidator.createCloudHubTags(false, false);

      expect(tags['cloudhub-enabled']).toBe('false');
      expect(tags['cloudhub-onboarded']).toBe('false');
    });

    it('should use string "true"/"false", not boolean', () => {
      const tags = ClusterTagValidator.createCloudHubTags(true, true);

      expect(typeof tags['cloudhub-enabled']).toBe('string');
      expect(typeof tags['cloudhub-onboarded']).toBe('string');
    });
  });

  describe('mergeCloudHubTags', () => {
    it('should preserve non-CloudHub tags', () => {
      const existing = {
        'app.kubernetes.io/name': 'my-app',
        team: 'backend',
      };

      const merged = ClusterTagValidator.mergeCloudHubTags(existing, {
        'cloudhub-enabled': 'true',
      });

      expect(merged['app.kubernetes.io/name']).toBe('my-app');
      expect(merged.team).toBe('backend');
      expect(merged['cloudhub-enabled']).toBe('true');
    });

    it('should overwrite existing CloudHub tags', () => {
      const existing = {
        'cloudhub-enabled': 'false',
        'cloudhub-onboarded': 'true',
      };

      const merged = ClusterTagValidator.mergeCloudHubTags(existing, {
        'cloudhub-enabled': 'true',
      });

      expect(merged['cloudhub-enabled']).toBe('true');
      expect(merged['cloudhub-onboarded']).toBe('true');
    });

    it('should handle null existing tags', () => {
      const merged = ClusterTagValidator.mergeCloudHubTags(null, {
        'cloudhub-enabled': 'true',
      });

      expect(merged['cloudhub-enabled']).toBe('true');
    });

    it('should handle undefined existing tags', () => {
      const merged = ClusterTagValidator.mergeCloudHubTags(undefined, {
        'cloudhub-onboarded': 'true',
      });

      expect(merged['cloudhub-onboarded']).toBe('true');
    });

    it('should skip undefined/null new values', () => {
      const existing = {
        'cloudhub-enabled': 'true',
      };

      const merged = ClusterTagValidator.mergeCloudHubTags(existing, {
        'cloudhub-onboarded': undefined as any,
      });

      expect(merged['cloudhub-enabled']).toBe('true');
      expect(merged['cloudhub-onboarded']).toBeUndefined();
    });
  });

  describe('validateTagFormat', () => {
    it('should accept valid "true" value', () => {
      const tags = {
        'cloudhub-enabled': 'true',
      };
      const errors = ClusterTagValidator.validateTagFormat(tags);

      expect(errors).toHaveLength(0);
    });

    it('should accept valid "false" value', () => {
      const tags = {
        'cloudhub-onboarded': 'false',
      };
      const errors = ClusterTagValidator.validateTagFormat(tags);

      expect(errors).toHaveLength(0);
    });

    it('should reject invalid boolean value', () => {
      const tags = {
        'cloudhub-enabled': '1',
      };
      const errors = ClusterTagValidator.validateTagFormat(tags);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('must be "true" or "false"');
    });

    it('should reject invalid yes/no values', () => {
      const tags = {
        'cloudhub-enabled': 'yes',
        'cloudhub-onboarded': 'no',
      };
      const errors = ClusterTagValidator.validateTagFormat(tags);

      expect(errors.length).toBeGreaterThan(0);
    });

    it('should pass empty object', () => {
      const errors = ClusterTagValidator.validateTagFormat({});

      expect(errors).toHaveLength(0);
    });

    it('should ignore non-CloudHub tags', () => {
      const tags = {
        'app.kubernetes.io/name': 'invalid-value',
        'cloudhub-enabled': 'true',
      };
      const errors = ClusterTagValidator.validateTagFormat(tags);

      expect(errors).toHaveLength(0);
    });
  });
});
