// Easy Chat (SIDE_PLAN.md W-easychat): the Pewter Pokémon Center's profile woman (data/scripts/mystery_event_club.inc,
// talked to from (13, 3)) → Common_ShowEasyChatScreen → the Easy Chat screen (menus/easyChatScreen.ts) → back, and
// the saved words in the field (ShowEasyChatMessage).
//
// Words are typed as a player would: A on a field opens the groups menu (or the A-Z keyboard after SELECT), the D-pad
// to the group / letter, A opens its word list, the D-pad (and START / SELECT to page) to the word, A places it.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** Press A (or `button`) until the field message matches `re`; returns it. */
async function untilMessage(game: Game, re: RegExp, what: string): Promise<string> {
  await game.eval((_t, src, flags) => ((window as any).__ecRe = new RegExp(src, flags)), re.source, re.flags);
  return (await game.mashUntil((t) => (window as any).__ecRe.test(t.message() ?? '') && t.message(), { what })) as string;
}

/** The profile woman with `profile` (EC_WORD_* names) saved: talk, YES, through to the Easy Chat screen taking input. */
async function openProfileScreen(profile: string[]): Promise<Game> {
  const game = await session.start({ start: 'after-rival', map: 'PewterCity_PokemonCenter_1F', x: 13, y: 3 });
  await game.eval((t, words) => {
    const d = t.state!.defines;
    t.state!.easyChatProfile.splice(0, 4, ...words.map((n: string) => d.require(n)));
  }, profile);
  await game.eval((t) => t.face('up'));
  // Her greeting, YES at the multichoice (A picks the first item), "What's your profile?", the fade, the screen.
  // The mash stops as soon as the screen's callback is set, two ticks before Task_RunEasyChat reads the keys.
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_EasyChatScreen', { what: 'the Easy Chat screen' });
  await game.waitForScreen('CB2_EasyChatScreen');
  return game;
}

/** The screen's probe (menus/easyChatScreen.ts easyChatProbe), minus the live model and the reprint hook. */
function probe(game: Game) {
  return game.eval((t) => {
    const p = t.easyChat();
    if (!p) return undefined;
    const s = p.screen!;
    return { state: s.state, lastCommand: p.lastCommand, cursor: p.cursor, buffer: [...s.ecWordBuffer], startSelectVisible: p.startSelectVisible };
  });
}

/** Wait (in the page) until the screen has run interface command `cmd` and is back reading input in `state`. */
async function waitForCommand(game: Game, cmd: number, state: number): Promise<void> {
  const ok = await game.eval(
    (t, c, s) =>
      t.until(() => {
        const p = t.easyChat();
        return !!p && p.lastCommand === c && p.screen!.state === s && p.idle;
      }, 600),
    cmd,
    state,
  );
  expect(ok, `command ${cmd} / state ${state}`).toBe(true);
}

/** Wait (in the page) until the screen is gone and the field is back. */
async function waitForField(game: Game): Promise<void> {
  expect(await game.eval((t) => t.until(() => !t.easyChat() && !t.gbaScreen(), 20000))).toBe(true);
}

async function wordIds(game: Game, names: string[]): Promise<number[]> {
  return game.eval((t, n) => n.map((name: string) => t.state!.defines.require(name)), names);
}

const PROFILE = ['EC_WORD_HELLO', 'EC_WORD_TRAINER', 'EC_WORD_SEE_YA', 'EC_WORD_EXCL'];

// EC_CMD / EC_STATE (menus/easyChatScreenModel.ts)
const CMD = {
  REPRINT_PHRASE: 1,
  UPDATE_MAIN_CURSOR: 2,
  UPDATE_MAIN_CURSOR_ON_BUTTONS: 3,
  PROMPT_DELETE_ALL: 4,
  PROMPT_EXIT: 5,
  PROMPT_CONFIRM: 6,
  CLOSE_PROMPT: 7,
  CLOSE_PROMPT_AFTER_DELETE: 8,
  OPEN_KEYBOARD: 9,
  CLOSE_KEYBOARD: 10,
  OPEN_WORD_SELECT: 11,
  CLOSE_WORD_SELECT: 12,
  RETURN_TO_KEYBOARD: 13,
  UPDATE_KEYBOARD_CURSOR: 14,
  GROUP_NAMES_SCROLL_DOWN: 15,
  GROUP_NAMES_SCROLL_UP: 16,
  UPDATE_WORD_SELECT_CURSOR: 17,
  WORD_SELECT_SCROLL_UP: 18,
  WORD_SELECT_SCROLL_DOWN: 19,
  WORD_SELECT_PAGE_UP: 20,
  WORD_SELECT_PAGE_DOWN: 21,
  SWITCH_KEYBOARD_MODE: 22,
};
const STATE = { SELECT_FIELD: 0, SELECT_FOOTER: 1, SELECT_GROUP: 2, SELECT_WORD: 3, CANCEL_YES_NO: 4, DEL_ALL_YES_NO: 5, CONFIRM_YES_NO: 6 };

/**
 * Press `button` and wait (in the page) until the screen has run a new interface command, one of `cmds`, and is back
 * reading input in `state`; returns the command.
 */
async function step(game: Game, button: Parameters<Game['press']>[0], cmds: number | number[], state: number): Promise<number> {
  const want = Array.isArray(cmds) ? cmds : [cmds];
  const got = await game.eval(
    async (t, b, w, s) => {
      const before = t.easyChat()!.commandCount;
      await t.press(b, 2, 2);
      let last = -1;
      const ok = await t.until(() => {
        const p = t.easyChat();
        if (!p || p.commandCount === before) return false;
        last = p.lastCommand;
        return w.includes(p.lastCommand) && p.screen!.state === s && p.idle;
      }, 600);
      return ok ? last : -1 - last;
    },
    button,
    want,
    state,
  );
  expect(got, `${button} → command ${want.join('/')} in state ${state}`).toBeGreaterThanOrEqual(0);
  return got;
}

/** The screen's unit-4 probe fields (menus/easyChatScreen.ts easyChatProbe). */
function probe4(game: Game) {
  return game.eval((t) => {
    const p = t.easyChat()!;
    const s = p.screen!;
    return {
      state: s.state,
      alpha: s.isAlphaMode,
      group: { x: s.selectGroupCursorX, y: s.selectGroupCursorY, rowsAbove: s.selectGroupRowsAbove },
      word: { x: s.selectWordCursorX, y: s.selectWordCursorY, rowsAbove: s.selectWordRowsAbove, numRows: s.selectWordNumRows },
      frameAnimIdx: p.frameAnimIdx,
      win0: p.win0,
      bg2Y: p.bg2Y,
      bg2ScrollRow: p.bg2ScrollRow,
      rectCursor: p.rectCursor,
      wordCursor: p.wordCursor,
      modeAnim: p.modeAnim,
      helpX2: p.helpX2,
      scrollArrows: p.scrollArrows,
      startVisible: p.startSelectVisible,
      selectVisible: p.selectVisible,
      groups: p.groups,
      words: p.words,
      buffer: [...s.ecWordBuffer],
    };
  });
}

/** From the field selection, A: the groups menu (switched to the groups or the keyboard as `alpha` says). */
async function openKeyboard(game: Game, alpha: boolean): Promise<void> {
  await step(game, 'A', CMD.OPEN_KEYBOARD, STATE.SELECT_GROUP);
  if ((await probe4(game)).alpha !== alpha) await step(game, 'SELECT', CMD.SWITCH_KEYBOARD_MODE, STATE.SELECT_GROUP);
}

/** From the word list's top, move to `word` (rows with DOWN, or pages with SELECT when `page`) and place it with A. */
async function pickWord(game: Game, word: number, page = false): Promise<void> {
  const p = await probe4(game);
  const i = p.words.indexOf(word);
  expect(i, `word ${word} on the list`).toBeGreaterThanOrEqual(0);
  const row = i >> 1;
  let { rowsAbove, y } = p.word;
  if (page) {
    while (rowsAbove + 3 < row && rowsAbove <= p.word.numRows - 4) {
      await step(game, 'SELECT', CMD.WORD_SELECT_PAGE_DOWN, STATE.SELECT_WORD);
      ({ rowsAbove, y } = (await probe4(game)).word);
    }
  }
  while (rowsAbove + y < row) {
    await step(game, 'DOWN', [CMD.UPDATE_WORD_SELECT_CURSOR, CMD.WORD_SELECT_SCROLL_DOWN], STATE.SELECT_WORD);
    ({ rowsAbove, y } = (await probe4(game)).word);
  }
  while (rowsAbove + y > row) {
    await step(game, 'UP', [CMD.UPDATE_WORD_SELECT_CURSOR, CMD.WORD_SELECT_SCROLL_UP], STATE.SELECT_WORD);
    ({ rowsAbove, y } = (await probe4(game)).word);
  }
  if (i & 1) await step(game, 'RIGHT', CMD.UPDATE_WORD_SELECT_CURSOR, STATE.SELECT_WORD);
  await step(game, 'A', CMD.CLOSE_WORD_SELECT, STATE.SELECT_FIELD);
}

/** From the field selection (cursor on the field), type `word` (EC_WORD_*) through its group. */
async function typeByGroup(game: Game, word: string): Promise<void> {
  const id = (await wordIds(game, [word]))[0];
  await openKeyboard(game, false);
  const gi = (await probe4(game)).groups.indexOf(id >> 9);
  expect(gi, `${word}'s group on the menu`).toBeGreaterThanOrEqual(0);
  for (let r = 0; r < gi >> 1; r++) await step(game, 'DOWN', [CMD.UPDATE_KEYBOARD_CURSOR, CMD.GROUP_NAMES_SCROLL_DOWN], STATE.SELECT_GROUP);
  if (gi & 1) await step(game, 'RIGHT', CMD.UPDATE_KEYBOARD_CURSOR, STATE.SELECT_GROUP);
  await step(game, 'A', CMD.OPEN_WORD_SELECT, STATE.SELECT_WORD);
  await pickWord(game, id);
}

/** sAlphabetLayout's keys: [row, column] of each letter (easy_chat_2.c). */
const KEYBOARD = ['ABCDEF', 'GHIJKL', 'MNOPQRS', 'TUVWXYZ'];

/** From the field selection, type `word` through the A-Z keyboard (`letter`, its first letter). */
async function typeByKeyboard(game: Game, word: string, letter: string, page = false): Promise<void> {
  const id = (await wordIds(game, [word]))[0];
  await openKeyboard(game, true);
  const row = KEYBOARD.findIndex((r) => r.includes(letter));
  const col = KEYBOARD[row].indexOf(letter);
  for (let r = 0; r < row; r++) await step(game, 'DOWN', CMD.UPDATE_KEYBOARD_CURSOR, STATE.SELECT_GROUP);
  for (let c = 0; c < col; c++) await step(game, 'RIGHT', CMD.UPDATE_KEYBOARD_CURSOR, STATE.SELECT_GROUP);
  await step(game, 'A', CMD.OPEN_WORD_SELECT, STATE.SELECT_WORD);
  await pickWord(game, id, page);
}

test('the profile screen: B → YES quits (EventScript_CancelGiveProfile)', async () => {
  const game = await openProfileScreen(PROFILE);
  // The PROFILE frame (sPhraseFrameDimensions[0]: left 3, top 4): the triangle cursor left of the first field.
  const p = (await probe(game))!;
  expect(p.state).toBe(STATE.SELECT_FIELD);
  expect(p.cursor).toMatchObject({ x: 3 * 8 + 13, y: (4 + 1) * 8 + 1, bouncing: true });
  expect(p.startSelectVisible).toBe(false);
  await game.screenshot('easyChat-profile');

  await game.press('B');
  await waitForCommand(game, CMD.PROMPT_EXIT, STATE.CANCEL_YES_NO);
  expect((await probe(game))!.cursor).toMatchObject({ bouncing: false, x2: 0 });
  await game.screenshot('easyChat-quit-editing');
  // The cursor starts on NO: B closes the prompt, back to the fields.
  await game.press('B');
  await waitForCommand(game, CMD.CLOSE_PROMPT, STATE.SELECT_FIELD);
  expect((await probe(game))!.cursor!.bouncing).toBe(true);
  await game.press('B');
  await waitForCommand(game, CMD.PROMPT_EXIT, STATE.CANCEL_YES_NO);
  await game.press('UP');
  await game.press('A');
  await waitForField(game);
  await untilMessage(game, /decided not to/, 'EventScript_CancelGiveProfile');
  expect(await game.eval((t) => t.state!.easyChatProfile.slice(0, 4))).toEqual(await wordIds(game, PROFILE));
  // Task_RunEasyChat sets the flag on leaving the profile, cancelled or not.
  expect(await game.eval((t) => t.flag('FLAG_SYS_SET_TRAINER_CARD_PROFILE'))).toBe(true);
  expect(await game.eval((t) => t.var('VAR_TEMP_1'))).toBe(0);
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the script over', button: 'B' });
});

test('the cursor moves over the fields and the footer; DEL. ALL → YES empties the fields', async () => {
  const game = await openProfileScreen(PROFILE);
  // RIGHT: the second field, after HELLO (5 glyphs 6 px wide in FONT_NORMAL_COPY_1) + 17 (ECInterfaceCmd_02).
  await game.press('RIGHT');
  await waitForCommand(game, CMD.UPDATE_MAIN_CURSOR, STATE.SELECT_FIELD);
  expect((await probe(game))!.cursor).toMatchObject({ x: 37 + 30 + 17, y: 41 });
  // DOWN: the second row; DOWN again: the footer, same column (1 = CANCEL at x 115, y 97: ECInterfaceCmd_03).
  await game.press('DOWN');
  await waitForCommand(game, CMD.UPDATE_MAIN_CURSOR, STATE.SELECT_FIELD);
  expect((await probe(game))!.cursor!.y).toBe(8 * (4 + 2 + 1) + 1);
  await game.press('DOWN');
  await waitForCommand(game, CMD.UPDATE_MAIN_CURSOR_ON_BUTTONS, STATE.SELECT_FOOTER);
  expect((await probe(game))!.cursor).toMatchObject({ x: 115, y: 97 });
  await game.press('LEFT');
  await waitForCommand(game, CMD.UPDATE_MAIN_CURSOR_ON_BUTTONS, STATE.SELECT_FOOTER);
  expect((await probe(game))!.cursor).toMatchObject({ x: 28, y: 97 });
  // DEL. ALL: the prompt starts on NO.
  await game.press('A');
  await waitForCommand(game, CMD.PROMPT_DELETE_ALL, STATE.DEL_ALL_YES_NO);
  await game.screenshot('easyChat-del-all');
  await game.press('UP');
  await game.press('A');
  await waitForCommand(game, CMD.CLOSE_PROMPT_AFTER_DELETE, STATE.SELECT_FOOTER);
  expect((await probe(game))!.buffer).toEqual([0xffff, 0xffff, 0xffff, 0xffff]);
  await game.screenshot('easyChat-empty');
  // START with every field empty asks "Quit editing?" (Confirm_CreateYesNoMenu); YES leaves without saving.
  await game.press('START');
  await waitForCommand(game, CMD.PROMPT_EXIT, STATE.CANCEL_YES_NO);
  await game.press('UP');
  await game.press('A');
  await waitForField(game);
  await untilMessage(game, /decided not to/, 'EventScript_CancelGiveProfile');
  expect(await game.eval((t) => t.state!.easyChatProfile.slice(0, 4))).toEqual(await wordIds(game, PROFILE));
});

test('START → YES on an unchanged profile keeps it (VAR_RESULT FALSE: EventScript_CancelGiveProfile)', async () => {
  const game = await openProfileScreen(PROFILE);
  await game.press('START');
  await waitForCommand(game, CMD.PROMPT_CONFIRM, STATE.CONFIRM_YES_NO);
  await game.screenshot('easyChat-confirm');
  await game.press('A'); // the cursor starts on YES
  await waitForField(game);
  // Confirm_HandleYesNoMenu: VAR_RESULT = HasECMessageChanged(), FALSE here, so the script says "decided not to".
  await untilMessage(game, /decided not to/, 'EventScript_CancelGiveProfile');
  expect(await game.eval((t) => t.state!.easyChatProfile.slice(0, 4))).toEqual(await wordIds(game, PROFILE));
  expect(await game.eval((t) => t.flag('FLAG_SYS_SET_TRAINER_CARD_PROFILE'))).toBe(true);
});

/** Move the triangle cursor between the 2-column fields, from field `from` to field `to`. */
async function toField(game: Game, from: number, to: number): Promise<void> {
  const [r0, c0, r1, c1] = [from >> 1, from & 1, to >> 1, to & 1];
  if (c1 !== c0) await step(game, c1 > c0 ? 'RIGHT' : 'LEFT', CMD.UPDATE_MAIN_CURSOR, STATE.SELECT_FIELD);
  for (let r = r0; r !== r1; r += r1 > r0 ? 1 : -1) await step(game, r1 > r0 ? 'DOWN' : 'UP', CMD.UPDATE_MAIN_CURSOR, STATE.SELECT_FIELD);
}

test('a new profile typed through the groups and the A-Z keyboard (EventScript_GaveProfile)', async () => {
  const game = await openProfileScreen(PROFILE);
  const [HI, AWESOME] = await wordIds(game, ['EC_WORD_HI', 'EC_WORD_AWESOME']);
  // A on HELLO: the green frame grows out of the instructions (RedrawFrameByIndex 0 → 10), WIN0 to its inside
  // (RedrawFrameByRect(1, 10, 23, 10)), the help sprites slide in, the red cursor on the first group.
  await openKeyboard(game, false);
  let p = await probe4(game);
  expect(p).toMatchObject({ frameAnimIdx: 10, win0: [16, 88, 184, 152], bg2Y: 8, modeAnim: 1, helpX2: 0 });
  expect(p.rectCursor).toEqual({ x: 58, y: 96, anim: 0 });
  expect(p.scrollArrows).toMatchObject({ x: 96, up: false, down: true });
  await game.screenshot('easyChat-groups');
  // HI from GREETINGS.
  const gi = p.groups.indexOf(HI >> 9);
  for (let r = 0; r < gi >> 1; r++) await step(game, 'DOWN', [CMD.UPDATE_KEYBOARD_CURSOR, CMD.GROUP_NAMES_SCROLL_DOWN], STATE.SELECT_GROUP);
  if (gi & 1) await step(game, 'RIGHT', CMD.UPDATE_KEYBOARD_CURSOR, STATE.SELECT_GROUP);
  p = await probe4(game);
  expect(p.rectCursor).toMatchObject({ x: (gi & 1) * 84 + 58, y: p.group.y * 16 + 96 });
  await step(game, 'A', CMD.OPEN_WORD_SELECT, STATE.SELECT_WORD);
  // The word list: the frame at its widest (RedrawFrameByRect(0, 10, 30, 10)), the triangle cursor left of the first word.
  p = await probe4(game);
  expect(p).toMatchObject({ frameAnimIdx: 17, win0: [8, 88, 232, 152], bg2Y: 8, modeAnim: null, rectCursor: null });
  expect(p.wordCursor).toEqual({ x: 3 * 8 + 4, y: 12 * 8 + 1 });
  expect(p.scrollArrows).toMatchObject({ x: 120, up: false });
  await game.screenshot('easyChat-words');
  await pickWord(game, HI);
  p = await probe4(game);
  expect(p.frameAnimIdx).toBe(0);
  expect(p.buffer[0]).toBe(HI);
  expect((await probe(game))!.cursor!.bouncing).toBe(true);
  await game.screenshot('easyChat-placed');

  // AWESOME in the last field, through the keyboard's A.
  await toField(game, 0, 3);
  await openKeyboard(game, true);
  p = await probe4(game);
  expect(p).toMatchObject({ alpha: true, frameAnimIdx: 18, modeAnim: 2 });
  expect(p.rectCursor).toEqual({ x: 32, y: 96, anim: 3 });
  expect(p.scrollArrows).toMatchObject({ up: false, down: false });
  await game.screenshot('easyChat-keyboard');
  await step(game, 'A', CMD.OPEN_WORD_SELECT, STATE.SELECT_WORD);
  await pickWord(game, AWESOME);

  await step(game, 'START', CMD.PROMPT_CONFIRM, STATE.CONFIRM_YES_NO);
  await game.press('A');
  await waitForField(game);
  expect(await untilMessage(game, /HI/, 'the profile in the message box')).toBe('HI TRAINER SEE YA AWESOME');
  await untilMessage(game, /says something/, 'Text_ProfileSaysSomethingAboutYou');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the script over', button: 'B' });
  expect(await game.eval((t) => t.var('VAR_TEMP_1'))).toBe(1); // GAVE_PROFILE
  expect(await game.eval((t) => t.flag('FLAG_SYS_SET_TRAINER_CARD_PROFILE'))).toBe(true);
  expect(await game.eval((t) => t.state!.easyChatProfile.slice(0, 4))).toEqual(await wordIds(game, ['EC_WORD_HI', 'EC_WORD_TRAINER', 'EC_WORD_SEE_YA', 'EC_WORD_AWESOME']));
  await game.press('A');
  await untilMessage(game, /tell me more about/, 'EventScript_AlreadyGaveProfile');
});

test('scrolling: the group names, a long word list by rows and pages, the mode switch, DEL, B back out', async () => {
  const game = await openProfileScreen(PROFILE);
  await openKeyboard(game, false);
  let p = await probe4(game);
  const groups = p.groups;
  const groupRows = (groups.length + 1) >> 1;
  // Down the left column to the fourth row, then one more: the names scroll a row (ECInterfaceCmd_15, BG2 2 px a frame).
  for (let r = 0; r < 3; r++) await step(game, 'DOWN', CMD.UPDATE_KEYBOARD_CURSOR, STATE.SELECT_GROUP);
  await step(game, 'DOWN', CMD.GROUP_NAMES_SCROLL_DOWN, STATE.SELECT_GROUP);
  p = await probe4(game);
  expect(p).toMatchObject({ group: { x: 0, y: 3, rowsAbove: 1 }, bg2Y: 8 + 16, bg2ScrollRow: 1 });
  expect(p.rectCursor).toMatchObject({ y: 3 * 16 + 96 });
  expect(p.scrollArrows).toMatchObject({ up: true, down: groupRows > 5 });
  await game.screenshot('easyChat-groups-scrolled');
  // Back up: the cursor to the top row, then the names scroll back (ECInterfaceCmd_16).
  for (let r = 0; r < 3; r++) await step(game, 'UP', CMD.UPDATE_KEYBOARD_CURSOR, STATE.SELECT_GROUP);
  await step(game, 'UP', CMD.GROUP_NAMES_SCROLL_UP, STATE.SELECT_GROUP);
  expect(await probe4(game)).toMatchObject({ group: { y: 0, rowsAbove: 0 }, bg2Y: 8, bg2ScrollRow: 0 });

  // ENDINGS (69 words, 35 rows): page down with SELECT, a row with DOWN, page up with START.
  const gi = groups.indexOf((await wordIds(game, ['EC_WORD_IS']))[0] >> 9);
  for (let r = 0; r < gi >> 1; r++) await step(game, 'DOWN', [CMD.UPDATE_KEYBOARD_CURSOR, CMD.GROUP_NAMES_SCROLL_DOWN], STATE.SELECT_GROUP);
  if (gi & 1) await step(game, 'RIGHT', CMD.UPDATE_KEYBOARD_CURSOR, STATE.SELECT_GROUP);
  const groupScroll = (await probe4(game)).group.rowsAbove;
  await step(game, 'A', CMD.OPEN_WORD_SELECT, STATE.SELECT_WORD);
  p = await probe4(game);
  expect(p.words.length).toBe(69);
  expect(p).toMatchObject({ word: { rowsAbove: 0, numRows: 34 }, bg2Y: 8, startVisible: false, selectVisible: true });
  expect(p.scrollArrows).toMatchObject({ x: 120, up: false, down: true });
  await step(game, 'SELECT', CMD.WORD_SELECT_PAGE_DOWN, STATE.SELECT_WORD);
  p = await probe4(game);
  expect(p).toMatchObject({ word: { rowsAbove: 4 }, bg2Y: 8 + 4 * 16, bg2ScrollRow: 4, startVisible: true, selectVisible: true });
  expect(p.scrollArrows).toMatchObject({ up: true, down: true });
  await game.screenshot('easyChat-words-page');
  for (let r = 0; r < 3; r++) await step(game, 'DOWN', CMD.UPDATE_WORD_SELECT_CURSOR, STATE.SELECT_WORD);
  await step(game, 'DOWN', CMD.WORD_SELECT_SCROLL_DOWN, STATE.SELECT_WORD);
  p = await probe4(game);
  expect(p).toMatchObject({ word: { y: 3, rowsAbove: 5 }, bg2Y: 8 + 5 * 16, bg2ScrollRow: 5 });
  expect(p.wordCursor).toEqual({ x: 28, y: (3 * 2 + 12) * 8 + 1 });
  // Page down to the end (rowsAbove stops at numRows - 3) and back to the top with START.
  for (let n = 0; (await probe4(game)).word.rowsAbove <= 34 - 4; n++) {
    expect(n).toBeLessThan(10);
    await step(game, 'SELECT', CMD.WORD_SELECT_PAGE_DOWN, STATE.SELECT_WORD);
  }
  p = await probe4(game);
  expect(p).toMatchObject({ word: { rowsAbove: 31 }, bg2Y: 8 + 31 * 16, bg2ScrollRow: 31, selectVisible: false });
  expect(p.scrollArrows).toMatchObject({ up: true, down: false });
  await game.screenshot('easyChat-words-end');
  for (let n = 0; (await probe4(game)).word.rowsAbove > 0; n++) {
    expect(n).toBeLessThan(10);
    await step(game, 'START', CMD.WORD_SELECT_PAGE_UP, STATE.SELECT_WORD);
  }
  expect(await probe4(game)).toMatchObject({ word: { rowsAbove: 0 }, bg2Y: 8, bg2ScrollRow: 0, startVisible: false });
  // A page down, the cursor to the top row, one more UP: the list scrolls a row up (ECInterfaceCmd_18).
  await step(game, 'SELECT', CMD.WORD_SELECT_PAGE_DOWN, STATE.SELECT_WORD);
  for (let n = 0; (await probe4(game)).word.y > 0; n++) {
    expect(n).toBeLessThan(4);
    await step(game, 'UP', CMD.UPDATE_WORD_SELECT_CURSOR, STATE.SELECT_WORD);
  }
  await step(game, 'UP', CMD.WORD_SELECT_SCROLL_UP, STATE.SELECT_WORD);
  expect(await probe4(game)).toMatchObject({ word: { y: 0, rowsAbove: 3 }, bg2Y: 8 + 3 * 16, bg2ScrollRow: 3 });

  // B: back to the groups, the cursor and the names' scroll where they were.
  await step(game, 'B', CMD.RETURN_TO_KEYBOARD, STATE.SELECT_GROUP);
  p = await probe4(game);
  expect(p).toMatchObject({ frameAnimIdx: 10, win0: [16, 88, 184, 152], bg2Y: 8 + groupScroll * 16, wordCursor: null, startVisible: false });
  expect(p.rectCursor).toMatchObject({ x: (gi & 1) * 84 + 58 });
  // SELECT: the keyboard (the frame shrinks and grows back, ECInterfaceCmd_22); SELECT again: the groups from the top.
  await step(game, 'SELECT', CMD.SWITCH_KEYBOARD_MODE, STATE.SELECT_GROUP);
  expect(await probe4(game)).toMatchObject({ alpha: true, frameAnimIdx: 18, bg2Y: 8, modeAnim: 2, rectCursor: { x: 32, y: 96, anim: 3 } });
  await step(game, 'SELECT', CMD.SWITCH_KEYBOARD_MODE, STATE.SELECT_GROUP);
  expect(await probe4(game)).toMatchObject({ alpha: false, frameAnimIdx: 18, bg2Y: 8, modeAnim: 1, rectCursor: { x: 58, y: 96, anim: 0 } });
  // LEFT: the blue box's MODE; DOWN: DEL; A empties the field being edited (HELLO), the groups stay open.
  await step(game, 'LEFT', CMD.UPDATE_KEYBOARD_CURSOR, STATE.SELECT_GROUP);
  expect((await probe4(game)).rectCursor).toEqual({ x: 216, y: 112, anim: 1 });
  await step(game, 'DOWN', CMD.UPDATE_KEYBOARD_CURSOR, STATE.SELECT_GROUP);
  expect((await probe4(game)).rectCursor).toMatchObject({ x: 216, y: 128 });
  await step(game, 'A', CMD.REPRINT_PHRASE, STATE.SELECT_GROUP);
  expect((await probe4(game)).buffer[0]).toBe(0xffff);
  await game.screenshot('easyChat-del');
  // B: the frame closes, the instructions and the bouncing cursor are back.
  await step(game, 'B', CMD.CLOSE_KEYBOARD, STATE.SELECT_FIELD);
  expect(await probe4(game)).toMatchObject({ frameAnimIdx: 0, rectCursor: null, modeAnim: null, helpX2: null, scrollArrows: { up: false, down: false } });
  expect((await probe(game))!.cursor!.bouncing).toBe(true);
});

test('MYSTERY EVENT IS EXCITING typed: EventScript_GaveSpecialProfile', async () => {
  const game = await openProfileScreen(PROFILE);
  await typeByGroup(game, 'EC_WORD_MYSTERY');
  await toField(game, 0, 1);
  await typeByKeyboard(game, 'EC_WORD_EVENT', 'E');
  await toField(game, 1, 2);
  await typeByGroup(game, 'EC_WORD_IS');
  await toField(game, 2, 3);
  await typeByKeyboard(game, 'EC_WORD_EXCITING', 'E', true);
  await game.screenshot('easyChat-mystery-event');
  await step(game, 'START', CMD.PROMPT_CONFIRM, STATE.CONFIRM_YES_NO);
  await game.press('A');
  await waitForField(game);
  // CompareProfileResponseWithPassphrase: VAR_0x8004 = 0, which the script checks before VAR_RESULT.
  expect(await untilMessage(game, /MYSTERY/, 'the profile in the message box')).toBe('MYSTERY EVENT IS EXCITING');
  // waitmessage, delay 80, msgbox: no input until Text_HeardThatBefore's \p, so wait for it without pressing (mashing A
  // here once went past its first page and on into talking to her again, "Please tell me more about yourself next
  // time!", until the test timed out)
  expect(await game.eval((t) => t.until(() => /heard that before/.test(t.message() ?? ''), 2000))).toBe(true);
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the script over', button: 'B' });
  expect(await game.eval((t) => t.var('VAR_TEMP_1'))).toBe(1);
  expect(await game.eval((t) => t.state!.easyChatProfile.slice(0, 4))).toEqual(await wordIds(game, ['EC_WORD_MYSTERY', 'EC_WORD_EVENT', 'EC_WORD_IS', 'EC_WORD_EXCITING']));
});

test('the Pewter Mart questionnaire: LINK TOGETHER WITH ALL enables Mystery Gift (EventScript_EnableMysteryGift)', async () => {
  // MB_QUESTIONNAIRE is the mart layout's (1, 4), on the counter's end (field_control_avatar.c → EventScript_Questionnaire).
  const game = await session.start({ start: 'after-rival', map: 'PewterCity_Mart', x: 1, y: 5 });
  await game.eval((t) => t.face('up'));
  // "Would you like to fill out a questionnaire?" YES, then the screen (EASY_CHAT_TYPE_QUESTIONNAIRE).
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_EasyChatScreen', { what: 'the Easy Chat screen' });
  await game.waitForScreen('CB2_EasyChatScreen');
  await game.screenshot('easyChat-questionnaire');
  await typeByGroup(game, 'EC_WORD_LINK');
  await toField(game, 0, 1);
  await typeByKeyboard(game, 'EC_WORD_TOGETHER', 'T', true);
  await toField(game, 1, 2);
  await typeByKeyboard(game, 'EC_WORD_WITH', 'W');
  await toField(game, 2, 3);
  await typeByGroup(game, 'EC_WORD_ALL');
  await game.screenshot('easyChat-questionnaire-typed');
  expect(await game.eval((t) => [...t.easyChat()!.screen!.ecWordBuffer])).toEqual(await wordIds(game, ['EC_WORD_LINK', 'EC_WORD_TOGETHER', 'EC_WORD_WITH', 'EC_WORD_ALL']));
  await game.press('START');
  await waitForCommand(game, CMD.PROMPT_CONFIRM, STATE.CONFIRM_YES_NO);
  await game.press('A');
  await waitForField(game);
  // CompareQuestionnaireResponseWithPassphrase: VAR_0x8004 = 0 → the clerk turns, "!", "You know those words?"
  await untilMessage(game, /those words/, 'Text_YouKnowThoseWords');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the script over', button: 'B' });
  expect(await game.eval((t) => t.flag('FLAG_SYS_MYSTERY_GIFT_ENABLED'))).toBe(true);
  expect(await game.eval((t) => t.flag('FLAG_SYS_SET_TRAINER_CARD_PROFILE'))).toBe(false);
});
