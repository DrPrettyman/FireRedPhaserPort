// The Pokédex area page (menus/pokedexArea.ts: pokedex_screen.c's DexScreen_DrawMonAreaPage, pokedex_area_markers.c)
// from the mon page: A shows the map with the species' markers, its icon, number and name, the types and the size
// comparison (both silhouettes) once caught; "AREA UNKNOWN" when it lives nowhere; B goes back to the mon page and A
// back to the list. The page's state comes from `t.pokedexArea()`, the screen's from `t.pokedex()`.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

// include/constants/pokemon.h
const TYPE_NORMAL = 0;
const TYPE_FLYING = 2;
const TYPE_POISON = 3;
const TYPE_GRASS = 12;

/** Replace the Pokédex flags with these national dex numbers and unlock the given Sevii islands' maps. */
async function setDex(game: Game, seen: number[], caught: number[], islands: string[] = []) {
  await game.eval(
    (t, seen, caught, islands) => {
      const s = t.state!;
      s.setFlag('FLAG_SYS_POKEDEX_GET', true);
      s.dexSeen.clear();
      s.dexCaught.clear();
      for (const n of seen) s.dexSeen.add(n);
      for (const n of caught) s.dexCaught.add(n);
      for (const island of islands) s.setFlag(`FLAG_WORLD_MAP_${island}_ISLAND`, true);
    },
    seen,
    caught,
    islands,
  );
}

/** START → POKéDEX → the top menu → A on NUMERICAL MODE → the Kanto list. */
async function openKantoList(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.until(() => !!t.startMenu()));
  await game.press('A');
  await game.waitFor((t) => t.gbaScreen() === 'CB2_PokedexScreen', { what: 'the Pokédex' });
  await game.eval((t) => t.until(() => t.pokedex()?.task === 'Task_PokedexScreen' && !!t.pokedex()?.ready));
  await game.press('A');
  await game.eval((t) => t.until(() => t.pokedex()?.task === 'Task_DexScreen_NumericalOrder' && !!t.pokedex()?.ready));
}

/** Wait until the mon page shows `species` and takes input. */
async function waitMonPage(game: Game, species: number) {
  await game.eval(
    (t, species) => t.until(() => t.pokedex()?.task === 'Task_DexScreen_ShowMonPage' && !!t.pokedex()?.ready && t.pokedex()?.monPage?.species === species),
    species,
  );
}

/** A on the mon page → the area page of `species`, once it takes input. */
async function openAreaPage(game: Game, species: number) {
  await game.press('A');
  await game.eval((t, species) => t.until(() => !!t.pokedexArea()?.ready && t.pokedexArea()?.species === species), species);
  // The markers show on Task_ShowAreaMarkers' first run, the frame after they're created.
  await game.eval((t) => t.waitFrames(2));
  return (await game.eval((t) => t.pokedexArea()))!;
}

test('the area page: markers, types and silhouettes for a caught mon, AREA UNKNOWN, a seen-only mon, back out', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  // Bulbasaur (caught, lives nowhere wild), Pidgey (caught), Rattata (seen only).
  await setDex(game, [1, 16, 19], [1, 16]);
  await openKantoList(game);

  // Bulbasaur: no markers, so "AREA UNKNOWN"; caught, so its types and the size comparison.
  await game.press('A');
  await waitMonPage(game, 1);
  let area = await openAreaPage(game, 1);
  expect(area).toMatchObject({ markers: 0, areaUnknown: true, kantoMapVoff: 4, unlockedSeviiAreas: 0, types: [TYPE_GRASS, TYPE_POISON] });
  expect(area.typePixels).toBeGreaterThan(100);
  expect(area.iconPixels).toBeGreaterThan(100);
  // gPokedexEntries[NATIONAL_DEX_BULBASAUR]: pokemonScale 356, pokemonOffset 16, trainerScale 256, trainerOffset -2
  expect(area.silhouettes).toEqual([
    { x: 40, y: 104, y2: 16, paletteNum: 2, affineMode: 1, matrixNum: 2, scale: [356, 356], priority: 1 },
    { x: 80, y: 104, y2: -2, paletteNum: 2, affineMode: 1, matrixNum: 1, scale: [256, 256], priority: 1 },
  ]);
  await game.screenshot('pokedex-area-bulbasaur');

  // B: back to Bulbasaur's mon page; the markers and silhouettes are gone.
  await game.press('B');
  await waitMonPage(game, 1);
  expect(await game.eval((t) => t.pokedexArea())).toBeUndefined();
  expect((await game.eval((t) => t.pokedex()))!.monPage).toMatchObject({ name: 'BULBASAUR' });
  await game.screenshot('pokedex-area-back-to-mon-page');

  // Pidgey: 13 markers (Routes 1, 2, 3, 5, 6, 7, 8, 12, 13, 14, 15, 24, 25), shown over the map.
  await game.press('DOWN');
  await waitMonPage(game, 16);
  area = await openAreaPage(game, 16);
  expect(area).toMatchObject({ markers: 13, areaUnknown: false, types: [TYPE_NORMAL, TYPE_FLYING] });
  // CreatePokedexAreaMarkers(..., kantoMapVoff * 8): the sprite at (104, 32 + 32)
  expect(area.markersSprite).toEqual({ x: 104, y: 64, invisible: false });
  // gPokedexEntries[NATIONAL_DEX_PIDGEY]: pokemonScale 492, pokemonOffset 18
  expect(area.silhouettes.map((s) => [s.scale[0], s.y2])).toEqual([
    [492, 18],
    [256, -2],
  ]);
  await game.screenshot('pokedex-area-pidgey');
  await game.press('B');
  await waitMonPage(game, 16);

  // Rattata, seen only: markers, but no types and no silhouettes.
  await game.press('DOWN');
  await waitMonPage(game, 19);
  area = await openAreaPage(game, 19);
  expect(area.markers).toBeGreaterThan(0);
  expect(area).toMatchObject({ areaUnknown: false, types: [], typePixels: 0, silhouettes: [] });
  expect(area.iconPixels).toBeGreaterThan(100);
  await game.screenshot('pokedex-area-rattata');

  // A: straight back to the list, on Rattata.
  await game.press('A');
  await game.eval((t) => t.until(() => t.pokedex()?.task === 'Task_DexScreen_NumericalOrder' && !!t.pokedex()?.ready));
  expect(await game.eval((t) => t.pokedexArea())).toBeUndefined();
  expect((await game.eval((t) => t.pokedex()))!.orderedList!.species).toBe(19);
});

test('with a postgame island unlocked, the Kanto map moves up and the Sevii areas get markers', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  // Three Island (Bond Bridge, Berry Forest) and Five Island (Five Isle Meadow): Pidgey has 16 markers.
  await setDex(game, [1, 16], [16], ['THREE', 'FIVE']);
  await openKantoList(game);
  await game.press('A');
  await waitMonPage(game, 1);
  await game.press('DOWN');
  await waitMonPage(game, 16);
  const area = await openAreaPage(game, 16);
  expect(area).toMatchObject({ markers: 16, kantoMapVoff: 0, unlockedSeviiAreas: 0b10100 });
  expect(area.markersSprite).toEqual({ x: 104, y: 32, invisible: false });
  await game.screenshot('pokedex-area-sevii');
  await game.press('B');
  await waitMonPage(game, 16);
});
