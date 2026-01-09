// Andee Sandbox IDE - Main Entry Point

import { SandboxSelector } from "./components/SandboxSelector";
import { Terminal } from "./components/Terminal";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { StatusIndicator } from "./components/StatusIndicator";
import type { Sandbox, ConnectionStatus } from "./lib/types";

// Global state
let currentSandbox: Sandbox | null = null;
let terminal: Terminal | null = null;
let fileTree: FileTree | null = null;
let editor: Editor | null = null;
let statusIndicator: StatusIndicator | null = null;

// Initialize the IDE
async function init() {
  console.log("[IDE] Initializing Andee Sandbox IDE");

  // Initialize status indicator
  const statusContainer = document.getElementById("status");
  if (statusContainer) {
    statusIndicator = new StatusIndicator(statusContainer);
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

  // Update terminal connection
  if (terminal) {
    terminal.connect(sandbox.id);
  }

  // Load file tree for new sandbox (start at root to see full filesystem)
  if (fileTree) {
    fileTree.loadDirectory(sandbox.id, "/");
  }

  // Clear editor
  if (editor) {
    editor.clear();
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
