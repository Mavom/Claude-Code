import type { CurvePoint, Curves } from '../params';
import { sampleCurve } from '../curves';
import { el, sizeCanvas } from './controls';

type Channel = keyof Curves;
const CH: { key: Channel; label: string; color: string }[] = [
  { key: 'master', label: 'RGB', color: '#f2f2f2' },
  { key: 'r', label: 'Rot', color: '#ff5c5c' },
  { key: 'g', label: 'Grün', color: '#4cd17a' },
  { key: 'b', label: 'Blau', color: '#5c8dff' },
];

/**
 * Touch curve editor.
 * - Tap on the curve/empty area adds a point, drag moves it.
 * - Drag an inner point out of the box, or double-tap it, to remove it.
 */
export class CurveEditor {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private channel: Channel = 'master';
  private dragIdx = -1;
  private histogram: Float32Array | null = null;
  private chButtons: HTMLButtonElement[] = [];
  private lastTap = { t: 0, idx: -1 };

  constructor(
    private get: () => Curves,
    private onChange: () => void,
    private onCommit: () => void,
  ) {
    this.canvas = el('canvas', { class: 'curve-canvas' });
    const bar = el('div', { class: 'chips' });
    for (const c of CH) {
      const b = el('button', { class: 'chip', style: { '--chip': c.color } as any, onclick: () => this.setChannel(c.key) }, c.label);
      this.chButtons.push(b);
      bar.append(b);
    }
    const reset = el('button', { class: 'chip ghost', onclick: () => this.resetChannel() }, 'Zurücksetzen');
    bar.append(reset);
    const hint = el('p', { class: 'hint' }, 'Tippen = Punkt setzen · Ziehen = formen · Punkt aus dem Feld ziehen oder doppeltippen = löschen');
    this.el = el('div', { class: 'curve-editor' }, bar, el('div', { class: 'curve-box' }, this.canvas), hint);
    this.bind();
    this.setChannel('master');
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  setHistogram(h: Float32Array | null) {
    this.histogram = h;
    this.draw();
  }

  private setChannel(k: Channel) {
    this.channel = k;
    this.chButtons.forEach((b, i) => b.classList.toggle('active', CH[i].key === k));
    this.draw();
  }

  private resetChannel() {
    this.get()[this.channel] = [
      [0, 0],
      [1, 1],
    ];
    this.onChange();
    this.onCommit();
    this.draw();
  }

  private pts(): CurvePoint[] {
    return this.get()[this.channel];
  }

  private toLocal(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: 1 - (e.clientY - r.top) / r.height,
      px: e.clientX - r.left,
      py: e.clientY - r.top,
      w: r.width,
      h: r.height,
    };
  }

  private bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      const p = this.toLocal(e);
      const pts = this.pts();
      // nearest point within 28 css px
      let best = -1;
      let bestD = 28;
      pts.forEach(([x, y], i) => {
        const d = Math.hypot(x * p.w - p.px, (1 - y) * p.h - p.py);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      const now = performance.now();
      if (best >= 0 && this.lastTap.idx === best && now - this.lastTap.t < 350 && best > 0 && best < pts.length - 1) {
        pts.splice(best, 1);
        this.lastTap = { t: 0, idx: -1 };
        this.dragIdx = -1;
        this.onChange();
        this.onCommit();
        this.draw();
        return;
      }
      this.lastTap = { t: now, idx: best };
      if (best < 0) {
        const x = clamp01(p.x);
        const y = clamp01(p.y);
        pts.push([x, y]);
        pts.sort((a, b) => a[0] - b[0]);
        best = pts.findIndex((q) => q[0] === x && q[1] === y);
        this.lastTap = { t: now, idx: best };
        this.onChange();
      }
      this.dragIdx = best;
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      if (this.dragIdx < 0) return;
      const p = this.toLocal(e);
      const pts = this.pts();
      const i = this.dragIdx;
      const inner = i > 0 && i < pts.length - 1;
      const outside = p.y < -0.12 || p.y > 1.12 || p.x < -0.12 || p.x > 1.12;
      if (inner && outside) {
        pts.splice(i, 1);
        this.dragIdx = -1;
        this.onChange();
        this.draw();
        return;
      }
      const lo = i > 0 ? pts[i - 1][0] + 0.01 : 0;
      const hi = i < pts.length - 1 ? pts[i + 1][0] - 0.01 : 1;
      pts[i] = [Math.min(hi, Math.max(lo, p.x)), clamp01(p.y)];
      this.onChange();
      this.draw();
    });
    const end = () => {
      this.onCommit(); // history ignores unchanged states
      this.dragIdx = -1;
      this.draw();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  draw() {
    const { w, h, dpr } = sizeCanvas(this.canvas);
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    // histogram
    if (this.histogram) {
      const hist = this.histogram;
      let max = 0;
      for (let i = 2; i < hist.length - 2; i++) max = Math.max(max, hist[i]);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < hist.length; i++) {
        ctx.lineTo((i / (hist.length - 1)) * w, h - Math.min(1, hist[i] / (max || 1)) * h * 0.9);
      }
      ctx.lineTo(w, h);
      ctx.fill();
    }
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1 * dpr;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((w * i) / 4, 0);
      ctx.lineTo((w * i) / 4, h);
      ctx.moveTo(0, (h * i) / 4);
      ctx.lineTo(w, (h * i) / 4);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.moveTo(0, h);
    ctx.lineTo(w, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    // other channels faintly
    for (const c of CH) {
      if (c.key === this.channel) continue;
      this.drawCurve(ctx, this.get()[c.key], w, h, c.color, 0.25, dpr);
    }
    const col = CH.find((c) => c.key === this.channel)!.color;
    this.drawCurve(ctx, this.pts(), w, h, col, 1, dpr);
    for (const [i, [x, y]] of this.pts().entries()) {
      ctx.beginPath();
      ctx.arc(x * w, (1 - y) * h, (i === this.dragIdx ? 9 : 6) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#111';
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = col;
      ctx.stroke();
    }
  }

  private drawCurve(ctx: CanvasRenderingContext2D, pts: CurvePoint[], w: number, h: number, color: string, alpha: number, dpr: number) {
    const s = sampleCurve(pts, 128);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    for (let i = 0; i < s.length; i++) {
      const x = (i / (s.length - 1)) * w;
      const y = (1 - s[i]) * h;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
