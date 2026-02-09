# agent-rig

TypeScript CLI for packaging, sharing, and installing AI agent rigs.

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
  adapters/
    types.ts        — PlatformAdapter interface
    claude-code.ts  — Claude Code plugin installation
    codex.ts        — Codex CLI installation
  commands/
    install.ts      — agent-rig install <source>
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
- Tests use Node.js built-in test runner (`node:test`)
