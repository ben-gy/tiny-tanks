// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Ben Richardson — https://benrichardson.dev
// Additional terms under AGPL-3.0 section 7(b) apply; see ADDITIONAL-TERMS.md.
/**
 * ui.ts — every screen that is not the arena. View builders only: they take data
 * and return markup; the caller wires the buttons. Nothing here reads the Sim,
 * so the results screen is renderable from a snapshot on a peer that died early.
 */

import { TEAM_COLORS, TEAM_NAMES, teamColor } from './render';
import type { Tank } from './game/sim';
import { MODE_LIST, type ModeId } from './modes';

export const FOOTER = `<footer class="site-footer">Built by <a href="https://benrichardson.dev/" target="_blank" rel="noopener">benrichardson.dev</a> · <a href="https://hub.benrichardson.dev" target="_blank" rel="noopener">more games, tools &amp; sites</a></footer>`;

export function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function modePicker(current: ModeId, disabled = false): string {
  return `<div class="modes" role="radiogroup" aria-label="Mode">${MODE_LIST.map(
    (m) => `<button class="mode${m.id === current ? ' on' : ''}" role="radio" aria-checked="${m.id === current}"
      data-mode="${m.id}"${disabled ? ' disabled' : ''}>
      <span class="mode-name">${m.name}</span><span class="mode-blurb">${m.blurb}</span></button>`,
  ).join('')}</div>`;
}

export function arenaShell(hud: string, live: boolean, muted: boolean): string {
  return `<div class="arena">
      <canvas id="cv" aria-label="Battlefield"></canvas>
      <div class="stick-zone left" id="zl" aria-hidden="true"></div>
      <div class="stick-zone right" id="zr" aria-hidden="true"></div>
      <div class="hud" id="hud">${hud}</div>
      <div class="hud-right">
        <button class="icon-btn" id="mute" aria-label="Mute">${muted ? '🔇' : '🔊'}</button>
        <button class="icon-btn" id="pause" aria-label="${live ? 'Leave match' : 'Pause'}">${live ? '✕' : '❚❚'}</button>
      </div>
      <div class="overlay" id="pauseo" hidden>
        <div class="overlay-card">
          <h2>${live ? 'Leave the match?' : 'Paused'}</h2>
          ${
            live
              ? '<p class="overlay-note">The round carries on without you — you won’t see the results, and you’ll leave the room.</p>'
              : ''
          }
          <button class="btn primary" id="resume">${live ? 'Keep playing' : 'Resume'}</button>
          ${live ? '' : '<button class="btn" id="restart">Restart</button>'}
          <button class="btn ghost" id="quit">${live ? 'Leave match' : 'Menu'}</button>
        </div>
      </div>
    </div>`;
}

export function lobbyModeBlock(o: { host: boolean; settled: boolean; mode: ModeId }): string {
  const caption = !o.settled ? 'Connecting…' : o.host ? 'Your pick — everyone plays it' : 'The host picks the arena';
  return `<p class="lobby-mode-h">${caption}</p>${modePicker(o.mode, !o.host)}`;
}

export function menuScreen(mode: ModeId, best: { caps: number } | null): string {
  return `<div class="screen menu">
    <h1 class="title">Tiny<span>Tanks</span></h1>
    <p class="tagline">Bank ricochet shots around the walls, steal the enemy flag, race it home.</p>
    ${modePicker(mode)}
    <div class="menu-actions">
      <button class="btn primary" id="play">Play</button>
      <button class="btn" id="friends">Play with friends</button>
    </div>
    ${best && best.caps > 0 ? `<p class="best">Best solo run: <b>${best.caps}</b> captures</p>` : ''}
    <div class="menu-links">
      <button class="link" id="help">How to play</button>
      <button class="link" id="about">About</button>
    </div>
  </div>`;
}

export function helpScreen(): string {
  return `<div class="panel-body">
    <h2>How to play</h2>
    <p><b>Steal the enemy flag and drive it back to your base to score. First team to 3 wins.</b></p>
    <p>Your shots <b>bounce off the walls</b> — bank them around corners to hit tanks that think they're safe. Watch your own rebound; it can come back for you.</p>
    <p>Grab a <b>power-up</b> for spread shot, rapid fire, extra speed, a shield, or extra ricochets. Nobody's ever knocked out — you respawn in a moment.</p>
    <ul class="keys">
      <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> — drive</li>
      <li><kbd>Mouse</kbd> — aim · <kbd>Click</kbd>/<kbd>Space</kbd> — fire</li>
      <li><kbd>P</kbd> pause · <kbd>M</kbd> mute</li>
    </ul>
    <p class="muted">On a phone: <b>left thumb drives, right thumb aims and fires</b> — rest each thumb anywhere on its side of the screen.</p>
  </div>`;
}

export function aboutScreen(): string {
  return `<div class="panel-body">
    <h2>About</h2>
    <p>Tiny Tanks is a top-down capture-the-flag tank duel. Every wall, tank and bullet is drawn procedurally and every sound is synthesised in your browser — no images, no fonts, no audio files.</p>
    <p><b>Multiplayer is peer-to-peer.</b> Your browser talks straight to your friends' browsers over WebRTC; there's no game server and no account. A free public signalling relay is used only to introduce the browsers to each other — after that nothing about your game touches it, and nothing is stored on a server.</p>
    <p class="muted">No cookies, no fingerprinting, no third-party fonts. Anonymous, cookie-less page-view counts via Cloudflare Web Analytics.</p>
    ${FOOTER}
  </div>`;
}

/** The live score HUD: team scores + clock. */
export function scoreHud(): string {
  return `<div class="score-hud">
    <span class="sh-team" style="--tc:${TEAM_COLORS[0]}"><span class="sh-name">${TEAM_NAMES[0]}</span><b id="sh-s0">0</b></span>
    <span class="sh-clock" id="sh-clock">0:00</span>
    <span class="sh-team" style="--tc:${TEAM_COLORS[1]}"><b id="sh-s1">0</b><span class="sh-name">${TEAM_NAMES[1]}</span></span>
  </div>`;
}

export interface ResultsRow {
  seat: number;
  team: number;
  name: string;
  isSelf: boolean;
  captures: number;
  returns: number;
  kills: number;
  deaths: number;
  shots: number;
  hits: number;
}

/**
 * The one moment players compare themselves — so it shows EVERYONE, grouped by
 * team, with each player's actual contribution (captures, returns, kills), not a
 * name and a number. Every peer reaches this screen, including one that died
 * early or whose host went silent.
 */
export function resultsScreen(o: {
  rows: ResultsRow[];
  scores: [number, number];
  winnerTeam: number;
  selfTeam: number;
  series: [number, number];
  rounds: number;
  multiplayer: boolean;
}): string {
  const headline =
    o.winnerTeam < 0
      ? 'Draw'
      : o.multiplayer && o.selfTeam >= 0
        ? o.winnerTeam === o.selfTeam
          ? 'Victory'
          : 'Defeat'
        : `${TEAM_NAMES[o.winnerTeam]} wins`;

  const scoreline = `<p class="scoreline">
    <span style="color:${teamColor(0)}">${TEAM_NAMES[0]} ${o.scores[0]}</span>
    <span class="dash">—</span>
    <span style="color:${teamColor(1)}">${o.scores[1]} ${TEAM_NAMES[1]}</span></p>`;

  const teamBlock = (team: number): string => {
    const rows = o.rows.filter((r) => r.team === team).sort((a, b) => b.captures - a.captures || b.kills - a.kills);
    return `<div class="team-block" style="--tc:${teamColor(team)}">
      <h3 class="team-h">${TEAM_NAMES[team]}${team === o.winnerTeam ? ' <span class="crown">★</span>' : ''}</h3>
      <table class="results"><thead><tr><th>Player</th><th>Caps</th><th>Ret</th><th>K</th><th>D</th><th>Acc</th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr class="${r.isSelf ? 'self' : ''}">
          <td>${esc(r.name)}</td><td>${r.captures}</td><td>${r.returns}</td><td>${r.kills}</td><td>${r.deaths}</td>
          <td>${r.shots ? Math.round((r.hits / r.shots) * 100) : 0}%</td></tr>`,
        )
        .join('')}</tbody></table></div>`;
  };

  const tally =
    o.multiplayer && o.rounds > 0
      ? `<div class="tally"><h3>Match — ${o.rounds} round${o.rounds === 1 ? '' : 's'}</h3>
        <div class="tally-row"><span style="color:${teamColor(0)}">${TEAM_NAMES[0]}</span><b>${o.series[0]}</b></div>
        <div class="tally-row"><span style="color:${teamColor(1)}">${TEAM_NAMES[1]}</span><b>${o.series[1]}</b></div></div>`
      : '';

  return `<div class="screen results-screen">
    <h2 class="headline">${headline}</h2>
    ${scoreline}
    <div class="team-blocks">${teamBlock(0)}${teamBlock(1)}</div>
    ${tally}
    <div class="results-actions" id="ractions"></div>
  </div>`;
}

export function soloOverScreen(scores: [number, number], winnerTeam: number, best: { caps: number }): string {
  const won = winnerTeam === 0;
  return `<div class="screen results-screen">
    <h2 class="headline">${won ? 'Victory' : winnerTeam < 0 ? 'Draw' : 'Defeat'}</h2>
    <p class="scoreline"><span style="color:${teamColor(0)}">${TEAM_NAMES[0]} ${scores[0]}</span>
      <span class="dash">—</span><span style="color:${teamColor(1)}">${scores[1]} ${TEAM_NAMES[1]}</span></p>
    <p class="submeta">Your best solo run: <b>${best.caps}</b> captures</p>
    <div class="results-actions">
      <button class="btn primary" id="again">Play again</button>
      <button class="btn" id="share">Share</button>
      <button class="btn ghost" id="menu">Menu</button>
    </div>
  </div>`;
}

/** One live-round HUD line per player, grouped by team dot. */
export function playerHudRow(t: Tank, isSelf: boolean, name: string): string {
  return `<div class="hud-p${isSelf ? ' self' : ''}${t.alive ? '' : ' down'}">
    <span class="dot" style="background:${teamColor(t.team)}"></span>
    <span class="hp-name">${esc(name)}</span>
    <span class="hp-caps">⚑${t.captures}</span>
    ${t.carrying >= 0 ? '<span class="hp-flag">has flag</span>' : ''}
  </div>`;
}
