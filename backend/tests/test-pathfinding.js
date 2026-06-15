const { generateSampleGRIB2Data, GRIB2Parser } = require('../src/grib2/grib2-parser');
const { generateSampleS57Data } = require('../src/s57/s57-parser');
const { AStarPathfinder } = require('../src/pathfinding/a-star');

console.log('=== GRIB2 Parser Test ===\n');

try {
  const weatherData = generateSampleGRIB2Data();

  console.log('Weather data generated successfully!');
  console.log(`uWind grid: ${weatherData.uWind.grid.ni} x ${weatherData.uWind.grid.nj}`);
  console.log(`vWind values count: ${weatherData.vWind.values.length}`);
  console.log(`uCurrent parameter: ${weatherData.uCurrent.parameter.name}`);
  console.log(`Wave height units: ${weatherData.waveHeight.parameter.units}`);

  const sampleIdx = 90 * 360 + 180;
  console.log(`\nSample at (45°N, 180°E):`);
  console.log(`  uWind: ${weatherData.uWind.values[sampleIdx].toFixed(2)} m/s`);
  console.log(`  vWind: ${weatherData.vWind.values[sampleIdx].toFixed(2)} m/s`);
  console.log(`  Wave height: ${weatherData.waveHeight.values[sampleIdx].toFixed(2)} m`);

  console.log('\n✅ GRIB2 parser test PASSED');
} catch (error) {
  console.error('❌ GRIB2 parser test FAILED:', error.message);
  process.exit(1);
}

console.log('\n=== S-57 Chart Parser Test ===\n');

try {
  const chartData = generateSampleS57Data();

  console.log('S-57 chart data generated successfully!');
  console.log(`Seabed features: ${chartData.seabed.length}`);
  console.log(`Restricted areas: ${chartData.restrictedAreas.length}`);
  console.log(`Channels: ${chartData.channels.length}`);
  console.log(`Ports: ${chartData.ports.length}`);

  console.log('\nAvailable ports:');
  chartData.ports.forEach(port => {
    console.log(`  ${port.name} (${port.code}) - ${port.type} - Depth: ${port.depth}m`);
  });

  console.log('\n✅ S-57 chart parser test PASSED');
} catch (error) {
  console.error('❌ S-57 chart parser test FAILED:', error.message);
  process.exit(1);
}

console.log('\n=== A* Pathfinding Test ===\n');

try {
  const weatherData = generateSampleGRIB2Data();
  const chartData = generateSampleS57Data();

  const pathfinder = new AStarPathfinder(weatherData, chartData, {
    shipSpeed: 15,
    windWeight: 0.3,
    currentWeight: 0.4,
    waveWeight: 0.3,
    minDepth: 12,
    maxWaveHeight: 8
  });

  console.log('Pathfinder initialized successfully!');
  console.log(`Grid size: ${weatherData.uWind.grid.ni} x ${weatherData.uWind.grid.nj}`);
  console.log(`Total cells: ${weatherData.uWind.grid.ni * weatherData.uWind.grid.nj}`);

  const startLat = 31.2;
  const startLon = 121.5;
  const endLat = 1.35;
  const endLon = 103.8;

  console.log(`\nPlanning route from Shanghai (${startLat}°N, ${startLon}°E)`);
  console.log(`                   to Singapore (${endLat}°N, ${endLon}°E)`);

  const startTime = Date.now();
  const result = pathfinder.findPath(startLat, startLon, endLat, endLon);
  const endTime = Date.now();

  console.log(`\nRoute planning completed in ${endTime - startTime}ms`);
  console.log(`Path found: ${result.found} (relaxed: ${result.relaxed})`);
  console.log(`Waypoints: ${result.waypoints.length}`);
  console.log(`Total distance: ${result.totalDistance.toFixed(2)} km`);
  console.log(`Estimated time: ${result.estimatedTime.toFixed(2)} hours`);
  console.log(`Fuel consumption: ${result.fuelConsumption.toFixed(2)} tonnes`);

  if (result.waypoints.length > 0) {
    console.log('\nFirst 5 waypoints:');
    result.waypoints.slice(0, 5).forEach((wp, idx) => {
      console.log(`  ${idx}: (${wp.lat.toFixed(2)}°N, ${wp.lon.toFixed(2)}°E) - Wind: ${wp.windSpeed.toFixed(1)} m/s, Waves: ${wp.waveHeight.toFixed(1)} m`);
    });
  }

  const gridData = pathfinder.getGridDataForFrontend();
  console.log(`\nFrontend grid data size: ${gridData.grid.ni} x ${gridData.grid.nj}`);
  console.log(`uWind compressed array length: ${gridData.uWind.length}`);

  console.log('\n✅ A* pathfinding test PASSED');
} catch (error) {
  console.error('❌ A* pathfinding test FAILED:', error.message);
  console.error(error.stack);
  process.exit(1);
}

console.log('\n=== All tests PASSED! ===');
