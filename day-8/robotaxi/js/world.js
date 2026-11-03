// The 3D city around the road. Logic lives in 2D (x, y); in 3D that becomes (x, height, -y).
import * as THREE from '../vendor/three.module.min.js';
import { LANE, straights } from './track.js';

export const PARK = 2.6;      // parking strip width (m)
export const WALK = 3.2;      // sidewalk width (m)
export const to3 = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

// Materials and fixed shapes are made once and reused for every road, so switching roads
// only uploads the new road shape (no new shaders, much less GPU work on phones).
const KEEP = new Map();
function keep(key, make) { if (!KEEP.has(key)) { const v = make(); v.userData = { ...(v.userData || {}), keep: true }; KEEP.set(key, v); } return KEEP.get(key); }

export const COLORS = {
  sky: 0x0a0d08, ground: 0x0c1009, road: 0x262c22, walk: 0x30382a, curb: 0x4a5540,
  yellow: 0xE7B04E, white: 0xcfd3c2, building: 0x161d11, edge: 0x56693c,
  car: 0x9aa194, parked: 0x5d6457, lamp: 0xDDA05E,
};

// A flat ribbon that follows the road between two side offsets.
function ribbon(track, offA, offB, h, color, every = 1, emissive = 0) {
  const pos = [], idx = [];
  const n = track.n;
  let k = 0;
  for (let i = 0; i <= n; i += every) {
    const a = track.at(i, offA), b = track.at(i, offB);
    pos.push(a[0], h, -a[1], b[0], h, -b[1]);
    if (k > 0) { const v = k * 2; idx.push(v - 2, v - 1, v, v - 1, v + 1, v); }
    k++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = keep(`ribbon-${color}-${emissive}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive, side: THREE.DoubleSide }));
  return new THREE.Mesh(g, m);
}

// Merge several simple geometries into one, painting each with a flat colour (vertex colours).
export function mergeColored(parts) {
  const pos = [], nor = [], col = [];
  for (const [geo, color] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const c = new THREE.Color(color);
    const p = g.attributes.position.array, nn = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); nor.push(nn[i], nn[i + 1], nn[i + 2]); col.push(c.r, c.g, c.b); }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

// A sleek low-poly car, pointing along +x, sitting on the ground. Body is white so instances can tint it.
export function carGeometry() {
  const L = 4.6, W = 1.9;
  const side = new THREE.Shape();
  side.moveTo(-2.3, 0.28); side.lineTo(2.25, 0.28); side.quadraticCurveTo(2.42, 0.32, 2.38, 0.66);
  side.quadraticCurveTo(2.0, 0.86, 1.15, 0.9); side.lineTo(0.25, 1.38); side.quadraticCurveTo(-0.4, 1.47, -1.05, 1.42);
  side.lineTo(-2.05, 0.98); side.quadraticCurveTo(-2.38, 0.9, -2.36, 0.62); side.lineTo(-2.3, 0.28);
  const body = new THREE.ExtrudeGeometry(side, { depth: W - 0.2, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 2, steps: 1, curveSegments: 6 });
  body.translate(0, 0, -(W - 0.2) / 2);
  // glass: a slightly smaller cabin silhouette that pokes out of the body
  const gl = new THREE.Shape();
  gl.moveTo(1.08, 0.93); gl.lineTo(0.27, 1.36); gl.quadraticCurveTo(-0.4, 1.44, -1.02, 1.39); gl.lineTo(-1.95, 0.98); gl.lineTo(1.08, 0.93);
  const glass = new THREE.ExtrudeGeometry(gl, { depth: W - 0.02, bevelEnabled: false, curveSegments: 6 });
  glass.translate(0, 0.0, -(W - 0.02) / 2);
  const tail = new THREE.BoxGeometry(0.08, 0.09, W - 0.3); tail.translate(-2.4, 0.8, 0);
  const head = new THREE.BoxGeometry(0.06, 0.06, W - 0.5); head.translate(2.42, 0.62, 0);
  const parts = [[body, 0xffffff], [glass, 0x10150c], [tail, 0xff4a2a], [head, 0xfff6dc]];
  for (const [x, z] of [[1.45, 0.86], [1.45, -0.86], [-1.45, 0.86], [-1.45, -0.86]]) {
    const wh = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14); wh.rotateX(Math.PI / 2); wh.translate(x, 0.36, z);
    parts.push([wh, 0x070906]);
  }
  void L;
  return mergeColored(parts);
}

// Everything that doesn't move: road, markings, sidewalks, crosswalk, buildings, lamps, parked cars.
export function buildWorld(scene, track) {
  const group = new THREE.Group();
  const ground = new THREE.Mesh(keep('ground-geo', () => new THREE.PlaneGeometry(900, 900)), keep('ground', () => new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 })));
  const GB = track.bounds();
  ground.rotation.x = -Math.PI / 2; ground.position.set(GB.cx, -0.05, -GB.cy);
  group.add(ground);

  // road: oncoming lane + our lane + a parking strip on each side
  group.add(ribbon(track, -LANE - PARK, LANE + PARK, 0, COLORS.road));
  // sidewalks with a raised curb edge
  group.add(ribbon(track, LANE + PARK, LANE + PARK + WALK, 0.16, COLORS.walk, 2));
  group.add(ribbon(track, -LANE - PARK - WALK, -LANE - PARK, 0.16, COLORS.walk, 2));
  group.add(ribbon(track, LANE + PARK, LANE + PARK + 0.18, 0.17, COLORS.curb, 2));
  group.add(ribbon(track, -LANE - PARK - 0.18, -LANE - PARK, 0.17, COLORS.curb, 2));
  // markings: double yellow centre line, white lane edges
  group.add(ribbon(track, -0.32, -0.16, 0.02, COLORS.yellow, 1, 0.55));
  group.add(ribbon(track, 0.16, 0.32, 0.02, COLORS.yellow, 1, 0.55));
  group.add(ribbon(track, LANE - 0.16, LANE, 0.02, COLORS.white, 1, 0.25));
  group.add(ribbon(track, -LANE, -LANE + 0.16, 0.02, COLORS.white, 1, 0.25));

  // crosswalk on the top street
  // crosswalk: the middle of the second-longest street (a fixed spot on the original city block)
  let cw;
  if (track.seed === null) cw = track.nearest(55, 120, 0, 0, track.n - 1);
  else { const st = straights(track); const s2 = st[1] || st[0]; cw = (s2.start + Math.floor(s2.length / 2)) % track.n; }
  const stripeMat = keep('stripe', () => new THREE.MeshStandardMaterial({ color: COLORS.white, roughness: 0.8, emissive: COLORS.white, emissiveIntensity: 0.18 }));
  const stripeGeo = keep('stripe-geo', () => new THREE.PlaneGeometry(3.2, 0.55));
  const head = track.heading(cw);
  for (let off = -LANE - PARK + 0.8; off <= LANE + PARK - 0.6; off += 1.2) {
    const p = track.at(cw, off);
    const s = new THREE.Mesh(stripeGeo, stripeMat);
    s.rotation.x = -Math.PI / 2; s.rotation.z = head;
    s.position.copy(to3(p[0], p[1], 0.03));
    group.add(s);
  }
  track.crosswalk = cw;

  // buildings: boxes placed anywhere not too close to the road, drawn as one instanced mesh + glowing edges
  const samples = [];
  for (let i = 0; i < track.n; i += 6) samples.push(track.centre[i]);
  const clear = LANE + PARK + WALK + 6;
  const boxes = [];
  const rand = mulberry(track.seed === null ? 7 : track.seed + 11);
  const B = track.bounds();
  for (let x = B.minX - 85; x <= B.maxX + 85; x += 13) {
    for (let y = B.minY - 85; y <= B.maxY + 85; y += 13) {
      const bx = x + (rand() - 0.5) * 3, by = y + (rand() - 0.5) * 3;
      const w = 7 + rand() * 4, d = 7 + rand() * 4;
      let ok = true;
      for (const c of samples) { if (Math.abs(c[0] - bx) < clear + w / 2 && Math.abs(c[1] - by) < clear + d / 2) { ok = false; break; } }
      if (!ok || rand() < 0.12) continue;
      const far = Math.hypot(bx - B.cx, by - B.cy);
      const h = 3 + rand() * (far < 80 ? 7 : 16);
      boxes.push([bx, by, w, d, h]);
    }
  }
  const bMesh = new THREE.InstancedMesh(keep('box-geo', () => new THREE.BoxGeometry(1, 1, 1)), keep('building', () => new THREE.MeshStandardMaterial({ color: COLORS.building, roughness: 0.85, metalness: 0.1, emissive: 0x111709, emissiveIntensity: 1 })), boxes.length);
  const m4 = new THREE.Matrix4(), edgePos = [];
  boxes.forEach(([x, y, w, d, h], i) => {
    m4.compose(new THREE.Vector3(x, h / 2, -y), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
    bMesh.setMatrixAt(i, m4);
    const X = [x - w / 2, x + w / 2], Z = [-y - d / 2, -y + d / 2];
    // 4 vertical edges + top rectangle
    for (const xx of X) for (const zz of Z) edgePos.push(xx, 0, zz, xx, h, zz);
    edgePos.push(X[0], h, Z[0], X[1], h, Z[0], X[1], h, Z[0], X[1], h, Z[1], X[1], h, Z[1], X[0], h, Z[1], X[0], h, Z[1], X[0], h, Z[0]);
  });
  group.add(bMesh);
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
  group.add(new THREE.LineSegments(eg, keep('edge', () => new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.4 }))));

  // street lamps along the outer sidewalk
  const lampSpots = [];
  for (let i = 0; i < track.n; i += 50) lampSpots.push(track.at(i, LANE + PARK + 0.9));
  const poles = new THREE.InstancedMesh(keep('pole-geo', () => new THREE.CylinderGeometry(0.08, 0.1, 5, 6).translate(0, 2.5, 0)), keep('pole', () => new THREE.MeshStandardMaterial({ color: 0x313b28, roughness: 0.7 })), lampSpots.length);
  const heads = new THREE.InstancedMesh(keep('lamp-geo', () => new THREE.SphereGeometry(0.28, 10, 8).translate(0, 5.1, 0)), keep('lamp', () => new THREE.MeshBasicMaterial({ color: COLORS.lamp })), lampSpots.length);
  lampSpots.forEach(([x, y], i) => { m4.makeTranslation(x, 0.16, -y); poles.setMatrixAt(i, m4); heads.setMatrixAt(i, m4); });
  group.add(poles, heads);

  // parked cars on both parking strips (not near corners or the crosswalk)
  const carGeo = keep('parked-car-geo', carGeometry);
  const spots = [];
  for (let i = 0; i < track.n; i += 14) {
    const nearCrosswalk = Math.min(Math.abs(i - cw), track.n - Math.abs(i - cw)) < 30;
    const curvy = Math.abs(angleDiff(track.heading(i - 12), track.heading(i + 12))) > 0.08;
    if (curvy || nearCrosswalk || rand() < 0.35) continue;
    const side = rand() < 0.55 ? 1 : -1;
    const p = track.at(i, side * (LANE + PARK / 2));
    spots.push([p[0], p[1], track.heading(i) + (side < 0 ? Math.PI : 0)]);
  }
  const parked = new THREE.InstancedMesh(carGeo, keep('parked', () => new THREE.MeshStandardMaterial({ vertexColors: true, color: COLORS.parked, roughness: 0.5, metalness: 0.2 })), spots.length);
  spots.forEach(([x, y, a], i) => {
    m4.compose(new THREE.Vector3(x, 0, -y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(1, 1, 1));
    parked.setMatrixAt(i, m4);
  });
  group.add(parked);

  scene.add(group);
  return { group, carGeo };
}

export function angleDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// small seeded random generator so the city looks the same every time
export function mulberry(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// A simple walking pedestrian made of a capsule and a head.
export function pedestrian() {
  const g = mergeColored([
    [new THREE.CapsuleGeometry(0.24, 0.9, 4, 8).translate(0, 0.85, 0), 0xb9bdaf],
    [new THREE.SphereGeometry(0.2, 10, 8).translate(0, 1.62, 0), 0xb9bdaf],
  ]);
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x3a3f33, emissiveIntensity: 0.4 }));
}

// The roof sensor that makes it look like a robotaxi (a lidar "puck").
export function lidarPuck() {
  const g = mergeColored([
    [new THREE.CylinderGeometry(0.42, 0.48, 0.12, 20).translate(0, 1.5, 0), 0x1a2014],
    [new THREE.CylinderGeometry(0.3, 0.34, 0.26, 20).translate(0, 1.69, 0), 0x2b3324],
    [new THREE.CylinderGeometry(0.31, 0.31, 0.06, 20).translate(0, 1.72, 0), 0xDDA05E],
  ]);
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.4, emissive: 0x2a1e0c, emissiveIntensity: 0.6 }));
}

// Remove a city built by buildWorld and free its GPU memory (used when switching roads).
export function disposeWorld(scene, group) {
  scene.remove(group);
  group.traverse(o => {
    if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose();
    if (o.isInstancedMesh) o.dispose();   // frees the per-instance buffers; shared shapes and materials stay
  });
}
