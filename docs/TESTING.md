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

The final 20 rows are the A3a combat pins. They are direct node assertions; **no mutation differential was run for A3a**, so the "how red" text names the one-line change that would red each pin, not an executed arm. The first sim test run was red in five places and the first typecheck was red; those were test-scaffold/scenario corrections (see `### row 37`), not pin evidence.

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
