// The city loop the robotaxis drive on.
// Everything here is plain 2D maths (x, y in metres), so it runs the same in the browser and in tests.
// The road has two lanes: the robotaxi drives in the right-hand lane, the left lane is oncoming traffic.

export const LANE = 5;            // width of the drivable lane (m) — a little wider than a real lane
export const STEP = 0.5;          // spacing between centre-line samples (m)
const CORNER_R = 16;              // corner radius (m)

// Corners of a city block route, driven in this order (counter-clockwise from above).
const CORNERS = [
  [150, 0], [150, 70], [100, 70], [100, 120], [10, 120], [10, 60], [-30, 60], [-30, 0],
];

function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function len(v) { return Math.hypot(v[0], v[1]); }
function norm(v) { const l = len(v); return [v[0] / l, v[1] / l]; }

// Build a smooth closed centre line: straight streets joined by circular corners.
function buildCentreLine() {
  const n = CORNERS.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const prev = CORNERS[(i - 1 + n) % n], cur = CORNERS[i], next = CORNERS[(i + 1) % n];
    const dIn = norm(sub(cur, prev)), dOut = norm(sub(next, cur));
    const start = [cur[0] - dIn[0] * CORNER_R, cur[1] - dIn[1] * CORNER_R];
    const end = [cur[0] + dOut[0] * CORNER_R, cur[1] + dOut[1] * CORNER_R];
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
  constructor() {
    this.centre = buildCentreLine();
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

  // Heading (radians) of the road at sample i.
  heading(i) { const t = this.tan[((i % this.n) + this.n) % this.n]; return Math.atan2(t[1], t[0]); }
}

// Where the cars start: partway along the bottom street, so they get a straight before the first corner.
export function startIndexFor(track) { return track.nearest(30, 0, 0, 0, track.n - 1); }
