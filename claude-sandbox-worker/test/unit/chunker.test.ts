import { describe, it, expect } from "vitest";
import {
  chunkTextForTelegram,
  willNeedChunking,
} from "../../../shared/telegram/chunker";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../../shared/config";

describe("Telegram Text Chunking", () => {
  describe("willNeedChunking", () => {
    it("returns false for short text", () => {
      expect(willNeedChunking("Hello world")).toBe(false);
    });

    it("returns false for text exactly at limit", () => {
      const text = "a".repeat(TELEGRAM_MAX_MESSAGE_LENGTH);
      expect(willNeedChunking(text)).toBe(false);
    });

    it("returns true for text exceeding limit", () => {
      const text = "a".repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 1);
      expect(willNeedChunking(text)).toBe(true);
    });

    it("returns false for empty string", () => {
      expect(willNeedChunking("")).toBe(false);
    });
  });

  describe("chunkTextForTelegram", () => {
    describe("short text handling", () => {
      it("returns single chunk for short text", () => {
        const chunks = chunkTextForTelegram("Hello world");
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toBe("Hello world");
      });

      it("returns single chunk for text at limit", () => {
        const text = "a".repeat(TELEGRAM_MAX_MESSAGE_LENGTH);
        const chunks = chunkTextForTelegram(text);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toBe(text);
      });

      it("handles empty string", () => {
        const chunks = chunkTextForTelegram("");
        // Empty string returns empty array (nothing to chunk)
        expect(chunks).toHaveLength(0);
      });
    });

    describe("long text chunking", () => {
      it("splits text exceeding limit into multiple chunks", () => {
        const text = "a".repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 100);
        const chunks = chunkTextForTelegram(text);
        expect(chunks.length).toBeGreaterThan(1);
      });

      it("each chunk is within the limit", () => {
        const text = "a".repeat(TELEGRAM_MAX_MESSAGE_LENGTH * 3);
        const chunks = chunkTextForTelegram(text);
        for (const chunk of chunks) {
          expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH);
        }
      });

      it("reconstructed text has all content", () => {
        const text = "a".repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 500);
        const chunks = chunkTextForTelegram(text);
        const reconstructed = chunks.join("");
        // Allow for trimmed whitespace
        expect(reconstructed.replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
      });
    });

    describe("newline-based splitting", () => {
      it("prefers splitting at newlines for cleaner breaks", () => {
        const lines = [];
        // Create text with newlines at convenient positions
        for (let i = 0; i < 10; i++) {
          lines.push("x".repeat(500)); // 500 chars per line
        }
        const text = lines.join("\n"); // 5000 chars total, needs 2 chunks

        const chunks = chunkTextForTelegram(text);

        // First chunk should end at a newline (not mid-line)
        expect(chunks[0].endsWith("x")).toBe(true);
        // And shouldn't be cut at exactly max length
        expect(chunks[0].length).toBeLessThan(TELEGRAM_MAX_MESSAGE_LENGTH);
      });

      it("falls back to max length if no suitable newline", () => {
        // No newlines at all
        const text = "a".repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 100);
        const chunks = chunkTextForTelegram(text);
        expect(chunks[0].length).toBe(TELEGRAM_MAX_MESSAGE_LENGTH);
      });

      it("ignores newlines too early in the text", () => {
        // Newline at 100 chars, but we want to fill more
        const text =
          "a".repeat(100) +
          "\n" +
          "b".repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 100);
        const chunks = chunkTextForTelegram(text);
        // Should not split at the early newline (100 chars is < half of max)
        expect(chunks[0].length).toBeGreaterThan(100);
      });
    });

    describe("custom max length", () => {
      it("respects custom max length", () => {
        const text = "a".repeat(200);
        const chunks = chunkTextForTelegram(text, 100);
        expect(chunks).toHaveLength(2);
        expect(chunks[0].length).toBe(100);
        expect(chunks[1].length).toBe(100);
      });

      it("handles very small max length", () => {
        const text = "Hello world";
        const chunks = chunkTextForTelegram(text, 5);
        // "Hello world" (11 chars) with max 5:
        // chunk1: "Hello" (5), remaining " world" -> "world" (5)
        // chunk2: "world" (5) - fits exactly
        // Total: 2 chunks
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toBe("Hello");
        expect(chunks[1]).toBe("world");
        for (const chunk of chunks) {
          expect(chunk.length).toBeLessThanOrEqual(5);
        }
      });
    });

    describe("whitespace handling", () => {
      it("trims leading whitespace from subsequent chunks", () => {
        const text = "a".repeat(100) + "\n   " + "b".repeat(100);
        const chunks = chunkTextForTelegram(text, 101);
        // Second chunk should not start with spaces
        if (chunks.length > 1) {
          expect(chunks[1].startsWith(" ")).toBe(false);
        }
      });
    });
  });
});
