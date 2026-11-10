# Deployment Input Parameters & Action Buttons Guide

## Overview

This guide explains the input parameters required for deploying application instances, following the pattern established by the `sri-provisional` repository.

---

## Required Deployment Input Parameters

Every deployment requires exactly **4 core parameters**:

### 1. Environment Name (`env`)
- **Purpose**: Environment identifier (dev, qa, prod, etc.)
- **Type**: String
- **Format**: Lowercase, no spaces, alphanumeric + hyphens
- **Examples**: `dev`, `qa`, `prod`, `staging`, `test`
- **Usage**: Used in namespace, hostname, and configuration derivations

### 2. Namespace Prefix (`namespacePrefix`)
- **Purpose**: Kubernetes namespace prefix for the deployment
- **Type**: String
- **Format**: Kubernetes-valid (lowercase, numbers, hyphens only)
- **Examples**: `sri-dev`, `sri-qa`, `sri-prod`, `flows-dev`
- **Usage**: Base for actual K8s namespace name
- **Note**: Can include component name (e.g., `sri-`, `flows-`)

### 3. Host Prefix (`hostPrefix`)
- **Purpose**: Hostname prefix for ingress and service endpoints
- **Type**: String
- **Format**: DNS-valid (lowercase, numbers, hyphens)
- **Examples**: `dev`, `qa`, `prod`, `tmplhost`, `api-dev`
- **Usage**: Combined with `dnsZone` to create full hostnames
- **Important**: Can differ from `namespacePrefix` (e.g., namespace=sri-dev, host=dev)

### 4. DNS Zone (`dnsZone`)
- **Purpose**: Base DNS domain for the environment
- **Type**: String
- **Format**: Valid DNS domain (with dots)
- **Examples**: `example.invalid`, `dev.example.com`, `qa.cloudub.io`
- **Usage**: Combined with `hostPrefix` to create ingress hosts
- **Derived**: DNS-1123 compatible version: `example-invalid`, `dev-example-com`

---

## Derived/Computed Values

These are automatically calculated from the 4 core parameters:

| Derived Value | Calculation | Example |
|---|---|---|
| Full Hostname | `{hostPrefix}.{dnsZone}` | `dev.example.com` |
| Full Namespace | `{namespacePrefix}` (used as-is) | `sri-dev` |
| DNS-1123 Zone | Replace dots with hyphens | `dev-example-com` |
| Release Name | Usually `{component}-{env}` | `sri-dev` |

---

## Example Configurations

### Development Environment
```yaml
env: dev
namespacePrefix: sri-dev
hostPrefix: dev
dnsZone: dev.example.com

# Derived:
fullHostname: dev.example.com
kubernetesNamespace: sri-dev
```

### QA Environment
```yaml
env: qa
namespacePrefix: sri-qa
hostPrefix: qa
dnsZone: qa.example.com

# Derived:
fullHostname: qa.example.com
kubernetesNamespace: sri-qa
```

### Production Environment
```yaml
env: prod
namespacePrefix: sri-prod
hostPrefix: prod
dnsZone: prod.example.com

# Derived:
fullHostname: prod.example.com
kubernetesNamespace: sri-prod
```

### Template (for copying)
```yaml
env: tmpl
namespacePrefix: sri-tmpl
hostPrefix: tmplhost
dnsZone: example.invalid

# Derived:
fullHostname: tmplhost.example.invalid
kubernetesNamespace: sri-tmpl
```

---

## Deployment Action Buttons

The `DeploymentActionButtons` component provides a clean, standardized workflow for all deployments.

### Available Buttons

```
┌─────────────┐  ┌──────────┐  ┌─────────────────┐  ┌────────┐  ┌────────┐
│  Validate   │  │  Update  │  │ Generate Config │  │ Cancel │  │ Deploy │
└─────────────┘  └──────────┘  └─────────────────┘  └────────┘  └────────┘
```

### Button Lifecycle

```
IDLE
  ├─ Validate → VALIDATING → VALIDATED
  │
  ├─ Generate Config → GENERATING → GENERATED
  │
  └─ Cancel → (closed)

VALIDATED
  ├─ Generate Config → GENERATING → GENERATED
  └─ Validate → VALIDATING → VALIDATED

GENERATED
  ├─ Update → UPDATING → UPDATED
  ├─ Validate → VALIDATING → VALIDATED
  └─ Cancel → (closed)

UPDATED
  ├─ Deploy → DEPLOYING → DEPLOYED ✓
  ├─ Update → UPDATING → UPDATED
  └─ Cancel → (closed)

DEPLOY-FAILED
  ├─ Deploy → DEPLOYING → DEPLOYED ✓
  ├─ Update → UPDATING → UPDATED
  └─ Cancel → (closed)
```

### Button Visibility Rules

| Phase | Validate | Update | Generate Config | Cancel | Deploy |
|-------|----------|--------|-----------------|--------|--------|
| IDLE | ✓ | | ✓ | ✓ | |
| VALIDATING | | | | | |
| VALIDATED | | | ✓ | ✓ | |
| GENERATING | | | | | |
| GENERATED | ✓ | ✓ | | ✓ | ✓ |
| UPDATING | | | | | |
| UPDATED | ✓ | ✓ | | ✓ | ✓ |
| DEPLOYING | | | | | |
| DEPLOYED | | | | ✓ | |
| DEPLOY-FAILED | ✓ | ✓ | | ✓ | ✓ |
| VALIDATION-FAILED | ✓ | | ✓ | ✓ | |

---

## Using DeploymentActionButtons Component

### Installation

The component is located at:
```
plugins/platform-home/src/components/DeploymentActionButtons.tsx
```

### Basic Usage

```tsx
import { DeploymentActionButtons } from './DeploymentActionButtons';

function MyDeploymentPage() {
  const [phase, setPhase] = useState<DeploymentPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const callbacks = {
    onValidate: async () => {
      try {
        setError(null);
        // Call your validation API
        const response = await fetch('/api/validate', {
          method: 'POST',
          body: JSON.stringify(deploymentConfig),
        });
        if (!response.ok) throw new Error('Validation failed');
        setPhase('validated');
      } catch (err) {
        setPhase('validation-failed');
        setError((err as Error).message);
      }
    },

    onGenerateConfig: async () => {
      try {
        setError(null);
        setPhase('generating');
        // Generate configuration
        const response = await fetch('/api/generate-config', {
          method: 'POST',
          body: JSON.stringify({
            env,
            namespacePrefix,
            hostPrefix,
            dnsZone,
          }),
        });
        if (!response.ok) throw new Error('Config generation failed');
        const config = await response.json();
        setDeploymentConfig(config);
        setPhase('generated');
      } catch (err) {
        setError((err as Error).message);
      }
    },

    onUpdate: async () => {
      try {
        setError(null);
        setPhase('updating');
        // Update configuration
        const response = await fetch('/api/update-config', {
          method: 'PUT',
          body: JSON.stringify(deploymentConfig),
        });
        if (!response.ok) throw new Error('Update failed');
        setPhase('updated');
        setSuccess('Configuration updated successfully');
      } catch (err) {
        setError((err as Error).message);
      }
    },

    onDeploy: async () => {
      try {
        setError(null);
        setSuccess(null);
        setPhase('deploying');
        // Deploy to cluster
        const response = await fetch('/api/deploy', {
          method: 'POST',
          body: JSON.stringify(deploymentConfig),
        });
        if (!response.ok) throw new Error('Deployment failed');
        setPhase('deployed');
        setSuccess('Deployment completed successfully!');
      } catch (err) {
        setPhase('deploy-failed');
        setError((err as Error).message);
      }
    },

    onCancel: () => {
      // Close dialog, navigate away, etc.
      setPhase('idle');
      setError(null);
      setSuccess(null);
    },
  };

  return (
    <DeploymentActionButtons
      phase={phase}
      callbacks={callbacks}
      error={error}
      successMessage={success}
      showProgress
    />
  );
}
```

### Props

```typescript
interface DeploymentActionButtonsProps {
  // Current deployment phase
  phase: DeploymentPhase;

  // Callbacks for button actions
  callbacks: DeploymentActionCallbacks;

  // Optional: disable all buttons
  disabled?: boolean;

  // Optional: error message to display
  error?: string | null;

  // Optional: success message to display
  successMessage?: string | null;

  // Optional: show progress bar during operations
  showProgress?: boolean;
}
```

### Phase States

```typescript
type DeploymentPhase =
  | 'idle'              // Initial state
  | 'validating'        // Validate in progress
  | 'validated'         // Validation passed
  | 'validation-failed' // Validation failed
  | 'generating'        // Generate Config in progress
  | 'generated'         // Config generated
  | 'updating'          // Update in progress
  | 'updated'           // Update completed
  | 'deploying'         // Deploy in progress
  | 'deployed'          // Deploy completed
  | 'deploy-failed';    // Deploy failed
```

### Callbacks Interface

```typescript
interface DeploymentActionCallbacks {
  onValidate: () => Promise<void>;       // Validate configuration
  onGenerateConfig: () => Promise<void>; // Generate/prepare config
  onUpdate: () => Promise<void>;         // Update configuration
  onDeploy: () => Promise<void>;         // Deploy to cluster
  onCancel: () => void;                  // Cancel workflow (sync)
}
```

---

## Integration Examples

### Example 1: SRI Deployment Page

```tsx
import { useState } from 'react';
import { DeploymentActionButtons, DeploymentPhase } from './DeploymentActionButtons';

export function SriDeploymentPage() {
  const [phase, setPhase] = useState<DeploymentPhase>('idle');
  const [config, setConfig] = useState({
    env: 'dev',
    namespacePrefix: 'sri-dev',
    hostPrefix: 'dev',
    dnsZone: 'example.com',
  });

  return (
    <div>
      <h1>SRI Deployment</h1>
      
      {/* Your configuration inputs here */}
      <form>
        <input
          value={config.env}
          onChange={e => setConfig({...config, env: e.target.value})}
          placeholder="Environment (dev, qa, prod)"
        />
        <input
          value={config.namespacePrefix}
          onChange={e => setConfig({...config, namespacePrefix: e.target.value})}
          placeholder="Namespace Prefix (sri-dev, sri-qa, ...)"
        />
        <input
          value={config.hostPrefix}
          onChange={e => setConfig({...config, hostPrefix: e.target.value})}
          placeholder="Host Prefix (dev, qa, prod)"
        />
        <input
          value={config.dnsZone}
          onChange={e => setConfig({...config, dnsZone: e.target.value})}
          placeholder="DNS Zone (example.com)"
        />
      </form>

      {/* Action buttons */}
      <DeploymentActionButtons
        phase={phase}
        callbacks={{
          onValidate: async () => {
            setPhase('validating');
            try {
              await validateDeployment(config);
              setPhase('validated');
            } catch (err) {
              setPhase('validation-failed');
              throw err;
            }
          },
          onGenerateConfig: async () => {
            setPhase('generating');
            await generateConfig(config);
            setPhase('generated');
          },
          onUpdate: async () => {
            setPhase('updating');
            await updateConfig(config);
            setPhase('updated');
          },
          onDeploy: async () => {
            setPhase('deploying');
            await deployToCluster(config);
            setPhase('deployed');
          },
          onCancel: () => {
            setPhase('idle');
            setConfig({
              env: 'dev',
              namespacePrefix: 'sri-dev',
              hostPrefix: 'dev',
              dnsZone: 'example.com',
            });
          },
        }}
        showProgress
      />
    </div>
  );
}
```

### Example 2: Multi-component Deployment

```tsx
export function MultiComponentDeployPage() {
  const [components, setComponents] = useState({
    sri: { phase: 'idle' },
    flows: { phase: 'idle' },
    detectionhub: { phase: 'idle' },
  });

  const deployComponent = async (componentName: string) => {
    const config = {
      component: componentName,
      env: 'dev',
      namespacePrefix: `${componentName}-dev`,
      hostPrefix: `${componentName}-dev`,
      dnsZone: 'example.com',
    };

    setComponents(prev => ({
      ...prev,
      [componentName]: { phase: 'deploying' },
    }));

    try {
      await deployToCluster(config);
      setComponents(prev => ({
        ...prev,
        [componentName]: { phase: 'deployed' },
      }));
    } catch (err) {
      setComponents(prev => ({
        ...prev,
        [componentName]: { phase: 'deploy-failed' },
      }));
    }
  };

  return (
    <>
      {Object.entries(components).map(([name, state]) => (
        <div key={name}>
          <h3>{name}</h3>
          <DeploymentActionButtons
            phase={state.phase}
            callbacks={{
              onValidate: async () => { /* ... */ },
              onGenerateConfig: async () => { /* ... */ },
              onUpdate: async () => { /* ... */ },
              onDeploy: async () => deployComponent(name),
              onCancel: () => {
                setComponents(prev => ({
                  ...prev,
                  [name]: { phase: 'idle' },
                }));
              },
            }}
          />
        </div>
      ))}
    </>
  );
}
```

---

## Sri-provisional Pattern

The `sri-provisional` repository uses a three-tier values structure:

### 1. Base Template (`deploy/base/values.tmpl.yaml`)
Contains shared configuration with `@TOKEN@` placeholders:
- `@NS@` → namespacePrefix
- `@HOST@` → hostPrefix
- `@ENV@` → env
- `@ZONE@` → dnsZone
- `@ZONE_@` → dnsZone with dots replaced by hyphens

### 2. Generated Values (`deploy/{env}/values.generated.yaml`)
Auto-generated from template with tokens replaced. Machine-owned, regenerated each deployment.

### 3. Overlay Values (`deploy/{env}/values-overlay.yaml`)
Per-environment exceptions and overrides. Hand-written, persists across regenerations.

### 4. Secrets (`deploy/{env}/secrets.gen.yaml`)
Credentials and sensitive data. Gitignored, 0600 permissions, separate `-f` flag.

---

## Best Practices

1. **Validate First**: Always call `onValidate` before `onGenerateConfig` to catch issues early
2. **Review Config**: Check generated configuration before updating/deploying
3. **Use Confirmations**: Deploy action includes confirmation dialog to prevent accidents
4. **Error Handling**: All callbacks should have proper error handling and set phase accordingly
5. **Progressive Disclosure**: Only show buttons relevant to current phase
6. **Progress Feedback**: Use `showProgress` prop to display progress during async operations
7. **Consistent Naming**: Use same parameter names across all components

---

## Troubleshooting

### "Validate" button disabled
- You're not in `idle`, `validation-failed`, `generated`, or `updated` phase
- Call `onValidate` to move to `validating` → `validated`

### "Deploy" button never activates
- Ensure you move to `updated` or `generated` phase
- Check that `onGenerateConfig` and `onUpdate` properly update the phase

### Loss of state on cancel
- `onCancel` callback doesn't auto-reset state
- Explicitly reset phase and config in your callback

---

**Last Updated**: 2026-08-29  
**Component Location**: `plugins/platform-home/src/components/DeploymentActionButtons.tsx`  
**Pattern Reference**: sri-provisional repository deployment structure
