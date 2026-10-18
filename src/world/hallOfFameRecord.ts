// field_effect.c's FLDEFF_HALL_OF_FAME_RECORD (FldEff_HallOfFameRecord) and FLDEFF_POKECENTER_HEAL
// (FldEff_PokecenterHeal): the Hall of Fame room's machine / the Pokémon Center's heal machine takes the party's
// Poké Balls one by one, they flash, and the monitor lights up. Both run the Poké Ball glow
// (CreateGlowingPokeballsEffect and its sprite states); the Pokémon Center's monitor (sPokecenterMonitor_Gfx)
// shares the glow's palette (tag 0x1007), so it flashes with the balls.
//
// The sprites aren't object events or gFieldEffectObjectTemplate_*s, so they're drawn here as FieldEffectSprites
// with textures built from the GBA pics (sPokeballGlow_Gfx, sHofMonitor_Gfx) and their palettes. The glow's
// palette flashes (MultiplyInvertedPaletteRGBComponents on palette tag 0x1007) redraw the ball texture. Like the
// C, positions are screen coordinates (the sprites don't follow the camera; the camera doesn't move meanwhile).
// Each ball plays SE_BALL; the Pokémon Center's heal plays MUS_HEAL and waits for its fanfare before it ends.

import Phaser from 'phaser';
import { FieldEffectSprite } from '../entities/FieldEffects';
import { K } from '../battle/constants';
import { gfx, gfx16 } from '../gba/gfx';
import { IsFanfareTaskInactive, PlayFanfare, PlaySE } from '../gba/sound';
import { CreateTask } from './fieldMoves';
import { FieldEffectActiveListRemove, registerFieldEffectNatives } from './fieldEffectScripts';

/** Graphics the effect draws (preload at boot). */
export const HALL_OF_FAME_RECORD_GFX = ['sPokeballGlow_Gfx', 'sPokeballGlow_Pal', 'sHofMonitor_Gfx', 'sHofMonitor_Pal', 'sPokecenterMonitor_Gfx'];

export interface HallOfFameRecordHost {
  scene: Phaser.Scene;
  /** The world pixel at the screen's top left (sprites placed at screen coordinates). */
  screenOrigin(): { x: number; y: number };
  /** field.cameraTop, for the sprites' depth. */
  cameraTop(): number;
  /** CalculatePlayerPartyCount */
  partyCount(): number;
}

let host: HallOfFameRecordHost | undefined;

export function setHallOfFameRecordHost(h: HallOfFameRecordHost): void {
  host = h;
}

const BALL_TEXTURE = 'fldeff_pokeball_glow';
const MONITOR_TEXTURE = 'fldeff_hof_monitor';
const PC_MONITOR_TEXTURE = 'fldeff_pokecenter_monitor';

// sAnims_Flicker[0] (sAnim_Static) and sAnim_HofMonitor, in FieldEffectSprite's command format
const sAnim_Static: [number, number, number, number] | ['jump', number] = [0, 1, 0, 0];
const sAnims_PokeballGlow = [[sAnim_Static, ['jump', 0] as ['jump', number]]];
// sAnims_Flicker: sAnim_Static, sAnim_Flicker (the Pokémon Center monitor)
const sAnims_Flicker = [
  [sAnim_Static, ['jump', 0] as ['jump', number]],
  [[1, 5, 0, 0], [2, 5, 0, 0], [3, 7, 0, 0], [2, 5, 0, 0], [1, 5, 0, 0], [0, 5, 0, 0], ['loop', 3], ['end']] as (
    | [number, number, number, number]
    | ['loop', number]
    | ['end']
  )[],
];
const sAnims_HofMonitor = [
  [[3, 8, 0, 0], [2, 8, 0, 0], [1, 8, 0, 0], [0, 8, 0, 0], [1, 8, 0, 0], [2, 8, 0, 0], ['loop', 2], [1, 8, 0, 0], [0, 8, 0, 0], ['end']] as (
    | [number, number, number, number]
    | ['loop', number]
    | ['end']
  )[],
];

/** sPokeballCoordOffsets */
const sPokeballCoordOffsets = [
  [0, 0],
  [6, 0],
  [0, 4],
  [6, 4],
  [0, 8],
  [6, 8],
];
const sPokeballGlowReds = [16, 12, 8, 0];
const sPokeballGlowGreens = [16, 12, 8, 0];
const sPokeballGlowBlues = [0, 0, 0, 0];

// ------------------------------------------------------------------ textures

function rgba(c: number): [number, number, number] {
  const r = c & 0x1f;
  const g = (c >> 5) & 0x1f;
  const b = (c >> 10) & 0x1f;
  return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2)];
}

/** Draw 4bpp 1D-mapped frames (`w` x `h` px each, stacked across) with `palette` into a canvas texture. */
export function drawFrames(tex: Phaser.Textures.CanvasTexture, tiles: Uint8Array, palette: ArrayLike<number>, w: number, h: number, frames: number): void {
  const ctx = tex.context;
  const img = ctx.createImageData(w * frames, h);
  const tilesW = w / 8;
  const tilesPerFrame = tilesW * (h / 8);
  for (let f = 0; f < frames; f++) {
    for (let t = 0; t < tilesPerFrame; t++) {
      const tx = (t % tilesW) * 8 + f * w;
      const ty = Math.floor(t / tilesW) * 8;
      const base = (f * tilesPerFrame + t) * 32;
      for (let i = 0; i < 64; i++) {
        const byte = tiles[base + (i >> 1)] ?? 0;
        const idx = i & 1 ? byte >> 4 : byte & 0xf;
        if (!idx) continue;
        const [r, g, b] = rgba(palette[idx]);
        const o = ((ty + (i >> 3)) * w * frames + tx + (i & 7)) * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
}

export function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, frames: number): Phaser.Textures.CanvasTexture {
  let tex = scene.textures.exists(key) ? (scene.textures.get(key) as Phaser.Textures.CanvasTexture) : undefined;
  if (!tex) {
    tex = scene.textures.createCanvas(key, w * frames, h)!;
    for (let f = 0; f < frames; f++) tex.add(String(f), 0, f * w, 0, w, h);
  }
  return tex;
}

/** The glow palette (gSpritePalette_PokeballGlow, tag 0x1007): unfaded and faded, like gPlttBuffer*. */
class GlowPalette {
  readonly unfaded: Uint16Array;
  readonly faded: Uint16Array;
  private dirty = true;

  /** Other sprites on this palette (the Pokémon Center monitor): texture, gfx symbol, frame size and count. */
  private readonly others: [Phaser.Textures.CanvasTexture, string, number, number, number][] = [];

  constructor(private readonly tex: Phaser.Textures.CanvasTexture) {
    this.unfaded = gfx16('sPokeballGlow_Pal').slice(0, 16);
    this.faded = this.unfaded.slice();
  }

  share(tex: Phaser.Textures.CanvasTexture, sym: string, w: number, h: number, frames: number): void {
    this.others.push([tex, sym, w, h, frames]);
    this.dirty = true;
  }

  /** MultiplyInvertedPaletteRGBComponents(OBJ_PLTT_ID(...) + i, r, g, b) */
  multiplyInverted(i: number, r: number, g: number, b: number): void {
    const c = this.unfaded[i];
    let red = c & 0x1f;
    let green = (c >> 5) & 0x1f;
    let blue = (c >> 10) & 0x1f;
    red += ((0x1f - red) * r) >> 4;
    green += ((0x1f - green) * g) >> 4;
    blue += ((0x1f - blue) * b) >> 4;
    const v = red | (green << 5) | (blue << 10);
    if (this.faded[i] !== v) {
      this.faded[i] = v;
      this.dirty = true;
    }
  }

  /** TransferPlttBuffer: redraw the balls with the faded palette. */
  transfer(): void {
    if (!this.dirty) return;
    this.dirty = false;
    drawFrames(this.tex, gfx('sPokeballGlow_Gfx'), this.faded, 8, 8, 1);
    for (const [tex, sym, w, h, frames] of this.others) drawFrames(tex, gfx(sym), this.faded, w, h, frames);
  }
}

// ------------------------------------------------------------------ CreateGlowingPokeballsEffect

// SpriteCB_PokeballGlowEffect's states
const PLACE_BALLS = 0;

/** The invisible sprite that runs the glow (sState, sTimer, sCounter, sNumFlashed, sPlayHealSe, sNumMons). */
class GlowingPokeballsEffect {
  sState = PLACE_BALLS;
  private sTimer = 0;
  private sCounter = 0;
  private sNumFlashed = 0;
  readonly balls: FieldEffectSprite[] = [];

  constructor(
    private readonly effect: RecordEffect,
    private sNumMons: number,
    private readonly x: number,
    private readonly y: number,
    private readonly sPlayHealSe: boolean,
  ) {}

  /** SpriteCB_PokeballGlowEffect */
  callback(): void {
    switch (this.sState) {
      case 0: // PokeballGlowEffect_PlaceBalls
        if (this.sTimer === 0 || --this.sTimer === 0) {
          this.sTimer = 25;
          const [dx, dy] = sPokeballCoordOffsets[this.sCounter];
          // CreateSpriteAtEnd(&sSpriteTemplate_PokeballGlow, ..., 0xFF), oam.priority = 2
          const ball = this.effect.createSprite(BALL_TEXTURE, 8, 8, sAnims_PokeballGlow, dx + this.x, dy + this.y, 0xff, 2);
          this.balls.push(ball);
          this.sCounter++;
          this.sNumMons--;
          PlaySE(K.SE_BALL);
        }
        if (this.sNumMons === 0) {
          this.sTimer = 32;
          this.sState++;
        }
        break;
      case 1: // PokeballGlowEffect_TryPlaySe
        if (--this.sTimer === 0) {
          this.sState++;
          this.sTimer = 8;
          this.sCounter = 0;
          this.sNumFlashed = 0;
          if (this.sPlayHealSe) PlayFanfare(K.MUS_HEAL);
        }
        break;
      case 2: {
        // PokeballGlowEffect_FlashFirstThree
        if (--this.sTimer === 0) {
          this.sTimer = 8;
          this.sCounter = (this.sCounter + 1) & 3;
          if (this.sCounter === 0) this.sNumFlashed++;
        }
        const pal = this.effect.palette;
        const flash = (i: number, phase: number) => pal.multiplyInverted(i, sPokeballGlowReds[phase], sPokeballGlowGreens[phase], sPokeballGlowBlues[phase]);
        flash(8, (this.sCounter + 3) & 3);
        flash(6, (this.sCounter + 2) & 3);
        flash(2, (this.sCounter + 1) & 3);
        flash(5, this.sCounter);
        flash(3, this.sCounter);
        if (this.sNumFlashed >= 3) {
          this.sState++;
          this.sTimer = 8;
          this.sCounter = 0;
        }
        break;
      }
      case 3: {
        // PokeballGlowEffect_FlashLast
        if (--this.sTimer === 0) {
          this.sTimer = 8;
          this.sCounter = (this.sCounter + 1) & 3;
          if (this.sCounter === 3) {
            this.sState++;
            this.sTimer = 30;
          }
        }
        const pal = this.effect.palette;
        const phase = this.sCounter;
        for (const i of [8, 6, 2, 5, 3]) pal.multiplyInverted(i, sPokeballGlowReds[phase], sPokeballGlowGreens[phase], sPokeballGlowBlues[phase]);
        break;
      }
      case 4: // PokeballGlowEffect_WaitAfterFlash
        if (--this.sTimer === 0) this.sState++;
        break;
      case 5: // PokeballGlowEffect_Dummy
        this.sState++;
        break;
      case 6: // PokeballGlowEffect_WaitForSound
        if (!this.sPlayHealSe || IsFanfareTaskInactive()) this.sState++;
        break;
      default: // PokeballGlowEffect_Idle
        break;
    }
  }
}

/**
 * One running FLDEFF_HALL_OF_FAME_RECORD (Task_HallOfFameRecord) or FLDEFF_POKECENTER_HEAL (Task_PokecenterHeal):
 * the task, its sprites and the glow palette.
 */
class RecordEffect {
  readonly palette: GlowPalette;
  private readonly sprites: FieldEffectSprite[] = [];
  private glow?: GlowingPokeballsEffect;
  /** tMonitorSpriteId (Pokémon Center) */
  private monitor?: FieldEffectSprite;
  /** the monitor's sStartFlash */
  private startFlash = false;
  private tState = 0;
  private done = false;

  constructor(
    private readonly h: HallOfFameRecordHost,
    private readonly fldEff: 'FLDEFF_HALL_OF_FAME_RECORD' | 'FLDEFF_POKECENTER_HEAL',
    private readonly tNumMons: number,
    private readonly tFirstBallX: number,
    private readonly tFirstBallY: number,
  ) {
    const ballTex = canvasTexture(h.scene, BALL_TEXTURE, 8, 8, 1);
    this.palette = new GlowPalette(ballTex);
    if (fldEff === 'FLDEFF_HALL_OF_FAME_RECORD') {
      const monitorTex = canvasTexture(h.scene, MONITOR_TEXTURE, 16, 16, 4);
      drawFrames(monitorTex, gfx('sHofMonitor_Gfx'), gfx16('sHofMonitor_Pal'), 16, 16, 4);
    } else {
      this.palette.share(canvasTexture(h.scene, PC_MONITOR_TEXTURE, 32, 16, 4), 'sPokecenterMonitor_Gfx', 32, 16, 4);
    }
  }

  createSprite(texture: string, w: number, hgt: number, anims: unknown[][], x: number, y: number, subpriority: number, priority: number): FieldEffectSprite {
    const o = this.h.screenOrigin();
    const s = new FieldEffectSprite(this.h.scene, this.fldEff, texture, { frameWidth: w, frameHeight: hgt, anims: anims as never }, o.x + x, o.y + y, subpriority, () => {});
    s.priority = priority;
    this.sprites.push(s);
    return s;
  }

  /** RunTasks (Task_HallOfFameRecord), then AnimateSprites and the OAM / palette transfer. */
  tick(): boolean {
    this.runTask();
    if (this.glow) this.glow.callback();
    for (const s of this.sprites) {
      if (!s.inUse) continue;
      this.spriteCallback(s);
      if (s.inUse) s.animate();
    }
    this.palette.transfer();
    for (const s of this.sprites) if (s.inUse) s.render(this.h.cameraTop());
    return this.done && this.sprites.every((s) => !s.inUse);
  }

  /** SpriteCB_PokeballGlow / SpriteCB_HallOfFameMonitor / SpriteCB_PokecenterMonitor */
  private spriteCallback(s: FieldEffectSprite): void {
    if (s.width === 8) {
      if (this.glow && this.glow.sState > 4) s.destroy(); // FieldEffectFreeGraphicsResources
      return;
    }
    if (s === this.monitor && this.startFlash) {
      this.startFlash = false;
      s.invisible = false;
      s.startAnim(1);
    }
    if (s.animEnded) s.destroy();
  }

  private runTask(): void {
    if (this.done) return;
    if (this.fldEff === 'FLDEFF_POKECENTER_HEAL') return this.runPokecenterHealTask();
    switch (this.tState) {
      case 0: // HallOfFameRecordEffect_Init
        this.tState++;
        this.glow = new GlowingPokeballsEffect(this, this.tNumMons, this.tFirstBallX, this.tFirstBallY, false);
        break;
      case 1: // HallOfFameRecordEffect_WaitForBallPlacement
        if (this.glow!.sState > 1) {
          // CreateHofMonitorSprite(120, 25)
          this.createSprite(MONITOR_TEXTURE, 16, 16, sAnims_HofMonitor, 120, 25, 0, 0);
          this.tState++;
        }
        break;
      case 2: // HallOfFameRecordEffect_WaitForBallFlashing
        if (this.glow!.sState > 4) this.tState++;
        break;
      case 3: // HallOfFameRecordEffect_WaitForSoundAndEnd
        if (this.glow!.sState > 6) {
          this.glow = undefined; // DestroySprite(glow effect)
          FieldEffectActiveListRemove('FLDEFF_HALL_OF_FAME_RECORD');
          this.done = true; // DestroyTask
        }
        break;
    }
  }

  /** Task_PokecenterHeal (sPokecenterHealEffectFuncs) */
  private runPokecenterHealTask(): void {
    switch (this.tState) {
      case 0: // PokecenterHealEffect_Init
        this.tState++;
        this.glow = new GlowingPokeballsEffect(this, this.tNumMons, this.tFirstBallX, this.tFirstBallY, true);
        // CreatePokecenterMonitorSprite(128, 24): oam.priority 2, invisible until the balls flash
        this.monitor = this.createSprite(PC_MONITOR_TEXTURE, 32, 16, sAnims_Flicker, 128, 24, 0, 2);
        this.monitor.invisible = true;
        break;
      case 1: // PokecenterHealEffect_WaitForBallPlacement
        if (this.glow!.sState >= 2) {
          this.startFlash = true;
          this.tState++;
        }
        break;
      case 2: // PokecenterHealEffect_WaitForBallFlashing
        if (this.glow!.sState > 4) this.tState++;
        break;
      case 3: // PokecenterHealEffect_WaitForSoundAndEnd
        if (this.glow!.sState > 6) {
          this.glow = undefined;
          FieldEffectActiveListRemove('FLDEFF_POKECENTER_HEAL');
          this.done = true;
        }
        break;
    }
  }
}

/** FldEff_PokecenterHeal: the balls at (93, 36), the monitor at (128, 24). */
function FldEff_PokecenterHeal(): boolean {
  if (!host) throw new Error('[fldeff] no Hall of Fame record host');
  const effect = new RecordEffect(host, 'FLDEFF_POKECENTER_HEAL', host.partyCount(), 93, 36);
  CreateTask(() => effect.tick());
  return false;
}

/** FldEff_HallOfFameRecord */
function FldEff_HallOfFameRecord(): boolean {
  if (!host) throw new Error('[fldeff] no Hall of Fame record host');
  const effect = new RecordEffect(host, 'FLDEFF_HALL_OF_FAME_RECORD', host.partyCount(), 117, 60);
  CreateTask(() => effect.tick());
  return false;
}

registerFieldEffectNatives({ FldEff_HallOfFameRecord, FldEff_PokecenterHeal });
