---
name: analyzing-media
description: Analyze images or media files using Claude vision. Use when a message contains media that needs analysis. The media-context block tells you when and how to use this skill.
---

# Analyzing Media

Use this skill to analyze images when the user's message includes media.

## When to Use

When you see a `<media-context>` block in the message, it means:
- The user sent an image/photo with their message
- The image has been saved to disk at the specified path
- You should analyze it using this skill to respond appropriately

## How to Use

```bash
# Analyze an image with a specific question
bun /home/claude/.claude/skills/analyzing-media/scripts/analyze-image.ts \
  "/media/123/456/photos/abc123.jpg" \
  "What UI pattern is shown in this image?"

# General analysis
bun /home/claude/.claude/skills/analyzing-media/scripts/analyze-image.ts \
  "/media/123/456/photos/abc123.jpg" \
  "Describe this image in detail"
```

## Example Workflow

1. User sends: [photo] + "Save this to my UI Patterns list"
2. You receive message with `<media-context>` showing image path
3. Run: `bun /home/claude/.claude/skills/analyzing-media/scripts/analyze-image.ts <path> "What UI pattern is this?"`
4. Script returns: "Connected status indicator with battery icon..."
5. You respond: "I'll save this connected status indicator to your UI Patterns list!"

## Understanding the Media Context Block

The `<media-context>` block is automatically injected when media is attached:

```xml
<media-context hidden="true">
This message includes media that requires analysis to respond properly.

Media attached:
  - [image] path=/media/123/456/photos/abc123.jpg

To analyze this media, use the analyzing-media skill:
  bun /home/claude/.claude/skills/analyzing-media/scripts/analyze-image.ts "<path>" "<your question>"

Run the script with an appropriate question based on what the user is asking.
</media-context>
```

## Important Notes

- Always use the exact file path from the media-context block
- Choose an appropriate analysis prompt based on the user's request
- The script outputs text directly - use it in your response
- For videos, use the `analyze-video` skill instead
