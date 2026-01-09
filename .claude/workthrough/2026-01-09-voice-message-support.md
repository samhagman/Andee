# Voice Message Support for Telegram Bot

## Overview
Added voice message transcription support to Andee, allowing users to send voice notes via Telegram which are automatically transcribed using Cloudflare Workers AI (Whisper) and processed by Claude like normal text messages.

## Context
- **Problem/Requirement**: Users wanted to interact with Andee via voice notes instead of typing
- **Initial State**: Bot only handled `message:text` events, no audio processing capability
- **Approach**: Leverage Cloudflare Workers AI Whisper model for speech-to-text, keeping the architecture clean with transcription at the edge

## Changes Made

### 1. Type Definitions
- **Description**: Extended API types to support voice messages
- **Files Modified**:
  - `shared/types/api.ts` - Made `message` optional, added `audioBase64?` and `audioDurationSeconds?` fields
- **Key Points**:
  - Validation rule: Either `message` XOR `audioBase64` must be present
  - Base64 encoding used for simplicity (voice notes are small ~200KB/min)

### 2. Workers AI Configuration
- **Description**: Added Whisper speech-to-text binding
- **Files Modified**:
  - `claude-sandbox-worker/src/types.ts` - Added `AI: Ai` to Env interface
  - `claude-sandbox-worker/wrangler.toml` - Added `[ai] binding = "AI"`
- **Rationale**: Cloudflare Workers AI provides managed Whisper at $0.0005/audio-minute

### 3. Transcription Logic
- **Description**: Added audio transcription before Claude processing
- **Files Modified**:
  - `claude-sandbox-worker/src/handlers/ask.ts` - Added `transcribeAudio()` function and voice handling in `handleAsk()`
- **Key Points**:
  - Detailed logging at each step with `[VOICE]` prefix
  - Error handling with user-friendly Telegram error messages
  - Transcribed text treated identically to typed text

### 4. Telegram Bot Voice Handler
- **Description**: Added Grammy handler for voice messages
- **Files Modified**:
  - `claude-telegram-bot/src/index.ts` - Added `downloadTelegramFile()`, `fireAndForgetVoiceToSandbox()`, and `bot.on("message:voice")` handler
- **Key Points**:
  - Downloads OGG/OPUS voice file from Telegram API
  - Base64 encodes and forwards to sandbox-worker
  - Same fire-and-forget pattern as text messages

## Code Examples

### Transcription Function
```typescript
// claude-sandbox-worker/src/handlers/ask.ts
async function transcribeAudio(
  ai: Ai,
  audioBase64: string,
  chatId: string
): Promise<{ text: string; error?: string }> {
  const startTime = Date.now();
  console.log(`[${chatId}] [VOICE] Starting transcription, audio size: ${audioBase64.length} base64 chars`);

  const result = await ai.run("@cf/openai/whisper-large-v3-turbo", {
    audio: audioBase64,
  });

  const elapsed = Date.now() - startTime;
  console.log(`[${chatId}] [VOICE] Whisper API returned in ${elapsed}ms`);

  return { text: (result as { text?: string }).text?.trim() || "" };
}
```

### Voice Message Handler
```typescript
// claude-telegram-bot/src/index.ts
bot.on("message:voice", async (botCtx) => {
  const voice = botCtx.message.voice;

  // Download voice file from Telegram
  const { data } = await downloadTelegramFile(env.BOT_TOKEN, voice.file_id);

  // Convert to base64
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const audioBase64 = btoa(binary);

  // Forward to sandbox-worker for transcription + Claude processing
  await fireAndForgetVoiceToSandbox(env, chatId, audioBase64, voice.duration, ...);
});
```

## Verification Results

### Production Testing
```
POST /ask - Voice received
[999999999] [VOICE] Received voice message: duration=3s, base64_length=245536
[999999999] [VOICE] Starting transcription, audio size: 245536 base64 chars (~180 KB)
[999999999] [VOICE] Whisper API returned in 904ms, result keys: transcription_info, segments, vtt, text, word_count
[999999999] [VOICE] Transcription successful: "Hello Andy, this is a voice message test. Can you hear me clearly?"
[999999999] [VOICE] Transcription complete, passing to Claude
[999999999] Processing voice message (senderId: 999999999, isGroup: false)
[Worker] Message queued: {"queued":true,"queueLength":1}
```

### Manual Testing
- [x] Health checks pass on both services
- [x] Text messages still work (smoke test)
- [x] Voice message transcription works (904ms latency)
- [x] Transcribed text passed to Claude correctly
- [x] Session updated after processing

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  VOICE MESSAGE FLOW                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Voice Note ──► Grammy downloads OGG ──► Base64 encode                     │
│                                                   │                         │
│                                                   ▼                         │
│                              POST /ask { audioBase64: "..." }               │
│                                                   │                         │
│                                                   ▼                         │
│                        Workers AI (whisper-large-v3-turbo)                  │
│                             ~900ms, $0.0005/min                             │
│                                                   │                         │
│                                                   ▼                         │
│                              Transcribed text ──► Claude                    │
│                                                   │                         │
│                                                   ▼                         │
│                              Response ──► Telegram                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Issues Encountered & Solutions

### Issue 1: TypeScript Type Error
**Error**: Workers AI expected `audio` as string, not number array
**Solution**: Pass base64 string directly to Whisper API (documentation confirmed this format)

### Issue 2: Curl Shell Variable Expansion
**Problem**: Complex variable expansion in bash commands failed
**Solution**: Used file-based approach (`-d @/tmp/request.json`) for reliable testing

## Next Steps
- [ ] Consider adding audio file support (MP3, WAV attachments)
- [ ] Add language detection/specification option
- [ ] Consider showing transcription to user (optional transparency mode)
- [ ] Monitor Whisper costs in production

## Notes
- Voice notes are OGG/OPUS format from Telegram (~120-200KB/minute)
- Whisper auto-detects language (multilingual support built-in)
- Base64 overhead is ~33% but negligible for voice note sizes
- Test user transformer mocks Telegram API calls for testing

## References
- Cloudflare Workers AI Whisper docs
- Grammy voice message handling
