// Field weather (field_weather.c, world/weather.ts): WEATHER_SHADE's gamma shift on the map's BG palettes (read back
// from the atlas canvas) and on the sprite sheets the C shifts (the field effects' GAMMA_NORMAL palettes; the
// objects' own GAMMA_ALT ones stay as they are at gamma index 3), the fade in with the weather's palettes, the saved
// weather on map loads (SetSavedWeatherFromCurrMapHeader), the scripts' `setweather` / `doweather` (the Tanoby
// chambers' EventScript_TryDarkenRuins, Navel Rock's summit) and the weather in the save. WEATHER_FOG_HORIZONTAL
// (Pokémon Tower 3F-7F, the Lost Cave): the fog's sprites over the screen, their scroll with the camera and their
// drift, BLDALPHA's blend over the field read back from the rendered screen, the lightened field effect sheets, the
// fade in, the stairs out lifting it, and the GBA layer's copy of the field in a battle transition.
//
// Expected colours are worked out from the C's arithmetic, not from the port's tables: BuildGammaShiftTables' row
// for gamma index 3 is floor(13c / 16) per 5-bit channel (tests/unit/weather.test.ts), and the decomp's JASC
// palettes hold a 5-bit channel c as floor(c * 255 / 31).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** public/gen/sprites/manifest.json: the player's sheet. */
const SPRITES: Record<string, { key: string }> = JSON.parse(readFileSync(resolve(__dirname, '../../public/gen/sprites/manifest.json'), 'utf8'));
const PLAYER_SHEET = `spr_${SPRITES.OBJ_EVENT_GFX_RED_NORMAL.key}`;
/** A field effect loaded with loadfadedpal (gSpritePalette_GeneralFieldEffect1, OBJ palette 13: GAMMA_NORMAL). */
const TALL_GRASS_SHEET = 'fldeff_obj_TallGrass';

const WEATHER_NONE = 0;
const WEATHER_FOG_HORIZONTAL = 6;
const WEATHER_SHADE = 11;
const WEATHER_PAL_STATE_IDLE = 3;

/** One JASC channel through the shade (gamma index 3: gammaShifts[2]). */
const shade = (v: number) => Math.floor((Math.floor((13 * (v >> 3)) / 16) * 255) / 31);
const color = (pal: number[], i: number) => pal.slice(i * 3, i * 3 + 3);

/**
 * The weather, a map BG palette the map's pair atlas draws with (the secondary's 7-12 first; a lit map may have no
 * live atlas, then no pixel) and the two sheets' pixels.
 */
const probe = (game: Game) =>
  game.eval((t, player, grass) => {
    const slot = [7, 8, 9, 10, 11, 12, 0, 1, 2, 3, 4, 5, 6].find((s) => t.weather(s)!.pixel) ?? 7;
    const w = t.weather(slot)!;
    return { ...w, slot, player: t.weather(slot, undefined, player)!.sprite!, grass: t.weather(slot, undefined, grass)!.sprite! };
  }, PLAYER_SHEET, TALL_GRASS_SHEET);

type Probe = Awaited<ReturnType<typeof probe>>;

/** Shaded: gamma index 3, the palette and the atlas through the shade, the grass sheet too, the player's sheet not. */
function expectShaded(w: Probe) {
  expect(w).toMatchObject({ currWeather: WEATHER_SHADE, nextWeather: WEATHER_SHADE, gammaIndex: 3, palProcessingState: WEATHER_PAL_STATE_IDLE });
  expect(w.palette, 'the BG palette as shown').toEqual(w.unfaded!.map(shade));
  expect(w.pixel, 'an atlas pixel drawn with the palette').toBeDefined();
  const { rgb, colorIndex } = w.pixel!;
  expect(rgb, `colour ${colorIndex} of the palette on the canvas`).toEqual(color(w.unfaded!, colorIndex).map(shade));
  expect(rgb).not.toEqual(color(w.unfaded!, colorIndex));
  expect(w.grass.now, 'the tall grass sheet (GAMMA_NORMAL)').toEqual(w.grass.original.map(shade));
  expect(w.grass.now).not.toEqual(w.grass.original);
  expect(w.player.now, "the player's sheet (GAMMA_ALT: rows 0-2 leave it alone)").toEqual(w.player.original);
}

/** Not shaded: gamma index 0, the palette as loaded, the sheets as loaded. */
function expectUnshaded(w: Probe, weather = WEATHER_NONE) {
  expect(w).toMatchObject({ currWeather: weather, gammaIndex: 0, palProcessingState: WEATHER_PAL_STATE_IDLE });
  expect(w.palette).toEqual(w.unfaded);
  if (w.pixel) expect(w.pixel.rgb).toEqual(color(w.unfaded!, w.pixel.colorIndex));
  expect(w.grass.now).toEqual(w.grass.original);
  expect(w.player.now).toEqual(w.player.original);
}

/**
 * After a dev start: the field takes input and the weather's own fade in (WeatherFadeScreen from the start, then
 * Task_WeatherInit and the gamma steps) is over. The field is idle before the weather is, so probing right after
 * waitIdle raced the weather task under load.
 */
async function startedIdle(game: Game) {
  await game.waitIdle();
  await game.waitFor((t) => t.weather()!.palProcessingState === 3, { what: 'the weather idle (WEATHER_PAL_STATE_IDLE)' });
}

/** Walk `dir` onto a warp and wait until the new map is up and the field takes input. */
async function warp(game: Game, dir: 'up' | 'down', to: string) {
  await game.walk(dir);
  const arrived = await game.eval((t, to) => t.until(() => t.field()?.map === to && t.idle(), 20000), to);
  expect(arrived, `the field on ${to}`).toBeTruthy();
}

test('Viridian Forest is shaded: the fade in blends to the shaded palettes in 16 frames; leaving it lifts the shade', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route2_ViridianForest_SouthEntrance', x: 7, y: 2 });
  await startedIdle(game);
  expectUnshaded(await probe(game));

  // The frames the weather fades the screen in (FadeInScreen_RainShowShade: WEATHER_PAL_STATE_SCREEN_FADING_IN)
  const fade = game.eval(async (t) => {
    let frames = 0;
    let overlayDone = -1;
    await t.until(() => {
      const w = t.weather()!;
      if (w.currWeather === 11 && w.palProcessingState === 1) frames++;
      if (frames > 0 && overlayDone < 0 && !w.fading) overlayDone = frames;
      return frames > 0 && w.palProcessingState === 3;
    }, 20000);
    return { frames, overlayDone };
  });
  await warp(game, 'up', 'ViridianForest');
  const { frames, overlayDone } = await fade;
  expect(frames, 'FADING_IN frames: FadeScreen, Task_WeatherInit, then 16 steps').toBeGreaterThanOrEqual(16);
  expect(frames).toBeLessThanOrEqual(18);
  expect(overlayDone, 'the overlay ends with the weather fade').toBe(frames);
  expect(await game.eval((t) => t.weather()!.savedWeather)).toBe(WEATHER_SHADE);
  expectShaded(await probe(game));

  // Back out: the gate's header weather (NONE), its palettes and the sheets as loaded
  await game.eval((t) => t.enterWarp());
  await game.waitFor((t) => t.field()?.map === 'Route2_ViridianForest_SouthEntrance' && t.idle(), { what: 'the gate' });
  const out = await probe(game);
  expectUnshaded(out);
  expect(out.savedWeather).toBe(WEATHER_NONE);
});

test('a Tanoby chamber darkens through EventScript_TryDarkenRuins (its header says NONE), not once the ruins are unlocked', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SevenIsland_TanobyRuins', x: 120, y: 11 });
  await startedIdle(game);
  await warp(game, 'up', 'SevenIsland_TanobyRuins_MoneanChamber');
  const dark = await probe(game);
  expect(dark.savedWeather, 'setweather WEATHER_SHADE').toBe(WEATHER_SHADE);
  expectShaded(dark);

  await game.eval((t) => t.enterWarp());
  await game.waitFor((t) => t.field()?.map === 'SevenIsland_TanobyRuins' && t.idle(), { what: 'the ruins' });
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_UNLOCKED_TANOBY_RUINS'));
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y]), 'back on the chamber entrance').toEqual([120, 10]);
  // (once, under load, the walk back up never reached the chamber: check the step down took)
  expect(await game.walk('down'), 'a step off the entrance').toMatchObject({ x: 120, y: 11, arrived: true });
  await warp(game, 'up', 'SevenIsland_TanobyRuins_MoneanChamber');
  const lit = await probe(game);
  expect(lit.savedWeather).toBe(WEATHER_NONE);
  expectUnshaded(lit);
});

test("Navel Rock's summit: Ho-Oh's scene lifts the shade (setweather 0, doweather: a gamma step a frame)", async () => {
  const game = await session.start({ start: 'after-rival', map: 'NavelRock_Summit', x: 9, y: 13 });
  await startedIdle(game);
  expectShaded(await probe(game));
  // The trigger above (VAR_TEMP_1 == 0: FLAG_HO_OH_FLEW_AWAY unset) runs NavelRock_Summit_EventScript_HoOh
  const lifted = game.watch(
    (t) => {
      const w = t.weather()!;
      const g = ((window as unknown as { __gammas?: number[] }).__gammas ??= []);
      if (g[g.length - 1] !== w.gammaIndex) g.push(w.gammaIndex);
      return w.gammaIndex === 0 && w.palProcessingState === 3 && { gammas: g, w, script: t.field()!.script };
    },
    { what: 'the shade lifted' },
  );
  await game.walk('up');
  const { gammas, w, script } = await lifted;
  expect(script).toBe('NavelRock_Summit_EventScript_HoOh');
  expect(gammas).toEqual([3, 2, 1, 0]);
  expect(w).toMatchObject({ currWeather: WEATHER_NONE, savedWeather: WEATHER_NONE });
  expectUnshaded(await probe(game));
});

test("the weather is saved: CONTINUE in a darkened Tanoby chamber is dark again (its header's weather is NONE)", async () => {
  const game = await session.start({ start: 'after-rival', map: 'SevenIsland_TanobyRuins', x: 120, y: 11 });
  await startedIdle(game);
  await warp(game, 'up', 'SevenIsland_TanobyRuins_MoneanChamber');
  await game.walk('up');
  // START → SAVE → YES
  await game.waitIdle();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  await game.pressTimes('DOWN', (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length);
  await game.press('A');
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press('UP');
  await game.press('A');
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
  expect(await game.eval(() => JSON.parse(localStorage.getItem('firered-phaser:save') ?? 'null')?.weather)).toBe(WEATHER_SHADE);

  await game.load({ keepSave: true, mainMenu: true });
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading, { what: 'the main menu' });
  await game.press('A');
  await game.waitForEvent('ready', { timeout: 60_000 });
  await game.waitIdle();
  await game.waitFor((t) => t.weather()?.palProcessingState === 3, { what: 'the weather idle' });
  expect(await game.eval((t) => t.field()!.map)).toBe('SevenIsland_TanobyRuins_MoneanChamber');
  expectShaded(await probe(game));
});

// ------------------------------------------------------------------ WEATHER_FOG_HORIZONTAL

/**
 * One JASC channel lightened in the fog (BlendPalette(12, RGB(28, 31, 28)) / LightenSpritePaletteInFog), worked out
 * from the C: c + ((target - c) * 12 >> 4) on the 5-bit channel.
 */
const lighten = (v: number, target: number) => {
  const c = v >> 3;
  return Math.floor(((c + (((target - c) * 12) >> 4)) * 255) / 31);
};

/** The fog over the field: the weather's state, the sprites, the sheets. */
const fogProbe = (game: Game) =>
  game.eval(
    (t, player, grass) => ({ w: t.weather()!, fog: t.fog()!, player: t.weather(7, undefined, player)!.sprite!, grass: t.weather(7, undefined, grass)!.sprite! }),
    PLAYER_SHEET,
    TALL_GRASS_SHEET,
  );

/** Fogged: the 20 sprites tile the screen (a 64-px pattern) at blend (12, 8), the BG palettes as loaded, the GAMMA_NORMAL sheets lightened. */
function expectFogged(p: Awaited<ReturnType<typeof fogProbe>>) {
  expect(p.w).toMatchObject({ currWeather: WEATHER_FOG_HORIZONTAL, gammaIndex: 0, palProcessingState: WEATHER_PAL_STATE_IDLE, blendEVA: 12, blendEVB: 8 });
  expect(p.w.palette, 'the BG palettes as loaded').toEqual(p.w.unfaded);
  expect(p.fog).toMatchObject({ eva: 12, evb: 8 });
  expect(p.fog.sprites).toHaveLength(20);
  for (let y = 0; y < 160; y += 8) {
    for (let x = 0; x < 240; x += 8) {
      expect(p.fog.sprites.some((s) => x >= s.x && x < s.x + 64 && y >= s.y && y < s.y + 64), `the fog over (${x}, ${y})`).toBe(true);
    }
  }
  expect(p.grass.now, 'the tall grass sheet lightened (GAMMA_NORMAL)').toEqual([lighten(p.grass.original[0], 28), lighten(p.grass.original[1], 31), lighten(p.grass.original[2], 28)]);
  expect(p.player.now, "the player's sheet as loaded").toEqual(p.player.original);
}

/** No fog: no sprites, the sheets as loaded. */
function expectNoFog(p: Awaited<ReturnType<typeof fogProbe>>) {
  expect(p.w).toMatchObject({ currWeather: WEATHER_NONE, palProcessingState: WEATHER_PAL_STATE_IDLE });
  expect(p.w.fogHScrollPosX).toBeUndefined();
  expect(p.fog.sprites).toEqual([]);
  expect(p.grass.now).toEqual(p.grass.original);
}

test('Pokémon Tower 3F is fogged: the sprites blend (12, 8) over the field and scroll with the camera; the stairs down lift it, back up fades it in', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PokemonTower_3F', x: 5, y: 10 });
  await startedIdle(game);
  expectFogged(await fogProbe(game));

  // The rendered screen: under the fog (hidden for a frame) and with it, at a few pixels away from the player and
  // the channelers. BLDALPHA: min(31, (fog * 12 + field * 8) >> 4); the port blends 8-bit colours on the GPU.
  const pixels = await game.eval(async (t) => {
    const points = [[100, 100], [40, 40], [60, 140], [210, 20]];
    t.fog(undefined, undefined, false);
    const under: number[][] = [];
    for (const [x, y] of points) under.push(await t.screenPixel(x, y));
    t.fog(undefined, undefined, true);
    const out: { rgb: number[]; fog: number[] }[] = [];
    for (const [x, y] of points) {
      const rgb = await t.screenPixel(x, y);
      out.push({ rgb, fog: t.fog(x, y)!.fogColor! }); // (the positions this render drew the fog at)
    }
    return points.map((p, i) => ({ p, under: under[i], ...out[i] }));
  });
  for (const { p, under, rgb, fog } of pixels) {
    const expected = fog.map((f, c) => Math.min(255, (f * 12) / 16 + (under[c] * 8) / 16));
    rgb.forEach((v, c) => expect(Math.abs(v - expected[c]), `(${p}) channel ${c}: ${rgb} for fog ${fog} over ${under}`).toBeLessThanOrEqual(3));
  }
  // The player (a priority-2 object in front of the fog's subpriority 0xFF) isn't fogged
  const playerPixel = await game.eval(async (t) => {
    t.fog(undefined, undefined, false);
    const under = await t.screenPixel(120, 76);
    t.fog(undefined, undefined, true);
    return { under, out: await t.screenPixel(120, 76) };
  });
  expect(playerPixel.out, 'a pixel of the player').toEqual(playerPixel.under);

  // The drift: fogHScrollPosX a pixel less every 4 frames, standing still
  const drifted = await game.eval(async (t) => {
    const seen: number[] = [];
    await t.until(() => {
      seen.push(t.weather()!.fogHScrollPosX!);
      return seen.length > 16;
    }, 100);
    return seen;
  });
  expect((drifted[0] - drifted[16]) & 0xff, '16 frames: 4 pixels left').toBe(4);

  // A step up: gSpriteCoordOffsetY 16 more, the fog's rows 16 pixels down; a step left: gSpriteCoordOffsetX 16 more,
  // the fog 16 pixels right (less its drift meanwhile). (Column 6 is gravestones, (4, 10) the stairs.)
  const before = await game.eval((t) => ({ w: t.weather()!, fog: t.fog()! }));
  expect(await game.walk('up'), 'a step up').toMatchObject({ x: 5, y: 9, arrived: true });
  await game.waitIdle();
  const up = await game.eval((t) => ({ w: t.weather()!, fog: t.fog()!, frame: t.frame() }));
  expect(up.fog.spriteCoordOffset.y - before.fog.spriteCoordOffset.y).toBe(16);
  expect((up.fog.sprites[0].y - before.fog.sprites[0].y) & 0xff, 'the rows 16 pixels down').toBe(16);
  expect(await game.walk('left'), 'a step left').toMatchObject({ x: 4, y: 9, arrived: true });
  await game.waitIdle();
  const left = await game.eval((t) => ({ w: t.weather()!, fog: t.fog()!, frame: t.frame() }));
  expect(left.fog.spriteCoordOffset.x - up.fog.spriteCoordOffset.x).toBe(16);
  const moved = (left.w.fogHScrollPosX! - up.w.fogHScrollPosX!) & 0xff;
  // The drift is a pixel every 4 frames, however many frames the step and waitIdle took (a loaded machine
  // takes more: a race when this allowed a fixed 30 pixels)
  const stepFrames = left.frame - up.frame;
  const drift = (16 - moved) & 0xff;
  expect(drift, `the camera scroll less ${stepFrames} frames of drift`).toBeGreaterThanOrEqual(Math.floor(stepFrames / 4) - 1);
  expect(drift).toBeLessThanOrEqual(Math.ceil(stepFrames / 4) + 1);
  expect(left.fog.sprites.map((s) => (s.x - left.w.fogHScrollPosX! + 512) % 64), 'the columns 64 pixels apart from fogHScrollPosX').toEqual(Array(20).fill(0));
  await game.walk('right');
  await game.walk('down');
  await game.waitIdle();

  // Down the stairs: Pokémon Tower 2F's header weather (NONE); StartWeather drops the sprites
  await game.walk('left'); // onto the stairs (a push warp)
  expect(await game.eval((t) => t.enterWarp())).toBe('PokemonTower_2F');
  await game.waitFor((t) => t.weather()!.palProcessingState === 3, { what: 'the weather idle' });
  expectNoFog(await fogProbe(game));
  expect(await game.eval((t) => [t.weather()!.blendEVA, t.weather()!.blendEVB]), 'StartWeather: Weather_SetBlendCoeffs(16, 0)').toEqual([16, 0]);

  // Back up: FadeInScreen_FogHorizontal fades the screen in (16 blend steps, then a frame before idle), the fog's
  // sprites up at (12, 8) from the first of them (FogHorizontal_InitAll)
  const fade = game.eval(async (t) => {
    let frames = 0;
    let overlayDone = -1;
    let fogAtStart: { sprites: number; eva: number; evb: number } | undefined;
    await t.until(() => {
      const w = t.weather()!;
      if (w.currWeather === 6 && w.palProcessingState === 1) {
        frames++;
        if (frames === 2) fogAtStart = { sprites: t.fog()!.sprites.length, eva: w.blendEVA, evb: w.blendEVB };
      }
      if (frames > 0 && overlayDone < 0 && !w.fading) overlayDone = frames;
      return frames > 0 && w.palProcessingState === 3;
    }, 20000);
    return { frames, overlayDone, fogAtStart };
  });
  expect(await game.eval((t) => t.enterWarp())).toBe('PokemonTower_3F');
  const { frames, overlayDone, fogAtStart } = await fade;
  expect(frames, 'FADING_IN frames: FadeScreen, Task_WeatherInit, 16 steps and the last one').toBeGreaterThanOrEqual(17);
  expect(frames).toBeLessThanOrEqual(19);
  expect(overlayDone, 'the overlay ends with the weather fade').toBeGreaterThanOrEqual(frames - 1);
  expect(fogAtStart).toEqual({ sprites: 20, eva: 12, evb: 8 });
  expectFogged(await fogProbe(game));
});

test('a battle transition in the fog: the GBA layer blends the fog over its copy of the field; the fog is back after', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PokemonTower_3F', x: 5, y: 10, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await startedIdle(game);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_SILPH_SCOPE'), 1)); // a wild ghost to fight, not the unidentified one
  const inTransition = game.watch((t) => {
    const fog = t.fog();
    return fog && fog.gbaSemiPixels > 0 && { semi: fog.gbaSemiPixels, bldalpha: t.gpuReg(0x52) };
  }, { what: 'the fog on the GBA layer' });
  const mark = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'GASTLY', level: 2 }));
  await game.waitForEvent('battleTransition', { since: mark });
  const { semi, bldalpha } = await inTransition;
  expect(semi, 'semi-transparent OBJ pixels: most of the screen').toBeGreaterThan(240 * 160 * 0.8);
  expect(bldalpha, 'BLDALPHA_BLEND(12, 8)').toBe(12 | (8 << 8));
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  await game.mashUntil((t) => t.idle(), { what: 'the field after the battle' });
  await game.waitFor((t) => t.weather()!.palProcessingState === 3, { what: 'the weather idle' });
  expectFogged(await fogProbe(game));
});

test('the Lost Cave is fogged', async () => {
  const game = await session.start({ start: 'after-rival', map: 'FiveIsland_LostCave_Room1', x: 8, y: 4 });
  await startedIdle(game);
  const p = await fogProbe(game);
  expect(p.w.savedWeather).toBe(WEATHER_FOG_HORIZONTAL);
  expectFogged(p);
});
