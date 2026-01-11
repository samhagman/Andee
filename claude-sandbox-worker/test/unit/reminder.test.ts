/**
 * Unit tests for shared/types/reminder.ts helper functions.
 */
import { describe, it, expect } from "vitest";
import { getSchedulerDOId } from "../../../shared/types/reminder";

describe("Reminder Helper Functions", () => {
  describe("getSchedulerDOId", () => {
    it("returns scheduler ID with senderId", () => {
      const result = getSchedulerDOId("123456789");
      expect(result).toBe("scheduler-123456789");
    });

    it("handles test user IDs", () => {
      expect(getSchedulerDOId("999999999")).toBe("scheduler-999999999");
      expect(getSchedulerDOId("888888888")).toBe("scheduler-888888888");
    });

    it("handles empty string", () => {
      const result = getSchedulerDOId("");
      expect(result).toBe("scheduler-");
    });

    it("generates unique IDs for different users", () => {
      const id1 = getSchedulerDOId("user1");
      const id2 = getSchedulerDOId("user2");
      expect(id1).not.toBe(id2);
    });

    it("generates consistent ID for same user", () => {
      const id1 = getSchedulerDOId("12345");
      const id2 = getSchedulerDOId("12345");
      expect(id1).toBe(id2);
    });
  });
});
