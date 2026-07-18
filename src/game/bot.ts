/**
 * bot.ts — a CTF tank AI, as a pure function of sim state.
 *
 * It exists twice over: it fills empty seats in a live/solo game, and it plays
 * the few hundred headless rounds in tests/balance.test.ts. The second job sets
 * the bar — a bot that cannot navigate a wall or complete a flag run produces a
 * reading of the BOT, not the game.
 *
 * The two things that made an earlier version produce ZERO captures, found by
 * the balance sim, are fixed here and worth stating:
 *
 *  - ROLES. With every tank rushing the enemy flag, both carriers met in the
 *    midfield crossfire and died every time. One attacker + one defender per
 *    team gives the carrier a thinner lane home and someone guarding the door.
 *  - STUCK RECOVERY. In the dense Labyrinth, a naive "steer toward the target"
 *    bot pins itself against a wall and freezes for the whole round. A wall-
 *    follow fallback when it stops making progress keeps it moving.
 *
 * Deterministic: seeded per-seat jitter, no Math.random.
 */

import { makeRng, type Rng } from '../engine/rng';
import { ARENA_H, ARENA_W } from './arena';
import { angDelta, segIntersectsRect } from './geom';
import {
  FLAG_CARRIED,
  FLAG_DROPPED,
  MUZZLE,
  TANK_R,
  type Sim,
  type Tank,
  type TankInput,
} from './sim';

const FIRE_RANGE = 240;
const AIM_TOL = 0.14; // rad
const PROBE = 74; // wall-avoidance lookahead

export interface BotOptions {
  /** 0..1. Scales aim jitter. Balance uses 1. */
  skill?: number;
}

export class Bot {
  readonly seat: number;
  private rng: Rng;
  private skill: number;
  private jitter = 0;
  private jitterT = 0;
  private lastX = 0;
  private lastY = 0;
  private stuck = 0;
  private wallSide = 1;

  constructor(seed: number, seat: number, opts: BotOptions = {}) {
    this.seat = seat;
    this.rng = makeRng(seed * 7919 + seat * 104_729 + 17);
    this.skill = opts.skill ?? 1;
    // Which way to wall-follow when stuck. This MUST NOT key off team parity: a
    // 180° point rotation (the arena's symmetry) preserves chirality, so the
    // symmetric counterpart of "turn CCW" is also CCW. Keying it off seat parity
    // put the two teams on opposite chirality and skewed captures ~1:3 (the
    // balance sim caught it). `seat < 2` gives each team one of each instead.
    this.wallSide = seat < 2 ? 1 : -1;
  }

  private nearestEnemy(sim: Sim, me: Tank): Tank | null {
    let best: Tank | null = null;
    let bestD = Infinity;
    for (const t of sim.tanks) {
      if (t.team === me.team || !t.alive) continue;
      const d = Math.hypot(t.x - me.x, t.y - me.y) + this.rng() * 0.5;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private amNearest(sim: Sim, me: Tank, x: number, y: number): boolean {
    const mine = Math.hypot(me.x - x, me.y - y);
    for (const t of sim.tanks) {
      if (t.team !== me.team || t.seat === me.seat || !t.alive) continue;
      if (Math.hypot(t.x - x, t.y - y) < mine) return false;
    }
    return true;
  }

  private losClear(sim: Sim, ax: number, ay: number, bx: number, by: number): boolean {
    for (const w of sim.arena.walls) if (segIntersectsRect(ax, ay, bx, by, w)) return false;
    return true;
  }

  /** Clearance (distance to nearest wall/edge at the probe endpoint); <=0 = blocked. */
  private clearance(sim: Sim, x: number, y: number, h: number): number {
    const tx = x + Math.cos(h) * PROBE;
    const ty = y + Math.sin(h) * PROBE;
    let best = Math.min(tx, ARENA_W - tx, ty, ARENA_H - ty) - TANK_R;
    for (const w of sim.arena.walls) {
      const cx = Math.max(w.x, Math.min(tx, w.x + w.w));
      const cy = Math.max(w.y, Math.min(ty, w.y + w.h));
      best = Math.min(best, Math.hypot(tx - cx, ty - cy) - TANK_R - 4);
    }
    return best;
  }

  private headingClear(sim: Sim, x: number, y: number, h: number): boolean {
    return this.clearance(sim, x, y, h) > 0;
  }

  /**
   * Pick a drivable heading closest to `want`, sweeping outward. When both sides
   * of an obstacle are open it takes the CLEARER side, chosen geometrically — a
   * fixed "always turn one way" preference is chirality-biased on a choke and
   * gave one team a real edge in Rampart. Geometry is rotation-symmetric, so it
   * isn't.
   */
  private steer(sim: Sim, me: Tank, want: number): number {
    if (this.stuck > 8) {
      // Boxed in: commit to a wall-follow on this tank's side (team-balanced by
      // seat<2, not team parity — see the constructor).
      for (let i = 1; i <= 6; i++) {
        const off = this.wallSide * i * 0.4;
        if (this.headingClear(sim, me.x, me.y, want + off)) return want + off;
      }
      this.wallSide *= -1;
      this.stuck = 0;
    }
    if (this.headingClear(sim, me.x, me.y, want)) return want;
    for (let i = 1; i <= 6; i++) {
      const off = i * 0.4;
      const cPlus = this.clearance(sim, me.x, me.y, want + off);
      const cMinus = this.clearance(sim, me.x, me.y, want - off);
      if (cPlus > 0 || cMinus > 0) return cPlus >= cMinus ? want + off : want - off;
    }
    return want + this.wallSide * 1.6;
  }

  input(sim: Sim): TankInput {
    const me = sim.tanks.find((t) => t.seat === this.seat);
    if (!me || !me.alive) {
      this.stuck = 0;
      return { mx: 0, my: 0, ax: 0, ay: 0, f: 0 };
    }

    // progress / stuck tracking
    const moved = Math.hypot(me.x - this.lastX, me.y - this.lastY);
    this.lastX = me.x;
    this.lastY = me.y;
    if (moved < 0.6) this.stuck++;
    else this.stuck = Math.max(0, this.stuck - 2);

    this.jitterT -= 1;
    if (this.jitterT <= 0) {
      this.jitterT = 14 + Math.floor(this.rng() * 20);
      this.jitter = (this.rng() - 0.5) * 0.95 * (1 - this.skill * 0.55);
    }

    const myFlag = sim.flags[me.team];
    const enemyFlag = sim.flags[1 - me.team];
    const myBase = sim.arena.bases[me.team];

    // The nearest enemy that is deep on OUR half — a real threat to our flag.
    let threat: Tank | null = null;
    let threatD = Infinity;
    for (const t of sim.tanks) {
      if (t.team === me.team || !t.alive) continue;
      const d = Math.hypot(t.x - myBase.x, t.y - myBase.y);
      if (d < ARENA_W * 0.42 && d < threatD) {
        threatD = d;
        threat = t;
      }
    }

    // ── choose a destination ──
    // Default is to ATTACK (both tanks push). A tank peels back to defend only
    // when there is a live threat on our half AND it is the closest teammate to
    // it — so one defends, the other keeps the pressure on. A lone attacker can
    // never breach a permanently-guarded base (the balance sim proved it), so
    // defence has to be earned by the enemy actually pushing, not stood by
    // default.
    let tx: number;
    let ty: number;
    if (me.carrying >= 0) {
      // running it home
      tx = myBase.x;
      ty = myBase.y;
    } else if (myFlag.state === FLAG_CARRIED) {
      // an enemy has our flag — chase the carrier down
      const carrier = sim.tanks.find((t) => t.seat === myFlag.carrier);
      tx = carrier?.x ?? myFlag.x;
      ty = carrier?.y ?? myFlag.y;
    } else if (myFlag.state === FLAG_DROPPED && this.amNearest(sim, me, myFlag.x, myFlag.y)) {
      tx = myFlag.x;
      ty = myFlag.y;
    } else if (threat && this.amNearest(sim, me, threat.x, threat.y)) {
      // peel to intercept the intruder
      tx = threat.x;
      ty = threat.y;
    } else {
      // attack: drive right into the enemy flag
      tx = enemyFlag.x;
      ty = enemyFlag.y;
    }

    let want = Math.atan2(ty - me.y, tx - me.x);
    // A flag carrier routes AROUND enemies rather than driving into them — the
    // single biggest thing that lets a run actually get home. If an enemy sits
    // roughly ahead and close, bend the heading to the side that still points
    // homeward.
    if (me.carrying >= 0) {
      const foe = this.nearestEnemy(sim, me);
      if (foe) {
        const fd = Math.hypot(foe.x - me.x, foe.y - me.y);
        const toFoe = Math.atan2(foe.y - me.y, foe.x - me.x);
        if (fd < 220 && Math.abs(angDelta(want, toFoe)) < 1.0) {
          const side = angDelta(toFoe, want) >= 0 ? 1 : -1;
          want += side * 1.05;
        }
      }
    }
    const heading = this.steer(sim, me, want);

    // ── aim + fire ──
    let ax = Math.cos(me.aim);
    let ay = Math.sin(me.aim);
    let fire = 0;
    const enemy = this.nearestEnemy(sim, me);
    if (enemy) {
      const dist = Math.hypot(enemy.x - me.x, enemy.y - me.y);
      const flight = dist / MUZZLE;
      const px = enemy.x + enemy.vx * flight;
      const py = enemy.y + enemy.vy * flight;
      const aimAng = Math.atan2(py - me.y, px - me.x) + this.jitter;
      ax = Math.cos(aimAng);
      ay = Math.sin(aimAng);
      if (
        dist < FIRE_RANGE &&
        Math.abs(angDelta(me.aim, aimAng)) < AIM_TOL &&
        this.losClear(sim, me.x, me.y, enemy.x, enemy.y)
      ) {
        fire = 1;
      }
    }

    return { mx: Math.cos(heading), my: Math.sin(heading), ax, ay, f: fire };
  }
}
