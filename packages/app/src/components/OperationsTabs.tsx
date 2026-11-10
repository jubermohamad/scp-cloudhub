import { CapabilityTabs } from './CapabilityTabs';

const TABS = [
  { label: 'Kubernetes Clusters', path: '/platform-registry/clusters' },
  { label: 'Kubernetes Health', path: '/operations/k8s-health-check' },
];

export function OperationsTabs() {
  return <CapabilityTabs tabs={TABS} />;
}
