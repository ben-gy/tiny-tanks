/**
 * layout.test.ts — the source-level invariant guard for arena geometry
 * (principle 20). jsdom has no layout engine, so a real overflow only surfaces in
 * a browser — but the ROOT CAUSE of a bad mode layout is always geometry that
 * doesn't respect the arena, and THAT is checkable here, per mode, deterministically.
 *
 * For every mode we assert: every wall sits fully inside the arena, every wall has
 * a 180° point-mirror (the fairness guarantee — a mirror-broken wall is a seat
 * bias), and no wall smothers a base, spawn, or flag home (which would make the
 * game unplayable). If a future edit pushes a wall off-field or off-symmetry,
 * this goes red before it ever reaches a phone.
 */

import { describe, expect, it } from 'vitest';
import { ARENA_H, ARENA_W, BASE_R, buildArena, teamOfSeat } from '../src/game/arena';
import { TANK_R } from '../src/game/sim';
import type { WallStyle } from '../src/modes';

const STYLES: WallStyle[] = ['clash', 'labyrinth', 'rampart'];

function nearestPoint(r: { x: number; y: number; w: number; h: number }, px: number, py: number): number {
  const nx = Math.max(r.x, Math.min(px, r.x + r.w));
  const ny = Math.max(r.y, Math.min(py, r.y + r.h));
  return Math.hypot(px - nx, py - ny);
}

describe.each(STYLES)('arena layout: %s', (style) => {
  const a = buildArena(1234, style);

  it('has walls', () => {
    expect(a.walls.length).toBeGreaterThan(0);
  });

  it('every wall sits fully inside the arena', () => {
    for (const w of a.walls) {
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.y).toBeGreaterThanOrEqual(0);
      expect(w.x + w.w).toBeLessThanOrEqual(ARENA_W);
      expect(w.y + w.h).toBeLessThanOrEqual(ARENA_H);
    }
  });

  it('every wall has a 180° point-mirror (seat fairness)', () => {
    for (const w of a.walls) {
      const m = { x: ARENA_W - w.x - w.w, y: ARENA_H - w.y - w.h, w: w.w, h: w.h };
      const found = a.walls.some(
        (o) => Math.abs(o.x - m.x) < 0.01 && Math.abs(o.y - m.y) < 0.01 && o.w === m.w && o.h === m.h,
      );
      expect(found, `no mirror for ${JSON.stringify(w)}`).toBe(true);
    }
  });

  it('no wall blocks a base, a spawn, or a flag home', () => {
    for (const w of a.walls) {
      for (const b of a.bases) expect(nearestPoint(w, b.x, b.y)).toBeGreaterThan(BASE_R + 2);
      for (const s of a.spawns) expect(nearestPoint(w, s.x, s.y)).toBeGreaterThan(TANK_R + 4);
      for (const f of a.flagHome) expect(nearestPoint(w, f.x, f.y)).toBeGreaterThan(TANK_R);
    }
  });

  it('spawns map to the right team and are point-symmetric', () => {
    expect(teamOfSeat(0)).toBe(0);
    expect(teamOfSeat(1)).toBe(1);
    expect(a.spawns[0].x).toBeCloseTo(ARENA_W - a.spawns[1].x, 5);
    expect(a.spawns[0].y).toBeCloseTo(ARENA_H - a.spawns[1].y, 5);
  });

  it('pickup slots come in mirrored pairs (no self-symmetric contested slot)', () => {
    for (const p of a.pickupSlots) {
      const found = a.pickupSlots.some((o) => Math.abs(o.x - (ARENA_W - p.x)) < 0.01 && Math.abs(o.y - (ARENA_H - p.y)) < 0.01);
      expect(found).toBe(true);
      // and it must not BE its own mirror (that is the tie the lower seat wins)
      expect(Math.hypot(p.x - (ARENA_W - p.x), p.y - (ARENA_H - p.y))).toBeGreaterThan(1);
    }
  });
});
