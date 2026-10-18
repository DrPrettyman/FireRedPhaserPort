// easy_chat_2.c (menus/easyChatScreenModel.ts) driven with key presses, against cases worked by hand from the C:
// the cursor rules of each input state, the interface command ids they return, the word buffer, the YES/NO menus
// and what leaving writes (the saved words, VAR_RESULT, VAR_0x8004, FLAG_SYS_SET_TRAINER_CARD_PROFILE).

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { CopyEasyChatWord, DestroyEasyChatSelectionData, GetDisplayedWordByIndex, GetNumDisplayableGroups, GetNumDisplayedWords, GetSelectedGroupByIndex, GetUnlockedECWords, InitEasyChatSelection } from '../../src/menus/easyChat';
import { EC_GROUP, easyChatData } from '../../src/menus/easyChatData';
import {
  EC_CMD,
  EC_STATE,
  EasyChatScreen_HandleJoypad,
  EasyChat_AllocateResources,
  EasyChat_FreeResources,
  EasyChat_OnLeave,
  GetEasyChatConfirmCancelText,
  GetEasyChatConfirmText,
  GetEasyChatInstructionsText,
  GetEasyChatScreen,
  GetEasyChatScreenFrameId,
  GetEasyChatWordBuffer,
  GetEasyChatYesNoCursor,
  GetECSelectGroupCursorCoords,
  GetECSelectGroupRowsAbove,
  GetECSelectWordCursorCoords,
  GetECSelectWordNumRows,
  GetECSelectWordRowsAbove,
  GetMainCursorColumn,
  GetMainCursorRow,
  GetTitleText,
  IsEasyChatAlphaMode,
  ShouldDrawECDownArrow,
  ShouldDrawECUpArrow,
  type EasyChatScreen,
} from '../../src/menus/easyChatScreenModel';
import { newGame, type TestGame } from './gameData';

let t: TestGame;
const UNDEF = 0xffff;
const A = 0x01;
const B = 0x02;
const SELECT = 0x04;
const START = 0x08;
const RIGHT = 0x10;
const LEFT = 0x20;
const UP = 0x40;
const DOWN = 0x80;

beforeEach(() => {
  t = newGame();
});

afterEach(() => {
  EasyChat_FreeResources();
  DestroyEasyChatSelectionData();
});

const w = (name: string) => t.d(name);
const enc = (s: string) => t.charmap.encodePlain(s);
const s = (): EasyChatScreen => GetEasyChatScreen()!;

/** A new press of `key` (JOY_NEW and JOY_REPT). */
const press = (key: number) => EasyChatScreen_HandleJoypad({ newKeys: key, newAndRepeatedKeys: key });
/** `key` held past the repeat delay (JOY_REPT only). */
const repeat = (key: number) => EasyChatScreen_HandleJoypad({ newKeys: 0, newAndRepeatedKeys: key });
/** Several presses; the commands they returned. */
const presses = (...keys: number[]) => keys.map(press);

/** Task_InitEasyChatInternal's order: InitEasyChatSelection, then EasyChat_AllocateResources. */
function open(type: string, words: number[]) {
  InitEasyChatSelection(t.state);
  EasyChat_AllocateResources(t.state, w(`EASY_CHAT_TYPE_${type}`), words);
}

const cursor = () => [GetMainCursorColumn(), GetMainCursorRow()];
const groupCursor = () => GetECSelectGroupCursorCoords();
const wordCursor = () => GetECSelectWordCursorCoords();

/** sAlphabetLayout (easy_chat_2.c): the keyboard's wordsByLetter index by row and column. */
const ALPHABET = [
  [1, 2, 3, 4, 5, 6, 0],
  [7, 8, 9, 10, 11, 12],
  [13, 14, 15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24, 25, 26],
];

/** Move the word list's cursor down to `index` and press A (the list is open). */
function pickWordAt(index: number) {
  for (let row = 0; row < index >> 1; row++) expect(press(DOWN)).not.toBe(EC_CMD.NONE);
  if (index & 1) expect(press(RIGHT)).toBe(EC_CMD.UPDATE_WORD_SELECT_CURSOR);
  expect(press(A)).toBe(EC_CMD.CLOSE_WORD_SELECT);
}

/** From the fields, type `word` into the selected field through the A-Z keyboard. */
function typeWordAlpha(word: number) {
  expect(press(A)).toBe(EC_CMD.OPEN_KEYBOARD);
  if (!IsEasyChatAlphaMode()) expect(press(SELECT)).toBe(EC_CMD.SWITCH_KEYBOARD_MODE);
  const first = String.fromCharCode(CopyEasyChatWord(t.state, word)[0] - enc('A')[0] + 'A'.charCodeAt(0));
  const letter = first.charCodeAt(0) - 'A'.charCodeAt(0) + 1;
  const row = ALPHABET.findIndex((r) => r.includes(letter));
  const col = ALPHABET[row].indexOf(letter);
  for (let i = 0; i < row; i++) press(DOWN);
  for (let i = 0; i < col; i++) press(RIGHT);
  expect(groupCursor()).toEqual([col, row]);
  expect(press(A)).toBe(EC_CMD.OPEN_WORD_SELECT);
  const index = Array.from({ length: GetNumDisplayedWords() }, (_, i) => GetDisplayedWordByIndex(i)).indexOf(word);
  expect(index).toBeGreaterThanOrEqual(0);
  pickWordAt(index);
}

/** From the fields, type `word` into the selected field through the groups. */
function typeWordByGroup(word: number) {
  expect(press(A)).toBe(EC_CMD.OPEN_KEYBOARD);
  if (IsEasyChatAlphaMode()) expect(press(SELECT)).toBe(EC_CMD.SWITCH_KEYBOARD_MODE);
  const groupIndex = Array.from({ length: GetNumDisplayableGroups() }, (_, i) => GetSelectedGroupByIndex(i)).indexOf(EC_GROUP(word));
  for (let i = 0; i < groupIndex >> 1; i++) press(DOWN);
  if (groupIndex & 1) press(RIGHT);
  expect(press(A)).toBe(EC_CMD.OPEN_WORD_SELECT);
  const index = Array.from({ length: GetNumDisplayedWords() }, (_, i) => GetDisplayedWordByIndex(i)).indexOf(word);
  expect(index).toBeGreaterThanOrEqual(0);
  pickWordAt(index);
}

describe('EasyChat_AllocateResources', () => {
  test('the profile: 2x2, frame 0, a copy of the saved words', () => {
    const before = [...t.state.easyChatProfile];
    open('PROFILE', t.state.easyChatProfile);
    expect([s().numColumns, s().numRows, s().numWords, GetEasyChatScreenFrameId()]).toEqual([2, 2, 4, 0]);
    expect(GetTitleText()).toBe('gText_Profile');
    expect(GetEasyChatInstructionsText()).toEqual(['gText_CombineFourWordsOrPhrases', 'gText_AndMakeYourProfile']);
    expect(GetEasyChatConfirmText()).toEqual(['gText_YourProfile', 'gText_IsAsShownOkay']);
    expect(GetEasyChatConfirmCancelText()).toEqual(['gText_QuitEditing', null]);
    expect(GetEasyChatWordBuffer()).toEqual(before.slice(0, 4));
    expect(GetEasyChatWordBuffer()).not.toBe(t.state.easyChatProfile);
    expect([s().state, ...cursor(), IsEasyChatAlphaMode()]).toEqual([EC_STATE.SELECT_FIELD, 0, 0, false]);
    // 16 groups before any mon is seen (TRAINER..ADJECTIVES): (16 - 1) / 2 + 1 rows
    expect(s().selectGroupNumRows).toBe(8);
  });

  test('battle start 2x3 (frame 1), questionnaire 2x2, mail capped at 9 words, an unknown type gets the profile template', () => {
    open('BATTLE_START', t.state.easyChatBattleStart);
    expect([s().numColumns, s().numRows, s().numWords, GetEasyChatScreenFrameId()]).toEqual([2, 3, 6, 1]);
    open('QUESTIONNAIRE', t.state.questionnaireWords);
    expect([s().numWords, GetEasyChatScreenFrameId(), GetTitleText()]).toEqual([4, 0, 'gText_Questionnaire']);
    open('MAIL', new Array(9).fill(UNDEF));
    expect([s().numColumns, s().numRows, s().numWords, GetEasyChatScreenFrameId(), GetTitleText()]).toEqual([2, 5, 9, 2, null]);
    expect(GetEasyChatConfirmCancelText()).toEqual(['gText_StopGivingPkmnMail', null]);
    InitEasyChatSelection(t.state);
    EasyChat_AllocateResources(t.state, 8, [UNDEF, UNDEF, UNDEF, UNDEF]);
    expect(s().templateId).toBe(0);
  });

  test('17 groups once a mon is seen: 9 rows', () => {
    t.state.setDexFlags(t.pokemon.nationalDex(w('SPECIES_PIKACHU')), true, false);
    open('PROFILE', t.state.easyChatProfile);
    expect(s().selectGroupNumRows).toBe(9);
  });
});

describe('the fields and the footer (HandleJoypad_SelectField / _SelectFooter)', () => {
  test('left / right wrap on a row; past the last row is the footer, which keeps the column', () => {
    open('PROFILE', t.state.easyChatProfile);
    expect(press(RIGHT)).toBe(EC_CMD.UPDATE_MAIN_CURSOR);
    expect(cursor()).toEqual([1, 0]);
    expect(press(RIGHT)).toBe(EC_CMD.UPDATE_MAIN_CURSOR);
    expect(cursor()).toEqual([0, 0]);
    press(LEFT);
    expect(cursor()).toEqual([1, 0]);
    press(DOWN);
    expect(cursor()).toEqual([1, 1]);
    expect(press(DOWN)).toBe(EC_CMD.UPDATE_MAIN_CURSOR_ON_BUTTONS);
    expect([s().state, ...cursor()]).toEqual([EC_STATE.SELECT_FOOTER, 1, 2]); // on CANCEL
    expect(press(0)).toBe(EC_CMD.NONE);
  });

  test('the footer: left / right wrap over DEL ALL, CANCEL, OK; up to the last row (column clamped), down to the first', () => {
    open('PROFILE', t.state.easyChatProfile);
    press(UP); // row 0 → numRows: the footer
    expect([s().state, ...cursor()]).toEqual([EC_STATE.SELECT_FOOTER, 0, 2]);
    expect(presses(RIGHT, RIGHT)).toEqual([EC_CMD.UPDATE_MAIN_CURSOR_ON_BUTTONS, EC_CMD.UPDATE_MAIN_CURSOR_ON_BUTTONS]);
    expect(cursor()).toEqual([2, 2]);
    press(RIGHT);
    expect(cursor()).toEqual([0, 2]);
    press(LEFT);
    expect(cursor()).toEqual([2, 2]);
    expect(press(UP)).toBe(EC_CMD.UPDATE_MAIN_CURSOR);
    expect([s().state, ...cursor()]).toEqual([EC_STATE.SELECT_FIELD, 1, 1]); // OK's column 2 → the last field column
    press(DOWN); // footer again, column 1
    expect(press(DOWN)).toBe(EC_CMD.UPDATE_MAIN_CURSOR);
    expect([s().state, ...cursor()]).toEqual([EC_STATE.SELECT_FIELD, 1, 0]);
  });

  test('the field cursor ignores held keys (JOY_NEW only)', () => {
    open('PROFILE', t.state.easyChatProfile);
    expect(repeat(RIGHT)).toBe(EC_CMD.NONE);
    expect(cursor()).toEqual([0, 0]);
  });

  test("the mail frame's last row has one field", () => {
    open('MAIL', new Array(9).fill(UNDEF));
    press(RIGHT);
    presses(DOWN, DOWN, DOWN);
    expect(cursor()).toEqual([1, 3]);
    press(DOWN);
    expect(cursor()).toEqual([0, 4]);
    expect(press(RIGHT)).toBe(EC_CMD.UPDATE_MAIN_CURSOR); // column 1 → 0 again
    expect(cursor()).toEqual([0, 4]);
  });
});

describe('the groups (HandleJoypad_SelectGroup)', () => {
  test('A on a field opens the groups at the top left; B or CANCEL closes them', () => {
    open('PROFILE', t.state.easyChatProfile);
    press(RIGHT);
    expect(press(A)).toBe(EC_CMD.OPEN_KEYBOARD);
    expect([s().state, ...groupCursor(), GetECSelectGroupRowsAbove()]).toEqual([EC_STATE.SELECT_GROUP, 0, 0, 0]);
    expect(press(B)).toBe(EC_CMD.CLOSE_KEYBOARD);
    expect([s().state, ...cursor()]).toEqual([EC_STATE.SELECT_FIELD, 1, 0]);
    press(A);
    press(LEFT); // into the blue box on MODE
    presses(DOWN, DOWN); // CANCEL
    expect(groupCursor()).toEqual([-1, 2]);
    expect(press(A)).toBe(EC_CMD.CLOSE_KEYBOARD);
    expect(s().state).toBe(EC_STATE.SELECT_FIELD);
  });

  test('group mode: four rows on screen, scrolling with arrows, no wrap', () => {
    open('PROFILE', t.state.easyChatProfile); // 16 groups: 8 rows
    press(A);
    expect(ShouldDrawECUpArrow()).toBe(false);
    expect(ShouldDrawECDownArrow()).toBe(true);
    expect(press(UP)).toBe(EC_CMD.NONE);
    expect([repeat(DOWN), repeat(DOWN), repeat(DOWN)]).toEqual([EC_CMD.UPDATE_KEYBOARD_CURSOR, EC_CMD.UPDATE_KEYBOARD_CURSOR, EC_CMD.UPDATE_KEYBOARD_CURSOR]);
    expect(groupCursor()).toEqual([0, 3]);
    expect(repeat(DOWN)).toBe(EC_CMD.GROUP_NAMES_SCROLL_DOWN);
    expect([...groupCursor(), GetECSelectGroupRowsAbove()]).toEqual([0, 3, 1]);
    expect(ShouldDrawECUpArrow()).toBe(true);
    presses(DOWN, DOWN, DOWN);
    expect(GetECSelectGroupRowsAbove()).toBe(4); // row 7, the last
    expect(ShouldDrawECDownArrow()).toBe(false);
    expect(press(DOWN)).toBe(EC_CMD.NONE);
    presses(UP, UP, UP);
    expect([...groupCursor(), GetECSelectGroupRowsAbove()]).toEqual([0, 0, 4]);
    expect(press(UP)).toBe(EC_CMD.GROUP_NAMES_SCROLL_UP);
    expect([...groupCursor(), GetECSelectGroupRowsAbove()]).toEqual([0, 0, 3]);
  });

  test("group mode: an odd last group; right off a row's end and left off its start go into the blue box", () => {
    t.state.setDexFlags(t.pokemon.nationalDex(w('SPECIES_PIKACHU')), true, false);
    open('PROFILE', t.state.easyChatProfile); // 17 groups: row 8 has POKéMON's 17th... one group
    press(A);
    press(RIGHT);
    expect(groupCursor()).toEqual([1, 0]);
    for (let i = 0; i < 8; i++) press(DOWN);
    // down onto row 8 (index 17 doesn't exist) moves the cursor to column 0
    expect([...groupCursor(), GetECSelectGroupRowsAbove()]).toEqual([0, 3, 5]);
    expect(press(RIGHT)).toBe(EC_CMD.UPDATE_KEYBOARD_CURSOR); // index 17: too far right → the blue box, row 3 → button 2
    expect(groupCursor()).toEqual([-1, 2]);
    expect(press(RIGHT)).toBe(EC_CMD.UPDATE_KEYBOARD_CURSOR); // out of the box: column 0 of the row below the button
    expect(groupCursor()).toEqual([0, 3]);
    press(LEFT);
    expect(groupCursor()).toEqual([-1, 2]);
    press(LEFT); // GroupCursorWrapAroundLeft: row 3, column 1 → 0 (no 18th group)
    expect(groupCursor()).toEqual([0, 3]);
  });

  test('the blue box: up / down wrap over MODE, DEL, CANCEL; rows 0-1 map to MODE', () => {
    open('PROFILE', t.state.easyChatProfile);
    press(A);
    press(DOWN);
    press(LEFT); // row 1 → button 0
    expect(groupCursor()).toEqual([-1, 0]);
    expect(press(UP)).toBe(EC_CMD.UPDATE_KEYBOARD_CURSOR);
    expect(groupCursor()).toEqual([-1, 2]);
    press(DOWN);
    expect(groupCursor()).toEqual([-1, 0]);
    press(LEFT); // wrap left onto row 1, column 1
    expect(groupCursor()).toEqual([1, 1]);
    press(RIGHT); // column 1's right: the blue box again
    expect(groupCursor()).toEqual([-1, 0]);
  });

  test('DEL on the blue box empties the selected field and keeps the groups open', () => {
    open('PROFILE', t.state.easyChatProfile);
    const before = [...GetEasyChatWordBuffer()];
    press(RIGHT);
    press(A);
    press(LEFT);
    press(DOWN); // DEL
    expect(press(A)).toBe(EC_CMD.REPRINT_PHRASE);
    expect(GetEasyChatWordBuffer()).toEqual([before[0], UNDEF, before[2], before[3]]);
    expect(s().state).toBe(EC_STATE.SELECT_GROUP);
    expect(t.state.easyChatProfile.slice(0, 4)).toEqual(before); // not saved yet
  });

  test('MODE / SELECT switch to the keyboard and back, the cursor reset each time; the mode stays for the next field', () => {
    open('PROFILE', t.state.easyChatProfile);
    press(A);
    press(DOWN);
    press(LEFT);
    expect(press(A)).toBe(EC_CMD.SWITCH_KEYBOARD_MODE); // MODE
    expect([IsEasyChatAlphaMode(), ...groupCursor(), GetECSelectGroupRowsAbove()]).toEqual([true, 0, 0, 0]);
    press(B);
    press(RIGHT);
    press(A);
    expect(IsEasyChatAlphaMode()).toBe(true);
    expect(press(SELECT)).toBe(EC_CMD.SWITCH_KEYBOARD_MODE);
    expect(IsEasyChatAlphaMode()).toBe(false);
  });

  test('the keyboard: rows of 7, 6, 7, 7 keys; up / down wrap; left / right off the ends go into the blue box', () => {
    open('PROFILE', t.state.easyChatProfile);
    press(A);
    press(SELECT);
    expect(press(UP)).toBe(EC_CMD.UPDATE_KEYBOARD_CURSOR);
    expect(groupCursor()).toEqual([0, 3]);
    press(DOWN);
    expect(groupCursor()).toEqual([0, 0]);
    for (let i = 0; i < 6; i++) press(RIGHT);
    expect(groupCursor()).toEqual([6, 0]); // "others"
    press(DOWN);
    expect(groupCursor()).toEqual([5, 1]); // L: row 1's last key
    press(RIGHT);
    expect(groupCursor()).toEqual([-1, 0]);
    press(DOWN); // DEL
    press(LEFT); // GroupCursorWrapAroundLeft: row 2's last key
    expect(groupCursor()).toEqual([6, 2]);
    press(UP);
    press(UP);
    expect(groupCursor()).toEqual([5, 0]);
    for (let i = 0; i < 5; i++) press(LEFT);
    press(LEFT);
    expect(groupCursor()).toEqual([-1, 0]);
    expect([ShouldDrawECUpArrow(), ShouldDrawECDownArrow()]).toEqual([false, false]);
  });

  test('a letter without unlocked words does nothing (OpenSelectedGroup returns 0)', () => {
    open('PROFILE', t.state.easyChatProfile);
    press(A);
    press(SELECT);
    const keys = ALPHABET.flatMap((r, row) => r.map((letter, col) => ({ letter, row, col })));
    const empty = keys.find(({ letter }) => {
      GetUnlockedECWords(true, letter);
      return GetNumDisplayedWords() === 0;
    });
    expect(empty).toBeDefined();
    for (let i = 0; i < empty!.row; i++) press(DOWN);
    for (let i = 0; i < empty!.col; i++) press(RIGHT);
    expect(press(A)).toBe(EC_CMD.NONE);
    expect(s().state).toBe(EC_STATE.SELECT_GROUP);
  });
});

describe('the words (HandleJoypad_SelectWord)', () => {
  /** Open TRAINER (the first group before any mon is seen): 25 words, rows 0-12. */
  function openTrainer() {
    open('PROFILE', t.state.easyChatProfile);
    press(A);
    expect(GetSelectedGroupByIndex(0)).toBe(w('EC_GROUP_TRAINER'));
    expect(press(A)).toBe(EC_CMD.OPEN_WORD_SELECT);
    expect([s().state, GetNumDisplayedWords(), GetECSelectWordNumRows(), GetECSelectWordRowsAbove(), ...wordCursor()]).toEqual([EC_STATE.SELECT_WORD, 25, 12, 0, 0, 0]);
  }

  test('down scrolls past row 3; page down / up by four rows, clamped; the cursor keeps to the words', () => {
    openTrainer();
    expect(ShouldDrawECUpArrow()).toBe(false);
    expect(ShouldDrawECDownArrow()).toBe(true);
    press(RIGHT);
    expect([repeat(DOWN), repeat(DOWN), repeat(DOWN), repeat(DOWN)]).toEqual([17, 17, 17, EC_CMD.WORD_SELECT_SCROLL_DOWN]);
    expect([...wordCursor(), GetECSelectWordRowsAbove()]).toEqual([1, 3, 1]);
    expect(press(SELECT)).toBe(EC_CMD.WORD_SELECT_PAGE_DOWN);
    expect(GetECSelectWordRowsAbove()).toBe(5);
    expect(press(SELECT)).toBe(EC_CMD.WORD_SELECT_PAGE_DOWN); // 9 > 12 - 3? no: 9
    expect(GetECSelectWordRowsAbove()).toBe(9);
    // row 12 has one word (index 24): column 1 would be index 25 → column 0
    expect(wordCursor()).toEqual([0, 3]);
    expect([ShouldDrawECUpArrow(), ShouldDrawECDownArrow()]).toEqual([true, false]);
    expect(press(SELECT)).toBe(EC_CMD.NONE); // 9 <= 12 - 4 fails
    expect(press(DOWN)).toBe(EC_CMD.NONE);
    expect(press(RIGHT)).toBe(EC_CMD.UPDATE_WORD_SELECT_CURSOR); // to index 25: wraps to column 0
    expect(wordCursor()).toEqual([0, 3]);
    expect(press(LEFT)).toBe(EC_CMD.UPDATE_WORD_SELECT_CURSOR); // to column 1, then back
    expect(wordCursor()).toEqual([0, 3]);
    expect(presses(START, START, START, START)).toEqual([EC_CMD.WORD_SELECT_PAGE_UP, EC_CMD.WORD_SELECT_PAGE_UP, EC_CMD.WORD_SELECT_PAGE_UP, EC_CMD.NONE]);
    expect(GetECSelectWordRowsAbove()).toBe(0); // 9 → 5 → 1 → 0
    presses(UP, UP, UP);
    expect(wordCursor()).toEqual([0, 0]);
    expect(press(UP)).toBe(EC_CMD.NONE);
  });

  test('up from the top row on screen scrolls up', () => {
    openTrainer();
    for (let i = 0; i < 5; i++) press(DOWN);
    expect([...wordCursor(), GetECSelectWordRowsAbove()]).toEqual([0, 3, 2]);
    presses(UP, UP, UP);
    expect(press(UP)).toBe(EC_CMD.WORD_SELECT_SCROLL_UP);
    expect([...wordCursor(), GetECSelectWordRowsAbove()]).toEqual([0, 0, 1]);
  });

  test('page down on a short list (9 words, rows 0-4) lands one row down', () => {
    open('PROFILE', t.state.easyChatProfile);
    press(A);
    press(SELECT);
    for (let i = 0; i < 6; i++) press(RIGHT); // "others"
    press(A);
    expect([GetNumDisplayedWords(), GetECSelectWordNumRows()]).toEqual([9, 4]);
    expect(press(SELECT)).toBe(EC_CMD.WORD_SELECT_PAGE_DOWN); // 0 <= 0: 4, clamped to 4 - 3
    expect(GetECSelectWordRowsAbove()).toBe(1);
    expect(press(SELECT)).toBe(EC_CMD.NONE);
  });

  test('A places the word in the field and goes back to the fields; B goes back to the groups', () => {
    openTrainer();
    expect(press(B)).toBe(EC_CMD.RETURN_TO_KEYBOARD);
    expect(s().state).toBe(EC_STATE.SELECT_GROUP);
    press(A);
    press(DOWN);
    press(RIGHT); // index 3: ENCYCLOPEDIA
    expect(press(A)).toBe(EC_CMD.CLOSE_WORD_SELECT);
    expect(s().state).toBe(EC_STATE.SELECT_FIELD);
    expect(CopyEasyChatWord(t.state, GetEasyChatWordBuffer()[0])).toEqual(enc('ENCYCLOPEDIA'));
  });
});

describe('the YES/NO menus, leaving and what is saved', () => {
  const MYSTERY_EVENT = () => ['MYSTERY', 'EVENT', 'IS', 'EXCITING'].map((n) => w(`EC_WORD_${n}`));
  const LINK_TOGETHER = () => ['LINK', 'TOGETHER', 'WITH', 'ALL'].map((n) => w(`EC_WORD_${n}`));

  test('the passphrases are the extracted ones', () => {
    expect(easyChatData().passphrases.sECPhrase_MysteryEventIsExciting).toEqual(MYSTERY_EVENT());
    expect(easyChatData().passphrases.sECPhrase_LinkTogetherWithAll).toEqual(LINK_TOGETHER());
  });

  test('B → "Quit editing?" on NO: A on NO and B go back; YES leaves with VAR_RESULT 0 and nothing saved', () => {
    open('PROFILE', t.state.easyChatProfile);
    const saved = [...t.state.easyChatProfile];
    typeWordByGroup(w('EC_WORD_RED'));
    expect(press(B)).toBe(EC_CMD.PROMPT_EXIT);
    expect([s().state, GetEasyChatYesNoCursor()]).toEqual([EC_STATE.CANCEL_YES_NO, 1]);
    expect(press(A)).toBe(EC_CMD.CLOSE_PROMPT);
    expect(s().state).toBe(EC_STATE.SELECT_FIELD);
    press(B);
    expect(press(B)).toBe(EC_CMD.CLOSE_PROMPT);
    press(B);
    expect(press(UP)).toBe(EC_CMD.NONE);
    expect(press(UP)).toBe(EC_CMD.NONE); // no wrap
    expect(GetEasyChatYesNoCursor()).toBe(0);
    t.state.setVar('VAR_RESULT', 7);
    expect(press(A)).toBe(EC_CMD.EXIT);
    expect(t.state.getVar('VAR_RESULT')).toBe(0);
    expect(t.state.easyChatProfile).toEqual(saved);
  });

  test('CANCEL on the footer returns to the footer on NO', () => {
    open('PROFILE', t.state.easyChatProfile);
    press(UP);
    press(RIGHT); // CANCEL
    expect(press(A)).toBe(EC_CMD.PROMPT_EXIT);
    expect(press(A)).toBe(EC_CMD.CLOSE_PROMPT);
    expect([s().state, ...cursor()]).toEqual([EC_STATE.SELECT_FOOTER, 1, 2]);
  });

  test('START → confirm on YES: the words saved, VAR_RESULT 1 when changed; the profile flag and VAR_0x8004 on leaving', () => {
    open('PROFILE', t.state.easyChatProfile);
    const saved = [...t.state.easyChatProfile];
    press(DOWN);
    press(RIGHT);
    typeWordByGroup(w('EC_WORD_RED'));
    expect(press(START)).toBe(EC_CMD.PROMPT_CONFIRM);
    expect([s().state, GetEasyChatYesNoCursor()]).toEqual([EC_STATE.CONFIRM_YES_NO, 0]);
    expect(press(A)).toBe(EC_CMD.EXIT);
    expect(t.state.getVar('VAR_RESULT')).toBe(1);
    expect(t.state.easyChatProfile).toEqual([saved[0], saved[1], saved[2], w('EC_WORD_RED'), saved[4], saved[5]]);
    expect(t.state.getFlag('FLAG_SYS_SET_TRAINER_CARD_PROFILE')).toBe(false);
    EasyChat_OnLeave();
    expect(t.state.getFlag('FLAG_SYS_SET_TRAINER_CARD_PROFILE')).toBe(true);
    expect(t.state.getVar('VAR_0x8004')).toBe(1);
  });

  test('confirm without changes: VAR_RESULT 0; NO goes back to where START was pressed', () => {
    open('PROFILE', t.state.easyChatProfile);
    press(UP); // footer
    press(START);
    expect(press(DOWN)).toBe(EC_CMD.NONE);
    expect(press(A)).toBe(EC_CMD.CLOSE_PROMPT); // NO
    expect(s().state).toBe(EC_STATE.SELECT_FOOTER);
    press(START);
    t.state.setVar('VAR_RESULT', 7);
    expect(press(A)).toBe(EC_CMD.EXIT);
    expect(t.state.getVar('VAR_RESULT')).toBe(0);
  });

  test('DEL ALL on NO; YES empties every field (unsaved); then OK with every field empty asks to quit', () => {
    open('PROFILE', t.state.easyChatProfile);
    const saved = [...t.state.easyChatProfile];
    press(UP); // footer on DEL ALL
    expect(press(A)).toBe(EC_CMD.PROMPT_DELETE_ALL);
    expect([s().state, GetEasyChatYesNoCursor()]).toEqual([EC_STATE.DEL_ALL_YES_NO, 1]);
    expect(press(A)).toBe(EC_CMD.CLOSE_PROMPT);
    expect(GetEasyChatWordBuffer()).toEqual(saved.slice(0, 4));
    press(A);
    press(UP);
    expect(press(A)).toBe(EC_CMD.CLOSE_PROMPT_AFTER_DELETE);
    expect([s().state, ...GetEasyChatWordBuffer()]).toEqual([EC_STATE.SELECT_FOOTER, UNDEF, UNDEF, UNDEF, UNDEF]);
    presses(RIGHT, RIGHT); // OK
    expect(press(A)).toBe(EC_CMD.PROMPT_EXIT);
    expect(s().state).toBe(EC_STATE.CANCEL_YES_NO);
    press(UP);
    expect(press(A)).toBe(EC_CMD.EXIT);
    expect(t.state.easyChatProfile).toEqual(saved);
  });

  test('the screen can pass its own YES/NO input (Menu_ProcessInputNoWrapClearOnChoose)', () => {
    InitEasyChatSelection(t.state);
    const results = [-2, -2, 0];
    EasyChat_AllocateResources(t.state, w('EASY_CHAT_TYPE_PROFILE'), t.state.easyChatProfile, { processYesNoInput: () => results.shift()! });
    press(B);
    expect([press(0), press(0), press(0)]).toEqual([EC_CMD.NONE, EC_CMD.NONE, EC_CMD.EXIT]);
  });

  test('the profile MYSTERY EVENT IS EXCITING through the keyboard: VAR_0x8004 0', () => {
    open('PROFILE', t.state.easyChatProfile);
    const [mystery, event, is, exciting] = MYSTERY_EVENT();
    typeWordAlpha(mystery);
    press(RIGHT);
    typeWordAlpha(event);
    press(DOWN);
    press(LEFT);
    typeWordAlpha(is);
    press(RIGHT);
    typeWordAlpha(exciting);
    expect(GetEasyChatWordBuffer()).toEqual(MYSTERY_EVENT());
    press(START);
    expect(press(A)).toBe(EC_CMD.EXIT);
    EasyChat_OnLeave();
    expect(t.state.easyChatProfile.slice(0, 4)).toEqual(MYSTERY_EVENT());
    expect([t.state.getVar('VAR_RESULT'), t.state.getVar('VAR_0x8004')]).toEqual([1, 0]);
  });

  test('the questionnaire LINK TOGETHER WITH ALL through the groups: saved, VAR_0x8004 0, no profile flag', () => {
    open('QUESTIONNAIRE', t.state.questionnaireWords);
    LINK_TOGETHER().forEach((word, i) => {
      if (i === 1 || i === 3) press(RIGHT);
      if (i === 2) presses(DOWN, LEFT);
      typeWordByGroup(word);
    });
    press(START);
    press(A);
    EasyChat_OnLeave();
    expect(t.state.questionnaireWords).toEqual(LINK_TOGETHER());
    expect([t.state.getVar('VAR_RESULT'), t.state.getVar('VAR_0x8004')]).toEqual([1, 0]);
    expect(t.state.getFlag('FLAG_SYS_SET_TRAINER_CARD_PROFILE')).toBe(false);
  });

  test('cancelling still compares the edited words: the questionnaire passphrase typed then quit sets VAR_0x8004 0', () => {
    open('QUESTIONNAIRE', t.state.questionnaireWords);
    LINK_TOGETHER().forEach((word, i) => {
      if (i === 1 || i === 3) press(RIGHT);
      if (i === 2) presses(DOWN, LEFT);
      typeWordByGroup(word);
    });
    press(B);
    press(UP);
    expect(press(A)).toBe(EC_CMD.EXIT);
    EasyChat_OnLeave();
    expect(t.state.questionnaireWords).toEqual([UNDEF, UNDEF, UNDEF, UNDEF]);
    expect([t.state.getVar('VAR_RESULT'), t.state.getVar('VAR_0x8004')]).toEqual([0, 0]);
  });

  test('a cancelled profile still sets FLAG_SYS_SET_TRAINER_CARD_PROFILE; another phrase gives VAR_0x8004 1', () => {
    open('PROFILE', t.state.easyChatProfile);
    press(B);
    press(UP);
    press(A);
    EasyChat_OnLeave();
    expect(t.state.getFlag('FLAG_SYS_SET_TRAINER_CARD_PROFILE')).toBe(true);
    expect(t.state.getVar('VAR_0x8004')).toBe(1);
  });

  test('battle start: six words, saved in place', () => {
    open('BATTLE_START', t.state.easyChatBattleStart);
    presses(DOWN, DOWN, RIGHT);
    expect(cursor()).toEqual([1, 2]);
    typeWordByGroup(w('EC_WORD_RED'));
    press(START);
    press(A);
    expect(t.state.easyChatBattleStart[5]).toBe(w('EC_WORD_RED'));
  });
});
