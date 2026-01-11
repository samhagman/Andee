/**
 * Integration tests for health check and authentication middleware.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { testHeaders, TEST_USER_1 } from "../../mocks/fixtures";

describe("Health Check and Auth", () => {
  describe("GET /", () => {
    it("returns health check response without auth", async () => {
      const response = await SELF.fetch("http://example.com/", {
        method: "GET",
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe("ok");
    });
  });

  describe("Authentication Middleware", () => {
    it("returns 401 for protected endpoint without API key", async () => {
      const response = await SELF.fetch("http://example.com/reminders?senderId=123", {
        method: "GET",
        headers: testHeaders.unauthenticated,
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("allows access with valid API key", async () => {
      const response = await SELF.fetch(`http://example.com/reminders?senderId=${TEST_USER_1}`, {
        method: "GET",
        headers: testHeaders.authenticated,
      });

      // Should not be 401 (may be 200 with empty list)
      expect(response.status).not.toBe(401);
    });

    it("returns 401 with invalid API key", async () => {
      const response = await SELF.fetch(`http://example.com/reminders?senderId=${TEST_USER_1}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "wrong-key",
        },
      });

      expect(response.status).toBe(401);
    });
  });

  describe("CORS Headers", () => {
    it("returns CORS headers on OPTIONS request", async () => {
      const response = await SELF.fetch("http://example.com/", {
        method: "OPTIONS",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });
  });

  describe("404 Handling", () => {
    it("returns 404 for unknown paths", async () => {
      const response = await SELF.fetch("http://example.com/nonexistent", {
        method: "GET",
        headers: testHeaders.authenticated,
      });

      expect(response.status).toBe(404);
    });
  });
});
