import {
  datasetToDraft,
  draftProblem,
  draftToInput,
  EMPTY_DATASET_DRAFT,
  parseColumns,
  splitList,
} from '../datasetForm';
import type { Dataset } from '../types';

const draft = {
  ...EMPTY_DATASET_DRAFT,
  datasetId: ' NR_V_CASES ',
  displayName: 'NetReveal Cases',
  businessDescription: 'All cases',
  watermarkColumn: 'UPDATED_AT',
  supportsIncremental: true,
  retentionDays: '90',
  estimatedDailyVolume: '250000',
  primaryKeys: 'CASE_ID, VERSION ,',
  columnMetadata: [
    {
      name: ' CASE_ID ',
      type: 'NUMBER',
      description: 'Case key',
      nullable: false,
    },
    { name: 'NOTES', type: '', description: ' ', pii: true },
    { name: '' },
  ],
  sampleSchema: '{"CASE_ID": "NUMBER"}',
  dependsOn: ['u1', 'u1', 'u2'],
};

describe('dataset form', () => {
  it('converts the draft to DatasetInput', () => {
    expect(draftToInput(draft)).toMatchObject({
      datasetId: 'NR_V_CASES',
      businessDescription: 'All cases',
      sourceProduct: 'NETREVEAL',
      primaryKeys: ['CASE_ID', 'VERSION'],
      sourceTables: [],
      ownerTeam: null,
      watermarkStrategy: null,
      retentionDays: 90,
      estimatedDailyVolume: 250000,
      columnMetadata: [
        {
          name: 'CASE_ID',
          type: 'NUMBER',
          description: 'Case key',
          nullable: false,
        },
        { name: 'NOTES', pii: true },
      ],
      sampleSchema: { CASE_ID: 'NUMBER' },
      dependsOn: ['u1', 'u2'],
      enabled: true,
    });
  });

  it('round-trips a stored dataset through the form', () => {
    const dataset: Dataset = { id: 'x', updatedAt: '', ...draftToInput(draft) };
    expect(draftToInput(datasetToDraft(dataset))).toEqual(draftToInput(draft));
  });

  it('parses bulk columns and splits lists', () => {
    expect(parseColumns('A\nB DATE - When\n\n')).toEqual([
      { name: 'A' },
      { name: 'B', type: 'DATE', description: 'When' },
    ]);
    expect(splitList('a, b\nc,,')).toEqual(['a', 'b', 'c']);
  });

  it('flags incomplete or invalid drafts before calling the API', () => {
    expect(draftProblem(draft)).toBeNull();
    expect(draftProblem({ ...draft, displayName: '' })).toMatch(/required/);
    expect(draftProblem({ ...draft, datasetId: '9 bad' })).toMatch(
      /start with a letter/,
    );
    expect(draftProblem({ ...draft, watermarkColumn: '' })).toMatch(
      /watermark/,
    );
    expect(draftProblem({ ...draft, retentionDays: '30d' })).toMatch(
      /Retention/,
    );
    expect(draftProblem({ ...draft, estimatedDailyVolume: '2M' })).toMatch(
      /volume/,
    );
    expect(draftProblem({ ...draft, supportEmail: 'team' })).toMatch(/email/);
    expect(draftProblem({ ...draft, sampleSchema: '{' })).toMatch(
      /not valid JSON/,
    );
    expect(draftProblem({ ...draft, sampleSchema: '[1]' })).toMatch(
      /JSON object/,
    );
    expect(
      draftProblem({
        ...draft,
        columnMetadata: [{ name: 'A' }, { name: 'a' }],
      }),
    ).toMatch(/more than once/);
    expect(
      draftProblem({
        ...draft,
        columnMetadata: [{ name: '', type: 'NUMBER' }],
      }),
    ).toMatch(/needs a name/);
    expect(draftProblem({ ...draft, dependsOn: ['self'] }, 'self')).toMatch(
      /itself/,
    );
  });
});
