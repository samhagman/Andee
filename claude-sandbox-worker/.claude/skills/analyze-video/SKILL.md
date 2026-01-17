---
name: analyze-video
description: Analyze video files using Gemini API (native video upload). Use when a message contains video that needs analysis. The media-context block tells you when to use this skill.
---

# Analyze Video

Use this skill to analyze video files. Since most LLMs can't process video natively, this skill sends the video to Gemini (via OpenRouter) for analysis.

## When to Use

- When `<media-context>` shows a video attachment
- User asks "what happens in this video?"
- User asks about content, timestamps, or events in a video
- User sends a video with a question or request about its content

## How to Use

```bash
# Analyze a video file
bun /home/claude/.claude/skills/analyze-video/scripts/analyze-video.ts \
  "/media/123/456/videos/abc.mp4" \
  "Summarize what happens in this video"

# Ask specific questions
bun /home/claude/.claude/skills/analyze-video/scripts/analyze-video.ts \
  "/media/123/456/videos/abc.mp4" \
  "What text appears on screen at any point?"

# Identify objects or people
bun /home/claude/.claude/skills/analyze-video/scripts/analyze-video.ts \
  "/media/123/456/videos/abc.mp4" \
  "Describe the key events and any people shown"
```

## Example Workflow

1. User sends: [video] + "What's in this video?"
2. You receive message with `<media-context>` showing video path
3. Run: `bun /home/claude/.claude/skills/analyze-video/scripts/analyze-video.ts <path> "Describe the content of this video"`
4. Script calls Gemini API, returns description
5. You respond with the video summary

## Understanding the Media Context Block

For videos, the `<media-context>` block shows:

```xml
<media-context hidden="true">
This message includes media that requires analysis to respond properly.

Media attached:
  - [video] path=/media/123/456/videos/abc.mp4

To analyze this media, use the analyze-video skill:
  bun /home/claude/.claude/skills/analyze-video/scripts/analyze-video.ts "<path>" "<your question>"

Run the script with an appropriate question based on what the user is asking.
</media-context>
```

## Limitations

- **Max video size**: 50MB (larger videos will be rejected)
- **Max duration**: ~5 minutes recommended for best results
- **Processing time**: 30-60 seconds typical
- **Supported formats**: MP4, MOV, AVI, WebM, MKV

## Important Notes

- Always use the exact file path from the media-context block
- Choose analysis prompts that match what the user is asking
- For very long videos, consider asking about specific parts
- The script outputs text directly - use it in your response
- For images/photos, use the `analyzing-media` skill instead
