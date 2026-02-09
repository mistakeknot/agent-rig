import chalk from "chalk";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { loadManifest } from "../loader.js";
import { resolveSource, type RigSource } from "../loader.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { CodexAdapter } from "../adapters/codex.js";
import type { InstallResult, PlatformAdapter } from "../adapters/types.js";
import type { AgentRig } from "../schema.js";

const execFileAsync = promisify(execFile);

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

async function cloneToLocal(source: RigSource): Promise<string> {
  if (source.type === "local") return source.path;

  const dest = join(tmpdir(), `agent-rig-${source.repo}-${Date.now()}`);
  console.log(chalk.dim(`Cloning ${source.url}...`));
  await execFileAsync("git", ["clone", "--depth", "1", source.url, dest], {
    timeout: 60_000,
  });
  return dest;
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
    } catch (err: any) {
      results.push({
        component: `tool:${tool.name}`,
        status: "failed",
        message: err.message,
      });
    }
  }
  return results;
}

export async function installCommand(
  sourceArg: string,
  opts: { dryRun?: boolean },
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

  for (const adapter of activeAdapters) {
    console.log(chalk.bold(`\n--- ${adapter.name} ---`));

    const mpResults = await adapter.addMarketplaces(rig);
    printResults("Marketplaces", mpResults);

    const pluginResults = await adapter.installPlugins(rig);
    printResults("Plugins", pluginResults);

    const conflictResults = await adapter.disableConflicts(rig);
    printResults("Conflicts Disabled", conflictResults);
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
