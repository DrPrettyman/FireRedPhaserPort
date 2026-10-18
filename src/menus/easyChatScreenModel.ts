// easy_chat_2.c without graphics: the Easy Chat screen's state (struct EasyChatScreen, sEasyChatScreen), the joypad
// handlers of its seven input states, which return the interface command id easy_chat_3.c runs (EC_CMD below), the
// cursor rules (the phrase fields and the footer, the groups / A-Z keyboard with the "blue box" of MODE / DEL / CANCEL
// buttons on its left, the word list with rows scrolled above), the word buffer the screen edits (set, delete, DEL
// ALL, confirm writing it back), the getters the screen draws from, and the passphrase compares Task_RunEasyChat
// does on leaving.
//
// No Phaser and no GBA layer: the keys come in as GBA key bits (`EasyChatKeys`), and the YES/NO menus' input is
// menu.c's Menu_ProcessInputNoWrapClearOnChoose, which the screen passes in (EasyChat_AllocateResources' options);
// without one, a model of it (two items, no wrap) reads the same keys. The task / CB2 wiring (DoEasyChatScreen,
// Task_InitEasyChat, Task_RunEasyChat's fades, DismantleEasyChat) belongs to the screen (menus/easyChat*.ts, unit 3),
// which calls, in order: InitEasyChatSelection(state), EasyChat_AllocateResources, then each frame
// EasyChatScreen_HandleJoypad until it returns EC_CMD.EXIT, then (after the fade) EasyChat_OnLeave and
// EasyChat_FreeResources / DestroyEasyChatSelectionData.

import type { GameState } from '../state/GameState';
import { GetDisplayedWordByIndex, GetNumDisplayableGroups, GetNumDisplayedWords, GetSelectedGroupByIndex, GetUnlockedECWords } from './easyChat';
import { EC, easyChatData, type EasyChatScreenTemplate } from './easyChatData';

// include/gba/io_reg.h's key bits (the same values as gba/main.ts, not imported to keep this module off the GBA layer)
const A_BUTTON = 0x0001;
const B_BUTTON = 0x0002;
const SELECT_BUTTON = 0x0004;
const START_BUTTON = 0x0008;
const DPAD_RIGHT = 0x0010;
const DPAD_LEFT = 0x0020;
const DPAD_UP = 0x0040;
const DPAD_DOWN = 0x0080;

// menu.h
const MENU_NOTHING_CHOSEN = -2;
const MENU_B_PRESSED = -1;

/** The keys a frame's joypad handler reads: gMain.newKeys (JOY_NEW) and gMain.newAndRepeatedKeys (JOY_REPT). */
export interface EasyChatKeys {
  newKeys: number;
  newAndRepeatedKeys: number;
}

/**
 * The interface command ids EasyChatScreen_HandleJoypad returns (easy_chat_3.c's ECInterfaceCmd_01-22, run by
 * EasyChatInterfaceCommand_Setup / _Run), and 23, which Task_RunEasyChat takes as "fade out and leave". FRLG
 * numbers them; the names are pokeemerald's ECFUNC_* (which has one more, PROMPT_CONFIRM_LYRICS, after 12).
 */
export const EC_CMD = {
  NONE: 0,
  /** ECInterfaceCmd_01: reprint the fields (DEL on the blue box cleared the selected field) */
  REPRINT_PHRASE: 1,
  /** ECInterfaceCmd_02: the triangle cursor to the selected field */
  UPDATE_MAIN_CURSOR: 2,
  /** ECInterfaceCmd_03: the triangle cursor to a footer button (DEL ALL / CANCEL / OK) */
  UPDATE_MAIN_CURSOR_ON_BUTTONS: 3,
  /** ECInterfaceCmd_04: "All the text being edited will be deleted" + YES/NO (cursor on NO) */
  PROMPT_DELETE_ALL: 4,
  /** ECInterfaceCmd_05: "Quit editing?" + YES/NO (cursor on NO) */
  PROMPT_EXIT: 5,
  /** ECInterfaceCmd_06: the confirm text + YES/NO (cursor on YES) */
  PROMPT_CONFIRM: 6,
  /** ECInterfaceCmd_07: close the YES/NO, the instructions back */
  CLOSE_PROMPT: 7,
  /** ECInterfaceCmd_08: close the YES/NO after DEL ALL, reprint the fields */
  CLOSE_PROMPT_AFTER_DELETE: 8,
  /** ECInterfaceCmd_09: open the groups / keyboard window */
  OPEN_KEYBOARD: 9,
  /** ECInterfaceCmd_10: close it, back to the fields */
  CLOSE_KEYBOARD: 10,
  /** ECInterfaceCmd_11: open the word list */
  OPEN_WORD_SELECT: 11,
  /** ECInterfaceCmd_12: close the word list and print the placed word */
  CLOSE_WORD_SELECT: 12,
  /** ECInterfaceCmd_13: from the word list back to the groups / keyboard */
  RETURN_TO_KEYBOARD: 13,
  /** ECInterfaceCmd_14: the rectangle cursor moved on the groups / keyboard / blue box */
  UPDATE_KEYBOARD_CURSOR: 14,
  /** ECInterfaceCmd_15: the group names scroll down a row */
  GROUP_NAMES_SCROLL_DOWN: 15,
  /** ECInterfaceCmd_16: the group names scroll up a row */
  GROUP_NAMES_SCROLL_UP: 16,
  /** ECInterfaceCmd_17: the cursor moved on the word list */
  UPDATE_WORD_SELECT_CURSOR: 17,
  /** ECInterfaceCmd_18: the word list scrolls up a row */
  WORD_SELECT_SCROLL_UP: 18,
  /** ECInterfaceCmd_19: the word list scrolls down a row */
  WORD_SELECT_SCROLL_DOWN: 19,
  /** ECInterfaceCmd_20: the word list a page up (START) */
  WORD_SELECT_PAGE_UP: 20,
  /** ECInterfaceCmd_21: the word list a page down (SELECT) */
  WORD_SELECT_PAGE_DOWN: 21,
  /** ECInterfaceCmd_22: switch between the groups and the A-Z keyboard (MODE / SELECT) */
  SWITCH_KEYBOARD_MODE: 22,
  /** Task_RunEasyChat: fade out and leave */
  EXIT: 23,
} as const;

/** sEasyChatScreen->state: the input states (EasyChatScreen_HandleJoypad's switch). */
export const EC_STATE = {
  SELECT_FIELD: 0,
  SELECT_FOOTER: 1,
  SELECT_GROUP: 2,
  SELECT_WORD: 3,
  CANCEL_YES_NO: 4,
  DEL_ALL_YES_NO: 5,
  CONFIRM_YES_NO: 6,
} as const;

/** struct EasyChatScreen (plus the GameState the C reaches through globals, and the YES/NO input). */
export interface EasyChatScreen {
  type: number;
  templateId: number;
  numColumns: number;
  numRows: number;
  /** EC_STATE */
  state: number;
  /** s8: 0..numColumns-1 on the fields, 0-2 (DEL ALL / CANCEL / OK) on the footer */
  mainCursorColumn: number;
  /** s8: numRows = on the footer */
  mainCursorRow: number;
  numWords: number;
  stateBackup: number;
  isAlphaMode: boolean;
  /** s8: -1 = in the blue box (MODE / DEL / CANCEL by selectGroupCursorY) */
  selectGroupCursorX: number;
  /** s8: the row on screen (0-3), or the blue box button (0-2) */
  selectGroupCursorY: number;
  selectGroupRowsAbove: number;
  selectGroupNumRows: number;
  selectWordRowsAbove: number;
  /** the last row's index ((numDisplayedWords - 1) / 2), not a count */
  selectWordNumRows: number;
  selectWordCursorX: number;
  selectWordCursorY: number;
  /** the saved words the screen edits (CommitECWords writes into this array) */
  words: number[];
  /** the words being edited (u16 ecWordBuffer[9]) */
  ecWordBuffer: number[];
  gameState: GameState;
  /** Menu_ProcessInputNoWrapClearOnChoose, or undefined for the built-in model (yesNoCursor) */
  processYesNoInput?: () => number;
  /** The built-in YES/NO's cursor (0 = YES, 1 = NO), from easy_chat_3.c's initial positions. */
  yesNoCursor: number;
}

export interface EasyChatAllocateOptions {
  /**
   * menu.c's Menu_ProcessInputNoWrapClearOnChoose for the YES/NO the screen draws (ECInterfaceCmd_04-06's
   * EC_CreateYesNoMenuWithInitialCursorPos). Returns 0 (YES), 1 (NO), MENU_B_PRESSED (-1) or MENU_NOTHING_CHOSEN (-2).
   */
  processYesNoInput?: () => number;
}

let sEasyChatScreen: EasyChatScreen | null = null;

function scr(): EasyChatScreen {
  if (!sEasyChatScreen) throw new Error('[easy chat] no screen (EasyChat_AllocateResources)');
  return sEasyChatScreen;
}

/** The screen's state, or null when none is allocated (for the screen's probes and the tests). */
export function GetEasyChatScreen(): EasyChatScreen | null {
  return sEasyChatScreen;
}

function templates(): EasyChatScreenTemplate[] {
  return easyChatData().screenTemplates;
}

function tmpl(): EasyChatScreenTemplate {
  return templates()[scr().templateId];
}

/**
 * EasyChat_AllocateResources: the screen's state for `type` (EASY_CHAT_TYPE_*), editing a copy of `words` (at most 9).
 * Reads GetNumDisplayableGroups, so InitEasyChatSelection(state) must have run (Task_InitEasyChatInternal's order).
 */
export function EasyChat_AllocateResources(state: GameState, type: number, words: number[], options: EasyChatAllocateOptions = {}): boolean {
  const templateId = GetEasyChatScreenTemplateId(type);
  const t = templates()[templateId];
  const numWords = Math.min(t.numColumns * t.numRows, 9);
  sEasyChatScreen = {
    type,
    templateId,
    numColumns: t.numColumns,
    numRows: t.numRows,
    state: EC_STATE.SELECT_FIELD,
    mainCursorColumn: 0,
    mainCursorRow: 0,
    numWords,
    stateBackup: 0,
    isAlphaMode: false,
    // The C mallocs without clearing; the screen sets these before reading them (A on a field).
    selectGroupCursorX: 0,
    selectGroupCursorY: 0,
    selectGroupRowsAbove: 0,
    selectGroupNumRows: Math.trunc((GetNumDisplayableGroups() - 1) / 2) + 1,
    selectWordRowsAbove: 0,
    selectWordNumRows: 0,
    selectWordCursorX: 0,
    selectWordCursorY: 0,
    words,
    ecWordBuffer: words.slice(0, numWords),
    gameState: state,
    processYesNoInput: options.processYesNoInput,
    yesNoCursor: 0,
  };
  return true;
}

/** EasyChat_FreeResources */
export function EasyChat_FreeResources(): void {
  sEasyChatScreen = null;
}

/**
 * Task_RunEasyChat's case 3 (after the fade out), the part that isn't the screen: the questionnaire compares its
 * words with LINK TOGETHER WITH ALL, the profile sets FLAG_SYS_SET_TRAINER_CARD_PROFILE and compares with MYSTERY
 * EVENT IS EXCITING; VAR_0x8004 = 0 when they match. Note the compare reads the edited buffer, so it runs (and can
 * match) after a cancel too, and that the flag is set even when the profile was cancelled.
 */
export function EasyChat_OnLeave(): void {
  const s = scr();
  const c = EC();
  if (s.type === c.EASY_CHAT_TYPE_QUESTIONNAIRE) CompareQuestionnaireResponseWithPassphrase();
  if (s.type === c.EASY_CHAT_TYPE_PROFILE) {
    s.gameState.setFlag('FLAG_SYS_SET_TRAINER_CARD_PROFILE');
    CompareProfileResponseWithPassphrase();
  }
}

/** CompareProfileResponseWithPassphrase */
function CompareProfileResponseWithPassphrase(): void {
  const phrase = easyChatData().passphrases.sECPhrase_MysteryEventIsExciting;
  scr().gameState.setVar('VAR_0x8004', IsPhraseDifferentThanPlayerInput(phrase, phrase.length) ? 1 : 0);
}

/** CompareQuestionnaireResponseWithPassphrase */
function CompareQuestionnaireResponseWithPassphrase(): void {
  const phrase = easyChatData().passphrases.sECPhrase_LinkTogetherWithAll;
  scr().gameState.setVar('VAR_0x8004', IsPhraseDifferentThanPlayerInput(phrase, phrase.length) ? 1 : 0);
}

/** EasyChatScreen_HandleJoypad: the frame's input → an EC_CMD id (NONE when nothing happened). */
export function EasyChatScreen_HandleJoypad(keys: EasyChatKeys): number {
  switch (scr().state) {
    case EC_STATE.SELECT_FIELD:
      return HandleJoypad_SelectField(keys);
    case EC_STATE.SELECT_FOOTER:
      return HandleJoypad_SelectFooter(keys);
    case EC_STATE.SELECT_GROUP:
      return HandleJoypad_SelectGroup(keys);
    case EC_STATE.SELECT_WORD:
      return HandleJoypad_SelectWord(keys);
    case EC_STATE.CANCEL_YES_NO:
      return Cancel_HandleYesNoMenu(keys);
    case EC_STATE.DEL_ALL_YES_NO:
      return DelAll_HandleYesNoMenu(keys);
    case EC_STATE.CONFIRM_YES_NO:
      return Confirm_HandleYesNoMenu(keys);
  }
  return EC_CMD.NONE;
}

/** HandleJoypad_SelectField: A opens the groups, B / START the quit / confirm prompts, the D-pad moves (wrapping; past the last row is the footer). */
function HandleJoypad_SelectField({ newKeys }: EasyChatKeys): number {
  const s = scr();
  if (newKeys & A_BUTTON) {
    s.state = EC_STATE.SELECT_GROUP;
    s.selectGroupCursorX = 0;
    s.selectGroupCursorY = 0;
    s.selectGroupRowsAbove = 0;
    return EC_CMD.OPEN_KEYBOARD;
  } else if (newKeys & B_BUTTON) {
    return Cancel_CreateYesNoMenu();
  } else if (newKeys & START_BUTTON) {
    return Confirm_CreateYesNoMenu();
  } else if (newKeys & DPAD_UP) {
    s.mainCursorRow--;
  } else if (newKeys & DPAD_LEFT) {
    s.mainCursorColumn--;
  } else if (newKeys & DPAD_DOWN) {
    s.mainCursorRow++;
  } else if (newKeys & DPAD_RIGHT) {
    s.mainCursorColumn++;
  } else {
    return EC_CMD.NONE;
  }

  const { numRows, numColumns } = tmpl();
  if (s.mainCursorRow < 0) s.mainCursorRow = numRows;
  if (s.mainCursorRow > numRows) s.mainCursorRow = 0;
  if (s.mainCursorRow === numRows) {
    if (s.mainCursorColumn > 2) s.mainCursorColumn = 2;
    s.state = EC_STATE.SELECT_FOOTER;
    return EC_CMD.UPDATE_MAIN_CURSOR_ON_BUTTONS;
  }
  if (s.mainCursorColumn < 0) s.mainCursorColumn = numColumns - 1;
  if (s.mainCursorColumn >= numColumns) s.mainCursorColumn = 0;
  // The mail frame's last row has one field.
  if (GetEasyChatScreenFrameId() === 2 && s.mainCursorColumn === 1 && s.mainCursorRow === 4) s.mainCursorColumn = 0;
  return EC_CMD.UPDATE_MAIN_CURSOR;
}

/** HandleJoypad_SelectFooter: A on DEL ALL / CANCEL / OK; left / right wrap over the three; up / down back to the fields. */
function HandleJoypad_SelectFooter({ newKeys }: EasyChatKeys): number {
  const s = scr();
  if (newKeys & A_BUTTON) {
    switch (s.mainCursorColumn) {
      case 0:
        return DelAll_CreateYesNoMenu();
      case 1:
        return Cancel_CreateYesNoMenu();
      case 2:
        return Confirm_CreateYesNoMenu();
    }
  }
  if (newKeys & B_BUTTON) {
    return Cancel_CreateYesNoMenu();
  } else if (newKeys & START_BUTTON) {
    return Confirm_CreateYesNoMenu();
  } else if (newKeys & DPAD_UP) {
    s.mainCursorRow--;
  } else if (newKeys & DPAD_LEFT) {
    s.mainCursorColumn--;
  } else if (newKeys & DPAD_DOWN) {
    s.mainCursorRow = 0;
  } else if (newKeys & DPAD_RIGHT) {
    s.mainCursorColumn++;
  } else {
    return EC_CMD.NONE;
  }

  const { numRows, numColumns } = tmpl();
  if (s.mainCursorRow === numRows) {
    if (s.mainCursorColumn < 0) s.mainCursorColumn = 2;
    if (s.mainCursorColumn >= 3) s.mainCursorColumn = 0;
    return EC_CMD.UPDATE_MAIN_CURSOR_ON_BUTTONS;
  }
  if (s.mainCursorColumn >= numColumns) s.mainCursorColumn = numColumns - 1;
  if (GetEasyChatScreenFrameId() === 2 && s.mainCursorColumn === 1 && s.mainCursorRow === 4) s.mainCursorColumn = 0;
  s.state = EC_STATE.SELECT_FIELD;
  return EC_CMD.UPDATE_MAIN_CURSOR;
}

/** HandleJoypad_SelectGroup: the groups / keyboard and the blue box (MODE, DEL, CANCEL); SELECT switches modes; the D-pad repeats. */
function HandleJoypad_SelectGroup({ newKeys, newAndRepeatedKeys }: EasyChatKeys): number {
  const s = scr();
  if (newKeys & B_BUTTON) return BackOutFromGroupToFieldSelect();
  if (newKeys & A_BUTTON) {
    if (s.selectGroupCursorX !== -1) return OpenSelectedGroup();
    switch (s.selectGroupCursorY) {
      case 0:
        return ToggleGroupAlphaMode();
      case 1:
        return DeleteSelectedWord();
      case 2:
        return BackOutFromGroupToFieldSelect();
    }
  }
  if (newKeys & SELECT_BUTTON) return ToggleGroupAlphaMode();
  if (newAndRepeatedKeys & DPAD_UP) return SelectGroupCursorAction(2);
  if (newAndRepeatedKeys & DPAD_DOWN) return SelectGroupCursorAction(3);
  if (newAndRepeatedKeys & DPAD_LEFT) return SelectGroupCursorAction(1);
  if (newAndRepeatedKeys & DPAD_RIGHT) return SelectGroupCursorAction(0);
  return EC_CMD.NONE;
}

/** HandleJoypad_SelectWord: A places the word, B goes back to the groups, START / SELECT page up / down, the D-pad repeats. */
function HandleJoypad_SelectWord({ newKeys, newAndRepeatedKeys }: EasyChatKeys): number {
  const s = scr();
  if (newKeys & B_BUTTON) {
    s.state = EC_STATE.SELECT_GROUP;
    return EC_CMD.RETURN_TO_KEYBOARD;
  }
  if (newKeys & A_BUTTON) return PlaceSelectedWord();
  if (newKeys & START_BUTTON) return SelectWordCursorAction(4);
  if (newKeys & SELECT_BUTTON) return SelectWordCursorAction(5);
  if (newAndRepeatedKeys & DPAD_UP) return SelectWordCursorAction(2);
  if (newAndRepeatedKeys & DPAD_DOWN) return SelectWordCursorAction(3);
  if (newAndRepeatedKeys & DPAD_LEFT) return SelectWordCursorAction(1);
  if (newAndRepeatedKeys & DPAD_RIGHT) return SelectWordCursorAction(0);
  return EC_CMD.NONE;
}

/**
 * Menu_ProcessInputNoWrapClearOnChoose for the YES/NO: the screen's (the options), or a model of menu.c's
 * Menu_ProcessInputNoWrapAround over two items.
 */
function ProcessYesNoInput({ newKeys }: EasyChatKeys): number {
  const s = scr();
  if (s.processYesNoInput) return s.processYesNoInput();
  if (newKeys & A_BUTTON) return s.yesNoCursor;
  if (newKeys & B_BUTTON) return MENU_B_PRESSED;
  if (newKeys & DPAD_UP) {
    if (s.yesNoCursor > 0) s.yesNoCursor--;
    return MENU_NOTHING_CHOSEN;
  }
  if (newKeys & DPAD_DOWN) {
    if (s.yesNoCursor < 1) s.yesNoCursor++;
    return MENU_NOTHING_CHOSEN;
  }
  return MENU_NOTHING_CHOSEN;
}

/** Cancel_HandleYesNoMenu: YES leaves with VAR_RESULT 0 (nothing saved); NO / B back to where B or CANCEL was pressed. */
function Cancel_HandleYesNoMenu(keys: EasyChatKeys): number {
  const s = scr();
  switch (ProcessYesNoInput(keys)) {
    case MENU_B_PRESSED:
    case 1:
      s.state = GetStateBackup();
      return EC_CMD.CLOSE_PROMPT;
    case 0:
      s.gameState.setVar('VAR_RESULT', 0);
      return EC_CMD.EXIT;
    default:
      return EC_CMD.NONE;
  }
}

/** Confirm_HandleYesNoMenu: YES saves the words and leaves with VAR_RESULT = whether they changed. */
function Confirm_HandleYesNoMenu(keys: EasyChatKeys): number {
  const s = scr();
  switch (ProcessYesNoInput(keys)) {
    case MENU_B_PRESSED:
    case 1:
      s.state = GetStateBackup();
      return EC_CMD.CLOSE_PROMPT;
    case 0:
      s.gameState.setVar('VAR_RESULT', HasECMessageChanged() ? 1 : 0);
      CommitECWords();
      return EC_CMD.EXIT;
    default:
      return EC_CMD.NONE;
  }
}

/** DelAll_HandleYesNoMenu: YES empties every field; either way back to the footer. */
function DelAll_HandleYesNoMenu(keys: EasyChatKeys): number {
  const s = scr();
  switch (ProcessYesNoInput(keys)) {
    case MENU_B_PRESSED:
    case 1:
      s.state = EC_STATE.SELECT_FOOTER;
      return EC_CMD.CLOSE_PROMPT;
    case 0:
      DeleteAllECFields();
      s.state = EC_STATE.SELECT_FOOTER;
      return EC_CMD.CLOSE_PROMPT_AFTER_DELETE;
    default:
      return EC_CMD.NONE;
  }
}

/** Cancel_CreateYesNoMenu (easy_chat_3.c's ECInterfaceCmd_05 puts the cursor on NO) */
function Cancel_CreateYesNoMenu(): number {
  const s = scr();
  s.stateBackup = s.state;
  s.state = EC_STATE.CANCEL_YES_NO;
  s.yesNoCursor = 1;
  return EC_CMD.PROMPT_EXIT;
}

/** DelAll_CreateYesNoMenu (ECInterfaceCmd_04: cursor on NO) */
function DelAll_CreateYesNoMenu(): number {
  const s = scr();
  s.stateBackup = s.state;
  s.state = EC_STATE.DEL_ALL_YES_NO;
  s.yesNoCursor = 1;
  return EC_CMD.PROMPT_DELETE_ALL;
}

/** Confirm_CreateYesNoMenu: with every field empty it asks to quit instead (ECInterfaceCmd_06: cursor on YES). */
function Confirm_CreateYesNoMenu(): number {
  const s = scr();
  s.stateBackup = s.state;
  if (IsEcWordBufferUninitialized()) {
    s.state = EC_STATE.CANCEL_YES_NO;
    s.yesNoCursor = 1;
    return EC_CMD.PROMPT_EXIT;
  }
  s.state = EC_STATE.CONFIRM_YES_NO;
  s.yesNoCursor = 0;
  return EC_CMD.PROMPT_CONFIRM;
}

/** GetStateBackup */
function GetStateBackup(): number {
  return scr().stateBackup;
}

/** OpenSelectedGroup: the word list for the group (or letter); stays put when it has no words. */
function OpenSelectedGroup(): number {
  const s = scr();
  if (!s.isAlphaMode) GetUnlockedECWords(false, GetSelectedGroupByIndex(GetSelectedGroupIndex()));
  else GetUnlockedECWords(true, GetSelectedLetter());
  const numDisplayedWords = GetNumDisplayedWords();
  if (numDisplayedWords === 0) return EC_CMD.NONE;
  s.selectWordNumRows = Math.trunc((numDisplayedWords - 1) / 2);
  s.selectWordRowsAbove = 0;
  s.selectWordCursorX = 0;
  s.selectWordCursorY = 0;
  s.state = EC_STATE.SELECT_WORD;
  return EC_CMD.OPEN_WORD_SELECT;
}

/** BackOutFromGroupToFieldSelect */
function BackOutFromGroupToFieldSelect(): number {
  scr().state = EC_STATE.SELECT_FIELD;
  return EC_CMD.CLOSE_KEYBOARD;
}

/** ToggleGroupAlphaMode: the cursor back to the first group / letter. */
function ToggleGroupAlphaMode(): number {
  const s = scr();
  s.selectGroupCursorX = 0;
  s.selectGroupCursorY = 0;
  s.selectGroupRowsAbove = 0;
  s.isAlphaMode = !s.isAlphaMode;
  return EC_CMD.SWITCH_KEYBOARD_MODE;
}

/** DeleteSelectedWord: DEL empties the field being edited (the groups stay open). */
function DeleteSelectedWord(): number {
  SetEasyChatWordToField(0xffff);
  return EC_CMD.REPRINT_PHRASE;
}

/** PlaceSelectedWord */
function PlaceSelectedWord(): number {
  const s = scr();
  SetEasyChatWordToField(GetDisplayedWordByIndex(GetSelectWordCursorPos()));
  s.state = EC_STATE.SELECT_FIELD;
  return EC_CMD.CLOSE_WORD_SELECT;
}

/** CommitECWords: the edited words into the saved array. */
function CommitECWords(): void {
  const s = scr();
  for (let i = 0; i < s.numWords; i++) s.words[i] = s.ecWordBuffer[i];
}

/** DeleteAllECFields */
function DeleteAllECFields(): void {
  const s = scr();
  for (let i = 0; i < s.numWords; i++) s.ecWordBuffer[i] = 0xffff;
}

/** SetEasyChatWordToField */
function SetEasyChatWordToField(easyChatWord: number): void {
  scr().ecWordBuffer[GetSelectedFieldIndex()] = easyChatWord;
}

/** HasECMessageChanged */
function HasECMessageChanged(): boolean {
  const s = scr();
  for (let i = 0; i < s.numWords; i++) if (s.ecWordBuffer[i] !== s.words[i]) return true;
  return false;
}

/** SelectGroupCursorAction: action 0 right, 1 left, 2 up, 3 down. */
function SelectGroupCursorAction(action: number): number {
  const s = scr();
  if (s.selectGroupCursorX !== -1) {
    return s.isAlphaMode ? UpdateSelectGroupCursorPos_OutsideBlueBox_AlphaMode(action) : UpdateSelectGroupCursorPos_OutsideBlueBox_GroupMode(action);
  }
  return UpdateSelectGroupCursorPos_InsideBlueBox(action);
}

/**
 * UpdateSelectGroupCursorPos_OutsideBlueBox_GroupMode: two groups per row, four rows on screen, scrolling at the
 * top and bottom (no wrap); left of the first column and right of the last group is the blue box.
 */
function UpdateSelectGroupCursorPos_OutsideBlueBox_GroupMode(action: number): number {
  const s = scr();
  switch (action) {
    case 2:
      if (s.selectGroupCursorY !== -s.selectGroupRowsAbove) {
        if (s.selectGroupCursorY) {
          s.selectGroupCursorY--;
          return EC_CMD.UPDATE_KEYBOARD_CURSOR;
        }
        s.selectGroupRowsAbove--;
        return EC_CMD.GROUP_NAMES_SCROLL_UP;
      }
      break;
    case 3:
      if (s.selectGroupCursorY + s.selectGroupRowsAbove < s.selectGroupNumRows - 1) {
        let result: number;
        if (s.selectGroupCursorY < 3) {
          s.selectGroupCursorY++;
          result = EC_CMD.UPDATE_KEYBOARD_CURSOR;
        } else {
          s.selectGroupRowsAbove++;
          result = EC_CMD.GROUP_NAMES_SCROLL_DOWN;
        }
        MoveGroupCursorXToMaxCol();
        return result;
      }
      break;
    case 1:
      if (s.selectGroupCursorX) s.selectGroupCursorX--;
      else GroupCursorMoveToBlueBox();
      return EC_CMD.UPDATE_KEYBOARD_CURSOR;
    case 0:
      if (s.selectGroupCursorX < 1) {
        s.selectGroupCursorX++;
        if (GroupSelectCursorXPosTooFarRight()) GroupCursorMoveToBlueBox();
      } else {
        GroupCursorMoveToBlueBox();
      }
      return EC_CMD.UPDATE_KEYBOARD_CURSOR;
  }
  return EC_CMD.NONE;
}

/** UpdateSelectGroupCursorPos_OutsideBlueBox_AlphaMode: the A-Z keyboard; up / down wrap, left / right leave into the blue box. */
function UpdateSelectGroupCursorPos_OutsideBlueBox_AlphaMode(action: number): number {
  const s = scr();
  switch (action) {
    case 2:
      if (s.selectGroupCursorY > 0) s.selectGroupCursorY--;
      else s.selectGroupCursorY = 3;
      MoveGroupCursorXToMaxCol();
      return EC_CMD.UPDATE_KEYBOARD_CURSOR;
    case 3:
      if (s.selectGroupCursorY < 3) s.selectGroupCursorY++;
      else s.selectGroupCursorY = 0;
      MoveGroupCursorXToMaxCol();
      return EC_CMD.UPDATE_KEYBOARD_CURSOR;
    case 0:
      s.selectGroupCursorX++;
      if (GroupSelectCursorXPosTooFarRight()) GroupCursorMoveToBlueBox();
      return EC_CMD.UPDATE_KEYBOARD_CURSOR;
    case 1:
      s.selectGroupCursorX--;
      if (s.selectGroupCursorX < 0) GroupCursorMoveToBlueBox();
      return EC_CMD.UPDATE_KEYBOARD_CURSOR;
  }
  return EC_CMD.NONE;
}

/**
 * UpdateSelectGroupCursorPos_InsideBlueBox: up / down wrap over the three buttons; right goes to the first column of
 * the row below the button's (button k sits between rows k and k + 1), left to the last column of that row.
 */
function UpdateSelectGroupCursorPos_InsideBlueBox(action: number): number {
  const s = scr();
  switch (action) {
    case 2:
      if (s.selectGroupCursorY) s.selectGroupCursorY--;
      else s.selectGroupCursorY = 2;
      return EC_CMD.UPDATE_KEYBOARD_CURSOR;
    case 3:
      if (s.selectGroupCursorY < 2) s.selectGroupCursorY++;
      else s.selectGroupCursorY = 0;
      return EC_CMD.UPDATE_KEYBOARD_CURSOR;
    case 1:
      s.selectGroupCursorY++;
      GroupCursorWrapAroundLeft();
      return EC_CMD.UPDATE_KEYBOARD_CURSOR;
    case 0:
      s.selectGroupCursorX = 0;
      s.selectGroupCursorY++;
      return EC_CMD.UPDATE_KEYBOARD_CURSOR;
  }
  return EC_CMD.NONE;
}

/** GroupCursorMoveToBlueBox: X = 0xFF (-1 as an s8); rows 1-3 map to buttons 0-2. */
function GroupCursorMoveToBlueBox(): void {
  const s = scr();
  s.selectGroupCursorX = -1;
  if (s.selectGroupCursorY) s.selectGroupCursorY--;
}

/** GroupCursorWrapAroundLeft */
function GroupCursorWrapAroundLeft(): void {
  const s = scr();
  if (!s.isAlphaMode) {
    s.selectGroupCursorX = 1;
    MoveGroupCursorXToMaxCol();
  } else {
    s.selectGroupCursorX = GetMaxGroupCursorXinAlphaMode(s.selectGroupCursorY);
  }
}

/** SelectWordCursorAction: 0 right, 1 left (both wrap within the row), 2 up, 3 down (scrolling), 4 page up, 5 page down. */
function SelectWordCursorAction(action: number): number {
  const s = scr();
  let result: number;
  switch (action) {
    case 2: // up
      if (s.selectWordCursorY + s.selectWordRowsAbove > 0) {
        if (s.selectWordCursorY > 0) {
          s.selectWordCursorY--;
          result = EC_CMD.UPDATE_WORD_SELECT_CURSOR;
        } else {
          s.selectWordRowsAbove--;
          result = EC_CMD.WORD_SELECT_SCROLL_UP;
        }
        MoveWordCursorXToMaxCol();
        return result;
      }
      break;
    case 3: // down
      if (s.selectWordCursorY + s.selectWordRowsAbove < s.selectWordNumRows) {
        if (s.selectWordCursorY < 3) {
          s.selectWordCursorY++;
          result = EC_CMD.UPDATE_WORD_SELECT_CURSOR;
        } else {
          s.selectWordRowsAbove++;
          result = EC_CMD.WORD_SELECT_SCROLL_DOWN;
        }
        MoveWordCursorXToMaxCol();
        return result;
      }
      break;
    case 1: // left
      if (s.selectWordCursorX > 0) s.selectWordCursorX--;
      else s.selectWordCursorX = 1;
      MoveWordCursorXToMaxCol();
      return EC_CMD.UPDATE_WORD_SELECT_CURSOR;
    case 0: // right
      if (s.selectWordCursorX < 1) {
        s.selectWordCursorX++;
        if (WordSelectCursorXPosTooFarRight()) s.selectWordCursorX = 0;
      } else {
        s.selectWordCursorX = 0;
      }
      return EC_CMD.UPDATE_WORD_SELECT_CURSOR;
    case 4: // pg up
      if (s.selectWordRowsAbove) {
        if (s.selectWordRowsAbove > 3) s.selectWordRowsAbove -= 4;
        else s.selectWordRowsAbove = 0;
        return EC_CMD.WORD_SELECT_PAGE_UP;
      }
      break;
    case 5: // pg dn
      if (s.selectWordRowsAbove <= s.selectWordNumRows - 4) {
        s.selectWordRowsAbove += 4;
        if (s.selectWordRowsAbove > s.selectWordNumRows - 3) s.selectWordRowsAbove = (s.selectWordNumRows - 3) & 0xff;
        MoveWordCursorXToMaxCol();
        return EC_CMD.WORD_SELECT_PAGE_DOWN;
      }
      break;
  }
  return EC_CMD.NONE;
}

/** GetSelectedFieldIndex */
function GetSelectedFieldIndex(): number {
  const s = scr();
  return s.mainCursorRow * s.numColumns + s.mainCursorColumn;
}

/** GetSelectedGroupIndex */
function GetSelectedGroupIndex(): number {
  const s = scr();
  return 2 * (s.selectGroupCursorY + s.selectGroupRowsAbove) + s.selectGroupCursorX;
}

/** sAlphabetLayout: wordsByLetter indices on the keyboard (0 = "others", the last key of the first row). */
const sAlphabetLayout = [
  [1, 2, 3, 4, 5, 6, 0],
  [7, 8, 9, 10, 11, 12, 0],
  [13, 14, 15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24, 25, 26],
];

/** GetSelectedLetter (an out-of-range X or Y, compared unsigned in the C, reads column / row 0). */
function GetSelectedLetter(): number {
  const s = scr();
  const col = s.selectGroupCursorX >= 0 && s.selectGroupCursorX < 7 ? s.selectGroupCursorX : 0;
  const row = s.selectGroupCursorY >= 0 && s.selectGroupCursorY < sAlphabetLayout.length ? s.selectGroupCursorY : 0;
  return sAlphabetLayout[row][col];
}

/** GetSelectWordCursorPos */
function GetSelectWordCursorPos(): number {
  const s = scr();
  return 2 * (s.selectWordCursorY + s.selectWordRowsAbove) + s.selectWordCursorX;
}

/** GetMaxGroupCursorXinAlphaMode: row 1 (G-L) has six keys, the others seven. */
function GetMaxGroupCursorXinAlphaMode(row: number): number {
  return row === 1 ? 5 : 6;
}

/** MoveGroupCursorXToMaxCol */
function MoveGroupCursorXToMaxCol(): void {
  const s = scr();
  while (GroupSelectCursorXPosTooFarRight()) {
    if (s.selectGroupCursorX) s.selectGroupCursorX--;
    else break;
  }
}

/** MoveWordCursorXToMaxCol */
function MoveWordCursorXToMaxCol(): void {
  const s = scr();
  while (WordSelectCursorXPosTooFarRight()) {
    if (s.selectWordCursorX) s.selectWordCursorX--;
    else break;
  }
}

/** GroupSelectCursorXPosTooFarRight */
function GroupSelectCursorXPosTooFarRight(): boolean {
  const s = scr();
  if (!s.isAlphaMode) return GetSelectedGroupIndex() >= GetNumDisplayableGroups();
  return s.selectGroupCursorX > GetMaxGroupCursorXinAlphaMode(s.selectGroupCursorY);
}

/** WordSelectCursorXPosTooFarRight */
function WordSelectCursorXPosTooFarRight(): boolean {
  return GetSelectWordCursorPos() >= GetNumDisplayedWords();
}

// ------------------------------------------------------------------ the getters easy_chat_3.c reads

/** GetEasyChatScreenFrameId: sPhraseFrameDimensions' index (0 2x2, 1 2x3, 2 mail, 3 2x1). */
export function GetEasyChatScreenFrameId(): number {
  return tmpl().frameId;
}

/** GetTitleText: a src/strings.c label, or null (the mail templates). */
export function GetTitleText(): string | null {
  return tmpl().titleText;
}

/** GetEasyChatWordBuffer: the words being edited (live; the screen prints from it). */
export function GetEasyChatWordBuffer(): number[] {
  return scr().ecWordBuffer;
}

/** GetNumRows */
export function GetNumRows(): number {
  return scr().numRows;
}

/** GetNumColumns */
export function GetNumColumns(): number {
  return scr().numColumns;
}

/** GetMainCursorColumn (u8 in the C; the cursor is never left negative) */
export function GetMainCursorColumn(): number {
  return scr().mainCursorColumn;
}

/** GetMainCursorRow */
export function GetMainCursorRow(): number {
  return scr().mainCursorRow;
}

/** GetEasyChatInstructionsText: [str1, str2] as src/strings.c labels. */
export function GetEasyChatInstructionsText(): [string | null, string | null] {
  const t = tmpl();
  return [t.instructionsText1, t.instructionsText2];
}

/** GetEasyChatConfirmText */
export function GetEasyChatConfirmText(): [string | null, string | null] {
  const t = tmpl();
  return [t.confirmText1, t.confirmText2];
}

/** GetEasyChatConfirmCancelText */
export function GetEasyChatConfirmCancelText(): [string | null, string | null] {
  return scr().type === EC().EASY_CHAT_TYPE_MAIL ? ['gText_StopGivingPkmnMail', null] : ['gText_QuitEditing', null];
}

/** GetEasyChatConfirmDeletionText */
export function GetEasyChatConfirmDeletionText(): [string | null, string | null] {
  return ['gText_AllTextBeingEditedWill', 'gText_BeDeletedThatOkay'];
}

/**
 * GetECSelectGroupCursorCoords: [x, y], x = -1 in the blue box. (The C hands them back as u8 and its only caller,
 * easy_chat_3.c's EC_MoveCursor, passes them on as s8, so -1 again.)
 */
export function GetECSelectGroupCursorCoords(): [number, number] {
  const s = scr();
  return [s.selectGroupCursorX, s.selectGroupCursorY];
}

/** IsEasyChatAlphaMode */
export function IsEasyChatAlphaMode(): boolean {
  return scr().isAlphaMode;
}

/** GetECSelectGroupRowsAbove */
export function GetECSelectGroupRowsAbove(): number {
  return scr().selectGroupRowsAbove;
}

/** GetECSelectWordCursorCoords: [x, y] (s8) */
export function GetECSelectWordCursorCoords(): [number, number] {
  const s = scr();
  return [s.selectWordCursorX, s.selectWordCursorY];
}

/** GetECSelectWordRowsAbove */
export function GetECSelectWordRowsAbove(): number {
  return scr().selectWordRowsAbove;
}

/** GetECSelectWordNumRows */
export function GetECSelectWordNumRows(): number {
  return scr().selectWordNumRows;
}

/** ShouldDrawECUpArrow: rows scrolled above (the groups in group mode, or the words). */
export function ShouldDrawECUpArrow(): boolean {
  const s = scr();
  switch (s.state) {
    case EC_STATE.SELECT_GROUP:
      return !s.isAlphaMode && s.selectGroupRowsAbove !== 0;
    case EC_STATE.SELECT_WORD:
      return s.selectWordRowsAbove !== 0;
  }
  return false;
}

/** ShouldDrawECDownArrow: rows below the four on screen. */
export function ShouldDrawECDownArrow(): boolean {
  const s = scr();
  switch (s.state) {
    case EC_STATE.SELECT_GROUP:
      return !s.isAlphaMode && s.selectGroupRowsAbove + 4 <= s.selectGroupNumRows - 1;
    case EC_STATE.SELECT_WORD:
      return s.selectWordRowsAbove + 4 <= s.selectWordNumRows;
  }
  return false;
}

/** The built-in YES/NO's cursor (0 YES, 1 NO), for a screen that doesn't pass its own menu input. */
export function GetEasyChatYesNoCursor(): number {
  return scr().yesNoCursor;
}

/** IsPhraseDifferentThanPlayerInput: the first `phraseLength` edited words against `phrase`. */
function IsPhraseDifferentThanPlayerInput(phrase: readonly number[], phraseLength: number): boolean {
  const s = scr();
  for (let i = 0; i < phraseLength; i++) if (phrase[i] !== s.ecWordBuffer[i]) return true;
  return false;
}

/** GetEasyChatScreenTemplateId: the template for `type`, the first (PROFILE) if there's none. */
function GetEasyChatScreenTemplateId(type: number): number {
  const i = templates().findIndex((t) => t.type === type);
  return i < 0 ? 0 : i;
}

/** IsEcWordBufferUninitialized: every field empty. */
function IsEcWordBufferUninitialized(): boolean {
  const s = scr();
  for (let i = 0; i < s.numWords; i++) if (s.ecWordBuffer[i] !== 0xffff) return false;
  return true;
}
