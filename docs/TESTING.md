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
| Surface albedo stays inside §9's 2–10% band | `surface albedos sit inside §9’s 2–10 % linear-luminance band` | `src/render/config.test.ts` | restore the A2 fill (`#060e13`, 0.4%) or brighten above 10% → red |
| A fill cannot depth-reject its coincident edge lines | `the fill is polygon-offset so a coincident edge line cannot be depth-rejected (D1)` | `src/render/neonSurface.test.ts` | remove `polygonOffset` from the fill material → the pin reds (and the old dotted screenshots return) |
| Every hole is a black void quad, not a grid quad | `every hole cell is a void quad, and every intact cell is a grid quad` | `src/render/gridFloor.test.ts` | drop the `aVoid` attribute (or write 0) → the void-vertex count reds |
| The showcase stays inside the GPU-independent budget | `the showcase scene stays inside the pinned draw-object, triangle and vertex budget` | `src/render/sceneBudget.test.ts` | add one tank/one extra surface, or unmerge a world surface → objects/triangles/vertices exceed the 20% headroom |

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
