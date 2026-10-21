# Handoff — Tank Battle

<!-- One screen, overwritten in place. The next session — DSH or Claude Code — reads
     this after AGENTS.md and docs/CROSS-TOOL.md, and must be able to act. -->

- **by:** `dsh/chief-of-staff (goal-072ded4a)`
- **at:** `2026-10-21T23:32Z`
- **branch / worktree:** `main` · `/home/administrator/projects/Tank battle`
- **last verified:** `LANDED row=0` in `docs/BOARD.md` · full gate `0` (8/8) · cheap
  tier `2` before it

## Done

- Design ruled through round 2: concept and answers recorded in `docs/DESIGN.md`
  (ledger rows 7–21): fully 3D, breakable slow-regen world with displacement, drive/aim/
  fire, 3 HP + wounded clock, 4 teams × 4 tanks, profiles as behaviour mixes, one level.
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

**Verify the A1 landing when the writer reports** — its sha on the remote, my own full
gate, my own differential. Then dispatch A2 (three.js scene, drive/aim/fire) against
`docs/DESIGN.md` §8. A1 is the world model only, with no renderer.

## Open questions for the owner

- **None.** Design ruled through Q1–Q3 (ledger rows 22–24) and the multiplayer-forward
  constraints (§5.9–12, row 25). Remaining numbers are vetoable defaults (§7).

## Read first

- `AGENTS.md`
- `docs/CROSS-TOOL.md`
- `docs/ARCHITECTURE.md` (seam rows) · `docs/BOARD.md` (state of record)
