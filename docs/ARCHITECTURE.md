# Architecture — the seam index

## 1 · Layer map

Dependencies point **downward only**; nothing below a layer may import from above it.

| Layer | Lives in | Owns |
| --- | --- | --- |
| **entry** | `src/main.ts` | The frame loop, renderer/composer sizing, the WebGL renderer and post pipeline, and the wiring of the error surface. The only file that calls `requestAnimationFrame`. |
| **entry · DOM** | `src/entry/dom.ts` | The one way to obtain a DOM node the app cannot run without, with the narrowed type. |
| **core** | `src/core/*.ts` | Pure simulation: no DOM, no time source, no globals. Takes numbers in, returns numbers out, so it tests in `node`. |
| **core · world** | `src/core/world/*.ts`, entrance `src/core/world.ts` | The world model: cells with height, destruction, two debris tiers, slow regeneration with displacement, and the state hash. Pure data and functions — it has **no tank, shell or AI concept**; tanks arrive as occupant positions and shells as damage calls. |
| **render · tuning** | `src/render/config.ts` | The ONE tuning module: palette, HDR gains, bloom, post, camera distances, grid size, `SURFACE_DETAIL`. Every render constant lives here; a source scan fails on a hex colour anywhere else. |
| **render · surface** | `src/render/neonSurface.ts` | The ONE material seam: dark fill + emissive edge lines + faint fresnel rim + an (unused in A2) detail-map slot, merged so a whole world is one fill/rim/line buffer. One global `setSurfaceDetail`. |
| **render · world** | `src/render/worldMesh.ts`, `gridFloor.ts`, `demoWorld.ts` | Meshes the REAL A1 cells, owns the one rebuild path for destruction, and draws the shader grid floor. The placeholder arena is A2's; A4 owns the authored level. Big blocks and shards are A3 VFX. |
| **render · camera** | `src/render/cameraMath.ts` (pure), `cameraRig.ts` (three), `placeholderTank.ts` | Camera poses, zoom clamp and first-person boundary as pure node-tested maths; the `three` spring and camera object; the A2-only tank placeholder. |
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
| reporting a failure to the player | `reportError(cause)` | `src/main.ts:42` | The app's ONE error surface: visible banner + console. New failure paths call this; they never log alone and never swallow. |
| the renderer, canvas and composer size | `resize()` | `src/main.ts:197` | Owns the DPR cap, renderer size, camera aspect and composer/bloom sizing. Nothing else may set `canvas.width`/`height` or the camera aspect. |
| the frame loop | `frame()` → `requestAnimationFrame` | `src/main.ts:234` | One `requestAnimationFrame` chain in the app (`src/main.ts:275` continues it, `src/main.ts:321` starts it). A second chain is a bug, not an optimisation. |
| a render colour, bloom number, camera distance or grid size | `PALETTE` · `NEON` · `BLOOM` · `POST` · `CAMERA` · `GRID` · `SURFACE_DETAIL` | `src/render/config.ts:20` | The ONE tuning module. A source scan (`src/render/purity.test.ts`) fails on a hex colour outside it — nothing else hardcodes a colour or a bloom number. |
| a neon surface | `createNeonSurface(parts, options)` | `src/render/neonSurface.ts:257` | Takes ownership of the part geometries, merges all fills into ONE `BufferGeometry` (shared by the fill and the rim) and all edges into ONE `LineSegments`; hole rims ride the same line buffer. |
| moving the global surface detail | `setSurfaceDetail(0…1)` · `getSurfaceDetail()` | `src/render/neonSurface.ts:178` | The ONLY knob for `SURFACE_DETAIL`; it scales the rim and the detail-map slot, never the edges. `L` toggles 0 ↔ the configured default. |
| the world's mesh | `createWorldMesh(world)` · `rebuild()` | `src/render/worldMesh.ts:44` | Reads cells through `cellAt`/`cellState`/`isSolidAt`; `rebuild()` is the ONE path A3 calls after destruction or regeneration. Never patch the merged buffers in place. |
| the floor grid | `createGridFloor(world)` · `update(cameraPosition)` | `src/render/gridFloor.ts:91` | One shader mesh over the intact floor cells; holes are omitted quads (the void shows) and their rims come from `worldMesh`. Two distance-falloff ranges, fine lines then major lanes. |
| a deterministic camera pose | `cameraPose(request)` | `src/render/cameraMath.ts:161` | The three screenshot poses (`wide`, `tank`, `first`); the same request reproduces the same position and target (pinned). |
| orbit → camera pose | `orbitPose(input)` | `src/render/cameraMath.ts:97` | Behind-a-forward-vector orbit; as the arm collapses into first person the target slides forward, with zero look-ahead at the boundary. |
| the zoom clamp and the first-person boundary | `zoomDistance` · `clampDistance` · `isFirstPerson` | `src/render/cameraMath.ts:58` | One clamp (0.55…16 m) and an exclusive 2 m first-person boundary (below it the hull hides); malformed numbers throw. |
| the camera object and spring | `new CameraRig(...)` · `.update(dt)` | `src/render/cameraRig.ts:50` | The only place a `PerspectiveCamera` is posed. A selected screenshot pose freezes the rig. |
| a placeholder tank | `createPlaceholderTank(teamIndex, phase)` | `src/render/placeholderTank.ts:46` | A2-only, not a game entity: two `NeonSurface` calls (hull, turret+barrel) = six draw calls per tank. |
| the placeholder arena | `createShowcaseScene()` | `src/render/demoWorld.ts:52` | Real `createWorld` + `damageCell` data; A4 replaces it with the authored level. |
| the post pipeline | `new EffectComposer` … `OutputPass` | `src/main.ts:176` | RenderPass → UnrealBloom → vignette → OutputPass; ACES Filmic + sRGB. `renderer.info.autoReset = false` so the readout counts the whole composed frame. |
| the screenshot | `scripts/shot.sh` | `scripts/shot.sh:1` | Build, serve `dist`, headless Chrome, then kill the server AND the Chrome process group in a `trap`; a SwiftShader retry only when the first frame is not a rendered image. |
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
- **Merged buffers are a snapshot, not live geometry.** `WorldMesh.rebuild()` re-reads
  every cell and rebuilds the fill, rim and ONE edge buffer (hole rims included); the
  fill and rim share one uploaded `BufferGeometry`. A3 must call `rebuild()` after a
  breach or a regeneration instead of mutating merged geometry in place. Disposing a
  surface frees its merged geometries, never the shared materials.
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
  reports `swrast`, and Vulkan exposes only `llvmpipe`. The measured 3.7–3.8 fps at
  1920×1080 is a software-rasterizer floor, not a code regression; 60 fps cannot be
  claimed or disproved here.
- **The floor grid and the hole rims are derived from the same cell query.** The grid
  omits a quad when `isSolidAt` says the slab is gone, and `worldMesh` draws that cell's
  boundary as a hole rim merged into the world's ONE edge buffer. If they disagree, the
  world query is the authority: rebuild, never patch.
- **`SURFACE_DETAIL` is one module-global scalar.** It scales the fresnel rim and the
  reserved detail-map slot on the shared material; it never touches the edge lines or
  bloom. The detail slot is deliberately empty in A2 — a future texture must come through
  §9's image-map budget (tileable greyscale, ≤ 512², ≤ 15 %), not be loaded in a scene
  module.
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

- **No playable game yet.** Slice A2 now draws the A1 world, 16 placeholder tanks and
  the follow camera over a real bloom pipeline, but there is no drive/aim/fire, no
  shells, no debris VFX, no damage clock and no HUD. A3 owns that, and A4 owns the
  authored level that replaces `src/render/demoWorld.ts` (`docs/DESIGN.md` §8; ledger
  row 30).
- **The 60 fps target is unverified on this host.** The only WebGL backend is
  SwiftShader (no accessible DRM device; see the gotcha above). The measured 3.7–3.8
  fps at 1920×1080 with 16 tanks is a lower bound from software rasterisation. A
  hardware measurement needs a machine with a reachable GPU.
- **No publish script.** Publishing is deliberate once there is something to play
  (board row 2); `TANK_BATTLE_BASE` already carries the subpath for it.
- **No real-browser pin.** The suite runs in `node` against pure modules; the merged
  world and the surface seam are node-testable because they are geometry, and the look
  is verified by the committed `scripts/shot.sh` plus human/agent inspection of the
  PNGs. A browser *test* would mean owning a headless-browser process tree and
  asserting pixels; that is still not worth its cost (see [`TESTING.md`](TESTING.md)).
- **The debug readout and the showcase arena are placeholders.** They are review
  affordances for A2, not product surfaces; A5 replaces the readout with the real HUD
  and A4 replaces the arena.
