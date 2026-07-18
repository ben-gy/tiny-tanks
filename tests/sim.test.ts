import { describe, expect, it } from 'vitest';
import { ARENA_H, ARENA_W, teamOfSeat } from '../src/game/arena';
import {
  FLAG_CARRIED,
  FLAG_HOME,
  Sim,
  TANK_MAX_HP,
  type TankInput,
} from '../src/game/sim';
import { MODES } from '../src/modes';

const IDLE: TankInput = { mx: 0, my: 0, ax: 0, ay: 0, f: 0 };
const idles = (): TankInput[] => [IDLE, IDLE, IDLE, IDLE];

function fresh(): Sim {
  return new Sim({ seed: 5, mode: MODES.clash });
}

describe('setup', () => {
  it('has four tanks, two per team by seat parity', () => {
    const s = fresh();
    expect(s.tanks.length).toBe(4);
    expect(s.tanks.map((t) => t.team)).toEqual([0, 1, 0, 1]);
    expect(teamOfSeat(0)).toBe(0);
    expect(teamOfSeat(3)).toBe(1);
  });
  it('starts each tank at full hp and both scores at zero', () => {
    const s = fresh();
    expect(s.tanks.every((t) => t.hp === TANK_MAX_HP)).toBe(true);
    expect(s.scores).toEqual([0, 0]);
    expect(s.over).toBe(false);
  });
  it('spawns are point-symmetric between the teams', () => {
    const s = fresh();
    // seat 0 (team0) and seat 1 (team1) are counterparts under 180° rotation
    const a = s.arena.spawns[0];
    const b = s.arena.spawns[1];
    expect(a.x).toBeCloseTo(ARENA_W - b.x, 5);
    expect(a.y).toBeCloseTo(ARENA_H - b.y, 5);
  });
});

describe('flags & captures', () => {
  it('an enemy tank grabs the flag, with a break-away invuln', () => {
    const s = fresh();
    const t = s.tanks[1]; // team 1
    const flag0 = s.flags[0]; // team 0's flag, at team 0's base
    t.invuln = 0;
    t.x = flag0.x;
    t.y = flag0.y;
    s.step(idles());
    expect(flag0.state).toBe(FLAG_CARRIED);
    expect(t.carrying).toBe(0);
    expect(t.invuln).toBeGreaterThan(0.5); // grab invuln
  });

  it('carrying the flag home to your base scores and returns the flag', () => {
    const s = fresh();
    const t = s.tanks[1];
    const flag0 = s.flags[0];
    t.invuln = 0;
    t.x = flag0.x;
    t.y = flag0.y;
    s.step(idles()); // grab
    expect(t.carrying).toBe(0);
    // teleport to own base and step
    const base1 = s.arena.bases[1];
    t.x = base1.x;
    t.y = base1.y;
    s.step(idles());
    expect(s.scores[1]).toBe(1);
    expect(t.carrying).toBe(-1);
    expect(flag0.state).toBe(FLAG_HOME);
  });
});

describe('combat', () => {
  function bulletAt(s: Sim, owner: number, x: number, y: number): void {
    s.bullets.push({ x, y, vx: 0, vy: 0, owner, team: teamOfSeat(owner), life: 1, age: 1, bounces: 2, bounced: true });
  }

  it('takes two hits to destroy a tank', () => {
    const s = fresh();
    const target = s.tanks[1]; // team 1
    target.invuln = 0;
    bulletAt(s, 0, target.x, target.y); // team-0 bullet on the target
    s.step(idles());
    expect(target.hp).toBe(TANK_MAX_HP - 1);
    expect(target.alive).toBe(true);
    target.invuln = 0;
    bulletAt(s, 0, target.x, target.y);
    s.step(idles());
    expect(target.alive).toBe(false);
    expect(s.tanks[0].kills).toBe(1);
  });

  it('has no friendly fire between teammates', () => {
    const s = fresh();
    const mate = s.tanks[2]; // team 0
    mate.invuln = 0;
    bulletAt(s, 0, mate.x, mate.y); // seat 0 is also team 0
    s.step(idles());
    expect(mate.hp).toBe(TANK_MAX_HP);
    expect(mate.alive).toBe(true);
  });

  it('a shield absorbs a hit instead of hp', () => {
    const s = fresh();
    const target = s.tanks[1];
    target.invuln = 0;
    target.shield = 1;
    bulletAt(s, 0, target.x, target.y);
    s.step(idles());
    expect(target.shield).toBe(0);
    expect(target.hp).toBe(TANK_MAX_HP);
  });
});

describe('game over', () => {
  it('ends when a team reaches the cap target', () => {
    const s = fresh();
    s.scores[0] = MODES.clash.capTarget - 1;
    // force one more capture for team 0
    const t = s.tanks[0];
    const flag1 = s.flags[1];
    t.invuln = 0;
    t.x = flag1.x;
    t.y = flag1.y;
    s.step(idles()); // grab
    const base0 = s.arena.bases[0];
    t.x = base0.x;
    t.y = base0.y;
    s.step(idles()); // capture
    expect(s.over).toBe(true);
    expect(s.winnerTeam).toBe(0);
  });

  it('a level score at the clock is a draw, not a team-0 win', () => {
    const s = fresh();
    s.scores[0] = 2;
    s.scores[1] = 2;
    s.time = MODES.clash.roundSeconds;
    s.step(idles());
    expect(s.over).toBe(true);
    expect(s.winnerTeam).toBe(-1);
  });
});

/**
 * THE FAIRNESS GUARANTEE. Feed the two teams perfectly point-mirrored inputs and
 * the whole sim must stay mirrored — identical scores, mirror-image positions —
 * for the entire game. This is what makes the balance sim's ~50% team rate a
 * property of the game rather than luck; if a future change introduces a
 * seat/side bias (a self-symmetric contested pickup, an off-centre wall, a
 * team-0-first tiebreak), this goes red.
 */
describe('point-symmetry fairness', () => {
  const mirror = (i: TankInput): TankInput => ({ mx: -i.mx, my: -i.my, ax: -i.ax, ay: -i.ay, f: i.f });

  for (const modeId of ['clash', 'labyrinth', 'rampart'] as const) {
    it(`${modeId}: mirrored inputs keep the sim exactly mirrored`, () => {
      const s = new Sim({ seed: 99, mode: MODES[modeId] });
      for (let t = 0; t < 3000 && !s.over; t++) {
        const p = t * 0.019;
        const i0: TankInput = { mx: Math.cos(p), my: Math.sin(p * 1.4), ax: 1, ay: Math.sin(p), f: t % 3 === 0 ? 1 : 0 };
        const i2: TankInput = { mx: Math.cos(p * 0.6 + 1), my: Math.sin(p), ax: Math.cos(p), ay: 1, f: t % 4 === 0 ? 1 : 0 };
        s.step([i0, mirror(i0), i2, mirror(i2)]);
      }
      expect(s.scores[0]).toBe(s.scores[1]);
      const err = Math.hypot(s.tanks[0].x - (ARENA_W - s.tanks[1].x), s.tanks[0].y - (ARENA_H - s.tanks[1].y));
      expect(err).toBeLessThan(0.5);
    });
  }
});
