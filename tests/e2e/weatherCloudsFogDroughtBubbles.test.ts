// The unused weathers of W-weather 3 (field_weather_effects.c's Clouds_*, FogDiagonal_*, Drought_*, Bubbles_*:
// world/weatherClouds.ts, weatherFogDiagonal.ts, weatherDrought.ts, weatherBubbles.ts), through `setweather` +
// `doweather` (`__test.doWeather`): no FRLG map has them. The sprites' count and positions over a few frames, the
// BLDALPHA blend and a blended pixel read back from the screen, the drought's fade in, its BLDY flash
// (StartDroughtWeatherBlend), the bubbles, and each weather's finish.
//
// Expected values come from the C, worked out here: a cloud is centred on its map tile's top-left corner
// (SetSpritePosToMapCoords(x + 7, y + 7)), which with the player at (px, py) is screen (16 (x - px) + 112,
// 16 (y - py) + 72); a 64x64 sprite's OAM corner is its centre less 32 (OAM's 9-bit x and 8-bit y wrap); a diagonal
// fog column's x is ((gSpriteCoordOffsetX - fogDXOffset) & 0xFF) + 32 + 64 col (or the wrapped one), its y
// 64 row + gSpriteCoordOffsetY + fogDYOffset; BLDALPHA is min(31, (obj * EVA + bg * EVB) >> 4); FRLG's drought fade
// in leaves the palettes at c + ((dest - c) >> 4).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const WEATHER_NONE = 0;
const WEATHER_SUNNY_CLOUDS = 1;
const WEATHER_FOG_DIAGONAL = 9;
const WEATHER_DROUGHT = 12;
const WEATHER_UNDERWATER_BUBBLES = 14;
/** include/field_weather.h's GFXTAG_* */
const GFXTAG_CLOUD = 0x1200;
const GFXTAG_FOG_D = 0x1203;
const GFXTAG_BUBBLE = 0x1205;

const HOUSE = { start: 'after-rival', map: 'PalletTown_PlayersHouse_2F', x: 6, y: 6 } as const;
/** Outdoors: the ground is BG3 (the house's floor is drawn over priority-3 sprites), and a cloud is on screen. */
const PALLET = { start: 'after-rival', map: 'PalletTown', x: 8, y: 14 } as const;

async function startedIdle(game: Game) {
  await game.waitIdle();
  await game.waitFor((t) => t.weather()!.palProcessingState === 3, { what: 'the weather idle' });
}

const to5 = (v: number) => v >> 3;
const expand = (c: number) => Math.floor((c * 255) / 31);

/**
 * Freeze the weather's sprites (their callbacks no-ops, test-only), then read ~`n` of the front blended sprite's
 * opaque pixels inside `box`: the sprite's colour, the screen under it (sprites hidden) and as shown.
 */
function blendedPixels(game: Game, box: { x0: number; y0: number; x1: number; y1: number }, n: number) {
  return game.eval(
    async (t, box, n) => {
      const sprites = await new Function('p', 'return import(p)')('/src/world/weatherSprites.ts');
      for (const s of sprites.gWeatherSprites) if (s.inUse) s.callback = () => {};
      await t.waitFrames(2);
      const opaque: [number, number][] = [];
      for (let y = Math.max(0, box.y0); y < Math.min(160, box.y1); y += 2) {
        for (let x = Math.max(0, box.x0); x < Math.min(240, box.x1); x += 2) if (t.weatherSprites(x, y)!.pixel?.blend) opaque.push([x, y]);
      }
      const pick = opaque.filter((_, i) => i % Math.max(1, Math.floor(opaque.length / n)) === 0).slice(0, n);
      // (one screenPixel at a time: Phaser keeps one snapshot request per render). The field under it before and
      // after: an animated tile (Pallet Town's flowers) can change between the reads, so those pixels are left out.
      const out: { x: number; y: number; sprite: number[]; under: number[]; shown: number[] }[] = [];
      for (const [x, y] of pick) {
        t.weatherSprites(undefined, undefined, false);
        const under = await t.screenPixel(x, y);
        t.weatherSprites(undefined, undefined, true);
        const shown = await t.screenPixel(x, y);
        t.weatherSprites(undefined, undefined, false);
        const under2 = await t.screenPixel(x, y);
        t.weatherSprites(undefined, undefined, true);
        if (under.every((v, c) => v === under2[c])) out.push({ x, y, sprite: t.weatherSprites(x, y)!.pixel!.rgb, under, shown });
      }
      const probe = t.weatherSprites()!;
      return { eva: probe.eva, evb: probe.evb, out };
    },
    box,
    n,
  );
}

/** BLDALPHA of a sprite pixel over the BG pixel, 8-bit colours from the 5-bit sum. */
const bldalpha = (sprite: number[], under: number[], eva: number, evb: number) => sprite.map((v, c) => expand(Math.min(31, (to5(v) * eva + to5(under[c]) * evb) >> 4)));
const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('clouds: three 64x64 blended clouds on the map grid (gCloudsWeatherPalette), BLDALPHA (12, 8) in 46 frames, a pixel left every 2 frames, blended over BG3; then back to none', async () => {
  const game = await session.start(PALLET);
  await startedIdle(game);
  const setUp = await game.eval(async (t) => {
    const w = await new Function('p', 'return import(p)')('/src/world/weather.ts');
    t.doWeather('WEATHER_SUNNY_CLOUDS');
    const start = t.frame();
    const frames: { frame: number; sprites: { id: number; x: number; y: number }[]; eva: number; evb: number }[] = [];
    await t.until(() => {
      const p = t.weatherSprites()!;
      frames.push({ frame: t.frame() - start, sprites: p.sprites.map((s) => ({ id: s.id, x: s.x, y: s.y, tag: s.tag, priority: s.priority, blend: s.blend })), eva: p.eva, evb: p.evb });
      return w.gWeatherPtr.weatherGfxLoaded;
    }, 400);
    return { frames, field: t.field()!, offset: t.weatherSprites()!.spriteCoordOffset, palette: (await new Function('p', 'return import(p)')('/src/world/weatherSprites.ts')).weatherSpritePalette() };
  });
  expect(setUp.palette).toBe('gCloudsWeatherPalette');
  const { frames } = setUp;
  const last = frames[frames.length - 1];
  expect([last.eva, last.evb]).toEqual([12, 8]);
  const first = frames.findIndex((f) => f.sprites.length > 0);
  expect(last.frame - frames[first].frame, 'set up (frame 1) to (12, 8): Weather_SetTargetBlendCoeffs a frame later, 23 updates 2 frames apart').toBe(47);
  // Where the clouds are: the player still, gSpriteCoordOffset 0; the frame they were made on drifted 1 already
  expect(setUp.offset).toEqual({ x: 0, y: -40 });
  expect([setUp.field.x, setUp.field.y]).toEqual([PALLET.x, PALLET.y]);
  const spots = [[0, 66], [5, 73], [10, 78]].map(([x, y]) => [16 * (x - PALLET.x) + 112 - 1 - 32, 16 * (y - PALLET.y) + 72 - 32]);
  const oamOf = ([x, y]: number[]) => [((x + 512) & 0x1ff) >= 256 ? ((x + 512) & 0x1ff) - 512 : (x + 512) & 0x1ff, (y & 0xff) + 64 > 256 ? (y & 0xff) - 256 : y & 0xff];
  const made = frames[first].sprites;
  expect(made).toHaveLength(3);
  expect(made.map((s) => [s.x, s.y]).sort()).toEqual(spots.map(oamOf).sort());
  // the drift: a pixel left every 2 frames, all three together
  for (let f = first + 1; f < frames.length; f++) {
    const dt = frames[f].frame - frames[first].frame;
    for (const s of frames[f].sprites) {
      const s0 = made.find((m) => m.id === s.id)!;
      expect(s.y).toBe(s0.y);
      expect((s0.x - s.x + 512) & 0x1ff, `cloud ${s.id} ${dt} frames on`).toBe(Math.floor(dt / 2));
      expect(s).toMatchObject({ tag: GFXTAG_CLOUD, priority: 3, blend: true });
    }
  }

  // The cloud on screen (sCloudSpriteMapCoords[2], made at (111, 40) over the path): BLDALPHA over BG3 where no upper
  // layer (or object) covers it
  const px = await blendedPixels(game, { x0: 0, y0: 30, x1: 240, y1: 110 }, 60);
  expect([px.eva, px.evb]).toEqual([12, 8]);
  expect(px.out.length).toBeGreaterThan(10);
  let blended = 0;
  for (const p of px.out) {
    if (near(p.shown, p.under, 0)) continue; // under BG1 / BG2 (priority 3 is behind them)
    expect(near(p.shown, bldalpha(p.sprite, p.under, 12, 8), 5), `(${p.x}, ${p.y}): ${p.shown} vs sprite ${p.sprite} over ${p.under}`).toBe(true);
    blended++;
  }
  expect(blended, 'about 10 of 55 samples are over BG3 alone').toBeGreaterThanOrEqual(5);

  // Back to none: Clouds_Finish blends to (0, 16) in 46 frames, then the clouds go
  const finish = await game.eval(async (t) => {
    t.doWeather('WEATHER_NONE');
    const start = t.frame();
    let gone = 0;
    await t.until(() => {
      if (!gone && t.weatherSprites()!.sprites.length === 0) gone = t.frame() - start;
      return t.weather()!.currWeather === 0;
    }, 400);
    return { gone, eva: t.weatherSprites()!.eva, evb: t.weatherSprites()!.evb };
  });
  expect(finish).toMatchObject({ eva: 0, evb: 16 });
  expect(finish.gone, "case 0, then 46 frames of case 1 (destroyed on the last), seen at the next tick's start").toBe(48);
  expect(await game.eval((t) => t.weather()!.currWeather)).toBe(WEATHER_NONE);
});

test('diagonal fog: 20 blended 64x64 sprites at priority 2 in 5 columns x 4 rows drifting with fogDXOffset / fogDYOffset, BLDALPHA (12, 8) a step every 9 frames, read back from the screen; then back to none', async () => {
  const game = await session.start(HOUSE);
  await startedIdle(game);
  const run = await game.eval(async (t) => {
    const w = await new Function('p', 'return import(p)')('/src/world/weather.ts');
    t.doWeather('WEATHER_FOG_DIAGONAL');
    const start = t.frame();
    const frames: { frame: number; base: number; posY: number; sprites: { x: number; y: number; tag: number; priority: number; blend: boolean }[] }[] = [];
    let loaded = 0;
    await t.until(() => {
      const p = t.weatherSprites()!;
      if (frames.length < 60) frames.push({ frame: t.frame() - start, base: w.gWeatherPtr.fogDBaseSpritesX, posY: w.gWeatherPtr.fogDPosY, sprites: p.sprites.map((s) => ({ x: s.x, y: s.y, tag: s.tag, priority: s.priority, blend: s.blend })) });
      if (w.gWeatherPtr.weatherGfxLoaded) loaded = t.frame() - start;
      return w.gWeatherPtr.weatherGfxLoaded;
    }, 1000);
    return { frames, loaded, eva: t.weatherSprites()!.eva, evb: t.weatherSprites()!.evb, offset: t.weatherSprites()!.spriteCoordOffset, ptr: { xo: w.gWeatherPtr.fogDXOffset, yo: w.gWeatherPtr.fogDYOffset } };
  });
  expect(run.offset).toEqual({ x: 0, y: -40 });
  expect([run.eva, run.evb]).toEqual([12, 8]);
  let checked = 0;
  for (const f of run.frames) {
    if (!f.sprites.length) continue;
    expect(f.sprites).toHaveLength(20);
    // UpdateFogDiagonalSprite's x for each column; y = 64 row + y2 (fogDPosY as s16), less 32, OAM-wrapped
    const xs = [0, 1, 2, 3, 4].map((col) => {
      const x = f.base + 32 + col * 64;
      return (x >= 272 ? (f.base + 480 - (4 - col) * 64) & 0x1ff : x) - 32;
    });
    const ys = [0, 1, 2, 3].map((row) => (row * 64 + ((f.posY << 16) >> 16) - 32) & 0xff);
    const wrapX = (x: number) => ((x + 512) & 0x1ff) >= 256 ? ((x + 512) & 0x1ff) - 512 : (x + 512) & 0x1ff;
    const wrapY = (y: number) => (y + 64 > 256 ? y - 256 : y);
    const expected = xs.flatMap((x) => ys.map((y) => `${wrapX(x)},${wrapY(y)}`)).sort();
    expect(f.sprites.map((s) => `${s.x},${s.y}`).sort(), `frame ${f.frame}`).toEqual(expected);
    expect(f.sprites.every((s) => s.tag === GFXTAG_FOG_D && s.priority === 2 && s.blend)).toBe(true);
    checked++;
  }
  expect(checked).toBeGreaterThan(30);
  // fogDXOffset a pixel every 3 frames, fogDYOffset every 5: over the frames seen, base and posY moved that way
  const a = run.frames.find((f) => f.sprites.length)!;
  const b = run.frames[run.frames.length - 1];
  const dt = b.frame - a.frame;
  expect([Math.floor(dt / 3), Math.ceil(dt / 3)]).toContain((a.base - b.base) & 0xff);
  expect([Math.floor(dt / 5), Math.ceil(dt / 5)]).toContain(b.posY - a.posY);
  // InitVars, then Main: the sprites, the target, 23 updates 9 frames apart (the predicate sees it a tick later)
  expect(run.loaded).toBe(3 + 23 * 9 + 1);

  const px = await blendedPixels(game, { x0: 0, y0: 0, x1: 240, y1: 160 }, 24);
  expect([px.eva, px.evb]).toEqual([12, 8]);
  let blended = 0;
  for (const p of px.out) {
    if (near(p.shown, p.under, 0) && !near(bldalpha(p.sprite, p.under, 12, 8), p.under, 5)) continue; // under BG1 (priority 1)
    expect(near(p.shown, bldalpha(p.sprite, p.under, 12, 8), 5), `(${p.x}, ${p.y}): ${p.shown} vs sprite ${p.sprite} over ${p.under}`).toBe(true);
    blended++;
  }
  expect(blended).toBeGreaterThan(10);

  const finish = await game.eval(async (t) => {
    t.doWeather('WEATHER_NONE');
    await t.until(() => t.weather()!.currWeather === 0, 400);
    return { sprites: t.weatherSprites()!.sprites.length, eva: t.weatherSprites()!.eva, evb: t.weatherSprites()!.evb };
  });
  expect(finish).toEqual({ sprites: 0, eva: 0, evb: 16 });
});

test('drought: doweather leaves the palettes as they are (Drought_Main stuck at step 2: FRLG dummied the drought palettes); a fade in ends 1/16 toward the fade colour, gamma index -6', async () => {
  const game = await session.start(HOUSE);
  await startedIdle(game);
  const slot = await game.eval((t) => [7, 8, 9, 10, 11, 12, 0, 1, 2, 3, 4, 5, 6].find((s) => t.weather(s)!.pixel && t.weather(s)!.unfaded) ?? 7);
  const before = await game.eval((t, slot) => t.weather(slot)!, slot);
  const stuck = await game.eval(async (t, slot) => {
    const w = await new Function('p', 'return import(p)')('/src/world/weather.ts');
    t.doWeather('WEATHER_DROUGHT');
    await t.waitFrames(120);
    return { ...t.weather(slot)!, initStep: w.gWeatherPtr.initStep, loadIndex: w.gWeatherPtr.loadDroughtPalsIndex };
  }, slot);
  expect(stuck).toMatchObject({ currWeather: WEATHER_DROUGHT, gammaIndex: 0, initStep: 2, loadIndex: 1, weatherGfxLoaded: false });
  expect(stuck.palette, 'no drought brightness stages in FRLG').toEqual(before.palette);

  // A script's fadescreen pair: FadeScreen's useWeatherPal → FadeInScreen_Drought (the overlay 15 → 1 over the colours
  // as loaded), then the palettes at the coefficient-1 blend toward black
  const fade = await game.eval(async (t, slot) => {
    const blends: number[] = [];
    const w = await new Function('p', 'return import(p)')('/src/world/weather.ts');
    if (!t.runScript('Test_DroughtFade', [['fadescreen', 'FADE_TO_BLACK'], ['fadescreen', 'FADE_FROM_BLACK'], ['end']])) throw new Error('no field');
    let fadingIn = false;
    await t.until(() => {
      const b = w.WeatherFadeInBlend();
      if (b !== undefined && blends[blends.length - 1] !== b) blends.push(b);
      if (t.weather()!.palProcessingState === 1) fadingIn = true;
      return fadingIn && t.weather()!.palProcessingState === 3;
    }, 2000);
    return { blends, after: t.weather(slot)! };
  }, slot);
  expect(fade.blends.slice(-15)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  expect(fade.after.gammaIndex).toBe(-6);
  // ApplyDroughtGammaShiftWithBlend(-6, 1, RGB_BLACK): c + ((0 - c) >> 4)
  expect(fade.after.palette).toEqual(fade.after.unfaded!.map((v) => expand(to5(v) + ((0 - to5(v)) >> 4))));
  expect(fade.after.palette).not.toEqual(fade.after.unfaded);
});

test('StartDroughtWeatherBlend: the BLDY lighten flash (3 a frame up to 16, down 1 every 10 frames), white on screen at its peak, then the script goes on', async () => {
  const game = await session.start(HOUSE);
  await startedIdle(game);
  const run = await game.eval(async (t) => {
    const scene = (window as any).game.scene.getScene('Overworld');
    const alphas: number[] = [];
    let white: number[] | undefined;
    if (!t.runScript('Test_DroughtBlend', [['special', 'StartDroughtWeatherBlend'], ['waitstate'], ['setvar', 'VAR_TEMP_1', '1'], ['end']])) throw new Error('no field');
    await t.until(() => {
      const r = scene.weatherLighten;
      const a = r && r.visible ? Math.round(r.alpha * 16) : -1;
      if (alphas[alphas.length - 1] !== a) alphas.push(a);
      return a === 16;
    }, 100);
    white = await t.screenPixel(120, 100);
    const whiteEvy = Math.round(scene.weatherLighten.alpha * 16); // (the flash may have moved on since the render)
    await t.until(() => {
      const r = scene.weatherLighten;
      const a = r && r.visible ? Math.round(r.alpha * 16) : -1;
      if (alphas[alphas.length - 1] !== a) alphas.push(a);
      return t.var('VAR_TEMP_1') === 1;
    }, 400);
    return { alphas, white, whiteEvy, under: await t.screenPixel(120, 100) };
  });
  expect(run.alphas.filter((a) => a >= 0).slice(-17)).toEqual([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  expect(run.alphas[run.alphas.length - 1], 'off (BLDCNT 0)').toBe(-1);
  // BLDCNT_EFFECT_LIGHTEN: c + (31 - c) * BLDY / 16 (16 at the peak; the read may land a frame or two later)
  const lightened = (evy: number) => run.under.map((v) => v + ((255 - v) * evy) / 16);
  expect([run.whiteEvy, run.whiteEvy + 1].some((evy) => near(run.white!, lightened(evy), 4)), `${run.white} at BLDY ${run.whiteEvy} over ${run.under}`).toBe(true);
  expect(run.whiteEvy).toBeGreaterThanOrEqual(14);
  expect(run.under).not.toEqual([255, 255, 255]);
});

test('underwater bubbles: the horizontal fog (BLDALPHA (4, 16)) and 8x8 bubbles from sBubbleStartCoords rising 3 a frame for 120 frames; then back to none', async () => {
  const game = await session.start(HOUSE);
  await startedIdle(game);
  const run = await game.eval(async (t) => {
    const w = await new Function('p', 'return import(p)')('/src/world/weather.ts');
    t.doWeather('WEATHER_UNDERWATER_BUBBLES');
    const start = t.frame();
    type Bubble = { born: number; x: number; y: number; ys: number[]; died?: number };
    const bubbles: Bubble[] = [];
    const byId = new Map<number, Bubble>();
    let fogSprites = 0;
    await t.until(() => {
      const p = t.weatherSprites()!;
      fogSprites = Math.max(fogSprites, t.fog()!.sprites.length);
      const now = t.frame() - start;
      const alive = new Set<number>();
      for (const s of p.sprites) {
        if (s.tag !== 0x1205) continue;
        alive.add(s.id);
        let b = byId.get(s.id);
        if (!b || b.died !== undefined) {
          b = { born: now, x: s.x, y: s.y, ys: [] };
          bubbles.push(b);
          byId.set(s.id, b);
        }
        b.ys.push(s.y);
      }
      for (const [id, b] of byId) if (!alive.has(id) && b.died === undefined) b.died = now;
      return now > 400;
    }, 1000);
    return {
      bubbles,
      fogSprites,
      eva: t.fog()!.eva,
      evb: t.fog()!.evb,
      count: w.gWeatherPtr.bubblesSpriteCount,
      sample: t.weatherSprites()!.sprites.find((s) => s.tag === 0x1205),
      offset: t.weatherSprites()!.spriteCoordOffset,
    };
  });
  expect(run.fogSprites, 'NUM_FOG_HORIZONTAL_SPRITES').toBe(20);
  expect([run.eva, run.evb]).toEqual([4, 16]);
  expect(run.count).toBeGreaterThanOrEqual(5);
  expect(run.sample).toMatchObject({ tag: GFXTAG_BUBBLE, width: 8, height: 8, priority: 1, subpriority: 0, blend: false });
  // The first bubble: sBubbleStartCoords[0] (120, 160 - gSpriteCoordOffsetY), drawn with the offset added back
  const first = run.bubbles[0];
  expect(first.x).toBeGreaterThanOrEqual(120 - 4);
  expect(first.x).toBeLessThanOrEqual(120 + 5 - 4);
  // up 3 a frame (8-bit OAM y), gone 120 frames after it was made
  const rises = first.ys.slice(1).map((y, i) => (first.ys[i] - y) & 0xff);
  expect(rises.every((r) => r % 3 === 0 && r > 0)).toBe(true);
  const lived = run.bubbles.filter((b) => b.died !== undefined && b.born > 0);
  expect(lived.length).toBeGreaterThan(0);
  for (const b of lived) expect(b.died! - b.born).toBeGreaterThanOrEqual(119);

  const finish = await game.eval(async (t) => {
    t.doWeather('WEATHER_NONE');
    await t.until(() => t.weather()!.currWeather === 0, 400);
    return { bubbles: t.weatherSprites()!.sprites.length, fog: t.fog()!.sprites.length, eva: t.fog()!.eva, evb: t.fog()!.evb };
  });
  expect(finish).toEqual({ bubbles: 0, fog: 0, eva: 0, evb: 16 });
  expect(await game.eval((t) => t.weather()!.currWeather)).toBe(WEATHER_NONE);
  void WEATHER_SUNNY_CLOUDS;
  void WEATHER_FOG_DIAGONAL;
  void WEATHER_UNDERWATER_BUBBLES;
});
