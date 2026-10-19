// WEATHER_FOG_DIAGONAL: field_weather_effects.c's FogDiagonal_* (UpdateFogDiagonalMovement, CreateFogDiagonalSprites,
// DestroyFogDiagonalSprites, UpdateFogDiagonalSprite). Twenty 64x64 ST_OAM_OBJ_BLEND sprites at priority 2 in 5
// columns and 4 rows, drifting a pixel left every 3 frames and down every 5 on top of the camera's scroll, blended
// in to BLDALPHA (12, 8) a step every 9 frames. No FRLG map or script reaches it; `setweather` + `doweather` from a
// dev script or the test hooks (`__test.doWeather`) do. The sprites live in world/weatherSprites.ts; world/weather.ts
// runs the callbacks from its sWeatherFuncs rows. No Phaser.

import { DISPLAY_WIDTH } from '../gba/hw';
import { ANIMCMD_END, ANIMCMD_FRAME, gDummySpriteAffineAnimTable, oam, SPRITE_SHAPE, ST_OAM_OBJ_BLEND, type Sprite, type SpriteTemplate } from '../gba/sprite';
import { state } from '../battle/env';
import { gWeatherPtr, spriteCoordOffsetX, spriteCoordOffsetY, Weather_SetBlendCoeffs, Weather_SetTargetBlendCoeffs, Weather_UpdateBlend, type WeatherCallbacks } from './weather';
import { CreateSpriteAtEnd, DestroySprite, FreeSpriteTilesByTag, GFXTAG_FOG_D, gWeatherSprites, LoadSpriteSheet, MAX_SPRITES, PALTAG_WEATHER, type WeatherSpriteSheet } from './weatherSprites';

const define = (name: string) => state.defines.require(name);

export function FogDiagonal_InitVars(): void {
  const w = gWeatherPtr;
  w.initStep = 0;
  w.weatherGfxLoaded = false;
  w.gammaTargetIndex = 0;
  w.gammaStepDelay = 20;
  w.fogHScrollCounter = 0;
  w.fogHScrollOffset = 1;
  if (!w.fogDSpritesCreated) {
    w.fogDScrollXCounter = 0;
    w.fogDScrollYCounter = 0;
    w.fogDXOffset = 0;
    w.fogDYOffset = 0;
    w.fogDBaseSpritesX = 0;
    w.fogDPosY = 0;
    Weather_SetBlendCoeffs(0, 16);
  }
}

export function FogDiagonal_InitAll(): void {
  FogDiagonal_InitVars();
  while (!gWeatherPtr.weatherGfxLoaded) FogDiagonal_Main();
}

export function FogDiagonal_Main(): void {
  UpdateFogDiagonalMovement();
  switch (gWeatherPtr.initStep) {
    case 0:
      CreateFogDiagonalSprites();
      gWeatherPtr.initStep++;
      break;
    case 1:
      Weather_SetTargetBlendCoeffs(12, 8, 8);
      gWeatherPtr.initStep++;
      break;
    case 2:
      if (!Weather_UpdateBlend()) break;
      gWeatherPtr.weatherGfxLoaded = true;
      gWeatherPtr.initStep++;
      break;
  }
}

export function FogDiagonal_Finish(): boolean {
  UpdateFogDiagonalMovement();
  switch (gWeatherPtr.finishStep) {
    case 0:
      Weather_SetTargetBlendCoeffs(0, 16, 1);
      gWeatherPtr.finishStep++;
      break;
    case 1:
      if (!Weather_UpdateBlend()) break;
      gWeatherPtr.finishStep++;
      break;
    case 2:
      DestroyFogDiagonalSprites();
      gWeatherPtr.finishStep++;
      break;
    default:
      return false;
  }
  return true;
}

export const FOG_DIAGONAL: WeatherCallbacks = { initVars: FogDiagonal_InitVars, main: FogDiagonal_Main, initAll: FogDiagonal_InitAll, finish: FogDiagonal_Finish };

/** The fog's drift (u16 fields): a pixel left every 3 frames and down every 5, on top of gSpriteCoordOffsetX / Y. */
function UpdateFogDiagonalMovement(): void {
  const w = gWeatherPtr;
  if (++w.fogDScrollXCounter > 2) {
    w.fogDXOffset = (w.fogDXOffset + 1) & 0xffff;
    w.fogDScrollXCounter = 0;
  }
  if (++w.fogDScrollYCounter > 4) {
    w.fogDYOffset = (w.fogDYOffset + 1) & 0xffff;
    w.fogDScrollYCounter = 0;
  }
  w.fogDBaseSpritesX = (spriteCoordOffsetX() - w.fogDXOffset) & 0xff;
  w.fogDPosY = (spriteCoordOffsetY() + w.fogDYOffset) & 0xffff;
}

const gFogDiagonalSpriteSheet: WeatherSpriteSheet = { data: 'gWeatherFogDiagonalTiles', size: 0x0800, tag: GFXTAG_FOG_D };

/** sFogDiagonalSpriteOamData: 64x64, priority 2, ST_OAM_OBJ_BLEND */
const [FOG_D_SHAPE, FOG_D_SIZE] = SPRITE_SHAPE['64x64'];
const sFogDiagonalSpriteOamData = oam({ objMode: ST_OAM_OBJ_BLEND, shape: FOG_D_SHAPE, size: FOG_D_SIZE, priority: 2 });

const sFogDiagonalSpriteAnimCmds = [[ANIMCMD_FRAME(0, 16), ANIMCMD_END]];

const sFogDiagonalSpriteTemplate: SpriteTemplate = {
  tileTag: GFXTAG_FOG_D,
  paletteTag: PALTAG_WEATHER,
  oam: sFogDiagonalSpriteOamData,
  anims: sFogDiagonalSpriteAnimCmds,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: (sprite) => UpdateFogDiagonalSprite(sprite),
};

// sprite->data[] of a fog sprite
const tSpriteColumn = 0;
const tSpriteRow = 1;

function CreateFogDiagonalSprites(): void {
  if (gWeatherPtr.fogDSpritesCreated) return;
  LoadSpriteSheet(gFogDiagonalSpriteSheet);
  for (let i = 0; i < define('NUM_FOG_DIAGONAL_SPRITES'); i++) {
    const spriteId = CreateSpriteAtEnd(sFogDiagonalSpriteTemplate, 0, Math.floor(i / 5) * 64, 0xff);
    if (spriteId !== MAX_SPRITES) {
      const sprite = gWeatherSprites[spriteId];
      sprite.data[tSpriteColumn] = i % 5;
      sprite.data[tSpriteRow] = Math.floor(i / 5);
      gWeatherPtr.fogDSprites[i] = sprite;
    } else {
      gWeatherPtr.fogDSprites[i] = null;
    }
  }
  gWeatherPtr.fogDSpritesCreated = true;
}

function DestroyFogDiagonalSprites(): void {
  if (!gWeatherPtr.fogDSpritesCreated) return;
  for (let i = 0; i < define('NUM_FOG_DIAGONAL_SPRITES'); i++) {
    const s = gWeatherPtr.fogDSprites[i];
    if (s) DestroySprite(s);
  }
  FreeSpriteTilesByTag(GFXTAG_FOG_D);
  gWeatherPtr.fogDSpritesCreated = false;
}

const s16 = (v: number) => (v << 16) >> 16;

/** UpdateFogDiagonalSprite: the column's x from fogDBaseSpritesX (wrapping round past the right edge), y2 = fogDPosY. */
function UpdateFogDiagonalSprite(sprite: Sprite): void {
  sprite.y2 = s16(gWeatherPtr.fogDPosY);
  sprite.x = gWeatherPtr.fogDBaseSpritesX + 32 + sprite.data[tSpriteColumn] * 64;
  if (sprite.x >= DISPLAY_WIDTH + 32) {
    sprite.x = gWeatherPtr.fogDBaseSpritesX + DISPLAY_WIDTH * 2 - (4 - sprite.data[tSpriteColumn]) * 64;
    sprite.x &= 0x1ff;
  }
}
