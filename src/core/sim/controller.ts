/**
 * The controller seam: WHERE a tank's command comes from is outside the simulation.
 *
 * A local human, an AI profile, a replay and (later) a network client all implement
 * this interface. There is deliberately no `isPlayer` anywhere in the core.
 */

import type { TankCommand } from './commands.ts';
import type { MatchState } from './match.ts';

/** One command for one tank for the current tick. */
export interface Controller {
  commandFor(state: MatchState, tankId: number): TankCommand;
}

/**
 * A controller driven by an explicit per-tank command list, indexed by tick — the
 * deterministic driver for tests and replays. A missing command is a loud error: a
 * test must not silently idle a tank it meant to script.
 */
export class ScriptedController implements Controller {
  private readonly commandsByTank: ReadonlyMap<number, readonly TankCommand[]>;

  constructor(commandsByTank: ReadonlyMap<number, readonly TankCommand[]>) {
    this.commandsByTank = commandsByTank;
  }

  commandFor(state: MatchState, tankId: number): TankCommand {
    const commands = this.commandsByTank.get(tankId);
    if (!commands) {
      throw new Error(`ScriptedController: no script for tank ${tankId}`);
    }
    const command = commands[state.tick];
    if (!command) {
      throw new Error(
        `ScriptedController: script for tank ${tankId} has no command at tick ${state.tick}`,
      );
    }
    return command;
  }
}
