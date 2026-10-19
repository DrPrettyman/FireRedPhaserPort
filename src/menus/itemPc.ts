// item_pc.c: the player's PC item storage list (WITHDRAW ITEM): the PC's items with their quantities and
// descriptions, moving an item within the list (SELECT), and each item's WITHDRAW / GIVE / CANCEL menu.
// GIVE hands over to the party menu (PARTY_ACTION_GIVE_PC_ITEM), which comes back here. The quest log
// event (ItemUse_SetQuestLogEvent), the help context and SEs aren't ported.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { moveName } from '../battle/message';
import { InitBgsFromTemplates, LoadBgTiles, ResetBgsAndClearDma3BusyFlags, SetBgTilemapBuffer, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import { DISPCNT_OBJ_1D_MAP, DISPCNT_OBJ_ON, REG_OFFSET_BLDCNT, REG_OFFSET_DISPCNT, RGB_BLACK, SetGpuReg } from '../gba/hw';
import {
  DestroyListMenuTask,
  gMultiuseListMenuTemplate,
  LIST_CANCEL,
  LIST_NOTHING_CHOSEN,
  ListMenu_ProcessInput,
  ListMenuGetScrollAndRow,
  ListMenuGetYCoordForPrintingArrowCursor,
  ListMenuInit,
  ListMenuSetTemplateField,
  LISTFIELD_CURSORKIND,
  type ListMenu,
  type ListMenuItem,
} from '../gba/listMenu';
import { A_BUTTON, B_BUTTON, JOY_NEW, SELECT_BUTTON, SetMainCallback2, SetVBlankCallback, gMain, type MainCallback } from '../gba/main';
import {
  AdjustQuantityAccordingToDPadInput,
  ClearDialogWindowAndFrameToTransparent,
  ClearScheduledBgCopiesToVram,
  ClearStdWindowAndFrameToTransparent,
  DisplayMessageAndContinueTask,
  DoScheduledBgTilemapCopiesToVram,
  DrawStdFrameWithCustomTileAndPalette,
  GetTextSpeedSetting,
  GetTextWindowPalette,
  LoadMenuMessageWindowGfx,
  LoadStdWindowGfx,
  LoadUserWindowGfx,
  Menu_InitCursor,
  Menu_ProcessInputNoWrapAround,
  ResetAllBgsCoordinatesAndBgCntRegs,
  ScheduleBgCopyTilemapToVram,
  SetBgTilemapPalette,
  SetVBlankHBlankCallbacksToNull,
} from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import { AnimateSprites, BuildOamBuffer, FreeAllSpritePalettes, LoadSpritePalette, LoadSpriteSheet, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks } from '../gba/task';
import {
  AddTextPrinterParameterized,
  AddTextPrinterParameterized4,
  AddWindow,
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
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  RemoveWindow,
  type WindowTemplate,
} from '../gba/window';
import { ItemPcCompaction, RemovePCItem } from '../state/pcItems';
import {
  AddBagItem,
  CalculatePlayerPartyCount,
  ConvertIntToDecimalStringN,
  CopyItemName,
  EOS,
  ExpandToStringVar4,
  gStringVar1,
  gStringVar2,
  ItemId_GetDescription,
  ItemId_GetName,
  ItemId_GetPocket,
  STR_CONV_MODE_LEADING_ZEROS,
  STR_CONV_MODE_LEFT_ALIGN,
  STR_CONV_MODE_RIGHT_ALIGN,
  text,
} from './common';
import { MoveItemSlotInList } from './itemMenu';
import { CreateItemMenuIcon, CreateSwapLine, DestroyItemMenuIcon, gBagSwapSpritePalette, gBagSwapSpriteSheet, itemIconSymbols, ResetItemMenuIconState, SetSwapLineInvisibility, UpdateSwapLinePos } from './itemMenuIcons';
import { AddScrollIndicatorArrowPairParameterized, RemoveScrollIndicatorArrowPair } from './menuIndicators';
import { gPartyMenu, InitPartyMenu, ItemIdToBattleMoveId, Task_HandleChooseMonInput } from './partyMenu';
import { BeginPCScreenEffect_TurnOff, BeginPCScreenEffect_TurnOn, IsPCScreenEffectRunning_TurnOff, IsPCScreenEffectRunning_TurnOn } from './pcScreenEffect';
import { SetHelpContext } from '../ui/helpSystemContext';

/** struct ItemPcResources */
interface ItemPcResources {
  savedCallback: MainCallback | null;
  moveModeOrigPos: number;
  itemMenuIconSlot: number;
  maxShowed: number;
  nItems: number;
  scrollIndicatorArrowPairId: number;
  withdrawQuantitySubmenuCursorPos: number;
  data: number[];
}

/** struct ItemPcStaticResources */
const sListMenuState = {
  savedCallback: null as MainCallback | null,
  scroll: 0,
  row: 0,
  initialized: 0,
};

let sStateDataPtr: ItemPcResources | null = null;
let sBg1TilemapBuffer: Uint16Array | null = null;
let sListMenuItems: ListMenuItem[] = [];
const sSubmenuWindowIds = [0xff, 0xff, 0xff];

const S = () => sStateDataPtr!;
const pcItems = () => state.pcItems;

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 },
  { bg: 1, charBaseIndex: 3, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0 },
];

/** sItemPcSubmenuOptions */
const sItemPcSubmenuOptions: [string, (taskId: number) => void][] = [
  ['gText_Withdraw', Task_ItemPcWithdraw],
  ['gOtherText_Give', Task_ItemPcGive],
  ['gFameCheckerText_Cancel', Task_ItemPcCancel],
];

/** sTextColors: [bg, fg, shadow] */
function sTextColors(idx: number): number[] {
  return [
    [K.TEXT_COLOR_TRANSPARENT, K.TEXT_COLOR_WHITE, K.TEXT_COLOR_DARK_GRAY],
    [K.TEXT_COLOR_TRANSPARENT, K.TEXT_COLOR_DARK_GRAY, K.TEXT_COLOR_LIGHT_GRAY],
    [K.TEXT_COLOR_TRANSPARENT, K.TEXT_COLOR_LIGHT_GRAY, K.TEXT_COLOR_DARK_GRAY],
    [K.TEXT_COLOR_TRANSPARENT, K.TEXT_DYNAMIC_COLOR_1, K.TEXT_COLOR_DARK_GRAY],
  ][idx];
}

const sWindowTemplates: WindowTemplate[] = [
  { bg: 0, tilemapLeft: 7, tilemapTop: 1, width: 19, height: 12, paletteNum: 15, baseBlock: 0x02bf },
  { bg: 0, tilemapLeft: 5, tilemapTop: 14, width: 25, height: 6, paletteNum: 13, baseBlock: 0x0229 },
  { bg: 0, tilemapLeft: 1, tilemapTop: 1, width: 5, height: 4, paletteNum: 15, baseBlock: 0x0215 },
  { bg: 0, tilemapLeft: 24, tilemapTop: 15, width: 5, height: 4, paletteNum: 15, baseBlock: 0x0201 },
  { bg: 0, tilemapLeft: 22, tilemapTop: 13, width: 7, height: 6, paletteNum: 15, baseBlock: 0x01d7 },
  { bg: 0, tilemapLeft: 2, tilemapTop: 15, width: 26, height: 4, paletteNum: 11, baseBlock: 0x016f },
  DUMMY_WIN_TEMPLATE,
];

const sSubwindowTemplates: WindowTemplate[] = [
  { bg: 0, tilemapLeft: 6, tilemapTop: 15, width: 14, height: 4, paletteNum: 12, baseBlock: 0x0137 },
  { bg: 0, tilemapLeft: 6, tilemapTop: 15, width: 16, height: 4, paletteNum: 12, baseBlock: 0x0137 },
  { bg: 0, tilemapLeft: 6, tilemapTop: 15, width: 23, height: 4, paletteNum: 12, baseBlock: 0x009b },
];

/** The item PC screen's graphics, and the icons of the items in the PC (for preloading). */
export function itemPcGfxSymbols(): string[] {
  const items = pcItems()
    .filter((s) => s.itemId !== K.ITEM_NONE)
    .map((s) => s.itemId);
  return ['gItemPcTiles', 'gItemPcTilemap', 'gItemPcBgPals', 'gStandardMenuPalette', ...itemIconSymbols(items)];
}

/** ItemPc_Init: kind 0 opens the list fresh, 1 comes back to it (from the party menu). */
export function ItemPc_Init(kind: number, callback: MainCallback | null): void {
  if (kind >= 2) {
    SetMainCallback2(callback);
    return;
  }
  sStateDataPtr = {
    savedCallback: null,
    moveModeOrigPos: 0xff,
    itemMenuIconSlot: 0,
    maxShowed: 0,
    nItems: 0,
    scrollIndicatorArrowPairId: 0xff,
    withdrawQuantitySubmenuCursorPos: 0,
    data: [0, 0, 0],
  };
  if (kind !== 1) {
    sListMenuState.savedCallback = callback;
    sListMenuState.scroll = sListMenuState.row = 0;
  }
  SetMainCallback2(ItemPc_RunSetup);
}

function ItemPc_MainCB(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  DoScheduledBgTilemapCopiesToVram();
  UpdatePaletteFade();
}

function ItemPc_VBlankCB(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function ItemPc_RunSetup(): void {
  while (!ItemPc_DoGfxSetup());
}

function ItemPc_DoGfxSetup(): boolean {
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
      ItemPc_InitBgs();
      S().data[0] = 0;
      gMain.state++;
      break;
    case 8:
      if (ItemPc_LoadGraphics()) gMain.state++;
      break;
    case 9:
      ItemPc_InitWindows();
      gMain.state++;
      break;
    case 10:
      ItemPc_CountPcItems();
      ItemPc_SetCursorPosition();
      ItemPc_SetScrollPosition();
      gMain.state++;
      break;
    case 11:
      // ItemPc_AllocateResourcesForListMenu
      sListMenuItems = [];
      gMain.state++;
      break;
    case 12:
      ItemPc_BuildListMenuTemplate();
      gMain.state++;
      break;
    case 13:
      ItemPc_PrintWithdrawItem();
      gMain.state++;
      break;
    case 14:
      CreateSwapLine();
      gMain.state++;
      break;
    case 15: {
      const taskId = CreateTask(Task_ItemPcMain, 0);
      gTasks[taskId].data[0] = ListMenuInit(gMultiuseListMenuTemplate, sListMenuState.scroll, sListMenuState.row);
      gMain.state++;
      break;
    }
    case 16:
      ItemPc_PlaceTopMenuScrollIndicatorArrows();
      gMain.state++;
      break;
    case 17:
      SetHelpContext(K.HELPCONTEXT_PLAYERS_PC_ITEMS);
      gMain.state++;
      break;
    case 18:
      if (sListMenuState.initialized === 1) BlendPalettes(0xffffffff, 16, RGB_BLACK);
      gMain.state++;
      break;
    case 19:
      if (sListMenuState.initialized === 1) {
        BeginNormalPaletteFade(0xffffffff, 0, 16, 0, RGB_BLACK);
      } else {
        BeginPCScreenEffect_TurnOn(0, 0, 0);
        ItemPc_SetInitializedFlag(true);
        PlaySE(K.SE_PC_LOGIN);
      }
      gMain.state++;
      break;
    case 20:
      gMain.state++; // IsActiveOverworldLinkBusy
      break;
    default:
      SetVBlankCallback(ItemPc_VBlankCB);
      SetMainCallback2(ItemPc_MainCB);
      return true;
  }
  return false;
}

function ItemPc_InitBgs(): void {
  ResetAllBgsCoordinatesAndBgCntRegs();
  sBg1TilemapBuffer = new Uint16Array(0x400);
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sBgTemplates, sBgTemplates.length);
  SetBgTilemapBuffer(1, sBg1TilemapBuffer);
  ScheduleBgCopyTilemapToVram(1);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_1D_MAP | DISPCNT_OBJ_ON);
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  ShowBg(0);
  ShowBg(1);
}

function ItemPc_LoadGraphics(): boolean {
  const s = S();
  switch (s.data[0]) {
    case 0: {
      const tiles = gfx('gItemPcTiles'); // DecompressAndCopyTileDataToVram
      LoadBgTiles(1, tiles, tiles.length, 0);
      s.data[0]++;
      break;
    }
    case 1:
      sBg1TilemapBuffer!.set(gfx16('gItemPcTilemap').subarray(0, 0x400));
      s.data[0]++;
      break;
    case 2:
      LoadPalette(gfx16('gItemPcBgPals'), BG_PLTT_ID(0), 3 * PLTT_SIZE_4BPP);
      s.data[0]++;
      break;
    case 3:
      LoadSpriteSheet(gBagSwapSpriteSheet());
      s.data[0]++;
      break;
    default:
      LoadSpritePalette(gBagSwapSpritePalette());
      s.data[0] = 0;
      return true;
  }
  return false;
}

function ItemPc_BuildListMenuTemplate(): void {
  const s = S();
  sListMenuItems = [];
  for (let i = 0; i < s.nItems; i++) sListMenuItems.push({ label: ItemId_GetName(pcItems()[i].itemId), index: i });
  sListMenuItems.push({ label: text('gFameCheckerText_Cancel'), index: LIST_CANCEL });

  const t = gMultiuseListMenuTemplate;
  t.items = sListMenuItems;
  t.totalItems = s.nItems + 1;
  t.windowId = 0;
  t.header_X = 0;
  t.item_X = 9;
  t.cursor_X = 1;
  t.lettersSpacing = 1;
  t.itemVerticalPadding = 2;
  t.upText_Y = 2;
  t.maxShowed = s.maxShowed;
  t.fontId = K.FONT_NORMAL;
  t.cursorPal = 2;
  t.fillValue = 0;
  t.cursorShadowPal = 3;
  t.moveCursorFunc = ItemPc_MoveCursorFunc;
  t.itemPrintFunc = ItemPc_ItemPrintFunc;
  t.scrollMultiple = 0;
  t.cursorKind = 0;
}

function ItemPc_MoveCursorFunc(itemIndex: number, onInit: boolean, _list: ListMenu): void {
  const s = S();
  if (!onInit) PlaySE(K.SE_SELECT);
  if (s.moveModeOrigPos === 0xff) {
    DestroyItemMenuIcon(s.itemMenuIconSlot ^ 1);
    let desc: number[];
    if (itemIndex !== LIST_CANCEL) {
      const itemId = ItemPc_GetItemIdBySlotId(itemIndex);
      CreateItemMenuIcon(itemId, s.itemMenuIconSlot);
      if (ItemId_GetPocket(itemId) === K.POCKET_TM_CASE) desc = [...moveName(ItemIdToBattleMoveId(itemId)), EOS];
      else desc = ItemId_GetDescription(itemId);
    } else {
      CreateItemMenuIcon(K.ITEMS_COUNT, s.itemMenuIconSlot);
      desc = text('gText_ReturnToPC');
    }
    s.itemMenuIconSlot ^= 1;
    FillWindowPixelBuffer(1, 0);
    ItemPc_AddTextPrinterParameterized(1, K.FONT_NORMAL, desc, 0, 3, 2, 0, 0, 3);
  }
}

function ItemPc_ItemPrintFunc(windowId: number, itemId: number, y: number): void {
  const s = S();
  if (s.moveModeOrigPos !== 0xff) {
    if (s.moveModeOrigPos === (itemId & 0xff)) ItemPc_PrintOrRemoveCursorAt(y, 2);
    else ItemPc_PrintOrRemoveCursorAt(y, 0xff);
  }
  if (itemId !== LIST_CANCEL) {
    const quantity = ItemPc_GetItemQuantityBySlotId(itemId);
    gStringVar1.set(ConvertIntToDecimalStringN(quantity, STR_CONV_MODE_RIGHT_ALIGN, 3));
    ItemPc_AddTextPrinterParameterized(windowId, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 110, y, 0, 0, 0xff, 1);
  }
}

function ItemPc_PrintOrRemoveCursor(listMenuId: number, colorIdx: number): void {
  ItemPc_PrintOrRemoveCursorAt(ListMenuGetYCoordForPrintingArrowCursor(listMenuId), colorIdx);
}

function ItemPc_PrintOrRemoveCursorAt(y: number, colorIdx: number): void {
  if (colorIdx === 0xff) {
    const maxWidth = GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_WIDTH);
    const maxHeight = GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_HEIGHT);
    FillWindowPixelRect(0, 0, 0, y, maxWidth, maxHeight);
  } else {
    ItemPc_AddTextPrinterParameterized(0, K.FONT_NORMAL, text('gText_SelectorArrow2'), 0, y, 0, 0, 0, colorIdx);
  }
}

function ItemPc_PrintWithdrawItem(): void {
  ItemPc_AddTextPrinterParameterized(2, K.FONT_SMALL, text('gText_WithdrawItem'), 0, 1, 0, 1, 0, 0);
}

function ItemPc_PlaceTopMenuScrollIndicatorArrows(): void {
  const s = S();
  s.scrollIndicatorArrowPairId = AddScrollIndicatorArrowPairParameterized(2, 128, 8, 104, s.nItems - s.maxShowed + 1, 110, 110, () => sListMenuState.scroll);
}

function ItemPc_PlaceWithdrawQuantityScrollIndicatorArrows(): void {
  const s = S();
  s.withdrawQuantitySubmenuCursorPos = 1;
  s.scrollIndicatorArrowPairId = AddScrollIndicatorArrowPairParameterized(2, 212, 120, 152, 2, 110, 110, () => s.withdrawQuantitySubmenuCursorPos);
}

function ItemPc_RemoveScrollIndicatorArrowPair(): void {
  const s = S();
  if (s.scrollIndicatorArrowPairId !== 0xff) {
    RemoveScrollIndicatorArrowPair(s.scrollIndicatorArrowPairId);
    s.scrollIndicatorArrowPairId = 0xff;
  }
}

function ItemPc_SetCursorPosition(): void {
  const s = S();
  if (sListMenuState.scroll !== 0 && sListMenuState.scroll + s.maxShowed > s.nItems + 1) sListMenuState.scroll = s.nItems + 1 - s.maxShowed;
  if (sListMenuState.scroll + sListMenuState.row >= s.nItems + 1) {
    if (s.nItems + 1 < 2) sListMenuState.row = 0;
    else sListMenuState.row = s.nItems;
  }
}

function ItemPc_FreeResources(): void {
  sStateDataPtr = null;
  sBg1TilemapBuffer = null;
  sListMenuItems = [];
  FreeAllWindowBuffers();
}

function Task_ItemPcTurnOff1(taskId: number): void {
  if (sListMenuState.initialized === 1) {
    BeginNormalPaletteFade(0xffffffff, 0, 0, 16, RGB_BLACK);
  } else {
    BeginPCScreenEffect_TurnOff(0, 0, 0);
    PlaySE(K.SE_PC_OFF);
  }
  gTasks[taskId].func = Task_ItemPcTurnOff2;
}

function Task_ItemPcTurnOff2(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!gPaletteFade.active && !IsPCScreenEffectRunning_TurnOff()) {
    const out = { cursorPos: 0, itemsAbove: 0 };
    DestroyListMenuTask(data[0], out);
    sListMenuState.scroll = out.cursorPos;
    sListMenuState.row = out.itemsAbove;
    const s = S();
    if (s.savedCallback !== null) SetMainCallback2(s.savedCallback);
    else SetMainCallback2(sListMenuState.savedCallback);
    ItemPc_RemoveScrollIndicatorArrowPair();
    ItemPc_FreeResources();
    DestroyTask(taskId);
  }
}

function ItemPc_GetCursorPosition(): number {
  return sListMenuState.scroll + sListMenuState.row;
}

function ItemPc_GetItemIdBySlotId(idx: number): number {
  return pcItems()[idx].itemId;
}

function ItemPc_GetItemQuantityBySlotId(idx: number): number {
  return pcItems()[idx].quantity; // GetPcItemQuantity
}

function ItemPc_CountPcItems(): void {
  const s = S();
  ItemPcCompaction(pcItems(), K.ITEM_NONE);
  s.nItems = 0;
  for (let i = 0; i < K.PC_ITEMS_COUNT; s.nItems++, i++) if (pcItems()[i].itemId === K.ITEM_NONE) break;
  s.maxShowed = s.nItems + 1 <= 6 ? s.nItems + 1 : 6;
}

function ItemPc_SetScrollPosition(): void {
  const s = S();
  if (sListMenuState.row > 3) {
    for (let i = 0; i <= sListMenuState.row - 3; sListMenuState.row--, sListMenuState.scroll++, i++) {
      if (sListMenuState.scroll + s.maxShowed === s.nItems + 1) break;
    }
  }
}

function ItemPc_SetMessageWindowPalette(palIdx: number): void {
  SetBgTilemapPalette(1, 0, 14, 30, 6, palIdx + 1);
  ScheduleBgCopyTilemapToVram(1);
}

/** ItemPc_SetInitializedFlag: FALSE before the screen opens from the PC, so it turns on like a monitor. */
export function ItemPc_SetInitializedFlag(flag: boolean): void {
  sListMenuState.initialized = flag ? 1 : 0;
}

function Task_ItemPcMain(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!gPaletteFade.active && !IsPCScreenEffectRunning_TurnOn()) {
    if (JOY_NEW(SELECT_BUTTON)) {
      const { cursorPos: scroll, itemsAbove: row } = ListMenuGetScrollAndRow(data[0]);
      if (scroll + row !== S().nItems) {
        PlaySE(K.SE_SELECT);
        ItemPc_MoveItemModeInit(taskId, scroll + row);
        return;
      }
    }
    const input = ListMenu_ProcessInput(data[0]);
    const sr = ListMenuGetScrollAndRow(data[0]);
    sListMenuState.scroll = sr.cursorPos;
    sListMenuState.row = sr.itemsAbove;
    switch (input) {
      case LIST_NOTHING_CHOSEN:
        break;
      case LIST_CANCEL:
        PlaySE(K.SE_SELECT);
        ItemPc_SetInitializedFlag(false);
        gTasks[taskId].func = Task_ItemPcTurnOff1;
        break;
      default:
        PlaySE(K.SE_SELECT);
        ItemPc_SetMessageWindowPalette(1);
        ItemPc_RemoveScrollIndicatorArrowPair();
        data[1] = input;
        data[2] = ItemPc_GetItemQuantityBySlotId(input);
        ItemPc_PrintOrRemoveCursor(data[0], 2);
        gTasks[taskId].func = Task_ItemPcSubmenuInit;
        break;
    }
  }
}

function ItemPc_ReturnFromSubmenu(taskId: number): void {
  ItemPc_SetMessageWindowPalette(0);
  ItemPc_PlaceTopMenuScrollIndicatorArrows();
  gTasks[taskId].func = Task_ItemPcMain;
}

function ItemPc_MoveItemModeInit(taskId: number, pos: number): void {
  const data = gTasks[taskId].data;
  ListMenuSetTemplateField(data[0], LISTFIELD_CURSORKIND, 1);
  data[1] = pos;
  S().moveModeOrigPos = pos;
  gStringVar1.set(ItemId_GetName(ItemPc_GetItemIdBySlotId(data[1])));
  FillWindowPixelBuffer(1, 0x00);
  ItemPc_AddTextPrinterParameterized(1, K.FONT_NORMAL, ExpandToStringVar4(text('gOtherText_WhereShouldTheStrVar1BePlaced')), 0, 3, 2, 3, 0, 0);
  UpdateSwapLinePos(-32, ListMenuGetYCoordForPrintingArrowCursor(data[0]));
  SetSwapLineInvisibility(false);
  ItemPc_PrintOrRemoveCursor(data[0], 2);
  gTasks[taskId].func = Task_ItemPcMoveItemModeRun;
}

function Task_ItemPcMoveItemModeRun(taskId: number): void {
  const data = gTasks[taskId].data;
  ListMenu_ProcessInput(data[0]);
  const sr = ListMenuGetScrollAndRow(data[0]);
  sListMenuState.scroll = sr.cursorPos;
  sListMenuState.row = sr.itemsAbove;
  UpdateSwapLinePos(-32, ListMenuGetYCoordForPrintingArrowCursor(data[0]));
  if (JOY_NEW(A_BUTTON | SELECT_BUTTON)) {
    PlaySE(K.SE_SELECT);
    S().moveModeOrigPos = 0xff;
    ItemPc_InsertItemIntoNewSlot(taskId, sListMenuState.scroll + sListMenuState.row);
  } else if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    S().moveModeOrigPos = 0xff;
    ItemPc_MoveItemModeCancel(taskId, sListMenuState.scroll + sListMenuState.row);
  }
}

function destroyList(taskId: number): void {
  const out = { cursorPos: 0, itemsAbove: 0 };
  DestroyListMenuTask(gTasks[taskId].data[0], out);
  sListMenuState.scroll = out.cursorPos;
  sListMenuState.row = out.itemsAbove;
}

function ItemPc_InsertItemIntoNewSlot(taskId: number, pos: number): void {
  const data = gTasks[taskId].data;
  if (data[1] === pos || data[1] === pos - 1) {
    ItemPc_MoveItemModeCancel(taskId, pos);
  } else {
    MoveItemSlotInList(pcItems(), data[1], pos);
    destroyList(taskId);
    if (data[1] < pos) sListMenuState.row--;
    ItemPc_BuildListMenuTemplate();
    data[0] = ListMenuInit(gMultiuseListMenuTemplate, sListMenuState.scroll, sListMenuState.row);
    SetSwapLineInvisibility(true);
    gTasks[taskId].func = Task_ItemPcMain;
  }
}

function ItemPc_MoveItemModeCancel(taskId: number, pos: number): void {
  const data = gTasks[taskId].data;
  destroyList(taskId);
  if (data[1] < pos) sListMenuState.row--;
  ItemPc_BuildListMenuTemplate();
  data[0] = ListMenuInit(gMultiuseListMenuTemplate, sListMenuState.scroll, sListMenuState.row);
  SetSwapLineInvisibility(true);
  gTasks[taskId].func = Task_ItemPcMain;
}

function Task_ItemPcSubmenuInit(taskId: number): void {
  const data = gTasks[taskId].data;
  ItemPc_SetBorderStyleOnWindow(4);
  const windowId = ItemPc_GetOrCreateSubwindow(0);
  const lineHeight = GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_HEIGHT) + 2;
  // PrintTextArray(4, FONT_NORMAL, 8, 2, lineHeight, 3, sItemPcSubmenuOptions)
  sItemPcSubmenuOptions.forEach(([label], i) => AddTextPrinterParameterized(4, K.FONT_NORMAL, text(label), 8, lineHeight * i + 2, 0xff));
  CopyWindowToVram(4, COPYWIN_GFX);
  Menu_InitCursor(4, K.FONT_NORMAL, 0, 2, lineHeight, 3, 0);
  gStringVar1.set(CopyItemName(ItemPc_GetItemIdBySlotId(data[1])));
  ItemPc_AddTextPrinterParameterized(windowId, K.FONT_NORMAL, ExpandToStringVar4(text('gText_Var1IsSelected')), 0, 2, 1, 0, 0, 1);
  ScheduleBgCopyTilemapToVram(0);
  gTasks[taskId].func = Task_ItemPcSubmenuRun;
}

function Task_ItemPcSubmenuRun(taskId: number): void {
  const input = Menu_ProcessInputNoWrapAround();
  switch (input) {
    case -1: // MENU_B_PRESSED
      PlaySE(K.SE_SELECT);
      Task_ItemPcCancel(taskId);
      break;
    case -2: // MENU_NOTHING_CHOSEN
      break;
    default:
      PlaySE(K.SE_SELECT);
      sItemPcSubmenuOptions[input][1](taskId);
  }
}

function Task_ItemPcWithdraw(taskId: number): void {
  const data = gTasks[taskId].data;
  ClearStdWindowAndFrameToTransparent(4, false);
  ItemPc_DestroySubwindow(0);
  ClearWindowTilemap(4);
  data[8] = 1;
  if (ItemPc_GetItemQuantityBySlotId(data[1]) === 1) {
    PutWindowTilemap(0);
    ScheduleBgCopyTilemapToVram(0);
    ItemPc_DoWithdraw(taskId);
  } else {
    PutWindowTilemap(0);
    ItemPc_WithdrawMultipleInitWindow(data[1]);
    ItemPc_PlaceWithdrawQuantityScrollIndicatorArrows();
    gTasks[taskId].func = Task_ItemPcHandleWithdrawMultiple;
  }
}

function ItemPc_DoWithdraw(taskId: number): void {
  const data = gTasks[taskId].data;
  const itemId = ItemPc_GetItemIdBySlotId(data[1]);
  if (AddBagItem(itemId, data[8])) {
    // ItemUse_SetQuestLogEvent(QL_EVENT_WITHDREW_ITEM_PC, ...): the quest log isn't ported
    gStringVar1.set(CopyItemName(itemId));
    gStringVar2.set(ConvertIntToDecimalStringN(data[8], STR_CONV_MODE_LEFT_ALIGN, 3));
    const windowId = ItemPc_GetOrCreateSubwindow(2);
    AddTextPrinterParameterized(windowId, K.FONT_NORMAL, ExpandToStringVar4(text('gText_WithdrewQuantItem')), 0, 2, 0);
    gTasks[taskId].func = Task_ItemPcWaitButtonAndFinishWithdrawMultiple;
  } else {
    const windowId = ItemPc_GetOrCreateSubwindow(2);
    AddTextPrinterParameterized(windowId, K.FONT_NORMAL, text('gText_NoMoreRoomInBag'), 0, 2, 0);
    gTasks[taskId].func = Task_ItemPcWaitButtonWithdrawMultipleFailed;
  }
}

function Task_ItemPcWaitButtonAndFinishWithdrawMultiple(taskId: number): void {
  const data = gTasks[taskId].data;
  if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    const itemId = ItemPc_GetItemIdBySlotId(data[1]);
    RemovePCItem(pcItems(), K.ITEM_NONE, itemId, data[8]);
    ItemPcCompaction(pcItems(), K.ITEM_NONE);
    Task_ItemPcCleanUpWithdraw(taskId);
  }
}

function Task_ItemPcWaitButtonWithdrawMultipleFailed(taskId: number): void {
  if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    Task_ItemPcCleanUpWithdraw(taskId);
  }
}

function Task_ItemPcCleanUpWithdraw(taskId: number): void {
  const data = gTasks[taskId].data;
  ItemPc_DestroySubwindow(2);
  PutWindowTilemap(1);
  destroyList(taskId);
  ItemPc_CountPcItems();
  ItemPc_SetCursorPosition();
  ItemPc_BuildListMenuTemplate();
  data[0] = ListMenuInit(gMultiuseListMenuTemplate, sListMenuState.scroll, sListMenuState.row);
  ScheduleBgCopyTilemapToVram(0);
  ItemPc_ReturnFromSubmenu(taskId);
}

function ItemPc_WithdrawMultipleInitWindow(slotId: number): void {
  const itemId = ItemPc_GetItemIdBySlotId(slotId);
  gStringVar1.set(CopyItemName(itemId));
  AddTextPrinterParameterized(ItemPc_GetOrCreateSubwindow(1), K.FONT_NORMAL, ExpandToStringVar4(text('gText_WithdrawHowMany')), 0, 2, 0);
  gStringVar1.set(ConvertIntToDecimalStringN(1, STR_CONV_MODE_LEADING_ZEROS, 3));
  ItemPc_SetBorderStyleOnWindow(3);
  ItemPc_AddTextPrinterParameterized(3, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 8, 10, 1, 0, 0, 1);
  ScheduleBgCopyTilemapToVram(0);
}

function UpdateWithdrawQuantityDisplay(quantity: number): void {
  FillWindowPixelRect(3, PIXEL_FILL(1), 10, 10, 28, 12);
  gStringVar1.set(ConvertIntToDecimalStringN(quantity, STR_CONV_MODE_LEADING_ZEROS, 3));
  ItemPc_AddTextPrinterParameterized(3, K.FONT_SMALL, ExpandToStringVar4(text('gText_TimesStrVar1')), 8, 10, 1, 0, 0, 1);
}

function Task_ItemPcHandleWithdrawMultiple(taskId: number): void {
  const data = gTasks[taskId].data;
  if (AdjustQuantityAccordingToDPadInput(data, 8, data[2])) {
    UpdateWithdrawQuantityDisplay(data[8]);
  } else if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    ItemPc_DestroySubwindow(1);
    ClearWindowTilemap(3);
    PutWindowTilemap(0);
    ItemPc_PrintOrRemoveCursor(data[0], 1);
    ScheduleBgCopyTilemapToVram(0);
    ItemPc_RemoveScrollIndicatorArrowPair();
    ItemPc_DoWithdraw(taskId);
  } else if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    ClearStdWindowAndFrameToTransparent(3, false);
    ItemPc_DestroySubwindow(1);
    ClearWindowTilemap(3);
    PutWindowTilemap(0);
    PutWindowTilemap(1);
    ItemPc_PrintOrRemoveCursor(data[0], 1);
    ScheduleBgCopyTilemapToVram(0);
    ItemPc_RemoveScrollIndicatorArrowPair();
    ItemPc_ReturnFromSubmenu(taskId);
  }
}

function Task_ItemPcGive(taskId: number): void {
  if (CalculatePlayerPartyCount() === 0) {
    ClearStdWindowAndFrameToTransparent(4, false);
    ItemPc_DestroySubwindow(0);
    ClearWindowTilemap(4);
    PutWindowTilemap(0);
    ItemPc_PrintOnWindow5WithContinueTask(taskId, text('gText_ThereIsNoPokemon'), gTask_ItemPcWaitButtonAndExitSubmenu);
  } else {
    S().savedCallback = ItemPc_CB2_SwitchToPartyMenu;
    Task_ItemPcTurnOff1(taskId);
  }
}

function ItemPc_CB2_SwitchToPartyMenu(): void {
  InitPartyMenu(K.PARTY_MENU_TYPE_FIELD, K.PARTY_LAYOUT_SINGLE, K.PARTY_ACTION_GIVE_PC_ITEM, false, K.PARTY_MSG_GIVE_TO_WHICH_MON, Task_HandleChooseMonInput, ItemPc_CB2_ReturnFromPartyMenu);
  gPartyMenu.bagItem = ItemPc_GetItemIdBySlotId(ItemPc_GetCursorPosition());
}

function ItemPc_CB2_ReturnFromPartyMenu(): void {
  ItemPc_Init(1, null);
}

function gTask_ItemPcWaitButtonAndExitSubmenu(taskId: number): void {
  const data = gTasks[taskId].data;
  if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    ClearDialogWindowAndFrameToTransparent(5, false);
    ClearWindowTilemap(5);
    PutWindowTilemap(1);
    ItemPc_PrintOrRemoveCursor(data[0], 1);
    ScheduleBgCopyTilemapToVram(0);
    ItemPc_ReturnFromSubmenu(taskId);
  }
}

function Task_ItemPcCancel(taskId: number): void {
  const data = gTasks[taskId].data;
  ClearStdWindowAndFrameToTransparent(4, false);
  ItemPc_DestroySubwindow(0);
  ClearWindowTilemap(4);
  PutWindowTilemap(0);
  PutWindowTilemap(1);
  ItemPc_PrintOrRemoveCursor(data[0], 1);
  ScheduleBgCopyTilemapToVram(0);
  ItemPc_ReturnFromSubmenu(taskId);
}

function ItemPc_InitWindows(): void {
  InitWindows(sWindowTemplates);
  DeactivateAllTextPrinters();
  LoadUserWindowGfx(0, 0x3c0, BG_PLTT_ID(14));
  LoadStdWindowGfx(0, 0x3a3, BG_PLTT_ID(12));
  LoadMenuMessageWindowGfx(0, 0x3ac, BG_PLTT_ID(11));
  LoadPalette(GetTextWindowPalette(2), BG_PLTT_ID(13), PLTT_SIZE_4BPP);
  LoadPalette(gfx16('gStandardMenuPalette'), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
  for (let i = 0; i < 3; i++) {
    FillWindowPixelBuffer(i, 0x00);
    PutWindowTilemap(i);
  }
  ScheduleBgCopyTilemapToVram(0);
  sSubmenuWindowIds.fill(0xff);
}

function ItemPc_AddTextPrinterParameterized(windowId: number, fontId: number, str: number[], x: number, y: number, letterSpacing: number, lineSpacing: number, speed: number, colorIdx: number): void {
  AddTextPrinterParameterized4(windowId, fontId, x, y, letterSpacing, lineSpacing, sTextColors(colorIdx), speed, str);
}

function ItemPc_SetBorderStyleOnWindow(windowId: number): void {
  DrawStdFrameWithCustomTileAndPalette(windowId, false, 0x3c0, 14);
}

function ItemPc_GetOrCreateSubwindow(idx: number): number {
  if (sSubmenuWindowIds[idx] === 0xff) {
    sSubmenuWindowIds[idx] = AddWindow(sSubwindowTemplates[idx]);
    DrawStdFrameWithCustomTileAndPalette(sSubmenuWindowIds[idx], true, 0x3a3, 12);
  }
  return sSubmenuWindowIds[idx];
}

function ItemPc_DestroySubwindow(idx: number): void {
  ClearStdWindowAndFrameToTransparent(sSubmenuWindowIds[idx], false);
  ClearWindowTilemap(sSubmenuWindowIds[idx]); // redundant
  RemoveWindow(sSubmenuWindowIds[idx]);
  sSubmenuWindowIds[idx] = 0xff;
}

function ItemPc_PrintOnWindow5WithContinueTask(taskId: number, str: number[], taskFunc: (taskId: number) => void): void {
  DisplayMessageAndContinueTask(taskId, 5, 0x3ac, 0x0b, K.FONT_NORMAL, GetTextSpeedSetting(), str, taskFunc);
  ScheduleBgCopyTilemapToVram(0);
}

/** The item list's state (test probe): the task, the selected slot and the open submenu. */
export function itemPcProbe(): { task: string; scroll: number; row: number; nItems: number } | undefined {
  if (!sStateDataPtr) return undefined;
  let task = '';
  for (const t of gTasks) if (t.isActive && t.func.name.startsWith('Task_ItemPc')) task = t.func.name;
  return { task, scroll: sListMenuState.scroll, row: sListMenuState.row, nItems: sStateDataPtr.nItems };
}

