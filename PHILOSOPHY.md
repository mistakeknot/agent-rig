# agent-rig Philosophy

## Purpose
The rig manager for AI coding agents — package, share, and install complete agent environments with one command.

## North Star
Make rig installation and distribution deterministic: explicit contracts, stable packaging, and low setup friction.

## Working Priorities
- Deterministic installs
- Manifest clarity
- Version compatibility

## Brainstorming Doctrine
1. Start from outcomes and failure modes, not implementation details.
2. Generate at least three options: conservative, balanced, and aggressive.
3. Explicitly call out assumptions, unknowns, and dependency risk across modules.
4. Prefer ideas that improve clarity, reversibility, and operational visibility.

## Planning Doctrine
1. Convert selected direction into small, testable, reversible slices.
2. Define acceptance criteria, verification steps, and rollback path for each slice.
3. Sequence dependencies explicitly and keep integration contracts narrow.
4. Reserve optimization work until correctness and reliability are proven.

## Decision Filters
- Does this reduce ambiguity for future sessions?
- Does this improve reliability without inflating cognitive load?
- Is the change observable, measurable, and easy to verify?
- Can we revert safely if assumptions fail?

## Evidence Base
- Brainstorms analyzed: 2
- Plans analyzed: 1
- Source confidence: artifact-backed (2 brainstorm(s), 1 plan(s))
- Representative artifacts:
  - `docs/brainstorms/2026-02-08-agent-rig-framework-brainstorm.md`
  - `docs/brainstorms/2026-02-09-behavioral-config-layer.md`
  - `docs/plans/2026-02-08-agent-rig-framework.md`
