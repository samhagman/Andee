// Status Indicator Component

import type { ConnectionStatus } from "../lib/types";

export class StatusIndicator {
  private container: HTMLElement;
  private indicator: HTMLElement;
  private label: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;

    // Create indicator dot
    this.indicator = document.createElement("span");
    this.indicator.className = "indicator";

    // Create label
    this.label = document.createElement("span");
    this.label.textContent = "Disconnected";

    this.container.appendChild(this.indicator);
    this.container.appendChild(this.label);
  }

  setStatus(status: ConnectionStatus): void {
    // Remove all status classes
    this.indicator.classList.remove("connected", "connecting", "error");

    switch (status) {
      case "connected":
        this.indicator.classList.add("connected");
        this.label.textContent = "Connected";
        break;
      case "connecting":
        this.indicator.classList.add("connecting");
        this.label.textContent = "Connecting...";
        break;
      case "error":
        this.indicator.classList.add("error");
        this.label.textContent = "Connection error";
        break;
      case "disconnected":
      default:
        this.label.textContent = "Disconnected";
        break;
    }
  }
}
