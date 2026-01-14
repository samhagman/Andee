# Base image with Node.js and sandbox runtime
FROM docker.io/cloudflare/sandbox:0.6.7

# Install Claude Code CLI (required runtime for Agent SDK)
RUN npm install -g @anthropic-ai/claude-code

# Install Agent SDK globally for the agent script
RUN npm install -g @anthropic-ai/claude-agent-sdk

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

# Copy PERSONALITY.md for personality/style prompt (loaded by agent scripts)
COPY --chown=claude:claude .claude/PERSONALITY.md /home/claude/.claude/PERSONALITY.md

# Expose port 8080 for persistent server (3000 is used by Sandbox infrastructure)
# Expose port 8081 for ttyd web terminal (used by Sandbox IDE)
EXPOSE 8080 8081

# Switch to non-root user
USER claude

# Set working directory for Claude operations
WORKDIR /workspace/files
