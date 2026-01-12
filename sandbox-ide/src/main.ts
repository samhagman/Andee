// Andee Sandbox IDE - Main Entry Point

import { SandboxSelector } from "./components/SandboxSelector";
import { Terminal } from "./components/Terminal";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { StatusIndicator } from "./components/StatusIndicator";
import { SnapshotPanel } from "./components/SnapshotPanel";
import { PreviewBanner } from "./components/PreviewBanner";
import { showConfirmModal } from "./components/ConfirmModal";
import { showErrorModal } from "./components/ErrorModal";
import { restoreSnapshot } from "./lib/api";
import type { Sandbox, ConnectionStatus, PreviewState } from "./lib/types";

// Global state
let currentSandbox: Sandbox | null = null;
let terminal: Terminal | null = null;
let fileTree: FileTree | null = null;
let editor: Editor | null = null;
let statusIndicator: StatusIndicator | null = null;
let snapshotPanel: SnapshotPanel | null = null;
let previewBanner: PreviewBanner | null = null;

// Preview mode state
let previewState: PreviewState = {
  active: false,
  snapshotKey: null,
  snapshotDate: null,
};

// Initialize the IDE
async function init() {
  console.log("[IDE] Initializing Andee Sandbox IDE");

  // Initialize status indicator
  const statusContainer = document.getElementById("status");
  if (statusContainer) {
    statusIndicator = new StatusIndicator(statusContainer);
  }

  // Initialize preview banner
  const bannerContainer = document.getElementById("preview-banner");
  if (bannerContainer) {
    previewBanner = new PreviewBanner(bannerContainer, {
      onExitPreview: handleExitPreview,
      onRestore: handleRestoreFromPreview,
    });
  }

  // Initialize snapshot panel
  const snapshotContainer = document.getElementById("snapshot-panel");
  if (snapshotContainer) {
    snapshotPanel = new SnapshotPanel(snapshotContainer, {
      onPreview: handleEnterPreview,
      onRestore: handleRestore,
    });
  }

  // Initialize file tree FIRST (before sandbox selector triggers auto-select)
  const fileTreeContainer = document.getElementById("file-tree");
  if (fileTreeContainer) {
    fileTree = new FileTree(fileTreeContainer, handleFileSelect);
  }

  // Initialize editor
  const editorContainer = document.getElementById("editor");
  if (editorContainer) {
    editor = new Editor(editorContainer);
  }

  // Initialize terminal
  const terminalContainer = document.getElementById("terminal");
  if (terminalContainer) {
    terminal = new Terminal(terminalContainer, handleTerminalStatus);
  }

  // Initialize sandbox selector LAST (auto-selects first sandbox which needs other components ready)
  const selectorContainer = document.getElementById("sandbox-selector");
  if (selectorContainer) {
    const selector = new SandboxSelector(selectorContainer, handleSandboxChange);
    await selector.loadSandboxes();
  }

  // Set up terminal resize
  const resizer = createResizer();
  document.getElementById("terminal-container")?.prepend(resizer);

  console.log("[IDE] Initialization complete");
}

// Handle sandbox selection change
function handleSandboxChange(sandbox: Sandbox) {
  console.log(`[IDE] Switching to sandbox: ${sandbox.displayName}`);
  currentSandbox = sandbox;

  // Exit preview mode if active
  if (previewState.active) {
    handleExitPreview();
  }

  // Update snapshot panel
  if (snapshotPanel) {
    snapshotPanel.setSandbox(sandbox);
  }

  // Update file tree
  if (fileTree) {
    fileTree.setSandbox(sandbox);
    fileTree.loadDirectory(sandbox.id, "/");
  }

  // Update editor
  if (editor) {
    editor.setSandbox(sandbox);
    editor.clear();
  }

  // Update terminal connection
  if (terminal) {
    terminal.connect(sandbox.id);
  }
}

// Enter preview mode
function handleEnterPreview(snapshotKey: string, snapshotDate: string): void {
  console.log(`[IDE] Entering preview mode: ${snapshotKey}`);

  previewState = {
    active: true,
    snapshotKey,
    snapshotDate,
  };

  // Show banner
  if (previewBanner) {
    previewBanner.show(snapshotDate);
  }

  // Set FileTree to preview mode
  if (fileTree) {
    fileTree.setPreviewMode(snapshotKey);
  }

  // Set Editor to preview mode
  if (editor) {
    editor.setPreviewMode(snapshotKey);
  }
}

// Exit preview mode
async function handleExitPreview(): Promise<void> {
  console.log("[IDE] Exiting preview mode");

  previewState = {
    active: false,
    snapshotKey: null,
    snapshotDate: null,
  };

  // Hide banner
  if (previewBanner) {
    previewBanner.hide();
  }

  // Clear FileTree preview mode
  if (fileTree) {
    await fileTree.clearPreviewMode();
  }

  // Clear Editor preview mode
  if (editor) {
    editor.clearPreviewMode();
  }
}

// Handle restore from preview banner
async function handleRestoreFromPreview(): Promise<void> {
  if (!previewState.snapshotKey || !currentSandbox) return;

  const result = await showConfirmModal({
    title: "Restore This Snapshot?",
    message: "This will replace current files with the snapshot contents.",
    checkbox: {
      label: "Mark as latest (create new snapshot from restored state)",
      default: true,
    },
    confirmText: "Restore",
    cancelText: "Cancel",
  });

  if (result.confirmed) {
    await handleRestore(previewState.snapshotKey, result.checkboxValue ?? true);
  }
}

// Handle restore
async function handleRestore(snapshotKey: string, markAsLatest: boolean): Promise<void> {
  if (!currentSandbox) return;

  console.log(`[IDE] Restoring snapshot: ${snapshotKey}, markAsLatest: ${markAsLatest}`);

  try {
    // Disconnect terminal before restore
    if (terminal) {
      terminal.disconnect();
    }

    // Call restore API
    const result = await restoreSnapshot({
      chatId: currentSandbox.chatId,
      senderId: currentSandbox.senderId,
      isGroup: currentSandbox.isGroup,
      snapshotKey,
      markAsLatest,
    });

    if (result.success) {
      console.log(`[IDE] Restore successful, restoredFrom: ${result.restoredFrom}`);
      if (result.newSnapshotKey) {
        console.log(`[IDE] New snapshot created: ${result.newSnapshotKey}`);
      }

      // Exit preview mode if active
      if (previewState.active) {
        await handleExitPreview();
      }

      // Refresh file tree
      if (fileTree && currentSandbox) {
        await fileTree.loadDirectory(currentSandbox.id, "/");
      }

      // Refresh snapshot panel
      if (snapshotPanel) {
        await snapshotPanel.refresh();
      }

      // Reconnect terminal
      if (terminal && currentSandbox) {
        terminal.connect(currentSandbox.id);
      }
    } else {
      console.error("[IDE] Restore failed:", result.error);
      await showErrorModal({
        title: "Restore Failed",
        message: "The snapshot could not be restored.",
        details: result.error,
      });
    }
  } catch (error) {
    console.error("[IDE] Restore error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;
    await showErrorModal({
      title: "Restore Error",
      message: errorMessage,
      details: errorStack,
    });
  }
}

// Handle file selection from tree
function handleFileSelect(path: string) {
  console.log(`[IDE] File selected: ${path}`);
  if (editor && currentSandbox) {
    editor.openFile(currentSandbox.id, path);
  }
}

// Handle terminal status changes
function handleTerminalStatus(status: ConnectionStatus) {
  console.log(`[IDE] Terminal status: ${status}`);
  if (statusIndicator) {
    statusIndicator.setStatus(status);
  }
}

// Create resizable divider for terminal
function createResizer(): HTMLElement {
  const resizer = document.createElement("div");
  resizer.className = "resizer";

  let startY = 0;
  let startHeight = 0;

  const onMouseMove = (e: MouseEvent) => {
    const terminalContainer = document.getElementById("terminal-container");
    if (terminalContainer) {
      const newHeight = startHeight - (e.clientY - startY);
      terminalContainer.style.height = `${Math.max(100, Math.min(600, newHeight))}px`;
      terminal?.fit();
    }
  };

  const onMouseUp = () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  resizer.addEventListener("mousedown", (e) => {
    startY = e.clientY;
    startHeight =
      document.getElementById("terminal-container")?.offsetHeight || 300;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  return resizer;
}

// Start the app
init().catch((error) => {
  console.error("[IDE] Initialization failed:", error);
  document.body.innerHTML = `
    <div style="padding: 20px; color: #f14c4c;">
      <h2>Failed to initialize IDE</h2>
      <pre>${error.message}</pre>
    </div>
  `;
});
