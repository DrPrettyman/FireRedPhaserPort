import Phaser from 'phaser';
import { DEPTH_UI } from '../text/TextWindow';

/** FADE_* modes (include/constants/field_weather.h). */
export interface FadeModes {
  FADE_FROM_BLACK: number;
  FADE_TO_BLACK: number;
  FADE_FROM_WHITE: number;
  FADE_TO_WHITE: number;
}

/**
 * The field weather's side of FadeScreen (world/weather.ts): on the field, FadeScreen hands a fade in to the weather
 * when the weather's palettes fade in themselves (FadeInScreen_RainShowShade), instead of a palette fade.
 */
export interface WeatherFade {
  /** FadeScreen's weather part; true when the weather fades the screen in itself. */
  fadeScreen(mode: number): boolean;
  /** While it does: the fade colour's share of the screen (16 = all of it), else undefined (done). */
  fadeInBlend(): number | undefined;
}

/** Above the map, objects and every window: the fade covers all palettes. */
export const DEPTH_FADE = DEPTH_UI + 1000;

/**
 * FadeScreen / BeginNormalPaletteFade over all palettes, drawn as a full-screen overlay.
 * Approximation: BlendPalette mixes 5-bit colour channels with integer maths; alpha-blending the fade
 * colour on top gives the same ramp but not bit-identical pixels. On the field a fade in can be the weather's
 * (`weather`): the overlay then follows the weather's blend instead.
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
  /** gPaletteFade.deltaY: 2, plus -delay for a negative delay (a faster fade) */
  private deltaY = 2;
  /** The weather is fading the screen in (`WeatherFade`): the overlay follows its blend. */
  private weatherFadeIn = false;
  /** Set on the field: FadeScreen's weather part. */
  weather?: WeatherFade;
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
    if (this.weather?.fadeScreen(mode) && !fadeOut) {
      // No palette fade: the weather blends its palettes from the fade colour (16 frames, `delay` unused)
      this.weatherFadeIn = true;
      this.active = true;
      this.rect.setAlpha(1);
      return true;
    }
    this.y = fadeOut ? 0 : 16;
    this.targetY = fadeOut ? 16 : 0;
    this.objToggle = false;
    this.finishing = -1;
    // BeginNormalPaletteFade: a negative delay steps faster instead (deltaY += -delay, delay 0)
    this.deltaY = delay < 0 ? 2 - delay : 2;
    delay = Math.max(0, delay);
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
    this.deltaY = delay < 0 ? 2 - delay : 2;
    delay = Math.max(0, delay);
    this.delay = delay;
    this.delayCounter = delay;
    this.active = true;
    this.update();
    return true;
  }

  /** Drop the overlay at once (the palettes are reloaded). */
  clear(): void {
    this.active = false;
    this.weatherFadeIn = false;
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
    if (this.weatherFadeIn) this.updateWeatherFadeIn();
    else if (this.active) this.update();
  }

  /** The weather's fade in (FadeInScreen_RainShowShade): IsWeatherNotFadingIn ends it. */
  private updateWeatherFadeIn(): void {
    const blend = this.weather?.fadeInBlend();
    if (blend === undefined) {
      this.weatherFadeIn = false;
      this.active = false;
      this.rect.setAlpha(0);
    } else {
      this.rect.setAlpha(blend / 16);
    }
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
    this.y = this.y < this.targetY ? Math.min(this.y + this.deltaY, this.targetY) : Math.max(this.y - this.deltaY, this.targetY);
  }
}
