import * as THREE from '../vendor/three.module.min.js';
import { Track, startIndexFor, LANE, STEP } from './track.js';
import { buildWorld, COLORS, to3, pedestrian, lidarPuck, PARK } from './world.js';
import { Car, SENSOR_ANGLES, SENSOR_RANGE } from './car.js';
import { Population, POP } from './evolve.js';
import { Brain } from './nn.js';
import { BrainView } from './brainview.js';
import { PRETRAINED, PRETRAINED_INFO } from './pretrained.js';

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
let mode = 'learn';          // 'learn' | 'drive' | 'compare' | 'trip'
let view = 'chase';          // 'chase' | 'top'
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
fleet.frustumCulled = false;   // instances move all over the map; don't let three.js hide them
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
beams.frustumCulled = dots.frustumCulled = false;
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

// ---------- Saved progress (this phone / browser only) ----------
const SAVE_KEY = 'mini-robotaxi.v1';
function saveProgress() {
  if (!pop.champion) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      generation: pop.generation, champion: pop.champion.toJSON(), championScore: pop.championScore,
      bestLapTime: pop.bestLapTime || null, history: pop.history.slice(-60),
    }));
  } catch (e) { /* private mode or storage full: just don't save */ }
}
function loadProgress() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!d || !d.champion) return null;
    const p = new Population(track, START, new Brain(d.champion), d.generation);
    p.championScore = d.championScore || 0; p.bestLapTime = d.bestLapTime || undefined; p.history = d.history || [];
    return p;
  } catch (e) { return null; }
}
function clearProgress() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }

// ---------- Learning ----------
const restored = loadProgress();
let pop = restored || new Population(track, START);
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
  toast(`Generation ${pop.generation}`, 1.2);
  drawSpark();
  saveProgress();
}

// ---------- Chase camera ----------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
// tall phone screens need the camera further back and a wider lens
function rig(aspect) {
  const t = Math.max(0, Math.min(1, (1.1 - aspect) / 0.65));   // 0 on wide screens, 1 on a tall phone
  return { back: 13 + 7 * t, up: 6.5 + 3.5 * t, fov: 50 + 12 * t };
}
function chase(car, dt, snap = false) {
  const a = car.heading, r = rig(camera.aspect);
  if (Math.abs(camera.fov - r.fov) > 0.1) { camera.fov = r.fov; camera.updateProjectionMatrix(); }
  const want = to3(car.x - Math.cos(a) * r.back, car.y - Math.sin(a) * r.back, r.up);
  const look = to3(car.x + Math.cos(a) * 12, car.y + Math.sin(a) * 12, 0.5);
  const k = snap ? 1 : Math.min(1, dt * 3.5);
  camPos.lerp(want, k); camLook.lerp(look, k);
  camera.position.copy(camPos); camera.lookAt(camLook);
}
chase(pop.cars[0], 0, true);

// ---------- Top view: the whole city from above ----------
const CENTRE = to3(62, 58, 0);
function topCamera(dt, cam = camera, snap = false) {
  if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
  // The city is ~200 m wide and ~140 m tall. On tall phone screens, turn the view 90° so it fills the screen.
  const aspect = cam.aspect || 1, tall = aspect < 0.9;
  const along = tall ? 140 : 200, across = tall ? 200 : 140;          // metres to fit horizontally / vertically
  const h = Math.max(across / 0.93 + 20, (along + 30) / (0.93 * aspect));
  const want = tall ? new THREE.Vector3(CENTRE.x + h * 0.28, h, CENTRE.z) : new THREE.Vector3(CENTRE.x, h, CENTRE.z + h * 0.28);
  const k = snap ? 1 : Math.min(1, dt * 2.5);
  camPos.lerp(want, k); camLook.lerp(CENTRE, k);
  cam.position.copy(camPos); cam.lookAt(camLook);
}

// ---------- Gen 1 vs now: split screen glow-up ----------
const camB = new THREE.PerspectiveCamera(50, 1, 0.5, 900);
const cmp = { random: [], best: null, gen: 0, camA: [new THREE.Vector3(), new THREE.Vector3()], camB: [new THREE.Vector3(), new THREE.Vector3()] };
const cmpFleet = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 }), 24);
cmpFleet.layers.set(1); cmpFleet.frustumCulled = false; scene.add(cmpFleet);
const cmpHero = new THREE.Mesh(carGeo, new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xfefadf, roughness: 0.35, metalness: 0.25, emissive: 0x3a3320, emissiveIntensity: 0.5 }));
cmpHero.add(lidarPuck()); cmpHero.layers.set(2); cmpHero.children.forEach(c => c.layers.set(2)); scene.add(cmpHero);
function startCompare() {
  cmp.random = Array.from({ length: 24 }, () => new Car(track, START, new Brain()));
  cmp.best = new Car(track, START, new Brain(pop.champion.toJSON()));
  cmp.gen = pop.generation - 1;
  for (const k of ['camA', 'camB']) cmp[k][0].set(0, 0, 0);
  $('cmpRight').textContent = `Generation ${cmp.gen} · learned`;
}
function compareStep(dt) {
  for (const c of cmp.random) if (c.alive) { c.sense(); c.think(); c.step(dt); }
  const b = cmp.best;
  if (b.alive) { b.sense(); b.think(); b.step(dt); if (b.lapFraction() >= 1) { b.alive = false; b.finished = true; } }
  if (!b.alive && cmp.random.every(c => !c.alive)) startCompare();
}
function chaseInto(cam, store, car, dt) {
  const a = car.heading, r = rig(cam.aspect);
  cam.fov = r.fov; cam.updateProjectionMatrix();
  const want = to3(car.x - Math.cos(a) * r.back, car.y - Math.sin(a) * r.back, r.up), look = to3(car.x + Math.cos(a) * 12, car.y + Math.sin(a) * 12, 0.5);
  if (store[0].lengthSq() === 0) { store[0].copy(want); store[1].copy(look); }
  store[0].lerp(want, Math.min(1, dt * 3.5)); store[1].lerp(look, Math.min(1, dt * 3.5));
  cam.position.copy(store[0]); cam.lookAt(store[1]);
}
function renderCompare(dt) {
  // left: the random brains (follow whichever is furthest, it'll crash soon), right: the learned brain
  const lead = cmp.random.reduce((a, c) => (c.alive && !a.alive) || (c.alive === a.alive && c.progress > a.progress) ? c : a, cmp.random[0]);
  cmp.random.forEach((c, i) => {
    fq.setFromAxisAngle(UP, c.heading + (c.alive ? 0 : 0.35)); fm.compose(fp.set(c.x, 0, -c.y), fq, fs);
    cmpFleet.setMatrixAt(i, fm); cmpFleet.setColorAt(i, c.alive ? C_ALIVE : C_DEAD);
  });
  cmpFleet.instanceMatrix.needsUpdate = true; if (cmpFleet.instanceColor) cmpFleet.instanceColor.needsUpdate = true;
  placeMesh(cmpHero, cmp.best);
  const W = window.innerWidth, H = window.innerHeight, portrait = H > W;
  const A = portrait ? [0, H / 2, W, H / 2] : [0, 0, W / 2, H];
  const B = portrait ? [0, 0, W, H / 2] : [W / 2, 0, W / 2, H];
  renderer.setScissorTest(true);
  for (const [vp, cam, layer, car, store] of [[A, camera, 1, lead, cmp.camA], [B, camB, 2, cmp.best, cmp.camB]]) {
    cam.aspect = vp[2] / vp[3]; cam.updateProjectionMatrix();
    cam.layers.set(0); cam.layers.enable(layer);
    chaseInto(cam, store, car, dt);
    renderer.setViewport(...vp); renderer.setScissor(...vp);
    renderer.render(scene, cam);
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
  camera.layers.set(0); camera.aspect = W / H; camera.updateProjectionMatrix();
}

// ---------- Robotaxi mode: pickups and drop-offs ----------
// Stops sit on the two long straight streets, where it's safe to pull over. Trips chain A → B → C → A …
const STOPS = [[20, 0], [100, 0], [42, 120]].map(([x, y]) => track.nearest(x, y, 0, 0, track.n - 1));
const STOP_NAMES = ['Market St', 'Harbor Ave', 'Elm St'];
function makePin(color) {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 16, 12, 1, true).translate(0, 8, 0),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshBasicMaterial({ color }));
  head.position.y = 16;
  g.add(beam, ring, head); g.visible = false; scene.add(g);
  return g;
}
const pickupPin = makePin(0xDDA05E), dropPin = makePin(0xFEFADF);
const rider = pedestrian(); rider.visible = false; scene.add(rider);
// glowing route line along the lane centre, from the car to the next stop
const ROUTE_MAX = track.n + 2;
const routeGeo = new THREE.BufferGeometry();
routeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ROUTE_MAX * 6), 3));
const routeIdx = []; for (let k = 0; k < ROUTE_MAX - 1; k++) { const v = k * 2; routeIdx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
routeGeo.setIndex(routeIdx);
const route = new THREE.Mesh(routeGeo, new THREE.MeshBasicMaterial({ color: 0xDDA05E, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide }));
route.frustumCulled = false; route.visible = false; scene.add(route);

const trip = { car: null, k: 1, phase: 'idle', target: 0, wait: 0, done: 0, crashT: 0, brainNote: '' };
function stopProgress(car, stopIdx) {
  // progress value (metres from the car's start) where this stop is, always ahead of the car
  let t = ((stopIdx - car.startIdx + track.n) % track.n) * STEP;
  while (t < car.progress + 15) t += track.length;
  return t;
}
function tripBrain() {
  if (pop.champion && pop.bestLapTime) { trip.brainNote = `Driven by your generation ${pop.generation - 1} brain`; return new Brain(pop.champion.toJSON()); }
  trip.brainNote = `Driven by a pre-trained brain (${PRETRAINED_INFO.generations} generations)`;
  return new Brain(PRETRAINED);
}
function startTrips() {
  trip.car = new Car(track, START, tripBrain());
  trip.k = 1; trip.done = 0; trip.crashT = 0;
  beginLeg('toPickup');
}
function beginLeg(phase) {
  trip.phase = phase; trip.wait = 0;
  const pickIdx = STOPS[trip.k % 3], dropIdx = STOPS[(trip.k + 1) % 3];
  trip.pickIdx = pickIdx; trip.dropIdx = dropIdx;
  if (phase === 'toPickup') {
    trip.target = stopProgress(trip.car, pickIdx);
    trip.legStart = trip.car.progress;
    const p = track.at(pickIdx, LANE / 2), r = track.at(pickIdx, LANE + PARK + 1.2);
    pickupPin.position.copy(to3(p[0], p[1])); pickupPin.visible = true;
    const q = track.at(dropIdx, LANE / 2); dropPin.position.copy(to3(q[0], q[1])); dropPin.visible = true;
    rider.position.copy(to3(r[0], r[1], 0.16)); rider.rotation.y = track.heading(pickIdx) - Math.PI / 2; rider.scale.setScalar(1); rider.visible = true;
  } else if (phase === 'toDrop') {
    trip.target = stopProgress(trip.car, dropIdx);
    trip.legStart = trip.car.progress;
    pickupPin.visible = false;
  }
}
function tripStep(dt) {
  const c = trip.car;
  if (!c.alive) {
    trip.crashT += dt;
    if (trip.crashT > 2.2) { toast(''); startTrips(); }
    return;
  }
  const rem = trip.target - c.progress;
  const stopping = trip.phase === 'toPickup' || trip.phase === 'toDrop';
  // the brain steers; the "trip planner" only decides when to slow down and stop, like a real robotaxi stack
  c.speedCap = !stopping ? 0 : rem < 0.5 ? 0 : rem < 28 ? Math.max(1.2, Math.sqrt(2 * 2.2 * rem)) : Infinity;
  c.sense(); c.think(); c.step(dt);
  if (!c.alive) { toast('Crashed! This brain needs more training', 2.2); return; }
  if (stopping && rem < 0.5 && c.speed < 0.3) trip.phase = trip.phase === 'toPickup' ? 'boarding' : 'arrived';
  if (trip.phase === 'boarding') {
    trip.wait += dt;
    // the rider walks to the car and hops in
    const k = Math.min(1, trip.wait / 2.2);
    const from = track.at(trip.pickIdx, LANE + PARK + 1.2), to = [c.x, c.y];
    rider.position.copy(to3(from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, 0.16 * (1 - k)));
    rider.scale.setScalar(k > 0.85 ? Math.max(0.01, (1 - k) / 0.15) : 1);
    if (trip.wait > 2.6) { rider.visible = false; beginLeg('toDrop'); }
  } else if (trip.phase === 'arrived') {
    trip.wait += dt;
    if (trip.wait > 2.4) { trip.done++; trip.k = (trip.k + 1) % 3; beginLeg('toPickup'); }
  }
}
function drawRoute(car) {
  const P = routeGeo.attributes.position.array;
  const startI = car.idx, count = Math.max(2, Math.min(ROUTE_MAX - 1, Math.round((trip.target - car.progress) / STEP)));
  for (let k = 0; k <= count; k++) {
    const a = track.at(startI + k, LANE / 2 - 0.6), b = track.at(startI + k, LANE / 2 + 0.6);
    P.set([a[0], 0.05, -a[1], b[0], 0.05, -b[1]], k * 6);
  }
  routeGeo.setDrawRange(0, count * 6);
  routeGeo.attributes.position.needsUpdate = true;
  route.visible = (trip.phase === 'toPickup' || trip.phase === 'toDrop') && car.alive;
}
function tripCard() {
  const c = trip.car, rem = Math.max(0, trip.target - c.progress);
  const titles = { toPickup: 'Picking you up', boarding: 'Your ride is here', toDrop: 'Heading to drop-off', arrived: "You've arrived" };
  $('tripTitle').textContent = c.alive ? titles[trip.phase] : 'Crashed';
  $('tripWhere').textContent = trip.phase === 'toPickup' || trip.phase === 'boarding' ? `Pickup · ${STOP_NAMES[trip.k % 3]}` : `Drop-off · ${STOP_NAMES[(trip.k + 1) % 3]}`;
  const mins = Math.max(1, Math.round(rem / 11 / 60));
  const dist = rem < 160 ? `${Math.round(rem * 3.281 / 10) * 10} ft` : `${(rem / 1609).toFixed(1)} mi`;
  $('tripEta').textContent = trip.phase === 'boarding' || trip.phase === 'arrived' ? 'now' : `${mins} min · ${dist}`;
  const leg = Math.max(1, trip.target - trip.legStart);
  $('tripBar').style.width = `${Math.min(100, Math.max(0, 100 * (1 - rem / leg)))}%`;
  $('tripNote').textContent = trip.brainNote;
  $('tripCount').textContent = `${trip.done} trip${trip.done === 1 ? '' : 's'} completed`;
}

// ---------- HUD ----------
const $ = id => document.getElementById(id);
const toastEl = $('toast');
let toastTimer = 0;
function toast(msg, secs = 0) {
  toastEl.textContent = msg; toastEl.classList.toggle('show', !!msg);
  toastEl.classList.toggle('info', !!msg && secs > 0); toastTimer = secs;
}
function hud() {
  if (mode === 'trip') {
    $('gen').textContent = 'Robotaxi mode';
    $('sub').textContent = `${Math.round(trip.car.speed * 2.237)} mph · no one in the driver's seat`;
    tripCard();
    return;
  }
  if (mode === 'compare') {
    $('gen').textContent = 'Gen 1 vs now';
    $('sub').textContent = `${cmp.random.filter(c => c.alive).length} of 24 random brains still driving`;
    return;
  }
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
  else if (m === 'compare') { startCompare(); toast(''); }
  else if (m === 'trip') { startTrips(); chase(trip.car, 0, true); toast(''); }
  else { focus = null; }
  if (m !== 'trip') { pickupPin.visible = dropPin.visible = rider.visible = route.visible = false; }
}
function setView(v) {
  view = v;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  scene.fog.near = v === 'top' ? 400 : 90; scene.fog.far = v === 'top' ? 900 : 300;
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$('compareBtn').addEventListener('click', () => {
  if (!pop.champion || !pop.bestLapTime) { toast('Let it learn a full lap first', 1.6); return; }
  setMode('compare');
});
$('backBtn').addEventListener('click', () => setMode('learn'));
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
  simSpeed = +b.dataset.speed;
  document.querySelectorAll('[data-speed]').forEach(x => x.classList.toggle('on', x === b));
}));
$('restart').addEventListener('click', () => { clearProgress(); pop = new Population(track, START); lastGen = pop.generation; focus = null; drawSpark(); toast('New cars, random brains', 1.4); });
// clean view: hide every button for screen recording; tap the screen to bring them back
const cleanHint = $('cleanHint');
$('cleanBtn').addEventListener('click', () => {
  document.body.classList.add('clean');
  cleanHint.classList.add('show'); setTimeout(() => cleanHint.classList.remove('show'), 1800);
});
canvas.addEventListener('click', () => document.body.classList.remove('clean'));
window.addEventListener('keydown', e => { if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('clean'); });

// how it works: shown on the first visit, and from the button
const about = $('about');
const openAbout = () => { about.hidden = false; };
const closeAbout = () => { about.hidden = true; try { localStorage.setItem('mini-robotaxi.seen', '1'); } catch (e) { /* ignore */ } };
$('aboutBtn').addEventListener('click', openAbout);
$('aboutClose').addEventListener('click', closeAbout);
about.addEventListener('click', e => { if (e.target === about) closeAbout(); });
let seen = false; try { seen = localStorage.getItem('mini-robotaxi.seen') === '1'; } catch (e) { /* ignore */ }
if (!seen && !new URLSearchParams(location.search).has('noabout')) openAbout();

setMode('learn');
drawSpark();
if (restored) setTimeout(() => toast(`Welcome back · generation ${pop.generation}`, 2.2), 600);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(); });

// ---------- Offline ----------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
window.__robotaxi = { get pop() { return pop; }, get focus() { return focus; }, trip, tripStep, learnStep };   // handy for debugging in the console

// ---------- Loop ----------
let last = performance.now(), clock = 0, acc = 0;
function tick(dt) {
  clock += dt;
  if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toast(''); }
  let watched;
  if (mode === 'compare') {
    acc += dt;
    let n = 0;
    while (acc >= SIM_DT && n < 60) { compareStep(SIM_DT); acc -= SIM_DT; n++; }
    fleet.count = 0; heroMesh.visible = glow.visible = false; showSensors(cmp.best, false);
    movePedestrian(clock); hud();
    renderCompare(dt);
    return;
  }
  if (mode === 'drive') {
    acc += dt;
    while (acc >= SIM_DT) { drivePlayer(SIM_DT); acc -= SIM_DT; }
    watched = player;
    fleet.count = 0;
  } else if (mode === 'trip') {
    acc += dt;
    while (acc >= SIM_DT) { tripStep(SIM_DT); acc -= SIM_DT; }
    watched = trip.car;
    fleet.count = 0;
    drawRoute(watched);
    const pulse = 1 + Math.sin(clock * 4) * 0.12;
    for (const pin of [pickupPin, dropPin]) pin.children[1].scale.setScalar(pulse);
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
  if (mode === 'learn' || mode === 'trip') brainView.draw(watched.brain);
  if (view === 'top' && mode === 'learn') topCamera(dt); else chase(watched, dt);
  movePedestrian(clock);
  hud();
  renderer.render(scene, camera);
}
function frame(now) {
  tick(Math.min(0.05, (now - last) / 1000)); last = now;
  requestAnimationFrame(frame);
}
// ?capture = no automatic loop; a recorder calls __robotaxi.tick(1/30) once per video frame
if (new URLSearchParams(location.search).has('capture')) window.__robotaxi.tick = tick;
else requestAnimationFrame(frame);
