import { constants as orbitConstants, stationEcef } from './orbit.js';
import { EARTH_TEXTURE_BASE64 } from './earthTexture.js';

const { EARTH_RADIUS_KM } = orbitConstants;
const UNIT_SCALE = 1 / EARTH_RADIUS_KM;
const EARTH_TEXTURE_URL = `data:image/png;base64,${EARTH_TEXTURE_BASE64}`;

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
let isReady = false;

const stationMeshes = new Map();

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
        throw new Error('OrbitControls no está disponible.');
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
    fallbackEl.textContent = message || 'No se pudo inicializar la escena 3D.';
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
    showFallback('Se perdió el contexto WebGL. Recarga para reintentar.');
    isReady = false;
  });
}

function buildCamera() {
  const width = Math.max(containerEl.clientWidth, 1);
  const height = Math.max(containerEl.clientHeight, 1);
  camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 50);
  camera.position.set(0, 2.6, 4.4);
}

function buildControls() {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.2;
  controls.maxDistance = 10;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.target.set(0, 0, 0);
  controls.update();
}

function buildLights() {
  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  const sun = new THREE.DirectionalLight(0xffffff, 1.05);
  sun.position.set(5, 3, 2);
  const rim = new THREE.DirectionalLight(0x5eead4, 0.3);
  rim.position.set(-3, -2, -5);
  scene.add(ambient, sun, rim);
}

function buildEarth() {
  earthGroup = new THREE.Group();

  const earthGeometry = new THREE.SphereGeometry(1, 128, 128);
  const earthMaterial = new THREE.MeshPhongMaterial({
    color: 0x2266cc,
    specular: 0x222222,
    shininess: 20,
  });
  earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);
  earthMesh.name = 'Earth';
  earthGroup.add(earthMesh);

  const loader = new THREE.TextureLoader();
  loader.load(
    EARTH_TEXTURE_URL,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      earthMaterial.map = texture;
      earthMaterial.needsUpdate = true;
    },
    undefined,
    () => {
      // Si la textura falla se mantiene el color base.
    }
  );

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

  const satMaterial = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    emissive: 0x9a3412,
    metalness: 0.2,
    roughness: 0.4,
  });
  satelliteMesh = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 20), satMaterial);
  satelliteMesh.visible = false;

  stationGroup = new THREE.Group();

  scene.add(orbitLine, linkLine, satelliteMesh, stationGroup);
}

function startAnimation() {
  cancelAnimation();
  const renderFrame = () => {
    if (earthMesh) {
      earthMesh.rotation.y += 0.0003;
    }
    if (atmosphereMesh) {
      atmosphereMesh.rotation.y += 0.00026;
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
  return new THREE.Vector3(arr[0] * UNIT_SCALE, arr[1] * UNIT_SCALE, arr[2] * UNIT_SCALE);
}

export async function initScene(container) {
  containerEl = container;
  canvasEl = container?.querySelector('#threeCanvas');
  fallbackEl = container?.querySelector('#threeFallback');

  if (!containerEl || !canvasEl) {
    console.error('No se encontró el contenedor o el canvas para el modo 3D.');
    showFallback('Falta el lienzo 3D en la interfaz.');
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
    buildEarth();
    buildSceneGraph();

    resizeObserver = new ResizeObserver(() => resizeRenderer());
    resizeObserver.observe(containerEl);
    window.addEventListener('resize', resizeRenderer);

    startAnimation();
    isReady = true;
  } catch (error) {
    console.error('Error inicializando la vista 3D', error);
    showFallback(error?.message || 'No se pudo inicializar la vista 3D.');
  }
}

export function updateOrbitPath(points) {
  if (!isReady || !orbitLine) return;
  if (!points?.length) {
    orbitLine.visible = false;
    orbitLine.geometry.dispose();
    orbitLine.geometry = new THREE.BufferGeometry();
    return;
  }
  const vectors = points
    .map((p) => toVector3(p.rEcef))
    .filter((vec) => vec instanceof THREE.Vector3);
  if (!vectors.length) {
    orbitLine.visible = false;
    return;
  }
  if (vectors.length > 1) {
    vectors.push(vectors[0].clone());
  }
  orbitLine.geometry.dispose();
  orbitLine.geometry = new THREE.BufferGeometry().setFromPoints(vectors);
  orbitLine.visible = true;
}

export function updateSatellite(point) {
  if (!isReady || !satelliteMesh || !point) return;
  const pos = toVector3(point.rEcef);
  if (!pos) return;
  satelliteMesh.position.copy(pos);
  satelliteMesh.visible = true;
}

export function renderStations(stations, selectedId) {
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

export function updateLink(point, station) {
  if (!isReady || !linkLine) return;
  if (!point || !station) {
    linkLine.visible = false;
    return;
  }
  const sat = toVector3(point.rEcef);
  const ground = toVector3(stationEcef(station));
  if (!sat || !ground) {
    linkLine.visible = false;
    return;
  }
  linkLine.geometry.dispose();
  linkLine.geometry = new THREE.BufferGeometry().setFromPoints([ground, sat]);
  if (typeof linkLine.computeLineDistances === 'function') {
    linkLine.computeLineDistances();
  }
  linkLine.visible = true;
}

export function setTheme(nextTheme) {
  if (!scene || !renderer) return;
  if (nextTheme === 'dark') {
    scene.background.setHex(0x020617);
    renderer.setClearColor(0x020617, 1);
  } else {
    scene.background.setHex(0xf4f7fb);
    renderer.setClearColor(0xf4f7fb, 1);
  }
}

export function disposeScene() {
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

  orbitLine?.geometry?.dispose();
  orbitLine?.material?.dispose();
  linkLine?.geometry?.dispose();
  linkLine?.material?.dispose();
  earthMesh?.geometry?.dispose();
  earthMesh?.material?.dispose();
  atmosphereMesh?.geometry?.dispose();
  atmosphereMesh?.material?.dispose();

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
  containerEl = null;
  canvasEl = null;
  fallbackEl = null;
  isReady = false;
}
