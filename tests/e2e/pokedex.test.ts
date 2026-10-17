// The Pokédex screen (menus/pokedexScreen.ts, pokedex_screen.c) from the start menu: the top menu with its seen /
// owned counts, the numerical lists (Kanto, and national with the National Dex), scrolling them, the mon page
// (up/down through the seen mons, back to the list), the search lists (A TO Z, LIGHTEST), the habitat pages (from
// the top menu and from a search list's A), closing back to the start menu and the field, and the "registered" page
// after catching a new species. The screen is on the GBA layer: its state comes from `t.pokedex()`; `ready` means
// its task takes input.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

// DEX_CATEGORY_COUNT + DEX_ORDER_*: the top menu's item indexes
const DEX_MODE_NUMERICAL_KANTO = 9;
const DEX_MODE_NUMERICAL_NATIONAL = 14;
const DEX_MODE_ATOZ = 10;
const DEX_MODE_LIGHTEST = 12;
const DEX_CATEGORY_FOREST = 1;

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

/** Wait (in the page) until the mon page shows `species` and takes input. */
async function waitMonPage(game: Game, species: number) {
  await game.eval(
    (t, species) => t.until(() => t.pokedex()?.task === 'Task_DexScreen_ShowMonPage' && !!t.pokedex()?.ready && t.pokedex()?.monPage?.species === species),
    species,
  );
  return (await game.eval((t) => t.pokedex()))!.monPage!;
}

/** On the top menu: DOWN until `mode` is selected. */
async function selectMode(game: Game, mode: number) {
  for (let i = 0; i < 20; i++) {
    if ((await game.eval((t) => t.pokedex()))!.modeSelect?.selected === mode) return;
    await game.press('DOWN');
  }
  throw new Error(`mode ${mode} not reached`);
}

test('A on a seen mon shows its page; up/down go through the seen mons; B goes back to the list', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  // Seen: Bulbasaur, Charmander, Squirtle, Pikachu, Geodude; caught: all but Squirtle.
  await setDex(game, [1, 4, 7, 25, 74], [1, 4, 25, 74]);
  await openPokedex(game);
  await game.press('A');
  await waitReady(game, 'Task_DexScreen_NumericalOrder');

  // A on Bulbasaur (caught): the full page.
  await game.press('A');
  let page = await waitMonPage(game, 1);
  expect(page).toMatchObject({ name: 'BULBASAUR', category: 'SEED POKéMON' });
  // Imperial like the C prints it: 0.7 m = 2'04", 6.9 kg = 15.2 lbs.
  expect(page.height).toMatch(/^HT +2.04.$/);
  expect(page.weight).toMatch(/^WT +15\.2 lbs\.$/);
  expect(page.flavorText).toContain('plant seed on its back');
  expect(page.picPixels).toBeGreaterThan(500);
  expect(page.footprintPixels).toBeGreaterThan(0);
  await game.screenshot('pokedex-mon-page-bulbasaur');

  // DOWN: Charmander (caught); DOWN again: Squirtle, seen but not caught, so the unknown fields.
  await game.press('DOWN');
  page = await waitMonPage(game, 4);
  expect(page).toMatchObject({ name: 'CHARMANDER', category: 'LIZARD POKéMON' });
  await game.press('DOWN');
  page = await waitMonPage(game, 7);
  expect(page).toMatchObject({ name: 'SQUIRTLE', category: '??????????? POKéMON', flavorText: '', footprintPixels: 0 });
  expect(page.height).toMatch(/^HT +\?\?.\?\?.$/);
  expect(page.weight).toMatch(/^WT\?\?\?\?\.\? lbs\.$/);
  expect(page.picPixels).toBeGreaterThan(500);
  await game.screenshot('pokedex-mon-page-squirtle');

  // DOWN skips the unseen numbers 8-24 (Pikachu, then Geodude); at the last seen mon DOWN does nothing.
  await game.press('DOWN');
  page = await waitMonPage(game, 25);
  expect(page).toMatchObject({ name: 'PIKACHU', category: 'MOUSE POKéMON' });
  await game.press('DOWN');
  page = await waitMonPage(game, 74);
  await game.press('DOWN');
  await game.eval((t) => t.waitFrames(10));
  expect(await game.eval((t) => t.pokedex()!.state)).toBe(5);
  expect((await game.eval((t) => t.pokedex()))!.monPage?.species).toBe(74);
  // UP goes back to Pikachu.
  await game.press('UP');
  page = await waitMonPage(game, 25);

  // B: the Kanto list (up to Geodude, 74) with the cursor on Pikachu, row 24: the C puts it 4 rows down the window.
  await game.press('B');
  const list = (await waitReady(game, 'Task_DexScreen_NumericalOrder')).orderedList!;
  expect(list).toMatchObject({ species: 25, cursorPos: 20, itemsAbove: 4, count: 74 });
  // ... and A on it shows Pikachu again.
  await game.press('A');
  await waitMonPage(game, 25);
  await game.press('B');
  await waitReady(game, 'Task_DexScreen_NumericalOrder');
});

test('the search lists: A TO Z lists the seen mons by name, LIGHTEST the caught ones by weight', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await setDex(game, [1, 4, 7, 25, 74], [1, 4, 25, 74]);
  await openPokedex(game);

  await selectMode(game, DEX_MODE_ATOZ);
  await game.press('A');
  let list = (await waitReady(game, 'Task_DexScreen_CharacteristicOrder')).orderedList!;
  // BULBASAUR, CHARMANDER, GEODUDE, PIKACHU, SQUIRTLE
  expect(list).toMatchObject({ order: 1, count: 5, cursorPos: 0, itemsAbove: 0, species: 1 });
  expect(list.items).toEqual([1, 4, 74, 25, 7]);
  await game.press('DOWN');
  expect((await game.eval((t) => t.pokedex()))!.orderedList!.species).toBe(4);

  // B: back to the top menu, still on A TO Z.
  await game.press('B');
  expect((await waitReady(game, 'Task_PokedexScreen')).modeSelect?.selected).toBe(DEX_MODE_ATOZ);

  // LIGHTEST: Pikachu 6.0 kg, Bulbasaur 6.9, Charmander 8.5, Geodude 20.0 (Squirtle isn't caught); the cursor
  // starts at the top again (the search lists share one saved cursor, reset when one opens).
  await selectMode(game, DEX_MODE_LIGHTEST);
  await game.press('A');
  list = (await waitReady(game, 'Task_DexScreen_CharacteristicOrder')).orderedList!;
  expect(list).toMatchObject({ order: 3, count: 4, cursorPos: 0, itemsAbove: 0, species: 25, caught: true });
  expect(list.items).toEqual([25, 1, 4, 74]);
  await game.screenshot('pokedex-lightest');
  await game.press('B');
  await waitReady(game, 'Task_PokedexScreen');
});

/** Wait (in the page) until the habitat page takes input on `page` with the cursor on `cursor`. */
async function waitCategoryPage(game: Game, page: number, cursor: number) {
  await game.eval(
    (t, page, cursor) =>
      t.until(() => {
        const p = t.pokedex();
        return p?.task === 'Task_DexScreen_CategorySubmenu' && p.state === 5 && p.ready && p.categoryPage?.pageNum === page && p.categoryPage.cursor === cursor;
      }),
    page,
    cursor,
  );
  return (await game.eval((t) => t.pokedex()))!.categoryPage!;
}

test('a habitat shows its seen mons page by page; A zooms into a mon\'s page, B goes back', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  // Forest's pages: [Caterpie, Metapod, Butterfree], [Weedle, Kakuna, Beedrill], two Hoenn pages, [Pidgey, ...].
  // Seen: Caterpie, Butterfree, Weedle, Pidgey (caught: Caterpie). The Hoenn pages stay locked without the National Dex.
  await setDex(game, [10, 12, 13, 16], [10]);
  await openPokedex(game);
  await selectMode(game, DEX_CATEGORY_FOREST);
  await game.press('A');
  let page = await waitCategoryPage(game, 0, 0);
  expect(page).toMatchObject({ category: DEX_CATEGORY_FOREST, firstPage: 0, lastPage: 5, species: [10, 12] });
  expect(page.picPixels.every((n) => n > 300)).toBe(true);
  await game.screenshot('pokedex-habitat-forest');

  // RIGHT moves the cursor to Butterfree, then flips to the next unlocked page (Weedle) with the cursor on its first mon.
  await game.press('RIGHT');
  await waitCategoryPage(game, 0, 1);
  await game.press('RIGHT');
  page = await waitCategoryPage(game, 1, 0);
  expect(page.species).toEqual([13]);
  // RIGHT again skips the locked Hoenn pages to Pidgey's page.
  await game.press('RIGHT');
  page = await waitCategoryPage(game, 4, 0);
  expect(page.species).toEqual([16]);
  // LEFT flips back to Weedle's page, the cursor on its last mon.
  await game.press('LEFT');
  await waitCategoryPage(game, 1, 0);
  await game.press('LEFT');
  page = await waitCategoryPage(game, 0, 1);
  expect(page.species).toEqual([10, 12]);

  // With BUTTON MODE LR, R and L flip pages too (DexScreen_InputHandler_GetShoulderInput).
  await game.eval((t) => (t.state!.optionsButtonMode = t.define('OPTIONS_BUTTON_MODE_LR')));
  await game.press('R');
  await waitCategoryPage(game, 1, 0);
  await game.press('L');
  await waitCategoryPage(game, 0, 1);

  // A on Butterfree: its page zooms out of the box.
  await game.press('A');
  await game.eval((t) => t.until(() => t.pokedex()?.task === 'Task_DexScreen_CategorySubmenu' && t.pokedex()?.state === 17 && !!t.pokedex()?.ready));
  const mon = (await game.eval((t) => t.pokedex()))!.monPage!;
  expect(mon).toMatchObject({ species: 12, name: 'BUTTERFREE', category: '??????????? POKéMON' });
  expect(mon.picPixels).toBeGreaterThan(500);
  // B zooms back into the habitat page on Butterfree.
  await game.press('B');
  await waitCategoryPage(game, 0, 1);
  // B leaves the habitat for the top menu, still on FOREST.
  await game.press('B');
  expect((await waitReady(game, 'Task_PokedexScreen')).modeSelect?.selected).toBe(DEX_CATEGORY_FOREST);
});

test('A on a search list opens the mon\'s habitat page; B goes back to the list', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await setDex(game, [10, 12, 13, 16], [10]);
  await openPokedex(game);
  await selectMode(game, DEX_MODE_ATOZ);
  await game.press('A');
  // BUTTERFREE, CATERPIE, PIDGEY, WEEDLE
  let list = (await waitReady(game, 'Task_DexScreen_CharacteristicOrder')).orderedList!;
  expect(list.items).toEqual([12, 10, 16, 13]);
  // A on BUTTERFREE: Forest's first page, the cursor on it (after Caterpie).
  await game.press('A');
  const page = await waitCategoryPage(game, 0, 1);
  expect(page).toMatchObject({ category: DEX_CATEGORY_FOREST, species: [10, 12] });
  // B: back to A TO Z on BUTTERFREE (parentOfCategoryMenu = 1).
  await game.press('B');
  list = (await waitReady(game, 'Task_DexScreen_CharacteristicOrder')).orderedList!;
  expect(list).toMatchObject({ order: 1, species: 12 });
  await game.press('B');
  await waitReady(game, 'Task_PokedexScreen');
});

test('catching a new species shows its habitat page and Pokédex page, then the nickname prompt', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 12, y: 7, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  // Pidgeotto seen: the registered page is Pidgey's habitat page [Pidgey, Pidgeotto].
  await setDex(game, [17], []);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_MASTER_BALL'), 1));
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2 }));
  await game.chooseAction('BAG');
  await game.eval((t) => t.waitFrames(60)); // the bag fades in
  await game.pressTimes('RIGHT', 2);
  await game.pressTimes('A', 2);

  // "Gotcha! PIDGEY was caught!", "PIDGEY's data was added to the POKéDEX." → the registered page.
  await game.mashUntil((t) => t.pokedex()?.task === 'Task_DexScreen_RegisterMonToPokedex', { what: 'the registered page' });
  await game.eval((t) => t.until(() => !!t.pokedex()?.ready));
  const dex = (await game.eval((t) => t.pokedex()))!;
  expect(dex.categoryPage).toMatchObject({ category: DEX_CATEGORY_FOREST, pageNum: 4, species: [16, 17], cursor: 0 });
  expect(dex.monPage).toMatchObject({ species: 16, name: 'PIDGEY', category: 'TINY POKéMON' });
  expect(dex.monPage!.flavorText).not.toBe('');
  expect(await game.eval((t) => t.state!.dexCaught.has(16))).toBe(true);
  await game.screenshot('pokedex-registered-pidgey');

  // A closes it; the battle comes back with "Give a nickname to the captured PIDGEY?" (B: no).
  await game.press('A');
  await game.waitFor((t) => !t.pokedex() && /nickname/i.test(t.battle()?.message ?? ''), { what: 'the nickname prompt' });
  await game.screenshot('pokedex-registered-back-to-battle');
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field after the battle' });
  const party = await game.eval((t) => t.party());
  expect(party[1]).toMatchObject({ species: 'PIDGEY', nickname: 'PIDGEY' });
});
