// berry_pouch.c: the berry pouch. A list of the berry pouch pocket's berries ("No01 CHERI BERRY ×n"), the
// selected berry's icon and description, the pouch sprite that wobbles as the cursor moves, and what A does for
// each way in: from the bag (BERRYPOUCH_FROMFIELD: USE / GIVE / TOSS / EXIT), the party menu's GIVE
// (BERRYPOUCH_FROMPARTYGIVE), the PC box's GIVE (BERRYPOUCH_FROMPOKEMONSTORAGEPC), the Poké Mart's SELL
// (BERRYPOUCH_FROMMARTSELL: how many, YES/NO) and the battle bag (BERRYPOUCH_FROMBATTLE: USE / TOSS / EXIT).
// USE runs the berry's item_use.c function with this screen's task (FieldUseFunc_Medicine → the party menu,
// which comes back through CB2_ReturnToBerryPouchMenu = BERRYPOUCH_NA). Not ported: Berry Crush
// (BERRYPOUCH_FROMBERRYCRUSH), the link / Union Room menus and SEs.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { InitBgsFromTemplates, ResetBgsAndClearDma3BusyFlags, SetBgTilemapBuffer, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import { DISPCNT_MODE_0, DISPCNT_OBJ_1D_MAP, DISPCNT_OBJ_ON, REG_OFFSET_BLDCNT, REG_OFFSET_DISPCNT, RGB_BLACK, SetGpuReg } from '../gba/hw';
import {
  DestroyListMenuTask,
  gMultiuseListMenuTemplate,
  LIST_CANCEL,
  LIST_NOTHING_CHOSEN,
  ListMenu_ProcessInput,
  ListMenuGetScrollAndRow,
  ListMenuGetYCoordForPrintingArrowCursor,
  ListMenuInit,
  type ListMenu,
  type ListMenuItem,
} from '../gba/listMenu';
import { A_BUTTON, B_BUTTON, JOY_NEW, SELECT_BUTTON, SetMainCallback2, SetVBlankCallback, gMain, type MainCallback } from '../gba/main';
import {
  AddItemMenuActionTextPrinters,
  AdjustQuantityAccordingToDPadInput,
  ClearDialogWindowAndFrameToTransparent,
  ClearScheduledBgCopiesToVram,
  ClearStdWindowAndFrameToTransparent,
  CreateYesNoMenuWithCallbacks,
  DecompressAndCopyTileDataToVram,
  DisplayMessageAndContinueTask,
  DoScheduledBgTilemapCopiesToVram,
  DrawStdFrameWithCustomTileAndPalette,
  FreeTempTileDataBuffersIfPossible,
  GetMenuCursorDimensionByFont,
  GetTextSpeedSetting,
  LoadMenuMessageWindowGfx,
  LoadStdWindowGfx,
  LoadUserWindowGfx,
  Menu_InitCursor,
  Menu_ProcessInputNoWrapAround,
  ResetAllBgsCoordinatesAndBgCntRegs,
  ResetTempTileDataBuffers,
  ScheduleBgCopyTilemapToVram,
  SetBgTilemapPalette,
  SetVBlankHBlankCallbacksToNull,
  type MenuAction,
} from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, LoadCompressedPalette, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import {
  AFFINEANIMCMD_END,
  AFFINEANIMCMD_FRAME,
  ANIMCMD_END,
  ANIMCMD_FRAME,
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  FreeAllSpritePalettes,
  gSprites,
  LoadCompressedSpriteSheet,
  LoadSpritePalette,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  ST_OAM_AFFINE_NORMAL,
  StartSpriteAffineAnim,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks, type TaskFunc } from '../gba/task';
import {
  AddTextPrinterParameterized4,
  AddWindow,
  ClearWindowTilemap,
  COPYWIN_GFX,
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FillWindowPixelRect,
  FONTATTR_LETTER_SPACING,
  FONTATTR_MAX_LETTER_HEIGHT,
  FreeAllWindowBuffers,
  GetFontAttribute,
  GetStringWidth,
  InitWindows,
  PutWindowTilemap,
  RemoveWindow,
  TEXT_SKIP_DRAW,
  type WindowTemplate,
} from '../gba/window';
import type { ItemSlot } from '../state/Bag';
import {
  BagGetItemIdByPocketPosition,
  BagGetQuantityByPocketPosition,
  bagPocket,
  CalculatePlayerPartyCount,
  concat,
  ConvertIntToDecimalStringN,
  CopyItemName,
  encodeRaw,
  ExpandToStringVar4,
  gStringVar1,
  gStringVar2,
  gStringVar3,
  ItemId_GetBattleFunc,
  ItemId_GetDescription,
  ItemId_GetFieldFunc,
  ItemId_GetPrice,
  ItemId_GetType,
  RemoveBagItem,
  STR_CONV_MODE_LEADING_ZEROS,
  STR_CONV_MODE_LEFT_ALIGN,
  STR_CONV_MODE_RIGHT_ALIGN,
  text,
} from './common';
import { GetDialogBoxFontId } from './itemMenu';
import { CreateBerryPouchItemIcon, DestroyItemMenuIcon, ResetItemMenuIconState } from './itemMenuIcons';
import { SpecialVar } from './itemMenuState';
import { BATTLE_USE_FUNCS, FIELD_USE_FUNCS } from './itemUse';
import { AddScrollIndicatorArrowPairParameterized, RemoveScrollIndicatorArrowPair } from './menuIndicators';
import { PrintMoneyAmount, PrintMoneyAmountInMoneyBox, PrintMoneyAmountInMoneyBoxWithBorder } from './money';
import { CB2_ChooseMonToGiveItem, CB2_GiveHoldItem } from './partyMenu';
import { CB2_ReturnToPokeStorage } from './pokemonStorage';
import { SortAndCompactBagPocket } from './tmCase';
import { RecordItemTransaction } from './shopQuestLog';

// enum BerryPouchType (include/berry_pouch.h)
export const BERRYPOUCH_FROMFIELD = 0;
export const BERRYPOUCH_FROMPARTYGIVE = 1;
export const BERRYPOUCH_FROMMARTSELL = 2;
export const BERRYPOUCH_FROMPOKEMONSTORAGEPC = 3;
export const BERRYPOUCH_FROMBATTLE = 4;
export const BERRYPOUCH_FROMBERRYCRUSH = 5;
export const BERRYPOUCH_NA = 6;
/** InitBerryPouch's allowSelect that keeps the previous value. */
export const BERRYPOUCH_KEEP_PREV = 0xff;

const BP_ACTION_USE = 0;
const BP_ACTION_TOSS = 1;
const BP_ACTION_GIVE = 2;
const BP_ACTION_EXIT = 3;
const BP_ACTION_DUMMY = 4;

const TAG_SCROLL_ARROW = 110;
const TAG_BERRY_POUCH = 100;

// The main windows (sWindowTemplates_Main)
const WIN_LIST = 0;
const WIN_DESCRIPTION = 1;
const WIN_TITLE = 2;

// sVariableWindowIds' slots (sWindowTemplates_Variable)
const VWIN_TOSS_QUANTITY = 0;
const VWIN_SELL_QUANTITY = 1;
const VWIN_MONEY = 2;
const VWIN_MESSAGE = 5;
const VWIN_SELECTED = 6;
const VWIN_TOSS_YESNO_MSG = 7;
const VWIN_TOSS_HOW_MANY = 8;
const VWIN_THREW_AWAY = 9;
/** The context menu's window is this + the number of options (1-4). */
const VWIN_CONTEXT_MENU_BASE = 9;
const NUM_VARIABLE_WINDOWS = 14;

/** sStaticCnt: kept across leaving the berry pouch (to the party menu, or closed). */
const sStaticCnt = {
  savedCallback: null as MainCallback | null,
  type: 0,
  allowSelect: 0,
  listMenuSelectedRow: 0,
  listMenuScrollOffset: 0,
};

/** sResources: allocated while the berry pouch is open. */
interface BerryPouchResources {
  exitCallback: MainCallback | null;
  indicatorOffset: number;
  indicatorTaskId: number;
  listMenuNumItems: number;
  listMenuMaxShowed: number;
  itemMenuIconId: number;
  bg1TilemapBuffer: Uint16Array;
  data: number[];
}

let sResources: BerryPouchResources | null = null;
const R = () => sResources!;
/** The screen's task (the C passes its id around; the port keeps it for the test probe). */
let sMainTaskId = 0;
let sListMenuItems: ListMenuItem[] = [];
/** sListMenuStrbuf: each berry's list label. */
let sListMenuStrbuf: number[][] = [];
let sContextMenuOptions: number[] = [];
let sContextMenuNumOptions = 0;
const sVariableWindowIds = new Array<number>(NUM_VARIABLE_WINDOWS).fill(0xff);
let sBerryPouchSpriteId = 0;

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0 },
  { bg: 1, charBaseIndex: 3, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0 },
  { bg: 2, charBaseIndex: 0, mapBaseIndex: 29, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 },
];

/** sBerryPouchContextMenuTasks: what A on a berry does, by how the berry pouch was opened. */
function sBerryPouchContextMenuTasks(type: number): TaskFunc {
  switch (type) {
    case BERRYPOUCH_FROMPARTYGIVE:
      return Task_ContextMenu_FromPartyGiveMenu;
    case BERRYPOUCH_FROMMARTSELL:
      return Task_ContextMenu_Sell;
    case BERRYPOUCH_FROMPOKEMONSTORAGEPC:
      return Task_ContextMenu_FromPokemonPC;
    default:
      return Task_NormalContextMenu;
  }
}

const sYesNoFuncs_Toss = { yesFunc: Task_TossYes, noFunc: Task_TossNo };
const sYesNoFuncs_Sell = { yesFunc: Task_SellYes, noFunc: Task_SellNo };

/** sContextMenuActions */
function sContextMenuActions(): MenuAction[] {
  return [
    { text: text('gOtherText_Use'), func: Task_BerryPouch_Use },
    { text: text('gOtherText_Toss'), func: Task_BerryPouch_Toss },
    { text: text('gOtherText_Give'), func: Task_BerryPouch_Give },
    { text: text('gOtherText_Exit'), func: Task_BerryPouch_Exit },
    { text: text('gString_Dummy'), func: null },
  ];
}

const sOptions_UseGiveTossExit = [BP_ACTION_USE, BP_ACTION_GIVE, BP_ACTION_TOSS, BP_ACTION_EXIT];
const sOptions_UseToss_Exit = [BP_ACTION_USE, BP_ACTION_TOSS, BP_ACTION_EXIT, BP_ACTION_DUMMY];
// sOptions_GiveExit / sOptions_Exit are for link play and the Union Room, which aren't ported.

const sText_Space = () => encodeRaw(' ');

const sWindowTemplates_Main: WindowTemplate[] = [
  { bg: 0, tilemapLeft: 11, tilemapTop: 1, width: 18, height: 14, paletteNum: 15, baseBlock: 0x027 }, // WIN_LIST
  { bg: 0, tilemapLeft: 5, tilemapTop: 16, width: 25, height: 4, paletteNum: 15, baseBlock: 0x123 }, // WIN_DESCRIPTION
  { bg: 2, tilemapLeft: 1, tilemapTop: 1, width: 9, height: 2, paletteNum: 15, baseBlock: 0x187 }, // WIN_TITLE
  DUMMY_WIN_TEMPLATE,
];

const sWindowTemplates_Variable: WindowTemplate[] = [
  { bg: 2, tilemapLeft: 24, tilemapTop: 15, width: 5, height: 4, paletteNum: 15, baseBlock: 0x1d1 }, // toss quantity
  { bg: 2, tilemapLeft: 17, tilemapTop: 9, width: 12, height: 4, paletteNum: 15, baseBlock: 0x1d1 }, // sell quantity
  { bg: 2, tilemapLeft: 1, tilemapTop: 1, width: 8, height: 3, paletteNum: 12, baseBlock: 0x201 }, // money
  { bg: 2, tilemapLeft: 23, tilemapTop: 15, width: 6, height: 4, paletteNum: 15, baseBlock: 0x219 }, // toss YES/NO
  { bg: 2, tilemapLeft: 21, tilemapTop: 9, width: 6, height: 4, paletteNum: 15, baseBlock: 0x219 }, // sell YES/NO
  { bg: 2, tilemapLeft: 2, tilemapTop: 15, width: 26, height: 4, paletteNum: 15, baseBlock: 0x231 }, // message
  { bg: 2, tilemapLeft: 6, tilemapTop: 15, width: 14, height: 4, paletteNum: 12, baseBlock: 0x231 }, // "... is selected."
  { bg: 2, tilemapLeft: 6, tilemapTop: 15, width: 15, height: 4, paletteNum: 12, baseBlock: 0x269 }, // "Throw away ...?"
  { bg: 2, tilemapLeft: 6, tilemapTop: 15, width: 16, height: 4, paletteNum: 12, baseBlock: 0x2a5 }, // "Toss out how many ...?"
  { bg: 2, tilemapLeft: 6, tilemapTop: 15, width: 23, height: 4, paletteNum: 12, baseBlock: 0x2e5 }, // "Threw away ..."
  { bg: 2, tilemapLeft: 22, tilemapTop: 17, width: 7, height: 2, paletteNum: 15, baseBlock: 0x199 }, // context menu, 1 option
  { bg: 2, tilemapLeft: 22, tilemapTop: 15, width: 7, height: 4, paletteNum: 15, baseBlock: 0x199 }, // 2 options
  { bg: 2, tilemapLeft: 22, tilemapTop: 13, width: 7, height: 6, paletteNum: 15, baseBlock: 0x199 }, // 3 options
  { bg: 2, tilemapLeft: 22, tilemapTop: 11, width: 7, height: 8, paletteNum: 15, baseBlock: 0x199 }, // 4 options
];

/** sTextColors: [bg, fg, shadow] */
const sTextColors = [
  [0, 1, 2],
  [0, 2, 3],
  [0, 3, 2],
];

/** sSpriteTemplate_BerryPouch (sOamData: 64x64, affine, priority 1; sSpriteAffineAnim_Static / _Wobble) */
function sSpriteTemplate_BerryPouch(): SpriteTemplate {
  return {
    tileTag: TAG_BERRY_POUCH,
    paletteTag: TAG_BERRY_POUCH,
    oam: oam({ affineMode: ST_OAM_AFFINE_NORMAL, shape: SPRITE_SHAPE['64x64'][0], size: SPRITE_SHAPE['64x64'][1], priority: 1 }),
    anims: [[ANIMCMD_FRAME(0, 0), ANIMCMD_END]],
    images: null,
    affineAnims: [
      [AFFINEANIMCMD_FRAME(0x100, 0x100, 0, 0), AFFINEANIMCMD_END],
      [AFFINEANIMCMD_FRAME(0, 0, -2, 2), AFFINEANIMCMD_FRAME(0, 0, 2, 4), AFFINEANIMCMD_FRAME(0, 0, -2, 4), AFFINEANIMCMD_FRAME(0, 0, 2, 2), AFFINEANIMCMD_END],
    ],
    callback: SpriteCallbackDummy,
  };
}

/** Every graphic the berry pouch loads (for preloading: the screen draws synchronously). */
export const BERRY_POUCH_GFX = [
  'gBerryPouchSpriteTiles',
  'gBerryPouchBgGfx',
  'gBerryPouchBgPals',
  'gBerryPouchBgPal0FemaleOverride',
  'gBerryPouchSpritePalette',
  'gBerryPouchBg1Tilemap',
  'gStandardMenuPalette',
];

const berryPocket = (): ItemSlot[] => bagPocket(K.POCKET_BERRY_POUCH - 1);

/** InitBerryPouch: open the berry pouch (`type` BERRYPOUCH_*), returning to `savedCallback` (null: keep the previous one). */
export function InitBerryPouch(type: number, savedCallback: MainCallback | null, allowSelect: number): void {
  sResources = {
    exitCallback: null,
    indicatorOffset: 0,
    indicatorTaskId: 0xff,
    listMenuNumItems: 0,
    listMenuMaxShowed: 0,
    itemMenuIconId: 0,
    bg1TilemapBuffer: new Uint16Array(0x400),
    data: [0, 0, 0, 0],
  };
  if (type !== BERRYPOUCH_NA) sStaticCnt.type = type;
  if (allowSelect !== BERRYPOUCH_KEEP_PREV) sStaticCnt.allowSelect = allowSelect;
  if (savedCallback !== null) sStaticCnt.savedCallback = savedCallback;
  // gTextFlags.autoScroll = FALSE: the port's printers never auto-scroll here
  SpecialVar.ItemId = K.ITEM_NONE;
  SetMainCallback2(CB2_InitBerryPouch);
}

function CB2_BerryPouchIdle(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  DoScheduledBgTilemapCopiesToVram();
  UpdatePaletteFade();
}

function VBlankCB_BerryPouchIdle(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function CB2_InitBerryPouch(): void {
  // IsActiveOverworldLinkBusy / MenuHelpers_IsLinkActive: no link play
  while (!RunBerryPouchInit());
}

// Task data
const tListTaskId = 0;
const tItemIndex = 1;
const tItemCount = 2;
const tQuantity = 8;

function RunBerryPouchInit(): boolean {
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
      ResetItemMenuIconState();
      gMain.state++;
      break;
    case 6:
      ResetTasks();
      gMain.state++;
      break;
    case 7:
      BerryPouchInitBgs();
      R().data[0] = 0;
      gMain.state++;
      break;
    case 8:
      if (BerryPouchLoadGfx()) gMain.state++;
      break;
    case 9:
      BerryPouchInitWindows();
      gMain.state++;
      break;
    case 10:
      SortAndCountBerries();
      SanitizeListMenuSelectionParams();
      UpdateListMenuScrollOffset();
      gMain.state++;
      break;
    case 11:
      // AllocateListMenuBuffers can't fail here (AbortBerryPouchLoading is for a failed Alloc)
      gMain.state++;
      break;
    case 12:
      SetUpListMenuTemplate();
      gMain.state++;
      break;
    case 13:
      PrintBerryPouchHeaderCentered();
      gMain.state++;
      break;
    case 14: {
      const taskId = CreateTask(Task_BerryPouchMain, 0);
      sMainTaskId = taskId;
      gTasks[taskId].data[tListTaskId] = ListMenuInit(gMultiuseListMenuTemplate, sStaticCnt.listMenuScrollOffset, sStaticCnt.listMenuSelectedRow);
      gTasks[taskId].data[tQuantity] = 0;
      gMain.state++;
      break;
    }
    case 15:
      CreateBerryPouchSprite();
      gMain.state++;
      break;
    case 16:
      CreateScrollIndicatorArrows_BerryPouchList();
      gMain.state++;
      break;
    case 17:
      BlendPalettes(0xffffffff, 16, RGB_BLACK);
      gMain.state++;
      break;
    case 18:
      BeginNormalPaletteFade(0xffffffff, -2, 16, 0, RGB_BLACK);
      gMain.state++;
      break;
    default:
      SetVBlankCallback(VBlankCB_BerryPouchIdle);
      SetMainCallback2(CB2_BerryPouchIdle);
      return true;
  }
  return false;
}

function BerryPouchInitBgs(): void {
  ResetAllBgsCoordinatesAndBgCntRegs();
  R().bg1TilemapBuffer.fill(0);
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBgTemplates, sBgTemplates.length);
  SetBgTilemapBuffer(1, R().bg1TilemapBuffer);
  ScheduleBgCopyTilemapToVram(1);
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
  ShowBg(0);
  ShowBg(1);
  ShowBg(2);
}

function BerryPouchLoadGfx(): boolean {
  const r = R();
  switch (r.data[0]) {
    case 0:
      ResetTempTileDataBuffers();
      DecompressAndCopyTileDataToVram(1, gfx('gBerryPouchBgGfx'), 0, 0, 0);
      r.data[0]++;
      break;
    case 1:
      if (FreeTempTileDataBuffersIfPossible() !== true) {
        // LZDecompressWram(gBerryPouchBg1Tilemap, sResources->bg1TilemapBuffer)
        r.bg1TilemapBuffer.set(gfx16('gBerryPouchBg1Tilemap').subarray(0, 0x400));
        r.data[0]++;
      }
      break;
    case 2:
      LoadCompressedPalette(gfx16('gBerryPouchBgPals'), BG_PLTT_ID(0), 3 * PLTT_SIZE_4BPP);
      if (state.playerGender !== 'male') LoadCompressedPalette(gfx16('gBerryPouchBgPal0FemaleOverride'), BG_PLTT_ID(0), PLTT_SIZE_4BPP);
      r.data[0]++;
      break;
    case 3:
      LoadCompressedSpriteSheet({ data: gfx('gBerryPouchSpriteTiles'), size: 0x800, tag: TAG_BERRY_POUCH }); // sBerryPouchSpriteSheet
      r.data[0]++;
      break;
    default:
      LoadSpritePalette({ data: gfx16('gBerryPouchSpritePalette'), tag: TAG_BERRY_POUCH }); // sBerryPouchSpritePal
      r.data[0] = 0;
      return true;
  }
  return false;
}

function SetUpListMenuTemplate(): void {
  const r = R();
  const pocket = berryPocket();
  sListMenuStrbuf = [];
  sListMenuItems = [];
  let i: number;
  for (i = 0; i < r.listMenuNumItems; i++) {
    sListMenuStrbuf.push(GetBerryNameAndIndexForMenu(pocket[i].itemId));
    sListMenuItems.push({ label: sListMenuStrbuf[i], index: i });
  }
  sListMenuItems.push({ label: text('gText_Close'), index: i });

  const t = gMultiuseListMenuTemplate;
  t.items = sListMenuItems;
  // BERRYPOUCH_FROMBERRYCRUSH has no CLOSE (not ported)
  t.totalItems = sStaticCnt.type !== BERRYPOUCH_FROMBERRYCRUSH ? r.listMenuNumItems + 1 : r.listMenuNumItems;
  t.windowId = WIN_LIST;
  t.header_X = 0;
  t.item_X = 9;
  t.cursor_X = 1;
  t.lettersSpacing = 0;
  t.itemVerticalPadding = 2;
  t.upText_Y = 2;
  t.maxShowed = r.listMenuMaxShowed;
  t.fontId = K.FONT_NORMAL;
  t.cursorPal = 2;
  t.fillValue = 0;
  t.cursorShadowPal = 3;
  t.moveCursorFunc = BerryPouchMoveCursorFunc;
  t.itemPrintFunc = BerryPouchItemPrintFunc;
  t.cursorKind = 0;
  t.scrollMultiple = 0;
}

/** GetBerryNameAndIndexForMenu: "No01 CHERI BERRY", the number in the small font. */
function GetBerryNameAndIndexForMenu(itemId: number): number[] {
  return concat(
    text('gText_FontSmall'),
    text('gText_NumberClear01'),
    ConvertIntToDecimalStringN(itemId - K.FIRST_BERRY_INDEX + 1, STR_CONV_MODE_LEADING_ZEROS, 2),
    sText_Space(),
    text('gText_FontNormal'),
    CopyItemName(itemId),
  );
}

/** CopySelectedListMenuItemName */
function CopySelectedListMenuItemName(itemIdx: number): number[] {
  return sListMenuStrbuf[itemIdx] ?? [];
}

function BerryPouchMoveCursorFunc(itemIndex: number, onInit: boolean, _list: ListMenu): void {
  const r = R();
  if (onInit !== true) {
    PlaySE(K.SE_BAG_CURSOR);
    StartBerryPouchSpriteWobbleAnim();
  }
  DestroyItemMenuIcon(r.itemMenuIconId ^ 1);
  if (r.listMenuNumItems !== itemIndex) CreateBerryPouchItemIcon(BagGetItemIdByPocketPosition(K.POCKET_BERRY_POUCH, itemIndex), r.itemMenuIconId);
  else CreateBerryPouchItemIcon(K.ITEMS_COUNT, r.itemMenuIconId);
  r.itemMenuIconId ^= 1;
  PrintSelectedBerryDescription(itemIndex);
}

function BerryPouchItemPrintFunc(windowId: number, itemId: number, y: number): void {
  if (itemId !== LIST_CANCEL && R().listMenuNumItems !== itemId) {
    const itemQuantity = BagGetQuantityByPocketPosition(K.POCKET_BERRY_POUCH, itemId);
    gStringVar1.set(ConvertIntToDecimalStringN(itemQuantity, STR_CONV_MODE_RIGHT_ALIGN, 3));
    BerryPouchPrint(windowId, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 110, y, 0, 0, TEXT_SKIP_DRAW, 1);
  }
}

function BerryPouchSetArrowCursorFromListMenu(listTaskId: number, colorIdx: number): void {
  BerryPouchSetArrowCursorAt(ListMenuGetYCoordForPrintingArrowCursor(listTaskId), colorIdx);
}

function BerryPouchSetArrowCursorAt(y: number, colorIdx: number): void {
  if (colorIdx === 0xff) {
    const width = GetMenuCursorDimensionByFont(K.FONT_NORMAL, 0);
    const height = GetMenuCursorDimensionByFont(K.FONT_NORMAL, 1);
    FillWindowPixelRect(WIN_LIST, 0, 1, y, width, height);
    CopyWindowToVram(WIN_LIST, COPYWIN_GFX);
  } else {
    BerryPouchPrint(WIN_LIST, K.FONT_NORMAL, text('gText_SelectorArrow2'), 1, y, 0, 0, 0, colorIdx);
  }
}

function PrintSelectedBerryDescription(itemIdx: number): void {
  const str = itemIdx !== R().listMenuNumItems ? ItemId_GetDescription(BagGetItemIdByPocketPosition(K.POCKET_BERRY_POUCH, itemIdx)) : text('gText_TheBerryPouchWillBePutAway');
  FillWindowPixelBuffer(WIN_DESCRIPTION, 0);
  BerryPouchPrint(WIN_DESCRIPTION, K.FONT_NORMAL, str, 0, 2, 2, 0, 0, 0);
}

/** SetDescriptionWindowBorderPalette: darken (1) or lighten (0) the frame around the description window. */
function SetDescriptionWindowBorderPalette(pal: number): void {
  SetBgTilemapPalette(1, 0, 16, 30, 4, pal + 1);
  ScheduleBgCopyTilemapToVram(1);
}

function CreateScrollIndicatorArrows_BerryPouchList(): void {
  const r = R();
  const threshold = sStaticCnt.type !== BERRYPOUCH_FROMBERRYCRUSH ? r.listMenuNumItems - r.listMenuMaxShowed + 1 : r.listMenuNumItems - r.listMenuMaxShowed;
  r.indicatorTaskId = AddScrollIndicatorArrowPairParameterized(K.SCROLL_ARROW_UP, 160, 8, 120, threshold, TAG_SCROLL_ARROW, TAG_SCROLL_ARROW, () => sStaticCnt.listMenuScrollOffset);
}

function CreateScrollIndicatorArrows_TossQuantity(): void {
  const r = R();
  r.indicatorOffset = 1;
  r.indicatorTaskId = AddScrollIndicatorArrowPairParameterized(K.SCROLL_ARROW_UP, 212, 120, 152, 2, TAG_SCROLL_ARROW, TAG_SCROLL_ARROW, () => r.indicatorOffset);
}

function CreateScrollIndicatorArrows_SellQuantity(): void {
  const r = R();
  r.indicatorOffset = 1;
  r.indicatorTaskId = AddScrollIndicatorArrowPairParameterized(K.SCROLL_ARROW_UP, 152, 72, 104, 2, TAG_SCROLL_ARROW, TAG_SCROLL_ARROW, () => r.indicatorOffset);
}

function DestroyScrollIndicatorArrows(): void {
  const r = R();
  if (r.indicatorTaskId !== 0xff) {
    RemoveScrollIndicatorArrowPair(r.indicatorTaskId);
    r.indicatorTaskId = 0xff;
  }
}

function PrintBerryPouchHeaderCentered(): void {
  const title = text('gText_BerryPouch');
  const slack = 72 - GetStringWidth(K.FONT_NORMAL_COPY_1, title, 0);
  BerryPouchPrint(WIN_TITLE, K.FONT_NORMAL_COPY_1, title, Math.trunc(slack / 2), 1, 0, 0, 0, 0);
}

/** BerryPouch_CursorResetToTop (new game) */
export function BerryPouch_CursorResetToTop(): void {
  sStaticCnt.listMenuSelectedRow = 0;
  sStaticCnt.listMenuScrollOffset = 0;
}

/** The list's length: the berries, plus CLOSE except for Berry Crush. */
function listLength(): number {
  return sStaticCnt.type !== BERRYPOUCH_FROMBERRYCRUSH ? R().listMenuNumItems + 1 : R().listMenuNumItems;
}

function SanitizeListMenuSelectionParams(): void {
  const r = R();
  const s = sStaticCnt;
  const r2 = listLength();
  if (s.listMenuScrollOffset !== 0 && s.listMenuScrollOffset + r.listMenuMaxShowed > r2) s.listMenuScrollOffset = r2 - r.listMenuMaxShowed;
  if (s.listMenuScrollOffset + s.listMenuSelectedRow >= r2) {
    if (r2 === 0 || r2 === 1) s.listMenuSelectedRow = 0;
    else s.listMenuSelectedRow = r2 - 1;
  }
}

function UpdateListMenuScrollOffset(): void {
  const r = R();
  const s = sStaticCnt;
  const lim = listLength();
  if (s.listMenuSelectedRow > 4) {
    for (let i = 0; i <= s.listMenuSelectedRow - 4; s.listMenuSelectedRow--, s.listMenuScrollOffset++, i++) {
      if (s.listMenuScrollOffset + r.listMenuMaxShowed === lim) break;
    }
  }
}

function BerryPouch_DestroyResources(): void {
  sResources = null;
  sListMenuItems = [];
  sListMenuStrbuf = [];
  FreeAllWindowBuffers();
}

function destroyList(taskId: number): void {
  const out = { cursorPos: 0, itemsAbove: 0 };
  DestroyListMenuTask(gTasks[taskId].data[tListTaskId], out);
  sStaticCnt.listMenuScrollOffset = out.cursorPos;
  sStaticCnt.listMenuSelectedRow = out.itemsAbove;
}

/** DestroyListMenuTask, recount the berries and rebuild the list where it was. */
function rebuildList(taskId: number): void {
  destroyList(taskId);
  SortAndCountBerries();
  SanitizeListMenuSelectionParams();
  SetUpListMenuTemplate();
  gTasks[taskId].data[tListTaskId] = ListMenuInit(gMultiuseListMenuTemplate, sStaticCnt.listMenuScrollOffset, sStaticCnt.listMenuSelectedRow);
}

/** BerryPouch_StartFadeToExitCallback: fade out, then leave to the exit callback (or the saved callback). */
export function BerryPouch_StartFadeToExitCallback(taskId: number): void {
  BeginNormalPaletteFade(0xffffffff, -2, 0, 16, RGB_BLACK);
  gTasks[taskId].func = Task_BerryPouchFadeToExitCallback;
}

function Task_BerryPouchFadeToExitCallback(taskId: number): void {
  if (!gPaletteFade.active) {
    destroyList(taskId);
    const r = R();
    if (r.exitCallback !== null) SetMainCallback2(r.exitCallback);
    else SetMainCallback2(sStaticCnt.savedCallback);
    DestroyScrollIndicatorArrows();
    BerryPouch_DestroyResources();
    DestroyTask(taskId);
  }
}

function SortAndCountBerries(): void {
  const r = R();
  const pocket = berryPocket();
  SortAndCompactBagPocket(pocket);
  r.listMenuNumItems = 0;
  for (let i = 0; i < pocket.length; i++) {
    if (pocket[i].itemId === K.ITEM_NONE) break;
    r.listMenuNumItems++;
  }
  r.listMenuMaxShowed = Math.min(listLength(), 7);
}

/** BerryPouch_SetExitCallback */
export function BerryPouch_SetExitCallback(callback: MainCallback | null): void {
  R().exitCallback = callback;
}

function InitTossQuantitySelectUI(taskId: number, str: number[]): void {
  const data = gTasks[taskId].data;
  const windowId = GetOrCreateVariableWindow(VWIN_TOSS_HOW_MANY);
  gStringVar1.set(CopySelectedListMenuItemName(data[tItemIndex]));
  BerryPouchPrint(windowId, K.FONT_NORMAL, ExpandToStringVar4(str), 0, 2, 1, 2, 0, 1);
  const windowId2 = GetOrCreateVariableWindow(VWIN_TOSS_QUANTITY);
  gStringVar1.set(ConvertIntToDecimalStringN(1, STR_CONV_MODE_LEADING_ZEROS, 3));
  BerryPouchPrint(windowId2, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 4, 10, 1, 0, 0, 1);
}

function PrintxQuantityOnWindow(whichWindow: number, quantity: number, ndigits: number): void {
  const windowId = GetVariableWindowId(whichWindow);
  FillWindowPixelBuffer(windowId, 0x11);
  gStringVar1.set(ConvertIntToDecimalStringN(quantity, STR_CONV_MODE_LEADING_ZEROS, ndigits));
  BerryPouchPrint(windowId, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 4, 10, 1, 0, 0, 1);
}

function Task_BerryPouchMain(taskId: number): void {
  const data = gTasks[taskId].data;
  if (gPaletteFade.active) return; // IsActiveOverworldLinkBusy: no link play
  const menuInput = ListMenu_ProcessInput(data[tListTaskId]);
  const sr = ListMenuGetScrollAndRow(data[tListTaskId]);
  sStaticCnt.listMenuScrollOffset = sr.cursorPos;
  sStaticCnt.listMenuSelectedRow = sr.itemsAbove;
  if (JOY_NEW(SELECT_BUTTON) && sStaticCnt.allowSelect === 1) {
    PlaySE(K.SE_SELECT);
    SpecialVar.ItemId = K.ITEM_NONE;
    BerryPouch_StartFadeToExitCallback(taskId);
    return;
  }
  switch (menuInput) {
    case LIST_NOTHING_CHOSEN:
      return;
    case LIST_CANCEL:
      if (sStaticCnt.type !== BERRYPOUCH_FROMBERRYCRUSH) {
        PlaySE(K.SE_SELECT);
        SpecialVar.ItemId = K.ITEM_NONE;
        BerryPouch_StartFadeToExitCallback(taskId);
      }
      break;
    default:
      PlaySE(K.SE_SELECT);
      if (sStaticCnt.type === BERRYPOUCH_FROMBERRYCRUSH) {
        SpecialVar.ItemId = BagGetItemIdByPocketPosition(K.POCKET_BERRY_POUCH, menuInput);
        BerryPouch_StartFadeToExitCallback(taskId);
      } else if (menuInput === R().listMenuNumItems) {
        // CLOSE
        SpecialVar.ItemId = K.ITEM_NONE;
        BerryPouch_StartFadeToExitCallback(taskId);
      } else {
        DestroyScrollIndicatorArrows();
        SetDescriptionWindowBorderPalette(1);
        BerryPouchSetArrowCursorFromListMenu(data[tListTaskId], 2);
        data[tItemIndex] = menuInput;
        data[tItemCount] = BagGetQuantityByPocketPosition(K.POCKET_BERRY_POUCH, menuInput);
        SpecialVar.ItemId = BagGetItemIdByPocketPosition(K.POCKET_BERRY_POUCH, menuInput);
        gTasks[taskId].func = sBerryPouchContextMenuTasks(sStaticCnt.type);
      }
      break;
  }
}

function Task_CleanUpAndReturnToMain(taskId: number): void {
  SetDescriptionWindowBorderPalette(0);
  CreateScrollIndicatorArrows_BerryPouchList();
  gTasks[taskId].func = Task_BerryPouchMain;
}

function CreateNormalContextMenu(taskId: number): void {
  const data = gTasks[taskId].data;
  if (sStaticCnt.type === BERRYPOUCH_FROMBATTLE) {
    sContextMenuOptions = sOptions_UseToss_Exit;
    sContextMenuNumOptions = 3;
  } else {
    // MenuHelpers_IsLinkActive / InUnionRoom (GIVE / EXIT or EXIT only) never apply: no link play
    sContextMenuOptions = sOptions_UseGiveTossExit;
    sContextMenuNumOptions = 4;
  }
  const windowId = GetOrCreateVariableWindow(sContextMenuNumOptions + VWIN_CONTEXT_MENU_BASE);
  const lineHeight = GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_HEIGHT) + 2;
  AddItemMenuActionTextPrinters(
    windowId,
    K.FONT_NORMAL,
    GetMenuCursorDimensionByFont(K.FONT_NORMAL, 0),
    2,
    GetFontAttribute(K.FONT_NORMAL, FONTATTR_LETTER_SPACING),
    lineHeight,
    sContextMenuNumOptions,
    sContextMenuActions(),
    sContextMenuOptions,
  );
  Menu_InitCursor(windowId, K.FONT_NORMAL, 0, 2, lineHeight, sContextMenuNumOptions, 0);
  const windowId2 = GetOrCreateVariableWindow(VWIN_SELECTED);
  gStringVar1.set(CopySelectedListMenuItemName(data[tItemIndex]));
  BerryPouchPrint(windowId2, K.FONT_NORMAL, ExpandToStringVar4(text('gText_Var1IsSelected')), 0, 2, 1, 2, 0, 1);
}

function Task_NormalContextMenu(taskId: number): void {
  CreateNormalContextMenu(taskId);
  gTasks[taskId].func = Task_NormalContextMenu_HandleInput;
}

function Task_NormalContextMenu_HandleInput(taskId: number): void {
  const input = Menu_ProcessInputNoWrapAround();
  switch (input) {
    case -2: // MENU_NOTHING_CHOSEN
      break;
    case -1: // MENU_B_PRESSED
      PlaySE(K.SE_SELECT);
      sContextMenuActions()[BP_ACTION_EXIT].func!(taskId);
      break;
    default:
      PlaySE(K.SE_SELECT);
      sContextMenuActions()[sContextMenuOptions[input]].func!(taskId);
      break;
  }
}

/** ItemId_GetFieldFunc / ItemId_GetBattleFunc, resolved to the ported item_use.c function (null = NULL). */
function useFunc(name: string, table: Record<string, TaskFunc>): TaskFunc | null {
  if (!name || name === 'NULL') return null;
  return (
    table[name] ??
    ((taskId: number) => {
      console.warn(`[berry_pouch] ${name} is not implemented`);
      Task_BerryPouch_DestroyDialogueWindowAndRefreshListMenu(taskId);
    })
  );
}

function Task_BerryPouch_Use(taskId: number): void {
  DestroyVariableWindow(sContextMenuNumOptions + VWIN_CONTEXT_MENU_BASE);
  DestroyVariableWindow(VWIN_SELECTED);
  PutWindowTilemap(WIN_LIST);
  PutWindowTilemap(WIN_DESCRIPTION);
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(2);
  if (sStaticCnt.type === BERRYPOUCH_FROMBATTLE) {
    const func = useFunc(ItemId_GetBattleFunc(SpecialVar.ItemId), BATTLE_USE_FUNCS);
    if (func === null) FIELD_USE_FUNCS.FieldUseFunc_OakStopsYou(taskId);
    else func(taskId);
  } else if (CalculatePlayerPartyCount() === 0 && ItemId_GetType(SpecialVar.ItemId) === K.ITEM_TYPE_PARTY_MENU) {
    Task_Give_PrintThereIsNoPokemon(taskId);
  } else {
    const func = useFunc(ItemId_GetFieldFunc(SpecialVar.ItemId), FIELD_USE_FUNCS);
    if (func === null) Task_BerryPouch_DestroyDialogueWindowAndRefreshListMenu(taskId); // every berry has one
    else func(taskId);
  }
}

function Task_BerryPouch_Toss(taskId: number): void {
  const data = gTasks[taskId].data;
  ClearWindowTilemap(GetVariableWindowId(sContextMenuNumOptions + VWIN_CONTEXT_MENU_BASE));
  ClearWindowTilemap(GetVariableWindowId(VWIN_SELECTED));
  DestroyVariableWindow(sContextMenuNumOptions + VWIN_CONTEXT_MENU_BASE);
  DestroyVariableWindow(VWIN_SELECTED);
  PutWindowTilemap(WIN_LIST);
  data[tQuantity] = 1;
  if (data[tItemCount] === 1) {
    Task_AskTossMultiple(taskId);
  } else {
    InitTossQuantitySelectUI(taskId, text('gText_TossOutHowManyStrVar1s'));
    CreateScrollIndicatorArrows_TossQuantity();
    gTasks[taskId].func = Task_Toss_SelectMultiple;
  }
}

function Task_AskTossMultiple(taskId: number): void {
  const data = gTasks[taskId].data;
  gStringVar2.set(ConvertIntToDecimalStringN(data[tQuantity], STR_CONV_MODE_LEFT_ALIGN, 3));
  BerryPouchPrint(GetOrCreateVariableWindow(VWIN_TOSS_YESNO_MSG), K.FONT_NORMAL, ExpandToStringVar4(text('gText_ThrowAwayStrVar2OfThisItemQM')), 0, 2, 1, 2, 0, 1);
  CreateYesNoMenuWin3(taskId, sYesNoFuncs_Toss);
}

function Task_TossNo(taskId: number): void {
  const data = gTasks[taskId].data;
  DestroyVariableWindow(VWIN_TOSS_YESNO_MSG);
  PutWindowTilemap(WIN_DESCRIPTION);
  PutWindowTilemap(WIN_LIST);
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(2);
  BerryPouchSetArrowCursorFromListMenu(data[tListTaskId], 1);
  Task_CleanUpAndReturnToMain(taskId);
}

function Task_Toss_SelectMultiple(taskId: number): void {
  const data = gTasks[taskId].data;
  if (AdjustQuantityAccordingToDPadInput(data, tQuantity, data[tItemCount]) === true) {
    PrintxQuantityOnWindow(VWIN_TOSS_QUANTITY, data[tQuantity], 3);
  } else if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    ClearWindowTilemap(GetVariableWindowId(VWIN_TOSS_HOW_MANY));
    DestroyVariableWindow(VWIN_TOSS_HOW_MANY);
    DestroyVariableWindow(VWIN_TOSS_QUANTITY);
    ScheduleBgCopyTilemapToVram(0);
    ScheduleBgCopyTilemapToVram(2);
    DestroyScrollIndicatorArrows();
    Task_AskTossMultiple(taskId);
  } else if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    DestroyVariableWindow(VWIN_TOSS_HOW_MANY);
    DestroyVariableWindow(VWIN_TOSS_QUANTITY);
    PutWindowTilemap(WIN_LIST);
    PutWindowTilemap(WIN_DESCRIPTION);
    ScheduleBgCopyTilemapToVram(0);
    ScheduleBgCopyTilemapToVram(2);
    BerryPouchSetArrowCursorFromListMenu(data[tListTaskId], 1);
    DestroyScrollIndicatorArrows();
    Task_CleanUpAndReturnToMain(taskId);
  }
}

function Task_TossYes(taskId: number): void {
  const data = gTasks[taskId].data;
  DestroyVariableWindow(VWIN_TOSS_YESNO_MSG);
  gStringVar1.set(CopySelectedListMenuItemName(data[tItemIndex]));
  gStringVar2.set(ConvertIntToDecimalStringN(data[tQuantity], STR_CONV_MODE_LEFT_ALIGN, 3));
  BerryPouchPrint(GetOrCreateVariableWindow(VWIN_THREW_AWAY), K.FONT_NORMAL, ExpandToStringVar4(text('gText_ThrewAwayStrVar2StrVar1s')), 0, 2, 1, 2, 0, 1);
  gTasks[taskId].func = Task_WaitButtonThenTossBerries;
}

function Task_WaitButtonThenTossBerries(taskId: number): void {
  const data = gTasks[taskId].data;
  if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    RemoveBagItem(SpecialVar.ItemId, data[tQuantity]);
    DestroyVariableWindow(VWIN_THREW_AWAY);
    rebuildList(taskId);
    PutWindowTilemap(WIN_DESCRIPTION);
    ScheduleBgCopyTilemapToVram(0);
    BerryPouchSetArrowCursorFromListMenu(data[tListTaskId], 1);
    Task_CleanUpAndReturnToMain(taskId);
  }
}

function Task_BerryPouch_Give(taskId: number): void {
  DestroyVariableWindow(sContextMenuNumOptions + VWIN_CONTEXT_MENU_BASE);
  DestroyVariableWindow(VWIN_SELECTED);
  PutWindowTilemap(WIN_LIST);
  PutWindowTilemap(WIN_DESCRIPTION);
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(2);
  if (CalculatePlayerPartyCount() === 0) {
    Task_Give_PrintThereIsNoPokemon(taskId);
  } else {
    R().exitCallback = CB2_ChooseMonToGiveItem;
    gTasks[taskId].func = BerryPouch_StartFadeToExitCallback;
  }
}

function Task_Give_PrintThereIsNoPokemon(taskId: number): void {
  DisplayItemMessageInBerryPouch(taskId, K.FONT_NORMAL, text('gText_ThereIsNoPokemon'), Task_WaitButtonBeforeDialogueWindowDestruction);
}

function Task_WaitButtonBeforeDialogueWindowDestruction(taskId: number): void {
  if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    Task_BerryPouch_DestroyDialogueWindowAndRefreshListMenu(taskId);
  }
}

/** Task_BerryPouch_DestroyDialogueWindowAndRefreshListMenu: close the message and rebuild the list (item_use.c uses it too). */
export function Task_BerryPouch_DestroyDialogueWindowAndRefreshListMenu(taskId: number): void {
  const data = gTasks[taskId].data;
  TryDestroyVariableWindow(VWIN_MESSAGE);
  rebuildList(taskId);
  ScheduleBgCopyTilemapToVram(0);
  BerryPouchSetArrowCursorFromListMenu(data[tListTaskId], 1);
  Task_CleanUpAndReturnToMain(taskId);
}

function Task_BerryPouch_Exit(taskId: number): void {
  DestroyVariableWindow(sContextMenuNumOptions + VWIN_CONTEXT_MENU_BASE);
  DestroyVariableWindow(VWIN_SELECTED);
  PutWindowTilemap(WIN_LIST);
  PutWindowTilemap(WIN_DESCRIPTION);
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(2);
  BerryPouchSetArrowCursorFromListMenu(gTasks[taskId].data[tListTaskId], 1);
  Task_CleanUpAndReturnToMain(taskId);
}

/**
 * IsHoldingItemAllowed (menu_helpers.c): the Enigma Berry can't be held in the Trade Center or the Union Room.
 * Neither can be entered without link play, so every berry can be held.
 */
function IsHoldingItemAllowed(_itemId: number): boolean {
  return true;
}

function Task_ContextMenu_FromPartyGiveMenu(taskId: number): void {
  const data = gTasks[taskId].data;
  const itemId = BagGetItemIdByPocketPosition(K.POCKET_BERRY_POUCH, data[tItemIndex]);
  if (!IsHoldingItemAllowed(itemId)) {
    gStringVar1.set(CopyItemName(itemId));
    DisplayItemMessageInBerryPouch(taskId, K.FONT_NORMAL, ExpandToStringVar4(text('gText_TheStrVar1CantBeHeldHere')), Task_WaitButtonBeforeDialogueWindowDestruction);
  } else {
    R().exitCallback = CB2_GiveHoldItem;
    gTasks[taskId].func = BerryPouch_StartFadeToExitCallback;
  }
}

function Task_ContextMenu_FromPokemonPC(taskId: number): void {
  R().exitCallback = CB2_ReturnToPokeStorage;
  gTasks[taskId].func = BerryPouch_StartFadeToExitCallback;
}

/** The sale price of `quantity` of the selected berry: half its price each. */
function salePrice(taskId: number, quantity: number): number {
  return Math.trunc(ItemId_GetPrice(BagGetItemIdByPocketPosition(K.POCKET_BERRY_POUCH, gTasks[taskId].data[tItemIndex])) / 2) * quantity;
}

function Task_ContextMenu_Sell(taskId: number): void {
  const data = gTasks[taskId].data;
  if (ItemId_GetPrice(SpecialVar.ItemId) === 0) {
    gStringVar1.set(CopyItemName(SpecialVar.ItemId));
    DisplayItemMessageInBerryPouch(taskId, GetDialogBoxFontId(), ExpandToStringVar4(text('gText_OhNoICantBuyThat')), Task_BerryPouch_DestroyDialogueWindowAndRefreshListMenu);
  } else {
    data[tQuantity] = 1;
    if (data[tItemCount] === 1) {
      PrintMoneyInWin2();
      Task_AskSellMultiple(taskId);
    } else {
      if (data[tItemCount] > 99) data[tItemCount] = 99;
      gStringVar1.set(CopyItemName(SpecialVar.ItemId));
      DisplayItemMessageInBerryPouch(taskId, GetDialogBoxFontId(), ExpandToStringVar4(text('gText_HowManyWouldYouLikeToSell')), Task_Sell_PrintSelectMultipleUI);
    }
  }
}

function Task_AskSellMultiple(taskId: number): void {
  const data = gTasks[taskId].data;
  gStringVar3.set(ConvertIntToDecimalStringN(salePrice(taskId, data[tQuantity]), STR_CONV_MODE_LEFT_ALIGN, 6));
  DisplayItemMessageInBerryPouch(taskId, GetDialogBoxFontId(), ExpandToStringVar4(text('gText_ICanPayThisMuch_WouldThatBeOkay')), Task_SellMultiple_CreateYesNoMenu);
}

function Task_SellMultiple_CreateYesNoMenu(taskId: number): void {
  CreateYesNoMenuWin4(taskId, sYesNoFuncs_Sell);
}

function Task_SellNo(taskId: number): void {
  const data = gTasks[taskId].data;
  DestroyVariableWindow(VWIN_MONEY);
  TryDestroyVariableWindow(VWIN_MESSAGE);
  PutWindowTilemap(WIN_TITLE);
  PutWindowTilemap(WIN_LIST);
  PutWindowTilemap(WIN_DESCRIPTION);
  ScheduleBgCopyTilemapToVram(0);
  BerryPouchSetArrowCursorFromListMenu(data[tListTaskId], 1);
  Task_CleanUpAndReturnToMain(taskId);
}

function Task_Sell_PrintSelectMultipleUI(taskId: number): void {
  const data = gTasks[taskId].data;
  const windowId = GetOrCreateVariableWindow(VWIN_SELL_QUANTITY);
  gStringVar1.set(ConvertIntToDecimalStringN(1, STR_CONV_MODE_LEADING_ZEROS, 2));
  BerryPouchPrint(windowId, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 4, 10, 1, 0, TEXT_SKIP_DRAW, 1);
  SellMultiple_UpdateSellPriceDisplay(salePrice(taskId, data[tQuantity]));
  PrintMoneyInWin2();
  CreateScrollIndicatorArrows_SellQuantity();
  gTasks[taskId].func = Task_Sell_SelectMultiple;
}

function SellMultiple_UpdateSellPriceDisplay(price: number): void {
  PrintMoneyAmount(GetVariableWindowId(VWIN_SELL_QUANTITY), 56, 10, price, 0);
}

function Task_Sell_SelectMultiple(taskId: number): void {
  const data = gTasks[taskId].data;
  if (AdjustQuantityAccordingToDPadInput(data, tQuantity, data[tItemCount]) === true) {
    PrintxQuantityOnWindow(VWIN_SELL_QUANTITY, data[tQuantity], 2);
    SellMultiple_UpdateSellPriceDisplay(salePrice(taskId, data[tQuantity]));
  } else if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    DestroyVariableWindow(VWIN_SELL_QUANTITY);
    PutWindowTilemap(WIN_LIST);
    ScheduleBgCopyTilemapToVram(0);
    DestroyScrollIndicatorArrows();
    Task_AskSellMultiple(taskId);
  } else if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    DestroyVariableWindow(VWIN_SELL_QUANTITY);
    DestroyVariableWindow(VWIN_MONEY);
    TryDestroyVariableWindow(VWIN_MESSAGE);
    PutWindowTilemap(WIN_TITLE);
    PutWindowTilemap(WIN_LIST);
    PutWindowTilemap(WIN_DESCRIPTION);
    ScheduleBgCopyTilemapToVram(0);
    DestroyScrollIndicatorArrows();
    BerryPouchSetArrowCursorFromListMenu(data[tListTaskId], 1);
    Task_CleanUpAndReturnToMain(taskId);
  }
}

function Task_SellYes(taskId: number): void {
  const data = gTasks[taskId].data;
  PutWindowTilemap(WIN_LIST);
  ScheduleBgCopyTilemapToVram(0);
  gStringVar1.set(CopyItemName(SpecialVar.ItemId));
  gStringVar3.set(ConvertIntToDecimalStringN(salePrice(taskId, data[tQuantity]), STR_CONV_MODE_LEFT_ALIGN, 6));
  DisplayItemMessageInBerryPouch(taskId, K.FONT_NORMAL, ExpandToStringVar4(text('gText_TurnedOverItemsWorthYen')), Task_SellBerries_PlaySfxAndRemoveBerries);
}

function Task_SellBerries_PlaySfxAndRemoveBerries(taskId: number): void {
  const data = gTasks[taskId].data;
  PlaySE(K.SE_SHOP);
  RemoveBagItem(SpecialVar.ItemId, data[tQuantity]);
  state.addMoney(Math.trunc(ItemId_GetPrice(SpecialVar.ItemId) / 2) * data[tQuantity]);
  RecordItemTransaction(SpecialVar.ItemId, data[tQuantity], K.QL_EVENT_SOLD_ITEM - K.QL_EVENT_USED_POKEMART);
  rebuildList(taskId);
  BerryPouchSetArrowCursorFromListMenu(data[tListTaskId], 2);
  PrintMoneyAmountInMoneyBox(GetVariableWindowId(VWIN_MONEY), state.money, 0);
  gTasks[taskId].func = Task_SellBerries_WaitButton;
}

function Task_SellBerries_WaitButton(taskId: number): void {
  if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    DestroyVariableWindow(VWIN_MONEY);
    PutWindowTilemap(WIN_TITLE);
    Task_BerryPouch_DestroyDialogueWindowAndRefreshListMenu(taskId);
  }
}

function BerryPouchInitWindows(): void {
  InitWindows(sWindowTemplates_Main);
  DeactivateAllTextPrinters();
  LoadUserWindowGfx(0, 0x001, BG_PLTT_ID(14));
  LoadMenuMessageWindowGfx(0, 0x013, BG_PLTT_ID(13));
  LoadStdWindowGfx(0, 0x00a, BG_PLTT_ID(12));
  LoadPalette(gfx16('gStandardMenuPalette'), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
  for (let i = 0; i < 3; i++) FillWindowPixelBuffer(i, 0);
  PutWindowTilemap(WIN_LIST);
  PutWindowTilemap(WIN_DESCRIPTION);
  PutWindowTilemap(WIN_TITLE);
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(2);
  sVariableWindowIds.fill(0xff);
}

function BerryPouchPrint(windowId: number, fontId: number, str: number[], x: number, y: number, letterSpacing: number, lineSpacing: number, speed: number, colorIdx: number): void {
  AddTextPrinterParameterized4(windowId, fontId, x, y, letterSpacing, lineSpacing, sTextColors[colorIdx], speed, str);
}

function GetOrCreateVariableWindow(winIdx: number): number {
  let retval = sVariableWindowIds[winIdx];
  if (retval === 0xff) {
    sVariableWindowIds[winIdx] = AddWindow(sWindowTemplates_Variable[winIdx]);
    if (winIdx === VWIN_MONEY || winIdx === VWIN_SELECTED || winIdx === VWIN_TOSS_YESNO_MSG || winIdx === VWIN_TOSS_HOW_MANY || winIdx === VWIN_THREW_AWAY) {
      DrawStdFrameWithCustomTileAndPalette(sVariableWindowIds[winIdx], false, 0x00a, 12);
    } else {
      DrawStdFrameWithCustomTileAndPalette(sVariableWindowIds[winIdx], false, 0x001, 14);
    }
    ScheduleBgCopyTilemapToVram(2);
    retval = sVariableWindowIds[winIdx];
  }
  return retval;
}

function DestroyVariableWindow(winIdx: number): void {
  ClearStdWindowAndFrameToTransparent(sVariableWindowIds[winIdx], false);
  ClearWindowTilemap(sVariableWindowIds[winIdx]);
  RemoveWindow(sVariableWindowIds[winIdx]);
  ScheduleBgCopyTilemapToVram(2);
  sVariableWindowIds[winIdx] = 0xff;
}

function TryDestroyVariableWindow(winIdx: number): void {
  if (sVariableWindowIds[winIdx] !== 0xff) {
    ClearDialogWindowAndFrameToTransparent(sVariableWindowIds[winIdx], false);
    ClearWindowTilemap(sVariableWindowIds[winIdx]);
    RemoveWindow(sVariableWindowIds[winIdx]);
    PutWindowTilemap(WIN_DESCRIPTION);
    ScheduleBgCopyTilemapToVram(0);
    ScheduleBgCopyTilemapToVram(2);
    sVariableWindowIds[winIdx] = 0xff;
  }
}

function GetVariableWindowId(winIdx: number): number {
  return sVariableWindowIds[winIdx];
}

/** DisplayItemMessageInBerryPouch: a message in the berry pouch's message box, then `followUpFunc`. */
export function DisplayItemMessageInBerryPouch(taskId: number, fontId: number, str: number[], followUpFunc: TaskFunc): void {
  if (sVariableWindowIds[VWIN_MESSAGE] === 0xff) sVariableWindowIds[VWIN_MESSAGE] = AddWindow(sWindowTemplates_Variable[VWIN_MESSAGE]);
  DisplayMessageAndContinueTask(taskId, sVariableWindowIds[VWIN_MESSAGE], 0x013, 0xd, fontId, GetTextSpeedSetting(), str, followUpFunc);
  ScheduleBgCopyTilemapToVram(2);
}

function CreateYesNoMenuWin3(taskId: number, ptrs: { yesFunc: TaskFunc; noFunc: TaskFunc }): void {
  CreateYesNoMenuWithCallbacks(taskId, sWindowTemplates_Variable[3], K.FONT_NORMAL, 0, 2, 0x001, 14, ptrs);
}

function CreateYesNoMenuWin4(taskId: number, ptrs: { yesFunc: TaskFunc; noFunc: TaskFunc }): void {
  CreateYesNoMenuWithCallbacks(taskId, sWindowTemplates_Variable[4], K.FONT_NORMAL, 0, 2, 0x001, 14, ptrs);
}

function PrintMoneyInWin2(): void {
  PrintMoneyAmountInMoneyBoxWithBorder(GetOrCreateVariableWindow(VWIN_MONEY), 0x00a, 0xc, state.money);
}

function CreateBerryPouchSprite(): void {
  sBerryPouchSpriteId = CreateSprite(sSpriteTemplate_BerryPouch(), 40, 76, 0);
}

function StartBerryPouchSpriteWobbleAnim(): void {
  const sprite = gSprites[sBerryPouchSpriteId];
  if (sprite.affineAnimEnded) {
    StartSpriteAffineAnim(sprite, 1);
    sprite.callback = SpriteCB_BerryPouchWaitWobbleAnim;
  }
}

function SpriteCB_BerryPouchWaitWobbleAnim(sprite: Sprite): void {
  if (sprite.affineAnimEnded) {
    StartSpriteAffineAnim(sprite, 0);
    sprite.callback = SpriteCallbackDummy;
  }
}

/** The berry pouch while it's open (test probe): its BERRYPOUCH_* type, task, list position and the pocket's berries. */
export function berryPouchProbe():
  | { type: number; task: string; fading: boolean; scroll: number; row: number; numItems: number; items: number[]; allowSelect: number }
  | undefined {
  if (!sResources) return undefined;
  const t = gTasks[sMainTaskId];
  return {
    type: sStaticCnt.type,
    task: t.isActive ? t.func.name : '',
    fading: gPaletteFade.active,
    scroll: sStaticCnt.listMenuScrollOffset,
    row: sStaticCnt.listMenuSelectedRow,
    numItems: sResources.listMenuNumItems,
    items: berryPocket()
      .slice(0, sResources.listMenuNumItems)
      .map((s) => s.itemId),
    allowSelect: sStaticCnt.allowSelect,
  };
}
