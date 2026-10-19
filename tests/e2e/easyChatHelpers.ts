// The Easy Chat screen's e2e helpers (easyChat.test.ts, mail.test.ts): its interface commands and input states, a
// press-and-wait `step`, and typing a word through its group or the A-Z keyboard from the field selection.

import { expect } from 'vitest';
import type { Game } from './harness';

/** Wait (in the page) until the screen has run interface command `cmd` and is back reading input in `state`. */
export async function waitForCommand(game: Game, cmd: number, state: number): Promise<void> {
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

export async function wordIds(game: Game, names: string[]): Promise<number[]> {
  return game.eval((t, n) => n.map((name: string) => t.state!.defines.require(name)), names);
}

// EC_CMD / EC_STATE (menus/easyChatScreenModel.ts)
export const CMD = {
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
export const STATE = { SELECT_FIELD: 0, SELECT_FOOTER: 1, SELECT_GROUP: 2, SELECT_WORD: 3, CANCEL_YES_NO: 4, DEL_ALL_YES_NO: 5, CONFIRM_YES_NO: 6 };

/**
 * Press `button` and wait (in the page) until the screen has run a new interface command, one of `cmds`, and is back
 * reading input in `state`; returns the command.
 */
export async function step(game: Game, button: Parameters<Game['press']>[0], cmds: number | number[], state: number): Promise<number> {
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
export function probe4(game: Game) {
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
export async function openKeyboard(game: Game, alpha: boolean): Promise<void> {
  await step(game, 'A', CMD.OPEN_KEYBOARD, STATE.SELECT_GROUP);
  if ((await probe4(game)).alpha !== alpha) await step(game, 'SELECT', CMD.SWITCH_KEYBOARD_MODE, STATE.SELECT_GROUP);
}

/** From the word list's top, move to `word` (rows with DOWN, or pages with SELECT when `page`) and place it with A. */
export async function pickWord(game: Game, word: number, page = false): Promise<void> {
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
export async function typeByGroup(game: Game, word: string): Promise<void> {
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
export const KEYBOARD = ['ABCDEF', 'GHIJKL', 'MNOPQRS', 'TUVWXYZ'];

/** From the field selection, type `word` through the A-Z keyboard (`letter`, its first letter). */
export async function typeByKeyboard(game: Game, word: string, letter: string, page = false): Promise<void> {
  const id = (await wordIds(game, [word]))[0];
  await openKeyboard(game, true);
  const row = KEYBOARD.findIndex((r) => r.includes(letter));
  const col = KEYBOARD[row].indexOf(letter);
  for (let r = 0; r < row; r++) await step(game, 'DOWN', CMD.UPDATE_KEYBOARD_CURSOR, STATE.SELECT_GROUP);
  for (let c = 0; c < col; c++) await step(game, 'RIGHT', CMD.UPDATE_KEYBOARD_CURSOR, STATE.SELECT_GROUP);
  await step(game, 'A', CMD.OPEN_WORD_SELECT, STATE.SELECT_WORD);
  await pickWord(game, id, page);
}
