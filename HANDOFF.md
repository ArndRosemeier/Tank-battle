# Handoff — Tank Battle

- **by:** DSH chief-of-staff session, 2026-10-22 (after merging the ChatGPT audit)
- **branch / worktree:** `main` · `/home/administrator/projects/Tank battle`
- **last verified:** `2b49f32` · local full gate **145/145 exit 0** · GitHub Actions on the
  same SHA: Quality **success**, Browser smoke **success** · live build published and
  verified by content (`release/`, entry check below)
- **live:** `https://apps.futuremagic.de/tank-battle/`

## Done since the previous handoff

- Merged `improve/code-quality-audit-20261022` (12 commits): S1 attribution fix, shared
  team-staging/controller seams, shared render stack, per-tick presentation events, real
  scene budget, Windows/path fixes, CI workflows, browser smoke, LICENSE/README, and
  `docs/DEVELOPMENT-QUALITY-PROCESS.md`.
- Verified the merge myself: gate green; CI green **on this SHA** (not an earlier one).
- Re-ran the batch metrics. **S1 had corrupted my own 4×4 character table** — corrected
  numbers are in `docs/TESTING.md` (sniper 74/400 alive, ambusher 52, vanguard 2, brute 3).
  The 1v1 round-robin is unchanged, so the ambusher/brute naming debt stands.

## In flight / next

- No writer is in flight. Nothing is dispatched.
- **Process-improvement plan is awaiting the owner's approval** (chiefly the host-global
  chief-of-staff changes and the shared Toolbox edits); the project-level parts are adopted
  in `docs/DEVELOPMENT-QUALITY-PROCESS.md`.

## Next action (one)

**Get the owner's approval on the process plan** (host-global COS rule + Toolbox scaffold),
then implement the deployment smoke and the one-writer rule first — those two would have
caught both live outages. No feature work before that decision.

## Open questions for the owner

- Approve editing `~/.dsh/AGENTS.md` (chief-of-staff section) and `~/projects/Toolbox/docs`?
- Delete the stale remote branch `origin/feat/b1c-cast` (tip `90517b6`, contained in main)?
- Revisit the ambusher/brute behaviours, or rename them to match what they do?

## Read first

- `AGENTS.md` → `docs/DEVELOPMENT-QUALITY-PROCESS.md` → `docs/CROSS-TOOL.md`
- `docs/BOARD.md` (state) · `docs/TESTING.md` (evidence) · `docs/AUDIT-REMEDIATION.md`
