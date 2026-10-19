// Mail (W-mail unit 1): a Retro Mail bought at the Celadon Dept. Store 4F, given from the bag with its words written on
// the Easy Chat screen (EASY_CHAT_TYPE_MAIL), read from the party menu (MAIL → READ: menus/mail.ts), taken back into
// the bag (MAIL → TAKE → NO → YES: the message is lost) or sent to the PC's mail slots (YES); the party menu's
// ITEM → GIVE with a mail, cancelled on the Easy Chat screen; the bag's CHECK on a mail; a held mail through a save
// and CONTINUE. W-mail unit 2: the player's PC mailbox (player_pc.c, mailbox_pc.c: an empty one, the list, READ,
// MOVE TO BAG with the bag full and not, GIVE through the party menu), a mon left at the Route 5 daycare holding mail
// (struct DayCareMail) and taken back, and DONTAE's Jynx's Fab Mail read after the Cerulean trade.

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

// ------------------------------------------------------------------ W-mail unit 2

/** Party slot `slot`'s action menu, from the start menu (taking input). */
async function openMonActions(game: Game, slot: number): Promise<void> {
  await startMenu(game, 'POKEMON');
  await game.waitForPartyMenu();
  await game.pressTimes('DOWN', slot);
  await game.press('A');
  await waitForTask(game, 'Task_HandleSelectionMenuInput', 'the action menu');
}

/** Viridian Pokémon Center: the PC is above (11, 2). */
const PC = { start: 'after-rival', map: 'ViridianCity_PokemonCenter_1F', x: 11, y: 2 } as const;

/** Turn on the PC, pick PLAYER's PC and stop once its "What would you like to do?" shows. */
async function openPlayerPc(game: Game): Promise<void> {
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /Which PC should be accessed\?/.test(t.message() ?? ''), { what: 'the PC menu' });
  await game.eval((t) => t.waitFrames(60)); // the message prints, then the PC menu opens
  await game.press('DOWN');
  await game.press('A');
  await game.mashUntil((t) => /What would you like to do\?/.test(t.message() ?? ''), { what: "the player's PC" });
}

/** Wait (in the page) for the mailbox's phase `phase` (with no fade running), and return the probe. */
async function waitForMailbox(game: Game, phase: string) {
  const p = await game.eval((t, ph) => t.until(() => t.mailbox()?.phase === ph && !t.paletteFadeActive() && t.mailbox(), 20000), phase);
  expect(p, `the mailbox's ${phase}`).toBeTruthy();
  return (await game.eval((t) => t.mailbox()))!;
}

/** Mash A through a {PAUSE_UNTIL_PRESS} message (a single press can land while it still prints) back to the list. */
async function mashToMailbox(game: Game) {
  await game.mashUntil((t) => t.mailbox()?.phase === 'mailbox', { what: 'back to the mailbox list' });
  return waitForMailbox(game, 'mailbox');
}

/** Put a mail of `item` with `words` from "AB" into the mail slot `slot` (as TakeMailFromMon2 leaves one). */
async function putMail(game: Game, slot: number, item: string, words: number[]): Promise<void> {
  await game.eval(
    (t, sl, it, w) => {
      Object.assign(t.state!.mail[sl], {
        itemId: t.define(`ITEM_${it}`),
        species: t.define('SPECIES_PIKACHU'),
        words: [...w, ...new Array(9 - w.length).fill(0xffff)],
        playerName: [0xbb, 0xbc, 0, 0, 0, 0, 0xff, 0xff], // "AB" padded with spaces
        trainerId: [1, 2, 3, 4],
      });
    },
    slot,
    item,
    words,
  );
}

test("the player's PC mailbox: empty, then READ, MOVE TO BAG (the bag full, then not) and GIVE", async () => {
  const game = await session.start({ ...PC, party: PARTY });
  // MAILBOX with no mail: "There's no MAIL here." and back to the top menu.
  await openPlayerPc(game);
  await waitForMailbox(game, 'topMenu'); // (the probe reports the PC's phase)
  await game.press('DOWN');
  await game.press('A');
  await game.waitFor((t) => /There’s no MAIL here\.|There's no MAIL here\./.test(t.message() ?? ''), { what: 'the empty mailbox' });
  await game.mashUntil((t) => /What would you like to do\?/.test(t.message() ?? ''), { what: 'the top menu again' });
  await waitForMailbox(game, 'topMenu');

  // Three mails in PC slots 6, 8 and 11 (PCMailCompaction moves them up when the mailbox opens).
  const [HI, AWESOME] = await wordIds(game, ['EC_WORD_HI', 'EC_WORD_AWESOME']);
  await putMail(game, 6, 'RETRO_MAIL', [HI, AWESOME]);
  await putMail(game, 8, 'WOOD_MAIL', [AWESOME]);
  await putMail(game, 11, 'BEAD_MAIL', [HI]);
  await game.press('DOWN'); // the top menu opens on its first item again (Task_DrawPlayerPcTopMenu)
  await game.press('A');
  let box = await waitForMailbox(game, 'mailbox');
  expect(box).toMatchObject({ count: 3, cursorPos: 0, itemsAbove: 0, pageItems: 4, listShown: true });
  const items = (game: Game) => game.eval((t) => t.state!.mail.slice(6).map((m) => m.itemId));
  const ITEM = (name: string) => game.eval((t, n) => t.define(`ITEM_${n}`), name);
  const [RETRO, WOOD, BEAD] = [await ITEM('RETRO_MAIL'), await ITEM('WOOD_MAIL'), await ITEM('BEAD_MAIL')];
  expect(await items(game)).toEqual([RETRO, WOOD, BEAD, 0, 0, 0, 0, 0, 0, 0]);
  expect(await game.eval((t) => t.helpSystem().context)).toBe(await game.eval((t) => t.define('HELPCONTEXT_PLAYERS_PC_MAILBOX')));
  await game.screenshot('mailbox-list');

  // The first: "What would you like to do with AB's MAIL?" → READ.
  await game.press('A');
  await waitForMailbox(game, 'mailSubmenu');
  expect(await game.message()).toMatch(/What would you like to do with\s+AB['’]s MAIL\?/);
  await game.screenshot('mailbox-submenu');
  await game.press('A');
  const mail = await waitForMail(game);
  expect(mail).toMatchObject({ mailType: 11, messageExists: true });
  expect(mail.lines[0]).toBe('HI AWESOME');
  expect(mail.authorName.trimEnd()).toBe('AB');
  await game.press('B');
  box = await waitForMailbox(game, 'mailbox'); // CB2_ReturnToMailbox: the list again, the cursor where it was
  expect(box).toMatchObject({ count: 3, cursorPos: 0, itemsAbove: 0 });

  // The second: MOVE TO BAG with the ITEMS pocket full: "The BAG is full." and the mail stays.
  await game.eval((t) => t.state!.bag.pockets[0].forEach((s) => ((s.itemId = t.define('ITEM_POTION')), (s.quantity = 999))));
  await game.press('DOWN');
  await game.eval((t) => t.waitFrames(4));
  await game.press('A');
  await waitForMailbox(game, 'mailSubmenu');
  const moveToBag = async () => {
    await game.press('DOWN');
    await game.eval((t) => t.waitFrames(4));
    await game.press('A');
    await game.waitFor((t) => /The message will be lost\./.test(t.message() ?? ''), { what: 'the warning' });
    await waitForMailbox(game, 'yesNo');
    await game.press('A'); // YES
  };
  await moveToBag();
  await game.waitFor((t) => /The BAG is full\./.test(t.message() ?? ''), { what: 'the bag full' });
  box = await mashToMailbox(game);
  expect(box).toMatchObject({ count: 3, itemsAbove: 1 });
  expect(await items(game)).toEqual([RETRO, WOOD, BEAD, 0, 0, 0, 0, 0, 0, 0]);

  // With room in the bag: "The MAIL was returned to the BAG with its message erased."
  await emptyItemsPocket(game);
  await game.press('A');
  await waitForMailbox(game, 'mailSubmenu');
  await moveToBag();
  await game.waitFor((t) => /returned to the BAG/.test(t.message() ?? ''), { what: 'the mail into the bag' });
  box = await mashToMailbox(game);
  expect(box).toMatchObject({ count: 2, cursorPos: 0, itemsAbove: 1, pageItems: 3 });
  expect(await items(game)).toEqual([RETRO, BEAD, 0, 0, 0, 0, 0, 0, 0, 0]);
  expect(await game.eval((t) => t.itemCount('WOOD_MAIL'))).toBe(1);

  // The cursor is on the Bead Mail now: GIVE → the party menu → PIKACHU: "MAIL was transferred from the MAILBOX."
  await game.press('A');
  await waitForMailbox(game, 'mailSubmenu');
  await game.pressTimes('DOWN', 2);
  await game.eval((t) => t.waitFrames(4));
  await game.press('A');
  await game.waitForPartyMenu();
  await game.press('A');
  await game.mashUntil((t) => t.mailbox()?.phase === 'mailbox' && !t.paletteFadeActive(), { what: 'back to the mailbox', maxFrames: 3000 });
  box = (await game.eval((t) => t.mailbox()))!;
  expect(box).toMatchObject({ count: 1, cursorPos: 0, itemsAbove: 1, pageItems: 2 });
  expect(await items(game)).toEqual([RETRO, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const held = await game.eval((t) => ({ item: t.state!.party[0].heldItem, mail: t.state!.party[0].mail, slot: t.state!.mail[0] }));
  expect(held).toMatchObject({ item: BEAD, mail: 0 });
  expect(held.slot).toMatchObject({ itemId: BEAD, words: [HI, ...new Array(8).fill(0xffff)] });
  await game.screenshot('mailbox-after-give');

  // CANCEL (B): the top menu, then off.
  await game.press('B');
  await game.waitFor((t) => /What would you like to do\?/.test(t.message() ?? ''), { what: 'the top menu' });
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
  expect(await game.eval((t) => t.mailbox())).toBeUndefined();
});

test('a mon left at the Route 5 daycare holding mail gets it back (struct DayCareMail), and it reads', async () => {
  const game = await session.start({
    start: 'after-rival',
    map: 'Route5_PokemonDayCare',
    x: 4,
    y: 5,
    party: [{ species: 'RATTATA', level: 5, moves: ['TACKLE'] }, { species: 'PIDGEY', level: 10, moves: ['TACKLE'] }],
  });
  const [HI, AWESOME] = await wordIds(game, ['EC_WORD_HI', 'EC_WORD_AWESOME']);
  await putMail(game, 0, 'RETRO_MAIL', [AWESOME, HI]);
  await game.eval((t) => {
    t.state!.party[0].heldItem = t.define('ITEM_RETRO_MAIL');
    t.state!.party[0].mail = 0;
  });
  const before = await game.eval((t) => t.state!.mail[0]);

  // YES to "raise one of your POKéMON?", STORE on RATTATA.
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the daycare party menu' });
  await game.waitForPartyMenu();
  await game.mashUntil((t) => t.gbaScreen() === undefined, { what: 'back to the field' });
  await game.mashUntil((t) => t.idle(), { what: 'the script to end' });
  const left = await game.eval((t) => ({ daycare: t.state!.route5DayCareMon, slot: t.state!.mail[0].itemId }));
  expect(left.daycare.mon!.heldItem).toBe(0);
  expect(left.daycare.mail!.message).toEqual(before);
  expect(left.slot).toBe(0);

  // Straight back (¥100): "PLAYER got RATTATA back from the DAY-CARE MAN."
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /got RATTATA back/.test(t.message() ?? ''), { what: 'the mon back' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  const back = await game.eval((t) => ({ mon: t.state!.party[1], daycare: t.state!.route5DayCareMon }));
  expect(back.mon.heldItem).toBe(await game.eval((t) => t.define('ITEM_RETRO_MAIL')));
  expect(back.daycare.mail).toBeUndefined();
  expect(await game.eval((t, id) => t.state!.mail[id], back.mon.mail!)).toEqual(before);

  // MAIL → READ: AWESOME HI from AB. (SUMMARY / SWITCH / MAIL / CANCEL with two mons)
  await openMonActions(game, 1);
  await pick(game, 2, 'Task_HandleSelectionMenuInput');
  await game.press('A');
  const mail = await waitForMail(game);
  expect(mail.lines[0]).toBe('AWESOME HI');
  expect(mail.authorName.trimEnd()).toBe('AB');
  await game.press('A');
  await waitForTask(game, 'Task_HandleSelectionMenuInput', 'the action menu after reading');
});

test("DONTAE's Jynx comes with its Fab Mail (GetInGameTradeMail), which reads", async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeruleanCity_House3', x: 2, y: 3, party: [{ species: 'POLIWHIRL', level: 20 }] });
  // "...Do you have a POLIWHIRL? Would you trade it for my JYNX?" YES → the party menu → POLIWHIRL → the trade scene.
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu' && !t.paletteFadeActive(), { what: 'the party menu' });
  await game.press('A');
  await game.mashUntil((t) => t.idle() && t.flag('FLAG_DID_ZYNX_TRADE'), { what: 'the trade', maxFrames: 20000, timeout: 240_000 });
  const jynx = await game.eval((t) => ({ species: t.state!.party[0].species, item: t.state!.party[0].heldItem, mail: t.state!.party[0].mail, slot: t.state!.mail[0] }));
  expect(jynx.species).toBe(await game.eval((t) => t.define('SPECIES_JYNX')));
  expect(jynx.item).toBe(await game.eval((t) => t.define('ITEM_FAB_MAIL')));
  expect(jynx.mail).toBe(0);
  expect(jynx.slot.itemId).toBe(jynx.item);
  expect(jynx.slot.species).toBe(jynx.species);

  // MAIL → READ: DONTAE's message.
  await openMonActions(game, 0);
  await pick(game, 1, 'Task_HandleSelectionMenuInput');
  await game.press('A');
  const mail = await waitForMail(game);
  expect(mail.messageExists).toBe(true);
  expect(mail.authorName.trimEnd()).toBe('DONTAE');
  expect(mail.lines.join(' ').replace(/\s+/g, ' ')).toMatch(/THAT.S A HEALTHY JYNX ?! BE KIND TO IT/);
  await game.screenshot('mail-fab-dontae');
  await game.press('A');
  await waitForTask(game, 'Task_HandleSelectionMenuInput', 'the action menu after reading');
});
