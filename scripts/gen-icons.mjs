// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * gen-icons.mjs — rasterise public/favicon.svg into the PNGs a home-screen
 * install needs. Run: `node scripts/gen-icons.mjs`. Outputs to public/icons/.
 *
 * No image dependency (no sharp/resvg): this encodes the SHAPES of favicon.svg
 * (rounded panel, white barrel, amber tank body + turret, a teal flag accent) in
 * the same 64-unit space and palette, so the icons stay the game's identity
 * rather than a second, drifting one. Change favicon.svg and change this too;
 * tests/manifest.test.ts checks the outputs exist and are real PNGs. Coverage is
 * 4×4 supersampled signed distance for clean edges without a font/AA engine.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [0x0a, 0x0e, 0x1a];
const AMBER = [0xe6, 0x9f, 0x00];
const AMBER_HI = [0xf4, 0xb5, 0x2e];
const TEAL = [0x12, 0xb8, 0x86];
const WHITE = [0xe8, 0xee, 0xf8];
const POLE = [0xcd, 0xd6, 0xe6];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (a) => Math.hypot(a[0], a[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

const sdCircle = (p, c, r) => len(sub(p, c)) - r;

function sdRoundRect(p, x, y, w, h, r) {
  const cx = Math.abs(p[0] - (x + w / 2)) - (w / 2 - r);
  const cy = Math.abs(p[1] - (y + h / 2)) - (h / 2 - r);
  const ox = Math.max(cx, 0);
  const oy = Math.max(cy, 0);
  return Math.min(Math.max(cx, cy), 0) + Math.hypot(ox, oy) - r;
}

function sdSegment(p, a, b, w) {
  const pa = sub(p, a);
  const ba = sub(b, a);
  const h = Math.min(1, Math.max(0, dot(pa, ba) / Math.max(dot(ba, ba), 1e-9)));
  return len([pa[0] - ba[0] * h, pa[1] - ba[1] * h]) - w / 2;
}

function sdTriangle(p, a, b, c) {
  const e0 = sub(b, a);
  const e1 = sub(c, b);
  const e2 = sub(a, c);
  const v0 = sub(p, a);
  const v1 = sub(p, b);
  const v2 = sub(p, c);
  const c01 = (x) => Math.min(1, Math.max(0, x));
  const pq0 = sub(v0, [e0[0] * c01(dot(v0, e0) / dot(e0, e0)), e0[1] * c01(dot(v0, e0) / dot(e0, e0))]);
  const pq1 = sub(v1, [e1[0] * c01(dot(v1, e1) / dot(e1, e1)), e1[1] * c01(dot(v1, e1) / dot(e1, e1))]);
  const pq2 = sub(v2, [e2[0] * c01(dot(v2, e2) / dot(e2, e2)), e2[1] * c01(dot(v2, e2) / dot(e2, e2))]);
  const s = Math.sign(e0[0] * e2[1] - e0[1] * e2[0]);
  const dx = Math.min(Math.min(dot(pq0, pq0), dot(pq1, pq1)), dot(pq2, pq2));
  const dy = Math.min(
    Math.min(s * (v0[0] * e0[1] - v0[1] * e0[0]), s * (v1[0] * e1[1] - v1[1] * e1[0])),
    s * (v2[0] * e2[1] - v2[1] * e2[0]),
  );
  return -Math.sqrt(dx) * Math.sign(dy);
}

function layers(rounded) {
  return [
    { sd: (p) => sdRoundRect(p, 0, 0, 64, 64, rounded ? 14 : 0), color: BG, alpha: 1 },
    // barrel, body, treads, turret — the tank from favicon.svg
    { sd: (p) => sdRoundRect(p, 29, 8, 6, 26, 3), color: WHITE, alpha: 1 },
    { sd: (p) => sdRoundRect(p, 16, 30, 32, 24, 8), color: AMBER, alpha: 1 },
    { sd: (p) => sdSegment(p, [16, 38], [48, 38], 2), color: BG, alpha: 0.32 },
    { sd: (p) => sdSegment(p, [16, 46], [48, 46], 2), color: BG, alpha: 0.32 },
    { sd: (p) => sdCircle(p, [32, 38], 9), color: AMBER_HI, alpha: 1 },
    // teal flag accent
    { sd: (p) => sdSegment(p, [46, 10], [46, 22], 1), color: POLE, alpha: 1 },
    { sd: (p) => sdTriangle(p, [46, 10], [56, 13], [46, 16]), color: TEAL, alpha: 1 },
  ];
}

function render(size, { rounded = true, inset = 0 } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4;
  const art = layers(rounded);
  const bg = art[0];
  const fg = art.slice(1);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = ((x + (sx + 0.5) / SS) / size) * 64;
          const uy = ((y + (sy + 0.5) / SS) / size) * 64;
          const p = [ux, uy];
          const q = [(ux - 32) / (1 - inset) + 32, (uy - 32) / (1 - inset) + 32];
          let cr = 0;
          let cg = 0;
          let cb = 0;
          let ca = 0;
          for (const layer of [{ ...bg, p }, ...fg.map((l) => ({ ...l, p: q }))]) {
            const cov = Math.min(1, Math.max(0, 0.5 - layer.sd(layer.p) * (size / 64) * SS)) * layer.alpha;
            if (cov <= 0) continue;
            cr = layer.color[0] * cov + cr * (1 - cov);
            cg = layer.color[1] * cov + cg * (1 - cov);
            cb = layer.color[2] * cov + cb * (1 - cov);
            ca = cov + ca * (1 - cov);
          }
          r += cr;
          g += cg;
          b += cb;
          a += ca;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) | 0, 8 + data.length);
  return out;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const targets = [
  { file: 'icon-192.png', size: 192, opts: {} },
  { file: 'icon-512.png', size: 512, opts: {} },
  { file: 'icon-512-maskable.png', size: 512, opts: { rounded: false, inset: 0.2 } },
  { file: 'apple-touch-icon.png', size: 180, opts: { rounded: false } },
];
for (const { file, size, opts } of targets) {
  const png = encodePng(render(size, opts), size);
  writeFileSync(join(OUT, file), png);
  console.log(`${file}  ${size}x${size}  ${png.length} bytes`);
}
