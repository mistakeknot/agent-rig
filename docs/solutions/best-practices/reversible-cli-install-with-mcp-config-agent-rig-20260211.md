---
module: agent-rig
date: 2026-02-11
problem_type: best_practice
component: cli
symptoms:
  - "MCP servers declared in manifest but not configured after install"
  - "No way to uninstall a rig or know what was installed"
  - "Re-running install blindly re-applies everything"
root_cause: incomplete_setup
resolution_type: tooling_addition
severity: high
tags: [mcp-servers, state-tracking, uninstall, claude-code, reversible-install, cli-lifecycle]
---

# Best Practice: Reversible CLI Installation with MCP Server Configuration

## Problem

agent-rig's install command declared MCP servers in the manifest but never actually configured them. Users ran `agent-rig install` and got "success" but MCP tools didn't work until they manually configured each server. Additionally, there was no record of what was installed, no way to uninstall, and no idempotency.

## Environment
- Module: agent-rig (rig manager for AI coding agents)
- Framework Version: 0.1.0
- Affected Component: CLI install pipeline, PlatformAdapter interface
- Date: 2026-02-11

## Symptoms
- After `agent-rig install`, MCP server tools (context7, qmd) were not available
- No `~/.agent-rig/state.json` — no record of what was installed
- No `agent-rig uninstall` command
- No `agent-rig status` command
- Re-running install duplicated work with no awareness of prior state

## What Didn't Work

**Attempted Solution 1:** Hand-editing `.claude.json` to add MCP server entries
- **Why it failed:** `.claude.json` format varies between Claude Code versions, and manual edits bypass validation. The `claude mcp add` CLI handles scoping, format, and deduplication correctly.

**Attempted Solution 2:** Writing a `.mcp.json` project file
- **Why it failed:** Plugins use `.mcp.json` within their plugin directory (auto-discovered by Claude Code), but rig-level MCP servers (like mcp-agent-mail) are user-scoped, not project-scoped. A project `.mcp.json` would need manual approval per project.

## Solution

### 1. MCP Server Configuration via `claude mcp add`

Added `installMcpServers()` to the `PlatformAdapter` interface and implemented it in `ClaudeCodeAdapter` using the `claude mcp add` CLI.

```typescript
// Before (broken): MCP servers only shown in verify step, never configured
async verify(rig: AgentRig): Promise<InstallResult[]> {
  // Only checked health, never installed
}

// After (fixed): MCP servers configured via claude CLI
async installMcpServers(rig: AgentRig): Promise<InstallResult[]> {
  for (const [name, server] of Object.entries(rig.mcpServers ?? {})) {
    // Idempotent: check if already configured
    const existing = await run("claude", ["mcp", "get", name]);
    if (existing.ok && !existing.output.includes("not found")) {
      // Skip — already configured
      continue;
    }

    // Build args based on transport type
    let addArgs: string[];
    if (server.type === "http") {
      addArgs = ["mcp", "add", "--transport", "http", "--scope", "user", name, server.url];
    } else if (server.type === "sse") {
      addArgs = ["mcp", "add", "--transport", "sse", "--scope", "user", name, server.url];
    } else {
      // stdio: command and args go after --
      addArgs = ["mcp", "add", "--scope", "user", name, "--", server.command, ...(server.args ?? [])];
    }

    await run("claude", addArgs);
  }
}
```

Key decisions:
- **`--scope user`** so servers are available globally, not just in one project
- **`claude mcp get` for idempotency** — check before adding
- **Transport-type dispatch** — http/sse use `--transport` flag, stdio uses `--` separator

### 2. State Tracking with `~/.agent-rig/state.json`

Created `src/state.ts` module that records everything the install changed:

```typescript
interface RigState {
  name: string;
  version: string;
  source: string;
  installedAt: string;
  plugins: string[];           // Only plugins THIS install added
  disabledConflicts: string[]; // Only conflicts THIS install disabled
  mcpServers: InstalledMcpServer[];
  behavioral: InstalledBehavioral[];
  marketplaces: string[];
}
```

The install command collects results from each adapter step, filters for `status === "installed"` or `status === "disabled"`, and saves only what was actually changed — not what was already there.

### 3. Uninstall Command

`agent-rig uninstall <name>` reads state and reverses each action:
- `claude plugin uninstall` for plugins
- `claude plugin enable` for re-enabling conflicts
- `claude mcp remove --scope user` for MCP servers
- File deletion + pointer removal for behavioral config

## Why This Works

1. **Delegation to platform CLI:** Using `claude mcp add` instead of editing config files directly means agent-rig doesn't need to know the internal config format — it just uses the stable CLI interface. If Claude Code changes its config format, agent-rig still works.

2. **State = diff, not snapshot:** The state file records only what THIS install changed, not the full system state. This means uninstall can safely reverse only its own changes without touching pre-existing plugins/servers.

3. **Idempotent by design:** Each step checks before acting (plugin already installed? MCP server already configured?) so re-running install is safe.

## Prevention

- When building CLI tools that modify external system config, always use the target system's own CLI rather than editing config files directly
- Always implement install state tracking from the start — retrofitting it is much harder
- Design uninstall as the inverse of install, not as a separate concern
- Record what you *actually changed*, not what you *planned to change* (filter by result status)

## Related Issues

- See also: [state-diff-incremental-update-agent-rig-20260211.md](state-diff-incremental-update-agent-rig-20260211.md) — P2 extension (diff-based update, idempotent install, dependency ordering)
- See also: [tagged-block-env-and-hash-based-merge-agent-rig-20260211.md](tagged-block-env-and-hash-based-merge-agent-rig-20260211.md) — P3 safe file management (shell profiles, modification detection)
