// Single-pass edit pipeline. All adjustments run per pixel on the GPU, so the
// preview updates live while a slider moves.

export const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
uniform bool uFlipY;
out vec2 vUv;
void main() {
  vec2 uv = aPos * 0.5 + 0.5;
  vUv = uFlipY ? uv : vec2(uv.x, 1.0 - uv.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uImage;
uniform sampler2D uCurve;
uniform bool uBypass;
uniform vec2 uImageSize;   // full-resolution size (keeps grain identical in preview and export)
uniform vec2 uTexSize;     // size of the texture currently bound

// Licht
uniform float uExposure, uContrast, uHighlights, uShadows, uWhites, uBlacks;
// Farbe
uniform float uTemp, uTint, uVibrance, uSaturation;
// Details
uniform float uClarity, uSharpen, uClarityLod;
// HSL
uniform float uHslCenter[8];
uniform float uHslH[8];
uniform float uHslS[8];
uniform float uHslL[8];
// Color key / Schwarzweiß
uniform bool uKeyOn;
uniform float uKeyHue, uKeyRange, uKeySat, uMono;
// Kurven
uniform bool uCurveOn;
// Grading
uniform vec3 uGradeS, uGradeM, uGradeH;
uniform float uBalance, uBlending;
// Effekte
uniform float uFade, uGrain, uGrainSize;
uniform float uVignette, uVigMid, uVigRound, uVigFeather;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float luma(vec3 c) { return dot(c, LUMA); }

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Signed hue distance in turns (-0.5..0.5)
float hueDist(float a, float b) {
  float d = a - b;
  return d - floor(d + 0.5);
}

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Soft large-radius blur from the mip chain (5 taps to hide block edges)
vec3 blurAt(vec2 uv, float lod) {
  vec2 o = exp2(lod) / uTexSize * 0.75;
  vec3 s = textureLod(uImage, uv, lod).rgb * 0.4;
  s += textureLod(uImage, uv + vec2(o.x, o.y), lod).rgb * 0.15;
  s += textureLod(uImage, uv + vec2(-o.x, o.y), lod).rgb * 0.15;
  s += textureLod(uImage, uv + vec2(o.x, -o.y), lod).rgb * 0.15;
  s += textureLod(uImage, uv + vec2(-o.x, -o.y), lod).rgb * 0.15;
  return s;
}

void main() {
  vec3 src = textureLod(uImage, vUv, 0.0).rgb;
  if (uBypass) { outColor = vec4(src, 1.0); return; }

  // ---------- Weißabgleich + Belichtung (linear) ----------
  vec3 lin = toLinear(src);
  lin *= vec3(1.0 + uTemp * 0.25, 1.0 - uTint * 0.18, 1.0 - uTemp * 0.25);
  lin *= exp2(uExposure);
  vec3 c = toSrgb(lin);

  // ---------- Details: Klarheit + Schärfe (Luminanz) ----------
  float L0 = luma(src);
  if (abs(uClarity) > 0.001) {
    float detail = L0 - luma(blurAt(vUv, uClarityLod));
    float L = luma(c);
    float midMask = 1.0 - pow(abs(2.0 * L - 1.0), 2.0);
    c += detail * uClarity * 0.9 * midMask;
  }
  if (uSharpen > 0.001) {
    float detail = L0 - luma(textureLod(uImage, vUv, 1.3).rgb);
    c += detail * uSharpen * 1.6;
  }

  // ---------- Kontrast (sanfte S-Kurve um Mittelgrau) ----------
  c = clamp(c, 0.0, 1.0);
  if (uContrast >= 0.0) {
    c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  } else {
    c = mix(c, 0.5 + (c - 0.5) * 0.45, -uContrast);
  }

  // ---------- Lichter / Tiefen / Weiß / Schwarz ----------
  {
    float L = luma(c);
    float fs = L * (1.0 - L) * (1.0 - L) * 6.75;   // Peak bei 1/3
    float fh = L * L * (1.0 - L) * 6.75;           // Peak bei 2/3
    float L2 = L + uShadows * 0.35 * fs + uHighlights * 0.35 * fh;
    float bp = -uBlacks * 0.08;
    float wp = 1.0 - uWhites * 0.12;
    L2 = (L2 - bp) / max(wp - bp, 0.05);
    float k = smoothstep(0.0, 0.12, L);
    c = mix(c + (L2 - L), c * (L2 / max(L, 1e-4)), k);
  }

  // ---------- HSL pro Farbe ----------
  {
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    float satGate = smoothstep(0.02, 0.18, hsv.y);
    float dh = 0.0, ds = 0.0, dl = 0.0, wsum = 0.0;
    for (int i = 0; i < 8; i++) {
      float d = abs(hueDist(hsv.x, uHslCenter[i]));
      float w = max(0.0, 1.0 - d / 0.125);
      w = w * w * (3.0 - 2.0 * w);
      dh += w * uHslH[i];
      ds += w * uHslS[i];
      dl += w * uHslL[i];
      wsum += w;
    }
    float norm = 1.0 / max(wsum, 1.0);
    dh *= norm; ds *= norm; dl *= norm;
    hsv.x = fract(hsv.x + dh * 0.085 * satGate);
    hsv.y = clamp(hsv.y * (1.0 + ds * satGate), 0.0, 1.0);
    vec3 shifted = hsv2rgb(hsv);
    float Lb = luma(shifted);
    shifted *= 1.0 + dl * 0.45 * satGate;
    // keep brightness from saturation-only changes stable
    shifted += (Lb - luma(shifted)) * (1.0 - abs(dl));
    c = shifted;
  }

  // ---------- Dynamik + Sättigung ----------
  {
    float L = luma(c);
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float s = mx - mn;
    // skin protection: orange hues get less vibrance
    float hue = rgb2hsv(clamp(c, 0.0, 1.0)).x;
    float skin = 1.0 - 0.5 * smoothstep(0.08, 0.0, abs(hueDist(hue, 0.07)));
    float v = uVibrance * (1.0 - s) * skin;
    c = mix(vec3(L), c, 1.0 + v);
    c = mix(vec3(L), c, 1.0 + uSaturation);
  }

  // ---------- Color Key / Schwarzweiß ----------
  {
    float L = luma(c);
    if (uKeyOn) {
      vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
      float d = abs(hueDist(hsv.x, uKeyHue)) * 360.0;
      float m = 1.0 - smoothstep(uKeyRange * 0.55, uKeyRange, d);
      m *= smoothstep(0.06, 0.2, hsv.y);
      vec3 kept = mix(vec3(L), c, uKeySat);
      c = mix(vec3(L), kept, m);
    } else if (uMono > 0.0) {
      c = mix(c, vec3(L), uMono);
    }
  }

  // ---------- Gradationskurven ----------
  if (uCurveOn) {
    vec3 cc = clamp(c, 0.0, 1.0) * (255.0 / 256.0) + (0.5 / 256.0);
    c = vec3(texture(uCurve, vec2(cc.r, 0.5)).r,
             texture(uCurve, vec2(cc.g, 0.5)).g,
             texture(uCurve, vec2(cc.b, 0.5)).b);
  }

  // ---------- Color Grading ----------
  {
    float L = clamp(luma(c), 0.0, 1.0);
    float p = 0.5 + uBalance * 0.3;
    float w = 0.15 + uBlending * 0.45;
    float ws = 1.0 - smoothstep(0.0, p + w * 0.5, L);
    float wh = smoothstep(p - w * 0.5, 1.0, L);
    float wm = clamp(1.0 - abs(L - p) / (0.25 + w * 0.5), 0.0, 1.0);
    c += (uGradeS * ws + uGradeM * wm + uGradeH * wh) * 0.4;
    c += L - luma(c); // Helligkeit erhalten, nur Farbton ändern
  }

  // ---------- Fade (verblasste Schwarztöne) ----------
  c = c * (1.0 - uFade * 0.2) + uFade * 0.15;

  // ---------- Vignette ----------
  if (abs(uVignette) > 0.001) {
    vec2 q = (vUv - 0.5) * 2.0;
    float aspect = uImageSize.x / uImageSize.y;
    if (aspect > 1.0) q.x *= mix(1.0, aspect, uVigRound);
    else q.y *= mix(1.0, 1.0 / aspect, uVigRound);
    float d = length(q) / 1.4142;
    float r0 = mix(0.05, 0.95, uVigMid);
    float fw = mix(0.05, 0.9, uVigFeather);
    float m = smoothstep(r0, r0 + fw, d);
    if (uVignette < 0.0) c *= 1.0 + uVignette * m;
    else c = mix(c, vec3(1.0), uVignette * m);
  }

  // ---------- Körnung ----------
  if (uGrain > 0.001) {
    float cell = mix(0.8, 4.5, uGrainSize);
    vec2 pp = vUv * uImageSize / cell;
    float n = valueNoise(pp) + valueNoise(pp * 2.17 + 13.1) * 0.5;
    n = n / 1.5 - 0.5;
    float L = luma(c);
    float mask = 1.0 - pow(abs(2.0 * L - 1.0), 2.0) * 0.7;
    c += n * uGrain * 0.22 * mask;
  }

  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
