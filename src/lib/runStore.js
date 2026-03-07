import { randomUUID } from 'node:crypto';

export class RunStore {
  constructor(maxRuns = 100) {
    this.maxRuns = maxRuns;
    this.runs = new Map();
    this.order = []; // insertion order for eviction
  }

  save(analysis) {
    const id = randomUUID().slice(0, 12);
    const entry = {
      id,
      createdAt: new Date().toISOString(),
      query: analysis.question || analysis.query || '',
      symbols: analysis.symbols || [],
      analysis,
    };

    // Evict oldest if at capacity
    while (this.runs.size >= this.maxRuns && this.order.length) {
      const oldest = this.order.shift();
      this.runs.delete(oldest);
    }

    this.runs.set(id, entry);
    this.order.push(id);
    return id;
  }

  get(id) {
    return this.runs.get(id) || null;
  }

  list() {
    return [...this.runs.values()].map(({ id, createdAt, query, symbols }) => ({
      id,
      createdAt,
      query,
      symbols,
    }));
  }

  get size() {
    return this.runs.size;
  }
}
