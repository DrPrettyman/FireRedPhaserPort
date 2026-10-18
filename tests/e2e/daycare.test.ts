// The Route 5 daycare (Route5_PokemonDayCare_EventScript_DaycareMan, data/scripts/day_care.inc): leaving a mon
// (ChooseSendDaycareMon's party menu, PutMonInRoute5Daycare), its steps (ShouldEggHatch in the field's step
// counter), taking it back (GetNumLevelsGainedForRoute5DaycareMon, GetCostToWithdrawRoute5DaycareMon,
// IsEnoughForCostInVar0x8005, TakePokemonFromRoute5Daycare, SubtractMoneyFromVar0x8005), and the save.
// Rattata is GROWTH_MEDIUM_FAST (exp = level³) and learns Quick Attack at 7 and Hyper Fang at 13.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** The daycare man stands at (4, 4) facing down; the player starts below him. */
const DAYCARE = { start: 'after-rival', map: 'Route5_PokemonDayCare', x: 4, y: 5 } as const;
const RATTATA = { species: 'RATTATA', level: 5, moves: ['TACKLE', 'TAIL_WHIP'] };
const PIDGEY = { species: 'PIDGEY', level: 10, moves: ['TACKLE'] };

/** Face the daycare man and talk to him; resolves once his first message is up. */
async function talk(game: Game): Promise<void> {
  await game.waitIdle();
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.waitFor((t) => /\S/.test(t.message() ?? ''), { what: 'the daycare man talking' });
}

/** The Route 5 daycare mon: species, steps (null when empty). */
const daycareMon = (game: Game) =>
  game.eval((t) => {
    const { mon, steps } = t.state!.route5DayCareMon;
    return mon && { species: mon.species, steps, exp: mon.exp };
  });

/** YES to "raise one of your POKéMON?", then STORE on party slot `slot` in the daycare's party menu. */
async function leaveMon(game: Game, slot = 0): Promise<void> {
  await talk(game);
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the daycare party menu' });
  await game.waitForPartyMenu();
  await game.pressTimes('DOWN', slot);
  // A on the mon: STORE / SUMMARY / CANCEL; A on STORE closes the menu (VAR_0x8004 = the slot).
  await game.mashUntil((t) => t.gbaScreen() === undefined, { what: 'back to the field' });
  // "Fine, I'll look after your RATTATA for a while." "Come see me in a while."
  await game.mashUntil((t) => t.idle(), { what: 'the script to end' });
}

/** Walk down and back up `n` times (2n steps), all in one eval. */
const pace = (game: Game, n: number) =>
  game.eval(async (t, k) => {
    for (let i = 0; i < k; i++) {
      await t.walk('down', 1);
      await t.walk('up', 1);
    }
    return { x: t.field()!.x, y: t.field()!.y };
  }, n);

test('leave a mon, walk, come back and take it back: a level gained, ¥200 paid', async () => {
  const game = await session.start({ ...DAYCARE, party: [RATTATA, PIDGEY] });
  await leaveMon(game);
  expect((await game.eval((t) => t.party())).map((m) => m.species)).toEqual(['PIDGEY']);
  expect(await daycareMon(game)).toMatchObject({ species: await game.eval((t) => t.define('SPECIES_RATTATA')), steps: 0, exp: 125 });

  // 46 steps there and back: one experience point each.
  expect(await pace(game, 23)).toEqual({ x: 4, y: 5 });
  expect((await daycareMon(game))!.steps).toBe(46);
  // Not enough for level 6 (216 exp): "You're back already?" and the minimum ¥100; NO.
  await talk(game);
  await game.mashUntil((t) => /owe me/.test(t.message() ?? ''), { what: 'the cost' });
  expect(await game.message()).toMatch(/¥100 for the return/);
  await game.mashUntil((t) => t.idle(), { what: 'the field', answers: [[/owe me/, 'B']] });
  expect(await daycareMon(game)).not.toBeNull();

  // 46 more: 125 + 92 = 217 > 216, so TryIncrementMonLevel takes it to 6.
  await pace(game, 23);
  expect((await daycareMon(game))!.steps).toBe(92);
  const money = await game.eval((t) => t.money());
  await talk(game);
  // "...grown a lot... By level, it's grown by 1." "You owe me ¥200..." YES, "PLAYER got RATTATA back..."
  await game.mashUntil((t) => /got RATTATA back/.test(t.message() ?? ''), { what: 'the mon back' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  const party = await game.eval((t) => t.party());
  expect(party.map((m) => m.species)).toEqual(['PIDGEY', 'RATTATA']);
  expect(party[1].level).toBe(6);
  expect(await game.eval((t) => t.money())).toBe(money - 200);
  expect(await daycareMon(game)).toBeNull();
});

test('levels and moves learned in the daycare; not enough money first', async () => {
  const game = await session.start({ ...DAYCARE, party: [RATTATA, PIDGEY] });
  await leaveMon(game);
  // As if 2073 steps had been walked: 125 + 2073 = 2198 > 13³, eight levels.
  await game.eval((t) => {
    t.state!.route5DayCareMon.steps = 2073;
    t.state!.money = 899;
  });
  await talk(game);
  await game.mashUntil((t) => /grown by/.test(t.message() ?? ''), { what: 'the levels gained' });
  expect(await game.message()).toMatch(/grown by 8\./);
  await game.mashUntil((t) => /owe me/.test(t.message() ?? ''), { what: 'the cost' });
  expect(await game.message()).toMatch(/¥900 for the return/);
  // YES: "You don't have enough money."
  await game.mashUntil((t) => /enough money/.test(t.message() ?? ''), { what: 'not enough money' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  expect(await game.eval((t) => t.party().length)).toBe(1);
  expect(await game.eval((t) => t.money())).toBe(899);

  await game.eval((t) => (t.state!.money = 1000));
  await talk(game);
  await game.mashUntil((t) => /got RATTATA back/.test(t.message() ?? ''), { what: 'the mon back' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  const [, rattata] = await game.eval((t) => t.party());
  expect(rattata.level).toBe(13);
  expect(rattata.moves).toEqual(['TACKLE', 'TAIL_WHIP', 'QUICK_ATTACK', 'HYPER_FANG']);
  expect(await game.eval((t) => t.money())).toBe(100);
});

test('a single-mon party is refused; B in the party menu changes nothing', async () => {
  const game = await session.start({ ...DAYCARE, party: [RATTATA] });
  await talk(game);
  await game.mashUntil((t) => /only have one/.test(t.message() ?? ''), { what: 'the refusal' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  expect(await game.eval((t) => t.party().length)).toBe(1);
  expect(await daycareMon(game)).toBeNull();

  await game.eval((t, p) => t.setParty(p), [RATTATA, PIDGEY]);
  await talk(game);
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the daycare party menu' });
  await game.waitForPartyMenu();
  await game.press('B');
  await game.mashUntil((t) => /anytime/.test(t.message() ?? ''), { what: '"Come anytime you like."', button: 'B' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  expect(await game.eval((t) => t.party().length)).toBe(2);
  expect(await daycareMon(game)).toBeNull();
});

/** START → SAVE → YES; resolves once saved. */
async function save(game: Game): Promise<void> {
  await game.waitIdle();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  const downs = (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length;
  await game.pressTimes('DOWN', downs);
  await game.press('A');
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press('UP');
  await game.press('A');
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
}

test('save and continue keeps the daycare mon and its steps', async () => {
  const game = await session.start({ ...DAYCARE, party: [RATTATA, PIDGEY] });
  await leaveMon(game);
  await pace(game, 5);
  const before = await daycareMon(game);
  expect(before!.steps).toBe(10);
  await save(game);

  await game.load({ keepSave: true, mainMenu: true });
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading, { what: 'the main menu' });
  await game.press('A'); // CONTINUE
  await game.waitForEvent('ready', { timeout: 60_000 });
  await game.waitIdle();
  expect(await daycareMon(game)).toEqual(before);
  await pace(game, 1);
  expect((await daycareMon(game))!.steps).toBe(12);
  await talk(game);
  await game.mashUntil((t) => /got RATTATA back/.test(t.message() ?? ''), { what: 'the mon back' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  expect((await game.eval((t) => t.party())).map((m) => m.species)).toEqual(['PIDGEY', 'RATTATA']);
});

// ------------------------------------------------------------------ the Four Island daycare and eggs
// FourIsland_PokemonDayCare_EventScript_DaycareWoman (two mons, the level menu), FourIsland_EventScript_DaycareMan
// (the egg, refusing it, the compatibility message), and the Water Labyrinth's `giveegg`. Two Rattata of the
// same OT are PARENTS_MED_COMPATIBILITY (50): "The two seem to get along."

/** The daycare lady stands at (2, 2) facing down; the player starts below her. */
const FOUR_ISLAND_DAYCARE = { start: 'after-rival', map: 'FourIsland_PokemonDayCare', x: 2, y: 3 } as const;
const MALE_RATTATA = { species: 'RATTATA', level: 5, moves: ['TACKLE', 'TAIL_WHIP'] };
const FEMALE_RATTATA = { species: 'RATTATA', level: 10, moves: ['TACKLE', 'QUICK_ATTACK'] };

/** Party: male Rattata, female Rattata (personality low byte 0xFF / 0x00; Rattata is half and half), Pidgey. */
async function startAtFourIsland(game: Game): Promise<void> {
  await game.eval((t) => {
    t.state!.party[0].personality = 0x12345fff;
    t.state!.party[1].personality = 0x12345f00;
  });
}

/** The Four Island daycare: species and steps per slot (null when empty), and the pending egg. */
const fourIsland = (game: Game) =>
  game.eval((t) => {
    const d = t.state!.daycare;
    return { mons: d.mons.map((m) => m.mon && { species: m.mon.species, steps: m.steps }), offspringPersonality: d.offspringPersonality };
  });

/** In the daycare party menu: STORE on slot `slot`, then the field again. */
async function storeFromPartyMenu(game: Game, slot: number): Promise<void> {
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the daycare party menu' });
  await game.waitForPartyMenu();
  await game.pressTimes('DOWN', slot);
  await game.mashUntil((t) => t.gbaScreen() === undefined, { what: 'back to the field' });
}

/** Leave the first two party mons with the daycare lady (YES, slot 0; YES to one more, slot 0 again). */
async function leaveTwo(game: Game): Promise<void> {
  await talk(game);
  await storeFromPartyMenu(game, 0);
  await game.mashUntil((t) => /raise one\s+more/.test(t.message() ?? ''), { what: 'one more?' });
  await storeFromPartyMenu(game, 0);
  await game.mashUntil((t) => t.idle(), { what: 'the script to end' });
}

/**
 * Walk until the daycare has an egg: each try sets the second mon's steps to 254, so the next step is 255 and
 * rolls (an egg when 50 > Random() * 100 / 0xFFFF, about half the time). Steps up and down from (x, y).
 */
const walkForEgg = (game: Game) =>
  game.eval(async (t) => {
    for (let i = 0; i < 40; i++) {
      t.state!.daycare.mons[1].steps = 254;
      await t.walk(i % 2 ? 'up' : 'down', 1);
      if (t.state!.daycare.offspringPersonality !== 0) return i;
    }
    return -1;
  });

/** Out of the daycare (the mat at (4, 7)) onto Four Island, past its rival scene. */
async function leaveDaycare(game: Game): Promise<void> {
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_FOUR_ISLAND', 1));
  await game.eval((t) => t.walkTo(4, 7));
  expect(await game.eval((t) => t.enterWarp())).toBe('FourIsland');
}

test('Four Island: leave two, the compatibility, an egg, take it, refuse the next', async () => {
  const game = await session.start({ ...FOUR_ISLAND_DAYCARE, party: [MALE_RATTATA, FEMALE_RATTATA, PIDGEY] });
  await startAtFourIsland(game);
  await leaveTwo(game);
  const RATTATA = await game.eval((t) => t.define('SPECIES_RATTATA'));
  expect(await fourIsland(game)).toEqual({ mons: [{ species: RATTATA, steps: 0 }, { species: RATTATA, steps: 0 }], offspringPersonality: 0 });
  expect((await game.eval((t) => t.party())).map((m) => m.species)).toEqual(['PIDGEY']);

  // Outside, the old man: "Your RATTATA and RATTATA are doing fine." then the compatibility.
  await leaveDaycare(game);
  await game.eval((t) => t.walkTo(16, 14));
  await talk(game);
  await game.mashUntil((t) => /doing fine/.test(t.message() ?? ''), { what: 'doing fine' });
  expect(await game.message()).toMatch(/RATTATA and\s+RATTATA are doing fine/);
  await game.mashUntil((t) => /get along/.test(t.message() ?? ''), { what: 'the compatibility' });
  expect(await game.message()).toMatch(/^The two seem to get along\.$/);
  await game.mashUntil((t) => t.idle(), { what: 'the field' });

  // Walk until an egg comes; the old man has it.
  expect(await walkForEgg(game)).toBeGreaterThanOrEqual(0);
  expect(await game.eval((t) => t.flag('FLAG_PENDING_DAYCARE_EGG'))).toBe(true);
  await game.eval((t) => t.walkTo(16, 14));
  await talk(game);
  await game.mashUntil((t) => /received the EGG/.test(t.message() ?? ''), { what: 'the egg' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  const party = await game.eval((t) => t.state!.party.map((m) => ({ species: m.species, isEgg: m.isEgg, metLevel: m.metLevel })));
  expect(party).toHaveLength(2);
  expect(party[1]).toEqual({ species: RATTATA, isEgg: true, metLevel: 0 });
  expect(await game.eval((t) => t.flag('FLAG_PENDING_DAYCARE_EGG'))).toBe(false);
  expect((await fourIsland(game)).offspringPersonality).toBe(0);

  // The next egg: NO, and NO again: "Well then, I'll keep it."
  expect(await walkForEgg(game)).toBeGreaterThanOrEqual(0);
  await game.eval((t) => t.walkTo(16, 14));
  await talk(game);
  await game.mashUntil((t) => /Thanks!/.test(t.message() ?? ''), { what: 'refused', answers: [[/want it, yes|want this, yes/, 'B']] });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  expect(await game.eval((t) => t.state!.party.length)).toBe(2);
  expect(await game.eval((t) => t.flag('FLAG_PENDING_DAYCARE_EGG'))).toBe(false);
  expect(await fourIsland(game)).toMatchObject({ offspringPersonality: 0 });
});

test('Four Island: take one back through the level menu, then the other', async () => {
  const game = await session.start({ ...FOUR_ISLAND_DAYCARE, party: [MALE_RATTATA, FEMALE_RATTATA, PIDGEY] });
  await startAtFourIsland(game);
  await leaveTwo(game);
  // The female (level 10, 1000 exp) was left second: 331 steps take her to 1331 = level 11.
  await game.eval((t) => {
    t.state!.daycare.mons[1].steps = 331;
    t.state!.money = 1000;
  });
  await talk(game);
  await game.mashUntil((t) => /grown by/.test(t.message() ?? ''), { what: 'the levels gained' });
  expect(await game.message()).toMatch(/grown by 1\./);
  // "Will you take your POKéMON back?" YES: the level menu.
  const menu = await game.mashUntil((t) => t.daycareLevelMenu(), { what: 'the level menu' });
  expect(menu).toEqual({ selected: 0 });
  await game.press('DOWN');
  await game.waitFor((t) => t.daycareLevelMenu()?.selected === 1, { what: 'the second mon' });
  await game.mashUntil((t) => /it will cost/.test(t.message() ?? ''), { what: 'the cost' });
  expect(await game.message()).toMatch(/RATTATA back,\s+it will cost ¥200\./);
  await game.mashUntil((t) => /took back RATTATA/.test(t.message() ?? ''), { what: 'took back' });
  // "Will you take back the other one, too?" NO.
  await game.mashUntil((t) => t.idle(), { what: 'the field', answers: [[/other one/, 'B']] });
  const party = await game.eval((t) => t.party());
  expect(party.map((m) => [m.species, m.level])).toEqual([['PIDGEY', 10], ['RATTATA', 11]]);
  expect(await game.eval((t) => t.money())).toBe(800);
  const RATTATA = await game.eval((t) => t.define('SPECIES_RATTATA'));
  expect((await fourIsland(game)).mons).toEqual([{ species: RATTATA, steps: 0 }, null]);

  // One left: "raise one more?" NO, "take your POKéMON back?" YES: no menu, straight to the cost (¥100).
  await talk(game);
  await game.mashUntil((t) => /took back RATTATA/.test(t.message() ?? ''), { what: 'took back', answers: [[/one\s+more/, 'B']] });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  expect((await game.eval((t) => t.party())).map((m) => [m.species, m.level])).toEqual([['PIDGEY', 10], ['RATTATA', 11], ['RATTATA', 5]]);
  expect(await game.eval((t) => t.money())).toBe(700);
  expect((await fourIsland(game)).mons).toEqual([null, null]);
});

test('Four Island: B in the level menu takes nothing back', async () => {
  const game = await session.start({ ...FOUR_ISLAND_DAYCARE, party: [MALE_RATTATA, FEMALE_RATTATA, PIDGEY] });
  await startAtFourIsland(game);
  await leaveTwo(game);
  await talk(game);
  await game.mashUntil((t) => t.daycareLevelMenu(), { what: 'the level menu' });
  await game.press('B');
  await game.mashUntil((t) => /Come again/.test(t.message() ?? ''), { what: 'come again', button: 'B' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  expect(await game.eval((t) => t.daycareLevelMenu())).toBeUndefined();
  expect(await game.eval((t) => t.party().length)).toBe(1);
});

test('the Water Labyrinth gentleman gives a Togepi egg to a trainer whose lead mon loves them', async () => {
  const game = await session.start({ start: 'after-rival', map: 'FiveIsland_WaterLabyrinth', x: 14, y: 12, party: [PIDGEY] });
  await game.eval((t) => (t.state!.party[0].friendship = 255));
  await talk(game);
  await game.mashUntil((t) => /received an EGG/.test(t.message() ?? ''), { what: 'the egg' });
  await game.mashUntil((t) => /glad I met/.test(t.message() ?? ''), { what: 'the comment' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  const egg = await game.eval((t) => {
    const m = t.state!.party[1];
    return { species: m.species, isEgg: m.isEgg, metLocation: m.metLocation, metLevel: m.metLevel, friendship: m.friendship };
  });
  const TOGEPI = await game.eval((t) => t.define('SPECIES_TOGEPI'));
  expect(egg).toEqual({ species: TOGEPI, isEgg: true, metLocation: 'METLOC_SPECIAL_EGG', metLevel: 0, friendship: 10 });
  expect(await game.eval((t) => t.flag('FLAG_GOT_TOGEPI_EGG'))).toBe(true);
});
