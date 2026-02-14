import chalk from "chalk";
import { createInterface } from "node:readline";
import { loadManifest } from "../loader.js";
import { resolveSource } from "../loader.js";
import { execFileAsync, spawnStreaming, cloneToLocal, cleanupCloneDir } from "../exec.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { CodexAdapter } from "../adapters/codex.js";
import { getRigState, setRigState } from "../state.js";
import { detectShell, hasEnvBlock, writeEnvBlock } from "../env.js";
import type { InstallResult, PlatformAdapter } from "../adapters/types.js";
import type { AgentRig } from "../schema.js";
import type { RigState, InstalledMcpServer, InstalledBehavioral } from "../state.js";

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

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function promptLine(message: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

type PluginRef = { source: string; description?: string; depends?: string[] };

/** Interactive multi-select for infrastructure plugins. Returns the selected subset. */
async function selectInfraPlugins(plugins: PluginRef[]): Promise<PluginRef[]> {
  if (plugins.length === 0) return [];

  console.log(chalk.bold("\nInfrastructure plugins (select which to install):"));
  for (let i = 0; i < plugins.length; i++) {
    const p = plugins[i];
    const name = p.source.split("@")[0];
    const desc = p.description ? chalk.dim(` — ${p.description}`) : "";
    console.log(`  ${chalk.cyan(String(i + 1))}. ${name}${desc}`);
  }
  console.log(chalk.dim(`\n  Enter numbers separated by commas (e.g. 1,3), "all", or "none":`));

  const answer = await promptLine("  > ");

  if (answer.toLowerCase() === "none" || answer === "") return [];
  if (answer.toLowerCase() === "all") return plugins;

  const indices = answer
    .split(",")
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((i) => i >= 0 && i < plugins.length);

  const selected = indices.map((i) => plugins[i]);
  if (selected.length === 0) {
    console.log(chalk.yellow("  No valid selections — skipping infrastructure plugins."));
  } else {
    console.log(chalk.green(`  Selected: ${selected.map((p) => p.source.split("@")[0]).join(", ")}`));
  }
  return selected;
}

function printInstallPlan(rig: AgentRig, activeAdapters: PlatformAdapter[], opts?: { includeOptional?: boolean }) {
  console.log(chalk.bold("\nInstall Plan:"));

  const plugins = [
    ...(rig.plugins?.core ? [rig.plugins.core] : []),
    ...(rig.plugins?.required ?? []),
    ...(rig.plugins?.recommended ?? []),
    ...(rig.plugins?.infrastructure ?? []),
  ];
  if (plugins.length > 0) {
    console.log(`  ${chalk.green("Install")} ${plugins.length} plugins`);
  }

  const conflicts = rig.plugins?.conflicts ?? [];
  if (conflicts.length > 0) {
    console.log(`  ${chalk.yellow("Disable")} ${conflicts.length} conflicting plugins`);
  }

  const mcpCount = Object.keys(rig.mcpServers ?? {}).length;
  if (mcpCount > 0) {
    console.log(`  ${chalk.cyan("Configure")} ${mcpCount} MCP servers`);
  }

  const tools = (rig.tools ?? []).filter((t) => !t.optional);
  const optTools = (rig.tools ?? []).filter((t) => t.optional);
  if (tools.length > 0) {
    console.log(`  ${chalk.magenta("Install")} ${tools.length} tools via shell commands:`);
    for (const t of tools) {
      console.log(chalk.dim(`    check: $ ${t.check}`));
      console.log(chalk.dim(`    install: $ ${t.install}`));
    }
  }
  if (optTools.length > 0) {
    if (opts?.includeOptional) {
      console.log(`  ${chalk.magenta("Install")} ${optTools.length} optional tools:`);
      for (const t of optTools) {
        console.log(chalk.dim(`    ${t.name}: $ ${t.install}`));
      }
    } else {
      console.log(`  ${chalk.dim("Optional")} ${optTools.length} tools (use --include-optional to install):`);
      for (const t of optTools) {
        console.log(chalk.dim(`    ${t.name}: $ ${t.install}`));
      }
    }
  }

  if (rig.behavioral) {
    const behavioralAssets: string[] = [];
    if (rig.behavioral["claude-md"]) behavioralAssets.push("CLAUDE.md");
    if (rig.behavioral["agents-md"]) behavioralAssets.push("AGENTS.md");
    if (behavioralAssets.length > 0) {
      console.log(
        `  ${chalk.blue("Behavioral")} ${behavioralAssets.join(", ")} → .claude/rigs/${rig.name}/`,
      );
    }
  }

  console.log(`  Platforms: ${activeAdapters.map((a) => a.name).join(", ")}`);
}

async function installTools(
  rig: AgentRig,
  opts: { includeOptional?: boolean },
): Promise<InstallResult[]> {
  const results: InstallResult[] = [];
  for (const tool of rig.tools ?? []) {
    // Check if already installed
    try {
      await execFileAsync("sh", ["-c", tool.check], { timeout: 5_000 });
      results.push({
        component: `tool:${tool.name}`,
        status: "skipped",
        message: "already installed",
      });
      continue;
    } catch {
      // Not installed
    }

    if (tool.optional && !opts.includeOptional) {
      results.push({
        component: `tool:${tool.name}`,
        status: "skipped",
        message: `optional — install manually: ${tool.install}`,
      });
      continue;
    }

    try {
      console.log(chalk.dim(`  Installing ${tool.name}...\n`));
      const { code } = await spawnStreaming(tool.install, { timeout: 120_000 });

      if (code !== 0) {
        results.push({
          component: `tool:${tool.name}`,
          status: "failed",
          message: `install command exited with code ${code}`,
        });
        continue;
      }

      // Post-install verification: re-run the check command
      try {
        await execFileAsync("sh", ["-c", tool.check], { timeout: 5_000 });
        results.push({ component: `tool:${tool.name}`, status: "installed" });
      } catch {
        results.push({
          component: `tool:${tool.name}`,
          status: "failed",
          message: "install command succeeded but tool not found on PATH",
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        component: `tool:${tool.name}`,
        status: "failed",
        message,
      });
    }
  }
  return results;
}

export async function installCommand(
  sourceArg: string,
  opts: { dryRun?: boolean; yes?: boolean; force?: boolean; minimal?: boolean; includeOptional?: boolean; interactive?: boolean },
) {
  console.log(chalk.bold(`\nAgent Rig Installer\n`));

  const source = resolveSource(sourceArg);
  const dir = await cloneToLocal(source);
  try {
    const rig = await loadManifest(dir);
    if (opts.minimal) {
      console.log(chalk.yellow("Minimal mode: installing core + required only.\n"));
      if (rig.plugins) {
        rig.plugins.recommended = [];
        rig.plugins.infrastructure = [];
      }
    }
    if (opts.interactive && !opts.minimal && !opts.dryRun && rig.plugins?.infrastructure?.length) {
      rig.plugins.infrastructure = await selectInfraPlugins(rig.plugins.infrastructure);
    }
  console.log(
    `Installing ${chalk.cyan(rig.name)} v${rig.version}` +
      (rig.description ? chalk.dim(` — ${rig.description}`) : ""),
  );

  // Idempotency: check if already installed
  const existing = getRigState(rig.name);
  if (existing && !opts.force && !opts.dryRun) {
    if (existing.version === rig.version) {
      console.log(
        chalk.green(`\n${rig.name} v${rig.version} is already installed.\n`),
      );
      console.log(chalk.dim("Use --force to re-apply, or 'agent-rig update' if a newer version is available."));
      return;
    }

    // Different version — suggest update
    console.log(
      chalk.yellow(
        `\n${rig.name} v${existing.version} is already installed. ` +
          `New version: v${rig.version}.`,
      ),
    );
    console.log(chalk.dim("Use 'agent-rig update' to apply changes incrementally, or --force to re-install from scratch."));
    return;
  }

  if (opts.dryRun) {
    console.log(chalk.yellow("\nDry run — no changes will be made.\n"));

    // Detect platforms for plan display
    const dryAdapters: PlatformAdapter[] = [
      new ClaudeCodeAdapter(),
      new CodexAdapter(),
    ];
    const dryActive: PlatformAdapter[] = [];
    for (const adapter of dryAdapters) {
      if (await adapter.detect()) dryActive.push(adapter);
    }
    printInstallPlan(rig, dryActive.length > 0 ? dryActive : dryAdapters, { includeOptional: opts.includeOptional });

    console.log(chalk.dim("\nFull manifest:"));
    console.log(JSON.stringify(rig, null, 2));
    return;
  }

  const adapters: PlatformAdapter[] = [
    new ClaudeCodeAdapter(),
    new CodexAdapter(),
  ];
  const activeAdapters: PlatformAdapter[] = [];

  for (const adapter of adapters) {
    if (await adapter.detect()) {
      activeAdapters.push(adapter);
      console.log(chalk.green(`  Detected: ${adapter.name}`));
    } else {
      console.log(chalk.dim(`  Not found: ${adapter.name}`));
    }
  }

  if (activeAdapters.length === 0) {
    console.log(
      chalk.red(
        "\nNo supported platforms detected. Install Claude Code or Codex CLI first.",
      ),
    );
    process.exit(1);
  }

  // Pre-flight conflict scan
  for (const adapter of activeAdapters) {
    const warnings = await adapter.checkConflicts(rig);
    if (warnings.length > 0) {
      console.log(chalk.bold.yellow(`\n⚠ Potential conflicts (${adapter.name}):`));
      for (const w of warnings) {
        console.log(
          `  ${chalk.yellow("!")}  ${w.installedPlugin} ↔ ${w.conflictsWith}` +
            (w.reason ? chalk.dim(` — ${w.reason}`) : ""),
        );
      }
      console.log(
        chalk.dim("  These will be disabled during install if declared in the rig manifest."),
      );
    }
  }

  // Show install plan and require confirmation
  printInstallPlan(rig, activeAdapters, { includeOptional: opts.includeOptional });

  if (!opts.yes) {
    const ok = await confirm("\nProceed with installation?");
    if (!ok) {
      console.log(chalk.yellow("Aborted."));
      return;
    }
  }

  // Collect all results for state tracking
  const allPluginResults: InstallResult[] = [];
  const allConflictResults: InstallResult[] = [];
  const allMcpResults: InstallResult[] = [];
  const allBehavioralResults: InstallResult[] = [];
  const allMarketplaceResults: InstallResult[] = [];

  for (const adapter of activeAdapters) {
    console.log(chalk.bold(`\n--- ${adapter.name} ---`));

    const mpResults = await adapter.addMarketplaces(rig);
    printResults("Marketplaces", mpResults);
    allMarketplaceResults.push(...mpResults);

    const pluginResults = await adapter.installPlugins(rig);
    printResults("Plugins", pluginResults);
    allPluginResults.push(...pluginResults);

    const conflictResults = await adapter.disableConflicts(rig);
    printResults("Conflicts Disabled", conflictResults);
    allConflictResults.push(...conflictResults);

    const mcpResults = await adapter.installMcpServers(rig);
    printResults("MCP Servers", mcpResults);
    allMcpResults.push(...mcpResults);

    if (rig.behavioral) {
      const behavioralResults = await adapter.installBehavioral(rig, dir);
      printResults("Behavioral Config", behavioralResults);
      allBehavioralResults.push(...behavioralResults);
    }
  }

  const toolResults = await installTools(rig, { includeOptional: opts.includeOptional });
  printResults("External Tools", toolResults);

  // Write environment variables to shell profile
  let envProfilePath: string | undefined;
  if (rig.environment && Object.keys(rig.environment).length > 0) {
    const shell = detectShell();
    console.log(chalk.bold("\nEnvironment Variables"));

    if (hasEnvBlock(rig.name, shell.profilePath)) {
      console.log(chalk.dim(`  Updating existing block in ${shell.profilePath}`));
      writeEnvBlock(rig.name, rig.environment, shell);
      envProfilePath = shell.profilePath;
      for (const [key, value] of Object.entries(rig.environment)) {
        console.log(`  ${chalk.green("OK")}  ${key}="${value}"`);
      }
    } else {
      console.log(`  Writing to ${chalk.cyan(shell.profilePath)} (${shell.name}):`);
      for (const [key, value] of Object.entries(rig.environment)) {
        console.log(`  ${chalk.green("+")}  ${key}="${value}"`);
      }
      writeEnvBlock(rig.name, rig.environment, shell);
      envProfilePath = shell.profilePath;
    }
  }

  // Save installed state
  const installedPlugins = allPluginResults
    .filter((r) => r.status === "installed")
    .map((r) => r.component.replace("plugin:", ""));
  const disabledConflicts = allConflictResults
    .filter((r) => r.status === "disabled")
    .map((r) => r.component.replace("conflict:", ""));
  const installedMcp: InstalledMcpServer[] = allMcpResults
    .filter((r) => r.status === "installed")
    .map((r) => {
      const name = r.component.replace("mcp:", "");
      const server = rig.mcpServers?.[name];
      return { name, type: server?.type ?? "http" } as InstalledMcpServer;
    });
  const installedBehavioral: InstalledBehavioral[] = allBehavioralResults
    .filter((r) => r.status === "installed" && !r.component.endsWith(":deps"))
    .map((r) => {
      const key = r.component.replace("behavioral:", "") as "claude-md" | "agents-md";
      const filename = key === "claude-md" ? "CLAUDE.md" : "AGENTS.md";
      return {
        file: `.claude/rigs/${rig.name}/${filename}`,
        pointerFile: filename,
        pointerTag: `<!-- agent-rig:${rig.name} -->`,
      };
    });
  const installedMarketplaces = allMarketplaceResults
    .filter((r) => r.status === "installed")
    .map((r) => r.component.replace("marketplace:", ""));

  const rigState: RigState = {
    name: rig.name,
    version: rig.version,
    source: sourceArg,
    installedAt: new Date().toISOString(),
    plugins: installedPlugins,
    disabledConflicts,
    mcpServers: installedMcp,
    behavioral: installedBehavioral,
    marketplaces: installedMarketplaces,
    envProfilePath,
  };
  setRigState(rigState);

  console.log(chalk.bold("\n--- Verification ---"));
  for (const adapter of activeAdapters) {
    const verifyResults = await adapter.verify(rig);
    printResults(`${adapter.name} Health`, verifyResults);
  }

  console.log(
    chalk.bold.green(`\n${rig.name} v${rig.version} installed successfully.\n`),
  );
  console.log(chalk.dim("State saved to ~/.agent-rig/state.json"));
  console.log("Restart your Claude Code session to activate all changes.");
  } finally {
    await cleanupCloneDir(dir, source);
  }
}
