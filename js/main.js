// Taistelulampaat – käyttöliittymä ja sovelluslogiikka
import { Room } from './room.js';
import { HostNet, ClientNet } from './net.js';
import {
  PLAYER_COLORS, SHEEP_PER_PLAYER, parseKey, key, DIRS,
  validPlacements, destinationsFrom, canMove, countFields,
} from './game.js';
import { BOT_LEVEL_NAMES } from './bot.js';
import { music } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------------------
// Pysyvä identiteetti
// ---------------------------------------------------------------------------
const store = {
  get name() { return localStorage.getItem('tl-name') || ''; },
  set name(v) { localStorage.setItem('tl-name', v); },
  get clientId() {
    let id = sessionStorage.getItem('tl-client-id');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
      sessionStorage.setItem('tl-client-id', id);
    }
    return id;
  },
};

const app = {
  role: null, // 'host' | 'client'
  room: null,
  net: null,
  state: null,
  sel: null, // valitun pinon avain
  pending: null, // { from, to, max, go }
  hideGameOver: false,
  prev: null, // animaatioiden seuranta
};

// ---------------------------------------------------------------------------
// Ilmoitukset ja apufunktiot
// ---------------------------------------------------------------------------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

function setNetStatus(text, cls) {
  const el = $('net-status');
  if (!text) { el.classList.add('hidden'); return; }
  el.className = `net-status ${cls}`;
  el.textContent = text;
}

function showScreen(name) {
  for (const s of ['home', 'lobby', 'game']) $(`screen-${s}`).classList.toggle('hidden', s !== name);
}

function inviteLink(code) {
  return `${location.origin}${location.pathname}?room=${code}`;
}

function setUrlRoom(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

function send(action) {
  if (app.role === 'host') {
    const res = app.room.handle('host', action);
    if (!res.ok) toast(res.error);
  } else if (app.net) {
    app.net.send(action);
  }
}

function controlsPlayer(s, p) {
  const g = s.game;
  const pl = g && g.players[p];
  if (!pl || pl.kind === 'bot') return false;
  const seat = s.seats[pl.seat];
  if (app.role === 'host') return seat.type === 'host' || seat.type === 'local';
  return seat.type === 'human' && seat.clientId === store.clientId;
}

function isMySeat(s, i) {
  const seat = s.seats[i];
  if (app.role === 'host') return seat.type === 'host';
  return seat.clientId === store.clientId;
}

function updateMusicUI() {
  const statusEl = $('music-status');
  if (statusEl) {
    statusEl.textContent = music.enabled ? 'Musiikki: Päällä' : 'Musiikki: Pois';
  }
}

// ---------------------------------------------------------------------------
// Lammasgrafiikka (SVG)
// ---------------------------------------------------------------------------
function sheepGroup(colorIdx, s, count) {
  const c = PLAYER_COLORS[colorIdx];
  const puffs = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    puffs.push(`<circle cx="${(Math.cos(a) * 0.3 * s).toFixed(1)}" cy="${(Math.sin(a) * 0.22 * s).toFixed(1)}" r="${(0.16 * s).toFixed(1)}"/>`);
  }
  const countSvg = count == null ? '' :
    `<text class="count-text" x="${(-0.05 * s).toFixed(1)}" y="${(0.13 * s).toFixed(1)}" text-anchor="middle" font-size="${(0.38 * s).toFixed(1)}" fill="#fff" stroke="${c.dark}" stroke-width="${(0.09 * s).toFixed(1)}">${count}</text>`;
  return `
    <ellipse cx="0" cy="${(0.36 * s).toFixed(1)}" rx="${(0.38 * s).toFixed(1)}" ry="${(0.08 * s).toFixed(1)}" fill="rgba(0,0,0,0.18)"/>
    <rect x="${(-0.22 * s).toFixed(1)}" y="${(0.15 * s).toFixed(1)}" width="${(0.07 * s).toFixed(1)}" height="${(0.2 * s).toFixed(1)}" rx="2" fill="${c.dark}"/>
    <rect x="${(0.12 * s).toFixed(1)}" y="${(0.15 * s).toFixed(1)}" width="${(0.07 * s).toFixed(1)}" height="${(0.2 * s).toFixed(1)}" rx="2" fill="${c.dark}"/>
    <g fill="${c.main}" stroke="${c.dark}" stroke-width="${(0.05 * s).toFixed(1)}">${puffs.join('')}</g>
    <ellipse cx="0" cy="0" rx="${(0.34 * s).toFixed(1)}" ry="${(0.25 * s).toFixed(1)}" fill="${c.main}"/>
    <ellipse cx="${(-0.06 * s).toFixed(1)}" cy="${(-0.08 * s).toFixed(1)}" rx="${(0.18 * s).toFixed(1)}" ry="${(0.08 * s).toFixed(1)}" fill="#fff" opacity="0.25"/>
    <ellipse cx="${(0.4 * s).toFixed(1)}" cy="${(-0.1 * s).toFixed(1)}" rx="${(0.14 * s).toFixed(1)}" ry="${(0.12 * s).toFixed(1)}" fill="${c.dark}"/>
    <ellipse cx="${(0.34 * s).toFixed(1)}" cy="${(-0.21 * s).toFixed(1)}" rx="${(0.07 * s).toFixed(1)}" ry="${(0.035 * s).toFixed(1)}" fill="${c.dark}" transform="rotate(-25 ${(0.34 * s).toFixed(1)} ${(-0.21 * s).toFixed(1)})"/>
    <circle cx="${(0.44 * s).toFixed(1)}" cy="${(-0.13 * s).toFixed(1)}" r="${(0.03 * s).toFixed(1)}" fill="#fff"/>
    ${countSvg}`;
}

function sheepIcon(colorIdx, size = 40) {
  return `<svg class="swatch" viewBox="${-size / 2} ${-size / 2} ${size} ${size}" width="${size}" height="${size}">${sheepGroup(colorIdx, size * 0.95)}</svg>`;
}

// ---------------------------------------------------------------------------
// ALKUNÄYTTÖ
// ---------------------------------------------------------------------------
function getName() {
  const n = $('home-name').value.trim().slice(0, 20) || 'Paimen';
  store.name = n;
  return n;
}

function resetSession() {
  if (app.room) app.room.destroy();
  if (app.net) app.net.destroy();
  Object.assign(app, { role: null, room: null, net: null, state: null, sel: null, pending: null, hideGameOver: false, prev: null });
  setNetStatus(null);
}

function goHome(error) {
  resetSession();
  setUrlRoom(null);
  showScreen('home');
  $('home-error').textContent = error || '';
}

function onHostState(state) {
  app.state = state;
  if (app.net) app.net.broadcast(state);
  render();
}

function createGame(online) {
  resetSession();
  const name = getName();
  app.role = 'host';
  app.room = new Room({ hostName: name, online, onState: onHostState });
  if (online) {
    setNetStatus('Avataan huonetta…', 'warn');
    try {
      app.net = new HostNet(app.room, {
        onReady: (code) => {
          app.room.code = code;
          setNetStatus('Huone avattu', 'ok');
          app.room.emit();
        },
        onError: (err) => {
          console.error(err);
          setNetStatus('Yhteysongelma', 'bad');
          toast(`Verkkovirhe: ${err.message || err.type || err}`);
        },
      });
      app.net.start();
    } catch (e) {
      goHome(e.message);
      return;
    }
  }
  app.room.emit();
}

function joinGame(code) {
  code = (code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) { $('home-error').textContent = 'Syötä 5-merkkinen huonekoodi.'; return; }
  resetSession();
  const name = getName();
  app.role = 'client';
  setUrlRoom(code);
  try {
    app.net = new ClientNet({
      code, name, clientId: store.clientId,
      onState: (state) => { app.state = state; render(); },
      onError: (msg, fatal) => {
        if (fatal && !app.state) goHome(msg);
        else toast(msg);
      },
      onStatus: (st) => {
        if (st === 'connected') setNetStatus(`Yhdistetty · ${code}`, 'ok');
        else if (st === 'connecting') setNetStatus('Yhdistetään…', 'warn');
        else {
          setNetStatus('Yhteys katkesi – napsauta yhdistääksesi', 'bad');
          toast('Yhteys huoneen luojaan katkesi.');
        }
      },
    });
    app.net.connect();
  } catch (e) {
    goHome(e.message);
    return;
  }
  showScreen('lobby');
  $('seats').innerHTML = '<p class="muted center">Yhdistetään huoneeseen <b>' + esc(code) + '</b>…</p>';
  $('room-share').innerHTML = '';
  $('lobby-options').innerHTML = '';
  $('btn-start').classList.add('hidden');
  $('lobby-msg').textContent = '';
}

// ---------------------------------------------------------------------------
// RENDERÖINTI
// ---------------------------------------------------------------------------
function render() {
  const s = app.state;
  if (!s) return;
  if (!s.game) {
    app.prev = null;
    app.hideGameOver = false;
    showScreen('lobby');
    renderLobby(s);
  } else {
    showScreen('game');
    renderGame(s);
  }
}

function withFocus(fn) {
  const a = document.activeElement;
  const id = a && a.id;
  const sel = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
  const val = a && a.value;
  fn();
  if (id && a.tagName === 'INPUT') {
    const n = $(id);
    if (n && n !== a) {
      n.value = val;
      n.focus();
      if (sel) try { n.setSelectionRange(sel[0], sel[1]); } catch { /* ignore */ }
    }
  }
}

function seatSelectValue(seat) {
  if (seat.type === 'bot') return `bot-${seat.botLevel}`;
  return seat.type;
}

function renderLobby(s) {
  const host = app.role === 'host';
  if (s.online) {
    $('room-share').innerHTML = s.code
      ? `<span class="muted">Huone</span><span class="room-code">${esc(s.code)}</span>
         <button class="btn secondary small" data-action="copy-link">📋 Kopioi kutsulinkki</button>`
      : '<span class="muted">Avataan huonetta…</span>';
  } else {
    $('room-share').innerHTML = '<span class="muted">Offline · botit &amp; samalla laitteella</span>';
  }

  withFocus(() => {
    $('seats').innerHTML = s.seats.map((seat, i) => {
      const color = PLAYER_COLORS[i];
      const mine = isMySeat(s, i);
      const empty = seat.type === 'open' || seat.type === 'closed';
      let main = '';
      let control = '';
      if (seat.type === 'host') {
        main = (host
          ? `<input id="seat-name-${i}" data-seat-name="${i}" value="${esc(seat.name)}" maxlength="20" />`
          : `<div class="seat-name">${esc(seat.name)}</div>`) + `<div class="seat-sub">Huoneen luoja</div>`;
      } else if (seat.type === 'human') {
        main = (mine
          ? `<input id="seat-name-${i}" data-self-name="1" value="${esc(seat.name)}" maxlength="20" />`
          : `<div class="seat-name">${esc(seat.name)}</div>`) +
          `<div class="seat-sub">${mine ? 'Sinä · ' : ''}Verkkopelaaja${seat.connected === false ? ' · yhteys katkennut' : ''}</div>`;
      } else if (seat.type === 'local') {
        main = (host
          ? `<input id="seat-name-${i}" data-seat-name="${i}" value="${esc(seat.name)}" maxlength="20" />`
          : `<div class="seat-name">${esc(seat.name)}</div>`) + `<div class="seat-sub">Pelaaja samalla laitteella</div>`;
      } else if (seat.type === 'bot') {
        const fiLevel = BOT_LEVEL_NAMES[seat.botLevel] || seat.botLevel;
        main = `<div class="seat-name">${esc(seat.name)}</div><div class="seat-sub">Tietokone · ${esc(fiLevel)}</div>`;
      } else if (seat.type === 'open') {
        main = `<div class="seat-name">Odotetaan pelaajaa…</div><div class="seat-sub">Jaa kutsulinkki kaverillesi</div>`;
      } else {
        main = `<div class="seat-name muted">Tyhjä paikka</div>`;
      }
      if (host && i > 0) {
        const opts = [];
        if (seat.type === 'human') opts.push(['human', `👤 ${seat.name}`]);
        if (s.online) opts.push(['open', '🌐 Avoin verkkopelaajalle']);
        opts.push(['local', '🪑 Pelaaja samalla laitteella'], ['bot-easy', '🤖 Botti – helppo'], ['bot-medium', '🤖 Botti – keskitaso'], ['bot-hard', '🤖 Botti – vaikea'], ['closed', '✕ Ei pelaajaa']);
        const v = seatSelectValue(seat);
        control = `<select data-seat-type="${i}">${opts.map(([val, label]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
      }
      return `<div class="seat ${mine ? 'me' : ''} ${empty ? 'empty' : ''}" title="${color.name}">
        ${sheepIcon(i, 40)}
        <div class="seat-main">${main}</div>
        ${control}
      </div>`;
    }).join('');
  });

  const o = s.options;
  const styleNames = { compact: 'Kompakti', normal: 'Normaali', spread: 'Levittäytyvä' };
  $('lobby-options').innerHTML = host
    ? `<label>Laitumen muoto
         <select data-option="style">
           <option value="compact" ${o.style === 'compact' ? 'selected' : ''}>Kompakti</option>
           <option value="normal" ${o.style === 'normal' ? 'selected' : ''}>Normaali</option>
           <option value="spread" ${o.style === 'spread' ? 'selected' : ''}>Levittäytyvä</option>
         </select></label>
       <label><input type="checkbox" data-option="randomStart" ${o.randomStart ? 'checked' : ''}/> Arvo aloittava pelaaja</label>`
    : `<span class="muted">Laidun: ${esc(styleNames[o.style] || o.style)} · ${o.randomStart ? 'arvottu' : 'kiinteä'} aloittaja</span>`;

  const active = s.seats.filter((x) => ['host', 'human', 'local', 'bot'].includes(x.type)).length;
  const startBtn = $('btn-start');
  startBtn.classList.toggle('hidden', !host);
  startBtn.disabled = active < 2;
  const waitingOpen = s.seats.some((x) => x.type === 'open');
  $('lobby-msg').textContent = host
    ? (active < 2 ? 'Lisää vähintään yksi toinen pelaaja tai botti.' : waitingOpen ? 'Avoimia paikkoja ei huomioida pelin alkaessa.' : '')
    : 'Odotetaan huoneen luojan aloittavan pelin…';
}

// ---------------------------------------------------------------------------
// LAUDAN JA PELIN RENDERÖINTI
// ---------------------------------------------------------------------------
const HEX = 40;
const SQ3 = Math.sqrt(3);
const GRASS = ['#8fd16c', '#7fc560', '#99d977', '#86ca66', '#78bd59', '#a0dc80'];
const EDGE_CORNERS = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];

const px = (q, r) => [HEX * SQ3 * (q + r / 2), HEX * 1.5 * r];
function corner(cx, cy, i, s = HEX) {
  const a = ((60 * i - 30) * Math.PI) / 180;
  return [cx + s * Math.cos(a), cy + s * Math.sin(a)];
}
function hexPoints(cx, cy, s = HEX) {
  return Array.from({ length: 6 }, (_, i) => corner(cx, cy, i, s).map((v) => v.toFixed(1)).join(',')).join(' ');
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function renderBoard(s, ctx) {
  const g = s.game;
  const cells = g.cells;
  const keys = Object.keys(cells);
  const centers = {};
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of keys) {
    const [q, r] = parseKey(k);
    const [x, y] = px(q, r);
    centers[k] = [x, y];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = HEX * 1.4;
  const svg = $('board');
  svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2 + 10}`);

  const out = [];
  out.push('<defs>');
  PLAYER_COLORS.forEach((c, i) => out.push(
    `<marker id="arrow-${i}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c.dark}"/></marker>`));
  out.push('</defs>');

  // 3D-maakerros
  out.push('<g>');
  for (const k of keys) { const [x, y] = centers[k]; out.push(`<polygon points="${hexPoints(x, y + 9)}" fill="#8a6239" stroke="#6b4a29" stroke-width="2"/>`); }
  out.push('</g>');

  // Laidunkentät
  out.push('<g>');
  for (const k of keys) {
    const [x, y] = centers[k];
    const c = cells[k];
    const cls = ctx.clickable.has(k) ? 'cell clickable' : 'cell';
    out.push(`<polygon class="${cls}" data-k="${k}" points="${hexPoints(x, y)}" fill="${GRASS[c.tile % GRASS.length]}" stroke="rgba(40,90,30,0.25)" stroke-width="1.5"/>`);
    const h = hash(k + g.seed);
    for (let t = 0; t < 3; t++) {
      const tx = x + (((h >> (t * 5)) & 31) / 31 - 0.5) * HEX * 1.1;
      const ty = y + (((h >> (t * 5 + 15)) & 31) / 31 - 0.5) * HEX * 0.9;
      out.push(`<path d="M${(tx - 4).toFixed(1)},${ty.toFixed(1)} l2,-6 l2,6 l2,-5 l2,5" fill="none" stroke="rgba(40,100,30,0.35)" stroke-width="1.6" stroke-linecap="round" pointer-events="none"/>`);
    }
    if (h % 5 === 0) {
      const fx = x + ((h % 13) - 6) * 2.5, fy = y + (((h >> 8) % 11) - 5) * 2.5;
      out.push(`<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="2.6" fill="${h % 2 ? '#fff' : '#ffe066'}" stroke="rgba(0,0,0,0.15)" pointer-events="none"/>`);
    }
  }
  out.push('</g>');

  // Reunaviivat
  const edges = [];
  for (const k of keys) {
    const [q, r] = parseKey(k);
    const [x, y] = centers[k];
    DIRS.forEach(([dq, dr], d) => {
      const nk = key(q + dq, r + dr);
      const n = cells[nk];
      if (n && n.tile === cells[k].tile) return;
      if (n && k > nk) return;
      const [a, b] = EDGE_CORNERS[d];
      const [x1, y1] = corner(x, y, a);
      const [x2, y2] = corner(x, y, b);
      edges.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${n ? 'rgba(45,95,35,0.55)' : '#3f6f2e'}" stroke-width="${n ? 2.5 : 4}" stroke-linecap="round"/>`);
    });
  }
  out.push(`<g pointer-events="none">${edges.join('')}</g>`);

  // Aloitussijoituksen hehkukentät
  for (const k of ctx.placeable) {
    const [x, y] = centers[k];
    out.push(`<polygon class="hl-place" points="${hexPoints(x, y, HEX * 0.82)}"/>`);
  }

  // Viimeisimmän siirron nuoli
  const lm = g.lastMove;
  if (lm && lm.type === 'move' && cells[lm.from] && cells[lm.to]) {
    const [x1, y1] = centers[lm.from];
    const [x2, y2] = centers[lm.to];
    const col = PLAYER_COLORS[g.players[lm.player].color];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    out.push(`<line x1="${(x1 + ux * HEX * 0.5).toFixed(1)}" y1="${(y1 + uy * HEX * 0.5).toFixed(1)}" x2="${(x2 - ux * HEX * 0.55).toFixed(1)}" y2="${(y2 - uy * HEX * 0.55).toFixed(1)}" stroke="${col.dark}" stroke-width="5" stroke-dasharray="2 9" stroke-linecap="round" opacity="0.6" marker-end="url(#arrow-${g.players[lm.player].color})" pointer-events="none"/>`);
  }

  // Valittavissa olevien pinojen renkaat
  for (const k of ctx.selectable) {
    const [x, y] = centers[k];
    const isSel = k === app.sel;
    out.push(`<circle class="${isSel ? 'sel-ring' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${HEX * 0.72}" fill="${isSel ? 'rgba(255,255,255,0.35)' : 'none'}" stroke="#fff" stroke-width="${isSel ? 4 : 2.5}" stroke-dasharray="${isSel ? '8 5' : '4 6'}" pointer-events="none"/>`);
  }

  // Lampaat
  for (const k of keys) {
    const c = cells[k];
    if (c.owner < 0) continue;
    const [x, y] = centers[k];
    const pl = g.players[c.owner];
    let count = c.count;
    if (app.pending && app.pending.from === k) count = c.count - app.pending.go;
    let inner = sheepGroup(pl.color, HEX * 1.15, count);
    let cls = 'sheep';
    if (ctx.fresh.has(k)) {
      if (lm && lm.type === 'move' && lm.to === k && centers[lm.from]) {
        const [fx, fy] = centers[lm.from];
        inner = `<g>${inner}<animateTransform attributeName="transform" type="translate" from="${(fx - x).toFixed(1)} ${(fy - y).toFixed(1)}" to="0 0" dur="0.45s" calcMode="spline" keySplines="0.3 0 0.2 1" keyTimes="0;1" fill="freeze"/></g>`;
      } else cls += ' pop';
    }
    out.push(`<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><g class="${cls}">${inner}</g></g>`);
  }

  // Valitun pinon kohderuutumerkit
  for (const k of ctx.dests) {
    const [x, y] = centers[k];
    const col = PLAYER_COLORS[g.players[g.turn].color];
    if (app.pending && app.pending.to === k) {
      out.push(`<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})" opacity="0.85" pointer-events="none">${sheepGroup(g.players[g.turn].color, HEX * 1.15, app.pending.go)}</g>`);
    } else {
      out.push(`<circle class="dest-marker" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${HEX * 0.42}" fill="${col.main}" fill-opacity="0.35" stroke="${col.dark}" stroke-width="3" stroke-dasharray="6 4"/>`);
    }
  }

  svg.innerHTML = out.join('');
}

function renderGame(s) {
  const g = s.game;
  const myTurn = (g.phase === 'placement' || g.phase === 'play') && controlsPlayer(s, g.turn);

  if (!myTurn || g.phase !== 'play') { app.sel = null; app.pending = null; }
  if (app.sel) {
    const c = g.cells[app.sel];
    if (!c || c.owner !== g.turn || c.count < 2) { app.sel = null; app.pending = null; }
  }

  const fresh = new Set();
  const prev = app.prev;
  if (prev && prev.seed === g.seed) {
    for (const k in g.cells) if (g.cells[k].owner >= 0 && prev.owners[k] < 0) fresh.add(k);
  }
  const owners = {};
  for (const k in g.cells) owners[k] = g.cells[k].owner;
  const sameFrame = prev && prev.seed === g.seed && prev.version === s.version;
  app.prev = { seed: g.seed, owners, version: s.version, fresh: sameFrame ? prev.fresh : fresh };
  const freshNow = sameFrame ? new Set() : fresh;

  const ctx = { clickable: new Set(), placeable: [], selectable: [], dests: [], fresh: freshNow };
  if (myTurn && g.phase === 'placement') {
    ctx.placeable = validPlacements(g);
    ctx.placeable.forEach((k) => ctx.clickable.add(k));
  } else if (myTurn && g.phase === 'play') {
    for (const k in g.cells) {
      const c = g.cells[k];
      if (c.owner === g.turn && c.count > 1 && destinationsFrom(g.cells, k).length) {
        ctx.selectable.push(k);
        ctx.clickable.add(k);
      }
    }
    if (app.sel) {
      ctx.dests = destinationsFrom(g.cells, app.sel).map((d) => d.to);
      ctx.dests.forEach((k) => ctx.clickable.add(k));
    }
  }
  renderBoard(s, ctx);

  // Vuoropalkki
  const banner = $('turn-banner');
  const controlledHumans = g.players.filter((p) => controlsPlayer(s, p.index)).length;
  if (g.phase === 'over') {
    banner.className = 'turn-banner';
    banner.style.borderColor = 'transparent';
    banner.innerHTML = '🏁 Peli päättyi';
  } else {
    const pl = g.players[g.turn];
    const col = PLAYER_COLORS[pl.color];
    banner.style.borderColor = col.main;
    banner.className = `turn-banner ${myTurn ? 'mine' : ''}`;
    const who = controlledHumans > 1 ? `${esc(pl.name)}, sinun vuorosi` : 'Sinun vuorosi';
    let text;
    if (myTurn && g.phase === 'placement') text = `${who} – aseta koko 16 lampaan laumasi hehkuvaan reunaruutuun`;
    else if (myTurn && app.pending) text = 'Valitse kuinka monta lammasta siirtyy';
    else if (myTurn && app.sel) text = 'Valitse kohderuutu – tai toinen pino';
    else if (myTurn) text = `${who} – valitse pino ja jaa se`;
    else if (pl.kind === 'bot') text = `${esc(pl.name)} miettii siirtoa…`;
    else text = `Odotetaan pelaajaa ${esc(pl.name)}…`;
    banner.innerHTML = `<span class="dot" style="background:${col.main}"></span>${text}`;
  }

  // Jakovalikko
  const panel = $('split-panel');
  if (app.pending) {
    panel.classList.remove('hidden');
    const range = $('split-range');
    range.max = app.pending.max;
    range.value = app.pending.go;
    $('split-go').textContent = app.pending.go;
    $('split-stay').textContent = g.cells[app.pending.from].count - app.pending.go;
  } else panel.classList.add('hidden');

  // Huoneen tiedot
  $('game-room').innerHTML = s.online
    ? `<span>Huone <b>${esc(s.code || '…')}</b></span><button class="btn ghost small" data-action="copy-link">📋 Kutsu</button>`
    : '<span>Offline-peli</span>';

  // Pelaajat
  const order = g.order.map((i) => g.players[i]);
  $('players').innerHTML = order.map((pl) => {
    const seat = s.seats[pl.seat] || {};
    const col = PLAYER_COLORS[pl.color];
    const stuck = g.phase === 'play' && !canMove(g, pl.index);
    const active = g.turn === pl.index && g.phase !== 'over';
    let sub;
    if (pl.kind === 'bot') {
      const fiLvl = BOT_LEVEL_NAMES[pl.botLevel] || pl.botLevel;
      sub = `🤖 ${fiLvl} botti`;
    } else if (seat.type === 'host') sub = '👑 Huoneen luoja';
    else if (seat.type === 'local') sub = '🪑 Samalla laitteella';
    else sub = seat.connected === false ? '⚠️ Yhteys katkennut' : '🌐 Verkossa';

    if (controlsPlayer(s, pl.index)) sub += ' · sinä';
    if (stuck) sub += ' · ei voi liikkua';
    const stacks = Object.values(g.cells).filter((c) => c.owner === pl.index).length;
    return `<div class="player ${active ? 'active' : ''} ${stuck ? 'stuck' : ''}" style="color:${col.main}">
      ${sheepIcon(pl.color, 34)}
      <div class="p-main"><div class="p-name">${esc(pl.name)}</div><div class="p-sub">${sub}</div></div>
      <div class="p-score"><b>${stacks}</b><small>ruutua</small></div>
    </div>`;
  }).join('');

  // Isännän työkalut
  const tools = [];
  if (app.role === 'host') {
    if (g.phase === 'placement' && g.placementQueue.length === g.players.length) {
      tools.push('<button class="btn secondary small" data-action="reroll">🎲 Uusi laidun</button>');
    }
    g.players.forEach((pl) => {
      const seat = s.seats[pl.seat];
      if (pl.kind !== 'bot' && seat.type === 'human' && seat.connected === false) {
        tools.push(`<button class="btn danger small" data-action="replace-bot" data-player="${pl.index}">🤖 Korvaa ${esc(pl.name)} botilla</button>`);
      }
    });
    tools.push('<button class="btn ghost small" data-action="to-lobby">↩ Lobbyyn</button>');
  } else {
    tools.push('<button class="btn ghost small" data-action="leave">Poistu pelistä</button>');
  }
  if (g.phase === 'over' && app.hideGameOver) tools.push('<button class="btn secondary small" data-action="show-results">🏆 Tulokset</button>');
  $('host-tools').innerHTML = tools.join('');

  // Loki
  const log = $('log');
  log.innerHTML = g.log.slice().reverse().map((e) => {
    const dot = e.player != null ? `<span class="dot" style="background:${PLAYER_COLORS[g.players[e.player].color].main}"></span>` : '<span>📣</span>';
    return `<li>${dot}<span>${esc(e.text)}</span></li>`;
  }).join('');

  // Pelin päättyminen
  const over = $('gameover');
  if (g.phase === 'over' && !app.hideGameOver) {
    over.classList.remove('hidden');
    const res = g.results;
    const winners = res.filter((r) => r.rank === 1).map((r) => g.players[r.player]);
    const iWon = winners.some((w) => controlsPlayer(s, w.index));
    const title = winners.length > 1 ? `Tasapeli!` : `${esc(winners[0].name)} voitti!`;
    const medals = ['🥇', '🥈', '🥉', '4️⃣'];
    $('gameover-card').innerHTML = `
      <div class="trophy">${iWon ? '🏆' : '🐑'}</div>
      <h2>${title}</h2>
      <table class="results">
        <tr><th></th><th>Pelaaja</th><th class="num">Ruudut</th><th class="num">Suurin lauma</th></tr>
        ${res.map((r) => {
          const pl = g.players[r.player];
          return `<tr><td>${medals[r.rank - 1]}</td><td><span class="dot" style="background:${PLAYER_COLORS[pl.color].main}"></span> ${esc(pl.name)}</td><td class="num"><b>${r.fields}</b></td><td class="num">${r.group}</td></tr>`;
        }).join('')}
      </table>
      <div class="gameover-actions">
        <button class="btn ghost" data-action="hide-results">Tarkastele lautaa</button>
        ${app.role === 'host'
          ? '<button class="btn secondary" data-action="to-lobby">Lobbyyn</button><button class="btn primary" data-action="rematch">Uusi peli</button>'
          : '<span class="muted" style="align-self:center">Odotetaan huoneen luojaa…</span>'}
      </div>`;
  } else over.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Laudalla klikkailu
// ---------------------------------------------------------------------------
function onBoardClick(e) {
  const s = app.state;
  if (!s || !s.game) return;
  const g = s.game;
  const target = e.target.closest('[data-k]');
  if (!target) { if (app.sel && !app.pending) { app.sel = null; render(); } return; }
  const k = target.dataset.k;
  if (!controlsPlayer(s, g.turn)) return;

  if (g.phase === 'placement') {
    if (validPlacements(g).includes(k)) send({ type: 'place', key: k });
    return;
  }
  if (g.phase !== 'play') return;
  const c = g.cells[k];
  if (app.sel && destinationsFrom(g.cells, app.sel).some((d) => d.to === k)) {
    const from = g.cells[app.sel];
    if (from.count === 2) {
      send({ type: 'move', from: app.sel, to: k, count: 1 });
      app.sel = null;
      return;
    }
    app.pending = { from: app.sel, to: k, max: from.count - 1, go: Math.floor(from.count / 2) };
    render();
    return;
  }
  if (c.owner === g.turn && c.count > 1 && destinationsFrom(g.cells, k).length) {
    app.sel = app.sel === k ? null : k;
    app.pending = null;
  } else {
    app.sel = null;
    app.pending = null;
  }
  render();
}

function setSplit(v) {
  if (!app.pending) return;
  app.pending.go = Math.max(1, Math.min(app.pending.max, v));
  render();
}

function confirmSplit() {
  const p = app.pending;
  if (!p) return;
  app.pending = null;
  app.sel = null;
  send({ type: 'move', from: p.from, to: p.to, count: p.go });
}

// ---------------------------------------------------------------------------
// Tapahtumakäsittelijät
// ---------------------------------------------------------------------------
async function copyInvite() {
  const code = app.state && app.state.code;
  if (!code) return;
  const link = inviteLink(code);
  try {
    await navigator.clipboard.writeText(link);
    toast('Kutsulinkki kopioitu leikepöydälle!');
  } catch {
    prompt('Kopioi tämä kutsulinkki:', link);
  }
}

// Käynnistetään taustamusiikki ensimmäisestä käyttäjän klikkauksesta
let audioStarted = false;
function ensureAudioStarted() {
  if (!audioStarted) {
    audioStarted = true;
    if (music.enabled) {
      music.start();
    }
  }
}

document.addEventListener('click', (e) => {
  ensureAudioStarted();

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  switch (a) {
    case 'toggle-music':
      music.toggle();
      updateMusicUI();
      break;
    case 'home':
      if (app.state && !confirm('Haluatko poistua nykyisestä pelistä?')) return;
      goHome();
      break;
    case 'rules': $('rules').classList.remove('hidden'); break;
    case 'close-rules': $('rules').classList.add('hidden'); break;
    case 'create-online': createGame(true); break;
    case 'create-offline': createGame(false); break;
    case 'join': joinGame($('join-code').value); break;
    case 'leave':
      if (app.role === 'host' && app.state && app.state.online && !confirm('Poistuminen sulkee huoneen kaikilta pelaajilta. Haluatko varmasti poistua?')) return;
      goHome();
      break;
    case 'start': send({ type: 'start' }); break;
    case 'copy-link': copyInvite(); break;
    case 'reroll': send({ type: 'reroll' }); break;
    case 'rematch': app.hideGameOver = false; send({ type: 'rematch' }); break;
    case 'to-lobby':
      if (app.state.game && app.state.game.phase !== 'over' && !confirm('Päätetäänkö tämä peli ja palataan lobbyyn?')) return;
      send({ type: 'toLobby' });
      break;
    case 'replace-bot': send({ type: 'replaceWithBot', player: Number(el.dataset.player) }); break;
    case 'hide-results': app.hideGameOver = true; render(); break;
    case 'show-results': app.hideGameOver = false; render(); break;
    case 'split-inc': setSplit(app.pending.go + 1); break;
    case 'split-dec': setSplit(app.pending.go - 1); break;
    case 'split-cancel': app.pending = null; render(); break;
    case 'split-confirm': confirmSplit(); break;
  }
});

$('board').addEventListener('click', onBoardClick);
$('split-range').addEventListener('input', (e) => setSplit(Number(e.target.value)));
$('net-status').addEventListener('click', () => {
  if (app.role === 'client' && app.net && $('net-status').classList.contains('bad')) app.net.connect();
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.seatType) {
    const v = el.value;
    const seat = Number(el.dataset.seatType);
    if (v === 'human') return;
    if (v.startsWith('bot-')) send({ type: 'setSeat', seat, seatType: 'bot', botLevel: v.slice(4) });
    else send({ type: 'setSeat', seat, seatType: v });
  } else if (el.dataset.seatName) {
    const seat = Number(el.dataset.seatName);
    if (seat === 0) store.name = el.value.trim() || store.name;
    send({ type: 'setSeatName', seat, name: el.value.trim() });
  } else if (el.dataset.selfName) {
    store.name = el.value.trim() || store.name;
    send({ type: 'rename', name: el.value.trim() });
  } else if (el.dataset.option === 'style') {
    send({ type: 'setOption', style: el.value });
  } else if (el.dataset.option === 'randomStart') {
    send({ type: 'setOption', randomStart: el.checked });
  }
});

document.addEventListener('keydown', (e) => {
  ensureAudioStarted();
  if (e.key === 'Escape') {
    $('rules').classList.add('hidden');
    if (app.pending) { app.pending = null; render(); } else if (app.sel) { app.sel = null; render(); }
  } else if (app.pending && e.target.tagName !== 'INPUT') {
    if (e.key === 'Enter') confirmSplit();
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setSplit(app.pending.go + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setSplit(app.pending.go - 1);
  } else if (e.key === 'Enter' && e.target.id === 'join-code') {
    joinGame(e.target.value);
  } else if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
    e.target.blur();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (app.role === 'host' && app.state && app.state.online && app.state.seats.some((s) => s.type === 'human' && s.connected)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------------------------------------------------------------------------
// Käynnistys
// ---------------------------------------------------------------------------
$('home-name').value = store.name;
updateMusicUI();

const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) {
  $('join-code').value = urlRoom.toUpperCase();
  if (store.name) {
    window.addEventListener('load', () => joinGame(urlRoom));
  } else {
    $('home-name').focus();
    $('home-error').textContent = 'Kirjoita nimesi ja paina Liity astuaksesi huoneeseen.';
  }
}
showScreen('home');
