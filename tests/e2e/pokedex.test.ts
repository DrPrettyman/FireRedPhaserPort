// The Pokédex screen (menus/pokedexScreen.ts, pokedex_screen.c) from the start menu: the top menu with its seen /
// owned counts, the numerical lists (Kanto, and national with the National Dex), scrolling them, and closing back
// to the start menu and the field. The screen is on the GBA layer: its state comes from `t.pokedex()`; `ready`
// means its task takes input.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

// DEX_CATEGORY_COUNT + DEX_ORDER_*: the top menu's item indexes
const DEX_MODE_NUMERICAL_KANTO = 9;
const DEX_MODE_NUMERICAL_NATIONAL = 14;

/** Replace the Pokédex flags with these national dex numbers; `national` turns on the National Dex (EnableNationalPokedex). */
async function setDex(game: Game, seen: number[], caught: number[], national = false) {
  await game.eval(
    (t, seen, caught, national) => {
      const s = t.state!;
      s.setFlag('FLAG_SYS_POKEDEX_GET', true);
      s.dexSeen.clear();
      s.dexCaught.clear();
      for (const n of seen) s.dexSeen.add(n);
      for (const n of caught) s.dexCaught.add(n);
      if (national) {
        s.nationalDexEnabled = true;
        s.setVar('VAR_NATIONAL_DEX', 0x6258);
        s.setFlag('FLAG_SYS_NATIONAL_DEX', true);
      }
    },
    seen,
    caught,
    national,
  );
}

/** Wait (in the page) until the screen's `task` takes input. */
async function waitReady(game: Game, task: string) {
  await game.eval((t, task) => t.until(() => t.pokedex()?.task === task && !!t.pokedex()?.ready), task);
  return (await game.eval((t) => t.pokedex()))!;
}

/** START → the start menu's first entry (POKéDEX) → A → the top menu. */
async function openPokedex(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.until(() => !!t.startMenu()));
  const menu = (await game.eval((t) => t.startMenu()))!;
  expect(menu.items[menu.cursor]).toBe('POKEDEX');
  await game.press('A');
  await game.waitFor((t) => t.gbaScreen() === 'CB2_PokedexScreen', { what: 'the Pokédex' });
  return waitReady(game, 'Task_PokedexScreen');
}

test('the Pokédex opens from the start menu with the counts, scrolls the Kanto list and closes back to the field', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  // Seen: Bulbasaur..Pidgey (1-16) and Pikachu (25); caught: Bulbasaur, Charmander, Squirtle. Chikorita (152) is
  // seen too: only the national count has it.
  const seen = [...Array.from({ length: 16 }, (_, i) => i + 1), 25, 152];
  const caught = [1, 4, 7];
  await setDex(game, seen, caught);
  const top = await openPokedex(game);
  expect(top.counts).toEqual({ seenKanto: 17, ownedKanto: 3, seenNational: 18, ownedNational: 3 });
  // The cursor starts on NUMERICAL MODE (modeSelectItemsAbove = 1, under the POKéMON LIST header).
  expect(top.modeSelect).toMatchObject({ cursorPos: 0, itemsAbove: 1, selected: DEX_MODE_NUMERICAL_KANTO });
  // Grassland (Rattata..), Forest (Caterpie..) are unlocked by the seen mons; Rare (Mew..) isn't.
  expect(top.unlockedCategories & 1).toBe(1);
  expect(top.unlockedCategories & (1 << 8)).toBe(0);

  // NUMERICAL MODE: every number up to the last one seen (Pikachu, 25).
  await game.press('A');
  let list = (await waitReady(game, 'Task_DexScreen_NumericalOrder')).orderedList!;
  expect(list).toMatchObject({ order: 0, count: 25, cursorPos: 0, itemsAbove: 0, species: 1, seen: true, caught: true });

  // Down a row: Ivysaur, seen but not caught.
  await game.press('DOWN');
  list = (await game.eval((t) => t.pokedex()))!.orderedList!;
  expect(list).toMatchObject({ cursorPos: 0, itemsAbove: 1, seen: true, caught: false });
  // RIGHT pages down by 9 rows (scrollMultiple = LIST_MULTIPLE_SCROLL_DPAD): row 10, scrolled.
  await game.press('RIGHT');
  list = (await game.eval((t) => t.pokedex()))!.orderedList!;
  expect(list.cursorPos + list.itemsAbove).toBe(10);
  expect(list.cursorPos).toBeGreaterThan(0);
  // To the bottom: the last row is Pikachu; row 17 (Spearow, 21) is unseen.
  await game.pressTimes('RIGHT', 3);
  list = (await game.eval((t) => t.pokedex()))!.orderedList!;
  expect(list).toMatchObject({ cursorPos: 16, itemsAbove: 8, seen: true, caught: false });
  await game.pressTimes('UP', 4);
  list = (await game.eval((t) => t.pokedex()))!.orderedList!;
  expect(list.cursorPos + list.itemsAbove).toBe(20);
  expect(list.seen).toBe(false);

  // B: back to the top menu (still on NUMERICAL MODE); the Kanto list remembers its row.
  await game.press('B');
  expect((await waitReady(game, 'Task_PokedexScreen')).modeSelect?.selected).toBe(DEX_MODE_NUMERICAL_KANTO);
  await game.press('A');
  list = (await waitReady(game, 'Task_DexScreen_NumericalOrder')).orderedList!;
  expect(list.cursorPos + list.itemsAbove).toBe(20);

  // B twice closes the Pokédex into the start menu (CB2_ReturnToFieldWithOpenMenu).
  await game.press('B');
  await waitReady(game, 'Task_PokedexScreen');
  await game.press('B');
  await game.waitFor((t) => !t.gbaScreen() && !!t.startMenu(), { what: 'the start menu' });
  expect(await game.eval((t) => t.pokedex())).toBeUndefined();
  // The start menu takes input once the field has faded in (FadeTransition_FadeInOnReturnToStartMenu).
  await game.eval((t) => t.until(() => !t.field()!.fading));
  // GAME_STAT_CHECKED_POKEDEX counted the visit.
  expect(await game.eval((t) => t.state!.getGameStat(t.define('GAME_STAT_CHECKED_POKEDEX')))).toBe(1);
  await game.press('B');
  await game.waitIdle();

  // Reopened, the screen starts over (DexScreen_LoadResources resets sPokedexScreenData).
  await openPokedex(game);
  await game.press('A');
  list = (await waitReady(game, 'Task_DexScreen_NumericalOrder')).orderedList!;
  expect(list.cursorPos + list.itemsAbove).toBe(0);
});

test('with the National Dex the top menu has NUMERICAL MODE: NATIONAL, which lists past 151', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await setDex(game, [1, 150, 152, 251], [1, 152], true);
  const top = await openPokedex(game);
  expect(top.counts).toEqual({ seenKanto: 2, ownedKanto: 1, seenNational: 4, ownedNational: 2 });
  expect(top.modeSelect?.selected).toBe(DEX_MODE_NUMERICAL_KANTO);
  await game.press('DOWN');
  expect((await game.eval((t) => t.pokedex()))!.modeSelect?.selected).toBe(DEX_MODE_NUMERICAL_NATIONAL);
  await game.press('A');
  const list = (await waitReady(game, 'Task_DexScreen_NumericalOrder')).orderedList!;
  // DEX_ORDER_NUMERICAL_NATIONAL, up to Celebi (251)
  expect(list).toMatchObject({ order: 5, count: 251, species: 1, caught: true });
});

test('POKéDEX does nothing before a mon has been seen (StartMenuPokedexSanityCheck)', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await setDex(game, [], []);
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.until(() => !!t.startMenu()));
  await game.press('A');
  await game.eval((t) => t.waitFrames(30));
  expect(await game.eval((t) => t.startMenu()?.items[t.startMenu()!.cursor])).toBe('POKEDEX');
  expect(await game.eval((t) => t.gbaScreen())).toBeUndefined();
  await game.press('B');
  await game.waitIdle();
});
