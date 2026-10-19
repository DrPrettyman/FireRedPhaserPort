// field_weather.c (world/weather.ts): BuildGammaShiftTables against the C's arithmetic worked out by hand, the
// weather task's palette processing (the fade in with the shade's palettes, a weather change's gamma steps) and the
// saved weather (setweather / doweather / resetweather's functions).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import {
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
let objTables: { normal?: Uint8Array; alt?: Uint8Array };
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
    SetSavedWeather(t.d('WEATHER_SNOW'));
    StartWeather();
    ResumePausedWeather();
    WeatherFadeScreen(t.d('FADE_FROM_BLACK'));
    for (let i = 0; i < 5; i++) WeatherTask();
    expect(weatherProbe()).toMatchObject({ currWeather: t.d('WEATHER_SNOW'), gammaIndex: 0 });
    expect(warn.mock.calls.filter(([m]) => /weather 4 \(Snow\)/.test(String(m)))).toHaveLength(1);
    warn.mockRestore();
  });
});
