// A software GBA PPU for mode 0: four text BGs (with BG mosaic), OBJ (normal and affine), WIN0/WIN1/OBJ
// window and colour special effects (alpha blend, brighten, darken). OBJ mosaic is not implemented.
// The HBlank callback, if any, runs before each line is drawn (REG_VCOUNT = that line), like the
// HBlank DMA model in hblankRegs.

import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  hblankRegs,
  OBJ_VRAM0,
  pltt,
  REG_OFFSET_BG0CNT,
  REG_OFFSET_BG0HOFS,
  REG_OFFSET_BG0VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_MOSAIC,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WIN1H,
  REG_OFFSET_WIN1V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  regs,
  setVCount,
  vram,
} from './hw';
import { gMain } from './main';
import { oamBuffer, oamMatrices, sOamDimensions } from './sprite';

const W = DISPLAY_WIDTH;
const H = DISPLAY_HEIGHT;
const LAYER_BD = 5;
const LAYER_OBJ = 4;

/** BGR555 -> ABGR8888 (little-endian RGBA bytes). */
const rgba = new Uint32Array(0x8000);
for (let c = 0; c < 0x8000; c++) {
  const r = c & 0x1f;
  const g = (c >> 5) & 0x1f;
  const b = (c >> 10) & 0x1f;
  rgba[c] = (0xff << 24) | (((b << 3) | (b >> 2)) << 16) | (((g << 3) | (g >> 2)) << 8) | ((r << 3) | (r >> 2));
}

// Per-line OBJ buffers
const objColor = new Int32Array(W); // -1 = none, else BGR555
const objPrio = new Uint8Array(W);
const objSemi = new Uint8Array(W);
const objWin = new Uint8Array(W);

/**
 * Sprites drawn outside OAM, as a screen-sized layer behind every OAM sprite: the overworld's objects
 * while the field is shown on this PPU (battle transitions). `color` is BGR555 or -1 (transparent).
 */
export interface ObjBitmapLayer {
  color: Int32Array;
  priority: Uint8Array;
}

let objBitmap: ObjBitmapLayer | null = null;

export function setObjBitmapLayer(layer: ObjBitmapLayer | null): void {
  objBitmap = layer;
}

function reg(offset: number, line: number): number {
  const h = hblankRegs.get(offset);
  return h ? h[line] : regs[offset >> 1];
}

/** Colour (BGR555) of BG `bg` at screen pixel (x, line), or -1 if transparent. */
function bgPixel(x: number, line: number, cnt: number, hofs: number, vofs: number): number {
  const charBase = ((cnt >> 2) & 3) * 0x4000;
  const screenBase = ((cnt >> 8) & 0x1f) * 0x800;
  const is8bpp = (cnt >> 7) & 1;
  const size = (cnt >> 14) & 3;
  const wPx = size & 1 ? 512 : 256;
  const hPx = size & 2 ? 512 : 256;
  const px = (x + hofs) & (wPx - 1);
  const py = (line + vofs) & (hPx - 1);
  let block = 0;
  if (px >= 256) block += 1;
  if (py >= 256) block += size === 3 ? 2 : 1;
  const tx = (px & 255) >> 3;
  const ty = (py & 255) >> 3;
  const ea = screenBase + block * 0x800 + (ty * 32 + tx) * 2;
  const entry = vram[ea & 0xffff] | (vram[(ea + 1) & 0xffff] << 8);
  const tile = entry & 0x3ff;
  let fx = px & 7;
  let fy = py & 7;
  if (entry & 0x400) fx = 7 - fx;
  if (entry & 0x800) fy = 7 - fy;
  let idx: number;
  if (is8bpp) {
    idx = vram[(charBase + tile * 64 + fy * 8 + fx) & 0xffff];
    if (!idx) return -1;
    return pltt[idx];
  }
  const b = vram[(charBase + tile * 32 + fy * 4 + (fx >> 1)) & 0xffff];
  idx = fx & 1 ? b >> 4 : b & 0xf;
  if (!idx) return -1;
  return pltt[((entry >> 12) << 4) + idx];
}

function renderObjLine(line: number, dispcnt: number): void {
  objColor.fill(-1);
  objPrio.fill(4);
  objSemi.fill(0);
  objWin.fill(0);
  if (!(dispcnt & 0x1000)) return;
  if (objBitmap) {
    objColor.set(objBitmap.color.subarray(line * W, line * W + W));
    objPrio.set(objBitmap.priority.subarray(line * W, line * W + W));
  }
  const oneD = (dispcnt & 0x40) !== 0;
  // Lower OAM index wins, so draw from the back of OAM to the front.
  for (let i = 127; i >= 0; i--) {
    const o = oamBuffer[i];
    const affine = o.affineMode & 1;
    if (!affine && o.affineMode & 2) continue; // disabled
    const [sw, sh] = sOamDimensions[o.shape]?.[o.size] ?? [8, 8];
    const dbl = affine && o.affineMode & 2 ? 2 : 1;
    const bw = sw * dbl;
    const bh = sh * dbl;
    let y = o.y;
    if (y + bh > 256) y -= 256;
    if (line < y || line >= y + bh) continue;
    let x0 = o.x;
    if (x0 >= 240) x0 -= 512;
    const is8bpp = o.bpp === 1;
    const tilesW = sw >> 3;
    const m = affine ? oamMatrices[o.matrixNum & 0x1f] : null;
    const hflip = !affine && (o.matrixNum >> 3) & 1;
    const vflip = !affine && (o.matrixNum >> 4) & 1;
    const ry = line - y;
    for (let rx = 0; rx < bw; rx++) {
      const sx = x0 + rx;
      if (sx < 0 || sx >= W) continue;
      let tx: number, ty: number;
      if (m) {
        const dx = rx - bw / 2;
        const dy = ry - bh / 2;
        tx = ((m.a * dx + m.b * dy) >> 8) + sw / 2;
        ty = ((m.c * dx + m.d * dy) >> 8) + sh / 2;
        if (tx < 0 || ty < 0 || tx >= sw || ty >= sh) continue;
      } else {
        tx = hflip ? sw - 1 - rx : rx;
        ty = vflip ? sh - 1 - ry : ry;
      }
      const tileX = tx >> 3;
      const tileY = ty >> 3;
      let tileNum: number;
      if (is8bpp) tileNum = (o.tileNum & ~1) + (oneD ? (tileY * tilesW + tileX) * 2 : tileY * 32 + tileX * 2);
      else tileNum = o.tileNum + (oneD ? tileY * tilesW + tileX : tileY * 32 + tileX);
      let color: number;
      if (is8bpp) {
        const idx = vram[OBJ_VRAM0 + ((tileNum * 32 + (ty & 7) * 8 + (tx & 7)) & 0x7fff)];
        if (!idx) continue;
        color = pltt[256 + idx];
      } else {
        const b = vram[OBJ_VRAM0 + ((tileNum * 32 + (ty & 7) * 4 + ((tx & 7) >> 1)) & 0x7fff)];
        const idx = tx & 1 ? b >> 4 : b & 0xf;
        if (!idx) continue;
        color = pltt[256 + o.paletteNum * 16 + idx];
      }
      if (o.objMode === 2) {
        objWin[sx] = 1;
        continue;
      }
      // Front-most (lower index) sprite wins regardless of priority among sprites.
      objColor[sx] = color;
      objPrio[sx] = o.priority;
      objSemi[sx] = o.objMode === 1 ? 1 : 0;
    }
  }
}

/**
 * Whether `v` is inside a window's span: X1 <= x < X2 (WINxH) or Y1 <= line < Y2 (WINxV). GBATEK:
 * "Garbage values of X2>240 or X1>X2 are interpreted as X2=240" (Y2>160 or Y1>Y2: Y2=160), so the
 * field's (255, 255) turns a window off.
 */
function inWindow(v: number, lo: number, hi: number, max: number): boolean {
  if (hi > max || lo > hi) hi = max;
  return v >= lo && v < hi;
}

function blend(a: number, b: number, eva: number, evb: number): number {
  const r = Math.min(31, ((a & 0x1f) * eva + (b & 0x1f) * evb) >> 4);
  const g = Math.min(31, (((a >> 5) & 0x1f) * eva + ((b >> 5) & 0x1f) * evb) >> 4);
  const bl = Math.min(31, (((a >> 10) & 0x1f) * eva + ((b >> 10) & 0x1f) * evb) >> 4);
  return r | (g << 5) | (bl << 10);
}

function brighten(a: number, evy: number): number {
  const f = (c: number) => c + (((31 - c) * evy) >> 4);
  return f(a & 0x1f) | (f((a >> 5) & 0x1f) << 5) | (f((a >> 10) & 0x1f) << 10);
}

function darken(a: number, evy: number): number {
  const f = (c: number) => c - ((c * evy) >> 4);
  return f(a & 0x1f) | (f((a >> 5) & 0x1f) << 5) | (f((a >> 10) & 0x1f) << 10);
}

/** Render a frame from the current hardware state into `out` (240*160 RGBA as u32). */
export function renderFrame(out: Uint32Array): void {
  const bgColor = new Int32Array(4);
  for (let line = 0; line < H; line++) {
    if (gMain.hblankCallback) {
      setVCount(line);
      gMain.hblankCallback();
    }
    const dispcnt = reg(REG_OFFSET_DISPCNT, line);
    if (dispcnt & 0x80) {
      out.fill(0xffffffff, line * W, line * W + W); // forced blank shows white
      continue;
    }
    renderObjLine(line, dispcnt);
    const cnt = [0, 1, 2, 3].map((b) => reg(REG_OFFSET_BG0CNT + b * 2, line));
    const hofs = [0, 1, 2, 3].map((b) => reg(REG_OFFSET_BG0HOFS + b * 4, line) & 0x1ff);
    const vofs = [0, 1, 2, 3].map((b) => reg(REG_OFFSET_BG0VOFS + b * 4, line) & 0x1ff);
    // BGs in draw order: priority, then index
    const order = [0, 1, 2, 3].filter((b) => dispcnt & (0x100 << b)).sort((a, b) => (cnt[a] & 3) - (cnt[b] & 3) || a - b);
    const winOn = dispcnt & 0xe000;
    const win0h = reg(REG_OFFSET_WIN0H, line);
    const win0v = reg(REG_OFFSET_WIN0V, line);
    const win1h = reg(REG_OFFSET_WIN1H, line);
    const win1v = reg(REG_OFFSET_WIN1V, line);
    const winin = reg(REG_OFFSET_WININ, line);
    const winout = reg(REG_OFFSET_WINOUT, line);
    const in0v = dispcnt & 0x2000 && inWindow(line, win0v >> 8, win0v & 0xff, H);
    const in1v = dispcnt & 0x4000 && inWindow(line, win1v >> 8, win1v & 0xff, H);
    const bldcnt = reg(REG_OFFSET_BLDCNT, line);
    const bldalpha = reg(REG_OFFSET_BLDALPHA, line);
    const evy = Math.min(16, reg(REG_OFFSET_BLDY, line) & 0x1f);
    const eva = Math.min(16, bldalpha & 0x1f);
    const evb = Math.min(16, (bldalpha >> 8) & 0x1f);
    const effect = (bldcnt >> 6) & 3;
    const backdrop = pltt[0];
    // BG mosaic: each block of (h + 1) x (v + 1) pixels shows its top-left pixel
    const mosaic = reg(REG_OFFSET_MOSAIC, line);
    const mosaicH = (mosaic & 0xf) + 1;
    const mosaicV = ((mosaic >> 4) & 0xf) + 1;
    const mosaicLine = line - (line % mosaicV);
    for (let x = 0; x < W; x++) {
      // Window mask: bits 0-3 BGs, 4 OBJ, 5 colour effects
      let mask = 0x3f;
      if (winOn) {
        if (in0v && inWindow(x, win0h >> 8, win0h & 0xff, W)) mask = winin & 0x3f;
        else if (in1v && inWindow(x, win1h >> 8, win1h & 0xff, W)) mask = (winin >> 8) & 0x3f;
        else if (dispcnt & 0x8000 && objWin[x]) mask = (winout >> 8) & 0x3f;
        else mask = winout & 0x3f;
      }
      for (const b of order) {
        if (!(mask & (1 << b))) bgColor[b] = -1;
        else if (cnt[b] & 0x40) bgColor[b] = bgPixel(x - (x % mosaicH), mosaicLine, cnt[b], hofs[b], vofs[b]);
        else bgColor[b] = bgPixel(x, line, cnt[b], hofs[b], vofs[b]);
      }
      // Find the top two layers.
      let top = backdrop;
      let topLayer = LAYER_BD;
      let second = backdrop;
      let secondLayer = LAYER_BD;
      let found = 0;
      const objHere = mask & 0x10 && objColor[x] >= 0;
      for (let p = 0; p < 4 && found < 2; p++) {
        if (objHere && objPrio[x] === p) {
          if (found === 0) {
            top = objColor[x];
            topLayer = LAYER_OBJ;
          } else {
            second = objColor[x];
            secondLayer = LAYER_OBJ;
          }
          found++;
          if (found >= 2) break;
        }
        for (const b of order) {
          if ((cnt[b] & 3) !== p || bgColor[b] < 0) continue;
          if (found === 0) {
            top = bgColor[b];
            topLayer = b;
          } else {
            second = bgColor[b];
            secondLayer = b;
          }
          found++;
          if (found >= 2) break;
        }
      }
      let c = top;
      const semi = topLayer === LAYER_OBJ && objSemi[x];
      if (semi && bldcnt & (0x100 << secondLayer)) {
        c = blend(top, second, eva, evb);
      } else if (mask & 0x20 && effect && bldcnt & (1 << topLayer)) {
        if (effect === 1) {
          if (bldcnt & (0x100 << secondLayer)) c = blend(top, second, eva, evb);
        } else if (effect === 2) c = brighten(top, evy);
        else c = darken(top, evy);
      }
      out[line * W + x] = rgba[c & 0x7fff];
    }
  }
}
