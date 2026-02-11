# Simplicity and YAGNI Review: agent-rig v0.1.0

Reviewed: 2026-02-08
Reviewer: Simplicity analysis (Opus 4.6)
Scope: All source code in `/root/projects/agent-rig/src/` (1,157 LOC across 14 files)

---

## Simplification Analysis

### Core Purpose

agent-rig is a CLI that reads a declarative JSON manifest (`agent-rig.json`) describing an AI coding agent's complete setup (plugins, MCP servers, tools, environment variables), and installs everything onto the user's machine. It targets two platforms: Claude Code and Codex CLI.

The minimum viable product needs to:
1. Define and validate a manifest schema
2. Load manifests from local paths or GitHub repos
3. Install components onto detected platforms
4. Provide basic CLI commands: install, validate, inspect, init

### Overall Assessment

**The codebase is remarkably well-structured for a v0.1.0.** At 1,157 total lines (including tests), it is lean. The code is straightforward, uses minimal dependencies (zod, chalk, commander), and the file organization is clean. This review found only moderate opportunities for simplification -- the project largely avoids the common pitfalls of over-engineering.

**Complexity score: Low-to-Medium**
**Total potential LOC reduction: ~80-120 lines (7-10%)**
**Recommended action: Minor tweaks only -- this is close to minimal**

---

## Detailed Findings

### 1. Adapter Pattern: Justified or Premature?

**Files:** `/root/projects/agent-rig/src/adapters/types.ts`, `claude-code.ts`, `codex.ts`

**Verdict: Borderline justified -- keep it, but simplify the interface.**

The adapter pattern with a formal `PlatformAdapter` interface (16 LOC in `types.ts`) exists to support two adapters. Normally, an interface for two concrete implementations is premature abstraction. However, in this case:

- The install command genuinely iterates over adapters in a loop (`for (const adapter of activeAdapters)` in `install.ts:127`), so the polymorphism is exercised
- The two adapters have meaningfully different behavior (Claude Code shells out to `claude plugin install`; Codex delegates to an install script)
- The adapter pattern is a natural fit for the "detect platform, then install" flow
- Adding a third adapter (e.g., Cursor, Windsurf, Zed) requires zero changes to install.ts

**However, the interface has a YAGNI issue.** The `PlatformAdapter` interface mandates four methods:

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

The `CodexAdapter` implements three of these as stubs returning empty arrays:

```typescript
async addMarketplaces(_rig: AgentRig): Promise<InstallResult[]> { return []; }
async disableConflicts(_rig: AgentRig): Promise<InstallResult[]> { return []; }
```

**Recommendation:** This is fine for now. The interface is small (16 LOC), and the empty-array stubs are a reasonable cost for the clean loop in `install.ts`. If a third adapter comes, you'll be glad this is here. If not, the overhead is minimal. No action needed.

---

### 2. Schema Complexity

**File:** `/root/projects/agent-rig/src/schema.ts` (136 LOC)

#### 2a. McpServerSse -- Unused MCP transport type

**Lines 36-40:**
```typescript
const McpServerSse = z.object({
  type: z.literal("sse"),
  url: z.string().url(),
  description: z.string().optional(),
});
```

The SSE transport type is defined in the schema, included in the discriminated union, documented in the README, but **never used in any example manifest, any adapter, or any test**. Neither the Clavain example nor any code path handles SSE differently from HTTP.

SSE is a real MCP transport, so its inclusion is defensible as forward-looking schema design. But for v0.1.0, if no code path or example exercises it, it's dead weight.

**Impact:** 5 LOC. Minor.
**Recommendation:** Marginal -- keep or remove, doesn't matter much. If you keep it, add one test case that validates an SSE server.

#### 2b. Plugin categories: core vs. required vs. recommended vs. infrastructure

**Lines 113-120:**
```typescript
plugins: z.object({
  core: CorePluginRef.optional(),
  required: z.array(PluginRef).optional(),
  recommended: z.array(PluginRef).optional(),
  infrastructure: z.array(PluginRef).optional(),
  conflicts: z.array(ConflictRef).optional(),
})
```

Four plugin tiers (core, required, recommended, infrastructure) are defined, but the `installPlugins()` method in `claude-code.ts:50-57` merges them all into a single flat list and installs them identically:

```typescript
const plugins = [
  ...(rig.plugins?.core ? [rig.plugins.core] : []),
  ...(rig.plugins?.required ?? []),
  ...(rig.plugins?.recommended ?? []),
  ...(rig.plugins?.infrastructure ?? []),
];
```

All four categories receive exactly the same treatment: `claude plugin install`. There's no difference in install behavior, no "--optional" flag, no user prompt for recommended ones, no skip logic. They're semantic labels that exist only in the manifest and the `inspect` command's display.

**However:** The categories serve a real UX purpose in `inspect.ts` (lines 49-66), where they're displayed with different colors (cyan for core, green for required, yellow for recommended, blue for infrastructure). This helps a human reviewer understand the rig's structure before installing. The README also documents them as distinct concepts with a table.

**Recommendation:** Keep. The categories are a manifest design decision, not code complexity. The schema cost is ~10 LOC and the display cost is ~18 LOC. They add semantic value for rig authors and reviewers, even though the installer treats them uniformly. The README table at lines 116-123 makes the intent clear.

#### 2c. `CorePluginRef` vs `PluginRef` -- Redundant types

**Lines 4-18:**
```typescript
const PluginRef = z.object({
  source: z.string().describe("Plugin identifier: name@marketplace"),
  description: z.string().optional(),
});

const ConflictRef = z.object({
  source: z.string().describe("Plugin identifier to disable"),
  reason: z.string().optional(),
});

const CorePluginRef = z.object({
  source: z.string().describe("The core plugin identifier"),
  description: z.string().optional(),
});
```

`CorePluginRef` and `PluginRef` are structurally identical -- same shape `{ source: string, description?: string }`. The only difference is the `.describe()` text on `source`, which affects documentation but not behavior.

**Recommendation:** Replace `CorePluginRef` with `PluginRef`. Save 5 LOC, reduce conceptual overhead. The fact that it's "core" is conveyed by its position in the schema (`plugins.core`), not by a separate type.

#### 2d. `extends` field -- Accepted but not acted on

**Line 107-110:**
```typescript
extends: z.string().optional()
  .describe("Parent rig to extend (GitHub owner/repo)"),
```

This field is defined in the schema, tested (`schema.test.ts:114-124`), and shown in `validate.ts:41-45` with a warning "(not resolved in v1)". It exists purely as a placeholder for future composition support.

**Recommendation:** This is a textbook YAGNI violation. However, it's only 3 LOC in the schema, 5 LOC in the test, and 4 LOC in validate. Total cost: 12 LOC. The manifest format is a public API, and including `extends` now signals intent without breaking anything. It's acceptable to keep -- but acknowledging it as a conscious tradeoff is important.

#### 2e. Platforms catchall

**Line 90:**
```typescript
.catchall(z.record(z.string(), z.unknown()));
```

The `Platforms` object uses `.catchall()` to allow arbitrary platform keys beyond `claude-code` and `codex`. This is forward-looking: it means a third-party adapter can add `"cursor": { ... }` without the schema rejecting it.

**Recommendation:** Keep. This is 1 LOC and is the right design for an extensible manifest format.

#### 2f. ExternalTool `platforms` field

**Lines 56-59:**
```typescript
platforms: z.record(z.string(), z.string()).optional()
  .describe("Platform-specific install commands"),
```

This field is defined in the schema but never used in any code path, test, or example. The `installTools()` function in `install.ts` always uses `tool.install` unconditionally, ignoring any platform-specific overrides.

**Recommendation:** Remove. This is dead schema weight. When you need platform-specific install commands, add it then. Save 4 LOC.

---

### 3. Command Complexity

#### 3a. `inspect` and `install` duplicate the clone-to-local logic

**File:** `/root/projects/agent-rig/src/commands/inspect.ts` (lines 17-29)
**File:** `/root/projects/agent-rig/src/commands/install.ts` (lines 32-41)

Both commands contain nearly identical "if GitHub, clone; if local, use path" logic:

```typescript
// install.ts:32-41
async function cloneToLocal(source: RigSource): Promise<string> {
  if (source.type === "local") return source.path;
  const dest = join(tmpdir(), `agent-rig-${source.repo}-${Date.now()}`);
  await execFileAsync("git", ["clone", "--depth", "1", source.url, dest], { timeout: 60_000 });
  return dest;
}

// inspect.ts:17-29
let dir: string;
if (source.type === "local") {
  dir = source.path;
} else {
  dir = join(tmpdir(), `agent-rig-inspect-${source.repo}-${Date.now()}`);
  await execFileAsync("git", ["clone", "--depth", "1", source.url, dir], { timeout: 60_000 });
}
```

**Recommendation:** Move `cloneToLocal()` into `loader.ts` as a shared utility. It's already conceptually part of "source resolution." Save ~8 LOC of duplication and eliminate a second `promisify(execFile)` import.

#### 3b. `validate` command does more than validate

**File:** `/root/projects/agent-rig/src/commands/validate.ts` (51 LOC)

The validate command prints a summary (name, version, description, author, plugin counts, MCP servers, tools, extends status) after validating. This overlaps with what `inspect` does. However, the validate output is intentionally compact (a quick sanity check), while inspect is detailed (pre-install review).

**Recommendation:** Keep as-is. The overlap is minimal and the commands serve different audiences (rig author vs. rig consumer).

#### 3c. `init` command -- Interactive prompts

**File:** `/root/projects/agent-rig/src/commands/init.ts` (56 LOC)

The init command uses `readline` for interactive prompts. This is fine for v0.1.0. It asks for 4 fields (name, version, description, author), which is minimal.

One nitpick: the generated manifest includes empty arrays and objects:

```typescript
const manifest = {
  ...
  plugins: {
    required: [] as unknown[],
    recommended: [] as unknown[],
    conflicts: [] as unknown[],
  },
  mcpServers: {},
  tools: [] as unknown[],
  platforms: { "claude-code": { marketplaces: [] as unknown[] } },
};
```

These empty stubs serve as documentation-by-example -- they show the user what fields exist. This is a UX choice, not complexity.

**Recommendation:** No changes needed.

---

### 4. `InstallResult` Status Values

**File:** `/root/projects/agent-rig/src/adapters/types.ts` (line 5)

```typescript
status: "installed" | "skipped" | "failed" | "disabled";
```

Four status values. All four are actively used:
- `installed`: successful installation
- `skipped`: already installed, optional tool, or no config
- `failed`: installation error
- `disabled`: conflicts that were turned off

**Recommendation:** No changes. All four are used.

---

### 5. CLI Options and Commands

**File:** `/root/projects/agent-rig/src/index.ts` (39 LOC)

Four commands: `install`, `validate`, `inspect`, `init`. Two options: `--dry-run` (on install), `--json` (on inspect).

**Recommendation:** This is minimal. All four commands serve distinct purposes. No unnecessary options.

---

### 6. Loader Source Resolution Complexity

**File:** `/root/projects/agent-rig/src/loader.ts` (lines 20-57)

The `resolveSource()` function handles four input formats:
1. Absolute/relative paths (`/foo`, `./foo`, `../foo`)
2. Full GitHub URLs (`https://github.com/owner/repo`)
3. Existing disk paths (checked via `existsSync`)
4. GitHub `owner/repo` shorthand

The priority ordering and `existsSync` fallback are needed because `examples/clavain` looks like `owner/repo` but is actually a local path. The test at `loader.test.ts:42-46` explicitly verifies this.

**Recommendation:** Keep. The logic is well-tested and the priority order is correct.

---

### 7. Test Coverage

**Files:** 4 test files, 308 LOC total (27% of codebase)

- `schema.test.ts` (125 LOC) -- 4 tests: minimal, full, invalid, extends
- `loader.test.ts` (85 LOC) -- 5 tests: GitHub, local, URL, relative, existing dir; plus load/missing/invalid
- `claude-code.test.ts` (38 LOC) -- 4 tests: name, detect, empty plugins, empty conflicts
- `e2e.test.ts` (60 LOC) -- 7 tests: loads Clavain manifest and verifies counts

The e2e tests load the manifest 7 times (once per test) when they could load it once. But this is a test style choice, not a complexity issue.

**Recommendation:** Tests are proportionate. No over-testing or under-testing.

---

### 8. Dependency Choices

**File:** `/root/projects/agent-rig/package.json`

Three runtime dependencies: `chalk`, `commander`, `zod`. All are standard, well-maintained, and appropriate for their roles.

**Recommendation:** No changes. These are the right tools for the job.

---

## Unnecessary Complexity Found

| # | Location | Issue | LOC Impact |
|---|----------|-------|------------|
| 1 | `schema.ts:15-18` | `CorePluginRef` identical to `PluginRef` | -5 LOC |
| 2 | `schema.ts:56-59` | `ExternalTool.platforms` field unused everywhere | -4 LOC |
| 3 | `schema.ts:36-40` | `McpServerSse` defined but never exercised | -5 LOC (marginal) |
| 4 | `inspect.ts:17-29` + `install.ts:32-41` | Clone-to-local logic duplicated | -8 LOC |
| 5 | `schema.ts:107-110` | `extends` field is a v2 placeholder | -3 LOC (keep) |

---

## Code to Remove or Refactor

### Definite removals

1. **`/root/projects/agent-rig/src/schema.ts:15-18`** -- Replace `CorePluginRef` with `PluginRef`
   - Change line 115 from `core: CorePluginRef.optional()` to `core: PluginRef.optional()`
   - Delete the `CorePluginRef` definition
   - Estimated savings: 5 LOC

2. **`/root/projects/agent-rig/src/schema.ts:56-59`** -- Remove `platforms` field from `ExternalTool`
   - No code reads this field; no example uses it
   - Estimated savings: 4 LOC

### Recommended refactors

3. **Extract `cloneToLocal()` into `/root/projects/agent-rig/src/loader.ts`**
   - Move the shared clone logic from `install.ts` and `inspect.ts` into `loader.ts`
   - Both commands import `resolveSource` from `loader.ts` already
   - Eliminates duplicate `execFile`/`promisify` imports in `inspect.ts`
   - Estimated savings: 8 LOC, improved cohesion

### Keep but acknowledge as YAGNI

4. **`McpServerSse`** -- The SSE transport type is a real MCP transport. Including it is defensible schema design but untested. Either add a test or remove it.

5. **`extends` field** -- Conscious v2 placeholder. Keep it since the manifest format is a public API and the cost is 12 LOC total including tests.

---

## Simplification Recommendations (Prioritized)

### 1. Merge CorePluginRef into PluginRef

- **Current:** Two structurally identical Zod objects with different `.describe()` text
- **Proposed:** Use `PluginRef` for `plugins.core` -- the key name "core" already communicates semantics
- **Impact:** -5 LOC, one fewer concept to maintain

### 2. Extract cloneToLocal() into loader.ts

- **Current:** Two near-identical clone implementations in `install.ts` and `inspect.ts`
- **Proposed:** `export async function cloneToLocal(source: RigSource): Promise<string>` in `loader.ts`
- **Impact:** -8 LOC, eliminates duplicate imports, improves cohesion

### 3. Remove ExternalTool.platforms field

- **Current:** Schema accepts platform-specific install commands, but no code reads them
- **Proposed:** Delete the field. Add it when platform-specific installs are actually implemented
- **Impact:** -4 LOC, removes dead schema surface

### 4. (Optional) Remove or test McpServerSse

- **Current:** SSE type accepted by schema but never tested or used in examples
- **Proposed:** Either add `{ type: "sse", url: "..." }` to a test, or remove the type
- **Impact:** -5 LOC if removed, or +3 LOC if tested. Either way, the schema matches reality

---

## YAGNI Violations

### 1. ExternalTool.platforms (Definite Violation)

- **What:** Platform-specific install commands in the tool schema
- **Why it violates YAGNI:** No code reads this field. The installer ignores it. No example uses it.
- **What to do:** Remove it. When you implement platform-aware tool installation, add it then.

### 2. extends Field (Conscious Placeholder -- Acceptable)

- **What:** Rig composition via `extends: "owner/repo"`
- **Why it violates YAGNI:** No resolution logic exists. It's a no-op in v0.1.0.
- **Why it's acceptable:** The manifest format is a public API. Including it now signals intent and avoids a breaking schema change in v2. Cost is 12 LOC.

### 3. McpServerSse (Borderline)

- **What:** SSE transport type in MCP server schema
- **Why it's borderline:** SSE is a real MCP transport type. Including it is forward-compatible schema design. But no code, test, or example exercises it.
- **What to do:** Either add a minimal test case, or remove and re-add when needed.

### 4. CorePluginRef (Type Duplication, Not Feature)

- **What:** A separate Zod object identical to `PluginRef`
- **Why it violates YAGNI:** You don't need a distinct type for something structurally identical
- **What to do:** Use `PluginRef` directly for `plugins.core`

---

## Things That Are NOT Over-Engineered

These items might look like over-engineering but are actually well-calibrated:

1. **Adapter pattern for 2 adapters** -- The polymorphism is actively used in a loop. The interface is 16 LOC. The cost of NOT having it would be a messy if/else chain that's harder to extend.

2. **Four plugin categories** -- They serve a display/semantic purpose in `inspect`, even though `install` treats them uniformly. The README documents them clearly.

3. **Separate command files** -- Each command in its own file is standard CLI organization, not over-engineering.

4. **Zod schema validation** -- The schema is the project's core value proposition. Thorough validation is appropriate.

5. **`resolveSource()` complexity** -- Four input formats with priority ordering is necessary UX, not unnecessary complexity. Well-tested.

6. **`InstallResult` type** -- All four status values are used. The type is minimal.

7. **chalk for terminal output** -- Color output is essential for a CLI tool that produces status reports.

---

## Final Assessment

| Metric | Value |
|--------|-------|
| Total source LOC | 849 (excl. tests) |
| Total test LOC | 308 |
| Total project LOC | 1,157 |
| Potential LOC reduction | ~22 LOC (definite), ~35 LOC (with optional changes) |
| Potential LOC reduction % | ~2-3% |
| Complexity score | **Low** |
| YAGNI violations | 1 definite, 2 borderline, 1 conscious placeholder |
| Recommended action | **Minor tweaks only -- this is already close to minimal** |

### Summary

This is a well-built v0.1.0. The code is direct, the abstractions are proportionate to the problem, and the dependency choices are conservative. The adapter pattern is justified by active use. The schema complexity maps directly to the manifest's real-world structure.

The only concrete code to remove is `CorePluginRef` (merge into `PluginRef`) and `ExternalTool.platforms` (dead field). The clone-to-local duplication should be extracted to `loader.ts`. Everything else is either justified or so minimal in cost (3-5 LOC) that removing it isn't worth the churn.

**The project's biggest risk is not over-engineering -- it's under-documenting the adapter extension point.** The AGENTS.md mentions "Adding a New Platform Adapter" in 4 lines. If third-party adapters are a goal, that section needs more detail. But that's a documentation concern, not a code simplicity concern.
