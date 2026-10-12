export const NOTIFICATION_TARGET_TTL_MS = 60 * 60 * 1000; // 1 hour
export const MAX_NOTIFICATION_TARGETS = 50;

// Lazy TTL map with oldest-first eviction. Expiry is reclaimed on access;
// entries without a usable timestamp count as expired.
function isExpired(createdAt, now, ttlMs) {
  const ts = Number(createdAt);
  return !Number.isFinite(ts) || now - ts >= ttlMs;
}

export class NotificationTargetManager {
  constructor({
    ttlMs = NOTIFICATION_TARGET_TTL_MS,
    maxCapacity = MAX_NOTIFICATION_TARGETS,
  } = {}) {
    this.targets = new Map();
    this.ttlMs = ttlMs;
    this.maxCapacity = maxCapacity;
  }

  set(id, data, now = Date.now()) {
    this.evictStale(now);
    if (this.targets.has(id)) {
      // Refresh recency so a repeated entry survives eviction.
      this.targets.delete(id);
    } else if (this.targets.size >= this.maxCapacity) {
      const oldestKey = this.targets.keys().next().value;
      if (oldestKey !== undefined) this.targets.delete(oldestKey);
    }
    this.targets.set(id, { ...data, createdAt: now });
  }

  get(id, now = Date.now()) {
    const entry = this.targets.get(id);
    if (!entry) return null;
    if (isExpired(entry.createdAt, now, this.ttlMs)) {
      this.targets.delete(id);
      return null;
    }
    return entry;
  }

  take(id, now = Date.now()) {
    const entry = this.get(id, now);
    if (entry) this.targets.delete(id);
    return entry;
  }

  has(id, now = Date.now()) {
    return this.get(id, now) !== null;
  }

  delete(id) {
    return this.targets.delete(id);
  }

  evictStale(now = Date.now()) {
    for (const [id, entry] of this.targets.entries()) {
      if (isExpired(entry?.createdAt, now, this.ttlMs)) {
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
