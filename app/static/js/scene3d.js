import { DEG2RAD } from './utils.js';

let THREE;
let OrbitControls;

let renderer;
let scene;
let camera;
let controls;
let animationId;
let orbitLine;
let satelliteMesh;
let linkLine;
let earthGroup;
const stationMeshes = new Map();

const EARTH_RADIUS_UNITS = 1;
const ALT_SCALE = 1 / 4000; // scales km to scene units

async function ensureThree() {
  if (THREE) return;
  const module = await import('https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js');
  const controlsModule = await import('https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/controls/OrbitControls.js');
  THREE = module;
  OrbitControls = controlsModule.OrbitControls;
}

function latLonToCartesian(latDeg, lonDeg, altKm = 0) {
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

function buildEarth() {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(EARTH_RADIUS_UNITS, 64, 64);
  const textureLoader = new THREE.TextureLoader();
  const material = new THREE.MeshPhongMaterial({
    map: textureLoader.load('https://cdn.jsdelivr.net/gh/pmndrs/drei-assets/textures/earth-day.jpg'),
    specularMap: textureLoader.load('https://cdn.jsdelivr.net/gh/pmndrs/drei-assets/textures/earth-specular.png'),
    normalMap: textureLoader.load('https://cdn.jsdelivr.net/gh/pmndrs/drei-assets/textures/earth-normal.png'),
    shininess: 12,
  });
  const earth = new THREE.Mesh(geometry, material);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS_UNITS * 1.02, 64, 64),
    new THREE.MeshPhongMaterial({ color: 0x4f46e5, opacity: 0.18, transparent: true }),
  );
  group.add(earth);
  group.add(atmosphere);
  return group;
}

function buildSatellite() {
  const geometry = new THREE.SphereGeometry(0.015, 24, 24);
  const material = new THREE.MeshStandardMaterial({ color: 0xffa94d, emissive: 0xffb347, emissiveIntensity: 0.6 });
  return new THREE.Mesh(geometry, material);
}

function buildOrbitLine() {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineDashedMaterial({ color: 0x7c3aed, linewidth: 1, dashSize: 0.04, gapSize: 0.02 });
  return new THREE.Line(geometry, material);
}

function buildLinkLine() {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 1 });
  return new THREE.Line(geometry, material);
}

function animate() {
  animationId = requestAnimationFrame(animate);
  if (earthGroup) {
    earthGroup.rotation.y += 0.0004;
  }
  if (controls) controls.update();
  renderer.render(scene, camera);
}

function handleResize(container) {
  const { clientWidth, clientHeight } = container;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);
}

export async function initScene(container) {
  if (!container) return null;
  await ensureThree();

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x020617, 1);
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020617, 0.65);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(2.4, 1.6, 2.4);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 1.4;
  controls.maxDistance = 8;

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(5, 3, 5);

  earthGroup = buildEarth();
  orbitLine = buildOrbitLine();
  satelliteMesh = buildSatellite();
  linkLine = buildLinkLine();
  orbitLine.computeLineDistances();

  scene.add(ambient, directional, earthGroup, orbitLine, satelliteMesh, linkLine);

  window.addEventListener('resize', () => handleResize(container));
  handleResize(container);
  animate();
  return { scene, camera };
}

export function setTheme(theme) {
  if (!renderer) return;
  if (theme === 'dark') {
    renderer.setClearColor(0x020617, 1);
  } else {
    renderer.setClearColor(0xf1f5f9, 1);
  }
}

export function updateOrbitPath(track) {
  if (!orbitLine) return;
  if (!track?.length) return;
  const points = track.map((point) => latLonToCartesian(point.lat, point.lon, point.alt ?? 0));
  const positions = new Float32Array(points.length * 3);
  points.forEach((vec, idx) => {
    positions[idx * 3] = vec.x;
    positions[idx * 3 + 1] = vec.y;
    positions[idx * 3 + 2] = vec.z;
  });
  orbitLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  orbitLine.geometry.computeBoundingSphere();
  orbitLine.computeLineDistances();
}

export function updateSatellite(point) {
  if (!satelliteMesh) return;
  const pos = latLonToCartesian(point.lat, point.lon, point.alt);
  satelliteMesh.position.copy(pos);
}

export function updateLink(satPoint, station) {
  if (!linkLine) return;
  if (!station) {
    linkLine.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(), 3));
    return;
  }
  const sat = latLonToCartesian(satPoint.lat, satPoint.lon, satPoint.alt);
  const gs = latLonToCartesian(station.lat, station.lon, 0.01);
  const positions = new Float32Array([
    gs.x, gs.y, gs.z,
    sat.x, sat.y, sat.z,
  ]);
  linkLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  linkLine.geometry.computeBoundingSphere();
}

export function renderStations(stations, selectedId) {
  if (!scene || !THREE) return;
  const existingIds = new Set();
  stations.forEach((station) => {
    existingIds.add(station.id);
    if (!stationMeshes.has(station.id)) {
      const geom = new THREE.SphereGeometry(0.012, 16, 16);
      const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.4 });
      const mesh = new THREE.Mesh(geom, mat);
      stationMeshes.set(station.id, mesh);
      scene.add(mesh);
    }
    const mesh = stationMeshes.get(station.id);
    const pos = latLonToCartesian(station.lat, station.lon, 0.01);
    mesh.position.copy(pos);
    mesh.material.color.set(station.id === selectedId ? 0xfacc15 : 0x38bdf8);
    mesh.material.emissiveIntensity = station.id === selectedId ? 0.7 : 0.3;
  });

  Array.from(stationMeshes.keys()).forEach((id) => {
    if (!existingIds.has(id)) {
      const mesh = stationMeshes.get(id);
      scene.remove(mesh);
      stationMeshes.delete(id);
    }
  });
}

export function dispose() {
  cancelAnimationFrame(animationId);
  if (renderer) {
    renderer.dispose();
  }
  if (scene) {
    scene.clear();
  }
  stationMeshes.clear();
}
