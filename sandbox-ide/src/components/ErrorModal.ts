/**
 * ErrorModal - Blocking error display with copy functionality
 */

export interface ErrorModalOptions {
  title: string;
  message: string;
  details?: string;
  dismissText?: string;
}

/**
 * Show a blocking error modal and wait for user to dismiss.
 * Returns a Promise that resolves when the modal is closed.
 */
export function showErrorModal(options: ErrorModalOptions): Promise<void> {
  return new Promise((resolve) => {
    const { title, message, details, dismissText = "Dismiss" } = options;

    // Create overlay
    const overlay = document.createElement("div");
    overlay.className = "error-modal-overlay";

    // Create modal
    const modal = document.createElement("div");
    modal.className = "error-modal";

    // Build content
    modal.innerHTML = `
      <div class="error-modal-header">
        <span class="error-modal-icon">!</span>
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="error-modal-body">
        <p>${escapeHtml(message)}</p>
        ${
          details
            ? `
          <div class="error-modal-details">
            <pre>${escapeHtml(details)}</pre>
          </div>
        `
            : ""
        }
      </div>
      <div class="error-modal-footer">
        ${details ? `<button class="error-modal-copy">Copy Error</button>` : ""}
        <button class="error-modal-dismiss">${escapeHtml(dismissText)}</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Setup event handlers
    const cleanup = () => {
      document.body.removeChild(overlay);
      document.removeEventListener("keydown", handleKeydown);
    };

    const dismissBtn = modal.querySelector(
      ".error-modal-dismiss"
    ) as HTMLButtonElement;
    const copyBtn = modal.querySelector(
      ".error-modal-copy"
    ) as HTMLButtonElement | null;

    // Dismiss button
    dismissBtn.addEventListener("click", () => {
      cleanup();
      resolve();
    });

    // Copy button
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const textToCopy = `${title}\n\n${message}${details ? `\n\n${details}` : ""}`;
        try {
          await navigator.clipboard.writeText(textToCopy);
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = "Copy Error";
          }, 1500);
        } catch (err) {
          console.error("Failed to copy:", err);
        }
      });
    }

    // Click outside to dismiss
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve();
      }
    });

    // Escape key to dismiss
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cleanup();
        resolve();
      }
    };
    document.addEventListener("keydown", handleKeydown);

    // Focus dismiss button
    dismissBtn.focus();
  });
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
