// File Tree Component

import { listFiles, listSnapshotFiles } from "../lib/api";
import type { FileEntry, Sandbox } from "../lib/types";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modified: string;
  children?: TreeNode[];
  expanded?: boolean;
  loaded?: boolean;
}

export class FileTree {
  private container: HTMLElement;
  private sandboxId: string | null = null;
  private sandbox: Sandbox | null = null;
  private tree: TreeNode[] = [];
  private onFileSelect: (path: string) => void;
  private selectedPath: string | null = null;
  private currentRoot: string = "/";

  // Preview mode state
  private previewMode = false;
  private previewSnapshotKey: string | null = null;

  // Quick navigation shortcuts
  private readonly shortcuts = [
    { label: "/", path: "/", title: "Root" },
    { label: "workspace", path: "/workspace", title: "Working Directory" },
    { label: "home", path: "/home/claude", title: "Claude Home" },
    { label: "lists", path: "/home/claude/shared/lists", title: "Shared Lists" },
  ];

  constructor(container: HTMLElement, onFileSelect: (path: string) => void) {
    this.container = container;
    this.onFileSelect = onFileSelect;
    this.render();
  }

  /**
   * Set the sandbox context.
   */
  setSandbox(sandbox: Sandbox): void {
    this.sandbox = sandbox;
    this.sandboxId = sandbox.id;
  }

  /**
   * Enter preview mode to browse snapshot contents.
   */
  async setPreviewMode(snapshotKey: string): Promise<void> {
    this.previewMode = true;
    this.previewSnapshotKey = snapshotKey;
    this.tree = [];
    this.currentRoot = "/";
    this.render();

    // Load root directory of snapshot
    await this.loadDirectory(this.sandboxId!, "/");
  }

  /**
   * Exit preview mode and return to live filesystem.
   */
  async clearPreviewMode(): Promise<void> {
    this.previewMode = false;
    this.previewSnapshotKey = null;
    this.tree = [];
    this.currentRoot = "/";
    this.render();

    // Reload live filesystem
    if (this.sandboxId) {
      await this.loadDirectory(this.sandboxId, "/");
    }
  }

  /**
   * Check if in preview mode.
   */
  isPreviewMode(): boolean {
    return this.previewMode;
  }

  /**
   * Get current snapshot key (if in preview mode).
   */
  getPreviewSnapshotKey(): string | null {
    return this.previewSnapshotKey;
  }

  // Load root directory
  async loadDirectory(sandboxId: string, path: string): Promise<void> {
    this.sandboxId = sandboxId;
    this.currentRoot = path;
    this.tree = [];
    this.render();

    try {
      const entries = await this.fetchDirectory(path);
      this.tree = entries.map((e) => this.entryToNode(e, path));
      this.render();
    } catch (error) {
      console.error("[FileTree] Failed to load directory:", error);
      this.container.innerHTML = `<div class="loading" style="color: var(--error);">Failed to load files</div>`;
    }
  }

  // Navigate to a specific path
  async navigateTo(path: string): Promise<void> {
    if (!this.sandboxId) return;
    await this.loadDirectory(this.sandboxId, path);
  }

  // Go up one directory level
  async goUp(): Promise<void> {
    if (this.currentRoot === "/" || !this.sandboxId) return;
    const parent = this.currentRoot.split("/").slice(0, -1).join("/") || "/";
    await this.navigateTo(parent);
  }

  private async fetchDirectory(path: string): Promise<FileEntry[]> {
    if (!this.sandboxId) return [];

    // Use snapshot API in preview mode
    if (this.previewMode && this.previewSnapshotKey && this.sandbox) {
      const response = await listSnapshotFiles(
        this.sandbox,
        this.previewSnapshotKey,
        path
      );
      // Convert snapshot entries to FileEntry format
      return response.entries
        .map((e) => ({
          name: e.name,
          type: e.type,
          size: 0, // Size not available from tar listing
          modified: "", // Modified not available from tar listing
        }))
        .sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === "directory" ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
    }

    // Live filesystem
    const response = await listFiles(this.sandboxId, path);
    // Sort: directories first, then alphabetically
    return response.entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  private entryToNode(entry: FileEntry, parentPath: string): TreeNode {
    const path =
      parentPath === "/" ? `/${entry.name}` : `${parentPath}/${entry.name}`;
    return {
      name: entry.name,
      path,
      type: entry.type,
      size: entry.size,
      modified: entry.modified,
      children: entry.type === "directory" ? [] : undefined,
      expanded: false,
      loaded: false,
    };
  }

  private async toggleDirectory(node: TreeNode): Promise<void> {
    if (node.type !== "directory") return;

    if (!node.loaded) {
      // Load children
      try {
        const entries = await this.fetchDirectory(node.path);
        node.children = entries.map((e) => this.entryToNode(e, node.path));
        node.loaded = true;
      } catch (error) {
        console.error(`[FileTree] Failed to load ${node.path}:`, error);
        return;
      }
    }

    node.expanded = !node.expanded;
    this.render();
  }

  private selectFile(path: string): void {
    this.selectedPath = path;
    this.onFileSelect(path);
    this.render();
  }

  private render(): void {
    this.container.innerHTML = "";

    // Always render the navigation bar when we have a sandbox
    if (this.sandboxId) {
      this.renderNavBar();
    }

    if (this.tree.length === 0) {
      const loading = document.createElement("div");
      loading.className = "loading";
      loading.textContent = "Loading files...";
      this.container.appendChild(loading);
      return;
    }

    const treeContainer = document.createElement("div");
    treeContainer.className = "file-tree-content";
    this.renderNodes(this.tree, treeContainer, 0);
    this.container.appendChild(treeContainer);
  }

  private renderNavBar(): void {
    const navBar = document.createElement("div");
    navBar.className = "file-tree-nav";

    // Header row with refresh button
    const header = document.createElement("div");
    header.className = "file-tree-header";

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "nav-btn refresh-btn";
    refreshBtn.innerHTML = "↻ Refresh";
    refreshBtn.title = "Refresh file list";
    refreshBtn.addEventListener("click", () => this.refresh());
    header.appendChild(refreshBtn);

    navBar.appendChild(header);

    // Current path display
    const pathDisplay = document.createElement("div");
    pathDisplay.className = "file-tree-path";
    pathDisplay.textContent = this.currentRoot;
    pathDisplay.title = this.currentRoot;
    navBar.appendChild(pathDisplay);

    // Navigation buttons
    const buttons = document.createElement("div");
    buttons.className = "file-tree-buttons";

    // Go up button
    const upBtn = document.createElement("button");
    upBtn.className = "nav-btn";
    upBtn.textContent = "..";
    upBtn.title = "Go up one level";
    upBtn.disabled = this.currentRoot === "/";
    upBtn.addEventListener("click", () => this.goUp());
    buttons.appendChild(upBtn);

    // Quick navigation shortcuts
    for (const shortcut of this.shortcuts) {
      const btn = document.createElement("button");
      btn.className = "nav-btn";
      if (this.currentRoot === shortcut.path) {
        btn.classList.add("active");
      }
      btn.textContent = shortcut.label;
      btn.title = shortcut.title;
      btn.addEventListener("click", () => this.navigateTo(shortcut.path));
      buttons.appendChild(btn);
    }

    navBar.appendChild(buttons);
    this.container.appendChild(navBar);
  }

  private renderNodes(
    nodes: TreeNode[],
    parent: HTMLElement,
    depth: number
  ): void {
    for (const node of nodes) {
      const item = document.createElement("div");
      item.className = "file-tree-item";
      if (node.type === "directory") {
        item.classList.add("directory");
      }
      if (node.path === this.selectedPath) {
        item.classList.add("selected");
      }
      item.style.paddingLeft = `${8 + depth * 16}px`;

      // Icon
      const icon = document.createElement("span");
      icon.className = "icon";
      icon.textContent = this.getIcon(node);
      item.appendChild(icon);

      // Name
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = node.name;
      item.appendChild(name);

      // Click handler
      item.addEventListener("click", () => {
        if (node.type === "directory") {
          this.toggleDirectory(node);
        } else {
          this.selectFile(node.path);
        }
      });

      parent.appendChild(item);

      // Render children if expanded
      if (node.type === "directory" && node.expanded && node.children) {
        const childContainer = document.createElement("div");
        childContainer.className = "file-tree-children";
        this.renderNodes(node.children, childContainer, depth + 1);
        parent.appendChild(childContainer);
      }
    }
  }

  private getIcon(node: TreeNode): string {
    if (node.type === "directory") {
      return node.expanded ? "📂" : "📁";
    }

    // File icons based on extension
    const ext = node.name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
        return "📘";
      case "js":
      case "jsx":
        return "📒";
      case "json":
        return "📋";
      case "md":
        return "📝";
      case "css":
        return "🎨";
      case "html":
        return "🌐";
      case "sh":
        return "⚙️";
      case "yml":
      case "yaml":
        return "📐";
      case "env":
        return "🔒";
      case "mv2":
        return "🧠";
      default:
        return "📄";
    }
  }

  // Refresh current directory
  async refresh(): Promise<void> {
    if (this.sandboxId) {
      await this.loadDirectory(this.sandboxId, this.currentRoot);
    }
  }

  // Clear the tree
  clear(): void {
    this.sandboxId = null;
    this.tree = [];
    this.selectedPath = null;
    this.container.innerHTML = `<div class="loading" style="color: var(--text-muted);">Select a sandbox</div>`;
  }
}
