import chalk from "chalk";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, unlinkSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getRigState, removeRigState } from "../state.js";
import { execFileAsync } from "../exec.js";
import { removeEnvBlock } from "../env.js";

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

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function uninstallCommand(
  name: string,
  opts: { yes?: boolean },
) {
  const state = getRigState(name);
  if (!state) {
    console.log(chalk.red(`\nRig "${name}" is not installed.\n`));
    console.log(chalk.dim("Run 'agent-rig status' to see installed rigs."));
    process.exit(1);
  }

  console.log(chalk.bold(`\nUninstall ${state.name} v${state.version}\n`));
  console.log(chalk.dim(`Installed: ${state.installedAt}`));

  // Show what will be removed
  console.log(chalk.bold("\nWill remove:"));
  if (state.plugins.length > 0) {
    console.log(`  ${chalk.red("Uninstall")} ${state.plugins.length} plugins`);
  }
  if (state.disabledConflicts.length > 0) {
    console.log(`  ${chalk.green("Re-enable")} ${state.disabledConflicts.length} conflicts`);
  }
  if (state.mcpServers.length > 0) {
    console.log(`  ${chalk.red("Remove")} ${state.mcpServers.length} MCP servers`);
  }
  if (state.behavioral.length > 0) {
    console.log(`  ${chalk.red("Remove")} ${state.behavioral.length} behavioral files`);
  }
  if (state.envProfilePath) {
    console.log(`  ${chalk.red("Remove")} env vars from ${state.envProfilePath}`);
  }

  if (!opts.yes) {
    const ok = await confirm("\nProceed with uninstall?");
    if (!ok) {
      console.log(chalk.yellow("Aborted."));
      return;
    }
  }

  // Uninstall plugins
  for (const plugin of state.plugins) {
    const { ok } = await run("claude", ["plugin", "uninstall", plugin]);
    const icon = ok ? chalk.green("OK") : chalk.red("FAIL");
    console.log(`  ${icon}  plugin:${plugin}`);
  }

  // Re-enable conflicts
  for (const conflict of state.disabledConflicts) {
    const { ok } = await run("claude", ["plugin", "enable", conflict]);
    const icon = ok ? chalk.green("OK") : chalk.dim("SKIP");
    console.log(`  ${icon}  re-enable:${conflict}`);
  }

  // Remove MCP servers
  for (const server of state.mcpServers) {
    const { ok } = await run("claude", ["mcp", "remove", "--scope", "user", server.name]);
    const icon = ok ? chalk.green("OK") : chalk.dim("SKIP");
    console.log(`  ${icon}  mcp:${server.name}`);
  }

  // Remove behavioral files and pointers
  for (const behavioral of state.behavioral) {
    // Remove the installed file
    if (existsSync(behavioral.file)) {
      unlinkSync(behavioral.file);
      console.log(`  ${chalk.green("OK")}  removed ${behavioral.file}`);
    }

    // Remove pointer from root file
    if (existsSync(behavioral.pointerFile)) {
      const content = readFileSync(behavioral.pointerFile, "utf-8");
      if (content.includes(behavioral.pointerTag)) {
        const lines = content.split("\n");
        const filtered = lines.filter((line) => !line.includes(behavioral.pointerTag));
        // Clean up extra blank line left by pointer removal
        const cleaned = filtered.join("\n").replace(/^\n+/, "");
        writeFileSync(behavioral.pointerFile, cleaned, "utf-8");
        console.log(`  ${chalk.green("OK")}  removed pointer from ${behavioral.pointerFile}`);
      }
    }
  }

  // Remove env vars from shell profile
  if (state.envProfilePath) {
    const removed = removeEnvBlock(name, state.envProfilePath);
    const icon = removed ? chalk.green("OK") : chalk.dim("SKIP");
    console.log(`  ${icon}  env vars from ${state.envProfilePath}`);
  }

  // Clean up rig directory
  const rigsDir = join(".claude", "rigs", name);
  if (existsSync(rigsDir)) {
    rmSync(rigsDir, { recursive: true });
    console.log(`  ${chalk.green("OK")}  removed ${rigsDir}/`);
  }

  // Remove state
  removeRigState(name);

  console.log(
    chalk.bold.green(`\n${name} uninstalled successfully.\n`),
  );
  console.log("Restart your Claude Code session to apply changes.");
}
