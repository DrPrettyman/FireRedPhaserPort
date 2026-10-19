// The National Dex in Kanto (GAPS_PLAN.md W-kanto unit 2): from a postgame save, the IsNationalPokedexEnabled
// branches outside the Pokédex (the trainer card's count, save_menu_util.c's save window, main_menu.c's CONTINUE
// window, party_menu.c's MonCanEvolve, evolution_scene.c's cancel past SPECIES_MEW), the Elite Four and Champion
// rematch teams (FLAG_SYS_CAN_LINK_WITH_RS), and the Kanto NPCs that change after the Hall of Fame
// (FLAG_SYS_GAME_CLEAR) or with the National Dex.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';
import { afterHallOfFame, battlesSince, finishScript, foeOf, MEWTWO, rainbowPassState, talk, takeWarp, warp } from './postgameHelpers';

const session = useGame();

/** EnableNationalPokedex (event_data.c): the magic, VAR_NATIONAL_DEX and FLAG_SYS_NATIONAL_DEX. */
const enableNationalDex = (game: Game) =>
  game.eval((t) => {
    const s = t.state!;
    s.nationalDexEnabled = true;
    s.setVar('VAR_NATIONAL_DEX', 0x6258);
    s.setFlag('FLAG_SYS_NATIONAL_DEX', true);
  });

/**
 * Talk to the object at map-local (x, y) (from below, else from whichever side the player can reach); the messages
 * the script prints, mashing `button`.
 */
async function talkTo(game: Game, x: number, y: number, button: 'A' | 'B' = 'A') {
  const sides = [[0, 1, 'up'], [-1, 0, 'right'], [1, 0, 'left'], [0, -1, 'down']] as const;
  for (const [dx, dy, dir] of sides) {
    const r = await game.eval((t, x, y) => t.walkTo(x, y).catch(() => ({ arrived: false })), x + dx, y + dy);
    if (!r.arrived) continue;
    await game.eval((t, d) => t.face(d), dir);
    await game.press('A');
    await game.waitFor((t) => !!t.message() || !!t.field()!.script, { what: `the script at (${x}, ${y})` });
    return (await finishScript(game, button)).join(' | ');
  }
  throw new Error(`No way to (${x}, ${y})`);
}

// ---------------------------------------------------------------- the dex counts

/** START → PLAYER → the card front, faded in; then B back to the field. Returns the Pokédex count it printed. */
async function trainerCardDexCount(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.until(() => !!t.startMenu()));
  for (let i = 0; i < 8; i++) {
    const menu = (await game.eval((t) => t.startMenu()))!;
    if (menu.items[menu.cursor] === 'PLAYER') break;
    await game.press('DOWN');
  }
  await game.press('A');
  await game.waitFor((t) => t.gbaScreen() === 'CB2_TrainerCard' && t.trainerCard()?.ready, { what: 'the trainer card' });
  const count = (await game.eval((t) => t.trainerCard()!.printed.pokedex)) as string;
  await game.press('B');
  await game.waitFor((t) => !t.gbaScreen() && !!t.startMenu(), { what: 'the start menu' });
  await game.eval((t) => t.until(() => !t.field()!.fading));
  await game.press('B');
  await game.waitIdle();
  return count;
}

/** START → SAVE: the save info window's stats once it's up. */
async function openSaveWindow(game: Game) {
  await game.waitIdle();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  await game.pressTimes('DOWN', (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length);
  await game.press('A');
  return (await game.waitFor((t) => t.saveDialog()?.statsWindow && t.saveDialog()!.stats, { what: 'the save info window' })).map((s) => s.trim());
}

/** The save dialog's YES/NO, once its question has printed (mashing B until it's up). */
async function answerSave(game: Game, yes: boolean) {
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press(yes ? 'UP' : 'DOWN');
  await game.press('A');
}

test('the trainer card, the save window and CONTINUE count the national dex only with the National Dex on', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 12, y: 7, party: [MEWTWO] });
  await afterHallOfFame(game);
  // Kanto 1-10 and two Johto mons (152, 153) caught: 10 Kanto, 12 national
  await game.eval((t) => {
    const s = t.state!;
    s.setFlag('FLAG_SYS_POKEDEX_GET', true);
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 152, 153]) s.setDexFlags(n, true, true);
    // The save block's magic alone isn't IsNationalPokedexEnabled (the var and the flag aren't set)
    s.nationalDexEnabled = true;
  });
  expect(await trainerCardDexCount(game)).toBe('10');
  // The save window (SaveStatToString's SAVE_STAT_POKEDEX): NO goes back to the start menu
  expect(await openSaveWindow(game)).toContain('10');
  await answerSave(game, false);
  await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  await game.press('B');
  await game.waitIdle();

  await enableNationalDex(game);
  expect(await trainerCardDexCount(game)).toBe('12');
  // The save window again, then CONTINUE's (main_menu.c's PrintDexCount) from the save
  const stats = await openSaveWindow(game);
  expect(stats).toContain('12');
  expect(stats).not.toContain('10');
  await answerSave(game, true);
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
  await game.load({ keepSave: true, mainMenu: true });
  const main = await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading && t.mainMenu(), { what: 'the main menu' });
  expect(main.stats.map((s) => s.trim())).toEqual(['PLAYER', '12', expect.any(String), '8']);
}, 300_000);

// ---------------------------------------------------------------- evolutions past Kanto

/** From the field: START → BAG → the only item → USE → the first party mon (the party menu takes input first). */
async function useOnlyItemOnFirstMon(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.until(() => !!t.startMenu()));
  const menu = (await game.eval((t) => t.startMenu()))!;
  await game.pressTimes('DOWN', (menu.items.indexOf('BAG') - menu.cursor + menu.items.length) % menu.items.length);
  await game.press('A');
  await game.waitForBag();
  await game.pressTimes('A', 2);
  await game.waitForPartyMenu();
  await game.press('A');
}

/** Out of the bag (after the item's use is over) to the field. */
async function closeBag(game: Game) {
  await game.waitForBag();
  await game.press('B');
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
}

test('without the National Dex a Sun Stone does nothing to Gloom and Golbat stops evolving into Crobat; with it both evolve', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 12, y: 7, party: [{ species: 'GLOOM', level: 30 }] });
  const party = () => game.eval((t) => t.party().map((m) => m.species));

  // party_menu.c's MonCanEvolve: Bellossom (182) is past KANTO_DEX_COUNT, so CB2_DoUseItemAnim goes straight back
  // to the bag (StartUseItemAnim_CantEvolve) and the stone stays
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_SUN_STONE'), 1));
  const mark = await game.mark();
  await useOnlyItemOnFirstMon(game);
  await closeBag(game);
  expect(await party()).toEqual(['GLOOM']);
  expect(await game.eval((t) => t.itemCount('SUN_STONE'))).toBe(1);
  expect((await game.events(mark)).some((e) => e.type === 'evolution')).toBe(false);

  // evolution_scene.c's Task_EvolutionScene: a Rare Candy levels Golbat up (EVO_FRIENDSHIP), and the scene cancels
  // itself at EVOSTATE_WAIT_CYCLE_MON_SPRITE because Crobat is past SPECIES_MEW
  await game.eval((t) => {
    t.setParty([{ species: 'GOLBAT', level: 30 }]);
    t.state!.party[0].friendship = 255;
    t.state!.bag.remove(t.define('ITEM_SUN_STONE'), 1);
    t.state!.bag.add(t.define('ITEM_RARE_CANDY'), 2);
  });
  await useOnlyItemOnFirstMon(game);
  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_EvolutionSceneUpdate'), { what: 'the evolution scene' });
  expect(await game.waitForEvent('evolution', { since: mark, timeout: 60_000 })).toMatchObject({ stopped: true });
  await game.mashUntil((t) => t.gbaScreen() !== undefined && !t.gbaScreen()!.startsWith('CB2_EvolutionScene'), { what: 'the bag after the evolution' });
  await closeBag(game);
  expect(await game.eval((t) => t.party().map((m) => [m.species, m.level]))).toEqual([['GOLBAT', 31]]);

  // With the National Dex: the next Rare Candy evolves Golbat, and the Sun Stone Gloom
  await enableNationalDex(game);
  const mark2 = await game.mark();
  await useOnlyItemOnFirstMon(game);
  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_EvolutionSceneUpdate'), { what: 'the evolution scene' });
  expect(await game.waitForEvent('evolution', { since: mark2, timeout: 60_000 })).toMatchObject({ stopped: false });
  await game.mashUntil((t) => t.gbaScreen() !== undefined && !t.gbaScreen()!.startsWith('CB2_EvolutionScene'), { what: 'the bag after the evolution' });
  await closeBag(game);
  expect(await party()).toEqual(['CROBAT']);

  await game.eval((t) => {
    t.setParty([{ species: 'GLOOM', level: 30 }]);
    t.state!.bag.add(t.define('ITEM_SUN_STONE'), 1);
  });
  const mark3 = await game.mark();
  await useOnlyItemOnFirstMon(game);
  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_EvolutionSceneUpdate'), { what: 'the evolution scene' });
  expect(await game.waitForEvent('evolution', { since: mark3, timeout: 60_000 })).toMatchObject({ stopped: false });
  await game.mashUntil((t) => t.gbaScreen() !== undefined && !t.gbaScreen()!.startsWith('CB2_EvolutionScene'), { what: 'the bag after the evolution' });
  await closeBag(game);
  expect(await party()).toEqual(['BELLOSSOM']);
  expect(await game.eval((t) => t.itemCount('SUN_STONE'))).toBe(0);
}, 300_000);

// ---------------------------------------------------------------- the Elite Four and Champion rematches

/** After the Hall of Fame, the National Dex and Celio's network machine (FLAG_SYS_CAN_LINK_WITH_RS). */
async function rematchState(game: Game) {
  await afterHallOfFame(game);
  await rainbowPassState(game);
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_CAN_LINK_WITH_RS', true));
}

/** Mash A through the script's messages until the battle starts (since `since`); the messages, joined. */
async function introUntilBattle(game: Game, since: number, what: string) {
  await game.eval((_t, s) => {
    (window as any).__introSince = s;
    (window as any).__intro = [];
  }, since);
  return game.mashUntil((t) => {
    const w = window as any;
    const m = t.message()?.replace(/\s+/g, ' ');
    if (m && !w.__intro.includes(m)) w.__intro.push(m);
    return t.events(w.__introSince).some((e) => e.type === 'battleStart') && (w.__intro as string[]).join(' | ');
  }, { what });
}

test('after the Hall of Fame but before the network machine, Lance greets the returning player with his first team', async () => {
  const game = await session.start({ start: 'after-rival', map: 'IndigoPlateau_PokemonCenter_1F', x: 4, y: 5, party: [MEWTWO] });
  await afterHallOfFame(game);
  // PokemonLeague_LancesRoom_OnFrame: VAR_MAP_SCENE_POKEMON_LEAGUE 3 walks the player up the corridor
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_POKEMON_LEAGUE', 3));
  await warp(game, 'MAP_POKEMON_LEAGUE_LANCES_ROOM', 23, 13);
  await game.waitFor((t) => t.var('VAR_MAP_SCENE_POKEMON_LEAGUE') === 4 && t.idle() && !t.field()!.script, { what: "the corridor into Lance's room", timeout: 120_000 });
  const since = await game.mark();
  await talk(game, 6, 9, 'up');
  // FLAG_SYS_GAME_CLEAR picks the intro, FLAG_SYS_CAN_LINK_WITH_RS the team
  expect(await introUntilBattle(game, since, "Lance's intro")).toMatch(/So, you.ve returned/);
  expect(await battlesSince(game, since)).toEqual([await game.eval((t) => t.define('TRAINER_ELITE_FOUR_LANCE'))]);
  expect(await foeOf(game, "Lance's first mon")).toEqual(['GYARADOS', 56]);
}, 300_000);

test('Lorelei and the Champion fight their rematch teams once Celio has the network machine running', async () => {
  const game = await session.start({ start: 'after-rival', map: 'IndigoPlateau_PokemonCenter_1F', x: 4, y: 5, party: [MEWTWO] });
  await rematchState(game);

  // Lorelei: PokemonLeague_LoreleisRoom_EventScript_RematchIntro, then TRAINER_ELITE_FOUR_LORELEI_2 (Dewgong Lv. 64)
  await takeWarp(game, 4, 1);
  await game.waitFor((t) => t.field()!.map === 'PokemonLeague_LoreleisRoom' && t.var('VAR_MAP_SCENE_POKEMON_LEAGUE') === 1 && t.idle() && !t.field()!.script, {
    what: "the walk into Lorelei's room",
  });
  let since = await game.mark();
  await talk(game, 6, 6, 'up');
  expect(await introUntilBattle(game, since, "Lorelei's intro")).toMatch(/LORELEI of the ELITE FOUR, have returned/);
  expect(await battlesSince(game, since)).toEqual([await game.eval((t) => t.define('TRAINER_ELITE_FOUR_LORELEI_2'))]);
  expect(await foeOf(game, "Lorelei's first mon")).toEqual(['DEWGONG', 64]);

  // The Champion: PokemonLeague_ChampionsRoom_EventScript_EnterRoom on the warp in; FLAG_SYS_GAME_CLEAR's
  // RematchIntro, then TRAINER_CHAMPION_REMATCH_<starter> (VAR_STARTER_MON). A second session: the battle above
  // never ends.
  const game2 = await session.start({ start: 'after-rival', map: 'IndigoPlateau_PokemonCenter_1F', x: 4, y: 5, party: [MEWTWO] });
  await rematchState(game2);
  const starter = await game2.eval((t) => t.var('VAR_STARTER_MON'));
  const [trainer, first] = [
    ['TRAINER_CHAMPION_REMATCH_CHARMANDER', ['HERACROSS', 72]],
    ['TRAINER_CHAMPION_REMATCH_BULBASAUR', ['HERACROSS', 72]],
    ['TRAINER_CHAMPION_REMATCH_SQUIRTLE', ['HERACROSS', 72]],
  ][starter] as [string, [string, number]];
  since = await game2.mark();
  await warp(game2, 'MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM', 6, 19);
  expect(await introUntilBattle(game2, since, "the Champion's intro")).toMatch(/You came back/);
  expect(await foeOf(game2, "the Champion's first mon")).toEqual(first);
  expect(await battlesSince(game2, since)).toEqual([await game2.eval((t, n) => t.define(n), trainer)]);
}, 300_000);

// ---------------------------------------------------------------- the Kanto NPCs after the Hall of Fame

test('Oak, his aides, the fan club and the tea lady after the Hall of Fame; the Indigo Plateau door guard', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 12, y: 7, party: [MEWTWO] });
  await afterHallOfFame(game);
  await rainbowPassState(game);
  await game.eval((t) => {
    for (let n = 1; n <= 70; n++) t.state!.setDexFlags(n, true, true);
    t.state!.setDexFlags(152, true, true);
  });

  // Oak's lab: VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB 8 → 9 on the way in (SetNationalDexSceneFinished), so Oak
  // rates the Kanto dex and then the national one (PokedexRating_EventScript_Rate with GetPokedexCount's TRUE)
  await warp(game, 'MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB', 6, 11);
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB'))).toBe(9);
  const oak = await talkTo(game, 6, 3);
  expect(oak).toMatch(/70 POKéMON seen and 70 POKéMON owned/);
  expect(oak).toMatch(/NATIONAL POKéDEX is: 71 POKéMON seen and 71 POKéMON owned/);
  expect(await talkTo(game, 3, 11)).toMatch(/radio show/); // Aide1GameClear
  expect(await talkTo(game, 11, 10)).toMatch(/DAISY/); // Aide2GameClear: DaisyWillGroomMons

  // (Daisy's FLAG_SYS_GAME_CLEAR grooming in the rival's house: sideSpecials.test.ts)

  // The fan club's worker and Celadon's tea lady (FLAG_TALKED_TO_TEA_LADY_AFTER_HOF)
  await warp(game, 'MAP_VERMILION_CITY_POKEMON_FAN_CLUB', 5, 9);
  expect(await talkTo(game, 6, 4)).toMatch(/really does adore/);
  await warp(game, 'MAP_CELADON_CITY_CONDOMINIUMS_1F', 12, 17);
  expect(await talkTo(game, 2, 9)).toMatch(/Daisy|DAISY/);
  expect(await game.eval((t) => t.flag('FLAG_TALKED_TO_TEA_LADY_AFTER_HOF'))).toBe(true);
  expect(await talkTo(game, 2, 9)).not.toMatch(/DAISY/);

  // Indigo Plateau with the National Dex but before Celio's network machine: the guard stands in the doorway
  // (IndigoPlateau_PokemonCenter_1F_EventScript_CheckBlockDoor: setobjectxyperm 4, 2) and Lorelei is away; the
  // postgame gossipers are there (FLAG_HIDE_POSTGAME_GOSSIPERS cleared by EventScript_SetDefeatedEliteFourFlagsVars)
  await warp(game, 'MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F', 11, 15);
  const guard = () => game.eval((t) => t.objects().filter((o) => o.graphicsId === 'OBJ_EVENT_GFX_COOLTRAINER_F').map((o) => [o.x, o.y]));
  expect(await guard()).toEqual([[4, 2]]);
  expect(await game.eval((t) => t.objects().some((o) => o.graphicsId === 'OBJ_EVENT_GFX_BLACK_BELT'))).toBe(true);
  expect(await talkTo(game, 4, 2)).toMatch(/LORELEI.*absent|closed/);
  // Once FLAG_SYS_CAN_LINK_WITH_RS is set (OneIsland_PokemonCenter_1F's network machine): back at her post
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_CAN_LINK_WITH_RS', true));
  await warp(game, 'MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F', 11, 15);
  expect(await guard()).toEqual([[5, 3]]);
  expect(await talkTo(game, 5, 3)).toMatch(/ELITE FOUR one by one/);
}, 300_000);
