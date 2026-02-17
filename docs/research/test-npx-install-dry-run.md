# agent-rig Install Dry-Run Test Results

**Date:** 2026-02-12
**Version:** agent-rig 0.1.0, Clavain v0.4.45

## Overview

Tested the `agent-rig install --dry-run` command using both local path and GitHub-style source resolution. Both paths successfully load the Clavain manifest and produce identical install plans.

---

## Command 1: Build

```bash
pnpm build
```

**Output:**
```
> @gensysven/agent-rig@0.1.0 build /root/projects/agent-rig
> tsc
```

**Result:** Clean build, no errors.

---

## Command 2: Dry-Run Install from Local Path

```bash
cd /root/projects/agent-rig && node dist/index.js install --dry-run /root/projects/Clavain
```

**Output:**
```
Agent Rig Installer

Installing clavain v0.4.45 — General-purpose engineering discipline rig — 16 agents, 36 commands, 30 skills, 2 MCP servers. Combines workflow discipline with specialized execution agents.

Dry run — no changes will be made.


Install Plan:
  Install 15 plugins
  Disable 8 conflicting plugins
  Configure 2 MCP servers
  Skip 4 optional tools (check commands):
    check: $ command -v oracle
    check: $ command -v codex
    check: $ command -v bd
    check: $ command -v qmd
  Behavioral CLAUDE.md → .claude/rigs/clavain/
  Platforms: claude-code, codex
```

**Full manifest dumped:** Yes — complete JSON with all plugins (core + 2 required + 8 recommended + 4 infrastructure), 8 conflicts, 2 MCP servers, 4 optional tools, environment vars, behavioral config, and platform configs.

**Result:** Success. No changes made (dry-run).

---

## Command 3: Dry-Run Install from GitHub Source

```bash
cd /root/projects/agent-rig && node dist/index.js install --dry-run mistakeknot/Clavain
```

**Output:**
```
Agent Rig Installer

Cloning https://github.com/mistakeknot/Clavain.git...
Installing clavain v0.4.45 — General-purpose engineering discipline rig — 16 agents, 36 commands, 30 skills, 2 MCP servers. Combines workflow discipline with specialized execution agents.

Dry run — no changes will be made.


Install Plan:
  Install 15 plugins
  Disable 8 conflicting plugins
  Configure 2 MCP servers
  Skip 4 optional tools (check commands):
    check: $ command -v oracle
    check: $ command -v codex
    check: $ command -v bd
    check: $ command -v qmd
  Behavioral CLAUDE.md → .claude/rigs/clavain/
  Platforms: claude-code, codex
```

**Full manifest dumped:** Yes — identical to local path output.

**Result:** Success. GitHub source resolution works correctly (clones the repo, finds `agent-rig.json`). No changes made (dry-run).

---

## Analysis

### What the Install Plan Would Do

| Action | Count | Details |
|--------|-------|---------|
| **Install plugins** | 15 | 1 core (`clavain@interagency-marketplace`), 2 required (`context7`, `explanatory-output-style`), 8 recommended (`interdoc`, `interclode`, `auracoil`, `tool-time`, `agent-sdk-dev`, `plugin-dev`, `serena`, `security-guidance`), 4 infrastructure LSPs (`gopls`, `pyright`, `typescript`, `rust-analyzer`) |
| **Disable conflicting plugins** | 8 | `code-review`, `pr-review-toolkit`, `code-simplifier`, `commit-commands`, `feature-dev`, `claude-md-management`, `frontend-design`, `hookify` — all from `claude-plugins-official` |
| **Configure MCP servers** | 2 | `context7` (HTTP, mcp.context7.com) and `qmd` (stdio, local semantic search) |
| **Skip optional tools** | 4 | `oracle`, `codex`, `beads` (`bd`), `qmd` — all optional, skipped because check commands determine availability at install time |
| **Behavioral config** | 1 | CLAUDE.md from `config/CLAUDE.md` to `.claude/rigs/clavain/` |
| **Environment vars** | 2 | `DISPLAY=:99`, `CHROME_PATH=/usr/local/bin/google-chrome-wrapper` |
| **Platform adapters** | 2 | `claude-code` (marketplace registration) and `codex` (install script + skills dir) |

### Key Findings

1. **Both source paths produce identical results.** Local path (`/root/projects/Clavain`) and GitHub-style source (`mistakeknot/Clavain`) resolve to the same manifest and generate the same install plan. The only difference is the GitHub path includes a "Cloning..." step.

2. **Dry-run output is informative.** The plan summary gives a quick overview (plugin counts, conflicts, MCP servers, skipped tools), and the full manifest JSON is dumped for inspection. This is useful for understanding exactly what will be installed before committing.

3. **Optional tools are correctly identified.** All 4 tools (`oracle`, `codex`, `beads`, `qmd`) are marked optional and show their check commands. The install plan notes they will be skipped during dry-run (actual install would run the checks).

4. **Conflict detection is comprehensive.** 8 official plugins are identified as conflicting with Clavain's capabilities, with human-readable reasons for each conflict.

5. **Version is current.** Both paths resolve Clavain v0.4.45, matching the latest version in the Clavain repository.

6. **No errors or warnings.** Both commands completed cleanly with exit code 0. No validation errors, no missing fields, no schema issues.

### Full Manifest (JSON)

The complete manifest dumped by both commands:

```json
{
  "name": "clavain",
  "version": "0.4.45",
  "description": "General-purpose engineering discipline rig — 16 agents, 36 commands, 30 skills, 2 MCP servers. Combines workflow discipline with specialized execution agents.",
  "author": "mistakeknot",
  "license": "MIT",
  "repository": "mistakeknot/Clavain",
  "keywords": [
    "engineering-discipline",
    "code-review",
    "workflow-automation",
    "tdd",
    "debugging",
    "planning",
    "agents",
    "general-purpose",
    "cross-ai-review",
    "oracle",
    "council"
  ],
  "plugins": {
    "core": {
      "source": "clavain@interagency-marketplace",
      "description": "The core Clavain engineering discipline plugin"
    },
    "required": [
      {
        "source": "context7@claude-plugins-official",
        "description": "Runtime doc fetching via MCP"
      },
      {
        "source": "explanatory-output-style@claude-plugins-official",
        "description": "Educational output formatting"
      }
    ],
    "recommended": [
      {
        "source": "interdoc@interagency-marketplace",
        "description": "AGENTS.md generation"
      },
      {
        "source": "interclode@interagency-marketplace",
        "description": "Codex CLI dispatch infrastructure"
      },
      {
        "source": "auracoil@interagency-marketplace",
        "description": "Cross-AI AGENTS.md review"
      },
      {
        "source": "tool-time@interagency-marketplace",
        "description": "Tool usage analytics"
      },
      {
        "source": "agent-sdk-dev@claude-plugins-official",
        "description": "Agent SDK development tools"
      },
      {
        "source": "plugin-dev@claude-plugins-official",
        "description": "Plugin development tools"
      },
      {
        "source": "serena@claude-plugins-official",
        "description": "Semantic coding tools"
      },
      {
        "source": "security-guidance@claude-plugins-official",
        "description": "Security best practices"
      }
    ],
    "infrastructure": [
      {
        "source": "gopls-lsp@claude-plugins-official",
        "description": "Go language server"
      },
      {
        "source": "pyright-lsp@claude-plugins-official",
        "description": "Python language server"
      },
      {
        "source": "typescript-lsp@claude-plugins-official",
        "description": "TypeScript language server"
      },
      {
        "source": "rust-analyzer-lsp@claude-plugins-official",
        "description": "Rust language server"
      }
    ],
    "conflicts": [
      {
        "source": "code-review@claude-plugins-official",
        "reason": "Duplicates Clavain review agents"
      },
      {
        "source": "pr-review-toolkit@claude-plugins-official",
        "reason": "Duplicates Clavain PR review"
      },
      {
        "source": "code-simplifier@claude-plugins-official",
        "reason": "Duplicates simplicity reviewer"
      },
      {
        "source": "commit-commands@claude-plugins-official",
        "reason": "Duplicates commit workflow"
      },
      {
        "source": "feature-dev@claude-plugins-official",
        "reason": "Duplicates feature dev workflow"
      },
      {
        "source": "claude-md-management@claude-plugins-official",
        "reason": "Conflicts with doc management"
      },
      {
        "source": "frontend-design@claude-plugins-official",
        "reason": "Conflicts with design agents"
      },
      {
        "source": "hookify@claude-plugins-official",
        "reason": "Conflicts with hook management"
      }
    ]
  },
  "mcpServers": {
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "description": "Runtime documentation fetching"
    },
    "qmd": {
      "type": "stdio",
      "command": "qmd",
      "args": [
        "mcp"
      ],
      "description": "Local semantic search engine"
    }
  },
  "tools": [
    {
      "name": "oracle",
      "install": "npm install -g @steipete/oracle",
      "check": "command -v oracle",
      "optional": true,
      "description": "Cross-AI review via GPT-5.2 Pro"
    },
    {
      "name": "codex",
      "install": "npm install -g @openai/codex",
      "check": "command -v codex",
      "optional": true,
      "description": "OpenAI's coding agent for parallel dispatch"
    },
    {
      "name": "beads",
      "install": "npm install -g @steveyegge/beads",
      "check": "command -v bd",
      "optional": true,
      "description": "Git-native issue tracking"
    },
    {
      "name": "qmd",
      "install": "go install github.com/tobi/qmd@latest",
      "check": "command -v qmd",
      "optional": true,
      "description": "Semantic search across documentation"
    }
  ],
  "environment": {
    "DISPLAY": ":99",
    "CHROME_PATH": "/usr/local/bin/google-chrome-wrapper"
  },
  "behavioral": {
    "claude-md": {
      "source": "config/CLAUDE.md"
    }
  },
  "platforms": {
    "claude-code": {
      "marketplaces": [
        {
          "name": "interagency-marketplace",
          "repo": "mistakeknot/interagency-marketplace"
        },
        {
          "name": "claude-plugins-official",
          "repo": "anthropics/claude-plugins-official"
        }
      ]
    },
    "codex": {
      "installScript": "scripts/install-codex.sh",
      "skillsDir": "~/.codex/skills/clavain"
    }
  }
}
```
