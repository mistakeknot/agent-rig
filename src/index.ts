#!/usr/bin/env node
import { Command } from "commander";
import { installCommand } from "./commands/install.js";
import { validateCommand } from "./commands/validate.js";
import { inspectCommand } from "./commands/inspect.js";
import { initCommand } from "./commands/init.js";

const program = new Command();

program
  .name("agent-rig")
  .description("The modpack system for AI coding agents")
  .version("0.1.0");

program
  .command("install <source>")
  .description("Install an agent rig from a GitHub repo or local path")
  .option("--dry-run", "Show what would be installed without making changes")
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

program.parse();
