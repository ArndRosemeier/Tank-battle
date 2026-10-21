# Design — Tank Battle

**Status:** round 2 ruled. The concept, the round-1 answers and the round-2 rulings
are **decided** (§3–§4). Three questions remain for the owner (§6); everything they do
not settle is taken as a default (§7) and can be vetoed. §8 is the slice roadmap.

The owner's words are quoted verbatim, including typos — the words are what stop a
later slate from re-litigating a decision.

## 1 · The core idea (owner, 2026-10-21)

> This should be a tank simulation in a tron like world. Neon glowing lines, simple
> geometry, you get the gist. Inside this design language, levels are allowed to be
> quite complex and interesting. I want to have a good destruction model that includes
> the world where this takes place. Single player for now and also an all AI player
> option (that you can use to tune strategies). I do not want just one AI strategy but
> several "characters".

## 2 · Round 1 answers (owner, verbatim)

1. "Full 3d, a TS web app."
2. "I like your regeneration idea. Everything should be breakable, including the floor.
   A broken floor of course does not mean that tanks fall through. Debris blocks if big
   enough (needs to be destroyed then). Smaller debris gets shoved out of the way but
   can still influence trajectory. Make this physically sound (without investing too
   heavy in physics). AIs need to be smart enough to cope with changing terrain."
3. "lets have just drive aim fire for now. At least for the first version. Characters
   do NOT collapse into difficult settings. Some could be daring and hunt no matter
   what, others can be snipers and others can be ambushers. And others can be brutes who
   break all walls to get to you. Lots of possibilities."
4. "Lets have a bit more HPs and only 1 tank kind at the start (keep it simple). 3 hits
   kill. Lets have some hide deterrant in it. When you are damaged, damage worsens over
   time... slowly, but that makes stalling a bad option."
5. "For the first version just deathmatches to tune everything. Later maybe a campaign."
6. "profiles over one core sounds better, but that core needs to be able to pursue
   different instrumental goals then."
7. "Lets start with just one well authored level before wasting resources before we know
   what works."

## 3 · Round 2 rulings (owner, verbatim)

- **T1 damage clock:** "Not quiet. At the start that ambusher is healthy and wont bleed.
  But yea, that strategy needs to change when damaged. Can still be more carefull than
  others, but just hiding is not an option anymore. Don't take my example strategies as
  work orders, they were examples. A real strategy should be a mix."
  → The clock runs **only while damaged**. A healthy tank may wait as long as it likes.
  → The four archetypes are **examples, not a spec**: a character is a *mix* of
  behaviours (e.g. hunt 0.6 / ambush 0.3 / snipe 0.1), not one label.
- **T2 regeneration:** "Yea, regen should be pretty slow in general. Its not satisfying
  to break stuff only to see it rise again immediately" → slow enough that a breach is
  worth making and visible for a while.
- **T3 shard deflection:** "I take your version" → **deterministic mirror-angle**
  deflection; no jitter, ever.
- **G1 3D:** "Standard 3rd person camera, mousewheel can zoom into 1st person. This
  should be FULLY 3D. Nothing here is 2D. You seem to regress that way."
  → Full 3D world, geometry, camera and collision. The earlier "2.5D simulation" framing
  is withdrawn; the correction is recorded in `docs/BOARD.md` traps.
- **G2 floor holes:** "The bedrock below the floor is endlessly deep. So, breaking a
  floor just carves a hole (that also self heals). The real question is what happens to
  a tank in an area that self heals? I vote that it gets shoved away." → bedrock is
  bottomless and not part of the model; a hole is a healed-able wound in the floor; **an
  entity standing where a cell regenerates is displaced**.
- **G3 teams:** "Team vs. Team vs. Team... up to 4 teams and each team can have up to 4
  tanks. AI teams kill each other just like they kill the player team." → **≤4 teams ×
  ≤4 tanks = 16 tanks**; every team is an enemy of every other; AI fights AI.
- **G4 win condition:** "Last surviving team wins. Optional time threshold and yea most
  HP wins then." → last team standing; if a time threshold is set, the team with most HP
  wins at it.

- **Q1 damage clock outcome:** "Kill it. No mercy if you are just trying to hide."
  → the clock is **lethal**. Hiding while wounded loses the tank, not merely tempo; a
  healthy tank may still wait as long as it likes.
- **Q2 friendly fire:** "Yea... no friendly fire. Immunity to own team."
  → a team's tanks cannot damage each other.
- **Q3 player squadmates:** "Yea, player can have 3 squad mates."
  → the player's team is the player plus up to 3 AI tanks using the same profiles.
- **Multiplayer is a planned destination (standing requirement):** "This will start
  single player, but if its good i would love to expand this to multiplayer, so plan
  accordingly please." → not built in v1, but the architecture must not have to be
  rebuilt for it: see §5 items 9–12.

## 4 · Consolidated decision list

**The world.** Fully 3D. Flat ground plane over bottomless bedrock; everything above it
is buildable and breakable — floor, walls, pillars. Every cell has a material, an HP
value, a debris output and a **slow** regeneration timer. A hole in the floor is a hole,
not a pit: nothing falls in, and it heals. A tank (or shard) in a cell that regenerates
is **shoved out**.

**Destruction.** A shell destroys a cell and produces debris: a **big block** (static,
blocks movement and fire, has to be broken) or **shards** (shoved by tanks, deflect
shells at a **fixed mirror angle**, shatter on the next hit). Physically plausible,
no rigid-body engine.

**The tanks.** One kind in v1. Drive (hull), aim (turret, mouse), fire. 3 HP, 3 hits
kill. Damage clock while damaged: it wears down over time and **kills**. Hiding while
wounded is a losing trade with no mercy; a tank at full health may wait as long as it
likes. No extra verbs.

**The match.** Deathmatch, teams: ≤4 teams × ≤4 tanks, everyone hostile to everyone not
on their team. Last team standing wins; optional time threshold, then most HP wins.
**No friendly fire** — teammates are immune to each other — and the player's team is the
player plus up to 3 AI squadmates.

**The AI.** One core; per-character **data profiles** that weight a shared set of
**instrumental goals** (*gain line of sight · hold cover · close to weapon range ·
flank · breach · hold an ambush point*). A character is a mix, not an archetype. AIs
must cope with terrain that changes under them and with teams.

**The rig.** All-AI matches are a first-class mode, run both live and **headless** over
the pure core: N seeded matches → win rate, accuracy, time-to-kill. Determinism is a
requirement, not a convenience.

**Content.** One authored level first. No generator, no campaign, until the world and
the rig are trusted.

## 5 · Derived requirements (dispatcher)

1. **three.js owns pixels; `src/core` owns truth.** The core imports nothing from the
   renderer, so the same simulation runs headless in `node`. `three@0.180.0` is the
   house pin (VectorRunner).
2. **Determinism:** seeded RNG only in the core, fixed tick, AI decisions on fixed ticks,
   and no renderer-dependent input inside a step.
3. **Height-aware everything:** line of sight, shell paths and cover all use the 3D cell
   volume — a low wall must not stop a high shot. The cell model carries height from the
   first commit even if level one uses two heights.
4. **Terrain change invalidates navigation:** any cell change dirties the nav grid; AI
   paths are re-derived, never cached across a breach or a heal.
5. **Regeneration displacement is a rule with one implementation:** a cell that heals
   under an entity pushes it to the nearest free cell, deterministically; a big block
   occupying a cell **blocks that cell's regeneration** until it is destroyed; shards in
   a healing cell are absorbed.
6. **16 tanks must hold 60 Hz headless.** Measured early, not at the end; the batch rig
   runs hundreds of matches.
7. **Matches terminate by construction** — tick cap — because batch runs are unattended.
8. **Profiles are typed data, validated at load** (AGENTS.md rule 3), so a new character
   cannot become duplicated decision code.
9. **The simulation is tick-based and input-driven, never clock-driven.** Time is ticks;
   a step consumes a *command* per tank (drive vector, turret angle, fire) and returns
   state deltas. No `performance.now()`, no `Date`, no `requestAnimationFrame` inside the
   core — the browser frame only decides how many ticks are owed.
10. **Controllers are pluggable, and the core has no `isPlayer` branch.** A tank's
   control arrives from a *controller*: local human, AI, or (later) remote. The all-AI
   mode and the future multiplayer client are the same seam.
11. **The headless runner is the future authoritative server.** It already runs the whole
   simulation with no renderer and seeded RNG; multiplayer is then a transport around
   commands and state, not a second simulation. This is why the renderer may never own
   truth (item 1) and why determinism (item 2) is non-negotiable.
12. **Nothing in the core may depend on a single local input device, a window, or a
   pause.** Pausing is a controller policy, not a property of the world.

## 6 · Open questions

**None.** Q1–Q3 were ruled on 2026-10-21 (ledger rows 22–24). The remaining numbers are
tuning, not design, and live in §7 as vetoable defaults.

## 7 · Defaults (vetoable, recorded as decisions unless overruled)

- **Shell:** fast straight-line, no gravity, no arc; deterministic mirror deflection on
  shards; lifetime bounded by range.
- **Wall heights:** level data gives height per material; level one uses one tall wall
  height and one low barrier height, so 3D cover is proved rather than assumed.
- **Regen timing:** one cell heals a single frame of damage every ~20 s (a named
  constant, tuned); debris does not heal.
- **Shard cap:** 64 live shards, oldest despawns; big blocks persist until destroyed.
- **Time threshold:** on, 5 minutes; winner = total team HP; tie → most tanks alive;
  still tied → draw. With the clock lethal, the threshold now exists for *healthy*
  stalemates only.
- **Teammate blocking:** a shell stops at a teammate without damaging it. Q2 immunity is
  about damage; this is about bodies, so a squadmate can body-block a line of fire.
- **Visibility:** full — no fog of war in v1. Tron arenas glow.
- **Tank stats:** identical for all teams in v1 (one kind).
- **Camera:** 3rd person orbit-follow, mouse wheel to 1st person; turret aims at the
  cursor/depth ray.

## 8 · Slice roadmap

- **A1 — the world model** (in flight). Cells, materials, height, destruction, two
  debris tiers, slow regen + displacement, deterministic state hash. No renderer.
- **A2 — the render foundation, and the look.** three.js scene over A1 data: emissive
  edge material system, bloom/post pipeline, luminous grid floor, camera (3rd person
  with 1st-person zoom), placeholder tank and block. **This slice is where "hero
  quality" is judged, before any gameplay rides on it.**
- **A3 — drive / aim / fire.** Tank movement, turret, shells, impact and destruction
  VFX, debris motion, regeneration animation, 3 HP and the lethal clock with HUD feedback.
- **A4 — level data and the one authored level.**
- **A5 — the HUD/UI pass.** The TRON interface: segmented health, reticle, team panels,
  kill feed, menus. No default widgets anywhere.
- **B — one character, then the rig.** Nav with dirty-cell invalidation, 3D line of
  sight and shot feasibility, one profile, headless batch of 100 seeded matches; live
  all-AI spectate.
- **C — the cast and the teams.** Profiles as validated data, behaviour mixes, teams
  ≤4×≤4, no friendly fire, win conditions.

The headless runner built in B is the **future game server** (§5.11): a multiplayer
transport wraps commands and state, it does not re-implement the world.

**On schedule honesty:** the hero bar moves the first genuinely good-looking build to
after A2 and the readable interface to after A5. Until then the thing on screen is a
tech demo, and it will be reported as one.

## 9 · Presentation — the hero-quality bar

**Owner's bar, verbatim (2026-10-21):** "Despite the simple graphics, i want to have
absolute hero quality here. Things need to GLOW and POP with a UI that screams in
TRON-Style and has absolutely nothing to do with spread sheet buttons."

This is a **standing requirement**, not a task: every presentation slice is judged
against it, and it outranks "it renders".

- **Palette.** Black field, emissive hues, nothing in between. Team colours: cyan
  `#00e5ff`, orange `#ff7a00`, magenta `#ff2fd6`, lime `#b6ff00`; white only for the
  hottest cores. No mid-greys and no default UI blue.
- **Surface rule — NO WORLD TEXTURES (owner ruling, 2026-10-21, with a Tron reference
  image).** "Tron style means NO TEXTURES AT ALL for the world. Just triangles that
  contain nothing and still are not see through with neon lines. or maybe a little
  texture, but it needs to be almost unnoticable against the lines." Concretely:
  - **No image files on any world surface** — no albedo, normal, roughness or decal maps.
    If variation is needed it is procedural in the shader and barely perceptible; the
    reference image's own surfaces are flat and untextured.
  - **Opaque, near-black fills.** World geometry is never see-through (owner: "still are
    not see through"); only effects (muzzle flash, impact, shields) may blend.
  - **Identity comes from edges.** Emissive edge lines at screen-space-constant weight,
    carried by bloom. If a surface reads by its fill rather than its outline, it is
    off-style. This is why every visible edge needs a line, including concave ones.
  - **One material seam.** A single `NeonSurface` factory (dark unlit fill + edge lines +
    an optional faint fresnel rim, since an unlit near-black fill otherwise disappears
    into the void). No ad-hoc `MeshStandardMaterial` appearing in a later slice.
  - **The floor is line geometry or a shader grid, never a texture;** the reference's
    hexagonal pattern is geometry, and cells must map to destructible panels.
  - The reference image lives at `.probe-assets/reference-tron-look.png` (gitignored,
    third-party reference, never shipped).
- **Post pipeline.** ACES tone mapping, strong UnrealBloom (threshold/strength/radius
  tuned once and pinned in one config module), subtle vignette; DPR capped at 2. Bloom
  is part of the look, so it is part of the performance budget.
- **World legibility.** Luminous grid floor; damage reads as fractured edges; a breaching
  shell flashes the cell it kills; regeneration is **lines redrawing** (a grow-in over
  the regen delay, so the slow heal is visible and tense); shards dissolve in a flash;
  big blocks are glowing cages.
- **HUD.** Drawn by **one** UI module in TRON language: angular frames, corner brackets,
  segmented health, a charge/heat ring around the reticle, team panels, animated wipes.
  Diegetic extras (team brackets, target reticles) live in the 3D layer. **No default
  HTML controls, ever** — every control is drawn in this style; raw `<button>`/`<input>`
  in the app shell is forbidden and a source pin enforces it.
- **Performance budget.** 60 fps at 1080p with 16 tanks and live debris on this machine.
  Measured, not assumed; a quality setting may scale bloom, never correctness.
- **Assets.** One bundled OFL techno font (Orbitron or Rajdhani); no runtime CDN.
- **Enforcement.** The renderer stays truth-free (§5.1) and the HUD reads core state
  only — no duplicated game state. Each presentation slice is reviewed as screenshots
  by the owner before it is called done; my report carries the images, not adjectives.

## 10 · Assets, sound and provenance

**Owner (2026-10-21):** "You got access to openrouter. You may use this to create
graphics, a soundtrack or even game sounds." The capability is the host `openrouter`
skill: the `or` CLI on the **creative** key (never printed, never copied into the repo).

**What we generate** — the things procedural geometry cannot give us:

- **Music.** One or two loopable themes (Google Lyria). The game's tension bed, not a
  licensed track.
- **SFX.** Cannon fire, shell impact, panel destruction, regeneration, engine hover, UI
  blips (ByteDance Seed Audio; prompts must start with `The sound of...` for an effect
  rather than speech).
- **2D art where a texture beats a shader:** glow sprites, menu backdrops, the wordmark.

**What we do NOT generate:** the arena's look (edge-lit procedural geometry, §9), the
HUD layout (drawn by our own UI module), and anything with readable text baked in — an
image model's lettering is not a UI.

**Provenance is mandatory.** Every generated asset is committed with an entry in
`assets/manifest.json`: file path, sha256, model id, prompt, and date. The manifest is
how an asset is regenerated or replaced later, and **a pin fails the suite when a file
in `assets/` is missing from the manifest or a manifest entry is missing its file**.
No orphan binaries, no undocumented magic.

**Style contract.** An asset that fights the edge-lit look is rejected however good it
is in isolation. The renderer stays truth-free; sound never gates simulation.

**Integration.** One audio seam (a small mixer module in the presentation layer) owns
playback, volume and ducking; assets are preloaded, bundled, and served locally — no
runtime CDN, no autoplay surprises (the audio context starts on first input, as every
browser requires).

**Cost discipline.** The creative key is metered. Probes are generated in batches, kept
small, and never re-rolled for taste without a reason; anything shipped has already been
approved by ear or eye.

## 11 · Non-goals for v1

**Network transport and matchmaking** in v1 — the architecture is built for them
(§5.9–12), but nothing is wired over a socket yet · multiple tank kinds · campaign ·
level generator/editor · audio · progression · extra verbs (mines, barriers, ammo types) ·
fog of war.
