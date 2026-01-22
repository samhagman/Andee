/**
 * SnapshotPanel - Dropdown for viewing and managing snapshots
 */

import type { Sandbox, SnapshotInfo } from "../lib/types";
import { listSnapshots } from "../lib/api";
import { showConfirmModal } from "./ConfirmModal";

export interface SnapshotPanelCallbacks {
  onPreview: (snapshotKey: string, snapshotDate: string) => void;
  onRestore: (snapshotKey: string, markAsLatest: boolean) => Promise<void>;
  onTakeSnapshot: () => Promise<void>;
}

export class SnapshotPanel {
  private container: HTMLElement;
  private sandbox: Sandbox | null = null;
  private snapshots: SnapshotInfo[] = [];
  private isOpen = false;
  private isLoading = false;
  private isTakingSnapshot = false;
  private callbacks: SnapshotPanelCallbacks;

  constructor(container: HTMLElement, callbacks: SnapshotPanelCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
    this.setupClickOutside();
  }

  /**
   * Set the current sandbox and refresh snapshot list.
   */
  async setSandbox(sandbox: Sandbox): Promise<void> {
    this.sandbox = sandbox;
    this.snapshots = [];
    this.render();

    // Auto-load snapshots in background
    await this.loadSnapshots();
  }

  /**
   * Toggle dropdown visibility.
   */
  toggle(): void {
    this.isOpen = !this.isOpen;
    this.render();

    if (this.isOpen && this.snapshots.length === 0 && !this.isLoading) {
      this.loadSnapshots();
    }
  }

  /**
   * Close the dropdown.
   */
  close(): void {
    if (this.isOpen) {
      this.isOpen = false;
      this.render();
    }
  }

  /**
   * Refresh snapshot list.
   */
  async refresh(): Promise<void> {
    await this.loadSnapshots();
  }

  /**
   * Load snapshots from API.
   */
  private async loadSnapshots(): Promise<void> {
    if (!this.sandbox || this.isLoading) return;

    this.isLoading = true;
    this.render();

    try {
      const response = await listSnapshots(this.sandbox);
      this.snapshots = response.snapshots;
    } catch (error) {
      console.error("[SnapshotPanel] Failed to load snapshots:", error);
      this.snapshots = [];
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  /**
   * Handle preview button click.
   */
  private handlePreview(snapshot: SnapshotInfo): void {
    this.close();
    this.callbacks.onPreview(snapshot.key, snapshot.uploaded);
  }

  /**
   * Handle restore button click.
   */
  private async handleRestore(snapshot: SnapshotInfo): Promise<void> {
    const result = await showConfirmModal({
      title: "Restore Snapshot?",
      message: "This will replace current files with the snapshot contents.",
      details: `Snapshot from ${this.formatDate(snapshot.uploaded)} (${this.formatSize(snapshot.size)})`,
      checkbox: {
        label: "Mark as latest (create new snapshot from restored state)",
        default: true,
      },
      confirmText: "Restore",
      cancelText: "Cancel",
    });

    if (result.confirmed) {
      this.close();
      await this.callbacks.onRestore(snapshot.key, result.checkboxValue ?? true);
    }
  }

  /**
   * Handle take snapshot button click.
   */
  private async handleTakeSnapshot(): Promise<void> {
    if (!this.sandbox || this.isTakingSnapshot) return;

    this.isTakingSnapshot = true;
    this.render();

    try {
      await this.callbacks.onTakeSnapshot();
      await this.refresh();
    } finally {
      this.isTakingSnapshot = false;
      this.render();
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
   * Format timestamp for display.
   */
  private formatDate(iso: string): string {
    const date = new Date(iso);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  /**
   * Format relative time.
   */
  private formatRelative(iso: string): string {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diff = now - then;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
  }

  /**
   * Format file size.
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Render the component.
   */
  private render(): void {
    const disabled = !this.sandbox;
    const hasSnapshots = this.snapshots.length > 0;

    this.container.innerHTML = `
      <div class="snapshot-panel">
        <button class="snapshot-btn ${disabled ? "disabled" : ""}" ${disabled ? "disabled" : ""}>
          <span class="snapshot-icon">📷</span>
          <span class="snapshot-count">${hasSnapshots ? this.snapshots.length : ""}</span>
        </button>
        ${
          this.isOpen
            ? `
          <div class="snapshot-dropdown">
            <div class="snapshot-dropdown-header">
              <span>Snapshots</span>
              <div class="snapshot-header-actions">
                <button class="snapshot-take-btn" ${this.isTakingSnapshot ? "disabled" : ""}>
                  ${this.isTakingSnapshot ? "Taking..." : "📸 Take"}
                </button>
                <button class="snapshot-close">&times;</button>
              </div>
            </div>
            <div class="snapshot-list">
              ${this.renderSnapshotList()}
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;

    // Setup event listeners
    const btn = this.container.querySelector(".snapshot-btn") as HTMLButtonElement;
    if (btn && !disabled) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggle();
      });
    }

    const closeBtn = this.container.querySelector(".snapshot-close") as HTMLButtonElement;
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.close();
      });
    }

    const takeBtn = this.container.querySelector(".snapshot-take-btn") as HTMLButtonElement;
    if (takeBtn && !this.isTakingSnapshot) {
      takeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleTakeSnapshot();
      });
    }

    // Snapshot item event listeners
    this.container.querySelectorAll(".snapshot-item").forEach((item, index) => {
      const snapshot = this.snapshots[index];
      if (!snapshot) return;

      const previewBtn = item.querySelector(".snapshot-preview-btn") as HTMLButtonElement;
      const restoreBtn = item.querySelector(".snapshot-restore-btn") as HTMLButtonElement;

      if (previewBtn) {
        previewBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.handlePreview(snapshot);
        });
      }

      if (restoreBtn) {
        restoreBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.handleRestore(snapshot);
        });
      }
    });
  }

  /**
   * Render the snapshot list content.
   */
  private renderSnapshotList(): string {
    if (this.isLoading) {
      return '<div class="snapshot-loading">Loading...</div>';
    }

    if (this.snapshots.length === 0) {
      return '<div class="snapshot-empty">No snapshots available</div>';
    }

    return this.snapshots
      .map(
        (snapshot, index) => `
        <div class="snapshot-item" data-index="${index}">
          <div class="snapshot-info">
            <div class="snapshot-date">
              ${this.formatDate(snapshot.uploaded)}
              ${index === 0 ? '<span class="snapshot-latest">LATEST</span>' : ""}
            </div>
            <div class="snapshot-meta">
              ${this.formatRelative(snapshot.uploaded)} &middot; ${this.formatSize(snapshot.size)}
            </div>
          </div>
          <div class="snapshot-actions">
            <button class="snapshot-preview-btn" title="Preview">👁</button>
            <button class="snapshot-restore-btn" title="Restore">↩</button>
          </div>
        </div>
      `
      )
      .join("");
  }
}
