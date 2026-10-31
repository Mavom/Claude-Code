import { withDefaults, type DeepPartial, type Params } from './params';

export interface Preset {
  id: string;
  name: string;
  note: string;
  params: Params;
  custom?: boolean;
}

// hsl band order: red, orange, yellow, green, aqua, blue, purple, magenta
const hsl = (bands: Partial<Record<number, { h?: number; s?: number; l?: number }>>) =>
  Array.from({ length: 8 }, (_, i) => ({ h: 0, s: 0, l: 0, ...(bands[i] ?? {}) }));

const def = (id: string, name: string, note: string, p: DeepPartial<Params>): Preset => ({
  id,
  name,
  note,
  params: withDefaults(p),
});

/** Start looks derived from the @framesthroughdavid feed. */
export const BUILTIN_PRESETS: Preset[] = [
  def('lost-memory', 'Lost Memory', 'Verblasst, Sepia, Oliv-Grün – wie #snapstory45', {
    contrast: -12,
    highlights: -20,
    shadows: 15,
    temperature: 14,
    vibrance: -20,
    saturation: -22,
    hsl: hsl({ 0: { s: -20 }, 1: { s: -5 }, 2: { h: -10, s: -20 }, 3: { h: -35, s: -45, l: -10 }, 4: { s: -45 }, 5: { s: -55, l: 5 }, 6: { s: -40 }, 7: { s: -40 } }),
    curves: {
      master: [[0, 0.07], [0.25, 0.27], [0.75, 0.75], [1, 0.94]],
      r: [[0, 0], [1, 1]],
      g: [[0, 0], [1, 1]],
      b: [[0, 0.04], [1, 0.92]],
    },
    grading: { shadows: { hue: 30, sat: 18 }, midtones: { hue: 35, sat: 8 }, highlights: { hue: 42, sat: 22 }, balance: 0, blending: 60 },
    fade: 12,
    grain: 35,
    grainSize: 45,
    vignette: -22,
    vignetteFeather: 70,
  }),
  def('aegean-film', 'Aegean Film', 'Türkiser Himmel, warmer Stein – wie Rhodos', {
    contrast: 6,
    highlights: -28,
    shadows: 12,
    temperature: 6,
    vibrance: 10,
    saturation: -6,
    hsl: hsl({ 0: { s: -10 }, 1: { s: 12, l: 6 }, 3: { h: -15, s: -30 }, 4: { s: 10 }, 5: { h: -35, s: -12 } }),
    curves: {
      master: [[0, 0.05], [0.3, 0.28], [0.7, 0.74], [1, 0.96]],
      r: [[0, 0], [1, 1]],
      g: [[0, 0], [1, 1]],
      b: [[0, 0.05], [1, 0.96]],
    },
    grading: { shadows: { hue: 190, sat: 28 }, midtones: { hue: 30, sat: 5 }, highlights: { hue: 36, sat: 22 }, balance: -5, blending: 55 },
    fade: 8,
    grain: 15,
    grainSize: 30,
  }),
  def('winter-stillness', 'Winter Stillness', 'Kühle Schatten, warmes Licht – wie die Bank im Schnee', {
    contrast: 10,
    highlights: -22,
    shadows: 10,
    temperature: -14,
    vibrance: -5,
    saturation: -10,
    clarity: 10,
    hsl: hsl({ 1: { s: 18, l: 5 }, 2: { s: 10 }, 5: { s: -10, l: -6 } }),
    grading: { shadows: { hue: 215, sat: 30 }, midtones: { hue: 210, sat: 6 }, highlights: { hue: 40, sat: 26 }, balance: 10, blending: 50 },
    fade: 8,
    vignette: -16,
  }),
  def('urban-gaze', 'Urban Gaze', 'Schwarzweiß mit Farbakzent – wie das Mural mit Brille', {
    contrast: 25,
    highlights: -15,
    shadows: 10,
    blacks: -10,
    clarity: 30,
    sharpen: 20,
    colorKey: { enabled: true, hue: 30, range: 32, keepSat: 120 },
    curves: {
      master: [[0, 0], [0.25, 0.21], [0.75, 0.8], [1, 1]],
      r: [[0, 0], [1, 1]],
      g: [[0, 0], [1, 1]],
      b: [[0, 0], [1, 1]],
    },
    grain: 15,
    vignette: -30,
  }),
  def('golden-hour', 'Golden Hour', 'Warm, Himmel gezähmt, Grün satt – wie Neckar & Stadtpark', {
    temperature: 16,
    tint: 4,
    contrast: 10,
    highlights: -35,
    shadows: 20,
    vibrance: 18,
    hsl: hsl({ 1: { s: 10, l: 5 }, 2: { h: -10, s: 10 }, 3: { h: -10, s: -5 }, 4: { s: -20 }, 5: { s: -18, l: -10 } }),
    grading: { shadows: { hue: 220, sat: 8 }, midtones: { hue: 35, sat: 4 }, highlights: { hue: 40, sat: 16 }, balance: 0, blending: 50 },
    vignette: -10,
  }),
];

const STORE_KEY = 'look-studio.presets.v1';

export function loadCustomPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Preset[];
    return list.map((p) => ({ ...p, params: withDefaults(p.params), custom: true }));
  } catch {
    return [];
  }
}

export function saveCustomPresets(list: Preset[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.map(({ id, name, note, params }) => ({ id, name, note, params }))));
  } catch {
    /* storage unavailable (private mode) – presets stay for this session only */
  }
}
