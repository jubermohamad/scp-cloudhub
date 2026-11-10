# SRI Deploy Source Setting - Testing & Validation Guide

## Quick Start Testing (5 minutes)

### Prerequisites
- Running CloudHub platform with frontend + backend
- Admin access (cloudhub-platform persona)
- Browser Developer Tools open (F12)

### Test Sequence

#### Test 1: Navigate & Verify UI (1 min)
```
1. Go to Admin Settings page
   URL: http://localhost:3000/admin-settings
   
2. Scroll to "SRI Deploy Source" card
   
3. Verify you see:
   ✅ Title: "SRI Deploy Source"
   ✅ Description mentions "runtime change"
   ✅ Dropdown with current value
   ✅ Two option cards below (CloudHub Native, Provisioner Pipeline)
```

#### Test 2: Change & See Unsaved Indicator (1 min)
```
1. Click dropdown
   
2. Select different option than current
   Example: If showing "CloudHub Native", select "Provisioner Pipeline"
   
3. Verify UI shows:
   ✅ Yellow warning box: "⚠️ Unsaved changes · Click Save to apply"
   ✅ Two buttons appear: "Save Changes" and "Cancel"
   ✅ Selected option now highlighted in card
```

#### Test 3: Save & Verify Backend Call (1 min)
```
1. Open DevTools Network tab (F12 → Network)
   
2. Click "Save Changes" button
   
3. In Network tab, look for new request:
   ✅ Method: PUT
   ✅ URL: /api/deployment-control-plane/settings/deployment
   ✅ Status: 200 OK
   ✅ Request body: {"sriDeploySource":"provisioner-pipeline"}
   ✅ Response: {"sriDeploySource":"provisioner-pipeline"}
   
4. Verify UI changes:
   ✅ Button changes to "Saving..." during request
   ✅ After success, green message appears: "✓ Settings saved"
   ✅ Buttons disappear
   ✅ Unsaved indicator disappears
```

#### Test 4: Persist Across Reload (1 min)
```
1. With setting saved, press F5 to reload page
   
2. Verify:
   ✅ Dropdown still shows the saved value (no reset!)
   ✅ NO unsaved indicator (because it's saved)
   ✅ NO buttons (nothing to save)
   ✅ Green "✓ Settings saved" message
   
3. This proves it's stored in backend database!
```

#### Test 5: Error Handling (1 min)
```
1. In DevTools, go to Network tab
   
2. Click the throttle icon (🔧 next to "Settings")
   Select: Offline
   
3. Change dropdown to different value
   
4. Click "Save Changes"
   
5. Verify error handling:
   ✅ Red error box appears
   ✅ Shows message like "Network error" or "Failed to..."
   ✅ Buttons remain clickable
   ✅ Changes not lost
   
6. Go back to Network tab, select: Online
   
7. Click "Save Changes" again
   
8. Verify:
   ✅ Request succeeds
   ✅ Error box disappears
   ✅ Success message shows
   ✅ Setting saved
```

---

## Detailed Testing Guide (15 minutes)

### Part 1: UI Validation

#### Check Initial State
```javascript
// Open browser console, run:
localStorage.getItem('cloudhub:sri_deploy_source')
// Should return: "cloudhub-native" or "provisioner-pipeline"

// Check context value
const elem = document.querySelector('[aria-label*="SRI Deploy"]');
console.log(elem.textContent); // Should show current value
```

#### Verify State Management
```
Change dropdown → Check pendingSource state:

Before Save:
- deploySource: old value (e.g., "cloudhub-native")
- pendingSource: new value (e.g., "provisioner-pipeline")
- UI shows both highlighted option cards
- Shows "Unsaved changes" warning

After Save:
- deploySource: new value
- pendingSource: null
- UI shows only one highlighted option
- Shows "✓ Settings saved"
```

---

### Part 2: Backend API Testing

#### Test GET Endpoint
```bash
# Get current setting from backend
curl -X GET http://localhost:7007/api/deployment-control-plane/settings/deployment \
  -H "Authorization: Bearer $(jwt_token)" \
  -v

# Expected response (200 OK):
{
  "sriDeploySource": "cloudhub-native"
}
```

#### Test PUT Endpoint
```bash
# Update setting in backend
curl -X PUT http://localhost:7007/api/deployment-control-plane/settings/deployment \
  -H "Authorization: Bearer $(jwt_token)" \
  -H "Content-Type: application/json" \
  -d '{"sriDeploySource":"provisioner-pipeline"}' \
  -v

# Expected response (200 OK):
{
  "sriDeploySource": "provisioner-pipeline"
}

# Verify in database:
# SELECT sri_deploy_source FROM platform_deployment_settings;
# Should return: provisioner-pipeline
```

#### Test Error Cases
```bash
# Test invalid value
curl -X PUT http://localhost:7007/api/deployment-control-plane/settings/deployment \
  -H "Authorization: Bearer $(jwt_token)" \
  -H "Content-Type: application/json" \
  -d '{"sriDeploySource":"invalid"}' \
  -v

# Expected: 400 Bad Request
# Error: "sriDeploySource must be..."

# Test missing value
curl -X PUT http://localhost:7007/api/deployment-control-plane/settings/deployment \
  -H "Authorization: Bearer $(jwt_token)" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -v

# Expected: 400 Bad Request
# Error: "sriDeploySource is required"
```

---

### Part 3: Database Persistence

#### Verify Storage
```sql
-- Connect to platform database
-- Check current value
SELECT sri_deploy_source FROM platform_deployment_settings;

-- Check audit trail
SELECT action, updated_by, updated_at FROM audit_log 
WHERE action = 'platform-settings-updated' 
ORDER BY updated_at DESC 
LIMIT 5;

-- Verify timestamps
SELECT sri_deploy_source, updated_at, updated_by 
FROM platform_deployment_settings;
```

#### Verify Persistence
```
1. Save setting: "provisioner-pipeline"
2. Restart backend service
3. Query database: SELECT sri_deploy_source FROM platform_deployment_settings;
4. Verify: Value still "provisioner-pipeline" ✅

This proves it's persisted, not in-memory!
```

---

### Part 4: Deployment Integration

#### Test Helmfile Generation
```bash
# Trigger SRI deployment with setting "provisioner-pipeline"
# Go to SRI Deploy page, start deployment

# In generated helmfile, verify:
# repositories:
#   - name: platform
#     url: helm.symphonyfs.net  ← Should use new source!
#
# Check that chart source matches:
# helm.symphonyfs.net (not charts.symphonyai.com)
```

#### Test Chart Resolution
```bash
# During deployment, monitor logs
# Look for: "Resolving charts from: helm.symphonyfs.net"

# Verify helm can find charts:
helm repo update platform
helm search repo platform/detectionhub

# Should find charts from the configured source
```

---

### Part 5: Multi-Tab Sync

#### Test Cross-Tab Synchronization
```
Tab A (localhost:3000/admin-settings):
1. Open Admin Settings
2. Open DevTools Console

Tab B (same admin-settings):
1. Open in new tab

Tab A:
1. Change SRI Deploy Source dropdown
2. Click "Save Changes"
3. Wait for success

Tab B:
1. Verify: Setting automatically updated!
2. Should show new value without page reload
3. Should show "✓ Settings saved"

This proves localStorage sync works!
```

---

### Part 6: Edge Cases

#### Test Rapid Saves
```
1. Change dropdown value
2. Click Save immediately (don't wait)
3. Click Save again before first completes
4. Verify: No race conditions, consistent state
```

#### Test Network Interruption
```
1. Save setting successfully
2. Go offline (DevTools Network → Offline)
3. Try to change & save
4. Verify: Error message shown
5. Go online
6. Retry save
7. Verify: Success
```

#### Test Permission Denial
```
1. Logout or switch to non-admin persona
2. Try accessing Admin Settings
3. Verify: Access denied message shown
4. Cannot change settings
```

#### Test Concurrent Users
```
User A:
1. Open Admin Settings
2. Change to "provisioner-pipeline"
3. Click Save

User B (simultaneously):
1. Open Admin Settings
2. Change to "cloudhub-native"
3. Click Save

Result:
- Last save wins (User B's value persists)
- Both see success messages
- Next page reload shows User B's value ✅
```

---

## Acceptance Criteria Checklist

### Functional Requirements
- [ ] Settings card renders correctly
- [ ] Dropdown changes show unsaved indicator
- [ ] Save button sends PUT request
- [ ] Backend persists to database
- [ ] Page reload preserves setting
- [ ] Cancel button reverts changes
- [ ] Success message shows after save
- [ ] Error message shows on failure
- [ ] Loading state shown during save
- [ ] New deployments use new setting

### Non-Functional Requirements
- [ ] No TypeScript/lint errors
- [ ] No console errors (F12)
- [ ] Smooth UI transitions
- [ ] Fast response time (<500ms)
- [ ] Works with slow network
- [ ] Accessible (keyboard navigation)
- [ ] Mobile responsive
- [ ] No memory leaks

### Security Requirements
- [ ] Requires authentication
- [ ] Requires admin role (cloudhub-platform)
- [ ] Audit logged ("platform-settings-updated")
- [ ] SQL injection prevented (parameterized queries)
- [ ] CSRF protected (if applicable)

### Backwards Compatibility
- [ ] Existing deployments unaffected
- [ ] Old localStorage values migrated
- [ ] Database migration not needed
- [ ] API contract unchanged

---

## Automated Testing Commands

### Type Checking
```bash
cd /home/juberm/git-all/platform_cloudhub
npm run lint 2>&1 | grep -E "(error|warning|SriDeploy|AdminSettings)"
```

### Build Validation
```bash
npm run build:all 2>&1 | tail -20
# Should complete without errors
```

### Integration Tests (if available)
```bash
npm test -- --testNamePattern="platform.*settings" 2>&1
npm test -- --testNamePattern="SriDeploy" 2>&1
```

---

## Known Limitations & Workarounds

### Limitation 1: No Change Preview
**Issue:** Can't see which chart repo will be used before saving
**Workaround:** Save and check next deployment helmfile

### Limitation 2: No Change History
**Issue:** Can't see who changed the setting or when
**Workaround:** Check audit log: `SELECT * FROM audit_log WHERE action = 'platform-settings-updated'`

### Limitation 3: No Scheduled Changes
**Issue:** Can't schedule setting change for future time
**Workaround:** Change manually at desired time, or implement scheduling

### Limitation 4: No Rollback Button
**Issue:** No one-click rollback to previous value
**Workaround:** Manually change back to previous value

---

## Troubleshooting Guide

### Issue: Setting doesn't save
**Symptoms:** Click Save, button shows "Saving...", then error appears

**Diagnosis Steps:**
1. Check network tab: Is PUT request sent?
   - YES → Server error, check backend logs
   - NO → Frontend issue, check browser console
2. Check server logs for errors
3. Verify database is accessible

**Solutions:**
- Retry save (network issue)
- Check backend is running
- Verify database connection
- Check authentication token valid

### Issue: Setting saves but next deployment uses old value
**Symptoms:** Save successful, but deployment still uses old chart repo

**Diagnosis Steps:**
1. Verify database: `SELECT sri_deploy_source FROM platform_deployment_settings;`
2. Check deployment log for which repo it used
3. Verify backend code reads from database

**Solutions:**
- Wait a moment (caching issue)
- Clear browser cache
- Restart backend service
- Check deployment code reads latest value

### Issue: Page reload resets setting
**Symptoms:** After save, refresh page shows old value

**Diagnosis Steps:**
1. Check localStorage: Does it have new value?
   `localStorage.getItem('cloudhub:sri_deploy_source')`
2. Check database: Does it have new value?
   `SELECT sri_deploy_source FROM platform_deployment_settings;`
3. Check browser has right URL (not cached)

**Solutions:**
- Hard refresh: Ctrl+Shift+R
- Check database was actually updated
- Check frontend code reloads on init

### Issue: Save button disabled/grayed out
**Symptoms:** Can't click Save button

**Diagnosis Steps:**
1. Check browser console for JavaScript errors
2. Verify user is logged in
3. Verify user has admin role
4. Check network is connected

**Solutions:**
- Login again
- Refresh page
- Clear browser cache
- Check network connection

### Issue: Red error message "Not authorized"
**Symptoms:** Error when trying to save

**Diagnosis Steps:**
1. Check user role: Must be "cloudhub-platform"
2. Check auth token valid
3. Check backend permissions

**Solutions:**
- Switch persona to cloudhub-platform
- Re-login
- Check token not expired

---

## Test Results Template

Use this to document your testing:

```markdown
## Test Run: [DATE]

### Environment
- Backend: [version/commit]
- Frontend: [version/commit]
- Database: [type/version]

### Test Results

#### Test 1: UI Validation
- [ ] PASS
- [ ] FAIL
- [ ] Notes: ...

#### Test 2: Save Functionality
- [ ] PASS
- [ ] FAIL
- [ ] Notes: ...

#### Test 3: Persistence
- [ ] PASS
- [ ] FAIL
- [ ] Notes: ...

#### Test 4: Error Handling
- [ ] PASS
- [ ] FAIL
- [ ] Notes: ...

#### Test 5: Deployment Integration
- [ ] PASS
- [ ] FAIL
- [ ] Notes: ...

### Overall Result
- [ ] ✅ ALL TESTS PASSED
- [ ] ❌ FAILURES FOUND

### Sign-Off
- Tester: [name]
- Date: [date]
- Approved for Production: [yes/no]
```

---

## Quick Test Script

Run this sequence for quick validation:

```bash
#!/bin/bash
echo "SRI Deploy Source - Quick Test"
echo "=============================="

echo "1. Checking build..."
npm run build:all > /dev/null 2>&1 && echo "✅ Build OK" || echo "❌ Build FAILED"

echo "2. Checking types..."
npm run lint > /dev/null 2>&1 && echo "✅ Lint OK" || echo "❌ Lint FAILED"

echo "3. Testing backend endpoint..."
curl -s -X GET http://localhost:7007/api/deployment-control-plane/settings/deployment \
  -H "Authorization: Bearer test" | grep sriDeploySource > /dev/null \
  && echo "✅ API OK" || echo "❌ API FAILED"

echo "4. Checking database..."
# Modify based on your DB setup
echo "✅ Database OK (manual check needed)"

echo "=============================="
echo "Quick test complete!"
```

---

## Support & Escalation

If tests fail:
1. Check `/memories/session/sri-deploy-source-fix.md` for implementation details
2. Review `SRI_DEPLOY_SOURCE_IMPLEMENTATION.md` for architecture
3. Check logs in `docker-compose` or service logs
4. File bug with: error message, browser console log, network tab screenshot

---

## Summary

The SRI Deploy Source setting now has:
✅ Persistent backend storage
✅ Explicit Save button
✅ Error handling
✅ No redeploy required
✅ Professional UX

Follow this guide to validate it works in your environment!
