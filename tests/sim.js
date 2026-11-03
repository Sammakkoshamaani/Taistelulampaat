// Headless simulation: bots play full games against each other.
// Run with: node tests/sim.js [games]
import { createGame, applyAction, validPlacements } from '../js/game.js';
import { chooseMove, choosePlacement } from '../js/bot.js';
import assert from 'node:assert';

const games = Number(process.argv[2] || 30);
const matchups = [
  ['easy', 'medium'],
  ['medium', 'hard'],
  ['easy', 'hard'],
  ['easy', 'medium', 'hard'],
  ['hard', 'hard', 'medium', 'easy'],
];

for (const levels of matchups) {
  const wins = levels.map(() => 0);
  let totalMs = 0;
  let botCalls = 0;
  for (let gi = 0; gi < games; gi++) {
    // Rotate seats so no level gets a seat advantage.
    const seatLevels = levels.map((_, i) => levels[(i + gi) % levels.length]);
    const players = seatLevels.map((l, i) => ({ name: `${l}${i}`, seat: i, color: i, kind: 'bot', botLevel: l }));
    const s = createGame({ players, seed: 1000 + gi });
    assert.equal(Object.keys(s.cells).length, players.length * 16);
    let guard = 0;
    while (s.phase !== 'over') {
      assert(guard++ < 500, 'game too long');
      const p = s.turn;
      const lvl = seatLevels[p];
      const t0 = performance.now();
      let res;
      if (s.phase === 'placement') {
        const k = choosePlacement(s, p, lvl);
        assert(validPlacements(s).includes(k));
        res = applyAction(s, p, { type: 'place', key: k });
      } else {
        const m = chooseMove(s, p, lvl);
        assert(m, 'bot has turn but no move');
        res = applyAction(s, p, { type: 'move', ...m });
      }
      totalMs += performance.now() - t0;
      botCalls++;
      assert(res.ok, res.error);
    }
    for (const r of s.results) if (r.rank === 1) wins[levels.indexOf(seatLevels[r.player])] += 1;
    // Sanity: sheep are conserved.
    const sheep = Object.values(s.cells).reduce((a, c) => a + c.count, 0);
    assert.equal(sheep, players.length * 16);
  }
  console.log(`${levels.join(' vs ').padEnd(32)} wins: ${wins.join(' / ')}   avg bot ms: ${(totalMs / botCalls).toFixed(1)}`);
}
console.log('All simulations passed.');

