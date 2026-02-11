import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadManifest } from "./loader.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("E2E: Clavain example manifest", () => {
  const exampleDir = join(__dirname, "..", "examples", "clavain");

  it("loads and validates the Clavain manifest", async () => {
    const rig = await loadManifest(exampleDir);
    assert.equal(rig.name, "clavain");
    assert.equal(rig.version, "0.4.16");
    assert.ok(rig.plugins?.required && rig.plugins.required.length > 0);
    assert.ok(rig.plugins?.conflicts && rig.plugins.conflicts.length > 0);
    assert.ok(rig.mcpServers && Object.keys(rig.mcpServers).length > 0);
    assert.ok(rig.tools && rig.tools.length > 0);
  });

  it("has correct plugin counts", async () => {
    const rig = await loadManifest(exampleDir);
    assert.equal(rig.plugins?.required?.length, 9);
    assert.equal(rig.plugins?.conflicts?.length, 8);
    assert.equal(rig.plugins?.recommended?.length, 4);
  });

  it("has correct MCP server count", async () => {
    const rig = await loadManifest(exampleDir);
    assert.equal(Object.keys(rig.mcpServers ?? {}).length, 3);
  });

  it("has platform configurations", async () => {
    const rig = await loadManifest(exampleDir);
    assert.ok(rig.platforms?.["claude-code"]);
    assert.ok(rig.platforms?.["codex"]);
  });

  it("has correct tool count", async () => {
    const rig = await loadManifest(exampleDir);
    assert.equal(rig.tools?.length, 4);
    assert.ok(rig.tools?.every((t) => t.optional));
  });

  it("has environment variables", async () => {
    const rig = await loadManifest(exampleDir);
    assert.equal(rig.environment?.DISPLAY, ":99");
    assert.ok(rig.environment?.CHROME_PATH);
  });

  it("has marketplace configurations", async () => {
    const rig = await loadManifest(exampleDir);
    const marketplaces =
      rig.platforms?.["claude-code"]?.marketplaces ?? [];
    assert.equal(marketplaces.length, 2);
    assert.ok(marketplaces.some((m) => m.name === "interagency-marketplace"));
    assert.ok(marketplaces.some((m) => m.name === "claude-plugins-official"));
  });
});
