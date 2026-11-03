// Neuroevolution: no right answers, just "how far did you get?"
// Each generation, 50 cars drive. The best brains survive and pass on slightly tweaked copies.
import { Brain } from './nn.js';
import { Car } from './car.js';
import { startIndexFor } from './track.js';

export const POP = 50;
export const GEN_TIME = 45;   // seconds a generation is allowed to drive

export class Population {
  // roadFor(generation): optional — give every generation a different road ("train on many roads")
  constructor(track, startIndex, seedBrain = null, generation = 1, roadFor = null) {
    this.roadFor = roadFor;
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
    for (const c of this.cars) if (c.alive && c.lapFraction() >= 1) {
      c.alive = false; c.finished = true; c.finishTime = c.time;
      if (this.firstFinish == null) this.firstFinish = this.time;
    }
    if (this.exam) this.examStep(dt);
    // end the generation when everyone has crashed, 2 s after the first car finishes, or at the time limit
    if (this.alive === 0 || this.time > GEN_TIME || (this.firstFinish != null && this.time > this.firstFinish + 2)) this.nextGeneration();
  }

  // ---- The practice-road exam, spread out over the next generation so the app never freezes ----
  startExam(candidates) {
    if (!this.practiceRoads) this.practiceRoads = [-1, -2, -3].map(k => this.roadFor(k));
    this.exam = {
      candidates,
      runs: candidates.map(b => this.practiceRoads.map(t => new Car(t, startIndexFor(t), b))),
    };
  }
  examStep(dt) {
    let busy = false;
    for (const runs of this.exam.runs) for (const c of runs) {
      if (c.alive && c.bestProgress < c.track.length && c.time < GEN_TIME) { c.sense(); c.think(); c.step(dt); busy = true; }
    }
    if (!busy) this.finishExam();
  }
  finishExam() {
    const { candidates, runs } = this.exam;
    let best = null, bestScore = -1;
    candidates.forEach((b, i) => {
      let total = 0;
      for (const c of runs[i]) total += Math.min(1, c.lapFraction()) + (c.bestProgress >= c.track.length ? (GEN_TIME - c.time) / GEN_TIME * 0.2 : 0);
      const sc = total / runs[i].length;
      if (sc > bestScore) { best = b; bestScore = sc; }
    });
    this.stagnant = bestScore > (this.championScore || 0) + 0.01 ? 0 : (this.stagnant || 0) + 1;
    this.champion = best; this.championScore = bestScore;
    this.exam = null;
  }

  // Fitness: how far you got, plus a bonus for finishing the lap quickly.
  score(c) { return c.bestProgress + (c.finished ? (GEN_TIME - c.finishTime) * 20 : 0); }

  finishExamNow() {   // only if a generation ends before its exam does (rare)
    while (this.exam) this.examStep(1 / 60);
  }

  nextGeneration() {
    const ranked = [...this.cars].sort((a, b) => this.score(b) - this.score(a));
    const top = ranked[0];
    this.history.push(Math.min(1, top.lapFraction()));
    this.lastBestTime = top.finished ? top.finishTime : null;
    if (top.finished && (!this.bestLapTime || top.finishTime < this.bestLapTime)) this.bestLapTime = top.finishTime;
    if (this.roadFor) {
      // Scores on different roads can't be compared directly, so the top 3 of this generation
      // and the current champion take a test on 3 practice roads (run quietly during the next
      // generation). The best one becomes the champion.
      if (this.exam) this.finishExamNow();
      if (!this.champion) this.champion = top.brain;
      this.startExam([...new Set([this.champion, ...ranked.slice(0, 3).map(c => c.brain)])]);
    } else {
      if (!this.champion || this.score(top) > this.championScore * 1.02) this.stagnant = 0;
      else this.stagnant = (this.stagnant || 0) + 1;
      if (!this.champion || this.score(top) >= this.championScore) {
        this.champion = top.brain; this.championScore = this.score(top);
      }
    }
    const parents = [this.champion, ...ranked.slice(0, 9).map(c => c.brain)];
    this.generation++;
    if (this.roadFor) { this.track = this.roadFor(this.generation); this.start = startIndexFor(this.track); }
    this.firstFinish = null;
    this.spawn(this.childrenOf(parents));
  }
}
