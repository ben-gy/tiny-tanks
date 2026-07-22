// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * arena.ts — the deterministic geometry of a round: bounds, bases, spawns, flag
 * homes, pickup slots, and the walls.
 *
 * Everything is a pure function of (seed, wall-style), rebuilt identically on
 * every peer from the round start — walls never travel on the wire, only the
 * seed. The layout is POINT-SYMMETRIC (rotate 180° about the centre), so both
 * teams face the byte-identical problem and team fairness is true by
 * construction; sim.test.ts's mirror test and layout.test.ts pin it.
 *
 * PORTRAIT (taller than wide), bases at TOP and BOTTOM. This is a mobile-first
 * choice — a landscape arena letterboxes to a thin strip on an upright phone,
 * which is where this game is played with two thumbs. The geometry is a clean 90°
 * rotation of a layout the balance sim already signed off, so the balance is
 * preserved by construction (a rotation is symmetric and the bot is
 * orientation-agnostic). Nothing else in the game assumes an orientation.
 */

import { makeRng, randFloat, type Rng } from '@ben-gy/game-engine/rng';
import type { WallStyle } from '../modes';
import type { Rect } from './geom';

export const ARENA_W = 800;
export const ARENA_H = 1280;
export const CX = ARENA_W / 2;
export const CY = ARENA_H / 2;

export const WALL = 26;
export const BASE_R = 46;
export const BASE_INSET = 190; // base distance from the top/bottom edge
export const SPAWN_INSET = 150; // spawn distance from the top/bottom edge
export const SPAWN_DX = 150; // spawn horizontal offset from centre

export interface Base {
  team: number;
  x: number;
  y: number;
}

export interface Arena {
  walls: Rect[];
  bases: [Base, Base];
  spawns: { x: number; y: number }[];
  flagHome: [{ x: number; y: number }, { x: number; y: number }];
  pickupSlots: { x: number; y: number }[];
}

function mirror(r: Rect): Rect {
  return { x: ARENA_W - r.x - r.w, y: ARENA_H - r.y - r.h, w: r.w, h: r.h };
}

const bases: [Base, Base] = [
  { team: 0, x: CX, y: BASE_INSET }, // Amber, top
  { team: 1, x: CX, y: ARENA_H - BASE_INSET }, // Teal, bottom
];

/** Seat 0/2 → team 0 (top), seat 1/3 → team 1 (bottom). Point-symmetric. */
const spawns = [
  { x: CX - SPAWN_DX, y: SPAWN_INSET }, // seat 0 (team 0)
  { x: CX + SPAWN_DX, y: ARENA_H - SPAWN_INSET }, // seat 1 (team 1)
  { x: CX + SPAWN_DX, y: SPAWN_INSET }, // seat 2 (team 0)
  { x: CX - SPAWN_DX, y: ARENA_H - SPAWN_INSET }, // seat 3 (team 1)
];

const flagHome: [{ x: number; y: number }, { x: number; y: number }] = [
  { x: bases[0].x, y: bases[0].y },
  { x: bases[1].x, y: bases[1].y },
];

/** Two mirrored PAIRS, no self-symmetric centre slot (a centre pickup is a tie
 * the lower-seat tank always wins — a real team-0 edge the balance sim found). */
const pickupSlots = [
  { x: 210, y: 410 },
  { x: 590, y: 870 },
  { x: 610, y: 430 },
  { x: 190, y: 850 },
];

function clearsKeepouts(r: Rect): boolean {
  const near = (px: number, py: number, dist: number): boolean => {
    const nx = Math.max(r.x, Math.min(px, r.x + r.w));
    const ny = Math.max(r.y, Math.min(py, r.y + r.h));
    return Math.hypot(px - nx, py - ny) < dist;
  };
  for (const b of bases) if (near(b.x, b.y, BASE_R + 70)) return false;
  for (const s of spawns) if (near(s.x, s.y, 46)) return false;
  for (const p of pickupSlots) if (near(p.x, p.y, 44)) return false;
  return true;
}

function overlapsAny(r: Rect, list: Rect[]): boolean {
  return list.some(
    (o) => r.x < o.x + o.w + 12 && r.x + r.w + 12 > o.x && r.y < o.y + o.h + 12 && r.y + r.h + 12 > o.y,
  );
}

function addPair(out: Rect[], r: Rect): void {
  const m = mirror(r);
  if (!clearsKeepouts(r) || !clearsKeepouts(m)) return;
  if (overlapsAny(r, out) || overlapsAny(m, out)) return;
  out.push(r, m);
}

function addCentered(out: Rect[], w: number, h: number): void {
  const r = { x: CX - w / 2, y: CY - h / 2, w, h };
  if (clearsKeepouts(r) && !overlapsAny(r, out)) out.push(r);
}

/*
 * The single most important geometric fact, from the balance sim: a flag run only
 * completes when there is cover ON THE RETURN PATH through the middle. Every mode
 * lays cover across the midfield; the amount is the real mode knob. These are the
 * exact layouts the sim signed off, rotated 90° into portrait.
 */

function clashWalls(_rng: Rng): Rect[] {
  const out: Rect[] = [];
  addCentered(out, WALL, 150);
  addPair(out, { x: 180, y: 500, w: 140, h: WALL });
  addPair(out, { x: 480, y: 500, w: 140, h: WALL });
  return out;
}

function labyrinthWalls(rng: Rng): Rect[] {
  const out: Rect[] = [];
  const j = (): number => randFloat(rng, -10, 10);
  addCentered(out, WALL, 150);
  addCentered(out, 150, WALL);
  addPair(out, { x: 170, y: 500 + j(), w: 130, h: WALL });
  addPair(out, { x: 500, y: 500 + j(), w: 130, h: WALL });
  addPair(out, { x: 330 + j(), y: 350, w: WALL, h: 130 });
  addPair(out, { x: 300 + j(), y: 640, w: 90, h: WALL });
  return out;
}

function rampartWalls(_rng: Rng): Rect[] {
  const out: Rect[] = [];
  addCentered(out, WALL, 150);
  addCentered(out, 220, WALL);
  addPair(out, { x: 170, y: 470, w: 140, h: WALL });
  addPair(out, { x: 490, y: 470, w: 140, h: WALL });
  return out;
}

export function buildArena(seed: number, style: WallStyle): Arena {
  const rng = makeRng(seed ^ 0x9e37_79b9);
  let walls: Rect[];
  if (style === 'labyrinth') walls = labyrinthWalls(rng);
  else if (style === 'rampart') walls = rampartWalls(rng);
  else walls = clashWalls(rng);
  return {
    walls,
    bases,
    spawns: spawns.map((s) => ({ ...s })),
    flagHome: [{ ...flagHome[0] }, { ...flagHome[1] }],
    pickupSlots: pickupSlots.map((p) => ({ ...p })),
  };
}

export function teamOfSeat(seat: number): number {
  return seat % 2;
}
