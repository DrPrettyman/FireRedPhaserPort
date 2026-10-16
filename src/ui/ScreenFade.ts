import Phaser from 'phaser';
import { DEPTH_UI } from '../text/TextWindow';

/** FADE_* modes (include/constants/field_weather.h). */
export interface FadeModes {
  FADE_FROM_BLACK: number;
  FADE_TO_BLACK: number;
  FADE_FROM_WHITE: number;
  FADE_TO_WHITE: number;
}

/** Above the map, objects and every window: the fade covers all palettes. */
export const DEPTH_FADE = DEPTH_UI + 1000;

/**
 * FadeScreen / BeginNormalPaletteFade over all palettes, drawn as a full-screen overlay.
 * Approximation: BlendPalette mixes 5-bit colour channels with integer maths; alpha-blending the fade
 * colour on top gives the same ramp but not bit-identical pixels. Weather palettes are ignored.
 *
 * Timing follows UpdateNormalPaletteFade: the blend coefficient moves 2/16 per step, each step takes
 * two frames (BG palettes, then OBJ palettes) plus `delay` frames before the BG half, and the fade
 * stays active for 5 more frames after reaching the target (IsSoftwarePaletteFadeFinishing).
 */
export class ScreenFade {
  private rect: Phaser.GameObjects.Rectangle;
  private y = 0;
  private targetY = 0;
  private objToggle = false;
  private finishing = -1;
  private delay = 0;
  private delayCounter = 0;
  active = false;

  constructor(
    scene: Phaser.Scene,
    private modes: FadeModes,
    depth = DEPTH_FADE,
  ) {
    const { width, height } = scene.scale;
    this.rect = scene.add.rectangle(0, 0, width, height, 0x000000, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
    this.rect.setAlpha(0);
  }

  /** FadeScreen(mode, delay). Returns false (and does nothing) if a fade is already running. */
  begin(mode: number, delay = 0): boolean {
    const m = this.modes;
    if (this.active) return false;
    if (![m.FADE_FROM_BLACK, m.FADE_TO_BLACK, m.FADE_FROM_WHITE, m.FADE_TO_WHITE].includes(mode)) return false;
    const toWhite = mode === m.FADE_FROM_WHITE || mode === m.FADE_TO_WHITE;
    const fadeOut = mode === m.FADE_TO_BLACK || mode === m.FADE_TO_WHITE;
    this.rect.setFillStyle(toWhite ? 0xffffff : 0x000000);
    this.y = fadeOut ? 0 : 16;
    this.targetY = fadeOut ? 16 : 0;
    this.objToggle = false;
    this.finishing = -1;
    this.delay = delay;
    this.delayCounter = delay; // so BeginNormalPaletteFade's own update applies the first step at once
    this.active = true;
    this.update();
    return true;
  }

  /**
   * BeginNormalPaletteFade(…, delay, startY, targetY, color) toward any colour (0xRRGGBB): the blend
   * coefficient goes from startY to targetY (of 16). Used by Sweet Scent (to red and back).
   */
  beginBlend(startY: number, targetY: number, color: number, delay: number): boolean {
    if (this.active) return false;
    this.rect.setFillStyle(color);
    this.y = startY;
    this.targetY = targetY;
    this.objToggle = false;
    this.finishing = -1;
    this.delay = delay;
    this.delayCounter = delay;
    this.active = true;
    this.update();
    return true;
  }

  /** Drop the overlay at once (the palettes are reloaded). */
  clear(): void {
    this.active = false;
    this.rect.setAlpha(0);
  }

  /** Whether the fade colour is white (FADE_*_WHITE, palette_bg_faded_fill_white). */
  get white(): boolean {
    return this.rect.fillColor === 0xffffff;
  }

  /** palette_bg_faded_fill_black / _white: every palette shows the colour until a fade starts. */
  fill(white: boolean): void {
    this.rect.setFillStyle(white ? 0xffffff : 0x000000);
    this.rect.setAlpha(1);
  }

  /** UpdatePaletteFade, once per frame. */
  tick(): void {
    if (this.active) this.update();
  }

  private update(): void {
    if (this.finishing >= 0) {
      if (this.finishing === 4) this.active = false;
      else this.finishing++;
      return;
    }
    if (!this.objToggle) {
      if (this.delayCounter < this.delay) {
        this.delayCounter++;
        return;
      }
      this.delayCounter = 0;
    }
    this.rect.setAlpha(this.y / 16);
    this.objToggle = !this.objToggle;
    if (this.objToggle) return;
    if (this.y === this.targetY) {
      this.finishing = 0;
      return;
    }
    this.y = this.y < this.targetY ? Math.min(this.y + 2, this.targetY) : Math.max(this.y - 2, this.targetY);
  }
}
