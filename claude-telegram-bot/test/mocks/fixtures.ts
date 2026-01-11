/**
 * Test fixtures for telegram-bot tests.
 *
 * Provides factory functions to create Telegram update objects
 * and mock responses for consistent testing.
 */
import {
  TEST_USER_1,
  TEST_USER_2,
  TEST_GROUP_CHAT,
} from "../../../shared/constants/testing";

// Re-export test constants for convenience
export { TEST_USER_1, TEST_USER_2, TEST_GROUP_CHAT };

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  voice?: {
    file_id: string;
    file_unique_id: string;
    duration: number;
    file_size?: number;
  };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
}

// ============================================================================
// TELEGRAM UPDATE FACTORIES
// ============================================================================

/**
 * Creates a Telegram text message update.
 */
export function createMessageUpdate(
  overrides: Partial<{
    text: string;
    chatId: number;
    userId: number;
    messageId: number;
    chatType: "private" | "group" | "supergroup";
    username: string;
    firstName: string;
  }> = {}
): TelegramUpdate {
  const {
    text = "Hello, Andee!",
    chatId = Number(TEST_USER_1),
    userId = Number(TEST_USER_1),
    messageId = Date.now(),
    chatType = "private",
    username = "testuser",
    firstName = "Test",
  } = overrides;

  return {
    update_id: Date.now(),
    message: {
      message_id: messageId,
      from: {
        id: userId,
        is_bot: false,
        first_name: firstName,
        username,
      },
      chat: {
        id: chatId,
        type: chatType,
      },
      date: Math.floor(Date.now() / 1000),
      text,
    },
  };
}

/**
 * Creates a command update (e.g., /start, /new, /status).
 */
export function createCommandUpdate(
  command: string,
  overrides: Parameters<typeof createMessageUpdate>[0] = {}
): TelegramUpdate {
  return createMessageUpdate({
    text: `/${command}`,
    ...overrides,
  });
}

/**
 * Creates a voice message update.
 */
export function createVoiceUpdate(
  overrides: Partial<{
    chatId: number;
    userId: number;
    messageId: number;
    duration: number;
    fileId: string;
    fileSize: number;
    chatType: "private" | "group" | "supergroup";
  }> = {}
): TelegramUpdate {
  const {
    chatId = Number(TEST_USER_1),
    userId = Number(TEST_USER_1),
    messageId = Date.now(),
    duration = 5,
    fileId = "voice-file-id-123",
    fileSize = 1024,
    chatType = "private",
  } = overrides;

  return {
    update_id: Date.now(),
    message: {
      message_id: messageId,
      from: {
        id: userId,
        is_bot: false,
        first_name: "Test",
      },
      chat: {
        id: chatId,
        type: chatType,
      },
      date: Math.floor(Date.now() / 1000),
      voice: {
        file_id: fileId,
        file_unique_id: `unique-${fileId}`,
        duration,
        file_size: fileSize,
      },
    },
  };
}

/**
 * Creates a callback query update (inline button click).
 */
export function createCallbackQueryUpdate(
  data: string,
  overrides: Partial<{
    chatId: number;
    userId: number;
    queryId: string;
  }> = {}
): TelegramUpdate {
  const {
    chatId = Number(TEST_USER_1),
    userId = Number(TEST_USER_1),
    queryId = `query-${Date.now()}`,
  } = overrides;

  return {
    update_id: Date.now(),
    callback_query: {
      id: queryId,
      from: {
        id: userId,
        is_bot: false,
        first_name: "Test",
      },
      message: {
        message_id: Date.now(),
        from: {
          id: 12345, // Bot's ID
          is_bot: true,
          first_name: "Andee",
        },
        chat: {
          id: chatId,
          type: "private",
        },
        date: Math.floor(Date.now() / 1000),
        text: "Previous message",
      },
      data,
    },
  };
}

// ============================================================================
// TELEGRAM API MOCK RESPONSES
// ============================================================================

export const telegramApiResponses = {
  sendMessage: {
    ok: true,
    result: {
      message_id: 12345,
      from: { id: 12345, is_bot: true, first_name: "Andee" },
      chat: { id: Number(TEST_USER_1), type: "private" },
      date: Math.floor(Date.now() / 1000),
      text: "Response text",
    },
  },

  setMessageReaction: {
    ok: true,
    result: true,
  },

  getFile: {
    ok: true,
    result: {
      file_id: "test-file-id",
      file_unique_id: "test-unique-id",
      file_size: 1024,
      file_path: "voice/file_123.oga",
    },
  },

  editMessageText: {
    ok: true,
    result: {
      message_id: 12345,
      chat: { id: Number(TEST_USER_1), type: "private" },
      date: Math.floor(Date.now() / 1000),
      text: "Updated text",
    },
  },

  answerCallbackQuery: {
    ok: true,
    result: true,
  },

  error: {
    ok: false,
    error_code: 400,
    description: "Bad Request: message not found",
  },
};

// ============================================================================
// SESSION DATA
// ============================================================================

export const sessionData = {
  empty: {
    claudeSessionId: null,
    messageCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },

  active: {
    claudeSessionId: "session-abc-123",
    messageCount: 5,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-09T12:00:00.000Z",
  },

  withRestoreFlag: {
    claudeSessionId: "session-xyz-789",
    messageCount: 10,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-09T12:00:00.000Z",
    restoreSnapshotKey: "snapshots/999999999/999999999/2025-01-09T10-00-00-000Z.tar.gz",
  },
};

// ============================================================================
// SANDBOX WORKER MOCK RESPONSES
// ============================================================================

export const sandboxResponses = {
  reset: {
    success: true,
    message: "Sandbox reset successfully",
    snapshotKey: "snapshots/999999999/999999999/2025-01-09T10-00-00-000Z.tar.gz",
  },

  resetError: {
    success: false,
    error: "Failed to reset sandbox",
  },

  snapshot: {
    success: true,
    key: "snapshots/999999999/999999999/2025-01-09T10-00-00-000Z.tar.gz",
    size: 10240,
  },

  snapshotsList: {
    chatId: TEST_USER_1,
    count: 3,
    snapshots: [
      {
        key: "snapshots/999999999/999999999/2025-01-09T12-00-00-000Z.tar.gz",
        size: 10240,
        uploaded: "2025-01-09T12:00:00Z",
      },
      {
        key: "snapshots/999999999/999999999/2025-01-09T11-00-00-000Z.tar.gz",
        size: 8192,
        uploaded: "2025-01-09T11:00:00Z",
      },
      {
        key: "snapshots/999999999/999999999/2025-01-09T10-00-00-000Z.tar.gz",
        size: 6144,
        uploaded: "2025-01-09T10:00:00Z",
      },
    ],
  },

  snapshotsEmpty: {
    chatId: TEST_USER_1,
    count: 0,
    snapshots: [],
  },

  ask: {
    ok: true,
    message: "Request accepted",
  },
};

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Generate session R2 key for test user.
 */
export function getTestSessionKey(
  userId: string = TEST_USER_1,
  chatId: string = TEST_USER_1,
  isGroup: boolean = false
): string {
  if (isGroup) {
    return `sessions/groups/${chatId}.json`;
  }
  return `sessions/${userId}/${chatId}.json`;
}

/**
 * Create a unique test identifier to avoid collisions.
 */
export function uniqueTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
