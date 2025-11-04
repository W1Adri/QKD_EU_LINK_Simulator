const MU = 398600.4418; // km^3/s^2
const TWO_PI = Math.PI * 2;
export const SIDEREAL_DAY = 86164.09; // s
const MAX_BOUND = 500;

function clampInt(value, min, max) {
  const v = Math.round(Number(value) || 0);
  return Math.min(Math.max(v, min), max);
}

function aFromPeriod(periodSeconds) {
  return Math.pow(MU * Math.pow(periodSeconds / TWO_PI, 2), 1 / 3);
}

/**
 * Searches integer resonance pairs (j rotations, k orbits) within bounds, returning
 * candidates whose semi-major axis lies inside the tolerance interval.
 */
export function searchResonances({
  targetA,
  toleranceKm = 0,
  minRotations,
  maxRotations,
  minOrbits,
  maxOrbits,
  siderealDay = SIDEREAL_DAY,
}) {
  const center = Number(targetA);
  if (!Number.isFinite(center) || center <= 0) {
    return [];
  }

  const tolerance = Math.max(0, Number(toleranceKm) || 0);
  const lowerBoundJ = clampInt(minRotations ?? 1, 1, MAX_BOUND);
  let upperBoundJ = clampInt(maxRotations ?? MAX_BOUND, 1, MAX_BOUND);
  if (upperBoundJ < lowerBoundJ) upperBoundJ = lowerBoundJ;

  const lowerBoundK = clampInt(minOrbits ?? 1, 1, MAX_BOUND);
  let upperBoundK = clampInt(maxOrbits ?? MAX_BOUND, 1, MAX_BOUND);
  if (upperBoundK < lowerBoundK) upperBoundK = lowerBoundK;

  const hits = [];

  for (let j = lowerBoundJ; j <= upperBoundJ; j++) {
    const periodFactor = j * siderealDay;
    for (let k = lowerBoundK; k <= upperBoundK; k++) {
      const period = periodFactor / k;
      const semiMajorKm = aFromPeriod(period);
      const deltaKm = semiMajorKm - center;
      if (Math.abs(deltaKm) <= tolerance) {
        hits.push({
          j,
          k,
          ratio: j / k,
          periodSec: period,
          semiMajorKm,
          deltaKm,
        });
      }
    }
  }

  hits.sort((a, b) => {
    if (a.j !== b.j) return a.j - b.j;
    return a.k - b.k;
  });

  return hits;
}
