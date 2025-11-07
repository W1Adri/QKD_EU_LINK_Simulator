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
  startStationPicker,
  stopStationPicker,
  renderWeatherField,
  clearWeatherField,
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
import { loadStationsFromServer, persistStation, deleteStationRemote } from './groundStations.js';
import {
  isoNowLocal,
  clamp,
  formatAngle,
  formatDistanceKm,
  formatLoss,
  formatDoppler,
  formatDuration,
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
let lastWeatherSignature = '';
let playingRaf = null;
let panelWidth = 360;
let lastExpandedPanelWidth = 360;
let hasMapBeenFramed = false;
let hasSceneBeenFramed = false;
let modalChartInstance = null;
let stationPickCleanup = null;
const stationDialogDragState = {
  active: false,
  startX: 0,
  startY: 0,
  dialogX: 0,
  dialogY: 0,
};

const INFO_TOOLTIP_ID = 'infoTooltip';
let infoTooltipEl = null;
let activeInfoButton = null;
let infoTooltipSticky = false;
let infoTooltipHideTimeout = null;
let infoTooltipListenersBound = false;
const initializedInfoButtons = new WeakSet();

const optimizerState = {
  results: [],
  query: null,
};

const PANEL_MIN_WIDTH = 240;
const PANEL_MAX_WIDTH = 520;
const PANEL_COLLAPSE_THRESHOLD = 280;
const WEATHER_FIELDS = {
  'wind_speed': {
    label: 'Wind speed',
    units: 'm/s',
    levels: [200, 250, 300, 500, 700, 850],
  },
  temperature: {
    label: 'Temperature',
    units: 'degC',
    levels: [200, 300, 500, 700, 850],
  },
  relative_humidity: {
    label: 'Relative humidity',
    units: '%',
    levels: [700, 850, 925],
  },
  geopotential_height: {
    label: 'Geopotential height',
    units: 'm',
    levels: [500, 700, 850],
  },
};

function firstFiniteValue(series) {
  if (!Array.isArray(series)) return null;
  for (let i = 0; i < series.length; i += 1) {
    const candidate = series[i];
    if (Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return null;
}

function valueFromSeries(series, index, fallback = null) {
  if (Array.isArray(series) && series.length) {
    const idx = clamp(index, 0, series.length - 1);
    const candidate = series[idx];
    if (Number.isFinite(candidate)) return candidate;
    const first = firstFiniteValue(series);
    if (Number.isFinite(first)) return first;
  }
  if (Number.isFinite(fallback)) return fallback;
  return null;
}

function formatR0Meters(value) {
  if (!Number.isFinite(value)) return '--';
  if (Math.abs(value) >= 0.01) {
    return value.toFixed(3);
  }
  return value.toExponential(2);
}

function formatGreenwoodHz(value) {
  if (!Number.isFinite(value)) return '--';
  return value.toFixed(1);
}

function formatThetaArcsec(value) {
  if (!Number.isFinite(value)) return '--';
  return value.toFixed(1);
}

function formatWindMps(value) {
  if (!Number.isFinite(value)) return '--';
  return value.toFixed(1);
}

function normalizeLongitude(lon) {
  if (!Number.isFinite(lon)) return lon;
  let normalized = lon;
  while (normalized < -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return normalized;
}

function populateWeatherFieldOptions(selectedKey = 'wind_speed') {
  if (!elements.weatherFieldSelect) return;
  elements.weatherFieldSelect.innerHTML = '';
  Object.entries(WEATHER_FIELDS).forEach(([key, meta]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = `${meta.label} (${meta.units})`;
    option.selected = key === selectedKey;
    elements.weatherFieldSelect.appendChild(option);
  });
}

function populateWeatherLevelOptions(fieldKey, selectedLevel) {
  if (!elements.weatherLevelSelect) return;
  const meta = WEATHER_FIELDS[fieldKey] || WEATHER_FIELDS.wind_speed;
  const levels = Array.isArray(meta.levels) ? meta.levels : [];
  elements.weatherLevelSelect.innerHTML = '';
  levels.forEach((level) => {
    const option = document.createElement('option');
    option.value = String(level);
    option.textContent = `${level}`;
    option.selected = level === selectedLevel;
    elements.weatherLevelSelect.appendChild(option);
  });
}

function sanitizeWeatherSamples(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 120;
  return clamp(Math.round(numeric / 8) * 8, 16, 900);
}

function syncWeatherSamplesInputs(value) {
  const sanitized = sanitizeWeatherSamples(value);
  if (elements.weatherSamples) {
    elements.weatherSamples.value = String(sanitized);
  }
  if (elements.weatherSamplesSlider) {
    elements.weatherSamplesSlider.value = String(sanitized);
  }
  return sanitized;
}

function setWeatherStatus(message) {
  if (elements.weatherStatus) {
    elements.weatherStatus.textContent = message || '';
  }
}

function toWeatherIso(timeValue) {
  if (!timeValue) {
    return `${isoNowLocal()}:00Z`;
  }
  const trimmed = timeValue.trim();
  if (!trimmed) {
    return `${isoNowLocal()}:00Z`;
  }
  if (trimmed.endsWith('Z')) {
    if (trimmed.length === 16) {
      return `${trimmed}:00Z`;
    }
    return trimmed;
  }
  if (trimmed.length === 16) {
    return `${trimmed}:00Z`;
  }
  if (trimmed.length === 19 && trimmed.charAt(16) === ':') {
    return `${trimmed}Z`;
  }
  return `${trimmed}:00Z`;
}

function ensureInfoTooltip() {
  if (infoTooltipEl) return infoTooltipEl;
  const tooltip = document.createElement('div');
  tooltip.className = 'info-tooltip';
  tooltip.id = INFO_TOOLTIP_ID;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.dataset.visible = 'false';
  document.body.appendChild(tooltip);
  infoTooltipEl = tooltip;
  return tooltip;
}

function positionInfoTooltip(button) {
  if (!infoTooltipEl || !button) return;
  const rect = button.getBoundingClientRect();
  const margin = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const tooltipWidth = infoTooltipEl.offsetWidth;
  const tooltipHeight = infoTooltipEl.offsetHeight;

  let top = rect.bottom + margin;
  if (top + tooltipHeight + margin > viewportHeight) {
    top = Math.max(rect.top - tooltipHeight - margin, margin);
  }

  let left = rect.left + rect.width / 2 - tooltipWidth / 2;
  left = Math.min(Math.max(left, margin), viewportWidth - tooltipWidth - margin);

  infoTooltipEl.style.top = `${Math.round(top)}px`;
  infoTooltipEl.style.left = `${Math.round(left)}px`;
}

function showInfoTooltip(button, { sticky = false } = {}) {
  const tooltip = ensureInfoTooltip();
  if (!(button instanceof HTMLElement)) return;
  const content = button.dataset.info;
  if (!content) return;
  clearTimeout(infoTooltipHideTimeout);
  infoTooltipSticky = sticky;
  activeInfoButton = button;
  tooltip.textContent = content;
  tooltip.dataset.visible = 'true';
  tooltip.setAttribute('aria-hidden', 'false');
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-describedby', INFO_TOOLTIP_ID);
  positionInfoTooltip(button);
}

function hideInfoTooltip(force = false) {
  if (!infoTooltipEl) return;
  if (!force && infoTooltipSticky) return;
  infoTooltipSticky = false;
  infoTooltipEl.dataset.visible = 'false';
  infoTooltipEl.setAttribute('aria-hidden', 'true');
  if (activeInfoButton) {
    activeInfoButton.setAttribute('aria-expanded', 'false');
    activeInfoButton.removeAttribute('aria-describedby');
  }
  activeInfoButton = null;
}

function scheduleInfoTooltipHide(force = false) {
  clearTimeout(infoTooltipHideTimeout);
  infoTooltipHideTimeout = setTimeout(() => hideInfoTooltip(force), force ? 0 : 120);
}

function repositionActiveTooltip() {
  if (!infoTooltipEl) return;
  if (infoTooltipEl.dataset.visible !== 'true' || !activeInfoButton) return;
  positionInfoTooltip(activeInfoButton);
}

function initInfoButtons() {
  ensureInfoTooltip();
  const buttons = document.querySelectorAll('.info-button[data-info]');
  buttons.forEach((button) => {
    if (!(button instanceof HTMLElement) || initializedInfoButtons.has(button)) return;
    initializedInfoButtons.add(button);
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('pointerenter', () => showInfoTooltip(button, { sticky: false }));
    button.addEventListener('pointerleave', () => scheduleInfoTooltipHide(false));
    button.addEventListener('focus', () => showInfoTooltip(button, { sticky: false }));
    button.addEventListener('blur', () => scheduleInfoTooltipHide(false));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (activeInfoButton === button && infoTooltipSticky) {
        scheduleInfoTooltipHide(true);
      } else {
        showInfoTooltip(button, { sticky: true });
      }
    });
  });

  if (!infoTooltipListenersBound) {
    infoTooltipListenersBound = true;
    window.addEventListener('resize', repositionActiveTooltip);
    document.addEventListener('scroll', repositionActiveTooltip, true);
    document.addEventListener('pointerdown', (event) => {
      if (!infoTooltipSticky) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.closest('.info-button') || target.closest('.info-tooltip'))) {
        return;
      }
      scheduleInfoTooltipHide(true);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        scheduleInfoTooltipHide(true);
      }
    });
  }
}

function updateStationPickHint(lat = null, lon = null, awaiting = false) {
  const hintEl = elements.stationPickHint;
  if (!hintEl) return;

  if (awaiting) {
    hintEl.hidden = false;
    hintEl.classList.add('is-active');
    hintEl.textContent = 'Click the map to set the location.';
    return;
  }

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    hintEl.hidden = false;
    hintEl.classList.add('is-active');
    hintEl.textContent = `Selected location: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
    return;
  }

  hintEl.hidden = true;
  hintEl.classList.remove('is-active');
  hintEl.textContent = 'Click the map to set the location.';
}

function setStationPickMode(active) {
  if (!elements.stationPickOnMap) return;
  if (active && !mapInstance) {
    console.warn('Map is not ready yet to pick stations.');
    return;
  }
  const currentlyActive = Boolean(stationPickCleanup);
  if (active && !currentlyActive) {
    const lat = Number(elements.stationLat?.value);
    const lon = Number(elements.stationLon?.value);
    const normalizedInitialLon = Number.isFinite(lon) ? normalizeLongitude(lon) : undefined;
    const initial = Number.isFinite(lat) && normalizedInitialLon !== undefined
      ? { lat, lon: normalizedInitialLon }
      : undefined;

    stationPickCleanup = startStationPicker(({ lat: pickedLat, lon: pickedLon }) => {
      const normalizedLon = normalizeLongitude(pickedLon);
      if (elements.stationLat) {
        elements.stationLat.value = pickedLat.toFixed(4);
      }
      if (elements.stationLon) {
        elements.stationLon.value = normalizedLon.toFixed(4);
      }
      updateStationPickHint(pickedLat, normalizedLon, false);
    }, initial);

    elements.stationPickOnMap.dataset.active = 'true';
    elements.stationPickOnMap.textContent = 'Cancel selection';
    if (initial) {
      updateStationPickHint(initial.lat, initial.lon, false);
    } else {
      updateStationPickHint(null, null, true);
    }
    return;
  }

  if (!active && currentlyActive) {
    stationPickCleanup?.();
    stationPickCleanup = null;
    stopStationPicker();
    elements.stationPickOnMap.dataset.active = 'false';
  elements.stationPickOnMap.textContent = 'Pick on map';
    updateStationPickHint();
  }
}

function syncStationPickHintFromInputs() {
  if (stationPickCleanup) return;
  const lat = Number(elements.stationLat?.value);
  const lon = Number(elements.stationLon?.value);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    updateStationPickHint(lat, normalizeLongitude(lon), false);
  } else {
    updateStationPickHint();
  }
}

async function saveStationFromDialog() {
  const name = elements.stationName?.value.trim() ?? '';
  const lat = Number(elements.stationLat?.value);
  const lon = Number(elements.stationLon?.value);
  const aperture = Number(elements.stationAperture?.value ?? 1.0);

  if (!name) {
    elements.stationName?.focus();
    return;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    updateStationPickHint(null, null, true);
    elements.stationLat?.focus();
    return;
  }

  const normalizedLon = normalizeLongitude(lon);
  if (elements.stationLon) {
    elements.stationLon.value = normalizedLon.toFixed(4);
  }

  const id = `${name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`;
  const station = { id, name, lat, lon: normalizedLon, aperture };
  upsertStation(station);
  persistStation(station);
  setStationPickMode(false);
  updateStationPickHint();
  elements.stationDialog?.close('saved');
  refreshStationSelect();
  await recomputeMetricsOnly(true);
}

function resetStationDialogPosition() {
  if (!elements.stationDialog) return;
  elements.stationDialog.style.left = '50%';
  elements.stationDialog.style.top = '50%';
  elements.stationDialog.style.transform = 'translate(-50%, -50%)';
}

function setStationDialogPosition(x, y) {
  if (!elements.stationDialog) return;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rect = elements.stationDialog.getBoundingClientRect();
  const clampedX = clamp(x, 8, viewportWidth - rect.width - 8);
  const clampedY = clamp(y, 8, viewportHeight - rect.height - 8);
  elements.stationDialog.style.left = `${clampedX}px`;
  elements.stationDialog.style.top = `${clampedY}px`;
  elements.stationDialog.style.transform = 'translate(0, 0)';
}

function beginStationDialogDrag(event) {
  if (!elements.stationDialog) return;
  event.preventDefault();
  stationDialogDragState.active = true;
  stationDialogDragState.startX = event.clientX;
  stationDialogDragState.startY = event.clientY;
  const rect = elements.stationDialog.getBoundingClientRect();
  stationDialogDragState.dialogX = rect.left;
  stationDialogDragState.dialogY = rect.top;
  elements.stationDialog.classList.add('is-dragging');
  window.addEventListener('pointermove', handleStationDialogDragMove);
  window.addEventListener('pointerup', endStationDialogDrag, { once: true });
  window.addEventListener('pointercancel', endStationDialogDrag, { once: true });
}

function handleStationDialogDragMove(event) {
  if (!stationDialogDragState.active) return;
  const deltaX = event.clientX - stationDialogDragState.startX;
  const deltaY = event.clientY - stationDialogDragState.startY;
  setStationDialogPosition(stationDialogDragState.dialogX + deltaX, stationDialogDragState.dialogY + deltaY);
}

function endStationDialogDrag() {
  if (!stationDialogDragState.active) {
    window.removeEventListener('pointermove', handleStationDialogDragMove);
    window.removeEventListener('pointerup', endStationDialogDrag);
    window.removeEventListener('pointercancel', endStationDialogDrag);
    elements.stationDialog?.classList.remove('is-dragging');
    return;
  }
  stationDialogDragState.active = false;
  elements.stationDialog?.classList.remove('is-dragging');
  window.removeEventListener('pointermove', handleStationDialogDragMove);
  window.removeEventListener('pointerup', endStationDialogDrag);
  window.removeEventListener('pointercancel', endStationDialogDrag);
}

function openStationDialog() {
  if (!elements.stationDialog) return;
  resetStationDialogPosition();
  endStationDialogDrag();
  if (!elements.stationDialog.open) {
    try {
      elements.stationDialog.show();
    } catch (error) {
      console.warn('Could not open the station dialog', error);
    }
  }
  elements.stationName?.focus();
}

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
  'btnMapStyle', 'panelReveal', 'panelResizer', 'stationSelect', 'btnAddStation', 'btnDeleteStation', 'btnFocusStation', 'timeLabel',
    'elevationLabel', 'lossLabel', 'distanceMetric', 'elevationMetric', 'zenithMetric', 'lossMetric',
    'dopplerMetric', 'threeContainer', 'mapContainer', 'orbitMessages',
    'stationDialog', 'stationName', 'stationLat', 'stationLon', 'stationAperture', 'stationSave', 'stationCancel',
    'optimizerForm', 'optSearchBtn', 'optSummary', 'optResults',
    'graphModal', 'graphModalTitle', 'modalChartCanvas', 'closeGraphModal',
    'groundCn2Day', 'groundCn2Night', 'r0Metric', 'fGMetric', 'theta0Metric', 'windMetric',
    'stationPickOnMap', 'stationPickHint',
    'weatherFieldSelect', 'weatherLevelSelect', 'weatherSamples', 'weatherSamplesSlider',
    'weatherTime', 'weatherFetchBtn', 'weatherClearBtn', 'weatherStatus',
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
  elements.atmosModelInputs = document.querySelectorAll('input[name="atmosModel"]');
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
    elements.btnPanelToggle.textContent = collapsed ? 'Show panel' : 'Hide panel';
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
  return Number(value).toLocaleString('en-US', {
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
    elements.optResults.innerHTML = '<p class="hint">Enter a target and press "Search resonances".</p>';
    return;
  }

  const { targetA, toleranceKm, minRotations, maxRotations, minOrbits, maxOrbits } = query;
  const toleranceText = `${formatKm(toleranceKm, 3)} km`;
  if (elements.optSummary) {
    elements.optSummary.textContent = `Result: ${results.length} match(es) for a₀ = ${formatKm(
      targetA,
      3,
    )} km ± ${toleranceText}, j ∈ [${minRotations}, ${maxRotations}], k ∈ [${minOrbits}, ${maxOrbits}].`;
  }

  if (!results.length) {
    elements.optResults.innerHTML =
      '<p class="hint">No resonances found in that range. Widen the tolerance or the j/k limits.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'optimizer-table';
  table.innerHTML =
    '<thead><tr><th>Rotations (j)</th><th>Orbits (k)</th><th>j/k</th><th>a req (km)</th><th>Δa (km)</th><th>Period</th><th></th></tr></thead>';
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
      <td><button type="button" class="opt-apply" data-index="${idx}">Apply</button></td>
    `;
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  elements.optResults.innerHTML = '';
  elements.optResults.appendChild(table);

  if (results.length > maxRows) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = `Showing ${maxRows} of ${results.length} results. Adjust the tolerance to narrow the search.`;
    elements.optResults.appendChild(note);
  }
}

function runResonanceSearch() {
  if (!elements.semiMajor || !elements.optResults) return;
  const rawTarget = Number(elements.semiMajor.value);
  if (!Number.isFinite(rawTarget) || rawTarget <= 0) {
    optimizerState.results = [];
    optimizerState.query = null;
    elements.optResults.innerHTML = '<p class="hint">Set a valid target semi-major axis (&gt; 0 km).</p>';
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
    elements.optSummary.textContent = `Applied resonance ${hit.j}:${hit.k} with a ≈ ${formatKm(hit.semiMajorKm, 3)} km.`;
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
  updateChartTheme();
  if (elements.btnTheme) {
    const pressed = theme === 'dark';
    elements.btnTheme.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    elements.btnTheme.textContent = pressed ? 'Light mode' : 'Dark mode';
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
    elements.btnMapStyle.textContent = 'Standard map';
  } else {
    elements.btnMapStyle.textContent = 'Satellite map';
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
  if (elements.groundCn2Day) {
    elements.groundCn2Day.value = String(state.optical.groundCn2Day ?? 5e-14);
  }
  if (elements.groundCn2Night) {
    elements.groundCn2Night.value = String(state.optical.groundCn2Night ?? 5e-15);
  }
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
  const initialWeatherField = state.weather?.variable ?? 'wind_speed';
  populateWeatherFieldOptions(initialWeatherField);
  const initialLevel = state.weather?.level_hpa ?? WEATHER_FIELDS[initialWeatherField].levels[0];
  populateWeatherLevelOptions(initialWeatherField, initialLevel);
  syncWeatherSamplesInputs(state.weather?.samples ?? 120);
  if (elements.weatherTime) {
    elements.weatherTime.value = (state.weather?.time ?? isoNowLocal()).slice(0, 16);
  }
  setWeatherStatus('');
  renderOptimizerResults();
  if (elements.stationPickOnMap) {
    elements.stationPickOnMap.dataset.active = 'false';
    elements.stationPickOnMap.textContent = 'Pick on map';
  }
  updateStationPickHint();
  if (elements.atmosModelInputs?.length) {
    const selectedModel = state.atmosphere?.model ?? 'hufnagel-valley';
    elements.atmosModelInputs.forEach((input) => {
      const model = input.dataset.atmosModel || input.value;
      input.checked = model === selectedModel;
    });
  }
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
    sliderEl.addEventListener('change', async (event) => {
      if (isOrbitalField) {
        orbitSamplesOverride = null;
      }
      updateStateFromValue(event.target.value);
      if (isOrbitalField) {
        await recomputeOrbit(true);
      }
    });
  });

  const bindOpticalTurbulenceInput = (inputId, key) => {
    const inputEl = elements[inputId];
    if (!inputEl) return;
    const applyValue = (raw) => {
      const numeric = Number(raw);
      if (Number.isFinite(numeric) && numeric > 0) {
        inputEl.value = String(numeric);
        mutate((draft) => {
          draft.optical[key] = numeric;
        });
      } else {
        inputEl.value = String(state.optical[key]);
      }
    };
    inputEl.addEventListener('blur', (event) => applyValue(event.target.value));
    inputEl.addEventListener('change', async (event) => {
      applyValue(event.target.value);
      await recomputeMetricsOnly(true);
    });
  };

  bindOpticalTurbulenceInput('groundCn2Day', 'groundCn2Day');
  bindOpticalTurbulenceInput('groundCn2Night', 'groundCn2Night');

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

  if (elements.weatherFieldSelect) {
    elements.weatherFieldSelect.addEventListener('change', (event) => {
      const key = event.target.value;
  const normalized = Object.prototype.hasOwnProperty.call(WEATHER_FIELDS, key) ? key : 'wind_speed';
      const candidateLevel = state.weather?.level_hpa ?? WEATHER_FIELDS[normalized].levels[0];
      const nextLevel = WEATHER_FIELDS[normalized].levels.includes(candidateLevel)
        ? candidateLevel
        : WEATHER_FIELDS[normalized].levels[0];
      populateWeatherLevelOptions(normalized, nextLevel);
      mutate((draft) => {
        draft.weather.variable = normalized;
        draft.weather.level_hpa = nextLevel;
      });
    });
  }

  if (elements.weatherLevelSelect) {
    elements.weatherLevelSelect.addEventListener('change', (event) => {
      const level = Number(event.target.value);
      mutate((draft) => {
        draft.weather.level_hpa = level;
      });
    });
  }

  const applyWeatherSamples = (raw) => {
    const sanitized = syncWeatherSamplesInputs(raw);
    mutate((draft) => {
      draft.weather.samples = sanitized;
    });
  };

  elements.weatherSamples?.addEventListener('change', (event) => applyWeatherSamples(event.target.value));
  elements.weatherSamplesSlider?.addEventListener('input', (event) => applyWeatherSamples(event.target.value));
  elements.weatherSamplesSlider?.addEventListener('change', (event) => applyWeatherSamples(event.target.value));

  elements.weatherTime?.addEventListener('change', (event) => {
    const value = event.target.value || isoNowLocal();
    const truncated = value.slice(0, 16);
    mutate((draft) => {
      draft.weather.time = truncated;
    });
  });

  elements.weatherFetchBtn?.addEventListener('click', () => {
    void fetchWeatherFieldData();
  });

  elements.weatherClearBtn?.addEventListener('click', () => {
    mutate((draft) => {
      draft.weather.data = null;
      draft.weather.active = false;
      draft.weather.status = 'idle';
    });
    clearWeatherField();
    lastWeatherSignature = '';
    setWeatherStatus('Overlay cleared');
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
      updateViewMode(mode);
    });
  });

  elements.btnTheme?.addEventListener('click', () => {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
    localStorage.setItem('qkd-theme', next);
  });

  elements.atmosModelInputs?.forEach((input) => {
    input.addEventListener('change', async () => {
      if (!input.checked) return;
      const model = input.dataset.atmosModel || input.value;
      mutate((draft) => {
        draft.atmosphere = draft.atmosphere || { model: 'hufnagel-valley', modelParams: {} };
        draft.atmosphere.model = model;
      });
      await recomputeMetricsOnly(true);
    });
  });

  elements.controlPanel?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches('.btn-show-graph')) {
      event.preventDefault();
      showModalGraph(target.dataset.graphId);
    }
  });

  elements.closeGraphModal?.addEventListener('click', () => {
    elements.graphModal?.close();
  });

  if (elements.stationDialog) {
    const dragHandle = elements.stationDialog.querySelector('.dialog-drag-handle');
    dragHandle?.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      beginStationDialogDrag(event);
    });
    elements.stationDialog.addEventListener('submit', async (event) => {
      event.preventDefault();
      await saveStationFromDialog();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.stationDialog?.open) {
      event.preventDefault();
      elements.stationDialog.close('cancelled');
    }
  });

  elements.btnAddStation?.addEventListener('click', () => {
    setStationPickMode(false);
    updateStationPickHint();
    openStationDialog();
  });

  elements.btnDeleteStation?.addEventListener('click', async () => {
    const station = getSelectedStation();
    if (!station) return;
    const confirmed = window.confirm(`Remove the station "${station.name}"?`);
    if (!confirmed) return;
    await deleteStationRemote(station.id);
  });

  if (elements.stationDialog && elements.stationSave) {
    elements.stationDialog.addEventListener('close', () => {
      setStationPickMode(false);
      if (elements.stationName) elements.stationName.value = '';
      if (elements.stationLat) elements.stationLat.value = '';
      if (elements.stationLon) elements.stationLon.value = '';
      resetStationDialogPosition();
      updateStationPickHint();
      endStationDialogDrag();
    });

    elements.stationCancel?.addEventListener('click', () => {
      elements.stationDialog.close('cancelled');
    });

    elements.stationPickOnMap?.addEventListener('click', () => {
      const isActive = elements.stationPickOnMap.dataset.active === 'true';
      setStationPickMode(!isActive);
    });

    elements.stationLat?.addEventListener('input', syncStationPickHintFromInputs);
    elements.stationLon?.addEventListener('input', syncStationPickHintFromInputs);

    elements.stationSave.addEventListener('click', async (event) => {
      event.preventDefault();
      await saveStationFromDialog();
    });
  }

  elements.stationSelect?.addEventListener('change', async (event) => {
    selectStation(event.target.value || null);
    await recomputeMetricsOnly(true);
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
  if (selectedId) {
    elements.stationSelect.value = selectedId;
  }
  const hasStations = list.length > 0;
  const hasSelection = hasStations && Boolean(selectedId);
  elements.stationSelect.disabled = !hasStations;
  if (elements.btnDeleteStation) {
    elements.btnDeleteStation.disabled = !hasSelection;
  }
  if (elements.btnFocusStation) {
    elements.btnFocusStation.disabled = !hasSelection;
  }
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
    atmosphere: snapshot.atmosphere?.model ?? 'hufnagel-valley',
  });
}

async function fetchWeatherFieldData() {
  if (!elements.weatherFetchBtn) return;
  const variableKey = elements.weatherFieldSelect?.value || state.weather?.variable || 'wind_speed';
  const normalizedKey = Object.prototype.hasOwnProperty.call(WEATHER_FIELDS, variableKey) ? variableKey : 'wind_speed';
  const meta = WEATHER_FIELDS[normalizedKey];
  const levelCandidate = Number(elements.weatherLevelSelect?.value || state.weather?.level_hpa || meta.levels[0]);
  const level = meta.levels.includes(levelCandidate) ? levelCandidate : meta.levels[0];
  const samples = sanitizeWeatherSamples(elements.weatherSamples?.value ?? state.weather?.samples ?? 120);
  const timeLocal = elements.weatherTime?.value || state.weather?.time || isoNowLocal();
  const isoTime = toWeatherIso(timeLocal);

  syncWeatherSamplesInputs(samples);
  const button = elements.weatherFetchBtn;
  button.disabled = true;
  setWeatherStatus('Fetching weather field…');

  mutate((draft) => {
    draft.weather.variable = normalizedKey;
    draft.weather.level_hpa = level;
    draft.weather.samples = samples;
    draft.weather.time = timeLocal.slice(0, 16);
    draft.weather.status = 'loading';
  });

  const payload = {
    variable: normalizedKey,
    level_hpa: level,
    samples,
    time: isoTime,
  };

  try {
    const response = await fetch('/api/get_weather_field', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const errorPayload = await response.json();
        if (errorPayload && typeof errorPayload === 'object' && 'detail' in errorPayload) {
          detail = errorPayload.detail;
        } else if (errorPayload) {
          detail = JSON.stringify(errorPayload);
        }
      } catch (err) {
        const text = await response.text();
        if (text) detail = text;
      }
      throw new Error(detail || `HTTP ${response.status}`);
    }
    const data = await response.json();
    lastWeatherSignature = '';
    mutate((draft) => {
      draft.weather.data = data;
      draft.weather.status = 'ready';
      draft.weather.active = true;
    });
    const label = data?.variable?.label ?? meta.label;
    const levelLabel = data?.variable?.pressure_hpa ?? level;
    setWeatherStatus(`Field loaded: ${label} @ ${levelLabel} hPa`);
  } catch (err) {
    console.error('Weather field fetch failed', err);
    mutate((draft) => {
      draft.weather.status = 'error';
    });
    setWeatherStatus(`Failed to fetch field: ${err.message}`);
    clearWeatherField();
    lastWeatherSignature = '';
  } finally {
    button.disabled = false;
  }
}

async function recomputeOrbit(force = false) {
  const signature = orbitSignature(state);
  if (!force && signature === lastOrbitSignature) return;
  lastOrbitSignature = signature;

  const propagateOptions = orbitSamplesOverride != null
    ? { samplesPerOrbit: orbitSamplesOverride }
    : undefined;
  const orbitData = propagateOrbit(state, propagateOptions);
  setTimeline({ timeline: orbitData.timeline, totalSeconds: orbitData.totalTime });
  const metrics = computeStationMetrics(
    orbitData.dataPoints,
    getSelectedStation(),
    state.optical,
    state,
    null,
  );
  setComputed({
    semiMajor: orbitData.semiMajor,
    orbitPeriod: orbitData.orbitPeriod,
    dataPoints: orbitData.dataPoints,
    groundTrack: orbitData.groundTrack,
    metrics,
    resonance: orbitData.resonance,
  });
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
  await recomputeMetricsOnly(true);
}

async function recomputeMetricsOnly(force = false) {
  if (!state.computed.dataPoints.length) return;
  const signature = metricsSignature(state);
  if (!force && signature === lastMetricsSignature) return;
  lastMetricsSignature = signature;

  const station = getSelectedStation();
  const optical = state.optical;
  let atmosphereMetrics = null;
  if (station && Array.isArray(state.time.timeline) && state.time.timeline.length) {
    try {
      const midIndex = Math.floor(state.time.timeline.length / 2);
      const midTimeSeconds = state.time.timeline[midIndex] ?? 0;
      const epochMs = new Date(state.epoch).getTime();
      const midTimestamp = new Date(epochMs + midTimeSeconds * 1000).toISOString();

      const response = await fetch('/api/get_atmosphere_profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: station.lat,
          lon: station.lon,
          time: midTimestamp,
          ground_cn2_day: state.optical.groundCn2Day,
          ground_cn2_night: state.optical.groundCn2Night,
          model: state.atmosphere?.model ?? 'hufnagel-valley',
          wavelength_nm: state.optical.wavelength,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || 'Server error');
      }

      atmosphereMetrics = await response.json();
    } catch (error) {
      console.error('Failed to load atmospheric profile:', error);
    }
  }

  const metrics = computeStationMetrics(
    state.computed.dataPoints,
    station,
    optical,
    state,
    atmosphereMetrics,
  );

  const metricsPayload = {
    ...metrics,
    atmosphereProfile: atmosphereMetrics,
    r0_zenith: atmosphereMetrics?.r0_zenith ?? null,
    fG_zenith: atmosphereMetrics?.fG_zenith ?? null,
    theta0_zenith: atmosphereMetrics?.theta0_zenith ?? null,
    wind_rms: atmosphereMetrics?.wind_rms ?? null,
    loss_aod_db: atmosphereMetrics?.loss_aod_db ?? null,
    loss_abs_db: atmosphereMetrics?.loss_abs_db ?? null,
  };

  setComputed({
    ...state.computed,
    metrics: metricsPayload,
  });

  renderOrbitMessages();
  scheduleVisualUpdate();
}

function scheduleVisualUpdate() {
  const { dataPoints, groundTrack } = state.computed;
  if (!dataPoints.length) return;
  const index = clamp(state.time.index, 0, dataPoints.length - 1);
  const current = dataPoints[index];

  setEarthRotationFromTime(current.gmst ?? 0);
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
    if (elements.r0Metric) elements.r0Metric.textContent = '--';
    if (elements.fGMetric) elements.fGMetric.textContent = '--';
    if (elements.theta0Metric) elements.theta0Metric.textContent = '--';
    if (elements.windMetric) elements.windMetric.textContent = '--';
    return;
  }

  const distanceKm = metrics.distanceKm[index];
  const elevation = metrics.elevationDeg[index];
  const loss = metrics.lossDb[index];
  const doppler = metrics.doppler[index];
  const zenith = 90 - elevation;
  const r0Meters = valueFromSeries(metrics.r0_array, index, metrics.r0_zenith);
  const greenwoodHz = valueFromSeries(metrics.fG_array, index, metrics.fG_zenith);
  const thetaArcsec = valueFromSeries(metrics.theta0_array, index, metrics.theta0_zenith);
  const windMps = valueFromSeries(metrics.wind_array, index, metrics.wind_rms);

  if (elements.distanceMetric) elements.distanceMetric.textContent = formatDistanceKm(distanceKm);
  if (elements.elevationMetric) elements.elevationMetric.textContent = formatAngle(elevation);
  if (elements.zenithMetric) elements.zenithMetric.textContent = formatAngle(zenith);
  if (elements.lossMetric) elements.lossMetric.textContent = formatLoss(loss);
  if (elements.dopplerMetric) elements.dopplerMetric.textContent = formatDoppler(doppler);
  if (elements.r0Metric) elements.r0Metric.textContent = formatR0Meters(r0Meters);
  if (elements.fGMetric) elements.fGMetric.textContent = formatGreenwoodHz(greenwoodHz);
  if (elements.theta0Metric) elements.theta0Metric.textContent = formatThetaArcsec(thetaArcsec);
  if (elements.windMetric) elements.windMetric.textContent = formatWindMps(windMps);

  if (elements.timeLabel) {
    const t = state.time.timeline[index] ?? 0;
    elements.timeLabel.textContent = `${t.toFixed(1)} s`;
  }
  if (elements.elevationLabel) elements.elevationLabel.textContent = formatAngle(elevation);
  if (elements.lossLabel) elements.lossLabel.textContent = formatLoss(loss);

  const station = getSelectedStation();
  if (station) annotateStationTooltip(station, { distanceKm });
}

function createLineChart(canvas, { color }) {
  const ChartJS = window.Chart;
  if (!canvas || !ChartJS) return null;
  if (typeof ChartJS.getChart === 'function') {
    let existing = ChartJS.getChart(canvas);
    if (!existing && canvas.id) {
      existing = ChartJS.getChart(canvas.id);
    }
    if (existing) existing.destroy();
  }
  return new ChartJS(canvas, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Metric',
          data: [],
          borderColor: color,
          backgroundColor: `${color}33`,
          tension: 0.28,
          pointRadius: 0,
          borderWidth: 2,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: (ctx) => {
              const value = ctx.parsed.y;
              const lineLabel = ctx.dataset?.label || 'Value';
              if (value == null || Number.isNaN(value)) return `${lineLabel}: --`;
              return `${lineLabel}: ${value.toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: 'Time (s)',
          },
          ticks: {
            maxTicksLimit: 8,
          },
          grid: {
            display: false,
          },
        },
        y: {
          title: {
            display: true,
            text: '',
          },
          ticks: {
            maxTicksLimit: 6,
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.15)',
          },
        },
      },
      interaction: {
        intersect: false,
        mode: 'nearest',
      },
    },
  });
}

function initializeCharts() {
  modalChartInstance = createLineChart(elements.modalChartCanvas, {
    color: '#7c3aed',
  });
  updateChartTheme();
}

function updateChartTheme() {
  const charts = [modalChartInstance];
  if (!charts.some((chart) => chart)) return;
  const styles = window.getComputedStyle(document.body);
  const textColor = styles.getPropertyValue('--text')?.trim() || '#111827';
  const gridColor = styles.getPropertyValue('--border')?.trim() || 'rgba(148, 163, 184, 0.18)';
  const tooltipBg = styles.getPropertyValue('--surface')?.trim() || 'rgba(15, 23, 42, 0.9)';
  charts.forEach((chart) => {
    if (!chart) return;
    const { scales, plugins } = chart.options;
    if (scales?.x?.ticks) scales.x.ticks.color = textColor;
    if (scales?.x?.title) scales.x.title.color = textColor;
    if (scales?.y?.ticks) scales.y.ticks.color = textColor;
    if (scales?.y?.title) scales.y.title.color = textColor;
    if (scales?.y?.grid) scales.y.grid.color = gridColor;
    if (plugins?.tooltip) {
      plugins.tooltip.titleColor = textColor;
      plugins.tooltip.bodyColor = textColor;
      plugins.tooltip.backgroundColor = tooltipBg;
    }
    chart.update('none');
  });
}

function showModalGraph(graphId) {
  if (!modalChartInstance || !elements.graphModal || !elements.graphModalTitle) return;
  const timeline = Array.isArray(state.time.timeline) ? state.time.timeline : [];
  const metrics = state.computed?.metrics ?? {};
  if (!timeline.length || !metrics) return;

  const graphConfig = {
    loss: {
      data: metrics.lossDb ?? [],
      title: 'Loss vs Time',
      yLabel: 'Geometric loss (dB)',
      color: '#7c3aed',
    },
    elevation: {
      data: metrics.elevationDeg ?? [],
      title: 'Elevation vs Time',
      yLabel: 'Station elevation (°)',
      color: '#0ea5e9',
    },
    distance: {
      data: metrics.distanceKm ?? [],
      title: 'Range vs Time',
      yLabel: 'Satellite-ground range (km)',
      color: '#22c55e',
    },
    r0: {
      data: metrics.r0_array ?? [],
      title: 'Fried parameter (r0)',
      yLabel: 'r0 (m)',
      color: '#f97316',
      datasetLabel: 'r0 (m)',
    },
    fG: {
      data: metrics.fG_array ?? [],
      title: 'Greenwood frequency (fG)',
      yLabel: 'fG (Hz)',
      color: '#06b6d4',
      datasetLabel: 'fG (Hz)',
    },
    theta0: {
      data: metrics.theta0_array ?? [],
      title: 'Isoplanatic angle (theta0)',
      yLabel: 'theta0 (arcsec)',
      color: '#10b981',
      datasetLabel: 'theta0 (arcsec)',
    },
    wind: {
      data: metrics.wind_array ?? [],
      title: 'RMS wind speed',
      yLabel: 'Wind (m/s)',
      color: '#f59e0b',
      datasetLabel: 'Wind (m/s)',
    },
  };

  const config = graphConfig[graphId];
  if (!config) return;

  const labels = timeline.map((value) => (
    Number.isFinite(value) ? Number(value.toFixed(1)) : value
  ));
  const series = Array.isArray(config.data) ? config.data : [];
  const datasetLabel = config.datasetLabel ?? config.yLabel;

  elements.graphModalTitle.textContent = config.title;
  modalChartInstance.data.labels = labels;
  modalChartInstance.data.datasets[0].data = labels.map((_, idx) => {
    const raw = series[idx];
    if (!Number.isFinite(raw)) return null;
    if (typeof config.transform === 'function') {
      const transformed = config.transform(raw);
      return Number.isFinite(transformed) ? transformed : null;
    }
    return raw;
  });
  modalChartInstance.data.datasets[0].label = datasetLabel;
  modalChartInstance.data.datasets[0].borderColor = config.color;
  modalChartInstance.data.datasets[0].backgroundColor = `${config.color}33`;
  modalChartInstance.options.scales.y.title.text = config.yLabel;
  modalChartInstance.update('none');
  updateChartTheme();

  const modal = elements.graphModal;
  if (!(modal instanceof HTMLDialogElement)) return;
  if (!modal.open) {
    modal.showModal();
  }
  requestAnimationFrame(() => {
    modalChartInstance.resize();
    elements.closeGraphModal?.focus();
  });
}

function renderOrbitMessages() {
  if (!elements.orbitMessages) return;
  const info = state.computed?.resonance ?? {};
  const lines = [];
  const ratio = info?.ratio;
  const requested = Boolean(info?.requested);
  const applied = info?.applied;
  const formatKm = (value) => `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })} km`;

  if (requested && ratio) {
    const label = `${ratio.orbits}:${ratio.rotations}`;
    if (applied !== false) {
      lines.push(`<p><strong>Resonance ${label}</strong> · ground track repeats after ${ratio.orbits} orbit(s).</p>`);
    } else {
      lines.push(`<p><strong>Attempted resonance ${label}</strong> · adjust the parameters or review the warnings.</p>`);
      if (Number.isFinite(info?.deltaKm)) {
        lines.push(`<p>Current offset relative to the resonance: ${formatKm(info.deltaKm, 3)} km.</p>`);
      }
    }
  }

  const semiMajorKm = state.computed?.semiMajor ?? info?.semiMajorKm;
  if (semiMajorKm) {
    lines.push(`<p>Applied semi-major axis: <strong>${formatKm(semiMajorKm)}</strong></p>`);
  }

  if (info?.periodSeconds) {
    lines.push(`<p>Orbital period: ${formatDuration(info.periodSeconds)}</p>`);
  }

  if (info?.perigeeKm != null && info?.apogeeKm != null) {
    const perigeeAlt = info.perigeeKm - EARTH_RADIUS_KM;
    const apogeeAlt = info.apogeeKm - EARTH_RADIUS_KM;
    lines.push(`<p>Perigee / apogee altitude: ${perigeeAlt.toFixed(0)} km / ${apogeeAlt.toFixed(0)} km</p>`);
  }

  if (info?.closureSurfaceKm != null) {
    const gap = info.closureSurfaceKm;
    const closureText = gap < 0.01 ? '&lt; 0.01 km' : `${gap.toFixed(2)} km`;
    if (requested && info.closed) {
      lines.push(`<p>✔️ Ground track closed (Δ ${closureText}).</p>`);
    } else if (requested) {
      lines.push(`<p class="warning">⚠️ Offset after resonance: ${closureText}</p>`);
    } else {
      lines.push(`<p>Ground-track closure: ${closureText}</p>`);
    }
  }

  if ((info?.latDriftDeg ?? 0) !== 0 || (info?.lonDriftDeg ?? 0) !== 0) {
    const lat = info.latDriftDeg ?? 0;
    const lon = info.lonDriftDeg ?? 0;
    if (Math.abs(lat) > 1e-3 || Math.abs(lon) > 1e-3) {
      lines.push(`<p>Cycle drift: Δlat ${lat.toFixed(3)}°, Δlon ${lon.toFixed(3)}°.</p>`);
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
  const timeline = state.time.timeline;
  if (!state.time.playing || timeline.length === 0) {
    playbackLoop.lastTimestamp = timestamp;
    playbackLoop.simulatedTime = timeline[state.time.index] ?? 0;
    playingRaf = requestAnimationFrame(playbackLoop);
    return;
  }

  if (!Number.isFinite(playbackLoop.lastTimestamp)) {
    playbackLoop.lastTimestamp = timestamp;
  }

  const dt = (timestamp - playbackLoop.lastTimestamp) / 1000;
  playbackLoop.lastTimestamp = timestamp;

  const totalTime = timeline[timeline.length - 1] ?? 0;
  if (!Number.isFinite(playbackLoop.simulatedTime)) {
    playbackLoop.simulatedTime = timeline[state.time.index] ?? 0;
  }

  playbackLoop.simulatedTime += dt * state.time.timeWarp;

  if (totalTime > 0) {
    playbackLoop.simulatedTime %= totalTime;
    if (playbackLoop.simulatedTime < 0) {
      playbackLoop.simulatedTime += totalTime;
    }
  } else {
    playbackLoop.simulatedTime = 0;
  }

  let nextIndex = state.time.index;
  while (nextIndex < timeline.length - 1 && timeline[nextIndex + 1] <= playbackLoop.simulatedTime) {
    nextIndex += 1;
  }
  while (nextIndex > 0 && timeline[nextIndex] > playbackLoop.simulatedTime) {
    nextIndex -= 1;
  }

  if (nextIndex !== state.time.index) {
    setTimeIndex(nextIndex);
    playbackLoop.simulatedTime = timeline[nextIndex] ?? playbackLoop.simulatedTime;
  }

  playingRaf = requestAnimationFrame(playbackLoop);
}

function onStateChange(snapshot) {
  if (Array.isArray(snapshot.time.timeline) && snapshot.time.timeline.length) {
    playbackLoop.simulatedTime = snapshot.time.timeline[snapshot.time.index] ?? playbackLoop.simulatedTime;
  }
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
  if (elements.groundCn2Day && !elements.groundCn2Day.matches(':focus')) {
    elements.groundCn2Day.value = String(snapshot.optical.groundCn2Day ?? 5e-14);
  }
  if (elements.groundCn2Night && !elements.groundCn2Night.matches(':focus')) {
    elements.groundCn2Night.value = String(snapshot.optical.groundCn2Night ?? 5e-15);
  }
  if (elements.atmosModelInputs?.length) {
    const selectedModel = snapshot.atmosphere?.model ?? 'hufnagel-valley';
    elements.atmosModelInputs.forEach((input) => {
      if (input.matches(':focus')) return;
      const model = input.dataset.atmosModel || input.value;
      input.checked = model === selectedModel;
    });
  }

  const weatherState = snapshot.weather ?? {};
  const weatherFieldKey = weatherState.variable ?? 'wind_speed';
  const weatherLevel = weatherState.level_hpa ?? (WEATHER_FIELDS[weatherFieldKey]?.levels?.[0] ?? 200);
  const weatherSamples = sanitizeWeatherSamples(weatherState.samples ?? 120);
  const weatherTime = (weatherState.time ?? isoNowLocal()).slice(0, 16);

  if (elements.weatherFieldSelect && !elements.weatherFieldSelect.matches(':focus')) {
    if (!elements.weatherFieldSelect.querySelector(`option[value="${weatherFieldKey}"]`)) {
      populateWeatherFieldOptions(weatherFieldKey);
    }
    elements.weatherFieldSelect.value = weatherFieldKey;
  }
  if (elements.weatherLevelSelect && !elements.weatherLevelSelect.matches(':focus')) {
    populateWeatherLevelOptions(weatherFieldKey, weatherLevel);
  }
  if (elements.weatherSamples && !elements.weatherSamples.matches(':focus')) {
    elements.weatherSamples.value = String(weatherSamples);
  }
  if (elements.weatherSamplesSlider && !elements.weatherSamplesSlider.matches(':active')) {
    elements.weatherSamplesSlider.value = String(weatherSamples);
  }
  if (elements.weatherTime && !elements.weatherTime.matches(':focus')) {
    elements.weatherTime.value = weatherTime;
  }
  if (elements.weatherClearBtn) {
    elements.weatherClearBtn.disabled = !weatherState.data;
  }

  const shouldRenderWeather = weatherState.active && weatherState.data;
  if (shouldRenderWeather) {
    const weatherSig = JSON.stringify({
      ts: weatherState.data.timestamp,
      var: weatherState.data.variable?.open_meteo_key ?? weatherState.data.variable?.key,
      min: weatherState.data.grid?.min,
      max: weatherState.data.grid?.max,
      rows: weatherState.data.grid?.rows,
      cols: weatherState.data.grid?.cols,
    });
    if (weatherSig !== lastWeatherSignature) {
      renderWeatherField(weatherState.data);
      lastWeatherSignature = weatherSig;
    }
  } else if (lastWeatherSignature) {
    clearWeatherField();
    lastWeatherSignature = '';
  }

  const orbitSig = orbitSignature(snapshot);
  if (orbitSig !== lastOrbitSignature) {
    void recomputeOrbit(true);
    return;
  }

  const metricsSig = metricsSignature(snapshot);
  if (metricsSig !== lastMetricsSignature) {
    void recomputeMetricsOnly(true);
    return;
  }

  scheduleVisualUpdate();
}

async function initialize() {
  cacheElements();
  initDefaults();
  initInfoButtons();
  bindEvents();
  hasMapBeenFramed = false;
  hasSceneBeenFramed = false;

  mapInstance = initMap(elements.mapContainer);
  setBaseLayer(currentMapStyle);
  await initScene(elements.threeContainer);
  initializeCharts();
  applyTheme(state.theme);

  await loadStationsFromServer();
  refreshStationSelect();
  await recomputeOrbit(true);
  subscribe(onStateChange, false);
  playingRaf = requestAnimationFrame(playbackLoop);
  if (mapInstance) {
    setTimeout(() => invalidateMap(), 400);
  }
}

initialize();
