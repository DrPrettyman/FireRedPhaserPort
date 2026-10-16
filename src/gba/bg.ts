// bg.c: background control, tilemap buffers and their copies into VRAM, for text and affine BGs (an affine BG's
// tilemap buffer is a Uint16Array read as bytes). DMA copies complete immediately.

import { BgAffineSet } from './bios';
import {
  REG_OFFSET_BG2PA,
  REG_OFFSET_BG2PB,
  REG_OFFSET_BG2PC,
  REG_OFFSET_BG2PD,
  REG_OFFSET_BG2X_L,
  REG_OFFSET_BG2X_H,
  REG_OFFSET_BG2Y_L,
  REG_OFFSET_BG2Y_H,
  REG_OFFSET_BG3X_L,
  REG_OFFSET_BG3Y_L,
} from './hw';
import { BG_CHAR_ADDR, BG_SCREEN_ADDR, GetGpuReg, REG_OFFSET_BG0HOFS, REG_OFFSET_BG0VOFS, REG_OFFSET_BG1HOFS, REG_OFFSET_BG1VOFS, REG_OFFSET_BG2HOFS, REG_OFFSET_BG2VOFS, REG_OFFSET_BG3HOFS, REG_OFFSET_BG3VOFS, SetGpuReg, vram } from './hw';

const DISPCNT_ALL_BG_AND_MODE_BITS = 0x0f00 | 0x7;
const BG_CHAR_SIZE = 0x4000;
const BG_SCREEN_SIZE = 0x800;
const TILE_SIZE_4BPP = 0x20;

export const BG_ATTR_CHARBASEINDEX = 1;
export const BG_ATTR_MAPBASEINDEX = 2;
export const BG_ATTR_SCREENSIZE = 3;
export const BG_ATTR_PALETTEMODE = 4;
export const BG_ATTR_MOSAIC = 5;
export const BG_ATTR_WRAPAROUND = 6;
export const BG_ATTR_PRIORITY = 7;
export const BG_ATTR_MAPSIZE = 8;
export const BG_ATTR_BGTYPE = 9;
export const BG_ATTR_BASETILE = 10;

export const BG_COORD_SET = 0;
export const BG_COORD_ADD = 1;
export const BG_COORD_SUB = 2;

export const BG_TILE_FIND_FREE_SPACE = 0;
export const BG_TILE_ALLOC = 1;
export const BG_TILE_FREE = 2;

const BG_CTRL_ATTR_VISIBLE = 1;
const BG_CTRL_ATTR_CHARBASEINDEX = 2;
const BG_CTRL_ATTR_MAPBASEINDEX = 3;
const BG_CTRL_ATTR_SCREENSIZE = 4;
const BG_CTRL_ATTR_PALETTEMODE = 5;
const BG_CTRL_ATTR_PRIORITY = 6;
const BG_CTRL_ATTR_MOSAIC = 7;
const BG_CTRL_ATTR_WRAPAROUND = 8;

export const BG_TILE_H_FLIP = (n: number) => 0x400 + n;
export const BG_TILE_V_FLIP = (n: number) => 0x800 + n;

export interface BgTemplate {
  bg: number;
  charBaseIndex: number;
  mapBaseIndex: number;
  screenSize: number;
  paletteMode: number;
  priority: number;
  baseTile: number;
}

class BgConfig {
  visible = 0;
  screenSize = 0;
  priority = 0;
  mosaic = 0;
  wraparound = 0;
  charBaseIndex = 0;
  mapBaseIndex = 0;
  paletteMode = 0;
}

class BgConfig2 {
  baseTile = 0;
  basePalette = 0;
  tilemap: Uint16Array | null = null;
  bg_x = 0;
  bg_y = 0;
}

const sGpuBgConfigs = { configs: [new BgConfig(), new BgConfig(), new BgConfig(), new BgConfig()], bgVisibilityAndMode: 0 };
const sGpuBgConfigs2 = [new BgConfig2(), new BgConfig2(), new BgConfig2(), new BgConfig2()];
const gpu_tile_allocation_map_bg = new Uint8Array(0x100);
export let gWindowTileAutoAllocEnabled = false;

export function ResetBgs(): void {
  ResetBgControlStructs();
  sGpuBgConfigs.bgVisibilityAndMode = 0;
  SetTextModeAndHideBgs();
}

function SetBgModeInternal(bgMode: number): void {
  sGpuBgConfigs.bgVisibilityAndMode &= 0xfff8;
  sGpuBgConfigs.bgVisibilityAndMode |= bgMode;
}

export function GetBgMode(): number {
  return sGpuBgConfigs.bgVisibilityAndMode & 0x7;
}

export function ResetBgControlStructs(): void {
  for (let i = 0; i < 4; i++) sGpuBgConfigs.configs[i] = new BgConfig();
}

function SetBgControlAttributes(bg: number, charBaseIndex: number, mapBaseIndex: number, screenSize: number, paletteMode: number, priority: number, mosaic: number, wraparound: number): void {
  if (bg > 3) return;
  const c = sGpuBgConfigs.configs[bg];
  if (charBaseIndex !== 0xff) c.charBaseIndex = charBaseIndex & 0x3;
  if (mapBaseIndex !== 0xff) c.mapBaseIndex = mapBaseIndex & 0x1f;
  if (screenSize !== 0xff) c.screenSize = screenSize & 0x3;
  if (paletteMode !== 0xff) c.paletteMode = paletteMode & 1;
  if (priority !== 0xff) c.priority = priority & 0x3;
  if (mosaic !== 0xff) c.mosaic = mosaic & 0x1;
  if (wraparound !== 0xff) c.wraparound = wraparound & 1;
  c.visible = 1;
}

function GetBgControlAttribute(bg: number, attributeId: number): number {
  if (bg <= 3 && sGpuBgConfigs.configs[bg].visible) {
    const c = sGpuBgConfigs.configs[bg];
    switch (attributeId) {
      case BG_CTRL_ATTR_VISIBLE:
        return c.visible;
      case BG_CTRL_ATTR_CHARBASEINDEX:
        return c.charBaseIndex;
      case BG_CTRL_ATTR_MAPBASEINDEX:
        return c.mapBaseIndex;
      case BG_CTRL_ATTR_SCREENSIZE:
        return c.screenSize;
      case BG_CTRL_ATTR_PALETTEMODE:
        return c.paletteMode;
      case BG_CTRL_ATTR_PRIORITY:
        return c.priority;
      case BG_CTRL_ATTR_MOSAIC:
        return c.mosaic;
      case BG_CTRL_ATTR_WRAPAROUND:
        return c.wraparound;
    }
  }
  return 0xff;
}

/** Copy bytes (or u16s) into VRAM at byte `dst`. */
export function copyToVram(src: ArrayLike<number> | Uint16Array, dst: number, size: number): void {
  if (src instanceof Uint16Array) {
    for (let i = 0; i < size >> 1 && i < src.length; i++) {
      vram[dst + i * 2] = src[i] & 0xff;
      vram[dst + i * 2 + 1] = src[i] >> 8;
    }
  } else {
    for (let i = 0; i < size && i < src.length; i++) vram[dst + i] = src[i];
  }
}

/** LoadBgVram: mode 1 = char base, 2 = map base. */
function LoadBgVram(bg: number, src: ArrayLike<number>, size: number, destOffset: number, mode: number): number {
  if (bg > 3 || !sGpuBgConfigs.configs[bg].visible) return -1;
  const c = sGpuBgConfigs.configs[bg];
  let offset: number;
  switch (mode) {
    case 1:
      offset = c.charBaseIndex * BG_CHAR_SIZE;
      break;
    case 2:
      offset = c.mapBaseIndex * BG_SCREEN_SIZE;
      break;
    default:
      return -1;
  }
  copyToVram(src, (destOffset + offset) & 0xffff, size);
  return 0;
}

function ShowBgInternal(bg: number): void {
  if (bg > 3 || !sGpuBgConfigs.configs[bg].visible) return;
  const c = sGpuBgConfigs.configs[bg];
  const value = c.priority | (c.charBaseIndex << 2) | (c.mosaic << 6) | (c.paletteMode << 7) | (c.mapBaseIndex << 8) | (c.wraparound << 13) | (c.screenSize << 14);
  SetGpuReg((bg << 1) + 0x8, value);
  sGpuBgConfigs.bgVisibilityAndMode |= 1 << (bg + 8);
  sGpuBgConfigs.bgVisibilityAndMode &= DISPCNT_ALL_BG_AND_MODE_BITS;
}

function HideBgInternal(bg: number): void {
  if (bg > 3) return;
  sGpuBgConfigs.bgVisibilityAndMode &= ~(1 << (bg + 8));
  sGpuBgConfigs.bgVisibilityAndMode &= DISPCNT_ALL_BG_AND_MODE_BITS;
}

function SyncBgVisibilityAndMode(): void {
  SetGpuReg(0, (GetGpuReg(0) & ~DISPCNT_ALL_BG_AND_MODE_BITS) | sGpuBgConfigs.bgVisibilityAndMode);
}

export function SetTextModeAndHideBgs(): void {
  SetGpuReg(0, GetGpuReg(0) & ~DISPCNT_ALL_BG_AND_MODE_BITS);
}

export function BgTileAllocOp(bg: number, offset: number, count: number, mode: number): number {
  const base = GetBgControlAttribute(bg, BG_CTRL_ATTR_CHARBASEINDEX) * (BG_CHAR_SIZE / TILE_SIZE_4BPP);
  switch (mode) {
    case BG_TILE_FIND_FREE_SPACE: {
      let end = base + 0x400;
      if (end > 0x800) end = 0x800;
      let blockSize = 0;
      let blockStart = 0;
      for (let i = base, off = 0; i < end; i++, off++) {
        if (!((gpu_tile_allocation_map_bg[i >> 3] >> (i & 7)) & 1)) {
          if (blockSize) {
            blockSize++;
            if (blockSize === count) return blockStart;
          } else {
            blockStart = off;
            blockSize = 1;
          }
        } else {
          blockSize = 0;
        }
      }
      return -1;
    }
    case BG_TILE_ALLOC:
      for (let i = base + offset; i < base + offset + count; i++) gpu_tile_allocation_map_bg[i >> 3] |= 1 << (i & 7);
      break;
    case BG_TILE_FREE:
      for (let i = base + offset; i < base + offset + count; i++) gpu_tile_allocation_map_bg[i >> 3] &= ~(1 << (i & 7));
      break;
  }
  return 0;
}

export function ResetBgsAndClearDma3BusyFlags(enableWindowTileAutoAlloc: boolean): void {
  ResetBgs();
  gWindowTileAutoAllocEnabled = enableWindowTileAutoAlloc;
  gpu_tile_allocation_map_bg.fill(0);
}

export function InitBgsFromTemplates(bgMode: number, templates: BgTemplate[], numTemplates = templates.length): void {
  SetBgModeInternal(bgMode);
  ResetBgControlStructs();
  for (let i = 0; i < numTemplates; i++) InitBgFromTemplate(templates[i]);
}

export function InitBgFromTemplate(t: BgTemplate): void {
  const bg = t.bg;
  if (bg >= 4) return;
  SetBgControlAttributes(bg, t.charBaseIndex, t.mapBaseIndex, t.screenSize, t.paletteMode, t.priority, 0, 0);
  const c2 = sGpuBgConfigs2[bg];
  c2.baseTile = t.baseTile;
  c2.basePalette = 0;
  c2.tilemap = null;
  c2.bg_x = 0;
  c2.bg_y = 0;
  gpu_tile_allocation_map_bg[(t.charBaseIndex * (BG_CHAR_SIZE / TILE_SIZE_4BPP)) >> 3] = 1;
}

/** LoadBgTiles: `destOffset` in tiles. */
export function LoadBgTiles(bg: number, src: ArrayLike<number>, size: number, destOffset: number): number {
  const tileOffset = (sGpuBgConfigs2[bg].baseTile + destOffset) * (GetBgControlAttribute(bg, BG_CTRL_ATTR_PALETTEMODE) === 0 ? 0x20 : 0x40);
  const cursor = LoadBgVram(bg, src, size, tileOffset, 1);
  if (cursor === -1) return -1;
  if (gWindowTileAutoAllocEnabled) BgTileAllocOp(bg, tileOffset >> 5, size >> 5, BG_TILE_ALLOC);
  return cursor;
}

/** LoadBgTilemap: `destOffset` in 32-byte units. */
export function LoadBgTilemap(bg: number, src: ArrayLike<number> | Uint16Array, size: number, destOffset: number): number {
  return LoadBgVram(bg, src, size, destOffset * 32, 2);
}

/** DMA completes immediately, so nothing is ever pending. */
export function IsDma3ManagerBusyWithBgCopy(): boolean {
  return false;
}

export function ShowBg(bg: number): void {
  ShowBgInternal(bg);
  SyncBgVisibilityAndMode();
}

export function HideBg(bg: number): void {
  HideBgInternal(bg);
  SyncBgVisibilityAndMode();
}

export function SetBgAttribute(bg: number, attributeId: number, value: number): void {
  const F = 0xff;
  switch (attributeId) {
    case 1:
      SetBgControlAttributes(bg, value, F, F, F, F, F, F);
      break;
    case 2:
      SetBgControlAttributes(bg, F, value, F, F, F, F, F);
      break;
    case 3:
      SetBgControlAttributes(bg, F, F, value, F, F, F, F);
      break;
    case 4:
      SetBgControlAttributes(bg, F, F, F, value, F, F, F);
      break;
    case 7:
      SetBgControlAttributes(bg, F, F, F, F, value, F, F);
      break;
    case 5:
      SetBgControlAttributes(bg, F, F, F, F, F, value, F);
      break;
    case 6:
      SetBgControlAttributes(bg, F, F, F, F, F, F, value);
      break;
  }
}

export function GetBgAttribute(bg: number, attributeId: number): number {
  switch (attributeId) {
    case BG_ATTR_CHARBASEINDEX:
      return GetBgControlAttribute(bg, BG_CTRL_ATTR_CHARBASEINDEX);
    case BG_ATTR_MAPBASEINDEX:
      return GetBgControlAttribute(bg, BG_CTRL_ATTR_MAPBASEINDEX);
    case BG_ATTR_SCREENSIZE:
      return GetBgControlAttribute(bg, BG_CTRL_ATTR_SCREENSIZE);
    case BG_ATTR_PALETTEMODE:
      return GetBgControlAttribute(bg, BG_CTRL_ATTR_PALETTEMODE);
    case BG_ATTR_PRIORITY:
      return GetBgControlAttribute(bg, BG_CTRL_ATTR_PRIORITY);
    case BG_ATTR_MOSAIC:
      return GetBgControlAttribute(bg, BG_CTRL_ATTR_MOSAIC);
    case BG_ATTR_WRAPAROUND:
      return GetBgControlAttribute(bg, BG_CTRL_ATTR_WRAPAROUND);
    case BG_ATTR_MAPSIZE:
      return GetBgType(bg) === 0 ? GetBgMetricTextMode(bg, 0) * 0x800 : 0;
    case BG_ATTR_BGTYPE:
      return GetBgType(bg);
    case BG_ATTR_BASETILE:
      return sGpuBgConfigs2[bg].baseTile;
  }
  return -1;
}

const HOFS = [REG_OFFSET_BG0HOFS, REG_OFFSET_BG1HOFS, REG_OFFSET_BG2HOFS, REG_OFFSET_BG3HOFS];
const VOFS = [REG_OFFSET_BG0VOFS, REG_OFFSET_BG1VOFS, REG_OFFSET_BG2VOFS, REG_OFFSET_BG3VOFS];

/**
 * ChangeBgX/Y's register writes: BG0/BG1 (and BG2/BG3 in text mode) scroll by the value's integer part; an affine
 * BG2 (modes 1, 2) or BG3 (mode 2) gets the whole value as its reference point (BGxX/Y_L and _H).
 */
function setBgCoordRegs(bg: number, value: number, ofs: number[], bg2Ref: number, bg3Ref: number): void {
  const mode = GetBgMode();
  if (bg < 2 || mode === 0) SetGpuReg(ofs[bg], (value >>> 8) & 0xffff);
  else if (bg === 2 || mode === 2) {
    const ref = bg === 2 ? bg2Ref : bg3Ref;
    SetGpuReg(ref + 2, (value >>> 16) & 0xffff);
    SetGpuReg(ref, value & 0xffff);
  }
}

/** ChangeBgX: `value` is 8.8 fixed point in text mode. */
export function ChangeBgX(bg: number, value: number, op: number): number {
  if (bg > 3) return -1; // the C's visibility check compares against 0, which never matches
  const c2 = sGpuBgConfigs2[bg];
  if (op === BG_COORD_ADD) c2.bg_x = (c2.bg_x + value) >>> 0;
  else if (op === BG_COORD_SUB) c2.bg_x = (c2.bg_x - value) >>> 0;
  else c2.bg_x = value >>> 0;
  setBgCoordRegs(bg, c2.bg_x, HOFS, REG_OFFSET_BG2X_L, REG_OFFSET_BG3X_L);
  return c2.bg_x;
}

export function GetBgX(bg: number): number {
  return sGpuBgConfigs2[bg].bg_x;
}

export function ChangeBgY(bg: number, value: number, op: number): number {
  if (bg > 3) return -1; // the C's visibility check compares against 0, which never matches
  const c2 = sGpuBgConfigs2[bg];
  if (op === BG_COORD_ADD) c2.bg_y = (c2.bg_y + value) >>> 0;
  else if (op === BG_COORD_SUB) c2.bg_y = (c2.bg_y - value) >>> 0;
  else c2.bg_y = value >>> 0;
  setBgCoordRegs(bg, c2.bg_y, VOFS, REG_OFFSET_BG2Y_L, REG_OFFSET_BG3Y_L);
  return c2.bg_y;
}

export function GetBgY(bg: number): number {
  return sGpuBgConfigs2[bg].bg_y;
}

/** SetBgAffine (SetBgAffineInternal): BgAffineSet into BG2's affine registers (modes 1 and 2 only). */
export function SetBgAffine(bg: number, srcCenterX: number, srcCenterY: number, dispCenterX: number, dispCenterY: number, scaleX: number, scaleY: number, rotationAngle: number): void {
  switch (GetBgMode()) {
    case 1:
      if (bg !== 2) return;
      break;
    case 2:
      if (bg < 2 || bg > 3) return;
      break;
    default:
      return;
  }
  const dest = BgAffineSet({ texX: srcCenterX, texY: srcCenterY, scrX: dispCenterX, scrY: dispCenterY, sx: scaleX, sy: scaleY, alpha: rotationAngle });
  // (sic) BG2's registers, also for BG3 in mode 2
  SetGpuReg(REG_OFFSET_BG2PA, dest.pa);
  SetGpuReg(REG_OFFSET_BG2PB, dest.pb);
  SetGpuReg(REG_OFFSET_BG2PC, dest.pc);
  SetGpuReg(REG_OFFSET_BG2PD, dest.pd);
  SetGpuReg(REG_OFFSET_BG2PA, dest.pa);
  SetGpuReg(REG_OFFSET_BG2X_L, dest.dx & 0xffff);
  SetGpuReg(REG_OFFSET_BG2X_H, (dest.dx >> 16) & 0xffff);
  SetGpuReg(REG_OFFSET_BG2Y_L, dest.dy & 0xffff);
  SetGpuReg(REG_OFFSET_BG2Y_H, (dest.dy >> 16) & 0xffff);
}

/** An affine BG's tilemap buffer as bytes (affine tilemap entries are u8; the buffer is kept as a Uint16Array). */
function affineBytes(tm: Uint16Array): Uint8Array {
  return new Uint8Array(tm.buffer, tm.byteOffset, tm.byteLength);
}

/** GetBgMetricAffineMode: 0 = the map size in 0x100-byte units, 1/2 = tiles per row/column. */
export function GetBgMetricAffineMode(bg: number, whichMetric: number): number {
  const a = GetBgControlAttribute(bg, BG_CTRL_ATTR_SCREENSIZE);
  switch (whichMetric) {
    case 0:
      return [0x1, 0x4, 0x10, 0x40][a] ?? 0;
    case 1:
    case 2:
      return 0x10 << a;
  }
  return 0;
}

export function SetBgTilemapBuffer(bg: number, tilemap: Uint16Array): void {
  if (bg <= 3) sGpuBgConfigs2[bg].tilemap = tilemap;
}

export function UnsetBgTilemapBuffer(bg: number): void {
  if (bg <= 3) sGpuBgConfigs2[bg].tilemap = null;
}

export function GetBgTilemapBuffer(bg: number): Uint16Array | null {
  if (bg > 3) return null;
  return sGpuBgConfigs2[bg].tilemap;
}

/** CopyToBgTilemapBuffer: `src` is tilemap entries (u16), `mode` the byte size (0 = whole source). */
export function CopyToBgTilemapBuffer(bg: number, src: ArrayLike<number>, mode: number, destOffset: number): void {
  const tm = sGpuBgConfigs2[bg]?.tilemap;
  if (!tm) return;
  const n = mode ? mode >> 1 : src.length;
  for (let i = 0; i < n && i < src.length; i++) tm[destOffset * 16 + i] = src[i];
}

export function CopyBgTilemapBufferToVram(bg: number): void {
  const tm = sGpuBgConfigs2[bg]?.tilemap;
  if (!tm) return;
  const type = GetBgType(bg);
  const size = type === 0 ? GetBgMetricTextMode(bg, 0) * 0x800 : type === 1 ? GetBgMetricAffineMode(bg, 0) * 0x100 : 0;
  LoadBgVram(bg, tm, size, 0, 2);
}

export function CopyToBgTilemapBufferRect(bg: number, src: ArrayLike<number>, destX: number, destY: number, width: number, height: number): void {
  const tm = sGpuBgConfigs2[bg]?.tilemap;
  if (!tm) return;
  if (GetBgType(bg) === 1) {
    // `src` is u8 tilemap entries
    const bytes = affineBytes(tm);
    const mode = GetBgMetricAffineMode(bg, 1);
    let s = 0;
    for (let y = destY; y < destY + height; y++) for (let x = destX; x < destX + width; x++) bytes[(y * mode + x) % bytes.length] = src[s++] & 0xff;
    return;
  }
  if (GetBgType(bg) !== 0) return;
  let s = 0;
  for (let y = destY; y < destY + height; y++) for (let x = destX; x < destX + width; x++) tm[(y * 0x20 + x) & 0xffff] = src[s++];
}

export function CopyToBgTilemapBufferRect_ChangePalette(bg: number, src: ArrayLike<number>, destX: number, destY: number, rectWidth: number, rectHeight: number, palette: number): void {
  CopyRectToBgTilemapBufferRect(bg, src, 0, 0, rectWidth, rectHeight, destX, destY, rectWidth, rectHeight, palette, 0, 0);
}

export function CopyRectToBgTilemapBufferRect(
  bg: number,
  src: ArrayLike<number>,
  srcX: number,
  srcY: number,
  srcWidth: number,
  _srcHeight: number,
  destX: number,
  destY: number,
  rectWidth: number,
  rectHeight: number,
  palette1: number,
  tileOffset: number,
  palette2: number,
): void {
  const tm = sGpuBgConfigs2[bg]?.tilemap;
  if (!tm) return;
  if (GetBgType(bg) === 1) {
    // `src` is u8 tilemap entries; tileOffset is added to each
    const bytes = affineBytes(tm);
    const mode = GetBgMetricAffineMode(bg, 1);
    let s = srcY * srcWidth + srcX;
    for (let i = destY; i < destY + rectHeight; i++) {
      for (let j = destX; j < destX + rectWidth; j++) bytes[(mode * i + j) % bytes.length] = (src[s++] + tileOffset) & 0xff;
      s += srcWidth - rectWidth;
    }
    return;
  }
  if (GetBgType(bg) !== 0) return;
  const screenSize = GetBgControlAttribute(bg, BG_CTRL_ATTR_SCREENSIZE);
  const screenWidth = GetBgMetricTextMode(bg, 1) * 0x20;
  const screenHeight = GetBgMetricTextMode(bg, 2) * 0x20;
  let s = srcY * srcWidth + srcX;
  for (let i = destY; i < destY + rectHeight; i++) {
    for (let j = destX; j < destX + rectWidth; j++) {
      const index = GetTileMapIndexFromCoords(j, i, screenSize, screenWidth, screenHeight);
      tm[index] = CopyTileMapEntry(src[s], tm[index], palette1, tileOffset, palette2);
      s++;
    }
    s += srcWidth - rectWidth;
  }
}

export function FillBgTilemapBufferRect_Palette0(bg: number, tileNum: number, x: number, y: number, width: number, height: number): void {
  const tm = sGpuBgConfigs2[bg]?.tilemap;
  if (!tm) return;
  if (GetBgType(bg) === 1) {
    const bytes = affineBytes(tm);
    const mode = GetBgMetricAffineMode(bg, 1);
    for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) bytes[(yy * mode + xx) % bytes.length] = tileNum & 0xff;
    return;
  }
  if (GetBgType(bg) !== 0) return;
  for (let yy = y; yy < y + height; yy++) for (let xx = x; xx < x + width; xx++) tm[(yy * 0x20 + xx) & 0xffff] = tileNum;
}

export function FillBgTilemapBufferRect(bg: number, tileNum: number, x: number, y: number, width: number, height: number, palette: number): void {
  WriteSequenceToBgTilemapBuffer(bg, tileNum, x, y, width, height, palette, 0);
}

export function WriteSequenceToBgTilemapBuffer(bg: number, firstTileNum: number, x: number, y: number, width: number, height: number, paletteSlot: number, tileNumDelta: number): void {
  const tm = sGpuBgConfigs2[bg]?.tilemap;
  if (!tm) return;
  if (GetBgType(bg) === 1) {
    const bytes = affineBytes(tm);
    const mode = GetBgMetricAffineMode(bg, 1);
    for (let yy = y; yy < y + height; yy++) {
      for (let xx = x; xx < x + width; xx++) {
        bytes[(yy * mode + xx) % bytes.length] = firstTileNum & 0xff;
        firstTileNum = (firstTileNum & 0xfc00) + ((firstTileNum + tileNumDelta) & 0x3ff);
      }
    }
    return;
  }
  if (GetBgType(bg) !== 0) return;
  const attribute = GetBgControlAttribute(bg, BG_CTRL_ATTR_SCREENSIZE);
  const w = GetBgMetricTextMode(bg, 1) * 0x20;
  const h = GetBgMetricTextMode(bg, 2) * 0x20;
  for (let yy = y; yy < y + height; yy++) {
    for (let xx = x; xx < x + width; xx++) {
      const i = GetTileMapIndexFromCoords(xx, yy, attribute, w, h) & 0xffff;
      tm[i] = CopyTileMapEntry(firstTileNum, tm[i], paletteSlot, 0, 0);
      firstTileNum = (firstTileNum & 0xfc00) + ((firstTileNum + tileNumDelta) & 0x3ff);
    }
  }
}

export function GetBgMetricTextMode(bg: number, whichMetric: number): number {
  const a = GetBgControlAttribute(bg, BG_CTRL_ATTR_SCREENSIZE);
  switch (whichMetric) {
    case 0:
      return [1, 2, 2, 4][a] ?? 0;
    case 1:
      return [1, 2, 1, 2][a] ?? 0;
    case 2:
      return [1, 1, 2, 2][a] ?? 0;
  }
  return 0;
}

export function GetTileMapIndexFromCoords(x: number, y: number, screenSize: number, screenWidth: number, screenHeight: number): number {
  x &= screenWidth - 1;
  y &= screenHeight - 1;
  switch (screenSize) {
    case 3:
      if (y >= 0x20) y += 0x20;
    // fallthrough
    case 1:
      if (x >= 0x20) {
        x -= 0x20;
        y += 0x20;
      }
  }
  return y * 0x20 + x;
}

/** CopyTileMapEntry: returns the new entry. */
function CopyTileMapEntry(src: number, dest: number, palette1: number, tileOffset: number, palette2: number): number {
  if (palette1 >= 0 && palette1 <= 15) return (((src + tileOffset) & 0xfff) + ((palette1 + palette2) << 12)) & 0xffff;
  if (palette1 === 16) return ((dest & 0xfc00) + (palette2 << 12)) | ((src + tileOffset) & 0x3ff);
  return (src + tileOffset + (palette2 << 12)) & 0xffff;
}

export function GetBgType(bg: number): number {
  const mode = GetBgMode();
  switch (bg) {
    case 0:
    case 1:
      if (mode === 0 || mode === 1) return 0;
      break;
    case 2:
      if (mode === 0) return 0;
      if (mode === 1 || mode === 2) return 1;
      break;
    case 3:
      if (mode === 0) return 0;
      if (mode === 2) return 1;
      break;
  }
  return 0xffff;
}

/** LZDecompressVram into a BG char/screen block (our sources are stored decompressed). */
export function LZDecompressVram(src: ArrayLike<number>, dstByte: number): void {
  copyToVram(src, dstByte, src.length);
}

export { BG_CHAR_ADDR, BG_SCREEN_ADDR };
