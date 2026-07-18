import { describe, expect, it } from 'vitest';
import { angDelta, bouncePointRect, resolveCircleRect, segIntersectsRect, turnToward } from '../src/game/geom';

const R = { x: 100, y: 100, w: 50, h: 50 };

describe('resolveCircleRect', () => {
  it('leaves a circle clear of the rect untouched', () => {
    const r = resolveCircleRect(300, 300, 10, R);
    expect(r.hit).toBe(false);
    expect(r.x).toBe(300);
  });
  it('pushes an overlapping circle out along the nearest face', () => {
    const r = resolveCircleRect(95, 125, 10, R); // left of the rect, overlapping
    expect(r.hit).toBe(true);
    expect(r.x).toBeLessThanOrEqual(90); // pushed left of x=100 by radius
  });
  it('ejects a circle whose centre is inside', () => {
    const r = resolveCircleRect(120, 105, 10, R); // inside, near the top face
    expect(r.hit).toBe(true);
    expect(r.y).toBeLessThan(100);
  });
});

describe('bouncePointRect', () => {
  it('reflects vx when a bullet crosses a vertical face', () => {
    const b = bouncePointRect(148, 125, 60, 0, 5, R); // moving right into the rect
    expect(b.hit).toBe(true);
    expect(b.vx).toBe(-60);
    expect(b.vy).toBe(0);
  });
  it('reflects vy when a bullet crosses a horizontal face', () => {
    const b = bouncePointRect(125, 98, 0, 60, 5, R); // moving down into the top
    expect(b.hit).toBe(true);
    expect(b.vy).toBe(-60);
  });
  it('misses cleanly when far away', () => {
    expect(bouncePointRect(500, 500, 10, 10, 5, R).hit).toBe(false);
  });
});

describe('segIntersectsRect', () => {
  it('detects a line crossing the rect', () => {
    expect(segIntersectsRect(50, 125, 250, 125, R)).toBe(true);
  });
  it('rejects a line that misses', () => {
    expect(segIntersectsRect(50, 300, 250, 300, R)).toBe(false);
  });
});

describe('angle helpers', () => {
  it('angDelta returns the shortest signed turn', () => {
    expect(angDelta(0.1, -0.1)).toBeCloseTo(-0.2, 5);
    expect(Math.abs(angDelta(0, Math.PI * 2))).toBeLessThan(1e-9);
  });
  it('turnToward snaps when within maxStep, else steps toward', () => {
    expect(turnToward(0, 0.05, 0.1)).toBeCloseTo(0.05, 5);
    expect(turnToward(0, 1, 0.1)).toBeCloseTo(0.1, 5);
    expect(turnToward(0, -1, 0.1)).toBeCloseTo(-0.1, 5);
  });
});
