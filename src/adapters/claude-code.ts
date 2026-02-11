import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { AgentRig } from "../schema.js";
import type { InstallResult, ConflictWarning, PlatformAdapter } from "./types.js";
import { execFileAsync } from "../exec.js";

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

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

type PluginEntry = { source: string; description?: string; depends?: string[] };

/** Topological sort — dependencies before dependents. Falls back to original order on cycles. */
function topoSortPlugins(plugins: PluginEntry[]): PluginEntry[] {
  const bySource = new Map(plugins.map((p) => [p.source, p]));
  const visited = new Set<string>();
  const ordered: PluginEntry[] = [];

  function visit(source: string) {
    if (visited.has(source)) return;
    visited.add(source);
    const plugin = bySource.get(source);
    if (!plugin) return;
    for (const dep of plugin.depends ?? []) {
      visit(dep);
    }
    ordered.push(plugin);
  }

  for (const plugin of plugins) {
    visit(plugin.source);
  }

  return ordered;
}

export class ClaudeCodeAdapter implements PlatformAdapter {
  name = "claude-code";

  async detect(): Promise<boolean> {
    const { ok } = await run("claude", ["--version"]);
    return ok;
  }

  async checkConflicts(rig: AgentRig): Promise<ConflictWarning[]> {
    const warnings: ConflictWarning[] = [];

    // Get currently installed plugins
    const { ok, output } = await run("claude", ["plugin", "list"]);
    if (!ok) return warnings;

    // Parse installed plugin names from the output
    const installedPlugins = new Set(
      output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("─")),
    );

    // Check declared conflicts that are already installed and NOT already disabled
    const declaredConflicts = rig.plugins?.conflicts ?? [];
    for (const conflict of declaredConflicts) {
      // Extract plugin name from source (e.g. "code-review@claude-plugins-official" → "code-review")
      const pluginName = conflict.source.split("@")[0];
      if (installedPlugins.has(pluginName) || installedPlugins.has(conflict.source)) {
        warnings.push({
          installedPlugin: conflict.source,
          conflictsWith: "rig declaration",
          reason: conflict.reason ?? "Declared as conflicting in rig manifest",
        });
      }
    }

    // Check rig plugins against installed — warn if rig is installing
    // a plugin that shares a name prefix with an existing one
    const rigPluginNames = [
      ...(rig.plugins?.core ? [rig.plugins.core.source] : []),
      ...(rig.plugins?.required ?? []).map((p) => p.source),
      ...(rig.plugins?.recommended ?? []).map((p) => p.source),
      ...(rig.plugins?.infrastructure ?? []).map((p) => p.source),
    ].map((s) => s.split("@")[0]);

    // Look for installed plugins that overlap with rig plugins but aren't in the conflict list
    const declaredConflictNames = new Set(
      declaredConflicts.map((c) => c.source.split("@")[0]),
    );
    const rigPluginSet = new Set(rigPluginNames);

    for (const installed of installedPlugins) {
      // Skip if it's one of the rig's own plugins or already in the conflict list
      if (rigPluginSet.has(installed) || declaredConflictNames.has(installed)) {
        continue;
      }

      // Heuristic: warn if an installed plugin name overlaps significantly with a rig plugin
      for (const rigPlugin of rigPluginNames) {
        if (
          installed.includes(rigPlugin) ||
          rigPlugin.includes(installed)
        ) {
          warnings.push({
            installedPlugin: installed,
            conflictsWith: rigPlugin,
            reason: "Potential overlap (name similarity)",
          });
        }
      }
    }

    return warnings;
  }

  async addMarketplaces(rig: AgentRig): Promise<InstallResult[]> {
    const results: InstallResult[] = [];
    const marketplaces = rig.platforms?.["claude-code"]?.marketplaces ?? [];

    for (const mp of marketplaces) {
      const { ok, output } = await run("claude", [
        "plugin",
        "marketplace",
        "add",
        mp.repo,
      ]);
      results.push({
        component: `marketplace:${mp.name}`,
        status: ok || output.includes("already") ? "installed" : "failed",
        message: ok ? undefined : output,
      });
    }
    return results;
  }

  async installPlugins(rig: AgentRig): Promise<InstallResult[]> {
    const results: InstallResult[] = [];
    const plugins = [
      ...(rig.plugins?.core ? [rig.plugins.core] : []),
      ...(rig.plugins?.required ?? []),
      ...(rig.plugins?.recommended ?? []),
      ...(rig.plugins?.infrastructure ?? []),
    ];

    // Topological sort: install dependencies before dependents
    const ordered = topoSortPlugins(plugins);

    for (const plugin of ordered) {
      const { ok, output } = await run("claude", [
        "plugin",
        "install",
        plugin.source,
      ]);
      results.push({
        component: `plugin:${plugin.source}`,
        status: ok || output.includes("already") ? "installed" : "failed",
        message: ok ? plugin.description : output,
      });
    }
    return results;
  }

  async disableConflicts(rig: AgentRig): Promise<InstallResult[]> {
    const results: InstallResult[] = [];
    for (const conflict of rig.plugins?.conflicts ?? []) {
      const { ok } = await run("claude", [
        "plugin",
        "disable",
        conflict.source,
      ]);
      results.push({
        component: `conflict:${conflict.source}`,
        status: ok ? "disabled" : "skipped",
        message: conflict.reason,
      });
    }
    return results;
  }

  async installMcpServers(rig: AgentRig): Promise<InstallResult[]> {
    const results: InstallResult[] = [];
    for (const [name, server] of Object.entries(rig.mcpServers ?? {})) {
      // Check if already configured
      const existing = await run("claude", ["mcp", "get", name]);
      if (existing.ok && !existing.output.includes("not found")) {
        results.push({
          component: `mcp:${name}`,
          status: "skipped",
          message: "already configured",
        });
        continue;
      }

      let addArgs: string[];
      if (server.type === "http") {
        addArgs = ["mcp", "add", "--transport", "http", "--scope", "user", name, server.url];
      } else if (server.type === "sse") {
        addArgs = ["mcp", "add", "--transport", "sse", "--scope", "user", name, server.url];
      } else {
        // stdio: command and args go after --
        addArgs = [
          "mcp", "add", "--scope", "user", name,
          "--", server.command, ...(server.args ?? []),
        ];
      }

      const { ok, output } = await run("claude", addArgs);
      results.push({
        component: `mcp:${name}`,
        status: ok ? "installed" : "failed",
        message: ok ? server.description : output,
      });
    }
    return results;
  }

  async installBehavioral(
    rig: AgentRig,
    rigDir: string,
  ): Promise<InstallResult[]> {
    const results: InstallResult[] = [];
    if (!rig.behavioral) return results;

    const rigName = rig.name;
    const rigsDir = join(".claude", "rigs", rigName);
    mkdirSync(rigsDir, { recursive: true });

    const assets: Array<{
      key: string;
      targetFilename: string;
      pointerVerb: string;
    }> = [
      {
        key: "claude-md",
        targetFilename: "CLAUDE.md",
        pointerVerb: "Also read and follow",
      },
      {
        key: "agents-md",
        targetFilename: "AGENTS.md",
        pointerVerb: "Also read",
      },
    ];

    const manifestFiles: string[] = [];
    const manifestPointers: Array<{ file: string; line: string }> = [];
    const fileHashes: Record<string, string> = {};

    // Load existing manifest hashes for modification detection
    const manifestPath = join(rigsDir, "install-manifest.json");
    let manifestHashes: Record<string, string> = {};
    if (existsSync(manifestPath)) {
      try {
        const existing = JSON.parse(readFileSync(manifestPath, "utf-8"));
        manifestHashes = existing.fileHashes ?? {};
      } catch { /* ignore */ }
    }

    for (const asset of assets) {
      const config =
        rig.behavioral[asset.key as keyof typeof rig.behavioral];
      if (!config) continue;

      // Read source file from rig repo
      const sourcePath = join(rigDir, config.source);
      if (!existsSync(sourcePath)) {
        results.push({
          component: `behavioral:${asset.key}`,
          status: "failed",
          message: `Source not found: ${config.source}`,
        });
        continue;
      }

      const content = readFileSync(sourcePath, "utf-8");
      const newHash = sha256(content);

      // Write to namespaced location (with modification check)
      const destPath = join(rigsDir, asset.targetFilename);

      if (existsSync(destPath)) {
        // Check if user modified the installed file
        const existingContent = readFileSync(destPath, "utf-8");
        const existingHash = sha256(existingContent);
        const installedHash = manifestHashes[destPath];

        if (installedHash && existingHash !== installedHash && existingHash !== newHash) {
          // User modified the file AND new content differs from current
          results.push({
            component: `behavioral:${asset.key}`,
            status: "skipped",
            message: `locally modified — use --force to overwrite (${destPath})`,
          });
          continue;
        }
      }

      writeFileSync(destPath, content, "utf-8");
      manifestFiles.push(destPath);
      fileHashes[destPath] = newHash;

      // Add pointer to root file (idempotent)
      const pointerTag = `<!-- agent-rig:${rigName} -->`;
      const pointerLine = `${pointerTag} ${asset.pointerVerb}: ${destPath}`;
      const rootFile = asset.targetFilename;

      let rootContent = "";
      if (existsSync(rootFile)) {
        rootContent = readFileSync(rootFile, "utf-8");
      }

      if (rootContent.includes(pointerTag)) {
        results.push({
          component: `behavioral:${asset.key}`,
          status: "skipped",
          message: "pointer already exists",
        });
      } else {
        // Prepend pointer line
        const newContent = pointerLine + "\n\n" + rootContent;
        writeFileSync(rootFile, newContent, "utf-8");
        manifestPointers.push({ file: rootFile, line: pointerLine });
        results.push({
          component: `behavioral:${asset.key}`,
          status: "installed",
          message: `${destPath} + pointer in ${rootFile}`,
        });
      }

      // Warn about dependencies
      if (config.dependedOnBy && config.dependedOnBy.length > 0) {
        const deps = config.dependedOnBy.join(", ");
        results.push({
          component: `behavioral:${asset.key}:deps`,
          status: "installed",
          message: `depended on by: ${deps}`,
        });
      }
    }

    // Write install manifest with file hashes for modification detection
    const manifest = {
      rig: rigName,
      version: rig.version,
      installedAt: new Date().toISOString(),
      files: manifestFiles,
      pointers: manifestPointers,
      fileHashes,
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    return results;
  }

  async verify(rig: AgentRig): Promise<InstallResult[]> {
    const results: InstallResult[] = [];

    for (const [name, server] of Object.entries(rig.mcpServers ?? {})) {
      if (
        server.type === "http" &&
        "healthCheck" in server &&
        server.healthCheck
      ) {
        const { ok } = await run("curl", [
          "-s",
          "--max-time",
          "2",
          server.healthCheck,
        ]);
        results.push({
          component: `mcp:${name}`,
          status: ok ? "installed" : "failed",
          message: ok ? "healthy" : "not responding",
        });
      } else {
        results.push({
          component: `mcp:${name}`,
          status: "skipped",
          message: "no health check configured",
        });
      }
    }

    return results;
  }
}
