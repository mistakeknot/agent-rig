# Agent Rig Framework — Brainstorm

**Date:** 2026-02-08
**Status:** Ready for planning

## What We're Building

An open-source framework that lets people package, share, and install complete agent setups ("rigs") with a single command. A rig is a turnkey collection of plugins, subagents, skills, MCP servers, CLI tools, and configuration that transforms a vanilla AI coding agent into an opinionated, integrated environment.

**Analogy:** If Claude Code plugins are individual packages, agent-rig is apt/brew — the package manager that installs a complete, curated system.

## Why This Approach

### The Problem
Setting up a productive agent environment today requires 8+ manual steps: installing a core plugin, adding companion plugins from multiple marketplaces, disabling conflicting plugins, installing CLI tools (Oracle, Codex, Beads), starting services (Agent Mail), configuring environment variables, and applying patches. This is fragile, undocumented, and impossible to reproduce.

### The Solution
A declarative manifest (`agent-rig.json`) that describes the complete rig, plus tooling to install it:
- **CLI** (`npx agent-rig install <repo>`) for bootstrapping from zero
- **Claude Code command** (`/rig:install`) for interactive installation within sessions
- **Abstract core** with platform adapters (Claude Code + Codex CLI in v1)

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Target audience | Everyone — especially "apt install" users | Rigs should be trivially installable by anyone |
| Platform scope | Abstract core + Claude Code & Codex adapters in v1 | Architecture supports future platforms without rewrite |
| Install UX | Hybrid: CLI bootstrap + Claude command interactive | CLI for zero-to-working, command for in-session management |
| Distribution | GitHub repos with `agent-rig.json` at root | No central registry needed. Git URLs as identifiers. |
| Rig composition | Design for it, ship without in v1 | Manifest supports `extends` field but v1 ignores it |
| Manifest format | `agent-rig.json` | Descriptive, avoids ambiguity, JSON for tooling |

## What a Rig Contains (5 Layers)

```
Layer 1: Core Plugin
  - plugin.json (identity, version, MCP servers)
  - Skills, agents, commands, hooks

Layer 2: Companion Plugins
  - required: must be installed
  - recommended: significant enhancements
  - infrastructure: language servers, domain tools
  - conflicts: must be disabled

Layer 3: External Infrastructure
  - CLI tools (npm packages, binaries)
  - Services (systemd units, background processes)
  - System requirements (Xvfb, Chrome, etc.)

Layer 4: Configuration
  - Project settings (permissions)
  - Environment variables
  - Platform adaptations

Layer 5: Maintenance
  - Upstream tracking
  - Version management
  - Sync workflows
```

## Open Questions

1. **Versioning:** Should the rig version be independent of the core plugin version? (Probably yes — the rig version represents the combination, not any single component.)
2. **Lockfile:** Should `agent-rig install` produce a lockfile (`agent-rig.lock`) for reproducible installs? (Probably v2.)
3. **Profiles:** Should rigs support profiles/variants (e.g., `--profile=go` vs `--profile=python`)? (Design for it, decide later.)
4. **Updates:** How do `agent-rig update` and `agent-rig outdated` work? (Follow npm model.)
5. **Uninstall:** How clean should uninstall be? Remove everything the rig installed? (Yes, track installed components.)

## Reference Implementation

Clavain becomes the first rig published in this format. The `agent-rig.json` for Clavain would declare:
- 9 companion plugins across 2 marketplaces
- 8 conflicting plugins to disable
- 4 CLI tools (oracle, codex, beads, qmd)
- 1 service (agent-mail)
- Environment variables (DISPLAY, CHROME_PATH)
- The Codex CLI adapter script

## Success Criteria

1. `npx agent-rig install mistakeknot/Clavain` takes a fresh Claude Code installation to a fully working Clavain setup
2. A new rig author can create `agent-rig.json` and publish by pushing to GitHub
3. The manifest format is documented well enough that someone can write one without reading source code
4. Clavain's current `/clavain:setup` command can be replaced by `agent-rig install`
