# Agent Rig Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use clavain:executing-plans to implement this plan task-by-task.

**Goal:** Build an open-source framework that lets people package, share, and install complete agent setups ("rigs") with a single command — the modpack system for AI coding agents.

**Architecture:** A TypeScript CLI (`agent-rig`) with a declarative manifest format (`agent-rig.json`). The core is platform-agnostic; v1 ships with Claude Code and Codex CLI adapters. Rigs are distributed as GitHub repos. The CLI reads the manifest, resolves what needs to be installed, and orchestrates platform-specific installers.

**Tech Stack:** TypeScript, Node.js >=20, commander.js, zod (validation), chalk (output), pnpm

**Brainstorm:** `docs/brainstorms/2026-02-08-agent-rig-framework-brainstorm.md`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `.gitignore`
- Create: `LICENSE`

**Step 1: Initialize the project**

```bash
cd /root/projects/agent-rig
pnpm init
```

**Step 2: Configure package.json**

Set up as an ES module CLI tool:

```json
{
  "name": "agent-rig",
  "version": "0.1.0",
  "description": "The modpack system for AI coding agents — package, share, and install complete agent rigs with one command",
  "type": "module",
  "bin": {
    "agent-rig": "./dist/index.js"
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "test": "node --test dist/**/*.test.js",
    "lint": "tsc --noEmit"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "license": "MIT",
  "keywords": ["agent-rig", "claude-code", "modpack", "plugins", "mcp", "codex"]
}
```

**Step 3: Install dependencies**

```bash
pnpm add commander chalk zod
pnpm add -D typescript @types/node
```

**Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 5: Create entry point**

Create `src/index.ts`:

```typescript
#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("agent-rig")
  .description("The modpack system for AI coding agents")
  .version("0.1.0");

program.parse();
```

**Step 6: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
```

**Step 7: Build and verify**

```bash
pnpm build
node dist/index.js --help
```

Expected: Shows help text with "The modpack system for AI coding agents"

**Step 8: Initialize git and commit**

```bash
git init
git add package.json tsconfig.json src/index.ts .gitignore LICENSE
git commit -m "feat: scaffold agent-rig CLI project"
```

---

## Task 2: Manifest Schema (`agent-rig.json`)

**Files:**
- Create: `src/schema.ts`
- Create: `src/schema.test.ts`

This is the heart of the framework — the `agent-rig.json` format that describes a complete rig.

**Step 1: Write the failing test**

Create `src/schema.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentRigSchema } from "./schema.js";

describe("AgentRigSchema", () => {
  it("validates a minimal rig manifest", () => {
    const manifest = {
      name: "my-rig",
      version: "1.0.0",
      description: "A test rig",
      author: "testuser",
    };
    const result = AgentRigSchema.safeParse(manifest);
    assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
  });

  it("validates a full rig manifest with all layers", () => {
    const manifest = {
      name: "clavain",
      version: "0.4.2",
      description: "General-purpose engineering discipline rig",
      author: "mistakeknot",
      license: "MIT",
      repository: "mistakeknot/Clavain",
      keywords: ["engineering-discipline", "code-review"],

      plugins: {
        core: {
          source: "clavain@interagency-marketplace",
          description: "The core Clavain plugin",
        },
        required: [
          { source: "context7@claude-plugins-official", description: "Runtime doc fetching" },
          { source: "interdoc@interagency-marketplace", description: "AGENTS.md generation" },
        ],
        recommended: [
          { source: "serena@claude-plugins-official", description: "Semantic coding tools" },
        ],
        conflicts: [
          { source: "code-review@claude-plugins-official", reason: "Duplicates Clavain's review agents" },
        ],
      },

      mcpServers: {
        "context7": {
          type: "http",
          url: "https://mcp.context7.com/mcp",
          description: "Runtime documentation fetching",
        },
        "agent-mail": {
          type: "http",
          url: "http://127.0.0.1:8765/mcp",
          description: "Multi-agent coordination",
          healthCheck: "http://127.0.0.1:8765/health",
        },
      },

      tools: [
        {
          name: "oracle",
          install: "npm install -g @steipete/oracle",
          check: "command -v oracle",
          optional: true,
          description: "Cross-AI review via GPT-5.2 Pro",
        },
      ],

      environment: {
        DISPLAY: ":99",
        CHROME_PATH: "/usr/local/bin/google-chrome-wrapper",
      },

      platforms: {
        "claude-code": {
          marketplaces: [
            { name: "interagency-marketplace", repo: "mistakeknot/interagency-marketplace" },
          ],
        },
        "codex": {
          installScript: "scripts/install-codex.sh",
        },
      },
    };
    const result = AgentRigSchema.safeParse(manifest);
    assert.ok(result.success, `Validation failed: ${JSON.stringify(result.error?.issues)}`);
  });

  it("rejects a manifest missing required fields", () => {
    const result = AgentRigSchema.safeParse({ name: "test" });
    assert.ok(!result.success);
  });

  it("validates the extends field for future composition", () => {
    const manifest = {
      name: "go-dev",
      version: "1.0.0",
      description: "Go development rig",
      author: "someone",
      extends: "mistakeknot/Clavain",
    };
    const result = AgentRigSchema.safeParse(manifest);
    assert.ok(result.success);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm build && node --test dist/schema.test.js
```

Expected: FAIL — `schema.js` does not exist

**Step 3: Implement the schema**

Create `src/schema.ts`:

```typescript
import { z } from "zod";

// --- Plugin references ---

const PluginRef = z.object({
  source: z.string().describe("Plugin identifier: name@marketplace"),
  description: z.string().optional(),
});

const ConflictRef = z.object({
  source: z.string().describe("Plugin identifier to disable"),
  reason: z.string().optional(),
});

const CorePluginRef = z.object({
  source: z.string().describe("The core plugin identifier"),
  description: z.string().optional(),
});

// --- MCP Servers ---

const McpServerHttp = z.object({
  type: z.literal("http"),
  url: z.string().url(),
  description: z.string().optional(),
  healthCheck: z.string().url().optional(),
});

const McpServerStdio = z.object({
  type: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).optional(),
  description: z.string().optional(),
});

const McpServerSse = z.object({
  type: z.literal("sse"),
  url: z.string().url(),
  description: z.string().optional(),
});

const McpServer = z.discriminatedUnion("type", [McpServerHttp, McpServerStdio, McpServerSse]);

// --- External tools ---

const ExternalTool = z.object({
  name: z.string(),
  install: z.string().describe("Shell command to install the tool"),
  check: z.string().describe("Shell command to check if tool is already installed"),
  optional: z.boolean().default(false),
  description: z.string().optional(),
  platforms: z.record(z.string(), z.string()).optional().describe("Platform-specific install commands"),
});

// --- Platform adapters ---

const MarketplaceRef = z.object({
  name: z.string(),
  repo: z.string().describe("GitHub owner/repo for the marketplace"),
});

const ClaudeCodePlatform = z.object({
  marketplaces: z.array(MarketplaceRef).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const CodexPlatform = z.object({
  installScript: z.string().optional().describe("Path to Codex CLI install script"),
  skillsDir: z.string().optional().describe("Where to symlink skills for Codex"),
});

const Platforms = z.object({
  "claude-code": ClaudeCodePlatform.optional(),
  "codex": CodexPlatform.optional(),
}).catchall(z.record(z.string(), z.unknown()));

// --- Top-level schema ---

export const AgentRigSchema = z.object({
  // Identity
  name: z.string().regex(/^[a-z0-9-]+$/, "Must be lowercase kebab-case"),
  version: z.string().regex(/^\d+\.\d+\.\d+/, "Must be semver"),
  description: z.string(),
  author: z.string(),
  license: z.string().optional(),
  repository: z.string().optional().describe("GitHub owner/repo"),
  keywords: z.array(z.string()).optional(),

  // Composition (v2 — accepted but not acted on)
  extends: z.string().optional().describe("Parent rig to extend (GitHub owner/repo)"),

  // Layer 1+2: Plugins
  plugins: z.object({
    core: CorePluginRef.optional(),
    required: z.array(PluginRef).optional(),
    recommended: z.array(PluginRef).optional(),
    infrastructure: z.array(PluginRef).optional(),
    conflicts: z.array(ConflictRef).optional(),
  }).optional(),

  // Layer 1: MCP Servers (declared directly, separate from plugin's own servers)
  mcpServers: z.record(z.string(), McpServer).optional(),

  // Layer 3: External tools
  tools: z.array(ExternalTool).optional(),

  // Layer 4: Environment variables
  environment: z.record(z.string(), z.string()).optional(),

  // Platform-specific configuration
  platforms: Platforms.optional(),
});

export type AgentRig = z.infer<typeof AgentRigSchema>;
```

**Step 4: Run test to verify it passes**

```bash
pnpm build && node --test dist/schema.test.js
```

Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/schema.ts src/schema.test.ts
git commit -m "feat: define agent-rig.json manifest schema with zod validation"
```

---

## Task 3: Manifest Loader

**Files:**
- Create: `src/loader.ts`
- Create: `src/loader.test.ts`

Loads an `agent-rig.json` from a local path or GitHub repo URL, validates it, and returns a typed manifest object.

**Step 1: Write the failing test**

Create `src/loader.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadManifest, resolveSource } from "./loader.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("resolveSource", () => {
  it("parses a GitHub owner/repo string", () => {
    const result = resolveSource("mistakeknot/Clavain");
    assert.deepEqual(result, {
      type: "github",
      owner: "mistakeknot",
      repo: "Clavain",
      url: "https://github.com/mistakeknot/Clavain.git",
    });
  });

  it("parses a local directory path", () => {
    const result = resolveSource("/some/local/path");
    assert.deepEqual(result, {
      type: "local",
      path: "/some/local/path",
    });
  });

  it("parses a full GitHub URL", () => {
    const result = resolveSource("https://github.com/mistakeknot/Clavain");
    assert.deepEqual(result, {
      type: "github",
      owner: "mistakeknot",
      repo: "Clavain",
      url: "https://github.com/mistakeknot/Clavain.git",
    });
  });
});

describe("loadManifest", () => {
  const testDir = join(tmpdir(), "agent-rig-test-" + Date.now());

  it("loads a valid agent-rig.json from a local directory", async () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, "agent-rig.json"),
      JSON.stringify({
        name: "test-rig",
        version: "1.0.0",
        description: "A test rig",
        author: "tester",
      })
    );
    const result = await loadManifest(testDir);
    assert.equal(result.name, "test-rig");
    rmSync(testDir, { recursive: true });
  });

  it("throws on missing agent-rig.json", async () => {
    await assert.rejects(
      () => loadManifest("/nonexistent/path"),
      /not found|ENOENT/
    );
  });

  it("throws on invalid manifest", async () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "agent-rig.json"), JSON.stringify({ name: 123 }));
    await assert.rejects(() => loadManifest(testDir), /validation/i);
    rmSync(testDir, { recursive: true });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm build && node --test dist/loader.test.js
```

Expected: FAIL — `loader.js` does not exist

**Step 3: Implement the loader**

Create `src/loader.ts`:

```typescript
import { readFile } from "node:fs/promises";
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
  // Full GitHub URL
  const ghUrlMatch = input.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)/
  );
  if (ghUrlMatch) {
    return {
      type: "github",
      owner: ghUrlMatch[1],
      repo: ghUrlMatch[2],
      url: `https://github.com/${ghUrlMatch[1]}/${ghUrlMatch[2]}.git`,
    };
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

  // Local path
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
```

**Step 4: Run test to verify it passes**

```bash
pnpm build && node --test dist/loader.test.js
```

Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/loader.ts src/loader.test.ts
git commit -m "feat: add manifest loader with GitHub/local source resolution"
```

---

## Task 4: Platform Adapter Interface

**Files:**
- Create: `src/adapters/types.ts`
- Create: `src/adapters/claude-code.ts`
- Create: `src/adapters/codex.ts`
- Create: `src/adapters/claude-code.test.ts`

The adapter pattern allows the same manifest to be installed on different platforms.

**Step 1: Define the adapter interface**

Create `src/adapters/types.ts`:

```typescript
import type { AgentRig } from "../schema.js";

export interface InstallResult {
  component: string;
  status: "installed" | "skipped" | "failed" | "disabled";
  message?: string;
}

export interface PlatformAdapter {
  name: string;
  detect(): Promise<boolean>;
  installPlugins(rig: AgentRig): Promise<InstallResult[]>;
  disableConflicts(rig: AgentRig): Promise<InstallResult[]>;
  addMarketplaces(rig: AgentRig): Promise<InstallResult[]>;
  verify(rig: AgentRig): Promise<InstallResult[]>;
}
```

**Step 2: Implement the Claude Code adapter**

Create `src/adapters/claude-code.ts` using `execFile` (not `exec`) to avoid shell injection:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentRig } from "../schema.js";
import type { InstallResult, PlatformAdapter } from "./types.js";

const execFileAsync = promisify(execFile);

async function run(cmd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 30_000 });
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
        "plugin", "marketplace", "add", mp.repo,
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
        "plugin", "install", plugin.source,
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
        "plugin", "disable", conflict.source,
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
      if (server.type === "http" && "healthCheck" in server && server.healthCheck) {
        const { ok } = await run("curl", ["-s", "--max-time", "2", server.healthCheck]);
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
```

**Step 3: Implement the Codex adapter (stub)**

Create `src/adapters/codex.ts`:

```typescript
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
      return [{ component: "codex-config", status: "skipped", message: "No codex platform config" }];
    }

    const results: InstallResult[] = [];
    const installScript = (codexConfig as any).installScript;
    if (installScript) {
      try {
        await execFileAsync("bash", [installScript, "install"], { timeout: 60_000 });
        results.push({ component: "codex-install-script", status: "installed" });
      } catch (err: any) {
        results.push({ component: "codex-install-script", status: "failed", message: err.message });
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
      results.push({ component: "codex-cli", status: "failed", message: "codex not found" });
    }
    return results;
  }
}
```

**Step 4: Write adapter test**

Create `src/adapters/claude-code.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ClaudeCodeAdapter } from "./claude-code.js";

describe("ClaudeCodeAdapter", () => {
  const adapter = new ClaudeCodeAdapter();

  it("has the correct name", () => {
    assert.equal(adapter.name, "claude-code");
  });

  it("detects Claude Code CLI", async () => {
    const result = await adapter.detect();
    assert.equal(typeof result, "boolean");
  });

  it("handles empty plugins gracefully", async () => {
    const rig = {
      name: "test",
      version: "1.0.0",
      description: "test",
      author: "test",
    };
    const results = await adapter.installPlugins(rig);
    assert.equal(results.length, 0);
  });

  it("handles empty conflicts gracefully", async () => {
    const rig = {
      name: "test",
      version: "1.0.0",
      description: "test",
      author: "test",
    };
    const results = await adapter.disableConflicts(rig);
    assert.equal(results.length, 0);
  });
});
```

**Step 5: Build and test**

```bash
pnpm build && node --test dist/adapters/claude-code.test.js
```

Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/adapters/
git commit -m "feat: add platform adapter interface with Claude Code and Codex implementations"
```

---

## Task 5: Install Command

**Files:**
- Create: `src/commands/install.ts`
- Modify: `src/index.ts`

The core `agent-rig install <source>` command.

**Step 1: Implement the install command**

Create `src/commands/install.ts`:

```typescript
import chalk from "chalk";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { loadManifest } from "../loader.js";
import { resolveSource, type RigSource } from "../loader.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { CodexAdapter } from "../adapters/codex.js";
import type { InstallResult, PlatformAdapter } from "../adapters/types.js";

const execFileAsync = promisify(execFile);

function printResults(section: string, results: InstallResult[]) {
  if (results.length === 0) return;
  console.log(`\n${chalk.bold(section)}`);
  for (const r of results) {
    const icon =
      r.status === "installed" ? chalk.green("OK") :
      r.status === "disabled" ? chalk.yellow("OFF") :
      r.status === "skipped" ? chalk.dim("SKIP") :
      chalk.red("FAIL");
    const msg = r.message ? chalk.dim(` — ${r.message}`) : "";
    console.log(`  ${icon}  ${r.component}${msg}`);
  }
}

async function cloneToLocal(source: RigSource): Promise<string> {
  if (source.type === "local") return source.path;

  const dest = join(tmpdir(), `agent-rig-${source.repo}-${Date.now()}`);
  console.log(chalk.dim(`Cloning ${source.url}...`));
  await execFileAsync("git", ["clone", "--depth", "1", source.url, dest], { timeout: 60_000 });
  return dest;
}

async function installTools(rig: import("../schema.js").AgentRig): Promise<InstallResult[]> {
  const results: InstallResult[] = [];
  for (const tool of rig.tools ?? []) {
    // Check if already installed
    try {
      await execFileAsync("sh", ["-c", tool.check], { timeout: 5_000 });
      results.push({ component: `tool:${tool.name}`, status: "skipped", message: "already installed" });
      continue;
    } catch {
      // Not installed
    }

    if (tool.optional) {
      results.push({ component: `tool:${tool.name}`, status: "skipped", message: "optional — install manually" });
      continue;
    }

    try {
      await execFileAsync("sh", ["-c", tool.install], { timeout: 120_000 });
      results.push({ component: `tool:${tool.name}`, status: "installed" });
    } catch (err: any) {
      results.push({ component: `tool:${tool.name}`, status: "failed", message: err.message });
    }
  }
  return results;
}

export async function installCommand(sourceArg: string, opts: { dryRun?: boolean }) {
  console.log(chalk.bold(`\nAgent Rig Installer\n`));

  const source = resolveSource(sourceArg);
  const dir = await cloneToLocal(source);

  const rig = await loadManifest(dir);
  console.log(
    `Installing ${chalk.cyan(rig.name)} v${rig.version}` +
    (rig.description ? chalk.dim(` — ${rig.description}`) : "")
  );

  if (opts.dryRun) {
    console.log(chalk.yellow("\nDry run — no changes will be made.\n"));
    console.log(JSON.stringify(rig, null, 2));
    return;
  }

  const adapters: PlatformAdapter[] = [new ClaudeCodeAdapter(), new CodexAdapter()];
  const activeAdapters: PlatformAdapter[] = [];

  for (const adapter of adapters) {
    if (await adapter.detect()) {
      activeAdapters.push(adapter);
      console.log(chalk.green(`  Detected: ${adapter.name}`));
    } else {
      console.log(chalk.dim(`  Not found: ${adapter.name}`));
    }
  }

  if (activeAdapters.length === 0) {
    console.log(chalk.red("\nNo supported platforms detected. Install Claude Code or Codex CLI first."));
    process.exit(1);
  }

  for (const adapter of activeAdapters) {
    console.log(chalk.bold(`\n--- ${adapter.name} ---`));

    const mpResults = await adapter.addMarketplaces(rig);
    printResults("Marketplaces", mpResults);

    const pluginResults = await adapter.installPlugins(rig);
    printResults("Plugins", pluginResults);

    const conflictResults = await adapter.disableConflicts(rig);
    printResults("Conflicts Disabled", conflictResults);
  }

  const toolResults = await installTools(rig);
  printResults("External Tools", toolResults);

  if (rig.environment && Object.keys(rig.environment).length > 0) {
    console.log(chalk.bold("\nEnvironment Variables"));
    console.log(chalk.dim("  Add these to your shell profile:"));
    for (const [key, value] of Object.entries(rig.environment)) {
      console.log(`  export ${key}="${value}"`);
    }
  }

  console.log(chalk.bold("\n--- Verification ---"));
  for (const adapter of activeAdapters) {
    const verifyResults = await adapter.verify(rig);
    printResults(`${adapter.name} Health`, verifyResults);
  }

  console.log(chalk.bold.green(`\n${rig.name} v${rig.version} installed successfully.\n`));
  console.log("Restart your Claude Code session to activate all changes.");
}
```

**Step 2: Wire up to CLI entry point**

Update `src/index.ts` to add install command import and registration:

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { installCommand } from "./commands/install.js";

const program = new Command();

program
  .name("agent-rig")
  .description("The modpack system for AI coding agents")
  .version("0.1.0");

program
  .command("install <source>")
  .description("Install an agent rig from a GitHub repo or local path")
  .option("--dry-run", "Show what would be installed without making changes")
  .action(installCommand);

program.parse();
```

**Step 3: Build and test manually**

```bash
pnpm build && node dist/index.js install --help
```

Expected: Shows install command help with `<source>` argument and `--dry-run` option

**Step 4: Commit**

```bash
git add src/commands/install.ts src/index.ts
git commit -m "feat: implement install command with platform detection and multi-adapter support"
```

---

## Task 6: Validate Command

**Files:**
- Create: `src/commands/validate.ts`
- Modify: `src/index.ts`

Validates an `agent-rig.json` without installing anything.

**Step 1: Implement validate command**

Create `src/commands/validate.ts`:

```typescript
import chalk from "chalk";
import { loadManifest } from "../loader.js";

export async function validateCommand(dir: string) {
  console.log(chalk.bold(`Validating agent-rig.json in ${dir}\n`));

  try {
    const rig = await loadManifest(dir);
    console.log(chalk.green("Valid!"));
    console.log(`  Name:        ${rig.name}`);
    console.log(`  Version:     ${rig.version}`);
    console.log(`  Description: ${rig.description}`);
    console.log(`  Author:      ${rig.author}`);

    if (rig.plugins) {
      const counts = {
        core: rig.plugins.core ? 1 : 0,
        required: rig.plugins.required?.length ?? 0,
        recommended: rig.plugins.recommended?.length ?? 0,
        infrastructure: rig.plugins.infrastructure?.length ?? 0,
        conflicts: rig.plugins.conflicts?.length ?? 0,
      };
      console.log(`  Plugins:     ${counts.core} core, ${counts.required} required, ${counts.recommended} recommended, ${counts.infrastructure} infrastructure`);
      console.log(`  Conflicts:   ${counts.conflicts}`);
    }

    if (rig.mcpServers) {
      console.log(`  MCP Servers: ${Object.keys(rig.mcpServers).join(", ")}`);
    }

    if (rig.tools) {
      console.log(`  Tools:       ${rig.tools.map((t) => t.name).join(", ")}`);
    }

    if (rig.extends) {
      console.log(chalk.yellow(`  Extends:     ${rig.extends} (not resolved in v1)`));
    }
  } catch (err: any) {
    console.log(chalk.red("Invalid!"));
    console.log(err.message);
    process.exit(1);
  }
}
```

**Step 2: Add to `src/index.ts`**

Add import and command registration after the install command.

**Step 3: Build and verify**

```bash
pnpm build && node dist/index.js validate --help
```

**Step 4: Commit**

```bash
git add src/commands/validate.ts src/index.ts
git commit -m "feat: add validate command for rig authors"
```

---

## Task 7: Inspect Command

**Files:**
- Create: `src/commands/inspect.ts`
- Modify: `src/index.ts`

Embodies the "review before adopting" philosophy — lets users or agents examine a rig before installing.

**Step 1: Implement inspect command**

Create `src/commands/inspect.ts`:

```typescript
import chalk from "chalk";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadManifest } from "../loader.js";
import { resolveSource } from "../loader.js";

const execFileAsync = promisify(execFile);

export async function inspectCommand(sourceArg: string, opts: { json?: boolean }) {
  const source = resolveSource(sourceArg);

  let dir: string;
  if (source.type === "local") {
    dir = source.path;
  } else {
    dir = join(tmpdir(), `agent-rig-inspect-${source.repo}-${Date.now()}`);
    await execFileAsync("git", ["clone", "--depth", "1", source.url, dir], { timeout: 60_000 });
  }

  const rig = await loadManifest(dir);

  if (opts.json) {
    console.log(JSON.stringify(rig, null, 2));
    return;
  }

  console.log(chalk.bold(`\n${rig.name} v${rig.version}`));
  console.log(chalk.dim(rig.description));
  console.log(`Author: ${rig.author}${rig.license ? ` | License: ${rig.license}` : ""}`);
  if (rig.repository) console.log(`Repo: https://github.com/${rig.repository}`);

  if (rig.plugins) {
    console.log(chalk.bold("\nPlugins"));
    if (rig.plugins.core) {
      console.log(`  ${chalk.cyan("core")}  ${rig.plugins.core.source}`);
    }
    for (const p of rig.plugins.required ?? []) {
      console.log(`  ${chalk.green("req")}   ${p.source}${p.description ? chalk.dim(` — ${p.description}`) : ""}`);
    }
    for (const p of rig.plugins.recommended ?? []) {
      console.log(`  ${chalk.yellow("rec")}   ${p.source}${p.description ? chalk.dim(` — ${p.description}`) : ""}`);
    }
    for (const p of rig.plugins.infrastructure ?? []) {
      console.log(`  ${chalk.blue("infra")} ${p.source}${p.description ? chalk.dim(` — ${p.description}`) : ""}`);
    }
    if (rig.plugins.conflicts?.length) {
      console.log(chalk.bold("\nConflicts (will be disabled)"));
      for (const c of rig.plugins.conflicts) {
        console.log(`  ${chalk.red("off")}   ${c.source}${c.reason ? chalk.dim(` — ${c.reason}`) : ""}`);
      }
    }
  }

  if (rig.mcpServers) {
    console.log(chalk.bold("\nMCP Servers"));
    for (const [name, server] of Object.entries(rig.mcpServers)) {
      const detail = server.type === "http" ? server.url : server.type === "stdio" ? server.command : server.url;
      console.log(`  ${chalk.cyan(name)}  ${server.type}  ${detail}`);
    }
  }

  if (rig.tools?.length) {
    console.log(chalk.bold("\nExternal Tools"));
    for (const t of rig.tools) {
      const opt = t.optional ? chalk.dim(" (optional)") : "";
      console.log(`  ${t.name}${opt}${t.description ? chalk.dim(` — ${t.description}`) : ""}`);
    }
  }

  if (rig.environment && Object.keys(rig.environment).length > 0) {
    console.log(chalk.bold("\nEnvironment Variables"));
    for (const [k, v] of Object.entries(rig.environment)) {
      console.log(`  ${k}=${v}`);
    }
  }

  console.log();
}
```

**Step 2: Wire up to `src/index.ts`**

Add import and command registration.

**Step 3: Build and verify**

```bash
pnpm build && node dist/index.js inspect --help
```

**Step 4: Commit**

```bash
git add src/commands/inspect.ts src/index.ts
git commit -m "feat: add inspect command for reviewing rigs before installation"
```

---

## Task 8: Init Command (Rig Author Scaffolding)

**Files:**
- Create: `src/commands/init.ts`
- Modify: `src/index.ts`

Interactive scaffolding — creates a starter `agent-rig.json`.

**Step 1: Implement init command**

Create `src/commands/init.ts`:

```typescript
import chalk from "chalk";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

async function ask(rl: ReturnType<typeof createInterface>, question: string, defaultVal?: string): Promise<string> {
  return new Promise((resolve) => {
    const prompt = defaultVal ? `${question} (${defaultVal}): ` : `${question}: `;
    rl.question(prompt, (answer) => resolve(answer.trim() || defaultVal || ""));
  });
}

export async function initCommand(dir: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold("\nCreate a new agent-rig.json\n"));

  const name = await ask(rl, "Rig name (kebab-case)", "my-rig");
  const version = await ask(rl, "Version", "0.1.0");
  const description = await ask(rl, "Description", "My agent rig");
  const author = await ask(rl, "Author");

  rl.close();

  const manifest = {
    name,
    version,
    description,
    author,
    license: "MIT",
    plugins: {
      required: [],
      recommended: [],
      conflicts: [],
    },
    mcpServers: {},
    tools: [],
    platforms: {
      "claude-code": {
        marketplaces: [],
      },
    },
  };

  const outPath = join(dir, "agent-rig.json");
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(chalk.green(`\nCreated ${outPath}`));
  console.log(chalk.dim("Edit this file to add plugins, MCP servers, and tools."));
  console.log(chalk.dim("Validate with: agent-rig validate"));
}
```

**Step 2: Wire up to CLI**

Add import and command registration to `src/index.ts`.

**Step 3: Build and verify**

```bash
pnpm build && node dist/index.js init --help
```

**Step 4: Commit**

```bash
git add src/commands/init.ts src/index.ts
git commit -m "feat: add init command for scaffolding new agent-rig.json manifests"
```

---

## Task 9: Reference Manifest for Clavain

**Files:**
- Create: `examples/clavain/agent-rig.json`

Create the reference `agent-rig.json` describing Clavain as a rig. Serves as documentation and validation test.

**Step 1: Write the manifest**

See `examples/clavain/agent-rig.json` — full Clavain rig with all 5 layers:
- 1 core plugin, 9 required, 4 recommended (language servers), 8 conflicts
- 3 MCP servers (context7, agent-mail, qmd)
- 4 external tools (oracle, codex, beads, qmd) — all optional
- 2 environment variables
- Claude Code + Codex platform configs

**Step 2: Validate with our own tool**

```bash
pnpm build && node dist/index.js validate examples/clavain
```

Expected: "Valid!" with summary

**Step 3: Test inspect output**

```bash
node dist/index.js inspect examples/clavain
```

Expected: Pretty-printed summary

**Step 4: Commit**

```bash
git add examples/clavain/agent-rig.json
git commit -m "feat: add Clavain reference manifest as first agent-rig.json example"
```

---

## Task 10: README and Project Documentation

**Files:**
- Create: `README.md`
- Create: `CLAUDE.md`
- Create: `AGENTS.md`

**Step 1: Write README.md**

Key sections:
1. What is an Agent Rig? (modpack analogy, "review before adopting" philosophy)
2. Quick Start (`npx agent-rig install owner/repo`)
3. The `agent-rig.json` Manifest (format reference)
4. CLI Commands (install, validate, inspect, init)
5. Creating Your Own Rig
6. Philosophy

**Step 2: Write CLAUDE.md** — Minimal quick reference

**Step 3: Write AGENTS.md** — Architecture, adapters, testing, contribution guide

**Step 4: Commit**

```bash
git add README.md CLAUDE.md AGENTS.md
git commit -m "docs: add README, CLAUDE.md, and AGENTS.md"
```

---

## Task 11: End-to-End Test with Clavain Example

**Files:**
- Create: `src/e2e.test.ts`

**Step 1: Write e2e test**

Test the full flow: load manifest, validate, check counts, verify platform configs.

**Step 2: Run all tests**

```bash
pnpm build && node --test dist/**/*.test.js
```

Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/e2e.test.ts
git commit -m "test: add end-to-end test with Clavain example manifest"
```

---

## Summary

| Task | Component | Files |
|------|-----------|-------|
| 1 | Project scaffolding | package.json, tsconfig.json, src/index.ts |
| 2 | Manifest schema | src/schema.ts |
| 3 | Manifest loader | src/loader.ts |
| 4 | Platform adapters | src/adapters/{types,claude-code,codex}.ts |
| 5 | Install command | src/commands/install.ts |
| 6 | Validate command | src/commands/validate.ts |
| 7 | Inspect command | src/commands/inspect.ts |
| 8 | Init command | src/commands/init.ts |
| 9 | Clavain reference manifest | examples/clavain/agent-rig.json |
| 10 | Documentation | README.md, CLAUDE.md, AGENTS.md |
| 11 | End-to-end tests | src/e2e.test.ts |

**Total: 11 tasks, ~18 files, incremental commits after each task.**
