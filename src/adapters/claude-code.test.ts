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
