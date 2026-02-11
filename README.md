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

Installing `clavain@interagency-marketplace` gives you the plugin. Running `agent-rig install mistakeknot/Clavain` gives you the plugin *plus* companion plugins, disables conflicting ones, sets up MCP servers, checks CLI tools, configures env vars, and installs behavioral conventions.

Instead of doing all that manually, you run one command:

```bash
npx agent-rig install mistakeknot/Clavain
```

### Review Before Adopting

One of the most powerful aspects of agent rigs: you don't have to install blindly. You can ask your coding agent to review a rig first:

```bash
agent-rig inspect mistakeknot/Clavain
```

Or better yet, point your agent at it and ask: *"Review this rig and tell me what makes sense for my workflow."* Your agent can examine every plugin, skill, and tool in the rig and help you decide what to adopt, modify, or skip.

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

### Inspect a rig before installing

```bash
agent-rig inspect mistakeknot/Clavain
agent-rig inspect --json mistakeknot/Clavain
```

### Create your own rig

```bash
agent-rig init
# Edit the generated agent-rig.json
agent-rig validate
```

## The `agent-rig.json` Manifest

Every rig is defined by an `agent-rig.json` at the root of a GitHub repo. It describes five layers:

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
    "conflicts": [
      { "source": "code-review@claude-plugins-official", "reason": "Duplicated by rig" }
    ]
  },

  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "http://127.0.0.1:8080/mcp",
      "healthCheck": "http://127.0.0.1:8080/health"
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
    "MY_VAR": "value"
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

### MCP Server Types

- **`http`** — HTTP-based MCP server with optional health check URL
- **`stdio`** — Standard I/O transport (local process)
- **`sse`** — Server-Sent Events transport

### External Tools

Each tool specifies:
- `install` — Shell command to install it
- `check` — Shell command to verify it's installed (before attempting install)
- `optional` — If `true`, skip install and let users install manually

## CLI Commands

| Command | Description |
|---------|-------------|
| `agent-rig install <source>` | Install a rig (idempotent, conflict-aware) |
| `agent-rig update <name>` | Update an installed rig to the latest version |
| `agent-rig outdated [name]` | Check if installed rigs have newer versions |
| `agent-rig upstream <source>` | Check a rig against upstream marketplace versions |
| `agent-rig uninstall <name>` | Uninstall a rig and reverse its changes |
| `agent-rig status` | Show installed rigs and their components |
| `agent-rig inspect <source>` | Examine a rig's contents without installing |
| `agent-rig validate [dir]` | Validate an `agent-rig.json` manifest |
| `agent-rig init [dir]` | Scaffold a new `agent-rig.json` |

## Platform Support

agent-rig detects which platforms are available and installs accordingly:

- **Claude Code** — Installs plugins via `claude plugin install`, adds marketplaces, disables conflicts
- **Codex CLI** — Runs the rig's Codex install script if configured

The manifest format is platform-agnostic. Additional adapters can be added for other agent platforms.

## Creating Your Own Rig

1. Create a GitHub repo for your rig
2. Run `agent-rig init` to scaffold `agent-rig.json`
3. Add your plugins, MCP servers, and tools
4. Run `agent-rig validate` to check the manifest
5. Push to GitHub — anyone can now install it with `agent-rig install owner/repo`

### Install flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Show what would be installed without making changes |
| `--force` | Re-install even if same version is already installed |
| `-y, --yes` | Skip confirmation prompt |

## Future (v2)

- **Rig composition** — `extends: "owner/base-rig"` for layered rigs
- **Lockfiles** — `agent-rig.lock` for reproducible installs
- **Profiles** — `--profile=go` vs `--profile=python` variants

## License

MIT
