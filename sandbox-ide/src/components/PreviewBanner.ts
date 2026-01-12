/**
 * PreviewBanner - Banner shown during snapshot preview mode
 */

export interface PreviewBannerCallbacks {
  onExitPreview: () => void;
  onRestore: () => Promise<void>;
}

export class PreviewBanner {
  private container: HTMLElement;
  private snapshotDate: string | null = null;
  private visible = false;
  private callbacks: PreviewBannerCallbacks;

  constructor(container: HTMLElement, callbacks: PreviewBannerCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.render();
  }

  /**
   * Show the banner with snapshot date.
   */
  show(snapshotDate: string): void {
    this.snapshotDate = snapshotDate;
    this.visible = true;
    this.render();
    document.body.classList.add("preview-mode");
  }

  /**
   * Hide the banner.
   */
  hide(): void {
    this.visible = false;
    this.snapshotDate = null;
    this.render();
    document.body.classList.remove("preview-mode");
  }

  /**
   * Format date for display.
   */
  private formatDate(iso: string): string {
    const date = new Date(iso);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  /**
   * Render the component.
   */
  private render(): void {
    if (!this.visible || !this.snapshotDate) {
      this.container.innerHTML = "";
      this.container.style.display = "none";
      return;
    }

    this.container.style.display = "flex";
    this.container.innerHTML = `
      <div class="preview-banner">
        <div class="preview-banner-info">
          <span class="preview-banner-icon">👁</span>
          <span class="preview-banner-text">
            <strong>Preview Mode:</strong> Viewing snapshot from ${this.formatDate(this.snapshotDate)}
          </span>
        </div>
        <div class="preview-banner-actions">
          <button class="preview-exit-btn">Exit Preview</button>
          <button class="preview-restore-btn">Restore This Snapshot</button>
        </div>
      </div>
    `;

    // Setup event listeners
    const exitBtn = this.container.querySelector(".preview-exit-btn") as HTMLButtonElement;
    const restoreBtn = this.container.querySelector(".preview-restore-btn") as HTMLButtonElement;

    if (exitBtn) {
      exitBtn.addEventListener("click", () => {
        this.callbacks.onExitPreview();
      });
    }

    if (restoreBtn) {
      restoreBtn.addEventListener("click", async () => {
        await this.callbacks.onRestore();
      });
    }
  }
}
