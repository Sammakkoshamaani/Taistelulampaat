// Battle Sheeps – pure game rules (no DOM, no network).
// Shared by the host engine, the bots and the UI.

export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const SHEEP_PER_PLAYER = 16;
export const TILES_PER_PLAYER = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export const PLAYER_COLORS = [
  { name: 'Red', main: '#e5484d', dark: '#8f1d21', light: '#ffd5d6' },
  { name: 'Blue', main: '#3e8ef7', dark: '#163f80', light: '#d3e5ff' },
  { name: 'Yellow', main: '#f5c518', dark: '#7d6200', light: '#fff1bd' },
  { name: 'Purple', main: '#9b59d0', dark: '#4c2370', light: '#ecdcf8' },
];

export const key = (q, r) => `${q},${r}`;
export function parseKey(k) {
  const i = k.indexOf(',');
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
}

/** Small deterministic PRNG (mulberry32). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Board generation: every pasture tile is a rhombus of 4 hexes. Tiles are
// added one by one, each touching the existing pasture, like in the real game.
// ---------------------------------------------------------------------------
const BASE_TILE = [[0, 0], [1, 0], [0, 1], [1, 1]];
const rotate = ([q, r]) => [-r, q + r];
function normalize(cells) {
  const mq = Math.min(...cells.map((c) => c[0]));
  const mr = Math.min(...cells.map((c) => c[1]));
  return cells.map(([q, r]) => [q - mq, r - mr]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
export const TILE_SHAPES = (() => {
  const out = [];
  const seen = new Set();
  let s = BASE_TILE;
  for (let i = 0; i < 6; i++) {
    const n = normalize(s);
    const sig = JSON.stringify(n);
    if (!seen.has(sig)) { seen.add(sig); out.push(n); }
    s = s.map(rotate);
  }
  return out;
})();

function placementWeight(contacts, style) {
  if (style === 'compact') return contacts ** 3;
  if (style === 'spread') return 1 / contacts;
  return contacts ** 1.6;
}

/** Returns Map<cellKey, tileIndex>. */
export function generateBoard(numTiles, rng, style = 'normal') {
  const board = new Map();
  const first = TILE_SHAPES[Math.floor(rng() * TILE_SHAPES.length)];
  for (const [q, r] of first) board.set(key(q, r), 0);

  for (let t = 1; t < numTiles; t++) {
    const frontier = new Set();
    for (const k of board.keys()) {
      const [q, r] = parseKey(k);
      for (const [dq, dr] of DIRS) {
        const nk = key(q + dq, r + dr);
        if (!board.has(nk)) frontier.add(nk);
      }
    }
    const cands = [];
    const seen = new Set();
    let total = 0;
    for (const fk of frontier) {
      const [fq, fr] = parseKey(fk);
      for (const shape of TILE_SHAPES) {
        for (const [cq, cr] of shape) {
          const pos = shape.map(([q, r]) => [q + fq - cq, r + fr - cr]);
          const keys = pos.map(([q, r]) => key(q, r));
          const sig = keys.join('|');
          if (seen.has(sig)) continue;
          seen.add(sig);
          if (keys.some((k) => board.has(k))) continue;
          let contacts = 0;
          for (const [q, r] of pos) {
            for (const [dq, dr] of DIRS) if (board.has(key(q + dq, r + dr))) contacts++;
          }
          const w = placementWeight(contacts, style);
          cands.push({ keys, w });
          total += w;
        }
      }
    }
    let x = rng() * total;
    let pick = cands[cands.length - 1];
    for (const c of cands) {
      x -= c.w;
      if (x <= 0) { pick = c; break; }
    }
    for (const k of pick.keys) board.set(k, t);
  }
  return board;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

/**
 * players: [{ name, seat, color, kind: 'human'|'bot', botLevel }]
 */
export function createGame({ players, seed = (Math.random() * 2 ** 32) >>> 0, style = 'normal', randomStart = true }) {
  const rng = makeRng(seed);
  const n = players.length;
  const board = generateBoard(n * TILES_PER_PLAYER, rng, style);
  const cells = {};
  for (const [k, t] of board) cells[k] = { tile: t, owner: -1, count: 0 };
  const start = randomStart ? Math.floor(rng() * n) : 0;
  const order = Array.from({ length: n }, (_, i) => (start + i) % n);
  // The player who moves last places their flock first.
  const placementQueue = [...order].reverse();
  return {
    phase: 'placement',
    players: players.map((p, i) => ({ ...p, index: i })),
    cells,
    order,
    placementQueue,
    turn: placementQueue[0],
    moveNo: 0,
    lastMove: null,
    log: [{ text: `New pasture with ${board.size} fields. ${players[placementQueue[0]].name} places first.` }],
    seed,
    style,
    randomStart,
    results: null,
  };
}

export function isBorderCell(cells, k) {
  const [q, r] = parseKey(k);
  return DIRS.some(([dq, dr]) => !cells[key(q + dq, r + dr)]);
}

export function validPlacements(state) {
  return Object.keys(state.cells).filter((k) => state.cells[k].owner < 0 && isBorderCell(state.cells, k));
}

/** Slides from k in direction d as far as possible. Returns target key or null. */
export function slideFrom(cells, k, d) {
  const [dq, dr] = DIRS[d];
  let [q, r] = parseKey(k);
  let last = null;
  for (;;) {
    const nk = key(q + dq, r + dr);
    const c = cells[nk];
    if (!c || c.owner >= 0) break;
    last = nk;
    q += dq;
    r += dr;
  }
  return last;
}

export function destinationsFrom(cells, k) {
  const out = [];
  for (let d = 0; d < 6; d++) {
    const t = slideFrom(cells, k, d);
    if (t) out.push({ dir: d, to: t });
  }
  return out;
}

export function movableStacks(state, p) {
  return Object.keys(state.cells).filter((k) => {
    const c = state.cells[k];
    return c.owner === p && c.count > 1 && destinationsFrom(state.cells, k).length > 0;
  });
}

export function canMove(state, p) {
  return movableStacks(state, p).length > 0;
}

function pushLog(state, entry) {
  state.log.push(entry);
  if (state.log.length > 60) state.log.splice(0, state.log.length - 60);
}

function advanceTurn(state, fromPlayer) {
  const n = state.order.length;
  const idx = state.order.indexOf(fromPlayer);
  for (let i = 1; i <= n; i++) {
    const q = state.order[(idx + i) % n];
    if (canMove(state, q)) {
      state.turn = q;
      return;
    }
  }
  finishGame(state);
}

function finishGame(state) {
  state.phase = 'over';
  state.turn = -1;
  state.results = computeResults(state);
  const w = state.results.filter((r) => r.rank === 1).map((r) => state.players[r.player].name);
  pushLog(state, { text: w.length > 1 ? `Game over – tie between ${w.join(' & ')}!` : `Game over – ${w[0]} wins!` });
}

/**
 * Applies an action for player p. Mutates state.
 * action: { type: 'place', key } | { type: 'move', from, to, count }
 * Returns { ok: true } or { ok: false, error }.
 */
export function applyAction(state, p, action) {
  if (state.turn !== p) return { ok: false, error: 'Not your turn' };
  if (action.type === 'place') {
    if (state.phase !== 'placement') return { ok: false, error: 'Not placement phase' };
    const c = state.cells[action.key];
    if (!c || c.owner >= 0 || !isBorderCell(state.cells, action.key)) return { ok: false, error: 'Flock must start on an empty edge pasture' };
    c.owner = p;
    c.count = SHEEP_PER_PLAYER;
    state.lastMove = { type: 'place', player: p, to: action.key };
    pushLog(state, { player: p, text: `${state.players[p].name} put the flock on the pasture.` });
    state.placementQueue.shift();
    if (state.placementQueue.length) {
      state.turn = state.placementQueue[0];
    } else {
      state.phase = 'play';
      // The first player in the order starts (if able to move).
      const first = state.order[0];
      if (canMove(state, first)) state.turn = first;
      else advanceTurn(state, first);
    }
    return { ok: true };
  }
  if (action.type === 'move') {
    if (state.phase !== 'play') return { ok: false, error: 'Not play phase' };
    const { from, to } = action;
    const count = Math.floor(Number(action.count));
    const c = state.cells[from];
    if (!c || c.owner !== p) return { ok: false, error: 'Not your stack' };
    if (c.count < 2) return { ok: false, error: 'A single sheep cannot be split' };
    if (!(count >= 1 && count <= c.count - 1)) return { ok: false, error: 'Leave at least one sheep behind' };
    if (!destinationsFrom(state.cells, from).some((d) => d.to === to)) return { ok: false, error: 'Sheep must move in a straight line as far as possible' };
    c.count -= count;
    state.cells[to].owner = p;
    state.cells[to].count = count;
    state.moveNo++;
    state.lastMove = { type: 'move', player: p, from, to, count };
    pushLog(state, { player: p, text: `${state.players[p].name} moved ${count} sheep.` });
    advanceTurn(state, p);
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action' };
}

/** Skips a player who is stuck (used defensively). */
export function ensureTurnValid(state) {
  if (state.phase === 'play' && !canMove(state, state.turn)) advanceTurn(state, state.turn);
}

export function largestGroup(cells, p) {
  const seen = new Set();
  let best = 0;
  for (const k of Object.keys(cells)) {
    if (cells[k].owner !== p || seen.has(k)) continue;
    let size = 0;
    const stack = [k];
    seen.add(k);
    while (stack.length) {
      const cur = stack.pop();
      size++;
      const [q, r] = parseKey(cur);
      for (const [dq, dr] of DIRS) {
        const nk = key(q + dq, r + dr);
        if (cells[nk] && cells[nk].owner === p && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    best = Math.max(best, size);
  }
  return best;
}

export function countFields(cells, p) {
  let n = 0;
  for (const k in cells) if (cells[k].owner === p) n++;
  return n;
}

export function computeResults(state) {
  const res = state.players.map((pl, i) => ({
    player: i,
    fields: countFields(state.cells, i),
    group: largestGroup(state.cells, i),
  }));
  res.sort((a, b) => b.fields - a.fields || b.group - a.group);
  res.forEach((r, i) => {
    const prev = res[i - 1];
    r.rank = prev && prev.fields === r.fields && prev.group === r.group ? prev.rank : i + 1;
  });
  return res;
}

