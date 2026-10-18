// The Easy Chat screen on the GBA layer: easy_chat_2.c's task / CB2 wiring (DoEasyChatScreen, Task_InitEasyChat,
// Task_RunEasyChat with its fades, DismantleEasyChat, ShowEasyChatScreen's words by type) around the model in
// easyChatScreenModel.ts, and easy_chat_3.c's main layer: the graphics (graphics/easy_chat/ through the extractor),
// LoadEasyChatGraphics with the BG / window templates, the title, the instructions, the phrase frame
// (sPhraseFrameDimensions by frameId) and its fields, the DEL. ALL / CANCEL / OK footer, the bouncing triangle cursor,
// the START / SELECT button and scroll arrow sprites (created hidden), the YES/NO window, and the interface commands
// ECInterfaceCmd_01-08 (the field / footer / YES/NO actions).
//
// Not ported yet (SIDE_PLAN.md W-easychat unit 4): ECInterfaceCmd_09-22, the groups menu, the A-Z keyboard and the
// word list on window 2 (BG2, which stays hidden outside the empty WIN0 until then), the rectangle cursor, the mode
// window and the frame resize animation. Those commands log once and do nothing (see EasyChatInterfaceCommand_Run).

import { K } from '../battle/constants';
import { state } from '../battle/env';
import {
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  CopyToBgTilemapBuffer,
  FillBgTilemapBufferRect,
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
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
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
import { CopyEasyChatWord, DestroyEasyChatSelectionData, InitEasyChatSelection } from './easyChat';
import { easyChatWordsForType } from './easyChatData';
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
  GetMainCursorColumn,
  GetMainCursorRow,
  GetNumColumns,
  GetNumRows,
  GetTitleText,
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

/** FONT_NORMAL_COPY_1 (the port's fonts fall back to FONT_NORMAL's glyphs for the copies) */
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

/** struct ECWork (sEasyChatGraphicsResources): the part unit 3 uses, plus the screen's task / callback. */
interface ECWork {
  state: number;
  windowId: number;
  id: number;
  selectDestFieldCursorSprite: Sprite | null;
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

/** The commands 9-22 already reported as missing (logged once each). */
const sMissingCommandsLogged = new Set<number>();

/** For the probe: the last command run, and the screen's task. */
let sLastCommand = 0;
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
 * through CB2_ReturnToFieldContinueScript. Nothing for another type (the mail's words aren't modelled).
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
    selectDestFieldCursorSprite: null,
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

/** UpdateVerticalScrollArrowVisibility (unit 4's word / group lists) */
export function UpdateVerticalScrollArrowVisibility(): void {
  const r = res();
  r.upTriangleCursorSprite!.invisible = !ShouldDrawECUpArrow();
  r.downTriangleCursorSprite!.invisible = !ShouldDrawECDownArrow();
}

function HideVerticalScrollArrowSprites(): void {
  const r = res();
  r.upTriangleCursorSprite!.invisible = true;
  r.downTriangleCursorSprite!.invisible = true;
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

/** UpdateStartSelectButtonSpriteVisibility (unit 4's word list) */
export function UpdateStartSelectButtonSpriteVisibility(): void {
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
    default:
      if (id >= 9 && id <= 22) {
        // ECInterfaceCmd_09-22 (the groups / keyboard / word list) are SIDE_PLAN.md W-easychat unit 4: the model
        // moves on, the screen draws nothing for them yet.
        if (!sMissingCommandsLogged.has(id)) {
          sMissingCommandsLogged.add(id);
          console.warn(`[easy chat] ECInterfaceCmd_${String(id).padStart(2, '0')} isn't ported yet (unit 4)`);
        }
      }
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

// ------------------------------------------------------------------ dev

/**
 * Dev: the screen while it's up (for the e2e tests): the model (`screen`, live: a test may write a word into its
 * ecWordBuffer), the last interface command, the triangle cursor's position and whether it bounces, the phrase
 * window's id, whether the START / SELECT sprites show, and `idle`: Task_RunEasyChat reads the keys (state 1, no
 * fade). `reprint` is PrintECFields.
 */
export function easyChatProbe():
  | {
      screen: ReturnType<typeof GetEasyChatScreen>;
      lastCommand: number;
      cursor: { x: number; y: number; x2: number; bouncing: boolean } | null;
      startSelectVisible: boolean;
      idle: boolean;
      reprint(): void;
    }
  | undefined {
  const r = sEasyChatGraphicsResources;
  if (!r) return undefined;
  const c = r.selectDestFieldCursorSprite;
  return {
    screen: GetEasyChatScreen(),
    lastCommand: sLastCommand,
    cursor: c ? { x: c.x, y: c.y, x2: c.x2, bouncing: c.data[1] !== 0 } : null,
    startSelectVisible: !!r.startPgUpButtonSprite && !r.startPgUpButtonSprite.invisible,
    idle: sTaskId >= 0 && gTasks[sTaskId].func === Task_RunEasyChat && gTasks[sTaskId].data[EZCHAT_TASK_STATE] === 1 && !gPaletteFade.active,
    reprint: () => PrintECFields(),
  };
}

