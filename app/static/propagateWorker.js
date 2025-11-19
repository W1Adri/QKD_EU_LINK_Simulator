// Worker for propagating satellites (keplerian + simple J2 secular rates)
// This file runs in a Web Worker context and does not access DOM.
const MU_EARTH = 398600.4418; // km^3/s^2
const EARTH_RADIUS_KM = 6378.137;
const EARTH_ROT_RATE = 7.2921150e-5;
const J2 = 1.08263e-3;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function dateToJulian(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function gmstFromDate(date) {
  const jd = dateToJulian(date);
  const d = jd - 2451545.0;
  const t = d / 36525.0;
  const gmstDeg = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
  return (gmstDeg * DEG2RAD) % (Math.PI * 2);
}

function solveKepler(M, e, tol = 1e-8, maxIter = 50) {
  let E = M;
  if (e > 0.8) E = Math.PI;
  for (let i = 0; i < maxIter; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const d = f / fp;
    E -= d;
    if (Math.abs(d) < tol) break;
  }
  return E;
}

function perifocalToEci(rPerifocal, i, raan, argPerigee) {
  const cosO = Math.cos(raan), sinO = Math.sin(raan);
  const cosI = Math.cos(i), sinI = Math.sin(i);
  const cosW = Math.cos(argPerigee), sinW = Math.sin(argPerigee);
  const rotation = [
    [cosO * cosW - sinO * sinW * cosI, -cosO * sinW - sinO * cosW * cosI, sinO * sinI],
    [sinO * cosW + cosO * sinW * cosI, -sinO * sinW + cosO * cosW * cosI, -cosO * sinI],
    [sinW * sinI, cosW * sinI, cosI],
  ];
  const [x, y, z] = rPerifocal;
  return [ rotation[0][0] * x + rotation[0][1] * y + rotation[0][2] * z,
           rotation[1][0] * x + rotation[1][1] * y + rotation[1][2] * z,
           rotation[2][0] * x + rotation[2][1] * y + rotation[2][2] * z ];
}

function orbitalPosition(a, e, i, raan, argPerigee, meanAnomaly) {
  const n = Math.sqrt(MU_EARTH / (a * a * a));
  const M = (meanAnomaly + 2 * Math.PI) % (2 * Math.PI);
  const E = solveKepler(M, e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const sqrtOneMinusESq = Math.sqrt(1 - e * e);
  const trueAnomaly = Math.atan2(sqrtOneMinusESq * sinE, cosE - e);
  const r = a * (1 - e * cosE);
  const perifocal = [ r * Math.cos(trueAnomaly), r * Math.sin(trueAnomaly), 0 ];
  const rEci = perifocalToEci(perifocal, i, raan, argPerigee);
  return { rEci, trueAnomaly, r };
}

function rotateEciToEcef(rEci, gmst) {
  const cosT = Math.cos(gmst), sinT = Math.sin(gmst);
  const rEcef = [ cosT * rEci[0] + sinT * rEci[1], -sinT * rEci[0] + cosT * rEci[1], rEci[2] ];
  return rEcef;
}

function ecefToLatLon(r) {
  const x = r[0], y = r[1], z = r[2];
  const lon = Math.atan2(y, x) * RAD2DEG;
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp) * RAD2DEG;
  const alt = Math.sqrt(x * x + y * y + z * z) - EARTH_RADIUS_KM;
  return { lat, lon: ((lon + 540) % 360) - 180, alt };
}

function secularRates(a, e, iRad) {
  if (!a || a <= 0) return { dotOmega: 0, dotArgPerigee: 0 };
  const n = Math.sqrt(MU_EARTH / (a * a * a));
  const re_a2 = (EARTH_RADIUS_KM * EARTH_RADIUS_KM) / (a * a);
  const denom = Math.pow(1 - e * e, 2);
  const cosI = Math.cos(iRad);
  const dotOmega = -1.5 * J2 * n * re_a2 * cosI / denom;
  const dotArgPerigee = 0.75 * J2 * n * re_a2 * (5 * cosI * cosI - 1) / denom;
  return { dotOmega, dotArgPerigee, meanMotion: n };
}

onmessage = async function(ev) {
  const msg = ev.data || {};
  if (msg.type === 'propagateBatch') {
    const { constellation, timeline, epoch } = msg.payload || {};
    const total = (Array.isArray(constellation) ? constellation.length : 0);
    if (!total) {
      postMessage({ type: 'error', message: 'Empty constellation' });
      return;
    }
    let epochDate = null;
    if (epoch) {
      epochDate = new Date(epoch);
      if (Number.isNaN(epochDate.getTime())) epochDate = new Date();
    } else epochDate = new Date();
    const gmstInitial = gmstFromDate(epochDate);
    // process each sat serially, posting progress and result
    for (let s = 0; s < total; s += 1) {
      const sat = constellation[s];
      const a = Number(sat.semiMajor) || 6771;
      const e = Number(sat.eccentricity) || 0;
      const i = (Number(sat.inclination) || 0) * DEG2RAD;
      const raan0 = (Number(sat.raan) || 0) * DEG2RAD;
      const arg0 = (Number(sat.argPerigee) || 0) * DEG2RAD;
      const M0 = (Number(sat.meanAnomaly) || 0) * DEG2RAD;
      const rates = secularRates(a, e, i);
      const timelineSamples = Array.isArray(timeline) ? timeline : [0];
      const satTimeline = [];
      for (let ti = 0; ti < timelineSamples.length; ti += 1) {
        const t = timelineSamples[ti];
        const raan_t = raan0 + (rates.dotOmega || 0) * t;
        const arg_t = arg0 + (rates.dotArgPerigee || 0) * t;
        const M = (M0 + (rates.meanMotion || Math.sqrt(MU_EARTH/(a*a*a))) * t) % (2*Math.PI);
        const { rEci, r } = orbitalPosition(a, e, i, raan_t, arg_t, M);
        const gmst = (gmstInitial + EARTH_ROT_RATE * t) % (2*Math.PI);
        const rEcef = rotateEciToEcef(rEci, gmst);
        const geo = ecefToLatLon(rEcef);
        satTimeline.push({ lat: geo.lat, lon: geo.lon, alt: geo.alt });
      }
      postMessage({ type: 'progress', done: s + 1, total });
      postMessage({ type: 'result', id: `s-${s}`, name: `sat-${s}`, timeline: satTimeline, total });
    }
  }
};
