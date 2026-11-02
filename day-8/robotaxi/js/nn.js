// A tiny neural network written from scratch — no ML libraries.
// 5 sensor inputs → 6 hidden neurons → 2 outputs (steer, speed).
//
// Each neuron does exactly what Day 7 showed:
//   1. multiply every input by how important it is (its weight)
//   2. add them up, plus a bias
//   3. the switch: is it important enough? (ReLU for hidden neurons)

export const LAYERS = [5, 6, 2];

function gauss() {
  // a random number from a bell curve (Box–Muller)
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Brain {
  constructor(weights = null) {
    // weights[l][j][i] = importance of neuron i (layer l) for neuron j (layer l+1); biases[l][j]
    if (weights) {
      this.weights = weights.weights.map(m => m.map(r => r.slice()));
      this.biases = weights.biases.map(b => b.slice());
    } else {
      this.weights = []; this.biases = [];
      for (let l = 0; l < LAYERS.length - 1; l++) {
        const nin = LAYERS[l], nout = LAYERS[l + 1];
        this.weights.push(Array.from({ length: nout }, () => Array.from({ length: nin }, () => gauss() * 0.6)));
        this.biases.push(Array.from({ length: nout }, () => gauss() * 0.5));
      }
    }
    this.activations = LAYERS.map(n => new Array(n).fill(0)); // kept for the brain panel
  }

  // Feed the sensor readings through the network.
  forward(inputs) {
    let a = inputs.slice();
    this.activations[0] = a;
    for (let l = 0; l < this.weights.length; l++) {
      const W = this.weights[l], b = this.biases[l];
      const out = new Array(W.length);
      const last = l === this.weights.length - 1;
      for (let j = 0; j < W.length; j++) {
        let sum = b[j];
        for (let i = 0; i < a.length; i++) sum += W[j][i] * a[i];   // multiply + add up
        out[j] = last ? sum : Math.max(0, sum);                       // the ReLU switch
      }
      a = out;
      this.activations[l + 1] = a;
    }
    return a;
  }

  // Turn the two outputs into driving controls.
  decide(inputs) {
    const [s, v] = this.forward(inputs);
    const steer = Math.tanh(s);                 // -1 (right) … +1 (left)
    const throttle = 1 / (1 + Math.exp(-v));    // 0 (slow) … 1 (fast)
    this.activations[2] = [steer, throttle];
    return [steer, throttle];
  }

  // A copy with small random changes — how evolution explores.
  mutate(rate = 0.15, amount = 0.5) {
    const child = new Brain(this.toJSON());
    for (const W of child.weights) for (const row of W) for (let i = 0; i < row.length; i++)
      if (Math.random() < rate) row[i] += gauss() * amount;
    for (const b of child.biases) for (let j = 0; j < b.length; j++)
      if (Math.random() < rate) b[j] += gauss() * amount;
    return child;
  }

  toJSON() { return { weights: this.weights, biases: this.biases }; }
}
