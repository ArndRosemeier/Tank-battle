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
- **A1 landed** `e62865b`: pure world model (rng, cells by height, destruction, two
  debris tiers, slow regen with deterministic displacement, state hash). Verified by my
  own full gate (26/26) and four of my own injections; worktree, branch and session retired.
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

**Cut the A2 brief** — the render foundation and the look (`docs/DESIGN.md` §8 A2, §9):
three.js scene over the A1 world, the one `NeonSurface` seam with `SURFACE_DETAIL`,
bloom/post pipeline pinned in one config module, luminous grid floor, 3rd/4th-person
camera, placeholder tank. Name `.probe-assets/reference-tron-look.png` and the
0-vs-default screenshot test. A2 is where the hero bar is first judged.

## Open questions for the owner

- **None.** Design ruled through Q1–Q3 (ledger rows 22–24) and the multiplayer-forward
  constraints (§5.9–12, row 25). Remaining numbers are vetoable defaults (§7).

## Read first

- `AGENTS.md`
- `docs/CROSS-TOOL.md`
- `docs/ARCHITECTURE.md` (seam rows) · `docs/BOARD.md` (state of record)
