import chalk from "chalk";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadManifest } from "../loader.js";
import { resolveSource } from "../loader.js";

const execFileAsync = promisify(execFile);

export async function inspectCommand(
  sourceArg: string,
  opts: { json?: boolean },
) {
  const source = resolveSource(sourceArg);

  let dir: string;
  if (source.type === "local") {
    dir = source.path;
  } else {
    dir = join(
      tmpdir(),
      `agent-rig-inspect-${source.repo}-${Date.now()}`,
    );
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", source.url, dir],
      { timeout: 60_000 },
    );
  }

  const rig = await loadManifest(dir);

  if (opts.json) {
    console.log(JSON.stringify(rig, null, 2));
    return;
  }

  console.log(chalk.bold(`\n${rig.name} v${rig.version}`));
  console.log(chalk.dim(rig.description));
  console.log(
    `Author: ${rig.author}${rig.license ? ` | License: ${rig.license}` : ""}`,
  );
  if (rig.repository)
    console.log(`Repo: https://github.com/${rig.repository}`);

  if (rig.plugins) {
    console.log(chalk.bold("\nPlugins"));
    if (rig.plugins.core) {
      console.log(`  ${chalk.cyan("core")}  ${rig.plugins.core.source}`);
    }
    for (const p of rig.plugins.required ?? []) {
      console.log(
        `  ${chalk.green("req")}   ${p.source}${p.description ? chalk.dim(` — ${p.description}`) : ""}`,
      );
    }
    for (const p of rig.plugins.recommended ?? []) {
      console.log(
        `  ${chalk.yellow("rec")}   ${p.source}${p.description ? chalk.dim(` — ${p.description}`) : ""}`,
      );
    }
    for (const p of rig.plugins.infrastructure ?? []) {
      console.log(
        `  ${chalk.blue("infra")} ${p.source}${p.description ? chalk.dim(` — ${p.description}`) : ""}`,
      );
    }
    if (rig.plugins.conflicts?.length) {
      console.log(chalk.bold("\nConflicts (will be disabled)"));
      for (const c of rig.plugins.conflicts) {
        console.log(
          `  ${chalk.red("off")}   ${c.source}${c.reason ? chalk.dim(` — ${c.reason}`) : ""}`,
        );
      }
    }
  }

  if (rig.mcpServers) {
    console.log(chalk.bold("\nMCP Servers"));
    for (const [name, server] of Object.entries(rig.mcpServers)) {
      const detail =
        server.type === "http"
          ? server.url
          : server.type === "stdio"
            ? server.command
            : server.url;
      console.log(`  ${chalk.cyan(name)}  ${server.type}  ${detail}`);
    }
  }

  if (rig.tools?.length) {
    console.log(chalk.bold("\nExternal Tools"));
    for (const t of rig.tools) {
      const opt = t.optional ? chalk.dim(" (optional)") : "";
      console.log(
        `  ${t.name}${opt}${t.description ? chalk.dim(` — ${t.description}`) : ""}`,
      );
    }
  }

  if (rig.environment && Object.keys(rig.environment).length > 0) {
    console.log(chalk.bold("\nEnvironment Variables"));
    for (const [k, v] of Object.entries(rig.environment)) {
      console.log(`  ${k}=${v}`);
    }
  }

  console.log();
}
