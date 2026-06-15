import React, { useState, useEffect, useCallback } from 'react';
import MapBox from './components/MapBox';
import Sidebar from './components/Sidebar';
import apiService from './services/api';

function App() {
  const [weatherData, setWeatherData] = useState(null);
  const [ports, setPorts] = useState([]);
  const [restrictedAreas, setRestrictedAreas] = useState([]);
  const [startPort, setStartPort] = useState(null);
  const [endPort, setEndPort] = useState(null);
  const [shipSpeed, setShipSpeed] = useState(15);
  const [windWeight, setWindWeight] = useState(0.3);
  const [waveWeight, setWaveWeight] = useState(0.3);
  const [isPlanning, setIsPlanning] = useState(false);
  const [route, setRoute] = useState(null);
  const [showWindParticles, setShowWindParticles] = useState(true);
  const [showRoute, setShowRoute] = useState(true);
  const [showPorts, setShowPorts] = useState(true);
  const [showWaveHeatmap, setShowWaveHeatmap] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        const weather = await apiService.getWeatherData();
        setWeatherData(weather);

        const chart = await apiService.getChartData();
        setRestrictedAreas(chart.restrictedAreas);

        const portsData = await apiService.getPorts();
        setPorts(portsData);

        if (portsData.length >= 2) {
          setStartPort(portsData.find(p => p.code === 'CNSHA') || portsData[0]);
          setEndPort(portsData.find(p => p.code === 'SGSIN') || portsData[1]);
        }
      } catch (error) {
        console.error('Failed to load initial data:', error);
      }
    };

    loadData();
  }, []);

  const handlePlanRoute = useCallback(async () => {
    if (!startPort || !endPort) return;

    setIsPlanning(true);
    setRoute(null);

    try {
      const result = await apiService.planRoute(
        startPort.lat,
        startPort.lon,
        endPort.lat,
        endPort.lon,
        {
          shipSpeed,
          windWeight,
          currentWeight: 0.4,
          waveWeight,
          minDepth: 12,
          maxWaveHeight: 8
        }
      );

      const fullRoute = await apiService.getRoute(result.routeId);
      setRoute(fullRoute);
    } catch (error) {
      console.error('Route planning failed:', error);
    } finally {
      setIsPlanning(false);
    }
  }, [startPort, endPort, shipSpeed, windWeight, waveWeight]);

  const handlePortClick = useCallback((portProps) => {
    if (!startPort) {
      const port = ports.find(p => p.code === portProps.code);
      if (port) setStartPort(port);
    } else if (!endPort) {
      const port = ports.find(p => p.code === portProps.code);
      if (port) setEndPort(port);
    }
  }, [ports, startPort, endPort]);

  return (
    <div className="app-container">
      <MapBox
        route={route}
        weatherData={showWaveHeatmap ? weatherData : null}
        ports={ports}
        restrictedAreas={restrictedAreas}
        showWindParticles={showWindParticles}
        showRoute={showRoute}
        showPorts={showPorts}
        onPortClick={handlePortClick}
      />
      <Sidebar
        ports={ports}
        startPort={startPort}
        endPort={endPort}
        shipSpeed={shipSpeed}
        windWeight={windWeight}
        waveWeight={waveWeight}
        isPlanning={isPlanning}
        route={route}
        showWindParticles={showWindParticles}
        showRoute={showRoute}
        showPorts={showPorts}
        showWaveHeatmap={showWaveHeatmap}
        onStartPortChange={setStartPort}
        onEndPortChange={setEndPort}
        onShipSpeedChange={setShipSpeed}
        onWindWeightChange={setWindWeight}
        onWaveWeightChange={setWaveWeight}
        onPlanRoute={handlePlanRoute}
        onToggleWindParticles={() => setShowWindParticles(!showWindParticles)}
        onToggleRoute={() => setShowRoute(!showRoute)}
        onTogglePorts={() => setShowPorts(!showPorts)}
        onToggleWaveHeatmap={() => setShowWaveHeatmap(!showWaveHeatmap)}
      />
    </div>
  );
}

export default App;
