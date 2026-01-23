// Terminal Component using xterm.js

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { workerUrl, getApiKey } from "../lib/api";
import type { ConnectionStatus } from "../lib/types";

export class Terminal {
  private term: XTerm;
  private fitAddon: FitAddon;
  private ws: WebSocket | null = null;
  private sandboxId: string | null = null;
  private onStatusChange: (status: ConnectionStatus) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Cache terminal URLs to avoid re-exposing on reconnect (which kills connections)
  private cachedWsUrls: Map<string, string> = new Map();

  constructor(
    container: HTMLElement,
    onStatusChange: (status: ConnectionStatus) => void
  ) {
    this.onStatusChange = onStatusChange;

    // Create terminal
    this.term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        cursorAccent: "#1e1e1e",
        selectionBackground: "#264f78",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#e5e5e5",
      },
    });

    // Load addons
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());

    // Open terminal
    this.term.open(container);
    this.fit();

    // Handle user input - send to ttyd using its protocol
    // ttyd expects: type byte (0=input) + raw data
    this.term.onData((data) => {
      this.sendInput(data);
    });

    // Handle resize
    window.addEventListener("resize", () => this.fit());

    // Show welcome message
    this.term.writeln("\x1b[90m[Sandbox IDE Terminal]\x1b[0m");
    this.term.writeln("\x1b[90mSelect a sandbox to connect...\x1b[0m");
    this.term.writeln("");
  }

  // Connect to a sandbox
  connect(sandboxId: string): void {
    // Cancel any pending reconnect from previous sandbox
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.sandboxId = sandboxId;
    this.reconnectAttempts = 0;
    this.doConnect();
  }

  private async doConnect(): Promise<void> {
    if (!this.sandboxId) return;

    // IMPORTANT: Capture sandboxId in closure for async event handlers
    // This prevents the bug where switching sandboxes causes old WebSocket's
    // error/close handlers to delete the WRONG sandbox's cache
    const currentSandboxId = this.sandboxId;

    // Close existing connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.onStatusChange("connecting");
    this.term.writeln(`\x1b[90m[Connecting to ${currentSandboxId}...]\x1b[0m`);

    try {
      let wsUrl: string;

      // Check cache first - use cached URL for reconnects to avoid killing existing port exposures
      const cachedUrl = this.cachedWsUrls.get(currentSandboxId);
      if (cachedUrl && this.reconnectAttempts > 0) {
        // Use cached URL for reconnects
        console.log("[Terminal] Using cached URL for reconnect:", cachedUrl);
        this.term.writeln(`\x1b[90m[Reconnecting...]\x1b[0m`);
        wsUrl = cachedUrl;
      } else {
        // Fetch fresh URL for initial connection
        const baseUrl = workerUrl();
        const apiKey = getApiKey();
        const params = new URLSearchParams({ sandbox: currentSandboxId });
        const infoUrl = `${baseUrl}/terminal-url?${params}`;

        console.log("[Terminal] Getting terminal URL from:", infoUrl);
        this.term.writeln(`\x1b[90m[Getting terminal URL...]\x1b[0m`);

        const response = await fetch(infoUrl, {
          headers: { "X-API-Key": apiKey },
        });

        if (!response.ok) {
          const errorData = await response.json() as { error?: string };
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json() as { success?: boolean; wsUrl?: string; error?: string };

        if (!data.success || !data.wsUrl) {
          throw new Error(data.error || "Failed to get terminal URL");
        }

        wsUrl = data.wsUrl;
        // Cache the URL for future reconnects
        this.cachedWsUrls.set(currentSandboxId, wsUrl);
      }

      console.log("[Terminal] Connecting to exposed URL:", wsUrl);
      this.term.writeln(`\x1b[90m[Connecting to ${wsUrl}...]\x1b[0m`);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        // Only process if this is still the current sandbox
        if (this.sandboxId !== currentSandboxId) return;

        this.onStatusChange("connected");
        this.reconnectAttempts = 0;
        this.term.writeln("\x1b[32m[Connected]\x1b[0m");
        this.term.writeln("");

        // Send terminal size after brief delay to ensure PTY is ready
        // This ensures the PTY shell knows the actual terminal dimensions
        setTimeout(() => {
          this.fit(); // Calls sendResize internally
        }, 100);
      };

      this.ws.onmessage = (event) => {
        // Only process if this is still the current sandbox
        if (this.sandboxId !== currentSandboxId) return;

        console.log("[Terminal] Received:", typeof event.data, event.data instanceof ArrayBuffer ? "ArrayBuffer" : event.data?.slice?.(0, 50));

        // ttyd protocol: first character is message type (ASCII)
        // '0' = terminal output
        // '1' = window title
        // '2' = preferences
        if (typeof event.data === "string") {
          const msgType = event.data[0];
          const payload = event.data.slice(1);

          if (msgType === "0") {
            // Output - write to terminal
            this.term.write(payload);
          } else if (msgType === "1") {
            // Window title - ignore for now
          } else {
            // Unknown message type - might be raw output without prefix
            console.log("[Terminal] Unknown msgType:", msgType.charCodeAt(0));
            this.term.write(event.data);
          }
        } else if (event.data instanceof ArrayBuffer) {
          // Binary data - try to decode
          const data = new Uint8Array(event.data);
          console.log("[Terminal] Binary data, first bytes:", Array.from(data.slice(0, 10)));
          const text = new TextDecoder().decode(data);
          this.term.write(text);
        }
      };

      this.ws.onclose = (event) => {
        // Only process if this is still the current sandbox
        // This prevents switching sandboxes from causing reconnect loops
        if (this.sandboxId !== currentSandboxId) {
          console.log(`[Terminal] Ignoring close event for old sandbox ${currentSandboxId} (current: ${this.sandboxId})`);
          return;
        }

        this.onStatusChange("disconnected");
        this.term.writeln("");
        this.term.writeln(
          `\x1b[31m[Disconnected: ${event.reason || "Connection closed"}]\x1b[0m`
        );

        // Attempt reconnect
        if (
          this.reconnectAttempts < this.maxReconnectAttempts &&
          this.sandboxId === currentSandboxId
        ) {
          this.reconnectAttempts++;
          this.term.writeln(
            `\x1b[90m[Reconnecting in 2s... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})]\x1b[0m`
          );
          // Store the timer so it can be cancelled if sandbox changes
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.doConnect();
          }, 2000);
        } else if (this.sandboxId === currentSandboxId) {
          // Exhausted reconnect attempts - invalidate cache so next connect gets fresh URL
          this.cachedWsUrls.delete(currentSandboxId);
        }
      };

      this.ws.onerror = () => {
        // Only process if this is still the current sandbox
        if (this.sandboxId !== currentSandboxId) {
          console.log(`[Terminal] Ignoring error event for old sandbox ${currentSandboxId} (current: ${this.sandboxId})`);
          return;
        }

        this.onStatusChange("error");
        this.term.writeln("\x1b[31m[Connection error]\x1b[0m");
        // Invalidate cache on error - URL might be stale
        this.cachedWsUrls.delete(currentSandboxId);
      };
    } catch (error) {
      // Only process if this is still the current sandbox
      if (this.sandboxId !== currentSandboxId) return;

      this.onStatusChange("error");
      this.term.writeln(
        `\x1b[31m[Failed to connect: ${error instanceof Error ? error.message : "Unknown error"}]\x1b[0m`
      );
    }
  }

  // Send input to ttyd (protocol: '0' prefix + data)
  // ttyd uses ASCII '0' (0x30) for input, not binary 0
  private sendInput(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // ttyd expects: '0' + input data as text
      this.ws.send("0" + data);
    }
  }

  // Send resize to ttyd ('1' prefix + JSON)
  private sendResize(cols: number, rows: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // ttyd expects: '1' + JSON for resize
      this.ws.send("1" + JSON.stringify({ columns: cols, rows: rows }));
    }
  }

  // Disconnect from sandbox
  disconnect(): void {
    this.sandboxId = null;
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnect
    // Cancel any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.onStatusChange("disconnected");
  }

  // Fit terminal to container
  fit(): void {
    try {
      this.fitAddon.fit();
      // Send resize to server
      this.sendResize(this.term.cols, this.term.rows);
    } catch {
      // Ignore fit errors during initialization
    }
  }

  // Clear terminal
  clear(): void {
    this.term.clear();
  }

  // Focus terminal
  focus(): void {
    this.term.focus();
  }

  // Write text to terminal
  write(text: string): void {
    this.term.write(text);
  }

  writeln(text: string): void {
    this.term.writeln(text);
  }
}
