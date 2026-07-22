// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * snapshot.ts — the world, on the wire.
 *
 * Host-authoritative star: the host owns the Sim and broadcasts one of these at
 * 20Hz; clients overwrite their own Sim from it. Trystero JSON-serializes
 * payloads, so this is flat number arrays rather than objects.
 *
 * WHY EVERY PEER HOLDS A REAL SIM: the promoted host has to keep the round
 * running, so a client applies snapshots INTO a Sim it already has and promotion
 * is just "start stepping the thing you were holding". That is also why fields a
 * client never reads (bullet life/age, buff timers, stats) still travel — the
 * client is one host-transfer away from being the authority on them, and a
 * missing field would sit at its constructor value and then drive the sim wrong
 * on the promoted host's first tick.
 */

import { PICKUP_TYPES, Sim, type PickupType, type SimEvent, type EventKind } from './sim';

const TANK_STRIDE = 24;
const BULLET_STRIDE = 10;
const FLAG_STRIDE = 5;
const PICKUP_STRIDE = 3;
const EVENT_STRIDE = 4;

const KINDS: EventKind[] = ['shot', 'bounce', 'boom', 'crack', 'grab', 'return', 'capture', 'pickup', 'shield'];

export interface Snapshot {
  t: number; // tick (monotonic; older snapshots are dropped)
  tm: number; // time × 10
  o: number; // over ? 1 : 0
  w: number; // winner team, or -1
  sc: [number, number];
  k: number[]; // tanks
  b: number[]; // bullets
  f: number[]; // flags
  p: number[]; // pickups
  e: number[]; // events
}

const r1 = (n: number): number => Math.round(n);
const r100 = (n: number): number => Math.round(n * 100);
const r10 = (n: number): number => Math.round(n * 10);

export function encodeSnapshot(sim: Sim, events: SimEvent[]): Snapshot {
  const k: number[] = [];
  for (const t of sim.tanks) {
    k.push(
      t.seat,
      r1(t.x),
      r1(t.y),
      r1(t.vx),
      r1(t.vy),
      r100(t.ang),
      r100(t.aim),
      (t.alive ? 1 : 0) | (t.shield ? 2 : 0),
      t.hp,
      r10(t.invuln),
      r10(t.respawn),
      r10(t.cool),
      t.carrying + 1, // -1..1 → 0..2
      r10(t.spreadT),
      r10(t.rapidT),
      r10(t.speedT),
      r10(t.ricoT),
      t.kills,
      t.deaths,
      t.shots,
      t.hits,
      t.captures,
      t.returns,
      t.pickups,
    );
  }
  const b: number[] = [];
  for (const x of sim.bullets) {
    b.push(r1(x.x), r1(x.y), r1(x.vx), r1(x.vy), x.owner, x.team, r10(x.life), r10(x.age), x.bounces, x.bounced ? 1 : 0);
  }
  const f: number[] = [];
  for (const fl of sim.flags) f.push(r1(fl.x), r1(fl.y), fl.state, fl.carrier, r10(fl.dropTimer));
  const p: number[] = [];
  for (const pk of sim.pickups) p.push(PICKUP_TYPES.indexOf(pk.type), pk.active ? 1 : 0, r10(pk.timer));
  const e: number[] = [];
  for (const ev of events) e.push(KINDS.indexOf(ev.t), r1(ev.x), r1(ev.y), ev.p);
  return {
    t: sim.tick,
    tm: r10(sim.time),
    o: sim.over ? 1 : 0,
    w: sim.winnerTeam,
    sc: [sim.scores[0], sim.scores[1]],
    k,
    b,
    f,
    p,
    e,
  };
}

/** Overwrite `sim` from a snapshot. Returns the events it carried, for juice. */
export function applySnapshot(sim: Sim, snap: Snapshot): SimEvent[] {
  sim.tick = snap.t;
  sim.time = snap.tm / 10;
  sim.over = snap.o === 1;
  sim.winnerTeam = snap.w;
  sim.scores[0] = snap.sc[0];
  sim.scores[1] = snap.sc[1];

  for (let i = 0; i + TANK_STRIDE <= snap.k.length; i += TANK_STRIDE) {
    const seat = snap.k[i];
    const t = sim.tanks.find((x) => x.seat === seat);
    if (!t) continue;
    const flags = snap.k[i + 7];
    t.x = snap.k[i + 1];
    t.y = snap.k[i + 2];
    t.vx = snap.k[i + 3];
    t.vy = snap.k[i + 4];
    t.ang = snap.k[i + 5] / 100;
    t.aim = snap.k[i + 6] / 100;
    t.alive = (flags & 1) !== 0;
    t.shield = flags & 2 ? 1 : 0;
    t.hp = snap.k[i + 8];
    t.invuln = snap.k[i + 9] / 10;
    t.respawn = snap.k[i + 10] / 10;
    t.cool = snap.k[i + 11] / 10;
    t.carrying = snap.k[i + 12] - 1;
    t.spreadT = snap.k[i + 13] / 10;
    t.rapidT = snap.k[i + 14] / 10;
    t.speedT = snap.k[i + 15] / 10;
    t.ricoT = snap.k[i + 16] / 10;
    t.kills = snap.k[i + 17];
    t.deaths = snap.k[i + 18];
    t.shots = snap.k[i + 19];
    t.hits = snap.k[i + 20];
    t.captures = snap.k[i + 21];
    t.returns = snap.k[i + 22];
    t.pickups = snap.k[i + 23];
  }

  sim.bullets.length = 0;
  for (let i = 0; i + BULLET_STRIDE <= snap.b.length; i += BULLET_STRIDE) {
    sim.bullets.push({
      x: snap.b[i],
      y: snap.b[i + 1],
      vx: snap.b[i + 2],
      vy: snap.b[i + 3],
      owner: snap.b[i + 4],
      team: snap.b[i + 5],
      life: snap.b[i + 6] / 10,
      age: snap.b[i + 7] / 10,
      bounces: snap.b[i + 8],
      bounced: snap.b[i + 9] === 1,
    });
  }

  for (let i = 0, fi = 0; i + FLAG_STRIDE <= snap.f.length && fi < sim.flags.length; i += FLAG_STRIDE, fi++) {
    const fl = sim.flags[fi];
    fl.x = snap.f[i];
    fl.y = snap.f[i + 1];
    fl.state = snap.f[i + 2];
    fl.carrier = snap.f[i + 3];
    fl.dropTimer = snap.f[i + 4] / 10;
  }

  for (let i = 0, pi = 0; i + PICKUP_STRIDE <= snap.p.length && pi < sim.pickups.length; i += PICKUP_STRIDE, pi++) {
    const pk = sim.pickups[pi];
    pk.type = PICKUP_TYPES[snap.p[i]] ?? pk.type;
    pk.active = snap.p[i + 1] === 1;
    pk.timer = snap.p[i + 2] / 10;
  }

  const out: SimEvent[] = [];
  for (let i = 0; i + EVENT_STRIDE <= snap.e.length; i += EVENT_STRIDE) {
    const kind = KINDS[snap.e[i]];
    if (!kind) continue;
    out.push({ t: kind, x: snap.e[i + 1], y: snap.e[i + 2], p: snap.e[i + 3] });
  }
  return out;
}

/** For a pickup label somewhere the UI needs it. */
export function pickupLabel(type: PickupType): string {
  return type;
}
