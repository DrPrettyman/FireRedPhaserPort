// field_weather_effects.c's WEATHER_SANDSTORM: Sandstorm_InitVars / _InitAll / _Main / _Finish, the 20 64x64 sand
// sprites (CreateSandstormSprites, UpdateSandstormSprite: 5 columns, 4 rows, moving with UpdateSandstormMovement's
// sine-driven drift, UpdateSandstormWaveIndex) and the 5 32x32 swirls (CreateSwirlSandstormSprites,
// WaitSandSwirlSpriteEntrance, UpdateSandstormSwirlSprite: they rise a pixel a frame on a widening circle),
// DestroySandstormSprites. All ST_OAM_OBJ_BLEND in gSandstormWeatherPalette (LoadCustomWeatherSpritePalette); the
// blend fades in from (EVA 0, EVB 16) to (16, 0) a step a frame (Weather_SetTargetBlendCoeffs(16, 0, 0)) and back out
// on finish; no gamma shift, no sound. The battle's ABILITYEFFECT_SWITCH_IN_WEATHER starts a sandstorm from it. No
// FRLG map or script reaches it; `setweather` + `doweather` do. No Phaser.

import { gSineTable } from '../battle/trig';
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from '../gba/hw';
import {
  ANIMCMD_END,
  ANIMCMD_FRAME,
  CalcCenterToCornerVec,
  gDummySpriteAffineAnimTable,
  oam,
  SPRITE_SHAPE,
  ST_OAM_AFFINE_OFF,
  ST_OAM_OBJ_BLEND,
  StartSpriteAnim,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import {
  gWeatherPtr,
  LoadCustomWeatherSpritePalette,
  spriteCoordOffsetX,
  spriteCoordOffsetY,
  Weather_SetBlendCoeffs,
  Weather_SetTargetBlendCoeffs,
  Weather_UpdateBlend,
  type WeatherCallbacks,
} from './weather';
import { CreateSpriteAtEnd, DestroySprite, FreeSpriteTilesByTag, GFXTAG_SANDSTORM, gWeatherSprites, LoadSpriteSheet, MAX_SPRITES, PALTAG_WEATHER, type WeatherSpriteSheet } from './weatherSprites';

/** include/constants/field_weather.h */
const NUM_SANDSTORM_SPRITES = 20;
const NUM_SWIRL_SANDSTORM_SPRITES = 5;
const MIN_SANDSTORM_WAVE_INDEX = 0x20;
const ST_OAM_SIZE_2 = 2;

const s16 = (v: number) => (v << 16) >> 16;

export function Sandstorm_InitVars(): void {
  const w = gWeatherPtr;
  w.initStep = 0;
  w.weatherGfxLoaded = false;
  w.gammaTargetIndex = 0;
  w.gammaStepDelay = 20;
  if (!w.sandstormSpritesCreated) {
    w.sandstormXOffset = w.sandstormYOffset = 0;
    w.sandstormWaveIndex = 8;
    w.sandstormWaveCounter = 0;
    // Dead code. How does the compiler not optimize this out?
    if (w.sandstormWaveIndex >= 0x80 - MIN_SANDSTORM_WAVE_INDEX) w.sandstormWaveIndex = 0x80 - w.sandstormWaveIndex;
    Weather_SetBlendCoeffs(0, 16);
  }
}

export function Sandstorm_InitAll(): void {
  Sandstorm_InitVars();
  while (!gWeatherPtr.weatherGfxLoaded) Sandstorm_Main();
}

export function Sandstorm_Main(): void {
  const w = gWeatherPtr;
  UpdateSandstormMovement();
  UpdateSandstormWaveIndex();
  if (w.sandstormWaveIndex >= 0x80 - MIN_SANDSTORM_WAVE_INDEX) w.sandstormWaveIndex = MIN_SANDSTORM_WAVE_INDEX;
  switch (w.initStep) {
    case 0:
      CreateSandstormSprites();
      CreateSwirlSandstormSprites();
      w.initStep++;
      break;
    case 1:
      Weather_SetTargetBlendCoeffs(16, 0, 0);
      w.initStep++;
      break;
    case 2:
      if (Weather_UpdateBlend()) {
        w.weatherGfxLoaded = true;
        w.initStep++;
      }
      break;
  }
}

export function Sandstorm_Finish(): boolean {
  UpdateSandstormMovement();
  UpdateSandstormWaveIndex();
  switch (gWeatherPtr.finishStep) {
    case 0:
      Weather_SetTargetBlendCoeffs(0, 16, 0);
      gWeatherPtr.finishStep++;
      break;
    case 1:
      if (Weather_UpdateBlend()) gWeatherPtr.finishStep++;
      break;
    case 2:
      DestroySandstormSprites();
      gWeatherPtr.finishStep++;
      break;
    default:
      return false;
  }
  return true;
}

/** The wave index a step every 6 frames. */
function UpdateSandstormWaveIndex(): void {
  const w = gWeatherPtr;
  if (w.sandstormWaveCounter++ > 4) {
    w.sandstormWaveIndex++;
    w.sandstormWaveCounter = 0;
  }
}

/** The sand drifts left 4 times as fast as it rises, by gSineTable[sandstormWaveIndex] / 256 pixels a frame (u32 offsets). */
function UpdateSandstormMovement(): void {
  const w = gWeatherPtr;
  const sine = gSineTable(w.sandstormWaveIndex);
  w.sandstormXOffset = (w.sandstormXOffset - sine * 4) >>> 0;
  w.sandstormYOffset = (w.sandstormYOffset - sine) >>> 0;
  w.sandstormBaseSpritesX = (spriteCoordOffsetX() + (w.sandstormXOffset >>> 8)) & 0xff;
  w.sandstormPosY = (spriteCoordOffsetY() + (w.sandstormYOffset >>> 8)) & 0xffff;
}

function DestroySandstormSprites(): void {
  const w = gWeatherPtr;
  if (w.sandstormSpritesCreated) {
    for (let i = 0; i < NUM_SANDSTORM_SPRITES; i++) {
      const s = w.sandstormSprites1[i];
      if (s) DestroySprite(s);
    }
    w.sandstormSpritesCreated = false;
    FreeSpriteTilesByTag(GFXTAG_SANDSTORM);
  }
  if (w.sandstormSwirlSpritesCreated) {
    for (let i = 0; i < NUM_SWIRL_SANDSTORM_SPRITES; i++) {
      const s = w.sandstormSprites2[i];
      if (s) DestroySprite(s);
    }
    w.sandstormSwirlSpritesCreated = false;
  }
}

/** sSandstormSpriteOamData: 64x64, priority 1, ST_OAM_OBJ_BLEND */
const [SAND_SHAPE, SAND_SIZE] = SPRITE_SHAPE['64x64'];
const sSandstormSpriteOamData = oam({ objMode: ST_OAM_OBJ_BLEND, shape: SAND_SHAPE, size: SAND_SIZE, priority: 1, paletteNum: 0 });

const sSandstormSpriteAnimCmds = [
  [ANIMCMD_FRAME(0, 3), ANIMCMD_END], // sSandstormSpriteAnimCmd0
  [ANIMCMD_FRAME(64, 3), ANIMCMD_END], // sSandstormSpriteAnimCmd1: the swirl
];

const sSandstormSpriteTemplate: SpriteTemplate = {
  tileTag: GFXTAG_SANDSTORM,
  paletteTag: PALTAG_WEATHER,
  oam: sSandstormSpriteOamData,
  anims: sSandstormSpriteAnimCmds,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: (sprite) => UpdateSandstormSprite(sprite),
};

const sSandstormSpriteSheet: WeatherSpriteSheet = { data: 'gWeatherSandstormTiles', size: 0x0a00, tag: GFXTAG_SANDSTORM };

// Regular sandstorm sprites
const tSpriteColumn = 0;
const tSpriteRow = 1;

// Swirly sandstorm sprites
const tRadius = 0;
const tWaveIndex = 1;
const tRadiusCounter = 2;
const tEntranceDelay = 3;

function CreateSandstormSprites(): void {
  const w = gWeatherPtr;
  if (w.sandstormSpritesCreated) return;
  LoadSpriteSheet(sSandstormSpriteSheet);
  LoadCustomWeatherSpritePalette('gSandstormWeatherPalette');
  for (let i = 0; i < NUM_SANDSTORM_SPRITES; i++) {
    const spriteId = CreateSpriteAtEnd(sSandstormSpriteTemplate, 0, Math.floor(i / 5) * 64, 1);
    if (spriteId !== MAX_SPRITES) {
      const sprite = gWeatherSprites[spriteId];
      w.sandstormSprites1[i] = sprite;
      sprite.data[tSpriteColumn] = i % 5;
      sprite.data[tSpriteRow] = Math.floor(i / 5);
    } else {
      w.sandstormSprites1[i] = null;
    }
  }
  w.sandstormSpritesCreated = true;
}

/** sSwirlEntranceDelays (6 entries for 5 swirls) */
const sSwirlEntranceDelays = [0, 120, 80, 160, 40, 0];

function CreateSwirlSandstormSprites(): void {
  const w = gWeatherPtr;
  if (w.sandstormSwirlSpritesCreated) return;
  const [shape32, size32] = SPRITE_SHAPE['32x32'];
  for (let i = 0; i < NUM_SWIRL_SANDSTORM_SPRITES; i++) {
    const spriteId = CreateSpriteAtEnd(sSandstormSpriteTemplate, i * 48 + 24, 208, 1);
    if (spriteId !== MAX_SPRITES) {
      const sprite = gWeatherSprites[spriteId];
      w.sandstormSprites2[i] = sprite;
      sprite.oam.size = ST_OAM_SIZE_2;
      sprite.data[tSpriteRow] = i * 51; // (data[1]: the swirl's tWaveIndex)
      sprite.data[tRadius] = 8;
      sprite.data[tRadiusCounter] = 0;
      sprite.data[4] = 0x6730; // unused value
      sprite.data[tEntranceDelay] = sSwirlEntranceDelays[i];
      StartSpriteAnim(sprite, 1);
      CalcCenterToCornerVec(sprite, shape32, size32, ST_OAM_AFFINE_OFF);
      sprite.callback = WaitSandSwirlSpriteEntrance;
    } else {
      w.sandstormSprites2[i] = null;
    }
    w.sandstormSwirlSpritesCreated = true;
  }
}

function UpdateSandstormSprite(sprite: Sprite): void {
  const w = gWeatherPtr;
  sprite.y2 = s16(w.sandstormPosY);
  sprite.x = s16(w.sandstormBaseSpritesX + 32 + sprite.data[tSpriteColumn] * 64);
  if (sprite.x >= DISPLAY_WIDTH + 32) {
    sprite.x = s16(w.sandstormBaseSpritesX + DISPLAY_WIDTH * 2 - (4 - sprite.data[tSpriteColumn]) * 64);
    sprite.x &= 0x1ff;
  }
}

function WaitSandSwirlSpriteEntrance(sprite: Sprite): void {
  if (--sprite.data[tEntranceDelay] === -1) sprite.callback = UpdateSandstormSwirlSprite;
}

function UpdateSandstormSwirlSprite(sprite: Sprite): void {
  const d = sprite.data;
  sprite.y = s16(sprite.y - 1);
  if (sprite.y < -48) {
    sprite.y = DISPLAY_HEIGHT + 48;
    d[tRadius] = 4;
  }
  // u32 products, shifted logically, into s16 x2 / y2
  const x = (d[tRadius] * gSineTable(d[tWaveIndex])) >>> 0;
  const y = (d[tRadius] * gSineTable(d[tWaveIndex] + 0x40)) >>> 0;
  sprite.x2 = s16(x >>> 8);
  sprite.y2 = s16(y >>> 8);
  d[tWaveIndex] = (d[tWaveIndex] + 10) & 0xff;
  if (++d[tRadiusCounter] > 8) {
    d[tRadiusCounter] = 0;
    d[tRadius]++;
  }
}

export const SANDSTORM: WeatherCallbacks = { initVars: Sandstorm_InitVars, main: Sandstorm_Main, initAll: Sandstorm_InitAll, finish: Sandstorm_Finish };
