const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const os = require('os');

const AsyncGRIB2Parser = require('./workers/AsyncGRIB2Parser');
const WeatherDataCache = require('./workers/WeatherDataCache');
const { generateSampleGRIB2Data } = require('./grib2/grib2-parser');
const { generateSampleS57Data } = require('./s57/s57-parser');
const { AStarPathfinder } = require('./pathfinding/a-star');

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  pingInterval: 15000,
  pingTimeout: 5000
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

let weatherData = null;
let chartData = null;
let pathfinder = null;
let activeRoutes = new Map();

const gribParser = new AsyncGRIB2Parser({
  chunkSize: 80000,
  maxConcurrentChunks: 6,
  useSharedMemory: true,
  workerPoolOptions: {
    maxWorkers: Math.max(2, Math.min(os.cpus().length - 1, 6)),
    taskTimeout: 300000,
    maxQueueSize: 200
  },
  memoryPoolOptions: {
    maxPoolSize: 6 * 1024 * 1024 * 1024,
    gcInterval: 60000
  }
});

const weatherCache = new WeatherDataCache({
  maxEntries: 15,
  maxTotalSize: 12 * 1024 * 1024 * 1024,
  ttl: 3 * 3600 * 1000
});

const eventLoopMonitor = {
  lastCheck: Date.now(),
  delay: 0,
  maxDelay: 0,
  checkInterval: 1000,
  highLoadThreshold: 200
};

function startEventLoopMonitor() {
  setInterval(() => {
    const now = Date.now();
    eventLoopMonitor.delay = now - eventLoopMonitor.lastCheck - eventLoopMonitor.checkInterval;
    eventLoopMonitor.maxDelay = Math.max(eventLoopMonitor.maxDelay, eventLoopMonitor.delay);
    eventLoopMonitor.lastCheck = now;

    if (eventLoopMonitor.delay > eventLoopMonitor.highLoadThreshold) {
      console.warn(`[EventLoop] High delay detected: ${eventLoopMonitor.delay}ms`);
    }
  }, eventLoopMonitor.checkInterval);

  setInterval(() => {
    eventLoopMonitor.maxDelay = 0;
  }, 60000);
}

function setupWebSocketHeartbeat() {
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log('[WS] Removing dead connection');
        return ws.terminate();
      }

      ws.isAlive = false;
      try {
        ws.ping();
      } catch (e) {
        console.warn('[WS] Ping failed:', e.message);
      }
    });
  }, 15000);

  wss.on('close', () => {
    clearInterval(interval);
  });
}

function setImmediatePromise() {
  return new Promise(resolve => setImmediate(resolve));
}

async function initializeData() {
  console.log('\n=== System Initialization ===');
  console.log(`[System] CPUs: ${os.cpus().length}, Total RAM: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);

  await setImmediatePromise();
  console.log('[Init] Generating sample weather data...');
  weatherData = generateSampleGRIB2Data();

  await setImmediatePromise();
  console.log('[Init] Generating sample chart data...');
  chartData = generateSampleS57Data();

  await setImmediatePromise();
  console.log('[Init] Initializing pathfinder...');
  pathfinder = new AStarPathfinder(weatherData, chartData, {
    shipSpeed: 15,
    windWeight: 0.3,
    currentWeight: 0.4,
    waveWeight: 0.3,
    minDepth: 12,
    maxWaveHeight: 8
  });

  await setImmediatePromise();
  console.log('[Init] Data initialization complete.');
  console.log(`[Init] Grid size: ${weatherData.uWind.grid.ni} x ${weatherData.uWind.grid.nj}`);
  console.log(`[Init] Ports available: ${chartData.ports.length}`);
  console.log(`[Init] Restricted areas: ${chartData.restrictedAreas.length}\n`);
}

gribParser.on('parse_start', ({ parseId, filePath }) => {
  console.log(`[GRIB2] Parse #${parseId} started: ${path.basename(filePath)}`);
});

gribParser.on('parse_complete', ({ parseId, duration, numMessages, parameters }) => {
  console.log(`[GRIB2] Parse #${parseId} complete: ${duration}ms, ${numMessages} messages`);
  const paramNames = parameters.map(p => `${p.shortName}(${p.grid.ni}x${p.grid.nj})`).join(', ');
  console.log(`[GRIB2] Parameters: ${paramNames}`);
});

gribParser.on('parse_progress', ({ parseId, stage, percent }) => {
  if (percent !== undefined && percent % 10 === 0) {
    console.log(`[GRIB2] #${parseId} ${stage}: ${percent}%`);
  }
});

weatherCache.on('evict', ({ key, size }) => {
  console.log(`[Cache] Evicted ${key} (${Math.round(size / 1024 / 1024)}MB)`);
});

app.get('/api/health', (req, res) => {
  const memoryUsage = process.memoryUsage();
  res.json({
    status: 'ok',
    weatherData: weatherData !== null,
    chartData: chartData !== null,
    activeRoutes: activeRoutes.size,
    timestamp: new Date().toISOString(),
    system: {
      eventLoopDelay: `${eventLoopMonitor.delay}ms`,
      maxEventLoopDelay: `${eventLoopMonitor.maxDelay}ms`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`
    },
    parserStats: gribParser.getStats(),
    cacheStats: weatherCache.getStats()
  });
});

app.get('/api/weather', (req, res) => {
  if (!weatherData) {
    return res.status(500).json({ error: 'Weather data not initialized' });
  }

  setImmediate(() => {
    const gridData = pathfinder.getGridDataForFrontend();
    res.json(gridData);
  });
});

app.get('/api/weather/wind', (req, res) => {
  if (!weatherData) {
    return res.status(500).json({ error: 'Weather data not initialized' });
  }

  setImmediate(() => {
    const gridData = pathfinder.getGridDataForFrontend();
    res.json({
      grid: gridData.grid,
      uWind: gridData.uWind,
      vWind: gridData.vWind
    });
  });
});

app.get('/api/weather/waves', (req, res) => {
  if (!weatherData) {
    return res.status(500).json({ error: 'Weather data not initialized' });
  }

  setImmediate(() => {
    const gridData = pathfinder.getGridDataForFrontend();
    res.json({
      grid: gridData.grid,
      waveHeight: gridData.waveHeight
    });
  });
});

app.get('/api/chart', (req, res) => {
  if (!chartData) {
    return res.status(500).json({ error: 'Chart data not initialized' });
  }
  res.json({
    restrictedAreas: chartData.restrictedAreas,
    channels: chartData.channels,
    ports: chartData.ports
  });
});

app.get('/api/ports', (req, res) => {
  if (!chartData) {
    return res.status(500).json({ error: 'Chart data not initialized' });
  }
  res.json(chartData.ports);
});

app.post('/api/route/plan', async (req, res) => {
  try {
    const { startLat, startLon, endLat, endLon, options } = req.body;

    if (!startLat || !startLon || !endLat || !endLon) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    await setImmediatePromise();
    console.log(`[Route] Planning from (${startLat}, ${startLon}) to (${endLat}, ${endLon})`);

    await setImmediatePromise();
    const pathfinderInstance = new AStarPathfinder(weatherData, chartData, {
      shipSpeed: options?.shipSpeed || 15,
      windWeight: options?.windWeight || 0.3,
      currentWeight: options?.currentWeight || 0.4,
      waveWeight: options?.waveWeight || 0.3,
      minDepth: options?.minDepth || 12,
      maxWaveHeight: options?.maxWaveHeight || 8
    });

    await setImmediatePromise();
    const result = pathfinderInstance.findPath(startLat, startLon, endLat, endLon);

    const routeId = `route_${Date.now()}`;
    activeRoutes.set(routeId, {
      ...result,
      createdAt: new Date().toISOString(),
      startLat, startLon, endLat, endLon,
      options: options || {}
    });

    await setImmediatePromise();
    res.json({
      routeId,
      found: result.found,
      relaxed: result.relaxed,
      totalDistance: result.totalDistance,
      estimatedTime: result.estimatedTime,
      fuelConsumption: result.fuelConsumption,
      waypointsCount: result.waypoints.length,
      waypoints: result.waypoints.slice(0, 1000)
    });
  } catch (error) {
    console.error('[Route] Planning error:', error);
    res.status(500).json({ error: 'Failed to plan route', message: error.message });
  }
});

app.get('/api/route/:routeId', (req, res) => {
  const route = activeRoutes.get(req.params.routeId);
  if (!route) {
    return res.status(404).json({ error: 'Route not found' });
  }
  res.json(route);
});

app.get('/api/route/:routeId/waypoints', (req, res) => {
  const route = activeRoutes.get(req.params.routeId);
  if (!route) {
    return res.status(404).json({ error: 'Route not found' });
  }

  const { offset = 0, limit = 100 } = req.query;
  const start = parseInt(offset);
  const end = start + parseInt(limit);

  setImmediate(() => {
    res.json({
      offset: start,
      limit: parseInt(limit),
      total: route.waypoints.length,
      waypoints: route.waypoints.slice(start, end)
    });
  });
});

app.post('/api/grib2/upload', (req, res) => {
  if (!req.body || !req.body.data) {
    return res.status(400).json({ error: 'No data provided' });
  }

  let chunks = [];
  req.on('data', (chunk) => {
    chunks.push(chunk);
  });

  req.on('end', async () => {
    try {
      const buffer = Buffer.concat(chunks);
      console.log(`[GRIB2] Received ${buffer.length} bytes`);

      const cacheKey = `upload_${buffer.length}_${Date.now()}`;

      gribParser.parseBuffer(buffer).then(result => {
        weatherCache.set(cacheKey, result);
        res.json({
          success: true,
          cacheKey,
          messages: result.numMessages || result.parameters?.length || 0,
          parameters: result.parameters?.map(p => p.shortName) || []
        });
      }).catch(err => {
        res.status(500).json({ error: err.message });
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
});

wss.on('connection', (ws) => {
  console.log('[WS] New client connected');
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    setImmediate(async () => {
      try {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case 'subscribe_weather':
            handleWeatherSubscription(ws, data);
            break;
          case 'subscribe_route':
            handleRouteSubscription(ws, data);
            break;
          case 'plan_route':
            handlePlanRoute(ws, data);
            break;
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            break;
          default:
            ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
        }
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });
  });

  ws.on('close', () => {
    if (ws._weatherInterval) clearInterval(ws._weatherInterval);
    if (ws._routeInterval) clearInterval(ws._routeInterval);
    if (ws._streamInterval) clearInterval(ws._streamInterval);
    console.log('[WS] Client disconnected');
  });

  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Maritime Route Optimizer WebSocket API ready',
    serverTime: Date.now()
  }));
});

function handleWeatherSubscription(ws, data) {
  if (!weatherData) {
    ws.send(JSON.stringify({ type: 'error', message: 'Weather data not available' }));
    return;
  }

  const gridData = pathfinder.getGridDataForFrontend();
  ws.send(JSON.stringify({
    type: 'weather_data',
    data: gridData,
    timestamp: Date.now()
  }));

  if (data.streamUpdates) {
    let updateCount = 0;
    ws._weatherInterval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(ws._weatherInterval);
        return;
      }
      updateCount++;
      ws.send(JSON.stringify({
        type: 'weather_update',
        timestamp: Date.now(),
        updateNumber: updateCount
      }));
    }, 30000);
  }
}

function handleRouteSubscription(ws, data) {
  const { routeId } = data;
  const route = activeRoutes.get(routeId);

  if (!route) {
    ws.send(JSON.stringify({ type: 'error', message: 'Route not found' }));
    return;
  }

  ws.send(JSON.stringify({
    type: 'route_data',
    data: {
      routeId,
      totalDistance: route.totalDistance,
      estimatedTime: route.estimatedTime,
      fuelConsumption: route.fuelConsumption
    }
  }));

  let progress = 0;
  ws._routeInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(ws._routeInterval);
      return;
    }

    if (progress < route.waypoints.length - 1) {
      progress = Math.min(progress + 5, route.waypoints.length - 1);
      ws.send(JSON.stringify({
        type: 'route_progress',
        data: {
          routeId,
          progressIndex: progress,
          currentPosition: route.waypoints[progress],
          progressPercent: Math.round((progress / (route.waypoints.length - 1)) * 100)
        }
      }));
    } else {
      clearInterval(ws._routeInterval);
    }
  }, 200);
}

async function handlePlanRoute(ws, data) {
  const { startLat, startLon, endLat, endLon, options } = data;

  if (!startLat || !startLon || !endLat || !endLon) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing required parameters' }));
    return;
  }

  await setImmediatePromise();
  const pathfinderInstance = new AStarPathfinder(weatherData, chartData, {
    shipSpeed: options?.shipSpeed || 15,
    windWeight: options?.windWeight || 0.3,
    currentWeight: options?.currentWeight || 0.4,
    waveWeight: options?.waveWeight || 0.3,
    minDepth: options?.minDepth || 12,
    maxWaveHeight: options?.maxWaveHeight || 8
  });

  await setImmediatePromise();
  const result = pathfinderInstance.findPath(startLat, startLon, endLat, endLon);

  const routeId = `route_${Date.now()}`;
  activeRoutes.set(routeId, {
    ...result,
    createdAt: new Date().toISOString(),
    startLat, startLon, endLat, endLon,
    options: options || {}
  });

  ws.send(JSON.stringify({
    type: 'route_planned',
    data: {
      routeId,
      found: result.found,
      relaxed: result.relaxed,
      totalDistance: result.totalDistance,
      estimatedTime: result.estimatedTime,
      fuelConsumption: result.fuelConsumption,
      waypointsCount: result.waypoints.length
    }
  }));

  let index = 0;
  const batchSize = 50;

  ws._streamInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(ws._streamInterval);
      return;
    }

    if (index < result.waypoints.length) {
      const batch = result.waypoints.slice(index, index + batchSize);
      ws.send(JSON.stringify({
        type: 'route_waypoints',
        data: {
          routeId,
          offset: index,
          waypoints: batch,
          total: result.waypoints.length
        }
      }));
      index += batchSize;
    } else {
      ws.send(JSON.stringify({
        type: 'route_complete',
        data: { routeId }
      }));
      clearInterval(ws._streamInterval);
    }
  }, 50);
}

const PORT = process.env.PORT || 3001;

setupWebSocketHeartbeat();
startEventLoopMonitor();

(async () => {
  try {
    await initializeData();

    server.listen(PORT, () => {
      console.log('\n========================================');
      console.log('🌊 Maritime Route Optimizer Server');
      console.log('========================================');
      console.log(`HTTP API: http://localhost:${PORT}`);
      console.log(`WebSocket: ws://localhost:${PORT}`);
      console.log(`Workers: ${gribParser.getStats().workerPool.totalWorkers}`);
      console.log(`Event loop monitor: active`);
      console.log('========================================\n');
    });

    server.on('error', async (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} in use, shutting down...`);
        await shutdown();
        process.exit(1);
      }
    });

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('Fatal initialization error:', error);
    process.exit(1);
  }
})();

async function shutdown() {
  console.log('\n=== Graceful Shutdown ===');
  try {
    server.close(() => console.log('[Server] HTTP server closed'));
    wss.close(() => console.log('[Server] WebSocket server closed'));
    await gribParser.shutdown();
    console.log('[Server] Shutdown complete');
    process.exit(0);
  } catch (e) {
    console.error('[Server] Shutdown error:', e);
    process.exit(1);
  }
}

module.exports = {
  app,
  server,
  wss,
  gribParser,
  weatherCache
};
