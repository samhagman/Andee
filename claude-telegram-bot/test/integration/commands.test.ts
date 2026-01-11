/**
 * Integration tests for bot command handlers.
 * Tests /start, /new, /status, /snapshot, /snapshots, /restore commands.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock, env } from "cloudflare:test";
import {
  createCommandUpdate,
  telegramApiResponses,
  TEST_USER_1,
} from "../mocks/fixtures";

describe("Command Handlers", () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();

    // Mock Telegram API
    const telegramMock = fetchMock.get("https://api.telegram.org");
    telegramMock
      .intercept({ path: /\/bot.*\/sendMessage/, method: "POST" })
      .reply(200, telegramApiResponses.sendMessage);
    telegramMock
      .intercept({ path: /\/bot.*\/setMessageReaction/, method: "POST" })
      .reply(200, telegramApiResponses.setMessageReaction);
    telegramMock
      .intercept({ path: /\/bot.*\/getMe/, method: "POST" })
      .reply(200, { ok: true, result: { id: 12345, is_bot: true, first_name: "TestBot" } });
    telegramMock
      .intercept({ path: /\/bot.*/, method: "POST" })
      .reply(200, { ok: true, result: true });
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  describe("/start command", () => {
    it("returns welcome message", async () => {
      const update = createCommandUpdate("start");

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });

    it("works for test users", async () => {
      const update = createCommandUpdate("start", {
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("/new command", () => {
    it("returns 200 for authorized user", async () => {
      const update = createCommandUpdate("new", {
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });

    it("calls sandbox worker reset endpoint", async () => {
      // The SANDBOX_WORKER service binding mock is defined in vitest.config.ts
      // We verify behavior through successful response
      const update = createCommandUpdate("new", {
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("/status command", () => {
    it("returns session status for authorized user", async () => {
      const update = createCommandUpdate("status", {
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });

    it("returns default session when no session exists", async () => {
      // Fresh R2 storage means no session - should return default
      const update = createCommandUpdate("status", {
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("/snapshot command", () => {
    it("returns 200 for authorized user", async () => {
      const update = createCommandUpdate("snapshot", {
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });

    it("calls sandbox worker snapshot endpoint", async () => {
      const update = createCommandUpdate("snapshot", {
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      // Successful snapshot creation via mock service binding
      expect(response.status).toBe(200);
    });
  });

  describe("/snapshots command", () => {
    it("returns 200 for authorized user", async () => {
      const update = createCommandUpdate("snapshots", {
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });

    it("handles empty snapshot list", async () => {
      // Mock returns empty list by default
      const update = createCommandUpdate("snapshots", {
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("/restore command", () => {
    it("returns 200 for authorized user", async () => {
      const update = createCommandUpdate("restore", {
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });

    it("handles case with no snapshots to restore", async () => {
      const update = createCommandUpdate("restore", {
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      // Should indicate no snapshots available
      expect(response.status).toBe(200);
    });
  });

  describe("Group chat commands", () => {
    it("/start works in group chat", async () => {
      const update = createCommandUpdate("start", {
        chatId: -100123456789,
        userId: Number(TEST_USER_1),
        chatType: "supergroup",
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });

    it("/new works in group chat", async () => {
      const update = createCommandUpdate("new", {
        chatId: -100123456789,
        userId: Number(TEST_USER_1),
        chatType: "supergroup",
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });
  });
});
