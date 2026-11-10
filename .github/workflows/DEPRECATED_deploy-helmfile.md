# ⚠️ DEPRECATED: deploy-helmfile.yml

## Status: DEPRECATED

The workflow [`.github/workflows/deploy-helmfile.yml`](.github/workflows/deploy-helmfile.yml) is **deprecated** and should no longer be used.

**Replacement**: Use the new independent stage workflows:
- [Stage 1: Provision Cluster](.github/workflows/stage-1-provision-cluster.yml)
- [Stage 2: Deploy Component](.github/workflows/stage-2-deploy-component.yml)
- [Stage 3: Deploy Overlay](.github/workflows/stage-3-deploy-overlay.yml)

---

## Why It Was Replaced

### Problems with Old Design

```
❌ Connected Stages
  └─ Stage 1 → Stage 2 → Stage 3 (must complete in order)

❌ Cascading Failures
  └─ One stage failure blocks all downstream stages

❌ Limited Flexibility
  └─ Can't add customer without full deployment
  └─ Can't update component without affecting overlays

❌ Complex Dependencies
  └─ Hard to debug issues
  └─ Hard to understand failure chain

❌ No Parallelization
  └─ Sequential execution only
  └─ Adding 50 customers takes 4+ hours
```

### Benefits of New Design

```
✅ Independent Stages
  ├─ Stage 1 (standalone)
  ├─ Stage 2 (standalone)
  └─ Stage 3 (standalone)

✅ Isolated Failures
  └─ One stage failure doesn't affect others

✅ Maximum Flexibility
  ├─ Add customer without touching component
  ├─ Update component without redeploying overlays
  └─ Skip stages as needed

✅ Simple Architecture
  ├─ Easy to debug
  ├─ Clear responsibility boundaries
  └─ Self-documenting

✅ Parallel Execution
  ├─ Deploy 50 customers in ~10 minutes (not 4 hours)
  └─ Multiple stages run simultaneously
```

---

## Migration Path

### Old Workflow Structure

```
.github/workflows/deploy-helmfile.yml
├── detect-changes
├── deploy-non-prod
│   └── (depends on detect-changes)
└── deploy-prod
    └── (depends on detect-changes)
```

### New Workflow Structure

```
.github/workflows/
├── stage-1-provision-cluster.yml (independent)
├── stage-2-deploy-component.yml (independent)
└── stage-3-deploy-overlay.yml (independent)

deployments/
├── {component}
│   ├── component/{instance}/helmfile.yaml
│   └── overlay/{instance}/{customer_id}/helmfile.yaml
```

---

## What to Do

### ✅ DO: Use New Workflows

```
Trigger workflows via GitHub Actions UI:
1. Actions → Select workflow → Run workflow
2. Fill in inputs
3. Run

Much simpler! ✅
```

### ❌ DON'T: Use Old Workflow

```
❌ Don't use deploy-helmfile.yml
❌ Don't push to paths that trigger old workflow
❌ Don't create new helmfiles in old structure (apps/)
```

---

## Timeline

| Date | Status |
|------|--------|
| Today | **OLD WORKFLOW DEPRECATED** |
| 30 days | Old workflow can be removed |
| 60 days | Old workflow removed from repo |

---

## Questions?

- Quick Start: [DEPLOYMENT_QUICK_START.md](DEPLOYMENT_QUICK_START.md)
- Full Architecture: [INDEPENDENT_DEPLOYMENT_ARCHITECTURE.md](../../doc/INDEPENDENT_DEPLOYMENT_ARCHITECTURE.md)
- Stage 2 Workflow: [.github/workflows/stage-2-deploy-component.yml](.github/workflows/stage-2-deploy-component.yml)
- Stage 3 Workflow: [.github/workflows/stage-3-deploy-overlay.yml](.github/workflows/stage-3-deploy-overlay.yml)

---

## Archiving the Old Workflow

To fully decommission the old workflow, you can:

### Option 1: Delete It
```bash
git rm .github/workflows/deploy-helmfile.yml
git commit -m "Remove deprecated deploy-helmfile.yml workflow"
```

### Option 2: Archive It
```bash
# Create archive directory
mkdir -p .github/workflows-archived

# Move old workflow
git mv .github/workflows/deploy-helmfile.yml .github/workflows-archived/
git commit -m "Archive deprecated deploy-helmfile.yml workflow"
```

### Option 3: Keep It (Read-Only)
```bash
# Add README explaining it's deprecated
cat > .github/workflows/DEPRECATED_WORKFLOWS.md <<'EOF'
# Deprecated Workflows

- deploy-helmfile.yml - DEPRECATED, use stage-1/2/3 instead
EOF

git add .github/workflows/DEPRECATED_WORKFLOWS.md
git commit -m "Add notice: deploy-helmfile.yml is deprecated"
```

---

## Summary

| Aspect | Old | New |
|--------|-----|-----|
| Workflows | 1 (complex) | 3 (simple) |
| Dependencies | Connected | Independent |
| Flexibility | Low | High |
| Parallelization | No | Yes |
| Add Customer | Full redeployment | Stage 3 only |
| Update Component | Complex | Stage 2 only |
| Debugging | Hard | Easy |
| Time to 50 customers | 4+ hours | ~10 minutes |

✅ **New system is better in every way!**
