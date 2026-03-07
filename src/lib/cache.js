export class TtlCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
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
    this.map.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
    return value;
  }

  async memo(key, loader) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await loader();
    return this.set(key, value);
  }
}
