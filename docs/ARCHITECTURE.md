# Architecture — the seam index

## 1 · Layer map

Dependencies point **downward only**; nothing below a layer may import from above it.

| Layer | Lives in | Owns |
| --- | --- | --- |
| **entry** | `src/main.ts` | The frame loop, canvas sizing, and the wiring of the error surface. The only file that calls `requestAnimationFrame`. |
| **entry · DOM** | `src/entry/dom.ts` | The one way to obtain a DOM node the app cannot run without, with the narrowed type. |
| **core** | `src/core/*.ts` | Pure simulation: no DOM, no time source, no globals. Takes numbers in, returns numbers out, so it tests in `node`. |
| **core · world** | `src/core/world/*.ts`, entrance `src/core/world.ts` | The world model: cells with height, destruction, two debris tiers, slow regeneration with displacement, and the state hash. Pure data and functions — it has **no tank, shell or AI concept**; tanks arrive as occupant positions and shells as damage calls. |
| **app shell** | `index.html`, `vite.config.ts`, `tsconfig.json` | The mount point, the build, the base path. |

A file in `src/core/` that imports `main.ts`, touches `document`, or reads
`performance.now()` itself is a layer violation: pass the value in.

## 2 · The one way to do X

| Seam | The ONE way | Where | Notes |
| --- | --- | --- | --- |
| frame time → simulation steps | `FixedStep.advance(frameSeconds, onStep)` | `src/core/timestep.ts:58` | The only place a frame delta becomes steps. Never step by the raw delta, and never keep a second accumulator. The `maxFrame` clamp is the anti-spiral rule; `STEP_TOLERANCE` (`src/core/timestep.ts:34`) is the float-drift rule. |
| a required DOM node, typed | `requireElement(id, kind, label)` | `src/entry/dom.ts:20` | Returns the narrowed type, so callers need no guard. Every use of `document.getElementById` goes through it. |
| a 2D drawing context | `requireContext2d(canvas)` | `src/entry/dom.ts:33` | The only `getContext('2d')` call in the app. |
| reporting a failure to the player | `reportError(cause)` | `src/main.ts:18` | The app's ONE error surface: visible banner + console. New failure paths call this; they never log alone and never swallow. |
| the canvas element and its size | `resize()` | `src/main.ts:33` | Owns the DPR transform. Nothing else may set `canvas.width`/`height` or the transform. |
| the frame loop | `frame()` → `requestAnimationFrame` | `src/main.ts:80` | One `requestAnimationFrame` chain in the app (`src/main.ts:99` starts it). A second chain is a bug, not an optimisation. |
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
- **The grid and the title are placeholder art.** Day-1 skeleton — there is no
  gameplay in `src/main.ts` yet. Do not scope work from the visuals.
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

- **No playable game yet.** The skeleton proves the loop, the canvas, the error surface
  and the gate, and Slice A1 added the renderer-free world model in `src/core/world.ts` —
  but nothing draws the world and no tank exists. Slice A2 owns the three.js scene over
  this data and the wiring into `src/main.ts`; A3 owns drive/aim/fire (ledger row 26;
  `docs/DESIGN.md` §8).
- **No publish script.** Publishing is deliberate once there is something to play
  (board row 2); `TANK_BATTLE_BASE` already carries the subpath for it.
- **No real-browser pin.** The suite runs in `node` against pure modules. A browser
  test means owning a headless-browser process *tree* (see [`TESTING.md`](TESTING.md));
  add it when a behaviour can only be proved in a browser.
