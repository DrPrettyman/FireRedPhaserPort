// field_weather_effects.c's WEATHER_VOLCANIC_ASH: Ash_InitVars / _InitAll / _Main / _Finish, LoadAshSpriteSheet,
// CreateAshSprites (20 64x64 ST_OAM_OBJ_BLEND sprites: 5 columns, 4 rows), DestroyAshSprites, UpdateAshSprite (the
// ash drifts down a pixel every 6 frames and scrolls with the camera, its columns wrapping round the screen's 240).
// The blend fades in from (EVA 0, EVB 16) to (16, 0), a step every 2 frames (Weather_SetTargetBlendCoeffs(16, 0, 1)),
// and back out on finish; no gamma shift, no sound. No FRLG map or script reaches it; `setweather` + `doweather` do.
// No Phaser.

import { DISPLAY_WIDTH } from '../gba/hw';
import { ANIMCMD_FRAME, ANIMCMD_JUMP, gDummySpriteAffineAnimTable, oam, SPRITE_SHAPE, ST_OAM_OBJ_BLEND, type Sprite, type SpriteTemplate } from '../gba/sprite';
import {
  gWeatherPtr,
  SetWeatherBldAlpha,
  spriteCoordOffsetX,
  spriteCoordOffsetY,
  Weather_SetBlendCoeffs,
  Weather_SetTargetBlendCoeffs,
  Weather_UpdateBlend,
  type WeatherCallbacks,
} from './weather';
import { CreateSpriteAtEnd, DestroySprite, FreeSpriteTilesByTag, GFXTAG_ASH, gWeatherSprites, LoadSpriteSheet, MAX_SPRITES, PALTAG_WEATHER, type WeatherSpriteSheet } from './weatherSprites';

/** include/constants/field_weather.h */
const NUM_ASH_SPRITES = 20;

const s16 = (v: number) => (v << 16) >> 16;

export function Ash_InitVars(): void {
  gWeatherPtr.initStep = 0;
  gWeatherPtr.weatherGfxLoaded = false;
  gWeatherPtr.gammaTargetIndex = 0;
  gWeatherPtr.gammaStepDelay = 20;
  gWeatherPtr.ashUnused = 20; // Never read
  if (!gWeatherPtr.ashSpritesCreated) {
    Weather_SetBlendCoeffs(0, 16);
    SetWeatherBldAlpha(64, 63); // These aren't valid blend coefficients!
  }
}

export function Ash_InitAll(): void {
  Ash_InitVars();
  while (!gWeatherPtr.weatherGfxLoaded) Ash_Main();
}

export function Ash_Main(): void {
  const w = gWeatherPtr;
  w.ashBaseSpritesX = spriteCoordOffsetX() & 0x1ff;
  while (w.ashBaseSpritesX >= DISPLAY_WIDTH) w.ashBaseSpritesX -= DISPLAY_WIDTH;
  switch (w.initStep) {
    case 0:
      LoadAshSpriteSheet();
      w.initStep++;
      break;
    case 1:
      if (!w.ashSpritesCreated) CreateAshSprites();
      Weather_SetTargetBlendCoeffs(16, 0, 1);
      w.initStep++;
      break;
    case 2:
      if (Weather_UpdateBlend()) {
        w.weatherGfxLoaded = true;
        w.initStep++;
      }
      break;
    default:
      Weather_UpdateBlend();
      break;
  }
}

export function Ash_Finish(): boolean {
  switch (gWeatherPtr.finishStep) {
    case 0:
      Weather_SetTargetBlendCoeffs(0, 16, 1);
      gWeatherPtr.finishStep++;
      break;
    case 1:
      if (Weather_UpdateBlend()) {
        DestroyAshSprites();
        gWeatherPtr.finishStep++;
      }
      break;
    case 2:
      SetWeatherBldAlpha(0, 0);
      gWeatherPtr.finishStep++;
      return false;
    default:
      return false;
  }
  return true;
}

const sAshSpriteSheet: WeatherSpriteSheet = { data: 'gWeatherAshTiles', size: 0x1000, tag: GFXTAG_ASH };

function LoadAshSpriteSheet(): void {
  LoadSpriteSheet(sAshSpriteSheet);
}

/** sAshSpriteOamData: 64x64, priority 1, ST_OAM_OBJ_BLEND */
const [ASH_SHAPE, ASH_SIZE] = SPRITE_SHAPE['64x64'];
const sAshSpriteOamData = oam({ objMode: ST_OAM_OBJ_BLEND, shape: ASH_SHAPE, size: ASH_SIZE, priority: 1, paletteNum: 15 });

const sAshSpriteAnimCmds = [[ANIMCMD_FRAME(0, 60), ANIMCMD_FRAME(64, 60), ANIMCMD_JUMP(0)]];

const sAshSpriteTemplate: SpriteTemplate = {
  tileTag: GFXTAG_ASH,
  paletteTag: PALTAG_WEATHER,
  oam: sAshSpriteOamData,
  anims: sAshSpriteAnimCmds,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: (sprite) => UpdateAshSprite(sprite),
};

// sprite->data[] of an ash sprite
const tOffsetY = 0;
const tCounterY = 1;
const tSpriteColumn = 2;
const tSpriteRow = 3;

function CreateAshSprites(): void {
  if (gWeatherPtr.ashSpritesCreated) return;
  for (let i = 0; i < NUM_ASH_SPRITES; i++) {
    const spriteId = CreateSpriteAtEnd(sAshSpriteTemplate, 0, 0, 0x4e);
    if (spriteId !== MAX_SPRITES) {
      const sprite = gWeatherSprites[spriteId];
      sprite.data[tCounterY] = 0;
      sprite.data[tSpriteColumn] = (i % 5) & 0xff;
      sprite.data[tSpriteRow] = Math.floor(i / 5) & 0xff;
      sprite.data[tOffsetY] = sprite.data[tSpriteRow] * 64 + 32;
      gWeatherPtr.ashSprites[i] = sprite;
    } else {
      gWeatherPtr.ashSprites[i] = null;
    }
  }
  gWeatherPtr.ashSpritesCreated = true;
}

function DestroyAshSprites(): void {
  if (!gWeatherPtr.ashSpritesCreated) return;
  for (let i = 0; i < NUM_ASH_SPRITES; i++) {
    const s = gWeatherPtr.ashSprites[i];
    if (s) DestroySprite(s);
  }
  FreeSpriteTilesByTag(GFXTAG_ASH);
  gWeatherPtr.ashSpritesCreated = false;
}

function UpdateAshSprite(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[tCounterY] > 5) {
    d[tCounterY] = 0;
    d[tOffsetY]++;
  }
  sprite.y = s16(spriteCoordOffsetY() + d[tOffsetY]);
  sprite.x = s16(gWeatherPtr.ashBaseSpritesX + 32 + d[tSpriteColumn] * 64);
  if (sprite.x >= DISPLAY_WIDTH + 32) {
    sprite.x = s16(gWeatherPtr.ashBaseSpritesX + DISPLAY_WIDTH * 2 - (4 - d[tSpriteColumn]) * 64);
    sprite.x &= 0x1ff;
  }
}

export const ASH: WeatherCallbacks = { initVars: Ash_InitVars, main: Ash_Main, initAll: Ash_InitAll, finish: Ash_Finish };
