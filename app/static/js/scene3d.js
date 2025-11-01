import { constants as orbitConstants, stationEcef } from './orbit.js';

const { EARTH_RADIUS_KM } = orbitConstants;
const UNIT_SCALE = 1 / EARTH_RADIUS_KM;
const THREE_EXAMPLES_BASE = 'https://raw.githubusercontent.com/mrdoob/three.js/r158/examples/textures/planets/';
const EARTH_TEXTURE_URL = `${THREE_EXAMPLES_BASE}earth_atmos_2048.jpg`;
const EARTH_SPECULAR_URL = `${THREE_EXAMPLES_BASE}earth_specular_2048.jpg`;
const EARTH_BUMP_URL = `${THREE_EXAMPLES_BASE}earth_normal_2048.jpg`;

let THREE;
let OrbitControls;
let threePromise;

let containerEl;
let canvasEl;
let fallbackEl;
let renderer;
let scene;
let camera;
let controls;
let earthGroup;
let earthMesh;
let atmosphereMesh;
let orbitLine;
let satelliteMesh;
let stationGroup;
let linkLine;
let resizeObserver;
let isReady = false;

const stationMeshes = new Map();

function ensureThree() {
  if (!threePromise) {
    threePromise = Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
    ]).then(([threeModule, controlsModule]) => {
      THREE = threeModule;
      OrbitControls = controlsModule.OrbitControls;
    });
  }
  return threePromise;
}

function toVector3(arr) {
  if (!THREE) return null;
  return new THREE.Vector3(arr[0] * UNIT_SCALE, arr[1] * UNIT_SCALE, arr[2] * UNIT_SCALE);
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(url, resolve, undefined, reject);
  });
}

async function buildEarth() {
  const geometry = new THREE.SphereGeometry(1, 96, 96);
  const material = new THREE.MeshPhongMaterial({
    color: 0x4060ff,
    shininess: 8,
    specular: new THREE.Color(0x333333),
  });

  try {
    const [diffuse, specular, bump] = await Promise.all([
      loadTexture(EARTH_TEXTURE_URL),
      loadTexture(EARTH_SPECULAR_URL),
      loadTexture(EARTH_BUMP_URL),
    ]);
    diffuse.colorSpace = THREE.SRGBColorSpace;
    material.map = diffuse;
    material.specularMap = specular;
    material.bumpMap = bump;
    material.bumpScale = 0.02;
    material.needsUpdate = true;
  } catch (error) {
    // Textures are optional; keep procedural material if they fail.
    console.warn('Fallo al cargar texturas del planeta:', error);
  }

  earthMesh = new THREE.Mesh(geometry, material);
  earthMesh.name = 'Earth';

  const glowGeometry = new THREE.SphereGeometry(1.015, 64, 64);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x3388ff,
    transparent: true,
    opacity: 0.16,
    side: THREE.BackSide,
  });
  atmosphereMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  atmosphereMesh.name = 'Atmosphere';

  earthGroup = new THREE.Group();
  earthGroup.add(earthMesh);
  earthGroup.add(atmosphereMesh);
  return earthGroup;
}

function setupRenderer() {
  if (!containerEl) {
    throw new Error('No existe contenedor para inicializar el renderizador.');
  }
  if (!canvasEl) {
    throw new Error('No se encontró el canvas exclusivo para la vista 3D.');
  }

  canvasEl.classList.remove('is-hidden');
  canvasEl.setAttribute('aria-hidden', 'false');

  const width = Math.max(containerEl.clientWidth, 1);
  const height = Math.max(containerEl.clientHeight, 1);
  if (canvasEl.width !== width || canvasEl.height !== height) {
    canvasEl.width = width;
    canvasEl.height = height;
  }

  const contextAttributes = {
    alpha: true,
    antialias: true,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  };

  let gl = canvasEl.getContext('webgl2', contextAttributes);
  if (!gl) {
    gl =
      canvasEl.getContext('webgl', contextAttributes) ||
      canvasEl.getContext('experimental-webgl', contextAttributes);
  }

  if (!gl) {
    throw new Error('No se pudo obtener un contexto WebGL del canvas.');
  }

  renderer = new THREE.WebGLRenderer({
    canvas: canvasEl,
    context: gl,
    antialias: true,
    alpha: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0x0f172a, 1);

  canvasEl.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    showFallback('Se perdió el contexto WebGL. Recarga la página para reiniciar la vista 3D.');
    isReady = false;
  });
}

function setupCamera() {
  const width = Math.max(containerEl.clientWidth, 1);
  const height = Math.max(containerEl.clientHeight, 1);
  camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 50);
  camera.position.set(0, 2.6, 4.4);
}

function setupControls() {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 1.2;
  controls.maxDistance = 10;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.target.set(0, 0, 0);
}

function setupLights() {
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(5, 3, 2);
  const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.4);
  rimLight.position.set(-3, -2, -4);
  scene.add(ambient, keyLight, rimLight);
}

function setupSceneGraph() {
  orbitLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x7c3aed, linewidth: 2 })
  );
  orbitLine.visible = false;

  linkLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.05, gapSize: 0.025 })
  );
  linkLine.visible = false;

  const satMaterial = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    emissive: 0x9a3412,
    metalness: 0.2,
    roughness: 0.4,
  });
  satelliteMesh = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 16), satMaterial);
  satelliteMesh.visible = false;

  stationGroup = new THREE.Group();

  scene.add(orbitLine, linkLine, satelliteMesh, stationGroup);
}

function onResize() {
  if (!renderer || !camera || !containerEl) return;
  const width = Math.max(containerEl.clientWidth, 1);
  const height = Math.max(containerEl.clientHeight, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function startRendering() {
  if (!renderer) return;
  renderer.setAnimationLoop(() => {
    if (earthMesh) {
      earthMesh.rotation.y += 0.00025;
      if (atmosphereMesh) {
        atmosphereMesh.rotation.y += 0.0002;
      }
    }
    controls?.update();
    renderer.render(scene, camera);
  });
}

function ensureStationMesh(station) {
  if (!stationMeshes.has(station.id)) {
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x082f49,
      metalness: 0.1,
      roughness: 0.8,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.025, 14, 14), baseMaterial);
    mesh.name = `station-${station.id}`;
    stationGroup.add(mesh);
    stationMeshes.set(station.id, mesh);
  }
  return stationMeshes.get(station.id);
}

function clearStations(exceptIds) {
  Array.from(stationMeshes.keys()).forEach((id) => {
    if (!exceptIds.has(id)) {
      const mesh = stationMeshes.get(id);
      stationGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      stationMeshes.delete(id);
    }
  });
}

function hideFallback() {
  if (fallbackEl) {
    fallbackEl.hidden = true;
  }
  if (canvasEl) {
    canvasEl.classList.remove('is-hidden');
    canvasEl.setAttribute('aria-hidden', 'false');
  }
}

function showFallback(message) {
  if (fallbackEl) {
    fallbackEl.textContent = message || 'No se pudo inicializar la escena 3D.';
    fallbackEl.hidden = false;
  }
  if (canvasEl) {
    canvasEl.classList.add('is-hidden');
    canvasEl.setAttribute('aria-hidden', 'true');
  }
}

export async function initScene(container) {
  containerEl = container;
  canvasEl = container?.querySelector('#threeCanvas');
  fallbackEl = container?.querySelector('#threeFallback');
  if (!containerEl) return;
  if (!canvasEl) {
    console.error('No se encontró el canvas threeCanvas dentro del contenedor 3D.');
    showFallback('No se pudo inicializar la vista 3D. Falta el canvas dedicado.');
    return;
  }
  if (isReady) {
    onResize();
    return;
  }

  try {
    await ensureThree();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);

    setupRenderer();
    setupCamera();
    setupControls();
    setupLights();

    const earth = await buildEarth();
    scene.add(earth);
    setupSceneGraph();

    onResize();
    resizeObserver = new ResizeObserver(() => onResize());
    resizeObserver.observe(containerEl);
    window.addEventListener('resize', onResize);

    hideFallback();
    startRendering();
    isReady = true;
  } catch (error) {
    console.error('Error inicializando la vista 3D', error);
    showFallback('No se pudo inicializar la vista 3D. Comprueba la compatibilidad WebGL.');
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
  const vectors = points.map((p) => toVector3(p.rEcef));
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
    scene.background.setHex(0x0f172a);
    renderer.setClearColor(0x0f172a, 1);
  } else {
    scene.background.setHex(0xf8fafc);
    renderer.setClearColor(0xf8fafc, 1);
  }
}

export function disposeScene() {
  if (resizeObserver && containerEl) {
    resizeObserver.unobserve(containerEl);
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  window.removeEventListener('resize', onResize);
  if (renderer) {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    if (typeof renderer.forceContextLoss === 'function') {
      renderer.forceContextLoss();
    }
  }
  stationMeshes.clear();
  renderer = null;
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
  isReady = false;
  canvasEl = null;
}
