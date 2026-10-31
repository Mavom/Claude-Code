import type { Tone } from '../params';
import { el, sizeCanvas } from './controls';

/** Hue/saturation wheel for colour grading. Angle = hue, distance from centre = strength. */
export class ColorWheel {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private readout: HTMLElement;

  constructor(
    label: string,
    private get: () => Tone,
    private onChange: () => void,
    private onCommit: () => void,
  ) {
    this.canvas = el('canvas', { class: 'wheel-canvas' });
    this.readout = el('span', { class: 'wheel-readout' });
    const reset = () => {
      const t = this.get();
      t.sat = 0;
      this.onChange();
      this.onCommit();
      this.draw();
    };
    this.el = el(
      'div',
      { class: 'wheel' },
      el('div', { class: 'wheel-head', ondblclick: reset, title: 'Doppeltippen zum Zurücksetzen' }, el('span', {}, label), this.readout),
      this.canvas,
    );
    this.bind();
    new ResizeObserver(() => this.draw()).observe(this.canvas);
  }

  private bind() {
    const c = this.canvas;
    let active = false;
    const set = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const rad = r.width / 2 - 6;
      const t = this.get();
      t.hue = Math.round(((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360);
      t.sat = Math.round(Math.min(1, Math.hypot(dx, dy) / rad) * 100);
      this.onChange();
      this.draw();
    };
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      active = true;
      c.setPointerCapture(e.pointerId);
      set(e);
    });
    c.addEventListener('pointermove', (e) => active && set(e));
    const end = () => {
      if (!active) return;
      active = false;
      this.onCommit();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  draw() {
    const { w, h, dpr } = sizeCanvas(this.canvas);
    if (Math.min(w, h) < 20 * dpr) return; // not laid out yet; ResizeObserver redraws
    const ctx = this.canvas.getContext('2d')!;
    const cx = w / 2;
    const cy = h / 2;
    const rad = Math.min(w, h) / 2 - 6 * dpr;
    ctx.clearRect(0, 0, w, h);
    // conic gradient: hue increases counter-clockwise, 0° = right (matches pointer maths)
    const g = ctx.createConicGradient(0, cx, cy);
    for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, `hsl(${360 - i * 30} 70% 55%)`);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    const r = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    r.addColorStop(0, 'rgba(40,40,40,1)');
    r.addColorStop(1, 'rgba(40,40,40,0)');
    ctx.fillStyle = r;
    ctx.fill();
    const t = this.get();
    const a = (t.hue * Math.PI) / 180;
    const d = (t.sat / 100) * rad;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy - Math.sin(a) * d, 7 * dpr, 0, Math.PI * 2);
    ctx.lineWidth = 2.5 * dpr;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    this.readout.textContent = t.sat ? `${t.hue}° · ${t.sat}` : '–';
  }
}
