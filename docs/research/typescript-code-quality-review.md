# TypeScript Code Quality Review: agent-rig

**Reviewer:** Kieran (Super Senior TypeScript Developer)
**Date:** 2026-02-08
**Scope:** All `.ts` files in `/root/projects/agent-rig/src/`
**Verdict:** Solid foundation with several issues that need attention before this ships.

---

## Executive Summary

The codebase is well-structured for an early v0.1.0 project. Good use of Zod for validation, clean discriminated unions for MCP server types, proper ESM with `node:` protocol imports, and a sensible adapter pattern. However, there are **5 critical issues**, **8 moderate issues**, and **several minor improvements** that would bring this up to production quality.

---

## CRITICAL Issues (Must Fix)

### C1. `any` casts in `/root/projects/agent-rig/src/adapters/claude-code.ts` (line 17) and `/root/projects/agent-rig/src/adapters/codex.ts` (lines 37, 47)

**Severity:** CRITICAL
**File:** `/root/projects/agent-rig/src/adapters/claude-code.ts`

```typescript
// Line 17 -- claude-code.ts
} catch (err: any) {
  return { ok: false, output: err.message || String(err) };
}
```

```typescript
// Line 37 -- codex.ts
const installScript = (codexConfig as any).installScript;
```

```typescript
// Line 47 -- codex.ts
} catch (err: any) {
  results.push({
    component: "codex-install-script",
    status: "failed",
    message: err.message,
  });
}
```

The `err: any` pattern on catch blocks is common but avoidable. Use `unknown` and a type guard. The real problem is line 37 in `codex.ts` -- that `as any` cast is completely unnecessary and masks a deeper problem: the `codexConfig` already has a typed shape from Zod inference via `AgentRig`, so `installScript` should be accessible directly via the type.

**Fix for catch blocks:**
```typescript
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, output: message };
}
```

**Fix for the `as any` cast in codex.ts:**
The `codexConfig` variable on line 25 is typed from `rig.platforms?.["codex"]` which, through the Zod schema, is `z.infer<typeof CodexPlatform> | undefined`. The `CodexPlatform` schema has an `installScript` field. So `codexConfig.installScript` should be directly accessible without any cast. The `typeof codexConfig !== "object"` guard on line 26 is also redundant -- Zod already guarantees the shape. The real issue is the `Platforms` schema uses `.catchall()` which may be eroding the specific type for `codex`. See C3.

### C2. `any` casts in `/root/projects/agent-rig/src/commands/install.ts` (line 71) and `/root/projects/agent-rig/src/commands/validate.ts` (line 46)

**Severity:** CRITICAL
**Files:** `/root/projects/agent-rig/src/commands/install.ts`, `/root/projects/agent-rig/src/commands/validate.ts`

```typescript
// install.ts line 71
} catch (err: any) {
  results.push({
    component: `tool:${tool.name}`,
    status: "failed",
    message: err.message,
  });
}
```

```typescript
// validate.ts line 46
} catch (err: any) {
  console.log(chalk.red("Invalid!"));
  console.log(err.message);
  process.exit(1);
}
```

Same pattern repeated. Every `catch (err: any)` in the codebase should be `catch (err: unknown)` with a proper type narrowing pattern. I count **5 total `any` usages** across the codebase. Zero should be acceptable without a `// eslint-disable-next-line` style justification comment.

### C3. The `Platforms` schema `.catchall()` erodes type safety

**Severity:** CRITICAL
**File:** `/root/projects/agent-rig/src/schema.ts` (lines 85-90)

```typescript
const Platforms = z
  .object({
    "claude-code": ClaudeCodePlatform.optional(),
    codex: CodexPlatform.optional(),
  })
  .catchall(z.record(z.string(), z.unknown()));
```

The `.catchall(z.record(z.string(), z.unknown()))` is problematic for two reasons:

1. **Type erosion**: The inferred type for known keys like `codex` gets polluted by the catchall's type. This is why the `codex.ts` adapter needs `(codexConfig as any).installScript` -- the TypeScript type may not cleanly resolve `installScript` through the catchall union.
2. **Validation hole**: Any unknown platform key can contain `z.unknown()` values, meaning there's zero validation on extra platform data. This defeats the purpose of schema validation.

**Fix:** Use `.passthrough()` instead if you just want to allow extra keys without validating them, or better yet, drop the catchall entirely and add platform schemas as needed:

```typescript
const Platforms = z.object({
  "claude-code": ClaudeCodePlatform.optional(),
  codex: CodexPlatform.optional(),
});
```

If extensibility is truly needed, use a separate `extraPlatforms` field with explicit typing.

### C4. Shell injection risk in `/root/projects/agent-rig/src/commands/install.ts`

**Severity:** CRITICAL
**File:** `/root/projects/agent-rig/src/commands/install.ts` (lines 48, 69)

```typescript
await execFileAsync("sh", ["-c", tool.check], { timeout: 5_000 });
// ...
await execFileAsync("sh", ["-c", tool.install], { timeout: 120_000 });
```

While `execFile` is safer than `exec`, passing user-controlled strings through `sh -c` negates that safety entirely. The `tool.check` and `tool.install` fields come from the `agent-rig.json` manifest which could be from a remote GitHub repo (the `install` command clones repos). This is a supply-chain attack vector.

This is mitigated by the fact that `inspect` exists to review before installing, but the code should at minimum:
- Log the exact commands being run before execution
- Consider a `--yes` / `--confirm` flag pattern
- Document the trust model in a comment

### C5. `as unknown[]` type assertions in `/root/projects/agent-rig/src/commands/init.ts`

**Severity:** CRITICAL
**File:** `/root/projects/agent-rig/src/commands/init.ts` (lines 38-48)

```typescript
const manifest = {
  name,
  version,
  description,
  author,
  license: "MIT",
  plugins: {
    required: [] as unknown[],
    recommended: [] as unknown[],
    conflicts: [] as unknown[],
  },
  mcpServers: {},
  tools: [] as unknown[],
  platforms: {
    "claude-code": {
      marketplaces: [] as unknown[],
    },
  },
};
```

Using `as unknown[]` is a lazy escape hatch. These should be properly typed empty arrays:

```typescript
import type { AgentRig } from "../schema.js";

const manifest: AgentRig = {
  name,
  version,
  description,
  author,
  license: "MIT",
  plugins: {
    required: [],
    recommended: [],
    conflicts: [],
  },
  mcpServers: {},
  tools: [],
  platforms: {
    "claude-code": {
      marketplaces: [],
    },
  },
};
```

TypeScript will infer the correct array types from the `AgentRig` type annotation. The `as unknown[]` casts actively hide type errors -- if `AgentRig` changes, these arrays will silently accept the wrong shape.

---

## MODERATE Issues

### M1. Duplicated `run()` / `execFileAsync` patterns across files

**Severity:** MODERATE
**Files:** `/root/projects/agent-rig/src/adapters/claude-code.ts`, `/root/projects/agent-rig/src/adapters/codex.ts`, `/root/projects/agent-rig/src/commands/install.ts`, `/root/projects/agent-rig/src/commands/inspect.ts`

Four files independently create `const execFileAsync = promisify(execFile)`. The `claude-code.ts` adapter wraps it in a `run()` helper, but `codex.ts` and the command files don't reuse it. This is textbook "extract to a shared module" territory.

**Fix:** Create `/root/projects/agent-rig/src/exec.ts`:
```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ExecResult {
  ok: boolean;
  output: string;
}

export async function run(
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: opts?.timeout ?? 30_000,
    });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, output: message };
  }
}
```

### M2. `cloneToLocal` in install.ts and inspect.ts is duplicated

**Severity:** MODERATE
**Files:** `/root/projects/agent-rig/src/commands/install.ts` (lines 32-41), `/root/projects/agent-rig/src/commands/inspect.ts` (lines 17-29)

Both commands have nearly identical git clone logic. Extract to the loader module:

```typescript
// In loader.ts
export async function resolveToLocalDir(source: RigSource): Promise<string> {
  if (source.type === "local") return source.path;

  const dest = join(tmpdir(), `agent-rig-${source.repo}-${Date.now()}`);
  await run("git", ["clone", "--depth", "1", source.url, dest], {
    timeout: 60_000,
  });
  return dest;
}
```

### M3. No cleanup of cloned temp directories

**Severity:** MODERATE
**Files:** `/root/projects/agent-rig/src/commands/install.ts`, `/root/projects/agent-rig/src/commands/inspect.ts`

When cloning from GitHub, both commands create temp directories (`join(tmpdir(), ...)`) but never clean them up. Over time, this leaks disk space. `inspect` is particularly bad since it's meant to be a read-only preview operation.

**Fix:** Use `try/finally` to clean up, or at minimum for `inspect`:
```typescript
const cleanup = source.type === "github"
  ? () => rmSync(dir, { recursive: true, force: true })
  : () => {};

try {
  // ... do work
} finally {
  cleanup();
}
```

### M4. `resolveSource` has ambiguous precedence between filesystem and GitHub

**Severity:** MODERATE
**File:** `/root/projects/agent-rig/src/loader.ts` (lines 20-57)

The `existsSync` check on line 42 creates a subtle bug: if someone has a local directory named `owner/repo` (which is common in monorepos), it will be treated as local instead of GitHub. The test on line 42-46 of `loader.test.ts` even acknowledges this:

```typescript
it("treats existing directories as local even if they match owner/repo", () => {
  // "examples/clavain" exists on disk, so it should be local not GitHub
  const result = resolveSource("examples/clavain");
  assert.deepEqual(result, { type: "local", path: "examples/clavain" });
});
```

This is a design choice, not a bug per se, but it's surprising behavior. The `existsSync` call also makes `resolveSource` impure (it depends on filesystem state), which makes it harder to test. Consider adding a `--local` or `--github` flag to disambiguate, or at least documenting this precedence clearly.

### M5. `verify()` in `ClaudeCodeAdapter` uses `curl` instead of native fetch

**Severity:** MODERATE
**File:** `/root/projects/agent-rig/src/adapters/claude-code.ts` (lines 91-121)

```typescript
const { ok } = await run("curl", [
  "-s",
  "--max-time",
  "2",
  server.healthCheck,
]);
```

Node.js 20+ has native `fetch()`. Shelling out to `curl` for HTTP health checks adds an unnecessary external dependency and is slower. Use:

```typescript
try {
  const response = await fetch(server.healthCheck, {
    signal: AbortSignal.timeout(2000),
  });
  const ok = response.ok;
  // ...
} catch {
  // not responding
}
```

### M6. Redundant `"healthCheck" in server` type guard

**Severity:** MODERATE
**File:** `/root/projects/agent-rig/src/adapters/claude-code.ts` (lines 96-98)

```typescript
if (
  server.type === "http" &&
  "healthCheck" in server &&
  server.healthCheck
) {
```

The `"healthCheck" in server` check is redundant. After `server.type === "http"`, TypeScript's discriminated union narrows `server` to `McpServerHttp`, which has `healthCheck` as an optional property. Just `server.healthCheck` (truthy check) is sufficient:

```typescript
if (server.type === "http" && server.healthCheck) {
```

### M7. `process.exit(1)` in library code

**Severity:** MODERATE
**Files:** `/root/projects/agent-rig/src/commands/install.ts` (line 124), `/root/projects/agent-rig/src/commands/validate.ts` (line 49)

Calling `process.exit()` in command handlers makes them untestable. The CLI entry point (`index.ts`) should be the only place that exits. Commands should throw or return error codes.

**Fix:**
```typescript
// Instead of:
process.exit(1);

// Throw a typed error:
class AgentRigError extends Error {
  constructor(message: string, public exitCode: number = 1) {
    super(message);
  }
}

// In index.ts, catch at the top level:
try {
  program.parse();
} catch (err) {
  if (err instanceof AgentRigError) {
    process.exit(err.exitCode);
  }
  throw err;
}
```

### M8. Import organization inconsistencies

**Severity:** MODERATE
**Files:** Multiple

`/root/projects/agent-rig/src/commands/install.ts` has two separate imports from the same module:

```typescript
import { loadManifest } from "../loader.js";
import { resolveSource, type RigSource } from "../loader.js";
```

Should be consolidated:

```typescript
import { loadManifest, resolveSource, type RigSource } from "../loader.js";
```

Similarly, `/root/projects/agent-rig/src/commands/inspect.ts` duplicates this pattern:

```typescript
import { loadManifest } from "../loader.js";
import { resolveSource } from "../loader.js";
```

---

## MINOR Issues

### m1. Semver regex is too loose

**File:** `/root/projects/agent-rig/src/schema.ts` (line 99)

```typescript
version: z.string().regex(/^\d+\.\d+\.\d+/, "Must be semver"),
```

This regex accepts `1.0.0anything-goes-here` because it lacks a `$` anchor. Strings like `1.0.0this-is-not-semver` will pass.

**Fix:**
```typescript
version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/, "Must be semver"),
```

### m2. `name` property on adapters should be `readonly`

**Files:** `/root/projects/agent-rig/src/adapters/claude-code.ts` (line 23), `/root/projects/agent-rig/src/adapters/codex.ts` (line 9)

```typescript
name = "claude-code";  // Should be: readonly name = "claude-code" as const;
```

Using `readonly` and `as const` gives you a literal type instead of `string`, which is more precise and prevents accidental mutation.

### m3. No validation of `source` format in plugin/conflict refs

**File:** `/root/projects/agent-rig/src/schema.ts`

The `PluginRef.source` and `ConflictRef.source` are just `z.string()`. Given the format is `name@marketplace`, this should have a regex:

```typescript
const PluginRef = z.object({
  source: z.string()
    .regex(/^[\w-]+@[\w-]+$/, "Must be name@marketplace format"),
  description: z.string().optional(),
});
```

### m4. E2E tests reload the manifest redundantly

**File:** `/root/projects/agent-rig/src/e2e.test.ts`

Every test case calls `loadManifest(exampleDir)` independently. While this tests isolation, it's wasteful. Use a `before()` hook to load once:

```typescript
describe("E2E: Clavain example manifest", () => {
  let rig: AgentRig;

  before(async () => {
    rig = await loadManifest(exampleDir);
  });

  it("has correct plugin counts", () => {
    assert.equal(rig.plugins?.required?.length, 9);
    // ...
  });
});
```

This is a minor efficiency concern and also has a trade-off (shared mutable state), so it's acceptable either way.

### m5. Test file `/root/projects/agent-rig/src/loader.test.ts` uses sync filesystem APIs inconsistently

The test uses `writeFileSync`, `mkdirSync`, `rmSync` (sync) while the code under test uses `readFile` (async). This is fine for tests but the cleanup in `rmSync` after the assertion means that if the assertion throws, the temp directory is never cleaned up. Use `after()` or `try/finally`:

```typescript
it("loads a valid agent-rig.json from a local directory", async () => {
  mkdirSync(testDir, { recursive: true });
  try {
    writeFileSync(join(testDir, "agent-rig.json"), JSON.stringify({...}));
    const result = await loadManifest(testDir);
    assert.equal(result.name, "test-rig");
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});
```

### m6. Missing test coverage

**Coverage gaps identified:**

| Module | Missing Coverage |
|--------|-----------------|
| `codex.ts` | No tests at all |
| `install.ts` | No tests for `installCommand`, `installTools`, `cloneToLocal` |
| `inspect.ts` | No tests |
| `init.ts` | No tests |
| `validate.ts` | No tests |
| `schema.ts` | No negative tests for MCP discriminated union, no test for `.catchall()` behavior |
| `loader.ts` | No test for malformed JSON, no test for `existsSync` precedence edge cases |
| `claude-code.ts` | Tests don't mock `execFile`, so they call real `claude` CLI |

The adapter test for `ClaudeCodeAdapter` is particularly concerning:

```typescript
it("detects Claude Code CLI", async () => {
  const result = await adapter.detect();
  assert.equal(typeof result, "boolean");
});
```

This test passes regardless of the outcome. It asserts the return type is boolean, which TypeScript already guarantees. It doesn't test the actual behavior. This test has zero value.

### m7. `McpServerHttp` health check URL uses same validator as main URL

**File:** `/root/projects/agent-rig/src/schema.ts` (line 26)

```typescript
healthCheck: z.string().url().optional(),
```

The `healthCheck` URL for MCP servers should probably also validate that it's HTTP/HTTPS (not `ftp://` or other protocols). Zod's `.url()` accepts any valid URL scheme. Consider:

```typescript
healthCheck: z.string()
  .url()
  .refine(
    (url) => url.startsWith("http://") || url.startsWith("https://"),
    "Health check must be an HTTP(S) URL",
  )
  .optional(),
```

---

## Structural Assessment

### What's Done Well

1. **Zod discriminated union for MCP servers** (`/root/projects/agent-rig/src/schema.ts` lines 42-46) -- excellent pattern, gives you runtime validation and compile-time type narrowing simultaneously.

2. **PlatformAdapter interface** (`/root/projects/agent-rig/src/adapters/types.ts`) -- clean, minimal interface. Good use of the adapter pattern to abstract platform differences.

3. **Error handling in `loadManifest`** (`/root/projects/agent-rig/src/loader.ts` lines 59-84) -- proper two-stage error handling (file read vs JSON parse vs schema validation) with meaningful error messages. This is how it should be done.

4. **ESM setup** -- `"type": "module"` in package.json, `node:` protocol imports, `.js` extensions in imports, `NodeNext` module resolution. All correct for modern Node.js ESM.

5. **tsconfig.json** -- `strict: true`, proper target/module settings, declaration generation. No complaints.

6. **`resolveSource` function** (`/root/projects/agent-rig/src/loader.ts`) -- well-structured discriminated union return type, clean pattern matching logic. The type narrowing on `RigSource` is used correctly downstream.

### Architecture Observations

The codebase follows a clean layered architecture:
- **Schema layer** (`schema.ts`) -- data shape definition
- **Loader layer** (`loader.ts`) -- file I/O and validation
- **Adapter layer** (`adapters/`) -- platform abstraction
- **Command layer** (`commands/`) -- CLI entry points

This is a good separation. The dependency direction is correct (commands depend on adapters and loader, not the reverse).

### Node.js Best Practices Scorecard

| Practice | Status | Notes |
|----------|--------|-------|
| ESM with `node:` protocol | PASS | All Node.js imports use `node:` prefix |
| `node:test` for testing | PASS | Using native test runner correctly |
| `strict: true` in tsconfig | PASS | |
| No default exports | PASS | All exports are named |
| `.js` extensions in imports | PASS | Required for NodeNext resolution |
| `engines` field in package.json | PASS | `>=20.0.0` |
| Signal handling | MISSING | No graceful shutdown for long-running installs |
| Temp file cleanup | FAIL | Cloned repos never cleaned up |

---

## Priority Action Items

### Tier 1 (Fix Before Shipping)

1. Replace all 5 `any` usages with `unknown` + type guards
2. Remove the `.catchall()` from `Platforms` schema (or replace with `.passthrough()`)
3. Fix the `as unknown[]` casts in `init.ts` with proper typing
4. Add the `$` anchor to the semver regex

### Tier 2 (Fix Soon)

5. Extract shared `run()`/`execFileAsync` to a common module
6. Consolidate duplicate git clone logic
7. Add temp directory cleanup
8. Replace `curl` health check with native `fetch()`
9. Move `process.exit()` to the CLI entry point only

### Tier 3 (Improve Over Time)

10. Add meaningful tests for adapters (with mocked `execFile`)
11. Add tests for all command modules
12. Add plugin source format validation regex
13. Fix import organization (consolidate duplicate module imports)
14. Add `readonly` to adapter `name` properties

---

## `any` Audit Summary

| File | Line | Usage | Fix |
|------|------|-------|-----|
| `/root/projects/agent-rig/src/adapters/claude-code.ts` | 17 | `catch (err: any)` | Use `unknown` + `instanceof Error` |
| `/root/projects/agent-rig/src/adapters/codex.ts` | 37 | `(codexConfig as any).installScript` | Fix Platforms schema, remove cast |
| `/root/projects/agent-rig/src/adapters/codex.ts` | 47 | `catch (err: any)` | Use `unknown` + `instanceof Error` |
| `/root/projects/agent-rig/src/commands/install.ts` | 71 | `catch (err: any)` | Use `unknown` + `instanceof Error` |
| `/root/projects/agent-rig/src/commands/validate.ts` | 46 | `catch (err: any)` | Use `unknown` + `instanceof Error` |

**Total: 5 `any` usages. Target: 0.**

---

*Review performed against all 14 TypeScript files in `/root/projects/agent-rig/src/`. No files in `docs/plans/` or `docs/solutions/` were reviewed.*
