# 🐑 Battle Sheeps – online

A fan-made browser version of the tactical board game **Battle Sheep**. You can play online with up to 4 players, against bots, or hot-seat on one device.

**Play:** https://&lt;your-github-username&gt;.github.io/battle-sheeps/

## Features

- **Online multiplayer for 1–4 players.** It's peer-to-peer over WebRTC (PeerJS), so you don't need a server. The host's browser runs the game, and friends join with a 5-letter room code or an invite link.
- **Bots:** easy, medium and hard. Any seat can be a bot, so one human can play against 1–3 bots.
- **Hot-seat:** several people can share the host's device.
- **Random pasture:** each game builds a new board from 4 four-hex tiles per player, in a compact, normal or sprawling layout.
- **Reconnects:** a guest who reloads the page gets their seat back. The host can hand a seat that has gone offline to a bot.
- Works on mobile, has animations, and plays without a build step. It's plain HTML, CSS and JS modules.

## Rules

1. Each player puts their 16-sheep flock on an empty field at the edge of the pasture.
2. On your turn, split one of your stacks. Leave at least 1 sheep behind and move the rest.
3. The moving sheep go in a straight line, in any of the 6 directions, and keep going until they hit the edge or an occupied field.
4. If you can't move, you are skipped. The game ends when nobody can move.
5. The player on the most fields wins. Ties go to whoever has the largest connected group.

## Run locally

```bash
python3 -m http.server 8080   # then open http://localhost:8080
npm test                      # headless bot-vs-bot simulations + room tests
node tests/room.js
```

## How it works

| File | Purpose |
| --- | --- |
| `js/game.js` | Pure rules engine: board generation, moves, scoring |
| `js/bot.js` | Bot AI: region-based evaluation; hard bots look ahead one full round |
| `js/room.js` | Host-side game room that checks every action and runs the bots |
| `js/net.js` | PeerJS host/guest networking |
| `js/main.js` | UI, SVG board rendering, input |

The host has the final say on game state. Guests send actions, the host checks them and sends the new state to everyone. If the host closes their tab, the room closes.

> Battle Sheep is a trademark of Blue Orange Games. This is a fan project for personal and educational use. It is not affiliated with or endorsed by Blue Orange Games.

