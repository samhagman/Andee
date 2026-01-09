// Monaco Editor Component

import * as monaco from "monaco-editor";
import { readFile, writeFile } from "../lib/api";

// Import workers using Vite's syntax
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// Configure Monaco workers
self.MonacoEnvironment = {
  getWorker: function (_workerId: string, label: string) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

interface OpenFile {
  path: string;
  sandboxId: string;
  model: monaco.editor.ITextModel;
  originalContent: string;
  modified: boolean;
}

export class Editor {
  private container: HTMLElement;
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private openFiles: Map<string, OpenFile> = new Map();
  private currentFile: OpenFile | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.initEditor();
  }

  private initEditor(): void {
    // Show placeholder initially
    this.container.innerHTML = `
      <div class="placeholder">
        Select a file to edit
      </div>
    `;
  }

  private ensureEditor(): monaco.editor.IStandaloneCodeEditor {
    if (!this.editor) {
      this.container.innerHTML = "";
      this.editor = monaco.editor.create(this.container, {
        theme: "vs-dark",
        automaticLayout: true,
        minimap: { enabled: true },
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        fontLigatures: true,
        lineNumbers: "on",
        renderWhitespace: "selection",
        tabSize: 2,
        insertSpaces: true,
        scrollBeyondLastLine: false,
        wordWrap: "on",
        padding: { top: 8 },
      });

      // Save on Ctrl+S
      this.editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => {
          this.saveCurrentFile();
        }
      );
    }
    return this.editor;
  }

  async openFile(sandboxId: string, path: string): Promise<void> {
    const key = `${sandboxId}:${path}`;

    // Check if already open
    let openFile = this.openFiles.get(key);

    if (!openFile) {
      try {
        const response = await readFile(sandboxId, path);
        const content =
          response.encoding === "base64"
            ? atob(response.content)
            : response.content;

        const language = this.detectLanguage(path);
        const model = monaco.editor.createModel(
          content,
          language,
          monaco.Uri.parse(`file://${path}`)
        );

        openFile = {
          path,
          sandboxId,
          model,
          originalContent: content,
          modified: false,
        };

        // Track modifications
        model.onDidChangeContent(() => {
          if (openFile) {
            openFile.modified =
              model.getValue() !== openFile.originalContent;
            this.updateTabState(openFile);
          }
        });

        this.openFiles.set(key, openFile);
        this.addTab(openFile);
      } catch (error) {
        console.error(`[Editor] Failed to open file ${path}:`, error);
        return;
      }
    }

    // Switch to this file
    this.currentFile = openFile;
    const editor = this.ensureEditor();
    editor.setModel(openFile.model);
    this.updateActiveTab(key);
  }

  private async saveCurrentFile(): Promise<void> {
    if (!this.currentFile || !this.currentFile.modified) return;

    try {
      const content = this.currentFile.model.getValue();
      await writeFile({
        sandbox: this.currentFile.sandboxId,
        path: this.currentFile.path,
        content,
      });

      this.currentFile.originalContent = content;
      this.currentFile.modified = false;
      this.updateTabState(this.currentFile);

      console.log(`[Editor] Saved ${this.currentFile.path}`);
    } catch (error) {
      console.error(`[Editor] Failed to save:`, error);
    }
  }

  private detectLanguage(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: "typescript",
      tsx: "typescript",
      js: "javascript",
      jsx: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      json: "json",
      md: "markdown",
      css: "css",
      scss: "scss",
      less: "less",
      html: "html",
      xml: "xml",
      yaml: "yaml",
      yml: "yaml",
      toml: "toml",
      sh: "shell",
      bash: "shell",
      py: "python",
      rs: "rust",
      go: "go",
      sql: "sql",
      dockerfile: "dockerfile",
    };
    return ext ? (languageMap[ext] || "plaintext") : "plaintext";
  }

  private addTab(file: OpenFile): void {
    const tabsContainer = document.getElementById("editor-tabs");
    if (!tabsContainer) return;

    const key = `${file.sandboxId}:${file.path}`;
    const tab = document.createElement("div");
    tab.className = "editor-tab";
    tab.dataset.key = key;

    const name = document.createElement("span");
    name.textContent = file.path.split("/").pop() || file.path;
    tab.appendChild(name);

    const close = document.createElement("span");
    close.className = "close";
    close.textContent = "×";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeFile(key);
    });
    tab.appendChild(close);

    tab.addEventListener("click", () => {
      const openFile = this.openFiles.get(key);
      if (openFile) {
        this.currentFile = openFile;
        this.ensureEditor().setModel(openFile.model);
        this.updateActiveTab(key);
      }
    });

    tabsContainer.appendChild(tab);
  }

  private updateActiveTab(activeKey: string): void {
    const tabs = document.querySelectorAll(".editor-tab");
    tabs.forEach((tab) => {
      const el = tab as HTMLElement;
      el.classList.toggle("active", el.dataset.key === activeKey);
    });
  }

  private updateTabState(file: OpenFile): void {
    const key = `${file.sandboxId}:${file.path}`;
    const tab = document.querySelector(
      `.editor-tab[data-key="${key}"]`
    ) as HTMLElement;
    if (tab) {
      const name = tab.querySelector("span:first-child");
      if (name) {
        const baseName = file.path.split("/").pop() || file.path;
        name.textContent = file.modified ? `${baseName} •` : baseName;
      }
    }
  }

  private closeFile(key: string): void {
    const file = this.openFiles.get(key);
    if (file) {
      file.model.dispose();
      this.openFiles.delete(key);

      // Remove tab
      const tab = document.querySelector(`.editor-tab[data-key="${key}"]`);
      tab?.remove();

      // Switch to another file or show placeholder
      if (this.currentFile && `${this.currentFile.sandboxId}:${this.currentFile.path}` === key) {
        const remaining = Array.from(this.openFiles.values());
        if (remaining.length > 0) {
          this.currentFile = remaining[remaining.length - 1];
          this.ensureEditor().setModel(this.currentFile.model);
          this.updateActiveTab(
            `${this.currentFile.sandboxId}:${this.currentFile.path}`
          );
        } else {
          this.currentFile = null;
          if (this.editor) {
            this.editor.dispose();
            this.editor = null;
          }
          this.initEditor();
        }
      }
    }
  }

  clear(): void {
    // Close all files
    for (const [, file] of this.openFiles) {
      file.model.dispose();
    }
    this.openFiles.clear();
    this.currentFile = null;

    // Clear tabs
    const tabsContainer = document.getElementById("editor-tabs");
    if (tabsContainer) {
      tabsContainer.innerHTML = "";
    }

    // Reset editor
    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }
    this.initEditor();
  }
}
