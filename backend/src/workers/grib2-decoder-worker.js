const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');

const { workerId } = workerData;

class ChunkedGRIB2Decoder {
  constructor() {
    this.sections = [];
    this.chunkSize = 0;
    this.isRunning = false;
  }

  async decodeChunk(data) {
    const { buffer, offset, length, mode, params } = data;
    const buf = buffer ? Buffer.from(buffer) : null;

    switch (mode) {
      case 'parse_sections':
        return this._parseAllSections(buf);

      case 'decode_header':
        return this._decodeHeader(buf, offset, length);

      case 'decode_data_values':
        return this._decodeDataValuesChunked(
          buf,
          params.referenceValue,
          params.binaryScale,
          params.decimalScale,
          params.bitsPerValue,
          params.startIndex,
          params.endIndex,
          params.totalPoints
        );

      case 'get_parameter_info':
        return this._getParameterInfo(params.category, params.number);

      default:
        throw new Error(`Unknown decode mode: ${mode}`);
    }
  }

  async _yield() {
    return new Promise(resolve => setImmediate(resolve));
  }

  async _parseAllSections(buf) {
    if (!buf) return { sections: [] };
    const sections = [];
    let offset = 0;
    const totalLen = buf.length;
    let lastProgress = -1;

    while (offset < totalLen) {
      if (offset % (100 * 1024 * 1024) === 0) {
        await this._yield();
        const progress = Math.floor((offset / totalLen) * 100);
        if (progress !== lastProgress) {
          parentPort.postMessage({
            type: 'task_progress',
            progress: { percent: progress, stage: 'parsing_sections', offset, total: totalLen }
          });
          lastProgress = progress;
        }
      }

      if (offset + 4 > totalLen) break;

      const sectionLength = buf.readUInt32BE(offset);
      if (sectionLength === 0 || offset + sectionLength > totalLen) break;

      const sectionNumber = buf.readUInt8(offset + 4);
      const section = {
        length: sectionLength,
        number: sectionNumber,
        offset
      };

      switch (sectionNumber) {
        case 0:
          section.content = this._parseSection0(buf, offset);
          break;
        case 1:
          section.content = this._parseSection1(buf, offset);
          break;
        case 3:
          section.content = this._parseSection3(buf, offset);
          break;
        case 4:
          section.content = this._parseSection4(buf, offset);
          break;
        case 5:
          section.content = this._parseSection5(buf, offset);
          break;
        case 6:
          section.content = this._parseSection6(buf, offset, sectionLength);
          break;
        case 7:
          section.dataOffset = offset + 5;
          section.dataLength = sectionLength - 5;
          break;
      }

      sections.push(section);
      offset += sectionLength;
    }

    return {
      sections: sections.map(s => ({
        length: s.length,
        number: s.number,
        offset: s.offset,
        content: s.content,
        dataOffset: s.dataOffset,
        dataLength: s.dataLength
      }))
    };
  }

  _parseSection0(buf, offset) {
    return {
      discipline: buf.readUInt8(offset + 5),
      editionNumber: buf.readUInt8(offset + 6),
      totalLength: Number(buf.readBigUInt64BE ? buf.readBigUInt64BE(offset + 8) : buf.readUInt32BE(offset + 8))
    };
  }

  _parseSection1(buf, offset) {
    return {
      centerId: buf.readUInt16BE(offset + 5),
      subCenterId: buf.readUInt16BE(offset + 7),
      masterTablesVersion: buf.readUInt8(offset + 9),
      localTablesVersion: buf.readUInt8(offset + 10),
      significanceOfRefTime: buf.readUInt8(offset + 11),
      year: buf.readUInt16BE(offset + 12),
      month: buf.readUInt8(offset + 14),
      day: buf.readUInt8(offset + 15),
      hour: buf.readUInt8(offset + 16),
      minute: buf.readUInt8(offset + 17),
      second: buf.readUInt8(offset + 18),
      productionStatus: buf.readUInt8(offset + 19),
      type: buf.readUInt8(offset + 20)
    };
  }

  _parseSection3(buf, offset) {
    const sourceOfGridDefinition = buf.readUInt8(offset + 5);
    const numberOfDataPoints = buf.readUInt32BE(offset + 6);
    const gridDefinitionTemplateNumber = buf.readUInt16BE(offset + 12);

    const gridDef = {
      sourceOfGridDefinition,
      numberOfDataPoints,
      gridDefinitionTemplateNumber
    };

    if (gridDefinitionTemplateNumber === 0) {
      gridDef.ni = buf.readUInt32BE(offset + 30);
      gridDef.nj = buf.readUInt32BE(offset + 34);
      gridDef.la1 = buf.readInt32BE(offset + 46) / 1000000;
      gridDef.lo1 = buf.readInt32BE(offset + 50) / 1000000;
      gridDef.la2 = buf.readInt32BE(offset + 55) / 1000000;
      gridDef.lo2 = buf.readInt32BE(offset + 59) / 1000000;
      gridDef.di = buf.readInt32BE(offset + 63) / 1000000;
      gridDef.dj = buf.readInt32BE(offset + 67) / 1000000;
      gridDef.scanningMode = buf.readUInt8(offset + 71);
    }

    return gridDef;
  }

  _parseSection4(buf, offset) {
    const productDefinitionTemplateNumber = buf.readUInt16BE(offset + 7);
    const productDef = { productDefinitionTemplateNumber };

    if (productDefinitionTemplateNumber === 0 || productDefinitionTemplateNumber === 8) {
      productDef.parameterCategory = buf.readUInt8(offset + 9);
      productDef.parameterNumber = buf.readUInt8(offset + 10);
      productDef.typeOfGeneratingProcess = buf.readUInt8(offset + 11);
      productDef.indicatorOfUnitOfTimeRange = buf.readUInt8(offset + 17);
      productDef.forecastTime = buf.readUInt32BE(offset + 18);
      productDef.typeOfFirstFixedSurface = buf.readUInt8(offset + 22);
      productDef.scaleFactorOfFirstFixedSurface = buf.readUInt8(offset + 23);
      productDef.scaledValueOfFirstFixedSurface = buf.readUInt32BE(offset + 24);
      productDef.typeOfSecondFixedSurface = buf.readUInt8(offset + 28);
      productDef.scaleFactorOfSecondFixedSurface = buf.readUInt8(offset + 29);
      productDef.scaledValueOfSecondFixedSurface = buf.readUInt32BE(offset + 30);
    }

    return productDef;
  }

  _parseSection5(buf, offset) {
    const numberOfDataPoints = buf.readUInt32BE(offset + 5);
    const dataRepresentationTemplateNumber = buf.readUInt16BE(offset + 9);
    const dataRep = { numberOfDataPoints, dataRepresentationTemplateNumber };

    if (dataRepresentationTemplateNumber === 0 || dataRepresentationTemplateNumber === 40) {
      dataRep.referenceValue = buf.readFloatBE(offset + 11);
      dataRep.binaryScaleFactor = buf.readInt16BE(offset + 15);
      dataRep.decimalScaleFactor = buf.readInt16BE(offset + 17);
      dataRep.bitsPerValue = buf.readUInt8(offset + 19);
      dataRep.typeOfOriginalFieldValues = buf.readUInt8(offset + 20);
    }

    return dataRep;
  }

  _parseSection6(buf, offset, sectionLength) {
    return {
      bitmapIndicator: buf.readUInt8(offset + 5)
    };
  }

  async _decodeDataValuesChunked(
    buf,
    referenceValue,
    binaryScale,
    decimalScale,
    bitsPerValue,
    startIndex,
    endIndex,
    totalPoints
  ) {
    const numPoints = endIndex - startIndex;
    const resultArray = new Float32Array(numPoints);
    if (!buf) {
      return { values: resultArray.buffer, startIndex, endIndex, count: numPoints };
    }

    if (bitsPerValue === 0) {
      for (let i = 0; i < numPoints; i++) {
        resultArray[i] = referenceValue;
      }
      return { values: resultArray.buffer, startIndex, endIndex };
    }

    const refValue = referenceValue || 0;
    const scale = Math.pow(2, binaryScale) * Math.pow(10, -decimalScale);

    const startBit = startIndex * bitsPerValue;
    const endBit = endIndex * bitsPerValue;
    const startByte = Math.floor(startBit / 8);
    const endByte = Math.ceil(endBit / 8);

    let bitOffset = startBit;
    const checkPoint = Math.max(1000, Math.floor(numPoints / 100));
    let lastProgress = -1;

    for (let i = 0; i < numPoints; i++) {
      if (i > 0 && i % checkPoint === 0) {
        await this._yield();
        const progress = Math.floor((i / numPoints) * 100);
        if (progress !== lastProgress) {
          parentPort.postMessage({
            type: 'task_progress',
            progress: { percent: progress, stage: 'decoding_values', decoded: i, total: numPoints }
          });
          lastProgress = progress;
        }
      }

      const byteIdx = Math.floor(bitOffset / 8) - startByte;
      const bitIdx = bitOffset % 8;

      let value = 0;
      let bitsRemaining = bitsPerValue;
      let curByte = byteIdx;
      let curBit = bitIdx;

      while (bitsRemaining > 0) {
        if (curByte < 0 || curByte >= buf.length) break;
        const bitsInByte = Math.min(bitsRemaining, 8 - curBit);
        const mask = (1 << bitsInByte) - 1;
        const shift = 8 - curBit - bitsInByte;
        const byteVal = buf[startByte + curByte] || 0;

        value = (value << bitsInByte) | ((byteVal >> shift) & mask);

        bitsRemaining -= bitsInByte;
        curByte++;
        curBit = 0;
      }

      resultArray[i] = refValue + value * scale;
      bitOffset += bitsPerValue;
    }

    return {
      values: resultArray.buffer,
      startIndex,
      endIndex,
      count: numPoints
    };
  }

  _decodeHeader(buf, offset, length) {
    if (!buf) return { header: null };
    return {
      header: {
        bytes: buf.slice(offset, offset + length),
        offset,
        length
      }
    };
  }

  _getParameterInfo(category, number) {
    const params = {
      '0-0': { name: 'Temperature', units: 'K', shortName: 'T' },
      '0-2': { name: 'u-component of wind', units: 'm/s', shortName: 'UGRD' },
      '0-3': { name: 'v-component of wind', units: 'm/s', shortName: 'VGRD' },
      '1-0': { name: 'Wind speed', units: 'm/s', shortName: 'WIND' },
      '1-1': { name: 'Wind direction', units: 'degrees', shortName: 'WDIR' },
      '2-0': { name: 'Geopotential height', units: 'gpm', shortName: 'HGT' },
      '3-0': { name: 'Ocean current u-component', units: 'm/s', shortName: 'UOGRD' },
      '3-1': { name: 'Ocean current v-component', units: 'm/s', shortName: 'VOGRD' },
      '10-0': { name: 'Wave height', units: 'm', shortName: 'WVHGT' },
      '10-1': { name: 'Wave period', units: 's', shortName: 'WVPER' },
      '10-2': { name: 'Wave direction', units: 'degrees', shortName: 'WVDIR' }
    };

    return params[`${category}-${number}`] || {
      name: `Unknown (cat=${category}, num=${number})`,
      units: 'unknown',
      shortName: 'UNKNOWN'
    };
  }

  _reportMemory() {
    const mem = process.memoryUsage();
    parentPort.postMessage({
      type: 'memory_stats',
      stats: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers || 0
      }
    });
  }
}

const decoder = new ChunkedGRIB2Decoder();

parentPort.on('message', async (msg) => {
  if (msg.type !== 'execute_task') return;

  const { taskId, taskType, payload } = msg;

  try {
    if (taskType === 'decode_chunk') {
      const result = await decoder.decodeChunk(payload);
      const transferList = [];
      if (result.values instanceof ArrayBuffer) {
        transferList.push(result.values);
      }
      parentPort.postMessage({
        type: 'task_complete',
        taskId,
        result
      }, transferList);
    } else if (taskType === 'ping') {
      parentPort.postMessage({ type: 'task_complete', taskId, result: { pong: true } });
    } else if (taskType === 'memory_report') {
      decoder._reportMemory();
      parentPort.postMessage({ type: 'task_complete', taskId, result: { ok: true } });
    }
  } catch (error) {
    parentPort.postMessage({
      type: 'task_error',
      taskId,
      error: error.message,
      stack: error.stack
    });
  }
});

parentPort.postMessage({ type: 'ready', workerId });
