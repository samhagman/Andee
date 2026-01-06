/**
 * Andee Mini Apps Shared Library
 *
 * Common utilities for all Mini App components:
 * - Telegram WebApp initialization and theming
 * - Base64url encoding/decoding
 * - URL data extraction
 *
 * Usage:
 *   import { initTelegram, getData } from '../lib';
 *   import type { WeatherData } from '../lib/types';
 */

// Telegram utilities
export { initTelegram, applyTheme, getStartParam } from "./telegram";
export type { TelegramWebApp, ThemeParams } from "./telegram";

// Base64url encoding
export { encode, decode } from "./base64url";

// Data extraction
export { getData } from "./data";
export type { DataResult } from "./data";

// Types
export * from "./types";
