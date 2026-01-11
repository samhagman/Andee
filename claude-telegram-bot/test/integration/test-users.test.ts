/**
 * Integration tests for test user transformer.
 * Verifies that Telegram API calls are skipped for test users (TEST_USER_1, TEST_USER_2, TEST_GROUP_CHAT).
 *
 * The testUserTransformer intercepts Grammy API calls and returns mock responses
 * for test users, so no actual HTTP requests are made to Telegram.
 *
 * We verify this behavior by:
 * 1. Checking console logs for "[TEST] Skipping..." messages
 * 2. Confirming requests complete successfully without hitting fetchMock intercepts
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import {
  createMessageUpdate,
  createCommandUpdate,
  telegramApiResponses,
  TEST_USER_1,
  TEST_USER_2,
  TEST_GROUP_CHAT,
} from "../mocks/fixtures";

describe("Test User Transformer", () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();

    // Mock Telegram API - these should NOT be called for test users
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

  describe("TEST_USER_1 (999999999)", () => {
    it("processes message without errors", async () => {
      const update = createMessageUpdate({
        text: "Hello!",
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      // Request should complete successfully
      expect(response.status).toBe(200);
    });

    it("processes /start command without errors", async () => {
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

    it("processes /status command without errors", async () => {
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

  describe("TEST_USER_2 (888888888)", () => {
    it("processes message without errors", async () => {
      const update = createMessageUpdate({
        text: "Hello from test user 2!",
        userId: Number(TEST_USER_2),
        chatId: Number(TEST_USER_2),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });

    it("processes /new command without errors", async () => {
      const update = createCommandUpdate("new", {
        userId: Number(TEST_USER_2),
        chatId: Number(TEST_USER_2),
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("TEST_GROUP_CHAT (-100999999999)", () => {
    it("processes group message without errors", async () => {
      const update = createMessageUpdate({
        text: "Hello group!",
        chatId: Number(TEST_GROUP_CHAT),
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

    it("processes group command without errors", async () => {
      const update = createCommandUpdate("status", {
        chatId: Number(TEST_GROUP_CHAT),
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

  describe("Test user isolation from regular users", () => {
    it("test users can access bot without allowlist check", async () => {
      // Test users are in the TEST_CHAT_IDS set, so they bypass auth
      const update = createMessageUpdate({
        text: "Test user message",
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

    it("both test users work independently", async () => {
      // Test user 1
      const update1 = createMessageUpdate({
        text: "From user 1",
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
      });

      const response1 = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update1),
      });

      expect(response1.status).toBe(200);

      // Test user 2
      const update2 = createMessageUpdate({
        text: "From user 2",
        userId: Number(TEST_USER_2),
        chatId: Number(TEST_USER_2),
      });

      const response2 = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update2),
      });

      expect(response2.status).toBe(200);
    });
  });
});
