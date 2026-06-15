const fs = require('fs');

const S57_OBJECTS = {
  DEPTH_CONTOUR: { code: 'M_COVR', description: 'Depth contour' },
  DEPTH_AREA: { code: 'M_SOUND', description: 'Depth area' },
  NAVIGATION_AREA: { code: 'M_NAVARE', description: 'Navigation area' },
  RESTRICTED_AREA: { code: 'M_RESARE', description: 'Restricted area' },
  COASTLINE: { code: 'M_COASTL', description: 'Coastline' },
  BUOY: { code: 'M_BUOY', description: 'Buoy' },
  LIGHTHOUSE: { code: 'M_LIGHTS', description: 'Lighthouse' },
  LAND_AREA: { code: 'M_LNDARE', description: 'Land area' },
  SEABED_AREA: { code: 'M_SEABED', description: 'Seabed area' }
};

class S57Parser {
  constructor() {
    this.records = [];
    this.features = [];
  }

  parse(buffer) {
    this.records = [];
    this.features = [];
    this.parseDDR(buffer);
    return this.extractGeoFeatures();
  }

  parseFile(filePath) {
    const buffer = fs.readFileSync(filePath);
    return this.parse(buffer);
  }

  parseDDR(buffer) {
    let offset = 0;

    while (offset < buffer.length) {
      const recordLength = buffer.readUInt32BE(offset);
      const recordType = String.fromCharCode(buffer[offset + 4]);

      const record = {
        length: recordLength,
        type: recordType,
        offset: offset
      };

      switch (recordType) {
        case 'D':
          record.data = this.parseDatasetGeneralRecord(buffer, offset);
          break;
        case 'I':
          record.data = this.parseCatalogDirectoryRecord(buffer, offset);
          break;
        case 'S':
          record.data = this.parseSpatialRecord(buffer, offset);
          break;
        case 'F':
          record.data = this.parseFeatureRecord(buffer, offset);
          break;
        default:
          break;
      }

      this.records.push(record);
      offset += recordLength;
    }
  }

  parseDatasetGeneralRecord(buffer, offset) {
    const recordLength = buffer.readUInt32BE(offset);
    const identifierOffset = buffer.readUInt32BE(offset + 8);
    const identifierLength = buffer.readUInt16BE(offset + 12);

    return {
      recordLength,
      identifierOffset,
      identifierLength,
      rawData: buffer.slice(offset + 14, offset + recordLength)
    };
  }

  parseCatalogDirectoryRecord(buffer, offset) {
    const recordLength = buffer.readUInt32BE(offset);
    const numberOfEntries = buffer.readUInt32BE(offset + 8);
    const entryLength = buffer.readUInt8(offset + 12);
    const fieldLengthSize = buffer.readUInt8(offset + 13);
    const fieldPositionSize = buffer.readUInt8(offset + 14);

    const entries = [];
    let pos = offset + 15;

    for (let i = 0; i < numberOfEntries; i++) {
      const fieldTag = buffer.slice(pos, pos + 4).toString().replace(/\0/g, '');
      const fieldLength = this.readVariableLength(buffer, pos + 4, fieldLengthSize);
      const fieldPosition = this.readVariableLength(buffer, pos + 4 + fieldLengthSize, fieldPositionSize);

      entries.push({
        fieldTag,
        fieldLength,
        fieldPosition
      });

      pos += entryLength;
    }

    return {
      recordLength,
      numberOfEntries,
      entries
    };
  }

  parseSpatialRecord(buffer, offset) {
    const recordLength = buffer.readUInt32BE(offset);
    const spatialRecordType = buffer.readUInt8(offset + 8);
    const numberOfCoordinates = buffer.readUInt32BE(offset + 9);

    const coordinates = [];
    let pos = offset + 13;

    for (let i = 0; i < numberOfCoordinates; i++) {
      const lon = buffer.readInt32BE(pos) / 10000000;
      const lat = buffer.readInt32BE(pos + 4) / 10000000;
      coordinates.push({ lon, lat });
      pos += 8;
    }

    return {
      spatialRecordType,
      numberOfCoordinates,
      coordinates
    };
  }

  parseFeatureRecord(buffer, offset) {
    const recordLength = buffer.readUInt32BE(offset);
    const featureType = buffer.slice(offset + 8, offset + 12).toString().replace(/\0/g, '');
    const featureIdentifier = buffer.readUInt32BE(offset + 12);
    const numberOfAttributes = buffer.readUInt16BE(offset + 16);

    const attributes = [];
    let pos = offset + 18;

    for (let i = 0; i < numberOfAttributes; i++) {
      const attrCode = buffer.slice(pos, pos + 4).toString().replace(/\0/g, '');
      const attrLength = buffer.readUInt8(pos + 4);
      const attrValue = buffer.slice(pos + 5, pos + 5 + attrLength).toString();

      attributes.push({
        code: attrCode,
        value: attrValue
      });

      pos += 5 + attrLength;
    }

    return {
      featureType,
      featureIdentifier,
      numberOfAttributes,
      attributes
    };
  }

  readVariableLength(buffer, offset, size) {
    let value = 0;
    for (let i = 0; i < size; i++) {
      value = (value << 8) | buffer[offset + i];
    }
    return value;
  }

  extractGeoFeatures() {
    const features = [];

    for (const record of this.records) {
      if (record.type === 'F' && record.data) {
        const feature = {
          type: record.data.featureType,
          id: record.data.featureIdentifier,
          attributes: {}
        };

        for (const attr of record.data.attributes) {
          feature.attributes[attr.code] = attr.value;
        }

        features.push(feature);
      }
    }

    return features;
  }
}

function generateSampleS57Data() {
  const seabedFeatures = [];
  const restrictedAreas = [];
  const channels = [];

  for (let lat = -80; lat <= 80; lat += 10) {
    for (let lon = 0; lon <= 360; lon += 10) {
      const depth = 50 + 4950 * Math.abs(Math.sin((lat * Math.PI) / 180) * Math.cos((lon * Math.PI) / 180));

      seabedFeatures.push({
        type: 'DEPTH_AREA',
        id: `depth_${lat}_${lon}`,
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [lon, lat],
            [lon + 10, lat],
            [lon + 10, lat + 10],
            [lon, lat + 10],
            [lon, lat]
          ]]
        },
        properties: {
          depth: Math.round(depth),
          depthUnit: 'meters'
        }
      });
    }
  }

  restrictedAreas.push(
    {
      type: 'RESTRICTED_AREA',
      id: 'restricted_strait_of_malacca',
      name: 'Strait of Malacca Restricted Zone',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [100, 2],
          [103, 1],
          [104, 2],
          [105, 3],
          [104, 4],
          [102, 5],
          [100, 4],
          [100, 2]
        ]]
      },
      properties: {
        restrictionType: 'narrow_channel',
        maxSpeed: 12,
        description: 'Narrow shipping lane with traffic separation scheme'
      }
    },
    {
      type: 'RESTRICTED_AREA',
      id: 'restricted_south_china_sea',
      name: 'South China Sea Islands Restricted Area',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [110, 5],
          [120, 5],
          [120, 15],
          [110, 15],
          [110, 5]
        ]]
      },
      properties: {
        restrictionType: 'islands_and_reefs',
        minDepth: 10,
        description: 'Area with numerous islands and reefs'
      }
    },
    {
      type: 'RESTRICTED_AREA',
      id: 'restricted_hormuz',
      name: 'Strait of Hormuz Restricted Zone',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [55, 25],
          [58, 25],
          [59, 26],
          [57, 27],
          [55, 26.5],
          [55, 25]
        ]]
      },
      properties: {
        restrictionType: 'strategic_strait',
        maxSpeed: 14,
        description: 'Strategic strait with heavy tanker traffic'
      }
    }
  );

  channels.push(
    {
      type: 'CHANNEL',
      id: 'channel_panama',
      name: 'Panama Canal Approach Channel',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-79, 8],
          [-79.5, 8.5],
          [-79.8, 9],
          [-80, 9.5]
        ]
      },
      properties: {
        minDepth: 15,
        maxDraft: 13.5,
        description: 'Approach channel to Panama Canal'
      }
    },
    {
      type: 'CHANNEL',
      id: 'channel_suez',
      name: 'Suez Canal Approach Channel',
      geometry: {
        type: 'LineString',
        coordinates: [
          [32.5, 30],
          [32.3, 29],
          [32.4, 28],
          [33, 27]
        ]
      },
      properties: {
        minDepth: 23,
        maxDraft: 20,
        description: 'Approach channel to Suez Canal'
      }
    }
  );

  const ports = [
    { name: 'Shanghai', lat: 31.2304, lon: 121.4737, code: 'CNSHA', type: 'container', depth: 14 },
    { name: 'Singapore', lat: 1.3521, lon: 103.8198, code: 'SGSIN', type: 'container', depth: 16 },
    { name: 'Rotterdam', lat: 51.9244, lon: 4.4777, code: 'NLRTM', type: 'container', depth: 24 },
    { name: 'Los Angeles', lat: 33.7405, lon: -118.2713, code: 'USLAX', type: 'container', depth: 14 },
    { name: 'Dubai', lat: 25.2048, lon: 55.2708, code: 'AEDXB', type: 'container', depth: 16 },
    { name: 'Hong Kong', lat: 22.3193, lon: 114.1694, code: 'HKHKG', type: 'container', depth: 15 },
    { name: 'Busan', lat: 35.1796, lon: 129.0756, code: 'KRPUS', type: 'container', depth: 17 },
    { name: 'Hamburg', lat: 53.5511, lon: 9.9937, code: 'DEHAM', type: 'container', depth: 14 },
    { name: 'New York', lat: 40.7128, lon: -74.0060, code: 'USNYC', type: 'container', depth: 15 },
    { name: 'Tokyo', lat: 35.6762, lon: 139.6503, code: 'JPTYO', type: 'container', depth: 12 }
  ];

  return {
    seabed: seabedFeatures,
    restrictedAreas: restrictedAreas,
    channels: channels,
    ports: ports
  };
}

module.exports = {
  S57Parser,
  S57_OBJECTS,
  generateSampleS57Data
};
