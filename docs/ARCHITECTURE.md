# Architecture — the seam index

## 1 · Layer map

Dependencies point **downward only**; nothing below a layer may import from above it.

| Layer | Lives in | Owns |
| --- | --- | --- |
| **entry** | `src/main.ts` | The frame loop, renderer/composer sizing, the WebGL renderer and post pipeline, and the wiring of the error surface. The only file that calls `requestAnimationFrame`. |
| **entry · DOM** | `src/entry/dom.ts` | The one way to obtain a DOM node the app cannot run without, with the narrowed type. |
| **core** | `src/core/*.ts` | Pure simulation: no DOM, no time source, no globals. Takes numbers in, returns numbers out, so it tests in `node`. |
| **core · world** | `src/core/world/*.ts`, entrance `src/core/world.ts` | The world model: cells with height, destruction, two debris tiers, slow regeneration with displacement, and the state hash. Pure data and functions — it has **no tank, shell or AI concept**; tanks arrive as occupant positions and shells as damage calls. |
| **render · tuning** | `src/render/config.ts` | The ONE tuning module: palette, team-luma gains, HDR gains, §9 albedo band, neutral rim tint, bloom, post, fog, camera distances, grid size, surface seams, scene budget, `SURFACE_DETAIL`. Every render constant lives here; a source scan fails on a hex colour anywhere else. |
| **render · surface** | `src/render/neonSurface.ts` | The ONE material seam: near-neutral dark fill + emissive team/structure edge lines + a NEUTRAL fresnel/wall-sheen/top-band rim + procedural panel seams + an (unused) detail-map slot, merged so a whole world is one fill/rim/line buffer. The fill is polygon-offset; one global `setSurfaceDetail`. |
| **render · world** | `src/render/worldMesh.ts`, `gridFloor.ts`, `demoWorld.ts` | Meshes the REAL A1 cells, owns the one rebuild path for destruction, and draws the shader grid floor with black void quads for holes. The placeholder arena/perimeter is A2's; A4 owns the authored level. Big blocks and shards are A3 VFX. |
| **render · assembly** | `src/render/sceneAssembly.ts`, `sceneStats.ts`, `gateways.ts` | Builds the EXACT showcase the app renders (world + 16 tanks + merged gateway arches), exposes its scene-build stats, and keeps the presentation-only gateways out of the world model. |
| **render · camera** | `src/render/cameraMath.ts` (pure), `cameraRig.ts` (three), `placeholderTank.ts` | Camera poses, zoom clamp and first-person boundary as pure node-tested maths; the `three` spring and camera object; the A2-only tank placeholder with a real gun/turret silhouette. |
| **app shell** | `index.html`, `vite.config.ts`, `tsconfig.json` | The mount point, the build, the base path. |

A file in `src/core/` that imports `main.ts`, touches `document`, or reads
`performance.now()` itself is a layer violation: pass the value in. So is importing
`three` from anywhere outside `src/render/`, `src/main.ts` and `src/entry/` — a source
scan in `src/render/purity.test.ts` fails the suite on it, because the core must keep
running headless in `node`.

## 2 · The one way to do X

| Seam | The ONE way | Where | Notes |
| --- | --- | --- | --- |
| frame time → simulation steps | `FixedStep.advance(frameSeconds, onStep)` | `src/core/timestep.ts:58` | The only place a frame delta becomes steps. Never step by the raw delta, and never keep a second accumulator. The `maxFrame` clamp is the anti-spiral rule; `STEP_TOLERANCE` (`src/core/timestep.ts:34`) is the float-drift rule. |
| a required DOM node, typed | `requireElement(id, kind, label)` | `src/entry/dom.ts:20` | Returns the narrowed type, so callers need no guard. Every use of `document.getElementById` goes through it. |
| reporting a failure to the player | `reportError(cause)` | `src/main.ts:41` | The app's ONE error surface: visible banner + console. New failure paths call this; they never log alone and never swallow. |
| the renderer, canvas and composer size | `resize()` | `src/main.ts:189` | Owns the DPR cap, renderer size, camera aspect and composer/bloom sizing. Nothing else may set `canvas.width`/`height` or the camera aspect. |
| the frame loop | `frame()` → `requestAnimationFrame` | `src/main.ts:227` | One `requestAnimationFrame` chain in the app (`src/main.ts:269` continues it, `src/main.ts:316` starts it). A second chain is a bug, not an optimisation. |
| a render colour, albedo, bloom number, fog or camera distance | `PALETTE` · `NEON` · `TEAM_LUMA_GAIN` · `TEAM_RENDER_CORRECTION` · `SURFACE_LUMA_BAND` · `BLOOM` · `POST` · `FOG` · `CAMERA` · `GRID` · `SURFACE_DETAIL` | `src/render/config.ts:20` | The ONE tuning module. A source scan (`src/render/purity.test.ts`) fails on a hex colour outside it — nothing else hardcodes a colour or a bloom number. |
| a neon surface | `createNeonSurface(parts, options)` | `src/render/neonSurface.ts:311` | Takes ownership of the part geometries, merges all fills into ONE `BufferGeometry` (shared by the fill and the rim) and all edges into ONE `LineSegments`; hole rims ride the same line buffer. |
| moving the global surface detail | `setSurfaceDetail(0…1)` · `getSurfaceDetail()` | `src/render/neonSurface.ts:232` | The ONLY knob for `SURFACE_DETAIL`; it scales the rim, wall sheen, top band, panel seams and detail-map slot, never the edges. `L` toggles 0 ↔ the configured default. |
| the world's mesh | `createWorldMesh(world)` · `rebuild()` | `src/render/worldMesh.ts:44` | Reads cells through `cellAt`/`cellState`/`isSolidAt`; `rebuild()` is the ONE path A3 calls after destruction or regeneration. Never patch the merged buffers in place. |
| the floor grid and its voids | `createGridFloor(world)` · `update(cameraPosition)` | `src/render/gridFloor.ts:109` | One shader mesh over EVERY cell; an `aVoid` vertex flag makes a hole quad pure black and skips the grid (D6), while the rim comes from `worldMesh`. Two distance-falloff ranges; fog in the shader. |
| a deterministic camera pose | `cameraPose(request)` | `src/render/cameraMath.ts:161` | The three screenshot poses (`wide`, `tank`, `first`); the same request reproduces the same position and target (pinned). |
| orbit → camera pose | `orbitPose(input)` | `src/render/cameraMath.ts:97` | Behind-a-forward-vector orbit; as the arm collapses into first person the target slides forward, with zero look-ahead at the boundary. |
| the zoom clamp and the first-person boundary | `zoomDistance` · `clampDistance` · `isFirstPerson` | `src/render/cameraMath.ts:58` | One clamp (0.55…16 m) and an exclusive 2 m first-person boundary (below it the hull hides); malformed numbers throw. |
| the camera object and spring | `new CameraRig(...)` · `.update(dt)` | `src/render/cameraRig.ts:50` | The only place a `PerspectiveCamera` is posed. A selected screenshot pose freezes the rig. |
| a placeholder tank | `createPlaceholderTank(teamIndex, phase)` | `src/render/placeholderTank.ts:46` | A2-only, not a game entity: two `NeonSurface` calls (hull, turret+barrel) = six draw calls per tank. |
| the showcase world (perimeter, gates, holes, spawns) | `createShowcaseScene()` | `src/render/demoWorld.ts:72` | Real `createWorld` + `damageCell` data; the perimeter/gates are A2b presentation scaffolding, A4 replaces all of it. |
| building and measuring the rendered scene | `buildArenaScene()` · `measureScene(root)` | `src/render/sceneAssembly.ts:37` · `src/render/sceneStats.ts:25` | ONE assembly shared by the app and the GPU-independent budget pin; measures draw objects, triangles and vertices in `node`. |
| the four team hues' rendered luminance | `rec709Luminance(hex)` · `teamEdgeGainFor(index)` | `src/render/config.ts:103` · `src/render/config.ts:143` | The hue stays the owner's; the linear Rec.709 gain is normalised (D5) with a small ACES render correction inside its ±10 % band. Never apply a raw team colour to an edge. |
| the §9 surface albedo band | `srgbLuma(hex)` · `SURFACE_LUMA_BAND` | `src/render/config.ts:116` · `src/render/config.ts:95` | The band is measured on sRGB ITU-R 601 L, the SAME L as `scripts/look-budget.py`; this is a different measure from the D5 linear team luma. |
| the GPU-independent scene budget | `SCENE_BUDGET` | `src/render/config.ts:309` | 20 % headroom over the measured showcase (103 objects / 13,344 tri / 39,232 verts): 124 / 16,100 / 47,100, with an absolute 200 draw-object ceiling. |
| the gateway arches | `createGatewayArches(gates)` | `src/render/gateways.ts:45` | Presentation-only merged surface for the four entries; the world owns the floor gap, A4 will own collision. |
| the post pipeline | `new EffectComposer` … `OutputPass` | `src/main.ts:168` | RenderPass → UnrealBloom → vignette → OutputPass; ACES Filmic + sRGB. `renderer.info.autoReset = false` so the readout counts the whole composed frame. |
| distance fog on every renderer | `scene.fog` plus the ShaderMaterials' `uFogNear/uFogFar` | `src/main.ts:142` · `src/render/config.ts:212` | Standard fill/edge materials take scene fog automatically; the rim and grid ShaderMaterials carry the same range in their uniforms. A new ShaderMaterial must do the same or it will visibly not fade. |
| the measured look budget | `python3 scripts/look-budget.py <png> [--json]` | `scripts/look-budget.py:1` | The ONE pixel measurement of §9: surface median ≤22 L, frame share 26–51 ≤25 %, line p99 ≥150, contrast ≥6; `shot.sh` runs it after every capture and exits non-zero on a FAIL. Void is INFO (no threshold was specified); team hulls are SKIP (the hull fill is neutral/shared). |
| the screenshot | `scripts/shot.sh` | `scripts/shot.sh:1` | Build, serve `dist`, headless Chrome, then kill the server AND the Chrome process group in a `trap`; a SwiftShader retry only when the first frame is not a rendered image. The look budget runs on the final capture and a FAIL makes the command exit 1. |
| seeded randomness in the simulation | `createRng(seed)` | `src/core/rng.ts:35` | The ONLY draw source under `src/core`: integer-only mulberry32, so a seed reproduces its sequence on every engine. A source scan (`src/core/purity.test.ts`) fails the build on `Math.random`. |
| building the world | `createWorld(spec)` | `src/core/world/state.ts:97` | Validates the spec loudly (integer dimensions, a height above the floor plane, no double placement) and builds the row-major grid. Level data fills the same shape. |
| addressing a cell | `cellAt(world, x, z)` | `src/core/world/state.ts:178` | The ONE integer + bounds check (`cellIndex`, `src/core/world/state.ts:167`). Never index `world.cells` directly. |
| is there material at a height | `isSolidAt(world, x, z, metres)` | `src/core/world/state.ts:208` | Height-aware by construction: below a big block's top, or an intact cell's top; nothing at all over a hole. This is what stops a low wall from blocking a high shot. |
| can a tank stand in a cell | `isCellPassable(world, x, z)` | `src/core/world/state.ts:229` | The ONE definition of "free", used by displacement and shard shoves. A DIFFERENT question from `isSolidAt`: an intact floor is solid at 0.1 m and still passable. |
| the drivable surface through a hole | `floorSurfaceHeightAt(world, x, z)` | `src/core/world/state.ts:193` | The floor plane, holes included — the contract that tanks stand on the bedrock and never fall. |
| a cell taking damage | `damageCell(world, x, z, amount, rng)` | `src/core/world/destruction.ts:40` | The ONE destruction path: clamps HP, restarts the regen clock, and on destruction spawns the material's debris from `MATERIAL_PROFILES`. A hole reports a no-op, never a silent hit. |
| rubble taking damage | `damageBlock(world, x, z, amount)` | `src/core/world/destruction.ts:71` | A big block clears only through this; the cell's frozen regeneration resumes when the block is gone. |
| what a destroyed cell yields | `spawnDebris(world, cell, rng)` | `src/core/world/debris.ts:95` | Internal to the world package. The material profile is the only switch, and the shard cap is applied here. |
| a shard's mirror | `shardDeflection(shard, direction)` | `src/core/world/debris.ts:145` | The only reflection geometry: `d - 2(d·n)n` with a stored normal from a 16-entry **literal** table (no trigonometry, so every engine sees the identical double). |
| a shell hit on a shard | `shatterShard(world, shardId)` | `src/core/world/debris.ts:162` | One shard, one hit, gone. |
| shoving a shard | `shoveShard(world, shardId, direction)` | `src/core/world/debris.ts:181` | One cell along the shove, else a fixed side order, else it stays (`moved: false`). Never through material. |
| advancing the world | `stepWorld(world, ticks, occupants)` | `src/core/world/regeneration.ts:63` | The tick loop: heals one frame per delay, absorbs shards, and displaces occupants by a fixed-order nearest-free search. Returns `Displacement[]`; the CALLER applies them, and the world never writes to the caller's occupants. |
| iterating debris | `listBlocks(world)` / `listShards(world)` | `src/core/world/state.ts:246` | Blocks in a stable cell order, shards oldest first; `blockAt` / `shardAt` for one cell. |
| a run's identity | `hashState(world)` | `src/core/world/hash.ts:17` | FNV-1a over canonical state text (ids, HP, timers, mirror angles, tick) — the pin that proves two identical runs stayed identical. |
| the world's numbers | `MATERIAL_PROFILES` · `SHARD_CAP` · `secondsToTicks` | `src/core/world/constants.ts:38` | The ONE tuning module. `secondsToTicks` (`src/core/world/constants.ts:71`) is the only seconds→ticks conversion, and a tick IS `STEP_SECONDS`. |
| the world's public surface | `src/core/world.ts` | `src/core/world.ts:1` | The ONE entrance: the model's doc, its types and its seams, re-exported. Callers outside the world package import from here, never from `world/*.ts`. |

## 3 · Gotchas

- **TypeScript narrowing does NOT survive into a nested function body.** A module-level
  `if (!(el instanceof X)) throw` narrows `el` for the rest of the module, but a
  `function f() { el.width }` still sees the wide type (`error TS18047`). That is why
  `src/entry/dom.ts` exists: an explicit return type narrows the *value* instead of a
  control-flow path. Do not "fix" a TS18047 by adding `!` at each use.
- **`FixedStep` compares with a 1e-9 tolerance on purpose.** Without it, a 0.25 s frame
  owed 25 slices of 10 ms and produced 24 (measured red in the suite) — the clock runs
  slow at some rates only. It is a numeric tolerance, not a swallowed error: malformed
  input still throws.
- **The clamp slows the simulation instead of catching up.** After a tab switch the
  game resumes where it was left. A death spiral is worse than lost wall-clock time.
- **`alpha` is for rendering interpolation only.** It is not simulation state; do not
  store game state in it.
- **The arena, the tanks and the debug readout are A2 placeholders, not the product.**
  `demoWorld.ts` is a hand-authored showcase (A4 owns the authored level), the tank is
  not a game entity (A3 owns drive/aim/fire), and the `#debug` readout is a development
  affordance, not the §9 HUD (A5). Do not scope work from them.
- **`LineBasicMaterial.linewidth` is ignored on almost every WebGL platform.** The
  spec permits only 1 px lines and ANGLE follows it, so the look is 1 px lines plus
  `UnrealBloomPass` for the glow. Do not "fix" this with a screen-space line-width
  shader in A2 — that is a different material system, not a tuning change.
- **Coincident edge lines lose a depth test against their fill: that was D1.** The
  `EdgesGeometry` lines sit exactly on the fill's triangle boundaries, so the line's
  rasterized depth differs from the triangle's by a few ULPs and `LessEqualDepth`
  rejects it in a periodic DOT pattern. It is not `LineDashedMaterial`, not missing
  edge segments, and not the bloom threshold. The ONE fix is `polygonOffset` on the
  fill (positive factor/units, pushing it AWAY), set in `neonSurface.ts` and pinned in
  `neonSurface.test.ts`. Do not turn depth-test off, offset line vertices, or draw a
  second line to "fill" the dots.
- **Merged buffers are a snapshot, not live geometry.** `WorldMesh.rebuild()` re-reads
  every cell and rebuilds the fill, rim and ONE edge buffer (hole rims, vertical
  accents, panel/hole line batches included); the fill and rim share one uploaded
  `BufferGeometry`. A3 must call `rebuild()` after a breach or a regeneration instead
  of mutating merged geometry in place. Disposing a surface frees its merged
  geometries, never the shared materials.
- **The fill albedo is a §9 BUDGET and the rim is the volume cue.** A2c measures the
  band on **sRGB ITU-R 601 L**, the same L as `scripts/look-budget.py`: `surfaceFill`
  5.8 %, `surfaceFillTop` 8.8 %, `gridSurface` 6.1 %. A2b's 15 % fill was the failure;
  do not return to it. The wall gets volume from a NEUTRAL vertical sheen, a small
  top-face band and procedural panel seams, all scaled by `SURFACE_DETAIL`; hue lives
  in the edge lines and small lights only. Do not brighten the albedo to make a wall
  read — raise the neutral rim, or add lines. The band is pinned in `config.test.ts`
  with `srgbLuma`, not the linear Rec.709 measure used for D5.
- **D5 normalises the GAIN, not the owner's hues.** `teamEdgeGainFor(teamIndex)` is the
  only correct way to turn a team into an edge identity: it applies the per-team
  correction that equalises Rec.709 luminance (pinned), plus a documented 9 % lime
  render correction inside the pin's ±10 % allowance for ACES/clipping. Using
  `NEON.teamEdgeGain` directly, or a raw `PALETTE.team` colour, re-introduces the lime
  advantage. Team hull SURFACES are neutral and shared; the team hue is in trim lines
  and small lights, as A2c requires.
- **The §9 look budget is a SCRIPT, not a vitest pin.** `python3 scripts/look-budget.py
  <png>` measures sRGB ITU-R 601 L, and `scripts/shot.sh` runs it after the final
  capture; a FAIL makes the screenshot command exit 1. It gates surface median ≤22,
  frame share in L 26–51 ≤25 %, line p99 ≥150 and contrast ≥6. Void is INFO because the
  brief gives no void threshold. Team hulls are SKIP: A2c's hull fill is neutral and
  shared, so saturation segmentation measures trim, not hull surface; the trim line is
  diagnostic only and is confounded by distance/coverage. Do not "fix" a failing
  surface by changing the L definition or the thresholds — that is the thing the
  budget exists to prevent.
- **Two luma measures exist on purpose.** `srgbLuma` (ITU-R 601 on sRGB bytes) is the
  §9/look-budget measure; `rec709Luminance` (linear light, Rec.709 weights) is the D5
  team-gain normalisation. They answer different questions; do not substitute one for
  the other. A2b's surface pin used the wrong one and was corrected in A2c.
- **A hole is a black void quad, not an omitted quad.** `gridFloor` now carries an
  `aVoid` vertex attribute per cell; the shader returns `PALETTE.void` (pure black) and
  skips the grid. `worldMesh` adds a bright outer rim and a second inset loop. If a
  hole shows grid lines, the void flag or the cell query is wrong — do not hide it
  behind a brighter rim. The data is pinned in `gridFloor.test.ts`.
- **`renderer.info.render.calls` counts the whole frame only with `autoReset = false`.**
  `EffectComposer` calls `renderer.render` once per pass, so with the default auto-reset
  the readout would show only the last pass. `src/main.ts` resets the info once per
  frame and reads it after `composer.render()`.
- **The on-screen fps in a screenshot is VIRTUAL.** `--virtual-time-budget` fast-forwards
  the page clock, so the screenshot counter reads 4–5 fps regardless of cost. Real fps
  is measured in Chrome without virtual time (and reports its renderer string); never
  quote a screenshot's counter as a performance measurement.
- **This host has no reachable hardware GPU.** Chrome reports ANGLE/SwiftShader,
  `/dev/dri/renderD128` is `root:render` and the user is not in that group, `eglinfo`
  reports `swrast`, and Vulkan exposes only `llvmpipe`. The measured A2b 3.58–3.75 fps
  at 1920×1080 is a software-rasterizer floor, not a code regression; the DoD's 60 fps
  is pending an owner GPU measurement, and the budget pin is the gate here.
- **The floor grid and the hole rims are derived from the same cell query.** The grid
  marks a cell void when `isSolidAt` says the slab is gone, and `worldMesh` draws that
  cell's boundary as a double rim merged into the world's ONE edge buffer. If they
  disagree, the world query is the authority: rebuild, never patch.
- **The gateway arches are PRESENTATION-ONLY.** `demoWorld` leaves floor in the four
  gate gaps; `gateways.ts` adds the arch geometry outside the world model. A4 owns the
  final level and must decide the collision/threshold story; do not read gameplay
  bounds from the arches.
- **The scene budget is the performance gate on this host.** `buildArenaScene()` is the
  one assembly the app and `sceneBudget.test.ts` share, so the budget cannot measure a
  scene different from the rendered one. The pin is 20 % over measured
  (103 objects / 13,344 triangles / 39,232 vertices) with an absolute 200 draw-object
  ceiling; the SwiftShader fps floor (≥ 3.0) is a regression signal, not the target.
  Adding a tank or unmerging a surface must raise the budget deliberately, not drift.
- **`SURFACE_DETAIL` is one module-global scalar.** It scales the fresnel rim, wall
  sheen, top band, procedural seams and the reserved detail-map slot on the shared
  material; it never touches the edge lines or bloom. The detail slot is deliberately
  empty — a future texture must come through §9's image-map budget (tileable greyscale,
  ≤ 512², ≤ 15 %), not be loaded in a scene module. The 0-vs-default pair is the
  control: zero leaves albedo + edge lines; the default adds richness, never dominance.
- **The interactive camera and the screenshot poses are two different things.** The
  follow arm stays dead astern; `cameraPose('tank')` is a frozen over-the-shoulder 3/4
  framing for review. Do not use the pose offset as gameplay camera behaviour.
- **`isSolidAt` and `isCellPassable` are two questions, not two copies.** "Is there material at
  this height?" (shells) and "can a ground unit stand here?" (tanks, shoves) are answered
  differently for the same cell: an intact floor slab is solid at 0.1 m and passable. A pin
  holds both, and every "is this cell free?" caller goes through `isCellPassable`.
- **A hole is derived, never stored as a material.** `cell.hp === 0` IS the hole
  (`cellState`), and `cell.material` stays what the cell is built as so regeneration knows
  what to restore. A fourth `'hole'` value would be a second source of truth for solidity.
- **A big block FREEZES its cell's regeneration timer**; it does not restart it. "Blocks that
  cell's regeneration until the block is destroyed" is read literally: no progress while the
  rubble stands, and the remaining ticks (for a fresh breach, the full delay) resume when it
  is shot clear.
- **Displacement expands breadth-first THROUGH occupied cells; only the destination must be
  free.** The fixed neighbour order (`+x, -x, +z, -z`) and the occupant id order are the
  tie-breaks. If no free passable cell is reachable the world throws: a level that traps every
  tank is a level-authoring failure, not a game state to absorb silently.
- **The mirror normals are literals on purpose.** Replacing the 16-entry table with
  `Math.cos`/`Math.sin` would reintroduce engine-dependent last-bit differences in the
  reflection — exactly the determinism the project needs. Do not "simplify" it.
- **The purity scan skips documentation-only lines.** A comment cannot import a renderer,
  touch a global or draw a number, so the scan reads code lines; a violation on a line that
  carries any code still fails, and the scan asserts how many modules it found so an empty
  glob cannot pass as clean.

## 4 · Known debt

- **No playable game yet.** Slices A2/A2b/A2c draw the A1 world, 16 placeholder tanks
  and the follow camera over a real bloom pipeline with a measured §9 surface budget,
  but there is no drive/aim/fire, no shells, no debris VFX, no damage clock and no HUD.
  A3 owns that, and A4 owns the authored level that replaces `src/render/demoWorld.ts`
  and the presentation-only gateways (`docs/DESIGN.md` §8; ledger row 35).
- **The 60 fps target is pending an owner GPU measurement.** The only WebGL backend on
  this host is SwiftShader (no accessible DRM device; see above). The measured
  3.64–3.87 fps at 1920×1080 with 16 tanks is a lower bound from software
  rasterisation; the scene budget and the look budget are the GPU-independent gates in
  the meantime.
- **Team hull segmentation is not measured.** A2c deliberately made hull surfaces
  neutral/shared, so a cheap saturation mask measures trim, not hull. The hull-surface
  band is held by the shared albedo + `srgbLuma` pin and manual patch checks; the trim
  diagnostic is not gated.
- **No publish script.** Publishing is deliberate once there is something to play
  (board row 2); `TANK_BATTLE_BASE` already carries the subpath for it.
- **No real-browser *test*; the look budget is a screenshot script.** The suite runs in
  `node` against pure modules; `scripts/shot.sh` owns the headless-browser process
  tree and runs `scripts/look-budget.py` on the PNG, but that is a measurement command,
  not a Vitest pin. Making it a browser test would mean threading the Chrome lifecycle
  and image fixtures through the suite; the script is the deliberate cheaper gate (see
  [`TESTING.md`](TESTING.md)).
- **The debug readout, the showcase arena and the gateway arches are placeholders.**
  They are review affordances for A2/A2b/A2c, not product surfaces; A5 replaces the
  readout with the real HUD and A4 replaces the arena and owns the final architecture.
