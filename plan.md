# Game Plan: Tiny Tanks

## Overview
- **Name:** Tiny Tanks
- **Repo name:** tiny-tanks
- **Tagline:** Bank ricochet shots around the walls, grab the enemy flag, race it home — a top-down tank-CTF you play with a thumb.
- **Genre (directory category):** arcade

## Core Loop
You drive a little tank around a walled, point-symmetric arena. Your gun fires bullets that **ricochet off walls** two or more times before they expire — so the shot that matters is the one you bank around a corner into someone who thinks they're safe (and yes, your own rebound can come back and kill you). The objective is capture-the-flag: reach the enemy base, grab their flag, and drive it back to your base to score. Bullets one-shot a tank; you respawn a couple seconds later, so nobody is ever eliminated — the tension is spatial (cover, angles, cutting off the flag-runner), not attrition. Pickups drop mid-arena (spread shot, rapid fire, speed, shield, extra ricochet). First team to 3 captures wins; if the clock runs out, most captures wins. It's always **2 tanks per team**; bots fill any empty seat and play the objective, so solo and 2-player both feel like a full 2v2.

Win: your team reaches 3 captures (or leads at time). Lose: enemy does. Moment-to-moment tension: do I chase the kill or cut off their runner; do I take the risky bank shot or the safe straight one; do I grab the flag now (slower while carrying) or clear the lane first.

## Controls
- **Desktop:** WASD / arrows to drive, **mouse to aim**, click or Space to fire (hold to auto-fire on cooldown). P pause, M mute.
- **Mobile:** **twin floating analog sticks** (patterns/joystick.ts, one instance per screen-half): **left stick drives**, **right stick aims and auto-fires** while engaged. Body turns to face movement; the turret aims independently with the right stick — the correct scheme for a top-down twin-stick shooter (MOBILE_CONTROLS.md), never a D-pad or "tap where to go".

## Multiplayer
- **Mode:** live P2P.
- **Shape:** **versus** (team vs team). Why not co-op / shared-world: capture-the-flag is the canonical team-versus objective — you're taking the *enemy's* flag — and it's genuinely fun 1v1 (each human + one bot ally) and 2v2. A co-op reframing ("both raid a neutral flag") throws away the read-your-opponent tension that is the whole point of banking a shot at a *person*. Bots fill empty seats so the versus shape survives a small player count (2 humans = a real 1v1, not a dead lobby).
- **If live P2P:** players 2–4 humans, always rendered as a **2v2** (4 tanks; empty seats are host-run bots). Topology **host-authoritative snapshot star** (proven in orbital-skirmish / morsel / gloamrun). Host advances the whole Sim (all 4 tanks incl. bots, bullets + ricochet, flags, pickups, scoring) on a 50 ms `setInterval` and broadcasts a snapshot on `snap`; each client sends its own tank's input on `in` (a compact `[mx,my,ax,ay,f]` array) and renders snapshots, extrapolating its own tank a little for feel. Channels: `snap`, `in` (both ≤12 bytes). **Teams by seat parity** (even seats = Amber, odd = Teal), so the host (seat 0) and a second human (seat 1) land on **opposite** teams → a true 1v1; symmetric left/right spawns keep it fair.
  - **Late joiner:** a peer that joins mid-round has no frozen-roster seat, so it spectates the live round and is dealt in at the next round (rematch refreezes the roster). A peer that leaves: its seat coasts / is taken over by a host-run bot, never freezes the round.
  - **Host leaves:** net.ts re-elects the smallest surviving peer and fires `onHostChange`; the promoted peer adopts the Sim it has been holding (every peer keeps a real Sim, snapshots overwrite it) and resumes ticking + running bots for empty seats, so the round keeps running and can still reach a capture win. Wired via `NetGame.onHostChange`.
- **End of round → rematch:** uses patterns/rematch.ts (`createRounds`) inside the ONE living room — never leave/rejoin. "Play again" is a vote + a new round number; the host broadcasts the new seed + frozen roster so every peer indexes tanks identically. Waiting shows a visible countdown once quorum is met (never unanimity-forever); host can force-start; the results screen offers **Back to lobby** (does NOT leave the room) and **Menu**. A running **match tally** (rounds won per peer) persists across rounds. A peer that declines / closes just isn't in the next round; it never deadlocks.

## Juice Plan
- Procedural SFX (patterns/sound.ts): fire `blip`, ricochet tick `hit`, tank explode `explosion` + shake + hit-stop, flag grab `powerup`, capture `win`, pickup `select`.
- Particles: muzzle spark on fire, spark burst + brief screen shake on each **wall ricochet**, big coloured burst + shake + hit-stop on a tank kill, ring on flag grab, confetti burst on capture.
- Tweened: tank body angle eases toward heading; turret eases toward aim; flag bobs; pickups pulse.
- Palette: Okabe–Ito team colours (Amber #e69f00 vs Teal #009e73 — both colour-blind-safe and clearly opposed), neutral slate walls on a dark field.

## Style Direction
**Vibe:** clean-minimal neon-on-slate arcade.
**Palette:** dark slate arena (#0e1320), light slate walls (#41506b), Amber vs Teal teams, white bullets tinted by owner. Colour-blind-safe (Okabe–Ito) + team also shown by base side and HUD label.
**Theme:** dark.
**Reference feel:** the crisp top-down tank duel of classic "Combat" / Wii Tanks, minus any IP — all procedural shapes.

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite.
- **Render:** Canvas 2D (continuous motion, many bullets + particles).
- **Engine modules copied from patterns/:** net, rematch, lobby, rng, loop, joystick, mobile, sound, storage, identity.
- **Persistence:** localStorage settings (mute, mode, seen-help) + solo best (captures / fastest win) via storage.ts.

## Non-Goals
- No tight 1-tile maze corridors (frustrating for tanks); walls are chunky cover in an open arena.
- No destructible terrain, no vehicle classes, no more than 4 tanks.
- No authoritative-server anything.

## How To Play (player-facing copy)
Drive with the left stick (or WASD), aim + fire with the right stick (or the mouse). Your bullets **bounce off walls** — bank them around corners, but watch your own rebound. Grab the **enemy flag** and drive it back to your base to score. First team to 3 wins. Nobody's ever knocked out — you respawn in a moment.
