# Fix: Messages Swallowed While Andee Responds

## Overview

Fixed a critical bug where messages sent while Andee was responding would be "swallowed" - they were queued but never processed. The root cause was twofold:

1. **SDK's `query()` stops after yielding "result"** - It's designed for single-turn interactions
2. **`prompt` parameter format** - SDK requires an async generator, not a static object

## Problem Statement

When sending multiple messages to Andee (e.g., a single photo then a photo album), only the first message received a response. The second message was queued but the queue was never drained.

### Root Cause Analysis

```
┌─────────────────────────────────────────────────────────────────────────┐
│  THE BUG: SDK's query() STOPS after yielding "result"                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ORIGINAL CODE:                                                         │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │  for await (const msg of query({                            │       │
│  │    prompt: messageGenerator(),  ← Infinite generator        │       │
│  │    options: { ... }                                          │       │
│  │  })) {                                                       │       │
│  │    if (msg.type === "result") {                             │       │
│  │      // Handle result - send to Telegram                    │       │
│  │    }                                                         │       │
│  │  }                                                           │       │
│  │  // ← CODE REACHES HERE after first result!                 │       │
│  │  // ← runQueryLoop() returns                                │       │
│  │  // ← Server still running but queue ORPHANED               │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                         │
│  ASSUMPTION: query() keeps pulling from generator after each result    │
│  REALITY: query() STOPS after yielding "result" (SDK design)           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Solution

### 1. Add outer `while(true)` loop around `query()`

```javascript
async function runQueryLoop(initialSessionId) {
  let currentSessionId = initialSessionId;

  // Outer loop: process messages forever
  while (true) {
    const msg = await waitForNextMessage();  // ← BLOCKS HERE until message arrives

    // ... build content ...

    for await (const event of query({...})) {
      // ... handle events ...
      if (event.type === "result") {
        // ... send to Telegram ...
      }
    }
    // query() done → loop back to waitForNextMessage()
  }
}
```

### 2. Use async generator for `prompt` parameter

**Key discovery**: The SDK requires an async generator for the `prompt` parameter, even for single messages. Passing a static object causes the SDK to hang forever.

```javascript
// WRONG - hangs forever
const queryGenerator = query({
  prompt: { role: "user", content },
  options: queryOptions
});

// WRONG - also hangs (different format)
const queryGenerator = query({
  prompt: { type: "user", message: { role: "user", content } },
  options: queryOptions
});

// CORRECT - use async generator
async function* singleMessageGenerator() {
  yield { type: "user", message: { role: "user", content } };
}
const queryGenerator = query({
  prompt: singleMessageGenerator(),
  options: queryOptions
});
```

## Message Flow (Fixed)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  FIXED FLOW: while(true) around query()                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Message 1: "Single photo"                                              │
│       │                                                                 │
│       ▼                                                                 │
│  POST /message → enqueueMessage() → waitForNextMessage() resolves       │
│       │                                                                 │
│       ▼                                                                 │
│  query(singleMessageGenerator()) → Claude processes                     │
│       │                                                                 │
│       ▼                                                                 │
│  query() yields "result" → Telegram gets response ✓                     │
│       │                                                                 │
│       ▼                                                                 │
│  query() EXITS → while(true) LOOPS BACK                                 │
│       │                                                                 │
│       ▼                                                                 │
│  waitForNextMessage() → Message 2 already queued!                       │
│       │                                                                 │
│       ▼                                                                 │
│  query(singleMessageGenerator()) → Claude processes                     │
│       │                                                                 │
│       ▼                                                                 │
│  Telegram gets response ✓                                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Files Modified

| File | Changes |
|------|---------|
| `claude-sandbox-worker/src/scripts/persistent-server.script.js` | Restructured runQueryLoop(), removed messageGenerator(), added singleMessageGenerator() |

## Key Code Changes

### Removed: `messageGenerator()` async generator

The old infinite generator that yielded messages forever is no longer needed.

### Added: `singleMessageGenerator()` per-message generator

```javascript
async function* singleMessageGenerator() {
  yield { type: "user", message: { role: "user", content } };
}
```

### Added: Helper functions

- `writeContextFile(msg)` - Write context for skill scripts
- `updateR2Session(sessionId, msg)` - Update R2 session after response
- `buildContent(msg)` - Build multimodal content from message

### Restructured: `runQueryLoop()`

Changed from:
```javascript
for await (const event of query({ prompt: messageGenerator(), ... })) {
  // handle event
}
// EXITS AFTER FIRST RESULT
```

To:
```javascript
while (true) {
  const msg = await waitForNextMessage();
  // ... build content and options ...

  async function* singleMessageGenerator() {
    yield { type: "user", message: { role: "user", content } };
  }

  for await (const event of query({ prompt: singleMessageGenerator(), ... })) {
    // handle event
  }
  // LOOPS BACK to waitForNextMessage()
}
```

## Verification

### Test Log Output (Multiple Messages While Busy)

```
[16:07:26.749Z] MESSAGE received: text=What is 2+2?...
[16:07:26.751Z] LOOP processing: What is 2+2?...
[16:07:27.166Z] MESSAGE received: text=What is 3+3?...  ← ARRIVED WHILE BUSY!
[16:07:30.567Z] COMPLETE cost=$0.0074 chars=1
[16:07:31.090Z] TELEGRAM_SENT
[16:07:33.095Z] LOOP iteration complete, waiting for next message...
[16:07:33.095Z] LOOP processing: What is 3+3?...        ← PICKED UP FROM QUEUE!
[16:07:36.986Z] COMPLETE cost=$0.0090 chars=1
[16:07:37.458Z] TELEGRAM_SENT
[16:07:39.463Z] LOOP waiting for message...             ← READY FOR MORE
```

Both messages processed successfully. The second message was queued while Claude was responding to the first, then picked up automatically.

## Why This Works

1. **Outer `while(true)`** never exits - server keeps processing messages forever
2. **`waitForNextMessage()`** blocks until a message arrives (efficient, no busy-wait)
3. **Session resumption** (`resume: sessionId`) maintains conversation context
4. **Async generator format** satisfies SDK's expected prompt type
5. **Queue is never orphaned** - after each result, loop returns to drain queue

## Debugging Journey

The fix required understanding two separate issues:

1. **First issue (expected)**: The loop was exiting after the first result
   - Fix: Add outer `while(true)` loop

2. **Second issue (unexpected)**: The SDK hung when given a static object for `prompt`
   - Symptom: Generator created but first `.next()` call hung forever
   - Root cause: SDK expects an async generator, not a static object
   - Fix: Wrap content in a simple async generator

The debugging logs added during investigation:
- `ENV_CHECK HOME=/home/claude ANTHROPIC_API_KEY=SET` - Verified env vars
- `QUERY_CALL about to invoke query()` - Confirmed reaching query call
- `QUERY_GENERATOR created, entering for-await loop` - Confirmed generator created
- `GENERATOR yielding single message` - Confirmed generator was called

These proved the SDK was receiving correct inputs but hanging during iteration.

## Deployment

```bash
cd claude-sandbox-worker && npx wrangler deploy
```

Only sandbox-worker needs redeployment - telegram-bot unchanged.
