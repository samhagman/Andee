/**
 * Reminder endpoints: POST /schedule-reminder, POST /cancel-reminder, etc.
 * Called by container to manage reminder scheduling via SchedulerDO.
 */

import {
  CORS_HEADERS,
  HandlerContext,
  ScheduleReminderRequest,
  CancelReminderRequest,
  CompleteReminderRequest,
  getSchedulerDOId,
} from "../types";
import type { SchedulerDO } from "../scheduler/SchedulerDO";

/**
 * Get the SchedulerDO stub for a user.
 */
function getScheduler(ctx: HandlerContext, senderId: string): DurableObjectStub<SchedulerDO> {
  const id = ctx.env.Scheduler.idFromName(getSchedulerDOId(senderId));
  return ctx.env.Scheduler.get(id);
}

/**
 * POST /schedule-reminder
 * Schedule a new reminder via SchedulerDO.
 */
export async function handleScheduleReminder(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as ScheduleReminderRequest;
    const { senderId, chatId, isGroup, reminderId, triggerAt, message, botToken } = body;

    // Validate required fields
    if (!senderId || !chatId || !reminderId || !triggerAt || !message || !botToken) {
      return Response.json(
        { error: "Missing required fields: senderId, chatId, reminderId, triggerAt, message, botToken" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Get SchedulerDO for this user
    const scheduler = getScheduler(ctx, senderId);

    // Call the schedule method
    const result = await scheduler.schedule(body);

    console.log(
      `[Worker] Reminder scheduled: ${reminderId} for ${new Date(triggerAt).toISOString()}`
    );

    return Response.json(result, {
      status: result.success ? 200 : 400,
      headers: CORS_HEADERS,
    });
  } catch (error) {
    console.error("[Worker] Schedule reminder error:", error);
    return Response.json(
      { success: false, error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * POST /cancel-reminder
 * Cancel a pending reminder.
 */
export async function handleCancelReminder(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as CancelReminderRequest;
    const { senderId, reminderId } = body;

    if (!senderId || !reminderId) {
      return Response.json(
        { error: "Missing required fields: senderId, reminderId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const scheduler = getScheduler(ctx, senderId);
    const result = await scheduler.cancel(reminderId);

    console.log(`[Worker] Reminder cancelled: ${reminderId}`);

    return Response.json(result, {
      status: result.success ? 200 : 400,
      headers: CORS_HEADERS,
    });
  } catch (error) {
    console.error("[Worker] Cancel reminder error:", error);
    return Response.json(
      { success: false, error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * POST /complete-reminder
 * Manually mark a reminder as completed.
 */
export async function handleCompleteReminder(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as CompleteReminderRequest;
    const { senderId, reminderId } = body;

    if (!senderId || !reminderId) {
      return Response.json(
        { error: "Missing required fields: senderId, reminderId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const scheduler = getScheduler(ctx, senderId);
    const result = await scheduler.complete(reminderId);

    console.log(`[Worker] Reminder completed: ${reminderId}`);

    return Response.json(result, {
      status: result.success ? 200 : 400,
      headers: CORS_HEADERS,
    });
  } catch (error) {
    console.error("[Worker] Complete reminder error:", error);
    return Response.json(
      { success: false, error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * GET /reminders?senderId=X&status=pending
 * List reminders for a user.
 */
export async function handleListReminders(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const senderId = ctx.url.searchParams.get("senderId");
    const status = ctx.url.searchParams.get("status") as
      | "pending"
      | "completed"
      | "cancelled"
      | null;

    if (!senderId) {
      return Response.json(
        { error: "Missing required query param: senderId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const scheduler = getScheduler(ctx, senderId);
    const result = await scheduler.list(status ?? undefined);

    return Response.json(result, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Worker] List reminders error:", error);
    return Response.json(
      { success: false, error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
