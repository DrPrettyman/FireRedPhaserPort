// The rain weathers (field_weather_effects.c's Rain_*, Thunderstorm_*, Downpour_*: world/weatherRain.ts) and the weather
// sprite layer (world/weatherSprites.ts, world/weatherSpriteRenderer.ts), through `setweather` + `doweather`
// (`__test.doWeather`): no FRLG map has them. The SE3 loops and their stops (SetRainStrengthFromSoundEffect,
// PlayRainStoppingSoundEffect), the shade's gamma steps, the raindrops' fall and splash, the lightning's gamma flash and
// the thunder, the stop back to WEATHER_NONE, a warp out of the rain, a wild battle in the rain, and the layer's
// BLDALPHA blend of an ST_OAM_OBJ_BLEND sprite (a test-only sprite: no rain weather blends).
//
// Expected values come from the C, worked out here: a raindrop falls sRainSpriteMovement's (-0x68, 0xD0) Q28.4 a frame
// in the rain (-6.5, 13 pixels), (-0xA0, 0x140) in the downpour (-10, 20); OAM is the sprite's centre less 8 / 16 (a
// 16x32 sprite); BuildGammaShiftTables' row for gamma index 3 is floor(13c / 16) per 5-bit channel, and every
// channel of 12 and up is 31 at gamma index 19 (the lightning); BLDALPHA is min(31, (obj * EVA + bg * EVB) >> 4).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const WEATHER_NONE = 0;
const WEATHER_RAIN = 3;
const WEATHER_RAIN_THUNDERSTORM = 5;
const WEATHER_DOWNPOUR = 13;
/** The rain sheet's tag (field_weather.h GFXTAG_RAIN). */
const GFXTAG_RAIN = 0x1206;

const HOUSE = { start: 'after-rival', map: 'PalletTown_PlayersHouse_2F', x: 6, y: 6 } as const;

/** One JASC channel through the shade (gamma index 3: gammaShifts[2]). */
const shade = (v: number) => Math.floor((Math.floor((13 * (v >> 3)) / 16) * 255) / 31);

async function startedIdle(game: Game) {
  await game.waitIdle();
  await game.waitFor((t) => t.weather()!.palProcessingState === 3, { what: 'the weather idle' });
}

/** The sound events (m4aSongNumStart) since `mark` of one name. */
const songs = (game: Game, mark: number, name: RegExp) =>
  game.eval((t, s, n) => t.audioEvents(s).filter((e) => new RegExp(n).test(e.name)).map((e) => ({ name: e.name, player: e.player, started: e.started, frame: e.frame })), mark, name.source);

test('rain: SE_RAIN on SE3, the shade a gamma step every 20 frames, 24 raindrops (10 shown) falling (-6.5, 13) a frame, the splashes scroll with the camera', async () => {
  const game = await session.start(HOUSE);
  await startedIdle(game);
  const mark = await game.mark();
  // Watch the change tick by tick: the gamma index and the frame it changed, the raindrops created and shown
  const changed = game.eval(async (t) => {
    const gammas: { gamma: number; frame: number }[] = [];
    let maxShown = 0;
    let created = 0;
    t.doWeather('WEATHER_RAIN');
    const start = t.frame();
    await t.until(() => {
      const w = t.weather()!;
      if (gammas[gammas.length - 1]?.gamma !== w.gammaIndex) gammas.push({ gamma: w.gammaIndex, frame: t.frame() - start });
      created = Math.max(created, w.rainSpriteCount);
      maxShown = Math.max(maxShown, t.weatherSprites()!.sprites.length);
      return w.gammaIndex === 3 && w.palProcessingState === 3 && w.curRainSpriteIndex === w.targetRainSpriteCount && w.weatherGfxLoaded;
    }, 2000);
    return { gammas, created, maxShown, w: t.weather(7)! };
  });
  const { gammas, created, maxShown, w } = await changed;
  expect(w).toMatchObject({ currWeather: WEATHER_RAIN, savedWeather: WEATHER_RAIN, targetRainSpriteCount: 10, isDownpour: 0, rainStrength: 0 });
  expect(gammas.map((g) => g.gamma)).toEqual([0, 1, 2, 3]);
  expect(gammas.slice(1).map((g, i) => g.frame - gammas[i].frame), 'a step every gammaStepDelay (20) frames').toEqual([20, 20, 20]);
  expect(w.palette, 'the BG palette shaded').toEqual(w.unfaded!.map(shade));
  expect(created, 'MAX_RAIN_SPRITES').toBe(24);
  expect(maxShown, 'targetRainSpriteCount').toBeLessThanOrEqual(10);
  const se = await songs(game, mark, /^SE_RAIN/);
  expect(se[0], 'Rain_InitVars: SetRainStrengthFromSoundEffect(SE_RAIN)').toMatchObject({ name: 'SE_RAIN', player: 'SE3', started: true });
  expect(await game.eval((t) => t.audio().players.SE3), 'the loop on SE3').toMatchObject({ song: 'SE_RAIN', playing: true });

  // Two consecutive frames: each falling raindrop moves (-6.5, 13), a splash stays put; the frames are the anims'
  const frames = await game.eval(async (t) => {
    const seen: ReturnType<typeof t.weatherSprites>[] = [];
    await t.until(() => {
      seen.push(t.weatherSprites());
      return seen.length >= 40;
    }, 200);
    return seen.map((p) => p!.sprites.map((s) => ({ id: s.id, x: s.x, y: s.y, tileNum: s.tileNum, tag: s.tag, priority: s.priority, subpriority: s.subpriority, blend: s.blend, scroll: s.coordOffsetEnabled })));
  });
  let falls = 0;
  let splashes = 0;
  for (let f = 1; f < frames.length; f++) {
    for (const s of frames[f]) {
      expect(s).toMatchObject({ tag: GFXTAG_RAIN, priority: 1, subpriority: 78, blend: false });
      expect([0, 8, 32, 40], 'sRainSpriteFallAnimCmd / sRainSpriteSplashAnimCmd frames').toContain(s.tileNum);
      const prev = frames[f - 1].find((p) => p.id === s.id);
      if (!prev || prev.scroll !== s.scroll || prev.tileNum !== s.tileNum) continue;
      if (!s.scroll) {
        // (OAM's 9-bit x and 8-bit y wrap: a drop coming in at the top is at y - 256 the frame before)
        expect((s.y - prev.y) & 0xff, `raindrop ${s.id} falls 13 a frame`).toBe(13);
        expect([-6, -7]).toContain(((s.x - prev.x + 256) & 0x1ff) - 256);
        falls++;
      } else {
        expect([s.x, s.y], 'a splash stays where it landed').toEqual([prev.x, prev.y]);
        splashes++;
      }
    }
  }
  expect(falls).toBeGreaterThan(20);
  expect(splashes).toBeGreaterThan(5);

  // A step left: the camera's 16 pixels move the splashes 16 right (gSpriteCoordOffsetX), not the falling drops' paths
  const step = game.eval(async (t) => {
    const before = t.weatherSprites()!.spriteCoordOffset.x;
    await t.walk('left', 1);
    return t.weatherSprites()!.spriteCoordOffset.x - before;
  });
  expect(await step).toBe(16);
});

test('a stop back to WEATHER_NONE: SE_RAIN_STOP at once, the raindrops go one every 9 frames, then the sprites and the shade', async () => {
  const game = await session.start(HOUSE);
  await startedIdle(game);
  await game.eval((t) => t.doWeather('WEATHER_RAIN'));
  await game.waitFor((t) => t.weather()!.curRainSpriteIndex === 10 && t.weather()!.palProcessingState === 3, { what: 'the rain set up' });
  const mark = await game.mark();
  const stopped = await game.eval(async (t) => {
    const counts: { index: number; frame: number }[] = [];
    t.doWeather('WEATHER_NONE');
    const start = t.frame();
    await t.until(() => {
      const w = t.weather()!;
      if (counts[counts.length - 1]?.index !== w.curRainSpriteIndex) counts.push({ index: w.curRainSpriteIndex, frame: t.frame() - start });
      return w.currWeather === 0 && w.gammaIndex === 0 && w.palProcessingState === 3;
    }, 2000);
    return { counts, w: t.weather(7)!, sprites: t.weatherSprites()!.sprites.length };
  });
  const se = await songs(game, mark, /^SE_RAIN/);
  expect(se[0], 'SetNextWeather: PlayRainStoppingSoundEffect').toMatchObject({ name: 'SE_RAIN_STOP', player: 'SE3', started: true });
  expect(stopped.counts.map((c) => c.index)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  expect(stopped.counts.slice(2).map((c, i) => c.frame - stopped.counts[i + 1].frame), 'rainSpriteVisibleDelay 8: every 9 frames').toEqual(Array(9).fill(9));
  expect(stopped.sprites, 'DestroyRainSprites').toBe(0);
  expect(stopped.w).toMatchObject({ currWeather: WEATHER_NONE, rainSpriteCount: 0 });
  expect(stopped.w.palette).toEqual(stopped.w.unfaded);
});

test('thunderstorm: SE_THUNDERSTORM on SE3, a lightning flash (gamma 19 for 6-8 frames, then 3), the thunder (SE_THUNDER / SE_THUNDER2)', async () => {
  const game = await session.start(HOUSE);
  await startedIdle(game);
  const mark = await game.mark();
  const flash = await game.eval(async (t) => {
    const gammas: { gamma: number; frame: number; palette?: number[]; unfaded?: number[] }[] = [];
    t.doWeather('WEATHER_RAIN_THUNDERSTORM');
    await t.until(() => {
      const w = t.weather(7)!;
      if (gammas[gammas.length - 1]?.gamma !== w.gammaIndex) gammas.push({ gamma: w.gammaIndex, frame: t.frame(), palette: w.palette, unfaded: w.unfaded });
      const i = gammas.findIndex((g) => g.gamma === 19);
      return i >= 0 && gammas.length > i + 1 && t.audioEvents(0).some((e) => /^SE_THUNDER2?$/.test(e.name));
    }, 3000);
    return { gammas, w: t.weather()! };
  });
  expect(flash.w).toMatchObject({ currWeather: WEATHER_RAIN_THUNDERSTORM, targetRainSpriteCount: 16, rainStrength: 2, rainSpriteCount: 24 });
  const g = flash.gammas;
  expect(g.slice(0, 4).map((x) => x.gamma), 'the shade first').toEqual([0, 1, 2, 3]);
  const lit = g.findIndex((x) => x.gamma === 19);
  expect(lit, 'straight from the shade to the flash: WeatherShiftGammaIfPalStateIdle(19)').toBe(4);
  const { palette, unfaded } = g[lit];
  unfaded!.forEach((v, i) => {
    const c = v >> 3;
    // (below 12 the rows 3-18 climb only a step above the shade: BuildGammaShiftTables halves the climb each row)
    if (c >= 12) expect(palette![i], `channel ${i} (${c}) white in the flash`).toBe(255);
    else expect(palette![i], `channel ${i} (${c}) at least the shade's`).toBeGreaterThanOrEqual(shade(v));
  });
  const next = g[lit + 1];
  if (next.gamma === 3) {
    // A short flash: TSTORM_STATE_TRY_NEW_THUNDER after (Random() % 3) + 6 frames
    expect(next.frame - g[lit].frame).toBeGreaterThanOrEqual(6);
    expect(next.frame - g[lit].frame).toBeLessThanOrEqual(8);
  } else {
    // A long one: WeatherBeginGammaFade(19, 3, 5) after (Random() & 0xF) + 30 frames
    expect(next.gamma).toBe(18);
  }
  const se = await songs(game, mark, /^SE_THUNDER/);
  expect(se[0]).toMatchObject({ name: 'SE_THUNDERSTORM', player: 'SE3', started: true });
  const thunder = se.find((e) => /^SE_THUNDER2?$/.test(e.name));
  expect(thunder, 'UpdateThunderSound').toMatchObject({ player: expect.stringMatching(/^SE[12]$/), started: true });
});

test('downpour: SE_DOWNPOUR on SE3, all 24 raindrops falling (-10, 20) a frame and splashing heavily', async () => {
  const game = await session.start(HOUSE);
  await startedIdle(game);
  const mark = await game.mark();
  await game.eval((t) => t.doWeather('WEATHER_DOWNPOUR'));
  await game.waitFor((t) => t.weather()!.curRainSpriteIndex === 24, { what: 'every raindrop shown' });
  const frames = await game.eval(async (t) => {
    const seen: { id: number; x: number; y: number; tileNum: number; scroll: boolean }[][] = [];
    await t.until(() => {
      seen.push(t.weatherSprites()!.sprites.map((s) => ({ id: s.id, x: s.x, y: s.y, tileNum: s.tileNum, scroll: s.coordOffsetEnabled })));
      return seen.length >= 30;
    }, 200);
    return seen;
  });
  let falls = 0;
  for (let f = 1; f < frames.length; f++) {
    for (const s of frames[f]) {
      expect([0, 8, 16, 24], 'sRainSpriteHeavySplashAnimCmd frames').toContain(s.tileNum);
      const prev = frames[f - 1].find((p) => p.id === s.id);
      if (!prev || prev.scroll || s.scroll || prev.tileNum !== s.tileNum) continue;
      expect([((s.x - prev.x + 256) & 0x1ff) - 256, (s.y - prev.y) & 0xff]).toEqual([-10, 20]);
      falls++;
    }
  }
  expect(falls).toBeGreaterThan(30);
  expect(await game.eval((t) => t.weather()!)).toMatchObject({ currWeather: WEATHER_DOWNPOUR, isDownpour: 1, rainStrength: 1, targetRainSpriteCount: 24 });
  const se = await songs(game, mark, /^SE_DOWNPOUR/);
  expect(se[0]).toMatchObject({ name: 'SE_DOWNPOUR', player: 'SE3', started: true });
});

test('a warp out of the rain: SE_RAIN_STOP as the warp starts (DoWarp), no rain downstairs', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_2F', x: 10, y: 2 });
  await startedIdle(game);
  await game.eval((t) => t.doWeather('WEATHER_RAIN'));
  await game.waitFor((t) => t.weather()!.palProcessingState === 3 && t.weather()!.gammaIndex === 3, { what: 'the rain set up' });
  const mark = await game.mark();
  expect(await game.eval((t) => t.enterWarp())).toBe('PalletTown_PlayersHouse_1F');
  const events = await game.eval((t, s) => t.audioEvents(s).map((e) => e.name), mark);
  expect(events.indexOf('SE_RAIN_STOP'), 'before SE_EXIT').toBeGreaterThanOrEqual(0);
  expect(events.indexOf('SE_RAIN_STOP')).toBeLessThan(events.indexOf('SE_EXIT'));
  await startedIdle(game);
  expect(await game.eval((t) => ({ w: t.weather()!, sprites: t.weatherSprites()!.sprites.length }))).toMatchObject({ w: { currWeather: WEATHER_NONE, savedWeather: WEATHER_NONE }, sprites: 0 });
});

test('a wild battle in the rain starts with the rain (ABILITYEFFECT_SWITCH_IN_WEATHER reads GetCurrentWeather)', async () => {
  const game = await session.start({ ...HOUSE, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await startedIdle(game);
  await game.eval((t) => t.doWeather('WEATHER_RAIN'));
  await game.waitFor((t) => t.weather()!.currWeather === 3, { what: 'the rain (WEATHER_RAIN)' });
  const mark = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 2 }));
  await game.waitForEvent('battleStart', { since: mark });
  const rain = await game.mashUntil((t) => /rain/i.test(t.battle()?.message ?? '') && t.battle()!.message, { what: 'the rain message' });
  expect(rain).toMatch(/It is raining\.|rain/i);
});

test('the sprite layer blends an ST_OAM_OBJ_BLEND sprite with BLDALPHA where it has pixels, and leaves the rest; a NORMAL one is drawn as is', async () => {
  const game = await session.start(HOUSE);
  await startedIdle(game);
  // Two still test sprites of the ash sheet: blended at (16, 16), normal at (160, 16); BLDALPHA (10, 9)
  const EVA = 10;
  const EVB = 9;
  await game.eval((t, eva, evb) => {
    t.weatherTestSprite({ x: 16, y: 16, blend: true, eva, evb });
    t.weatherTestSprite({ x: 160, y: 16, blend: false });
  }, EVA, EVB);
  const pixels = await game.eval(async (t) => {
    const out: { x: number; y: number; sprite?: number[]; blend?: boolean; under: number[]; shown: number[] }[] = [];
    await t.waitFrames(2);
    // About 16 opaque and 6 transparent pixels of each sprite
    const pick: [number, number][] = [];
    const counts = [0, 0];
    for (const [ox, oy] of [[16, 16], [160, 16]]) {
      const points: [number, number][] = [];
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) points.push([ox + x, oy + y]);
      const opaque = points.filter(([x, y]) => t.weatherSprites(x, y)!.pixel);
      const clear = points.filter(([x, y]) => !t.weatherSprites(x, y)!.pixel);
      counts[0] += opaque.length;
      counts[1] += clear.length;
      pick.push(...opaque.filter((_, i) => i % Math.ceil(opaque.length / 16) === 0), ...clear.filter((_, i) => i % Math.ceil(clear.length / 6) === 0));
    }
    // (one screenPixel at a time: Phaser keeps one snapshot request per render)
    t.weatherSprites(undefined, undefined, false);
    const unders: number[][] = [];
    for (const [x, y] of pick) unders.push(await t.screenPixel(x, y));
    t.weatherSprites(undefined, undefined, true);
    const shown: number[][] = [];
    for (const [x, y] of pick) shown.push(await t.screenPixel(x, y));
    pick.forEach(([x, y], i) => {
      const p = t.weatherSprites(x, y)!.pixel;
      out.push({ x, y, sprite: p?.rgb, blend: p?.blend, under: unders[i], shown: shown[i] });
    });
    return { out, counts };
  });
  expect(pixels.counts[0], 'the ash frame has opaque pixels').toBeGreaterThan(10);
  expect(pixels.counts[1], 'and transparent ones').toBeGreaterThan(10);
  const to5 = (v: number) => v >> 3;
  const expand = (c: number) => Math.floor((c * 255) / 31);
  let blended = 0;
  for (const p of pixels.out) {
    let expected: number[];
    if (!p.sprite) expected = p.under; // transparent: the field as it is
    else if (!p.blend) expected = p.sprite; // ST_OAM_OBJ_NORMAL: the sprite's colour
    else {
      expected = p.sprite.map((v, c) => expand(Math.min(31, (to5(v) * EVA + to5(p.under[c]) * EVB) >> 4)));
      blended++;
    }
    // (the GPU's 8-bit passes against the PPU's floored 5-bit sum: within half a 5-bit step, 255 / 62)
    const tolerance = p.sprite && p.blend ? 5 : 3;
    p.shown.forEach((v, c) => expect(Math.abs(v - expected[c]), `(${p.x}, ${p.y}) channel ${c}: ${p.shown} for ${p.sprite} over ${p.under}`).toBeLessThanOrEqual(tolerance));
  }
  expect(blended).toBeGreaterThan(10);

  // The GBA layer's copy of the field (a battle transition) has the blended sprite's pixels as semi-transparent OBJ
  // pixels, with the weather's BLDALPHA
  const inTransition = game.watch((t) => {
    const w = t.weatherSprites();
    return w && w.gbaSemiPixels > 0 && { semi: w.gbaSemiPixels, bldalpha: t.gpuReg(0x52) };
  }, { what: 'the blended sprite on the GBA layer' });
  const mark = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 2 }));
  await game.waitForEvent('battleTransition', { since: mark });
  const { semi, bldalpha } = await inTransition;
  expect(semi).toBeGreaterThan(50);
  expect(semi, 'only the sprite: 64 x 64 at most').toBeLessThanOrEqual(64 * 64);
  expect(bldalpha).toBe(EVA | (EVB << 8));
});
