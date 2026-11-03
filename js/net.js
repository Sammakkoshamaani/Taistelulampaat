// Battle Sheeps – networking.
// Uses WebRTC (PeerJS) for cross-device online play, combined with
// BroadcastChannel so multiple tabs on the same browser connect instantly
// without depending on external signaling or STUN servers.
/* global Peer */

const PREFIX = 'battlesheeps-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export class HostNet {
  constructor(room, { onReady, onError }) {
    this.room = room;
    this.onReady = onReady;
    this.onError = onError;
    this.conns = new Map(); // clientId -> DataConnection
    this.peer = null;
    this.bc = null;
    this.code = null;
  }

  start(code = randomCode(), attempt = 0) {
    this.code = code;

    // Same-origin tabs channel (instant local multi-tab)
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.bc = new BroadcastChannel(PREFIX + code);
        this.bc.onmessage = (ev) => {
          const msg = ev.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.t === 'hello') {
            const clientId = String(msg.clientId || '').slice(0, 64);
            if (!clientId) return;
            this.room.join(clientId, String(msg.name || '').slice(0, 20));
            // Send current state back immediately
            this.bc.postMessage({ t: 'state', state: this.room.publicState() });
          } else if (msg.t === 'action' && msg.clientId) {
            const res = this.room.handle(msg.clientId, msg.action);
            if (!res.ok) this.bc.postMessage({ t: 'error', clientId: msg.clientId, message: res.error });
          } else if (msg.t === 'bye' && msg.clientId) {
            this.room.leave(msg.clientId);
          }
        };
      } catch (e) {
        console.warn('BroadcastChannel error:', e);
      }
    }

    // WebRTC PeerJS for remote players across the internet
    if (typeof Peer !== 'undefined') {
      try {
        const peer = new Peer(PREFIX + code, {
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' },
            ],
          },
        });
        this.peer = peer;
        peer.on('open', () => this.onReady(code));
        peer.on('connection', (conn) => this.attach(conn));
        peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
        peer.on('error', (err) => {
          if (err.type === 'unavailable-id' && attempt < 5) {
            peer.destroy();
            if (this.bc) this.bc.close();
            this.start(randomCode(), attempt + 1);
          } else {
            // Still signal ready if broadcast channel is working
            if (this.bc) this.onReady(code);
            else this.onError(err);
          }
        });
        return;
      } catch (e) {
        console.warn('PeerJS init failed:', e);
      }
    }

    if (this.bc) this.onReady(code);
    else this.onError(new Error('Networking library failed to initialize'));
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
        conn.send({ t: 'state', state: this.room.publicState() });
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
    conn.on('error', (err) => {
      console.warn('Host conn error:', err);
    });
  }

  broadcast(state) {
    if (this.bc) {
      try { this.bc.postMessage({ t: 'state', state }); } catch {}
    }
    for (const conn of this.conns.values()) {
      if (conn.open) {
        try { conn.send({ t: 'state', state }); } catch {}
      }
    }
  }

  destroy() {
    if (this.bc) {
      this.bc.close();
      this.bc = null;
    }
    for (const c of this.conns.values()) c.close();
    if (this.peer) this.peer.destroy();
  }
}

export class ClientNet {
  constructor({ code, name, clientId, onState, onError, onStatus }) {
    Object.assign(this, { code, name, clientId, onState, onError, onStatus });
    this.peer = null;
    this.conn = null;
    this.bc = null;
    this.isConnected = false;
  }

  connect() {
    this.onStatus('connecting');
    if (this.peer) this.peer.destroy();
    if (this.bc) this.bc.close();

    // 1. Try BroadcastChannel (instant for tabs on the same browser)
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel(PREFIX + this.code);
        this.bc = bc;
        bc.onmessage = (ev) => {
          const msg = ev.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.t === 'state') {
            if (!this.isConnected) {
              this.isConnected = true;
              this.onStatus('connected');
            }
            this.onState(msg.state);
          } else if (msg.t === 'error' && msg.clientId === this.clientId) {
            this.onError(msg.message, false);
          }
        };
        // Ping host via BC
        bc.postMessage({ t: 'hello', clientId: this.clientId, name: this.name });
      } catch (e) {
        console.warn('Client BroadcastChannel error:', e);
      }
    }

    // 2. Try WebRTC PeerJS
    if (typeof Peer !== 'undefined') {
      try {
        const peer = new Peer({
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' },
            ],
          },
        });
        this.peer = peer;
        peer.on('open', () => {
          const conn = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
          this.conn = conn;
          conn.on('open', () => {
            this.isConnected = true;
            this.onStatus('connected');
            conn.send({ t: 'hello', clientId: this.clientId, name: this.name });
          });
          conn.on('data', (msg) => {
            if (msg && msg.t === 'state') {
              this.isConnected = true;
              this.onState(msg.state);
            } else if (msg && msg.t === 'error') {
              this.onError(msg.message, false);
            }
          });
          conn.on('close', () => {
            if (!this.bc) this.onStatus('disconnected');
          });
          conn.on('error', (err) => {
            console.warn('Client conn error:', err);
          });
        });
        peer.on('error', (err) => {
          if (!this.isConnected) {
            if (err.type === 'peer-unavailable') {
              this.onError(`Room ${this.code} not found. Check the code – the host must keep their tab open.`, true);
            } else {
              this.onError(err.message || String(err), true);
            }
          }
        });
      } catch (e) {
        console.warn('PeerJS client error:', e);
      }
    }
  }

  send(action) {
    let sent = false;
    if (this.bc) {
      try {
        this.bc.postMessage({ t: 'action', clientId: this.clientId, action });
        sent = true;
      } catch {}
    }
    if (this.conn && this.conn.open) {
      try {
        this.conn.send({ t: 'action', action });
        sent = true;
      } catch {}
    }
    if (!sent && !this.isConnected) {
      this.onError('Not connected to the host', false);
    }
  }

  destroy() {
    if (this.bc) {
      try { this.bc.postMessage({ t: 'bye', clientId: this.clientId }); } catch {}
      this.bc.close();
      this.bc = null;
    }
    if (this.conn) this.conn.close();
    if (this.peer) this.peer.destroy();
  }
}
