// Flash's darkness: overworld.c's flash level (SetDefaultFlashLevel, SetFlashLevel,
// InitCurrentFlashLevelScanlineEffect), field_screen_effect.c's flash circle (the WIN0H scanline table,
// UpdateFlashLevelEffect / AnimateFlash) and fldeff_flash.c's field-move side (SetUpFieldMove_Flash,
// FldEff_UseFlash). The map transitions in fldeff_flash.c are world/mapTransition.ts.
//
// On the GBA the darkness is window 0: the field sets WININ to show everything inside WIN0 and WINOUT
// to show only BG0 (the text windows), and an HBlank DMA writes each line's WIN0H from a table that
// holds a circle around the screen centre. The field here is drawn by Phaser, so FieldFlash keeps the
// same table (double-buffered like gScanlineEffectRegBuffers, swapped at "VBlank") and paints the
// outside of each line's span black on an overlay under the text windows. On the GBA layer (battle
// transitions) the real scanline effect drives REG_WIN0H instead (`InitCurrentFlashLevelScanlineEffect`).

import Phaser from 'phaser';
import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';
import { DISPLAY_HEIGHT, DISPLAY_WIDTH, REG_OFFSET_WIN0H, WIN_RANGE } from '../gba/hw';
import { gScanlineEffectRegBuffers, SCANLINE_EFFECT_DMACNT_16BIT, ScanlineEffect_SetParams } from '../gba/scanline';
import type { GameState } from '../state/GameState';

/** sFlashLevelToRadius (field_screen_effect.c): level 0 is full brightness. */
export const sFlashLevelToRadius = [200, 72, 56, 40, 24];
/** gMaxFlashLevel */
export const gMaxFlashLevel = sFlashLevelToRadius.length - 1;

// ------------------------------------------------------------------ overworld.c

/**
 * SetDefaultFlashLevel (LoadMapFromWarp / LoadMapFromCameraTransition): dark in a cave
 * (gMapHeader.cave, the map's `requires_flash`) unless Flash is already active.
 */
export function SetDefaultFlashLevel(state: GameState, cave: boolean): void {
  if (!cave) state.flashLevel = 0;
  else if (state.getFlag('FLAG_SYS_FLASH_ACTIVE')) state.flashLevel = 0;
  else state.flashLevel = gMaxFlashLevel;
}

/** SetFlashLevel (`setflashlevel`): out-of-range levels become 0. */
export function SetFlashLevel(state: GameState, flashLevel: number): void {
  if (flashLevel < 0 || flashLevel > gMaxFlashLevel) flashLevel = 0;
  state.flashLevel = flashLevel;
}

/** Overworld_GetFlashLevel */
export function Overworld_GetFlashLevel(state: GameState): number {
  return state.flashLevel;
}

/** IsMapTypeOutdoors (LoadMapFromWarp clears FLAG_SYS_FLASH_ACTIVE on entering one). */
export function IsMapTypeOutdoors(mapType: string | null): boolean {
  return mapType === 'MAP_TYPE_ROUTE' || mapType === 'MAP_TYPE_TOWN' || mapType === 'MAP_TYPE_UNDERWATER' || mapType === 'MAP_TYPE_CITY' || mapType === 'MAP_TYPE_OCEAN_ROUTE';
}

/**
 * InitCurrentFlashLevelScanlineEffect, for the GBA layer: a dark map's circle into
 * gScanlineEffectRegBuffers, DMA'd into REG_WIN0H each line.
 */
export function InitCurrentFlashLevelScanlineEffect(flashLevel: number): void {
  if (flashLevel !== 0) {
    WriteFlashScanlineEffectBuffer(flashLevel, gScanlineEffectRegBuffers);
    ScanlineEffect_SetParams({ dmaDest: REG_OFFSET_WIN0H, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
  }
}

// ------------------------------------------------------------------ field_screen_effect.c

/** SetFlashScanlineEffectWindowBoundary */
function SetFlashScanlineEffectWindowBoundary(dest: Uint16Array, y: number, left: number, right: number): void {
  if (y >= 0 && y <= 160) {
    // (y is a u32 in the C, so negative lines wrap past 160 and are skipped too)
    if (left < 0) left = 0;
    if (left > 255) left = 255;
    if (right < 0) right = 0;
    if (right > 255) right = 255;
    dest[y] = (left << 8) | right;
  }
}

/**
 * SetFlashScanlineEffectWindowBoundaries: a circle of `radius` around (centerX, centerY) as per-line
 * WIN0H values (see the C's comment for how the midpoint algorithm approximates it). Lines outside the
 * circle keep what the buffer held.
 */
export function SetFlashScanlineEffectWindowBoundaries(dest: Uint16Array, centerX: number, centerY: number, radius: number): void {
  let xy = radius;
  let error = radius;
  let yx = 0;
  while (xy >= yx) {
    SetFlashScanlineEffectWindowBoundary(dest, centerY - yx, centerX - xy, centerX + xy);
    SetFlashScanlineEffectWindowBoundary(dest, centerY + yx, centerX - xy, centerX + xy);
    SetFlashScanlineEffectWindowBoundary(dest, centerY - xy, centerX - yx, centerX + yx);
    SetFlashScanlineEffectWindowBoundary(dest, centerY + xy, centerX - yx, centerX + yx);
    error -= yx * 2 - 1;
    yx++;
    if (error < 0) {
      error += 2 * (xy - 1);
      xy--;
    }
  }
}

/** WriteFlashScanlineEffectBuffer: the circle for `flashLevel` into both buffers. */
export function WriteFlashScanlineEffectBuffer(flashLevel: number, buffers: Uint16Array[]): void {
  if (flashLevel) {
    SetFlashScanlineEffectWindowBoundaries(buffers[0], 120, 80, sFlashLevelToRadius[flashLevel]);
    buffers[1].set(buffers[0].subarray(0, 240 * 4)); // CpuFastCopy(.., 240 * 8 bytes)
  }
}

// ------------------------------------------------------------------ fldeff_flash.c

/** SetUpFieldMove_Flash's check: Flash works in a dark cave where it isn't active yet. */
export function SetUpFieldMove_Flash(state: GameState, cave: boolean): boolean {
  if (cave !== true) return false;
  if (state.getFlag('FLAG_SYS_FLASH_ACTIVE')) return false;
  return true;
}

/**
 * FldEff_UseFlash: what FieldCallback_Flash's mon banner hands over to. EventScript_FldEffFlash is
 * `animateflash 0` + `setflashlevel 0`.
 */
export function FldEff_UseFlash(state: GameState, setupScript: (label: string) => void): void {
  PlaySE(K.SE_M_REFLECT);
  state.setFlag('FLAG_SYS_FLASH_ACTIVE');
  setupScript('EventScript_FldEffFlash');
}

/** Depth of the darkness: over every field layer and object, under the text windows (BG0). */
export const DEPTH_FLASH = 1_500_000;

const TEXTURE = 'field_flash_darkness';

/** A task in the field's flash model; `run` returns true once it has destroyed itself. */
interface FlashTask {
  func: 'UpdateFlashLevelEffect' | 'Task_WaitForFlashUpdate';
  run(): boolean;
}

/**
 * The field's flash circle: gScanlineEffect's two WIN0H tables (srcBuffer flips every frame, and the
 * frame shows the one that was current at VBlank), the static REG_WIN0H the field leaves when no
 * effect runs, and the flash tasks (UpdateFlashLevelEffect, Task_WaitForFlashUpdate).
 */
export class FieldFlash {
  private readonly buffers = [new Uint16Array(0x3c0), new Uint16Array(0x3c0)];
  private srcBuffer = 0;
  /** gScanlineEffect.state != 0: the HBlank DMA runs. */
  private running = false;
  /** REG_WIN0H outside the DMA (InitOverworldGraphicsRegisters: WIN_RANGE(0, 255)). */
  private win0h = WIN_RANGE(0, 255);
  /** The table the current frame shows (one entry per line), or undefined: every line is `win0h`. */
  private shown?: Uint16Array;
  private tasks: FlashTask[] = [];
  /** Task_WaitForFlashUpdate's ScriptContext_Enable */
  private scriptEnabled = false;
  private readonly image: Phaser.GameObjects.Image;
  private readonly canvas: Phaser.Textures.CanvasTexture;
  /** What the overlay last drew, per line. */
  private readonly drawn = new Uint16Array(DISPLAY_HEIGHT).fill(WIN_RANGE(0, 255));

  constructor(scene: Phaser.Scene) {
    this.canvas = scene.textures.exists(TEXTURE) ? (scene.textures.get(TEXTURE) as Phaser.Textures.CanvasTexture) : scene.textures.createCanvas(TEXTURE, DISPLAY_WIDTH, DISPLAY_HEIGHT)!;
    this.canvas.context.clearRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
    this.canvas.refresh();
    this.image = scene.add.image(0, 0, TEXTURE).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH_FLASH).setVisible(false);
  }

  /**
   * A map (re)load: ResumeMap's ResetTasks + ScanlineEffect_Clear (or ResetScreenForMapLoad's
   * ScanlineEffect_Stop), then InitCurrentFlashLevelScanlineEffect and InitOverworldGraphicsRegisters.
   */
  initCurrentFlashLevelScanlineEffect(flashLevel: number): void {
    this.tasks = [];
    this.buffers[0].fill(0);
    this.buffers[1].fill(0);
    this.srcBuffer = 0;
    this.running = false;
    this.shown = undefined;
    if (flashLevel !== 0) {
      WriteFlashScanlineEffectBuffer(flashLevel, this.buffers);
      this.running = true;
    }
    this.win0h = WIN_RANGE(0, 255);
  }

  /**
   * AnimateFlash: grow (or shrink) the circle from the current level's radius to `newFlashLevel`'s by
   * 2 px every other frame (StartUpdateFlashLevelEffect, centre 120,80). Returns StartWaitForFlashUpdate's
   * wait, which ends once UpdateFlashLevelEffect is gone. As in the C, a shrink ends after one step
   * (`tCurFlashRadius > tDestFlashRadius` already holds), and at full brightness the effect is stopped.
   */
  animateFlash(curFlashLevel: number, newFlashLevel: number): () => boolean {
    this.startUpdateFlashLevelEffect(sFlashLevelToRadius[curFlashLevel], sFlashLevelToRadius[newFlashLevel], newFlashLevel === 0, 2);
    // StartWaitForFlashUpdate
    if (!this.tasks.some((t) => t.func === 'Task_WaitForFlashUpdate')) {
      this.tasks.push({
        func: 'Task_WaitForFlashUpdate',
        run: () => {
          if (this.tasks.some((t) => t.func === 'UpdateFlashLevelEffect')) return false;
          this.scriptEnabled = true; // ScriptContext_Enable
          return true;
        },
      });
    }
    this.scriptEnabled = false;
    return () => this.scriptEnabled;
  }

  /** StartUpdateFlashLevelEffect + UpdateFlashLevelEffect (priority 80) */
  private startUpdateFlashLevelEffect(initialFlashRadius: number, destFlashRadius: number, clearScanlineEffect: boolean, delta: number): void {
    let tState = 0;
    let tCurFlashRadius = initialFlashRadius;
    const tFlashRadiusDelta = initialFlashRadius < destFlashRadius ? delta : -delta;
    this.tasks.push({
      func: 'UpdateFlashLevelEffect',
      run: () => {
        switch (tState) {
          case 0:
            SetFlashScanlineEffectWindowBoundaries(this.buffers[this.srcBuffer], 120, 80, tCurFlashRadius);
            tState = 1;
            break;
          case 1:
            SetFlashScanlineEffectWindowBoundaries(this.buffers[this.srcBuffer], 120, 80, tCurFlashRadius);
            tState = 0;
            tCurFlashRadius += tFlashRadiusDelta;
            if (tCurFlashRadius > destFlashRadius) {
              if (clearScanlineEffect) {
                this.scanlineEffectStop();
                tState = 2;
              } else {
                return true;
              }
            }
            break;
          case 2:
            // ScanlineEffect_Clear
            this.buffers[0].fill(0);
            this.buffers[1].fill(0);
            this.srcBuffer = 0;
            return true;
        }
        return false;
      },
    });
  }

  /** ScanlineEffect_Stop: the DMA stops, leaving REG_WIN0H at the last value it wrote (entry 160). */
  private scanlineEffectStop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.shown) this.win0h = this.shown[160];
  }

  /** RunTasks' part: the flash tasks, after the script and the field's other tasks. */
  tick(): void {
    // RunTasks: a task that destroys itself is gone for the ones after it (FuncIsActiveTask)
    for (const t of [...this.tasks]) {
      if (t.run()) this.tasks.splice(this.tasks.indexOf(t), 1);
    }
  }

  /** VBlank: ScanlineEffect_InitHBlankDmaTransfer picks the table the next frame shows; then draw it. */
  vblank(): void {
    if (this.running) {
      this.shown = this.buffers[this.srcBuffer].slice(0, 161);
      this.srcBuffer ^= 1;
    } else {
      this.shown = undefined;
    }
    this.draw();
  }

  /** WIN0H for screen line `y`. */
  lineWindow(y: number): number {
    return this.shown ? this.shown[y] : this.win0h;
  }

  /** Dev: the share of the screen the darkness covers (0..1). */
  darkFraction(): number {
    let dark = 0;
    for (let y = 0; y < DISPLAY_HEIGHT; y++) {
      const [x1, x2] = span(this.lineWindow(y));
      dark += DISPLAY_WIDTH - (x2 - x1);
    }
    return dark / (DISPLAY_WIDTH * DISPLAY_HEIGHT);
  }

  /** Paint each line black outside its WIN0 span (WINOUT shows only BG0, over the black backdrop). */
  private draw(): void {
    let changed = false;
    for (let y = 0; y < DISPLAY_HEIGHT; y++) {
      if (this.drawn[y] !== this.lineWindow(y)) changed = true;
    }
    if (!changed) return;
    const ctx = this.canvas.context;
    ctx.clearRect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT);
    ctx.fillStyle = '#000';
    let any = false;
    for (let y = 0; y < DISPLAY_HEIGHT; y++) {
      const v = this.lineWindow(y);
      this.drawn[y] = v;
      const [x1, x2] = span(v);
      if (x1 > 0) ctx.fillRect(0, y, x1, 1);
      if (x2 < DISPLAY_WIDTH) ctx.fillRect(x2, y, DISPLAY_WIDTH - x2, 1);
      if (x1 > 0 || x2 < DISPLAY_WIDTH) any = true;
    }
    this.canvas.refresh();
    this.image.setVisible(any);
  }

  destroy(): void {
    this.image.destroy();
  }
}

/**
 * The visible span [x1, x2) of a WIN0H value. GBATEK: X2 > 240 or X1 > X2 count as X2 = 240 (as the
 * PPU's inWindow does), so (0, 255) is the whole line and (0, 0) none of it.
 */
function span(win0h: number): [number, number] {
  const x1 = win0h >> 8;
  let x2 = win0h & 0xff;
  if (x2 > DISPLAY_WIDTH || x1 > x2) x2 = DISPLAY_WIDTH;
  return [Math.min(x1, DISPLAY_WIDTH), x2];
}
