#!/usr/bin/env bun
/**
 * Analyze a video using Gemini via OpenRouter.
 * Native video upload - sends full video to Gemini for analysis.
 *
 * Usage: bun analyze-video.ts <video-path> [prompt]
 *
 * Examples:
 *   bun analyze-video.ts /media/123/456/videos/abc.mp4
 *   bun analyze-video.ts /media/123/456/videos/abc.mp4 "What happens in this video?"
 *
 * Requires: OPENROUTER_API_KEY environment variable
 */

import { readFileSync, existsSync, statSync } from "fs";
import { extname } from "path";

// Type definitions for OpenRouter API response
interface OpenRouterChoice {
  message?: {
    content?: string;
  };
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: {
    message?: string;
    code?: string;
  };
}

const videoPath = process.argv[2];
const prompt =
  process.argv[3] ||
  "Describe what happens in this video. Include key events, any text shown, and notable details.";

if (!videoPath) {
  console.error("Usage: bun analyze-video.ts <video-path> [prompt]");
  console.error(
    'Example: bun analyze-video.ts /media/123/videos/abc.mp4 "Summarize this video"'
  );
  process.exit(1);
}

if (!existsSync(videoPath)) {
  console.error(`Error: Video not found at ${videoPath}`);
  process.exit(1);
}

// Check file size (50MB limit)
const MAX_SIZE = 50 * 1024 * 1024;
const fileSize = statSync(videoPath).size;
if (fileSize > MAX_SIZE) {
  console.error(
    `Error: Video too large (${(fileSize / 1024 / 1024).toFixed(1)}MB, max 50MB)`
  );
  process.exit(1);
}

// Determine media type from extension
const ext = extname(videoPath).toLowerCase();
const mediaTypeMap: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".m4v": "video/x-m4v",
  ".3gp": "video/3gpp",
};
const mediaType = mediaTypeMap[ext] || "video/mp4";

// Read video as base64
const videoBuffer = readFileSync(videoPath);
const videoBase64 = videoBuffer.toString("base64");

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("Error: OPENROUTER_API_KEY environment variable not set");
  process.exit(1);
}

try {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://andee.bot", // OpenRouter tracking
      "X-Title": "Andee Video Analysis", // OpenRouter tracking
    },
    body: JSON.stringify({
      model: "google/gemini-2.0-flash-001",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "video_url",
              video_url: {
                url: `data:${mediaType};base64,${videoBase64}`,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`OpenRouter API error (${response.status}): ${errorText}`);
    process.exit(1);
  }

  const data = (await response.json()) as OpenRouterResponse;

  if (data.error) {
    console.error("Gemini error:", data.error.message || JSON.stringify(data.error));
    process.exit(1);
  }

  const content = data.choices?.[0]?.message?.content;
  if (content) {
    console.log(content);
  } else {
    console.error("No response content from Gemini");
    console.error("Full response:", JSON.stringify(data, null, 2));
    process.exit(1);
  }
} catch (error) {
  console.error(
    "Analysis failed:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
}
