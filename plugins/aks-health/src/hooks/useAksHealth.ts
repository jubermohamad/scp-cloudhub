import { useState, useEffect, useMemo, useCallback } from 'react';
import { useBackendFetch } from '@internal/plugin-platform-common';
import {
  AksHealthApi,
  type AksHealthCheck,
  type AksHealthHistoryItem,
  type AksHealthRunResult,
  type PlatformCluster,
} from '../api/AksHealthApi';

export function useAksHealth() {
  const backendFetch = useBackendFetch();
  const api = useMemo(() => new AksHealthApi(backendFetch), [backendFetch]);

  const [clusters, setClusters] = useState<PlatformCluster[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(true);

  const [selectedCustomer, setSelectedCustomer] = useState<string>('');
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>('');
  const [selectedClusterId, setSelectedClusterId] = useState<string>('');

  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<AksHealthRunResult | null>(null);
  const [history, setHistory] = useState<AksHealthHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Selected check for detailed findings drawer
  const [selectedCheckForDetails, setSelectedCheckForDetails] =
    useState<AksHealthCheck | null>(null);
  const [isFindingsDrawerOpen, setIsFindingsDrawerOpen] = useState(false);

  // Load cluster registry
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingClusters(true);
        const list = await api.getClusters();
        if (cancelled) return;
        setClusters(list);

        // Pre-select ScotiaBank if available
        const defaultCluster =
          list.find(c => c.clusterName.includes('scotia')) || list[0];
        if (defaultCluster) {
          setSelectedCustomer(defaultCluster.customerName);
          setSelectedEnvironment(defaultCluster.environment);
          setSelectedClusterId(defaultCluster.id);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoadingClusters(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Unique customers
  const customers = useMemo(() => {
    return Array.from(new Set(clusters.map(c => c.customerName))).sort();
  }, [clusters]);

  // Environments for selected customer
  const environments = useMemo(() => {
    if (!selectedCustomer) return [];
    return Array.from(
      new Set(
        clusters
          .filter(c => c.customerName === selectedCustomer)
          .map(c => c.environment),
      ),
    ).sort();
  }, [clusters, selectedCustomer]);

  // Clusters for selected customer + environment
  const filteredClusters = useMemo(() => {
    if (!selectedCustomer || !selectedEnvironment) return [];
    return clusters.filter(
      c =>
        c.customerName === selectedCustomer &&
        c.environment === selectedEnvironment,
    );
  }, [clusters, selectedCustomer, selectedEnvironment]);

  // The active cluster object
  const selectedCluster = useMemo(() => {
    return (
      clusters.find(c => c.id === selectedClusterId) ??
      filteredClusters[0] ??
      null
    );
  }, [clusters, filteredClusters, selectedClusterId]);

  // Update selected cluster if customer/environment change
  const handleSelectCustomer = useCallback((customer: string) => {
    setSelectedCustomer(customer);
    const availEnvs = Array.from(
      new Set(
        clusters
          .filter(c => c.customerName === customer)
          .map(c => c.environment),
      ),
    );
    const nextEnv = availEnvs[0] || '';
    setSelectedEnvironment(nextEnv);
    const availClusters = clusters.filter(
      c => c.customerName === customer && c.environment === nextEnv,
    );
    setSelectedClusterId(availClusters[0]?.id || '');
    setResult(null);
  }, [clusters]);

  const handleSelectEnvironment = useCallback((env: string) => {
    setSelectedEnvironment(env);
    const availClusters = clusters.filter(
      c => c.customerName === selectedCustomer && c.environment === env,
    );
    setSelectedClusterId(availClusters[0]?.id || '');
    setResult(null);
  }, [clusters, selectedCustomer]);

  const handleSelectCluster = useCallback((clusterId: string) => {
    setSelectedClusterId(clusterId);
    setResult(null);
  }, []);

  // Fetch history when cluster changes
  useEffect(() => {
    if (!selectedClusterId) return;
    let cancelled = false;
    (async () => {
      try {
        const h = await api.getHistory(selectedClusterId);
        if (!cancelled) setHistory(h);
      } catch {
        // history fetch error non-blocking
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, selectedClusterId]);

  // Trigger health check
  const runHealthCheck = useCallback(async () => {
    if (!selectedClusterId) return;
    setIsRunning(true);
    setError(null);

    try {
      const res = await api.runHealthCheck(selectedClusterId);
      setResult(res);

      // Refresh history
      const updatedHistory = await api.getHistory(selectedClusterId);
      setHistory(updatedHistory);
    } catch (err: any) {
      setError(err.message || 'Health check execution failed');
    } finally {
      setIsRunning(false);
    }
  }, [api, selectedClusterId]);

  const openFindingsDrawer = useCallback((check: AksHealthCheck) => {
    setSelectedCheckForDetails(check);
    setIsFindingsDrawerOpen(true);
  }, []);

  const closeFindingsDrawer = useCallback(() => {
    setIsFindingsDrawerOpen(false);
  }, []);

  return {
    clusters,
    loadingClusters,
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
  };
}
