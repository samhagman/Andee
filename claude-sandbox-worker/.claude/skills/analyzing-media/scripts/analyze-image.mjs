#!/usr/bin/env node
/**
 * Analyze an image using Claude Agent SDK.
 * Uses CLAUDE.md from /home/claude so Claude has Andee's personality.
 *
 * Usage: node analyze-image.mjs <image-path> [prompt]
 *
 * Examples:
 *   node analyze-image.mjs /media/123/456/photos/abc.jpg
 *   node analyze-image.mjs /media/123/456/photos/abc.jpg "What recipe is this?"
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync } from "fs";
import { extname } from "path";

const imagePath = process.argv[2];
const prompt = process.argv[3] || "Describe this image in detail. Focus on the key elements and any text visible.";

if (!imagePath) {
  console.error("Usage: node analyze-image.mjs <image-path> [prompt]");
  console.error('Example: node analyze-image.mjs /media/123/photos/abc.jpg "What recipe is this?"');
  process.exit(1);
}

if (!existsSync(imagePath)) {
  console.error(`Error: Image not found at ${imagePath}`);
  process.exit(1);
}

// Determine media type from extension
const ext = extname(imagePath).toLowerCase();
const mediaTypeMap = {
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
  const response =
    typeof result === "string"
      ? result
      : result && typeof result === "object" && "response" in result
        ? result.response
        : JSON.stringify(result);

  console.log(response);
} catch (error) {
  console.error(
    "Analysis failed:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
}
