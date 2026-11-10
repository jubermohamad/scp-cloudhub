import type { LoggerService } from '@backstage/backend-plugin-api';
import type { PortalDeploymentRecord } from '../types';
import type { GitHubActionsService } from './githubActionsService';
import {
  deployWorkflowId,
  deployWorkflowInputs,
  deploymentRepository,
  workflowRef,
} from './deploymentPipeline';

export interface ScriptsPipelineDeploymentDeps {
  logger: LoggerService;
  actions: GitHubActionsService;
  persistUpdate: (record: PortalDeploymentRecord) => Promise<void>;
  appendEvent: (input: {
    deploymentId: string;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    note?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
}

export class ScriptsPipelineDeploymentService {
  private readonly deps: ScriptsPipelineDeploymentDeps;

  constructor(deps: ScriptsPipelineDeploymentDeps) {
    this.deps = deps;
  }

  private async progress(
    record: PortalDeploymentRecord,
    status: PortalDeploymentRecord['status'],
    step: string,
    note: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const previous = record.status;
    record.status = status;
    record.currentStep = step;
    record.statusMessage = note;
    record.updatedAt = new Date().toISOString();
    await this.deps.persistUpdate(record);
    await this.deps.appendEvent({
      deploymentId: record.id,
      eventType: 'log',
      fromStatus: previous,
      toStatus: status,
      note,
      metadata,
    });
  }

  async dispatch(record: PortalDeploymentRecord): Promise<void> {
    const repository = deploymentRepository();
    const workflowId = deployWorkflowId();
    const ref = workflowRef();
    const workflowInputs = deployWorkflowInputs(record);
    record.workflowRepository = repository;
    record.workflowId = workflowId;
    record.workflowRef = ref;
    record.workflowInputs = workflowInputs;
    record.dispatchInitiatedAt = new Date().toISOString();
    record.correlationStatus = 'PENDING';
    record.correlationMessage = null;
    record.correlationAttempts += 1;
    record.correlationDeadline = new Date(Date.now() + 5 * 60_000).toISOString();
    await this.deps.persistUpdate(record);
    await this.progress(
      record,
      'DISPATCHING',
      'Dispatching pipeline workflow',
      `CloudHub approval succeeded; dispatching ${workflowId} in ${repository}.`,
    );

    const dispatch = await this.deps.actions.dispatch({
      serviceId: record.application,
      repository,
      workflowId,
      ref,
      inputs: workflowInputs,
    });

    record.workflowInputs = dispatch.inputs ?? workflowInputs;
    record.workflowRunId = dispatch.runId;
    record.workflowRunUrl = dispatch.htmlUrl || null;
    record.mode = dispatch.mode;
    record.correlationStatus = dispatch.runId ? 'CORRELATED' : 'PENDING';
    record.correlationMessage = dispatch.runId
      ? 'Workflow run correlated after dispatch.'
      : 'Workflow dispatched; run is not visible yet and will be reconciled without redispatch.';
    record.workflowStatus = dispatch.status;
    record.workflowConclusion = dispatch.conclusion;
    record.status = dispatch.runId && dispatch.status === 'completed' ? 'SUCCEEDED' : dispatch.runId ? 'QUEUED' : 'DISPATCHING';
    record.currentStep =
      record.status === 'SUCCEEDED' ? 'Deployment completed' : 'Workflow queued';
    record.statusMessage = `${workflowId} dispatched in ${repository}.`;
    record.updatedAt = new Date().toISOString();
    if (record.status === 'SUCCEEDED') record.completedAt = record.updatedAt;
    await this.deps.persistUpdate(record);
    await this.deps.appendEvent({
      deploymentId: record.id,
      eventType: 'workflow-dispatched',
      fromStatus: 'DISPATCHING',
      toStatus: record.status,
      note: record.statusMessage,
      metadata: {
        repository: dispatch.repository,
        workflow: dispatch.workflowId,
        ref: dispatch.ref,
        workflowRunId: dispatch.runId,
      },
    });
  }
}
