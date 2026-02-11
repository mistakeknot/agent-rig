import type { AgentRig } from "../schema.js";
import type { InstallResult, PlatformAdapter } from "./types.js";
import { execFileAsync } from "../exec.js";

export class CodexAdapter implements PlatformAdapter {
  name = "codex";

  async detect(): Promise<boolean> {
    try {
      await execFileAsync("codex", ["--version"], { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  async addMarketplaces(_rig: AgentRig): Promise<InstallResult[]> {
    return [];
  }

  async installPlugins(rig: AgentRig): Promise<InstallResult[]> {
    const codexConfig = rig.platforms?.codex;
    if (!codexConfig) {
      return [
        {
          component: "codex-config",
          status: "skipped",
          message: "No codex platform config",
        },
      ];
    }

    const results: InstallResult[] = [];
    if (codexConfig.installScript) {
      try {
        await execFileAsync("bash", [codexConfig.installScript, "install"], {
          timeout: 60_000,
        });
        results.push({
          component: "codex-install-script",
          status: "installed",
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          component: "codex-install-script",
          status: "failed",
          message,
        });
      }
    }
    return results;
  }

  async installMcpServers(_rig: AgentRig): Promise<InstallResult[]> {
    // Codex CLI doesn't support MCP server configuration via CLI
    return [];
  }

  async installBehavioral(_rig: AgentRig, _rigDir: string): Promise<InstallResult[]> {
    // Codex CLI doesn't have CLAUDE.md — behavioral config is Claude Code only
    return [];
  }

  async disableConflicts(_rig: AgentRig): Promise<InstallResult[]> {
    return [];
  }

  async verify(_rig: AgentRig): Promise<InstallResult[]> {
    const results: InstallResult[] = [];
    try {
      await execFileAsync("codex", ["--version"], { timeout: 5_000 });
      results.push({ component: "codex-cli", status: "installed" });
    } catch {
      results.push({
        component: "codex-cli",
        status: "failed",
        message: "codex not found",
      });
    }
    return results;
  }
}
