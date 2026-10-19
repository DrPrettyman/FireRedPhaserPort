// field_weather.c (world/weather.ts): BuildGammaShiftTables against the C's arithmetic worked out by hand, the
// weather task's palette processing (the fade in with the shade's palettes, a weather change's gamma steps), the
// horizontal fog (its blend coefficients, scroll, sprites and fade in) and the saved weather (setweather / doweather /
// resetweather's functions).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import {
  type ChannelTables,
  DoCurrentWeather,
  gammaShiftTables,
  GetSav1Weather,
  loadWeatherData,
  ResetWeatherTask,
  ResumePausedWeather,
  SetMapHeaderWeather,
  SetSavedWeather,
  SetSavedWeatherFromCurrMapHeader,
  setWeatherHost,
  StartWeather,
  WeatherFadeInBlend,
  WeatherFadeScreen,
  weatherProbe,
  WeatherTask,
} from '../../src/world/weather';
import { newBattleEnv, type TestGame } from './gameData';

let t: TestGame;
/** The host's BG palette 0 as shown, and the OBJ tables it was handed. */
let shown: number[];
let objTables: { normal?: ChannelTables; alt?: ChannelTables };
/** What the fog asked of the host: BLDALPHA writes, sprite creations / destructions; and gSpriteCoordOffsetX. */
let bldalpha: [number, number][] = [];
let fogSprites = { created: 0, destroyed: 0 };
let spriteCoordOffsetX = 0;
let spriteCoordOffsetY = 0;
/** One BG palette of JASC colours: 5-bit c expanded as the decomp's .pal files hold them. */
const UNFADED = Array.from({ length: 48 }, (_, i) => Math.floor(((i % 32) * 255) / 31));

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
  shown = UNFADED;
  setWeatherHost({
    bgPaletteUnfaded: (slot) => (slot === 0 ? UNFADED : undefined),
    setBgPaletteFaded: (slot, colors) => {
      if (slot === 0) shown = colors;
    },
    setObjPaletteGamma: (normal, alt) => (objTables = { normal, alt }),
    setBlendAlpha: (eva, evb) => bldalpha.push([eva, evb]),
    createFogHorizontalSprites: () => fogSprites.created++,
    destroyFogHorizontalSprites: () => fogSprites.destroyed++,
    spriteCoordOffsetX: () => spriteCoordOffsetX,
    spriteCoordOffsetY: () => spriteCoordOffsetY,
  });
});

describe('BuildGammaShiftTables', () => {
  test('gammaShifts rows 0-2 darken by 1/16 a row (u16 maths: v4 = 256c - 16c per row)', () => {
    const { gammaShifts } = gammaShiftTables();
    for (let c = 0; c < 32; c++) {
      expect(gammaShifts[0][c]).toBe(Math.floor((15 * c) / 16));
      expect(gammaShifts[1][c]).toBe(Math.floor((14 * c) / 16));
      expect(gammaShifts[2][c], `the shade's row, channel ${c}`).toBe(Math.floor((13 * c) / 16));
    }
  });

  test('altGammaShifts leaves rows 0-2 alone; rows 3-18 lighten toward white, capped at 31', () => {
    const { gammaShifts, altGammaShifts } = gammaShiftTables();
    for (let c = 0; c < 32; c++) {
      for (let row = 0; row < 3; row++) expect(altGammaShifts[row][c]).toBe(c);
      for (const table of [gammaShifts, altGammaShifts]) {
        for (let row = 3; row < 19; row++) {
          expect(table[row][c]).toBeLessThanOrEqual(31);
          expect(table[row][c]).toBeGreaterThanOrEqual(table[row - 1][c]);
        }
      }
      // From 12 up the 16 steps of (0x1f00 - v4) / 16 end at 0x1f00 exactly
      if (c >= 12) expect(gammaShifts[18][c]).toBe(31);
    }
  });
});

describe('the weather task', () => {
  test('a shaded map fades in over 16 frames with its palettes at gamma index 3, then doweather to NONE steps back each frame', () => {
    ResetWeatherTask();
    SetSavedWeather(t.d('WEATHER_SHADE'));
    StartWeather();
    ResumePausedWeather();
    expect(weatherProbe()).toMatchObject({ currWeather: t.d('WEATHER_SHADE'), task: 'Task_WeatherInit' });
    // Nothing happens before the screen fades in
    WeatherTask();
    expect(weatherProbe().task).toBe('Task_WeatherInit');
    expect(WeatherFadeScreen(t.d('FADE_FROM_BLACK')), 'the shade fades the screen in itself').toBe(true);
    expect(WeatherFadeInBlend()).toBe(16);
    WeatherTask(); // Task_WeatherInit: Shade_InitAll
    expect(weatherProbe()).toMatchObject({ task: 'Task_WeatherMain', gammaTargetIndex: 3 });
    const blends: (number | undefined)[] = [];
    for (let i = 0; i < 16; i++) {
      WeatherTask();
      blends.push(WeatherFadeInBlend());
    }
    expect(blends).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, undefined]);
    expect(weatherProbe()).toMatchObject({ gammaIndex: 3, palProcessingState: t.d('WEATHER_PAL_STATE_IDLE') });
    expect(shown).toEqual(UNFADED.map((v) => Math.floor((Math.floor((13 * (v >> 3)) / 16) * 255) / 31)));
    // The objects' palettes (GAMMA_ALT) are left alone at index 3, the reflections' and field effects' aren't
    expect(objTables.alt).toBeUndefined();
    expect(objTables.normal?.[31]).toBe(25);

    // Navel Rock's summit: setweather 0, doweather
    SetSavedWeather(0);
    DoCurrentWeather();
    const gammas: number[] = [];
    for (let i = 0; i < 4; i++) {
      WeatherTask();
      gammas.push(weatherProbe().gammaIndex);
    }
    expect(gammas, "None_Init's gammaStepDelay 0: a step a frame").toEqual([2, 1, 0, 0]);
    expect(weatherProbe()).toMatchObject({ currWeather: 0, palProcessingState: t.d('WEATHER_PAL_STATE_IDLE') });
    expect(shown).toEqual(UNFADED);
    expect(objTables).toEqual({ normal: undefined, alt: undefined });

    // And back to the shade the slow way: one step every 20 frames
    SetSavedWeather(t.d('WEATHER_SHADE'));
    DoCurrentWeather();
    const steps: number[] = [];
    for (let frame = 1; frame <= 70; frame++) {
      const before = weatherProbe().gammaIndex;
      WeatherTask();
      if (weatherProbe().gammaIndex !== before) steps.push(frame);
    }
    expect(steps).toEqual([20, 40, 60]);
  });

  test('a map without a weather fade waits for the palette fade and takes the target index', () => {
    ResetWeatherTask();
    SetSavedWeather(t.d('WEATHER_SUNNY'));
    StartWeather();
    ResumePausedWeather();
    expect(WeatherFadeScreen(t.d('FADE_FROM_BLACK'))).toBe(false);
    WeatherTask();
    WeatherTask();
    expect(weatherProbe()).toMatchObject({ currWeather: t.d('WEATHER_SUNNY'), gammaIndex: 0, palProcessingState: t.d('WEATHER_PAL_STATE_IDLE') });
  });
});

/** The distinct BLDALPHA values written, in order. */
const distinct = (writes: [number, number][]) => writes.filter((w, i) => i === 0 || w[0] !== writes[i - 1][0] || w[1] !== writes[i - 1][1]);

describe('WEATHER_FOG_HORIZONTAL', () => {
  test('entering the fog: sprites and blend (12, 8) at once, the 16-frame fade in, the scroll; leaving it fades the fog out', () => {
    ResetWeatherTask();
    bldalpha = [];
    fogSprites = { created: 0, destroyed: 0 };
    spriteCoordOffsetX = 0;
    SetSavedWeather(t.d('WEATHER_FOG_HORIZONTAL'));
    StartWeather();
    ResumePausedWeather();
    expect(bldalpha, 'StartWeather: Weather_SetBlendCoeffs(16, 0)').toEqual([[16, 0]]);
    expect(WeatherFadeScreen(t.d('FADE_FROM_BLACK')), 'the fog fades the screen in itself').toBe(true);
    expect(WeatherFadeInBlend()).toBe(16);
    bldalpha = [];
    WeatherTask(); // Task_WeatherInit: FogHorizontal_InitAll runs Main until the blend is reached
    expect(fogSprites).toEqual({ created: 1, destroyed: 0 });
    // InitVars: (0, 16); then a step every 4 frames (delay 3), EVA on odd steps, EVB on even ones
    const expected: [number, number][] = [[0, 16]];
    for (let k = 1; k <= 23; k++) expected.push([Math.min(12, Math.ceil(k / 2)), Math.max(8, 16 - Math.floor(k / 2))]);
    expect(distinct(bldalpha)).toEqual(distinct(expected));
    expect(weatherProbe()).toMatchObject({ task: 'Task_WeatherMain', blendEVA: 12, blendEVB: 8, gammaTargetIndex: 0 });
    // 1 + 92 Main calls: fogHScrollOffset 23, so fogHScrollPosX = (0 - 23) & 0xff
    expect(weatherProbe().fogHScrollPosX).toBe(233);

    // The fade in: ApplyFogBlend(16 - fadeScreenCounter) for counters 1-16, then idle
    const blends: (number | undefined)[] = [];
    const scroll: (number | undefined)[] = [];
    for (let i = 0; i < 17; i++) {
      WeatherTask();
      blends.push(WeatherFadeInBlend());
      scroll.push(weatherProbe().fogHScrollPosX);
    }
    expect(blends).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, undefined]);
    expect(weatherProbe()).toMatchObject({ gammaIndex: 0, palProcessingState: t.d('WEATHER_PAL_STATE_IDLE') });
    // The fog drifts a pixel left every 4 frames (the 94th Main call is the first here)
    expect(scroll.slice(0, 8)).toEqual([233, 233, 233, 232, 232, 232, 232, 231]);
    // The BG palettes as loaded; the GAMMA_NORMAL sheets lightened (BlendPalette(12, RGB(28, 31, 28))), not the objects'
    expect(shown).toEqual(UNFADED);
    expect(objTables.alt).toBeUndefined();
    const [r, g, b] = objTables.normal as [Uint8Array, Uint8Array, Uint8Array];
    // c + ((target - c) * 12 >> 4), worked out: 31 -> 28 (-36 >> 4 = -3), 0 -> 21 / 23 / 21, 16 -> 25 / 27 / 25
    expect([r[31], g[31], b[31]]).toEqual([28, 31, 28]);
    expect([r[0], g[0], b[0]]).toEqual([21, 23, 21]);
    expect([r[16], g[16], b[16]]).toEqual([25, 27, 25]);

    // The camera moves a tile right: gSpriteCoordOffsetX - 16, the fog with it
    const before = weatherProbe().fogHScrollPosX!;
    spriteCoordOffsetX = -16;
    WeatherTask();
    expect((before - weatherProbe().fogHScrollPosX! + 256) & 0xff).toBeGreaterThanOrEqual(16);
    expect((before - weatherProbe().fogHScrollPosX! + 256) & 0xff).toBeLessThanOrEqual(17);

    // doweather to NONE: FogHorizontal_Finish fades the blend back to (0, 16) (23 steps, one every 4 frames), then
    // the sprites go, then the next weather starts
    bldalpha = [];
    SetSavedWeather(t.d('WEATHER_NONE'));
    DoCurrentWeather();
    let frames = 0;
    let destroyedAt = 0;
    while (weatherProbe().currWeather !== t.d('WEATHER_NONE') && frames < 200) {
      WeatherTask();
      frames++;
      if (!destroyedAt && fogSprites.destroyed) destroyedAt = frames;
    }
    const out: [number, number][] = [[12, 8]];
    for (let k = 1; k <= 23; k++) out.push([Math.max(0, 12 - Math.ceil(k / 2)), Math.min(16, 8 + Math.floor(k / 2))]);
    expect(distinct(bldalpha)).toEqual(distinct(out));
    expect(destroyedAt, 'step 0 (1 frame), step 1 (92), then DestroyFogHorizontalSprites').toBe(94);
    expect(frames, 'and FogHorizontal_Finish returns FALSE a frame later').toBe(95);
    expect(fogSprites.destroyed).toBe(1);
    expect(weatherProbe().fogHScrollPosX).toBeUndefined();
  });

  test('a warp out of the fog: StartWeather drops its sprites (the map load freed them) and blends (16, 0)', () => {
    ResetWeatherTask();
    SetSavedWeather(t.d('WEATHER_FOG_HORIZONTAL'));
    StartWeather();
    ResumePausedWeather();
    WeatherFadeScreen(t.d('FADE_FROM_BLACK'));
    WeatherTask();
    fogSprites = { created: 0, destroyed: 0 };
    bldalpha = [];
    ResetWeatherTask();
    SetSavedWeather(t.d('WEATHER_NONE'));
    StartWeather();
    expect(fogSprites).toEqual({ created: 0, destroyed: 1 });
    expect(bldalpha).toEqual([[16, 0]]);
    expect(weatherProbe().fogHScrollPosX).toBeUndefined();
  });

  test('WEATHER_UNDERWATER shares the callbacks: blend (4, 16) at delay 0, and a normal palette fade', () => {
    ResetWeatherTask();
    bldalpha = [];
    SetSavedWeather(t.d('WEATHER_UNDERWATER'));
    StartWeather();
    ResumePausedWeather();
    expect(WeatherFadeScreen(t.d('FADE_FROM_BLACK'))).toBe(false);
    WeatherTask();
    expect(weatherProbe()).toMatchObject({ blendEVA: 4, blendEVB: 16 });
    expect(distinct(bldalpha).slice(-5)).toEqual([[0, 16], [1, 16], [2, 16], [3, 16], [4, 16]]);
    WeatherTask();
    expect(weatherProbe().palProcessingState).toBe(t.d('WEATHER_PAL_STATE_IDLE'));
  });
});

describe('the saved weather', () => {
  test('setweather / resetweather: translated as TranslateWeatherNum does; rain counts GAME_STAT_GOT_RAINED_ON', () => {
    SetMapHeaderWeather(t.d('WEATHER_FOG_HORIZONTAL'));
    SetSavedWeatherFromCurrMapHeader();
    expect(GetSav1Weather()).toBe(t.d('WEATHER_FOG_HORIZONTAL'));
    SetSavedWeather(t.d('WEATHER_ROUTE119_CYCLE'));
    expect(GetSav1Weather()).toBe(t.d('WEATHER_SUNNY'));
    SetSavedWeather(99);
    expect(GetSav1Weather()).toBe(t.d('WEATHER_NONE'));
    const stat = t.d('GAME_STAT_GOT_RAINED_ON');
    const before = t.state.getGameStat(stat);
    SetSavedWeather(t.d('WEATHER_RAIN'));
    SetSavedWeather(t.d('WEATHER_RAIN'));
    expect(t.state.getGameStat(stat)).toBe(before + 1);
  });

  test('an unported weather runs as WEATHER_NONE and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ResetWeatherTask();
    SetSavedWeather(t.d('WEATHER_FOG_DIAGONAL'));
    StartWeather();
    ResumePausedWeather();
    WeatherFadeScreen(t.d('FADE_FROM_BLACK'));
    for (let i = 0; i < 5; i++) WeatherTask();
    expect(weatherProbe()).toMatchObject({ currWeather: t.d('WEATHER_FOG_DIAGONAL'), gammaIndex: 0 });
    expect(warn.mock.calls.filter(([m]) => /weather 9 \(FogDiagonal\)/.test(String(m)))).toHaveLength(1);
    warn.mockRestore();
  });
});
