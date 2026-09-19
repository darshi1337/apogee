const NOTIFICATION_TARGET_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_NOTIFICATION_TARGETS = 50;

export class NotificationTargetManager {
  constructor({
    ttlMs = NOTIFICATION_TARGET_TTL_MS,
    maxCapacity = MAX_NOTIFICATION_TARGETS,
  } = {}) {
    this.targets = new Map();
    this.ttlMs = ttlMs;
    this.maxCapacity = maxCapacity;
  }

  set(id, data) {
    this.evictStale();
    if (!this.targets.has(id) && this.targets.size >= this.maxCapacity) {
      const oldestKey = this.targets.keys().next().value;
      if (oldestKey) this.targets.delete(oldestKey);
    }
    this.targets.set(id, { ...data, createdAt: Date.now() });
  }

  get(id) {
    const entry = this.targets.get(id);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.targets.delete(id);
      return null;
    }
    return entry;
  }

  delete(id) {
    return this.targets.delete(id);
  }

  evictStale() {
    const now = Date.now();
    for (const [id, entry] of this.targets.entries()) {
      if (now - entry.createdAt > this.ttlMs) {
        this.targets.delete(id);
      }
    }
  }

  clear() {
    this.targets.clear();
  }

  get size() {
    this.evictStale();
    return this.targets.size;
  }
}
