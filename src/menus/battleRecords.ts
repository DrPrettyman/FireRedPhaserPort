// battle_records.c: the records screen. `special ShowBattleRecords` from a script that has faded to black
// (`fadescreen FADE_TO_BLACK`, then `waitstate`): VAR_0x8004 != 0 prints the Trainer Tower's TIME BOARD
// (PrintTrainerTowerRecords, trainer_tower.c: world/trainerTower.ts; TrainerTower_Lobby_EventScript_ShowRecords),
// 0 the link battle results (PrintBattleRecords; CableClub_EventScript_ShowBattleRecords, the MB_BATTLE_RECORDS
// metatile). BG3 is the frame (graphics/battle_records, through the extractor), BG0 the one text window. A or B
// fades out and returns through CB2_ReturnToFieldContinueScriptPlayMapMusic.
//
// The link records (gSaveBlock2Ptr->linkBattleRecords) are only written by link battles (UpdatePlayerLinkBattleRecords),
// which the port doesn't have, so the page reads five cleared entries (dashes) and the GAME_STAT_LINK_BATTLE_* totals.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { ChangeBgX, ChangeBgY, CopyBgTilemapBufferToVram, CopyToBgTilemapBufferRect, InitBgsFromTemplates, IsDma3ManagerBusyWithBgCopy, LoadBgTiles, ResetBgsAndClearDma3BusyFlags, SetBgTilemapBuffer, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx16 } from '../gba/gfx';
import {
  DISPCNT_BG0_ON,
  DISPCNT_BG3_ON,
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
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
  REG_OFFSET_BG3CNT,
  REG_OFFSET_BG3HOFS,
  REG_OFFSET_BG3VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  SetGpuReg,
  vram,
} from '../gba/hw';
import { A_BUTTON, B_BUTTON, gMain, JOY_NEW, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { GetTextWindowPalette } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import { AnimateSprites, BuildOamBuffer, FreeAllSpritePalettes, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks, type TaskFunc } from '../gba/task';
import {
  AddTextPrinterParameterized3,
  AddTextPrinterParameterized4,
  ClearWindowTilemap,
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
  RemoveWindow,
  type WindowTemplate,
} from '../gba/window';
import { EOS } from '../text/charmap';
import { FONT_NORMAL } from '../text/Font';
import { PrintTrainerTowerRecords } from '../world/trainerTower';
import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEFT_ALIGN, STR_CONV_MODE_RIGHT_ALIGN, StringExpandPlaceholders, strBody, text } from './common';
import { CB2_ReturnToFieldContinueScriptPlayMapMusic } from './fieldCallbacks';
import { ResetAllPicSprites } from './picSprites';

/** The graphics the screen draws (runScreenFromScript preloads them): sTiles, sPalette, sTilemap. */
export const BATTLE_RECORDS_GFX = ['battle_records.sTiles', 'sPalette', 'sTilemap'];

const CHAR_SPACE = 0x00;

/** sBg3TilemapBuffer_p (AllocZeroed(0x800)) */
let sBg3TilemapBuffer: Uint16Array | null = null;

const sWindowTemplates: WindowTemplate[] = [{ bg: 0, tilemapLeft: 2, tilemapTop: 1, width: 27, height: 18, paletteNum: 15, baseBlock: 0x014 }, DUMMY_WIN_TEMPLATE];

/** sTextColor: TEXT_COLOR_TRANSPARENT, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_LIGHT_GRAY */
const sTextColor = [0, 2, 3];

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 },
  { bg: 3, charBaseIndex: 1, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0x000 },
];

/** The strings printed on the window since the screen was set up, for the tests (`battleRecordsProbe`). */
let sPrinted: { x: number; y: number; str: number[] }[] = [];

/** AddTextPrinterParameterized4(windowId, FONT_NORMAL, ..., speed 0, str), logged for the probe. */
function PrintOnRecordsWindow(windowId: number, x: number, y: number, letterSpacing: number, lineSpacing: number, color: number[], str: number[]): void {
  sPrinted.push({ x, y, str: [...strBody(str)] });
  AddTextPrinterParameterized4(windowId, FONT_NORMAL, x, y, letterSpacing, lineSpacing, color, 0, str);
}

/** AddTextPrinterParameterized3(windowId, FONT_NORMAL, x, y, color, 0, str) (PrintTrainerTowerRecords), logged. */
function PrintOnRecordsWindow3(windowId: number, x: number, y: number, color: number[], str: number[]): void {
  sPrinted.push({ x, y, str: [...strBody(str)] });
  AddTextPrinterParameterized3(windowId, FONT_NORMAL, x, y, color, 0, str);
}

/** ShowBattleRecords: from a faded-out field; VAR_0x8004 picks the page. */
export function ShowBattleRecords(): void {
  SetVBlankCallback(null);
  SetMainCallback2(MainCB2_SetUp);
}

function MainCB2_SetUp(): void {
  switch (gMain.state) {
    case 0:
      SetVBlankCallback(null);
      ResetGpu();
      gMain.state++;
      break;
    case 1:
      StopAllRunningTasks();
      gMain.state++;
      break;
    case 2:
      sBg3TilemapBuffer = new Uint16Array(0x400);
      ResetBgsAndClearDma3BusyFlags(false);
      InitBgsFromTemplates(0, sBgTemplates, sBgTemplates.length);
      SetBgTilemapBuffer(3, sBg3TilemapBuffer);
      ResetBGPos();
      gMain.state++;
      break;
    case 3:
      LoadFrameGfxOnBg(3);
      LoadPalette(GetTextWindowPalette(0), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
      gMain.state++;
      break;
    case 4:
      if (IsDma3ManagerBusyWithBgCopy() !== true) {
        ShowBg(0);
        ShowBg(3);
        CopyBgTilemapBufferToVram(3);
        gMain.state++;
      }
      break;
    case 5:
      InitWindows(sWindowTemplates);
      DeactivateAllTextPrinters();
      gMain.state++;
      break;
    case 6:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      gMain.state++;
      break;
    case 7:
      EnableDisplay();
      SetVBlankCallback(VBlankCB);
      sPrinted = [];
      if (state.getVar('VAR_0x8004')) PrintTrainerTowerRecords(state, PrintOnRecordsWindow3);
      else PrintBattleRecords();
      CreateTask(Task_WaitFadeIn, 8);
      SetMainCallback2(MainCB2);
      gMain.state = 0;
      break;
  }
}

function VBlankCB(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function MainCB2(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

const Task_WaitFadeIn: TaskFunc = (taskId) => {
  if (!gPaletteFade.active) gTasks[taskId].func = Task_WaitButton;
};

const Task_WaitButton: TaskFunc = (taskId) => {
  if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    gTasks[taskId].func = Task_FadeOut;
  }
};

const Task_FadeOut: TaskFunc = (taskId) => {
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
  gTasks[taskId].func = Task_DestroyAndReturnToField;
};

const Task_DestroyAndReturnToField: TaskFunc = (taskId) => {
  if (!gPaletteFade.active) {
    SetMainCallback2(CB2_ReturnToFieldContinueScriptPlayMapMusic);
    sBg3TilemapBuffer = null; // Free
    ClearWindowCommitAndRemove(0);
    FreeAllWindowBuffers();
    DestroyTask(taskId);
  }
};

function ClearWindowCommitAndRemove(windowId: number): void {
  FillWindowPixelBuffer(windowId, PIXEL_FILL(0));
  ClearWindowTilemap(windowId);
  CopyWindowToVram(windowId, COPYWIN_GFX);
  RemoveWindow(windowId);
}

function ResetGpu(): void {
  vram.fill(0); // DmaClearLarge16(VRAM)
  // DmaClear32(OAM): the PPU reads the OAM buffer, which ResetSpriteData clears
  pltt.fill(0); // DmaClear16(PLTT)
  for (const reg of [
    REG_OFFSET_DISPCNT,
    REG_OFFSET_BG0CNT,
    REG_OFFSET_BG0HOFS,
    REG_OFFSET_BG0VOFS,
    REG_OFFSET_BG1CNT,
    REG_OFFSET_BG1HOFS,
    REG_OFFSET_BG1VOFS,
    REG_OFFSET_BG2CNT,
    REG_OFFSET_BG2HOFS,
    REG_OFFSET_BG2VOFS,
    REG_OFFSET_BG3CNT,
    REG_OFFSET_BG3HOFS,
    REG_OFFSET_BG3VOFS,
    REG_OFFSET_WIN0H,
    REG_OFFSET_WIN0V,
    REG_OFFSET_WININ,
    REG_OFFSET_WINOUT,
    REG_OFFSET_BLDCNT,
    REG_OFFSET_BLDALPHA,
    REG_OFFSET_BLDY,
  ]) {
    SetGpuReg(reg, 0);
  }
}

function StopAllRunningTasks(): void {
  ScanlineEffect_Stop();
  ResetTasks();
  ResetSpriteData();
  ResetAllPicSprites();
  ResetPaletteFade();
  FreeAllSpritePalettes();
}

function EnableDisplay(): void {
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG0_ON | DISPCNT_BG3_ON);
}

function ResetBGPos(): void {
  for (let bg = 0; bg < 4; bg++) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }
}

// ------------------------------------------------------------------ the link page

/** struct LinkBattleRecord */
interface LinkBattleRecord {
  name: number[];
  trainerId: number;
  wins: number;
  losses: number;
  draws: number;
}

/**
 * gSaveBlock2Ptr->linkBattleRecords.entries: LINK_B_RECORDS_COUNT cleared records (ClearLinkBattleRecord). Only a
 * link battle writes them (AddOpponentLinkBattleRecord), so in the port they stay cleared.
 */
function linkBattleRecords(): LinkBattleRecord[] {
  return Array.from({ length: K.LINK_B_RECORDS_COUNT }, () => ({ name: [EOS], trainerId: 0, wins: 0, losses: 0, draws: 0 }));
}

/** PrintTotalRecord: W / L / D from the game stats, each left-aligned and padded with spaces to 4 characters. */
function PrintTotalRecord(): void {
  const stat = (id: number) => Math.min(9999, state.getGameStat(id));
  const counts = [stat(K.GAME_STAT_LINK_BATTLE_WINS), stat(K.GAME_STAT_LINK_BATTLE_LOSSES), stat(K.GAME_STAT_LINK_BATTLE_DRAWS)];
  for (let i = 0; i < 3; i++) {
    // ConvertIntToDecimalStringN, then the EOS and what follows it up to 4 characters become spaces
    const digits = strBody(ConvertIntToDecimalStringN(counts[i], STR_CONV_MODE_LEFT_ALIGN, 4));
    while (digits.length < 4) digits.push(CHAR_SPACE);
    state.stringVars[i] = digits;
  }
  const str = StringExpandPlaceholders(text('gString_BattleRecords_TotalRecord'));
  PrintOnRecordsWindow(0, 12, 24, 0, 2, sTextColor, str);
}

/** PrintOpponentBattleRecord */
function PrintOpponentBattleRecord(record: LinkBattleRecord, y: number): void {
  if (record.wins === 0 && record.losses === 0 && record.draws === 0) {
    PrintOnRecordsWindow(0, 0, y, 0, 2, sTextColor, text('gString_BattleRecords_7Dashes'));
    for (const x of [0x54, 0x84, 0xb4]) PrintOnRecordsWindow(0, x, y, 0, 2, sTextColor, text('gString_BattleRecords_4Dashes'));
  } else {
    // StringFillWithTerminator + StringCopyN(gStringVar1, record->name, PLAYER_NAME_LENGTH)
    PrintOnRecordsWindow(0, 0, y, 0, 2, sTextColor, [...strBody(record.name).slice(0, K.PLAYER_NAME_LENGTH), EOS]);
    const cols: [number, number][] = [
      [0x54, record.wins],
      [0x84, record.losses],
      [0xb4, record.draws],
    ];
    for (const [x, n] of cols) PrintOnRecordsWindow(0, x, y, 0, 2, sTextColor, ConvertIntToDecimalStringN(n, STR_CONV_MODE_RIGHT_ALIGN, 4));
  }
}

/** PrintBattleRecords: the link page (VAR_0x8004 == 0). */
function PrintBattleRecords(): void {
  FillWindowPixelRect(0, PIXEL_FILL(0), 0, 0, 0xd8, 0x90);
  const title = StringExpandPlaceholders(text('gString_BattleRecords_PlayersBattleResults'));
  const left = (0xd0 - GetStringWidth(FONT_NORMAL, title, -1)) >>> 0;
  PrintOnRecordsWindow(0, (left / 2) >>> 0, 4, 0, 2, sTextColor, title);
  PrintTotalRecord();
  PrintOnRecordsWindow(0, 0x54, 0x30, 0, 2, sTextColor, text('gString_BattleRecords_ColumnHeaders'));
  const records = linkBattleRecords();
  for (let i = 0; i < records.length; i++) PrintOpponentBattleRecord(records[i], 0x3d + 14 * i);
  CommitWindow(0);
}

function CommitWindow(windowId: number): void {
  PutWindowTilemap(windowId);
  CopyWindowToVram(windowId, COPYWIN_FULL);
}

/** LoadFrameGfxOnBg: the frame's 6 tiles, its 32x32 tilemap and palette 0. */
function LoadFrameGfxOnBg(bg: number): void {
  LoadBgTiles(bg, gfx16('battle_records.sTiles'), 0xc0, 0);
  CopyToBgTilemapBufferRect(bg, gfx16('sTilemap'), 0, 0, 32, 32);
  LoadPalette(gfx16('sPalette'), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
}

/** Dev: what the screen printed (encoded strings with their x / y in the window), while its main callback runs. */
export function battleRecordsProbe(): { x: number; y: number; str: number[] }[] | undefined {
  return gMain.callback2 === MainCB2 ? sPrinted : undefined;
}
