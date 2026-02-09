import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentRig } from "../schema.js";
import type { InstallResult, PlatformAdapter } from "./types.js";

const execFileAsync = promisify(execFile);

async function run(
  cmd: string,
  args: string[],
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 30_000,
    });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (err: any) {
    return { ok: false, output: err.message || String(err) };
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
