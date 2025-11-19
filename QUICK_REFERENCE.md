# QKD EU LINK Simulator - Quick Reference Guide

## Getting Started

### 1. Launch the Application
```bash
pip install -r requirements.txt
python run_app.py
```
Access at `http://127.0.0.1:8000/`

### 2. Interface Overview

The simulator has **7 main panels** accessible from the top navigation:

#### 🛰️ **Orbit Panel**
Configure satellite orbital parameters and search for resonant orbits.

**Key Parameters:**
- Semi-major axis (6538-42164 km)
- Eccentricity (0-0.2)
- Inclination (0-180°)
- RAAN, Argument of Perigee, Mean Anomaly (0-360°)

**Resonance Search:**
- Define j:k ratio (Earth rotations : Satellite orbits)
- Set tolerance for semi-major axis matching
- Click "Search Resonances" to find optimal orbits

#### 🔭 **Optics Panel**
Set telescope parameters for the optical link.

**Parameters:**
- Satellite aperture: 0.1-3 m (larger = less divergence)
- Ground aperture: 0.1-5 m (larger = more photons collected)
- Wavelength: 600-1700 nm (typically 810 nm for QKD)
- Samples per orbit: 60-720 (affects calculation detail)

#### 📍 **Stations Panel**
Manage optical ground stations.

**Actions:**
- **Add**: Create new ground station with coordinates
- **Delete**: Remove selected station
- **Focus**: Center map on station
- Set turbulence parameters (Cn² day/night)

#### 📊 **Analytics Panel**
View real-time link performance metrics.

**Current Metrics:**
- Link Loss (dB)
- Elevation Angle (°)
- Range (km)
- Zenith Angle (°)
- Doppler Shift (Hz)
- Fried Parameter r₀ (m)
- Greenwood Frequency (Hz)
- Isoplanatic Angle (arcsec)

**Time-Series Plots:** Click any metric to see evolution over time

#### 🌥️ **Atmosphere Panel**
Choose turbulence model and fetch weather data.

**Models:**
1. **Hufnagel-Valley 5/7**: General-purpose, uses surface Cn² + wind
2. **Bufton Boundary-Layer**: Better for low-altitude turbulence
3. **Greenwood Lidar-Inspired**: Focused on adaptive optics bandwidth

**Weather Integration:**
- Fetch real-time atmospheric data from Open-Meteo
- Select pressure level (200-850 hPa)
- Visualize on map

#### 🔐 **QKD Panel**
Calculate quantum key distribution performance.

**Protocols:**
- **BB84**: Prepare-and-measure with weak coherent pulses
- **E91**: Entanglement-based with Bell states
- **CV-QKD**: Continuous variable with homodyne detection

**Parameters:**
- Photon Rate: 1-1000 MHz
- Detector Efficiency: 0-100% (typically 65%)
- Dark Count Rate: 0-10,000 Hz (typically 100 Hz)

**Click "Calculate QKD Performance"** to see:
- QBER (Quantum Bit Error Rate) %
- Raw Key Rate (kbps)
- Secure Key Rate (kbps)
- Channel Transmittance %

#### ❓ **Help Panel**
Comprehensive documentation with topics:
- Overview & Quick Start
- Orbital Mechanics
- Resonance Logic
- Optical Links
- Atmospheric Models
- QKD Theory
- Backend API
- Troubleshooting

---

## Quick Workflow

### Scenario: Plan QKD Link from Satellite to Madrid

1. **Configure Orbit (Orbit Panel)**
   ```
   Semi-major axis: 6771 km (400 km altitude)
   Eccentricity: 0.001 (nearly circular)
   Inclination: 53° (good European coverage)
   ```

2. **Add Ground Station (Stations Panel)**
   ```
   Name: Madrid OGS
   Latitude: 40.4168°
   Longitude: -3.7038°
   Aperture: 1.0 m
   ```

3. **Set Optical Parameters (Optics Panel)**
   ```
   Satellite aperture: 0.6 m
   Ground aperture: 1.0 m
   Wavelength: 810 nm
   ```

4. **Choose Atmospheric Model (Atmosphere Panel)**
   ```
   Select: Hufnagel-Valley 5/7
   (Most common for planning)
   ```

5. **Run Simulation**
   - Use timeline controls at bottom
   - Press ▶ to play
   - Watch satellite pass over station

6. **Calculate QKD Performance (QKD Panel)**
   ```
   Protocol: BB84
   Photon Rate: 100 MHz
   Detector Efficiency: 65%
   Dark Count Rate: 100 Hz
   Click: "Calculate QKD Performance"
   ```

7. **Analyze Results (Analytics Panel)**
   - Check elevation angle (need >30° for good link)
   - View link loss (should be <40 dB for QKD)
   - Secure key rate >0 means link is viable

---

## Tips & Tricks

### Optimizing QKD Performance

✅ **Good for QKD:**
- High elevation angles (>30°)
- Low atmospheric turbulence (high r₀)
- Low link loss (<30 dB)
- High detector efficiency
- Low dark count rate

❌ **Challenging for QKD:**
- Low elevation (<20°)
- Heavy turbulence (low r₀)
- High link loss (>40 dB)
- Poor detector efficiency
- High background light (high dark counts)

### Understanding QBER Thresholds

| Protocol | Max QBER | Typical Performance |
|----------|----------|---------------------|
| BB84     | ~11%     | Robust, well-tested |
| E91      | ~15%     | Tolerates more noise|
| CV-QKD   | Varies   | Sensitive to loss   |

### Link Loss Estimates

| Scenario | Typical Loss | QKD Feasible? |
|----------|--------------|---------------|
| LEO, zenith, clear | 25-35 dB | ✅ Yes |
| LEO, 30° elev, clear | 35-45 dB | ⚠️ Marginal |
| LEO, 15° elev, turbulent | 45-60 dB | ❌ No |
| MEO, zenith | 40-50 dB | ⚠️ Difficult |

### Keyboard Shortcuts

- **Space**: Play/Pause simulation
- **←/→**: Step backward/forward
- **R**: Reset time
- **F**: Toggle fullscreen (when implemented)
- **T**: Toggle theme

---

## Troubleshooting

### Problem: "Weather data fetch failed"
**Solution:** 
- Check internet connection
- Wait a few minutes (API rate limit)
- Use fallback turbulence parameters

### Problem: "3D view not rendering"
**Solution:**
- Enable WebGL in browser settings
- Update graphics drivers
- Try different browser (Chrome recommended)

### Problem: "QKD calculation returns zero"
**Solution:**
- Check if satellite is above horizon
- Verify link loss is reasonable (<50 dB)
- Reduce dark count rate
- Increase detector efficiency
- Choose higher elevation pass

### Problem: "Secure key rate is zero despite low loss"
**Solution:**
- QBER may be too high
- Check detector parameters
- Verify photon rate is adequate
- Try E91 protocol (tolerates higher QBER)

---

## Advanced Features

### Resonance Optimization
Find orbits with repeating ground tracks:
1. Set target semi-major axis
2. Define search bounds for j and k
3. Click "Search Resonances"
4. Select best j:k ratio from results

### Walker Constellations
Design multi-satellite coverage:
1. Switch mode to "Constellation"
2. Set T (total satellites), P (planes), F (phasing)
3. Visualize coverage patterns

### Weather Layer Visualization
Overlay meteorological data:
1. Select atmospheric parameter
2. Choose pressure level
3. Set number of samples
4. Click "Fetch Field"
5. View interpolated data on map

---

## For Developers

### Console Logging
Open browser console (F12) to see detailed logs:
- 🔵 **[INFO]**: General information
- 🟡 **[WARN]**: Warnings
- 🔴 **[ERROR]**: Errors with stack traces
- 🔷 **[CHECKPOINT]**: Key execution points

### API Endpoints
- `GET /api/ogs`: List ground stations
- `POST /api/ogs`: Create station
- `DELETE /api/ogs`: Remove all stations
- `GET /api/tles/{group}`: Fetch TLE data
- `GET /api/weather`: Query atmospheric fields

### Extending QKD Module
Add new protocols by:
1. Create function in `qkdCalculations` module
2. Add protocol to selector in UI
3. Update routing in `calculateQKDPerformance()`

---

## Support & Resources

### Documentation
- In-app Help panel has full documentation
- `RESTRUCTURE_CHANGELOG.md` for technical details
- `README.md` for installation instructions

### References
- BB84 Protocol: Bennett & Brassard, 1984
- E91 Protocol: Ekert, 1991
- Link Budget: Satellite Communications textbooks
- Turbulence Models: Hufnagel 1974, Bufton 1979, Greenwood 1977

### Citation
If using this simulator in research, please cite:
```
QKD EU LINK Simulator v2.0
Quantum Key Distribution Satellite Link Planner
https://github.com/W1Adri/QKD_EU_LINK_Simulator
```

---

**Last Updated:** November 19, 2025
**Version:** 2.0.0
**License:** [Specify license]

