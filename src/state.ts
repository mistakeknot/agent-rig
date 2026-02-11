import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface InstalledMcpServer {
  name: string;
  type: "http" | "stdio" | "sse";
}

export interface InstalledBehavioral {
  file: string;
  pointerFile: string;
  pointerTag: string;
}

export interface RigState {
  name: string;
  version: string;
  source: string;
  installedAt: string;
  plugins: string[];
  disabledConflicts: string[];
  mcpServers: InstalledMcpServer[];
  behavioral: InstalledBehavioral[];
  marketplaces: string[];
}

export interface StateFile {
  rigs: Record<string, RigState>;
}

function statePath(): string {
  return join(homedir(), ".agent-rig", "state.json");
}

export function loadState(): StateFile {
  const path = statePath();
  if (!existsSync(path)) return { rigs: {} };
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { rigs: {} };
  }
}

export function saveState(state: StateFile): void {
  const dir = join(homedir(), ".agent-rig");
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

export function getRigState(name: string): RigState | undefined {
  return loadState().rigs[name];
}

export function setRigState(rigState: RigState): void {
  const state = loadState();
  state.rigs[rigState.name] = rigState;
  saveState(state);
}

export function removeRigState(name: string): void {
  const state = loadState();
  delete state.rigs[name];
  saveState(state);
}
