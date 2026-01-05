---
name: weather
description: Get weather information including current conditions, temperature ranges, hourly forecast, weather transitions, and clothing recommendations. Use when user asks about weather, temperature, what to wear, if they need an umbrella, jacket, layers, or asks about outdoor activity timing.
---

# Weather Skill

Provides weather information with a conversational summary and a Mini App button for detailed view.

**IMPORTANT: Follow the telegram-response skill guidelines for formatting. Use HTML tags, not markdown.**

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

Use WebFetch to call the Open-Meteo API:

```
https://api.open-meteo.com/v1/forecast?latitude={LAT}&longitude={LON}&current=temperature_2m,apparent_temperature,weather_code,precipitation&hourly=temperature_2m,precipitation_probability,weather_code&forecast_days=1&timezone=auto
```

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
3. **DO NOT use markdown** - no `**bold**`, no `---`, no `# headers`
4. **Use HTML tags** if emphasis needed: `<b>bold</b>`, `<i>italic</i>`

**CRITICAL: USE SPECIFIC TIMES, NOT VAGUE PERIODS**

❌ BAD: "morning", "afternoon", "evening", "later today"
✅ GOOD: "6am-12pm", "starting around 7pm", "3pm-8pm"

Always include the specific hour when weather changes occur. The hourly data tells you exactly when - use it!

**RESPONSE STRUCTURE (in this exact order):**

1. **Header** - Location + date context
2. **Weather Alert** (if any) - Snow, rain, storms, extreme temps - with SPECIFIC TIME
3. **Temperature Range** - Low to high in both C and F
4. **Weather Timeline** - Pattern changes with SPECIFIC HOURS
5. **Clothing Recommendation** - What to wear/bring

**Response template:**
```
<b>{Location} Weather - {Date Context}</b>

<i>{Alert emoji} {Alert type}: {description} starting around {SPECIFIC TIME}</i>

Ranging {low}°C to {high}°C ({low_f}°F to {high_f}°F).

• {emoji} {weather_type} ({START_HOUR}-{END_HOUR})
• {emoji} {weather_type} ({START_HOUR}-{END_HOUR})
• {emoji} {weather_type} ({START_HOUR}-{END_HOUR})

{Clothing recommendation}.

[View Full Weather Report](webapp:https://andee-7rd.pages.dev/weather/#data={BASE64URL_JSON})
```

**Example response (with weather event):**
```
<b>Boston Weather - Tomorrow (Jan 5)</b>

<i>🌨️ Snow Alert: Snow showers expected starting around 7pm</i>

Ranging -10°C to -3°C (14°F to 27°F).

• 🌤️ Clear/Partly Cloudy (6am-6pm)
• 🌨️ Snow Showers (7pm-11pm)

Layer up with 3-4 layers, wear a scarf and gloves, and bring boots for the evening snow!

[View Full Weather Report](webapp:https://andee-7rd.pages.dev/weather/#data=eyJsb2Mi...)
```

**Example response (multiple transitions):**
```
<b>Boston Weather - Today</b>

Ranging -5°C to 3°C (23°F to 37°F).

• ☁️ Overcast (12am-6am)
• 🌨️ Light Snow (7am-10am)
• 🌤️ Partly Cloudy (11am-4pm)
• ☁️ Cloudy (5pm-11pm)

Light jacket with a hat for the morning snow.

[View Full Weather Report](webapp:https://andee-7rd.pages.dev/weather/#data=eyJsb2Mi...)
```

**Example response (calm day, no alert needed):**
```
<b>Boston Weather - Today</b>

Ranging 5°C to 12°C (41°F to 54°F).

• ☁️ Overcast (6am-3pm)
• 🌤️ Partly Cloudy (4pm-9pm)

A light jacket should be fine today.

[View Full Weather Report](webapp:https://andee-7rd.pages.dev/weather/#data=eyJsb2Mi...)
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
- "---" horizontal dividers
- Any markdown formatting
- Vague time references like "morning" or "evening" without specific hours

### 5. Generate Mini App Data

**CRITICAL: Keep the data MINIMAL to avoid corruption. DO NOT include hourly data.**

Create a COMPACT JSON (under 300 characters) with this exact structure:

```json
{"loc":"Boston","c":-2,"f":28,"fl":-7,"lo":-6,"hi":-2,"wc":3}
```

Fields (all required, use integers):
- `loc`: City name (short)
- `c`: Current temp Celsius (integer)
- `f`: Current temp Fahrenheit (integer)
- `fl`: Feels like Celsius (integer)
- `lo`: Low temp Celsius (integer)
- `hi`: High temp Celsius (integer)
- `wc`: Weather code (integer)

**To generate the webapp link:**
1. Create the compact JSON exactly as shown above
2. Base64 encode it (will be ~80 chars)
3. Remove trailing `=` padding (base64url style)
4. **IMPORTANT: Use HASH (`#data=`) not query params (`?data=`)** - Telegram strips query params!
5. Format: `[View Full Weather Report](webapp:https://andee-7rd.pages.dev/weather/#data=BASE64_HERE)`

**Example with real encoding:**
JSON: `{"loc":"Boston","c":-3,"f":27,"fl":-7,"lo":-6,"hi":-2,"wc":3}`
Base64url (no padding): `eyJsb2MiOiJCb3N0b24iLCJjIjotMywiZiI6MjcsImZsIjotNywibG8iOi02LCJoaSI6LTIsIndjIjozfQ`

Full link: `[View Full Weather Report](webapp:https://andee-7rd.pages.dev/weather/#data=eyJsb2MiOiJCb3N0b24iLCJjIjotMywiZiI6MjcsImZsIjotNywibG8iOi02LCJoaSI6LTIsIndjIjozfQ)`

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
| 77 | Snow grains | ❄️ |
| 80, 81, 82 | Rain showers | 🌧️ |
| 85, 86 | Snow showers | 🌨️ |
| 95 | Thunderstorm | ⛈️ |

## Clothing Recommendations

Base recommendations on the LOW temperature (worst case):

| Low Temp | Recommendation |
|----------|----------------|
| Below -10°C (14°F) | 4 layers + thermal pants, scarf, gloves required |
| -10°C to -5°C (14-23°F) | 3-4 layers, scarf recommended |
| -5°C to 1°C (23-34°F) | 2-3 layers, light jacket or sweater |
| 1°C to 10°C (34-50°F) | 1-2 layers, light jacket |
| 10°C to 20°C (50-68°F) | Single layer, maybe light sweater |
| Above 20°C (68°F) | Light clothing |

**Add to recommendation if:**
- Rain expected: "Bring an umbrella"
- Snow expected: "Wear boots"
- High wind: "Wind-resistant outer layer"
