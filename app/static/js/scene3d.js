import { DEG2RAD } from './utils.js';

const EARTH_RADIUS_UNITS = 1;
const ALTITUDE_SCALE = 1 / 4000;
const CAMERA_DISTANCE_MIN = 1.6;
const CAMERA_DISTANCE_MAX = 9;
const CAMERA_DEFAULT_DISTANCE = 3.5;
const CAMERA_DEFAULT_LAT = 20 * DEG2RAD;
const CAMERA_DEFAULT_LON = 35 * DEG2RAD;
const EARTH_ROTATION_RATE = 0.12;
const ORBIT_FADE_SECONDS = 1.2;

let containerEl;
let fallbackEl;
let canvas;
let gl;

let animationFrameId = null;
let resizeObserver = null;
let lastTimestamp = 0;
let theme = 'dark';

let cameraLon = CAMERA_DEFAULT_LON;
let cameraLat = CAMERA_DEFAULT_LAT;
let cameraDistance = CAMERA_DEFAULT_DISTANCE;
const cameraTarget = [0, 0, 0];

let dragging = false;
let dragStart = null;
let touchDistance = null;

let earthRotation = 0;

let projectionMatrix;
let viewMatrix;
let viewProjectionMatrix;
let inverseViewMatrix;

let earthProgram;
let atmosphereProgram;
let solidProgram;
let lineProgram;

let sphereGeometry;
let lowResSphereGeometry;

let earthTexture;

let orbitBuffer;
let orbitVertexCount = 0;
let orbitUpdatedAt = 0;

let linkBuffer;
let linkVisible = false;

let stationTransforms = [];
let stationColors = [];
let selectedStationId = null;

let satelliteTransform = null;

const tempMatrix = createIdentityMat4();
const tempMatrix2 = createIdentityMat4();
const normalMatrix3 = new Float32Array(9);
const IDENTITY_MATRIX = createIdentityMat4();

const LIGHT_DIRECTION = normalise([1, 0.6, 0.8]);
const SECONDARY_LIGHT_DIRECTION = normalise([-0.4, -0.3, -1]);

function createIdentityMat4() {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

function copyMat4(out, matrix) {
  for (let i = 0; i < 16; i += 1) out[i] = matrix[i];
  return out;
}

function multiplyMat4(out, a, b) {
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

function invertMat4(out, m) {
  const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3];
  const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7];
  const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11];
  const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15];

  const tmp0 = m22 * m33 - m23 * m32;
  const tmp1 = m21 * m33 - m23 * m31;
  const tmp2 = m21 * m32 - m22 * m31;
  const tmp3 = m20 * m33 - m23 * m30;
  const tmp4 = m20 * m32 - m22 * m30;
  const tmp5 = m20 * m31 - m21 * m30;

  const det = m00 * (m11 * tmp0 - m12 * tmp1 + m13 * tmp2)
    - m01 * (m10 * tmp0 - m12 * tmp3 + m13 * tmp4)
    + m02 * (m10 * tmp1 - m11 * tmp3 + m13 * tmp5)
    - m03 * (m10 * tmp2 - m11 * tmp4 + m12 * tmp5);

  if (!det) return null;
  const invDet = 1 / det;

  out[0] = (m11 * tmp0 - m12 * tmp1 + m13 * tmp2) * invDet;
  out[1] = (m02 * tmp1 - m01 * tmp0 - m03 * tmp2) * invDet;
  out[2] = (m31 * (m02 * m13 - m03 * m12) - m32 * (m01 * m13 - m03 * m11) + m33 * (m01 * m12 - m02 * m11)) * invDet;
  out[3] = (m21 * (m03 * m12 - m02 * m13) + m22 * (m01 * m13 - m03 * m11) + m23 * (m02 * m11 - m01 * m12)) * invDet;

  out[4] = (m12 * tmp3 - m10 * tmp0 - m13 * tmp4) * invDet;
  out[5] = (m00 * tmp0 - m02 * tmp3 + m03 * tmp4) * invDet;
  out[6] = (m32 * (m00 * m13 - m03 * m10) - m33 * (m00 * m12 - m02 * m10) + m30 * (m02 * m13 - m03 * m12)) * invDet;
  out[7] = (m22 * (m03 * m10 - m00 * m13) + m23 * (m00 * m12 - m02 * m10) + m20 * (m03 * m12 - m02 * m13)) * invDet;

  out[8] = (m10 * tmp1 - m11 * tmp3 + m13 * tmp5) * invDet;
  out[9] = (m01 * tmp3 - m00 * tmp1 - m03 * tmp5) * invDet;
  out[10] = (m33 * (m00 * m11 - m01 * m10) - m30 * (m01 * m13 - m03 * m11) + m31 * (m03 * m10 - m00 * m13)) * invDet;
  out[11] = (m23 * (m01 * m10 - m00 * m11) + m20 * (m01 * m13 - m03 * m11) + m21 * (m00 * m13 - m03 * m10)) * invDet;

  out[12] = (m11 * tmp4 - m10 * tmp2 - m12 * tmp5) * invDet;
  out[13] = (m00 * tmp2 - m01 * tmp4 + m02 * tmp5) * invDet;
  out[14] = (m30 * (m01 * m12 - m02 * m11) - m31 * (m00 * m12 - m02 * m10) + m32 * (m00 * m11 - m01 * m10)) * invDet;
  out[15] = (m20 * (m02 * m11 - m01 * m12) + m21 * (m00 * m12 - m02 * m10) + m22 * (m01 * m10 - m00 * m11)) * invDet;
  return out;
}
  const tmp2 = m21 * m32 - m22 * m31;
  const tmp3 = m20 * m33 - m23 * m30;
  const tmp4 = m20 * m32 - m22 * m30;
  const tmp5 = m20 * m31 - m21 * m30;

  const det = m00 * (m11 * tmp0 - m12 * tmp1 + m13 * tmp2)
    - m01 * (m10 * tmp0 - m12 * tmp3 + m13 * tmp4)
    + m02 * (m10 * tmp1 - m11 * tmp3 + m13 * tmp5)
    - m03 * (m10 * tmp2 - m11 * tmp4 + m12 * tmp5);

  if (!det) return null;
  const invDet = 1 / det;

  out[0] = (m11 * tmp0 - m12 * tmp1 + m13 * tmp2) * invDet;
  out[1] = (m02 * tmp1 - m01 * tmp0 - m03 * tmp2) * invDet;
  out[2] = (m31 * (m02 * m13 - m03 * m12) - m32 * (m01 * m13 - m03 * m11) + m33 * (m01 * m12 - m02 * m11)) * invDet;
  out[3] = (m21 * (m03 * m12 - m02 * m13) + m22 * (m01 * m13 - m03 * m11) + m23 * (m02 * m11 - m01 * m12)) * invDet;

  out[4] = (m12 * tmp3 - m10 * tmp0 - m13 * tmp4) * invDet;
  out[5] = (m00 * tmp0 - m02 * tmp3 + m03 * tmp4) * invDet;
  out[6] = (m32 * (m00 * m13 - m03 * m10) - m33 * (m00 * m12 - m02 * m10) + m30 * (m02 * m13 - m03 * m12)) * invDet;
  out[7] = (m22 * (m03 * m10 - m00 * m13) + m23 * (m00 * m12 - m02 * m10) + m20 * (m03 * m12 - m02 * m13)) * invDet;

  out[8] = (m10 * tmp1 - m11 * tmp3 + m13 * tmp5) * invDet;
  out[9] = (m01 * tmp3 - m00 * tmp1 - m03 * tmp5) * invDet;
  out[10] = (m33 * (m00 * m11 - m01 * m10) - m30 * (m01 * m13 - m03 * m11) + m31 * (m03 * m10 - m00 * m13)) * invDet;
  out[11] = (m23 * (m01 * m10 - m00 * m11) + m20 * (m01 * m13 - m03 * m11) + m21 * (m00 * m13 - m03 * m10)) * invDet;

  out[12] = (m11 * tmp4 - m10 * tmp2 - m12 * tmp5) * invDet;
  out[13] = (m00 * tmp2 - m01 * tmp4 + m02 * tmp5) * invDet;
  out[14] = (m30 * (m01 * m12 - m02 * m11) - m31 * (m00 * m12 - m02 * m10) + m32 * (m00 * m11 - m01 * m10)) * invDet;
  out[15] = (m20 * (m02 * m11 - m01 * m12) + m21 * (m00 * m12 - m02 * m10) + m22 * (m01 * m10 - m00 * m11)) * invDet;
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
  out[14] = 2 * far * near * nf;
  out[15] = 0;
  return out;
}

function mat4LookAt(out, eye, center, up) {
  const zx = eye[0] - center[0];
  const zy = eye[1] - center[1];
  const zz = eye[2] - center[2];

  let len = Math.hypot(zx, zy, zz);
  let zxN = zx;
  let zyN = zy;
  let zzN = zz;
  if (!len) {
    zzN = 1;
    len = 1;
  }
  zxN /= len;
  zyN /= len;
  zzN /= len;

  let xx = up[1] * zzN - up[2] * zyN;
  let xy = up[2] * zxN - up[0] * zzN;
  let xz = up[0] * zyN - up[1] * zxN;
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

  let yx = zyN * xz - zzN * xy;
  let yy = zzN * xx - zxN * xz;
  let yz = zxN * xy - zyN * xx;
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
  out[2] = zxN;
  out[3] = 0;
  out[4] = xy;
  out[5] = yy;
  out[6] = zyN;
  out[7] = 0;
  out[8] = xz;
  out[9] = yz;
  out[10] = zzN;
  out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zxN * eye[0] + zyN * eye[1] + zzN * eye[2]);
  out[15] = 1;
  return out;
}

function mat3FromMat4(out, m) {
  out[0] = m[0];
  out[1] = m[1];
  out[2] = m[2];
  out[3] = m[4];
  out[4] = m[5];
  out[5] = m[6];
  out[6] = m[8];
  out[7] = m[9];
  out[8] = m[10];
  return out;
}

function invertMat3(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[3], a11 = m[4], a12 = m[5];
  const a20 = m[6], a21 = m[7], a22 = m[8];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  let det = a00 * b01 + a01 * b11 + a02 * b21;
  if (!det) return null;
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

function transposeMat3(out, m) {
  const a01 = m[1], a02 = m[2];
  const a12 = m[5];
  out[1] = m[3];
  out[2] = m[6];
  out[3] = a01;
  out[5] = m[7];
  out[6] = a02;
  out[7] = a12;
  if (out !== m) {
    out[0] = m[0];
    out[4] = m[4];
    out[8] = m[8];
  }
  return out;
}

function translateMat4(out, matrix, v) {
  const x = v[0], y = v[1], z = v[2];
  if (matrix === out) {
    out[12] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    out[13] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    out[14] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
    out[15] = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  } else {
    for (let i = 0; i < 12; i += 1) out[i] = matrix[i];
    out[12] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    out[13] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    out[14] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
    out[15] = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  }
  return out;
}

function scaleMat4(out, matrix, v) {
  const x = v[0], y = v[1], z = v[2];
  out[0] = matrix[0] * x;
  out[1] = matrix[1] * x;
  out[2] = matrix[2] * x;
  out[3] = matrix[3] * x;
  out[4] = matrix[4] * y;
  out[5] = matrix[5] * y;
  out[6] = matrix[6] * y;
  out[7] = matrix[7] * y;
  out[8] = matrix[8] * z;
  out[9] = matrix[9] * z;
  out[10] = matrix[10] * z;
  out[11] = matrix[11] * z;
  out[12] = matrix[12];
  out[13] = matrix[13];
  out[14] = matrix[14];
  out[15] = matrix[15];
  return out;
}

function rotateY(out, matrix, radians) {
  const s = Math.sin(radians);
  const c = Math.cos(radians);
  const m00 = matrix[0], m01 = matrix[1], m02 = matrix[2], m03 = matrix[3];
  const m20 = matrix[8], m21 = matrix[9], m22 = matrix[10], m23 = matrix[11];
  out[0] = m00 * c - m20 * s;
  out[1] = m01 * c - m21 * s;
  out[2] = m02 * c - m22 * s;
  out[3] = m03 * c - m23 * s;
  out[8] = m00 * s + m20 * c;
  out[9] = m01 * s + m21 * c;
  out[10] = m02 * s + m22 * c;
  out[11] = m03 * s + m23 * c;
  out[4] = matrix[4];
  out[5] = matrix[5];
  out[6] = matrix[6];
  out[7] = matrix[7];
  out[12] = matrix[12];
  out[13] = matrix[13];
  out[14] = matrix[14];
  out[15] = matrix[15];
  return out;
}

function normalise(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!len) return v;
  v[0] /= len;
  v[1] /= len;
  v[2] /= len;
  return v;
}

function latLonAltToCartesian(latDeg, lonDeg, altKm = 0) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const radius = EARTH_RADIUS_UNITS + altKm * ALTITUDE_SCALE;
  const cosLat = Math.cos(lat);
  return [
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    radius * cosLat * Math.sin(lon),
  ];
}

function ensureFallback(message) {
  if (!fallbackEl) return;
  if (message) {
    fallbackEl.hidden = false;
    fallbackEl.textContent = message;
  } else {
    fallbackEl.hidden = true;
  }
}
function createShader(glContext, type, source) {
  const shader = glContext.createShader(type);
  glContext.shaderSource(shader, source);
  glContext.compileShader(shader);
  if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
    console.error('Error al compilar shader', glContext.getShaderInfoLog(shader));
    glContext.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(glContext, vertexSource, fragmentSource) {
  const vertexShader = createShader(glContext, glContext.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(glContext, glContext.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return null;
  const program = glContext.createProgram();
  glContext.attachShader(program, vertexShader);
  glContext.attachShader(program, fragmentShader);
  glContext.linkProgram(program);
  if (!glContext.getProgramParameter(program, glContext.LINK_STATUS)) {
    console.error('Error al enlazar programa', glContext.getProgramInfoLog(program));
    glContext.deleteProgram(program);
    return null;
  }
  return program;
}

function createSphereGeometry(segments = 128, rings = 64) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let y = 0; y <= rings; y += 1) {
    const v = y / rings;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let x = 0; x <= segments; x += 1) {
      const u = x / segments;
      const phi = u * 2 * Math.PI;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const vx = cosPhi * sinTheta;
      const vy = cosTheta;
      const vz = sinPhi * sinTheta;

      positions.push(vx, vy, vz);
      normals.push(vx, vy, vz);
      uvs.push(u, 1 - v);
    }
  }

  for (let y = 0; y < rings; y += 1) {
    for (let x = 0; x < segments; x += 1) {
      const first = y * (segments + 1) + x;
      const second = first + segments + 1;
      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}

function createLowResSphereGeometry() {
  return createSphereGeometry(32, 24);
}

function createTexture(glContext, canvasTexture) {
  const texture = glContext.createTexture();
  glContext.bindTexture(glContext.TEXTURE_2D, texture);
  glContext.texImage2D(glContext.TEXTURE_2D, 0, glContext.RGBA, glContext.RGBA, glContext.UNSIGNED_BYTE, canvasTexture);
  glContext.generateMipmap(glContext.TEXTURE_2D);
  glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MIN_FILTER, glContext.LINEAR_MIPMAP_LINEAR);
  glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_MAG_FILTER, glContext.LINEAR);
  glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_S, glContext.REPEAT);
  glContext.texParameteri(glContext.TEXTURE_2D, glContext.TEXTURE_WRAP_T, glContext.CLAMP_TO_EDGE);
  glContext.bindTexture(glContext.TEXTURE_2D, null);
  return texture;
}

function generateEarthCanvas(size = 2048) {
  const canvasTexture = document.createElement('canvas');
  canvasTexture.width = size;
  canvasTexture.height = size / 2;
  const ctx = canvasTexture.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, canvasTexture.height);
  gradient.addColorStop(0, '#001020');
  gradient.addColorStop(1, '#03457b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasTexture.width, canvasTexture.height);

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#0a2854';
  for (let i = 0; i < 1400; i += 1) {
    const x = Math.random() * canvasTexture.width;
    const y = Math.random() * canvasTexture.height;
    const r = Math.random() * 1.3 + 0.25;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();

  const continents = createContinents();
  continents.forEach(({ color, outline, shadow }) => {
    ctx.beginPath();
    outline.forEach(([lat, lon], index) => {
      const [px, py] = latLonToCanvas(lat, lon, canvasTexture.width, canvasTexture.height);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (shadow) {
      ctx.strokeStyle = shadow;
      ctx.lineWidth = size / 1200;
      ctx.stroke();
    }
  });

  ctx.lineWidth = size / 1300;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.globalAlpha = 0.9;
  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.beginPath();
    const [startX, startY] = latLonToCanvas(lat, -180, canvasTexture.width, canvasTexture.height);
    ctx.moveTo(startX, startY);
    const [endX, endY] = latLonToCanvas(lat, 180, canvasTexture.width, canvasTexture.height);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }
  for (let lon = -180; lon <= 180; lon += 30) {
    ctx.beginPath();
    const [topX, topY] = latLonToCanvas(80, lon, canvasTexture.width, canvasTexture.height);
    const [bottomX, bottomY] = latLonToCanvas(-80, lon, canvasTexture.width, canvasTexture.height);
    ctx.moveTo(topX, topY);
    ctx.lineTo(bottomX, bottomY);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  return canvasTexture;
}

function createContinents() {
  const shapes = [];
  const pushRegion = (points, color = '#2fa260', shadow = 'rgba(0,0,0,0.18)') => {
    shapes.push({ outline: points, color, shadow });
  };

  pushRegion([
    [72, -170], [70, -150], [68, -136], [63, -120], [58, -105], [55, -92], [52, -76], [49, -58],
    [45, -40], [42, -22], [41, -10], [40, 2], [36, 12], [30, 28], [24, 38], [18, 54], [14, 70],
    [12, 90], [18, 110], [24, 130], [30, 150], [40, 165], [56, -178],
  ], '#3baa6d');

  pushRegion([
    [80, -100], [70, -80], [66, -60], [64, -40], [62, -20], [60, 0], [58, 20], [54, 40],
    [50, 60], [46, 90], [44, 120], [45, 150], [50, 170], [60, -170], [72, -140],
  ], '#3aa766');

  pushRegion([
    [52, -168], [50, -150], [44, -140], [36, -125], [30, -110], [24, -100], [20, -90], [18, -80],
    [16, -70], [14, -60], [14, -50], [20, -45], [26, -46], [30, -50], [36, -60], [40, -70],
    [48, -90], [52, -120], [54, -150],
  ], '#2f9f5a');

  pushRegion([
    [8, -82], [16, -82], [22, -76], [28, -70], [36, -64], [42, -56], [46, -44], [44, -30],
    [38, -20], [32, -10], [26, 0], [18, 8], [10, 16], [4, 18], [-6, 20], [-12, 16], [-16, 10],
    [-18, 0], [-20, -10], [-18, -20], [-12, -32], [-6, -42],
  ], '#40a86a');

  pushRegion([
    [14, -81], [8, -70], [2, -60], [-8, -55], [-12, -50], [-16, -44], [-20, -38], [-24, -32],
    [-28, -24], [-32, -18], [-36, -10], [-40, 0], [-42, 12], [-40, 26], [-32, 30], [-24, 28],
    [-16, 24], [-8, 18], [0, 10], [6, 2], [10, -4], [12, -12], [14, -22],
  ], '#38a061');

  pushRegion([
    [10, -60], [2, -58], [-6, -56], [-14, -54], [-22, -52], [-30, -50], [-36, -48], [-44, -44],
    [-50, -40], [-54, -34], [-56, -26], [-54, -16], [-48, -6], [-42, 2], [-34, 10], [-26, 18],
    [-18, 26], [-10, 32], [-2, 34], [8, 34], [14, 32], [20, 26], [24, 18], [20, 6],
  ], '#2f9957');

  pushRegion([
    [34, -18], [40, -10], [46, -4], [52, 8], [54, 20], [56, 32], [54, 42], [50, 50],
    [44, 56], [38, 62], [34, 68], [30, 74], [28, 80], [22, 84], [16, 82], [10, 78],
    [4, 72], [2, 64], [4, 54], [8, 46], [14, 40], [22, 34], [28, 30],
  ], '#44a96a');

  pushRegion([
    [54, 32], [58, 44], [60, 56], [60, 70], [58, 84], [54, 96], [48, 108], [42, 118], [36, 126],
    [30, 132], [22, 136], [16, 140], [8, 140], [0, 134], [-8, 128], [-14, 118], [-18, 106],
    [-22, 96], [-26, 84], [-28, 72], [-28, 60], [-24, 48], [-18, 40], [-10, 36], [-2, 34],
    [6, 32], [14, 32], [24, 32], [36, 32],
  ], '#3ea464');

  pushRegion([
    [10, 112], [4, 122], [0, 132], [-4, 138], [-6, 144], [-8, 152], [-6, 160], [0, 166],
    [8, 170], [16, 170], [22, 166], [28, 160], [30, 150], [28, 140], [22, 132], [16, 124],
  ], '#2e9a59');

  pushRegion([
    [0, 110], [-8, 116], [-16, 122], [-22, 128], [-26, 134], [-30, 140], [-32, 150], [-30, 160],
    [-24, 170], [-16, -178], [-8, -170], [0, -160], [6, -150], [10, -140], [12, -130], [10, -120],
  ], '#2a934f');

  pushRegion([
    [-10, 110], [-14, 118], [-18, 126], [-22, 134], [-26, 142], [-28, 150], [-28, 158], [-24, 166],
    [-18, 172], [-10, 178], [-2, -176], [6, -170], [12, -160], [14, -150], [12, -140],
  ], '#2e8f4c');

  pushRegion([
    [-16, 110], [-24, 118], [-32, 126], [-40, 134], [-48, 142], [-54, 150], [-58, 158], [-58, 168],
    [-54, 176], [-46, -176], [-36, -168], [-28, -160], [-20, -150], [-16, -140], [-12, -130],
  ], '#28904b');

  pushRegion([
    [-70, -60], [-68, -40], [-66, -20], [-64, 0], [-62, 20], [-60, 40], [-60, 60], [-60, 80],
    [-64, 100], [-70, 120], [-76, 140], [-78, 160], [-78, 180], [-76, -160], [-72, -140],
    [-72, -120], [-72, -100],
  ], '#d4dfff', 'rgba(0,0,0,0.12)');

  return shapes;
}

function latLonToCanvas(lat, lon, width, height) {
  const x = ((lon + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return [x, y];
}
function setupPrograms() {
  const commonVertex = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec2 aUv;
    uniform mat4 uModel;
    uniform mat4 uViewProjection;
    uniform mat3 uNormalMatrix;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    varying vec2 vUv;
    void main() {
      vec4 world = uModel * vec4(aPosition, 1.0);
      vWorldPos = world.xyz;
      vNormal = normalize(uNormalMatrix * aNormal);
      vUv = aUv;
      gl_Position = uViewProjection * world;
    }
  `;

  const earthFragment = `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform vec3 uLightDir;
    uniform vec3 uSecondaryLightDir;
    uniform vec3 uCameraPos;
    uniform float uAmbient;
    uniform float uSpecular;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    varying vec2 vUv;
    void main() {
      vec3 normal = normalize(vNormal);
      vec3 baseColor = texture2D(uTexture, vUv).rgb;
      float diffuse = max(dot(normal, normalize(uLightDir)), 0.0);
      float fill = max(dot(normal, normalize(uSecondaryLightDir)), 0.0) * 0.4;
      vec3 viewDir = normalize(uCameraPos - vWorldPos);
      vec3 halfDir = normalize(normalize(uLightDir) + viewDir);
      float spec = pow(max(dot(normal, halfDir), 0.0), 32.0) * uSpecular;
      vec3 color = baseColor * (uAmbient + diffuse * 0.9 + fill * 0.6) + vec3(spec);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const solidFragment = `
    precision mediump float;
    uniform vec3 uColor;
    uniform vec3 uLightDir;
    uniform vec3 uSecondaryLightDir;
    uniform float uAmbient;
    varying vec3 vNormal;
    void main() {
      vec3 n = normalize(vNormal);
      float diffuse = max(dot(n, normalize(uLightDir)), 0.0);
      float fill = max(dot(n, normalize(uSecondaryLightDir)), 0.0) * 0.45;
      vec3 color = uColor * (uAmbient + diffuse * 0.9 + fill * 0.5);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const atmosphereVertex = `
    attribute vec3 aPosition;
    uniform mat4 uModel;
    uniform mat4 uViewProjection;
    varying vec3 vPosition;
    void main() {
      vec4 world = uModel * vec4(aPosition, 1.0);
      vPosition = aPosition;
      gl_Position = uViewProjection * world;
    }
  `;

  const atmosphereFragment = `
    precision mediump float;
    varying vec3 vPosition;
    uniform vec3 uColor;
    void main() {
      float intensity = 1.0 - clamp(length(vPosition) / 1.05, 0.0, 1.0);
      gl_FragColor = vec4(uColor, intensity * 0.45);
    }
  `;

  const lineVertex = `
    attribute vec3 aPosition;
    uniform mat4 uViewProjection;
    void main() {
      gl_Position = uViewProjection * vec4(aPosition, 1.0);
    }
  `;

  const lineFragment = `
    precision mediump float;
    uniform vec4 uColor;
    void main() {
      gl_FragColor = uColor;
    }
  `;

  earthProgram = createProgram(gl, commonVertex, earthFragment);
  solidProgram = createProgram(gl, commonVertex, solidFragment);
  atmosphereProgram = createProgram(gl, atmosphereVertex, atmosphereFragment);
  lineProgram = createProgram(gl, lineVertex, lineFragment);
}

function bindSphereGeometry(program, geometry) {
  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  const normalLocation = gl.getAttribLocation(program, 'aNormal');
  const uvLocation = gl.getAttribLocation(program, 'aUv');

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.STATIC_DRAW);
  if (positionLocation >= 0) {
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
  }

  const normalBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.normals, gl.STATIC_DRAW);
  if (normalLocation >= 0) {
    gl.enableVertexAttribArray(normalLocation);
    gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);
  }

  const uvBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, geometry.uvs, gl.STATIC_DRAW);
  if (uvLocation >= 0) {
    gl.enableVertexAttribArray(uvLocation);
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
  }

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);

  return {
    program,
    buffers: {
      positionBuffer,
      normalBuffer,
      uvBuffer,
      indexBuffer,
      indexCount: geometry.indices.length,
    },
  };
}

function computeCameraPosition() {
  const x = cameraDistance * Math.cos(cameraLat) * Math.cos(cameraLon);
  const y = cameraDistance * Math.sin(cameraLat);
  const z = cameraDistance * Math.cos(cameraLat) * Math.sin(cameraLon);
  return [x + cameraTarget[0], y + cameraTarget[1], z + cameraTarget[2]];
}

function updateViewProjection() {
  const aspect = Math.max(canvas.clientWidth, 1) / Math.max(canvas.clientHeight, 1);
  mat4Perspective(projectionMatrix, 45 * DEG2RAD, aspect, 0.1, 100);
  const cameraPos = computeCameraPosition();
  mat4LookAt(viewMatrix, cameraPos, cameraTarget, [0, 1, 0]);
  multiplyMat4(viewProjectionMatrix, projectionMatrix, viewMatrix);
  invertMat4(inverseViewMatrix, viewMatrix);
  return cameraPos;
}

function clampLat(value) {
  const limit = 85 * DEG2RAD;
  return Math.max(-limit, Math.min(limit, value));
}

function handlePointerDown(event) {
  dragging = true;
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    lon: cameraLon,
    lat: cameraLat,
  };
  canvas.setPointerCapture(event.pointerId);
}

function handlePointerMove(event) {
  if (!dragging || !dragStart) return;
  const deltaX = (event.clientX - dragStart.x) * 0.005;
  const deltaY = (event.clientY - dragStart.y) * 0.005;
  cameraLon = dragStart.lon - deltaX;
  cameraLat = clampLat(dragStart.lat + deltaY);
}

function handlePointerUp(event) {
  dragging = false;
  dragStart = null;
  if (canvas?.hasPointerCapture?.(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function handleWheel(event) {
  event.preventDefault();
  const delta = Math.sign(event.deltaY);
  cameraDistance = Math.min(CAMERA_DISTANCE_MAX, Math.max(CAMERA_DISTANCE_MIN, cameraDistance + delta * 0.35));
}

function handleTouchStart(event) {
  if (event.touches.length === 2) {
    const [a, b] = event.touches;
    touchDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
}

function handleTouchMove(event) {
  if (event.touches.length === 2 && touchDistance) {
    const [a, b] = event.touches;
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const diff = touchDistance - distance;
    cameraDistance = Math.min(CAMERA_DISTANCE_MAX, Math.max(CAMERA_DISTANCE_MIN, cameraDistance + diff * 0.005));
    touchDistance = distance;
    event.preventDefault();
  }
}

function handleTouchEnd() {
  touchDistance = null;
}
function clearScene() {
  if (!gl) return;
  const bg = theme === 'dark' ? [1 / 255, 3 / 255, 12 / 255, 1] : [242 / 255, 247 / 255, 1, 1];
  gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
  gl.clearDepth(1.0);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

function drawSphere(programHandle, transformOptions) {
  const { program, buffers } = programHandle;
  gl.useProgram(program);

  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positionBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

  const normalLocation = gl.getAttribLocation(program, 'aNormal');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normalBuffer);
  gl.enableVertexAttribArray(normalLocation);
  gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);

  const uvLocation = gl.getAttribLocation(program, 'aUv');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uvBuffer);
  if (uvLocation >= 0) {
    gl.enableVertexAttribArray(uvLocation);
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
  }

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indexBuffer);

  const uModel = gl.getUniformLocation(program, 'uModel');
  const uVP = gl.getUniformLocation(program, 'uViewProjection');
  const uNormalMatrix = gl.getUniformLocation(program, 'uNormalMatrix');
  const uColor = gl.getUniformLocation(program, 'uColor');
  const uLight = gl.getUniformLocation(program, 'uLightDir');
  const uSecondary = gl.getUniformLocation(program, 'uSecondaryLightDir');
  const uAmbient = gl.getUniformLocation(program, 'uAmbient');
  const uSpecular = gl.getUniformLocation(program, 'uSpecular');
  const uCamera = gl.getUniformLocation(program, 'uCameraPos');
  const uTexture = gl.getUniformLocation(program, 'uTexture');

  if (uVP) gl.uniformMatrix4fv(uVP, false, viewProjectionMatrix);
  if (uLight) gl.uniform3fv(uLight, LIGHT_DIRECTION);
  if (uSecondary) gl.uniform3fv(uSecondary, SECONDARY_LIGHT_DIRECTION);

  transformOptions.forEach((options) => {
    const { modelMatrix, color, ambient = theme === 'dark' ? 0.3 : 0.5, specular = 0.2, useTexture = false } = options;
    if (uModel) gl.uniformMatrix4fv(uModel, false, modelMatrix);
    if (uAmbient) gl.uniform1f(uAmbient, ambient);
    if (uSpecular) gl.uniform1f(uSpecular, specular);
    if (uCamera) gl.uniform3fv(uCamera, computeCameraPosition());
    if (color && uColor) gl.uniform3fv(uColor, color);

    if (uNormalMatrix) {
      mat3FromMat4(normalMatrix3, modelMatrix);
      invertMat3(normalMatrix3, normalMatrix3);
      transposeMat3(normalMatrix3, normalMatrix3);
      gl.uniformMatrix3fv(uNormalMatrix, false, normalMatrix3);
    }

    if (useTexture && uTexture >= 0) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, earthTexture);
      gl.uniform1i(uTexture, 0);
    }

    gl.drawElements(gl.TRIANGLES, buffers.indexCount, gl.UNSIGNED_INT, 0);
  });
}

function drawAtmosphere(programHandle, modelMatrix) {
  const { program, buffers } = programHandle;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.useProgram(program);

  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positionBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indexBuffer);
  const uModel = gl.getUniformLocation(program, 'uModel');
  const uVP = gl.getUniformLocation(program, 'uViewProjection');
  const uColor = gl.getUniformLocation(program, 'uColor');
  gl.uniformMatrix4fv(uModel, false, modelMatrix);
  gl.uniformMatrix4fv(uVP, false, viewProjectionMatrix);
  const color = theme === 'dark' ? [0.35, 0.7, 1] : [0.45, 0.78, 1];
  gl.uniform3fv(uColor, color);
  gl.drawElements(gl.TRIANGLES, buffers.indexCount, gl.UNSIGNED_INT, 0);
  gl.disable(gl.BLEND);
}

function drawOrbit() {
  if (!orbitVertexCount) return;
  gl.useProgram(lineProgram);
  const positionLocation = gl.getAttribLocation(lineProgram, 'aPosition');
  gl.bindBuffer(gl.ARRAY_BUFFER, orbitBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
  const uVP = gl.getUniformLocation(lineProgram, 'uViewProjection');
  gl.uniformMatrix4fv(uVP, false, viewProjectionMatrix);
  const elapsed = performance.now() - orbitUpdatedAt;
  const alpha = Math.min(1, elapsed / (ORBIT_FADE_SECONDS * 1000));
  const uColor = gl.getUniformLocation(lineProgram, 'uColor');
  gl.uniform4fv(uColor, [1, 0.72, 0.32, 0.55 + 0.4 * alpha]);
  gl.drawArrays(gl.LINE_STRIP, 0, orbitVertexCount);
}

function drawLink() {
  if (!linkVisible) return;
  gl.useProgram(lineProgram);
  const positionLocation = gl.getAttribLocation(lineProgram, 'aPosition');
  gl.bindBuffer(gl.ARRAY_BUFFER, linkBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
  const uVP = gl.getUniformLocation(lineProgram, 'uViewProjection');
  gl.uniformMatrix4fv(uVP, false, viewProjectionMatrix);
  const uColor = gl.getUniformLocation(lineProgram, 'uColor');
  gl.uniform4fv(uColor, [0.42, 0.83, 1.0, 0.85]);
  gl.drawArrays(gl.LINES, 0, 2);
}

function renderStationsInternal(solidHandle) {
  if (!stationTransforms.length) return;
  const { program, buffers } = solidHandle;
  gl.useProgram(program);

  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positionBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

  const normalLocation = gl.getAttribLocation(program, 'aNormal');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normalBuffer);
  gl.enableVertexAttribArray(normalLocation);
  gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);

  const uModel = gl.getUniformLocation(program, 'uModel');
  const uVP = gl.getUniformLocation(program, 'uViewProjection');
  const uNormalMatrix = gl.getUniformLocation(program, 'uNormalMatrix');
  const uColor = gl.getUniformLocation(program, 'uColor');
  const uLight = gl.getUniformLocation(program, 'uLightDir');
  const uSecondary = gl.getUniformLocation(program, 'uSecondaryLightDir');
  const uAmbient = gl.getUniformLocation(program, 'uAmbient');

  const uvLocation = gl.getAttribLocation(program, 'aUv');
  if (uvLocation >= 0) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uvBuffer);
    gl.enableVertexAttribArray(uvLocation);
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
  }

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indexBuffer);
  gl.uniformMatrix4fv(uVP, false, viewProjectionMatrix);
  if (uLight) gl.uniform3fv(uLight, LIGHT_DIRECTION);
  if (uSecondary) gl.uniform3fv(uSecondary, SECONDARY_LIGHT_DIRECTION);
  if (uAmbient) gl.uniform1f(uAmbient, theme === 'dark' ? 0.5 : 0.62);

  stationTransforms.forEach((matrix, index) => {
    const color = stationColors[index];
    if (uModel) gl.uniformMatrix4fv(uModel, false, matrix);
    if (uColor) gl.uniform3fv(uColor, color);
    if (uNormalMatrix) {
      mat3FromMat4(normalMatrix3, matrix);
      invertMat3(normalMatrix3, normalMatrix3);
      transposeMat3(normalMatrix3, normalMatrix3);
      gl.uniformMatrix3fv(uNormalMatrix, false, normalMatrix3);
    }
    gl.drawElements(gl.TRIANGLES, buffers.indexCount, gl.UNSIGNED_INT, 0);
  });
}

function renderSatelliteInternal(solidHandle) {
  if (!satelliteTransform) return;
  const { program, buffers } = solidHandle;
  gl.useProgram(program);

  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positionBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);

  const normalLocation = gl.getAttribLocation(program, 'aNormal');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normalBuffer);
  gl.enableVertexAttribArray(normalLocation);
  gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);

  const uvLocation = gl.getAttribLocation(program, 'aUv');
  if (uvLocation >= 0) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uvBuffer);
    gl.enableVertexAttribArray(uvLocation);
    gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0);
  }

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indexBuffer);

  const uModel = gl.getUniformLocation(program, 'uModel');
  const uVP = gl.getUniformLocation(program, 'uViewProjection');
  const uNormalMatrix = gl.getUniformLocation(program, 'uNormalMatrix');
  const uColor = gl.getUniformLocation(program, 'uColor');
  const uLight = gl.getUniformLocation(program, 'uLightDir');
  const uSecondary = gl.getUniformLocation(program, 'uSecondaryLightDir');
  const uAmbient = gl.getUniformLocation(program, 'uAmbient');

  gl.uniformMatrix4fv(uModel, false, satelliteTransform);
  gl.uniformMatrix4fv(uVP, false, viewProjectionMatrix);
  if (uLight) gl.uniform3fv(uLight, LIGHT_DIRECTION);
  if (uSecondary) gl.uniform3fv(uSecondary, SECONDARY_LIGHT_DIRECTION);
  if (uAmbient) gl.uniform1f(uAmbient, theme === 'dark' ? 0.58 : 0.68);
  if (uColor) gl.uniform3fv(uColor, [1, 0.86, 0.4]);
  if (uNormalMatrix) {
    mat3FromMat4(normalMatrix3, satelliteTransform);
    invertMat3(normalMatrix3, normalMatrix3);
    transposeMat3(normalMatrix3, normalMatrix3);
    gl.uniformMatrix3fv(uNormalMatrix, false, normalMatrix3);
  }

  gl.drawElements(gl.TRIANGLES, buffers.indexCount, gl.UNSIGNED_INT, 0);
}
let earthHandle;
let atmosphereHandle;
let solidHandle;

function setupGeometryHandles() {
  sphereGeometry = createSphereGeometry();
  lowResSphereGeometry = createLowResSphereGeometry();
  earthHandle = bindSphereGeometry(earthProgram, sphereGeometry);
  atmosphereHandle = bindSphereGeometry(atmosphereProgram, sphereGeometry);
  solidHandle = bindSphereGeometry(solidProgram, lowResSphereGeometry);
}

function renderScene(timestamp) {
  if (!gl) return;
  animationFrameId = requestAnimationFrame(renderScene);
  updateCanvasSize();
  const delta = lastTimestamp ? (timestamp - lastTimestamp) / 1000 : 0;
  lastTimestamp = timestamp;
  earthRotation += EARTH_ROTATION_RATE * delta;

  updateViewProjection();
  clearScene();

  if (!earthHandle || !atmosphereHandle || !solidHandle) return;

  copyMat4(tempMatrix, IDENTITY_MATRIX);
  rotateY(tempMatrix, tempMatrix, earthRotation);
  drawSphere(earthHandle, [{
    modelMatrix: tempMatrix,
    useTexture: true,
    ambient: theme === 'dark' ? 0.26 : 0.45,
    specular: 0.25,
  }]);

  copyMat4(tempMatrix2, tempMatrix);
  scaleMat4(tempMatrix2, tempMatrix2, [1.05, 1.05, 1.05]);
  drawAtmosphere(atmosphereHandle, tempMatrix2);

  drawOrbit();
  drawLink();
  renderSatelliteInternal(solidHandle);
  renderStationsInternal(solidHandle);
}

function updateCanvasSize() {
  if (!canvas || !gl) return;
  const width = canvas.clientWidth || 1;
  const height = canvas.clientHeight || 1;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }
}

function buildOrbitBuffer() {
  if (!gl) return;
  orbitBuffer = gl.createBuffer();
}

function buildLinkBuffer() {
  if (!gl) return;
  linkBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, linkBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(6), gl.DYNAMIC_DRAW);
}

export function updateOrbitPath(points) {
  if (!gl || !orbitBuffer) return;
  if (!points?.length) {
    orbitVertexCount = 0;
    linkVisible = false;
    return;
  }
  const closed = [...points, points[0]];
  const data = new Float32Array(closed.length * 3);
  closed.forEach((point, index) => {
    const vec = latLonAltToCartesian(point.lat, point.lon, point.alt);
    data[index * 3] = vec[0];
    data[index * 3 + 1] = vec[1];
    data[index * 3 + 2] = vec[2];
  });
  gl.bindBuffer(gl.ARRAY_BUFFER, orbitBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  orbitVertexCount = closed.length;
  orbitUpdatedAt = performance.now();
}

export function updateSatellite(point) {
  if (!point) {
    satelliteTransform = null;
    return;
  }
  const pos = latLonAltToCartesian(point.lat, point.lon, point.alt);
  const matrix = createIdentityMat4();
  translateMat4(matrix, matrix, pos);
  scaleMat4(matrix, matrix, [0.05, 0.05, 0.05]);
  satelliteTransform = matrix;
}

export function renderStations(stations, selectedId) {
  stationTransforms = [];
  stationColors = [];
  selectedStationId = selectedId || null;
  if (!stations?.length) return;
  stations.forEach((station) => {
    const pos = latLonAltToCartesian(station.lat, station.lon, 0.02);
    const matrix = createIdentityMat4();
    translateMat4(matrix, matrix, pos);
    const scale = station.id === selectedStationId ? 0.055 : 0.038;
    scaleMat4(matrix, matrix, [scale, scale, scale]);
    stationTransforms.push(matrix);
    stationColors.push(station.id === selectedStationId ? [0.98, 0.56, 0.16] : [0.18, 0.83, 0.7]);
  });
}

export function updateLink(point, station) {
  if (!gl || !linkBuffer || !point || !station) {
    linkVisible = false;
    return;
  }
  const sat = latLonAltToCartesian(point.lat, point.lon, point.alt);
  const ground = latLonAltToCartesian(station.lat, station.lon, 0.02);
  gl.bindBuffer(gl.ARRAY_BUFFER, linkBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([...ground, ...sat]));
  linkVisible = true;
}

export function setTheme(nextTheme) {
  theme = nextTheme === 'light' ? 'light' : 'dark';
}

export function initScene(container) {
  containerEl = container;
  if (!containerEl) return null;
  fallbackEl = containerEl.querySelector('#threeFallback');
  ensureFallback('');

  disposeScene();

  canvas = document.createElement('canvas');
  canvas.classList.add('globe-canvas');
  containerEl.appendChild(canvas);

  gl = canvas.getContext('webgl', { antialias: true, alpha: true });
  if (!gl) {
    ensureFallback('WebGL no está disponible en este navegador.');
    canvas.remove();
    canvas = null;
    return null;
  }

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointerleave', handlePointerUp);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleTouchEnd);

  projectionMatrix = createIdentityMat4();
  viewMatrix = createIdentityMat4();
  viewProjectionMatrix = createIdentityMat4();
  inverseViewMatrix = createIdentityMat4();

  setupPrograms();
  setupGeometryHandles();

  const earthCanvas = generateEarthCanvas();
  earthTexture = createTexture(gl, earthCanvas);
  buildOrbitBuffer();
  buildLinkBuffer();
  linkVisible = false;

  updateCanvasSize();

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => updateCanvasSize());
    resizeObserver.observe(containerEl);
  }
  window.addEventListener('resize', updateCanvasSize);

  lastTimestamp = 0;
  renderScene(0);
  return { gl };
}

export function disposeScene() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  window.removeEventListener('resize', updateCanvasSize);

  if (canvas) {
    canvas.removeEventListener('pointerdown', handlePointerDown);
    canvas.removeEventListener('pointermove', handlePointerMove);
    canvas.removeEventListener('pointerup', handlePointerUp);
    canvas.removeEventListener('pointerleave', handlePointerUp);
    canvas.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('touchstart', handleTouchStart);
    canvas.removeEventListener('touchmove', handleTouchMove);
    canvas.removeEventListener('touchend', handleTouchEnd);
    canvas.remove();
  }

  if (gl) {
    if (earthTexture) {
      gl.deleteTexture(earthTexture);
      earthTexture = null;
    }
    [earthHandle, atmosphereHandle, solidHandle].forEach((handle) => {
      if (!handle) return;
      const { buffers } = handle;
      if (buffers.positionBuffer) gl.deleteBuffer(buffers.positionBuffer);
      if (buffers.normalBuffer) gl.deleteBuffer(buffers.normalBuffer);
      if (buffers.uvBuffer) gl.deleteBuffer(buffers.uvBuffer);
      if (buffers.indexBuffer) gl.deleteBuffer(buffers.indexBuffer);
    });
    if (orbitBuffer) gl.deleteBuffer(orbitBuffer);
    if (linkBuffer) gl.deleteBuffer(linkBuffer);
    if (earthProgram) gl.deleteProgram(earthProgram);
    if (solidProgram) gl.deleteProgram(solidProgram);
    if (atmosphereProgram) gl.deleteProgram(atmosphereProgram);
    if (lineProgram) gl.deleteProgram(lineProgram);
  }

  gl = null;
  canvas = null;
  earthHandle = null;
  atmosphereHandle = null;
  solidHandle = null;
  orbitBuffer = null;
  linkBuffer = null;
  orbitVertexCount = 0;
  stationTransforms = [];
  stationColors = [];
  satelliteTransform = null;
  earthProgram = null;
  atmosphereProgram = null;
  solidProgram = null;
  lineProgram = null;
  linkVisible = false;
}
