// Battle Sheeps – bot players.
// Bots work on a compact array representation of the board for speed.
import { DIRS, key, parseKey, validPlacements } from './game.js';

export const BOT_LEVELS = ['easy', 'medium', 'hard'];
export const BOT_NAMES = ['Shaun', 'Dolly', 'Baarbara', 'Woolfgang', 'Lambert', 'Fleecy', 'Ewegene', 'Mutton Jr.'];

function buildGeo(cells) {
  const keys = Object.keys(cells);
  const idx = new Map(keys.map((k, i) => [k, i]));
  const N = keys.length;
  const nb = new Int16Array(N * 6).fill(-1);
  keys.forEach((k, i) => {
    const [q, r] = parseKey(k);
    DIRS.forEach(([dq, dr], d) => {
      const j = idx.get(key(q + dq, r + dr));
      if (j !== undefined) nb[i * 6 + d] = j;
    });
  });
  const owner = new Int8Array(N);
  const count = new Int8Array(N);
  keys.forEach((k, i) => { owner[i] = cells[k].owner; count[i] = cells[k].count; });
  return { keys, idx, N, nb, owner, count };
}

function slide(g, i, d) {
  let j = i;
  for (;;) {
    const n = g.nb[j * 6 + d];
    if (n < 0 || g.owner[n] >= 0) break;
    j = n;
  }
  return j === i ? -1 : j;
}

function candidateCounts(c) {
  const s = new Set([1, 2, Math.floor(c / 2), Math.ceil(c / 2), Math.round(c / 3), Math.round((2 * c) / 3), c - 2, c - 1]);
  return [...s].filter((x) => x >= 1 && x <= c - 1);
}

function genMoves(g, p, allCounts) {
  const moves = [];
  for (let i = 0; i < g.N; i++) {
    if (g.owner[i] !== p || g.count[i] < 2) continue;
    const c = g.count[i];
    const opts = allCounts ? Array.from({ length: c - 1 }, (_, k) => k + 1) : candidateCounts(c);
    for (let d = 0; d < 6; d++) {
      const t = slide(g, i, d);
      if (t < 0) continue;
      for (const k of opts) moves.push([i, t, k]);
    }
  }
  return moves;
}

function canMoveG(g, p) {
  for (let i = 0; i < g.N; i++) {
    if (g.owner[i] !== p || g.count[i] < 2) continue;
    for (let d = 0; d < 6; d++) {
      const n = g.nb[i * 6 + d];
      if (n >= 0 && g.owner[n] < 0) return true;
    }
  }
  return false;
}

const doMove = (g, p, [i, t, k]) => { g.count[i] -= k; g.owner[t] = p; g.count[t] = k; };
const undoMove = (g, [i, t, k]) => { g.count[i] += k; g.owner[t] = -1; g.count[t] = 0; };

/**
 * Heuristic: current fields + an estimate of the fields each player can still
 * claim. Empty pasture is split into connected regions; every stack that
 * touches a region places "demand" (its spare sheep) on it and regions are
 * shared proportionally to demand, capped by their size.
 */
function evaluate(g, nP) {
  const N = g.N;
  const comp = new Int16Array(N).fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < N; i++) {
    if (g.owner[i] >= 0 || comp[i] >= 0) continue;
    const c = sizes.length;
    let size = 0;
    comp[i] = c;
    stack.push(i);
    while (stack.length) {
      const cur = stack.pop();
      size++;
      for (let d = 0; d < 6; d++) {
        const n = g.nb[cur * 6 + d];
        if (n >= 0 && g.owner[n] < 0 && comp[n] < 0) { comp[n] = c; stack.push(n); }
      }
    }
    sizes.push(size);
  }
  const demand = new Float64Array(sizes.length * nP);
  const fields = new Float64Array(nP);
  const adj = [];
  for (let i = 0; i < N; i++) {
    const p = g.owner[i];
    if (p < 0) continue;
    fields[p]++;
    if (g.count[i] < 2) continue;
    adj.length = 0;
    for (let d = 0; d < 6; d++) {
      const n = g.nb[i * 6 + d];
      if (n >= 0 && g.owner[n] < 0 && !adj.includes(comp[n])) adj.push(comp[n]);
    }
    if (!adj.length) continue;
    const share = (g.count[i] - 1) / adj.length;
    for (const c of adj) demand[c * nP + p] += share;
  }
  const score = new Float64Array(nP);
  for (let c = 0; c < sizes.length; c++) {
    let total = 0;
    for (let p = 0; p < nP; p++) total += demand[c * nP + p];
    if (!total) continue;
    for (let p = 0; p < nP; p++) {
      const dm = demand[c * nP + p];
      if (dm > 0) score[p] += Math.min(dm, (sizes[c] * dm) / total);
    }
  }
  for (let p = 0; p < nP; p++) score[p] = fields[p] + 0.85 * score[p];
  return score;
}

function utility(score, p) {
  let best = -Infinity;
  for (let o = 0; o < score.length; o++) if (o !== p && score[o] > best) best = score[o];
  return score[p] - best;
}

function bestGreedy(g, p, nP, allCounts, noise = 0) {
  const moves = genMoves(g, p, allCounts);
  let best = null;
  let bestU = -Infinity;
  for (const m of moves) {
    doMove(g, p, m);
    const u = utility(evaluate(g, nP), p) + (noise ? (Math.random() - 0.5) * noise : 0);
    undoMove(g, m);
    if (u > bestU) { bestU = u; best = m; }
  }
  return best;
}

/** Returns { from, to, count } or null. */
export function chooseMove(state, p, level = 'medium') {
  const g = buildGeo(state.cells);
  const nP = state.players.length;
  const moves = genMoves(g, p, true);
  if (!moves.length) return null;
  let pick;

  if (level === 'easy') {
    pick = Math.random() < 0.4 ? moves[Math.floor(Math.random() * moves.length)] : bestGreedy(g, p, nP, true, 3);
  } else if (level === 'medium') {
    pick = bestGreedy(g, p, nP, true, 0.4);
  } else {
    // Hard: shortlist by greedy evaluation, then simulate every opponent's
    // greedy reply for one full round and pick the most robust move.
    const scored = moves.map((m) => {
      doMove(g, p, m);
      const u = utility(evaluate(g, nP), p);
      undoMove(g, m);
      return { m, u };
    });
    scored.sort((a, b) => b.u - a.u);
    const top = scored.slice(0, 14);
    const order = state.order;
    const myPos = order.indexOf(p);
    let bestU = -Infinity;
    for (const { m, u: u1 } of top) {
      doMove(g, p, m);
      const applied = [];
      for (let s = 1; s < order.length; s++) {
        const q = order[(myPos + s) % order.length];
        if (!canMoveG(g, q)) continue;
        const r = bestGreedy(g, q, nP, false);
        if (r) { doMove(g, q, r); applied.push(r); }
      }
      // After the round, how good is our best follow-up?
      let u2;
      if (canMoveG(g, p)) {
        const f = bestGreedy(g, p, nP, false);
        doMove(g, p, f);
        u2 = utility(evaluate(g, nP), p);
        undoMove(g, f);
      } else {
        u2 = utility(evaluate(g, nP), p);
      }
      for (let a = applied.length - 1; a >= 0; a--) undoMove(g, applied[a]);
      undoMove(g, m);
      const u = u2 + 0.15 * u1;
      if (u > bestU) { bestU = u; pick = m; }
    }
  }
  if (!pick) pick = moves[0];
  return { from: g.keys[pick[0]], to: g.keys[pick[1]], count: pick[2] };
}

/** Returns a cell key for the initial flock placement. */
export function choosePlacement(state, p, level = 'medium') {
  const opts = validPlacements(state);
  if (!opts.length) return null;
  if (level === 'easy') return opts[Math.floor(Math.random() * opts.length)];
  const g = buildGeo(state.cells);
  let best = opts[0];
  let bestS = -Infinity;
  for (const k of opts) {
    const i = g.idx.get(k);
    g.owner[i] = p;
    // Count fields reachable within two slides and the length of open lines.
    const reach1 = new Set();
    let lineLen = 0;
    let open = 0;
    for (let d = 0; d < 6; d++) {
      let j = i;
      let len = 0;
      for (;;) {
        const n = g.nb[j * 6 + d];
        if (n < 0 || g.owner[n] >= 0) break;
        j = n;
        len++;
      }
      if (len) { open++; reach1.add(j); }
      lineLen += len;
    }
    const reach2 = new Set(reach1);
    for (const j of reach1) {
      g.owner[j] = p;
      for (let d = 0; d < 6; d++) { const t = slide(g, j, d); if (t >= 0) reach2.add(t); }
      g.owner[j] = -1;
    }
    g.owner[i] = -1;
    const noise = level === 'hard' ? 0.5 : 2.5;
    const s = open * 3 + lineLen * 0.7 + reach2.size * 1.2 + Math.random() * noise;
    if (s > bestS) { bestS = s; best = k; }
  }
  return best;
}
