// diploma.c: the game designer's diploma for a complete Pokédex (CeladonCity_Condominiums_3F, `special
// ShowDiploma`). BG1 holds the 512x256 diploma (graphics/diploma, through the extractor); BG1HOFS shows its right
// half (NATIONAL) once every mon but the event ones is caught (HasAllMons), its left half (KANTO) otherwise.
// BG0 is the text window. A fades out and returns to the field (CB2_ReturnToFieldFromDiploma).

import { K } from '../battle/constants';
import { charmap, state } from '../battle/env';
import {
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
import { DISPCNT_OBJ_1D_MAP, DISPCNT_OBJ_ON, PALETTES_ALL, pltt, REG_OFFSET_BG1HOFS, REG_OFFSET_DISPCNT, RGB_BLACK, SetGpuReg, vram } from '../gba/hw';
import { A_BUTTON, JOY_NEW, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, LoadPalette, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlayFanfareByFanfareNum, WaitFanfare } from '../gba/sound';
import { AnimateSprites, BuildOamBuffer, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks, type TaskFunc } from '../gba/task';
import {
  AddTextPrinterParameterized3,
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
import { EOS } from '../text/charmap';
import { FONT_NORMAL } from '../text/Font';
import { CB2_ReturnToField } from './fieldCallbacks';
import { text } from './common';
import { DynamicPlaceholderTextUtil_ExpandPlaceholders, DynamicPlaceholderTextUtil_Reset, DynamicPlaceholderTextUtil_SetPlaceholderPtr } from './dynamicPlaceholderText';
import { HasAllMons } from './pokedex';

/** The graphics the diploma draws (preloaded by runScreenFromScript). */
export const DIPLOMA_GFX = ['sDiplomaGfx', 'sDiplomaTilemap', 'sDiplomaPal'];

const BG_TEXT = 0;
const BG_DIPLOMA = 1;
const WIN_TEXT = 0;

/** struct Diploma */
let sDiploma: { mainState: number; gfxState: number; initState: number; tilemapBuffer: Uint16Array } | undefined;

const sTextColors = [0, 2, 3];

const sBgTemplates: BgTemplate[] = [
  { bg: BG_TEXT, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 1 },
  { bg: BG_DIPLOMA, charBaseIndex: 1, mapBaseIndex: 29, screenSize: 1, paletteMode: 0, priority: 1, baseTile: 0 },
];

const sWindowTemplates: WindowTemplate[] = [{ bg: BG_TEXT, tilemapLeft: 0, tilemapTop: 2, width: 29, height: 16, paletteNum: 15, baseBlock: 0x000 }, DUMMY_WIN_TEMPLATE];

function VBlankCB_Diploma(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/** CB2_ShowDiploma */
export function CB2_ShowDiploma(): void {
  sDiploma = { mainState: 0, gfxState: 0, initState: 0, tilemapBuffer: new Uint16Array(0x800) };
  DiplomaReset();
  CreateTask(Task_DiplomaInit, 0);
  SetMainCallback2(CB2_Diploma);
}

function CB2_Diploma(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

const Task_DiplomaInit: TaskFunc = (taskId) => {
  const d = sDiploma!;
  switch (d.initState) {
    case 0:
      SetVBlankCallback(null);
      break;
    case 1:
      DiplomaInitScreen();
      break;
    case 2:
      if (!DiplomaLoadGfx()) return;
      break;
    case 3:
      CopyToBgTilemapBuffer(BG_DIPLOMA, gfx16('sDiplomaTilemap'), 0, 0);
      break;
    case 4:
      SetGpuReg(REG_OFFSET_BG1HOFS, HasAllMons(state) ? 0x100 : 0);
      break;
    case 5:
      DiplomaPrintText();
      break;
    case 6:
      CopyBgTilemapBufferToVram(BG_TEXT);
      CopyBgTilemapBufferToVram(BG_DIPLOMA);
      break;
    case 7:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      break;
    case 8:
      SetVBlankCallback(VBlankCB_Diploma);
      break;
    default:
      if (gPaletteFade.active) break;
      PlayFanfareByFanfareNum(K.FANFARE_OBTAIN_BADGE);
      gTasks[taskId].func = Task_HandleDiplomaInput;
  }
  d.initState++;
};

const Task_HandleDiplomaInput: TaskFunc = (taskId) => {
  const d = sDiploma!;
  switch (d.mainState) {
    case 0:
      if (WaitFanfare(false)) d.mainState++;
      break;
    case 1:
      if (JOY_NEW(A_BUTTON)) {
        BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
        d.mainState++;
      }
      break;
    case 2:
      Task_DiplomaExit(taskId);
      break;
  }
};

function Task_DiplomaExit(taskId: number): void {
  if (gPaletteFade.active) return;
  DestroyTask(taskId);
  FreeAllWindowBuffers();
  sDiploma = undefined;
  SetMainCallback2(CB2_ReturnToFieldFromDiploma);
}

/**
 * CB2_ReturnToFieldFromDiploma (overworld.c): gFieldCallback = FieldCB_WarpExitFadeFromBlack, CB2_ReturnToField.
 * The field's plain return fades in from black the same way.
 */
function CB2_ReturnToFieldFromDiploma(): void {
  SetVBlankCallback(null); // FieldClearVBlankHBlankCallbacks
  CB2_ReturnToField();
}

function DiplomaReset(): void {
  ResetSpriteData();
  ResetPaletteFade();
  // FreeAllSpritePalettes: ResetSpriteData's
  ResetTasks();
  ScanlineEffect_Stop();
}

function DiplomaInitScreen(): void {
  vram.fill(0);
  pltt.fill(0); // OAM is ResetSpriteData's
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBgTemplates, sBgTemplates.length);
  for (let bg = 0; bg < 4; bg++) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }
  InitWindows(sWindowTemplates);
  DeactivateAllTextPrinters();
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
  SetBgTilemapBuffer(BG_DIPLOMA, sDiploma!.tilemapBuffer);
  ShowBg(BG_TEXT);
  ShowBg(BG_DIPLOMA);
  FillBgTilemapBufferRect_Palette0(BG_TEXT, 0, 0, 0, 30, 20);
  FillBgTilemapBufferRect_Palette0(BG_DIPLOMA, 0, 0, 0, 30, 20);
}

function DiplomaLoadGfx(): boolean {
  const d = sDiploma!;
  switch (d.gfxState) {
    case 0: // ResetTempTileDataBuffers
      break;
    case 1: {
      const tiles = gfx('sDiplomaGfx'); // DecompressAndCopyTileDataToVram
      LoadBgTiles(BG_DIPLOMA, tiles, tiles.length, 0);
      break;
    }
    case 2: // FreeTempTileDataBuffersIfPossible: the copy is done at once
      break;
    case 3:
    default:
      LoadPalette(gfx16('sDiplomaPal'), BG_PLTT_ID(0), gfx16('sDiplomaPal').length * 2);
      return true;
  }
  d.gfxState++;
  return false;
}

function DiplomaPrintText(): void {
  DynamicPlaceholderTextUtil_Reset();
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(0, [...charmap.encodePlain(state.playerName), EOS]);
  DynamicPlaceholderTextUtil_SetPlaceholderPtr(1, text(HasAllMons(state) ? 'gText_Diploma_National' : 'gText_Diploma_Kanto'));
  FillWindowPixelBuffer(WIN_TEXT, PIXEL_FILL(0));
  let str = DynamicPlaceholderTextUtil_ExpandPlaceholders(text('gText_Diploma_Player'));
  let width = GetStringWidth(FONT_NORMAL, str, -1);
  AddTextPrinterParameterized3(WIN_TEXT, FONT_NORMAL, 120 - (width >> 1), 4, sTextColors, TEXT_SKIP_DRAW, str);
  str = DynamicPlaceholderTextUtil_ExpandPlaceholders(text('gText_Diploma_ThisDocument'));
  width = GetStringWidth(FONT_NORMAL, str, -1);
  AddTextPrinterParameterized3(WIN_TEXT, FONT_NORMAL, 120 - (width >> 1), 30, sTextColors, TEXT_SKIP_DRAW, str);
  AddTextPrinterParameterized3(WIN_TEXT, FONT_NORMAL, 120, 105, sTextColors, 0, text('gText_Diploma_GameFreak'));
  PutWindowTilemap(WIN_TEXT);
}

/** Dev: the diploma's state (for the e2e tests): its init / input states and which half BG1 shows. */
export function diplomaProbe(): { initState: number; mainState: number; national: boolean } | undefined {
  if (!sDiploma) return undefined;
  return { initState: sDiploma.initState, mainState: sDiploma.mainState, national: HasAllMons(state) };
}
