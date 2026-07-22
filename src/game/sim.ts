// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * sim.ts — the whole game, as a pure function of (seed, mode, inputs).
 *
 * No DOM, no rAF, no Math.random, no clock. Everything is decided by the seed,
 * the mode and the per-tick inputs. Three things depend on that:
 *
 *  1. The balance sim (tests/balance.test.ts) plays a few hundred bot-vs-bot
 *     rounds headless — it cannot if the game needs a canvas.
 *  2. The host-transfer test promotes a client core and drives it to a capture
 *     win with no network in sight.
 *  3. P2P sync. Walls, spawns, bases and pickup slots come from the seed, so a
 *     peer is never told what the arena is — only where the movers are.
 *
 * Coordinates are world units in a fixed ARENA_W × ARENA_H rectangle, origin
 * top-left, y positive DOWN (screen convention).
 *
 * THE INVARIANT WORTH GUARDING: a bullet reflects off a wall and can, after it
 * has bounced, hit its OWN owner. The moment either of those stops being true,
 * the game's identity is gone — banking a shot around a corner, and the risk of
 * your own rebound, are the entire hook.
 */

import { makeRng, randFloat, type Rng } from '@ben-gy/game-engine/rng';
import type { Mode } from '../modes';
import { ARENA_H, ARENA_W, BASE_R, buildArena, teamOfSeat, type Arena } from './arena';
import { bouncePointRect, resolveCircleRect, turnToward, type Rect } from './geom';

// ── fixed step ───────────────────────────────────────────────────────────────
export const STEP = 1 / 60;

// ── tank ─────────────────────────────────────────────────────────────────────
export const TANK_R = 15;
export const MOVE_SPEED = 225; // units/s base
export const CARRY_SPEED = 1.2; // carriers get an adrenaline boost so runs complete and games swing
export const SPEED_BOOST = 1.42; // speed pickup multiplier
export const ACCEL = 1500; // units/s² toward desired velocity
export const BODY_TURN = 9; // rad/s (body eases toward heading)
export const TURRET_TURN = 13; // rad/s (turret eases toward aim)
export const FIRE_COOL = 0.5; // s
export const RAPID_COOL = 0.19; // s (rapid pickup)
export const RESPAWN_DELAY = 2.0; // s
export const INVULN = 1.6; // s
/**
 * Tanks take TWO hits, not one. Measured necessity, not softness: with one-shot
 * kills the balance sim produced ZERO captures across hundreds of games — a
 * flag run is a multi-second drive and a lone hit ended it every time. Two hits
 * lets a run survive a graze, so the game has a middle. A bank shot still kills
 * over two, and your own rebound can still finish a cracked tank.
 */
export const TANK_MAX_HP = 2;

// ── bullet ───────────────────────────────────────────────────────────────────
export const BULLET_R = 5;
export const MUZZLE = 330; // units/s
export const BULLET_LIFE = 3.4; // s
export const BASE_BOUNCES = 2; // wall reflections before it dies on the next
export const RICO_BOUNCES = 5; // ricochet pickup
export const SPREAD_ANGLE = 0.22; // rad, side barrels of the spread shot
/** A bullet cannot hit its owner until it has bounced AND lived this long. */
export const SELF_ARM = 0.14; // s

// ── flag ─────────────────────────────────────────────────────────────────────
export const FLAG_R = 16;
export const DROP_RETURN = 7.0; // s a dropped flag waits before going home
/**
 * Grabbing the flag grants a brief invulnerability — the "adrenaline" window
 * that lets a carrier break away from the defender camping the base. Without it,
 * an open base (any mode but the walled Rampart) let the defender snipe every
 * carrier on the grab and NObody ever scored; the balance sim proved captures
 * only happened where a wall happened to block the base. This makes the flag run
 * a real, winnable race in every mode instead of an accident of geometry.
 */
export const GRAB_INVULN = 0.95; // s

// ── pickups ──────────────────────────────────────────────────────────────────
export const PICKUP_R = 18;
export const PICKUP_RESPAWN = 9.0; // s a slot stays empty after collection
export const BUFF_TIME = 8.0; // s for timed buffs
export const PICKUP_TYPES = ['spread', 'rapid', 'speed', 'shield', 'ricochet'] as const;
export type PickupType = (typeof PICKUP_TYPES)[number];

// ── flag / pickup state enums ─────────────────────────────────────────────────
export const FLAG_HOME = 0;
export const FLAG_CARRIED = 1;
export const FLAG_DROPPED = 2;

export interface TankInput {
  /** Desired move direction × magnitude, each in [-1, 1]. */
  mx: number;
  my: number;
  /** Aim direction (unit-ish). (0,0) = keep current turret aim. */
  ax: number;
  ay: number;
  /** Fire held. */
  f: number;
}

export const IDLE_INPUT: TankInput = { mx: 0, my: 0, ax: 0, ay: 0, f: 0 };

export interface Tank {
  seat: number;
  team: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number; // body facing
  aim: number; // turret facing
  alive: boolean;
  hp: number;
  invuln: number;
  respawn: number;
  cool: number;
  /** Flag index being carried, or -1. */
  carrying: number;
  shield: number; // 0/1
  spreadT: number;
  rapidT: number;
  speedT: number;
  ricoT: number;
  // stats — every one is shown on the results screen
  kills: number;
  deaths: number;
  shots: number;
  hits: number;
  captures: number;
  returns: number;
  pickups: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: number;
  team: number;
  life: number;
  age: number;
  /** Wall reflections still allowed before it dies on the next contact. */
  bounces: number;
  bounced: boolean;
}

export interface Flag {
  team: number; // the team this flag belongs to (home team)
  x: number;
  y: number;
  state: number; // FLAG_HOME | FLAG_CARRIED | FLAG_DROPPED
  carrier: number; // seat, or -1
  dropTimer: number;
}

export interface Pickup {
  x: number;
  y: number;
  type: PickupType;
  active: boolean;
  timer: number; // s until it reactivates when inactive
}

export type EventKind =
  | 'shot'
  | 'bounce'
  | 'boom'
  | 'crack'
  | 'grab'
  | 'return'
  | 'capture'
  | 'pickup'
  | 'shield';

export interface SimEvent {
  t: EventKind;
  x: number;
  y: number;
  /** Seat or team this concerns, where it means anything. */
  p: number;
}

export interface SimConfig {
  seed: number;
  mode: Mode;
}

export class Sim {
  readonly mode: Mode;
  readonly seed: number;
  readonly arena: Arena;
  private rng: Rng;

  tick = 0;
  time = 0;
  tanks: Tank[] = [];
  bullets: Bullet[] = [];
  flags: [Flag, Flag];
  pickups: Pickup[] = [];
  scores: [number, number] = [0, 0];
  events: SimEvent[] = [];
  over = false;
  /** Winning TEAM (0 or 1), or -1 for a draw / not yet decided. */
  winnerTeam = -1;

  constructor(cfg: SimConfig) {
    this.mode = cfg.mode;
    this.seed = cfg.seed;
    this.rng = makeRng(cfg.seed);
    this.arena = buildArena(cfg.seed, cfg.mode.walls);

    for (let seat = 0; seat < 4; seat++) this.tanks.push(this.makeTank(seat));

    this.flags = [this.makeFlag(0), this.makeFlag(1)];

    // Pickup slots seeded with a rotating starting type so the field is varied
    // but deterministic. Slots come as [centre, A, mirrorA, B, mirrorB]; a
    // mirrored PAIR must share a type, or one team's near pickup is a different
    // power from the other's — a fairness bug on a point-symmetric map. So the
    // type index is the slot's SYMMETRY GROUP, not its array position.
    const start = Math.floor(randFloat(this.rng, 0, PICKUP_TYPES.length));
    // Slots come as [A, mirrorA, B, mirrorB]; a mirrored PAIR shares a type.
    const group = [0, 0, 1, 1];
    this.pickups = this.arena.pickupSlots.map((s, i) => ({
      x: s.x,
      y: s.y,
      type: PICKUP_TYPES[(start + (group[i] ?? i)) % PICKUP_TYPES.length],
      active: true,
      timer: 0,
    }));
  }

  private makeTank(seat: number): Tank {
    const team = teamOfSeat(seat);
    const s = this.arena.spawns[seat];
    // Face inward, toward the enemy half (team 0 spawns at the top and looks
    // down; team 1 at the bottom and looks up).
    const aim = team === 0 ? Math.PI / 2 : -Math.PI / 2;
    return {
      seat,
      team,
      x: s.x,
      y: s.y,
      vx: 0,
      vy: 0,
      ang: aim,
      aim,
      alive: true,
      hp: TANK_MAX_HP,
      invuln: INVULN,
      respawn: 0,
      cool: 0,
      carrying: -1,
      shield: 0,
      spreadT: 0,
      rapidT: 0,
      speedT: 0,
      ricoT: 0,
      kills: 0,
      deaths: 0,
      shots: 0,
      hits: 0,
      captures: 0,
      returns: 0,
      pickups: 0,
    };
  }

  private makeFlag(team: number): Flag {
    const h = this.arena.flagHome[team];
    return { team, x: h.x, y: h.y, state: FLAG_HOME, carrier: -1, dropTimer: 0 };
  }

  // ── movement helpers ─────────────────────────────────────────────────────
  private collideWalls(t: Tank): void {
    for (const w of this.arena.walls) {
      const r = resolveCircleRect(t.x, t.y, TANK_R, w);
      if (r.hit) {
        t.x = r.x;
        t.y = r.y;
      }
    }
    t.x = Math.max(TANK_R, Math.min(ARENA_W - TANK_R, t.x));
    t.y = Math.max(TANK_R, Math.min(ARENA_H - TANK_R, t.y));
  }

  /**
   * Advance exactly one STEP. `inputs[seat]` is that tank's intent; a missing
   * entry is IDLE — deliberate and load-bearing, so a dropped input packet or a
   * closed tab coasts to a halt rather than freezing the round for everyone.
   */
  step(inputs: readonly (TankInput | undefined)[]): void {
    if (this.over) return;
    this.tick++;
    this.time += STEP;

    // ── tanks ──
    for (const t of this.tanks) {
      if (!t.alive) {
        t.respawn -= STEP;
        if (t.respawn <= 0) this.respawn(t);
        continue;
      }
      if (t.invuln > 0) t.invuln -= STEP;
      if (t.cool > 0) t.cool -= STEP;
      if (t.spreadT > 0) t.spreadT -= STEP;
      if (t.rapidT > 0) t.rapidT -= STEP;
      if (t.speedT > 0) t.speedT -= STEP;
      if (t.ricoT > 0) t.ricoT -= STEP;

      const inp = inputs[t.seat] ?? IDLE_INPUT;

      // desired velocity
      let mag = Math.hypot(inp.mx, inp.my);
      let dvx = 0;
      let dvy = 0;
      if (mag > 0.01) {
        if (mag > 1) mag = 1;
        let spd = MOVE_SPEED * mag;
        if (t.carrying >= 0) spd *= CARRY_SPEED;
        if (t.speedT > 0) spd *= SPEED_BOOST;
        dvx = (inp.mx / Math.hypot(inp.mx, inp.my)) * spd;
        dvy = (inp.my / Math.hypot(inp.mx, inp.my)) * spd;
        t.ang = turnToward(t.ang, Math.atan2(dvy, dvx), BODY_TURN * STEP);
      }
      // ease velocity toward desired
      const amax = ACCEL * STEP;
      t.vx += Math.max(-amax, Math.min(amax, dvx - t.vx));
      t.vy += Math.max(-amax, Math.min(amax, dvy - t.vy));
      t.x += t.vx * STEP;
      t.y += t.vy * STEP;
      this.collideWalls(t);

      // turret aim
      if (Math.abs(inp.ax) + Math.abs(inp.ay) > 0.01) {
        t.aim = turnToward(t.aim, Math.atan2(inp.ay, inp.ax), TURRET_TURN * STEP);
      }

      if (inp.f && t.cool <= 0) this.fire(t);
    }

    this.stepBullets();
    this.stepFlags();
    this.stepPickups();
    this.checkOver();
  }

  private fire(t: Tank): void {
    t.cool = t.rapidT > 0 ? RAPID_COOL : FIRE_COOL;
    t.shots++;
    const bounces = t.ricoT > 0 ? RICO_BOUNCES : BASE_BOUNCES;
    const angles = t.spreadT > 0 ? [t.aim - SPREAD_ANGLE, t.aim, t.aim + SPREAD_ANGLE] : [t.aim];
    for (const a of angles) {
      this.bullets.push({
        x: t.x + Math.cos(a) * (TANK_R + 4),
        y: t.y + Math.sin(a) * (TANK_R + 4),
        vx: Math.cos(a) * MUZZLE,
        vy: Math.sin(a) * MUZZLE,
        owner: t.seat,
        team: t.team,
        life: BULLET_LIFE,
        age: 0,
        bounces,
        bounced: false,
      });
    }
    this.events.push({ t: 'shot', x: t.x, y: t.y, p: t.seat });
  }

  private stepBullets(): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx * STEP;
      b.y += b.vy * STEP;
      b.life -= STEP;
      b.age += STEP;

      // walls
      let died = false;
      for (const w of this.arena.walls) {
        const r = bouncePointRect(b.x, b.y, b.vx, b.vy, BULLET_R, w);
        if (r.hit) {
          if (b.bounces <= 0) {
            died = true;
            break;
          }
          b.x = r.x;
          b.y = r.y;
          b.vx = r.vx;
          b.vy = r.vy;
          b.bounces--;
          b.bounced = true;
          this.events.push({ t: 'bounce', x: b.x, y: b.y, p: b.owner });
        }
      }
      // arena bounds
      if (!died) {
        if (b.x < BULLET_R || b.x > ARENA_W - BULLET_R) {
          if (b.bounces <= 0) died = true;
          else {
            b.x = Math.max(BULLET_R, Math.min(ARENA_W - BULLET_R, b.x));
            b.vx = -b.vx;
            b.bounces--;
            b.bounced = true;
            this.events.push({ t: 'bounce', x: b.x, y: b.y, p: b.owner });
          }
        }
        if (b.y < BULLET_R || b.y > ARENA_H - BULLET_R) {
          if (b.bounces <= 0) died = true;
          else {
            b.y = Math.max(BULLET_R, Math.min(ARENA_H - BULLET_R, b.y));
            b.vy = -b.vy;
            b.bounces--;
            b.bounced = true;
            this.events.push({ t: 'bounce', x: b.x, y: b.y, p: b.owner });
          }
        }
      }
      if (died || b.life <= 0) {
        this.bullets.splice(i, 1);
        continue;
      }

      // tanks
      for (const t of this.tanks) {
        if (!t.alive || t.invuln > 0) continue;
        // No friendly fire; the owner is only vulnerable to its OWN bullet after
        // it has bounced and armed (so you can bank into yourself, but a muzzle
        // shot never eats you).
        const sameTeam = t.team === b.team;
        const isOwner = t.seat === b.owner;
        if (sameTeam && !isOwner) continue;
        if (sameTeam && isOwner && !(b.bounced && b.age > SELF_ARM)) continue;
        if (Math.hypot(t.x - b.x, t.y - b.y) > TANK_R + BULLET_R) continue;

        const shooter = this.tanks.find((k) => k.seat === b.owner);
        const hostile = !!shooter && shooter.team !== t.team;
        if (t.shield > 0) {
          t.shield = 0;
          if (hostile) shooter!.hits++;
          this.events.push({ t: 'shield', x: t.x, y: t.y, p: t.seat });
        } else {
          t.hp--;
          if (hostile) shooter!.hits++;
          if (t.hp <= 0) {
            if (hostile) shooter!.kills++;
            this.kill(t);
          } else {
            // survived a graze — a cracked tank, still driving
            this.events.push({ t: 'crack', x: t.x, y: t.y, p: t.seat });
          }
        }
        this.bullets.splice(i, 1);
        break;
      }
    }
  }

  private kill(t: Tank): void {
    t.alive = false;
    t.deaths++;
    t.respawn = RESPAWN_DELAY;
    t.vx = 0;
    t.vy = 0;
    this.dropFlagOf(t, true);
    this.events.push({ t: 'boom', x: t.x, y: t.y, p: t.seat });
  }

  private dropFlagOf(t: Tank, atDeath: boolean): void {
    if (t.carrying < 0) return;
    const f = this.flags[t.carrying];
    f.state = FLAG_DROPPED;
    f.carrier = -1;
    f.dropTimer = DROP_RETURN;
    f.x = t.x;
    f.y = t.y;
    t.carrying = -1;
    if (atDeath) {
      /* dropped where the carrier fell */
    }
  }

  private stepFlags(): void {
    for (const f of this.flags) {
      if (f.state === FLAG_CARRIED) {
        const c = this.tanks.find((t) => t.seat === f.carrier);
        if (c && c.alive) {
          f.x = c.x;
          f.y = c.y;
          // capture: carrier reaches own base
          const base = this.arena.bases[c.team];
          if (Math.hypot(c.x - base.x, c.y - base.y) < BASE_R + TANK_R) {
            this.scores[c.team]++;
            c.captures++;
            c.carrying = -1;
            this.resetFlagHome(f);
            this.events.push({ t: 'capture', x: base.x, y: base.y, p: c.team });
          }
        } else {
          // carrier vanished (shouldn't normally happen) — send it home
          this.resetFlagHome(f);
        }
        continue;
      }
      if (f.state === FLAG_DROPPED) {
        f.dropTimer -= STEP;
        if (f.dropTimer <= 0) {
          this.resetFlagHome(f);
          continue;
        }
      }
      // HOME or DROPPED: tanks can interact
      for (const t of this.tanks) {
        if (!t.alive) continue;
        if (Math.hypot(t.x - f.x, t.y - f.y) > TANK_R + FLAG_R) continue;
        if (t.team === f.team) {
          // your own flag: if it was dropped away from home, return it
          if (f.state === FLAG_DROPPED) {
            this.resetFlagHome(f);
            t.returns++;
            this.events.push({ t: 'return', x: f.x, y: f.y, p: t.seat });
          }
        } else if (t.carrying < 0) {
          // enemy flag: grab it, with a brief adrenaline invuln to break away
          f.state = FLAG_CARRIED;
          f.carrier = t.seat;
          t.carrying = f.team;
          t.invuln = Math.max(t.invuln, GRAB_INVULN);
          this.events.push({ t: 'grab', x: f.x, y: f.y, p: t.seat });
          break;
        }
      }
    }
  }

  private resetFlagHome(f: Flag): void {
    const h = this.arena.flagHome[f.team];
    f.state = FLAG_HOME;
    f.carrier = -1;
    f.dropTimer = 0;
    f.x = h.x;
    f.y = h.y;
  }

  private stepPickups(): void {
    for (const p of this.pickups) {
      if (!p.active) {
        p.timer -= STEP;
        if (p.timer <= 0) {
          p.active = true;
          // rotate the type each respawn so a slot is not a fixed power fountain
          const idx = (PICKUP_TYPES.indexOf(p.type) + 1) % PICKUP_TYPES.length;
          p.type = PICKUP_TYPES[idx];
        }
        continue;
      }
      for (const t of this.tanks) {
        if (!t.alive) continue;
        if (Math.hypot(t.x - p.x, t.y - p.y) > TANK_R + PICKUP_R) continue;
        this.applyPickup(t, p.type);
        t.pickups++;
        p.active = false;
        p.timer = PICKUP_RESPAWN;
        this.events.push({ t: 'pickup', x: p.x, y: p.y, p: t.seat });
        break;
      }
    }
  }

  private applyPickup(t: Tank, type: PickupType): void {
    switch (type) {
      case 'spread':
        t.spreadT = BUFF_TIME;
        break;
      case 'rapid':
        t.rapidT = BUFF_TIME;
        break;
      case 'speed':
        t.speedT = BUFF_TIME;
        break;
      case 'shield':
        t.shield = 1;
        break;
      case 'ricochet':
        t.ricoT = BUFF_TIME;
        break;
    }
  }

  private respawn(t: Tank): void {
    const s = this.arena.spawns[t.seat];
    t.x = s.x;
    t.y = s.y;
    t.vx = 0;
    t.vy = 0;
    t.alive = true;
    t.hp = TANK_MAX_HP;
    t.invuln = INVULN;
    t.respawn = 0;
    t.aim = t.team === 0 ? Math.PI / 2 : -Math.PI / 2;
    t.ang = t.aim;
  }

  private checkOver(): void {
    // Both flags can be capped on the same tick (both carriers reach home
    // together). Checking team 0 first and returning would hand it the win — a
    // real, if rare, seat bias. Decide by score, drawing on a tie.
    const c = this.mode.capTarget;
    if (this.scores[0] >= c || this.scores[1] >= c || this.time >= this.mode.roundSeconds) {
      this.over = true;
      this.winnerTeam =
        this.scores[0] === this.scores[1] ? -1 : this.scores[0] > this.scores[1] ? 0 : 1;
    }
  }

  /** Team currently ahead on score, or -1 if tied. Used by the balance sim. */
  leadingTeam(): number {
    if (this.scores[0] === this.scores[1]) return -1;
    return this.scores[0] > this.scores[1] ? 0 : 1;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

export type { Rect };
