// scanline_effect.c: per-scanline register writes by HBlank DMA, modelled as a per-line register
// table the PPU reads (hw.hblankRegs). `dmaDest` is a REG_OFFSET_*.

import { g } from '../battle/env';
import { gSineTable } from '../battle/trig';
import { hblankRegs, REG_OFFSET_BG0HOFS } from './hw';
import { CreateTask, DestroyTask, gTasks, type TaskFunc } from './task';

export const SCANLINE_EFFECT_DMACNT_16BIT = 0xa2600001;
export const SCANLINE_EFFECT_DMACNT_32BIT = 0xa6600001;

/** gScanlineEffectRegBuffers[2][0x3C0] */
export const gScanlineEffectRegBuffers = [new Uint16Array(0x3c0), new Uint16Array(0x3c0)];

export interface ScanlineEffectParams {
  dmaDest: number;
  dmaControl: number;
  initState: number;
}

export const gScanlineEffect = {
  dmaDest: -1,
  dmaControl: 0,
  srcBuffer: 0,
  state: 0,
  waveTaskId: 0xff,
};

let sShouldStopWaveTask = false;

function stopDma(): void {
  if (gScanlineEffect.dmaDest < 0) return;
  hblankRegs.delete(gScanlineEffect.dmaDest);
  hblankRegs.delete(gScanlineEffect.dmaDest + 2);
}

export function ScanlineEffect_Stop(): void {
  gScanlineEffect.state = 0;
  stopDma();
  if (gScanlineEffect.waveTaskId !== 0xff) {
    DestroyTask(gScanlineEffect.waveTaskId);
    gScanlineEffect.waveTaskId = 0xff;
  }
}

export function ScanlineEffect_Clear(): void {
  stopDma();
  gScanlineEffectRegBuffers[0].fill(0);
  gScanlineEffectRegBuffers[1].fill(0);
  gScanlineEffect.dmaDest = -1;
  gScanlineEffect.dmaControl = 0;
  gScanlineEffect.srcBuffer = 0;
  gScanlineEffect.state = 0;
  gScanlineEffect.waveTaskId = 0xff;
}

export function ScanlineEffect_SetParams(params: ScanlineEffectParams): void {
  gScanlineEffect.dmaControl = params.dmaControl;
  gScanlineEffect.dmaDest = params.dmaDest;
  gScanlineEffect.state = params.initState;
}

/** ScanlineEffect_InitHBlankDmaTransfer (VBlank): the next frame uses the current buffer. */
export function ScanlineEffect_InitHBlankDmaTransfer(): void {
  if (gScanlineEffect.state === 0) return;
  if (gScanlineEffect.state === 3) {
    gScanlineEffect.state = 0;
    stopDma();
    sShouldStopWaveTask = true;
    return;
  }
  const buf = gScanlineEffectRegBuffers[gScanlineEffect.srcBuffer];
  const dest = gScanlineEffect.dmaDest;
  if (gScanlineEffect.dmaControl === SCANLINE_EFFECT_DMACNT_16BIT) {
    hblankRegs.set(dest, buf.slice(0, 160));
  } else {
    const lo = new Uint16Array(160);
    const hi = new Uint16Array(160);
    for (let i = 0; i < 160; i++) {
      lo[i] = buf[i * 2];
      hi[i] = buf[i * 2 + 1];
    }
    hblankRegs.set(dest, lo);
    hblankRegs.set(dest + 2, hi);
  }
  gScanlineEffect.srcBuffer ^= 1;
}

// ------------------------------------------------------------------ wave

// TaskFunc_UpdateWavePerFrame's task data
const tStartLine = 0;
const tEndLine = 1;
const tWaveLength = 2;
const tSrcBufferOffset = 3;
const tFramesUntilMove = 4;
const tDelayInterval = 5;
const tRegOffset = 6;
const tApplyBattleBgOffsets = 7;

/** TaskFunc_UpdateWavePerFrame: scrolls the wave (generated at buffer 0, entry 320) up the lines one step per delayInterval+1 frames. */
const TaskFunc_UpdateWavePerFrame: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (sShouldStopWaveTask) {
    DestroyTask(taskId);
    gScanlineEffect.waveTaskId = 0xff;
    return;
  }
  const value = d[tApplyBattleBgOffsets] ? battleBgOffset(d[tRegOffset]) : 0;
  const buf = gScanlineEffectRegBuffers[gScanlineEffect.srcBuffer];
  let offset = d[tSrcBufferOffset] + 320;
  for (let i = d[tStartLine]; i < d[tEndLine]; i++) buf[i] = gScanlineEffectRegBuffers[0][offset++] + value;
  if (d[tFramesUntilMove] !== 0) {
    d[tFramesUntilMove]--;
  } else {
    d[tFramesUntilMove] = d[tDelayInterval];
    if (++d[tSrcBufferOffset] === d[tWaveLength]) d[tSrcBufferOffset] = 0;
  }
};

/** SCANLINE_EFFECT_REG_BG0HOFS .. BG3VOFS (0, 2, .. 14): gBattle_BG0_X, gBattle_BG0_Y, .. gBattle_BG3_Y */
function battleBgOffset(regOffset: number): number {
  switch (regOffset) {
    case 0: return g.battle_BG0_X;
    case 2: return g.battle_BG0_Y;
    case 4: return g.battle_BG1_X;
    case 6: return g.battle_BG1_Y;
    case 8: return g.battle_BG2_X;
    case 10: return g.battle_BG2_Y;
    case 12: return g.battle_BG3_X;
    case 14: return g.battle_BG3_Y;
  }
  return 0;
}

/** GenerateWave */
function GenerateWave(buffer: Uint16Array, start: number, frequency: number, amplitude: number): void {
  let theta = 0;
  for (let i = 0; i < 256; i++) {
    buffer[start + i] = Math.trunc((gSineTable(theta) * amplitude) / 256);
    theta = (theta + frequency) & 0xff;
  }
}

/**
 * ScanlineEffect_InitWave: a horizontal (or vertical) wave over lines [startLine, endLine) of the register
 * at REG_OFFSET_BG0HOFS + regOffset, travelling up one line every delayInterval+1 frames. With
 * applyBattleBgOffsets the matching gBattle_BGn_X/Y is added. Returns the wave task's id.
 */
export function ScanlineEffect_InitWave(startLine: number, endLine: number, frequency: number, amplitude: number, delayInterval: number, regOffset: number, applyBattleBgOffsets: boolean): number {
  startLine &= 0xff;
  endLine &= 0xff;
  ScanlineEffect_Clear();
  ScanlineEffect_SetParams({ dmaDest: REG_OFFSET_BG0HOFS + regOffset, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
  const taskId = CreateTask(TaskFunc_UpdateWavePerFrame, 0);
  const d = gTasks[taskId].data;
  d[tStartLine] = startLine;
  d[tEndLine] = endLine;
  d[tWaveLength] = Math.trunc(256 / frequency);
  d[tSrcBufferOffset] = 0;
  d[tFramesUntilMove] = delayInterval;
  d[tDelayInterval] = delayInterval;
  d[tRegOffset] = regOffset;
  d[tApplyBattleBgOffsets] = +applyBattleBgOffsets;
  gScanlineEffect.waveTaskId = taskId;
  sShouldStopWaveTask = false;
  GenerateWave(gScanlineEffectRegBuffers[0], 320, frequency, amplitude);
  let offset = 320;
  for (let i = startLine; i < endLine; i++) {
    gScanlineEffectRegBuffers[0][i] = gScanlineEffectRegBuffers[0][offset];
    gScanlineEffectRegBuffers[1][i] = gScanlineEffectRegBuffers[0][offset];
    offset++;
  }
  return taskId;
}
