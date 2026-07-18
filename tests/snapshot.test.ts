import { describe, expect, it } from 'vitest';
import { Sim, type TankInput } from '../src/game/sim';
import { applySnapshot, encodeSnapshot } from '../src/game/snapshot';
import { MODES } from '../src/modes';

const IDLE: TankInput = { mx: 0, my: 0, ax: 0, ay: 0, f: 0 };

/** Advance a sim with crafted inputs so the state is non-trivial. */
function stir(seed: number): Sim {
  const s = new Sim({ seed, mode: MODES.rampart });
  for (let t = 0; t < 200; t++) {
    const p = t * 0.05;
    s.step([
      { mx: Math.cos(p), my: Math.sin(p), ax: 1, ay: 0, f: t % 2 },
      { mx: -1, my: 0.3, ax: -1, ay: 0.2, f: t % 3 === 0 ? 1 : 0 },
      IDLE,
      { mx: 0.2, my: -1, ax: 0, ay: 1, f: 0 },
    ]);
  }
  return s;
}

describe('snapshot round-trip', () => {
  it('reconstructs the world onto a fresh sim of the same seed', () => {
    const host = stir(7);
    const snap = encodeSnapshot(host, host.drainEvents());

    const client = new Sim({ seed: 7, mode: MODES.rampart });
    applySnapshot(client, snap);

    expect(client.tick).toBe(host.tick);
    expect(client.scores).toEqual(host.scores);
    expect(client.over).toBe(host.over);
    expect(client.winnerTeam).toBe(host.winnerTeam);
    expect(client.bullets.length).toBe(host.bullets.length);

    for (let i = 0; i < host.tanks.length; i++) {
      const a = host.tanks[i];
      const b = client.tanks[i];
      expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
      expect(b.hp).toBe(a.hp);
      expect(b.alive).toBe(a.alive);
      expect(b.carrying).toBe(a.carrying);
      expect(b.captures).toBe(a.captures);
      expect(b.kills).toBe(a.kills);
    }
    for (let i = 0; i < host.flags.length; i++) {
      expect(client.flags[i].state).toBe(host.flags[i].state);
      expect(client.flags[i].carrier).toBe(host.flags[i].carrier);
    }
  });

  it('carries events across the wire', () => {
    const s = new Sim({ seed: 3, mode: MODES.clash });
    // force a shot event
    s.tanks[0].invuln = 0;
    s.step([{ ...IDLE, ax: 1, f: 1 }, IDLE, IDLE, IDLE]);
    const events = s.drainEvents();
    const shot = events.filter((e) => e.t === 'shot');
    const snap = encodeSnapshot(s, events);
    const client = new Sim({ seed: 3, mode: MODES.clash });
    const got = applySnapshot(client, snap);
    expect(got.filter((e) => e.t === 'shot').length).toBe(shot.length);
  });
});
