// ============================================================================
// Fixed-capacity ring buffer keyed by an increasing integer (a tick or a
// sequence number). Used for the server's lag-compensation pose history and
// the client's pending-input list.
// ============================================================================

export class RingBuffer {
  constructor(capacity) {
    this.cap = capacity;
    this.keys = new Array(capacity).fill(-1);
    this.vals = new Array(capacity).fill(undefined);
  }
  set(key, val) {
    const i = key % this.cap;
    this.keys[i] = key;
    this.vals[i] = val;
  }
  get(key) {
    const i = key % this.cap;
    return this.keys[i] === key ? this.vals[i] : undefined;
  }
  has(key) { return this.keys[key % this.cap] === key; }
  /** entry with the largest key <= key, searching back at most `back` steps */
  latestAtOrBefore(key, back = this.cap) {
    for (let k = key; k > key - back && k >= 0; k--) {
      const v = this.get(k);
      if (v !== undefined) return { key: k, val: v };
    }
    return undefined;
  }
}
