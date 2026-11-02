import * as THREE from '../vendor/three.module.min.js';
import { Track, startIndexFor, LANE } from './track.js';
import { buildWorld, COLORS, to3, pedestrian } from './world.js';

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
buildWorld(scene, track);

// a pedestrian strolling along the sidewalk by the crosswalk
const ped = pedestrian(); scene.add(ped);
function movePedestrian(t) {
  const i = track.crosswalk + Math.round(Math.sin(t * 0.15) * 18);
  const p = track.at(i, LANE + 2.6 + 1.6);
  ped.position.copy(to3(p[0], p[1], 0.16));
  ped.rotation.y = track.heading(i) + (Math.cos(t * 0.15) > 0 ? 0 : Math.PI);
}

// Camera: glide along the road, like a robotaxi passenger screen
let tour = START;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function tourCamera(dt) {
  tour = (tour + dt * 22) % track.n;
  const i = Math.floor(tour);
  const p = track.at(i, LANE / 2), a = track.heading(i);
  const back = [p[0] - Math.cos(a) * 14, p[1] - Math.sin(a) * 14];
  const ahead = track.at(i + 24, LANE / 2);
  camPos.lerp(to3(back[0], back[1], 7), Math.min(1, dt * 3));
  camLook.lerp(to3(ahead[0], ahead[1], 0), Math.min(1, dt * 3));
  camera.position.copy(camPos); camera.lookAt(camLook);
}
{ const p = track.at(START, LANE / 2); camPos.copy(to3(p[0] - 14, p[1], 7)); camLook.copy(to3(p[0] + 20, p[1], 0)); }

let last = performance.now(), clock = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
  tourCamera(dt);
  movePedestrian(clock);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
