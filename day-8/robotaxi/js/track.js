// The city loop the robotaxis drive on.
// Everything here is plain 2D maths (x, y in metres), so it runs the same in the browser and in tests.
// The road has two lanes: the robotaxi drives in the right-hand lane, the left lane is oncoming traffic.

export const LANE = 5;            // width of the drivable lane (m) — a little wider than a real lane
export const STEP = 0.5;          // spacing between centre-line samples (m)
const CORNER_R = 21;              // corner radius (m) on the original city block

// Corners of the original city block route, driven in this order (counter-clockwise from above).
const CORNERS = [
  [150, 0], [150, 70], [100, 70], [100, 120], [10, 120], [10, 60], [-30, 60], [-30, 0],
];

// small seeded random generator, so road #1234 always looks the same
export function rng(seed) {
  let a = seed >>> 0;
  return function () { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function len(v) { return Math.hypot(v[0], v[1]); }
function norm(v) { const l = len(v); return [v[0] / l, v[1] / l]; }

// Build a smooth closed centre line: straight streets joined by circular corners.
function buildCentreLine(CORNERS, radii) {
  const n = CORNERS.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const prev = CORNERS[(i - 1 + n) % n], cur = CORNERS[i], next = CORNERS[(i + 1) % n];
    const dIn = norm(sub(cur, prev)), dOut = norm(sub(next, cur));
    const R = radii[i];
    const start = [cur[0] - dIn[0] * R, cur[1] - dIn[1] * R];
    const end = [cur[0] + dOut[0] * R, cur[1] + dOut[1] * R];
    // straight part from the end of the previous corner to the start of this one
    if (pts.length) {
      const last = pts[pts.length - 1];
      const d = len(sub(start, last)), k = Math.max(1, Math.round(d / STEP));
      for (let j = 1; j <= k; j++) pts.push([last[0] + (start[0] - last[0]) * j / k, last[1] + (start[1] - last[1]) * j / k]);
    } else pts.push(start);
    // the corner: a quadratic curve through the corner point, sampled finely
    const k = 40;
    for (let j = 1; j <= k; j++) {
      const t = j / k;
      pts.push([
        (1 - t) * (1 - t) * start[0] + 2 * (1 - t) * t * cur[0] + t * t * end[0],
        (1 - t) * (1 - t) * start[1] + 2 * (1 - t) * t * cur[1] + t * t * end[1],
      ]);
    }
  }
  // close the loop back to the first point
  const first = pts[0], last = pts[pts.length - 1];
  const d = len(sub(first, last)), k = Math.max(1, Math.round(d / STEP));
  for (let j = 1; j < k; j++) pts.push([last[0] + (first[0] - last[0]) * j / k, last[1] + (first[1] - last[1]) * j / k]);
  return resample(pts, STEP);
}

// Re-space the points evenly so "progress" is measured in real metres.
function resample(pts, step) {
  const loop = pts.concat([pts[0]]);
  const out = [];
  let next = 0, walked = 0;          // next = distance at which to drop the next point
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1], b = loop[i];
    const seg = len(sub(b, a));
    while (next <= walked + seg && seg > 0) {
      const t = (next - walked) / seg;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      next += step;
    }
    walked += seg;
  }
  // drop a final point that sits on top of the first one
  const f = out[0], l = out[out.length - 1];
  if (len(sub(f, l)) < step * 0.5) out.pop();
  return out;
}

export class Track {
  // corners: route corner points (counter-clockwise); radii: corner radius per corner.
  // seed: null for the original city block, a number for a generated road.
  constructor(corners = CORNERS, radii = null, seed = null) {
    this.seed = seed;
    this.corners = corners;
    this.centre = buildCentreLine(corners, radii || corners.map(() => CORNER_R));
    this.n = this.centre.length;
    this.length = this.n * STEP;
    // unit tangent and right-hand normal at every sample
    this.tan = []; this.right = [];
    for (let i = 0; i < this.n; i++) {
      const a = this.centre[(i - 1 + this.n) % this.n], b = this.centre[(i + 1) % this.n];
      const t = norm(sub(b, a));
      this.tan.push(t); this.right.push([t[1], -t[0]]);
    }
    this.buildGrid();
  }

  // A point at distance `off` metres to the right of the centre line at sample i.
  at(i, off = 0) {
    i = ((i % this.n) + this.n) % this.n;
    const c = this.centre[i], r = this.right[i];
    return [c[0] + r[0] * off, c[1] + r[1] * off];
  }

  // A coarse map of which 0.5 m squares are drivable. Sensors and crash checks just look it up.
  buildGrid() {
    const xs = this.centre.map(p => p[0]), ys = this.centre.map(p => p[1]);
    const pad = 20;
    this.minX = Math.min(...xs) - pad; this.minY = Math.min(...ys) - pad;
    this.cell = 0.5;
    this.gw = Math.ceil((Math.max(...xs) + pad - this.minX) / this.cell);
    this.gh = Math.ceil((Math.max(...ys) + pad - this.minY) / this.cell);
    this.grid = new Uint8Array(this.gw * this.gh);
    for (let i = 0; i < this.n; i++) {
      const c = this.centre[i], r = this.right[i], t = this.tan[i];
      for (let off = 0; off <= LANE; off += 0.2) {
        for (let along = -0.4; along <= 0.4; along += 0.2) {
          const x = c[0] + r[0] * off + t[0] * along, y = c[1] + r[1] * off + t[1] * along;
          const gx = Math.floor((x - this.minX) / this.cell), gy = Math.floor((y - this.minY) / this.cell);
          if (gx >= 0 && gy >= 0 && gx < this.gw && gy < this.gh) this.grid[gy * this.gw + gx] = 1;
        }
      }
    }
  }

  drivable(x, y) {
    const gx = Math.floor((x - this.minX) / this.cell), gy = Math.floor((y - this.minY) / this.cell);
    if (gx < 0 || gy < 0 || gx >= this.gw || gy >= this.gh) return false;
    return this.grid[gy * this.gw + gx] === 1;
  }

  // Nearest centre-line sample, searching a small window around a previous guess (fast).
  nearest(x, y, guess, back = 12, ahead = 40) {
    let best = guess, bd = Infinity;
    for (let k = -back; k <= ahead; k++) {
      const i = ((guess + k) % this.n + this.n) % this.n;
      const c = this.centre[i];
      const d = (c[0] - x) ** 2 + (c[1] - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // True if no part of the road comes within 26 m of a far-away part of itself.
  separated(minGap = 26) {
    const n = this.n, step = 6;
    for (let i = 0; i < n; i += step) {
      const a = this.centre[i];
      for (let j = i + step; j < n; j += step) {
        const along = Math.min(j - i, n - (j - i)) * STEP;
        if (along < 70) continue;
        const b = this.centre[j];
        if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 < minGap * minGap) return false;
      }
    }
    return true;
  }

  // Bounding box and centre of the road (for cameras and the city around it).
  bounds() {
    const xs = this.centre.map(p => p[0]), ys = this.centre.map(p => p[1]);
    const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    b.cx = (b.minX + b.maxX) / 2; b.cy = (b.minY + b.maxY) / 2; b.w = b.maxX - b.minX; b.h = b.maxY - b.minY;
    return b;
  }

  // Heading (radians) of the road at sample i.
  heading(i) { const t = this.tan[((i % this.n) + this.n) % this.n]; return Math.atan2(t[1], t[0]); }
}

// ---------- Places on the road ----------
function angleDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// Runs of samples where the road is dead straight: [{ start, length }] (indices, samples)
export function straights(track) {
  const n = track.n, ok = new Array(n);
  for (let i = 0; i < n; i++) ok[i] = Math.abs(angleDiff(track.heading(i - 8), track.heading(i + 8))) < 0.004;
  const runs = [];
  let i0 = ok.findIndex(v => !v); if (i0 < 0) i0 = 0;
  let cur = null;
  for (let k = 1; k <= n; k++) {
    const i = (i0 + k) % n;
    if (ok[i]) { if (!cur) cur = { start: i, length: 0 }; cur.length++; }
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs.sort((a, b) => b.length - a.length);
}

// Where the cars start: partway along the longest street, so they get a straight before the first corner.
export function startIndexFor(track) {
  if (track.seed === null) return track.nearest(30, 0, 0, 0, track.n - 1);
  const s = straights(track)[0];
  return (s.start + Math.floor(s.length * 0.3)) % track.n;
}

// Spots spread around the loop on straight streets (for robotaxi stops and the crosswalk).
export function spotsFor(track, count) {
  const spots = [];
  for (const s of straights(track)) {
    if (s.length * STEP < 30) continue;
    spots.push((s.start + Math.floor(s.length * 0.5)) % track.n);
  }
  // keep the ones furthest apart along the loop
  spots.sort((a, b) => a - b);
  while (spots.length > count) {
    let worst = 0, gap = Infinity;
    for (let k = 0; k < spots.length; k++) {
      const g = (spots[(k + 1) % spots.length] - spots[k] + track.n) % track.n;
      if (g < gap) { gap = g; worst = k; }
    }
    spots.splice(worst, 1);
  }
  return spots;
}

// ---------- Brand-new roads ----------
// A generated city loop: a rectangle of streets with random notches and bumps, wobbled corners
// and a different corner radius at every corner. Rejected and retried if any part of the road
// comes too close to another part.
export function randomTrack(seed) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = rng(seed * 7919 + attempt * 104729 + 1);
    const W = 150 + r() * 70, H = 100 + r() * 50;
    // walk counter-clockwise: bottom (→), right (↑), top (←), left (↓)
    const pts = [];
    const notch = () => r() < 0.6;
    const nx = () => 50 + r() * Math.min(45, W * 0.3), ny = () => 48 + r() * Math.min(35, H * 0.3);
    // bottom-left corner
    if (notch()) { const a = nx(), b = ny(); pts.push([0, b], [a, b], [a, 0]); } else pts.push([0, 0]);
    // bottom-right
    if (notch()) { const a = nx(), b = ny(); pts.push([W - a, 0], [W - a, b], [W, b]); } else pts.push([W, 0]);
    // top-right
    if (notch()) { const a = nx(), b = ny(); pts.push([W, H - b], [W - a, H - b], [W - a, H]); } else pts.push([W, H]);
    // a bump pushed in from the top street
    if (r() < 0.5) { const x = W * (0.35 + r() * 0.3), w = 50 + r() * 15, d = 46 + r() * 20; pts.push([x + w / 2, H], [x + w / 2, H - d], [x - w / 2, H - d], [x - w / 2, H]); }
    // top-left
    if (notch()) { const a = nx(), b = ny(); pts.push([a, H], [a, H - b], [0, H - b]); } else pts.push([0, H]);
    // wobble every corner a little so turns aren't all exactly 90°
    const corners = pts.map(([x, y]) => [x + (r() - 0.5) * 12, y + (r() - 0.5) * 12]);
    const radii = corners.map(() => 15 + r() * 9);
    // every street must be long enough to fit both of its corners
    let ok = true;
    for (let i = 0; i < corners.length; i++) {
      const j = (i + 1) % corners.length;
      if (len(sub(corners[j], corners[i])) < radii[i] + radii[j] + 6) { ok = false; break; }
    }
    if (!ok) continue;
    const t = new Track(corners, radii, seed);
    if (t.length < 430 || t.length > 640 || !t.separated()) continue;
    return t;
  }
  return new Track();   // fall back to the original block (never seen in testing)
}
