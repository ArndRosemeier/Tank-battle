# The decision ledger

**Append-only.** A decision is history; history never rots. Never edit another
landing's row — if a decision is superseded, add a new row that says so and points
at the old one.

**This is not a behaviour doc.** Behaviour lives in a test (the test **is** the
statement); this file holds the decision, the reason, the evidence and the pointer.

## The rule for a row

1. **Quote the owner verbatim** when the decision is theirs.
2. **Name the evidence** — the file:line, the measurement, the incident.
3. **Say what was rejected**, and why.
4. **Say what is still unproven.**

## Row numbers are assigned by the dispatcher

The dispatcher reads this file at brief time and puts the row number **in the brief**.
A writer that still hits a docs conflict renumbers its OWN row only.

---

## Ledger

| n | statement | files | why | status |
| ---: | --- | --- | --- | --- |
| 1 | **The stack is Vite + TypeScript + HTML canvas + Vitest + pnpm, with no game engine.** Owner's ask was the project's existence only — verbatim: *"please be my chief of staff for this yet empty project."* Evidence: the house convention is uniform across the sibling game projects (measured 2026-10-21: `Tetris/package.json`, `BlasterMaster/package.json` — `vite` + `tsc --noEmit && vite build` + `vitest run`). Rejected: three.js/3D (VectorRunner's stack) and an engine such as Phaser — both add a dependency and an asset pipeline before there is a game to justify them. Unproven: whether the owner wants 2D or 3D at all. | `package.json`, `vite.config.ts`, `tsconfig.json` | every project needs a buildable shell before it needs a design | LANDED (bootstrap) |
| 2 | **No gameplay is written until the owner picks the first playable slice.** The day-1 skeleton is deliberately inert: canvas, loop, error surface, gate. Rejected: guessing a mode (deathmatch vs. wave defence vs. NES-style) — a wrong guess bakes the wrong simulation core, and the simulation core is the most expensive thing to replace. Unproven: the owner's intent behind the name "Tank battle". | `src/main.ts`, `docs/BOARD.md` (open question 1) | the mechanism must not pre-empt the product decision | OPEN |
| 3 | **The remote is the owner's existing, empty `ArndRosemeier/Tank-battle`** (created 2026-10-21T21:11:49Z, size 0, default branch `main`). Local directory keeps its name with the space. Rejected: creating `TankBattle` or `tank-battle` — the owner's repo already exists; creating a second one would split the project. Unproven: nothing. | `.git/config` | the reconciler needs a remote that is the owner's | LANDED (bootstrap) |
| 4 | **The fixed-step accumulator compares with a documented 1e-9 tolerance.** Evidence: measured red this landing — a 0.25 s frame owed 25 slices of 10 ms and produced 24 (`src/core/timestep.ts:34`). Rejected: weakening the pin to 24 — it would hide a real slow-clock bug at some frame rates only. Rejected: integer millisecond accumulation — it moves the same rounding to every frame instead of one comparison. Unproven: whether 1e-9 is right for very long sessions; the accumulator is drained every step, so drift cannot accumulate. | `src/core/timestep.ts`, `src/core/timestep.test.ts` | a clock that is silently slow is undebuggable | LANDED (bootstrap) |
| 5 | **The gate's cheap tier runs the build, not only the typecheck.** Evidence: the scaffold's default was `npm run typecheck` (`scripts/gate.sh:39` before the change), while `docs/GATE.md` requires the blocking tier to run what can break a deploy — and the deploy is `tsc --noEmit && vite build`. Rejected: leaving the scaffold default — a build-config error would pass the blocking tier. | `scripts/gate.sh:39` | "it typechecks" is not "it builds" | LANDED (bootstrap) |
