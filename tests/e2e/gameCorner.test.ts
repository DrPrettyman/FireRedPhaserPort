// The Game Corner (SIDE_PLAN.md W-slots unit 1): the coins box (coins.c's showcoinsbox / updatecoinsbox /
// hidecoinsbox) next to the money box at the coin clerk (CeladonCity_GameCorner_EventScript_CoinsClerk), and the
// prize room's clerks (CeladonCity_GameCorner_PrizeRoom_EventScript_PrizeClerkMons / PrizeClerkTMs).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

// ------------------------------------------------------------------ the slot machine screen (W-slots unit 2)

/** slot_machine.c's sReelIconAnimByReelAndPos, read from the extracted data. */
const reelIcons: number[][] = JSON.parse(readFileSync(join(__dirname, '../../public/gen/slotMachine.json'), 'utf8')).reelIcons;

/**
 * What a stop pays, worked out from the C (CalcPayout) independently of the port's: the icons each reel shows are the
 * three after its position; the lines the bet covers (1: middle; 2: + top, bottom; 3: + both diagonals) pay
 * cherries in the first column 2 coins (6 with cherries in the second), or three of a kind 8 (Magnemite, Shellder),
 * 15 (Pikachu, Psyduck), 100 (Rocket), 300 (7).
 */
function expectedPayout(reelPositions: number[], bet: number): number {
  const icon = (reel: number, row: number) => reelIcons[reel][(reelPositions[reel] + 1 + row) % 21];
  // [row on reel 0, row on reel 1, row on reel 2, min bet]
  const lines = [
    [0, 0, 0, 2], // top row
    [1, 1, 1, 1], // middle row
    [2, 2, 2, 2], // bottom row
    [0, 1, 2, 3], // top left to bottom right
    [2, 1, 0, 3], // bottom left to top right
  ];
  const [ICON_7, ICON_ROCKET, ICON_PIKACHU, ICON_PSYDUCK, ICON_CHERRIES, ICON_MAGNEMITE, ICON_SHELLDER] = [0, 1, 2, 3, 4, 5, 6];
  let total = 0;
  for (const [r0, r1, r2, minBet] of lines) {
    if (bet < minBet) continue;
    const [a, b, c] = [icon(0, r0), icon(1, r1), icon(2, r2)];
    if (a === ICON_CHERRIES) total += b === ICON_CHERRIES ? 6 : 2;
    else if (a === b && b === c) {
      if (a === ICON_MAGNEMITE || a === ICON_SHELLDER) total += 8;
      else if (a === ICON_PIKACHU || a === ICON_PSYDUCK) total += 15;
      else if (a === ICON_ROCKET) total += 100;
      else if (a === ICON_7) total += 300;
    }
  }
  return total;
}

/** Sit at SlotMachine0 (the machine left of (1, 7)) and answer YES; resolves once the screen takes input. */
async function sitAtSlotMachine(game: Game) {
  await game.eval((t) => t.face('left'));
  // dofieldeffect FLDEFF_SMILEY_FACE_ICON (FldEff_SmileyFaceIcon) over the player before the screen
  const smiley = game.watch((t) => t.field()?.fieldEffects.includes('FLDEFF_SMILEY_FACE_ICON'), { what: 'the smiley over the player' });
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_InitSlotMachine' || t.gbaScreen() === 'CB2_RunSlotMachine', { what: 'playslotmachine' });
  await game.waitFor((t) => t.slotMachine()?.ready, { what: 'the slot machine to fade in' });
  await smiley;
}

/** Wait until the game loop is back at its betting step. */
async function waitBetting(game: Game) {
  await game.waitFor(
    (t) => {
      const p = t.slotMachine();
      return p?.mainTask === 'MainTask_SlotsGameLoop' && p.step === 0;
    },
    { what: 'the betting step' },
  );
}

/** Bet the most (R), start the reels and stop them one by one; returns what the stop showed and the coins after the payout. */
async function spin(game: Game, payWithStart: boolean) {
  await waitBetting(game);
  const before = await game.eval((t) => t.state!.coins);
  await game.press('R');
  const bet = await game.eval((t) => t.slotMachine()!.bet);
  for (let reel = 0; reel < 3; reel++) {
    // MainTask_SlotsGameLoop's step 3: A stops the next reel (StopCurrentReel + PressReelButton)
    await game.eval((t, r) => t.until(() => t.slotMachine()?.step === 3 && t.slotMachine()?.currentReel === r && t.slotMachine()?.reelIsSpinning[r]), reel);
    await game.press('A');
  }
  const result = await game.eval((t) =>
    t.until(() => /Darn|Win/.test(t.slotMachine()?.mainTask ?? '')).then(() => {
      const p = t.slotMachine()!;
      return { mainTask: p.mainTask, reelPositions: p.reelPositions, winFlags: p.winFlags, payout: p.payout, buttonsPressed: p.buttonsPressed, linePalettes: p.linePalettes };
    }),
  );
  if (result.payout && !payWithStart) await game.screenshot('slots-win');
  if (payWithStart && result.payout) {
    // MainTask_WinHandlePayout's step 2 (a coin every 8 ticks): START pays the rest at once
    await game.eval(async (t) => {
      await t.until(() => t.slotMachine()?.mainTask !== 'MainTask_WinHandlePayout' || t.slotMachine()?.step === 2);
      await t.press('START');
    });
  }
  await waitBetting(game);
  const after = await game.eval((t) => ({ coins: t.state!.coins, p: t.slotMachine()! }));
  return { before, bet, ...result, after: after.coins, probe: after.p };
}

test('the slot machine: bet, spin, stop the reels, the payout; the help window; quit with YES', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_GameCorner', x: 1, y: 7, seed: 7 });
  await setUp(game, 0, 100);
  await sitAtSlotMachine(game);
  let p = (await game.eval((t) => t.slotMachine()))!;
  expect(p).toMatchObject({ bet: 0, credit: 100, payoutShown: 0, clefairyAnim: 0, linePalettes: [4, 4, 4, 4, 4] });
  expect(p.machineIdx).toBeGreaterThanOrEqual(0);
  await game.screenshot('slots-start');

  // A loss and a win, each checked against the coins: spins until both have happened
  let sawWin = false;
  let sawLoss = false;
  for (let i = 0; i < 12 && !(sawWin && sawLoss); i++) {
    const r = await spin(game, sawWin);
    expect(r.bet).toBe(3);
    const payout = expectedPayout(r.reelPositions, 3);
    expect(r.after - r.before, `spin ${i}: reels ${r.reelPositions}`).toBe(payout - 3);
    expect(r.mainTask).toBe(payout ? 'MainTask_WinHandlePayout' : 'MainTask_DarnNoPayout');
    expect(r.payout).toBe(payout);
    expect(r.buttonsPressed).toEqual([true, true, true]);
    expect(r.probe).toMatchObject({ bet: 0, credit: r.after, payoutShown: 0, clefairyAnim: 0, buttonsPressed: [false, false, false], linePalettes: [4, 4, 4, 4, 4] });
    if (payout) sawWin = true;
    else sawLoss = true;
  }
  expect([sawWin, sawLoss]).toEqual([true, true]);

  // DOWN bets one coin at a time and lights the middle line, then the top and bottom
  await waitBetting(game);
  const coins = await game.eval((t) => t.state!.coins);
  await game.press('DOWN');
  await waitBetting(game);
  await game.press('DOWN');
  await waitBetting(game);
  p = (await game.eval((t) => t.slotMachine()))!;
  expect(p).toMatchObject({ bet: 2, credit: coins - 2, linePalettes: [4, 5, 5, 5, 4] });

  // RIGHT slides the combos window in, LEFT out
  await game.press('RIGHT');
  await game.waitFor((t) => t.slotMachine()?.mainTask === 'MainTask_ShowHelp' && t.slotMachine()?.step === 2, { what: 'the help window' });
  expect((await game.eval((t) => t.slotMachine()))!.helpShown).toBe(256);
  await game.screenshot('slots-help');
  await game.press('LEFT');
  await waitBetting(game);
  expect((await game.eval((t) => t.slotMachine()))!.helpShown).toBe(0);

  // B: "Quit playing?" B answers NO; B again and YES gives the bet back and leaves
  await game.press('B');
  await game.waitFor((t) => t.slotMachine()?.mainTask === 'MainTask_ConfirmExitGame' && t.slotMachine()?.step === 2, { what: 'Quit playing?' });
  expect((await game.eval((t) => t.slotMachine()))!.yesNo).toBe(true);
  await game.screenshot('slots-quit');
  await game.press('B');
  await waitBetting(game);
  expect((await game.eval((t) => t.slotMachine()))!).toMatchObject({ yesNo: false, bet: 2 });
  await game.press('B');
  await game.waitFor((t) => t.slotMachine()?.mainTask === 'MainTask_ConfirmExitGame' && t.slotMachine()?.step === 2, { what: 'Quit playing? again' });
  await game.press('A');
  await game.waitFor((t) => t.idle() && !t.field()!.script && t.gbaScreen() === undefined, { what: 'the field after the slot machine', timeout: 30000 });
  expect(await game.eval((t) => [t.state!.coins, t.field()!.map, t.slotMachine()])).toEqual([coins, 'CeladonCity_GameCorner', null]);
});

test('the slot machine without coins: "Game over!" and back to the field', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_GameCorner', x: 1, y: 7 });
  await setUp(game, 0, 0);
  await game.eval((t) => t.face('left'));
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_InitSlotMachine' || t.gbaScreen() === 'CB2_RunSlotMachine', { what: 'playslotmachine' });
  // MainTask_NoCoinsGameOver: the message, then any key leaves
  await game.waitFor((t) => t.slotMachine()?.mainTask === 'MainTask_NoCoinsGameOver' && t.slotMachine()?.step === 2 && t.slotMachine()?.ready, { what: 'Game over!' });
  await game.screenshot('slots-no-coins');
  await game.press('A');
  await game.waitFor((t) => t.idle() && !t.field()!.script && t.gbaScreen() === undefined, { what: 'the field after the slot machine', timeout: 30000 });
  expect(await game.eval((t) => [t.state!.coins, t.field()!.map])).toEqual([0, 'CeladonCity_GameCorner']);
});

test("the photo printer: ¥50, a pink print, the flash; the party goes on the trainer card's photo", async () => {
  const game = await session.start({
    start: 'after-rival',
    map: 'CeladonCity_GameCorner',
    x: 16,
    y: 13,
    party: [
      { species: 'PIKACHU', level: 20 },
      { species: 'UNOWN', level: 20 },
    ],
  });
  await game.eval((t) => (t.state!.money = 1000));
  const unownLetter = await game.eval((t) => {
    const p = t.state!.party[1].personality;
    return (((p & 0x03000000) >>> 18) | ((p & 0x030000) >>> 12) | ((p & 0x0300) >>> 6) | (p & 0x03)) % 28; // GetUnownLetterByPersonality
  });
  // CeladonCity_GameCorner_EventScript_PhotoPrinter (the printer east of (16, 13)): YES, then MULTICHOICE_TRAINER_CARD_ICON_TINT
  const since = await game.mark();
  await game.eval((t) => t.face('right'));
  await game.mashUntil((t) => t.events().some((e) => e.type === 'multichoice') && t.money() === 950, { what: 'the print type menu' });
  await game.waitForEvent('multichoice', { since });
  await game.pressTimes('DOWN', 2); // PINK
  await game.press('A');
  // "A big smile for the photo, please! Three… Two… One…\p Flash!", then dofieldeffect FLDEFF_PHOTO_FLASH
  await game.eval((t) => t.until(() => (window as any).game.scene.getScene('Overworld').messageBox.waitingForButton));
  const flash = game.watch((t) => t.field()?.fading && t.field()?.fadeWhite, { what: 'FLDEFF_PHOTO_FLASH' });
  await game.press('A');
  await flash;
  await scriptDone(game, 'the photo printer');
  expect(await game.eval((t) => [1, 2, 3, 4, 5, 6].map((i) => t.var(`VAR_TRAINER_CARD_MON_ICON_${i}`)).concat(t.var('VAR_TRAINER_CARD_MON_ICON_TINT_IDX'), t.money()))).toEqual([
    25, // SPECIES_PIKACHU
    30000 + unownLetter, // SpeciesToMailSpecies: UNOWN_OFFSET + the letter
    0,
    0,
    0,
    0,
    2, // MON_ICON_TINT_PINK
    950,
  ]);
});
