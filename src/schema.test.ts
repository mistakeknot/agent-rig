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
    assert.ok(
      result.success,
      `Validation failed: ${JSON.stringify(result.error?.issues)}`,
    );
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
          {
            source: "context7@claude-plugins-official",
            description: "Runtime doc fetching",
          },
          {
            source: "interdoc@interagency-marketplace",
            description: "AGENTS.md generation",
          },
        ],
        recommended: [
          {
            source: "serena@claude-plugins-official",
            description: "Semantic coding tools",
          },
        ],
        conflicts: [
          {
            source: "code-review@claude-plugins-official",
            reason: "Duplicates Clavain's review agents",
          },
        ],
      },

      mcpServers: {
        context7: {
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
            {
              name: "interagency-marketplace",
              repo: "mistakeknot/interagency-marketplace",
            },
          ],
        },
        codex: {
          installScript: "scripts/install-codex.sh",
        },
      },
    };
    const result = AgentRigSchema.safeParse(manifest);
    assert.ok(
      result.success,
      `Validation failed: ${JSON.stringify(result.error?.issues)}`,
    );
  });

  it("rejects a manifest missing required fields", () => {
    const result = AgentRigSchema.safeParse({ name: "test" });
    assert.ok(!result.success);
  });

  it("validates a manifest with behavioral config", () => {
    const manifest = {
      name: "my-rig",
      version: "1.0.0",
      description: "A rig with behavioral config",
      author: "testuser",
      behavioral: {
        "claude-md": {
          source: "config/CLAUDE.md",
          dependedOnBy: ["hooks.PreToolUse", "commands/commit"],
        },
        "agents-md": {
          source: "config/AGENTS.md",
        },
      },
    };
    const result = AgentRigSchema.safeParse(manifest);
    assert.ok(
      result.success,
      `Validation failed: ${JSON.stringify(result.error?.issues)}`,
    );
  });

  it("validates a manifest with behavioral config without dependedOnBy", () => {
    const manifest = {
      name: "my-rig",
      version: "1.0.0",
      description: "A rig with behavioral config",
      author: "testuser",
      behavioral: {
        "claude-md": {
          source: "config/CLAUDE.md",
        },
      },
    };
    const result = AgentRigSchema.safeParse(manifest);
    assert.ok(
      result.success,
      `Validation failed: ${JSON.stringify(result.error?.issues)}`,
    );
  });

  it("accepts manifest without behavioral field (backward compat)", () => {
    const manifest = {
      name: "legacy-rig",
      version: "1.0.0",
      description: "A rig without behavioral config",
      author: "testuser",
      plugins: {
        core: { source: "my-plugin@marketplace" },
      },
    };
    const result = AgentRigSchema.safeParse(manifest);
    assert.ok(
      result.success,
      `Validation failed: ${JSON.stringify(result.error?.issues)}`,
    );
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
