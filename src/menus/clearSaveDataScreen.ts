// clear_save_data_screen.c: B+SELECT+UP on the title screen. "Clear all save data areas?" with a YES/NO menu
// (NO by default); YES empties the save slot. Either way it fades out and soft-resets. The host fills in
// `clearSaveDataEnv` (scenes/MainMenuScene.ts).

import { ChangeBgX, ChangeBgY, CopyBgTilemapBufferToVram, InitBgsFromTemplates, ResetBgsAndClearDma3BusyFlags, ShowBg, type BgTemplate } from '../gba/bg';
import { DISPCNT_MODE_0, DISPCNT_OBJ_1D_MAP, DISPCNT_OBJ_ON, PALETTES_ALL, pltt, REG_OFFSET_BLDY, REG_OFFSET_DISPCNT, RGB_BLACK, RGB_WHITE, SetGpuReg, vram } from '../gba/hw';
import { SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { CreateYesNoMenu, DrawStdFrameWithCustomTileAndPalette, LoadStdWindowGfx, Menu_ProcessInputNoWrapClearOnChoose, MENU_B_PRESSED, MENU_NOTHING_CHOSEN } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { PlaySE } from '../gba/sound';
import { AnimateSprites, BuildOamBuffer, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks, type TaskFunc } from '../gba/task';
import {
  AddTextPrinterParameterized4,
  CopyWindowToVram,
  COPYWIN_FULL,
  COPYWIN_GFX,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  InitWindows,
  PIXEL_FILL,
  type WindowTemplate,
} from '../gba/window';
import { EOS } from '../text/charmap';
import { FONT_NORMAL } from '../text/Font';

export const clearSaveDataEnv = {
  /** A decomp constant (SE_*). */
  define: (_name: string): number => 0,
  /** A gText_* string from strings.c, encoded with EOS. */
  text: (_label: string): number[] => [EOS],
  /** ClearSaveData: empty the save slot. */
  clearSaveData: (): void => {},
  /** DoSoftReset */
  softReset: (): void => {},
};

const RGB_WHITEALPHA = RGB_WHITE | 0x8000;

const sState = { drawStep: 0, answered: 0, resetStep: 0 }; // sClearSaveDataState->unk1, unk0, unk2

const sBgTemplates: BgTemplate[] = [{ bg: 0, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 }];

const sWindowTemplates: WindowTemplate[] = [
  { bg: 0, tilemapLeft: 3, tilemapTop: 5, width: 6, height: 4, paletteNum: 15, baseBlock: 0x00a },
  { bg: 0, tilemapLeft: 3, tilemapTop: 15, width: 23, height: 4, paletteNum: 15, baseBlock: 0x022 },
  DUMMY_WIN_TEMPLATE,
];

// TEXT_COLOR_WHITE, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_LIGHT_GRAY
const sTextColor = [1, 2, 3];

function CB2_RunClearSaveDataScreen(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

function VBlankCB_WaitYesNo(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/** CB2_SaveClearScreen_Init */
export function CB2_SaveClearScreen_Init(): void {
  sState.drawStep = 0;
  sState.answered = 0;
  sState.resetStep = 0;
  CB2_Sub_SaveClearScreen_Init();
  CreateTask(Task_DrawClearSaveDataScreen, 0);
  SetMainCallback2(CB2_RunClearSaveDataScreen);
}

const Task_DrawClearSaveDataScreen: TaskFunc = (taskId) => {
  switch (sState.drawStep) {
    case 0:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
      break;
    case 1:
      if (gPaletteFade.active) return;
      SetVBlankCallback(null);
      break;
    case 2:
      SaveClearScreen_GpuInit();
      break;
    case 3:
      LoadStdWindowGfx(0, 0x001, BG_PLTT_ID(15));
      LoadStdWindowGfx(1, 0x001, BG_PLTT_ID(15));
      break;
    case 4:
      DrawStdFrameWithCustomTileAndPalette(1, true, 0x001, 15);
      AddTextPrinterParameterized4(1, FONT_NORMAL, 0, 3, 1, 1, sTextColor, 0, clearSaveDataEnv.text('gText_ClearAllSaveData'));
      CopyWindowToVram(1, COPYWIN_GFX);
      break;
    case 5:
      CreateYesNoMenu(sWindowTemplates[0], FONT_NORMAL, 0, 2, 0x001, 15, 1);
      CopyBgTilemapBufferToVram(0);
      break;
    default:
      BeginNormalPaletteFade(0xffff, 0, 16, 0, RGB_WHITEALPHA);
      SetVBlankCallback(VBlankCB_WaitYesNo);
      gTasks[taskId].func = Task_HandleYesNoMenu;
      break;
  }
  sState.drawStep++;
};

const Task_HandleYesNoMenu: TaskFunc = (taskId) => {
  if (sState.answered === 0) {
    switch (Menu_ProcessInputNoWrapClearOnChoose()) {
      case MENU_B_PRESSED:
      case 1:
        PlaySE(clearSaveDataEnv.define('SE_SELECT'));
        break;
      case 0:
        PlaySE(clearSaveDataEnv.define('SE_SELECT'));
        FillWindowPixelBuffer(1, PIXEL_FILL(1));
        AddTextPrinterParameterized4(1, FONT_NORMAL, 0, 3, 1, 1, sTextColor, 0, clearSaveDataEnv.text('gText_ClearingData'));
        CopyWindowToVram(1, COPYWIN_FULL);
        clearSaveDataEnv.clearSaveData();
        break;
      case MENU_NOTHING_CHOSEN:
      default:
        return;
    }
    sState.answered++;
  } else {
    Task_CleanUpAndSoftReset(taskId);
  }
};

function Task_CleanUpAndSoftReset(taskId: number): void {
  switch (sState.resetStep) {
    case 0:
      BeginNormalPaletteFade(0xffff, 0, 0, 16, RGB_WHITEALPHA);
      sState.resetStep++;
      break;
    case 1:
      if (!gPaletteFade.active) {
        // DestroyYesNoMenu: Menu_ProcessInputNoWrapClearOnChoose already destroyed it (the C does it twice)
        DestroyTask(taskId);
        FreeAllWindowBuffers();
        clearSaveDataEnv.softReset(); // DoSoftReset
      }
      break;
  }
}

function CB2_Sub_SaveClearScreen_Init(): void {
  ResetSpriteData();
  ResetPaletteFade();
  ResetTasks();
}

function SaveClearScreen_GpuInit(): void {
  vram.fill(0);
  pltt.fill(0); // OAM is ResetSpriteData's
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  SetGpuReg(REG_OFFSET_BLDY, 0);
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBgTemplates);
  for (let bg = 0; bg < 4; bg++) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }
  InitWindows(sWindowTemplates);
  DeactivateAllTextPrinters();
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
  ShowBg(0);
}

/** Dev: whether the clear save data screen's YES/NO is up (for the e2e tests). */
export function clearSaveDataProbe(): { waitingForAnswer: boolean } | undefined {
  const task = gTasks.find((t) => t.isActive && (t.func === Task_HandleYesNoMenu || t.func === Task_DrawClearSaveDataScreen));
  if (!task) return undefined;
  return { waitingForAnswer: task.func === Task_HandleYesNoMenu && sState.answered === 0 && !gPaletteFade.active };
}
