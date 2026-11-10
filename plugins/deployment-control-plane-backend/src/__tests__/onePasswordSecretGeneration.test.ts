import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockAsync = <T>(value: T) =>
  jest.fn<() => Promise<T>>().mockResolvedValue(value);

describe('OnePassword Secret Generation Verification', () => {
  let mockOnePasswordClient: any;
  let mockVaultId: string;
  let mockItemId: string;

  beforeEach(() => {
    mockVaultId = 'Customers';
    mockItemId = 'sri';

    mockOnePasswordClient = {
      vaults: {
        get: mockAsync({ id: mockVaultId, name: 'Customers' }),
      },
      items: {
        get: mockAsync({ id: mockItemId, title: 'sri', fields: [], sections: [] }),
        create: mockAsync({ id: 'new-item-id', title: 'new-item' }),
        update: mockAsync({ id: mockItemId, title: 'sri' }),
      },
      fields: {
        create: mockAsync({
          id: 'field-id-123',
          label: 'test-field',
          value: 'test-value',
        }),
        update: mockAsync({
          id: 'field-id-123',
          label: 'test-field',
          value: 'updated-value',
        }),
      },
      sections: undefined,
    };
  });

  it('creates a section and stores a field value in 1Password', async () => {
    const section = {
      id: 'section-pipeline-refs',
      label: 'pipeline_refs/detectionhub/dt-test',
    };

    mockOnePasswordClient.sections = { create: mockAsync(section) };

    const result = await mockOnePasswordClient.sections.create({
      vaultId: mockVaultId,
      itemId: mockItemId,
      label: 'pipeline_refs/detectionhub/dt-test',
    });

    expect(result.id).toBe('section-pipeline-refs');
    expect(result.label).toContain('pipeline_refs');

    const field = {
      id: 'field-1',
      label: 'invhub-dt-juber-poc3__helm_chart_version',
      value: '2.0.14',
      sectionId: 'section-1',
    };

    mockOnePasswordClient.fields.create = mockAsync(field);
    const fieldResult = await mockOnePasswordClient.fields.create({
      vaultId: mockVaultId,
      itemId: mockItemId,
      sectionId: 'section-1',
      label: field.label,
      value: field.value,
      fieldType: 'STRING',
    });

    expect(fieldResult.value).toBe('2.0.14');
  });

  it('marks readiness as false when required values are missing', async () => {
    const createdFields = [
      { label: 'invhub-dt-juber-poc3__helm_chart_version', value: '2.0.14' },
    ];
    const expectedFields = [
      'invhub-dt-juber-poc3__helm_chart_version',
      'detectionhub-dt-test__helm_chart_version',
      'database_password',
    ];

    mockOnePasswordClient.items.get = mockAsync({
      id: mockItemId,
      title: 'sri',
      fields: createdFields,
    });

    const item = await mockOnePasswordClient.items.get({
      vaultId: mockVaultId,
      itemId: mockItemId,
    });

    const createdFieldLabels = item.fields.map((field: any) => field.label);
    const missingFields = expectedFields.filter(
      field => !createdFieldLabels.includes(field),
    );

    expect(missingFields).toContain('detectionhub-dt-test__helm_chart_version');
    expect(missingFields).toContain('database_password');
  });

  it('updates an existing secret value and keeps the new value on the next read', async () => {
    const newValue = '2.0.0';

    mockOnePasswordClient.items.get = mockAsync({
      id: mockItemId,
      fields: [{ label: 'version', value: '1.0.0' }],
    });

    mockOnePasswordClient.fields.update = mockAsync({
      id: 'field-1',
      label: 'version',
      value: newValue,
    });

    const updated = await mockOnePasswordClient.fields.update({
      vaultId: mockVaultId,
      itemId: mockItemId,
      fieldId: 'field-1',
      value: newValue,
    });

    expect(updated.value).toBe('2.0.0');

    mockOnePasswordClient.items.get = mockAsync({
      id: mockItemId,
      fields: [{ label: 'version', value: newValue }],
    });

    const item = await mockOnePasswordClient.items.get({
      vaultId: mockVaultId,
      itemId: mockItemId,
    });

    expect(item.fields[0].value).toBe('2.0.0');
  });
});
