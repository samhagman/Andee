// Terminal Component using xterm.js

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { workerUrl } from "../lib/api";
import type { ConnectionStatus } from "../lib/types";

// Get API key from localStorage
function getApiKey(): string {
  return localStorage.getItem("andee-ide-api-key") || "";
}

export class Terminal {
  private term: XTerm;
  private fitAddon: FitAddon;
  private ws: WebSocket | null = null;
  private sandboxId: string | null = null;
  private onStatusChange: (status: ConnectionStatus) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

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
    this.sandboxId = sandboxId;
    this.reconnectAttempts = 0;
    this.doConnect();
  }

  private async doConnect(): Promise<void> {
    if (!this.sandboxId) return;

    // Close existing connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.onStatusChange("connecting");
    this.term.writeln(`\x1b[90m[Connecting to ${this.sandboxId}...]\x1b[0m`);

    try {
      // Connect via WebSocket - server proxies to ttyd
      const baseUrl = workerUrl();
      const wsBase = baseUrl.replace(/^http/, "ws");
      const apiKey = getApiKey();
      const params = new URLSearchParams({ sandbox: this.sandboxId, apiKey });
      const wsUrl = `${wsBase}/ws?${params}`;

      console.log("[Terminal] Connecting to:", wsUrl);
      this.term.writeln(`\x1b[90m[Connecting to ttyd...]\x1b[0m`);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
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
        this.onStatusChange("disconnected");
        this.term.writeln("");
        this.term.writeln(
          `\x1b[31m[Disconnected: ${event.reason || "Connection closed"}]\x1b[0m`
        );

        // Attempt reconnect
        if (
          this.reconnectAttempts < this.maxReconnectAttempts &&
          this.sandboxId
        ) {
          this.reconnectAttempts++;
          this.term.writeln(
            `\x1b[90m[Reconnecting in 2s... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})]\x1b[0m`
          );
          setTimeout(() => this.doConnect(), 2000);
        }
      };

      this.ws.onerror = () => {
        this.onStatusChange("error");
        this.term.writeln("\x1b[31m[Connection error]\x1b[0m");
      };
    } catch (error) {
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
