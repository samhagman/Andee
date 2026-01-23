/**
 * RecurringSchedulesDO - Durable Object for managing recurring scheduled prompts.
 *
 * One instance per chat (keyed by chatId). Manages a SQLite-backed
 * list of recurring schedules and uses DO alarms to trigger them.
 *
 * Key behaviors:
 * - Only ONE alarm at a time per DO (Cloudflare limitation)
 * - Alarm always points to the soonest enabled schedule's next_run_at
 * - When alarm fires, process due schedules, then calculate next runs and set alarm
 */

import { DurableObject } from "cloudflare:workers";
import type {
  ScheduleConfig,
  RecurringSchedule,
  ScheduleWithNextRun,
  ScheduleRow,
  ExecutionRow,
  ScheduleExecution,
  ScheduleExecutionStatus,
  ScheduleResponse,
  GetScheduleConfigResponse,
  ListExecutionsResponse,
} from "../../../shared";

// Simple cron parser - we'll use a minimal implementation
// to avoid external dependency issues in Cloudflare Workers
import { parseExpression } from "cron-parser";

/**
 * Environment bindings needed by RecurringSchedulesDO.
 */
interface RecurringSchedulesEnv {
  SESSIONS: R2Bucket;
  ANDEE_API_KEY?: string;
}

/**
 * Internal request for executing a schedule (passed to worker).
 */
interface ExecuteRequest {
  chatId: string;
  scheduleId: string;
  prompt: string;
  botToken: string;
}

/**
 * RecurringSchedulesDO manages recurring schedule timing using DO alarms.
 */
export class RecurringSchedulesDO extends DurableObject<RecurringSchedulesEnv> {
  private sql: SqlStorage;
  private chatId: string | null = null;
  private botToken: string | null = null;

  constructor(ctx: DurableObjectState, env: RecurringSchedulesEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initializeSchema();
  }

  /**
   * Initialize SQLite schema if not exists.
   */
  private initializeSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        cron TEXT NOT NULL,
        timezone TEXT NOT NULL,
        prompt TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        next_run_at INTEGER,
        last_run_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_enabled_next_run
        ON schedules(next_run_at) WHERE enabled = 1;

      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        executed_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        duration_ms INTEGER,
        FOREIGN KEY (schedule_id) REFERENCES schedules(id)
      );
      CREATE INDEX IF NOT EXISTS idx_executions_schedule
        ON executions(schedule_id, executed_at DESC);

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /**
   * Sync schedules from YAML config.
   * This replaces all schedules with the provided config.
   */
  async syncFromConfig(
    chatId: string,
    config: ScheduleConfig,
    botToken: string
  ): Promise<ScheduleResponse> {
    const now = Date.now();
    this.chatId = chatId;
    this.botToken = botToken;

    // Store metadata
    this.sql.exec(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
      "chatId",
      chatId
    );
    this.sql.exec(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
      "botToken",
      botToken
    );
    this.sql.exec(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
      "timezone",
      config.timezone
    );
    // Store API key for scheduled task execution
    if (this.env.ANDEE_API_KEY) {
      this.sql.exec(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
        "apiKey",
        this.env.ANDEE_API_KEY
      );
    }

    // Get existing schedule IDs
    const existingIds = new Set(
      (this.sql.exec("SELECT id FROM schedules").toArray() as { id: string }[]).map(
        (r) => r.id
      )
    );

    // Process each schedule in config
    const configIds = new Set(Object.keys(config.schedules));

    for (const [id, schedule] of Object.entries(config.schedules)) {
      const nextRunAt = this.calculateNextRun(schedule.cron, config.timezone);

      if (existingIds.has(id)) {
        // Update existing
        this.sql.exec(
          `UPDATE schedules SET
            description = ?, cron = ?, timezone = ?, prompt = ?,
            enabled = ?, next_run_at = ?, updated_at = ?
           WHERE id = ?`,
          schedule.description,
          schedule.cron,
          config.timezone,
          schedule.prompt,
          schedule.enabled ? 1 : 0,
          nextRunAt,
          now,
          id
        );
      } else {
        // Insert new
        this.sql.exec(
          `INSERT INTO schedules (id, description, cron, timezone, prompt, enabled, next_run_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          schedule.description,
          schedule.cron,
          config.timezone,
          schedule.prompt,
          schedule.enabled ? 1 : 0,
          nextRunAt,
          now,
          now
        );
      }
    }

    // Delete schedules not in config
    for (const id of existingIds) {
      if (!configIds.has(id)) {
        this.sql.exec("DELETE FROM schedules WHERE id = ?", id);
        // Also delete related executions (cleanup)
        this.sql.exec("DELETE FROM executions WHERE schedule_id = ?", id);
      }
    }

    // Update alarm to next due schedule
    await this.updateAlarm();

    console.log(
      `[RecurringSchedulesDO] Synced ${configIds.size} schedules for chat ${chatId}`
    );

    return { success: true, message: `Synced ${configIds.size} schedules` };
  }

  /**
   * Get all schedules with next run info.
   */
  getSchedules(): ScheduleWithNextRun[] {
    const rows = this.sql
      .exec("SELECT * FROM schedules ORDER BY next_run_at ASC")
      .toArray() as unknown as ScheduleRow[];

    return rows.map((row) => ({
      id: row.id,
      description: row.description,
      cron: row.cron,
      timezone: row.timezone,
      prompt: row.prompt,
      enabled: row.enabled === 1,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
    }));
  }

  /**
   * Get a specific schedule by ID.
   */
  getSchedule(id: string): ScheduleWithNextRun | null {
    const rows = this.sql
      .exec("SELECT * FROM schedules WHERE id = ?", id)
      .toArray() as unknown as ScheduleRow[];

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      description: row.description,
      cron: row.cron,
      timezone: row.timezone,
      prompt: row.prompt,
      enabled: row.enabled === 1,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
    };
  }

  /**
   * Toggle a schedule's enabled state.
   */
  async toggleSchedule(id: string, enabled: boolean): Promise<ScheduleResponse> {
    const schedule = this.getSchedule(id);
    if (!schedule) {
      return { success: false, error: `Schedule ${id} not found` };
    }

    const now = Date.now();
    let nextRunAt: number | null = null;

    if (enabled) {
      nextRunAt = this.calculateNextRun(schedule.cron, schedule.timezone);
    }

    this.sql.exec(
      "UPDATE schedules SET enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?",
      enabled ? 1 : 0,
      nextRunAt,
      now,
      id
    );

    await this.updateAlarm();

    return {
      success: true,
      message: `Schedule ${id} ${enabled ? "enabled" : "disabled"}`,
    };
  }

  /**
   * List recent executions for a schedule or all schedules.
   */
  listExecutions(scheduleId?: string, limit = 50): ListExecutionsResponse {
    let rows: ExecutionRow[];

    if (scheduleId) {
      rows = this.sql
        .exec(
          "SELECT * FROM executions WHERE schedule_id = ? ORDER BY executed_at DESC LIMIT ?",
          scheduleId,
          limit
        )
        .toArray() as unknown as ExecutionRow[];
    } else {
      rows = this.sql
        .exec(
          "SELECT * FROM executions ORDER BY executed_at DESC LIMIT ?",
          limit
        )
        .toArray() as unknown as ExecutionRow[];
    }

    return {
      success: true,
      executions: rows.map((row) => ({
        id: row.id,
        scheduleId: row.schedule_id,
        executedAt: row.executed_at,
        status: row.status as ScheduleExecutionStatus,
        error: row.error ?? undefined,
        durationMs: row.duration_ms ?? undefined,
      })),
    };
  }

  /**
   * DO alarm handler - called when the scheduled alarm time arrives.
   * Processes all due schedules and executes them.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    console.log(
      `[RecurringSchedulesDO] Alarm fired at ${new Date(now).toISOString()}`
    );

    try {
      // Get metadata
      const chatIdRow = this.sql
        .exec("SELECT value FROM metadata WHERE key = 'chatId'")
        .toArray() as { value: string }[];
      const botTokenRow = this.sql
        .exec("SELECT value FROM metadata WHERE key = 'botToken'")
        .toArray() as { value: string }[];

      if (chatIdRow.length === 0 || botTokenRow.length === 0) {
        console.error("[RecurringSchedulesDO] Missing chatId or botToken in metadata");
        return;
      }

      const chatId = chatIdRow[0].value;
      const botToken = botTokenRow[0].value;

      // Get all due enabled schedules
      const dueRows = this.sql
        .exec(
          "SELECT * FROM schedules WHERE enabled = 1 AND next_run_at <= ?",
          now
        )
        .toArray() as unknown as ScheduleRow[];

      console.log(
        `[RecurringSchedulesDO] Processing ${dueRows.length} due schedules`
      );

      // Process each due schedule
      for (const row of dueRows) {
        const executionId = crypto.randomUUID();
        const startTime = Date.now();

        try {
          // Execute the schedule by calling /scheduled-task endpoint
          await this.executeSchedule({
            chatId,
            scheduleId: row.id,
            prompt: row.prompt,
            botToken,
          });

          // Log successful execution
          const durationMs = Date.now() - startTime;
          this.sql.exec(
            `INSERT INTO executions (id, schedule_id, executed_at, status, duration_ms)
             VALUES (?, ?, ?, 'completed', ?)`,
            executionId,
            row.id,
            now,
            durationMs
          );

          console.log(
            `[RecurringSchedulesDO] Executed schedule ${row.id} in ${durationMs}ms`
          );
        } catch (error) {
          // Log failed execution
          const durationMs = Date.now() - startTime;
          const errorMsg = error instanceof Error ? error.message : String(error);

          this.sql.exec(
            `INSERT INTO executions (id, schedule_id, executed_at, status, error, duration_ms)
             VALUES (?, ?, ?, 'failed', ?, ?)`,
            executionId,
            row.id,
            now,
            errorMsg,
            durationMs
          );

          console.error(
            `[RecurringSchedulesDO] Failed to execute schedule ${row.id}:`,
            error
          );
        }

        // Calculate and update next run time
        const nextRunAt = this.calculateNextRun(row.cron, row.timezone);
        this.sql.exec(
          "UPDATE schedules SET next_run_at = ?, last_run_at = ? WHERE id = ?",
          nextRunAt,
          now,
          row.id
        );
      }

      // Set alarm for next due schedule
      await this.updateAlarm();

      // Cleanup old executions (keep last 30 days)
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      this.sql.exec("DELETE FROM executions WHERE executed_at < ?", thirtyDaysAgo);
    } catch (error) {
      console.error(
        "[RecurringSchedulesDO] Unexpected error in alarm handler:",
        error
      );
    }
  }

  /**
   * Execute a schedule by calling the /scheduled-task endpoint.
   * This will wake the container and run the prompt.
   */
  private async executeSchedule(req: ExecuteRequest): Promise<void> {
    // Get API key from env (preferred) or metadata (fallback)
    let apiKey = this.env.ANDEE_API_KEY;
    if (!apiKey) {
      const apiKeyRow = this.sql
        .exec("SELECT value FROM metadata WHERE key = 'apiKey'")
        .toArray() as { value: string }[];
      if (apiKeyRow.length > 0) {
        apiKey = apiKeyRow[0].value;
      }
    }

    // In local development, wrangler runs on localhost:8787
    // In production, use the workers.dev URL
    // We can detect local dev by checking if the API key starts with "adk_" and
    // seeing if we can reach localhost. For simplicity, try localhost first in dev.
    const workerUrls = [
      "http://127.0.0.1:8787", // Local dev (try first)
      "https://claude-sandbox-worker.h2c.workers.dev", // Production
    ];

    let lastError: Error | null = null;

    for (const workerUrl of workerUrls) {
      try {
        console.log(`[RecurringSchedulesDO] Trying ${workerUrl}/scheduled-task`);

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Scheduled-Task": "true",
        };
        if (apiKey) {
          headers["X-API-Key"] = apiKey;
        }

        const response = await fetch(`${workerUrl}/scheduled-task`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            chatId: req.chatId,
            senderId: "system",
            isGroup: req.chatId.startsWith("-"),
            scheduleId: req.scheduleId,
            prompt: req.prompt,
            botToken: req.botToken,
          }),
        });

        if (response.ok) {
          console.log(`[RecurringSchedulesDO] Successfully executed via ${workerUrl}`);
          return;
        }

        const text = await response.text();
        lastError = new Error(`${response.status} - ${text}`);
        console.log(`[RecurringSchedulesDO] Failed with ${workerUrl}: ${lastError.message}`);

        // If we got auth error (401), try the next URL
        if (response.status === 401) continue;

        // For other errors, also try next URL
        continue;
      } catch (error) {
        // Network error (localhost not reachable), try next URL
        lastError = error instanceof Error ? error : new Error(String(error));
        console.log(`[RecurringSchedulesDO] Network error with ${workerUrl}: ${lastError.message}`);
        continue;
      }
    }

    throw new Error(`Failed to execute scheduled task: ${lastError?.message || "Unknown error"}`);
  }

  /**
   * Calculate the next run time for a cron expression.
   */
  private calculateNextRun(cron: string, timezone: string): number | null {
    try {
      const interval = parseExpression(cron, {
        currentDate: new Date(),
        tz: timezone,
      });
      const next = interval.next();
      return next.getTime();
    } catch (error) {
      console.error(
        `[RecurringSchedulesDO] Failed to parse cron "${cron}":`,
        error
      );
      return null;
    }
  }

  /**
   * Update the DO alarm to point to the soonest enabled schedule.
   */
  private async updateAlarm(): Promise<void> {
    // Find the soonest enabled schedule with a next_run_at
    const rows = this.sql
      .exec(
        "SELECT next_run_at FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL ORDER BY next_run_at ASC LIMIT 1"
      )
      .toArray() as { next_run_at: number }[];

    if (rows.length === 0) {
      // No enabled schedules, delete any existing alarm
      await this.ctx.storage.deleteAlarm();
      console.log("[RecurringSchedulesDO] No enabled schedules, alarm cleared");
      return;
    }

    const nextTrigger = rows[0].next_run_at;
    const currentAlarm = await this.ctx.storage.getAlarm();

    // Only update if different (avoid unnecessary writes)
    if (currentAlarm !== nextTrigger) {
      await this.ctx.storage.setAlarm(nextTrigger);
      console.log(
        `[RecurringSchedulesDO] Alarm set for ${new Date(nextTrigger).toISOString()}`
      );
    }
  }

  /**
   * Manually trigger a schedule execution (for testing via "Run Now").
   */
  async runNow(scheduleId: string): Promise<ScheduleResponse> {
    const schedule = this.getSchedule(scheduleId);
    if (!schedule) {
      return { success: false, error: `Schedule ${scheduleId} not found` };
    }

    // Get metadata
    const chatIdRow = this.sql
      .exec("SELECT value FROM metadata WHERE key = 'chatId'")
      .toArray() as { value: string }[];
    const botTokenRow = this.sql
      .exec("SELECT value FROM metadata WHERE key = 'botToken'")
      .toArray() as { value: string }[];

    if (chatIdRow.length === 0 || botTokenRow.length === 0) {
      return { success: false, error: "Missing chatId or botToken" };
    }

    const chatId = chatIdRow[0].value;
    const botToken = botTokenRow[0].value;

    const executionId = crypto.randomUUID();
    const now = Date.now();
    const startTime = now;

    try {
      await this.executeSchedule({
        chatId,
        scheduleId,
        prompt: schedule.prompt,
        botToken,
      });

      const durationMs = Date.now() - startTime;
      this.sql.exec(
        `INSERT INTO executions (id, schedule_id, executed_at, status, duration_ms)
         VALUES (?, ?, ?, 'completed', ?)`,
        executionId,
        scheduleId,
        now,
        durationMs
      );

      return { success: true, message: `Schedule ${scheduleId} executed` };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.sql.exec(
        `INSERT INTO executions (id, schedule_id, executed_at, status, error, duration_ms)
         VALUES (?, ?, ?, 'failed', ?, ?)`,
        executionId,
        scheduleId,
        now,
        errorMsg,
        durationMs
      );

      return { success: false, error: errorMsg };
    }
  }
}
