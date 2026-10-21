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
reconciled: 0b4e39c · 2026-10-22T00:12Z

SESSION | id=goal-072ded4a-732a-401f-887e-b7618c07216a | model=deepseek/flash | harness=DSH | state=dispatching — autonomous run, goal created and PAUSED by designation

LANDED | row=30 | sha=7b1785f (+5d6b9cf docs correction) | verify=MY OWN: full gate on the INTEGRATED tree GREEN · 34/34 vitest (8 files) · exit 0 · lock acquired | arms (mine): zoom-unclamped 762b6958 RED on "the camera zoom is clamped…"; surface-detail-default-full de383dc6 RED on "SURFACE_DETAIL defaults to 0.3…"; core-imports-three c4c1c08e RED on "no file outside src/render/… imports three" (and the core purity pin); src tree restored 851b375b each time | harness: I ran `scripts/shot.sh` myself — exit 0, "chrome processes after cleanup: 0", 836 KB PNG at 1920×1080 | perf: 115 draw calls (world = 4), SwiftShader 3.7–3.8 fps at 1080p; **this host has NO reachable GPU** (/dev/dri/renderD128 is root:render, we are not in the group) so 60 fps is not measurable here — DoD clause 6 amended in ledger 31 | visual verdict (mine, from all five frames): foundation real, look NOT yet hero — (D1) every silhouette is a DOTTED line, so tanks and walls read as holograms, not solid neon slabs; (D2) wall side faces are near-invisible, so volumes read flat; (D3) the tank has NO BARREL and reads as a slab; (D4) the arena reads as a board on a table — no perimeter architecture, no horizon; (D5) lime is far brighter than the other teams; (D6) floor holes are too weak to read. A2b dispatched to fix exactly these | docs=ledger 30, ARCHITECTURE, TESTING | note=worktree + branch RETAINED for the A2b follow-up with the same writer; no gameplay in this slice.

LANDED | row=33 | sha=f316baa | verify=MY OWN: full gate on the INTEGRATED tree GREEN · 39/39 vitest (11 files) · exit 0 · lock acquired | arms (mine): no-polygon-offset 7977fee8 RED on "the fill is polygon-offset so a coincident edge line cannot be depth-rejected (D1)"; team-luma-off fd001fa5 RED on "the four team hues render at equal Rec.709 luminance within ±10 %"; budget-doubled (spawns concatenated) 560eeec4 RED on "the showcase scene stays inside the pinned draw-object, triangle and vertex budget"; one arm was a VOID probe (a mutation that changed no geometry — recorded as VOID, not evidence); tree restored c92abd25 after each, verified by hash | D1 root cause found: coincident fill/edge depth ties (ULP), fixed by polygonOffset — not a dashed material. Good finding. | visual: D1–D4 and D6 are genuinely fixed (continuous silhouettes, solid wall volumes, a real gun, perimeter/gates/fog, readable holes); teams now luma-matched. | **BUT §9 is violated by measurement**: surfaces 14–17 % of white against the 2–10 % budget, lime hull 32 %, 44.8 % of the frame in the 10–20 % band (measured with PIL on the frames). The arena has become blue architecture rather than black masses edged in neon. DoD/presentation clause unmet — A2c dispatched to bring the numbers in band and to turn the measurement into a test | docs=ledger 33, ARCHITECTURE, TESTING | note=no gameplay; worktree/branch retained for A2c; dispatcher error recorded: a differential restore path was wrong and the mutation survived until the tree hash caught it.

IN-FLIGHT | row=35 | session=6de5b402-9d77-4deb-a24d-517234341470 (reused; rebased to c0d8758) | worktree=/home/administrator/projects/Tank battle/worktrees/a2-render | branch=feat/a2-render | base=c0d8758 | state=running | scope=Slice A2c, the measured surface pass — build scripts/look-budget.py (the ONE look measurement, exit 1 on a miss), call it from shot.sh, then bring surfaces from 14–17 % into the 2–10 % band (lime hull 31.7 % worst), restore line dominance, fix the cropped wide pose and the blown-out gate tubes. No gameplay, no textures.

LANDED | row=26 | sha=e62865b53115d54db1e5e868595123d24459229c | verify=MY OWN: full gate GREEN · 26/26 vitest (world 14, rng 2, purity 2, timestep 8) · exit 0 · lock acquired · raw `.gate-logs/gate.log` | arms (mine, 4, none of them the writer's): cap-newest-first dec8e2ac RED on "shards are capped…"; mirror-off-by-one-step d0ef2ec8 RED on "a shard deflects a shell at its stored mirror angle"; height-boundary-inclusive 8b159335 RED on "a wall stops a shell at its own height…"; displacement-stacks-occupants 3e1d4c5c RED on "displacement is deterministic…"; src tree restored to 6ad2e950 after every arm | retired: worktree worktrees/a1-world, branch feat/a1-world-model, session c79ef7e7 | docs=ledger 26, ARCHITECTURE, TESTING | note=Slice A1, the pure world model (1,690 lines incl. tests); no renderer, no tanks, no AI. Finding: arm D red the determinism pin, not the "nearest free cell" pin — free-ness is pinned only indirectly.

QUEUE | row=1 | AUTONOMOUS RUN — owner is away; pursue v1 to the recorded Definition of Done (`docs/DESIGN.md` §12). Every taste fork: default + rejected option + screenshot for his return. Work advances on wake events, so a writer stays in flight.

QUEUE | row=2 | publish the static build to the app host once there is something to play | src=docs/ARCHITECTURE.md §4

QUEUE | row=3 | owner (STANDING): hero-quality presentation — glow and pop, TRON HUD, nothing spreadsheet-shaped; judged as screenshots at A2 (the look) and A5 (the interface), and it outranks "it renders" | src=docs/DESIGN.md §9

QUEUE | row=4 | owner (CAPABILITY): generated assets are allowed — music, SFX and 2D art via the OpenRouter creative key (`or`, skill loaded). Manifest + sha256 + prompt required; consumed at A2 (look), A3 (combat SFX), A5 (UI blips) | src=docs/DESIGN.md §10

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
  `926d25f`). **A rebase after a gate does the same thing:** the sha changes, so the
  journal line points at a commit that no longer exists (measured on my own
  `5db0aae` → `0b4e39c`). Rule: **commit, rebase, gate, push** — the gate run must be
  the last thing that happens to the tree before it is pushed.
- `TRAP` — **a dispatcher must not hedge the world model to save implementation cost.**
  The "2.5D simulation" framing was withdrawn by the owner: *"This should be FULLY 3D.
  Nothing here is 2D. You seem to regress that way."* Rule: the owner sets the fidelity;
  the dispatcher's job is to keep the core renderer-free so the fidelity stays affordable.
- `TRAP` — **generated concept art can pull the material system off-brief.** The Muse
  arena image read as rock and fog, and the first reading of the owner's Tron reference
  was "no textures at all" — the owner then refined it: modern Tron has appeal, so
  textures are allowed but **subdued, low-frequency, and the lines dominate absolutely**
  (surface 2–10 % luminance, modulation ≤ ±3 %, features ≥ ~32 px, `SURFACE_DETAIL`
  default ~0.3 and verifiable at 0). Rule: generated art informs composition, colour and
  mood — never surface treatment. DESIGN §9 is the contract.
- `TRAP` — **a brief's base sha goes stale the moment the dispatcher keeps committing.**
  The A1 brief named `17b51d1`; by push time the remote was `93742ff` (three design commits
  later). The rebase was clean, but a clean rebase is not evidence the base was right.
  Rule: re-read `origin/main` at brief time, or create the worktree immediately before
  dispatch, and say in the brief which sha it is.
- `TRAP` — **a gate run on a stale local tree proves nothing.** My first A2 gate printed 26
  tests and "GREEN" while origin/main already had 34: the writer had pushed and I had not
  pulled. Rule: `git fetch` + fast-forward/rebase BEFORE gating, and check the test count
  against the landing report — a number that does not match is a stale tree, not a quirk.
- `TRAP` — **a differential restore that is not verified by hash did not happen.** My
  budget arm backed the file up to `/tmp` but the `trap` restored from `.gate-logs/`; the
  mutation survived the run and the "restored" tree hash printed the MUTATED value. It was
  caught only by comparing against the baseline, then repaired from the real backup. Rule:
  print the baseline hash, restore, and REFUSE to continue unless the hash matches; keep
  backups inside the repo, never `/tmp`.
