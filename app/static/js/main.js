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
  toggleBaseLayer,
  setBaseLayer,
  invalidateSize as invalidateMap,
} from './map2d.js';
import {
  initScene,
  updateOrbitPath,
  updateSatellite,
  renderStations as renderStations3D,
  updateLink as updateLink3D,
  setEarthRotationFromTime,
  setTheme as setSceneTheme,
  frameOrbitView,
  updateGroundTrackSurface,
  updateGroundTrackVector,
} from './scene3d.js';
import { loadStationsFromServer, persistStation } from './groundStations.js';
import {
  isoNowLocal,
  clamp,
  formatAngle,
  formatDistanceKm,
  formatLoss,
  formatDoppler,
  formatDuration,
  smoothArray,
} from './utils.js';
import { searchResonances } from './resonanceSolver.js';

const { EARTH_RADIUS_KM, MIN_SEMI_MAJOR, MAX_SEMI_MAJOR } = orbitConstants;

const elements = {};
const DRAFT_SAMPLES_PER_ORBIT = 36;

let orbitSamplesOverride = null;
let mapInstance;
let currentMapStyle = 'standard';
let lastOrbitSignature = '';
let lastMetricsSignature = '';
let playingRaf = null;
let panelWidth = 360;
let lastExpandedPanelWidth = 360;
let hasMapBeenFramed = false;
let hasSceneBeenFramed = false;

const optimizerState = {
  results: [],
  query: null,
};

const PANEL_MIN_WIDTH = 240;
const PANEL_MAX_WIDTH = 520;
const PANEL_COLLAPSE_THRESHOLD = 280;

function cacheElements() {
  const ids = [
    'satelliteName', 'epochInput', 'semiMajor', 'semiMajorSlider', 'optToleranceA', 'optToleranceSlider',
    'resonanceOrbits', 'resonanceOrbitsSlider', 'resonanceRotations', 'resonanceRotationsSlider',
    'optMinRot', 'optMinRotSlider', 'optMaxRot', 'optMaxRotSlider', 'optMinOrb', 'optMinOrbSlider', 'optMaxOrb', 'optMaxOrbSlider',
    'eccentricity', 'eccentricitySlider', 'inclination', 'inclinationSlider', 'raan', 'raanSlider', 'argPerigee', 'argPerigeeSlider',
    'meanAnomaly', 'meanAnomalySlider',
    'satAperture', 'satApertureSlider', 'groundAperture', 'groundApertureSlider', 'wavelength',
    'wavelengthSlider', 'samplesPerOrbit', 'samplesPerOrbitSlider', 'timeSlider', 'btnPlay', 'btnPause',
    'btnStepBack', 'btnStepForward', 'btnResetTime', 'timeWarp', 'btnTheme', 'btnPanelToggle',
    'btnMapStyle', 'panelReveal', 'panelResizer', 'stationSelect', 'btnAddStation', 'btnFocusStation', 'timeLabel',
    'elevationLabel', 'lossLabel', 'distanceMetric', 'elevationMetric', 'zenithMetric', 'lossMetric',
    'dopplerMetric', 'threeContainer', 'mapContainer', 'chartLoss', 'chartElevation', 'chartDistance', 'orbitMessages',
    'stationDialog', 'stationName', 'stationLat', 'stationLon', 'stationAperture', 'stationSave',
    'optimizerForm', 'optSearchBtn', 'optSummary', 'optResults',
  ];
  ids.forEach((id) => {
    elements[id] = document.getElementById(id);
  });
  elements.workspace = document.querySelector('.workspace');
  elements.controlPanel = document.getElementById('controlPanel');
  elements.panelTabs = document.querySelectorAll('.panel-tabs [data-section-target]');
  elements.panelSections = document.querySelectorAll('.panel-section');
  elements.viewTabs = document.querySelectorAll('[data-view]');
  elements.viewGrid = document.getElementById('viewGrid');
  elements.resonanceHint = document.querySelector('[data-resonance-hint]');
}

function activatePanelSection(sectionId) {
  if (!elements.panelSections?.length) return;
  const target = sectionId || elements.panelSections[0]?.dataset.section;
  elements.panelSections.forEach((section) => {
    const active = section.dataset.section === target;
    section.classList.toggle('is-active', active);
    section.hidden = !active;
  });
  elements.panelTabs?.forEach((tab) => {
    const active = tab.dataset.sectionTarget === target;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setPanelCollapsed(collapsed) {
  if (!elements.controlPanel || !elements.workspace) return;
  const isAlreadyCollapsed = elements.controlPanel.dataset.collapsed === 'true';
  if (collapsed && !isAlreadyCollapsed) {
    const rect = elements.controlPanel.getBoundingClientRect();
    panelWidth = rect.width;
    if (panelWidth >= PANEL_COLLAPSE_THRESHOLD) {
      lastExpandedPanelWidth = panelWidth;
    }
  }
  if (!collapsed && isAlreadyCollapsed) {
    applyPanelWidth(lastExpandedPanelWidth || panelWidth || 360);
  }
  elements.controlPanel.dataset.collapsed = collapsed ? 'true' : 'false';
  elements.workspace.classList.toggle('panel-collapsed', collapsed);
  if (elements.btnPanelToggle) {
    elements.btnPanelToggle.textContent = collapsed ? 'Mostrar panel' : 'Ocultar panel';
    elements.btnPanelToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  elements.controlPanel.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (elements.panelReveal) {
    elements.panelReveal.hidden = !collapsed;
  }
  if (elements.panelResizer) {
    elements.panelResizer.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    elements.panelResizer.tabIndex = collapsed ? -1 : 0;
  }
  setTimeout(() => invalidateMap(), 250);
}

function applyPanelWidth(width) {
  panelWidth = clamp(width, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH);
  if (elements.controlPanel) {
    elements.controlPanel.style.setProperty('--panel-width', `${panelWidth}px`);
  }
}

function normalizeInt(value, min, max) {
  const numeric = Math.round(Number(value) || 0);
  return clamp(numeric, min, max);
}

function normalizeTolerance(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  const snapped = Math.round(numeric * 2) / 2;
  return clamp(snapped, 0, 1000);
}

function formatDecimal(value, decimals = 3) {
  if (!Number.isFinite(value)) return '';
  const fixed = Number(value).toFixed(decimals);
  return fixed
    .replace(/\.(\d*?[1-9])0+$/, '.$1')
    .replace(/\.0+$/, '')
    .replace(/\.$/, '');
}

function syncPairValue(inputId, sliderId, value) {
  const numeric = Number(value);
  if (elements[inputId]) {
    if (Number.isFinite(numeric) && inputId === 'semiMajor') {
      elements[inputId].value = formatDecimal(numeric);
    } else {
      elements[inputId].value = Number.isFinite(numeric) ? String(numeric) : String(value);
    }
  }
  if (elements[sliderId]) {
    if (Number.isFinite(numeric) && sliderId === 'semiMajorSlider') {
      elements[sliderId].value = String(numeric);
    } else {
      elements[sliderId].value = Number.isFinite(numeric) ? String(numeric) : String(value);
    }
  }
}

function ensureOrderedIntRange(minId, minSliderId, maxId, maxSliderId, minLimit, maxLimit) {
  const minValue = normalizeInt(elements[minId]?.value, minLimit, maxLimit);
  let maxValue = normalizeInt(elements[maxId]?.value, minLimit, maxLimit);
  let adjustedMin = minValue;
  if (maxValue < minValue) {
    maxValue = minValue;
  }
  if (adjustedMin > maxLimit) {
    adjustedMin = maxLimit;
  }
  syncPairValue(minId, minSliderId, adjustedMin);
  syncPairValue(maxId, maxSliderId, maxValue);
  return { min: adjustedMin, max: maxValue };
}

function formatKm(value, fractionDigits = 3, useGrouping = true) {
  if (!Number.isFinite(value)) return '--';
  return Number(value).toLocaleString('es-ES', {
    useGrouping,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function renderOptimizerResults() {
  if (!elements.optResults) return;
  const { results, query } = optimizerState;

  if (!query) {
    if (elements.optSummary) elements.optSummary.textContent = '';
    elements.optResults.innerHTML = '<p class="hint">Introduce un objetivo y pulsa "Buscar resonancias".</p>';
    return;
  }

  const { targetA, toleranceKm, minRotations, maxRotations, minOrbits, maxOrbits } = query;
  const toleranceText = `${formatKm(toleranceKm, 3)} km`;
  if (elements.optSummary) {
    elements.optSummary.textContent = `Resultado: ${results.length} coincidencia(s) para a₀ = ${formatKm(
      targetA,
      3,
    )} km ± ${toleranceText}, j ∈ [${minRotations}, ${maxRotations}], k ∈ [${minOrbits}, ${maxOrbits}].`;
  }

  if (!results.length) {
    elements.optResults.innerHTML =
      '<p class="hint">No se encontraron resonancias en ese rango. Amplía la tolerancia o los límites j/k.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'optimizer-table';
  table.innerHTML =
    '<thead><tr><th>j (rot.)</th><th>k (órb.)</th><th>j/k</th><th>a req (km)</th><th>Δa (km)</th><th>Periodo</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');
  const maxRows = Math.min(results.length, 200);
  for (let idx = 0; idx < maxRows; idx += 1) {
    const hit = results[idx];
    const delta = hit.deltaKm;
    const deltaText = `${delta >= 0 ? '+' : ''}${formatKm(delta, 3)}`;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${hit.j}</td>
      <td>${hit.k}</td>
  <td>${formatKm(hit.ratio, 6, false)}</td>
      <td>${formatKm(hit.semiMajorKm, 3)}</td>
      <td>${deltaText}</td>
      <td>${formatDuration(hit.periodSec)}</td>
      <td><button type="button" class="opt-apply" data-index="${idx}">Aplicar</button></td>
    `;
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  elements.optResults.innerHTML = '';
  elements.optResults.appendChild(table);

  if (results.length > maxRows) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = `Se muestran ${maxRows} de ${results.length} resultados. Ajusta la tolerancia para acotar la búsqueda.`;
    elements.optResults.appendChild(note);
  }
}

function runResonanceSearch() {
  if (!elements.semiMajor || !elements.optResults) return;
  const rawTarget = Number(elements.semiMajor.value);
  if (!Number.isFinite(rawTarget) || rawTarget <= 0) {
    optimizerState.results = [];
    optimizerState.query = null;
    elements.optResults.innerHTML = '<p class="hint">Ajusta el semieje mayor objetivo con un valor válido (&gt; 0 km).</p>';
    if (elements.optSummary) elements.optSummary.textContent = '';
    return;
  }

  const targetA = clamp(rawTarget, MIN_SEMI_MAJOR, MAX_SEMI_MAJOR);
  const sanitizedTarget = Number(targetA.toFixed(3));
  syncPairValue('semiMajor', 'semiMajorSlider', sanitizedTarget);
  if (Math.abs((state.orbital.semiMajor ?? 0) - sanitizedTarget) > 1e-3) {
    mutate((draft) => {
      draft.orbital.semiMajor = sanitizedTarget;
    });
  }

  const toleranceKm = normalizeTolerance(elements.optToleranceA?.value);
  syncPairValue('optToleranceA', 'optToleranceSlider', toleranceKm);

  const rotationBounds = ensureOrderedIntRange('optMinRot', 'optMinRotSlider', 'optMaxRot', 'optMaxRotSlider', 1, 500);
  const orbitBounds = ensureOrderedIntRange('optMinOrb', 'optMinOrbSlider', 'optMaxOrb', 'optMaxOrbSlider', 1, 500);

  const results = searchResonances({
    targetA: sanitizedTarget,
    toleranceKm,
    minRotations: rotationBounds.min,
    maxRotations: rotationBounds.max,
    minOrbits: orbitBounds.min,
    maxOrbits: orbitBounds.max,
  });

  optimizerState.results = results;
  optimizerState.query = {
    targetA: sanitizedTarget,
    toleranceKm,
    minRotations: rotationBounds.min,
    maxRotations: rotationBounds.max,
    minOrbits: orbitBounds.min,
    maxOrbits: orbitBounds.max,
  };

  renderOptimizerResults();
}

function applyResonanceCandidate(hit) {
  if (!hit) return;

  mutate((draft) => {
    draft.resonance.enabled = true;
    draft.resonance.orbits = hit.k;
    draft.resonance.rotations = hit.j;
    draft.orbital.semiMajor = Number(hit.semiMajorKm.toFixed(3));
  });
  if (elements.resonanceOrbits) elements.resonanceOrbits.value = String(hit.k);
  if (elements.resonanceOrbitsSlider) elements.resonanceOrbitsSlider.value = String(hit.k);
  if (elements.resonanceRotations) elements.resonanceRotations.value = String(hit.j);
  if (elements.resonanceRotationsSlider) elements.resonanceRotationsSlider.value = String(hit.j);
  if (elements.semiMajor && !elements.semiMajor.matches(':focus')) {
    elements.semiMajor.value = formatDecimal(Number(hit.semiMajorKm));
  }
  if (elements.semiMajorSlider) {
    elements.semiMajorSlider.value = String(Number(hit.semiMajorKm));
  }

  if (elements.optSummary) {
    elements.optSummary.textContent = `Aplicada resonancia ${hit.j}:${hit.k} con a ≈ ${formatKm(hit.semiMajorKm, 3)} km.`;
  }
}

function handleOptimizerResultClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.matches('button.opt-apply[data-index]')) return;
  const idx = Number(target.dataset.index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= optimizerState.results.length) return;
  applyResonanceCandidate(optimizerState.results[idx]);
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.dataset.theme = 'dark';
  } else {
    delete document.body.dataset.theme;
  }
  setSceneTheme?.(theme);
  if (elements.btnTheme) {
    const pressed = theme === 'dark';
    elements.btnTheme.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    elements.btnTheme.textContent = pressed ? 'Modo claro' : 'Modo oscuro';
  }
}

function updateViewMode(mode) {
  const target = mode || 'dual';
  elements.viewTabs?.forEach((tab) => {
    const active = tab.dataset.view === target;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (elements.viewGrid) {
    elements.viewGrid.dataset.activeView = target;
  }
  setTimeout(() => invalidateMap(), 250);
}

function updateMapStyleButton(style) {
  if (!elements.btnMapStyle) return;
  if (style === 'satellite') {
    elements.btnMapStyle.textContent = 'Mapa estándar';
  } else {
    elements.btnMapStyle.textContent = 'Mapa satelital';
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
  if (elements.controlPanel) {
    const rect = elements.controlPanel.getBoundingClientRect();
    panelWidth = rect.width;
    lastExpandedPanelWidth = rect.width;
    applyPanelWidth(rect.width);
  }
  if (elements.semiMajor) {
    elements.semiMajor.min = MIN_SEMI_MAJOR.toFixed(3);
    elements.semiMajor.max = MAX_SEMI_MAJOR.toFixed(3);
    elements.semiMajor.step = 'any';
  }
  if (elements.semiMajorSlider) {
    elements.semiMajorSlider.min = MIN_SEMI_MAJOR.toFixed(3);
    elements.semiMajorSlider.max = MAX_SEMI_MAJOR.toFixed(3);
    elements.semiMajorSlider.step = '0.1';
  }
  const initialSemiMajor = clamp(state.orbital.semiMajor ?? MIN_SEMI_MAJOR, MIN_SEMI_MAJOR, MAX_SEMI_MAJOR);
  syncPairValue('semiMajor', 'semiMajorSlider', initialSemiMajor);
  if (elements.timeSlider) {
    elements.timeSlider.min = 0;
    elements.timeSlider.max = 1;
    elements.timeSlider.value = 0;
  }
  if (elements.timeWarp) {
    elements.timeWarp.value = String(state.time.timeWarp);
  }
  if (elements.optToleranceA && !elements.optToleranceA.value) {
    elements.optToleranceA.value = '0';
  }
  const initialTolerance = normalizeTolerance(elements.optToleranceA?.value);
  syncPairValue('optToleranceA', 'optToleranceSlider', initialTolerance);
  syncPairValue('resonanceOrbits', 'resonanceOrbitsSlider', state.resonance.orbits ?? 1);
  syncPairValue('resonanceRotations', 'resonanceRotationsSlider', state.resonance.rotations ?? 1);
  ensureOrderedIntRange('optMinRot', 'optMinRotSlider', 'optMaxRot', 'optMaxRotSlider', 1, 500);
  ensureOrderedIntRange('optMinOrb', 'optMinOrbSlider', 'optMaxOrb', 'optMaxOrbSlider', 1, 500);
  const savedTheme = localStorage.getItem('qkd-theme');
  if (savedTheme) {
    setTheme(savedTheme);
  }
  applyTheme(state.theme);
  updateViewMode(state.viewMode ?? 'dual');
  updateMapStyleButton(currentMapStyle);
  activatePanelSection('orbit');
  setPanelCollapsed(false);
  if (elements.panelReveal) {
    elements.panelReveal.hidden = true;
  }
  renderOptimizerResults();
}

function bindEvents() {
  const parseSemiMajor = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return clamp(state.orbital.semiMajor ?? MIN_SEMI_MAJOR, MIN_SEMI_MAJOR, MAX_SEMI_MAJOR);
    }
    const clamped = clamp(numeric, MIN_SEMI_MAJOR, MAX_SEMI_MAJOR);
    return Number(clamped.toFixed(3));
  };

  const sliderPairs = [
    ['semiMajor', 'semiMajorSlider', parseSemiMajor, 'orbital.semiMajor'],
    ['eccentricity', 'eccentricitySlider', (value) => clamp(Number(value), 0, 0.2), 'orbital.eccentricity'],
    ['inclination', 'inclinationSlider', (value) => clamp(Number(value), 0, 180), 'orbital.inclination'],
    ['raan', 'raanSlider', (value) => clamp(Number(value), 0, 360), 'orbital.raan'],
    ['argPerigee', 'argPerigeeSlider', (value) => clamp(Number(value), 0, 360), 'orbital.argPerigee'],
    ['meanAnomaly', 'meanAnomalySlider', (value) => clamp(Number(value), 0, 360), 'orbital.meanAnomaly'],
    ['resonanceOrbits', 'resonanceOrbitsSlider', (value) => normalizeInt(value, 1, 500), 'resonance.orbits'],
    ['resonanceRotations', 'resonanceRotationsSlider', (value) => normalizeInt(value, 1, 500), 'resonance.rotations'],
    ['satAperture', 'satApertureSlider', (value) => clamp(Number(value), 0.1, 3), 'optical.satAperture'],
    ['groundAperture', 'groundApertureSlider', (value) => clamp(Number(value), 0.1, 5), 'optical.groundAperture'],
    ['wavelength', 'wavelengthSlider', (value) => clamp(Number(value), 600, 1700), 'optical.wavelength'],
    ['samplesPerOrbit', 'samplesPerOrbitSlider', (value) => clamp(Number(value), 60, 720), 'samplesPerOrbit'],
  ];

  sliderPairs.forEach(([inputId, sliderId, normalize, path]) => {
    const inputEl = elements[inputId];
    const sliderEl = elements[sliderId];
    if (!inputEl || !sliderEl) return;
    const isOrbitalField = path.startsWith('orbital.');
    const updateStateFromValue = (value) => {
      const normalized = normalize(value);
      const numericValue = Number(normalized);
      const isSemiMajor = path === 'orbital.semiMajor';
      const inputDisplay = Number.isFinite(numericValue)
        ? isSemiMajor ? formatDecimal(numericValue) : String(numericValue)
        : String(normalized);
      inputEl.value = inputDisplay;
      sliderEl.value = Number.isFinite(numericValue) ? String(numericValue) : String(normalized);
      mutate((draft) => {
        const [section, field] = path.split('.');
        const valueToAssign = Number.isFinite(numericValue) ? numericValue : normalized;
        if (section === 'orbital') draft.orbital[field] = valueToAssign;
        else if (section === 'optical') draft.optical[field] = valueToAssign;
        else draft[field] = valueToAssign;
      });
    };
    inputEl.addEventListener('change', (event) => {
      if (isOrbitalField) {
        orbitSamplesOverride = null;
      }
      updateStateFromValue(event.target.value);
    });
    sliderEl.addEventListener('input', (event) => {
      if (isOrbitalField) {
        orbitSamplesOverride = DRAFT_SAMPLES_PER_ORBIT;
      }
      updateStateFromValue(event.target.value);
    });
    sliderEl.addEventListener('change', (event) => {
      if (isOrbitalField) {
        orbitSamplesOverride = null;
      }
      updateStateFromValue(event.target.value);
      if (isOrbitalField) {
        recomputeOrbit(true);
      }
    });
  });

  const bindOptimizerPair = (inputId, sliderId, normalize, afterChange) => {
    const inputEl = elements[inputId];
    const sliderEl = elements[sliderId];
    if (!inputEl || !sliderEl) return;
    const apply = (raw) => {
      const normalized = normalize(raw);
      inputEl.value = String(normalized);
      sliderEl.value = String(normalized);
      afterChange?.();
    };
    inputEl.addEventListener('change', (event) => apply(event.target.value));
    sliderEl.addEventListener('input', (event) => apply(event.target.value));
  };

  bindOptimizerPair('optToleranceA', 'optToleranceSlider', normalizeTolerance);

  const syncRotBounds = () => ensureOrderedIntRange('optMinRot', 'optMinRotSlider', 'optMaxRot', 'optMaxRotSlider', 1, 500);
  const syncOrbBounds = () => ensureOrderedIntRange('optMinOrb', 'optMinOrbSlider', 'optMaxOrb', 'optMaxOrbSlider', 1, 500);

  bindOptimizerPair('optMinRot', 'optMinRotSlider', (value) => normalizeInt(value, 1, 500), syncRotBounds);
  bindOptimizerPair('optMaxRot', 'optMaxRotSlider', (value) => normalizeInt(value, 1, 500), syncRotBounds);
  bindOptimizerPair('optMinOrb', 'optMinOrbSlider', (value) => normalizeInt(value, 1, 500), syncOrbBounds);
  bindOptimizerPair('optMaxOrb', 'optMaxOrbSlider', (value) => normalizeInt(value, 1, 500), syncOrbBounds);

  syncRotBounds();
  syncOrbBounds();

  elements.panelTabs?.forEach((tab) => {
    tab.addEventListener('click', () => {
      activatePanelSection(tab.dataset.sectionTarget);
    });
  });

  elements.btnPanelToggle?.addEventListener('click', () => {
    const collapsed = elements.controlPanel?.dataset.collapsed === 'true';
    setPanelCollapsed(!collapsed);
  });

  elements.panelReveal?.addEventListener('click', () => setPanelCollapsed(false));

  elements.panelResizer?.addEventListener('pointerdown', (event) => {
    if (!elements.controlPanel) return;
    if (elements.controlPanel.dataset.collapsed === 'true') {
      setPanelCollapsed(false);
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = elements.controlPanel.getBoundingClientRect().width;
    const handleMove = (moveEvent) => {
      const width = startWidth + (moveEvent.clientX - startX);
      applyPanelWidth(width);
    };
    const handleUp = () => {
      document.removeEventListener('pointermove', handleMove);
      if (panelWidth < PANEL_COLLAPSE_THRESHOLD) {
        lastExpandedPanelWidth = Math.max(startWidth, PANEL_MIN_WIDTH);
        setPanelCollapsed(true);
      } else {
        lastExpandedPanelWidth = panelWidth;
      }
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp, { once: true });
    document.addEventListener('pointercancel', handleUp, { once: true });
  });

  elements.panelResizer?.addEventListener('dblclick', () => {
    const collapsed = elements.controlPanel?.dataset.collapsed === 'true';
    setPanelCollapsed(!collapsed);
  });

  elements.panelResizer?.addEventListener('keydown', (event) => {
    if (!elements.controlPanel) return;
    const collapsed = elements.controlPanel.dataset.collapsed === 'true';
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setPanelCollapsed(!collapsed);
      return;
    }
    if (collapsed) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      applyPanelWidth(panelWidth - 20);
      lastExpandedPanelWidth = panelWidth;
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      applyPanelWidth(panelWidth + 20);
      lastExpandedPanelWidth = panelWidth;
    }
  });

  elements.btnMapStyle?.addEventListener('click', () => {
    const next = toggleBaseLayer();
    currentMapStyle = next || (currentMapStyle === 'standard' ? 'satellite' : 'standard');
    updateMapStyleButton(currentMapStyle);
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

  elements.optimizerForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    runResonanceSearch();
  });

  elements.optResults?.addEventListener('click', handleOptimizerResultClick);

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
      updateViewMode(mode);
    });
  });

  elements.btnTheme?.addEventListener('click', () => {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    localStorage.setItem('qkd-theme', next);
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
      recomputeMetricsOnly(true);
    });
  }

  elements.stationSelect?.addEventListener('change', (event) => {
    selectStation(event.target.value || null);
    recomputeMetricsOnly(true);
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

  const propagateOptions = orbitSamplesOverride != null
    ? { samplesPerOrbit: orbitSamplesOverride }
    : undefined;
  const orbitData = propagateOrbit(state, propagateOptions);
  setTimeline({ timeline: orbitData.timeline, totalSeconds: orbitData.totalTime });
  const metrics = computeStationMetrics(orbitData.dataPoints, getSelectedStation(), state.optical);
  setComputed({
    semiMajor: orbitData.semiMajor,
    orbitPeriod: orbitData.orbitPeriod,
    dataPoints: orbitData.dataPoints,
    groundTrack: orbitData.groundTrack,
    metrics,
    resonance: orbitData.resonance,
  });
  renderOrbitMessages();
  updateOrbitPath(orbitData.dataPoints);
  updateGroundTrackSurface(orbitData.groundTrack);
  frameOrbitView(orbitData.dataPoints, { force: !hasSceneBeenFramed });
  if (!hasSceneBeenFramed && orbitData.dataPoints.length) {
    hasSceneBeenFramed = true;
  }
  lastMetricsSignature = metricsSignature(state);
  flyToOrbit(orbitData.groundTrack, {
    animate: hasMapBeenFramed,
  });
  if (!hasMapBeenFramed && Array.isArray(orbitData.groundTrack) && orbitData.groundTrack.length) {
    hasMapBeenFramed = true;
  }
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
  renderOrbitMessages();
  scheduleVisualUpdate();
}

function scheduleVisualUpdate() {
  const { dataPoints, groundTrack } = state.computed;
  if (!dataPoints.length) return;
  const index = clamp(state.time.index, 0, dataPoints.length - 1);
  const current = dataPoints[index];

  setEarthRotationFromTime(current.t ?? 0);
  updateGroundTrack(groundTrack);
  updateSatellitePosition({ lat: current.lat, lon: current.lon }, computeFootprint(current.alt));
  const station = getSelectedStation();
  renderStations3D(state.stations.list, state.stations.selectedId);
  updateSatellite(current);
  updateGroundTrackVector(current);
  updateLinkLine({ lat: current.lat, lon: current.lon }, station);
  updateLink3D(current, station);
  renderStations2D(state.stations.list, state.stations.selectedId);
  updateMetricsUI(index);
  renderOrbitMessages();
}

function computeFootprint(altitudeKm) {
  if (!Number.isFinite(altitudeKm) || altitudeKm <= 0) return 0;
  const r = EARTH_RADIUS_KM;
  return Math.sqrt((r + altitudeKm) ** 2 - r ** 2);
}

function updateMetricsUI(index) {
  const { metrics } = state.computed;
  if (!metrics.distanceKm.length) {
    if (elements.distanceMetric) elements.distanceMetric.textContent = '--';
    if (elements.elevationMetric) elements.elevationMetric.textContent = '--';
    if (elements.zenithMetric) elements.zenithMetric.textContent = '--';
    if (elements.lossMetric) elements.lossMetric.textContent = '--';
    if (elements.dopplerMetric) elements.dopplerMetric.textContent = '--';
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

function renderOrbitMessages() {
  if (!elements.orbitMessages) return;
  const info = state.computed?.resonance ?? {};
  const lines = [];
  const ratio = info?.ratio;
  const requested = Boolean(info?.requested);
  const applied = info?.applied;
  const formatKm = (value) => `${Number(value).toLocaleString('es-ES', { maximumFractionDigits: 0 })} km`;

  if (requested && ratio) {
    const label = `${ratio.orbits}:${ratio.rotations}`;
    if (applied !== false) {
      lines.push(`<p><strong>Resonancia ${label}</strong> · ground-track repetido tras ${ratio.orbits} órbitas.</p>`);
    } else {
      lines.push(`<p><strong>Intento de resonancia ${label}</strong> · ajusta los parámetros o revisa los avisos.</p>`);
      if (Number.isFinite(info?.deltaKm)) {
        lines.push(`<p>Desfase actual respecto a la resonancia: ${formatKm(info.deltaKm, 3)} km.</p>`);
      }
    }
  }

  const semiMajorKm = state.computed?.semiMajor ?? info?.semiMajorKm;
  if (semiMajorKm) {
    lines.push(`<p>Semieje mayor aplicado: <strong>${formatKm(semiMajorKm)}</strong></p>`);
  }

  if (info?.periodSeconds) {
    lines.push(`<p>Periodo orbital: ${formatDuration(info.periodSeconds)}</p>`);
  }

  if (info?.perigeeKm != null && info?.apogeeKm != null) {
    const perigeeAlt = info.perigeeKm - EARTH_RADIUS_KM;
    const apogeeAlt = info.apogeeKm - EARTH_RADIUS_KM;
    lines.push(`<p>Altitudes perigeo/apogeo: ${perigeeAlt.toFixed(0)} km / ${apogeeAlt.toFixed(0)} km</p>`);
  }

  if (info?.closureSurfaceKm != null) {
    const gap = info.closureSurfaceKm;
    const closureText = gap < 0.01 ? '&lt; 0.01 km' : `${gap.toFixed(2)} km`;
    if (requested && info.closed) {
      lines.push(`<p>✔️ Ground-track cerrado (Δ ${closureText}).</p>`);
    } else if (requested) {
      lines.push(`<p class="warning">⚠️ Desfase tras la resonancia: ${closureText}</p>`);
    } else {
      lines.push(`<p>Cierre del ground-track: ${closureText}</p>`);
    }
  }

  if ((info?.latDriftDeg ?? 0) !== 0 || (info?.lonDriftDeg ?? 0) !== 0) {
    const lat = info.latDriftDeg ?? 0;
    const lon = info.lonDriftDeg ?? 0;
    if (Math.abs(lat) > 1e-3 || Math.abs(lon) > 1e-3) {
      lines.push(`<p>Deriva tras el ciclo: Δlat ${lat.toFixed(3)}°, Δlon ${lon.toFixed(3)}°.</p>`);
    }
  }

  if (Array.isArray(info?.warnings)) {
    info.warnings.forEach((warning) => {
      if (warning) {
        lines.push(`<p class="warning">⚠️ ${warning}</p>`);
      }
    });
  }

  elements.orbitMessages.innerHTML = lines.join('');
  elements.orbitMessages.hidden = lines.length === 0;
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
  if (snapshot.viewMode) updateViewMode(snapshot.viewMode);
  if (elements.resonanceOrbits && !elements.resonanceOrbits.matches(':focus')) {
    const value = String(snapshot.resonance.orbits ?? 1);
    elements.resonanceOrbits.value = value;
    if (elements.resonanceOrbitsSlider && !elements.resonanceOrbitsSlider.matches(':active')) {
      elements.resonanceOrbitsSlider.value = value;
    }
  }
  if (elements.resonanceRotations && !elements.resonanceRotations.matches(':focus')) {
    const value = String(snapshot.resonance.rotations ?? 1);
    elements.resonanceRotations.value = value;
    if (elements.resonanceRotationsSlider && !elements.resonanceRotationsSlider.matches(':active')) {
      elements.resonanceRotationsSlider.value = value;
    }
  }

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
  hasMapBeenFramed = false;
  hasSceneBeenFramed = false;

  mapInstance = initMap(elements.mapContainer);
  setBaseLayer(currentMapStyle);
  await initScene(elements.threeContainer);
  applyTheme(state.theme);

  await loadStationsFromServer();
  refreshStationSelect();
  recomputeOrbit(true);
  subscribe(onStateChange, false);
  playingRaf = requestAnimationFrame(playbackLoop);
  if (mapInstance) {
    setTimeout(() => invalidateMap(), 400);
  }
}

initialize();
