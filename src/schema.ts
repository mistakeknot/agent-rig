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

const McpServer = z.discriminatedUnion("type", [
  McpServerHttp,
  McpServerStdio,
  McpServerSse,
]);

// --- External tools ---

const ExternalTool = z.object({
  name: z.string(),
  install: z.string().describe("Shell command to install the tool"),
  check: z.string().describe("Shell command to check if tool is already installed"),
  optional: z.boolean().default(false),
  description: z.string().optional(),
  platforms: z
    .record(z.string(), z.string())
    .optional()
    .describe("Platform-specific install commands"),
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
  installScript: z
    .string()
    .optional()
    .describe("Path to Codex CLI install script"),
  skillsDir: z
    .string()
    .optional()
    .describe("Where to symlink skills for Codex"),
});

const Platforms = z
  .object({
    "claude-code": ClaudeCodePlatform.optional(),
    codex: CodexPlatform.optional(),
  })
  .catchall(z.record(z.string(), z.unknown()));

// --- Top-level schema ---

export const AgentRigSchema = z.object({
  // Identity
  name: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Must be lowercase kebab-case"),
  version: z.string().regex(/^\d+\.\d+\.\d+/, "Must be semver"),
  description: z.string(),
  author: z.string(),
  license: z.string().optional(),
  repository: z.string().optional().describe("GitHub owner/repo"),
  keywords: z.array(z.string()).optional(),

  // Composition (v2 — accepted but not acted on)
  extends: z
    .string()
    .optional()
    .describe("Parent rig to extend (GitHub owner/repo)"),

  // Layer 1+2: Plugins
  plugins: z
    .object({
      core: CorePluginRef.optional(),
      required: z.array(PluginRef).optional(),
      recommended: z.array(PluginRef).optional(),
      infrastructure: z.array(PluginRef).optional(),
      conflicts: z.array(ConflictRef).optional(),
    })
    .optional(),

  // Layer 1: MCP Servers
  mcpServers: z.record(z.string(), McpServer).optional(),

  // Layer 3: External tools
  tools: z.array(ExternalTool).optional(),

  // Layer 4: Environment variables
  environment: z.record(z.string(), z.string()).optional(),

  // Platform-specific configuration
  platforms: Platforms.optional(),
});

export type AgentRig = z.infer<typeof AgentRigSchema>;
