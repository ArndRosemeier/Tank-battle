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
