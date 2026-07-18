import { describe, expect, it } from 'vitest';
import { DEFAULT_MODE, MODE_LIST, modeOf } from '../src/modes';

describe('modeOf — trust nothing off the wire', () => {
  it('resolves the real modes', () => {
    expect(modeOf('clash').id).toBe('clash');
    expect(modeOf('labyrinth').id).toBe('labyrinth');
    expect(modeOf('rampart').id).toBe('rampart');
  });
  it('falls back for unknown ids', () => {
    expect(modeOf('nonsense').id).toBe(DEFAULT_MODE);
    expect(modeOf(undefined).id).toBe(DEFAULT_MODE);
    expect(modeOf(42).id).toBe(DEFAULT_MODE);
  });
  it('does NOT leak Object.prototype keys as a Mode of undefined fields', () => {
    // MODES is an object literal, so MODES['constructor'] is truthy — a naive
    // `MODES[id] || DEFAULT` would return it as a Mode with no walls/capTarget.
    for (const key of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      const m = modeOf(key);
      expect(MODE_LIST).toContain(m);
      expect(typeof m.capTarget).toBe('number');
      expect(m.walls).toBeTypeOf('string');
    }
  });
  it('pins the cap target so a future edit can’t trivialise the round', () => {
    for (const m of MODE_LIST) expect(m.capTarget).toBe(3);
  });
});
