# agent-rig Developer Guide

## Overview

agent-rig is the rig manager for AI coding agents. It provides a declarative manifest format (`agent-rig.json`) and CLI tooling to package, share, and install complete agent environments. Published as `@gensysven/agent-rig` on npm.

## Architecture

### Core Components

**Schema (`src/schema.ts`):** Zod-based validation for the `agent-rig.json` manifest. Defines all layers: plugins (with `depends` for dependency ordering), MCP servers, external tools, environment variables, behavioral config, and platform configs. The `AgentRig` type is the canonical representation used throughout the codebase.

**Loader (`src/loader.ts`):** Two responsibilities:
1. `resolveSource()` — Parse input strings into `GitHubSource` or `LocalSource`. Priority: absolute/relative paths > existing disk paths > GitHub URLs > owner/repo shorthand > fallback local.
2. `loadManifest()` — Read, parse, and validate `agent-rig.json` from a directory.

**State (`src/state.ts`):** Persistence layer for tracking installed rigs. State lives at `~/.agent-rig/state.json` and records only what each install *actually changed* (filtered by result status, not plan). This enables clean uninstall and accurate update diffs.

**Env (`src/env.ts`):** Shell profile management for environment variables. Writes tagged blocks (`# --- agent-rig: <name> ---`) to the detected shell profile (bash/zsh/fish). Handles write, replace, and remove operations idempotently.

**Exec (`src/exec.ts`):** Shared utilities — `execFileAsync` (promisified child_process) and `cloneToLocal` (git clone for GitHub sources).

**Platform Adapters (`src/adapters/`):** The adapter pattern allows the same manifest to drive installation on different platforms. Each adapter implements `PlatformAdapter`:
- `detect()` — Is this platform available?
- `checkConflicts()` — Pre-flight scan for installed plugins that conflict with the rig
- `addMarketplaces()` — Register plugin sources
- `installPlugins()` — Install plugins with topological dependency ordering
- `disableConflicts()` — Disable conflicting plugins
- `installMcpServers()` — Configure MCP servers via `claude mcp add`
- `installBehavioral()` — Copy CLAUDE.md/AGENTS.md with pointer injection and SHA-256 hash tracking
- `verify()` — Health check MCP servers and tools

Current adapters: `ClaudeCodeAdapter` (fully implemented), `CodexAdapter` (delegates to install script).

**Commands (`src/commands/`):** Nine CLI commands:
- `install` — Full installation with idempotency gate, conflict pre-flight, and state tracking
- `uninstall` — Reverse all install actions (plugins, conflicts, MCP servers, env vars, behavioral)
- `update` — Compute state-diff against latest manifest, apply only changes
- `upstream` — Scan marketplace repos for new/removed plugins and tool availability
- `status` — Show all installed rigs and their components
- `validate` — Schema validation for rig authors
- `inspect` — Read-only examination (supports `--json`)
- `init` — Interactive scaffolding

The `outdated` command is defined in `update.ts` alongside `update`.

### Data Flow

```
User input (GitHub URL / owner/repo / local path)
  → resolveSource() → RigSource
  → cloneToLocal() (if GitHub) → local directory
  → loadManifest() → AgentRig
  → getRigState() → idempotency check (same version = no-op)
  → adapter.detect() → which platforms are available
  → adapter.checkConflicts() → pre-flight conflict warnings
  → adapter.addMarketplaces() → InstallResult[]
  → adapter.installPlugins() → InstallResult[] (topo-sorted)
  → adapter.disableConflicts() → InstallResult[]
  → adapter.installMcpServers() → InstallResult[]
  → adapter.installBehavioral() → InstallResult[] (hash-tracked)
  → installTools() → InstallResult[]
  → writeEnvBlock() → tagged block in shell profile
  → setRigState() → persist to ~/.agent-rig/state.json
  → adapter.verify() → InstallResult[]
  → print summary
```

### Key Design Patterns

**State = diff, not snapshot:** The state file records only what THIS install changed, not the full system state. Uninstall reverses only its own changes. Update diffs against actual installed state.

**Delegate to platform CLI:** MCP servers are configured via `claude mcp add` rather than editing config files directly. This insulates agent-rig from internal format changes.

**Tagged blocks for file modifications:** Env vars in shell profiles use `# --- agent-rig: <name> ---` markers. Behavioral files use `<!-- agent-rig:<name> -->` pointer tags. Both enable clean identification and removal.

**SHA-256 hash tracking:** Behavioral files store their install-time hash in `install-manifest.json`. On re-install, if the file was modified by the user AND the new content differs, the overwrite is skipped with a warning.

**Topological dependency sort:** Plugins with `depends` fields are sorted via DFS before install, ensuring dependencies are installed first. Cycles fall back to original order.

## Development

### Build & Test

```bash
pnpm build                              # TypeScript → dist/
node --test dist/**/*.test.js           # Run all tests
node dist/index.js validate examples/clavain  # Manual verification
node dist/index.js inspect examples/clavain   # Full inspection
```

### Adding a New Platform Adapter

1. Create `src/adapters/my-platform.ts` implementing `PlatformAdapter`
2. Add it to the adapters list in `src/commands/install.ts`
3. Add platform config to the `Platforms` schema in `src/schema.ts`
4. Add tests in `src/adapters/my-platform.test.ts`

### Adding a New CLI Command

1. Create `src/commands/my-command.ts` with an exported async function
2. Wire it into `src/index.ts` via `program.command()`

### Publishing

```bash
pnpm build && node --test dist/**/*.test.js  # Verify
npm publish --access public                   # Publish to npm
git push                                      # Push to GitHub
```

Package is scoped as `@gensysven/agent-rig` due to npm name collision with existing `agentrig`.

## Testing

Tests use Node.js built-in test runner (`node:test`). Test files are co-located with source as `*.test.ts`.

- `schema.test.ts` — Schema validation (minimal, full, invalid, extends)
- `loader.test.ts` — Source resolution and manifest loading
- `adapters/claude-code.test.ts` — Adapter interface compliance
- `e2e.test.ts` — End-to-end with Clavain example manifest

## Manifest Format

See `README.md` for the full `agent-rig.json` format reference. The Clavain example at `examples/clavain/agent-rig.json` is the canonical reference implementation with all layers populated.

## Solution Documentation

Institutional knowledge is captured in `docs/solutions/best-practices/`:
- **reversible-cli-install-with-mcp-config** — P1: MCP server config, state tracking, uninstall
- **state-diff-incremental-update** — P2: diff-based updates, idempotent install, dependency ordering
- **tagged-block-env-and-hash-based-merge** — P3: shell profile management, behavioral file protection

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
