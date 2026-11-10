import type { PortalDeploymentRecord } from '../types';

// The enterprise GitOps pipeline. It owns apps/{app}/{instance}/helmfile.yaml,
// task.bash's APP_LIST and the deploy/diff workflows; the target cluster is
// read from the instance helmfile's kubeContext, not passed as an input.
export const DEFAULT_DEPLOYMENT_REPOSITORY = 'SymphonyFS/pipeline-internal';
export const DEFAULT_DEPLOY_WORKFLOW_ID = 'deploy-with-dynamic-runners.yml';
export const DEFAULT_DIFF_WORKFLOW_ID = 'github-actions-diff-manual.yml';

const GITHUB_REPOSITORY_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function deploymentRepository(): string {
  const repository =
    process.env.SYMPHONYFS_SCRIPTS_REPOSITORY?.trim() ||
    DEFAULT_DEPLOYMENT_REPOSITORY;
  if (!GITHUB_REPOSITORY_SLUG_RE.test(repository)) {
    throw new Error(
      `SYMPHONYFS_SCRIPTS_REPOSITORY must be in owner/repo format, received ${repository}.`,
    );
  }
  return repository;
}

export function deployWorkflowId(): string {
  return (
    process.env.SYMPHONYFS_WORKFLOW_ID?.trim() || DEFAULT_DEPLOY_WORKFLOW_ID
  );
}

export function diffWorkflowId(): string {
  return (
    process.env.SYMPHONYFS_DIFF_WORKFLOW_ID?.trim() || DEFAULT_DIFF_WORKFLOW_ID
  );
}

export function workflowRef(): string {
  return process.env.SYMPHONYFS_WORKFLOW_REF?.trim() || 'main';
}

export function appInstanceHelmfilePath(
  application: string,
  instanceName: string,
): string {
  return `apps/${application}/${instanceName}/helmfile.yaml`;
}

/**
 * Exactly the inputs deploy-with-dynamic-runners.yml declares. GitHub
 * rejects undeclared inputs, so customer/cluster are not sent. Failover is
 * never requested from CloudHub: it also needs the typed actionValidation
 * and acceptance confirmations, which only a human in the GitHub UI gives.
 */
export function deployWorkflowInputs(
  record: Pick<PortalDeploymentRecord, 'application' | 'instanceName'>,
): Record<string, string> {
  return {
    appName: record.application,
    appInstance: record.instanceName,
    triggerFailover: 'no',
  };
}

/** github-actions-diff-manual.yml requires the literal confirmation "diff". */
export function diffWorkflowInputs(
  record: Pick<PortalDeploymentRecord, 'application' | 'instanceName'>,
): Record<string, string> {
  return {
    appName: record.application,
    appInstance: record.instanceName,
    actionValidation: 'diff',
  };
}
