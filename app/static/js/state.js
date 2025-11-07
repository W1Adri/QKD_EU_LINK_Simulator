import { isoNowLocal } from './utils.js';

const listeners = new Set();

const defaultState = {
  variant: document.body?.dataset?.variant ?? 'compact',
  theme: 'light',
  satelliteName: 'Sat-QKD',
  epoch: isoNowLocal(),
  viewMode: 'dual',
  orbital: {
    semiMajor: 6771,
    eccentricity: 0.001,
    inclination: 53,
    raan: 0,
    argPerigee: 0,
    meanAnomaly: 0,
  },
  resonance: {
    enabled: true,
    orbits: 1,
    rotations: 1,
  },
  optical: {
    satAperture: 0.6,
    groundAperture: 1.0,
    wavelength: 810,
    groundCn2Day: 5e-14,
    groundCn2Night: 5e-15,
  },
  atmosphere: {
    model: 'hufnagel-valley',
    modelParams: {},
  },
  weather: {
    active: false,
    variable: 'wind_speed',
    level_hpa: 200,
    samples: 120,
    time: isoNowLocal(),
    data: null,
    status: 'idle',
  },
  samplesPerOrbit: 180,
  time: {
    playing: false,
    timeWarp: 60,
    index: 0,
    totalSeconds: 5400,
    timeline: [],
  },
  stations: {
    list: [],
    selectedId: null,
  },
  computed: {
    semiMajor: null,
    orbitPeriod: null,
    dataPoints: [],
    groundTrack: [],
    metrics: {
      distanceKm: [],
      elevationDeg: [],
      lossDb: [],
      doppler: [],
      azimuthDeg: [],
      r0_array: [],
      fG_array: [],
      theta0_array: [],
      wind_array: [],
      loss_aod_array: [],
      loss_abs_array: [],
      r0_zenith: null,
      fG_zenith: null,
      theta0_zenith: null,
      wind_rms: null,
      loss_aod_db: null,
      loss_abs_db: null,
      atmosphereProfile: null,
    },
    resonance: {
      requested: false,
      applied: false,
      ratio: null,
      warnings: [],
      semiMajorKm: null,
  deltaKm: null,
      targetPeriodSeconds: null,
      periodSeconds: null,
      perigeeKm: null,
      apogeeKm: null,
      closureSurfaceKm: null,
      closureCartesianKm: null,
      latDriftDeg: null,
      lonDriftDeg: null,
      closed: false,
    },
  },
};

export const state = structuredClone(defaultState);

export function subscribe(listener, invokeImmediately = true) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  if (invokeImmediately) {
    listener(state);
  }
  return () => listeners.delete(listener);
}

function emit() {
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (err) {
      console.error('State subscriber error', err);
    }
  });
}

export function mutate(mutator) {
  if (typeof mutator !== 'function') return;
  mutator(state);
  emit();
}

export function resetComputed() {
  state.computed = structuredClone(defaultState.computed);
  emit();
}

export function setTheme(theme) {
  mutate((draft) => {
    draft.theme = theme;
  });
}

export function setVariant(variant) {
  mutate((draft) => {
    draft.variant = variant;
  });
}

export function ensureStationSelected() {
  const { list, selectedId } = state.stations;
  if (list.length === 0) {
    state.stations.selectedId = null;
    return;
  }
  const exists = list.some((item) => item.id === selectedId);
  if (!exists) {
    state.stations.selectedId = list[0].id;
  }
}

export function upsertStation(station) {
  mutate((draft) => {
    const idx = draft.stations.list.findIndex((item) => item.id === station.id);
    if (idx >= 0) {
      draft.stations.list[idx] = station;
    } else {
      draft.stations.list.push(station);
    }
    draft.stations.selectedId = station.id;
  });
}

export function removeStations() {
  mutate((draft) => {
    draft.stations.list = [];
    draft.stations.selectedId = null;
  });
}

export function removeStation(id) {
  if (!id) return;
  mutate((draft) => {
    const filtered = draft.stations.list.filter((item) => item.id !== id);
    draft.stations.list = filtered;
    if (draft.stations.selectedId === id) {
      draft.stations.selectedId = filtered.length ? filtered[0].id : null;
    }
  });
}

export function selectStation(id) {
  mutate((draft) => {
    draft.stations.selectedId = id;
  });
}

export function setTimeline(data) {
  mutate((draft) => {
    draft.time.timeline = data.timeline;
    draft.time.totalSeconds = data.totalSeconds;
    draft.time.index = Math.min(draft.time.index, data.timeline.length - 1);
  });
}

export function setComputed(payload) {
  mutate((draft) => {
    draft.computed = payload;
  });
}

export function togglePlay(play) {
  mutate((draft) => {
    draft.time.playing = play;
  });
}

export function setTimeIndex(index) {
  mutate((draft) => {
    draft.time.index = index;
  });
}

export function setTimeWarp(value) {
  mutate((draft) => {
    draft.time.timeWarp = value;
  });
}
