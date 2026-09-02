// WebGL pipeline that renders a texture source (camera video, image or
// canvas) through the active filter, lens effect (fisheye) and digital
// zoom — both for the live viewfinder and for full-resolution capture.

import { getFilter } from './filters.js';

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_position.x, -a_position.y) * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_TEMPLATE = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texScale;
uniform vec2 u_texOffset;
uniform vec2 u_outSize;
uniform float u_time;
uniform float u_fisheye;
uniform float u_pixelate;

float rand(vec2 seed) {
  return fract(sin(dot(seed, vec2(12.9898, 78.233))) * 43758.5453);
}

float grain(vec2 uv) {
  return rand(uv * 731.0 + fract(u_time) * 127.0);
}

vec3 saturate(vec3 color, float amount) {
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(vec3(luma), color, amount);
}

float vignette(vec2 uv, float start, float amount) {
  float distanceFromCenter = distance(uv, vec2(0.5));
  return 1.0 - smoothstep(start, 0.92, distanceFromCenter) * amount;
}

void main() {
  vec2 uv = v_uv;
  if (u_pixelate > 0.5) {
    vec2 cells = vec2(u_pixelate, u_pixelate * u_outSize.y / u_outSize.x);
    uv = (floor(uv * cells) + 0.5) / cells;
  }
  if (u_fisheye > 0.0) {
    float aspect = u_outSize.x / u_outSize.y;
    vec2 centered = uv - 0.5;
    centered.x *= aspect;
    float radius = length(centered);
    float maxRadius = length(vec2(0.5 * aspect, 0.5));
    float distortion = (1.0 + u_fisheye * radius * radius)
                     / (1.0 + u_fisheye * maxRadius * maxRadius);
    centered *= distortion;
    centered.x /= aspect;
    uv = centered + 0.5;
  }
  vec2 textureUv = uv * u_texScale + u_texOffset;
  vec3 color = texture2D(u_tex, textureUv).rgb;
  %GRADE%
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const MAX_CAPTURE_DIMENSION = 4096;

export class Renderer {
  constructor(canvas, source) {
    this.canvas = canvas;
    this.source = source;
    this.gl = canvas.getContext('webgl', {
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!this.gl) {
      throw new Error('WebGL is not supported on this device.');
    }
    this.programs = new Map();
    this.filter = getFilter('normal');
    this.fisheyeStrength = 0;
    this.zoom = 1;
    this.mirror = false;
    this.running = false;
    this.startTimestamp = performance.now();
    this.initGeometry();
    this.initTexture();
    // Mobile browsers drop WebGL contexts under memory pressure or after
    // backgrounding; rebuild lazily-compiled resources on restore.
    canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => {
      this.programs.clear();
      this.initGeometry();
      this.initTexture();
    });
  }

  initGeometry() {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
  }

  initTexture() {
    const gl = this.gl;
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  compileProgram(filter) {
    const gl = this.gl;
    const fragmentSource = FRAGMENT_SHADER_TEMPLATE.replace('%GRADE%', filter.grade);
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE],
      [gl.FRAGMENT_SHADER, fragmentSource],
    ]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
      }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const uniforms = {};
    for (const name of ['u_tex', 'u_texScale', 'u_texOffset', 'u_outSize', 'u_time', 'u_fisheye', 'u_pixelate']) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program, positionLocation, uniforms };
  }

  getProgram(filter) {
    if (!this.programs.has(filter.id)) {
      this.programs.set(filter.id, this.compileProgram(filter));
    }
    return this.programs.get(filter.id);
  }

  setFilter(filterId) {
    this.filter = getFilter(filterId);
  }

  setSource(source) {
    this.source = source;
  }

  getSourceSize() {
    return {
      width: this.source.videoWidth ?? this.source.naturalWidth ?? this.source.width ?? 1,
      height: this.source.videoHeight ?? this.source.naturalHeight ?? this.source.height ?? 1,
    };
  }

  sourceIsReady() {
    return !('readyState' in this.source)
      || this.source.readyState >= this.source.HAVE_CURRENT_DATA;
  }

  setFisheye(enabled) {
    this.fisheyeStrength = enabled ? 2.2 : 0;
  }

  setZoom(zoom) {
    this.zoom = Math.min(Math.max(zoom, 1), 8);
  }

  setMirror(mirror) {
    this.mirror = mirror;
  }

  setDisplaySize(cssWidth, cssHeight) {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * pixelRatio);
    this.canvas.height = Math.round(cssHeight * pixelRatio);
  }

  // Maps viewfinder UV to texture UV: cover-crop of the source into the
  // output aspect, then digital zoom, then horizontal mirror for the
  // front camera.
  computeTextureTransform(outputWidth, outputHeight) {
    const { width: sourceWidth, height: sourceHeight } = this.getSourceSize();
    const outputAspect = outputWidth / outputHeight;
    const sourceAspect = sourceWidth / sourceHeight;
    let cropX = 1;
    let cropY = 1;
    if (sourceAspect > outputAspect) {
      cropX = outputAspect / sourceAspect;
    } else {
      cropY = sourceAspect / outputAspect;
    }
    const scaleX = cropX / this.zoom;
    const scaleY = cropY / this.zoom;
    if (this.mirror) {
      return {
        scale: [-scaleX, scaleY],
        offset: [(1 + scaleX) / 2, (1 - scaleY) / 2],
        visibleWidth: sourceWidth * scaleX,
        visibleHeight: sourceHeight * scaleY,
      };
    }
    return {
      scale: [scaleX, scaleY],
      offset: [(1 - scaleX) / 2, (1 - scaleY) / 2],
      visibleWidth: sourceWidth * scaleX,
      visibleHeight: sourceHeight * scaleY,
    };
  }

  renderFrame(uploadSourceFrame = true) {
    const gl = this.gl;
    if (!this.sourceIsReady()) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width === 0 || height === 0) return;

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (uploadSourceFrame) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, this.source);
    }

    const { program, positionLocation, uniforms } = this.getProgram(this.filter);
    const transform = this.computeTextureTransform(width, height);

    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(uniforms.u_tex, 0);
    gl.uniform2fv(uniforms.u_texScale, transform.scale);
    gl.uniform2fv(uniforms.u_texOffset, transform.offset);
    gl.uniform2f(uniforms.u_outSize, width, height);
    gl.uniform1f(uniforms.u_time, (performance.now() - this.startTimestamp) / 1000);
    gl.uniform1f(uniforms.u_fisheye, this.fisheyeStrength);
    gl.uniform1f(uniforms.u_pixelate, this.filter.pixelate);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.renderFrame();
      this.animationFrame = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
  }

  // Renders one frame at the native resolution of the visible (cropped,
  // zoomed) source region and returns it as a 2D canvas for compositing.
  captureStill(maxDimension = MAX_CAPTURE_DIMENSION) {
    const displayWidth = this.canvas.width;
    const displayHeight = this.canvas.height;
    const transform = this.computeTextureTransform(displayWidth, displayHeight);

    let captureWidth = Math.round(Math.abs(transform.visibleWidth));
    let captureHeight = Math.round(Math.abs(transform.visibleHeight));
    const largestSide = Math.max(captureWidth, captureHeight);
    if (largestSide > maxDimension) {
      const downscale = maxDimension / largestSide;
      captureWidth = Math.round(captureWidth * downscale);
      captureHeight = Math.round(captureHeight * downscale);
    }

    this.canvas.width = captureWidth;
    this.canvas.height = captureHeight;
    this.renderFrame();

    const stillCanvas = document.createElement('canvas');
    stillCanvas.width = captureWidth;
    stillCanvas.height = captureHeight;
    stillCanvas.getContext('2d').drawImage(this.canvas, 0, 0);

    this.canvas.width = displayWidth;
    this.canvas.height = displayHeight;
    this.renderFrame(false);
    return stillCanvas;
  }
}
