import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const PANEL_TOGGLE_LABEL = {
  collapse: 'Collapse',
  expand: 'Expand'
};

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const R_E = 6378.137; // km
const MU = 398600.4418; // km^3/s^2
const KM2U = 1000; // 1 km -> 1000 scene units
const SIDEREAL_RATE = 7.2921159e-5; // rad/s
const SIDEREAL_DAY = 86164; // s
const MIN_ALTITUDE = 160; // km
const MAX_ECCENTRICITY = 0.99;
const GEO_A_MAX = 42164; // km (aprox. GEO)

const PARAM_CONFIG = {
  a: { inputId: 'a', sliderId: 'aSlider', min: R_E + MIN_ALTITUDE, max: GEO_A_MAX, step: 1, decimals: 0, wrap: false },
  e: { inputId: 'e', sliderId: 'eSlider', min: 0, max: MAX_ECCENTRICITY, step: 0.0005, decimals: 3, wrap: false },
  i: { inputId: 'i', sliderId: 'iSlider', min: 0, max: 180, step: 0.1, decimals: 1, wrap: false },
  raan: { inputId: 'raan', sliderId: 'raanSlider', min: 0, max: 360, step: 0.1, decimals: 1, wrap: true },
  argp: { inputId: 'argp', sliderId: 'argpSlider', min: 0, max: 360, step: 0.1, decimals: 1, wrap: true },
  M0: { inputId: 'M0', sliderId: 'M0Slider', min: 0, max: 360, step: 0.1, decimals: 1, wrap: true },
  aperture: { inputId: 'aperture', sliderId: 'apertureSlider', min: 0.1, max: 10, step: 0.1, decimals: 1, wrap: false }
};

const DEFAULT_PARAMS = {
  name: 'sat-leo',
  a_km: 6771,
  e: 0.001,
  i_deg: 53.0,
  raan_deg: 0.0,
  argp_deg: 0.0,
  M0_deg: 0.0,
  aperture_m: 1.0,
  epoch: null
};

const state = {
  params: null,
  meanMotion: 0,
  orbitPeriodSec: null,
  simT: 0,
  timeHorizon: 5400,
  revCount: 1,
  playing: true,
  speedMul: 100,
  perigeeAltKm: null,
  apogeeAltKm: null,
  lastSpeedKmS: null,
  resonance: {
    enabled: false,
    lock: 'orbits',
    nOrbits: 1,
    nRotations: 1,
    aTarget: null,
    targetPeriod: null,
    errorPpm: null,
    satisfied: false
  }
};

const dom = {};
const paramControls = {};
let updatingParams = false;
let updatingResUI = false;

let renderer;
let scene;
let camera;
let controls;
let earth;
let atmosphere;
let equator;
let sat;
let orbitLine;
let perigeeMarker;
let apogeeMarker;

const clock = new THREE.Clock();

const byId = id => document.getElementById(id);

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function clampInt(value, min, max) {
  const v = Math.round(Number(value) || 0);
  return Math.min(Math.max(v, min), max);
}

function wrapAngle(deg) {
  if (!Number.isFinite(deg)) return 0;
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function formatNumber(value, decimals) {
  if (!Number.isFinite(value)) return '--';
  if (decimals == null) return String(value);
  return value.toFixed(decimals);
}

function formatSecondsShort(seconds) {
  if (!Number.isFinite(seconds)) return '--';
  return `${seconds.toFixed(0)} s`;
}

function formatSecondsHuman(seconds) {
  if (!Number.isFinite(seconds)) return '--';
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(2)} h`;
  if (seconds >= 60) return `${(seconds / 60).toFixed(2)} min`;
  return `${seconds.toFixed(0)} s`;
}

function formatSecondsLong(seconds) {
  if (!Number.isFinite(seconds)) return '--';
  const short = formatSecondsShort(seconds);
  const human = formatSecondsHuman(seconds);
  return human === short ? short : `${short} (${human})`;
}

function localISO() {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function periodFromA(a) {
  return TWO_PI * Math.sqrt(Math.pow(a, 3) / MU);
}

function aFromPeriod(period) {
  return Math.pow(MU * Math.pow(period / TWO_PI, 2), 1 / 3);
}

function solveE(M, e) {
  let E = M;
  for (let k = 0; k < 20; k++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    E -= f / fp;
  }
  return E;
}

function perifocalToECI(r, argp, inc, raan) {
  const cosO = Math.cos(raan);
  const sinO = Math.sin(raan);
  const cosi = Math.cos(inc);
  const sini = Math.sin(inc);
  const cosw = Math.cos(argp);
  const sinw = Math.sin(argp);
  const R11 = cosO * cosw - sinO * sinw * cosi;
  const R12 = -cosO * sinw - sinO * cosw * cosi;
  const R13 = sinO * sini;
  const R21 = sinO * cosw + cosO * sinw * cosi;
  const R22 = -sinO * sinw + cosO * cosw * cosi;
  const R23 = -cosO * sini;
  const R31 = sinw * sini;
  const R32 = cosw * sini;
  const R33 = cosi;
  return {
    x: R11 * r.x + R12 * r.y + R13 * r.z,
    y: R21 * r.x + R22 * r.y + R23 * r.z,
    z: R31 * r.x + R32 * r.y + R33 * r.z
  };
}

function loadTextures(material) {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  const colorUrl = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
  loader.load(colorUrl, tex => {
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    else tex.encoding = THREE.sRGBEncoding;
    material.map = tex;
    material.needsUpdate = true;
  });

  const bumpUrl = 'https://unpkg.com/three-globe/example/img/earth-topology.png';
  loader.load(bumpUrl, tex => {
    material.bumpMap = tex;
    material.bumpScale = R_E * KM2U * 0.0008;
    material.needsUpdate = true;
  });
}

function disposeOrbitLine() {
  if (!orbitLine) return;
  scene.remove(orbitLine);
  orbitLine.geometry.dispose();
  orbitLine.material.dispose();
  orbitLine = null;
}

function initScene() {
  const container = byId('scene');

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  else renderer.outputEncoding = THREE.sRGBEncoding;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050912);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 100, 2e8);
  camera.position.set(0, -3 * R_E * KM2U, 1.6 * R_E * KM2U);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 0.5 * R_E * KM2U;
  controls.maxDistance = 40 * R_E * KM2U;
  controls.target.set(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const sunlight = new THREE.DirectionalLight(0xffffff, 1.3);
  sunlight.position.set(2 * R_E * KM2U, -R_E * KM2U, 1.5 * R_E * KM2U);
  scene.add(sunlight);

  const earthMaterial = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    specular: new THREE.Color(0x333333),
    shininess: 12
  });
  const earthGeom = new THREE.SphereGeometry(R_E * KM2U, 128, 128);
  earth = new THREE.Mesh(earthGeom, earthMaterial);
  scene.add(earth);
  loadTextures(earthMaterial);

  const atmosphereGeom = new THREE.SphereGeometry(R_E * KM2U * 1.02, 64, 64);
  const atmosphereMat = new THREE.MeshPhongMaterial({
    color: 0x7cc7ff,
    transparent: true,
    opacity: 0.08,
    side: THREE.BackSide
  });
  atmosphere = new THREE.Mesh(atmosphereGeom, atmosphereMat);
  scene.add(atmosphere);

  const eqGeo = new THREE.RingGeometry(R_E * KM2U * 0.999, R_E * KM2U * 1.001, 256);
  const eqMat = new THREE.MeshBasicMaterial({
    color: 0x44506b,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8
  });
  equator = new THREE.Mesh(eqGeo, eqMat);
  equator.rotation.x = Math.PI / 2;
  scene.add(equator);

  const axisGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -R_E * KM2U * 1.4, 0),
    new THREE.Vector3(0, R_E * KM2U * 1.4, 0)
  ]);
  const axisMat = new THREE.LineDashedMaterial({
    color: 0x22d3ee,
    dashSize: R_E * KM2U * 0.05,
    gapSize: R_E * KM2U * 0.03,
    linewidth: 1
  });
  const axis = new THREE.Line(axisGeo, axisMat);
  axis.computeLineDistances();
  scene.add(axis);

  const starGeo = new THREE.BufferGeometry();
  const starCount = 2500;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 1.2e8 * (0.5 + Math.random() * 0.5);
    const theta = Math.random() * TWO_PI;
    const phi = Math.acos(2 * Math.random() - 1);
    const sinPhi = Math.sin(phi);
    positions[i * 3] = r * sinPhi * Math.cos(theta);
    positions[i * 3 + 1] = r * sinPhi * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1200, sizeAttenuation: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  sat = new THREE.Mesh(
    new THREE.SphereGeometry(R_E * KM2U * 0.02, 24, 24),
    new THREE.MeshPhongMaterial({ color: 0xffd166, emissive: 0x332200, emissiveIntensity: 0.6 })
  );
  scene.add(sat);

  const markerGeom = new THREE.SphereGeometry(R_E * KM2U * 0.015, 20, 20);
  perigeeMarker = new THREE.Mesh(
    markerGeom,
    new THREE.MeshPhongMaterial({ color: 0x22c55e, emissive: 0x0f5132, emissiveIntensity: 0.4 })
  );
  apogeeMarker = new THREE.Mesh(
    markerGeom,
    new THREE.MeshPhongMaterial({ color: 0xf97316, emissive: 0x541100, emissiveIntensity: 0.4 })
  );
  perigeeMarker.visible = false;
  apogeeMarker.visible = false;
  scene.add(perigeeMarker);
  scene.add(apogeeMarker);

  window.addEventListener('resize', onResize);

  requestAnimationFrame(() => {
    const boot = byId('boot');
    if (boot) boot.remove();
  });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function drawOrbit(params) {
  const inc = params.i_deg * DEG;
  const raan = params.raan_deg * DEG;
  const argp = params.argp_deg * DEG;
  const e = params.e;
  const a = params.a_km;

  const N = 720;
  const pts = [];
  let minR = Infinity;
  let maxR = -Infinity;
  let minVec = null;
  let maxVec = null;

  for (let k = 0; k < N; k++) {
    const M = (TWO_PI * k) / N;
    const E = solveE(M, e);
    const cosE = Math.cos(E);
    const sinE = Math.sin(E);
    const denom = 1 - e * cosE;
    const r = a * denom;
    const cosNu = (cosE - e) / denom;
    const sinNu = Math.sqrt(1 - e * e) * sinE / denom;
    const rp = { x: r * cosNu, y: r * sinNu, z: 0 };
    const re = perifocalToECI(rp, argp, inc, raan);

    if (r < minR) {
      minR = r;
      minVec = { x: re.x, y: re.y, z: re.z };
    }
    if (r > maxR) {
      maxR = r;
      maxVec = { x: re.x, y: re.y, z: re.z };
    }

    pts.push(new THREE.Vector3(re.x * KM2U, re.y * KM2U, re.z * KM2U));
  }

  disposeOrbitLine();
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0x60a5fa });
  orbitLine = new THREE.LineLoop(geo, mat);
  scene.add(orbitLine);

  if (minVec) {
    perigeeMarker.visible = true;
    perigeeMarker.position.set(minVec.x * KM2U, minVec.y * KM2U, minVec.z * KM2U);
  }
  if (maxVec) {
    apogeeMarker.visible = true;
    apogeeMarker.position.set(maxVec.x * KM2U, maxVec.y * KM2U, maxVec.z * KM2U);
  }

  state.perigeeAltKm = minR - R_E;
  state.apogeeAltKm = maxR - R_E;
}

function applyEarthSpin(tSeconds) {
  if (!earth || !atmosphere || !equator) return;
  const rotation = (SIDEREAL_RATE * tSeconds) % TWO_PI;
  earth.rotation.y = rotation;
  atmosphere.rotation.y = rotation;
  equator.rotation.y = rotation;
}

function computeState(params, t) {
  const inc = params.i_deg * DEG;
  const raan = params.raan_deg * DEG;
  const argp = params.argp_deg * DEG;
  const e = params.e;
  const a = params.a_km;
  const M = (params.M0_deg * DEG + state.meanMotion * t) % TWO_PI;
  const E = solveE(M, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const denom = 1 - e * cosE;
  const r = a * denom;
  const cosNu = (cosE - e) / denom;
  const sinNu = Math.sqrt(1 - e * e) * sinE / denom;
  const rp = { x: r * cosNu, y: r * sinNu, z: 0 };
  const re = perifocalToECI(rp, argp, inc, raan);
  const position = new THREE.Vector3(re.x * KM2U, re.y * KM2U, re.z * KM2U);
  const speedKmS = Math.sqrt(MU * (2 / r - 1 / a));
  return { position, speedKmS };
}

function setSatAtTime(params, t) {
  if (!params || !sat) return;
  const stateVec = computeState(params, t);
  sat.position.copy(stateVec.position);
  state.lastSpeedKmS = stateVec.speedKmS;
  applyEarthSpin(t);
}

function sanitizeParam(id, value) {
  const cfg = PARAM_CONFIG[id];
  if (!cfg) return Number(value) || 0;
  let v = Number(value);
  if (!Number.isFinite(v)) v = cfg.wrap ? 0 : cfg.min;
  if (cfg.wrap) v = wrapAngle(v);
  else v = clamp(v, cfg.min, cfg.max);
  return v;
}

function writeParamValue(id, value) {
  const binding = paramControls[id];
  if (!binding) return;
  const { input, slider, config } = binding;
  const text = formatNumber(value, config.decimals);
  updatingParams = true;
  if (input) input.value = text;
  if (slider) slider.value = value;
  updatingParams = false;
}

function getParamValue(id) {
  const binding = paramControls[id];
  if (!binding) return 0;
  const { input, slider } = binding;
  let val = Number(input?.value);
  if (!Number.isFinite(val) && slider) val = Number(slider.value);
  const sanitized = sanitizeParam(id, val);
  if (sanitized !== val) writeParamValue(id, sanitized);
  return sanitized;
}

function setParam(id, value, { emit = false } = {}) {
  const sanitized = sanitizeParam(id, value);
  writeParamValue(id, sanitized);
  if (emit) updateOrbitFromUI();
  return sanitized;
}

function readParams() {
  const name = (dom.satName.value || 'sat-unnamed').trim();
  const epochInput = dom.epoch.value;
  const epochISO = epochInput ? new Date(epochInput).toISOString() : new Date().toISOString();
  return {
    name,
    a_km: getParamValue('a'),
    e: getParamValue('e'),
    i_deg: getParamValue('i'),
    raan_deg: getParamValue('raan'),
    argp_deg: getParamValue('argp'),
    M0_deg: getParamValue('M0'),
    aperture_m: getParamValue('aperture'),
    epoch: epochISO
  };
}

function updateActiveOrbitLabel(name) {
  if (dom.activeOrbit) dom.activeOrbit.textContent = name || '—';
}

function findBestRotations(nOrbits, period) {
  let bestRot = 1;
  let bestDiff = Infinity;
  for (let rot = 1; rot <= 30; rot++) {
    const diff = Math.abs(nOrbits * period - rot * SIDEREAL_DAY);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestRot = rot;
    }
  }
  return bestRot;
}

function findBestOrbits(nRotations, period) {
  let bestOrbit = 1;
  let bestDiff = Infinity;
  for (let orb = 1; orb <= 30; orb++) {
    const diff = Math.abs(orb * period - nRotations * SIDEREAL_DAY);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestOrbit = orb;
    }
  }
  return bestOrbit;
}

function writeResonanceInputs(nOrbits, nRotations) {
  updatingResUI = true;
  dom.resOrbits.value = String(nOrbits);
  dom.resRotations.value = String(nRotations);
  updatingResUI = false;
}

function updateResonanceFeedback() {
  if (!dom.resFeedback) return;
  if (!state.resonance.enabled) {
    dom.resFeedback.classList.remove('error');
    dom.resFeedback.textContent = 'Seleccione valores pequeños (≤30) para cerrar la traza.';
    return;
  }
  const { nOrbits, nRotations, aTarget, targetPeriod, errorPpm, satisfied } = state.resonance;
  if (satisfied) {
    dom.resFeedback.classList.remove('error');
    dom.resFeedback.textContent =
      `Traza cerrada: ${nOrbits} órbitas = ${nRotations} rotaciones terrestres. ` +
      `a ajustado a ${formatNumber(aTarget, 0)} km (${formatSecondsLong(targetPeriod)}).`;
  } else {
    dom.resFeedback.classList.add('error');
    dom.resFeedback.textContent =
      `No se puede cerrar exactamente. a requerido ≈ ${formatNumber(aTarget, 0)} km ` +
      `→ error ≈ ${formatNumber(errorPpm, 3)} ppm. Ajuste los enteros o libere la condición.`;
  }
}

function applyResonance(params) {
  const period = periodFromA(params.a_km);
  let nOrbits = clampInt(dom.resOrbits.value, 1, 30);
  let nRotations = clampInt(dom.resRotations.value, 1, 30);

  if (state.resonance.lock === 'orbits') {
    nRotations = findBestRotations(nOrbits, period);
  } else {
    nOrbits = findBestOrbits(nRotations, period);
  }

  const targetPeriod = (nRotations * SIDEREAL_DAY) / nOrbits;
  const targetA = aFromPeriod(targetPeriod);
  let satisfied = true;
  let errorPpm = 0;
  let finalA = targetA;

  if (targetA < PARAM_CONFIG.a.min || targetA > PARAM_CONFIG.a.max) {
    finalA = clamp(targetA, PARAM_CONFIG.a.min, PARAM_CONFIG.a.max);
    const achievablePeriod = periodFromA(finalA);
    errorPpm = Math.abs((achievablePeriod - targetPeriod) / targetPeriod) * 1e6;
    satisfied = errorPpm < 1e-3;
  }

  writeResonanceInputs(nOrbits, nRotations);
  state.resonance.nOrbits = nOrbits;
  state.resonance.nRotations = nRotations;
  state.resonance.targetPeriod = targetPeriod;
  state.resonance.aTarget = targetA;
  state.resonance.errorPpm = errorPpm;
  state.resonance.satisfied = satisfied;

  setParam('a', finalA, { emit: false });
  params.a_km = finalA;

  updateResonanceFeedback();
  return params;
}

function updateStats() {
  if (dom.statPeriod) {
    dom.statPeriod.textContent = state.orbitPeriodSec
      ? `${(state.orbitPeriodSec / 60).toFixed(2)} min`
      : '--';
  }
  if (dom.statPerigee) {
    dom.statPerigee.textContent =
      state.perigeeAltKm != null ? `${formatNumber(state.perigeeAltKm, 0)} km` : '--';
  }
  if (dom.statApogee) {
    dom.statApogee.textContent =
      state.apogeeAltKm != null ? `${formatNumber(state.apogeeAltKm, 0)} km` : '--';
  }
  if (dom.statSpeed) {
    dom.statSpeed.textContent =
      state.lastSpeedKmS != null ? `${formatNumber(state.lastSpeedKmS, 2)} km/s` : '--';
  }
  if (dom.statAperture) {
    dom.statAperture.textContent =
      state.params ? `${formatNumber(state.params.aperture_m, 1)} m` : '--';
  }
  if (dom.statTRep) {
    const tref = state.resonance.enabled
      ? state.resonance.nOrbits * state.orbitPeriodSec
      : state.revCount * state.orbitPeriodSec;
    dom.statTRep.textContent = Number.isFinite(tref) ? formatSecondsLong(tref) : '--';
  }
  if (dom.statResError) {
    dom.statResError.textContent =
      state.resonance.enabled && state.resonance.errorPpm != null
        ? `${formatNumber(state.resonance.errorPpm, 3)} ppm`
        : '--';
  }
  if (dom.timeMaxDisplay) {
    dom.timeMaxDisplay.textContent = formatSecondsLong(state.timeHorizon);
  }
}

function updateTimeHorizon() {
  if (!Number.isFinite(state.orbitPeriodSec) || state.orbitPeriodSec <= 0) {
    state.timeHorizon = 1;
  } else if (state.resonance.enabled) {
    state.timeHorizon = Math.max(
      state.resonance.nOrbits * state.orbitPeriodSec,
      state.orbitPeriodSec
    );
  } else {
    state.timeHorizon = Math.max(state.revCount * state.orbitPeriodSec, state.orbitPeriodSec);
  }
  const sliderMax = Math.max(1, Math.round(state.timeHorizon));
  dom.timeSlider.max = String(sliderMax);
  dom.timeSlider.step = '1';
  dom.timeSlider.disabled = !state.params;
  updateStats();
  if (state.simT > state.timeHorizon) {
    setTime(state.timeHorizon, { source: 'clamp' });
  }
}

function setTime(t, { source = 'user' } = {}) {
  if (!Number.isFinite(t)) t = 0;
  const clamped = clamp(t, 0, state.timeHorizon || 1);
  state.simT = clamped;
  if (source !== 'slider') {
    dom.timeSlider.value = String(clamped);
  }
  dom.timeDisplay.textContent = clamped.toFixed(1);
  if (state.params) {
    setSatAtTime(state.params, clamped);
  }
  if (source !== 'animation') {
    clock.getDelta();
  }
}

function stepTime(direction) {
  const baseStep = Math.max(state.timeHorizon / 200, state.orbitPeriodSec / 100 || 1);
  const step = Math.max(baseStep, 1);
  setTime(state.simT + direction * step, { source: 'user' });
}

function updateOrbitFromUI(options = {}) {
  const { resetTime = false } = options;
  let params = readParams();

  if (state.resonance.enabled) {
    params = applyResonance(params);
  }

  state.params = params;
  state.meanMotion = Math.sqrt(MU / Math.pow(params.a_km, 3));
  state.orbitPeriodSec = periodFromA(params.a_km);

  drawOrbit(params);
  updateTimeHorizon();

  if (resetTime) {
    setTime(0, { source: 'update' });
  } else {
    setTime(state.simT, { source: 'update' });
  }

  updateActiveOrbitLabel(params.name);
  updateStats();
}

function setPlaying(playing) {
  state.playing = playing;
  if (playing) clock.start();
}

function setResonanceEnabled(enabled) {
  state.resonance.enabled = enabled;
  if (dom.chkCloseTrack) dom.chkCloseTrack.checked = enabled;
  if (dom.resonanceControls) dom.resonanceControls.classList.toggle('hidden', !enabled);
  if (enabled) {
    dom.revSelect.value = 'repeat';
    const period = state.orbitPeriodSec || periodFromA(getParamValue('a'));
    const best = findBestRotations(1, period);
    writeResonanceInputs(1, best);
  } else {
    state.resonance.aTarget = null;
    state.resonance.errorPpm = null;
    state.resonance.satisfied = false;
    if (dom.revSelect.value === 'repeat') dom.revSelect.value = '1';
    state.revCount = Number(dom.revSelect.value);
  }
  updateResonanceFeedback();
  updateOrbitFromUI({ resetTime: true });
}

function saveToLS(orbit) {
  const key = 'qkd_orbits';
  const arr = JSON.parse(localStorage.getItem(key) || '[]');
  const idx = arr.findIndex(o => o.name === orbit.name);
  if (idx >= 0) arr[idx] = orbit;
  else arr.push(orbit);
  localStorage.setItem(key, JSON.stringify(arr));
}

function initParamControls() {
  Object.entries(PARAM_CONFIG).forEach(([id, cfg]) => {
    const input = byId(cfg.inputId);
    const slider = byId(cfg.sliderId);
    if (slider) {
      slider.min = String(cfg.min);
      slider.max = String(cfg.max);
      slider.step = String(cfg.step);
    }
    paramControls[id] = { input, slider, config: cfg };

    const defaultValue = (id === 'a' && DEFAULT_PARAMS.a_km) ||
      (id === 'e' && DEFAULT_PARAMS.e) ||
      (id === 'i' && DEFAULT_PARAMS.i_deg) ||
      (id === 'raan' && DEFAULT_PARAMS.raan_deg) ||
      (id === 'argp' && DEFAULT_PARAMS.argp_deg) ||
      (id === 'M0' && DEFAULT_PARAMS.M0_deg) ||
      (id === 'aperture' && DEFAULT_PARAMS.aperture_m) ||
      cfg.min;
    writeParamValue(id, sanitizeParam(id, defaultValue));

    input?.addEventListener('change', () => {
      if (updatingParams) return;
      setParam(id, input.value, { emit: true });
    });

    slider?.addEventListener('input', () => {
      if (updatingParams) return;
      setParam(id, slider.value, { emit: true });
    });
  });
}

function wireUI() {
  dom.panel = document.getElementById('panel');
  dom.panelToggle = document.getElementById('panelToggle');
  dom.panelBody = document.getElementById('panelBody');
  dom.satName = byId('satName');
  dom.epoch = byId('epoch');
  dom.activeOrbit = byId('activeOrbit');
  dom.btnUpdate = byId('btnUpdate');
  dom.btnSave = byId('btnSave');
  dom.btnClear = byId('btnClear');
  dom.btnPlay = byId('btnPlay');
  dom.btnPause = byId('btnPause');
  dom.btnStepBack = byId('btnStepBack');
  dom.btnStepForward = byId('btnStepForward');
  dom.btnResetTime = byId('btnResetTime');
  dom.speed = byId('speed');
  dom.timeSlider = byId('timeSlider');
  dom.timeDisplay = byId('timeDisplay');
  dom.timeMaxDisplay = byId('timeMaxDisplay');
  dom.revSelect = byId('revSelect');
  dom.chkCloseTrack = byId('chkCloseTrack');
  dom.resLock = byId('resLock');
  dom.resOrbits = byId('resOrbits');
  dom.resRotations = byId('resRotations');
  dom.resFeedback = byId('resFeedback');
  dom.resonanceControls = byId('resonanceControls');
  dom.statPeriod = byId('statPeriod');
  dom.statPerigee = byId('statPerigee');
  dom.statApogee = byId('statApogee');
  dom.statSpeed = byId('statSpeed');
  dom.statAperture = byId('statAperture');
  dom.statResError = byId('statResError');
  dom.statTRep = byId('statTRep');

  initParamControls();

  dom.panelToggle.addEventListener('click', () => {
    const collapsed = dom.panel.classList.toggle('collapsed');
    const expanded = !collapsed;
    dom.panelToggle.textContent = expanded ? 'Collapse' : 'Expand';
    dom.panelToggle.setAttribute('aria-expanded', String(expanded));
  });

  dom.epoch.value = localISO();
  DEFAULT_PARAMS.epoch = dom.epoch.value;
  updateActiveOrbitLabel(DEFAULT_PARAMS.name);

  dom.satName.addEventListener('input', () => {
    updateActiveOrbitLabel(dom.satName.value.trim());
    if (state.params) state.params.name = dom.satName.value.trim();
  });

  dom.epoch.addEventListener('change', () => {
    if (state.params) {
      const epochInput = dom.epoch.value;
      state.params.epoch = epochInput ? new Date(epochInput).toISOString() : new Date().toISOString();
    }
  });

  dom.btnUpdate.addEventListener('click', () => {
    updateOrbitFromUI({ resetTime: true });
  });

  dom.btnSave.addEventListener('click', () => {
    const orbit = state.params ? { ...state.params } : readParams();
    saveToLS(orbit);
    alert(`Órbita guardada como "${orbit.name}". Ve al 2D y pulsa "Import orbits".`);
  });

  dom.btnClear.addEventListener('click', () => {
    localStorage.removeItem('qkd_orbits');
    alert('Órbitas borradas.');
  });

  dom.btnPlay.addEventListener('click', () => setPlaying(true));
  dom.btnPause.addEventListener('click', () => setPlaying(false));
  dom.btnStepBack.addEventListener('click', () => stepTime(-1));
  dom.btnStepForward.addEventListener('click', () => stepTime(1));
  dom.btnResetTime.addEventListener('click', () => setTime(0, { source: 'user' }));

  dom.speed.addEventListener('change', e => {
    const val = Number(e.target.value);
    state.speedMul = Number.isFinite(val) && val > 0 ? val : 1;
  });

  dom.timeSlider.addEventListener('input', e => {
    setTime(Number(e.target.value), { source: 'slider' });
  });

  dom.revSelect.addEventListener('change', e => {
    const value = e.target.value;
    if (value === 'repeat') {
      if (!state.resonance.enabled) setResonanceEnabled(true);
    } else {
      state.revCount = Number(value);
      if (state.resonance.enabled) setResonanceEnabled(false);
      else updateOrbitFromUI();
    }
  });

  dom.chkCloseTrack.addEventListener('change', e => {
    setResonanceEnabled(e.target.checked);
  });

  dom.resLock.addEventListener('change', e => {
    state.resonance.lock = e.target.value;
    if (state.resonance.enabled) updateOrbitFromUI({ resetTime: true });
  });

  dom.resOrbits.addEventListener('change', e => {
    if (updatingResUI) return;
    state.resonance.nOrbits = clampInt(e.target.value, 1, 30);
    if (state.resonance.enabled) updateOrbitFromUI({ resetTime: true });
  });

  dom.resRotations.addEventListener('change', e => {
    if (updatingResUI) return;
    state.resonance.nRotations = clampInt(e.target.value, 1, 30);
    if (state.resonance.enabled) updateOrbitFromUI({ resetTime: true });
  });

  state.revCount = Number(dom.revSelect.value);
  updateResonanceFeedback();
  updateOrbitFromUI({ resetTime: true });
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  const dt = clock.getDelta();
  if (state.playing && state.params) {
    const newTime = state.simT + dt * state.speedMul;
    if (newTime > state.timeHorizon) {
      setTime(newTime % state.timeHorizon, { source: 'animation' });
    } else {
      setTime(newTime, { source: 'animation' });
    }
  }
  renderer.render(scene, camera);
}

function bootstrap() {
  try {
    initScene();
    wireUI();
    clock.start();
    animate();
  } catch (err) {
    console.error(err);
    alert('Error inicializando el 3D. Revisa la consola (F12).');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
