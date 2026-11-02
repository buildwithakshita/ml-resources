import * as THREE from '../vendor/three.module.min.js';
import { Track, startIndexFor, LANE } from './track.js';
import { buildWorld, COLORS, to3, pedestrian, lidarPuck } from './world.js';
import { Car, SENSOR_ANGLES, SENSOR_RANGE } from './car.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.sky);
scene.fog = new THREE.Fog(COLORS.sky, 90, 300);
scene.add(new THREE.HemisphereLight(0xa7b394, 0x0b0f07, 0.9));
const sun = new THREE.DirectionalLight(0xfff3dc, 1.4); sun.position.set(80, 140, 60); scene.add(sun);

const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 900);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

const track = new Track();
const START = startIndexFor(track);
const { carGeo } = buildWorld(scene, track);

// a pedestrian strolling along the sidewalk by the crosswalk
const ped = pedestrian(); scene.add(ped);
function movePedestrian(t) {
  const i = track.crosswalk + Math.round(Math.sin(t * 0.15) * 18);
  const p = track.at(i, LANE + 2.6 + 1.6);
  ped.position.copy(to3(p[0], p[1], 0.16));
  ped.rotation.y = track.heading(i) + (Math.cos(t * 0.15) > 0 ? 0 : Math.PI);
}

// ---------- Cars ----------
const SIM_DT = 1 / 60;
const heroMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xfefadf, roughness: 0.35, metalness: 0.25, emissive: 0x3a3320, emissiveIntensity: 0.5 });
const heroMesh = new THREE.Mesh(carGeo, heroMat); heroMesh.add(lidarPuck()); scene.add(heroMesh);
// soft glow under the car you're watching
const glow = new THREE.Mesh(new THREE.CircleGeometry(3.4, 40), new THREE.MeshBasicMaterial({ color: COLORS.lamp, transparent: true, opacity: 0.16, depthWrite: false }));
glow.rotation.x = -Math.PI / 2; scene.add(glow);

function placeMesh(mesh, car, lift = 0) {
  mesh.position.set(car.x, lift, -car.y);
  mesh.rotation.y = car.heading;
}

// ---------- Sensors: 5 glowing beams showing what the car "sees" ----------
const beamGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6); beamGeo.translate(0, 0.5, 0); // base at origin, grows along +y
const beams = new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), SENSOR_ANGLES.length);
const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), SENSOR_ANGLES.length);
scene.add(beams, dots);
const far = new THREE.Color(COLORS.lamp), near = new THREE.Color(0xBC6C25), tmpC = new THREE.Color(), tmpM = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0), vA = new THREE.Vector3(), vB = new THREE.Vector3(), dir = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
function showSensors(car, visible = true) {
  beams.visible = dots.visible = visible && car.alive;
  if (!beams.visible) return;
  SENSOR_ANGLES.forEach((ang, s) => {
    const d = car.sensors[s], a = car.heading + ang;
    vA.set(car.x + Math.cos(car.heading) * 1.2, 0.85, -(car.y + Math.sin(car.heading) * 1.2));
    vB.set(car.x + Math.cos(a) * d, 0.3, -(car.y + Math.sin(a) * d));
    dir.subVectors(vB, vA); const L = dir.length(); dir.normalize();
    q.setFromUnitVectors(UP, dir); sc.set(1, L, 1);
    tmpM.compose(vA, q, sc); beams.setMatrixAt(s, tmpM);
    tmpC.copy(near).lerp(far, d / SENSOR_RANGE);
    beams.setColorAt(s, tmpC); dots.setColorAt(s, tmpC);
    tmpM.makeTranslation(vB.x, vB.y, vB.z); dots.setMatrixAt(s, tmpM);
  });
  for (const m of [beams, dots]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}

// ---------- Drive it yourself ----------
const player = new Car(track, START);
const keys = { left: false, right: false, gas: false };
const KEYMAP = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'gas', w: 'gas' };
window.addEventListener('keydown', e => { const k = KEYMAP[e.key]; if (k) { keys[k] = true; e.preventDefault(); } });
window.addEventListener('keyup', e => { const k = KEYMAP[e.key]; if (k) keys[k] = false; });
document.querySelectorAll('[data-key]').forEach(btn => {
  const k = btn.dataset.key;
  const on = e => { keys[k] = true; btn.classList.add('down'); e.preventDefault(); };
  const off = () => { keys[k] = false; btn.classList.remove('down'); };
  btn.addEventListener('pointerdown', on); btn.addEventListener('pointerup', off);
  btn.addEventListener('pointerleave', off); btn.addEventListener('pointercancel', off);
});
let crashTimer = 0;
function drivePlayer(dt) {
  if (!player.alive) {
    crashTimer += dt;
    if (crashTimer > 1.4) { player.reset(START); crashTimer = 0; toast(''); }
    return;
  }
  player.control((keys.left ? 1 : 0) - (keys.right ? 1 : 0), keys.gas ? 1 : 0.12);
  player.sense();
  player.step(dt);
  if (!player.alive) toast('Crashed! Resetting…');
}

// ---------- Chase camera ----------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function chase(car, dt, snap = false) {
  const a = car.heading;
  const want = to3(car.x - Math.cos(a) * 13, car.y - Math.sin(a) * 13, 6.5);
  const look = to3(car.x + Math.cos(a) * 12, car.y + Math.sin(a) * 12, 0.5);
  const k = snap ? 1 : Math.min(1, dt * 3.5);
  camPos.lerp(want, k); camLook.lerp(look, k);
  camera.position.copy(camPos); camera.lookAt(camLook);
}
chase(player, 0, true);

// ---------- HUD ----------
const $ = id => document.getElementById(id);
const toastEl = $('toast');
function toast(msg) { toastEl.textContent = msg; toastEl.classList.toggle('show', !!msg); }
function hud(car) {
  $('gen').textContent = 'Drive it yourself';
  $('sub').textContent = `${Math.round(car.speed * 2.237)} mph · lap ${Math.min(100, Math.round(car.lapFraction() * 100))}%`;
}

// ---------- Loop ----------
let last = performance.now(), clock = 0, acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt; acc += dt;
  while (acc >= SIM_DT) { drivePlayer(SIM_DT); acc -= SIM_DT; }
  placeMesh(heroMesh, player); placeMesh(glow, player, 0.04);
  showSensors(player);
  chase(player, dt);
  movePedestrian(clock);
  hud(player);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
