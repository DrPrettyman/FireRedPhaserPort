// Mail (W-mail unit 1): a Retro Mail bought at the Celadon Dept. Store 4F, given from the bag with its words written on
// the Easy Chat screen (EASY_CHAT_TYPE_MAIL), read from the party menu (MAIL → READ: menus/mail.ts), taken back into
// the bag (MAIL → TAKE → NO → YES: the message is lost) or sent to the PC's mail slots (YES); the party menu's
// ITEM → GIVE with a mail, cancelled on the Easy Chat screen; the bag's CHECK on a mail; a held mail through a save
// and CONTINUE.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';
import { CMD, STATE, step, typeByGroup, typeByKeyboard, wordIds } from './easyChatHelpers';

const session = useGame();

/** A party of one, an empty ITEMS pocket (so the mail is its first item). */
const PARTY = [{ species: 'PIKACHU', level: 10, moves: ['THUNDER_SHOCK'] }];

async function emptyItemsPocket(game: Game): Promise<void> {
  await game.eval((t) => t.state!.bag.pockets[0].forEach((s) => ((s.itemId = 0), (s.quantity = 0))));
}

/** Wait (in the page) until a GBA task named `name` is running. */
async function waitForTask(game: Game, name: string, what = name): Promise<void> {
  expect(await game.eval((t, n) => t.until(() => t.gbaTasks().includes(n) && !t.paletteFadeActive(), 20000), name), what).toBe(true);
}

/** START, then the start menu's entry `item`. */
async function startMenu(game: Game, item: string): Promise<void> {
  await game.waitIdle();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  const to = menu.items.indexOf(item as (typeof menu.items)[number]);
  for (let i = menu.cursor; i !== to; i += Math.sign(to - i)) await game.press(to > i ? 'DOWN' : 'UP');
  await game.press('A');
}

/** The party menu from the start menu, then the first mon's action menu (taking input). */
async function openFirstMonActions(game: Game): Promise<void> {
  await startMenu(game, 'POKEMON');
  await game.waitForPartyMenu();
  await game.press('A');
  await waitForTask(game, 'Task_HandleSelectionMenuInput', 'the action menu');
}

/** In the party menu's action menu: down `downs` rows, A, and wait for the next menu's task `task`. */
async function pick(game: Game, downs: number, task: string): Promise<void> {
  await game.pressTimes('DOWN', downs);
  await game.press('A');
  await waitForTask(game, task);
}

/** The Easy Chat screen up and reading input. */
async function waitForEasyChat(game: Game): Promise<void> {
  await game.waitForScreen('CB2_EasyChatScreen');
  expect(await game.eval((t) => t.until(() => !!t.easyChat()?.idle, 600))).toBe(true);
}

/** The mail screen up and waiting for A / B. */
async function waitForMail(game: Game) {
  const ok = await game.eval((t) => t.until(() => !!t.mail()?.waitingForButton, 20000));
  expect(ok, 'the mail screen').toBe(true);
  return (await game.eval((t) => t.mail()))!;
}

test('a Retro Mail bought, given from the bag with words written, read from the party menu, taken back', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_DepartmentStore_4F', x: 3, y: 11, party: PARTY });
  await emptyItemsPocket(game);

  // The clerk across the counter: BUY → the list's second item, RETRO MAIL → ×1 → YES.
  await game.eval((t) => t.face('down'));
  await game.press('A');
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_BuyMenu', { what: 'the buy menu' });
  await game.eval((t) => t.waitFrames(30));
  await game.press('DOWN');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A');
  await game.eval((t) => t.waitFrames(90));
  await game.press('A');
  await game.mashUntil((t) => t.itemCount('RETRO_MAIL') > 0, { what: 'the purchase', maxFrames: 600 });
  expect(await game.eval((t) => t.itemCount('RETRO_MAIL'))).toBe(1);
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the shop to close' });

  // The bag: RETRO MAIL → CHECK / GIVE / TOSS / CANCEL → GIVE → the party menu → PIKACHU → the Easy Chat screen.
  await startMenu(game, 'BAG');
  await game.waitForBag();
  await game.press('A');
  await waitForTask(game, 'Task_FieldItemContextMenuHandleInput', 'the context menu');
  await game.press('DOWN');
  await game.press('A');
  await game.waitForPartyMenu();
  await game.press('A');
  await waitForEasyChat(game);
  const mailType = await game.eval((t) => t.easyChat()!.screen!.type);
  expect(mailType).toBe(await game.eval((t) => t.define('EASY_CHAT_TYPE_MAIL')));
  // GiveMailToMon has already run: the mon holds the mail in slot 0, the bag's is gone.
  expect(await game.eval((t) => [t.state!.party[0].mail, t.itemCount('RETRO_MAIL')])).toEqual([0, 0]);
  await game.screenshot('mail-easychat');

  // HI (GREETINGS) in the first field, AWESOME (the A-Z keyboard) in the second; START → YES.
  await typeByGroup(game, 'EC_WORD_HI');
  await step(game, 'RIGHT', CMD.UPDATE_MAIN_CURSOR, STATE.SELECT_FIELD);
  await typeByKeyboard(game, 'EC_WORD_AWESOME', 'A');
  await step(game, 'START', CMD.PROMPT_CONFIRM, STATE.CONFIRM_YES_NO);
  await game.press('A');
  // "PIKACHU was given the RETRO MAIL to hold." and back to the bag.
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_BagMenuRun', { what: 'back to the bag', maxFrames: 3000 });
  const [HI, AWESOME] = await wordIds(game, ['EC_WORD_HI', 'EC_WORD_AWESOME']);
  const held = await game.eval((t) => ({ item: t.state!.party[0].heldItem, mail: t.state!.party[0].mail, slot: t.state!.mail[0] }));
  expect(held.item).toBe(await game.eval((t) => t.define('ITEM_RETRO_MAIL')));
  expect(held.mail).toBe(0);
  expect(held.slot.words).toEqual([HI, AWESOME, ...new Array(7).fill(0xffff)]);
  expect(held.slot.itemId).toBe(held.item);
  expect(held.slot.species).toBe(await game.eval((t) => t.define('SPECIES_PIKACHU')));
  await game.mashUntil((t) => !t.gbaScreen() && t.idle(), { button: 'B', what: 'the field' });

  // START → POKéMON → PIKACHU: SUMMARY / MAIL / CANCEL → MAIL: READ / TAKE / CANCEL → READ.
  await openFirstMonActions(game);
  await pick(game, 1, 'Task_HandleSelectionMenuInput');
  await game.press('A');
  const mail = await waitForMail(game);
  expect(mail).toMatchObject({ mailType: 11, messageExists: true, monIconType: 0, nameX: 16 });
  // The other four rows are blank (no words); the name is padded with spaces to 6 chars (the decoder drops them).
  expect(mail.lines.map((l) => l.trim())).toEqual(['HI AWESOME', '', '', '', '']);
  expect(mail.authorName.trimEnd()).toBe(await game.eval((t) => t.state!.playerName));
  expect(await game.eval((t) => t.helpSystem().context)).toBe(await game.eval((t) => t.define('HELPCONTEXT_BEDROOM_PC_MAILBOX')));
  await game.screenshot('mail-read');
  // A: back to the party menu's action menu (CB2_ReturnToPartyMenuFromReadingMail).
  await game.press('A');
  await waitForTask(game, 'Task_HandleSelectionMenuInput', 'the action menu after reading');
  expect(await game.eval((t) => t.mail())).toBeUndefined();

  // MAIL → TAKE: "Send the removed MAIL to your PC?" NO → "The MAIL's message will be lost. Okay?" YES.
  await pick(game, 1, 'Task_HandleSelectionMenuInput');
  await pick(game, 1, 'Task_HandleSendMailToPCYesNoInput');
  await game.press('DOWN');
  await game.press('A');
  await waitForTask(game, 'Task_HandleLoseMailMessageYesNoInput');
  await game.press('A');
  await game.mashUntil((t) => t.itemCount('RETRO_MAIL') === 1, { what: 'the mail into the bag', maxFrames: 600 });
  const after = await game.eval((t) => ({ item: t.state!.party[0].heldItem, mail: t.state!.party[0].mail, slot: t.state!.mail[0].itemId }));
  expect(after).toEqual({ item: 0, slot: 0 }); // no `mail`: MAIL_NONE
  await game.mashUntil((t) => !t.gbaScreen() && t.idle(), { button: 'B', what: 'the field' });
});

test("the party menu's ITEM → GIVE: cancelling the mail puts it back; TAKE → YES sends it to the PC's slots", async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 11, y: 30, party: PARTY });
  await emptyItemsPocket(game);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_BEAD_MAIL'), 2));

  // PIKACHU: SUMMARY / ITEM / CANCEL → ITEM: GIVE / TAKE / CANCEL → GIVE → the bag → BEAD MAIL (A gives it).
  const toEasyChat = async () => {
    await openFirstMonActions(game);
    await pick(game, 1, 'Task_HandleSelectionMenuInput');
    await game.press('A');
    await game.waitForBag();
    await game.press('A');
    await waitForEasyChat(game);
  };
  await toEasyChat();
  expect(await game.eval((t) => [t.itemCount('BEAD_MAIL'), t.state!.party[0].mail])).toEqual([1, 0]);
  // B → "Stop giving POKéMON MAIL?" (the cursor on NO) → YES: back to the party menu, the mail back in the bag.
  await step(game, 'B', CMD.PROMPT_EXIT, STATE.CANCEL_YES_NO);
  await game.press('UP');
  await game.press('A');
  await waitForTask(game, 'Task_HandleSelectionMenuInput', 'the action menu after cancelling');
  expect(await game.eval((t) => [t.itemCount('BEAD_MAIL'), t.state!.party[0].heldItem, t.state!.party[0].mail, t.state!.mail[0].itemId])).toEqual([2, 0, null, 0]); // (mail undefined: MAIL_NONE)
  await game.mashUntil((t) => !t.gbaScreen() && t.idle(), { button: 'B', what: 'the field' });

  // Again, written this time (one word), then MAIL → READ: Bead Mail shows the mon's icon.
  await toEasyChat();
  await typeByGroup(game, 'EC_WORD_HI');
  await step(game, 'START', CMD.PROMPT_CONFIRM, STATE.CONFIRM_YES_NO);
  await game.press('A');
  // "PIKACHU was given the BEAD MAIL to hold." (Task_DisplayGaveMailFromPartyMessage), then choosing a mon again.
  await game.mashUntil((t) => t.gbaTasks().includes('Task_HandleChooseMonInput'), { what: 'choosing a mon after writing' });
  expect(await game.eval((t) => [t.itemCount('BEAD_MAIL'), t.state!.party[0].mail])).toEqual([1, 0]);
  await game.mashUntil((t) => !t.gbaScreen() && t.idle(), { button: 'B', what: 'the field' });
  await openFirstMonActions(game);
  await pick(game, 1, 'Task_HandleSelectionMenuInput');
  await game.press('A');
  const mail = await waitForMail(game);
  expect(mail).toMatchObject({ mailType: 6, monIconType: 1, iconSpecies: await game.eval((t) => t.define('SPECIES_PIKACHU')), nameX: 20 });
  expect(mail.lines[0]).toBe('HI '); // ConvertEasyChatWordsToString: a space after each word but the last of the row
  await game.screenshot('mail-bead');
  await game.press('B');
  await waitForTask(game, 'Task_HandleSelectionMenuInput', 'the action menu after reading');

  // MAIL → TAKE → YES: "The MAIL was sent to your PC." (TakeMailFromMon2: the first PC slot, 6)
  await pick(game, 1, 'Task_HandleSelectionMenuInput');
  await pick(game, 1, 'Task_HandleSendMailToPCYesNoInput');
  await game.press('A');
  await game.mashUntil((t) => t.state!.party[0].heldItem === 0, { what: 'the mail sent to the PC', maxFrames: 600 });
  const pc = await game.eval((t) => ({ slot: t.state!.mail[6], party: t.state!.mail[0].itemId, bag: t.itemCount('BEAD_MAIL') }));
  expect(pc.slot.itemId).toBe(await game.eval((t) => t.define('ITEM_BEAD_MAIL')));
  expect(pc.slot.words[0]).toBe((await wordIds(game, ['EC_WORD_HI']))[0]);
  expect(pc.party).toBe(0);
  expect(pc.bag).toBe(1);
  await game.mashUntil((t) => !t.gbaScreen() && t.idle(), { button: 'B', what: 'the field' });
});

test("the bag's CHECK on a mail: a blank mail of its type", async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 11, y: 30, party: PARTY });
  await emptyItemsPocket(game);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_DREAM_MAIL'), 1));
  await startMenu(game, 'BAG');
  await game.waitForBag();
  await game.press('A');
  await waitForTask(game, 'Task_FieldItemContextMenuHandleInput', 'the context menu');
  await game.press('A'); // CHECK
  const mail = await waitForMail(game);
  expect(mail).toMatchObject({ mailType: 9, messageExists: false, monIconType: 0 });
  await game.screenshot('mail-check');
  await game.press('A');
  await game.waitForBag();
  expect(await game.eval((t) => t.itemCount('DREAM_MAIL'))).toBe(1);
});

test('a held mail survives a save and CONTINUE', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 11, y: 30, party: PARTY });
  const [HI, AWESOME] = await wordIds(game, ['EC_WORD_HI', 'EC_WORD_AWESOME']);
  // As GiveMailToMon leaves it (the e2e e.g. above writes it through the screens).
  await game.eval(
    (t, words) => {
      const mon = t.state!.party[0];
      const mail = t.state!.mail[2];
      mon.heldItem = t.define('ITEM_WOOD_MAIL');
      mon.mail = 2;
      Object.assign(mail, { itemId: mon.heldItem, species: mon.species, words: [...words, ...new Array(7).fill(0xffff)], playerName: [0xbb, 0xbc, 0, 0, 0, 0, 0xff, 0xff], trainerId: [1, 2, 3, 4] });
    },
    [HI, AWESOME],
  );
  const before = await game.eval((t) => ({ mon: t.state!.party[0].mail, mail: t.state!.mail }));

  await startMenu(game, 'SAVE');
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press('UP');
  await game.press('A');
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();

  await game.load({ keepSave: true, mainMenu: true });
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading && t.mainMenu(), { what: 'the main menu' });
  await game.press('A');
  await game.waitForEvent('ready', { timeout: 60_000 });
  await game.waitIdle();
  const after = await game.eval((t) => ({ mon: t.state!.party[0].mail, mail: t.state!.mail }));
  expect(after).toEqual(before);

  // And it reads: "AB" in WOOD MAIL's layout.
  await openFirstMonActions(game);
  await pick(game, 1, 'Task_HandleSelectionMenuInput');
  await game.press('A');
  const mail = await waitForMail(game);
  expect(mail).toMatchObject({ mailType: 4, nameX: 12 });
  expect(mail.authorName.trimEnd()).toBe('AB');
  expect(mail.lines[0]).toBe('HI AWESOME');
  await game.press('A');
  await waitForTask(game, 'Task_HandleSelectionMenuInput', 'the action menu after reading');
});
