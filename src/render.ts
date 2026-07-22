// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * render.ts — draw the arena. Reads the Sim, never writes it.
 *
 * Top-down. The whole world is fitted into the canvas with a letterbox, and a
 * screen-shake offset is applied to the world transform so the HUD (drawn in
 * screen space by the DOM) never shakes with it.
 *
 * Teams are told apart by COLOUR and by SIDE (Amber left, Teal right), and the
 * Okabe–Ito amber/teal pair survives the common colour-vision deficiencies. The
 * player's own tank carries a white ring — "which one is me" is the question
 * that costs you the round.
 */

import { ARENA_H, ARENA_W, BASE_R, teamOfSeat } from './game/arena';
import {
  FLAG_CARRIED,
  FLAG_DROPPED,
  FLAG_HOME,
  PICKUP_R,
  TANK_MAX_HP,
  TANK_R,
  type Pickup,
  type Sim,
  type Tank,
} from './game/sim';
import type { Fx } from './fx';

export const TEAM_COLORS = ['#e69f00', '#12b886']; // Amber, Teal — colour-blind-safe
export const TEAM_NAMES = ['Amber', 'Teal'];

export function teamColor(team: number): string {
  return TEAM_COLORS[team % 2];
}
export function seatColor(seat: number): string {
  return teamColor(teamOfSeat(seat));
}

const PICKUP_STYLE: Record<string, { c: string; g: string }> = {
  spread: { c: '#ffd43b', g: 'W' },
  rapid: { c: '#ff922b', g: '»' },
  speed: { c: '#4dabf7', g: '›' },
  shield: { c: '#a5d8ff', g: '◈' },
  ricochet: { c: '#e599f7', g: '↺' },
};

export interface View {
  scale: number;
  ox: number;
  oy: number;
}

export function computeView(w: number, h: number): View {
  const safeW = Math.max(w, 1);
  const safeH = Math.max(h, 1);
  const margin = 16;
  const scale = Math.min((safeW - margin) / ARENA_W, (safeH - margin) / ARENA_H);
  return { scale, ox: (safeW - ARENA_W * scale) / 2, oy: (safeH - ARENA_H * scale) / 2 };
}

export interface RenderOpts {
  sim: Sim;
  fx: Fx;
  view: View;
  selfSeat: number;
  lead: number; // extrapolation seconds
  reduced: boolean;
}

export function render(ctx: CanvasRenderingContext2D, w: number, h: number, o: RenderOpts): void {
  const { sim, fx, view: v } = o;
  const off = fx.offset();
  const S = v.scale;
  const X = (wx: number): number => v.ox + (wx + off.x) * S;
  const Y = (wy: number): number => v.oy + (wy + off.y) * S;

  ctx.clearRect(0, 0, w, h);

  // ── field ──
  ctx.fillStyle = '#0e1320';
  ctx.fillRect(X(0), Y(0), ARENA_W * S, ARENA_H * S);
  // subtle centre line
  ctx.strokeStyle = 'rgba(140,165,205,0.12)';
  ctx.lineWidth = Math.max(1, S);
  ctx.beginPath();
  ctx.moveTo(X(ARENA_W / 2), Y(0));
  ctx.lineTo(X(ARENA_W / 2), Y(ARENA_H));
  ctx.stroke();
  // border
  ctx.strokeStyle = 'rgba(140,165,205,0.4)';
  ctx.lineWidth = Math.max(1, 2 * S);
  ctx.strokeRect(X(0), Y(0), ARENA_W * S, ARENA_H * S);

  // ── bases ──
  for (const b of sim.arena.bases) {
    const c = teamColor(b.team);
    ctx.beginPath();
    ctx.arc(X(b.x), Y(b.y), BASE_R * S, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.14;
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = Math.max(1, 2 * S);
    ctx.strokeStyle = c;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ── walls ──
  ctx.fillStyle = '#41506b';
  ctx.strokeStyle = 'rgba(180,195,225,0.5)';
  ctx.lineWidth = Math.max(1, S);
  for (const wl of sim.arena.walls) {
    const x = X(wl.x);
    const y = Y(wl.y);
    ctx.beginPath();
    ctx.rect(x, y, wl.w * S, wl.h * S);
    ctx.fill();
    ctx.stroke();
  }

  // ── pickups ──
  for (const p of sim.pickups) {
    if (!p.active) continue;
    drawPickup(ctx, p, X(p.x), Y(p.y), S, o.reduced, sim.time);
  }

  // ── flags ──
  for (const f of sim.flags) {
    if (f.state === FLAG_CARRIED) continue; // drawn on the carrier
    const bob = f.state === FLAG_HOME ? Math.sin(sim.time * 3) * 3 : 0;
    drawFlag(ctx, X(f.x), Y(f.y - 22 + bob), S, teamColor(f.team), f.state === FLAG_DROPPED);
  }

  // ── particles ──
  for (const p of fx.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), p.size * S, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ── bullets ──
  for (const b of sim.bullets) {
    const bx = X(b.x + b.vx * o.lead);
    const by = Y(b.y + b.vy * o.lead);
    const c = teamColor(b.team);
    if (!o.reduced) {
      ctx.beginPath();
      ctx.arc(bx, by, 7 * S, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.22;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(bx, by, 4 * S, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, by, 2.4 * S, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  }

  // ── tanks ──
  for (const t of sim.tanks) {
    if (!t.alive) continue;
    drawTank(ctx, t, X(t.x + t.vx * o.lead), Y(t.y + t.vy * o.lead), S, t.seat === o.selfSeat, sim);
  }
}

function drawFlag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  S: number,
  color: string,
  dropped: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = dropped ? 0.85 : 1;
  // pole
  ctx.strokeStyle = '#cdd6e6';
  ctx.lineWidth = Math.max(1, 2 * S);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + 26 * S);
  ctx.stroke();
  // flag
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 20 * S, y + 6 * S);
  ctx.lineTo(x, y + 12 * S);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPickup(
  ctx: CanvasRenderingContext2D,
  p: Pickup,
  x: number,
  y: number,
  S: number,
  reduced: boolean,
  time: number,
): void {
  const st = PICKUP_STYLE[p.type] ?? { c: '#fff', g: '?' };
  const pulse = reduced ? 1 : 1 + Math.sin(time * 4) * 0.08;
  const r = PICKUP_R * S * pulse;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  const rr = r * 0.5;
  roundRect(ctx, -r, -r, r * 2, r * 2, rr);
  ctx.fillStyle = st.c;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0e1320';
  ctx.font = `${Math.round(r * 1.3)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(st.g, 0, r * 0.06);
  ctx.restore();
}

function drawTank(
  ctx: CanvasRenderingContext2D,
  t: Tank,
  x: number,
  y: number,
  S: number,
  isSelf: boolean,
  sim: Sim,
): void {
  const c = teamColor(t.team);
  const R = TANK_R * S;
  const blink = t.invuln > 0 && Math.floor(t.invuln * 10) % 2 === 0;

  ctx.save();
  ctx.translate(x, y);

  // self ring
  if (isSelf) {
    ctx.beginPath();
    ctx.arc(0, 0, R + 6 * S, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(1, 1.5 * S);
    ctx.stroke();
  }

  ctx.globalAlpha = blink ? 0.4 : 1;

  // body (rounded square) rotated to heading
  ctx.save();
  ctx.rotate(t.ang);
  roundRect(ctx, -R, -R * 0.82, R * 2, R * 1.64, R * 0.32);
  ctx.fillStyle = t.hp < TANK_MAX_HP ? shade(c, -0.35) : c;
  ctx.fill();
  ctx.strokeStyle = '#0e1320';
  ctx.lineWidth = Math.max(1, 1.5 * S);
  ctx.stroke();
  // tread hints
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.moveTo(-R, -R * 0.5);
  ctx.lineTo(R, -R * 0.5);
  ctx.moveTo(-R, R * 0.5);
  ctx.lineTo(R, R * 0.5);
  ctx.stroke();
  ctx.restore();

  // turret + barrel rotated to aim
  ctx.save();
  ctx.rotate(t.aim);
  ctx.fillStyle = shade(c, 0.15);
  ctx.strokeStyle = '#0e1320';
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e8eef8';
  roundRect(ctx, 0, -R * 0.16, R * 1.5, R * 0.32, R * 0.1);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.globalAlpha = 1;

  // shield ring
  if (t.shield > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, R + 3 * S, 0, Math.PI * 2);
    ctx.strokeStyle = '#a5d8ff';
    ctx.lineWidth = Math.max(1, 2 * S);
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // carried flag on top
  if (t.carrying >= 0) {
    drawFlag(ctx, R * 0.2, -R - 24 * S, S, teamColor(t.carrying), false);
  }
  ctx.restore();

  // buff pips under the tank
  const buffs: string[] = [];
  if (t.spreadT > 0) buffs.push('#ffd43b');
  if (t.rapidT > 0) buffs.push('#ff922b');
  if (t.speedT > 0) buffs.push('#4dabf7');
  if (t.ricoT > 0) buffs.push('#e599f7');
  buffs.forEach((col, i) => {
    ctx.beginPath();
    ctx.arc(x - (buffs.length - 1) * 4 * S + i * 8 * S, y + R + 7 * S, 2.4 * S, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  });
  void sim;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Lighten (>0) or darken (<0) a hex colour. */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const f = (c: number): number => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
  r = f(r);
  g = f(g);
  b = f(b);
  return `rgb(${r},${g},${b})`;
}
