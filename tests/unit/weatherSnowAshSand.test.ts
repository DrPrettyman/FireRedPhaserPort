// WEATHER_SNOW, WEATHER_VOLCANIC_ASH and WEATHER_SANDSTORM (world/weatherSnow.ts, weatherAsh.ts, weatherSandstorm.ts)
// in Node, frame by frame through the weather task: the sprites' creation, positions and frames, the BLDALPHA steps
// and the finish. Expected values are worked out here from the C (field_weather_effects.c): Random() as the LCG
// (1103515245, 24691), the fall / drift arithmetic written out, gSineTable from the decomp's data.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { gSineTable } from '../../src/battle/trig';
import { seedRng } from '../../src/util/random';
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
  gWeatherPtr,
} from '../../src/world/weather';
import { snowflakeData } from '../../src/world/weatherSnow';
import { AnimateWeatherSprites, BuildWeatherOam, gWeatherSprites, weatherSpriteCount, weatherSpritePalette } from '../../src/world/weatherSprites';
import { newBattleEnv, type TestGame } from './gameData';

let t: TestGame;
let spriteCoordOffset = { x: 0, y: 0 };
/** REG_BLDALPHA writes (host.setBlendAlpha). */
let bldalpha: [number, number][] = [];

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
    setBlendAlpha: (eva, evb) => bldalpha.push([eva, evb]),
    createFogHorizontalSprites: () => {},
    destroyFogHorizontalSprites: () => {},
    spriteCoordOffsetX: () => spriteCoordOffset.x,
    spriteCoordOffsetY: () => spriteCoordOffset.y,
  });
});

beforeEach(() => {
  spriteCoordOffset = { x: 0, y: 0 };
  bldalpha = [];
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

/** setweather + doweather */
function doWeather(name: string) {
  SetSavedWeather(t.d(name));
  DoCurrentWeather();
}

/** A map load into the weather: StartWeather, ResumePausedWeather, the fade in; the first frame runs its InitAll. */
function loadInto(name: string) {
  ResetWeatherTask();
  SetSavedWeather(t.d(name));
  StartWeather();
  ResumePausedWeather();
  WeatherFadeScreen(t.d('FADE_FROM_BLACK'));
  frame();
}

/** Random() from a seed, as random.h has it. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = Number((BigInt(1103515245) * BigInt(s) + 24691n) & 0xffffffffn);
    return s >>> 16;
  };
}

const usedIds = () => gWeatherSprites.map((s, id) => (s.inUse ? id : -1)).filter((id) => id >= 0);

describe('WEATHER_SNOW', () => {
  test('doweather: the shade, one snowflake every 37 frames up to 16; a flake falls tDeltaY / 128 a frame and sways gSineTable / 64', () => {
    fieldWithoutWeather();
    doWeather('WEATHER_SNOW');
    frame(); // Task_WeatherMain: None_Finish, Snow_InitVars
    expect(weatherProbe()).toMatchObject({ currWeather: t.d('WEATHER_SNOW'), gammaTargetIndex: 3, initStep: 0 });
    expect(gWeatherPtr.targetSnowflakeSpriteCount).toBe(16);
    // 36 frames of Snow_Main with the counter going up, the 37th creates the first flake
    for (let i = 0; i < 36; i++) frame();
    expect(gWeatherPtr.snowflakeSpriteCount).toBe(0);
    seedRng(0x1234);
    frame();
    expect(gWeatherPtr.snowflakeSpriteCount).toBe(1);
    const id = usedIds()[0];
    expect(id, 'CreateSpriteAtEnd: the last slot').toBe(63);
    const flake = gWeatherSprites[id];

    // InitSnowflakeSpriteMovement: x = ((id * 5) & 7) * 30 + Random() % 30, then rand = Random()
    const r = rng(0x1234);
    const xr = r() % 30;
    const rand = r();
    const deltaY = (rand & 3) * 5 + 64;
    const waveDelta = (rand & 3) === 0 ? 2 : 1;
    const fallDuration = (rand & 0x1f) + 210;
    const anim = rand & 1 ? 0 : 1;
    // An 8x8 sprite's centerToCornerVec is -4: x = xr + 4, y = -3 + 4 = 1, tPosY = 128
    expect(snowflakeData(flake)).toMatchObject({ deltaY, waveDelta, fallDuration, id: 0, fallCounter: 1, waiting: false });
    expect(flake.x).toBe(xr + 4);
    expect(flake.coordOffsetEnabled).toBe(true);
    const oam0 = BuildWeatherOam(0, 0).find((o) => o.id === id)!;
    expect(oam0).toMatchObject({ tag: 0xffff, image: anim ? 'gWeatherSnow2Tiles' : 'gWeatherSnow1Tiles', width: 8, height: 8, priority: 1, subpriority: 78, blend: false });
    // Its fall, frame by frame (the frame it was created ran its callback once)
    for (let k = 1; k < fallDuration; k++) {
      expect(flake.y, `y after ${k} frames`).toBe((128 + k * deltaY) >> 7);
      expect(flake.x2, `x2 after ${k} frames`).toBe(Math.trunc(gSineTable((k * waveDelta) & 0xff) / 64));
      expect(flake.invisible).toBe(false);
      frame();
    }
    // tFallDuration ran out: WaitSnowflakeSprite, which waits for a timer nothing increments
    expect(snowflakeData(flake).waiting).toBe(true);
    expect(flake.invisible).toBe(true);
    for (let i = 0; i < 400; i++) frame();
    expect(snowflakeData(flake).waiting, 'still waiting: snowflakeTimer stays 0').toBe(true);
    expect(gWeatherPtr.snowflakeTimer).toBe(0);
    // Created 37 frames apart: 16 by 36 + 16 * 37 frames after the change
    expect(gWeatherPtr.snowflakeSpriteCount).toBe(16);
    expect(weatherProbe().weatherGfxLoaded).toBe(true);
    expect(weatherProbe().gammaIndex).toBe(3);
  });

  test("a flake wraps round the screen's sides (x < -3 → 242, x > 242 → -3, with gSpriteCoordOffsetX) and its bottom (164-170 → the top, 220 frames more)", () => {
    fieldWithoutWeather();
    doWeather('WEATHER_SNOW');
    for (let i = 0; i < 38; i++) frame();
    const flake = gWeatherSprites[usedIds()[0]];
    spriteCoordOffset = { x: 30, y: 0 };
    flake.x = -40; // screen x -40 - 4 + 30 = -14 < -3
    frame();
    expect(flake.x, '242 - (30 - 4)').toBe(216);
    spriteCoordOffset = { x: -300, y: 0 };
    frame(); // 216 - 4 - 300 = -88 & 0x1ff = 424: 9-bit -88 < -3 again
    expect(flake.x).toBe(242 - (-300 - 4));
    spriteCoordOffset = { x: 0, y: 0 };
    frame(); // 546 - 4 = 542 & 0x1ff = 30: on screen
    expect(flake.x).toBe(546);
    // The bottom: screen y 165 → y = 250 - (0 - 4), tPosY = 254 * 128 (s16), fall counter restarted with 220
    flake.data[0] = 168 * 128 - flake.data[1]; // tPosY: y 168 after this frame's step, screen y 164
    frame();
    expect(flake.y).toBe(254);
    expect(flake.data[0]).toBe((254 * 128) << 16 >> 16);
    expect(snowflakeData(flake)).toMatchObject({ fallCounter: 1, fallDuration: 220, waiting: false });
  });

  test('a map load into snow: Snow_InitAll creates the 16 flakes at once, running their movement as it goes; those past their fall time wait', () => {
    loadInto('WEATHER_SNOW');
    expect(gWeatherPtr.snowflakeSpriteCount).toBe(16);
    expect(weatherProbe().weatherGfxLoaded).toBe(true);
    const flakes = gWeatherPtr.snowflakeSprites.slice(0, 16).map((s) => s!);
    // 16 * 37 frames of movement: the first ones are past their 210-241 frames and wait, invisible
    const waiting = flakes.filter((s) => snowflakeData(s).waiting);
    expect(waiting.length).toBeGreaterThanOrEqual(9);
    expect(waiting.every((s) => s.invisible)).toBe(true);
    expect(flakes.filter((s) => !snowflakeData(s).waiting).every((s) => !s.invisible)).toBe(true);
    expect(BuildWeatherOam(0, 0).length).toBe(16 - waiting.length);
  });

  test('doweather to NONE: a flake destroyed every 37 frames, then WEATHER_NONE', () => {
    loadInto('WEATHER_SNOW');
    doWeather('WEATHER_NONE');
    const counts: number[] = [];
    let frames = 0;
    while (weatherProbe().currWeather !== 0 && frames < 1000) {
      frame();
      frames++;
      if (counts[counts.length - 1] !== gWeatherPtr.snowflakeSpriteCount) counts.push(gWeatherPtr.snowflakeSpriteCount);
    }
    expect(frames, 'Snow_Finish: 16 flakes 37 frames apart, done in the last one').toBe(16 * 37);
    expect(counts).toEqual(Array.from({ length: 17 }, (_, i) => 16 - i));
    expect(weatherSpriteCount()).toBe(0);
  });
});

describe('WEATHER_VOLCANIC_ASH', () => {
  test('doweather: BLDALPHA (64, 63) as written, the 20 ash sprites, the blend (0, 16) to (16, 0) a step every 2 frames; the ash drifts down a pixel every 6 frames', () => {
    fieldWithoutWeather();
    spriteCoordOffset = { x: 16, y: 0 };
    doWeather('WEATHER_VOLCANIC_ASH');
    frame(); // Ash_InitVars
    expect(weatherProbe()).toMatchObject({ currWeather: t.d('WEATHER_VOLCANIC_ASH'), gammaTargetIndex: 0, blendEVA: 0, blendEVB: 16 });
    // Weather_SetBlendCoeffs(0, 16), then SetGpuReg(BLDALPHA, BLDALPHA_BLEND(64, 63)): the 5-bit fields' 0 and 31
    expect(bldalpha.slice(-2)).toEqual([[0, 16], [0, 31]]);
    frame(); // LoadAshSpriteSheet
    expect(weatherSpriteCount()).toBe(0);
    frame(); // CreateAshSprites, Weather_SetTargetBlendCoeffs(16, 0, 1)
    expect(weatherSpriteCount()).toBe(20);
    // ashBaseSpritesX 16; x = 16 + 32 + col * 64 (col 4: 304 >= 272 → 16 + 480 - 0 = 496); y = row * 64 + 32
    const oam = BuildWeatherOam(16, 0);
    expect(oam.every((o) => o.blend && o.width === 64 && o.priority === 1 && o.subpriority === 0x4e && o.tileNum === 0)).toBe(true);
    const positions = oam.map((o) => [o.x, o.y]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    // (OAM: the centre less 32; col 4's 496 - 32 is 9-bit 464, x -48)
    expect(positions).toEqual([0, 1, 2, 3].flatMap((row) => [-48, 16, 80, 144, 208].map((x) => [x, row * 64])));
    // The blend: an update every 2nd frame, EVA and EVB in turn
    const blends: [number, number][] = [];
    for (let k = 1; k <= 64; k++) {
      frame();
      const p = weatherProbe();
      blends.push([p.blendEVA, p.blendEVB]);
    }
    expect(blends).toEqual(Array.from({ length: 64 }, (_, i) => {
      const u = (i + 1) >> 1;
      return [Math.ceil(u / 2), 16 - Math.floor(u / 2)];
    }));
    expect(weatherProbe().weatherGfxLoaded).toBe(true);
    // 65 callbacks since: tOffsetY up 10 (every 6th), the anim's second frame (tile 64) after 60
    const a = BuildWeatherOam(16, 0).find((o) => o.x === 16 && o.y < 64)!;
    expect(a.y).toBe(10);
    expect(a.tileNum).toBe(64);
    // The camera's y offset moves the ash with it
    spriteCoordOffset = { x: 16, y: -20 };
    frame();
    expect(BuildWeatherOam(16, -20).find((o) => o.id === a.id)!.y, '66 callbacks: 32 + 11 - 20, less 32').toBe(-9);
  });

  test('doweather to NONE: the blend back to (0, 16) in 64 frames, the sprites destroyed in that frame, then BLDALPHA 0', () => {
    loadInto('WEATHER_VOLCANIC_ASH');
    expect(weatherSpriteCount()).toBe(20);
    expect(weatherProbe()).toMatchObject({ blendEVA: 16, blendEVB: 0, weatherGfxLoaded: true });
    doWeather('WEATHER_NONE');
    frame(); // Weather_SetTargetBlendCoeffs(0, 16, 1)
    let frames = 0;
    while (weatherSpriteCount() && frames < 200) {
      frame();
      frames++;
    }
    expect(frames).toBe(64);
    expect(weatherProbe()).toMatchObject({ blendEVA: 0, blendEVB: 16, currWeather: t.d('WEATHER_VOLCANIC_ASH') });
    frame(); // SetGpuReg(BLDALPHA, 0), on to NONE
    expect(bldalpha[bldalpha.length - 1]).toEqual([0, 0]);
    expect(weatherProbe().currWeather).toBe(0);
  });
});

describe('WEATHER_SANDSTORM', () => {
  test('doweather: gSandstormWeatherPalette, 20 sand sprites and 5 swirls, the blend (0, 16) to (16, 0) a step a frame, the drift and the swirls as the C has them', () => {
    fieldWithoutWeather();
    doWeather('WEATHER_SANDSTORM');
    frame(); // Sandstorm_InitVars
    expect(weatherProbe()).toMatchObject({ currWeather: t.d('WEATHER_SANDSTORM'), blendEVA: 0, blendEVB: 16, gammaTargetIndex: 0 });
    // The drift worked out alongside: X / Y as signed sums, the wave index a step every 6 frames from 8
    let X = 0;
    let Y = 0;
    let wave = 8;
    let waveCounter = 0;
    const step = () => {
      X -= gSineTable(wave) * 4;
      Y -= gSineTable(wave);
      if (waveCounter++ > 4) {
        wave++;
        waveCounter = 0;
      }
      if (wave >= 0x60) wave = 0x20;
    };
    frame(); // Sandstorm_Main: the movement, then CreateSandstormSprites / CreateSwirlSandstormSprites
    step();
    expect(weatherSpriteCount()).toBe(25);
    expect(weatherSpritePalette()).toBe('gSandstormWeatherPalette');
    const sand = gWeatherPtr.sandstormSprites1.map((s) => s!);
    const swirls = gWeatherPtr.sandstormSprites2.map((s) => s!);
    const check = (label: string) => {
      const base = Math.floor(X / 256) & 0xff;
      const posY = ((Math.floor(Y / 256) << 16) >> 16);
      sand.forEach((s, i) => {
        const col = i % 5;
        let x = base + 32 + col * 64;
        if (x >= 272) x = (base + 480 - (4 - col) * 64) & 0x1ff;
        expect([s.x, s.y, s.y2], `${label}: sand ${i}`).toEqual([x, Math.floor(i / 5) * 64, posY]);
      });
    };
    check('created');
    const oam = BuildWeatherOam(0, 0);
    expect(oam.filter((o) => o.width === 64).every((o) => o.blend && o.tileNum === 0 && o.subpriority === 1 && o.priority === 1)).toBe(true);
    expect(oam.filter((o) => o.width === 32).length).toBeGreaterThan(0);
    // The swirls: 32x32 frames of tile 64; swirl 0 starts at once (its delay 0), the others after 120, 80, 160, 40
    const swirlStart = [0, 120, 80, 160, 40];
    const radius = [8, 8, 8, 8, 8];
    const waveIdx = [0, 51, 102, 153, 204];
    const counter = [0, 0, 0, 0, 0];
    const y = [208, 208, 208, 208, 208];
    const waited = [0, 0, 0, 0, 0];
    const swirlStep = (i: number) => {
      if (waited[i] <= swirlStart[i]) {
        waited[i]++;
        return;
      }
      if (--y[i] < -48) {
        y[i] = 208;
        radius[i] = 4;
      }
      const x2 = Math.floor((radius[i] * gSineTable(waveIdx[i])) / 256);
      const y2 = Math.floor((radius[i] * gSineTable(waveIdx[i] + 0x40)) / 256);
      waveIdx[i] = (waveIdx[i] + 10) & 0xff;
      if (++counter[i] > 8) {
        counter[i] = 0;
        radius[i]++;
      }
      return [x2, y2];
    };
    const last: (number[] | undefined)[] = swirls.map((_, i) => swirlStep(i));
    const blends: [number, number][] = [];
    for (let f = 0; f < 420; f++) {
      frame();
      step();
      swirls.forEach((s, i) => {
        last[i] = swirlStep(i) ?? last[i];
        expect([s.x, s.y], `swirl ${i}, frame ${f}`).toEqual([i * 48 + 24, y[i]]);
        if (last[i]) expect([s.x2, s.y2], `swirl ${i}, frame ${f}`).toEqual(last[i]);
        expect([s.oam.size, s.centerToCornerVecX, s.oam.tileNum]).toEqual([2, -16, 64]);
      });
      if (f % 50 === 0) check(`frame ${f}`);
      const p = weatherProbe();
      if (f < 34) blends.push([p.blendEVA, p.blendEVB]);
    }
    // Frame 0 sets the target, then a step a frame: 32 steps
    expect(blends.slice(1, 33)).toEqual(Array.from({ length: 32 }, (_, i) => [Math.ceil((i + 1) / 2), 16 - Math.floor((i + 1) / 2)]));
    expect(weatherProbe()).toMatchObject({ blendEVA: 16, blendEVB: 0, weatherGfxLoaded: true });
    expect(y[3], 'swirl 3 rose past the top and came back up from the bottom').toBeLessThan(208);
  });

  test('doweather to NONE: the blend back in 32 frames, then the sprites destroyed', () => {
    loadInto('WEATHER_SANDSTORM');
    expect(weatherSpriteCount()).toBe(25);
    expect(weatherProbe()).toMatchObject({ blendEVA: 16, blendEVB: 0 });
    doWeather('WEATHER_NONE');
    frame(); // Weather_SetTargetBlendCoeffs(0, 16, 0)
    for (let i = 0; i < 32; i++) frame();
    expect(weatherProbe()).toMatchObject({ blendEVA: 0, blendEVB: 16 });
    expect(weatherSpriteCount()).toBe(25);
    frame(); // DestroySandstormSprites
    expect(weatherSpriteCount()).toBe(0);
    expect(gWeatherPtr.sandstormSpritesCreated || gWeatherPtr.sandstormSwirlSpritesCreated).toBe(false);
    frame();
    expect(weatherProbe().currWeather).toBe(0);
  });
});
