#!/usr/bin/env bun
/**
 * WebSocket Terminal Server using Bun
 * 
 * A simpler implementation that may work better with Cloudflare's wsConnect.
 */

import { spawn, type Subprocess } from 'bun';

const PORT = 8081;

console.log(`[ws-terminal-bun] Starting WebSocket terminal server on port ${PORT}...`);

type Shell = ReturnType<typeof spawn>;

const shells = new Map<WebSocket, Shell>();

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  
  fetch(req, server) {
    // Upgrade to WebSocket
    if (server.upgrade(req)) {
      return;
    }
    return new Response("WebSocket terminal server");
  },
  
  websocket: {
    open(ws) {
      console.log("[ws-terminal-bun] Client connected");
      
      // Spawn a bash shell
      const shell = spawn(["bash"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          HOME: "/home/claude",
          USER: "claude",
          TERM: "xterm-256color",
          PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
          NODE_PATH: "/usr/local/lib/node_modules",
        },
        cwd: "/workspace",
      });
      
      shells.set(ws, shell);
      
      // Pipe stdout to WebSocket (ttyd protocol: '0' prefix)
      (async () => {
        const reader = shell.stdout.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = new TextDecoder().decode(value);
          ws.send("0" + text);
        }
      })();
      
      // Pipe stderr to WebSocket
      (async () => {
        const reader = shell.stderr.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = new TextDecoder().decode(value);
          ws.send("0" + text);
        }
      })();
      
      // Handle shell exit
      shell.exited.then((code) => {
        console.log(`[ws-terminal-bun] Shell exited with code ${code}`);
        ws.close();
      });
    },
    
    message(ws, message) {
      const shell = shells.get(ws);
      if (!shell) return;
      
      const str = typeof message === "string" ? message : new TextDecoder().decode(message);
      const cmd = str[0];
      const payload = str.slice(1);
      
      if (cmd === "0") {
        // Input
        shell.stdin.write(payload);
      } else if (cmd === "1") {
        // Resize - bun doesn't have pty resize, ignore for now
        console.log("[ws-terminal-bun] Resize requested (not supported without node-pty)");
      }
    },
    
    close(ws, code, reason) {
      console.log(`[ws-terminal-bun] Client disconnected (code: ${code}, reason: ${reason})`);
      const shell = shells.get(ws);
      if (shell) {
        shell.kill();
        shells.delete(ws);
      }
    },
    
    error(ws, error) {
      console.error("[ws-terminal-bun] WebSocket error:", error);
    },
  },
});

console.log(`[ws-terminal-bun] Server listening on port ${PORT}`);
