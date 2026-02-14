#!/usr/bin/env node
import { Command } from "commander";
import { installCommand } from "./commands/install.js";
import { validateCommand } from "./commands/validate.js";
import { inspectCommand } from "./commands/inspect.js";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { uninstallCommand } from "./commands/uninstall.js";
import { updateCommand, outdatedCommand } from "./commands/update.js";
import { upstreamCheckCommand } from "./commands/upstream.js";

const program = new Command();

program
  .name("agent-rig")
  .description("The rig manager for AI coding agents")
  .version("0.1.0");

program
  .command("install <source>")
  .description("Install an agent rig from a GitHub repo or local path")
  .option("--dry-run", "Show what would be installed without making changes")
  .option("--force", "Re-install even if already installed")
  .option(
    "--minimal",
    "Install only core and required plugins, skip recommended and infrastructure",
  )
  .option(
    "--include-optional",
    "Attempt to install optional tools instead of skipping them",
  )
  .option("-y, --yes", "Skip confirmation prompt")
  .action(installCommand);

program
  .command("validate [dir]")
  .description("Validate an agent-rig.json manifest")
  .action((dir) => validateCommand(dir ?? "."));

program
  .command("inspect <source>")
  .description(
    "Inspect a rig's contents without installing (review before adopting)",
  )
  .option("--json", "Output raw manifest as JSON")
  .action(inspectCommand);

program
  .command("init [dir]")
  .description("Create a new agent-rig.json manifest")
  .action((dir) => initCommand(dir ?? "."));

program
  .command("status")
  .description("Show installed rigs and their components")
  .action(statusCommand);

program
  .command("uninstall <name>")
  .description("Uninstall a rig and reverse its changes")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(uninstallCommand);

program
  .command("update <name>")
  .description("Update an installed rig to the latest version")
  .option("--dry-run", "Show what would change without applying")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(updateCommand);

program
  .command("outdated [name]")
  .description("Check if installed rigs have newer versions available")
  .action(outdatedCommand);

program
  .command("upstream <source>")
  .description("Check a rig's dependencies against upstream marketplace versions")
  .action(upstreamCheckCommand);

program.parse();
