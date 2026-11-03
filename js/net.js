// Battle Sheeps – peer-to-peer networking via PeerJS (WebRTC).
// The host's browser is the server; guests connect directly to it.
/* global Peer */

const PREFIX = 'battlesheeps-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function ensurePeerLib() {
  if (typeof Peer === 'undefined') throw new Error('Networking library failed to load. Check your internet connection.');
}

export class HostNet {
  constructor(room, { onReady, onError }) {
    this.room = room;
    this.onReady = onReady;
    this.onError = onError;
    this.conns = new Map(); // clientId -> DataConnection
    this.peer = null;
  }

  start(code = randomCode(), attempt = 0) {
    ensurePeerLib();
    const peer = new Peer(PREFIX + code, { debug: 1 });
    this.peer = peer;
    peer.on('open', () => this.onReady(code));
    peer.on('connection', (conn) => this.attach(conn));
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && attempt < 5) {
        peer.destroy();
        this.start(randomCode(), attempt + 1);
      } else {
        this.onError(err);
      }
    });
  }

  attach(conn) {
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        const clientId = String(msg.clientId || '').slice(0, 64);
        if (!clientId) return;
        const old = this.conns.get(clientId);
        if (old && old !== conn) old.close();
        conn.clientId = clientId;
        this.conns.set(clientId, conn);
        this.room.join(clientId, String(msg.name || '').slice(0, 20));
      } else if (msg.t === 'action' && conn.clientId) {
        const res = this.room.handle(conn.clientId, msg.action);
        if (!res.ok) conn.send({ t: 'error', message: res.error });
      }
    });
    conn.on('close', () => {
      if (conn.clientId && this.conns.get(conn.clientId) === conn) {
        this.conns.delete(conn.clientId);
        this.room.leave(conn.clientId);
      }
    });
  }

  broadcast(state) {
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send({ t: 'state', state });
    }
  }

  destroy() {
    for (const c of this.conns.values()) c.close();
    if (this.peer) this.peer.destroy();
  }
}

export class ClientNet {
  constructor({ code, name, clientId, onState, onError, onStatus }) {
    Object.assign(this, { code, name, clientId, onState, onError, onStatus });
    this.peer = null;
    this.conn = null;
  }

  connect() {
    ensurePeerLib();
    this.onStatus('connecting');
    if (this.peer) this.peer.destroy();
    const peer = new Peer({ debug: 1 });
    this.peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
      this.conn = conn;
      conn.on('open', () => {
        this.onStatus('connected');
        conn.send({ t: 'hello', clientId: this.clientId, name: this.name });
      });
      conn.on('data', (msg) => {
        if (msg && msg.t === 'state') this.onState(msg.state);
        else if (msg && msg.t === 'error') this.onError(msg.message, false);
      });
      conn.on('close', () => this.onStatus('disconnected'));
    });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') this.onError(`Room ${this.code} not found. Check the code – the host must keep their tab open.`, true);
      else this.onError(err.message || String(err), true);
    });
  }

  send(action) {
    if (this.conn && this.conn.open) this.conn.send({ t: 'action', action });
    else this.onError('Not connected to the host', false);
  }

  destroy() {
    if (this.peer) this.peer.destroy();
  }
}
