import type {
  ApplicationDeploymentStatus,
  DeploymentPipelineStage,
} from '../types';
import type { WorkflowRunStatusResult } from './githubActionsService';

export interface DeploymentExecutorDeployInput {
  componentId: string;
  workflowId: string;
  repositoryRef: string;
  branch: string;
  inputs: Record<string, string>;
}

export interface DeploymentExecutorDeployResult {
  workflowRunId: string | null;
  workflowRunUrl: string | null;
  status: ApplicationDeploymentStatus;
  statusMessage: string;
  pipelineStages: DeploymentPipelineStage[];
}

export interface DeploymentExecutorStatusResult {
  status: ApplicationDeploymentStatus;
  statusMessage: string;
  workflowRunUrl: string | null;
  pipelineStages: DeploymentPipelineStage[];
  completedAt?: string;
  failureReason?: string;
  workflowRun?: WorkflowRunStatusResult;
}

export interface DeploymentExecutor {
  readonly type: 'aks-helm';
  deploy(
    input: DeploymentExecutorDeployInput,
  ): Promise<DeploymentExecutorDeployResult>;
  getStatus(runId: string): Promise<DeploymentExecutorStatusResult>;
  verify(runId: string): Promise<DeploymentExecutorStatusResult>;
  cancel(runId: string): Promise<{ accepted: boolean; reason?: string }>;
  rollback(runId: string): Promise<{ accepted: boolean; reason?: string }>;
}
