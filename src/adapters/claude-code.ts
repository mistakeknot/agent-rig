import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import type { AgentRig } from "../schema.js";
import type { InstallResult, PlatformAdapter } from "./types.js";
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

export class ClaudeCodeAdapter implements PlatformAdapter {
  name = "claude-code";

  async detect(): Promise<boolean> {
    const { ok } = await run("claude", ["--version"]);
    return ok;
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

    for (const plugin of plugins) {
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

      // Write to namespaced location
      const destPath = join(rigsDir, asset.targetFilename);
      writeFileSync(destPath, content, "utf-8");
      manifestFiles.push(destPath);

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

    // Write install manifest
    const manifestPath = join(rigsDir, "install-manifest.json");
    const manifest = {
      rig: rigName,
      version: rig.version,
      installedAt: new Date().toISOString(),
      files: manifestFiles,
      pointers: manifestPointers,
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
