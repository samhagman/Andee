/**
 * Integration tests for message handlers.
 * Tests text messages and voice messages.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import {
  createMessageUpdate,
  createVoiceUpdate,
  telegramApiResponses,
  TEST_USER_1,
  TEST_USER_2,
  TEST_GROUP_CHAT,
} from "../mocks/fixtures";

describe("Message Handlers", () => {
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
      .intercept({ path: /\/bot.*\/getFile/, method: "POST" })
      .reply(200, telegramApiResponses.getFile);
    // Voice file download endpoint (GET request)
    telegramMock
      .intercept({ path: /\/file\/bot.*/, method: "GET" })
      .reply(200, new ArrayBuffer(1024));
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

  describe("Text Messages", () => {
    it("handles regular text message", async () => {
      const update = createMessageUpdate({
        text: "Hello, Andee!",
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

    it("handles long text message", async () => {
      const longText = "This is a long message. ".repeat(100);
      const update = createMessageUpdate({
        text: longText,
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

    it("handles message with special characters", async () => {
      const update = createMessageUpdate({
        text: "Hello! <script>alert('xss')</script> & \"quotes\" 'single'",
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

    it("handles message with emoji", async () => {
      const update = createMessageUpdate({
        text: "Hello 👋 How are you? 🤔 Let's code! 💻",
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

  describe("Voice Messages", () => {
    it("handles voice message", async () => {
      const update = createVoiceUpdate({
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
        duration: 5,
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });

    it("handles short voice message", async () => {
      const update = createVoiceUpdate({
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
        duration: 1,
        fileSize: 512,
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });

    it("handles long voice message", async () => {
      const update = createVoiceUpdate({
        userId: Number(TEST_USER_1),
        chatId: Number(TEST_USER_1),
        duration: 60,
        fileSize: 1024 * 1024, // 1MB
      });

      const response = await SELF.fetch("http://example.com/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("Group Messages", () => {
    it("handles text message in supergroup", async () => {
      const update = createMessageUpdate({
        text: "Hello group!",
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

    it("handles voice message in supergroup", async () => {
      const update = createVoiceUpdate({
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

  describe("Multiple Test Users", () => {
    it("handles message from TEST_USER_1", async () => {
      const update = createMessageUpdate({
        text: "Hello from test user 1!",
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

    it("handles message from TEST_USER_2", async () => {
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
  });
});
