// fame_checker.c: the Fame Checker key item's screen. UseFameChecker(savedCallback) runs on whichever GBA host
// opened it: the bag's USE (FieldUseFunc_FameChecker, back to CB2_BagMenuFromStartMenu) or SELECT on the field
// (Task_UseFameCheckerFromField, back to CB2_ReturnToField), both in menus/itemUse.ts.
//
// The screen: BG3 the background, BG2 the frame, BG1 (512 px wide) the info box and the pick-mode panel that slides
// in from the right, BG0 the windows (the persons list, the UI help line, the message box, the icon description).
// The list shows every person whose pickState isn't FCPICKSTATE_NO_DRAW (gSaveBlock1Ptr->fameChecker, set by the
// `famechecker` script macro's specials: state/fameChecker.ts), then CANCEL. Moving onto a person draws their six
// flavor-text icons: the object event the text came from where its flag is set, a "?" where not. A on a person with
// an unlocked text puts the selector cursor on the icons (the others dimmed with OBJ blending) and prints the text;
// START slides in the person's pic (in colour, or a silhouette) with the spinning Poké Ball and prints their name
// (or, with all six texts, their quote). B / CANCEL / SELECT (from the field only) fade out to the saved callback.
// Tables: tools/extract_fame_checker.py (fameChecker.json); text: data/text/fame_checker.inc (strings.json);
// graphics: graphics/fame_checker/ (gfx/).

import { K } from '../battle/constants';
import { bdata, state } from '../battle/env';
import {
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  CopyToBgTilemapBufferRect,
  CopyToBgTilemapBufferRect_ChangePalette,
  FillBgTilemapBufferRect,
  GetBgX,
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
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT2_BD,
  BLDCNT_TGT2_BG0,
  BLDCNT_TGT2_BG1,
  BLDCNT_TGT2_BG2,
  BLDCNT_TGT2_BG3,
  BLDCNT_TGT2_OBJ,
  DISPCNT_BG_ALL_ON,
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
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
  SetGpuReg,
  vram,
} from '../gba/hw';
import {
  ListMenu_ProcessInput,
  ListMenuGetScrollAndRow,
  ListMenuGetYCoordForPrintingArrowCursor,
  ListMenuInit,
  DestroyListMenuTask,
  type ListMenu,
  type ListMenuItem,
  type ListMenuTemplate,
} from '../gba/listMenu';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_UP, gMain, JOY_NEW, SELECT_BUTTON, SetMainCallback2, SetVBlankCallback, START_BUTTON, type MainCallback } from '../gba/main';
import {
  AddTextPrinterParameterized2,
  DrawDialogueFrame,
  GetTextSpeedSetting,
  GetTextWindowPalette,
  LoadStdWindowFrameGfx,
  TEXT_COLOR_DARK_GRAY,
  TEXT_COLOR_LIGHT_GRAY,
  TEXT_COLOR_WHITE,
} from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import {
  AFFINEANIMCMD_FRAME,
  AFFINEANIMCMD_JUMP,
  ANIMCMD_END,
  ANIMCMD_FRAME,
  ANIMCMD_JUMP,
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  CreateSpriteAtEnd,
  DestroySprite,
  FreeAllSpritePalettes,
  FreeSpriteOamMatrix,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadSpritePalette,
  LoadSpriteSheet,
  MAX_SPRITES,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SetReservedSpritePaletteCount,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  ST_OAM_AFFINE_NORMAL,
  ST_OAM_OBJ_BLEND,
  ST_OAM_OBJ_NORMAL,
  TAG_NONE,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, FindTaskIdByFunc, gTasks, ResetTasks, RunTasks, TASK_NONE, type TaskFunc } from '../gba/task';
import {
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
  IsTextPrinterActive,
  PIXEL_FILL,
  PutWindowTilemap,
  RemoveWindow,
  RunTextPrinters,
  type WindowTemplate,
} from '../gba/window';
import { FCPICKSTATE_COLORED, FCPICKSTATE_NO_DRAW, FCPICKSTATE_SILHOUETTE, fameCheckerData } from '../state/fameChecker';
import { FONT_NORMAL, FONT_SMALL } from '../text/Font';
import { encodeRaw, setStringVar4, gStringVar1, gStringVar4, StringExpandPlaceholders, text } from './common';
import { CB2_BagMenuFromStartMenu } from './itemMenu';
import { AddScrollIndicatorArrowPair, RemoveScrollIndicatorArrowPair, SCROLL_ARROW_DOWN, SCROLL_ARROW_UP } from './menuIndicators';
import { CopyObjectGraphicsInfoToSpriteTemplate, GetObjectEventGraphicsInfo, objectEventGfxSymbols } from './objectEventGraphics';
import { CreateTrainerPicSprite, FreeAndDestroyTrainerPicSprite, ResetAllPicSprites } from './picSprites';

const SPRITETAG_SELECTOR_CURSOR = 1000;
const SPRITETAG_QUESTION_MARK = 1001;
const SPRITETAG_SPINNING_POKEBALL = 1002;
const SPRITETAG_SCROLL_INDICATORS = 1004;
const SPRITETAG_DAISY = 1006;
const SPRITETAG_FUJI = 1007;
const SPRITETAG_OAK = 1008;
const SPRITETAG_BILL = 1009;

// include/fame_checker.h
const FCWINDOWID_LIST = 0;
const FCWINDOWID_UIHELP = 1;
const FCWINDOWID_MSGBOX = 2;
const FCWINDOWID_ICONDESC = 3;

const PERSON_PAL_NUM = 6;
const PERSON_X = 148;
const PERSON_Y = 66;

/** struct FameCheckerData */
interface FameCheckerScreen {
  savedCallback: MainCallback;
  listMenuTopIdx: number;
  scrollIndicatorPairTaskId: number;
  personHasUnlockedPanels: boolean;
  inPickMode: boolean;
  numUnlockedPersons: number;
  listMenuTaskId: number;
  listMenuCurIdx: number;
  listMenuTopIdx2: number;
  listMenuDrawnSelIdx: number;
  unlockedPersons: number[];
  spriteIds: number[];
  viewingFlavorText: boolean;
  pickModeOverCancel: boolean;
}

let sFameCheckerData: FameCheckerScreen | undefined;
let sBg3TilemapBuffer: Uint16Array | undefined;
let sBg1TilemapBuffer: Uint16Array | undefined;
let sBg2TilemapBuffer: Uint16Array | undefined;
let sListMenuItems: ListMenuItem[] = [];
let sLastMenuIdx = 0;
/** gIconDescriptionBoxIsOpen */
let gIconDescriptionBoxIsOpen = 0;
/** For the probe: the last string printed in the message box (FCWINDOWID_MSGBOX), as printed. */
let sLastMessage: number[] = [];

const d = (): FameCheckerScreen => sFameCheckerData!;

const sTextColor_White = [0, 1, 2];
const sTextColor_DkGrey = [0, 2, 3];
const sTextColor_Green = [0, 6, 7];

const PERSON_NAMES = ['ProfOak', 'Daisy', 'Brock', 'Misty', 'LtSurge', 'Erika', 'Koga', 'Sabrina', 'Blaine', 'Lorelei', 'Bruno', 'Agatha', 'Lance', 'Bill', 'MrFuji', 'Giovanni'];
/** sNonTrainerNamePointers */
const sNonTrainerNames = ['gFameCheckerOakName', 'gFameCheckerDaisyName', 'gFameCheckerBillName', 'gFameCheckerMrFujiName'];
/** sFameCheckerNameAndQuotesPointers: names [0, 16), quotes [16, 32) */
const sFameCheckerNameAndQuotes = (i: number): string =>
  i < PERSON_NAMES.length ? `gFameCheckerPersonName_${PERSON_NAMES[i]}` : `gFameCheckerPersonQuote_${PERSON_NAMES[i - PERSON_NAMES.length]}`;
/** sFameCheckerFlavorTextPointers / sFlavorTextOriginLocationTexts / sFlavorTextOriginObjectNameTexts[person * 6 + i] */
const sFameCheckerFlavorText = (idx: number): string => `gFameCheckerFlavorText_${PERSON_NAMES[Math.floor(idx / 6)]}${idx % 6}`;
const sFlavorTextOriginLocation = (idx: number): string => `gFameCheckerFlavorTextOriginLocation_${PERSON_NAMES[Math.floor(idx / 6)]}${idx % 6}`;
const sFlavorTextOriginObjectName = (idx: number): string => `gFameCheckerFlavorTextOriginObjectName_${PERSON_NAMES[Math.floor(idx / 6)]}${idx % 6}`;

/** sUISpriteSheets */
const sUISpriteSheets: [string, number, number][] = [
  ['sSelectorCursorSpriteGfx', 0x400, SPRITETAG_SELECTOR_CURSOR],
  ['sQuestionMarkSpriteGfx', 0x100, SPRITETAG_QUESTION_MARK],
  ['sSpinningPokeballSpriteGfx', 0x1e0, SPRITETAG_SPINNING_POKEBALL],
  ['sDaisySpriteGfx', 0x800, SPRITETAG_DAISY],
  ['sFujiSpriteGfx', 0x800, SPRITETAG_FUJI],
  ['sOakSpriteGfx', 0x800, SPRITETAG_OAK],
  ['sBillSpriteGfx', 0x800, SPRITETAG_BILL],
];
/** sUISpritePalettes */
const sUISpritePalettes: [string, number][] = [
  ['sSelectorCursorSpritePalette', SPRITETAG_SELECTOR_CURSOR],
  ['sSpinningPokeballSpritePalette', SPRITETAG_SPINNING_POKEBALL],
];

const sUIBgTemplates: BgTemplate[] = [
  { bg: 3, charBaseIndex: 3, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0 },
  { bg: 2, charBaseIndex: 3, mapBaseIndex: 27, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0 },
  { bg: 1, charBaseIndex: 3, mapBaseIndex: 28, screenSize: 1, paletteMode: 0, priority: 0, baseTile: 0 },
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0 },
];

const sUIWindowTemplates: WindowTemplate[] = [
  { bg: 0, tilemapLeft: 1, tilemapTop: 3, width: 8, height: 10, paletteNum: 15, baseBlock: 20 },
  { bg: 0, tilemapLeft: 6, tilemapTop: 0, width: 24, height: 2, paletteNum: 15, baseBlock: 20 + 8 * 10 },
  { bg: 0, tilemapLeft: 2, tilemapTop: 15, width: 26, height: 4, paletteNum: 15, baseBlock: 20 + 8 * 10 + 24 * 2 },
  { bg: 0, tilemapLeft: 15, tilemapTop: 10, width: 11, height: 4, paletteNum: 15, baseBlock: 20 + 8 * 10 + 24 * 2 + 26 * 4 },
  DUMMY_WIN_TEMPLATE,
];

const sSpriteTemplate_SelectorCursor: SpriteTemplate = {
  tileTag: SPRITETAG_SELECTOR_CURSOR,
  paletteTag: SPRITETAG_SELECTOR_CURSOR,
  oam: oam({ shape: SPRITE_SHAPE['32x32'][0], size: SPRITE_SHAPE['32x32'][1], priority: 2 }),
  anims: [[ANIMCMD_FRAME(0, 15), ANIMCMD_FRAME(16, 15), ANIMCMD_JUMP(0)]],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

const sQuestionMarkTileSpriteTemplate: SpriteTemplate = {
  tileTag: SPRITETAG_QUESTION_MARK,
  paletteTag: TAG_NONE,
  oam: oam({ shape: SPRITE_SHAPE['16x32'][0], size: SPRITE_SHAPE['16x32'][1], priority: 2 }),
  anims: [[ANIMCMD_FRAME(0, 10), ANIMCMD_END]],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

const sSpinningPokeballSpriteTemplate = (): SpriteTemplate => ({
  tileTag: SPRITETAG_SPINNING_POKEBALL,
  paletteTag: SPRITETAG_SPINNING_POKEBALL,
  oam: oam({ affineMode: ST_OAM_AFFINE_NORMAL, shape: SPRITE_SHAPE['32x32'][0], size: SPRITE_SHAPE['32x32'][1] }),
  anims: [[ANIMCMD_FRAME(0, 10), ANIMCMD_END]],
  images: null,
  affineAnims: [[AFFINEANIMCMD_FRAME(0, 0, 4, 20), AFFINEANIMCMD_JUMP(0)]],
  callback: SpriteCB_FCSpinningPokeball,
});

/** sDaisySpriteTemplate / sFujiSpriteTemplate / sOakSpriteTemplate / sBillSpriteTemplate */
const sDaisyFujiOakBillSpriteTemplate = (tileTag: number): SpriteTemplate => ({
  tileTag,
  paletteTag: TAG_NONE,
  oam: oam({ shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1] }),
  anims: [[ANIMCMD_FRAME(0, 15), ANIMCMD_END]],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
});

/** The graphics the screen draws, to preload: its own, the trainer pics, the flavor texts' object events. */
export function fameCheckerGfxSymbols(): string[] {
  const data = fameCheckerData();
  const syms = new Set<string>([
    'gFameCheckerBgPals',
    'gFameCheckerBgTiles',
    'gFameCheckerBg3Tilemap',
    'gFameCheckerBg2Tilemap',
    'sFameCheckerTilemap',
    'sSilhouettePalette',
    'sDaisySpritePalette',
    'sFujiSpritePalette',
    'sOakSpritePalette',
    'sBillSpritePalette',
    ...sUISpriteSheets.map(([s]) => s),
    ...sUISpritePalettes.map(([s]) => s),
    ...objectEventGfxSymbols(new Set(data.npcGraphicsIds)),
  ]);
  for (const s of data.objectPalettes0) if (s) syms.add(s);
  for (const pic of data.trainerPicIdxs) {
    syms.add(bdata.anims.trainerFrontPics[pic]!.pic);
    syms.add(bdata.anims.trainerFrontPalettes[pic]!);
  }
  return [...syms];
}

function FC_VBlankCallback(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function MainCB2_FameCheckerMain(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

/** UseFameChecker */
export function UseFameChecker(savedCallback: MainCallback): void {
  SetVBlankCallback(null);
  sFameCheckerData = {
    savedCallback,
    listMenuTopIdx: 0,
    scrollIndicatorPairTaskId: 0,
    personHasUnlockedPanels: false,
    inPickMode: false,
    numUnlockedPersons: 0,
    listMenuTaskId: 0,
    listMenuCurIdx: 0,
    listMenuTopIdx2: 0,
    listMenuDrawnSelIdx: 0,
    unlockedPersons: new Array<number>(PERSON_NAMES.length + 1).fill(0),
    spriteIds: new Array<number>(6).fill(0),
    viewingFlavorText: false,
    pickModeOverCancel: false,
  };
  sLastMessage = [];
  PlaySE(K.SE_M_SWIFT);
  SetMainCallback2(MainCB2_LoadFameChecker);
}

function MainCB2_LoadFameChecker(): void {
  switch (gMain.state) {
    case 0:
      SetVBlankCallback(null);
      FCSetup_ClearVideoRegisters();
      gMain.state++;
      break;
    case 1:
      FCSetup_ResetTasksAndSpriteResources();
      gMain.state++;
      break;
    case 2:
      sBg3TilemapBuffer = new Uint16Array(0x400); // BG_SCREEN_SIZE: 256x256
      sBg1TilemapBuffer = new Uint16Array(0x800); // 512x256
      sBg2TilemapBuffer = new Uint16Array(0x400);
      ResetBgsAndClearDma3BusyFlags(false);
      InitBgsFromTemplates(0, sUIBgTemplates, sUIBgTemplates.length);
      SetBgTilemapBuffer(3, sBg3TilemapBuffer);
      SetBgTilemapBuffer(2, sBg2TilemapBuffer);
      SetBgTilemapBuffer(1, sBg1TilemapBuffer);
      FCSetup_ResetBGCoords();
      gMain.state++;
      break;
    case 3: {
      const tiles = gfx('gFameCheckerBgTiles');
      LoadBgTiles(3, tiles, tiles.length, 0);
      CopyToBgTilemapBufferRect(3, gfx16('gFameCheckerBg3Tilemap'), 0, 0, 32, 32);
      const pals = gfx16('gFameCheckerBgPals');
      LoadPalette(pals.subarray(0, 32), BG_PLTT_ID(0), 2 * PLTT_SIZE_4BPP);
      LoadPalette(pals.subarray(16, 32), BG_PLTT_ID(1), PLTT_SIZE_4BPP);
      CopyToBgTilemapBufferRect(2, gfx16('gFameCheckerBg2Tilemap'), 0, 0, 32, 32);
      CopyToBgTilemapBufferRect_ChangePalette(1, gfx16('sFameCheckerTilemap'), 30, 0, 32, 32, 0x11);
      LoadPalette(GetTextWindowPalette(2), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
      gMain.state++;
      break;
    }
    case 4:
      if (IsDma3ManagerBusyWithBgCopy() !== true) {
        ShowBg(0);
        ShowBg(1);
        ShowBg(2);
        ShowBg(3);
        CopyBgTilemapBufferToVram(3);
        CopyBgTilemapBufferToVram(2);
        CopyBgTilemapBufferToVram(1);
        gMain.state++;
      }
      break;
    case 5:
      InitWindows(sUIWindowTemplates);
      DeactivateAllTextPrinters();
      Setup_DrawMsgAndListBoxes();
      sListMenuItems = [];
      FC_CreateListMenu();
      gMain.state++;
      break;
    case 6:
      LoadUISpriteSheetsAndPalettes();
      CreateAllFlavorTextIcons(K.FAMECHECKER_OAK);
      WipeMsgBoxAndTransfer();
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, 0);
      gMain.state++;
      break;
    case 7:
      FCSetup_TurnOnDisplay();
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG0 | BLDCNT_TGT2_BG1 | BLDCNT_TGT2_BG2 | BLDCNT_TGT2_BG3 | BLDCNT_TGT2_OBJ | BLDCNT_TGT2_BD);
      SetGpuReg(REG_OFFSET_BLDALPHA, 0x07);
      SetGpuReg(REG_OFFSET_BLDY, 0x08);
      SetVBlankCallback(FC_VBlankCallback);
      d().listMenuTopIdx = 0;
      FC_CreateScrollIndicatorArrowPair();
      UpdateInfoBoxTilemap(1, 4);
      CreateTask(Task_WaitFadeOnInit, 0x08);
      SetMainCallback2(MainCB2_FameCheckerMain);
      gMain.state = 0;
      break;
  }
}

function LoadUISpriteSheetsAndPalettes(): void {
  for (const [sym, size, tag] of sUISpriteSheets) LoadSpriteSheet({ data: gfx(sym), size, tag });
  for (const [sym, tag] of sUISpritePalettes) LoadSpritePalette({ data: gfx16(sym), tag });
}

function Task_WaitFadeOnInit(taskId: number): void {
  if (!gPaletteFade.active) gTasks[taskId].func = Task_TopMenuHandleInput;
}

function Task_TopMenuHandleInput(taskId: number): void {
  const task = gTasks[taskId];
  const data = task.data;
  const fc = d();
  if (FindTaskIdByFunc(Task_FCOpenOrCloseInfoBox) !== TASK_NONE) return;
  RunTextPrinters();
  if (JOY_NEW(SELECT_BUTTON) && !fc.inPickMode && fc.savedCallback !== CB2_BagMenuFromStartMenu) {
    task.func = Task_StartToCloseFameChecker;
  } else if (JOY_NEW(START_BUTTON)) {
    const cursorPos = FameCheckerGetCursorY();
    if (TryExitPickMode(taskId)) {
      PlaySE(K.SE_M_LOCK_ON);
    } else if (cursorPos !== fc.numUnlockedPersons - 1) {
      // anything but CANCEL
      PlaySE(K.SE_M_LOCK_ON);
      FillWindowPixelRect(FCWINDOWID_ICONDESC, PIXEL_FILL(0), 0, 0, 88, 32);
      FC_PutWindowTilemapAndCopyWindowToVramMode3(FCWINDOWID_ICONDESC);
      UpdateInfoBoxTilemap(2, 4);
      UpdateInfoBoxTilemap(1, 5);
      PrintUIHelp(1);
      data[2] = CreatePersonPicSprite(fc.unlockedPersons[cursorPos]);
      gSprites[data[2]].x2 = 0xf0;
      gSprites[data[2]].data[0] = 1;
      data[3] = CreateSpinningPokeballSprite();
      gSprites[data[3]].x2 = 0xf0;
      gSprites[data[3]].data[0] = 1;
      task.func = Task_EnterPickMode;
    }
  } else if (JOY_NEW(A_BUTTON)) {
    const cursorPos = ListMenu_ProcessInput(fc.listMenuTaskId);
    if (cursorPos === fc.numUnlockedPersons - 1) {
      // CANCEL
      task.func = Task_StartToCloseFameChecker;
    } else if (fc.inPickMode) {
      if (!IsTextPrinterActive(FCWINDOWID_MSGBOX) && HasUnlockedAllFlavorTextsForCurrentPerson()) GetPickModeText();
    } else if (fc.personHasUnlockedPanels) {
      PlaySE(K.SE_SELECT);
      data[0] = CreateFlavorTextIconSelectorCursorSprite(data[1]);
      for (let i = 0; i < 6; i++) if (i !== data[1]) SetMessageSelectorIconObjMode(fc.spriteIds[i], ST_OAM_OBJ_BLEND);
      gIconDescriptionBoxIsOpen = 0xff;
      PlaceListMenuCursor(false);
      PrintUIHelp(2);
      if (gSprites[fc.spriteIds[data[1]]].data[1] !== 0xff) {
        // not a ? tile
        PrintSelectedNameInBrightGreen(taskId);
        UpdateIconDescriptionBox(data[1]);
      }
      FreeListMenuSelectorArrowPairResources();
      task.func = Task_FlavorTextDisplayHandleInput;
    }
  } else if (JOY_NEW(B_BUTTON)) {
    if (!TryExitPickMode(taskId)) task.func = Task_StartToCloseFameChecker;
  } else {
    ListMenu_ProcessInput(fc.listMenuTaskId);
  }
}

function TryExitPickMode(taskId: number): boolean {
  const data = gTasks[taskId].data;
  const fc = d();
  if (fc.inPickMode) {
    gSprites[data[2]].data[0] = 2;
    gSprites[data[2]].x2 += 10;
    gSprites[data[3]].data[0] = 2;
    gSprites[data[3]].x2 += 10;
    WipeMsgBoxAndTransfer();
    gTasks[taskId].func = Task_ExitPickMode;
    MessageBoxPrintEmptyText();
    fc.pickModeOverCancel = false;
    return true;
  }
  return false;
}

function MessageBoxPrintEmptyText(): void {
  AddTextPrinterParameterized2(FCWINDOWID_MSGBOX, FONT_NORMAL, text('gFameCheckerText_ClearTextbox'), 0, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY);
  sLastMessage = [];
}

function Task_EnterPickMode(taskId: number): void {
  const data = gTasks[taskId].data;
  if (gSprites[data[2]].data[0] === 0) {
    GetPickModeText();
    d().inPickMode = true;
    gTasks[taskId].func = Task_TopMenuHandleInput;
  } else {
    ChangeBgX(1, 0xa00, 1);
  }
}

function Task_ExitPickMode(taskId: number): void {
  const data = gTasks[taskId].data;
  const fc = d();
  if (GetBgX(1) !== 0) ChangeBgX(1, 0xa00, 2);
  else ChangeBgX(1, 0x000, 0);
  if (gSprites[data[2]].data[0] === 0) {
    if (fc.personHasUnlockedPanels) PrintUIHelp(0);
    UpdateInfoBoxTilemap(1, 4);
    UpdateInfoBoxTilemap(2, 2);
    fc.inPickMode = false;
    DestroyPersonPicSprite(taskId, FameCheckerGetCursorY());
    gTasks[taskId].func = Task_TopMenuHandleInput;
    gSprites[data[3]].callback = SpriteCB_DestroySpinningPokeball;
  }
}

function Task_FlavorTextDisplayHandleInput(taskId: number): void {
  const task = gTasks[taskId];
  const data = task.data;
  const fc = d();
  RunTextPrinters();
  if (JOY_NEW(A_BUTTON) && !IsTextPrinterActive(FCWINDOWID_MSGBOX)) {
    const spriteId = fc.spriteIds[data[1]];
    if (gSprites[spriteId].data[1] !== 0xff) PrintSelectedNameInBrightGreen(taskId);
  }
  if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    for (let i = 0; i < 6; i++) SetMessageSelectorIconObjMode(fc.spriteIds[i], ST_OAM_OBJ_NORMAL);
    WipeMsgBoxAndTransfer();
    gSprites[data[0]].callback = SpriteCB_DestroyFlavorTextIconSelectorCursor;
    if (gIconDescriptionBoxIsOpen !== 0xff) UpdateIconDescriptionBoxOff();
    PlaceListMenuCursor(true);
    PrintUIHelp(0);
    FC_CreateScrollIndicatorArrowPair();
    MessageBoxPrintEmptyText();
    task.func = Task_TopMenuHandleInput;
  } else if (JOY_NEW(DPAD_UP) || JOY_NEW(DPAD_DOWN)) {
    if (data[1] >= 3) {
      data[1] -= 3;
      FC_MoveSelectorCursor(taskId, 0, -0x1b);
    } else {
      data[1] += 3;
      FC_MoveSelectorCursor(taskId, 0, +0x1b);
    }
  } else if (JOY_NEW(DPAD_LEFT)) {
    if (data[1] === 0 || data[1] % 3 === 0) {
      data[1] += 2;
      FC_MoveSelectorCursor(taskId, +0x5e, 0);
    } else {
      data[1]--;
      FC_MoveSelectorCursor(taskId, -0x2f, 0);
    }
  } else if (JOY_NEW(DPAD_RIGHT)) {
    if ((data[1] + 1) % 3 === 0) {
      data[1] -= 2;
      FC_MoveSelectorCursor(taskId, -0x5e, 0);
    } else {
      data[1]++;
      FC_MoveSelectorCursor(taskId, +0x2f, 0);
    }
  }
}

function FC_MoveSelectorCursor(taskId: number, dx: number, dy: number): void {
  const data = gTasks[taskId].data;
  const fc = d();
  PlaySE(K.SE_M_SWAGGER2);
  gSprites[data[0]].x += dx;
  gSprites[data[0]].y += dy;
  for (let i = 0; i < 6; i++) SetMessageSelectorIconObjMode(fc.spriteIds[i], ST_OAM_OBJ_BLEND);
  FillWindowPixelRect(FCWINDOWID_MSGBOX, PIXEL_FILL(1), 0, 0, 0xd0, 0x20);
  MessageBoxPrintEmptyText();
  if (SetMessageSelectorIconObjMode(fc.spriteIds[data[1]], ST_OAM_OBJ_NORMAL)) {
    PrintSelectedNameInBrightGreen(taskId);
    UpdateIconDescriptionBox(data[1]);
  } else if (gIconDescriptionBoxIsOpen !== 0xff) {
    UpdateIconDescriptionBoxOff();
  }
}

function GetPickModeText(): void {
  let whichText = 0;
  const fc = d();
  const who = FameCheckerGetCursorY();
  if (state.fameChecker[fc.unlockedPersons[who]].pickState !== FCPICKSTATE_COLORED) {
    WipeMsgBoxAndTransfer();
    MessageBoxPrintEmptyText();
  } else {
    FillWindowPixelRect(FCWINDOWID_MSGBOX, PIXEL_FILL(1), 0, 0, 0xd0, 0x20);
    if (HasUnlockedAllFlavorTextsForCurrentPerson()) whichText = PERSON_NAMES.length;
    PrintMessage(StringExpandPlaceholders(text(sFameCheckerNameAndQuotes(fc.unlockedPersons[who] + whichText))));
  }
}

/** StringExpandPlaceholders(gStringVar4, str) + AddTextPrinterParameterized2 into the message box at the text speed */
function PrintMessage(str: number[]): void {
  setStringVar4(str);
  sLastMessage = gStringVar4;
  AddTextPrinterParameterized2(FCWINDOWID_MSGBOX, FONT_NORMAL, gStringVar4, GetTextSpeedSetting(), TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY);
  FC_PutWindowTilemapAndCopyWindowToVramMode3(FCWINDOWID_MSGBOX);
}

function PrintSelectedNameInBrightGreen(taskId: number): void {
  const data = gTasks[taskId].data;
  const cursorPos = FameCheckerGetCursorY();
  FillWindowPixelRect(FCWINDOWID_MSGBOX, PIXEL_FILL(1), 0, 0, 0xd0, 0x20);
  PrintMessage(StringExpandPlaceholders(text(sFameCheckerFlavorText(d().unlockedPersons[cursorPos] * 6 + data[1]))));
}

function WipeMsgBoxAndTransfer(): void {
  FillWindowPixelRect(FCWINDOWID_MSGBOX, PIXEL_FILL(1), 0, 0, 0xd0, 0x20);
  FC_PutWindowTilemapAndCopyWindowToVramMode3(FCWINDOWID_MSGBOX);
}

function Setup_DrawMsgAndListBoxes(): void {
  LoadStdWindowFrameGfx();
  DrawDialogueFrame(FCWINDOWID_MSGBOX, true);
  FC_PutWindowTilemapAndCopyWindowToVramMode3(FCWINDOWID_MSGBOX);
  FC_PutWindowTilemapAndCopyWindowToVramMode3(FCWINDOWID_LIST);
}

function FC_PutWindowTilemapAndCopyWindowToVramMode3(windowId: number): void {
  PutWindowTilemap(windowId);
  CopyWindowToVram(windowId, COPYWIN_FULL);
}

function SetMessageSelectorIconObjMode(spriteId: number, objMode: number): boolean {
  if (gSprites[spriteId].data[1] !== 0xff) {
    gSprites[spriteId].oam.objMode = objMode;
    return true;
  }
  return false;
}

function Task_StartToCloseFameChecker(taskId: number): void {
  PlaySE(K.SE_M_SWIFT);
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, 0);
  gTasks[taskId].func = Task_DestroyAssetsAndCloseFameChecker;
}

function Task_DestroyAssetsAndCloseFameChecker(taskId: number): void {
  if (gPaletteFade.active) return;
  const fc = d();
  if (fc.inPickMode) {
    DestroyPersonPicSprite(taskId, FameCheckerGetCursorY());
    FreeSpriteOamMatrix(gSprites[gTasks[taskId].data[3]]);
    DestroySprite(gSprites[gTasks[taskId].data[3]]);
  }
  for (let i = 0; i < 6; i++) DestroySprite(gSprites[fc.spriteIds[i]]);
  FreeNonTrainerPicTiles();
  FreeSpinningPokeballSpriteResources();
  FreeSelectionCursorSpriteResources();
  FreeQuestionMarkSpriteResources();
  FreeListMenuSelectorArrowPairResources();
  SetMainCallback2(fc.savedCallback);
  DestroyListMenuTask(fc.listMenuTaskId);
  sBg3TilemapBuffer = sBg1TilemapBuffer = sBg2TilemapBuffer = undefined;
  sFameCheckerData = undefined;
  sListMenuItems = [];
  FC_DestroyWindow(FCWINDOWID_LIST);
  FC_DestroyWindow(FCWINDOWID_UIHELP);
  FC_DestroyWindow(FCWINDOWID_MSGBOX);
  FC_DestroyWindow(FCWINDOWID_ICONDESC);
  FreeAllWindowBuffers();
  DestroyTask(taskId);
}

function FC_DestroyWindow(windowId: number): void {
  FillWindowPixelBuffer(windowId, 0);
  ClearWindowTilemap(windowId);
  CopyWindowToVram(windowId, COPYWIN_GFX);
  RemoveWindow(windowId);
}

/** HasTrainerBeenFought */
function HasTrainerBeenFought(trainerId: number): boolean {
  return state.getFlag(K.TRAINER_FLAGS_START + trainerId);
}

/** AdjustGiovanniIndexIfBeatenInGym: once the Viridian Gym's Giovanni is beaten, he moves up after BLAINE. */
function AdjustGiovanniIndexIfBeatenInGym(a0: number): number {
  if (HasTrainerBeenFought(K.TRAINER_LEADER_GIOVANNI)) {
    if (a0 === 9) return K.FAMECHECKER_GIOVANNI;
    if (a0 > 9) return a0 - 1;
  }
  return a0;
}

function PrintUIHelp(uiState: number): void {
  let src = text('gFameCheckerText_MainScreenUI');
  if (uiState !== 0) src = text(uiState === 1 ? 'gFameCheckerText_PickScreenUI' : 'gFameCheckerText_FlavorTextUI');
  const width = GetStringWidth(FONT_SMALL, src, 0);
  FillWindowPixelRect(FCWINDOWID_UIHELP, PIXEL_FILL(0), 0, 0, 0xc0, 0x10);
  AddTextPrinterParameterized4(FCWINDOWID_UIHELP, FONT_SMALL, 188 - width, 0, 0, 2, sTextColor_White, -1, src);
  FC_PutWindowTilemapAndCopyWindowToVramMode3(FCWINDOWID_UIHELP);
}

function DestroyAllFlavorTextIcons(): void {
  for (let i = 0; i < 6; i++) DestroySprite(gSprites[d().spriteIds[i]]);
}

function CreateAllFlavorTextIcons(who: number): boolean {
  let result = false;
  const fc = d();
  const person = fc.unlockedPersons[who];
  for (let i = 0; i < 6; i++) {
    if ((state.fameChecker[person].flavorTextFlags >> i) & 1) {
      fc.spriteIds[i] = CreateFameCheckerObject(fameCheckerData().npcGraphicsIds[person * 6 + i], i, 47 * (i % 3) + 0x72, 27 * Math.floor(i / 3) + 0x2f);
      result = true;
    } else {
      fc.spriteIds[i] = PlaceQuestionMarkTile(47 * (i % 3) + 0x72, 27 * Math.floor(i / 3) + 0x1f);
      gSprites[fc.spriteIds[i]].data[1] = 0xff;
    }
  }
  if (result) {
    fc.personHasUnlockedPanels = true;
    PrintUIHelp(fc.inPickMode ? 1 : 0);
  } else {
    fc.personHasUnlockedPanels = false;
    PrintUIHelp(1);
  }
  return result;
}

/**
 * CreateFameCheckerObject (event_object_movement.c): the object event's sprite facing south, its palette the one
 * InitObjectEventPalettes put in its paletteSlot.
 */
function CreateFameCheckerObject(graphicsId: string, localId: number, x: number, y: number): number {
  const info = GetObjectEventGraphicsInfo(graphicsId);
  const template = CopyObjectGraphicsInfoToSpriteTemplate(graphicsId, SpriteCallbackDummy);
  template.paletteTag = TAG_NONE;
  const spriteId = CreateSpriteAtEnd(template, x, y, 0);
  if (spriteId !== MAX_SPRITES) {
    const sprite = gSprites[spriteId];
    sprite.centerToCornerVecY = -(info.frameHeight >> 1);
    sprite.y += sprite.centerToCornerVecY;
    sprite.oam.paletteNum = info.gba.paletteSlot;
    sprite.data[0] = localId;
    // PALSLOT_NPC_SPECIAL (LoadSpecialObjectReflectionPalette): none of the Fame Checker's objects use it
    // StartSpriteAnim(sprite, GetFaceDirectionAnimNum(DIR_SOUTH)): anim 0, already running
  }
  return spriteId;
}

/** InitObjectEventPalettes(0): FreeAndReserveObjectSpritePalettes, then sObjectPaletteTags0's palettes into OBJ slots 0-9. */
function InitObjectEventPalettes(): void {
  FreeAllSpritePalettes();
  SetReservedSpritePaletteCount(12);
  fameCheckerData().objectPalettes0.forEach((sym, slot) => {
    if (sym) LoadPalette(gfx16(sym), OBJ_PLTT_ID(slot), PLTT_SIZE_4BPP);
  });
}

function FCSetup_ClearVideoRegisters(): void {
  vram.fill(0);
  pltt.fill(0); // OAM: ResetSpriteData's
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
  ])
    SetGpuReg(reg, 0);
}

function FCSetup_ResetTasksAndSpriteResources(): void {
  ScanlineEffect_Stop();
  ResetTasks();
  ResetSpriteData();
  ResetAllPicSprites();
  ResetPaletteFade();
  InitObjectEventPalettes();
  SetReservedSpritePaletteCount(7);
}

function FCSetup_TurnOnDisplay(): void {
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG_ALL_ON | DISPCNT_OBJ_ON);
}

function FCSetup_ResetBGCoords(): void {
  for (let bg = 0; bg < 4; bg++) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }
}

function HasUnlockedAllFlavorTextsForCurrentPerson(): boolean {
  const who = d().unlockedPersons[FameCheckerGetCursorY()];
  for (let i = 0; i < 6; i++) if (!((state.fameChecker[who].flavorTextFlags >> i) & 1)) return false;
  return true;
}

function FreeSelectionCursorSpriteResources(): void {
  FreeSpriteTilesByTag(SPRITETAG_SELECTOR_CURSOR);
  FreeSpritePaletteByTag(SPRITETAG_SELECTOR_CURSOR);
}

function CreateFlavorTextIconSelectorCursorSprite(where: number): number {
  const y = 34 + 27 * (where >= 3 ? 1 : 0);
  const x = 114 + 47 * (where % 3);
  return CreateSprite(sSpriteTemplate_SelectorCursor, x, y, 0);
}

function SpriteCB_DestroyFlavorTextIconSelectorCursor(sprite: Sprite): void {
  DestroySprite(sprite);
}

function FreeQuestionMarkSpriteResources(): void {
  FreeSpriteTilesByTag(SPRITETAG_QUESTION_MARK);
}

function PlaceQuestionMarkTile(x: number, y: number): number {
  const spriteId = CreateSprite(sQuestionMarkTileSpriteTemplate, x, y, 8);
  gSprites[spriteId].oam.priority = 2;
  gSprites[spriteId].oam.paletteNum = 2;
  return spriteId;
}

function FreeSpinningPokeballSpriteResources(): void {
  FreeSpriteTilesByTag(SPRITETAG_SPINNING_POKEBALL);
  FreeSpritePaletteByTag(SPRITETAG_SPINNING_POKEBALL);
}

function CreateSpinningPokeballSprite(): number {
  return CreateSprite(sSpinningPokeballSpriteTemplate(), 0xe2, 0x42, 0);
}

function SpriteCB_DestroySpinningPokeball(sprite: Sprite): void {
  FreeSpriteOamMatrix(sprite);
  DestroySprite(sprite);
}

function FreeNonTrainerPicTiles(): void {
  FreeSpriteTilesByTag(SPRITETAG_DAISY);
  FreeSpriteTilesByTag(SPRITETAG_FUJI);
  FreeSpriteTilesByTag(SPRITETAG_OAK);
  FreeSpriteTilesByTag(SPRITETAG_BILL);
}

/** SpriteCB_FCSpinningPokeball: data[0] 1 slides in from x2 = 240 by 10 px a frame, 2 slides back out. */
function SpriteCB_FCSpinningPokeball(sprite: Sprite): void {
  if (sprite.data[0] === 1) {
    if (sprite.x2 - 10 < 0) {
      sprite.x2 = 0;
      sprite.data[0] = 0;
    } else {
      sprite.x2 -= 10;
    }
  } else if (sprite.data[0] === 2) {
    if (sprite.x2 > 240) {
      sprite.x2 = 240;
      sprite.data[0] = 0;
    } else {
      sprite.x2 += 10;
    }
  }
}

/** The non-trainers' own pics (Daisy, Fuji, Oak, Bill), by FAMECHECKER_*: [tile tag, palette symbol] */
function nonTrainerPic(fcPersonIdx: number): [number, string] | undefined {
  if (fcPersonIdx === K.FAMECHECKER_DAISY) return [SPRITETAG_DAISY, 'sDaisySpritePalette'];
  if (fcPersonIdx === K.FAMECHECKER_MRFUJI) return [SPRITETAG_FUJI, 'sFujiSpritePalette'];
  if (fcPersonIdx === K.FAMECHECKER_OAK) return [SPRITETAG_OAK, 'sOakSpritePalette'];
  if (fcPersonIdx === K.FAMECHECKER_BILL) return [SPRITETAG_BILL, 'sBillSpritePalette'];
  return undefined;
}

function CreatePersonPicSprite(fcPersonIdx: number): number {
  let spriteId: number;
  const own = nonTrainerPic(fcPersonIdx);
  if (own) {
    spriteId = CreateSprite(sDaisyFujiOakBillSpriteTemplate(own[0]), PERSON_X, PERSON_Y, 0);
    LoadPalette(gfx16(own[1]), OBJ_PLTT_ID(PERSON_PAL_NUM), PLTT_SIZE_4BPP);
    gSprites[spriteId].oam.paletteNum = PERSON_PAL_NUM;
  } else {
    spriteId = CreateTrainerPicSprite(fameCheckerData().trainerPicIdxs[fcPersonIdx], true, PERSON_X, PERSON_Y, PERSON_PAL_NUM, TAG_NONE);
  }
  gSprites[spriteId].callback = SpriteCB_FCSpinningPokeball;
  if (state.fameChecker[fcPersonIdx].pickState === FCPICKSTATE_SILHOUETTE) LoadPalette(gfx16('sSilhouettePalette'), OBJ_PLTT_ID(PERSON_PAL_NUM), PLTT_SIZE_4BPP);
  return spriteId;
}

function DestroyPersonPicSprite(taskId: number, who: number): void {
  const data = gTasks[taskId].data;
  const fc = d();
  let whoCopy = who;
  if (who === fc.numUnlockedPersons - 1) whoCopy = who - 1;
  if (nonTrainerPic(fc.unlockedPersons[whoCopy])) DestroySprite(gSprites[data[2]]);
  else FreeAndDestroyTrainerPicSprite(data[2]);
}

function UpdateIconDescriptionBox(whichText: number): void {
  const idx = 6 * d().unlockedPersons[FameCheckerGetCursorY()] + whichText;
  HandleFlavorTextModeSwitch(true);
  gIconDescriptionBoxIsOpen = 1;
  FillWindowPixelRect(FCWINDOWID_ICONDESC, PIXEL_FILL(0), 0, 0, 0x58, 0x20);
  const location = text(sFlavorTextOriginLocation(idx));
  let width = Math.trunc((0x54 - GetStringWidth(FONT_SMALL, location, 0)) / 2);
  AddTextPrinterParameterized4(FCWINDOWID_ICONDESC, FONT_SMALL, width, 0, 0, 2, sTextColor_DkGrey, -1, location);
  gStringVar1.set(StringExpandPlaceholders(text(sFlavorTextOriginObjectName(idx))));
  const objectName = [...gStringVar1.get(), 0xff];
  width = Math.trunc((0x54 - GetStringWidth(FONT_SMALL, objectName, 0)) / 2);
  AddTextPrinterParameterized4(FCWINDOWID_ICONDESC, FONT_SMALL, width, 10, 0, 2, sTextColor_DkGrey, -1, objectName);
  FC_PutWindowTilemapAndCopyWindowToVramMode3(FCWINDOWID_ICONDESC);
}

function UpdateIconDescriptionBoxOff(): void {
  HandleFlavorTextModeSwitch(false);
  gIconDescriptionBoxIsOpen = 0xff;
}

/** gFameChecker_ListMenuTemplate (InitListMenuTemplate) */
let gFameChecker_ListMenuTemplate: ListMenuTemplate;

function FC_CreateListMenu(): void {
  InitListMenuTemplate();
  const fc = d();
  fc.numUnlockedPersons = FC_PopulateListMenu();
  fc.listMenuTaskId = ListMenuInit(gFameChecker_ListMenuTemplate, 0, 0);
  FC_PutWindowTilemapAndCopyWindowToVramMode3_2(FCWINDOWID_LIST);
}

function InitListMenuTemplate(): void {
  gFameChecker_ListMenuTemplate = {
    items: sListMenuItems,
    moveCursorFunc: FC_MoveCursorFunc,
    itemPrintFunc: null,
    totalItems: 1,
    maxShowed: 1,
    windowId: FCWINDOWID_LIST,
    header_X: 0,
    item_X: 8,
    cursor_X: 0,
    upText_Y: 4,
    cursorPal: 2,
    fillValue: 0,
    cursorShadowPal: 3,
    lettersSpacing: 0,
    itemVerticalPadding: 0,
    scrollMultiple: 0,
    fontId: FONT_NORMAL,
    cursorKind: 0,
  };
}

function FC_MoveCursorFunc(itemIndex: number, onInit: boolean, _list: ListMenu): void {
  const fc = d();
  sLastMenuIdx = 0;
  const personIdx = fc.listMenuTopIdx2 + fc.listMenuDrawnSelIdx;
  FC_DoMoveCursor(itemIndex, onInit);
  const taskId = FindTaskIdByFunc(Task_TopMenuHandleInput);
  if (taskId === TASK_NONE) return;
  const task = gTasks[taskId];
  PlaySE(K.SE_SELECT);
  task.data[1] = 0;
  fc.listMenuTopIdx = ListMenuGetScrollAndRow(fc.listMenuTaskId).cursorPos;
  if (itemIndex !== fc.numUnlockedPersons - 1) {
    DestroyAllFlavorTextIcons();
    CreateAllFlavorTextIcons(itemIndex);
    if (fc.inPickMode) {
      if (!fc.pickModeOverCancel) {
        DestroyPersonPicSprite(taskId, personIdx);
        sLastMenuIdx = itemIndex;
        task.func = Task_SwitchToPickMode;
      } else {
        gSprites[task.data[2]].invisible = false;
        fc.pickModeOverCancel = false;
        gSprites[task.data[2]].data[0] = 0;
        GetPickModeText();
      }
    } else {
      FillWindowPixelRect(FCWINDOWID_MSGBOX, PIXEL_FILL(1), 0, 0, 0xd0, 0x20);
      FC_PutWindowTilemapAndCopyWindowToVramMode3(FCWINDOWID_MSGBOX);
      sLastMessage = [];
    }
  } else {
    PrintCancelDescription();
    if (fc.inPickMode) {
      gSprites[task.data[2]].invisible = true;
      fc.pickModeOverCancel = true;
    } else {
      for (let i = 0; i < 6; i++) gSprites[fc.spriteIds[i]].invisible = true;
    }
  }
}

function Task_SwitchToPickMode(taskId: number): void {
  const task = gTasks[taskId];
  task.data[2] = CreatePersonPicSprite(d().unlockedPersons[sLastMenuIdx]);
  gSprites[task.data[2]].data[0] = 0;
  GetPickModeText();
  task.func = Task_TopMenuHandleInput;
}

function PrintCancelDescription(): void {
  FillWindowPixelRect(FCWINDOWID_MSGBOX, PIXEL_FILL(1), 0, 0, 0xd0, 0x20);
  sLastMessage = text('gFameCheckerText_FameCheckerWillBeClosed');
  AddTextPrinterParameterized2(FCWINDOWID_MSGBOX, FONT_NORMAL, sLastMessage, 0, TEXT_COLOR_DARK_GRAY, TEXT_COLOR_WHITE, TEXT_COLOR_LIGHT_GRAY);
  FC_PutWindowTilemapAndCopyWindowToVramMode3(FCWINDOWID_MSGBOX);
}

function FC_DoMoveCursor(itemIndex: number, onInit: boolean): void {
  const fc = d();
  const { cursorPos: listY, itemsAbove: cursorY } = ListMenuGetScrollAndRow(fc.listMenuTaskId);
  const who = listY + cursorY;
  AddTextPrinterParameterized4(FCWINDOWID_LIST, FONT_NORMAL, 8, 14 * cursorY + 4, 0, 0, sTextColor_Green, 0, sListMenuItems[itemIndex].label);
  if (!onInit) {
    if (listY < fc.listMenuTopIdx2) fc.listMenuDrawnSelIdx++;
    else if (listY > fc.listMenuTopIdx2 && who !== fc.numUnlockedPersons - 1) fc.listMenuDrawnSelIdx--;
    AddTextPrinterParameterized4(FCWINDOWID_LIST, FONT_NORMAL, 8, 14 * fc.listMenuDrawnSelIdx + 4, 0, 0, sTextColor_DkGrey, 0, sListMenuItems[fc.listMenuCurIdx].label);
  }
  fc.listMenuCurIdx = itemIndex;
  fc.listMenuDrawnSelIdx = cursorY;
  fc.listMenuTopIdx2 = listY;
}

function FC_PopulateListMenu(): number {
  const fc = d();
  const data = fameCheckerData();
  let nitems = 0;
  for (let i = 0; i < PERSON_NAMES.length; i++) {
    const fameCheckerIdx = AdjustGiovanniIndexIfBeatenInGym(i);
    if (state.fameChecker[fameCheckerIdx].pickState !== FCPICKSTATE_NO_DRAW) {
      const trainerIdx = data.trainerIdxs[fameCheckerIdx];
      const label =
        trainerIdx < data.nonTrainerStart ? encodeRaw(bdata.tables.trainers[trainerIdx]!.trainerName) : text(sNonTrainerNames[trainerIdx - data.nonTrainerStart]);
      sListMenuItems[nitems] = { label, index: nitems };
      fc.unlockedPersons[nitems] = fameCheckerIdx;
      nitems++;
    }
  }
  sListMenuItems[nitems] = { label: text('gFameCheckerText_Cancel'), index: nitems };
  fc.unlockedPersons[nitems] = 0xff;
  nitems++;
  sListMenuItems.length = nitems;
  gFameChecker_ListMenuTemplate.items = sListMenuItems;
  gFameChecker_ListMenuTemplate.totalItems = nitems;
  gFameChecker_ListMenuTemplate.maxShowed = nitems < 5 ? nitems : 5;
  return nitems;
}

function FC_PutWindowTilemapAndCopyWindowToVramMode3_2(windowId: number): void {
  PutWindowTilemap(windowId);
  CopyWindowToVram(windowId, COPYWIN_FULL);
}

function FC_CreateScrollIndicatorArrowPair(): void {
  const fc = d();
  if (fc.numUnlockedPersons > 5) {
    fc.scrollIndicatorPairTaskId = AddScrollIndicatorArrowPair(
      {
        firstArrowType: SCROLL_ARROW_UP,
        firstX: 40,
        firstY: 26,
        secondArrowType: SCROLL_ARROW_DOWN,
        secondX: 40,
        secondY: 100,
        fullyUpThreshold: 0,
        fullyDownThreshold: fc.numUnlockedPersons - 5,
        tileTag: SPRITETAG_SCROLL_INDICATORS,
        palTag: TAG_NONE,
        palNum: 1,
      },
      () => sFameCheckerData?.listMenuTopIdx ?? 0,
    );
  }
}

function FreeListMenuSelectorArrowPairResources(): void {
  if (d().numUnlockedPersons > 5) RemoveScrollIndicatorArrowPair(d().scrollIndicatorPairTaskId);
}

function FameCheckerGetCursorY(): number {
  const { cursorPos, itemsAbove } = ListMenuGetScrollAndRow(d().listMenuTaskId);
  return cursorPos + itemsAbove;
}

function HandleFlavorTextModeSwitch(on: boolean): void {
  const fc = d();
  if (fc.viewingFlavorText !== on) {
    let taskId = FindTaskIdByFunc(Task_FCOpenOrCloseInfoBox);
    if (taskId === TASK_NONE) taskId = CreateTask(Task_FCOpenOrCloseInfoBox, 8);
    gTasks[taskId].data[0] = 0;
    gTasks[taskId].data[1] = 4;
    if (on) {
      gTasks[taskId].data[2] = 1;
      fc.viewingFlavorText = true;
    } else {
      gTasks[taskId].data[2] = 4;
      fc.viewingFlavorText = false;
    }
  }
}

function Task_FCOpenOrCloseInfoBox(taskId: number): void {
  const task = gTasks[taskId];
  switch (task.data[0]) {
    case 0:
      if (--task.data[1] === 0) {
        UpdateInfoBoxTilemap(1, 0);
        task.data[1] = 4;
        task.data[0]++;
      }
      break;
    case 1:
      if (--task.data[1] === 0) {
        UpdateInfoBoxTilemap(1, task.data[2]);
        DestroyTask(taskId);
      }
      break;
  }
}

/** UpdateInfoBoxTilemap: the info box's frame on BG1 (0/3 half open, 1 open, 2 the pick panel's, 4 closed, 5 none) */
function UpdateInfoBoxTilemap(bg: number, boxState: number): void {
  const rows: [number, number, number, number, number][] = [];
  if (boxState === 0 || boxState === 3) {
    rows.push([0x8c, 14, 10, 1, 1], [0xa1, 15, 10, 10, 1], [0x8d, 25, 10, 1, 1], [0x8e, 26, 10, 1, 1], [0x8f, 14, 11, 1, 1], [0x00, 15, 11, 11, 1]);
    rows.push([0x90, 26, 11, 1, 1], [0x91, 14, 12, 1, 1], [0xa3, 15, 12, 10, 1], [0x92, 25, 12, 1, 1], [0x93, 26, 12, 1, 1]);
  } else if (boxState === 1) {
    rows.push([0x9b, 14, 10, 1, 1], [0x9c, 15, 10, 11, 1], [0x96, 26, 10, 1, 1], [0x9d, 14, 11, 1, 1], [0x00, 15, 11, 11, 1]);
    rows.push([0x90, 26, 11, 1, 1], [0x9e, 14, 12, 1, 1], [0x9f, 15, 12, 11, 1], [0x99, 26, 12, 1, 1]);
  } else if (boxState === 2) {
    rows.push([0x94, 14, 10, 1, 1], [0x95, 15, 10, 11, 1], [0x96, 26, 10, 1, 1], [0x8f, 14, 11, 1, 1], [0x9a, 15, 11, 11, 1]);
    rows.push([0x90, 26, 11, 1, 1], [0x97, 14, 12, 1, 1], [0x98, 15, 12, 11, 1], [0x99, 26, 12, 1, 1]);
  } else if (boxState === 4) {
    rows.push([0x83, 14, 10, 1, 1], [0xa0, 15, 10, 10, 1], [0x84, 25, 10, 1, 1], [0x85, 26, 10, 1, 1], [0x86, 14, 11, 1, 1], [0xa2, 15, 11, 10, 1]);
    rows.push([0x87, 25, 11, 1, 1], [0x88, 26, 11, 1, 1], [0x83, 14, 12, 1, 1], [0xa0, 15, 12, 10, 1], [0x84, 25, 12, 1, 1], [0x85, 26, 12, 1, 1]);
  } else if (boxState === 5) {
    rows.push([0x00, 14, 10, 13, 3]);
  }
  for (const [tile, x, y, w, h] of rows) FillBgTilemapBufferRect(bg, tile, x, y, w, h, 1);
  CopyBgTilemapBufferToVram(bg);
}

function PlaceListMenuCursor(isActive: boolean): void {
  const cursorY = ListMenuGetYCoordForPrintingArrowCursor(d().listMenuTaskId);
  AddTextPrinterParameterized4(FCWINDOWID_LIST, FONT_NORMAL, 0, cursorY, 0, 0, isActive ? sTextColor_DkGrey : sTextColor_White, 0, text('gText_SelectorArrow2'));
}

/**
 * Dev: the screen's state for the e2e tests: the input task, the list (decoded labels, the cursor, the persons by
 * FAMECHECKER_*), the six icons (an OBJ_EVENT_GFX_* name or "?"; dimmed = OBJ blending; hidden over CANCEL), the
 * person's pic in pick mode (silhouette or colour, slid in), the selector cursor's slot, the message box's last
 * string (testHooks decodes the strings) and whether its printer is still running.
 */
export function fameCheckerProbe():
  | {
      task: string | undefined;
      list: number[][];
      cursor: number;
      persons: number[];
      inPickMode: boolean;
      icons: { kind: string; dimmed: boolean; hidden: boolean }[];
      pic: { silhouette: boolean; x2: number; hidden: boolean } | undefined;
      selector: number | undefined;
      message: number[];
      printing: boolean;
      bg1X: number;
    }
  | undefined {
  const fc = sFameCheckerData;
  if (!fc || gMain.callback2 !== MainCB2_FameCheckerMain) return undefined;
  const taskId = gTasks.findIndex((t) => t.isActive && [Task_WaitFadeOnInit, Task_TopMenuHandleInput, Task_EnterPickMode, Task_ExitPickMode, Task_FlavorTextDisplayHandleInput, Task_SwitchToPickMode, Task_StartToCloseFameChecker, Task_DestroyAssetsAndCloseFameChecker].includes(t.func as TaskFunc));
  const task = taskId >= 0 ? gTasks[taskId] : undefined;
  const cursor = FameCheckerGetCursorY();
  const person = fc.unlockedPersons[cursor];
  const npcIds = fameCheckerData().npcGraphicsIds;
  const icons = fc.spriteIds.map((id, i) => {
    const s = gSprites[id];
    const unlocked = s.data[1] !== 0xff;
    return { kind: unlocked && person !== 0xff ? npcIds[person * 6 + i] : '?', dimmed: s.oam.objMode === ST_OAM_OBJ_BLEND, hidden: s.invisible };
  });
  const picSprite = fc.inPickMode || task?.func === Task_EnterPickMode ? gSprites[task!.data[2]] : undefined;
  return {
    task: task?.func.name,
    list: sListMenuItems.map((it) => it.label),
    cursor,
    persons: fc.unlockedPersons.slice(0, fc.numUnlockedPersons),
    inPickMode: fc.inPickMode,
    icons,
    pic: picSprite && { silhouette: state.fameChecker[fc.unlockedPersons[Math.min(cursor, fc.numUnlockedPersons - 2)]].pickState === FCPICKSTATE_SILHOUETTE, x2: picSprite.x2, hidden: picSprite.invisible },
    selector: task?.func === Task_FlavorTextDisplayHandleInput ? task.data[1] : undefined,
    message: sLastMessage,
    printing: IsTextPrinterActive(FCWINDOWID_MSGBOX),
    bg1X: GetBgX(1),
  };
}
