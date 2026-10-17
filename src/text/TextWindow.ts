import Phaser from 'phaser';
import type { Font } from './Font';

export const DEPTH_UI = 2_000_000;

let nextId = 0;

/** What TextPrinter draws on: colour indices into a 16-colour palette (0 = transparent). */
export interface TextSurface {
  readonly width: number;
  readonly height: number;
  fill(color: number): void;
  fillRect(x: number, y: number, w: number, h: number, color: number): void;
  /** Returns the glyph width. */
  drawGlyph(font: Font, code: number, x: number, y: number, fg: number, bg: number, shadow: number): number;
  /** The down-arrow blit: a region of the arrow sheet. */
  blit(src: ImageData, sx: number, sy: number, dx: number, dy: number, w: number, h: number, bg: number): void;
  scrollUp(dy: number, color: number): void;
  /** DrawKeypadIcon: returns the icon width (surfaces without the icon tiles skip it). */
  drawKeypadIcon?(icon: [number, number, number], x: number, y: number): number;
}

/**
 * A GBA "window": an RGBA pixel buffer backed by a canvas texture, drawn in screen space.
 * Colours are indices into the window palette (stdpal_0), like the GBA's 4bpp BG windows.
 * Colour 0 is transparent.
 */
export class TextWindow implements TextSurface {
  readonly image: Phaser.GameObjects.Image;
  private texture: Phaser.Textures.CanvasTexture;
  private imageData: ImageData;
  private buf: Uint32Array;
  private colors: Uint32Array;
  private dirty = true;

  constructor(
    scene: Phaser.Scene,
    readonly x: number,
    readonly y: number,
    readonly width: number,
    readonly height: number,
    palette: [number, number, number][],
  ) {
    const key = `textwindow_${nextId++}`;
    this.texture = scene.textures.createCanvas(key, width, height)!;
    this.imageData = this.texture.context.createImageData(width, height);
    this.buf = new Uint32Array(this.imageData.data.buffer);
    // Little-endian ABGR packing for Uint32 views over RGBA bytes.
    this.colors = new Uint32Array(16);
    palette.forEach(([r, g, b], i) => (this.colors[i] = i === 0 ? 0 : (0xff << 24) | (b << 16) | (g << 8) | r));
    this.image = scene.add.image(x, y, key).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH_UI);
  }

  fill(color: number): void {
    this.buf.fill(this.colors[color]);
    this.dirty = true;
  }

  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    const c = this.colors[color];
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx++) this.buf[yy * this.width + xx] = c;
    }
    this.dirty = true;
  }

  /**
   * CopyGlyphToWindow: the whole glyph cell (width x font height) is written, background included, except
   * pixels in colour 0 (TEXT_COLOR_TRANSPARENT), which GLYPH_COPY leaves as they were.
   */
  drawGlyph(font: Font, code: number, x: number, y: number, fg: number, bg: number, shadow: number): number {
    const w = font.width(code);
    const indices = [bg, fg, shadow];
    for (let gy = 0; gy < font.height; gy++) {
      const py = y + gy;
      if (py < 0 || py >= this.height) continue;
      for (let gx = 0; gx < w; gx++) {
        const px = x + gx;
        if (px < 0 || px >= this.width) continue;
        const ci = indices[font.pixel(code, gx, gy)];
        if (ci !== 0) this.buf[py * this.width + px] = this.colors[ci];
      }
    }
    this.dirty = true;
    return w;
  }

  /** Copy a region of an RGBA source image into the window; transparent source pixels become `bg`. */
  blit(src: ImageData, sx: number, sy: number, dx: number, dy: number, w: number, h: number, bg: number): void {
    const s = new Uint32Array(src.data.buffer);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = dx + x;
        const py = dy + y;
        if (px < 0 || py < 0 || px >= this.width || py >= this.height) continue;
        const v = s[(sy + y) * src.width + sx + x];
        this.buf[py * this.width + px] = v >>> 24 ? v : this.colors[bg];
      }
    }
    this.dirty = true;
  }

  /** ScrollWindow up by `dy` pixels, filling the exposed rows with `color`. */
  scrollUp(dy: number, color: number): void {
    this.buf.copyWithin(0, dy * this.width);
    this.buf.fill(this.colors[color], (this.height - dy) * this.width);
    this.dirty = true;
  }

  setVisible(v: boolean): void {
    this.image.setVisible(v);
  }

  /** Push pixel changes to the GPU; call once per frame. */
  flush(): void {
    if (!this.dirty) return;
    this.texture.context.putImageData(this.imageData, 0, 0);
    this.texture.refresh();
    this.dirty = false;
  }

  destroy(): void {
    this.image.destroy();
    this.texture.destroy();
  }
}
