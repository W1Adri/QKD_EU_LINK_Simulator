import {
  state,
  mutate,
  subscribe,
  togglePlay,
  setTimeIndex,
  setTimeWarp,
  setTimeline,
  setComputed,
  setTheme,
  ensureStationSelected,
  upsertStation,
  selectStation,
} from './state.js';
import { propagateOrbit, computeStationMetrics, constants as orbitConstants } from './orbit.js';
import {
  initMap,
  updateGroundTrack,
  updateSatellitePosition,
  renderStations as renderStations2D,
  updateLinkLine,
  focusOnStation,
  flyToOrbit,
  annotateStationTooltip,
} from './map2d.js';
import {
  initScene,
  updateOrbitPath,
  updateSatellite,
  renderStations as renderStations3D,
  updateLink as updateLink3D,
  setTheme as setSceneTheme,
} from './scene3d.js';
import { loadStationsFromServer, persistStation } from './groundStations.js';
import {
  isoNowLocal,
  clamp,
  formatAngle,
  formatDistanceKm,
  formatLoss,
  formatDoppler,
  smoothArray,
} from './utils.js';

const { EARTH_RADIUS_KM } = orbitConstants;

const elements = {};
let lastOrbitSignature = '';
let lastMetricsSignature = '';
let playingRaf = null;
let mapInstance;

function cacheElements() {
  const ids = [
    'satelliteName', 'epochInput', 'semiMajor', 'semiMajorSlider', 'eccentricity', 'eccentricitySlider',
    'inclination', 'inclinationSlider', 'raan', 'raanSlider', 'argPerigee', 'argPerigeeSlider',
    'meanAnomaly', 'meanAnomalySlider', 'resonanceToggle', 'resonanceOrbits', 'resonanceRotations',
    'satAperture', 'satApertureSlider', 'groundAperture', 'groundApertureSlider', 'wavelength',
    'wavelengthSlider', 'samplesPerOrbit', 'samplesPerOrbitSlider', 'timeSlider', 'btnPlay', 'btnPause',
    'btnStepBack', 'btnStepForward', 'btnResetTime', 'timeWarp', 'btnTheme', 'btnTogglePanels',
    'stationSelect', 'btnAddStation', 'btnFocusStation', 'timeLabel', 'elevationLabel', 'lossLabel',
    'distanceMetric', 'elevationMetric', 'zenithMetric', 'lossMetric', 'dopplerMetric',
    'threeContainer', 'mapContainer', 'chartLoss', 'chartElevation', 'chartDistance', 'stationDialog',
    'stationName', 'stationLat', 'stationLon', 'stationAperture', 'stationSave',
  ];
  ids.forEach((id) => {
    elements[id] = document.getElementById(id);
  });
  elements.variantLinks = document.querySelectorAll('.variant-picker a');
  elements.viewTabs = document.querySelectorAll('[data-view]');
  elements.viewGrid = document.querySelector('[data-view-container]');
  elements.workspace = document.querySelector('.workspace');
  elements.drawerHandles = document.querySelectorAll('.drawer-handle');
  elements.drawerMenuItems = document.querySelectorAll('.drawer-menu-item');
  elements.drawerPanels = document.querySelectorAll('[data-panel]');
}

function getPanelElement(panelId) {
  if (!panelId) return null;
  return document.querySelector(`[data-panel="${panelId}"]`);
}

function updateDrawerHandle(panel, collapsed) {
  if (!panel) return;
  const handle = panel.querySelector('.drawer-handle');
  if (!handle) return;
  const isPrimary = panel.dataset.panel === 'primary';
  const icon = handle.querySelector('.icon');
  const expandedIcon = isPrimary ? '◀' : '▶';
  const collapsedIcon = isPrimary ? '▶' : '◀';
  handle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (icon) {
    icon.textContent = collapsed ? collapsedIcon : expandedIcon;
  }
}

function setPanelCollapsed(panelId, collapsed) {
  const panel = getPanelElement(panelId);
  if (!panel) return;
  panel.dataset.collapsed = collapsed ? 'true' : 'false';
  updateDrawerHandle(panel, collapsed);
  if (!elements.workspace) return;
  const className = panelId === 'secondary' ? 'is-secondary-collapsed' : 'is-primary-collapsed';
  elements.workspace.classList.toggle(className, collapsed);
}

function activateDrawerSection(panelId, requestedSectionId) {
  const panel = getPanelElement(panelId);
  if (!panel) return;
  const items = panel.querySelectorAll('.drawer-menu-item');
  const hasSection = (sectionId) => !!panel.querySelector(`.drawer-content [data-section="${sectionId}"]`);
  let sectionId = requestedSectionId;
  if (!sectionId || !hasSection(sectionId)) {
    sectionId = items[0]?.dataset.sectionTarget;
  }
  if (!sectionId) return;
  panel.dataset.activeSection = sectionId;
  items.forEach((item) => {
    const active = item.dataset.sectionTarget === sectionId;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  panel.querySelectorAll('.drawer-content [data-section]').forEach((section) => {
    const active = section.dataset.section === sectionId;
    section.hidden = !active;
    section.classList.toggle('is-active', active);
  });
}

function updatePanelsButton() {
  if (!elements.btnTogglePanels) return;
  const anyExpanded = Array.from(document.querySelectorAll('[data-panel]')).some(
    (panel) => panel.dataset.collapsed !== 'true',
  );
  elements.btnTogglePanels.textContent = anyExpanded ? 'Ocultar paneles' : 'Mostrar paneles';
}

function initializeDrawers() {
  if (!elements.drawerPanels) return;
  elements.drawerPanels.forEach((panel) => {
    const panelId = panel.dataset.panel;
    const collapsed = panel.dataset.collapsed === 'true';
    const activeSection = panel.dataset.activeSection;
    activateDrawerSection(panelId, activeSection);
    setPanelCollapsed(panelId, collapsed);
  });
  updatePanelsButton();
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.dataset.theme = 'dark';
  } else {
    delete document.body.dataset.theme;
  }
  setSceneTheme?.(theme);
  if (elements.btnTheme) {
    elements.btnTheme.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    elements.btnTheme.textContent = theme === 'dark' ? 'Modo claro' : 'Modo oscuro';
  }
}

function initDefaults() {
  if (elements.epochInput) {
    const preset = isoNowLocal();
    elements.epochInput.value = preset;
    mutate((draft) => {
      draft.epoch = preset;
    });
  }
  if (elements.timeSlider) {
    elements.timeSlider.min = 0;
    elements.timeSlider.max = 1;
    elements.timeSlider.value = 0;
  }
  if (elements.timeWarp) {
    elements.timeWarp.value = String(state.time.timeWarp);
  }
  if (elements.btnTheme) {
    const saved = localStorage.getItem('qkd-theme');
    if (saved) {
      setTheme(saved);
    }
    applyTheme(state.theme);
  }
  if (elements.viewGrid) {
    elements.viewGrid.dataset.mode = state.viewMode ?? 'dual';
  }
  initializeDrawers();
}

function bindEvents() {
  const sliderPairs = [
    ['semiMajor', 'semiMajorSlider', (value) => clamp(Number(value), 6600, 9000), 'orbital.semiMajor'],
    ['eccentricity', 'eccentricitySlider', (value) => clamp(Number(value), 0, 0.2), 'orbital.eccentricity'],
    ['inclination', 'inclinationSlider', (value) => clamp(Number(value), 0, 180), 'orbital.inclination'],
    ['raan', 'raanSlider', (value) => clamp(Number(value), 0, 360), 'orbital.raan'],
    ['argPerigee', 'argPerigeeSlider', (value) => clamp(Number(value), 0, 360), 'orbital.argPerigee'],
    ['meanAnomaly', 'meanAnomalySlider', (value) => clamp(Number(value), 0, 360), 'orbital.meanAnomaly'],
    ['satAperture', 'satApertureSlider', (value) => clamp(Number(value), 0.1, 3), 'optical.satAperture'],
    ['groundAperture', 'groundApertureSlider', (value) => clamp(Number(value), 0.1, 5), 'optical.groundAperture'],
    ['wavelength', 'wavelengthSlider', (value) => clamp(Number(value), 600, 1700), 'optical.wavelength'],
    ['samplesPerOrbit', 'samplesPerOrbitSlider', (value) => clamp(Number(value), 60, 720), 'samplesPerOrbit'],
  ];

  sliderPairs.forEach(([inputId, sliderId, normalize, path]) => {
    const inputEl = elements[inputId];
    const sliderEl = elements[sliderId];
    if (!inputEl || !sliderEl) return;
    const updateStateFromValue = (value) => {
      const normalized = normalize(value);
      inputEl.value = String(normalized);
      sliderEl.value = String(normalized);
      mutate((draft) => {
        const [section, field] = path.split('.');
        if (section === 'orbital') draft.orbital[field] = normalized;
        else if (section === 'optical') draft.optical[field] = normalized;
        else draft[field] = normalized;
      });
    };
    inputEl.addEventListener('change', (event) => updateStateFromValue(event.target.value));
    sliderEl.addEventListener('input', (event) => updateStateFromValue(event.target.value));
  });

  Array.from(elements.drawerHandles ?? []).forEach((handle) => {
    handle.addEventListener('click', () => {
      const target = handle.dataset.target;
      const panel = getPanelElement(target);
      if (!panel) return;
      const collapsed = panel.dataset.collapsed === 'true';
      setPanelCollapsed(target, !collapsed);
      updatePanelsButton();
    });
  });

  Array.from(elements.drawerMenuItems ?? []).forEach((item) => {
    item.addEventListener('click', () => {
      const panel = item.closest('[data-panel]');
      const panelId = panel?.dataset.panel;
      const section = item.dataset.sectionTarget;
      if (!panelId || !section) return;
      activateDrawerSection(panelId, section);
    });
  });

  elements.satelliteName?.addEventListener('input', (event) => {
    mutate((draft) => {
      draft.satelliteName = event.target.value;
    });
  });

  elements.epochInput?.addEventListener('change', (event) => {
    mutate((draft) => {
      draft.epoch = event.target.value;
    });
  });

  elements.resonanceToggle?.addEventListener('change', (event) => {
    mutate((draft) => {
      draft.resonance.enabled = event.target.checked;
    });
    document.querySelectorAll('.resonance-grid, .dual').forEach((el) => {
      if (event.target.checked) el.removeAttribute('data-hidden');
      else el.setAttribute('data-hidden', '');
    });
  });

  elements.resonanceOrbits?.addEventListener('change', (event) => {
    mutate((draft) => {
      draft.resonance.orbits = clamp(Number(event.target.value), 1, 30);
    });
  });

  elements.resonanceRotations?.addEventListener('change', (event) => {
    mutate((draft) => {
      draft.resonance.rotations = clamp(Number(event.target.value), 1, 30);
    });
  });

  elements.btnPlay?.addEventListener('click', () => {
    playbackLoop.lastTimestamp = null;
    togglePlay(true);
  });
  elements.btnPause?.addEventListener('click', () => togglePlay(false));
  elements.btnResetTime?.addEventListener('click', () => setTimeIndex(0));
  elements.btnStepBack?.addEventListener('click', () => setTimeIndex(Math.max(0, state.time.index - 1)));
  elements.btnStepForward?.addEventListener('click', () => setTimeIndex(Math.min(state.time.timeline.length - 1, state.time.index + 1)));

  elements.timeSlider?.addEventListener('input', (event) => setTimeIndex(Number(event.target.value)));
  elements.timeWarp?.addEventListener('change', (event) => setTimeWarp(Number(event.target.value)));

  elements.viewTabs?.forEach((tab) => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.view;
      mutate((draft) => {
        draft.viewMode = mode;
      });
      elements.viewTabs.forEach((other) => {
        other.classList.toggle('is-active', other === tab);
        other.setAttribute('aria-selected', other === tab ? 'true' : 'false');
      });
      if (elements.viewGrid) {
        elements.viewGrid.dataset.mode = mode;
      }
    });
  });

  elements.btnTheme?.addEventListener('click', () => {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    localStorage.setItem('qkd-theme', next);
  });

  elements.btnTogglePanels?.addEventListener('click', () => {
    const panels = Array.from(document.querySelectorAll('[data-panel]'));
    if (!panels.length) return;
    const shouldCollapse = panels.some((panel) => panel.dataset.collapsed !== 'true');
    panels.forEach((panel) => setPanelCollapsed(panel.dataset.panel, shouldCollapse));
    updatePanelsButton();
  });

  elements.btnAddStation?.addEventListener('click', () => elements.stationDialog?.showModal());

  if (elements.stationDialog && elements.stationSave) {
    elements.stationDialog.addEventListener('close', () => {
      elements.stationName.value = '';
      elements.stationLat.value = '';
      elements.stationLon.value = '';
    });

    elements.stationSave.addEventListener('click', (event) => {
      event.preventDefault();
      const name = elements.stationName.value.trim();
      const lat = Number(elements.stationLat.value);
      const lon = Number(elements.stationLon.value);
      const aperture = Number(elements.stationAperture.value ?? 1.0);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const id = `${name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`;
      const station = { id, name, lat, lon, aperture };
      upsertStation(station);
      persistStation(station);
      elements.stationDialog.close('saved');
      refreshStationSelect();
      recomputeMetricsOnly();
    });
  }

  elements.stationSelect?.addEventListener('change', (event) => {
    selectStation(event.target.value || null);
    recomputeMetricsOnly();
  });

  elements.btnFocusStation?.addEventListener('click', () => {
    const station = getSelectedStation();
    focusOnStation(station);
  });
}

function getSelectedStation() {
  const { list, selectedId } = state.stations;
  return list.find((item) => item.id === selectedId) ?? null;
}

function refreshStationSelect() {
  if (!elements.stationSelect) return;
  const { list, selectedId } = state.stations;
  elements.stationSelect.innerHTML = '';
  list.forEach((station) => {
    const option = document.createElement('option');
    option.value = station.id;
    option.textContent = station.name;
    option.selected = station.id === selectedId;
    elements.stationSelect.appendChild(option);
  });
}

function orbitSignature(snapshot) {
  return JSON.stringify({
    orbital: snapshot.orbital,
    resonance: snapshot.resonance,
    samplesPerOrbit: snapshot.samplesPerOrbit,
  });
}

function metricsSignature(snapshot) {
  return JSON.stringify({
    optical: snapshot.optical,
    station: snapshot.stations.selectedId,
    stations: snapshot.stations.list.map((s) => s.id),
  });
}

function recomputeOrbit(force = false) {
  const signature = orbitSignature(state);
  if (!force && signature === lastOrbitSignature) return;
  lastOrbitSignature = signature;

  const orbitData = propagateOrbit(state);
  setTimeline({ timeline: orbitData.timeline, totalSeconds: orbitData.totalTime });
  const metrics = computeStationMetrics(orbitData.dataPoints, getSelectedStation(), state.optical);
  setComputed({
    orbitPeriod: orbitData.orbitPeriod,
    dataPoints: orbitData.dataPoints,
    groundTrack: orbitData.groundTrack,
    metrics,
  });
  lastMetricsSignature = metricsSignature(state);
  scheduleVisualUpdate();
}

function recomputeMetricsOnly(force = false) {
  if (!state.computed.dataPoints.length) return;
  const signature = metricsSignature(state);
  if (!force && signature === lastMetricsSignature) return;
  lastMetricsSignature = signature;
  const metrics = computeStationMetrics(state.computed.dataPoints, getSelectedStation(), state.optical);
  setComputed({
    ...state.computed,
    metrics,
  });
  scheduleVisualUpdate();
}

function scheduleVisualUpdate() {
  const { dataPoints, groundTrack } = state.computed;
  if (!dataPoints.length) return;
  const index = clamp(state.time.index, 0, dataPoints.length - 1);
  const current = dataPoints[index];

  updateGroundTrack(groundTrack);
  updateSatellitePosition({ lat: current.lat, lon: current.lon }, computeFootprint(current.alt));
  updateOrbitPath(dataPoints);
  updateSatellite(current);
  const station = getSelectedStation();
  updateLinkLine({ lat: current.lat, lon: current.lon }, station);
  updateLink3D(current, station);
  renderStations2D(state.stations.list, state.stations.selectedId);
  renderStations3D(state.stations.list, state.stations.selectedId);
  updateMetricsUI(index);
}

function computeFootprint(altitudeKm) {
  if (!Number.isFinite(altitudeKm) || altitudeKm <= 0) return 0;
  const r = EARTH_RADIUS_KM;
  return Math.sqrt((r + altitudeKm) ** 2 - r ** 2);
}

function updateMetricsUI(index) {
  const { metrics } = state.computed;
  if (!metrics.distanceKm.length) {
    elements.distanceMetric && (elements.distanceMetric.textContent = '--');
    elements.elevationMetric && (elements.elevationMetric.textContent = '--');
    elements.zenithMetric && (elements.zenithMetric.textContent = '--');
    elements.lossMetric && (elements.lossMetric.textContent = '--');
    elements.dopplerMetric && (elements.dopplerMetric.textContent = '--');
    return;
  }

  const distanceKm = metrics.distanceKm[index];
  const elevation = metrics.elevationDeg[index];
  const loss = metrics.lossDb[index];
  const doppler = metrics.doppler[index];
  const zenith = 90 - elevation;

  if (elements.distanceMetric) elements.distanceMetric.textContent = formatDistanceKm(distanceKm);
  if (elements.elevationMetric) elements.elevationMetric.textContent = formatAngle(elevation);
  if (elements.zenithMetric) elements.zenithMetric.textContent = formatAngle(zenith);
  if (elements.lossMetric) elements.lossMetric.textContent = formatLoss(loss);
  if (elements.dopplerMetric) elements.dopplerMetric.textContent = formatDoppler(doppler);

  if (elements.timeLabel) {
    const t = state.time.timeline[index] ?? 0;
    elements.timeLabel.textContent = `${t.toFixed(1)} s`;
  }
  if (elements.elevationLabel) elements.elevationLabel.textContent = formatAngle(elevation);
  if (elements.lossLabel) elements.lossLabel.textContent = formatLoss(loss);

  const station = getSelectedStation();
  if (station) annotateStationTooltip(station, { distanceKm });

  drawSparklines();
}

function drawSparklines() {
  const { metrics } = state.computed;
  const draw = (container, values, color) => {
    if (!container) return;
    let canvas = container.querySelector('canvas');
    const width = container.clientWidth || 240;
    const height = container.clientHeight || 120;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      container.appendChild(canvas);
    }
    const ctx = canvas.getContext('2d');
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!values.length) return;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.beginPath();
    values.forEach((value, idx) => {
      const x = (idx / (values.length - 1)) * (canvas.width - 8) + 4;
      const y = canvas.height - ((value - min) / span) * (canvas.height - 8) - 4;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  draw(elements.chartLoss, smoothArray(state.computed.metrics.lossDb, 7), '#7c3aed');
  draw(elements.chartElevation, smoothArray(state.computed.metrics.elevationDeg, 5), '#0ea5e9');
  draw(elements.chartDistance, smoothArray(state.computed.metrics.distanceKm, 5), '#22c55e');
}

function playbackLoop(timestamp) {
  if (!state.time.playing || state.time.timeline.length === 0) {
    playingRaf = requestAnimationFrame(playbackLoop);
    return;
  }
  if (!playbackLoop.lastTimestamp) playbackLoop.lastTimestamp = timestamp;
  const dt = (timestamp - playbackLoop.lastTimestamp) / 1000;
  playbackLoop.lastTimestamp = timestamp;

  const timeline = state.time.timeline;
  const totalTime = timeline[timeline.length - 1] ?? 0;
  const currentTime = timeline[state.time.index] ?? 0;
  const targetTime = currentTime + dt * state.time.timeWarp;
  let nextIndex = state.time.index;
  while (nextIndex < timeline.length - 1 && timeline[nextIndex] < targetTime) {
    nextIndex += 1;
  }
  if (targetTime >= totalTime) {
    nextIndex = 0;
  }
  if (nextIndex !== state.time.index) {
    setTimeIndex(nextIndex);
  }
  playingRaf = requestAnimationFrame(playbackLoop);
}

function onStateChange(snapshot) {
  ensureStationSelected();
  refreshStationSelect();
  if (elements.timeSlider && snapshot.time.timeline.length) {
    elements.timeSlider.max = snapshot.time.timeline.length - 1;
    elements.timeSlider.value = String(snapshot.time.index);
  }
  if (snapshot.theme) applyTheme(snapshot.theme);

  const orbitSig = orbitSignature(snapshot);
  if (orbitSig !== lastOrbitSignature) {
    recomputeOrbit(true);
    return;
  }

  const metricsSig = metricsSignature(snapshot);
  if (metricsSig !== lastMetricsSignature) {
    recomputeMetricsOnly(true);
    return;
  }

  scheduleVisualUpdate();
}

async function initialize() {
  cacheElements();
  initDefaults();
  bindEvents();

  mapInstance = initMap(elements.mapContainer);
  await initScene(elements.threeContainer);
  applyTheme(state.theme);

  await loadStationsFromServer();
  refreshStationSelect();
  recomputeOrbit(true);
  subscribe(onStateChange, false);
  playingRaf = requestAnimationFrame(playbackLoop);
  if (mapInstance) flyToOrbit(state.computed.groundTrack);
}

initialize();
