/**
 * main.ts — bootstrap and screen routing.
 *
 * Owns no game logic. It reads input into a TankInput, routes screens, and holds
 * the ONE Net for the room's whole life.
 *
 *  - ONE ROOM PER SESSION. The Net is created on entering a room, torn down only
 *    on returning to the menu. "Play again" never touches it (engine/rematch.ts).
 *  - A ROOM IS A CHOICE. `?room=` is honoured once per load and cleared on the
 *    way out, so a reload never drags you back into a room you left.
 */

import './styles/mobile.css';
import './styles/main.css';

import { createInput, type Input } from './engine/input';
import { createJoystick, type Joystick } from './engine/joystick';
import { createLoop, type Loop } from './engine/loop';
import { hardenViewport } from './engine/mobile';
import { createNet, type Net, type PeerId } from './engine/net';
import { createRounds, type Rounds } from './engine/rematch';
import { createSfx } from './engine/sound';
import { createStore } from './engine/storage';
import { resolveName } from './engine/identity';
import { clearRoomInUrl, createLobby, createRoomEntry, mintCode, normalizeRoomCode } from './engine/lobby';
import { createCountdown, type Countdown } from './countdown';
import { Fx } from './fx';
import { DEFAULT_MODE, MODES, modeOf, type ModeId } from './modes';
import { Local } from './game/local';
import { NetGame } from './net-game';
import { teamOfSeat } from './game/arena';
import { Sim, type SimEvent, type TankInput } from './game/sim';
import { computeView, render, teamColor, TEAM_NAMES } from './render';
import {
  aboutScreen,
  arenaShell,
  esc,
  FOOTER,
  helpScreen,
  lobbyModeBlock,
  menuScreen,
  resultsScreen,
  scoreHud,
  soloOverScreen,
  type ResultsRow,
} from './ui';

const SLUG = 'tiny-tanks';
const IDLE: TankInput = { mx: 0, my: 0, ax: 0, ay: 0, f: 0 };

const store = createStore(SLUG);
const sfx = createSfx(store.get('muted', false));
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const playerName = resolveName(store, () => `Tank ${Math.floor(Math.random() * 900 + 100)}`);

hardenViewport();

const app = document.getElementById('app')!;
app.innerHTML = `<div class="main-content" id="view"></div>${FOOTER}`;
const view = document.getElementById('view')!;

type Screen = 'menu' | 'solo' | 'entry' | 'lobby' | 'round' | 'results';

class Game {
  private screen: Screen = 'menu';
  private mode: ModeId = modeOf(store.get('mode', DEFAULT_MODE)).id;
  private fx = new Fx(reduced);
  private loop: Loop | null = null;
  private input: Input | null = null;
  private leftStick: Joystick | null = null;
  private rightStick: Joystick | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private countdown: Countdown | null = null;
  private mouseX = 0;
  private mouseY = 0;
  private mouseDown = false;

  // solo
  private local: Local | null = null;

  // multiplayer
  private net: Net | null = null;
  private leaving: Promise<void> | null = null;
  private rounds: Rounds | null = null;
  private ng: NetGame | null = null;
  private lobby: { destroy: () => void } | null = null;
  private lobbyPoll: ReturnType<typeof setInterval> | null = null;
  private roomCode = '';
  private roster: { id: PeerId; name: string }[] = [];
  private series: [number, number] = [0, 0];
  private rmatchRounds = 0;
  private lastAdvance = 0;
  private paused = false;
  private counting = false;
  private deepLink: string | null = null;

  constructor() {
    const p = new URLSearchParams(location.search).get('room');
    if (p) {
      this.deepLink = normalizeRoomCode(p);
      clearRoomInUrl();
    }
    window.addEventListener('beforeunload', () => void this.net?.leave());
    window.addEventListener('mousemove', this.onMouse);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    if (this.deepLink) void this.enterRoom(this.deepLink, false);
    else this.showMenu();
    if (!store.get('seenHelp', false)) this.panel(helpScreen(), () => store.set('seenHelp', true));
  }

  private onMouse = (e: MouseEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
  };
  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDown = true;
  };
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDown = false;
  };

  // ── shell ──
  private panel(html: string, onClose?: () => void): void {
    const el = document.createElement('div');
    el.className = 'panel';
    el.innerHTML = `<div class="panel-card">${html}<button class="btn ghost panel-close">Close</button></div>`;
    el.addEventListener('click', (e) => {
      if (e.target === el || (e.target as HTMLElement).classList.contains('panel-close')) {
        el.remove();
        onClose?.();
      }
    });
    app.appendChild(el);
  }

  private wireModes(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        this.mode = modeOf(b.dataset.mode).id;
        store.set('mode', this.mode);
        sfx.unlock();
        sfx.play('blip');
        root.querySelectorAll('[data-mode]').forEach((o) => {
          o.classList.toggle('on', o === b);
          o.setAttribute('aria-checked', String(o === b));
        });
        this.rounds?.unvote();
      }),
    );
  }

  showMenu(): void {
    this.teardownRound();
    void this.leaveRoom();
    this.screen = 'menu';
    this.series = [0, 0];
    this.rmatchRounds = 0;
    view.innerHTML = menuScreen(this.mode, store.get('best', { caps: 0 }));
    this.wireModes(view);
    view.querySelector('#play')!.addEventListener('click', () => {
      sfx.unlock();
      this.startSolo();
    });
    view.querySelector('#friends')!.addEventListener('click', () => {
      sfx.unlock();
      this.showEntry();
    });
    view.querySelector('#help')!.addEventListener('click', () => this.panel(helpScreen()));
    view.querySelector('#about')!.addEventListener('click', () => this.panel(aboutScreen()));
  }

  // ── arena shell ──
  private buildArena(live: boolean): void {
    view.innerHTML = arenaShell(scoreHud(), live, sfx.muted());
    document.body.classList.add('playing');
    this.canvas = document.getElementById('cv') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', this.resize);

    document.getElementById('mute')!.addEventListener('click', (e) => {
      const m = !sfx.muted();
      sfx.setMuted(m);
      store.set('muted', m);
      (e.currentTarget as HTMLElement).textContent = m ? '🔇' : '🔊';
    });
    document.getElementById('pause')!.addEventListener('click', () => this.setPaused(true));
    document.getElementById('resume')!.addEventListener('click', () => this.setPaused(false));
    document.getElementById('restart')?.addEventListener('click', () => {
      this.setPaused(false);
      this.startSolo();
    });
    document.getElementById('quit')!.addEventListener('click', () => {
      this.setPaused(false);
      this.showMenu();
    });

    this.input = createInput({
      target: this.canvas,
      keys: {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
        KeyA: 'left',
        KeyD: 'right',
        KeyW: 'up',
        KeyS: 'down',
        Space: 'fire',
        KeyP: 'pause',
        KeyM: 'mute',
      },
      touch: false,
    });

    // Twin floating sticks: left half drives, right half aims + auto-fires.
    this.leftStick?.destroy();
    this.rightStick?.destroy();
    this.leftStick = createJoystick({ surface: document.getElementById('zl')!, reducedMotion: reduced });
    this.rightStick = createJoystick({ surface: document.getElementById('zr')!, reducedMotion: reduced });
  }

  private resize = (): void => {
    const c = this.canvas;
    if (!c) return;
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    this.ctx = c.getContext('2d');
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  private overlayShown(): boolean {
    const o = document.getElementById('pauseo');
    return !!o && !o.hidden;
  }

  private setPaused(p: boolean): void {
    const o = document.getElementById('pauseo');
    if (o) o.hidden = !p;
    this.paused = this.screen === 'round' ? false : p;
  }

  /** Read local input into a TankInput. Touch → twin-stick; desktop → WASD + mouse. */
  private readInput(): TankInput {
    if (this.counting) return IDLE;
    const s = this.input?.state;
    let mx = 0;
    let my = 0;
    const lv = this.leftStick?.vector();
    if (this.leftStick?.active() && lv) {
      mx = lv.x * lv.mag;
      my = lv.y * lv.mag;
    } else if (s) {
      mx = s.axis.x;
      my = s.axis.y;
    }

    let ax = 0;
    let ay = 0;
    let f = 0;
    const rv = this.rightStick?.vector();
    if (this.rightStick?.active() && rv && rv.mag > 0.15) {
      ax = rv.x;
      ay = rv.y;
      f = 1;
    } else {
      // desktop: aim toward the mouse from this tank's screen position
      const sim = this.local?.sim ?? this.ng?.sim;
      const seat = this.local ? 0 : (this.ng?.selfSeat() ?? -1);
      const me = sim?.tanks.find((t) => t.seat === seat && t.alive);
      if (me && this.canvas) {
        const r = this.canvas.getBoundingClientRect();
        const v = computeView(r.width, r.height);
        const sx = r.left + v.ox + me.x * v.scale;
        const sy = r.top + v.oy + me.y * v.scale;
        ax = this.mouseX - sx;
        ay = this.mouseY - sy;
      }
      f = this.mouseDown || s?.down.has('fire') ? 1 : 0;
    }
    return { mx, my, ax, ay, f };
  }

  private pollHotkeys(): void {
    const s = this.input?.state;
    if (!s) return;
    if (s.pressed.has('pause')) this.setPaused(!this.overlayShown());
    if (s.pressed.has('mute')) {
      const m = !sfx.muted();
      sfx.setMuted(m);
      store.set('muted', m);
      const b = document.getElementById('mute');
      if (b) b.textContent = m ? '🔇' : '🔊';
    }
  }

  private playEvents(events: SimEvent[], selfSeat: number): void {
    for (const e of events) {
      switch (e.t) {
        case 'shot':
          sfx.play('blip');
          break;
        case 'bounce':
          if (!reduced) this.fx.burst(e.x, e.y, '#cdd6e6', 4, 120, 0.22);
          break;
        case 'crack':
          sfx.play('hit');
          this.fx.burst(e.x, e.y, '#ffd43b', 6, 150, 0.3);
          break;
        case 'boom':
          sfx.play('explosion');
          this.fx.burst(e.x, e.y, teamColor(teamOfSeat(e.p)), 18, 220, 0.7);
          this.fx.shake(e.p === selfSeat ? 20 : 10, 0.28);
          this.fx.hitStop(0.05);
          break;
        case 'grab':
          sfx.play('powerup');
          this.fx.ring(e.x, e.y, '#fff', 16);
          break;
        case 'return':
          sfx.play('select');
          break;
        case 'capture':
          sfx.play('win');
          this.fx.burst(e.x, e.y, teamColor(e.p), 26, 260, 0.9);
          this.fx.shake(16, 0.3);
          break;
        case 'pickup':
          sfx.play('powerup');
          this.fx.ring(e.x, e.y, '#a5d8ff', 12);
          break;
        case 'shield':
          sfx.play('hit');
          this.fx.ring(e.x, e.y, '#a5d8ff', 14);
          break;
      }
    }
  }

  private draw = (): void => {
    const sim = this.local?.sim ?? this.ng?.sim;
    if (!this.ctx || !this.canvas || !sim) return;
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const lead = this.ng && !this.ng.isHost() ? Math.min((Date.now() - this.lastAdvance) / 1000, 0.12) : 0;
    render(this.ctx, r.width, r.height, {
      sim,
      fx: this.fx,
      view: computeView(r.width, r.height),
      selfSeat: this.local ? 0 : (this.ng?.selfSeat() ?? -1),
      lead,
      reduced,
    });
  };

  private updateScoreHud(sim: Sim): void {
    const set = (id: string, t: string): void => {
      const e = document.getElementById(id);
      if (e && e.textContent !== t) e.textContent = t;
    };
    set('sh-s0', String(sim.scores[0]));
    set('sh-s1', String(sim.scores[1]));
    const secs = Math.max(0, Math.floor(sim.mode.roundSeconds - sim.time));
    set('sh-clock', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
  }

  // ── solo ──
  startSolo(): void {
    this.teardownRound();
    this.screen = 'solo';
    this.fx.clear();
    const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
    this.local = new Local(seed, MODES[this.mode]);
    this.buildArena(false);
    this.loop = createLoop({
      update: () => {
        if (this.paused || !this.local) return;
        this.pollHotkeys();
        if (!this.counting && !this.fx.frozen()) {
          this.local.step(this.readInput());
          this.playEvents(this.local.sim.drainEvents(), 0);
        }
        this.input?.endFrame();
        this.fx.update(1 / 60);
        this.updateScoreHud(this.local.sim);
        if (this.local.sim.over) this.endSolo();
      },
      render: this.draw,
    });
    this.loop.start();
    this.startCountdown();
  }

  private endSolo(): void {
    const sim = this.local!.sim;
    const myCaps = sim.tanks.find((t) => t.seat === 0)?.captures ?? 0;
    const best = store.get('best', { caps: 0 });
    if (myCaps > best.caps) store.set('best', { caps: myCaps });
    sfx.play(sim.winnerTeam === 0 ? 'win' : 'lose');
    this.teardownRound();
    this.screen = 'results';
    view.innerHTML = soloOverScreen([sim.scores[0], sim.scores[1]], sim.winnerTeam, store.get('best', { caps: 0 }));
    view.querySelector('#again')!.addEventListener('click', () => this.startSolo());
    view.querySelector('#menu')!.addEventListener('click', () => this.showMenu());
    view.querySelector('#share')!.addEventListener('click', async () => {
      const text = `I ${sim.winnerTeam === 0 ? 'won' : 'played'} ${sim.scores[0]}–${sim.scores[1]} in Tiny Tanks`;
      try {
        if (navigator.share) await navigator.share({ text, url: location.origin });
        else await navigator.clipboard.writeText(`${text} — ${location.origin}`);
      } catch {
        /* dismissed / blocked — not an error */
      }
    });
  }

  // ── multiplayer ──
  private showEntry(): void {
    this.screen = 'entry';
    view.innerHTML = `<div class="screen"><div id="entry"></div></div>`;
    createRoomEntry({
      container: document.getElementById('entry')!,
      onSubmit: (code, created) => void this.enterRoom(code, created),
      onCancel: () => this.showMenu(),
      title: 'Play with friends',
      subtitle: 'Start a room and share the code, or enter a friend’s code to join.',
    });
  }

  private async enterRoom(rawCode: string, created: boolean): Promise<void> {
    if (this.leaving) await this.leaving;
    const code = normalizeRoomCode(rawCode) || mintCode();
    this.roomCode = code;
    this.series = [0, 0];
    this.rmatchRounds = 0;
    this.net = createNet(
      { appId: SLUG, roomId: code, claimHost: created },
      {
        onHostChange: (_id, isSelfHost) => {
          this.ng?.onHostChange(isSelfHost);
          if (this.screen === 'lobby') this.paintLobbyMode();
        },
        onPeerLeave: (id) => this.ng?.onPeerLeave(id),
      },
    );
    this.rounds = createRounds({
      net: this.net,
      playerName,
      minPlayers: 2,
      roundOpts: () => ({ mode: this.mode }),
      onRound: (info) => this.startRound(info.seed, info.players, modeOf((info.opts as { mode?: unknown })?.mode).id),
      onChange: () => {
        if (this.screen === 'results') this.paintRematch();
      },
    });
    this.showLobby();
  }

  private async leaveRoom(): Promise<void> {
    this.stopLobbyPoll();
    this.lobby?.destroy();
    this.lobby = null;
    this.rounds?.destroy();
    this.rounds = null;
    const n = this.net;
    this.net = null;
    if (!n) return;
    this.leaving = n.leave().finally(() => {
      this.leaving = null;
    });
    await this.leaving;
  }

  private showLobby(): void {
    this.teardownRound();
    this.screen = 'lobby';
    if (!this.net || !this.rounds) return;
    view.innerHTML = `<div class="screen lobby-screen"><div id="lobby"></div><div class="lobby-mode" id="lobbymode"></div></div>`;
    this.lobby?.destroy();
    this.lobby = createLobby({
      container: document.getElementById('lobby')!,
      net: this.net,
      rounds: this.rounds,
      roomCode: this.roomCode,
      minPlayers: 2,
      maxPlayers: 4,
      onCancel: () => this.showMenu(),
    });
    this.paintLobbyMode();
    this.startLobbyPoll();
  }

  private paintLobbyMode(): void {
    const box = document.getElementById('lobbymode');
    if (!box || !this.net || !this.rounds) return;
    const host = this.net.isHost();
    const settled = this.net.hostSettled();
    const gossiped = (this.rounds.state().hostOpts as { mode?: unknown } | null)?.mode;
    const shown = host ? this.mode : modeOf(gossiped).id;
    const html = lobbyModeBlock({ host, settled, mode: shown });
    if (box.innerHTML === html) return;
    box.innerHTML = html;
    if (host) this.wireModes(box);
  }

  private startLobbyPoll(): void {
    this.stopLobbyPoll();
    this.lobbyPoll = setInterval(() => {
      if (this.screen !== 'lobby') return this.stopLobbyPoll();
      this.paintLobbyMode();
    }, 600);
  }

  private stopLobbyPoll(): void {
    if (this.lobbyPoll != null) clearInterval(this.lobbyPoll);
    this.lobbyPoll = null;
  }

  private startRound(seed: number, players: { id: PeerId; name: string }[], mode: ModeId): void {
    this.teardownRound();
    this.screen = 'round';
    this.fx.clear();
    this.roster = players;
    const sim = new Sim({ seed, mode: MODES[mode] });
    this.ng = new NetGame(this.net!, sim, players, seed, {
      onEvents: (ev) => {
        this.lastAdvance = Date.now();
        this.playEvents(ev, this.ng?.selfSeat() ?? -1);
      },
      onHostPromoted: () => this.flash("The host left — you're in charge now"),
      onOver: () => this.endRound(),
    });
    this.buildArena(true);
    this.loop = createLoop({
      update: () => {
        this.pollHotkeys();
        this.ng?.setInput(this.readInput());
        this.input?.endFrame();
        this.fx.update(1 / 60);
        if (this.ng) this.updateScoreHud(this.ng.sim);
      },
      render: this.draw,
    });
    this.loop.start();
    this.startCountdown(() => this.ng?.start());
  }

  private startCountdown(onDone?: () => void): void {
    this.counting = true;
    this.countdown = createCountdown({
      root: view.querySelector('.arena') as HTMLElement,
      sfx,
      reducedMotion: reduced,
      onDone: () => {
        this.counting = false;
        this.countdown = null;
        onDone?.();
      },
    });
  }

  private flash(msg: string): void {
    const el = document.createElement('div');
    el.className = 'flash show';
    el.textContent = msg;
    (view.querySelector('.arena') ?? view).appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  private nameForSeat(seat: number): string {
    const p = this.roster[seat];
    if (p) return p.name;
    return `Bot ${seat + 1}`;
  }

  private endRound(): void {
    const sim = this.ng?.sim;
    if (!sim) return;
    const selfSeat = this.ng!.selfSeat();
    const selfTeam = selfSeat >= 0 ? teamOfSeat(selfSeat) : -1;
    if (sim.winnerTeam >= 0) this.series[sim.winnerTeam]++;
    this.rmatchRounds++;
    sfx.play(sim.winnerTeam === selfTeam && selfTeam >= 0 ? 'win' : 'lose');

    const rows: ResultsRow[] = sim.tanks.map((t) => ({
      seat: t.seat,
      team: t.team,
      name: this.nameForSeat(t.seat),
      isSelf: t.seat === selfSeat,
      captures: t.captures,
      returns: t.returns,
      kills: t.kills,
      deaths: t.deaths,
      shots: t.shots,
      hits: t.hits,
    }));

    this.teardownRound();
    this.screen = 'results';
    this.rounds?.finish();
    view.innerHTML = resultsScreen({
      rows,
      scores: [sim.scores[0], sim.scores[1]],
      winnerTeam: sim.winnerTeam,
      selfTeam,
      series: this.series,
      rounds: this.rmatchRounds,
      multiplayer: true,
    });
    this.paintRematch();
  }

  private paintRematch(): void {
    const box = document.getElementById('ractions');
    if (!box || !this.rounds) return;
    const st = this.rounds.state();
    const waiting = st.present.length - st.votes.length;
    const secs = st.startsInMs != null ? Math.ceil(st.startsInMs / 1000) : null;
    const alone = st.present.length < 2;
    const html = `
      <button class="btn primary" id="again"${st.voted || alone ? ' disabled' : ''}>${st.voted ? 'Ready ✓' : 'Play again'}</button>
      ${st.canStart ? '<button class="btn" id="force">Start now</button>' : ''}
      <button class="btn" id="lobby">Back to lobby</button>
      <button class="btn ghost" id="menu">Menu</button>
      <p class="wait-note">${
        alone
          ? `Everyone else left. Share code <b>${esc(this.roomCode)}</b> and they can drop straight back in.`
          : secs != null
            ? `Starting in ${secs}s${waiting > 0 ? ` — waiting on ${waiting}` : ''}`
            : st.voted
              ? `Waiting for ${waiting} more…`
              : `${st.votes.length}/${st.present.length} ready`
      }</p>`;
    if (box.innerHTML !== html) {
      box.innerHTML = html;
      box.querySelector('#again')?.addEventListener('click', () => {
        sfx.play('select');
        this.rounds?.vote();
      });
      box.querySelector('#force')?.addEventListener('click', () => this.rounds?.go());
      box.querySelector('#lobby')?.addEventListener('click', () => this.showLobby());
      box.querySelector('#menu')?.addEventListener('click', () => this.showMenu());
    }
  }

  // ── teardown ──
  private teardownRound(): void {
    document.body.classList.remove('playing');
    this.loop?.stop();
    this.loop = null;
    this.countdown?.cancel();
    this.countdown = null;
    this.counting = false;
    this.input?.destroy();
    this.input = null;
    this.leftStick?.destroy();
    this.leftStick = null;
    this.rightStick?.destroy();
    this.rightStick = null;
    this.ng?.destroy();
    this.ng = null;
    this.local = null;
    this.paused = false;
    this.mouseDown = false;
    window.removeEventListener('resize', this.resize);
    this.canvas = null;
    this.ctx = null;
  }
}

new Game();
void TEAM_NAMES;
