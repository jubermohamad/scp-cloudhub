import type { DataExportApi } from '../../../api';
import type { WizardForm } from '../../../exportWizardModel';

/** Props shared by every wizard step. */
export interface StepProps {
  form: WizardForm;
  update: (patch: Partial<WizardForm>) => void;
  api: DataExportApi;
}
