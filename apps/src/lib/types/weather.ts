/**
 * Weather data types for the weather Mini App component.
 *
 * Skills send data in compact format to minimize URL length.
 * The component normalizes this to full format for rendering.
 */

/**
 * Weather data format from skills (REQUIRED extended format).
 * All fields must be present for the detailed 10x UI.
 * Typical size: 450-550 chars base64url encoded.
 */
export interface WeatherDataCompact {
  // Required basic fields
  loc: string; // Location name
  c: number; // Current temp (Celsius)
  f: number; // Current temp (Fahrenheit)
  fl: number; // Feels like (Celsius)
  ff: number; // Feels like (Fahrenheit)
  lo: number; // Low temp (Celsius)
  hi: number; // High temp (Celsius)
  wc: number; // Weather code (WMO standard)

  // Required extended fields (10x detailed UI)
  h: number; // Humidity percentage
  wd: number; // Wind speed (km/h)
  wdir: number; // Wind direction (0-360 degrees)
  p: number; // Precipitation probability (0-100)
  press: number; // Pressure (hPa)
  vis: number; // Visibility (km)
  uv: number; // UV index (0-12)
  desc: string; // Weather description (e.g., "Mostly Cloudy")
  sr: string; // Sunrise time (HH:mm)
  ss: string; // Sunset time (HH:mm)
  tz: string; // Timezone identifier
  hr: Array<{ // Hourly data (8+ hours required)
    t: string; // Time (HH:mm)
    c: number; // Temp Celsius
    wc: number; // Weather code
    p: number; // Precip probability
  }>;
}

/**
 * Full weather data format (after normalization).
 */
export interface WeatherDataFull {
  location: string;
  timezone: string;
  current: {
    temp_c: number;
    temp_f: number;
    feels_like_c: number;
    feels_like_f: number;
    weathercode: number;
    humidity: number; // 0-100%
    wind_speed: number; // km/h
    wind_direction: number; // 0-360°
    precip_prob: number; // 0-100%
    pressure: number; // hPa
    visibility: number; // km
    uv_index: number; // 0-12
    description: string; // Weather description
  };
  range: {
    low_c: number;
    low_f: number;
    high_c: number;
    high_f: number;
  };
  sun: {
    sunrise: string; // HH:mm
    sunset: string; // HH:mm
  };
  hourly: Array<{
    time: string;
    temp_c: number;
    weathercode: number;
    precip_prob: number;
  }>;
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

  // Extended format required - all fields present
  return {
    location: data.loc,
    timezone: data.tz,
    current: {
      temp_c: data.c,
      temp_f: data.f,
      feels_like_c: data.fl,
      feels_like_f: data.ff,
      weathercode: data.wc,
      humidity: data.h,
      wind_speed: data.wd,
      wind_direction: data.wdir,
      precip_prob: data.p,
      pressure: data.press,
      visibility: data.vis,
      uv_index: data.uv,
      description: data.desc,
    },
    range: {
      low_c: data.lo,
      low_f: toFahrenheit(data.lo),
      high_c: data.hi,
      high_f: toFahrenheit(data.hi),
    },
    sun: {
      sunrise: data.sr,
      sunset: data.ss,
    },
    hourly: data.hr.map((h) => ({
      time: h.t,
      temp_c: h.c,
      weathercode: h.wc,
      precip_prob: h.p,
    })),
  };
}
