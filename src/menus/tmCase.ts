// tm_case.c: the TM case. A list of the TM case pocket's TMs and HMs (HMs first) with their numbers and move
// names, the selected move's description and info (type, power, accuracy, PP), the disc sprite rising out of the
// case, and what A does for each way in: from the bag (TMCASE_FIELD: USE / GIVE / EXIT), the party menu's GIVE
// (TMCASE_GIVE_PARTY), the PC box's GIVE (TMCASE_GIVE_PC), the Poké Mart's SELL (TMCASE_SELL: how many, YES/NO),
// and back from teaching a move (TMCASE_REOPENING). USE hands over to the party menu (ItemUseCB_TMHM), which comes
// back here through CB2_ReturnToTMCaseMenu. The Pokédude's Teachy TV demo (TMCASE_POKEDUDE, Pokedude_InitTMCase: his
// four TMs over the player's TM case and key items, scrolled by Task_Pokedude_Run, then back to Teachy TV). Not
// ported: the Union Room's GIVE / EXIT menu (no link play) and SEs.

import { K } from '../battle/constants';
import { gBattleMoves, state } from '../battle/env';
import { moveName } from '../battle/message';
import { InitBgsFromTemplates, LoadBgTiles, ResetBgsAndClearDma3BusyFlags, SetBgTilemapBuffer, ShowBg, GetBgTilemapBuffer, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import { DISPCNT_OBJ_1D_MAP, DISPCNT_OBJ_ON, REG_OFFSET_BLDCNT, REG_OFFSET_DISPCNT, RGB_BLACK, SetGpuReg } from '../gba/hw';
import {
  BlitMenuInfoIcon,
  DestroyListMenuTask,
  gMultiuseListMenuTemplate,
  LIST_CANCEL,
  LIST_NOTHING_CHOSEN,
  ListMenu_ProcessInput,
  ListMenuGetScrollAndRow,
  ListMenuGetYCoordForPrintingArrowCursor,
  ListMenuInit,
  ListMenuLoadStdPalAt,
  type ListMenu,
  type ListMenuItem,
} from '../gba/listMenu';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_UP, JOY_NEW, SELECT_BUTTON, SetMainCallback2, SetVBlankCallback, gMain, type MainCallback } from '../gba/main';
import {
  AddItemMenuActionTextPrinters,
  AdjustQuantityAccordingToDPadInput,
  ClearDialogWindowAndFrameToTransparent,
  ClearScheduledBgCopiesToVram,
  ClearStdWindowAndFrameToTransparent,
  CreateYesNoMenuWithCallbacks,
  DisplayMessageAndContinueTask,
  DoScheduledBgTilemapCopiesToVram,
  DrawStdFrameWithCustomTileAndPalette,
  GetMenuCursorDimensionByFont,
  GetTextSpeedSetting,
  LoadMenuMessageWindowGfx,
  LoadStdWindowGfx,
  LoadUserWindowGfx,
  Menu_InitCursor,
  Menu_ProcessInputNoWrapAround,
  ResetAllBgsCoordinatesAndBgCntRegs,
  ScheduleBgCopyTilemapToVram,
  SetBgTilemapPalette,
  SetVBlankHBlankCallbacksToNull,
  type MenuAction,
} from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, LoadPalette, OBJ_PLTT_OFFSET, PLTT_ID, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import {
  ANIMCMD_END,
  ANIMCMD_FRAME,
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  FreeAllSpritePalettes,
  gDummySpriteAffineAnimTable,
  gSprites,
  IndexOfSpritePaletteTag,
  LoadSpritePalette,
  LoadSpriteSheet,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SpriteCallbackDummy,
  StartSpriteAnim,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks, type TaskFunc } from '../gba/task';
import {
  AddTextPrinterParameterized3,
  AddTextPrinterParameterized4,
  AddWindow,
  BlitBitmapToWindow,
  ClearWindowTilemap,
  COPYWIN_GFX,
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FillWindowPixelRect,
  FONTATTR_MAX_LETTER_HEIGHT,
  FONTATTR_MAX_LETTER_WIDTH,
  FreeAllWindowBuffers,
  GetFontAttribute,
  GetStringWidth,
  InitWindows,
  IsTextPrinterActive,
  PutWindowTilemap,
  RemoveWindow,
  RunTextPrinters,
  TEXT_SKIP_DRAW,
  type WindowTemplate,
} from '../gba/window';
import type { ItemSlot } from '../state/Bag';
import {
  AddBagItem,
  BagGetItemIdByPocketPosition,
  BagGetQuantityByPocketPosition,
  BagPocketCompaction,
  bagPocket,
  CalculatePlayerPartyCount,
  concat,
  ConvertIntToDecimalStringN,
  CopyItemName,
  encodeRaw,
  ExpandToStringVar4,
  gStringVar1,
  gStringVar3,
  ItemId_GetDescription,
  ItemId_GetImportance,
  ItemId_GetPrice,
  RemoveBagItem,
  STR_CONV_MODE_LEADING_ZEROS,
  STR_CONV_MODE_LEFT_ALIGN,
  STR_CONV_MODE_RIGHT_ALIGN,
  strBody,
  text,
} from './common';
import { CB2_SetUpReshowBattleScreenAfterMenu, GetDialogBoxFontId } from './itemMenu';
import { SpecialVar } from './itemMenuState';
import { AddScrollIndicatorArrowPairParameterized, RemoveScrollIndicatorArrowPair } from './menuIndicators';
import { PrintMoneyAmount, PrintMoneyAmountInMoneyBox, PrintMoneyAmountInMoneyBoxWithBorder } from './money';
import { CB2_ChooseMonToGiveItem, CB2_GiveHoldItem, CB2_ShowPartyMenuForItemUse, ItemIdToBattleMoveId, ItemUseCB_TMHM, setItemUseCB } from './partyMenu';
import { CB2_ReturnToPokeStorage } from './pokemonStorage';
import { CB2_ReturnToTeachyTV, SetTeachyTvControllerModeToResume } from './teachyTv';
import { RecordItemTransaction } from './shopQuestLog';

// Values for InitTMCase's `type` (include/tm_case.h)
export const TMCASE_FIELD = 0;
export const TMCASE_GIVE_PARTY = 1;
export const TMCASE_SELL = 2;
export const TMCASE_GIVE_PC = 3;
export const TMCASE_POKEDUDE = 4;
export const TMCASE_REOPENING = 5;
/** TMCASE_KEEP_PREV: InitTMCase's allowSelectClose that keeps the previous value. */
export const TMCASE_KEEP_PREV = 0xff;

/** IS_HM: any item in the TM case with nonzero importance is an HM. */
const IS_HM = (itemId: number) => ItemId_GetImportance(itemId) !== 0;

const TAG_SCROLL_ARROW = 110;

const WIN_LIST = 0;
const WIN_DESCRIPTION = 1;
const WIN_SELECTED_MSG = 2;
const WIN_TITLE = 3;
const WIN_MOVE_INFO_LABELS = 4;
const WIN_MOVE_INFO = 5;
const WIN_MESSAGE = 6;
const WIN_SELL_QUANTITY = 7;
const WIN_MONEY = 8;

// The context menu's windows
const WIN_USE_GIVE_EXIT = 0;

const ACTION_USE = 0;
const ACTION_GIVE = 1;
const ACTION_EXIT = 2;

const COLOR_LIGHT = 0;
const COLOR_DARK = 1;
const COLOR_CURSOR_SELECTED = 2;
const COLOR_MOVE_INFO = 3;
const COLOR_CURSOR_ERASE = 0xff;

// The disc sprite's base position, and how far it travels in and out of the case
const DISC_BASE_X = 41;
const DISC_BASE_Y = 46;
const DISC_CASE_DISTANCE = 20;
const DISC_Y_MOVE = 10;
const TAG_DISC = 400;
const DISC_HIDDEN = 0xff;

const ANIM_TM = 0;
const ANIM_HM = 1;

/** sTMCaseStaticResources: kept across leaving the TM case (to the party menu, or closed). */
const sTMCaseStaticResources = {
  exitCallback: null as MainCallback | null,
  menuType: 0,
  allowSelectClose: false,
  selectedRow: 0,
  scrollOffset: 0,
};

/** sTMCaseDynamicResources: reset whenever the TM case is left. */
interface TMCaseDynamicResources {
  nextScreenCallback: MainCallback | null;
  discSpriteId: number;
  maxTMsShown: number;
  numTMs: number;
  contextMenuWindowId: number;
  scrollArrowsTaskId: number;
  currItem: number;
  menuActionIndices: number[];
  numMenuActions: number;
  seqId: number;
}

let sTMCaseDynamicResources: TMCaseDynamicResources | null = null;
/** The screen's task (the C passes its id around; the port keeps it for the test probe). */
let sMainTaskId = 0;
const D = () => sTMCaseDynamicResources!;

let sTilemapBuffer: Uint16Array | null = null;
let sListMenuItemsBuffer: ListMenuItem[] = [];
/** sTMSpritePaletteBuffer: the 17 types' disc palettes (16 colours each). */
let sTMSpritePaletteBuffer: Uint16Array | null = null;

const sBGTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0 },
  { bg: 1, charBaseIndex: 0, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 },
  { bg: 2, charBaseIndex: 0, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0 },
];

/** sSelectTMActionTasks: what A on a TM/HM does, by how the TM case was opened. */
function sSelectTMActionTasks(menuType: number): TaskFunc {
  switch (menuType) {
    case TMCASE_GIVE_PARTY:
      return Task_SelectedTMHM_GiveParty;
    case TMCASE_SELL:
      return Task_SelectedTMHM_Sell;
    case TMCASE_GIVE_PC:
      return Task_SelectedTMHM_GivePC;
    default:
      return Task_SelectedTMHM_Field;
  }
}

/** sMenuActions */
function sMenuActions(): MenuAction[] {
  return [
    { text: text('gOtherText_Use'), func: Action_Use },
    { text: text('gOtherText_Give'), func: Action_Give },
    { text: text('gOtherText_Exit'), func: Action_Exit },
  ];
}

const sMenuActionIndices_Field = [ACTION_USE, ACTION_GIVE, ACTION_EXIT];

const sYesNoFuncTable = { yesFunc: Task_PrintSaleConfirmedText, noFunc: Task_SaleOfTMsCanceled };

/** sPal3Override: colours 3 and 4 of the list's and the std window's palettes. */
const sPal3Override = [0x2108 /* RGB(8, 8, 8) */, (6 << 10) | (16 << 5) | 30 /* RGB(30, 16, 6) */];

/** sTextColors: [bg, fg, shadow] */
const sTextColors = [
  [0, 1, 2], // COLOR_LIGHT
  [0, 2, 3], // COLOR_DARK
  [0, 3, 6], // COLOR_CURSOR_SELECTED
  [0, 14, 10], // COLOR_MOVE_INFO
];

const sWindowTemplates: WindowTemplate[] = [
  { bg: 0, tilemapLeft: 10, tilemapTop: 1, width: 19, height: 10, paletteNum: 15, baseBlock: 0x081 }, // WIN_LIST
  { bg: 0, tilemapLeft: 12, tilemapTop: 12, width: 18, height: 8, paletteNum: 10, baseBlock: 0x13f }, // WIN_DESCRIPTION
  { bg: 1, tilemapLeft: 5, tilemapTop: 15, width: 15, height: 4, paletteNum: 13, baseBlock: 0x1f9 }, // WIN_SELECTED_MSG
  { bg: 0, tilemapLeft: 0, tilemapTop: 1, width: 10, height: 2, paletteNum: 15, baseBlock: 0x235 }, // WIN_TITLE
  { bg: 0, tilemapLeft: 1, tilemapTop: 13, width: 5, height: 6, paletteNum: 12, baseBlock: 0x249 }, // WIN_MOVE_INFO_LABELS
  { bg: 0, tilemapLeft: 7, tilemapTop: 13, width: 5, height: 6, paletteNum: 12, baseBlock: 0x267 }, // WIN_MOVE_INFO
  { bg: 1, tilemapLeft: 2, tilemapTop: 15, width: 26, height: 4, paletteNum: 11, baseBlock: 0x285 }, // WIN_MESSAGE
  { bg: 1, tilemapLeft: 17, tilemapTop: 9, width: 12, height: 4, paletteNum: 15, baseBlock: 0x2ed }, // WIN_SELL_QUANTITY
  { bg: 1, tilemapLeft: 1, tilemapTop: 1, width: 8, height: 3, paletteNum: 13, baseBlock: 0x31d }, // WIN_MONEY
  DUMMY_WIN_TEMPLATE,
];

const sYesNoWindowTemplate: WindowTemplate = { bg: 1, tilemapLeft: 21, tilemapTop: 9, width: 6, height: 4, paletteNum: 15, baseBlock: 0x335 };

const sWindowTemplates_ContextMenu: WindowTemplate[] = [
  { bg: 1, tilemapLeft: 22, tilemapTop: 13, width: 7, height: 6, paletteNum: 15, baseBlock: 0x1cf }, // WIN_USE_GIVE_EXIT
  { bg: 1, tilemapLeft: 22, tilemapTop: 15, width: 7, height: 4, paletteNum: 15, baseBlock: 0x1cf }, // WIN_GIVE_EXIT
];

/** sSpriteTemplate_Disc (sTMSpriteOamData: 32x32, priority 2; sAnims_Disc: TM = tile 0, HM = tile 16) */
const sSpriteTemplate_Disc: SpriteTemplate = {
  tileTag: TAG_DISC,
  paletteTag: TAG_DISC,
  oam: oam({ size: 2, priority: 2 }),
  anims: [
    [ANIMCMD_FRAME(0, 0), ANIMCMD_END],
    [ANIMCMD_FRAME(16, 0), ANIMCMD_END],
  ],
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCallbackDummy,
};

/** sTMSpritePaletteOffsetByType: where each type's disc palette starts (TYPE_MYSTERY has none: 0). */
function sTMSpritePaletteOffsetByType(type: number): number {
  const order = [
    K.TYPE_NORMAL, K.TYPE_FIRE, K.TYPE_WATER, K.TYPE_GRASS, K.TYPE_ELECTRIC, K.TYPE_ROCK, K.TYPE_GROUND, K.TYPE_ICE, K.TYPE_FLYING,
    K.TYPE_FIGHTING, K.TYPE_GHOST, K.TYPE_BUG, K.TYPE_POISON, K.TYPE_PSYCHIC, K.TYPE_STEEL, K.TYPE_DARK, K.TYPE_DRAGON,
  ];
  const i = order.indexOf(type);
  return i < 0 ? 0 : i * 16;
}

/** Every graphic the TM case loads (for preloading: the screen draws synchronously). */
export const TM_CASE_GFX = [
  'gTMCase_Gfx',
  'gTMCaseMenu_Tilemap',
  'gTMCase_Tilemap',
  'gTMCaseMenu_Male_Pal',
  'gTMCaseMenu_Female_Pal',
  'gTMCaseDisc_Gfx',
  'gTMCaseDiscTypes1_Pal',
  'gTMCaseDiscTypes2_Pal',
  'gTMCaseHM_Gfx',
  'gStandardMenuPalette',
];

const tmCasePocket = (): ItemSlot[] => bagPocket(K.POCKET_TM_CASE - 1);

/** InitTMCase: open the TM case (`type` TMCASE_*), returning to `exitCallback` (null: keep the previous one). */
export function InitTMCase(type: number, exitCallback: MainCallback | null, allowSelectClose: boolean | typeof TMCASE_KEEP_PREV): void {
  ResetBufferPointers_NoFree();
  sTMCaseDynamicResources = {
    nextScreenCallback: null,
    discSpriteId: 0,
    maxTMsShown: 0,
    numTMs: 0,
    contextMenuWindowId: 0xff, // WINDOW_NONE
    scrollArrowsTaskId: 0xff, // TASK_NONE
    currItem: 0,
    menuActionIndices: [],
    numMenuActions: 0,
    seqId: 0,
  };
  if (type !== TMCASE_REOPENING) sTMCaseStaticResources.menuType = type;
  if (exitCallback !== null) sTMCaseStaticResources.exitCallback = exitCallback;
  if (allowSelectClose !== TMCASE_KEEP_PREV) sTMCaseStaticResources.allowSelectClose = allowSelectClose;
  // gTextFlags.autoScroll = FALSE: the port's printers never auto-scroll here
  SetMainCallback2(CB2_SetUpTMCaseUI_Blocking);
}

function CB2_Idle(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  DoScheduledBgTilemapCopiesToVram();
  UpdatePaletteFade();
}

function VBlankCB_Idle(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function CB2_SetUpTMCaseUI_Blocking(): void {
  while (!DoSetUpTMCaseUI());
}

// Task data
const tListTaskId = 0;
const tSelection = 1;
const tQuantityOwned = 2;
const tQuantitySelected = 8;

function DoSetUpTMCaseUI(): boolean {
  switch (gMain.state) {
    case 0:
      SetVBlankHBlankCallbacksToNull();
      ClearScheduledBgCopiesToVram();
      gMain.state++;
      break;
    case 1:
      ScanlineEffect_Stop();
      gMain.state++;
      break;
    case 2:
      FreeAllSpritePalettes();
      gMain.state++;
      break;
    case 3:
      ResetPaletteFade();
      gMain.state++;
      break;
    case 4:
      ResetSpriteData();
      gMain.state++;
      break;
    case 5:
      ResetTasks();
      gMain.state++;
      break;
    case 6:
      LoadBGTemplates();
      D().seqId = 0;
      gMain.state++;
      break;
    case 7:
      InitWindowTemplatesAndPals();
      gMain.state++;
      break;
    case 8:
      if (HandleLoadTMCaseGraphicsAndPalettes()) gMain.state++;
      break;
    case 9:
      SortPocketAndPlaceHMsFirst(tmCasePocket());
      gMain.state++;
      break;
    case 10:
      TMCaseSetup_GetTMCount();
      TMCaseSetup_InitListMenuPositions();
      TMCaseSetup_UpdateVisualMenuOffset();
      gMain.state++;
      break;
    case 11:
      DrawMoveInfoLabels();
      gMain.state++;
      break;
    case 12:
      InitTMCaseListMenuItems(); // CreateTMCaseListMenuBuffers allocates the lists
      gMain.state++;
      break;
    case 13:
      PrintTitle();
      gMain.state++;
      break;
    case 14: {
      const taskId = sTMCaseStaticResources.menuType === TMCASE_POKEDUDE ? CreateTask(Task_Pokedude_Start, 0) : CreateTask(Task_HandleListInput, 0);
      sMainTaskId = taskId;
      gTasks[taskId].data[tListTaskId] = ListMenuInit(gMultiuseListMenuTemplate, sTMCaseStaticResources.scrollOffset, sTMCaseStaticResources.selectedRow);
      gMain.state++;
      break;
    }
    case 15:
      CreateListScrollArrows();
      gMain.state++;
      break;
    case 16:
      D().discSpriteId = CreateDiscSprite(BagGetItemIdByPocketPosition(K.POCKET_TM_CASE, sTMCaseStaticResources.scrollOffset + sTMCaseStaticResources.selectedRow));
      gMain.state++;
      break;
    case 17:
      BlendPalettes(0xffffffff, 16, 0);
      gMain.state++;
      break;
    case 18:
      BeginNormalPaletteFade(0xffffffff, 0, 16, 0, RGB_BLACK);
      gMain.state++;
      break;
    default:
      SetVBlankCallback(VBlankCB_Idle);
      SetMainCallback2(CB2_Idle);
      return true;
  }
  return false;
}

function ResetBufferPointers_NoFree(): void {
  sTMCaseDynamicResources = null;
  sTilemapBuffer = null;
  sListMenuItemsBuffer = [];
  sTMSpritePaletteBuffer = null;
}

function LoadBGTemplates(): void {
  ResetAllBgsCoordinatesAndBgCntRegs();
  sTilemapBuffer = new Uint16Array(0x400);
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBGTemplates, sBGTemplates.length);
  SetBgTilemapBuffer(2, sTilemapBuffer);
  ScheduleBgCopyTilemapToVram(1);
  ScheduleBgCopyTilemapToVram(2);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  ShowBg(0);
  ShowBg(1);
  ShowBg(2);
}

function HandleLoadTMCaseGraphicsAndPalettes(): boolean {
  const d = D();
  switch (d.seqId) {
    case 0: {
      const tiles = gfx('gTMCase_Gfx'); // DecompressAndCopyTileDataToVram
      LoadBgTiles(1, tiles, tiles.length, 0);
      d.seqId++;
      break;
    }
    case 1:
      sTilemapBuffer!.set(gfx16('gTMCaseMenu_Tilemap').subarray(0, 0x400));
      d.seqId++;
      break;
    case 2:
      GetBgTilemapBuffer(1)!.set(gfx16('gTMCase_Tilemap').subarray(0, 0x400));
      d.seqId++;
      break;
    case 3:
      LoadPalette(gfx16(state.playerGender === 'female' ? 'gTMCaseMenu_Female_Pal' : 'gTMCaseMenu_Male_Pal'), BG_PLTT_ID(0), 4 * PLTT_SIZE_4BPP);
      d.seqId++;
      break;
    case 4:
      LoadSpriteSheet({ data: gfx('gTMCaseDisc_Gfx'), size: 0x400, tag: TAG_DISC }); // sSpriteSheet_Disc
      d.seqId++;
      break;
    default:
      LoadDiscTypePalettes();
      d.seqId = 0;
      return true;
  }
  return false;
}

function InitTMCaseListMenuItems(): void {
  const d = D();
  const pocket = tmCasePocket();
  sListMenuItemsBuffer = [];
  for (let i = 0; i < d.numTMs; i++) sListMenuItemsBuffer.push({ label: GetTMNumberAndMoveString(pocket[i].itemId), index: i });
  sListMenuItemsBuffer.push({ label: text('gText_Close'), index: LIST_CANCEL });

  const t = gMultiuseListMenuTemplate;
  t.items = sListMenuItemsBuffer;
  t.totalItems = d.numTMs + 1; // +1 for Cancel
  t.windowId = WIN_LIST;
  t.header_X = 0;
  t.item_X = 8;
  t.cursor_X = 0;
  t.lettersSpacing = 0;
  t.itemVerticalPadding = 2;
  t.upText_Y = 2;
  t.maxShowed = d.maxTMsShown;
  t.fontId = K.FONT_NORMAL;
  t.cursorPal = 2;
  t.fillValue = 0;
  t.cursorShadowPal = 3;
  t.moveCursorFunc = List_MoveCursorFunc;
  t.itemPrintFunc = List_ItemPrintFunc;
  t.cursorKind = 0;
  t.scrollMultiple = 0;
}

/** GetTMNumberAndMoveString: "No01 MOVE", the number in the small font (an HM's one digit pushed right). */
function GetTMNumberAndMoveString(itemId: number): number[] {
  let num: number[];
  if (itemId >= K.ITEM_HM01) {
    num = concat(sText_ClearTo18(), text('gText_NumberClear01'), ConvertIntToDecimalStringN(itemId - K.ITEM_HM01 + 1, STR_CONV_MODE_LEADING_ZEROS, 1));
  } else {
    num = concat(text('gText_NumberClear01'), ConvertIntToDecimalStringN(itemId - K.ITEM_TM01 + 1, STR_CONV_MODE_LEADING_ZEROS, 2));
  }
  return concat(text('gText_FontSmall'), num, sText_SingleSpace(), text('gText_FontNormal'), moveName(ItemIdToBattleMoveId(itemId)));
}

/** sText_ClearTo18 / sText_SingleSpace (control codes and a space, tm_case.c's own strings) */
const sText_ClearTo18 = () => encodeRaw('{CLEAR_TO 18}');
const sText_SingleSpace = () => encodeRaw(' ');

function List_MoveCursorFunc(itemIndex: number, onInit: boolean, _list: ListMenu): void {
  const itemId = itemIndex === LIST_CANCEL ? K.ITEM_NONE : BagGetItemIdByPocketPosition(K.POCKET_TM_CASE, itemIndex);
  if (!onInit) {
    PlaySE(K.SE_SELECT);
    SwapDisc(D().discSpriteId, itemId);
  }
  PrintDescription(itemIndex);
  PrintMoveInfo(itemId);
}

function List_ItemPrintFunc(windowId: number, itemIndex: number, y: number): void {
  if (itemIndex !== LIST_CANCEL) {
    if (!IS_HM(BagGetItemIdByPocketPosition(K.POCKET_TM_CASE, itemIndex))) {
      gStringVar1.set(ConvertIntToDecimalStringN(BagGetQuantityByPocketPosition(K.POCKET_TM_CASE, itemIndex), STR_CONV_MODE_RIGHT_ALIGN, 3));
      TMCase_Print(windowId, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 126, y, 0, 0, TEXT_SKIP_DRAW, COLOR_DARK);
    } else {
      PlaceHMTileInWindow(windowId, 8, y);
    }
  }
}

function PrintDescription(itemIndex: number): void {
  const str = itemIndex !== LIST_CANCEL ? ItemId_GetDescription(BagGetItemIdByPocketPosition(K.POCKET_TM_CASE, itemIndex)) : text('gText_TMCaseWillBePutAway');
  FillWindowPixelBuffer(WIN_DESCRIPTION, 0);
  TMCase_Print(WIN_DESCRIPTION, K.FONT_NORMAL, str, 2, 3, 1, 0, 0, COLOR_LIGHT);
}

/** SetDescriptionWindowShade: darken (1) or lighten (0) the blue tiles around the description window. */
function SetDescriptionWindowShade(shade: number): void {
  SetBgTilemapPalette(2, 0, 12, 30, 8, 2 * shade + 1);
  ScheduleBgCopyTilemapToVram(2);
}

function PrintListCursor(listTaskId: number, colorIdx: number): void {
  PrintListCursorAtRow(ListMenuGetYCoordForPrintingArrowCursor(listTaskId), colorIdx);
}

function PrintListCursorAtRow(y: number, colorIdx: number): void {
  if (colorIdx === COLOR_CURSOR_ERASE) {
    // Never used. Would erase the cursor (and part of the list text)
    FillWindowPixelRect(WIN_LIST, 0, 0, y, GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_WIDTH), GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_HEIGHT));
    CopyWindowToVram(WIN_LIST, COPYWIN_GFX);
  } else {
    TMCase_Print(WIN_LIST, K.FONT_NORMAL, text('gText_SelectorArrow2'), 0, y, 0, 0, 0, colorIdx);
  }
}

function CreateListScrollArrows(): void {
  const d = D();
  d.scrollArrowsTaskId = AddScrollIndicatorArrowPairParameterized(K.SCROLL_ARROW_UP, 160, 8, 88, d.numTMs - d.maxTMsShown + 1, TAG_SCROLL_ARROW, TAG_SCROLL_ARROW, () => sTMCaseStaticResources.scrollOffset);
}

function CreateQuantityScrollArrows(): void {
  const d = D();
  d.currItem = 1;
  d.scrollArrowsTaskId = AddScrollIndicatorArrowPairParameterized(K.SCROLL_ARROW_UP, 152, 72, 104, 2, TAG_SCROLL_ARROW, TAG_SCROLL_ARROW, () => d.currItem);
}

function RemoveScrollArrows(): void {
  const d = D();
  if (d.scrollArrowsTaskId !== 0xff) {
    RemoveScrollIndicatorArrowPair(d.scrollArrowsTaskId);
    d.scrollArrowsTaskId = 0xff;
  }
}

/** ResetTMCaseCursorPos (new game) */
export function ResetTMCaseCursorPos(): void {
  sTMCaseStaticResources.selectedRow = 0;
  sTMCaseStaticResources.scrollOffset = 0;
}

function TMCaseSetup_GetTMCount(): void {
  const d = D();
  const pocket = tmCasePocket();
  BagPocketCompaction(pocket, pocket.length);
  d.numTMs = 0;
  for (let i = 0; i < pocket.length; i++) {
    if (pocket[i].itemId === K.ITEM_NONE) break;
    d.numTMs++;
  }
  d.maxTMsShown = Math.min(d.numTMs + 1, 5);
}

function TMCaseSetup_InitListMenuPositions(): void {
  const d = D();
  const s = sTMCaseStaticResources;
  if (s.scrollOffset !== 0 && s.scrollOffset + d.maxTMsShown > d.numTMs + 1) s.scrollOffset = d.numTMs + 1 - d.maxTMsShown;
  if (s.scrollOffset + s.selectedRow >= d.numTMs + 1) {
    if (d.numTMs + 1 < 2) s.selectedRow = 0;
    else s.selectedRow = d.numTMs;
  }
}

function TMCaseSetup_UpdateVisualMenuOffset(): void {
  const d = D();
  const s = sTMCaseStaticResources;
  if (s.selectedRow > 3) {
    for (let i = 0; i <= s.selectedRow - 3 && s.scrollOffset + d.maxTMsShown !== d.numTMs + 1; i++) {
      s.selectedRow--;
      s.scrollOffset++;
    }
  }
}

function DestroyTMCaseBuffers(): void {
  sTMCaseDynamicResources = null;
  sTilemapBuffer = null;
  sListMenuItemsBuffer = [];
  sTMSpritePaletteBuffer = null;
  FreeAllWindowBuffers();
}

function destroyList(taskId: number): void {
  const out = { cursorPos: 0, itemsAbove: 0 };
  DestroyListMenuTask(gTasks[taskId].data[tListTaskId], out);
  sTMCaseStaticResources.scrollOffset = out.cursorPos;
  sTMCaseStaticResources.selectedRow = out.itemsAbove;
}

function initList(taskId: number): void {
  gTasks[taskId].data[tListTaskId] = ListMenuInit(gMultiuseListMenuTemplate, sTMCaseStaticResources.scrollOffset, sTMCaseStaticResources.selectedRow);
}

function Task_BeginFadeOutFromTMCase(taskId: number): void {
  BeginNormalPaletteFade(0xffffffff, -2, 0, 16, RGB_BLACK);
  gTasks[taskId].func = Task_FadeOutAndCloseTMCase;
}

function Task_FadeOutAndCloseTMCase(taskId: number): void {
  if (!gPaletteFade.active) {
    destroyList(taskId);
    const d = D();
    if (d.nextScreenCallback !== null) SetMainCallback2(d.nextScreenCallback);
    else SetMainCallback2(sTMCaseStaticResources.exitCallback);
    RemoveScrollArrows();
    DestroyTMCaseBuffers();
    DestroyTask(taskId);
  }
}

function Task_HandleListInput(taskId: number): void {
  const data = gTasks[taskId].data;
  if (gPaletteFade.active) return;
  // IsActiveOverworldLinkBusy: no link play
  const input = ListMenu_ProcessInput(data[tListTaskId]);
  const sr = ListMenuGetScrollAndRow(data[tListTaskId]);
  sTMCaseStaticResources.scrollOffset = sr.cursorPos;
  sTMCaseStaticResources.selectedRow = sr.itemsAbove;
  if (JOY_NEW(SELECT_BUTTON) && sTMCaseStaticResources.allowSelectClose === true) {
    PlaySE(K.SE_SELECT);
    SpecialVar.ItemId = K.ITEM_NONE;
    Task_BeginFadeOutFromTMCase(taskId);
    return;
  }
  switch (input) {
    case LIST_NOTHING_CHOSEN:
      break;
    case LIST_CANCEL:
      PlaySE(K.SE_SELECT);
      SpecialVar.ItemId = K.ITEM_NONE;
      Task_BeginFadeOutFromTMCase(taskId);
      break;
    default:
      PlaySE(K.SE_SELECT);
      SetDescriptionWindowShade(1);
      RemoveScrollArrows();
      PrintListCursor(data[tListTaskId], COLOR_CURSOR_SELECTED);
      data[tSelection] = input;
      data[tQuantityOwned] = BagGetQuantityByPocketPosition(K.POCKET_TM_CASE, input);
      SpecialVar.ItemId = BagGetItemIdByPocketPosition(K.POCKET_TM_CASE, input);
      gTasks[taskId].func = sSelectTMActionTasks(sTMCaseStaticResources.menuType);
      break;
  }
}

function ReturnToList(taskId: number): void {
  SetDescriptionWindowShade(0);
  CreateListScrollArrows();
  gTasks[taskId].func = Task_HandleListInput;
}

/** Task_SelectedTMHM_Field: the USE / GIVE / EXIT menu, and "No01 MOVE is selected." beside it. */
function Task_SelectedTMHM_Field(taskId: number): void {
  const d = D();
  TMCase_SetWindowBorder2(WIN_SELECTED_MSG);
  // No link play or Union Room: always the regular menu (InUnionRoom's GIVE / EXIT never applies)
  AddContextMenu(WIN_USE_GIVE_EXIT);
  d.menuActionIndices = sMenuActionIndices_Field;
  d.numMenuActions = sMenuActionIndices_Field.length;

  const lineHeight = GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_HEIGHT) + 2;
  AddItemMenuActionTextPrinters(d.contextMenuWindowId, K.FONT_NORMAL, GetMenuCursorDimensionByFont(K.FONT_NORMAL, 0), 2, 0, lineHeight, d.numMenuActions, sMenuActions(), d.menuActionIndices);
  Menu_InitCursor(d.contextMenuWindowId, K.FONT_NORMAL, 0, 2, lineHeight, d.numMenuActions, 0);

  // gText_Var1IsSelected + 2 skips over the {STR_VAR_1}
  const str = [...strBody(GetTMNumberAndMoveString(SpecialVar.ItemId)), ...text('gText_Var1IsSelected').slice(2)];
  TMCase_Print(WIN_SELECTED_MSG, K.FONT_NORMAL, str, 0, 2, 1, 0, 0, COLOR_DARK);
  if (IS_HM(SpecialVar.ItemId)) {
    PlaceHMTileInWindow(WIN_SELECTED_MSG, 0, 2);
    CopyWindowToVram(WIN_SELECTED_MSG, COPYWIN_GFX);
  }
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(1);
  gTasks[taskId].func = Task_ContextMenu_HandleInput;
}

function Task_ContextMenu_HandleInput(taskId: number): void {
  const d = D();
  const input = Menu_ProcessInputNoWrapAround();
  switch (input) {
    case -1: // MENU_B_PRESSED: the last action in the list (EXIT)
      PlaySE(K.SE_SELECT);
      sMenuActions()[d.menuActionIndices[d.numMenuActions - 1]].func!(taskId);
      break;
    case -2: // MENU_NOTHING_CHOSEN
      break;
    default:
      PlaySE(K.SE_SELECT);
      sMenuActions()[d.menuActionIndices[input]].func!(taskId);
      break;
  }
}

function Action_Use(taskId: number): void {
  RemoveContextMenu();
  ClearStdWindowAndFrameToTransparent(WIN_SELECTED_MSG, false);
  ClearWindowTilemap(WIN_SELECTED_MSG);
  PutWindowTilemap(WIN_LIST);
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(1);
  if (CalculatePlayerPartyCount() === 0) {
    PrintError_ThereIsNoPokemon(taskId);
  } else {
    // Off to the party menu to teach it
    setItemUseCB(ItemUseCB_TMHM);
    D().nextScreenCallback = CB2_ShowPartyMenuForItemUse;
    Task_BeginFadeOutFromTMCase(taskId);
  }
}

function Action_Give(taskId: number): void {
  const data = gTasks[taskId].data;
  const itemId = BagGetItemIdByPocketPosition(K.POCKET_TM_CASE, data[tSelection]);
  RemoveContextMenu();
  ClearStdWindowAndFrameToTransparent(WIN_SELECTED_MSG, false);
  ClearWindowTilemap(WIN_SELECTED_MSG);
  PutWindowTilemap(WIN_DESCRIPTION);
  PutWindowTilemap(WIN_MOVE_INFO_LABELS);
  PutWindowTilemap(WIN_MOVE_INFO);
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(1);
  if (!IS_HM(itemId)) {
    if (CalculatePlayerPartyCount() === 0) {
      PrintError_ThereIsNoPokemon(taskId);
    } else {
      D().nextScreenCallback = CB2_ChooseMonToGiveItem;
      Task_BeginFadeOutFromTMCase(taskId);
    }
  } else {
    PrintError_ItemCantBeHeld(taskId);
  }
}

function PrintError_ThereIsNoPokemon(taskId: number): void {
  PrintMessageWithFollowupTask(taskId, K.FONT_NORMAL, text('gText_ThereIsNoPokemon'), Task_WaitButtonAfterErrorPrint);
}

function PrintError_ItemCantBeHeld(taskId: number): void {
  gStringVar1.set(CopyItemName(SpecialVar.ItemId));
  PrintMessageWithFollowupTask(taskId, K.FONT_NORMAL, ExpandToStringVar4(text('gText_ItemCantBeHeld')), Task_WaitButtonAfterErrorPrint);
}

function Task_WaitButtonAfterErrorPrint(taskId: number): void {
  if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    CloseMessageAndReturnToList(taskId);
  }
}

function CloseMessageAndReturnToList(taskId: number): void {
  const data = gTasks[taskId].data;
  destroyList(taskId);
  initList(taskId);
  PrintListCursor(data[tListTaskId], COLOR_DARK);
  ClearDialogWindowAndFrameToTransparent(WIN_MESSAGE, false);
  ClearWindowTilemap(WIN_MESSAGE);
  PutWindowTilemap(WIN_DESCRIPTION);
  PutWindowTilemap(WIN_MOVE_INFO_LABELS);
  PutWindowTilemap(WIN_MOVE_INFO);
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(1);
  ReturnToList(taskId);
}

function Action_Exit(taskId: number): void {
  const data = gTasks[taskId].data;
  RemoveContextMenu();
  ClearStdWindowAndFrameToTransparent(WIN_SELECTED_MSG, false);
  ClearWindowTilemap(WIN_SELECTED_MSG);
  PutWindowTilemap(WIN_LIST);
  PrintListCursor(data[tListTaskId], COLOR_DARK);
  PutWindowTilemap(WIN_DESCRIPTION);
  PutWindowTilemap(WIN_MOVE_INFO_LABELS);
  PutWindowTilemap(WIN_MOVE_INFO);
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(1);
  ReturnToList(taskId);
}

function Task_SelectedTMHM_GiveParty(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!IS_HM(BagGetItemIdByPocketPosition(K.POCKET_TM_CASE, data[tSelection]))) {
    D().nextScreenCallback = CB2_GiveHoldItem;
    Task_BeginFadeOutFromTMCase(taskId);
  } else {
    // Can't hold "important" items (e.g. key items)
    PrintError_ItemCantBeHeld(taskId);
  }
}

function Task_SelectedTMHM_GivePC(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!IS_HM(BagGetItemIdByPocketPosition(K.POCKET_TM_CASE, data[tSelection]))) {
    D().nextScreenCallback = CB2_ReturnToPokeStorage;
    Task_BeginFadeOutFromTMCase(taskId);
  } else {
    PrintError_ItemCantBeHeld(taskId);
  }
}

/** The sale price of `quantity` of the selected TM: half its price each. */
function salePrice(taskId: number, quantity: number): number {
  return Math.trunc(ItemId_GetPrice(BagGetItemIdByPocketPosition(K.POCKET_TM_CASE, gTasks[taskId].data[tSelection])) / 2) * quantity;
}

function Task_SelectedTMHM_Sell(taskId: number): void {
  const data = gTasks[taskId].data;
  if (ItemId_GetPrice(SpecialVar.ItemId) === 0) {
    // Can't sell TM/HMs with no price (by default just the HMs)
    gStringVar1.set(CopyItemName(SpecialVar.ItemId));
    PrintMessageWithFollowupTask(taskId, GetDialogBoxFontId(), ExpandToStringVar4(text('gText_OhNoICantBuyThat')), CloseMessageAndReturnToList);
  } else {
    data[tQuantitySelected] = 1;
    if (data[tQuantityOwned] === 1) {
      PrintPlayersMoney();
      Task_AskConfirmSaleWithAmount(taskId);
    } else {
      if (data[tQuantityOwned] > 99) data[tQuantityOwned] = 99;
      gStringVar1.set(CopyItemName(SpecialVar.ItemId));
      PrintMessageWithFollowupTask(taskId, GetDialogBoxFontId(), ExpandToStringVar4(text('gText_HowManyWouldYouLikeToSell')), Task_InitQuantitySelectUI);
    }
  }
}

function Task_AskConfirmSaleWithAmount(taskId: number): void {
  const data = gTasks[taskId].data;
  gStringVar3.set(ConvertIntToDecimalStringN(salePrice(taskId, data[tQuantitySelected]), STR_CONV_MODE_LEFT_ALIGN, 6));
  PrintMessageWithFollowupTask(taskId, GetDialogBoxFontId(), ExpandToStringVar4(text('gText_ICanPayThisMuch_WouldThatBeOkay')), Task_PlaceYesNoBox);
}

function Task_PlaceYesNoBox(taskId: number): void {
  HandleCreateYesNoMenu(taskId);
}

function Task_SaleOfTMsCanceled(taskId: number): void {
  const data = gTasks[taskId].data;
  ClearStdWindowAndFrameToTransparent(WIN_MONEY, false);
  ClearDialogWindowAndFrameToTransparent(WIN_MESSAGE, false);
  PutWindowTilemap(WIN_LIST);
  PutWindowTilemap(WIN_DESCRIPTION);
  PutWindowTilemap(WIN_TITLE);
  PutWindowTilemap(WIN_MOVE_INFO_LABELS);
  PutWindowTilemap(WIN_MOVE_INFO);
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(1);
  PrintListCursor(data[tListTaskId], COLOR_DARK);
  ReturnToList(taskId);
}

function Task_InitQuantitySelectUI(taskId: number): void {
  const data = gTasks[taskId].data;
  TMCase_SetWindowBorder1(WIN_SELL_QUANTITY);
  gStringVar1.set(ConvertIntToDecimalStringN(1, STR_CONV_MODE_LEADING_ZEROS, 2));
  TMCase_Print(WIN_SELL_QUANTITY, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 4, 10, 1, 0, 0, COLOR_DARK);
  SellTM_PrintQuantityAndSalePrice(1, salePrice(taskId, data[tQuantitySelected]));
  PrintPlayersMoney();
  CreateQuantityScrollArrows();
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(1);
  gTasks[taskId].func = Task_QuantitySelect_HandleInput;
}

function SellTM_PrintQuantityAndSalePrice(quantity: number, amount: number): void {
  FillWindowPixelBuffer(WIN_SELL_QUANTITY, 0x11);
  gStringVar1.set(ConvertIntToDecimalStringN(quantity, STR_CONV_MODE_LEADING_ZEROS, 2));
  TMCase_Print(WIN_SELL_QUANTITY, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 4, 10, 1, 0, 0, COLOR_DARK);
  PrintMoneyAmount(WIN_SELL_QUANTITY, 0x38, 0x0a, amount, 0);
}

function Task_QuantitySelect_HandleInput(taskId: number): void {
  const data = gTasks[taskId].data;
  if (AdjustQuantityAccordingToDPadInput(data, tQuantitySelected, data[tQuantityOwned])) {
    SellTM_PrintQuantityAndSalePrice(data[tQuantitySelected], salePrice(taskId, data[tQuantitySelected]));
  } else if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    ClearStdWindowAndFrameToTransparent(WIN_SELL_QUANTITY, false);
    ScheduleBgCopyTilemapToVram(0);
    ScheduleBgCopyTilemapToVram(1);
    RemoveScrollArrows();
    Task_AskConfirmSaleWithAmount(taskId);
  } else if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    ClearStdWindowAndFrameToTransparent(WIN_SELL_QUANTITY, false);
    ClearStdWindowAndFrameToTransparent(WIN_MONEY, false);
    ClearDialogWindowAndFrameToTransparent(WIN_MESSAGE, false);
    PutWindowTilemap(WIN_TITLE);
    PutWindowTilemap(WIN_LIST);
    PutWindowTilemap(WIN_DESCRIPTION);
    ScheduleBgCopyTilemapToVram(0);
    ScheduleBgCopyTilemapToVram(1);
    RemoveScrollArrows();
    PrintListCursor(data[tListTaskId], COLOR_DARK);
    ReturnToList(taskId);
  }
}

function Task_PrintSaleConfirmedText(taskId: number): void {
  const data = gTasks[taskId].data;
  PutWindowTilemap(WIN_LIST);
  ScheduleBgCopyTilemapToVram(0);
  gStringVar1.set(CopyItemName(SpecialVar.ItemId));
  gStringVar3.set(ConvertIntToDecimalStringN(salePrice(taskId, data[tQuantitySelected]), STR_CONV_MODE_LEFT_ALIGN, 6));
  PrintMessageWithFollowupTask(taskId, K.FONT_NORMAL, ExpandToStringVar4(text('gText_TurnedOverItemsWorthYen')), Task_DoSaleOfTMs);
}

function Task_DoSaleOfTMs(taskId: number): void {
  const data = gTasks[taskId].data;
  PlaySE(K.SE_SHOP);
  RemoveBagItem(SpecialVar.ItemId, data[tQuantitySelected]);
  state.addMoney(Math.trunc(ItemId_GetPrice(SpecialVar.ItemId) / 2) * data[tQuantitySelected]);
  RecordItemTransaction(SpecialVar.ItemId, data[tQuantitySelected], K.QL_EVENT_SOLD_ITEM - K.QL_EVENT_USED_POKEMART);
  destroyList(taskId);
  TMCaseSetup_GetTMCount();
  TMCaseSetup_InitListMenuPositions();
  InitTMCaseListMenuItems();
  initList(taskId);
  PrintListCursor(data[tListTaskId], COLOR_CURSOR_SELECTED);
  PrintMoneyAmountInMoneyBox(WIN_MONEY, state.money, 0);
  gTasks[taskId].func = Task_AfterSale_ReturnToList;
}

function Task_AfterSale_ReturnToList(taskId: number): void {
  if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    ClearStdWindowAndFrameToTransparent(WIN_MONEY, false);
    ClearDialogWindowAndFrameToTransparent(WIN_MESSAGE, false);
    PutWindowTilemap(WIN_DESCRIPTION);
    PutWindowTilemap(WIN_TITLE);
    PutWindowTilemap(WIN_MOVE_INFO_LABELS);
    PutWindowTilemap(WIN_MOVE_INFO);
    CloseMessageAndReturnToList(taskId);
  }
}

// Save the player's bag state while the Pokédude's TM case is shown
let sPokedudeBagBackup: { bagPocket_TMHM: ItemSlot[]; bagPocket_KeyItems: ItemSlot[]; selectedRow: number; scrollOffset: number } | null = null;

const copySlots = (slots: ItemSlot[]): ItemSlot[] => slots.map((s) => ({ ...s }));
const restoreSlots = (into: ItemSlot[], from: ItemSlot[]): void => from.forEach((s, i) => Object.assign(into[i], s));
/** ClearItemSlots */
const ClearItemSlots = (slots: ItemSlot[]): void => slots.forEach((s) => Object.assign(s, { itemId: K.ITEM_NONE, quantity: 0 }));

/**
 * Pokedude_InitTMCase: the bag's exit from Teachy TV's TMS demo (Task_Bag_TeachyTvTMs). The player's TM case and
 * key items are put aside for the Pokédude's four TMs, restored at the demo's end (Task_Pokedude_Run).
 */
export function Pokedude_InitTMCase(): void {
  const tmhm = tmCasePocket();
  const keyItems = bagPocket(K.POCKET_KEY_ITEMS - 1);
  sPokedudeBagBackup = {
    bagPocket_TMHM: copySlots(tmhm),
    bagPocket_KeyItems: copySlots(keyItems),
    selectedRow: sTMCaseStaticResources.selectedRow,
    scrollOffset: sTMCaseStaticResources.scrollOffset,
  };
  ClearItemSlots(tmhm);
  ClearItemSlots(keyItems);
  ResetTMCaseCursorPos();
  AddBagItem(K.ITEM_TM01, 1);
  AddBagItem(K.ITEM_TM03, 1);
  AddBagItem(K.ITEM_TM09, 1);
  AddBagItem(K.ITEM_TM35, 1);
  InitTMCase(TMCASE_POKEDUDE, CB2_ReturnToTeachyTV, false);
}

const tPokedudeState = 8; // Re-used
const tPokedudeTimer = 9;
const POKEDUDE_INPUT_DELAY = 101;

function Task_Pokedude_Start(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!gPaletteFade.active) {
    data[tPokedudeState] = 0;
    data[tPokedudeTimer] = 0;
    gTasks[taskId].func = Task_Pokedude_Run;
  }
}

/**
 * Task_Pokedude_Run: down three and up three, the TM types text, down three and up three again, the description
 * text, then back to Teachy TV. B quits at any step before the end (SetTeachyTvControllerModeToResume).
 */
function Task_Pokedude_Run(taskId: number): void {
  const data = gTasks[taskId].data;
  if (JOY_NEW(B_BUTTON)) {
    if (data[tPokedudeState] < 21) {
      data[tPokedudeState] = 21;
      SetTeachyTvControllerModeToResume();
    }
  }
  switch (data[tPokedudeState]) {
    case 0:
      BeginNormalPaletteFade(0xffff8405, 4, 0, 6, 0);
      SetDescriptionWindowShade(1);
      data[tPokedudeState]++;
      break;
    case 1:
    case 11:
      if (!gPaletteFade.active) {
        if (++data[tPokedudeTimer] > POKEDUDE_INPUT_DELAY) {
          data[tPokedudeTimer] = 0;
          data[tPokedudeState]++;
        }
      }
      break;
    case 2:
    case 3:
    case 4:
    case 12:
    case 13:
    case 14:
    case 5:
    case 6:
    case 7:
    case 15:
    case 16:
    case 17: {
      const st = data[tPokedudeState];
      if (data[tPokedudeTimer] === 0) {
        gMain.newKeys = 0;
        gMain.newAndRepeatedKeys = (st >= 2 && st <= 4) || (st >= 12 && st <= 14) ? DPAD_DOWN : DPAD_UP;
        ListMenu_ProcessInput(data[tListTaskId]);
      }
      if (++data[tPokedudeTimer] > POKEDUDE_INPUT_DELAY) {
        data[tPokedudeTimer] = 0;
        data[tPokedudeState]++;
      }
      break;
    }
    case 8:
      SetDescriptionWindowShade(1);
      PrintMessageWithFollowupTask(taskId, K.FONT_MALE, text('gPokedudeText_TMTypes'), null);
      gTasks[taskId].func = Task_Pokedude_Run;
      data[tPokedudeState]++;
      break;
    case 9:
    case 19:
      RunTextPrinters();
      if (!IsTextPrinterActive(WIN_MESSAGE)) data[tPokedudeState]++;
      break;
    case 10:
      if (JOY_NEW(A_BUTTON | B_BUTTON)) {
        SetDescriptionWindowShade(0);
        BeginNormalPaletteFade(0x00000400, 0, 6, 0, 0);
        ClearDialogWindowAndFrameToTransparent(WIN_MESSAGE, false);
        ScheduleBgCopyTilemapToVram(1);
        data[tPokedudeState]++;
      }
      break;
    case 18:
      SetDescriptionWindowShade(1);
      PrintMessageWithFollowupTask(taskId, K.FONT_MALE, text('gPokedudeText_ReadTMDescription'), null);
      gTasks[taskId].func = Task_Pokedude_Run; // this function
      data[tPokedudeState]++;
      break;
    case 20:
      if (JOY_NEW(A_BUTTON | B_BUTTON)) data[tPokedudeState]++;
      break;
    case 21:
      if (!gPaletteFade.active) {
        // Restore the player's bag
        const b = sPokedudeBagBackup!;
        restoreSlots(tmCasePocket(), b.bagPocket_TMHM);
        restoreSlots(bagPocket(K.POCKET_KEY_ITEMS - 1), b.bagPocket_KeyItems);
        DestroyListMenuTask(data[tListTaskId]);
        sTMCaseStaticResources.selectedRow = b.selectedRow;
        sTMCaseStaticResources.scrollOffset = b.scrollOffset;
        sPokedudeBagBackup = null;
        gPlttBufferUnfaded.set(gPlttBufferFaded);
        CB2_SetUpReshowBattleScreenAfterMenu();
        BeginNormalPaletteFade(0xffffffff, -2, 0, 16, 0);
        data[tPokedudeState]++;
      }
      break;
    default:
      if (!gPaletteFade.active) {
        SetMainCallback2(sTMCaseStaticResources.exitCallback);
        RemoveScrollArrows();
        DestroyTMCaseBuffers();
        DestroyTask(taskId);
      }
      break;
  }
}

function InitWindowTemplatesAndPals(): void {
  InitWindows(sWindowTemplates);
  DeactivateAllTextPrinters();
  LoadUserWindowGfx(0, 0x5b, BG_PLTT_ID(14));
  LoadMenuMessageWindowGfx(0, 0x64, BG_PLTT_ID(11));
  LoadStdWindowGfx(0, 0x78, BG_PLTT_ID(13));
  LoadPalette(gfx16('gStandardMenuPalette'), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
  LoadPalette(gfx16('gStandardMenuPalette'), BG_PLTT_ID(10), PLTT_SIZE_4BPP);
  LoadPalette(sPal3Override, BG_PLTT_ID(15) + 6, 4);
  LoadPalette(sPal3Override, BG_PLTT_ID(13) + 6, 4);
  ListMenuLoadStdPalAt(BG_PLTT_ID(12), 1);
  for (let i = 0; i < sWindowTemplates.length - 1; i++) FillWindowPixelBuffer(i, 0x00);
  PutWindowTilemap(WIN_LIST);
  PutWindowTilemap(WIN_DESCRIPTION);
  PutWindowTilemap(WIN_TITLE);
  PutWindowTilemap(WIN_MOVE_INFO_LABELS);
  PutWindowTilemap(WIN_MOVE_INFO);
  ScheduleBgCopyTilemapToVram(0);
}

function TMCase_Print(windowId: number, fontId: number, str: number[], x: number, y: number, letterSpacing: number, lineSpacing: number, speed: number, colorIdx: number): void {
  AddTextPrinterParameterized4(windowId, fontId, x, y, letterSpacing, lineSpacing, sTextColors[colorIdx], speed, str);
}

function TMCase_SetWindowBorder1(windowId: number): void {
  DrawStdFrameWithCustomTileAndPalette(windowId, false, 0x5b, 14);
}

function TMCase_SetWindowBorder2(windowId: number): void {
  DrawStdFrameWithCustomTileAndPalette(windowId, false, 0x78, 13);
}

function PrintMessageWithFollowupTask(taskId: number, fontId: number, str: number[], func: TaskFunc | null): void {
  DisplayMessageAndContinueTask(taskId, WIN_MESSAGE, 0x64, 0x0b, fontId, GetTextSpeedSetting(), str, func);
  ScheduleBgCopyTilemapToVram(1);
}

function PrintTitle(): void {
  const title = text('gText_TMCase');
  const distance = 72 - GetStringWidth(K.FONT_NORMAL_COPY_1, title, 0);
  AddTextPrinterParameterized3(WIN_TITLE, K.FONT_NORMAL_COPY_1, Math.trunc(distance / 2), 1, sTextColors[COLOR_LIGHT], 0, title);
}

function DrawMoveInfoLabels(): void {
  BlitMenuInfoIcon(WIN_MOVE_INFO_LABELS, K.MENU_INFO_ICON_TYPE, 0, 0);
  BlitMenuInfoIcon(WIN_MOVE_INFO_LABELS, K.MENU_INFO_ICON_POWER, 0, 12);
  BlitMenuInfoIcon(WIN_MOVE_INFO_LABELS, K.MENU_INFO_ICON_ACCURACY, 0, 24);
  BlitMenuInfoIcon(WIN_MOVE_INFO_LABELS, K.MENU_INFO_ICON_PP, 0, 36);
  CopyWindowToVram(WIN_MOVE_INFO_LABELS, COPYWIN_GFX);
}

function PrintMoveInfo(itemId: number): void {
  FillWindowPixelRect(WIN_MOVE_INFO, 0, 0, 0, 40, 48);
  if (itemId === K.ITEM_NONE) {
    for (let i = 0; i < 4; i++) TMCase_Print(WIN_MOVE_INFO, K.FONT_NORMAL_COPY_2, text('gText_ThreeHyphens'), 7, 12 * i, 0, 0, TEXT_SKIP_DRAW, COLOR_MOVE_INFO);
    CopyWindowToVram(WIN_MOVE_INFO, COPYWIN_GFX);
    return;
  }
  const move = gBattleMoves[ItemIdToBattleMoveId(itemId)];
  // Type icon
  BlitMenuInfoIcon(WIN_MOVE_INFO, move.type + 1, 0, 0);
  // Power
  const power = move.power < 2 ? text('gText_ThreeHyphens') : ConvertIntToDecimalStringN(move.power, STR_CONV_MODE_RIGHT_ALIGN, 3);
  TMCase_Print(WIN_MOVE_INFO, K.FONT_NORMAL_COPY_2, power, 7, 12, 0, 0, TEXT_SKIP_DRAW, COLOR_MOVE_INFO);
  // Accuracy
  const accuracy = move.accuracy === 0 ? text('gText_ThreeHyphens') : ConvertIntToDecimalStringN(move.accuracy, STR_CONV_MODE_RIGHT_ALIGN, 3);
  TMCase_Print(WIN_MOVE_INFO, K.FONT_NORMAL_COPY_2, accuracy, 7, 24, 0, 0, TEXT_SKIP_DRAW, COLOR_MOVE_INFO);
  // PP
  TMCase_Print(WIN_MOVE_INFO, K.FONT_NORMAL_COPY_2, ConvertIntToDecimalStringN(move.pp, STR_CONV_MODE_RIGHT_ALIGN, 3), 7, 36, 0, 0, TEXT_SKIP_DRAW, COLOR_MOVE_INFO);
  CopyWindowToVram(WIN_MOVE_INFO, COPYWIN_GFX);
}

function PlaceHMTileInWindow(windowId: number, x: number, y: number): void {
  BlitBitmapToWindow(windowId, gfx('gTMCaseHM_Gfx'), x, y, 16, 12);
}

function PrintPlayersMoney(): void {
  PrintMoneyAmountInMoneyBoxWithBorder(WIN_MONEY, 120, 13, state.money);
}

function HandleCreateYesNoMenu(taskId: number): void {
  CreateYesNoMenuWithCallbacks(taskId, sYesNoWindowTemplate, K.FONT_NORMAL, 0, 2, 91, 14, sYesNoFuncTable);
}

function AddContextMenu(windowIndex: number): number {
  const d = D();
  if (d.contextMenuWindowId === 0xff) {
    d.contextMenuWindowId = AddWindow(sWindowTemplates_ContextMenu[windowIndex]);
    TMCase_SetWindowBorder1(d.contextMenuWindowId);
    ScheduleBgCopyTilemapToVram(0);
  }
  return d.contextMenuWindowId;
}

function RemoveContextMenu(): void {
  const d = D();
  ClearStdWindowAndFrameToTransparent(d.contextMenuWindowId, false);
  ClearWindowTilemap(d.contextMenuWindowId);
  RemoveWindow(d.contextMenuWindowId);
  ScheduleBgCopyTilemapToVram(0);
  d.contextMenuWindowId = 0xff;
}

function CreateDiscSprite(itemId: number): number {
  const spriteId = CreateSprite(sSpriteTemplate_Disc, DISC_BASE_X, DISC_BASE_Y, 0);
  if (itemId === K.ITEM_NONE) {
    SetDiscSpritePosition(gSprites[spriteId], DISC_HIDDEN);
  } else {
    const tmIdx = (itemId - K.ITEM_TM01) & 0xff;
    SetDiscSpriteAnim(gSprites[spriteId], tmIdx);
    TintDiscpriteByType(gBattleMoves[ItemIdToBattleMoveId(itemId)].type);
    SetDiscSpritePosition(gSprites[spriteId], tmIdx);
  }
  return spriteId;
}

function SetDiscSpriteAnim(sprite: Sprite, tmIdx: number): void {
  StartSpriteAnim(sprite, tmIdx >= K.NUM_TECHNICAL_MACHINES ? ANIM_HM : ANIM_TM);
}

function TintDiscpriteByType(type: number): void {
  const palOffset = PLTT_ID(IndexOfSpritePaletteTag(TAG_DISC));
  const start = sTMSpritePaletteOffsetByType(type);
  LoadPalette(sTMSpritePaletteBuffer!.subarray(start, start + 16), OBJ_PLTT_OFFSET + palOffset, PLTT_SIZE_4BPP);
  // The C's 1 << (16 + palOffset): palOffset is a colour offset (slot * 16), so only OBJ slot 0 gets a bit; the ARM
  // shifts anything from 32 up to 0 (JS would wrap the shift count).
  if (sTMCaseStaticResources.menuType === TMCASE_POKEDUDE) BlendPalettes(16 + palOffset < 32 ? (1 << (16 + palOffset)) >>> 0 : 0, 4, RGB_BLACK);
}

/** SetDiscSpritePosition: discs further down the case (HMs first, then TM01...) sit lower and further left. */
function SetDiscSpritePosition(sprite: Sprite, tmIdx: number): void {
  let x: number;
  let y: number;
  if (tmIdx === DISC_HIDDEN) {
    x = 27;
    y = 54;
    sprite.y2 = DISC_CASE_DISTANCE;
  } else {
    if (tmIdx >= K.NUM_TECHNICAL_MACHINES) tmIdx -= K.NUM_TECHNICAL_MACHINES;
    else tmIdx += K.NUM_HIDDEN_MACHINES;
    const total = K.NUM_TECHNICAL_MACHINES + K.NUM_HIDDEN_MACHINES;
    // Q_24_8_TO_INT(Q_24_8(n) / total)
    x = DISC_BASE_X - (Math.trunc(((14 * tmIdx) << 8) / total) >> 8);
    y = DISC_BASE_Y + (Math.trunc(((8 * tmIdx) << 8) / total) >> 8);
  }
  sprite.x = x;
  sprite.y = y;
}

// Sprite data
const sItemId = 0;
const sState = 1;

function SwapDisc(spriteId: number, itemId: number): void {
  const sprite = gSprites[spriteId];
  sprite.data[sItemId] = itemId;
  sprite.data[sState] = 0;
  sprite.callback = SpriteCB_SwapDisc;
}

function SpriteCB_SwapDisc(sprite: Sprite): void {
  switch (sprite.data[sState]) {
    case 0:
      // Lower the old disc back into the case
      if (sprite.y2 >= DISC_CASE_DISTANCE) {
        // Old disc hidden: set up the new one
        if (sprite.data[sItemId] !== K.ITEM_NONE) {
          sprite.data[sState]++;
          TintDiscpriteByType(gBattleMoves[ItemIdToBattleMoveId(sprite.data[sItemId])].type);
          sprite.data[sItemId] -= K.ITEM_TM01;
          SetDiscSpriteAnim(sprite, sprite.data[sItemId] & 0xff);
          SetDiscSpritePosition(sprite, sprite.data[sItemId] & 0xff);
        } else {
          sprite.callback = SpriteCallbackDummy;
        }
      } else {
        sprite.y2 += DISC_Y_MOVE;
      }
      break;
    case 1:
      // Raise the new disc out of the case
      if (sprite.y2 <= 0) sprite.callback = SpriteCallbackDummy;
      else sprite.y2 -= DISC_Y_MOVE;
      break;
  }
}

/** LoadDiscTypePalettes: the first 16 types' disc palettes, then Dragon's. */
function LoadDiscTypePalettes(): void {
  const numDiscColors = (K.NUMBER_OF_MON_TYPES - 1) * 16; // - 1 excludes TYPE_MYSTERY
  sTMSpritePaletteBuffer = new Uint16Array(numDiscColors + 16);
  sTMSpritePaletteBuffer.set(gfx16('gTMCaseDiscTypes1_Pal').subarray(0, 0x100), 0);
  sTMSpritePaletteBuffer.set(gfx16('gTMCaseDiscTypes2_Pal').subarray(0, 16), 0x100);
  // The C points the sprite palette past the buffer's end; TintDiscpriteByType overwrites it right away.
  LoadSpritePalette({ data: sTMSpritePaletteBuffer.subarray(numDiscColors, numDiscColors + 16), tag: TAG_DISC });
}

/** SortAndCompactBagPocket (item.c): empty slots last, the rest by item id. */
export function SortAndCompactBagPocket(slots: ItemSlot[]): void {
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      if (slots[i].quantity === 0 || (slots[j].quantity !== 0 && slots[i].itemId > slots[j].itemId)) [slots[i], slots[j]] = [slots[j], slots[i]];
    }
  }
}

/** SortPocketAndPlaceHMsFirst (item.c): sorted by item id, then the HMs moved in front of the TMs. */
export function SortPocketAndPlaceHMsFirst(slots: ItemSlot[]): void {
  SortAndCompactBagPocket(slots);
  let i: number;
  let j = 0;
  for (i = 0; i < slots.length; i++) {
    if (slots[i].itemId === K.ITEM_NONE && slots[i].quantity === 0) return;
    if (slots[i].itemId >= K.ITEM_HM01 && slots[i].quantity !== 0) {
      for (j = i + 1; j < slots.length; j++) {
        if (slots[j].itemId === K.ITEM_NONE && slots[j].quantity === 0) break;
      }
      break;
    }
  }
  if (i === slots.length) return; // a full pocket without HMs
  const hms = slots.slice(i, j);
  const tms = slots.slice(0, i);
  const rest = slots.slice(j);
  const sorted = [...hms, ...tms, ...rest];
  for (let k = 0; k < slots.length; k++) slots[k] = sorted[k];
}

/** The TM case while it's open (test probe): its TMCASE_* type, task, list position and the pocket's items. */
export function tmCaseProbe(): { menuType: number; task: string; fading: boolean; scroll: number; row: number; numTMs: number; items: number[]; selectClose: boolean; pokedudeState: number } | undefined {
  if (!sTMCaseDynamicResources) return undefined;
  const t = gTasks[sMainTaskId];
  return {
    menuType: sTMCaseStaticResources.menuType,
    task: t.isActive ? t.func.name : '',
    fading: gPaletteFade.active,
    scroll: sTMCaseStaticResources.scrollOffset,
    row: sTMCaseStaticResources.selectedRow,
    numTMs: sTMCaseDynamicResources.numTMs,
    items: tmCasePocket()
      .slice(0, sTMCaseDynamicResources.numTMs)
      .map((s) => s.itemId),
    selectClose: sTMCaseStaticResources.allowSelectClose,
    pokedudeState: t.isActive && t.func === Task_Pokedude_Run ? t.data[tPokedudeState] : -1,
  };
}
