import { DEG2RAD } from './utils.js';

const THREE_CDN = 'https://unpkg.com/three@0.158.0/build/three.min.js';
const CONTROLS_CDN = 'https://unpkg.com/three@0.158.0/examples/js/controls/OrbitControls.js';
const DAYMAP_URL = 'https://cdn.jsdelivr.net/gh/pmndrs/drei-assets/textures/earth-day.jpg';
const NIGHTMAP_URL = 'https://cdn.jsdelivr.net/gh/pmndrs/drei-assets/textures/earth-night.jpg';
const SPECULAR_URL = 'https://cdn.jsdelivr.net/gh/pmndrs/drei-assets/textures/earth-specular.png';

let THREE = null;
let renderer;
let scene;
let camera;
let controls;
let orbitLine;
let linkLine;
let orbitGeometry;
let orbitMaterial;
let linkGeometry;
let linkMaterial;
let satelliteMesh;
let earthMesh;
let atmosphereMesh;
let animationId;
let resizeObserver;
let windowResizeHandler;
const stationMeshes = new Map();

const EARTH_RADIUS_UNITS = 1;
const ALT_SCALE = 1 / 4000;

let threePromise;
let controlsPromise;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = Array.from(document.getElementsByTagName('script')).find((script) => script.src === src);
    if (existing && existing.dataset.loaded === 'true') {
      resolve();
      return;
    }
    const script = existing || document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    if (!existing) document.head.appendChild(script);
  });
}

async function ensureThree() {
  if (THREE) return THREE;
  if (!threePromise) {
    threePromise = loadScript(THREE_CDN).then(() => {
      THREE = window.THREE;
      return THREE;
    });
  }
  await threePromise;
  if (!THREE) throw new Error('THREE no disponible');
  return THREE;
}

async function ensureControls() {
  await ensureThree();
  if (window.THREE?.OrbitControls) return window.THREE.OrbitControls;
  if (!controlsPromise) {
    controlsPromise = loadScript(CONTROLS_CDN);
  }
  await controlsPromise;
  if (!window.THREE?.OrbitControls) throw new Error('OrbitControls no disponible');
  return window.THREE.OrbitControls;
}

function latLonToVector(latDeg, lonDeg, altKm = 0) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const radius = EARTH_RADIUS_UNITS + altKm * ALT_SCALE;
  const cosLat = Math.cos(lat);
  return new THREE.Vector3(
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    radius * cosLat * Math.sin(lon),
  );
}

function createRenderer(container) {
  const canvas = document.createElement('canvas');
  const rendererInstance = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  rendererInstance.setPixelRatio(window.devicePixelRatio || 1);
  rendererInstance.setSize(container.clientWidth, container.clientHeight, false);
  container.appendChild(rendererInstance.domElement);
  return rendererInstance;
}

function createEarthGroup() {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const dayTexture = loader.load(DAYMAP_URL, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
  });
  const nightTexture = loader.load(NIGHTMAP_URL, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
  });
  const specularTexture = loader.load(SPECULAR_URL);
  const material = new THREE.MeshPhongMaterial({
    map: dayTexture,
    emissiveMap: nightTexture,
    emissive: new THREE.Color(0x111133),
    specularMap: specularTexture,
    shininess: 12,
  });
  const geometry = new THREE.SphereGeometry(EARTH_RADIUS_UNITS, 128, 128);
  const mesh = new THREE.Mesh(geometry, material);

  const atmosphereMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0x6ab7ff),
    transparent: true,
    opacity: 0.14,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  const atmosphereGeometry = new THREE.SphereGeometry(EARTH_RADIUS_UNITS * 1.03, 128, 128);
  const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);

  return { mesh, atmosphere };
}

function createSatelliteMesh() {
  const geometry = new THREE.SphereGeometry(0.035, 24, 24);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xf97316),
    emissive: new THREE.Color(0xffb347),
    roughness: 0.35,
    metalness: 0.1,
  });
  return new THREE.Mesh(geometry, material);
}

function ensureOrbitResources() {
  if (!orbitGeometry) {
    orbitGeometry = new THREE.BufferGeometry();
  }
  if (!orbitMaterial) {
    orbitMaterial = new THREE.LineBasicMaterial({ color: 0x7c3aed, linewidth: 2, transparent: true, opacity: 0.85 });
  }
  if (!orbitLine) {
    orbitLine = new THREE.Line(orbitGeometry, orbitMaterial);
    orbitLine.frustumCulled = false;
    scene.add(orbitLine);
  }
}

function ensureLinkResources() {
  if (!linkGeometry) {
    linkGeometry = new THREE.BufferGeometry();
    linkGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  }
  if (!linkMaterial) {
    linkMaterial = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 });
  }
  if (!linkLine) {
    linkLine = new THREE.Line(linkGeometry, linkMaterial);
    linkLine.visible = false;
    scene.add(linkLine);
  }
}

function handleResize(container) {
  if (!renderer || !camera) return;
  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function startRenderLoop(container) {
  if (animationId) cancelAnimationFrame(animationId);
  const animate = () => {
    animationId = requestAnimationFrame(animate);
    if (earthMesh) earthMesh.rotation.y += 0.0005;
    if (atmosphereMesh) atmosphereMesh.rotation.y += 0.0007;
    controls?.update();
    renderer?.render(scene, camera);
  };
  handleResize(container);
  animate();
}

export async function initScene(container) {
  if (!container) return null;
  const fallback = container.querySelector('#threeFallback');
  try {
    await ensureThree();
    await ensureControls();
  } catch (error) {
    console.error(error);
    if (fallback) {
      fallback.hidden = false;
      fallback.textContent = 'No se pudo inicializar la vista 3D. Comprueba tu conexión e inténtalo de nuevo.';
    }
    return null;
  }

  if (fallback) fallback.hidden = true;

  const existingCanvas = container.querySelector('canvas');
  if (existingCanvas) existingCanvas.remove();

  renderer = createRenderer(container);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020617);

  camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 1.8, 3.2);

  const OrbitControls = window.THREE.OrbitControls;
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 1.25;
  controls.maxDistance = 7.5;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI * 0.1;
  controls.maxPolarAngle = Math.PI - Math.PI * 0.08;
  controls.target.set(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(5, 2.5, 4.5);
  scene.add(ambient, sun);

  const { mesh, atmosphere } = createEarthGroup();
  earthMesh = mesh;
  atmosphereMesh = atmosphere;
  atmosphereMesh.rotation.y = 0.05;
  scene.add(earthMesh, atmosphereMesh);

  satelliteMesh = createSatelliteMesh();
  scene.add(satelliteMesh);

  ensureOrbitResources();
  ensureLinkResources();

  if (!scene.getObjectByName('stationsGroup')) {
    const group = new THREE.Group();
    group.name = 'stationsGroup';
    scene.add(group);
  }

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => handleResize(container));
    resizeObserver.observe(container);
  }
  windowResizeHandler = () => handleResize(container);
  window.addEventListener('resize', windowResizeHandler);

  startRenderLoop(container);
  return { scene, camera };
}

export function setTheme(theme) {
  if (!scene || !THREE) return;
  if (theme === 'dark') {
    scene.background = new THREE.Color(0x020617);
  } else {
    scene.background = new THREE.Color(0xf0f4ff);
  }
}

export function updateOrbitPath(points) {
  if (!scene || !THREE || !points?.length) return;
  ensureOrbitResources();
  const closedPoints = [...points, points[0]];
  const positions = new Float32Array(closedPoints.length * 3);
  closedPoints.forEach((point, index) => {
    const vector = latLonToVector(point.lat, point.lon, point.alt);
    positions[index * 3] = vector.x;
    positions[index * 3 + 1] = vector.y;
    positions[index * 3 + 2] = vector.z;
  });
  orbitGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  orbitGeometry.computeBoundingSphere();
}

export function updateSatellite(point) {
  if (!satelliteMesh || !THREE || !point) return;
  const vector = latLonToVector(point.lat, point.lon, point.alt);
  satelliteMesh.position.copy(vector);
}

function stationsGroup() {
  let group = scene?.getObjectByName('stationsGroup');
  if (!group && scene) {
    group = new THREE.Group();
    group.name = 'stationsGroup';
    scene.add(group);
  }
  return group;
}

export function renderStations(stations, selectedId) {
  if (!scene || !THREE) return;
  const group = stationsGroup();
  const newIds = new Set();

  stations.forEach((station) => {
    newIds.add(station.id);
    if (!stationMeshes.has(station.id)) {
      const geometry = new THREE.SphereGeometry(0.028, 20, 20);
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x0ea5e9),
        emissive: new THREE.Color(0x1d4ed8),
        roughness: 0.4,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.stationId = station.id;
      group.add(mesh);
      stationMeshes.set(station.id, mesh);
    }
    const mesh = stationMeshes.get(station.id);
    const position = latLonToVector(station.lat, station.lon, 0.02);
    mesh.position.copy(position);
    const material = mesh.material;
    if (station.id === selectedId) {
      material.color.set(0xfacc15);
      material.emissive.set(0xfbbf24);
    } else {
      material.color.set(0x0ea5e9);
      material.emissive.set(0x1d4ed8);
    }
  });

  Array.from(stationMeshes.keys()).forEach((id) => {
    if (!newIds.has(id)) {
      const mesh = stationMeshes.get(id);
      mesh?.parent?.remove(mesh);
      mesh?.geometry?.dispose();
      mesh?.material?.dispose();
      stationMeshes.delete(id);
    }
  });
}

export function updateLink(point, station) {
  if (!scene || !THREE) return;
  ensureLinkResources();
  if (!station || !point) {
    linkLine.visible = false;
    return;
  }
  const sat = latLonToVector(point.lat, point.lon, point.alt);
  const ground = latLonToVector(station.lat, station.lon, 0.02);
  const array = linkGeometry.attributes.position.array;
  array[0] = ground.x;
  array[1] = ground.y;
  array[2] = ground.z;
  array[3] = sat.x;
  array[4] = sat.y;
  array[5] = sat.z;
  linkGeometry.attributes.position.needsUpdate = true;
  linkGeometry.computeBoundingSphere();
  linkLine.visible = true;
}

export function disposeScene() {
  cancelAnimationFrame(animationId);
  resizeObserver?.disconnect();
  if (windowResizeHandler) {
    window.removeEventListener('resize', windowResizeHandler);
    windowResizeHandler = null;
  }
  stationMeshes.forEach((mesh) => {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  stationMeshes.clear();
  orbitGeometry?.dispose();
  orbitMaterial?.dispose();
  linkGeometry?.dispose();
  linkMaterial?.dispose();
  if (renderer?.domElement?.parentElement) {
    renderer.domElement.parentElement.removeChild(renderer.domElement);
  }
  renderer?.dispose();
  scene = null;
  renderer = null;
  camera = null;
  controls = null;
  orbitLine = null;
  linkLine = null;
  orbitGeometry = null;
  orbitMaterial = null;
  linkGeometry = null;
  linkMaterial = null;
  satelliteMesh = null;
  earthMesh = null;
  atmosphereMesh = null;
}
