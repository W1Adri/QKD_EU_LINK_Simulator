import { formatDistanceKm } from './utils.js';

let map;
let orbitLayer;
let satelliteMarker;
let footprintLayer;
let linkLayer;
const stationMarkers = new Map();
let baseLayers;
let currentBase = 'standard';

const TILE_STANDARD = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export function initMap(container) {
  if (!container) return null;
  map = L.map(container, {
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    minZoom: 2,
    maxZoom: 9,
    worldCopyJump: false,
    maxBounds: [
      [-85, -180],
      [85, 180],
    ],
  });

  baseLayers = {
    standard: L.tileLayer(TILE_STANDARD, {
      attribution: '© OpenStreetMap contributors',
      noWrap: true,
    }),
    satellite: L.tileLayer(TILE_SATELLITE, {
      attribution: 'Imagery © Esri & the GIS User Community',
      noWrap: true,
    }),
  };

  baseLayers.standard.addTo(map);

  orbitLayer = L.polyline([], {
    color: '#7c3aed',
    weight: 2.5,
    opacity: 0.85,
  }).addTo(map);

  linkLayer = L.polyline([], {
    color: '#38bdf8',
    weight: 1.5,
    dashArray: '6 6',
  }).addTo(map);

  satelliteMarker = L.circleMarker([0, 0], {
    radius: 6,
    color: '#f97316',
    weight: 2,
    fillColor: '#fb923c',
    fillOpacity: 0.9,
  }).addTo(map);

  footprintLayer = L.circle([0, 0], {
    radius: 0,
    color: '#22c55e',
    fillColor: '#22c55e',
    fillOpacity: 0.08,
    weight: 1,
  }).addTo(map);

  map.setView([20, 0], 3);
  setTimeout(() => map.invalidateSize(), 150);
  return map;
}

export function setBaseLayer(mode) {
  if (!map || !baseLayers || !baseLayers[mode]) return;
  if (currentBase === mode) return;
  baseLayers[currentBase]?.removeFrom(map);
  baseLayers[mode].addTo(map);
  currentBase = mode;
  map.invalidateSize();
}

export function toggleBaseLayer() {
  const next = currentBase === 'standard' ? 'satellite' : 'standard';
  setBaseLayer(next);
  return next;
}

export function invalidateSize() {
  if (!map) return;
  map.invalidateSize();
}

export function updateGroundTrack(points) {
  if (!orbitLayer) return;
  if (!Array.isArray(points) || points.length === 0) {
    orbitLayer.setLatLngs([]);
    return;
  }

  const segments = [];
  let current = [];
  let prevLon = null;

  points.forEach((point) => {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) {
      return;
    }
    const lon = ((point.lon + 540) % 360) - 180;
    if (prevLon !== null) {
      const delta = Math.abs(lon - prevLon);
      if (delta > 180) {
        if (current.length) {
          segments.push(current);
        }
        current = [];
      }
    }
    current.push([point.lat, lon]);
    prevLon = lon;
  });

  if (current.length) {
    segments.push(current);
  }

  const latLngs = segments.length > 1 ? segments : segments[0];
  orbitLayer.setLatLngs(latLngs ?? []);
}

export function updateSatellitePosition(point, footprintKm = 0) {
  if (!satelliteMarker || !footprintLayer) return;
  satelliteMarker.setLatLng([point.lat, point.lon]);
  footprintLayer.setLatLng([point.lat, point.lon]);
  footprintLayer.setRadius(footprintKm * 1000);
}

export function updateLinkLine(satPoint, station) {
  if (!linkLayer) return;
  if (!station) {
    linkLayer.setLatLngs([]);
    return;
  }
  linkLayer.setLatLngs([
    [station.lat, station.lon],
    [satPoint.lat, satPoint.lon],
  ]);
}

export function renderStations(stations, selectedId) {
  if (!map) return;
  const newIds = new Set();
  stations.forEach((station) => {
    newIds.add(station.id);
    if (!stationMarkers.has(station.id)) {
      const marker = L.circleMarker([station.lat, station.lon], {
        radius: 5,
        color: '#0ea5e9',
        weight: 2,
        fillColor: '#38bdf8',
        fillOpacity: 0.85,
      }).addTo(map);
      marker.bindTooltip(`${station.name}<br>${station.lat.toFixed(2)}°, ${station.lon.toFixed(2)}°`);
      stationMarkers.set(station.id, marker);
    }
    const marker = stationMarkers.get(station.id);
    marker.setStyle({
      color: station.id === selectedId ? '#facc15' : '#0ea5e9',
      fillColor: station.id === selectedId ? '#fde68a' : '#38bdf8',
    });
  });

  Array.from(stationMarkers.keys()).forEach((id) => {
    if (!newIds.has(id)) {
      const marker = stationMarkers.get(id);
      map.removeLayer(marker);
      stationMarkers.delete(id);
    }
  });
}

export function focusOnStation(station) {
  if (!map || !station) return;
  map.flyTo([station.lat, station.lon], Math.max(map.getZoom(), 5), {
    duration: 1.5,
  });
}

export function flyToOrbit(points) {
  if (!map || !points?.length) return;
  const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
  map.flyToBounds(bounds, { padding: [32, 32], duration: 1.5 });
}

export function updateFootprint(distanceKm) {
  if (!footprintLayer) return;
  footprintLayer.setRadius(distanceKm * 1000);
}

export function annotateStationTooltip(station, metrics) {
  if (!stationMarkers.has(station.id)) return;
  const marker = stationMarkers.get(station.id);
  marker.bindTooltip(
    `${station.name}<br>${station.lat.toFixed(2)}°, ${station.lon.toFixed(2)}°<br>${formatDistanceKm(metrics.distanceKm)}`,
    { sticky: true },
  );
}
