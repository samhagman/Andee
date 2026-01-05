# Base image with Node.js and sandbox runtime
FROM docker.io/cloudflare/sandbox:0.6.7

# Install Claude Code CLI (required runtime for Agent SDK)
RUN npm install -g @anthropic-ai/claude-code

# Install Agent SDK globally for the agent script
RUN npm install -g @anthropic-ai/claude-agent-sdk

# Create non-root user (Claude Code refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash claude

# Create workspace directory with proper ownership
RUN mkdir -p /workspace/files && chown -R claude:claude /workspace

# KEY: Symlink global node_modules to /workspace so ESM imports work
RUN ln -s /usr/local/lib/node_modules /workspace/node_modules

# Create .claude directory for the user
RUN mkdir -p /home/claude/.claude && chown -R claude:claude /home/claude/.claude

# Copy skills into container
COPY --chown=claude:claude .claude/skills/ /home/claude/.claude/skills/

# Expose port 8080 for persistent server (3000 is used by Sandbox infrastructure)
EXPOSE 8080

# Switch to non-root user
USER claude

# Set working directory for Claude operations
WORKDIR /workspace/files
