import * as THREE from '../vendor/three.module.min.js';
import { Track, startIndexFor, LANE } from './track.js';
import { buildWorld, COLORS, to3, pedestrian, lidarPuck } from './world.js';
import { Car, SENSOR_ANGLES, SENSOR_RANGE } from './car.js';
import { Population, POP } from './evolve.js';
import { BrainView } from './brainview.js';

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
let mode = 'learn';          // 'learn' | 'drive'
let simSpeed = 1;           // 1×, 3× or 10× for learning
const heroMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xfefadf, roughness: 0.35, metalness: 0.25, emissive: 0x3a3320, emissiveIntensity: 0.5 });
const heroMesh = new THREE.Mesh(carGeo, heroMat); heroMesh.add(lidarPuck()); scene.add(heroMesh);
// soft glow under the car you're watching
const glow = new THREE.Mesh(new THREE.CircleGeometry(3.4, 40), new THREE.MeshBasicMaterial({ color: COLORS.lamp, transparent: true, opacity: 0.16, depthWrite: false }));
glow.rotation.x = -Math.PI / 2; scene.add(glow);

// all 50 learners share one instanced mesh; each gets its own colour
const fleetMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25, transparent: true, opacity: 0.55, depthWrite: false });
const fleet = new THREE.InstancedMesh(carGeo, fleetMat, POP);
fleet.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(fleet);
const C_ALIVE = new THREE.Color(0xa3aa9c), C_DEAD = new THREE.Color(0x6b3a1c), C_DONE = new THREE.Color(0xDDA05E);
const fm = new THREE.Matrix4(), fq = new THREE.Quaternion(), fp = new THREE.Vector3(), fs = new THREE.Vector3(1, 1, 1), HIDE = new THREE.Vector3(0, 0, 0);
function drawFleet(cars, skip) {
  cars.forEach((c, i) => {
    if (c === skip) { fm.compose(fp.set(0, -50, 0), fq, HIDE); fleet.setMatrixAt(i, fm); return; }
    fq.setFromAxisAngle(UP, c.heading + (c.alive ? 0 : 0.35));
    fm.compose(fp.set(c.x, 0, -c.y), fq, fs); fleet.setMatrixAt(i, fm);
    fleet.setColorAt(i, c.finished ? C_DONE : c.alive ? C_ALIVE : C_DEAD);
  });
  fleet.count = cars.length;
  fleet.instanceMatrix.needsUpdate = true; if (fleet.instanceColor) fleet.instanceColor.needsUpdate = true;
}

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

// ---------- Learning ----------
let pop = new Population(track, START);
let focus = null, lastGen = pop.generation;
function pickFocus() {
  const lead = pop.leader();
  if (!focus || !pop.cars.includes(focus) || (!focus.alive && lead.alive) || (lead.alive && lead.progress > focus.progress + 25)) focus = lead;
  return focus;
}
function learnStep(dt) {
  pop.step(dt);
  if (pop.generation !== lastGen) { lastGen = pop.generation; focus = null; onNewGeneration(); }
}
function onNewGeneration() {
  const best = pop.history[pop.history.length - 1];
  toast(`Generation ${pop.generation}`, 1.2);
  drawSpark();
  void best;
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
chase(pop.cars[0], 0, true);

// ---------- HUD ----------
const $ = id => document.getElementById(id);
const toastEl = $('toast');
let toastTimer = 0;
function toast(msg, secs = 0) {
  toastEl.textContent = msg; toastEl.classList.toggle('show', !!msg);
  toastEl.classList.toggle('info', !!msg && secs > 0); toastTimer = secs;
}
function hud() {
  if (mode === 'drive') {
    $('gen').textContent = 'Drive it yourself';
    $('sub').textContent = `${Math.round(player.speed * 2.237)} mph · lap ${Math.min(100, Math.round(player.lapFraction() * 100))}%`;
    return;
  }
  const lap = Math.min(1, pop.bestLap());
  $('gen').textContent = `Generation ${pop.generation}`;
  $('sub').textContent = `${pop.alive} of ${POP} still driving`;
  $('lapPct').textContent = `${Math.round(lap * 100)}%`;
  $('lapBar').style.width = `${lap * 100}%`;
  $('lapTime').textContent = pop.bestLapTime ? `best lap ${pop.bestLapTime.toFixed(1)}s` : 'no full lap yet';
}
const spark = $('spark'), sctx = spark.getContext('2d');
function drawSpark() {
  const w = spark.width = spark.clientWidth * devicePixelRatio, h = spark.height = spark.clientHeight * devicePixelRatio;
  sctx.clearRect(0, 0, w, h);
  const H = pop.history.slice(-30); if (!H.length) return;
  const bw = w / 30;
  H.forEach((v, i) => {
    sctx.fillStyle = v >= 1 ? '#DDA05E' : 'rgba(254,250,223,.45)';
    const bh = Math.max(2, v * (h - 2));
    sctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
  });
}

const brainView = new BrainView($('brain'));

// ---------- Controls ----------
function setMode(m) {
  mode = m;
  document.body.dataset.mode = m;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  if (m === 'drive') { player.reset(START); chase(player, 0, true); toast(''); }
  else { focus = null; }
}
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
  simSpeed = +b.dataset.speed;
  document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('on', x === b));
}));
$('restart').addEventListener('click', () => { pop = new Population(track, START); lastGen = pop.generation; focus = null; drawSpark(); toast('New cars, random brains', 1.4); });
setMode('learn');
window.__robotaxi = { get pop() { return pop; }, get focus() { return focus; } };   // handy for debugging in the console

// ---------- Loop ----------
let last = performance.now(), clock = 0, acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toast(''); }
  let watched;
  if (mode === 'drive') {
    acc += dt;
    while (acc >= SIM_DT) { drivePlayer(SIM_DT); acc -= SIM_DT; }
    watched = player;
    fleet.count = 0;
  } else {
    acc += dt * simSpeed;
    let n = 0;
    while (acc >= SIM_DT && n < 240) { learnStep(SIM_DT); acc -= SIM_DT; n++; }
    if (n >= 240) acc = 0;
    watched = pickFocus();
    drawFleet(pop.cars, watched);
  }
  placeMesh(heroMesh, watched); placeMesh(glow, watched, 0.04);
  heroMesh.visible = glow.visible = true;
  heroMat.color.set(watched.alive || watched.finished ? 0xfefadf : 0x8a5a36);
  showSensors(watched);
  if (mode === 'learn') brainView.draw(watched.brain);
  chase(watched, dt);
  movePedestrian(clock);
  hud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
