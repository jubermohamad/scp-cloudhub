import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Grid,
  Link,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useAsync } from '../../hooks';
import {
  CLASSIFICATION_LABELS,
  DATASET_CATEGORY_LABELS,
  labelFor,
  SOURCE_PRODUCT_LABELS,
  WATERMARK_STRATEGY_LABELS,
} from '../../labels';
import { hubPaths } from '../../routes';
import type { Dataset } from '../../types';
import { formatCount, formatDateTime, prettyJson } from '../../utils';
import { CodeBlock } from '../common/CodeBlock';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { DetailField } from '../common/DetailField';
import { HubLayout } from '../common/HubLayout';
import { useHub } from '../common/HubContext';
import { EnabledChip, StatusChip } from '../common/StatusChip';
import { useActionRunner } from '../common/useActionRunner';
import { useToast } from '../common/useToast';
import { DatasetFormDialog } from './DatasetFormDialog';
import { LineageGraph } from './LineageGraph';

export function DatasetDetailPage() {
  return (
    <HubLayout label="Dataset">
      <DatasetDetailContent />
    </HubLayout>
  );
}

function ChipList({ items, mono }: { items: string[]; mono?: boolean }) {
  if (items.length === 0) return <>—</>;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {items.map(item => (
        <Chip
          key={item}
          size="small"
          variant="outlined"
          label={item}
          sx={mono ? { fontFamily: 'monospace' } : undefined}
        />
      ))}
    </Stack>
  );
}

function DatasetDetailContent() {
  const { id = '' } = useParams<{ id: string }>();
  const { api, isPlatformAdmin, filterOptions, reloadFilterOptions } = useHub();
  const dataset = useAsync(() => api.getDataset(id), [api, id]);
  const lineage = useAsync(() => api.getDatasetLineage(id), [api, id]);
  const { showToast, toastElement } = useToast();
  const { busyKey, run } = useActionRunner(showToast);
  const [editing, setEditing] = useState(false);
  const [toggling, setToggling] = useState(false);

  const d: Dataset | undefined =
    dataset.data?.id === id ? dataset.data : undefined;

  if (dataset.error && !d) {
    return (
      <Stack spacing={2}>
        <Alert severity="error">Unable to load dataset: {dataset.error}</Alert>
        <Box>
          <Button component={RouterLink} to={hubPaths.datasets}>
            Back to the catalog
          </Button>
        </Box>
      </Stack>
    );
  }
  if (!d) {
    return <Skeleton variant="rectangular" height={420} />;
  }

  const lineageData = lineage.data;
  const hasLineage = lineageData && lineageData.nodes.length > 1;

  return (
    <Stack spacing={2}>
      <Breadcrumbs aria-label="breadcrumb">
        <Link
          component={RouterLink}
          to={hubPaths.datasets}
          underline="hover"
          color="inherit"
        >
          Datasets
        </Link>
        <Typography color="text.primary" sx={{ fontFamily: 'monospace' }}>
          {d.datasetId}
        </Typography>
      </Breadcrumbs>

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ md: 'flex-start' }}
        spacing={2}
      >
        <Box minWidth={0}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            <Typography variant="h5" component="h2">
              {d.displayName}
            </Typography>
            <EnabledChip enabled={d.enabled} on="Enabled" />
            <StatusChip
              label={labelFor(CLASSIFICATION_LABELS, d.classification)}
              tone={
                d.classification === 'RESTRICTED'
                  ? 'error'
                  : d.classification === 'CONFIDENTIAL'
                  ? 'warning'
                  : 'default'
              }
              variant="outlined"
            />
            {d.containsPii && <StatusChip label="PII" tone="warning" />}
            {d.containsSensitiveData && (
              <StatusChip label="Sensitive" tone="warning" variant="outlined" />
            )}
          </Stack>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontFamily: 'monospace' }}
          >
            {d.datasetId}
          </Typography>
        </Box>
        {isPlatformAdmin && (
          <Stack direction="row" spacing={1} flexShrink={0}>
            <Button
              variant="outlined"
              startIcon={<EditOutlinedIcon />}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button
              variant="outlined"
              color={d.enabled ? 'warning' : 'success'}
              startIcon={d.enabled ? <BlockIcon /> : <CheckCircleOutlineIcon />}
              disabled={busyKey !== null}
              onClick={() => setToggling(true)}
            >
              {d.enabled ? 'Disable' : 'Enable'}
            </Button>
          </Stack>
        )}
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={7}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardHeader
              title="Business metadata"
              titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
            />
            <CardContent>
              <Stack spacing={2}>
                <DetailField label="Business Description">
                  {d.businessDescription && (
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {d.businessDescription}
                    </Typography>
                  )}
                </DetailField>
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={4}>
                    <DetailField label="Source Product">
                      {labelFor(SOURCE_PRODUCT_LABELS, d.sourceProduct)}
                    </DetailField>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <DetailField label="Source Domain">
                      {d.sourceDomain}
                    </DetailField>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <DetailField label="Category">
                      {labelFor(DATASET_CATEGORY_LABELS, d.category)}
                    </DetailField>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <DetailField label="Owner Team">{d.ownerTeam}</DetailField>
                  </Grid>
                  <Grid item xs={12} sm={8}>
                    <DetailField label="Support Contact">
                      {d.supportEmail && (
                        <Link
                          href={`mailto:${d.supportEmail}`}
                          underline="hover"
                        >
                          {d.supportEmail}
                        </Link>
                      )}
                    </DetailField>
                  </Grid>
                </Grid>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} lg={5}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardHeader
              title="Technical details"
              titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
            />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <DetailField label="Primary Keys">
                    <ChipList items={d.primaryKeys} mono />
                  </DetailField>
                </Grid>
                <Grid item xs={6}>
                  <DetailField label="Incremental Support">
                    {d.supportsIncremental ? 'Yes' : 'No'}
                  </DetailField>
                </Grid>
                <Grid item xs={6}>
                  <DetailField label="Watermark Column" mono>
                    {d.watermarkColumn}
                  </DetailField>
                </Grid>
                <Grid item xs={6}>
                  <DetailField label="Watermark Strategy">
                    {d.watermarkStrategy
                      ? labelFor(WATERMARK_STRATEGY_LABELS, d.watermarkStrategy)
                      : null}
                  </DetailField>
                </Grid>
                <Grid item xs={6}>
                  <DetailField label="Retention">
                    {d.retentionDays === null
                      ? null
                      : `${d.retentionDays} days`}
                  </DetailField>
                </Grid>
                <Grid item xs={6}>
                  <DetailField label="Volume Estimate">
                    {d.estimatedDailyVolume === null
                      ? null
                      : `${formatCount(d.estimatedDailyVolume)} rows/day`}
                  </DetailField>
                </Grid>
                <Grid item xs={6}>
                  <DetailField label="Refresh Pattern">
                    {d.refreshPattern}
                  </DetailField>
                </Grid>
                <Grid item xs={12}>
                  <DetailField label="Classification">
                    {labelFor(CLASSIFICATION_LABELS, d.classification)}
                    {' · '}
                    {d.containsPii ? 'contains PII' : 'no PII'}
                    {' · '}
                    {d.containsSensitiveData
                      ? 'sensitive data'
                      : 'no sensitive data'}
                  </DetailField>
                </Grid>
                <Grid item xs={12}>
                  <DetailField label="Source Tables">
                    <ChipList items={d.sourceTables} mono />
                  </DetailField>
                </Grid>
                <Grid item xs={12}>
                  <DetailField label="Last updated">
                    {formatDateTime(d.updatedAt)}
                  </DetailField>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card variant="outlined">
            <CardHeader
              title="Dataset Dependency Graph"
              subheader="Upstream datasets on the left. Select a dataset to open it."
              titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
              subheaderTypographyProps={{ variant: 'caption' }}
            />
            <CardContent>
              {lineage.error && (
                <Alert severity="error">
                  Unable to load lineage: {lineage.error}
                </Alert>
              )}
              {lineage.loading && !lineageData && (
                <Skeleton variant="rectangular" height={320} />
              )}
              {lineageData && hasLineage && (
                <LineageGraph lineage={lineageData} currentId={d.id} />
              )}
              {lineageData && !hasLineage && (
                <Typography variant="body2" color="text.secondary">
                  This dataset has no recorded upstream or downstream
                  dependencies.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12}>
          <Card variant="outlined">
            <CardHeader
              title={`Columns (${d.columnMetadata.length})`}
              titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
            />
            <CardContent>
              {d.columnMetadata.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No column metadata recorded.
                </Typography>
              ) : (
                <TableContainer sx={{ maxHeight: 480 }}>
                  <Table size="small" stickyHeader aria-label="Columns">
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Description</TableCell>
                        <TableCell>Nullable</TableCell>
                        <TableCell>PII</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {d.columnMetadata.map(column => (
                        <TableRow key={column.name}>
                          <TableCell
                            sx={{
                              fontFamily: 'monospace',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {column.name}
                            {d.primaryKeys.includes(column.name) && (
                              <Chip
                                size="small"
                                label="PK"
                                sx={{ ml: 1 }}
                                variant="outlined"
                              />
                            )}
                          </TableCell>
                          <TableCell
                            sx={{
                              fontFamily: 'monospace',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {column.type ?? '—'}
                          </TableCell>
                          <TableCell sx={{ minWidth: 200 }}>
                            {column.description ?? '—'}
                          </TableCell>
                          <TableCell>
                            {column.nullable === undefined
                              ? '—'
                              : column.nullable
                              ? 'Yes'
                              : 'No'}
                          </TableCell>
                          <TableCell>
                            {column.pii ? (
                              <StatusChip label="PII" tone="warning" />
                            ) : (
                              'No'
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={d.sqlTemplate ? 6 : 12}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardHeader
              title="Sample Schema"
              titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
            />
            <CardContent>
              {d.sampleSchema ? (
                <CodeBlock ariaLabel="Sample schema">
                  {prettyJson(d.sampleSchema)}
                </CodeBlock>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No sample schema recorded.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        {d.sqlTemplate && (
          <Grid item xs={12} md={6}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardHeader
                title="SQL Template"
                titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
              />
              <CardContent>
                <CodeBlock ariaLabel="SQL template">{d.sqlTemplate}</CodeBlock>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {isPlatformAdmin && (
        <>
          <DatasetFormDialog
            open={editing}
            api={api}
            dataset={d}
            catalog={filterOptions.datasets}
            onClose={() => setEditing(false)}
            onSaved={saved => {
              showToast('success', `Saved ${saved.datasetId}`);
              dataset.reload({ silent: true });
              lineage.reload({ silent: true });
              reloadFilterOptions();
            }}
          />
          <ConfirmDialog
            open={toggling}
            title={d.enabled ? 'Disable dataset?' : 'Enable dataset?'}
            confirmLabel={d.enabled ? 'Disable' : 'Enable'}
            destructive={d.enabled}
            busy={busyKey !== null}
            onClose={() => setToggling(false)}
            onConfirm={async () => {
              await run(
                d.id,
                async () => {
                  await api.updateDataset(d.id, { enabled: !d.enabled });
                  dataset.reload({ silent: true });
                },
                `${d.enabled ? 'Disabled' : 'Enabled'} ${d.datasetId}`,
              );
              setToggling(false);
            }}
          >
            {d.enabled
              ? 'Disabled datasets cannot be added to exports. Review exports that already include it.'
              : 'The dataset becomes available to new exports.'}
          </ConfirmDialog>
        </>
      )}
      {toastElement}
    </Stack>
  );
}
