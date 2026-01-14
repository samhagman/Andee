---
name: weather
description: Get weather information including current conditions, temperature ranges, hourly forecast, weather transitions, and clothing recommendations. Use when user asks about weather, temperature, what to wear, if they need an umbrella, jacket, layers, or asks about outdoor activity timing.
---

# Weather Skill

Provides weather information with a conversational summary and a Mini App button for detailed view.

**IMPORTANT: Follow the telegram-response skill guidelines for formatting. Use natural markdown.**

## Instructions

When the user asks about weather, follow these steps:

### 1. Determine Location

Extract city/location from the user's message. If not specified, use the default.

**Default location:** Boston, MA (lat: 42.3601, lon: -71.0589)

**Common locations for reference:**
| City | Latitude | Longitude |
|------|----------|-----------|
| Boston | 42.3601 | -71.0589 |
| New York | 40.7128 | -74.0060 |
| San Francisco | 37.7749 | -122.4194 |
| Los Angeles | 34.0522 | -118.2437 |
| Chicago | 41.8781 | -87.6298 |
| London | 51.5074 | -0.1278 |
| Tokyo | 35.6762 | 139.6503 |
| Paris | 48.8566 | 2.3522 |

For other cities, use WebSearch to find coordinates.

### 2. Fetch Weather Data

Use WebFetch to call the Open-Meteo API with EXTENDED parameters for detailed Mini App:

```
https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}&current=temperature_2m,apparent_temperature,weather_code,precipitation,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,visibility,uv_index&hourly=temperature_2m,precipitation_probability,weather_code&daily=sunrise,sunset&forecast_days=1&timezone=auto
```

**API Fields Used:**
- `current.temperature_2m` - Current temperature (Celsius)
- `current.apparent_temperature` - Feels like temperature
- `current.weather_code` - WMO weather code
- `current.relative_humidity_2m` - Humidity percentage
- `current.wind_speed_10m` - Wind speed (km/h)
- `current.wind_direction_10m` - Wind direction (0-360 degrees)
- `current.pressure_msl` - Sea level pressure (hPa)
- `current.visibility` - Visibility (meters, convert to km)
- `current.uv_index` - UV index
- `hourly.temperature_2m` - Hourly temperatures
- `hourly.precipitation_probability` - Hourly precipitation chance
- `hourly.weather_code` - Hourly weather codes
- `daily.sunrise[0]` - Sunrise time (HH:mm format)
- `daily.sunset[0]` - Sunset time (HH:mm format)
- `timezone` - Timezone from response header

### 3. Analyze the Data

From the API response, extract:

1. **Current conditions:**
   - `current.temperature_2m` (in Celsius)
   - `current.apparent_temperature` (feels like)
   - `current.weather_code`

2. **Today's temperature range:**
   - Find MIN and MAX from `hourly.temperature_2m` array
   - Convert to Fahrenheit: `F = C * 9/5 + 32`

3. **Weather transitions:**
   - Group consecutive hours with same weather_code
   - Identify when weather type changes (e.g., cloudy morning to rainy afternoon)

4. **Precipitation:**
   - Find hours where `precipitation_probability > 50%`
   - Note timing of likely precipitation

### 4. Generate Conversational Response

**CRITICAL FORMAT RULES:**

1. **Show both Celsius AND Fahrenheit** for ALL temperatures
2. **DO NOT include Sources section** - no citations, no links to data sources
3. **Use `**bold**` for headers** - NOT `###` markdown headers (they show as literal `###` text)
4. Use `_italic_` for alerts
5. **NO PREAMBLE** - Start DIRECTLY with the weather header. Do not add introductory text like "Based on the weather data...", "Here's the weather...", or "Let me create..."

**CRITICAL: USE SPECIFIC TIMES, NOT VAGUE PERIODS**

BAD: "morning", "afternoon", "evening", "later today"
GOOD: "6am-12pm", "starting around 7pm", "3pm-8pm"

Always include the specific hour when weather changes occur. The hourly data tells you exactly when - use it!

**RESPONSE STRUCTURE (in this exact order):**

1. **Header** - Location + date context
2. **Weather Alert** (if any) - Snow, rain, storms, extreme temps - with SPECIFIC TIME
3. **Temperature Range** - Low to high in both C and F
4. **Weather Timeline** - Pattern changes with SPECIFIC HOURS
5. **Clothing Recommendation** - What to wear/bring

**Response template:**
```
**{Location} Weather - {Date Context}**

_{Alert emoji} {Alert type}: {description} starting around {SPECIFIC TIME}_

Ranging {low}°C to {high}°C ({low_f}°F to {high_f}°F).

• {weather_emoji} {weather_type} ({START_HOUR}-{END_HOUR})
• {weather_emoji} {weather_type} ({START_HOUR}-{END_HOUR})
• {weather_emoji} {weather_type} ({START_HOUR}-{END_HOUR})

{Clothing recommendation}.

[View Full Weather Report](https://t.me/HeyAndee_bot/app?startapp=weather_{BASE64URL_JSON})
```

**IMPORTANT:** Use the emoji from the Weather Code Reference table for each weather condition. Example: ☁️ for Overcast, ⛅ for Partly Cloudy, 🌨️ for Snow.

**Example response (with weather event):**
```
**Boston Weather - Tomorrow (Jan 5)**

_Snow Alert: Snow showers expected starting around 7pm_

Ranging -10°C to -3°C (14°F to 27°F).

• ⛅ Clear/Partly Cloudy (6am-6pm)
• 🌨️ Snow Showers (7pm-11pm)

Layer up with 4 layers, wear a scarf and gloves, and bring boots for the evening snow!

[View Full Weather Report](https://t.me/HeyAndee_bot/app?startapp=weather_eyJsb2Mi...)
```

**Example response (multiple transitions):**
```
**Boston Weather - Today**

Ranging -5°C to 3°C (23°F to 37°F).

• ☁️ Overcast (12am-6am)
• 🌨️ Light Snow (7am-10am)
• ⛅ Partly Cloudy (11am-4pm)
• ☁️ Cloudy (5pm-11pm)

Light jacket with a hat for the morning snow.

[View Full Weather Report](https://t.me/HeyAndee_bot/app?startapp=weather_eyJsb2Mi...)
```

**Example response (calm day, no alert needed):**
```
**Boston Weather - Today**

Ranging 5°C to 12°C (41°F to 54°F).

• ☁️ Overcast (6am-3pm)
• ⛅ Partly Cloudy (4pm-9pm)

A light jacket should be fine today.

[View Full Weather Report](https://t.me/HeyAndee_bot/app?startapp=weather_eyJsb2Mi...)
```

**When to include Weather Alert line:**
• Snow or rain expected (include start time)
• Thunderstorms
• Extreme cold (below -10°C / 14°F)
• Extreme heat (above 35°C / 95°F)
• High winds

**DO NOT ADD:**
- Sources section
- Citations or reference links
- Vague time references like "morning" or "evening" without specific hours

### 5. Generate Mini App Data

Create EXTENDED JSON with ALL fields. The Mini App requires the full detailed format.
Typical size: 450-550 chars base64url encoded.

**ALL FIELDS REQUIRED:**
```json
{
  "loc": "Boston",           // City name (short)
  "c": -2,                   // Current temp Celsius (integer)
  "f": 28,                   // Current temp Fahrenheit (integer)
  "fl": -7,                  // Feels like Celsius (integer)
  "ff": 19,                  // Feels like Fahrenheit (integer)
  "lo": -6,                  // Low temp Celsius (integer)
  "hi": -2,                  // High temp Celsius (integer)
  "wc": 3,                   // Weather code (WMO integer)
  "h": 82,                   // Humidity percentage (0-100)
  "wd": 15,                  // Wind speed (km/h)
  "wdir": 270,               // Wind direction (0-360 degrees, where 0=N, 90=E, 180=S, 270=W)
  "p": 65,                   // Precipitation probability (0-100)
  "press": 1013,             // Pressure (hPa)
  "vis": 8,                  // Visibility (km, convert from meters: meters/1000)
  "uv": 2.5,                 // UV index (0-12, can be decimal)
  "desc": "Mostly Cloudy",   // Weather description
  "sr": "07:15",             // Sunrise time (HH:mm format)
  "ss": "17:02",             // Sunset time (HH:mm format)
  "tz": "America/New_York",  // Timezone identifier
  "hr": [                    // Hourly forecast (8+ hours required)
    {"t": "00:00", "c": -3, "wc": 3, "p": 45},
    {"t": "03:00", "c": -4, "wc": 3, "p": 65},
    {"t": "06:00", "c": -5, "wc": 71, "p": 78},
    {"t": "09:00", "c": -2, "wc": 71, "p": 82},
    {"t": "12:00", "c": 0, "wc": 3, "p": 55},
    {"t": "15:00", "c": 1, "wc": 3, "p": 45},
    {"t": "18:00", "c": -1, "wc": 3, "p": 35},
    {"t": "21:00", "c": -3, "wc": 3, "p": 25}
  ]
}
```

**To generate the Direct Link Mini App URL:**
1. Create the complete JSON with all required fields
2. Base64 encode it
3. Convert to base64url: replace `+` with `-`, `/` with `_`, remove trailing `=`
4. Format: `https://t.me/HeyAndee_bot/app?startapp=weather_{BASE64URL}`

**Example encoding:**
```
JSON size: ~480 chars
Base64url: eyJsb2MiOiJCb3N0b24iLCJjIjotMiwiZiI6MjgsImZsIjotNywiZmYiOjE5LCJsbyI6LTYsImhpIjotMiwid2MiOjMsImgiOjgyLCJ3ZCI6MTUsIndkaXIiOjI3MCwicCI6NjUsInByZXNzIjoxMDEzLCJ2aXMiOjgsInV2IjoyLjUsImRlc2MiOiJNb3N0bHkgQ2xvdWR5Iiwic3IiOiIwNzoxNSIsInNzIjoiMTc6MDIiLCJ0eiI6IkFtZXJpY2EvTmV3X1lvcmsiLCJociI6W3sidCI6IjAwOjAwIiwiYyI6LTMsIndjIjozLCJwIjo0NX0seyJ0IjoiMDM6MDAiLCJjIjotNCwid2MiOjMsInAiOjY1fSx7InQiOiIwNjowMCIsImMiOi01LCJ3YyI6NzEsInAiOjc4fSx7InQiOiIwOTowMCIsImMiOi0yLCJ3YyI6NzEsInAiOjgyfSx7InQiOiIxMjowMCIsImMiOjAsIndjIjozLCJwIjo1NX0seyJ0IjoiMTU6MDAiLCJjIjoxLCJ3YyI6MywicCI6NDV9LHsidCI6IjE4OjAwIiwiYyI6LTEsIndjIjozLCJwIjozNX0seyJ0IjoiMjE6MDAiLCJjIjotMywid2MiOjMsInAiOjI1fV19
Size: ~520 chars base64url (fits easily in URL)
```

**TypeScript interface reference:** `apps/src/lib/types/weather.ts`

## Weather Code Reference

| Code | Weather | Emoji |
|------|---------|-------|
| 0 | Clear sky | ☀️ |
| 1 | Mainly clear | 🌤️ |
| 2 | Partly cloudy | ⛅ |
| 3 | Overcast | ☁️ |
| 45, 48 | Fog | 🌫️ |
| 51, 53, 55 | Drizzle | 🌦️ |
| 61, 63, 65 | Rain | 🌧️ |
| 71, 73, 75 | Snow | 🌨️ |
| 77 | Snow grains | 🌨️ |
| 80, 81, 82 | Rain showers | 🌧️ |
| 85, 86 | Snow showers | 🌨️ |
| 95 | Thunderstorm | ⛈️ |

## Clothing Recommendations

**IMPORTANT: Give a SINGLE definitive layer count. Never say "2-3 layers" or "3-4 layers".
Use the LOW temperature to determine the layer count and commit to ONE number.**

| Low Temp | Layers | Accessories |
|----------|--------|-------------|
| Below 14°F (-10°C) | 4 layers | thermal pants, scarf, gloves, boots |
| 14°F to 23°F (-10°C to -5°C) | 4 layers | scarf, gloves |
| 23°F to 42°F (-5°C to 5°C) | 3 layers | hat, light scarf |
| 42°F to 58°F (5°C to 14°C) | 2 layers | light jacket |
| 58°F to 70°F (14°C to 21°C) | 1 layer | - |
| Above 70°F (21°C) | Light clothing | - |

**Add to recommendation if:**
• Rain expected: "Bring an umbrella"
• Snow expected: "Wear boots"
• High wind: "Wind-resistant outer layer"
