import { ReactNode, useState } from 'react';
import {
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  MenuItem,
  Switch,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { DataExportApi } from '../../api';
import {
  datasetToDraft,
  DatasetDraft,
  draftProblem,
  draftToInput,
  EMPTY_DATASET_DRAFT,
} from '../../datasetForm';
import {
  CLASSIFICATION_LABELS,
  DATASET_CATEGORY_LABELS,
  optionsFrom,
  SOURCE_PRODUCT_LABELS,
  WATERMARK_STRATEGY_LABELS,
} from '../../labels';
import type { Dataset, FilterOptions } from '../../types';
import { ApiErrorAlert } from '../common/ApiErrorAlert';
import { ColumnMetadataEditor } from './ColumnMetadataEditor';

interface Props {
  open: boolean;
  api: DataExportApi;
  /** When set, the dialog edits this dataset; otherwise it registers a new one. */
  dataset?: Dataset;
  /** Catalog datasets for the "depends on" picker. */
  catalog: FilterOptions['datasets'];
  onClose: () => void;
  onSaved: (dataset: Dataset) => void;
}

function Section({ children }: { children: ReactNode }) {
  return (
    <Grid item xs={12}>
      <Divider sx={{ mb: 1.5 }} />
      <Typography variant="subtitle2">{children}</Typography>
    </Grid>
  );
}

export function DatasetFormDialog({
  open,
  api,
  dataset,
  catalog,
  onClose,
  onSaved,
}: Props) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [draft, setDraft] = useState<DatasetDraft>(EMPTY_DATASET_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const problem = draftProblem(draft, dataset?.id);

  const update = (patch: Partial<DatasetDraft>) =>
    setDraft(current => ({ ...current, ...patch }));
  const text = (key: keyof DatasetDraft) => ({
    value: draft[key] as string,
    onChange: (event: { target: { value: string } }) =>
      update({ [key]: event.target.value }),
  });
  const dependencyOptions = catalog.filter(item => item.id !== dataset?.id);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = draftToInput(draft);
      if (dataset) {
        // datasetId is the catalog key and is not editable.
        const { datasetId: _ignored, ...patch } = body;
        onSaved(await api.updateDataset(dataset.id, patch));
      } else {
        onSaved(await api.registerDataset(body));
      }
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      fullWidth
      fullScreen={fullScreen}
      maxWidth="md"
      aria-labelledby="dataset-form-title"
      TransitionProps={{
        onEnter: () => {
          setDraft(dataset ? datasetToDraft(dataset) : EMPTY_DATASET_DRAFT);
          setError(null);
        },
      }}
    >
      <DialogTitle id="dataset-form-title">
        {dataset ? `Edit ${dataset.datasetId}` : 'Register dataset'}
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} pt={1}>
          {Boolean(error) && (
            <Grid item xs={12}>
              <ApiErrorAlert error={error} />
            </Grid>
          )}
          <Grid item xs={12}>
            <Typography variant="subtitle2">Business metadata</Typography>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              required
              size="small"
              label="Dataset ID"
              placeholder="NR_V_CASES"
              disabled={Boolean(dataset)}
              helperText={
                dataset
                  ? 'The catalog key cannot be changed.'
                  : 'Stable key, e.g. the source view name.'
              }
              {...text('datasetId')}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              required
              size="small"
              label="Display name"
              {...text('displayName')}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              select
              size="small"
              label="Source product"
              value={draft.sourceProduct}
              onChange={e =>
                update({
                  sourceProduct: e.target
                    .value as DatasetDraft['sourceProduct'],
                })
              }
            >
              {optionsFrom(SOURCE_PRODUCT_LABELS).map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              select
              size="small"
              label="Category"
              value={draft.category}
              onChange={e =>
                update({ category: e.target.value as DatasetDraft['category'] })
              }
            >
              {optionsFrom(DATASET_CATEGORY_LABELS).map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              size="small"
              label="Business description"
              {...text('businessDescription')}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              size="small"
              label="Source domain"
              placeholder="Case Manager"
              {...text('sourceDomain')}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              size="small"
              label="Owner team"
              {...text('ownerTeam')}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              size="small"
              label="Support contact (email)"
              type="email"
              {...text('supportEmail')}
            />
          </Grid>

          <Section>Governance</Section>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              select
              size="small"
              label="Classification"
              value={draft.classification}
              onChange={e =>
                update({
                  classification: e.target
                    .value as DatasetDraft['classification'],
                })
              }
            >
              {optionsFrom(CLASSIFICATION_LABELS).map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={6} sm={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={draft.containsPii}
                  onChange={(_e, checked) => update({ containsPii: checked })}
                />
              }
              label="Contains PII"
            />
          </Grid>
          <Grid item xs={6} sm={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={draft.containsSensitiveData}
                  onChange={(_e, checked) =>
                    update({ containsSensitiveData: checked })
                  }
                />
              }
              label="Sensitive data"
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              size="small"
              label="Retention (days)"
              inputProps={{ inputMode: 'numeric' }}
              {...text('retentionDays')}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              size="small"
              label="Estimated daily volume (rows)"
              inputProps={{ inputMode: 'numeric' }}
              {...text('estimatedDailyVolume')}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              size="small"
              label="Refresh pattern"
              placeholder="Nightly batch"
              {...text('refreshPattern')}
            />
          </Grid>

          <Section>Technical details</Section>
          <Grid item xs={12} sm={4}>
            <FormControlLabel
              control={
                <Switch
                  checked={draft.supportsIncremental}
                  onChange={(_e, checked) =>
                    update({ supportsIncremental: checked })
                  }
                />
              }
              label="Supports incremental"
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              size="small"
              label="Watermark column"
              required={draft.supportsIncremental}
              {...text('watermarkColumn')}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              fullWidth
              select
              size="small"
              label="Default watermark strategy"
              value={draft.watermarkStrategy}
              onChange={e => update({ watermarkStrategy: e.target.value })}
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {optionsFrom(WATERMARK_STRATEGY_LABELS).map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              size="small"
              label="Primary keys"
              helperText="Comma-separated"
              {...text('primaryKeys')}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              size="small"
              label="Source tables"
              helperText="Comma-separated"
              {...text('sourceTables')}
            />
          </Grid>
          <Grid item xs={12}>
            <Autocomplete
              multiple
              size="small"
              options={dependencyOptions.map(item => item.id)}
              value={draft.dependsOn}
              onChange={(_e, value) => update({ dependsOn: value })}
              getOptionLabel={id => {
                const item = catalog.find(entry => entry.id === id);
                return item ? `${item.datasetId} — ${item.displayName}` : id;
              }}
              renderInput={params => (
                <TextField
                  {...params}
                  label="Depends on"
                  helperText="Upstream datasets this one is derived from. Drives the dependency graph."
                />
              )}
            />
          </Grid>
          <Grid item xs={12}>
            <Typography variant="body2" gutterBottom>
              Columns
            </Typography>
            <ColumnMetadataEditor
              columns={draft.columnMetadata}
              onChange={columnMetadata => update({ columnMetadata })}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              multiline
              minRows={5}
              size="small"
              label="Sample schema (JSON)"
              placeholder={'{\n  "CASE_ID": "NUMBER"\n}'}
              inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
              {...text('sampleSchema')}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              multiline
              minRows={5}
              size="small"
              label="SQL template (optional)"
              helperText="A single SELECT, reviewed before the agent runs it."
              inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
              {...text('sqlTemplate')}
            />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={draft.enabled}
                  onChange={(_e, checked) => update({ enabled: checked })}
                />
              }
              label="Enabled (available to new exports)"
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {problem && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mr: 'auto' }}
            role="status"
          >
            {problem}
          </Typography>
        )}
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={saving || Boolean(problem)}
        >
          {saving ? 'Saving…' : dataset ? 'Save changes' : 'Register'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
