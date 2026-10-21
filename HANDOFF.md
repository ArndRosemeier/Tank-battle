# Handoff — Tank Battle

<!-- One screen, overwritten in place. The next session — DSH or Claude Code — reads
     this after AGENTS.md and docs/CROSS-TOOL.md, and must be able to act. -->

- **by:** `dsh/chief-of-staff (goal-072ded4a)`
- **at:** `2026-10-21T23:32Z`
- **branch / worktree:** `main` · `/home/administrator/projects/Tank battle`
- **last verified:** `LANDED row=0` in `docs/BOARD.md` · full gate `0` (8/8) · cheap
  tier `2` before it

## Done

- Design concept recorded: `docs/DESIGN.md` (ledger row 7).
- Day-1 scaffold (`cos init`): AGENTS.md, HANDOFF.md, docs, scripts, `.claude/`,
  `.cos/` hooks.
- Git repo on `main`, identity `Tank Battle Dev <dev@tankbattle.local>`, remote
  `ArndRosemeier/Tank-battle` (the owner's existing empty repo).
- Skeleton: Vite + TS + canvas + Vitest; `src/core/timestep.ts` (fixed step, clamp,
  tolerance) with 8 pins; `src/entry/dom.ts` (the one typed-DOM seam); `src/main.ts`
  (loop, canvas, one error surface).
- The gate is real: cheap tier = `pnpm run build` (exit 2), full tier = `pnpm test`
  (exit 0, 8/8). Raw log `.gate-logs/gate.log`; the four-arm differential is recorded
  in `docs/TESTING.md`.

## In flight

- Nothing. No writers, no probes, no branches.

## Next action (one)

**Record the owner's answers to `docs/DESIGN.md` §3** as they arrive (same commit as
the design doc edit), then cut the first gameplay brief from `docs/BRIEF.md` against
the provisional slice in §4. Do not design past the answers.

## Open questions for the owner

- **`docs/DESIGN.md` §3** — seven questions, each with options and a dispatcher lean.
  The core concept is settled (ledger row 7).

## Read first

- `AGENTS.md`
- `docs/CROSS-TOOL.md`
- `docs/ARCHITECTURE.md` (seam rows) · `docs/BOARD.md` (state of record)
