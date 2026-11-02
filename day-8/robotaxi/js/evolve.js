// Neuroevolution: no right answers, just "how far did you get?"
// Each generation, 50 cars drive. The best brains survive and pass on slightly tweaked copies.
import { Brain } from './nn.js';
import { Car } from './car.js';

export const POP = 50;
export const GEN_TIME = 45;   // seconds a generation is allowed to drive

export class Population {
  constructor(track, startIndex, seedBrain = null, generation = 1) {
    this.track = track;
    this.start = startIndex;
    this.generation = generation;
    this.history = [];          // best lap fraction per generation
    this.champion = seedBrain;  // best brain found so far
    this.championScore = 0;
    this.cars = [];
    this.spawn(seedBrain ? this.childrenOf([seedBrain]) : Array.from({ length: POP }, () => new Brain()));
  }

  spawn(brains) {
    this.cars = brains.map(b => new Car(this.track, this.start, b));
    this.time = 0;
  }

  // Brains for the next generation: the champion unchanged, the rest are mutated copies of the top drivers.
  childrenOf(parents) {
    const out = [new Brain(parents[0].toJSON())];
    // stuck? experiment more boldly, and bring in a few completely new brains ("new blood")
    const boost = 1 + Math.min(3, (this.stagnant || 0) * 0.5);
    const fresh = this.stagnant >= 2 ? 6 : 2;
    for (let k = 0; k < fresh; k++) out.push(new Brain());
    while (out.length < POP) {
      // pick parents mostly from the very best, sometimes from the rest of the top group
      const p = parents[Math.floor(Math.random() ** 2 * parents.length)];
      const strong = Math.random() < 0.3;
      out.push(p.mutate(Math.min(0.9, (strong ? 0.35 : 0.12) * boost), (strong ? 0.8 : 0.35) * boost));
    }
    return out;
  }

  get alive() { return this.cars.filter(c => c.alive).length; }

  // The car currently furthest along (the camera follows it).
  leader() {
    let best = this.cars[0];
    for (const c of this.cars) {
      if ((c.alive && !best.alive) || (c.alive === best.alive && c.progress > best.progress)) best = c;
    }
    return best;
  }

  bestLap() { return Math.max(...this.cars.map(c => c.lapFraction())); }

  step(dt) {
    this.time += dt;
    for (const c of this.cars) { if (c.alive) { c.sense(); c.think(); c.step(dt); } }
    // a car that finishes a full lap is done; remember how quickly it got there
    for (const c of this.cars) if (c.alive && c.lapFraction() >= 1) { c.alive = false; c.finished = true; c.finishTime = c.time; }
    if (this.alive === 0 || this.time > GEN_TIME) this.nextGeneration();
  }

  // Fitness: how far you got, plus a bonus for finishing the lap quickly.
  score(c) { return c.bestProgress + (c.finished ? (GEN_TIME - c.finishTime) * 20 : 0); }

  nextGeneration() {
    const ranked = [...this.cars].sort((a, b) => this.score(b) - this.score(a));
    const top = ranked[0];
    this.history.push(Math.min(1, top.lapFraction()));
    this.lastBestTime = top.finished ? top.finishTime : null;
    if (top.finished && (!this.bestLapTime || top.finishTime < this.bestLapTime)) this.bestLapTime = top.finishTime;
    if (!this.champion || this.score(top) > this.championScore * 1.02) this.stagnant = 0;
    else this.stagnant = (this.stagnant || 0) + 1;
    if (!this.champion || this.score(top) >= this.championScore) {
      this.champion = top.brain; this.championScore = this.score(top);
    }
    const parents = [this.champion, ...ranked.slice(0, 9).map(c => c.brain)];
    this.generation++;
    this.spawn(this.childrenOf(parents));
  }
}
