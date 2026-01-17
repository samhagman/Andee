#!/usr/bin/env bun
/**
 * Analyze an image using Claude Agent SDK.
 * Uses CLAUDE.md from /home/claude so Claude has Andee's personality.
 *
 * Usage: bun analyze-image.ts <image-path> [prompt]
 *
 * Examples:
 *   bun analyze-image.ts /media/123/456/photos/abc.jpg
 *   bun analyze-image.ts /media/123/456/photos/abc.jpg "What UI pattern is this?"
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync } from "fs";
import { extname } from "path";

const imagePath = process.argv[2];
const prompt = process.argv[3] || "Describe this image in detail. Focus on the key elements and any text or UI patterns visible.";

if (!imagePath) {
  console.error("Usage: bun analyze-image.ts <image-path> [prompt]");
  console.error("Example: bun analyze-image.ts /media/123/photos/abc.jpg \"What is shown?\"");
  process.exit(1);
}

if (!existsSync(imagePath)) {
  console.error(`Error: Image not found at ${imagePath}`);
  process.exit(1);
}

// Determine media type from extension
const ext = extname(imagePath).toLowerCase();
const mediaTypeMap: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const mediaType = mediaTypeMap[ext] || "image/jpeg";

// Read image as base64
const imageBuffer = readFileSync(imagePath);
const imageBase64 = imageBuffer.toString("base64");

try {
  // Query Claude with image using the Agent SDK
  // cwd=/home/claude so it sees Andee's CLAUDE.md personality
  const result = await query({
    prompt: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: imageBase64,
            },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
    options: {
      cwd: "/home/claude",
      maxTurns: 1,
      model: "claude-sonnet-4-5-20250514",
      permissionMode: "bypassPermissions",
    },
  });

  // Output the response
  // query() returns either a string or an object with response property
  const response =
    typeof result === "string"
      ? result
      : result && typeof result === "object" && "response" in result
        ? (result as { response: string }).response
        : JSON.stringify(result);

  console.log(response);
} catch (error) {
  console.error(
    "Analysis failed:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
}
