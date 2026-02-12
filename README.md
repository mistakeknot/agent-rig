# agent-rig

The rig manager for AI coding agents — package, share, and install complete agent environments with one command.

## Plugins vs Rigs

A **plugin** adds capabilities to your agent — skills, commands, hooks, MCP servers. It's what your agent *can do*.

A **rig** creates the environment where those capabilities work together. On top of a core plugin, a rig manages:

| Layer | What | Example |
|---|---|---|
| Plugin ecosystem | Companion plugins the core depends on or works best with | context7, serena, interdoc |
| Conflict resolution | Plugins that clash and should be disabled | code-review, commit-commands |
| External tools | CLI tools outside the plugin system | oracle, codex, beads |
| MCP servers | With richer config than plugin.json allows | health checks, descriptions |
| Environment variables | Shell env needed for tools to work | DISPLAY, CHROME_PATH |
| Behavioral config | CLAUDE.md conventions the rig expects | trunk-based dev, tool usage rules |
| Platform adapters | Per-platform setup | marketplaces, Codex skills dir |

> **A plugin adds capabilities. A rig creates the environment where those capabilities work together.**

Installing `clavain@interagency-marketplace` gives you the plugin. Running `agent-rig install mistakeknot/Clavain` gives you the plugin *plus* companion plugins, disables conflicting ones, sets up MCP servers, checks CLI tools, writes env vars to your shell profile, and installs behavioral conventions — all in one command.

## Quick Start

### Install a rig

```bash
# From a GitHub repo
npx agent-rig install mistakeknot/Clavain

# From a local directory
npx agent-rig install ./my-rig

# Dry run (see what would be installed)
npx agent-rig install --dry-run mistakeknot/Clavain
```

### Manage installed rigs

```bash
# See what's installed
agent-rig status

# Update to the latest version
agent-rig update clavain

# Check all rigs for newer versions (without applying)
agent-rig outdated

# Clean uninstall — reverses everything
agent-rig uninstall clavain
```

### Inspect before installing

```bash
agent-rig inspect mistakeknot/Clavain
agent-rig inspect --json mistakeknot/Clavain
```

Or point your coding agent at it and ask: *"Review this rig and tell me what makes sense for my workflow."*

### Create your own rig

```bash
agent-rig init
# Edit the generated agent-rig.json
agent-rig validate
```

## Features

### Autonomous Installation

agent-rig handles the entire setup process:

- **Plugins**: Installs from marketplaces with dependency ordering (topological sort)
- **Conflicts**: Scans for installed plugins that clash, disables declared conflicts
- **MCP servers**: Configures via `claude mcp add` with transport-type dispatch (http/sse/stdio)
- **External tools**: Checks if installed, runs install commands for required tools
- **Environment variables**: Writes to your shell profile (bash/zsh/fish) as tagged blocks
- **Behavioral config**: Copies CLAUDE.md/AGENTS.md to namespaced location, adds pointers

### Idempotent and Safe

- **Re-install detection**: Same version installed? No-op. Different version? Suggests `update`.
- **Conflict pre-flight scan**: Warns about already-installed plugins that overlap with the rig — both declared conflicts and heuristic name-similarity matches.
- **Behavioral file protection**: Tracks SHA-256 hashes of installed files. If you edit a rig's CLAUDE.md, re-install won't silently overwrite your changes.
- **Tagged env var blocks**: Shell profile entries are wrapped in `# --- agent-rig: <name> ---` markers for clean identification and removal.

### Full Lifecycle Management

- **`install`** — First-time setup with confirmation, conflict warnings, and install plan
- **`update`** — Computes a diff between installed state and latest manifest, applies only what changed (new plugins, removed conflicts, added MCP servers, etc.)
- **`outdated`** — Read-only check across all installed rigs for newer versions
- **`upstream`** — Scans marketplace repos for new/removed plugins, checks tool availability
- **`uninstall`** — Reverses every action: uninstalls plugins, re-enables conflicts, removes MCP servers, cleans env vars from shell profile, removes behavioral files and pointers
- **`status`** — Shows all installed rigs with their components

### State Tracking

All install actions are recorded in `~/.agent-rig/state.json`. The state tracks only what each install *actually changed* (not what was planned), enabling precise uninstall and accurate update diffs. State includes:

- Installed plugins and disabled conflicts
- Configured MCP servers (name + transport type)
- Behavioral files with pointer locations
- Shell profile path for env var cleanup
- Marketplace registrations

## CLI Commands

| Command | Description |
|---------|-------------|
| `agent-rig install <source>` | Install a rig (idempotent, conflict-aware) |
| `agent-rig update <name>` | Update an installed rig to the latest version |
| `agent-rig outdated [name]` | Check if installed rigs have newer versions |
| `agent-rig upstream <source>` | Check a rig against upstream marketplace versions |
| `agent-rig uninstall <name>` | Uninstall a rig and reverse all its changes |
| `agent-rig status` | Show installed rigs and their components |
| `agent-rig inspect <source>` | Examine a rig's contents without installing |
| `agent-rig validate [dir]` | Validate an `agent-rig.json` manifest |
| `agent-rig init [dir]` | Scaffold a new `agent-rig.json` |

### Flags

| Flag | Commands | Description |
|------|----------|-------------|
| `--dry-run` | install, update | Show what would change without applying |
| `--force` | install | Re-install even if same version is already installed |
| `-y, --yes` | install, update, uninstall | Skip confirmation prompt |
| `--json` | inspect | Output raw manifest as JSON |

## The `agent-rig.json` Manifest

Every rig is defined by an `agent-rig.json` at the root of a GitHub repo:

```json
{
  "name": "my-rig",
  "version": "1.0.0",
  "description": "My opinionated agent setup",
  "author": "your-github-username",

  "plugins": {
    "core": { "source": "my-plugin@my-marketplace" },
    "required": [
      { "source": "context7@claude-plugins-official", "description": "Runtime docs" }
    ],
    "recommended": [
      { "source": "pyright-lsp@claude-plugins-official", "description": "Python LSP" }
    ],
    "infrastructure": [
      { "source": "serena@claude-plugins-official", "description": "Semantic coding" }
    ],
    "conflicts": [
      { "source": "code-review@claude-plugins-official", "reason": "Duplicated by rig" }
    ]
  },

  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "description": "Runtime documentation fetching"
    },
    "local-tool": {
      "type": "stdio",
      "command": "my-tool",
      "args": ["mcp"],
      "description": "Local semantic search"
    }
  },

  "tools": [
    {
      "name": "my-tool",
      "install": "npm install -g my-tool",
      "check": "command -v my-tool",
      "optional": true,
      "description": "What this tool does"
    }
  ],

  "environment": {
    "DISPLAY": ":99",
    "MY_API_URL": "http://localhost:8080"
  },

  "behavioral": {
    "claude-md": { "source": "config/CLAUDE.md" },
    "agents-md": { "source": "config/AGENTS.md" }
  },

  "platforms": {
    "claude-code": {
      "marketplaces": [
        { "name": "my-marketplace", "repo": "owner/marketplace-repo" }
      ]
    },
    "codex": {
      "installScript": "scripts/install-codex.sh"
    }
  }
}
```

### Plugin Categories

| Category | Purpose | Install Behavior |
|----------|---------|-----------------|
| `core` | The main plugin this rig is built around | Always installed |
| `required` | Plugins the rig depends on | Always installed |
| `recommended` | Enhance the experience but aren't required | Always installed |
| `infrastructure` | Language servers, domain-specific tools | Always installed |
| `conflicts` | Plugins that overlap and must be disabled | Always disabled |

### Plugin Dependencies

Plugins can declare dependencies to control install order:

```json
{
  "source": "my-plugin@marketplace",
  "depends": ["context7@claude-plugins-official"],
  "description": "Needs context7 installed first"
}
```

Dependencies are topologically sorted so they install before dependents.

### MCP Server Types

| Type | Transport | Config |
|------|-----------|--------|
| `http` | HTTP-based | `url`, optional `healthCheck` |
| `stdio` | Standard I/O (local process) | `command`, optional `args` |
| `sse` | Server-Sent Events | `url` |

### Environment Variables

Env vars are written to the user's shell profile as tagged blocks:

```bash
# --- agent-rig: my-rig ---
export DISPLAY=":99"
export MY_API_URL="http://localhost:8080"
# --- end agent-rig: my-rig ---
```

- Auto-detects shell (bash/zsh/fish) and adapts syntax
- Idempotent — existing blocks are replaced, not duplicated
- Cleanly removed on `agent-rig uninstall`

### Behavioral Config

Rigs can ship CLAUDE.md and AGENTS.md files that define conventions for the agent:

- Files are copied to `.claude/rigs/<name>/` (namespaced, won't conflict between rigs)
- A pointer line is prepended to the project's root CLAUDE.md/AGENTS.md
- On re-install, locally modified files are preserved (SHA-256 hash detection)
- Use `--force` to overwrite local modifications

## Platform Support

agent-rig detects which platforms are available and installs accordingly:

- **Claude Code** — Plugins, marketplaces, MCP servers, conflicts, behavioral config
- **Codex CLI** — Runs the rig's Codex install script if configured

The manifest format is platform-agnostic. Additional adapters can be added for other agent platforms by implementing the `PlatformAdapter` interface.

## Creating Your Own Rig

1. Create a GitHub repo for your rig
2. Run `agent-rig init` to scaffold `agent-rig.json`
3. Add your plugins, MCP servers, tools, and behavioral config
4. Run `agent-rig validate` to check the manifest
5. Push to GitHub — anyone can install with `agent-rig install owner/repo`
6. When you release updates, users run `agent-rig update <name>` to get incremental changes

## Future (v2)

- **Rig composition** — `extends: "owner/base-rig"` for layered rigs
- **Lockfiles** — `agent-rig.lock` for reproducible installs
- **Profiles** — `--profile=go` vs `--profile=python` variants

## License

MIT
