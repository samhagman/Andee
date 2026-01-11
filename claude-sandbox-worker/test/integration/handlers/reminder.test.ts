/**
 * Integration tests for reminder endpoints.
 * Tests the HTTP handlers which interact with SchedulerDO.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { SELF, env, fetchMock } from "cloudflare:test";
import {
  testHeaders,
  TEST_USER_1,
  TEST_USER_2,
  fixtures,
  createReminderRequest,
} from "../../mocks/fixtures";

describe("Reminder Handlers", () => {
  beforeEach(() => {
    // Activate fetchMock for Telegram API calls
    fetchMock.activate();
    fetchMock.disableNetConnect();

    // Mock Telegram API calls (for alarm delivery)
    fetchMock
      .get("https://api.telegram.org")
      .intercept({ path: /\/bot.*\/sendMessage/, method: "POST" })
      .reply(200, { ok: true, result: { message_id: 123 } });
  });

  describe("POST /schedule-reminder", () => {
    it("schedules a reminder successfully", async () => {
      const reminderReq = createReminderRequest();

      const response = await SELF.fetch("http://example.com/schedule-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify(reminderReq),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe("Reminder scheduled");
      expect(data.reminder).toBeDefined();
      expect(data.reminder.id).toBe(reminderReq.reminderId);
      expect(data.reminder.status).toBe("pending");
    });

    it("rejects duplicate reminder IDs", async () => {
      const reminderReq = createReminderRequest({ reminderId: "dup-test-123" });

      // First request should succeed
      const response1 = await SELF.fetch("http://example.com/schedule-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify(reminderReq),
      });
      expect(response1.status).toBe(200);

      // Second request with same ID should fail
      const response2 = await SELF.fetch("http://example.com/schedule-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify(reminderReq),
      });
      expect(response2.status).toBe(400);
      const data2 = await response2.json();
      expect(data2.success).toBe(false);
      expect(data2.error).toContain("already exists");
    });

    it("rejects reminders with past trigger time", async () => {
      const reminderReq = createReminderRequest({
        triggerAt: Date.now() - 120000, // 2 minutes ago (past 1-min grace)
      });

      const response = await SELF.fetch("http://example.com/schedule-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify(reminderReq),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain("future");
    });

    it("returns 400 for missing required fields", async () => {
      const response = await SELF.fetch("http://example.com/schedule-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify({ senderId: TEST_USER_1 }), // Missing other fields
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Missing required fields");
    });
  });

  describe("POST /cancel-reminder", () => {
    it("cancels a pending reminder", async () => {
      // First schedule a reminder
      const reminderReq = createReminderRequest({ reminderId: "cancel-test-123" });
      await SELF.fetch("http://example.com/schedule-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify(reminderReq),
      });

      // Then cancel it
      const response = await SELF.fetch("http://example.com/cancel-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify({
          senderId: reminderReq.senderId,
          reminderId: reminderReq.reminderId,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe("Reminder cancelled");
    });

    it("fails to cancel non-existent reminder", async () => {
      const response = await SELF.fetch("http://example.com/cancel-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify({
          senderId: TEST_USER_1,
          reminderId: "nonexistent-reminder",
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain("not found");
    });
  });

  describe("POST /complete-reminder", () => {
    it("marks a reminder as completed", async () => {
      // First schedule a reminder
      const reminderReq = createReminderRequest({ reminderId: "complete-test-123" });
      await SELF.fetch("http://example.com/schedule-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify(reminderReq),
      });

      // Then complete it
      const response = await SELF.fetch("http://example.com/complete-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify({
          senderId: reminderReq.senderId,
          reminderId: reminderReq.reminderId,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe("Reminder completed");
    });
  });

  describe("GET /reminders", () => {
    it("lists reminders for a user", async () => {
      const senderId = TEST_USER_2; // Use different user for isolation

      // Schedule a few reminders
      await SELF.fetch("http://example.com/schedule-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify(createReminderRequest({ senderId, reminderId: "list-1" })),
      });
      await SELF.fetch("http://example.com/schedule-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify(createReminderRequest({ senderId, reminderId: "list-2" })),
      });

      // List all reminders
      const response = await SELF.fetch(
        `http://example.com/reminders?senderId=${senderId}`,
        {
          method: "GET",
          headers: testHeaders.authenticated,
        }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.reminders).toBeInstanceOf(Array);
      expect(data.reminders.length).toBeGreaterThanOrEqual(2);
    });

    it("filters reminders by status", async () => {
      const senderId = `filter-user-${Date.now()}`; // Unique user for isolation

      // Schedule and cancel one reminder
      const cancelReq = createReminderRequest({ senderId, reminderId: "filter-cancel" });
      await SELF.fetch("http://example.com/schedule-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify(cancelReq),
      });
      await SELF.fetch("http://example.com/cancel-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify({ senderId, reminderId: cancelReq.reminderId }),
      });

      // Schedule a pending one
      await SELF.fetch("http://example.com/schedule-reminder", {
        method: "POST",
        headers: testHeaders.authenticated,
        body: JSON.stringify(createReminderRequest({ senderId, reminderId: "filter-pending" })),
      });

      // List only pending
      const response = await SELF.fetch(
        `http://example.com/reminders?senderId=${senderId}&status=pending`,
        {
          method: "GET",
          headers: testHeaders.authenticated,
        }
      );

      const data = await response.json();
      expect(data.reminders.every((r: any) => r.status === "pending")).toBe(true);
    });

    it("returns 400 without senderId", async () => {
      const response = await SELF.fetch("http://example.com/reminders", {
        method: "GET",
        headers: testHeaders.authenticated,
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("senderId");
    });
  });
});
