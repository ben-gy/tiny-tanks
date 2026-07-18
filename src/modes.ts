/**
 * modes.ts — the three shapes a round can take.
 *
 * Every knob here changes the SPATIAL problem — the wall layout — not the size
 * of a number. That is the whole test a mode has to pass (principle 14): if you
 * can describe the difference as "the same game but more X", it is a difficulty
 * slider wearing a mode's name and it gets cut.
 *
 *  - Clash: an open arena with a few chunky blocks. Fights are direct, banks are
 *    a luxury. The baseline.
 *  - Labyrinth: a dense field of cover. You almost never have a straight line to
 *    anyone, so the ricochet is the primary weapon and the flag run is a stealth
 *    problem — a different game on the same rules.
 *  - Rampart: an open middle, but each base sits behind a wall with one gap.
 *    Grabbing the flag is easy; getting OUT past a defender in the choke is the
 *    game. Attack/defence, where Clash is a brawl.
 *
 * The HOST's pick is what the room plays, and it travels frozen inside the round
 * start (engine/rematch.ts `roundOpts()`). Guests render `state().hostOpts`,
 * never their own local pick — a mode that changes the walls is a mode two peers
 * could otherwise disagree about, and then they are playing different arenas on
 * the same seed.
 */

export type ModeId = 'clash' | 'labyrinth' | 'rampart';

export type WallStyle = 'clash' | 'labyrinth' | 'rampart';

export interface Mode {
  id: ModeId;
  name: string;
  /** Which arena generator to run (see arena.ts). */
  walls: WallStyle;
  /** Captures needed to win the round. */
  capTarget: number;
  /** Round clock (seconds). A backstop; most rounds end on the cap. */
  roundSeconds: number;
  /** One line, shown under the name — what it FEELS like, not the numbers. */
  blurb: string;
}

export const MODES: Record<ModeId, Mode> = {
  clash: {
    id: 'clash',
    name: 'Clash',
    walls: 'clash',
    capTarget: 3,
    roundSeconds: 150,
    blurb: 'Open arena, a few blocks. Straight shots and short flag runs.',
  },
  labyrinth: {
    id: 'labyrinth',
    name: 'Labyrinth',
    walls: 'labyrinth',
    capTarget: 3,
    roundSeconds: 180,
    blurb: 'Dense cover. Bank shots around corners; sneak the flag through the maze.',
  },
  rampart: {
    id: 'rampart',
    name: 'Rampart',
    walls: 'rampart',
    capTarget: 3,
    roundSeconds: 165,
    blurb: 'Each base walled with one gap. Breach the choke, hold the door.',
  },
};

export const DEFAULT_MODE: ModeId = 'clash';
export const MODE_LIST: Mode[] = [MODES.clash, MODES.labyrinth, MODES.rampart];

/**
 * Resolve a mode id off the wire / URL / storage. Never trust it: an older peer
 * or a hand-edited message would otherwise hand `undefined` to the arena
 * generator, which is a wall-less void that never ends. `Object.hasOwn`, not a
 * plain `MODES[id] || …`, because MODES inherits from Object.prototype and
 * `MODES['constructor']` is truthy — the exact broken arena this guards against.
 * Pinned by tests/modes.test.ts.
 */
export function modeOf(id: unknown): Mode {
  if (typeof id === 'string' && Object.hasOwn(MODES, id)) return MODES[id as ModeId];
  return MODES[DEFAULT_MODE];
}
