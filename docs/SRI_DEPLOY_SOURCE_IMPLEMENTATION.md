# SRI Deploy Source Setting - Implementation & Validation

## Overview

**Status:** ✅ IMPLEMENTED AND READY FOR TESTING

The SRI Deploy Source setting now includes:
1. **Persistent Backend Storage** - Saves to database, not just localStorage
2. **Save Button** - Explicit "Save Changes" action in Admin Settings
3. **Runtime Changes** - No backend/frontend redeploy needed
4. **Error Handling** - Shows error messages if save fails
5. **Unsaved Indicator** - Visual feedback when changes are pending

---

## What Was Changed

### 1. **plugins/platform-common/src/SriDeploySourceContext.tsx**

#### Added:
- `pendingSource`: Tracks unsaved changes
- `isSaving`: Loading state during save operation
- `saveError`: Error message if save fails
- `saveDeploySource()`: Async function that calls backend API
- `discardChanges()`: Reverts to saved state

#### New Behavior:
```typescript
// Before (localStorage only):
setDeploySource(source) → saves to localStorage immediately

// After (database + localStorage):
setDeploySource(source) → sets pendingSource (UI shows unsaved)
saveDeploySource()       → calls PUT /settings/deployment → saves to database
```

### 2. **plugins/platform-home/src/components/AdminSettingsPage.tsx**

#### Updated SRI Deploy Source Card:
- ✅ **Unsaved Indicator** - Yellow warning when changes pending
- ✅ **Save Button** - Green "Save Changes" button
- ✅ **Cancel Button** - Discard changes and revert
- ✅ **Error Display** - Red error box if save fails
- ✅ **Loading State** - "Saving..." text and disabled controls
- ✅ **Success Indicator** - "✓ Settings saved" message

---

## Backend API Endpoints

### GET /settings/deployment
**Returns current settings from database**

```bash
curl -X GET http://localhost:7007/api/deployment-control-plane/settings/deployment \
  -H "Authorization: Bearer <token>"
```

**Response:**
```json
{
  "sriDeploySource": "cloudhub-native"
}
```

### PUT /settings/deployment
**Updates settings in database (runtime)**

```bash
curl -X PUT http://localhost:7007/api/deployment-control-plane/settings/deployment \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"sriDeploySource": "provisioner-pipeline"}'
```

**Response:**
```json
{
  "sriDeploySource": "provisioner-pipeline"
}
```

---

## How It Works (Runtime Flow)

### Step 1: User Changes Dropdown
```
[Select "Provisioner Pipeline"]
  ↓
setDeploySource("provisioner-pipeline")
  ↓
pendingSource = "provisioner-pipeline"  ← UI shows unsaved indicator
```

### Step 2: User Clicks Save
```
Click "Save Changes"
  ↓
saveDeploySource()
  ↓
isSaving = true  ← Button shows "Saving..."
  ↓
PUT /settings/deployment { sriDeploySource: "provisioner-pipeline" }
  ↓
Backend persists to database
  ↓
isSaving = false
pendingSource = null
deploySource = "provisioner-pipeline"  ← Settings saved
```

### Step 3: Use New Setting
On next deployment, backend reads from database:
```
deploySriPipeline()
  ↓
getSettings()  ← Reads from database
  ↓
chartSource = settings.sriDeploySource  ← Uses new value
  ↓
helm generate --repo {chartSource}
```

---

## Testing Validation Checklist

### Local Testing (Without Redeploy)

#### ✅ Test 1: Change Setting
1. Navigate to Admin Settings (cloudhub-platform persona)
2. Open "SRI Deploy Source" card
3. Change dropdown from "CloudHub Native" to "Provisioner Pipeline"
4. Verify: **Yellow unsaved indicator appears**
5. Verify: **Save and Cancel buttons appear**

#### ✅ Test 2: Save Setting
1. Click "Save Changes" button
2. Verify: **Button changes to "Saving..."**
3. Verify: **Network tab shows PUT request to `/settings/deployment`**
4. Wait for success
5. Verify: **"✓ Settings saved" appears**
6. Verify: **Buttons disappear**

#### ✅ Test 3: Persistence Across Page Reload
1. With saved setting "provisioner-pipeline"
2. Refresh page (F5)
3. Verify: **Setting still shows "Provisioner Pipeline"** (no redeploy needed!)
4. Verify: **No unsaved indicator**

#### ✅ Test 4: Error Handling
1. Change setting to "CloudHub Native"
2. Disable network (DevTools Network tab → Offline)
3. Click "Save Changes"
4. Verify: **Red error box appears with error message**
5. Verify: **Save button remains clickable**
6. Enable network, retry
7. Verify: **Save succeeds**

#### ✅ Test 5: Discard Changes
1. Change setting
2. Verify: **Unsaved indicator appears**
3. Click "Cancel"
4. Verify: **Changes discarded, reverts to saved value**
5. Verify: **Unsaved indicator disappears**

#### ✅ Test 6: New Deployments Use New Setting
1. Save "provisioner-pipeline" setting
2. Start new SRI deployment (e.g., sri-detection)
3. Check generated helmfile in deployment
4. Verify: **Helm chart repo uses helm.symphonyfs.net** (from provisioner-pipeline)
5. Change back to "cloudhub-native"
6. Start another deployment
7. Verify: **Helm chart repo uses charts.symphonyai.com**

---

## Database Table Schema

The setting is persisted in this table:

```sql
CREATE TABLE platform_deployment_settings (
  id SERIAL PRIMARY KEY,
  sri_deploy_source VARCHAR(50) NOT NULL DEFAULT 'cloudhub-native',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(255)
);
```

**Allowed values for `sri_deploy_source`:**
- `cloudhub-native` - Uses charts.symphonyai.com
- `provisioner-pipeline` - Uses helm.symphonyfs.net

---

## Files Modified

### Frontend
- ✅ `plugins/platform-common/src/SriDeploySourceContext.tsx`
  - Added backend sync logic
  - Added state management (pendingSource, isSaving, saveError)
  - Added saveDeploySource() function
  - Uses useBackendFetch() hook

- ✅ `plugins/platform-home/src/components/AdminSettingsPage.tsx`
  - Added Save/Cancel buttons
  - Added error display
  - Added unsaved indicator
  - Added loading state UI

### Backend
- ✅ No changes needed - endpoints already exist!
  - `GET /settings/deployment` (line 3665)
  - `PUT /settings/deployment` (line 3682)

### Database
- ✅ No schema changes - column already exists
  - `platform_deployment_settings.sri_deploy_source`

---

## Implementation Details

### Context Provider
```typescript
<SriDeploySourceProvider>
  {children}
</SriDeploySourceProvider>
```

The provider:
1. Loads initial value from database (on app start)
2. Manages local state: deploySource, pendingSource
3. Syncs to backend on save
4. Syncs across tabs via storage events

### Hook Usage
```typescript
const {
  deploySource,      // Currently saved value
  pendingSource,     // Unsaved value (if any)
  isSaving,          // True while saving
  saveError,         // Error message (if any)
  setDeploySource,   // Change pending value
  saveDeploySource,  // Async save to backend
  discardChanges,    // Revert to saved
} = useSriDeploySource();
```

### Error Handling
Errors caught and displayed:
- Network errors
- HTTP errors (4xx, 5xx)
- Authentication failures
- Validation errors from backend

User can retry after fixing the issue.

---

## No Redeploy Required

✅ **Frontend changes take effect immediately:**
- SriDeploySourceContext is in-memory state
- No need to rebuild
- Changes persist in database
- Next deployment uses new setting

✅ **Runtime impact:**
- Setting read from database on each `deploySriPipeline()` call
- No caching of old value
- Instant switchover to new chart source

---

## Future Enhancements

Possible improvements:
1. Audit log with who changed the setting and when
2. Change preview (show what chart repo will be used)
3. Validation (test connection to chart repo before saving)
4. Rollback history (previous settings)
5. Notification to users about setting changes

---

## Troubleshooting

### Setting doesn't save
- **Check network tab:** Verify PUT request completes with 200 status
- **Check logs:** Backend should log "platform-settings-updated" action
- **Check DB:** Query `SELECT sri_deploy_source FROM platform_deployment_settings;`

### Deployments still use old chart source
- **After saving:** Wait a moment for state sync
- **Refresh page:** Ensure frontend loaded latest from backend
- **Check DB:** Verify setting was persisted
- **New deployment:** Always reads from database, not cache

### Error "sriDeploySource is required"
- **Cause:** Frontend sent empty value
- **Fix:** Select a valid option from dropdown before saving

### Error "sriDeploySource must be..." 
- **Cause:** Invalid value sent to backend
- **Fix:** Only "cloudhub-native" or "provisioner-pipeline" allowed

---

## Summary

✅ **What was built:**
- Backend persistence without needing to redeploy
- Explicit Save button with clear user feedback
- Error handling and recovery
- Unsaved state indicator
- Cross-tab synchronization

✅ **How to use:**
1. Go to Admin Settings
2. Change SRI Deploy Source dropdown
3. Click "Save Changes"
4. Verify success message
5. New deployments use the new setting immediately

✅ **No redeploy needed:**
- Frontend fetches setting from backend each time
- Database persists across restarts
- Setting takes effect immediately

---

## Contact

For issues or questions about this implementation:
- Check `/memories/session/sri-deploy-source-fix.md` for context
- Review backend endpoints in `router.ts` (line 3665+)
- Check `PlatformSettingsService` for database logic
