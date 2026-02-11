import chalk from "chalk";
import { loadManifest, resolveSource } from "../loader.js";
import { cloneToLocal, execFileAsync } from "../exec.js";
import type { AgentRig } from "../schema.js";

/**
 * For each marketplace declared in the rig, clone it and scan for plugin manifests.
 * Returns a map of plugin source → { version, description } from the marketplace.
 */
async function fetchMarketplaceVersions(
  rig: AgentRig,
): Promise<Map<string, { version: string; description: string }>> {
  const versions = new Map<string, { version: string; description: string }>();

  const marketplaces = rig.platforms?.["claude-code"]?.marketplaces ?? [];
  for (const mp of marketplaces) {
    try {
      const source = resolveSource(mp.repo);
      const dir = await cloneToLocal(source);

      // Scan for marketplace.json (the standard marketplace index)
      const { stdout } = await execFileAsync("find", [dir, "-name", "marketplace.json", "-maxdepth", "2"], {
        timeout: 10_000,
      });

      for (const indexPath of stdout.trim().split("\n").filter(Boolean)) {
        try {
          const { readFileSync } = await import("node:fs");
          const raw = JSON.parse(readFileSync(indexPath, "utf-8"));
          // marketplace.json can be a single entry or array
          const entries = Array.isArray(raw) ? raw : [raw];
          for (const entry of entries) {
            if (entry.name && entry.version) {
              const source = `${entry.name}@${mp.name}`;
              versions.set(source, {
                version: entry.version,
                description: entry.description ?? "",
              });
            }
          }
        } catch {
          // Skip unparseable files
        }
      }

      // Also scan for plugin.json files (in case marketplace has plugin dirs)
      const { stdout: pluginStdout } = await execFileAsync(
        "find", [dir, "-name", "plugin.json", "-path", "*/.claude-plugin/*", "-maxdepth", "3"],
        { timeout: 10_000 },
      );

      for (const pluginPath of pluginStdout.trim().split("\n").filter(Boolean)) {
        try {
          const { readFileSync } = await import("node:fs");
          const raw = JSON.parse(readFileSync(pluginPath, "utf-8"));
          if (raw.name && raw.version) {
            const source = `${raw.name}@${mp.name}`;
            if (!versions.has(source)) {
              versions.set(source, {
                version: raw.version,
                description: raw.description ?? "",
              });
            }
          }
        } catch {
          // Skip
        }
      }
    } catch (err) {
      console.log(
        chalk.dim(`  Could not fetch marketplace ${mp.name}: ${err instanceof Error ? err.message : err}`),
      );
    }
  }

  return versions;
}

function getAllPlugins(rig: AgentRig): Array<{ source: string; description?: string }> {
  return [
    ...(rig.plugins?.core ? [rig.plugins.core] : []),
    ...(rig.plugins?.required ?? []),
    ...(rig.plugins?.recommended ?? []),
    ...(rig.plugins?.infrastructure ?? []),
  ];
}

export async function upstreamCheckCommand(
  sourceArg: string,
  _opts: Record<string, unknown>,
) {
  console.log(chalk.bold("\nUpstream Check\n"));

  const source = resolveSource(sourceArg);
  const dir = await cloneToLocal(source);
  const rig = await loadManifest(dir);

  console.log(`Rig: ${chalk.cyan(rig.name)} v${rig.version}`);
  console.log(chalk.dim("Scanning marketplaces for upstream changes...\n"));

  const marketplaceVersions = await fetchMarketplaceVersions(rig);

  if (marketplaceVersions.size === 0) {
    console.log(chalk.dim("No marketplace data found. Cannot check upstream versions.\n"));
    console.log(chalk.dim("Ensure the rig declares marketplaces under platforms.claude-code.marketplaces"));
    return;
  }

  const plugins = getAllPlugins(rig);
  let hasUpdates = false;

  console.log(chalk.bold("Plugin Status:"));
  for (const plugin of plugins) {
    const upstream = marketplaceVersions.get(plugin.source);
    if (!upstream) {
      console.log(`  ${chalk.dim("?")}  ${plugin.source} — ${chalk.dim("not found in marketplace")}`);
      continue;
    }

    // We don't have the installed version of each individual plugin in the rig manifest.
    // The rig manifest doesn't pin plugin versions (yet). So we just report what's available.
    console.log(
      `  ${chalk.green("✓")}  ${plugin.source} — upstream v${upstream.version}`,
    );
  }

  // Check for NEW plugins in marketplaces that aren't in the rig
  const rigPluginSources = new Set(plugins.map((p) => p.source));
  const newUpstream: Array<{ source: string; version: string; description: string }> = [];

  for (const [source, info] of marketplaceVersions) {
    if (!rigPluginSources.has(source)) {
      newUpstream.push({ source, ...info });
    }
  }

  if (newUpstream.length > 0) {
    hasUpdates = true;
    console.log(chalk.bold("\nNew in marketplace (not in rig):"));
    for (const p of newUpstream) {
      console.log(
        `  ${chalk.yellow("+")}  ${p.source} v${p.version}` +
          (p.description ? chalk.dim(` — ${p.description}`) : ""),
      );
    }
  }

  // Check for plugins in the rig that are no longer in the marketplace
  const removedFromUpstream: string[] = [];
  for (const plugin of plugins) {
    // Only check plugins that reference a declared marketplace
    const marketplaces = rig.platforms?.["claude-code"]?.marketplaces ?? [];
    const mpNames = marketplaces.map((m) => m.name);
    const pluginMp = plugin.source.split("@")[1];
    if (pluginMp && mpNames.includes(pluginMp) && !marketplaceVersions.has(plugin.source)) {
      removedFromUpstream.push(plugin.source);
    }
  }

  if (removedFromUpstream.length > 0) {
    hasUpdates = true;
    console.log(chalk.bold("\nRemoved from marketplace (still in rig):"));
    for (const source of removedFromUpstream) {
      console.log(`  ${chalk.red("-")}  ${source}`);
    }
  }

  // Check external tools
  if (rig.tools && rig.tools.length > 0) {
    console.log(chalk.bold("\nExternal Tools:"));
    for (const tool of rig.tools) {
      try {
        await execFileAsync("sh", ["-c", tool.check], { timeout: 5_000 });
        console.log(`  ${chalk.green("✓")}  ${tool.name} — installed`);
      } catch {
        console.log(
          `  ${chalk.yellow("!")}  ${tool.name} — not installed` +
            (tool.optional ? chalk.dim(" (optional)") : chalk.red(" (required)")),
        );
      }
    }
  }

  if (!hasUpdates) {
    console.log(chalk.green("\nNo upstream changes detected.\n"));
  } else {
    console.log(
      chalk.dim("\nTo adopt changes, update the rig's agent-rig.json and re-run 'agent-rig install --force'.\n"),
    );
  }
}
