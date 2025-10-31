const PANEL_TOGGLE_LABEL = {
  collapse: 'Collapse',
  expand: 'Expand'
};

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const R_E = 6378.137; // km
const MU = 398600.4418; // km^3/s^2
const SIDEREAL_RATE = 7.2921159e-5; // rad/s
const SIDEREAL_DAY = 86164; // s
const MIN_ALTITUDE = 160; // km
const MAX_ECCENTRICITY = 0.99;
const GEO_A_MAX = 42164; // km

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

const DEFAULT_RES_FEEDBACK = 'Choose small integers (≤30) for closed ground-track solutions.';

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
  },
  groundTrack: {
    samples: [],
    segments: []
  },
  ogsMode: false,
  activeOGS: null
};

const dom = {};
const paramControls = {};
let updatingParams = false;
let updatingResUI = false;

let map;
let groundTrackLayer;
let ogsLayer;
let satelliteMarker = null;
let animationFrame = null;
let lastTimestamp = null;

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
  return short === human ? short : `${short} (${human})`;
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
    dom.resFeedback.textContent = DEFAULT_RES_FEEDBACK;
    return;
  }
  const { nOrbits, nRotations, aTarget, targetPeriod, errorPpm, satisfied } = state.resonance;
  if (satisfied) {
    dom.resFeedback.classList.remove('error');
    dom.resFeedback.textContent =
      `Closed track: ${nOrbits} orbit(s) = ${nRotations} Earth rotation(s). ` +
      `Adjusted semi-major axis ≈ ${formatNumber(aTarget, 0)} km (` +
      `${formatSecondsLong(targetPeriod)}).`;
  } else {
    dom.resFeedback.classList.add('error');
    dom.resFeedback.textContent =
      `Exact resonance unavailable. Required a ≈ ${formatNumber(aTarget, 0)} km ` +
      `(error ≈ ${formatNumber(errorPpm, 3)} ppm). Adjust the integers or disable locking.`;
  }
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
function computeECI(params, t) {
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
  const speedKmS = Math.sqrt(MU * (2 / r - 1 / a));
  return { eci: re, radiusKm: r, speedKmS };
}

function gmstAngle(date) {
  const d = (date - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const h = (18.697374558 + 24.06570982441908 * d) % 24;
  return ((h < 0 ? h + 24 : h) * 15) * DEG;
}

function eciToEcef(r, theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return {
    x: c * r.x + s * r.y,
    y: -s * r.x + c * r.y,
    z: r.z
  };
}

function ecefToGeodetic(r) {
  const lon = Math.atan2(r.y, r.x);
  const hyp = Math.hypot(r.x, r.y);
  const lat = Math.atan2(r.z, hyp);
  return { lat: lat / DEG, lon: ((lon / DEG + 540) % 360) - 180 };
}

function interpolateLongitude(lon1, lon2, ratio) {
  let delta = lon2 - lon1;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  let lon = lon1 + ratio * delta;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return lon;
}

function segmentAntimeridian(points) {
  if (!points.length) return [];
  const segments = [];
  let segment = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (Math.abs(curr.lon - prev.lon) > 180) {
      segments.push(segment);
      segment = [prev, curr];
    } else {
      segment.push(curr);
    }
  }
  if (segment.length) segments.push(segment);
  return segments;
}

function computeOrbitExtrema(params) {
  const e = params.e;
  const a = params.a_km;
  let minR = Infinity;
  let maxR = -Infinity;
  for (let k = 0; k < 720; k++) {
    const M = (TWO_PI * k) / 720;
    const E = solveE(M, e);
    const r = a * (1 - e * Math.cos(E));
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }
  state.perigeeAltKm = minR - R_E;
  state.apogeeAltKm = maxR - R_E;
}
function generateGroundTrack(params) {
  const period = state.orbitPeriodSec;
  if (!Number.isFinite(period) || period <= 0) return;

  const horizon = state.resonance.enabled
    ? state.resonance.nOrbits * period
    : state.revCount * period;

  const stepsPerOrbit = 720;
  const totalSteps = Math.max(2, Math.round(stepsPerOrbit * (horizon / period)));
  const samples = [];
  const segmentsPoints = [];

  const epochDate = params.epoch ? new Date(params.epoch) : new Date();
  const epochMillis = epochDate.getTime();

  for (let i = 0; i <= totalSteps; i++) {
    const t = (i / totalSteps) * horizon;
    const { eci, speedKmS } = computeECI(params, t);
    const gmst = gmstAngle(new Date(epochMillis + t * 1000));
    const ecef = eciToEcef(eci, gmst);
    const geo = ecefToGeodetic(ecef);
    samples.push({ t, lat: geo.lat, lon: geo.lon, speedKmS });
    segmentsPoints.push({ lat: geo.lat, lon: geo.lon });
  }

  const segments = segmentAntimeridian(segmentsPoints).map(seg =>
    seg.map(p => [p.lat, p.lon])
  );

  state.groundTrack.samples = samples;
  state.groundTrack.segments = segments;
  if (samples.length) {
    state.lastSpeedKmS = samples[0].speedKmS;
  }
}

function renderGroundTrack(params) {
  groundTrackLayer.clearLayers();
  if (!state.groundTrack.segments.length) return;
  const tooltip = `${params.name}: ground-track`;
  state.groundTrack.segments.forEach(segment => {
    L.polyline(segment, { color: '#22d3ee', weight: 2 })
      .bindTooltip(tooltip)
      .addTo(groundTrackLayer);
  });
}

function placeSatelliteMarker(lat, lon) {
  const latLng = [lat, lon];
  if (!satelliteMarker) {
    satelliteMarker = L.circleMarker(latLng, {
      radius: 6,
      color: '#f87171',
      fillColor: '#f87171',
      fillOpacity: 0.9,
      weight: 2
    }).addTo(map);
  } else {
    satelliteMarker.setLatLng(latLng);
  }
}

function updateSatelliteMarker(t) {
  if (!state.groundTrack.samples.length) return;
  const samples = state.groundTrack.samples;
  if (samples.length === 1) {
    const only = samples[0];
    placeSatelliteMarker(only.lat, only.lon);
    state.lastSpeedKmS = only.speedKmS;
    return;
  }
  if (t <= samples[0].t) {
    const s = samples[0];
    placeSatelliteMarker(s.lat, s.lon);
    state.lastSpeedKmS = s.speedKmS;
    return;
  }
  if (t >= samples[samples.length - 1].t) {
    const s = samples[samples.length - 1];
    placeSatelliteMarker(s.lat, s.lon);
    state.lastSpeedKmS = s.speedKmS;
    return;
  }
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const next = samples[i];
    if (t <= next.t) {
      const ratio = (t - prev.t) / (next.t - prev.t);
      const lat = prev.lat + ratio * (next.lat - prev.lat);
      const lon = interpolateLongitude(prev.lon, next.lon, ratio);
      const speed = prev.speedKmS + ratio * (next.speedKmS - prev.speedKmS);
      placeSatelliteMarker(lat, lon);
      state.lastSpeedKmS = speed;
      return;
    }
  }
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
  if (dom.statOGS) {
    dom.statOGS.textContent = state.activeOGS
      ? `${state.activeOGS.name} (${formatNumber(state.activeOGS.aperture_m, 1)} m)`
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
  updateSatelliteMarker(clamped);
  if (source !== 'animation') {
    lastTimestamp = null;
  }
  updateStats();
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
    let finalA = targetA;
    let satisfied = true;
    let errorPpm = 0;
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
    params.a_km = setParam('a', finalA, { emit: false });
    updateResonanceFeedback();
  }

  state.params = params;
  state.meanMotion = Math.sqrt(MU / Math.pow(params.a_km, 3));
  state.orbitPeriodSec = periodFromA(params.a_km);

  computeOrbitExtrema(params);
  generateGroundTrack(params);
  renderGroundTrack(params);

  updateTimeHorizon();

  if (resetTime) setTime(0, { source: 'update' });
  else setTime(state.simT, { source: 'update' });

  updateActiveOrbitLabel(params.name);
  updateStats();
}

function setPlaying(playing) {
  state.playing = playing;
  if (!playing) lastTimestamp = null;
}

function animationLoop(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const dt = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;
  if (state.playing && state.params) {
    const newTime = state.simT + dt * state.speedMul;
    if (newTime > state.timeHorizon) {
      setTime(newTime % state.timeHorizon, { source: 'animation' });
    } else {
      setTime(newTime, { source: 'animation' });
    }
  }
  animationFrame = requestAnimationFrame(animationLoop);
}
function saveOrbit() {
  if (!state.params) updateOrbitFromUI();
  const orbit = state.params ? { ...state.params } : readParams();
  const key = 'qkd_orbits';
  const arr = JSON.parse(localStorage.getItem(key) || '[]');
  const idx = arr.findIndex(o => o.name === orbit.name);
  if (idx >= 0) arr[idx] = orbit;
  else arr.push(orbit);
  localStorage.setItem(key, JSON.stringify(arr));
  alert(`Orbit saved as "${orbit.name}".`);
}

function clearStoredOrbits() {
  if (!confirm('Delete all saved orbits?')) return;
  localStorage.removeItem('qkd_orbits');
  alert('Saved orbits cleared.');
}

function importOrbit() {
  const key = 'qkd_orbits';
  const arr = JSON.parse(localStorage.getItem(key) || '[]');
  if (!arr.length) {
    alert('No saved orbits. Visit /orbit3d and save one first.');
    return;
  }
  const names = arr.map(o => o.name).join(', ');
  const sel = prompt(`Available orbits: ${names}\nWhich orbit would you like to import?`);
  if (!sel) return;
  const orbit = arr.find(o => o.name === sel.trim());
  if (!orbit) {
    alert('Orbit not found.');
    return;
  }
  setParam('a', orbit.a_km, { emit: false });
  setParam('e', orbit.e, { emit: false });
  setParam('i', orbit.i_deg, { emit: false });
  setParam('raan', orbit.raan_deg, { emit: false });
  setParam('argp', orbit.argp_deg, { emit: false });
  setParam('M0', orbit.M0_deg, { emit: false });
  setParam('aperture', orbit.aperture_m ?? 1.0, { emit: false });
  dom.satName.value = orbit.name;
  updateActiveOrbitLabel(orbit.name);
  if (orbit.epoch) {
    const iso = new Date(orbit.epoch).toISOString().slice(0, 16);
    dom.epoch.value = iso;
  }

  let revAnswer = prompt(
    'Number of revolutions to display (1-10) or type "repeat" for closed track.',
    dom.revSelect.value === 'repeat' ? 'repeat' : dom.revSelect.value
  );
  if (revAnswer) {
    revAnswer = revAnswer.trim().toLowerCase();
    if (revAnswer === 'repeat') {
      dom.revSelect.value = 'repeat';
      setResonanceEnabled(true);
    } else {
      const n = clampInt(Number(revAnswer), 1, 10);
      dom.revSelect.value = String(n);
      if (state.resonance.enabled) setResonanceEnabled(false);
      else {
        state.revCount = n;
        updateTimeHorizon();
      }
    }
  }

  updateOrbitFromUI({ resetTime: true });
}

function open3D() {
  window.open('/orbit3d', '_blank', 'noopener');
}

function setResonanceEnabled(enabled) {
  state.resonance.enabled = enabled;
  dom.chkCloseTrack.checked = enabled;
  dom.resonanceControls.classList.toggle('hidden', !enabled);
  if (enabled) {
    dom.revSelect.value = 'repeat';
    const period = state.orbitPeriodSec || periodFromA(getParamValue('a'));
    const bestRot = findBestRotations(1, period);
    writeResonanceInputs(1, bestRot);
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

function getOGSAperture() {
  let val = Number(dom.ogsAperture.value);
  if (!Number.isFinite(val)) val = Number(dom.ogsApertureSlider.value) || 1.0;
  val = clamp(val, 0.1, 10);
  dom.ogsAperture.value = val.toFixed(1);
  dom.ogsApertureSlider.value = val;
  return val;
}

function updateOGSModeButton() {
  if (state.ogsMode) dom.btnCreateOGS.classList.add('active');
  else dom.btnCreateOGS.classList.remove('active');
}

function addOGSMarker(data) {
  const marker = L.circleMarker([data.lat, data.lon], {
    radius: 7,
    color: '#facc15',
    fillColor: '#facc15',
    fillOpacity: 0.75,
    weight: 2
  }).addTo(ogsLayer);

  marker.bindTooltip(`${data.name} (aperture ${formatNumber(data.aperture_m, 1)} m)`);

  marker.on('click', () => {
    state.activeOGS = data;
    updateStats();
  });
}

async function loadOGS() {
  try {
    const resp = await fetch('/api/ogs');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    ogsLayer.clearLayers();
    (data || []).forEach(addOGSMarker);
  } catch (err) {
    console.error('Failed to load OGS stations:', err);
    alert('Failed to load OGS stations.');
  }
}

async function handleMapClick(e) {
  if (!state.ogsMode) return;
  const name = prompt('Name for the OGS station:');
  if (!name) return;
  const aperture = getOGSAperture();
  const payload = {
    name: name.trim(),
    lat: e.latlng.lat,
    lon: e.latlng.lng,
    aperture_m: aperture
  };
  try {
    const resp = await fetch('/api/ogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const saved = await resp.json();
    addOGSMarker(saved);
    state.activeOGS = saved;
    updateStats();
  } catch (err) {
    console.error('Failed to create OGS:', err);
    alert('Failed to create OGS. Ensure the location is within Europe.');
  } finally {
    state.ogsMode = false;
    updateOGSModeButton();
  }
}

async function clearOGS() {
  if (!confirm('Delete all OGS stations?')) return;
  try {
    await fetch('/api/ogs', { method: 'DELETE' });
    ogsLayer.clearLayers();
    state.activeOGS = null;
    updateStats();
  } catch (err) {
    console.error('Failed to clear OGS stations:', err);
    alert('Failed to clear OGS stations.');
  }
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

    const defaultValue =
      (id === 'a' && DEFAULT_PARAMS.a_km) ||
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

function initOgsControls() {
  dom.ogsAperture = byId('ogsAperture');
  dom.ogsApertureSlider = byId('ogsApertureSlider');
  dom.ogsAperture.value = '1.0';
  dom.ogsApertureSlider.value = '1.0';
  dom.ogsAperture.addEventListener('change', getOGSAperture);
  dom.ogsApertureSlider.addEventListener('input', e => {
    dom.ogsAperture.value = Number(e.target.value).toFixed(1);
    getOGSAperture();
  });
}

function initMap() {
  const WORLD_BOUNDS = L.latLngBounds([[-85, -180], [85, 180]]);
  map = L.map('map', {
    minZoom: 2,
    maxZoom: 18,
    worldCopyJump: false,
    maxBounds: WORLD_BOUNDS,
    maxBoundsViscosity: 1.0
  }).setView([50, 10], 4);

  function fitWorldToWidth() {
    const w = map.getSize().x;
    let z = Math.floor(Math.log2(w / 256));
    z = Math.max(0, Math.min(z, map.getMaxZoom()));
    map.setMinZoom(z);
    map.setView([0, 0], z);
  }
  fitWorldToWidth();
  map.on('resize', fitWorldToWidth);

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    detectRetina: true,
    noWrap: true
  }).addTo(map);

  const esriSat = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Tiles © Esri',
      noWrap: true,
      detectRetina: false,
      maxZoom: 18,
      maxNativeZoom: 17,
      bounds: WORLD_BOUNDS
    }
  );

  L.control.layers(
    { 'Street (OSM)': osm, 'Satellite (Esri)': esriSat },
    {},
    { position: 'topleft', collapsed: true }
  ).addTo(map);

  function ringLngLatToLatLng(ring) {
    return ring.map(([x, y]) => [y, x]);
  }

  function collectOuterRingsFromGeometry(geom, out) {
    if (!geom) return;
    const type = geom.type;
    if (type === 'Polygon') {
      out.push(ringLngLatToLatLng(geom.coordinates[0]));
    } else if (type === 'MultiPolygon') {
      geom.coordinates.forEach(poly => out.push(ringLngLatToLatLng(poly[0])));
    } else if (type === 'GeometryCollection') {
      geom.geometries.forEach(g => collectOuterRingsFromGeometry(g, out));
    }
  }

  function extractHoles(geojson) {
    const holes = [];
    if (!geojson) return holes;
    if (geojson.type === 'FeatureCollection') {
      geojson.features.forEach(f => collectOuterRingsFromGeometry(f.geometry, holes));
    } else if (geojson.type === 'Feature') {
      collectOuterRingsFromGeometry(geojson.geometry, holes);
    } else {
      collectOuterRingsFromGeometry(geojson, holes);
    }
    return holes;
  }

  fetch('/static/data/europe_union.geojson?v=' + Date.now())
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(geo => {
      const layer = L.geoJSON(geo, { style: { color: '#60a5fa', weight: 2, fill: false } }).addTo(map);
      map.fitBounds(layer.getBounds().pad(0.2));
      const holes = extractHoles(geo);
      const worldOuter = [
        [-89.9, -179.9],
        [-89.9, 179.9],
        [89.9, 179.9],
        [89.9, -179.9]
      ];
      const mask = L.polygon([worldOuter, ...holes], {
        stroke: false,
        fill: true,
        fillColor: '#000',
        fillOpacity: 0.35,
        interactive: false
      }).addTo(map);

      const MaskControl = L.Control.extend({
        onAdd() {
          const button = L.DomUtil.create('button', 'leaflet-bar');
          button.textContent = 'EU Mask';
          button.style.cssText = 'cursor:pointer;background:#111827;color:#e2e8f0;padding:4px 8px;border:1px solid #1f2937';
          L.DomEvent.on(button, 'click', e => {
            L.DomEvent.stopPropagation(e);
            if (map.hasLayer(mask)) map.removeLayer(mask);
            else mask.addTo(map);
          });
          return button;
        }
      });
      map.addControl(new MaskControl({ position: 'topleft' }));
    })
    .catch(err => {
      console.error('Failed to load EU outline:', err);
      alert('Failed to load EU outline.');
    });

  groundTrackLayer = L.layerGroup().addTo(map);
  ogsLayer = L.layerGroup().addTo(map);

  map.on('click', handleMapClick);
  loadOGS();
}
function wireUI() {
  dom.panel = byId('panel');
  dom.panelToggle = byId('panelToggle');
  dom.panelBody = byId('panelBody');
  dom.satName = byId('satName');
  dom.epoch = byId('epoch');
  dom.activeOrbit = byId('activeOrbit');
  dom.btnSaveOrbit = byId('btnSaveOrbit');
  dom.btnImportOrbit = byId('btnImportOrbit');
  dom.btnClearOrbits = byId('btnClearOrbits');
  dom.btnOpen3D = byId('btnOpen3D');
  dom.btnCreateOGS = byId('btnCreateOGS');
  dom.btnClearOGS = byId('btnClearOGS');
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
  dom.statOGS = byId('statOGS');

  initParamControls();
  initOgsControls();

  const togglePanel = () => {
    const collapsed = dom.panel.classList.toggle('collapsed');
    const expanded = !collapsed;
    dom.panelToggle.textContent = expanded ? PANEL_TOGGLE_LABEL.collapse : PANEL_TOGGLE_LABEL.expand;
    dom.panelToggle.setAttribute('aria-expanded', String(expanded));
  };

  dom.panelToggle.addEventListener('click', togglePanel);
  dom.panelToggle.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      togglePanel();
    }
  });

  dom.epoch.value = localISO();
  DEFAULT_PARAMS.epoch = dom.epoch.value;
  updateActiveOrbitLabel(DEFAULT_PARAMS.name);

  dom.satName.addEventListener('input', () => {
    updateActiveOrbitLabel(dom.satName.value.trim());
    if (state.params) state.params.name = dom.satName.value.trim();
  });

  dom.btnSaveOrbit.addEventListener('click', saveOrbit);
  dom.btnImportOrbit.addEventListener('click', importOrbit);
  dom.btnClearOrbits.addEventListener('click', clearStoredOrbits);
  dom.btnOpen3D.addEventListener('click', open3D);
  dom.btnCreateOGS.addEventListener('click', () => {
    state.ogsMode = !state.ogsMode;
    updateOGSModeButton();
  });
  dom.btnClearOGS.addEventListener('click', clearOGS);

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
      const n = Number(value);
      state.revCount = n;
      if (state.resonance.enabled) setResonanceEnabled(false);
      else {
        updateTimeHorizon();
        updateOrbitFromUI();
      }
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
  updateOGSModeButton();
}

function bootstrap() {
  initMap();
  wireUI();
  updateOrbitFromUI({ resetTime: true });
  animationFrame = requestAnimationFrame(animationLoop);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
