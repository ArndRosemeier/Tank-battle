# Design — Tank Battle

**Status:** discussion round 2. The concept and the round-1 answers are **decided**
(§3). §4 carries the tensions and gaps that block the first gameplay brief; §5 is the
package I would brief if the leans survive.

The owner's words are quoted verbatim. Anything marked *dispatcher* is a position
offered to be argued with, not a decision.

## 1 · The core idea (owner, verbatim, 2026-10-21)

> This should be a tank simulation in a tron like world. Neon glowing lines, simple
> geometry, you get the gist. Inside this design language, levels are allowed to be
> quite complex and interesting. I want to have a good destruction model that includes
> the world where this takes place. Single player for now and also an all AI player
> option (that you can use to tune strategies). I do not want just one AI strategy but
> several "characters".

## 2 · Round 1 answers (owner, verbatim)

1. **Projection:** "Full 3d, a TS web app."
2. **Destruction:** "I like your regeneration idea. Everything should be breakable,
   including the floor. A broken floor of course does not mean that tanks fall through.
   Debris blocks if big enough (needs to be destroyed then). Smaller debris gets shoved
   out of the way but can still influence trajectory. Make this physically sound
   (without investing too heavy in physics). AIs need to be smart enough to cope with
   changing terrain."
3. **Verbs:** "lets have just drive aim fire for now. At least for the first version.
   Characters do NOT collapse into difficult settings. Some could be daring and hunt no
   matter what, others can be snipers and others can be ambushers. And others can be
   brutes who break all walls to get to you. Lots of possibilities."
4. **Lethality:** "Lets have a bit more HPs and only 1 tank kind at the start (keep it
   simple). 3 hits kill. Lets have some hide deterrant in it. When you are damaged,
   damage worsens over time... slowly, but that makes stalling a bad option."
5. **Match structure:** "For the first version just deathmatches to tune everything.
   Later maybe a campaign."
6. **AI cast:** "profiles over one core sounds better, but that core needs to be able
   to pursue different instrumental goals then."
7. **Levels:** "Lets start with just one well authored level before wasting resources
   before we know what works."

## 3 · Decided, and what it forces

**Decided:** 3D presentation in a TypeScript web app · a fully breakable world
(including the floor) that **regenerates** · two debris tiers (big blocks, small shards
that can be shoved and can influence trajectory) · physically plausible without a
heavy physics engine · AI that copes with terrain changing under it · **drive / aim /
fire only** for v1 · one tank kind, **3 HP** · damage worsens over time while damaged
· deathmatch only · **one AI core with per-character profiles that pursue different
instrumental goals** · **one authored level** before any more content.

**Derived requirements** (dispatcher — consequences, not new ideas):

1. **The renderer is not the truth.** three.js (house version: `three@0.180.0`, as
   pinned by VectorRunner) owns pixels; `src/core` owns state and must import nothing
   from it. Otherwise the headless batch and the tests cannot exist.
2. **Determinism.** Seeded RNG only in `src/core` (no `Math.random`), fixed tick, AI
   decisions on fixed ticks. All-AI tuning is meaningless without it.
3. **The world is state, not scenery.** Every breakable cell has material, HP, debris
   output and a regen timer — one model, one seam, whether it is a wall or the floor.
4. **Terrain change invalidates navigation.** Any panel change dirties the nav grid;
   AIs re-path off that signal, never from a cached path.
5. **Shot feasibility is not "line of sight".** Debris, big blocks and regenerating
   cells all sit between the muzzle and the target; the AI must test the actual path.
6. **Every match must terminate by construction** — a tick cap — because the batch
   rig runs hundreds of unattended matches.
7. **Characters are data.** One core; profiles are typed data validated at load
   (AGENTS.md rule 3), so a new character cannot mean duplicated decision code.

## 4 · Round 2 — three tensions and four gaps

### T1 · The damage clock vs. the ambusher

"Damage worsens over time" punishes hiding. But an ambusher's whole strategy is
waiting. As stated, the two rules make the ambusher unplayable — the archetype you
asked for would bleed out while doing its job.

| Option | Effect |
| --- | --- |
| (a) Bleed always ticks while damaged | Pure attrition; ambush and sniping are self-punishing |
| (b) Bleed ticks, but **landing a hit suspends it** for a few seconds | Aggression is the antidote; ambush stays viable *if it strikes* |
| (c) Bleed pauses while the enemy has line of sight to you | Rewards hiding — the opposite of the intent |
| (d) No bleed, a match timer instead | Removes the pressure the owner asked for |

*Lean:* **(b)**, bleed floor at 1 HP (never kills by itself). A clock that only stops
while you are doing damage is legible to an AI ("close and hit") and keeps the stall
deterrent.

### T2 · Breaching vs. regeneration (the brute's viability)

A brute breaks walls to reach you. If walls regrow faster than a reload, the brute's
whole strategy is futile by construction.

| Option | Effect |
| --- | --- |
| (a) Regen slower than breach+passage; fixed numbers in one place | Brute viable; the arena visibly heals between engagements |
| (b) Regen repairs a cell only partway | Holes shrink, routes stay open — muddy for pathing |
| (c) Regen paused while any tank is within N metres | Fights "keep the route open" locally; odd globally |

*Lean:* **(a)**, with the regen delay/rate a **named constant** and a pin that "a
breach stays open long enough to drive through". The AI must be told the rate as a rule
of the world, not left to discover it.

### T3 · Debris that deflects vs. an AI that plans

"Smaller debris can still influence trajectory" is a lovely detail and a measurement
problem: if a shard deflects a shell unpredictably, every AI measurement becomes noise
and no character can be tuned.

| Option | Effect |
| --- | --- |
| (a) Shards **absorb** the shell; no deflection | Honest and plan-able; loses the detail |
| (b) Shards deflect at a **fixed, deterministic angle** (a mirror facet) | Shot geometry becomes learnable — and very Tron |
| (c) Shards deflect with seeded jitter | Realistic, but turns aim into a coin flip |

*Lean:* **(b)** — deterministic and therefore teachable, with the angle part of the
shard's definition. (c) is rejected outright: it would make the batch rig unable to
answer "is this character better?".

### G1 · Verticality — 3D means *how much* 3D?

Flat plane (one floor, walls rise from it) · ramps and upper levels · true multi-floor.
*Lean:* **flat plane** for v1, with a 3D camera, height, and glow selling the depth.
Multi-level navigation multiplies pathfinding, line-of-sight and destruction work
before a single character has been tuned.

### G2 · What does a broken floor actually do?

Tanks do not fall through — so what changes? *Options:* purely visual scarring ·
traction changes · holes swallow shards · a shell that hits a hole is wasted.
*Lean:* **floor cells are damage state only in v1** (visual, and they collect shards),
no traversal effect. "Everything breakable" is then honest without inventing a rule.

### G3 · Deathmatch scale

1v1 only · N tanks in one arena (3–4) · both. *Lean:* **the simulation supports N
(2–4); v1 is tuned 1v1 and 4-way**. Character comparison needs free-for-alls, and
target selection is a different problem at four.

### G4 · How a match ends, and the debris budget

Kill only · kill or tick cap · tick cap with a winner by HP. Plus: how many shards may
exist at once, and do they persist? *Lean:* **kill, plus a tick cap with the win going
to more HP**, and a **hard shard cap** (oldest despawn) declared as a rule of the
world. Both are needed for the batch rig to produce comparable numbers.

## 5 · The package I would brief (if the leans survive)

- **World:** flat glowing grid, 2 m cells, three materials (floor / wall / pillar), every
  cell breakable, HP and a regen timer per cell. Simulation state is 2.5D — position,
  hull yaw, turret yaw, HP — so the AI never solves a 3D problem.
- **Destruction:** a shell kills a cell and produces either one **big block** (static,
  blocks movement and shots, must be broken) or a few **shards** (pushable, deterministic
  deflection, one hit and they shatter). Hard cap on live shards.
- **Tanks:** one kind, 3 HP, damage clock with a floor, per the T1 ruling.
- **AI:** one core; shared instrumental goals (*gain line of sight · hold cover · close
  to weapon range · flank · breach · hold an ambush point*); profiles weight and gate
  those goals. Hunter / sniper / ambusher / brute are four profiles, not four engines.
- **Rig:** headless batch over the pure core — N seeded matches, win rate, accuracy,
  time-to-kill — plus the live all-AI view.
- **First slice:** one authored level, the player, and **one** profile (the hunter: no
  pathing subtleties), destruction on, batch green. Sniper, ambusher and brute follow as
  profiles once the world and the rig are trustworthy.

## 6 · Non-goals for v1

Multiplayer/network · multiple tank kinds · campaign · level editor · audio ·
progression · extra verbs (mines, barriers, ammo types).
