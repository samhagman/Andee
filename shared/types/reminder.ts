/**
 * Reminder data types for the proactive messaging system.
 * Used by SchedulerDO to manage reminder alarms.
 */

/**
 * Reminder status lifecycle:
 * - pending: Scheduled, waiting to fire
 * - completed: Successfully sent to Telegram
 * - cancelled: Cancelled before firing
 * - failed: Failed to send after all retries
 */
export type ReminderStatus = "pending" | "completed" | "cancelled" | "failed";

/**
 * Core reminder data stored in SchedulerDO SQLite.
 * This is the lightweight pointer - full content lives in container artifacts.
 */
export interface ReminderData {
  id: string; // UUID (matches artifact uuid)
  chatId: string; // Telegram chat to message
  senderId: string; // User who set the reminder
  isGroup: boolean; // true = group chat, false = private
  triggerAt: number; // Unix timestamp in ms
  message: string; // Short reminder text (shown in Telegram)
  status: ReminderStatus;
  createdAt: number; // Unix timestamp in ms
  botToken: string; // Telegram bot token for sending
}

/**
 * Request to schedule a new reminder.
 * Called by container via POST /schedule-reminder.
 */
export interface ScheduleReminderRequest {
  senderId: string;
  chatId: string;
  isGroup: boolean;
  reminderId: string; // UUID from artifact
  triggerAt: number; // Unix timestamp in ms
  message: string;
  botToken: string;
}

/**
 * Request to cancel a pending reminder.
 */
export interface CancelReminderRequest {
  senderId: string;
  reminderId: string;
}

/**
 * Request to manually complete a reminder.
 */
export interface CompleteReminderRequest {
  senderId: string;
  reminderId: string;
}

/**
 * Request to list reminders for a user.
 */
export interface ListRemindersRequest {
  senderId: string;
  status?: ReminderStatus;
}

/**
 * Response from reminder operations.
 */
export interface ReminderResponse {
  success: boolean;
  message?: string;
  reminder?: ReminderData;
  error?: string;
}

/**
 * Response from listing reminders.
 */
export interface ListRemindersResponse {
  success: boolean;
  reminders: ReminderData[];
  error?: string;
}

/**
 * Generates the SchedulerDO ID for a user.
 * One SchedulerDO per user (senderId).
 */
export function getSchedulerDOId(senderId: string): string {
  return `scheduler-${senderId}`;
}
