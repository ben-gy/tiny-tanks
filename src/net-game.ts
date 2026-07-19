/**
 * net-game.ts — glue between the P2P net and the Sim.
 *
 * Host-authoritative star. The host advances the Sim on a 50ms `setInterval`,
 * runs a Bot for every seat no human occupies, and broadcasts a snapshot;
 * clients send their own tank's input on 'in' and overwrite their Sim from
 * 'snap'. Every peer holds a real Sim, so promotion is continuous.
 *
 * THE INTERVAL IS NOT AN IMPLEMENTATION DETAIL: browsers pause rAF in a
 * backgrounded tab, so a host that ticked off rAF would freeze the whole room
 * the moment they switched tabs — and it could not be caught headlessly. rAF
 * draws; setInterval decides.
 */

import type { Net } from '@ben-gy/game-engine/net';
import { Bot } from './game/bot';
import { STEP, Sim, type SimEvent, type TankInput } from './game/sim';
import { applySnapshot, encodeSnapshot, type Snapshot } from './game/snapshot';

export const TICK_MS = 50;

/** Compact wire form of a TankInput: [mx,my,ax,ay,f] quantized. */
type WireInput = [number, number, number, number, number];

function encodeInput(i: TankInput): WireInput {
  return [Math.round(i.mx * 100), Math.round(i.my * 100), Math.round(i.ax * 100), Math.round(i.ay * 100), i.f ? 1 : 0];
}
function decodeInput(w: WireInput): TankInput {
  return { mx: w[0] / 100, my: w[1] / 100, ax: w[2] / 100, ay: w[3] / 100, f: w[4] };
}
function sameWire(a: WireInput, b: WireInput): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4];
}

export interface NetGameCallbacks {
  onEvents: (events: SimEvent[]) => void;
  onHostPromoted: () => void;
  onOver: () => void;
}

export class NetGame {
  readonly sim: Sim;
  private net: Net;
  private cb: NetGameCallbacks;
  private hostFlag: boolean;
  private sendIn: ((d: WireInput) => void) & { off: () => void };
  private sendSnap: ((s: Snapshot) => void) & { off: () => void };
  /** seat -> latest input heard. Host-only. */
  private inputs = new Map<number, TankInput>();
  /** peer id -> seat, from the frozen roster. */
  private seatOf: Map<string, number>;
  /** Bots for seats no human occupies. Host runs them; every peer holds them. */
  private bots: Bot[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private selfWire: WireInput = [0, 0, 0, 0, 0];
  private selfInput: TankInput = { mx: 0, my: 0, ax: 0, ay: 0, f: 0 };
  private lastSnapTick = -1;
  private ended = false;
  private seed: number;

  constructor(net: Net, sim: Sim, roster: { id: string; name: string }[], seed: number, cb: NetGameCallbacks) {
    this.net = net;
    this.sim = sim;
    this.cb = cb;
    this.seed = seed;
    this.hostFlag = net.isHost();
    this.seatOf = new Map(roster.map((p, i) => [p.id, i]));
    // Seats with no human are bot-controlled by whoever is host.
    for (let seat = roster.length; seat < sim.tanks.length; seat++) this.bots[seat] = new Bot(seed, seat);

    this.sendIn = net.channel<WireInput>('in', (w, from) => {
      const seat = this.seatOf.get(from);
      if (seat === undefined) return; // spectator: no seat to land on
      this.inputs.set(seat, decodeInput(w));
    });

    this.sendSnap = net.channel<Snapshot>('snap', (snap) => {
      if (this.hostFlag) return;
      if (snap.t <= this.lastSnapTick) return; // out-of-order delivery
      this.lastSnapTick = snap.t;
      const events = applySnapshot(this.sim, snap);
      this.cb.onEvents(events);
      this.checkOver();
    });
  }

  selfSeat(): number {
    return this.seatOf.get(this.net.selfId) ?? -1;
  }

  isHost(): boolean {
    return this.hostFlag;
  }

  start(): void {
    if (this.hostFlag) this.startTicking();
  }

  setInput(input: TankInput): void {
    this.selfInput = input;
    const w = encodeInput(input);
    if (sameWire(w, this.selfWire)) return;
    this.selfWire = w;
    const seat = this.selfSeat();
    if (seat < 0) return;
    if (this.hostFlag) this.inputs.set(seat, input);
    else this.sendIn(w);
  }

  private startTicking(): void {
    if (this.timer != null) return;
    this.last = Date.now();
    this.acc = 0;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTicking(): void {
    if (this.timer != null) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    const now = Date.now();
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.acc += dt;
    const collected: SimEvent[] = [];
    while (this.acc >= STEP) {
      this.acc -= STEP;
      // Bots decide fresh each step from current state; humans use last input.
      const masks: (TankInput | undefined)[] = [];
      for (const t of this.sim.tanks) {
        const bot = this.bots[t.seat];
        masks[t.seat] = bot ? bot.input(this.sim) : this.inputs.get(t.seat);
      }
      this.sim.step(masks);
      const ev = this.sim.drainEvents();
      if (ev.length) collected.push(...ev);
      if (this.sim.over) break;
    }
    this.sendSnap(encodeSnapshot(this.sim, collected));
    if (collected.length) this.cb.onEvents(collected);
    this.checkOver();
  }

  private checkOver(): void {
    if (!this.sim.over || this.ended) return;
    this.ended = true;
    this.stopTicking();
    this.cb.onOver();
  }

  /** The one path by which authority moves. net.ts promotes exactly one survivor. */
  onHostChange(isHost: boolean): void {
    const was = this.hostFlag;
    this.hostFlag = isHost;
    if (isHost && !was) {
      // Our Sim is already current: snapshots have been overwriting it. Seed the
      // host input map from our own last input and resume ticking (which also
      // resumes running the bots for empty seats).
      const seat = this.selfSeat();
      if (seat >= 0) this.inputs.set(seat, this.selfInput);
      if (!this.sim.over) this.startTicking();
      this.cb.onHostPromoted();
    } else if (!isHost && was) {
      this.stopTicking();
    }
  }

  onPeerLeave(id: string): void {
    const seat = this.seatOf.get(id);
    if (seat === undefined) return;
    // Their tank is taken over by a host-run bot so the round stays a real 2v2
    // and finishable, rather than a coasting dead seat.
    this.bots[seat] = new Bot(this.seed, seat);
    this.inputs.delete(seat);
  }

  destroy(): void {
    this.stopTicking();
    this.sendIn.off();
    this.sendSnap.off();
  }
}
