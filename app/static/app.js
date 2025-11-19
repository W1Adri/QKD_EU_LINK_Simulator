(() => {
  const modules = {};
  const cache = {};

  function define(name, factory) {
    modules[name] = factory;
  }

  function require(name) {
    if (cache[name]) {
      return cache[name].exports;
    }
    if (!Object.prototype.hasOwnProperty.call(modules, name)) {
      throw new Error(`Module ${name} not found.`);
    }
    const module = { exports: {} };
    cache[name] = module;
    modules[name](module.exports, module);
    return module.exports;
  }

  define('utils', (exports, module) => {
    const DEG2RAD = Math.PI / 180;
    const RAD2DEG = 180 / Math.PI;
    const TWO_PI = Math.PI * 2;

    // Enhanced error logging and checkpoint system
    const LOG_LEVELS = {
      DEBUG: 0,
      INFO: 1,
      WARN: 2,
      ERROR: 3,
      CHECKPOINT: 4
    };

    let currentLogLevel = LOG_LEVELS.INFO;

    function setLogLevel(level) {
      currentLogLevel = LOG_LEVELS[level] || LOG_LEVELS.INFO;
    }

    function logCheckpoint(message, data = null) {
      if (currentLogLevel <= LOG_LEVELS.CHECKPOINT) {
        console.log(`%c[CHECKPOINT]%c ${message}`, 
          'background: #4fd1ff; color: #000; padding: 2px 6px; border-radius: 3px; font-weight: bold',
          'color: #4fd1ff',
          data || '');
      }
    }

    function logError(context, error, additionalData = null) {
      if (currentLogLevel <= LOG_LEVELS.ERROR) {
        console.error(`%c[ERROR]%c ${context}:`, 
          'background: #ff4d4d; color: #fff; padding: 2px 6px; border-radius: 3px; font-weight: bold',
          'color: #ff4d4d',
          error);
        if (additionalData) {
          console.error('Additional data:', additionalData);
        }
        console.trace('Stack trace:');
      }
    }

    function logWarning(message, data = null) {
      if (currentLogLevel <= LOG_LEVELS.WARN) {
        console.warn(`%c[WARN]%c ${message}`, 
          'background: #ffa500; color: #000; padding: 2px 6px; border-radius: 3px; font-weight: bold',
          'color: #ffa500',
          data || '');
      }
    }

    function logInfo(message, data = null) {
      if (currentLogLevel <= LOG_LEVELS.INFO) {
        console.log(`%c[INFO]%c ${message}`, 
          'background: #4f46e5; color: #fff; padding: 2px 6px; border-radius: 3px; font-weight: bold',
          'color: #4f46e5',
          data || '');
      }
    }

    async function safeFetch(url, options = {}, context = 'API call') {
      logCheckpoint(`Starting fetch: ${context}`, { url, options });
      try {
        const response = await fetch(url, options);
        logCheckpoint(`Fetch response received: ${context}`, { 
          status: response.status, 
          ok: response.ok 
        });
        
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unable to read error response');
          const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.response = response;
          error.body = errorText;
          throw error;
        }
        
        return response;
      } catch (error) {
        logError(context, error, { url, options });
        throw error;
      }
    }

    function validateNumber(value, min = -Infinity, max = Infinity, paramName = 'value') {
      const num = Number(value);
      if (!isFinite(num)) {
        logWarning(`Invalid number for ${paramName}: ${value}`);
        return null;
      }
      if (num < min || num > max) {
        logWarning(`${paramName} out of range [${min}, ${max}]: ${num}`);
        return null;
      }
      return num;
    }

    function validateRequired(value, paramName = 'value') {
      if (value === null || value === undefined || value === '') {
        logWarning(`Required parameter missing: ${paramName}`);
        return false;
      }
      return true;
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function lerp(a, b, t) {
      return a + (b - a) * t;
    }

    function formatDistanceKm(valueKm) {
      if (!isFinite(valueKm)) return '--';
      if (valueKm >= 1000) {
        return `${(valueKm / 1000).toFixed(2)} Mm`;
      }
      return `${valueKm.toFixed(2)} km`;
    }

    function formatAngle(valueDeg) {
      if (!isFinite(valueDeg)) return '--';
      return `${valueDeg.toFixed(2)}°`;
    }

    function formatLoss(dB) {
      if (!isFinite(dB)) return '--';
      return `${dB.toFixed(2)} dB`;
    }

    function formatDuration(seconds) {
      if (!isFinite(seconds)) return '--';
      const sign = seconds < 0 ? '-' : '';
      const total = Math.floor(Math.abs(seconds));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      const parts = [];
      if (hours) parts.push(`${hours} h`);
      if (minutes || hours) parts.push(`${minutes} min`);
      parts.push(`${secs} s`);
      return `${sign}${parts.join(' ')}`;
    }

    function formatDoppler(factor) {
      if (!isFinite(factor)) return '--';
      if (Math.abs(factor - 1) < 1e-5) {
        return '≈1';
      }
      return factor.toFixed(6);
    }

    function isoNowLocal() {
      const now = new Date();
      const tzOffset = now.getTimezoneOffset();
      const local = new Date(now.getTime() - tzOffset * 60000);
      return local.toISOString().slice(0, 16);
    }

    function haversineDistance(lat1, lon1, lat2, lon2, radiusKm = 6371) {
      const dLat = (lat2 - lat1) * DEG2RAD;
      const dLon = (lon2 - lon1) * DEG2RAD;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return radiusKm * c;
    }

    function smoothArray(values, window = 5) {
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

    module.exports = { 
      DEG2RAD, RAD2DEG, TWO_PI, 
      clamp, lerp, 
      formatDistanceKm, formatAngle, formatLoss, formatDuration, formatDoppler, 
      isoNowLocal, haversineDistance, smoothArray,
      // Error handling and logging
      logCheckpoint, logError, logWarning, logInfo, setLogLevel,
      safeFetch, validateNumber, validateRequired
    };

  });
  define('j2Propagator', (exports, module) => {
    // Simple J2 secular rate approximations for RAAN and argument of perigee
    const MU_EARTH = 398600.4418; // km^3/s^2
    const EARTH_RADIUS_KM = 6378.137; // km
    const J2 = 1.08263e-3;

    function secularRates(a, e, iRad) {
      // a in km, e unitless, iRad in radians
      if (!a || a <= 0) return { dotOmega: 0, dotOmegaDeg: 0, dotArgPerigee: 0 };
      const n = Math.sqrt(MU_EARTH / (a * a * a)); // mean motion (rad/s)
      const re_a2 = (EARTH_RADIUS_KM * EARTH_RADIUS_KM) / (a * a);
      const denom = Math.pow(1 - e * e, 2);
      const cosI = Math.cos(iRad);
      const cosI2 = cosI * cosI;

      const dotOmega = -1.5 * J2 * n * re_a2 * cosI / denom; // rad/s
      const dotArgPerigee = 0.75 * J2 * n * re_a2 * (5 * cosI2 - 1) / denom; // rad/s

      return {
        dotOmega, // rad/s
        dotOmegaDeg: dotOmega * (180 / Math.PI),
        dotArgPerigee, // rad/s
        dotArgPerigeeDeg: dotArgPerigee * (180 / Math.PI),
        meanMotion: n,
      };
    }

    module.exports = { MU_EARTH, EARTH_RADIUS_KM, J2, secularRates };
  });

  define('walkerGenerator', (exports, module) => {
    // Walker Delta constellation generator
    // T = total satellites, P = number of planes, F = relative phasing
    function generateWalkerConstellation(T, P, F, a, iDeg, e = 0.0, raanOffsetDeg = 0) {
      const sats = [];
      const S = Math.round(T / P) || 1; // satellites per plane
      const i = Number(iDeg) || 0;
      for (let p = 0; p < P; p += 1) {
        const raan = (360 * p) / P + (raanOffsetDeg || 0);
        for (let s = 0; s < S; s += 1) {
          const m = (360 * s) / S + (360 * F * p) / T;
          sats.push({
            semiMajor: a,
            eccentricity: e,
            inclination: i,
            raan: ((raan % 360) + 360) % 360,
            argPerigee: 0,
            meanAnomaly: ((m % 360) + 360) % 360,
          });
        }
      }
      return sats;
    }

    module.exports = { generateWalkerConstellation };
  });

  define('optimizationEngine', (exports, module) => {
    const { haversineDistance } = require('utils');

    function computeRevisitTime(constellationPositions, points, timelineSeconds, revisitThresholdKm = 500) {
      // constellationPositions: { groupId: { satellites: [{ id,name,timeline:[{lat,lon,alt}] }] } }
      // points: [{lat,lon}], timelineSeconds: array of times matching timelines
      if (!Array.isArray(points) || !Array.isArray(timelineSeconds)) return { max: Infinity, mean: Infinity };

      const perPointIntervals = points.map(() => []);
      const numSamples = timelineSeconds.length;

      for (let ti = 0; ti < numSamples; ti += 1) {
        // collect all satellite positions at this time
        const posList = [];
        Object.values(constellationPositions).forEach((group) => {
          (group.satellites || []).forEach((sat) => {
            const snap = sat.timeline && sat.timeline[ti];
            if (snap && Number.isFinite(snap.lat) && Number.isFinite(snap.lon)) {
              posList.push(snap);
            }
          });
        });

        if (!posList.length) continue;

        points.forEach((pt, pIdx) => {
          let seen = false;
          for (let s = 0; s < posList.length; s += 1) {
            const satPos = posList[s];
            const d = haversineDistance(pt.lat, pt.lon, satPos.lat, satPos.lon, 6371);
            if (d <= revisitThresholdKm) { seen = true; break; }
          }
          if (seen) perPointIntervals[pIdx].push(timelineSeconds[ti]);
        });
      }

      const revisitStats = perPointIntervals.map((times) => {
        if (!times.length) return { max: Infinity, mean: Infinity };
        const diffs = [];
        for (let k = 1; k < times.length; k += 1) diffs.push(times[k] - times[k - 1]);
        if (!diffs.length) return { max: 0, mean: 0 };
        const max = Math.max(...diffs);
        const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        return { max, mean };
      });

      const valid = revisitStats.filter((s) => isFinite(s.max));
      if (!valid.length) return { max: Infinity, mean: Infinity };
      const maxRevisit = Math.max(...valid.map((s) => s.max));
      const meanRevisit = valid.reduce((acc, s) => acc + s.mean, 0) / valid.length;
      return { max: maxRevisit, mean: meanRevisit };
    }

    function mutateConstellation(constellation, sigmaDeg = 1.0) {
      // Create a shallow mutated copy, perturbing RAAN and M by gaussian-like step
      return constellation.map((sat) => {
        const deltaRaan = (Math.random() * 2 - 1) * sigmaDeg;
        const deltaM = (Math.random() * 2 - 1) * sigmaDeg;
        return {
          ...sat,
          raan: ((sat.raan + deltaRaan) % 360 + 360) % 360,
          meanAnomaly: ((sat.meanAnomaly + deltaM) % 360 + 360) % 360,
        };
      });
    }

    function optimizeConstellation(initialConstellation, constellationPositionsFactory, points, timelineSeconds, iterations = 100) {
      // constellationPositionsFactory: (constellation) => precomputed positions structure matching computeRevisitTime input
      let best = initialConstellation.map((s) => ({ ...s }));
      let bestPositions = constellationPositionsFactory(best);
      let bestScoreObj = computeRevisitTime(bestPositions, points, timelineSeconds);
      let bestScore = bestScoreObj.max;

      for (let it = 0; it < iterations; it += 1) {
        const candidate = mutateConstellation(best, Math.max(0.1, 5 * (1 - it / iterations)));
        const candidatePositions = constellationPositionsFactory(candidate);
        const scoreObj = computeRevisitTime(candidatePositions, points, timelineSeconds);
        const score = scoreObj.max;
        if (score < bestScore) {
          best = candidate;
          bestPositions = candidatePositions;
          bestScoreObj = scoreObj;
          bestScore = score;
        }
      }

      return { constellation: best, stats: bestScoreObj, positions: bestPositions };
    }

    module.exports = { computeRevisitTime, mutateConstellation, optimizeConstellation };
  });

  // QKD Calculations Module - Cosmica-inspired implementation
  define('qkdCalculations', (exports, module) => {
    const { logCheckpoint, logError, validateNumber } = require('utils');
    
    // Physical constants
    const H_PLANCK = 6.62607015e-34; // J⋅s
    const C_LIGHT = 2.99792458e8;     // m/s
    
    /**
     * Calculate secure key rate for BB84 protocol
     * @param {Object} params - QKD parameters
     * @returns {Object} QKD performance metrics
     */
    function calculateBB84Performance(params) {
      logCheckpoint('Calculating BB84 QKD performance', params);
      
      try {
        // Validate inputs
        const photonRate = validateNumber(params.photonRate, 0, 1e12, 'photonRate');
        const channelLossdB = validateNumber(params.channelLossdB, 0, 100, 'channelLossdB');
        const detectorEff = validateNumber(params.detectorEfficiency, 0, 1, 'detectorEfficiency');
        const darkCountRate = validateNumber(params.darkCountRate, 0, 1e6, 'darkCountRate');
        
        if (!photonRate || channelLossdB === null || !detectorEff || darkCountRate === null) {
          throw new Error('Invalid input parameters for QKD calculation');
        }
        
        // Convert channel loss from dB to linear transmittance
        const channelTransmittance = Math.pow(10, -channelLossdB / 10);
        logCheckpoint('Channel transmittance', channelTransmittance);
        
        // Calculate detection rate
        const mu = 0.5; // Mean photon number per pulse for weak coherent pulses
        const detectionRate = photonRate * channelTransmittance * detectorEff * Math.exp(-mu);
        
        // Calculate noise contributions
        const backgroundRate = darkCountRate;
        const totalNoiseRate = backgroundRate;
        
        // Calculate QBER (Quantum Bit Error Rate)
        const signalRate = detectionRate;
        const errorRate = totalNoiseRate / 2; // Noise causes 50% errors
        const qber = errorRate / (signalRate + errorRate);
        
        logCheckpoint('QBER calculated', qber);
        
        // Sifting efficiency for BB84 (after basis reconciliation)
        const siftingEfficiency = 0.5;
        const siftedKeyRate = (signalRate + errorRate) * siftingEfficiency;
        
        // Shannon entropy function
        const h = (x) => {
          if (x <= 0 || x >= 1) return 0;
          return -x * Math.log2(x) - (1 - x) * Math.log2(1 - x);
        };
        
        // Secure key rate using simplified formula
        // R_secure = R_sifted * [1 - h(QBER)] - leakage_EC
        // Where leakage_EC ≈ 1.16 * h(QBER) * R_sifted for practical error correction
        const informationReconciliationEfficiency = 1.16;
        const privacyAmplificationCost = h(qber) * siftedKeyRate;
        const errorCorrectionLeakage = informationReconciliationEfficiency * h(qber) * siftedKeyRate;
        
        let secureKeyRate = siftedKeyRate - privacyAmplificationCost - errorCorrectionLeakage;
        
        // Apply QBER threshold (typically ~11% for BB84)
        const qberThreshold = 0.11;
        if (qber > qberThreshold) {
          secureKeyRate = 0;
          logCheckpoint('QBER exceeds threshold, secure key rate = 0');
        }
        
        // Ensure non-negative
        secureKeyRate = Math.max(0, secureKeyRate);
        
        return {
          qber: qber * 100, // Convert to percentage
          rawKeyRate: siftedKeyRate / 1000, // Convert to kbps
          secureKeyRate: secureKeyRate / 1000, // Convert to kbps
          channelTransmittance: channelTransmittance,
          detectionRate: detectionRate,
          siftedKeyRate: siftedKeyRate,
          protocol: 'BB84'
        };
      } catch (error) {
        logError('BB84 calculation failed', error, params);
        return {
          qber: null,
          rawKeyRate: null,
          secureKeyRate: null,
          channelTransmittance: null,
          error: error.message
        };
      }
    }
    
    /**
     * Calculate secure key rate for E91 protocol (entanglement-based)
     * @param {Object} params - QKD parameters
     * @returns {Object} QKD performance metrics
     */
    function calculateE91Performance(params) {
      logCheckpoint('Calculating E91 QKD performance', params);
      
      try {
        // Validate inputs
        const pairRate = validateNumber(params.photonRate / 2, 0, 1e12, 'pairRate'); // Entangled pairs
        const channelLossdB = validateNumber(params.channelLossdB, 0, 100, 'channelLossdB');
        const detectorEff = validateNumber(params.detectorEfficiency, 0, 1, 'detectorEfficiency');
        const darkCountRate = validateNumber(params.darkCountRate, 0, 1e6, 'darkCountRate');
        
        if (!pairRate || channelLossdB === null || !detectorEff || darkCountRate === null) {
          throw new Error('Invalid input parameters for E91 calculation');
        }
        
        // Convert channel loss
        const channelTransmittance = Math.pow(10, -channelLossdB / 10);
        
        // E91 requires coincidence detection on both sides
        // Simplified model: both photons must be detected
        const coincidenceRate = pairRate * Math.pow(channelTransmittance * detectorEff, 2);
        
        // Calculate QBER from dark counts and accidental coincidences
        const accidentalRate = darkCountRate * darkCountRate / (pairRate || 1);
        const qber = accidentalRate / (coincidenceRate + accidentalRate);
        
        logCheckpoint('E91 QBER calculated', qber);
        
        // Secure key rate for entanglement-based QKD
        const h = (x) => {
          if (x <= 0 || x >= 1) return 0;
          return -x * Math.log2(x) - (1 - x) * Math.log2(1 - x);
        };
        
        let secureKeyRate = coincidenceRate * (1 - 2 * h(qber));
        
        // QBER threshold for E91 (can tolerate slightly higher QBER)
        const qberThreshold = 0.15;
        if (qber > qberThreshold) {
          secureKeyRate = 0;
        }
        
        secureKeyRate = Math.max(0, secureKeyRate);
        
        return {
          qber: qber * 100,
          rawKeyRate: coincidenceRate / 1000,
          secureKeyRate: secureKeyRate / 1000,
          channelTransmittance: channelTransmittance,
          detectionRate: coincidenceRate,
          protocol: 'E91'
        };
      } catch (error) {
        logError('E91 calculation failed', error, params);
        return {
          qber: null,
          rawKeyRate: null,
          secureKeyRate: null,
          channelTransmittance: null,
          error: error.message
        };
      }
    }
    
    /**
     * Calculate continuous variable QKD performance
     * @param {Object} params - QKD parameters
     * @returns {Object} QKD performance metrics
     */
    function calculateCVQKDPerformance(params) {
      logCheckpoint('Calculating CV-QKD performance', params);
      
      try {
        const modulationVariance = 10; // Shot noise units
        const channelLossdB = validateNumber(params.channelLossdB, 0, 100, 'channelLossdB');
        const detectorEff = validateNumber(params.detectorEfficiency, 0, 1, 'detectorEfficiency');
        const electronicNoise = 0.01; // Normalized electronic noise
        
        if (channelLossdB === null || !detectorEff) {
          throw new Error('Invalid input parameters for CV-QKD calculation');
        }
        
        const channelTransmittance = Math.pow(10, -channelLossdB / 10);
        const totalTransmittance = channelTransmittance * detectorEff;
        
        // Simplified CV-QKD rate formula
        // R ∝ log2(1 + SNR) - log2(1 + noise/signal)
        const snr = totalTransmittance * modulationVariance / (1 + electronicNoise);
        const excessNoise = electronicNoise / totalTransmittance;
        
        const symbolRate = 100e6; // 100 MHz symbol rate (example)
        let secureKeyRate = symbolRate * Math.max(0, Math.log2(1 + snr) - Math.log2(1 + excessNoise));
        
        // CV-QKD typically has lower QBER but is more sensitive to loss
        const effectiveQBER = excessNoise / (snr + excessNoise);
        
        return {
          qber: effectiveQBER * 100,
          rawKeyRate: symbolRate / 1000,
          secureKeyRate: secureKeyRate / 1000,
          channelTransmittance: channelTransmittance,
          snr: snr,
          protocol: 'CV-QKD'
        };
      } catch (error) {
        logError('CV-QKD calculation failed', error, params);
        return {
          qber: null,
          rawKeyRate: null,
          secureKeyRate: null,
          channelTransmittance: null,
          error: error.message
        };
      }
    }
    
    /**
     * Main QKD performance calculator - routes to appropriate protocol
     * @param {string} protocol - QKD protocol ('bb84', 'e91', 'cv-qkd')
     * @param {Object} params - QKD and link parameters
     * @returns {Object} QKD performance metrics
     */
    function calculateQKDPerformance(protocol, params) {
      logCheckpoint(`Calculating QKD performance for protocol: ${protocol}`, params);
      
      switch (protocol.toLowerCase()) {
        case 'bb84':
          return calculateBB84Performance(params);
        case 'e91':
          return calculateE91Performance(params);
        case 'cv-qkd':
          return calculateCVQKDPerformance(params);
        default:
          logError('Unknown QKD protocol', new Error(`Protocol ${protocol} not supported`));
          return {
            error: `Unknown protocol: ${protocol}`
          };
      }
    }
    
    module.exports = {
      calculateQKDPerformance,
      calculateBB84Performance,
      calculateE91Performance,
      calculateCVQKDPerformance
    };
  });

  define('state', (exports, module) => {
    const { isoNowLocal } = require('utils');

    const CONSTELLATION_GROUPS = [
      { id: 'starlink', label: 'Starlink', color: '#38bdf8' },
      { id: 'oneweb', label: 'OneWeb', color: '#f97316' },
      { id: 'gps', label: 'GPS', color: '#a855f7' },
      { id: 'galileo', label: 'Galileo', color: '#22c55e' },
      { id: 'glonass', label: 'GLONASS', color: '#ef4444' },
    ];

    function createDefaultConstellationState() {
      const registry = CONSTELLATION_GROUPS.reduce((acc, item) => {
        acc[item.id] = {
          id: item.id,
          label: item.label,
          color: item.color,
          enabled: false,
          loading: false,
          error: null,
          hasData: false,
          count: 0,
          fetchedAt: null,
        };
        return acc;
      }, {});
      return {
        registry,
        order: CONSTELLATION_GROUPS.map((item) => item.id),
      };
    }

    const listeners = new Set();

    const defaultState = {
      variant: document.body?.dataset?.variant ?? 'compact',
      mode: 'individual',
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
      optimizationPoints: [],
      constellations: createDefaultConstellationState(),
      computed: {
        semiMajor: null,
        orbitPeriod: null,
        dataPoints: [],
        groundTrack: [],
        constellationPositions: {},
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

  const state = structuredClone(defaultState);

    function subscribe(listener, invokeImmediately = true) {
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

    function mutate(mutator) {
      if (typeof mutator !== 'function') return;
      mutator(state);
      emit();
    }

    function resetComputed() {
      state.computed = structuredClone(defaultState.computed);
      emit();
    }

    function setTheme(theme) {
      mutate((draft) => {
        draft.theme = theme;
      });
    }

    function setVariant(variant) {
      mutate((draft) => {
        draft.variant = variant;
      });
    }

    function ensureStationSelected() {
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

    function upsertStation(station) {
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

    function removeStations() {
      mutate((draft) => {
        draft.stations.list = [];
        draft.stations.selectedId = null;
      });
    }

    function removeStation(id) {
      if (!id) return;
      mutate((draft) => {
        const filtered = draft.stations.list.filter((item) => item.id !== id);
        draft.stations.list = filtered;
        if (draft.stations.selectedId === id) {
          draft.stations.selectedId = filtered.length ? filtered[0].id : null;
        }
      });
    }

    function selectStation(id) {
      mutate((draft) => {
        draft.stations.selectedId = id;
      });
    }

    function setTimeline(data) {
      mutate((draft) => {
        draft.time.timeline = data.timeline;
        draft.time.totalSeconds = data.totalSeconds;
        draft.time.index = Math.min(draft.time.index, data.timeline.length - 1);
      });
    }

    function setComputed(payload) {
      mutate((draft) => {
        draft.computed = payload;
      });
    }

    function togglePlay(play) {
      mutate((draft) => {
        draft.time.playing = play;
      });
    }

    function setTimeIndex(index) {
      mutate((draft) => {
        draft.time.index = index;
      });
    }

    function setTimeWarp(value) {
      mutate((draft) => {
        draft.time.timeWarp = value;
      });
    }

    function withConstellationGroup(groupId, updater) {
      if (!groupId || typeof updater !== 'function') return;
      mutate((draft) => {
        const registry = draft.constellations?.registry;
        if (!registry || !registry[groupId]) return;
        updater(registry[groupId]);
      });
    }

    function setConstellationEnabled(groupId, enabled) {
      withConstellationGroup(groupId, (group) => {
        group.enabled = Boolean(enabled);
      });
    }

    function setConstellationLoading(groupId, loading) {
      withConstellationGroup(groupId, (group) => {
        group.loading = Boolean(loading);
        if (loading) {
          group.error = null;
        }
      });
    }

    function setConstellationMetadata(groupId, metadata = {}) {
      withConstellationGroup(groupId, (group) => {
        if (Object.prototype.hasOwnProperty.call(metadata, 'hasData')) {
          group.hasData = Boolean(metadata.hasData);
        }
        if (Object.prototype.hasOwnProperty.call(metadata, 'count')) {
          group.count = Number(metadata.count) || 0;
        }
        if (Object.prototype.hasOwnProperty.call(metadata, 'fetchedAt')) {
          group.fetchedAt = metadata.fetchedAt ?? null;
        }
      });
    }

    function setConstellationError(groupId, message) {
      withConstellationGroup(groupId, (group) => {
        group.error = message || null;
      });
    }

    module.exports = {
      state,
      subscribe,
      mutate,
      resetComputed,
      setTheme,
      setVariant,
      ensureStationSelected,
      upsertStation,
      removeStations,
      removeStation,
      selectStation,
      setTimeline,
      setComputed,
      togglePlay,
      setTimeIndex,
      setTimeWarp,
      CONSTELLATION_GROUPS,
      setConstellationEnabled,
      setConstellationLoading,
      setConstellationMetadata,
      setConstellationError,
    };

  });
  define('orbit', (exports, module) => {
    const { DEG2RAD, RAD2DEG, TWO_PI, clamp, haversineDistance } = require('utils');
    const j2 = require('j2Propagator');

    const MU_EARTH = 398600.4418; // km^3/s^2
    const EARTH_RADIUS_KM = 6378.137;
    const EARTH_ROT_RATE = 7.2921150e-5; // rad/s
    const SIDEREAL_DAY = 86164.0905; // s
    const MIN_SEMI_MAJOR = EARTH_RADIUS_KM + 160; // ≈160 km minimum altitude
    const GEO_ALTITUDE_KM = 35786; // GEO altitude used as realistic upper bound
    const MAX_SEMI_MAJOR = EARTH_RADIUS_KM + GEO_ALTITUDE_KM; // ≈42 164 km
    const CLOSURE_SURFACE_TOL_KM = 0.25;
    const CLOSURE_CARTESIAN_TOL_KM = 0.1;

    function normalizeAngle(angle) {
      const twoPi = Math.PI * 2;
      let normalized = angle % twoPi;
      if (normalized < 0) {
        normalized += twoPi;
      }
      return normalized;
    }

    function dateToJulian(date) {
      if (!(date instanceof Date) || Number.isNaN(date?.getTime?.())) {
        return null;
      }
      return date.getTime() / 86400000 + 2440587.5;
    }

    function gmstFromDate(date) {
      const jd = dateToJulian(date);
      if (!Number.isFinite(jd)) {
        return 0;
      }
      const d = jd - 2451545.0;
      const t = d / 36525.0;
      const gmstDeg = 280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000;
      const gmstRad = gmstDeg * DEG2RAD;
      return normalizeAngle(gmstRad);
    }

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

    function propagateOrbit(settings, options = {}) {
      const {
        orbital,
        resonance,
        samplesPerOrbit,
        time: { timeline: currentTimeline },
      } = settings;
      const { samplesPerOrbit: samplesOverride } = options;

      const i = orbital.inclination * DEG2RAD;
      const raan = orbital.raan * DEG2RAD;
      const argPerigee = orbital.argPerigee * DEG2RAD;
      const meanAnomaly0 = orbital.meanAnomaly * DEG2RAD;

      const resonanceInfo = {
        requested: Boolean(resonance.enabled),
        applied: false,
        ratio: resonance.enabled ? { orbits: resonance.orbits, rotations: resonance.rotations } : null,
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
      };

      let semiMajor = clamp(orbital.semiMajor, MIN_SEMI_MAJOR, MAX_SEMI_MAJOR);
      if (resonance.enabled) {
        const safeOrbits = Math.max(1, resonance.orbits || 1);
        const safeRotations = Math.max(1, resonance.rotations || 1);
        const targetPeriod = (safeRotations / safeOrbits) * SIDEREAL_DAY;
        resonanceInfo.targetPeriodSeconds = targetPeriod;
        let computedSemiMajor = computeSemiMajorWithResonance(safeOrbits, safeRotations);
        resonanceInfo.semiMajorKm = computedSemiMajor;
        let resonanceFeasible = true;

        if (computedSemiMajor < MIN_SEMI_MAJOR) {
          resonanceInfo.warnings.push(
            `Resonance ${safeOrbits}:${safeRotations} requires a semi-major axis below the operational minimum (${MIN_SEMI_MAJOR.toFixed(0)} km). ` +
            'Using the lower bound, so the ground track will not repeat exactly.'
          );
          computedSemiMajor = MIN_SEMI_MAJOR;
          resonanceFeasible = false;
        }
        if (computedSemiMajor > MAX_SEMI_MAJOR) {
          resonanceInfo.warnings.push(
            `Resonance ${safeOrbits}:${safeRotations} exceeds the maximum limit (${MAX_SEMI_MAJOR.toFixed(0)} km). ` +
            'Using the upper bound without an exact resonance.'
          );
          computedSemiMajor = MAX_SEMI_MAJOR;
          resonanceFeasible = false;
        }

        const deltaKm = Math.abs(computedSemiMajor - semiMajor);
        resonanceInfo.deltaKm = deltaKm;

        const perigeeTarget = computedSemiMajor * (1 - orbital.eccentricity);
        const apogeeTarget = computedSemiMajor * (1 + orbital.eccentricity);
        const perigeeWarning = 'Perigee drops below the Earth surface. Reduce eccentricity or adjust the resonance.';
        if (perigeeTarget <= EARTH_RADIUS_KM + 10) {
          resonanceInfo.warnings.push(perigeeWarning);
          resonanceFeasible = false;
        }

        const resonanceToleranceKm = 0.5;
        resonanceInfo.applied = resonanceFeasible && deltaKm <= resonanceToleranceKm;
      }

      semiMajor = clamp(semiMajor, MIN_SEMI_MAJOR, MAX_SEMI_MAJOR);
      const perigee = semiMajor * (1 - orbital.eccentricity);
      const apogee = semiMajor * (1 + orbital.eccentricity);
      resonanceInfo.perigeeKm = perigee;
      resonanceInfo.apogeeKm = apogee;
      const perigeeWarning = 'Perigee drops below the Earth surface. Reduce eccentricity or adjust the resonance.';
      if (perigee <= EARTH_RADIUS_KM + 10 && !resonanceInfo.warnings.includes(perigeeWarning)) {
        resonanceInfo.warnings.push(perigeeWarning);
      }

      const meanMotion = Math.sqrt(MU_EARTH / (semiMajor ** 3));
      const orbitPeriod = TWO_PI / meanMotion;
      resonanceInfo.periodSeconds = orbitPeriod;
      const totalOrbits = resonance.enabled ? Math.max(1, resonance.orbits) : 3;
      const totalTime = orbitPeriod * totalOrbits;
      const effectiveSamplesPerOrbit = Number.isFinite(samplesOverride)
        ? Math.max(2, samplesOverride)
        : samplesPerOrbit;
      const totalSamples = Math.max(2, Math.round(effectiveSamplesPerOrbit * totalOrbits));
      const dt = totalTime / (totalSamples - 1);

      const timeline = currentTimeline?.length === totalSamples
        ? currentTimeline
        : Array.from({ length: totalSamples }, (_, idx) => idx * dt);

      let epochDate = null;
      if (settings?.epoch) {
        const parsed = new Date(settings.epoch);
        if (!Number.isNaN(parsed.getTime())) {
          epochDate = parsed;
        }
      }
      if (!epochDate) {
        epochDate = new Date();
      }
      const gmstInitial = gmstFromDate(epochDate);

      // compute secular J2 rates for the (possibly) drifting elements
      const rates = j2.secularRates(semiMajor, orbital.eccentricity, i);
      const dataPoints = timeline.map((t) => {
        // apply secular drift to RAAN and argument of perigee
        const raan_t = raan + (rates.dotOmega || 0) * t;
        const argPerigee_t = argPerigee + (rates.dotArgPerigee || 0) * t;
        const M = (meanAnomaly0 + meanMotion * t) % TWO_PI;
        const { rEci, vEci } = orbitalPositionVelocity(semiMajor, orbital.eccentricity, i, raan_t, argPerigee_t, M);
        const gmst = normalizeAngle(gmstInitial + EARTH_ROT_RATE * t);
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
          gmst,
        };
      });

      const groundTrack = dataPoints.map((p) => ({ lat: p.lat, lon: p.lon }));

      if (dataPoints.length >= 2) {
        const start = dataPoints[0];
        const end = dataPoints[dataPoints.length - 1];
        const diffX = end.rEcef[0] - start.rEcef[0];
        const diffY = end.rEcef[1] - start.rEcef[1];
        const diffZ = end.rEcef[2] - start.rEcef[2];
        const cartesianGap = Math.sqrt(diffX ** 2 + diffY ** 2 + diffZ ** 2);
        resonanceInfo.closureCartesianKm = cartesianGap;
        const surfaceGap = haversineDistance(start.lat, start.lon, end.lat, end.lon, EARTH_RADIUS_KM);
        resonanceInfo.closureSurfaceKm = surfaceGap;
        resonanceInfo.latDriftDeg = end.lat - start.lat;
        const lonDiff = ((end.lon - start.lon + 540) % 360) - 180;
        resonanceInfo.lonDriftDeg = lonDiff;
        if (resonance.enabled && surfaceGap > 0.5) {
      resonanceInfo.warnings.push(`Ground track does not close: surface offset of ${surfaceGap.toFixed(2)} km.`);
          resonanceInfo.applied = false;
        }
        if (resonance.enabled && resonanceInfo.applied) {
          const surfaceOk = Number.isFinite(surfaceGap) && surfaceGap <= CLOSURE_SURFACE_TOL_KM;
          const cartesianOk = Number.isFinite(cartesianGap) && cartesianGap <= CLOSURE_CARTESIAN_TOL_KM;
          resonanceInfo.closed = surfaceOk && cartesianOk;
          if (resonanceInfo.closed) {
            const lastIndex = dataPoints.length - 1;
            if (lastIndex > 0) {
              const startClone = {
                ...dataPoints[0],
                t: dataPoints[lastIndex].t,
                rEci: Array.isArray(dataPoints[0].rEci) ? [...dataPoints[0].rEci] : dataPoints[0].rEci,
                vEci: Array.isArray(dataPoints[0].vEci) ? [...dataPoints[0].vEci] : dataPoints[0].vEci,
                rEcef: Array.isArray(dataPoints[0].rEcef) ? [...dataPoints[0].rEcef] : dataPoints[0].rEcef,
                vEcef: Array.isArray(dataPoints[0].vEcef) ? [...dataPoints[0].vEcef] : dataPoints[0].vEcef,
              };
              dataPoints[lastIndex] = startClone;
              groundTrack[groundTrack.length - 1] = { lat: startClone.lat, lon: startClone.lon };
            }
          }
        }
      }

      return {
        semiMajor,
        orbitPeriod,
        totalTime,
        timeline,
        dataPoints,
        groundTrack,
        resonance: resonanceInfo,
      };
    }

    function computeStationMetrics(dataPoints, station, optical, settings = null, atmosphere = null) {
      const distanceKm = [];
      const elevationDeg = [];
      const lossDb = [];
      const doppler = [];
      const azimuthDeg = [];
      const r0_array = [];
      const fG_array = [];
      const theta0_array = [];
      const wind_array = [];
      const loss_aod_array = [];
      const loss_abs_array = [];

      const r0_zenith = atmosphere?.r0_zenith ?? 0.1;
      const fG_zenith = atmosphere?.fG_zenith ?? 30;
      const theta0_zenith = atmosphere?.theta0_zenith ?? 1.5;
      const wind_rms = atmosphere?.wind_rms ?? 15;
      const loss_aod_db = atmosphere?.loss_aod_db ?? 0;
      const loss_abs_db = atmosphere?.loss_abs_db ?? 0;

      if (!station || !dataPoints?.length) {
        return {
          distanceKm,
          elevationDeg,
          lossDb,
          doppler,
          azimuthDeg,
          r0_array,
          fG_array,
          theta0_array,
          wind_array,
          loss_aod_array,
          loss_abs_array,
        };
      }

      dataPoints.forEach((point) => {
        const los = losElevation(station, point.rEcef);
        const geom = geometricLoss(
          los.distanceKm,
          optical.satAperture,
          optical.groundAperture,
          optical.wavelength,
        );
        const dop = dopplerFactor(station, point.rEcef, point.vEcef, optical.wavelength);

        distanceKm.push(los.distanceKm);
        elevationDeg.push(los.elevationDeg);
        lossDb.push(geom.lossDb);
        doppler.push(dop.factor);
        azimuthDeg.push(los.azimuthDeg);

        let r0_actual = 0;
        let fG_actual = 0;
        let theta0_actual = 0;
        let aod_loss_actual = 0;
        let abs_loss_actual = 0;

        if (los.elevationDeg > 0) {
          const zenith_rad = (90 - los.elevationDeg) * DEG2RAD;
          const cos_zenith = Math.max(Math.cos(zenith_rad), 1e-6);
          const air_mass = 1 / cos_zenith;

          r0_actual = r0_zenith * cos_zenith ** (3 / 5);
          fG_actual = fG_zenith * cos_zenith ** (-9 / 5);
          theta0_actual = theta0_zenith * cos_zenith ** (8 / 5);
          aod_loss_actual = loss_aod_db * air_mass;
          abs_loss_actual = loss_abs_db * air_mass;
        }

        r0_array.push(r0_actual);
        fG_array.push(fG_actual);
        theta0_array.push(theta0_actual);
        wind_array.push(wind_rms);
        loss_aod_array.push(aod_loss_actual);
        loss_abs_array.push(abs_loss_actual);
      });

      return {
        distanceKm,
        elevationDeg,
        lossDb,
        doppler,
        azimuthDeg,
        r0_array,
        fG_array,
        theta0_array,
        wind_array,
        loss_aod_array,
        loss_abs_array,
      };
    }

    function stationEcef(station) {
      return ecefFromLatLon(station.lat, station.lon);
    }

    const constants = {
      MU_EARTH,
      EARTH_RADIUS_KM,
      EARTH_ROT_RATE,
      SIDEREAL_DAY,
      MIN_SEMI_MAJOR,
      MAX_SEMI_MAJOR,
    };

    module.exports = { constants, propagateOrbit, computeStationMetrics, stationEcef };

  });
  define('earthTexture', (exports, module) => {
    const CANVAS_WIDTH = 2048;
    const CANVAS_HEIGHT = 1024;
    const OCEAN_TOP = '#08223c';
    const OCEAN_BOTTOM = '#0c2f57';
    const LAND_MID = '#3ca86e';
    const LAND_SHADOW = '#1e6b44';
    const DESERT_TONE = 'rgba(203, 161, 94, 0.55)';
    const HIGHLAND_TONE = 'rgba(120, 162, 120, 0.4)';
    const ICE_COLOR = 'rgba(224, 244, 255, 0.92)';
    const ICE_EDGE = 'rgba(144, 196, 216, 0.65)';
    const GRID_COLOR = 'rgba(255, 255, 255, 0.06)';
    const NIGHT_OCEAN_TOP = '#01070f';
    const NIGHT_OCEAN_BOTTOM = '#041329';
    const NIGHT_LAND = '#0c1c2a';
    const NIGHT_GLOW = 'rgba(255, 198, 120, 0.85)';
    const NIGHT_GLOW_EDGE = 'rgba(255, 140, 60, 0.0)';

    // Prefer reliable CDN textures first to avoid noisy local 404s when /static/assets is not populated
    const TEXTURE_SOURCES = [
      {
        label: 'cdn-three-globe',
        day: 'https://cdn.jsdelivr.net/npm/three-globe@2.30.0/example/img/earth-blue-marble.jpg',
        night: 'https://cdn.jsdelivr.net/npm/three-globe@2.30.0/example/img/earth-night.jpg',
      },
      {
        label: 'cdn-nasa',
        day: 'https://cdn.jsdelivr.net/gh/astronexus/NasaBlueMarble@main/earth_daymap_2048.jpg',
        night: 'https://cdn.jsdelivr.net/gh/astronexus/NasaBlueMarble@main/earth_night_2048.jpg',
      },
      {
        label: 'local',
        day: '/static/assets/earth_day_4k.jpg',
        night: '/static/assets/earth_night_4k.jpg',
      },
    ];

    const LAND_MASSES = [
      {
        name: 'NorthAmerica',
        coordinates: [
          [-167, 71],
          [-160, 72],
          [-152, 71],
          [-144, 68],
          [-135, 63],
          [-128, 58],
          [-124, 53],
          [-123, 48],
          [-124, 43],
          [-123, 38],
          [-120, 35],
          [-116, 32],
          [-111, 30],
          [-106, 27],
          [-101, 24],
          [-97, 21],
          [-94, 18],
          [-90, 16],
          [-87, 17],
          [-83, 20],
          [-81, 24],
          [-80, 27],
          [-79, 31],
          [-76, 35],
          [-73, 40],
          [-69, 45],
          [-66, 48],
          [-62, 52],
          [-60, 56],
          [-63, 60],
          [-70, 66],
          [-80, 70],
          [-92, 73],
          [-108, 75],
          [-124, 75],
          [-140, 73],
          [-152, 72],
          [-160, 72],
          [-167, 71],
        ],
      },
      {
        name: 'CentralAmerica',
        coordinates: [
          [-90, 17],
          [-86, 15],
          [-84, 11],
          [-83, 9],
          [-81, 8],
          [-79, 9],
          [-78, 11],
          [-79, 14],
          [-82, 17],
          [-86, 19],
          [-90, 17],
        ],
      },
      {
        name: 'SouthAmerica',
        coordinates: [
          [-81, 12],
          [-78, 8],
          [-76, 4],
          [-74, -1],
          [-74, -6],
          [-76, -12],
          [-78, -18],
          [-79, -22],
          [-78, -28],
          [-74, -33],
          [-70, -38],
          [-66, -44],
          [-63, -50],
          [-60, -54],
          [-56, -55],
          [-52, -50],
          [-48, -44],
          [-46, -36],
          [-44, -28],
          [-44, -22],
          [-46, -16],
          [-50, -10],
          [-54, -5],
          [-58, -1],
          [-62, 3],
          [-66, 6],
          [-70, 8],
          [-75, 10],
          [-79, 12],
          [-81, 12],
        ],
      },
      {
        name: 'Eurasia',
        coordinates: [
          [-10, 36],
          [-6, 44],
          [-4, 50],
          [0, 54],
          [6, 60],
          [12, 64],
          [20, 70],
          [28, 73],
          [38, 75],
          [50, 75],
          [60, 73],
          [70, 71],
          [82, 70],
          [94, 71],
          [108, 71],
          [122, 66],
          [132, 60],
          [140, 54],
          [148, 48],
          [154, 44],
          [160, 40],
          [166, 36],
          [168, 32],
          [162, 28],
          [150, 24],
          [140, 20],
          [130, 19],
          [120, 20],
          [110, 23],
          [100, 27],
          [92, 31],
          [86, 35],
          [80, 39],
          [74, 42],
          [68, 47],
          [60, 50],
          [52, 50],
          [46, 46],
          [40, 40],
          [36, 36],
          [32, 32],
          [36, 26],
          [44, 22],
          [52, 20],
          [60, 18],
          [70, 16],
          [78, 12],
          [84, 8],
          [88, 5],
          [92, 8],
          [98, 12],
          [106, 16],
          [114, 18],
          [122, 16],
          [128, 12],
          [132, 6],
          [132, 0],
          [126, -6],
          [118, -10],
          [110, -10],
          [102, -6],
          [96, -2],
          [90, 4],
          [84, 10],
          [78, 14],
          [70, 18],
          [62, 20],
          [54, 22],
          [46, 24],
          [38, 28],
          [32, 32],
          [26, 36],
          [20, 40],
          [14, 42],
          [8, 43],
          [4, 42],
          [0, 40],
          [-4, 38],
          [-8, 36],
          [-10, 36],
        ],
      },
      {
        name: 'Africa',
        coordinates: [
          [-17, 37],
          [-12, 35],
          [-8, 30],
          [-6, 24],
          [-6, 18],
          [-6, 12],
          [-7, 6],
          [-9, 2],
          [-11, -6],
          [-13, -14],
          [-15, -20],
          [-10, -28],
          [-4, -34],
          [4, -38],
          [12, -40],
          [20, -40],
          [28, -34],
          [32, -28],
          [36, -20],
          [40, -10],
          [44, -2],
          [48, 6],
          [51, 12],
          [48, 16],
          [42, 20],
          [36, 24],
          [28, 28],
          [22, 32],
          [16, 35],
          [8, 36],
          [0, 34],
          [-8, 34],
          [-14, 36],
          [-17, 37],
        ],
      },
      {
        name: 'Arabia',
        coordinates: [
          [38, 32],
          [42, 30],
          [46, 26],
          [50, 20],
          [53, 16],
          [55, 12],
          [52, 10],
          [48, 12],
          [44, 14],
          [40, 18],
          [38, 22],
          [36, 26],
          [36, 30],
          [38, 32],
        ],
      },
      {
        name: 'Australia',
        coordinates: [
          [112, -12],
          [114, -18],
          [118, -26],
          [124, -32],
          [132, -35],
          [140, -34],
          [146, -30],
          [152, -26],
          [154, -20],
          [150, -16],
          [146, -12],
          [138, -10],
          [132, -10],
          [124, -8],
          [118, -8],
          [112, -12],
        ],
      },
      {
        name: 'Greenland',
        coordinates: [
          [-52, 60],
          [-54, 64],
          [-56, 68],
          [-52, 72],
          [-46, 75],
          [-38, 78],
          [-28, 79],
          [-20, 78],
          [-18, 74],
          [-24, 70],
          [-32, 66],
          [-40, 62],
          [-48, 60],
          [-52, 60],
        ],
      },
      {
        name: 'Madagascar',
        coordinates: [
          [44, -12],
          [46, -14],
          [48, -18],
          [49, -22],
          [47, -26],
          [44, -24],
          [43, -20],
          [43, -16],
          [44, -12],
        ],
      },
      {
        name: 'Japan',
        coordinates: [
          [129, 33],
          [132, 35],
          [135, 37],
          [138, 39],
          [141, 43],
          [144, 45],
          [146, 44],
          [144, 40],
          [141, 36],
          [138, 34],
          [134, 33],
          [129, 33],
        ],
      },
      {
        name: 'Indonesia',
        coordinates: [
          [95, 5],
          [100, 2],
          [105, 0],
          [110, -2],
          [116, -4],
          [122, -4],
          [128, -2],
          [132, 2],
          [128, 6],
          [122, 8],
          [116, 7],
          [110, 6],
          [104, 6],
          [98, 6],
          [95, 5],
        ],
      },
      {
        name: 'Philippines',
        coordinates: [
          [118, 18],
          [120, 16],
          [122, 12],
          [122, 9],
          [120, 6],
          [118, 7],
          [116, 10],
          [116, 14],
          [118, 18],
        ],
      },
      {
        name: 'UnitedKingdom',
        coordinates: [
          [-8, 49],
          [-6, 52],
          [-5, 56],
          [-3, 58],
          [0, 59],
          [1, 56],
          [-1, 53],
          [-4, 51],
          [-8, 49],
        ],
      },
      {
        name: 'Iceland',
        coordinates: [
          [-24, 63],
          [-22, 65],
          [-18, 66],
          [-14, 65],
          [-16, 63],
          [-20, 62],
          [-24, 63],
        ],
      },
      {
        name: 'NewZealandNorth',
        coordinates: [
          [172, -34],
          [175, -35],
          [178, -38],
          [177, -40],
          [174, -41],
          [171, -39],
          [172, -34],
        ],
      },
      {
        name: 'NewZealandSouth',
        coordinates: [
          [166, -45],
          [168, -46],
          [172, -47],
          [174, -48],
          [172, -50],
          [168, -50],
          [166, -48],
          [166, -45],
        ],
      },
    ];

    const ANTARCTIC_SEGMENTS = [
      {
        coordinates: [
          [-180, -74],
          [-150, -72],
          [-120, -72],
          [-90, -73],
          [-60, -75],
          [-30, -78],
          [0, -80],
        ],
      },
      {
        coordinates: [
          [0, -80],
          [30, -78],
          [60, -76],
          [90, -74],
          [120, -72],
          [150, -73],
          [180, -74],
        ],
      },
    ];

    const DESERT_PATCHES = [
      {
        coordinates: [
          [-14, 30],
          [0, 30],
          [12, 28],
          [20, 26],
          [28, 24],
          [32, 20],
          [28, 16],
          [18, 18],
          [10, 20],
          [0, 22],
          [-8, 24],
          [-14, 30],
        ],
      },
      {
        coordinates: [
          [56, 26],
          [64, 24],
          [70, 22],
          [76, 20],
          [78, 16],
          [72, 14],
          [64, 16],
          [58, 20],
          [56, 24],
          [56, 26],
        ],
      },
      {
        coordinates: [
          [-70, -10],
          [-62, -6],
          [-56, -8],
          [-54, -14],
          [-58, -20],
          [-64, -22],
          [-70, -20],
          [-72, -14],
          [-70, -10],
        ],
      },
    ];

    const HIGHLAND_PATCHES = [
      {
        coordinates: [
          [-80, 50],
          [-72, 48],
          [-66, 48],
          [-62, 52],
          [-66, 56],
          [-74, 56],
          [-80, 50],
        ],
      },
      {
        coordinates: [
          [86, 46],
          [94, 44],
          [100, 42],
          [106, 44],
          [104, 50],
          [96, 52],
          [90, 50],
          [86, 46],
        ],
      },
      {
        coordinates: [
          [12, 40],
          [16, 42],
          [22, 44],
          [26, 46],
          [22, 48],
          [16, 46],
          [12, 42],
          [12, 40],
        ],
      },
    ];

    const CITY_LIGHTS = [
      { name: 'New York', lat: 40.7, lon: -74.0, radius: 20, intensity: 1.0 },
      { name: 'Chicago', lat: 41.8, lon: -87.6, radius: 16, intensity: 0.9 },
      { name: 'Los Angeles', lat: 34.0, lon: -118.2, radius: 18, intensity: 0.9 },
      { name: 'Houston', lat: 29.7, lon: -95.3, radius: 16, intensity: 0.85 },
      { name: 'Mexico City', lat: 19.4, lon: -99.1, radius: 18, intensity: 0.95 },
      { name: 'Sao Paulo', lat: -23.5, lon: -46.6, radius: 22, intensity: 1.0 },
      { name: 'Buenos Aires', lat: -34.6, lon: -58.4, radius: 18, intensity: 0.9 },
      { name: 'Lima', lat: -12.0, lon: -77.0, radius: 14, intensity: 0.75 },
      { name: 'London', lat: 51.5, lon: -0.1, radius: 18, intensity: 1.0 },
      { name: 'Paris', lat: 48.8, lon: 2.3, radius: 16, intensity: 0.95 },
      { name: 'Berlin', lat: 52.5, lon: 13.4, radius: 16, intensity: 0.85 },
      { name: 'Moscow', lat: 55.8, lon: 37.6, radius: 20, intensity: 1.0 },
      { name: 'Madrid', lat: 40.4, lon: -3.7, radius: 15, intensity: 0.8 },
      { name: 'Rome', lat: 41.9, lon: 12.5, radius: 14, intensity: 0.8 },
      { name: 'Cairo', lat: 30.0, lon: 31.2, radius: 18, intensity: 0.9 },
      { name: 'Lagos', lat: 6.5, lon: 3.4, radius: 16, intensity: 0.85 },
      { name: 'Johannesburg', lat: -26.2, lon: 28.0, radius: 16, intensity: 0.8 },
      { name: 'Dubai', lat: 25.2, lon: 55.3, radius: 14, intensity: 0.8 },
      { name: 'Mumbai', lat: 19.0, lon: 72.8, radius: 20, intensity: 1.0 },
      { name: 'Delhi', lat: 28.6, lon: 77.2, radius: 18, intensity: 0.95 },
      { name: 'Bangalore', lat: 12.9, lon: 77.6, radius: 14, intensity: 0.8 },
      { name: 'Beijing', lat: 39.9, lon: 116.4, radius: 20, intensity: 1.0 },
      { name: 'Shanghai', lat: 31.2, lon: 121.5, radius: 22, intensity: 1.0 },
      { name: 'Shenzhen', lat: 22.5, lon: 114.1, radius: 18, intensity: 0.95 },
      { name: 'Hong Kong', lat: 22.3, lon: 114.2, radius: 16, intensity: 0.9 },
      { name: 'Seoul', lat: 37.5, lon: 127.0, radius: 18, intensity: 1.0 },
      { name: 'Tokyo', lat: 35.7, lon: 139.7, radius: 22, intensity: 1.0 },
      { name: 'Osaka', lat: 34.7, lon: 135.5, radius: 18, intensity: 0.9 },
      { name: 'Sydney', lat: -33.9, lon: 151.2, radius: 16, intensity: 0.85 },
      { name: 'Melbourne', lat: -37.8, lon: 144.9, radius: 16, intensity: 0.8 },
      { name: 'Perth', lat: -31.9, lon: 115.9, radius: 14, intensity: 0.75 },
      { name: 'Auckland', lat: -36.8, lon: 174.7, radius: 14, intensity: 0.7 },
    ];

    function createCanvas(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }

    function projectLon(lon, width) {
      return ((lon + 180) / 360) * width;
    }

    function projectLat(lat, height) {
      return ((90 - lat) / 180) * height;
    }

    function tracePolygon(ctx, coordinates, width, height) {
      if (!coordinates?.length) return;
      let prevLon = coordinates[0][0];
      let unwrappedLon = prevLon;
      ctx.moveTo(projectLon(unwrappedLon, width), projectLat(coordinates[0][1], height));
      for (let i = 1; i < coordinates.length; i += 1) {
        const lon = coordinates[i][0];
        const lat = coordinates[i][1];
        let delta = lon - prevLon;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        unwrappedLon += delta;
        prevLon = lon;
        let x = projectLon(unwrappedLon, width);
        if (x < 0) x += width;
        if (x > width) x -= width;
        const y = projectLat(lat, height);
        ctx.lineTo(x, y);
      }
    }

    function drawLand(ctx, width, height) {
      ctx.save();
      ctx.fillStyle = LAND_MID;
      ctx.strokeStyle = LAND_SHADOW;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      LAND_MASSES.forEach((mass) => {
        ctx.beginPath();
        tracePolygon(ctx, mass.coordinates, width, height);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore();
    }

    function overlayPolygons(ctx, width, height, polygons, fillStyle) {
      if (!polygons?.length) return;
      ctx.save();
      ctx.fillStyle = fillStyle;
      polygons.forEach((poly) => {
        ctx.beginPath();
        tracePolygon(ctx, poly.coordinates, width, height);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();
    }

    function drawAntarctica(ctx, width, height) {
      ctx.save();
      ctx.fillStyle = ICE_COLOR;
      ctx.strokeStyle = ICE_EDGE;
      ctx.lineWidth = 1.4;
      ANTARCTIC_SEGMENTS.forEach((segment) => {
        ctx.beginPath();
        tracePolygon(ctx, segment.coordinates, width, height);
        ctx.lineTo(width, projectLat(-85, height));
        ctx.lineTo(0, projectLat(-85, height));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore();
    }

    function drawIceCaps(ctx, width, height) {
      ctx.save();
      const northGradient = ctx.createRadialGradient(width / 2, projectLat(88, height), 120, width / 2, projectLat(88, height), height * 0.35);
      northGradient.addColorStop(0, ICE_COLOR);
      northGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = northGradient;
      ctx.beginPath();
      ctx.arc(width / 2, projectLat(90, height), height * 0.36, 0, Math.PI * 2);
      ctx.fill();

      const southGradient = ctx.createRadialGradient(width / 2, projectLat(-90, height), 120, width / 2, projectLat(-90, height), height * 0.42);
      southGradient.addColorStop(0, 'rgba(240, 250, 255, 0.95)');
      southGradient.addColorStop(1, 'rgba(240, 250, 255, 0)');
      ctx.fillStyle = southGradient;
      ctx.beginPath();
      ctx.arc(width / 2, projectLat(-90, height), height * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawGraticule(ctx, width, height) {
      ctx.save();
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 0.6;
      for (let lon = -150; lon <= 180; lon += 30) {
        const x = projectLon(lon, width);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const y = projectLat(lat, height);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    function addCoastalHighlight(ctx, width, height) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 0.6;
      LAND_MASSES.forEach((mass) => {
        ctx.beginPath();
        tracePolygon(ctx, mass.coordinates, width, height);
        ctx.closePath();
        ctx.stroke();
      });
      ctx.restore();
    }

    function addOceanGradient(ctx, width, height) {
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, OCEAN_TOP);
      gradient.addColorStop(1, OCEAN_BOTTOM);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    function addNightOcean(ctx, width, height) {
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, NIGHT_OCEAN_TOP);
      gradient.addColorStop(1, NIGHT_OCEAN_BOTTOM);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    }

    function addCityLights(ctx, width, height) {
      ctx.save();
      CITY_LIGHTS.forEach((city) => {
        const x = projectLon(city.lon, width);
        const y = projectLat(city.lat, height);
        const radius = city.radius * (width / CANVAS_WIDTH);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, NIGHT_GLOW);
        gradient.addColorStop(0.45, 'rgba(255, 176, 90, 0.45)');
        gradient.addColorStop(1, NIGHT_GLOW_EDGE);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }

    function addDiffuseGlow(ctx, width, height) {
      ctx.save();
      const glow = ctx.createRadialGradient(width * 0.3, projectLat(25, height), 0, width * 0.3, projectLat(25, height), width * 0.6);
      glow.addColorStop(0, 'rgba(255, 220, 180, 0.12)');
      glow.addColorStop(1, 'rgba(255, 220, 180, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    function createDayCanvas() {
      const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
      const ctx = canvas.getContext('2d');
      addOceanGradient(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);
      drawGraticule(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);
      drawLand(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);
      overlayPolygons(ctx, CANVAS_WIDTH, CANVAS_HEIGHT, DESERT_PATCHES, DESERT_TONE);
      overlayPolygons(ctx, CANVAS_WIDTH, CANVAS_HEIGHT, HIGHLAND_PATCHES, HIGHLAND_TONE);
      drawAntarctica(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);
      drawIceCaps(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);
      addCoastalHighlight(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);
      return canvas;
    }

    function createNightCanvas() {
      const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
      const ctx = canvas.getContext('2d');
      addNightOcean(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.save();
      ctx.fillStyle = NIGHT_LAND;
      LAND_MASSES.forEach((mass) => {
        ctx.beginPath();
        tracePolygon(ctx, mass.coordinates, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.closePath();
        ctx.fill();
      });
      ctx.beginPath();
      tracePolygon(ctx, ANTARCTIC_SEGMENTS[0].coordinates, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.lineTo(CANVAS_WIDTH, projectLat(-85, CANVAS_HEIGHT));
      ctx.lineTo(0, projectLat(-85, CANVAS_HEIGHT));
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      tracePolygon(ctx, ANTARCTIC_SEGMENTS[1].coordinates, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.lineTo(CANVAS_WIDTH, projectLat(-85, CANVAS_HEIGHT));
      ctx.lineTo(0, projectLat(-85, CANVAS_HEIGHT));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      addCityLights(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);
      addDiffuseGlow(ctx, CANVAS_WIDTH, CANVAS_HEIGHT);
      return canvas;
    }

    let cachedTextures = null;
    let cachedPromise = null;

    function buildCanvasTextures(THREE) {
      const dayCanvas = createDayCanvas();
      const nightCanvas = createNightCanvas();
      const dayTexture = new THREE.CanvasTexture(dayCanvas);
      const nightTexture = new THREE.CanvasTexture(nightCanvas);
      [dayTexture, nightTexture].forEach((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
      });
      return { day: dayTexture, night: nightTexture, source: 'procedural' };
    }

    async function loadTexturePair(THREE, source) {
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('');
      const [day, night] = await Promise.all([
        loader.loadAsync(source.day),
        loader.loadAsync(source.night),
      ]);
      [day, night].forEach((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
      });
      return { day, night, source: source.label };
    }

    async function loadEarthTexturesInternal(THREE) {
      for (const source of TEXTURE_SOURCES) {
        try {
          const textures = await loadTexturePair(THREE, source);
          return textures;
        } catch (error) {
          console.warn(`Fallo al cargar texturas ${source.label}`, error);
        }
      }
      console.warn('No se pudieron cargar texturas reales, usando versión procedimental.');
      return buildCanvasTextures(THREE);
    }

    async function createEarthTextures(THREE) {
      if (cachedTextures) {
        return cachedTextures;
      }
      if (!cachedPromise) {
        cachedPromise = loadEarthTexturesInternal(THREE)
          .then((textures) => {
            cachedTextures = textures;
            cachedPromise = null;
            return textures;
          })
          .catch((error) => {
            cachedPromise = null;
            throw error;
          });
      }
      return cachedPromise;
    }

    function disposeEarthTextures() {
      if (cachedTextures) {
        cachedTextures.day?.dispose?.();
        cachedTextures.night?.dispose?.();
      }
      cachedTextures = null;
      cachedPromise = null;
    }

    module.exports = { createEarthTextures, disposeEarthTextures };

  });
  define('resonanceSolver', (exports, module) => {
    const MU = 398600.4418; // km^3/s^2
    const TWO_PI = Math.PI * 2;
    const SIDEREAL_DAY = 86164.09; // s
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
    function searchResonances({
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

    module.exports = { SIDEREAL_DAY, searchResonances };

  });
  define('map2d', (exports, module) => {
    const { clamp, formatDistanceKm } = require('utils');

    let map;
    let orbitLayer;
    let satelliteMarker;
    let footprintLayer;
    let linkLayer;
    const stationMarkers = new Map();
  const constellationLayers = new Map();
  const constellationMarkers = new Map();
    let baseLayers;
    let currentBase = 'standard';
    const ORBIT_FIT_PADDING = [48, 48];
    let stationPickerHandler = null;
    let stationPickerMarker = null;
    let weatherLayer = null;
    let weatherLegend = null;

    const TILE_STANDARD = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    const TILE_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

    const WEATHER_COLOR_STOPS = [
      { stop: 0.0, r: 44, g: 123, b: 182 },
      { stop: 0.25, r: 171, g: 217, b: 233 },
      { stop: 0.5, r: 255, g: 255, b: 191 },
      { stop: 0.75, r: 253, g: 174, b: 97 },
      { stop: 1.0, r: 215, g: 25, b: 28 },
    ];

    const WEATHER_GRADIENT_CSS = WEATHER_COLOR_STOPS.map((stop) => {
      const hex = `#${stop.r.toString(16).padStart(2, '0')}${stop.g.toString(16).padStart(2, '0')}${stop.b
        .toString(16)
        .padStart(2, '0')}`;
      return `${hex} ${(stop.stop * 100).toFixed(0)}%`;
    }).join(', ');

    function interpolateWeatherColor(t) {
      const value = clamp(t, 0, 1);
      let left = WEATHER_COLOR_STOPS[0];
      let right = WEATHER_COLOR_STOPS[WEATHER_COLOR_STOPS.length - 1];
      for (let idx = 1; idx < WEATHER_COLOR_STOPS.length; idx += 1) {
        const candidate = WEATHER_COLOR_STOPS[idx];
        if (value <= candidate.stop) {
          right = candidate;
          left = WEATHER_COLOR_STOPS[idx - 1];
          break;
        }
      }
      const span = Math.max(1e-6, right.stop - left.stop);
      const localT = (value - left.stop) / span;
      const r = Math.round(left.r + (right.r - left.r) * localT);
      const g = Math.round(left.g + (right.g - left.g) * localT);
      const b = Math.round(left.b + (right.b - left.b) * localT);
      return `rgba(${r}, ${g}, ${b}, 0.78)`;
    }

    function computeEdges(samples) {
      if (!Array.isArray(samples) || samples.length === 0) return [];
      if (samples.length === 1) {
        const value = samples[0];
        return [value - 1, value + 1];
      }
      const edges = [];
      for (let idx = 0; idx < samples.length - 1; idx += 1) {
        const current = samples[idx];
        const next = samples[idx + 1];
        edges.push((current + next) / 2);
      }
      const firstGap = samples[1] - samples[0];
      const lastGap = samples[samples.length - 1] - samples[samples.length - 2];
      edges.unshift(samples[0] - firstGap / 2);
      edges.push(samples[samples.length - 1] + lastGap / 2);
      return edges;
    }

    function ensureWeatherLayer() {
      if (!map) return null;
      if (!weatherLayer) {
        weatherLayer = L.layerGroup();
      }
      if (!map.hasLayer(weatherLayer)) {
        weatherLayer.addTo(map);
      }
      return weatherLayer;
    }

    function initMap(container) {
      if (!container) return null;
      map = L.map(container, {
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        minZoom: 0,
        maxZoom: 12,
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

      map.fitWorld({ animate: false, maxZoom: 2 });
      setTimeout(() => map.invalidateSize(), 150);
      return map;
    }

    function setBaseLayer(mode) {
      if (!map || !baseLayers || !baseLayers[mode]) return;
      if (currentBase === mode) return;
      baseLayers[currentBase]?.removeFrom(map);
      baseLayers[mode].addTo(map);
      currentBase = mode;
      map.invalidateSize();
    }

    function toggleBaseLayer() {
      const next = currentBase === 'standard' ? 'satellite' : 'standard';
      setBaseLayer(next);
      return next;
    }

    function invalidateSize() {
      if (!map) return;
      map.invalidateSize();
    }

    function updateGroundTrack(points) {
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

    function updateSatellitePosition(point, footprintKm = 0) {
      if (!satelliteMarker || !footprintLayer) return;
      satelliteMarker.setLatLng([point.lat, point.lon]);
      footprintLayer.setLatLng([point.lat, point.lon]);
      footprintLayer.setRadius(footprintKm * 1000);
    }

    function updateLinkLine(satPoint, station) {
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

    function renderStations(stations, selectedId) {
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

    function focusOnStation(station) {
      if (!map || !station) return;
      map.flyTo([station.lat, station.lon], Math.max(map.getZoom(), 5), {
        duration: 1.5,
      });
    }

    function flyToOrbit(points, options = {}) {
      if (!map) return;
      const {
        animate = true,
        padding = ORBIT_FIT_PADDING,
        maxZoom = 7,
      } = options;

      const resolvedPadding = Array.isArray(padding) && padding.length === 2
        ? padding
        : ORBIT_FIT_PADDING;

      const fallback = () => {
        map.fitWorld({
          animate,
          maxZoom: Math.min(maxZoom, typeof map.getMaxZoom === 'function' ? map.getMaxZoom() : maxZoom),
        });
      };

      if (!Array.isArray(points) || points.length === 0) {
        fallback();
        return;
      }

      const latLngs = points
        .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon))
        .map((p) => L.latLng(p.lat, p.lon));

      if (!latLngs.length) {
        fallback();
        return;
      }

      const bounds = L.latLngBounds(latLngs);
      if (!bounds.isValid()) {
        fallback();
        return;
      }

      const zoomCap = Math.min(maxZoom, typeof map.getMaxZoom === 'function' ? map.getMaxZoom() : maxZoom);
      map.flyToBounds(bounds, {
        padding: resolvedPadding,
        maxZoom: zoomCap,
        animate,
        duration: animate ? 1.2 : 0,
      });
    }

    function updateFootprint(distanceKm) {
      if (!footprintLayer) return;
      footprintLayer.setRadius(distanceKm * 1000);
    }

    function annotateStationTooltip(station, metrics) {
      if (!stationMarkers.has(station.id)) return;
      const marker = stationMarkers.get(station.id);
      marker.bindTooltip(
        `${station.name}<br>${station.lat.toFixed(2)}°, ${station.lon.toFixed(2)}°<br>${formatDistanceKm(metrics.distanceKm)}`,
        { sticky: true },
      );
    }

    function ensureStationPickerMarker() {
      if (!map) return null;
      if (!stationPickerMarker) {
        stationPickerMarker = L.marker([0, 0], {
          draggable: false,
          keyboard: false,
          interactive: false,
          zIndexOffset: 1000,
          icon: L.divIcon({
            className: 'station-picker-marker',
            html: '<div class="station-picker-marker-dot"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
        });
      }
      if (!map.hasLayer(stationPickerMarker)) {
        stationPickerMarker.addTo(map);
      }
      return stationPickerMarker;
    }

    function removeStationPickerMarker() {
      if (stationPickerMarker && map && map.hasLayer(stationPickerMarker)) {
        map.removeLayer(stationPickerMarker);
      }
      stationPickerMarker = null;
    }

    function buildWeatherLegend(variable) {
      if (!map) return null;
      const legendControl = L.control({ position: 'bottomleft' });
      legendControl.onAdd = () => {
        const container = L.DomUtil.create('div', 'weather-legend');
        const title = L.DomUtil.create('div', 'weather-legend__title', container);
        title.textContent = `${variable?.label ?? 'Field'} (${variable?.units ?? ''})`;
        const gradient = L.DomUtil.create('div', 'weather-legend__gradient', container);
        gradient.style.background = `linear-gradient(90deg, ${WEATHER_GRADIENT_CSS})`;
        const scale = L.DomUtil.create('div', 'weather-legend__scale', container);
        scale.innerHTML = `
          <span>${variable?.minLabel ?? 'min'}</span>
          <span>${variable?.maxLabel ?? 'max'}</span>
        `;
        return container;
      };
      return legendControl;
    }

    function clearWeatherField() {
      if (weatherLayer && map) {
        weatherLayer.clearLayers();
        map.removeLayer(weatherLayer);
      }
      weatherLayer = null;
      if (weatherLegend) {
        weatherLegend.remove();
        weatherLegend = null;
      }
    }

    function renderWeatherField(fieldPayload) {
      if (!map || !fieldPayload || !fieldPayload.grid) {
        clearWeatherField();
        return;
      }

      const layerGroup = ensureWeatherLayer();
      if (!layerGroup) return;
      layerGroup.clearLayers();

      if (weatherLegend) {
        weatherLegend.remove();
        weatherLegend = null;
      }

      const { grid, variable } = fieldPayload;
      const { latitudes, longitudes, values, min, max } = grid;
      if (!Array.isArray(latitudes) || !Array.isArray(longitudes) || !Array.isArray(values)) {
        clearWeatherField();
        return;
      }

      const minValue = Number(min);
      const maxValue = Number(max);
      const latEdges = computeEdges(latitudes);
      const lonEdges = computeEdges(longitudes);

      // Render each lat/lon cell as a filled rectangle to approximate a smooth colour field.
      for (let row = 0; row < values.length; row += 1) {
        const rowValues = values[row];
        if (!Array.isArray(rowValues)) continue;
        for (let col = 0; col < rowValues.length; col += 1) {
          const cellValue = rowValues[col];
          const bounds = [
            [latEdges[row], lonEdges[col]],
            [latEdges[row + 1], lonEdges[col + 1]],
          ];
          if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || !Number.isFinite(cellValue)) {
            const emptyRect = L.rectangle(bounds, {
              weight: 0,
              fillOpacity: 0,
              interactive: false,
            });
            layerGroup.addLayer(emptyRect);
            continue;
          }
          const normalized = minValue === maxValue ? 0.5 : (cellValue - minValue) / (maxValue - minValue);
          const color = interpolateWeatherColor(normalized);
          const rect = L.rectangle(bounds, {
            weight: 0,
            fillColor: color,
            fillOpacity: 0.72,
            interactive: false,
          });
          layerGroup.addLayer(rect);
        }
      }

      weatherLegend = buildWeatherLegend({
        label: variable?.label,
        units: variable?.units,
        minLabel: Number.isFinite(minValue) ? minValue.toFixed(1) : 'min',
        maxLabel: Number.isFinite(maxValue) ? maxValue.toFixed(1) : 'max',
      });
      if (weatherLegend) {
        weatherLegend.addTo(map);
      }
    }

    function startStationPicker(onPick, initialPosition) {
      if (!map || typeof onPick !== 'function') return () => {};

      stopStationPicker();

      const container = map.getContainer();
      container.classList.add('station-pick-mode');

      if (initialPosition && Number.isFinite(initialPosition.lat) && Number.isFinite(initialPosition.lon)) {
        const marker = ensureStationPickerMarker();
        if (marker) marker.setLatLng([initialPosition.lat, initialPosition.lon]);
      }

      stationPickerHandler = (event) => {
        const { lat, lng } = event.latlng;
        const marker = ensureStationPickerMarker();
        if (marker) marker.setLatLng([lat, lng]);
        onPick({ lat, lon: lng });
      };

      map.on('click', stationPickerHandler);

      return () => stopStationPicker();
    }

    function stopStationPicker() {
      if (!map) return;
      const container = map.getContainer();
      container.classList.remove('station-pick-mode');
      if (stationPickerHandler) {
        map.off('click', stationPickerHandler);
        stationPickerHandler = null;
      }
      removeStationPickerMarker();
    }

    function ensureConstellationLayer(groupId) {
      if (!map) return null;
      let layer = constellationLayers.get(groupId);
      if (!layer) {
        layer = L.layerGroup();
        constellationLayers.set(groupId, layer);
      }
      if (!map.hasLayer(layer)) {
        layer.addTo(map);
      }
      return layer;
    }

    function renderConstellations(groupId, satellites, options = {}) {
      if (!map) return;
      if (!Array.isArray(satellites) || satellites.length === 0) {
        clearConstellationGroup(groupId);
        return;
      }
      const layer = ensureConstellationLayer(groupId);
      if (!layer) return;
      const color = options.color || '#38bdf8';
      let markerMap = constellationMarkers.get(groupId);
      if (!markerMap) {
        markerMap = new Map();
        constellationMarkers.set(groupId, markerMap);
      }
      const seen = new Set();
      satellites.forEach((satellite, idx) => {
        if (!Number.isFinite(satellite?.lat) || !Number.isFinite(satellite?.lon)) return;
        const key = satellite.id || satellite.name || `${groupId}-${idx}`;
        seen.add(key);
        let marker = markerMap.get(key);
        if (!marker) {
          marker = L.circleMarker([satellite.lat, satellite.lon], {
            radius: 3.2,
            weight: 1,
            color,
            opacity: 0.85,
            fillColor: color,
            fillOpacity: 0.85,
          });
          if (satellite?.name) {
            marker.bindTooltip(satellite.name, { sticky: false });
          }
          marker.addTo(layer);
          markerMap.set(key, marker);
        } else {
          marker.setLatLng([satellite.lat, satellite.lon]);
        }
        marker.setStyle({ color, fillColor: color });
      });
      markerMap.forEach((marker, key) => {
        if (!seen.has(key)) {
          layer.removeLayer(marker);
          markerMap.delete(key);
        }
      });
    }

    function clearConstellationGroup(groupId) {
      const layer = constellationLayers.get(groupId);
      if (layer && map) {
        layer.clearLayers();
        map.removeLayer(layer);
      }
      constellationLayers.delete(groupId);
      constellationMarkers.delete(groupId);
    }

    module.exports = {
      initMap,
      setBaseLayer,
      toggleBaseLayer,
      invalidateSize,
      updateGroundTrack,
      updateSatellitePosition,
      updateLinkLine,
      renderStations,
      focusOnStation,
      flyToOrbit,
      updateFootprint,
      annotateStationTooltip,
      clearWeatherField,
      renderWeatherField,
      startStationPicker,
      stopStationPicker,
      renderConstellations,
      clearConstellationGroup,
    };

  });
  define('scene3d', (exports, module) => {
    const { constants: orbitConstants, stationEcef } = require('orbit');
    const { createEarthTextures, disposeEarthTextures } = require('earthTexture');

    const { EARTH_RADIUS_KM, EARTH_ROT_RATE } = orbitConstants;
    const UNIT_SCALE = 1 / EARTH_RADIUS_KM;
    const EARTH_BASE_ROTATION = 0;
    const GROUND_TRACK_ALTITUDE_KM = 0.05;

    const EARTH_VERTEX_SHADER = `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `;

    const EARTH_FRAGMENT_SHADER = `
      uniform sampler2D dayMap;
      uniform sampler2D nightMap;
      uniform vec3 sunDirection;
      uniform float ambientStrength;
      uniform float nightStrength;
      varying vec2 vUv;
      varying vec3 vNormal;

      vec3 toneMap(vec3 color) {
        return color / (color + vec3(1.0));
      }

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 lightDir = normalize(sunDirection);
        float diffuse = max(dot(normal, lightDir), 0.0);
        vec2 sampleUv = vUv;
        vec3 dayColor = texture2D(dayMap, sampleUv).rgb;
        vec3 nightColor = texture2D(nightMap, sampleUv).rgb;

        float dayMix = smoothstep(-0.2, 0.45, diffuse);
        vec3 lit = dayColor * (ambientStrength + diffuse);
        vec3 night = nightColor * nightStrength * (1.0 - dayMix);
        vec3 color = mix(night, lit, dayMix);

        float rim = pow(1.0 - max(dot(normal, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
        color += vec3(rim) * 0.04;

        gl_FragColor = vec4(toneMap(color), 1.0);
      }
    `;

    let THREE;
    let OrbitControls;
    let importPromise;

    let containerEl;
    let canvasEl;
    let fallbackEl;
    let renderer;
    let scene;
    let camera;
    let controls;
    let resizeObserver;
    let animationHandle;
    let earthGroup;
    let earthMesh;
    let atmosphereMesh;
    let orbitLine;
    let satelliteMesh;
    let stationGroup;
    let linkLine;
    let groundTrackLine;
    let groundTrackVectorLine;
    let isReady = false;
    let earthSimulationRotation = 0;
    let passiveAtmosphereOffset = 0;
    let earthUniforms;
    let earthTextures;
    let sunLight;
    let hasUserMovedCamera = false;
    let lastFramedRadius = null;

    const stationMeshes = new Map();
  const constellationPoints = new Map();

    async function ensureThree() {
      if (!importPromise) {
        importPromise = Promise.all([
          import('three'),
          import('three/addons/controls/OrbitControls.js'),
        ]).then(([threeModule, controlsModule]) => {
          THREE = threeModule.default ?? threeModule;
          OrbitControls =
            controlsModule.OrbitControls ?? controlsModule.default ?? controlsModule;
          if (typeof OrbitControls !== 'function') {
            throw new Error('OrbitControls is not available.');
          }
        });
      }
      return importPromise;
    }

    function hideFallback() {
      if (fallbackEl) {
        fallbackEl.hidden = true;
        fallbackEl.setAttribute('aria-hidden', 'true');
      }
      if (canvasEl) {
        canvasEl.classList.remove('is-hidden');
        canvasEl.removeAttribute('aria-hidden');
      }
    }

    function showFallback(message) {
      if (fallbackEl) {
        fallbackEl.textContent = message || '3D scene could not be initialized.';
        fallbackEl.hidden = false;
        fallbackEl.setAttribute('aria-hidden', 'false');
      }
      if (canvasEl) {
        canvasEl.classList.add('is-hidden');
        canvasEl.setAttribute('aria-hidden', 'true');
      }
    }

    function resizeRenderer() {
      if (!renderer || !containerEl) return;
      const width = Math.max(containerEl.clientWidth, 1);
      const height = Math.max(containerEl.clientHeight, 1);
      renderer.setSize(width, height, false);
      if (camera) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    }

    function buildRenderer() {
      renderer = new THREE.WebGLRenderer({
        canvas: canvasEl,
        antialias: true,
        alpha: true,
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      resizeRenderer();
      canvasEl.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        cancelAnimation();
        showFallback('The WebGL context was lost. Reload to try again.');
        isReady = false;
      });
    }

    function buildCamera() {
      const width = Math.max(containerEl.clientWidth, 1);
      const height = Math.max(containerEl.clientHeight, 1);
      camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 80);
      camera.position.set(0.4, 3, 4.8);
    }

    function buildControls() {
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;
      controls.minDistance = 0.6;
      controls.maxDistance = 200;
      controls.rotateSpeed = 0.6;
      controls.zoomSpeed = 0.9;
      controls.target.set(0, 0, 0);
      controls.update();
      controls.addEventListener('start', () => {
        hasUserMovedCamera = true;
      });
    }

    function buildLights() {
      // richer multi-source lighting for better visual depth
      const ambient = new THREE.AmbientLight(0xffffff, 0.45);
      // warm main sun light
      sunLight = new THREE.DirectionalLight(0xfff2e6, 1.1);
      sunLight.position.set(4, 6, 10);
      sunLight.castShadow = false;
      // cool rim light for highlight
      const rim = new THREE.DirectionalLight(0x5eead4, 0.25);
      rim.position.set(-3, -2, -5);
      // soft hemisphere for subtle sky/ground tint
      const hemi = new THREE.HemisphereLight(0x87bfff, 0x0b1020, 0.18);
      scene.add(ambient, sunLight, rim, hemi);
    }

    // Turn panel headers into accordions (collapsible sections)
    function createPanelAccordions() {
      try {
        const panels = document.querySelectorAll('.panel-section');
        panels.forEach((panel) => {
          const hdr = panel.querySelector('header');
          if (!hdr) return;
          hdr.style.cursor = 'pointer';
          // add chevron
          let chev = hdr.querySelector('.accordion-chevron');
          if (!chev) {
            chev = document.createElement('span');
            chev.className = 'accordion-chevron';
            chev.textContent = '▾';
            chev.style.marginLeft = '8px';
            chev.style.opacity = '0.7';
            hdr.appendChild(chev);
          }
          // start expanded by default; collapse when clicked
          hdr.addEventListener('click', (ev) => {
            // ignore clicks on info buttons
            if (ev.target && ev.target.classList && ev.target.classList.contains('info-button')) return;
            panel.classList.toggle('collapsed');
            const collapsed = panel.classList.contains('collapsed');
            chev.textContent = collapsed ? '▸' : '▾';
            const contentChildren = Array.from(panel.children).filter((c) => c !== hdr);
            contentChildren.forEach((el) => { el.style.display = collapsed ? 'none' : ''; });
          });
        });
      } catch (e) { console.warn('Could not initialize panel accordions', e); }
    }

    async function buildEarth() {
      earthGroup = new THREE.Group();
      earthGroup.name = 'EarthGroup';

      const earthGeometry = new THREE.SphereGeometry(1, 128, 128);
      try {
        earthTextures = await createEarthTextures(THREE);
        if (earthTextures?.source) {
          console.info(`Texturas de la Tierra cargadas (${earthTextures.source}).`);
        }
      } catch (error) {
        console.error('No se pudieron cargar las texturas de la Tierra', error);
        throw new Error('No se pudieron cargar las texturas de la Tierra.');
      }
      const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
      if (earthTextures?.day) {
        earthTextures.day.anisotropy = Math.min(maxAniso, 12);
        earthTextures.day.needsUpdate = true;
      }
      if (earthTextures?.night) {
        earthTextures.night.anisotropy = Math.min(maxAniso, 12);
        earthTextures.night.needsUpdate = true;
      }
      earthUniforms = {
        dayMap: { value: earthTextures?.day ?? null },
        nightMap: { value: earthTextures?.night ?? null },
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        ambientStrength: { value: 0.35 },
        nightStrength: { value: 0.88 },
      };
      const earthMaterial = new THREE.ShaderMaterial({
        uniforms: earthUniforms,
        vertexShader: EARTH_VERTEX_SHADER,
        fragmentShader: EARTH_FRAGMENT_SHADER,
      });
      earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
      earthMesh.name = 'Earth';
      earthGroup.add(earthMesh);

      const atmosphereGeometry = new THREE.SphereGeometry(1.02, 96, 96);
      const atmosphereMaterial = new THREE.MeshBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.16,
        side: THREE.BackSide,
      });
      atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
      atmosphereMesh.name = 'Atmosphere';
      earthGroup.add(atmosphereMesh);

      scene.add(earthGroup);
      updateSunDirection();
    }

    function buildSceneGraph() {
      orbitLine = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0x7c3aed, linewidth: 2 })
      );
      orbitLine.visible = false;

      linkLine = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineDashedMaterial({
          color: 0x38bdf8,
          dashSize: 0.05,
          gapSize: 0.03,
        })
      );
      linkLine.visible = false;

      groundTrackLine = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 1.2 })
      );
      groundTrackLine.visible = false;
      earthGroup.add(groundTrackLine);

      groundTrackVectorLine = new THREE.Line(
        new THREE.BufferGeometry(),
        new THREE.LineDashedMaterial({
          color: 0x14b8a6,
          dashSize: 0.045,
          gapSize: 0.03,
        })
      );
      groundTrackVectorLine.visible = false;
      scene.add(groundTrackVectorLine);

      const satMaterial = new THREE.MeshStandardMaterial({
        color: 0xf97316,
        emissive: 0x9a3412,
        metalness: 0.2,
        roughness: 0.4,
      });
      satelliteMesh = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 20), satMaterial);
      satelliteMesh.visible = false;

      stationGroup = new THREE.Group();
      stationGroup.name = 'StationGroup';
      earthGroup.add(stationGroup);

      scene.add(orbitLine, linkLine, satelliteMesh);
    }

    function startAnimation() {
      cancelAnimation();
      passiveAtmosphereOffset = 0;
      const renderFrame = () => {
        if (earthGroup) {
          earthGroup.rotation.y = earthSimulationRotation + EARTH_BASE_ROTATION;
        }
        if (atmosphereMesh) {
          passiveAtmosphereOffset = (passiveAtmosphereOffset + 0.003) % (Math.PI * 2);
          atmosphereMesh.rotation.y = earthSimulationRotation + passiveAtmosphereOffset + EARTH_BASE_ROTATION;
        }
        controls?.update();
        renderer.render(scene, camera);
        animationHandle = window.requestAnimationFrame(renderFrame);
      };
      animationHandle = window.requestAnimationFrame(renderFrame);
    }

    function cancelAnimation() {
      if (animationHandle) {
        window.cancelAnimationFrame(animationHandle);
        animationHandle = null;
      }
    }

    function ensureStationMesh(station) {
      if (!stationMeshes.has(station.id)) {
        const material = new THREE.MeshStandardMaterial({
          color: 0x0ea5e9,
          emissive: 0x082f49,
          metalness: 0.1,
          roughness: 0.8,
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.025, 14, 14), material);
        mesh.name = `station-${station.id}`;
        stationGroup.add(mesh);
        stationMeshes.set(station.id, mesh);
      }
      return stationMeshes.get(station.id);
    }

    function clearStations(keepIds) {
      Array.from(stationMeshes.keys()).forEach((id) => {
        if (!keepIds.has(id)) {
          const mesh = stationMeshes.get(id);
          stationGroup.remove(mesh);
          mesh.geometry.dispose();
          mesh.material.dispose();
          stationMeshes.delete(id);
        }
      });
    }

    function toVector3(arr) {
      if (!THREE || !Array.isArray(arr)) return null;
      const [x, y, z] = arr;
      return new THREE.Vector3(x * UNIT_SCALE, z * UNIT_SCALE, -y * UNIT_SCALE);
    }

    function toVector3Eci(arr) {
      return toVector3(arr);
    }

    function updateEarthRotation() {
      if (earthGroup) {
        earthGroup.rotation.y = earthSimulationRotation + EARTH_BASE_ROTATION;
      }
      if (atmosphereMesh) {
        atmosphereMesh.rotation.y = earthSimulationRotation + passiveAtmosphereOffset + EARTH_BASE_ROTATION;
      }
    }

    function setEarthRotationFromTime(gmstAngle) {
      if (!Number.isFinite(gmstAngle)) return;
      earthSimulationRotation = gmstAngle;
      updateEarthRotation();
    }

    function vectorFromLatLon(latDeg, lonDeg, altitudeKm = GROUND_TRACK_ALTITUDE_KM) {
      if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return null;
      const ecef = stationEcef({ lat: latDeg, lon: lonDeg }) || [];
      const vec = toVector3(ecef);
      if (!vec) return null;
      const safeAltitude = Number.isFinite(altitudeKm) ? altitudeKm : GROUND_TRACK_ALTITUDE_KM;
      const scale = (EARTH_RADIUS_KM + safeAltitude) / EARTH_RADIUS_KM;
      vec.multiplyScalar(scale);
      return vec;
    }

    function computeFramingRadius(points) {
      if (!Array.isArray(points)) return 0;
      let maxRadius = 0;
      points.forEach((point) => {
        const vec = toVector3Eci(point?.rEci);
        if (!vec) return;
        const length = vec.length();
        if (Number.isFinite(length)) {
          maxRadius = Math.max(maxRadius, length);
        }
      });
      return maxRadius;
    }

    function frameOrbitView(points, { force = false } = {}) {
      if (!isReady || !camera || !controls) return;
      const radius = computeFramingRadius(points);
      if (!Number.isFinite(radius) || radius <= 0) return;

      const safeRadius = Math.max(radius, 1.05);
      controls.maxDistance = Math.max(controls.maxDistance, safeRadius * 4.0);
      controls.minDistance = Math.min(controls.minDistance, 0.5);
      camera.far = Math.max(camera.far, safeRadius * 4.0);
      camera.updateProjectionMatrix();

      const radiusChangedSignificantly = !lastFramedRadius || safeRadius > lastFramedRadius * 1.3;
      const shouldReframe = force || !hasUserMovedCamera || radiusChangedSignificantly;
      lastFramedRadius = safeRadius;

      if (!shouldReframe) return;

      const distance = Math.max(safeRadius * 2.4, 2.6);
      const altitude = distance * 0.62;
      const lateral = distance * 0.45;

      camera.position.set(lateral, altitude, distance);
      controls.target.set(0, 0, 0);
      controls.update();
    }

    function updateGroundTrackSurface(points) {
      if (!isReady || !groundTrackLine) return;
      if (!Array.isArray(points) || points.length === 0) {
        groundTrackLine.visible = false;
        groundTrackLine.geometry.dispose();
        groundTrackLine.geometry = new THREE.BufferGeometry();
        return;
      }
      const vectors = points
        .map((point) => vectorFromLatLon(point?.lat, point?.lon))
        .filter((vec) => vec instanceof THREE.Vector3);
      if (!vectors.length) {
        groundTrackLine.visible = false;
        return;
      }
      groundTrackLine.geometry.dispose();
      groundTrackLine.geometry = new THREE.BufferGeometry().setFromPoints(vectors);
      groundTrackLine.visible = true;
    }

    function updateGroundTrackVector(point) {
      if (!isReady || !groundTrackVectorLine || !satelliteMesh) return;
      if (!point || !Array.isArray(point.rEci)) {
        groundTrackVectorLine.visible = false;
        return;
      }

      satelliteMesh.updateMatrixWorld(true);
      if (!satelliteMesh.visible) {
        groundTrackVectorLine.visible = false;
        return;
      }
      const satPosition = satelliteMesh.getWorldPosition(new THREE.Vector3());
      const satRadius = satPosition.length();
      if (!Number.isFinite(satRadius) || satRadius <= 0) {
        groundTrackVectorLine.visible = false;
        return;
      }

      const nadirPosition = satPosition.clone().normalize().multiplyScalar(1.0);

      groundTrackVectorLine.geometry.dispose();
      groundTrackVectorLine.geometry = new THREE.BufferGeometry().setFromPoints([
        satPosition,
        nadirPosition,
      ]);
      groundTrackVectorLine.visible = true;
      if (typeof groundTrackVectorLine.computeLineDistances === 'function') {
        groundTrackVectorLine.computeLineDistances();
      }
    }

    function updateSunDirection() {
      if (!earthUniforms?.sunDirection || !sunLight) return;
      earthUniforms.sunDirection.value.copy(sunLight.position).normalize();
    }

    async function initScene(container) {
      containerEl = container;
      canvasEl = container?.querySelector('#threeCanvas');
      fallbackEl = container?.querySelector('#threeFallback');

      if (!containerEl || !canvasEl) {
        console.error('3D mode container or canvas element not found.');
        showFallback('Missing 3D canvas in the interface.');
        return;
      }

      hideFallback();

      if (isReady) {
        resizeRenderer();
        return;
      }

      try {
        await ensureThree();

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x020617);

        buildRenderer();
        buildCamera();
        buildControls();
        buildLights();
        await buildEarth();
        buildSceneGraph();

        resizeObserver = new ResizeObserver(() => resizeRenderer());
        resizeObserver.observe(containerEl);
        window.addEventListener('resize', resizeRenderer);

        updateEarthRotation();
        startAnimation();
        isReady = true;
      } catch (error) {
        console.error('Error initializing the 3D view', error);
        showFallback(error?.message || 'Unable to initialize the 3D view.');
      }
    }

    function updateOrbitPath(points) {
      if (!isReady || !orbitLine) return;
      if (!points?.length) {
        orbitLine.visible = false;
        orbitLine.geometry.dispose();
        orbitLine.geometry = new THREE.BufferGeometry();
        return;
      }
      const vectors = points
        .map((p) => toVector3Eci(p.rEci))
        .filter((vec) => vec instanceof THREE.Vector3);
      if (!vectors.length) {
        orbitLine.visible = false;
        return;
      }
      const first = vectors[0];
      const last = vectors[vectors.length - 1];
      const closed = first.distanceTo(last) < 1e-3;
      const curve = new THREE.CatmullRomCurve3(vectors, closed, 'centripetal', 0.5);
      const segments = Math.min(2048, Math.max(120, vectors.length * 3));
      const smoothPoints = curve.getPoints(segments);
      orbitLine.geometry.dispose();
      orbitLine.geometry = new THREE.BufferGeometry().setFromPoints(smoothPoints);
      orbitLine.visible = true;
    }

    function updateSatellite(point) {
      if (!isReady || !satelliteMesh || !point) return;
      const pos = toVector3Eci(point.rEci);
      if (!pos) return;
      satelliteMesh.position.copy(pos);
      satelliteMesh.visible = true;
    }

    function renderStations(stations, selectedId) {
      if (!isReady || !stationGroup) return;
      const keep = new Set();
      stations.forEach((station) => {
        const mesh = ensureStationMesh(station);
        const vec = toVector3(stationEcef(station));
        if (!vec) return;
        mesh.position.copy(vec);
        if (station.id === selectedId) {
          mesh.material.color.setHex(0xfacc15);
          mesh.material.emissive.setHex(0xb45309);
          mesh.scale.setScalar(1.6);
        } else {
          mesh.material.color.setHex(0x0ea5e9);
          mesh.material.emissive.setHex(0x082f49);
          mesh.scale.setScalar(1);
        }
        keep.add(station.id);
      });
      clearStations(keep);
    }

    function updateLink(point, station) {
      if (!isReady || !linkLine) return;
      if (!point || !station) {
        linkLine.visible = false;
        return;
      }
      const sat = toVector3Eci(point.rEci);
      const mesh = ensureStationMesh(station);
      if (!sat || !mesh) {
        linkLine.visible = false;
        return;
      }
      earthGroup?.updateMatrixWorld(true);
      const ground = mesh.getWorldPosition(new THREE.Vector3());
      linkLine.geometry.dispose();
      linkLine.geometry = new THREE.BufferGeometry().setFromPoints([ground, sat]);
      if (typeof linkLine.computeLineDistances === 'function') {
        linkLine.computeLineDistances();
      }
      linkLine.visible = true;
    }

    function setTheme(nextTheme) {
      if (!scene || !renderer) return;
      if (nextTheme === 'dark') {
        scene.background.setHex(0x020617);
        renderer.setClearColor(0x020617, 1);
        if (earthUniforms) {
          earthUniforms.ambientStrength.value = 0.3;
          earthUniforms.nightStrength.value = 1.05;
        }
      } else {
        scene.background.setHex(0xf4f7fb);
        renderer.setClearColor(0xf4f7fb, 1);
        if (earthUniforms) {
          earthUniforms.ambientStrength.value = 0.4;
          earthUniforms.nightStrength.value = 0.85;
        }
      }
    }

    function disposeScene() {
      cancelAnimation();
      if (resizeObserver && containerEl) {
        resizeObserver.unobserve(containerEl);
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      window.removeEventListener('resize', resizeRenderer);

      if (renderer) {
        renderer.dispose();
        renderer = null;
      }

      stationMeshes.forEach((mesh) => {
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      stationMeshes.clear();
      constellationPoints.forEach((entry) => {
        scene?.remove(entry.points);
        entry.points?.geometry?.dispose?.();
        entry.material?.dispose?.();
      });
      constellationPoints.clear();

      earthGroup?.remove(groundTrackLine);
      earthGroup?.remove(stationGroup);
      scene?.remove(orbitLine);
      scene?.remove(linkLine);
      scene?.remove(satelliteMesh);
      scene?.remove(groundTrackVectorLine);

      orbitLine?.geometry?.dispose();
      orbitLine?.material?.dispose();
      linkLine?.geometry?.dispose();
      linkLine?.material?.dispose();
      groundTrackLine?.geometry?.dispose();
      groundTrackLine?.material?.dispose();
      groundTrackVectorLine?.geometry?.dispose();
      groundTrackVectorLine?.material?.dispose();
      earthMesh?.geometry?.dispose();
      earthMesh?.material?.dispose();
      atmosphereMesh?.geometry?.dispose();
      atmosphereMesh?.material?.dispose();
      disposeEarthTextures();

      scene = null;
      camera = null;
      controls = null;
      earthGroup = null;
      earthMesh = null;
      atmosphereMesh = null;
      orbitLine = null;
      satelliteMesh = null;
      stationGroup = null;
      linkLine = null;
      groundTrackLine = null;
      groundTrackVectorLine = null;
      earthUniforms = null;
      earthTextures = null;
      sunLight = null;
      containerEl = null;
      canvasEl = null;
      fallbackEl = null;
      isReady = false;
      earthSimulationRotation = 0;
      passiveAtmosphereOffset = 0;
    }

    function ensureConstellationEntry(groupId, color) {
      if (!isReady || !scene || !THREE) return null;
      let entry = constellationPoints.get(groupId);
      if (!entry) {
        const geometry = new THREE.BufferGeometry();
        const material = new THREE.PointsMaterial({
          color: new THREE.Color(color || 0xffffff),
          size: 0.02,
          sizeAttenuation: true,
          depthWrite: false,
          transparent: true,
          opacity: 0.92,
        });
        const points = new THREE.Points(geometry, material);
        points.name = `constellation-${groupId}`;
        scene.add(points);
        entry = { geometry, material, points };
        constellationPoints.set(groupId, entry);
      } else if (color) {
        entry.material.color.set(color);
      }
      entry.points.visible = true;
      return entry;
    }

    function renderConstellations(groupId, satellites, options = {}) {
      if (!isReady || !scene || !THREE) return;
      if (!Array.isArray(satellites) || satellites.length === 0) {
        clearConstellation(groupId);
        return;
      }
      const color = options.color || '#ffffff';
      const entry = ensureConstellationEntry(groupId, color);
      if (!entry) return;
      const positions = [];
      satellites.forEach((sat) => {
        if (!Array.isArray(sat?.rEci) || sat.rEci.length !== 3) return;
        const vec = toVector3Eci(sat.rEci);
        if (!vec) return;
        positions.push(vec.x, vec.y, vec.z);
      });
      if (!positions.length) {
        clearConstellation(groupId);
        return;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeBoundingSphere();
      entry.points.geometry.dispose();
      entry.points.geometry = geometry;
      entry.geometry = geometry;
      entry.material.color.set(color);
      entry.material.needsUpdate = true;
      entry.points.visible = true;
    }

    function clearConstellation(groupId) {
      const entry = constellationPoints.get(groupId);
      if (!entry) return;
      if (entry.points && scene) {
        scene.remove(entry.points);
      }
      entry.points?.geometry?.dispose?.();
      entry.material?.dispose?.();
      constellationPoints.delete(groupId);
    }

    module.exports = {
      setEarthRotationFromTime,
      frameOrbitView,
      updateGroundTrackSurface,
      updateGroundTrackVector,
      initScene,
      updateOrbitPath,
      updateSatellite,
      renderStations,
      updateLink,
      setTheme,
      disposeScene,
      renderConstellations,
      clearConstellation,
    };

  });
  define('groundStations', (exports, module) => {
    const { upsertStation, removeStations, removeStation: removeStationFromState } = require('state');

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

    async function loadStationsFromServer() {
      let loadedFromServer = false;
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
            loadedFromServer = true;
          }
        }
      } catch (error) {
        console.warn('Remote stations could not be loaded, falling back to built-in list.', error);
      }

      if (!loadedFromServer) {
        for (const station of builtinStations) {
          await persistStation(station);
        }
      }
      builtinStations.forEach((station) => upsertStation(station));
    }

    async function persistStation(station) {
      try {
        const response = await fetch('/api/ogs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: station.id,
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
        console.warn('Station could not be persisted on the backend; keeping it in memory only.', error);
      }
    }

    async function clearStations() {
      try {
        await fetch('/api/ogs', { method: 'DELETE' });
      } catch (error) {
        console.warn('Remote station records could not be cleared.', error);
      }
      removeStations();
    }

    async function deleteStationRemote(stationId) {
      if (!stationId) return;
      try {
        const response = await fetch(`/api/ogs/${encodeURIComponent(stationId)}`, { method: 'DELETE' });
        if (!response.ok && response.status !== 404) {
          throw new Error(`Error ${response.status}`);
        }
      } catch (error) {
        console.warn('Station could not be removed on the backend; removing it locally only.', error);
      }
      builtinStations = builtinStations.filter((station) => station.id !== stationId);
      removeStationFromState(stationId);
    }

    module.exports = { loadStationsFromServer, persistStation, clearStations, deleteStationRemote };

  });
  define('main', (exports, module) => {
    const {
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
      CONSTELLATION_GROUPS,
      setConstellationEnabled,
      setConstellationLoading,
      setConstellationMetadata,
      setConstellationError,
    } = require('state');
    const { propagateOrbit, computeStationMetrics, constants: orbitConstants } = require('orbit');
    const {
      initMap,
      updateGroundTrack,
      updateSatellitePosition,
      renderStations: renderStations2D,
      updateLinkLine,
      focusOnStation,
      flyToOrbit,
      annotateStationTooltip,
      toggleBaseLayer,
      setBaseLayer,
      invalidateSize: invalidateMap,
      startStationPicker,
      stopStationPicker,
      renderWeatherField,
      clearWeatherField,
      renderConstellations: renderConstellations2D,
      clearConstellationGroup: clearConstellation2D,
    } = require('map2d');
    const {
      initScene,
      updateOrbitPath,
      updateSatellite,
      renderStations: renderStations3D,
      updateLink: updateLink3D,
      setEarthRotationFromTime,
      setTheme: setSceneTheme,
      frameOrbitView,
      updateGroundTrackSurface,
      updateGroundTrackVector,
      renderConstellations: renderConstellations3D,
      clearConstellation: clearConstellation3D,
    } = require('scene3d');
    const { loadStationsFromServer, persistStation, deleteStationRemote } = require('groundStations');
    const { isoNowLocal, clamp, formatAngle, formatDistanceKm, formatLoss, formatDoppler, formatDuration } = require('utils');
    const { searchResonances } = require('resonanceSolver');

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

    const constellationStore = new Map();
    let lastConstellationIndex = -1;

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
        'constellationControls', 'constellationList', 'constellationStatus',
        'modeIndividual', 'modeConstellation', 'walkerPanel', 'walkerT', 'walkerP', 'walkerF',
        'btnDefinePoints', 'btnOptimize', 'btnCancelOptimize', 'simDuration', 'pointsCount', 'optStatus', 'pointsList', 'optProgress', 'workerToggle', 'workerCount',
        // QKD elements
        'qkdProtocol', 'photonRate', 'photonRateSlider', 'detectorEfficiency', 'detectorEfficiencySlider',
        'darkCountRate', 'darkCountRateSlider', 'opticalFilterBandwidth', 'opticalFilterBandwidthSlider',
        'btnCalculateQKD', 'qkdStatus', 'qberMetric', 'rawKeyRateMetric', 'secureKeyRateMetric', 'channelTransmittanceMetric',
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

    function getConstellationConfig(groupId) {
      return CONSTELLATION_GROUPS.find((group) => group.id === groupId) ?? null;
    }

    function setConstellationStatusMessage(message = '', status = 'idle') {
      if (!elements.constellationStatus) return;
      if (!message) {
        elements.constellationStatus.hidden = true;
        elements.constellationStatus.textContent = '';
        elements.constellationStatus.dataset.status = 'idle';
        return;
      }
      elements.constellationStatus.textContent = message;
      elements.constellationStatus.dataset.status = status;
      elements.constellationStatus.hidden = false;
    }

    function renderConstellationControls() {
      if (!elements.constellationList) return;
      elements.constellationList.innerHTML = '';
      CONSTELLATION_GROUPS.forEach((group) => {
        const label = document.createElement('label');
        label.className = 'constellation-toggle';
        label.dataset.constellation = group.id;
        label.style.setProperty('--constellation-color', group.color);

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.constellation = group.id;
        checkbox.disabled = !window.satellite;
        label.appendChild(checkbox);

        const name = document.createElement('span');
        name.className = 'constellation-name';
        name.textContent = group.label;
        label.appendChild(name);

        const count = document.createElement('span');
        count.className = 'constellation-count';
        count.hidden = true;
        label.appendChild(count);

        elements.constellationList.appendChild(label);
      });

      if (!window.satellite) {
        setConstellationStatusMessage('satellite.js failed to load; constellation overlays are unavailable.', 'error');
      } else {
        setConstellationStatusMessage('Select constellations to overlay on the map and globe.', 'idle');
      }

      updateConstellationToggleStates();
    }

    function updateConstellationToggleStates(snapshot = state) {
      if (!elements.constellationList) return;
      const registry = snapshot.constellations?.registry ?? {};
      CONSTELLATION_GROUPS.forEach((group) => {
        const selector = `.constellation-toggle[data-constellation="${group.id}"]`;
        const label = elements.constellationList.querySelector(selector);
        if (!label) return;
        const checkbox = label.querySelector('input[type="checkbox"][data-constellation]');
        const groupState = registry[group.id] ?? {};
        if (checkbox && !checkbox.matches(':focus')) {
          checkbox.checked = Boolean(groupState.enabled);
          checkbox.disabled = Boolean(groupState.loading) || !window.satellite;
        }
        label.dataset.active = groupState.enabled ? 'true' : 'false';
        label.dataset.loading = groupState.loading ? 'true' : 'false';
        label.dataset.error = groupState.error ? 'true' : 'false';
        const countEl = label.querySelector('.constellation-count');
        if (countEl) {
          if (groupState.count) {
            countEl.hidden = false;
            countEl.textContent = String(groupState.count);
          } else {
            countEl.hidden = true;
            countEl.textContent = '';
          }
        }
      });
    }

    function hasActiveConstellations(snapshot = state) {
      const registry = snapshot.constellations?.registry;
      if (!registry) return false;
      return Object.values(registry).some((group) => group?.enabled);
    }

    function getActiveConstellationDatasets() {
      const registry = state.constellations?.registry ?? {};
      return CONSTELLATION_GROUPS.map((group) => {
        if (!registry[group.id]?.enabled) return null;
        const storeEntry = constellationStore.get(group.id);
        if (!storeEntry || !Array.isArray(storeEntry.entries) || !storeEntry.entries.length) {
          return null;
        }
        return {
          id: group.id,
          color: storeEntry.color ?? group.color,
          entries: storeEntry.entries,
        };
      }).filter(Boolean);
    }

    function computeConstellationPositions(timeline, epochIso, datasets) {
      if (!Array.isArray(timeline) || !timeline.length) return {};
      if (!Array.isArray(datasets) || !datasets.length) return {};
      const satLib = window.satellite;
      if (!satLib) return {};

      const epochDate = new Date(epochIso);
      const epochMs = epochDate.getTime();
      if (Number.isNaN(epochMs)) return {};

      const sampleDates = timeline.map((seconds) => new Date(epochMs + seconds * 1000));
      const gmstValues = sampleDates.map((date) => satLib.gstime(date));

      const result = {};

      datasets.forEach((dataset) => {
        if (!dataset) return;
        const satellites = [];
        dataset.entries.forEach((entry) => {
          if (!entry?.satrec) return;
          const timelineSamples = [];
          for (let idx = 0; idx < sampleDates.length; idx += 1) {
            const date = sampleDates[idx];
            const gmst = gmstValues[idx];
            try {
              const propagation = satLib.propagate(entry.satrec, date);
              const position = propagation?.position;
              if (!position) {
                timelineSamples.push(null);
                continue;
              }
              const geodetic = satLib.eciToGeodetic(position, gmst);
              if (!geodetic) {
                timelineSamples.push(null);
                continue;
              }
              const lat = satLib.degreesLat(geodetic.latitude);
              const lon = ((satLib.degreesLong(geodetic.longitude) + 540) % 360) - 180;
              const alt = geodetic.height;
              if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(alt)) {
                timelineSamples.push(null);
                continue;
              }
              timelineSamples.push({
                lat,
                lon,
                alt,
                rEci: [position.x, position.y, position.z],
              });
            } catch (error) {
              timelineSamples.push(null);
            }
          }
          satellites.push({
            id: entry.id,
            name: entry.name,
            timeline: timelineSamples,
          });
        });
        if (satellites.length) {
          result[dataset.id] = {
            color: dataset.color,
            satellites,
          };
        }
      });

      return result;
    }

    function refreshConstellationPositions({ force = false } = {}) {
      if (!hasActiveConstellations()) {
        mutate((draft) => {
          draft.computed.constellationPositions = {};
        });
        lastConstellationIndex = -1;
        return;
      }
      if (!window.satellite) {
        setConstellationStatusMessage('satellite.js is required to enable constellation overlays.', 'error');
        return;
      }
      const timeline = state.time.timeline ?? [];
      if (!timeline.length) return;
      const datasets = getActiveConstellationDatasets();
      if (!datasets.length) {
        mutate((draft) => {
          draft.computed.constellationPositions = {};
        });
        lastConstellationIndex = -1;
        return;
      }

      if (!force) {
        const currentMap = state.computed?.constellationPositions ?? {};
        const hasAllGroups = datasets.every((dataset) => currentMap[dataset.id]);
        if (hasAllGroups && Object.keys(currentMap).length === datasets.length) {
          return;
        }
      }

      const positions = computeConstellationPositions(timeline, state.epoch, datasets);
      mutate((draft) => {
        draft.computed.constellationPositions = positions;
      });
      lastConstellationIndex = -1;
    }

    function clearAllConstellations() {
      CONSTELLATION_GROUPS.forEach((group) => {
        clearConstellation2D(group.id);
        clearConstellation3D(group.id);
      });
      lastConstellationIndex = -1;
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
      renderConstellationControls();
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

      // Wire help nav buttons (show corresponding help article)
      try {
        const helpButtons = document.querySelectorAll('.help-nav [data-help-topic]');
        helpButtons.forEach((btn) => {
          btn.addEventListener('click', () => {
            const topic = btn.dataset.helpTopic;
            if (!topic) return;
            activatePanelSection('help');
            // ensure panel is visible when opening help
            setPanelCollapsed(false);
            const articles = document.querySelectorAll('.help-content article');
            articles.forEach((a) => { a.hidden = true; });
            const sel = document.getElementById(`help-${topic}`);
            if (sel) sel.hidden = false;
          });
        });
      } catch (e) { /* ignore if elements not present */ }

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

      // Mode selector (individual vs constellation)
      if (elements.modeIndividual && elements.modeConstellation) {
        const applyMode = (mode) => {
          mutate((draft) => { draft.mode = mode; });
          if (mode === 'constellation') {
            if (elements.walkerPanel) elements.walkerPanel.hidden = false;
            // precompute constellation positions if already loaded
            refreshConstellationPositions({ force: false });
          } else {
            if (elements.walkerPanel) elements.walkerPanel.hidden = true;
          }
        };
        elements.modeIndividual.addEventListener('change', () => applyMode('individual'));
        elements.modeConstellation.addEventListener('change', () => applyMode('constellation'));
      }

      // Define control points (click-to-add on map) - stored in global state: state.optimizationPoints
      if (elements.btnDefinePoints) {
        // Toggle pick-mode: click map to add points, markers are draggable and removable
        let pointPickingActive = false;
        const optimizationMarkers = [];

        function renderPointsList() {
          if (!elements.pointsList) return;
          elements.pointsList.innerHTML = '';
          state.optimizationPoints.forEach((pt, idx) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.padding = '2px 4px';
            const label = document.createElement('div');
            label.textContent = `${pt.lat.toFixed(4)}, ${pt.lon.toFixed(4)}`;
            const actions = document.createElement('div');
            const btnCenter = document.createElement('button');
            btnCenter.textContent = '→';
            btnCenter.title = 'Centrar mapa';
            btnCenter.style.marginRight = '6px';
            btnCenter.addEventListener('click', () => {
              if (map) map.setView([pt.lat, pt.lon], Math.max(map.getZoom(), 4));
            });
            const btnRemove = document.createElement('button');
            btnRemove.textContent = '✖';
            btnRemove.title = 'Eliminar punto';
            btnRemove.addEventListener('click', () => {
              // remove marker on map and from state
              const m = optimizationMarkers[idx];
              try { if (m && map) map.removeLayer(m); } catch (e) {}
              optimizationMarkers.splice(idx, 1);
              mutate((draft) => { draft.optimizationPoints.splice(idx, 1); });
              renderPointsList();
              if (elements.pointsCount) elements.pointsCount.textContent = `${state.optimizationPoints.length} puntos`;
            });
            actions.appendChild(btnCenter);
            actions.appendChild(btnRemove);
            row.appendChild(label);
            row.appendChild(actions);
            elements.pointsList.appendChild(row);
          });
          if (elements.pointsCount) elements.pointsCount.textContent = `${state.optimizationPoints.length} puntos`;
        }

        // expose helper functions so initialize() can restore markers after map init
        elements.addOptimizationMarker = addOptimizationMarker;
        elements.renderPointsList = renderPointsList;

        function addOptimizationMarker(lat, lon) {
          if (!map) return;
          const marker = L.marker([lat, lon], { draggable: true }).addTo(map);
          const idx = optimizationMarkers.length;
          marker.bindPopup(`<div style="font-size:0.9em">${lat.toFixed(4)}, ${lon.toFixed(4)}<br/><button data-action="remove">Eliminar</button></div>`);
          marker.on('popupopen', (e) => {
            const btn = e.popup._contentNode.querySelector('[data-action="remove"]');
            if (btn) btn.addEventListener('click', () => {
              marker.remove();
              const i = optimizationMarkers.indexOf(marker);
                if (i >= 0) {
                optimizationMarkers.splice(i, 1);
                mutate((draft) => { draft.optimizationPoints.splice(i, 1); });
                renderPointsList();
              }
            });
          });
          marker.on('dragend', () => {
            const pos = marker.getLatLng();
            const i = optimizationMarkers.indexOf(marker);
            if (i >= 0) {
              mutate((draft) => { draft.optimizationPoints[i] = { lat: pos.lat, lon: pos.lng }; });
              renderPointsList();
            }
          });
          optimizationMarkers.push(marker);
        }

        elements.btnDefinePoints.addEventListener('click', () => {
          pointPickingActive = !pointPickingActive;
          elements.btnDefinePoints.textContent = pointPickingActive ? 'Picking: Haz click en el mapa' : 'Definir puntos de control';
          // Toggle visual state
          if (pointPickingActive) elements.btnDefinePoints.classList.add('btn-picking'); else elements.btnDefinePoints.classList.remove('btn-picking');
          if (pointPickingActive) {
            // temporary hint
            if (map && map._container) map._container.style.cursor = 'crosshair';
          } else if (map && map._container) {
            map._container.style.cursor = '';
          }
        });

        // map click handler - add point when pick mode active
        if (typeof map !== 'undefined' && map) {
          map.on('click', (ev) => {
            if (!pointPickingActive) return;
            const { lat, lng } = ev.latlng;
            mutate((draft) => { draft.optimizationPoints.push({ lat, lon: lng }); });
            addOptimizationMarker(lat, lng);
            renderPointsList();
          });
        }
        // initial render if any
        renderPointsList();
      }

      // Optimize design
      if (elements.btnOptimize) {
        elements.btnOptimize.addEventListener('click', async () => {
          try {
            if (!Array.isArray(state.time.timeline) || !state.time.timeline.length) {
              await recomputeOrbit(true);
            }
            const timelineSeconds = state.time.timeline.slice();
            const simDuration = Number(elements.simDuration?.value) || timelineSeconds[timelineSeconds.length - 1] || 3600;

            const walker = require('walkerGenerator');
            const engine = require('optimizationEngine');
            const settings = state;

            // Build initial constellation
            let initialConstellation = [];
            if (state.mode === 'constellation') {
              const T = Number(elements.walkerT?.value) || 24;
              const P = Number(elements.walkerP?.value) || 6;
              const F = Number(elements.walkerF?.value) || 1;
              const a = Number(state.orbital.semiMajor) || 6771;
              const i = Number(state.orbital.inclination) || 53;
              initialConstellation = walker.generateWalkerConstellation(T, P, F, a, i, Number(state.orbital.eccentricity) || 0);
            } else {
              // single satellite uses the current orbital element as a single-entry constellation
              initialConstellation = [{
                semiMajor: state.orbital.semiMajor,
                eccentricity: state.orbital.eccentricity,
                inclination: state.orbital.inclination,
                raan: state.orbital.raan,
                argPerigee: state.orbital.argPerigee,
                meanAnomaly: state.orbital.meanAnomaly,
              }];
            }

            // factory to compute positions for a candidate constellation
            const constellationPositionsFactory = (constellation) => {
              const result = { design: { satellites: [] } };
              for (let s = 0; s < constellation.length; s += 1) {
                const sat = constellation[s];
                // build settings to propagate this satellite
                const satSettings = {
                  orbital: {
                    semiMajor: sat.semiMajor,
                    eccentricity: sat.eccentricity,
                    inclination: sat.inclination,
                    raan: sat.raan,
                    argPerigee: sat.argPerigee,
                    meanAnomaly: sat.meanAnomaly,
                  },
                  resonance: { enabled: false },
                  samplesPerOrbit: state.samplesPerOrbit,
                  time: { timeline: timelineSeconds },
                  epoch: state.epoch,
                };
                const orbitRes = propagateOrbit(satSettings);
                const timeline = orbitRes.dataPoints || [];
                const satTimeline = timeline.map((pt) => ({ lat: pt.lat, lon: pt.lon, alt: pt.alt }));
                result.design.satellites.push({ id: `s-${s}`, name: `sat-${s}`, timeline: satTimeline });
              }
              return result;
            };

            // non-blocking optimizer with progress and optional worker
            if (elements.optStatus) elements.optStatus.textContent = 'Optimizando…';
            if (elements.optProgress) { elements.optProgress.max = 1; elements.optProgress.value = 0; }
            if (elements.btnCancelOptimize) { elements.btnCancelOptimize.style.display = 'inline-block'; }
            let cancelRequested = false;
            if (elements.btnCancelOptimize) elements.btnCancelOptimize.onclick = () => { cancelRequested = true; elements.optStatus.textContent = 'Cancelando…'; };

            const useWorker = elements.workerToggle?.checked === true;
            // helper to compute positions for a candidate constellation. If worker enabled, use worker; otherwise compute on main thread
            async function positionsFactoryAsync(constellation) {
              if (useWorker && window.Worker) {
                // create worker and propagate satellites serially
                return new Promise((resolve, reject) => {
                    const workerCount = Math.max(1, Number(elements.workerCount?.value) || 1);
                    const results = { design: { satellites: [] } };
                    let completed = 0;
                    // create layer for partial results
                    let partialLayer = null;
                    if (map) {
                      try { partialLayer = L.layerGroup().addTo(map); } catch (e) { partialLayer = null; }
                    }
                    if (workerCount <= 1) {
                      const worker = new Worker('/static/propagateWorker.js');
                      worker.onmessage = (ev) => {
                        const msg = ev.data || {};
                        if (msg.type === 'progress') {
                          if (elements.optProgress && msg.total) elements.optProgress.value = msg.done / msg.total;
                          if (elements.optStatus) elements.optStatus.textContent = `Propagando sat ${msg.done}/${msg.total}`;
                          return;
                        }
                        if (msg.type === 'result') {
                          results.design.satellites.push({ id: msg.id, name: msg.name, timeline: msg.timeline });
                          completed += 1;
                          if (elements.optProgress && msg.total) elements.optProgress.value = completed / msg.total;
                          // render partial result on map
                          try {
                            if (partialLayer && Array.isArray(msg.timeline) && msg.timeline.length) {
                              const latlngs = msg.timeline.map((p) => [p.lat, p.lon]);
                              const poly = L.polyline(latlngs, { color: '#7c3aed', weight: 1, opacity: 0.7 }).addTo(partialLayer);
                              L.circleMarker(latlngs[0], { radius: 2, color: '#fff', fillColor: '#7c3aed', fillOpacity: 1 }).addTo(partialLayer);
                            }
                          } catch (e) { /* ignore rendering errors */ }
                          if (completed >= (msg.total || constellation.length)) {
                            worker.terminate();
                            resolve(results);
                          }
                        }
                        if (msg.type === 'error') {
                          worker.terminate();
                          if (partialLayer) partialLayer.clearLayers();
                          reject(new Error(msg.message || 'Worker error'));
                        }
                      };
                      worker.onerror = (err) => { worker.terminate(); if (partialLayer) partialLayer.clearLayers(); reject(err); };
                      worker.postMessage({ type: 'propagateBatch', payload: { constellation, timeline: timelineSeconds, epoch: state.epoch } });
                    } else {
                      // split constellation into roughly equal chunks and spawn multiple workers
                      const n = Math.min(workerCount, constellation.length);
                      const chunkSize = Math.ceil(constellation.length / n);
                      const workers = [];
                      let pending = 0;
                      for (let w = 0; w < n; w += 1) {
                        const start = w * chunkSize;
                        const end = Math.min(start + chunkSize, constellation.length);
                        if (start >= end) continue;
                        const subset = constellation.slice(start, end);
                        pending += subset.length;
                        const wk = new Worker('/static/propagateWorker.js');
                        workers.push(wk);
                        wk.onmessage = (ev) => {
                          const msg = ev.data || {};
                          if (msg.type === 'progress') {
                            // aggregate progress crudely
                            if (elements.optStatus) elements.optStatus.textContent = `Propagando sat ${msg.done}/${msg.total}`;
                            return;
                          }
                          if (msg.type === 'result') {
                            results.design.satellites.push({ id: msg.id, name: msg.name, timeline: msg.timeline });
                            completed += 1;
                            if (elements.optProgress && constellation.length) elements.optProgress.value = completed / constellation.length;
                            // render partial
                            try {
                              if (partialLayer && Array.isArray(msg.timeline) && msg.timeline.length) {
                                const latlngs = msg.timeline.map((p) => [p.lat, p.lon]);
                                const poly = L.polyline(latlngs, { color: '#7c3aed', weight: 1, opacity: 0.65 }).addTo(partialLayer);
                              }
                            } catch (e) {}
                            if (completed >= constellation.length) {
                              // terminate all workers
                              workers.forEach((x) => { try { x.terminate(); } catch (e) {} });
                              resolve(results);
                            }
                          }
                          if (msg.type === 'error') {
                            workers.forEach((x) => { try { x.terminate(); } catch (e) {} });
                            if (partialLayer) partialLayer.clearLayers();
                            reject(new Error(msg.message || 'Worker error'));
                          }
                        };
                        wk.onerror = (err) => { workers.forEach((x) => { try { x.terminate(); } catch (e) {} }); if (partialLayer) partialLayer.clearLayers(); reject(err); };
                        wk.postMessage({ type: 'propagateBatch', payload: { constellation: subset, timeline: timelineSeconds, epoch: state.epoch } });
                      }
                    }
                });
              }
              // fallback: synchronous factory
              return new Promise((resolve) => {
                const result = { design: { satellites: [] } };
                for (let s = 0; s < constellation.length; s += 1) {
                  if (cancelRequested) break;
                  const sat = constellation[s];
                  const satSettings = {
                    orbital: {
                      semiMajor: sat.semiMajor,
                      eccentricity: sat.eccentricity,
                      inclination: sat.inclination,
                      raan: sat.raan,
                      argPerigee: sat.argPerigee,
                      meanAnomaly: sat.meanAnomaly,
                    },
                    resonance: { enabled: false },
                    samplesPerOrbit: state.samplesPerOrbit,
                    time: { timeline: timelineSeconds },
                    epoch: state.epoch,
                  };
                  const orbitRes = propagateOrbit(satSettings);
                  const tl = (orbitRes.dataPoints || []).map((pt) => ({ lat: pt.lat, lon: pt.lon, alt: pt.alt }));
                  result.design.satellites.push({ id: `s-${s}`, name: `sat-${s}`, timeline: tl });
                  if (elements.optProgress) elements.optProgress.value = (s + 1) / constellation.length;
                }
                resolve(result);
              });
            }

            // batched iterative optimizer on main thread, yielding to UI every few iterations
            const iterations = 80;
            const batchSize = 5;
            let best = initialConstellation.map((s) => ({ ...s }));
            let bestPositions = await positionsFactoryAsync(best);
            let bestScoreObj = engine.computeRevisitTime(bestPositions, state.optimizationPoints.length ? state.optimizationPoints : [{ lat: 0, lon: 0 }], timelineSeconds);
            let bestScore = bestScoreObj.max;

            for (let it = 0; it < iterations; it += 1) {
              if (cancelRequested) break;
              // mutate copy
              const candidate = require('optimizationEngine').mutateConstellation(best, Math.max(0.1, 5 * (1 - it / iterations)));
              const candidatePositions = await positionsFactoryAsync(candidate);
              const scoreObj = engine.computeRevisitTime(candidatePositions, state.optimizationPoints.length ? state.optimizationPoints : [{ lat: 0, lon: 0 }], timelineSeconds);
              const score = scoreObj.max;
              if (Number.isFinite(score) && score < bestScore) {
                best = candidate;
                bestPositions = candidatePositions;
                bestScoreObj = scoreObj;
                bestScore = score;
              }
              if (elements.optProgress) elements.optProgress.value = (it + 1) / iterations;
              if (elements.optStatus) elements.optStatus.textContent = `Iter ${it + 1}/${iterations} — best ${Math.round(bestScore)} s`;
              // yield occasionally
              if ((it % batchSize) === 0) await new Promise((r) => setTimeout(r, 10));
            }

            if (elements.btnCancelOptimize) elements.btnCancelOptimize.style.display = 'none';
            if (cancelRequested) {
              if (elements.optStatus) elements.optStatus.textContent = 'Optimización cancelada';
              if (elements.optProgress) elements.optProgress.value = 0;
              return;
            }

            // apply best constellation by visualizing its first satellite orbit and placing markers for each sat
            if (Array.isArray(best) && best.length) {
              const primary = best[0];
              mutate((draft) => {
                draft.orbital.semiMajor = primary.semiMajor;
                draft.orbital.eccentricity = primary.eccentricity;
                draft.orbital.inclination = primary.inclination;
                draft.orbital.raan = primary.raan;
                draft.orbital.argPerigee = primary.argPerigee;
                draft.orbital.meanAnomaly = primary.meanAnomaly;
              });
              await recomputeOrbit(true);
            }
            if (elements.optStatus) elements.optStatus.textContent = `Done — max revisit ${Number.isFinite(bestScoreObj.max) ? Math.round(bestScoreObj.max) : '∞'} s, mean ${Number.isFinite(bestScoreObj.mean) ? Math.round(bestScoreObj.mean) : '∞'} s`;
          } catch (err) {
            console.error('Optimization failed', err);
            if (elements.optStatus) elements.optStatus.textContent = 'Error during optimization';
          }
        });
      }

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

      // QKD Calculate button handler
      elements.btnCalculateQKD?.addEventListener('click', () => {
        logCheckpoint('QKD Calculate button clicked');
        try {
          const { logInfo, validateNumber } = require('utils');
          const { calculateQKDPerformance } = require('qkdCalculations');
          
          // Get current link loss from computed metrics
          const currentLoss = state.computed?.linkLoss || 0;
          
          // Get QKD parameters from UI
          const protocol = elements.qkdProtocol?.value || 'bb84';
          const photonRate = validateNumber(elements.photonRate?.value, 1, 1000, 'photonRate') * 1e6 || 100e6; // Convert MHz to Hz
          const detectorEfficiency = validateNumber(elements.detectorEfficiency?.value, 0, 1, 'detectorEfficiency') || 0.65;
          const darkCountRate = validateNumber(elements.darkCountRate?.value, 0, 10000, 'darkCountRate') || 100;
          
          if (!photonRate || !detectorEfficiency || darkCountRate === null) {
            const statusEl = document.getElementById('qkdStatus');
            if (statusEl) statusEl.textContent = 'Error: Invalid input parameters';
            logError('QKD calculation', new Error('Invalid parameters'));
            return;
          }
          
          logInfo('QKD parameters collected', { protocol, photonRate, detectorEfficiency, darkCountRate, currentLoss });
          
          // Calculate QKD performance
          const results = calculateQKDPerformance(protocol, {
            photonRate: photonRate,
            channelLossdB: currentLoss,
            detectorEfficiency: detectorEfficiency,
            darkCountRate: darkCountRate
          });
          
          logCheckpoint('QKD results calculated', results);
          
          // Update UI with results
          const qberEl = document.getElementById('qberMetric');
          const rawKeyRateEl = document.getElementById('rawKeyRateMetric');
          const secureKeyRateEl = document.getElementById('secureKeyRateMetric');
          const channelTransEl = document.getElementById('channelTransmittanceMetric');
          
          if (results.error) {
            const statusEl = document.getElementById('qkdStatus');
            if (statusEl) statusEl.textContent = `Error: ${results.error}`;
            if (qberEl) qberEl.textContent = '--';
            if (rawKeyRateEl) rawKeyRateEl.textContent = '--';
            if (secureKeyRateEl) secureKeyRateEl.textContent = '--';
            if (channelTransEl) channelTransEl.textContent = '--';
            return;
          }
          
          // Format and display results
          if (qberEl) qberEl.textContent = results.qber !== null ? results.qber.toFixed(2) + '%' : '--';
          if (rawKeyRateEl) rawKeyRateEl.textContent = results.rawKeyRate !== null ? results.rawKeyRate.toFixed(2) + ' kbps' : '--';
          if (secureKeyRateEl) {
            const rateText = results.secureKeyRate !== null ? results.secureKeyRate.toFixed(2) : '--';
            secureKeyRateEl.textContent = rateText + ' kbps';
            // Color code based on performance
            if (results.secureKeyRate > 0) {
              secureKeyRateEl.style.color = 'var(--accent-tertiary)';
            } else {
              secureKeyRateEl.style.color = 'var(--text-muted)';
            }
          }
          if (channelTransEl) {
            const transText = results.channelTransmittance !== null ? 
              (results.channelTransmittance * 100).toFixed(4) + '%' : '--';
            channelTransEl.textContent = transText;
          }
          
          // Update status
          const statusEl = document.getElementById('qkdStatus');
          if (statusEl) {
            if (results.secureKeyRate > 0) {
              statusEl.textContent = `✓ QKD link established with ${results.protocol} protocol`;
              statusEl.style.color = 'var(--accent-tertiary)';
            } else {
              statusEl.textContent = `✗ QBER too high for secure key generation (${results.qber.toFixed(2)}%)`;
              statusEl.style.color = 'var(--text-muted)';
            }
          }
          
          logInfo('QKD UI updated successfully', results);
        } catch (error) {
          logError('QKD calculation failed', error);
          const statusEl = document.getElementById('qkdStatus');
          if (statusEl) statusEl.textContent = 'Calculation error - check console for details';
        }
      });

      elements.constellationList?.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.type !== 'checkbox' || !target.dataset.constellation) return;
        const groupId = target.dataset.constellation;
        const enabled = target.checked;
        void handleConstellationToggle(groupId, enabled);
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

    async function loadConstellationGroup(groupId) {
      const config = getConstellationConfig(groupId);
      if (!config) {
        throw new Error(`Unknown constellation group: ${groupId}`);
      }
      if (!window.satellite) {
        throw new Error('satellite.js is required to enable constellation overlays.');
      }

      const registryEntry = state.constellations?.registry?.[groupId];
      const existing = constellationStore.get(groupId);
      if (existing && registryEntry?.hasData && Array.isArray(existing.entries) && existing.entries.length) {
        return existing;
      }

      setConstellationLoading(groupId, true);
      setConstellationStatusMessage(`Loading ${config.label}…`, 'loading');

      try {
        const response = await fetch(`/api/tles/${encodeURIComponent(groupId)}`);
        if (!response.ok) {
          let detail = response.statusText || `HTTP ${response.status}`;
          try {
            const errorPayload = await response.json();
            if (errorPayload?.detail) {
              detail = errorPayload.detail;
            }
          } catch (error) {
            /* ignore parse errors */
          }
          throw new Error(detail);
        }

        const payload = await response.json();
        const satLib = window.satellite;
        const entries = [];
        const seen = new Set();
        if (Array.isArray(payload?.tles)) {
          payload.tles.forEach((tle, idx) => {
            try {
              const satrec = satLib.twoline2satrec(tle.line1, tle.line2);
              if (!satrec) return;
              const satId = String(tle.norad_id ?? satrec.satnum ?? `${groupId}-${idx}`);
              if (seen.has(satId)) return;
              seen.add(satId);
              entries.push({
                id: satId,
                name: tle.name || satId,
                satrec,
                line1: tle.line1,
                line2: tle.line2,
              });
            } catch (error) {
              console.warn('Skipped invalid TLE record', error);
            }
          });
        }

        const fetchedAt = payload?.fetched_at ?? new Date().toISOString();
        constellationStore.set(groupId, {
          id: groupId,
          label: config.label,
          color: config.color,
          entries,
          fetchedAt,
        });

        setConstellationMetadata(groupId, {
          hasData: entries.length > 0,
          count: entries.length,
          fetchedAt,
        });
        setConstellationError(groupId, null);
        setConstellationStatusMessage(`Loaded ${entries.length} satellites for ${config.label}. Overlay active.`, 'ready');
        return constellationStore.get(groupId);
      } catch (error) {
        setConstellationError(groupId, error?.message ?? 'Unknown error');
        setConstellationStatusMessage(`Failed to load ${config.label}: ${error?.message ?? error}`, 'error');
        throw error;
      } finally {
        setConstellationLoading(groupId, false);
        updateConstellationToggleStates();
      }
    }

    function activeConstellationLabels(snapshot = state) {
      const registry = snapshot.constellations?.registry ?? {};
      return CONSTELLATION_GROUPS.filter((group) => registry[group.id]?.enabled).map((group) => group.label);
    }

    function forceConstellationRefresh() {
      if (!hasActiveConstellations()) {
        clearAllConstellations();
        return;
      }
      if (!Array.isArray(state.computed?.dataPoints) || !state.computed.dataPoints.length) {
        return;
      }
      const index = clamp(state.time.index, 0, state.computed.dataPoints.length - 1);
      if (!Object.keys(state.computed?.constellationPositions ?? {}).length) {
        refreshConstellationPositions();
      }
      updateConstellationVisuals(index);
      lastConstellationIndex = index;
    }

    async function handleConstellationToggle(groupId, enabled) {
      const config = getConstellationConfig(groupId);
      if (!config) return;
      if (!window.satellite) {
        setConstellationStatusMessage('satellite.js is required to enable constellation overlays.', 'error');
        updateConstellationToggleStates();
        return;
      }

      if (enabled) {
        try {
          const dataset = await loadConstellationGroup(groupId);
          setConstellationEnabled(groupId, true);
          refreshConstellationPositions({ force: true });
          updateConstellationToggleStates();
          const count = dataset?.entries?.length ?? state.constellations?.registry?.[groupId]?.count ?? 0;
          const labels = activeConstellationLabels();
          const suffix = labels.length > 1 ? `Active overlays: ${labels.join(', ')}.` : `${config.label} overlay active.`;
          setConstellationStatusMessage(`Loaded ${count} satellites for ${config.label}. ${suffix}`, 'ready');
          forceConstellationRefresh();
        } catch (error) {
          console.error('Constellation enable failed', error);
          setConstellationEnabled(groupId, false);
          const checkbox = elements.constellationList?.querySelector(`input[data-constellation="${groupId}"]`);
          if (checkbox) checkbox.checked = false;
        } finally {
          updateConstellationToggleStates();
        }
      } else {
        setConstellationEnabled(groupId, false);
        clearConstellation2D(groupId);
        clearConstellation3D(groupId);
        refreshConstellationPositions({ force: true });
        updateConstellationToggleStates();
        if (!hasActiveConstellations()) {
          setConstellationStatusMessage('Select constellations to overlay on the map and globe.', 'idle');
          lastConstellationIndex = -1;
        } else {
          const labels = activeConstellationLabels();
          setConstellationStatusMessage(`Overlay active: ${labels.join(', ')}`, 'ready');
        }
        forceConstellationRefresh();
      }
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
      let constellationPositions = {};
      if (hasActiveConstellations() && window.satellite) {
        const datasets = getActiveConstellationDatasets();
        if (datasets.length) {
          constellationPositions = computeConstellationPositions(
            orbitData.timeline,
            state.epoch,
            datasets,
          );
        }
      }
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
        constellationPositions,
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
      lastConstellationIndex = -1;
      if (hasActiveConstellations()) {
        forceConstellationRefresh();
      }
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
      if (hasActiveConstellations()) {
        if (state.time.index !== lastConstellationIndex) {
          if (!Object.keys(state.computed?.constellationPositions ?? {}).length) {
            refreshConstellationPositions();
          }
          updateConstellationVisuals(index);
          lastConstellationIndex = state.time.index;
        }
      } else if (lastConstellationIndex !== -1) {
        clearAllConstellations();
      }
      renderOrbitMessages();
    }

    function computeFootprint(altitudeKm) {
      if (!Number.isFinite(altitudeKm) || altitudeKm <= 0) return 0;
      const r = EARTH_RADIUS_KM;
      return Math.sqrt((r + altitudeKm) ** 2 - r ** 2);
    }

    function updateConstellationVisuals(targetIndex = null) {
      if (!hasActiveConstellations()) {
        clearAllConstellations();
        return;
      }
      const timeline = state.time.timeline ?? [];
      if (!timeline.length) {
        clearAllConstellations();
        return;
      }
      const registry = state.constellations?.registry ?? {};
      const index = clamp(
        targetIndex == null ? state.time.index : targetIndex,
        0,
        timeline.length - 1,
      );
      const positionMap = state.computed?.constellationPositions ?? {};

      CONSTELLATION_GROUPS.forEach((group) => {
        if (!registry[group.id]?.enabled) {
          clearConstellation2D(group.id);
          clearConstellation3D(group.id);
          return;
        }

        const groupPayload = positionMap[group.id];
        if (!groupPayload || !Array.isArray(groupPayload.satellites)) {
          clearConstellation2D(group.id);
          clearConstellation3D(group.id);
          return;
        }

        const markers = [];
        groupPayload.satellites.forEach((satellite) => {
          const snapshot = satellite?.timeline?.[index];
          if (!snapshot) return;
          if (!Number.isFinite(snapshot.lat) || !Number.isFinite(snapshot.lon)) return;
          markers.push({
            id: satellite.id,
            name: satellite.name,
            lat: snapshot.lat,
            lon: snapshot.lon,
            alt: snapshot.alt,
            rEci: snapshot.rEci,
          });
        });

        if (markers.length) {
          renderConstellations2D(group.id, markers, { color: groupPayload.color });
          renderConstellations3D(group.id, markers, { color: groupPayload.color });
        } else {
          clearConstellation2D(group.id);
          clearConstellation3D(group.id);
        }
      });
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

      updateConstellationToggleStates(snapshot);

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
      // create collapsible panels for each section (guarded)
      try {
        if (typeof createPanelAccordions === 'function') {
          createPanelAccordions();
        } else {
          console.warn('createPanelAccordions not available');
        }
      } catch (e) {
        console.warn('Error while initializing accordions', e);
      }
      bindEvents();
      hasMapBeenFramed = false;
      hasSceneBeenFramed = false;

      mapInstance = initMap(elements.mapContainer);
      setBaseLayer(currentMapStyle);
      await initScene(elements.threeContainer);
      // restore saved optimization points from localStorage
      try {
        const raw = localStorage.getItem('qkd:optimizationPoints');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length) {
            mutate((draft) => { draft.optimizationPoints = parsed; });
            // add markers for each point
            if (elements.addOptimizationMarker) {
              parsed.forEach((pt) => {
                try { elements.addOptimizationMarker(pt.lat, pt.lon); } catch (e) { /* ignore */ }
              });
              if (elements.renderPointsList) elements.renderPointsList();
            }
          }
        }
      } catch (err) {
        console.warn('Could not restore optimization points', err);
      }
      initializeCharts();
      applyTheme(state.theme);

      await loadStationsFromServer();
      refreshStationSelect();
      await recomputeOrbit(true);
      subscribe(onStateChange, false);
      // persist optimization points on each state change (debounced-ish via animation frame)
      let persistRaf = null;
      subscribe(() => {
        if (persistRaf) cancelAnimationFrame(persistRaf);
        persistRaf = requestAnimationFrame(() => {
          try {
            const data = state.optimizationPoints || [];
            localStorage.setItem('qkd:optimizationPoints', JSON.stringify(data));
          } catch (e) {
            console.warn('Could not persist optimization points', e);
          }
        });
      }, false);
      playingRaf = requestAnimationFrame(playbackLoop);
      if (mapInstance) {
        setTimeout(() => invalidateMap(), 400);
      }
    }

    initialize();

    module.exports = {};

  });
  require('main');
})();
