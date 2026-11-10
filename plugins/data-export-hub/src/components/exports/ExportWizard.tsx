import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Step,
  StepButton,
  Stepper,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { DataExportApi } from '../../api';
import {
  buildExportInput,
  firstInvalidStep,
  initialWizardForm,
  REVIEW_STEP,
  stepProblem,
  WIZARD_STEPS,
  WizardForm,
} from '../../exportWizardModel';
import type { ExportProfile } from '../../types';
import { ApiErrorAlert } from '../common/ApiErrorAlert';
import { CustomerStep } from './wizard/CustomerStep';
import { ProductionClusterStep } from './wizard/ProductionClusterStep';
import { ExportPackageStep } from './wizard/ExportPackageStep';
import { ReviewStep } from './wizard/ReviewStep';
import { ScheduleStep } from './wizard/ScheduleStep';

interface Props {
  open: boolean;
  api: DataExportApi;
  /** Export being edited; omitted when creating. */
  profile?: ExportProfile;
  /** Tenants the caller administers. */
  tenantOptions: string[];
  onClose: () => void;
  onSaved: (profile: ExportProfile) => void;
}

export function ExportWizard({
  open,
  api,
  profile,
  tenantOptions,
  onClose,
  onSaved,
}: Props) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardForm>(() =>
    initialWizardForm(profile, tenantOptions),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const isEdit = Boolean(profile);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setForm(initialWizardForm(profile, tenantOptions));
    setError(null);
    // Re-initialise only when the dialog opens or a different export is edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile?.id]);

  const update = (patch: Partial<WizardForm>) =>
    setForm(current => ({ ...current, ...patch }));
  const problem = stepProblem(step, form);
  const blockedAt = firstInvalidStep(form);
  const stepProps = { form, update, api };

  async function submit() {
    if (blockedAt !== null) {
      setStep(blockedAt);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = buildExportInput(
        form,
        form.destinationId,
        profile?.enabled ?? true,
      );
      const saved = isEdit
        ? await api.updateExport(profile!.id, input)
        : await api.createExport(input);
      onSaved(saved);
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
      fullScreen={compact}
      maxWidth="md"
      aria-labelledby="export-wizard-title"
    >
      <DialogTitle id="export-wizard-title">
        {isEdit ? `Edit ${profile!.name}` : 'New export'}
      </DialogTitle>
      <DialogContent>
        <Stepper
          nonLinear
          activeStep={step}
          alternativeLabel={!compact}
          orientation="horizontal"
          sx={{ mb: 3, mt: 1, overflowX: 'auto', pb: 1 }}
        >
          {WIZARD_STEPS.map((label, index) => (
            <Step
              key={label}
              completed={index < step && !stepProblem(index, form)}
            >
              <StepButton
                onClick={() => setStep(index)}
                // Only allow jumping back, or forward over valid steps.
                disabled={index > step && (blockedAt ?? Infinity) < index}
              >
                {compact && index !== step ? '' : label}
              </StepButton>
            </Step>
          ))}
        </Stepper>
        {compact && (
          <Typography variant="subtitle2" mb={2}>
            Step {step + 1} of {WIZARD_STEPS.length}: {WIZARD_STEPS[step]}
          </Typography>
        )}

        {Boolean(error) && (
          <Box mb={2}>
            <ApiErrorAlert error={error} />
          </Box>
        )}

        {step === 0 && <CustomerStep {...stepProps} />}
        {step === 1 && <ProductionClusterStep {...stepProps} />}
        {step === 2 && <ExportPackageStep {...stepProps} />}
        {step === 3 && <ScheduleStep form={form} update={update} />}
        {step === REVIEW_STEP && <ReviewStep form={form} api={api} />}
      </DialogContent>
      {problem && step < REVIEW_STEP && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ px: 3 }}
          role="status"
        >
          {problem}
        </Typography>
      )}
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Box flex={1} />
        <Button
          disabled={step === 0 || saving}
          onClick={() => setStep(current => current - 1)}
        >
          Back
        </Button>
        {step < REVIEW_STEP ? (
          <Button
            variant="contained"
            disabled={Boolean(problem)}
            onClick={() => setStep(current => current + 1)}
          >
            Next
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={submit}
            disabled={saving || blockedAt !== null}
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create export'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
