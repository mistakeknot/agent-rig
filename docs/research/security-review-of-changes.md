# Security Review: Changes Addressing Prior Audit Findings

**Date:** 2026-02-08
**Auditor:** Claude Opus 4.6 (Automated Security Analysis)
**Scope:** Review of fixes to CRIT-01 (shell injection via `sh -c`), CRIT-02 (`as any` cast / script execution), HIGH-03 (missing user confirmation), and new code (`src/exec.ts`, updated `src/adapters/codex.ts`, `src/adapters/claude-code.ts`)
**Prior Audit:** `docs/research/security-audit-of-cli-tool.md` (2026-02-08)

---

## Executive Summary

Three prior findings were targeted for remediation. The fixes are **partially effective**: user confirmation (HIGH-03) is now implemented, the `as any` cast (part of CRIT-02) is removed, and git-clone logic is cleanly refactored into `src/exec.ts`. However, the most critical finding -- arbitrary command execution via `sh -c` (CRIT-01) -- **remains fully exploitable**. The confirmation prompt is placed after manifest loading but before tool execution, which mitigates the "no confirmation" issue. But the confirmation only shows the shell commands textually; it does not prevent an informed user from accidentally approving a malicious command embedded in a legitimate-looking manifest, and it does nothing against `--yes` / `-y` flag usage or automated pipelines.

| Prior Finding | Fix Status | Residual Risk |
|---|---|---|
| CRIT-01: `sh -c` shell injection | **NOT FIXED** -- still present at lines 81 and 102 | Critical |
| CRIT-02: `as any` cast removed | **FIXED** -- typed access to `codexConfig.installScript` | Low (script execution remains) |
| CRIT-02: Arbitrary script execution | **NOT FIXED** -- still runs `bash [installScript]` | High |
| HIGH-03: No user confirmation | **FIXED** -- interactive `confirm()` added with `--yes` bypass | Low |
| NEW: `src/exec.ts` refactor | **SAFE** -- `execFile("git", [...])` with argument array | None introduced |
| Verify method SSRF | **NOT FIXED** -- still curls manifest-controlled URLs | High |

**Overall verdict:** 2 of 5 issues meaningfully improved. The critical shell injection vector is unchanged. The codebase is safer than before but retains its most dangerous property.

---

## Detailed Analysis of Each Change

### 1. `src/commands/install.ts` -- Still Uses `sh -c` (CRIT-01 UNRESOLVED)

**File:** `/root/projects/agent-rig/src/commands/install.ts`, lines 76-113

The `installTools()` function is unchanged from the prior audit. Manifest-defined strings are still passed directly to `sh -c`:

```typescript
// Line 81 -- tool.check from untrusted manifest
await execFileAsync("sh", ["-c", tool.check], { timeout: 5_000 });

// Line 102 -- tool.install from untrusted manifest
await execFileAsync("sh", ["-c", tool.install], { timeout: 120_000 });
```

**What the confirmation prompt changes:** The new `confirm()` function (lines 28-36) and `printInstallPlan()` (lines 38-74) show users the shell commands before execution:

```typescript
// Lines 64-67
console.log(`  ${chalk.magenta("Install")} ${tools.length} tools via shell commands:`);
for (const t of tools) {
  console.log(chalk.dim(`    $ ${t.install}`));
}
```

And require confirmation at line 165 (unless `--yes` is passed):

```typescript
if (!opts.yes) {
  const ok = await confirm("\nProceed with installation?");
  if (!ok) {
    console.log(chalk.yellow("Aborted."));
    return;
  }
}
```

**Assessment: Partial mitigation, not a fix.**

The confirmation is a genuine improvement but has these weaknesses:

1. **`tool.check` commands are NOT shown in the install plan.** The `printInstallPlan()` function at line 66 displays `t.install` but never displays `t.check`. A malicious manifest can embed the payload in the `check` field, which the user never sees before approving. After approval, `installTools()` runs `tool.check` first (line 81) before `tool.install` (line 102). The attacker's code executes without the user ever having been shown it.

2. **The `--yes` / `-y` flag bypasses confirmation entirely.** This is expected behavior for automation, but it means any CI/CD pipeline or script using `agent-rig install -y <source>` gets zero protection. The flag is documented in `src/index.ts` line 19.

3. **Social engineering remains viable.** A legitimate-looking `install` command such as `npm install -g @legitimate/package` can be paired with a malicious `check` command that the user never sees. Even if `check` commands were shown, visually auditing shell commands in a terminal prompt is unreliable.

4. **The fundamental `sh -c` pattern is unchanged.** The prior audit recommended replacing free-form shell strings with structured `command` + `args` arrays. This has not been done. The `ExternalTool` schema in `/root/projects/agent-rig/src/schema.ts` (lines 47-53) still defines `install` and `check` as unconstrained strings.

**Severity:** CRITICAL -- unchanged from prior audit.

**Remaining remediation needed:**
- Show `tool.check` commands in the install plan alongside `tool.install` commands
- Refactor `ExternalTool` schema to structured `{command: string, args: string[]}` format
- At minimum, add an allowlist of permitted command prefixes (`npm install`, `go install`, `pip install`, `command -v`, `which`)

---

### 2. `src/adapters/codex.ts` -- `as any` Cast Removed (CRIT-02 PARTIALLY FIXED)

**File:** `/root/projects/agent-rig/src/adapters/codex.ts`, lines 22-51

**Prior code (from audit):**
```typescript
const installScript = (codexConfig as any).installScript;
```

**Current code:**
```typescript
const codexConfig = rig.platforms?.codex;
// ...
if (codexConfig.installScript) {
  await execFileAsync("bash", [codexConfig.installScript, "install"], {
    timeout: 60_000,
  });
}
```

**What changed:**
- The `as any` cast is gone. The code now accesses `codexConfig.installScript` through the properly typed `rig.platforms?.codex` path, matching the Zod schema definition in `schema.ts` line 68-71.
- The null check (`if (!codexConfig)` at line 23) properly guards the codex platform being absent.

**What did NOT change:**
- The `installScript` value (a path string from the manifest) is still passed directly to `bash` for execution. The script is still attacker-controlled content from the cloned repository.
- There is no path traversal validation (the `installScript` could be `../../etc/cron.d/backdoor` or `/tmp/evil.sh`).
- The Codex `installPlugins()` method runs during the install flow AFTER the user confirmation prompt, which is a positive -- but the install plan (shown to the user) does NOT mention that a bash script will be executed. The `printInstallPlan()` function in `install.ts` does not include any reference to Codex install scripts.

**Severity:** HIGH -- the type safety fix is real but the underlying arbitrary script execution is unchanged and the user is not informed about it during the confirmation step.

**Remaining remediation needed:**
- Validate that `installScript` resolves to a path within the cloned repository root (prevent traversal)
- Display the script path (and ideally key contents) in the install plan before confirmation
- Consider requiring the script to have a specific shebang or structure

---

### 3. `src/exec.ts` (NEW) -- Shared `cloneToLocal` and `execFileAsync` Export

**File:** `/root/projects/agent-rig/src/exec.ts` (19 lines)

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

**Assessment: SAFE refactor with no new vulnerabilities.**

Positive properties:
- Uses `execFile` (not `exec`), so the git URL and destination path are passed as separate arguments -- no shell interpretation.
- The `source.url` is constructed by `resolveSource()` in `loader.ts` from either a validated GitHub regex match or a full URL match, then formatted as `https://github.com/${owner}/${repo}.git`. This prevents shell injection via the URL argument.
- The clone destination uses `tmpdir()` + repo name + timestamp, which is deterministic but passed to `git clone` as an argument, not through a shell.

**Prior issue preserved (MED-03):**
- The temp directory name is still partially predictable (`agent-rig-${source.repo}-${Date.now()}`). The prior audit recommended using `mkdtemp()` for cryptographic randomness.
- No cleanup of temp directories after install.
- The previously separate clone code in `install.ts` and `inspect.ts` is now consolidated in one place, which is good for maintenance and consistent security properties.

**New observation:** The `source.repo` value is included in the directory name. For GitHub sources, this comes from the regex match and is alphanumeric with dots/hyphens. For local sources, the function returns `source.path` directly and never creates a temp directory. So there is no path injection risk here.

**Severity:** None (new) / Low (pre-existing MED-03 temp dir issue persists).

---

### 4. `src/adapters/claude-code.ts` -- Verify Method SSRF (HIGH-01 UNRESOLVED)

**File:** `/root/projects/agent-rig/src/adapters/claude-code.ts`, lines 89-119

```typescript
async verify(rig: AgentRig): Promise<InstallResult[]> {
  const results: InstallResult[] = [];
  for (const [name, server] of Object.entries(rig.mcpServers ?? {})) {
    if (
      server.type === "http" &&
      "healthCheck" in server &&
      server.healthCheck
    ) {
      const { ok } = await run("curl", [
        "-s",
        "--max-time",
        "2",
        server.healthCheck,
      ]);
      // ...
    }
  }
  return results;
}
```

**No changes from prior audit.** The health check URL comes from the manifest and is passed to `curl` without restriction. The Zod schema validates it as a syntactically valid URL (`z.string().url()`) but does not restrict the target.

**Attack scenarios remain viable:**
- SSRF to cloud metadata endpoints: `http://169.254.169.254/latest/meta-data/`
- SSRF to internal services: `http://10.0.0.1:8080/admin`
- Protocol-based attacks: `file:///etc/passwd` (if curl follows), `gopher://`, `dict://`

**Note on the `run()` helper function (lines 5-18):** The `run()` function uses `execFileAsync` with argument arrays, which is safe against shell injection. The security issue is not injection but SSRF -- the target URL itself is the attack.

**Positive observation:** The `--max-time 2` flag limits response time, which mitigates slow-read attacks but not the SSRF itself.

**Severity:** HIGH -- unchanged from prior audit.

**Remaining remediation needed:**
- Add `--proto -all,http,https` to curl arguments to prevent non-HTTP protocol attacks
- Add `--no-location` to prevent redirect-based SSRF
- Validate that health check URLs point to loopback addresses only (or match the server's own `url` host)
- Block RFC 1918, link-local (169.254.x.x), and cloud metadata IP ranges

---

### 5. User Confirmation Flow (HIGH-03 FIX REVIEW)

**File:** `/root/projects/agent-rig/src/commands/install.ts`, lines 28-36 and 161-170

The confirmation implementation is clean and correct:

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

**Positive properties:**
- Default is "No" (`[y/N]`), requiring explicit `y` to proceed
- Only exact `y` (case-insensitive) is accepted -- not `yes`, `Y`, or any other input
- Readline interface is properly closed after the question
- The `--yes` flag provides explicit opt-in for automation (`opts.yes` check at line 164)

**Security-relevant gap in `printInstallPlan()`:**

The install plan (lines 38-74) shows:
- Number of plugins to install
- Number of conflicts to disable
- Number of MCP servers to configure
- Tool install commands (but NOT check commands)
- Platforms detected

**Not shown to the user before confirmation:**
- `tool.check` shell commands (which execute before install commands)
- Codex `installScript` path/contents
- Health check URLs that will be curled
- Environment variables that will be suggested for shell profiles
- Plugin source identifiers (user sees count, not the actual `source` strings)

This means the confirmation prompt is a speed bump, not a security boundary. A user approving installation has incomplete information about what will execute.

**Severity:** LOW (the fix addresses HIGH-03 meaningfully, but the gaps noted above reduce its effectiveness).

---

## New Issues Introduced by Changes

### NEW-01: `cloneToLocal` Runs Before Confirmation

**File:** `/root/projects/agent-rig/src/commands/install.ts`, line 123

```typescript
const dir = await cloneToLocal(source);  // Line 123 -- runs git clone
const rig = await loadManifest(dir);     // Line 125 -- parses manifest
// ... platform detection ...
printInstallPlan(rig, activeAdapters);    // Line 162
if (!opts.yes) {                          // Line 164
  const ok = await confirm("...");        // Line 165
```

The git clone and manifest loading happen BEFORE the confirmation prompt. This is necessary (you need the manifest to show the install plan), but it means:
- Git clone hooks (if present in the remote repo's `.git/config` or templates) could execute before any user interaction
- A maliciously crafted git repo could exploit git vulnerabilities during the clone operation itself
- The `--depth 1` mitigates some git-level attacks but not all

This is not a regression (the prior code had the same flow without any confirmation), but it is worth noting that the confirmation only gates post-clone actions.

**Severity:** LOW -- this is inherent to the design and cannot easily be moved earlier.

### NEW-02: Confirmation Does Not Gate Verification Phase

**File:** `/root/projects/agent-rig/src/commands/install.ts`, lines 196-200

```typescript
console.log(chalk.bold("\n--- Verification ---"));
for (const adapter of activeAdapters) {
  const verifyResults = await adapter.verify(rig);
  printResults(`${adapter.name} Health`, verifyResults);
}
```

The verification step (which includes SSRF-vulnerable `curl` calls to health check URLs) runs after the confirmation prompt, so it IS gated by user approval. This is correct behavior.

However, the user was never shown WHICH health check URLs would be curled during the install plan. The plan shows MCP server count but not their health check URLs. A malicious manifest could specify legitimate-looking server names with SSRF health check URLs.

**Severity:** MEDIUM -- the confirmation exists but the user lacks information to make an informed decision about health check URLs.

---

## Summary of All Open Findings (Post-Fix)

### Critical

| ID | Finding | Status | File:Line |
|---|---|---|---|
| CRIT-01 | `sh -c` with manifest shell commands | **OPEN** | `/root/projects/agent-rig/src/commands/install.ts:81,102` |

### High

| ID | Finding | Status | File:Line |
|---|---|---|---|
| CRIT-02b | Arbitrary bash script execution from manifest | **OPEN** (type safety fixed, execution unchanged) | `/root/projects/agent-rig/src/adapters/codex.ts:36` |
| HIGH-01 | SSRF via health check URLs | **OPEN** | `/root/projects/agent-rig/src/adapters/claude-code.ts:98-103` |

### Medium

| ID | Finding | Status | File:Line |
|---|---|---|---|
| HIGH-02 | MCP stdio command field unvalidated | **OPEN** (pre-existing) | `/root/projects/agent-rig/src/schema.ts:29` |
| MED-02 | Environment variable shell injection via copy-paste | **OPEN** (pre-existing) | `/root/projects/agent-rig/src/commands/install.ts:191-194` |
| MED-03 | Temp directory predictability/cleanup | **OPEN** (pre-existing) | `/root/projects/agent-rig/src/exec.ts:13` |
| NEW-02 | Health check URLs not shown in install plan | **NEW** | `/root/projects/agent-rig/src/commands/install.ts:196` |

### Low

| ID | Finding | Status | File:Line |
|---|---|---|---|
| HIGH-03 | No user confirmation | **FIXED** | `/root/projects/agent-rig/src/commands/install.ts:28-36,161-170` |
| CRIT-02a | `as any` type safety bypass | **FIXED** | `/root/projects/agent-rig/src/adapters/codex.ts:34` |
| MED-04 | Error messages leak system info | **OPEN** (pre-existing) | Multiple |
| LOW-01 | No input sanitization on resolveSource | **OPEN** (pre-existing) | `/root/projects/agent-rig/src/loader.ts:20-57` |
| NEW-01 | Git clone runs before confirmation | **NEW** (by design) | `/root/projects/agent-rig/src/commands/install.ts:123` |

### Closed

| ID | Finding | Status |
|---|---|---|
| HIGH-03 | Missing user confirmation | **FIXED** -- confirm() with [y/N] default, `--yes` for automation |
| CRIT-02a | `as any` type bypass | **FIXED** -- typed access via `rig.platforms?.codex` |

---

## Specific Recommendation: Invisible `tool.check` Execution

The most actionable improvement to make immediately is to add `tool.check` commands to the install plan display. Currently, the install plan at lines 64-67 shows:

```typescript
console.log(`  ${chalk.magenta("Install")} ${tools.length} tools via shell commands:`);
for (const t of tools) {
  console.log(chalk.dim(`    $ ${t.install}`));
}
```

But `tool.check` commands are never shown, despite being executed first. This means a malicious manifest can hide arbitrary code execution in the `check` field while showing benign-looking `install` commands. The install plan should also display:

```
  Check 4 tools with shell commands:
    $ command -v oracle
    $ command -v codex
    $ command -v bd
    $ command -v qmd
```

This does not fix the fundamental `sh -c` vulnerability but it ensures the user sees ALL commands that will be executed, making the confirmation prompt more meaningful.

---

## Conclusion

The changes represent forward progress on the prior audit findings. The user confirmation prompt (HIGH-03) and type safety fix (CRIT-02 partial) are correctly implemented. The `exec.ts` refactor is clean and introduces no new vulnerabilities.

However, the critical `sh -c` shell injection (CRIT-01) is fully intact, the Codex install script execution is still unvalidated (CRIT-02 partial), and the SSRF via health check URLs (HIGH-01) is unchanged. The confirmation prompt mitigates but does not resolve these issues, particularly because `tool.check` commands and health check URLs are not displayed to the user before they approve.

**Priority next steps:**
1. Show ALL executed commands (including `tool.check`) in the install plan
2. Show health check URLs in the install plan
3. Replace free-form shell strings with structured command+args in the ExternalTool schema
4. Validate Codex installScript path is within the cloned repo
5. Add curl protocol restrictions and URL validation for health checks
