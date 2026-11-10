import React from 'react';
import { Page, Header, Content } from '@backstage/core-components';
import {
  Alert,
  Typography,
  Card,
  CircularProgress,
} from '@mui/material';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import { useAksHealth } from '../hooks/useAksHealth';
import { ClusterSelector } from '../components/ClusterSelector';
import { HealthSummaryCard } from '../components/HealthSummaryCard';
import { CertificationResult } from '../components/CertificationResult';
import { HealthBreakdownTable } from '../components/HealthBreakdownTable';
import { FindingsPanel } from '../components/FindingsPanel';
import { CertificationHistory } from '../components/CertificationHistory';

export const AksHealthPage: React.FC = () => {
  const {
    customers,
    selectedCustomer,
    handleSelectCustomer,
    environments,
    selectedEnvironment,
    handleSelectEnvironment,
    filteredClusters,
    selectedClusterId,
    handleSelectCluster,
    selectedCluster,
    isRunning,
    result,
    history,
    error,
    runHealthCheck,
    selectedCheckForDetails,
    isFindingsDrawerOpen,
    openFindingsDrawer,
    closeFindingsDrawer,
    loadingClusters,
  } = useAksHealth();

  return (
    <Page themeId="tool">
      <Header
        title="AKS Health"
        subtitle="Authoritative AKS operational health assessment & certification engine"
      />
      <Content>
        {/* Top Section: Cluster Selector from Platform Registry */}
        <ClusterSelector
          customers={customers}
          selectedCustomer={selectedCustomer}
          onSelectCustomer={handleSelectCustomer}
          environments={environments}
          selectedEnvironment={selectedEnvironment}
          onSelectEnvironment={handleSelectEnvironment}
          clusters={filteredClusters}
          selectedClusterId={selectedClusterId}
          onSelectCluster={handleSelectCluster}
          onRunHealthCheck={runHealthCheck}
          isRunning={isRunning}
          loadingClusters={loadingClusters}
        />

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {isRunning && (
          <Card variant="outlined" sx={{ mb: 3, p: 4, textAlign: 'center' }}>
            <CircularProgress size={40} sx={{ color: '#464feb', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b' }}>
              Evaluating Cluster Operational Certification...
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748b' }}>
              Executing 12 certification checks across Azure Resource Manager and Kubernetes API
            </Typography>
          </Card>
        )}

        {/* Results Screen */}
        {result && !isRunning && (
          <>
            <HealthSummaryCard result={result} />
            <CertificationResult
              result={result}
              onSelectCheck={openFindingsDrawer}
            />
            <HealthBreakdownTable
              checks={result.checks}
              onSelectCheck={openFindingsDrawer}
            />
          </>
        )}

        {/* Historical Runs */}
        {!isRunning && (
          <CertificationHistory
            history={history}
            clusterName={selectedCluster?.clusterName}
          />
        )}

        {!result && !isRunning && (
          <Card variant="outlined" sx={{ p: 4, textAlign: 'center', backgroundColor: '#f8fafc' }}>
            <HealthAndSafetyIcon sx={{ fontSize: 48, color: '#94a3b8', mb: 1 }} />
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#334155' }}>
              Ready to Certify {selectedCluster ? selectedCluster.clusterName : 'Cluster'}
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748b', maxWidth: 600, mx: 'auto', mt: 0.5 }}>
              Click "Run Health Check" to execute the authoritative 12-category operational health assessment.
            </Typography>
          </Card>
        )}

        {/* Detailed Findings Drawer */}
        <FindingsPanel
          open={isFindingsDrawerOpen}
          onClose={closeFindingsDrawer}
          check={selectedCheckForDetails}
        />
      </Content>
    </Page>
  );
};
export default AksHealthPage;
