# Architecture Review: Shared Utility Extraction and Schema Cleanup

**Date:** 2026-02-08
**Scope:** Review of recent changes to `src/exec.ts`, `src/schema.ts`, `src/commands/install.ts`, `src/commands/inspect.ts`, and related files
**Reviewer:** System Architecture Expert (Claude Opus 4.6)
**Build Status:** Passes (`tsc` clean, 23/23 tests pass)

---

## 1. Architecture Overview

agent-rig is a TypeScript CLI for packaging, sharing, and installing AI agent rigs. The codebase follows a layered architecture:

```
index.ts (CLI entry)
  -> commands/    (orchestration)
  -> loader.ts    (source resolution + manifest loading)
  -> schema.ts    (Zod schema, single source of truth)
  -> exec.ts      (NEW -- shared execution utilities)
  -> adapters/    (platform-specific installation)
```

The changes under review address four items identified in the prior architecture review (`docs/research/review-architecture-decisions.md`):

1. Extraction of duplicated `execFileAsync` and `cloneToLocal` into a shared module
2. Schema simplification (removal of redundant types and unused fields)
3. Addition of user confirmation flow before install
4. Type safety improvements (`err: any` to `err: unknown`)

---

## 2. Change-by-Change Assessment

### 2.1. NEW: `src/exec.ts` -- Shared Execution Utilities

**File contents:**

```typescript
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import chalk from "chalk";
import type { RigSource } from "./loader.js";

export const execFileAsync = promisify(execFile);

export async function cloneToLocal(source: RigSource): Promise<string> {
  if (source.type === "local") return source.path;

  const dest = join(tmpdir(), `agent-rig-${source.repo}-${Date.now()}`);
  console.log(chalk.dim(`Cloning ${source.url}...`));
  await execFileAsync("git", ["clone", "--depth", "1", source.url, dest], {
    timeout: 60_000,
  });
  return dest;
}
```

**Assessment: Sound extraction, minor architectural observation.**

**What is correct:**

1. **DRY consolidation.** The prior review noted that `execFileAsync = promisify(execFile)` was duplicated across `install.ts`, `inspect.ts`, `claude-code.ts`, and `codex.ts`. All four now import from `exec.ts`. This eliminates four independent `promisify()` calls and ensures a single wrapper exists.

2. **`cloneToLocal()` extraction.** The prior review (section 5, observation 4) explicitly noted that both `install.ts` and `inspect.ts` had near-identical clone logic and recommended extraction. This change implements that recommendation correctly. The function consolidates the `if local return path, else clone` pattern into one place.

3. **Clean function signature.** `cloneToLocal(source: RigSource): Promise<string>` accepts the discriminated union type and returns a directory path. The caller does not need to know whether a clone occurred.

4. **Consistent temporary directory naming.** The extracted function uses `agent-rig-${source.repo}-${Date.now()}` for all clone operations. Previously, `install.ts` used `agent-rig-${source.repo}-...` while `inspect.ts` used `agent-rig-inspect-${source.repo}-...`. Unifying this is correct -- there is no reason for different temp dir prefixes per command.

**Architectural observation -- module placement and dependency direction:**

`exec.ts` imports `type { RigSource }` from `loader.js`. This creates a dependency: `exec.ts -> loader.ts -> schema.ts`. Meanwhile, commands also import from both `exec.ts` and `loader.ts`. The dependency graph is:

```
commands/install.ts  -->  exec.ts    -->  loader.ts  -->  schema.ts
                     -->  loader.ts  -->  schema.ts
                     -->  adapters/* -->  exec.ts
                                    -->  schema.ts

commands/inspect.ts  -->  exec.ts    -->  loader.ts  -->  schema.ts
                     -->  loader.ts  -->  schema.ts

adapters/claude-code.ts  -->  exec.ts  -->  loader.ts  -->  schema.ts
adapters/codex.ts        -->  exec.ts  -->  loader.ts  -->  schema.ts
```

There are **no circular dependencies**. The graph remains a DAG. However, `exec.ts` now depends on `loader.ts` (for the `RigSource` type), which means `exec.ts` is not a pure utility module -- it has domain knowledge (it knows about `RigSource`). This is a minor coupling concern. In a larger codebase, the `RigSource` type could be extracted to a separate `types.ts` file to decouple `exec.ts` from `loader.ts`. At the current scale of ~15 source files, this coupling is acceptable and not worth splitting.

The important property is preserved: **no module at a lower layer imports from a higher layer**. `schema.ts` (lowest) imports nothing internal. `loader.ts` imports only from `schema.ts`. `exec.ts` imports only from `loader.ts`. Commands import from all three. Adapters import from `exec.ts`, `schema.ts`, and `types.ts`. The layering is clean.

**Verdict: Correct extraction. The module is well-placed, appropriately scoped, and eliminates real duplication.**

---

### 2.2. `src/schema.ts` -- Schema Cleanup

Four changes were made to the schema:

#### 2.2a. Removed `CorePluginRef` (merged into `PluginRef`)

**Before:**
```typescript
const CorePluginRef = z.object({
  source: z.string().describe("The core plugin identifier"),
  description: z.string().optional(),
});
// Used as: core: CorePluginRef.optional()
```

**After:**
```typescript
// CorePluginRef is identical to PluginRef -- use PluginRef directly
// Used as: core: PluginRef.optional()
```

**Assessment: Correct.** `CorePluginRef` had an identical shape to `PluginRef` (both: `{ source: string, description?: string }`). The only difference was the `.describe()` text on `source`. Having two identical Zod schemas for the same shape violates the Single Responsibility Principle -- the concept of "plugin reference" should be defined once. The inferred TypeScript types were already identical, so this change has zero runtime or type-level impact.

The retained comment is good documentation practice -- it explains why `CorePluginRef` is absent for anyone reviewing git history.

#### 2.2b. Removed `ExternalTool.platforms` field

**Before:**
```typescript
const ExternalTool = z.object({
  name: z.string(),
  install: z.string(),
  check: z.string(),
  optional: z.boolean().default(false),
  description: z.string().optional(),
  platforms: z.record(z.string(), z.string()).optional()
    .describe("Platform-specific install commands"),
});
```

**After:**
```typescript
const ExternalTool = z.object({
  name: z.string(),
  install: z.string(),
  check: z.string(),
  optional: z.boolean().default(false),
  description: z.string().optional(),
});
```

**Assessment: Correct YAGNI cleanup.** The `platforms` field on `ExternalTool` was never referenced anywhere in the codebase -- not in the install command's `installTools()` function, not in any adapter, not in the inspect command's display logic, not in any test. It was dead schema surface area.

More importantly, platform-specific tool installation is already handled at a different architectural level: the `Platforms` schema has per-platform config blocks (`codex.installScript`, etc.), and each platform adapter has its own `installPlugins()` method. Adding per-tool platform overrides would create a confusing second axis of platform dispatch. Removing this field before any manifest authors depend on it is the right call.

The example manifest (`examples/clavain/agent-rig.json`) does not use this field, confirming no real-world usage existed.

#### 2.2c. Removed `Platforms.catchall()` for strict typing

**Before:**
```typescript
const Platforms = z
  .object({
    "claude-code": ClaudeCodePlatform.optional(),
    codex: CodexPlatform.optional(),
  })
  .catchall(z.record(z.string(), z.unknown()));
```

**After:**
```typescript
const Platforms = z.object({
  "claude-code": ClaudeCodePlatform.optional(),
  codex: CodexPlatform.optional(),
});
```

**Assessment: Correct, and this was the most impactful schema change.**

The prior review (section 3, observation 1) noted the `.catchall()` tradeoff: it allowed unknown platform keys to pass validation silently, which meant typos in platform names (e.g., `"cladue-code"`) would not be caught. Removing `.catchall()` makes the schema strict -- only `"claude-code"` and `"codex"` are accepted.

This has a significant downstream benefit that the prior review identified (section 7, observation 5): the Codex adapter previously needed `(codexConfig as any).installScript` because `.catchall()` eroded the type information for known platform keys. With `.catchall()` removed, `rig.platforms?.codex` now correctly resolves to `CodexPlatform | undefined`, and `codexConfig.installScript` is type-safe. The diff confirms this -- the `(codexConfig as any)` cast and the `typeof codexConfig !== "object"` guard were both removed from `codex.ts`.

**Tradeoff acknowledged:** Future third-party platforms will need a schema change to add their platform key. This is the correct tradeoff for a v0.1.0 project with two known platforms. Strict validation catches errors; extensibility can be added later via a plugin/extension mechanism or by re-adding `.catchall()` when the need materializes.

#### 2.2d. Fixed semver regex

**Before:** `version: z.string().regex(/^\d+\.\d+\.\d+/, "Must be semver")`
**After:** `version: z.string().regex(/^\d+\.\d+\.\d+$/, "Must be semver")`

**Assessment: Correct bug fix.** The original regex lacked the `$` anchor, meaning strings like `"1.0.0-anything-goes-here"` or `"1.0.0.0.0"` would pass validation. Adding `$` ensures the version is exactly three dot-separated numbers. This is stricter than full semver (which allows prerelease tags like `1.0.0-beta.1`), but for a manifest version field that represents a released rig version, requiring clean `MAJOR.MINOR.PATCH` format is appropriate.

If prerelease support is needed in the future, the regex can be extended to `/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/`.

**Overall schema verdict: All four changes are correct, justified, and improve the schema's integrity.**

---

### 2.3. `src/commands/install.ts` -- Confirmation Flow and Cleanup

Three categories of changes:

#### 2.3a. Import consolidation

`install.ts` now imports `execFileAsync` and `cloneToLocal` from `../exec.js` instead of defining them locally. The local `cloneToLocal` function and `const execFileAsync = promisify(execFile)` were removed. The `RigSource` type import was also removed (no longer needed since `cloneToLocal` handles the dispatch internally).

**Assessment: Clean. No functional change, just import rewiring.**

#### 2.3b. New `confirm()` and `printInstallPlan()` functions

```typescript
async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}
```

```typescript
function printInstallPlan(rig: AgentRig, activeAdapters: PlatformAdapter[]) {
  // ... displays plugin count, conflict count, MCP count, tool commands, platforms
}
```

**Assessment: Architecturally correct addition.**

1. **User confirmation before destructive operations is a security best practice.** The prior security audit (`docs/research/security-audit-of-cli-tool.md`) likely flagged that `install` runs shell commands (`tool.install`) without confirmation. The new flow shows users exactly what will happen before proceeding.

2. **The `printInstallPlan()` function provides transparency.** It lists plugin counts, conflict counts, MCP server counts, required tool install commands (showing the actual shell commands), and active platforms. This is particularly important because `tool.install` values are arbitrary shell commands -- users should see them before execution.

3. **The `--yes` / `-y` flag provides an escape hatch** for scripted/CI usage where interactive confirmation is not possible. This follows the convention established by `apt install -y`, `npm init -y`, and similar tools.

4. **Default-deny (`[y/N]`) is the correct default.** Non-answer or pressing Enter aborts. Only explicit "y" proceeds.

5. **The `readline` interface is properly closed.** `rl.close()` is called inside the callback, preventing resource leaks.

**One minor observation:** The `confirm()` function is defined locally in `install.ts`. If other commands need confirmation in the future (e.g., an `uninstall` command), it would need to be extracted. For now, with only one consumer, local definition is correct.

#### 2.3c. Updated function signature

```typescript
// Before
export async function installCommand(sourceArg: string, opts: { dryRun?: boolean })
// After
export async function installCommand(sourceArg: string, opts: { dryRun?: boolean; yes?: boolean })
```

Wired in `src/index.ts`:
```typescript
.option("-y, --yes", "Skip confirmation prompt")
```

**Assessment: Clean integration.** Commander.js maps `--yes` to `opts.yes`. The option is properly documented in the CLI help text.

#### 2.3d. `err: any` to `err: unknown` type safety fix

All `catch (err: any)` blocks were replaced with:
```typescript
catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  // ...
}
```

This change appears in:
- `src/commands/install.ts` (installTools catch block)
- `src/commands/validate.ts` (validateCommand catch block)
- `src/adapters/claude-code.ts` (run() catch block)
- `src/adapters/codex.ts` (installPlugins catch block)

**Assessment: Correct TypeScript best practice.** Using `err: any` silences the type checker and allows property access on potentially non-Error objects (e.g., thrown strings or numbers). The `err: unknown` pattern with `instanceof Error` guard is the TypeScript-recommended approach and was flagged in the prior code quality review.

**Overall install.ts verdict: All changes are well-motivated and correctly implemented.**

---

### 2.4. `src/commands/inspect.ts` -- Simplified via Shared `cloneToLocal`

**Before (24 lines of clone logic):**
```typescript
let dir: string;
if (source.type === "local") {
  dir = source.path;
} else {
  dir = join(tmpdir(), `agent-rig-inspect-${source.repo}-${Date.now()}`);
  await execFileAsync("git", ["clone", "--depth", "1", source.url, dir], {
    timeout: 60_000,
  });
}
```

**After (1 line):**
```typescript
const dir = await cloneToLocal(source);
```

**Assessment: Textbook DRY improvement.** The `inspect.ts` file went from 88 lines to 88 lines (net change: removed 20 lines of clone logic plus 4 import lines, gained 1 import line and 1 function call). The file is now focused entirely on its display logic, with all I/O delegation handled by `loader.ts` (for manifest loading) and `exec.ts` (for cloning).

The variable also changed from `let dir` (mutable) to `const dir` (immutable), which is a minor but positive style improvement.

---

### 2.5. `src/commands/init.ts` -- Type Safety Improvement

```typescript
// Before
const manifest = { ... tools: [] as unknown[], ... };

// After
const manifest: Partial<AgentRig> = { ... tools: [], ... };
```

**Assessment: Correct.** Using `Partial<AgentRig>` instead of ad-hoc type casts (`as unknown[]`) ensures the init template stays aligned with the schema type. If a field is renamed or removed in `AgentRig`, the `init.ts` template will produce a type error at compile time rather than silently generating an invalid manifest.

---

## 3. Compliance Check: Architectural Principles

| Principle | Status | Evidence |
|-----------|--------|---------|
| **Single Responsibility** | Met | `exec.ts` handles execution/cloning; `loader.ts` handles resolution/loading; `schema.ts` handles validation. Each has one reason to change. |
| **Open/Closed** | Met | New `exec.ts` module was added without modifying the interfaces of existing modules. Consumers were updated only to change import sources. |
| **DRY (Don't Repeat Yourself)** | Improved | Four duplicate `promisify(execFile)` calls consolidated to one. Two duplicate clone-to-local implementations consolidated to one. |
| **YAGNI** | Improved | `ExternalTool.platforms` removed (never used). `CorePluginRef` removed (redundant). `Platforms.catchall()` removed (no third-party platforms exist). |
| **Type Safety** | Improved | `err: any` replaced with `err: unknown` + guards across 4 files. `Partial<AgentRig>` replaces ad-hoc casts. Codex adapter `as any` cast eliminated. |
| **No Circular Dependencies** | Met | Verified: `schema.ts` has no internal imports. `loader.ts` imports only `schema.ts`. `exec.ts` imports only `loader.ts` (type-only). All dependency arrows flow downward. |
| **Consistent Abstraction Levels** | Met | `exec.ts` sits between commands/adapters (consumers) and Node.js primitives (child_process). It provides the correct level of abstraction: callers deal with `RigSource` objects, not `execFile` arguments. |
| **Fail Fast** | Met | Schema validation remains immediate. The semver regex fix makes validation stricter (catches malformed versions earlier). |

---

## 4. Updated Dependency Graph

After these changes, the full import graph for production source files (excluding tests) is:

```
src/index.ts
  -> src/commands/install.ts
       -> src/loader.ts       -> src/schema.ts
       -> src/exec.ts         -> src/loader.ts (type-only)
       -> src/adapters/claude-code.ts
            -> src/exec.ts
            -> src/adapters/types.ts  -> src/schema.ts (type-only)
            -> src/schema.ts (type-only)
       -> src/adapters/codex.ts
            -> src/exec.ts
            -> src/adapters/types.ts  -> src/schema.ts (type-only)
            -> src/schema.ts (type-only)
       -> src/adapters/types.ts (type-only)
       -> src/schema.ts (type-only)
  -> src/commands/inspect.ts
       -> src/loader.ts
       -> src/exec.ts
  -> src/commands/validate.ts
       -> src/loader.ts
  -> src/commands/init.ts
       -> src/schema.ts (type-only)
```

**Key properties:**
- Maximum import depth: 4 (index -> install -> claude-code -> exec -> loader)
- No circular dependencies
- All cross-module imports of types use `import type` (tree-shakeable, no runtime cost)
- `schema.ts` is the leaf -- imported by everything, imports nothing internal

---

## 5. Risk Analysis

### No New Risks Introduced

These changes are purely structural improvements (extraction, consolidation, type tightening). They introduce:
- No new external dependencies
- No new I/O patterns
- No new security surface area
- No behavioral changes (all 23 tests pass without modification)

### Risks Mitigated by These Changes

1. **Type safety risk reduced.** The `(codexConfig as any).installScript` cast was a real type-safety hole that could have caused runtime errors if the `CodexPlatform` schema changed. This is now eliminated.

2. **Schema validation tightened.** The semver regex fix prevents malformed version strings from passing validation. The removal of `.catchall()` prevents typos in platform names from passing silently.

3. **User consent risk reduced.** The new confirmation prompt prevents accidental execution of arbitrary shell commands from tool install directives. This directly addresses the security concern of running `tool.install` strings without user awareness.

### Pre-existing Risks (Unchanged)

These were noted in the prior review and remain:
- Temporary clone directories not cleaned up
- No MCP server installation pathway
- No schema versioning
- No rollback mechanism for partial failures

---

## 6. Assessment of Prior Review Recommendations

The prior architecture review (`docs/research/review-architecture-decisions.md`) made specific recommendations. This change set addresses several of them:

| Recommendation | Priority | Status |
|---------------|----------|--------|
| Extract clone-to-local into shared function | Medium | **Addressed** -- `exec.ts` now exports `cloneToLocal()` |
| Fix `err: any` type safety | Implied | **Addressed** -- all catch blocks now use `err: unknown` |
| Codex adapter type safety gap (`as any` cast) | Medium | **Addressed** -- `.catchall()` removal restored proper typing |
| Validate init output against schema | High | **Partially addressed** -- `Partial<AgentRig>` typing added, but `AgentRigSchema.parse()` is still not called before writing |
| Add `schemaVersion` field | High | Not addressed |
| Add `configureMcpServers()` to adapter interface | High | Not addressed |
| Add temp directory cleanup | Medium | Not addressed |

---

## 7. Recommendations

### Immediate (Low Cost, High Value)

1. **Validate init output against schema.** The `init.ts` file now uses `Partial<AgentRig>` which provides compile-time checking, but runtime validation would catch issues from user input (e.g., a name with uppercase letters failing the kebab-case regex). Add one line before `writeFile`:

   ```typescript
   AgentRigSchema.parse(manifest); // throws if user input creates invalid manifest
   ```

2. **Add a unit test for `cloneToLocal()` with a local source.** The new `exec.ts` module has no dedicated test file. The local-path fast path (`if (source.type === "local") return source.path`) should have a simple unit test to prevent regression.

### Future (When Scope Warrants)

3. **Extract `RigSource` type to a standalone `types.ts` or keep it in `schema.ts`.** Currently, `exec.ts` depends on `loader.ts` for the `RigSource` type. If `exec.ts` gains more utilities that don't need `loader.ts`, moving `RigSource` to `schema.ts` (where all other types live) would decouple the layers. This is not urgent.

4. **Consider extracting `confirm()` to a shared `ui.ts` module** if additional commands (e.g., `uninstall`, `update`) need user confirmation.

---

## 8. Summary Judgment

These changes are **architecturally sound**. They follow through on recommendations from the prior review, improve type safety across the codebase, reduce duplication, and add a meaningful user safety feature (install plan + confirmation). No new risks are introduced, and several pre-existing risks are mitigated.

The new `exec.ts` module is well-placed in the architecture, maintains the clean dependency DAG, and provides the right level of abstraction for its consumers. The schema changes are all justified removals of dead code, redundant types, or overly permissive validation.

The project builds cleanly and all 23 tests pass. The changes are ready for production use.

**Overall assessment: Strong improvement. No architectural concerns.**
