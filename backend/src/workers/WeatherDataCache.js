const EventEmitter = require('events');
const crypto = require('crypto');

class WeatherDataCache extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxEntries = options.maxEntries || 20;
    this.maxTotalSize = options.maxTotalSize || 8 * 1024 * 1024 * 1024;
    this.ttl = options.ttl || 3600000;
    this.checkInterval = options.checkInterval || 30000;

    this.entries = new Map();
    this.accessOrder = [];
    this.totalSize = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;

    this._startPeriodicCleanup();
  }

  _generateKey(source, resolution, forecastTime) {
    const hash = crypto.createHash('sha256');
    hash.update(`${source}:${resolution}:${forecastTime || 0}`);
    return hash.digest('hex').slice(0, 16);
  }

  set(key, data, meta = {}) {
    const dataSize = this._estimateSize(data);

    if (dataSize > this.maxTotalSize * 0.5) {
      this.emit('warning', {
        message: 'Data too large for cache',
        size: dataSize,
        key
      });
      return false;
    }

    this._makeRoom(dataSize);

    if (this.entries.has(key)) {
      const oldEntry = this.entries.get(key);
      this.totalSize -= oldEntry.size;
      const idx = this.accessOrder.indexOf(key);
      if (idx > -1) this.accessOrder.splice(idx, 1);
    }

    this.entries.set(key, {
      key,
      data,
      meta,
      size: dataSize,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      accessCount: 0
    });

    this.accessOrder.unshift(key);
    this.totalSize += dataSize;

    this.emit('set', { key, size: dataSize, totalSize: this.totalSize });

    return true;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      this.emit('miss', { key });
      return null;
    }

    if (this._isExpired(entry)) {
      this._evict(key);
      this.misses++;
      this.emit('expired', { key });
      return null;
    }

    entry.lastAccess = Date.now();
    entry.accessCount++;

    const idx = this.accessOrder.indexOf(key);
    if (idx > 0) {
      this.accessOrder.splice(idx, 1);
      this.accessOrder.unshift(key);
    }

    this.hits++;
    this.emit('hit', { key, accessCount: entry.accessCount });

    return entry.data;
  }

  has(key) {
    const entry = this.entries.get(key);
    return !!entry && !this._isExpired(entry);
  }

  delete(key) {
    if (this.entries.has(key)) {
      this._evict(key);
      return true;
    }
    return false;
  }

  _isExpired(entry) {
    return Date.now() - entry.createdAt > this.ttl;
  }

  _evict(key) {
    const entry = this.entries.get(key);
    if (entry) {
      this.totalSize -= entry.size;
      this.entries.delete(key);

      const idx = this.accessOrder.indexOf(key);
      if (idx > -1) this.accessOrder.splice(idx, 1);

      this.evictions++;

      if (entry.data && entry.data.releaseMemory) {
        try {
          entry.data.releaseMemory(entry.data);
        } catch (e) {}
      }

      this.emit('evict', {
        key,
        size: entry.size,
        reason: 'evicted'
      });
    }
  }

  _makeRoom(requiredSize) {
    if (this.totalSize + requiredSize <= this.maxTotalSize &&
        this.entries.size < this.maxEntries) {
      return;
    }

    while (
      (this.totalSize + requiredSize > this.maxTotalSize ||
       this.entries.size >= this.maxEntries) &&
      this.accessOrder.length > 0
    ) {
      const victimKey = this.accessOrder.pop();
      this._evict(victimKey);
    }
  }

  _estimateSize(data) {
    if (!data) return 0;

    if (data._memoryBlocks) {
      return data._memoryBlocks.reduce((sum, block) => sum + (block.alignedSize || 0), 0);
    }

    if (data.parameters) {
      let size = 0;
      for (const param of data.parameters) {
        if (param.values && param.values.byteLength) {
          size += param.values.byteLength;
        }
      }
      return size || JSON.stringify(data).length * 2;
    }

    if (typeof data === 'object') {
      try {
        return JSON.stringify(data).length * 2;
      } catch (e) {
        return 1024 * 1024;
      }
    }

    return 0;
  }

  _startPeriodicCleanup() {
    setInterval(() => {
      let expiredCount = 0;
      const now = Date.now();
      const keysToEvict = [];

      for (const [key, entry] of this.entries) {
        if (now - entry.createdAt > this.ttl) {
          keysToEvict.push(key);
          expiredCount++;
        }
      }

      for (const key of keysToEvict) {
        this._evict(key);
      }

      if (expiredCount > 0) {
        this.emit('cleanup', { expired: expiredCount, remaining: this.entries.size });
      }

      if (global.gc && this.totalSize < this.maxTotalSize * 0.3) {
        try {
          global.gc();
        } catch (e) {}
      }
    }, this.checkInterval);
  }

  clear() {
    const keys = Array.from(this.entries.keys());
    for (const key of keys) {
      this._evict(key);
    }
    this.emit('clear');
  }

  getStats() {
    const totalRequests = this.hits + this.misses;
    return {
      entries: this.entries.size,
      maxEntries: this.maxEntries,
      totalSize: this.totalSize,
      totalSizeFormatted: this._formatSize(this.totalSize),
      maxTotalSize: this.maxTotalSize,
      maxTotalSizeFormatted: this._formatSize(this.maxTotalSize),
      usagePercent: ((this.totalSize / this.maxTotalSize) * 100).toFixed(2),
      hits: this.hits,
      misses: this.misses,
      hitRate: totalRequests > 0 ? ((this.hits / totalRequests) * 100).toFixed(2) : '0.00',
      evictions: this.evictions,
      ttlMs: this.ttl
    };
  }

  _formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

module.exports = WeatherDataCache;
