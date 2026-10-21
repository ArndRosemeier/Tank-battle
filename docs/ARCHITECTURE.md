# Architecture — the seam index

## 1 · Layer map

Dependencies point **downward only**; nothing below a layer may import from above it.

| Layer | Lives in | Owns |
| --- | --- | --- |
| **entry** | `src/main.ts` | The frame loop, canvas sizing, and the wiring of the error surface. The only file that calls `requestAnimationFrame`. |
| **entry · DOM** | `src/entry/dom.ts` | The one way to obtain a DOM node the app cannot run without, with the narrowed type. |
| **core** | `src/core/*.ts` | Pure simulation: no DOM, no time source, no globals. Takes numbers in, returns numbers out, so it tests in `node`. |
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
  gameplay yet (ledger row 2). Do not scope work from the visuals.

## 4 · Known debt

- **No game yet.** The skeleton proves the loop, the canvas, the error surface and the
  gate; the first playable slice's direction is the owner's open decision (ledger row
  2). Everything gameplay-shaped lands after it.
- **No publish script.** Publishing is deliberate once there is something to play
  (board row 2); `TANK_BATTLE_BASE` already carries the subpath for it.
- **No real-browser pin.** The suite runs in `node` against pure modules. A browser
  test means owning a headless-browser process *tree* (see [`TESTING.md`](TESTING.md));
  add it when a behaviour can only be proved in a browser.
