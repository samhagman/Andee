import { describe, it, expect } from "vitest";
import {
  getSessionKey,
  getSnapshotKey,
  getSnapshotPrefix,
  createDefaultSession,
} from "../../src/types";

describe("Session Key Generation", () => {
  describe("getSessionKey", () => {
    it("generates correct key for private chat", () => {
      const key = getSessionKey("123456", "123456", false);
      expect(key).toBe("sessions/123456/123456.json");
    });

    it("generates correct key for private chat with different senderId", () => {
      const key = getSessionKey("-100987654", "123456", false);
      expect(key).toBe("sessions/123456/-100987654.json");
    });

    it("generates correct key for group chat", () => {
      const key = getSessionKey("-100555666777", "123456", true);
      expect(key).toBe("sessions/groups/-100555666777.json");
    });

    it("throws if senderId is undefined", () => {
      expect(() => getSessionKey("123", undefined, false)).toThrow(
        "getSessionKey requires senderId and isGroup"
      );
    });

    it("throws if isGroup is undefined", () => {
      expect(() => getSessionKey("123", "456", undefined)).toThrow(
        "getSessionKey requires senderId and isGroup"
      );
    });

    it("throws if both senderId and isGroup are undefined", () => {
      expect(() => getSessionKey("123", undefined, undefined)).toThrow(
        "getSessionKey requires senderId and isGroup"
      );
    });
  });

  describe("getSnapshotKey", () => {
    it("generates key with provided timestamp for private chat", () => {
      const key = getSnapshotKey("123", "456", false, "2025-01-09T12-00-00-000Z");
      expect(key).toBe("snapshots/456/123/2025-01-09T12-00-00-000Z.tar.gz");
    });

    it("generates key with provided timestamp for group chat", () => {
      const key = getSnapshotKey("-100555", "456", true, "2025-01-09T12-00-00-000Z");
      expect(key).toBe("snapshots/groups/-100555/2025-01-09T12-00-00-000Z.tar.gz");
    });

    it("generates timestamp if not provided", () => {
      const key = getSnapshotKey("123", "456", false);
      expect(key).toMatch(/^snapshots\/456\/123\/\d{4}-\d{2}-\d{2}T.*\.tar\.gz$/);
    });

    it("throws if senderId is undefined", () => {
      expect(() => getSnapshotKey("123", undefined, false)).toThrow(
        "getSnapshotKey requires senderId and isGroup"
      );
    });

    it("throws if isGroup is undefined", () => {
      expect(() => getSnapshotKey("123", "456", undefined)).toThrow(
        "getSnapshotKey requires senderId and isGroup"
      );
    });
  });

  describe("getSnapshotPrefix", () => {
    it("generates correct prefix for private chat", () => {
      const prefix = getSnapshotPrefix("123", "456", false);
      expect(prefix).toBe("snapshots/456/123/");
    });

    it("generates correct prefix for group chat", () => {
      const prefix = getSnapshotPrefix("-100555", "456", true);
      expect(prefix).toBe("snapshots/groups/-100555/");
    });

    it("throws if senderId is undefined", () => {
      expect(() => getSnapshotPrefix("123", undefined, false)).toThrow(
        "getSnapshotPrefix requires senderId and isGroup"
      );
    });

    it("throws if isGroup is undefined", () => {
      expect(() => getSnapshotPrefix("123", "456", undefined)).toThrow(
        "getSnapshotPrefix requires senderId and isGroup"
      );
    });
  });

  describe("createDefaultSession", () => {
    it("creates session with null claudeSessionId", () => {
      const session = createDefaultSession();
      expect(session.claudeSessionId).toBeNull();
    });

    it("creates session with zero messageCount", () => {
      const session = createDefaultSession();
      expect(session.messageCount).toBe(0);
    });

    it("creates session with valid ISO timestamps", () => {
      const session = createDefaultSession();
      expect(() => new Date(session.createdAt)).not.toThrow();
      expect(() => new Date(session.updatedAt)).not.toThrow();
    });

    it("creates session with createdAt and updatedAt being the same initially", () => {
      const session = createDefaultSession();
      expect(session.createdAt).toBe(session.updatedAt);
    });
  });
});
