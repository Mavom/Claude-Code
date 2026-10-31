import './style.css';
import { Renderer } from './gl/renderer';
import { blendParams, cloneParams, defaultParams, HSL_BANDS, type Params } from './params';
import { BUILTIN_PRESETS, loadCustomPresets, saveCustomPresets, type Preset } from './presets';
import { encodeJpeg, fullResCanvas, loadImage, sampleHue, type LoadedImage } from './image';
import { el, HUE_TRACK, slider, toggle } from './ui/controls';
import { CurveEditor } from './ui/curve-editor';
import { ColorWheel } from './ui/color-wheel';

// ---------------------------------------------------------------- state
let params: Params = defaultParams();
let image: LoadedImage | null = null;
let comparing = false;
let pickingKey = false;
let activePreset: Preset | null = null;
let presetStrength = 100;
let customPresets = loadCustomPresets();
let hslBand = 5; // Blau – the band most of the feed needs (skies)

const history: string[] = [JSON.stringify(params)];
let hIndex = 0;

// ---------------------------------------------------------------- DOM
const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true }) as HTMLInputElement;
const view = el('canvas', { class: 'view' });
const btnUndo = el('button', { class: 'icon-btn', title: 'Rückgängig', 'aria-label': 'Rückgängig', onclick: () => undo() }, icon('undo'));
const btnRedo = el('button', { class: 'icon-btn', title: 'Wiederholen', 'aria-label': 'Wiederholen', onclick: () => redo() }, icon('redo'));
const btnCompare = el('button', { class: 'icon-btn', title: 'Gedrückt halten: Original', 'aria-label': 'Vorher/Nachher' }, icon('compare'));
const btnExport = el('button', { class: 'primary', onclick: () => openExport() }, 'Sichern');
const badge = el('div', { class: 'badge', hidden: true }, 'Original');
const toastEl = el('div', { class: 'toast', role: 'status' });
const empty = el(
  'div',
  { class: 'empty' },
  el('div', { class: 'logo' }, icon('aperture')),
  el('h1', {}, 'Look Studio'),
  el('p', {}, 'Öffne ein Foto aus deiner Mediathek. Alles bleibt auf deinem Gerät.'),
  el('button', { class: 'primary big', onclick: () => fileInput.click() }, 'Foto öffnen'),
);
const stage = el('main', { class: 'stage' }, view, empty, badge, toastEl);
const panel = el('section', { class: 'panel' });
const tabsEl = el('nav', { class: 'tabs' });
const topbar = el(
  'header',
  { class: 'topbar' },
  el('button', { class: 'ghost', onclick: () => fileInput.click() }, 'Öffnen'),
  el('div', { class: 'spacer' }),
  btnUndo,
  btnRedo,
  btnCompare,
  btnExport,
);
const side = el('div', { class: 'side' }, tabsEl, panel);
document.getElementById('app')!.append(topbar, stage, side, fileInput);

let renderer: Renderer;
let thumbRenderer: Renderer | null = null;
try {
  renderer = new Renderer(view);
} catch (e) {
  empty.replaceChildren(el('h1', {}, 'Nicht unterstützt'), el('p', {}, String((e as Error).message)));
  throw e;
}

// ---------------------------------------------------------------- render
let raf = 0;
function scheduleRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    if (renderer.hasImage) renderer.render(params, comparing);
  });
}

function layoutCanvas() {
  if (!image) return;
  const r = stage.getBoundingClientRect();
  const pad = 12;
  const aw = r.width - pad * 2;
  const ah = r.height - pad * 2;
  const s = Math.min(aw / image.width, ah / image.height);
  const cw = Math.max(1, Math.floor(image.width * s));
  const ch = Math.max(1, Math.floor(image.height * s));
  view.style.width = `${cw}px`;
  view.style.height = `${ch}px`;
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.min(image.preview.width, Math.round(cw * dpr));
  view.width = bw;
  view.height = Math.round((bw * image.height) / image.width);
  scheduleRender();
}
new ResizeObserver(layoutCanvas).observe(stage);

// ---------------------------------------------------------------- history
function commit() {
  const s = JSON.stringify(params);
  if (s === history[hIndex]) return;
  history.splice(hIndex + 1);
  history.push(s);
  if (history.length > 150) history.shift();
  hIndex = history.length - 1;
  syncHistoryButtons();
}
function undo() {
  if (hIndex === 0) return;
  hIndex--;
  params = JSON.parse(history[hIndex]);
  afterExternalChange();
}
function redo() {
  if (hIndex >= history.length - 1) return;
  hIndex++;
  params = JSON.parse(history[hIndex]);
  afterExternalChange();
}
function syncHistoryButtons() {
  btnUndo.disabled = hIndex === 0;
  btnRedo.disabled = hIndex >= history.length - 1;
}
function afterExternalChange() {
  syncHistoryButtons();
  buildPanel();
  scheduleRender();
}

// ---------------------------------------------------------------- compare & picking
function setComparing(on: boolean) {
  comparing = on;
  badge.hidden = !on;
  scheduleRender();
}
btnCompare.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  setComparing(true);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btnCompare.addEventListener(ev, () => setComparing(false)));

view.addEventListener('pointerdown', (e) => {
  if (!image) return;
  if (pickingKey) {
    const r = view.getBoundingClientRect();
    const { hue, sat } = sampleHue(image, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (sat < 0.12) {
      toast('Diese Stelle ist fast farblos – tippe auf eine kräftigere Farbe.');
      return;
    }
    params.colorKey.enabled = true;
    params.colorKey.hue = hue;
    pickingKey = false;
    stage.classList.remove('picking');
    commit();
    buildPanel();
    scheduleRender();
    toast(`Farbe gewählt: ${hue}°`);
    return;
  }
  setComparing(true);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => view.addEventListener(ev, () => comparing && setComparing(false)));

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (e.key === '\\' && !e.repeat) setComparing(true);
});
window.addEventListener('keyup', (e) => e.key === '\\' && setComparing(false));

let toastTimer = 0;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------- open
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (!f) return;
  try {
    const li = await loadImage(f);
    if (image) URL.revokeObjectURL(image.url);
    image = li;
    renderer.setImage(li.preview, li.preview.width, li.preview.height, li.width, li.height);
    empty.hidden = true;
    document.body.classList.add('has-image');
    curveEditor?.setHistogram(li.histogram);
    layoutCanvas();
    renderThumbs();
    if (activeTab === 'looks') buildPanel();
  } catch (e) {
    toast((e as Error).message);
  }
});

// ---------------------------------------------------------------- tabs & panels
type Tab = 'looks' | 'light' | 'color' | 'hsl' | 'curves' | 'grading' | 'effects';
const TABS: { key: Tab; label: string }[] = [
  { key: 'looks', label: 'Looks' },
  { key: 'light', label: 'Licht' },
  { key: 'color', label: 'Farbe' },
  { key: 'hsl', label: 'HSL' },
  { key: 'curves', label: 'Kurven' },
  { key: 'grading', label: 'Grading' },
  { key: 'effects', label: 'Effekte' },
];
let activeTab: Tab = 'looks';
const tabButtons = TABS.map((t) =>
  el('button', { class: 'tab', onclick: () => setTab(t.key) }, t.label),
);
tabsEl.append(...tabButtons);

function setTab(t: Tab) {
  activeTab = t;
  if (pickingKey && t !== 'color') {
    pickingKey = false;
    stage.classList.remove('picking');
  }
  tabButtons.forEach((b, i) => b.classList.toggle('active', TABS[i].key === t));
  buildPanel();
}

/** Slider bound to a numeric property of the live params object. */
function num(label: string, get: () => number, set: (v: number) => void, o: Partial<{ min: number; max: number; reset: number; track: string; format: (v: number) => string }> = {}) {
  return slider({
    label,
    min: o.min ?? -100,
    max: o.max ?? 100,
    reset: o.reset ?? 0,
    track: o.track,
    format: o.format,
    get,
    set: (v) => {
      set(v);
      activePresetDirty();
      scheduleRender();
    },
    commit,
  }).el;
}
const p = () => params;
const group = (title: string, ...children: Node[]) => el('div', { class: 'group' }, el('h3', {}, title), ...children);

let curveEditor: CurveEditor | null = null;

function activePresetDirty() {
  // Manual tweaks after applying a look: keep the look highlighted but hide strength
  if (activePreset && activeTab !== 'looks') presetTweaked = true;
}
let presetTweaked = false;

function buildPanel() {
  panel.replaceChildren();
  panel.scrollTop = 0;
  switch (activeTab) {
    case 'looks':
      panel.append(buildLooks());
      break;
    case 'light':
      panel.append(
        group(
          'Licht',
          num('Belichtung', () => p().exposure, (v) => (p().exposure = v)),
          num('Kontrast', () => p().contrast, (v) => (p().contrast = v)),
          num('Lichter', () => p().highlights, (v) => (p().highlights = v)),
          num('Tiefen', () => p().shadows, (v) => (p().shadows = v)),
          num('Weiß', () => p().whites, (v) => (p().whites = v)),
          num('Schwarz', () => p().blacks, (v) => (p().blacks = v)),
        ),
      );
      break;
    case 'color': {
      const key = params.colorKey;
      const pickBtn = el(
        'button',
        {
          class: 'chip' + (pickingKey ? ' active' : ''),
          onclick: () => {
            pickingKey = !pickingKey;
            stage.classList.toggle('picking', pickingKey);
            pickBtn.classList.toggle('active', pickingKey);
            if (pickingKey) toast('Tippe im Bild auf die Farbe, die bleiben soll.');
          },
        },
        '◎ Farbe im Bild antippen',
      );
      const swatch = el('span', { class: 'swatch', style: { background: `hsl(${key.hue} 80% 55%)` } });
      panel.append(
        group(
          'Weißabgleich',
          num('Temperatur', () => p().temperature, (v) => (p().temperature = v), { track: 'linear-gradient(90deg,#3b78d8,#9a9a9a,#e3b33b)' }),
          num('Tönung', () => p().tint, (v) => (p().tint = v), { track: 'linear-gradient(90deg,#3fae5a,#9a9a9a,#c548b8)' }),
        ),
        group(
          'Präsenz',
          num('Dynamik', () => p().vibrance, (v) => (p().vibrance = v)),
          num('Sättigung', () => p().saturation, (v) => (p().saturation = v)),
        ),
        group(
          'Schwarzweiß & Color Key',
          el('p', { class: 'hint' }, 'Color Key: alles wird schwarzweiß – nur die gewählte Farbe bleibt (wie beim Mural mit Brille).'),
          toggle('Color Key aktiv', () => p().colorKey.enabled, (v) => {
            p().colorKey.enabled = v;
            commit();
            scheduleRender();
          }).el,
          el('div', { class: 'row' }, pickBtn, swatch),
          num('Farbton', () => p().colorKey.hue, (v) => {
            p().colorKey.hue = v;
            swatch.style.background = `hsl(${v} 80% 55%)`;
          }, { min: 0, max: 360, reset: 30, track: HUE_TRACK, format: (v) => `${Math.round(v)}°` }),
          num('Bereich', () => p().colorKey.range, (v) => (p().colorKey.range = v), { min: 5, max: 90, reset: 30 }),
          num('Farbstärke', () => p().colorKey.keepSat, (v) => (p().colorKey.keepSat = v), { min: 0, max: 200, reset: 100, format: (v) => `${Math.round(v)} %` }),
          num('Schwarzweiß (ohne Key)', () => p().mono, (v) => (p().mono = v), { min: 0, max: 100 }),
        ),
      );
      break;
    }
    case 'hsl': {
      const chips = el('div', { class: 'chips hsl-chips' });
      const sliders = el('div', {});
      const renderBand = () => {
        chips.replaceChildren(
          ...HSL_BANDS.map((b, i) => {
            const v = params.hsl[i];
            const changed = v.h || v.s || v.l;
            return el(
              'button',
              {
                class: 'dot' + (i === hslBand ? ' active' : '') + (changed ? ' changed' : ''),
                style: { '--dot': b.color } as any,
                title: b.label,
                'aria-label': b.label,
                onclick: () => {
                  hslBand = i;
                  renderBand();
                },
              },
            );
          }),
        );
        const b = HSL_BANDS[hslBand];
        const band = () => params.hsl[hslBand];
        const h = b.hue;
        sliders.replaceChildren(
          el('h3', {}, b.label),
          num('Farbton', () => band().h, (v) => (band().h = v), { track: `linear-gradient(90deg,hsl(${h - 30} 75% 55%),hsl(${h} 75% 55%),hsl(${h + 30} 75% 55%))` }),
          num('Sättigung', () => band().s, (v) => (band().s = v), { track: `linear-gradient(90deg,hsl(${h} 0% 55%),hsl(${h} 90% 55%))` }),
          num('Luminanz', () => band().l, (v) => (band().l = v), { track: `linear-gradient(90deg,hsl(${h} 70% 15%),hsl(${h} 70% 50%),hsl(${h} 70% 85%))` }),
        );
      };
      renderBand();
      const resetAll = el('button', {
        class: 'chip ghost',
        onclick: () => {
          params.hsl = params.hsl.map(() => ({ h: 0, s: 0, l: 0 }));
          commit();
          renderBand();
          scheduleRender();
        },
      }, 'Alle zurücksetzen');
      panel.append(
        el('div', { class: 'group' }, el('p', { class: 'hint' }, 'Farbe wählen, dann Farbton, Sättigung und Helligkeit nur dieser Farbe ändern. Tipp: Blau/Türkis zähmt grelle Himmel.'), chips, sliders, resetAll),
      );
      break;
    }
    case 'curves':
      curveEditor = new CurveEditor(() => params.curves, () => {
        activePresetDirty();
        scheduleRender();
      }, commit);
      if (image) curveEditor.setHistogram(image.histogram);
      panel.append(el('div', { class: 'group' }, curveEditor.el));
      break;
    case 'grading': {
      const wheels = [
        new ColorWheel('Tiefen', () => params.grading.shadows, scheduleRender, commit),
        new ColorWheel('Mitteltöne', () => params.grading.midtones, scheduleRender, commit),
        new ColorWheel('Lichter', () => params.grading.highlights, scheduleRender, commit),
      ];
      panel.append(
        group(
          'Color Grading',
          el('p', { class: 'hint' }, 'Ziehe im Rad: Richtung = Farbe, Abstand zur Mitte = Stärke. Klassiker: Tiefen türkis, Lichter orange.'),
          el('div', { class: 'wheels' }, ...wheels.map((w) => w.el)),
          num('Balance', () => p().grading.balance, (v) => (p().grading.balance = v)),
          num('Übergang', () => p().grading.blending, (v) => (p().grading.blending = v), { min: 0, max: 100, reset: 50 }),
        ),
      );
      requestAnimationFrame(() => wheels.forEach((w) => w.draw()));
      break;
    }
    case 'effects':
      panel.append(
        group(
          'Details',
          num('Klarheit', () => p().clarity, (v) => (p().clarity = v)),
          num('Schärfe', () => p().sharpen, (v) => (p().sharpen = v), { min: 0, max: 100 }),
        ),
        group(
          'Film',
          num('Fade', () => p().fade, (v) => (p().fade = v), { min: 0, max: 100 }),
          num('Körnung', () => p().grain, (v) => (p().grain = v), { min: 0, max: 100 }),
          num('Korngröße', () => p().grainSize, (v) => (p().grainSize = v), { min: 0, max: 100, reset: 30 }),
        ),
        group(
          'Vignette',
          num('Stärke', () => p().vignette, (v) => (p().vignette = v)),
          num('Mittelpunkt', () => p().vignetteMidpoint, (v) => (p().vignetteMidpoint = v), { min: 0, max: 100, reset: 50 }),
          num('Rundheit', () => p().vignetteRoundness, (v) => (p().vignetteRoundness = v), { min: 0, max: 100, reset: 50 }),
          num('Weichheit', () => p().vignetteFeather, (v) => (p().vignetteFeather = v), { min: 0, max: 100, reset: 50 }),
        ),
      );
      break;
  }
}

// ---------------------------------------------------------------- looks
const thumbCache = new Map<string, string>();

function allPresets(): Preset[] {
  return [...BUILTIN_PRESETS, ...customPresets];
}

function renderThumbs() {
  thumbCache.clear();
  if (!image) return;
  try {
    if (!thumbRenderer) thumbRenderer = new Renderer(document.createElement('canvas'));
  } catch {
    return;
  }
  const tr = thumbRenderer;
  const long = 220;
  const s = long / Math.max(image.width, image.height);
  const w = Math.round(image.width * s);
  const h = Math.round(image.height * s);
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d')!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(image.preview, 0, 0, w, h);
  tr.setImage(src, w, h, image.width, image.height);
  tr.canvas.width = w;
  tr.canvas.height = h;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  for (const pr of [{ id: '__original', params: defaultParams() } as Preset, ...allPresets()]) {
    tr.render(pr.params);
    octx.drawImage(tr.canvas, 0, 0);
    thumbCache.set(pr.id, out.toDataURL('image/jpeg', 0.8));
  }
}

function applyPreset(pr: Preset | null) {
  activePreset = pr;
  presetTweaked = false;
  presetStrength = 100;
  params = pr ? cloneParams(pr.params) : defaultParams();
  commit();
  buildPanel();
  scheduleRender();
}

function buildLooks(): HTMLElement {
  const card = (id: string, name: string, note: string, onClick: () => void, active: boolean, extra?: Node) =>
    el(
      'button',
      { class: 'look' + (active ? ' active' : ''), onclick: onClick, title: note },
      thumbCache.get(id) ? el('img', { src: thumbCache.get(id), alt: '' }) : el('div', { class: 'look-ph' }),
      el('span', { class: 'look-name' }, name),
      extra,
    );
  const grid = el(
    'div',
    { class: 'looks' },
    card('__original', 'Original', 'Alle Regler zurücksetzen', () => applyPreset(null), !activePreset),
    ...allPresets().map((pr) =>
      card(
        pr.id,
        pr.name,
        pr.note,
        () => applyPreset(pr),
        activePreset?.id === pr.id,
        pr.custom
          ? el('span', {
              class: 'look-del',
              role: 'button',
              'aria-label': `${pr.name} löschen`,
              onclick: (e: Event) => {
                e.stopPropagation();
                if (!confirm(`Preset „${pr.name}“ löschen?`)) return;
                customPresets = customPresets.filter((c) => c.id !== pr.id);
                saveCustomPresets(customPresets);
                if (activePreset?.id === pr.id) activePreset = null;
                buildPanel();
              },
            }, '×')
          : undefined,
      ),
    ),
  );
  const desc = activePreset ? el('p', { class: 'hint' }, activePreset.note) : el('p', { class: 'hint' }, 'Tippe auf einen Look. Danach kannst du in den anderen Reitern alles feinjustieren.');
  const strength =
    activePreset && !presetTweaked
      ? slider({
          label: 'Stärke',
          min: 0,
          max: 150,
          reset: 100,
          format: (v) => `${Math.round(v)} %`,
          get: () => presetStrength,
          set: (v) => {
            presetStrength = v;
            params = blendParams(activePreset!.params, v / 100);
            scheduleRender();
          },
          commit,
        }).el
      : null;
  const save = el(
    'button',
    {
      class: 'chip',
      onclick: () => {
        const name = prompt('Name für dein Preset:', activePreset ? `${activePreset.name} (eigen)` : 'Mein Look');
        if (!name) return;
        const pr: Preset = { id: `c-${Date.now()}`, name, note: 'Eigenes Preset', params: cloneParams(params), custom: true };
        customPresets.push(pr);
        saveCustomPresets(customPresets);
        activePreset = pr;
        presetTweaked = false;
        renderThumbs();
        buildPanel();
        toast(`Preset „${name}“ gespeichert`);
      },
    },
    '+ Aktuelle Einstellungen als Preset speichern',
  );
  return el('div', { class: 'group' }, grid, desc, strength, el('div', { class: 'row' }, save));
}

// ---------------------------------------------------------------- export
function openExport() {
  if (!image) {
    fileInput.click();
    return;
  }
  const li = image;
  let size: 'ig' | 'full' = 'ig';
  const status = el('p', { class: 'hint' });
  const actions = el('div', { class: 'sheet-actions' });
  const opt = (value: 'ig' | 'full', title: string, sub: string) => {
    const input = el('input', { type: 'radio', name: 'size', value, checked: value === size ? true : undefined }) as HTMLInputElement;
    input.addEventListener('change', () => (size = value));
    return el('label', { class: 'option' }, input, el('span', {}, el('strong', {}, title), el('small', {}, sub)));
  };
  const close = () => sheet.remove();
  const go = el('button', { class: 'primary big' }, 'Bild erstellen');
  go.addEventListener('click', async () => {
    go.disabled = true;
    status.textContent = 'Wird in voller Qualität berechnet …';
    await new Promise((r) => setTimeout(r, 30));
    try {
      const full = fullResCanvas(li, renderer.maxTextureSize);
      const data = renderer.renderFull(params, full, full.width, full.height);
      full.width = 0;
      const blob = await encodeJpeg(data, size === 'ig' ? 1080 : undefined);
      scheduleRender();
      const base = li.name.replace(/\.[^.]+$/, '') || 'foto';
      const file = new File([blob], `${base}-look.jpg`, { type: 'image/jpeg' });
      status.textContent = `Fertig: ${(blob.size / 1024 / 1024).toFixed(1)} MB`;
      const url = URL.createObjectURL(blob);
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      const btns: Node[] = [];
      if (nav.canShare?.({ files: [file] })) {
        btns.push(
          el('button', {
            class: 'primary big',
            onclick: async () => {
              try {
                await navigator.share({ files: [file] });
              } catch {
                /* cancelled */
              }
            },
          }, 'Teilen / In Fotos sichern'),
        );
      }
      btns.push(el('a', { class: 'button ghost big', href: url, download: file.name }, 'Herunterladen'));
      actions.replaceChildren(...btns);
    } catch (e) {
      status.textContent = `Fehler: ${(e as Error).message}`;
      go.disabled = false;
    }
  });
  actions.append(go);
  const sheet = el(
    'div',
    { class: 'sheet-backdrop', onclick: (e: Event) => e.target === sheet && close() },
    el(
      'div',
      { class: 'sheet', role: 'dialog', 'aria-label': 'Bild sichern' },
      el('div', { class: 'sheet-head' }, el('h2', {}, 'Bild sichern'), el('button', { class: 'icon-btn', 'aria-label': 'Schließen', onclick: close }, '×')),
      opt('ig', 'Instagram', '1080 px breit – Instagrams Zielgröße, keine Neu-Komprimierung durch zu große Dateien'),
      opt('full', 'Volle Auflösung', `${li.width} × ${li.height} px – zum Archivieren oder Drucken`),
      status,
      actions,
    ),
  );
  document.body.append(sheet);
}

// ---------------------------------------------------------------- icons
function icon(name: 'undo' | 'redo' | 'compare' | 'aperture') {
  const paths: Record<string, string> = {
    undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
    redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
    compare: 'M12 3v18M5 5h14v14H5z',
    aperture:
      'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM14.31 8l5.74 9.94M9.69 8h11.48M7.38 12l5.74-9.94M9.69 16 3.95 6.06M14.31 16H2.83M16.62 12l-5.74 9.94',
  };
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
  return span;
}

// ---------------------------------------------------------------- boot
setTab('looks');
syncHistoryButtons();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
