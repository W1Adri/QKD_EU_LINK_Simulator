import { DEG2RAD, clamp } from './utils.js';

const EARTH_RADIUS_UNITS = 1;
const ALT_SCALE = 1 / 4000;

let containerRef;
let canvas;
let gl;
let animationId;
let resizeObserver;
let windowResizeHandler;

let sphereProgram;
let lineProgram;
let pointProgram;

let sphereBuffers = null;
let orbitBuffer = null;
let linkBuffer = null;
let linkVisible = false;
let satelliteBuffer = null;
let stationBuffer = null;

let sphereTexture = null;
let pixelRatio = 1;

let ready = false;
let showFallback;

let cameraRadius = 3.2;
let rotationX = 0.6;
let rotationY = 0.8;
let earthRotation = 0;
const MIN_RADIUS = 1.6;
const MAX_RADIUS = 8.0;

const projectionMatrix = new Float32Array(16);
const viewMatrix = new Float32Array(16);
const viewProjectionMatrix = new Float32Array(16);
const modelMatrix = new Float32Array(16);
const modelViewMatrix = new Float32Array(16);
const normalMatrix = new Float32Array(9);

const satelliteData = new Float32Array(7);
const stationsData = [];
const linkData = new Float32Array(6);

const themeColors = {
  dark: [0.0078, 0.012, 0.15, 1],
  light: [0.941, 0.956, 0.986, 1],
};
let currentTheme = 'dark';

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
    for (let x = 0; x <= segments; x++) {
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
    indices: new Uint32Array(indices),
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

  out[0] = b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30;
  out[1] = b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31;
  out[2] = b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32;
  out[3] = b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33;
  out[4] = b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30;
  out[5] = b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31;
  out[6] = b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32;
  out[7] = b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33;
  out[8] = b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30;
  out[9] = b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31;
  out[10] = b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32;
  out[11] = b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33;
  out[12] = b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30;
  out[13] = b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31;
  out[14] = b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32;
  out[15] = b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33;
  return out;
}

function mat4Perspective(out, fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(fovy / 2);
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
  out[14] = (2 * far * near) * nf;
  out[15] = 0;
  return out;
}

function mat4LookAt(out, eye, center, up) {
  let x0; let x1; let x2; let y0; let y1; let y2; let z0; let z1; let z2;

  const eyex = eye[0];
  const eyey = eye[1];
  const eyez = eye[2];
  const upx = up[0];
  const upy = up[1];
  const upz = up[2];
  const centerx = center[0];
  const centery = center[1];
  const centerz = center[2];

  if (
    Math.abs(eyex - centerx) < 1e-6 &&
    Math.abs(eyey - centery) < 1e-6 &&
    Math.abs(eyez - centerz) < 1e-6
  ) {
    return mat4Identity(out);
  }

  z0 = eyex - centerx;
  z1 = eyey - centery;
  z2 = eyez - centerz;

  let len = Math.hypot(z0, z1, z2);
  z0 /= len;
  z1 /= len;
  z2 /= len;

  x0 = upy * z2 - upz * z1;
  x1 = upz * z0 - upx * z2;
  x2 = upx * z1 - upy * z0;
  len = Math.hypot(x0, x1, x2);
  if (!len) {
    x0 = 0;
    x1 = 0;
    x2 = 0;
  } else {
    x0 /= len;
    x1 /= len;
    x2 /= len;
  }

  y0 = z1 * x2 - z2 * x1;
  y1 = z2 * x0 - z0 * x2;
  y2 = z0 * x1 - z1 * x0;

  len = Math.hypot(y0, y1, y2);
  if (!len) {
    y0 = 0;
    y1 = 0;
    y2 = 0;
  } else {
    y0 /= len;
    y1 /= len;
    y2 /= len;
  }

  out[0] = x0;
  out[1] = y0;
  out[2] = z0;
  out[3] = 0;
  out[4] = x1;
  out[5] = y1;
  out[6] = z1;
  out[7] = 0;
  out[8] = x2;
  out[9] = y2;
  out[10] = z2;
  out[11] = 0;
  out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
  out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
  out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
  out[15] = 1;
  return out;
}

function mat4RotateY(out, a, rad) {
  const s = Math.sin(rad);
  const c = Math.cos(rad);
  const a00 = a[0]; const a01 = a[1]; const a02 = a[2]; const a03 = a[3];
  const a10 = a[4]; const a11 = a[5]; const a12 = a[6]; const a13 = a[7];
  const a20 = a[8]; const a21 = a[9]; const a22 = a[10]; const a23 = a[11];

  out[0] = a00 * c + a20 * s;
  out[1] = a01 * c + a21 * s;
  out[2] = a02 * c + a22 * s;
  out[3] = a03 * c + a23 * s;
  out[8] = a20 * c - a00 * s;
  out[9] = a21 * c - a01 * s;
  out[10] = a22 * c - a02 * s;
  out[11] = a23 * c - a03 * s;
  out[4] = a10;
  out[5] = a11;
  out[6] = a12;
  out[7] = a13;
  out[12] = a[12];
  out[13] = a[13];
  out[14] = a[14];
  out[15] = a[15];
  return out;
}

function mat4RotateX(out, a, rad) {
  const s = Math.sin(rad);
  const c = Math.cos(rad);
  const a00 = a[0]; const a01 = a[1]; const a02 = a[2]; const a03 = a[3];
  const a20 = a[8]; const a21 = a[9]; const a22 = a[10]; const a23 = a[11];
  const a10 = a[4]; const a11 = a[5]; const a12 = a[6]; const a13 = a[7];

  out[4] = a10 * c + a20 * s;
  out[5] = a11 * c + a21 * s;
  out[6] = a12 * c + a22 * s;
  out[7] = a13 * c + a23 * s;
  out[8] = a20 * c - a10 * s;
  out[9] = a21 * c - a11 * s;
  out[10] = a22 * c - a12 * s;
  out[11] = a23 * c - a13 * s;
  out[0] = a00;
  out[1] = a01;
  out[2] = a02;
  out[3] = a03;
  out[12] = a[12];
  out[13] = a[13];
  out[14] = a[14];
  out[15] = a[15];
  return out;
}

function mat3FromMat4(out, mat4) {
  out[0] = mat4[0]; out[1] = mat4[1]; out[2] = mat4[2];
  out[3] = mat4[4]; out[4] = mat4[5]; out[5] = mat4[6];
  out[6] = mat4[8]; out[7] = mat4[9]; out[8] = mat4[10];
  return out;
}

function mat3InvertTranspose(out, mat3) {
  const a00 = mat3[0], a01 = mat3[1], a02 = mat3[2];
  const a10 = mat3[3], a11 = mat3[4], a12 = mat3[5];
  const a20 = mat3[6], a21 = mat3[7], a22 = mat3[8];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  let det = a00 * b01 + a01 * b11 + a02 * b21;

  if (!det) {
    out[0] = 1; out[1] = 0; out[2] = 0;
    out[3] = 0; out[4] = 1; out[5] = 0;
    out[6] = 0; out[7] = 0; out[8] = 1;
    return out;
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

function createEarthTexture() {
  const width = 1024;
  const height = 512;
  const texCanvas = document.createElement('canvas');
  texCanvas.width = width;
  texCanvas.height = height;
  const ctx = texCanvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#041226');
  gradient.addColorStop(0.5, '#0a3d66');
  gradient.addColorStop(1, '#041226');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const continents = [
    {
      color: '#3cb371',
      alpha: 0.92,
      outline: 'rgba(14, 94, 64, 0.45)',
      points: [
        [-168, 72], [-140, 70], [-124, 60], [-110, 50], [-100, 45], [-95, 40], [-100, 32],
        [-105, 25], [-110, 20], [-120, 24], [-128, 32], [-140, 40], [-150, 48], [-160, 60],
      ],
    },
    {
      color: '#3cb371',
      alpha: 0.92,
      outline: 'rgba(14, 94, 64, 0.45)',
      points: [
        [-82, 12], [-80, 20], [-76, 32], [-72, 40], [-70, 46], [-65, 50], [-60, 52],
        [-56, 50], [-50, 45], [-44, 40], [-40, 32], [-38, 22], [-42, 12], [-50, 6],
        [-60, 2], [-70, 0], [-78, 4],
      ],
    },
    {
      color: '#7fc768',
      alpha: 0.9,
      outline: 'rgba(50, 90, 40, 0.45)',
      points: [
        [-20, 60], [0, 68], [20, 70], [40, 64], [54, 60], [60, 48], [52, 36], [40, 28],
        [20, 24], [10, 20], [4, 32], [-4, 40], [-12, 48],
      ],
    },
    {
      color: '#5aa34f',
      alpha: 0.92,
      outline: 'rgba(28, 78, 45, 0.42)',
      points: [
        [12, 24], [20, 18], [26, 12], [32, 8], [38, 2], [40, -8], [36, -16], [28, -22],
        [18, -28], [8, -30], [-2, -32], [-10, -28], [-8, -12], [-2, 4],
      ],
    },
    {
      color: '#7fc768',
      alpha: 0.92,
      outline: 'rgba(36, 88, 50, 0.42)',
      points: [
        [60, 20], [70, 18], [82, 20], [96, 24], [110, 30], [120, 40], [126, 48], [132, 56],
        [140, 58], [150, 50], [160, 44], [168, 36], [170, 28], [162, 20], [150, 12],
        [140, 8], [128, 6], [116, 4], [104, 0], [92, -4], [84, -6], [74, -4], [66, 2],
      ],
    },
    {
      color: '#67b96e',
      alpha: 0.92,
      outline: 'rgba(25, 80, 45, 0.38)',
      points: [
        [44, -4], [52, -8], [62, -12], [74, -16], [84, -22], [94, -28], [104, -32],
        [114, -28], [118, -18], [120, -8], [118, 2], [110, 6], [100, 8], [90, 10],
        [80, 6], [70, 2], [60, 0],
      ],
    },
    {
      color: '#6cc174',
      alpha: 0.92,
      outline: 'rgba(20, 70, 40, 0.35)',
      points: [
        [40, -28], [50, -36], [60, -40], [70, -42], [80, -40], [90, -38], [100, -36],
        [108, -32], [112, -26], [114, -18], [110, -12], [100, -10], [90, -12], [80, -14],
        [70, -16], [58, -18], [48, -22],
      ],
    },
    {
      color: '#4ea85c',
      alpha: 0.94,
      outline: 'rgba(16, 68, 32, 0.4)',
      points: [
        [18, -32], [20, -40], [24, -48], [30, -56], [38, -62], [46, -64], [54, -62],
        [60, -56], [64, -48], [62, -40], [56, -32], [48, -28], [36, -26], [26, -28],
      ],
    },
    {
      color: '#3cb371',
      alpha: 0.88,
      outline: 'rgba(14, 94, 64, 0.45)',
      points: [
        [132, 56], [142, 54], [152, 52], [160, 48], [166, 44], [170, 36], [164, 32],
        [154, 30], [144, 28], [136, 30], [132, 36],
      ],
    },
    {
      color: '#4eaf63',
      alpha: 0.9,
      outline: 'rgba(20, 60, 34, 0.42)',
      points: [
        [132, 16], [138, 20], [144, 24], [150, 22], [156, 18], [160, 12], [156, 6],
        [148, 2], [138, 4], [132, 10],
      ],
    },
  ];

  const toXY = (lon, lat) => [
    ((lon + 180) / 360) * width,
    ((90 - lat) / 180) * height,
  ];

  continents.forEach((continent) => {
    ctx.beginPath();
    continent.points.forEach(([lon, lat], index) => {
      const [x, y] = toXY(lon, lat);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = continent.color;
    ctx.globalAlpha = continent.alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (continent.outline) {
      ctx.strokeStyle = continent.outline;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });

  ctx.globalAlpha = 0.2;
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#0f3050';
  for (let lon = -180; lon <= 180; lon += 30) {
    ctx.beginPath();
    const [x] = toXY(lon, 0);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.beginPath();
    const [, y] = toXY(0, lat);
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texCanvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

function createSphereBuffers() {
  const geometry = createSphereGeometry();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const uvBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);

  return {
    vao,
    indexBuffer,
    positionBuffer,
    normalBuffer,
    uvBuffer,
    indexCount: geometry.indices.length,
  };
}

function createLineBuffer() {
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, buffer, count: 0 };
}

function createPointBuffer() {
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
  gl.bindVertexArray(null);
  return { vao, buffer, count: 0 };
}

function updatePointBuffer(dataArray, count) {
  if (!gl || !satelliteBuffer) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, satelliteBuffer.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, dataArray, gl.DYNAMIC_DRAW);
  satelliteBuffer.count = count;
}

function updateStationBuffer(dataArray, count) {
  if (!gl || !stationBuffer) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, stationBuffer.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, dataArray, gl.DYNAMIC_DRAW);
  stationBuffer.count = count;
}

function updateLineBuffer(target, data, count) {
  gl.bindBuffer(gl.ARRAY_BUFFER, target.buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  target.count = count;
}

function setupPrograms() {
  const sphereVertex = `#version 300 es
    layout(location=0) in vec3 aPosition;
    layout(location=1) in vec3 aNormal;
    layout(location=2) in vec2 aUv;

    uniform mat4 uProjection;
    uniform mat4 uModelView;
    uniform mat3 uNormalMatrix;

    out vec3 vNormal;
    out vec2 vUv;
    out vec3 vPosition;

    void main() {
      vec4 mvPosition = uModelView * vec4(aPosition, 1.0);
      vPosition = mvPosition.xyz;
      vNormal = normalize(uNormalMatrix * aNormal);
      vUv = aUv;
      gl_Position = uProjection * mvPosition;
    }
  `;

  const sphereFragment = `#version 300 es
    precision highp float;
    in vec3 vNormal;
    in vec2 vUv;
    in vec3 vPosition;

    uniform sampler2D uTexture;
    uniform vec3 uLightDirection;

    out vec4 fragColor;

    void main() {
      vec3 normal = normalize(vNormal);
      vec3 lightDir = normalize(uLightDirection);
      float diffuse = max(dot(normal, lightDir), 0.0);
      float rim = pow(1.0 - max(dot(normal, normalize(-vPosition)), 0.0), 3.0);
      vec3 texColor = texture(uTexture, vUv).rgb;
      vec3 color = texColor * (0.25 + 0.75 * diffuse) + vec3(0.1, 0.14, 0.18) * rim;
      fragColor = vec4(color, 1.0);
    }
  `;

  const lineVertex = `#version 300 es
    layout(location=0) in vec3 aPosition;
    uniform mat4 uViewProjection;
    uniform mat4 uModel;
    void main() {
      gl_Position = uViewProjection * (uModel * vec4(aPosition, 1.0));
    }
  `;

  const lineFragment = `#version 300 es
    precision mediump float;
    uniform vec3 uColor;
    out vec4 fragColor;
    void main() {
      fragColor = vec4(uColor, 1.0);
    }
  `;

  const pointVertex = `#version 300 es
    layout(location=0) in vec3 aPosition;
    layout(location=1) in vec3 aColor;
    layout(location=2) in float aSize;

    uniform mat4 uViewProjection;
    uniform mat4 uModel;
    uniform float uPixelRatio;

    out vec3 vColor;

    void main() {
      vec4 worldPos = uModel * vec4(aPosition, 1.0);
      vec4 clip = uViewProjection * worldPos;
      gl_Position = clip;
      float size = aSize / max(clip.w, 0.0001);
      gl_PointSize = size * uPixelRatio;
      vColor = aColor;
    }
  `;

  const pointFragment = `#version 300 es
    precision mediump float;
    in vec3 vColor;
    out vec4 fragColor;

    void main() {
      vec2 uv = gl_PointCoord * 2.0 - 1.0;
      float d = dot(uv, uv);
      if (d > 1.0) {
        discard;
      }
      float alpha = smoothstep(1.0, 0.7, d);
      fragColor = vec4(vColor, alpha);
    }
  `;

  sphereProgram = createProgram(sphereVertex, sphereFragment);
  lineProgram = createProgram(lineVertex, lineFragment);
  pointProgram = createProgram(pointVertex, pointFragment);
}

function updateViewport() {
  if (!canvas || !containerRef || !gl) return;
  const width = Math.max(1, containerRef.clientWidth);
  const height = Math.max(1, containerRef.clientHeight);
  const dpr = window.devicePixelRatio || 1;
  pixelRatio = dpr;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  gl.viewport(0, 0, canvas.width, canvas.height);
  mat4Perspective(projectionMatrix, (48 * DEG2RAD), width / height, 0.1, 100);
}

function setupInteractions() {
  let pointerActive = false;
  let lastX = 0;
  let lastY = 0;

  const handlePointerDown = (event) => {
    pointerActive = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event) => {
    if (!pointerActive) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    rotationY += dx * 0.005;
    rotationX += dy * 0.005;
    rotationX = clamp(rotationX, -Math.PI / 2 + 0.1, Math.PI / 2 - 0.1);
  };

  const handlePointerUp = (event) => {
    pointerActive = false;
    canvas.releasePointerCapture(event.pointerId);
  };

  const handleWheel = (event) => {
    event.preventDefault();
    cameraRadius = clamp(cameraRadius + event.deltaY * 0.0025, MIN_RADIUS, MAX_RADIUS);
  };

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointercancel', handlePointerUp);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
}

function drawScene() {
  if (!gl || !ready) return;
  const clearColor = themeColors[currentTheme] || themeColors.dark;
  gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const eye = [
    cameraRadius * Math.cos(rotationX) * Math.sin(rotationY),
    cameraRadius * Math.sin(rotationX),
    cameraRadius * Math.cos(rotationX) * Math.cos(rotationY),
  ];

  mat4LookAt(viewMatrix, eye, [0, 0, 0], [0, 1, 0]);
  mat4Identity(modelMatrix);
  mat4RotateY(modelMatrix, modelMatrix, earthRotation);
  mat4RotateX(modelMatrix, modelMatrix, 0.4091);
  mat4Multiply(modelViewMatrix, viewMatrix, modelMatrix);
  mat4Multiply(viewProjectionMatrix, projectionMatrix, viewMatrix);

  mat3FromMat4(normalMatrix, modelViewMatrix);
  mat3InvertTranspose(normalMatrix, normalMatrix);

  gl.useProgram(sphereProgram);
  gl.bindVertexArray(sphereBuffers.vao);
  gl.uniformMatrix4fv(gl.getUniformLocation(sphereProgram, 'uProjection'), false, projectionMatrix);
  gl.uniformMatrix4fv(gl.getUniformLocation(sphereProgram, 'uModelView'), false, modelViewMatrix);
  gl.uniformMatrix3fv(gl.getUniformLocation(sphereProgram, 'uNormalMatrix'), false, normalMatrix);
  gl.uniform3f(gl.getUniformLocation(sphereProgram, 'uLightDirection'), -0.6, 0.5, 0.6);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sphereTexture);
  gl.uniform1i(gl.getUniformLocation(sphereProgram, 'uTexture'), 0);
  gl.drawElements(gl.TRIANGLES, sphereBuffers.indexCount, gl.UNSIGNED_INT, 0);

  gl.useProgram(lineProgram);
  gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, 'uViewProjection'), false, viewProjectionMatrix);
  gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, 'uModel'), false, modelMatrix);
  if (orbitBuffer.count > 1) {
    gl.bindVertexArray(orbitBuffer.vao);
    gl.uniform3f(gl.getUniformLocation(lineProgram, 'uColor'), 0.49, 0.23, 0.93);
    gl.drawArrays(gl.LINE_STRIP, 0, orbitBuffer.count);
  }
  if (linkVisible && linkBuffer.count === 2) {
    gl.bindVertexArray(linkBuffer.vao);
    gl.uniform3f(gl.getUniformLocation(lineProgram, 'uColor'), 0.22, 0.74, 0.97);
    gl.drawArrays(gl.LINE_STRIP, 0, 2);
  }

  gl.useProgram(pointProgram);
  gl.uniformMatrix4fv(gl.getUniformLocation(pointProgram, 'uViewProjection'), false, viewProjectionMatrix);
  gl.uniformMatrix4fv(gl.getUniformLocation(pointProgram, 'uModel'), false, modelMatrix);
  gl.uniform1f(gl.getUniformLocation(pointProgram, 'uPixelRatio'), pixelRatio);

  if (stationBuffer.count > 0) {
    gl.bindVertexArray(stationBuffer.vao);
    gl.drawArrays(gl.POINTS, 0, stationBuffer.count);
  }

  if (satelliteBuffer.count > 0) {
    gl.bindVertexArray(satelliteBuffer.vao);
    gl.drawArrays(gl.POINTS, 0, satelliteBuffer.count);
  }

  earthRotation += 0.0005;
  if (earthRotation > Math.PI * 2) {
    earthRotation -= Math.PI * 2;
  }
}

function renderLoop() {
  drawScene();
  animationId = requestAnimationFrame(renderLoop);
}

function resetData() {
  linkVisible = false;
  earthRotation = 0;
  rotationX = 0.6;
  rotationY = 0.8;
  cameraRadius = 3.2;
  if (orbitBuffer) updateLineBuffer(orbitBuffer, new Float32Array(), 0);
  if (linkBuffer) {
    linkVisible = false;
    updateLineBuffer(linkBuffer, new Float32Array(), 0);
  }
  if (satelliteBuffer) updatePointBuffer(new Float32Array(), 0);
  if (stationBuffer) updateStationBuffer(new Float32Array(), 0);
}

export async function initScene(container) {
  containerRef = container;
  if (!containerRef) return null;
  showFallback = containerRef.querySelector('#threeFallback');
  if (showFallback) {
    showFallback.hidden = true;
  }

  if (canvas?.parentElement === containerRef) {
    containerRef.removeChild(canvas);
  }

  canvas = document.createElement('canvas');
  canvas.className = 'globe-canvas';
  canvas.style.touchAction = 'none';
  containerRef.appendChild(canvas);

  gl = canvas.getContext('webgl2', { antialias: true });

  if (!gl) {
    if (showFallback) {
      showFallback.hidden = false;
      showFallback.textContent = 'WebGL 2 no está disponible en este navegador.';
    }
    return null;
  }

  try {
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.cullFace(gl.BACK);
    setupPrograms();
    sphereBuffers = createSphereBuffers();
    orbitBuffer = createLineBuffer();
    linkBuffer = createLineBuffer();
    satelliteBuffer = createPointBuffer();
    stationBuffer = createPointBuffer();
    sphereTexture = createEarthTexture();
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
    renderLoop();
  } catch (error) {
    console.error(error);
    ready = false;
    if (showFallback) {
      showFallback.hidden = false;
      showFallback.textContent = 'No se pudo inicializar la vista 3D.';
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
  if (!gl || !point || !satelliteBuffer) return;
  const [x, y, z] = latLonToVector(point.lat, point.lon, point.alt);
  satelliteData[0] = x;
  satelliteData[1] = y;
  satelliteData[2] = z;
  satelliteData[3] = 1.0;
  satelliteData[4] = 0.56;
  satelliteData[5] = 0.18;
  satelliteData[6] = 36;
  updatePointBuffer(satelliteData, 1);
}

export function renderStations(stations, selectedId) {
  if (!gl || !stationBuffer) return;
  if (!stations?.length) {
    updateStationBuffer(new Float32Array(), 0);
    stationsData.length = 0;
    return;
  }
  stationsData.length = 0;
  stations.forEach((station) => {
    const [x, y, z] = latLonToVector(station.lat, station.lon, 0.02);
    const highlight = station.id === selectedId;
    stationsData.push(
      x,
      y,
      z,
      highlight ? 0.98 : 0.09,
      highlight ? 0.85 : 0.65,
      highlight ? 0.22 : 0.9,
      highlight ? 28 : 18,
    );
  });
  updateStationBuffer(new Float32Array(stationsData), stations.length);
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
      if (sphereBuffers.vao) gl.deleteVertexArray(sphereBuffers.vao);
      if (sphereBuffers.indexBuffer) gl.deleteBuffer(sphereBuffers.indexBuffer);
      if (sphereBuffers.positionBuffer) gl.deleteBuffer(sphereBuffers.positionBuffer);
      if (sphereBuffers.normalBuffer) gl.deleteBuffer(sphereBuffers.normalBuffer);
      if (sphereBuffers.uvBuffer) gl.deleteBuffer(sphereBuffers.uvBuffer);
    }
    [orbitBuffer, linkBuffer, satelliteBuffer, stationBuffer].forEach((resource) => {
      if (!resource) return;
      if (resource.vao) gl.deleteVertexArray(resource.vao);
      if (resource.buffer) gl.deleteBuffer(resource.buffer);
    });
    if (sphereTexture) gl.deleteTexture(sphereTexture);
    if (sphereProgram) gl.deleteProgram(sphereProgram);
    if (lineProgram) gl.deleteProgram(lineProgram);
    if (pointProgram) gl.deleteProgram(pointProgram);
  }
  sphereProgram = null;
  lineProgram = null;
  pointProgram = null;
  sphereBuffers = null;
  orbitBuffer = null;
  linkBuffer = null;
  satelliteBuffer = null;
  stationBuffer = null;
  sphereTexture = null;
  gl = null;
  canvas = null;
  ready = false;
}
