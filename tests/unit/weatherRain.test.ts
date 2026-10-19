// The rain weathers (world/weatherRain.ts) and the weather sprite layer (world/weatherSprites.ts) in Node: the rain's
// set-up and finish frame by frame through the weather task, a raindrop's first fall against the C's arithmetic worked
// out here (ISO_RANDOMIZE2 in BigInt, sRainSpriteMovement's Q28.4 steps), the SE3 calls (SetRainStrengthFromSoundEffect,
// PlayRainStoppingSoundEffect) with gba/sound mocked, and BuildWeatherOam's order and wrapping.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const sound = vi.hoisted(() => ({ played: [] as number[], se3: false }));
vi.mock('../../src/gba/sound', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/gba/sound')>()),
  PlaySE: (n: number) => sound.played.push(n),
  IsSpecialSEPlaying: () => sound.se3,
  IsSEPlaying: () => false,
}));

import { gDummySpriteAffineAnimTable, gDummySpriteAnimTable, oam, SPRITE_SHAPE, ST_OAM_OBJ_BLEND } from '../../src/gba/sprite';
import {
  DoCurrentWeather,
  loadWeatherData,
  ResetWeatherTask,
  ResumePausedWeather,
  SetSavedWeather,
  setWeatherHost,
  StartWeather,
  WeatherFadeScreen,
  weatherProbe,
  WeatherTask,
} from '../../src/world/weather';
import { AnimateWeatherSprites, BuildWeatherOam, CreateSprite, CreateSpriteAtEnd, gWeatherSprites, ResetWeatherSprites, weatherSpriteCount } from '../../src/world/weatherSprites';
import { newBattleEnv, type TestGame } from './gameData';

let t: TestGame;
let spriteCoordOffset = { x: 0, y: 0 };

beforeAll(async () => {
  t = await newBattleEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const path = resolve(__dirname, '../../public', String(url));
    if (!existsSync(path)) return new Response(null, { status: 404 });
    return new Response(readFileSync(path));
  }) as typeof fetch;
  try {
    await loadWeatherData('gen');
  } finally {
    globalThis.fetch = realFetch;
  }
  setWeatherHost({
    bgPaletteUnfaded: () => undefined,
    setBgPaletteFaded: () => {},
    setObjPaletteGamma: () => {},
    setBlendAlpha: () => {},
    createFogHorizontalSprites: () => {},
    destroyFogHorizontalSprites: () => {},
    spriteCoordOffsetX: () => spriteCoordOffset.x,
    spriteCoordOffsetY: () => spriteCoordOffset.y,
  });
});

beforeEach(() => {
  sound.played = [];
  sound.se3 = false;
  spriteCoordOffset = { x: 0, y: 0 };
});

/** A field frame: the weather task, then AnimateSprites. */
function frame() {
  WeatherTask();
  AnimateWeatherSprites();
}

/** A field with no weather, faded in and idle. */
function fieldWithoutWeather() {
  ResetWeatherTask();
  SetSavedWeather(0);
  StartWeather();
  ResumePausedWeather();
  WeatherFadeScreen(t.d('FADE_FROM_BLACK'));
  frame();
  frame();
}

/** ISO_RANDOMIZE2(seed), then StartRainSpriteFall's ((rand & 0x7FFF0000) >> 16) % 600. */
const nextRainRandom = (seed: number) => Number(((BigInt(1103515245) * BigInt(seed) + 12345n) & 0x7fff0000n) >> 16n) % 600;

describe('WEATHER_RAIN', () => {
  test('doweather: SE_RAIN, one raindrop a frame up to 24, then one shown every 9 frames up to 10; the first one falls (-0x68, 0xD0) Q28.4 a frame', () => {
    fieldWithoutWeather();
    SetSavedWeather(t.d('WEATHER_RAIN'));
    DoCurrentWeather();
    expect(sound.played, 'no SE3 loop yet: nothing to stop').toEqual([]);
    frame(); // Task_WeatherMain: None_Finish, then Rain_InitVars
    expect(sound.played).toEqual([t.d('SE_RAIN')]);
    expect(weatherProbe()).toMatchObject({ currWeather: t.d('WEATHER_RAIN'), gammaTargetIndex: 3, targetRainSpriteCount: 10, rainStrength: 0, initStep: 0 });
    frame(); // LoadRainSpriteSheet
    const created: number[] = [];
    for (let i = 0; i < 24; i++) {
      frame();
      created.push(weatherProbe().rainSpriteCount);
    }
    expect(created).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    expect(weatherSpriteCount()).toBe(24);
    // The first raindrop (sRainSpriteCoords[0], tRandom 0 -> 361): its fall, rewound 18 frames from tile (r % 30, r / 30)
    const first = gWeatherSprites[63]; // CreateSpriteAtEnd: the last slot
    const r = nextRainRandom(361);
    const startX = (r % 30) * 128 + 0x68 * 18;
    const startY = Math.floor(r / 30) * 128 - 0xd0 * 18;
    // 24 frames of UpdateRainSprite since it was created (the template's callback); it splashed after 18
    expect(first.data[1], 'tRandom').toBe(r);
    const before = { x: first.x, y: first.y, splash: first.data[4] };
    expect(before.splash, 'it splashed after its 18 frames of fall').toBe(1);
    expect([before.x, before.y], 'where it splashed: the last fall frame').toEqual([(startX - 0x68 * 18) >> 4, (startY + 0xd0 * 18) >> 4]);
    // Shown one by one: curRainSpriteIndex up every rainSpriteVisibleDelay + 1 = 9 frames
    const shown: number[] = [];
    for (let i = 0; i < 95; i++) {
      frame();
      if (shown[shown.length - 1] !== weatherProbe().curRainSpriteIndex) shown.push(weatherProbe().curRainSpriteIndex);
    }
    expect(shown).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(weatherProbe().weatherGfxLoaded).toBe(true);
  });

  test("a splash keeps its place on the map: gSpriteCoordOffset at the splash is taken off and added back as the camera moves", () => {
    fieldWithoutWeather();
    SetSavedWeather(t.d('WEATHER_RAIN'));
    DoCurrentWeather();
    spriteCoordOffset = { x: -32, y: 16 };
    let splash: { id: number; x: number; y: number } | undefined;
    for (let i = 0; i < 400 && !splash; i++) {
      frame();
      const s = BuildWeatherOam(spriteCoordOffset.x, spriteCoordOffset.y).find((o) => o.coordOffsetEnabled);
      if (s) splash = s;
    }
    expect(splash).toBeDefined();
    const sprite = gWeatherSprites[splash!.id];
    // Its OAM position now: (x - offsetAtSplash) + currentOffset + centerToCornerVec, with the offset unchanged
    expect(splash!.x).toBe(sprite.x + spriteCoordOffset.x - 8);
    const moved = BuildWeatherOam(spriteCoordOffset.x + 16, spriteCoordOffset.y).find((o) => o.id === splash!.id)!;
    expect(moved.x - splash!.x, 'the camera 16 pixels on: the splash 16 pixels across').toBe(16);
  });

  test('doweather to NONE: SE_RAIN_STOP while SE3 plays, the raindrops hidden one by one, then destroyed', () => {
    fieldWithoutWeather();
    SetSavedWeather(t.d('WEATHER_RAIN'));
    DoCurrentWeather();
    for (let i = 0; i < 150; i++) frame();
    expect(weatherProbe().curRainSpriteIndex).toBe(10);
    sound.played = [];
    sound.se3 = true;
    SetSavedWeather(0);
    DoCurrentWeather();
    expect(sound.played, 'SetNextWeather: PlayRainStoppingSoundEffect').toEqual([t.d('SE_RAIN_STOP')]);
    let frames = 0;
    while (weatherProbe().currWeather !== 0 && frames < 200) {
      frame();
      frames++;
    }
    // Rain_Finish: 10 raindrops hidden 9 frames apart, then DestroyRainSprites in the frame the last one goes
    expect(frames).toBe(10 * 9 + 1);
    expect(weatherSpriteCount()).toBe(0);
    expect(weatherProbe()).toMatchObject({ rainSpriteCount: 0, curRainSpriteIndex: 0 });
  });

  test('rain to thunderstorm keeps the raindrops (Rain_Finish ends at once) and plays SE_THUNDERSTORM; no stop sound between rain weathers', () => {
    fieldWithoutWeather();
    SetSavedWeather(t.d('WEATHER_RAIN'));
    DoCurrentWeather();
    for (let i = 0; i < 150; i++) frame();
    sound.played = [];
    sound.se3 = true;
    SetSavedWeather(t.d('WEATHER_RAIN_THUNDERSTORM'));
    DoCurrentWeather();
    expect(sound.played, 'SetNextWeather: no stop for a rain weather').toEqual([]);
    frame();
    expect(sound.played).toEqual([t.d('SE_THUNDERSTORM')]);
    expect(weatherProbe()).toMatchObject({ currWeather: t.d('WEATHER_RAIN_THUNDERSTORM'), targetRainSpriteCount: 16, rainStrength: 2 });
    expect(weatherSpriteCount(), 'the rain sprites stay').toBe(24);
  });
});

describe('field_weather.c sounds', () => {
  test('SetRainStrengthFromSoundEffect plays nothing while the screen fades out; PlayRainStoppingSoundEffect only while SE3 plays', () => {
    fieldWithoutWeather();
    SetSavedWeather(t.d('WEATHER_RAIN'));
    DoCurrentWeather();
    frame();
    expect(sound.played).toEqual([t.d('SE_RAIN')]);
    sound.played = [];
    // A warp's fade out (FadeScreen: WEATHER_PAL_STATE_SCREEN_FADING_OUT), then the downpour's InitVars
    WeatherFadeScreen(t.d('FADE_TO_BLACK'));
    SetSavedWeather(t.d('WEATHER_DOWNPOUR'));
    DoCurrentWeather();
    WeatherTask();
    expect(weatherProbe().currWeather).toBe(t.d('WEATHER_DOWNPOUR'));
    expect(sound.played).toEqual([]);
    // StartWeather + ResumePausedWeather (a map load): SetCurrentAndNextWeather stops nothing while SE3 is silent
    ResetWeatherTask();
    StartWeather();
    ResumePausedWeather();
    expect(sound.played).toEqual([]);
    sound.se3 = true;
    ResumePausedWeather();
    // rainStrength is still the rain's 0 (the downpour's InitVars returned before setting it)
    expect(sound.played).toEqual([t.d('SE_RAIN_STOP')]);
  });
});

describe('the weather sprite layer', () => {
  const [shape, size] = SPRITE_SHAPE['64x64'];
  const template = (priority: number, blend = false) => ({
    tileTag: 0x1202,
    paletteTag: 0x1200,
    oam: oam({ shape, size, priority, objMode: blend ? ST_OAM_OBJ_BLEND : 0 }),
    anims: gDummySpriteAnimTable,
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: () => {},
  });

  test("BuildWeatherOam: SortSprites' order (priority, subpriority, then lower on screen in front), OAM's 9-bit x / 8-bit y wrapping", () => {
    ResetWeatherSprites();
    const a = CreateSprite(template(2), 100, 100, 0);
    const b = CreateSpriteAtEnd(template(1, true), 100, 100, 0x80);
    const c = CreateSprite(template(1), 100, 120, 0x80);
    const d = CreateSpriteAtEnd(template(1), 0, 250, 0x10);
    gWeatherSprites[d].x = -20; // centre left of the screen: OAM x (-20 - 32) & 0x1ff = 460
    const oamList = BuildWeatherOam(0, 0);
    expect(oamList.map((o) => o.id)).toEqual([d, c, b, a]);
    expect(oamList[0]).toMatchObject({ x: -52, y: 250 - 32 - 256 }); // y 218 + 64 > 256: drawn from the top
    expect(oamList[2]).toMatchObject({ x: 68, y: 68, blend: true, width: 64, height: 64 });
    gWeatherSprites[c].invisible = true;
    expect(BuildWeatherOam(0, 0).map((o) => o.id)).toEqual([d, b, a]);
    ResetWeatherSprites();
    expect(BuildWeatherOam(0, 0)).toEqual([]);
  });
});
