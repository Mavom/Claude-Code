import { FRAG, VERT } from './shaders';
import { HSL_BANDS, type Params, type Tone } from '../params';
import { buildCurveLut, isIdentity } from '../curves';

type Source = TexImageSource;

/** WebGL2 renderer for the edit pipeline. One instance per canvas. */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private imageTex: WebGLTexture | null = null;
  private curveTex: WebGLTexture;
  private loc = new Map<string, WebGLUniformLocation | null>();
  private texSize: [number, number] = [1, 1];
  private imageSize: [number, number] = [1, 1];
  readonly maxTextureSize: number;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 wird von diesem Browser nicht unterstützt.');
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.prog = this.link(VERT, FRAG);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // One oversized triangle covers the viewport.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.curveTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    this.setTexParams(false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'Shader-Fehler');
      return sh;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'Link-Fehler');
    return p;
  }

  private u(name: string) {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.loc.get(name)!;
  }

  private setTexParams(mip: boolean) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private uploadImage(src: Source, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.setTexParams(true);
    return tex;
  }

  /** Set the (downscaled) preview image. fullW/fullH = original size, used for grain scale. */
  setImage(src: Source, w: number, h: number, fullW = w, fullH = h) {
    if (this.imageTex) this.gl.deleteTexture(this.imageTex);
    this.imageTex = this.uploadImage(src, w, h);
    this.texSize = [w, h];
    this.imageSize = [fullW, fullH];
  }

  get hasImage() {
    return this.imageTex !== null;
  }

  private applyParams(p: Params) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    const f = (n: string, v: number) => gl.uniform1f(this.u(n), v);
    const b = (n: string, v: boolean) => gl.uniform1i(this.u(n), v ? 1 : 0);
    const s = (v: number) => v / 100;

    f('uExposure', s(p.exposure) * 2);
    f('uContrast', s(p.contrast) * 0.8);
    f('uHighlights', s(p.highlights));
    f('uShadows', s(p.shadows));
    f('uWhites', s(p.whites));
    f('uBlacks', s(p.blacks));
    f('uTemp', s(p.temperature));
    f('uTint', s(p.tint));
    f('uVibrance', s(p.vibrance));
    f('uSaturation', s(p.saturation));
    f('uClarity', s(p.clarity));
    f('uSharpen', s(p.sharpen));
    // Clarity radius relative to image size → same look in preview and export
    const longEdge = Math.max(this.texSize[0], this.texSize[1]);
    f('uClarityLod', Math.max(1, Math.log2(longEdge / 70)));

    gl.uniform1fv(this.u('uHslCenter'), HSL_BANDS.map((bd) => bd.hue / 360));
    gl.uniform1fv(this.u('uHslH'), p.hsl.map((x) => s(x.h)));
    gl.uniform1fv(this.u('uHslS'), p.hsl.map((x) => s(x.s)));
    gl.uniform1fv(this.u('uHslL'), p.hsl.map((x) => s(x.l)));

    b('uKeyOn', p.colorKey.enabled);
    f('uKeyHue', p.colorKey.hue / 360);
    f('uKeyRange', Math.max(4, p.colorKey.range));
    f('uKeySat', p.colorKey.keepSat / 100);
    f('uMono', s(p.mono));

    const c = p.curves;
    const curveOn = !(isIdentity(c.master) && isIdentity(c.r) && isIdentity(c.g) && isIdentity(c.b));
    b('uCurveOn', curveOn);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    if (curveOn) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, buildCurveLut(c));
    gl.uniform1i(this.u('uCurve'), 1);

    gl.uniform3fv(this.u('uGradeS'), toneVec(p.grading.shadows));
    gl.uniform3fv(this.u('uGradeM'), toneVec(p.grading.midtones));
    gl.uniform3fv(this.u('uGradeH'), toneVec(p.grading.highlights));
    f('uBalance', s(p.grading.balance));
    f('uBlending', s(p.grading.blending));

    f('uFade', s(p.fade));
    f('uGrain', s(p.grain));
    f('uGrainSize', s(p.grainSize));
    f('uVignette', s(p.vignette));
    f('uVigMid', s(p.vignetteMidpoint));
    f('uVigRound', s(p.vignetteRoundness));
    f('uVigFeather', s(p.vignetteFeather));
  }

  private draw(tex: WebGLTexture, w: number, h: number, flipY: boolean, bypass: boolean) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.u('uImage'), 0);
    gl.uniform1i(this.u('uFlipY'), flipY ? 1 : 0);
    gl.uniform1i(this.u('uBypass'), bypass ? 1 : 0);
    gl.uniform2f(this.u('uImageSize'), this.imageSize[0], this.imageSize[1]);
    gl.uniform2f(this.u('uTexSize'), this.texSize[0], this.texSize[1]);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Render the preview into the canvas at its current backing size. */
  render(p: Params, bypass = false) {
    if (!this.imageTex) return;
    this.applyParams(p);
    this.draw(this.imageTex, this.canvas.width, this.canvas.height, false, bypass);
  }

  /**
   * Render a full-resolution image off-screen and return its pixels (top row first).
   * The preview texture is restored afterwards.
   */
  renderFull(p: Params, src: Source, w: number, h: number): ImageData {
    const gl = this.gl;
    const prevTex = this.texSize;
    const tex = this.uploadImage(src, w, h);
    this.texSize = [w, h];
    const fbTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, fbTex);
    this.setTexParams(false);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0);
    try {
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Export-Puffer konnte nicht angelegt werden.');
      }
      this.applyParams(p);
      this.draw(tex, w, h, true, false);
      const px = new Uint8ClampedArray(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return new ImageData(px, w, h);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(fbTex);
      gl.deleteTexture(tex);
      this.texSize = prevTex;
    }
  }
}

/** Hue/sat of a grading wheel → RGB offset around neutral grey. */
function toneVec(t: Tone): number[] {
  const h = t.hue / 360;
  const k = (n: number) => {
    const x = (n + h * 6) % 6;
    return 1 - Math.max(0, Math.min(1, Math.min(x, 4 - x)));
  };
  // HSV(h,1,1) → rgb, minus mean, scaled by saturation
  const rgb = [k(5), k(3), k(1)];
  const mean = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const amt = t.sat / 100;
  return rgb.map((v) => (v - mean) * amt);
}
