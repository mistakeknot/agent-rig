# agent-rig Developer Guide

## Overview

agent-rig is the modpack system for AI coding agents. It provides a declarative manifest format (`agent-rig.json`) and CLI tooling to package, share, and install complete agent setups.

## Architecture

### Core Components

**Schema (`src/schema.ts`):** Zod-based validation for the `agent-rig.json` manifest. Defines all five layers: plugins, MCP servers, external tools, environment variables, and platform configs. The `AgentRig` type is the canonical representation used throughout the codebase.

**Loader (`src/loader.ts`):** Two responsibilities:
1. `resolveSource()` — Parse input strings into `GitHubSource` or `LocalSource`. Priority: absolute/relative paths > existing disk paths > GitHub URLs > owner/repo shorthand > fallback local.
2. `loadManifest()` — Read, parse, and validate `agent-rig.json` from a directory.

**Platform Adapters (`src/adapters/`):** The adapter pattern allows the same manifest to drive installation on different platforms. Each adapter implements `PlatformAdapter`:
- `detect()` — Is this platform available?
- `addMarketplaces()` — Register plugin sources
- `installPlugins()` — Install core, required, recommended, infrastructure plugins
- `disableConflicts()` — Disable conflicting plugins
- `verify()` — Health check MCP servers and tools

Current adapters: `ClaudeCodeAdapter` (fully implemented), `CodexAdapter` (stub — delegates to install script).

**Commands (`src/commands/`):** Four CLI commands, each in its own file:
- `install` — Full installation: clone, load, detect platforms, install plugins, tools, verify
- `validate` — Schema validation for rig authors
- `inspect` — Read-only examination (supports `--json`)
- `init` — Interactive scaffolding

### Data Flow

```
User input (GitHub URL / owner/repo / local path)
  → resolveSource() → RigSource
  → cloneToLocal() (if GitHub) → local directory
  → loadManifest() → AgentRig
  → adapter.detect() → which platforms are available
  → adapter.installPlugins() → InstallResult[]
  → adapter.disableConflicts() → InstallResult[]
  → installTools() → InstallResult[]
  → adapter.verify() → InstallResult[]
  → print summary
```

## Development

### Build & Test

```bash
pnpm build                              # TypeScript → dist/
node --test dist/**/*.test.js           # Run all tests
node dist/index.js validate examples/clavain  # Manual verification
```

### Adding a New Platform Adapter

1. Create `src/adapters/my-platform.ts` implementing `PlatformAdapter`
2. Add it to the adapters list in `src/commands/install.ts`
3. Add platform config to the `Platforms` schema in `src/schema.ts`
4. Add tests in `src/adapters/my-platform.test.ts`

### Adding a New CLI Command

1. Create `src/commands/my-command.ts` with an exported async function
2. Wire it into `src/index.ts` via `program.command()`

## Testing

Tests use Node.js built-in test runner (`node:test`). Test files are co-located with source as `*.test.ts`.

- `schema.test.ts` — Schema validation (minimal, full, invalid, extends)
- `loader.test.ts` — Source resolution and manifest loading
- `adapters/claude-code.test.ts` — Adapter interface compliance
- `e2e.test.ts` — End-to-end with Clavain example manifest

## Manifest Format

See `README.md` for the full `agent-rig.json` format reference. The Clavain example at `examples/clavain/agent-rig.json` is the canonical reference implementation with all five layers populated.

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
