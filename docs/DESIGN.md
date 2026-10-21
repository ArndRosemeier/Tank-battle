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
kill. Damage clock while damaged: wears down over time so that hiding *while wounded* is
a losing trade; a healthy tank may wait. No extra verbs.

**The match.** Deathmatch, teams: ≤4 teams × ≤4 tanks, everyone hostile to everyone not
on their team. Last team standing wins; optional time threshold, then most HP wins.

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

## 6 · Still open — owner's word needed

| # | Question | Options | Lean |
| ---: | --- | --- | --- |
| Q1 | When the damage clock runs, does it **kill** or **floor at 1 HP**? | kills · floors at 1 | floors at 1 — a wounded hider then loses on HP at the threshold instead of being deleted passively. With a floor, the time threshold should be **on by default** or two wounded tanks can stall. |
| Q2 | **Friendly fire** inside a team? | no FF, and teammates physically block shots · no FF and shots pass through teammates · full friendly fire | block-but-harmless: positioning matters, no accidental team-wipes, no shots phasing through bodies. |
| Q3 | Does the **player get AI squadmates** (up to 3), or is the player team always one tank? | solo vs up to 4×4 AI · player + AI squadmates | AI squadmates, using the same profiles — otherwise a 4-team world is a spectator sport. |

## 7 · Defaults (vetoable, recorded as decisions unless overruled)

- **Shell:** fast straight-line, no gravity, no arc; deterministic mirror deflection on
  shards; lifetime bounded by range.
- **Wall heights:** level data gives height per material; level one uses one tall wall
  height and one low barrier height, so 3D cover is proved rather than assumed.
- **Regen timing:** one cell heals a single frame of damage every ~20 s (a named
  constant, tuned); debris does not heal.
- **Shard cap:** 64 live shards, oldest despawns; big blocks persist until destroyed.
- **Time threshold:** on, 5 minutes; winner = total team HP; tie → most tanks alive;
  still tied → draw.
- **Visibility:** full — no fog of war in v1. Tron arenas glow.
- **Tank stats:** identical for all teams in v1 (one kind).
- **Camera:** 3rd person orbit-follow, mouse wheel to 1st person; turret aims at the
  cursor/depth ray.

## 8 · Slice roadmap

- **Slice A — the world fights back.** Level data → 3D cells; three.js scene; drive/aim/
  fire; shells; destruction; debris tiers; slow regen + displacement; 3 HP and the
  damage clock; one authored level. **No AI yet** (a static target drone may be used to
  prove hits). Pins: cell damage/debris/regen, displacement rule, deterministic seeded
  run, batch of one scripted duel.
- **Slice B — one character, then the rig.** Nav grid with dirty-cell invalidation, 3D
  line of sight and shot feasibility, one profile (a hunt-heavy mix), headless batch of
  100 seeded matches with win rate and accuracy; live all-AI spectate.
- **Slice C — the cast and the teams.** Profiles as data + registry; sniper/ambusher/
  brute-*mixes*; teams ≤4×≤4 with target selection and no-FF blocking; team win
  conditions and the time threshold.

## 9 · Non-goals for v1

Multiplayer/network · multiple tank kinds · campaign · level generator/editor · audio ·
progression · extra verbs (mines, barriers, ammo types) · fog of war.
