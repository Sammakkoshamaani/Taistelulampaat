// Battle Sheeps – authoritative game room. Runs on the host's browser.
// Holds lobby seats + game state, validates every action, drives bots.
import { createGame, applyAction, PLAYER_COLORS, MAX_PLAYERS, MIN_PLAYERS } from './game.js';
import { chooseMove, choosePlacement, BOT_NAMES } from './bot.js';

const BOT_DELAY = { placement: 700, play: 900 };

function botName(i, level) {
  return `${BOT_NAMES[i % BOT_NAMES.length]} (${level} bot)`;
}

export class Room {
  constructor({ hostName, online, onState }) {
    this.online = online;
    this.code = null;
    this.onState = onState;
    this.version = 0;
    this.game = null;
    this.botTimer = null;
    this.options = { style: 'normal', randomStart: true };
    this.seats = [
      { type: 'host', name: hostName || 'Host', connected: true },
      online ? { type: 'open' } : { type: 'bot', botLevel: 'medium', name: botName(1, 'medium') },
      { type: online ? 'open' : 'closed' },
      { type: 'closed' },
    ];
  }

  publicState() {
    return {
      code: this.code,
      online: this.online,
      seats: this.seats,
      options: this.options,
      game: this.game,
      version: this.version,
    };
  }

  emit() {
    this.version++;
    this.onState(this.publicState());
    this.scheduleBot();
  }

  // ----- connections ------------------------------------------------------
  /** Returns seat index, or -1 for spectator. */
  join(clientId, name) {
    const existing = this.seats.findIndex((s) => s.clientId === clientId);
    if (existing >= 0) {
      this.seats[existing].connected = true;
      if (name && !this.game) this.seats[existing].name = name;
      this.emit();
      return existing;
    }
    if (!this.game) {
      const open = this.seats.findIndex((s) => s.type === 'open');
      if (open >= 0) {
        this.seats[open] = { type: 'human', name: name || `Player ${open + 1}`, clientId, connected: true };
        this.emit();
        return open;
      }
    }
    this.emit();
    return -1;
  }

  leave(clientId) {
    const i = this.seats.findIndex((s) => s.clientId === clientId);
    if (i < 0) return;
    if (!this.game) this.seats[i] = { type: 'open' };
    else this.seats[i].connected = false;
    this.emit();
  }

  // ----- actions ------------------------------------------------------------
  controls(from, playerIdx) {
    const pl = this.game.players[playerIdx];
    if (!pl || pl.kind === 'bot') return false;
    const seat = this.seats[pl.seat];
    if (from === 'host') return seat.type === 'host' || seat.type === 'local';
    return seat.type === 'human' && seat.clientId === from;
  }

  /** from: 'host' or a remote clientId. Returns {ok, error}. */
  handle(from, action) {
    const isHost = from === 'host';
    const res = this._handle(from, isHost, action || {});
    if (res.ok) this.emit();
    return res;
  }

  _handle(from, isHost, a) {
    switch (a.type) {
      case 'place':
      case 'move': {
        if (!this.game) return { ok: false, error: 'No game running' };
        if (!this.controls(from, this.game.turn)) return { ok: false, error: 'Not your turn' };
        return applyAction(this.game, this.game.turn, a);
      }
      case 'rename': {
        const i = isHost ? 0 : this.seats.findIndex((s) => s.clientId === from);
        if (i < 0 || this.game) return { ok: false, error: 'Cannot rename now' };
        this.seats[i].name = String(a.name || '').slice(0, 20) || this.seats[i].name;
        return { ok: true };
      }
    }
    if (!isHost) return { ok: false, error: 'Only the host can do that' };
    switch (a.type) {
      case 'setSeat': {
        if (this.game) return { ok: false, error: 'Game running' };
        const i = a.seat;
        if (!(i >= 1 && i < MAX_PLAYERS)) return { ok: false, error: 'Bad seat' };
        const t = a.seatType;
        if (t === 'open' && !this.online) return { ok: false, error: 'Offline game' };
        if (t === 'open' || t === 'closed') this.seats[i] = { type: t };
        else if (t === 'local') this.seats[i] = { type: 'local', name: a.name || `Player ${i + 1}` };
        else if (t === 'bot') {
          const level = ['easy', 'medium', 'hard'].includes(a.botLevel) ? a.botLevel : 'medium';
          this.seats[i] = { type: 'bot', botLevel: level, name: botName(i, level) };
        } else return { ok: false, error: 'Bad seat type' };
        return { ok: true };
      }
      case 'setSeatName': {
        const s = this.seats[a.seat];
        if (!s || this.game || !['local', 'host'].includes(s.type)) return { ok: false, error: 'Cannot rename' };
        s.name = String(a.name || '').slice(0, 20) || s.name;
        return { ok: true };
      }
      case 'setOption': {
        if (a.style) this.options.style = ['compact', 'normal', 'spread'].includes(a.style) ? a.style : 'normal';
        if (typeof a.randomStart === 'boolean') this.options.randomStart = a.randomStart;
        return { ok: true };
      }
      case 'start':
        return this.startGame();
      case 'reroll': {
        if (!this.game || this.game.phase !== 'placement' || this.game.placementQueue.length !== this.game.players.length) {
          return { ok: false, error: 'Board can only be re-rolled before any flock is placed' };
        }
        return this.startGame(this.game.players);
      }
      case 'rematch':
        if (!this.game) return { ok: false, error: 'No game' };
        return this.startGame(this.game.players);
      case 'toLobby':
        this.game = null;
        // Drop seats of people who left during the game.
        this.seats.forEach((s, i) => { if (s.type === 'human' && !s.connected) this.seats[i] = { type: 'open' }; });
        return { ok: true };
      case 'replaceWithBot': {
        const pl = this.game && this.game.players[a.player];
        if (!pl || pl.kind === 'bot') return { ok: false, error: 'Bad player' };
        pl.kind = 'bot';
        pl.botLevel = 'medium';
        pl.name = `${pl.name} (bot)`;
        return { ok: true };
      }
    }
    return { ok: false, error: 'Unknown action' };
  }

  startGame(existingPlayers) {
    let players;
    if (existingPlayers) {
      players = existingPlayers.map(({ index, ...p }) => p);
    } else {
      players = [];
      this.seats.forEach((s, i) => {
        if (['host', 'human', 'local', 'bot'].includes(s.type)) {
          players.push({
            name: s.name || PLAYER_COLORS[i].name,
            seat: i,
            color: i,
            kind: s.type === 'bot' ? 'bot' : 'human',
            botLevel: s.botLevel || null,
          });
        }
      });
    }
    if (players.length < MIN_PLAYERS) return { ok: false, error: 'At least 2 players (humans or bots) are needed' };
    this.game = createGame({ players, style: this.options.style, randomStart: this.options.randomStart });
    return { ok: true };
  }

  // ----- bots ---------------------------------------------------------------
  scheduleBot() {
    clearTimeout(this.botTimer);
    const g = this.game;
    if (!g || (g.phase !== 'placement' && g.phase !== 'play')) return;
    const pl = g.players[g.turn];
    if (!pl || pl.kind !== 'bot') return;
    const version = this.version;
    this.botTimer = setTimeout(() => {
      if (this.version !== version || this.game !== g) return;
      const level = pl.botLevel || 'medium';
      let action;
      if (g.phase === 'placement') action = { type: 'place', key: choosePlacement(g, g.turn, level) };
      else action = { type: 'move', ...chooseMove(g, g.turn, level) };
      const res = applyAction(g, g.turn, action);
      if (!res.ok) console.error('Bot made an invalid move', res, action);
      this.emit();
    }, BOT_DELAY[g.phase] + Math.random() * 400);
  }

  destroy() {
    clearTimeout(this.botTimer);
  }
}

