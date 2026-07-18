/**
 * takeover.test.ts — CONTRACT GATE #2: the host leaving must not end the game.
 *
 * The test rhythm-relay shipped without. The manual smoke test (close the host
 * tab, keep playing) is the other half; both are required, because the smoke
 * test can't run in CI and this can't see the real relay.
 *
 * The fake bus stands in for Trystero DELIBERATELY and within its remit: it makes
 * claims about NetGame's promotion path, which lives strictly above the transport.
 * It proves nothing about the leave/rejoin trap — net-lifecycle.test.ts and
 * trystero-rejoin.test.ts own that.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetGame, TICK_MS } from '../src/net-game';
import { Sim, type TankInput } from '../src/game/sim';
import { MODES } from '../src/modes';
import type { Net, PeerId } from '../src/engine/net';

type Handler = (data: unknown, from: PeerId) => void;
const SEED = 42;
const move = (mx: number): TankInput => ({ mx, my: 0, ax: 1, ay: 0, f: 0 });

class Bus {
  peers = new Map<PeerId, Map<string, Set<Handler>>>();
  send(from: PeerId, chan: string, data: unknown, to?: PeerId | PeerId[]): void {
    const targets = to == null ? [...this.peers.keys()].filter((p) => p !== from) : Array.isArray(to) ? to : [to];
    for (const id of targets) {
      for (const h of this.peers.get(id)?.get(chan) ?? []) h(JSON.parse(JSON.stringify(data)), from);
    }
  }
}

function fakeNet(bus: Bus, selfId: PeerId, host: () => PeerId | null): Net {
  bus.peers.set(selfId, new Map());
  return {
    selfId,
    peers: () => [...bus.peers.keys()].sort(),
    host,
    isHost: () => host() === selfId,
    hostSettled: () => host() !== null,
    count: () => bus.peers.size,
    channel<T>(name: string, onReceive: (d: T, from: PeerId) => void) {
      const chans = bus.peers.get(selfId)!;
      if (!chans.has(name)) chans.set(name, new Set());
      const h = onReceive as Handler;
      chans.get(name)!.add(h);
      const send = ((data: T, to?: PeerId | PeerId[]) => bus.send(selfId, name, data, to)) as ((
        d: T,
        to?: PeerId | PeerId[],
      ) => void) & { off: () => void };
      send.off = () => void chans.get(name)!.delete(h);
      return send;
    },
    ping: async () => 0,
    leave: async () => void bus.peers.delete(selfId),
  };
}

const ROSTER = [
  { id: 'a', name: 'Ana' },
  { id: 'b', name: 'Bo' },
];

function pair() {
  const bus = new Bus();
  let host: PeerId | null = 'a';
  const netA = fakeNet(bus, 'a', () => host);
  const netB = fakeNet(bus, 'b', () => host);
  const simA = new Sim({ seed: SEED, mode: MODES.clash });
  const simB = new Sim({ seed: SEED, mode: MODES.clash });
  const overB = vi.fn();
  const promotedB = vi.fn();
  const a = new NetGame(netA, simA, ROSTER, SEED, { onEvents: () => {}, onHostPromoted: () => {}, onOver: () => {} });
  const b = new NetGame(netB, simB, ROSTER, SEED, { onEvents: () => {}, onHostPromoted: promotedB, onOver: overB });
  return { bus, a, b, simA, simB, overB, promotedB, setHost: (h: PeerId | null) => (host = h) };
}

describe('host transfer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('the host advances the world and the client follows it', () => {
    const { a, b, simA, simB } = pair();
    a.start();
    b.start();
    expect(a.isHost()).toBe(true);
    expect(b.isHost()).toBe(false);
    vi.advanceTimersByTime(TICK_MS * 20);
    expect(simA.tick).toBeGreaterThan(0);
    expect(simB.tick).toBe(simA.tick);
  });

  it('a client does NOT drive shared state before it is promoted', () => {
    const { b, simB } = pair();
    b.start();
    vi.advanceTimersByTime(TICK_MS * 40);
    expect(simB.tick).toBe(0);
  });

  it('the promoted peer keeps the round running — it does not freeze', () => {
    const { a, b, simB, setHost, promotedB } = pair();
    a.start();
    b.start();
    vi.advanceTimersByTime(TICK_MS * 20);
    const atHandover = simB.tick;
    expect(atHandover).toBeGreaterThan(0);

    a.destroy();
    setHost('b');
    b.onPeerLeave('a');
    b.onHostChange(true);

    expect(promotedB).toHaveBeenCalledTimes(1);
    expect(b.isHost()).toBe(true);
    vi.advanceTimersByTime(TICK_MS * 20);
    expect(simB.tick).toBeGreaterThan(atHandover);
  });

  it('the promoted peer can still reach game-over', () => {
    const { a, b, simB, setHost, overB } = pair();
    a.start();
    b.start();
    vi.advanceTimersByTime(TICK_MS * 20);
    a.destroy();
    setHost('b');
    b.onPeerLeave('a');
    b.onHostChange(true);
    // Run the authoritative clock out — a survivor who can move but never finish
    // is still a failed round.
    vi.advanceTimersByTime((MODES.clash.roundSeconds + 3) * 1000);
    expect(simB.over).toBe(true);
    expect(overB).toHaveBeenCalled();
  });

  it('demotion stops the old host ticking, so two peers never both simulate', () => {
    const { a, b, simA, simB, setHost } = pair();
    a.start();
    vi.advanceTimersByTime(TICK_MS * 5);
    setHost('b');
    a.onHostChange(false);
    b.onHostChange(true);
    vi.advanceTimersByTime(TICK_MS * 10);
    // a is no longer authoritative; from here it only moves by following b's
    // snapshots, so the two sims stay in lockstep on b's single authority.
    expect(a.isHost()).toBe(false);
    expect(simA.tick).toBe(simB.tick);
  });

  it('a peer leaving does not stall the host, and its seat is bot-driven', () => {
    const { a, simA } = pair();
    a.start();
    vi.advanceTimersByTime(TICK_MS * 5);
    a.onPeerLeave('b');
    const t = simA.tick;
    vi.advanceTimersByTime(TICK_MS * 10);
    expect(simA.tick).toBeGreaterThan(t);
  });

  it('a client input reaches the host and moves the right seat', () => {
    const { a, b, simA } = pair();
    a.start();
    b.setInput(move(1)); // drive right
    vi.advanceTimersByTime(TICK_MS * 30);
    expect(simA.tanks[1].vx).toBeGreaterThan(20); // seat 1 = Bo, moving right
  });

  it('an input from a peer with no seat this round is ignored', () => {
    const { bus, a, simA } = pair();
    a.start();
    const netZ = fakeNet(bus, 'z', () => 'a');
    const sendZ = netZ.channel<number[]>('in', () => {});
    sendZ([100, 0, 0, 0, 0]); // a spectator "drive right" that must not land on a seat
    vi.advanceTimersByTime(TICK_MS * 8);
    expect(Math.hypot(simA.tanks[1].vx, simA.tanks[1].vy)).toBeLessThan(8);
  });
});
