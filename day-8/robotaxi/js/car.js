// One car: simple top-down driving physics, 5 distance sensors, and progress along the road.
import { LANE, STEP } from './track.js';

export const SENSOR_ANGLES = [-60, -30, 0, 30, 60].map(d => d * Math.PI / 180); // far left → far right
export const SENSOR_RANGE = 30;   // metres
export const MAX_SPEED = 16;      // m/s (~36 mph)
export const MIN_SPEED = 3;
const STEER_RATE = 1.5;           // rad/s at full lock
const CAR_HALF_W = 0.95, CAR_HALF_L = 2.2;

export class Car {
  constructor(track, startIndex, brain = null) {
    this.track = track;
    this.brain = brain;
    this.reset(startIndex);
  }

  reset(startIndex) {
    const [x, y] = this.track.at(startIndex, LANE / 2);
    this.x = x; this.y = y;
    this.heading = this.track.heading(startIndex);
    this.speed = 6;
    this.idx = startIndex;        // nearest centre-line sample
    this.startIdx = startIndex;
    this.progress = 0;            // metres driven along the road (backwards counts negative)
    this.alive = true;
    this.time = 0;
    this.lastGain = 0;            // time of the last real progress, to catch cars that just circle
    this.bestProgress = 0;
    this.steer = 0; this.throttle = 0.5;
    this.sensors = new Array(SENSOR_ANGLES.length).fill(SENSOR_RANGE);
    this.crashedAt = null;
  }

  // Cast the 5 sensor rays: how far until the road ends in each direction?
  sense() {
    const t = this.track;
    for (let s = 0; s < SENSOR_ANGLES.length; s++) {
      const a = this.heading + SENSOR_ANGLES[s];
      const dx = Math.cos(a), dy = Math.sin(a);
      let d = 0;
      while (d < SENSOR_RANGE) {
        d += 0.5;
        if (!t.drivable(this.x + dx * d, this.y + dy * d)) break;
      }
      this.sensors[s] = Math.min(d, SENSOR_RANGE);
    }
    return this.sensors;
  }

  // Inputs for the brain: 1 = wall right there, 0 = nothing within range.
  inputs() { return this.sensors.map(d => 1 - d / SENSOR_RANGE); }

  // Set controls directly (steer -1..1, throttle 0..1) — used by manual driving and by the brain.
  control(steer, throttle) {
    this.steer = Math.max(-1, Math.min(1, steer));
    this.throttle = Math.max(0, Math.min(1, throttle));
  }

  think() {
    if (!this.brain) return;
    const [steer, throttle] = this.brain.decide(this.inputs());
    this.control(steer, throttle);
  }

  step(dt) {
    if (!this.alive) return;
    this.time += dt;
    const target = MIN_SPEED + this.throttle * (MAX_SPEED - MIN_SPEED);
    this.speed += (target - this.speed) * Math.min(1, 2.2 * dt);
    // Turning gets gentler at very low speed, like a real car.
    this.heading += this.steer * STEER_RATE * dt * Math.min(1, this.speed / 4);
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.y += Math.sin(this.heading) * this.speed * dt;

    // Progress along the road
    const t = this.track;
    const ni = t.nearest(this.x, this.y, this.idx);
    let d = ni - this.idx;
    if (d > t.n / 2) d -= t.n;
    if (d < -t.n / 2) d += t.n;
    this.idx = ni;
    this.progress += d * STEP;
    if (this.progress > this.bestProgress + 1) { this.bestProgress = this.progress; this.lastGain = this.time; }

    // Crash: any corner of the car leaves the lane
    if (this.offRoad()) this.crash();
    // Stuck or going the wrong way for too long
    else if (this.time - this.lastGain > 3) this.crash();
  }

  offRoad() {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    for (const [l, w] of [[CAR_HALF_L, CAR_HALF_W], [CAR_HALF_L, -CAR_HALF_W], [-CAR_HALF_L, CAR_HALF_W], [-CAR_HALF_L, -CAR_HALF_W]]) {
      if (!this.track.drivable(this.x + c * l - s * w, this.y + s * l + c * w)) return true;
    }
    return false;
  }

  crash() { this.alive = false; this.speed = 0; this.crashedAt = this.time; }

  // How far around one lap this car has got (0..1+)
  lapFraction() { return this.bestProgress / this.track.length; }
}
