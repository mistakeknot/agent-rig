import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentRig } from "../schema.js";
import type { InstallResult, PlatformAdapter } from "./types.js";

const execFileAsync = promisify(execFile);

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
    const codexConfig = rig.platforms?.["codex"];
    if (!codexConfig || typeof codexConfig !== "object") {
      return [
        {
          component: "codex-config",
          status: "skipped",
          message: "No codex platform config",
        },
      ];
    }

    const results: InstallResult[] = [];
    const installScript = (codexConfig as any).installScript;
    if (installScript) {
      try {
        await execFileAsync("bash", [installScript, "install"], {
          timeout: 60_000,
        });
        results.push({
          component: "codex-install-script",
          status: "installed",
        });
      } catch (err: any) {
        results.push({
          component: "codex-install-script",
          status: "failed",
          message: err.message,
        });
      }
    }
    return results;
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
