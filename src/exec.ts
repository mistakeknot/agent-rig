import { execFile, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import chalk from "chalk";
import type { RigSource } from "./loader.js";

export const execFileAsync = promisify(execFile);

/** Run a shell command with real-time stdout/stderr output. Returns exit code. */
export function spawnStreaming(
  command: string,
  opts?: { timeout?: number },
): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], { stdio: "inherit" });
    const timer = opts?.timeout
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`Command timed out after ${opts.timeout}ms`));
        }, opts.timeout)
      : undefined;

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1 });
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

export async function cloneToLocal(source: RigSource): Promise<string> {
  if (source.type === "local") return source.path;

  const dest = join(tmpdir(), `agent-rig-${source.repo}-${Date.now()}`);
  console.log(chalk.dim(`Cloning ${source.url}...`));
  await execFileAsync("git", ["clone", "--depth", "1", source.url, dest], {
    timeout: 60_000,
  });
  return dest;
}

export async function cleanupCloneDir(dir: string, source: RigSource): Promise<void> {
  if (source.type === "local") return;
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}
