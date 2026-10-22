# Tank Battle

A deterministic 3D browser tank battle with destructible terrain, AI opponents, four-team combat and spectator mode.

[Play the game](https://apps.futuremagic.de/tank-battle/)

## Local development

Install Node.js 24 and pnpm 11.26.0, then:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm build` and `pnpm test`. The project's full verification gate is `bash scripts/gate.sh` (use Git Bash on Windows).

## Code organization

- `src/core` is deterministic, renderer-independent simulation and AI.
- `src/game` owns sessions, inputs and levels.
- `src/render` contains Three.js visuals.
- `src/entry` provides audio, UI, and the title screen.

Read `AGENTS.md`, `docs/CROSS-TOOL.md` and `docs/ARCHITECTURE.md` before editing. Use focused regression tests and feature branches.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Arnd Rosemeier.
