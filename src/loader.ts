import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AgentRigSchema, type AgentRig } from "./schema.js";

export type GitHubSource = {
  type: "github";
  owner: string;
  repo: string;
  url: string;
};

export type LocalSource = {
  type: "local";
  path: string;
};

export type RigSource = GitHubSource | LocalSource;

export function resolveSource(input: string): RigSource {
  // Absolute or explicitly relative paths are always local
  if (input.startsWith("/") || input.startsWith("./") || input.startsWith("../")) {
    return { type: "local", path: input };
  }

  // Full GitHub URL
  const ghUrlMatch = input.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)/,
  );
  if (ghUrlMatch) {
    return {
      type: "github",
      owner: ghUrlMatch[1],
      repo: ghUrlMatch[2],
      url: `https://github.com/${ghUrlMatch[1]}/${ghUrlMatch[2]}.git`,
    };
  }

  // If it exists on disk, treat as local (handles "examples/clavain")
  if (existsSync(input)) {
    return { type: "local", path: input };
  }

  // GitHub owner/repo shorthand
  const shortMatch = input.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (shortMatch) {
    return {
      type: "github",
      owner: shortMatch[1],
      repo: shortMatch[2],
      url: `https://github.com/${shortMatch[1]}/${shortMatch[2]}.git`,
    };
  }

  // Local path (fallback)
  return { type: "local", path: input };
}

export async function loadManifest(dir: string): Promise<AgentRig> {
  const manifestPath = join(dir, "agent-rig.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch {
    throw new Error(`agent-rig.json not found at ${manifestPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${manifestPath}`);
  }

  const result = AgentRigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Manifest validation failed:\n${issues}`);
  }

  return result.data;
}
