// main_menu.c: CONTINUE (with the player's name, play time, Pokédex count and badges) / NEW GAME on the GBA layer,
// the save error messages, and the darkening outside WIN0 that marks the selected window. FRLG's main menu has no
// OPTIONS (that's R/S/E); MYSTERY GIFT needs IsMysteryGiftEnabled, which the port doesn't keep, so the menu is
// always CONTINUE / NEW GAME. A host scene (scenes/MainMenuScene.ts) fills in `mainMenuEnv` and runs
// CB2_InitMainMenu.

import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEADING_ZEROS, STR_CONV_MODE_LEFT_ALIGN } from '../battle/stringUtil';
import {
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  FillBgTilemapBufferRect,
  InitBgsFromTemplates,
  LoadBgTiles,
  ResetBgsAndClearDma3BusyFlags,
  ShowBg,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDALPHA_BLEND,
  BLDCNT_EFFECT_DARKEN,
  BLDCNT_TGT1_BD,
  BLDCNT_TGT1_BG0,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT1_BG2,
  BLDCNT_TGT1_BG3,
  BLDCNT_TGT1_OBJ,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  PALETTES_ALL,
  pltt,
  REG_OFFSET_BG0CNT,
  REG_OFFSET_BG0HOFS,
  REG_OFFSET_BG0VOFS,
  REG_OFFSET_BG1CNT,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2CNT,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB,
  RGB_BLACK,
  SetGpuReg,
  vram,
  WIN_RANGE,
} from '../gba/hw';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_UP, JOY_NEW, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { LoadStdWindowGfx } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import { AnimateSprites, BuildOamBuffer, FreeAllSpritePalettes, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks } from '../gba/task';
import {
  AddTextPrinterParameterized3,
  ClearWindowTilemap,
  CopyWindowToVram,
  COPYWIN_FULL,
  COPYWIN_GFX,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  InitWindows,
  IsTextPrinterActive,
  PIXEL_FILL,
  PutWindowTilemap,
  RunTextPrinters,
  type WindowTemplate,
} from '../gba/window';
import { SAVE_STATUS_EMPTY, SAVE_STATUS_ERROR, SAVE_STATUS_INVALID, SAVE_STATUS_OK } from '../state/save';
import { EOS } from '../text/charmap';
import { FONT_NORMAL } from '../text/Font';
import { caughtDexCount, countBadges, type SaveBlockView } from '../ui/saveMenuUtil';

// enum MainMenuType
const MAIN_MENU_NEWGAME = 0;
const MAIN_MENU_CONTINUE = 1;
const MAIN_MENU_MYSTERYGIFT = 2;

// enum MainMenuWindow
const MAIN_MENU_WINDOW_NEWGAME_ONLY = 0;
const MAIN_MENU_WINDOW_CONTINUE = 1;
const MAIN_MENU_WINDOW_NEWGAME = 2;
const MAIN_MENU_WINDOW_MYSTERYGIFT = 3;
const MAIN_MENU_WINDOW_ERROR = 4;

// task data
const tMenuType = 0;
const tCursorPos = 1;
const tUnused8 = 8;


/** What the main menu reads from outside main_menu.c: the loaded save, the string table and where its choices lead. */
export const mainMenuEnv = {
  /** A decomp constant (SE_*, CHAR_*, FLAG_*). */
  define: (_name: string): number => 0,
  /** gSaveFileStatus (SAVE_STATUS_*) */
  saveFileStatus: SAVE_STATUS_EMPTY,
  /** gSaveBlock1/2 as LoadGameSave left them (undefined when there's no save) */
  saveBlock: undefined as SaveBlockView | undefined,
  /** gSaveBlock2Ptr->optionsWindowFrameType */
  windowFrameType: 0,
  /** A gText_* string from strings.c, encoded with EOS. */
  text: (_label: string): number[] => [EOS],
  /** Plain text (the player's name), encoded with EOS. */
  encode: (_s: string): number[] => [EOS],
  /** TryStartQuestLogPlayback with no quest log scenes → SetMainCallback2(CB2_ContinueSavedGame) */
  continueSavedGame: (): void => {},
  /** StartNewGameScene (Oak's speech isn't ported: straight into the new game) */
  startNewGame: (): void => {},
};

const sWindowTemplate: WindowTemplate[] = [
  /* NEWGAME_ONLY */ { bg: 0, tilemapLeft: 3, tilemapTop: 1, width: 24, height: 2, paletteNum: 15, baseBlock: 0x001 },
  /* CONTINUE */ { bg: 0, tilemapLeft: 3, tilemapTop: 1, width: 24, height: 10, paletteNum: 15, baseBlock: 0x001 },
  /* NEWGAME */ { bg: 0, tilemapLeft: 3, tilemapTop: 13, width: 24, height: 2, paletteNum: 15, baseBlock: 0x0f1 },
  /* MYSTERYGIFT */ { bg: 0, tilemapLeft: 3, tilemapTop: 17, width: 24, height: 2, paletteNum: 15, baseBlock: 0x121 },
  /* ERROR */ { bg: 0, tilemapLeft: 3, tilemapTop: 15, width: 24, height: 4, paletteNum: 15, baseBlock: 0x001 },
  DUMMY_WIN_TEMPLATE,
];

/** Graphics the main menu loads (sBg_Pal, sTextbox_Pal, the user and std window frames). */
export const mainMenuGfxSymbols = (): string[] => [
  'sBg_Pal',
  'sTextbox_Pal',
  'gStdTextWindow_Gfx',
  'gTextWindowPalettes',
  ...Array.from({ length: 10 }, (_, i) => [`sUserFrame_Type${i + 1}_Gfx`, `sUserFrame_Type${i + 1}_Pal`]).flat(),
];

const sTextColor1 = [10, 11, 12];
const sTextColor2 = [10, 1, 12];

const sBgTemplate: BgTemplate[] = [{ bg: 0, charBaseIndex: 0, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 }];

const sMenuCursorYMax = [0, 1, 2];

function CB2_MainMenu(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

function VBlankCB_MainMenu(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/** CB2_InitMainMenu */
export function CB2_InitMainMenu(): void {
  MainMenuGpuInit(1);
}

function MainMenuGpuInit(a0: number): boolean {
  SetVBlankCallback(null);
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  SetGpuReg(REG_OFFSET_BG2CNT, 0);
  SetGpuReg(REG_OFFSET_BG1CNT, 0);
  SetGpuReg(REG_OFFSET_BG0CNT, 0);
  SetGpuReg(REG_OFFSET_BG2HOFS, 0);
  SetGpuReg(REG_OFFSET_BG2VOFS, 0);
  SetGpuReg(REG_OFFSET_BG1HOFS, 0);
  SetGpuReg(REG_OFFSET_BG1VOFS, 0);
  SetGpuReg(REG_OFFSET_BG0HOFS, 0);
  SetGpuReg(REG_OFFSET_BG0VOFS, 0);
  vram.fill(0); // DmaFill16(3, 0, VRAM, VRAM_SIZE); OAM is ResetSpriteData's
  pltt.fill(0, 1); // DmaFill16(3, 0, PLTT + 2, PLTT_SIZE - 2)
  ScanlineEffect_Stop();
  ResetTasks();
  ResetSpriteData();
  FreeAllSpritePalettes();
  ResetPaletteFade();
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBgTemplate);
  ChangeBgX(0, 0, 0);
  ChangeBgY(0, 0, 0);
  ChangeBgX(1, 0, 0);
  ChangeBgY(1, 0, 0);
  ChangeBgX(2, 0, 0);
  ChangeBgY(2, 0, 0);
  InitWindows(sWindowTemplate);
  DeactivateAllTextPrinters();
  LoadPalette(gfx16('sBg_Pal'), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
  LoadPalette(gfx16('sTextbox_Pal'), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
  SetGpuReg(REG_OFFSET_WIN0H, 0);
  SetGpuReg(REG_OFFSET_WIN0V, 0);
  SetGpuReg(REG_OFFSET_WININ, 0);
  SetGpuReg(REG_OFFSET_WINOUT, 0);
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  SetGpuReg(REG_OFFSET_BLDY, 0);
  SetMainCallback2(CB2_MainMenu);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON | DISPCNT_WIN0_ON);
  const taskId = CreateTask(Task_SetWin0BldRegsAndCheckSaveFile, 0);
  gTasks[taskId].data[tCursorPos] = 0;
  gTasks[taskId].data[tUnused8] = a0;
  return false;
}

/** The entire screen is darkened slightly except at WIN0, which marks the cursor position. */
function setWin0BldRegs(): void {
  SetGpuReg(REG_OFFSET_WIN0H, 0);
  SetGpuReg(REG_OFFSET_WIN0V, 0);
  SetGpuReg(REG_OFFSET_WININ, 0x0001);
  SetGpuReg(REG_OFFSET_WINOUT, 0x0021);
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_TGT1_BG0 | BLDCNT_TGT1_BG1 | BLDCNT_TGT1_BG2 | BLDCNT_TGT1_BG3 | BLDCNT_TGT1_OBJ | BLDCNT_TGT1_BD | BLDCNT_EFFECT_DARKEN);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 0));
  SetGpuReg(REG_OFFSET_BLDY, 7);
}

function Task_SetWin0BldRegsAndCheckSaveFile(taskId: number): void {
  if (gPaletteFade.active) return;
  setWin0BldRegs();
  const task = gTasks[taskId];
  switch (mainMenuEnv.saveFileStatus) {
    case SAVE_STATUS_OK:
      LoadUserFrameToBg(0);
      task.data[tMenuType] = MAIN_MENU_CONTINUE; // IsMysteryGiftEnabled: not kept, so never MAIN_MENU_MYSTERYGIFT
      task.func = Task_SetWin0BldRegsNoSaveFileCheck;
      break;
    case SAVE_STATUS_INVALID:
      SetStdFrame0OnBg(0);
      task.data[tMenuType] = MAIN_MENU_NEWGAME;
      PrintSaveErrorStatus(taskId, mainMenuEnv.text('gText_SaveFileHasBeenDeleted'));
      break;
    case SAVE_STATUS_ERROR:
      SetStdFrame0OnBg(0);
      task.data[tMenuType] = MAIN_MENU_CONTINUE;
      PrintSaveErrorStatus(taskId, mainMenuEnv.text('gText_SaveFileCorrupted'));
      break;
    case SAVE_STATUS_EMPTY:
    default:
      LoadUserFrameToBg(0);
      task.data[tMenuType] = MAIN_MENU_NEWGAME;
      task.func = Task_SetWin0BldRegsNoSaveFileCheck;
      break;
  }
}

function PrintSaveErrorStatus(taskId: number, str: number[]): void {
  PrintMessageOnWindow4(str);
  gTasks[taskId].func = Task_SaveErrorStatus_RunPrinterThenWaitButton;
  BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, 0xffff);
  ShowBg(0);
  SetVBlankCallback(VBlankCB_MainMenu);
}

function Task_SaveErrorStatus_RunPrinterThenWaitButton(taskId: number): void {
  if (gPaletteFade.active) return;
  RunTextPrinters();
  if (!IsTextPrinterActive(MAIN_MENU_WINDOW_ERROR) && JOY_NEW(A_BUTTON)) {
    ClearWindowTilemap(MAIN_MENU_WINDOW_ERROR);
    MainMenu_EraseWindow(sWindowTemplate[MAIN_MENU_WINDOW_ERROR]);
    LoadUserFrameToBg(0);
    if (gTasks[taskId].data[tMenuType] === MAIN_MENU_NEWGAME) gTasks[taskId].func = Task_SetWin0BldRegsNoSaveFileCheck;
    else gTasks[taskId].func = Task_PrintMainMenuText;
  }
}

function Task_SetWin0BldRegsNoSaveFileCheck(taskId: number): void {
  if (gPaletteFade.active) return;
  setWin0BldRegs();
  if (gTasks[taskId].data[tMenuType] === MAIN_MENU_NEWGAME) gTasks[taskId].func = Task_ExecuteMainMenuSelection;
  else gTasks[taskId].func = Task_WaitFadeAndPrintMainMenuText;
}

function Task_WaitFadeAndPrintMainMenuText(taskId: number): void {
  if (!gPaletteFade.active) Task_PrintMainMenuText(taskId);
}

function Task_PrintMainMenuText(taskId: number): void {
  setWin0BldRegs();
  const pal = mainMenuEnv.saveBlock?.playerGender === 'female' ? RGB(31, 3, 21) : RGB(4, 16, 31);
  LoadPalette([pal], BG_PLTT_ID(15) + 1, 2);
  const text = mainMenuEnv.text;
  switch (gTasks[taskId].data[tMenuType]) {
    case MAIN_MENU_NEWGAME:
    default:
      FillWindowPixelBuffer(MAIN_MENU_WINDOW_NEWGAME_ONLY, PIXEL_FILL(10));
      AddTextPrinterParameterized3(MAIN_MENU_WINDOW_NEWGAME_ONLY, FONT_NORMAL, 2, 2, sTextColor1, -1, text('gText_NewGame'));
      MainMenu_DrawWindow(sWindowTemplate[MAIN_MENU_WINDOW_NEWGAME_ONLY]);
      PutWindowTilemap(MAIN_MENU_WINDOW_NEWGAME_ONLY);
      CopyWindowToVram(MAIN_MENU_WINDOW_NEWGAME_ONLY, COPYWIN_FULL);
      break;
    case MAIN_MENU_CONTINUE:
      FillWindowPixelBuffer(MAIN_MENU_WINDOW_CONTINUE, PIXEL_FILL(10));
      FillWindowPixelBuffer(MAIN_MENU_WINDOW_NEWGAME, PIXEL_FILL(10));
      AddTextPrinterParameterized3(MAIN_MENU_WINDOW_CONTINUE, FONT_NORMAL, 2, 2, sTextColor1, -1, text('gText_Continue'));
      AddTextPrinterParameterized3(MAIN_MENU_WINDOW_NEWGAME, FONT_NORMAL, 2, 2, sTextColor1, -1, text('gText_NewGame'));
      PrintContinueStats();
      MainMenu_DrawWindow(sWindowTemplate[MAIN_MENU_WINDOW_CONTINUE]);
      MainMenu_DrawWindow(sWindowTemplate[MAIN_MENU_WINDOW_NEWGAME]);
      PutWindowTilemap(MAIN_MENU_WINDOW_CONTINUE);
      PutWindowTilemap(MAIN_MENU_WINDOW_NEWGAME);
      CopyWindowToVram(MAIN_MENU_WINDOW_CONTINUE, COPYWIN_GFX);
      CopyWindowToVram(MAIN_MENU_WINDOW_NEWGAME, COPYWIN_FULL);
      break;
    case MAIN_MENU_MYSTERYGIFT:
      // Not reachable: IsMysteryGiftEnabled isn't kept (MAIN_MENU_WINDOW_MYSTERYGIFT stays unused)
      void MAIN_MENU_WINDOW_MYSTERYGIFT;
      break;
  }
  gTasks[taskId].func = Task_WaitDma3AndFadeIn;
}

function Task_WaitDma3AndFadeIn(taskId: number): void {
  // WaitDma3Request(-1): copies are immediate here
  gTasks[taskId].func = Task_UpdateVisualSelection;
  BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, 0xffff);
  ShowBg(0);
  SetVBlankCallback(VBlankCB_MainMenu);
}

function Task_UpdateVisualSelection(taskId: number): void {
  MoveWindowByMenuTypeAndCursorPos(gTasks[taskId].data[tMenuType], gTasks[taskId].data[tCursorPos]);
  gTasks[taskId].func = Task_HandleMenuInput;
}

function Task_HandleMenuInput(taskId: number): void {
  if (!gPaletteFade.active && HandleMenuInput(taskId)) gTasks[taskId].func = Task_UpdateVisualSelection;
}

function Task_ExecuteMainMenuSelection(taskId: number): void {
  if (gPaletteFade.active) return;
  let menuAction: number;
  switch (gTasks[taskId].data[tMenuType]) {
    default:
    case MAIN_MENU_NEWGAME:
      menuAction = MAIN_MENU_NEWGAME;
      break;
    case MAIN_MENU_CONTINUE:
      menuAction = gTasks[taskId].data[tCursorPos] === 1 ? MAIN_MENU_NEWGAME : MAIN_MENU_CONTINUE;
      break;
  }
  switch (menuAction) {
    default:
    case MAIN_MENU_NEWGAME:
      // gExitStairsMovementDisabled = FALSE: no Task_ExitStairs in the port
      FreeAllWindowBuffers();
      DestroyTask(taskId);
      mainMenuEnv.startNewGame(); // StartNewGameScene
      break;
    case MAIN_MENU_CONTINUE:
      gPlttBufferUnfaded[0] = RGB_BLACK;
      gPlttBufferFaded[0] = RGB_BLACK;
      FreeAllWindowBuffers();
      // TryStartQuestLogPlayback: no quest log, so never any scenes to play back
      SetMainCallback2(null);
      DestroyTask(taskId);
      mainMenuEnv.continueSavedGame(); // SetMainCallback2(CB2_ContinueSavedGame)
      break;
  }
}

/** Task_ReturnToTileScreen: the title screen isn't ported, so it's as if START were pressed on it at once. */
function Task_ReturnToTileScreen(taskId: number): void {
  if (gPaletteFade.active) return;
  SetMainCallback2(CB2_InitMainMenu); // CB2_InitTitleScreen → ... → CB2_InitMainMenu
  DestroyTask(taskId);
}

function MoveWindowByMenuTypeAndCursorPos(menuType: number, cursorPos: number): void {
  let win0vTop: number;
  let win0vBot: number;
  SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(18, 222));
  switch (menuType) {
    default:
    case MAIN_MENU_NEWGAME:
      win0vTop = 0x00 << 8;
      win0vBot = 0x20;
      break;
    case MAIN_MENU_CONTINUE:
    case MAIN_MENU_MYSTERYGIFT:
      switch (cursorPos) {
        default:
        case 0: // CONTINUE
          win0vTop = 0x00 << 8;
          win0vBot = 0x60;
          break;
        case 1: // NEW GAME
          win0vTop = 0x60 << 8;
          win0vBot = 0x80;
          break;
        case 2: // MYSTERY GIFT
          win0vTop = 0x80 << 8;
          win0vBot = 0xa0;
          break;
      }
      break;
  }
  SetGpuReg(REG_OFFSET_WIN0V, ((win0vTop + (2 << 8)) | (win0vBot - 2)) & 0xffff);
}

function HandleMenuInput(taskId: number): boolean {
  const task = gTasks[taskId];
  if (JOY_NEW(A_BUTTON)) {
    PlaySE(mainMenuEnv.define('SE_SELECT'));
    BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
    task.func = Task_ExecuteMainMenuSelection;
  } else if (JOY_NEW(B_BUTTON)) {
    PlaySE(mainMenuEnv.define('SE_SELECT'));
    BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
    SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(0, 240));
    SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(0, 160));
    task.func = Task_ReturnToTileScreen;
  } else if (JOY_NEW(DPAD_UP) && task.data[tCursorPos] > 0) {
    task.data[tCursorPos]--;
    return true;
  } else if (JOY_NEW(DPAD_DOWN) && task.data[tCursorPos] < sMenuCursorYMax[task.data[tMenuType]]) {
    task.data[tCursorPos]++;
    return true;
  }
  return false;
}

function PrintMessageOnWindow4(str: number[]): void {
  FillWindowPixelBuffer(MAIN_MENU_WINDOW_ERROR, PIXEL_FILL(10));
  MainMenu_DrawWindow(sWindowTemplate[MAIN_MENU_WINDOW_ERROR]);
  AddTextPrinterParameterized3(MAIN_MENU_WINDOW_ERROR, FONT_NORMAL, 0, 2, sTextColor1, 2, str);
  PutWindowTilemap(MAIN_MENU_WINDOW_ERROR);
  CopyWindowToVram(MAIN_MENU_WINDOW_ERROR, COPYWIN_GFX);
  SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(19, 221));
  SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(115, 157));
}

function PrintContinueStats(): void {
  PrintPlayerName();
  PrintDexCount();
  PrintPlayTime();
  PrintBadgeCount();
}

function PrintPlayerName(): void {
  const sb = mainMenuEnv.saveBlock;
  AddTextPrinterParameterized3(MAIN_MENU_WINDOW_CONTINUE, FONT_NORMAL, 2, 18, sTextColor2, -1, mainMenuEnv.text('gText_Player'));
  AddTextPrinterParameterized3(MAIN_MENU_WINDOW_CONTINUE, FONT_NORMAL, 62, 18, sTextColor2, -1, mainMenuEnv.encode(sb?.playerName ?? ''));
}

function PrintPlayTime(): void {
  const t = mainMenuEnv.saveBlock?.playTime ?? { hours: 0, minutes: 0 };
  AddTextPrinterParameterized3(MAIN_MENU_WINDOW_CONTINUE, FONT_NORMAL, 2, 34, sTextColor2, -1, mainMenuEnv.text('gText_Time'));
  const strbuf = [...ConvertIntToDecimalStringN(t.hours, STR_CONV_MODE_LEFT_ALIGN, 3), mainMenuEnv.define('CHAR_COLON'), ...ConvertIntToDecimalStringN(t.minutes, STR_CONV_MODE_LEADING_ZEROS, 2), EOS];
  AddTextPrinterParameterized3(MAIN_MENU_WINDOW_CONTINUE, FONT_NORMAL, 62, 34, sTextColor2, -1, strbuf);
}

function PrintDexCount(): void {
  const sb = mainMenuEnv.saveBlock;
  if (!sb?.getFlag(mainMenuEnv.define('FLAG_SYS_POKEDEX_GET'))) return;
  AddTextPrinterParameterized3(MAIN_MENU_WINDOW_CONTINUE, FONT_NORMAL, 2, 50, sTextColor2, -1, mainMenuEnv.text('gText_Pokedex'));
  const strbuf = [...ConvertIntToDecimalStringN(caughtDexCount(sb), STR_CONV_MODE_LEFT_ALIGN, 3), ...mainMenuEnv.text('gTextJPDummy_Hiki')];
  AddTextPrinterParameterized3(MAIN_MENU_WINDOW_CONTINUE, FONT_NORMAL, 62, 50, sTextColor2, -1, strbuf);
}

function PrintBadgeCount(): void {
  const sb = mainMenuEnv.saveBlock;
  const nbadges = sb ? countBadges(sb) : 0;
  AddTextPrinterParameterized3(MAIN_MENU_WINDOW_CONTINUE, FONT_NORMAL, 2, 66, sTextColor2, -1, mainMenuEnv.text('gText_Badges'));
  const strbuf = [...ConvertIntToDecimalStringN(nbadges, STR_CONV_MODE_LEADING_ZEROS, 1), ...mainMenuEnv.text('gTextJPDummy_Ko')];
  AddTextPrinterParameterized3(MAIN_MENU_WINDOW_CONTINUE, FONT_NORMAL, 62, 66, sTextColor2, -1, strbuf);
}

/** LoadUserFrameToBg: GetUserWindowGraphics(optionsWindowFrameType)'s tiles at 0x1B1 and palette in slot 2. */
function LoadUserFrameToBg(bgId: number): void {
  const frame = `sUserFrame_Type${mainMenuEnv.windowFrameType + 1}`;
  LoadBgTiles(bgId, gfx(`${frame}_Gfx`), 0x120, 0x1b1);
  LoadPalette(gfx16(`${frame}_Pal`), BG_PLTT_ID(2), PLTT_SIZE_4BPP);
  MainMenu_EraseWindow(sWindowTemplate[MAIN_MENU_WINDOW_ERROR]);
}

function SetStdFrame0OnBg(_bgId: number): void {
  LoadStdWindowGfx(MAIN_MENU_WINDOW_NEWGAME_ONLY, 0x1b1, BG_PLTT_ID(2));
  MainMenu_EraseWindow(sWindowTemplate[MAIN_MENU_WINDOW_ERROR]);
}

function MainMenu_DrawWindow(t: WindowTemplate): void {
  FillBgTilemapBufferRect(t.bg, 0x1b1, t.tilemapLeft - 1, t.tilemapTop - 1, 1, 1, 2);
  FillBgTilemapBufferRect(t.bg, 0x1b2, t.tilemapLeft, t.tilemapTop - 1, t.width, t.height, 2);
  FillBgTilemapBufferRect(t.bg, 0x1b3, t.tilemapLeft + t.width, t.tilemapTop - 1, 1, 1, 2);
  FillBgTilemapBufferRect(t.bg, 0x1b4, t.tilemapLeft - 1, t.tilemapTop, 1, t.height, 2);
  FillBgTilemapBufferRect(t.bg, 0x1b6, t.tilemapLeft + t.width, t.tilemapTop, 1, t.height, 2);
  FillBgTilemapBufferRect(t.bg, 0x1b7, t.tilemapLeft - 1, t.tilemapTop + t.height, 1, 1, 2);
  FillBgTilemapBufferRect(t.bg, 0x1b8, t.tilemapLeft, t.tilemapTop + t.height, t.width, 1, 2);
  FillBgTilemapBufferRect(t.bg, 0x1b9, t.tilemapLeft + t.width, t.tilemapTop + t.height, 1, 1, 2);
  CopyBgTilemapBufferToVram(t.bg);
}

function MainMenu_EraseWindow(t: WindowTemplate): void {
  // (sic) the C passes left + width + 1 / top + height + 1 as the rectangle's size
  FillBgTilemapBufferRect(t.bg, 0x000, t.tilemapLeft - 1, t.tilemapTop - 1, t.tilemapLeft + t.width + 1, t.tilemapTop + t.height + 1, 2);
  CopyBgTilemapBufferToVram(t.bg);
}

/** Dev: the menu's state for the e2e tests (undefined when no main menu task runs). */
export function mainMenuProbe(): { menuType: number; cursorPos: number; fading: boolean } | undefined {
  const task = gTasks.find((t) => t.isActive && (t.func === Task_HandleMenuInput || t.func === Task_UpdateVisualSelection));
  if (!task) return undefined;
  return { menuType: task.data[tMenuType], cursorPos: task.data[tCursorPos], fading: gPaletteFade.active };
}
