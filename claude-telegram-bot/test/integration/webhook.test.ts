/**
 * Integration tests for webhook routing and health check.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import { createMessageUpdate, telegramApiResponses } from "../mocks/fixtures";

describe("Webhook Handler", () => {
  beforeEach(() => {
    // Activate fetchMock for all external HTTP calls
    fetchMock.activate();
    fetchMock.disableNetConnect();

    // Mock ALL Telegram API calls that Grammy might make
    const telegramMock = fetchMock.get("https://api.telegram.org");

    // Message operations
    telegramMock
      .intercept({ path: /\/bot.*\/sendMessage/, method: "POST" })
      .reply(200, telegramApiResponses.sendMessage);
    telegramMock
      .intercept({ path: /\/bot.*\/setMessageReaction/, method: "POST" })
      .reply(200, telegramApiResponses.setMessageReaction);
    telegramMock
      .intercept({ path: /\/bot.*\/editMessageText/, method: "POST" })
      .reply(200, telegramApiResponses.editMessageText);
    telegramMock
      .intercept({ path: /\/bot.*\/answerCallbackQuery/, method: "POST" })
      .reply(200, telegramApiResponses.answerCallbackQuery);

    // File operations
    telegramMock
      .intercept({ path: /\/bot.*\/getFile/, method: "POST" })
      .reply(200, telegramApiResponses.getFile);
    telegramMock
      .intercept({ path: /\/file\/bot.*/, method: "GET" })
      .reply(200, new ArrayBuffer(1024));

    // Bot info - Grammy might call this
    telegramMock
      .intercept({ path: /\/bot.*\/getMe/, method: "POST" })
      .reply(200, { ok: true, result: { id: 12345, is_bot: true, first_name: "TestBot" } });

    // Catch-all for any other Telegram API calls
    telegramMock
      .intercept({ path: /\/bot.*/, method: "POST" })
      .reply(200, { ok: true, result: true });
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  describe("GET / (Health Check)", () => {
    it("returns health check JSON with service name", async () => {
      const response = await SELF.fetch("http://example.com/", {
        method: "GET",
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe("ok");
      expect(data.service).toBe("claude-telegram-bot");
    });

    it("returns 200 status code", async () => {
      const response = await SELF.fetch("http://example.com/", {
        method: "GET",
      });

      expect(response.ok).toBe(true);
    });
  });

  describe("POST / (Telegram Webhook)", () => {
    it("returns 200 for valid update", async () => {
      const update = createMessageUpdate({ text: "/start" });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      // Grammy's webhookCallback returns 200 on success
      expect(response.status).toBe(200);
    });

    it("handles empty update gracefully", async () => {
      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ update_id: 123 }),
      });

      // Grammy handles this - no message means no action
      expect(response.status).toBe(200);
    });

    it("handles malformed JSON", async () => {
      // Grammy throws SyntaxError on malformed JSON which causes uncaught exception
      // This is expected behavior - Telegram always sends valid JSON
      // Test verifies the code path doesn't crash silently
      try {
        const response = await SELF.fetch("http://example.com/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not valid json {{{",
        });
        // If we get a response, it should be an error status
        expect([400, 500]).toContain(response.status);
      } catch (error) {
        // Grammy throws SyntaxError on invalid JSON - this is acceptable
        expect(error).toBeInstanceOf(SyntaxError);
      }
    });
  });

  describe("Other Methods", () => {
    it("POST to non-root path returns error or passthrough", async () => {
      const response = await SELF.fetch("http://example.com/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ update_id: 123 }),
      });

      // Non-standard paths may return 404 or be handled by webhook
      expect([200, 404]).toContain(response.status);
    });
  });
});
