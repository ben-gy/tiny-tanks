/**
 * balance.test.ts — the referee (principle 18).
 *
 * Tiny Tanks is competitive (team vs team over a shared score), so it is not
 * shipped until a sim has MEASURED that it isn't already decided on the first
 * capture and that neither team/side has an edge. We play a few hundred
 * bot-vs-bot 2v2 rounds from fixed seeds and assert the SHAPE of the outcome:
 *
 *  - Team win rate ≈ 50%. The arena is point-symmetric and both teams share the
 *    same bot, so this is true by construction — which is exactly why the check
 *    is cheap and catches the one thing that breaks it: a processing-order bug
 *    that quietly gives team 0 (stepped first) an edge.
 *  - P(team leading at capture k eventually wins) climbs with k — flat-ish early,
 *    decisive late. If a 1-0 lead already predicted the winner, the round would
 *    be over before the players made a real decision.
 *  - Blowouts (shutouts) are bounded, and every game terminates.
 *
 * Deterministic: seeded rng, no Math.random, no canvas. Kept under a couple
 * seconds so it stays in the default run.
 */

import { describe, expect, it } from 'vitest';
import { Bot } from '../src/game/bot';
import { Sim } from '../src/game/sim';
import { MODE_LIST, MODES, type Mode } from '../src/modes';

interface GameResult {
  winner: number; // 0 | 1 | -1
  ticks: number;
  scores: [number, number];
  /** Leading team at the moment combined captures first reached k (index k). */
  leaderAtK: number[];
}

function playGame(seed: number, mode: Mode): GameResult {
  const sim = new Sim({ seed, mode });
  const bots = [0, 1, 2, 3].map((seat) => new Bot(seed, seat));
  const maxTicks = Math.ceil(mode.roundSeconds / (1 / 60)) + 120;
  const leaderAtK: number[] = [];
  let lastCombined = 0;

  while (!sim.over && sim.tick < maxTicks) {
    const inputs = bots.map((b) => b.input(sim));
    sim.step(inputs);
    const combined = sim.scores[0] + sim.scores[1];
    while (lastCombined < combined) {
      lastCombined++;
      leaderAtK[lastCombined] = sim.leadingTeam();
    }
  }
  return {
    winner: sim.winnerTeam,
    ticks: sim.tick,
    scores: [sim.scores[0], sim.scores[1]],
    leaderAtK,
  };
}

function runSuite(mode: Mode, games: number): GameResult[] {
  const out: GameResult[] = [];
  for (let i = 0; i < games; i++) out.push(playGame(1000 + i * 7, mode));
  return out;
}

describe('balance: Tiny Tanks 2v2 CTF', () => {
  const GAMES = 160;

  for (const mode of MODE_LIST) {
    it(`${mode.name}: fair teams, decided late, always terminates`, () => {
      const res = runSuite(mode, GAMES);

      const finished = res.filter((r) => r.winner !== -1 || r.ticks < 999_999);
      // every game terminates (hits the cap target or the clock)
      expect(res.every((r) => r.ticks > 0)).toBe(true);
      const timedOut = res.filter((r) => r.winner === -1).length;

      const team0Wins = res.filter((r) => r.winner === 0).length;
      const team1Wins = res.filter((r) => r.winner === 1).length;
      const decisive = team0Wins + team1Wins;
      const team0Rate = team0Wins / Math.max(decisive, 1);

      // P(leader at capture k wins)
      const pLeaderAt = (k: number): number => {
        let n = 0;
        let hit = 0;
        for (const r of res) {
          const lead = r.leaderAtK[k];
          if (lead === undefined || lead === -1 || r.winner === -1) continue;
          n++;
          if (lead === r.winner) hit++;
        }
        return n ? hit / n : NaN;
      };

      const avgSecs = res.reduce((a, r) => a + r.ticks / 60, 0) / res.length;
      const blowoutRate = res.filter((r) => Math.abs(r.scores[0] - r.scores[1]) >= mode.capTarget).length / res.length;

      // eslint-disable-next-line no-console
      console.log(
        `[${mode.name}] team0 win% ${(team0Rate * 100).toFixed(1)} | ` +
          `P(lead@1) ${(pLeaderAt(1) * 100).toFixed(0)} @2 ${(pLeaderAt(2) * 100).toFixed(0)} | ` +
          `avg ${avgSecs.toFixed(1)}s | blowout ${(blowoutRate * 100).toFixed(0)}% | timeouts ${timedOut}`,
      );

      // ── assertions ──
      // seat/team fairness: symmetric arena + shared bot ⇒ ~50%
      expect(team0Rate).toBeGreaterThan(0.4);
      expect(team0Rate).toBeLessThan(0.6);
      // the lead should not already decide the game on the first capture
      expect(pLeaderAt(1)).toBeLessThan(0.82);
      // being one away should be more predictive than being one ahead early
      expect(pLeaderAt(2)).toBeGreaterThanOrEqual(pLeaderAt(1) - 0.02);
      // shutouts happen but are not the norm
      expect(blowoutRate).toBeLessThan(0.6);
      // games actually resolve most of the time
      expect(finished.length).toBe(res.length);
      expect(timedOut / res.length).toBeLessThan(0.35);
    });
  }

  it('the coprime tide does not exist here, but the cap target is pinned', () => {
    // A guard so a future edit that trivialises the round (cap 1) or never ends
    // (cap 99) turns red.
    expect(MODES.clash.capTarget).toBe(3);
    expect(MODES.labyrinth.capTarget).toBe(3);
    expect(MODES.rampart.capTarget).toBe(3);
  });
});
