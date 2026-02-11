import chalk from "chalk";
import { createInterface } from "node:readline";
import { loadManifest, resolveSource } from "../loader.js";
import { cloneToLocal } from "../exec.js";
import { getRigState, setRigState } from "../state.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { CodexAdapter } from "../adapters/codex.js";
import type { InstallResult, PlatformAdapter } from "../adapters/types.js";
import type { AgentRig } from "../schema.js";
import type { RigState, InstalledMcpServer, InstalledBehavioral } from "../state.js";

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function printResults(section: string, results: InstallResult[]) {
  if (results.length === 0) return;
  console.log(`\n${chalk.bold(section)}`);
  for (const r of results) {
    const icon =
      r.status === "installed"
        ? chalk.green("OK")
        : r.status === "disabled"
          ? chalk.yellow("OFF")
          : r.status === "skipped"
            ? chalk.dim("SKIP")
            : chalk.red("FAIL");
    const msg = r.message ? chalk.dim(` — ${r.message}`) : "";
    console.log(`  ${icon}  ${r.component}${msg}`);
  }
}

// --- Diff computation ---

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

function getAllPluginSources(rig: AgentRig): string[] {
  return [
    ...(rig.plugins?.core ? [rig.plugins.core.source] : []),
    ...(rig.plugins?.required ?? []).map((p) => p.source),
    ...(rig.plugins?.recommended ?? []).map((p) => p.source),
    ...(rig.plugins?.infrastructure ?? []).map((p) => p.source),
  ];
}

function computeDiff(state: RigState, rig: AgentRig): RigDiff {
  const versionChange =
    state.version !== rig.version
      ? { from: state.version, to: rig.version }
      : null;

  const newPlugins = new Set(getAllPluginSources(rig));
  const oldPlugins = new Set(state.plugins);
  const pluginsAdded = [...newPlugins].filter((p) => !oldPlugins.has(p));
  const pluginsRemoved = [...oldPlugins].filter((p) => !newPlugins.has(p));

  const newConflicts = rig.plugins?.conflicts ?? [];
  const newConflictSources = new Set(newConflicts.map((c) => c.source));
  const oldConflictSources = new Set(state.disabledConflicts);
  const conflictsAdded = newConflicts.filter(
    (c) => !oldConflictSources.has(c.source),
  );
  const conflictsRemoved = [...oldConflictSources].filter(
    (c) => !newConflictSources.has(c),
  );

  const newMcp = new Set(Object.keys(rig.mcpServers ?? {}));
  const oldMcp = new Set(state.mcpServers.map((m) => m.name));
  const mcpAdded = [...newMcp].filter((m) => !oldMcp.has(m));
  const mcpRemoved = [...oldMcp].filter((m) => !newMcp.has(m));

  const hasChanges =
    versionChange !== null ||
    pluginsAdded.length > 0 ||
    pluginsRemoved.length > 0 ||
    conflictsAdded.length > 0 ||
    conflictsRemoved.length > 0 ||
    mcpAdded.length > 0 ||
    mcpRemoved.length > 0;

  return {
    versionChange,
    pluginsAdded,
    pluginsRemoved,
    conflictsAdded,
    conflictsRemoved,
    mcpAdded,
    mcpRemoved,
    hasChanges,
  };
}

function printDiff(diff: RigDiff) {
  console.log(chalk.bold("\nUpdate Plan:"));

  if (diff.versionChange) {
    console.log(
      `  ${chalk.cyan("Version")} ${diff.versionChange.from} → ${diff.versionChange.to}`,
    );
  }

  for (const p of diff.pluginsAdded) {
    console.log(`  ${chalk.green("+ Plugin")} ${p}`);
  }
  for (const p of diff.pluginsRemoved) {
    console.log(`  ${chalk.red("- Plugin")} ${p}`);
  }

  for (const c of diff.conflictsAdded) {
    console.log(
      `  ${chalk.yellow("+ Conflict")} ${c.source}${c.reason ? chalk.dim(` — ${c.reason}`) : ""}`,
    );
  }
  for (const c of diff.conflictsRemoved) {
    console.log(`  ${chalk.green("- Conflict")} ${c} (re-enabling)`);
  }

  for (const m of diff.mcpAdded) {
    console.log(`  ${chalk.cyan("+ MCP")} ${m}`);
  }
  for (const m of diff.mcpRemoved) {
    console.log(`  ${chalk.red("- MCP")} ${m}`);
  }
}

// --- Apply diff ---

async function applyDiff(
  diff: RigDiff,
  rig: AgentRig,
  state: RigState,
  adapters: PlatformAdapter[],
  rigDir: string,
): Promise<RigState> {
  const allResults: InstallResult[] = [];

  // Install new plugins
  if (diff.pluginsAdded.length > 0) {
    for (const adapter of adapters) {
      // Build a partial rig with only the new plugins for the adapter
      const partialRig = {
        ...rig,
        plugins: {
          ...rig.plugins,
          // Clear existing lists and only include new ones
          core: rig.plugins?.core && diff.pluginsAdded.includes(rig.plugins.core.source)
            ? rig.plugins.core
            : undefined,
          required: (rig.plugins?.required ?? []).filter((p) =>
            diff.pluginsAdded.includes(p.source),
          ),
          recommended: (rig.plugins?.recommended ?? []).filter((p) =>
            diff.pluginsAdded.includes(p.source),
          ),
          infrastructure: (rig.plugins?.infrastructure ?? []).filter((p) =>
            diff.pluginsAdded.includes(p.source),
          ),
          conflicts: [],
        },
      } as AgentRig;
      const results = await adapter.installPlugins(partialRig);
      printResults(`${adapter.name}: New Plugins`, results);
      allResults.push(...results);
    }
  }

  // Remove old plugins (uninstall via claude CLI)
  if (diff.pluginsRemoved.length > 0) {
    for (const plugin of diff.pluginsRemoved) {
      const { ok } = await run("claude", ["plugin", "uninstall", plugin]);
      const icon = ok ? chalk.green("OK") : chalk.dim("SKIP");
      console.log(`  ${icon}  uninstall plugin:${plugin}`);
    }
  }

  // Disable new conflicts
  if (diff.conflictsAdded.length > 0) {
    for (const adapter of adapters) {
      const partialRig = {
        ...rig,
        plugins: { ...rig.plugins, conflicts: diff.conflictsAdded },
      } as AgentRig;
      const results = await adapter.disableConflicts(partialRig);
      printResults(`${adapter.name}: New Conflicts`, results);
      allResults.push(...results);
    }
  }

  // Re-enable removed conflicts
  if (diff.conflictsRemoved.length > 0) {
    for (const conflict of diff.conflictsRemoved) {
      const { ok } = await run("claude", ["plugin", "enable", conflict]);
      const icon = ok ? chalk.green("OK") : chalk.dim("SKIP");
      console.log(`  ${icon}  re-enable:${conflict}`);
    }
  }

  // Install new MCP servers
  if (diff.mcpAdded.length > 0) {
    for (const adapter of adapters) {
      const partialMcp: AgentRig["mcpServers"] = {};
      for (const name of diff.mcpAdded) {
        if (rig.mcpServers?.[name]) {
          partialMcp[name] = rig.mcpServers[name];
        }
      }
      const partialRig = { ...rig, mcpServers: partialMcp } as AgentRig;
      const results = await adapter.installMcpServers(partialRig);
      printResults(`${adapter.name}: New MCP Servers`, results);
      allResults.push(...results);
    }
  }

  // Remove old MCP servers
  if (diff.mcpRemoved.length > 0) {
    for (const name of diff.mcpRemoved) {
      const { ok } = await run("claude", ["mcp", "remove", "--scope", "user", name]);
      const icon = ok ? chalk.green("OK") : chalk.dim("SKIP");
      console.log(`  ${icon}  remove mcp:${name}`);
    }
  }

  // Always re-install behavioral config on update (files may have changed)
  if (rig.behavioral) {
    for (const adapter of adapters) {
      const results = await adapter.installBehavioral(rig, rigDir);
      printResults(`${adapter.name}: Behavioral Config`, results);
      allResults.push(...results);
    }
  }

  // Build updated state
  const newPlugins = [
    ...state.plugins.filter((p) => !diff.pluginsRemoved.includes(p)),
    ...allResults
      .filter((r) => r.component.startsWith("plugin:") && r.status === "installed")
      .map((r) => r.component.replace("plugin:", "")),
  ];

  const newConflicts = [
    ...state.disabledConflicts.filter((c) => !diff.conflictsRemoved.includes(c)),
    ...allResults
      .filter((r) => r.component.startsWith("conflict:") && r.status === "disabled")
      .map((r) => r.component.replace("conflict:", "")),
  ];

  const newMcpServers: InstalledMcpServer[] = [
    ...state.mcpServers.filter((m) => !diff.mcpRemoved.includes(m.name)),
    ...allResults
      .filter((r) => r.component.startsWith("mcp:") && r.status === "installed")
      .map((r) => {
        const name = r.component.replace("mcp:", "");
        const server = rig.mcpServers?.[name];
        return { name, type: server?.type ?? "http" } as InstalledMcpServer;
      }),
  ];

  const newBehavioral: InstalledBehavioral[] = allResults
    .filter(
      (r) =>
        r.component.startsWith("behavioral:") &&
        r.status === "installed" &&
        !r.component.endsWith(":deps"),
    )
    .map((r) => {
      const key = r.component.replace("behavioral:", "") as "claude-md" | "agents-md";
      const filename = key === "claude-md" ? "CLAUDE.md" : "AGENTS.md";
      return {
        file: `.claude/rigs/${rig.name}/${filename}`,
        pointerFile: filename,
        pointerTag: `<!-- agent-rig:${rig.name} -->`,
      };
    });

  return {
    name: rig.name,
    version: rig.version,
    source: state.source,
    installedAt: new Date().toISOString(),
    plugins: [...new Set(newPlugins)],
    disabledConflicts: [...new Set(newConflicts)],
    mcpServers: newMcpServers,
    behavioral: newBehavioral.length > 0 ? newBehavioral : state.behavioral,
    marketplaces: state.marketplaces,
  };
}

import { execFileAsync } from "../exec.js";

async function run(
  cmd: string,
  args: string[],
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 30_000,
    });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, output: message };
  }
}

// --- Public commands ---

export async function updateCommand(
  name: string,
  opts: { dryRun?: boolean; yes?: boolean },
) {
  const state = getRigState(name);
  if (!state) {
    console.log(chalk.red(`\nRig "${name}" is not installed.\n`));
    console.log(chalk.dim("Run 'agent-rig status' to see installed rigs."));
    process.exit(1);
  }

  console.log(chalk.bold(`\nChecking for updates: ${state.name}\n`));
  console.log(chalk.dim(`Installed: v${state.version} from ${state.source}`));

  // Fetch latest manifest from original source
  const source = resolveSource(state.source);
  const dir = await cloneToLocal(source);
  const rig = await loadManifest(dir);

  console.log(chalk.dim(`Latest: v${rig.version}`));

  const diff = computeDiff(state, rig);

  if (!diff.hasChanges) {
    console.log(chalk.green("\nAlready up to date.\n"));
    return;
  }

  printDiff(diff);

  if (opts.dryRun) {
    console.log(chalk.yellow("\nDry run — no changes applied.\n"));
    return;
  }

  // Detect platforms
  const adapters: PlatformAdapter[] = [new ClaudeCodeAdapter(), new CodexAdapter()];
  const activeAdapters: PlatformAdapter[] = [];
  for (const adapter of adapters) {
    if (await adapter.detect()) activeAdapters.push(adapter);
  }

  if (activeAdapters.length === 0) {
    console.log(chalk.red("\nNo supported platforms detected."));
    process.exit(1);
  }

  if (!opts.yes) {
    const ok = await confirm("\nApply update?");
    if (!ok) {
      console.log(chalk.yellow("Aborted."));
      return;
    }
  }

  const newState = await applyDiff(diff, rig, state, activeAdapters, dir);
  setRigState(newState);

  console.log(
    chalk.bold.green(
      `\n${rig.name} updated to v${rig.version} successfully.\n`,
    ),
  );
  console.log(chalk.dim("State saved to ~/.agent-rig/state.json"));
  console.log("Restart your Claude Code session to apply changes.");
}

export async function outdatedCommand(name?: string) {
  const { loadState } = await import("../state.js");
  const state = loadState();

  const rigsToCheck = name
    ? { [name]: state.rigs[name] }
    : state.rigs;

  if (Object.keys(rigsToCheck).length === 0) {
    console.log(chalk.dim("\nNo rigs installed.\n"));
    return;
  }

  console.log(chalk.bold("\nChecking for updates...\n"));

  for (const [rigName, rigState] of Object.entries(rigsToCheck)) {
    if (!rigState) {
      console.log(chalk.red(`  Rig "${rigName}" not found.`));
      continue;
    }

    try {
      const source = resolveSource(rigState.source);
      const dir = await cloneToLocal(source);
      const rig = await loadManifest(dir);
      const diff = computeDiff(rigState, rig);

      if (!diff.hasChanges) {
        console.log(`  ${chalk.green("✓")} ${rigName} v${rigState.version} — up to date`);
      } else {
        console.log(
          `  ${chalk.yellow("↑")} ${rigName} v${rigState.version} → v${rig.version}`,
        );
        if (diff.pluginsAdded.length > 0) {
          console.log(chalk.dim(`    +${diff.pluginsAdded.length} plugins`));
        }
        if (diff.pluginsRemoved.length > 0) {
          console.log(chalk.dim(`    -${diff.pluginsRemoved.length} plugins`));
        }
        if (diff.mcpAdded.length > 0) {
          console.log(chalk.dim(`    +${diff.mcpAdded.length} MCP servers`));
        }
        if (diff.mcpRemoved.length > 0) {
          console.log(chalk.dim(`    -${diff.mcpRemoved.length} MCP servers`));
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ${chalk.red("✗")} ${rigName} — ${chalk.dim(message)}`);
    }
  }

  console.log();
}
