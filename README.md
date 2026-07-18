# Tiny Tanks

**Bank ricochet shots around the walls, steal the enemy flag, and race it home — a top-down capture-the-flag tank duel you play with a thumb.**

🎮 Play: https://tiny-tanks.benrichardson.dev

## What it is

Tiny Tanks is a top-down, two-team capture-the-flag arena. You drive a little tank around a walled, point-symmetric field; your gun fires bullets that **ricochet off the walls** two or more times before they expire — so the shot that matters is the one you bank around a corner into someone who thinks they're safe (and yes, your own rebound can come back and finish you). The objective is CTF: reach the enemy base, grab their flag, and drive it home to score. First team to 3 captures wins.

Bullets take two hits to destroy a tank, and grabbing a flag grants a brief adrenaline burst so a run is a real, winnable race rather than instant death. Nobody is ever eliminated — you respawn in a couple of seconds — so the tension is spatial (cover, angles, cutting off the runner), not attrition. Power-ups drop mid-field: spread shot, rapid fire, extra speed, a shield, and extra ricochets.

It's always **two tanks per team**; bots fill any empty seat and play the objective, so solo (you + a bot ally vs two bot enemies) and a two-player game both feel like a full 2v2.

## How to play

- **Desktop:** WASD / arrows to drive, **mouse to aim**, click or Space to fire. `P` pause, `M` mute.
- **Mobile:** **twin floating sticks** — left thumb drives, right thumb aims and auto-fires. Rest each thumb anywhere on its side of the screen.

Steal the enemy flag → drive it back to your base → score. First team to 3 wins.

## Multiplayer

**Live peer-to-peer**, 2–4 humans, always rendered as a 2v2 (empty seats are host-run bots). It's **versus** — team vs team. Create a room and share the 4-character code (or a friend types it in), and your browsers talk directly over WebRTC — there is no game server and no account. A free public signalling relay only introduces the browsers to each other; after that nothing about your game touches it. Teams are split by seat so two players land on opposite sides for a real duel. If the host leaves, another peer is promoted and the match keeps going; "Play again" runs a fresh round inside the same room with a running match tally.

## Tech

- Vite 6 + vanilla TypeScript
- Canvas 2D rendering
- Shared engine: fixed-timestep loop, floating twin-stick touch input, procedural audio, Trystero P2P netcode (host-authoritative snapshot star)
- Vitest for logic, P2P-sync determinism, point-symmetry fairness, host-transfer takeover, and a mandatory AI-vs-AI balance sim
- GitHub Pages hosting

No cookies, no fingerprinting, no third-party fonts. Anonymous, cookie-less page-view counts via Cloudflare Web Analytics.

## Local dev

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

## License

MIT
