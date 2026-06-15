const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

class WorkerPool extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxWorkers = options.maxWorkers || Math.max(2, Math.min(os.cpus().length - 1, 8));
    this.maxQueueSize = options.maxQueueSize || 100;
    this.taskTimeout = options.taskTimeout || 120000;
    this.workerScript = options.workerScript;

    this.workers = [];
    this.availableWorkers = [];
    this.taskQueue = [];
    this.activeTasks = new Map();
    this.taskIdCounter = 0;

    this._initializeWorkers();
    this._startHealthCheck();
  }

  _initializeWorkers() {
    for (let i = 0; i < this.maxWorkers; i++) {
      this._createWorker(i);
    }
    console.log(`[WorkerPool] Initialized ${this.maxWorkers} worker threads`);
  }

  _createWorker(workerId) {
    const worker = new Worker(this.workerScript, {
      workerData: {
        workerId,
        totalWorkers: this.maxWorkers
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 2048,
        maxYoungGenerationSizeMb: 512
      }
    });

    worker.workerId = workerId;
    worker.currentTask = null;
    worker.lastActivity = Date.now();

    worker.on('message', (message) => this._handleWorkerMessage(worker, message));
    worker.on('error', (error) => this._handleWorkerError(worker, error));
    worker.on('exit', (code) => this._handleWorkerExit(worker, code));

    this.workers.push(worker);
    this.availableWorkers.push(worker);

    return worker;
  }

  _handleWorkerMessage(worker, message) {
    worker.lastActivity = Date.now();

    switch (message.type) {
      case 'task_complete':
        this._onTaskComplete(worker, message);
        break;
      case 'task_error':
        this._onTaskError(worker, message);
        break;
      case 'task_progress':
        this._onTaskProgress(message);
        break;
      case 'ready':
        worker.isReady = true;
        this.emit('worker_ready', worker.workerId);
        break;
      case 'memory_stats':
        this.emit('memory_stats', {
          workerId: worker.workerId,
          stats: message.stats
        });
        break;
      default:
        console.warn(`[WorkerPool] Unknown message type: ${message.type}`);
    }
  }

  _handleWorkerError(worker, error) {
    console.error(`[WorkerPool] Worker ${worker.workerId} error:`, error);

    if (worker.currentTask) {
      const task = this.activeTasks.get(worker.currentTask.taskId);
      if (task && !task.resolved) {
        task.reject(error);
        task.resolved = true;
      }
      this.activeTasks.delete(worker.currentTask.taskId);
    }

    worker.currentTask = null;
  }

  _handleWorkerExit(worker, code) {
    if (this.isShuttingDown) return;

    if (code !== 0) {
      console.error(`[WorkerPool] Worker ${worker.workerId} exited with code ${code}`);
    }

    const index = this.workers.indexOf(worker);
    if (index > -1) this.workers.splice(index, 1);

    const availIndex = this.availableWorkers.indexOf(worker);
    if (availIndex > -1) this.availableWorkers.splice(availIndex, 1);

    if (worker.currentTask) {
      const task = this.activeTasks.get(worker.currentTask.taskId);
      if (task && !task.resolved) {
        task.reject(new Error(`Worker exited with code ${code}`));
        task.resolved = true;
      }
      this.activeTasks.delete(worker.currentTask.taskId);
    }

    if (this.workers.length < this.maxWorkers && code !== 0) {
      console.log(`[WorkerPool] Respawning worker ${worker.workerId}`);
      this._createWorker(worker.workerId);
    }
  }

  _onTaskComplete(worker, message) {
    const task = this.activeTasks.get(message.taskId);
    if (!task) {
      console.warn(`[WorkerPool] Task ${message.taskId} not found`);
      this._releaseWorker(worker);
      return;
    }

    if (!task.resolved) {
      task.resolve(message.result);
      task.resolved = true;
    }

    this.activeTasks.delete(message.taskId);
    this._releaseWorker(worker);
    this._processQueue();
  }

  _onTaskError(worker, message) {
    const task = this.activeTasks.get(message.taskId);
    if (!task) {
      this._releaseWorker(worker);
      return;
    }

    if (!task.resolved) {
      const error = new Error(message.error || 'Unknown error');
      error.stack = message.stack;
      task.reject(error);
      task.resolved = true;
    }

    this.activeTasks.delete(message.taskId);
    this._releaseWorker(worker);
    this._processQueue();
  }

  _onTaskProgress(message) {
    const task = this.activeTasks.get(message.taskId);
    if (task && task.onProgress) {
      task.onProgress(message.progress);
    }
    this.emit('task_progress', {
      taskId: message.taskId,
      progress: message.progress
    });
  }

  _releaseWorker(worker) {
    worker.currentTask = null;
    if (!this.availableWorkers.includes(worker)) {
      this.availableWorkers.push(worker);
    }
  }

  _processQueue() {
    if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) return;

    while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
      const pendingTask = this.taskQueue.shift();
      const worker = this.availableWorkers.shift();
      this._executeTask(worker, pendingTask);
    }
  }

  _executeTask(worker, task) {
    worker.currentTask = { taskId: task.taskId };
    worker.lastActivity = Date.now();

    this.activeTasks.set(task.taskId, task);

    task.timeoutHandle = setTimeout(() => {
      if (!task.resolved) {
        task.reject(new Error(`Task timeout after ${this.taskTimeout}ms`));
        task.resolved = true;
        this.activeTasks.delete(task.taskId);
        worker.currentTask = null;
        if (!this.availableWorkers.includes(worker)) {
          this.availableWorkers.push(worker);
        }
        console.error(`[WorkerPool] Task ${task.taskId} timeout`);
      }
    }, this.taskTimeout);

    worker.postMessage({
      type: 'execute_task',
      taskId: task.taskId,
      taskType: task.taskType,
      payload: task.payload
    }, task.transferList || []);
  }

  execute(taskType, payload, options = {}) {
    return new Promise((resolve, reject) => {
      if (this.taskQueue.length >= this.maxQueueSize) {
        reject(new Error(`Task queue overflow (max ${this.maxQueueSize})`));
        return;
      }

      const taskId = ++this.taskIdCounter;
      const task = {
        taskId,
        taskType,
        payload,
        resolve,
        reject,
        onProgress: options.onProgress,
        transferList: options.transferList,
        resolved: false,
        createdAt: Date.now()
      };

      if (this.availableWorkers.length > 0) {
        const worker = this.availableWorkers.shift();
        this._executeTask(worker, task);
      } else {
        this.taskQueue.push(task);
        this.emit('queue_task_added', { taskId, queueSize: this.taskQueue.length });
      }
    });
  }

  _startHealthCheck() {
    setInterval(() => {
      const now = Date.now();
      for (const worker of this.workers) {
        const inactiveTime = now - worker.lastActivity;
        if (worker.currentTask && inactiveTime > this.taskTimeout * 2) {
          console.warn(`[WorkerPool] Worker ${worker.workerId} unresponsive for ${inactiveTime}ms, terminating`);
          worker.terminate();
        }
      }

      if (global.gc && this.activeTasks.size === 0) {
        global.gc();
      }
    }, 30000);
  }

  getStats() {
    return {
      totalWorkers: this.workers.length,
      availableWorkers: this.availableWorkers.length,
      activeTasks: this.activeTasks.size,
      queuedTasks: this.taskQueue.length,
      completedTasks: this.taskIdCounter - this.activeTasks.size - this.taskQueue.length
    };
  }

  async shutdown() {
    console.log('[WorkerPool] Shutting down...');
    this.isShuttingDown = true;
    this.removeAllListeners();

    for (const worker of this.workers) {
      try {
        worker.removeAllListeners();
        await worker.terminate();
      } catch (e) {
        console.error(`[WorkerPool] Error terminating worker:`, e);
      }
    }

    this.workers = [];
    this.availableWorkers = [];
    this.taskQueue = [];
    this.activeTasks.clear();
    this.isShuttingDown = false;
  }
}

module.exports = WorkerPool;
