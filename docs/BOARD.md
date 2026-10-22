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

LANDED | row=35 | sha=fb2e6e1 | verify=MY OWN: integrated gate GREEN · 39/39 · exit 0 | my patch measurements on the new frames (not the tool's aggregates): wide wall faces 3.9–7.8 %, floor 9.4 %, hull 10.6 %, one 20.2 % sample that is a bloom-lit band; tank floor 11.0 %, walls 1.6–5.1 %, hull 9.0 %. A2b was 14–17 % walls/floor and 31.7 % lime hull, so the pass largely did its job | **tool finding (mine):** `look-budget.py` PASSES the *old* A2 frames as well — its global medians cannot see a locally bright wall. It is a floor, not a guarantee; hardening queued for A3b (tile-median p90 across the frame) before shells add bright impacts | writer arms: bright-fill / dim-lines / bloom-flood, each shot-exit 1 — the tool does catch global regressions | docs=ledger 35, ARCHITECTURE, TESTING | note=no gameplay; worktree/branch retained for A3a; the wide frame is now dark, line-dominant and legible: all four teams, two gate arches, holes reading as black voids.

LANDED | row=37 | sha=a009de8 | verify=MY OWN: integrated gate GREEN · 59/59 vitest (12 files) · exit 0 | arms (mine, on the pins the writer explicitly did NOT mutate-test): friendly-fire (teammate immunity bypassed) 584e82ab RED on "a shell cannot damage a teammate…"; reload-ignored 97a13250 RED on "firing is refused until the reload elapses…" (plus 2 downstream); bleed-disabled 1d9d4708 RED on "a wounded tank loses one HP per bleed interval…"; tree restored 0352fe38 each time | I WATCHED the duel as a per-tick trace (temporary vitest trace, deleted after): shots leave at ticks 1/61/121 (reload 60 ticks), a shell covers 10 m in 4 ticks, the third hits at tick 124 (hp 3→2→1→0), the target closes at 0.02 m/tick on throttle 0.2, no bleed within 124 ticks. Deterministic and consistent with the constants | DEBT ACCEPTED AS BLOCKING FOR TEAMS: tank-tank collision is ABSENT (tanks pass through each other; at throttle 1 the test target drove through the shooter) and the muzzle is a point 3 m ahead, so a wall between hull and barrel can be shot through. Both recorded by the writer, both fixed in A3b before any team or AI work | docs=ledger 37, ARCHITECTURE, TESTING | note=core-only slice; no renderer touched. Cell size 2 m is still duplicated across render/sim — folding it into A3b.

LANDED | row=39 | sha=ee4050f | verify=MY OWN: integrated gate GREEN · 66/66 · exit 0 | arms (mine): bodies-dont-block ea445dd8 RED on "a tank cannot drive through another tank"; muzzle-sweep-skipped d4a0659c RED on the sweep pin AND the spawn-inside-solid pin; spawn-overlap-allowed 014f7fac **GREEN** — a finding: the same-cell check masks the circle-overlap check, so the circle half of the spawn rule is UNPINNED (recorded, fixed in A3c) | duel trace unchanged (shots 1/61/121, kill 124), so body blocking did not perturb the scenario | flaw confirmed by the writer: body radius 1 m (2 m diameter) vs the rendered hull 3.4 × 2.5 m — tanks will visibly clip at corners. A3c shrinks the hull to the body; capsule bodies recorded as debt | docs=ledger 39, ARCHITECTURE, TESTING | note=cell size now has one definition; renderer imports it.

LANDED | row=41 | sha=248daac | verify=MY OWN: integrated gate GREEN · 78/78 (15 files) · exit 0 | arms (mine): rebuild-every-frame 70494915 RED on "rebuilds only when the world revision changes"; aim-yaw-unclamped d5a9fdfa RED on "turns the turret RELATIVE to the hull and clamps the offset"; hull-wider-than-body 2a69ba6c RED on "the rendered hull half-width fits inside the body radius"; tree restored 40379ca2 each time | my own look re-measure: all four poses PASS, tile p90 6.7–10.2 % against the 12 % gate | visual verdict: PLAYABLE is real (sim-driven tanks, shells, damage, win) but the arena is an EMPTY HALL — three distant walls and four isolated blocks, no cover, no lanes, nothing to flank around. AI behaviour would have nothing to be clever with | also seen: the placeholder HUD labels are clipped/tiny at the frame edge (HULL/RELOAD), and the tank reads as a glowing slab more than a tank. Both belong to A5/A3d, not here | docs=ledger 41, ARCHITECTURE, TESTING | note=say what is true: the owner could drive and shoot, but there is no game in the room yet.

LANDED | row=43 | sha=5e04e9e | verify=MY OWN: integrated gate GREEN · 85/85 (16 files) · exit 0 | arms (mine): symmetry-180 (four-fold rotation replaced by a point reflection) 4c44e9f5 RED on "the arena grid is invariant under 90° rotation" plus 6 downstream; gateways-closed f542e2ab RED on the demo tests but NOT on the connectivity pin; low-cover-reclassified dcf9cdef **GREEN** | TWO FINDINGS from those arms: (1) the load validator proves spawn-to-spawn connectivity but NOT that the arena CENTRE is reachable — with every ring gateway closed the level still validated, so the objective could be sealed; (2) the 1.2 m low-cover classification is unpinned, so the plan/mesh could silently paint shoot-over cover as a tall wall. Both are small fixes handed to B1a | layout verdict from the top plan: four screened corner spawns with dogleg exits, two concentric rings with corner gateways, breakable centre, low cover staged along the lanes, symmetric under 90°. The plan exposed adjacent spawns facing each other down a margin before I ever saw it in 3D — the review loop paid for itself | docs=ledger 43, ARCHITECTURE, TESTING | note=level is data + validator; the A2 16-tank showcase remains only a budget fixture.

LANDED | row=45 | sha=303efb4 | verify=MY OWN: integrated gate GREEN · 98/98 (21 files) · exit 0 | arms (mine): los-always-true 918eb27e RED on "sees over a 1.2 m barrier but not through a 4.8 m wall" + memory; path-cache-ignores-revision f4a37ade RED on "recomputes its route within the next decision after a wall is destroyed" + cache invalidation; decision-every-tick fb717636 RED on "decides every six ticks and holds the command"; tree restored a3a6161d each time | I RAN THE BATCH MYSELF (100 matches, 1.7 s): **85/15 team-0 win split**, median 306 ticks (5.1 s!), 89.4 % accuracy, **0 cap hits**, all deaths by shell, clock never reached. And I watched trace-seed-0 as ASCII frames: the two tanks close to ~14 m, stop, and trade shots — no repositioning, no cover use, no dodging after contact | verdict: the rig works and the AI sees/navigates correctly, but as a GAME this is wrong on three counts — unfair (85/15), far too short (5 s), far too accurate (89 %), and static. Measured, not felt. B1b is fairness + pacing before any cast is built on these numbers | docs=ledger 45, ARCHITECTURE, TESTING | note=rig runs in ~1.7 s for 100 matches, so 200-seed tuning loops are cheap.

LANDED | row=47 | sha=a1d308d | verify=MY OWN: integrated gate GREEN · 99/99 (22 files) · exit 0 | my 200-seed batch reproduces the report exactly: 99/101 win split, median 934 ticks, 52.0 % accuracy, 0 cap hits, 113 shell / 87 clock deaths, mean speed 2.24 m/s — every target met | **my arm found the report over-attributes the cause**: reinstating `tank.id * 3` for the decision phase changed nothing (48/52) because for a 1v1 the ids are 0 and 1 and `id*3` ≡ `team*3` mod 6 — so the phase formula was NOT what produced 85/15. The real cause was the second one the writer names: the two adjacent authored corner spawns are not a symmetry pair. The arm was therefore VOID as a test of the phase, and it corrects the record | **unpinned fairness fix:** the actual repair (symmetric staging at (18,6)/(30,6)) has no unit pin — only the 200-seed measurement. A cheap pin exists and is owed: the duel staging is a symmetry pair under the arena mirror | **new debt (single-player):** pacing came from an AI-only 285-tick fire interval while global `RELOAD_TICKS` stays 60, so the player fires ~4.75× faster than the AI. Correct for AI-vs-AI measurement, wrong for the game; it must become one rule before player-vs-AI ships | docs=ledger 47, ARCHITECTURE, TESTING | note=mirror pin is sim-level only; AI-level mirroring is deterministic-chaotic and is recorded as debt.

LANDED | row=49 | sha=90517b6 (I integrated it: the writer pushed only `refs/heads/feat/b1c-cast`, never `main`; ff-only merge, then pushed) | verify=MY OWN: integrated gate GREEN · 100/100 (22 files) · exit 0 | my own 2400-match round robin reproduces the matrix exactly (56 s): vanguard 58.5 %, sniper 55.7 %, ambusher 50.0 %, brute 32.3 %; signatures 15.2 m / 1.06 damage / 46.7 % out-of-LOS / 2.03 m/s, all clearing the 20 % bar | arm staging-not-mirror-pair 7ed6c37d RED on "pins the two spawns as an exact mirror pair across the arena centre" — the pin I owed exists and works | **finding 1:** shipped profiles are NOT eagerly validated. A `sniper` weight of 9 (legal range is 0…1) passed the whole suite, because `AI_PROFILES` is a raw literal and validation happens only when a controller is constructed. The doc says "load errors"; reality is "controller-construction errors". No pin covers the four shipped profiles | **finding 2:** destruction attribution (`worldDestructionByTeam[teamId]`) is unpinned — pinning it to team 0 stayed green. It is the metric that defines the brute's identity, so the signature rests on an unguarded number | **process finding:** a LANDED report that has pushed only its branch has not landed. The dispatcher integrated it; the brief and the report must name the ref pushed | docs=ledger 49, ARCHITECTURE, TESTING | note=ambusher separates from the field median, not from the brute (brute is 49.0 % out-of-LOS); honest and recorded.

LANDED | row=51 | sha=8bf12d3 (pushed to origin/main, verified) | verify=MY OWN: integrated gate GREEN · 108/108 (24 files) · exit 0 | my 50-seed 4×4 run confirms the report and sharpens it: **corner 1 wins 0/50 (0 %), corner 0 wins 21/50 (42 %)** while the rotating per-team split looks even (22/20/24/20 %) — so the bias is spatial, not team-identity | **sniper dominance in 4×4:** 47 of 200 sniper tanks alive at the end (vanguard 5, ambusher 11, brute 8) with 121 HP left against 11 — the survival-based win condition rewards the character that refuses to fight | cap hits in my sample 8/50 (16 %) — above the 10 % target; report says 12 % at 200 seeds | the spectate frame is genuinely good: four team colours, shells in flight, cover, readable action (`.gate-logs/shots/spectate.png`) | fixes verified: eager profile validation is real (a weight of 9 throws at module load); the **destruction-attribution pin is not** — forcing `worldDestructionByTeam[0]` leaves 108/108 green, so the mapping the signatures rest on is still unguarded | docs=ledger 51, ARCHITECTURE, TESTING | note=the authored ARENA still splits into four nav components at its 2-cell gates; TEAM_ARENA works around it instead of fixing it.

IN-FLIGHT | row=53 | session=6de5b402-9d77-4deb-a24d-517234341470 (reused; branch feat/b3-fair, base be2abd5) | worktree=/home/administrator/projects/Tank battle/worktrees/a2-render | branch=feat/b3-fair | base=be2abd5 | state=running | scope=Slice B3 — instrument the dead corner (corner 1 = 0/50) before tuning; unify TEAM_ARENA and ARENA into ONE connected level with a body-aware flood-fill pin; measure per-character TEAM wins (not survival) and rebalance if needed; cap hits ≤10 %; pin the destruction-attribution mapping. Targets: corners 20–30 % each, characters 20–60 % of team wins.

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
