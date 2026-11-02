# Mini Robotaxi 🚕

**Day 8 of 30 Days to MLE · [@buildwithakshita](https://www.instagram.com/buildwithakshita/)**

50 cars learn to drive a city block, live in your browser. Each car has a tiny neural network written from scratch (no ML libraries), and they learn by evolution: no right answers, just "how far did you get?"

**Try it:** https://buildwithakshita.github.io/ml-resources/day-8/robotaxi/

## How it works

1. **It sees.** Each car has 5 sensors that measure how far the lane edge is (far right, right, ahead, left, far left).
2. **It decides.** A 5 → 6 → 2 neural network turns those 5 numbers into *steer* and *speed*. Each neuron multiplies its inputs by weights, adds them up, then a ReLU switch decides whether to pass the signal on. ([`js/nn.js`](js/nn.js))
3. **It crashes.** Generation 1 has random weights, so almost every car leaves the road within seconds.
4. **The best ones pass it on.** After each generation, the champion survives unchanged and the rest of the next 50 are mutated copies of the top 10. When progress stalls it mutates more boldly and adds a few brand-new brains. ([`js/evolve.js`](js/evolve.js))

Fitness = metres driven along the road, plus a bonus for finishing the lap quickly. In headless test runs the first full lap usually arrives within 10–15 generations, sometimes as late as ~30 (evolution is random). Use 10× speed if you're impatient.

## Modes

| Mode | What it does |
|---|---|
| **Learn** | Watch 50 cars evolve. 1× / 3× / 10× speed, chase or top-down view, live brain panel |
| **Gen 1 vs now** | Split screen: fresh random brains vs your current champion |
| **Drive** | Drive it yourself (arrow keys / WASD, or the on-screen buttons) |
| **Robotaxi** | The trained brain does pickups and drop-offs on its own. A simple trip planner only decides when to slow down and stop; the network does all the steering |
| **◎ Clean view** | Hides every button so you can screen-record (tap the screen or press **H** to bring them back) |

It works offline after the first visit (add it to your home screen), and remembers your best brain on that device.

## Files

```
index.html, style.css      page + robotaxi-screen styling
js/track.js                the city loop, lane map, progress along the road
js/car.js                  driving physics, 5 sensors, crash detection
js/nn.js                   the neural network, from scratch
js/evolve.js               neuroevolution (selection + mutation)
js/world.js                3D city: road, markings, buildings, lamps, parked cars
js/brainview.js            the live brain panel
js/pretrained.js           a brain trained ahead of time with this code (robotaxi mode fallback)
js/main.js                 rendering, camera, modes, HUD
sw.js, manifest.webmanifest  offline + install
vendor/three.module.min.js Three.js r160 (MIT) for the 3D graphics only
tests/nn.test.mjs          checks the neural network maths
```

## Run it locally

```bash
cd day-8/robotaxi
python3 -m http.server 8000      # then open http://localhost:8000
node --test tests/*.test.mjs     # neural network tests
```

Not affiliated with Waymo or Tesla: this is a learning project. Real robotaxis use cameras, lidar, radar, maps and models trained on millions of miles; this one has 5 sensors and 50 numbers in its brain (42 weights + 8 biases).
