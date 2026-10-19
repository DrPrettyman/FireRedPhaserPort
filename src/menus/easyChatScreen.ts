// The Easy Chat screen on the GBA layer: easy_chat_2.c's task / CB2 wiring (DoEasyChatScreen, Task_InitEasyChat,
// Task_RunEasyChat with its fades, DismantleEasyChat, ShowEasyChatScreen's words by type) around the model in
// easyChatScreenModel.ts, and easy_chat_3.c: the graphics (graphics/easy_chat/ through the extractor),
// LoadEasyChatGraphics with the BG / window templates, the title, the instructions, the phrase frame
// (sPhraseFrameDimensions by frameId) and its fields, the DEL. ALL / CANCEL / OK footer, the bouncing triangle cursor,
// the START / SELECT button and scroll arrow sprites, the YES/NO window, the groups menu / A-Z keyboard / word list on
// window 2 (BG2, seen only through WIN0, which the green frame's resize animation sets), BG2's vertical scrolling,
// the red rectangle cursor, the mode window and the help (button window) sprites, and the interface commands
// ECInterfaceCmd_01-22.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import {
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  CopyToBgTilemapBuffer,
  FillBgTilemapBufferRect,
  FillBgTilemapBufferRect_Palette0,
  GetBgY,
  HideBg,
  InitBgsFromTemplates,
  IsDma3ManagerBusyWithBgCopy,
  LoadBgTiles,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  PALETTES_ALL,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  GetGpuReg,
  SetGpuReg,
  WIN_RANGE,
} from '../gba/hw';
import { gMain, SetMainCallback2, SetVBlankCallback, type MainCallback } from '../gba/main';
import { CreateYesNoMenu, DrawTextBorderOuter, LoadUserWindowGfx, Menu_ProcessInputNoWrapClearOnChoose } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { PlaySE } from '../gba/sound';
import {
  AnimateSprites,
  ANIMCMD_END,
  ANIMCMD_FRAME,
  BuildOamBuffer,
  CreateSprite,
  DestroySprite,
  FreeAllSpritePalettes,
  gDummySpriteAnimTable,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadCompressedSpriteSheet,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAnim,
  type AnimCmd,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, gTasks, ResetTasks, RunTasks, type TaskFunc } from '../gba/task';
import {
  AddTextPrinterParameterized,
  AddTextPrinterParameterized3,
  AddWindow,
  COPYWIN_FULL,
  COPYWIN_GFX,
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FillWindowPixelRect,
  FreeAllWindowBuffers,
  GetStringWidth,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  TEXT_SKIP_DRAW,
  type WindowTemplate,
} from '../gba/window';
import { EOS, EXT_CTRL_CODE_BEGIN } from '../text/charmap';
import { text } from './common';
import {
  CopyEasyChatWord,
  CopyEasyChatWordPadded,
  DestroyEasyChatSelectionData,
  GetDisplayedWordByIndex,
  GetEasyChatWordGroupName,
  GetNumDisplayableGroups,
  GetNumDisplayedWords,
  GetSelectedGroupByIndex,
  InitEasyChatSelection,
} from './easyChat';
import { EC, easyChatWordsForType } from './easyChatData';
import {
  EC_CMD,
  EasyChat_AllocateResources,
  EasyChat_FreeResources,
  EasyChat_OnLeave,
  EasyChatScreen_HandleJoypad,
  GetEasyChatConfirmCancelText,
  GetEasyChatConfirmDeletionText,
  GetEasyChatConfirmText,
  GetEasyChatInstructionsText,
  GetEasyChatScreen,
  GetEasyChatScreenFrameId,
  GetEasyChatWordBuffer,
  GetECSelectGroupCursorCoords,
  GetECSelectGroupRowsAbove,
  GetECSelectWordCursorCoords,
  GetECSelectWordNumRows,
  GetECSelectWordRowsAbove,
  GetMainCursorColumn,
  GetMainCursorRow,
  GetNumColumns,
  GetNumRows,
  GetTitleText,
  IsEasyChatAlphaMode,
  ShouldDrawECDownArrow,
  ShouldDrawECUpArrow,
} from './easyChatScreenModel';
import { CB2_ReturnToField, gFieldCallback } from './fieldCallbacks';

/** The graphics the screen draws (preloaded by runScreenFromScript). */
export const EASY_CHAT_GFX = [
  'gEasyChatWindow_Pal',
  'gEasyChatWindow_Gfx',
  'gEasyChatWindow_Tilemap',
  'gEasyChatButtonWindow_Pal',
  'gEasyChatButtonWindow_Gfx',
  'gEasyChatMode_Gfx',
  'gEasyChatRectangleCursor_Gfx',
  'sTriangleCursor_Pal',
  'sRectangleCursor_Pal',
  'sTriangleCursor_Gfx',
  'sScrollIndicator_Gfx',
  'sStartSelectButtons_Gfx',
  'sRSInterviewFrame_Pal',
  'sRSInterviewFrame_Gfx',
  'sTextInputFrameOrange_Pal',
  'sTextInputFrameGreen_Pal',
  'sTextInputFrame_Gfx',
  'sTitleText_Pal',
  'sText_Pal',
];

/** FONT_NORMAL_COPY_1 */
const FONT_NORMAL_COPY_1 = 1;

// characters.h
const CHAR_EXTRA_SYMBOL = 0xf9;
const CHAR_UNDERSCORE = 0x09;
const TEXT_COLOR_TRANSPARENT = 0;
const TEXT_COLOR_DARK_GRAY = 2;
const TEXT_COLOR_LIGHT_GRAY = 3;
const TEXT_COLOR_RED = 4;
const EXT_CTRL_CODE_COLOR = 0x01;
const EXT_CTRL_CODE_CLEAR = 0x11;

const EC_EMPTY_WORD = 0xffff;

// easy_chat_2.c's task data
const EZCHAT_TASK_STATE = 0;
const EZCHAT_TASK_TYPE = 1;

const GFXTAG_TRIANGLE_CURSOR = 0;
const GFXTAG_RECTANGLE_CURSOR = 1;
const GFXTAG_SCROLL_INDICATOR = 2;
const GFXTAG_START_SELECT_BUTTONS = 3;
const GFXTAG_MODE_WINDOW = 4;
const GFXTAG_RS_INTERVIEW_FRAME = 5;
const GFXTAG_BUTTON_WINDOW = 6;

const PALTAG_TRIANGLE_CURSOR = 0;
const PALTAG_RECTANGLE_CURSOR = 1;
const PALTAG_MISC_UI = 2;
const PALTAG_RS_INTERVIEW_FRAME = 3;

/** struct ECWork (sEasyChatGraphicsResources). ecPrintBuffer / ecPaddedWordBuffer are local arrays here. */
interface ECWork {
  state: number;
  windowId: number;
  id: number;
  /** the green frame's step in RedrawFrameByIndex (u8) */
  frameAnimIdx: number;
  frameAnimTarget: number;
  /** s8: +1 / -1 */
  frameAnimDelta: number;
  modeIconState: number;
  /** the word / group row at BG2's top (u16) */
  bg2ScrollRow: number;
  /** BG2's target y (8.8) and step per frame for AnimateBg2VerticalScroll */
  tgtBgY: number;
  deltaBgY: number;
  selectDestFieldCursorSprite: Sprite | null;
  rectCursorSpriteRight: Sprite | null;
  rectCursorSpriteLeft: Sprite | null;
  selectWordCursorSprite: Sprite | null;
  selectGroupHelpSprite: Sprite | null;
  modeIconsSprite: Sprite | null;
  upTriangleCursorSprite: Sprite | null;
  downTriangleCursorSprite: Sprite | null;
  startPgUpButtonSprite: Sprite | null;
  selectPgDnButtonSprite: Sprite | null;
  bg1TilemapBuffer: Uint16Array;
  bg3TilemapBuffer: Uint16Array;
}

let sEasyChatGraphicsResources: ECWork | null = null;

/** DoEasyChatScreen's words and callback (the task's word args in the C). */
let sTaskArgs: { words: number[]; callback: MainCallback } | null = null;

/** For the probe: the last command run, and the screen's task. */
let sLastCommand = 0;
let sCommandCount = 0;
let sTaskId = -1;

function res(): ECWork {
  if (!sEasyChatGraphicsResources) throw new Error('[easy chat] no graphics resources (InitEasyChatGraphicsWork)');
  return sEasyChatGraphicsResources;
}

// ------------------------------------------------------------------ easy_chat_3.c's data

/** sPhraseFrameDimensions: [left, top, width, height] by frameId (0 2x2, 1 2x3, 2 mail, 3 2x1, 4-5 unused). */
const sPhraseFrameDimensions: { left: number; top: number; width: number; height: number }[] = [
  { left: 3, top: 4, width: 24, height: 4 },
  { left: 1, top: 4, width: 27, height: 4 },
  { left: 3, top: 0, width: 24, height: 10 },
  { left: 6, top: 6, width: 18, height: 4 },
  { left: 16, top: 4, width: 9, height: 2 },
  { left: 14, top: 4, width: 18, height: 4 },
];

const sEasyChatBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 28, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 },
  { bg: 1, charBaseIndex: 3, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0 },
  { bg: 2, charBaseIndex: 0, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0x80 },
  { bg: 3, charBaseIndex: 2, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0 },
];

const sEasyChatWindowTemplates: WindowTemplate[] = [
  { bg: 1, tilemapLeft: 7, tilemapTop: 0, width: 16, height: 2, paletteNum: 10, baseBlock: 0x10 },
  { bg: 0, tilemapLeft: 4, tilemapTop: 15, width: 22, height: 4, paletteNum: 15, baseBlock: 0xa },
  { bg: 2, tilemapLeft: 1, tilemapTop: 0, width: 28, height: 32, paletteNum: 3, baseBlock: 0 },
  DUMMY_WIN_TEMPLATE,
];

const sEasyChatYesNoWindowTemplate: WindowTemplate = { bg: 0, tilemapLeft: 22, tilemapTop: 9, width: 5, height: 4, paletteNum: 15, baseBlock: 0x062 };

/** sText_Underscore: {UNDERSCORE} */
const sText_Underscore = [CHAR_EXTRA_SYMBOL, CHAR_UNDERSCORE, EOS];
/** sText_Clear17: {CLEAR 17} */
const sText_Clear17 = [EXT_CTRL_CODE_BEGIN, EXT_CTRL_CODE_CLEAR, 17];

/** sEasyChatKeyboardAlphabet (keyboard_text.c) */
const sEasyChatKeyboardAlphabet = ['gText_EasyChatKeyboard_ABCDEFothers', 'gText_EasyChatKeyboard_GHIJKL', 'gText_EasyChatKeyboard_MNOPQRS', 'gText_EasyChatKeyboard_TUVWXYZ'];

/** sAlphabetKeyboardColumnOffsets */
const sAlphabetKeyboardColumnOffsets = [0, 12, 24, 56, 68, 80, 92];

// The rectangle cursor's anims change its size to fit what it's on.
const RECTCURSOR_ANIM_ON_GROUP = 0;
const RECTCURSOR_ANIM_ON_BUTTON = 1;
const RECTCURSOR_ANIM_ON_OTHERS = 2;
const RECTCURSOR_ANIM_ON_LETTER = 3;

/** sAnims_RectangleCursor */
const sAnims_RectangleCursor: AnimCmd[][] = [
  [ANIMCMD_FRAME(0x00, 0), ANIMCMD_END],
  [ANIMCMD_FRAME(0x20, 0), ANIMCMD_END],
  [ANIMCMD_FRAME(0x40, 0), ANIMCMD_END],
  [ANIMCMD_FRAME(0x60, 0), ANIMCMD_END],
];

const sSpriteTemplate_RectangleCursor: SpriteTemplate = {
  tileTag: GFXTAG_RECTANGLE_CURSOR,
  paletteTag: PALTAG_RECTANGLE_CURSOR,
  oam: oam({ shape: SPRITE_SHAPE['64x32'][0], size: SPRITE_SHAPE['64x32'][1], priority: 1 }),
  anims: sAnims_RectangleCursor,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: (sprite) => SpriteCB_BounceCursor(sprite),
};

const MODEWINDOW_ANIM_TO_GROUP = 1;
const MODEWINDOW_ANIM_TO_ALPHABET = 2;
const MODEWINDOW_ANIM_TO_HIDDEN = 3;
const MODEWINDOW_ANIM_TRANSITION = 4;

/** sAnims_ModeWindow: hidden, to 'Group', to 'A-Z', to hidden, the transition frame. */
const sAnims_ModeWindow: AnimCmd[][] = [
  [ANIMCMD_FRAME(0x60, 0), ANIMCMD_END],
  [ANIMCMD_FRAME(0x40, 4), ANIMCMD_FRAME(0x20, 4), ANIMCMD_END],
  [ANIMCMD_FRAME(0x40, 4), ANIMCMD_FRAME(0x00, 4), ANIMCMD_END],
  [ANIMCMD_FRAME(0x40, 4), ANIMCMD_FRAME(0x60, 0), ANIMCMD_END],
  [ANIMCMD_FRAME(0x40, 4), ANIMCMD_END],
];

const sSpriteTemplate_ModeWindow: SpriteTemplate = {
  tileTag: GFXTAG_MODE_WINDOW,
  paletteTag: PALTAG_MISC_UI,
  oam: oam({ shape: SPRITE_SHAPE['64x32'][0], size: SPRITE_SHAPE['64x32'][1], priority: 1 }),
  anims: sAnims_ModeWindow,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

const sSpriteTemplate_ButtonWindow: SpriteTemplate = {
  tileTag: GFXTAG_BUTTON_WINDOW,
  paletteTag: PALTAG_MISC_UI,
  oam: oam({ shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1], priority: 3 }),
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

/** sAnims_TwoFrame: frame 0 is the START button, frame 1 SELECT (both the same arrow for the scroll indicators). */
const sAnims_TwoFrame: AnimCmd[][] = [
  [ANIMCMD_FRAME(0, 0), ANIMCMD_END],
  [ANIMCMD_FRAME(4, 0), ANIMCMD_END],
];

const sSpriteTemplate_TriangleCursor: SpriteTemplate = {
  tileTag: GFXTAG_TRIANGLE_CURSOR,
  paletteTag: PALTAG_TRIANGLE_CURSOR,
  oam: oam({ shape: SPRITE_SHAPE['8x8'][0], size: SPRITE_SHAPE['8x8'][1], priority: 3 }),
  anims: gDummySpriteAnimTable,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: (sprite) => SpriteCB_BounceCursor(sprite),
};

const sSpriteTemplate_StartSelectButtons: SpriteTemplate = {
  tileTag: GFXTAG_START_SELECT_BUTTONS,
  paletteTag: PALTAG_MISC_UI,
  oam: oam({ shape: SPRITE_SHAPE['32x8'][0], size: SPRITE_SHAPE['32x8'][1], priority: 1 }),
  anims: sAnims_TwoFrame,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

const sSpriteTemplate_ScrollIndicator: SpriteTemplate = {
  tileTag: GFXTAG_SCROLL_INDICATOR,
  paletteTag: PALTAG_MISC_UI,
  oam: oam({ shape: SPRITE_SHAPE['16x16'][0], size: SPRITE_SHAPE['16x16'][1], priority: 1 }),
  anims: sAnims_TwoFrame,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

// ------------------------------------------------------------------ easy_chat_2.c: the task and its callbacks

/**
 * ShowEasyChatScreen (easy_chat_2.c): the screen for VAR_0x8004's EASY_CHAT_TYPE_*, editing the saved words, back
 * through CB2_ReturnToFieldContinueScript (the mail type: VAR_0x8005's slot). Nothing for another type.
 */
export function ShowEasyChatScreen(): void {
  const type = state.getVar('VAR_0x8004');
  const words = easyChatWordsForType(state, type);
  if (!words) return;
  DoEasyChatScreen(type, words, CB2_ReturnToFieldContinueScript);
}

/**
 * CB2_ReturnToFieldContinueScript (overworld.c): gFieldCallback = FieldCB_ContinueScript, CB2_ReturnToField. The
 * field comes back black here and the script's next command (Common_ShowEasyChatScreen's `fadescreen
 * FADE_FROM_BLACK`) fades it in; see the ShowEasyChatScreen special.
 */
function CB2_ReturnToFieldContinueScript(): void {
  SetVBlankCallback(null); // FieldClearVBlankHBlankCallbacks
  gFieldCallback.fn = () => () => true;
  CB2_ReturnToField();
}

/** DoEasyChatScreen */
export function DoEasyChatScreen(type: number, words: number[], callback: MainCallback): void {
  ResetTasks();
  const taskId = CreateTask(Task_InitEasyChat, 0);
  sTaskId = taskId;
  sLastCommand = 0;
  gTasks[taskId].data[EZCHAT_TASK_TYPE] = type;
  sTaskArgs = { words, callback };
  SetMainCallback2(CB2_EasyChatScreen);
}

function CB2_EasyChatScreen(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

function VBlankCallback_EasyChatScreen(): void {
  TransferPlttBuffer();
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
}

function SetEasyChatTaskFunc(taskId: number, func: TaskFunc): void {
  gTasks[taskId].func = func;
  gTasks[taskId].data[EZCHAT_TASK_STATE] = 0;
}

/** Task_InitEasyChat: without a link, the whole setup in one frame. */
const Task_InitEasyChat: TaskFunc = (taskId) => {
  while (Task_InitEasyChatInternal(taskId));
  if (!sTaskArgs) return; // dismantled
  SetEasyChatTaskFunc(taskId, Task_RunEasyChat);
};

const Task_RunEasyChat: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  switch (data[EZCHAT_TASK_STATE]) {
    case 0:
      SetVBlankCallback(VBlankCallback_EasyChatScreen);
      BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
      BeginNormalPaletteFade(PALETTES_ALL, -1, 16, 0, RGB_BLACK);
      data[EZCHAT_TASK_STATE]++;
      break;
    case 1: {
      const action = EasyChatScreen_HandleJoypad({ newKeys: gMain.newKeys, newAndRepeatedKeys: gMain.newAndRepeatedKeys });
      if (action === EC_CMD.EXIT) {
        BeginNormalPaletteFade(PALETTES_ALL, -1, 0, 16, RGB_BLACK);
        data[EZCHAT_TASK_STATE] = 3;
      } else if (action !== EC_CMD.NONE) {
        PlaySE(K.SE_SELECT);
        EasyChatInterfaceCommand_Setup(action);
        data[EZCHAT_TASK_STATE]++;
      }
      break;
    }
    case 2:
      if (!EasyChatInterfaceCommand_Run()) data[EZCHAT_TASK_STATE] = 1;
      break;
    case 3:
      if (!gPaletteFade.active) {
        EasyChat_OnLeave(); // the questionnaire / profile passphrase compares, FLAG_SYS_SET_TRAINER_CARD_PROFILE
        DismantleEasyChat(sTaskArgs!.callback);
      }
      break;
  }
};

function Task_InitEasyChatInternal(taskId: number): boolean {
  const data = gTasks[taskId].data;
  switch (data[EZCHAT_TASK_STATE]) {
    case 0:
      SetVBlankCallback(null);
      ResetSpriteData();
      FreeAllSpritePalettes();
      ResetPaletteFade();
      break;
    case 1:
      if (!InitEasyChatSelection(state)) {
        DismantleEasyChat(sTaskArgs!.callback);
        return false;
      }
      break;
    case 2:
      if (!EasyChat_AllocateResources(state, data[EZCHAT_TASK_TYPE], sTaskArgs!.words, { processYesNoInput: Menu_ProcessInputNoWrapClearOnChoose })) {
        DismantleEasyChat(sTaskArgs!.callback);
        return false;
      }
      break;
    case 3:
      if (!InitEasyChatGraphicsWork()) {
        DismantleEasyChat(sTaskArgs!.callback);
        return false;
      }
      break;
    case 4:
      if (LoadEasyChatGraphics()) return true;
      break;
    default:
      return false;
  }
  data[EZCHAT_TASK_STATE]++;
  return true;
}

function DismantleEasyChat(callback: MainCallback): void {
  DestroyEasyChatSelectionData();
  EasyChat_FreeResources();
  DestroyEasyChatGraphicsResources();
  FreeAllWindowBuffers();
  sTaskArgs = null;
  SetMainCallback2(callback);
}

// ------------------------------------------------------------------ easy_chat_3.c: setup

/** InitEasyChatGraphicsWork (InitEasyChatGraphicsWork_Internal) */
function InitEasyChatGraphicsWork(): boolean {
  sEasyChatGraphicsResources = {
    state: 0,
    windowId: 0,
    id: 0,
    frameAnimIdx: 0,
    frameAnimTarget: 0,
    frameAnimDelta: 0,
    modeIconState: 0,
    bg2ScrollRow: 0,
    tgtBgY: 0,
    deltaBgY: 0,
    selectDestFieldCursorSprite: null,
    rectCursorSpriteRight: null,
    rectCursorSpriteLeft: null,
    selectWordCursorSprite: null,
    selectGroupHelpSprite: null,
    modeIconsSprite: null,
    upTriangleCursorSprite: null,
    downTriangleCursorSprite: null,
    startPgUpButtonSprite: null,
    selectPgDnButtonSprite: null,
    bg1TilemapBuffer: new Uint16Array(0x400),
    bg3TilemapBuffer: new Uint16Array(0x400),
  };
  return true;
}

/** LoadEasyChatGraphics: one step per call; false once done. */
function LoadEasyChatGraphics(): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      ResetBgsAndClearDma3BusyFlags(false);
      InitBgsFromTemplates(0, sEasyChatBgTemplates, sEasyChatBgTemplates.length);
      SetBgTilemapBuffer(3, r.bg3TilemapBuffer);
      SetBgTilemapBuffer(1, r.bg1TilemapBuffer);
      InitWindows(sEasyChatWindowTemplates);
      DeactivateAllTextPrinters();
      LoadEasyChatPals();
      SetGpuRegsForEasyChatInit();
      // CpuFastFill(0, OAM, 0x400): ResetSpriteData has cleared the OAM buffer
      break;
    case 1: {
      const tiles = gfx('gEasyChatWindow_Gfx'); // DecompressAndLoadBgGfxUsingHeap
      LoadBgTiles(3, tiles, tiles.length, 0);
      CopyToBgTilemapBuffer(3, gfx16('gEasyChatWindow_Tilemap'), 0, 0);
      CreatePhraseFrameWindow();
      CreateFooterWindow();
      CopyBgTilemapBufferToVram(3);
      break;
    }
    case 2: {
      DrawECFrameInTilemapBuffer(r.bg1TilemapBuffer);
      const tiles = gfx('sTextInputFrame_Gfx');
      LoadBgTiles(1, tiles, tiles.length, 0);
      CopyBgTilemapBufferToVram(1);
      break;
    }
    case 3:
      PrintTitleText();
      PrintECInstructionsText();
      PrintECFields();
      PutWin2TilemapAndCopyToVram();
      break;
    case 4:
      LoadSpriteGfx();
      CreateSelectDestFieldCursorSprite();
      break;
    case 5:
      if (IsDma3ManagerBusyWithBgCopy()) return true;
      SetRegWin0Coords(0, 0, 0, 0);
      SetGpuReg(REG_OFFSET_WININ, WIN_RANGE(0, 63));
      SetGpuReg(REG_OFFSET_WINOUT, WIN_RANGE(0, 59)); // everything but BG2: the groups / words window shows through WIN0 only
      ShowBg(3);
      ShowBg(1);
      ShowBg(2);
      ShowBg(0);
      CreateVerticalScrollArrowSprites();
      CreateStartSelectButtonsSprites();
      break;
    default:
      return false;
  }
  r.state++;
  return true;
}

function DestroyEasyChatGraphicsResources(): void {
  sEasyChatGraphicsResources = null;
}

function SetGpuRegsForEasyChatInit(): void {
  for (const bg of [3, 1, 2, 0]) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON | DISPCNT_WIN0_ON);
}

function LoadEasyChatPals(): void {
  ResetPaletteFade();
  LoadPalette(gfx16('gEasyChatWindow_Pal'), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
  LoadPalette(gfx16('sTextInputFrameOrange_Pal'), BG_PLTT_ID(1), gfx('sTextInputFrameOrange_Pal').length);
  LoadPalette(gfx16('sTextInputFrameGreen_Pal'), BG_PLTT_ID(4), gfx('sTextInputFrameGreen_Pal').length);
  LoadPalette(gfx16('sTitleText_Pal'), BG_PLTT_ID(10), gfx('sTitleText_Pal').length);
  LoadPalette(gfx16('sText_Pal'), BG_PLTT_ID(11), gfx('sText_Pal').length);
  LoadPalette(gfx16('sText_Pal'), BG_PLTT_ID(15), gfx('sText_Pal').length);
  LoadPalette(gfx16('sText_Pal'), BG_PLTT_ID(3), gfx('sText_Pal').length);
}

function PrintTitleText(): void {
  const label = GetTitleText();
  if (label === null) return;
  const titleText = text(label);
  const xOffset = Math.trunc((128 - GetStringWidth(FONT_NORMAL_COPY_1, titleText, 0)) / 2) >>> 0; // `/ 2u`
  FillWindowPixelBuffer(0, PIXEL_FILL(0));
  EC_AddTextPrinterParameterized2(0, FONT_NORMAL_COPY_1, titleText, xOffset & 0xff, 0, TEXT_SKIP_DRAW, TEXT_COLOR_TRANSPARENT, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_LIGHT_GRAY);
  PutWindowTilemap(0);
  CopyWindowToVram(0, COPYWIN_FULL);
}

function EC_AddTextPrinterParameterized(windowId: number, fontId: number, str: number[], x: number, y: number, speed: number): void {
  if (fontId === FONT_NORMAL_COPY_1) y += 2;
  AddTextPrinterParameterized(windowId, fontId, str, x, y, speed);
}

function EC_AddTextPrinterParameterized2(windowId: number, fontId: number, str: number[], x: number, y: number, speed: number, bg: number, fg: number, shadow: number): void {
  if (fontId === FONT_NORMAL_COPY_1) y += 2;
  AddTextPrinterParameterized3(windowId, fontId, x, y, [bg, fg, shadow], speed, str);
}

function PrintECInstructionsText(): void {
  FillBgTilemapBufferRect(0, 0, 0, 0, 32, 20, 17);
  LoadUserWindowGfx(1, 1, BG_PLTT_ID(14));
  DrawTextBorderOuter(1, 1, 14);
  PrintECInterfaceTextById(0);
  PutWindowTilemap(1);
  CopyBgTilemapBufferToVram(0);
}

/** PrintECInterfaceTextById: 0 the instructions, 1 DEL ALL's, 2 quit's, 3 confirm's question. */
function PrintECInterfaceTextById(direction: number): void {
  let texts: [string | null, string | null] = [null, null];
  switch (direction) {
    case 0:
      texts = GetEasyChatInstructionsText();
      break;
    case 2:
      texts = GetEasyChatConfirmCancelText();
      break;
    case 3:
      texts = GetEasyChatConfirmText();
      break;
    case 1:
      texts = GetEasyChatConfirmDeletionText();
      break;
  }
  const [text1, text2] = texts;
  FillWindowPixelBuffer(1, PIXEL_FILL(1));
  if (text1) EC_AddTextPrinterParameterized(1, FONT_NORMAL_COPY_1, text(text1), 0, 0, TEXT_SKIP_DRAW);
  if (text2) EC_AddTextPrinterParameterized(1, FONT_NORMAL_COPY_1, text(text2), 0, 16, TEXT_SKIP_DRAW);
  CopyWindowToVram(1, COPYWIN_FULL);
}

function EC_CreateYesNoMenuWithInitialCursorPos(initialCursorPos: number): void {
  CreateYesNoMenu(sEasyChatYesNoWindowTemplate, FONT_NORMAL_COPY_1, 0, 2, 0x001, 14, initialCursorPos);
}

/** CreatePhraseFrameWindow: the fields' window on BG3, the size of the frame (sPhraseFrameDimensions[frameId]). */
function CreatePhraseFrameWindow(): void {
  const d = sPhraseFrameDimensions[GetEasyChatScreenFrameId()];
  const r = res();
  r.windowId = AddWindow({ bg: 3, tilemapLeft: d.left, tilemapTop: d.top, width: d.width, height: d.height, paletteNum: 11, baseBlock: 0x060 });
  PutWindowTilemap(r.windowId);
}

/** PrintECFields: each row's words after a {CLEAR 17}, an empty field as seven red underscores. */
function PrintECFields(): void {
  const r = res();
  const ecWord = GetEasyChatWordBuffer();
  const numColumns = GetNumColumns();
  const numRows = GetNumRows();
  const frameId = GetEasyChatScreenFrameId();
  let w = 0;
  FillWindowPixelBuffer(r.windowId, PIXEL_FILL(1));
  for (let i = 0; i < numRows; i++) {
    const str: number[] = [...sText_Clear17];
    for (let j = 0; j < numColumns; j++) {
      if (ecWord[w] !== EC_EMPTY_WORD) {
        str.push(...CopyEasyChatWord(state, ecWord[w]));
        w++;
      } else {
        str.push(...WriteColorChangeControlCode(TEXT_COLOR_RED));
        w++;
        for (let k = 0; k < 7; k++) str.push(CHAR_EXTRA_SYMBOL, CHAR_UNDERSCORE);
        str.push(...WriteColorChangeControlCode(TEXT_COLOR_DARK_GRAY));
      }
      str.push(...sText_Clear17);
      if (frameId === 2 && j === 0 && i === 4) break; // the mail's last row has one field
    }
    str.push(EOS);
    EC_AddTextPrinterParameterized(r.windowId, FONT_NORMAL_COPY_1, str, 0, i * 16, TEXT_SKIP_DRAW);
  }
  CopyWindowToVram(r.windowId, COPYWIN_FULL);
}

/** WriteColorChangeControlCode (string_util.c) with colorType 0: {COLOR color} */
function WriteColorChangeControlCode(color: number): number[] {
  return [EXT_CTRL_CODE_BEGIN, EXT_CTRL_CODE_COLOR, color];
}

/** DrawECFrameInTilemapBuffer: the text input frame around the fields on BG1 (the mail's has no top or bottom edge). */
function DrawECFrameInTilemapBuffer(tilemap: Uint16Array): void {
  const frameId = GetEasyChatScreenFrameId();
  const d = sPhraseFrameDimensions[frameId];
  tilemap.fill(0);
  const right = d.left + d.width;
  const bottom = d.top + d.height;
  const row = (y: number, l: number, mid: number, rt: number) => {
    let x = d.left - 1;
    tilemap[y * 32 + x] = l;
    for (x++; x < right; x++) tilemap[y * 32 + x] = mid;
    tilemap[y * 32 + x] = rt;
  };
  if (frameId === 2) {
    for (let y = d.top; y < bottom; y++) row(y, 0x1005, 0x1000, 0x1007);
  } else {
    row(d.top - 1, 0x1001, 0x1002, 0x1003);
    for (let y = d.top; y < bottom; y++) row(y, 0x1005, 0x1000, 0x1007);
    row(bottom, 0x1009, 0x100a, 0x100b);
  }
}

function PutWin2TilemapAndCopyToVram(): void {
  PutWindowTilemap(2);
  CopyBgTilemapBufferToVram(2);
}

function SetRegWin0Coords(left: number, top: number, width: number, height: number): void {
  SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(left, left + width));
  SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(top, top + height));
}

/** CreateFooterWindow: DEL. ALL / CANCEL / OK under the frame. */
function CreateFooterWindow(): void {
  const windowId = AddWindow({ bg: 3, tilemapLeft: 4, tilemapTop: 11, width: 24, height: 2, paletteNum: 11, baseBlock: 0x030 });
  FillWindowPixelBuffer(windowId, PIXEL_FILL(1));
  EC_AddTextPrinterParameterized(windowId, FONT_NORMAL_COPY_1, text('gText_DelAllCancelOk'), 0, 0, 0);
  PutWindowTilemap(windowId);
}

// ------------------------------------------------------------------ easy_chat_3.c: sprites

function LoadSpriteGfx(): void {
  // sEasyChatSpriteSheets
  LoadSpriteSheet({ data: gfx('sTriangleCursor_Gfx'), size: 0x0020, tag: GFXTAG_TRIANGLE_CURSOR });
  LoadSpriteSheet({ data: gfx('sScrollIndicator_Gfx'), size: 0x0100, tag: GFXTAG_SCROLL_INDICATOR });
  LoadSpriteSheet({ data: gfx('sStartSelectButtons_Gfx'), size: 0x0100, tag: GFXTAG_START_SELECT_BUTTONS });
  // sEasyChatSpritePalettes (gEasyChatButtonWindow_Pal is used for various parts of the UI)
  LoadSpritePalette({ data: gfx16('sTriangleCursor_Pal'), tag: PALTAG_TRIANGLE_CURSOR });
  LoadSpritePalette({ data: gfx16('sRectangleCursor_Pal'), tag: PALTAG_RECTANGLE_CURSOR });
  LoadSpritePalette({ data: gfx16('gEasyChatButtonWindow_Pal'), tag: PALTAG_MISC_UI });
  LoadSpritePalette({ data: gfx16('sRSInterviewFrame_Pal'), tag: PALTAG_RS_INTERVIEW_FRAME });
  // sEasyChatCompressedSpriteSheets (the R/S interview frame is loaded but unused in FRLG)
  LoadCompressedSpriteSheet({ data: gfx('sRSInterviewFrame_Gfx'), size: 0x0800, tag: GFXTAG_RS_INTERVIEW_FRAME });
  LoadCompressedSpriteSheet({ data: gfx('gEasyChatRectangleCursor_Gfx'), size: 0x1000, tag: GFXTAG_RECTANGLE_CURSOR });
  LoadCompressedSpriteSheet({ data: gfx('gEasyChatButtonWindow_Gfx'), size: 0x0800, tag: GFXTAG_BUTTON_WINDOW });
  LoadCompressedSpriteSheet({ data: gfx('gEasyChatMode_Gfx'), size: 0x1000, tag: GFXTAG_MODE_WINDOW });
}

/** CreateSelectDestFieldCursorSprite: the triangle cursor left of the first field, bouncing. */
function CreateSelectDestFieldCursorSprite(): void {
  const d = sPhraseFrameDimensions[GetEasyChatScreenFrameId()];
  const x = d.left * 8 + 13;
  const y = (d.top + 1) * 8 + 1;
  const spriteId = CreateSprite(sSpriteTemplate_TriangleCursor, x, y, 2);
  res().selectDestFieldCursorSprite = gSprites[spriteId];
  gSprites[spriteId].data[1] = 1;
}

/** SpriteCB_BounceCursor: x2 steps from -6 to 0 every 3 frames while data[1] is set. */
function SpriteCB_BounceCursor(sprite: Sprite): void {
  if (sprite.data[1]) {
    if (++sprite.data[0] > 2) {
      sprite.data[0] = 0;
      if (++sprite.x2 > 0) sprite.x2 = -6;
    }
  }
}

function SetSelectDestFieldCursorSpritePosAndResetAnim(x: number, y: number): void {
  const s = res().selectDestFieldCursorSprite!;
  s.x = x & 0xff;
  s.y = y & 0xff;
  s.x2 = 0;
  s.data[0] = 0;
}

function FreezeSelectDestFieldCursorSprite(): void {
  const s = res().selectDestFieldCursorSprite!;
  s.data[0] = 0;
  s.data[1] = 0;
  s.x2 = 0;
}

function UnfreezeSelectDestFieldCursorSprite(): void {
  res().selectDestFieldCursorSprite!.data[1] = 1;
}

/** CreateRedRectangularCursorSpritePair: two halves 32 px either side of the centre, the right one flipped. */
function CreateRedRectangularCursorSpritePair(): void {
  const r = res();
  let spriteId = CreateSprite(sSpriteTemplate_RectangleCursor, 0, 0, 3);
  r.rectCursorSpriteRight = gSprites[spriteId];
  r.rectCursorSpriteRight.x2 = 32;
  spriteId = CreateSprite(sSpriteTemplate_RectangleCursor, 0, 0, 3);
  r.rectCursorSpriteLeft = gSprites[spriteId];
  r.rectCursorSpriteLeft.x2 = -32;
  r.rectCursorSpriteRight.hFlip = true;
  EC_MoveCursor();
}

function DestroyRedRectangularCursor(): void {
  const r = res();
  if (r.rectCursorSpriteRight) DestroySprite(r.rectCursorSpriteRight);
  r.rectCursorSpriteRight = null;
  if (r.rectCursorSpriteLeft) DestroySprite(r.rectCursorSpriteLeft);
  r.rectCursorSpriteLeft = null;
}

/** EC_MoveCursor: the rectangle cursor to the group cursor's place. */
function EC_MoveCursor(): void {
  const r = res();
  if (r.rectCursorSpriteRight && r.rectCursorSpriteLeft) {
    const [x, y] = GetECSelectGroupCursorCoords();
    if (!IsEasyChatAlphaMode()) MoveCursor_Group(x, y);
    else MoveCursor_Alpha(x, y);
  }
}

function SetRectCursor(anim: number, x: number, y: number): void {
  const r = res();
  for (const sprite of [r.rectCursorSpriteRight!, r.rectCursorSpriteLeft!]) {
    StartSpriteAnim(sprite, anim);
    sprite.x = x;
    sprite.y = y;
  }
}

/** MoveCursor_Group: on a group name (two columns 84 px apart), or on a blue box button (x -1). */
function MoveCursor_Group(x: number, y: number): void {
  if (x !== -1) SetRectCursor(RECTCURSOR_ANIM_ON_GROUP, x * 84 + 58, y * 16 + 96);
  else SetRectCursor(RECTCURSOR_ANIM_ON_BUTTON, 216, y * 16 + 112);
}

/** MoveCursor_Alpha: on a letter (sAlphabetKeyboardColumnOffsets), on "others", or on a blue box button. */
function MoveCursor_Alpha(cursorX: number, cursorY: number): void {
  if (cursorX !== -1) {
    const y = cursorY * 16 + 96;
    let x = 32;
    let anim: number;
    if (cursorX === 6 && cursorY === 0) {
      x = 157;
      anim = RECTCURSOR_ANIM_ON_OTHERS;
    } else {
      x += sAlphabetKeyboardColumnOffsets[cursorX < sAlphabetKeyboardColumnOffsets.length ? cursorX : 0];
      anim = RECTCURSOR_ANIM_ON_LETTER;
    }
    SetRectCursor(anim, x, y);
  } else {
    SetRectCursor(RECTCURSOR_ANIM_ON_BUTTON, 216, cursorY * 16 + 112);
  }
}

/** CreateSelectWordCursorSprite: a triangle cursor on the word list, always bouncing, above BG2. */
function CreateSelectWordCursorSprite(): void {
  const r = res();
  const spriteId = CreateSprite(sSpriteTemplate_TriangleCursor, 0, 0, 4);
  r.selectWordCursorSprite = gSprites[spriteId];
  r.selectWordCursorSprite.callback = SpriteCB_SelectWordCursorSprite;
  r.selectWordCursorSprite.oam.priority = 2;
  SetSelectWordCursorSpritePos();
}

function SpriteCB_SelectWordCursorSprite(sprite: Sprite): void {
  if (++sprite.data[0] > 2) {
    sprite.data[0] = 0;
    if (++sprite.x2 > 0) sprite.x2 = -6;
  }
}

/** SetSelectWordCursorSpritePos: left of the word at the word cursor (tile column 3 or 16, rows from 11). */
function SetSelectWordCursorSpritePos(): void {
  const [cursorX, cursorY] = GetECSelectWordCursorCoords();
  const x = (cursorX * 13 + 3) & 0xff;
  const y = (cursorY * 2 + 11) & 0xff;
  SetSelectWordCursorSpritePosExplicit(x, y);
}

function SetSelectWordCursorSpritePosExplicit(x: number, y: number): void {
  const sprite = res().selectWordCursorSprite;
  if (sprite) {
    sprite.x = x * 8 + 4;
    sprite.y = (y + 1) * 8 + 1;
    sprite.x2 = 0;
    sprite.data[0] = 0;
  }
}

function DestroySelectWordCursorSprite(): void {
  const r = res();
  if (r.selectWordCursorSprite) {
    DestroySprite(r.selectWordCursorSprite);
    r.selectWordCursorSprite = null;
  }
}

/** CreateSelectGroupHelpSprite: the button window (MODE / DEL / CANCEL) 64 px left of its place, the mode window hidden. */
function CreateSelectGroupHelpSprite(): void {
  const r = res();
  let spriteId = CreateSprite(sSpriteTemplate_ButtonWindow, 208, 128, 6);
  r.selectGroupHelpSprite = gSprites[spriteId];
  r.selectGroupHelpSprite.x2 = -64;
  spriteId = CreateSprite(sSpriteTemplate_ModeWindow, 208, 80, 5);
  r.modeIconsSprite = gSprites[spriteId];
  r.modeIconState = 0;
}

/** AnimateSeletGroupModeAndHelpSpriteEnter: the button window slides in 8 px a frame, then the mode window opens. */
function AnimateSeletGroupModeAndHelpSpriteEnter(): boolean {
  const r = res();
  switch (r.modeIconState) {
    default:
      return false;
    case 0:
      r.selectGroupHelpSprite!.x2 += 8;
      if (r.selectGroupHelpSprite!.x2 >= 0) {
        r.selectGroupHelpSprite!.x2 = 0;
        StartSpriteAnim(r.modeIconsSprite!, IsEasyChatAlphaMode() ? MODEWINDOW_ANIM_TO_ALPHABET : MODEWINDOW_ANIM_TO_GROUP);
        r.modeIconState++;
      }
      break;
    case 1:
      if (r.modeIconsSprite!.animEnded) {
        r.modeIconState = 2;
        return false;
      }
  }
  return true;
}

function StartModeIconHidingAnimation(): void {
  const r = res();
  r.modeIconState = 0;
  StartSpriteAnim(r.modeIconsSprite!, MODEWINDOW_ANIM_TO_HIDDEN);
}

/** RunModeIconHidingAnimation: the mode window closes, then the button window slides out and both are destroyed. */
function RunModeIconHidingAnimation(): boolean {
  const r = res();
  switch (r.modeIconState) {
    default:
      return false;
    case 0:
      if (r.modeIconsSprite!.animEnded) r.modeIconState = 1;
      break;
    case 1:
      r.selectGroupHelpSprite!.x2 -= 8;
      if (r.selectGroupHelpSprite!.x2 <= -64) {
        DestroySprite(r.modeIconsSprite!);
        DestroySprite(r.selectGroupHelpSprite!);
        r.modeIconsSprite = null;
        r.selectGroupHelpSprite = null;
        r.modeIconState++;
        return false;
      }
  }
  return true;
}

function ShrinkModeIconsSprite(): void {
  StartSpriteAnim(res().modeIconsSprite!, MODEWINDOW_ANIM_TRANSITION);
}

function ShowModeIconsSprite(): void {
  StartSpriteAnim(res().modeIconsSprite!, IsEasyChatAlphaMode() ? MODEWINDOW_ANIM_TO_ALPHABET : MODEWINDOW_ANIM_TO_GROUP);
}

/** ModeIconsSpriteAnimIsEnded: TRUE while the anim is still running (the C's name says the opposite). */
function ModeIconsSpriteAnimIsEnded(): boolean {
  return !res().modeIconsSprite!.animEnded;
}

function CreateVerticalScrollArrowSprites(): void {
  const r = res();
  let spriteId = CreateSprite(sSpriteTemplate_ScrollIndicator, 96, 80, 0);
  if (spriteId !== MAX_SPRITES) r.upTriangleCursorSprite = gSprites[spriteId];
  spriteId = CreateSprite(sSpriteTemplate_ScrollIndicator, 96, 156, 0);
  if (spriteId !== MAX_SPRITES) {
    r.downTriangleCursorSprite = gSprites[spriteId];
    r.downTriangleCursorSprite.vFlip = true;
  }
  HideVerticalScrollArrowSprites();
}

/** UpdateVerticalScrollArrowVisibility */
function UpdateVerticalScrollArrowVisibility(): void {
  const r = res();
  r.upTriangleCursorSprite!.invisible = !ShouldDrawECUpArrow();
  r.downTriangleCursorSprite!.invisible = !ShouldDrawECDownArrow();
}

function HideVerticalScrollArrowSprites(): void {
  const r = res();
  r.upTriangleCursorSprite!.invisible = true;
  r.downTriangleCursorSprite!.invisible = true;
}

/** UpdateVerticalScrollArrowSpriteXPos: 0 the groups (x 96), 1 the word list (x 120). */
function UpdateVerticalScrollArrowSpriteXPos(direction: number): void {
  const r = res();
  const x = direction ? 120 : 96;
  r.upTriangleCursorSprite!.x = x;
  r.downTriangleCursorSprite!.x = x;
}

function CreateStartSelectButtonsSprites(): void {
  const r = res();
  let spriteId = CreateSprite(sSpriteTemplate_StartSelectButtons, 220, 84, 1);
  if (spriteId !== MAX_SPRITES) r.startPgUpButtonSprite = gSprites[spriteId];
  spriteId = CreateSprite(sSpriteTemplate_StartSelectButtons, 220, 156, 1);
  if (spriteId !== MAX_SPRITES) {
    r.selectPgDnButtonSprite = gSprites[spriteId];
    StartSpriteAnim(r.selectPgDnButtonSprite, 1);
  }
  HideStartSelectButtonSprites();
}

/** UpdateStartSelectButtonSpriteVisibility */
function UpdateStartSelectButtonSpriteVisibility(): void {
  const r = res();
  r.startPgUpButtonSprite!.invisible = !ShouldDrawECUpArrow();
  r.selectPgDnButtonSprite!.invisible = !ShouldDrawECDownArrow();
}

function HideStartSelectButtonSprites(): void {
  const r = res();
  r.startPgUpButtonSprite!.invisible = true;
  r.selectPgDnButtonSprite!.invisible = true;
}

// ------------------------------------------------------------------ easy_chat_3.c: the interface commands

function EasyChatInterfaceCommand_Setup(id: number): void {
  const r = res();
  r.id = id;
  r.state = 0;
  sLastCommand = id;
  sCommandCount++;
  EasyChatInterfaceCommand_Run();
}

/** EasyChatInterfaceCommand_Run: true while the command is still running. */
function EasyChatInterfaceCommand_Run(): boolean {
  const id = res().id;
  switch (id) {
    case 0:
      return false;
    case 1:
      return ECInterfaceCmd_01();
    case 2:
      return ECInterfaceCmd_02();
    case 3:
      return ECInterfaceCmd_03();
    case 4:
      return ECInterfaceCmd_04();
    case 5:
      return ECInterfaceCmd_05();
    case 6:
      return ECInterfaceCmd_06();
    case 7:
      return ECInterfaceCmd_07();
    case 8:
      return ECInterfaceCmd_08();
    case 9:
      return ECInterfaceCmd_09();
    case 10:
      return ECInterfaceCmd_10();
    case 11:
      return ECInterfaceCmd_11();
    case 12:
      return ECInterfaceCmd_12();
    case 13:
      return ECInterfaceCmd_13();
    case 14:
      return ECInterfaceCmd_14();
    case 15:
      return ECInterfaceCmd_15();
    case 16:
      return ECInterfaceCmd_16();
    case 17:
      return ECInterfaceCmd_17();
    case 18:
      return ECInterfaceCmd_18();
    case 19:
      return ECInterfaceCmd_19();
    case 20:
      return ECInterfaceCmd_20();
    case 21:
      return ECInterfaceCmd_21();
    case 22:
      return ECInterfaceCmd_22();
    default:
      return false;
  }
}

/** ECInterfaceCmd_01: reprint the fields. */
function ECInterfaceCmd_01(): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      PrintECFields();
      r.state++;
      break;
    case 1:
      return IsDma3ManagerBusyWithBgCopy();
  }
  return true;
}

/** ECInterfaceCmd_02: the triangle cursor left of the selected field (after the words to its left in that row). */
function ECInterfaceCmd_02(): boolean {
  const ecWordBuffer = GetEasyChatWordBuffer();
  const frameId = GetEasyChatScreenFrameId();
  const cursorColumn = GetMainCursorColumn();
  const cursorRow = GetMainCursorRow();
  const numColumns = GetNumColumns();
  let w = cursorRow * numColumns;
  let var1 = 8 * sPhraseFrameDimensions[frameId].left + 13;
  for (let i = 0; i < cursorColumn; i++) {
    let stringWidth: number;
    if (ecWordBuffer[w] === EC_EMPTY_WORD) {
      stringWidth = GetStringWidth(FONT_NORMAL_COPY_1, sText_Underscore, 0) * 7;
    } else {
      stringWidth = GetStringWidth(FONT_NORMAL_COPY_1, [...CopyEasyChatWord(state, ecWordBuffer[w]), EOS], 0);
    }
    var1 += stringWidth + 17;
    w++;
  }
  const var2 = 8 * (sPhraseFrameDimensions[frameId].top + cursorRow * 2 + 1) + 1;
  SetSelectDestFieldCursorSpritePosAndResetAnim(var1, var2);
  return false;
}

/** ECInterfaceCmd_03: the triangle cursor on a footer button (DEL. ALL / CANCEL / OK). */
function ECInterfaceCmd_03(): boolean {
  let xOffset: number;
  switch (GetMainCursorColumn()) {
    case 0:
      xOffset = 28;
      break;
    case 1:
      xOffset = 115;
      break;
    case 2:
      xOffset = 191;
      break;
    default:
      return false;
  }
  SetSelectDestFieldCursorSpritePosAndResetAnim(xOffset, 97);
  return false;
}

/** ECInterfaceCmd_04: "All the text being edited will be deleted. Is that okay?" + YES/NO on NO. */
function ECInterfaceCmd_04(): boolean {
  return PromptCommand(1, 1);
}

/** ECInterfaceCmd_05: "Quit editing?" + YES/NO on NO. */
function ECInterfaceCmd_05(): boolean {
  return PromptCommand(2, 1);
}

/** ECInterfaceCmd_06: the confirm text + YES/NO on YES. */
function ECInterfaceCmd_06(): boolean {
  return PromptCommand(3, 0);
}

/** ECInterfaceCmd_04 / _05 / _06: freeze the cursor, the question in the instructions window, the YES/NO. */
function PromptCommand(textId: number, initialCursorPos: number): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      FreezeSelectDestFieldCursorSprite();
      PrintECInterfaceTextById(textId);
      EC_CreateYesNoMenuWithInitialCursorPos(initialCursorPos);
      r.state++;
      break;
    case 1:
      return IsDma3ManagerBusyWithBgCopy();
  }
  return true;
}

/** ECInterfaceCmd_07: the YES/NO is gone (Menu_ProcessInputNoWrapClearOnChoose); the instructions back. */
function ECInterfaceCmd_07(): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      UnfreezeSelectDestFieldCursorSprite();
      PrintECInterfaceTextById(0);
      ShowBg(0);
      r.state++;
      break;
    case 1:
      return IsDma3ManagerBusyWithBgCopy();
  }
  return true;
}

/** ECInterfaceCmd_08: after DEL ALL's YES/NO: the instructions back and the fields reprinted. */
function ECInterfaceCmd_08(): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      UnfreezeSelectDestFieldCursorSprite();
      PrintECInterfaceTextById(0);
      PrintECFields();
      r.state++;
    // fall through
    case 1:
      return IsDma3ManagerBusyWithBgCopy();
  }
  return true;
}

/** ECInterfaceCmd_09: open the groups menu / keyboard: the frame grows from the instructions, then the help sprites. */
function ECInterfaceCmd_09(): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      FreezeSelectDestFieldCursorSprite();
      HideBg(0);
      SetRegWin0Coords(0, 0, 0, 0);
      PrintECGroupOrAlphaMenu();
      r.state++;
      break;
    case 1:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        StartWin2FrameAnim(0);
        r.state++;
      }
      break;
    case 2:
      if (!IsDma3ManagerBusyWithBgCopy() && !AnimateFrameResize()) r.state++;
      break;
    case 3:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        CreateSelectGroupHelpSprite();
        r.state++;
      }
      break;
    case 4:
      if (!AnimateSeletGroupModeAndHelpSpriteEnter()) {
        CreateRedRectangularCursorSpritePair();
        UpdateVerticalScrollArrowSpriteXPos(0);
        UpdateVerticalScrollArrowVisibility();
        r.state++;
        return false;
      }
      break;
    default:
      return false;
  }
  return true;
}

/** ECInterfaceCmd_10: close the groups menu / keyboard, back to the fields. */
function ECInterfaceCmd_10(): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      DestroyRedRectangularCursor();
      StartModeIconHidingAnimation();
      HideVerticalScrollArrowSprites();
      r.state++;
      break;
    case 1:
      if (RunModeIconHidingAnimation()) break;
      StartWin2FrameAnim(1);
      r.state++;
    // fall through
    case 2:
      if (!AnimateFrameResize()) r.state++;
      break;
    case 3:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        UnfreezeSelectDestFieldCursorSprite();
        ShowBg(0);
        r.state++;
      }
      break;
    case 4:
      return false;
  }
  return true;
}

/** ECInterfaceCmd_22: switch groups ⇄ A-Z: the frame shrinks, the other menu is printed, the frame grows back. */
function ECInterfaceCmd_22(): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      DestroyRedRectangularCursor();
      HideVerticalScrollArrowSprites();
      ShrinkModeIconsSprite();
      StartWin2FrameAnim(5);
      r.state++;
      break;
    case 1:
      if (!AnimateFrameResize() && !ModeIconsSpriteAnimIsEnded()) {
        PrintECGroupOrAlphaMenu();
        r.state++;
      }
      break;
    case 2:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        StartWin2FrameAnim(6);
        ShowModeIconsSprite();
        r.state++;
      }
      break;
    case 3:
      if (!AnimateFrameResize() && !ModeIconsSpriteAnimIsEnded()) {
        UpdateVerticalScrollArrowVisibility();
        CreateRedRectangularCursorSpritePair();
        r.state++;
        return false;
      }
      break;
    case 4:
      return false;
  }
  return true;
}

/** ECInterfaceCmd_14: the rectangle cursor moved. */
function ECInterfaceCmd_14(): boolean {
  EC_MoveCursor();
  return false;
}

/** ECInterfaceCmd_15: the group names scroll down a row (2 px a frame). */
function ECInterfaceCmd_15(): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      ScheduleBg2VerticalScroll(1, 2);
      r.state++;
    // fall through
    case 1:
      if (!AnimateBg2VerticalScroll()) {
        EC_MoveCursor();
        UpdateVerticalScrollArrowVisibility();
        return false;
      }
      break;
  }
  return true;
}

/** ECInterfaceCmd_16: the group names scroll up a row (the cursor stays on the top row). */
function ECInterfaceCmd_16(): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      ScheduleBg2VerticalScroll(-1, 2);
      r.state++;
    // fall through
    case 1:
      if (!AnimateBg2VerticalScroll()) {
        UpdateVerticalScrollArrowVisibility();
        r.state++;
        return false;
      }
      break;
    case 2:
      return false;
  }
  return true;
}

/** ECInterfaceCmd_11: open the word list: the help sprites leave, the frame widens, the first four rows. */
function ECInterfaceCmd_11(): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      DestroyRedRectangularCursor();
      StartModeIconHidingAnimation();
      HideVerticalScrollArrowSprites();
      r.state++;
      break;
    case 1:
      if (!RunModeIconHidingAnimation()) {
        ClearWin2AndCopyToVram();
        r.state++;
      }
      break;
    case 2:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        StartWin2FrameAnim(2);
        r.state++;
      }
      break;
    case 3:
      if (!AnimateFrameResize()) {
        PrintECMenuById(2);
        r.state++;
      }
      break;
    case 4:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        CreateSelectWordCursorSprite();
        UpdateVerticalScrollArrowSpriteXPos(1);
        UpdateVerticalScrollArrowVisibility();
        UpdateStartSelectButtonSpriteVisibility();
        r.state++;
        return false;
      }
      break;
    case 5:
      return false;
  }
  return true;
}

/** ECInterfaceCmd_12: a word placed: the fields reprinted, the word list closes into the instructions. */
function ECInterfaceCmd_12(): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      PrintECFields();
      r.state++;
      break;
    case 1:
      DestroySelectWordCursorSprite();
      HideVerticalScrollArrowSprites();
      HideStartSelectButtonSprites();
      ClearWin2AndCopyToVram();
      r.state++;
      break;
    case 2:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        StartWin2FrameAnim(3);
        r.state++;
      }
      break;
    case 3:
      if (!AnimateFrameResize()) {
        ShowBg(0);
        r.state++;
      }
      break;
    case 4:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        UnfreezeSelectDestFieldCursorSprite();
        r.state++;
        return false;
      }
      break;
    case 5:
      return false;
  }
  return true;
}

/** ECInterfaceCmd_13: B on the word list: back to the groups menu / keyboard. */
function ECInterfaceCmd_13(): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      DestroySelectWordCursorSprite();
      HideVerticalScrollArrowSprites();
      HideStartSelectButtonSprites();
      ClearWin2AndCopyToVram();
      r.state++;
      break;
    case 1:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        StartWin2FrameAnim(4);
        r.state++;
      }
      break;
    case 2:
      if (!AnimateFrameResize()) {
        PrintECGroupOrAlphaMenu();
        r.state++;
      }
      break;
    case 3:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        CreateSelectGroupHelpSprite();
        r.state++;
      }
      break;
    case 4:
      if (!AnimateSeletGroupModeAndHelpSpriteEnter()) {
        CreateRedRectangularCursorSpritePair();
        UpdateVerticalScrollArrowSpriteXPos(0);
        UpdateVerticalScrollArrowVisibility();
        r.state++;
        return false;
      }
      break;
  }
  return true;
}

/** ECInterfaceCmd_17: the triangle cursor moved on the word list. */
function ECInterfaceCmd_17(): boolean {
  SetSelectWordCursorSpritePos();
  return false;
}

/** ECInterfaceCmd_19: the word list scrolls down a row: the new bottom row printed, BG2 2 px a frame. */
function ECInterfaceCmd_19(): boolean {
  return WordListScroll(UpdateWin2PrintWordsScrollDown, () => 1, 2, true);
}

/** ECInterfaceCmd_18: the word list scrolls up a row (the cursor stays on the top row). */
function ECInterfaceCmd_18(): boolean {
  return WordListScroll(UpdateWin2PrintWordsScrollUp, () => -1, 2, false);
}

/** ECInterfaceCmd_21: SELECT: a page down, 4 px a frame. */
function ECInterfaceCmd_21(): boolean {
  return WordListScroll(UpdateWin2PrintWordsScrollPageDown, () => GetECSelectWordRowsAbove() - GetBg2ScrollRow(), 4, true);
}

/** ECInterfaceCmd_20: START: a page up (the cursor stays where it is on screen). */
function ECInterfaceCmd_20(): boolean {
  return WordListScroll(UpdateWin2PrintWordsScrollPageUp, () => GetECSelectWordRowsAbove() - GetBg2ScrollRow(), 4, false);
}

/** ECInterfaceCmd_18-21: print the rows coming in, scroll BG2 to them, then the cursor / arrows / buttons. */
function WordListScroll(print: () => void, direction: () => number, speed: number, moveCursor: boolean): boolean {
  const r = res();
  switch (r.state) {
    case 0:
      print();
      r.state++;
      break;
    case 1:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        ScheduleBg2VerticalScroll(direction(), speed);
        r.state++;
      }
      break;
    case 2:
      if (!AnimateBg2VerticalScroll()) {
        if (moveCursor) SetSelectWordCursorSpritePos();
        UpdateVerticalScrollArrowVisibility();
        UpdateStartSelectButtonSpriteVisibility();
        r.state++;
        return false;
      }
      break;
    case 3:
      return false;
  }
  return true;
}

// ------------------------------------------------------------------ easy_chat_3.c: window 2 (groups / keyboard / words)

/** PrintECMenuById: 0 the groups, 1 the keyboard, 2 the words; BG2 back to the top. */
function PrintECMenuById(id: number): void {
  InitBg2Scroll();
  FillWindowPixelBuffer(2, PIXEL_FILL(1));
  switch (id) {
    case 0:
      PrintECGroupsMenu();
      break;
    case 1:
      PrintEasyChatKeyboardText();
      break;
    case 2:
      PrintECWordsMenu();
      break;
  }
  CopyWindowToVram(2, COPYWIN_GFX);
}

function PrintECGroupOrAlphaMenu(): void {
  PrintECMenuById(IsEasyChatAlphaMode() ? 1 : 0);
}

/** PrintECGroupsMenu: every displayable group's name, two a row from y 96, then BG2 to the rows scrolled above. */
function PrintECGroupsMenu(): void {
  let i = 0;
  let y = 96;
  for (;;) {
    for (let x = 0; x < 2; x++) {
      const groupId = GetSelectedGroupByIndex(i++);
      if (groupId === EC().EC_NUM_GROUPS) {
        ScheduleBg2VerticalScroll(GetECSelectGroupRowsAbove(), 0);
        return;
      }
      EC_AddTextPrinterParameterized(2, FONT_NORMAL_COPY_1, [...GetEasyChatWordGroupName(state, groupId), EOS], x * 84 + 10, y & 0xff, TEXT_SKIP_DRAW);
    }
    y += 16;
  }
}

function PrintEasyChatKeyboardText(): void {
  for (let i = 0; i < sEasyChatKeyboardAlphabet.length; i++) {
    EC_AddTextPrinterParameterized(2, FONT_NORMAL_COPY_1, text(sEasyChatKeyboardAlphabet[i]), 10, 96 + i * 16, TEXT_SKIP_DRAW);
  }
}

function PrintECWordsMenu(): void {
  PrintECRowsWin2(0, 4);
}

function UpdateWin2PrintWordsScrollDown(): void {
  const rowsAbove = (GetECSelectWordRowsAbove() + 3) & 0xff;
  ClearECRowsWin2(rowsAbove, 1);
  PrintECRowsWin2(rowsAbove, 1);
}

function UpdateWin2PrintWordsScrollUp(): void {
  const rowsAbove = GetECSelectWordRowsAbove() & 0xff;
  ClearECRowsWin2(rowsAbove, 1);
  PrintECRowsWin2(rowsAbove, 1);
}

function UpdateWin2PrintWordsScrollPageDown(): void {
  const row = GetECSelectWordRowsAbove() & 0xff;
  let maxrow = (row + 4) & 0xff;
  const numrowsplus1 = (GetECSelectWordNumRows() + 1) & 0xff;
  if (maxrow > numrowsplus1) maxrow = numrowsplus1;
  if (row < maxrow) {
    const remrow = maxrow - row;
    ClearECRowsWin2(row, remrow);
    PrintECRowsWin2(row, remrow);
  }
}

function UpdateWin2PrintWordsScrollPageUp(): void {
  const row = GetECSelectWordRowsAbove() & 0xff;
  const maxrow = GetBg2ScrollRow() & 0xff;
  if (row < maxrow) {
    const remrow = maxrow - row;
    ClearECRowsWin2(row, remrow);
    PrintECRowsWin2(row, remrow);
  }
}

/** PrintECRowsWin2: `remrow` rows of two words from `row`, at y (row * 16 + 96) mod 256 (window 2 is 256 px tall, BG2 wraps). */
function PrintECRowsWin2(row: number, remrow: number): void {
  let ecWordIdx = row * 2;
  let y = (row * 16 + 96) & 0xff;
  for (let i = 0; i < remrow; i++) {
    for (let j = 0; j < 2; j++) {
      const easyChatWord = GetDisplayedWordByIndex(ecWordIdx++);
      if (easyChatWord !== 0xffff) {
        const ecPaddedWordBuffer = [...CopyEasyChatWordPadded(state, easyChatWord, 0), EOS];
        EC_AddTextPrinterParameterized(2, FONT_NORMAL_COPY_1, ecPaddedWordBuffer, (j * 13 + 3) * 8, y & 0xff, TEXT_SKIP_DRAW);
      }
    }
    y += 16;
  }
  CopyWindowToVram(2, COPYWIN_GFX);
}

/** ClearECRowsWin2: the rows' pixels, wrapping past the window's bottom. */
function ClearECRowsWin2(row: number, remrow: number): void {
  const y = (row * 16 + 96) & 0xff;
  let heightToBottom = remrow * 16;
  const totalHeight = y + heightToBottom;
  let heightWrappedAround: number;
  if (totalHeight > 255) {
    heightWrappedAround = totalHeight - 256;
    heightToBottom = 256 - y;
  } else {
    heightWrappedAround = 0;
  }
  FillWindowPixelRect(2, PIXEL_FILL(1), 0, y, 224, heightToBottom);
  if (heightWrappedAround) FillWindowPixelRect(2, PIXEL_FILL(1), 0, 0, 224, heightWrappedAround);
}

function ClearWin2AndCopyToVram(): void {
  FillWindowPixelBuffer(2, PIXEL_FILL(1));
  CopyWindowToVram(2, COPYWIN_GFX);
}

/** StartWin2FrameAnim: the green frame's RedrawFrameByIndex steps from / to. */
function StartWin2FrameAnim(animNo: number): void {
  const r = res();
  const anims: [number, number][] = [
    [0, 10], // open the groups / keyboard
    [9, 0], // close them
    [11, 17], // widen to the word list
    [17, 0], // close the word list
    [17, 10], // the word list back to the groups / keyboard
    [18, 22], // shrink (mode switch)
    [22, 18], // grow back
  ];
  [r.frameAnimIdx, r.frameAnimTarget] = anims[animNo];
  r.frameAnimDelta = r.frameAnimIdx < r.frameAnimTarget ? 1 : -1;
}

/** AnimateFrameResize: one step a frame; false once at the target. */
function AnimateFrameResize(): boolean {
  const r = res();
  if (r.frameAnimIdx === r.frameAnimTarget) return false;
  r.frameAnimIdx = (r.frameAnimIdx + r.frameAnimDelta) & 0xff;
  RedrawFrameByIndex(r.frameAnimIdx);
  return r.frameAnimIdx !== r.frameAnimTarget;
}

/** RedrawFrameByIndex's rectangles [left, top, width, height] by step (0: none). */
const sFrameRects: ([number, number, number, number] | null)[] = [
  null,
  [11, 14, 3, 2],
  [9, 14, 7, 2],
  [7, 14, 11, 2],
  [5, 14, 15, 2],
  [3, 14, 19, 2],
  [1, 14, 23, 2],
  [1, 13, 23, 4],
  [1, 12, 23, 6],
  [1, 11, 23, 8],
  [1, 10, 23, 10],
  [1, 10, 24, 10],
  [1, 10, 25, 10],
  [1, 10, 26, 10],
  [1, 10, 27, 10],
  [1, 10, 28, 10],
  [1, 10, 29, 10],
  [0, 10, 30, 10],
  [1, 10, 23, 10],
  [1, 11, 23, 8],
  [1, 12, 23, 6],
  [1, 13, 23, 4],
  [1, 14, 23, 2],
];

/** RedrawFrameByIndex: BG1's rows 10-19 cleared, the green frame drawn at that step's size. */
function RedrawFrameByIndex(direction: number): void {
  FillBgTilemapBufferRect_Palette0(1, 0, 0, 10, 30, 10);
  const rect = sFrameRects[direction];
  if (rect) RedrawFrameByRect(...rect);
  CopyBgTilemapBufferToVram(1);
}

/** RedrawFrameByRect: the green frame (palette 4) on BG1, and WIN0 to its inside (BG2 shows only there). */
function RedrawFrameByRect(left: number, top: number, width: number, height: number): void {
  const tilemap = res().bg1TilemapBuffer;
  const right = left + width - 1;
  const bottom = top + height - 1;
  let x = left;
  let y = top;
  tilemap[y * 32 + x] = 0x4001;
  for (x++; x < right; x++) tilemap[y * 32 + x] = 0x4002;
  tilemap[y * 32 + x] = 0x4003;
  for (y++; y < bottom; y++) {
    tilemap[y * 32 + left] = 0x4005;
    for (x = left + 1; x < right; x++) tilemap[y * 32 + x] = 0x4000;
    tilemap[y * 32 + x] = 0x4007;
  }
  tilemap[y * 32 + left] = 0x4009;
  for (x = left + 1; x < right; x++) tilemap[y * 32 + x] = 0x400a;
  tilemap[y * 32 + x] = 0x400b;
  SetRegWin0Coords((left + 1) * 8, (top + 1) * 8, (width - 2) * 8, (height - 2) * 8);
}

/** InitBg2Scroll: BG2 8 px down (the first row at y 96 shows at 88, inside the frame). */
function InitBg2Scroll(): void {
  ChangeBgY(2, 0x800, 0);
  res().bg2ScrollRow = 0;
}

/** ScheduleBg2VerticalScroll: `direction` rows (16 px each), at `speed` px a frame, or at once for speed 0. */
function ScheduleBg2VerticalScroll(direction: number, speed: number): void {
  const r = res();
  let bgY = GetBgY(2) | 0;
  r.bg2ScrollRow = (r.bg2ScrollRow + direction) & 0xffff;
  const totalDelta = (direction * 16) << 16 >> 16; // s16
  bgY += totalDelta << 8;
  if (speed) {
    r.tgtBgY = bgY;
    r.deltaBgY = speed * 256;
    if (totalDelta < 0) r.deltaBgY = -r.deltaBgY;
  } else {
    ChangeBgY(2, bgY, 0);
  }
}

/** AnimateBg2VerticalScroll: one step a frame; false once at the target. */
function AnimateBg2VerticalScroll(): boolean {
  const r = res();
  if ((GetBgY(2) | 0) === r.tgtBgY) return false;
  ChangeBgY(2, r.deltaBgY, 1);
  return true;
}

function GetBg2ScrollRow(): number {
  return res().bg2ScrollRow;
}

// ------------------------------------------------------------------ dev

/**
 * Dev: the screen while it's up (for the e2e tests): the model (`screen`, live: a test may write a word into its
 * ecWordBuffer), the last interface command and how many have run, the triangle cursor's position and whether it bounces, whether the
 * START / SELECT sprites show, and `idle`: Task_RunEasyChat reads the keys (state 1, no fade). Unit 4's parts: the
 * green frame's step (`frameAnimIdx`), WIN0 (left, top, right, bottom), BG2's y in pixels and `bg2ScrollRow`, the
 * rectangle cursor (centre and anim), the word list's triangle cursor, the mode window's anim (0 hidden, 1 group,
 * 2 A-Z, 3 to hidden, 4 transition) and the help sprite's x2, the scroll arrows (x, shown), the displayable groups
 * (`groups`) and the words on display (`words`, the last GetUnlockedECWords). `reprint` is PrintECFields.
 */
export function easyChatProbe():
  | {
      screen: ReturnType<typeof GetEasyChatScreen>;
      lastCommand: number;
      commandCount: number;
      cursor: { x: number; y: number; x2: number; bouncing: boolean } | null;
      startSelectVisible: boolean;
      selectVisible: boolean;
      idle: boolean;
      frameAnimIdx: number;
      win0: [number, number, number, number];
      bg2Y: number;
      bg2ScrollRow: number;
      rectCursor: { x: number; y: number; anim: number } | null;
      wordCursor: { x: number; y: number } | null;
      modeAnim: number | null;
      helpX2: number | null;
      scrollArrows: { x: number; up: boolean; down: boolean } | null;
      groups: number[];
      words: number[];
      reprint(): void;
    }
  | undefined {
  const r = sEasyChatGraphicsResources;
  if (!r) return undefined;
  const c = r.selectDestFieldCursorSprite;
  const win0h = GetGpuReg(REG_OFFSET_WIN0H);
  const win0v = GetGpuReg(REG_OFFSET_WIN0V);
  return {
    screen: GetEasyChatScreen(),
    lastCommand: sLastCommand,
    commandCount: sCommandCount,
    cursor: c ? { x: c.x, y: c.y, x2: c.x2, bouncing: c.data[1] !== 0 } : null,
    startSelectVisible: !!r.startPgUpButtonSprite && !r.startPgUpButtonSprite.invisible,
    selectVisible: !!r.selectPgDnButtonSprite && !r.selectPgDnButtonSprite.invisible,
    idle: sTaskId >= 0 && gTasks[sTaskId].func === Task_RunEasyChat && gTasks[sTaskId].data[EZCHAT_TASK_STATE] === 1 && !gPaletteFade.active,
    frameAnimIdx: r.frameAnimIdx,
    win0: [win0h >> 8, win0v >> 8, win0h & 0xff, win0v & 0xff],
    bg2Y: GetBgY(2) / 256,
    bg2ScrollRow: r.bg2ScrollRow,
    rectCursor: r.rectCursorSpriteLeft ? { x: r.rectCursorSpriteLeft.x, y: r.rectCursorSpriteLeft.y, anim: r.rectCursorSpriteLeft.animNum } : null,
    wordCursor: r.selectWordCursorSprite ? { x: r.selectWordCursorSprite.x, y: r.selectWordCursorSprite.y } : null,
    modeAnim: r.modeIconsSprite ? r.modeIconsSprite.animNum : null,
    helpX2: r.selectGroupHelpSprite ? r.selectGroupHelpSprite.x2 : null,
    scrollArrows: r.upTriangleCursorSprite && r.downTriangleCursorSprite ? { x: r.upTriangleCursorSprite.x, up: !r.upTriangleCursorSprite.invisible, down: !r.downTriangleCursorSprite.invisible } : null,
    groups: Array.from({ length: GetNumDisplayableGroups() }, (_, i) => GetSelectedGroupByIndex(i)),
    words: Array.from({ length: GetNumDisplayedWords() }, (_, i) => GetDisplayedWordByIndex(i)),
    reprint: () => PrintECFields(),
  };
}
