/**
 * Telegram WebApp utilities for Mini Apps.
 */

// Extend Window to include Telegram types
declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

export interface ThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
}

export interface TelegramWebApp {
  ready: () => void;
  expand: () => void;
  close: () => void;
  themeParams?: ThemeParams;
  initDataUnsafe?: {
    start_param?: string;
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
  };
  colorScheme?: "light" | "dark";
}

/**
 * Initialize Telegram WebApp and apply theme.
 * Call this once at component startup.
 */
export function initTelegram(): TelegramWebApp | null {
  const tg = window.Telegram?.WebApp;
  if (!tg) return null;

  tg.ready();
  tg.expand();
  applyTheme(tg.themeParams);

  return tg;
}

/**
 * Apply Telegram theme colors as CSS variables.
 */
export function applyTheme(params?: ThemeParams): void {
  if (!params) return;
  const root = document.documentElement.style;

  if (params.bg_color) root.setProperty("--bg-color", params.bg_color);
  if (params.text_color) root.setProperty("--text-color", params.text_color);
  if (params.hint_color) root.setProperty("--hint-color", params.hint_color);
  if (params.secondary_bg_color)
    root.setProperty("--card-bg", params.secondary_bg_color);
  if (params.link_color) root.setProperty("--accent", params.link_color);
}

/**
 * Get startapp parameter from Telegram or URL.
 * Used by shell router to determine which component to load.
 */
export function getStartParam(): string | null {
  const tg = window.Telegram?.WebApp;
  return (
    tg?.initDataUnsafe?.start_param ||
    new URLSearchParams(location.search).get("tgWebAppStartParam") ||
    new URLSearchParams(location.search).get("startapp") ||
    null
  );
}
