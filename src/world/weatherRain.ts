// field_weather_effects.c's rain weathers: WEATHER_RAIN (Rain_*), WEATHER_RAIN_THUNDERSTORM (Thunderstorm_*) and
// WEATHER_DOWNPOUR (Downpour_InitVars / _InitAll with Thunderstorm_Main / _Finish, as sWeatherFuncs has them): the 24
// rain sprites (sRainSpriteTemplate, StartRainSpriteFall, UpdateRainSprite, WaitRainSprite, InitRainSpriteMovement,
// CreateRainSprite, UpdateVisibleRainSprites, DestroyRainSprites, the splash anims), the thunderstorm's lightning
// (the gamma flashes through WeatherShiftGammaIfPalStateIdle / WeatherBeginGammaFade) and its thunder
// (SetThunderCounter, UpdateThunderSound: SE_THUNDER / SE_THUNDER2), and the SE3 loops their InitVars start
// (SetRainStrengthFromSoundEffect). No FRLG map or script reaches them; `setweather` + `doweather` from a dev script
// or the test hooks (`__test.doWeather`) do. The sprites live in world/weatherSprites.ts; world/weather.ts runs the
// callbacks from its sWeatherFuncs rows (`PORTED`). No Phaser.

import { IsSEPlaying, PlaySE } from '../gba/sound';
import { ANIMCMD_END, ANIMCMD_FRAME, ANIMCMD_JUMP, gDummySpriteAffineAnimTable, oam, SPRITE_SHAPE, ST_OAM_OBJ_NORMAL, StartSpriteAnim, type Sprite, type SpriteTemplate } from '../gba/sprite';
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from '../gba/hw';
import { random } from '../util/random';
import { state } from '../battle/env';
import {
  gWeatherPtr,
  SetRainStrengthFromSoundEffect,
  spriteCoordOffsetX,
  spriteCoordOffsetY,
  WEATHER_PAL_STATE_CHANGING_WEATHER,
  WEATHER_PAL_STATE_IDLE,
  WeatherBeginGammaFade,
  WeatherShiftGammaIfPalStateIdle,
  type WeatherCallbacks,
} from './weather';
import { CreateSpriteAtEnd, DestroySprite, FreeSpriteTilesByTag, GFXTAG_RAIN, gWeatherSprites, LoadSpriteSheet, MAX_SPRITES, PALTAG_WEATHER, type WeatherSpriteSheet } from './weatherSprites';

const define = (name: string) => state.defines.require(name);

// ------------------------------------------------------------------ WEATHER_RAIN

const sRainSpriteCoords: readonly (readonly [number, number])[] = [
  [0, 0], [0, 160], [0, 64], [144, 224], [144, 128], [32, 32], [32, 192], [32, 96], [72, 128], [72, 32], [72, 192], [216, 96],
  [216, 0], [104, 160], [104, 64], [104, 224], [144, 0], [144, 160], [144, 64], [32, 224], [32, 128], [72, 32], [72, 192], [48, 96],
];

/** sRainSpriteOamData: 16x32, priority 1, ST_OAM_OBJ_NORMAL */
const [RAIN_SHAPE, RAIN_SIZE] = SPRITE_SHAPE['16x32'];
const sRainSpriteOamData = oam({ objMode: ST_OAM_OBJ_NORMAL, shape: RAIN_SHAPE, size: RAIN_SIZE, priority: 1, paletteNum: 2 });

const sRainSpriteAnimCmds = [
  [ANIMCMD_FRAME(0, 16), ANIMCMD_JUMP(0)], // sRainSpriteFallAnimCmd
  [ANIMCMD_FRAME(8, 3), ANIMCMD_FRAME(32, 2), ANIMCMD_FRAME(40, 2), ANIMCMD_END], // sRainSpriteSplashAnimCmd
  [ANIMCMD_FRAME(8, 3), ANIMCMD_FRAME(16, 3), ANIMCMD_FRAME(24, 4), ANIMCMD_END], // sRainSpriteHeavySplashAnimCmd
];

const sRainSpriteTemplate: SpriteTemplate = {
  tileTag: GFXTAG_RAIN,
  paletteTag: PALTAG_WEATHER,
  oam: sRainSpriteOamData,
  anims: sRainSpriteAnimCmds,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: (sprite) => UpdateRainSprite(sprite),
};

/** sRainSpriteMovement: Q28.4 x / y steps a frame (rain, downpour). */
const sRainSpriteMovement = [
  [-0x68, 0xd0],
  [-0xa0, 0x140],
];

/** sRainSpriteFallingDurations: the frames a raindrop falls before it splashes; the most it waits at the first spawn. */
const sRainSpriteFallingDurations = [
  [18, 7],
  [12, 10],
];

const sRainSpriteSheet: WeatherSpriteSheet = { data: 'gWeatherRainTiles', size: 0x0600, tag: GFXTAG_RAIN };

export function Rain_InitVars(): void {
  gWeatherPtr.initStep = 0;
  gWeatherPtr.weatherGfxLoaded = false;
  gWeatherPtr.rainSpriteVisibleCounter = 0;
  gWeatherPtr.rainSpriteVisibleDelay = 8;
  gWeatherPtr.isDownpour = 0;
  gWeatherPtr.targetRainSpriteCount = 10;
  gWeatherPtr.gammaTargetIndex = 3;
  gWeatherPtr.gammaStepDelay = 20;
  SetRainStrengthFromSoundEffect(define('SE_RAIN'));
}

export function Rain_InitAll(): void {
  Rain_InitVars();
  while (!gWeatherPtr.weatherGfxLoaded) Rain_Main();
}

export function Rain_Main(): void {
  switch (gWeatherPtr.initStep) {
    case 0:
      LoadRainSpriteSheet();
      gWeatherPtr.initStep++;
      break;
    case 1:
      if (!CreateRainSprite()) gWeatherPtr.initStep++;
      break;
    case 2:
      if (!UpdateVisibleRainSprites()) {
        gWeatherPtr.weatherGfxLoaded = true;
        gWeatherPtr.initStep++;
      }
      break;
  }
}

/** The rain weathers (Rain_Finish and Thunderstorm_Finish keep the sprites for each other). */
function isRainWeather(weather: number): boolean {
  return weather === define('WEATHER_RAIN') || weather === define('WEATHER_RAIN_THUNDERSTORM') || weather === define('WEATHER_DOWNPOUR');
}

export function Rain_Finish(): boolean {
  switch (gWeatherPtr.finishStep) {
    case 0:
      if (isRainWeather(gWeatherPtr.nextWeather)) {
        gWeatherPtr.finishStep = 0xff;
        return false;
      }
      gWeatherPtr.targetRainSpriteCount = 0;
      gWeatherPtr.finishStep++;
    // fall through
    case 1:
      if (!UpdateVisibleRainSprites()) {
        DestroyRainSprites();
        gWeatherPtr.finishStep++;
        return false;
      }
      return true;
  }
  return false;
}

// sprite->data[] of a raindrop
const tCounter = 0;
const tRandom = 1;
const tPosX = 2;
const tPosY = 3;
const tState = 4;
const tActive = 5;
const tWaiting = 6;

/** RAND_MULT (random.h), for ISO_RANDOMIZE2 */
const RAND_MULT = 1103515245;

function StartRainSpriteFall(sprite: Sprite): void {
  const d = sprite.data;
  if (d[tRandom] === 0) d[tRandom] = 361;
  const rand = (Math.imul(RAND_MULT, d[tRandom]) + 12345) >>> 0; // ISO_RANDOMIZE2
  d[tRandom] = ((rand & 0x7fff0000) >>> 16) % 600;
  const numFallingFrames = sRainSpriteFallingDurations[gWeatherPtr.isDownpour][0];
  const tileX = d[tRandom] % 30;
  const tileY = Math.floor(d[tRandom] / 30);
  // tileX * 8 and tileY * 8 as Q28.4 fixed point
  d[tPosX] = tileX << 7;
  d[tPosY] = tileY << 7;
  // "Rewind" the rain sprites, from their ending position
  d[tPosX] -= sRainSpriteMovement[gWeatherPtr.isDownpour][0] * numFallingFrames;
  d[tPosY] -= sRainSpriteMovement[gWeatherPtr.isDownpour][1] * numFallingFrames;
  StartSpriteAnim(sprite, 0);
  d[tState] = 0;
  sprite.coordOffsetEnabled = false;
  d[tCounter] = numFallingFrames;
}

function UpdateRainSprite(sprite: Sprite): void {
  const d = sprite.data;
  if (d[tState] === 0) {
    // The raindrop is falling
    d[tPosX] += sRainSpriteMovement[gWeatherPtr.isDownpour][0];
    d[tPosY] += sRainSpriteMovement[gWeatherPtr.isDownpour][1];
    sprite.x = d[tPosX] >> 4;
    sprite.y = d[tPosY] >> 4;
    sprite.invisible = !(d[tActive] && sprite.x >= -8 && sprite.x <= DISPLAY_WIDTH + 8 && sprite.y >= -16 && sprite.y <= DISPLAY_HEIGHT + 16);
    if (--d[tCounter] === 0) {
      // The raindrop splashes on the ground, which scrolls with the camera from now on
      StartSpriteAnim(sprite, gWeatherPtr.isDownpour + 1);
      d[tState] = 1;
      sprite.x -= spriteCoordOffsetX();
      sprite.y -= spriteCoordOffsetY();
      sprite.coordOffsetEnabled = true;
    }
  } else if (sprite.animEnded) {
    // The splash ended
    sprite.invisible = true;
    StartRainSpriteFall(sprite);
  }
}

function WaitRainSprite(sprite: Sprite): void {
  if (sprite.data[tCounter] === 0) {
    StartRainSpriteFall(sprite);
    sprite.callback = UpdateRainSprite;
  } else {
    sprite.data[tCounter]--;
  }
}

function InitRainSpriteMovement(sprite: Sprite, val: number): void {
  const [numFallingFrames, maxWait] = sRainSpriteFallingDurations[gWeatherPtr.isDownpour];
  const numAdvanceRng = Math.floor(val / (maxWait + numFallingFrames));
  const frameVal = val % (maxWait + numFallingFrames);
  for (let i = 0; i < numAdvanceRng; i++) StartRainSpriteFall(sprite);
  if (frameVal < numFallingFrames) {
    for (let i = 0; i < frameVal; i++) UpdateRainSprite(sprite);
    sprite.data[tWaiting] = 0;
  } else {
    sprite.data[tCounter] = frameVal - numFallingFrames;
    sprite.invisible = true;
    sprite.data[tWaiting] = 1;
  }
}

function LoadRainSpriteSheet(): void {
  LoadSpriteSheet(sRainSpriteSheet);
}

/** One raindrop a frame (TRUE while there are more to create). */
function CreateRainSprite(): boolean {
  const MAX_RAIN_SPRITES = define('MAX_RAIN_SPRITES');
  if (gWeatherPtr.rainSpriteCount === MAX_RAIN_SPRITES) return false;
  const spriteIndex = gWeatherPtr.rainSpriteCount;
  const [x, y] = sRainSpriteCoords[spriteIndex];
  const spriteId = CreateSpriteAtEnd(sRainSpriteTemplate, x, y, 78);
  if (spriteId !== MAX_SPRITES) {
    const sprite = gWeatherSprites[spriteId];
    sprite.data[tActive] = 0;
    sprite.data[tRandom] = spriteIndex * 145;
    while (sprite.data[tRandom] >= 600) sprite.data[tRandom] -= 600;
    StartRainSpriteFall(sprite);
    InitRainSpriteMovement(sprite, spriteIndex * 9);
    sprite.invisible = true;
    gWeatherPtr.rainSprites[spriteIndex] = sprite;
  } else {
    gWeatherPtr.rainSprites[spriteIndex] = null;
  }
  if (++gWeatherPtr.rainSpriteCount === MAX_RAIN_SPRITES) {
    for (let i = 0; i < MAX_RAIN_SPRITES; i++) {
      const s = gWeatherPtr.rainSprites[i];
      if (s) s.callback = s.data[tWaiting] ? WaitRainSprite : UpdateRainSprite;
    }
    return false;
  }
  return true;
}

/** One raindrop more (or less) visible every rainSpriteVisibleDelay + 1 frames until targetRainSpriteCount. */
function UpdateVisibleRainSprites(): boolean {
  if (gWeatherPtr.curRainSpriteIndex === gWeatherPtr.targetRainSpriteCount) return false;
  if (++gWeatherPtr.rainSpriteVisibleCounter > gWeatherPtr.rainSpriteVisibleDelay) {
    gWeatherPtr.rainSpriteVisibleCounter = 0;
    if (gWeatherPtr.curRainSpriteIndex < gWeatherPtr.targetRainSpriteCount) {
      gWeatherPtr.rainSprites[gWeatherPtr.curRainSpriteIndex++]!.data[tActive] = 1;
    } else {
      gWeatherPtr.curRainSpriteIndex--;
      const s = gWeatherPtr.rainSprites[gWeatherPtr.curRainSpriteIndex]!;
      s.data[tActive] = 0;
      s.invisible = true;
    }
  }
  return true;
}

function DestroyRainSprites(): void {
  for (let i = 0; i < gWeatherPtr.rainSpriteCount; i++) {
    const s = gWeatherPtr.rainSprites[i];
    if (s) DestroySprite(s);
  }
  gWeatherPtr.rainSpriteCount = 0;
  FreeSpriteTilesByTag(GFXTAG_RAIN);
}

export const RAIN: WeatherCallbacks = { initVars: Rain_InitVars, main: Rain_Main, initAll: Rain_InitAll, finish: Rain_Finish };

// ------------------------------------------------------------------ WEATHER_RAIN_THUNDERSTORM

// The thunderstorm's states: the first four run once while it sets up, then it loops through the rest
const TSTORM_STATE_LOAD_RAIN = 0;
const TSTORM_STATE_CREATE_RAIN = 1;
const TSTORM_STATE_INIT_RAIN = 2;
const TSTORM_STATE_WAIT_CHANGE = 3;
const TSTORM_STATE_LOOP_START = 4;
const TSTORM_STATE_LOOP_WAIT = 5;
const TSTORM_STATE_INIT_THUNDER_SHORT_1 = 6;
const TSTORM_STATE_INIT_THUNDER_SHORT_2 = 7;
const TSTORM_STATE_TRY_THUNDER_SHORT = 8;
const TSTORM_STATE_TRY_NEW_THUNDER = 9;
const TSTORM_STATE_WAIT_THUNDER_SHORT = 10;
const TSTORM_STATE_INIT_THUNDER_LONG = 11;
const TSTORM_STATE_WAIT_THUNDER_LONG = 12;
const TSTORM_STATE_FADE_THUNDER_LONG = 13;
const TSTORM_STATE_END_THUNDER_LONG = 14;

export function Thunderstorm_InitVars(): void {
  gWeatherPtr.initStep = TSTORM_STATE_LOAD_RAIN;
  gWeatherPtr.weatherGfxLoaded = false;
  gWeatherPtr.rainSpriteVisibleCounter = 0;
  gWeatherPtr.rainSpriteVisibleDelay = 4;
  gWeatherPtr.isDownpour = 0;
  gWeatherPtr.targetRainSpriteCount = 16;
  gWeatherPtr.gammaTargetIndex = 3;
  gWeatherPtr.gammaStepDelay = 20;
  gWeatherPtr.weatherGfxLoaded = false; // duplicate assignment
  gWeatherPtr.thunderTriggered = false;
  SetRainStrengthFromSoundEffect(define('SE_THUNDERSTORM'));
}

export function Thunderstorm_InitAll(): void {
  Thunderstorm_InitVars();
  while (!gWeatherPtr.weatherGfxLoaded) Thunderstorm_Main();
}

// ------------------------------------------------------------------ WEATHER_DOWNPOUR

export function Downpour_InitVars(): void {
  gWeatherPtr.initStep = TSTORM_STATE_LOAD_RAIN;
  gWeatherPtr.weatherGfxLoaded = false;
  gWeatherPtr.rainSpriteVisibleCounter = 0;
  gWeatherPtr.rainSpriteVisibleDelay = 4;
  gWeatherPtr.isDownpour = 1;
  gWeatherPtr.targetRainSpriteCount = 24;
  gWeatherPtr.gammaTargetIndex = 3;
  gWeatherPtr.gammaStepDelay = 20;
  gWeatherPtr.weatherGfxLoaded = false; // duplicate assignment
  SetRainStrengthFromSoundEffect(define('SE_DOWNPOUR'));
}

export function Downpour_InitAll(): void {
  Downpour_InitVars();
  while (!gWeatherPtr.weatherGfxLoaded) Thunderstorm_Main();
}

export function Thunderstorm_Main(): void {
  UpdateThunderSound();
  const w = gWeatherPtr;
  switch (w.initStep) {
    case TSTORM_STATE_LOAD_RAIN:
      LoadRainSpriteSheet();
      w.initStep++;
      break;
    case TSTORM_STATE_CREATE_RAIN:
      if (!CreateRainSprite()) w.initStep++;
      break;
    case TSTORM_STATE_INIT_RAIN:
      if (!UpdateVisibleRainSprites()) {
        w.weatherGfxLoaded = true;
        w.initStep++;
      }
      break;
    case TSTORM_STATE_WAIT_CHANGE:
      if (w.palProcessingState !== WEATHER_PAL_STATE_CHANGING_WEATHER) w.initStep = TSTORM_STATE_INIT_THUNDER_SHORT_1;
      break;
    case TSTORM_STATE_LOOP_START:
      w.thunderAllowEnd = true;
      w.thunderDelay = (random() % 360) + 360;
      w.initStep++;
    // fall through
    case TSTORM_STATE_LOOP_WAIT:
      // Wait 360-720 frames before trying thunder again
      if (--w.thunderDelay === 0) w.initStep++;
      break;
    case TSTORM_STATE_INIT_THUNDER_SHORT_1:
      w.thunderAllowEnd = true;
      w.thunderSkipShort = random() % 2;
      w.initStep++;
      break;
    case TSTORM_STATE_INIT_THUNDER_SHORT_2:
      w.thunderShortRetries = (random() & 1) + 1;
      w.initStep++;
    // fall through
    case TSTORM_STATE_TRY_THUNDER_SHORT:
      WeatherShiftGammaIfPalStateIdle(19);
      if (!w.thunderSkipShort && w.thunderShortRetries === 1) SetThunderCounter(20); // a short thunder
      w.thunderDelay = (random() % 3) + 6;
      w.initStep++;
      break;
    case TSTORM_STATE_TRY_NEW_THUNDER:
      if (--w.thunderDelay === 0) {
        WeatherShiftGammaIfPalStateIdle(3);
        w.thunderAllowEnd = true;
        if (--w.thunderShortRetries !== 0) {
          // Try a short thunder again
          w.thunderDelay = (random() % 16) + 60;
          w.initStep = TSTORM_STATE_WAIT_THUNDER_SHORT;
        } else if (!w.thunderSkipShort) {
          // No more thunder: back to the loop's start
          w.initStep = TSTORM_STATE_LOOP_START;
        } else {
          // A long thunder
          w.initStep = TSTORM_STATE_INIT_THUNDER_LONG;
        }
      }
      break;
    case TSTORM_STATE_WAIT_THUNDER_SHORT:
      if (--w.thunderDelay === 0) w.initStep = TSTORM_STATE_TRY_THUNDER_SHORT;
      break;
    case TSTORM_STATE_INIT_THUNDER_LONG:
      w.thunderDelay = (random() % 16) + 60;
      w.initStep++;
      break;
    case TSTORM_STATE_WAIT_THUNDER_LONG:
      if (--w.thunderDelay === 0) {
        // The long thunder
        SetThunderCounter(100);
        WeatherShiftGammaIfPalStateIdle(19);
        w.thunderDelay = (random() & 0xf) + 30;
        w.initStep++;
      }
      break;
    case TSTORM_STATE_FADE_THUNDER_LONG:
      if (--w.thunderDelay === 0) {
        WeatherBeginGammaFade(19, 3, 5);
        w.initStep++;
      }
      break;
    case TSTORM_STATE_END_THUNDER_LONG:
      if (w.palProcessingState === WEATHER_PAL_STATE_IDLE) {
        w.thunderAllowEnd = true;
        w.initStep = TSTORM_STATE_LOOP_START;
      }
      break;
  }
}

export function Thunderstorm_Finish(): boolean {
  const w = gWeatherPtr;
  switch (w.finishStep) {
    case 0:
      w.thunderAllowEnd = false;
      w.finishStep++;
    // fall through
    case 1:
      Thunderstorm_Main();
      if (w.thunderAllowEnd) {
        if (isRainWeather(w.nextWeather)) return false;
        w.targetRainSpriteCount = 0;
        w.finishStep++;
      }
      break;
    case 2:
      if (!UpdateVisibleRainSprites()) {
        DestroyRainSprites();
        w.thunderTriggered = false;
        w.finishStep++;
        return false;
      }
      break;
    default:
      return false;
  }
  return true;
}

/** SetThunderCounter: a thunderclap within `max` frames, unless one is on its way. */
function SetThunderCounter(max: number): void {
  if (!gWeatherPtr.thunderTriggered) {
    gWeatherPtr.thunderCounter = random() % max;
    gWeatherPtr.thunderTriggered = true;
  }
}

/** UpdateThunderSound: the thunderclap once its counter runs out and SE1 / SE2 are free. */
function UpdateThunderSound(): void {
  if (gWeatherPtr.thunderTriggered) {
    if (gWeatherPtr.thunderCounter === 0) {
      if (IsSEPlaying()) return;
      if (random() & 1) PlaySE(define('SE_THUNDER'));
      else PlaySE(define('SE_THUNDER2'));
      gWeatherPtr.thunderTriggered = false;
    } else {
      gWeatherPtr.thunderCounter--;
    }
  }
}

export const THUNDERSTORM: WeatherCallbacks = { initVars: Thunderstorm_InitVars, main: Thunderstorm_Main, initAll: Thunderstorm_InitAll, finish: Thunderstorm_Finish };
export const DOWNPOUR: WeatherCallbacks = { initVars: Downpour_InitVars, main: Thunderstorm_Main, initAll: Downpour_InitAll, finish: Thunderstorm_Finish };
