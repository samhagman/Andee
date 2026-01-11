/**
 * Test fixtures for Andee tests.
 * Uses dedicated test user IDs to avoid polluting real user data.
 */

// Test user constants
export const TEST_USER_1 = "999999999";
export const TEST_USER_2 = "888888888";
export const TEST_GROUP_CHAT = "-100999999999";

/**
 * Common request fixtures for handler tests.
 */
export const fixtures = {
  // === ASK REQUESTS ===
  askRequest: {
    chatId: TEST_USER_1,
    senderId: TEST_USER_1,
    isGroup: false,
    message: "Hello, Andee!",
    claudeSessionId: null,
    botToken: "test-bot-token",
    userMessageId: 123,
  },

  askVoiceRequest: {
    chatId: TEST_USER_1,
    senderId: TEST_USER_1,
    isGroup: false,
    // Valid OGG/OPUS file header prefix (base64)
    audioBase64:
      "T2dnUwACAAAAAAAAAABrc0FXAAAAAP//////////A29wdXNIZWFkAQE4AIA+AAAAAAB", // ~50 bytes
    audioDurationSeconds: 5,
    claudeSessionId: null,
    botToken: "test-bot-token",
    userMessageId: 124,
  },

  groupAskRequest: {
    chatId: TEST_GROUP_CHAT,
    senderId: TEST_USER_1,
    isGroup: true,
    message: "Hello from group!",
    claudeSessionId: null,
    botToken: "test-bot-token",
    userMessageId: 125,
  },

  askWithSessionRequest: {
    chatId: TEST_USER_1,
    senderId: TEST_USER_1,
    isGroup: false,
    message: "Follow-up message",
    claudeSessionId: "session-abc-123",
    botToken: "test-bot-token",
    userMessageId: 126,
  },

  // === REMINDER REQUESTS ===
  scheduleReminderRequest: {
    senderId: TEST_USER_1,
    chatId: TEST_USER_1,
    isGroup: false,
    reminderId: "rem-test-123",
    triggerAt: Date.now() + 60000, // 1 minute from now
    message: "Test reminder message",
    botToken: "test-bot-token",
  },

  cancelReminderRequest: {
    senderId: TEST_USER_1,
    reminderId: "rem-test-123",
  },

  completeReminderRequest: {
    senderId: TEST_USER_1,
    reminderId: "rem-test-123",
  },

  // === RESET REQUESTS ===
  resetRequest: {
    chatId: TEST_USER_1,
    senderId: TEST_USER_1,
    isGroup: false,
  },

  groupResetRequest: {
    chatId: TEST_GROUP_CHAT,
    senderId: TEST_USER_1,
    isGroup: true,
  },

  // === SNAPSHOT REQUESTS ===
  snapshotRequest: {
    chatId: TEST_USER_1,
    senderId: TEST_USER_1,
    isGroup: false,
  },

  // === SESSION DATA ===
  existingSession: {
    claudeSessionId: "session-abc-123",
    messageCount: 5,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-09T12:00:00.000Z",
  },

  newSession: {
    claudeSessionId: null,
    messageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  // === SESSION UPDATE ===
  sessionUpdateRequest: {
    chatId: TEST_USER_1,
    senderId: TEST_USER_1,
    isGroup: false,
    claudeSessionId: "new-session-xyz-789",
    messageCount: 1,
  },

  // === INVALID REQUESTS (for negative tests) ===
  invalidRequests: {
    missingChatId: {
      senderId: TEST_USER_1,
      isGroup: false,
      message: "Hello",
    },
    missingSenderId: {
      chatId: TEST_USER_1,
      isGroup: false,
      message: "Hello",
    },
    missingIsGroup: {
      chatId: TEST_USER_1,
      senderId: TEST_USER_1,
      message: "Hello",
    },
    emptyMessage: {
      chatId: TEST_USER_1,
      senderId: TEST_USER_1,
      isGroup: false,
      message: "",
      botToken: "test-bot-token",
      userMessageId: 999,
    },
  },

  // === TELEGRAM API MOCK RESPONSES ===
  telegramResponses: {
    sendMessageSuccess: {
      ok: true,
      result: {
        message_id: 12345,
        chat: { id: Number(TEST_USER_1), type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: "Test message",
      },
    },
    setReactionSuccess: {
      ok: true,
      result: true,
    },
    sendChatActionSuccess: {
      ok: true,
      result: true,
    },
    getFileSuccess: {
      ok: true,
      result: {
        file_id: "test-file-id",
        file_unique_id: "test-unique-id",
        file_size: 1024,
        file_path: "voice/file_123.oga",
      },
    },
  },

  // === WORKERS AI MOCK RESPONSES ===
  whisperResponse: {
    text: "This is a transcribed voice message.",
  },

  // === R2 OBJECT METADATA ===
  r2ObjectMetadata: {
    key: `sessions/${TEST_USER_1}/${TEST_USER_1}.json`,
    size: 256,
    uploaded: new Date(),
    httpMetadata: {
      contentType: "application/json",
    },
  },
};

/**
 * Helper to create a valid ask request with overrides.
 */
export function createAskRequest(
  overrides: Partial<typeof fixtures.askRequest> = {}
): typeof fixtures.askRequest {
  return { ...fixtures.askRequest, ...overrides };
}

/**
 * Helper to create a valid reminder request with fresh timestamp.
 */
export function createReminderRequest(
  overrides: Partial<typeof fixtures.scheduleReminderRequest> = {}
): typeof fixtures.scheduleReminderRequest {
  return {
    ...fixtures.scheduleReminderRequest,
    triggerAt: Date.now() + 60000, // Always fresh
    reminderId: `rem-${Date.now()}`, // Unique ID
    ...overrides,
  };
}

/**
 * Common HTTP headers for API requests.
 */
export const testHeaders = {
  authenticated: {
    "Content-Type": "application/json",
    "X-API-Key": "test-api-key",
  },
  unauthenticated: {
    "Content-Type": "application/json",
  },
};
