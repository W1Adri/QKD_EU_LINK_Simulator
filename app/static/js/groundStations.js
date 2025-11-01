import { upsertStation, removeStations } from './state.js';

let builtinStations = [
  { id: 'tenerife', name: 'Teide Observatory (ES)', lat: 28.3, lon: -16.509, aperture: 1.0 },
  { id: 'matera', name: 'Matera Laser Ranging (IT)', lat: 40.649, lon: 16.704, aperture: 1.5 },
  { id: 'grasse', name: 'Observatoire de la Côte d’Azur (FR)', lat: 43.754, lon: 6.920, aperture: 1.54 },
  { id: 'toulouse', name: 'Toulouse Space Centre (FR)', lat: 43.604, lon: 1.444, aperture: 1.0 },
  { id: 'vienna', name: 'Vienna Observatory (AT)', lat: 48.248, lon: 16.357, aperture: 0.8 },
  { id: 'sodankyla', name: 'Sodankylä Geophysical (FI)', lat: 67.366, lon: 26.633, aperture: 1.0 },
  { id: 'matera2', name: 'Matera Secondary (IT)', lat: 40.64, lon: 16.7, aperture: 1.2 },
  { id: 'tenerife2', name: 'La Palma Roque (ES)', lat: 28.761, lon: -17.89, aperture: 2.0 },
];

export async function loadStationsFromServer() {
  try {
    const response = await fetch('/api/ogs');
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.length) {
        builtinStations = data.map((item, idx) => ({
          id: item.id ?? `${item.name.replace(/\s+/g, '-').toLowerCase()}-${idx}`,
          name: item.name,
          lat: item.lat,
          lon: item.lon,
          aperture: item.aperture_m ?? 1.0,
        }));
      }
    }
  } catch (error) {
    console.warn('No se pudieron cargar estaciones remotas, usando base local.', error);
  }
  builtinStations.forEach((station) => upsertStation(station));
}

export async function persistStation(station) {
  try {
    const response = await fetch('/api/ogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: station.name,
        lat: station.lat,
        lon: station.lon,
        aperture_m: station.aperture,
      }),
    });
    if (!response.ok) {
      throw new Error(`Error ${response.status}`);
    }
  } catch (error) {
    console.warn('No se pudo persistir la estación en el backend, se mantendrá solo en memoria.', error);
  }
}

export async function clearStations() {
  try {
    await fetch('/api/ogs', { method: 'DELETE' });
  } catch (error) {
    console.warn('No se pudieron limpiar estaciones remotas.', error);
  }
  removeStations();
}
