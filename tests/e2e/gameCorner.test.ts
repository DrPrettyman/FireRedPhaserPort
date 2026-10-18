// The Game Corner (SIDE_PLAN.md W-slots unit 1): the coins box (coins.c's showcoinsbox / updatecoinsbox /
// hidecoinsbox) next to the money box at the coin clerk (CeladonCity_GameCorner_EventScript_CoinsClerk), and the
// prize room's clerks (CeladonCity_GameCorner_PrizeRoom_EventScript_PrizeClerkMons / PrizeClerkTMs).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** The field's money and coins boxes: the amounts they show, or null when they're closed. */
function boxes(game: Game) {
  return game.eval(() => {
    const s = (window as any).game.scene.getScene('Overworld');
    return { coins: s.coinsBox ? (s.coinsBox.amount as number) : null, money: s.moneyBox ? true : null };
  });
}

/** Give the player the Coin Case (FLAG_GOT_COIN_CASE is what the scripts check), money and coins. */
async function setUp(game: Game, money: number, coins: number) {
  await game.eval(
    (t, money, coins) => {
      t.state!.setFlag('FLAG_GOT_COIN_CASE', true);
      t.state!.bag.add(t.define('ITEM_COIN_CASE'), 1);
      t.state!.money = money;
      t.state!.coins = coins;
    },
    money,
    coins,
  );
}

/** Face `dir` and talk; wait in the page until the message stops at its first \p (no press may reach the menu after it). */
async function talkUntilParagraph(game: Game, dir: 'up' | 'down' | 'left' | 'right') {
  await game.eval((t, d) => t.face(d), dir);
  await game.press('A');
  await game.eval((t) => t.until(() => (window as any).game.scene.getScene('Overworld').messageBox.waitingForButton));
}

/** Pick a multichoice item: wait for the menu (opened since `since`), move down `down` times, A. */
async function choose(game: Game, since: number, down: number) {
  await game.waitForEvent('multichoice', { since });
  if (down) await game.pressTimes('DOWN', down);
  await game.press('A');
}

async function scriptDone(game: Game, what: string, answers: [RegExp, 'A' | 'B'][] = []) {
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what, answers });
}

test('the coin clerk: buy 50 and 500 coins; the coins box shows the amount and updates', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_GameCorner', x: 6, y: 4 });
  await setUp(game, 20000, 7);

  // showmoneybox 0, 0 + showcoinsbox 0, 5, then MULTICHOICE_GAME_CORNER_COIN_PURCHASE_COUNTER: 50 COINS
  let since = await game.mark();
  await talkUntilParagraph(game, 'up');
  expect(await boxes(game)).toEqual({ coins: 7, money: true });
  await game.press('A');
  await choose(game, since, 0);
  await game.waitFor((t) => /Here are your COINS/.test(t.message() ?? ''), { what: 'CeladonCity_GameCorner_Text_HereAreYourCoins' });
  expect(await boxes(game)).toEqual({ coins: 57, money: true }); // updatecoinsbox
  expect(await game.eval((t) => [t.state!.coins, t.money()])).toEqual([57, 19000]);
  await scriptDone(game, 'the clerk to finish');
  expect(await boxes(game)).toEqual({ coins: null, money: null }); // hidemoneybox + hidecoinsbox

  // 500 COINS for ¥10,000
  since = await game.mark();
  await talkUntilParagraph(game, 'up');
  await game.press('A');
  await choose(game, since, 1);
  await game.waitFor((t) => /Here are your COINS/.test(t.message() ?? ''), { what: 'the 500 coins' });
  expect(await boxes(game)).toEqual({ coins: 557, money: true });
  await scriptDone(game, 'the clerk to finish');
  expect(await game.eval((t) => [t.state!.coins, t.money()])).toEqual([557, 9000]);
});

test('the coin clerk without a Coin Case sells nothing', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_GameCorner', x: 6, y: 4 });
  await game.eval((t) => (t.state!.money = 5000));
  const since = await game.mark();
  await talkUntilParagraph(game, 'up');
  expect(await boxes(game)).toEqual({ coins: 0, money: true });
  await game.press('A');
  await choose(game, since, 0);
  await game.waitFor((t) => /have a COIN CASE\./.test(t.message() ?? ''), { what: 'CeladonCity_GameCorner_Text_SorryDontHaveCoinCase' });
  await scriptDone(game, 'the clerk to finish');
  expect(await game.eval((t) => [t.state!.coins, t.money()])).toEqual([0, 5000]);
  expect(await boxes(game)).toEqual({ coins: null, money: null });
});

test('the prize room: an Abra for 180 coins, TM13 for 4000; not enough coins buys nothing', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_GameCorner_PrizeRoom', x: 4, y: 4 });
  await setUp(game, 0, 4200);
  const partySize = (await game.eval((t) => t.party())).length;

  // PrizeClerkMons: showcoinsbox 0, 0, then MULTICHOICE_GAME_CORNER_POKEMON_PRIZES: ABRA (180 coins in FireRed)
  let since = await game.mark();
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /Which prize/.test(t.message() ?? ''), { what: 'CeladonCity_GameCorner_PrizeRoom_Text_WhichPrize' });
  expect(await boxes(game)).toEqual({ coins: 4200, money: null });
  await choose(game, since, 0);
  // "So, you want the ABRA?" YES → givemon ABRA 9 → removecoins + updatecoinsbox; no nickname
  await game.mashUntil((t) => t.state!.coins === 4020, { what: 'the Abra to be paid for' });
  expect(await boxes(game)).toEqual({ coins: 4020, money: null });
  await scriptDone(game, 'the clerk to finish', [[/nickname/, 'B']]);
  const party = await game.eval((t) => t.party());
  expect(party.length).toBe(partySize + 1);
  expect(party[party.length - 1]).toMatchObject({ species: 'ABRA', level: 9 });
  expect(await boxes(game)).toEqual({ coins: null, money: null });

  // PrizeClerkTMs at (6, 2): TM13 ICE BEAM for 4000 coins; only 4020 left
  await game.eval((t) => t.walkTo(6, 4)); // across the counter from the clerk at (6, 2)
  since = await game.mark();
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /Which prize/.test(t.message() ?? ''), { what: 'the TM clerk' });
  await choose(game, since, 0);
  await game.mashUntil((t) => t.itemCount('TM13') === 1, { what: 'TM13' });
  expect(await game.eval((t) => t.state!.coins)).toBe(20);
  await scriptDone(game, 'the clerk to finish');

  // TM13 again with 20 coins: "You need more COINS..."
  since = await game.mark();
  await game.press('A');
  await game.mashUntil((t) => /Which prize/.test(t.message() ?? ''), { what: 'the TM clerk again' });
  await choose(game, since, 0);
  await game.mashUntil((t) => /need more COINS/.test(t.message() ?? ''), { what: 'CeladonCity_GameCorner_PrizeRoom_Text_NeedMoreCoins' });
  await scriptDone(game, 'the clerk to finish');
  expect(await game.eval((t) => [t.state!.coins, t.itemCount('TM13')])).toEqual([20, 1]);
});

test('the gamblers and hidden coins: the Fisher gives 10 coins, 20 on the floor at (8, 5)', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_GameCorner', x: 3, y: 7 });
  await setUp(game, 0, 0);
  await game.eval((t) => t.face('right')); // the Fisher at (4, 7)
  await game.press('A');
  await scriptDone(game, 'CeladonCity_GameCorner_EventScript_Fisher');
  expect(await game.eval((t) => [t.state!.coins, t.flag('FLAG_GOT_10_COINS_FROM_GAMBLER')])).toEqual([10, true]);

  // EventScript_TryPickUpHiddenCoins: CheckAddCoins, addcoins VAR_0x8006
  await game.eval((t) => t.walkTo(7, 5));
  await game.eval((t) => t.face('right'));
  await game.press('A');
  await scriptDone(game, 'the hidden coins');
  expect(await game.eval((t) => [t.state!.coins, t.flag('FLAG_HIDDEN_ITEM_CELADON_CITY_GAME_CORNER_COINS_6')])).toEqual([30, true]);
});

test('a slot machine without a Coin Case asks for one; GetRandomSlotMachineId picks machines 0-5', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_GameCorner', x: 1, y: 7 });
  await game.eval((t) => t.face('left')); // SlotMachine0 at (0, 7)
  await game.press('A');
  await game.waitFor((t) => /COIN CASE is required/.test(t.message() ?? ''), { what: 'CeladonCity_GameCorner_Text_CoinCaseIsRequired' });
  await scriptDone(game, 'the slot machine sign');
  // With the Coin Case the script runs `specialvar VAR_RESULT, GetRandomSlotMachineId` before playslotmachine
  // (the screen, W-slots unit 2). The table itself is checked in tests/unit/slotMachine.test.ts; here the
  // special the game registered, with the data the field loaded.
  const ids = await game.eval(async () => {
    // (through Function, so vitest's transform leaves the page's dynamic import alone)
    const { SPECIALS } = await new Function("return import('/src/script/specials.ts')")();
    const out = new Set<number>();
    for (let i = 0; i < 400; i++) out.add(SPECIALS.GetRandomSlotMachineId({}));
    return [...out].sort();
  });
  expect(ids).toEqual([0, 1, 2, 3, 4, 5]);
});
