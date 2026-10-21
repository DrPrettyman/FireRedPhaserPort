// window.c + blit.c: BG windows with 4bpp tile buffers, and text.c's printer list on top of them
// (the glyph renderer itself is text/TextPrinter.ts, shared with the overworld).

import type { Input } from '../input/Input';
import type { Font, Fonts } from '../text/Font';
import { stringWidth } from '../text/stringWidth';
import { gTextFlags, TEXT_SPEED, TextPrinter, type PrinterTemplate } from '../text/TextPrinter';
import type { TextSurface } from '../text/TextWindow';
import {
  BG_ATTR_BASETILE,
  BG_ATTR_MAPSIZE,
  BG_TILE_ALLOC,
  BG_TILE_FIND_FREE_SPACE,
  BG_TILE_FREE,
  BgTileAllocOp,
  CopyBgTilemapBufferToVram,
  FillBgTilemapBufferRect,
  GetBgAttribute,
  GetBgTilemapBuffer,
  gWindowTileAutoAllocEnabled,
  LoadBgTiles,
  SetBgTilemapBuffer,
  WriteSequenceToBgTilemapBuffer,
} from './bg';
import { gfx } from './gfx';

export const WINDOWS_MAX = 32;
export const WINDOW_NONE = 0xff;
export const COPYWIN_NONE = 0;
export const COPYWIN_MAP = 1;
export const COPYWIN_GFX = 2;
export const COPYWIN_FULL = 3;

/** TEXT_SKIP_DRAW (speed 0xFF): print instantly without copying the window to VRAM. */
export const TEXT_SKIP_DRAW = 0xff;

export const PIXEL_FILL = (num: number) => (num | (num << 4)) & 0xff;

export interface WindowTemplate {
  bg: number;
  tilemapLeft: number;
  tilemapTop: number;
  width: number;
  height: number;
  paletteNum: number;
  baseBlock: number;
}

export const DUMMY_WIN_TEMPLATE: WindowTemplate = { bg: 0xff, tilemapLeft: 0, tilemapTop: 0, width: 0, height: 0, paletteNum: 0, baseBlock: 0 };

export class Window {
  window: WindowTemplate = { ...DUMMY_WIN_TEMPLATE };
  tileData: Uint8Array | null = null;
}

export const gWindows: Window[] = Array.from({ length: WINDOWS_MAX }, () => new Window());
let gWindowClearTile = 0;
/** gWindowBgTilemapBuffers: 'external' marks a tilemap the caller provided (nullsub_8 in C). */
const gWindowBgTilemapBuffers: (Uint16Array | 'external' | null)[] = [null, null, null, null];

function GetNumActiveWindowsOnBg(bgId: number): number {
  return gWindows.filter((w) => w.window.bg === bgId).length;
}

function ensureBgTilemap(bgLayer: number): void {
  if (gWindowBgTilemapBuffers[bgLayer] === null) {
    const bgSize = GetBgAttribute(bgLayer, BG_ATTR_MAPSIZE);
    if (bgSize !== 0xffff && bgSize > 0) {
      const buf = new Uint16Array(bgSize >> 1);
      gWindowBgTilemapBuffers[bgLayer] = buf;
      SetBgTilemapBuffer(bgLayer, buf);
    }
  }
}

export function InitWindows(templates: WindowTemplate[]): boolean {
  for (let i = 0; i < 4; ++i) gWindowBgTilemapBuffers[i] = GetBgTilemapBuffer(i) !== null ? 'external' : null;
  for (let i = 0; i < WINDOWS_MAX; ++i) {
    gWindows[i].window = { ...DUMMY_WIN_TEMPLATE };
    gWindows[i].tileData = null;
  }
  for (let i = 0; i < WINDOWS_MAX && templates[i] && templates[i].bg !== 0xff; ++i) {
    const t = templates[i];
    let allocatedBaseBlock = 0;
    if (gWindowTileAutoAllocEnabled) {
      allocatedBaseBlock = BgTileAllocOp(t.bg, 0, t.width * t.height, BG_TILE_FIND_FREE_SPACE);
      if (allocatedBaseBlock === -1) return false;
    }
    ensureBgTilemap(t.bg);
    gWindows[i].tileData = new Uint8Array(0x20 * t.width * t.height);
    gWindows[i].window = { ...t };
    if (gWindowTileAutoAllocEnabled) {
      gWindows[i].window.baseBlock = allocatedBaseBlock;
      BgTileAllocOp(t.bg, allocatedBaseBlock, t.width * t.height, BG_TILE_ALLOC);
    }
  }
  gWindowClearTile = 0;
  return true;
}

export function AddWindow(template: WindowTemplate): number {
  let win = 0;
  for (; win < WINDOWS_MAX; ++win) if (gWindows[win].window.bg === 0xff) break;
  if (win === WINDOWS_MAX) return WINDOW_NONE;
  const bgLayer = template.bg;
  let allocatedBaseBlock = 0;
  if (gWindowTileAutoAllocEnabled) {
    allocatedBaseBlock = BgTileAllocOp(bgLayer, 0, template.width * template.height, BG_TILE_FIND_FREE_SPACE);
    if (allocatedBaseBlock === -1) return WINDOW_NONE;
  }
  ensureBgTilemap(bgLayer);
  gWindows[win].tileData = new Uint8Array(0x20 * template.width * template.height);
  gWindows[win].window = { ...template };
  if (gWindowTileAutoAllocEnabled) {
    gWindows[win].window.baseBlock = allocatedBaseBlock;
    BgTileAllocOp(bgLayer, allocatedBaseBlock, template.width * template.height, BG_TILE_ALLOC);
  }
  return win;
}

export function RemoveWindow(windowId: number): void {
  const w = gWindows[windowId];
  const bgLayer = w.window.bg;
  if (gWindowTileAutoAllocEnabled) BgTileAllocOp(bgLayer, w.window.baseBlock, w.window.width * w.window.height, BG_TILE_FREE);
  w.window = { ...DUMMY_WIN_TEMPLATE };
  if (GetNumActiveWindowsOnBg(bgLayer) === 0 && gWindowBgTilemapBuffers[bgLayer] !== 'external') gWindowBgTilemapBuffers[bgLayer] = null;
  w.tileData = null;
  sTextPrinters[windowId] = undefined;
}

export function FreeAllWindowBuffers(): void {
  for (let i = 0; i < 4; ++i) if (gWindowBgTilemapBuffers[i] !== 'external') gWindowBgTilemapBuffers[i] = null;
  for (let i = 0; i < WINDOWS_MAX; ++i) gWindows[i].tileData = null;
}

export function CopyWindowToVram(windowId: number, mode: number): void {
  const w = gWindows[windowId];
  if (!w.tileData) return;
  const windowSize = 32 * w.window.width * w.window.height;
  switch (mode) {
    case COPYWIN_MAP:
      CopyBgTilemapBufferToVram(w.window.bg);
      break;
    case COPYWIN_GFX:
      LoadBgTiles(w.window.bg, w.tileData, windowSize, w.window.baseBlock);
      break;
    case COPYWIN_FULL:
      LoadBgTiles(w.window.bg, w.tileData, windowSize, w.window.baseBlock);
      CopyBgTilemapBufferToVram(w.window.bg);
      break;
  }
}

export function PutWindowTilemap(windowId: number): void {
  const w = gWindows[windowId].window;
  WriteSequenceToBgTilemapBuffer(w.bg, GetBgAttribute(w.bg, BG_ATTR_BASETILE) + w.baseBlock, w.tilemapLeft, w.tilemapTop, w.width, w.height, w.paletteNum, 1);
}

export function PutWindowRectTilemap(windowId: number, x: number, y: number, width: number, height: number): void {
  const w = gWindows[windowId].window;
  let currentRow = w.baseBlock + y * w.width + x + GetBgAttribute(w.bg, BG_ATTR_BASETILE);
  for (let i = 0; i < height; ++i) {
    WriteSequenceToBgTilemapBuffer(w.bg, currentRow, w.tilemapLeft + x, w.tilemapTop + y + i, width, 1, w.paletteNum, 1);
    currentRow += w.width;
  }
}

export function PutWindowRectTilemapOverridePalette(windowId: number, x: number, y: number, width: number, height: number, palette: number): void {
  const w = gWindows[windowId].window;
  let currentRow = w.baseBlock + y * w.width + x + GetBgAttribute(w.bg, BG_ATTR_BASETILE);
  for (let i = 0; i < height; ++i) {
    WriteSequenceToBgTilemapBuffer(w.bg, currentRow, w.tilemapLeft + x, w.tilemapTop + y + i, width, 1, palette, 1);
    currentRow += w.width;
  }
}

export function ClearWindowTilemap(windowId: number): void {
  const w = gWindows[windowId].window;
  FillBgTilemapBufferRect(w.bg, gWindowClearTile, w.tilemapLeft, w.tilemapTop, w.width, w.height, w.paletteNum);
}

/** A 4bpp tiled bitmap (struct Bitmap). */
export interface Bitmap {
  pixels: Uint8Array;
  width: number;
  height: number;
}

const pixelOffset = (x: number, y: number, mulY: number) => ((x >> 1) & 3) + ((x >> 3) << 5) + (((y >> 3) * mulY) << 5) + ((y & 7) << 2);

/** BlitBitmapRect4Bit */
export function BlitBitmapRect4Bit(src: Bitmap, dst: Bitmap, srcX: number, srcY: number, dstX: number, dstY: number, width: number, height: number, colorKey: number): void {
  const xEnd = dst.width - dstX < width ? dst.width - dstX + srcX : srcX + width;
  const yEnd = dst.height - dstY < height ? dst.height - dstY + srcY : height + srcY;
  const mulSrcY = (src.width + (src.width & 7)) >> 3;
  const mulDstY = (dst.width + (dst.width & 7)) >> 3;
  for (let sy = srcY, dy = dstY; sy < yEnd; sy++, dy++) {
    for (let sx = srcX, dx = dstX; sx < xEnd; sx++, dx++) {
      const toOrr = (src.pixels[pixelOffset(sx, sy, mulSrcY)] >> ((sx & 1) << 2)) & 0xf;
      if (colorKey !== 0xff && toOrr === colorKey) continue;
      const di = pixelOffset(dx, dy, mulDstY);
      const shift = (dx & 1) << 2;
      dst.pixels[di] = (toOrr << shift) | (dst.pixels[di] & (0xf0 >> shift));
    }
  }
}

/** FillBitmapRect4Bit */
export function FillBitmapRect4Bit(surface: Bitmap, x: number, y: number, width: number, height: number, fillValue: number): void {
  const xEnd = Math.min(x + width, surface.width);
  const yEnd = Math.min(y + height, surface.height);
  const mulY = (surface.width + (surface.width & 7)) >> 3;
  for (let ly = y; ly < yEnd; ly++) {
    for (let lx = x; lx < xEnd; lx++) {
      const i = pixelOffset(lx, ly, mulY);
      if (lx & 1) surface.pixels[i] = (surface.pixels[i] & 0xf) | ((fillValue << 4) & 0xf0);
      else surface.pixels[i] = (surface.pixels[i] & 0xf0) | (fillValue & 0xf);
    }
  }
}

function windowBitmap(windowId: number): Bitmap {
  const w = gWindows[windowId];
  return { pixels: w.tileData!, width: 8 * w.window.width, height: 8 * w.window.height };
}

export function BlitBitmapRectToWindow(windowId: number, pixels: Uint8Array, srcX: number, srcY: number, srcWidth: number, srcHeight: number, destX: number, destY: number, rectWidth: number, rectHeight: number): void {
  BlitBitmapRect4Bit({ pixels, width: srcWidth, height: srcHeight }, windowBitmap(windowId), srcX, srcY, destX, destY, rectWidth, rectHeight, 0);
}

export function BlitBitmapToWindow(windowId: number, pixels: Uint8Array, x: number, y: number, width: number, height: number): void {
  BlitBitmapRectToWindow(windowId, pixels, 0, 0, width, height, x, y, width, height);
}

export function FillWindowPixelRect(windowId: number, fillValue: number, x: number, y: number, width: number, height: number): void {
  FillBitmapRect4Bit(windowBitmap(windowId), x, y, width, height, fillValue);
}

export function CopyToWindowPixelBuffer(windowId: number, src: ArrayLike<number>, size: number, tileOffset: number): void {
  const td = gWindows[windowId].tileData!;
  const n = size || src.length;
  for (let i = 0; i < n && i < src.length; i++) td[0x20 * tileOffset + i] = src[i];
}

export function FillWindowPixelBuffer(windowId: number, fillValue: number): void {
  gWindows[windowId].tileData?.fill(fillValue & 0xff);
}

export function GetWindowAttribute(windowId: number, attr: keyof WindowTemplate): number {
  return gWindows[windowId].window[attr];
}

export function SetWindowAttribute(windowId: number, attr: 'tilemapLeft' | 'tilemapTop' | 'paletteNum' | 'baseBlock', value: number): void {
  gWindows[windowId].window[attr] = value;
}

/** CallWindowFunction: func(bg, tilemapLeft, tilemapTop, width, height, paletteNum) */
export function CallWindowFunction(windowId: number, func: (bg: number, left: number, top: number, width: number, height: number, paletteNum: number) => void): void {
  const w = gWindows[windowId].window;
  func(w.bg, w.tilemapLeft, w.tilemapTop, w.width, w.height, w.paletteNum);
}

/** ScrollWindow: direction 0 moves the pixels up by `distance` rows, 1 moves them down. */
export function ScrollWindow(windowId: number, direction: number, distance: number, fillValue: number): void {
  const bmp = windowBitmap(windowId);
  const mulY = (bmp.width + (bmp.width & 7)) >> 3;
  const fill = fillValue & 0xf;
  const get = (x: number, y: number) => (bmp.pixels[pixelOffset(x, y, mulY)] >> ((x & 1) << 2)) & 0xf;
  const put = (x: number, y: number, v: number) => {
    const i = pixelOffset(x, y, mulY);
    bmp.pixels[i] = x & 1 ? (bmp.pixels[i] & 0xf) | (v << 4) : (bmp.pixels[i] & 0xf0) | v;
  };
  if (direction === 0) {
    for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) put(x, y, y + distance < bmp.height ? get(x, y + distance) : fill);
  } else {
    for (let y = bmp.height - 1; y >= 0; y--) for (let x = 0; x < bmp.width; x++) put(x, y, y - distance >= 0 ? get(x, y - distance) : fill);
  }
}

// ------------------------------------------------------------------ text (text.c)

/** gTextFlags (text/TextPrinter.ts, which reads autoScroll) */
export { gTextFlags };

/** A TextPrinter target backed by a window's 4bpp tile data. */
class WindowSurface implements TextSurface {
  constructor(readonly windowId: number) {}
  get width() {
    return 8 * gWindows[this.windowId].window.width;
  }
  get height() {
    return 8 * gWindows[this.windowId].window.height;
  }
  fill(color: number): void {
    FillWindowPixelBuffer(this.windowId, PIXEL_FILL(color));
  }
  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    FillWindowPixelRect(this.windowId, color, x, y, w, h);
  }
  drawGlyph(font: Font, code: number, x: number, y: number, fg: number, bg: number, shadow: number): number {
    const w = font.width(code);
    const map = [bg, fg, shadow];
    const bmp = windowBitmap(this.windowId);
    const mulY = (bmp.width + (bmp.width & 7)) >> 3;
    for (let gy = 0; gy < font.height; gy++) {
      const py = y + gy;
      if (py < 0 || py >= bmp.height) continue;
      for (let gx = 0; gx < w; gx++) {
        const px = x + gx;
        if (px < 0 || px >= bmp.width) continue;
        const v = map[font.pixel(code, gx, gy)] & 0xf;
        // GLYPH_COPY: colour 0 (TEXT_COLOR_TRANSPARENT) leaves the window's pixel alone
        if (v === 0) continue;
        const i = pixelOffset(px, py, mulY);
        bmp.pixels[i] = px & 1 ? (bmp.pixels[i] & 0xf) | (v << 4) : (bmp.pixels[i] & 0xf0) | v;
      }
    }
    return w;
  }
  /** DrawKeypadIcon: a rect of gKeypadIconTiles (a 128x128 sheet). */
  drawKeypadIcon([tileOffset, width, height]: [number, number, number], x: number, y: number): number {
    BlitBitmapRectToWindow(this.windowId, gfx('gKeypadIconTiles').subarray(tileOffset * 0x20), 0, 0, 0x80, 0x80, x, y, width, height);
    return width;
  }
  /** TextPrinterDrawDownArrow: sDownArrowTiles (+DARK_DOWN_ARROW_OFFSET when useAlternateDownArrow). */
  blit(_src: ImageData, sx: number, sy: number, dx: number, dy: number, w: number, h: number): void {
    const tiles = gfx('sDownArrowTiles');
    const arrow = gTextFlags.useAlternateDownArrow ? tiles.subarray(256) : tiles;
    BlitBitmapRectToWindow(this.windowId, arrow, sx, sy, 0x80, 0x10, dx, dy, w, h);
  }
  /** ScrollWindow(windowId, 0, dy, fill): move the pixels up by dy rows. */
  scrollUp(dy: number, color: number): void {
    const bmp = windowBitmap(this.windowId);
    const mulY = (bmp.width + (bmp.width & 7)) >> 3;
    const get = (x: number, y: number) => (bmp.pixels[pixelOffset(x, y, mulY)] >> ((x & 1) << 2)) & 0xf;
    for (let y = 0; y < bmp.height; y++) {
      for (let x = 0; x < bmp.width; x++) {
        const v = y + dy < bmp.height ? get(x, y + dy) : color & 0xf;
        const i = pixelOffset(x, y, mulY);
        bmp.pixels[i] = x & 1 ? (bmp.pixels[i] & 0xf) | (v << 4) : (bmp.pixels[i] & 0xf0) | v;
      }
    }
  }
}

/** struct TextPrinterTemplate */
export interface TextPrinterTemplate {
  currentChar: number[];
  windowId: number;
  fontId: number;
  x: number;
  y: number;
  currentX?: number;
  currentY?: number;
  letterSpacing: number;
  lineSpacing: number;
  fgColor: number;
  bgColor: number;
  shadowColor: number;
}

let textFonts: Fonts;
let textInput: Input;
let textSpeedScroll: number = TEXT_SPEED.mid.scroll;
/** sTextPrinters, indexed by window id. */
const sTextPrinters: (TextPrinter | undefined)[] = new Array(WINDOWS_MAX);
const dummyArrowSheet = new ImageData(1, 1);

export function initGbaText(fonts: Fonts, input: Input, scrollSpeed: number): void {
  textFonts = fonts;
  textInput = input;
  textSpeedScroll = scrollSpeed;
  sTextPrinters.fill(undefined);
}

/** AddTextPrinter: speed 0 prints instantly (up to the first wait). */
export function AddTextPrinter(t: TextPrinterTemplate, speed: number): boolean {
  if (!textFonts) return false;
  const tmpl: PrinterTemplate = {
    fontId: t.fontId,
    x: t.x,
    y: t.y,
    fgColor: t.fgColor,
    bgColor: t.bgColor,
    shadowColor: t.shadowColor,
    lineSpacing: t.lineSpacing,
    speed: speed === TEXT_SKIP_DRAW ? 0 : speed,
    canABSpeedUp: gTextFlags.canABSpeedUpPrint,
    scrollSpeed: textSpeedScroll,
  };
  const printer = new TextPrinter(new WindowSurface(t.windowId), textFonts, textInput, dummyArrowSheet, t.currentChar, tmpl);
  sTextPrinters[t.windowId] = printer;
  if (speed === TEXT_SKIP_DRAW) {
    // Render everything now and leave the window's tile buffer for the caller (no VRAM copy).
    for (let i = 0; i < 0x400 && !printer.finished; i++) printer.tick();
    sTextPrinters[t.windowId] = undefined;
  } else if (speed === 0) {
    // The C renders until the first non-instant state in one go, then copies the window.
    printer.tick();
    CopyWindowToVram(t.windowId, COPYWIN_GFX);
    if (printer.finished) sTextPrinters[t.windowId] = undefined;
  }
  return true;
}

/** AddTextPrinterParameterized4: color = [bg, fg, shadow] */
export function AddTextPrinterParameterized4(
  windowId: number,
  fontId: number,
  x: number,
  y: number,
  letterSpacing: number,
  lineSpacing: number,
  color: number[],
  speed: number,
  str: number[],
): boolean {
  return AddTextPrinter(
    { currentChar: str, windowId, fontId, x, y, letterSpacing, lineSpacing, fgColor: color[1], bgColor: color[0], shadowColor: color[2] },
    speed & 0xff,
  );
}

/** AddTextPrinterParameterized3: color = [bg, fg, shadow]; spacing from the font's attributes. */
export function AddTextPrinterParameterized3(windowId: number, fontId: number, x: number, y: number, color: number[], speed: number, str: number[]): boolean {
  const f = textFonts.get(fontId).info;
  return AddTextPrinterParameterized4(windowId, fontId, x, y, f.letterSpacing, f.lineSpacing, color, speed, str);
}

/** AddTextPrinterParameterized (menu.c / text.c) */
export function AddTextPrinterParameterized(windowId: number, fontId: number, str: number[], x: number, y: number, speed: number): boolean {
  const f = textFonts.get(fontId).info;
  return AddTextPrinter(
    { currentChar: str, windowId, fontId, x, y, letterSpacing: f.letterSpacing, lineSpacing: f.lineSpacing, fgColor: f.fgColor, bgColor: f.bgColor, shadowColor: f.shadowColor },
    speed,
  );
}

/** RunTextPrinters: one step for every active printer; changed windows are copied to VRAM. */
export function RunTextPrinters(): void {
  for (let i = 0; i < WINDOWS_MAX; i++) {
    const p = sTextPrinters[i];
    if (!p) continue;
    p.tick();
    if (gWindows[i].tileData) CopyWindowToVram(i, COPYWIN_GFX);
    if (p.finished) sTextPrinters[i] = undefined;
  }
}

export function IsTextPrinterActive(windowId: number): boolean {
  return sTextPrinters[windowId] !== undefined;
}

/** DeactivateAllTextPrinters */
export function DeactivateAllTextPrinters(): void {
  sTextPrinters.fill(undefined);
}

// FONTATTR_* (include/text.h)
export const FONTATTR_MAX_LETTER_WIDTH = 0;
export const FONTATTR_MAX_LETTER_HEIGHT = 1;
export const FONTATTR_LETTER_SPACING = 2;
export const FONTATTR_LINE_SPACING = 3;
export const FONTATTR_UNKNOWN = 4;
export const FONTATTR_COLOR_FOREGROUND = 5;
export const FONTATTR_COLOR_BACKGROUND = 6;
export const FONTATTR_COLOR_SHADOW = 7;

/** GetFontAttribute: gFontInfos[fontId] (text/fonts.json). */
export function GetFontAttribute(fontId: number, attributeId: number): number {
  const f = textFonts.get(fontId).info;
  switch (attributeId) {
    case FONTATTR_MAX_LETTER_WIDTH:
      return f.maxLetterWidth;
    case FONTATTR_MAX_LETTER_HEIGHT:
      return f.maxLetterHeight;
    case FONTATTR_LETTER_SPACING:
      return f.letterSpacing;
    case FONTATTR_LINE_SPACING:
      return f.lineSpacing;
    case FONTATTR_COLOR_FOREGROUND:
      return f.fgColor;
    case FONTATTR_COLOR_BACKGROUND:
      return f.bgColor;
    case FONTATTR_COLOR_SHADOW:
      return f.shadowColor;
  }
  return 0;
}

/** gStringVar1..3 for {STR_VAR_n} placeholders in GetStringWidth (set by whoever owns them). */
let stringVarLookup: (n: number) => number[] = () => [];
export function setStringVarLookup(f: (n: number) => number[]): void {
  stringVarLookup = f;
}

/** GetStringWidth (text.c) on the GBA layer's fonts. */
export function GetStringWidth(fontId: number, str: number[], letterSpacing: number): number {
  return stringWidth(textFonts, fontId, str, letterSpacing, stringVarLookup);
}
