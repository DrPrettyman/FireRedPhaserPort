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
