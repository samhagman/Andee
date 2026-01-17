/**
 * SchedulesPanel - Dropdown for viewing and managing recurring schedules
 */

import type { Sandbox, ScheduleWithNextRun } from "../lib/types";
import {
  getScheduleConfig,
  getScheduleConfigYaml,
  saveScheduleConfigYaml,
  toggleSchedule,
  runScheduleNow,
} from "../lib/api";
import { showConfirmModal } from "./ConfirmModal";
import { showErrorModal } from "./ErrorModal";

export interface SchedulesPanelCallbacks {
  onScheduleRun?: (scheduleId: string) => void;
}

// Prompt user for bot token (needed for schedule operations)
function getBotToken(): string {
  const stored = localStorage.getItem("andee-bot-token");
  if (stored) return stored;

  const token = prompt("Enter your Telegram Bot Token (for scheduled messages):");
  if (token) {
    localStorage.setItem("andee-bot-token", token);
    return token;
  }
  throw new Error("Bot token is required for schedule operations");
}

export class SchedulesPanel {
  private container: HTMLElement;
  private sandbox: Sandbox | null = null;
  private schedules: ScheduleWithNextRun[] = [];
  private yamlContent: string = "";
  private isOpen = false;
  private isLoading = false;
  private isEditing = false;
  private callbacks: SchedulesPanelCallbacks;

  constructor(container: HTMLElement, callbacks: SchedulesPanelCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
    this.setupClickOutside();
  }

  /**
   * Set the current sandbox and refresh schedules.
   */
  async setSandbox(sandbox: Sandbox): Promise<void> {
    this.sandbox = sandbox;
    this.schedules = [];
    this.yamlContent = "";
    this.isEditing = false;
    this.render();

    // Auto-load schedules in background
    if (this.isOpen) {
      await this.loadSchedules();
    }
  }

  /**
   * Toggle dropdown visibility.
   */
  toggle(): void {
    this.isOpen = !this.isOpen;
    this.render();

    if (this.isOpen && this.schedules.length === 0 && !this.isLoading) {
      this.loadSchedules();
    }
  }

  /**
   * Close the dropdown.
   */
  close(): void {
    if (this.isOpen) {
      this.isOpen = false;
      this.isEditing = false;
      this.render();
    }
  }

  /**
   * Refresh schedule list.
   */
  async refresh(): Promise<void> {
    await this.loadSchedules();
  }

  /**
   * Load schedules from API.
   */
  private async loadSchedules(): Promise<void> {
    if (!this.sandbox || this.isLoading) return;

    this.isLoading = true;
    this.render();

    try {
      const response = await getScheduleConfig(this.sandbox);
      this.schedules = response.schedules || [];
      this.yamlContent = await getScheduleConfigYaml(this.sandbox);
    } catch (error) {
      console.error("[SchedulesPanel] Failed to load schedules:", error);
      this.schedules = [];
      this.yamlContent = "";
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  /**
   * Handle toggle switch.
   */
  private async handleToggle(schedule: ScheduleWithNextRun): Promise<void> {
    if (!this.sandbox) return;

    try {
      await toggleSchedule(this.sandbox, schedule.id, !schedule.enabled);
      // Update local state
      schedule.enabled = !schedule.enabled;
      this.render();
    } catch (error) {
      console.error("[SchedulesPanel] Failed to toggle schedule:", error);
      await showErrorModal({
        title: "Toggle Failed",
        message: `Could not ${schedule.enabled ? "disable" : "enable"} schedule`,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle run now button.
   */
  private async handleRunNow(schedule: ScheduleWithNextRun): Promise<void> {
    if (!this.sandbox) return;

    const result = await showConfirmModal({
      title: `Run "${schedule.id}" Now?`,
      message: "This will execute the schedule immediately.",
      confirmText: "Run",
      cancelText: "Cancel",
    });

    if (!result.confirmed) return;

    try {
      await runScheduleNow(this.sandbox, schedule.id);
      if (this.callbacks.onScheduleRun) {
        this.callbacks.onScheduleRun(schedule.id);
      }
    } catch (error) {
      console.error("[SchedulesPanel] Failed to run schedule:", error);
      await showErrorModal({
        title: "Run Failed",
        message: "Could not execute schedule",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Enter edit mode.
   */
  private enterEditMode(): void {
    this.isEditing = true;
    this.render();
  }

  /**
   * Exit edit mode without saving.
   */
  private exitEditMode(): void {
    this.isEditing = false;
    this.loadSchedules(); // Reload to discard changes
  }

  /**
   * Save YAML changes.
   */
  private async saveChanges(): Promise<void> {
    if (!this.sandbox) return;

    const textarea = this.container.querySelector(".schedule-yaml-editor") as HTMLTextAreaElement;
    if (!textarea) return;

    const newYaml = textarea.value;

    try {
      const botToken = getBotToken();
      const response = await saveScheduleConfigYaml(this.sandbox, newYaml, botToken);

      if (response.success) {
        this.yamlContent = newYaml;
        this.schedules = response.schedules || [];
        this.isEditing = false;
        this.render();
      } else {
        throw new Error(response.error || "Save failed");
      }
    } catch (error) {
      console.error("[SchedulesPanel] Failed to save:", error);
      await showErrorModal({
        title: "Save Failed",
        message: "Could not save schedule configuration",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Setup click outside handler to close dropdown.
   */
  private setupClickOutside(): void {
    document.addEventListener("click", (e) => {
      if (!this.isOpen) return;

      const target = e.target as HTMLElement;
      if (!this.container.contains(target)) {
        this.close();
      }
    });
  }

  /**
   * Format next run time.
   */
  private formatNextRun(timestamp: number | null): string {
    if (!timestamp) return "Not scheduled";

    const date = new Date(timestamp);
    const now = Date.now();
    const diff = timestamp - now;

    // Format as "Jan 14, 6:00 AM"
    const formatted = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    // Add relative time
    if (diff < 0) return `${formatted} (overdue)`;
    if (diff < 3600000) return `${formatted} (in ${Math.round(diff / 60000)}m)`;
    if (diff < 86400000) return `${formatted} (in ${Math.round(diff / 3600000)}h)`;
    return formatted;
  }

  /**
   * Format cron expression to human readable.
   */
  private formatCron(cron: string): string {
    // Basic cron parsing for common patterns
    const parts = cron.split(" ");
    if (parts.length !== 5) return cron;

    const [minute, hour, , , dayOfWeek] = parts;

    let time = "";
    if (hour !== "*" && minute !== "*") {
      const h = parseInt(hour);
      const m = parseInt(minute);
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      time = `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
    }

    let frequency = "daily";
    if (dayOfWeek === "0") frequency = "Sundays";
    else if (dayOfWeek === "1-5" || dayOfWeek === "MON-FRI") frequency = "weekdays";
    else if (dayOfWeek !== "*") frequency = `day ${dayOfWeek}`;

    return time ? `${time} ${frequency}` : cron;
  }

  /**
   * Render the component.
   */
  private render(): void {
    const disabled = !this.sandbox;
    const enabledCount = this.schedules.filter((s) => s.enabled).length;

    this.container.innerHTML = `
      <div class="schedules-panel">
        <button class="schedules-btn ${disabled ? "disabled" : ""}" ${disabled ? "disabled" : ""}>
          <span class="schedules-icon">⏰</span>
          <span class="schedules-count">${enabledCount > 0 ? enabledCount : ""}</span>
        </button>
        ${this.isOpen ? this.renderDropdown() : ""}
      </div>
    `;

    // Setup event listeners
    const btn = this.container.querySelector(".schedules-btn") as HTMLButtonElement;
    if (btn && !disabled) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggle();
      });
    }

    const closeBtn = this.container.querySelector(".schedules-close") as HTMLButtonElement;
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.close();
      });
    }

    // Edit mode buttons
    const editBtn = this.container.querySelector(".schedules-edit-btn") as HTMLButtonElement;
    if (editBtn) {
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.enterEditMode();
      });
    }

    const saveBtn = this.container.querySelector(".schedules-save-btn") as HTMLButtonElement;
    if (saveBtn) {
      saveBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.saveChanges();
      });
    }

    const cancelBtn = this.container.querySelector(".schedules-cancel-btn") as HTMLButtonElement;
    if (cancelBtn) {
      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.exitEditMode();
      });
    }

    // Schedule item event listeners
    this.container.querySelectorAll(".schedule-item").forEach((item, index) => {
      const schedule = this.schedules[index];
      if (!schedule) return;

      const toggleInput = item.querySelector(".schedule-toggle") as HTMLInputElement;
      const runBtn = item.querySelector(".schedule-run-btn") as HTMLButtonElement;

      if (toggleInput) {
        toggleInput.addEventListener("change", (e) => {
          e.stopPropagation();
          this.handleToggle(schedule);
        });
      }

      if (runBtn) {
        runBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.handleRunNow(schedule);
        });
      }
    });
  }

  /**
   * Render the dropdown content.
   */
  private renderDropdown(): string {
    return `
      <div class="schedules-dropdown">
        <div class="schedules-dropdown-header">
          <span>Recurring Schedules</span>
          <div class="schedules-header-actions">
            ${
              this.isEditing
                ? `
                  <button class="schedules-save-btn" title="Save">💾</button>
                  <button class="schedules-cancel-btn" title="Cancel">✖</button>
                `
                : `
                  <button class="schedules-edit-btn" title="Edit YAML">✏️</button>
                `
            }
            <button class="schedules-close">&times;</button>
          </div>
        </div>
        <div class="schedules-content">
          ${this.isEditing ? this.renderEditor() : this.renderScheduleList()}
        </div>
      </div>
    `;
  }

  /**
   * Render the schedule list view.
   */
  private renderScheduleList(): string {
    if (this.isLoading) {
      return '<div class="schedules-loading">Loading...</div>';
    }

    if (this.schedules.length === 0) {
      return `
        <div class="schedules-empty">
          <p>No schedules configured</p>
          <p class="schedules-hint">Click ✏️ to add schedules via YAML</p>
        </div>
      `;
    }

    return this.schedules
      .map(
        (schedule, index) => `
        <div class="schedule-item ${schedule.enabled ? "" : "disabled"}" data-index="${index}">
          <div class="schedule-info">
            <div class="schedule-header">
              <label class="schedule-toggle-label">
                <input type="checkbox" class="schedule-toggle" ${schedule.enabled ? "checked" : ""}>
                <span class="schedule-id">${schedule.id}</span>
              </label>
            </div>
            <div class="schedule-description">${schedule.description}</div>
            <div class="schedule-meta">
              <span class="schedule-cron" title="${schedule.cron}">${this.formatCron(schedule.cron)}</span>
              ${schedule.enabled ? `<span class="schedule-next">Next: ${this.formatNextRun(schedule.nextRunAt)}</span>` : ""}
            </div>
          </div>
          <div class="schedule-actions">
            <button class="schedule-run-btn" title="Run Now" ${schedule.enabled ? "" : "disabled"}>▶</button>
          </div>
        </div>
      `
      )
      .join("");
  }

  /**
   * Render the YAML editor.
   */
  private renderEditor(): string {
    return `
      <div class="schedules-editor">
        <textarea class="schedule-yaml-editor" spellcheck="false">${this.escapeHtml(this.yamlContent)}</textarea>
        <div class="schedules-editor-help">
          <p><strong>Format:</strong></p>
          <pre>schedules:
  morning-weather:
    description: "Daily weather"
    cron: "0 6 * * *"
    enabled: true
    prompt: |
      Generate a weather report...</pre>
        </div>
      </div>
    `;
  }

  /**
   * Escape HTML for safe rendering.
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
