// field_weather.c, field_weather_util.c and the FRLG weathers of field_weather_effects.c: the weather state
// (gWeatherPtr), the weather task (Task_WeatherInit / Task_WeatherMain), its palette processing (the gamma shift
// tables, ApplyGammaShift, the screen fade-in with the weather's palettes) and the saved weather
// (gSaveBlock1Ptr->weather: SetSavedWeather, SetSavedWeatherFromCurrMapHeader, DoCurrentWeather,
// ResumePausedWeather).
//
// FRLG's maps and scripts reach WEATHER_NONE, WEATHER_SUNNY, WEATHER_SHADE and WEATHER_FOG_HORIZONTAL
// (POSTGAME_PLAN.md decision 1); WEATHER_UNDERWATER shares the fog's callbacks in FRLG's sWeatherFuncs, so it runs
// too. The weathers no FRLG map or script reaches are ported as the C has them (GAPS_PLAN.md batch 13), each in its
// own module: the rain weathers (RAIN, RAIN_THUNDERSTORM, DOWNPOUR: world/weatherRain.ts, with field_weather.c's sound
// half: SetRainStrengthFromSoundEffect's SE3 loops, PlayRainStoppingSoundEffect), SNOW (world/weatherSnow.ts),
// VOLCANIC_ASH (world/weatherAsh.ts), SANDSTORM (world/weatherSandstorm.ts), SUNNY_CLOUDS (world/weatherClouds.ts),
// FOG_DIAGONAL (world/weatherFogDiagonal.ts), DROUGHT (world/weatherDrought.ts, with field_weather.c's drought half,
// which FRLG dummied out) and UNDERWATER_BUBBLES (world/weatherBubbles.ts, the horizontal fog's callbacks plus the
// bubbles).
//
// The weathers' sprites (but the horizontal fog's, world/fogHorizontal.ts) are world/weatherSprites.ts's: the
// weathers create them there, the field runs their callbacks (AnimateWeatherSprites) and draws them
// (world/weatherSpriteRenderer.ts).
//
// The field draws from atlases and Phaser textures, not from palette RAM: the host (OverworldScene) loads the
// gamma-shifted BG palettes through tilesetVram (gPlttBufferFaded; tilesetVram keeps gPlttBufferUnfaded beside it)
// and shifts the object and field effect sprite sheets (world/weatherTextures.ts). The screen fades are overlays
// (ui/ScreenFade.ts): when the weather fades the screen in itself (FadeInScreen_RainShowShade,
// FadeInScreen_FogHorizontal), the overlay takes its blend coefficient from here. The fog's sprites are the host's
// (world/fogHorizontal.ts), placed from the scroll kept here, and blended over the field with the BLDALPHA
// coefficients kept here (Weather_SetBlendCoeffs / Weather_UpdateBlend). No Phaser import: the unit tests build the
// gamma tables and run the fog.

import { state } from '../battle/env';
import { IsSpecialSEPlaying, PlaySE } from '../gba/sound';
import type { Sprite } from '../gba/sprite';
import { ASH } from './weatherAsh';
import { BUBBLES } from './weatherBubbles';
import { CLOUDS } from './weatherClouds';
import { DROUGHT, FadeInScreen_Drought } from './weatherDrought';
import { FOG_DIAGONAL } from './weatherFogDiagonal';
import { DOWNPOUR, RAIN, THUNDERSTORM } from './weatherRain';
import { SANDSTORM } from './weatherSandstorm';
import { SNOW } from './weatherSnow';
import { ResetWeatherSprites, setWeatherSpritePalette } from './weatherSprites';

// The gamma types of sBasePaletteGammaTypes (field_weather.c's anonymous enum)
const GAMMA_NONE = 0;
const GAMMA_NORMAL = 1;
const GAMMA_ALT = 2;
const GAMMA_TYPES: Record<string, number> = { GAMMA_NONE, GAMMA_NORMAL, GAMMA_ALT };

// include/constants/field_weather.h
export const WEATHER_PAL_STATE_CHANGING_WEATHER = 0;
export const WEATHER_PAL_STATE_SCREEN_FADING_IN = 1;
export const WEATHER_PAL_STATE_SCREEN_FADING_OUT = 2;
export const WEATHER_PAL_STATE_IDLE = 3;

/** The number of BG palettes (the OBJ palettes are 16-31 in the C's indexing). */
const NUM_BG_PALS = 16;
/** gammaShifts[19][32] / altGammaShifts[19][32] */
const NUM_GAMMA_LEVELS = 19;

/** public/gen/weather.json (tools/extract_field.py extract_weather) */
interface WeatherData {
  /** sBasePaletteGammaTypes: GAMMA_NONE / GAMMA_NORMAL / GAMMA_ALT per palette (16 BG, then 16 OBJ). */
  paletteGammaTypes: string[];
  /** sWeatherFuncs by weather id: the callbacks' prefix ("None", "Sunny", "Shade", "FogHorizontal", ...). */
  funcs: string[];
  /** The field effect palette tags loaded with loadfadedpal (UpdateSpritePaletteWithWeather). */
  fadedFieldEffectPaletteTags: string[];
}

/** What the weather needs from the field. */
export interface WeatherHost {
  /** gPlttBufferUnfaded for one of the map's BG palettes (16 JASC [r, g, b]), undefined outside the map's 0-12. */
  bgPaletteUnfaded(slot: number): number[] | undefined;
  /** gPlttBufferFaded: the colours BG palette `slot` shows now (the map's atlases are redrawn with them). */
  setBgPaletteFaded(slot: number, colors: number[]): void;
  /**
   * The OBJ palettes' gamma shift or fog blend: the sprites drawn with GAMMA_NORMAL palettes (reflections, field
   * effects) through `normal`, the GAMMA_ALT ones (the objects themselves) through `alt`; a table maps a 5-bit
   * channel to its new value (one table for all three channels, or one each for red, green and blue), undefined =
   * the colours as loaded.
   */
  setObjPaletteGamma(normal: ChannelTables | undefined, alt: ChannelTables | undefined): void;
  /** REG_BLDALPHA: the blend of the weather's sprites (OBJ mode BLEND) over the field, EVA / 16 and EVB / 16. */
  setBlendAlpha(eva: number, evb: number): void;
  /** CreateFogHorizontalSprites' sprites (LoadSpriteSheet + the 20 CreateSpriteAtEnd) and DestroyFogHorizontalSprites. */
  createFogHorizontalSprites(): void;
  destroyFogHorizontalSprites(): void;
  /** gSpriteCoordOffsetX / Y: the camera's offset as the sprites take it (field_camera.c UpdateCameraPanning). */
  spriteCoordOffsetX(): number;
  spriteCoordOffsetY(): number;
  /**
   * SetSpritePosToMapCoords: a sprite's x / y (to which gSpriteCoordOffsetX / Y are added) for the top-left corner of
   * map coords (mapX, mapY) of the current map (MAP_OFFSET included, as the C's object coords are).
   */
  mapCoordsToSpritePos?(mapX: number, mapY: number): { x: number; y: number };
  /** BLDCNT_EFFECT_LIGHTEN on BG1-3 and OBJ with BLDY = evy (UpdateDroughtBlend); undefined turns it off. */
  setBrightnessLighten?(evy: number | undefined): void;
}

/** A 5-bit channel → 5-bit channel table, for all three channels or one each for red, green and blue. */
export type ChannelTables = Uint8Array | readonly [Uint8Array, Uint8Array, Uint8Array];

/** One sWeatherFuncs row. */
export interface WeatherCallbacks {
  initVars(): void;
  main(): void;
  initAll(): void;
  /** TRUE while the weather is still cleaning up. */
  finish(): boolean;
}

let data: WeatherData | undefined;
let loading: Promise<WeatherData> | undefined;
let host: WeatherHost | undefined;

export async function loadWeatherData(base: string): Promise<void> {
  loading ??= fetch(`${base}/weather.json`).then((res) => {
    if (!res.ok) throw new Error(`Failed to load weather.json: ${res.status}`);
    return res.json() as Promise<WeatherData>;
  });
  data = await loading;
  sBasePaletteGammaTypes = data.paletteGammaTypes.map((t) => GAMMA_TYPES[t] ?? GAMMA_NORMAL);
  sPaletteGammaTypes = sBasePaletteGammaTypes;
}

export function setWeatherHost(h: WeatherHost | undefined): void {
  host = h;
}

/** The field the weather draws on (the weathers' modules: SetSpritePosToMapCoords, the palettes, BLDY). */
export function weatherHost(): WeatherHost | undefined {
  return host;
}

/** The field effect palette tags whose sprites the weather shifts (FieldEffectScript_LoadFadedPalette). */
export function fadedFieldEffectPaletteTags(): readonly string[] {
  return data?.fadedFieldEffectPaletteTags ?? [];
}

// ------------------------------------------------------------------ sWeather (gWeatherPtr)

/** The part of struct Weather the ported weathers use (gWeatherPtr). */
const sWeather = {
  gammaShifts: Array.from({ length: NUM_GAMMA_LEVELS }, () => new Uint8Array(32)),
  altGammaShifts: Array.from({ length: NUM_GAMMA_LEVELS }, () => new Uint8Array(32)),
  gammaIndex: 0,
  gammaTargetIndex: 0,
  gammaStepDelay: 0,
  gammaStepFrameCounter: 0,
  palProcessingState: WEATHER_PAL_STATE_IDLE,
  fadeScreenCounter: 0,
  readyForInit: false,
  fadeInActive: 0,
  fadeInCounter: 0,
  initStep: 0,
  finishStep: 0,
  currWeather: 0,
  nextWeather: 0,
  weatherChangeComplete: true,
  weatherGfxLoaded: false,
  // BLDALPHA (Weather_SetBlendCoeffs, Weather_SetTargetBlendCoeffs, Weather_UpdateBlend)
  currBlendEVA: 0,
  currBlendEVB: 0,
  targetBlendEVA: 0,
  targetBlendEVB: 0,
  blendUpdateCounter: 0,
  blendFrameCounter: 0,
  blendDelay: 0,
  // WEATHER_FOG_HORIZONTAL
  fogHScrollCounter: 0,
  fogHScrollOffset: 0,
  fogHScrollPosX: 0,
  fogHSpritesCreated: false,
  // the rain weathers (world/weatherRain.ts)
  rainSprites: Array.from({ length: 24 }, (): Sprite | null => null),
  rainSpriteVisibleCounter: 0,
  curRainSpriteIndex: 0,
  targetRainSpriteCount: 0,
  rainSpriteCount: 0,
  rainSpriteVisibleDelay: 0,
  isDownpour: 0,
  rainStrength: 0,
  thunderDelay: 0,
  thunderCounter: 0,
  thunderAllowEnd: false,
  thunderSkipShort: 0,
  thunderShortRetries: 0,
  thunderTriggered: false,
  // WEATHER_SNOW (world/weatherSnow.ts; the C's snowflakeSprites share the sprites union with the rain's)
  snowflakeSprites: Array.from({ length: 101 }, (): Sprite | null => null),
  snowflakeVisibleCounter: 0,
  /** Never incremented (WaitSnowflakeSprite), never reset: EWRAM's 0. */
  snowflakeTimer: 0,
  snowflakeSpriteCount: 0,
  targetSnowflakeSpriteCount: 0,
  // WEATHER_VOLCANIC_ASH (world/weatherAsh.ts)
  ashSprites: Array.from({ length: 20 }, (): Sprite | null => null),
  ashBaseSpritesX: 0,
  ashUnused: 0,
  ashSpritesCreated: false,
  // WEATHER_SANDSTORM (world/weatherSandstorm.ts)
  sandstormSprites1: Array.from({ length: 20 }, (): Sprite | null => null),
  sandstormSprites2: Array.from({ length: 5 }, (): Sprite | null => null),
  /** u32 */
  sandstormXOffset: 0,
  /** u32 */
  sandstormYOffset: 0,
  sandstormBaseSpritesX: 0,
  sandstormPosY: 0,
  sandstormWaveIndex: 0,
  sandstormWaveCounter: 0,
  sandstormSpritesCreated: false,
  sandstormSwirlSpritesCreated: false,
  // WEATHER_SUNNY_CLOUDS (world/weatherClouds.ts)
  cloudSprites: Array.from({ length: 3 }, (): Sprite | null => null),
  cloudSpritesCreated: false,
  // WEATHER_FOG_DIAGONAL (world/weatherFogDiagonal.ts)
  fogDSprites: Array.from({ length: 20 }, (): Sprite | null => null),
  fogDBaseSpritesX: 0,
  fogDPosY: 0,
  fogDScrollXCounter: 0,
  fogDScrollYCounter: 0,
  fogDXOffset: 0,
  fogDYOffset: 0,
  fogDSpritesCreated: false,
  // WEATHER_UNDERWATER_BUBBLES (world/weatherBubbles.ts)
  bubblesDelayCounter: 0,
  bubblesDelayIndex: 0,
  bubblesCoordsIndex: 0,
  bubblesSpriteCount: 0,
  bubblesSpritesCreated: false,
  // WEATHER_DROUGHT (world/weatherDrought.ts)
  droughtBrightnessStage: 0,
  droughtLastBrightnessStage: 0,
  droughtTimer: 0,
  droughtState: 0,
  loadDroughtPalsIndex: 0,
  loadDroughtPalsOffset: 0,
  /** FadeScreen's fade colour for a fade in (RGB_BLACK or RGB_WHITEALPHA), as a GBA colour. */
  fadeDestColor: 0,
};

/** gWeatherPtr: the weathers' modules (world/weatherRain.ts, ...) work on it as the C's do. */
export const gWeatherPtr = sWeather;

/** The weather task: Task_WeatherInit until the screen fades in, then Task_WeatherMain; undefined once ResetTasks killed it. */
let task: 'Task_WeatherInit' | 'Task_WeatherMain' | undefined;
let tablesBuilt = false;
let sBasePaletteGammaTypes: number[] = [];
let sPaletteGammaTypes: number[] = [];

// ------------------------------------------------------------------ the weathers (field_weather_effects.c)

function None_Init(): void {
  sWeather.gammaTargetIndex = 0;
  sWeather.gammaStepDelay = 0;
}

const NONE: WeatherCallbacks = { initVars: None_Init, main: () => {}, initAll: None_Init, finish: () => false };

/** Sunny_InitVars: no gamma shift, no sprites (FRLG's WEATHER_SUNNY looks like WEATHER_NONE). */
function Sunny_InitVars(): void {
  sWeather.gammaTargetIndex = 0;
  sWeather.gammaStepDelay = 20;
}

const SUNNY: WeatherCallbacks = {
  initVars: Sunny_InitVars,
  main: () => {}, // Sunny_Main
  initAll: Sunny_InitVars, // Sunny_InitAll
  finish: () => false, // Sunny_Finish
};

/** Shade_InitVars: the palettes three steps darker (gamma index 3), one step per 20 frames. */
function Shade_InitVars(): void {
  sWeather.initStep = 0;
  sWeather.gammaTargetIndex = 3;
  sWeather.gammaStepDelay = 20;
}

const SHADE: WeatherCallbacks = {
  initVars: Shade_InitVars,
  main: () => {}, // Shade_Main
  initAll: Shade_InitVars, // Shade_InitAll
  finish: () => false, // Shade_Finish
};

// ------------------------------------------------------------------ WEATHER_FOG_HORIZONTAL and WEATHER_UNDERWATER

/** FogHorizontal_InitVars (Bubbles_InitVars too): no gamma shift; the fog's scroll and blend start over unless its sprites are up. */
export function FogHorizontal_InitVars(): void {
  sWeather.initStep = 0;
  sWeather.weatherGfxLoaded = false;
  sWeather.gammaTargetIndex = 0;
  sWeather.gammaStepDelay = 20;
  if (!sWeather.fogHSpritesCreated) {
    sWeather.fogHScrollCounter = 0;
    sWeather.fogHScrollOffset = 0;
    sWeather.fogHScrollPosX = 0;
    Weather_SetBlendCoeffs(0, 16);
  }
}

/** FogHorizontal_InitAll: the sprites and their blend, all in this frame (Main until the blend is reached). */
function FogHorizontal_InitAll(): void {
  FogHorizontal_InitVars();
  while (!sWeather.weatherGfxLoaded) FogHorizontal_Main();
}

/** The fog drifts left a pixel every 4 frames, on top of the camera's scroll (FogHorizontal_Main / _Finish). */
function UpdateFogHorizontalMovement(): void {
  sWeather.fogHScrollPosX = (spriteCoordOffsetX() - sWeather.fogHScrollOffset) & 0xff;
  if (++sWeather.fogHScrollCounter > 3) {
    sWeather.fogHScrollCounter = 0;
    sWeather.fogHScrollOffset++;
  }
}

export function FogHorizontal_Main(): void {
  UpdateFogHorizontalMovement();
  switch (sWeather.initStep) {
    case 0:
      CreateFogHorizontalSprites();
      if (sWeather.currWeather === define('WEATHER_FOG_HORIZONTAL')) Weather_SetTargetBlendCoeffs(12, 8, 3);
      else Weather_SetTargetBlendCoeffs(4, 16, 0); // WEATHER_UNDERWATER
      sWeather.initStep++;
      break;
    case 1:
      if (Weather_UpdateBlend()) {
        sWeather.weatherGfxLoaded = true;
        sWeather.initStep++;
      }
      break;
  }
}

/** FogHorizontal_Finish: the fog fades out (a blend step every 4 frames), then its sprites go. */
export function FogHorizontal_Finish(): boolean {
  UpdateFogHorizontalMovement();
  switch (sWeather.finishStep) {
    case 0:
      Weather_SetTargetBlendCoeffs(0, 16, 3);
      sWeather.finishStep++;
      break;
    case 1:
      if (Weather_UpdateBlend()) sWeather.finishStep++;
      break;
    case 2:
      DestroyFogHorizontalSprites();
      sWeather.finishStep++;
      break;
    default:
      return false;
  }
  return true;
}

const FOG_HORIZONTAL: WeatherCallbacks = {
  initVars: FogHorizontal_InitVars,
  main: FogHorizontal_Main,
  initAll: FogHorizontal_InitAll,
  finish: FogHorizontal_Finish,
};

/** CreateFogHorizontalSprites: the host's sprites (world/fogHorizontal.ts), once. */
function CreateFogHorizontalSprites(): void {
  if (sWeather.fogHSpritesCreated) return;
  host?.createFogHorizontalSprites();
  sWeather.fogHSpritesCreated = true;
}

/** DestroyFogHorizontalSprites */
function DestroyFogHorizontalSprites(): void {
  if (!sWeather.fogHSpritesCreated) return;
  host?.destroyFogHorizontalSprites();
  sWeather.fogHSpritesCreated = false;
}

/** gSpriteCoordOffsetX (0 without a field). */
export function spriteCoordOffsetX(): number {
  return host?.spriteCoordOffsetX() ?? 0;
}

/** gSpriteCoordOffsetY (0 without a field). */
export function spriteCoordOffsetY(): number {
  return host?.spriteCoordOffsetY() ?? 0;
}

/** The fog sprites' callback reads this (FogHorizontalSpriteCallback): the scroll, or undefined without the sprites. */
export function fogHorizontalScrollPosX(): number | undefined {
  return sWeather.fogHSpritesCreated ? sWeather.fogHScrollPosX : undefined;
}

/**
 * sWeatherFuncs' rows by their callbacks' prefix (FogHorizontal: WEATHER_FOG_HORIZONTAL and WEATHER_UNDERWATER;
 * Downpour: Downpour_InitVars / _InitAll with Thunderstorm_Main / _Finish). Built on first use: the weathers'
 * modules import this one.
 */
let PORTED: Record<string, WeatherCallbacks> | undefined;
const ported = (): Record<string, WeatherCallbacks> =>
  (PORTED ??= {
    None: NONE,
    Sunny: SUNNY,
    Shade: SHADE,
    FogHorizontal: FOG_HORIZONTAL,
    Rain: RAIN,
    Thunderstorm: THUNDERSTORM,
    Downpour: DOWNPOUR,
    Snow: SNOW,
    Ash: ASH,
    Sandstorm: SANDSTORM,
    Clouds: CLOUDS,
    FogDiagonal: FOG_DIAGONAL,
    Drought: DROUGHT,
    Bubbles: BUBBLES,
  });

/**
 * sWeatherFuncs[weather]. TranslateWeatherNum keeps the saved weather in range, so every weather has its row; a
 * number past the table (a weather the C would index out of bounds) runs None's callbacks.
 */
function weatherFuncs(weather: number): WeatherCallbacks {
  const name = data?.funcs[weather];
  return (name ? ported()[name] : undefined) ?? NONE;
}

/** The weathers FadeScreen fades in with the weather's palettes (useWeatherPal). */
function fadesInWithWeatherPalettes(weather: number): boolean {
  return ['WEATHER_RAIN', 'WEATHER_RAIN_THUNDERSTORM', 'WEATHER_DOWNPOUR', 'WEATHER_SNOW', 'WEATHER_FOG_HORIZONTAL', 'WEATHER_SHADE', 'WEATHER_DROUGHT'].some((w) => weather === define(w));
}

/** FadeInScreenWithWeather's FadeInScreen_RainShowShade weathers. */
function fadesInWithRainShowShade(weather: number): boolean {
  return ['WEATHER_RAIN', 'WEATHER_RAIN_THUNDERSTORM', 'WEATHER_DOWNPOUR', 'WEATHER_SNOW', 'WEATHER_SHADE'].some((w) => weather === define(w));
}

function define(name: string): number {
  return state.defines.require(name);
}

// ------------------------------------------------------------------ field_weather.c

/** StartWeather: a new weather task (Task_WeatherInit), unless one is running; the weather is NONE until ResumePausedWeather. */
export function StartWeather(): void {
  if (task === 'Task_WeatherMain') return; // FuncIsActiveTask(Task_WeatherMain)
  // AllocSpritePalette(PALTAG_WEATHER) + gDefaultWeatherSpritePalette: the fog module's texture has its colours
  setWeatherSpritePalette('gDefaultWeatherSpritePalette');
  BuildGammaShiftTables();
  // The map load's ResetSpriteData freed the sprites on the GBA; the port's outlive it, so they go here.
  ResetWeatherSprites();
  sWeather.rainSpriteCount = 0;
  sWeather.curRainSpriteIndex = 0;
  sWeather.cloudSpritesCreated = false;
  sWeather.fogDSpritesCreated = false;
  sWeather.bubblesSpritesCreated = false;
  sWeather.snowflakeSpriteCount = 0;
  sWeather.ashSpritesCreated = false;
  sWeather.sandstormSpritesCreated = false;
  sWeather.sandstormSwirlSpritesCreated = false;
  if (sWeather.fogHSpritesCreated) host?.destroyFogHorizontalSprites();
  sWeather.fogHSpritesCreated = false;
  Weather_SetBlendCoeffs(16, 0);
  sWeather.currWeather = define('WEATHER_NONE');
  sWeather.palProcessingState = WEATHER_PAL_STATE_IDLE;
  sWeather.readyForInit = false;
  sWeather.weatherChangeComplete = true;
  task = 'Task_WeatherInit'; // CreateTask(Task_WeatherInit, 80)
}

/** The field's ResetTasks (a warp's map load, ResumeMap): the weather task is gone until StartWeather. */
export function ResetWeatherTask(): void {
  task = undefined;
}

/** SetNextWeather: Task_WeatherMain finishes the current weather and starts this one. */
export function SetNextWeather(weather: number): void {
  if (weather !== define('WEATHER_RAIN') && weather !== define('WEATHER_RAIN_THUNDERSTORM') && weather !== define('WEATHER_DOWNPOUR')) {
    PlayRainStoppingSoundEffect();
  }
  if (sWeather.nextWeather !== weather && sWeather.currWeather === weather) weatherFuncs(weather).initVars();
  sWeather.weatherChangeComplete = false;
  sWeather.nextWeather = weather;
  sWeather.finishStep = 0;
}

/** SetCurrentAndNextWeather: switch at once (the new weather's InitAll runs when the task inits). */
export function SetCurrentAndNextWeather(weather: number): void {
  PlayRainStoppingSoundEffect();
  sWeather.currWeather = weather;
  sWeather.nextWeather = weather;
}

/** The weather task, once a frame (priority 80, with the field's other tasks). */
export function WeatherTask(): void {
  if (task === 'Task_WeatherInit') Task_WeatherInit();
  else if (task === 'Task_WeatherMain') Task_WeatherMain();
}

/** Task_WeatherInit: waits until the screen fades in (FadeScreen sets readyForInit), then the weather's InitAll. */
function Task_WeatherInit(): void {
  if (sWeather.readyForInit) {
    weatherFuncs(sWeather.currWeather).initAll();
    task = 'Task_WeatherMain'; // from the next frame
  }
}

function Task_WeatherMain(): void {
  if (sWeather.currWeather !== sWeather.nextWeather) {
    if (!weatherFuncs(sWeather.currWeather).finish()) {
      // Finished cleaning up the previous weather: on to the next one
      weatherFuncs(sWeather.nextWeather).initVars();
      sWeather.gammaStepFrameCounter = 0;
      sWeather.palProcessingState = WEATHER_PAL_STATE_CHANGING_WEATHER;
      sWeather.currWeather = sWeather.nextWeather;
      sWeather.weatherChangeComplete = true;
    }
  } else {
    weatherFuncs(sWeather.currWeather).main();
  }
  // sWeatherPalStateFuncs[palProcessingState]
  switch (sWeather.palProcessingState) {
    case WEATHER_PAL_STATE_CHANGING_WEATHER:
      UpdateWeatherGammaShift();
      break;
    case WEATHER_PAL_STATE_SCREEN_FADING_IN:
      FadeInScreenWithWeather();
      break;
    default: // DoNothing
      break;
  }
}

/**
 * BuildGammaShiftTables: gammaShifts (each row darker by 1/16 for indices 0-2, then lighter up to white) and
 * altGammaShifts (the same without the darkening: rows 0-2 leave the colours alone). The C keeps the u16
 * arithmetic of its loops; so does this.
 */
function BuildGammaShiftTables(): void {
  sPaletteGammaTypes = sBasePaletteGammaTypes;
  if (tablesBuilt) return; // the same two tables every time
  tablesBuilt = true;
  for (let v0 = 0; v0 <= 1; v0++) {
    const gammaTable = v0 === 0 ? sWeather.gammaShifts : sWeather.altGammaShifts;
    for (let v2 = 0; v2 < 32; v2++) {
      let v4 = v2 << 8;
      const v5 = v0 === 0 ? Math.floor((v2 << 8) / 16) : 0;
      let gammaIndex = 0;
      for (; gammaIndex <= 2; gammaIndex++) {
        v4 = (v4 - v5) & 0xffff;
        gammaTable[gammaIndex][v2] = v4 >> 8;
      }
      const v9 = v4;
      let v10 = (0x1f00 - v4) >>> 0; // u32
      if (0x1f00 - v4 < 0) v10 = (v10 + 0xf) >>> 0;
      const v11 = (v10 >>> 4) & 0xffff;
      for (; gammaIndex < NUM_GAMMA_LEVELS; gammaIndex++) {
        v4 = (v4 + v11) & 0xffff;
        if (v2 < 12) {
          const dunno = ((v4 - v9) << 16) >> 16; // s16
          if (dunno > 0) v4 = (v4 - ((dunno + ((dunno & 0xffff) >> 15)) >> 1)) & 0xffff;
        }
        gammaTable[gammaIndex][v2] = Math.min((v4 >> 8) & 0xff, 0x1f);
      }
    }
  }
}

/** UpdateWeatherGammaShift: one gamma step toward the target every gammaStepDelay frames. */
function UpdateWeatherGammaShift(): void {
  if (sWeather.gammaIndex === sWeather.gammaTargetIndex) {
    sWeather.palProcessingState = WEATHER_PAL_STATE_IDLE;
  } else if (++sWeather.gammaStepFrameCounter >= sWeather.gammaStepDelay) {
    sWeather.gammaStepFrameCounter = 0;
    if (sWeather.gammaIndex < sWeather.gammaTargetIndex) sWeather.gammaIndex++;
    else sWeather.gammaIndex--;
    ApplyGammaShift(0, 32, sWeather.gammaIndex);
  }
}

/** FadeInScreenWithWeather */
function FadeInScreenWithWeather(): void {
  if (++sWeather.fadeInCounter > 1) sWeather.fadeInActive = 0;
  if (fadesInWithRainShowShade(sWeather.currWeather)) {
    if (!FadeInScreen_RainShowShade()) {
      sWeather.gammaIndex = 3;
      sWeather.palProcessingState = WEATHER_PAL_STATE_IDLE;
    }
  } else if (sWeather.currWeather === define('WEATHER_DROUGHT')) {
    if (!FadeInScreen_Drought()) {
      sWeather.gammaIndex = -6;
      sWeather.palProcessingState = WEATHER_PAL_STATE_IDLE;
    }
  } else if (sWeather.currWeather === define('WEATHER_FOG_HORIZONTAL')) {
    if (!FadeInScreen_FogHorizontal()) {
      sWeather.gammaIndex = 0;
      sWeather.palProcessingState = WEATHER_PAL_STATE_IDLE;
    }
  } else if (!paletteFadeActive()) {
    // default (WEATHER_VOLCANIC_ASH, WEATHER_SANDSTORM, WEATHER_FOG_DIAGONAL, WEATHER_UNDERWATER among them): wait for the normal palette fade
    sWeather.gammaIndex = sWeather.gammaTargetIndex;
    sWeather.palProcessingState = WEATHER_PAL_STATE_IDLE;
  }
}

/**
 * FadeInScreen_RainShowShade: 16 frames from the fade colour to the palettes at gamma index 3. The blend
 * (ApplyGammaShiftWithBlend's 16 - fadeScreenCounter) is the screen fade overlay's (`WeatherFadeInBlend`); the
 * palettes under it are shifted from the first step.
 */
function FadeInScreen_RainShowShade(): boolean {
  if (sWeather.fadeScreenCounter === 16) return false;
  if (++sWeather.fadeScreenCounter >= 16) {
    ApplyGammaShift(0, 32, 3);
    sWeather.fadeScreenCounter = 16;
    return false;
  }
  ApplyGammaShift(0, 32, 3); // ApplyGammaShiftWithBlend(0, 32, 3, 16 - fadeScreenCounter, fadeDestColor)
  return true;
}

/**
 * FadeInScreen_FogHorizontal: 16 frames of ApplyFogBlend from the fade colour (the overlay's blend, as for the
 * shade), then a frame on the fog's colours before the weather goes idle.
 */
function FadeInScreen_FogHorizontal(): boolean {
  if (sWeather.fadeScreenCounter === 16) return false;
  sWeather.fadeScreenCounter++;
  ApplyFogBlend(); // ApplyFogBlend(16 - fadeScreenCounter, fadeDestColor)
  return true;
}

/**
 * ApplyFogBlend's palettes under the overlay's blend: the BG palettes as loaded (BlendPalette(0, 256, ...) from
 * gPlttBufferUnfaded), and the OBJ palettes UpdateSpritePaletteWithWeather marked to lighten
 * (LightenSpritePaletteInFog: 3/4 of the way to RGB(28, 31, 28)). The port lightens every sheet a GAMMA_NORMAL
 * palette draws (reflections, the loadfadedpal field effects), which is also what UpdateSpritePaletteWithWeather does
 * to one loaded in the fog later (BlendPalette(12, RGB(28, 31, 28))); the objects' own palettes stay as loaded.
 */
function ApplyFogBlend(): void {
  ApplyGammaShift(0, NUM_BG_PALS, 0);
  objGammaIndex = 0;
  host?.setObjPaletteGamma(fogLightenTables(), undefined);
}

let fogLighten: readonly [Uint8Array, Uint8Array, Uint8Array] | undefined;

/** BlendPalette(paletteOffset, 16, 12, RGB(28, 31, 28)) per channel: c + ((target - c) * 12 >> 4). */
export function fogLightenTables(): readonly [Uint8Array, Uint8Array, Uint8Array] {
  fogLighten ??= ([28, 31, 28] as const).map((target) => Uint8Array.from({ length: 32 }, (_, c) => c + (((target - c) * 12) >> 4))) as unknown as [Uint8Array, Uint8Array, Uint8Array];
  return fogLighten;
}

let paletteFadeActive: () => boolean = () => false;

/** gPaletteFade.active, for FadeInScreenWithWeather's default case (the field's screen fade). */
export function setWeatherPaletteFadeActive(f: () => boolean): void {
  paletteFadeActive = f;
}

/** A 5-bit channel → shifted 5-bit channel table, or undefined where the row leaves the colours alone. */
function gammaRow(table: Uint8Array[], gammaIndex: number): Uint8Array | undefined {
  const row = table[gammaIndex - 1];
  return row.every((v, i) => v === i) ? undefined : row;
}

/**
 * ApplyGammaShift: palettes startPalIndex .. startPalIndex + numPalettes - 1 (0-15 BG, 16-31 OBJ) from the unfaded
 * colours through gamma row gammaIndex - 1 (GAMMA_ALT palettes through altGammaShifts); 0 copies them back unshifted,
 * a negative index (drought) does nothing in FRLG.
 */
export function ApplyGammaShift(startPalIndex: number, numPalettes: number, gammaIndex: number): void {
  if (gammaIndex < 0 || !host) return; // Dummied out in FRLG
  const end = startPalIndex + numPalettes;
  for (let pal = startPalIndex; pal < Math.min(end, NUM_BG_PALS); pal++) {
    const unfaded = host.bgPaletteUnfaded(pal);
    if (!unfaded) continue;
    const type = sPaletteGammaTypes[pal];
    const table = gammaIndex === 0 || type === GAMMA_NONE ? undefined : gammaRow(type === GAMMA_ALT ? sWeather.altGammaShifts : sWeather.gammaShifts, gammaIndex);
    host.setBgPaletteFaded(pal, table ? shiftColors(unfaded, table) : unfaded);
  }
  if (end > NUM_BG_PALS) {
    // The port's sprites aren't in palette slots: the field's object and field effect sheets take the GAMMA_NORMAL
    // and GAMMA_ALT rows (sPaletteGammaTypes: the objects' slots 0, 2-5 and 10 and the weather's are ALT, their
    // reflections' and the field effects' NORMAL). PreservePaletteInWeather's GAMMA_NONE (the field move's mon) isn't
    // needed: that pic is drawn outside the field's sprites.
    objGammaIndex = gammaIndex;
    host.setObjPaletteGamma(objGammaTable('normal'), objGammaTable('alt'));
  }
}

/** The gamma index the OBJ palettes were last shifted with. */
let objGammaIndex = 0;

/** UpdateSpritePaletteWithWeather / ApplyWeatherGammaShiftToPal for a sprite sheet the field loads now: its table. */
export function objGammaTable(type: 'normal' | 'alt'): Uint8Array | undefined {
  if (objGammaIndex <= 0) return undefined;
  return gammaRow(type === 'alt' ? sWeather.altGammaShifts : sWeather.gammaShifts, objGammaIndex);
}

/** JASC [r, g, b] × 16 through a 5-bit table: gbagfx's 8 → 5 bits (>> 3), then back as the .pal files expand them. */
function shiftColors(colors: number[], table: Uint8Array): number[] {
  return colors.map((c) => expand5(table[c >> 3]));
}

/** A 5-bit channel as the decomp's JASC palettes hold it (floor(c * 255 / 31): 10 → 82, 31 → 255). */
export function expand5(c: number): number {
  return Math.floor((c * 255) / 31);
}

/**
 * ApplyWeatherGammaShiftToPal for the map's BG palettes: LoadMapFromCameraTransition reloads the new secondary
 * tileset's palettes and shifts them with the current gamma index (the port reloads all of them).
 */
export function ApplyWeatherGammaShiftToBgPals(): void {
  ApplyGammaShift(0, 13, sWeather.gammaIndex);
}

/**
 * FadeScreen's weather part (the palette fade itself is the overlay's: ui/ScreenFade.ts). Returns true when the
 * weather fades the screen in itself (useWeatherPal on a fade in): the overlay then follows `WeatherFadeInBlend`.
 */
export function WeatherFadeScreen(mode: number): boolean {
  let fadeOut: boolean;
  switch (mode) {
    case define('FADE_FROM_BLACK'):
    case define('FADE_FROM_WHITE'):
      fadeOut = false;
      break;
    case define('FADE_TO_BLACK'):
    case define('FADE_TO_WHITE'):
      fadeOut = true;
      break;
    default:
      return false;
  }
  const useWeatherPal = fadesInWithWeatherPalettes(sWeather.currWeather);
  if (fadeOut) {
    // useWeatherPal: CpuFastCopy(gPlttBufferFaded, gPlttBufferUnfaded) so the fade starts from the weather's colours;
    // the overlay fades whatever the field shows (see docs/DEVIATIONS.md)
    sWeather.palProcessingState = WEATHER_PAL_STATE_SCREEN_FADING_OUT;
    return false;
  }
  // fadeDestColor (RGB_BLACK / RGB_WHITEALPHA): the overlay's colour, kept for the drought's last fade step
  sWeather.fadeDestColor = mode === define('FADE_FROM_WHITE') ? 0xffff : 0x0000;
  if (useWeatherPal) sWeather.fadeScreenCounter = 0;
  sWeather.palProcessingState = WEATHER_PAL_STATE_SCREEN_FADING_IN;
  sWeather.fadeInActive = 1;
  sWeather.fadeInCounter = 0;
  Weather_SetBlendCoeffs(sWeather.currBlendEVA, sWeather.currBlendEVB);
  sWeather.readyForInit = true;
  return useWeatherPal;
}

/**
 * While the weather fades the screen in itself: the fade colour's share of the screen (16 = all fade colour, the
 * blend coefficient ApplyGammaShiftWithBlend uses), else undefined (done, or no weather task to do it).
 */
export function WeatherFadeInBlend(): number | undefined {
  if (task === undefined || sWeather.palProcessingState !== WEATHER_PAL_STATE_SCREEN_FADING_IN) return undefined;
  if (!fadesInWithWeatherPalettes(sWeather.currWeather)) return undefined;
  return 16 - sWeather.fadeScreenCounter;
}

/** Weather_SetBlendCoeffs: BLDALPHA at once. */
export function Weather_SetBlendCoeffs(eva: number, evb: number): void {
  sWeather.currBlendEVA = eva;
  sWeather.currBlendEVB = evb;
  sWeather.targetBlendEVA = eva;
  sWeather.targetBlendEVB = evb;
  host?.setBlendAlpha(eva, evb);
}

/** Weather_SetTargetBlendCoeffs: Weather_UpdateBlend moves toward these, a step every `delay` + 1 frames. */
export function Weather_SetTargetBlendCoeffs(eva: number, evb: number, delay: number): void {
  sWeather.targetBlendEVA = eva;
  sWeather.targetBlendEVB = evb;
  sWeather.blendDelay = delay;
  sWeather.blendFrameCounter = 0;
  sWeather.blendUpdateCounter = 0;
}

/** Weather_UpdateBlend: a step of EVA or EVB (in turn) toward the target; TRUE once there. */
export function Weather_UpdateBlend(): boolean {
  if (sWeather.currBlendEVA === sWeather.targetBlendEVA && sWeather.currBlendEVB === sWeather.targetBlendEVB) return true;
  if (++sWeather.blendFrameCounter > sWeather.blendDelay) {
    sWeather.blendFrameCounter = 0;
    sWeather.blendUpdateCounter++;
    // Update currBlendEVA and currBlendEVB on alternate frames
    if (sWeather.blendUpdateCounter & 1) {
      if (sWeather.currBlendEVA < sWeather.targetBlendEVA) sWeather.currBlendEVA++;
      else if (sWeather.currBlendEVA > sWeather.targetBlendEVA) sWeather.currBlendEVA--;
    } else if (sWeather.currBlendEVB < sWeather.targetBlendEVB) sWeather.currBlendEVB++;
    else if (sWeather.currBlendEVB > sWeather.targetBlendEVB) sWeather.currBlendEVB--;
  }
  host?.setBlendAlpha(sWeather.currBlendEVA, sWeather.currBlendEVB);
  return sWeather.currBlendEVA === sWeather.targetBlendEVA && sWeather.currBlendEVB === sWeather.targetBlendEVB;
}

/**
 * SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(eva, evb)) outside Weather_SetBlendCoeffs / _UpdateBlend (Ash_InitVars'
 * BLDALPHA_BLEND(64, 63), Ash_Finish's 0): the register's 5-bit fields take the low bits (64 → EVA 0, 63 → EVB 31,
 * which the PPU takes as 16). gWeatherPtr's coefficients don't change.
 */
export function SetWeatherBldAlpha(eva: number, evb: number): void {
  host?.setBlendAlpha(eva & 0x1f, evb & 0x1f);
}

/** BLDALPHA as the weather last wrote it (the GBA layer's copy of the field takes it over). */
export function weatherBlendAlpha(): { eva: number; evb: number } {
  return { eva: sWeather.currBlendEVA, evb: sWeather.currBlendEVB };
}

/** WeatherShiftGammaIfPalStateIdle: the palettes at a gamma index at once (the thunderstorm's lightning), unless they're changing. */
export function WeatherShiftGammaIfPalStateIdle(gammaIndex: number): void {
  if (sWeather.palProcessingState === WEATHER_PAL_STATE_IDLE) {
    ApplyGammaShift(0, 32, gammaIndex);
    sWeather.gammaIndex = gammaIndex;
  }
}

/** WeatherBeginGammaFade: from one gamma index to another, a step every gammaStepDelay frames (UpdateWeatherGammaShift). */
export function WeatherBeginGammaFade(gammaIndex: number, gammaTargetIndex: number, gammaStepDelay: number): void {
  if (sWeather.palProcessingState === WEATHER_PAL_STATE_IDLE) {
    sWeather.palProcessingState = WEATHER_PAL_STATE_CHANGING_WEATHER;
    sWeather.gammaIndex = gammaIndex;
    sWeather.gammaTargetIndex = gammaTargetIndex;
    sWeather.gammaStepFrameCounter = 0;
    sWeather.gammaStepDelay = gammaStepDelay;
    WeatherShiftGammaIfPalStateIdle(gammaIndex);
  }
}

/**
 * LoadCustomWeatherSpritePalette: the weather palette slot's colours (a gfx16 symbol: gCloudsWeatherPalette,
 * gSandstormWeatherPalette), then UpdateSpritePaletteWithWeather on it: the renderer shows them through the weather's
 * GAMMA_ALT row (`objGammaTable('alt')`), the screen fades being the overlay's.
 */
export function LoadCustomWeatherSpritePalette(palette: string): void {
  setWeatherSpritePalette(palette);
}

/** SetRainStrengthFromSoundEffect: the rain weathers' SE3 loop (and the strength PlayRainStoppingSoundEffect stops), unless the screen is fading out. */
export function SetRainStrengthFromSoundEffect(soundEffect: number): void {
  if (sWeather.palProcessingState === WEATHER_PAL_STATE_SCREEN_FADING_OUT) return;
  if (soundEffect === define('SE_RAIN')) sWeather.rainStrength = 0;
  else if (soundEffect === define('SE_DOWNPOUR')) sWeather.rainStrength = 1;
  else if (soundEffect === define('SE_THUNDERSTORM')) sWeather.rainStrength = 2;
  else return;
  PlaySE(soundEffect);
}

/**
 * PlayRainStoppingSoundEffect: while SE3 plays (a rain loop, or the low HP beep), the stopping sound of the last rain
 * strength (SE_RAIN_STOP / SE_DOWNPOUR_STOP / SE_THUNDERSTORM_STOP, on SE3 too). The C calls it on a weather change,
 * the warps (field_fadetransition.c), the start menu's screens and the Seagallop's warp.
 */
export function PlayRainStoppingSoundEffect(): void {
  if (!IsSpecialSEPlaying()) return;
  switch (sWeather.rainStrength) {
    case 0:
      PlaySE(define('SE_RAIN_STOP'));
      break;
    case 1:
      PlaySE(define('SE_DOWNPOUR_STOP'));
      break;
    default:
      PlaySE(define('SE_THUNDERSTORM_STOP'));
      break;
  }
}

/** IsWeatherNotFadingIn */
export function IsWeatherNotFadingIn(): boolean {
  return sWeather.palProcessingState !== WEATHER_PAL_STATE_SCREEN_FADING_IN;
}

/** GetCurrentWeather */
export function GetCurrentWeather(): number {
  return sWeather.currWeather;
}

/** SlightlyDarkenPalsInWeather's switch (the quest log's QL_SlightlyDarkenSomePals): the weathers that darken. */
export function WeatherSlightlyDarkensPals(): boolean {
  return ['WEATHER_RAIN', 'WEATHER_SNOW', 'WEATHER_RAIN_THUNDERSTORM', 'WEATHER_SHADE', 'WEATHER_DOWNPOUR'].some(
    (w) => sWeather.currWeather === define(w),
  );
}

/** IsWeatherChangeComplete */
export function IsWeatherChangeComplete(): boolean {
  return sWeather.weatherChangeComplete;
}

/** SetWeatherScreenFadeOut (Sweet Scent, the battle transitions) */
export function SetWeatherScreenFadeOut(): void {
  sWeather.palProcessingState = WEATHER_PAL_STATE_SCREEN_FADING_OUT;
}

/** WeatherProcessingIdle */
export function WeatherProcessingIdle(): void {
  sWeather.palProcessingState = WEATHER_PAL_STATE_IDLE;
}

// ------------------------------------------------------------------ field_weather_util.c (the saved weather)

/** TranslateWeatherNum: the Route 119 / 123 cycles (R/S leftovers) at weatherCycleStage 0 (FRLG never sets it). */
function TranslateWeatherNum(weather: number): number {
  if (weather === define('WEATHER_ROUTE119_CYCLE') || weather === define('WEATHER_ROUTE123_CYCLE')) return define('WEATHER_SUNNY');
  if (weather >= define('WEATHER_NONE') && weather <= define('WEATHER_UNDERWATER_BUBBLES')) return weather;
  return define('WEATHER_NONE');
}

/** UpdateRainCounter: GAME_STAT_GOT_RAINED_ON when the saved weather turns to rain. */
function UpdateRainCounter(newWeather: number, oldWeather: number): void {
  if (newWeather !== oldWeather && (newWeather === define('WEATHER_RAIN') || newWeather === define('WEATHER_RAIN_THUNDERSTORM'))) {
    state.incrementGameStat(define('GAME_STAT_GOT_RAINED_ON'));
  }
}

/** SetSavedWeather (`setweather`) */
export function SetSavedWeather(weather: number): void {
  const oldWeather = state.weather;
  state.weather = TranslateWeatherNum(weather);
  UpdateRainCounter(state.weather, oldWeather);
}

/** GetSav1Weather */
export function GetSav1Weather(): number {
  return state.weather;
}

/** gMapHeader.weather of the current map. */
let mapHeaderWeather = 0;

/** LoadCurrentMapData / LoadSaveblockMapHeader: the current map header's weather. */
export function SetMapHeaderWeather(weather: number): void {
  mapHeaderWeather = weather;
}

/** SetSavedWeatherFromCurrMapHeader (map loads, `resetweather`) */
export function SetSavedWeatherFromCurrMapHeader(): void {
  const oldWeather = state.weather;
  state.weather = TranslateWeatherNum(mapHeaderWeather);
  UpdateRainCounter(state.weather, oldWeather);
}

/** DoCurrentWeather (`doweather`, a map connection): change to the saved weather the usual way. */
export function DoCurrentWeather(): void {
  SetNextWeather(GetSav1Weather());
}

/** ResumePausedWeather (ResumeMap): the saved weather at once. */
export function ResumePausedWeather(): void {
  SetCurrentAndNextWeather(GetSav1Weather());
}

// ------------------------------------------------------------------ dev

export interface WeatherProbe {
  currWeather: number;
  nextWeather: number;
  savedWeather: number;
  gammaIndex: number;
  gammaTargetIndex: number;
  palProcessingState: number;
  task: string | undefined;
  /** The gamma index the field's sprite sheets are shifted with. */
  objGammaIndex: number;
  /** BLDALPHA's coefficients and the fog's scroll (fogHScrollPosX; undefined without its sprites). */
  blendEVA: number;
  blendEVB: number;
  fogHScrollPosX: number | undefined;
  /** The weathers' init / finish steps (the thunderstorm's TSTORM_STATE_*), and the rain's and thunder's fields. */
  initStep: number;
  finishStep: number;
  weatherGfxLoaded: boolean;
  rainSpriteCount: number;
  curRainSpriteIndex: number;
  targetRainSpriteCount: number;
  isDownpour: number;
  rainStrength: number;
  thunderDelay: number;
  thunderCounter: number;
  thunderTriggered: boolean;
}

/** Dev: the weather's state, for `__test.weather()`. */
export function weatherProbe(): WeatherProbe {
  return {
    currWeather: sWeather.currWeather,
    nextWeather: sWeather.nextWeather,
    savedWeather: state.weather,
    gammaIndex: sWeather.gammaIndex,
    gammaTargetIndex: sWeather.gammaTargetIndex,
    palProcessingState: sWeather.palProcessingState,
    task,
    objGammaIndex,
    blendEVA: sWeather.currBlendEVA,
    blendEVB: sWeather.currBlendEVB,
    fogHScrollPosX: fogHorizontalScrollPosX(),
    initStep: sWeather.initStep,
    finishStep: sWeather.finishStep,
    weatherGfxLoaded: sWeather.weatherGfxLoaded,
    rainSpriteCount: sWeather.rainSpriteCount,
    curRainSpriteIndex: sWeather.curRainSpriteIndex,
    targetRainSpriteCount: sWeather.targetRainSpriteCount,
    isDownpour: sWeather.isDownpour,
    rainStrength: sWeather.rainStrength,
    thunderDelay: sWeather.thunderDelay,
    thunderCounter: sWeather.thunderCounter,
    thunderTriggered: sWeather.thunderTriggered,
  };
}

/** Unit tests: BuildGammaShiftTables' two tables. */
export function gammaShiftTables(): { gammaShifts: Uint8Array[]; altGammaShifts: Uint8Array[] } {
  BuildGammaShiftTables();
  return { gammaShifts: sWeather.gammaShifts, altGammaShifts: sWeather.altGammaShifts };
}
