const EventEmitter = require('events');

class SharedMemoryPool extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxPoolSize = options.maxPoolSize || 4 * 1024 * 1024 * 1024;
    this.minBlockSize = options.minBlockSize || 64 * 1024;
    this.defaultBlockSize = options.defaultBlockSize || 2 * 1024 * 1024;
    this.gcInterval = options.gcInterval || 60000;
    this.idleTimeout = options.idleTimeout || 300000;

    this.allocatedBlocks = new Map();
    this.freeBlocks = [];
    this.totalAllocated = 0;
    this.blockIdCounter = 0;

    this._startGarbageCollector();
  }

  allocate(size, options = {}) {
    const requiredSize = Math.max(size, this.minBlockSize);
    const alignedSize = this._alignToPageSize(requiredSize);

    if (this.totalAllocated + alignedSize > this.maxPoolSize) {
      this._tryRecycle(alignedSize);
    }

    const block = this._findFreeBlock(alignedSize);
    if (block) {
      return this._reuseBlock(block, size);
    }

    if (this.totalAllocated + alignedSize > this.maxPoolSize) {
      throw new Error(`SharedMemoryPool: Out of memory. Allocated: ${this._formatSize(this.totalAllocated)}, Requested: ${this._formatSize(alignedSize)}, Max: ${this._formatSize(this.maxPoolSize)}`);
    }

    return this._createBlock(alignedSize, size, options);
  }

  _alignToPageSize(size) {
    const pageSize = 4096;
    return Math.ceil(size / pageSize) * pageSize;
  }

  _findFreeBlock(size) {
    for (let i = this.freeBlocks.length - 1; i >= 0; i--) {
      const block = this.freeBlocks[i];
      if (block.alignedSize >= size) {
        this.freeBlocks.splice(i, 1);
        return block;
      }
    }
    return null;
  }

  _createBlock(alignedSize, requestedSize, options) {
    const blockId = ++this.blockIdCounter;
    let buffer;

    try {
      buffer = options.useShared ? new SharedArrayBuffer(alignedSize) : new ArrayBuffer(alignedSize);
    } catch (error) {
      throw new Error(`Failed to allocate memory: ${error.message}`);
    }

    const block = {
      id: blockId,
      buffer,
      alignedSize,
      requestedSize,
      useShared: options.useShared || false,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      refCount: 0,
      type: options.type || 'generic',
      isFree: false
    };

    this.allocatedBlocks.set(blockId, block);
    this.totalAllocated += alignedSize;

    this.emit('allocated', {
      blockId,
      size: alignedSize,
      totalAllocated: this.totalAllocated
    });

    return block;
  }

  _reuseBlock(block, requestedSize) {
    block.requestedSize = requestedSize;
    block.lastAccess = Date.now();
    block.isFree = false;
    block.refCount = 0;
    return block;
  }

  retain(blockId) {
    const block = this.allocatedBlocks.get(blockId);
    if (block) {
      block.refCount++;
      block.lastAccess = Date.now();
    }
  }

  release(blockId) {
    const block = this.allocatedBlocks.get(blockId);
    if (!block) return;

    block.refCount = Math.max(0, block.refCount - 1);
    block.lastAccess = Date.now();

    if (block.refCount === 0 && !block.isPinned) {
      this._markFree(block);
    }
  }

  _markFree(block) {
    block.isFree = true;
    this.freeBlocks.push(block);
    this.emit('released', {
      blockId: block.id,
      freedSize: block.alignedSize,
      freeCount: this.freeBlocks.length
    });
  }

  _tryRecycle(requiredSize) {
    let reclaimed = 0;
    const now = Date.now();

    this.freeBlocks.sort((a, b) => a.alignedSize - b.alignedSize);

    while (this.freeBlocks.length > 0 && reclaimed < requiredSize) {
      const block = this.freeBlocks.pop();
      reclaimed += block.alignedSize;
      this.totalAllocated -= block.alignedSize;
      this.allocatedBlocks.delete(block.id);
    }

    if (reclaimed < requiredSize) {
      for (const [blockId, block] of this.allocatedBlocks) {
        if (!block.isPinned && block.refCount === 0 && !block.isFree) {
          const idleTime = now - block.lastAccess;
          if (idleTime > this.idleTimeout) {
            this.freeBlocks = this.freeBlocks.filter(b => b.id !== blockId);
            this.totalAllocated -= block.alignedSize;
            this.allocatedBlocks.delete(blockId);
            reclaimed += block.alignedSize;
            if (reclaimed >= requiredSize) break;
          }
        }
      }
    }

    if (reclaimed > 0) {
      console.log(`[SharedMemoryPool] Reclaimed ${this._formatSize(reclaimed)}`);
      this.emit('reclaimed', reclaimed);
    }
  }

  _startGarbageCollector() {
    setInterval(() => {
      this._compact();
    }, this.gcInterval);
  }

  _compact() {
    if (this.freeBlocks.length < 10) return;

    const beforeSize = this.totalAllocated;
    const freeIds = this.freeBlocks.map(b => b.id);

    for (const blockId of freeIds) {
      const block = this.allocatedBlocks.get(blockId);
      if (block && block.isFree) {
        const idx = this.freeBlocks.findIndex(b => b.id === blockId);
        if (idx > -1) this.freeBlocks.splice(idx, 1);
        this.totalAllocated -= block.alignedSize;
        this.allocatedBlocks.delete(blockId);
      }
    }

    const afterSize = this.totalAllocated;
    if (beforeSize !== afterSize) {
      console.log(`[SharedMemoryPool] Compacted: ${this._formatSize(beforeSize - afterSize)} freed. Total: ${this._formatSize(afterSize)}`);
    }
  }

  createFloat32View(block, offset = 0, length = 0) {
    const byteOffset = offset * 4;
    const viewLength = length || Math.floor((block.requestedSize - byteOffset) / 4);
    const buffer = block.buffer;

    if (block.useShared) {
      return new Float32Array(buffer, byteOffset, viewLength);
    }
    return new Float32Array(buffer.slice(byteOffset, byteOffset + viewLength * 4));
  }

  createUint8View(block, offset = 0, length = 0) {
    const viewLength = length || (block.requestedSize - offset);
    const buffer = block.buffer;

    if (block.useShared) {
      return new Uint8Array(buffer, offset, viewLength);
    }
    return new Uint8Array(buffer.slice(offset, offset + viewLength));
  }

  getStats() {
    return {
      totalAllocated: this.totalAllocated,
      totalAllocatedFormatted: this._formatSize(this.totalAllocated),
      freeBlocks: this.freeBlocks.length,
      allocatedBlocks: this.allocatedBlocks.size,
      activeBlocks: Array.from(this.allocatedBlocks.values()).filter(b => !b.isFree).length,
      pinnedBlocks: Array.from(this.allocatedBlocks.values()).filter(b => b.isPinned).length,
      maxPoolSize: this.maxPoolSize,
      maxPoolSizeFormatted: this._formatSize(this.maxPoolSize),
      usagePercent: ((this.totalAllocated / this.maxPoolSize) * 100).toFixed(2)
    };
  }

  _formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  pinBlock(blockId) {
    const block = this.allocatedBlocks.get(blockId);
    if (block) block.isPinned = true;
  }

  unpinBlock(blockId) {
    const block = this.allocatedBlocks.get(blockId);
    if (block) {
      block.isPinned = false;
      if (block.refCount === 0) this._markFree(block);
    }
  }

  destroy() {
    console.log('[SharedMemoryPool] Destroying pool...');
    this.removeAllListeners();
    this.allocatedBlocks.clear();
    this.freeBlocks = [];
    this.totalAllocated = 0;
  }
}

module.exports = SharedMemoryPool;
