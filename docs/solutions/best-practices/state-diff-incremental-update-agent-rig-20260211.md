---
module: agent-rig
date: 2026-02-11
problem_type: best_practice
component: cli
symptoms:
  - "No way to update an installed rig without full re-install"
  - "Re-running install duplicates work or silently overwrites state"
  - "Plugins with dependencies installed in wrong order"
root_cause: missing_tooling
resolution_type: tooling_addition
severity: medium
tags: [state-diff, incremental-update, topological-sort, idempotent-install, dependency-ordering, cli-lifecycle]
---

# Best Practice: State-Diff Incremental Updates with Dependency Ordering

## Problem

After implementing install/uninstall with state tracking (P1), the rig manager still lacked lifecycle management: no way to update to a newer version without a full uninstall+reinstall, no idempotency on re-install, and no awareness of plugin dependency ordering.

## Environment
- Module: agent-rig (rig manager for AI coding agents)
- Framework Version: 0.1.0
- Affected Component: CLI update/install pipeline, plugin installation ordering
- Date: 2026-02-11

## Symptoms
- Running `agent-rig install` on an already-installed rig would blindly re-apply everything
- No `agent-rig update` command — users had to uninstall + reinstall to get new versions
- Plugins with `depends` fields were installed in arbitrary order, potentially before their dependencies

## What Didn't Work

**Attempted approach 1:** Full re-install as "update"
- **Why it failed:** Uninstall + reinstall loses the install timestamp, re-enables conflicts unnecessarily, and triggers churn in the Claude Code session. It's also slow — every plugin gets re-installed even if nothing changed.

**Attempted approach 2:** Version-only comparison for idempotency
- **Why it's insufficient:** Same version doesn't mean same content — the rig author may have added/removed plugins at the same version. A proper diff must compare the full manifest against installed state.

## Solution

### 1. State-Diff Computation

The key insight: **compute a diff between persisted install state and the new manifest**, then apply only the delta.

```typescript
interface RigDiff {
  versionChange: { from: string; to: string } | null;
  pluginsAdded: string[];
  pluginsRemoved: string[];
  conflictsAdded: Array<{ source: string; reason?: string }>;
  conflictsRemoved: string[];
  mcpAdded: string[];
  mcpRemoved: string[];
  hasChanges: boolean;
}

function computeDiff(state: RigState, rig: AgentRig): RigDiff {
  const newPlugins = new Set(getAllPluginSources(rig));
  const oldPlugins = new Set(state.plugins);
  const pluginsAdded = [...newPlugins].filter((p) => !oldPlugins.has(p));
  const pluginsRemoved = [...oldPlugins].filter((p) => !newPlugins.has(p));
  // ... same pattern for conflicts and MCP servers
}
```

The diff drives three operations:
- **Add**: Install new plugins, disable new conflicts, configure new MCP servers
- **Remove**: Uninstall removed plugins, re-enable removed conflicts, remove MCP servers
- **Refresh**: Always re-install behavioral config (file content may have changed even if name didn't)

### 2. Idempotent Install Gate

Install now checks state before proceeding:

```typescript
const existing = getRigState(rig.name);
if (existing && !opts.force && !opts.dryRun) {
  if (existing.version === rig.version) {
    // Same version → no-op, suggest --force
    return;
  }
  // Different version → suggest `agent-rig update`
  return;
}
```

Three paths:
- **Not installed** → normal install flow
- **Same version** → "already installed" + suggest `--force`
- **Different version** → suggest `update` for incremental changes

### 3. Topological Dependency Sorting

Plugins can declare `depends: ["other-plugin@marketplace"]`. Before install, plugins are topologically sorted so dependencies come first:

```typescript
type PluginEntry = { source: string; depends?: string[] };

function topoSortPlugins(plugins: PluginEntry[]): PluginEntry[] {
  const bySource = new Map(plugins.map((p) => [p.source, p]));
  const visited = new Set<string>();
  const ordered: PluginEntry[] = [];

  function visit(source: string) {
    if (visited.has(source)) return;
    visited.add(source);
    const plugin = bySource.get(source);
    if (!plugin) return;
    for (const dep of plugin.depends ?? []) {
      visit(dep);
    }
    ordered.push(plugin);
  }

  for (const plugin of plugins) visit(plugin.source);
  return ordered;
}
```

The `visited` set naturally handles cycles (falls back to original order) and the DFS ensures dependencies are added to `ordered` before dependents.

## Why This Works

1. **Diff minimizes churn:** Only changed components are touched. A rig that added one plugin doesn't re-install 15 existing ones.

2. **State as source of truth:** The diff compares against what was *actually installed* (from state.json), not what the previous manifest *declared*. This handles partial installs correctly — if a plugin failed to install last time, it's not in state, so the diff will try again.

3. **Topological sort is safe:** If a plugin declares a dependency that isn't in the rig's plugin list, the sort simply skips it (the `bySource` map lookup returns undefined). No crashes on missing external deps.

4. **Three-tier update strategy:**
   - `install` — first-time setup (idempotent gate prevents double-install)
   - `update` — incremental diff-and-apply
   - `outdated` — read-only version check across all rigs

## Prevention

- When building CLI tools with persistent state, implement **diff-based updates from day one** — bolting them on later requires reconciling two different state representations
- For dependency ordering, a simple DFS topological sort is sufficient for acyclic plugin graphs — don't over-engineer with cycle detection unless the domain actually has cycles
- Gate install commands with state checks early — the cost of a state lookup is negligible compared to the cost of re-running a full install
- Record install state as **what changed** (filtered results), not **what was planned** (full manifest) — this makes diffs accurate even after partial failures

## Related Issues

- See also: [reversible-cli-install-with-mcp-config-agent-rig-20260211.md](reversible-cli-install-with-mcp-config-agent-rig-20260211.md) — P1 foundation (state tracking, MCP config, uninstall)
- See also: [tagged-block-env-and-hash-based-merge-agent-rig-20260211.md](tagged-block-env-and-hash-based-merge-agent-rig-20260211.md) — P3 safe file management (shell profiles, modification detection)
