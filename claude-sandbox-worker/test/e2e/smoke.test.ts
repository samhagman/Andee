/**
 * E2E Smoke Tests
 *
 * These tests verify the worker is running and basic endpoints work.
 * They make real HTTP requests to a running worker instance.
 *
 * Prerequisites:
 * - Worker must be running (npm run dev or deployed)
 * - ANDEE_API_KEY must be set in environment
 * - WORKER_URL can be set (default: http://localhost:8787)
 *
 * Run: npm run test:e2e
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  workerFetch,
  workerFetchNoAuth,
  waitForWorker,
  uniqueTestId,
  E2E_TEST_USER,
} from "./helpers";

describe("E2E: Smoke Tests", () => {
  beforeAll(async () => {
    // Wait for worker to be ready
    const ready = await waitForWorker(10000);
    if (!ready) {
      throw new Error(
        "Worker not ready. Ensure the worker is running (npm run dev)"
      );
    }
  });

  describe("Health and Auth", () => {
    it("returns health check on GET /", async () => {
      const response = await workerFetchNoAuth("/");

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe("ok");
    });

    it("returns 401 for protected endpoint without auth", async () => {
      const response = await workerFetchNoAuth(`/reminders?senderId=${E2E_TEST_USER}`);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("allows access to protected endpoint with valid API key", async () => {
      const response = await workerFetch(`/reminders?senderId=${E2E_TEST_USER}`);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Reminder Workflow", () => {
    it("schedules, lists, and cancels a reminder", async () => {
      const reminderId = uniqueTestId();
      const triggerAt = Date.now() + 3600000; // 1 hour from now

      // 1. Schedule a reminder
      const scheduleResponse = await workerFetch("/schedule-reminder", {
        method: "POST",
        body: JSON.stringify({
          senderId: E2E_TEST_USER,
          chatId: E2E_TEST_USER,
          isGroup: false,
          reminderId,
          triggerAt,
          message: "E2E test reminder - should be cleaned up",
          botToken: "test-bot-token",
        }),
      });

      expect(scheduleResponse.status).toBe(200);
      const scheduleData = await scheduleResponse.json();
      expect(scheduleData.success).toBe(true);
      expect(scheduleData.reminder.id).toBe(reminderId);
      expect(scheduleData.reminder.status).toBe("pending");

      // 2. List reminders and verify it appears
      const listResponse = await workerFetch(
        `/reminders?senderId=${E2E_TEST_USER}`
      );

      expect(listResponse.status).toBe(200);
      const listData = await listResponse.json();
      expect(listData.success).toBe(true);
      const found = listData.reminders.find(
        (r: { id: string }) => r.id === reminderId
      );
      expect(found).toBeDefined();
      expect(found.status).toBe("pending");

      // 3. Cancel the reminder
      const cancelResponse = await workerFetch("/cancel-reminder", {
        method: "POST",
        body: JSON.stringify({
          senderId: E2E_TEST_USER,
          reminderId,
        }),
      });

      expect(cancelResponse.status).toBe(200);
      const cancelData = await cancelResponse.json();
      expect(cancelData.success).toBe(true);

      // 4. Verify it's cancelled in the list
      const listAfterCancelResponse = await workerFetch(
        `/reminders?senderId=${E2E_TEST_USER}&status=cancelled`
      );

      const listAfterCancelData = await listAfterCancelResponse.json();
      const cancelled = listAfterCancelData.reminders.find(
        (r: { id: string }) => r.id === reminderId
      );
      expect(cancelled).toBeDefined();
      expect(cancelled.status).toBe("cancelled");
    });

    it("rejects duplicate reminder IDs", async () => {
      const reminderId = uniqueTestId();
      const triggerAt = Date.now() + 3600000;

      // First schedule should succeed
      const response1 = await workerFetch("/schedule-reminder", {
        method: "POST",
        body: JSON.stringify({
          senderId: E2E_TEST_USER,
          chatId: E2E_TEST_USER,
          isGroup: false,
          reminderId,
          triggerAt,
          message: "First reminder",
          botToken: "test-bot-token",
        }),
      });
      expect(response1.status).toBe(200);

      // Second schedule with same ID should fail
      const response2 = await workerFetch("/schedule-reminder", {
        method: "POST",
        body: JSON.stringify({
          senderId: E2E_TEST_USER,
          chatId: E2E_TEST_USER,
          isGroup: false,
          reminderId,
          triggerAt,
          message: "Duplicate reminder",
          botToken: "test-bot-token",
        }),
      });
      expect(response2.status).toBe(400);
      const data2 = await response2.json();
      expect(data2.success).toBe(false);
      expect(data2.error).toContain("already exists");

      // Cleanup: cancel the first reminder
      await workerFetch("/cancel-reminder", {
        method: "POST",
        body: JSON.stringify({
          senderId: E2E_TEST_USER,
          reminderId,
        }),
      });
    });
  });
});
