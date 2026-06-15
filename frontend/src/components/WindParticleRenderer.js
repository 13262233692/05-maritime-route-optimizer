class WindParticleRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    this.options = {
      particleCount: options.particleCount || 8000,
      fadeOpacity: options.fadeOpacity || 0.996,
      dropRate: options.dropRate || 0.003,
      dropRateBump: options.dropRateBump || 0.01,
      speedFactor: options.speedFactor || 0.25,
      lineWidth: options.lineWidth || 1.0,
      ...options
    };

    this.particles = [];
    this.weatherData = null;
    this.bounds = null;
    this.animationFrame = null;
    this.visible = true;

    this.initGL();
  }

  initGL() {
    const gl = this.gl;
    if (!gl) {
      console.warn('WebGL not supported');
      return;
    }

    const vertexShaderSource = `
      attribute vec2 a_position;
      attribute vec2 a_prevPosition;
      uniform vec2 u_resolution;
      varying vec2 v_prevPosition;
      
      void main() {
        vec2 clipSpace = (a_position / u_resolution) * 2.0 - 1.0;
        clipSpace.y = -clipSpace.y;
        gl_Position = vec4(clipSpace, 0.0, 1.0);
        v_prevPosition = a_prevPosition;
      }
    `;

    const fragmentShaderSource = `
      precision mediump float;
      uniform vec4 u_color;
      
      void main() {
        gl_FragColor = u_color;
      }
    `;

    const vertexShader = this.createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('Shader program link error:', gl.getProgramInfoLog(this.program));
      return;
    }

    this.positionAttribLocation = gl.getAttribLocation(this.program, 'a_position');
    this.prevPositionAttribLocation = gl.getAttribLocation(this.program, 'a_prevPosition');
    this.resolutionUniformLocation = gl.getUniformLocation(this.program, 'u_resolution');
    this.colorUniformLocation = gl.getUniformLocation(this.program, 'u_color');

    this.positionBuffer = gl.createBuffer();
    this.prevPositionBuffer = gl.createBuffer();
  }

  createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  setWeatherData(weatherData, bounds) {
    this.weatherData = weatherData;
    this.bounds = bounds;
    this.initParticles();
  }

  setVisible(visible) {
    this.visible = visible;
  }

  initParticles() {
    if (!this.weatherData || !this.bounds) return;

    const { particleCount } = this.options;
    this.particles = [];

    for (let i = 0; i < particleCount; i++) {
      const particle = this.createParticle();
      particle.age = Math.random() * 100;
      this.particles.push(particle);
    }
  }

  createParticle() {
    const { bounds, weatherData } = this;
    if (!bounds || !weatherData) return null;

    const x = Math.random();
    const y = Math.random();

    return {
      x: x * this.canvas.width,
      y: y * this.canvas.height,
      lon: bounds.west + x * (bounds.east - bounds.west),
      lat: bounds.south + y * (bounds.north - bounds.south),
      age: 0,
      speed: 0
    };
  }

  getWindAt(lat, lon) {
    if (!this.weatherData) return { u: 0, v: 0 };

    const { grid, uWind, vWind } = this.weatherData;
    const { latMin, latMax, lonMin, lonMax, ni, nj } = grid;

    if (lat < latMin || lat > latMax || lon < lonMin || lon > lonMax) {
      return { u: 0, v: 0 };
    }

    const i = Math.floor(((lon - lonMin) / (lonMax - lonMin)) * (ni - 1));
    const j = Math.floor(((lat - latMin) / (latMax - latMin)) * (nj - 1));

    const idx = Math.max(0, Math.min(j * ni + i, uWind.length - 1));
    return { u: uWind[idx], v: vWind[idx] };
  }

  updateParticles() {
    if (!this.weatherData || !this.bounds) return;

    const { speedFactor, dropRate, dropRateBump } = this.options;
    const { bounds } = this;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p) continue;

      const wind = this.getWindAt(p.lat, p.lon);
      const windSpeed = Math.sqrt(wind.u * wind.u + wind.v * wind.v);

      p.prevX = p.x;
      p.prevY = p.y;
      p.prevLon = p.lon;
      p.prevLat = p.lat;
      p.speed = windSpeed;

      const dx = wind.u * speedFactor;
      const dy = wind.v * speedFactor;

      const pixelPerLon = this.canvas.width / (bounds.east - bounds.west);
      const pixelPerLat = this.canvas.height / (bounds.north - bounds.south);

      p.x += dx * pixelPerLon * 0.1;
      p.y -= dy * pixelPerLat * 0.1;
      p.lon += dx * 0.01;
      p.lat += dy * 0.01;

      p.age++;

      const randomDrop = Math.random();
      const speedDrop = dropRate + dropRateBump * (windSpeed / 30);

      if (p.x < 0 || p.x > this.canvas.width ||
          p.y < 0 || p.y > this.canvas.height ||
          p.lon < bounds.west || p.lon > bounds.east ||
          p.lat < bounds.south || p.lat > bounds.north ||
          randomDrop < speedDrop) {
        const newParticle = this.createParticle();
        if (newParticle) {
          this.particles[i] = newParticle;
        }
      }
    }
  }

  render() {
    const gl = this.gl;
    if (!gl || !this.visible) return;

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionUniformLocation, this.canvas.width, this.canvas.height);

    const positions = [];
    const prevPositions = [];

    for (const p of this.particles) {
      if (!p || p.prevX === undefined) continue;
      positions.push(p.x, p.y);
      prevPositions.push(p.prevX, p.prevY);
    }

    const speedFactor = this.options.speedFactor;
    const r = Math.min(1, 0.5 + speedFactor * 0.5);
    const g = Math.min(1, 0.8 + speedFactor * 0.2);
    const b = 1.0;
    gl.uniform4f(this.colorUniformLocation, r, g, b, 0.6);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.positionAttribLocation);
    gl.vertexAttribPointer(this.positionAttribLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.prevPositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(prevPositions), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.prevPositionAttribLocation);
    gl.vertexAttribPointer(this.prevPositionAttribLocation, 2, gl.FLOAT, false, 0, 0);

    gl.lineWidth(this.options.lineWidth);
    gl.drawArrays(gl.LINES, 0, positions.length / 2);
  }

  animate() {
    if (!this.visible || !this.weatherData) {
      this.animationFrame = requestAnimationFrame(() => this.animate());
      return;
    }

    this.updateParticles();
    this.render();

    this.animationFrame = requestAnimationFrame(() => this.animate());
  }

  start() {
    if (!this.animationFrame) {
      this.animate();
    }
  }

  stop() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy() {
    this.stop();
    if (this.gl) {
      this.gl.deleteProgram(this.program);
      this.gl.deleteBuffer(this.positionBuffer);
      this.gl.deleteBuffer(this.prevPositionBuffer);
    }
  }
}

export default WindParticleRenderer;
