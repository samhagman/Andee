# Photo Album Buffering at Telegram Bot Level

## Overview

Implemented client-side buffering for Telegram photo albums to ensure all photos in an album are collected and sent to Claude as a single message. Previously, photos were being processed separately due to timing issues, causing Claude to only respond to some images in the album.

## Problem Statement

When sending a photo album to Andee, photos were processed separately instead of as a single combined message. Users reported Claude responding to "just the last image" or partial albums.

### Root Cause

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ORIGINAL FLOW (BROKEN)                                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  User sends 3-photo album                                               │
│         │                                                               │
│         ▼                                                               │
│  Telegram sends 3 separate webhooks (same media_group_id)               │
│         │                                                               │
│   ┌─────┴─────┬─────────────┐                                          │
│   ▼           ▼             ▼                                          │
│  Webhook 1   Webhook 2    Webhook 3    ← Arrive nearly simultaneously   │
│   │           │             │                                           │
│   ▼           ▼             ▼                                          │
│  Download    Download      Download    ← Variable timing (100-800ms)   │
│   │           │             │                                           │
│   ▼           ▼             ▼                                          │
│  POST /ask   POST /ask    POST /ask    ← Sent IMMEDIATELY after each   │
│                                            download completes           │
│               │                                                         │
│               ▼                                                         │
│  Persistent Server Buffer (500ms timeout)                               │
│               │                                                         │
│               └─► If photo 3 download takes >500ms after photo 1:       │
│                   Buffer flushes early! Photos split into separate      │
│                   messages to Claude.                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

The server-side buffering (500ms timeout) was too late in the pipeline. Download times varied, causing the buffer to flush before all photos arrived.

## Solution

Move buffering to the telegram-bot level, BEFORE downloading photos:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  NEW FLOW (FIXED)                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Telegram webhooks (1 per photo, same media_group_id)                   │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────────────────────────────────┐                           │
│  │  TELEGRAM BOT: Media Group Buffer       │                           │
│  │  • Stores file_ids (not image data)     │                           │
│  │  • 3s timeout, fixed from first photo   │                           │
│  │  • ctx.waitUntil() keeps worker alive   │                           │
│  └─────────────────────────────────────────┘                           │
│         │                                                               │
│         │ After 3s                                                      │
│         ▼                                                               │
│  Download all photos concurrently (Promise.allSettled)                  │
│         │                                                               │
│         ▼                                                               │
│  Single POST /ask with images: [img1, img2, img3, ...]                  │
│         │                                                               │
│         ▼                                                               │
│  Persistent server (NO buffering - just processes)                      │
│         │                                                               │
│         ▼                                                               │
│  Claude receives ONE message with all images                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Changes Made

### 1. claude-telegram-bot/src/index.ts

#### Added Buffer Types and Constants (lines 115-136)

```typescript
// Media group buffer for photo albums
interface BufferedPhoto {
  fileId: string;
  width: number;
  height: number;
  fileSize?: number;
}

interface MediaGroupBuffer {
  photos: BufferedPhoto[];
  caption?: string;
  chatId: number;
  senderId: string;
  isGroup: boolean;
  userMessageId: number;
  timer: ReturnType<typeof setTimeout>;
}

const mediaGroupBuffer = new Map<string, MediaGroupBuffer>();
const MEDIA_GROUP_FLUSH_DELAY_MS = 3000;  // Wait 3s after last photo
```

#### Added bufferAlbumPhoto() Function (lines 367-400)

```typescript
function bufferAlbumPhoto(
  mediaGroupId: string,
  photo: BufferedPhoto,
  caption: string | undefined,
  chatId: number,
  senderId: string,
  isGroup: boolean,
  userMessageId: number
): boolean {
  const existing = mediaGroupBuffer.get(mediaGroupId);

  if (existing) {
    existing.photos.push(photo);
    if (caption && !existing.caption) {
      existing.caption = caption;
    }
    console.log(`[${chatId}] [ALBUM] Buffered photo ${existing.photos.length} for ${mediaGroupId}`);
    return false;  // Not the first photo
  } else {
    mediaGroupBuffer.set(mediaGroupId, {
      photos: [photo],
      caption,
      chatId,
      senderId,
      isGroup,
      userMessageId,
      timer: null as unknown as ReturnType<typeof setTimeout>,
    });
    console.log(`[${chatId}] [ALBUM] Started buffer for ${mediaGroupId}`);
    return true;  // First photo
  }
}
```

#### Added flushMediaGroupBuffer() Function (lines 405-478)

Downloads all buffered photos concurrently and sends to worker:

```typescript
async function flushMediaGroupBuffer(
  mediaGroupId: string,
  env: Env
): Promise<void> {
  const buffer = mediaGroupBuffer.get(mediaGroupId);
  if (!buffer) return;

  mediaGroupBuffer.delete(mediaGroupId);

  // Download all photos concurrently
  const downloadResults = await Promise.allSettled(
    buffer.photos.map(async (photo) => {
      const { data, error } = await downloadTelegramFile(env.BOT_TOKEN, photo.fileId);
      // ... convert to base64, get media type ...
      return { base64, mediaType, fileId, width, height } as ImageData;
    })
  );

  const images = downloadResults
    .filter((r): r is PromiseFulfilledResult<ImageData> => r.status === "fulfilled")
    .map(r => r.value);

  // Send all images in one request
  await fireAndForgetPhotosToSandbox(env, buffer.chatId.toString(), images, ...);
}
```

#### Modified Photo Handler (lines 878-927)

```typescript
if (mediaGroupId) {
  // Only set reaction on first photo
  const isFirstPhoto = !mediaGroupBuffer.has(mediaGroupId);
  if (isFirstPhoto) {
    await botCtx.api.setMessageReaction(chatId, userMessageId, [
      { type: "emoji", emoji: "👀" },
    ]);
  }

  // Buffer the photo metadata
  const wasFirstPhoto = bufferAlbumPhoto(
    mediaGroupId,
    { fileId, width, height, fileSize },
    caption, chatId, senderId, isGroup, userMessageId
  );

  // For first photo, use ctx.waitUntil to keep worker alive
  if (wasFirstPhoto) {
    ctx.waitUntil(
      new Promise<void>((resolve) => {
        setTimeout(async () => {
          await flushMediaGroupBuffer(mediaGroupId, env);
          resolve();
        }, MEDIA_GROUP_FLUSH_DELAY_MS);
      })
    );
  }

  return;  // Don't process yet
}
```

### 2. claude-sandbox-worker/src/scripts/persistent-server.script.js

Removed all server-side buffering code:

```diff
- const mediaGroupBuffer = new Map();
- const MEDIA_GROUP_FLUSH_DELAY_MS = 500;

- function bufferMediaGroup(mediaGroupId, images, caption, context) { ... }
- function flushMediaGroup(mediaGroupId) { ... }

  // In /message endpoint:
- if (mediaGroupId && hasImages) {
-   const buffered = bufferMediaGroup(...);
-   if (buffered) { return; }
- }
```

Added comment explaining buffering now happens at bot level:

```javascript
// Add to queue - the generator will pick it up
// Note: Album buffering now happens at the telegram-bot level, so images arrive as a single batch
enqueueMessage({ text, botToken, chatId, userMessageId, workerUrl, senderId, isGroup, apiKey, images });
```

### 3. claude-sandbox-worker/src/handlers/ask.ts

Fixed "Argument list too long" error for large payloads (many images):

```diff
- const escapedPayload = messagePayload.replace(/'/g, "'\\''");
- const curlResult = await sandbox.exec(
-   `curl -s -X POST ... -d '${escapedPayload}'`
- );

+ // Write payload to temp file (avoids "Argument list too long" for large payloads)
+ await sandbox.writeFile("/tmp/message.json", messagePayload);
+ const curlResult = await sandbox.exec(
+   `curl -s -X POST ... -d @/tmp/message.json`
+ );
```

## Issues Encountered & Fixes

### Issue 1: setTimeout Not Firing in Workers

**Symptom**: First deployment got emoji reaction but no response.

**Cause**: Cloudflare Workers terminate after returning response. `setTimeout` callback never ran.

**Fix**: Use `ctx.waitUntil()` with a Promise that waits 3s, keeping the worker alive until flush completes.

### Issue 2: Argument List Too Long

**Symptom**: Logs showed `bash: /usr/bin/curl: Argument list too long` for 10-photo album.

**Cause**: Base64-encoded images passed as shell argument exceeded OS limit (~128KB-2MB).

**Fix**: Write payload to `/tmp/message.json`, use `curl -d @/tmp/message.json`.

## Verification

### Expected Log Output

```
[AUTH] User xxx sent photo in chat xxx (album: 14144830470422289)
[xxx] [PHOTO] Received photo: 4 variants, largest=964x1280
[xxx] [ALBUM] Started buffer for 14144830470422289
[xxx] [ALBUM] Buffered photo 2 for 14144830470422289
[xxx] [ALBUM] Buffered photo 3 for 14144830470422289
[xxx] [ALBUM] Flushing 3 photos for album 14144830470422289
[xxx] [ALBUM] Downloaded 3/3 photos
[xxx] [ALBUM] Sent 3 photos to worker
[xxx] Processing photo message (3 image(s), album: 14144830470422289)
```

### Persistent Server Log

```
MESSAGE received: chat=xxx +3 image(s) (album: 14144830470422289)
YIELD multimodal: text + 3 image(s)
```

## Files Modified

| File | Changes |
|------|---------|
| `claude-telegram-bot/src/index.ts` | +150 lines: Buffer types, bufferAlbumPhoto(), flushMediaGroupBuffer(), modified photo handler |
| `claude-sandbox-worker/src/scripts/persistent-server.script.js` | -60 lines: Removed bufferMediaGroup, flushMediaGroup, buffering logic |
| `claude-sandbox-worker/src/handlers/ask.ts` | +3 lines: Write to file, use `curl -d @file` |

## Deployment

```bash
cd claude-telegram-bot && npm run deploy
cd claude-sandbox-worker && npm run deploy
```

Both deployed successfully:
- telegram-bot: `797841dd-b36f-43e5-a400-cde237434c9c`
- sandbox-worker: `0d8c9aa2-b21d-476a-b8e3-b1e87922ee3b`

---

## Enhancement: Album Overflow Handling (2026-01-11)

### Problem

Telegram has a 10-photo limit per album. When users send >10 photos, Telegram splits them:
- First message: photos 1-10 (media_group_id="A", caption attached)
- Second message: photos 11+ (media_group_id="B" or NO media_group_id, no caption)

The original implementation buffered by `mediaGroupId`, so overflow photos were treated as separate messages. Claude only saw the last photo without the original context.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  OVERFLOW PROBLEM                                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  User sends 11 recipe photos with caption "Add all these recipes"       │
│                                                                         │
│  Telegram creates:                                                      │
│  • Album 1: 10 photos (media_group_id="A", has caption)                 │
│  • Overflow: 1 photo (media_group_id="B" or NONE, no caption)           │
│                                                                         │
│  Original buffer keyed by mediaGroupId:                                 │
│  ┌───────────┐   ┌───────────┐                                         │
│  │ Buffer[A] │   │ Buffer[B] │   ← SEPARATE buffers = SEPARATE flushes │
│  │ (10 pics) │   │ (1 pic)   │                                         │
│  └─────┬─────┘   └─────┬─────┘                                         │
│        │               │                                               │
│        ▼               ▼                                               │
│  Flush → Claude    Flush → Claude   ← Claude sees as SEPARATE messages │
│                                                                         │
│  Result: Claude only responds to the 1-photo message (no context!)      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Solution: Chat-Level Buffer with Overflow Detection

Changed buffer key from `mediaGroupId` to `chatId`. The buffer now catches overflow photos by checking if there's an active buffer for the chat.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  FIXED: CHAT-LEVEL BUFFER                                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Photo arrives:                                                         │
│  ├── Has mediaGroupId? ─────────────────────┐                          │
│  │   YES → Add to chatPhotoBuffer[chatId]   │                          │
│  │         Start/extend 3s window           ├──► BUFFER PATH           │
│  │                                          │                          │
│  ├── No mediaGroupId, buffer exists? ───────┘                          │
│  │   YES → Add to existing buffer (overflow!)                          │
│  │                                                                      │
│  └── No mediaGroupId, no buffer? ──────────────► IMMEDIATE PATH        │
│       Process photo right away (standalone)                            │
│                                                                         │
│  Result for 11 photos:                                                  │
│  ┌─────────────────────────────────────────────┐                       │
│  │     chatPhotoBuffer[chatId]                 │                       │
│  │  [10 album pics] + [1 overflow] = 11 total  │                       │
│  └───────────────────┬─────────────────────────┘                       │
│                      │                                                  │
│                      ▼                                                  │
│  Single flush → Claude sees ONE message with 11 images + caption        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Changes Made

#### Buffer Types (lines 115-137)

```typescript
// OLD: Buffer keyed by mediaGroupId
interface MediaGroupBuffer {
  photos: BufferedPhoto[];
  caption?: string;
  // ...
}
const mediaGroupBuffer = new Map<string, MediaGroupBuffer>();

// NEW: Buffer keyed by chatId, tracks multiple albums
interface ChatPhotoBuffer {
  photos: BufferedPhoto[];
  captions: string[];              // Collect ALL captions
  mediaGroupIds: Set<string>;      // Track all album IDs
  // ...
}
const chatPhotoBuffer = new Map<string, ChatPhotoBuffer>();
```

#### Buffer Function (bufferChatPhoto)

Key change: Takes `chatId` as key, `mediaGroupId` is optional (can be undefined for overflow).

```typescript
function bufferChatPhoto(
  chatId: string,                    // Now the key
  photo: BufferedPhoto,
  caption: string | undefined,
  mediaGroupId: string | undefined,  // Can be undefined for overflow
  // ...
): boolean {
  // Add to existing buffer or create new one
  // Track all mediaGroupIds in a Set for logging
  // Collect all captions (multiple albums might have captions)
}
```

#### Photo Handler (lines 895-955)

```typescript
// OLD: Only buffer if has mediaGroupId
if (mediaGroupId) { ... }

// NEW: Buffer if has mediaGroupId OR if buffer already exists (overflow)
const hasActiveBuffer = chatPhotoBuffer.has(chatId.toString());
if (mediaGroupId || hasActiveBuffer) {
  // Buffer this photo (even if it's overflow with no mediaGroupId)
  bufferChatPhoto(...);
}
```

### Expected Log Output (Overflow Scenario)

```
[123] [ALBUM] Started buffer for album 14144830470422289
[123] [ALBUM] Buffered photo 2 (album: 14144830470422289)
...
[123] [ALBUM] Buffered photo 10 (album: 14144830470422289)
[123] [ALBUM] Buffered photo 11 (overflow)  ← NEW: Caught without mediaGroupId!
[123] [ALBUM] Flushing 11 photos (albums: 14144830470422289)
[123] [ALBUM] Downloaded 11/11 photos
[123] [ALBUM] Sent 11 photos to worker
```

### Key Benefits

1. **Preserves fast single-photo processing** - Standalone photos (no active buffer) process immediately
2. **Catches all overflow scenarios** - Any photo arriving within 3s of an album joins the batch
3. **Minimal code change** - Same architecture, just different buffer key
4. **Multiple captions combined** - If overflow photos have captions, they're joined with `\n`

### Deployment

```bash
cd claude-telegram-bot && npm run deploy
```

Only telegram-bot needs redeployment - sandbox-worker unchanged.
