# agent-rig: Design Patterns and Anti-Patterns Review

**Date:** 2026-02-08
**Scope:** All source files under `/root/projects/agent-rig/src/` (14 TypeScript files, ~1100 LOC in production + test code)
**Excluded:** `docs/plans/`, `docs/solutions/`

---

## 1. Design Patterns Found

### 1.1 Strategy/Adapter Pattern (Well Implemented)

**Location:** `/root/projects/agent-rig/src/adapters/types.ts`, `/root/projects/agent-rig/src/adapters/claude-code.ts`, `/root/projects/agent-rig/src/adapters/codex.ts`

The `PlatformAdapter` interface defines a five-method contract:

```typescript
export interface PlatformAdapter {
  name: string;
  detect(): Promise<boolean>;
  installPlugins(rig: AgentRig): Promise<InstallResult[]>;
  disableConflicts(rig: AgentRig): Promise<InstallResult[]>;
  addMarketplaces(rig: AgentRig): Promise<InstallResult[]>;
  verify(rig: AgentRig): Promise<InstallResult[]>;
}
```

Both `ClaudeCodeAdapter` and `CodexAdapter` implement this interface. The install command iterates over detected adapters polymorphically:

```typescript
// src/commands/install.ts lines 127-138
for (const adapter of activeAdapters) {
  const mpResults = await adapter.addMarketplaces(rig);
  const pluginResults = await adapter.installPlugins(rig);
  const conflictResults = await adapter.disableConflicts(rig);
}
```

**Assessment: Good.** This is the project's primary architectural pattern and it is clean. The interface is well-sized (not too broad, not too narrow). Adding new platform adapters is straightforward -- the AGENTS.md even documents the four-step process.

**One concern:** The adapters are hard-coded into `install.ts` rather than discovered via a registry. For two adapters this is fine; at five or more, a registry pattern would be warranted.

### 1.2 Discriminated Union Pattern (Schema)

**Location:** `/root/projects/agent-rig/src/schema.ts` lines 42-46

```typescript
const McpServer = z.discriminatedUnion("type", [
  McpServerHttp,
  McpServerStdio,
  McpServerSse,
]);
```

**Assessment: Good.** Using Zod's `discriminatedUnion` on the `type` field is idiomatic and gives precise TypeScript narrowing. Each variant has only the fields relevant to its transport type.

### 1.3 Tagged Union Pattern (Source Resolution)

**Location:** `/root/projects/agent-rig/src/loader.ts` lines 6-18

```typescript
export type GitHubSource = { type: "github"; owner: string; repo: string; url: string; };
export type LocalSource = { type: "local"; path: string; };
export type RigSource = GitHubSource | LocalSource;
```

**Assessment: Good.** Clean discriminated union with a `type` tag. The `resolveSource()` function handles resolution priority clearly: absolute/relative paths, GitHub URLs, existing disk paths, owner/repo shorthand, fallback local.

### 1.4 Result Object Pattern

**Location:** `/root/projects/agent-rig/src/adapters/types.ts` lines 3-7

```typescript
export interface InstallResult {
  component: string;
  status: "installed" | "skipped" | "failed" | "disabled";
  message?: string;
}
```

**Assessment: Good.** Every adapter method returns `InstallResult[]`, giving the install command a uniform way to report outcomes. The four status values cover all meaningful states. The `component` field uses a prefixed naming convention (`plugin:`, `marketplace:`, `mcp:`, `tool:`, `conflict:`) that provides clear origin tracking.

### 1.5 Builder/Fluent API Pattern (CLI)

**Location:** `/root/projects/agent-rig/src/index.ts`

Uses Commander.js's fluent API to define commands. Each command is defined in its own file and wired via `program.command().action()`.

**Assessment: Good.** Standard Commander.js usage. Clean separation of command definitions.

---

## 2. Anti-Patterns and Code Smells

### 2.1 Type Escape via `as any` (Severity: Medium)

**Location:** `/root/projects/agent-rig/src/adapters/codex.ts` line 37

```typescript
const installScript = (codexConfig as any).installScript;
```

The `CodexAdapter.installPlugins()` method retrieves `codexConfig` from `rig.platforms?.["codex"]`, then immediately casts it to `any` to access `installScript`. This is unnecessary -- the `CodexPlatform` schema in `schema.ts` already defines `installScript` as an optional string field. The type information is available but the adapter bypasses it.

**Root cause:** The `Platforms` schema uses `.catchall(z.record(z.string(), z.unknown()))` which widens the inferred type of individual platform entries to include `Record<string, unknown>`. This makes the inferred type of `rig.platforms?.["codex"]` wider than `CodexPlatform`, losing the typed fields.

**Impact:** The `as any` defeats TypeScript's type checking on this code path. If `installScript` were renamed in the schema, this code would silently break at runtime.

### 2.2 Duplicated `execFileAsync` Boilerplate (Severity: Low-Medium)

**Locations:**
- `/root/projects/agent-rig/src/adapters/claude-code.ts` lines 1, 6
- `/root/projects/agent-rig/src/adapters/codex.ts` lines 1, 6
- `/root/projects/agent-rig/src/commands/install.ts` lines 2, 13
- `/root/projects/agent-rig/src/commands/inspect.ts` lines 4, 9

The exact same two-line import+promisify pattern appears in four files:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
```

This is classic "copy-paste infrastructure." A shared utility module (e.g., `src/exec.ts`) exporting `execFileAsync` would eliminate the repetition and provide a single place to add defaults (timeout, encoding, error handling).

### 2.3 Duplicated Clone-to-Local Logic (Severity: Medium)

**Locations:**
- `/root/projects/agent-rig/src/commands/install.ts` lines 32-41 (`cloneToLocal()`)
- `/root/projects/agent-rig/src/commands/inspect.ts` lines 17-30 (inline)

Both commands need to resolve a `RigSource` to a local directory, cloning from GitHub if needed. The install command has a proper `cloneToLocal()` function; the inspect command duplicates the logic inline. This means:
- Two places to update if clone behavior changes (e.g., adding `--single-branch`, auth tokens)
- Different temp directory naming patterns: `agent-rig-${repo}` vs `agent-rig-inspect-${repo}`
- Neither cleans up the temp directory after use

`cloneToLocal()` should be extracted to `loader.ts` alongside `resolveSource()`, since they form a natural pair: resolve then materialize.

### 2.4 Inconsistent Error Handling (Severity: Low-Medium)

The codebase uses three different error-handling patterns:

**Pattern A -- `err: any` with `.message` access:**
```typescript
// claude-code.ts:17, install.ts:71, codex.ts:47, validate.ts:46
} catch (err: any) {
  return { ok: false, output: err.message || String(err) };
}
```

**Pattern B -- bare `catch` with no error capture:**
```typescript
// loader.ts:64,71, codex.ts:15,67, install.ts:55
} catch {
  throw new Error(`agent-rig.json not found at ${manifestPath}`);
}
```

**Pattern C -- `ClaudeCodeAdapter.run()` wrapper:**
```typescript
// claude-code.ts:8-20 -- private utility wrapping exec into { ok, output }
async function run(cmd, args): Promise<{ ok: boolean; output: string }>
```

Pattern C is the best of these but is private to `claude-code.ts`. The `CodexAdapter` duplicates the same exec-and-catch logic without this abstraction. The lack of a shared error-handling strategy means some errors lose context (bare `catch`) while others rely on `err: any` which bypasses TypeScript's type safety.

### 2.5 `process.exit()` in Command Functions (Severity: Low)

**Locations:**
- `/root/projects/agent-rig/src/commands/validate.ts` line 49
- `/root/projects/agent-rig/src/commands/install.ts` line 124

Calling `process.exit(1)` inside command functions makes them untestable in isolation -- they will terminate the test runner. The standard pattern for Commander.js commands is to throw an error and let the top-level handler decide the exit code, or return a result code.

Currently the tests avoid hitting these paths, but this would block integration-level testing.

### 2.6 Direct `console.log` Throughout (Severity: Low)

All four commands use `console.log` directly for output. There is no logging abstraction. This means:
- Output cannot be captured or redirected programmatically
- No verbosity levels (quiet/normal/verbose)
- Testing requires capturing stdout rather than inspecting a return value

For a v0.1.0 CLI this is acceptable, but a `logger` or `output` abstraction would improve testability and support future features like `--quiet` or `--verbose` flags.

### 2.7 No Temp Directory Cleanup (Severity: Low)

**Locations:**
- `/root/projects/agent-rig/src/commands/install.ts` line 35
- `/root/projects/agent-rig/src/commands/inspect.ts` line 22

Both commands clone GitHub repos to temp directories but never clean them up. Over time, `$TMPDIR` will accumulate `agent-rig-*` directories. The inspect command in particular should always clean up since it is read-only.

### 2.8 Asymmetric Adapter Implementations (Severity: Medium)

The `ClaudeCodeAdapter` and `CodexAdapter` have significantly different implementation depths:

| Feature | ClaudeCodeAdapter | CodexAdapter |
|---|---|---|
| `detect()` | Uses `run()` helper | Raw `execFileAsync` |
| `addMarketplaces()` | Full implementation | Returns `[]` |
| `installPlugins()` | Iterates all plugin categories | Delegates to bash script |
| `disableConflicts()` | Full implementation | Returns `[]` |
| `verify()` | Health-checks MCP servers | Checks if `codex` exists |

This is documented as intentional ("stub -- delegates to install script" per AGENTS.md), but the asymmetry creates a maintenance concern: the `CodexAdapter` does not participate in the adapter contract meaningfully. Three of its five methods return empty arrays.

More concerning is `installPlugins()` line 37 using `(codexConfig as any).installScript` -- the adapter skips the typed schema and casts to `any`, which could mask bugs if the schema changes.

---

## 3. Naming Convention Analysis

### 3.1 File Naming: Consistent (kebab-case)

All source files use kebab-case: `claude-code.ts`, `loader.test.ts`, `agent-rig.json`. This is consistent and idiomatic for TypeScript/Node.js projects.

### 3.2 Type/Interface Naming: Consistent (PascalCase)

| Name | Location | Convention |
|---|---|---|
| `AgentRigSchema` | schema.ts | PascalCase (const, but schema-as-type) |
| `AgentRig` | schema.ts | PascalCase |
| `PlatformAdapter` | adapters/types.ts | PascalCase |
| `InstallResult` | adapters/types.ts | PascalCase |
| `ClaudeCodeAdapter` | adapters/claude-code.ts | PascalCase |
| `CodexAdapter` | adapters/codex.ts | PascalCase |
| `GitHubSource` | loader.ts | PascalCase |
| `LocalSource` | loader.ts | PascalCase |
| `RigSource` | loader.ts | PascalCase |

All type/interface/class names follow PascalCase. No deviations.

### 3.3 Schema Internal Names: Consistent (PascalCase)

All Zod schema variables use PascalCase: `PluginRef`, `ConflictRef`, `CorePluginRef`, `McpServerHttp`, `McpServerStdio`, `McpServerSse`, `ExternalTool`, `MarketplaceRef`, `ClaudeCodePlatform`, `CodexPlatform`, `Platforms`.

This is a deliberate and good choice -- treating schema definitions as type-level constructs.

### 3.4 Function Naming: Consistent (camelCase)

| Name | Location | Convention |
|---|---|---|
| `resolveSource` | loader.ts | camelCase |
| `loadManifest` | loader.ts | camelCase |
| `installCommand` | commands/install.ts | camelCase |
| `validateCommand` | commands/validate.ts | camelCase |
| `inspectCommand` | commands/inspect.ts | camelCase |
| `initCommand` | commands/init.ts | camelCase |
| `printResults` | commands/install.ts | camelCase |
| `cloneToLocal` | commands/install.ts | camelCase |
| `installTools` | commands/install.ts | camelCase |
| `run` | adapters/claude-code.ts | camelCase |
| `ask` | commands/init.ts | camelCase |

All function names follow camelCase. No deviations.

### 3.5 Command Export Naming: Consistent Pattern

All command files export a single async function named `{verb}Command`:
- `installCommand`
- `validateCommand`
- `inspectCommand`
- `initCommand`

This is a clean, predictable convention.

### 3.6 Variable Naming: One Minor Inconsistency

Most variables use camelCase consistently. One exception worth noting:

- Schema field names mix camelCase (`mcpServers`, `healthCheck`, `installScript`) with kebab-case dictionary keys (`"claude-code"` in `Platforms`). The kebab-case keys are justified since they represent platform identifiers that appear in JSON config files, not TypeScript identifiers.

### 3.7 Test Naming: Consistent

All test files use the `*.test.ts` co-location pattern. Test descriptions use natural language strings with `describe`/`it` from `node:test`. Consistent across all four test files.

### 3.8 Import Naming: One Split Import

In `/root/projects/agent-rig/src/commands/inspect.ts` lines 6-7:

```typescript
import { loadManifest } from "../loader.js";
import { resolveSource } from "../loader.js";
```

Two separate imports from the same module. This should be consolidated into one import statement. The same pattern appears in `install.ts` lines 6-7, though there it is slightly more justified because line 7 also imports a type:

```typescript
import { loadManifest } from "../loader.js";
import { resolveSource, type RigSource } from "../loader.js";
```

Still, both should be single import statements.

---

## 4. Code Duplication Metrics

### 4.1 `execFile` + `promisify` Boilerplate

**Duplicated across 4 files** (each ~3 lines):
- `src/adapters/claude-code.ts`
- `src/adapters/codex.ts`
- `src/commands/install.ts`
- `src/commands/inspect.ts`

**Recommendation:** Extract to `src/exec.ts` or `src/utils.ts`:
```typescript
export { execFile } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
export const execFileAsync = promisify(execFile);
```

### 4.2 Clone-to-Local Logic

**Duplicated across 2 files** (~10 lines each):
- `src/commands/install.ts` lines 32-41 (as named function)
- `src/commands/inspect.ts` lines 17-30 (inline)

**Recommendation:** Move `cloneToLocal()` to `src/loader.ts` as a public export. It logically belongs next to `resolveSource()`.

### 4.3 Description Formatting Pattern

**Repeated 4 times** in `src/commands/inspect.ts`:
```typescript
${p.description ? chalk.dim(` — ${p.description}`) : ""}
```

Lines 54, 59, 64, 95 all use this exact pattern. A small helper like `dimDesc(desc?: string)` would reduce this.

### 4.4 Plugin Iteration in Inspect

In `src/commands/inspect.ts` lines 52-66, three nearly identical blocks iterate over `required`, `recommended`, and `infrastructure` plugins with only the label and color differing:

```typescript
for (const p of rig.plugins.required ?? []) {
  console.log(`  ${chalk.green("req")}   ${p.source}${p.description ? ...}`);
}
for (const p of rig.plugins.recommended ?? []) {
  console.log(`  ${chalk.yellow("rec")}   ${p.source}${p.description ? ...}`);
}
for (const p of rig.plugins.infrastructure ?? []) {
  console.log(`  ${chalk.blue("infra")} ${p.source}${p.description ? ...}`);
}
```

This could be reduced to a data-driven loop:
```typescript
const categories = [
  { key: "required", label: "req", color: chalk.green },
  { key: "recommended", label: "rec", color: chalk.yellow },
  { key: "infrastructure", label: "infra", color: chalk.blue },
];
```

### 4.5 Duplication Summary

| Pattern | Files | Lines | Severity |
|---|---|---|---|
| `execFileAsync` boilerplate | 4 | ~12 total | Low-Medium |
| Clone-to-local logic | 2 | ~20 total | Medium |
| Description formatting | 1 (inspect.ts) | ~4 lines | Low |
| Plugin category iteration | 1 (inspect.ts) | ~15 lines | Low |

Overall duplication is low for a project this size. The `execFileAsync` and clone-to-local duplications are the most worth addressing.

---

## 5. Architectural Boundary Analysis

### 5.1 Layer Separation: Clean

The project has clear architectural layers:

```
CLI Entry (index.ts)
  -> Commands (commands/*.ts)
    -> Loader (loader.ts)
    -> Adapters (adapters/*.ts)
      -> Schema (schema.ts)
```

There are no circular dependencies. Each layer only imports from layers below it. The dependency graph is a clean DAG:

- `index.ts` imports from `commands/`
- `commands/` import from `loader.ts`, `adapters/`, `schema.ts`
- `adapters/` import from `schema.ts` and `types.ts`
- `loader.ts` imports from `schema.ts`
- `schema.ts` imports only from `zod`

### 5.2 Concern Leakage: installTools() in install.ts

The `installTools()` function in `/root/projects/agent-rig/src/commands/install.ts` lines 43-80 handles external tool installation. This responsibility is conceptually at the adapter level (it runs shell commands, manages install/check logic) but is implemented at the command level.

This means:
- Tool installation is not available to any other command
- The function cannot be shared if a future command needs tool management
- It creates an asymmetry: plugin installation goes through adapters, but tool installation bypasses them

The function would be better placed in a `ToolInstaller` class or as a method on a base adapter, since tools are platform-agnostic.

### 5.3 Schema-Adapter Type Gap

The `Platforms` schema in `schema.ts` uses `.catchall()` which widens the inferred types:

```typescript
const Platforms = z
  .object({
    "claude-code": ClaudeCodePlatform.optional(),
    codex: CodexPlatform.optional(),
  })
  .catchall(z.record(z.string(), z.unknown()));
```

This causes the adapters to lose type information when accessing their platform config. The `ClaudeCodeAdapter` works around it gracefully with optional chaining, but the `CodexAdapter` resorts to `as any`. The `.catchall()` is there for forward compatibility (unknown future platforms), but it undermines the type safety of known platforms.

### 5.4 No Adapter Registry/Discovery

Adapters are hard-coded in `install.ts`:

```typescript
const adapters: PlatformAdapter[] = [
  new ClaudeCodeAdapter(),
  new CodexAdapter(),
];
```

This is a minor boundary concern -- the install command knows about all concrete adapter implementations. A registry pattern (`adapters/index.ts` exporting a factory or list) would keep this knowledge in the adapter layer.

---

## 6. Summary of Recommendations

### High Priority (address before v0.2.0)

1. **Fix the `as any` cast in CodexAdapter** -- Either narrow the type properly or add a type guard. The `Platforms.catchall()` design creates this problem; consider using a type assertion function instead.

2. **Extract `cloneToLocal()` to `loader.ts`** -- Eliminate the duplicated clone logic between install and inspect commands. This is both a duplication fix and an architectural improvement.

### Medium Priority (address as codebase grows)

3. **Create `src/exec.ts` shared utility** -- Centralize `execFileAsync` and the `run()` helper from `claude-code.ts`. The `CodexAdapter` should use the same `run()` helper rather than raw `execFileAsync`.

4. **Move `installTools()` to an adapter or utility module** -- It does not belong at the command level. Either make it a static method on a base adapter class or create `src/tools.ts`.

5. **Add temp directory cleanup** -- Both clone operations should clean up with `finally` blocks or use `mkdtemp` + cleanup.

### Low Priority (nice-to-have)

6. **Consolidate split imports** -- `inspect.ts` lines 6-7 import from `loader.js` in two statements.

7. **Add a logger abstraction** -- Replace direct `console.log` calls with a thin wrapper that supports `--quiet`/`--verbose`.

8. **Consider an adapter registry** -- As more adapters are added, avoid hard-coding them in `install.ts`.

---

## 7. Overall Assessment

This is a well-structured v0.1.0 codebase. The adapter pattern is the right choice for multi-platform support. The Zod schema is well-designed with discriminated unions. Naming conventions are consistent throughout with no deviations from TypeScript community standards.

The main areas for improvement are:
- **Infrastructure duplication** (execFileAsync boilerplate, clone logic) that should be extracted before the codebase grows
- **Type safety gap** between the schema layer and the adapter layer caused by the `Platforms.catchall()` design
- **Asymmetric adapter depth** where `CodexAdapter` is largely a no-op stub -- this should either be fleshed out or marked experimental

The codebase is clean of TODO/FIXME/HACK comments, which indicates the authors addressed technical debt as they went rather than deferring it. Test coverage exists for all four modules (schema, loader, adapter, e2e) though the adapter tests are thin (only claude-code has unit tests, only testing empty-input cases).
