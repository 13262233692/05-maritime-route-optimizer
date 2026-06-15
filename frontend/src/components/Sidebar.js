import React from 'react';

const Sidebar = ({
  ports,
  startPort,
  endPort,
  shipSpeed,
  windWeight,
  waveWeight,
  isPlanning,
  route,
  showWindParticles,
  showRoute,
  showPorts,
  showWaveHeatmap,
  onStartPortChange,
  onEndPortChange,
  onShipSpeedChange,
  onWindWeightChange,
  onWaveWeightChange,
  onPlanRoute,
  onToggleWindParticles,
  onToggleRoute,
  onTogglePorts,
  onToggleWaveHeatmap
}) => {
  return (
    <div className="sidebar">
      <h1>🚢 Maritime Route Optimizer</h1>

      <h2>Route Planning</h2>

      <div className="form-group">
        <label>Start Port</label>
        <select value={startPort?.code || ''} onChange={(e) => {
          const port = ports.find(p => p.code === e.target.value);
          onStartPortChange(port);
        }}>
          <option value="">Select start port...</option>
          {ports.map(port => (
            <option key={port.code} value={port.code}>
              {port.name} ({port.code})
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Destination Port</label>
        <select value={endPort?.code || ''} onChange={(e) => {
          const port = ports.find(p => p.code === e.target.value);
          onEndPortChange(port);
        }}>
          <option value="">Select destination port...</option>
          {ports.map(port => (
            <option key={port.code} value={port.code}>
              {port.name} ({port.code})
            </option>
          ))}
        </select>
      </div>

      <div className="section-divider" />

      <h2>Ship Parameters</h2>

      <div className="form-group">
        <label>Ship Speed: {shipSpeed} knots</label>
        <input
          type="range"
          min="10"
          max="25"
          value={shipSpeed}
          onChange={(e) => onShipSpeedChange(Number(e.target.value))}
        />
      </div>

      <div className="form-group">
        <label>Wind Weight: {(windWeight * 100).toFixed(0)}%</label>
        <input
          type="range"
          min="0"
          max="100"
          value={windWeight * 100}
          onChange={(e) => onWindWeightChange(Number(e.target.value) / 100)}
        />
      </div>

      <div className="form-group">
        <label>Wave Weight: {(waveWeight * 100).toFixed(0)}%</label>
        <input
          type="range"
          min="0"
          max="100"
          value={waveWeight * 100}
          onChange={(e) => onWaveWeightChange(Number(e.target.value) / 100)}
        />
      </div>

      <button
        className="btn"
        onClick={onPlanRoute}
        disabled={!startPort || !endPort || isPlanning}
      >
        {isPlanning ? (
          <span className="loading-spinner" style={{ width: '20px', height: '20px', display: 'inline-block', verticalAlign: 'middle', marginRight: '8px' }} />
        ) : null}
        {isPlanning ? 'Planning...' : 'Plan Optimal Route'}
      </button>

      <div className="section-divider" />

      <h2>Map Layers</h2>

      <div className="toggle-group">
        <button
          className={`toggle-btn ${showWindParticles ? 'active' : ''}`}
          onClick={onToggleWindParticles}
        >
          🌬️ Wind
        </button>
        <button
          className={`toggle-btn ${showWaveHeatmap ? 'active' : ''}`}
          onClick={onToggleWaveHeatmap}
        >
          🌊 Waves
        </button>
      </div>

      <div className="toggle-group">
        <button
          className={`toggle-btn ${showRoute ? 'active' : ''}`}
          onClick={onToggleRoute}
        >
          🛤️ Route
        </button>
        <button
          className={`toggle-btn ${showPorts ? 'active' : ''}`}
          onClick={onTogglePorts}
        >
          ⚓ Ports
        </button>
      </div>

      <div className="section-divider" />

      {route && route.waypoints && (
        <>
          <h2>Route Summary</h2>
          <div className="stats-panel">
            <div className="stat-item">
              <span className="stat-label">Status</span>
              <span className="stat-value" style={{ color: route.found ? '#4caf50' : '#ff5722' }}>
                {route.found ? '✅ Optimal' : route.relaxed ? '⚠️ Relaxed' : '❌ Not Found'}
              </span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Total Distance</span>
              <span className="stat-value">{route.totalDistance?.toFixed(0)} km</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Estimated Time</span>
              <span className="stat-value">{route.estimatedTime?.toFixed(1)} hrs</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Fuel Consumption</span>
              <span className="stat-value">{route.fuelConsumption?.toFixed(1)} tonnes</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Waypoints</span>
              <span className="stat-value">{route.waypoints?.length}</span>
            </div>
          </div>

          {route.waypoints.length > 0 && (
            <>
              <h2>Route Details</h2>
              <div className="waypoint-list">
                {route.waypoints.slice(0, 20).map((wp, idx) => (
                  <div key={idx} className="waypoint-item">
                    #{idx + 1}: ({wp.lat?.toFixed(2)}°N, {wp.lon?.toFixed(2)}°E)
                    <br />
                    Wind: {wp.windSpeed?.toFixed(1)} m/s | Waves: {wp.waveHeight?.toFixed(1)} m
                  </div>
                ))}
                {route.waypoints.length > 20 && (
                  <div className="waypoint-item" style={{ textAlign: 'center', color: '#90caf9' }}>
                    ... and {route.waypoints.length - 20} more waypoints
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      <div className="section-divider" />

      <div className="weather-legend">
        <span className="legend-label">Calm</span>
        <div
          className="gradient-bar"
          style={{
            background: 'linear-gradient(to right, #0064c8, #00c896, #ffc800, #ff5000)'
          }}
        />
        <span className="legend-label">Storm</span>
      </div>
    </div>
  );
};

export default Sidebar;
