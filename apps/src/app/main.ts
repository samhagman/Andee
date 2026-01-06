/**
 * Shell router for Andee Mini Apps.
 *
 * Parses the startapp parameter and loads the appropriate component in an iframe.
 * Format: startapp={component}_{base64url_data}
 */

import { initTelegram, getStartParam } from "../lib";
import "./shell.css";

// Initialize Telegram
initTelegram();

// Base URL for components (production)
const BASE_URL = import.meta.env.PROD
  ? "https://andee-7rd.pages.dev"
  : ""; // Dev uses relative paths

// Get DOM elements
const loadingEl = document.getElementById("loading")!;
const errorEl = document.getElementById("error")!;
const frameEl = document.getElementById("frame") as HTMLIFrameElement;

/**
 * Show error state with icon and message.
 */
function showError(icon: string, message: string, detail = ""): void {
  loadingEl.classList.add("hidden");
  frameEl.classList.add("hidden");
  errorEl.classList.remove("hidden");
  errorEl.querySelector(".error-icon")!.textContent = icon;
  errorEl.querySelector(".error-text")!.textContent = message;
  errorEl.querySelector(".error-detail")!.textContent = detail;
}

/**
 * Show iframe with component.
 */
function showFrame(url: string): void {
  frameEl.src = url;
  frameEl.onload = () => {
    loadingEl.classList.add("hidden");
    errorEl.classList.add("hidden");
    frameEl.classList.remove("hidden");
  };
  frameEl.onerror = () => {
    showError("⚠️", "Failed to load component", url);
  };
}

// Get startapp parameter
const startParam = getStartParam();

if (!startParam) {
  showError("📭", "No component specified", "startapp parameter is required");
} else {
  // Parse startapp format: {component}_{base64url_data}
  const underscoreIndex = startParam.indexOf("_");

  let component: string;
  let data: string;

  if (underscoreIndex > 0) {
    component = startParam.slice(0, underscoreIndex);
    data = startParam.slice(underscoreIndex + 1);
  } else {
    // No data, just component name
    component = startParam;
    data = "";
  }

  // Validate component name (alphanumeric and hyphens only)
  if (!/^[a-zA-Z0-9-]+$/.test(component)) {
    showError("⚠️", "Invalid component name", component);
  } else {
    // Construct URL
    // Components expect data in the hash: /#data={base64url}
    const url = data
      ? `${BASE_URL}/${component}/#data=${data}`
      : `${BASE_URL}/${component}/`;

    showFrame(url);
  }
}
