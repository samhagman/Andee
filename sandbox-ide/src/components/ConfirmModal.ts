/**
 * ConfirmModal - Reusable confirmation dialog
 */

export interface ConfirmModalOptions {
  title: string;
  message: string;
  details?: string;
  checkbox?: {
    label: string;
    default: boolean;
  };
  confirmText?: string;
  cancelText?: string;
}

export interface ConfirmModalResult {
  confirmed: boolean;
  checkboxValue?: boolean;
}

/**
 * Show a confirmation modal and wait for user response.
 */
export function showConfirmModal(
  options: ConfirmModalOptions
): Promise<ConfirmModalResult> {
  return new Promise((resolve) => {
    const {
      title,
      message,
      details,
      checkbox,
      confirmText = "Confirm",
      cancelText = "Cancel",
    } = options;

    // Create overlay
    const overlay = document.createElement("div");
    overlay.className = "confirm-modal-overlay";

    // Create modal
    const modal = document.createElement("div");
    modal.className = "confirm-modal";

    // Checkbox state
    let checkboxValue = checkbox?.default ?? false;

    // Build content
    modal.innerHTML = `
      <div class="confirm-modal-header">
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="confirm-modal-body">
        <p>${escapeHtml(message)}</p>
        ${details ? `<p class="confirm-modal-details">${escapeHtml(details)}</p>` : ""}
        ${
          checkbox
            ? `
          <label class="confirm-modal-checkbox">
            <input type="checkbox" ${checkbox.default ? "checked" : ""}>
            <span>${escapeHtml(checkbox.label)}</span>
          </label>
        `
            : ""
        }
      </div>
      <div class="confirm-modal-footer">
        <button class="confirm-modal-cancel">${escapeHtml(cancelText)}</button>
        <button class="confirm-modal-confirm">${escapeHtml(confirmText)}</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Setup event handlers
    const cleanup = () => {
      document.body.removeChild(overlay);
    };

    const confirmBtn = modal.querySelector(".confirm-modal-confirm") as HTMLButtonElement;
    const cancelBtn = modal.querySelector(".confirm-modal-cancel") as HTMLButtonElement;
    const checkboxInput = modal.querySelector('input[type="checkbox"]') as HTMLInputElement | null;

    // Track checkbox changes
    if (checkboxInput) {
      checkboxInput.addEventListener("change", () => {
        checkboxValue = checkboxInput.checked;
      });
    }

    // Confirm button
    confirmBtn.addEventListener("click", () => {
      cleanup();
      resolve({ confirmed: true, checkboxValue });
    });

    // Cancel button
    cancelBtn.addEventListener("click", () => {
      cleanup();
      resolve({ confirmed: false, checkboxValue: undefined });
    });

    // Click outside to cancel
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve({ confirmed: false, checkboxValue: undefined });
      }
    });

    // Escape key to cancel
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cleanup();
        document.removeEventListener("keydown", handleKeydown);
        resolve({ confirmed: false, checkboxValue: undefined });
      }
    };
    document.addEventListener("keydown", handleKeydown);

    // Focus confirm button
    confirmBtn.focus();
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
