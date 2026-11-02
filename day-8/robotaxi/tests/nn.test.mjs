// Run with: node --test day-8/robotaxi/tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain, LAYERS } from '../js/nn.js';

test('network shape is 5 → 6 → 2', () => {
  const b = new Brain();
  assert.deepEqual(LAYERS, [5, 6, 2]);
  assert.equal(b.weights[0].length, 6); assert.equal(b.weights[0][0].length, 5);
  assert.equal(b.weights[1].length, 2); assert.equal(b.weights[1][0].length, 6);
});

test('a neuron multiplies, adds up, then the ReLU switch', () => {
  const b = new Brain();
  // make the network tiny and readable: hidden neuron 0 = 2·x0 + 0.5·x1 + 1·x2, everything else 0
  b.weights[0] = b.weights[0].map(r => r.map(() => 0)); b.biases[0] = b.biases[0].map(() => 0);
  b.weights[0][0] = [2, 0.5, 1, 0, 0];
  b.weights[0][1] = [-5, 0, 0, 0, 0];            // will be negative → switched off
  b.weights[1] = [[1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]]; b.biases[1] = [0, 0];
  const out = b.forward([0.9, 0.2, 0.7, 0, 0]);
  assert.equal(Math.round(b.activations[1][0] * 10) / 10, 2.6);   // 0.9×2 + 0.2×0.5 + 0.7×1
  assert.equal(b.activations[1][1], 0);                            // ReLU: not important enough → 0
  assert.equal(Math.round(out[0] * 10) / 10, 2.6);
});

test('decide() turns outputs into steer (-1..1) and throttle (0..1)', () => {
  const b = new Brain();
  for (let k = 0; k < 50; k++) {
    const [s, t] = b.decide(Array.from({ length: 5 }, () => Math.random()));
    assert.ok(s >= -1 && s <= 1); assert.ok(t >= 0 && t <= 1);
  }
});

test('mutate() makes a changed copy and leaves the parent alone', () => {
  const p = new Brain(); const before = JSON.stringify(p.toJSON());
  const c = p.mutate(1, 0.5);
  assert.equal(JSON.stringify(p.toJSON()), before);
  assert.notEqual(JSON.stringify(c.toJSON()), before);
});
