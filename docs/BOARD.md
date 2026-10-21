# The board — what is happening right now

**This file is the state of record.** It is true *before* any report reaches the
owner. A successor session must be able to act within minutes from this file plus
`git log --oneline -10 origin/main` and `git worktree list`.

**One screen, overwritten in place.** A record that no longer describes the present
belongs in the decision ledger or nowhere.

## The contract

1. **Updated in the same commit as the landing it records** (the sha itself is named
   by the record commit that follows a landing — a commit cannot name itself).
2. **True BEFORE the dispatcher reports to the owner.**
3. **Every record names something checkable** — sha, branch, worktree, session id,
   path. "Probably fine" is not a record.
4. **Session start = reconcile first** (`bash scripts/board.sh`). Read it, check it
   against reality, fix what lied, report ONE line, and only then dispatch.
5. **Reconcile against the REMOTE branch, never a stale local one.**

## Record vocabulary

`reconciled` · `SESSION` · `PROBE` · `IN-FLIGHT` · `LANDED` · `QUEUE` ·
`QUEUE-CLOSED` · `TRAP` · `GUARD` · `RECOVERY` · `retired_branch=` (the only form
parsed as a retirement claim).

---

## Board

```
reconciled: fec3cfc · 2026-10-21T21:16:00Z

SESSION | id=goal-072ded4a-732a-401f-887e-b7618c07216a | model=deepseek/flash | harness=DSH | state=dispatching — chief of staff, goal created and PAUSED by designation

IN-FLIGHT | row=26 | session=c79ef7e7-11ef-4fc8-bf05-66592b60dedf | worktree=/home/administrator/projects/Tank battle/worktrees/a1-world | branch=feat/a1-world-model | base=17b51d1 | state=running | scope=Slice A1: seeded rng, 3D-aware cell world (materials, height, hp), destruction + two debris tiers, slow regen + displacement, deterministic state hash, pins. NO renderer, NO AI, NO tanks.

QUEUE | row=1 | owner: DESIGN COMPLETE — no open questions; fully 3D, breakable slow-regen world with displacement, drive/aim/fire, 3 HP + LETHAL wounded clock, no friendly fire, 4 teams × 4 tanks, player + 3 AI squadmates, profiles as mixes, one authored level, multiplayer preserved-not-built | src=docs/DESIGN.md, ledger rows 7–25

QUEUE | row=2 | publish the static build to the app host once there is something to play | src=docs/ARCHITECTURE.md §4

QUEUE | row=3 | owner (STANDING): hero-quality presentation — glow and pop, TRON HUD, nothing spreadsheet-shaped; judged as screenshots at A2 (the look) and A5 (the interface), and it outranks "it renders" | src=docs/DESIGN.md §9

LANDED | row=0 | sha=fec3cfc04e433dbf15b2c4b462b23a3f52752931 | verify=MY OWN: cheap tier `pnpm run build` GREEN (exit 2) then full gate GREEN — 8/8 vitest, exit 0, raw `.gate-logs/gate.log` | arms=A e52d62cd (baseline 8/8) · B ef5a7653 (no tolerance) RED on "credits a long frame as at most maxFrame" · C 33e50a4e (no clamp) RED on the same pin · D 986d8409 (no negative guard) RED on "rejects a frame time that is negative or not finite" | docs=ARCHITECTURE, TESTING, ledger 1–5 | note=day-1 bootstrap: scaffold, gate, canvas skeleton, one seam per row above

RECOVERY | repo=/home/administrator/projects/Tank battle | remote=https://github.com/ArndRosemeier/Tank-battle.git | branch=main | gate=bash scripts/gate.sh (0 green · 1 red · 2 cheap only · 9 refused/VOID) | logs=.gate-logs/ | worktrees=git worktree list
```

## Guards

- **`GUARD` — the suite lock.** `scripts/gate.sh` takes an atomic `mkdir .gate-lock`; a
  second run is refused with exit `9` and is VOID. Verify: run a gate twice.
- **`GUARD` — the one gate.** `bash scripts/gate.sh` is the only test command; it
  appends one JSON line per run to `.cos/journal.jsonl`. Cheap tier =
  `pnpm run build` (blocks a push), full tier = `pnpm test` (makes a landing VERIFIED).
- **`GUARD` — the seam index is checkable.** Every row in
  [`ARCHITECTURE.md`](ARCHITECTURE.md) names a `file:line`; a landing that moves a seam
  updates its row in the same commit.

## Recovery pointers

- Repo / remote / branch: `~/projects/Tank battle` · `ArndRosemeier/Tank-battle` ·
  `main`
- Raw logs: `.gate-logs/gate.log` (last gate), `.gate-logs/arm-<name>.log` (the
  differential), `.gate-logs/differential.sh` (the local harness; gitignored)
- Open writer branches/worktrees: none (`git worktree list` · `git branch -a`)
- The process itself: [`docs/WAY-OF-WORKING.md`](WAY-OF-WORKING.md) ·
  [`docs/BRIEF.md`](BRIEF.md) · [`docs/GATE.md`](GATE.md)

## Open questions for the owner

1. **None.** The design is ruled (ledger rows 7–25).
   The queue is now execution: Slice A1 (the world model) is dispatched — see the
   IN-FLIGHT record.

## Traps (each with the rule that prevents it)

- `TRAP` — **TypeScript narrowing is lost inside a nested function body**, so a
  module-level `instanceof` guard does not type a DOM node used from a function
  (`error TS18047`, measured this landing). Rule: return the narrowed type from a
  helper (`src/entry/dom.ts`), never sprinkle `!`.
- `TRAP` — **the scaffold's cheap tier defaults to `npm run typecheck`**, which lets a
  build-config error pass the blocking tier while the deploy breaks. Rule: set
  `GATE_CHEAP_CMD` to the build (`pnpm run build`) on day 1.
- `TRAP` — **float drift in a fixed-step accumulator**: 25 owed slices of 10 ms came
  out as 24. Rule: compare with a documented tolerance (`STEP_TOLERANCE`) and pin the
  exact count.
- `TRAP` — **a project name is not a design brief.** The first proposal inferred a game
  mode from "Tank battle" alone and offered four of them as if they were the choice.
  Rule: before the first gameplay brief, the design discussion fixes the experience
  (ledger row 6).
- `TRAP` — **a gate run stamps the journal with HEAD at run time**, so gating BEFORE
  committing records the parent sha and leaves the commit it was meant to cover
  uncovered (the stop hook caught `44b514f` this way; the run had recorded
  `926d25f`). Rule: **commit first, gate second, push third** — the push is still
  blocked because nothing is pushed until the run is green.
- `TRAP` — **a dispatcher must not hedge the world model to save implementation cost.**
  The "2.5D simulation" framing was withdrawn by the owner: *"This should be FULLY 3D.
  Nothing here is 2D. You seem to regress that way."* Rule: the owner sets the fidelity;
  the dispatcher's job is to keep the core renderer-free so the fidelity stays affordable.
