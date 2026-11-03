// Tests the host Room: lobby management, permissions, reconnects and a full game
// where an online human (driven by a bot brain) plays against bots.
// Run with: node tests/room.js
import assert from 'node:assert';
import { Room } from '../js/room.js';
import { chooseMove, choosePlacement } from '../js/bot.js';

// Deterministic fake timers.
const queue = [];
globalThis.setTimeout = (fn) => { queue.push(fn); return queue.length; };
globalThis.clearTimeout = () => {};
const drainOne = () => { const fn = queue.shift(); if (fn) fn(); return !!fn; };

let last;
const room = new Room({ hostName: 'Alice', online: true, onState: (s) => { last = s; } });
room.code = 'TEST1';
room.emit();
assert.equal(last.seats[1].type, 'open');

// Guest joins, then a second guest; seats fill in order.
assert.equal(room.join('bob-id', 'Bob'), 1);
assert.equal(room.join('cara-id', 'Cara'), 2);
assert.equal(last.seats[2].name, 'Cara');

// Guests can't use host actions.
assert.equal(room.handle('bob-id', { type: 'start' }).ok, false);
assert.equal(room.handle('bob-id', { type: 'setSeat', seat: 3, seatType: 'bot' }).ok, false);
assert.ok(room.handle('bob-id', { type: 'rename', name: 'Bobby' }).ok);
assert.equal(last.seats[1].name, 'Bobby');

// Cara leaves in lobby -> seat opens again.
room.leave('cara-id');
assert.equal(last.seats[2].type, 'open');

// Host adds a hard bot and a hot-seat player.
assert.ok(room.handle('host', { type: 'setSeat', seat: 2, seatType: 'bot', botLevel: 'hard' }).ok);
assert.ok(room.handle('host', { type: 'setSeat', seat: 3, seatType: 'local', name: 'Dan' }).ok);
assert.ok(room.handle('host', { type: 'start' }).ok);
const g = room.game;
assert.equal(g.players.length, 4);
assert.equal(Object.keys(g.cells).length, 64);

// Late joiner becomes spectator.
assert.equal(room.join('eve-id', 'Eve'), -1);

// Bob disconnects and reconnects -> keeps his seat.
room.leave('bob-id');
assert.equal(last.seats[1].connected, false);
assert.equal(room.join('bob-id', 'Bob'), 1);
assert.equal(last.seats[1].connected, true);

// Play the game: humans are driven by the medium bot brain through room.handle.
const controllerFor = (p) => {
  const seat = room.seats[g.players[p].seat];
  return seat.type === 'human' ? seat.clientId : 'host';
};
let steps = 0;
while (room.game.phase !== 'over') {
  assert(steps++ < 2000, 'game did not finish');
  const p = room.game.turn;
  const pl = room.game.players[p];
  if (pl.kind === 'bot') { assert(drainOne(), 'bot timer missing'); continue; }
  // Wrong controller must be rejected.
  const wrong = controllerFor(p) === 'host' ? 'bob-id' : 'host';
  const action = room.game.phase === 'placement'
    ? { type: 'place', key: choosePlacement(room.game, p, 'medium') }
    : { type: 'move', ...chooseMove(room.game, p, 'medium') };
  assert.equal(room.handle(wrong, action).ok, false, 'wrong controller accepted');
  const res = room.handle(controllerFor(p), action);
  assert(res.ok, res.error);
}
console.log('Results:', room.game.results.map((r) => `${room.game.players[r.player].name}: ${r.fields} fields (rank ${r.rank})`).join(', '));

// Rematch + back to lobby.
assert.ok(room.handle('host', { type: 'rematch' }).ok);
assert.equal(room.game.phase, 'placement');
assert.ok(room.handle('host', { type: 'reroll' }).ok);
assert.ok(room.handle('host', { type: 'toLobby' }).ok);
assert.equal(room.game, null);
console.log('Room tests passed.');

