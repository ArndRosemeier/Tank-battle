/**
 * The title's headless background match. It is a real `SpectatorSession` (4 teams of
 * 4 AI tanks by default) with a slower director, wrapped in a lifecycle that can be
 * disposed when the title is left. This module is game layer: no renderer, DOM or
 * clock, so the determinism and disposal pins run in `node`.
 *
 * The title background is a SECOND match only while the title is up; `dispose()` is the
 * one seam the render shell must call before a player match is created.
 */

import { SpectatorSession, type DirectorShot } from './spectator.ts';
import { hashMatch } from '../core/sim.ts';
import type { TankRenderFrame } from './tankFrames.ts';

/** A fixed default seed keeps the menu frame reproducible; a URL seed may override it. */
export const TITLE_SEED = 7;
/** A cut every 420 ticks = 7 s; the spectator default is 180 (3 s). */
export const TITLE_DIRECTOR_INTERVAL_TICKS = 420;

export interface TitleSessionOptions {
  readonly seed?: number;
  readonly teams?: number;
  readonly tanksPerTeam?: number;
}

export class TitleSession {
  readonly spectator: SpectatorSession;
  readonly seed: number;
  private disposedState = false;

  constructor(options: TitleSessionOptions = {}) {
    this.seed = options.seed ?? TITLE_SEED;
    this.spectator = new SpectatorSession({
      seed: this.seed,
      teams: options.teams ?? 4,
      tanksPerTeam: options.tanksPerTeam ?? 4,
      directorIntervalTicks: TITLE_DIRECTOR_INTERVAL_TICKS,
    });
  }

  get disposed(): boolean {
    return this.disposedState;
  }

  get state(): SpectatorSession['state'] {
    return this.spectator.state;
  }

  get floorY(): number {
    return this.spectator.floorY;
  }

  get alpha(): number {
    return this.spectator.alpha;
  }

  get characters(): readonly string[] {
    return this.spectator.characters;
  }

  get followedTankId(): number | null {
    return this.spectator.followedTankId;
  }

  directorShot(): DirectorShot {
    return this.spectator.directorShot();
  }

  interpolatedTanks(alpha: number): readonly TankRenderFrame[] {
    return this.spectator.interpolatedTanks(alpha);
  }

  advance(frameSeconds: number): number {
    this.requireLive();
    return this.spectator.advance(frameSeconds);
  }

  runTicks(ticks: number): void {
    this.requireLive();
    this.spectator.runTicks(ticks);
  }

  hash(): string {
    return hashMatch(this.spectator.state);
  }

  /** Idempotent. After this, `advance`/`runTicks` throw; the renderer is disposed by the shell. */
  dispose(): void {
    this.disposedState = true;
  }

  private requireLive(): void {
    if (this.disposedState) {
      throw new Error('titleSession: the background match is disposed');
    }
  }
}
