// Edit parameters: the complete, serialisable description of an edit.
// The original image is never changed; only this object is.

export type CurvePoint = [number, number]; // x, y in 0..1

export interface Curves {
  master: CurvePoint[];
  r: CurvePoint[];
  g: CurvePoint[];
  b: CurvePoint[];
}

export const HSL_BANDS = [
  { key: 'red', label: 'Rot', hue: 0, color: '#e5484d' },
  { key: 'orange', label: 'Orange', hue: 30, color: '#f76b15' },
  { key: 'yellow', label: 'Gelb', hue: 58, color: '#ffc53d' },
  { key: 'green', label: 'Grün', hue: 120, color: '#30a46c' },
  { key: 'aqua', label: 'Türkis', hue: 180, color: '#12a594' },
  { key: 'blue', label: 'Blau', hue: 220, color: '#3e63dd' },
  { key: 'purple', label: 'Lila', hue: 275, color: '#8e4ec6' },
  { key: 'magenta', label: 'Magenta', hue: 320, color: '#d6409f' },
] as const;

export interface HslBand {
  h: number; // -100..100  (hue shift)
  s: number; // -100..100  (saturation)
  l: number; // -100..100  (luminance)
}

export interface Tone {
  hue: number; // 0..360
  sat: number; // 0..100
}

export interface Params {
  // Licht
  exposure: number; // -100..100 (→ ±2 EV)
  contrast: number; // -100..100
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  // Farbe
  temperature: number; // -100..100
  tint: number;
  vibrance: number;
  saturation: number;
  // Details
  clarity: number; // -100..100
  sharpen: number; // 0..100
  // HSL
  hsl: HslBand[]; // 8 bands
  // Color key (Schwarzweiß mit Farbakzent)
  colorKey: { enabled: boolean; hue: number; range: number; keepSat: number };
  mono: number; // 0..100 Schwarzweiß-Anteil (ohne Color Key)
  // Kurven
  curves: Curves;
  // Color Grading
  grading: { shadows: Tone; midtones: Tone; highlights: Tone; balance: number; blending: number };
  // Effekte
  fade: number; // 0..100
  grain: number; // 0..100
  grainSize: number; // 0..100
  vignette: number; // -100..100
  vignetteMidpoint: number; // 0..100
  vignetteRoundness: number; // 0..100 (100 = Kreis)
  vignetteFeather: number; // 0..100
}

const linearCurve = (): CurvePoint[] => [
  [0, 0],
  [1, 1],
];

export function defaultParams(): Params {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    clarity: 0,
    sharpen: 0,
    hsl: HSL_BANDS.map(() => ({ h: 0, s: 0, l: 0 })),
    colorKey: { enabled: false, hue: 30, range: 30, keepSat: 100 },
    mono: 0,
    curves: { master: linearCurve(), r: linearCurve(), g: linearCurve(), b: linearCurve() },
    grading: {
      shadows: { hue: 200, sat: 0 },
      midtones: { hue: 30, sat: 0 },
      highlights: { hue: 40, sat: 0 },
      balance: 0,
      blending: 50,
    },
    fade: 0,
    grain: 0,
    grainSize: 30,
    vignette: 0,
    vignetteMidpoint: 50,
    vignetteRoundness: 50,
    vignetteFeather: 50,
  };
}

export function cloneParams(p: Params): Params {
  return structuredClone(p);
}

/** Merge a partial (e.g. a preset) onto defaults, so old presets keep working. */
export function withDefaults(partial: DeepPartial<Params>): Params {
  const base = defaultParams();
  return deepMerge(base, partial) as Params;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function deepMerge(target: any, src: any): any {
  if (src === undefined || src === null) return target;
  if (Array.isArray(src)) return structuredClone(src);
  if (typeof src !== 'object') return src;
  const out: any = Array.isArray(target) ? [...target] : { ...target };
  for (const k of Object.keys(src)) {
    out[k] = typeof src[k] === 'object' && src[k] !== null && !Array.isArray(src[k]) && target?.[k] !== undefined
      ? deepMerge(target[k], src[k])
      : structuredClone(src[k]);
  }
  return out;
}

/** Blend between neutral defaults and a look, used for the preset strength slider. */
export function blendParams(look: Params, amount: number): Params {
  const base = defaultParams();
  const t = Math.max(0, Math.min(1, amount));
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const walk = (a: any, b: any): any => {
    if (typeof a === 'number' && typeof b === 'number') return lerp(a, b);
    if (Array.isArray(a) && Array.isArray(b)) {
      // Curves: interpolate point positions toward the look's curve only if shapes match;
      // otherwise blend each look point toward the diagonal.
      if (b.length && Array.isArray(b[0])) {
        return (b as CurvePoint[]).map(([x, y]) => [x, lerp(x, y)] as CurvePoint);
      }
      return b.map((v: any, i: number) => walk(a[i], v));
    }
    if (typeof a === 'object' && a && typeof b === 'object' && b) {
      const o: any = {};
      for (const k of Object.keys(b)) o[k] = walk(a[k], b[k]);
      return o;
    }
    return t > 0.5 ? b : a; // booleans: take the look's value from 50 %
  };
  const out = walk(base, look) as Params;
  // Hues must not be interpolated (would rotate through other colours)
  out.colorKey.hue = look.colorKey.hue;
  out.colorKey.enabled = look.colorKey.enabled && t > 0;
  out.grading.shadows.hue = look.grading.shadows.hue;
  out.grading.midtones.hue = look.grading.midtones.hue;
  out.grading.highlights.hue = look.grading.highlights.hue;
  return out;
}
