const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const WorkerPool = require('./WorkerPool');
const SharedMemoryPool = require('./SharedMemoryPool');

const WORKER_SCRIPT = path.join(__dirname, 'grib2-decoder-worker.js');

class AsyncGRIB2Parser extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      chunkSize: options.chunkSize || 50000,
      maxConcurrentChunks: options.maxConcurrentChunks || 4,
      useSharedMemory: options.useSharedMemory !== false,
      memoryPoolOptions: options.memoryPoolOptions || {},
      workerPoolOptions: options.workerPoolOptions || {},
      streamChunkSize: options.streamChunkSize || 16 * 1024 * 1024,
      ...options
    };

    this.workerPool = new WorkerPool({
      workerScript: WORKER_SCRIPT,
      ...this.options.workerPoolOptions
    });

    this.memoryPool = new SharedMemoryPool({
      useShared: this.options.useSharedMemory,
      ...this.options.memoryPoolOptions
    });

    this.activeParses = new Map();
    this.parseCounter = 0;

    this._setupPoolListeners();
  }

  _setupPoolListeners() {
    this.workerPool.on('worker_ready', (id) => {
      this.emit('worker_ready', id);
    });

    this.workerPool.on('memory_stats', ({ workerId, stats }) => {
      this.emit('worker_memory', { workerId, stats });
    });
  }

  async parseFile(filePath, options = {}) {
    const parseId = ++this.parseCounter;
    const ctx = {
      id: parseId,
      filePath,
      sections: null,
      results: new Map(),
      numMessages: 0,
      startTime: Date.now(),
      options
    };

    this.activeParses.set(parseId, ctx);
    this.emit('parse_start', { parseId, filePath });

    try {
      const fileBuffer = await this._readFileStream(filePath, (progress) => {
        this.emit('parse_progress', {
          parseId,
          stage: 'reading_file',
          ...progress
        });
      });

      ctx.fileSize = fileBuffer.length;
      ctx.fileBufferBlock = this.memoryPool.allocate(fileBuffer.length, {
        useShared: false,
        type: 'grib2_file'
      });

      const fileView = this.memoryPool.createUint8View(ctx.fileBufferBlock);
      fileView.set(new Uint8Array(fileBuffer));

      const sectionsResult = await this.workerPool.execute('decode_chunk', {
        mode: 'parse_sections',
        buffer: fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.length),
        offset: 0,
        length: fileBuffer.length
      }, {
        onProgress: (progress) => {
          this.emit('parse_progress', {
            parseId,
            stage: 'parsing_sections',
            ...progress
          });
        }
      });

      ctx.sections = sectionsResult.sections;
      ctx.numMessages = this._countGRIB2Messages(ctx.sections);

      this.emit('parse_sections_complete', {
        parseId,
        sections: ctx.sections.length,
        messages: ctx.numMessages
      });

      const weatherData = await this._extractMessages(ctx);

      this._cleanupParse(ctx);

      this.emit('parse_complete', {
        parseId,
        duration: Date.now() - ctx.startTime,
        numMessages: ctx.numMessages,
        parameters: weatherData.parameters
      });

      return weatherData;

    } catch (error) {
      this._cleanupParse(ctx);
      this.emit('parse_error', { parseId, error });
      throw error;
    }
  }

  async _readFileStream(filePath, onProgress) {
    return new Promise((resolve, reject) => {
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      const chunks = [];
      let totalRead = 0;

      const stream = fs.createReadStream(filePath, {
        highWaterMark: this.options.streamChunkSize
      });

      stream.on('data', (chunk) => {
        chunks.push(chunk);
        totalRead += chunk.length;

        if (onProgress) {
          onProgress({
            read: totalRead,
            total: fileSize,
            percent: Math.floor((totalRead / fileSize) * 100)
          });
        }
      });

      stream.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      stream.on('error', reject);
    });
  }

  _countGRIB2Messages(sections) {
    const gridSectionCount = sections.filter(s => s.number === 3).length;
    const productSectionCount = sections.filter(s => s.number === 4).length;
    return Math.max(gridSectionCount, productSectionCount);
  }

  async _extractMessages(ctx) {
    const { sections, fileBufferBlock, options } = ctx;
    const weatherData = {
      parameters: [],
      _memoryBlocks: []
    };

    const gridSections = [];
    const productSections = [];
    const dataRepSections = [];
    const dataSections = [];

    for (const section of sections) {
      switch (section.number) {
        case 3: gridSections.push(section); break;
        case 4: productSections.push(section); break;
        case 5: dataRepSections.push(section); break;
        case 7: dataSections.push(section); break;
      }
    }

    const numMessages = Math.min(
      gridSections.length,
      productSections.length,
      dataRepSections.length,
      dataSections.length
    );

    this.emit('parse_extract_start', {
      parseId: ctx.id,
      numMessages
    });

    const decoderTasks = [];
    const chunkSize = this.options.chunkSize;

    for (let msgIdx = 0; msgIdx < numMessages; msgIdx++) {
      const gridSec = gridSections[msgIdx];
      const productSec = productSections[msgIdx];
      const dataRepSec = dataRepSections[msgIdx];
      const dataSec = dataSections[msgIdx];

      const grid = gridSec.content;
      const productDef = productSec.content;
      const dataRep = dataRepSec.content;
      const numPoints = grid.numberOfDataPoints || dataRep.numberOfDataPoints;

      const paramInfo = await this.workerPool.execute('decode_chunk', {
        mode: 'get_parameter_info',
        params: {
          category: productDef.parameterCategory,
          number: productDef.parameterNumber
        }
      });

      const message = {
        index: msgIdx,
        grid: {
          ni: grid.ni,
          nj: grid.nj,
          latMin: Math.min(grid.la1, grid.la2),
          latMax: Math.max(grid.la1, grid.la2),
          lonMin: Math.min(grid.lo1, grid.lo2),
          lonMax: Math.max(grid.lo1, grid.lo2),
          dLat: grid.dj,
          dLon: grid.di,
          scanningMode: grid.scanningMode
        },
        parameter: paramInfo,
        referenceTime: productDef.forecastTime || 0,
        numPoints
      };

      weatherData.parameters.push({
        ...message,
        shortName: paramInfo.shortName
      });

      const rawDataStart = dataSec.dataOffset || dataSec.offset + 5;
      const rawDataEnd = rawDataStart + (dataSec.dataLength || dataSec.length - 5);

      const fileView = this.memoryPool.createUint8View(fileBufferBlock);
      const rawData = Buffer.from(fileView.slice(rawDataStart, rawDataEnd));

      const numChunks = Math.ceil(numPoints / chunkSize);
      const resultBlock = this.memoryPool.allocate(numPoints * 4, {
        useShared: this.options.useSharedMemory,
        type: 'grib2_values'
      });
      weatherData._memoryBlocks.push(resultBlock);
      this.memoryPool.pinBlock(resultBlock.id);

      this.emit('message_decode_start', {
        parseId: ctx.id,
        messageIndex: msgIdx,
        parameter: paramInfo.shortName,
        numPoints,
        numChunks
      });

      for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
        const startIndex = chunkIdx * chunkSize;
        const endIndex = Math.min(startIndex + chunkSize, numPoints);

        decoderTasks.push({
          parseId: ctx.id,
          messageIndex: msgIdx,
          chunkIndex: chunkIdx,
          startIndex,
          endIndex,
          numPoints,
          resultBlockId: resultBlock.id,
          task: () => this.workerPool.execute('decode_chunk', {
            mode: 'decode_data_values',
            buffer: rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.length),
            params: {
              referenceValue: dataRep.referenceValue,
              binaryScale: dataRep.binaryScaleFactor,
              decimalScale: dataRep.decimalScaleFactor,
              bitsPerValue: dataRep.bitsPerValue,
              startIndex,
              endIndex,
              totalPoints: numPoints
            }
          }, {
            onProgress: (progress) => {
              this.emit('chunk_decode_progress', {
                parseId: ctx.id,
                messageIndex: msgIdx,
                chunkIndex,
                ...progress
              });
            }
          })
        });
      }
    }

    const concurrency = this.options.maxConcurrentChunks;
    for (let i = 0; i < decoderTasks.length; i += concurrency) {
      const batch = decoderTasks.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map(t => t.task()));

      for (let j = 0; j < batch.length; j++) {
        const task = batch[j];
        const chunkResult = batchResults[j];
        const resultBlock = this.memoryPool.allocatedBlocks.get(task.resultBlockId);

        if (resultBlock) {
          const destView = new Float32Array(
            resultBlock.buffer,
            task.startIndex * 4,
            task.endIndex - task.startIndex
          );
          const srcView = new Float32Array(chunkResult.values);
          destView.set(srcView);
        }
      }

      this.emit('batch_complete', {
        parseId: ctx.id,
        completed: Math.min(i + concurrency, decoderTasks.length),
        total: decoderTasks.length,
        percent: Math.floor(Math.min(i + concurrency, decoderTasks.length) / decoderTasks.length * 100)
      });
    }

    for (let msgIdx = 0; msgIdx < weatherData.parameters.length; msgIdx++) {
      const param = weatherData.parameters[msgIdx];
      const memoryBlock = weatherData._memoryBlocks[msgIdx];
      param.valuesBlockId = memoryBlock.id;
      param.values = new Float32Array(
        memoryBlock.buffer,
        0,
        param.numPoints
      );
    }

    return weatherData;
  }

  _cleanupParse(ctx) {
    if (ctx.fileBufferBlock) {
      this.memoryPool.unpinBlock(ctx.fileBufferBlock.id);
      this.memoryPool.release(ctx.fileBufferBlock.id);
    }
    this.activeParses.delete(ctx.id);
  }

  async parseBuffer(buffer, options = {}) {
    const tempFile = path.join(
      require('os').tmpdir(),
      `grib2_temp_${Date.now()}_${Math.random().toString(36).slice(2)}.grib2`
    );

    try {
      fs.writeFileSync(tempFile, buffer);
      return await this.parseFile(tempFile, options);
    } finally {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  }

  releaseWeatherData(weatherData) {
    if (weatherData && weatherData._memoryBlocks) {
      for (const block of weatherData._memoryBlocks) {
        this.memoryPool.unpinBlock(block.id);
        this.memoryPool.release(block.id);
      }
      weatherData._memoryBlocks = [];
      weatherData.parameters = [];
    }
  }

  getStats() {
    return {
      workerPool: this.workerPool.getStats(),
      memoryPool: this.memoryPool.getStats(),
      activeParses: this.activeParses.size,
      totalParses: this.parseCounter
    };
  }

  async shutdown() {
    for (const [parseId, ctx] of this.activeParses) {
      this._cleanupParse(ctx);
    }
    await this.workerPool.shutdown();
    this.memoryPool.destroy();
  }
}

module.exports = AsyncGRIB2Parser;
