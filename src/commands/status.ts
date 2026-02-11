import chalk from "chalk";
import { loadState } from "../state.js";

export async function statusCommand() {
  const state = loadState();
  const rigs = Object.values(state.rigs);

  if (rigs.length === 0) {
    console.log(chalk.dim("\nNo rigs installed.\n"));
    return;
  }

  for (const rig of rigs) {
    console.log(chalk.bold(`\n${rig.name} v${rig.version}`));
    console.log(chalk.dim(`  Source: ${rig.source}`));
    console.log(chalk.dim(`  Installed: ${rig.installedAt}`));

    if (rig.plugins.length > 0) {
      console.log(`  ${chalk.green("Plugins:")} ${rig.plugins.length}`);
      for (const p of rig.plugins) {
        console.log(chalk.dim(`    ${p}`));
      }
    }
    if (rig.disabledConflicts.length > 0) {
      console.log(`  ${chalk.yellow("Disabled:")} ${rig.disabledConflicts.length}`);
      for (const c of rig.disabledConflicts) {
        console.log(chalk.dim(`    ${c}`));
      }
    }
    if (rig.mcpServers.length > 0) {
      console.log(`  ${chalk.cyan("MCP Servers:")} ${rig.mcpServers.length}`);
      for (const m of rig.mcpServers) {
        console.log(chalk.dim(`    ${m.name} (${m.type})`));
      }
    }
    if (rig.behavioral.length > 0) {
      console.log(`  ${chalk.blue("Behavioral:")} ${rig.behavioral.length}`);
      for (const b of rig.behavioral) {
        console.log(chalk.dim(`    ${b.file}`));
      }
    }
    if (rig.marketplaces.length > 0) {
      console.log(`  ${chalk.magenta("Marketplaces:")} ${rig.marketplaces.length}`);
      for (const m of rig.marketplaces) {
        console.log(chalk.dim(`    ${m}`));
      }
    }
  }
  console.log();
}
