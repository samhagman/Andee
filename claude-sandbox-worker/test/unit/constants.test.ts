/**
 * Unit tests for shared/constants/testing.ts exports.
 */
import { describe, it, expect } from "vitest";
import {
  TEST_USER_1,
  TEST_USER_2,
  TEST_CHAT_1,
  TEST_CHAT_2,
  TEST_GROUP_CHAT,
} from "../../../shared/constants/testing";

describe("Testing Constants", () => {
  describe("TEST_USER_1", () => {
    it("equals nine 9s", () => {
      expect(TEST_USER_1).toBe("999999999");
    });

    it("is a string", () => {
      expect(typeof TEST_USER_1).toBe("string");
    });
  });

  describe("TEST_USER_2", () => {
    it("equals nine 8s", () => {
      expect(TEST_USER_2).toBe("888888888");
    });

    it("is a string", () => {
      expect(typeof TEST_USER_2).toBe("string");
    });
  });

  describe("TEST_CHAT_1 and TEST_CHAT_2", () => {
    it("TEST_CHAT_1 equals TEST_USER_1 (private chat = senderId)", () => {
      expect(TEST_CHAT_1).toBe(TEST_USER_1);
    });

    it("TEST_CHAT_2 equals TEST_USER_2 (private chat = senderId)", () => {
      expect(TEST_CHAT_2).toBe(TEST_USER_2);
    });
  });

  describe("TEST_GROUP_CHAT", () => {
    it("is a negative number with -100 prefix", () => {
      expect(TEST_GROUP_CHAT).toBe("-100999999999");
      expect(TEST_GROUP_CHAT.startsWith("-100")).toBe(true);
    });

    it("is a string", () => {
      expect(typeof TEST_GROUP_CHAT).toBe("string");
    });

    it("is different from private chat IDs", () => {
      expect(TEST_GROUP_CHAT).not.toBe(TEST_USER_1);
      expect(TEST_GROUP_CHAT).not.toBe(TEST_USER_2);
    });
  });

  describe("User isolation", () => {
    it("TEST_USER_1 and TEST_USER_2 are different", () => {
      expect(TEST_USER_1).not.toBe(TEST_USER_2);
    });

    it("all test IDs are unique", () => {
      const ids = new Set([TEST_USER_1, TEST_USER_2, TEST_GROUP_CHAT]);
      expect(ids.size).toBe(3);
    });
  });
});
