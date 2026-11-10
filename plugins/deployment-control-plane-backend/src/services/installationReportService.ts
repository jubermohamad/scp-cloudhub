import type { LoggerService } from '@backstage/backend-plugin-api';
import type {
  DeploymentStage,
  OrchestrationPlan,
  StageExecutionResult,
} from './orchestrationEngine';

/**
 * Audit Trail & Installation Reporting
 *
 * Tracks all deployment activities for:
 * - Complete audit trail
 * - Troubleshooting
 * - Compliance and auditing
 * - Performance metrics
 */

export enum AuditEventType {
  DEPLOYMENT_STARTED = 'deployment-started',
  DEPLOYMENT_COMPLETED = 'deployment-completed',
  DEPLOYMENT_FAILED = 'deployment-failed',
  STAGE_STARTED = 'stage-started',
  STAGE_COMPLETED = 'stage-completed',
  STAGE_FAILED = 'stage-failed',
  STEP_STARTED = 'step-started',
  STEP_COMPLETED = 'step-completed',
  STEP_FAILED = 'step-failed',
  HEALTH_CHECK_PASSED = 'health-check-passed',
  HEALTH_CHECK_FAILED = 'health-check-failed',
  ROLLBACK_INITIATED = 'rollback-initiated',
  ROLLBACK_COMPLETED = 'rollback-completed',
  ROLLBACK_FAILED = 'rollback-failed',
  TEST_PASSED = 'test-passed',
  TEST_FAILED = 'test-failed',
  SECRET_RETRIEVED = 'secret-retrieved',
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  deploymentId: string;
  application: string;
  instance: string;
  stage?: DeploymentStage;
  step?: string;
  status: 'success' | 'failure' | 'in-progress';
  duration?: number; // milliseconds
  actor: string; // GitHub user, service principal, etc.
  details: Record<string, any>;
  errorMessage?: string;
  metadata: {
    cluster: string;
    namespace: string;
    chartVersion: string;
    environment: string;
  };
}

export interface InstallationReport {
  id: string;
  deploymentId: string;
  application: string;
  instance: string;
  status: 'success' | 'failed' | 'in-progress';
  startTime: string;
  endTime?: string;
  duration?: number; // milliseconds
  plan: OrchestrationPlan;
  stageResults: StageExecutionResult[];
  auditLog: AuditLogEntry[];
  summary: {
    totalStages: number;
    completedStages: number;
    failedStages: number;
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    healthChecksPassed: number;
    healthChecksFailed: number;
  };
  errors: string[];
  warnings: string[];
  recommendations: string[];
}

/**
 * Audit Log Service
 * Records all deployment events for auditing and troubleshooting
 */
export class AuditLogService {
  private logs: AuditLogEntry[] = [];

  constructor(private readonly logger: LoggerService) {}

  /**
   * Log an audit event
   */
  logEvent(input: {
    eventType: AuditEventType;
    deploymentId: string;
    application: string;
    instance: string;
    stage?: DeploymentStage;
    step?: string;
    status: 'success' | 'failure' | 'in-progress';
    duration?: number;
    actor: string;
    details: Record<string, any>;
    errorMessage?: string;
    metadata: {
      cluster: string;
      namespace: string;
      chartVersion: string;
      environment: string;
    };
  }): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      eventType: input.eventType,
      deploymentId: input.deploymentId,
      application: input.application,
      instance: input.instance,
      stage: input.stage,
      step: input.step,
      status: input.status,
      duration: input.duration,
      actor: input.actor,
      details: input.details,
      errorMessage: input.errorMessage,
      metadata: input.metadata,
    };

    this.logs.push(entry);

    // Log with structured logging
    const logLevel =
      input.status === 'failure' ? 'error' : 'info';
    this.logger[logLevel](
      `[audit] ${input.eventType}: ${input.application}/${input.instance} - ${input.status}`,
      {
        deploymentId: input.deploymentId,
        stage: input.stage,
        step: input.step,
        duration: input.duration,
        actor: input.actor,
        details: input.details,
      },
    );

    return entry;
  }

  /**
   * Get audit log for a deployment
   */
  getDeploymentLog(deploymentId: string): AuditLogEntry[] {
    return this.logs.filter((log) => log.deploymentId === deploymentId);
  }

  /**
   * Get all audit logs
   */
  getAllLogs(): AuditLogEntry[] {
    return [...this.logs];
  }

  /**
   * Export logs as JSON for external storage/analysis
   */
  exportLogsAsJson(): string {
    return JSON.stringify(
      {
        exported: new Date().toISOString(),
        totalEntries: this.logs.length,
        logs: this.logs,
      },
      null,
      2,
    );
  }
}

/**
 * Installation Report Service
 * Generates comprehensive deployment reports
 */
export class InstallationReportService {
  constructor(
    private readonly logger: LoggerService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Generate installation report
   */
  generateReport(input: {
    deploymentId: string;
    application: string;
    instance: string;
    plan: OrchestrationPlan;
    stageResults: StageExecutionResult[];
    actor: string;
  }): InstallationReport {
    const startTime = new Date(input.plan.createdAt);
    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    const auditLog = this.auditLog.getDeploymentLog(input.deploymentId);

    // Calculate summary
    const summary = {
      totalStages: input.plan.stages.length,
      completedStages: input.stageResults.filter(
        (r) => r.status !== 'failed',
      ).length,
      failedStages: input.stageResults.filter((r) => r.status === 'failed')
        .length,
      totalSteps: input.plan.stages.reduce(
        (sum, stage) => sum + stage.steps.length,
        0,
      ),
      completedSteps: input.stageResults.reduce(
        (sum, result) => sum + result.stepsExecuted,
        0,
      ),
      failedSteps: input.stageResults.reduce(
        (sum, result) => sum + result.stepsFailed,
        0,
      ),
      healthChecksPassed: auditLog.filter(
        (log) => log.eventType === AuditEventType.HEALTH_CHECK_PASSED,
      ).length,
      healthChecksFailed: auditLog.filter(
        (log) => log.eventType === AuditEventType.HEALTH_CHECK_FAILED,
      ).length,
    };

    const allErrors = input.stageResults.flatMap((r) => r.errors);
    const status = allErrors.length === 0 ? 'success' : 'failed';

    const report: InstallationReport = {
      id: `report-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      deploymentId: input.deploymentId,
      application: input.application,
      instance: input.instance,
      status: status as any,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration: duration ?? 0,
      plan: input.plan,
      stageResults: input.stageResults,
      auditLog,
      summary,
      errors: allErrors,
      warnings: this.generateWarnings(input.stageResults, summary),
      recommendations: this.generateRecommendations(
        input.stageResults,
        summary,
        allErrors,
      ),
    };

    this.logger.info(
      `[reporting] Installation report generated for ${input.application}/${input.instance}`,
      {
        reportId: report.id,
        status: report.status,
        duration: report.duration,
        summary: report.summary,
      },
    );

    return report;
  }

  /**
   * Export report as JSON
   */
  exportReportAsJson(report: InstallationReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Export report as markdown for human readability
   */
  exportReportAsMarkdown(report: InstallationReport): string {
    const lines: string[] = [];

    lines.push('# Installation Report');
    lines.push('');
    lines.push(
      `**Report ID:** ${report.id}  `,
    );
    lines.push(
      `**Deployment ID:** ${report.deploymentId}  `,
    );
    lines.push(
      `**Application:** ${report.application}  `,
    );
    lines.push(
      `**Instance:** ${report.instance}  `,
    );
    lines.push(
      `**Status:** ${report.status.toUpperCase()}  `,
    );
    lines.push('');

    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Count |');
    lines.push('|--------|-------|');
    lines.push(
      `| Total Stages | ${report.summary.totalStages} |`,
    );
    lines.push(
      `| Completed Stages | ${report.summary.completedStages} |`,
    );
    lines.push(
      `| Failed Stages | ${report.summary.failedStages} |`,
    );
    lines.push(
      `| Total Steps | ${report.summary.totalSteps} |`,
    );
    lines.push(
      `| Completed Steps | ${report.summary.completedSteps} |`,
    );
    lines.push(
      `| Failed Steps | ${report.summary.failedSteps} |`,
    );
    lines.push(
      `| Health Checks Passed | ${report.summary.healthChecksPassed} |`,
    );
    lines.push(
      `| Health Checks Failed | ${report.summary.healthChecksFailed} |`,
    );
    lines.push('');

    lines.push('## Timeline');
    lines.push('');
    lines.push(`**Start Time:** ${report.startTime}`);
    lines.push(`**End Time:** ${report.endTime}`);
    lines.push(`**Duration:** ${((report.duration ?? 0) / 1000).toFixed(2)}s`);
    lines.push('');

    if (report.errors.length > 0) {
      lines.push('## Errors');
      lines.push('');
      report.errors.forEach((error) => {
        lines.push(`- ❌ ${error}`);
      });
      lines.push('');
    }

    if (report.warnings.length > 0) {
      lines.push('## Warnings');
      lines.push('');
      report.warnings.forEach((warning) => {
        lines.push(`- ⚠️ ${warning}`);
      });
      lines.push('');
    }

    if (report.recommendations.length > 0) {
      lines.push('## Recommendations');
      lines.push('');
      report.recommendations.forEach((rec) => {
        lines.push(`- 💡 ${rec}`);
      });
      lines.push('');
    }

    lines.push('## Stage Results');
    lines.push('');
    report.stageResults.forEach((result) => {
      lines.push(`### ${result.stage}`);
      lines.push('');
      lines.push(`- **Status:** ${result.status}`);
      lines.push(`- **Duration:** ${(result.duration / 1000).toFixed(2)}s`);
      lines.push(
        `- **Steps:** ${result.stepsExecuted} executed, ${result.stepsFailed} failed`,
      );
      if (result.errors.length > 0) {
        lines.push(`- **Errors:**`);
        result.errors.forEach((error) => {
          lines.push(`  - ${error}`);
        });
      }
      lines.push('');
    });

    return lines.join('\n');
  }

  /**
   * Generate warnings from deployment results
   */
  private generateWarnings(
    results: StageExecutionResult[],
    summary: any,
  ): string[] {
    const warnings: string[] = [];

    if (summary.failedSteps > 0) {
      warnings.push(
        `${summary.failedSteps} step(s) failed during deployment`,
      );
    }

    if (summary.healthChecksFailed > 0) {
      warnings.push(
        `${summary.healthChecksFailed} health check(s) failed`,
      );
    }

    const slowStages = results.filter((r) => r.duration > 300000); // 5+ min
    if (slowStages.length > 0) {
      warnings.push(
        `${slowStages.length} stage(s) took longer than expected (5+ min)`,
      );
    }

    return warnings;
  }

  /**
   * Generate recommendations from deployment results
   */
  private generateRecommendations(
    _results: StageExecutionResult[],
    summary: any,
    errors: string[],
  ): string[] {
    const recommendations: string[] = [];

    if (summary.failedSteps > 0) {
      recommendations.push(
        'Review failed step logs to identify root cause',
      );
      recommendations.push(
        'Consider running preflight validation before next deployment',
      );
    }

    if (summary.healthChecksFailed > 0) {
      recommendations.push('Check application logs for startup issues');
      recommendations.push(
        'Verify resource limits and cluster capacity',
      );
    }

    const errorsStr = errors.join(' ');
    if (errorsStr.includes('timeout')) {
      recommendations.push(
        'Consider increasing deployment timeout for slower environments',
      );
    }

    if (errorsStr.includes('memory')) {
      recommendations.push(
        'Increase memory limits or cluster resources',
      );
    }

    if (errorsStr.includes('secret')) {
      recommendations.push(
        'Ensure all required secrets are configured in 1Password',
      );
    }

    return recommendations;
  }
}
