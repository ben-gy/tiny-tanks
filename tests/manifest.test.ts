import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('install assets', () => {
  it('ships a valid webmanifest with standalone display and three icons', () => {
    const m = JSON.parse(readFileSync(join(ROOT, 'public/manifest.webmanifest'), 'utf8'));
    expect(m.display).toBe('standalone');
    expect(m.background_color).toBe('#0a0e1a');
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  });

  it('every referenced icon is a real PNG on disk', () => {
    for (const f of ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png']) {
      const buf = readFileSync(join(ROOT, 'public/icons', f));
      expect(buf.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
      expect(buf.length).toBeGreaterThan(500);
    }
  });

  it('index.html wires the iOS icon + manifest (iOS ignores the manifest icons)', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('apple-mobile-web-app-capable');
    // the mandatory analytics beacon, and no other tracker
    expect(html).toContain('static.cloudflareinsights.com/beacon.min.js');
  });
});
