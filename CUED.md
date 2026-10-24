# CUED.md — connecting a game to cued

[cued](https://cued.de) is Frank's private friends' portal (≈ 30–40 friends): invitation-only login, events, chat,
"friends online", invitations to play, HiScores and a games section. Friends who build games can publish them there as
**guest games**: the game keeps running on the developer's own server, cued shows it in a sandboxed iframe and hands
it the identity of the player. This file is the contract — written so that another game (and another agent) can be
connected the same way.

Status: **slice 1 (identity) is in this branch.** Online play already exists through Arnd's GameHub
(`docs/ONLINE.md`); connecting cued's invitations and names to it follows (see the end).

## 1. How a game appears in cued

1. A cued member with the **developer** flag opens `https://cued.de/entwickler/`, enters the game's name and its
   https address (e.g. `https://apps.futuremagic.de/tank-battle/`). cued derives a slug (`tank-battle`).
2. At first only the developer (and cued's admins) see it. On the game's developer page they set texts, a preview
   image and the visibility: *developer only* → *testers* → *all members*. Releasing is the developer's call.
3. Players start it from the game card. cued opens `https://cued.de/spiele/<slug>/`, which embeds the game:

```html
<iframe src="https://apps.futuremagic.de/tank-battle/#cued=<PASS>"
        allow="fullscreen; gamepad; autoplay" allowfullscreen referrerpolicy="origin"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-forms"></iframe>
```

**Server requirement:** the game page must allow being framed by cued — no `X-Frame-Options: DENY/SAMEORIGIN`; if a
CSP is sent, it needs `frame-ancestors https://cued.de`. (`apps.futuremagic.de` sends neither today, so it works.)

The game runs exactly as on its own site. cued's own page around it shows the friend's online status
("bei Tank Battle"), invitation notices and spectator controls — the game does not have to do anything for that.

## 2. The pass (`#cued=<JWT>`)

A compact **JWT, HS256**, signed with the per-game **key** shown on the game's developer page in cued (keep it
secret; it can be regenerated there). Claims:

| claim | meaning |
| --- | --- |
| `iss` | always `"cued"` |
| `aud` | the game's slug in cued, e.g. `"tank-battle"` |
| `iat`, `exp` | issued / expires (Unix seconds). Valid for **6 hours**. |
| `sub` | the player's **stable id** in cued (number as string). Use this as the player key. |
| `name` | display name (what friends see everywhere in cued) |
| `kuerzel` | initials for the avatar circle |
| `hg`, `schrift` | avatar circle background / text colour (CSS colours) |
| `bild` | URL of a 128 px avatar image (no cued login needed, CORS `*`), or `""` when the player has none |
| `raum` | room id when the game was launched from a cued invitation (multiplayer slice), else `null` |
| `cued` | cued's base URL (`https://cued.de/`) |

The login name and everything else about the member stay inside cued.

### Trust

- **In the browser, only read the pass.** The key must never ship in the client bundle, so the client cannot verify
  the signature. Use the claims for display (name, avatar).
- **Anything that matters is verified on the server** with the key — joining a room, recording a result:

```ts
import { jwtVerify } from 'jose';
const { payload } = await jwtVerify(pass, new TextEncoder().encode(process.env.CUED_KEY!), {
  issuer: 'cued', audience: 'tank-battle',
});
// payload.sub is the player id, payload.raum the room
```

## 3. How Tank Battle reads it (copy this pattern)

| piece | file | role |
| --- | --- | --- |
| pure reader | `src/cued/identity.ts` | `decodeCuedPass(token)` → `CuedIdentity` (schema-checked, throws `CuedPassError`, no DOM), `isCuedPassExpired`, `cuedPassFromHash`, `hashWithoutCuedPass` |
| tests | `src/cued/identity.test.ts` | builds passes exactly like cued (HMAC-SHA256) and checks every claim, malformed passes, expiry, fragment handling |
| browser glue | `src/entry/cued.ts` | `loadCuedSession()`: reads `#cued=` once, **removes it from the address bar** and keeps it in `sessionStorage` (the game's own `location.assign('?mode=…')` navigations drop the fragment); `showCuedBadge()` |
| wiring | `src/main.ts` (startup) | loads the session, shows the title badge, routes errors to `reportError` |

No pass → the game was not launched from cued and runs as before. A malformed pass is a **loud error** on the error
surface (it is dropped from storage so the next load is clean). An expired pass shows a hint to reopen the game from
cued.

## 4. Next slices (planned with Frank and Arnd)

Online rooms already run on Arnd's **GameHub** (`games.futuremagic.de`, `docs/ONLINE.md`) — so cued's server stays
out of the game traffic, as intended, and no extra relay is needed. What is left is wiring cued's social side to it:

1. **Online names from the pass.** In an online room, a player launched from cued appears under his cued name
   (`CuedIdentity.name`) instead of a typed one.
2. **Invitations through cued into a GameHub room.** When a cued player hosts a room, the game tells the cued page
   the room code (`postMessage` to the parent: `{ type: 'cued:room', code }`). cued then offers "invite a friend" from
   its friends-online list; the friend's cued opens the game with that code in the pass (`raum`), and the game joins
   it straight away (the same path as `?room=CODE`). The cued page shows "playing Tank Battle" while in a room.
3. **Results (optional).** GameHub stores nothing, so a finished online match could be reported to cued by the host
   (for cued's ranking page). Client-reported, so only among friends — to be decided with Arnd.
4. **A reusable `cued-sdk`** extracted from this branch (pass reader + the `postMessage` bridge), so the next game is
   connected in minutes.
