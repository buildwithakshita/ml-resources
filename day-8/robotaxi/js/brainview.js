// Draws the watched car's neural network on a 2D canvas, live.
// Lines = weights (tan = "push", cream = "pull back"), brightness = how much signal flows through right now.
import { LAYERS } from './nn.js';

const IN_LABELS = ['far right', 'right', 'ahead', 'left', 'far left'];

export class BrainView {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
  }

  size() {
    const r = this.c.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width * d), H = Math.round(r.height * d);
    if (this.c.width !== W || this.c.height !== H) { this.c.width = W; this.c.height = H; }
    return { w: r.width, h: r.height, d };
  }

  draw(brain) {
    const { w, h, d } = this.size();
    const ctx = this.ctx;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!brain) return;
    const xs = [w * 0.27, w * 0.55, w * 0.8];
    const ys = LAYERS.map(n => Array.from({ length: n }, (_, i) => n === 1 ? h / 2 : 18 + i * (h - 30) / (n - 1)));
    ys[2] = [h * 0.33, h * 0.72];
    const act = brain.activations;

    // connections
    for (let l = 0; l < 2; l++) {
      const W = brain.weights[l];
      for (let j = 0; j < W.length; j++) for (let i = 0; i < W[j].length; i++) {
        const w8 = W[j][i];
        const flow = Math.min(1, Math.abs(w8 * (act[l][i] || 0)) / 1.5);
        ctx.strokeStyle = w8 >= 0 ? `rgba(221,160,94,${0.08 + flow * 0.85})` : `rgba(254,250,223,${0.05 + flow * 0.55})`;
        ctx.lineWidth = 0.6 + Math.min(2.4, Math.abs(w8)) * (0.3 + flow);
        ctx.beginPath(); ctx.moveTo(xs[l], ys[l][i]); ctx.lineTo(xs[l + 1], ys[l + 1][j]); ctx.stroke();
      }
    }
    // neurons
    ctx.font = '600 10.5px Montserrat, sans-serif'; ctx.textBaseline = 'middle';
    for (let l = 0; l < 3; l++) {
      ys[l].forEach((y, i) => {
        let v = act[l][i] || 0;
        if (l === 1) v = Math.min(1, v / 2);           // hidden: ReLU output, 0 = quiet
        if (l === 2) v = i === 0 ? Math.abs(v) : v;    // steer magnitude, throttle
        const r = l === 1 ? 7 : 8;
        ctx.beginPath(); ctx.arc(xs[l], y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(221,160,94,${0.12 + Math.max(0, Math.min(1, v)) * 0.88})`;
        ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(254,250,223,.75)'; ctx.stroke();
      });
    }
    // labels
    ctx.fillStyle = 'rgba(254,250,223,.78)'; ctx.textAlign = 'right';
    ys[0].forEach((y, i) => ctx.fillText(IN_LABELS[i], xs[0] - 13, y));
    ctx.textAlign = 'left';
    const steer = act[2][0] || 0, thr = act[2][1] || 0;
    ctx.fillStyle = '#FEFADF'; ctx.font = '700 11px Montserrat, sans-serif';
    ctx.fillText('steer', xs[2] + 14, ys[2][0] - 8);
    ctx.fillText('speed', xs[2] + 14, ys[2][1] - 8);
    // steer gauge: a little bar that leans left or right
    const gx = xs[2] + 14, gw = Math.max(30, w - gx - 10);
    ctx.fillStyle = 'rgba(254,250,223,.15)'; ctx.fillRect(gx, ys[2][0] + 4, gw, 4);
    ctx.fillStyle = '#DDA05E';
    const mid = gx + gw / 2, len = -steer * gw / 2;      // +steer = left
    ctx.fillRect(Math.min(mid, mid + len), ys[2][0] + 4, Math.abs(len), 4);
    ctx.fillRect(mid - 0.5, ys[2][0] + 1, 1, 10);
    ctx.fillStyle = 'rgba(254,250,223,.15)'; ctx.fillRect(gx, ys[2][1] + 4, gw, 4);
    ctx.fillStyle = '#DDA05E'; ctx.fillRect(gx, ys[2][1] + 4, gw * thr, 4);
  }
}
