# agent-rig

The rig manager for AI coding agents.

A plugin adds capabilities. A rig creates the environment where those capabilities work together — companion plugins, conflict resolution, MCP servers, CLI tools, env vars, behavioral config, and platform adapters. Installing a plugin gives you skills and commands. Installing a rig gives you the whole working environment.

## Quick Reference

- **Build:** `pnpm build`
- **Test:** `pnpm build && node --test dist/**/*.test.js`
- **Run:** `node dist/index.js <command>`
- **Entry point:** `src/index.ts`

## Architecture

```
src/
  index.ts          — CLI entry point (commander.js)
  schema.ts         — agent-rig.json manifest schema (zod)
  loader.ts         — Load + validate manifests from local/GitHub
  state.ts          — Installed rig state (~/.agent-rig/state.json)
  adapters/
    types.ts        — PlatformAdapter interface
    claude-code.ts  — Claude Code: plugins, MCP servers, behavioral config
    codex.ts        — Codex CLI installation
  commands/
    install.ts      — agent-rig install <source>
    uninstall.ts    — agent-rig uninstall <name>
    status.ts       — agent-rig status
    validate.ts     — agent-rig validate [dir]
    inspect.ts      — agent-rig inspect <source>
    init.ts         — agent-rig init [dir]
examples/
  clavain/          — Reference agent-rig.json for Clavain
```

## Key Patterns

- Platform adapter pattern: `PlatformAdapter` interface in `adapters/types.ts`
- Schema validation: zod schemas in `schema.ts`, validated at load time
- Source resolution: `resolveSource()` handles GitHub URLs, owner/repo, and local paths
- State tracking: `~/.agent-rig/state.json` records what each rig installed for clean uninstall
- Tests use Node.js built-in test runner (`node:test`)
