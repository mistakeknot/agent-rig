# Architecture Decision Review: agent-rig

**Date:** 2026-02-08
**Scope:** Full architectural review of the agent-rig TypeScript CLI project
**Reviewer:** System Architecture Expert (Claude Opus 4.6)

---

## 1. Architecture Overview

agent-rig is a TypeScript CLI tool that packages, shares, and installs "agent rigs" -- modpacks for AI coding agents. The system resolves a manifest source (GitHub or local), parses a declarative `agent-rig.json` manifest through Zod validation, then delegates installation to platform-specific adapters.

### Component Map

```
src/
  index.ts              CLI entry point (commander.js)
  schema.ts             Zod schema -- single source of truth for manifest format
  loader.ts             Source resolution + manifest loading/validation
  adapters/
    types.ts            PlatformAdapter interface contract
    claude-code.ts      Claude Code adapter (fully implemented)
    codex.ts            Codex CLI adapter (stub)
  commands/
    install.ts          Core install orchestration
    validate.ts         Schema validation command
    inspect.ts          Read-only rig examination
    init.ts             Interactive scaffolding
```

### Dependency Graph

```
index.ts
  -> commands/install.ts -> loader.ts -> schema.ts
                         -> adapters/claude-code.ts -> adapters/types.ts
                         -> adapters/codex.ts -> adapters/types.ts
                         -> schema.ts
  -> commands/validate.ts -> loader.ts -> schema.ts
  -> commands/inspect.ts -> loader.ts -> schema.ts
  -> commands/init.ts (standalone -- no adapter deps)
```

No circular dependencies exist. The dependency graph flows strictly downward: commands depend on loader and adapters; loader depends on schema; adapters depend on types and schema. This is clean and correct.

### External Dependencies (3 runtime)

| Package    | Version | Purpose              |
|------------|---------|----------------------|
| zod        | ^4.3.6  | Schema validation    |
| commander  | ^14.0.3 | CLI argument parsing |
| chalk      | ^5.6.2  | Terminal formatting  |

Minimal dependency surface. All three are well-chosen, widely-used libraries. No transitive bloat.

---

## 2. PlatformAdapter Interface Design (`src/adapters/types.ts`)

### Current Design

```typescript
export interface PlatformAdapter {
  name: string;
  detect(): Promise<boolean>;
  installPlugins(rig: AgentRig): Promise<InstallResult[]>;
  disableConflicts(rig: AgentRig): Promise<InstallResult[]>;
  addMarketplaces(rig: AgentRig): Promise<InstallResult[]>;
  verify(rig: AgentRig): Promise<InstallResult[]>;
}
```

### Assessment: Strong Foundation

**Strengths:**

1. **Correct abstraction level.** The interface captures exactly the four operations that matter across platforms: marketplace registration, plugin installation, conflict resolution, and health verification. This maps directly to the install command's orchestration flow.

2. **Uniform return type.** Every method returns `Promise<InstallResult[]>`, making the install command's orchestration loop trivially simple. The `InstallResult` type with its four-state status (`installed | skipped | failed | disabled`) is expressive enough for all current needs.

3. **Detection pattern.** The `detect()` method enables auto-discovery of available platforms. The install command iterates all known adapters, detects which are present, and runs only those. This is the correct pattern for a multi-platform tool.

4. **Whole-rig parameter.** Each method receives the full `AgentRig` object rather than pre-sliced subsets. This allows adapters to inspect cross-cutting concerns (e.g., Claude Code adapter reading `platforms["claude-code"].marketplaces` in `addMarketplaces()`).

**Observations:**

1. **No `configureMcpServers()` method.** MCP server configuration is currently not handled by any adapter. The `verify()` method in `ClaudeCodeAdapter` checks health endpoints, but no adapter actually registers MCP servers with the platform. This is the most significant gap in the adapter interface. When Claude Code or Codex has an MCP server registration API, a `configureMcpServers(rig: AgentRig): Promise<InstallResult[]>` method will be needed.

2. **No `configureEnvironment()` method.** Environment variables are currently printed to the console by the install command with instructions to "add these to your shell profile." This is reasonable for v1 (environment modification is dangerous and platform-specific), but a future adapter method could handle this per-platform.

3. **Adapter registration is hardcoded.** In `commands/install.ts`, the adapters array is:
   ```typescript
   const adapters: PlatformAdapter[] = [
     new ClaudeCodeAdapter(),
     new CodexAdapter(),
   ];
   ```
   For two adapters, hardcoding is appropriate. At 4+ adapters, a registry pattern would be warranted.

4. **No lifecycle hooks.** There is no `preInstall()` / `postInstall()` or `cleanup()` method. If a partial installation fails, there is no rollback mechanism. For v1 with idempotent operations this is acceptable; for v2 with stateful operations it may not be.

5. **The interface accepts `AgentRig` but the Codex adapter casts to `any`.** In `codex.ts` line 37: `const installScript = (codexConfig as any).installScript;`. The `Platforms` schema uses `.catchall()` for unknown platforms, which means the Codex-specific fields are typed as `Record<string, unknown>`. The adapter has to cast because the type system loses the specific `CodexPlatform` shape after the `catchall`. This is a minor type-safety gap.

### Verdict: The interface is well-designed for the current scope. The most impactful future addition would be `configureMcpServers()`.

---

## 3. Schema-First Approach with Zod (`src/schema.ts`)

### Assessment: Excellent

The schema-first approach is the strongest architectural decision in the project. By defining the entire manifest format as a Zod schema, the project gets:

1. **Single source of truth.** The `AgentRig` TypeScript type is derived via `z.infer<typeof AgentRigSchema>`, eliminating type drift.

2. **Runtime validation with rich errors.** The `loadManifest()` function uses `safeParse()` and formats all issues with paths and messages. Invalid manifests are caught immediately with clear error output.

3. **Self-documenting.** Each field has `.describe()` annotations that serve as inline documentation. These descriptions could be programmatically extracted for docs generation.

4. **Discriminated unions for MCP servers.** The `McpServer` type uses `z.discriminatedUnion("type", [...])`, which is the correct Zod pattern for tagged unions. This provides both type narrowing in TypeScript and precise validation error messages ("Expected 'http' | 'stdio' | 'sse'").

5. **Progressive schema evolution.** The `extends` field is declared as optional with a comment "v2 -- accepted but not acted on." This is a sound forward-compatibility strategy: the schema accepts the field today so existing manifests will not break when the feature is implemented.

**Observations:**

1. **The `Platforms` schema uses `.catchall()` for extensibility:**
   ```typescript
   const Platforms = z.object({
     "claude-code": ClaudeCodePlatform.optional(),
     codex: CodexPlatform.optional(),
   }).catchall(z.record(z.string(), z.unknown()));
   ```
   This is a deliberate tradeoff: known platforms get typed validation, unknown platforms pass through as untyped records. It allows third-party platforms to add their own config blocks without schema changes. The tradeoff is that typos in known platform names (e.g., `"cladue-code"`) will silently pass validation instead of producing an error. This is acceptable for the target audience (rig authors who will also be running `validate`).

2. **Plugin source format is a bare string.** The `PluginRef.source` is typed as `z.string()` with a description "Plugin identifier: name@marketplace". There is no structural validation of the `name@marketplace` format. A regex like `/^[a-z0-9-]+@[a-z0-9-]+$/` would catch malformed plugin references at parse time rather than at install time. However, since different platforms may have different source format conventions, keeping this loose is defensible.

3. **`ExternalTool.install` and `ExternalTool.check` are raw shell commands.** This is architecturally necessary (tools can be anything), but worth noting as a security surface. The `check` command is always run; `install` is run only if `check` fails. Both are executed via `sh -c`, which is the appropriate pattern.

4. **Environment values are `z.record(z.string(), z.string())`.** This prevents complex values but also prevents template expressions (e.g., `"${HOME}/.config"`). For v1, plain strings are correct. If template support is added later, the type would need to change.

5. **No version constraints on schema.** There is no `schemaVersion` or `$schema` field. If the manifest format changes incompatibly, there is no mechanism to detect which schema version a manifest was written for. Adding a `schemaVersion: z.literal(1).default(1)` would be a low-cost future-proofing measure.

### Verdict: The schema design is sound, well-typed, and appropriately flexible.

---

## 4. Source Resolution Strategy (`src/loader.ts` -- `resolveSource`)

### Current Priority Chain

```
1. Absolute/relative paths (starts with /, ./, ../)  -> LocalSource
2. Full GitHub URLs (https://github.com/owner/repo)   -> GitHubSource
3. Existing paths on disk (existsSync check)           -> LocalSource
4. GitHub owner/repo shorthand (word/word)             -> GitHubSource
5. Fallback                                            -> LocalSource
```

### Assessment: Pragmatic and Correct

**Strengths:**

1. **Explicit paths first.** Anything starting with `/`, `./`, or `../` is unambiguously local. This is correct and eliminates ambiguity.

2. **Disk-existence check resolves ambiguity.** The string `"examples/clavain"` could be either `owner=examples, repo=clavain` on GitHub or a local directory. By checking `existsSync()` before the GitHub shorthand regex, local paths always win. This follows the principle of least surprise.

3. **Full URLs handled via regex.** The `ghUrlMatch` regex `^https?:\/\/github\.com\/([^/]+)\/([^/.]+)` correctly extracts owner and repo from GitHub URLs. The `[^/.]` exclusion for the repo capture prevents matching `.git` suffixes.

4. **Graceful fallback.** Unrecognized inputs fall through to `LocalSource`, which will fail with a clear "agent-rig.json not found" error from `loadManifest()`. This is better than throwing at resolution time.

**Observations:**

1. **`existsSync()` is synchronous.** In an otherwise fully async codebase, this is the one sync I/O call. It is used in `resolveSource()` which itself is synchronous (returns `RigSource`, not `Promise<RigSource>`). The sync call is justified here: the function is called once per CLI invocation, and making it async would cascade unnecessary complexity upward. This is a reasonable pragmatic choice.

2. **No support for tags/branches/refs.** `owner/repo#v2.0` or `owner/repo@main` are not parsed. The `--depth 1` clone always gets the default branch. This is fine for v1 but will need addressing when lock files or pinned versions are added.

3. **No validation of GitHub owner/repo format.** The regex `^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$` is permissive enough to match valid GitHub identifiers but does not enforce GitHub's actual constraints (e.g., no consecutive hyphens, no starting with a hyphen). This is acceptable -- overly strict validation would create false negatives.

4. **Clone destination uses `Date.now()` for uniqueness.** `join(tmpdir(), "agent-rig-${source.repo}-${Date.now()}")` avoids collisions but does not clean up after itself. Temporary directories accumulate. This is a known v1 limitation.

5. **No caching.** Every `install` or `inspect` of a GitHub source does a fresh shallow clone. For a modpack installer that runs infrequently, this is acceptable. A local cache keyed by `owner/repo@commitHash` would be a reasonable v2 optimization.

### Verdict: The resolution strategy is well-ordered and handles the common cases correctly. The priority chain avoids ambiguity without being overly clever.

---

## 5. Command Structure and Separation of Concerns

### Assessment: Clean Separation

The four commands follow a consistent pattern:

| Command   | Reads Manifest | Writes to Disk | Executes Commands | Interactive |
|-----------|:-----------:|:-----------:|:------------:|:-----------:|
| install   | Yes         | Yes (via adapters) | Yes          | No          |
| validate  | Yes         | No          | No           | No          |
| inspect   | Yes         | No          | No (except clone) | No     |
| init      | No          | Yes         | No           | Yes         |

**Strengths:**

1. **Each command is a single exported async function** in its own file. No shared mutable state. No command depends on another command.

2. **The install command is the orchestrator.** It is the only command that coordinates adapters, tools, and environment. The other three commands are deliberately simple, each doing one thing.

3. **Dry-run support** is implemented as an early return in `installCommand`. The manifest is loaded and displayed but no side effects occur. This is the correct pattern.

4. **The inspect command** duplicates the clone logic from install. Both commands have their own `cloneToLocal()` / inline clone code. This is a minor DRY violation but keeps each command self-contained. Given that the clone logic is ~5 lines, extracting it into a shared utility is a judgment call -- either approach is defensible.

**Observations:**

1. **Tool installation lives in `commands/install.ts`, not in an adapter.** The `installTools()` function is a top-level function in the install command, not part of any adapter. This is architecturally correct: external tools (like `oracle`, `codex`, `qmd`) are platform-agnostic. They are system-level dependencies that exist outside any specific AI platform. Keeping them separate from adapters avoids forcing adapters to handle concerns outside their platform boundary.

2. **Environment variable handling is purely informational.** The install command prints environment variables to the console but does not modify any files. This is the safe choice. Automatically modifying `.bashrc` or `.zshrc` would be a significant escalation of the tool's authority.

3. **No shared error-handling middleware.** Each command catches errors independently. For four commands, this is fine. At scale, a shared error boundary (e.g., a wrapper that catches, formats, and exits) would reduce duplication.

4. **`process.exit(1)` is called directly** in `validateCommand` and `installCommand` on failure. This is standard for CLI tools and appropriate here.

5. **The init command does not validate its output against the schema.** It constructs a manifest object and writes it directly. Since the constructed object uses hardcoded keys that match the schema, this works in practice, but running `AgentRigSchema.parse()` on the output before writing would add a safety guarantee.

### Verdict: The command structure is well-organized with appropriate separation of concerns.

---

## 6. The Five-Layer Manifest Design

The `agent-rig.json` manifest defines five layers:

```
Layer 1: Plugins    (core, required, recommended, infrastructure, conflicts)
Layer 2: MCP Servers (http, stdio, sse)
Layer 3: External Tools (install/check shell commands)
Layer 4: Environment Variables (key-value pairs)
Layer 5: Platform Configs (claude-code marketplaces, codex scripts, etc.)
```

### Assessment: Sound Layering

**Why this layering works:**

1. **Each layer has a different installation mechanism.** Plugins are installed via platform CLIs. MCP servers need to be registered with a platform's config. Tools are installed via shell commands. Environment variables go in shell profiles. Platform configs are platform-specific. Separating them by mechanism is correct because the orchestrator needs to dispatch each layer differently.

2. **Layers are independent.** A rig can have plugins but no tools, or tools but no plugins. Every layer is optional. This supports progressive adoption: a rig author can start with just plugins and add layers over time.

3. **The plugin layer is the most granular.** Having five sub-categories (core, required, recommended, infrastructure, conflicts) provides semantic clarity. The distinction between `required` and `recommended` guides both the installer and human readers about what is essential vs. nice-to-have. The `infrastructure` category (language servers, domain-specific tools) is a useful third axis that does not cleanly fit into required/recommended.

4. **MCP servers as a first-class layer.** MCP (Model Context Protocol) servers are increasingly important in the AI agent ecosystem. Giving them their own layer with typed transport variants (http/stdio/sse) demonstrates forward-thinking design. The discriminated union ensures type safety at the transport level.

5. **Platform configs as a cross-cutting layer.** Rather than embedding platform-specific details throughout each layer, platform configs are collected into a single top-level `platforms` key. This keeps the core manifest platform-agnostic while allowing platform-specific augmentation.

**Observations:**

1. **Plugin categories all install the same way.** Currently, `required`, `recommended`, and `infrastructure` plugins are all installed unconditionally in `ClaudeCodeAdapter.installPlugins()`. The categorical distinction exists only for documentation/inspection purposes. This is fine for v1, but `recommended` could plausibly prompt for user confirmation in an interactive mode. The schema supports this distinction even though the installer does not yet use it.

2. **MCP servers are not installed.** No adapter actually registers MCP servers with the platform. The `verify()` method checks health endpoints for http servers, but there is no step that writes MCP server configurations to Claude Code's settings or Codex's config. This means a rig that specifies MCP servers will validate and inspect correctly, but `install` will not actually configure them. This is the most significant functional gap. When MCP server registration is implemented, the adapter interface should gain a `configureMcpServers()` method, and the install orchestrator should call it.

3. **No dependency ordering between layers.** The install command processes layers sequentially (marketplaces, plugins, conflicts, tools, verify), but there is no declared dependency between layers. For example, a tool might be required by an MCP server (e.g., `qmd` tool must be installed before the `qmd` MCP server can function). The current sequential ordering happens to handle this correctly (tools install before verify), but there is no explicit mechanism for expressing inter-layer dependencies.

4. **The `extends` field enables rig composition but is not yet implemented.** The schema accepts `extends: "owner/repo"` as forward-compatible syntax. When implemented, this will introduce significant complexity: manifest merging, conflict resolution between parent and child rigs, and version pinning. The current placeholder approach is correct -- ship the field definition now so manifests can declare intent, implement later.

### Verdict: The five-layer design is architecturally sound. The layers map to distinct installation mechanisms, are independently optional, and support progressive adoption.

---

## 7. Error Handling Patterns

### Assessment: Consistent and Appropriate for v1

**Pattern 1: Schema validation errors** (`loader.ts`)

```typescript
const result = AgentRigSchema.safeParse(parsed);
if (!result.success) {
  const issues = result.error.issues
    .map((i) => `  ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Manifest validation failed:\n${issues}`);
}
```

This is the best error handling in the codebase. It uses Zod's `safeParse()` instead of `parse()`, formats all issues with their schema paths, and throws a descriptive error. The path formatting (`i.path.join(".")`) produces messages like `plugins.required.0.source: Required` which are immediately actionable.

**Pattern 2: Adapter operation errors** (`adapters/claude-code.ts`)

```typescript
const { ok, output } = await run("claude", [...]);
results.push({
  component: `plugin:${plugin.source}`,
  status: ok || output.includes("already") ? "installed" : "failed",
  message: ok ? plugin.description : output,
});
```

Adapter errors are collected, not thrown. Every adapter operation produces an `InstallResult` regardless of success or failure. This is the correct pattern for a batch installer: you want to install everything possible and report all results, not halt on the first failure.

The `output.includes("already")` heuristic for detecting already-installed plugins is brittle but pragmatic. If the Claude CLI changes its output format, this check would silently break. A more robust approach would be to check the exit code and known output patterns separately.

**Pattern 3: Tool installation errors** (`commands/install.ts`)

```typescript
try {
  await execFileAsync("sh", ["-c", tool.install], { timeout: 120_000 });
  results.push({ component: `tool:${tool.name}`, status: "installed" });
} catch (err: any) {
  results.push({
    component: `tool:${tool.name}`,
    status: "failed",
    message: err.message,
  });
}
```

Same collect-don't-throw pattern as adapters. Good. The 120-second timeout on tool installation is generous but reasonable (some tools like Go binaries take time to compile).

**Pattern 4: Clone errors** (`commands/install.ts`)

Clone errors are not caught -- they propagate as unhandled rejections and terminate the process. This is appropriate: if the source cannot be cloned, there is nothing to install.

**Observations:**

1. **No typed error classes.** All errors are plain `Error` instances. There is no `ManifestNotFoundError`, `ValidationError`, or `CloneError`. For four commands and two adapters, this is fine. Typed errors would become valuable when downstream consumers (e.g., a programmatic API) need to distinguish error types.

2. **The `err: any` cast is used throughout.** This is the standard TypeScript pattern for error handling in catch blocks (since caught values are `unknown` in strict mode). It works but sacrifices type safety. A utility like `function getErrorMessage(err: unknown): string` would centralize this.

3. **No retry logic.** Network operations (git clone, curl health checks) fail immediately with no retry. For a CLI tool that runs once, this is acceptable. A single retry with backoff would improve reliability for transient network issues.

4. **Timeouts are set but not uniform.** Git clone: 60s. Health check (curl): 2s. Tool check: 5s. Tool install: 120s. Adapter operations: 30s. These values are reasonable and appropriate for their contexts. They are hardcoded but could be configurable via CLI flags in a future version.

### Verdict: Error handling follows a consistent collect-and-report pattern for adapter operations and a fail-fast pattern for preconditions. Both patterns are appropriate for their contexts.

---

## 8. Extensibility Assessment

### Adding a New Platform Adapter

The documented path (from AGENTS.md) is:
1. Create `src/adapters/my-platform.ts` implementing `PlatformAdapter`
2. Add it to the adapters array in `src/commands/install.ts`
3. Add platform config to the `Platforms` schema in `src/schema.ts`
4. Add tests

This is straightforward and follows the Open/Closed Principle: the adapter interface is closed for modification but open for extension via new implementations. The only modification required to existing code is adding the new adapter to the hardcoded array in `install.ts` and the schema in `schema.ts`.

**Assessment:** The extensibility path for new platforms is clean. The `.catchall()` on the `Platforms` schema even allows unknown platforms to pass validation before a formal adapter exists.

### Adding Rig Composition (`extends`)

The `extends` field is already in the schema. Implementation would require:
1. Resolving the parent rig source
2. Loading the parent manifest
3. Deep-merging parent and child manifests with conflict resolution
4. Handling diamond dependencies (rig A extends B, B extends C)

The current architecture supports this: `resolveSource` and `loadManifest` are already factored out as standalone functions that can be called recursively. The merge logic would be the complex part, not the loading.

### Adding New Manifest Layers

Adding a sixth layer (e.g., `hooks`, `workflows`, `profiles`) would require:
1. Adding the Zod schema for the new layer
2. Adding processing logic to the install command or a relevant adapter
3. Optionally adding display logic to inspect/validate

The flat structure of `AgentRigSchema` (all layers are optional top-level keys) makes this trivial.

---

## 9. Compliance Check: Architectural Principles

### SOLID Principles

| Principle | Status | Notes |
|-----------|--------|-------|
| Single Responsibility | Met | Each file has one clear purpose |
| Open/Closed | Met | New adapters extend without modifying existing code (except registration) |
| Liskov Substitution | Met | Both adapters are interchangeable through the interface |
| Interface Segregation | Met | PlatformAdapter is cohesive -- all methods are relevant to all adapters |
| Dependency Inversion | Partially Met | Commands depend on concrete adapter classes, not just the interface |

The DI observation: `install.ts` directly imports `ClaudeCodeAdapter` and `CodexAdapter`. It does use the `PlatformAdapter` type for the array, but construction is hardcoded. An adapter registry or factory would complete the DI pattern, but this is over-engineering for two adapters.

### Additional Principles

| Principle | Status | Notes |
|-----------|--------|-------|
| No circular dependencies | Met | Strict downward dependency flow |
| Consistent abstraction levels | Met | Schema/loader/adapter/command layers are cleanly separated |
| Convention over configuration | Met | Default file name `agent-rig.json`, default branch on clone |
| Fail fast | Met | Schema validation happens immediately after loading |

---

## 10. Risk Analysis

### Low Risk

1. **Temporary directory accumulation.** Cloned repos in `/tmp` are not cleaned up. In practice, OS-level tmp cleanup handles this, but explicit cleanup with `finally` blocks would be more hygienic.

2. **`output.includes("already")` heuristic.** Fragile string matching for idempotency detection. Could break if CLI output changes.

3. **Init command does not validate output.** The scaffolded manifest is not run through the schema before writing. A typo in the init template would produce an invalid manifest.

### Medium Risk

4. **MCP servers are specified but not installed.** Users may expect `install` to configure MCP servers. The gap between what the manifest declares and what the installer acts on could cause confusion. Clear documentation or a warning message during install would mitigate this.

5. **Codex adapter type safety gap.** The `(codexConfig as any).installScript` cast bypasses TypeScript's type system. If the `CodexPlatform` schema changes, this cast will silently accept the old field names. A type guard or explicit schema extraction would be safer.

### Architectural Debt (Future Consideration)

6. **No rollback mechanism.** A partially failed install leaves the system in an intermediate state. For idempotent operations (plugin installs), this is safe. For stateful operations (MCP server registration, environment changes), rollback would become important.

7. **No schema versioning.** Without a `schemaVersion` field, breaking changes to the manifest format cannot be detected or migrated. Adding this before v1.0 would be prudent.

---

## 11. Recommendations

### High Priority (Before v1.0)

1. **Add `configureMcpServers()` to the `PlatformAdapter` interface** and implement it for Claude Code. MCP servers are a first-class manifest layer that currently has no installation path.

2. **Add `schemaVersion: z.literal(1).default(1)` to the manifest schema.** This costs nothing now and prevents painful migration later.

3. **Validate the init command's output against the schema** before writing to disk. One line: `AgentRigSchema.parse(manifest)`.

### Medium Priority (v1.x)

4. **Extract the clone-to-local logic** into a shared function in `loader.ts`. Both `install.ts` and `inspect.ts` have near-identical clone code. The function already exists in `install.ts` as `cloneToLocal()` -- it just needs to move to the shared loader module.

5. **Add cleanup for temporary clone directories** using a `finally` block or a `withTempDir` utility.

6. **Add a `--platform` flag to the install command** to allow users to target a specific platform instead of auto-detecting all. This would help in environments where both platforms are present but the user only wants to configure one.

### Low Priority (v2)

7. **Consider an adapter registry pattern** when the adapter count exceeds 3-4. A `registerAdapter(adapter: PlatformAdapter)` function with auto-discovery would scale better than a hardcoded array.

8. **Add plugin source format validation.** A regex like `/^[\w-]+@[\w-]+$/` on `PluginRef.source` would catch malformed identifiers at schema validation time.

9. **Add ref/tag/branch support to `resolveSource`.** Patterns like `owner/repo#v2.0` or `owner/repo@main` would support version pinning.

---

## 12. Summary Judgment

The agent-rig architecture is well-designed for its current scope and complexity level. The key decisions -- schema-first validation with Zod, platform adapter pattern, collect-and-report error handling, and the five-layer manifest -- are all architecturally sound and follow established patterns correctly.

The codebase is small (~700 lines of source), focused, and free of architectural anti-patterns. Dependencies are minimal. The code is consistently formatted and follows a uniform style.

The most significant gap is that MCP server configuration, despite being a first-class manifest layer, has no installation pathway. Addressing this before v1.0 would bring the implementation in line with the manifest's design promise.

Overall architectural quality: **Strong.** The project demonstrates disciplined design decisions appropriate for its early stage, with clear extension points for planned future features.
