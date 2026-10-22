# Architecture — the seam index

## 1 · Layer map

Dependencies point **downward only**; nothing below a layer may import from above it.

| Layer | Lives in | Owns |
| --- | --- | --- |
| **entry** | `src/main.ts` | The frame loop, renderer/composer sizing, the WebGL renderer and post pipeline, and the wiring of the error surface. The only file that calls `requestAnimationFrame`. |
| **entry · DOM** | `src/entry/dom.ts` | The one way to obtain a DOM node the app cannot run without, with the narrowed type. |
| **core** | `src/core/*.ts` | Pure simulation: no DOM, no time source, no globals. Takes numbers in, returns numbers out, so it tests in `node`. |
| **core · sim** | `src/core/sim/*.ts`, entrance `src/core/sim.ts` | The combat layer over A1: builds a match from teams/spawns, validates commands, advances one fixed tick (drive with tank bodies, turret/pitch, world, bleed, swept-muzzle fire, shells), resolves 3D shell collisions, owns last-team/tick-cap outcomes and stats, and exposes the `Controller` seam and the match hash. **No renderer, DOM, input, AI, host clock or per-tank `isPlayer`.** |
| **core · ai** | `src/core/ai/*.ts`, entrance `src/core/ai.ts` | Perception (height-aware 3D sightline + last-seen memory), A* navigation with a `world.revision`/goal cache and body-clear smoothing, four eagerly validated character profiles (vanguard, sniper, ambusher, brute), the 10 Hz `AIController`, the pure headless 1v1 and team batch runners, and the spectator session/director. Renderer-free, DOM-free and clock-free; it uses only world and sim APIs. **No live spectator, HUD or game-layer import.** |
| **game** | `src/game/*.ts`, `src/game/levels/*.ts` | The app's pure game layer ABOVE the core: the authored `ARENA` data plus `validateLevel`, the pure pointer/keys→`TankCommand` mapping, browser event gathering, and the `PlayableSession` bridge (FixedStep + MatchState + interpolation + demo seeding). `input.ts`, `levels/format.ts`, `levels/arena.ts` and `session.ts` are renderer-free/clock-free and node-tested; `browserInput.ts` is the only DOM reader. |
| **core · world** | `src/core/world/*.ts`, entrance `src/core/world.ts` | The world model: cells with height, destruction, two debris tiers, slow regeneration with displacement, and the state hash. Pure data and functions — it has **no tank, shell or AI concept**; tanks arrive as occupant positions and shells as damage calls. |
| **render · tuning** | `src/render/config.ts` | The ONE tuning module: palette, team-luma gains, HDR gains, §9 albedo band, neutral rim tint, bloom, post, fog, camera distances, grid presentation, surface seams, scene budget, `SURFACE_DETAIL`; the shared cell size is imported from `src/core/world.ts`. Every render constant lives here; a source scan fails on a hex colour anywhere else. |
| **render · surface** | `src/render/neonSurface.ts` | The ONE material seam: near-neutral dark fill + emissive team/structure edge lines + a NEUTRAL fresnel/wall-sheen/top-band rim + procedural panel seams + an (unused) detail-map slot, merged so a whole world is one fill/rim/line buffer. The fill is polygon-offset; one global `setSurfaceDetail`. |
| **render · world** | `src/render/worldMesh.ts`, `gridFloor.ts`, `playableScene.ts`, `debrisView.ts`, `shellView.ts`, `topPlan.ts` | Meshes the REAL A1 cells, owns the one rebuild path for destruction, and draws the shader grid floor with black void quads for holes. `playableScene` builds the app scene from the match, rebuilds world+debris only on `world.revision`, and updates tanks/shells per frame. `topPlan` is the review-only orthographic overlay: spawn zones, exit arrows, dark wall/low/objective fills. The A2 `demoWorld` showcase remains a budget fixture, not a second app render path. |
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
| the world's mesh | `createWorldMesh(world)` · `rebuild()` | `src/render/worldMesh.ts:44` | Reads cells through `cellAt`/`cellState`/`isSolidAt`; `rebuild()` is the ONE path A3 calls after destruction or regeneration. Never patch the merged buffers in place. Low cover (height ≤ 1.5 m) gets `PALETTE.lowCoverEdge`, not the tall-wall hue. |
| the floor grid and its voids | `createGridFloor(world)` · `update(cameraPosition)` | `src/render/gridFloor.ts:109` | One shader mesh over EVERY cell; an `aVoid` vertex flag makes a hole quad pure black and skips the grid (D6), while the rim comes from `worldMesh`. Two distance-falloff ranges; fog in the shader. |
| a deterministic camera pose | `cameraPose(request)` | `src/render/cameraMath.ts:161` | The four perspective screenshot poses (`wide`, `tank`, `first`, `combat`); the same request reproduces the same position and target (pinned). `top` is a separate orthographic review camera, not a `cameraPose`. |
| orbit → camera pose | `orbitPose(input)` | `src/render/cameraMath.ts:97` | Behind-a-forward-vector orbit; as the arm collapses into first person the target slides forward, with zero look-ahead at the boundary. |
| the zoom clamp and the first-person boundary | `zoomDistance` · `clampDistance` · `isFirstPerson` | `src/render/cameraMath.ts:58` | One clamp (0.55…16 m) and an exclusive 2 m first-person boundary (below it the hull hides); malformed numbers throw. |
| the camera object and spring | `new CameraRig(...)` · `.update(dt)` | `src/render/cameraRig.ts:50` | The only place a `PerspectiveCamera` is posed. A selected screenshot pose freezes the rig. |
| a tank view | `createPlaceholderTank(teamIndex, phase)` · `setSimPose(...)` | `src/render/placeholderTank.ts:46` · `src/render/placeholderTank.ts:170` | The compact 2.0×2.6 m view; `setSimPose` applies hull yaw, relative turret yaw and pitch. Two `NeonSurface` calls (hull, turret+barrel) = six draw calls per tank. |
| the showcase world (perimeter, gates, holes, spawns) | `createShowcaseScene()` | `src/render/demoWorld.ts:72` | Real `createWorld` + `damageCell` data; retained only as the A2 budget fixture. The app loads `ARENA` through `validateLevel` and `createMatch`; there is no second app render path. |
| building and measuring the rendered scene | `buildArenaScene()` · `measureScene(root)` | `src/render/sceneAssembly.ts:37` · `src/render/sceneStats.ts:25` | ONE assembly shared by the app and the GPU-independent budget pin; measures draw objects, triangles and vertices in `node`. |
| the four team hues' rendered luminance | `rec709Luminance(hex)` · `teamEdgeGainFor(index)` | `src/render/config.ts:103` · `src/render/config.ts:143` | The hue stays the owner's; the linear Rec.709 gain is normalised (D5) with a small ACES render correction inside its ±10 % band. Never apply a raw team colour to an edge. |
| the §9 surface albedo band | `srgbLuma(hex)` · `SURFACE_LUMA_BAND` | `src/render/config.ts:116` · `src/render/config.ts:95` | The band is measured on sRGB ITU-R 601 L, the SAME L as `scripts/look-budget.py`; this is a different measure from the D5 linear team luma. |
| the GPU-independent scene budget | `SCENE_BUDGET` | `src/render/config.ts:309` | 20 % headroom over the measured showcase (103 objects / 13,344 tri / 39,232 verts): 124 / 16,100 / 47,100, with an absolute 200 draw-object ceiling. |
| the gateway arches | `createGatewayArches(gates)` | `src/render/gateways.ts:45` | Presentation-only merged surface for the A2 fixture's four entries; the world owns the floor gaps. A4's ring/gate cells are collision-authoritative; these arches are not used by the app. |
| the post pipeline | `new EffectComposer` … `OutputPass` | `src/main.ts:168` | RenderPass → UnrealBloom → vignette → OutputPass; ACES Filmic + sRGB. `renderer.info.autoReset = false` so the readout counts the whole composed frame. |
| distance fog on every renderer | `scene.fog` plus the ShaderMaterials' `uFogNear/uFogFar` | `src/main.ts:142` · `src/render/config.ts:212` | Standard fill/edge materials take scene fog automatically; the rim and grid ShaderMaterials carry the same range in their uniforms. A new ShaderMaterial must do the same or it will visibly not fade. |
| the measured look budget | `python3 scripts/look-budget.py <png> [--json]` | `scripts/look-budget.py:1` | The ONE pixel measurement of §9: surface median ≤22 L, frame share 26–51 ≤25 %, line p99 ≥150, contrast ≥6; `shot.sh` runs it after every capture and exits non-zero on a FAIL. Void is INFO (no threshold was specified); team hulls are SKIP (the hull fill is neutral/shared). |
| the screenshot | `scripts/shot.sh` | `scripts/shot.sh:1` | Build, serve `dist`, headless Chrome, then kill the server AND the Chrome process group in a `trap`; a SwiftShader retry only when the first frame is not a rendered image. The look budget runs on the final capture and a FAIL makes the command exit 1. |
| building a match | `createMatch({level, teams, seed, rules})` | `src/core/sim/match.ts:136` | The ONE constructor: validates 2–4 teams, 1–4 tanks each, finite/free spawns (including no overlapping bodies), and the pitch clamp, then creates the A1 world and the seeded RNG. Never hand-build a `MatchState`. |
| one simulation tick | `stepMatch(state, orders)` | `src/core/sim/step.ts:75` | The ONE advance: mutates and returns the state, requires one command for every tank alive at tick start, and throws once the match has ended. Phase order is fixed; see the gotchas. |
| one tank command | `validateTankCommand` · `normaliseTankCommand` | `src/core/sim/commands.ts:37` · `src/core/sim/commands.ts:62` | The ONE boundary for command data: finite numbers, throttle/steer in −1…1, pitch in −30…25, boolean `fire`; `aimYaw` is an angle and wraps rather than clamps. Malformed commands throw; they are never silently clamped. |
| where a tank's command comes from | `Controller.commandFor(state, tankId)` · `ScriptedController` | `src/core/sim/controller.ts:12` · `src/core/sim/controller.ts:21` | Human, AI, replay and future network all implement this ONE interface. There is no `isPlayer` in the core; a missing script entry is a loud error, not an idle tank. |
| the match's tuning | `src/core/sim/constants.ts` (`TANK_*`, `AIM_PITCH_*`, `MUZZLE_*`, `RELOAD_TICKS`, `SHELL_*`, `BLEED_INTERVAL_TICKS`, `MATCH_TICK_CAP`, `DEFAULT_MATCH_RULES`) | `src/core/sim/constants.ts:24` | The ONE combat tuning module. Values are metres/seconds/degrees or whole ticks; a speed becomes a per-tick move through `STEP_SECONDS`. The shared `CELL_SIZE_METRES` is world-owned (seam below); do not copy a combat number into the renderer. |
| a tank's free position in the world | `isTankPositionFree(world, x, z)` | `src/core/sim/match.ts:249` | The ONE circular-footprint query against cells: arena bounds, `isCellPassable` and `isSolidAt` at hull height; a floor hole is free, a wall/pillar/big block is not. It does NOT know other tanks; body blocking is the separate seam below. |
| tank-tank body blocking | `moveTank(state, tank, dx, dz)` · `tankBodyBlocksMove(...)` | `src/core/sim/step.ts:197` · `src/core/sim/step.ts:229` | The ONE body rule: a circle of `TANK_RADIUS_METRES` against another live tank's circle; a candidate passes only if its swept circle does not enter the sum-radius contact disc before the endpoint. Try full, then x-only, then z-only. Tanks resolve in ascending id, never array order; dead tanks do not block. |
| rejecting an overlapping spawn | `assertTankSpawnDoesNotOverlap(tanks, spawn, teamId, teamIndex)` | `src/core/sim/match.ts:291` | `createMatch`'s authoring boundary: a same-cell spawn, or any circle overlap (centre distance < 2 × radius), throws. It never nudges or drops a tank. |
| a swept muzzle | `fireShells(state, commands)` barrel trace | `src/core/sim/step.ts:659` | Before spawning, trace the turret origin → muzzle segment through the same `earliestCollision` resolver (owner excluded). The first wall/block/shard/tank hit resolves there and no shell enters flight; the trigger still counts and spends the reload. A muzzle flush with a wall face is included by the boundary-adjacent cell scan. |
| a moving tank shoving floor shards | `shoveShardsUnderTank(state, tank, movedX, movedZ)` (internal) | `src/core/sim/step.ts:303` | After a successful drive or a world-regeneration displacement, every shard in the tank's entered cell goes through A1 `shoveShard` with the movement direction. Shards never block the tank; a trapped shard may stay. Do not add a second shove rule. |
| a shell's 3D direction | `directionFromAim(turretYaw, pitch)` | `src/core/sim/geometry.ts:70` | The ONE aim convention: `(-sin(yaw)·cos(pitch), sin(pitch), -cos(yaw)·cos(pitch))`; yaw 0 faces −z, positive yaw turns towards −x, positive pitch is up. `forwardFromYaw` (`src/core/sim/geometry.ts:64`) is the horizontal sibling used by drive and the muzzle. |
| the first thing a shell hits | `earliestCollision(state, from, to)` | `src/core/sim/step.ts:465` | The ONE shell collision resolver: world cells/blocks, shards and live tank cylinders all feed one earliest-`t` comparison, tie-broken world → shard → tank then cell/shard/tank id. Damage side effects stay in `advanceShell` / `resolveMuzzleHit`. |
| firing | `fireShells(state, commands)` | `src/core/sim/step.ts:659` | The ONE spawn path: after existing shells advance, each held `fire` with a clear reload first sweeps the barrel trace; a clear trace pushes exactly one shell at the muzzle (`MUZZLE_FORWARD_METRES`, floor + `MUZZLE_HEIGHT_METRES`), while an obstruction resolves immediately. Either way `shotsFired` increments and `reloadTicksRemaining = RELOAD_TICKS`; a muzzle hit may end the match before later tanks fire. |
| the wound clock | `bleedWoundedTanks(state)` | `src/core/sim/step.ts:319` | The ONE clock: only a wounded live tank counts down; the first wound starts it and later hits do not reset it; expiry removes 1 HP and a lethal expiry records `clock`. |
| ending a match | `checkLastTeam` · `finishAtTickCap` | `src/core/sim/step.ts:763` · `src/core/sim/step.ts:777` | The ONE end rule: the usual last-team check after existing shells; a resolved muzzle hit can finish immediately during fire, before later tanks. At the cap compare total live HP, then live count, else draw (equal HP + equal live tanks is a pinned draw). Do not add another generic check after fire. |
| the per-match counters | `MatchStats` · `createMatchStats()` | `src/core/sim/stats.ts:23` · `src/core/sim/stats.ts:37` | The ONE stats shape for the HUD and batch rig: `shotsFired` counts trigger pulls that spent the reload (spawned or muzzle-blocked), `hits`/`damageDealt` count tank damage only, `kills` equals `causes.shell`; clock deaths are `causes.clock`. |
| a run's combat identity | `hashMatch(state)` | `src/core/sim/hash.ts:18` | The ONE match hash: canonical state text including RNG state, the A1 world hash, tanks, shells, match status and stats. An equality witness, not a measurement. |
| the simulation's public surface | `src/core/sim.ts` | `src/core/sim.ts:1` | The ONE entrance: constants, geometry, commands, stats, match, step, hash and controller re-exported. Callers outside the sim package import from here, never from `sim/*.ts` except a deliberate internal seam. |
| the world's visible version | `World.revision` · `markWorldChanged(world)` | `src/core/world/state.ts:75` · `src/core/world/state.ts:103` | ONE monotonic counter bumped once per changed public mutation (damage, block/rubble, shard spawn/remove/shove, regeneration HP, displacement). A regen-timer tickdown alone does NOT bump it. The renderer rebuilds only on a changed integer. |
| the frame→ticks bridge | `PlayableSession.advance(frameSeconds, input)` · `.step(command)` | `src/game/session.ts:164` · `src/game/session.ts:182` | The ONLY place a frame delta becomes `FixedStep` ticks for the app; one `stepMatch` per tick, with the dummy idling. No simulation call exists in a render module. |
| a player's command | `commandFromInput(input, hullYawDegrees)` | `src/game/input.ts:64` | The pure mapping: WASD→throttle/steer, pointer X→RELATIVE turret yaw (±60°), pointer Y→pitch (top +25°, centre 0°, bottom −30°), fire boolean. Unit-tested in node; malformed numbers throw. |
| browser events | `createBrowserInput(canvas)` | `src/game/browserInput.ts:26` | The only DOM reader: key set, canvas-normalised pointer, click/Space fire. No pointer lock (deliberate): the cursor position is the aim, so there is no hidden/recentre state. |
| an AI sightline | `hasLineOfSight(world, from, to)` · `visibleEnemies(state, tank)` | `src/core/ai/perception.ts:49` · `src/core/ai/perception.ts:77` | Samples a 3D segment through `isSolidAt` at eye height (`floor + 1.6 m`) to the target's turret point (`floor + 1.0 m`); a 1.2 m barrier is below the line, a 4.8 m wall blocks it. Team-aware, no shell resolver. |
| short enemy memory | `PerceptionMemory.update(state, tank)` · `.latest()` | `src/core/ai/perception.ts:99` | Remembers the last seen position/tick per enemy for the profile's `memoryTicks`; memory is for navigation, never for firing. |
| AI navigation | `NavigationCache.findPath(...)` · `reachablePointNear(...)` | `src/core/ai/navigation.ts:120` · `src/core/ai/navigation.ts:209` | A* over four-neighbour body-free cell centres; the cache recomputes only on `world.revision` or a new goal CELL. Smoothing uses a sampled body-clear line. Boundary rows with zero clearance are rejected so a tank cannot wedge on an arena edge. |
| AI character data | `validateAIProfile(input)` · `AI_PROFILES` | `src/core/ai/profile.ts:143` · `src/core/ai/profile.ts:132` | The only profile boundary: all eight goal keys (`gain-line-of-sight`, `approach-preferred-range`, `fire-in-cone`, `hold-cover`, `flank`, `ambush-chokepoint`, `breach-wall`, `wounded-retreat`) must be present and in 0…1; per-profile range, cone, memory, aim, ambush-hold and breach-range fields are validated numbers; unknown keys and invalid ranges throw. The four profiles are data, not classes and are passed through `validateAIProfile` at module load, so an invalid shipped weight fails the import; a test imports and re-validates all four. |
| an AI decision | `AIController.commandFor(state, tankId)` | `src/core/ai/controller.ts:170` | One controller per tank; decides on the first call and every 6 ticks (default phase 0), holds the SAME command object in between, and never reads a clock. The profile goal weights select the mode: vanguard strafes and fires; sniper holds a long sightline and retreats inside `minRangeMetres`; ambusher walks to a reachable no-LOS cell, holds for `ambushHoldTicks`, then relocates; brute breaches a blocking or nearby cover cell, then brawls. Profiles with `wounded-retreat` add the retreat goal. |
| a batch of AI matches | `runBatchMatches(setup, options)` · `pnpm batch` | `src/core/ai/batch.ts:125` · `scripts/batch.ts:1` | Real `createMatch`/`stepMatch`/`hashMatch` on a supplied level, one vanguard tank per team. Writes `reports/batch.json` and one seed's JSONL trace; `reports/` is gitignored. Summary keeps mean/median length, cap hits, accuracy, TTK from first shot, mean speed and deaths by cause. |
| a 4-team AI batch | `runTeamBatch(setup, options)` · `pnpm batch --teams 4 --tanks-per-team 4` | `src/core/ai/teamBatch.ts` · `scripts/batch.ts:1` | Same real match seam, up to 4 teams ×4 tanks with the same character cast by slot. Reports per-team and per-corner win splits, length distribution, cap hits, shots/hits, kills, damage, deaths by cause, and per-character survival/damage taken. Writes `reports/team-batch.json`; the 1v1 `reports/batch.json` and trace shape are unchanged. The team-to-corner assignment rotates by seed and the team AI uses `aimErrorScale: 0.1` (see §4). |
| the team staging | `arenaTeamSetup(teams, tanksPerTeam)` | `src/game/aiBatch.ts` | Four pads in each corner's outer gate, all facing east, with the same cast by slot. The authored 2×2 rings leave the tank-body navigation graph in four disconnected 78-cell components, so team matches use `TEAM_ARENA` (below) and these pads rather than the 1v1 duel staging. |
| the team arena variant | `TEAM_ARENA` | `src/game/levels/arena.ts` | The same 48 m, four-fold authored arena with the eight ring corners opened from 2×2 to 5×5 windows. This turns the body-free graph into one 404-cell component; the playable `ARENA` and its 2×2 gates are unchanged. |
| the character round robin | `runRoundRobin(seedsPerPairing)` · `pnpm round-robin` | `src/game/aiBatch.ts:236` · `scripts/round-robin.ts:1` | Every unordered character pairing, both orientations, `seedsPerPairing/2` seeds each way: 6 × 2 × 100 = **1200 matches** at the default 200. Runs the real `createMatch`/`stepMatch` and reports the win matrix, per-character overall win rate, and four signatures against the field median: engagement distance while in LOS, world destruction (cells destroyed + big blocks broken), out-of-LOS share, and mean speed. Writes `reports/round-robin.json` (gitignored). |
| the 1v1 duel staging | `arenaDuelSetup()` | `src/game/aiBatch.ts:12` | The 2-team batch starts on the open north margin at (18, 6) and (30, 6), a mirror pair, now pinned by `src/game/aiBatch.test.ts`. Adjacent authored corner spawns are NOT a symmetry pair: their exits face different directions, so a 1v1 started there has an unavoidable spatial/cover bias. The four corner spawns remain the >2-team/arena layout. |
| the spectator match | `SpectatorSession` | `src/game/spectator.ts` | Every tank is an `AIController`; no player input. Deterministic seed, team-mode controller seeds/phases, fixed step, shared `tankFrames` interpolation. Teams and tanks per team are URL options (`?mode=spectate&teams=4&tanksPerTeam=4&seed=…`). |
| the auto-director | `SpectatorSession.directorShot()` · `updateDirector` | `src/game/spectator.ts` | Cuts every 180 ticks and when a shell appears. While 10+ tanks and four teams are alive it frames a four-team overview; otherwise it scores alive enemy pairs with line of sight, preferring shells in flight and nearby teams. `N` cycles to the next living tank and locks a follow; `A` resumes automatic cuts. |
| the spectator camera | `spectatorPose(input)` · `CAMERA.spectator*` | `src/render/cameraMath.ts` · `src/render/config.ts` | The director's wider arm, 12–44 m and 34–55° pitch, outside the player's 16 m zoom clamp. The spectator renderer uses `CAMERA.spectatorExposureScale` 0.8; the playable exposure is untouched. |
| the spectate screenshot | `bash scripts/shot.sh spectate [detail] [out]` | `scripts/shot.sh:1` | Builds, serves `dist`, and loads `?mode=spectate&teams=4&tanksPerTeam=4&seed=7&pose=spectate&ticks=300`. The fixed tick is deterministic; the four-team overview frame passes the look budget including the 24×14 tile gate. |
| a fair decision phase | batch's `decisionPhaseTicks` | `src/core/ai/batch.ts:203` | The phase is balanced by TEAM: `(seed + 3·teamId) mod 6`. Deriving it from tank id made tank 0 always three ticks ahead of tank 1 (the B1a 85/15 finding); the phase must not be correlated with the id that also fixes action order. |
| AI aim spread and dodge | profile `aimErrorBaseDegrees` / `aimErrorPerMetre` · `startDodge` · `strafePoint` | `src/core/ai/profile.ts:36` · `src/core/ai/controller.ts:273` · `src/core/ai/controller.ts:405` | Every profile supplies its own seeded range-scaled yaw/pitch spread (vanguard **10° + 1.8°/m**; the sniper is tighter, the brute 4° + 0.6°/m); `AI_AIM_ERROR_*` is fallback only. A deliberate wall breach uses a tight fixed spread because the target is stationary. Every profile strafes in contact, and every profile dodges for 60 ticks after a shot or a hit; the effective shot interval stays 285 ticks. These are the pacing levers, kept out of the sim's global `RELOAD_TICKS`. |
| the vanguard's shot interval | `AI_FIRE_INTERVAL_TICKS` | `src/core/ai/constants.ts:15` | The sim reload stays 60 ticks; the AI deliberately waits 285 ticks before its next trigger. This is the pacing lever that produced the 900–1800-tick band without changing the player's fire rate. |
| the wound clock | `BLEED_INTERVAL_TICKS` · `MatchRules.bleedIntervalTicks` | `src/core/sim/constants.ts:75` | B1b raised the default from 600 to 900 ticks so a 3-HP duel can last the required 15–30 s while the clock still kills wounded tanks in a measurable share. The value remains a `MatchRules` override, so a test/app can still use 600. |
| the authored level | `ARENA` · `spawnCentreMetres(spawn)` | `src/game/levels/arena.ts:1` | The ONE 48×48 m, 24×24-cell, 4-fold arena: four 2×2 corner spawn rooms with screened dogleg exits, outer/inner square rings with 2×2 corner gateways, breakable central pillar block, ambush pockets and low coverage. `session.ts` is the only app caller. |
| load-time level validation | `validateLevel(level)` | `src/game/levels/format.ts:105` | The ONE boundary before `createMatch`: square grid, legal materials/heights, exactly four unique 2–4-cell spawn zones, free non-overlapping spawn cells, flood-fill on-foot connectivity from spawn 0, every passable cell in the central objective window reachable from that component, and 90° (therefore four-fold) cell-grid symmetry. Every cell failure names the offending `(x, z)`. Never build the app world from unvalidated data. |
| the demo/screenshot scenario | `?demo=duel&ticks=122` · `PlayableSession.runDemo(ticks)` | `src/main.ts:64` · `src/game/session.ts:205` | Runs a fixed scripted sequence on the authored arena, freezes before the first frame, and seeds one visible ambush-pillar breach. At tick 122 the dummy is at 1 HP and the third shell is in flight; the win is tick 124. |
| the top review pose | `?pose=top` · `createTopPlan(ARENA)` | `src/main.ts:191` · `src/render/topPlan.ts:26` | One orthographic camera looks straight down with `up = (0, 0, −1)`; the same app scene/composer is rendered with all tanks hidden. The overlay draws team spawn zones, white L-shaped screened-exit arrows, dark tall-wall/low-cover/objective fills, and the HTML legend. `shot.sh top` selects it. |
| interpolation | `PlayableSession.interpolatedTanks(alpha)` | `src/game/session.ts:230` | Tanks interpolate x/z/hull/turret/pitch between the previous and current tick; yaw uses the shortest arc. Shells render at the latest state (no interpolation), chosen because their flight is short and a trail already reads motion. |
| the app scene | `createPlayableScene(state, ids)` | `src/render/playableScene.ts:40` | Builds the real world mesh, debris, two tank views and the shell streak buffer. This is the app path; the A2 showcase remains the budget fixture. `setTanksHidden` is the top-plan review switch, not gameplay. |
| rebuilding on revision | `PlayableScene.syncWorld()` | `src/render/playableScene.ts:77` | The ONE rebuild gate: compares `World.revision` with the last built revision; only a change calls `worldMesh.rebuild()` / `debrisView.rebuild()`. Never per frame. |
| shells/debris views | `createShellView()` · `createDebrisView(world)` | `src/render/shellView.ts:31` · `src/render/debrisView.ts:24` | One merged streak line buffer for shells; one merged `NeonSurface` for A1 blocks and shards. Both are data-derived, never patched. |
| the in-style HUD | `createHud()` | `src/entry/hud.ts:42` | DOM only: 3-segment player/target HP, reload ring, fps and the victory/defeat banner. Colours come from `PALETTE`/`teamColor`; no HTML controls. |
| the combat screenshot pose | `cameraPose('combat', ...)` | `src/render/cameraMath.ts:228` | Deterministic behind/above player frame for the demo breach, target and in-flight shell. Added to `CAMERA_POSE_NAMES`; `shot.sh combat` selects it. |
| a low shoot-over barrier | `isLowCover(heightMetres)` · `LOW_COVER_MAX_HEIGHT_METRES` | `src/render/config.ts:193` | ONE predicate/height threshold distinguishes low cover from tall architecture in both the 3D edge hue (`worldMesh`) and the plan fill (`topPlan`); the A1 height model remains the collision authority. |
| the spatial look budget | `tile_p90(luminance)` | `scripts/look-budget.py:97` | Splits a frame into 24×14 tiles, takes each tile median, and requires p90 ≤ 30.6 L (12 %); alongside the existing whole-frame gates. Proof injection reaches 255 L / 100 % and FAILS. |
| the screenshot command | `scripts/shot.sh [pose] [detail] [out]` | `scripts/shot.sh:1` | Accepts `wide \| tank \| first \| combat \| top \| spectate`; `combat` appends `&demo=duel&ticks=122`, `top` selects the plan, every run executes the look budget, and the trapped Chrome tree is reaped (`chrome processes after cleanup: 0`). |
| a canonical core hash | `fnv1a(text)` | `src/core/fnv1a.ts:14` | The ONE FNV-1a implementation; both `hashState` (world) and `hashMatch` (combat) feed it. Do not copy the offset basis/prime into a third hasher. |
| seeded randomness in the simulation | `createRng(seed)` | `src/core/rng.ts:35` | The ONLY draw source under `src/core`: integer-only mulberry32, so a seed reproduces its sequence on every engine. A source scan (`src/core/purity.test.ts`) fails the build on `Math.random`. |
| building the world | `createWorld(spec)` | `src/core/world/state.ts:108` | Validates the spec loudly (integer dimensions, a height above the floor plane, no double placement) and builds the row-major grid. Level data fills the same shape. |
| addressing a cell | `cellAt(world, x, z)` | `src/core/world/state.ts:190` | The ONE integer + bounds check (`cellIndex`, `src/core/world/state.ts:179`). Never index `world.cells` directly. |
| is there material at a height | `isSolidAt(world, x, z, metres)` | `src/core/world/state.ts:220` | Height-aware by construction: below a big block's top, or an intact cell's top; nothing at all over a hole. This is what stops a low wall from blocking a high shot. |
| can a tank stand in a cell | `isCellPassable(world, x, z)` | `src/core/world/state.ts:241` | The ONE definition of "free", used by displacement and shard shoves. A DIFFERENT question from `isSolidAt`: an intact floor is solid at 0.1 m and still passable. |
| the drivable surface through a hole | `floorSurfaceHeightAt(world, x, z)` | `src/core/world/state.ts:205` | The floor plane, holes included — the contract that tanks stand on the bedrock and never fall. |
| a cell taking damage | `damageCell(world, x, z, amount, rng)` | `src/core/world/destruction.ts:40` | The ONE destruction path: clamps HP, restarts the regen clock, and on destruction spawns the material's debris from `MATERIAL_PROFILES`. A hole reports a no-op, never a silent hit. |
| rubble taking damage | `damageBlock(world, x, z, amount)` | `src/core/world/destruction.ts:73` | A big block clears only through this; the cell's frozen regeneration resumes when the block is gone. |
| what a destroyed cell yields | `spawnDebris(world, cell, rng)` | `src/core/world/debris.ts:95` | Internal to the world package. The material profile is the only switch, and the shard cap is applied here. |
| a shard's mirror | `shardDeflection(shard, direction)` | `src/core/world/debris.ts:148` | The only reflection geometry: `d - 2(d·n)n` with a stored normal from a 16-entry **literal** table (no trigonometry, so every engine sees the identical double). |
| a shell hit on a shard | `shatterShard(world, shardId)` | `src/core/world/debris.ts:165` | One shard, one hit, gone. |
| shoving a shard | `shoveShard(world, shardId, direction)` | `src/core/world/debris.ts:185` | One cell along the shove, else a fixed side order, else it stays (`moved: false`). Never through material. |
| advancing the world | `stepWorld(world, ticks, occupants)` | `src/core/world/regeneration.ts:63` | The tick loop: heals one frame per delay, absorbs shards, and displaces occupants by a fixed-order nearest-free search. Returns `Displacement[]`; the CALLER applies them, and the world never writes to the caller's occupants. |
| iterating debris | `listBlocks(world)` / `listShards(world)` | `src/core/world/state.ts:258` | Blocks in a stable cell order, shards oldest first; `blockAt` / `shardAt` for one cell. |
| a run's identity | `hashState(world)` | `src/core/world/hash.ts:15` | FNV-1a over canonical state text (ids, HP, timers, mirror angles, tick, revision) — the pin that proves two identical runs stayed identical. |
| the shared cell size | `CELL_SIZE_METRES` | `src/core/world/constants.ts:18` | The ONE 2 m definition, exported by `src/core/world.ts:51` and re-exported by `src/core/sim/constants.ts:22`. `src/render/config.ts` imports it from the world entrance; the source-scan pin fails if a second `CELL_SIZE_METRES = 2` definition appears. |
| the world's numbers | `MATERIAL_PROFILES` · `SHARD_CAP` · `CELL_SIZE_METRES` · `secondsToTicks` | `src/core/world/constants.ts:46` | The ONE world tuning module. `secondsToTicks` (`src/core/world/constants.ts:79`) is the only seconds→ticks conversion, and a tick IS `STEP_SECONDS`. |
| the world's public surface | `src/core/world.ts` | `src/core/world.ts:1` | The ONE entrance: the model's doc, its types and its seams, re-exported. Callers outside the world package import from here, never from `world/*.ts`. |

### The cast and its signatures (B1c)

`AIProfile` is the one data shape. It carries eight goal weights and the numeric
parameters those goals need — preferred/minimum range, fire cone, memory, aim error,
ambush hold, breach range. `validateAIProfile` is the load boundary; the controller
never carries a character name. The modes are selected from the data:

- **vanguard** — strafe, close, fire (the B1b pilot).
- **sniper** — hold a long sightline; retreat when the enemy is inside `minRangeMetres`.
- **ambusher** — choose a body-free hidden cell that is actually reachable, hold it for
  `ambushHoldTicks`, fire, then relocate.
- **brute** — when a shot or route is blocked, fire the blocking cell; otherwise make
  one nearby cover breach, then brawl with the vanguard's strafe behaviour.

The weights are consumed, not decorative. `hold-cover` gates the sniper's stationary
hold and the ambusher's hidden hold; `flank` enables the lateral strafe branch for the
vanguard, the sniper's fallback when it is not holding, and the brute after its breach;
`wounded-retreat` adds the retreat goal; the rest gate the mode itself.

The round-robin signatures are defined at the same seam as the batch stats:

- **engagement distance** — mean distance to the nearest live enemy over ticks where
  the tank has line of sight; `null` when it never had one.
- **world damage** — `worldDestructionByTeam`: cells destroyed plus big blocks broken,
  attributed to the firing team. It is not tank HP.
- **out-of-LOS share** — alive ticks with no live enemy in line of sight, divided by
  alive ticks.
- **mean speed** — distance moved divided by alive time (`STEP_SECONDS`).

`runRoundRobin` runs all six unordered pairings in both orientations. The field median
is the median of the four per-character means; each signature's delta is normalised by
the absolute median. The acceptance test is a measurement, not a hardcoded pass:
30–70 % overall win rate per character, and at least 20 % away from the field median on
that character's own signature.

### Team battles and the spectator (B2)

The authored arena's 2×2 ring gateways are wide enough for the eye but not for the
tank body: the body-free navigation grid splits into **four 78-cell components**, so
four teams starting at the corners can never meet. `TEAM_ARENA` is a data variant of
the same four-fold arena with the eight corner windows opened from 2×2 to **5×5**;
that yields one **404-cell** component. `ARENA` (playable) and its gates are unchanged.
The team pads sit in each corner's outer gate, four tanks each, all facing east, and the
team-to-corner assignment rotates with the seed.

`runTeamBatch` uses the real simulation and the same character cast by slot. The team
table keeps the 1v1 report shape and adds per-team and per-corner win splits and a
per-character survival/damage-taken breakdown. On 200 seeds (4×4) it reported
**1.40 matches/s**, median **3836.5 ticks**, **12.0 %** cap hits, **41.6 %** accuracy
and **1.29 m/s** mean speed. The team AI uses **`aimErrorScale: 0.1`** (the 1v1 value
is 1) because sixteen tanks shooting across 48 m otherwise spend the tick cap hitting
walls; that is a mode tuning, not a player balance change.

`SpectatorSession` runs that same match with no input: deterministic seed, four AI
controllers per team, the shared fixed step and `tankFrames` interpolation. The
director cuts on a 180-tick interval (and when a shell appears). With 10+ tanks and
four teams alive it frames a **four-team overview**; later it scores visible enemy
pairs, preferring shells in flight and nearby teams. `N` selects the next living tank
and locks a follow camera; `A` resumes automatic cuts. The screenshot pose is
`?mode=spectate&teams=4&tanksPerTeam=4&seed=7&pose=spectate&ticks=300`, a fixed
four-team overview whose frame passes the look budget.

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
- **The A2 showcase is now a FIXTURE, not the app path.** `demoWorld.ts`/`sceneAssembly.ts` remain the hand-authored 16-tank scene the A2 `sceneBudget.test` measures; the live app uses `createPlayableScene` over the real match and `ARENA`; A5 owns the full HUD.
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
  `BufferGeometry`. A3c's `PlayableScene.syncWorld()` calls it only when
  `world.revision` changes — never per frame. Disposing a surface frees its merged
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
  frame share in L 26–51 ≤25 %, line p99 ≥150, contrast ≥6 and the 24×14 tile p90
  ≤30.6 L (12 %). Void is INFO because the brief gives no void threshold. Team hulls are SKIP: A2c's hull fill is neutral and
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
  gate gaps; `gateways.ts` adds arch geometry outside the world model for the A2 fixture.
  A4's level uses real ring/gate cells, so cell collisions are authoritative; do not
  read gameplay bounds from the A2 arches.
- **The scene budget is still the A2 16-tank fixture.** `buildArenaScene()` is what
  `sceneBudget.test.ts` measures (103 objects / 13,344 triangles / 39,232 vertices,
  20 % headroom); the A3c app's playable scene measured **19 draw objects / 3,536
  triangles / 10,648 vertices** in node and **34 renderer calls** through the composer
  at 1920×1080. Do not quote the old fixture as the app's object count; the 34 calls
  are the live frame.
- **`SURFACE_DETAIL` is one module-global scalar.** It scales the fresnel rim, wall
  sheen, top band, procedural seams and the reserved detail-map slot on the shared
  material; it never touches the edge lines or bloom. The detail slot is deliberately
  empty — a future texture must come through §9's image-map budget (tileable greyscale,
  ≤ 512², ≤ 15 %), not be loaded in a scene module. The 0-vs-default pair is the
  control: zero leaves albedo + edge lines; the default adds richness, never dominance.
- **The interactive camera and the screenshot poses are two different things.** The
  follow arm stays dead astern; `cameraPose('tank')` is a frozen over-the-shoulder 3/4
  framing, and `cameraPose('combat')` is the demo's behind/above corridor frame. Do not
  use either pose offset as gameplay camera behaviour.
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

- **A simulation tick resolves in a fixed phase order.** `stepMatch` validates the
  commands, applies hull/turret/drive, advances the A1 world (regeneration and
  displacement), bleeds wounded tanks, advances shells already in flight, performs the
  usual last-team check, then fires, then applies the tick cap. A clock death and a shell
  in flight in the same tick resolve before the match is declared over; a newly spawned
  shell moves next tick, so a shell-in-flight kill gets no gratuitous extra shot. The
  fire phase is the exception: every barrel trace is resolved immediately, so a muzzle
  hit can remove the last team and end the match before any later tank fires. Do not add
  a generic second check after fire; the only fire-phase check is the one after a muzzle
  hit.
- **A shell is a 3D segment, and `earliestCollision` is the only resolver.** World cells
  are boxes from y 0 to their top (a big block's top if one stands there, otherwise the
  intact cell's `heightMetres`; a bare hole has no box). Tanks are vertical cylinders of
  radius 1 m and height 1.5 m, shards are floor-to-0.5 m boxes, and the earliest `t`
  wins; equal `t` is settled world → shard → tank, then cell/shard/tank id. A shell
  that hits a shard is reflected by A1's literal mirror table and continues with the
  remaining tick distance. Never add a second collision routine or a raycast library.
- **The floor is hittable because pitch is real.** The muzzle is at
  `floorSurfaceHeight + 1.1 m`; a downward command pitch takes the shell to an intact
  floor cell's top (0.25 m in the test/showcase world) and damages it through
  `damageCell`. A high shot over a low wall is the same geometry, not a special case.
- **The bleed clock is a kill path, not a slow regeneration.** Only a tank with
  `hp < maxHp` and a running countdown loses HP; the first shell hit starts the
  countdown, later hits do NOT reset it, and a lethal expiry sets `deathCause = 'clock'`,
  increments `causes.clock`, and does NOT increment `kills`. Dead tanks are skipped by
  collision, drive, aim and fire; their shells already in flight keep flying.
- **A teammate's body stops a shell without damage.** Team identity is carried on the
  shell at spawn; a tank hit with `target.teamId === shell.ownerTeamId` terminates the
  shell and records neither a hit nor damage. Every other team is hostile.
- **The barrel is swept, not a point 3 m ahead.** On the fire tick the segment from
  the turret origin to the muzzle runs through `earliestCollision` with the owner tank
  excluded. The first hit resolves there: a wall/block is damaged once, an enemy tank
  takes one hit, a teammate stops it without damage, a shard shatters (a defensive branch
  — the floor shard band is below muzzle height). No shell enters `state.shells`, but
  `shotsFired` increments and the reload is spent, so a blocked barrel is not a free
  shot. The world cell scan includes adjacent faces, so a muzzle flush with a wall is
  caught; `far <= 0` rejects a wall behind the starting face.
- **Tank bodies block each other with circles, in id order.** Each live tank is a
  circle of radius 1 m. A proposed move is rejected when its swept centre path enters
  the 2 m contact disc of another live tank before the endpoint; full, x-only and z-only
  are tried in that order, and a candidate ending exactly at contact is allowed. The
  movement order is ascending tank id (never the caller's array order), and the
  determinism pin reverses `state.tanks` to prove it. Spawn validation rejects same-cell
  and circle-overlapping placements loudly, before a state exists. Dead tanks do not
  block.
- **Yaw and pitch conventions are one-way doors.** Yaw 0 faces −z and positive yaw turns
  towards −x; pitch is degrees above the horizon, positive up, clamped to −30…25. The
  direction formula above is the only consequence; do not introduce a second convention
  in the renderer. `aimYaw` wraps, pitch throws outside the clamp.
- **`createMatch` requires 2–4 teams of 1–4 tanks, unique team ids 0…3, finite free
  spawns and an authored `rules` object.** There is no implicit default match, no
  one-team field, and no silent spawn adjustment; a blocked spawn is an authoring error.
- **Determinism is same-engine, seeded determinism.** The hash includes the RNG state
  and the A1 world hash and is stable for the same seed and commands on this engine.
  Shell aim uses `Math.sin`/`Math.cos` (the world's shard mirrors deliberately do not),
  so the project does not claim cross-engine bit identity; row 25's authoritative model
  does not need it, strict lockstep would.
- **`CELL_SIZE_METRES` is world-owned, one definition.** It lives in
  `src/core/world/constants.ts`, is exported by `src/core/world.ts`, re-exported by
  `src/core/sim/constants.ts` for sim callers, and imported by
  `src/render/config.ts` as `GRID.cellMetres`. The source-scan pin in
  `src/core/purity.test.ts` fails if a second `CELL_SIZE_METRES = 2` definition or a
  literal `cellMetres: 2` appears; do not copy 2 m into a layer.

- **`world.revision` is a VISIBLE-change counter, not a tick count.** A public mutation
  that changes cells/blocks/shards or displaces an occupant bumps it once; a no-op hole
  hit, a blocked shove and a regen-timer tickdown do NOT. It is in
  `hashState`, so two runs cannot share a world hash while differing in rebuild state.
  Do not increment it from the renderer or from a per-frame poll.
- **World + debris rebuild exactly on a revision change.** `PlayableScene.syncWorld()`
  stores the revision it last built and returns false on equality; only a change calls
  `worldMesh.rebuild()` and `debrisView.rebuild()`. A per-frame rebuild would be both
  wasteful and a second source of truth.
- **The bridge interpolates TANKS, not shells.** `FixedStep.alpha` is passed to
  `PlayableSession.interpolatedTanks`, which lerps x/z/pitch and uses the shortest arc
  for hull/turret yaw between the previous and current tick. Shells are drawn at their
  latest simulation position (a 1.8 m streak conveys motion); this is deliberate. The
  renderer never calls `stepMatch`.
- **Input is a pure mapping, and there is deliberately NO pointer lock.** WASD becomes
  throttle/steer, pointer X becomes a ±60° turret yaw RELATIVE to the hull, pointer Y
  maps top +25° / centre 0° / bottom −30°, and click/Space fires. `browserInput.ts` only
  gathers events; `input.ts` is unit-tested. Pointer lock would add hidden cursor,
  Escape and recentre states for no gain in a third-person cursor-aim control.
- **The hull is 2.0 × 2.6 m, inside the 1 m body radius by width.** `config.test.ts`
  pins `TANK.hullWidthMetres / 2 <= TANK_RADIUS_METRES * 1.05` (measured 1.00 m). The
  turret/barrel are scaled with it. The whole turret group is the pitch pivot, so pitch
  tilts the turret body as well as the gun; a gun-only pivot would need a third
  `NeonSurface` and is deferred until the visual complaint is measured.
- **The demo is frozen before the camera is built.** `?demo=duel&ticks=122` runs
  `runDemo` synchronously, seeds one wall breach through the real destruction seams,
  then constructs the scene/camera. At 122 the dummy is at 1 HP and the third shell is
  in flight; ticking it to 123 produces a real last-team win/death. Do not animate a
  screenshot past the freeze.
- **The look budget now includes a 24×14 tile p90.** `scripts/look-budget.py` takes
  each tile's median and requires p90 ≤ 30.6 L (12 % of white) in addition to the
  whole-frame gates. A white injection rectangle measured 255 L / 100 % and FAILED,
  proving the check catches a locally bright wall; the four final poses pass at 17–26 L.
  Thresholds are the gate; do not widen them to fit a frame.
- **The HUD is DOM, not canvas.** `createHud()` owns the three-segment HP bars, reload
  ring and banner; colours come from `PALETTE`/`teamColor`, and the element has
  `pointer-events: none`. There are no HTML controls. The HUD is a minimal A3c readout,
  not the A5 interface.

## 4 · Known debt

- **A4/B1a is still not the full game.** The app is a single playable duel on the
  authored arena; B1a/B1c add the headless all-AI batch and the four-character cast; B2 adds the live spectator on the team arena, but not the full A5 HUD. A5 owns the interface. The A2
  showcase and its 16-tank budget fixture are retained only for the existing
  look/budget pins.
- **The body is a circle but the hull is a 2.6 m box.** The width fits the 1 m radius
  (1.00 m half-width), but the nose/tail extend beyond the circle and the whole turret
  tilts for pitch. A capsule/oriented body and a gun-only pitch pivot remain future
  visual/physics debt; row 40 explicitly deferred them.
- **A2 scene-budget numbers no longer describe the app.** The 103-object / 13,344-triangle
  fixture measures `buildArenaScene` (16 showcase tanks), while the A4 playable scene
  measured **16 draw objects / 5,808 triangles / 17,432 vertices** and **31 renderer
  calls** in a headless 1920×937 probe. Keep the old pin as a ceiling, not an app claim.
- **B1c's cast is data-driven, but the mode dispatch is a threshold.** All four profiles
  pass through one `AIController`; the mode is selected from profile weights
  (`ambush-chokepoint > 0.5`, `breach-wall > 0.5`, `minRangeMetres > 0`) and profile
  fields. That keeps one core and four data profiles, but a future profile that mixes
  those goals below the thresholds falls through to vanguard. It is not a general
  planner and must not become per-character strategy classes.
- **B1c's signatures clear the 20 % bar against the field median, not against each
  other.** Final 200-seed round robin (1200 matches, 21 draws): wins vanguard **58.5 %**,
  sniper **55.7 %**, ambusher **50.0 %**, brute **32.3 %** (all inside 30–70 %); deltas
  from the field median are sniper engagement **+26.8 %**, vanguard speed **+75.6 %**,
  ambusher out-of-LOS **+32.4 %**, brute world destruction **+92.1 %**. But the brute's
  out-of-LOS share (**49.0 %**) is slightly above the ambusher's (**46.7 %**) because the
  breach detour is exposed; the ambusher is not the unique no-LOS leader. It still hides
  and passes its stated acceptance, but the metric separates it from the median, not
  from the brute. Brute's win rate is at the 30 % floor, and the round robin uses the
  same pinned short duel staging as B1b.
- **B2's per-team split hides a corner bias.** The 200-seed 4×4 table passes the
  per-team 15–35 % band (vanguard 28.0 %, sniper 20.5 %, ambusher 19.0 %, brute
  21.5 %) because the team-to-corner assignment rotates by seed. The corner-normalised
  table does **not** pass: **NW 39 %, NE 1 %, SE 26 %, SW 23 %**. `TEAM_ARENA` is
  validated as four-fold symmetric, so this is not a level-data asymmetry; it is the
  remaining AI/action/formation bias from the fixed east-facing pads and team order.
  It is recorded as debt, not averaged away.
- **B2's 4×4 batch is close to the cap, but not cap-dominated.** 200 matches: 24 cap
  hits (**12.0 %**), 22 draws, median 3836.5 ticks, max 18000. The team mode uses
  `aimErrorScale: 0.1`; the 1v1 profiles stay at 1. The 16-tank spectator frame
  measured **119 renderer draw calls** on the screenshot frame and **113** in the live
  overview (budget ≤ 200); the overview frame passes the look budget. The live
  16-tank overview measured **4.41 fps** in ANGLE SwiftShader at 1920×1080 (this host's
  only WebGL backend), a regression number, not a 60 fps claim.
- **The AI-level mirror is still owed.** The existing mirror pin is scripted at the
  simulation level (original team 0 wins at tick 7; mirrored team 1 wins at tick 7).
  An AI match is deterministic-chaotic under a mirror, so the fairness fix is measured
  and its staging coordinates are pinned, not proven by an AI-level mirror.
- **The AI-only fire interval is still single-player debt.** The 285-tick
  `AI_FIRE_INTERVAL_TICKS` remains separate from the global `RELOAD_TICKS=60`; before
  player-vs-AI ships it must become one rule. B1c deliberately did not fix it.
- **Perception is sampled at 10 cm.** It uses `isSolidAt` and not the shell resolver;
  this is a sightline, not a guarantee that a shell clears low cover. The vanguard
  deliberately aims at the turret centre and does not plan a shoot-over arc.
- **The top plan is a review surface, not a game camera.** Its orthographic camera,
  hidden tanks, transparent plan fills and white exit arrows are presentation only;
  `?pose=top` is not selectable as an interactive camera. The arrows are authored to
  read the A4 dogleg exits, not generated from arbitrary level data.
- **No browser-level input test.** Pointer/keyboard gathering is untested DOM glue; the
  pure `commandFromInput` mapping is pinned. A synthetic click/key browser test would
  need the Chrome lifecycle already owned by `shot.sh`.
- **The demo seeds one breach directly through `damageCell`/`damageBlock`.** That is a
  deterministic stage setup, not a shot; the shell/damage/win after it comes through the
  real `stepMatch`. Do not mistake the seeded breach for a simulated wall hit.
- **Regeneration displacement is still cell-grained.** A1 `stepWorld` displaces an
  occupant to a nearest free CELL, using cell occupancy, while tank bodies are circles.
  A pathological layout with a tank body overhanging an adjacent healing cell could
  therefore displace a tank into another body. Spawn and commanded movement are fully
  body-checked; displacement is the remaining edge to revisit if it appears.
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
- **The A2 showcase and gateway arches remain fixtures.** They are budget/review
  fixtures, not the app's level; A4 uses `ARENA` and the real A1 world, and the
  gateway arches are still presentation-only outside the final collision story.
