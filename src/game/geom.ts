/**
 * geom.ts — the small pile of axis-aligned collision maths the whole game rests
 * on. Pure functions, no state, no DOM — so the sim that uses them stays a pure
 * function of (seed, mode, inputs) and the balance sim can run them headless.
 *
 * Everything here is AABB-based because every wall in Tiny Tanks is an
 * axis-aligned rectangle. That is not a shortcut — it is what makes a ricochet
 * legible: a bullet that bounces off a flat wall reflects one velocity component
 * cleanly, so you can read the angle and bank the shot. Rounded cover would make
 * the bounce a guess.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Closest point on rect `r` to (px,py). */
export function closestOnRect(r: Rect, px: number, py: number): { x: number; y: number } {
  return {
    x: Math.max(r.x, Math.min(px, r.x + r.w)),
    y: Math.max(r.y, Math.min(py, r.y + r.h)),
  };
}

/**
 * Push a circle of radius `rad` out of rect `r` if it overlaps. Returns the
 * corrected centre (unchanged when there is no overlap). Resolves along the
 * shortest axis of penetration, which is the stable choice for a tank sliding
 * along a wall.
 */
export function resolveCircleRect(
  cx: number,
  cy: number,
  rad: number,
  r: Rect,
): { x: number; y: number; hit: boolean } {
  const cp = closestOnRect(r, cx, cy);
  const dx = cx - cp.x;
  const dy = cy - cp.y;
  const d2 = dx * dx + dy * dy;
  if (d2 > rad * rad) return { x: cx, y: cy, hit: false };

  if (d2 > 1e-9) {
    // Outside the rect but within `rad` of its edge/corner: push straight out
    // along the surface normal.
    const d = Math.sqrt(d2);
    return { x: cp.x + (dx / d) * rad, y: cp.y + (dy / d) * rad, hit: true };
  }

  // Centre is INSIDE the rect — pick the nearest face and eject through it.
  const left = cx - r.x;
  const right = r.x + r.w - cx;
  const top = cy - r.y;
  const bottom = r.y + r.h - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: r.x - rad, y: cy, hit: true };
  if (m === right) return { x: r.x + r.w + rad, y: cy, hit: true };
  if (m === top) return { x: cx, y: r.y - rad, hit: true };
  return { x: cx, y: r.y + r.h + rad, hit: true };
}

/**
 * Reflect a moving point (a bullet) off rect `r` if it has crossed into it.
 * Returns the corrected position, the reflected velocity, and whether a bounce
 * happened. The axis reflected is the one with the smaller penetration, i.e. the
 * face the bullet actually came through.
 */
export function bouncePointRect(
  x: number,
  y: number,
  vx: number,
  vy: number,
  rad: number,
  r: Rect,
): { x: number; y: number; vx: number; vy: number; hit: boolean } {
  // Inflate the rect by the bullet radius; the bullet centre is then a point.
  const minX = r.x - rad;
  const minY = r.y - rad;
  const maxX = r.x + r.w + rad;
  const maxY = r.y + r.h + rad;
  if (x < minX || x > maxX || y < minY || y > maxY) return { x, y, vx, vy, hit: false };

  // Penetration depth on each axis toward the nearer face.
  const penL = x - minX;
  const penR = maxX - x;
  const penT = y - minY;
  const penB = maxY - y;
  const penX = Math.min(penL, penR);
  const penY = Math.min(penT, penB);

  if (penX < penY) {
    // Came through a vertical face — flip vx, eject horizontally.
    const nx = penL < penR ? minX : maxX;
    return { x: nx, y, vx: -vx, vy, hit: true };
  }
  const ny = penT < penB ? minY : maxY;
  return { x, y: ny, vx, vy: -vy, hit: true };
}

/** Does segment (ax,ay)->(bx,by) intersect rect `r`? Used for bot line-of-sight. */
export function segIntersectsRect(ax: number, ay: number, bx: number, by: number, r: Rect): boolean {
  // Liang–Barsky clip against the rect.
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // parallel: inside iff q>=0
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, ax - r.x)) return false;
  if (!clip(dx, r.x + r.w - ax)) return false;
  if (!clip(-dy, ay - r.y)) return false;
  if (!clip(dy, r.y + r.h - ay)) return false;
  return t0 <= t1;
}

/** Shortest signed angle from a to b, in (-π, π]. */
export function angDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Ease `a` toward `b` by at most `maxStep` radians, shortest way round. */
export function turnToward(a: number, b: number, maxStep: number): number {
  const d = angDelta(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}
