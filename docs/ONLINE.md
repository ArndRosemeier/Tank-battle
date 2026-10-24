# Online play (GameHub)

Online rooms run on Arnd's GameHub relay (`https://games.futuremagic.de`, client and docs in
`github.com/ArndRosemeier/gameserver`). GameHub stores nothing and runs no game code: one
browser per room is the **host**, everyone else talks to it through the relay.

## The model: host-sequenced input lockstep

The core is deterministic from a seed plus per-tick commands, so the host does **not** ship
the world. It ships the human commands for every tick; every browser runs the same
simulation (same seed, same AI controllers) and reaches the same world, terrain included.

- **Room state** (`hub.setState`): roster, team choices, setup, and once started the match
  spec (seed, seat → tank slot). Small, resent on every change.
- **Tick batches** (`hub.sendDelta`): 20 per second, 3 ticks each, one command per human
  seat per tick. Seat hand-overs to AI ride in the batch. Every 120 ticks the host adds its
  `hashMatch`; a client that differs shows `OUT OF SYNC` in red on the HUD.
- **Intents** (`hub.send` to the host): a player's latest command (on change, ≤30/s), team
  choice, and the two migration messages.

Clients run a few ticks behind the newest row they hold, never past it, and catch up when
they fall behind. There is no client-side prediction yet: a guest's own tank responds after
one round trip plus the buffer (roughly 100–200 ms).

**Host migration:** when the host leaves, GameHub promotes the lowest player id. The new host
asks every peer for the rows it holds beyond its own (`sync?` / `sync`), takes the longest
stream, re-sends from the shortest peer's position, hands the departed seats to the AI, and
continues. A player who leaves mid-match is handed to the AI at a tick every peer agrees on.

## Where the code is

| File | What |
|---|---|
| `src/net/gamehub.ts` | GameHub client, vendored verbatim from the gameserver repo |
| `src/net/protocol.ts` | wire types and the ONE parser/validator of everything from the network |
| `src/net/room.ts` | room rules (join, teams, setup, START seating), pure |
| `src/net/netMatch.ts` | one match: produce (host) / consume (client), migration, hash check |
| `src/net/onlineSession.ts` | hub events → room transitions and matches |
| `src/net/fakeHub.ts` | in-memory GameHub for tests |
| `src/net/config.ts` | server URL, app id `tank`, app key |
| `src/entry/onlineScreens.ts` | the ONLINE / LOBBY / HOST / ROOM screens |
| `src/main.ts` (`openOnline` … `onlineStatus`) | boots and tears down online matches |

`TeamSession` takes `seats` (human slots with their controllers) and `viewSeat`; offline
modes do not pass them and behave as before.

## Setup

1. The app is registered on the box as `tank` (done 2026-10-24).
2. Its key is `COMMITTED_KEY` in `src/net/config.ts` (app keys are not secrets); a build may
   override it with `VITE_GAMEHUB_KEY=…`. Without a key the ONLINE screen says so.
3. For the futuremagic lobby, add a `gamehub` block to the game's `apps.json` entry with
   `"app": "tank"`, the key and `"join": "?room={code}"`. `?room=CODE` joins straight
   into the room.

## Known limits

- **Cross-browser determinism** is handled by `src/core/detMath.ts`: `sin/cos/tan/atan2` are
  stdlib's pure-JS fdlibm ports and `hypot` is a plain `Math.sqrt` of squares, so Chrome,
  Firefox and Safari compute the same bits. `purity.test.ts` bans the engine-approximated
  `Math` functions and `**` in `src/core` and `src/game`; `detMath.test.ts` pins result bits.
- A player who joins during a battle waits in the room and plays the next one (no
  mid-match spectating yet).
- The pause menu does not pause an online match.
