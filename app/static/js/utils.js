export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TWO_PI = Math.PI * 2;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function formatDistanceKm(valueKm) {
  if (!isFinite(valueKm)) return '--';
  if (valueKm >= 1000) {
    return `${(valueKm / 1000).toFixed(2)} Mm`;
  }
  return `${valueKm.toFixed(2)} km`;
}

export function formatAngle(valueDeg) {
  if (!isFinite(valueDeg)) return '--';
  return `${valueDeg.toFixed(2)}°`;
}

export function formatLoss(dB) {
  if (!isFinite(dB)) return '--';
  return `${dB.toFixed(2)} dB`;
}

export function formatDoppler(factor) {
  if (!isFinite(factor)) return '--';
  if (Math.abs(factor - 1) < 1e-5) {
    return '≈1';
  }
  return factor.toFixed(6);
}

export function isoNowLocal() {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - tzOffset * 60000);
  return local.toISOString().slice(0, 16);
}

export function haversineDistance(lat1, lon1, lat2, lon2, radiusKm = 6371) {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radiusKm * c;
}

export function smoothArray(values, window = 5) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  const smoothed = [];
  const half = Math.max(1, Math.floor(window / 2));
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < values.length) {
        sum += values[j];
        count++;
      }
    }
    smoothed.push(sum / count);
  }
  return smoothed;
}
