import { describe, expect, it } from 'vitest';
import { runTeamBatch } from '../../core/ai.ts';
import { findPath } from '../../core/ai/navigation.ts';
import { collapseTerrain, createWorld, hashState, MATERIAL_CRYSTAL } from '../../core/world.ts';
import { arenaTeamSetup } from '../aiBatch.ts';
import { TeamSession } from '../teamSession.ts';
import { SpectatorSession } from '../spectator.ts';
import {
  DEFAULT_MATCH_SETUP,
  arenaChoiceFromQuery,
  matchSetupQuery,
  parseArenaSeedText,
  stepArenaSize,
  validateMatchSetup,
} from '../matchSetup.ts';
import { resolveArena } from './catalog.ts';
import { ARENA_SIZES, generateArena, MAX_ARENA_SEED } from './generator.ts';
import { validateLevel } from './format.ts';

describe('the procedural arena generator', () => {
  it('is a pure function of seed and size, byte for byte', () => {
    const a = generateArena(4242, 'medium');
    const b = generateArena(4242, 'medium');
    expect(a.level).not.toBe(b.level);
    expect(Buffer.from(a.level.terrain.density).equals(Buffer.from(b.level.terrain.density))).toBe(true);
    expect(Buffer.from(a.level.terrain.material).equals(Buffer.from(b.level.terrain.material))).toBe(true);
    expect(a.level.spawns).toEqual(b.level.spawns);
    expect(a.level.name).toBe(b.level.name);
  });

  it('pins the bytes of known seeds, so a change on any host or engine shows up', () => {
    // Online play rebuilds the arena on every client from the seed alone. If one of
    // these hashes moves, generated arenas changed: bump them only on purpose.
    const pinned = Object.fromEntries(
      ([[1, 'small'], [4242, 'medium'], [999_999, 'large']] as const).map(([seed, size]) => [
        `${seed}:${size}`,
        hashState(createWorld(generateArena(seed, size).level.terrain)),
      ]),
    );
    expect(pinned).toMatchInlineSnapshot(`
      {
        "1:small": "b97c6328",
        "4242:medium": "5f563dba",
        "999999:large": "d6aa96f1",
      }
    `);
  });

  it('gives different seeds different landscapes', () => {
    const hashes = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) hashes.add(hashState(createWorld(generateArena(seed, 'medium').level.terrain)));
    expect(hashes.size).toBe(6);
  });

  it('builds a valid, four-fold fair, connected arena for every size across many seeds', () => {
    for (const size of ARENA_SIZES) {
      for (let n = 0; n < 25; n += 1) {
        const seed = (n * 40_503 + 17) % (MAX_ARENA_SEED + 1);
        const arena = generateArena(seed, size);
        // validateLevel: flat pads, four-fold symmetry, every slot and the centre on foot.
        expect(() => validateLevel(arena.level)).not.toThrow();
        const world = createWorld(arena.level.terrain);
        expect(world.widthMetres).toBe(arena.widthMetres);
        // Nothing floats: the first blast must not drop rock that was never supported.
        expect(collapseTerrain(world)).toEqual([]);
      }
    }
  });

  it('sizes the arena: small < medium < large', () => {
    const widths = ARENA_SIZES.map((size) => generateArena(77, size).widthMetres);
    expect(widths).toEqual([60, 72, 90]);
  });

  it('has relief and crystal, not a flat floor', () => {
    let crystal = 0;
    for (const seed of [10, 20, 30, 40]) {
      const arena = generateArena(seed, 'medium');
      const world = createWorld(arena.level.terrain);
      if (Array.from(arena.level.terrain.material).some((m) => m === MATERIAL_CRYSTAL)) crystal += 1;
      // Somewhere inside the rim the landscape rises at least 2.5 m above the pads.
      const centre = world.widthMetres / 2;
      let highest = 0;
      for (let k = 0; k < world.nz; k += 1) {
        for (let i = 0; i < world.nx; i += 1) {
          const x = i * world.spacing;
          const z = k * world.spacing;
          if (Math.max(Math.abs(x - centre), Math.abs(z - centre)) > centre - 9) continue;
          for (let j = world.ny - 1; j > 0; j -= 1) {
            if (world.density[j + world.ny * (i + world.nx * k)]! >= 128) {
              highest = Math.max(highest, j * world.spacing);
              break;
            }
          }
        }
      }
      expect(highest).toBeGreaterThan(arena.baseHeightMetres + 2.5);
    }
    expect(crystal).toBeGreaterThan(0);
  });

  it('lets every pad reach every other pad on foot', () => {
    const arena = generateArena(31337, 'large');
    const world = createWorld(arena.level.terrain);
    const point = (team: number) => {
      const slot = arena.level.spawns[team]!.slots[0]!;
      return { x: slot.xMetres, y: arena.baseHeightMetres, z: slot.zMetres };
    };
    for (let a = 0; a < 4; a += 1) {
      for (let b = 0; b < 4; b += 1) {
        if (a !== b) expect(findPath(world, 0, point(a), point(b))).not.toBeNull();
      }
    }
  });

  it('refuses a bad seed or size loudly', () => {
    expect(() => generateArena(-1, 'medium')).toThrow(/seed/);
    expect(() => generateArena(MAX_ARENA_SEED + 1, 'medium')).toThrow(/seed/);
    expect(() => generateArena(1.5, 'medium')).toThrow(/seed/);
    expect(() => generateArena(1, 'huge' as never)).toThrow(/size/);
  });
});

describe('a generated arena in a match', () => {
  it('stages every team on its own pad and the AI fights it out', () => {
    for (const size of ['small', 'large'] as const) {
      const arena = resolveArena({ kind: 'generated', seed: 2026, size });
      const result = runTeamBatch(arenaTeamSetup(4, 2, arena), {
        seeds: 1,
        aimErrorScale: 0.09,
        rules: { tickCap: 18_000, bleedIntervalTicks: 600 },
      });
      const match = result.matches[0]!;
      // The AI navigated to each other and fought: shells hit and tanks died before the clock.
      expect(match.hits).toBeGreaterThan(4);
      expect(match.kills).toBeGreaterThan(0);
      expect(match.capHit).toBe(false);
    }
  }, 60_000);

  it('runs the player team and the spectator on the generated arena', () => {
    const arena = resolveArena({ kind: 'generated', seed: 5150, size: 'small' });
    const team = new TeamSession({ seed: 3, teams: 2, tanksPerTeam: 2, arena });
    expect(team.state.world.widthMetres).toBe(arena.bounds.maxX);
    expect(team.floorY).toBe(arena.baseHeightMetres);
    // The player's corner rotates by match seed, but it is always one of the pads' slots.
    const player = team.state.tanks[0]!;
    const slots = arena.level.spawns.flatMap((spawn) => spawn.slots);
    expect(slots.some((slot) => Math.abs(slot.xMetres - player.x) < 1e-6 && Math.abs(slot.zMetres - player.z) < 1e-6)).toBe(true);
    const spectator = new SpectatorSession({ seed: 3, teams: 4, tanksPerTeam: 1, arena });
    expect(spectator.state.world.widthMetres).toBe(arena.bounds.maxX);
    spectator.runTicks(120);
    expect(spectator.state.tick).toBe(120);
  });

  it('reuses the arena for the same seed and size', () => {
    const choice = { kind: 'generated', seed: 8, size: 'medium' } as const;
    expect(resolveArena(choice)).toBe(resolveArena({ ...choice }));
  });
});

describe('the arena in the match setup', () => {
  it('round-trips a generated arena through the URL', () => {
    const setup = validateMatchSetup({ ...DEFAULT_MATCH_SETUP, arena: { kind: 'generated', seed: 48213, size: 'large' } });
    const query = new URLSearchParams(matchSetupQuery(setup));
    expect(query.get('arena')).toBe('generated');
    expect(query.get('arenaSeed')).toBe('48213');
    expect(query.get('arenaSize')).toBe('large');
    expect(arenaChoiceFromQuery(query)).toEqual(setup.arena);
  });

  it('keeps old links on the Crucible and leaves its URL unchanged', () => {
    expect(arenaChoiceFromQuery(new URLSearchParams('mode=team&seed=4'))).toEqual({ kind: 'crucible' });
    expect(new URLSearchParams(matchSetupQuery(DEFAULT_MATCH_SETUP)).has('arena')).toBe(false);
  });

  it('defaults a generated arena to medium and refuses malformed links', () => {
    expect(arenaChoiceFromQuery(new URLSearchParams('arena=generated&arenaSeed=7'))).toEqual({ kind: 'generated', seed: 7, size: 'medium' });
    expect(() => arenaChoiceFromQuery(new URLSearchParams('arena=generated'))).toThrow(/arenaSeed/);
    expect(() => arenaChoiceFromQuery(new URLSearchParams('arena=generated&arenaSeed=1e3'))).toThrow(/arenaSeed/);
    expect(() => arenaChoiceFromQuery(new URLSearchParams('arena=generated&arenaSeed=5&arenaSize=huge'))).toThrow(/size/);
    expect(() => arenaChoiceFromQuery(new URLSearchParams('arena=maze'))).toThrow(/arena/);
    expect(() => arenaChoiceFromQuery(new URLSearchParams('arenaSeed=5'))).toThrow(/arena=generated/);
  });

  it('reads a typed seed only when it is one', () => {
    expect(parseArenaSeedText(' 123 ')).toBe(123);
    expect(parseArenaSeedText('0')).toBe(0);
    expect(parseArenaSeedText('999999')).toBe(999_999);
    expect(parseArenaSeedText('')).toBeNull();
    expect(parseArenaSeedText('12a')).toBeNull();
    expect(parseArenaSeedText('-4')).toBeNull();
    expect(parseArenaSeedText('1000000')).toBeNull();
  });

  it('steps the size within small…large', () => {
    let setup = validateMatchSetup({ ...DEFAULT_MATCH_SETUP, arena: { kind: 'generated', seed: 1, size: 'medium' } });
    setup = stepArenaSize(setup, 1);
    setup = stepArenaSize(setup, 1);
    expect(setup.arena).toMatchObject({ size: 'large' });
    for (let n = 0; n < 4; n += 1) setup = stepArenaSize(setup, -1);
    expect(setup.arena).toMatchObject({ size: 'small' });
    expect(() => stepArenaSize(DEFAULT_MATCH_SETUP, 1)).toThrow(/generated/);
  });
});
