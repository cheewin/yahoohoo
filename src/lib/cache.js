export class TtlCache {
  constructor(ttlMs, maxEntries = 500) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.pending = new Map();
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    for (const [name, entry] of this.map) {
      if (Date.now() > entry.expiresAt) this.map.delete(name);
    }
    if (!this.map.has(key) && this.map.size >= this.maxEntries) this.map.delete(this.map.keys().next().value);
    this.map.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
    return value;
  }

  async memo(key, loader) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = Promise.resolve().then(loader).then((value) => this.set(key, value));
    this.pending.set(key, promise);
    try { return await promise; }
    finally { this.pending.delete(key); }
  }
}
