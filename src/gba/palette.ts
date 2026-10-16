// palette.c + blend_palette.c: the unfaded/faded palette buffers and the palette fade engine.

import { CreateTask, DestroyTask, gTasks, NUM_TASKS, type TaskFunc } from './task';
import { BLDCNT_EFFECT_NONE, PLTT_SIZE, pltt, REG_OFFSET_BLDCNT, REG_OFFSET_BLDY, RGB_BLACK, RGB_WHITE, SetGpuReg } from './hw';

export const PLTT_BUFFER_SIZE = PLTT_SIZE / 2;
export const OBJ_PLTT_OFFSET = 0x100;
export const PLTT_ID = (n: number) => n * 16;
export const BG_PLTT_ID = PLTT_ID;
export const OBJ_PLTT_ID = (n: number) => OBJ_PLTT_OFFSET + PLTT_ID(n);
export const PLTT_SIZE_4BPP = 0x20;

export const PALETTE_FADE_STATUS_DELAY = 2;
export const PALETTE_FADE_STATUS_ACTIVE = 1;
export const PALETTE_FADE_STATUS_DONE = 0;
export const PALETTE_FADE_STATUS_LOADING = 0xff;

export const FAST_FADE_IN_FROM_WHITE = 0;
export const FAST_FADE_OUT_TO_WHITE = 1;
export const FAST_FADE_IN_FROM_BLACK = 2;
export const FAST_FADE_OUT_TO_BLACK = 3;

const NORMAL_FADE = 0;
const FAST_FADE = 1;
const HARDWARE_FADE = 2;

export const gPlttBufferUnfaded = new Uint16Array(PLTT_BUFFER_SIZE);
export const gPlttBufferFaded = new Uint16Array(PLTT_BUFFER_SIZE);

/** struct PaletteFadeControl (bitfield widths are applied on write). */
class PaletteFadeControl {
  /** gPaletteFade_selectedPalettes / gPaletteFade_blendCnt */
  multipurpose1 = 0;
  private _delayCounter = 0;
  private _y = 0;
  private _targetY = 0;
  blendColor = 0;
  active = false;
  /** gPaletteFade_delay / gPaletteFade_submode */
  private _multipurpose2 = 0;
  yDec = false;
  bufferTransferDisabled = false;
  mode = 0;
  shouldResetBlendRegisters = false;
  hardwareFadeFinishing = 0;
  softwareFadeFinishingCounter = 0;
  softwareFadeFinishing = false;
  objPaletteToggle = 0;
  private _deltaY = 2;
  get delayCounter() { return this._delayCounter; }
  set delayCounter(v: number) { this._delayCounter = v & 0x3f; }
  get y() { return this._y; }
  set y(v: number) { this._y = v & 0x1f; }
  get targetY() { return this._targetY; }
  set targetY(v: number) { this._targetY = v & 0x1f; }
  get multipurpose2() { return this._multipurpose2; }
  set multipurpose2(v: number) { this._multipurpose2 = v & 0x3f; }
  get deltaY() { return this._deltaY; }
  set deltaY(v: number) { this._deltaY = v & 0xf; }
}

export const gPaletteFade = new PaletteFadeControl();
let sPlttBufferTransferPending = 0;

const r5 = (c: number) => c & 0x1f;
const g5 = (c: number) => (c >> 5) & 0x1f;
const b5 = (c: number) => (c >> 10) & 0x1f;

/** LoadPalette: `offset` in colours, `size` in bytes. */
export function LoadPalette(src: ArrayLike<number>, offset: number, size: number): void {
  for (let i = 0; i < size >> 1 && i < src.length; i++) {
    gPlttBufferUnfaded[offset + i] = src[i];
    gPlttBufferFaded[offset + i] = src[i];
  }
}

/** LoadCompressedPalette: our graphics are stored decompressed, so this is LoadPalette. */
export const LoadCompressedPalette = LoadPalette;

export function FillPalette(value: number, offset: number, size: number): void {
  for (let i = 0; i < size >> 1; i++) {
    gPlttBufferUnfaded[offset + i] = value;
    gPlttBufferFaded[offset + i] = value;
  }
}

/** TransferPlttBuffer (VBlank) */
export function TransferPlttBuffer(): void {
  if (!gPaletteFade.bufferTransferDisabled) {
    pltt.set(gPlttBufferFaded);
    sPlttBufferTransferPending = 0;
    if (gPaletteFade.mode === HARDWARE_FADE && gPaletteFade.active) updateBlendRegisters();
  }
}

/** UpdatePaletteFade */
export function UpdatePaletteFade(): number {
  if (sPlttBufferTransferPending) return PALETTE_FADE_STATUS_LOADING;
  let result: number;
  if (gPaletteFade.mode === NORMAL_FADE) result = updateNormalPaletteFade();
  else if (gPaletteFade.mode === FAST_FADE) result = updateFastPaletteFade();
  else result = updateHardwarePaletteFade();
  sPlttBufferTransferPending = gPaletteFade.multipurpose1;
  return result;
}

export function ResetPaletteFade(): void {
  ResetPaletteFadeControl();
}

/** BeginNormalPaletteFade */
export function BeginNormalPaletteFade(selectedPalettes: number, delay: number, startY: number, targetY: number, blendColor: number): boolean {
  if (gPaletteFade.active) return false;
  gPaletteFade.deltaY = 2;
  if (delay < 0) {
    gPaletteFade.deltaY += -delay;
    delay = 0;
  }
  gPaletteFade.multipurpose1 = selectedPalettes >>> 0;
  gPaletteFade.delayCounter = delay;
  gPaletteFade.multipurpose2 = delay;
  gPaletteFade.y = startY;
  gPaletteFade.targetY = targetY;
  gPaletteFade.blendColor = blendColor;
  gPaletteFade.active = true;
  gPaletteFade.mode = NORMAL_FADE;
  gPaletteFade.yDec = !(startY < targetY);
  UpdatePaletteFade();
  const temp = gPaletteFade.bufferTransferDisabled;
  gPaletteFade.bufferTransferDisabled = false;
  pltt.set(gPlttBufferFaded);
  sPlttBufferTransferPending = 0;
  if (gPaletteFade.mode === HARDWARE_FADE && gPaletteFade.active) updateBlendRegisters();
  gPaletteFade.bufferTransferDisabled = temp;
  return true;
}

export function ResetPaletteFadeControl(): void {
  const f = gPaletteFade;
  f.multipurpose1 = 0;
  f.multipurpose2 = 0;
  f.delayCounter = 0;
  f.y = 0;
  f.targetY = 0;
  f.blendColor = 0;
  f.active = false;
  f.yDec = false;
  f.bufferTransferDisabled = false;
  f.shouldResetBlendRegisters = false;
  f.hardwareFadeFinishing = 0;
  f.softwareFadeFinishing = false;
  f.softwareFadeFinishingCounter = 0;
  f.objPaletteToggle = 0;
  f.deltaY = 2;
}

function updateNormalPaletteFade(): number {
  const f = gPaletteFade;
  if (!f.active) return PALETTE_FADE_STATUS_DONE;
  if (isSoftwarePaletteFadeFinishing()) return f.active ? PALETTE_FADE_STATUS_ACTIVE : PALETTE_FADE_STATUS_DONE;
  if (!f.objPaletteToggle) {
    if (f.delayCounter < f.multipurpose2) {
      f.delayCounter++;
      return 2;
    }
    f.delayCounter = 0;
  }
  let paletteOffset = 0;
  let selectedPalettes: number;
  if (!f.objPaletteToggle) {
    selectedPalettes = f.multipurpose1 & 0xffff;
  } else {
    selectedPalettes = f.multipurpose1 >>> 16;
    paletteOffset = OBJ_PLTT_OFFSET;
  }
  while (selectedPalettes) {
    if (selectedPalettes & 1) BlendPalette(paletteOffset, 16, f.y, f.blendColor);
    selectedPalettes >>>= 1;
    paletteOffset += 16;
  }
  f.objPaletteToggle ^= 1;
  if (!f.objPaletteToggle) {
    if (f.y === f.targetY) {
      f.multipurpose1 = 0;
      f.softwareFadeFinishing = true;
    } else if (!f.yDec) {
      let val = (f.y + f.deltaY) << 24 >> 24; // s8
      if (val > f.targetY) val = f.targetY;
      f.y = val;
    } else {
      let val = (f.y - f.deltaY) << 24 >> 24;
      if (val < f.targetY) val = f.targetY;
      f.y = val;
    }
  }
  return f.active ? PALETTE_FADE_STATUS_ACTIVE : PALETTE_FADE_STATUS_DONE;
}

export function InvertPlttBuffer(selectedPalettes: number): void {
  let paletteOffset = 0;
  while (selectedPalettes) {
    if (selectedPalettes & 1) for (let i = 0; i < 16; ++i) gPlttBufferFaded[paletteOffset + i] = ~gPlttBufferFaded[paletteOffset + i];
    selectedPalettes >>>= 1;
    paletteOffset += 16;
  }
}

export function UnfadePlttBuffer(selectedPalettes: number): void {
  let paletteOffset = 0;
  while (selectedPalettes) {
    if (selectedPalettes & 1) for (let i = 0; i < 16; ++i) gPlttBufferFaded[paletteOffset + i] = gPlttBufferUnfaded[paletteOffset + i];
    selectedPalettes >>>= 1;
    paletteOffset += 16;
  }
}

/** BeginFastPaletteFade */
export function BeginFastPaletteFade(submode: number): void {
  const f = gPaletteFade;
  f.deltaY = 2;
  f.y = 31;
  f.multipurpose2 = submode & 0x3f;
  f.active = true;
  f.mode = FAST_FADE;
  if (submode === FAST_FADE_IN_FROM_BLACK) gPlttBufferFaded.fill(RGB_BLACK);
  if (submode === FAST_FADE_IN_FROM_WHITE) gPlttBufferFaded.fill(RGB_WHITE);
  UpdatePaletteFade();
}

function updateFastPaletteFade(): number {
  const f = gPaletteFade;
  if (!f.active) return PALETTE_FADE_STATUS_DONE;
  if (isSoftwarePaletteFadeFinishing()) return f.active ? PALETTE_FADE_STATUS_ACTIVE : PALETTE_FADE_STATUS_DONE;
  const [start, end] = f.objPaletteToggle ? [OBJ_PLTT_OFFSET, PLTT_BUFFER_SIZE] : [0, OBJ_PLTT_OFFSET];
  const submode = f.multipurpose2;
  for (let i = start; i < end; ++i) {
    const u = gPlttBufferUnfaded[i];
    const c = gPlttBufferFaded[i];
    let r: number, g: number, b: number;
    switch (submode) {
      case FAST_FADE_IN_FROM_WHITE:
        r = Math.max(r5(c) - 2, r5(u));
        g = Math.max(g5(c) - 2, g5(u));
        b = Math.max(b5(c) - 2, b5(u));
        break;
      case FAST_FADE_OUT_TO_WHITE:
        r = Math.min(r5(c) + 2, 31);
        g = Math.min(g5(c) + 2, 31);
        b = Math.min(b5(c) + 2, 31);
        break;
      case FAST_FADE_IN_FROM_BLACK:
        r = Math.min(r5(c) + 2, r5(u));
        g = Math.min(g5(c) + 2, g5(u));
        b = Math.min(b5(c) + 2, b5(u));
        break;
      case FAST_FADE_OUT_TO_BLACK:
        r = Math.max(r5(c) - 2, 0);
        g = Math.max(g5(c) - 2, 0);
        b = Math.max(b5(c) - 2, 0);
        break;
      default:
        continue;
    }
    gPlttBufferFaded[i] = r | (g << 5) | (b << 10);
  }
  f.objPaletteToggle ^= 1;
  if (f.objPaletteToggle) return f.active ? PALETTE_FADE_STATUS_ACTIVE : PALETTE_FADE_STATUS_DONE;
  if (f.y - f.deltaY < 0) f.y = 0;
  else f.y -= f.deltaY;
  if (f.y === 0) {
    switch (submode) {
      case FAST_FADE_IN_FROM_WHITE:
      case FAST_FADE_IN_FROM_BLACK:
        gPlttBufferFaded.set(gPlttBufferUnfaded);
        break;
      case FAST_FADE_OUT_TO_WHITE:
        gPlttBufferFaded.fill(0xffff);
        break;
      case FAST_FADE_OUT_TO_BLACK:
        gPlttBufferFaded.fill(0);
        break;
    }
    f.mode = NORMAL_FADE;
    f.softwareFadeFinishing = true;
  }
  return f.active ? PALETTE_FADE_STATUS_ACTIVE : PALETTE_FADE_STATUS_DONE;
}

export function BeginHardwarePaletteFade(blendCnt: number, delay: number, y: number, targetY: number, shouldResetBlendRegisters: number): void {
  const f = gPaletteFade;
  f.multipurpose1 = blendCnt;
  f.delayCounter = delay;
  f.multipurpose2 = delay;
  f.y = y;
  f.targetY = targetY;
  f.active = true;
  f.mode = HARDWARE_FADE;
  f.shouldResetBlendRegisters = (shouldResetBlendRegisters & 1) !== 0;
  f.hardwareFadeFinishing = 0;
  f.yDec = !(y < targetY);
}

function updateHardwarePaletteFade(): number {
  const f = gPaletteFade;
  if (!f.active) return PALETTE_FADE_STATUS_DONE;
  if (f.delayCounter < f.multipurpose2) {
    f.delayCounter++;
    return PALETTE_FADE_STATUS_DELAY;
  }
  f.delayCounter = 0;
  if (!f.yDec) {
    if (f.y + 1 > f.targetY) f.hardwareFadeFinishing++;
    else f.y++;
  } else if (f.y - 1 < f.targetY) {
    f.hardwareFadeFinishing++;
  } else {
    f.y--;
  }
  if (f.hardwareFadeFinishing) {
    if (f.shouldResetBlendRegisters) {
      f.multipurpose1 = 0;
      f.y = 0;
    }
    f.shouldResetBlendRegisters = false;
  }
  return f.active ? PALETTE_FADE_STATUS_ACTIVE : PALETTE_FADE_STATUS_DONE;
}

function updateBlendRegisters(): void {
  const f = gPaletteFade;
  SetGpuReg(REG_OFFSET_BLDCNT, f.multipurpose1 & 0xffff);
  SetGpuReg(REG_OFFSET_BLDY, f.y);
  if (f.hardwareFadeFinishing) {
    f.hardwareFadeFinishing = 0;
    f.mode = 0;
    f.multipurpose1 = BLDCNT_EFFECT_NONE;
    f.y = 0;
    f.active = false;
  }
}

function isSoftwarePaletteFadeFinishing(): boolean {
  const f = gPaletteFade;
  if (f.softwareFadeFinishing) {
    if (f.softwareFadeFinishingCounter === 4) {
      f.active = false;
      f.softwareFadeFinishing = false;
      f.softwareFadeFinishingCounter = 0;
    } else {
      f.softwareFadeFinishingCounter++;
    }
    return true;
  }
  return false;
}

/** BlendPalette (blend_palette.c) */
export function BlendPalette(palOffset: number, numEntries: number, coeff: number, blendColor: number): void {
  for (let i = 0; i < numEntries; i++) {
    const index = i + palOffset;
    const c = gPlttBufferUnfaded[index];
    const r = r5(c);
    const g = g5(c);
    const b = b5(c);
    gPlttBufferFaded[index] =
      ((r + (((r5(blendColor) - r) * coeff) >> 4)) << 0) | ((g + (((g5(blendColor) - g) * coeff) >> 4)) << 5) | ((b + (((b5(blendColor) - b) * coeff) >> 4)) << 10);
  }
}

export function BlendPalettes(selectedPalettes: number, coeff: number, color: number): void {
  selectedPalettes >>>= 0;
  for (let paletteOffset = 0; selectedPalettes; paletteOffset += 16) {
    if (selectedPalettes & 1) BlendPalette(paletteOffset, 16, coeff, color);
    selectedPalettes >>>= 1;
  }
}

export function BlendPalettesUnfaded(selectedPalettes: number, coeff: number, color: number): void {
  gPlttBufferFaded.set(gPlttBufferUnfaded);
  BlendPalettes(selectedPalettes, coeff, color);
}

/** MultiplyInvertedPaletteRGBComponents (field_effect.c): move entry i towards white by r/g/b sixteenths. */
export function MultiplyInvertedPaletteRGBComponents(i: number, r: number, g: number, b: number): void {
  const c = gPlttBufferUnfaded[i];
  let red = r5(c);
  let green = g5(c);
  let blue = b5(c);
  red += ((0x1f - red) * (r & 0xff)) >> 4;
  green += ((0x1f - green) * (g & 0xff)) >> 4;
  blue += ((0x1f - blue) * (b & 0xff)) >> 4;
  gPlttBufferFaded[i] = (red | (green << 5) | (blue << 10)) & 0xffff;
}

const sRoundedDownGrayscaleMap = [0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 11, 11, 11, 11, 11, 16, 16, 16, 16, 16, 21, 21, 21, 21, 21, 27, 27, 27, 27, 27, 31, 31];

/** TintPalette_GrayScale2: `count` colours of `palette` from `offset` on, in place, to rounded-down greys. */
export function TintPalette_GrayScale2(palette: Uint16Array, offset: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const c = palette[offset + i];
    // Q_8_8(0.3), Q_8_8(0.59), Q_8_8(0.1133)
    let gray = (r5(c) * 76 + g5(c) * 151 + b5(c) * 29) >> 8;
    if (gray > 31) gray = 31;
    gray = sRoundedDownGrayscaleMap[gray];
    palette[offset + i] = gray | (gray << 5) | (gray << 10);
  }
}

// BlendPalettesGradually
const tCoeff = 0, tCoeffTarget = 1, tCoeffDelta = 2, tDelay = 3, tDelayTimer = 4, tColor = 7, tId = 8;

export function BlendPalettesGradually(selectedPalettes: number, delay: number, coeff: number, coeffTarget: number, color: number, priority: number, id: number): void {
  const taskId = CreateTask(taskBlendPalettesGradually, priority);
  const d = gTasks[taskId].data;
  d[tCoeff] = coeff;
  d[tCoeffTarget] = coeffTarget;
  if (delay >= 0) {
    d[tDelay] = delay;
    d[tCoeffDelta] = 1;
  } else {
    d[tDelay] = 0;
    d[tCoeffDelta] = -delay + 1;
  }
  if (coeffTarget < coeff) d[tCoeffDelta] *= -1;
  d[5] = selectedPalettes & 0xffff;
  d[6] = selectedPalettes >>> 16;
  d[tColor] = color;
  d[tId] = id;
  gTasks[taskId].func(taskId);
}

export function IsBlendPalettesGraduallyTaskActive(id: number): boolean {
  for (let i = 0; i < NUM_TASKS; ++i) if (gTasks[i].isActive && gTasks[i].func === taskBlendPalettesGradually && gTasks[i].data[tId] === id) return true;
  return false;
}

const taskBlendPalettesGradually: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const palettes = ((d[5] & 0xffff) | (d[6] << 16)) >>> 0;
  if (++d[tDelayTimer] > d[tDelay]) {
    d[tDelayTimer] = 0;
    BlendPalettes(palettes, d[tCoeff], d[tColor] & 0xffff);
    const target = d[tCoeffTarget];
    if (d[tCoeff] === target) {
      DestroyTask(taskId);
    } else {
      d[tCoeff] += d[tCoeffDelta];
      if (d[tCoeffDelta] >= 0) {
        if (d[tCoeff] < target) return;
      } else if (d[tCoeff] > target) {
        return;
      }
      d[tCoeff] = target;
    }
  }
};

/** DestroyBlendPalettesGraduallyTask */
export function DestroyBlendPalettesGraduallyTask(): void {
  for (let i = 0; i < NUM_TASKS; i++) if (gTasks[i].isActive && gTasks[i].func === taskBlendPalettesGradually) DestroyTask(i);
}
