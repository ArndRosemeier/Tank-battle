# Testing — what proves this

This doc records the **pins** and what was **actually executed**. "It compiles" is
never "it passed".

## The pin matrix

| Behaviour | Pin (test) | Where | How it is watched red |
| --- | --- | --- | --- |
| One slice per whole step, remainder kept for `alpha` | `runs one slice per whole step and keeps the remainder` | `src/core/timestep.test.ts` | drop the accumulator decrement → no steps run |
| A 60 Hz stream runs exactly 60 slices (no slow clock) | `runs exactly 60 slices for 60 frames of one 60 Hz slice, so the clock cannot drift` | `src/core/timestep.test.ts` | remove the tolerance while keeping a 1/60 step → 59 steps |
| A long frame is credited at most `maxFrame` (no spiral) | `credits a long frame as at most maxFrame, so the simulation cannot spiral` | `src/core/timestep.test.ts` | remove `Math.min` (arm C) or the tolerance (arm B) → 1000, resp. 24 |
| A zero-length frame never steps | `runs no slice for a zero-length frame` | `src/core/timestep.test.ts` | step before adding the frame time |
| `reset()` drops the remainder | `drops the sub-step remainder on reset` | `src/core/timestep.test.ts` | make `reset()` a no-op |
| A negative or non-finite frame delta throws | `rejects a frame time that is negative or not finite` | `src/core/timestep.test.ts` | drop the `< 0` half of the guard (arm D) |
| A non-positive step, or `maxFrame < step`, throws | `rejects a step that is not positive, or a maxFrame below the step` | `src/core/timestep.test.ts` | drop either constructor guard |
| The defaults are 60 Hz with a 0.25 s clamp | `defaults to a 60 Hz slice with a quarter-second clamp` | `src/core/timestep.test.ts` | change either default constant |
| A destroyed wall yields exactly one big block | `a shell's damage destroys a wall cell and yields exactly one big block` | `src/core/world.test.ts` | arm 01: spawn zero blocks → red |
| A destroyed floor is a drivable hole, and the floor-surface contract survives it | `a destroyed floor cell becomes a drivable hole, not an obstacle` | `src/core/world.test.ts` | arm 02: drop the hole early-return in `isSolidAt` → red |
| Solidity is height-aware: a low wall cannot stop a high shot | `a wall stops a shell at its own height and never above it` | `src/core/world.test.ts` | arm 03: report every intact cell solid at any height → red |
| A big block freezes its cell's regeneration until it is destroyed | `a large block occupying a cell blocks that cell's regeneration until the block is destroyed` | `src/core/world.test.ts` | arm 04: skip the block check in the tick loop → red |
| Regeneration waits out its whole delay, never less | `a cell regenerates only after its delay has elapsed, never before` | `src/core/world.test.ts` | arm 05: heal one tick early (`> 1`) → red |
| A healing cell absorbs the shards lying in it | `a healing cell absorbs the shards lying in it` | `src/core/world.test.ts` | arm 06: drop the absorb call → red |
| A regenerating cell displaces its occupant to the nearest free cell, without damage | `a tank standing in a cell that regenerates is displaced to the nearest free cell and takes no damage` | `src/core/world.test.ts` | arm 07: never displace (`hp === -1`) → red |
| Displacement is deterministic | `displacement is deterministic: the same world state and the same occupants produce the same result` | `src/core/world.test.ts` | arm 08: a hidden module salt reverses the occupant order on alternate calls, so two identical runs disagree → red |
| Shards are capped oldest-first; big blocks are not capped | `shards are capped; when the cap is exceeded the oldest despawns first` | `src/core/world.test.ts` | arm 09: never enforce the cap → red |
| A shard deflects at its stored mirror angle | `a shard deflects a shell at its stored mirror angle` | `src/core/world.test.ts` | arm 10: halve the reflection term → red |
| A shell hit shatters the shard, and a stale id fails loudly | `a shell hit shatters the shard, so it is gone and a stale id fails loudly` | `src/core/world.test.ts` | arm 18: return the shard without removing it → red |
| A shove moves one cell and never through material | `shoving a shard moves it one cell, and slides it to a free side when the way is blocked` | `src/core/world.test.ts` | arm 11: drop the passability check → red |
| Identical runs hash identically, and the hash tracks the state | `the same seed and the same operations produce an identical state hash` | `src/core/world.test.ts` | arm 12: drop the mirror angle from the hash text → the different-seed assertion reds |
| A bad cell address or occupant is rejected loudly, never clamped | `an out-of-bounds cell or an occupant outside the grid is rejected loudly` | `src/core/world.test.ts` | arm 13: drop the bounds check → red |
| A seed reproduces its sequence exactly | `the same seed produces the identical sequence, every time` | `src/core/rng.test.ts` | arm 14: change the mulberry increment constant → the golden vector reds |
| The bounded draw stays in range, and bad bounds/seeds throw | `int(maxExclusive) stays inside its bound, and a bound or seed that cannot be drawn from is rejected loudly` | `src/core/rng.test.ts` | arm 15: drop the `<= 0` guard → red |
| The core imports no renderer and touches no DOM, window or clock | `no module under src/core/ imports three.js, or touches document, window, performance.now or any other host clock` | `src/core/purity.test.ts` | arm 16: add a `window` reference to a core module → red |
| The core never draws unseeded randomness | `no module under src/core/ calls Math.random` | `src/core/purity.test.ts` | arm 17: add a `Math.random` reference to a core module → red |
| The camera zoom is clamped, and the first-person boundary is the documented 2 m | `the camera zoom is clamped and first person is entered at the documented distance` | `src/render/cameraMath.test.ts` | return the unclamped distance from `clampDistance`, or make the boundary inclusive (`<=`) → red at 0.55/16 m resp. exactly 2 m |
| A camera pose is deterministic for the same inputs | `a camera pose reproduces the same position and target for the same inputs` | `src/render/cameraMath.test.ts` | add a module-level counter to `cameraPose`/`orbitPose` → the two calls differ |
| The arm's look-ahead is continuous at the first-person boundary | `collapsing the arm turns the target forward and hides the hull boundary` | `src/render/cameraMath.test.ts` | aim the target at the focus inside first person, or add look-ahead at exactly 2 m → red |
| `SURFACE_DETAIL` defaults to 0.3 and one function moves it to 0 and back | `SURFACE_DETAIL defaults to 0.3 and can be set to 0 and back by one function` | `src/render/neonSurface.test.ts` | make `setSurfaceDetail` a no-op, or leave the rim uniform at full opacity → red |
| A surface merges its parts into one fill and one edge buffer | `a surface merges its parts into one fill geometry and one edge buffer` | `src/render/neonSurface.test.ts` | build one `Mesh` per part (don't merge), or make a new rim geometry instead of sharing the fill → red |
| The palette is the only home of a hex colour | `the palette carries four distinct team colours and no module outside src/render/config.ts hardcodes a hex colour` | `src/render/purity.test.ts` | add `const c = '#00e5ff'` to `src/main.ts` → the hit list is non-empty |
| three.js cannot leak into the simulation core | `no file outside src/render/, src/main.ts and src/entry/ imports three` | `src/render/purity.test.ts` | add `import { Color } from 'three'` to `src/core/timestep.ts` → the hit list names it |
| The world collapses to one fill and one edge buffer, and a rebuild follows destruction | `the world's cells collapse into ONE fill mesh and ONE edge buffer, and a rebuild re-derives them from the world` | `src/render/worldMesh.test.ts` | one mesh per cell → the fill count reds; skip `rebuild()` (patch nothing) → the rim vertex count does not grow by the new hole's 16 vertices |
| Team hues render at equal perceptual luminance (±10%) | `the four team hues render at equal Rec.709 luminance within ±10 %` | `src/render/config.test.ts` | drop `teamEdgeGainFor` (use the raw hue) → lime/magenta ratio 2.8 → red |
| Surface albedo stays inside §9's 2–10% band (sRGB L) | `surface albedos sit inside §9’s 2–10 % sRGB-luminance band` | `src/render/config.test.ts` | restore the A2b fill (`#1d2931`, 15.3 % sRGB L) → red |
| A fill cannot depth-reject its coincident edge lines | `the fill is polygon-offset so a coincident edge line cannot be depth-rejected (D1)` | `src/render/neonSurface.test.ts` | remove `polygonOffset` from the fill material → the pin reds (and the old dotted screenshots return) |
| Every hole is a black void quad, not a grid quad | `every hole cell is a void quad, and every intact cell is a grid quad` | `src/render/gridFloor.test.ts` | drop the `aVoid` attribute (or write 0) → the void-vertex count reds |
| The showcase stays inside the GPU-independent budget | `the showcase scene stays inside the pinned draw-object, triangle and vertex budget` | `src/render/sceneBudget.test.ts` | add one tank/one extra surface, or unmerge a world surface → objects/triangles/vertices exceed the 20% headroom |
| A wall stops a tank, but a floor hole stays drivable | `a tank cannot drive into a wall cell but can drive over a floor hole` | `src/core/sim.test.ts` | drop the wall/solidity branch, or make a hole impassable → the blocked tank enters the wall or the hole driver stops |
| A blocked diagonal drive slides along the free axis | `a blocked diagonal drive slides along the free x axis` | `src/core/sim.test.ts` | make a blocked full move a hard stop → the tank never reaches the wall row's east side |
| Drive and steer use the documented rates | `throttle and steer produce the documented speed and turn rate` | `src/core/sim.test.ts` | change either rate constant or apply steer after the move → the one-tick position/yaw reds |
| Turret yaw is independent of hull yaw | `the turret yaw is independent of the hull` | `src/core/sim.test.ts` | copy hull yaw into turret yaw, or use hull yaw in the turret slew → the independence assertion reds |
| Pitch is clamped to −30…25° and out-of-range throws | `the aim pitch is clamped to the documented range` | `src/core/sim.test.ts` | accept a pitch outside the clamp, or omit the pitch guard in `validateTankCommand` → the throw assertion reds |
| Firing needs a clear reload and spawns one muzzle shell | `firing is refused until the reload elapses and spawns exactly one shell at the muzzle` | `src/core/sim.test.ts` | remove the reload guard (second shot too early), or spawn at the hull origin instead of the muzzle → `shotsFired`/position red |
| A shell advances 1.5 m/tick and despawns at 120 m | `a shell advances the documented distance per tick and despawns at max range` | `src/core/sim.test.ts` | advance by a different distance, or never expire at range → the per-tick delta/loop bound reds |
| A wall hit removes one HP and stops the shell | `a shell that strikes a wall cell damages it by one and despawns` | `src/core/sim.test.ts` | skip `damageCell`/`damageBlock`, or let the shell continue → wall HP or shell count reds |
| Downward pitch breaks the struck floor cell | `a shell aimed downward breaks the floor cell it strikes` | `src/core/sim.test.ts` | give the shell no vertical component, or skip floor cells in collision → the hole assertion reds |
| A big block absorbs one shell hit | `a shell that strikes a big block damages it` | `src/core/sim.test.ts` | treat the block cell as a bare hole, or skip `damageBlock` → block HP reds |
| A moving tank shoves floor shards out of its cell | `a moving tank shoves floor shards out of its cell` | `src/core/sim.test.ts` | stop calling `shoveShard` after a move/displacement → the shards stay in the entered cell |
| A shard shatters and reflects at its stored normal | `a shard shatters and deflects the shell at its stored mirror angle` | `src/core/sim.test.ts` | stop after shattering without reflecting, or use the raw non-unit horizontal in `shardDeflection` → direction/shard count reds |
| Enemy tank hits deal 1 damage; 3 kill | `a shell striking an enemy tank deals one damage and despawns; three kill` | `src/core/sim.test.ts` | damage the teammate/owner too, or apply 2 damage → hits/kills/death cause red |
| A teammate stops a shell without damage | `a shell cannot damage a teammate and stops at the teammate body` | `src/core/sim.test.ts` | remove the team check before `damageEnemyTank` → teammate HP and `hits` red |
| The wound clock is lethal and does not reset on later hits | `a wounded tank loses one HP per bleed interval and can die from the clock` | `src/core/sim.test.ts` | stop decrementing the clock, or reset it on every hit → HP/death tick red |
| A dead tank is inert | `a dead tank no longer moves, aims or fires` | `src/core/sim.test.ts` | remove the `if (!tank.alive)` guards in drive/aim/fire → position/yaw/shell count red |
| Last team wins; at the cap total HP wins | `the match ends when one team remains, and at the cap the greater total HP wins` | `src/core/sim.test.ts` | omit the last-team check, or compare alive count before HP at the cap → winner/outcome red |
| Same seed + commands hash identically; a command change differs | `the same seed and command sequence produce an identical match-state hash` | `src/core/sim.test.ts` | omit a tank/shell/status field from the canonical text → the two-run/different-command assertion reds |
| A scripted duel ends by a shell kill with consistent stats | `the scripted duel runs to a shell kill and its stats tell the story` | `src/core/sim.test.ts` | change the phase order (fire before the last-team check), or stop counting muzzle shots → shots/hits/winner/death cause red |
| Malformed commands throw rather than clamp | `a malformed command throws instead of being silently clamped` | `src/core/sim.test.ts` | clamp throttle/steer/pitch or coerce `fire` → the throw assertions red |
| A tank cannot drive through another tank | `a tank cannot drive through another tank` | `src/core/sim.test.ts` | remove the body sweep/end-point check → the closing tank passes the target |
| Tank-tank blocking is independent of the state-array order | `tank-tank blocking is independent of the tank array order` | `src/core/sim.test.ts` | iterate `state.tanks` instead of ascending id → the reversed-array run diverges |
| Same-cell spawns are rejected at match creation | `two tanks spawned on the same cell are rejected at match creation` | `src/core/sim.test.ts` | drop the spawn-overlap assert → `createMatch` returns an overlapping state |
| A wall between hull and muzzle consumes the shot and the reload | `a wall between the hull and the muzzle stops the shell on the spawn tick and the reload is still spent` | `src/core/sim.test.ts` | spawn without the barrel trace, or forget the reload/shots accounting → a shell exists / reload is 0 |
| A muzzle inside a solid cell resolves exactly once | `a shell that spawns inside a solid cell resolves that hit exactly once` | `src/core/sim.test.ts` | spawn then immediately advance the shell, or sweep and spawn → wall HP drops by 2 / a shell remains |
| Equal HP + equal live tanks at the cap is a draw | `a match that ends at the cap with equal HP and equal tanks is a draw` | `src/core/sim.test.ts` | pick a winner or infer from HP alone → outcome/winner red |
| The 2 m cell size has one definition and the renderer imports it | `the 2 m cell size is defined once and the renderer imports it` | `src/core/purity.test.ts` | add a second `CELL_SIZE_METRES = 2` literal, or make the renderer spell `cellMetres: 2` → the scan/import assertion reds |
| The world revision changes only on visible mutations | `the revision counter increments on visible changes and never on a timer-only tick` | `src/core/world.test.ts` | bump on a timer tick, or skip a damage/shove/shatter/regen/displacement → the exact increments/non-increments red |
| Adjacent-cell circles are rejected at match creation | `two tanks in adjacent cells whose circles overlap are rejected at match creation` | `src/core/sim.test.ts` | zero the circle-overlap distance (or keep only the same-cell check) → the 1.9 m-apart adjacent-cell spawn is accepted |
| WASD maps to throttle/steer with a neutral centre aim | `maps WASD to throttle and steer without touching the centre aim` | `src/game/input.test.ts` | swap A/D, or add a non-zero aim at pointer centre → the command assertions red |
| Mouse aim is hull-relative and pitch is clamped | `turns the turret RELATIVE to the hull and clamps the offset` · `maps pointer height to a clamped pitch, with centre = zero` | `src/game/input.test.ts` | use an absolute yaw, clamp wrongly, or map pitch from the bottom → the ±60°/25°/−30° assertions red |
| The pure input surface rejects malformed pointer data | `passes the fire state through and rejects non-finite pointer input` | `src/game/input.test.ts` | silently coerce NaN/Infinity → the throw assertions red |
| The demo freezes on a shell in flight and deterministic damage | `the demo is deterministic and freezes on a shell in flight at tick 122` | `src/game/session.test.ts` | stop the 122-tick run early, or run it twice non-deterministically → the shell/HP/revision assertions red |
| The demo can reach a real last-team death/win | `the demo reaches a real last-team win and leaves a dead dummy` | `src/game/session.test.ts` | stop the match at the second hit, or leave the dummy alive → the outcome/winner/dead assertions red |
| Tank transforms interpolate between ticks | `interpolates tank transforms between the previous and current sim tick` | `src/game/session.test.ts` | return current for every alpha, or discard the previous snapshot → the alpha0/alpha1 positions red |
| The rendered hull half-width fits the 1 m body | `the rendered hull half-width fits inside the body radius with 5 % allowance` | `src/render/config.test.ts` | widen `TANK.hullWidthMetres` past 2.1 m → the measured half-width red |
| The 24×14 tile p90 catches a locally bright wall | `tile_p90` gate in `python3 scripts/look-budget.py` | `scripts/look-budget.py` | remove the tile measure, or split 24×14 differently → the injection frame's 255 L p90 / FAIL would disappear |
| The renderer rebuilds only on a world-revision change | `rebuilds only when the world revision changes` | `src/render/playableScene.test.ts` | rebuild every frame, or forget to update the stored revision → the false/false/true/false sequence reds |

| The authored level passes every load-time check | `the authored arena passes every load-time check` | `src/game/levels/arena.test.ts` | remove a ring cell (symmetry), grow a spawn zone (bounds), or skip `validateLevel(ARENA)` in the session → the first assertion reds |
| An overlapping spawn is rejected | `a level with an overlapping spawn is rejected` | `src/game/levels/arena.test.ts` | drop the `occupied` set, or move team 1 onto team 0's zone → the overlap assertion reds |
| A disconnected spawn is rejected | `a level whose spawns are not all connected on foot is rejected` | `src/game/levels/arena.test.ts` | skip the flood fill, or make a spawn room an island → the connectivity assertion reds |
| The cell grid is 4-fold rotationally symmetric | `the arena grid is invariant under 90° rotation` | `src/game/levels/arena.test.ts` | add a single asymmetric pillar → the symmetry error names `(1, 10)` |
| Every spawn zone is free floor | `every spawn zone is free of solid cells` | `src/game/levels/arena.test.ts` | put one wall in team 0's 2×2 zone → the free-floor assertion reds |
| Off-grid and illegal-height data fail before a world exists | `rejects an off-grid or illegal material before a world is built` | `src/game/levels/arena.test.ts` | place at x=24, or at 0.1 m (≤ floor) → the bounds/height assertion reds |
| No two spawns have a direct centre line | `no spawn has a clear straight line to another spawn` | `src/game/levels/arena.test.ts` | remove one screen wall (or its three rotations) → the blocked-line assertion reds |

| The arena centre objective is reachable from every spawn | `rejects a level whose centre objective is sealed off` | `src/game/levels/arena.test.ts` | close both rings' gateways symmetrically; without the central flood-fill check the spawn-only validator still passes |
| A 1.2 m barrier is low cover; a 4.2–4.8 m wall is not | `the low-cover predicate classifies the 1.2 m barrier, not the tall walls` | `src/render/config.test.ts` | change `LOW_COVER_MAX_HEIGHT_METRES` to 0.5 → the 1.2 m assertion reds |
| LOS sees over low cover and is blocked by a tall wall | `sees over a 1.2 m barrier but not through a 4.8 m wall` | `src/core/ai/perception.test.ts` | remove height awareness (`isSolidAt` at one height) → the low barrier blocks or the tall wall clears |
| Enemy memory is team-aware and expires | `is team-aware and keeps a short last-seen memory` | `src/core/ai/perception.test.ts` | drop the team check or never expire → a dead/teammate target or a stale sighting remains |
| A destroyed wall invalidates a cached route and a healed wall closes it | `invalidates a cached path when a wall is destroyed and routes again` | `src/core/ai/navigation.test.ts` | ignore `world.revision` in `NavigationCache` → the old null/route survives the mutation; skip regeneration → the reopened route stays |
| The path cache only recomputes on revision or goal-cell change | `only recomputes for a new revision or a new goal cell` | `src/core/ai/navigation.test.ts` | key the cache on the start cell too, or recompute on every call → the computation count rises |
| Every smoothed waypoint is body-clear | `keeps the body clear of walls on every smoothed waypoint` | `src/core/ai/navigation.test.ts` | remove the footprint check from `cellIsFreeForBody`/smoothing → a waypoint clips a wall |
| The AI fires only inside the current aim cone | `fires only when the target is inside the current aim cone` | `src/core/ai/controller.test.ts` | fire whenever a visible target exists → the misaligned case reds |
| Decisions happen every 6 ticks and hold between | `decides every six ticks and holds the command in between` | `src/core/ai/controller.test.ts` | decide on every call → the decision count rises; rebuild the command each call → object identity reds |
| A destroyed wall changes the route within the next decision | `recomputes its route within the next decision after a wall is destroyed` | `src/core/ai/controller.test.ts` | keep the stale path past the revision → the route length/revision does not change |
| Same seed + profile reproduces decisions | `reproduces the same decision sequence from the same seed and state` | `src/core/ai/controller.test.ts` | use `Math.random` or an unsaved counter → the two controllers diverge |
| Profile data rejects unknown goals and bad weights | `validates vanguard and rejects unknown goals and out-of-range weights` | `src/core/ai/profile.test.ts` | skip the unknown-key or range check → a typo/weight above 1 is accepted |
| A three-seed batch is reproducible | `reproduces the same three-seed result and trace` | `src/game/aiBatch.test.ts` | use a different controller seed derivation or drop the seed → hashes/trace differ |

| A mirrored script produces the mirrored winner, length and causes | `a mirrored script produces the mirrored winner, length and causes` | `src/game/mirror.test.ts` | swap a tank/team mapping in the script or break the z mirror → the original team-0 win/7-tick/shell result no longer maps to mirrored team 1 |
| The duel spawns are an exact mirror pair | `pins the two spawns as an exact mirror pair across the arena centre` | `src/game/aiBatch.test.ts` | move one spawn, or flip one hull yaw, and the explicit-coordinate/symmetry assertions red |

The A3a block (20 rows), the A3b block (7 rows) and the A3c block (11 rows) are direct assertions; A4 adds seven level-validation pins; B1a adds the two A4 gap pins and eleven AI pins; B1b adds the scripted mirror pin; B1c adds the staging-symmetry pin (100/100 tests in 22 files). **No mutation differential was run for A3a/A3b/A3c/A4/B1a/B1b/B1c**, so the "how red" text names the one-line change that would red each pin, not an executed arm. A3c's first input run had two `-0` expectation failures and its first-person pose initially failed the line-p99 floor; see `### row 37` / `### row 41`.

The differential harness is a local artifact at `.gate-logs/differential.py` (row 26)
and `.gate-logs/differential.sh` (row 0) — both gitignored; the mutations are described
in the tables, so either can be rebuilt.

`src/entry/dom.ts` is deliberately unpinned: it is thin DOM glue whose failure mode is
a throw on a missing node, and proving it needs a browser. The seam index records it
as known debt ([`ARCHITECTURE.md`](ARCHITECTURE.md) §4).

## Raw logs

The gate writes `.gate-logs/gate.log`; the differential writes
`.gate-logs/arm-<name>.log`. Both are gitignored and kept until a landing is verified.
Never pipe a run through `tail`/`head` — it destroys the failing evidence and returns
the pipeline's last status.


## The measured look budget (A2c)

`scripts/look-budget.py` is the ONE pixel measurement of §9, and `scripts/shot.sh`
runs it after every capture (a FAIL makes the command exit non-zero):

- **L** is 8-bit sRGB luminance (ITU-R 601-2 via PIL `convert('L')`), **not** the
  linear Rec.709 measure used for D5's team-gain pin.
- **surfaces** (5 ≤ L < 102): median ≤ 22 L (≈8.6 %) and the whole-frame share with
  26 ≤ L ≤ 51 (10–20 %) ≤ 25 %.
- **lines** L ≥ 102: p99 ≥ 150; **contrast** p99 / median(surface) ≥ 6.
- **tiles** (A3c): 24×14 tile medians, p90 ≤ 30.6 L (12 % of white). This catches a locally bright wall the whole-frame median can hide; a white injection measured 255 L / 100 % and FAILED.
- **void** (L < 5) is printed as INFO: the A2c brief gave no void threshold.
- **team hulls** are SKIP: A2c's hull surfaces are neutral and shared, so a cheap
  saturation mask measures the trim, not the hull. The team-trim medians are printed
  as a diagnostic (distance/coverage confounded, not gated); the A2b D5 pin still
  holds the linear team luma.

The four final frames measured (the raw JSON is the same command with `--json`):

| pose | void | surface median | 26–51 share | line p99 | contrast | team hulls | verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `wide` | 56.4 % | 13 L (5.1 %) | 7.5 % | 191 | 14.69 | SKIP* | **PASS** |
| `tank` | 29.7 % | 13 L (5.1 %) | 11.3 % | 202 | 15.54 | SKIP* | **PASS** |
| `first` | 45.2 % | 13 L (5.1 %) | 6.7 % | 199 | 15.31 | SKIP* | **PASS** |
| `wide-detail0` | 60.7 % | 10 L (3.9 %) | 3.9 % | 190 | 19.00 | SKIP* | **PASS** |

\* The manual patch check that backs the hull row: the focused tank's hull top is
9.4 % L and its side 5.5 %; the `wide` wall faces are 3.9–4.3 % and a clean floor cell
is 3.9 %; the `tank` clean wall face is 7.8 % and the floor 2.7 %. The hull fill is one
neutral shared material, so the hull surfaces do not differ by team; the team hue is
only in trim lines and small lights. The team-trim diagnostic on `wide` is orange
61.2 %, lime 74.9 %, magenta 59.6 % (max/min 1.26; not a hull measure and not gated).

## Per landing

### row 0 — day-1 bootstrap (scaffold, gate, canvas skeleton)

- **Gate:** cheap tier `pnpm run build` GREEN, exit `2` (the suite did NOT run — this
  is not "the gate passed"). Full gate GREEN, exit `0` · `8/8` tests · vitest 5.0.5,
  226 ms · raw `.gate-logs/gate.log`.
- **First run was RED** — and that is recorded, not hidden: the clamp pin failed with
  `expected 24 to be 25`, which is how the float-drift defect was found
  (ledger row 4). Fixed forward, then re-gated.
- **Differential** (`.gate-logs/differential.sh`, lock held, restored in a `trap`,
  restore hash verified):

  | arm | `src/core/timestep.ts` sha256 | result |
  | --- | --- | --- |
  | A baseline | `e52d62cd281bac2b7e6e1f0046d988e48036d60d8ca441c5f908999033adcae0` | 8/8 green |
  | B no tolerance | `ef5a765359bea705fbce44f92388b2b1c16e6f73fa8085a0ceda3c3be9033313` | RED on `credits a long frame as at most maxFrame …` |
  | C no clamp | `33e50a4e0f92c0704af4f5f84a76b3dabb2fd9cc9735f03d51dd401cba3869a3` | RED on the same pin |
  | D no negative guard | `986d8409a17d7d6b05aaa45dd317d27b45c7f429abe77e307044035ae82768d8` | RED on `rejects a frame time that is negative or not finite` |

- **Honest observation:** arms B and C red the *same* pin. That pin is the one that
  asserts the exact slice count, so it holds both the clamp and the tolerance; the
  60 Hz drift pin stayed green under arm B, so it alone would **not** have caught the
  drift bug. Two properties, one pin — acceptable while the count assertion is the
  stronger statement, and worth splitting if a third property lands on it.
- **VOID probes:** none.
- **Not run:** no real-browser pin, no publish. Both are deliberate (board rows 1–2).

### row 26 — Slice A1 (the world model: rng, cells, destruction, debris, regeneration)

- **Cheap tier:** `GATE_TESTS=0 bash scripts/gate.sh` → exit `2`. That means the cheap tier
  (`pnpm run build` = `tsc --noEmit && vite build`) passed and the suite did **not** run — it
  is **not** "the gate passed". The full tier was **not run by the writer**; the dispatcher
  owns it once per landing ([`GATE.md`](GATE.md)).
- **Suite:** `pnpm exec vitest run` → **26/26** tests in 4 files (timestep 8, world 14, rng 2,
  purity 2), vitest 5.0.5, 242 ms.
- **Differential** (`.gate-logs/differential.py`, gitignored; each arm backs up `src/`, applies
  ONE mutation, runs the suite, restores in a `finally`, then verifies every restored file by
  sha256): **18 arms, 18/18 red, each reddening its named pin** in the matrix above. Raw logs
  `.gate-logs/arm-*.log`.
- **First run was RED** — recorded, not hidden:
  - the purity pin matched its own explanatory comment in `rng.ts` (`Math.random` in the doc
    prose). Fixed by making the scan skip documentation-only lines: a comment cannot import a
    renderer or draw a number, and a violation on a line carrying **any** code still fails. The
    scan also asserts it found ≥ 8 modules, so an empty glob cannot pass as clean.
  - the determinism pin expected the second tank at `(3, 1)`; the model put it at `(0, 1)`.
    The **model was right** (distance 1 beats distance 2) and the expectation was wrong;
    corrected.
- **Honest observation:** four arms red more than their own pin — arm 01 (no big blocks) also
  reds the block-regen and shard-cap pins; arm 02 (hole still solid) also reds the big-block pin,
  which asks `isSolidAt` over the rubble; arm 05 (early heal) also reds the block-regen and
  displacement pins; arm 07 (no displacement) also reds the determinism pin. That is dependency,
  not a duplicate pin: each pin still has an arm where it is the direct target. Worth splitting
  only if a third property lands on one of them.
- **VOID probes:** none. **Not run:** the full gate (the dispatcher's), any browser pin,
  publish.

### row 30 — Slice A2 (the render foundation and the look)

- **Full gate:** `bash scripts/gate.sh` → exit `0`, lock acquired. Raw
  `.gate-logs/gate.log`. The cheap tier is `pnpm run build` (= `tsc --noEmit && vite
  build`); the full tier is the suite.
- **Suite:** `pnpm exec vitest run` → **34/34** tests in 8 files (timestep 8, world 14,
  rng 2, core purity 2, camera maths 3, surface 2, render purity 2, merged world 1),
  vitest 5.0.5, ~0.4 s. The eight new pins are in the matrix above.
- **Screenshots (read with the image tool, not assumed):**
  - `.gate-logs/shots/wide.png` — the arena from a high 3/4 angle: dark navy wall
    faces with cyan top edges, a luminous 2 m floor grid with brighter 10 m lanes,
    four team colours readable (cyan, orange, magenta, lime), six missing-floor cells
    showing glowing hole rims, 16 tanks, and the debug readout `detail 0.30 · 115 calls`.
    Not black, not empty.
  - `.gate-logs/shots/tank.png` — close over-the-shoulder 3/4: the cyan focus tank
    with ice-white rear thruster slits and muzzle, its two cyan wingmen, a barrier wall
    and the orange team beyond, the camera arm clearly behind and above. Surfaces are
    dark; the lines carry the silhouette.
  - `.gate-logs/shots/first.png` — the first-person eye at 1.6 m through the central
    barrier gap: the floor breach's white rim ahead of the corridor, orange tanks at the
    far end, near walls framed left and right. The hull is hidden.
  - `.gate-logs/shots/wide-detail0.png` — the same wide pose with `?detail=0`: the
    fresnel rim is gone, the wall and tank surfaces are darker, and the edge lines are
    MORE dominant, not less. The two images are distinguishable, so the `SURFACE_DETAIL`
    knob is live; the default's surfaces never out-read the lines.
  - The readout's `4–5 fps` in these PNGs is Chrome's **virtual** clock
    (`--virtual-time-budget`), not a measurement. The real number is below.
- **Performance measurement:** Chrome headless at 1920×1080, the app's own rolling
  counter read over CDP for four seconds: **3.81 / 3.69 fps** (a third run 3.8) with
  **115 `renderer.info.render.calls`** (16 tanks, world, bloom, vignette, output). The
  renderer string is `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`.
  This host has **no reachable hardware GPU**: `/dev/dri/renderD128` is `root:render`
  and user `administrator` is not in the `render` group, `eglinfo`'s surfaceless driver
  is `swrast`, and `vulkaninfo` lists only `llvmpipe (LLVM, CPU)`. **60 fps is therefore
  neither met nor verifiable here**; the number is a software-rasteriser floor.
- **Reduction probes (before choosing a final setting):**
  | probe | fps | what it says |
  | --- | --- | --- |
  | final build, 1920×1080 | 3.7–3.8 | software ceiling |
  | bloom pass skipped | 7.3–8.1 | bloom is ~50 % of the software cost |
  | 960×540 | 12.6–13.1 | scales with pixels → raster-bound, not a frame-rate cap |
  | `BLOOM.resolutionScale = 0.5` | 3.8 | no measurable gain, so reverted to 1 (quality kept) |
  Geometry was already merged (four world draw calls, one edge buffer) and no shadows
  are used, so the only remaining lever would be rendering below 1080p — rejected: it
  breaks the pixel contract rather than tuning within it.
- **Screenshot harness:** `bash scripts/shot.sh <pose> <detail> <out>` — four runs
  (wide, tank, first, wide detail 0), each with `pnpm build`, a local `dist` server on
  127.0.0.1, the listed `--headless=new --disable-gpu …` flags, and a `trap` that kills
  the server and the Chrome **process group**; each run printed
  `chrome processes after cleanup: 0 (expected 0)`. The base flags produced a rendered
  frame (this host's only WebGL backend is SwiftShader, measured in the fps harness), so
  the `--enable-unsafe-swiftshader --use-angle=swiftshader` fallback was NOT exercised
  this landing. Raw logs `.gate-logs/shot-server.log`,
  `.gate-logs/shot-chrome.log`; the fps harness is the gitignored
  `.gate-logs/measure.mjs` + `.gate-logs/measure.sh`.
- **First run was RED at transform time** — recorded, not hidden: a backtick inside a
  GLSL template literal in `gridFloor.ts` closed the string (TS1005), and the first
  `pnpm exec vitest run` reported 1 failed file / 7 passed before any test executed.
  Fixed (the comment no longer contains a backtick); two TypeScript errors (a
  `TankSpawn`/`Vec3` mismatch and a narrowing lost inside the nested `frame` function)
  were fixed at the same time. The next suite run was 34/34 green. No test ASSERTION was
  red.
- **Not run:** a mutation differential for the render pins (they are geometry and
  config, not gameplay; the screenshot comparison is the look's evidence), a
  browser/pixel assertion (the PNGs are reviewed by image, not asserted), and publish.
- **Honest observations:** the hero bar is judged by these images; the placeholder tank
  is the weakest part of the look (a dark angular slab with neon trim, not a finished
  vehicle), and the wide shot's upper-left is empty void because the arena is a
  rectangle seen from a corner. Both are recorded, not polished away.


### row 33 — Slice A2b (the look pass: D1–D6 + the budget pin)

- **Full gate:** `bash scripts/gate.sh` → exit **0**, lock acquired. Raw
  `.gate-logs/gate.log`.
- **Suite:** `pnpm exec vitest run` → **39/39** tests in 11 files (the A2 34 plus
  team-luma, albedo-band, D1 polygon-offset, D6 void-data and scene-budget), vitest
  5.0.5, ~0.5 s.
- **The D1 cause (diagnosed, not guessed):** the fill triangles and the `EdgesGeometry`
  line segments are geometrically coincident. Their rasterised depths differ by a few
  ULPs, and the default `LessEqualDepth` rejects the line wherever the triangle wins —
  producing a periodic DOTTED silhouette. It was not a dashed material (none is used),
  not missing edge segments (`EdgesGeometry` emits every pair), and not the bloom
  threshold. The fix is `polygonOffset: true, factor 1, units 1` on the shared fill
  material, pushing the fill away so the line always wins. The pin asserts the material
  state; the old `.gate-logs/shots/zoom-tank.png` (A2) versus the A2b shots show the
  dotted/continuous difference.
- **Performance:** **3.58–3.75 fps** at 1920×1080 with 16 tanks + world + composer in
  ANGLE SwiftShader (A2 baseline 3.75; the DoD's software floor is 3.0). Draw calls
  **112** in the fps harness and **122** on the `wide` screenshot readout (budget
  ≤ 200). Scene-build stats measured in `node` from the SAME `buildArenaScene()`:
  **103 draw objects · 13,344 triangles · 39,232 vertices**; the pinned 20 % headroom
  is **124 / 16,100 / 47,100** (`SCENE_BUDGET`). The readout and debug API expose
  `103 obj · 13344 tri`; the stats are a GPU-independent regression gate, not a claim
  about hardware frame rate.
- **Screenshots (all read with the image tool):**
  - `.gate-logs/shots/wide.png` — high 3/4 from INSIDE the south-east perimeter: 6.2 m
    walls and 9.2 m pylons, two gate arches, fog-darkened far side, all four team
    clusters (the nearest lime tank is partly cropped), and two black hole voids with
    bright rims. Not black/empty.
  - `.gate-logs/shots/tank.png` — over-the-shoulder 3/4: the focused cyan tank with a
    distinct hex turret, cupola, long gun and ice-white muzzle, plus a wingman; the
    wall volumes read as dark panels with bright verticals and a top band.
  - `.gate-logs/shots/first.png` — the first-person corridor: the black hole void and
    its white rim ahead, orange team at the far end, the north gate arch framing the
    wall; the hull is hidden.
  - `.gate-logs/shots/wide-detail0.png` — the same wide pose at `?detail=0`: the wall
    sheen, top band, seams and rim are gone, surfaces are darker but still in the
    albedo band, and the edge lines dominate MORE. The pair is distinguishable but the
    textured state never out-reads the lines.
- **What changed after looking:** the first A2b render had D1 dotted lines (the depth
  bug above); the first passing build then had walls and gate arches that were washed
  to white, so the structure/vertical/gateway gains, rim/sheen/top-band opacity and
  exposure were reduced and the albedo gradient lowered to 2.07–4.07 %; the `wide`
  camera was moved inside the perimeter because the outside view still read as a board;
  the tank's gun was moved to a visible rest yaw and the wingman cleared from its muzzle;
  a red void-colour debug confirmed the hole quads are opaque black before the final
  rim/void shots.
- **First runs were RED, recorded not hidden:** after the inner hole rim loop was
  added, `worldMesh.test` still expected +8 rim vertices and received +16 — the
  expectation was stale, not the code; updated to +16 (outer + inset loops). The first
  `sceneBudget.test` run failed against a placeholder 9,000-triangle budget because the
  measured scene is 13,344 triangles; the budget was then measured and set to 20 %
  headroom. No other suite run was red.
- **Not run:** any GPU frame-rate claim (this host has no reachable GPU), a browser
  pixel assertion (the PNGs are reviewed by image), a mutation differential for the
  look pins (their mutations are named in the matrix), and publish.


### row 35 — Slice A2c (the measured surface pass)

- **Full gate:** `bash scripts/gate.sh` → exit **0**, lock acquired. Raw
  `.gate-logs/gate.log`. **Suite: 39/39 tests in 11 files**, vitest 5.0.5.
- **Look budget:** `python3 scripts/look-budget.py <frame.png>`; `shot.sh` now calls it
  after the final capture and a FAIL exits non-zero. The four measured rows are in the
  table above; all gated metrics pass, with the **wide** surface median at 5.1 % and
  the ten–twenty-percent frame share at 7.5 % (limits 8.6 % / 25 %).
- **What moved each number:**
  - floors/walls: fill albedo `#1d2931`/`#2b3b45` → neutral `#0c1011`/`#121819`
    (15.3 % → 5.8–8.8 % sRGB L), the floor surface to `#0c1112` (6.1 %), and the
    rim/seam/top-band gains cut; the wall/floor patches are now 3.9–7.8 %;
  - team hulls: the rim is **neutral** (`PALETTE.rimTint`) and hull fills are the same
    neutral shared material, so no team owns a hull surface; the trim keeps the hue and
    D5's gain normalisation (plus a 9 % lime render correction inside the ±10 % pin);
  - line dominance: p99 190–202 and contrast 14.7–19.0, both well over the floors;
  - composition: the wide camera was pulled back to x .36 / y .56 / z .55 of the
    arena span so all four team clusters and two gate arches read; the arch posts/beam
    were thinned (.55/.5, cap .12) and de-whitened to `gatewayEdge`;
  - default richness: the neutral wall sheen + panel seams are `SURFACE_DETAIL`-scaled;
    default surface median 5.1 % vs 3.9 % at `detail=0`, with the lines dominant in both.
- **First-run reds, recorded not hidden:**
  - the A2b frames failed the new tool: `wide` median 30 L / 45.4 % mid-band, `tank`
    29 L / 39.0 % (both above 22 / 25 %); the A2c darkening is the fix.
  - after the first darkening, `config.test` failed because the albedo pin still used
    **linear Rec.709** (expected ≥0.02, got 0.00447). The A2c brief's L is sRGB; the
    pin now uses `srgbLuma` and the same 2–10 % band. This is a corrected
    interpretation, not a widened threshold.
  - the team-trim diagnostic sits at 1.26× (lime high) and is **not** a hull measure:
    it is distance/coverage-confounded because the nearest lime tanks dominate the
    wide frame. The 9 % lime render correction keeps the linear D5 pin inside its ±10 %
    allowance; trim is printed as diagnostic and is not gated. The hull fill itself is
    the same neutral, shared material for every team.
- **Arms (each a deliberate red on a named budget; raw `.gate-logs/arm-look-*.log`,
  baseline config restored and sha256-verified):**

  | arm | mutation | measured result | shot exit |
  | --- | --- | --- | ---: |
  | `bright-fill` | restore A2b surface/grid `#1d2931` / `#344a55` | surface median 30 L (11.8 %) **FAIL**; mid share 23.1 % | 1 |
  | `dim-lines` | all `NEON` edge gains → 0.05 | line p99 48 **FAIL**; contrast 5.33 **FAIL** | 1 |
  | `bloom-flood` | bloom threshold .1 / strength 3 / radius 1 | surface median 62 L **FAIL**; contrast 4.02 **FAIL**; p99 249 | 1 |
  | A2b baseline (not an injection; the pre-A2c frames) | — | wide median 30 / mid 45.4 % **FAIL**; tank 29 / 39.0 % **FAIL** | n/a |

- **Shot harness:** four final `shot.sh` runs (wide, tank, first, wide-detail0), each
  with `pnpm build`, the static server, the listed Chrome flags and the `trap`; every
  run printed `chrome processes after cleanup: 0 (expected 0)` and the look verdict.
  The arms prove a look FAIL makes `shot.sh` exit 1.
- **Not run:** a GPU frame rate (SwiftShader only; A2b performance remains 3.64–3.87 fps
  at 1080p / 118 draw calls), publish, and a team-hull segmentation (the neutral/shared
  hull fill makes it unreliable — see the table note). No test assertion was red except
  the albedo-pin reinterpretation above; no black/empty frame occurred.

### row 37 — Slice A3a (the pure combat core)

- **Cheap tier:** `GATE_TESTS=0 bash scripts/gate.sh` → exit **`2`** (the required
  writer tier): `pnpm run build` (`tsc --noEmit && vite build`) green, the suite
  deliberately NOT run through the gate. Cheap log `.gate-logs/gate.log`. The full suite
  below was run directly with `pnpm exec vitest run` on the same tree; it was **not**
  run through the gate, so this row does not claim a green full gate.
- **Suite:** **59/59 tests in 12 files**, vitest 5.0.5, 472 ms; the 20 new tests are
  `src/core/sim.test.ts` (the rest is the 39-test A2 baseline, including the A1 RNG and
  world-hash pins touched by the shared `fnv1a` fold). Typecheck `pnpm exec tsc
  --noEmit` exit 0.
- **Scripted duel (the real simulation, not a mock):** two teams, one tank each; the
  shooter (team 0) starts at `(5, 10)` with hull/turret yaw 180 and holds `fire`; the
  target (team 1) starts at `(5, 20)` with hull yaw 0 and drives towards the shooter at
  `throttle 0.2`; both are driven by `ScriptedController` lists through `stepMatch`.
  Result: **ended at tick 124**, winner **team 0**, outcome **`last-team`**, target
  **dead**, cause of death **`shell`**, target moved z **20.00 → 17.52 m**. Hits landed at
  ticks **5, 65, 124** (HP 3→2→1→0). Stats: **`shotsFired 3 · hits 3 · kills 1 ·
  damageDealt 3 · causes.shell 1 · causes.clock 0 · ticks 124`**; no shell remains in
  flight. The third shell is the kill and no fourth shot is taken: the last-team check
  runs before the fire phase on that tick.
- **First runs were RED — recorded, not hidden. The red assertions were test-scaffold/scenario corrections, not evidence of a wrong combat rule; one code correction came from review:**
  - the first `sim.test.ts` transform failed with a missing `)` in a test expression
    (0 tests executed), and the first typecheck had 7 unused-import/helper errors in the
    test file; both were test-scaffold fixes.
  - the first executable sim run was **5 failed / 14 passed**: the diagonal-slide test
    expected a single wall cell to stop the tank, but a real tank slid AROUND it (the test
    was corrected to a full wall row); the pitch test constructed a spawn at `+30°` by
    negating the `-30°` minimum (outside the clamp) and was corrected to slew from 0°;
    the shard test passed a non-unit horizontal vector to `shardDeflection` and kept
    three centre-cell shards, so the expected direction/count were wrong (the test now
    keeps exactly one shard and passes a unit vector); the dead-tank loop's 100-tick
    guard could not reach the third reload at tick 121 (guard raised); and the scripted
    duel spawned its target at z 40 in a 24 m arena (z 20 now).
  - the scripted duel's first **armed target** at `throttle 1` drove through the shooter
    and past the muzzle, so the third shell could not hit. That is the **tank-tank
    collision debt** in `ARCHITECTURE.md` §4, not a shell bug; the test uses `throttle
    0.2` so the target stays in front and the duel still exercises movement. The debt is
    now recorded instead of hidden by the test.
  - code review, not a failing assertion, found the phase-order mismatch: an early
    last-team check after the bleed phase ended a match before existing shells advanced.
    It was removed so the order is exactly commands/drive/aim → world → bleed → existing
    shells → ONE last-team check → fire → cap. `idleTankCommand` now validates pitch
    through the command boundary instead of accepting an out-of-range value.
- **Not run:** the full `bash scripts/gate.sh` (the dispatcher owns the integrated full
  tier), any mutation differential for the 20 sim pins (the matrix says so), a browser
  or pixel assertion (this slice touches no renderer), publish, and any AI/input
  integration. The render test files stayed green, which is the evidence that the core
  did not import or disturb the renderer.

### row 39 — Slice A3b (collision correctness)

- **Cheap tier:** `GATE_TESTS=0 bash scripts/gate.sh` → exit **`2`** (build green; suite
  deliberately not run). Raw `.gate-logs/gate.log`.
- **Suite:** **66/66 tests in 12 files**, vitest 5.0.5; 26 sim tests and 3 core-purity
  tests (the other 37 are the A1/A2 baseline). `pnpm exec tsc --noEmit` exit 0. The
  seven A3b pins are in the matrix above. A3b did not run the full `bash scripts/gate.sh`
  (the dispatcher owns the integrated full tier).
- **Duel trace is unchanged from the A3a baseline:** shooter `(5,10)` firing at a target
  `(5,20)` at throttle 0.2; shots at ticks **1/61/121**, hits at **5/65/124**, target
  **z 20.00 → 17.52 m**, ended **tick 124**, winner team 0, outcome `last-team`, cause
  `shell`; stats **3 shots / 3 hits / 1 kill / 3 damage / causes.shell 1 /
  causes.clock 0**. Body blocking never engages because the target is still 7.52 m short
  of the shooter at the end; the muzzle sweep never sees it. This is a baseline-preserved result, not
  an unchanged test file.
- **What the new rules are:** tank bodies are circles of `TANK_RADIUS_METRES` (1 m),
  resolved by a swept circle-vs-circle test in ascending tank-id order with full → x-only
  → z-only candidate order. `createMatch` rejects a same-cell spawn or any circle overlap
  before constructing a state. The muzzle trace runs from the turret origin to the
  muzzle through `earliestCollision` with the owner excluded; a hit resolves immediately,
  never enters `state.shells`, still increments `shotsFired` and spends the reload. The
  world-owned `CELL_SIZE_METRES` is imported by `src/render/config.ts`.
- **No test assertion was red on the first A3b suite run.** One manual probe before the
  pins were written found a real boundary gap: a muzzle exactly flush with a wall face
  was missed because the cell range used `floor(max)` and excluded the wall cell. Fixed
  by including the cells adjacent to both segment endpoints and by rejecting only boxes
  whose segment span has `far > 0`; the same probe then damaged the wall once. The
  boundary fix is folded into the muzzle pins; it is not hidden as a later re-run.
- **Not run:** the full gate (dispatcher), any mutation differential (the matrix says so),
  a browser/pixel assertion, publish, and AI/input integration. The render suite stayed
  green; only `src/render/config.ts` and `gridFloor.test.ts` changed on the render side
  (cell-size import), with no three.js or DOM change.

### row 41 — Slice A3c (playable: bridge, input, render, HUD, look hardening)

- **Full gate (touched `scripts/`):** `bash scripts/gate.sh` → exit **`0`** (lock acquired)
  on the rebased tree; full suite **78/78 in 15 files**, vitest 5.0.5. Raw
  `.gate-logs/gate.log`.
- **Cheap/typecheck:** the full gate's cheap tier (`pnpm run build` = `tsc --noEmit &&
  vite build`) is green; `pnpm exec tsc --noEmit` independently exit 0.
- **Playable scene:** two sim tanks on the real A1 world, one static dummy; the app's
  scene measured **19 draw objects / 3,536 triangles / 10,648 vertices** in node, and
  **34 renderer calls** through the post pipeline at 1920×1080. The old A2 103-object
  fixture remains a separate `sceneBudget.test` ceiling, not the app count.
- **Hull/body:** `TANK.hullWidthMetres` is 2.0 m → measured half-width **1.00 m**, body
  radius 1.0 m; the pin allows ≤1.05. Hull length is 2.6 m (nose/tail extend beyond the
  circle; recorded debt).
- **Input:** pure mapping pinned; no pointer lock (cursor position is aim); WASD,
  hull-relative mouse yaw ±60°, vertical pitch +25…−30°, click/Space fire.
- **Demo scenario:** `?demo=duel&ticks=122` freezes after 122 ticks: dummy at **1 HP**,
  **1 shell in flight**, one wall cell breached, shots 3 / hits 2 / kills 0. At ticks
  **123** the third shell kills the dummy (winner team 0, `last-team`); the session pin
  proves death/win, while `shot.sh combat` uses 122.
- **Screenshots (all read with the image tool; 1920×1080):**

  | pose | void | surface median | mid-band | line p99 | contrast | tile p90 | verdict |
  | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
  | `wide` | 42.3 % | 12 L (4.7 %) | 9.1 % | 188 | 15.67 | 26 L (10.2 %) | PASS |
  | `tank` | 33.2 % | 8 L (3.1 %) | 5.5 % | 187 | 23.38 | 22 L (8.6 %) | PASS |
  | `first` | 43.9 % | 6 L (2.4 %) | 4.4 % | 156 | 26.00 | 17 L (6.7 %) | PASS |
  | `combat` | 29.6 % | 8 L (3.1 %) | 5.3 % | 188 | 23.50 | 24 L (9.4 %) | PASS |

  `scripts/shot.sh` prints `chrome processes after cleanup: 0 (expected 0)` on every
  pose. `wide` shows the compact player and dummy in the arena; `tank` the player view;
  `first` the dummy down the corridor; `combat` the player, damaged orange dummy, shell
  streak and the single-cell wall breach.
- **Spatial look proof:** a temporary white rectangle injection in
  `.gate-logs/tile-injection.png` measured **tile p90 255 L (100 %)** and the tool
  exited **1** with `tile p90 ... > 30.6 L (12%)`; JSON
  `.gate-logs/look-tile-injection.json`. The four final poses pass at 17–26 L.
- **Performance:** SwiftShader measured **3.48–3.69 fps** / 34 draw calls at
  1920×1080; this host has no reachable GPU. The screenshot counter reads 4 fps because
  `--virtual-time-budget` fast-forwards the page clock.
- **First-run reds, recorded:**
  - the first input test failed twice on `-0` vs `+0` for the centre pitch; the mapping
    was corrected to return exact `0` at pointer centre.
  - the first-person pose initially failed the line-p99 floor (88; a near wall supplied
    too few bright pixels), and later intermediate wide/combat trials failed the new
    tile p90 (44 / 35) when grid/structure gains were raised globally. The final pass
    uses a closer dummy/target, a single-cell breach and a team-edge gain of 3.0 while
    keeping grid gains at their A2c values; all four frames then pass.
  - no simulation or bridge assertion was red; the full suite was green on its first
    A3c run after those test/visual corrections.
- **Not run:** a GPU frame-rate claim, a browser-level synthetic click/key test (the
  pure mapping is pinned), publish. The screenshot script owns the Chrome tree and the
  full gate owns the suite.


### row 43 — Slice A4 (authored arena, load validation, top plan)

- **Full gate (touched `scripts/`):** `bash scripts/gate.sh` → exit **`0`** (lock
  acquired) in-turn; full suite **85/85 in 16 files**, vitest 5.0.5. Raw log at the
  repository root `.gate-logs/gate.log`; the worktree's post-rebase run repeats it.
- **What is one seam, not two:** `src/game/levels/format.ts` is the ONE level format
  and load validator; `src/game/levels/arena.ts` is the ONE authored `ARENA`; the
  deleted `src/game/level.ts` is not imported anywhere. `PlayableSession` calls
  `validateLevel(ARENA)` before `createMatch`, and `createMatch` receives
  `ARENA.cells`. The A2 `demoWorld`/`sceneAssembly` remains the budget fixture, not a
  second app render path. The top pose renders the SAME scene/composer through an
  orthographic camera; it is not a second app.
- **Validation pinned (7 tests):**
  `the authored arena passes every load-time check`, `a level with an overlapping
  spawn is rejected`, `a level whose spawns are not all connected on foot is
  rejected`, `the arena grid is invariant under 90° rotation`, `every spawn zone is
  free of solid cells`, `rejects an off-grid or illegal material before a world is
  built`, and `no spawn has a clear straight line to another spawn`. The validator
  checks square bounds, integer cells, legal materials, height above the floor,
  exactly four unique 2–4-cell spawn zones, free non-overlapping spawn cells, a
  four-neighbour flood fill from spawn 0, and 90° material/height symmetry (four
  applications = four-fold). Cell failures name `(x, z)`.
- **Layout as built:** 24×24 cells at 2 m (48×48 m). Outer square ring at cells 5…18,
  4.8 m; inner ring at 8…15, 4.2 m; both have a 2×2 cell gateway at every corner.
  The breakable centre is a 2×2 pillar block (cells 11…12, 4.8 m) with four 3.6 m
  corner pillars; ambush pockets are a 3.2 m pillar at (7, 7) and 2.6 m shadows at
  (7, 9)/(9, 7), rotated. Low 1.2 m shoot-over barriers line the cardinal lanes.
  Each 2×2 corner spawn room has north/south walls, a camera recess on the outer
  side, and a screened dogleg east corridor that turns south into its nearest outer
  gateway. The original east-only exits exposed the adjacent spawn down the open
  margin; the top plan and the new blocked-line pin show the fix. All six spawn-pair
  centre lines are blocked by architecture at start.
- **Look retune (dense arena):** the A3c rim was tuned for a 20×14 empty hall. In the
  authored 48 m arena the default `SURFACE_DETAIL` rim pushed first/combat below the
  tile gate, so `RIM_OPACITY_AT_FULL_DETAIL` is **0.75 → 0.20**,
  `RIM_WALL_SHEEN` **0.45 → 0.28**, `RIM_TOP_BAND` **0.04 → 0.015**, the fills are
  darker (`#0a0d0e`/`#0f1415`), and `NEON.teamEdgeGain` is **3.0 → 3.2** so the
  denser first-person frame still clears line p99. The edge lines and the tile gate
  are unchanged; this is a measured adjustment, not a threshold widening.
- **Screenshots (all read with the image tool; 1920×1080; `shot.sh` reports Chrome 0):**

  | pose | void | surface median | mid-band | line p99 | contrast | tile p90 | verdict |
  | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
  | `wide` | 60.6 % | 8 L (3.1 %) | 2.5 % | 187 | 23.38 | 11 L (4.3 %) | PASS |
  | `top` | 84.4 % | 19 L (7.5 %) | 3.6 % | 163 | 8.58 | 15 L (5.9 %) | PASS |
  | `tank` | 66.1 % | 14 L (5.5 %) | 4.2 % | 187 | 13.36 | 23 L (9.0 %) | PASS |
  | `first` | 57.9 % | 10 L (3.9 %) | 3.4 % | 157 | 15.70 | 21 L (8.2 %) | PASS |
  | `combat` | 35.3 % | 13 L (5.1 %) | 5.5 % | 202 | 15.54 | 27 L (10.6 %) | PASS |

  Images: `.gate-logs/shots/wide.png`, `top.png`, `tank.png`, `first.png`,
  `combat.png`. `wide` shows the four corner rooms and ring/gate silhouette; `tank`
  the player at its screened spawn with the training target beyond; `first` the
  orange target down the protected corridor; `combat` the central ambush-pillar
  breach, player and damaged orange target. The top frame hides all tanks and is
  read as a plan: white cell grid, dark-cyan tall walls/pillars, dark-amber low
  cover, olive breakable objective, solid team-coloured 2×2 spawn zones, white
  L-shaped exit arrows and the HTML title/intent/legend. It is legible at 1920×1080
  without a projected label.
- **App numbers:** the playable scene measured **16 draw objects / 5,808 triangles /
  17,432 vertices** and **31 renderer calls** in a headless probe at 1920×937; the
  old A2 fixture remains **103 / 13,344 / 39,232** and is a separate ceiling, not an
  app claim. `top` adds the plan overlay (one fill mesh + one line buffer) and hides
  the tanks.
- **Demo/session:** `?demo=duel&ticks=122` still freezes at 1 HP, one shell in
  flight and a real ambush-pillar breach; the shell kill/win is at tick 124. The
  training dummy is now at 12 m, in the protected corridor, and the opened south
  bypass lets the player leave without driving through it. The demo stage remains
  the NW diagonal; the app uses the authored arena in both demo and training mode.
- **First-run reds, recorded:**
  - the first spawn layout's east exits faced the adjacent spawn directly; the top
    plan showed the open north/south margin. Rebuilt as walled rooms with screened
    dogleg exits, then pinned all six pair lines.
  - the first `first`/`combat` frames failed after the arena: the untouched rim gave
    `combat` tile p90 **52 L (20.4 %)** and the first-person attempts 31–39 L. The
    final pass is the rim/team-gain retune above, not a raised threshold.
  - the first top-plan fills were too bright (surface median 44 L, contrast 3.68),
    so the plan fills were darkened to the current `topWallFill`/`topLowFill`/
    `topObjectiveFill`; the final top PASSES with median 19 L.
  - the connectivity test's first island was no longer an island once the camera
    recess and corridor existed; the test now seals both the recess and the corridor
    mouth. The arena/session runs are green on the final tree.
- **Not run:** a GPU frame-rate claim (no reachable GPU), a mutation differential
  (no arms were executed for A4; the matrix names the one-line red for each pin), a
  browser-level input test, publish, and AI. The top-plan arrows are authored for
  this arena, not generated from arbitrary level data.


### row 45 — Slice B1a (AI perception, navigation, vanguard, batch)

- **Full gate:** `bash scripts/gate.sh` → exit **`0`**; suite **98/98 in 21 files**
  (vitest 5.0.5). Cheap tier (`pnpm run build`) exit `0`. Raw log at the repository
  root `.gate-logs/gate.log`; the post-rebase run is the landing evidence.
- **A4 findings fixed first:** `validateLevel` now floods the central objective window
  (4×4 on this even grid) from the spawn component and requires every passable centre
  cell; the test closes both rings' gateways symmetrically and gets a centre-cell
  rejection. `isLowCover(height)` is the ONE predicate used by the mesh and the plan;
  1.2 m is low, 4.2/4.8 m are not, and a 0.5 m threshold reds the pin.
- **AI core:** `src/core/ai/` contains `perception.ts` (3D height-aware sightline,
  `visibleEnemies`, `PerceptionMemory`), `navigation.ts` (four-neighbour A* over body-
  free centres, body-clear smoothing, `NavigationCache` invalidated by `world.revision`
  or a goal CELL, `reachablePointNear` patrol), `profile.ts` (`validateAIProfile`,
  `VANGUARD_PROFILE`), `controller.ts` (`AIController implements Controller`, 6-tick
  decisions, held command, seeded tie-break/jitter/phase), and `batch.ts` (the pure
  match runner). `src/core/ai.ts` is the entrance. No renderer, DOM, clock or game
  import.
- **Batch command:** `pnpm batch --seeds 100 --teams 2` (native
  `node --experimental-strip-types scripts/batch.ts`). It runs real arena matches through
  the real `createMatch`/`stepMatch`/`AIController`, writes `reports/batch.json` and
  `reports/trace-seed-0.jsonl` (gitignored), and prints the table below.
- **First 100 matches (two teams, one vanguard each, seeds 0–99):**

  | metric | value |
  | --- | --- |
  | matches | 100 |
  | draws | 0 |
  | win split | team 0: **85** · team 1: **15** |
  | mean match ticks | **315.4** |
  | median match ticks | **306** |
  | cap hits | **0 / 100 (0.0 %)** |
  | shots / hits / accuracy | 547 / 489 / **89.4 %** |
  | kills | 100 |
  | time-to-kill (first shot → first death) | mean **161.9** ticks; median **145**; n=100 |
  | deaths by cause | shell **100** · clock **0** |

  Match lengths range **290–367** ticks (p25 297, p75 334); 21 distinct lengths across
  the 100 seeds. The median is the number the dispatcher asked to see; the cap was hit
  **never** in this run.
- **What the first batch told us that the code did not:**
  - the **team-0/team-1 win split is 85/15** even on the 4-fold arena. The cause is the
    simulation's ascending tank-id command/fire order plus the differing seeded
    reaction phases, not spawn asymmetry. B1b/B2 must decide the fairness remedy; it is
    recorded, not hidden by a batch tweak.
  - the initial vanguard stood still for all 18,000 ticks because the geometric centre
    is the central pillar cell and A* refused a solid goal. The fix is a reachable patrol
    point (`reachablePointNear`); this was a real 0-shot / 100 %-cap run before the fix.
  - a boundary lane gave the tank exactly zero side clearance (`z = 1.0006` against a
    4 m wall); it wedged at x≈3.93. Navigation now rejects zero-clearance boundary
    cells, and body-clear smoothing samples the real footprint.
  - with only the six-tick cadence and no jitter every seed produced the **same** match
    (349 ticks, team 0). Seeded decision phase + stand-off/patrol jitter now produce 21
    lengths and both winners; the deterministic batch pin still passes.
  - aiming at the physical body centre (0.75 m above the floor) made every shot hit the
    low cover or miss: **0 hits and 100 % cap** in a trial. The vanguard now aims at the
    turret point (1.0 m above the floor); the shell-over-cover limitation is recorded.
  - all deaths were shell deaths; the lethal clock was never reached (match length is
    far below 600 ticks). No draws.
- **Pins:** 11 AI tests plus the two A4 gap tests above. The AI tests cover LOS over low
  cover/tall walls, memory, destroyed/healed route invalidation, revision/goal cache,
  body-clear waypoints, aim cone, 6-tick held decisions, route recomputation within the
  next decision, same-seed decisions, profile validation and 3-seed batch reproduction.
  A test-only 600-tick cap keeps the batch pin fast; the reported 100-match run uses the
  real 18,000-tick rules.
- **Not run:** live all-AI spectator, other characters, cover/flank/breach behaviour,
  a GPU frame-rate claim, or a mutation differential. The vanguard's no-route stop and
  its turret-centre aim are deliberate B1a limits, not a claim of tactical play.


### row 47 — Slice B1b (fairness and pacing)

- **Full gate:** `bash scripts/gate.sh` → exit **`0`**; cheap tier `pnpm run build` exit
  `0`; suite **99/99 in 22 files** (vitest 5.0.5). Raw log at the repository root
  `.gate-logs/gate.log`; the post-rebase run is the landing evidence.
- **Before / after (200 seeds, vanguard vs vanguard, 1v1 on the arena):**

  | metric | B1a (100 seeds) | B1b (200 seeds) | target |
  | --- | ---: | ---: | ---: |
  | team-0 win split | **85.0 %** | **49.5 %** (99/101) | 40–60 % |
  | median length | **306 ticks** | **934 ticks** | 900–1800 |
  | accuracy | **89.4 %** | **52.0 %** | 30–60 % |
  | cap hits | **0 %** | **0 / 200 (0.0 %)** | ≤10 % |
  | shots / match | 5.47 | **7.38** | ≥6 |
  | clock deaths | **0** | **87 / 200 (43.5 % of matches)** | >0 measurable |
  | mean speed while alive | not measured (static; first B1b trace **0.29 m/s**) | **2.24 m/s** | >1.5 |
  | draws | 0 | **0** | — |

  Final table: mean **1005.9**, median **934**, min/max **579/2487** (p25 901, p75
  1201), 143 distinct lengths; shots 1476, hits 767, kills 113 shell + 87 clock; TTK
  from first shot mean **992.1**, median **906.5**, n=200. `reports/batch.json` and
  `reports/trace-seed-0.jsonl` are gitignored.
- **What the bias actually was.** It was not the candidate sequential-fire order:
  reversing the fire loop changed nothing (85/15 unchanged). It was two things:
  (a) the phase was derived from the tank id (`controllerSeed % 6`, with the two id
  constants differing by 3 mod 6), so tank 0 had a fixed three-tick initiative;
  (b) the 1v1 used the first two authored corner spawns, which are adjacent and NOT a
  symmetry pair — their exits point different ways and their paths/cover differ. A
  symmetric open-margin staging and a **team-balanced phase** `(seed + 3·team) mod 6`
  produced 99/101. Same-phase AI produced all draws; fixed-phase/id seeding produced
  the 66/34 and 85/15 bands.
- **Fairness fix / mirror pin.** The 2-team batch now uses `arenaDuelSetup()` at
  (18, 6)/(30, 6) on the open north margin; adjacent-author corner spawns remain the
  arena/4-team layout. The mirror pin is **scripted at the simulation level** because
  an AI match is deterministic-chaotic and does not reproduce exactly under mirror:
  original team 0 wins at **tick 7** with one shell death; the same script on the
  z-mirrored level, tanks mirrored and team ids swapped, has **team 1 win at tick 7**
  with one shell death. `src/game/mirror.test.ts` passes; it also confirms the
  candidate id/action-order bias is not a mirror failure in the scripted path.
  An AI-level mirror remains known debt.
- **Levers chosen (and the trade):**
  - **AI shot interval 285 ticks** (`AI_FIRE_INTERVAL_TICKS`), not the global
    `RELOAD_TICKS=60`. I left the app/demo reload alone; the AI deliberately waits.
  - **Aim spread 10° + 1.8°/m** (with 35 % pitch spread) seeded by the controller RNG;
    this is the accuracy lever (89 % → 52 %).
  - **Continuous strafe** while a target is visible, **60-tick dodge** after a shot or
    hit, direct fallback when A* has no path; this is the speed/reposition lever
    (0.29 → 2.24 m/s).
  - **Wound clock 600 → 900 ticks.** With 3 HP and a 600-tick clock the median
    stalled at ~710 and 124/200 matches ended by clock; the 900-tick clock (still a
    measurable 87 clock deaths) is the trade that lets shell fights reach 15.6 s.
  - No HP/damage change. No global reload change.
- **First-run reds, recorded:** same-phase controllers drew every staging match; the
  phase/id correlation produced 85/15 and then 66/34 on the open staging; 150- and
  250-tick shot intervals stayed below the 900-tick median or collapsed shell kills
  into clock deaths; continuous strafe initially still measured 0.58 m/s because A*
  returned null and the controller stopped, fixed with direct fallback movement; the
  first mirror probe with AI failed on lengths and causes, which is why the pin is
  scripted and the AI mirror is recorded as debt.
- **Not run:** a live all-AI spectator, an AI-level mirror, a GPU frame-rate claim,
  or a mutation differential. The 900-tick clock is a deliberate
  pacing trade, not a claim that the A3c 10-second clock was wrong.

### row 49 — Slice B1c (the cast and the signature round robin)

- **Full gate:** `bash scripts/gate.sh` → exit **`0`**; suite **100/100 in 22 files**
  (vitest 5.0.5). Raw log at `.gate-logs/gate.log` (gitignored).
- **Round robin:** `pnpm round-robin --seeds 200` (the script also runs as
  `node --experimental-strip-types scripts/round-robin.ts --seeds 200`): **1200 matches**
  (6 pairings × 2 orientations × 100 seeds), **21 draws**. Final report is
  `reports/round-robin.json` (gitignored).

  | row \ column | vanguard | sniper | ambusher | brute |
  | --- | ---: | ---: | ---: | ---: |
  | vanguard | — | 91 / 200 | 111 / 199 | 149 / 198 |
  | sniper | 109 / 200 | — | 117 / 200 | 108 / 199 |
  | ambusher | 88 / 199 | 83 / 200 | — | 129 / 183 |
  | brute | 49 / 198 | 91 / 199 | 54 / 183 | — |

  | character | wins | matches | win % |
  | --- | ---: | ---: | ---: |
  | vanguard | 351 | 600 | **58.5 %** |
  | sniper | 334 | 600 | **55.7 %** |
  | ambusher | 300 | 600 | **50.0 %** |
  | brute | 194 | 600 | **32.3 %** |

  All four overall rates are inside the required **30–70 %**; brute is the floor
  case (2.3 points of headroom).
- **Signatures (mean over 600 matches each; median over the four means):**

  | character | engagement m | world damage | out-of-LOS | speed m/s |
  | --- | ---: | ---: | ---: | ---: |
  | vanguard | 7.2 | 0.26 | 19.8 % | **2.03** |
  | sniper | **15.2** | 0.57 | 23.9 % | 1.11 |
  | ambusher | 13.2 | 0.54 | **46.7 %** | 0.74 |
  | brute | 10.7 | **1.06** | **49.0 %** | 1.20 |
  | field median | 12.0 | 0.55 | 35.3 % | 1.16 |

  Deltas against the field median on each profile's own signature: sniper engagement
  **+26.8 %**, vanguard speed **+75.6 %**, ambusher out-of-LOS **+32.4 %**, brute
  world destruction **+92.1 %**. All four clear the required **≥20 %**.
  **Honest limit:** the ambusher is not the field's highest out-of-LOS character — the
  brute's breach detour measures **49.0 %** against the ambusher's **46.7 %**. The
  ambusher's signature separates it from the median, not from the brute.
- **Pins added/updated:** `the duel staging … exact mirror pair across the arena
  centre` in `src/game/aiBatch.test.ts` pins (18, 6)/(30, 6) and the ±90° yaw as an
  x-mirror through the 48 m centre. `profile.test.ts` now uses a genuinely unknown goal
  key (`marksman`), because `flank` became a valid key in B1c. The three-seed batch
  reproducibility pin is unchanged.
- **First-run reds, recorded:**
  - The first B1c vitest run was **1 failed / 100 passed**: the old profile test still
    treated `flank` as unknown. It was updated to `marksman`; the new staging pin then
    passed.
  - A 20-seed smoke had **ambusher 75.0 % / brute 25.0 %** overall; ambusher
    out-of-LOS was **13.4 % vs median 14.9 %** and brute world damage **0.38 vs 0.47**.
    Sniper engagement **15.0 vs 12.0 (+25 %)** and vanguard speed **2.20 vs 1.30
    (+69 %)** already passed.
  - The ambusher's hidden-cell picker chose body-free cells inside sealed pockets; a
    sampled match measured **0 %** actual out-of-LOS while it tried to reach one. The
    fix checks `findPath` reachability (up to the 12 nearest hidden cells) before
    holding; the 200-seed share rose to **46.7 %**.
  - Seed 3 of vanguard vs brute crashed at **tick 432** with
    `command.aimYaw must be finite, got NaN`: a stale breach cell was aimed at while the
    target was hidden, so the old range-scaled spread used `distance = Infinity`. Breach
    aim now uses the actual `aimDistance` and a tight fixed spread.
  - A one-line mistake that reset `breachedCell` at the start of every decision made the
    brute inert: its win rate collapsed to **1.7 %** and its world-destruction number
    swung to **3.92**. Removing the reset (and persisting the target until the cell is
    destroyed) restored the intended behaviour; the wrong number is not in the final
    report.
  - The first full 200-seed run with brute aim **8° + 1.0°/m** left brute at **24.5 %**
    overall. Tightening to **4° + 0.6°/m** raised it to **32.3 %**; the breach-wall aim
    is a separate tight spread, so the world signature stayed at **+92.1 %**.
- **Not run:** a live all-AI spectator, an AI-level mirror beyond the scripted pin, a
  mutation differential for B1c, a 16-tank/4-team round robin, and GPU frame rate. The
  round-robin acceptance is a CLI measurement; it is not a vitest pass/fail pin.

## Honest records

A VOID probe, a wrong-file green, a discarded log and a run against a stale tree are
**recorded, not hidden**. An honest unknown is worth more than a confident green.

### row 26 — the dispatcher's own verification (e62865b)

Not the writer's arms. Four injections, each aimed at a *different* named pin, with the
lock held, the tree restored from HEAD in a `trap`, and the whole `src/` tree hash
printed per arm (`6ad2e950…` baseline, restored identically after every arm).

| arm | src tree sha256 (mutated) | result |
| --- | --- | --- |
| cap-newest-first (`shift()`→`pop()`) | `dec8e2acb9ee…` | RED on `shards are capped; when the cap is exceeded the oldest despawns first` |
| mirror-off-by-one-step (next normal in the table) | `d0ef2ec8ada8…` | RED on `a shard deflects a shell at its stored mirror angle` |
| height-boundary-inclusive (`<`→`<=` in `isSolidAt`) | `8b159335a4ec…` | RED on `a wall stops a shell at its own height and never above it` |
| displacement-stacks-occupants (shove onto an occupied cell) | `3e1d4c5c7121…` | RED on `displacement is deterministic: …` |

- **Finding:** the fourth arm red the *determinism* pin rather than
  `…displaced to the nearest free cell…`, so free-ness is pinned only indirectly. Not a
  defect (the behaviour is caught), but a pin-coverage gap worth closing when A2 starts
  moving tanks around.
- **Raw logs:** `.gate-logs/arm-<name>.log`; harness `.gate-logs/differential-a1.sh`.
- **Gate:** my own full tier on the integrated tree — 26/26, exit 0, `lock=acquired`.

### row 30 — the dispatcher's own verification (7b1785f / 5d6b9cf)

- **First gate run was on a STALE tree** (26/26, missing A2's 8 new tests) because the
  writer had pushed and I had not pulled. Caught by comparing the count with the landing
  report, then integrated and re-run. Recorded as a board trap.
- **Integrated gate:** 34/34, exit 0, lock acquired.
- **My arms** (none the writer's), lock held, tree restored from HEAD in a `trap`:

| arm | src tree sha256 (mutated) | result |
| --- | --- | --- |
| zoom-unclamped (`clampDistance` → identity) | `762b6958…` | RED on `the camera zoom is clamped and first person is entered at the documented distance` |
| surface-detail-default-full (`0.3` → `1.0`) | `de383dc6…` | RED on `SURFACE_DETAIL defaults to 0.3 and can be set to 0 and back by one function` |
| core-imports-three (a `three` import added to `src/core/timestep.ts`) | `c4c1c08e…` | RED on both the core purity pin and `no file outside src/render/… imports three` |

- **Harness verified by the dispatcher:** `bash scripts/shot.sh wide 0.3 …` → exit 0,
  rendered with the listed flags, `chrome processes after cleanup: 0 (expected 0)`, a
  836 KB PNG at 1920×1080. Before and after the run, `ps -eo comm= | grep -cx '^chrome$'`
  was `0`.
- **Performance limit:** no reachable GPU on this host — SwiftShader at 3.7–3.8 fps for
  16 tanks at 1080p, 115 draw calls. The DoD clause is amended (ledger row 31); the
  number is a regression baseline, never a "60 fps" claim.

### row 33 — the dispatcher's own verification (f316baa)

- **Integrated gate:** 39/39, exit 0 (integrated before running, after learning the
  stale-tree lesson).
- **My arms:** `no-polygon-offset` → RED on the D1 pin; `team-luma-off` → RED on the
  ±10 % luma pin; `budget-doubled` (spawns concatenated) → RED on the scene-budget pin.
  Tree restored to `c92abd25` after each, verified by hash.
- **VOID probe recorded:** one arm changed bytes but not geometry, so its green proved
  nothing. Named VOID rather than counted as evidence.
- **Dispatcher error recorded:** the budget arm's backup path was `/tmp` while the `trap`
  restored from `.gate-logs/`, so the mutation survived; the printed "restored" hash was
  the *mutated* value. Caught by comparing with the baseline and repaired from the real
  backup. Rule added to the board traps.
- **Measured §9 result:** surfaces 14–17 % of white (budget 2–10 %), lime hull 31.7 %,
  44.8 % of pixels in the 10–20 % band. A2b fails the surface budget; A2c dispatched.

### row 35 — the dispatcher's verification, and a weak gate found

- Integrated gate 39/39, exit 0.
- **Patch measurements** (PIL, 10×10 medians) on the new frames: wide walls 3.9–7.8 %,
  floor 9.4 %, hull 10.6 % (one 20.2 % sample is a bloom-lit band, not a flat surface);
  tank floor 11.0 %, walls 1.6–5.1 %, hull 9.0 %. Against A2b (14–17 % walls/floor, 31.7 %
  lime hull) the pass is real.
- **`look-budget.py` passes the OLD A2 frames too.** Its whole-frame surface median cannot
  see a locally bright wall, so a PASS does not mean "no bright surfaces". It is a floor,
  not a guarantee. **Hardening required (A3b):** a tile-median metric (e.g. 24×14 tiles,
  p90 of tile medians ≤ 10 % of white) so a bright wall cannot hide in a dark frame.
- The writer's own arms (`bright-fill`, `dim-lines`, `bloom-flood`) each made `shot.sh`
  exit 1, so the tool does catch *global* regressions — the gap is spatial, not plain.

### row 37 — the dispatcher's own verification (a009de8)

- **Integrated gate:** 59/59, exit 0.
- **My arms** (the writer ran no mutations on these 20 pins):

| arm | src tree sha256 (mutated) | result |
| --- | --- | --- |
| friendly-fire (teammate immunity bypassed) | `584e82ab…` | RED on `a shell cannot damage a teammate and stops at the teammate's body` |
| reload-ignored (fire every tick) | `97a13250…` | RED on the reload pin **and** two downstream pins (one damage per shell, the scripted duel) |
| bleed-disabled (the clock never ticks) | `1d9d4708…` | RED on `a wounded tank loses one HP per bleed interval and can die from the clock` |

- **Watched, not summarised:** a per-tick trace of the scripted duel (temporary vitest
  file, deleted after; tree left clean). Shots at ticks 1/61/121, 10 m of flight in 4
  ticks, kill at tick 124, target closing at 0.02 m/tick on throttle 0.2, no bleed inside
  124 ticks. These are the baseline numbers for tuning later.
- **Accepted debt, blocking for teams:** no tank-tank collision; a point muzzle 3 m ahead;
  an unpinned cap tie; the 2 m cell size duplicated across render and sim. All four are
  A3b (ledger row 38), before wiring the renderer.

### row 39 — the dispatcher's own verification (ee4050f)

- Integrated gate 66/66, exit 0.
- **Arms:** `bodies-dont-block` → RED on `a tank cannot drive through another tank`;
  `muzzle-sweep-skipped` → RED on the sweep pin and the spawn-inside-solid pin;
  `spawn-overlap-allowed` (`minimumDistance` → 0) → **GREEN**.
- **The green arm is the finding:** the same-cell rejection fires before the circle check,
  so `minimumDistance` can be zeroed without any test noticing. The **circle-overlap**
  half of "reject overlapping spawns" is therefore unpinned. Required pin for A3c: two
  tanks in *adjacent* cells whose circles overlap must be rejected.
- **Body vs hull:** radius 1 m (2 m diameter) against a 3.4 × 2.5 m rendered hull — the
  writer reported it, and it will be visible. A3c aligns the hull to the body; capsule or
  oriented bodies stay on the debt list.
- The duel trace is unchanged by A3b (shots 1/61/121, kill 124), so body blocking did not
  perturb the baseline scenario.

### row 41 — the dispatcher's own verification (248daac)

- Integrated gate 78/78, exit 0.
- **Arms:** rebuild-every-frame → RED on the revision-gate pin; aim-yaw-unclamped →
  RED on the ±60° turret pin; hull-wider-than-body (2.0 → 3.4 m) → RED on the hull-fit
  pin. Tree restored to `40379ca2` after each.
- **Look, re-measured by me:** all four poses PASS, including the new tile gate
  (p90 6.7–10.2 % vs 12 %). The tile proof is real: the writer's white injection measured
  255 L / 100 % and made `look-budget.py` exit 1.
- **Visual verdict:** playable is real — sim-driven tanks, shells, damage, a win state.
  The arena, however, is an **empty hall** with no cover or lanes, which is why the
  authored arena (A4) precedes the AI. The placeholder HUD labels are clipped at the frame
  edge; that is A5's problem, recorded here so it is not lost.

### row 43 — the dispatcher's own verification (5e04e9e)

- Integrated gate 85/85, exit 0.
- **Arms:** symmetry-180 → RED on the 90° invariance pin (and 6 downstream, because the
  demo scenario depends on the layout); gateways-closed → RED on the demo, **but the
  connectivity pin stayed green**; low-cover-reclassified (1.5 → 0.5 m) → **GREEN**.
- **Findings handed to B1a:** the validator proves spawn-to-spawn connectivity only, so a
  level whose *centre* is sealed still loads — add centre reachability; and the low-cover
  classification needs a pin (a 1.2 m barrier is low, a 4.8 m wall is not), otherwise the
  plan and mesh can mislead about what you can shoot over.
- **Layout:** judged from `top.png` — screened corner spawns with dogleg exits, two rings
  with corner gateways, breakable centre, staged low cover, 4-fold symmetry. The top plan
  caught two spawns facing each other down a margin before it was visible in 3D.

### row 45 — the dispatcher's own verification (303efb4)

- Integrated gate 98/98, exit 0.
- **Arms:** LOS always true → RED on the cover pin and the memory pin; path cache
  ignoring `world.revision` → RED on route invalidation plus the cache pin; decision
  cadence 6 → 1 → RED on the held-command pin. Tree restored to `a3a6161d` each time.
- **Batch, my own run** (100 matches, ~1.7 s): win split **85/15 team 0**, median **306
  ticks**, accuracy **89.4 %**, 0 draws, 0 cap hits, all deaths by shell.
- **Watched** (`reports/trace-seed-0.jsonl` rendered as frames): the tanks close to about
  14 m, stop, and trade shots. No repositioning, no use of cover, no dodging — static
  contact. Recorded as the third defect alongside fairness and length.

### row 47 — the dispatcher's own verification (a1d308d)

- Integrated gate 99/99, exit 0.
- **My 200-seed batch:** 99/101 split, median 934 ticks, 52.0 % accuracy, 0 cap hits,
  113 shell / 87 clock deaths, mean speed 2.24 m/s — targets met, reproduced independently.
- **A VOID arm that corrected the record:** reinstating `tank.id * 3` for the decision
  phase left the split at 48/52, because for 1v1 `id*3 ≡ team*3 (mod 6)`. So the phase
  formula did not cause the 85/15; the unfair adjacent-spawn pairing did. The arm is
  recorded as VOID (it could not test what it was aimed at) and the cause is corrected in
  the ledger.
- **Owed and now paid in B1c:** the staging-symmetry pin (`src/game/aiBatch.test.ts`);
  B1b's fairness fix previously rested only on the 200-seed measurement.
- **New debt:** the AI's 285-tick fire interval is AI-only while the global reload stays
  60 ticks, so the player would fire ~4.75× faster. One rule before player-vs-AI ships.
