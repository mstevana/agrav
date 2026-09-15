// Test client: talks to a Session over an in-process LoopbackChannel and
// collects decoded messages so tests can await specific ones.
import { LoopbackChannel } from '../../shared/net/channel.js';
import { MSG, PROTOCOL_VERSION, encodeJson, decodeJson, messageType, isJsonType,
         decodeSnapshotHeader, encodeInputs } from '../../shared/net/protocol.js';
import { Session } from '../session.js';

export class TestClient {
  constructor(lobby) {
    const [a, b] = LoopbackChannel.pair();
    this.chan = a;
    this.session = new Session(b, lobby);
    this.inbox = [];
    this.waiters = [];
    this.token = null;
    this.chan.onMessage = (u8) => {
      const type = messageType(u8);
      let msg;
      if (isJsonType(type)) msg = { type, ...decodeJson(u8) };
      else if (type === MSG.SNAPSHOT) msg = { type, ...decodeSnapshotHeader(u8) };
      else msg = { type, raw: u8 };
      if (type === MSG.WELCOME) this.token = msg.token;
      this.inbox.push(msg);
      for (const w of [...this.waiters]) if (w.pred(msg)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(msg); }
    };
  }
  send(type, obj) { this.chan.send(encodeJson(type, obj)); }
  sendRaw(u8) { this.chan.send(u8); }
  async hello(name = 'tester', token) {
    this.send(MSG.HELLO, { v: PROTOCOL_VERSION, name, token });
    return this.waitFor(m => m.type === MSG.WELCOME || m.type === MSG.ERROR);
  }
  sendInput(seq, tick, bits, steer = 0) { this.sendRaw(encodeInputs([{ seq, tick, bits, steer }])); }
  last(type) { for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].type === type) return this.inbox[i]; return null; }
  all(type) { return this.inbox.filter(m => m.type === type); }
  waitFor(pred, timeoutMs = 2000) {
    const hit = this.inbox.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }
  /** wait for a message of `type` that arrives after this call */
  next(type, timeoutMs) { const n = this.inbox.length; return this.waitFor((m) => m.type === type && this.inbox.indexOf(m) >= n, timeoutMs); }
  close() { this.chan.close(); }
}

export const settle = () => new Promise(r => setTimeout(r, 0));
