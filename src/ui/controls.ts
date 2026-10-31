// Small DOM helpers and touch-friendly controls.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, any> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) e.append(c);
  return e;
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step?: number;
  get: () => number;
  set: (v: number) => void;
  commit: () => void;
  reset?: number;
  track?: string; // CSS background for the track (e.g. hue gradient)
  format?: (v: number) => string;
}

/** Slider row. Double-tap the label (or the value) to reset. */
export function slider(o: SliderOpts) {
  const input = el('input', {
    type: 'range',
    min: o.min,
    max: o.max,
    step: o.step ?? 1,
    'aria-label': o.label,
  }) as HTMLInputElement;
  const value = el('span', { class: 'slider-value' });
  const fmt = o.format ?? ((v: number) => (v > 0 && o.min < 0 ? `+${Math.round(v)}` : `${Math.round(v)}`));
  const sync = () => {
    const v = o.get();
    input.value = String(v);
    value.textContent = fmt(v);
    const pct = ((v - o.min) / (o.max - o.min)) * 100;
    const zero = o.min < 0 ? ((0 - o.min) / (o.max - o.min)) * 100 : 0;
    input.style.setProperty('--from', `${Math.min(pct, zero)}%`);
    input.style.setProperty('--to', `${Math.max(pct, zero)}%`);
    row.classList.toggle('changed', v !== (o.reset ?? 0));
  };
  if (o.track) input.style.setProperty('--track', o.track);
  input.addEventListener('input', () => {
    o.set(Number(input.value));
    sync();
  });
  input.addEventListener('change', () => o.commit());
  const reset = () => {
    o.set(o.reset ?? 0);
    sync();
    o.commit();
  };
  const label = el('label', { class: 'slider-label' }, o.label);
  const head = el('div', { class: 'slider-head', ondblclick: reset, title: 'Doppeltippen zum Zurücksetzen' }, label, value);
  const row = el('div', { class: 'slider' + (o.track ? ' custom-track' : '') }, head, input);
  sync();
  return { el: row, sync };
}

export function toggle(label: string, get: () => boolean, set: (v: boolean) => void) {
  const input = el('input', { type: 'checkbox', role: 'switch' }) as HTMLInputElement;
  const sync = () => (input.checked = get());
  input.addEventListener('change', () => set(input.checked));
  sync();
  return { el: el('label', { class: 'toggle' }, el('span', {}, label), input), sync };
}

export const HUE_TRACK =
  'linear-gradient(90deg,hsl(0 80% 55%),hsl(60 80% 55%),hsl(120 80% 45%),hsl(180 80% 45%),hsl(240 80% 60%),hsl(300 80% 55%),hsl(360 80% 55%))';

/** Hi-DPI canvas that tracks its CSS size. */
export function sizeCanvas(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const r = c.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return { w, h, dpr };
}
