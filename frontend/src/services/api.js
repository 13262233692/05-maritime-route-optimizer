import { API_BASE_URL, WS_BASE_URL } from '../config';

class ApiService {
  async getWeatherData() {
    const response = await fetch(`${API_BASE_URL}/weather`);
    if (!response.ok) throw new Error('Failed to fetch weather data');
    return response.json();
  }

  async getWindData() {
    const response = await fetch(`${API_BASE_URL}/weather/wind`);
    if (!response.ok) throw new Error('Failed to fetch wind data');
    return response.json();
  }

  async getWaveData() {
    const response = await fetch(`${API_BASE_URL}/weather/waves`);
    if (!response.ok) throw new Error('Failed to fetch wave data');
    return response.json();
  }

  async getChartData() {
    const response = await fetch(`${API_BASE_URL}/chart`);
    if (!response.ok) throw new Error('Failed to fetch chart data');
    return response.json();
  }

  async getPorts() {
    const response = await fetch(`${API_BASE_URL}/ports`);
    if (!response.ok) throw new Error('Failed to fetch ports');
    return response.json();
  }

  async planRoute(startLat, startLon, endLat, endLon, options = {}) {
    const response = await fetch(`${API_BASE_URL}/route/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        startLat,
        startLon,
        endLat,
        endLon,
        options
      })
    });
    if (!response.ok) throw new Error('Failed to plan route');
    return response.json();
  }

  async getRoute(routeId) {
    const response = await fetch(`${API_BASE_URL}/route/${routeId}`);
    if (!response.ok) throw new Error('Failed to fetch route');
    return response.json();
  }

  async getHealth() {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) throw new Error('Health check failed');
    return response.json();
  }

  connectWebSocket() {
    return new WebSocket(WS_BASE_URL);
  }

  subscribeToRoute(ws, routeId) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'subscribe_route',
        routeId
      }));
    }
  }

  planRouteWS(ws, startLat, startLon, endLat, endLon, options = {}) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'plan_route',
        startLat,
        startLon,
        endLat,
        endLon,
        options
      }));
    }
  }
}

const apiService = new ApiService();

export default apiService;
