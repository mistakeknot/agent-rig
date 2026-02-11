import type { AgentRig } from "../schema.js";

export interface InstallResult {
  component: string;
  status: "installed" | "skipped" | "failed" | "disabled";
  message?: string;
}

export interface ConflictWarning {
  installedPlugin: string;
  conflictsWith: string;
  reason?: string;
}

export interface PlatformAdapter {
  name: string;
  detect(): Promise<boolean>;
  checkConflicts(rig: AgentRig): Promise<ConflictWarning[]>;
  installPlugins(rig: AgentRig): Promise<InstallResult[]>;
  disableConflicts(rig: AgentRig): Promise<InstallResult[]>;
  addMarketplaces(rig: AgentRig): Promise<InstallResult[]>;
  installMcpServers(rig: AgentRig): Promise<InstallResult[]>;
  installBehavioral(rig: AgentRig, rigDir: string): Promise<InstallResult[]>;
  verify(rig: AgentRig): Promise<InstallResult[]>;
}
