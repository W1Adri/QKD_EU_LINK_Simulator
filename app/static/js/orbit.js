import { DEG2RAD, RAD2DEG, TWO_PI, clamp } from './utils.js';

const MU_EARTH = 398600.4418; // km^3/s^2
const EARTH_RADIUS_KM = 6378.137;
const EARTH_ROT_RATE = 7.2921150e-5; // rad/s
const SIDEREAL_DAY = 86164.0905; // s

function solveKepler(meanAnomaly, eccentricity, tolerance = 1e-8, maxIter = 20) {
  let E = meanAnomaly;
  if (eccentricity > 0.8) {
    E = Math.PI;
  }
  for (let i = 0; i < maxIter; i++) {
    const f = E - eccentricity * Math.sin(E) - meanAnomaly;
    const fPrime = 1 - eccentricity * Math.cos(E);
    const delta = f / fPrime;
    E -= delta;
    if (Math.abs(delta) < tolerance) break;
  }
  return E;
}

function perifocalToEci(rPerifocal, i, raan, argPerigee) {
  const cosO = Math.cos(raan);
  const sinO = Math.sin(raan);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  const cosW = Math.cos(argPerigee);
  const sinW = Math.sin(argPerigee);

  const rotation = [
    [cosO * cosW - sinO * sinW * cosI, -cosO * sinW - sinO * cosW * cosI, sinO * sinI],
    [sinO * cosW + cosO * sinW * cosI, -sinO * sinW + cosO * cosW * cosI, -cosO * sinI],
    [sinW * sinI, cosW * sinI, cosI],
  ];

  const [x, y, z] = rPerifocal;
  return [
    rotation[0][0] * x + rotation[0][1] * y + rotation[0][2] * z,
    rotation[1][0] * x + rotation[1][1] * y + rotation[1][2] * z,
    rotation[2][0] * x + rotation[2][1] * y + rotation[2][2] * z,
  ];
}

function orbitalPositionVelocity(a, e, i, raan, argPerigee, meanAnomaly) {
  const n = Math.sqrt(MU_EARTH / (a ** 3));
  const M = (meanAnomaly + TWO_PI) % TWO_PI;
  const E = solveKepler(M, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const sqrtOneMinusESq = Math.sqrt(1 - e * e);

  const trueAnomaly = Math.atan2(sqrtOneMinusESq * sinE, cosE - e);
  const r = a * (1 - e * cosE);
  const perifocalPosition = [
    r * Math.cos(trueAnomaly),
    r * Math.sin(trueAnomaly),
    0,
  ];

  const perifocalVelocity = [
    -Math.sqrt(MU_EARTH / (a * (1 - e * e))) * Math.sin(trueAnomaly),
    Math.sqrt(MU_EARTH / (a * (1 - e * e))) * (e + Math.cos(trueAnomaly)),
    0,
  ];

  const rEci = perifocalToEci(perifocalPosition, i, raan, argPerigee);
  const vEci = perifocalToEci(perifocalVelocity, i, raan, argPerigee);

  return { rEci, vEci, trueAnomaly, meanMotion: n, radius: r };
}

function rotateEciToEcef(rEci, vEci, gmst) {
  const cosT = Math.cos(gmst);
  const sinT = Math.sin(gmst);

  const rotation = [
    [cosT, sinT, 0],
    [-sinT, cosT, 0],
    [0, 0, 1],
  ];

  const rEcef = [
    rotation[0][0] * rEci[0] + rotation[0][1] * rEci[1] + rotation[0][2] * rEci[2],
    rotation[1][0] * rEci[0] + rotation[1][1] * rEci[1] + rotation[1][2] * rEci[2],
    rotation[2][0] * rEci[0] + rotation[2][1] * rEci[1] + rotation[2][2] * rEci[2],
  ];

  const omegaEarth = [0, 0, EARTH_ROT_RATE];
  const omegaCrossR = [
    omegaEarth[1] * rEcef[2] - omegaEarth[2] * rEcef[1],
    omegaEarth[2] * rEcef[0] - omegaEarth[0] * rEcef[2],
    omegaEarth[0] * rEcef[1] - omegaEarth[1] * rEcef[0],
  ];

  const vEcef = [
    rotation[0][0] * vEci[0] + rotation[0][1] * vEci[1] + rotation[0][2] * vEci[2] - omegaCrossR[0],
    rotation[1][0] * vEci[0] + rotation[1][1] * vEci[1] + rotation[1][2] * vEci[2] - omegaCrossR[1],
    rotation[2][0] * vEci[0] + rotation[2][1] * vEci[1] + rotation[2][2] * vEci[2] - omegaCrossR[2],
  ];

  return { rEcef, vEcef };
}

function ecefToLatLon(rEcef) {
  const [x, y, z] = rEcef;
  const lon = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);
  const alt = Math.sqrt(x * x + y * y + z * z) - EARTH_RADIUS_KM;
  return { lat: lat * RAD2DEG, lon: lon * RAD2DEG, alt };
}

function ecefFromLatLon(latDeg, lonDeg, radiusKm = EARTH_RADIUS_KM) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const cosLat = Math.cos(lat);
  return [
    radiusKm * cosLat * Math.cos(lon),
    radiusKm * cosLat * Math.sin(lon),
    radiusKm * Math.sin(lat),
  ];
}

function enuMatrix(latDeg, lonDeg) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  return [
    [-sinLon, cosLon, 0],
    [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    [cosLat * cosLon, cosLat * sinLon, sinLat],
  ];
}

function losElevation(station, satEcef) {
  const stationEcef = ecefFromLatLon(station.lat, station.lon);
  const rel = [
    satEcef[0] - stationEcef[0],
    satEcef[1] - stationEcef[1],
    satEcef[2] - stationEcef[2],
  ];
  const transform = enuMatrix(station.lat, station.lon);
  const enu = [
    transform[0][0] * rel[0] + transform[0][1] * rel[1] + transform[0][2] * rel[2],
    transform[1][0] * rel[0] + transform[1][1] * rel[1] + transform[1][2] * rel[2],
    transform[2][0] * rel[0] + transform[2][1] * rel[1] + transform[2][2] * rel[2],
  ];
  const distance = Math.sqrt(rel[0] ** 2 + rel[1] ** 2 + rel[2] ** 2);
  const elevation = Math.atan2(enu[2], Math.sqrt(enu[0] ** 2 + enu[1] ** 2));
  const azimuth = Math.atan2(enu[0], enu[1]);
  return { distanceKm: distance, elevationDeg: elevation * RAD2DEG, azimuthDeg: (azimuth * RAD2DEG + 360) % 360 };
}

function dopplerFactor(station, satEcef, satVelEcef, wavelengthNm) {
  const stationEcef = ecefFromLatLon(station.lat, station.lon);
  const rel = [
    satEcef[0] - stationEcef[0],
    satEcef[1] - stationEcef[1],
    satEcef[2] - stationEcef[2],
  ];
  const distance = Math.sqrt(rel[0] ** 2 + rel[1] ** 2 + rel[2] ** 2);
  const unit = rel.map((c) => c / distance);
  const relVel = satVelEcef;
  const radialVelocity = relVel[0] * unit[0] + relVel[1] * unit[1] + relVel[2] * unit[2];
  const c = 299792.458; // km/s
  const factor = 1 / (1 - radialVelocity / c);
  const lambdaMeters = wavelengthNm * 1e-9;
  const observedWavelength = lambdaMeters * factor;
  return { factor, observedWavelength }; // Observed wavelength for reference
}

function geometricLoss(distanceKm, satAperture, groundAperture, wavelengthNm) {
  const lambda = wavelengthNm * 1e-9; // m
  const distanceM = distanceKm * 1000;
  const divergence = 1.22 * lambda / Math.max(satAperture, 1e-3);
  const spotRadius = Math.max(divergence * distanceM * 0.5, 1e-6);
  const captureRadius = groundAperture * 0.5;
  const coupling = Math.min(1, (captureRadius / spotRadius) ** 2);
  const lossDb = -10 * Math.log10(Math.max(coupling, 1e-9));
  return { coupling, lossDb };
}

function computeSemiMajorWithResonance(orbits, rotations) {
  const totalTime = (rotations / orbits) * SIDEREAL_DAY;
  const semiMajor = Math.cbrt((MU_EARTH * (totalTime / (2 * Math.PI)) ** 2));
  return semiMajor;
}

export function propagateOrbit(settings) {
  const {
    orbital,
    resonance,
    samplesPerOrbit,
    time: { timeline: currentTimeline },
  } = settings;

  const i = orbital.inclination * DEG2RAD;
  const raan = orbital.raan * DEG2RAD;
  const argPerigee = orbital.argPerigee * DEG2RAD;
  const meanAnomaly0 = orbital.meanAnomaly * DEG2RAD;

  let semiMajor = orbital.semiMajor;
  if (resonance.enabled) {
    semiMajor = computeSemiMajorWithResonance(resonance.orbits, resonance.rotations);
  }
  semiMajor = clamp(semiMajor, 6600, 9000);

  const meanMotion = Math.sqrt(MU_EARTH / (semiMajor ** 3));
  const orbitPeriod = TWO_PI / meanMotion;
  const totalOrbits = resonance.enabled ? Math.max(1, resonance.orbits) : 3;
  const totalTime = orbitPeriod * totalOrbits;
  const totalSamples = Math.max(2, Math.round(samplesPerOrbit * totalOrbits));
  const dt = totalTime / (totalSamples - 1);

  const timeline = currentTimeline?.length === totalSamples
    ? currentTimeline
    : Array.from({ length: totalSamples }, (_, idx) => idx * dt);

  const dataPoints = timeline.map((t) => {
    const M = (meanAnomaly0 + meanMotion * t) % TWO_PI;
    const { rEci, vEci } = orbitalPositionVelocity(semiMajor, orbital.eccentricity, i, raan, argPerigee, M);
    const gmst = EARTH_ROT_RATE * t;
    const { rEcef, vEcef } = rotateEciToEcef(rEci, vEci, gmst);
    const geo = ecefToLatLon(rEcef);
    return {
      t,
      rEci,
      vEci,
      rEcef,
      vEcef,
      lat: geo.lat,
      lon: ((geo.lon + 540) % 360) - 180,
      alt: geo.alt,
    };
  });

  const groundTrack = dataPoints.map((p) => ({ lat: p.lat, lon: p.lon }));

  return {
    semiMajor,
    orbitPeriod,
    totalTime,
    timeline,
    dataPoints,
    groundTrack,
  };
}

export function computeStationMetrics(dataPoints, station, optical) {
  if (!station || !dataPoints?.length) {
    return {
      distanceKm: [],
      elevationDeg: [],
      lossDb: [],
      doppler: [],
      azimuthDeg: [],
    };
  }

  const distanceKm = [];
  const elevationDeg = [];
  const lossDb = [];
  const doppler = [];
  const azimuthDeg = [];

  dataPoints.forEach((point) => {
    const los = losElevation(station, point.rEcef);
    const geom = geometricLoss(los.distanceKm, optical.satAperture, optical.groundAperture, optical.wavelength);
    const dop = dopplerFactor(station, point.rEcef, point.vEcef, optical.wavelength);
    distanceKm.push(los.distanceKm);
    elevationDeg.push(los.elevationDeg);
    lossDb.push(geom.lossDb);
    doppler.push(dop.factor);
    azimuthDeg.push(los.azimuthDeg);
  });

  return { distanceKm, elevationDeg, lossDb, doppler, azimuthDeg };
}

export function stationEcef(station) {
  return ecefFromLatLon(station.lat, station.lon);
}

export const constants = {
  MU_EARTH,
  EARTH_RADIUS_KM,
  EARTH_ROT_RATE,
  SIDEREAL_DAY,
};
