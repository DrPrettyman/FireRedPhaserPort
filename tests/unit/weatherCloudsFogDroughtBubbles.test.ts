// field_weather_effects.c's Clouds_*, FogDiagonal_*, Drought_* (with field_weather.c's drought half) and Bubbles_*
// (world/weatherClouds.ts, weatherFogDiagonal.ts, weatherDrought.ts, weatherBubbles.ts), frame by frame against the
// C worked out by hand: Weather_UpdateBlend moves EVA on odd updates and EVB on even ones, one update every
// blendDelay + 1 frames, so (0, 16) → (12, 8) takes 23 updates (EVA's 12 on updates 1, 3, ..., 23; EVB's 8 on 2, ...,
// 16); a 64x64 sprite's OAM corner is its centre less 32; the drought's sine stage is ((gSineTable[i] - 1) >> 6) + 2.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { gSineTable } from '../../src/battle/trig';
import {
  type ChannelTables,
  DoCurrentWeather,
  gWeatherPtr,
  loadWeatherData,
  ResetWeatherTask,
  ResumePausedWeather,
  SetSavedWeather,
  setWeatherHost,
  StartWeather,
  WeatherFadeInBlend,
  WeatherFadeScreen,
  weatherProbe,
  WeatherTask,
} from '../../src/world/weather';
import { sBubbleStartCoords, sBubbleStartDelays } from '../../src/world/weatherBubbles';
import { sCloudSpriteMapCoords } from '../../src/world/weatherClouds';
import { Drought_InitAll, DroughtStateInit, DroughtStateRun, droughtFrameDelay, LoadDroughtWeatherPalettes, ResetDroughtWeatherPaletteLoading, StartDroughtWeatherBlend } from '../../src/world/weatherDrought';
import { AnimateWeatherSprites, BuildWeatherOam, GFXTAG_BUBBLE, GFXTAG_CLOUD, GFXTAG_FOG_D, gWeatherSprites, weatherSpritePalette, weatherSpriteSheet } from '../../src/world/weatherSprites';
import { newBattleEnv, type TestGame } from './gameData';

let t: TestGame;
let spriteCoordOffset = { x: 0, y: 0 };
let bldalpha: [number, number][] = [];
let fogH = { created: 0, destroyed: 0 };
let lighten: (number | undefined)[] = [];
/** BG palette 0 as shown, and the OBJ tables the host was handed. */
let shown: number[] = [];
let objTables: { normal?: ChannelTables; alt?: ChannelTables } = {};
/** One BG palette of JASC colours: 5-bit c expanded as the decomp's .pal files hold them. */
const UNFADED = Array.from({ length: 48 }, (_, i) => Math.floor(((i % 32) * 255) / 31));
const expand = (c: number) => Math.floor((c * 255) / 31);

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
    bgPaletteUnfaded: (slot) => (slot === 0 ? UNFADED : undefined),
    setBgPaletteFaded: (slot, colors) => {
      if (slot === 0) shown = colors;
    },
    setObjPaletteGamma: (normal, alt) => (objTables = { normal, alt }),
    setBlendAlpha: (eva, evb) => bldalpha.push([eva, evb]),
    createFogHorizontalSprites: () => fogH.created++,
    destroyFogHorizontalSprites: () => fogH.destroyed++,
    spriteCoordOffsetX: () => spriteCoordOffset.x,
    spriteCoordOffsetY: () => spriteCoordOffset.y,
    // a camera with map coords (7, 7) at the screen's top-left corner, plus gSpriteCoordOffsetX / Y
    mapCoordsToSpritePos: (mapX, mapY) => ({ x: (mapX - 7) * 16 - spriteCoordOffset.x, y: (mapY - 7) * 16 - spriteCoordOffset.y }),
    setBrightnessLighten: (evy) => lighten.push(evy),
  });
});

beforeEach(() => {
  spriteCoordOffset = { x: 0, y: 0 };
  bldalpha = [];
  fogH = { created: 0, destroyed: 0 };
  lighten = [];
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

/** doweather to `weather`, then the frame Task_WeatherMain finishes WEATHER_NONE and runs its InitVars. */
function changeTo(weather: string) {
  SetSavedWeather(t.d(weather));
  DoCurrentWeather();
  frame();
  expect(weatherProbe().currWeather).toBe(t.d(weather));
}

const inUse = (tag: number) => gWeatherSprites.filter((s) => s.inUse && s.template.tileTag === tag);
const blend = () => [gWeatherPtr.currBlendEVA, gWeatherPtr.currBlendEVB];

/** The frames until `cond`, at most `max`. */
function framesUntil(cond: () => boolean, max = 1000): number {
  for (let n = 1; n <= max; n++) {
    frame();
    if (cond()) return n;
  }
  throw new Error('never');
}

describe('WEATHER_SUNNY_CLOUDS', () => {
  test('doweather: three 64x64 BLEND clouds at priority 3 on the map grid (gCloudsWeatherPalette), BLDALPHA (0, 16) → (12, 8) in 46 frames, a pixel left every 2 frames', () => {
    fieldWithoutWeather();
    changeTo('WEATHER_SUNNY_CLOUDS');
    expect(blend(), 'Clouds_InitVars: Weather_SetBlendCoeffs(0, 16)').toEqual([0, 16]);
    expect(weatherProbe()).toMatchObject({ gammaTargetIndex: 0, initStep: 0 });
    frame(); // CreateCloudSprites
    const clouds = inUse(GFXTAG_CLOUD);
    expect(clouds).toHaveLength(3);
    expect(weatherSpritePalette()).toBe('gCloudsWeatherPalette');
    expect(weatherSpriteSheet(GFXTAG_CLOUD)).toMatchObject({ data: 'gWeatherCloudTiles', size: 0x800 });
    // SetSpritePosToMapCoords(x + 7, y + 7): the tile's corner; then UpdateCloudSprite already ran once (x - 1)
    expect(clouds.map((s) => [s.x, s.y])).toEqual(sCloudSpriteMapCoords.map(([x, y]) => [x * 16 - 1, y * 16]));
    const oam = BuildWeatherOam(0, 0);
    expect(oam).toHaveLength(3);
    expect(oam.every((o) => o.blend && o.priority === 3 && o.subpriority === 0xff && o.width === 64 && o.height === 64 && o.coordOffsetEnabled)).toBe(true);
    // Weather_SetTargetBlendCoeffs(12, 8, 1), then an update every 2 frames: 23 of them
    frame();
    const n = framesUntil(() => gWeatherPtr.weatherGfxLoaded);
    expect(n).toBe(46);
    expect(blend()).toEqual([12, 8]);
    // the values BLDALPHA went through: EVA up and EVB down in turn until EVB is at 8, then EVA alone
    const expected: number[][] = [[0, 16]];
    for (let u = 1, eva = 0, evb = 16; u <= 23; u++) {
      if (u & 1) eva++;
      else if (evb > 8) evb--;
      if (eva !== expected[expected.length - 1][0] || evb !== expected[expected.length - 1][1]) expected.push([eva, evb]);
    }
    const writes = bldalpha.slice(bldalpha.findIndex(([a, b]) => a === 0 && b === 16)); // (from Clouds_InitVars' on)
    expect(writes.filter((b, i) => i === 0 || b[0] !== writes[i - 1][0] || b[1] !== writes[i - 1][1])).toEqual(expected);
    // the drift: x - 1 on odd frames since creation (data[0] toggles to 1 first)
    const x0 = clouds[0].x;
    for (let i = 0; i < 10; i++) frame();
    expect(clouds[0].x).toBe(x0 - 5);
    // the camera: coordOffsetEnabled sprites move with gSpriteCoordOffsetX / Y (OAM's 9-bit x, 8-bit y)
    const o = BuildWeatherOam(16, -8).find((s) => s.id === gWeatherSprites.indexOf(clouds[0]))!;
    expect([(o.x + 512) & 0x1ff, (o.y + 256) & 0xff]).toEqual([(clouds[0].x - 32 + 16) & 0x1ff, (clouds[0].y - 32 - 8) & 0xff]);
  });

  test('a change back to WEATHER_NONE: Clouds_Finish blends back to (0, 16) in 46 frames, then the clouds go (the palette stays the clouds\')', () => {
    fieldWithoutWeather();
    changeTo('WEATHER_SUNNY_CLOUDS');
    framesUntil(() => gWeatherPtr.weatherGfxLoaded);
    SetSavedWeather(0);
    DoCurrentWeather();
    frame(); // Clouds_Finish case 0
    const n = framesUntil(() => inUse(GFXTAG_CLOUD).length === 0);
    expect(n).toBe(46);
    expect(blend()).toEqual([0, 16]);
    expect(weatherSpriteSheet(GFXTAG_CLOUD), 'FreeSpriteTilesByTag').toBeUndefined();
    expect(gWeatherPtr.cloudSpritesCreated).toBe(false);
    frame();
    expect(weatherProbe().currWeather).toBe(t.d('WEATHER_NONE'));
    expect(weatherSpritePalette(), 'nothing loads the default palette back until StartWeather').toBe('gCloudsWeatherPalette');
  });

  test('a fade in (a warp into the clouds): Clouds_InitAll sets up the sprites and the (12, 8) blend at once', () => {
    ResetWeatherTask();
    SetSavedWeather(t.d('WEATHER_SUNNY_CLOUDS'));
    StartWeather();
    ResumePausedWeather();
    WeatherFadeScreen(t.d('FADE_FROM_BLACK'));
    frame();
    expect(inUse(GFXTAG_CLOUD)).toHaveLength(3);
    expect(blend()).toEqual([12, 8]);
    expect(weatherProbe()).toMatchObject({ weatherGfxLoaded: true, initStep: 3 });
  });
});

describe('WEATHER_FOG_DIAGONAL', () => {
  /** UpdateFogDiagonalSprite's x for a column after `f` movement updates (fogDXOffset = f / 3), the camera at 0. */
  const fogX = (f: number, col: number) => {
    const base = -Math.floor(f / 3) & 0xff;
    const x = base + 32 + col * 64;
    return x >= 240 + 32 ? (base + 480 - (4 - col) * 64) & 0x1ff : x;
  };

  test('doweather: 20 BLEND sprites in 5 columns x 4 rows at priority 2, a pixel left every 3 frames and down every 5, BLDALPHA → (12, 8) a step every 9 frames', () => {
    fieldWithoutWeather();
    changeTo('WEATHER_FOG_DIAGONAL');
    expect(blend()).toEqual([0, 16]);
    expect(gWeatherPtr).toMatchObject({ fogHScrollOffset: 1, fogDXOffset: 0, fogDYOffset: 0 });
    frame(); // UpdateFogDiagonalMovement (1), CreateFogDiagonalSprites, then their callbacks
    const fog = inUse(GFXTAG_FOG_D);
    expect(fog).toHaveLength(20);
    for (let f = 1; f <= 40; f++) {
      if (f > 1) frame();
      for (const s of fog) {
        const [col, row] = [s.data[0], s.data[1]];
        expect([s.x, s.y, s.y2], `sprite (${col}, ${row}) at frame ${f}`).toEqual([fogX(f, col), row * 64, Math.floor(f / 5)]);
      }
    }
    const oam = BuildWeatherOam(0, 0);
    expect(oam).toHaveLength(20);
    expect(oam.every((o) => o.blend && o.priority === 2 && o.width === 64 && !o.coordOffsetEnabled)).toBe(true);
    // Weather_SetTargetBlendCoeffs(12, 8, 8) on frame 2; 23 updates 9 frames apart
    const n = framesUntil(() => gWeatherPtr.weatherGfxLoaded);
    expect(38 + n).toBe(23 * 9);
    expect(blend()).toEqual([12, 8]);
  });

  test('the camera: fogDBaseSpritesX = (gSpriteCoordOffsetX - fogDXOffset) & 0xFF, fogDPosY = gSpriteCoordOffsetY + fogDYOffset', () => {
    fieldWithoutWeather();
    changeTo('WEATHER_FOG_DIAGONAL');
    frame();
    spriteCoordOffset = { x: 20, y: -40 };
    frame();
    expect(gWeatherPtr.fogDBaseSpritesX).toBe((20 - 0) & 0xff);
    expect(gWeatherPtr.fogDPosY).toBe((-40 + 0) & 0xffff);
    expect(inUse(GFXTAG_FOG_D)[0].y2, 'y2 is the s16 of fogDPosY').toBe(-40);
  });

  test('a change back to WEATHER_NONE: (0, 16) a step every 2 frames, then the sprites go', () => {
    fieldWithoutWeather();
    changeTo('WEATHER_FOG_DIAGONAL');
    framesUntil(() => gWeatherPtr.weatherGfxLoaded, 2000);
    SetSavedWeather(0);
    DoCurrentWeather();
    frame(); // case 0
    const n = framesUntil(() => blend()[0] === 0 && blend()[1] === 16);
    expect(n).toBe(46);
    expect(inUse(GFXTAG_FOG_D)).toHaveLength(20);
    frame(); // DestroyFogDiagonalSprites
    expect(inUse(GFXTAG_FOG_D)).toHaveLength(0);
    expect(weatherSpriteSheet(GFXTAG_FOG_D)).toBeUndefined();
    frame();
    expect(weatherProbe().currWeather).toBe(0);
  });
});

describe('WEATHER_UNDERWATER_BUBBLES', () => {
  test('doweather: the fog half (sprites, BLDALPHA (4, 16): delay 0), a bubble at once then after sBubbleStartDelays + 1 frames each, from sBubbleStartCoords in turn', () => {
    fieldWithoutWeather();
    spriteCoordOffset = { x: 0, y: 8 };
    changeTo('WEATHER_UNDERWATER_BUBBLES');
    expect(weatherSpriteSheet(GFXTAG_BUBBLE)).toMatchObject({ data: 'gWeatherBubbleTiles', size: 0x40 });
    expect(gWeatherPtr).toMatchObject({ bubblesDelayCounter: 40, bubblesDelayIndex: 0, bubblesCoordsIndex: 0, bubblesSpriteCount: 0 });
    const created: { frame: number; x: number; y: number }[] = [];
    for (let f = 1; f <= 600; f++) {
      frame();
      // a bubble made this frame has had its callback once (tCounter 1, up 3)
      for (const s of inUse(GFXTAG_BUBBLE)) if (s.data[2] === 1) created.push({ frame: f, x: s.x, y: s.y + 3 });
      if (f === 1) {
        expect(fogH.created, 'FogHorizontal_Main: CreateFogHorizontalSprites').toBe(1);
        expect(blend(), 'WEATHER_UNDERWATER_BUBBLES is not WEATHER_FOG_HORIZONTAL: (4, 16, 0)').toEqual([0, 16]);
      }
    }
    expect(blend()).toEqual([4, 16]);
    expect(created[0]).toEqual({ frame: 1, x: sBubbleStartCoords[0][0], y: sBubbleStartCoords[0][1] - 8 });
    const gaps = created.slice(1).map((c, i) => c.frame - created[i].frame);
    expect(gaps.slice(0, 5)).toEqual(sBubbleStartDelays.slice(1, 6).map((d) => d + 1));
    expect(created.slice(0, 5).map((c) => c.x)).toEqual(sBubbleStartCoords.slice(0, 5).map(([x]) => x));
    expect(gWeatherPtr.bubblesSpriteCount).toBeGreaterThanOrEqual(created.length);
  });

  test('a bubble: 8x8 NORMAL at priority 1, up 3 a frame, x2 swaying 0-5 (a step every 5 frames), gone after 120 frames', () => {
    fieldWithoutWeather();
    changeTo('WEATHER_UNDERWATER_BUBBLES');
    frame();
    const [bubble] = inUse(GFXTAG_BUBBLE);
    const y0 = bubble.y;
    const x2s: number[] = [bubble.x2];
    for (let f = 2; f <= 119; f++) {
      frame();
      expect(bubble.inUse).toBe(true);
      x2s.push(bubble.x2);
    }
    expect(bubble.y).toBe(y0 - 3 * 118);
    expect(x2s.slice(0, 31)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 4, 4]);
    const o = BuildWeatherOam(0, 0).find((s) => s.id === gWeatherSprites.indexOf(bubble))!;
    expect(o).toMatchObject({ width: 8, height: 8, priority: 1, subpriority: 0, blend: false, coordOffsetEnabled: true });
    frame();
    expect(bubble.inUse, 'tCounter 120: DestroySprite').toBe(false);
  });

  test('a change back to WEATHER_NONE: the fog fades out (FogHorizontal_Finish), then every bubble goes with the sheet', () => {
    fieldWithoutWeather();
    changeTo('WEATHER_UNDERWATER_BUBBLES');
    for (let f = 0; f < 200; f++) frame();
    expect(inUse(GFXTAG_BUBBLE).length).toBeGreaterThan(0);
    fogH.destroyed = 0;
    SetSavedWeather(0);
    DoCurrentWeather();
    framesUntil(() => weatherProbe().currWeather === 0);
    expect(fogH.destroyed).toBe(1);
    expect(inUse(GFXTAG_BUBBLE)).toHaveLength(0);
    expect(weatherSpriteSheet(GFXTAG_BUBBLE)).toBeUndefined();
    expect(blend()).toEqual([0, 16]);
  });
});

describe('WEATHER_DROUGHT', () => {
  test('LoadDroughtWeatherPalettes is TRUE for ever (FRLG dummied LoadDroughtWeatherPalette out)', () => {
    ResetDroughtWeatherPaletteLoading();
    expect(gWeatherPtr).toMatchObject({ loadDroughtPalsIndex: 1, loadDroughtPalsOffset: 1 });
    for (let i = 0; i < 100; i++) expect(LoadDroughtWeatherPalettes()).toBe(true);
  });

  test('doweather: Drought_Main waits for the palettes (gamma to 0), then sticks at step 2; the palettes as loaded', () => {
    fieldWithoutWeather();
    shown = [];
    changeTo('WEATHER_DROUGHT');
    // (Task_WeatherMain's CHANGING_WEATHER: UpdateWeatherGammaShift found the gamma at its target 0 and went idle)
    expect(weatherProbe()).toMatchObject({ gammaTargetIndex: 0, initStep: 0, palProcessingState: 3 });
    for (let i = 0; i < 300; i++) frame();
    expect(weatherProbe()).toMatchObject({ currWeather: t.d('WEATHER_DROUGHT'), initStep: 2, weatherGfxLoaded: false, gammaIndex: 0, palProcessingState: 3 });
    expect(shown, 'no palette written').toEqual([]);
  });

  test('Drought_InitAll: the GBA never leaves its loop; the port stops where Main would spin at step 2, and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Drought_InitAll();
    Drought_InitAll();
    expect(gWeatherPtr).toMatchObject({ initStep: 2, weatherGfxLoaded: false });
    expect(warn.mock.calls.filter(([m]) => /Drought_InitAll/.test(String(m)))).toHaveLength(1);
    warn.mockRestore();
  });

  test('FadeInScreen_Drought: 15 frames of the fade colour 16 - n / 16 over the colours as loaded, then the palettes stay blended 1/16 toward it; gamma index -6', () => {
    ResetWeatherTask();
    SetSavedWeather(t.d('WEATHER_DROUGHT'));
    StartWeather();
    ResumePausedWeather();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    shown = [];
    // the first fade in: Task_WeatherInit's frame (Drought_InitAll) has no palette processing; then a fade from white
    const fades = [
      ['FADE_FROM_BLACK', 0, [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, undefined]],
      ['FADE_FROM_WHITE', 31, [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, undefined, undefined]],
    ] as const;
    for (const [mode, target, expectedBlends] of fades) {
      expect(WeatherFadeScreen(t.d(mode)), 'useWeatherPal').toBe(true);
      const blends: (number | undefined)[] = [];
      for (let i = 0; i < 17; i++) {
        frame();
        blends.push(WeatherFadeInBlend());
        if (blends[i] !== undefined && blends[i]! < 16) expect(shown, 'the colours as loaded under the overlay').toEqual(UNFADED);
      }
      expect(blends).toEqual(expectedBlends);
      expect(weatherProbe()).toMatchObject({ gammaIndex: -6, palProcessingState: 3 });
      // r1 += ((rBlend - r1) * 1) >> 4 (an arithmetic shift: 31 → 29 toward black, 0 → 1 toward white)
      const step = (c: number) => c + ((target - c) >> 4);
      expect(shown).toEqual(UNFADED.map((v) => expand(step(v >> 3))));
      const table = Uint8Array.from({ length: 32 }, (_, c) => step(c));
      expect(objTables.normal).toEqual([table, table, table]);
      expect(objTables.alt).toEqual([table, table, table]);
    }
    warn.mockRestore();
  });

  test('DroughtStateRun: a brightness stage every 6 frames up to 6 (gamma -1 ... -6), then the sine: stage ((gSineTable[t] - 1) >> 6) + 2, t += 3 from 60', () => {
    fieldWithoutWeather();
    shown = [];
    DroughtStateInit();
    expect(droughtFrameDelay()).toBe(5);
    const gammas: number[] = [];
    for (let f = 1; f <= 36; f++) {
      DroughtStateRun();
      if (f % 6 === 0) gammas.push(weatherProbe().gammaIndex);
      else expect(gWeatherPtr.droughtTimer).toBe(f % 6);
    }
    expect(gammas, 'SetDroughtGamma(stage): gamma index -stage - 1').toEqual([-1, -2, -3, -4, -5, -6]);
    expect(gWeatherPtr).toMatchObject({ droughtBrightnessStage: 6, droughtLastBrightnessStage: 6, droughtState: 1, droughtTimer: 60 });
    let timer = 60;
    let last = 6;
    for (let f = 0; f < 100; f++) {
      DroughtStateRun();
      timer = (timer + 3) & 0x7f;
      const stage = ((gSineTable(timer) - 1) >> 6) + 2;
      expect(gWeatherPtr.droughtBrightnessStage).toBe(stage);
      if (stage !== last) expect(weatherProbe().gammaIndex).toBe(-stage - 1);
      last = stage;
    }
    // ramp down (state 2, which nothing sets): a stage every 6 frames until 3, then ramp up again
    gWeatherPtr.droughtState = 2;
    gWeatherPtr.droughtBrightnessStage = 5;
    gWeatherPtr.droughtTimer = 0;
    for (let f = 0; f < 12; f++) DroughtStateRun();
    expect(gWeatherPtr).toMatchObject({ droughtBrightnessStage: 3, droughtState: 0 });
    expect(shown, 'ApplyGammaShift does nothing for a negative index in FRLG').toEqual([]);
  });

  test('StartDroughtWeatherBlend: BLDY lighten 3, 6, ..., 16, then down a step every 10 frames, off, then the script goes on', () => {
    let task: { tick(): boolean } | undefined;
    let enabled = false;
    StartDroughtWeatherBlend((tk) => (task = tk), () => (enabled = true));
    const ticks: boolean[] = [];
    for (let i = 0; i < 6 + 160 + 3; i++) ticks.push(task!.tick());
    expect(lighten.slice(0, 7)).toEqual([0, 3, 6, 9, 12, 15, 16]);
    expect(lighten.slice(7, 23)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(lighten[23], 'BLDCNT 0, WININ back').toBeUndefined();
    expect(lighten).toHaveLength(24);
    expect(ticks.indexOf(true), 'state 4: ScriptContext_Enable + DestroyTask').toBe(6 + 160 + 1);
    expect(enabled).toBe(true);
  });
});
