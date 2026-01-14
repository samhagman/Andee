/**
 * Metro Grid Dashboard Weather Mini App.
 *
 * 2026 design aesthetic: Compact, data-forward, intentional color.
 * Dynamic accent color based on temperature, sparkline visualization.
 */

import { initTelegram, getData } from "../lib";
import type { WeatherData, WeatherDataFull } from "../lib/types";
import { normalizeWeatherData, toFahrenheit } from "../lib/types/weather";
import "./weather.css";

initTelegram();

// Weather code to emoji and description
const weatherEmoji: Record<number, string> = {
  0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️", 45: "🌫️", 48: "🌫️",
  51: "🌦️", 53: "🌦️", 55: "🌧️", 61: "🌧️", 63: "🌧️", 65: "🌧️",
  71: "🌨️", 73: "🌨️", 75: "❄️", 77: "❄️", 80: "🌦️", 81: "🌧️",
  82: "⛈️", 85: "🌨️", 86: "🌨️", 95: "⛈️", 96: "⛈️", 99: "⛈️",
};

const weatherDesc: Record<number, string> = {
  0: "Clear", 1: "Clear", 2: "Partly Cloudy", 3: "Overcast", 45: "Foggy", 48: "Foggy",
  51: "Drizzle", 53: "Drizzle", 55: "Drizzle", 61: "Rain", 63: "Rain", 65: "Rain",
  71: "Snow", 73: "Snow", 75: "Snow", 77: "Snow", 80: "Showers", 81: "Showers",
  82: "Heavy Showers", 85: "Snow Showers", 86: "Snow Showers", 95: "Thunderstorm",
  96: "Thunderstorm", 99: "Thunderstorm",
};

// Get accent color based on temperature (blue→green→orange→red)
function getAccentColor(tempC: number): string {
  if (tempC < -10) return "#00B4FF"; // Icy blue
  if (tempC < 0) return "#0088FF"; // Cool blue
  if (tempC < 15) return "#00DD88"; // Green
  if (tempC < 25) return "#FFAA00"; // Amber
  return "#FF6644"; // Hot orange
}

function getWindDirection(degrees: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((degrees % 360) / 22.5) % 16)];
}

function getPressureTrend(pressure: number): string {
  if (pressure > 1020) return "Rising";
  if (pressure < 1000) return "Falling";
  return "Stable";
}

// Generate SVG sparkline from hourly temps
function generateSparkline(hourly: Array<{ temp_c: number }>): string {
  if (hourly.length < 2) return "";

  const temps = hourly.map(h => h.temp_c);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const range = maxTemp - minTemp || 1;

  const points = temps
    .map((temp, i) => {
      const x = (i / (temps.length - 1)) * 200;
      const y = 60 - ((temp - minTemp) / range) * 60;
      return `${x},${y}`;
    })
    .join(" ");

  return points;
}

function render(data: WeatherDataFull): void {
  const current = data.current;
  const range = data.range;
  const accentColor = getAccentColor(current.temp_c);

  // Set CSS variable for accent color
  document.documentElement.style.setProperty("--accent-color", accentColor);

  // Header
  document.getElementById("location-time")!.innerHTML = `
    <span class="location-name">${data.location}</span>
    <span class="location-time-sep">•</span>
    <span class="location-time-val">${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
  `;

  // Hero: Current Temperature
  document.getElementById("temp-value")!.textContent = `${Math.round(current.temp_c)}°C / ${Math.round(current.temp_f)}°F`;
  document.getElementById("temp-condition")!.textContent = weatherEmoji[current.weathercode] + " " + weatherDesc[current.weathercode];
  document.getElementById("feels-like")!.textContent = `Feels ${Math.round(current.feels_like_c)}°C / ${Math.round(current.feels_like_f)}°F`;

  // Metro Grid: Metrics
  document.getElementById("wind-value")!.textContent = `${Math.round(current.wind_speed)}`;
  document.getElementById("wind-detail")!.textContent = getWindDirection(current.wind_direction);

  document.getElementById("humidity-value")!.textContent = `${current.humidity}`;
  document.getElementById("humidity-detail")!.textContent = current.humidity > 70 ? "High" : current.humidity > 40 ? "Avg" : "Low";

  document.getElementById("pressure-value")!.textContent = `${Math.round(current.pressure)}`;
  document.getElementById("pressure-detail")!.textContent = getPressureTrend(current.pressure);

  document.getElementById("visibility-value")!.textContent = `${Math.round(current.visibility)}`;
  document.getElementById("visibility-detail")!.textContent = current.visibility > 10 ? "Good" : "Limited";

  // Sparkline Chart
  const sparklinePoints = generateSparkline(data.hourly);
  const polyline = document.getElementById("sparkline-polyline");
  if (polyline) {
    polyline.setAttribute("points", sparklinePoints);
  }

  // Range Band
  document.getElementById("range-low")!.textContent = `${Math.round(range.low_c)}°C`;
  document.getElementById("range-high")!.textContent = `${Math.round(range.high_c)}°C`;

  // Next 3 Hours
  const next3Hours = data.hourly.slice(0, 3);
  const outlookHTML = next3Hours
    .map((h) => `<div class="outlook-item"><span class="hour-time">${h.time}</span><span class="hour-emoji">${weatherEmoji[h.weathercode]}</span><span class="hour-temp">${Math.round(h.temp_c)}°C</span></div>`)
    .join("");
  document.getElementById("outlook-strip")!.innerHTML = outlookHTML;

  // Alert Zone: Critical Recommendations Only
  const alerts: string[] = [];
  const hasRain = data.hourly.some((h) => h.precip_prob > 50);
  const hasSnow = data.hourly.some((h) => [71, 73, 75, 77, 85, 86].includes(h.weathercode));
  const hasThunder = data.hourly.some((h) => [95, 96, 99].includes(h.weathercode));
  const hasExtremeCold = range.low_c < -10;
  const hasExtremeHeat = range.high_c > 35;

  if (hasThunder) alerts.push("⛈️ Thunderstorm Expected");
  if (hasExtremeCold) alerts.push("🥶 Extreme Cold");
  if (hasExtremeHeat) alerts.push("🔥 Extreme Heat");
  if (hasSnow) alerts.push("🌨️ Snow Expected");
  if (hasRain && !hasSnow) alerts.push("🌧️ Rain Expected");
  if (current.wind_speed > 25) alerts.push("💨 Strong Winds");

  const alertZone = document.getElementById("alert-zone");
  if (alerts.length > 0) {
    alertZone!.style.display = "flex";
    alertZone!.innerHTML = alerts.map((alert) => `<div class="alert-item">${alert}</div>`).join("");
  } else {
    alertZone!.style.display = "none";
  }
}

function showError(message: string, debug = ""): void {
  document.getElementById("app")!.innerHTML = `
    <div class="error-state">
      <div class="error-icon">⚠️</div>
      <div class="error-text">${message}</div>
      ${debug ? `<div class="error-debug">${debug}</div>` : ""}
    </div>
  `;
}

const { data, error } = getData<WeatherData>();

if (error) {
  showError("Unable to load weather data", error.message);
} else if (!data) {
  showError("No weather data provided");
} else {
  const weatherData = normalizeWeatherData(data);
  render(weatherData);
}
