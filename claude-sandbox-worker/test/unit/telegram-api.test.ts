/**
 * Unit tests for shared/telegram/api.ts functions.
 *
 * These functions make direct calls to the Telegram Bot API.
 * They are used inside container scripts where Grammy isn't available.
 *
 * NOTE: These tests use vitest's vi.fn() to mock fetch since the API
 * functions use native fetch directly (not workerd fetchMock).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// We need to test the functions by mocking global fetch
// Import the functions we want to test
import {
  sendToTelegram,
  sendPlainText,
  setReaction,
  removeReaction,
  sendTypingIndicator,
} from "../../../shared/telegram/api";

describe("Telegram API Functions", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    // Save original fetch
    originalFetch = globalThis.fetch;

    // Create mock fetch
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: true }),
    });

    // Replace global fetch
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("sendToTelegram", () => {
    it("sends message with MarkdownV2 formatting", async () => {
      await sendToTelegram("bot123", "chat456", "Hello World");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/botbot123/sendMessage",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );

      // Check the body contains expected fields
      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.chat_id).toBe("chat456");
      expect(body.parse_mode).toBe("MarkdownV2");
      expect(body.disable_web_page_preview).toBe(true);
    });

    it("escapes special characters for MarkdownV2", async () => {
      await sendToTelegram("bot123", "chat456", "Hello. World!");

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      // Periods and exclamation marks should be escaped
      expect(body.text).toContain("\\.");
      expect(body.text).toContain("\\!");
    });

    it("chunks long messages into multiple calls", async () => {
      // Create a very long message (> 4000 chars)
      const longText = "a".repeat(5000);

      await sendToTelegram("bot123", "chat456", longText);

      // Should make multiple fetch calls for chunked message
      expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe("sendPlainText", () => {
    it("sends message without markdown formatting", async () => {
      await sendPlainText("bot123", "chat456", "Hello World");

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.chat_id).toBe("chat456");
      expect(body.text).toBe("Hello World");
      // Should NOT have parse_mode
      expect(body.parse_mode).toBeUndefined();
    });

    it("does not escape special characters", async () => {
      await sendPlainText("bot123", "chat456", "Hello. World!");

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      // Text should be as-is, not escaped
      expect(body.text).toBe("Hello. World!");
    });
  });

  describe("setReaction", () => {
    it("sets emoji reaction on message", async () => {
      await setReaction("bot123", "chat456", 789, "👀");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/botbot123/setMessageReaction",
        expect.any(Object)
      );

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.chat_id).toBe("chat456");
      expect(body.message_id).toBe(789);
      expect(body.reaction).toEqual([{ type: "emoji", emoji: "👀" }]);
    });

    it("uses different emojis", async () => {
      await setReaction("bot123", "chat456", 123, "✅");

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.reaction).toEqual([{ type: "emoji", emoji: "✅" }]);
    });
  });

  describe("removeReaction", () => {
    it("removes reaction with empty array", async () => {
      await removeReaction("bot123", "chat456", 789);

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.reaction).toEqual([]);
    });

    it("silently ignores errors", async () => {
      // Make fetch reject
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      // Should not throw
      await expect(
        removeReaction("bot123", "chat456", 789)
      ).resolves.toBeUndefined();
    });
  });

  describe("sendTypingIndicator", () => {
    it("sends typing action", async () => {
      await sendTypingIndicator("bot123", "chat456");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/botbot123/sendChatAction",
        expect.any(Object)
      );

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.chat_id).toBe("chat456");
      expect(body.action).toBe("typing");
    });

    it("silently ignores errors", async () => {
      // Make fetch reject
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      // Should not throw
      await expect(sendTypingIndicator("bot123", "chat456")).resolves.toBeUndefined();
    });
  });
});
