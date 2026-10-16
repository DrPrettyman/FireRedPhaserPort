// naming_screen.c: the keyboard screen that names the player, the rival, a PC box, a caught Pokémon
// (from the battle) and nicknames (ChangePokemonNickname). DoNamingScreen is the entry point; the
// screen writes the name into the caller's buffer and hands over to the return callback.
//
// Not ported: the help system context, StartTimer1/SeedRngAndSetTrainerId for NAMING_SCREEN_PLAYER
// (the trainer id is rolled when the game state is created), the REVISION >= 0xA bad-word check, and
// SE playback (PlaySE is silent).

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { Sin } from '../battle/trig';
import {
  BG_COORD_SET,
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  CopyToBgTilemapBuffer,
  FillBgTilemapBufferRect_Palette0,
  InitBgsFromTemplates,
  LoadBgTiles,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT2_BG1,
  BLDCNT_TGT2_BG2,
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPLAY_WIDTH,
  GetGpuReg,
  pltt,
  REG_OFFSET_BG1CNT,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2CNT,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_DISPCNT,
  RGB_BLACK,
  SetGpuReg,
  SetGpuRegBits,
  vram,
} from '../gba/hw';
import {
  A_BUTTON,
  B_BUTTON,
  DPAD_DOWN,
  DPAD_LEFT,
  DPAD_RIGHT,
  DPAD_UP,
  gMain,
  GetKeyRepeatStartDelay,
  JOY_NEW,
  JOY_REPT,
  SELECT_BUTTON,
  SetHBlankCallback,
  SetKeyRepeatStartDelay,
  SetMainCallback2,
  SetVBlankCallback,
  START_BUTTON,
  type MainCallback,
} from '../gba/main';
import {
  AddTextPrinterParameterized2,
  DrawDialogueFrame,
  GetTextSpeedSetting,
  GetTextWindowPalette,
  InitStandardTextBoxWindows,
  InitTextBoxGfxAndPrinters,
  TEXT_COLOR_DARK_GRAY,
  TEXT_COLOR_LIGHT_GRAY,
  TEXT_COLOR_TRANSPARENT,
  TEXT_COLOR_WHITE,
} from '../gba/menu';
import {
  BeginNormalPaletteFade,
  BG_PLTT_ID,
  BlendPalettes,
  gPaletteFade,
  gPlttBufferFaded,
  gPlttBufferUnfaded,
  LoadPalette,
  MultiplyInvertedPaletteRGBComponents,
  OBJ_PLTT_ID,
  PLTT_SIZE_4BPP,
  ResetPaletteFade,
  TransferPlttBuffer,
  UpdatePaletteFade,
} from '../gba/palette';
import { PlaySE } from '../gba/sound';
import {
  ANIMCMD_END,
  ANIMCMD_FRAME,
  ANIMCMD_JUMP,
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  FreeAllSpritePalettes,
  gDummySpriteAffineAnimTable,
  GetSpriteTileStartByTag,
  gSprites,
  IndexOfSpritePaletteTag,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SetSubspriteTables,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAnim,
  ST_OAM_OBJ_BLEND,
  TAG_NONE,
  type AnimCmd,
  type Sprite,
  type SpriteTemplate,
  type Subsprite,
  type SubspriteTable,
} from '../gba/sprite';
import { CreateTask, DestroyTask, FindTaskIdByFunc, gTasks, ResetTasks, RunTasks, TASK_NONE, type Task } from '../gba/task';
import {
  AddTextPrinterParameterized,
  AddTextPrinterParameterized3,
  AddWindow,
  COPYWIN_FULL,
  COPYWIN_GFX,
  CopyWindowToVram,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  gTextFlags,
  GetStringWidth,
  IsTextPrinterActive,
  PIXEL_FILL,
  PutWindowTilemap,
  RunTextPrinters,
  TEXT_SKIP_DRAW,
  type WindowTemplate,
} from '../gba/window';
import { CalculatePlayerPartyCount, encodeRaw, EOS, gStringVar1, gStringVar2, gStringVar3, speciesName, StringExpandPlaceholders, strBody, text } from './common';
import { menusData } from './data';
import { CopyObjectGraphicsInfoToSpriteTemplate, CreateObjectGraphicsSprite, objectEventGfxSymbols } from './objectEventGraphics';
import { CreateMonIcon, GetIconSpecies, LoadMonIconPalettes, monIconSymbol } from './pokemonIcon';

// include/naming_screen.h
export const NAMING_SCREEN_PLAYER = 0;
export const NAMING_SCREEN_BOX = 1;
export const NAMING_SCREEN_CAUGHT_MON = 2;
export const NAMING_SCREEN_NICKNAME = 3;
export const NAMING_SCREEN_RIVAL = 4;

const INPUT_NONE = 0;
const INPUT_DPAD_UP = 1;
const INPUT_DPAD_DOWN = 2;
const INPUT_DPAD_LEFT = 3;
const INPUT_DPAD_RIGHT = 4;
const INPUT_A_BUTTON = 5;
const INPUT_B_BUTTON = 6;
// INPUT_LR_BUTTON = 7 (never produced)
const INPUT_SELECT = 8;
const INPUT_START = 9;

const KBROW_COUNT = 4;
const KBCOL_COUNT = 8;

const GFXTAG_BACK_BUTTON = 0;
const GFXTAG_OK_BUTTON = 1;
const GFXTAG_PAGE_SWAP_FRAME = 2;
const GFXTAG_PAGE_SWAP_BUTTON = 3;
const GFXTAG_PAGE_SWAP_UPPER = 4;
const GFXTAG_PAGE_SWAP_LOWER = 5;
const GFXTAG_PAGE_SWAP_OTHERS = 6;
const GFXTAG_CURSOR = 7;
const GFXTAG_CURSOR_SQUISHED = 8;
const GFXTAG_CURSOR_FILLED = 9;
const GFXTAG_INPUT_ARROW = 10;
const GFXTAG_UNDERSCORE = 11;
const GFXTAG_RIVAL = 255;

const PALTAG_MENU = 0; // Also the PC icon
const PALTAG_PAGE_SWAP_UPPER = 1;
const PALTAG_PAGE_SWAP_LOWER = 2;
const PALTAG_PAGE_SWAP_OTHERS = 3; // Also the input arrow/underscore
const PALTAG_PAGE_SWAP = 4;
const PALTAG_CURSOR = 5;
const PALTAG_BACK_BUTTON = 6;
const PALTAG_OK_BUTTON = 7;
const PALTAG_RIVAL = 255;

const WIN_KB_PAGE_1 = 0; // Which of these two windows is in front is cycled as the player swaps
const WIN_KB_PAGE_2 = 1; // Initially WIN_KB_PAGE_1 is in front, with WIN_KB_PAGE_2 on deck
const WIN_TEXT_ENTRY = 2;
const WIN_TEXT_ENTRY_BOX = 3;
const WIN_BANNER = 4;
const WIN_COUNT = 5;

// sNamingScreen->currentPage: the order the pages are cycled in
const KBPAGE_SYMBOLS = 0;
const KBPAGE_LETTERS_UPPER = 1;
const KBPAGE_LETTERS_LOWER = 2;
const KBPAGE_COUNT = 3;

// A page's keyboard text and column count
const KEYBOARD_LETTERS_LOWER = 0;
const KEYBOARD_LETTERS_UPPER = 1;
const KEYBOARD_SYMBOLS = 2;

// The gfx/pal tags of the page's swap button
const PAGE_SWAP_UPPER = 0;
const PAGE_SWAP_OTHERS = 1;
const PAGE_SWAP_LOWER = 2;

const KEY_ROLE_CHAR = 0;
const KEY_ROLE_PAGE = 1;
const KEY_ROLE_BACKSPACE = 2;
const KEY_ROLE_OK = 3;

const BUTTON_PAGE = 0;
const BUTTON_BACK = 1;
const BUTTON_OK = 2;
const BUTTON_COUNT = 3;

// states for Task_NamingScreen
const STATE_FADE_IN = 0;
const STATE_WAIT_FADE_IN = 1;
const STATE_HANDLE_INPUT = 2;
const STATE_MOVE_TO_OK_BUTTON = 3;
const STATE_START_PAGE_SWAP = 4;
const STATE_WAIT_PAGE_SWAP = 5;
const STATE_PRESSED_OK = 6;
const STATE_WAIT_SENT_TO_PC_MESSAGE = 7;
const STATE_FADE_OUT = 8;
const STATE_EXIT = 9;

// states for Task_HandleInput
const INPUT_STATE_DISABLED = 0;
const INPUT_STATE_ENABLED = 1;

const PALETTES_ALL = 0xffffffff;
const BGCNT_PRIORITY = (n: number) => n;

interface NamingScreenTemplate {
  copyExistingString: boolean;
  maxChars: number;
  iconFunction: number;
  addGenderIcon: boolean;
  initialPage: number;
  /** string symbol */
  title: string;
}

interface NamingScreenData {
  tilemapBuffer1: Uint16Array;
  tilemapBuffer2: Uint16Array;
  tilemapBuffer3: Uint16Array;
  textBuffer: number[];
  tileBuffer: Uint8Array;
  state: number;
  windows: number[];
  inputCharBaseXPos: number;
  bg1vOffset: number;
  bg2vOffset: number;
  bg1Priority: number;
  bg2Priority: number;
  bgToReveal: number;
  bgToHide: number;
  currentPage: number;
  cursorSpriteId: number;
  swapBtnFrameSpriteId: number;
  keyRepeatStartDelayCopy: number;
  template: NamingScreenTemplate;
  templateNum: number;
  /** The caller's buffer: SaveInputText replaces its contents with the name and EOS. */
  destBuffer: number[];
  monSpecies: number;
  monGender: number;
  monPersonality: number;
  returnCallback: MainCallback;
}

let sNamingScreen: NamingScreenData | null = null;
/**
 * What FREE_AND_SET_NULL(sNamingScreen) leaves in memory. After MainState_Exit the C still reads the
 * freed struct: the rest of that CB2_NamingScreen frame, then the screen's sprite callbacks and
 * VBlankCB_NamingScreen keep running under the return callback (BattleMainCB2) until they're replaced.
 */
let sFreedNamingScreen: NamingScreenData | null = null;
const S = (): NamingScreenData => (sNamingScreen ?? sFreedNamingScreen)!;

const sTransferredToPCMessages = ['Text_MonSentToBoxInSomeonesPC', 'Text_MonSentToBoxInBillsPC', 'Text_MonSentToBoxSomeonesBoxFull', 'Text_MonSentToBoxBillsBoxFull'];

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 },
  { bg: 1, charBaseIndex: 2, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0 },
  { bg: 2, charBaseIndex: 2, mapBaseIndex: 28, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0 },
  { bg: 3, charBaseIndex: 3, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0 },
];

const sWindowTemplates: WindowTemplate[] = [
  { bg: 1, tilemapLeft: 3, tilemapTop: 10, width: 19, height: 8, paletteNum: 10, baseBlock: 0x0030 }, // WIN_KB_PAGE_1
  { bg: 2, tilemapLeft: 3, tilemapTop: 10, width: 19, height: 8, paletteNum: 10, baseBlock: 0x00c8 }, // WIN_KB_PAGE_2
  { bg: 3, tilemapLeft: 8, tilemapTop: 6, width: 14, height: 2, paletteNum: 10, baseBlock: 0x0030 }, // WIN_TEXT_ENTRY
  { bg: 3, tilemapLeft: 9, tilemapTop: 4, width: 16, height: 2, paletteNum: 10, baseBlock: 0x004c }, // WIN_TEXT_ENTRY_BOX
  { bg: 0, tilemapLeft: 0, tilemapTop: 0, width: 30, height: 2, paletteNum: 11, baseBlock: 0x006c }, // WIN_BANNER
  DUMMY_WIN_TEMPLATE,
];

/**
 * sKeyboardChars: what each key inserts (the keys shown are sNamingScreenKeyboardText). The `__()`
 * rows are fixed-size arrays, so the C pads short rows with 0 (CHAR_SPACE).
 */
let sKeyboardChars: number[][][] | undefined;
function keyboardChars(): number[][][] {
  sKeyboardChars ??= menusData.namingKeyboardChars.map((page) =>
    page.map((row) => {
      const chars = strBody(encodeRaw(row + '$'));
      while (chars.length < KBCOL_COUNT) chars.push(K.CHAR_SPACE);
      return chars;
    }),
  );
  return sKeyboardChars!;
}

const sPageColumnCounts = [KBCOL_COUNT, KBCOL_COUNT, 6]; // [KEYBOARD_*]

const sPageColumnXPos = [
  [0, 12, 24, 56, 68, 80, 92, 123], // KEYBOARD_LETTERS_LOWER
  [0, 12, 24, 56, 68, 80, 92, 123], // KEYBOARD_LETTERS_UPPER
  [0, 22, 44, 66, 88, 110], // KEYBOARD_SYMBOLS
];

/** DoNamingScreen */
export function DoNamingScreen(templateNum: number, destBuffer: number[], monSpecies: number, monGender: number, monPersonality: number, returnCallback: MainCallback): void {
  sNamingScreen = {
    tilemapBuffer1: new Uint16Array(0x400),
    tilemapBuffer2: new Uint16Array(0x400),
    tilemapBuffer3: new Uint16Array(0x400),
    textBuffer: new Array(0x10).fill(EOS),
    tileBuffer: new Uint8Array(0x600),
    state: 0,
    windows: new Array(WIN_COUNT).fill(0),
    inputCharBaseXPos: 0,
    bg1vOffset: 0,
    bg2vOffset: 0,
    bg1Priority: 0,
    bg2Priority: 0,
    bgToReveal: 0,
    bgToHide: 0,
    currentPage: 0,
    cursorSpriteId: 0,
    swapBtnFrameSpriteId: 0,
    keyRepeatStartDelayCopy: 0,
    template: sNamingScreenTemplates()[templateNum],
    templateNum,
    destBuffer,
    monSpecies,
    monGender,
    monPersonality,
    returnCallback,
  };
  SetMainCallback2(CB2_LoadNamingScreen);
}

function CB2_LoadNamingScreen(): void {
  switch (gMain.state) {
    case 0:
      ResetVHBlank();
      NamingScreen_Init();
      gMain.state++;
      break;
    case 1:
      NamingScreen_InitBGs();
      gMain.state++;
      break;
    case 2:
      ResetPaletteFade();
      gMain.state++;
      break;
    case 3:
      ResetSpriteData();
      FreeAllSpritePalettes();
      gMain.state++;
      break;
    case 4:
      ResetTasks();
      gMain.state++;
      break;
    case 5:
      LoadPalettes();
      gMain.state++;
      break;
    case 6:
      LoadGfx();
      gMain.state++;
      break;
    case 7:
      CreateSprites();
      UpdatePaletteFade();
      NamingScreen_ShowBgs();
      gMain.state++;
      break;
    default:
      CreateHelperTasks();
      CreateNamingScreenTask();
      break;
  }
}

function NamingScreen_Init(): void {
  const s = S();
  s.state = STATE_FADE_IN;
  s.bg1vOffset = 0;
  s.bg2vOffset = 0;
  s.bg1Priority = BGCNT_PRIORITY(1);
  s.bg2Priority = BGCNT_PRIORITY(2);
  s.bgToReveal = 0;
  s.bgToHide = 1;
  s.currentPage = s.template.initialPage;
  s.inputCharBaseXPos = Math.trunc((DISPLAY_WIDTH - s.template.maxChars * 8) / 2) + 6;
  s.keyRepeatStartDelayCopy = GetKeyRepeatStartDelay();
  s.textBuffer.fill(EOS);
  if (s.template.copyExistingString) StringCopy(s.textBuffer, s.destBuffer);
  // Never restored, as on the GBA: key repeat stays at 16 frames after the first naming screen.
  SetKeyRepeatStartDelay(16);
}

function SetSpritesVisible(): void {
  for (let i = 0; i < MAX_SPRITES; i++) {
    if (gSprites[i].inUse) gSprites[i].invisible = false;
  }
  SetCursorInvisibility(false);
}

function NamingScreen_InitBGs(): void {
  const s = S();
  vram.fill(0); // DmaClearLarge16(VRAM)
  // DmaClear32(OAM): the PPU reads the OAM buffer, which ResetSpriteData clears
  pltt.fill(0); // DmaClear16(PLTT)

  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0);
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBgTemplates, sBgTemplates.length);

  for (let bg = 0; bg < 4; bg++) {
    ChangeBgX(bg, 0, BG_COORD_SET);
    ChangeBgY(bg, 0, BG_COORD_SET);
  }

  InitStandardTextBoxWindows();
  InitTextBoxGfxAndPrinters();

  for (let i = 0; i < WIN_COUNT; i++) s.windows[i] = AddWindow(sWindowTemplates[i]);

  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG1 | BLDCNT_TGT2_BG2);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(12, 8));

  SetBgTilemapBuffer(1, s.tilemapBuffer1);
  SetBgTilemapBuffer(2, s.tilemapBuffer2);
  SetBgTilemapBuffer(3, s.tilemapBuffer3);

  FillBgTilemapBufferRect_Palette0(1, 0, 0, 0, 0x20, 0x20);
  FillBgTilemapBufferRect_Palette0(2, 0, 0, 0, 0x20, 0x20);
  FillBgTilemapBufferRect_Palette0(3, 0, 0, 0, 0x20, 0x20);
}

function CreateNamingScreenTask(): void {
  CreateTask(Task_NamingScreen, 2);
  SetMainCallback2(CB2_NamingScreen);
  // BackupHelpContext / SetHelpContext(HELPCONTEXT_NAMING_SCREEN): no help system
}

function Task_NamingScreen(_taskId: number): void {
  switch (S().state) {
    case STATE_FADE_IN:
      MainState_FadeIn();
      SetSpritesVisible();
      SetVBlank();
      break;
    case STATE_WAIT_FADE_IN:
      MainState_WaitFadeIn();
      break;
    case STATE_HANDLE_INPUT:
      MainState_HandleInput();
      break;
    case STATE_MOVE_TO_OK_BUTTON:
      MainState_MoveToOKButton();
      break;
    case STATE_START_PAGE_SWAP:
      MainState_StartPageSwap();
      break;
    case STATE_WAIT_PAGE_SWAP:
      MainState_WaitPageSwap();
      break;
    case STATE_PRESSED_OK:
      MainState_PressedOKButton();
      break;
    case STATE_WAIT_SENT_TO_PC_MESSAGE:
      MainState_WaitSentToPCMessage();
      break;
    case STATE_FADE_OUT:
      MainState_FadeOut();
      break;
    case STATE_EXIT:
      MainState_Exit();
      break;
  }
}

/** A table indexed by KBPAGE_* */
function byPage<T>(symbols: T, upper: T, lower: T): T[] {
  const t: T[] = [];
  t[KBPAGE_SYMBOLS] = symbols;
  t[KBPAGE_LETTERS_UPPER] = upper;
  t[KBPAGE_LETTERS_LOWER] = lower;
  return t;
}

// Which gfx/pal to load for the swap page button
const sPageToNextGfxId = byPage(PAGE_SWAP_UPPER, PAGE_SWAP_LOWER, PAGE_SWAP_OTHERS);
const sPageToNextKeyboardId = byPage(KEYBOARD_LETTERS_UPPER, KEYBOARD_LETTERS_LOWER, KEYBOARD_SYMBOLS);
const sPageToKeyboardId = byPage(KEYBOARD_SYMBOLS, KEYBOARD_LETTERS_UPPER, KEYBOARD_LETTERS_LOWER);

function PageToNextGfxId(page: number): number {
  return sPageToNextGfxId[page];
}

function CurrentPageToNextKeyboardId(): number {
  return sPageToNextKeyboardId[S().currentPage];
}

function CurrentPageToKeyboardId(): number {
  return sPageToKeyboardId[S().currentPage];
}

function MainState_FadeIn(): boolean {
  const s = S();
  DecompressToBgTilemapBuffer(3, 'gNamingScreenBackground_Tilemap');
  s.currentPage = KBPAGE_LETTERS_UPPER;
  DecompressToBgTilemapBuffer(2, 'gNamingScreenKeyboardLower_Tilemap');
  DecompressToBgTilemapBuffer(1, 'gNamingScreenKeyboardUpper_Tilemap');
  PrintKeyboardKeys(s.windows[WIN_KB_PAGE_2], KEYBOARD_LETTERS_LOWER);
  PrintKeyboardKeys(s.windows[WIN_KB_PAGE_1], KEYBOARD_LETTERS_UPPER);
  DrawTextEntry();
  DrawTextEntryBox();
  PrintControls();
  CopyBgTilemapBufferToVram(1);
  CopyBgTilemapBufferToVram(2);
  CopyBgTilemapBufferToVram(3);
  BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
  BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
  s.state++;
  return false;
}

function MainState_WaitFadeIn(): boolean {
  if (!gPaletteFade.active) {
    SetInputState(INPUT_STATE_ENABLED);
    SetCursorFlashing(true);
    S().state++;
  }
  return false;
}

function MainState_HandleInput(): boolean {
  return HandleKeyboardEvent();
}

function MainState_MoveToOKButton(): boolean {
  if (IsCursorAnimFinished()) {
    SetInputState(INPUT_STATE_ENABLED);
    MoveCursorToOKButton();
    S().state = STATE_HANDLE_INPUT;
  }
  return false;
}

function MainState_PressedOKButton(): boolean {
  const s = S();
  SaveInputText();
  SetInputState(INPUT_STATE_DISABLED);
  SetCursorFlashing(false);
  TryStartButtonFlash(BUTTON_COUNT, false, true);
  if (s.templateNum === NAMING_SCREEN_CAUGHT_MON && CalculatePlayerPartyCount() >= K.PARTY_SIZE) {
    DisplaySentToPCMessage();
    s.state = STATE_WAIT_SENT_TO_PC_MESSAGE;
    return false;
  } else {
    s.state = STATE_FADE_OUT;
    return true; // Exit the naming screen
  }
}

function MainState_FadeOut(): boolean {
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
  S().state++;
  return false;
}

function MainState_Exit(): boolean {
  if (!gPaletteFade.active) {
    const s = S();
    // NAMING_SCREEN_PLAYER: SeedRngAndSetTrainerId (see the header)
    SetMainCallback2(s.returnCallback);
    DestroyTask(FindTaskIdByFunc(Task_NamingScreen));
    FreeAllWindowBuffers();
    sFreedNamingScreen = sNamingScreen;
    sNamingScreen = null;
    // RestoreHelpContext: no help system
  }
  return false;
}

/** GetBoxNamePtr */
function GetBoxNamePtr(boxId: number): number[] {
  return state.storage.getBoxName(boxId) ?? [];
}

function DisplaySentToPCMessage(): void {
  let stringToDisplay = 0;

  if (!state.isDestinationBoxFull()) {
    gStringVar1.set(GetBoxNamePtr(state.getVar('VAR_PC_BOX_TO_SEND_MON')));
    gStringVar2.set(S().destBuffer);
  } else {
    gStringVar1.set(GetBoxNamePtr(state.getVar('VAR_PC_BOX_TO_SEND_MON')));
    gStringVar2.set(S().destBuffer);
    gStringVar3.set(GetBoxNamePtr(state.getPCBoxToSendMon()));
    stringToDisplay = 2;
  }

  if (state.getFlag('FLAG_SYS_NOT_SOMEONES_PC')) stringToDisplay++;

  const str = StringExpandPlaceholders(text(sTransferredToPCMessages[stringToDisplay]));
  DrawDialogueFrame(0, false);
  gTextFlags.canABSpeedUpPrint = true;
  AddTextPrinterParameterized2(0, K.FONT_NORMAL, str, GetTextSpeedSetting(), TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY);
  CopyWindowToVram(0, COPYWIN_FULL);
}

function MainState_WaitSentToPCMessage(): boolean {
  RunTextPrinters();
  if (!IsTextPrinterActive(0) && JOY_NEW(A_BUTTON)) S().state = STATE_FADE_OUT;
  return false;
}

function MainState_StartPageSwap(): boolean {
  SetInputState(INPUT_STATE_DISABLED);
  StartPageSwapButtonAnim();
  StartPageSwapAnim();
  SetCursorInvisibility(true);
  TryStartButtonFlash(BUTTON_PAGE, false, true);
  PlaySE(K.SE_WIN_OPEN);
  S().state = STATE_WAIT_PAGE_SWAP;
  return false;
}

function MainState_WaitPageSwap(): boolean {
  if (IsPageSwapAnimNotInProgress()) {
    const s = S();
    let [cursorX, cursorY] = GetCursorPos();
    const onLastColumn = cursorX === GetCurrentPageColumnCount();

    s.state = STATE_HANDLE_INPUT;
    s.currentPage++;
    s.currentPage %= KBPAGE_COUNT;

    if (onLastColumn) {
      cursorX = GetCurrentPageColumnCount();
    } else if (cursorX >= GetCurrentPageColumnCount()) {
      cursorX = GetCurrentPageColumnCount() - 1;
    }

    SetCursorPos(cursorX, cursorY);
    DrawKeyboardPageOnDeck();
    SetInputState(INPUT_STATE_ENABLED);
    SetCursorInvisibility(false);
  }
  return false;
}

// ------------------------------------------------------------------ page swap

const tState = 0;
const tFrameCount = 1;

const sPageSwapAnimStateFuncs: ((task: Task) => boolean)[] = [PageSwapAnimState_Init, PageSwapAnimState_1, PageSwapAnimState_2, PageSwapAnimState_Done];

function StartPageSwapAnim(): void {
  const taskId = CreateTask(Task_HandlePageSwapAnim, 0);
  Task_HandlePageSwapAnim(taskId);
}

function Task_HandlePageSwapAnim(taskId: number): void {
  while (sPageSwapAnimStateFuncs[gTasks[taskId].data[tState]](gTasks[taskId]));
}

function IsPageSwapAnimNotInProgress(): boolean {
  return FindTaskIdByFunc(Task_HandlePageSwapAnim) === TASK_NONE;
}

function PageSwapAnimState_Init(task: Task): boolean {
  S().bg1vOffset = 0;
  S().bg2vOffset = 0;
  task.data[tState]++;
  return false;
}

/** vOffsets[] = { &bg2vOffset, &bg1vOffset } indexed by bgToReveal / bgToHide */
function setVOffset(which: number, value: number): void {
  if (which === 0) S().bg2vOffset = value & 0xffff;
  else S().bg1vOffset = value & 0xffff;
}

function PageSwapAnimState_1(task: Task): boolean {
  const s = S();
  task.data[tFrameCount] += 4;
  setVOffset(s.bgToReveal, Sin(task.data[tFrameCount], 40));
  setVOffset(s.bgToHide, Sin((task.data[tFrameCount] + 128) & 0xff, 40));
  if (task.data[tFrameCount] >= 64) {
    [s.bg1Priority, s.bg2Priority] = [s.bg2Priority, s.bg1Priority];
    task.data[tState]++;
  }
  return false;
}

function PageSwapAnimState_2(task: Task): boolean {
  const s = S();
  task.data[tFrameCount] += 4;
  setVOffset(s.bgToReveal, Sin(task.data[tFrameCount], 40));
  setVOffset(s.bgToHide, Sin((task.data[tFrameCount] + 128) & 0xff, 40));
  if (task.data[tFrameCount] >= 128) {
    [s.bgToReveal, s.bgToHide] = [s.bgToHide, s.bgToReveal];
    task.data[tState]++;
  }
  return false;
}

function PageSwapAnimState_Done(_task: Task): boolean {
  DestroyTask(FindTaskIdByFunc(Task_HandlePageSwapAnim));
  return false;
}

// ------------------------------------------------------------------ button flash

const tButtonId = 0;
const tKeepFlashing = 1;
const tAllowFlash = 2;
const tColor = 3;
const tColorIncr = 4;
const tColorDelay = 5;
const tColorDelta = 6;

function CreateButtonFlashTask(): void {
  const taskId = CreateTask(Task_UpdateButtonFlash, 3);
  gTasks[taskId].data[tButtonId] = BUTTON_COUNT;
}

function TryStartButtonFlash(button: number, keepFlashing: boolean, interruptCurFlash: boolean): void {
  const task = gTasks[FindTaskIdByFunc(Task_UpdateButtonFlash)];
  const d = task.data;

  if (button === d[tButtonId] && !interruptCurFlash) {
    d[tKeepFlashing] = keepFlashing ? 1 : 0;
    d[tAllowFlash] = 1;
    return;
  }
  if (button === BUTTON_COUNT && !d[tKeepFlashing] && !interruptCurFlash) return;

  if (d[tButtonId] !== BUTTON_COUNT) RestoreButtonColor(d[tButtonId]);
  StartButtonFlash(task, button, keepFlashing);
}

function Task_UpdateButtonFlash(taskId: number): void {
  const d = gTasks[taskId].data;

  if (d[tButtonId] === BUTTON_COUNT || !d[tAllowFlash]) return;

  MultiplyInvertedPaletteRGBComponents(GetButtonPalOffset(d[tButtonId]), d[tColor], d[tColor], d[tColor]);

  if (d[tColorDelay] && --d[tColorDelay]) return;

  d[tColorDelay] = 2;
  if (d[tColorIncr] >= 0) {
    if (d[tColor] < 14) {
      d[tColor] += d[tColorIncr];
      d[tColorDelta] += d[tColorIncr];
    } else {
      d[tColor] = 16;
      d[tColorDelta]++;
    }
  } else {
    d[tColor] += d[tColorIncr];
    d[tColorDelta] += d[tColorIncr];
  }

  if (d[tColor] === 16 && d[tColorDelta] === 22) {
    d[tColorIncr] = -4;
  } else if (d[tColor] === 0) {
    d[tAllowFlash] = d[tKeepFlashing];
    d[tColorIncr] = 2;
    d[tColorDelta] = 0;
  }
}

function GetButtonPalOffset(button: number): number {
  const palOffsets = [
    OBJ_PLTT_ID(IndexOfSpritePaletteTag(PALTAG_PAGE_SWAP)) + 14, // BUTTON_PAGE
    OBJ_PLTT_ID(IndexOfSpritePaletteTag(PALTAG_BACK_BUTTON)) + 14, // BUTTON_BACK
    OBJ_PLTT_ID(IndexOfSpritePaletteTag(PALTAG_OK_BUTTON)) + 14, // BUTTON_OK
    OBJ_PLTT_ID(IndexOfSpritePaletteTag(PALTAG_OK_BUTTON)) + 1, // BUTTON_COUNT
  ];
  return palOffsets[button];
}

function RestoreButtonColor(button: number): void {
  const index = GetButtonPalOffset(button);
  gPlttBufferFaded[index] = gPlttBufferUnfaded[index];
}

function StartButtonFlash(task: Task, button: number, keepFlashing: boolean): void {
  const d = task.data;
  d[tButtonId] = button;
  d[tKeepFlashing] = keepFlashing ? 1 : 0;
  d[tAllowFlash] = 1;
  d[tColor] = 4;
  d[tColorIncr] = 2;
  d[tColorDelay] = 0;
  d[tColorDelta] = 4;
}

// ------------------------------------------------------------------ cursor

// Sprite data for the cursor
const sX = 0;
const sY = 1;
const sPrevX = 2;
const sPrevY = 3;
// data[4]: sInvisible (low byte), sFlashing (high byte)
const sColor = 5;
const sColorIncr = 6;
const sColorDelay = 7;
const sInvisible = (sprite: Sprite) => sprite.data[4] & 0x00ff;
const sFlashing = (sprite: Sprite) => sprite.data[4] & 0xff00;

function SpriteCB_Cursor(sprite: Sprite): void {
  const d = sprite.data;
  if (sprite.animEnded) StartSpriteAnim(sprite, 0);

  // Hide cursor when on button column
  sprite.invisible = sInvisible(sprite) !== 0;
  if (d[sX] === GetCurrentPageColumnCount()) sprite.invisible = true;

  if (sprite.invisible || !sFlashing(sprite) || d[sX] !== d[sPrevX] || d[sY] !== d[sPrevY]) {
    d[sColor] = 0;
    d[sColorIncr] = 2;
    d[sColorDelay] = 2;
  }

  d[sColorDelay]--;
  if (d[sColorDelay] === 0) {
    d[sColor] += d[sColorIncr];
    if (d[sColor] === 16 || d[sColor] === 0) d[sColorIncr] = -d[sColorIncr];
    d[sColorDelay] = 2;
  }

  if (sFlashing(sprite)) {
    const gb = d[sColor];
    const r = d[sColor] >> 1;
    const index = OBJ_PLTT_ID(IndexOfSpritePaletteTag(PALTAG_CURSOR)) + 1;
    MultiplyInvertedPaletteRGBComponents(index, r, gb, gb);
  }
}

function SpriteCB_InputArrow(sprite: Sprite): void {
  const sDelay = 0;
  const sXPosId = 1;
  const x = [0, -4, -2, -1];
  const d = sprite.data;

  if (d[sDelay] === 0 || --d[sDelay] === 0) {
    d[sDelay] = 8;
    d[sXPosId] = (d[sXPosId] + 1) & (x.length - 1);
  }
  sprite.x2 = x[d[sXPosId]];
}

function SpriteCB_Underscore(sprite: Sprite): void {
  const sId = 0; // set in CreateTextEntrySprites
  const sYPosId = 1;
  const sDelay = 2;
  const y = [2, 3, 2, 1];
  const d = sprite.data;
  const pos = GetTextEntryPosition();

  if (pos !== (d[sId] & 0xff)) {
    sprite.y2 = 0;
    d[sYPosId] = 0;
    d[sDelay] = 0;
  } else {
    sprite.y2 = y[d[sYPosId]];
    d[sDelay]++;
    if (d[sDelay] > 8) {
      d[sYPosId] = (d[sYPosId] + 1) & (y.length - 1);
      d[sDelay] = 0;
    }
  }
}

function CreateSprites(): void {
  CreateCursorSprite();
  CreatePageSwapButtonSprites();
  CreateBackOkSprites();
  CreateTextEntrySprites();
  CreateInputTargetIcon();
}

function CreateCursorSprite(): void {
  const s = S();
  s.cursorSpriteId = CreateSprite(sSpriteTemplate_Cursor(), 38, 88, 1);
  SetCursorInvisibility(true);
  const cursor = gSprites[s.cursorSpriteId];
  cursor.oam.priority = 1;
  cursor.oam.objMode = ST_OAM_OBJ_BLEND;
  cursor.data[sColorIncr] = 1; // ? immediately overwritten
  cursor.data[sColorIncr] = 2;
  SetCursorPos(0, 0);
}

function SetCursorPos(x: number, y: number): void {
  const cursorSprite = gSprites[S().cursorSpriteId];
  const d = cursorSprite.data;

  if (x < sPageColumnCounts[CurrentPageToKeyboardId()]) cursorSprite.x = sPageColumnXPos[CurrentPageToKeyboardId()][x] + 38;
  else cursorSprite.x = 0;

  cursorSprite.y = y * 16 + 88;
  d[sPrevX] = d[sX];
  d[sPrevY] = d[sY];
  d[sX] = x;
  d[sY] = y;
}

function GetCursorPos(): [number, number] {
  const d = gSprites[S().cursorSpriteId].data;
  return [d[sX], d[sY]];
}

function MoveCursorToOKButton(): void {
  SetCursorPos(GetCurrentPageColumnCount(), 2);
}

function SetCursorInvisibility(invisible: boolean): void {
  const cursor = gSprites[S().cursorSpriteId];
  cursor.data[4] &= 0xff00;
  cursor.data[4] |= invisible ? 1 : 0; // sInvisible
  StartSpriteAnim(cursor, 0);
}

function SetCursorFlashing(flashing: boolean): void {
  const cursor = gSprites[S().cursorSpriteId];
  cursor.data[4] &= 0xff;
  cursor.data[4] |= (flashing ? 1 : 0) << 8; // sFlashing
}

function SquishCursor(): void {
  StartSpriteAnim(gSprites[S().cursorSpriteId], 1);
}

function IsCursorAnimFinished(): boolean {
  return gSprites[S().cursorSpriteId].animEnded;
}

const sButtonKeyRoles = [KEY_ROLE_PAGE, KEY_ROLE_BACKSPACE, KEY_ROLE_OK];

function GetKeyRoleAtCursorPos(): number {
  const [cursorX, cursorY] = GetCursorPos();
  if (cursorX < GetCurrentPageColumnCount()) return KEY_ROLE_CHAR;
  else return sButtonKeyRoles[cursorY];
}

/** If the cursor's x is equal to the column count, the cursor is in the button column. */
function GetCurrentPageColumnCount(): number {
  return sPageColumnCounts[CurrentPageToKeyboardId()];
}

// Page swap button sprites (the frame sprite's data)
const sState = 0;
const sPage = 1;
const sTextSpriteId = 6;
const sButtonSpriteId = 7;

function CreatePageSwapButtonSprites(): void {
  const frameSpriteId = CreateSprite(sSpriteTemplate_PageSwapFrame(), 204, 88, 0);
  S().swapBtnFrameSpriteId = frameSpriteId;
  SetSubspriteTables(gSprites[frameSpriteId], sSubspriteTable_PageSwapFrame);
  gSprites[frameSpriteId].invisible = true;

  const textSpriteId = CreateSprite(sSpriteTemplate_PageSwapText(), 204, 84, 1);
  gSprites[frameSpriteId].data[sTextSpriteId] = textSpriteId;
  SetSubspriteTables(gSprites[textSpriteId], sSubspriteTable_PageSwapText);
  gSprites[textSpriteId].invisible = true;

  const buttonSpriteId = CreateSprite(sSpriteTemplate_PageSwapButton(), 204, 83, 2);
  gSprites[buttonSpriteId].oam.priority = 1;
  gSprites[frameSpriteId].data[sButtonSpriteId] = buttonSpriteId;
  gSprites[buttonSpriteId].invisible = true;
}

function StartPageSwapButtonAnim(): void {
  const sprite = gSprites[S().swapBtnFrameSpriteId];
  sprite.data[sState] = 2; // go to PageSwapSprite_SlideOff
  sprite.data[sPage] = S().currentPage;
}

const sPageSwapSpriteFuncs: ((sprite: Sprite) => boolean)[] = [PageSwapSprite_Init, PageSwapSprite_Idle, PageSwapSprite_SlideOff, PageSwapSprite_SlideOn];

function SpriteCB_PageSwap(sprite: Sprite): void {
  while (sPageSwapSpriteFuncs[sprite.data[sState]](sprite));
}

function PageSwapSprite_Init(sprite: Sprite): boolean {
  const textSprite = gSprites[sprite.data[sTextSpriteId]];
  const button = gSprites[sprite.data[sButtonSpriteId]];
  SetPageSwapButtonGfx(PageToNextGfxId(S().currentPage), textSprite, button);
  sprite.data[sState]++;
  return false;
}

function PageSwapSprite_Idle(_sprite: Sprite): boolean {
  return false;
}

function PageSwapSprite_SlideOff(sprite: Sprite): boolean {
  const textSprite = gSprites[sprite.data[sTextSpriteId]];
  const button = gSprites[sprite.data[sButtonSpriteId]];

  if (++textSprite.y2 > 7) {
    sprite.data[sState]++;
    textSprite.y2 = -4;
    textSprite.invisible = true;
    SetPageSwapButtonGfx(PageToNextGfxId(((sprite.data[sPage] & 0xff) + 1) % KBPAGE_COUNT), textSprite, button);
  }
  return false;
}

function PageSwapSprite_SlideOn(sprite: Sprite): boolean {
  const textSprite = gSprites[sprite.data[sTextSpriteId]];

  textSprite.invisible = false;
  if (++textSprite.y2 >= 0) {
    textSprite.y2 = 0;
    sprite.data[sState] = 1; // go to PageSwapSprite_Idle
  }
  return false;
}

const sPageSwapPalTags = [PALTAG_PAGE_SWAP_UPPER, PALTAG_PAGE_SWAP_OTHERS, PALTAG_PAGE_SWAP_LOWER]; // [PAGE_SWAP_*]
const sPageSwapGfxTags = [GFXTAG_PAGE_SWAP_UPPER, GFXTAG_PAGE_SWAP_OTHERS, GFXTAG_PAGE_SWAP_LOWER];

function SetPageSwapButtonGfx(page: number, textSprite: Sprite, button: Sprite): void {
  button.oam.paletteNum = IndexOfSpritePaletteTag(sPageSwapPalTags[page]);
  textSprite.sheetTileStart = GetSpriteTileStartByTag(sPageSwapGfxTags[page]);
  textSprite.subspriteTableNum = page;
}

function CreateBackOkSprites(): void {
  let spriteId = CreateSprite(sSpriteTemplate_BackButton(), 204, 116, 0);
  SetSubspriteTables(gSprites[spriteId], sSubspriteTable_Button);
  gSprites[spriteId].invisible = true;

  spriteId = CreateSprite(sSpriteTemplate_OkButton(), 204, 140, 0);
  SetSubspriteTables(gSprites[spriteId], sSubspriteTable_Button);
  gSprites[spriteId].invisible = true;
}

function CreateTextEntrySprites(): void {
  const s = S();
  let xPos = s.inputCharBaseXPos - 5;
  let spriteId = CreateSprite(sSpriteTemplate_InputArrow(), xPos, 56, 0);
  gSprites[spriteId].oam.priority = 3;
  gSprites[spriteId].invisible = true;
  xPos = s.inputCharBaseXPos;
  for (let i = 0; i < s.template.maxChars; i++, xPos += 8) {
    spriteId = CreateSprite(sSpriteTemplate_Underscore(), xPos + 3, 60, 0);
    gSprites[spriteId].oam.priority = 3;
    gSprites[spriteId].data[0] = i;
    gSprites[spriteId].invisible = true;
  }
}

// ------------------------------------------------------------------ icon (the thing being named)

const sIconFunctions = [NamingScreen_NoIcon, NamingScreen_CreatePlayerIcon, NamingScreen_CreatePCIcon, NamingScreen_CreateMonIcon, NamingScreen_CreateRivalIcon];

function CreateInputTargetIcon(): void {
  sIconFunctions[S().template.iconFunction]();
}

function NamingScreen_NoIcon(): void {}

/** sPlayerAvatarGfxIds[PLAYER_AVATAR_GFX_NORMAL] (field_player_avatar.c), by gender */
const sPlayerNormalGfxIds = ['OBJ_EVENT_GFX_RED_NORMAL', 'OBJ_EVENT_GFX_GREEN_NORMAL'];

function NamingScreen_CreatePlayerIcon(): void {
  // monSpecies holds the player's gender here (GetRivalAvatarGraphicsIdByStateIdAndGender)
  const rivalGfxId = sPlayerNormalGfxIds[S().monSpecies];
  const spriteId = CreateObjectGraphicsSprite(rivalGfxId, SpriteCallbackDummy, 56, 37, 0);
  gSprites[spriteId].oam.priority = 3;
  StartSpriteAnim(gSprites[spriteId], K.ANIM_STD_GO_SOUTH);
}

function NamingScreen_CreatePCIcon(): void {
  const spriteId = CreateSprite(sSpriteTemplate_PCIcon(), 56, 41, 0);
  SetSubspriteTables(gSprites[spriteId], sSubspriteTable_PCIcon);
  gSprites[spriteId].oam.priority = 3;
}

function NamingScreen_CreateMonIcon(): void {
  LoadMonIconPalettes();
  const spriteId = CreateMonIcon(S().monSpecies, SpriteCallbackDummy, 56, 40, 0, S().monPersonality, true);
  gSprites[spriteId].oam.priority = 3;
}

const sAnim_Rival: AnimCmd[] = [ANIMCMD_FRAME(0, 10), ANIMCMD_FRAME(24, 10), ANIMCMD_FRAME(0, 10), ANIMCMD_FRAME(32, 10), ANIMCMD_JUMP(0)];
const sAnims_Rival = [sAnim_Rival];

function NamingScreen_CreateRivalIcon(): void {
  const sheet = { data: gfx('sRival_Gfx'), size: 0x900, tag: GFXTAG_RIVAL };
  const palette = { data: gfx16('gNamingScreenRival_Pal'), tag: PALTAG_RIVAL };
  const template = CopyObjectGraphicsInfoToSpriteTemplate('OBJ_EVENT_GFX_RED_NORMAL', SpriteCallbackDummy);

  template.tileTag = sheet.tag;
  template.paletteTag = palette.tag;
  template.anims = sAnims_Rival;
  LoadSpriteSheet(sheet);
  LoadSpritePalette(palette);
  const spriteId = CreateSprite(template, 56, 37, 0);
  gSprites[spriteId].oam.priority = 3;
}

// ------------------------------------------------------------------ keyboard

const sKeyboardKeyHandlers: ((input: number) => boolean)[] = [
  KeyboardKeyHandler_Character, // KEY_ROLE_CHAR
  KeyboardKeyHandler_Page, // KEY_ROLE_PAGE
  KeyboardKeyHandler_Backspace, // KEY_ROLE_BACKSPACE
  KeyboardKeyHandler_OK, // KEY_ROLE_OK
];

function HandleKeyboardEvent(): boolean {
  const input = GetInputEvent();
  const keyRole = GetKeyRoleAtCursorPos();

  if (input === INPUT_SELECT) {
    return SwapKeyboardPage();
  } else if (input === INPUT_B_BUTTON) {
    DeleteTextCharacter();
    return false;
  } else if (input === INPUT_START) {
    MoveCursorToOKButton();
    return false;
  } else {
    return sKeyboardKeyHandlers[keyRole](input);
  }
}

function KeyboardKeyHandler_Character(input: number): boolean {
  TryStartButtonFlash(BUTTON_COUNT, false, false);
  if (input === INPUT_A_BUTTON) {
    const textFull = AddTextCharacter();

    SquishCursor();
    if (textFull) {
      SetInputState(INPUT_STATE_DISABLED);
      S().state = STATE_MOVE_TO_OK_BUTTON;
    }
  }
  return false;
}

function KeyboardKeyHandler_Page(input: number): boolean {
  TryStartButtonFlash(BUTTON_PAGE, true, false);
  if (input === INPUT_A_BUTTON) return SwapKeyboardPage();
  else return false;
}

function KeyboardKeyHandler_Backspace(input: number): boolean {
  TryStartButtonFlash(BUTTON_BACK, true, false);
  if (input === INPUT_A_BUTTON) DeleteTextCharacter();
  return false;
}

function KeyboardKeyHandler_OK(input: number): boolean {
  TryStartButtonFlash(BUTTON_OK, true, false);
  if (input === INPUT_A_BUTTON) {
    PlaySE(K.SE_SELECT);
    S().state = STATE_PRESSED_OK;
    return true;
  } else {
    return false;
  }
}

function SwapKeyboardPage(): boolean {
  S().state = STATE_START_PAGE_SWAP;
  return true;
}

// ------------------------------------------------------------------ input handling

const tInputState = 0;
const tKeyboardEvent = 1;
const tInputButtonId = 2;

const sInputFuncs = [Input_Disabled, Input_Enabled]; // [INPUT_STATE_*]

function CreateInputHandlerTask(): void {
  CreateTask(Task_HandleInput, 1);
}

function GetInputEvent(): number {
  const taskId = FindTaskIdByFunc(Task_HandleInput);
  return gTasks[taskId].data[tKeyboardEvent];
}

function SetInputState(inputState: number): void {
  const taskId = FindTaskIdByFunc(Task_HandleInput);
  gTasks[taskId].data[tInputState] = inputState;
}

function Task_HandleInput(taskId: number): void {
  sInputFuncs[gTasks[taskId].data[tInputState]](gTasks[taskId]);
}

function Input_Disabled(task: Task): void {
  task.data[tKeyboardEvent] = INPUT_NONE;
}

function Input_Enabled(task: Task): void {
  task.data[tKeyboardEvent] = INPUT_NONE;

  if (JOY_NEW(A_BUTTON)) task.data[tKeyboardEvent] = INPUT_A_BUTTON;
  else if (JOY_NEW(B_BUTTON)) task.data[tKeyboardEvent] = INPUT_B_BUTTON;
  else if (JOY_NEW(SELECT_BUTTON)) task.data[tKeyboardEvent] = INPUT_SELECT;
  else if (JOY_NEW(START_BUTTON)) task.data[tKeyboardEvent] = INPUT_START;
  else HandleDpadMovement(task);
}

const sDpadDeltaX = [0, 0, 0, -1, 1]; // [INPUT_NONE..INPUT_DPAD_RIGHT]
const sDpadDeltaY = [0, -1, 1, 0, 0];
const sKeyRowToButtonRow = [0, 1, 1, 2];
const sButtonRowToKeyRow = [0, 0, 3];

function HandleDpadMovement(task: Task): void {
  let [cursorX, cursorY] = GetCursorPos();
  let input = INPUT_NONE;
  if (JOY_REPT(DPAD_UP)) input = INPUT_DPAD_UP;
  if (JOY_REPT(DPAD_DOWN)) input = INPUT_DPAD_DOWN;
  if (JOY_REPT(DPAD_LEFT)) input = INPUT_DPAD_LEFT;
  if (JOY_REPT(DPAD_RIGHT)) input = INPUT_DPAD_RIGHT;

  // Get new cursor position
  const prevCursorX = cursorX;
  cursorX += sDpadDeltaX[input];
  cursorY += sDpadDeltaY[input];

  // Wrap cursor position in the X direction
  if (cursorX < 0) cursorX = GetCurrentPageColumnCount();
  if (cursorX > GetCurrentPageColumnCount()) cursorX = 0;

  // Handle moving on/off the button column
  if (sDpadDeltaX[input] !== 0) {
    if (cursorX === GetCurrentPageColumnCount()) {
      // Moved onto button column: save the row in tButtonId for moving back onto keys
      task.data[tInputButtonId] = cursorY;
      cursorY = sKeyRowToButtonRow[cursorY];
    } else if (prevCursorX === GetCurrentPageColumnCount()) {
      // Moved off button column: from the middle button, go back to the row the cursor was on
      if (cursorY === Math.trunc(BUTTON_COUNT / 2)) cursorY = task.data[tInputButtonId];
      else cursorY = sButtonRowToKeyRow[cursorY];
    }
  }

  // Wrap cursor position in the y direction
  if (cursorX === GetCurrentPageColumnCount()) {
    // There are only 3 keys in the button column, so wrap Y accordingly
    if (cursorY < 0) cursorY = BUTTON_COUNT - 1;
    if (cursorY >= BUTTON_COUNT) cursorY = 0;

    if (cursorY === 0) task.data[tInputButtonId] = BUTTON_BACK;
    else if (cursorY === BUTTON_COUNT - 1) task.data[tInputButtonId] = BUTTON_OK;
  } else {
    if (cursorY < 0) cursorY = KBROW_COUNT - 1;
    if (cursorY >= KBROW_COUNT) cursorY = 0;
  }
  SetCursorPos(cursorX, cursorY);
}

// ------------------------------------------------------------------ text entry

function DrawNormalTextEntryBox(): void {
  const s = S();
  FillWindowPixelBuffer(s.windows[WIN_TEXT_ENTRY_BOX], PIXEL_FILL(1));
  AddTextPrinterParameterized(s.windows[WIN_TEXT_ENTRY_BOX], K.FONT_NORMAL_COPY_1, text(s.template.title), 1, 1, 0);
  PutWindowTilemap(s.windows[WIN_TEXT_ENTRY_BOX]);
}

function DrawMonTextEntryBox(): void {
  const s = S();
  // StringCopy + StringAppendN(buffer, title, 15)
  const buffer = [...strBody(speciesName(s.monSpecies)), ...strBody(text(s.template.title)).slice(0, 14), EOS];
  FillWindowPixelBuffer(s.windows[WIN_TEXT_ENTRY_BOX], PIXEL_FILL(1));
  AddTextPrinterParameterized(s.windows[WIN_TEXT_ENTRY_BOX], K.FONT_NORMAL_COPY_1, buffer, 1, 1, 0);
  PutWindowTilemap(s.windows[WIN_TEXT_ENTRY_BOX]);
}

const sDrawTextEntryBoxFuncs = [
  DrawNormalTextEntryBox, // NAMING_SCREEN_PLAYER
  DrawNormalTextEntryBox, // NAMING_SCREEN_BOX
  DrawMonTextEntryBox, // NAMING_SCREEN_CAUGHT_MON
  DrawMonTextEntryBox, // NAMING_SCREEN_NICKNAME
  DrawNormalTextEntryBox, // NAMING_SCREEN_RIVAL
];

function DrawTextEntryBox(): void {
  sDrawTextEntryBoxFuncs[S().templateNum]();
}

function TryDrawGenderIcon(): void {
  if (S().template.addGenderIcon) DrawGenderIcon();
}

// sGenderColors[MALE / FEMALE]
const sGenderColors = () => [
  [TEXT_COLOR_TRANSPARENT, K.TEXT_COLOR_LIGHT_BLUE, K.TEXT_COLOR_BLUE],
  [TEXT_COLOR_TRANSPARENT, K.TEXT_COLOR_LIGHT_RED, K.TEXT_COLOR_RED],
];

function DrawGenderIcon(): void {
  const s = S();
  let genderSymbol = text('gText_MaleSymbol');
  let gender = K.MALE;

  if (s.monGender !== K.MON_GENDERLESS) {
    if (s.monGender === K.MON_FEMALE) {
      genderSymbol = text('gText_FemaleSymbol');
      gender = K.FEMALE;
    }
    AddTextPrinterParameterized3(s.windows[2], K.FONT_NORMAL, 0x68, 1, sGenderColors()[gender], TEXT_SKIP_DRAW, genderSymbol);
  }
}

function GetCharAtKeyboardPos(x: number, y: number): number {
  return keyboardChars()[CurrentPageToKeyboardId()][y][x];
}

function GetTextEntryPosition(): number {
  const s = S();
  for (let i = 0; i < s.template.maxChars; i++) {
    if (s.textBuffer[i] === EOS) return i;
  }
  return s.template.maxChars - 1;
}

function GetPreviousTextCaretPosition(): number {
  const s = S();
  for (let i = s.template.maxChars - 1; i > 0; i--) {
    if (s.textBuffer[i] !== EOS) return i;
  }
  return 0;
}

function DeleteTextCharacter(): void {
  const s = S();
  const index = GetPreviousTextCaretPosition();
  // Temporarily make this a space for redrawing purposes
  s.textBuffer[index] = K.CHAR_SPACE;
  DrawTextEntry();
  CopyBgTilemapBufferToVram(3);
  s.textBuffer[index] = EOS;
  const keyRole = GetKeyRoleAtCursorPos();

  // The below flashes the Back key once on delete.
  // It incorrectly leaves the Back key 1 shade lighter than its default.
  if (keyRole === KEY_ROLE_CHAR || keyRole === KEY_ROLE_BACKSPACE) TryStartButtonFlash(BUTTON_BACK, false, true);
  PlaySE(K.SE_BALL);
}

/** Returns TRUE if the text entry is now full. */
function AddTextCharacter(): boolean {
  const [x, y] = GetCursorPos();
  BufferCharacter(GetCharAtKeyboardPos(x, y));
  DrawTextEntry();
  CopyBgTilemapBufferToVram(3);
  PlaySE(K.SE_SELECT);

  return GetPreviousTextCaretPosition() === S().template.maxChars - 1;
}

function BufferCharacter(ch: number): void {
  S().textBuffer[GetTextEntryPosition()] = ch;
}

function SaveInputText(): void {
  const s = S();
  // Copy from the first non-whitespace character
  for (let i = 0; i < s.template.maxChars; i++) {
    if (s.textBuffer[i] !== K.CHAR_SPACE && s.textBuffer[i] !== EOS) {
      StringCopyN(s.destBuffer, s.textBuffer, s.template.maxChars + 1);
      break;
    }
  }
}

/** StringCopy into the caller's buffer, in place. */
function StringCopy(dest: number[], src: number[]): void {
  const body = strBody(src);
  dest.length = 0;
  dest.push(...body, EOS);
}

/** StringCopyN: `n` bytes, which may stop short of the EOS. */
function StringCopyN(dest: number[], src: number[], n: number): void {
  for (let i = 0; i < n; i++) dest[i] = src[i];
}

function LoadGfx(): void {
  const s = S();
  s.tileBuffer.set(gfx('gNamingScreenMenu_Gfx').subarray(0, s.tileBuffer.length)); // LZ77UnCompWram
  LoadBgTiles(1, s.tileBuffer, s.tileBuffer.length, 0);
  LoadBgTiles(2, s.tileBuffer, s.tileBuffer.length, 0);
  LoadBgTiles(3, s.tileBuffer, s.tileBuffer.length, 0);
  for (const sheet of sSpriteSheets()) LoadSpriteSheet(sheet);
  for (const palette of sSpritePalettes()) LoadSpritePalette(palette);
}

function CreateHelperTasks(): void {
  CreateInputHandlerTask();
  CreateButtonFlashTask();
}

function LoadPalettes(): void {
  LoadPalette(gfx16('gNamingScreenMenu_Pal'), BG_PLTT_ID(0), 6 * 16 * 2);
  LoadPalette(gfx16('gNamingScreenKeyboard_Pal'), BG_PLTT_ID(10), PLTT_SIZE_4BPP);
  LoadPalette(GetTextWindowPalette(2), BG_PLTT_ID(11), PLTT_SIZE_4BPP);
}

function DecompressToBgTilemapBuffer(bg: number, symbol: string): void {
  CopyToBgTilemapBuffer(bg, gfx16(symbol), 0, 0);
}

function DrawTextEntry(): void {
  const s = S();
  const maxChars = s.template.maxChars;
  const xpos = s.inputCharBaseXPos - 0x40;

  FillWindowPixelBuffer(s.windows[WIN_TEXT_ENTRY], PIXEL_FILL(1));

  for (let i = 0; i < maxChars; i++) {
    const temp = [s.textBuffer[i], EOS]; // gExpandedPlaceholder_Empty[0]
    const extraWidth = IsWideLetter(temp[0]) ? 2 : 0;
    AddTextPrinterParameterized(s.windows[WIN_TEXT_ENTRY], K.FONT_NORMAL, temp, i * 8 + xpos + extraWidth, 1, TEXT_SKIP_DRAW);
  }

  TryDrawGenderIcon();
  CopyWindowToVram(s.windows[WIN_TEXT_ENTRY], COPYWIN_GFX);
  PutWindowTilemap(s.windows[WIN_TEXT_ENTRY]);
}

// sTextColorStruct rows: [TEXT_DYNAMIC_COLOR_4/5/6, TEXT_COLOR_WHITE, TEXT_COLOR_DARK_GRAY]
const sKeyboardTextColors = () => [
  [K.TEXT_DYNAMIC_COLOR_5, TEXT_COLOR_WHITE, TEXT_COLOR_DARK_GRAY], // KEYBOARD_LETTERS_LOWER
  [K.TEXT_DYNAMIC_COLOR_4, TEXT_COLOR_WHITE, TEXT_COLOR_DARK_GRAY], // KEYBOARD_LETTERS_UPPER
  [K.TEXT_DYNAMIC_COLOR_6, TEXT_COLOR_WHITE, TEXT_COLOR_DARK_GRAY], // KEYBOARD_SYMBOLS
];

const sFillValues = [PIXEL_FILL(14), PIXEL_FILL(13), PIXEL_FILL(15)]; // [KEYBOARD_*]

const sNamingScreenKeyboardText = [
  ['gText_NamingScreenKeyboard_abcdef', 'gText_NamingScreenKeyboard_ghijkl', 'gText_NamingScreenKeyboard_mnopqrs', 'gText_NamingScreenKeyboard_tuvwxyz'],
  ['gText_NamingScreenKeyboard_ABCDEF', 'gText_NamingScreenKeyboard_GHIJKL', 'gText_NamingScreenKeyboard_MNOPQRS', 'gText_NamingScreenKeyboard_TUVWXYZ'],
  ['gText_NamingScreenKeyboard_01234', 'gText_NamingScreenKeyboard_56789', 'gText_NamingScreenKeyboard_Symbols1', 'gText_NamingScreenKeyboard_Symbols2'],
];

function PrintKeyboardKeys(window: number, page: number): void {
  FillWindowPixelBuffer(window, sFillValues[page]);
  for (let i = 0; i < KBROW_COUNT; i++) {
    AddTextPrinterParameterized3(window, K.FONT_NORMAL_COPY_1, 0, i * 16 + 1, sKeyboardTextColors()[page], 0, text(sNamingScreenKeyboardText[page][i]));
  }
  PutWindowTilemap(window);
}

const sNextKeyboardPageTilemaps = byPage('gNamingScreenKeyboardUpper_Tilemap', 'gNamingScreenKeyboardLower_Tilemap', 'gNamingScreenKeyboardSymbols_Tilemap');

function DrawKeyboardPageOnDeck(): void {
  const s = S();
  const bg1Priority = GetGpuReg(REG_OFFSET_BG1CNT) & 3;
  const bg2Priority = GetGpuReg(REG_OFFSET_BG2CNT) & 3;
  let bgId: number;
  let windowId: number;

  if (bg1Priority > bg2Priority) {
    bgId = 1;
    windowId = s.windows[WIN_KB_PAGE_1];
  } else {
    bgId = 2;
    windowId = s.windows[WIN_KB_PAGE_2];
  }

  DecompressToBgTilemapBuffer(bgId, sNextKeyboardPageTilemaps[s.currentPage]);
  PrintKeyboardKeys(windowId, CurrentPageToNextKeyboardId());
  CopyBgTilemapBufferToVram(bgId);
}

function PrintControls(): void {
  const s = S();
  const color = [K.TEXT_DYNAMIC_COLOR_6, TEXT_COLOR_WHITE, TEXT_COLOR_DARK_GRAY];
  const str = text('gText_MoveOkBack');
  const strwidth = GetStringWidth(K.FONT_SMALL, str, 0);

  FillWindowPixelBuffer(s.windows[WIN_BANNER], PIXEL_FILL(15));
  AddTextPrinterParameterized3(s.windows[WIN_BANNER], K.FONT_SMALL, DISPLAY_WIDTH - 4 - strwidth, 0, color, 0, str);
  PutWindowTilemap(s.windows[WIN_BANNER]);
  CopyWindowToVram(s.windows[WIN_BANNER], COPYWIN_FULL);
}

function CB2_NamingScreen(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

function ResetVHBlank(): void {
  SetVBlankCallback(null);
  SetHBlankCallback(null);
}

function SetVBlank(): void {
  SetVBlankCallback(VBlankCB_NamingScreen);
}

function VBlankCB_NamingScreen(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
  const s = S();
  SetGpuReg(REG_OFFSET_BG1VOFS, s.bg1vOffset);
  SetGpuReg(REG_OFFSET_BG2VOFS, s.bg2vOffset);
  SetGpuReg(REG_OFFSET_BG1CNT, GetGpuReg(REG_OFFSET_BG1CNT) & 0xfffc); // clear priority bits
  SetGpuRegBits(REG_OFFSET_BG1CNT, s.bg1Priority);
  SetGpuReg(REG_OFFSET_BG2CNT, GetGpuReg(REG_OFFSET_BG2CNT) & 0xfffc);
  SetGpuRegBits(REG_OFFSET_BG2CNT, s.bg2Priority);
}

function NamingScreen_ShowBgs(): void {
  ShowBg(0);
  ShowBg(1);
  ShowBg(2);
  ShowBg(3);
}

/** IsWideLetter: gText_AlphabetUpperLower is empty in English, so always false. */
function IsWideLetter(character: number): boolean {
  const alphabet = text('gText_AlphabetUpperLower');
  for (let i = 0; alphabet[i] !== EOS; i++) {
    if (character === alphabet[i]) return true;
  }
  return false;
}

// ------------------------------------------------------------------ templates and graphics

let sTemplates: NamingScreenTemplate[] | undefined;
function sNamingScreenTemplates(): NamingScreenTemplate[] {
  if (sTemplates) return sTemplates;
  const player: NamingScreenTemplate = { copyExistingString: false, maxChars: K.PLAYER_NAME_LENGTH, iconFunction: 1, addGenderIcon: false, initialPage: KBPAGE_LETTERS_UPPER, title: 'gText_YourName' };
  const pcBox: NamingScreenTemplate = { copyExistingString: false, maxChars: K.BOX_NAME_LENGTH, iconFunction: 2, addGenderIcon: false, initialPage: KBPAGE_LETTERS_UPPER, title: 'gText_BoxName' };
  const mon: NamingScreenTemplate = { copyExistingString: false, maxChars: K.POKEMON_NAME_LENGTH, iconFunction: 3, addGenderIcon: true, initialPage: KBPAGE_LETTERS_UPPER, title: 'gText_PkmnsNickname' };
  const rival: NamingScreenTemplate = { copyExistingString: false, maxChars: K.PLAYER_NAME_LENGTH, iconFunction: 4, addGenderIcon: false, initialPage: KBPAGE_LETTERS_UPPER, title: 'gText_RivalsName' };
  sTemplates = [player, pcBox, mon, mon, rival]; // [NAMING_SCREEN_*]
  return sTemplates;
}

const sOam_8x8 = () => oam({ shape: SPRITE_SHAPE['8x8'][0], size: SPRITE_SHAPE['8x8'][1] });
const sOam_16x16 = () => oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1] });
const sOam_32x16 = () => oam({ shape: SPRITE_SHAPE['32x16'][0], size: SPRITE_SHAPE['32x16'][1] });

function subsprite(x: number, y: number, dims: keyof typeof SPRITE_SHAPE, tileOffset: number, priority: number): Subsprite {
  const [shape, size] = SPRITE_SHAPE[dims];
  return { x, y, shape, size, tileOffset, priority };
}

const sSubsprites_PageSwapFrame = [
  subsprite(-20, -16, '32x8', 0, 1),
  subsprite(12, -16, '8x8', 4, 1),
  subsprite(-20, -8, '32x8', 5, 1),
  subsprite(12, -8, '8x8', 9, 1),
  subsprite(-20, 0, '32x8', 10, 1),
  subsprite(12, 0, '8x8', 14, 1),
  subsprite(-20, 8, '32x8', 15, 1),
  subsprite(12, 8, '8x8', 19, 1),
];

const sSubsprites_PageSwapText = [subsprite(-12, -4, '16x8', 0, 1), subsprite(4, -4, '8x8', 2, 1)];

const sSubsprites_Button = [
  subsprite(-20, -12, '32x8', 0, 1),
  subsprite(12, -12, '8x8', 4, 1),
  subsprite(-20, -4, '32x8', 5, 1),
  subsprite(12, -4, '8x8', 9, 1),
  subsprite(-20, 4, '32x8', 10, 1),
  subsprite(12, 4, '8x8', 14, 1),
];

const sSubsprites_PCIcon = [subsprite(-8, -12, '16x8', 0, 3), subsprite(-8, -4, '16x8', 2, 3), subsprite(-8, 4, '16x8', 4, 3)];

const table = (subsprites: Subsprite[]): SubspriteTable => ({ subspriteCount: subsprites.length, subsprites });
const sSubspriteTable_PageSwapFrame = [table(sSubsprites_PageSwapFrame)];
const sSubspriteTable_PageSwapText = [table(sSubsprites_PageSwapText), table(sSubsprites_PageSwapText), table(sSubsprites_PageSwapText)];
const sSubspriteTable_Button = [table(sSubsprites_Button)];
const sSubspriteTable_PCIcon = [table(sSubsprites_PCIcon)];

const sAnim_Loop: AnimCmd[] = [ANIMCMD_FRAME(0, 1), ANIMCMD_JUMP(0)];
const sAnim_CursorSquish: AnimCmd[] = [ANIMCMD_FRAME(4, 8), ANIMCMD_FRAME(8, 8), ANIMCMD_END];
const sAnim_PCIcon: AnimCmd[] = [ANIMCMD_FRAME(0, 2), ANIMCMD_FRAME(1, 2), ANIMCMD_JUMP(0)];
const sAnims_Loop = [sAnim_Loop];
const sAnims_Cursor = [sAnim_Loop, sAnim_CursorSquish];
const sAnims_PCIcon = [sAnim_PCIcon];

function spriteTemplate(tileTag: number, paletteTag: number, oamData: ReturnType<typeof oam>, anims: AnimCmd[][], callback: SpriteTemplate['callback']): SpriteTemplate {
  return { tileTag, paletteTag, oam: oamData, anims, images: null, affineAnims: gDummySpriteAffineAnimTable, callback };
}

const sSpriteTemplate_PageSwapFrame = () => spriteTemplate(GFXTAG_PAGE_SWAP_FRAME, PALTAG_PAGE_SWAP, sOam_8x8(), sAnims_Loop, SpriteCB_PageSwap);
const sSpriteTemplate_PageSwapButton = () => spriteTemplate(GFXTAG_PAGE_SWAP_BUTTON, PALTAG_PAGE_SWAP_UPPER, sOam_32x16(), sAnims_Loop, SpriteCallbackDummy);
const sSpriteTemplate_PageSwapText = () => spriteTemplate(GFXTAG_PAGE_SWAP_UPPER, PALTAG_PAGE_SWAP, sOam_8x8(), sAnims_Loop, SpriteCallbackDummy);
const sSpriteTemplate_BackButton = () => spriteTemplate(GFXTAG_BACK_BUTTON, PALTAG_BACK_BUTTON, sOam_8x8(), sAnims_Loop, SpriteCallbackDummy);
const sSpriteTemplate_OkButton = () => spriteTemplate(GFXTAG_OK_BUTTON, PALTAG_OK_BUTTON, sOam_8x8(), sAnims_Loop, SpriteCallbackDummy);
const sSpriteTemplate_Cursor = () => spriteTemplate(GFXTAG_CURSOR, PALTAG_CURSOR, sOam_16x16(), sAnims_Cursor, SpriteCB_Cursor);
const sSpriteTemplate_InputArrow = () => spriteTemplate(GFXTAG_INPUT_ARROW, PALTAG_PAGE_SWAP_OTHERS, sOam_8x8(), sAnims_Loop, SpriteCB_InputArrow);
const sSpriteTemplate_Underscore = () => spriteTemplate(GFXTAG_UNDERSCORE, PALTAG_PAGE_SWAP_OTHERS, sOam_8x8(), sAnims_Loop, SpriteCB_Underscore);
const sSpriteTemplate_PCIcon = (): SpriteTemplate => ({
  ...spriteTemplate(TAG_NONE, PALTAG_MENU, sOam_8x8(), sAnims_PCIcon, SpriteCallbackDummy),
  images: ['sPCIconOff_Gfx', 'sPCIconOn_Gfx'].map((sym) => ({ data: gfx(sym), size: gfx(sym).length })), // sImageTable_PCIcon
});

function sSpriteSheets() {
  const sheet = (symbol: string, size: number, tag: number) => ({ data: gfx(symbol), size, tag });
  return [
    sheet('gNamingScreenBackButton_Gfx', 0x1e0, GFXTAG_BACK_BUTTON),
    sheet('gNamingScreenOKButton_Gfx', 0x1e0, GFXTAG_OK_BUTTON),
    sheet('gNamingScreenPageSwapFrame_Gfx', 0x280, GFXTAG_PAGE_SWAP_FRAME),
    sheet('gNamingScreenPageSwapButton_Gfx', 0x100, GFXTAG_PAGE_SWAP_BUTTON),
    sheet('gNamingScreenPageSwapUpper_Gfx', 0x060, GFXTAG_PAGE_SWAP_UPPER),
    sheet('gNamingScreenPageSwapLower_Gfx', 0x060, GFXTAG_PAGE_SWAP_LOWER),
    sheet('gNamingScreenPageSwapOthers_Gfx', 0x060, GFXTAG_PAGE_SWAP_OTHERS),
    sheet('gNamingScreenCursor_Gfx', 0x080, GFXTAG_CURSOR),
    sheet('gNamingScreenCursorSquished_Gfx', 0x080, GFXTAG_CURSOR_SQUISHED),
    sheet('gNamingScreenCursorFilled_Gfx', 0x080, GFXTAG_CURSOR_FILLED),
    sheet('gNamingScreenInputArrow_Gfx', 0x020, GFXTAG_INPUT_ARROW),
    sheet('gNamingScreenUnderscore_Gfx', 0x020, GFXTAG_UNDERSCORE),
  ];
}

function sSpritePalettes() {
  const menuPal = (i: number) => gfx16('gNamingScreenMenu_Pal').subarray(i * 16, i * 16 + 16); // gNamingScreenMenu_Pal[i]
  return [
    { data: menuPal(0), tag: PALTAG_MENU },
    { data: menuPal(1), tag: PALTAG_PAGE_SWAP_UPPER },
    { data: menuPal(2), tag: PALTAG_PAGE_SWAP_LOWER },
    { data: menuPal(3), tag: PALTAG_PAGE_SWAP_OTHERS },
    { data: menuPal(4), tag: PALTAG_PAGE_SWAP },
    { data: menuPal(5), tag: PALTAG_CURSOR },
    { data: menuPal(4), tag: PALTAG_BACK_BUTTON },
    { data: menuPal(4), tag: PALTAG_OK_BUTTON },
  ];
}

const NAMING_SCREEN_GFX = [
  'gNamingScreenMenu_Gfx',
  'gNamingScreenMenu_Pal',
  'gNamingScreenKeyboard_Pal',
  'gNamingScreenBackground_Tilemap',
  'gNamingScreenKeyboardUpper_Tilemap',
  'gNamingScreenKeyboardLower_Tilemap',
  'gNamingScreenKeyboardSymbols_Tilemap',
  'gNamingScreenBackButton_Gfx',
  'gNamingScreenOKButton_Gfx',
  'gNamingScreenPageSwapFrame_Gfx',
  'gNamingScreenPageSwapButton_Gfx',
  'gNamingScreenPageSwapUpper_Gfx',
  'gNamingScreenPageSwapLower_Gfx',
  'gNamingScreenPageSwapOthers_Gfx',
  'gNamingScreenCursor_Gfx',
  'gNamingScreenCursorSquished_Gfx',
  'gNamingScreenCursorFilled_Gfx',
  'gNamingScreenInputArrow_Gfx',
  'gNamingScreenUnderscore_Gfx',
  'gStandardMenuPalette',
  'gMenuMessageWindow_Gfx',
  'gTextWindowPalettes',
];

/**
 * The graphics DoNamingScreen loads for this template, to preload. The player and rival icons use
 * object event graphics, so setObjectEventGraphicsInfo must have run first.
 */
export function namingScreenGfxSymbols(templateNum: number, monSpecies = 0, monPersonality = 0): string[] {
  const syms = [...NAMING_SCREEN_GFX];
  if (templateNum === NAMING_SCREEN_PLAYER) syms.push(...objectEventGfxSymbols(sPlayerNormalGfxIds));
  if (templateNum === NAMING_SCREEN_RIVAL) syms.push(...objectEventGfxSymbols(['OBJ_EVENT_GFX_RED_NORMAL']), 'sRival_Gfx', 'gNamingScreenRival_Pal');
  if (templateNum === NAMING_SCREEN_BOX) syms.push('sPCIconOff_Gfx', 'sPCIconOn_Gfx');
  if (templateNum === NAMING_SCREEN_CAUGHT_MON || templateNum === NAMING_SCREEN_NICKNAME) {
    syms.push('gMonIconPalettes', monIconSymbol(GetIconSpecies(monSpecies, monPersonality)));
  }
  return syms;
}
