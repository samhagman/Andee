/**
 * Weather data types for the weather Mini App component.
 *
 * Skills send data in compact format to minimize URL length.
 * The component normalizes this to full format for rendering.
 */

/**
 * Compact weather data format from skills.
 * Keep under 300 chars when JSON-encoded to avoid URL issues.
 */
export interface WeatherDataCompact {
  loc: string; // Location name
  c: number; // Current temp (Celsius)
  f?: number; // Current temp (Fahrenheit) - derived if missing
  fl?: number; // Feels like (Celsius)
  ff?: number; // Feels like (Fahrenheit) - derived if missing
  lo: number; // Low temp (Celsius)
  hi: number; // High temp (Celsius)
  wc: number; // Weather code (WMO standard)
}

/**
 * Full weather data format (after normalization).
 */
export interface WeatherDataFull {
  location: string;
  current: {
    temp_c: number;
    temp_f: number;
    feels_like_c: number;
    feels_like_f: number;
    weathercode: number;
  };
  range: {
    low_c: number;
    low_f: number;
    high_c: number;
    high_f: number;
  };
  transitions: Array<{
    emoji: string;
    type: string;
    start: string;
    end: string;
  }>;
  hourly: Array<{
    time: string;
    temp_c: number;
    weathercode: number;
    precip_prob: number;
  }>;
  generated_at?: string;
}

/**
 * Union type for weather data (can be compact or full).
 */
export type WeatherData = WeatherDataCompact | WeatherDataFull;

/**
 * Type guard for compact weather data.
 */
export function isCompactFormat(data: WeatherData): data is WeatherDataCompact {
  return "loc" in data;
}

/**
 * Convert Celsius to Fahrenheit.
 */
export function toFahrenheit(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

/**
 * Normalize compact data to full format.
 */
export function normalizeWeatherData(data: WeatherData): WeatherDataFull {
  if (!isCompactFormat(data)) {
    return data;
  }

  return {
    location: data.loc,
    current: {
      temp_c: data.c,
      temp_f: data.f ?? toFahrenheit(data.c),
      feels_like_c: data.fl ?? data.c,
      feels_like_f: data.ff ?? toFahrenheit(data.fl ?? data.c),
      weathercode: data.wc ?? 0,
    },
    range: {
      low_c: data.lo,
      low_f: toFahrenheit(data.lo),
      high_c: data.hi,
      high_f: toFahrenheit(data.hi),
    },
    transitions: [],
    hourly: [],
  };
}
