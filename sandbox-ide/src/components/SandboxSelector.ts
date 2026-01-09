// Sandbox Selector Component

import { listSandboxes } from "../lib/api";
import type { Sandbox } from "../lib/types";

export class SandboxSelector {
  private container: HTMLElement;
  private select: HTMLSelectElement;
  private sandboxes: Sandbox[] = [];
  private onChange: (sandbox: Sandbox) => void;

  constructor(container: HTMLElement, onChange: (sandbox: Sandbox) => void) {
    this.container = container;
    this.onChange = onChange;

    // Create select element
    this.select = document.createElement("select");
    this.select.innerHTML = '<option value="">Loading sandboxes...</option>';
    this.select.disabled = true;

    this.select.addEventListener("change", () => {
      const selected = this.sandboxes.find((s) => s.id === this.select.value);
      if (selected) {
        this.onChange(selected);
      }
    });

    this.container.appendChild(this.select);
  }

  async loadSandboxes(): Promise<void> {
    try {
      this.select.innerHTML = '<option value="">Loading...</option>';
      this.select.disabled = true;

      const response = await listSandboxes();
      this.sandboxes = response.sandboxes;

      if (this.sandboxes.length === 0) {
        this.select.innerHTML = '<option value="">No sandboxes found</option>';
        return;
      }

      // Build options HTML
      this.select.innerHTML = this.sandboxes
        .map((sandbox) => {
          const type = sandbox.isGroup ? "Group" : "Private";
          return `<option value="${sandbox.id}">${sandbox.displayName} - ${type}</option>`;
        })
        .join("");

      this.select.disabled = false;

      // Auto-select first sandbox
      if (this.sandboxes.length > 0) {
        this.select.value = this.sandboxes[0].id;
        this.onChange(this.sandboxes[0]);
      }
    } catch (error) {
      console.error("[SandboxSelector] Failed to load sandboxes:", error);
      this.select.innerHTML = `<option value="">Error loading sandboxes</option>`;
    }
  }

  // Programmatically select a sandbox
  selectSandbox(id: string): void {
    const sandbox = this.sandboxes.find((s) => s.id === id);
    if (sandbox) {
      this.select.value = id;
      this.onChange(sandbox);
    }
  }

  // Get current selection
  getSelected(): Sandbox | null {
    return this.sandboxes.find((s) => s.id === this.select.value) || null;
  }
}
