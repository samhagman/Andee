# Testing Snapshot Restore in Production IDE

## Quick Test Steps

1. **Open Production IDE**: https://andee-ide.pages.dev
2. **Enter API Key**: `adk_8dfeed669475a5661b976ff13249c20c` (prompted on first load)
3. **Select TEST_USER_1** from the sandbox dropdown
4. **Open Browser DevTools** (F12 or Cmd+Option+I)
5. **Go to Network Tab** and filter for "restore"
6. **Click the snapshot button** (📷 icon) in the IDE
7. **Click "Restore"** on any snapshot
8. **Monitor the Network Tab** for the `/restore` request

## Expected Behavior

### Success Case
- Network request: `POST /restore` returns **200 OK**
- Response body: `{"success":true,"restoredFrom":"snapshots/..."}`
- File tree refreshes automatically
- No error modals appear

### Failure Case (Before Fix)
- Network request: `POST /restore` returns **500** or **503**
- Response body: `{"error":"Unable to wake sandbox for restore"}`
- Error modal appears in IDE

### Failure Case (After Fix - Retry Logic)
- Network request: `POST /restore` may take longer (up to ~15 seconds)
- Multiple retry attempts visible in Network tab
- Eventually succeeds with **200 OK** or fails with **503** and helpful error message

## What to Look For

### Network Tab
1. **Request Headers**: Should include `X-API-Key: adk_...`
2. **Request Payload**: Should include `chatId`, `senderId`, `snapshotKey`
3. **Response Status**: 200 = success, 503 = retry exhausted
4. **Response Time**: May take 5-15 seconds if sandbox is sleeping (retry logic)

### Console Tab
- Look for `[IDE] Restoring snapshot: ...` messages
- Check for any error messages
- Should see `[IDE] Restore successful` on success

### Application Tab
- Check localStorage for `andee-ide-api-key`
- Should contain the API key

## Manual API Test (Alternative)

If UI testing doesn't work, test directly via curl:

```bash
# Get a snapshot key first
SNAPSHOT_KEY=$(curl -s "https://claude-sandbox-worker.samuel-hagman.workers.dev/snapshots?chatId=999999999&senderId=999999999&isGroup=false" \
  -H "X-API-Key: adk_8dfeed669475a5661b976ff13249c20c" | \
  jq -r '.snapshots[0].key')

# Test restore
curl -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/restore" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: adk_8dfeed669475a5661b976ff13249c20c" \
  -d "{\"chatId\":\"999999999\",\"senderId\":\"999999999\",\"isGroup\":false,\"snapshotKey\":\"$SNAPSHOT_KEY\",\"markAsLatest\":false}" \
  --max-time 120
```

## Debugging Tips

1. **If restore fails**: Check if sandbox needs restart first
   ```bash
   curl -X POST "https://claude-sandbox-worker.samuel-hagman.workers.dev/restart" \
     -H "Content-Type: application/json" \
     -H "X-API-Key: adk_8dfeed669475a5661b976ff13249c20c" \
     -d '{"chatId":"999999999","senderId":"999999999","isGroup":false}'
   ```

2. **Check sandbox health**: Look for `[Snapshot] Sandbox has X process(es) running` in logs
3. **Monitor retry attempts**: Should see up to 3 attempts with exponential backoff

## Changes Deployed

- Added 500ms delay after `listProcesses()` to allow sandbox to fully wake
- Improved retry logic: 3 attempts with exponential backoff (1s, 2s, 4s)
- Better error message: suggests using `/restart` endpoint if all attempts fail
- Status code changed from 500 to 503 for retry exhaustion (more appropriate)
