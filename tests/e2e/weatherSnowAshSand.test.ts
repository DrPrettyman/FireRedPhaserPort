// WEATHER_SNOW, WEATHER_VOLCANIC_ASH and WEATHER_SANDSTORM (field_weather_effects.c's Snow_*, Ash_*, Sandstorm_*:
// world/weatherSnow.ts, weatherAsh.ts, weatherSandstorm.ts) on the weather sprite layer, through `setweather` +
// `doweather` (`__test.doWeather`): no FRLG map has them. Each one's sprites (count, positions tick by tick), its
// gamma or BLDALPHA steps, a rendered pixel (the snowflake drawn as is; the ash and the sand blended with BLDALPHA),
// and its finish (sprites gone, blend back).
//
// Expected values come from the C, worked out here: a snowflake created every 37 frames up to 16, falling tDeltaY /
// 128 pixels a frame (tPosY Q9.7) and swaying gSineTable[tWaveIndex] / 64; the ash's columns at
// ((gSpriteCoordOffsetX & 0x1FF) mod 240) + 32 + col * 64 (wrapped past 272), a pixel down every 6 frames; the
// sandstorm's u32 offsets less gSineTable[sandstormWaveIndex] (* 4 across) a frame, its swirls on a circle of
// tRadius * gSineTable / 256; Weather_UpdateBlend's EVA / EVB steps in turn every blendDelay + 1 frames; BLDALPHA is
// min(31, (obj * EVA + bg * EVB) >> 4) per 5-bit channel. gSineTable and gSandstormWeatherPalette are the decomp's
// (public/gen).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const WEATHER_NONE = 0;
const WEATHER_SNOW = 4;
const WEATHER_VOLCANIC_ASH = 7;
const WEATHER_SANDSTORM = 8;
/** field_weather.h GFXTAG_ASH / GFXTAG_SANDSTORM; the snowflakes have TAG_NONE (frame images) */
const GFXTAG_ASH = 0x1202;
const GFXTAG_SANDSTORM = 0x1204;
const TAG_NONE = 0xffff;

const HOUSE = { start: 'after-rival', map: 'PalletTown_PlayersHouse_2F', x: 6, y: 6 } as const;

const SINE: number[] = JSON.parse(readFileSync(resolve(__dirname, '../../public/gen/battle/tables.json'), 'utf8')).mech.gSineTable;
const expand = (c: number) => Math.floor((c * 255) / 31);
/** gSandstormWeatherPalette as JASC [r, g, b] */
const SAND_PALETTE = (() => {
  const b = readFileSync(resolve(__dirname, '../../public/gen/gfx/gSandstormWeatherPalette.bin'));
  return Array.from({ length: 16 }, (_, i) => {
    const c = b.readUInt16LE(i * 2);
    return [c & 0x1f, (c >> 5) & 0x1f, (c >> 10) & 0x1f].map(expand);
  });
})();
const s16 = (v: number) => (v << 16) >> 16;

async function startedIdle(game: Game) {
  await game.waitIdle();
  await game.waitFor((t) => t.weather()!.palProcessingState === 3, { what: 'the weather idle' });
}

/** Weather_UpdateBlend from (0, 16) to (16, 0): after u updates, EVA ceil(u / 2), EVB 16 - floor(u / 2). */
const blendAfter = (u: number) => [Math.ceil(u / 2), 16 - Math.floor(u / 2)];

/**
 * BLDALPHA read back from the screen: points read with the weather's sprites hidden (the field under them), then
 * shown, each checked against the sprite pixel the render drew there (`drawn`: the OAM of that frame).
 */
async function sampleBlend(game: Game, points: [number, number][]) {
  return game.eval(async (t, pts) => {
    t.weatherSprites(undefined, undefined, false);
    const unders: number[][] = [];
    for (const [x, y] of pts) unders.push(await t.screenPixel(x, y));
    t.weatherSprites(undefined, undefined, true);
    const out: { x: number; y: number; under: number[]; shown: number[]; sprite?: number[]; blend?: boolean; eva: number; evb: number }[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const shown = await t.screenPixel(x, y);
      const p = t.weatherSprites(x, y, undefined, true)!;
      out.push({ x, y, under: unders[i], shown, sprite: p.pixel?.rgb, blend: p.pixel?.blend, eva: p.eva, evb: p.evb });
    }
    return out;
  }, points);
}

/** Check sampled pixels against BLDALPHA; returns how many were blended sprite pixels. */
function checkBlend(samples: Awaited<ReturnType<typeof sampleBlend>>) {
  const to5 = (v: number) => v >> 3;
  let blended = 0;
  for (const p of samples) {
    if (!p.sprite) {
      p.shown.forEach((v, c) => expect(Math.abs(v - p.under[c]), `(${p.x}, ${p.y}): no sprite pixel, the field`).toBeLessThanOrEqual(3));
      continue;
    }
    expect(p.blend).toBe(true);
    const eva = Math.min(p.eva, 16);
    const evb = Math.min(p.evb, 16);
    const expected = p.sprite.map((v, c) => expand(Math.min(31, (to5(v) * eva + to5(p.under[c]) * evb) >> 4)));
    // (the GPU's 8-bit passes against the PPU's floored 5-bit sum: within half a 5-bit step)
    p.shown.forEach((v, c) => expect(Math.abs(v - expected[c]), `(${p.x}, ${p.y}) channel ${c}: ${p.shown} for ${p.sprite} over ${p.under} at (${eva}, ${evb})`).toBeLessThanOrEqual(5));
    blended++;
  }
  return blended;
}

/** A grid of screen points. */
const grid = (step: number): [number, number][] => {
  const pts: [number, number][] = [];
  for (let y = 5; y < 160; y += step) for (let x = 3; x < 240; x += step) pts.push([x, y]);
  return pts;
};

test('snow: the shade, a snowflake every 37 frames up to 16, each falling tDeltaY / 128 a frame and swaying; drawn from its frame image; the finish takes one every 37 frames', async () => {
  const game = await session.start(HOUSE);
  await startedIdle(game);
  const setUp = await game.eval(async (t) => {
    const counts: { count: number; frame: number }[] = [];
    const gammas: { gamma: number; frame: number }[] = [];
    t.doWeather('WEATHER_SNOW');
    const start = t.frame();
    await t.until(() => {
      const count = t.weatherPtr().snowflakeSpriteCount as number;
      if (counts[counts.length - 1]?.count !== count) counts.push({ count, frame: t.frame() - start });
      const w = t.weather()!;
      if (gammas[gammas.length - 1]?.gamma !== w.gammaIndex) gammas.push({ gamma: w.gammaIndex, frame: t.frame() - start });
      return count === 16 && w.gammaIndex === 3 && w.palProcessingState === 3;
    }, 3000);
    return { counts, gammas, w: t.weather()!, p: t.weatherPtr() };
  });
  expect(setUp.w).toMatchObject({ currWeather: WEATHER_SNOW, savedWeather: WEATHER_SNOW, gammaTargetIndex: 3, weatherGfxLoaded: true });
  expect(setUp.counts.map((c) => c.count)).toEqual(Array.from({ length: 17 }, (_, i) => i));
  // Snow_InitVars in the first frame, then UpdateVisibleSnowflakeSprites' counter: a flake each 37th frame
  // (each entry is read at the start of the tick after: the first before any tick ran)
  expect(setUp.counts[1].frame - setUp.counts[0].frame, 'InitVars in the first tick, the first flake in the 38th (Snow_Main\'s 37th)').toBe(38);
  expect(setUp.counts.slice(2).map((c, i) => c.frame - setUp.counts[i + 1].frame)).toEqual(Array(15).fill(37));
  expect(setUp.gammas.map((g) => g.gamma)).toEqual([0, 1, 2, 3]);
  expect(setUp.gammas.slice(2).map((g, i) => g.frame - setUp.gammas[i + 1].frame), 'gammaStepDelay 20').toEqual([20, 20]);
  expect(setUp.p.snowflakeTimer, 'never incremented').toBe(0);

  // The newest flake (it's still falling) over 40 ticks: tPosY += tDeltaY, y = tPosY >> 7, tWaveIndex += tWaveDelta,
  // x2 = gSineTable[tWaveIndex] / 64; its OAM has the frame image and moves with gSpriteCoordOffset
  const track = await game.eval(async (t) => {
    const oam = t.weatherSprites()!.sprites;
    const id = Math.min(...oam.map((o) => o.id)); // CreateSpriteAtEnd: the newest has the lowest slot
    const seen: { s: ReturnType<typeof t.weatherSprite>; o: (typeof oam)[number] | undefined; off: { x: number; y: number } }[] = [];
    await t.until(() => {
      const w = t.weatherSprites()!;
      seen.push({ s: t.weatherSprite(id), o: w.sprites.find((o) => o.id === id), off: w.spriteCoordOffset });
      return seen.length >= 40;
    }, 200);
    return seen;
  });
  let falls = 0;
  for (let i = 1; i < track.length; i++) {
    const [a, b] = [track[i - 1].s!, track[i].s!];
    if (b.invisible) break; // its fall time ran out (WaitSnowflakeSprite)
    const [tPosY, tDeltaY, tWaveDelta, tWaveIndex] = b.data;
    expect(s16(a.data[0] + tDeltaY), 'tPosY').toBe(tPosY);
    expect([64, 69, 74, 79]).toContain(tDeltaY);
    expect(b.y).toBe(tPosY >> 7);
    expect(tWaveIndex).toBe((a.data[3] + tWaveDelta) & 0xff);
    expect(b.x2).toBe(Math.trunc(SINE[tWaveIndex] / 64));
    const o = track[i].o!;
    expect(o).toMatchObject({ tag: TAG_NONE, width: 8, height: 8, priority: 1, subpriority: 78, blend: false, coordOffsetEnabled: true });
    expect(o.image).toBe(o.tileNum ? 'gWeatherSnow2Tiles' : 'gWeatherSnow1Tiles');
    expect(o.x).toBe((((b.x + b.x2 - 4 + track[i].off.x) & 0x1ff) << 23) >> 23);
    falls++;
  }
  expect(falls).toBeGreaterThan(20);

  // A flake on screen is drawn as is (ST_OAM_OBJ_NORMAL), in the weather palette through the shade's GAMMA_ALT row
  const drawn = await game.eval(async (t) => {
    const out: { shown: number[]; sprite: number[] }[] = [];
    for (let tries = 0; tries < 30 && out.length < 4; tries++) {
      const oam = t.weatherSprites()!.sprites.filter((o) => o.x >= 0 && o.y >= 0 && o.x < 232 && o.y < 152);
      if (!oam.length) {
        await t.waitFrames(1);
        continue;
      }
      // the flake's opaque pixel nearest its centre, as the probe has it now; checked against the drawn frame after the read
      const o = oam[0];
      let pt: [number, number] | undefined;
      for (let y = 0; y < 8 && !pt; y++) for (let x = 0; x < 8 && !pt; x++) if (t.weatherSprites(o.x + x, o.y + y)!.pixel) pt = [o.x + x, o.y + y];
      if (!pt) continue;
      const shown = await t.screenPixel(pt[0], pt[1]);
      const p = t.weatherSprites(pt[0], pt[1], undefined, true)!.pixel;
      if (p && !p.blend) out.push({ shown, sprite: p.rgb });
    }
    return out;
  });
  expect(drawn.length).toBeGreaterThan(0);
  for (const d of drawn) d.shown.forEach((v, c) => expect(Math.abs(v - d.sprite[c]), `${d.shown} for ${d.sprite}`).toBeLessThanOrEqual(3));

  // The finish: a flake destroyed every 37 frames (Snow_Finish), then WEATHER_NONE and the shade back to 0
  const finish = await game.eval(async (t) => {
    const counts: { count: number; frame: number }[] = [];
    t.doWeather('WEATHER_NONE');
    const start = t.frame();
    await t.until(() => {
      const count = t.weatherPtr().snowflakeSpriteCount as number;
      if (counts[counts.length - 1]?.count !== count) counts.push({ count, frame: t.frame() - start });
      const w = t.weather()!;
      return w.currWeather === 0 && w.gammaIndex === 0 && w.palProcessingState === 3;
    }, 3000);
    return { counts, sprites: t.weatherSprites()!.sprites.length, w: t.weather(7)! };
  });
  expect(finish.counts.map((c) => c.count)).toEqual(Array.from({ length: 17 }, (_, i) => 16 - i));
  expect(finish.counts.slice(1).map((c, i) => c.frame - finish.counts[i].frame), 'one every 37 frames').toEqual(Array(16).fill(37));
  expect(finish.sprites).toBe(0);
  expect(finish.w).toMatchObject({ currWeather: WEATHER_NONE });
  expect(finish.w.palette).toEqual(finish.w.unfaded);
});

test('volcanic ash: BLDALPHA (64, 63) as written, 20 blended 64x64 sprites, the blend (0, 16) → (16, 0) a step every 2 frames, the drift; a blended pixel on screen; the finish', async () => {
  const game = await session.start(HOUSE);
  await startedIdle(game);
  const setUp = await game.eval(async (t) => {
    const blends: { reg: number[]; curr: number[]; sprites: number }[] = [];
    t.doWeather('WEATHER_VOLCANIC_ASH');
    await t.until(() => {
      const w = t.weather()!;
      const ws = t.weatherSprites()!;
      blends.push({ reg: [ws.eva, ws.evb], curr: [w.blendEVA, w.blendEVB], sprites: ws.sprites.length });
      return w.weatherGfxLoaded && w.currWeather === 7;
    }, 500);
    return { blends, w: t.weather()! };
  });
  // blends[n]: after n ticks. Tick 1: Ash_InitVars (Weather_SetBlendCoeffs(0, 16), then BLDALPHA_BLEND(64, 63): the
  // register's 5-bit fields hold 0 and 31). Tick 2: LoadAshSpriteSheet. Tick 3: CreateAshSprites and the target
  // (16, 0, delay 1). From tick 4, Weather_UpdateBlend: an update every 2nd tick (5, 7, ...).
  const b = setUp.blends;
  expect(b[1]).toMatchObject({ reg: [0, 31], curr: [0, 16], sprites: 0 });
  expect(b[2]).toMatchObject({ reg: [0, 31], sprites: 0 });
  expect(b[3]).toMatchObject({ curr: [0, 16], sprites: 20 });
  expect(b.slice(4).map((x) => x.curr)).toEqual(Array.from({ length: 64 }, (_, i) => blendAfter((i + 1) >> 1)));
  expect(b.slice(4).map((x) => x.reg), 'Weather_UpdateBlend writes BLDALPHA every frame').toEqual(b.slice(4).map((x) => x.curr));
  expect(setUp.w).toMatchObject({ currWeather: WEATHER_VOLCANIC_ASH, gammaTargetIndex: 0, gammaIndex: 0 });

  // The sprites over 30 ticks: x from ashBaseSpritesX and the column, y = gSpriteCoordOffsetY + tOffsetY, a pixel
  // down every 6 frames
  const track = await game.eval(async (t) => {
    const seen: { sprites: { id: number; x: number; y: number; tileNum: number; blend: boolean; width: number; sub: number; tag: number }[]; data: number[][]; xs: number[]; ys: number[]; off: { x: number; y: number }; base: number }[] = [];
    await t.until(() => {
      const w = t.weatherSprites()!;
      const ids = w.sprites.map((o) => o.id);
      seen.push({
        sprites: w.sprites.map((o) => ({ id: o.id, x: o.x, y: o.y, tileNum: o.tileNum, blend: o.blend, width: o.width, sub: o.subpriority, tag: o.tag })),
        data: ids.map((id) => t.weatherSprite(id)!.data),
        xs: ids.map((id) => t.weatherSprite(id)!.x),
        ys: ids.map((id) => t.weatherSprite(id)!.y),
        off: w.spriteCoordOffset,
        base: t.weatherPtr().ashBaseSpritesX as number,
      });
      return seen.length >= 30;
    }, 200);
    return seen;
  });
  for (let i = 1; i < track.length; i++) {
    const f = track[i];
    expect(f.sprites).toHaveLength(20);
    expect(f.base).toBe(((f.off.x & 0x1ff) % 240 + 240) % 240);
    f.sprites.forEach((o, k) => {
      const [tOffsetY, tCounterY, col, row] = f.data[k];
      expect(o).toMatchObject({ tag: GFXTAG_ASH, blend: true, width: 64, sub: 0x4e });
      expect([0, 64]).toContain(o.tileNum);
      let x = f.base + 32 + col * 64;
      if (x >= 272) x = (f.base + 480 - (4 - col) * 64) & 0x1ff;
      expect(f.xs[k], `sprite ${o.id} x (column ${col})`).toBe(x);
      expect(f.ys[k], `sprite ${o.id} y (row ${row})`).toBe(f.off.y + tOffsetY);
      const prev = track[i - 1].data[track[i - 1].sprites.findIndex((p) => p.id === o.id)];
      expect(tOffsetY - prev[0], 'a pixel every 6th frame').toBe(prev[1] === 5 ? 1 : 0);
      expect(tCounterY).toBe(prev[1] === 5 ? 0 : prev[1] + 1);
    });
  }

  // A blended pixel: BLDALPHA (10, 9) (set as the weather idles at its blend), read back from the screen
  await game.eval((t) => t.weatherBlendCoeffs(10, 9));
  const samples = await sampleBlend(game, grid(9));
  expect(samples.every((s) => s.eva === 10 && s.evb === 9)).toBe(true);
  expect(checkBlend(samples), 'ash pixels among the samples').toBeGreaterThan(5);

  // The finish: back to (0, 16) a step every 2 frames, the sprites destroyed in that frame, then BLDALPHA 0
  const finish = await game.eval(async (t) => {
    const frames: { curr: number[]; reg: number[]; sprites: number; weather: number }[] = [];
    t.doWeather('WEATHER_NONE');
    await t.until(() => {
      const w = t.weather()!;
      const ws = t.weatherSprites()!;
      frames.push({ curr: [w.blendEVA, w.blendEVB], reg: [ws.eva, ws.evb], sprites: ws.sprites.length, weather: w.currWeather });
      return w.currWeather === 0;
    }, 500);
    return frames;
  });
  const gone = finish.findIndex((f) => f.sprites === 0);
  expect(finish[gone].curr).toEqual([0, 16]);
  // from (10, 9): EVA steps on odd updates, so the 10th is update 19, at tick 1 + 2 * 19 (tick 1 sets the target)
  const lastStep = finish.findIndex((f) => f.curr[0] === 0 && f.curr[1] === 16);
  expect(lastStep).toBe(39);
  expect(gone, 'DestroyAshSprites in the same tick').toBe(39);
  expect(finish[finish.length - 1]).toMatchObject({ weather: WEATHER_NONE, reg: [0, 0], sprites: 0 });
  expect(finish.length - gone, 'Ash_Finish: BLDALPHA 0 the frame after').toBe(2);
});

test('sandstorm: gSandstormWeatherPalette, 20 sand sprites and 5 swirls, the blend (0, 16) → (16, 0) a step a frame, the drift and the swirls tick by tick; a blended pixel; the finish', async () => {
  const game = await session.start(HOUSE);
  await startedIdle(game);
  const setUp = await game.eval(async (t) => {
    const blends: { curr: number[]; sprites: number }[] = [];
    t.doWeather('WEATHER_SANDSTORM');
    await t.until(() => {
      const w = t.weather()!;
      blends.push({ curr: [w.blendEVA, w.blendEVB], sprites: t.weatherSprites()!.sprites.length });
      return w.weatherGfxLoaded && w.currWeather === 8;
    }, 500);
    return { blends, w: t.weather()! };
  });
  // blends[n]: after n ticks. Tick 1: Sandstorm_InitVars. Tick 2: the sprites. Tick 3: the target (16, 0, delay 0).
  // Then a step a tick.
  const b = setUp.blends;
  expect(b[1]).toMatchObject({ curr: [0, 16], sprites: 0 });
  expect(b[2].sprites, '20 sand sprites and 5 swirls').toBe(25);
  expect(b[3].curr).toEqual([0, 16]);
  expect(b.slice(4).map((x) => x.curr)).toEqual(Array.from({ length: 32 }, (_, i) => blendAfter(i + 1)));
  expect(setUp.w).toMatchObject({ currWeather: WEATHER_SANDSTORM, gammaIndex: 0 });

  const track = await game.eval(async (t) => {
    const seen: { p: Record<string, number | boolean>; sprites: Record<number, ReturnType<typeof t.weatherSprite>>; oam: { id: number; tileNum: number; width: number; blend: boolean; sub: number; tag: number }[]; off: { x: number; y: number } }[] = [];
    await t.until(() => {
      const w = t.weatherSprites()!;
      const sprites: Record<number, ReturnType<typeof t.weatherSprite>> = {};
      for (let id = 0; id < 64; id++) {
        const s = t.weatherSprite(id);
        if (s) sprites[id] = s;
      }
      seen.push({ p: t.weatherPtr(), sprites, oam: w.sprites.map((o) => ({ id: o.id, tileNum: o.tileNum, width: o.width, blend: o.blend, sub: o.subpriority, tag: o.tag })), off: w.spriteCoordOffset });
      return seen.length >= 200;
    }, 400);
    return seen;
  });
  expect(Object.keys(track[0].sprites)).toHaveLength(25);
  let swirlSteps = 0;
  for (let i = 1; i < track.length; i++) {
    const [a, f] = [track[i - 1], track[i]];
    // UpdateSandstormMovement (with the wave index before UpdateSandstormWaveIndex)
    const wave = a.p.sandstormWaveIndex as number;
    expect(f.p.sandstormXOffset).toBe(((a.p.sandstormXOffset as number) - SINE[wave] * 4) >>> 0);
    expect(f.p.sandstormYOffset).toBe(((a.p.sandstormYOffset as number) - SINE[wave]) >>> 0);
    expect(f.p.sandstormBaseSpritesX).toBe((f.off.x + ((f.p.sandstormXOffset as number) >>> 8)) & 0xff);
    expect(f.p.sandstormPosY).toBe((f.off.y + ((f.p.sandstormYOffset as number) >>> 8)) & 0xffff);
    const counter = a.p.sandstormWaveCounter as number;
    let nextWave = counter > 4 ? wave + 1 : wave;
    if (nextWave >= 0x60) nextWave = 0x20;
    expect(f.p.sandstormWaveIndex).toBe(nextWave);
    for (const o of f.oam) expect(o).toMatchObject({ tag: GFXTAG_SANDSTORM, blend: true, sub: 1 });
    for (const [key, s] of Object.entries(f.sprites)) {
      const id = Number(key);
      const prev = a.sprites[id]!;
      if (s!.centerToCornerVecX === -32) {
        // a sand sprite: column data[0], row data[1]
        const [col, row] = s!.data;
        const base = f.p.sandstormBaseSpritesX as number;
        let x = base + 32 + col * 64;
        if (x >= 272) x = (base + 480 - (4 - col) * 64) & 0x1ff;
        expect([s!.x, s!.y, s!.y2, s!.tileNum]).toEqual([x, row * 64, s16(f.p.sandstormPosY as number), 0]);
      } else {
        // a swirl (32x32, tile 64): waiting out its entrance delay (data[3]), then up a pixel a frame on its circle
        expect([s!.centerToCornerVecX, s!.tileNum]).toEqual([-16, 64]);
        if (s!.y === prev.y) {
          expect(s!.data[3]).toBe(prev.data[3] - 1);
          continue;
        }
        const [r, waveIdx] = prev.data;
        expect(s!.y).toBe(prev.y - 1 < -48 ? 208 : prev.y - 1);
        const radius = prev.y - 1 < -48 ? 4 : r;
        expect([s!.x2, s!.y2]).toEqual([s16((radius * SINE[waveIdx]) >>> 8), s16((radius * SINE[waveIdx + 0x40]) >>> 8)]);
        expect(s!.data[1]).toBe((waveIdx + 10) & 0xff);
        swirlSteps++;
      }
    }
  }
  expect(swirlSteps).toBeGreaterThan(200);

  // The colours are gSandstormWeatherPalette's (LoadCustomWeatherSpritePalette), blended with BLDALPHA (10, 9)
  await game.eval((t) => t.weatherBlendCoeffs(10, 9));
  const samples = await sampleBlend(game, grid(9));
  for (const s of samples.filter((x) => x.sprite)) {
    expect(SAND_PALETTE.some((c) => c.every((v, i) => Math.abs(v - s.sprite![i]) <= 1)), `${s.sprite} in gSandstormWeatherPalette`).toBe(true);
  }
  expect(checkBlend(samples), 'sand pixels among the samples').toBeGreaterThan(5);

  // The finish: back to (0, 16) a step a frame, then the sprites destroyed, then WEATHER_NONE
  const finish = await game.eval(async (t) => {
    const frames: { curr: number[]; sprites: number; weather: number }[] = [];
    t.doWeather('WEATHER_NONE');
    await t.until(() => {
      const w = t.weather()!;
      frames.push({ curr: [w.blendEVA, w.blendEVB], sprites: t.weatherSprites()!.sprites.length, weather: w.currWeather });
      return w.currWeather === 0;
    }, 500);
    return { frames, sprites: t.weatherSprites()!.sprites.length };
  });
  const f = finish.frames;
  const reached = f.findIndex((x) => x.curr[0] === 0 && x.curr[1] === 16);
  // from (10, 9): EVA steps on odd updates, so the 10th is update 19, at tick 1 + 19 (tick 1 sets the target)
  expect(reached).toBe(20);
  expect(f[reached].sprites, 'still up the frame the blend gets there').toBe(25);
  expect(f[reached + 1].sprites, 'DestroySandstormSprites the next').toBe(0);
  expect(f[f.length - 1].weather).toBe(WEATHER_NONE);
  expect(finish.sprites).toBe(0);
});

test('a wild battle in the sandstorm starts with it (ABILITYEFFECT_SWITCH_IN_WEATHER: "A sandstorm is raging.")', async () => {
  const game = await session.start({ ...HOUSE, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await startedIdle(game);
  await game.eval((t) => t.doWeather('WEATHER_SANDSTORM'));
  await game.waitFor((t) => t.weather()!.currWeather === 8 && t.weather()!.weatherGfxLoaded, { what: 'the sandstorm up' });
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 2 }));
  const msg = await game.mashUntil((t) => /sandstorm/i.test(t.battle()?.message ?? '') && t.battle()!.message, { what: 'the sandstorm message' });
  expect(msg).toMatch(/sandstorm is raging/i);
});
