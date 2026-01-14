/**
 * Schedule endpoints: GET/PUT /schedule-config, GET /schedule-runs, POST /run-schedule-now
 * Manages recurring schedules via RecurringSchedulesDO.
 */

import {
  CORS_HEADERS,
  HandlerContext,
  ScheduleConfig,
  SaveScheduleConfigRequest,
  getRecurringSchedulesDOId,
  getScheduleConfigKey,
} from "../types";
import type { RecurringSchedulesDO } from "../scheduler/RecurringSchedulesDO";
import * as yaml from "yaml";

/**
 * Get the RecurringSchedulesDO stub for a chat.
 */
function getRecurringSchedules(
  ctx: HandlerContext,
  chatId: string
): DurableObjectStub<RecurringSchedulesDO> {
  const id = ctx.env.RecurringSchedules.idFromName(
    getRecurringSchedulesDOId(chatId)
  );
  return ctx.env.RecurringSchedules.get(id);
}

/**
 * Parse YAML config from R2 or return null if not found.
 */
async function getConfigFromR2(
  ctx: HandlerContext,
  chatId: string
): Promise<ScheduleConfig | null> {
  const key = getScheduleConfigKey(chatId);
  const object = await ctx.env.SESSIONS.get(key);

  if (!object) return null;

  const text = await object.text();
  try {
    return yaml.parse(text) as ScheduleConfig;
  } catch (error) {
    console.error(`[Schedules] Failed to parse YAML for ${chatId}:`, error);
    return null;
  }
}

/**
 * Save YAML config to R2.
 */
async function saveConfigToR2(
  ctx: HandlerContext,
  chatId: string,
  config: ScheduleConfig
): Promise<void> {
  const key = getScheduleConfigKey(chatId);
  const yamlText = yaml.stringify(config);
  await ctx.env.SESSIONS.put(key, yamlText, {
    customMetadata: {
      chatId,
      updatedAt: new Date().toISOString(),
    },
  });
}

/**
 * GET /schedule-config?chatId=X
 * Get schedule config for a chat.
 * Returns both the raw YAML config and parsed schedules with next run times.
 */
export async function handleGetScheduleConfig(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const chatId = ctx.url.searchParams.get("chatId");

    if (!chatId) {
      return Response.json(
        { error: "Missing required query param: chatId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Get config from R2
    const config = await getConfigFromR2(ctx, chatId);

    if (!config) {
      // Return empty config if none exists
      return Response.json(
        {
          success: true,
          config: null,
          schedules: [],
        },
        { headers: CORS_HEADERS }
      );
    }

    // Get schedules with next run times from DO
    const recurringSchedules = getRecurringSchedules(ctx, chatId);
    const schedules = await recurringSchedules.getSchedules();

    return Response.json(
      {
        success: true,
        config,
        schedules,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Schedules] Get config error:", error);
    return Response.json(
      { success: false, error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * PUT /schedule-config
 * Save schedule config for a chat.
 * Saves to R2 and syncs to RecurringSchedulesDO.
 */
export async function handleSaveScheduleConfig(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as SaveScheduleConfigRequest;
    const { chatId, config, botToken } = body;

    if (!chatId || !config || !botToken) {
      return Response.json(
        { error: "Missing required fields: chatId, config, botToken" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Validate config structure
    if (!config.version || !config.timezone || !config.schedules) {
      return Response.json(
        { error: "Invalid config: missing version, timezone, or schedules" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Validate cron expressions (basic check)
    for (const [id, schedule] of Object.entries(config.schedules)) {
      if (!schedule.cron || !schedule.prompt) {
        return Response.json(
          { error: `Invalid schedule ${id}: missing cron or prompt` },
          { status: 400, headers: CORS_HEADERS }
        );
      }
    }

    // Save to R2
    await saveConfigToR2(ctx, chatId, config);

    // Sync to DO
    const recurringSchedules = getRecurringSchedules(ctx, chatId);
    const result = await recurringSchedules.syncFromConfig(chatId, config, botToken);

    if (!result.success) {
      return Response.json(result, { status: 400, headers: CORS_HEADERS });
    }

    // Get updated schedules with next run times
    const schedules = await recurringSchedules.getSchedules();

    console.log(
      `[Schedules] Config saved for chat ${chatId}: ${Object.keys(config.schedules).length} schedules`
    );

    return Response.json(
      {
        success: true,
        message: result.message,
        schedules,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Schedules] Save config error:", error);
    return Response.json(
      { success: false, error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * GET /schedule-runs?chatId=X&scheduleId=Y&limit=N
 * List execution history for schedules.
 */
export async function handleListScheduleRuns(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const chatId = ctx.url.searchParams.get("chatId");
    const scheduleId = ctx.url.searchParams.get("scheduleId");
    const limitStr = ctx.url.searchParams.get("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : 50;

    if (!chatId) {
      return Response.json(
        { error: "Missing required query param: chatId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const recurringSchedules = getRecurringSchedules(ctx, chatId);
    const result = await recurringSchedules.listExecutions(
      scheduleId ?? undefined,
      limit
    );

    return Response.json(result, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[Schedules] List runs error:", error);
    return Response.json(
      { success: false, error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * POST /run-schedule-now
 * Manually trigger a schedule execution (for testing).
 */
export async function handleRunScheduleNow(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as {
      chatId: string;
      scheduleId: string;
    };
    const { chatId, scheduleId } = body;

    if (!chatId || !scheduleId) {
      return Response.json(
        { error: "Missing required fields: chatId, scheduleId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const recurringSchedules = getRecurringSchedules(ctx, chatId);
    const result = await recurringSchedules.runNow(scheduleId);

    console.log(
      `[Schedules] Manual run for ${chatId}/${scheduleId}: ${result.success ? "success" : result.error}`
    );

    return Response.json(result, {
      status: result.success ? 200 : 400,
      headers: CORS_HEADERS,
    });
  } catch (error) {
    console.error("[Schedules] Run now error:", error);
    return Response.json(
      { success: false, error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * POST /toggle-schedule
 * Enable or disable a schedule.
 */
export async function handleToggleSchedule(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const body = (await ctx.request.json()) as {
      chatId: string;
      scheduleId: string;
      enabled: boolean;
    };
    const { chatId, scheduleId, enabled } = body;

    if (!chatId || !scheduleId || typeof enabled !== "boolean") {
      return Response.json(
        { error: "Missing required fields: chatId, scheduleId, enabled" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const recurringSchedules = getRecurringSchedules(ctx, chatId);
    const result = await recurringSchedules.toggleSchedule(scheduleId, enabled);

    // Also update the R2 config to keep it in sync
    if (result.success) {
      const config = await getConfigFromR2(ctx, chatId);
      if (config && config.schedules[scheduleId]) {
        config.schedules[scheduleId].enabled = enabled;
        await saveConfigToR2(ctx, chatId, config);
      }
    }

    console.log(
      `[Schedules] Toggle ${chatId}/${scheduleId} to ${enabled}: ${result.success ? "success" : result.error}`
    );

    return Response.json(result, {
      status: result.success ? 200 : 400,
      headers: CORS_HEADERS,
    });
  } catch (error) {
    console.error("[Schedules] Toggle error:", error);
    return Response.json(
      { success: false, error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * GET /schedule-config-yaml?chatId=X
 * Get raw YAML config for IDE editing.
 */
export async function handleGetScheduleConfigYaml(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const chatId = ctx.url.searchParams.get("chatId");

    if (!chatId) {
      return Response.json(
        { error: "Missing required query param: chatId" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const key = getScheduleConfigKey(chatId);
    const object = await ctx.env.SESSIONS.get(key);

    if (!object) {
      // Return default template
      const defaultYaml = `version: "1.0"
timezone: "America/New_York"

schedules:
  # Example schedule (uncomment and modify):
  # morning-weather:
  #   description: "Daily morning weather report"
  #   cron: "0 6 * * *"    # 6:00 AM daily
  #   enabled: true
  #   prompt: |
  #     Good morning! Generate a weather report for Boston.
  #     Be warm and conversational.
`;
      return new Response(defaultYaml, {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/yaml",
        },
      });
    }

    const yamlText = await object.text();
    return new Response(yamlText, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/yaml",
      },
    });
  } catch (error) {
    console.error("[Schedules] Get YAML error:", error);
    return Response.json(
      { success: false, error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * PUT /schedule-config-yaml
 * Save raw YAML config from IDE.
 */
export async function handleSaveScheduleConfigYaml(
  ctx: HandlerContext
): Promise<Response> {
  try {
    const chatId = ctx.url.searchParams.get("chatId");
    const botToken = ctx.url.searchParams.get("botToken");

    if (!chatId || !botToken) {
      return Response.json(
        { error: "Missing required query params: chatId, botToken" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const yamlText = await ctx.request.text();

    // Parse and validate YAML
    let config: ScheduleConfig;
    try {
      config = yaml.parse(yamlText) as ScheduleConfig;
    } catch (parseError) {
      return Response.json(
        { error: `Invalid YAML: ${parseError}` },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (!config.version || !config.timezone || !config.schedules) {
      return Response.json(
        { error: "Invalid config: missing version, timezone, or schedules" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Save to R2
    const key = getScheduleConfigKey(chatId);
    await ctx.env.SESSIONS.put(key, yamlText, {
      customMetadata: {
        chatId,
        updatedAt: new Date().toISOString(),
      },
    });

    // Sync to DO
    const recurringSchedules = getRecurringSchedules(ctx, chatId);
    const result = await recurringSchedules.syncFromConfig(chatId, config, botToken);

    if (!result.success) {
      return Response.json(result, { status: 400, headers: CORS_HEADERS });
    }

    const schedules = await recurringSchedules.getSchedules();

    console.log(
      `[Schedules] YAML config saved for chat ${chatId}: ${Object.keys(config.schedules).length} schedules`
    );

    return Response.json(
      {
        success: true,
        message: result.message,
        schedules,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("[Schedules] Save YAML error:", error);
    return Response.json(
      { success: false, error: String(error) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
