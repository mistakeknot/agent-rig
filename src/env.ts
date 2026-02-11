import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BEGIN_TAG = (rigName: string) => `# --- agent-rig: ${rigName} ---`;
const END_TAG = (rigName: string) => `# --- end agent-rig: ${rigName} ---`;

interface ShellInfo {
  name: "bash" | "zsh" | "fish" | "unknown";
  profilePath: string;
}

/** Detect the user's shell and return the profile path to write to. */
export function detectShell(): ShellInfo {
  const shell = process.env.SHELL ?? "";
  const home = homedir();

  if (shell.endsWith("/fish")) {
    // Fish uses a config directory
    const fishConfig = join(home, ".config", "fish", "config.fish");
    return { name: "fish", profilePath: fishConfig };
  }

  if (shell.endsWith("/bash")) {
    // Prefer .bashrc for interactive sessions
    return { name: "bash", profilePath: join(home, ".bashrc") };
  }

  // Default to zsh (macOS default, common on Linux)
  return { name: "zsh", profilePath: join(home, ".zshrc") };
}

/** Format env vars for the given shell. */
function formatEnvBlock(
  rigName: string,
  env: Record<string, string>,
  shell: ShellInfo["name"],
): string {
  const begin = BEGIN_TAG(rigName);
  const end = END_TAG(rigName);
  const lines: string[] = [begin];

  for (const [key, value] of Object.entries(env)) {
    if (shell === "fish") {
      lines.push(`set -gx ${key} "${value}"`);
    } else {
      lines.push(`export ${key}="${value}"`);
    }
  }

  lines.push(end);
  return lines.join("\n");
}

/** Check if the rig's env block already exists in the profile. */
export function hasEnvBlock(rigName: string, profilePath: string): boolean {
  if (!existsSync(profilePath)) return false;
  const content = readFileSync(profilePath, "utf-8");
  return content.includes(BEGIN_TAG(rigName));
}

/** Write env vars to the shell profile as a tagged block. Idempotent — replaces existing block. */
export function writeEnvBlock(
  rigName: string,
  env: Record<string, string>,
  shell: ShellInfo,
): void {
  const block = formatEnvBlock(rigName, env, shell.name);
  const profilePath = shell.profilePath;

  if (!existsSync(profilePath)) {
    // Create the file with just the block
    writeFileSync(profilePath, block + "\n", "utf-8");
    return;
  }

  let content = readFileSync(profilePath, "utf-8");
  const begin = BEGIN_TAG(rigName);
  const end = END_TAG(rigName);

  if (content.includes(begin)) {
    // Replace existing block
    const regex = new RegExp(
      escapeRegExp(begin) + "[\\s\\S]*?" + escapeRegExp(end),
      "m",
    );
    content = content.replace(regex, block);
  } else {
    // Append
    content = content.trimEnd() + "\n\n" + block + "\n";
  }

  writeFileSync(profilePath, content, "utf-8");
}

/** Remove the rig's env block from the shell profile. */
export function removeEnvBlock(rigName: string, profilePath: string): boolean {
  if (!existsSync(profilePath)) return false;

  let content = readFileSync(profilePath, "utf-8");
  const begin = BEGIN_TAG(rigName);
  const end = END_TAG(rigName);

  if (!content.includes(begin)) return false;

  const regex = new RegExp(
    "\\n?" + escapeRegExp(begin) + "[\\s\\S]*?" + escapeRegExp(end) + "\\n?",
    "m",
  );
  content = content.replace(regex, "\n");

  // Clean up trailing whitespace
  content = content.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

  writeFileSync(profilePath, content, "utf-8");
  return true;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
