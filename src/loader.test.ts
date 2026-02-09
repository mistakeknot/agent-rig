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
      }),
    );
    const result = await loadManifest(testDir);
    assert.equal(result.name, "test-rig");
    rmSync(testDir, { recursive: true });
  });

  it("throws on missing agent-rig.json", async () => {
    await assert.rejects(
      () => loadManifest("/nonexistent/path"),
      /not found|ENOENT/,
    );
  });

  it("throws on invalid manifest", async () => {
    const badDir = join(tmpdir(), "agent-rig-bad-" + Date.now());
    mkdirSync(badDir, { recursive: true });
    writeFileSync(
      join(badDir, "agent-rig.json"),
      JSON.stringify({ name: 123 }),
    );
    await assert.rejects(() => loadManifest(badDir), /validation/i);
    rmSync(badDir, { recursive: true });
  });
});
