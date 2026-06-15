import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import WindParticleRenderer from './WindParticleRenderer';
import { MAPBOX_TOKEN } from '../config';

/* global mapboxgl */

const MapBox = ({ 
  route, 
  weatherData, 
  ports, 
  restrictedAreas,
  showWindParticles,
  showRoute,
  showPorts,
  onPortClick 
}) => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const windCanvas = useRef(null);
  const windRenderer = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);

  useEffect(() => {
    if (map.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [120, 20],
      zoom: 2,
      projection: 'mercator'
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.current.addControl(new mapboxgl.ScaleControl(), 'bottom-left');

    map.current.on('load', () => {
      setMapLoaded(true);
      setIsMapReady(true);
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!windCanvas.current || !map.current) return;

    windRenderer.current = new WindParticleRenderer(windCanvas.current, {
      particleCount: 6000,
      speedFactor: 0.3,
      fadeOpacity: 0.996,
      lineWidth: 1.0
    });

    windRenderer.current.start();

    const updateWindBounds = () => {
      if (!map.current || !weatherData) return;

      const bounds = map.current.getBounds();
      const canvasRect = windCanvas.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      windCanvas.current.width = canvasRect.width * dpr;
      windCanvas.current.height = canvasRect.height * dpr;

      windRenderer.current.resize();
      windRenderer.current.setWeatherData(weatherData, {
        west: bounds.getWest(),
        east: bounds.getEast(),
        south: bounds.getSouth(),
        north: bounds.getNorth()
      });
    };

    map.current.on('move', updateWindBounds);
    map.current.on('zoom', updateWindBounds);
    map.current.on('moveend', updateWindBounds);

    if (weatherData) {
      updateWindBounds();
    }

    return () => {
      if (windRenderer.current) {
        windRenderer.current.destroy();
        windRenderer.current = null;
      }
    };
  }, [weatherData, mapLoaded]);

  useEffect(() => {
    if (windRenderer.current) {
      windRenderer.current.setVisible(showWindParticles);
    }
  }, [showWindParticles]);

  useEffect(() => {
    if (!isMapReady || !map.current) return;

    if (map.current.getSource('restricted-areas')) {
      map.current.removeLayer('restricted-areas-fill');
      map.current.removeLayer('restricted-areas-outline');
      map.current.removeSource('restricted-areas');
    }

    if (restrictedAreas && restrictedAreas.length > 0) {
      const features = restrictedAreas.map(area => ({
        type: 'Feature',
        properties: {
          name: area.name || 'Restricted Area',
          type: area.properties?.restrictionType || 'restricted',
          description: area.properties?.description || ''
        },
        geometry: {
          type: 'Polygon',
          coordinates: area.geometry.coordinates
        }
      }));

      map.current.addSource('restricted-areas', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features
        }
      });

      map.current.addLayer({
        id: 'restricted-areas-fill',
        type: 'fill',
        source: 'restricted-areas',
        paint: {
          'fill-color': '#ff5722',
          'fill-opacity': 0.2
        }
      });

      map.current.addLayer({
        id: 'restricted-areas-outline',
        type: 'line',
        source: 'restricted-areas',
        paint: {
          'line-color': '#ff5722',
          'line-width': 2,
          'line-dasharray': [3, 3]
        }
      });
    }
  }, [restrictedAreas, isMapReady]);

  useEffect(() => {
    if (!isMapReady || !map.current) return;

    if (map.current.getSource('ports')) {
      map.current.removeLayer('ports');
      map.current.removeSource('ports');
    }

    if (ports && ports.length > 0 && showPorts) {
      const features = ports.map(port => ({
        type: 'Feature',
        properties: {
          name: port.name,
          code: port.code,
          type: port.type,
          depth: port.depth
        },
        geometry: {
          type: 'Point',
          coordinates: [port.lon, port.lat]
        }
      }));

      map.current.addSource('ports', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features
        }
      });

      map.current.addLayer({
        id: 'ports',
        type: 'circle',
        source: 'ports',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 3,
            8, 6,
            12, 10
          ],
          'circle-color': '#4fc3f7',
          'circle-stroke-color': '#0288d1',
          'circle-stroke-width': 2
        }
      });

      map.current.on('click', 'ports', (e) => {
        if (onPortClick && e.features.length > 0) {
          onPortClick(e.features[0].properties);
        }
      });

      map.current.on('mouseenter', 'ports', () => {
        map.current.getCanvas().style.cursor = 'pointer';
      });

      map.current.on('mouseleave', 'ports', () => {
        map.current.getCanvas().style.cursor = '';
      });
    }
  }, [ports, isMapReady, showPorts, onPortClick]);

  useEffect(() => {
    if (!isMapReady || !map.current) return;

    if (map.current.getSource('route')) {
      map.current.removeLayer('route-line');
      map.current.removeLayer('route-glow');
      map.current.removeSource('route');
    }

    if (route && route.waypoints && route.waypoints.length > 0 && showRoute) {
      const coordinates = route.waypoints.map(wp => [wp.lon, wp.lat]);

      map.current.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates
          }
        }
      });

      map.current.addLayer({
        id: 'route-glow',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#4fc3f7',
          'line-width': 8,
          'line-opacity': 0.3,
          'line-blur': 4
        }
      });

      map.current.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#4fc3f7',
          'line-width': 3,
          'line-opacity': 0.9
        }
      });

      const bounds = coordinates.reduce((bounds, coord) => {
        return bounds.extend(coord);
      }, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));

      map.current.fitBounds(bounds, {
        padding: 50,
        duration: 1000
      });
    }
  }, [route, isMapReady, showRoute]);

  useEffect(() => {
    if (!isMapReady || !map.current) return;

    if (map.current.getSource('wave-height')) {
      map.current.removeLayer('wave-heatmap');
      map.current.removeSource('wave-height');
    }

    if (weatherData && weatherData.waveHeight && weatherData.grid) {
      const { grid, waveHeight } = weatherData;
      const features = [];

      const step = 2;
      for (let j = 0; j < grid.nj; j += step) {
        for (let i = 0; i < grid.ni; i += step) {
          const idx = j * grid.ni + i;
          const lon = grid.lonMin + i * grid.dLon;
          const lat = grid.latMin + j * grid.dLat;
          const wh = waveHeight[idx] || 0;

          features.push({
            type: 'Feature',
            properties: { value: wh },
            geometry: {
              type: 'Point',
              coordinates: [lon, lat]
            }
          });
        }
      }

      map.current.addSource('wave-height', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features
        }
      });

      map.current.addLayer({
        id: 'wave-heatmap',
        type: 'heatmap',
        source: 'wave-height',
        maxzoom: 6,
        paint: {
          'heatmap-weight': [
            'interpolate',
            ['linear'],
            ['get', 'value'],
            0, 0,
            10, 1
          ],
          'heatmap-intensity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 0.5,
            6, 1.5
          ],
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(0, 100, 200, 0)',
            0.2, 'rgba(0, 150, 200, 0.4)',
            0.5, 'rgba(0, 200, 150, 0.5)',
            0.7, 'rgba(255, 200, 0, 0.6)',
            1, 'rgba(255, 80, 0, 0.7)'
          ],
          'heatmap-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 15,
            6, 40
          ],
          'heatmap-opacity': 0.6
        }
      }, 'restricted-areas-fill');
    }
  }, [weatherData, isMapReady]);

  return (
    <div className="map-container">
      <div ref={mapContainer} style={{ width: '100%', height: '100%', position: 'absolute' }} />
      <canvas
        ref={windCanvas}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1
        }}
      />
    </div>
  );
};

export default MapBox;
