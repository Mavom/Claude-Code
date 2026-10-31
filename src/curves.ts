import type { CurvePoint, Curves } from './params';

/**
 * Monotone cubic interpolation (Fritsch–Carlson). Avoids overshoot, so a curve
 * never bends back on itself — the behaviour photographers expect from tone curves.
 */
export function sampleCurve(points: CurvePoint[], size = 256): Float32Array {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const out = new Float32Array(size);
  const n = pts.length;
  if (n === 0) {
    for (let i = 0; i < size; i++) out[i] = i / (size - 1);
    return out;
  }
  if (n === 1) {
    out.fill(pts[0][1]);
    return out;
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i] || 1e-6;
    d.push((ys[i + 1] - ys[i]) / dx);
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let seg = 0;
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1);
    let y: number;
    if (x <= xs[0]) y = ys[0];
    else if (x >= xs[n - 1]) y = ys[n - 1];
    else {
      while (seg < n - 2 && x > xs[seg + 1]) seg++;
      const h = xs[seg + 1] - xs[seg] || 1e-6;
      const t = (x - xs[seg]) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      y =
        (2 * t3 - 3 * t2 + 1) * ys[seg] +
        (t3 - 2 * t2 + t) * h * m[seg] +
        (-2 * t3 + 3 * t2) * ys[seg + 1] +
        (t3 - t2) * h * m[seg + 1];
    }
    out[i] = Math.min(1, Math.max(0, y));
  }
  return out;
}

/** Composite RGB lookup (master applied first, then the channel curve) as RGBA8 bytes. */
export function buildCurveLut(curves: Curves, size = 256): Uint8Array {
  const master = sampleCurve(curves.master, size);
  const r = sampleCurve(curves.r, size);
  const g = sampleCurve(curves.g, size);
  const b = sampleCurve(curves.b, size);
  const lut = new Uint8Array(size * 4);
  const at = (arr: Float32Array, v: number) => {
    const f = v * (size - 1);
    const i = Math.floor(f);
    const j = Math.min(size - 1, i + 1);
    return arr[i] + (arr[j] - arr[i]) * (f - i);
  };
  for (let i = 0; i < size; i++) {
    const v = master[i];
    lut[i * 4] = Math.round(at(r, v) * 255);
    lut[i * 4 + 1] = Math.round(at(g, v) * 255);
    lut[i * 4 + 2] = Math.round(at(b, v) * 255);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

export function isIdentity(points: CurvePoint[]): boolean {
  return points.length === 2 && points[0][0] === 0 && points[0][1] === 0 && points[1][0] === 1 && points[1][1] === 1;
}
