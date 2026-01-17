# Base image with Node.js and sandbox runtime
FROM docker.io/cloudflare/sandbox:0.6.7

# Install Claude Code CLI (required runtime for Agent SDK - kept for USE_GOOSE=false fallback)
# PINNED: Prevents breaking changes from auto-updates
RUN npm install -g @anthropic-ai/claude-code@2.1.9

# Install Agent SDK globally for the agent script (kept for USE_GOOSE=false fallback)
# PINNED: Prevents breaking changes from auto-updates
RUN npm install -g @anthropic-ai/claude-agent-sdk@0.2.9

# Install bzip2 (required to extract Goose CLI tarball)
RUN apt-get update && apt-get install -y bzip2 && rm -rf /var/lib/apt/lists/*

# Install Goose CLI for GLM-4.7 migration (USE_ENGINE=goose path)
# Downloads and installs the Goose binary from Block's releases
# CONFIGURE=false skips interactive setup (we configure via env vars)
RUN curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash && \
    mv /root/.local/bin/goose /usr/local/bin/goose && \
    goose --version

# Install OpenCode CLI for persistent server mode (USE_ENGINE=opencode path)
# OpenCode provides the server binary and SDK client for Cerebras GLM-4.7
# Note: Install script puts binary at $HOME/.opencode/bin/opencode
# PINNED to v1.1.21: Prevents breaking changes from auto-updates
RUN curl -fsSL https://opencode.ai/install | OPENCODE_VERSION=1.1.21 bash && \
    mv /root/.opencode/bin/opencode /usr/local/bin/opencode && \
    opencode --version

# Install OpenCode SDK for Node.js + AI SDK for Cerebras provider
# PINNED: Prevents breaking changes from auto-updates
RUN npm install -g @opencode-ai/sdk@1.1.23 @ai-sdk/openai-compatible

# Install Bun runtime for TypeScript skill scripts (analyzing-media, analyze-video)
# Bun provides fast TypeScript execution without compilation step
# PINNED to v1.3.5: v1.3.6 has AVX regression causing crash under Rosetta/Docker emulation
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/root/.bun bash -s "bun-v1.3.5" && \
    mv /root/.bun/bin/bun /usr/local/bin/bun && \
    bun --version

# Install Perplexity MCP server for web search capability (used by Goose + OpenCode)
RUN npm install -g server-perplexity-ask

# Install build dependencies for native node modules (node-pty requires compilation)
RUN apt-get update && apt-get install -y build-essential python3 && rm -rf /var/lib/apt/lists/*

# Install ws + node-pty for custom WebSocket terminal server with PTY support
# node-pty provides proper terminal emulation (resize, isatty, job control)
RUN npm install -g ws node-pty

# Install memvid CLI for conversation memory
# See: https://memvid.com/ and https://docs.memvid.com/
# Note: Explicitly install linux-x64 binary to avoid optionalDependency issues
# Cache bust: 2026-01-07-v3-FORCE
RUN npm install -g @memvid/cli-linux-x64 && \
    ln -s /usr/local/lib/node_modules/@memvid/cli-linux-x64/memvid /usr/local/bin/memvid && \
    memvid --version

# Install yq for YAML frontmatter queries (artifact system)
RUN wget https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 \
    -O /usr/bin/yq && chmod +x /usr/bin/yq

# Install jq for JSON processing (used by artifact scripts)
# Install ttyd for web terminal access (used by Sandbox IDE)
RUN apt-get update && apt-get install -y jq uuid-runtime ttyd && rm -rf /var/lib/apt/lists/*

# Create non-root user (Claude Code refuses --dangerously-skip-permissions as root)
# Add to fuse group for R2 bucket mounting via s3fs
RUN useradd -m -s /bin/bash claude && \
    (getent group fuse && usermod -aG fuse claude || true)

# Create workspace directory with proper ownership
RUN mkdir -p /workspace/files && chown -R claude:claude /workspace

# KEY: Symlink global node_modules to /workspace so ESM imports work
RUN ln -s /usr/local/lib/node_modules /workspace/node_modules

# Create .claude directory for the user
RUN mkdir -p /home/claude/.claude && chown -R claude:claude /home/claude/.claude

# Create .config directory and subdirs for Goose and OpenCode
# IMPORTANT: chown the entire .config dir, not just subdirs (otherwise parent is root-owned)
RUN mkdir -p /home/claude/.config/goose /home/claude/.config/opencode \
    && chown -R claude:claude /home/claude/.config

# Create .opencode config directory in home (OpenCode looks for ~/.opencode/opencode.json)
RUN mkdir -p /home/claude/.opencode && chown -R claude:claude /home/claude/.opencode

# Create OpenCode auth and state directories for credentials and runtime storage
# Note: auth.json will be created at runtime with CEREBRAS_API_KEY from env
RUN mkdir -p /home/claude/.local/share/opencode \
    && mkdir -p /home/claude/.local/state \
    && chown -R claude:claude /home/claude/.local

# Pre-create memory directory structure (for artifacts and conversation memory)
RUN mkdir -p /home/claude/shared/lists \
    && mkdir -p /home/claude/private \
    && chown -R claude:claude /home/claude/shared /home/claude/private

# Create /media mount point for R2 bucket (s3fs requires existing directory with write perms)
RUN mkdir -p /media && chown claude:claude /media

# Copy Claude Code settings (disallowedPaths protects /tmp/protected/)
COPY --chown=claude:claude .claude/settings.json /home/claude/.claude/settings.json

# Copy shared helper scripts (used by skills internally)
COPY --chown=claude:claude .claude/scripts/ /home/claude/.claude/scripts/
RUN chmod +x /home/claude/.claude/scripts/*.sh /home/claude/.claude/scripts/*.js 2>/dev/null || true

# Copy skills into container
COPY --chown=claude:claude .claude/skills/ /home/claude/.claude/skills/

# Make skill scripts executable
RUN find /home/claude/.claude/skills -name "*.sh" -exec chmod +x {} \;

# Add skill scripts to PATH via symlinks in /usr/local/bin
# This allows running "set-reminder" instead of full path
RUN ln -s /home/claude/.claude/skills/reminders/scripts/set-reminder.sh /usr/local/bin/set-reminder && \
    ln -s /home/claude/.claude/skills/reminders/scripts/list-reminders.sh /usr/local/bin/list-reminders && \
    ln -s /home/claude/.claude/skills/reminders/scripts/cancel-reminder.sh /usr/local/bin/cancel-reminder

# Copy CLAUDE.md for project-level instructions (Claude Code finds this from cwd)
COPY --chown=claude:claude CLAUDE.md /workspace/CLAUDE.md

# Copy CLAUDE.md for system instructions (loaded by all engines)
ARG CLAUDE_MD_VERSION=2026-01-15-v3-session-validation
COPY --chown=claude:claude .claude/CLAUDE.md /home/claude/CLAUDE.md

# Copy Goose configuration (extensions + MCP servers)
# config.yaml enables developer and skills extensions
# mcp.json configures Perplexity for web search
COPY --chown=claude:claude .goose/ /home/claude/.config/goose/

# Copy OpenCode configuration (Cerebras provider + Perplexity MCP)
# OpenCode looks for opencode.json in CWD first, then ~/.opencode/
# Since server runs with cwd=/home/claude, place config at /home/claude/opencode.json
COPY --chown=claude:claude .opencode/opencode.json /home/claude/opencode.json

# Expose port 8080 for persistent server (3000 is used by Sandbox infrastructure)
# Expose port 8081 for ttyd web terminal (used by Sandbox IDE)
EXPOSE 8080 8081

# Switch to non-root user
USER claude

# Set working directory for Claude operations
WORKDIR /workspace/files
