# Behavioral Config Layer — Brainstorm

**Date:** 2026-02-09
**Status:** Decisions made — ready for implementation planning
**Problem:** agent-rig installs infrastructure (plugins, MCP servers, tools) but misses the files that shape *how the agent actually behaves*: `CLAUDE.md`, hooks, commands, workflows, skills, `AGENTS.md`, and settings.

---

## The Core Tension

A rig wants to install behavioral files into a project. But the user's project likely *already has* some of these files. Naively overwriting them destroys the user's setup. Naively skipping them makes the rig incomplete.

This is the classic config file problem (dpkg's "conffile" handling, dotfile managers, etc.).

## What Needs Installing

| File/Dir | Lives at | Conflict risk | Strategy |
|----------|----------|---------------|----------|
| `CLAUDE.md` | Project root | **Very high** | Pointer to namespaced file |
| `AGENTS.md` | Project root / `agents/` | **Medium** | Pointer to namespaced file |
| `.claude/settings.json` | `.claude/` | **High** | Deep merge with tracking |
| `.claude/commands/*.md` | `.claude/commands/` | **Medium** | Namespace in subdirectory |
| Hooks | `settings.json` registration | **Medium** | Settings merge + namespaced scripts |
| Skills | `.agent/skills/` | **Low** | Namespace in subdirectory |
| Workflows | `.agent/workflows/` | **Low** | Namespace in subdirectory |

---

## Decided Strategies

### Strategy 1: Namespace Everything (directory-based assets)

Commands, skills, and workflows install under a rig-specific subdirectory:

```
.claude/
  commands/
    clavain/              ← becomes /clavain:review, /clavain:commit
      review.md
      commit.md
  hooks/
    clavain/              ← scripts only; registration via settings.json
      pre-bash.sh
.agent/
  skills/
    clavain/
      code-review/
        SKILL.md
  workflows/
    clavain/
      pr-workflow.md
```

**Confirmed:** Claude Code natively supports subdirectory namespacing for commands. `.claude/commands/clavain/review.md` creates a `/clavain:review` slash command.

- Zero conflict risk
- Clean uninstall — `rm -rf` the namespace dirs
- Multiple rigs coexist naturally

---

### Strategy 2: Pointer-Based Inclusion (CLAUDE.md / AGENTS.md) ✅ DECIDED

Instead of merging content *into* root-level files, install the rig's instructions to a namespaced location and add a single pointer line to the root file. The AI agent reading the file becomes the merge engine — it reads both the user's instructions and the rig's instructions and reconciles them using its own judgment at runtime.

#### How it works

**Install** adds one line to the top of `CLAUDE.md`:

```markdown
<!-- agent-rig:clavain --> Also read and follow: .claude/rigs/clavain/CLAUDE.md

# My Project

Existing user content stays untouched...
```

The rig's actual instructions live at `.claude/rigs/clavain/CLAUDE.md`:

```markdown
# Clavain Engineering Discipline

- Always run tests before committing
- Use conventional commits
- Review all changes before pushing
...
```

**Uninstall** removes the single pointer line and deletes the namespaced file. The root `CLAUDE.md` returns to exactly its pre-install state.

Same pattern for `AGENTS.md`:

```markdown
<!-- agent-rig:clavain --> Also read: .claude/rigs/clavain/AGENTS.md

# My Project Agents
...existing content...
```

#### Why this is better than alternatives

| Approach | Downside | Pointer approach avoids it |
|----------|----------|---------------------------|
| Marker sections | Appended content can semantically conflict with user content | Agent reconciles at runtime |
| Suggested files | User must manually merge — breaks "one command" promise | Automatic, zero-friction |
| Interactive merge | Complex UX, hard to implement well | No interaction needed |
| Platform include paths | Requires upstream Claude Code changes | Works today with any agent |

#### Why the agent is the right merge engine

- CLAUDE.md is *natural language instructions for an LLM*. An LLM is the ideal tool to reconcile two sets of natural language instructions.
- The agent can use judgment: if the user's CLAUDE.md says "use tabs" and the rig says "use spaces," the agent can ask for clarification or prefer the user's rule (since it appears in the root file).
- No lossy programmatic merging of unstructured text.
- The agent already reads CLAUDE.md — adding one more file reference is trivial.

#### Multi-rig support

Multiple rigs just add multiple pointer lines:

```markdown
<!-- agent-rig:clavain --> Also read and follow: .claude/rigs/clavain/CLAUDE.md
<!-- agent-rig:other-rig --> Also read and follow: .claude/rigs/other-rig/CLAUDE.md

# My Project
...
```

Each rig owns its pointer line and its namespaced file. No rig touches another's. Semantic conflicts between rigs are handled by the same mechanism — the agent reads all files and reconciles.

#### Dependency warnings

If a rig's hooks or commands depend on certain CLAUDE.md instructions being followed, the manifest can declare this:

```json
"claude-md": {
  "source": "config/CLAUDE.md",
  "dependedOnBy": ["hooks.PreToolUse", "commands/commit"]
}
```

The install output warns:

```
⚠️  Clavain's pre-commit hook and /clavain:commit command depend on
    the conventions in .claude/rigs/clavain/CLAUDE.md
```

No "required" vs "recommended" distinction — user always stays in control, but sees the consequences.

---

### Strategy 3: Settings Deep Merge (settings.json)

`.claude/settings.json` is structured JSON — programmatic merge works well here.

**Rules:**
- Arrays → union (add rig entries, keep user entries)
- Objects → recursive merge
- Scalars → keep user value, warn if rig wanted different
- Track what the rig added (for clean uninstall)

```json
// User has:
{ "permissions": { "allow": ["Bash(git *)"], "deny": ["Bash(rm -rf *)"] } }

// Rig wants to add:
{ "permissions": { "allow": ["Bash(npm run lint)", "Bash(npm test)"] } }

// Result:
{ "permissions": { "allow": ["Bash(git *)", "Bash(npm run lint)", "Bash(npm test)"], "deny": ["Bash(rm -rf *)"] } }
```

---

### Strategy 4: Hook Registration (settings.json merge + namespaced scripts)

**Confirmed:** Hooks are registered in `settings.json`, not via file discovery.

Two-part install:
1. **Scripts** → namespaced files at `.claude/hooks/clavain/pre-bash.sh`
2. **Registration** → merge into `settings.json` hooks array:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": ".claude/hooks/clavain/pre-bash.sh" }] }
    ]
  }
}
```

Uninstall removes the settings entries (tracked in install manifest) and deletes the script files.

---

## Proposed Manifest Addition

```json
{
  "behavioral": {
    "claude-md": {
      "source": "config/CLAUDE.md",
      "dependedOnBy": ["hooks.PreToolUse", "commands/commit"]
    },
    "agents-md": {
      "source": "config/AGENTS.md"
    },
    "commands": {
      "source": "commands/"
    },
    "skills": {
      "source": "skills/"
    },
    "workflows": {
      "source": "workflows/"
    },
    "hooks": [
      {
        "event": "PreToolUse",
        "matcher": "Bash",
        "script": "hooks/pre-bash.sh"
      },
      {
        "event": "PostToolUse",
        "matcher": "Write|Edit",
        "script": "hooks/post-write-format.sh"
      }
    ],
    "settings": {
      "source": "config/settings.json"
    }
  }
}
```

All strategies are implicit from the asset type:
- `claude-md` / `agents-md` → pointer insertion + namespaced file
- `commands` / `skills` / `workflows` → namespaced directory copy
- `hooks` → namespaced script copy + settings.json merge
- `settings` → deep merge with tracking

---

## Install Manifest (for uninstall)

Everything tracked in `.claude/rigs/clavain/install-manifest.json`:

```json
{
  "rig": "clavain",
  "version": "0.4.2",
  "installedAt": "2026-02-09T15:44:00Z",
  "files": [
    ".claude/rigs/clavain/CLAUDE.md",
    ".claude/rigs/clavain/AGENTS.md",
    ".claude/commands/clavain/review.md",
    ".claude/commands/clavain/commit.md",
    ".claude/hooks/clavain/pre-bash.sh",
    ".agent/skills/clavain/code-review/SKILL.md",
    ".agent/workflows/clavain/pr-workflow.md"
  ],
  "pointers": [
    { "file": "CLAUDE.md", "line": "<!-- agent-rig:clavain --> Also read and follow: .claude/rigs/clavain/CLAUDE.md" },
    { "file": "AGENTS.md", "line": "<!-- agent-rig:clavain --> Also read: .claude/rigs/clavain/AGENTS.md" }
  ],
  "settingsMerge": {
    "permissions.allow": ["Bash(npm run lint)", "Bash(npm test)"],
    "hooks.PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": ".claude/hooks/clavain/pre-bash.sh" }] }]
  }
}
```

`agent-rig uninstall clavain`:
1. Remove pointer lines from root files
2. Reverse settings.json merge (remove tracked additions)
3. Delete all created files and namespace directories
4. Delete `.claude/rigs/clavain/`

---

## Dry Run Output

```
$ agent-rig install --dry-run mistakeknot/Clavain

📦 Plugins (9 install, 8 disable)
   ...

🔧 Tools (4 optional)
   ...

📁 Files to create:
   .claude/rigs/clavain/CLAUDE.md               ← rig instructions
   .claude/rigs/clavain/AGENTS.md               ← rig agent definitions
   .claude/commands/clavain/review.md            ← /clavain:review
   .claude/commands/clavain/commit.md            ← /clavain:commit
   .claude/hooks/clavain/pre-bash.sh             ← hook script
   .agent/skills/clavain/code-review/SKILL.md    ← skill

📝 Pointer lines to add:
   CLAUDE.md  ← "Also read and follow: .claude/rigs/clavain/CLAUDE.md"
   AGENTS.md  ← "Also read: .claude/rigs/clavain/AGENTS.md"

🔧 Settings merge:
   .claude/settings.json
     + permissions.allow[]: "Bash(npm run lint)", "Bash(npm test)"
     + hooks.PreToolUse[]: { matcher: "Bash", command: "..." }
```

---

## Lessons from PC Game Modding

The modpack analogy isn't just branding — game modding communities have solved many of these exact problems over 20+ years. Here are the patterns that map directly to agent-rig.

### 1. Virtual Filesystem (Mod Organizer 2)

MO2's core innovation: **never modify the game directory**. It creates a virtual overlay the game sees at runtime, while original files stay untouched. The pointer-based approach for CLAUDE.md is exactly this pattern — the root file is barely touched (one pointer line), the rig's content lives separately, and the agent creates the "virtual merge" at runtime. The modding community took ~10 years to converge on this (manual install → NMM → MO2's VFS). agent-rig gets to skip straight to the good answer.

### 2. Load Order

The central problem in Bethesda modding: when two mods touch the same thing, which wins? The answer is **load order** — later mods override earlier ones. The pointer approach creates a natural load order:

```markdown
<!-- agent-rig:base-discipline --> Also read: .claude/rigs/base-discipline/CLAUDE.md
<!-- agent-rig:clavain --> Also read: .claude/rigs/clavain/CLAUDE.md

# My Project
...user's own rules (highest priority — the root file always wins)...
```

Top-to-bottom pointer order, with the user's own root-file content as the final authority. `agent-rig reorder` could let users control priority.

### 3. Profiles

Mod managers let you create profiles — different mod loadouts for different playstyles ("vanilla+", "hardcore survival"). For agent-rig: *"I'm writing Go today, load the Go rig. Tomorrow I'm doing React."*

```bash
agent-rig profile create go-dev
agent-rig profile switch go-dev     # enables go-rig pointers, disables react-rig's
```

Implementation could be as simple as commenting/uncommenting pointer lines:

```markdown
<!-- agent-rig:go-rig --> Also read: .claude/rigs/go-rig/CLAUDE.md
<!-- agent-rig:react-rig DISABLED --> <!-- Also read: .claude/rigs/react-rig/CLAUDE.md -->
```

### 4. Data vs Code Trust Levels

Game modders intuitively know: texture mods (data) = safe, script mods (code) = risky. Mod managers flag this distinction. agent-rig has the same split:

- **Data** (safe — text/instructions): CLAUDE.md, commands, skills, workflows
- **Code** (risky — executes on your machine): hooks, tool install scripts

Install should treat them differently:

```
📁 Instructions & commands (safe — text only):
   .claude/rigs/clavain/CLAUDE.md
   .claude/commands/clavain/review.md
   ✅ Installed automatically

⚠️  Hooks & scripts (runs code on your machine):
   .claude/hooks/clavain/pre-bash.sh
   Tool: npm install -g @steipete/oracle
   Review and approve? (y/n/inspect)
```

### 5. Compatibility Patches

In Skyrim, when Mod A and Mod B conflict, a third "patch" mod resolves it without modifying either original. For agent-rig:

```json
{
  "name": "clavain-x-go-rig-compat",
  "extends": "mistakeknot/clavain",
  "patchesFor": ["go-community/go-rig"],
  "behavioral": {
    "claude-md": { "source": "compat/CLAUDE.md" }
  }
}
```

The `extends` field already exists in the schema — this is a natural evolution.

### 6. FOMOD Variants (interactive install)

Complex Skyrim mods ask questions during install: *"Realistic or stylized?"* For agent-rig, this is **variants within a single rig**:

```json
{
  "variants": {
    "strict": {
      "description": "Full discipline — all hooks, all review gates",
      "behavioral": { "claude-md": { "source": "config/CLAUDE-strict.md" } }
    },
    "light": {
      "description": "Core conventions only — no hooks",
      "behavioral": { "claude-md": { "source": "config/CLAUDE-light.md" }, "hooks": [] }
    }
  }
}
```

```bash
agent-rig install mistakeknot/Clavain --variant=light
```

### 7. Dependency Resolution

Minecraft Forge/Fabric require mods to declare dependencies. The loader resolves them, warns about missing deps, blocks incompatible versions. agent-rig could extend this beyond plugins:

```json
{
  "requires": {
    "rigs": ["base-org/style-guide@^1.0"],
    "tools": ["prettier@>=3.0"],
    "platform": { "claude-code": ">=1.0" }
  }
}
```

### Applicability

| Pattern | When | Notes |
|---------|------|-------|
| Virtual filesystem (pointer overlay) | **v1.2** | Already decided — this is the core approach |
| Load order via pointer position | **v1.2** | Free — comes with pointer approach |
| Data vs code trust levels | **v1.4** | Add confirmation gate for hooks/scripts |
| Profiles | **v2** | Comment/uncomment pointer lines |
| Variants | **v2** | `--variant` flag during install |
| Compatibility patches | **v2** | Builds on existing `extends` field |
| Dependency resolution | **v2** | Extend beyond plugins to rigs and tools |

---

## Phasing

| Phase | What | Risk |
|-------|------|------|
| **v1.1** | Namespaced commands, skills, workflows (directory copy) | Near-zero |
| **v1.2** | Pointer-based CLAUDE.md / AGENTS.md (with load order) | Very low |
| **v1.3** | Settings deep merge with tracking | Low |
| **v1.4** | Hook scripts + registration + data/code trust gates | Medium |
| **v1.5** | Dry-run shows full behavioral layer | Low |
| **v1.6** | Uninstall reverses all behavioral changes | Low |
| **v2.0** | Profiles, variants, compat patches, rig dependencies | Medium |

---

## Resolved Questions

1. **✅ Commands from subdirectories** — Yes, Claude Code natively supports this. `.claude/commands/clavain/review.md` → `/clavain:review`.

2. **✅ Hook registration** — Hooks register in `settings.json`, not via file discovery. Strategy: namespaced script files + settings merge for registration entries.

3. **✅ Required vs recommended CLAUDE.md** — No distinction. Use `dependedOnBy` declarations so the install can warn about consequences, but the user always decides.

4. **✅ Multi-rig CLAUDE.md** — Multiple pointer lines, each pointing to its rig's namespaced file. Agent reconciles all at runtime. Extend `conflicts` to rig-level for known incompatibilities.

5. **✅ Dry run** — Must show file creates, pointer insertions, settings merge diffs, and suggested files. Essential trust mechanism.
