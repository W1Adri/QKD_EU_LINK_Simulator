import { DEG2RAD } from './utils.js';

let BABYLON;
let engine;
let scene;
let camera;
let orbitLine;
let satelliteMesh;
let linkLine;
let earthMesh;
let atmosphereMesh;
const stationMeshes = new Map();
let resizeObserver;

const EARTH_RADIUS_UNITS = 1;
const ALT_SCALE = 1 / 4000;

async function ensureBabylon() {
  if (BABYLON) return BABYLON;
  try {
    BABYLON = await import('https://cdn.jsdelivr.net/npm/babylonjs@6.18.0/+esm');
    return BABYLON;
  } catch (error) {
    console.error('No se pudo cargar Babylon.js', error);
    throw error;
  }
}

function latLonToVector(latDeg, lonDeg, altKm = 0) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const radius = EARTH_RADIUS_UNITS + altKm * ALT_SCALE;
  const cosLat = Math.cos(lat);
  return new BABYLON.Vector3(
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    radius * cosLat * Math.sin(lon),
  );
}

function createEarth(sceneInstance) {
  const material = new BABYLON.StandardMaterial('earthMat', sceneInstance);
  material.diffuseTexture = new BABYLON.Texture(
    'https://cdn.jsdelivr.net/gh/pmndrs/drei-assets/textures/earth-day.jpg',
    sceneInstance,
    true,
    false,
    BABYLON.Texture.BILINEAR_SAMPLINGMODE,
  );
  material.specularTexture = new BABYLON.Texture(
    'https://cdn.jsdelivr.net/gh/pmndrs/drei-assets/textures/earth-specular.png',
    sceneInstance,
  );
  material.emissiveTexture = new BABYLON.Texture(
    'https://cdn.jsdelivr.net/gh/pmndrs/drei-assets/textures/earth-night.jpg',
    sceneInstance,
  );
  material.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.35);
  material.specularPower = 24;

  const sphere = BABYLON.MeshBuilder.CreateSphere('earth', { diameter: EARTH_RADIUS_UNITS * 2, segments: 96 }, sceneInstance);
  sphere.material = material;

  const atmosphereMaterial = new BABYLON.StandardMaterial('atmosphere', sceneInstance);
  atmosphereMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.7, 1.0);
  atmosphereMaterial.alpha = 0.12;
  atmosphereMaterial.backFaceCulling = false;

  const atmosphere = BABYLON.MeshBuilder.CreateSphere(
    'atmosphere',
    { diameter: EARTH_RADIUS_UNITS * 2 * 1.03, segments: 64 },
    sceneInstance,
  );
  atmosphere.material = atmosphereMaterial;

  return { sphere, atmosphere };
}

function createSatellite(sceneInstance) {
  const material = new BABYLON.StandardMaterial('satMat', sceneInstance);
  material.diffuseColor = new BABYLON.Color3(1, 0.66, 0.28);
  material.emissiveColor = new BABYLON.Color3(1, 0.54, 0.2);
  const mesh = BABYLON.MeshBuilder.CreateSphere('satellite', { diameter: 0.05, segments: 24 }, sceneInstance);
  mesh.material = material;
  return mesh;
}

function ensureLinkLine(points = [BABYLON.Vector3.Zero(), BABYLON.Vector3.Zero()]) {
  if (!scene) return;
  if (linkLine) {
    BABYLON.MeshBuilder.CreateLines(null, { points, instance: linkLine });
    return;
  }
  linkLine = BABYLON.MeshBuilder.CreateLines(
    'link',
    { points, updatable: true },
    scene,
  );
  linkLine.color = new BABYLON.Color3(0.22, 0.74, 0.97);
  linkLine.alpha = 0.9;
}

function updateOrbitMesh(points) {
  if (!scene) return;
  if (orbitLine) {
    orbitLine.dispose();
    orbitLine = null;
  }
  orbitLine = BABYLON.MeshBuilder.CreateLines('orbit', { points }, scene);
  orbitLine.color = new BABYLON.Color3(0.49, 0.23, 0.93);
  orbitLine.alpha = 0.85;
}

function handleResize() {
  if (!engine) return;
  engine.resize();
}

export async function initScene(container) {
  if (!container) return null;
  const fallback = container.querySelector('#threeFallback');
  try {
    await ensureBabylon();
  } catch (error) {
    if (fallback) {
      fallback.hidden = false;
      fallback.textContent = 'No se pudo cargar el motor 3D. Comprueba la conexión e inténtalo de nuevo.';
    }
    return null;
  }

  if (fallback) fallback.hidden = true;

  let canvas = container.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    container.appendChild(canvas);
  }

  engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(2 / 255, 6 / 255, 23 / 255, 1);

  camera = new BABYLON.ArcRotateCamera(
    'camera',
    -Math.PI / 2.2,
    Math.PI / 2.4,
    3.2,
    BABYLON.Vector3.Zero(),
    scene,
  );
  camera.lowerRadiusLimit = 1.4;
  camera.upperRadiusLimit = 8;
  camera.wheelPrecision = 80;
  camera.panningSensibility = 0;
  camera.attachControl(canvas, true);

  const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.7;
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -0.3, -1), scene);
  sun.position = new BABYLON.Vector3(6, 3, 6);
  sun.intensity = 1.2;

  const { sphere, atmosphere } = createEarth(scene);
  earthMesh = sphere;
  atmosphereMesh = atmosphere;

  satelliteMesh = createSatellite(scene);
  satelliteMesh.position = new BABYLON.Vector3(0, EARTH_RADIUS_UNITS + 0.1, 0);

  ensureLinkLine();

  scene.onBeforeRenderObservable.add(() => {
    if (earthMesh) earthMesh.rotate(BABYLON.Axis.Y, 0.0005);
    if (atmosphereMesh) atmosphereMesh.rotate(BABYLON.Axis.Y, 0.0007);
  });

  if (typeof ResizeObserver !== 'undefined') {
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => handleResize());
    }
    resizeObserver.observe(container);
  }
  window.addEventListener('resize', handleResize);

  engine.runRenderLoop(() => {
    if (scene) scene.render();
  });

  handleResize();
  return { scene, camera };
}

export function setTheme(theme) {
  if (!scene || !BABYLON) return;
  if (theme === 'dark') {
    scene.clearColor = new BABYLON.Color4(2 / 255, 6 / 255, 23 / 255, 1);
  } else {
    scene.clearColor = new BABYLON.Color4(0.94, 0.96, 0.99, 1);
  }
}

export function updateOrbitPath(track) {
  if (!scene || !BABYLON || !track?.length) return;
  const points = track.map((point) => latLonToVector(point.lat, point.lon, point.alt ?? 0));
  if (points.length > 1) {
    points.push(points[0]);
  }
  updateOrbitMesh(points);
}

export function updateSatellite(point) {
  if (!satelliteMesh || !BABYLON || !point) return;
  const position = latLonToVector(point.lat, point.lon, point.alt ?? 0);
  satelliteMesh.position.copyFrom(position);
}

export function updateLink(satPoint, station) {
  if (!BABYLON) return;
  if (!satPoint || !station) {
    ensureLinkLine([BABYLON.Vector3.Zero(), BABYLON.Vector3.Zero()]);
    return;
  }
  const sat = latLonToVector(satPoint.lat, satPoint.lon, satPoint.alt ?? 0);
  const ground = latLonToVector(station.lat, station.lon, 0.01);
  ensureLinkLine([ground, sat]);
}

export function renderStations(stations, selectedId) {
  if (!scene || !BABYLON) return;
  const activeIds = new Set();
  stations.forEach((station) => {
    activeIds.add(station.id);
    if (!stationMeshes.has(station.id)) {
      const mesh = BABYLON.MeshBuilder.CreateSphere(
        `station-${station.id}`,
        { diameter: 0.04, segments: 16 },
        scene,
      );
      const mat = new BABYLON.StandardMaterial(`stationMat-${station.id}`, scene);
      mesh.material = mat;
      stationMeshes.set(station.id, mesh);
    }
    const mesh = stationMeshes.get(station.id);
    const mat = mesh.material;
    mesh.position = latLonToVector(station.lat, station.lon, 0.01);
    if (station.id === selectedId) {
      mat.diffuseColor = new BABYLON.Color3(0.98, 0.84, 0.17);
      mat.emissiveColor = new BABYLON.Color3(0.96, 0.76, 0.11);
    } else {
      mat.diffuseColor = new BABYLON.Color3(0.14, 0.65, 0.92);
      mat.emissiveColor = new BABYLON.Color3(0.09, 0.55, 0.85);
    }
  });

  Array.from(stationMeshes.entries()).forEach(([id, mesh]) => {
    if (!activeIds.has(id)) {
      mesh.dispose();
      stationMeshes.delete(id);
    }
  });
}

export function disposeScene() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  window.removeEventListener('resize', handleResize);
  stationMeshes.forEach((mesh) => mesh.dispose());
  stationMeshes.clear();
  orbitLine?.dispose();
  linkLine?.dispose();
  satelliteMesh?.dispose();
  earthMesh?.dispose();
  atmosphereMesh?.dispose();
  engine?.dispose();
  engine = null;
  scene = null;
  camera = null;
  orbitLine = null;
  linkLine = null;
  satelliteMesh = null;
  earthMesh = null;
  atmosphereMesh = null;
}
