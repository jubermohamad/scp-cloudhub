import { Caller, auditScope, visibleTenants } from '../access';
import { DASHBOARD_WINDOW_DAYS, HEALTH_STATES, Health } from '../constants';
import type { DataExportDatabase } from '../db';
import { pageOf, parseListQuery } from '../listQuery';
import { AUDIT_LIST, AuditRepository } from '../repositories/auditRepository';
import { DashboardRepository } from '../repositories/dashboardRepository';
import { CatalogService } from './catalogService';
import { DestinationService } from './destinationService';
import { ExportService } from './exportService';
import { FleetService } from './fleetService';

/** Operational read models: dashboard, filter drop-downs and the audit trail. */
export class DashboardService {
  private readonly dashboard: DashboardRepository;
  private readonly audit: AuditRepository;

  constructor(
    db: DataExportDatabase,
    private readonly catalog: CatalogService,
    private readonly destinations: DestinationService,
    private readonly exports: ExportService,
    private readonly fleet: FleetService,
  ) {
    this.dashboard = new DashboardRepository(db);
    this.audit = new AuditRepository(db);
  }

  async get(caller: Caller) {
    const scope = visibleTenants(caller);
    const [clusters, agents, configuredExports, jobs, datasetsPublished, destinationsConfigured] = await Promise.all([
      this.fleet.clusterHealth(caller),
      this.fleet.countAgents(caller),
      this.exports.countConfigured(caller),
      this.dashboard.jobFigures(scope),
      this.catalog.countPublished(),
      this.destinations.countConfigured(caller),
    ]);
    const [topDatasets, topTenants, topDestinations, queueDepth] = await Promise.all([
      this.dashboard.topDatasets(scope, DASHBOARD_WINDOW_DAYS),
      this.dashboard.topTenants(scope, DASHBOARD_WINDOW_DAYS),
      this.dashboard.topDestinations(scope, DASHBOARD_WINDOW_DAYS),
      caller.isPlatformAdmin ? this.dashboard.queueDepth() : Promise.resolve([]),
    ]);
    const clusterHealth = Object.fromEntries(HEALTH_STATES.map(state => [state, 0])) as Record<Health, number>;
    for (const cluster of clusters) clusterHealth[cluster.health] += 1;

    return {
      generatedAt: new Date().toISOString(),
      windowDays: DASHBOARD_WINDOW_DAYS,
      kpis: {
        healthyClusters: clusterHealth.HEALTHY,
        registeredClusters: clusters.length,
        connectedAgents: agents.connected,
        registeredAgents: agents.registered,
        configuredExports,
        runningExports: jobs.running,
        queuedJobs: jobs.queued,
        completedJobsToday: jobs.completedToday,
        failedJobsToday: jobs.failedToday,
        datasetsPublished,
        destinationsConfigured,
        rowsExportedToday: jobs.rowsToday,
        bytesExportedToday: jobs.bytesToday,
      },
      clusterHealth,
      executionActivity: {
        COMPLETED: jobs.completedToday,
        RUNNING: jobs.running,
        QUEUED: jobs.queued,
        FAILED: jobs.failedToday,
      },
      topDatasets,
      topTenants,
      topDestinations,
      queueDepth,
    };
  }

  async filterOptions(caller: Caller) {
    const [tenants, clusters, datasets, owners] = await Promise.all([
      caller.isPlatformAdmin ? this.exports.tenants() : Promise.resolve(caller.tenantMemberOf),
      this.fleet.clusterHealth(caller),
      this.catalog.options(),
      this.exports.owners(caller),
    ]);
    return {
      tenants,
      clusters: clusters.map(({ id, clusterName, tenantId }) => ({ id, clusterName, tenantId })),
      datasets,
      owners,
    };
  }

  async listAudit(query: Record<string, unknown>, caller: Caller) {
    const request = parseListQuery(query, AUDIT_LIST, 'e.id');
    const { items, total } = await this.audit.list(request, auditScope(caller));
    return pageOf(items, total, request);
  }
}
