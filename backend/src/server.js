const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const { generateSampleGRIB2Data } = require('./grib2/grib2-parser');
const { generateSampleS57Data } = require('./s57/s57-parser');
const { AStarPathfinder } = require('./pathfinding/a-star');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

let weatherData = null;
let chartData = null;
let pathfinder = null;
let activeRoutes = new Map();

function initializeData() {
  console.log('Initializing weather and chart data...');
  weatherData = generateSampleGRIB2Data();
  chartData = generateSampleS57Data();
  pathfinder = new AStarPathfinder(weatherData, chartData, {
    shipSpeed: 15,
    windWeight: 0.3,
    currentWeight: 0.4,
    waveWeight: 0.3,
    minDepth: 12,
    maxWaveHeight: 8
  });
  console.log('Data initialization complete.');
  console.log(`Grid size: ${weatherData.uWind.grid.ni} x ${weatherData.uWind.grid.nj}`);
  console.log(`Ports available: ${chartData.ports.length}`);
  console.log(`Restricted areas: ${chartData.restrictedAreas.length}`);
}

app.get('/api/weather', (req, res) => {
  if (!weatherData) {
    return res.status(500).json({ error: 'Weather data not initialized' });
  }

  const gridData = pathfinder.getGridDataForFrontend();
  res.json(gridData);
});

app.get('/api/weather/wind', (req, res) => {
  if (!weatherData) {
    return res.status(500).json({ error: 'Weather data not initialized' });
  }

  const { lat, lon } = req.query;
  if (lat === undefined || lon === undefined) {
    const gridData = pathfinder.getGridDataForFrontend();
    return res.json({
      grid: gridData.grid,
      uWind: gridData.uWind,
      vWind: gridData.vWind
    });
  }

  const uWind = pathfinder.grid[Math.floor(Number(lat))]?.[Math.floor(Number(lon))]?.uWind;
  const vWind = pathfinder.grid[Math.floor(Number(lat))]?.[Math.floor(Number(lon))]?.vWind;

  res.json({ uWind, vWind, windSpeed: Math.sqrt(uWind * uWind + vWind * vWind) });
});

app.get('/api/weather/waves', (req, res) => {
  if (!weatherData) {
    return res.status(500).json({ error: 'Weather data not initialized' });
  }

  const gridData = pathfinder.getGridDataForFrontend();
  res.json({
    grid: gridData.grid,
    waveHeight: gridData.waveHeight
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

app.post('/api/route/plan', (req, res) => {
  try {
    const { startLat, startLon, endLat, endLon, options } = req.body;

    if (!startLat || !startLon || !endLat || !endLon) {
      return res.status(400).json({ error: 'Missing required parameters: startLat, startLon, endLat, endLon' });
    }

    console.log(`Planning route from (${startLat}, ${startLon}) to (${endLat}, ${endLon})`);

    const pathfinderInstance = new AStarPathfinder(weatherData, chartData, {
      shipSpeed: options?.shipSpeed || 15,
      windWeight: options?.windWeight || 0.3,
      currentWeight: options?.currentWeight || 0.4,
      waveWeight: options?.waveWeight || 0.3,
      minDepth: options?.minDepth || 12,
      maxWaveHeight: options?.maxWaveHeight || 8
    });

    const result = pathfinderInstance.findPath(startLat, startLon, endLat, endLon);

    const routeId = `route_${Date.now()}`;
    activeRoutes.set(routeId, {
      ...result,
      createdAt: new Date().toISOString(),
      startLat,
      startLon,
      endLat,
      endLon,
      options: options || {}
    });

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
    console.error('Route planning error:', error);
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

  res.json({
    offset: start,
    limit: parseInt(limit),
    total: route.waypoints.length,
    waypoints: route.waypoints.slice(start, end)
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    weatherData: weatherData !== null,
    chartData: chartData !== null,
    activeRoutes: activeRoutes.size,
    timestamp: new Date().toISOString()
  });
});

wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');

  ws.on('message', (message) => {
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
        case 'unsubscribe':
          break;
        default:
          ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });

  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Maritime Route Optimizer WebSocket API ready'
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
    data: gridData
  }));

  if (data.streamUpdates) {
    let updateCount = 0;
    const interval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(interval);
        return;
      }

      updateCount++;
      ws.send(JSON.stringify({
        type: 'weather_update',
        timestamp: new Date().toISOString(),
        updateNumber: updateCount
      }));
    }, 30000);

    ws._weatherInterval = interval;
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
      waypoints: route.waypoints,
      totalDistance: route.totalDistance,
      estimatedTime: route.estimatedTime,
      fuelConsumption: route.fuelConsumption
    }
  }));

  let progress = 0;
  const interval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(interval);
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
      clearInterval(interval);
    }
  }, 200);

  ws._routeInterval = interval;
}

function handlePlanRoute(ws, data) {
  const { startLat, startLon, endLat, endLon, options } = data;

  if (!startLat || !startLon || !endLat || !endLon) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing required parameters' }));
    return;
  }

  const pathfinderInstance = new AStarPathfinder(weatherData, chartData, {
    shipSpeed: options?.shipSpeed || 15,
    windWeight: options?.windWeight || 0.3,
    currentWeight: options?.currentWeight || 0.4,
    waveWeight: options?.waveWeight || 0.3,
    minDepth: options?.minDepth || 12,
    maxWaveHeight: options?.maxWaveHeight || 8
  });

  const result = pathfinderInstance.findPath(startLat, startLon, endLat, endLon);

  const routeId = `route_${Date.now()}`;
  activeRoutes.set(routeId, {
    ...result,
    createdAt: new Date().toISOString(),
    startLat,
    startLon,
    endLat,
    endLon,
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

  const streamInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(streamInterval);
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
      clearInterval(streamInterval);
    }
  }, 50);

  ws._streamInterval = streamInterval;
}

const PORT = process.env.PORT || 3001;

initializeData();

server.listen(PORT, () => {
  console.log(`Maritime Route Optimizer server running on port ${PORT}`);
  console.log(`HTTP API: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
});

module.exports = { app, server, wss };
