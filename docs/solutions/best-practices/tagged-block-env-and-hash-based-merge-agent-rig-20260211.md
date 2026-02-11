---
module: agent-rig
date: 2026-02-11
problem_type: best_practice
component: cli
symptoms:
  - "Env vars printed to console but never written to shell profile"
  - "Re-install silently overwrites user-modified behavioral files"
  - "Uninstall leaves orphaned env vars in shell profile"
root_cause: incomplete_setup
resolution_type: tooling_addition
severity: medium
tags: [tagged-blocks, shell-profile, env-vars, sha256-hash, behavioral-merge, idempotent-file-management]
---

# Best Practice: Tagged-Block Shell Profiles and Hash-Based File Modification Detection

## Problem

agent-rig's install command had two file management gaps:
1. **Env vars**: Printed "add these to your shell profile" but never actually wrote them — breaking autonomy for tools like Oracle that need `DISPLAY=:99`
2. **Behavioral config**: Silently overwrote files in `.claude/rigs/<name>/` on re-install, even if the user had customized them

## Environment
- Module: agent-rig (rig manager for AI coding agents)
- Framework Version: 0.1.0
- Affected Component: CLI install/uninstall, shell profile management, behavioral config
- Date: 2026-02-11

## Symptoms
- After `agent-rig install`, Oracle commands failed because `DISPLAY` wasn't set in the shell
- Users who customized their rig's CLAUDE.md lost changes on `agent-rig update`
- `agent-rig uninstall` left env var exports in `.zshrc`

## What Didn't Work

**Attempted approach 1:** Appending raw `export` lines to shell profile
- **Why it failed:** No way to identify which lines belong to which rig. Uninstall can't find them. Re-install duplicates them.

**Attempted approach 2:** Storing the full file content for behavioral merge comparison
- **Why it failed:** Files can be large (CLAUDE.md with many instructions). Storing full content in the manifest is wasteful and makes the manifest hard to read. A hash is sufficient to detect changes.

## Solution

### 1. Tagged-Block Shell Profile Management

Env vars are written as tagged blocks that can be identified, replaced, and removed:

```bash
# --- agent-rig: clavain ---
export DISPLAY=":99"
export CHROME_PATH="/usr/local/bin/google-chrome-wrapper"
# --- end agent-rig: clavain ---
```

The implementation detects the user's shell and adapts syntax:

```typescript
function detectShell(): ShellInfo {
  const shell = process.env.SHELL ?? "";
  if (shell.endsWith("/fish")) {
    return { name: "fish", profilePath: join(home, ".config", "fish", "config.fish") };
  }
  if (shell.endsWith("/bash")) {
    return { name: "bash", profilePath: join(home, ".bashrc") };
  }
  return { name: "zsh", profilePath: join(home, ".zshrc") };
}
```

Fish gets `set -gx KEY "value"` instead of `export KEY="value"`.

Key operations:
- **Write**: If block exists → regex replace. If not → append with newline padding.
- **Remove**: Regex match `BEGIN_TAG...END_TAG` including surrounding newlines, then clean up triple-newlines.
- **Idempotent**: `hasEnvBlock()` checks before any operation.

The profile path is stored in `RigState.envProfilePath` so uninstall knows exactly where to remove from.

### 2. SHA-256 Hash-Based Behavioral File Modification Detection

Before overwriting a behavioral file (like the rig's CLAUDE.md), the installer checks if the user modified it since last install:

```typescript
// On install: store hash of what we wrote
const newHash = sha256(content);
fileHashes[destPath] = newHash;

// On re-install: compare current file against stored hash
const existingHash = sha256(readFileSync(destPath, "utf-8"));
const installedHash = manifestHashes[destPath];  // from install-manifest.json

if (installedHash && existingHash !== installedHash && existingHash !== newHash) {
  // User modified AND new content differs → skip, don't overwrite
  results.push({
    component: `behavioral:${asset.key}`,
    status: "skipped",
    message: "locally modified — use --force to overwrite",
  });
  continue;
}
```

Three-way comparison logic:
- `existingHash === installedHash` → file unchanged since install → safe to overwrite
- `existingHash === newHash` → file already matches new version → skip (no-op)
- `existingHash !== installedHash && existingHash !== newHash` → user modified → **skip with warning**

Hashes stored in `install-manifest.json` under a `fileHashes` key:

```json
{
  "rig": "clavain",
  "version": "0.4.31",
  "files": [".claude/rigs/clavain/CLAUDE.md"],
  "fileHashes": {
    ".claude/rigs/clavain/CLAUDE.md": "a1b2c3d4..."
  }
}
```

## Why This Works

1. **Tagged blocks are self-describing**: The begin/end tags include the rig name, so multiple rigs can coexist in the same shell profile without conflict. Regex replacement is reliable because the tags are unique.

2. **Hash comparison avoids false positives**: A simple "file exists" check would always warn on re-install. Hash comparison distinguishes "file exists but unchanged" (safe to overwrite) from "file exists and user edited it" (must preserve).

3. **No diff library needed**: For the "locally modified" case, we don't need to show a diff or attempt a merge — just skip and inform. The user can use `--force` to overwrite or manually merge. This keeps the tool simple without pulling in diff dependencies.

4. **State enables clean uninstall**: The `envProfilePath` in state and `fileHashes` in the manifest give uninstall everything it needs to reverse changes precisely.

## Prevention

- When a CLI tool writes to files the user may also edit, **always track what you wrote** (via hash, timestamp, or marker) so you can detect user modifications before overwriting
- For shell profile modifications, **always use tagged blocks** — never append bare lines. Tags make identification, replacement, and removal deterministic.
- Store the profile path in install state — don't re-detect on uninstall, since the user might have changed `$SHELL` since install
- For multi-shell support, detect once at install time and adapt syntax per shell rather than writing to all profiles

## Related Issues

- See also: [reversible-cli-install-with-mcp-config-agent-rig-20260211.md](reversible-cli-install-with-mcp-config-agent-rig-20260211.md) — P1 foundation (state tracking, MCP config)
- See also: [state-diff-incremental-update-agent-rig-20260211.md](state-diff-incremental-update-agent-rig-20260211.md) — P2 state-diff update pattern
