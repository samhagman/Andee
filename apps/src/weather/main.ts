/**
 * Weather Mini App Component.
 *
 * Displays weather data passed via URL hash in base64url format.
 * Supports both compact (mobile-optimized) and full data formats.
 */

import { initTelegram, getData } from "../lib";
import type { WeatherData, WeatherDataFull } from "../lib/types";
import { normalizeWeatherData, toFahrenheit } from "../lib/types/weather";
import "./weather.css";

// Initialize Telegram
initTelegram();

// Weather code to emoji mapping
const weatherEmoji: Record<number, string> = {
  0: "☀️",
  1: "🌤️",
  2: "⛅",
  3: "☁️",
  45: "🌫️",
  48: "🌫️",
  51: "🌦️",
  53: "🌦️",
  55: "🌧️",
  61: "🌧️",
  63: "🌧️",
  65: "🌧️",
  71: "🌨️",
  73: "🌨️",
  75: "❄️",
  77: "❄️",
  80: "🌦️",
  81: "🌧️",
  82: "⛈️",
  85: "🌨️",
  86: "🌨️",
  95: "⛈️",
  96: "⛈️",
  99: "⛈️",
};

function getWeatherEmoji(code: number): string {
  return weatherEmoji[code] || "🌡️";
}

// State
let showCelsius = true;
let weatherData: WeatherDataFull | null = null;

function formatTemp(c: number, showUnit = true): string {
  if (showCelsius) {
    return showUnit ? `${Math.round(c)}°C` : `${Math.round(c)}°`;
  }
  return showUnit ? `${toFahrenheit(c)}°F` : `${toFahrenheit(c)}°`;
}

function render(data: WeatherDataFull): void {
  // Location
  document.getElementById("location")!.textContent = data.location || "Weather";

  // Current weather
  const current = data.current || {
    temp_c: 0,
    temp_f: 32,
    feels_like_c: 0,
    feels_like_f: 32,
    weathercode: 0,
  };
  document.getElementById("current-icon")!.textContent = getWeatherEmoji(
    current.weathercode
  );

  if (showCelsius) {
    document.getElementById("current-temp-primary")!.textContent =
      `${Math.round(current.temp_c)}°`;
    document.getElementById("current-temp-secondary")!.textContent =
      ` / ${Math.round(current.temp_f)}°F`;
  } else {
    document.getElementById("current-temp-primary")!.textContent =
      `${Math.round(current.temp_f)}°`;
    document.getElementById("current-temp-secondary")!.textContent =
      ` / ${Math.round(current.temp_c)}°C`;
  }

  const feelsC = current.feels_like_c ?? current.temp_c;
  const feelsF = current.feels_like_f ?? toFahrenheit(feelsC);
  document.getElementById("feels-like")!.textContent = `Feels like ${
    showCelsius ? Math.round(feelsC) + "°C" : Math.round(feelsF) + "°F"
  }`;

  // Range
  const range = data.range || { low_c: 0, low_f: 32, high_c: 0, high_f: 32 };
  if (showCelsius) {
    document.getElementById("range-low")!.textContent =
      `${Math.round(range.low_c)}°C`;
    document.getElementById("range-low-alt")!.textContent =
      `${Math.round(range.low_f)}°F`;
    document.getElementById("range-high")!.textContent =
      `${Math.round(range.high_c)}°C`;
    document.getElementById("range-high-alt")!.textContent =
      `${Math.round(range.high_f)}°F`;
  } else {
    document.getElementById("range-low")!.textContent =
      `${Math.round(range.low_f)}°F`;
    document.getElementById("range-low-alt")!.textContent =
      `${Math.round(range.low_c)}°C`;
    document.getElementById("range-high")!.textContent =
      `${Math.round(range.high_f)}°F`;
    document.getElementById("range-high-alt")!.textContent =
      `${Math.round(range.high_c)}°C`;
  }

  // Transitions - hide if empty (compact format won't have these)
  const transitions = data.transitions || [];
  const transitionsCard = document.getElementById("transitions-card")!;
  if (transitions.length > 0) {
    document.getElementById("transitions-container")!.innerHTML = transitions
      .map((t, i) => {
        if (i === 0) {
          return `<div class="transition-item">
            <span>${t.emoji}</span>
            <span>${t.type}</span>
            <span class="transition-time">(${t.start}–${t.end})</span>
          </div>`;
        }
        return `<div class="transition-item">
          <span class="transition-arrow">→</span>
          <span>${t.emoji}</span>
          <span>${t.type}</span>
          <span class="transition-time">(${t.start}–${t.end})</span>
        </div>`;
      })
      .join("");
    transitionsCard.style.display = "block";
  } else {
    transitionsCard.style.display = "none";
  }

  // Hourly forecast - hide if empty (compact format won't have this)
  const hourly = data.hourly || [];
  const hourlySection = document.querySelector(".hourly-section") as HTMLElement;
  if (hourly.length > 0) {
    document.getElementById("hourly-container")!.innerHTML = hourly
      .map(
        (h) => `
        <div class="hour-card">
          <div class="hour-time">${h.time}</div>
          <div class="hour-icon">${getWeatherEmoji(h.weathercode)}</div>
          <div class="hour-temp">${formatTemp(h.temp_c, false)}</div>
          ${h.precip_prob > 20 ? `<div class="hour-precip">${h.precip_prob}%</div>` : ""}
        </div>
      `
      )
      .join("");
    hourlySection.style.display = "block";
  } else {
    hourlySection.style.display = "none";
  }

  // Recommendations
  const recs: Array<{ icon: string; text: string }> = [];
  const lowC = range.low_c ?? 10;
  const hasRain = hourly.some((h) => h.precip_prob > 50);
  const hasSnow = hourly.some((h) =>
    [71, 73, 75, 77, 85, 86].includes(h.weathercode)
  );

  if (lowC < -10) {
    recs.push({
      icon: "🧥",
      text: "4 layers + thermal pants, scarf & gloves required",
    });
  } else if (lowC < -5) {
    recs.push({ icon: "🧥", text: "3-4 layers recommended, scarf helpful" });
  } else if (lowC < 1) {
    recs.push({ icon: "🧥", text: "2-3 layers recommended" });
  } else if (lowC < 10) {
    recs.push({ icon: "🧥", text: "1-2 layers, light jacket" });
  } else if (lowC < 20) {
    recs.push({ icon: "👕", text: "Light layers should be fine" });
  } else {
    recs.push({ icon: "👕", text: "Light clothing" });
  }

  if (hasRain && !hasSnow) {
    recs.push({ icon: "☔", text: "Bring an umbrella" });
  }
  if (hasSnow) {
    recs.push({ icon: "🥾", text: "Wear boots for snow" });
  }

  document.getElementById("rec-container")!.innerHTML = recs
    .map(
      (r) => `
      <div class="rec-item">
        <span class="rec-icon">${r.icon}</span>
        <span>${r.text}</span>
      </div>
    `
    )
    .join("");

  // Generated timestamp
  if (data.generated_at) {
    try {
      const date = new Date(data.generated_at);
      document.getElementById("generated-at")!.textContent = `Updated ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    } catch {
      document.getElementById("generated-at")!.textContent = "";
    }
  }
}

function showError(message: string, debug = ""): void {
  document.getElementById("app")!.innerHTML = `
    <div class="error-state">
      <div class="error-icon">⚠️</div>
      <div class="error-text">${message}</div>
      ${debug ? `<div style="margin-top:20px;font-size:10px;color:#888;word-break:break-all;max-width:300px;">${debug}</div>` : ""}
    </div>
  `;
}

// Toggle temperature units
document.getElementById("unit-toggle")?.addEventListener("click", () => {
  showCelsius = !showCelsius;
  if (weatherData) render(weatherData);
});

// Get data from URL
const { data, error } = getData<WeatherData>();

if (error) {
  showError("Unable to load weather data", error.message);
} else if (!data) {
  showError("No weather data provided");
} else {
  weatherData = normalizeWeatherData(data);
  render(weatherData);
}
