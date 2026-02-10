import chalk from "chalk";
import { createInterface } from "node:readline";
import { loadManifest } from "../loader.js";
import { resolveSource } from "../loader.js";
import { execFileAsync, cloneToLocal } from "../exec.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { CodexAdapter } from "../adapters/codex.js";
import type { InstallResult, PlatformAdapter } from "../adapters/types.js";
import type { AgentRig } from "../schema.js";

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

function printInstallPlan(rig: AgentRig, activeAdapters: PlatformAdapter[]) {
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
    console.log(`  ${chalk.dim("Skip")} ${optTools.length} optional tools (check commands):`);
    for (const t of optTools) {
      console.log(chalk.dim(`    check: $ ${t.check}`));
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

async function installTools(rig: AgentRig): Promise<InstallResult[]> {
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

    if (tool.optional) {
      results.push({
        component: `tool:${tool.name}`,
        status: "skipped",
        message: "optional — install manually",
      });
      continue;
    }

    try {
      await execFileAsync("sh", ["-c", tool.install], { timeout: 120_000 });
      results.push({ component: `tool:${tool.name}`, status: "installed" });
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
  opts: { dryRun?: boolean; yes?: boolean },
) {
  console.log(chalk.bold(`\nAgent Rig Installer\n`));

  const source = resolveSource(sourceArg);
  const dir = await cloneToLocal(source);

  const rig = await loadManifest(dir);
  console.log(
    `Installing ${chalk.cyan(rig.name)} v${rig.version}` +
      (rig.description ? chalk.dim(` — ${rig.description}`) : ""),
  );

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
    printInstallPlan(rig, dryActive.length > 0 ? dryActive : dryAdapters);

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

  // Show install plan and require confirmation
  printInstallPlan(rig, activeAdapters);

  if (!opts.yes) {
    const ok = await confirm("\nProceed with installation?");
    if (!ok) {
      console.log(chalk.yellow("Aborted."));
      return;
    }
  }

  for (const adapter of activeAdapters) {
    console.log(chalk.bold(`\n--- ${adapter.name} ---`));

    const mpResults = await adapter.addMarketplaces(rig);
    printResults("Marketplaces", mpResults);

    const pluginResults = await adapter.installPlugins(rig);
    printResults("Plugins", pluginResults);

    const conflictResults = await adapter.disableConflicts(rig);
    printResults("Conflicts Disabled", conflictResults);

    if (rig.behavioral) {
      const behavioralResults = await adapter.installBehavioral(rig, dir);
      printResults("Behavioral Config", behavioralResults);
    }
  }

  const toolResults = await installTools(rig);
  printResults("External Tools", toolResults);

  if (rig.environment && Object.keys(rig.environment).length > 0) {
    console.log(chalk.bold("\nEnvironment Variables"));
    console.log(chalk.dim("  Add these to your shell profile:"));
    for (const [key, value] of Object.entries(rig.environment)) {
      console.log(`  export ${key}="${value}"`);
    }
  }

  console.log(chalk.bold("\n--- Verification ---"));
  for (const adapter of activeAdapters) {
    const verifyResults = await adapter.verify(rig);
    printResults(`${adapter.name} Health`, verifyResults);
  }

  console.log(
    chalk.bold.green(`\n${rig.name} v${rig.version} installed successfully.\n`),
  );
  console.log("Restart your Claude Code session to activate all changes.");
}
