import { DEG2RAD, clamp } from './utils.js';

const EARTH_RADIUS_UNITS = 1;
const ALT_SCALE = 1 / 4000;
const MIN_RADIUS = 1.6;
const MAX_RADIUS = 7.5;
const ROTATION_SPEED = 0.015; // radians per second

let containerRef;
let canvas;
let gl;
let fallbackEl;
let animationId = null;
let resizeObserver = null;
let windowResizeHandler = null;
let ready = false;

let sphereProgram = null;
let lineProgram = null;
let pointProgram = null;

let sphereBuffers = null;
let orbitBuffer = null;
let linkBuffer = null;
let satelliteBuffer = null;
let stationBuffer = null;
let earthTexture = null;

let cameraRadius = 3.2;
let rotationX = 0.6;
let rotationY = 0.9;
let earthRotation = 0;
let lastFrameTime = 0;
let linkVisible = false;
let currentTheme = 'dark';

const pointerState = {
  active: false,
  x: 0,
  y: 0,
  startRotX: 0,
  startRotY: 0,
};

const projectionMatrix = new Float32Array(16);
const viewMatrix = new Float32Array(16);
const modelMatrix = new Float32Array(16);
const modelViewMatrix = new Float32Array(16);
const normalMatrix = new Float32Array(9);

const satelliteData = new Float32Array(7);
const stationData = {
  array: new Float32Array(0),
  count: 0,
};
const linkData = new Float32Array(6);

function latLonToVector(latDeg, lonDeg, altKm = 0) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const radius = EARTH_RADIUS_UNITS + altKm * ALT_SCALE;
  const cosLat = Math.cos(lat);
  return [
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    radius * cosLat * Math.sin(lon),
  ];
}

function clampRotationX(value) {
  return clamp(value, 0.1, Math.PI - 0.1);
}

function mat4Identity(out) {
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

function mat4Multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  const b00 = b[0], b01 = b[1], b02 = b[2], b03 = b[3];
  const b10 = b[4], b11 = b[5], b12 = b[6], b13 = b[7];
  const b20 = b[8], b21 = b[9], b22 = b[10], b23 = b[11];
  const b30 = b[12], b31 = b[13], b32 = b[14], b33 = b[15];

  out[0] = a00 * b00 + a01 * b10 + a02 * b20 + a03 * b30;
  out[1] = a00 * b01 + a01 * b11 + a02 * b21 + a03 * b31;
  out[2] = a00 * b02 + a01 * b12 + a02 * b22 + a03 * b32;
  out[3] = a00 * b03 + a01 * b13 + a02 * b23 + a03 * b33;
  out[4] = a10 * b00 + a11 * b10 + a12 * b20 + a13 * b30;
  out[5] = a10 * b01 + a11 * b11 + a12 * b21 + a13 * b31;
  out[6] = a10 * b02 + a11 * b12 + a12 * b22 + a13 * b32;
  out[7] = a10 * b03 + a11 * b13 + a12 * b23 + a13 * b33;
  out[8] = a20 * b00 + a21 * b10 + a22 * b20 + a23 * b30;
  out[9] = a20 * b01 + a21 * b11 + a22 * b21 + a23 * b31;
  out[10] = a20 * b02 + a21 * b12 + a22 * b22 + a23 * b32;
  out[11] = a20 * b03 + a21 * b13 + a22 * b23 + a23 * b33;
  out[12] = a30 * b00 + a31 * b10 + a32 * b20 + a33 * b30;
  out[13] = a30 * b01 + a31 * b11 + a32 * b21 + a33 * b31;
  out[14] = a30 * b02 + a31 * b12 + a32 * b22 + a33 * b32;
  out[15] = a30 * b03 + a31 * b13 + a32 * b23 + a33 * b33;
  return out;
}

function mat4Perspective(out, fov, aspect, near, far) {
  const f = 1.0 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = 2 * far * near * nf;
  out[15] = 0;
  return out;
}

function mat4LookAt(out, eye, target, up) {
  const x0 = eye[0], x1 = eye[1], x2 = eye[2];
  const y0 = up[0], y1 = up[1], y2 = up[2];
  const z0 = target[0], z1 = target[1], z2 = target[2];

  let zx = x0 - z0;
  let zy = x1 - z1;
  let zz = x2 - z2;
  let len = Math.hypot(zx, zy, zz);
  if (len === 0) {
    zz = 1;
    len = 1;
  }
  zx /= len;
  zy /= len;
  zz /= len;

  let xx = y1 * zz - y2 * zy;
  let xy = y2 * zx - y0 * zz;
  let xz = y0 * zy - y1 * zx;
  len = Math.hypot(xx, xy, xz);
  if (!len) {
    xx = 0;
    xy = 0;
    xz = 0;
  } else {
    xx /= len;
    xy /= len;
    xz /= len;
  }

  let yx = zy * xz - zz * xy;
  let yy = zz * xx - zx * xz;
  let yz = zx * xy - zy * xx;
  len = Math.hypot(yx, yy, yz);
  if (!len) {
    yx = 0;
    yy = 0;
    yz = 0;
  } else {
    yx /= len;
    yy /= len;
    yz /= len;
  }

  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[3] = 0;
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[7] = 0;
  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[11] = 0;
  out[12] = -(xx * x0 + xy * x1 + xz * x2);
  out[13] = -(yx * x0 + yy * x1 + yz * x2);
  out[14] = -(zx * x0 + zy * x1 + zz * x2);
  out[15] = 1;
  return out;
}

function mat4RotateY(out, rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  out[0] = c; out[1] = 0; out[2] = -s; out[3] = 0;
  out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
  out[8] = s; out[9] = 0; out[10] = c; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

function mat3FromMat4(out, mat) {
  out[0] = mat[0]; out[1] = mat[1]; out[2] = mat[2];
  out[3] = mat[4]; out[4] = mat[5]; out[5] = mat[6];
  out[6] = mat[8]; out[7] = mat[9]; out[8] = mat[10];
  return out;
}

function mat3InvertTranspose(out, mat) {
  const a00 = mat[0], a01 = mat[1], a02 = mat[2];
  const a10 = mat[3], a11 = mat[4], a12 = mat[5];
  const a20 = mat[6], a21 = mat[7], a22 = mat[8];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  let det = a00 * b01 + a01 * b11 + a02 * b21;
  if (!det) {
    return mat3Identity(out);
  }
  det = 1.0 / det;

  out[0] = b01 * det;
  out[1] = (-a22 * a01 + a02 * a21) * det;
  out[2] = (a12 * a01 - a02 * a11) * det;
  out[3] = b11 * det;
  out[4] = (a22 * a00 - a02 * a20) * det;
  out[5] = (-a12 * a00 + a02 * a10) * det;
  out[6] = b21 * det;
  out[7] = (-a21 * a00 + a01 * a20) * det;
  out[8] = (a11 * a00 - a01 * a10) * det;
  return out;
}

function mat3Identity(out) {
  out[0] = 1; out[1] = 0; out[2] = 0;
  out[3] = 0; out[4] = 1; out[5] = 0;
  out[6] = 0; out[7] = 0; out[8] = 1;
  return out;
}

function createSphereGeometry(segments = 96, rings = 64) {
  const vertices = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let x = 0; x <= segments; x++) {
      const u = x / segments;
      const phi = u * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const px = cosPhi * sinTheta;
      const py = cosTheta;
      const pz = sinPhi * sinTheta;

      vertices.push(px, py, pz);
      normals.push(px, py, pz);
      uvs.push(u, 1 - v);
    }
  }

  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < segments; x++) {
      const first = y * (segments + 1) + x;
      const second = first + segments + 1;
      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info || 'Error al compilar shader');
  }
  return shader;
}

function createProgram(vertexSrc, fragmentSrc) {
  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSrc);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(info || 'Error al enlazar programa');
  }
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

function setupPrograms() {
  const sphereVertex = `
    attribute vec3 position;
    attribute vec3 normal;
    attribute vec2 uv;
    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform mat3 uNormalMatrix;
    varying vec3 vNormal;
    varying vec2 vUv;
    void main() {
      vNormal = normalize(uNormalMatrix * normal);
      vUv = uv;
      gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(position, 1.0);
    }
  `;

  const sphereFragment = `
    precision mediump float;
    varying vec3 vNormal;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec3 uLightDirection;
    uniform vec4 uAmbient;
    void main() {
      vec3 normal = normalize(vNormal);
      float light = max(dot(normal, normalize(uLightDirection)), 0.0);
      vec3 tex = texture2D(uTexture, vUv).rgb;
      vec3 color = tex * (0.35 + 0.65 * light) + uAmbient.rgb * 0.25;
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const lineVertex = `
    attribute vec3 position;
    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    void main() {
      gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(position, 1.0);
    }
  `;

  const lineFragment = `
    precision mediump float;
    uniform vec4 uColor;
    void main() {
      gl_FragColor = uColor;
    }
  `;

  const pointVertex = `
    attribute vec3 position;
    attribute vec3 color;
    attribute float size;
    varying vec3 vColor;
    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    void main() {
      vec4 mvPosition = uModelViewMatrix * vec4(position, 1.0);
      gl_Position = uProjectionMatrix * mvPosition;
      float dist = -mvPosition.z;
      gl_PointSize = size * (300.0 / max(1.0, dist));
      vColor = color;
    }
  `;

  const pointFragment = `
    precision mediump float;
    varying vec3 vColor;
    void main() {
      vec2 coord = gl_PointCoord * 2.0 - 1.0;
      float len = dot(coord, coord);
      if (len > 1.0) discard;
      float intensity = smoothstep(1.0, 0.0, len);
      gl_FragColor = vec4(vColor * intensity, 1.0);
    }
  `;

  sphereProgram = {
    program: createProgram(sphereVertex, sphereFragment),
  };
  sphereProgram.attributes = {
    position: gl.getAttribLocation(sphereProgram.program, 'position'),
    normal: gl.getAttribLocation(sphereProgram.program, 'normal'),
    uv: gl.getAttribLocation(sphereProgram.program, 'uv'),
  };
  sphereProgram.uniforms = {
    modelViewMatrix: gl.getUniformLocation(sphereProgram.program, 'uModelViewMatrix'),
    projectionMatrix: gl.getUniformLocation(sphereProgram.program, 'uProjectionMatrix'),
    normalMatrix: gl.getUniformLocation(sphereProgram.program, 'uNormalMatrix'),
    texture: gl.getUniformLocation(sphereProgram.program, 'uTexture'),
    lightDirection: gl.getUniformLocation(sphereProgram.program, 'uLightDirection'),
    ambient: gl.getUniformLocation(sphereProgram.program, 'uAmbient'),
  };

  lineProgram = {
    program: createProgram(lineVertex, lineFragment),
  };
  lineProgram.attributes = {
    position: gl.getAttribLocation(lineProgram.program, 'position'),
  };
  lineProgram.uniforms = {
    modelViewMatrix: gl.getUniformLocation(lineProgram.program, 'uModelViewMatrix'),
    projectionMatrix: gl.getUniformLocation(lineProgram.program, 'uProjectionMatrix'),
    color: gl.getUniformLocation(lineProgram.program, 'uColor'),
  };

  pointProgram = {
    program: createProgram(pointVertex, pointFragment),
  };
  pointProgram.attributes = {
    position: gl.getAttribLocation(pointProgram.program, 'position'),
    color: gl.getAttribLocation(pointProgram.program, 'color'),
    size: gl.getAttribLocation(pointProgram.program, 'size'),
  };
  pointProgram.uniforms = {
    modelViewMatrix: gl.getUniformLocation(pointProgram.program, 'uModelViewMatrix'),
    projectionMatrix: gl.getUniformLocation(pointProgram.program, 'uProjectionMatrix'),
  };
}

function createSphereBuffers() {
  const geometry = createSphereGeometry();
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW);

  const normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.normals, gl.STATIC_DRAW);

  const uvBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.uvs, gl.STATIC_DRAW);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

  return {
    positionBuffer,
    normalBuffer,
    uvBuffer,
    indexBuffer,
    indexCount: geometry.indices.length,
  };
}

function createLineBuffer() {
  const buffer = gl.createBuffer();
  return {
    buffer,
    count: 0,
    data: new Float32Array(0),
  };
}

function createPointBuffer() {
  const buffer = gl.createBuffer();
  return {
    buffer,
    count: 0,
    data: new Float32Array(0),
  };
}

function updateLineBuffer(target, data, count) {
  target.count = count;
  target.data = data;
  gl.bindBuffer(gl.ARRAY_BUFFER, target.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

function updatePointBuffer(target, data, count) {
  target.count = count;
  target.data = data;
  gl.bindBuffer(gl.ARRAY_BUFFER, target.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

function generatePolygon(ctx, polygon, width, height) {
  if (!polygon.length) return;
  ctx.beginPath();
  polygon.forEach((coord, index) => {
    const x = ((coord.lon + 180) / 360) * width;
    const y = ((90 - coord.lat) / 180) * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function generateEarthTextureCanvas() {
  const width = 1024;
  const height = 512;
  const canvasTex = document.createElement('canvas');
  canvasTex.width = width;
  canvasTex.height = height;
  const ctx = canvasTex.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#12326b');
  gradient.addColorStop(1, '#061227');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#0a1f3f';
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * height;
    ctx.fillRect(0, y - 1, width, 2);
  }
  for (let lon = -150; lon <= 150; lon += 30) {
    const x = ((lon + 180) / 360) * width;
    ctx.fillRect(x - 1, 0, 2, height);
  }
  ctx.globalAlpha = 1;

  const landColor = '#2da574';
  const borderColor = 'rgba(12, 53, 34, 0.9)';
  ctx.fillStyle = landColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;

  const continents = [
    {
      name: 'NorthAmerica',
      polygon: [
        { lat: 72, lon: -170 }, { lat: 75, lon: -150 }, { lat: 74, lon: -130 },
        { lat: 70, lon: -110 }, { lat: 60, lon: -98 }, { lat: 58, lon: -85 },
        { lat: 52, lon: -75 }, { lat: 47, lon: -64 }, { lat: 43, lon: -60 },
        { lat: 32, lon: -80 }, { lat: 28, lon: -100 }, { lat: 22, lon: -107 },
        { lat: 15, lon: -95 }, { lat: 18, lon: -80 }, { lat: 25, lon: -75 },
        { lat: 32, lon: -70 }, { lat: 44, lon: -66 }, { lat: 55, lon: -75 },
        { lat: 60, lon: -95 }, { lat: 65, lon: -120 }, { lat: 60, lon: -150 },
        { lat: 58, lon: -165 }, { lat: 66, lon: -173 },
      ],
    },
    {
      name: 'SouthAmerica',
      polygon: [
        { lat: 12, lon: -81 }, { lat: 8, lon: -75 }, { lat: 4, lon: -70 },
        { lat: -5, lon: -74 }, { lat: -15, lon: -70 }, { lat: -30, lon: -60 },
        { lat: -45, lon: -63 }, { lat: -55, lon: -68 }, { lat: -55, lon: -75 },
        { lat: -35, lon: -80 }, { lat: -20, lon: -81 }, { lat: -5, lon: -82 },
        { lat: 2, lon: -80 },
      ],
    },
    {
      name: 'Africa',
      polygon: [
        { lat: 33, lon: -17 }, { lat: 36, lon: -5 }, { lat: 37, lon: 5 },
        { lat: 35, lon: 15 }, { lat: 33, lon: 24 }, { lat: 30, lon: 32 },
        { lat: 25, lon: 35 }, { lat: 12, lon: 44 }, { lat: -5, lon: 49 },
        { lat: -18, lon: 46 }, { lat: -30, lon: 34 }, { lat: -34, lon: 20 },
        { lat: -35, lon: 12 }, { lat: -26, lon: 5 }, { lat: -15, lon: 0 },
        { lat: -5, lon: -5 }, { lat: 6, lon: -10 }, { lat: 15, lon: -15 },
        { lat: 24, lon: -17 },
      ],
    },
    {
      name: 'Eurasia',
      polygon: [
        { lat: 35, lon: -10 }, { lat: 43, lon: -2 }, { lat: 50, lon: 5 },
        { lat: 52, lon: 15 }, { lat: 55, lon: 25 }, { lat: 60, lon: 38 },
        { lat: 65, lon: 55 }, { lat: 68, lon: 75 }, { lat: 66, lon: 100 },
        { lat: 62, lon: 120 }, { lat: 60, lon: 135 }, { lat: 55, lon: 150 },
        { lat: 48, lon: 160 }, { lat: 45, lon: 170 }, { lat: 40, lon: 178 },
        { lat: 30, lon: 170 }, { lat: 18, lon: 155 }, { lat: 10, lon: 135 },
        { lat: 5, lon: 115 }, { lat: -2, lon: 105 }, { lat: 5, lon: 95 },
        { lat: 12, lon: 85 }, { lat: 20, lon: 80 }, { lat: 25, lon: 70 },
        { lat: 30, lon: 60 }, { lat: 28, lon: 48 }, { lat: 32, lon: 40 },
        { lat: 38, lon: 32 }, { lat: 42, lon: 25 }, { lat: 40, lon: 15 },
        { lat: 37, lon: 5 },
      ],
    },
    {
      name: 'Australia',
      polygon: [
        { lat: -10, lon: 113 }, { lat: -24, lon: 113 }, { lat: -34, lon: 119 },
        { lat: -38, lon: 132 }, { lat: -36, lon: 147 }, { lat: -28, lon: 154 },
        { lat: -18, lon: 150 }, { lat: -11, lon: 140 },
      ],
    },
    {
      name: 'Greenland',
      polygon: [
        { lat: 82, lon: -72 }, { lat: 78, lon: -60 }, { lat: 70, lon: -45 },
        { lat: 62, lon: -37 }, { lat: 60, lon: -50 }, { lat: 68, lon: -60 },
        { lat: 74, lon: -65 }, { lat: 80, lon: -70 },
      ],
    },
  ];

  continents.forEach((shape) => generatePolygon(ctx, shape.polygon, width, height));

  // Madagascar
  ctx.beginPath();
  const madagascar = [
    { lat: -12, lon: 48 }, { lat: -18, lon: 50 }, { lat: -24, lon: 47 },
    { lat: -18, lon: 45 },
  ];
  madagascar.forEach((coord, index) => {
    const x = ((coord.lon + 180) / 360) * width;
    const y = ((90 - coord.lat) / 180) * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Antarctica ring
  ctx.fillStyle = '#69c6b7';
  ctx.strokeStyle = 'rgba(9, 37, 47, 0.9)';
  const antarctica = [];
  for (let i = 0; i <= 36; i++) {
    const lon = -180 + (i / 36) * 360;
    const lat = -70 - Math.sin((i / 36) * Math.PI * 2) * 4;
    antarctica.push({ lat, lon });
  }
  generatePolygon(ctx, antarctica, width, height);

  return canvasTex;
}

function createEarthTexture() {
  const canvasTex = generateEarthTextureCanvas();
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvasTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

function updateViewport() {
  if (!gl || !canvas || !containerRef) return;
  const dpr = window.devicePixelRatio || 1;
  const { clientWidth, clientHeight } = containerRef;
  const width = Math.max(1, clientWidth);
  const height = Math.max(1, clientHeight);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  gl.viewport(0, 0, canvas.width, canvas.height);
  mat4Perspective(
    projectionMatrix,
    Math.PI / 4,
    canvas.width / canvas.height,
    0.1,
    100,
  );
}

function updateCameraMatrices() {
  const phi = rotationX;
  const theta = rotationY;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  const eyeX = cameraRadius * sinPhi * cosTheta;
  const eyeY = cameraRadius * cosPhi;
  const eyeZ = cameraRadius * sinPhi * sinTheta;

  mat4LookAt(viewMatrix, [eyeX, eyeY, eyeZ], [0, 0, 0], [0, 1, 0]);

  mat4RotateY(modelMatrix, earthRotation);

  mat4Multiply(modelViewMatrix, viewMatrix, modelMatrix);
  const normalMat = new Float32Array(9);
  mat3FromMat4(normalMat, modelViewMatrix);
  mat3InvertTranspose(normalMatrix, normalMat);
}

function drawSphere() {
  if (!sphereProgram || !sphereBuffers) return;
  gl.useProgram(sphereProgram.program);

  gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffers.positionBuffer);
  gl.enableVertexAttribArray(sphereProgram.attributes.position);
  gl.vertexAttribPointer(sphereProgram.attributes.position, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffers.normalBuffer);
  gl.enableVertexAttribArray(sphereProgram.attributes.normal);
  gl.vertexAttribPointer(sphereProgram.attributes.normal, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffers.uvBuffer);
  gl.enableVertexAttribArray(sphereProgram.attributes.uv);
  gl.vertexAttribPointer(sphereProgram.attributes.uv, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereBuffers.indexBuffer);

  gl.uniformMatrix4fv(sphereProgram.uniforms.modelViewMatrix, false, modelViewMatrix);
  gl.uniformMatrix4fv(sphereProgram.uniforms.projectionMatrix, false, projectionMatrix);
  gl.uniformMatrix3fv(sphereProgram.uniforms.normalMatrix, false, normalMatrix);
  gl.uniform3fv(sphereProgram.uniforms.lightDirection, new Float32Array([-0.4, 0.5, 0.8]));
  const ambient = currentTheme === 'dark'
    ? new Float32Array([0.03, 0.05, 0.12, 1])
    : new Float32Array([0.08, 0.1, 0.18, 1]);
  gl.uniform4fv(sphereProgram.uniforms.ambient, ambient);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, earthTexture);
  gl.uniform1i(sphereProgram.uniforms.texture, 0);

  gl.drawElements(gl.TRIANGLES, sphereBuffers.indexCount, gl.UNSIGNED_SHORT, 0);

  gl.disableVertexAttribArray(sphereProgram.attributes.position);
  gl.disableVertexAttribArray(sphereProgram.attributes.normal);
  gl.disableVertexAttribArray(sphereProgram.attributes.uv);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
}

function drawLine(buffer, color, mode = gl.LINE_STRIP) {
  if (!buffer || !buffer.count) return;
  gl.useProgram(lineProgram.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
  gl.enableVertexAttribArray(lineProgram.attributes.position);
  gl.vertexAttribPointer(lineProgram.attributes.position, 3, gl.FLOAT, false, 0, 0);

  gl.uniformMatrix4fv(lineProgram.uniforms.modelViewMatrix, false, modelViewMatrix);
  gl.uniformMatrix4fv(lineProgram.uniforms.projectionMatrix, false, projectionMatrix);
  gl.uniform4fv(lineProgram.uniforms.color, color);

  if (gl.lineWidth) {
    gl.lineWidth(2);
  }
  gl.drawArrays(mode, 0, buffer.count);

  gl.disableVertexAttribArray(lineProgram.attributes.position);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

function drawPoints(buffer) {
  if (!buffer || !buffer.count) return;
  gl.useProgram(pointProgram.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
  const stride = 7 * Float32Array.BYTES_PER_ELEMENT;
  gl.enableVertexAttribArray(pointProgram.attributes.position);
  gl.vertexAttribPointer(pointProgram.attributes.position, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(pointProgram.attributes.color);
  gl.vertexAttribPointer(pointProgram.attributes.color, 3, gl.FLOAT, false, stride, 3 * Float32Array.BYTES_PER_ELEMENT);
  gl.enableVertexAttribArray(pointProgram.attributes.size);
  gl.vertexAttribPointer(pointProgram.attributes.size, 1, gl.FLOAT, false, stride, 6 * Float32Array.BYTES_PER_ELEMENT);

  gl.uniformMatrix4fv(pointProgram.uniforms.modelViewMatrix, false, modelViewMatrix);
  gl.uniformMatrix4fv(pointProgram.uniforms.projectionMatrix, false, projectionMatrix);

  gl.drawArrays(gl.POINTS, 0, buffer.count);

  gl.disableVertexAttribArray(pointProgram.attributes.position);
  gl.disableVertexAttribArray(pointProgram.attributes.color);
  gl.disableVertexAttribArray(pointProgram.attributes.size);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

function render(now = 0) {
  if (!gl || !ready) return;
  animationId = requestAnimationFrame(render);
  const delta = lastFrameTime ? (now - lastFrameTime) / 1000 : 0;
  lastFrameTime = now;
  earthRotation = (earthRotation + delta * ROTATION_SPEED) % (Math.PI * 2);

  updateViewport();
  updateCameraMatrices();

  const clearColor = currentTheme === 'dark'
    ? [0.02, 0.04, 0.09, 1]
    : [0.86, 0.9, 0.98, 1];
  gl.clearColor(...clearColor);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  drawSphere();
  drawLine(orbitBuffer, currentTheme === 'dark' ? new Float32Array([0.38, 0.72, 0.98, 0.85]) : new Float32Array([0.08, 0.36, 0.82, 0.85]));
  if (linkVisible) {
    drawLine(linkBuffer, currentTheme === 'dark' ? new Float32Array([0.98, 0.62, 0.3, 0.95]) : new Float32Array([0.84, 0.24, 0.15, 0.95]), gl.LINES);
  }
  drawPoints(stationBuffer);
  drawPoints(satelliteBuffer);
}

function resetData() {
  if (orbitBuffer) updateLineBuffer(orbitBuffer, new Float32Array(), 0);
  if (linkBuffer) updateLineBuffer(linkBuffer, new Float32Array(), 0);
  if (satelliteBuffer) updatePointBuffer(satelliteBuffer, new Float32Array(), 0);
  if (stationBuffer) updatePointBuffer(stationBuffer, new Float32Array(), 0);
  linkVisible = false;
}

function setupInteractions() {
  if (!canvas) return;
  canvas.addEventListener('pointerdown', (event) => {
    pointerState.active = true;
    pointerState.x = event.clientX;
    pointerState.y = event.clientY;
    pointerState.startRotX = rotationX;
    pointerState.startRotY = rotationY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!pointerState.active) return;
    const dx = event.clientX - pointerState.x;
    const dy = event.clientY - pointerState.y;
    rotationY = pointerState.startRotY + dx * 0.005;
    rotationX = clampRotationX(pointerState.startRotX + dy * 0.005);
  });

  canvas.addEventListener('pointerup', (event) => {
    pointerState.active = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  });

  canvas.addEventListener('pointerleave', () => {
    pointerState.active = false;
  });

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    cameraRadius = clamp(cameraRadius + event.deltaY * 0.0015, MIN_RADIUS, MAX_RADIUS);
  }, { passive: false });

  canvas.addEventListener('dblclick', () => {
    cameraRadius = 3.2;
  });
}

export async function initScene(container) {
  containerRef = container;
  if (!containerRef) return null;
  fallbackEl = containerRef.querySelector('#threeFallback');
  if (fallbackEl) fallbackEl.hidden = true;

  if (canvas?.parentElement === containerRef) {
    containerRef.removeChild(canvas);
  }

  canvas = document.createElement('canvas');
  canvas.className = 'globe-canvas';
  canvas.style.touchAction = 'none';
  containerRef.appendChild(canvas);

  gl = canvas.getContext('webgl', { antialias: true })
    || canvas.getContext('experimental-webgl', { antialias: true });

  if (!gl) {
    if (fallbackEl) {
      fallbackEl.hidden = false;
      fallbackEl.textContent = 'WebGL no está disponible en este navegador.';
    }
    return null;
  }

  try {
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.depthFunc(gl.LEQUAL);

    setupPrograms();
    sphereBuffers = createSphereBuffers();
    orbitBuffer = createLineBuffer();
    linkBuffer = createLineBuffer();
    satelliteBuffer = createPointBuffer();
    stationBuffer = createPointBuffer();
    earthTexture = createEarthTexture();

    resetData();
    setupInteractions();
    updateViewport();

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => updateViewport());
      resizeObserver.observe(containerRef);
    }
    windowResizeHandler = () => updateViewport();
    window.addEventListener('resize', windowResizeHandler);

    ready = true;
    lastFrameTime = 0;
    animationId = requestAnimationFrame(render);
  } catch (error) {
    console.error(error);
    ready = false;
    if (fallbackEl) {
      fallbackEl.hidden = false;
      fallbackEl.textContent = 'No se pudo inicializar la vista 3D.';
    }
    return null;
  }

  return { gl };
}

export function setTheme(theme) {
  currentTheme = theme === 'light' ? 'light' : 'dark';
}

export function updateOrbitPath(points) {
  if (!gl || !orbitBuffer) return;
  if (!points?.length) {
    updateLineBuffer(orbitBuffer, new Float32Array(), 0);
    return;
  }
  const closed = [...points, points[0]];
  const data = new Float32Array(closed.length * 3);
  closed.forEach((point, index) => {
    const [x, y, z] = latLonToVector(point.lat, point.lon, point.alt);
    data[index * 3] = x;
    data[index * 3 + 1] = y;
    data[index * 3 + 2] = z;
  });
  updateLineBuffer(orbitBuffer, data, closed.length);
}

export function updateSatellite(point) {
  if (!gl || !satelliteBuffer || !point) return;
  const [x, y, z] = latLonToVector(point.lat, point.lon, point.alt);
  satelliteData[0] = x;
  satelliteData[1] = y;
  satelliteData[2] = z;
  satelliteData[3] = 0.98;
  satelliteData[4] = 0.78;
  satelliteData[5] = 0.18;
  satelliteData[6] = 36;
  updatePointBuffer(satelliteBuffer, satelliteData, 1);
}

export function renderStations(stations, selectedId) {
  if (!gl || !stationBuffer) return;
  if (!stations?.length) {
    updatePointBuffer(stationBuffer, new Float32Array(), 0);
    stationData.array = new Float32Array(0);
    stationData.count = 0;
    return;
  }
  const data = new Float32Array(stations.length * 7);
  stations.forEach((station, idx) => {
    const [x, y, z] = latLonToVector(station.lat, station.lon, 0.02);
    const highlight = station.id === selectedId;
    data[idx * 7] = x;
    data[idx * 7 + 1] = y;
    data[idx * 7 + 2] = z;
    data[idx * 7 + 3] = highlight ? 0.98 : 0.18;
    data[idx * 7 + 4] = highlight ? 0.52 : 0.68;
    data[idx * 7 + 5] = highlight ? 0.2 : 0.95;
    data[idx * 7 + 6] = highlight ? 26 : 18;
  });
  stationData.array = data;
  stationData.count = stations.length;
  updatePointBuffer(stationBuffer, data, stations.length);
}

export function updateLink(point, station) {
  if (!gl || !linkBuffer) return;
  if (!point || !station) {
    linkVisible = false;
    updateLineBuffer(linkBuffer, new Float32Array(), 0);
    return;
  }
  const sat = latLonToVector(point.lat, point.lon, point.alt);
  const ground = latLonToVector(station.lat, station.lon, 0.02);
  linkData.set(ground, 0);
  linkData.set(sat, 3);
  updateLineBuffer(linkBuffer, linkData, 2);
  linkVisible = true;
}

export function disposeScene() {
  cancelAnimationFrame(animationId);
  animationId = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (windowResizeHandler) {
    window.removeEventListener('resize', windowResizeHandler);
    windowResizeHandler = null;
  }
  if (gl) {
    if (sphereBuffers) {
      if (sphereBuffers.positionBuffer) gl.deleteBuffer(sphereBuffers.positionBuffer);
      if (sphereBuffers.normalBuffer) gl.deleteBuffer(sphereBuffers.normalBuffer);
      if (sphereBuffers.uvBuffer) gl.deleteBuffer(sphereBuffers.uvBuffer);
      if (sphereBuffers.indexBuffer) gl.deleteBuffer(sphereBuffers.indexBuffer);
    }
    [orbitBuffer, linkBuffer, satelliteBuffer, stationBuffer].forEach((resource) => {
      if (!resource) return;
      if (resource.buffer) gl.deleteBuffer(resource.buffer);
    });
    if (earthTexture) gl.deleteTexture(earthTexture);
    if (sphereProgram?.program) gl.deleteProgram(sphereProgram.program);
    if (lineProgram?.program) gl.deleteProgram(lineProgram.program);
    if (pointProgram?.program) gl.deleteProgram(pointProgram.program);
  }
  sphereProgram = null;
  lineProgram = null;
  pointProgram = null;
  sphereBuffers = null;
  orbitBuffer = null;
  linkBuffer = null;
  satelliteBuffer = null;
  stationBuffer = null;
  earthTexture = null;
  gl = null;
  canvas = null;
  ready = false;
}

