// WEATHER_SUNNY_CLOUDS: field_weather_effects.c's Clouds_* (CreateCloudSprites, DestroyCloudSprites,
// UpdateCloudSprite, sCloudSpriteMapCoords, gCloudsWeatherPalette). Three 64x64 ST_OAM_OBJ_BLEND clouds at priority 3
// (under the objects, over the BGs as BLDALPHA blends them: Weather_SetTargetBlendCoeffs(12, 8, 1)), placed on the
// map's grid (the coordinates are R/S's lower Route 120) and drifting a pixel left every 2 frames. No FRLG map or
// script reaches it; `setweather` + `doweather` from a dev script or the test hooks (`__test.doWeather`) do. The
// sprites live in world/weatherSprites.ts; world/weather.ts runs the callbacks from its sWeatherFuncs rows. No Phaser.

import { ANIMCMD_END, ANIMCMD_FRAME, gDummySpriteAffineAnimTable, oam, SPRITE_SHAPE, ST_OAM_OBJ_BLEND, type Sprite, type SpriteTemplate } from '../gba/sprite';
import { state } from '../battle/env';
import { gWeatherPtr, LoadCustomWeatherSpritePalette, Weather_SetBlendCoeffs, Weather_SetTargetBlendCoeffs, Weather_UpdateBlend, weatherHost, type WeatherCallbacks } from './weather';
import { CreateSprite, DestroySprite, FreeSpriteTilesByTag, GFXTAG_CLOUD, gWeatherSprites, LoadSpriteSheet, MAX_SPRITES, PALTAG_WEATHER, type WeatherSpriteSheet } from './weatherSprites';

const define = (name: string) => state.defines.require(name);

/** The clouds are positioned on the map's grid (the C: "These coordinates are for the lower half of Route 120"). */
export const sCloudSpriteMapCoords: readonly (readonly [number, number])[] = [
  [0, 66],
  [5, 73],
  [10, 78],
];

const sCloudSpriteSheet: WeatherSpriteSheet = { data: 'gWeatherCloudTiles', size: 0x0800, tag: GFXTAG_CLOUD };

/** sCloudSpriteOamData: 64x64, priority 3, ST_OAM_OBJ_BLEND */
const [CLOUD_SHAPE, CLOUD_SIZE] = SPRITE_SHAPE['64x64'];
const sCloudSpriteOamData = oam({ objMode: ST_OAM_OBJ_BLEND, shape: CLOUD_SHAPE, size: CLOUD_SIZE, priority: 3 });

const sCloudSpriteAnimCmds = [[ANIMCMD_FRAME(0, 16), ANIMCMD_END]];

const sCloudSpriteTemplate: SpriteTemplate = {
  tileTag: GFXTAG_CLOUD,
  paletteTag: PALTAG_WEATHER,
  oam: sCloudSpriteOamData,
  anims: sCloudSpriteAnimCmds,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: (sprite) => UpdateCloudSprite(sprite),
};

export function Clouds_InitVars(): void {
  gWeatherPtr.gammaTargetIndex = 0;
  gWeatherPtr.gammaStepDelay = 20;
  gWeatherPtr.weatherGfxLoaded = false;
  gWeatherPtr.initStep = 0;
  if (!gWeatherPtr.cloudSpritesCreated) Weather_SetBlendCoeffs(0, 16);
}

export function Clouds_InitAll(): void {
  Clouds_InitVars();
  while (!gWeatherPtr.weatherGfxLoaded) Clouds_Main();
}

export function Clouds_Main(): void {
  switch (gWeatherPtr.initStep) {
    case 0:
      CreateCloudSprites();
      gWeatherPtr.initStep++;
      break;
    case 1:
      Weather_SetTargetBlendCoeffs(12, 8, 1);
      gWeatherPtr.initStep++;
      break;
    case 2:
      if (Weather_UpdateBlend()) {
        gWeatherPtr.weatherGfxLoaded = true;
        gWeatherPtr.initStep++;
      }
      break;
  }
}

export function Clouds_Finish(): boolean {
  switch (gWeatherPtr.finishStep) {
    case 0:
      Weather_SetTargetBlendCoeffs(0, 16, 1);
      gWeatherPtr.finishStep++;
      return true;
    case 1:
      if (Weather_UpdateBlend()) {
        DestroyCloudSprites();
        gWeatherPtr.finishStep++;
      }
      return true;
  }
  return false;
}

export const CLOUDS: WeatherCallbacks = { initVars: Clouds_InitVars, main: Clouds_Main, initAll: Clouds_InitAll, finish: Clouds_Finish };

/** SetSpritePosToMapCoords (event_object_movement.c), through the field (0, 0 without one). */
function SetSpritePosToMapCoords(mapX: number, mapY: number): { x: number; y: number } {
  return weatherHost()?.mapCoordsToSpritePos?.(mapX, mapY) ?? { x: 0, y: 0 };
}

function CreateCloudSprites(): void {
  if (gWeatherPtr.cloudSpritesCreated) return;
  LoadSpriteSheet(sCloudSpriteSheet);
  LoadCustomWeatherSpritePalette('gCloudsWeatherPalette');
  for (let i = 0; i < define('NUM_CLOUD_SPRITES'); i++) {
    const spriteId = CreateSprite(sCloudSpriteTemplate, 0, 0, 0xff);
    if (spriteId !== MAX_SPRITES) {
      const sprite = gWeatherSprites[spriteId];
      gWeatherPtr.cloudSprites[i] = sprite;
      // (MAP_OFFSET: the C's map coords are the objects')
      const pos = SetSpritePosToMapCoords(sCloudSpriteMapCoords[i][0] + 7, sCloudSpriteMapCoords[i][1] + 7);
      sprite.x = pos.x;
      sprite.y = pos.y;
      sprite.coordOffsetEnabled = true;
    } else {
      gWeatherPtr.cloudSprites[i] = null;
    }
  }
  gWeatherPtr.cloudSpritesCreated = true;
}

function DestroyCloudSprites(): void {
  if (!gWeatherPtr.cloudSpritesCreated) return;
  for (let i = 0; i < define('NUM_CLOUD_SPRITES'); i++) {
    const s = gWeatherPtr.cloudSprites[i];
    if (s) DestroySprite(s);
  }
  FreeSpriteTilesByTag(GFXTAG_CLOUD);
  gWeatherPtr.cloudSpritesCreated = false;
}

/** UpdateCloudSprite: a pixel left every 2 frames. */
function UpdateCloudSprite(sprite: Sprite): void {
  sprite.data[0] = (sprite.data[0] + 1) & 1;
  if (sprite.data[0]) sprite.x--;
}
