// field_weather_effects.c's WEATHER_SNOW: Snow_InitVars / _InitAll / _Main / _Finish, the snowflakes
// (sSnowflakeSpriteTemplate with its two frame images, gWeatherSnow1Tiles / gWeatherSnow2Tiles: CreateSnowflakeSprite,
// DestroySnowflakeSprite, InitSnowflakeSpriteMovement, WaitSnowflakeSprite, UpdateSnowflakeSprite) and
// UpdateVisibleSnowflakeSprites (one flake more or less every 37 frames, to 16). The shade's gamma (index 3, a step
// every 20 frames) is the weather task's; FadeInScreenWithWeather / FadeScreen take WEATHER_SNOW as the rain weathers
// (FadeInScreen_RainShowShade, weather.ts). No sound. No FRLG map or script reaches it; `setweather` + `doweather` do.
//
// As in the C, a snowflake whose fall time runs out (tFallDuration: 210-241 frames, 220 after a wrap) waits in
// WaitSnowflakeSprite for gWeatherPtr->snowflakeTimer to pass 18, which nothing increments: it stays invisible from
// then on, so the snow thins out and stops a few seconds after the last flake was created. No Phaser.

import { gSineTable } from '../battle/trig';
import { ANIMCMD_END, ANIMCMD_FRAME, gDummySpriteAffineAnimTable, oam, SPRITE_SHAPE, ST_OAM_OBJ_NORMAL, StartSpriteAnim, TAG_NONE, type Sprite } from '../gba/sprite';
import { random } from '../util/random';
import { gWeatherPtr, spriteCoordOffsetX, spriteCoordOffsetY, type WeatherCallbacks } from './weather';
import { CreateSpriteAtEnd, DestroySprite, gWeatherSprites, MAX_SPRITES, PALTAG_WEATHER, type WeatherSpriteTemplate } from './weatherSprites';

const s16 = (v: number) => (v << 16) >> 16;

export function Snow_InitVars(): void {
  gWeatherPtr.initStep = 0;
  gWeatherPtr.weatherGfxLoaded = false;
  gWeatherPtr.gammaTargetIndex = 3;
  gWeatherPtr.gammaStepDelay = 20;
  gWeatherPtr.targetSnowflakeSpriteCount = 16;
  gWeatherPtr.snowflakeVisibleCounter = 0;
}

export function Snow_InitAll(): void {
  Snow_InitVars();
  while (!gWeatherPtr.weatherGfxLoaded) {
    Snow_Main();
    for (let i = 0; i < gWeatherPtr.snowflakeSpriteCount; i++) UpdateSnowflakeSprite(gWeatherPtr.snowflakeSprites[i]!);
  }
}

export function Snow_Main(): void {
  if (gWeatherPtr.initStep === 0 && !UpdateVisibleSnowflakeSprites()) {
    gWeatherPtr.weatherGfxLoaded = true;
    gWeatherPtr.initStep++;
  }
}

export function Snow_Finish(): boolean {
  switch (gWeatherPtr.finishStep) {
    case 0:
      gWeatherPtr.targetSnowflakeSpriteCount = 0;
      gWeatherPtr.snowflakeVisibleCounter = 0;
      gWeatherPtr.finishStep++;
    // fall through
    case 1:
      if (!UpdateVisibleSnowflakeSprites()) {
        gWeatherPtr.finishStep++;
        return false;
      }
      return true;
  }
  return false;
}

/** A snowflake more (or less) every 37 frames until targetSnowflakeSpriteCount (TRUE while it isn't there). */
function UpdateVisibleSnowflakeSprites(): boolean {
  const w = gWeatherPtr;
  if (w.snowflakeSpriteCount === w.targetSnowflakeSpriteCount) return false;
  w.snowflakeVisibleCounter = (w.snowflakeVisibleCounter + 1) & 0xffff;
  if (w.snowflakeVisibleCounter > 36) {
    w.snowflakeVisibleCounter = 0;
    if (w.snowflakeSpriteCount < w.targetSnowflakeSpriteCount) CreateSnowflakeSprite();
    else DestroySnowflakeSprite();
  }
  return w.snowflakeSpriteCount !== w.targetSnowflakeSpriteCount;
}

/** sSnowflakeSpriteOamData: 8x8, priority 1, ST_OAM_OBJ_NORMAL */
const [SNOW_SHAPE, SNOW_SIZE] = SPRITE_SHAPE['8x8'];
const sSnowflakeSpriteOamData = oam({ objMode: ST_OAM_OBJ_NORMAL, shape: SNOW_SHAPE, size: SNOW_SIZE, priority: 1, paletteNum: 0 });

const sSnowflakeAnimCmds = [
  [ANIMCMD_FRAME(0, 16), ANIMCMD_END], // sSnowflakeAnimCmd0
  [ANIMCMD_FRAME(1, 16), ANIMCMD_END], // sSnowflakeAnimCmd1
];

/** sSnowflakeSpriteTemplate: TAG_NONE, its frames sSnowflakeSpriteImages (gWeatherSnow1Tiles, gWeatherSnow2Tiles: 0x20 bytes each). */
const sSnowflakeSpriteTemplate: WeatherSpriteTemplate = {
  tileTag: TAG_NONE,
  paletteTag: PALTAG_WEATHER,
  oam: sSnowflakeSpriteOamData,
  anims: sSnowflakeAnimCmds,
  images: null,
  imageSymbols: ['gWeatherSnow1Tiles', 'gWeatherSnow2Tiles'],
  affineAnims: gDummySpriteAffineAnimTable,
  callback: (sprite) => UpdateSnowflakeSprite(sprite),
};

// sprite->data[] of a snowflake
const tPosY = 0;
const tDeltaY = 1;
const tWaveDelta = 2;
const tWaveIndex = 3;
const tSnowflakeId = 4;
const tFallCounter = 5;
const tFallDuration = 6;
const tDeltaY2 = 7;

function CreateSnowflakeSprite(): boolean {
  const spriteId = CreateSpriteAtEnd(sSnowflakeSpriteTemplate, 0, 0, 78);
  if (spriteId === MAX_SPRITES) return false;
  const sprite = gWeatherSprites[spriteId];
  sprite.data[tSnowflakeId] = gWeatherPtr.snowflakeSpriteCount;
  InitSnowflakeSpriteMovement(sprite);
  sprite.coordOffsetEnabled = true;
  gWeatherPtr.snowflakeSprites[gWeatherPtr.snowflakeSpriteCount++] = sprite;
  return true;
}

function DestroySnowflakeSprite(): boolean {
  if (gWeatherPtr.snowflakeSpriteCount) {
    DestroySprite(gWeatherPtr.snowflakeSprites[--gWeatherPtr.snowflakeSpriteCount]!);
    return true;
  }
  return false;
}

/** A snowflake starts at the top of the screen in its column (id * 5 & 7: one of 8 columns 30 wide), at a random speed and sway. */
function InitSnowflakeSpriteMovement(sprite: Sprite): void {
  const d = sprite.data;
  const x = (((d[tSnowflakeId] * 5) & 7) * 30 + (random() % 30)) & 0xffff;
  sprite.y = s16(-3 - (spriteCoordOffsetY() + sprite.centerToCornerVecY));
  sprite.x = s16(x - (spriteCoordOffsetX() + sprite.centerToCornerVecX));
  d[tPosY] = sprite.y * 128;
  sprite.x2 = 0;
  const rand = random();
  d[tDeltaY] = (rand & 3) * 5 + 64;
  d[tDeltaY2] = d[tDeltaY];
  StartSpriteAnim(sprite, rand & 1 ? 0 : 1);
  d[tWaveIndex] = 0;
  d[tWaveDelta] = (rand & 3) === 0 ? 2 : 1;
  d[tFallDuration] = (rand & 0x1f) + 210;
  d[tFallCounter] = 0;
}

function WaitSnowflakeSprite(sprite: Sprite): void {
  // Timer is never incremented
  if (gWeatherPtr.snowflakeTimer > 18) {
    sprite.invisible = false;
    sprite.callback = UpdateSnowflakeSprite;
    sprite.y = s16(250 - (spriteCoordOffsetY() + sprite.centerToCornerVecY));
    sprite.data[tPosY] = sprite.y * 128;
    gWeatherPtr.snowflakeTimer = 0;
  }
}

/** The fall (tDeltaY / 128 pixels a frame) and the sway (gSineTable / 64); the screen's edges wrap it round. */
function UpdateSnowflakeSprite(sprite: Sprite): void {
  const d = sprite.data;
  const offX = spriteCoordOffsetX();
  const offY = spriteCoordOffsetY();
  d[tPosY] += d[tDeltaY];
  sprite.y = d[tPosY] >> 7;
  d[tWaveIndex] = (d[tWaveIndex] + d[tWaveDelta]) & 0xff;
  sprite.x2 = Math.trunc(gSineTable(d[tWaveIndex]) / 64);

  let x = (sprite.x + sprite.centerToCornerVecX + offX) & 0x1ff;
  if (x & 0x100) x |= -0x100;
  if (x < -3) sprite.x = s16(242 - (offX + sprite.centerToCornerVecX));
  else if (x > 242) sprite.x = s16(-3 - (offX + sprite.centerToCornerVecX));

  const y = (sprite.y + sprite.centerToCornerVecY + offY) & 0xff;
  if (y > 163 && y < 171) {
    sprite.y = s16(250 - (offY + sprite.centerToCornerVecY));
    d[tPosY] = sprite.y * 128;
    d[tFallCounter] = 0;
    d[tFallDuration] = 220;
  } else if (y > 242 && y < 250) {
    sprite.y = 163;
    d[tPosY] = sprite.y * 128;
    d[tFallCounter] = 0;
    d[tFallDuration] = 220;
    sprite.invisible = true;
    sprite.callback = WaitSnowflakeSprite;
  }

  if (++d[tFallCounter] === d[tFallDuration]) {
    InitSnowflakeSpriteMovement(sprite);
    sprite.y = 250;
    sprite.invisible = true;
    sprite.callback = WaitSnowflakeSprite;
  }
}

export const SNOW: WeatherCallbacks = { initVars: Snow_InitVars, main: Snow_Main, initAll: Snow_InitAll, finish: Snow_Finish };

/** Unit tests: the state a snowflake's movement is in (sprite->data). */
export function snowflakeData(sprite: Sprite) {
  const d = sprite.data;
  return { posY: d[tPosY], deltaY: d[tDeltaY], waveDelta: d[tWaveDelta], waveIndex: d[tWaveIndex], id: d[tSnowflakeId], fallCounter: d[tFallCounter], fallDuration: d[tFallDuration], waiting: sprite.callback === WaitSnowflakeSprite };
}
