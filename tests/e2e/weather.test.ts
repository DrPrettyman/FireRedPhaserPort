// Field weather (field_weather.c, world/weather.ts): WEATHER_SHADE's gamma shift on the map's BG palettes (read back
// from the atlas canvas) and on the sprite sheets the C shifts (the field effects' GAMMA_NORMAL palettes; the
// objects' own GAMMA_ALT ones stay as they are at gamma index 3), the fade in with the weather's palettes, the saved
// weather on map loads (SetSavedWeatherFromCurrMapHeader), the scripts' `setweather` / `doweather` (the Tanoby
// chambers' EventScript_TryDarkenRuins, Navel Rock's summit) and the weather in the save.
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

/** Walk `dir` onto a warp and wait until the new map is up and the field takes input. */
async function warp(game: Game, dir: 'up' | 'down', to: string) {
  await game.walk(dir);
  const arrived = await game.eval((t, to) => t.until(() => t.field()?.map === to && t.idle(), 20000), to);
  expect(arrived, `the field on ${to}`).toBeTruthy();
}

test('Viridian Forest is shaded: the fade in blends to the shaded palettes in 16 frames; leaving it lifts the shade', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route2_ViridianForest_SouthEntrance', x: 7, y: 2 });
  await game.waitIdle();
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
  await game.waitIdle();
  await warp(game, 'up', 'SevenIsland_TanobyRuins_MoneanChamber');
  const dark = await probe(game);
  expect(dark.savedWeather, 'setweather WEATHER_SHADE').toBe(WEATHER_SHADE);
  expectShaded(dark);

  await game.eval((t) => t.enterWarp());
  await game.waitFor((t) => t.field()?.map === 'SevenIsland_TanobyRuins' && t.idle(), { what: 'the ruins' });
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_UNLOCKED_TANOBY_RUINS'));
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y]), 'back on the chamber entrance').toEqual([120, 10]);
  await game.walk('down');
  await warp(game, 'up', 'SevenIsland_TanobyRuins_MoneanChamber');
  const lit = await probe(game);
  expect(lit.savedWeather).toBe(WEATHER_NONE);
  expectUnshaded(lit);
});

test("Navel Rock's summit: Ho-Oh's scene lifts the shade (setweather 0, doweather: a gamma step a frame)", async () => {
  const game = await session.start({ start: 'after-rival', map: 'NavelRock_Summit', x: 9, y: 13 });
  await game.waitIdle();
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
  await game.waitIdle();
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
