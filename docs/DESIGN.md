# Design — Tank Battle

**Status:** discussion in progress. Nothing here is a build order until §3 is
answered. The owner's words are quoted verbatim; anything marked *dispatcher* is a
position offered to be argued with, not a decision.

## 1 · The core idea (owner, verbatim, 2026-10-21)

> This should be a tank simulation in a tron like world. Neon glowing lines, simple
> geometry, you get the gist. Inside this design language, levels are allowed to be
> quite complex and interesting. I want to have a good destruction model that includes
> the world where this takes place. Single player for now and also an all AI player
> option (that you can use to tune strategies). I do not want just one AI strategy but
> several "characters".

**What that settles** (read as constraints, not suggestions):

- **Aesthetic:** Tron — neon lines, darkness, simple geometry. Complexity comes from
  *arrangement*, not from asset detail.
- **The world is destructible**, and destruction is part of the simulation model, not a
  particle effect bolted on.
- **Single player is the product.** All-AI is an **instrument** — a tuning rig.
- **A cast, not a difficulty slider:** several AI characters.
- **It is called a simulation.** The world model is expected to be honest: consistent
  collision, consistent destruction, consistent line of sight.

## 2 · Derived requirements (dispatcher, to be confirmed)

1. **Determinism.** If all-AI exists to tune strategies, two runs of the same match
   must be comparable: seeded RNG (never `Math.random` in `src/core/`), fixed timestep,
   AI decisions on fixed ticks. Without it, "character A beats character B" is noise.
2. **One AI core, many profiles.** Several characters must mean several *profiles*
   (weights over shared behaviours), not several copies of decision code — a copy is
   invisible when it is born (AGENTS.md rule 4/5).
3. **A headless batch runner.** "Tune strategies" means numbers: N seeded matches, win
   rate, accuracy, time-to-kill, damage. That runs in `node` over the pure core, no
   browser.
4. **Destruction must be deterministic too.** Debris is visual only; it must never
   change collision or AI outcomes, or every measurement above becomes unstable.

## 3 · Open questions (these block the first gameplay brief)

| # | Question | Options | Dispatcher's lean |
| ---: | --- | --- | --- |
| 1 | **Projection:** how is the Tron world shown? | 2D top-down · 2D with a tilted/parallax grid · full 3D (three.js) | 2D top-down with heavy glow and a parallax grid. 3D buys atmosphere but costs the destruction model and behaviour readability — the two things asked for. |
| 2 | **What does destruction do?** | (a) breachable panels that change routes · (b) cover-only scarring · (c) structural collapse (physics) · (d) floor/hazards | (a) permanent within a match, panels on a grid, debris visual only, **no physics**. Topology change is the tactical depth; regeneration is a per-level twist worth keeping as an option. |
| 3 | **The verbs:** what can a tank do besides drive and shoot? | ricochet shells · independent turret · energy-barrier laying (light-cycle heritage) · ammo types · dash/boost · mines | ricochet + independent turret + destructible panels as the core trio. That is the minimum for "characters" to differ in *how* they fight rather than only in aggression. |
| 4 | **Lethality:** one hit or armour? | one-hit kill · fixed HP · per-character HP | per-character lethality — light tanks die in one, heavies take more. It makes "heavy" a real character axis and keeps duels short. |
| 5 | **Single-player shape:** | roster of duels (one character per arena) · arena campaign with objectives · survival waves | roster of duels: cheapest on one simulation, and it turns each character into a boss instead of a difficulty setting. |
| 6 | **The cast, and how it is tuned:** characters as data profiles or as code, and what does "tuning" produce? | profiles over one core · separate strategy code · headless batch with stats and seed replays | profiles over one core + a headless batch from day one. Tuning needs numbers, not vibes. |
| 7 | **Levels:** authored or generated, and what is in one? | small hand-authored format · generator · both | a compact text/JSON arena format and a handful of hand-made arenas. Complexity comes from deliberate panel patterns, not from a generator that cannot be tuned yet. |

Smaller ones, decidable in a line each: match length · full visibility or fog ·
sound or silence · HUD style (wireframe vs. minimal) · can the player also watch an
all-AI match live, not only read stats.

## 4 · Provisional first slice (only if the leans above survive)

One arena of destructible panels · a player tank and one AI character · ricochet
shells · seeded deterministic match · a headless 100-seed batch that prints win rate
and accuracy. That slice exercises the destruction model, the AI core, the determinism
and the tuning loop at once, and it is the smallest thing that proves the direction.

## 5 · Non-goals for now

Multiplayer/network · 3D if 2D is chosen · campaign structure · level editor · audio ·
progression/unlocks. Each is a later decision, not an omission.
