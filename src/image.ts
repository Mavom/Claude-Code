// Loading, preview scaling, histogram and JPEG export.

export interface LoadedImage {
  img: HTMLImageElement;
  url: string;
  name: string;
  width: number;
  height: number;
  preview: HTMLCanvasElement;
  previewCtx: CanvasRenderingContext2D;
  histogram: Float32Array;
}

const PREVIEW_MAX = 2048;
// iOS Safari refuses canvases above ~16.7 MP
const MAX_PIXELS = 16_000_000;

export async function loadImage(file: File): Promise<LoadedImage> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('Dieses Bildformat kann der Browser nicht öffnen. Tipp: In der Fotos-App als JPEG teilen.');
  }
  // naturalWidth/Height already respect EXIF orientation in current browsers
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const scale = Math.min(1, PREVIEW_MAX / Math.max(width, height));
  const pw = Math.max(1, Math.round(width * scale));
  const ph = Math.max(1, Math.round(height * scale));
  const preview = document.createElement('canvas');
  preview.width = pw;
  preview.height = ph;
  const previewCtx = preview.getContext('2d', { willReadFrequently: true })!;
  previewCtx.imageSmoothingEnabled = true;
  previewCtx.imageSmoothingQuality = 'high';
  previewCtx.drawImage(img, 0, 0, pw, ph);
  return { img, url, name: file.name, width, height, preview, previewCtx, histogram: histogram(previewCtx, pw, ph) };
}

function histogram(ctx: CanvasRenderingContext2D, w: number, h: number, bins = 128): Float32Array {
  const data = ctx.getImageData(0, 0, w, h).data;
  const hist = new Float32Array(bins);
  for (let i = 0; i < data.length; i += 16) {
    const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    hist[Math.min(bins - 1, Math.floor(l * bins))]++;
  }
  // light smoothing
  const out = new Float32Array(bins);
  for (let i = 0; i < bins; i++) out[i] = (hist[Math.max(0, i - 1)] + 2 * hist[i] + hist[Math.min(bins - 1, i + 1)]) / 4;
  return out;
}

/** Hue (0..360) and saturation of the preview pixel under normalised coords. */
export function sampleHue(li: LoadedImage, u: number, v: number): { hue: number; sat: number } {
  const x = Math.min(li.preview.width - 1, Math.max(0, Math.floor(u * li.preview.width)));
  const y = Math.min(li.preview.height - 1, Math.max(0, Math.floor(v * li.preview.height)));
  // average a 5×5 block to avoid picking noise
  const d = li.previewCtx.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
    n++;
  }
  r /= n * 255;
  g /= n * 255;
  b /= n * 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const c = mx - mn;
  let h = 0;
  if (c > 0) {
    if (mx === r) h = ((g - b) / c) % 6;
    else if (mx === g) h = (b - r) / c + 2;
    else h = (r - g) / c + 4;
  }
  return { hue: Math.round((h * 60 + 360) % 360), sat: mx ? c / mx : 0 };
}

/** Draw the original at full resolution (respecting orientation) for export. */
export function fullResCanvas(li: LoadedImage, maxTex: number): HTMLCanvasElement {
  let w = li.width;
  let h = li.height;
  const s = Math.min(1, maxTex / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
  w = Math.round(w * s);
  h = Math.round(h * s);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(li.img, 0, 0, w, h);
  return c;
}

/** ImageData → JPEG blob, optionally downscaled to a target width with good quality. */
export async function encodeJpeg(data: ImageData, targetWidth?: number, quality = 0.92): Promise<Blob> {
  let c = document.createElement('canvas');
  c.width = data.width;
  c.height = data.height;
  c.getContext('2d')!.putImageData(data, 0, 0);
  if (targetWidth && targetWidth < c.width) {
    // halve repeatedly, then one final step → sharper than a single big jump
    while (c.width / 2 >= targetWidth) {
      const n = document.createElement('canvas');
      n.width = Math.round(c.width / 2);
      n.height = Math.round(c.height / 2);
      const ctx = n.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(c, 0, 0, n.width, n.height);
      c.width = 0;
      c = n;
    }
    const n = document.createElement('canvas');
    n.width = targetWidth;
    n.height = Math.round((c.height * targetWidth) / c.width);
    const ctx = n.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, n.width, n.height);
    c.width = 0;
    c = n;
  }
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', quality));
  c.width = 0;
  if (!blob) throw new Error('JPEG konnte nicht erzeugt werden.');
  return blob;
}
