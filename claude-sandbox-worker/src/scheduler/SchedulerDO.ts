/**
 * SchedulerDO - Durable Object for managing reminder alarms.
 *
 * One instance per user (keyed by senderId). Manages a SQLite-backed
 * queue of reminders and uses DO alarms to trigger them at the right time.
 *
 * Key behaviors:
 * - Only ONE alarm at a time per DO (Cloudflare limitation)
 * - Alarm always points to the soonest pending reminder
 * - When alarm fires, process ALL due reminders, then set next alarm
 */

import { DurableObject } from "cloudflare:workers";
import type {
  ReminderData,
  ReminderStatus,
  ScheduleReminderRequest,
  ReminderResponse,
  ListRemindersResponse,
} from "../../../shared";

/**
 * SQLite row type for reminders table.
 */
interface ReminderRow {
  id: string;
  chat_id: string;
  sender_id: string;
  is_group: number; // SQLite doesn't have boolean
  trigger_at: number;
  message: string;
  status: string;
  created_at: number;
  bot_token: string;
}

/**
 * Environment bindings needed by SchedulerDO.
 */
interface SchedulerEnv {
  // Add any env bindings needed (currently none)
}

/**
 * SchedulerDO manages reminder scheduling using DO alarms.
 */
export class SchedulerDO extends DurableObject<SchedulerEnv> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: SchedulerEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initializeSchema();
  }

  /**
   * Initialize SQLite schema if not exists.
   */
  private initializeSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        is_group INTEGER NOT NULL,
        trigger_at INTEGER NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        bot_token TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pending_trigger
        ON reminders(trigger_at) WHERE status = 'pending';
    `);
  }

  /**
   * Schedule a new reminder.
   * Creates the reminder and sets/updates the DO alarm if needed.
   */
  async schedule(req: ScheduleReminderRequest): Promise<ReminderResponse> {
    const now = Date.now();

    // Check for duplicate
    const existing = this.sql
      .exec("SELECT id FROM reminders WHERE id = ?", req.reminderId)
      .toArray();
    if (existing.length > 0) {
      return {
        success: false,
        error: `Reminder ${req.reminderId} already exists`,
      };
    }

    // Validate trigger time is in the future (allow 1 minute grace)
    if (req.triggerAt < now - 60000) {
      return {
        success: false,
        error: "Trigger time must be in the future",
      };
    }

    // Insert the reminder
    this.sql.exec(
      `INSERT INTO reminders (id, chat_id, sender_id, is_group, trigger_at, message, status, created_at, bot_token)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      req.reminderId,
      req.chatId,
      req.senderId,
      req.isGroup ? 1 : 0,
      req.triggerAt,
      req.message,
      now,
      req.botToken
    );

    // Update alarm to point to soonest reminder
    await this.updateAlarm();

    const reminder = this.getReminder(req.reminderId);
    return {
      success: true,
      message: "Reminder scheduled",
      reminder: reminder ?? undefined,
    };
  }

  /**
   * Cancel a pending reminder.
   */
  async cancel(reminderId: string): Promise<ReminderResponse> {
    const reminder = this.getReminder(reminderId);
    if (!reminder) {
      return {
        success: false,
        error: `Reminder ${reminderId} not found`,
      };
    }

    if (reminder.status !== "pending") {
      return {
        success: false,
        error: `Reminder ${reminderId} is already ${reminder.status}`,
      };
    }

    this.sql.exec(
      "UPDATE reminders SET status = 'cancelled' WHERE id = ?",
      reminderId
    );

    // Update alarm (may need to point to different reminder now)
    await this.updateAlarm();

    return {
      success: true,
      message: "Reminder cancelled",
    };
  }

  /**
   * Mark a reminder as completed.
   */
  async complete(reminderId: string): Promise<ReminderResponse> {
    const reminder = this.getReminder(reminderId);
    if (!reminder) {
      return {
        success: false,
        error: `Reminder ${reminderId} not found`,
      };
    }

    this.sql.exec(
      "UPDATE reminders SET status = 'completed' WHERE id = ?",
      reminderId
    );

    return {
      success: true,
      message: "Reminder completed",
    };
  }

  /**
   * List reminders, optionally filtered by status.
   */
  list(status?: ReminderStatus): ListRemindersResponse {
    let rows: ReminderRow[];
    if (status) {
      rows = this.sql
        .exec(
          "SELECT * FROM reminders WHERE status = ? ORDER BY trigger_at ASC",
          status
        )
        .toArray() as unknown as ReminderRow[];
    } else {
      rows = this.sql
        .exec("SELECT * FROM reminders ORDER BY trigger_at ASC")
        .toArray() as unknown as ReminderRow[];
    }

    return {
      success: true,
      reminders: rows.map(this.rowToReminder),
    };
  }

  /**
   * DO alarm handler - called when the scheduled alarm time arrives.
   * Processes all due reminders and sends them to Telegram.
   *
   * IMPORTANT: This handler should NOT throw - Cloudflare retries on throw.
   * Handle all errors gracefully within the handler.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    console.log(`[SchedulerDO] Alarm fired at ${new Date(now).toISOString()}`);

    try {
      // Get all due pending reminders
      const dueRows = this.sql
        .exec(
          "SELECT * FROM reminders WHERE status = 'pending' AND trigger_at <= ?",
          now
        )
        .toArray() as unknown as ReminderRow[];

      console.log(`[SchedulerDO] Processing ${dueRows.length} due reminders`);

      // Process each due reminder
      for (const row of dueRows) {
        const reminder = this.rowToReminder(row);
        try {
          await this.sendReminderToTelegram(reminder);
          // Mark as completed on success
          this.sql.exec(
            "UPDATE reminders SET status = 'completed' WHERE id = ?",
            reminder.id
          );
          console.log(`[SchedulerDO] Sent reminder ${reminder.id}: ${reminder.message}`);
        } catch (error) {
          // Mark as failed to prevent infinite retries
          // In production, could implement retry count logic
          console.error(
            `[SchedulerDO] Failed to send reminder ${reminder.id}:`,
            error
          );
          this.sql.exec(
            "UPDATE reminders SET status = 'failed' WHERE id = ?",
            reminder.id
          );
          console.log(`[SchedulerDO] Marked reminder ${reminder.id} as failed`);
        }
      }

      // Set alarm for next pending reminder
      await this.updateAlarm();
    } catch (error) {
      // Catch any unexpected errors to prevent infinite retries
      console.error("[SchedulerDO] Unexpected error in alarm handler:", error);
    }
  }

  /**
   * Send a reminder message to Telegram.
   */
  private async sendReminderToTelegram(reminder: ReminderData): Promise<void> {
    const url = `https://api.telegram.org/bot${reminder.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: reminder.chatId,
        text: `⏰ **Reminder**\n\n${reminder.message}`,
        parse_mode: "MarkdownV2",
      }),
    });

    if (!response.ok) {
      // Try without markdown if it fails
      const plainResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: reminder.chatId,
          text: `⏰ Reminder\n\n${reminder.message}`,
        }),
      });

      if (!plainResponse.ok) {
        const errorText = await plainResponse.text();
        throw new Error(`Telegram API error: ${plainResponse.status} - ${errorText}`);
      }
    }
  }

  /**
   * Update the DO alarm to point to the soonest pending reminder.
   */
  private async updateAlarm(): Promise<void> {
    // Find the soonest pending reminder
    const rows = this.sql
      .exec(
        "SELECT trigger_at FROM reminders WHERE status = 'pending' ORDER BY trigger_at ASC LIMIT 1"
      )
      .toArray() as { trigger_at: number }[];

    if (rows.length === 0) {
      // No pending reminders, delete any existing alarm
      await this.ctx.storage.deleteAlarm();
      console.log("[SchedulerDO] No pending reminders, alarm cleared");
      return;
    }

    const nextTrigger = rows[0].trigger_at;
    const currentAlarm = await this.ctx.storage.getAlarm();

    // Only update if different (avoid unnecessary writes)
    if (currentAlarm !== nextTrigger) {
      await this.ctx.storage.setAlarm(nextTrigger);
      console.log(
        `[SchedulerDO] Alarm set for ${new Date(nextTrigger).toISOString()}`
      );
    }
  }

  /**
   * Get a single reminder by ID.
   */
  private getReminder(id: string): ReminderData | null {
    const rows = this.sql
      .exec("SELECT * FROM reminders WHERE id = ?", id)
      .toArray() as unknown as ReminderRow[];
    if (rows.length === 0) return null;
    return this.rowToReminder(rows[0]);
  }

  /**
   * Convert a SQLite row to ReminderData.
   */
  private rowToReminder(row: ReminderRow): ReminderData {
    return {
      id: row.id,
      chatId: row.chat_id,
      senderId: row.sender_id,
      isGroup: row.is_group === 1,
      triggerAt: row.trigger_at,
      message: row.message,
      status: row.status as ReminderStatus,
      createdAt: row.created_at,
      botToken: row.bot_token,
    };
  }
}
