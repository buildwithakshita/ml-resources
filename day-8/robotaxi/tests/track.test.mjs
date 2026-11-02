// Run with: node --test day-8/robotaxi/tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { Track, randomTrack, startIndexFor, spotsFor } from '../js/track.js';

test('the same seed always makes the same road', () => {
  assert.deepEqual(randomTrack(42).centre.slice(0, 50), randomTrack(42).centre.slice(0, 50));
  assert.notDeepEqual(randomTrack(42).centre.slice(0, 50), randomTrack(43).centre.slice(0, 50));
});

test('random roads never run into themselves and have a sensible length', () => {
  for (let s = 1; s <= 60; s++) {
    const t = randomTrack(s);
    assert.ok(t.separated(), `road ${s} overlaps itself`);
    assert.ok(t.length >= 430 && t.length <= 640, `road ${s} is ${t.length} m`);
  }
});

test('every road has a start on a straight and at least 2 stops', () => {
  for (const t of [new Track(), randomTrack(7), randomTrack(99)]) {
    const s = startIndexFor(t);
    assert.ok(s >= 0 && s < t.n);
    assert.ok(t.drivable(...t.at(s, 2.5)));
    assert.ok(spotsFor(t, 3).length >= 2 || t.seed === null);
  }
});
