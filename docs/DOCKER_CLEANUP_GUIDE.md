# Docker Cleanup Guide for CloudHub

## Current State
- **Build Cache**: 20.28GB total, **14.29GB reclaimable** (70%)
- **Unused Volumes**: **1.668GB reclaimable** (94%)
- **Unused Images**: 2.535GB reclaimable (10%)
- **Total Reclaimable**: ~18GB

---

## Quick Cleanup Commands

### 1. **Maximum Cleanup (Recommended First Time)**
Removes all unused build cache, dangling images, stopped containers, and unused volumes.

```bash
docker builder prune -a --keep-state
docker system prune -a --volumes
```

**Impact**: Frees ~18GB  
**Safety**: Safe - only removes unused resources  
**Time**: ~2-5 minutes

---

### 2. **Build Cache Only (Safest for Day-to-Day)**
Clears only the builder cache while keeping all images and volumes.

```bash
docker builder prune -a
```

**Impact**: Frees ~14.29GB  
**Safety**: Very safe - does not affect running images  
**Time**: ~1 minute

---

### 3. **Dangling Images Only**
Removes only untagged/orphaned images.

```bash
docker image prune -f
```

**Impact**: Frees ~500MB  
**Safety**: Safe - only removes dangling images  
**Time**: <1 minute

---

### 4. **Unused Volumes Only**
Removes volumes not in use by any container.

```bash
docker volume prune -f
```

**Impact**: Frees ~1.668GB  
**Safety**: **Caution** - removes unused database volumes (see list below)  
**Time**: <1 minute

---

### 5. **Full System Cleanup**
Comprehensive cleanup: removes stopped containers, dangling images, unused volumes, and build cache.

```bash
docker system prune --all --volumes -f
```

**Impact**: Frees ~18GB  
**Safety**: Recommended if you're starting fresh  
**Time**: ~3 minutes

---

## Unused Volumes (1.668GB Reclaimable)

**Consider removing if not in active use:**
- `bulbs_bulbs-postgres-data` (database)
- `datadog-error-router_dd_router_data` (monitoring)
- `datadog-error-router_dd_router_pgdata` (database)
- `infra_meilisearch_data` (search engine)
- `infra_postgres_data` (database)
- `log-router_dd_router_pgdata` (database)
- `platform_scp_dev_pgdata_dev` (dev database)
- `platform_scp_node_cache` (cache)
- `platform_scp_pgdata_dev` (dev database)
- `platform_scp_yarn_cache` (npm cache)
- `project_glance_pg_data` (database)
- `project_glance_redis_data` (cache)

**Keep these (in active use):**
- `platform_cloudhub_pgdata` (CloudHub production database)
- `platform_scp_pgdata` (CloudHub production data)

---

## Step-by-Step Cleanup Plan

### Scenario A: Aggressive Cleanup (Recommended)
```bash
# 1. Backup any important database volumes first (optional)
# docker run --rm -v <volume>:/data -v ~/backups:/backup alpine tar czf /backup/backup.tar.gz /data

# 2. Clear all build cache
docker builder prune -a --keep-state

# 3. Remove dangling images
docker image prune -f

# 4. Remove unused volumes (except CloudHub production ones)
docker volume rm bulbs_bulbs-postgres-data datadog-error-router_dd_router_data datadog-error-router_dd_router_pgdata infra_meilisearch_data infra_postgres_data log-router_dd_router_pgdata platform_scp_dev_pgdata_dev platform_scp_node_cache platform_scp_pgdata_dev platform_scp_yarn_cache project_glance_pg_data project_glance_redis_data
```

**Total Freed**: ~16GB  
**Time**: ~5 minutes

---

### Scenario B: Conservative Cleanup (Safest)
```bash
# Only clear build cache, keep all images and volumes
docker builder prune -a --keep-state
```

**Total Freed**: ~14.29GB  
**Time**: ~1 minute

---

### Scenario C: Nuclear Cleanup (Fresh Start)
```bash
# Remove everything unused, including stopped containers and old images
docker system prune -a --volumes -f
```

**Total Freed**: ~18GB  
**Time**: ~3 minutes

---

## Verify Cleanup Results

After running cleanup:

```bash
docker system df
```

Expected result: Build Cache should drop from 20.28GB to minimal, volumes from 1.766GB to 98MB (CloudHub only).

---

## Prevent Future Bloat

1. **Regular cleanup**: Run `docker builder prune -a` weekly
2. **Image retention**: Older images (4+ weeks) from completed projects can be safely removed
3. **Volume cleanup**: Remove volumes from abandoned projects
4. **Monitor**: Check `docker system df` monthly

---

## Notes

- CloudHub runs 9 active containers with production data in:
  - `platform_cloudhub_pgdata`
  - `platform_scp_pgdata`
  - These should never be deleted
- All other volumes are from test/dev projects (4-7 weeks old) and are safe to remove
- Build cache grows with each `docker compose build` and is the #1 bloat source
