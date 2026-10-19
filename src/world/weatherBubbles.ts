// WEATHER_UNDERWATER_BUBBLES: field_weather_effects.c's Bubbles_* (CreateBubbleSprite, DestroyBubbleSprites,
// UpdateBubbleSprite, sBubbleStartDelays, sBubbleStartCoords, the bubble sheet). Its first half is the horizontal fog
// (FogHorizontal_InitVars / _Main / _Finish in world/weather.ts, the fog's sprites world/fogHorizontal.ts; not
// WEATHER_FOG_HORIZONTAL, so the blend goes to WEATHER_UNDERWATER's (4, 16) at once); the bubbles are 8x8
// ST_OAM_OBJ_NORMAL sprites at priority 1 that rise 3 pixels a frame, swaying, for 120 frames, one every 2-90 frames
// from 13 places. No FRLG map or script reaches it; `setweather` + `doweather` from a dev script or the test hooks
// (`__test.doWeather`) do. No Phaser.

import { ANIMCMD_END, ANIMCMD_FRAME, gDummySpriteAffineAnimTable, oam, SPRITE_SHAPE, type Sprite, type SpriteTemplate } from '../gba/sprite';
import { FogHorizontal_Finish, FogHorizontal_InitVars, FogHorizontal_Main, gWeatherPtr, spriteCoordOffsetY, type WeatherCallbacks } from './weather';
import { CreateSpriteAtEnd, DestroySprite, FreeSpriteTilesByTag, GFXTAG_BUBBLE, gWeatherSprites, LoadSpriteSheet, MAX_SPRITES, PALTAG_WEATHER, type WeatherSpriteSheet } from './weatherSprites';

export const sBubbleStartDelays = [40, 90, 60, 90, 2, 60, 40, 30];

const sWeatherBubbleSpriteSheet: WeatherSpriteSheet = { data: 'gWeatherBubbleTiles', size: 0x0040, tag: GFXTAG_BUBBLE };

export const sBubbleStartCoords: readonly (readonly [number, number])[] = [
  [120, 160],
  [376, 160],
  [40, 140],
  [296, 140],
  [180, 130],
  [436, 130],
  [60, 160],
  [436, 160],
  [220, 180],
  [476, 180],
  [10, 90],
  [266, 90],
  [256, 160],
];

export function Bubbles_InitVars(): void {
  FogHorizontal_InitVars();
  // (bubblesSpritesCreated is never set: only StartWeather clears it)
  if (!gWeatherPtr.bubblesSpritesCreated) {
    LoadSpriteSheet(sWeatherBubbleSpriteSheet);
    gWeatherPtr.bubblesDelayIndex = 0;
    gWeatherPtr.bubblesDelayCounter = sBubbleStartDelays[0];
    gWeatherPtr.bubblesCoordsIndex = 0;
    gWeatherPtr.bubblesSpriteCount = 0;
  }
}

export function Bubbles_InitAll(): void {
  Bubbles_InitVars();
  while (!gWeatherPtr.weatherGfxLoaded) Bubbles_Main();
}

export function Bubbles_Main(): void {
  const w = gWeatherPtr;
  FogHorizontal_Main();
  if (++w.bubblesDelayCounter > sBubbleStartDelays[w.bubblesDelayIndex]) {
    w.bubblesDelayCounter = 0;
    if (++w.bubblesDelayIndex > sBubbleStartDelays.length - 1) w.bubblesDelayIndex = 0;
    CreateBubbleSprite(w.bubblesCoordsIndex);
    if (++w.bubblesCoordsIndex > sBubbleStartCoords.length - 1) w.bubblesCoordsIndex = 0;
  }
}

export function Bubbles_Finish(): boolean {
  if (!FogHorizontal_Finish()) {
    DestroyBubbleSprites();
    return false;
  }
  return true;
}

export const BUBBLES: WeatherCallbacks = { initVars: Bubbles_InitVars, main: Bubbles_Main, initAll: Bubbles_InitAll, finish: Bubbles_Finish };

const sBubbleSpriteAnimCmds = [[ANIMCMD_FRAME(0, 16), ANIMCMD_FRAME(1, 16), ANIMCMD_END]];

/** gOamData_AffineOff_ObjNormal_8x8 */
const [BUBBLE_SHAPE, BUBBLE_SIZE] = SPRITE_SHAPE['8x8'];
const gOamData_AffineOff_ObjNormal_8x8 = oam({ shape: BUBBLE_SHAPE, size: BUBBLE_SIZE });

const sBubbleSpriteTemplate: SpriteTemplate = {
  tileTag: GFXTAG_BUBBLE,
  paletteTag: PALTAG_WEATHER,
  oam: gOamData_AffineOff_ObjNormal_8x8,
  anims: sBubbleSpriteAnimCmds,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: (sprite) => UpdateBubbleSprite(sprite),
};

// sprite->data[] of a bubble
const tScrollXCounter = 0;
const tScrollXDir = 1;
const tCounter = 2;

function CreateBubbleSprite(coordsIndex: number): void {
  const x = sBubbleStartCoords[coordsIndex][0];
  const y = sBubbleStartCoords[coordsIndex][1] - spriteCoordOffsetY();
  const spriteId = CreateSpriteAtEnd(sBubbleSpriteTemplate, x, y, 0);
  if (spriteId !== MAX_SPRITES) {
    const sprite = gWeatherSprites[spriteId];
    sprite.oam.priority = 1;
    sprite.coordOffsetEnabled = true;
    sprite.data[tScrollXCounter] = 0;
    sprite.data[tScrollXDir] = 0;
    sprite.data[tCounter] = 0;
    gWeatherPtr.bubblesSpriteCount++;
  }
}

/** DestroyBubbleSprites: every sprite made from the bubble template. */
function DestroyBubbleSprites(): void {
  for (let i = 0; i < MAX_SPRITES; i++) {
    if (gWeatherSprites[i].inUse && gWeatherSprites[i].template === sBubbleSpriteTemplate) DestroySprite(gWeatherSprites[i]);
  }
  FreeSpriteTilesByTag(GFXTAG_BUBBLE);
}

/** UpdateBubbleSprite: up 3 a frame, x2 swaying 0-5 a step every 5 frames, gone after 120 frames. */
function UpdateBubbleSprite(sprite: Sprite): void {
  const d = sprite.data;
  ++d[tScrollXCounter];
  if (++d[tScrollXCounter] > 8) {
    // double increment
    d[tScrollXCounter] = 0;
    if (d[tScrollXDir] === 0) {
      if (++sprite.x2 > 4) d[tScrollXDir] = 1;
    } else if (--sprite.x2 <= 0) {
      d[tScrollXDir] = 0;
    }
  }
  sprite.y -= 3;
  if (++d[tCounter] >= 120) DestroySprite(sprite);
}
