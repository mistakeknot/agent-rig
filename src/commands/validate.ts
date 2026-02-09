import chalk from "chalk";
import { loadManifest } from "../loader.js";

export async function validateCommand(dir: string) {
  console.log(chalk.bold(`Validating agent-rig.json in ${dir}\n`));

  try {
    const rig = await loadManifest(dir);
    console.log(chalk.green("Valid!"));
    console.log(`  Name:        ${rig.name}`);
    console.log(`  Version:     ${rig.version}`);
    console.log(`  Description: ${rig.description}`);
    console.log(`  Author:      ${rig.author}`);

    if (rig.plugins) {
      const counts = {
        core: rig.plugins.core ? 1 : 0,
        required: rig.plugins.required?.length ?? 0,
        recommended: rig.plugins.recommended?.length ?? 0,
        infrastructure: rig.plugins.infrastructure?.length ?? 0,
        conflicts: rig.plugins.conflicts?.length ?? 0,
      };
      console.log(
        `  Plugins:     ${counts.core} core, ${counts.required} required, ${counts.recommended} recommended, ${counts.infrastructure} infrastructure`,
      );
      console.log(`  Conflicts:   ${counts.conflicts}`);
    }

    if (rig.mcpServers) {
      console.log(
        `  MCP Servers: ${Object.keys(rig.mcpServers).join(", ")}`,
      );
    }

    if (rig.tools) {
      console.log(
        `  Tools:       ${rig.tools.map((t) => t.name).join(", ")}`,
      );
    }

    if (rig.extends) {
      console.log(
        chalk.yellow(`  Extends:     ${rig.extends} (not resolved in v1)`),
      );
    }
  } catch (err: any) {
    console.log(chalk.red("Invalid!"));
    console.log(err.message);
    process.exit(1);
  }
}
