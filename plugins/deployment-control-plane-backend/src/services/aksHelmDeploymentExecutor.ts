import type {
  ApplicationDeploymentStatus,
  DeploymentPipelineStage,
} from '../types';
import { GitHubActionsService } from './githubActionsService';
import type {
  DeploymentExecutor,
  DeploymentExecutorDeployInput,
  DeploymentExecutorDeployResult,
  DeploymentExecutorStatusResult,
} from './deploymentExecutor';

const STAGES: DeploymentPipelineStage['id'][] = [
  'SOURCE',
  'BUILD',
  'TEST',
  'SECURITY',
  'IMAGE',
  'DEPLOY',
  'VERIFY',
];

function baseStages(): DeploymentPipelineStage[] {
  return STAGES.map(id => ({ id, status: 'PENDING' }));
}

function toQueuedStages(): DeploymentPipelineStage[] {
  const stages = baseStages();
  stages[0] = { id: 'SOURCE', status: 'SUCCESS', message: 'Workflow accepted' };
  stages[1] = { id: 'BUILD', status: 'RUNNING', message: 'Waiting for runner' };
  return stages;
}

function statusFromJobName(name: string): DeploymentPipelineStage['id'] | null {
  const n = name.toLowerCase();
  if (n.includes('build')) return 'BUILD';
  if (n.includes('test')) return 'TEST';
  if (n.includes('security') || n.includes('scan') || n.includes('sast'))
    return 'SECURITY';
  if (n.includes('image') || n.includes('container') || n.includes('publish'))
    return 'IMAGE';
  if (n.includes('deploy') || n.includes('helm')) return 'DEPLOY';
  if (n.includes('verify') || n.includes('rollout') || n.includes('health'))
    return 'VERIFY';
  return null;
}

function applyWorkflowSignal(
  stages: DeploymentPipelineStage[],
  name: string,
  status: string,
  conclusion: string | null,
): void {
  const stageId = statusFromJobName(name);
  if (!stageId) return;
  const idx = stages.findIndex(stage => stage.id === stageId);
  if (idx < 0) return;

  if (conclusion === 'success' || conclusion === 'skipped') {
    stages[idx] = { id: stageId, status: 'SUCCESS', message: name };
    return;
  }

  if (status === 'in_progress' || status === 'queued') {
    stages[idx] = { id: stageId, status: 'RUNNING', message: name };
    return;
  }

  if (conclusion === 'failure' || conclusion === 'timed_out') {
    stages[idx] = { id: stageId, status: 'FAILED', message: name };
  }
}

function mapRunStatus(
  status: string,
  conclusion: string | null,
): ApplicationDeploymentStatus {
  if (status === 'queued') return 'QUEUED';
  if (status === 'in_progress') return 'DEPLOYING';
  if (status === 'completed') {
    if (conclusion === 'success') return 'READY';
    if (conclusion === 'cancelled') return 'CANCELLED';
    return 'FAILED';
  }
  return 'PENDING';
}

export class AksHelmDeploymentExecutor implements DeploymentExecutor {
  readonly type = 'aks-helm' as const;

  constructor(private readonly actions: GitHubActionsService) {}

  async deploy(
    input: DeploymentExecutorDeployInput,
  ): Promise<DeploymentExecutorDeployResult> {
    const run = await this.actions.dispatch({
      serviceId: input.componentId,
      workflowId: input.workflowId,
      ref: input.branch,
      inputs: input.inputs,
    });

    if (run.mode === 'simulated') {
      throw new Error(
        'DEPLOYMENT_EXECUTOR_NOT_CONFIGURED: GitHub Actions repository/token is not configured in backend runtime',
      );
    }

    return {
      workflowRunId: run.runId,
      workflowRunUrl: run.htmlUrl,
      status: mapRunStatus(run.status, run.conclusion),
      statusMessage: 'Deployment workflow dispatched successfully.',
      pipelineStages: toQueuedStages(),
    };
  }

  async getStatus(runId: string): Promise<DeploymentExecutorStatusResult> {
    const status = await this.actions.runStatus(runId);
    const mapped = mapRunStatus(status.status, status.conclusion);
    const stages = baseStages();

    if (status.status === 'queued') {
      stages[0] = { id: 'SOURCE', status: 'SUCCESS' };
      stages[1] = { id: 'BUILD', status: 'RUNNING' };
    }

    if (status.status === 'in_progress') {
      stages[0] = { id: 'SOURCE', status: 'SUCCESS' };
      for (const job of status.jobs ?? []) {
        applyWorkflowSignal(stages, job.name, job.status, job.conclusion);
        for (const step of job.steps ?? []) {
          applyWorkflowSignal(stages, step.name, step.status, step.conclusion);
        }
      }
    }

    if (status.status === 'completed') {
      for (const stage of stages) {
        stage.status = status.conclusion === 'success' ? 'SUCCESS' : 'FAILED';
      }
    }

    let statusMessage: string;
    if (mapped === 'READY') {
      statusMessage = 'Deployment workflow completed and verified.';
    } else if (mapped === 'FAILED') {
      statusMessage = 'Deployment workflow completed with failure.';
    } else {
      statusMessage = `Deployment workflow is ${status.status}.`;
    }

    return {
      status: mapped,
      statusMessage,
      workflowRunUrl: status.htmlUrl ?? null,
      pipelineStages: stages,
      workflowRun: status,
      completedAt:
        status.status === 'completed' ? new Date().toISOString() : undefined,
      failureReason:
        mapped === 'FAILED'
          ? `GitHub workflow conclusion: ${status.conclusion ?? 'failure'}`
          : undefined,
    };
  }

  async verify(runId: string): Promise<DeploymentExecutorStatusResult> {
    return this.getStatus(runId);
  }

  async cancel(
    _runId: string,
  ): Promise<{ accepted: boolean; reason?: string }> {
    return {
      accepted: false,
      reason:
        'Cancellation is not yet implemented for GitHub workflow-based deployment execution.',
    };
  }

  async rollback(
    _runId: string,
  ): Promise<{ accepted: boolean; reason?: string }> {
    return {
      accepted: false,
      reason:
        'Rollback is not yet implemented for GitHub workflow-based deployment execution.',
    };
  }
}
