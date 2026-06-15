const fs = require('fs');
const path = require('path');

class GRIB2Parser {
  constructor() {
    this.sections = [];
    this.data = null;
    this.offset = 0;
  }

  parse(buffer) {
    this.data = buffer;
    this.offset = 0;
    this.sections = [];

    while (this.offset < this.data.length) {
      const section = this.parseSection();
      if (!section) break;
      this.sections.push(section);
    }

    return this.extractWeatherData();
  }

  parseFile(filePath) {
    const buffer = fs.readFileSync(filePath);
    return this.parse(buffer);
  }

  parseSection() {
    if (this.offset + 4 > this.data.length) return null;

    const sectionLength = this.data.readUInt32BE(this.offset);
    if (sectionLength === 0) return null;

    const sectionNumber = this.data.readUInt8(this.offset + 4);

    const section = {
      length: sectionLength,
      number: sectionNumber,
      offset: this.offset,
      content: {}
    };

    switch (sectionNumber) {
      case 0:
        section.content = this.parseSection0();
        break;
      case 1:
        section.content = this.parseSection1();
        break;
      case 2:
        section.content = this.parseSection2();
        break;
      case 3:
        section.content = this.parseSection3();
        break;
      case 4:
        section.content = this.parseSection4();
        break;
      case 5:
        section.content = this.parseSection5();
        break;
      case 6:
        section.content = this.parseSection6();
        break;
      case 7:
        section.content = this.parseSection7(sectionLength);
        break;
      default:
        break;
    }

    this.offset += sectionLength;
    return section;
  }

  parseSection0() {
    return {
      discipline: this.data.readUInt8(this.offset + 5),
      editionNumber: this.data.readUInt8(this.offset + 6),
      totalLength: this.data.readUInt32BE(this.offset + 8)
    };
  }

  parseSection1() {
    return {
      centerId: this.data.readUInt16BE(this.offset + 5),
      subCenterId: this.data.readUInt16BE(this.offset + 7),
      masterTablesVersion: this.data.readUInt8(this.offset + 9),
      localTablesVersion: this.data.readUInt8(this.offset + 10),
      significanceOfRefTime: this.data.readUInt8(this.offset + 11),
      year: this.data.readUInt16BE(this.offset + 12),
      month: this.data.readUInt8(this.offset + 14),
      day: this.data.readUInt8(this.offset + 15),
      hour: this.data.readUInt8(this.offset + 16),
      minute: this.data.readUInt8(this.offset + 17),
      second: this.data.readUInt8(this.offset + 18),
      productionStatus: this.data.readUInt8(this.offset + 19),
      type: this.data.readUInt8(this.offset + 20)
    };
  }

  parseSection2() {
    return {
      localUse: this.data.slice(this.offset + 5, this.offset + this.sections[this.sections.length - 1]?.length || 0)
    };
  }

  parseSection3() {
    const sourceOfGridDefinition = this.data.readUInt8(this.offset + 5);
    const numberOfDataPoints = this.data.readUInt32BE(this.offset + 6);
    const numberOfOctects = this.data.readUInt8(this.offset + 10);
    const interpretationOfList = this.data.readUInt8(this.offset + 11);
    const gridDefinitionTemplateNumber = this.data.readUInt16BE(this.offset + 12);

    const gridDef = {
      sourceOfGridDefinition,
      numberOfDataPoints,
      numberOfOctects,
      interpretationOfList,
      gridDefinitionTemplateNumber
    };

    if (gridDefinitionTemplateNumber === 0) {
      gridDef.earthShape = this.data.readUInt8(this.offset + 14);
      gridDef.scaleFactorOfRadius = this.data.readUInt8(this.offset + 15);
      gridDef.scaledValueOfRadius = this.data.readUInt32BE(this.offset + 16);
      gridDef.scaleFactorOfMajorAxis = this.data.readUInt8(this.offset + 20);
      gridDef.scaledValueOfMajorAxis = this.data.readUInt32BE(this.offset + 21);
      gridDef.scaleFactorOfMinorAxis = this.data.readUInt8(this.offset + 25);
      gridDef.scaledValueOfMinorAxis = this.data.readUInt32BE(this.offset + 26);
      gridDef.ni = this.data.readUInt32BE(this.offset + 30);
      gridDef.nj = this.data.readUInt32BE(this.offset + 34);
      gridDef.basicAngleOfTheInitialProductionDomain = this.data.readUInt32BE(this.offset + 38);
      gridDef.subdivisionsOfBasicAngle = this.data.readUInt32BE(this.offset + 42);
      gridDef.la1 = this.data.readInt32BE(this.offset + 46) / 1000000;
      gridDef.lo1 = this.data.readInt32BE(this.offset + 50) / 1000000;
      gridDef.angleResolutionFlags = this.data.readUInt8(this.offset + 54);
      gridDef.la2 = this.data.readInt32BE(this.offset + 55) / 1000000;
      gridDef.lo2 = this.data.readInt32BE(this.offset + 59) / 1000000;
      gridDef.di = this.data.readInt32BE(this.offset + 63) / 1000000;
      gridDef.dj = this.data.readInt32BE(this.offset + 67) / 1000000;
      gridDef.scanningMode = this.data.readUInt8(this.offset + 71);
    }

    return gridDef;
  }

  parseSection4() {
    const numberOfCoordinates = this.data.readUInt16BE(this.offset + 5);
    const productDefinitionTemplateNumber = this.data.readUInt16BE(this.offset + 7);

    const productDef = {
      numberOfCoordinates,
      productDefinitionTemplateNumber
    };

    if (productDefinitionTemplateNumber === 0 || productDefinitionTemplateNumber === 8) {
      productDef.parameterCategory = this.data.readUInt8(this.offset + 9);
      productDef.parameterNumber = this.data.readUInt8(this.offset + 10);
      productDef.typeOfGeneratingProcess = this.data.readUInt8(this.offset + 11);
      productDef.backgroundProcessId = this.data.readUInt8(this.offset + 12);
      productDef.analysisOrForecastProcessId = this.data.readUInt8(this.offset + 13);
      productDef.hoursOfObservationDataCutoff = this.data.readUInt16BE(this.offset + 14);
      productDef.minutesOfObservationDataCutoff = this.data.readUInt8(this.offset + 16);
      productDef.indicatorOfUnitOfTimeRange = this.data.readUInt8(this.offset + 17);
      productDef.forecastTime = this.data.readUInt32BE(this.offset + 18);
      productDef.typeOfFirstFixedSurface = this.data.readUInt8(this.offset + 22);
      productDef.scaleFactorOfFirstFixedSurface = this.data.readUInt8(this.offset + 23);
      productDef.scaledValueOfFirstFixedSurface = this.data.readUInt32BE(this.offset + 24);
      productDef.typeOfSecondFixedSurface = this.data.readUInt8(this.offset + 28);
      productDef.scaleFactorOfSecondFixedSurface = this.data.readUInt8(this.offset + 29);
      productDef.scaledValueOfSecondFixedSurface = this.data.readUInt32BE(this.offset + 30);
    }

    return productDef;
  }

  parseSection5() {
    const numberOfDataPoints = this.data.readUInt32BE(this.offset + 5);
    const dataRepresentationTemplateNumber = this.data.readUInt16BE(this.offset + 9);

    const dataRep = {
      numberOfDataPoints,
      dataRepresentationTemplateNumber
    };

    if (dataRepresentationTemplateNumber === 0) {
      dataRep.referenceValue = this.data.readFloatBE(this.offset + 11);
      dataRep.binaryScaleFactor = this.data.readInt16BE(this.offset + 15);
      dataRep.decimalScaleFactor = this.data.readInt16BE(this.offset + 17);
      dataRep.bitsPerValue = this.data.readUInt8(this.offset + 19);
      dataRep.typeOfOriginalFieldValues = this.data.readUInt8(this.offset + 20);
    } else if (dataRepresentationTemplateNumber === 40) {
      dataRep.referenceValue = this.data.readFloatBE(this.offset + 11);
      dataRep.binaryScaleFactor = this.data.readInt16BE(this.offset + 15);
      dataRep.decimalScaleFactor = this.data.readInt16BE(this.offset + 17);
      dataRep.bitsPerValue = this.data.readUInt8(this.offset + 19);
      dataRep.typeOfOriginalFieldValues = this.data.readUInt8(this.offset + 20);
      dataRep.typeOfCompression = this.data.readUInt8(this.offset + 21);
      dataRep.compressionRatio = this.data.readUInt8(this.offset + 22);
    }

    return dataRep;
  }

  parseSection6() {
    return {
      bitmapIndicator: this.data.readUInt8(this.offset + 5),
      bitmapData: this.data.slice(this.offset + 6, this.offset + this.sections[this.sections.length - 1]?.length || 0)
    };
  }

  parseSection7(sectionLength) {
    return {
      rawData: this.data.slice(this.offset + 5, this.offset + sectionLength)
    };
  }

  extractWeatherData() {
    const gridSection = this.sections.find(s => s.number === 3);
    const productSection = this.sections.find(s => s.number === 4);
    const dataRepSection = this.sections.find(s => s.number === 5);
    const dataSection = this.sections.find(s => s.number === 7);

    if (!gridSection || !dataRepSection || !dataSection) {
      return null;
    }

    const grid = gridSection.content;
    const dataRep = dataRepSection.content;
    const rawData = dataSection.content.rawData;

    const values = this.decodeDataValues(rawData, dataRep, grid.numberOfDataPoints);

    const parameterInfo = this.getParameterInfo(
      productSection?.content?.parameterCategory,
      productSection?.content?.parameterNumber
    );

    return {
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
      parameter: parameterInfo,
      values: values,
      referenceTime: productSection?.content?.forecastTime || 0
    };
  }

  decodeDataValues(rawData, dataRep, numPoints) {
    const values = new Float32Array(numPoints);
    const bitsPerValue = dataRep.bitsPerValue || 0;

    if (bitsPerValue === 0) {
      for (let i = 0; i < numPoints; i++) {
        values[i] = dataRep.referenceValue;
      }
      return values;
    }

    const refValue = dataRep.referenceValue || 0;
    const binaryScale = dataRep.binaryScaleFactor || 0;
    const decimalScale = dataRep.decimalScaleFactor || 0;

    const scale = Math.pow(2, binaryScale) * Math.pow(10, -decimalScale);

    let bitOffset = 0;
    for (let i = 0; i < numPoints; i++) {
      const byteIndex = Math.floor(bitOffset / 8);
      const bitIndex = bitOffset % 8;

      let value = 0;
      let bitsRemaining = bitsPerValue;
      let currentByte = byteIndex;
      let currentBit = bitIndex;

      while (bitsRemaining > 0) {
        const bitsInByte = Math.min(bitsRemaining, 8 - currentBit);
        const mask = (1 << bitsInByte) - 1;
        const shift = 8 - currentBit - bitsInByte;
        const byteVal = rawData[currentByte] || 0;

        value = (value << bitsInByte) | ((byteVal >> shift) & mask);

        bitsRemaining -= bitsInByte;
        currentByte++;
        currentBit = 0;
      }

      values[i] = refValue + value * scale;
      bitOffset += bitsPerValue;
    }

    return values;
  }

  getParameterInfo(category, number) {
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

  getValueAtLatLon(lat, lon, weatherData) {
    const { grid, values } = weatherData;
    const { latMin, latMax, lonMin, lonMax, ni, nj } = grid;

    if (lat < latMin || lat > latMax || lon < lonMin || lon > lonMax) {
      return null;
    }

    const i = Math.floor(((lon - lonMin) / (lonMax - lonMin)) * (ni - 1));
    const j = Math.floor(((lat - latMin) / (latMax - latMin)) * (nj - 1));

    const index = j * ni + i;
    return values[index];
  }
}

function generateSampleGRIB2Data() {
  const ni = 360;
  const nj = 181;
  const latMin = -90;
  const latMax = 90;
  const lonMin = 0;
  const lonMax = 360;
  const dLat = (latMax - latMin) / (nj - 1);
  const dLon = (lonMax - lonMin) / (ni - 1);

  const uWind = new Float32Array(ni * nj);
  const vWind = new Float32Array(ni * nj);
  const uCurrent = new Float32Array(ni * nj);
  const vCurrent = new Float32Array(ni * nj);
  const waveHeight = new Float32Array(ni * nj);

  for (let j = 0; j < nj; j++) {
    const lat = latMin + j * dLat;
    const latRad = (lat * Math.PI) / 180;

    for (let i = 0; i < ni; i++) {
      const lon = lonMin + i * dLon;
      const lonRad = (lon * Math.PI) / 180;
      const idx = j * ni + i;

      uWind[idx] = 15 * Math.cos(latRad) * Math.sin(lonRad / 3) + 5 * Math.sin(latRad * 2);
      vWind[idx] = 10 * Math.sin(latRad * 2) * Math.cos(lonRad / 4) + 3 * Math.cos(latRad);

      uCurrent[idx] = 1.5 * Math.cos(latRad) * Math.sin(lonRad / 5);
      vCurrent[idx] = 1.0 * Math.sin(latRad * 1.5) * Math.cos(lonRad / 6);

      waveHeight[idx] = 2 + 3 * Math.abs(Math.sin(latRad)) * Math.abs(Math.cos(lonRad / 4));
    }
  }

  return {
    uWind: {
      grid: { ni, nj, latMin, latMax, lonMin, lonMax, dLat, dLon },
      parameter: { name: 'u-component of wind', units: 'm/s', shortName: 'UGRD' },
      values: uWind
    },
    vWind: {
      grid: { ni, nj, latMin, latMax, lonMin, lonMax, dLat, dLon },
      parameter: { name: 'v-component of wind', units: 'm/s', shortName: 'VGRD' },
      values: vWind
    },
    uCurrent: {
      grid: { ni, nj, latMin, latMax, lonMin, lonMax, dLat, dLon },
      parameter: { name: 'Ocean current u-component', units: 'm/s', shortName: 'UOGRD' },
      values: uCurrent
    },
    vCurrent: {
      grid: { ni, nj, latMin, latMax, lonMin, lonMax, dLat, dLon },
      parameter: { name: 'Ocean current v-component', units: 'm/s', shortName: 'VOGRD' },
      values: vCurrent
    },
    waveHeight: {
      grid: { ni, nj, latMin, latMax, lonMin, lonMax, dLat, dLon },
      parameter: { name: 'Wave height', units: 'm', shortName: 'WVHGT' },
      values: waveHeight
    }
  };
}

module.exports = {
  GRIB2Parser,
  generateSampleGRIB2Data
};
