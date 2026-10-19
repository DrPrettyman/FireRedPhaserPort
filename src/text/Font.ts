import Phaser from 'phaser';

export const FONT_SMALL = 0;
export const FONT_NORMAL = 2;
export const FONT_MALE = 4;
export const FONT_FEMALE = 5;
/** FONT_BRAILLE (braille_text.c): 16x16 glyphs, every one 16 px wide (GetGlyphWidth_Braille). */
export const FONT_BRAILLE = 6;

/** Glyph cell size in the full-width latin font sheets (16 cells per row). */
const CELL = 16;

export interface FontInfoData {
  name: string;
  image: string;
  /** .hwlatfont: 8x16 glyphs, 32 per row (otherwise 16x16 cells, 16 per row). */
  halfWidth?: boolean;
  widths: number[];
  /** Every glyph's width (FONT_BRAILLE's GetGlyphWidth_Braille), instead of `widths`. */
  fixedWidth?: number;
  maxLetterWidth: number;
  maxLetterHeight: number;
  letterSpacing: number;
  lineSpacing: number;
  fgColor: number;
  bgColor: number;
  shadowColor: number;
}

export interface FontsData {
  fonts: Record<string, FontInfoData>;
  windowPalette: [number, number, number][];
  /** sKeypadIcons: [tile offset into gKeypadIconTiles, width, height] by keypad icon id */
  keypadIcons: ([number, number, number] | null)[];
}

/** Glyph pixel values: 0 = background, 1 = foreground, 2 = shadow (sFontHalfRowLookupTable order). */
export class Font {
  private pixels: Uint8Array;
  private sheetWidth: number;

  constructor(
    readonly id: number,
    readonly info: FontInfoData,
    image: HTMLImageElement | HTMLCanvasElement,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
    this.sheetWidth = image.width;
    this.pixels = new Uint8Array(image.width * image.height);
    for (let i = 0; i < this.pixels.length; i++) {
      const v = rgba[i * 4];
      this.pixels[i] = v > 192 ? 1 : v > 64 ? 2 : 0;
    }
  }

  get height(): number {
    return this.info.maxLetterHeight;
  }

  width(code: number): number {
    if (this.info.fixedWidth !== undefined) return this.info.fixedWidth;
    return this.info.widths[code] ?? 0;
  }

  /** Glyph pixel value at (x, y) within the glyph for charmap byte `code`. */
  pixel(code: number, x: number, y: number): number {
    if (this.info.halfWidth) {
      if (x >= 8 || y >= 16) return 0;
      return this.pixels[(Math.floor(code / 32) * 16 + y) * this.sheetWidth + (code % 32) * 8 + x];
    }
    if (this.id === FONT_SMALL) {
      // The older latin_small.latfont sheet (DecompressGlyph_Small): glyphs are two 8x8 tiles, 0x10
      // u16s apart, so each 16x16 cell holds two: the even glyph is the cell's top tiles (top-left
      // above top-right), the odd glyph its bottom tiles.
      const cell = code >> 1;
      const cx = (cell % 16) * CELL + (y >= 8 ? 8 : 0);
      const cy = Math.floor(cell / 16) * CELL + (code & 1) * 8 + (y & 7);
      if (x >= 8 || y >= 16) return 0;
      return this.pixels[cy * this.sheetWidth + cx + x];
    }
    const cx = (code % 16) * CELL;
    const cy = Math.floor(code / 16) * CELL;
    return this.pixels[(cy + y) * this.sheetWidth + cx + x];
  }
}

export class Fonts {
  private fonts = new Map<number, Font>();
  readonly windowPalette: [number, number, number][];
  readonly keypadIcons: ([number, number, number] | null)[];

  constructor(scene: Phaser.Scene, data: FontsData) {
    this.windowPalette = data.windowPalette;
    this.keypadIcons = data.keypadIcons ?? [];
    for (const [id, info] of Object.entries(data.fonts)) {
      const img = scene.textures.get(fontTextureKey(info.image)).getSourceImage() as HTMLImageElement;
      this.fonts.set(Number(id), new Font(Number(id), info, img));
    }
  }

  get(id: number): Font {
    // FONT_NORMAL_COPY_* fall back to FONT_NORMAL if missing.
    return this.fonts.get(id) ?? this.fonts.get(FONT_NORMAL)!;
  }
}

export function fontTextureKey(image: string): string {
  return `font_${image}`;
}
