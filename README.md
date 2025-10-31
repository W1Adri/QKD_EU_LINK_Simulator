## QKD Europe Planner

FastAPI application with two interactive views:

* **/orbit3d** - 3D orbit designer powered by Three.js.
* **/** - 2D Leaflet map for ground-track visualization and OGS management.

### Run the project

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Start the development server:
   ```bash
   python run_app.py
   ```
3. Open `http://127.0.0.1:8000/`.

### Orbit Designer 3D (/orbit3d)

* Sliders and numeric inputs for orbital parameters `a, e, i, RAAN, argp, M0` plus satellite aperture.
* Time controls with play, pause, step and scrubber (single active orbit at all times).
* Live telemetry: perigee/apogee, speed, time horizon and aperture.
* **Close track** option: finds resonant orbits (N orbits vs N Earth rotations), adjusts `a` automatically and reports the relative error (ppm) if the resonance cannot be reached.
* Save orbits to `localStorage` (including `sat.aperture_m`).

### 2D Map (/)

* Same parameter panel as the 3D view with real-time ground-track updates.
* Ground-track sampling based on time with GMST per sample, anti-meridian segmentation and selectable number of revolutions or repeat-track mode.
* Synchronized satellite marker, play/pause/step controls and scrubber.
* Import orbits from `localStorage` (prompts for revolutions or repeat mode) and clears previous tracks automatically.
* **Create OGS mode**: click on the map to add stations with configurable aperture; stations are stored through `/api/ogs` and tooltips show aperture values.
* **Clear OGS** deletes all stations through `/api/ogs`.

### Geographic data

The European Union outline is derived from Natural Earth shapefiles filtered and dissolved with mapshaper (`filter`, `simplify`, `dissolve`).

### Minimal API

* `GET /api/ogs` - list stations (includes `aperture_m`).
* `POST /api/ogs` - create a station inside the Europe bounding box.
* `DELETE /api/ogs` - remove all stations.
