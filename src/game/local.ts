// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * local.ts — the solo game: one human (seat 0, Amber) and three bots, run
 * locally with no network. It is the exact same Sim and Bot the multiplayer host
 * uses, so a solo match IS a full 2v2 — the human plus a bot ally against two
 * enemy bots — and everything that balances the multiplayer game balances this.
 */

import { Bot } from './bot';
import { Sim, type TankInput } from './sim';
import type { Mode } from '../modes';

export class Local {
  readonly sim: Sim;
  private bots: Bot[] = [];

  constructor(seed: number, mode: Mode) {
    this.sim = new Sim({ seed, mode });
    // seats 1..3 are bots; seat 0 is the player
    for (let seat = 1; seat < this.sim.tanks.length; seat++) this.bots[seat] = new Bot(seed, seat);
  }

  step(human: TankInput): void {
    const inputs: (TankInput | undefined)[] = [];
    for (const t of this.sim.tanks) {
      inputs[t.seat] = t.seat === 0 ? human : this.bots[t.seat].input(this.sim);
    }
    this.sim.step(inputs);
  }
}
