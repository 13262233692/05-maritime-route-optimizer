const { generateSampleGRIB2Data } = require('../grib2/grib2-parser');
const { generateSampleS57Data } = require('../s57/s57-parser');

class PriorityQueue {
  constructor() {
    this.elements = [];
  }

  enqueue(element, priority) {
    this.elements.push({ element, priority });
    this.bubbleUp(this.elements.length - 1);
  }

  dequeue() {
    if (this.elements.length === 0) return null;
    const min = this.elements[0];
    const last = this.elements.pop();
    if (this.elements.length > 0) {
      this.elements[0] = last;
      this.bubbleDown(0);
    }
    return min.element;
  }

  bubbleUp(index) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.elements[index].priority < this.elements[parentIndex].priority) {
        [this.elements[index], this.elements[parentIndex]] = [this.elements[parentIndex], this.elements[index]];
        index = parentIndex;
      } else {
        break;
      }
    }
  }

  bubbleDown(index) {
    const length = this.elements.length;
    while (true) {
      let smallest = index;
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;

      if (leftChild < length && this.elements[leftChild].priority < this.elements[smallest].priority) {
        smallest = leftChild;
      }
      if (rightChild < length && this.elements[rightChild].priority < this.elements[smallest].priority) {
        smallest = rightChild;
      }
      if (smallest !== index) {
        [this.elements[index], this.elements[smallest]] = [this.elements[smallest], this.elements[index]];
        index = smallest;
      } else {
        break;
      }
    }
  }

  isEmpty() {
    return this.elements.length === 0;
  }

  size() {
    return this.elements.length;
  }
}

class AStarPathfinder {
  constructor(weatherData, chartData, options = {}) {
    this.weatherData = weatherData;
    this.chartData = chartData;
    this.options = {
      gridResolution: 1.0,
      shipSpeed: 15,
      windWeight: 0.3,
      currentWeight: 0.4,
      waveWeight: 0.3,
      minDepth: 12,
      maxWaveHeight: 8,
      ...options
    };

    this.grid = this.buildGrid();
  }

  buildGrid() {
    const { uWind, vWind, waveHeight } = this.weatherData;
    const { ni, nj, latMin, latMax, lonMin, lonMax } = uWind.grid;

    const grid = [];
    const restrictedAreas = this.chartData?.restrictedAreas || [];
    const seabed = this.chartData?.seabed || [];

    for (let j = 0; j < nj; j++) {
      const row = [];
      const lat = latMin + j * uWind.grid.dLat;

      for (let i = 0; i < ni; i++) {
        const lon = lonMin + i * uWind.grid.dLon;
        const idx = j * ni + i;

        const cell = {
          i,
          j,
          lat,
          lon,
          uWind: uWind.values[idx],
          vWind: vWind.values[idx],
          waveHeight: waveHeight.values[idx],
          depth: this.getDepthAt(lat, lon, seabed),
          isRestricted: false,
          isLand: false
        };

        cell.windSpeed = Math.sqrt(cell.uWind * cell.uWind + cell.vWind * cell.vWind);
        cell.windDirection = Math.atan2(cell.vWind, cell.uWind) * (180 / Math.PI);

        cell.isRestricted = this.checkRestrictedArea(lat, lon, restrictedAreas);
        cell.isLand = cell.depth < this.options.minDepth;
        cell.isPassable = !cell.isRestricted && !cell.isLand && cell.waveHeight < this.options.maxWaveHeight;

        row.push(cell);
      }
      grid.push(row);
    }

    return grid;
  }

  getDepthAt(lat, lon, seabed) {
    let maxDepth = 5000;

    for (const area of seabed) {
      const coords = area.geometry.coordinates[0];
      if (this.pointInPolygon(lon, lat, coords)) {
        return area.properties.depth;
      }
    }

    return maxDepth;
  }

  checkRestrictedArea(lat, lon, restrictedAreas) {
    for (const area of restrictedAreas) {
      const coords = area.geometry.coordinates[0];
      if (this.pointInPolygon(lon, lat, coords)) {
        return true;
      }
    }
    return false;
  }

  pointInPolygon(lon, lat, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0];
      const yi = polygon[i][1];
      const xj = polygon[j][0];
      const yj = polygon[j][1];

      if (((yi > lat) !== (yj > lat)) &&
          (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  findPath(startLat, startLon, endLat, endLon) {
    const { uWind } = this.weatherData;
    const { ni, nj, latMin, lonMin, dLat, dLon } = uWind.grid;

    const startI = Math.floor(((startLon - lonMin) / (360)) * ni);
    const startJ = Math.floor(((startLat - latMin) / 180) * nj);
    const endI = Math.floor(((endLon - lonMin) / (360)) * ni);
    const endJ = Math.floor(((endLat - latMin) / 180) * nj);

    const start = { i: Math.max(0, Math.min(ni - 1, startI)), j: Math.max(0, Math.min(nj - 1, startJ)) };
    const end = { i: Math.max(0, Math.min(ni - 1, endI)), j: Math.max(0, Math.min(nj - 1, endJ)) };

    const openSet = new PriorityQueue();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Set();

    const startKey = `${start.i},${start.j}`;
    gScore.set(startKey, 0);
    openSet.enqueue(start, this.heuristic(start, end));

    const directions = [
      { di: 1, dj: 0, cost: 1 },
      { di: -1, dj: 0, cost: 1 },
      { di: 0, dj: 1, cost: 1 },
      { di: 0, dj: -1, cost: 1 },
      { di: 1, dj: 1, cost: Math.SQRT2 },
      { di: -1, dj: 1, cost: Math.SQRT2 },
      { di: 1, dj: -1, cost: Math.SQRT2 },
      { di: -1, dj: -1, cost: Math.SQRT2 }
    ];

    let iterations = 0;
    const maxIterations = 50000;

    while (!openSet.isEmpty() && iterations < maxIterations) {
      iterations++;
      const current = openSet.dequeue();
      const currentKey = `${current.i},${current.j}`;

      if (current.i === end.i && current.j === end.j) {
        return this.reconstructPath(cameFrom, current, start, end);
      }

      for (const dir of directions) {
        const ni_idx = current.i + dir.di;
        const nj_idx = current.j + dir.dj;

        if (ni_idx < 0 || ni_idx >= ni || nj_idx < 0 || nj_idx >= nj) continue;

        const neighborCell = this.grid[nj_idx][ni_idx];
        if (!neighborCell.isPassable) continue;

        const neighbor = { i: ni_idx, j: nj_idx };
        const neighborKey = `${ni_idx},${nj_idx}`;

        const moveCost = this.calculateMoveCost(current, neighbor, dir.cost);
        const tentativeGScore = gScore.get(currentKey) + moveCost;

        if (!gScore.has(neighborKey) || tentativeGScore < gScore.get(neighborKey)) {
          cameFrom.set(neighborKey, current);
          gScore.set(neighborKey, tentativeGScore);

          const fScoreVal = tentativeGScore + this.heuristic(neighbor, end);
          openSet.enqueue(neighbor, fScoreVal);
        }
      }
    }

    return this.findPathRelaxed(start, end, openSet, cameFrom, gScore);
  }

  findPathRelaxed(start, end, initialOpenSet, initialCameFrom, initialGScore) {
    const { uWind } = this.weatherData;
    const { ni, nj } = uWind.grid;

    const openSet = new PriorityQueue();
    const cameFrom = new Map(initialCameFrom);
    const gScore = new Map(initialGScore);

    const startKey = `${start.i},${start.j}`;
    if (!gScore.has(startKey)) {
      gScore.set(startKey, 0);
    }
    openSet.enqueue(start, this.heuristic(start, end) * 1.5);

    const directions = [
      { di: 1, dj: 0, cost: 1 },
      { di: -1, dj: 0, cost: 1 },
      { di: 0, dj: 1, cost: 1 },
      { di: 0, dj: -1, cost: 1 },
      { di: 1, dj: 1, cost: Math.SQRT2 },
      { di: -1, dj: 1, cost: Math.SQRT2 },
      { di: 1, dj: -1, cost: Math.SQRT2 },
      { di: -1, dj: -1, cost: Math.SQRT2 }
    ];

    let iterations = 0;
    const maxIterations = 100000;

    while (!openSet.isEmpty() && iterations < maxIterations) {
      iterations++;
      const current = openSet.dequeue();
      const currentKey = `${current.i},${current.j}`;

      if (current.i === end.i && current.j === end.j) {
        return this.reconstructPath(cameFrom, current, start, end, true);
      }

      for (const dir of directions) {
        const ni_idx = current.i + dir.di;
        const nj_idx = current.j + dir.dj;

        if (ni_idx < 0 || ni_idx >= ni || nj_idx < 0 || nj_idx >= nj) continue;

        const neighborCell = this.grid[nj_idx][ni_idx];
        const penalty = neighborCell.isRestricted ? 10 : neighborCell.isLand ? 100 : 1;

        const neighbor = { i: ni_idx, j: nj_idx };
        const neighborKey = `${ni_idx},${nj_idx}`;

        const moveCost = this.calculateMoveCost(current, neighbor, dir.cost) * penalty;
        const tentativeGScore = gScore.get(currentKey) + moveCost;

        if (!gScore.has(neighborKey) || tentativeGScore < gScore.get(neighborKey)) {
          cameFrom.set(neighborKey, current);
          gScore.set(neighborKey, tentativeGScore);

          const fScoreVal = tentativeGScore + this.heuristic(neighbor, end) * 1.5;
          openSet.enqueue(neighbor, fScoreVal);
        }
      }
    }

    return {
      waypoints: [],
      totalDistance: 0,
      estimatedTime: 0,
      fuelConsumption: 0,
      found: false,
      relaxed: false
    };
  }

  heuristic(a, b) {
    const { uWind } = this.weatherData;
    const { dLat, dLon } = uWind.grid;

    const lat1 = this.grid[a.j][a.i].lat;
    const lon1 = this.grid[a.j][a.i].lon;
    const lat2 = this.grid[b.j][b.i].lat;
    const lon2 = this.grid[b.j][b.i].lon;

    return this.haversineDistance(lat1, lon1, lat2, lon2);
  }

  haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  calculateMoveCost(from, to, baseCost) {
    const { uWind: w, waveHeight: wh } = this.weatherData;
    const { dLat, dLon } = w.grid;

    const fromCell = this.grid[from.j][from.i];
    const toCell = this.grid[to.j][to.i];

    const distance = this.haversineDistance(fromCell.lat, fromCell.lon, toCell.lat, toCell.lon);

    const avgWindSpeed = (fromCell.windSpeed + toCell.windSpeed) / 2;
    const avgWaveHeight = (fromCell.waveHeight + toCell.waveHeight) / 2;

    const bearing = this.calculateBearing(fromCell.lat, fromCell.lon, toCell.lat, toCell.lon);
    const avgWindDir = (fromCell.windDirection + toCell.windDirection) / 2;
    const windAngleDiff = Math.abs(bearing - avgWindDir);

    const windFactor = windAngleDiff < 90 ? 1 : -1;
    const windImpact = avgWindSpeed * this.options.windWeight * windFactor;

    const waveImpact = avgWaveHeight * this.options.waveWeight * 0.5;

    const effectiveSpeed = this.options.shipSpeed + windImpact - waveImpact;
    const speedFactor = this.options.shipSpeed / Math.max(effectiveSpeed, 1);

    const fuelFactor = 1 + (avgWaveHeight / this.options.maxWaveHeight) * 0.5;

    return distance * speedFactor * fuelFactor * 0.01;
  }

  calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
      Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  reconstructPath(cameFrom, current, start, end, relaxed = false) {
    const path = [];
    let curr = current;

    while (curr) {
      const cell = this.grid[curr.j][curr.i];
      path.unshift({
        lat: cell.lat,
        lon: cell.lon,
        uWind: cell.uWind,
        vWind: cell.vWind,
        windSpeed: cell.windSpeed,
        windDirection: cell.windDirection,
        waveHeight: cell.waveHeight,
        depth: cell.depth
      });

      const key = `${curr.i},${curr.j}`;
      curr = cameFrom.get(key);
    }

    let totalDistance = 0;
    let totalTime = 0;
    let totalFuel = 0;

    for (let i = 1; i < path.length; i++) {
      const dist = this.haversineDistance(path[i - 1].lat, path[i - 1].lon, path[i].lat, path[i].lon);
      totalDistance += dist;

      const avgSpeed = this.calculateEffectiveSpeed(path[i - 1], path[i]);
      totalTime += dist / avgSpeed;

      const avgWave = (path[i - 1].waveHeight + path[i].waveHeight) / 2;
      const fuelConsumption = this.calculateFuelConsumption(avgSpeed, avgWave);
      totalFuel += fuelConsumption * (dist / avgSpeed);
    }

    return {
      waypoints: path,
      totalDistance,
      estimatedTime: totalTime,
      fuelConsumption: totalFuel,
      found: path.length > 1,
      relaxed
    };
  }

  calculateEffectiveSpeed(pointA, pointB) {
    const avgWindSpeed = (pointA.windSpeed + pointB.windSpeed) / 2;
    const avgWaveHeight = (pointA.waveHeight + pointB.waveHeight) / 2;

    const windImpact = avgWindSpeed * this.options.windWeight;
    const waveImpact = avgWaveHeight * this.options.waveWeight * 0.5;

    return Math.max(this.options.shipSpeed + windImpact - waveImpact, 1);
  }

  calculateFuelConsumption(speed, waveHeight) {
    const baseFuelPerHour = 50;
    const speedFactor = Math.pow(speed / this.options.shipSpeed, 3);
    const waveFactor = 1 + (waveHeight / this.options.maxWaveHeight) * 0.3;

    return baseFuelPerHour * speedFactor * waveFactor;
  }

  getGridDataForFrontend() {
    const { uWind, vWind, waveHeight } = this.weatherData;
    const { ni, nj, latMin, lonMin, dLat, dLon } = uWind.grid;

    const uWindCompressed = [];
    const vWindCompressed = [];
    const waveHeightCompressed = [];

    const step = 2;

    for (let j = 0; j < nj; j += step) {
      for (let i = 0; i < ni; i += step) {
        const idx = j * ni + i;
        uWindCompressed.push(uWind.values[idx]);
        vWindCompressed.push(vWind.values[idx]);
        waveHeightCompressed.push(waveHeight.values[idx]);
      }
    }

    return {
      grid: {
        ni: Math.ceil(ni / step),
        nj: Math.ceil(nj / step),
        latMin,
        latMax: latMin + (nj - 1) * dLat,
        lonMin,
        lonMax: lonMin + (ni - 1) * dLon,
        dLat: dLat * step,
        dLon: dLon * step
      },
      uWind: uWindCompressed,
      vWind: vWindCompressed,
      waveHeight: waveHeightCompressed
    };
  }
}

module.exports = {
  AStarPathfinder,
  PriorityQueue
};
