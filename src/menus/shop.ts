// shop.c + buy_menu_helpers.c: the Poké Mart's buy menu on the GBA layer, and the shop state the field
// side (ui/ShopMenu.ts: CreateShopMenu, Task_ShopMenu and the return to the field) shares with it.
// SELL is the bag (item_menu.c, ITEMMENULOCATION_SHOP). The quest log's transaction history (sHistory,
// RecordItemTransaction) is menus/shopQuestLog.ts. GAME_STAT_SHOPPED isn't kept.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { moveName } from '../battle/message';
import type { TilesetSymbols } from '../data/types';
import { copyToVram, FillBgTilemapBufferRect_Palette0, InitBgsFromTemplates, ResetBgsAndClearDma3BusyFlags, SetBgTilemapBuffer, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import { DISPCNT_OBJ_1D_MAP, DISPCNT_OBJ_ON, PALETTES_ALL, REG_OFFSET_BG0HOFS, REG_OFFSET_BG0VOFS, REG_OFFSET_BG1HOFS, REG_OFFSET_BG1VOFS, REG_OFFSET_BG2HOFS, REG_OFFSET_BG2VOFS, REG_OFFSET_BG3HOFS, REG_OFFSET_BG3VOFS, REG_OFFSET_BLDCNT, REG_OFFSET_DISPCNT, RGB_BLACK, SetGpuReg } from '../gba/hw';
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
import { A_BUTTON, B_BUTTON, gMain, JOY_NEW, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import {
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
  GetTextSpeedSetting,
  LoadMenuMessageWindowGfx,
  LoadStdWindowGfx,
  LoadUserWindowGfx,
  ResetTempTileDataBuffers,
  ScheduleBgCopyTilemapToVram,
  SetBgTilemapPalette,
  SetVBlankHBlankCallbacksToNull,
} from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import { AnimateSprites, BuildOamBuffer, FreeAllSpritePalettes, gSprites, ProcessSpriteCopyRequests, ResetSpriteData, SpriteCallbackDummy, StartSpriteAnim } from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks, type TaskFunc } from '../gba/task';
import {
  AddTextPrinterParameterized4,
  ClearWindowTilemap,
  COPYWIN_GFX,
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FillWindowPixelRect,
  FONTATTR_COLOR_FOREGROUND,
  FONTATTR_COLOR_SHADOW,
  FONTATTR_MAX_LETTER_HEIGHT,
  FONTATTR_MAX_LETTER_WIDTH,
  FreeAllWindowBuffers,
  GetFontAttribute,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  TEXT_SKIP_DRAW,
  type WindowTemplate,
} from '../gba/window';
import {
  BagGetQuantityByItemId,
  ConvertIntToDecimalStringN,
  CopyItemName,
  EOS,
  gStringVar1,
  gStringVar2,
  gStringVar3,
  ItemId_GetDescription,
  ItemId_GetPocket,
  ItemId_GetPrice,
  STR_CONV_MODE_LEADING_ZEROS,
  STR_CONV_MODE_LEFT_ALIGN,
  STR_CONV_MODE_RIGHT_ALIGN,
  StringExpandPlaceholders,
  strBody,
  text,
} from './common';
import { RecordItemTransaction } from './shopQuestLog';
import { CB2_ReturnToField } from './fieldCallbacks';
import { GoToBagMenu } from './itemMenu';
import { CreateItemMenuIcon, DestroyItemMenuIcon, itemIconSymbols, ResetItemMenuIconState } from './itemMenuIcons';
import { AddScrollIndicatorArrowPairParameterized, RemoveScrollIndicatorArrowPair, SCROLL_ARROW_UP } from './menuIndicators';
import { CreateObjectGraphicsSprite, GetObjectEventGraphicsInfo, objectEventGfxSymbols } from './objectEventGraphics';
import { PrintMoneyAmount, PrintMoneyAmountInMoneyBox, PrintMoneyAmountInMoneyBoxWithBorder } from './money';
import { ItemIdToBattleMoveId } from './partyMenu';

// mart types
export const MART_TYPE_REGULAR = 0;
export const MART_TYPE_TMHM = 1;
export const MART_TYPE_DECOR = 2;
export const MART_TYPE_DECOR2 = 3;

/** include/shop.h */
const INDEX_CANCEL = -2;

// sShopData.unk16_11 (the scroll arrows' task id) when there are none
const NO_SCROLL_ARROWS = 0x1f;

// Task data
const tItemCount = 1;
const tItemId = 5;
const tListTaskId = 7;

/** struct ShopData */
export const sShopData = {
  /** Called when the shop closes (ScriptContext_Enable for the mart scripts). */
  callback: null as (() => void) | null,
  itemList: [] as number[],
  itemPrice: 0,
  selectedRow: 0,
  scrollOffset: 0,
  itemCount: 0,
  itemsShowed: 0,
  maxQuantity: 0,
  martType: MART_TYPE_REGULAR,
  fontId: 0,
  itemSlot: 0,
  /** unk16_11: the scroll indicator arrow pair's task */
  scrollArrowsTask: NO_SCROLL_ARROWS,
  /** unk18: the quantity arrows' fixed scroll offset */
  quantityArrowsOffset: 0,
};

// ------------------------------------------------------------------ the field's side

/**
 * What the buy menu reads from the field (fieldmap.c, field_player_avatar.c, event_object_movement.c).
 * The overworld isn't on the GBA layer, so it provides these; it's asleep while the buy menu runs.
 */
export interface ShopFieldView {
  /** gMapHeader.mapLayout's tilesets */
  primaryTileset: TilesetSymbols;
  secondaryTileset: TilesetSymbols;
  /** GetXYCoordsOneStepInFrontOfPlayer */
  facing: { x: number; y: number };
  /** PlayerGetElevation */
  playerElevation: number;
  MapGridGetMetatileIdAt(x: number, y: number): number;
  MapGridGetMetatileLayerTypeAt(x: number, y: number): number;
  /** GetObjectEventIdByPosition, as the object it finds (graphics id, DIR_* facing) or undefined. */
  objectAt(x: number, y: number, elevation: number): { graphicsId: string; facingDirection: number } | undefined;
}

let sField: ShopFieldView | null = null;

// include/fieldmap.h
const NUM_TILES_IN_PRIMARY = 640;
const NUM_TILES_TOTAL = 1024;
const NUM_METATILES_IN_PRIMARY = 640;
const NUM_PALS_IN_PRIMARY = 7;
const NUM_PALS_TOTAL = 13;
const NUM_TILES_PER_METATILE = 8;

/** SetShopItemsForSale */
export function SetShopItemsForSale(items: number[]): void {
  sShopData.itemList = items;
  sShopData.itemCount = 0;
  if (sShopData.itemList[0] === 0) return;
  while (sShopData.itemList[sShopData.itemCount]) ++sShopData.itemCount;
}

/** GetMartTypeFromItemList */
export function GetMartTypeFromItemList(martType: number): number {
  if (martType !== MART_TYPE_REGULAR) return martType;
  for (let i = 0; i < sShopData.itemCount && sShopData.itemList[i] !== 0; i++) {
    if (ItemId_GetPocket(sShopData.itemList[i]) === K.POCKET_TM_CASE) return MART_TYPE_TMHM;
  }
  return MART_TYPE_REGULAR;
}

/** CB2_GoToSellMenu: the bag in its shop mode. gFieldCallback = MapPostLoadHook_ReturnToShopMenu is the field's part. */
export function CB2_GoToSellMenu(): void {
  GoToBagMenu(K.ITEMMENULOCATION_SHOP, K.OPEN_BAG_LAST, CB2_ReturnToField);
}

/** GetMartFontId */
export function GetMartFontId(): number {
  return sShopData.fontId;
}

/** Graphics the buy menu loads for this field view and shop (preloaded by the host scene). */
export function buyMenuGfxSymbols(view: ShopFieldView): string[] {
  const syms = new Set<string>(['gBuyMenuFrame_Gfx', 'gBuyMenuFrame_Tilemap', 'gBuyMenuFrame_TmHmTilemap', 'gBuyMenuFrame_Pal']);
  for (const t of [view.primaryTileset, view.secondaryTileset]) syms.add(t.tiles).add(t.palettes).add(t.metatiles);
  for (const s of itemIconSymbols(sShopData.itemList.slice(0, sShopData.itemCount))) syms.add(s);
  const ids = viewportObjectEvents(view).map((o) => o.graphicsId);
  for (const s of objectEventGfxSymbols(ids)) syms.add(s);
  return [...syms];
}

/**
 * What the overworld leaves in VRAM for the buy menu's map view: CopyMapTilesetsToVram and
 * LoadMapTilesetPalettes (fieldmap.c). The buy menu doesn't reload either; it draws the map with the
 * field's tiles at BG char base 0 and palettes 0-12.
 */
export function LoadFieldTilesetsForShop(view: ShopFieldView): void {
  sField = view;
  const primary = gfx(view.primaryTileset.tiles);
  copyToVram(primary, 0, Math.min(primary.length, NUM_TILES_IN_PRIMARY * 32));
  const secondary = gfx(view.secondaryTileset.tiles);
  copyToVram(secondary, NUM_TILES_IN_PRIMARY * 32, Math.min(secondary.length, (NUM_TILES_TOTAL - NUM_TILES_IN_PRIMARY) * 32));
  // LoadTilesetPalette: the primary's first colour is forced to black
  const primaryPals = gfx16(view.primaryTileset.palettes);
  LoadPalette([0], BG_PLTT_ID(0), 2);
  LoadPalette(primaryPals.subarray(1), BG_PLTT_ID(0) + 1, NUM_PALS_IN_PRIMARY * PLTT_SIZE_4BPP - 2);
  const secondaryPals = gfx16(view.secondaryTileset.palettes);
  LoadPalette(secondaryPals.subarray(NUM_PALS_IN_PRIMARY * 16), BG_PLTT_ID(NUM_PALS_IN_PRIMARY), (NUM_PALS_TOTAL - NUM_PALS_IN_PRIMARY) * PLTT_SIZE_4BPP);
}

// ------------------------------------------------------------------ buy_menu_helpers.c

const win = (tilemapLeft: number, tilemapTop: number, width: number, height: number, paletteNum: number, baseBlock: number): WindowTemplate => ({
  bg: 0,
  tilemapLeft,
  tilemapTop,
  width,
  height,
  paletteNum,
  baseBlock,
});

const sShopBuyMenuWindowTemplatesNormal: WindowTemplate[] = [
  win(1, 1, 8, 3, 15, 0x27),
  win(1, 11, 13, 2, 15, 0x3f),
  win(2, 15, 26, 4, 14, 0x59),
  win(17, 9, 12, 4, 14, 0xc1),
  win(11, 1, 17, 12, 14, 0xf1),
  win(5, 14, 25, 6, 15, 0x1bd),
  DUMMY_WIN_TEMPLATE,
];

// firered uses different layout when selling TMs
const sShopBuyMenuWindowTemplatesTM: WindowTemplate[] = [
  win(1, 1, 8, 3, 15, 0x27),
  win(1, 11, 13, 2, 15, 0x3f),
  win(2, 15, 26, 4, 14, 0x59),
  win(17, 9, 12, 4, 14, 0xc1),
  win(11, 1, 17, 10, 14, 0xf1),
  win(12, 12, 18, 8, 14, 0x19b),
  win(1, 14, 10, 4, 14, 0x22b),
  DUMMY_WIN_TEMPLATE,
];

const sShopBuyMenuYesNoWindowTemplate = win(21, 9, 6, 4, 14, 0xc1);

const sShopBuyMenuTextColors = [
  [0, 1, 2],
  [0, 2, 3],
  [0, 3, 2],
];

function BuyMenuInitWindows(isSellingTM: boolean): void {
  if (isSellingTM !== true) InitWindows(sShopBuyMenuWindowTemplatesNormal);
  else InitWindows(sShopBuyMenuWindowTemplatesTM);
  DeactivateAllTextPrinters();
  LoadUserWindowGfx(0, 0x1, BG_PLTT_ID(13));
  LoadMenuMessageWindowGfx(0, 0x13, BG_PLTT_ID(14));
  LoadStdWindowGfx(0, 0xa, BG_PLTT_ID(15));
  PutWindowTilemap(0);
  PutWindowTilemap(4);
  PutWindowTilemap(5);
  if (isSellingTM === true) PutWindowTilemap(6);
}

function BuyMenuDrawMoneyBox(): void {
  PrintMoneyAmountInMoneyBoxWithBorder(0, 0xa, 0xf, state.money);
}

function BuyMenuPrint(windowId: number, font: number, str: number[], x: number, y: number, letterSpacing: number, lineSpacing: number, speed: number, color: number): void {
  AddTextPrinterParameterized4(windowId, font, x, y, letterSpacing, lineSpacing, sShopBuyMenuTextColors[color], speed, str);
}

function BuyMenuDisplayMessage(taskId: number, str: number[], callback: TaskFunc): void {
  DisplayMessageAndContinueTask(taskId, 2, 0x13, 0xe, GetMartFontId(), GetTextSpeedSetting(), str, callback);
  ScheduleBgCopyTilemapToVram(0);
}

function BuyMenuQuantityBoxNormalBorder(windowId: number, copyToVram: boolean): void {
  DrawStdFrameWithCustomTileAndPalette(windowId, copyToVram, 0x1, 13);
}

function BuyMenuQuantityBoxThinBorder(windowId: number, copyToVram: boolean): void {
  DrawStdFrameWithCustomTileAndPalette(windowId, copyToVram, 0xa, 15);
}

function BuyMenuConfirmPurchase(taskId: number, yesNo: { yesFunc: TaskFunc; noFunc: TaskFunc }): void {
  CreateYesNoMenuWithCallbacks(taskId, sShopBuyMenuYesNoWindowTemplate, K.FONT_NORMAL, 0, 2, 1, 13, yesNo);
}

// ------------------------------------------------------------------ shop.c: the buy menu

const sShopMenuActions_BuyQuit = { yesFunc: BuyMenuTryMakePurchase, noFunc: BuyMenuReturnToItemList };

const bgTemplate = (bg: number, charBaseIndex: number, mapBaseIndex: number, priority: number): BgTemplate => ({
  bg,
  charBaseIndex,
  mapBaseIndex,
  screenSize: 0,
  paletteMode: 0,
  priority,
  baseTile: 0,
});

const sShopBuyMenuBgTemplates: BgTemplate[] = [bgTemplate(0, 2, 31, 0), bgTemplate(1, 0, 30, 1), bgTemplate(2, 0, 29, 2), bgTemplate(3, 0, 28, 3)];

/** gShopTilemapBuffer1..4: the frame's tilemap, and BG1, BG3 and BG2's tilemaps. */
let gShopTilemapBuffer1 = new Uint16Array(0x400);
let gShopTilemapBuffer2 = new Uint16Array(0x400);
let gShopTilemapBuffer3 = new Uint16Array(0x400);
let gShopTilemapBuffer4 = new Uint16Array(0x400);

let sShopMenuListMenu: ListMenuItem[] = [];

export function CB2_BuyMenu(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
  DoScheduledBgTilemapCopiesToVram();
}

function VBlankCB_BuyMenu(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/** CB2_InitBuyMenu. The field's tilesets must already be in VRAM (LoadFieldTilesetsForShop). */
export function CB2_InitBuyMenu(): void {
  switch (gMain.state) {
    case 0:
      SetVBlankHBlankCallbacksToNull();
      // CpuFastFill(0, OAM): ResetSpriteData below clears the OAM buffer the PPU reads
      ScanlineEffect_Stop();
      ResetTempTileDataBuffers();
      FreeAllSpritePalettes();
      ResetPaletteFade();
      ResetSpriteData();
      ResetTasks();
      ClearScheduledBgCopiesToVram();
      ResetItemMenuIconState();
      if (!InitShopData() || !BuyMenuBuildListMenuTemplate()) return;
      BuyMenuInitBgs();
      FillBgTilemapBufferRect_Palette0(0, 0, 0, 0, 0x20, 0x20);
      FillBgTilemapBufferRect_Palette0(1, 0, 0, 0, 0x20, 0x20);
      FillBgTilemapBufferRect_Palette0(2, 0, 0, 0, 0x20, 0x20);
      FillBgTilemapBufferRect_Palette0(3, 0, 0, 0, 0x20, 0x20);
      BuyMenuInitWindows(sShopData.martType === MART_TYPE_TMHM);
      BuyMenuDecompressBgGraphics();
      gMain.state++;
      break;
    case 1:
      if (FreeTempTileDataBuffersIfPossible()) return;
      gMain.state++;
      break;
    default: {
      sShopData.selectedRow = 0;
      sShopData.scrollOffset = 0;
      BuyMenuDrawGraphics();
      BuyMenuAddScrollIndicatorArrows();
      const taskId = CreateTask(Task_BuyMenu, 8);
      gTasks[taskId].data[tListTaskId] = ListMenuInit(gMultiuseListMenuTemplate, 0, 0);
      BlendPalettes(PALETTES_ALL, 0x10, RGB_BLACK);
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0x10, 0, RGB_BLACK);
      SetVBlankCallback(VBlankCB_BuyMenu);
      SetMainCallback2(CB2_BuyMenu);
      break;
    }
  }
}

/** InitShopData: the four tilemap buffers (allocation can't fail here). */
function InitShopData(): boolean {
  gShopTilemapBuffer1 = new Uint16Array(0x400);
  gShopTilemapBuffer2 = new Uint16Array(0x400);
  gShopTilemapBuffer3 = new Uint16Array(0x400);
  gShopTilemapBuffer4 = new Uint16Array(0x400);
  return true;
}

function BuyMenuInitBgs(): void {
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sShopBuyMenuBgTemplates, sShopBuyMenuBgTemplates.length);
  SetBgTilemapBuffer(1, gShopTilemapBuffer2);
  SetBgTilemapBuffer(2, gShopTilemapBuffer4);
  SetBgTilemapBuffer(3, gShopTilemapBuffer3);
  SetGpuReg(REG_OFFSET_BG0HOFS, 0);
  SetGpuReg(REG_OFFSET_BG0VOFS, 0);
  SetGpuReg(REG_OFFSET_BG1HOFS, 0);
  SetGpuReg(REG_OFFSET_BG1VOFS, 0);
  SetGpuReg(REG_OFFSET_BG2HOFS, 0);
  SetGpuReg(REG_OFFSET_BG2VOFS, 0);
  SetGpuReg(REG_OFFSET_BG3HOFS, 0);
  SetGpuReg(REG_OFFSET_BG3VOFS, 0);
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_OBJ_ON | DISPCNT_OBJ_1D_MAP);
  ShowBg(0);
  ShowBg(1);
  ShowBg(2);
  ShowBg(3);
}

function BuyMenuDecompressBgGraphics(): void {
  DecompressAndCopyTileDataToVram(1, gfx('gBuyMenuFrame_Gfx'), 0x480, 0x3dc, 0);
  const tilemap = gfx16(sShopData.martType !== MART_TYPE_TMHM ? 'gBuyMenuFrame_Tilemap' : 'gBuyMenuFrame_TmHmTilemap');
  gShopTilemapBuffer1.set(tilemap.subarray(0, 0x400));
  const pal = gfx16('gBuyMenuFrame_Pal');
  LoadPalette(pal.subarray(0, 16), BG_PLTT_ID(11), PLTT_SIZE_4BPP);
  LoadPalette(pal.subarray(16, 32), BG_PLTT_ID(6), PLTT_SIZE_4BPP);
}

function RecolorItemDescriptionBox(a0: boolean): void {
  const paletteNum = a0 === false ? 0xb : 0x6;
  if (sShopData.martType !== MART_TYPE_TMHM) SetBgTilemapPalette(1, 0, 14, 30, 6, paletteNum);
  else SetBgTilemapPalette(1, 0, 12, 30, 8, paletteNum);
  ScheduleBgCopyTilemapToVram(1);
}

function BuyMenuDrawGraphics(): void {
  BuyMenuDrawMapView();
  BuyMenuCopyTilemapData();
  BuyMenuDrawMoneyBox();
  ScheduleBgCopyTilemapToVram(0);
  ScheduleBgCopyTilemapToVram(1);
  ScheduleBgCopyTilemapToVram(2);
  ScheduleBgCopyTilemapToVram(3);
}

function BuyMenuBuildListMenuTemplate(): boolean {
  sShopMenuListMenu = [];
  for (let i = 0; i < sShopData.itemCount; i++) sShopMenuListMenu.push(PokeMartWriteNameAndIdAt(sShopData.itemList[i]));
  sShopMenuListMenu.push({ label: text('gFameCheckerText_Cancel'), index: INDEX_CANCEL });
  const t = gMultiuseListMenuTemplate;
  t.items = sShopMenuListMenu;
  t.totalItems = sShopData.itemCount + 1;
  t.windowId = 4;
  t.header_X = 0;
  t.item_X = 9;
  t.cursor_X = 1;
  t.lettersSpacing = 0;
  t.itemVerticalPadding = 2;
  t.upText_Y = 2;
  t.fontId = K.FONT_NORMAL;
  t.fillValue = 0;
  t.cursorPal = GetFontAttribute(K.FONT_NORMAL, FONTATTR_COLOR_FOREGROUND);
  t.cursorShadowPal = GetFontAttribute(K.FONT_NORMAL, FONTATTR_COLOR_SHADOW);
  t.moveCursorFunc = BuyMenuPrintItemDescriptionAndShowItemIcon;
  t.itemPrintFunc = BuyMenuPrintPriceInList;
  t.scrollMultiple = 0;
  t.cursorKind = 0;

  const v = sShopData.martType === MART_TYPE_TMHM ? 5 : 6;
  t.maxShowed = sShopData.itemCount + 1 > v ? v : sShopData.itemCount + 1;
  sShopData.itemsShowed = t.maxShowed;
  return true;
}

function PokeMartWriteNameAndIdAt(index: number): ListMenuItem {
  return { label: CopyItemName(index), index };
}

function BuyMenuPrintItemDescriptionAndShowItemIcon(item: number, onInit: boolean, _list: ListMenu): void {
  if (onInit !== true) PlaySE(K.SE_SELECT);
  const description = item !== INDEX_CANCEL ? ItemId_GetDescription(item) : text('gText_QuitShopping');
  FillWindowPixelBuffer(5, PIXEL_FILL(0));
  if (sShopData.martType !== MART_TYPE_TMHM) {
    DestroyItemMenuIcon(sShopData.itemSlot ^ 1);
    if (item !== INDEX_CANCEL) CreateItemMenuIcon(item, sShopData.itemSlot);
    else CreateItemMenuIcon(K.ITEMS_COUNT, sShopData.itemSlot);
    sShopData.itemSlot ^= 1;
    BuyMenuPrint(5, K.FONT_NORMAL, description, 0, 3, 2, 1, 0, 0);
  } else {
    // TM Mart
    FillWindowPixelBuffer(6, PIXEL_FILL(0));
    LoadTmHmNameInMart(item);
    BuyMenuPrint(5, K.FONT_NORMAL, description, 2, 3, 1, 0, 0, 0);
  }
}

function BuyMenuPrintPriceInList(windowId: number, item: number, y: number): void {
  if (item !== INDEX_CANCEL) {
    gStringVar1.set(ConvertIntToDecimalStringN(ItemId_GetPrice(item), STR_CONV_MODE_LEFT_ALIGN, 4));
    // Left-pad to 4 digits with character 0 (a space)
    const x = 4 - gStringVar1.get().length;
    const str = [...new Array<number>(x).fill(0), ...StringExpandPlaceholders(text('gText_PokedollarVar1'))];
    BuyMenuPrint(windowId, K.FONT_SMALL, str, 0x69, y, 0, 0, TEXT_SKIP_DRAW, 1);
  }
}

function LoadTmHmNameInMart(item: number): void {
  if (item !== INDEX_CANCEL) {
    gStringVar1.set(ConvertIntToDecimalStringN(item - K.ITEM_DEVON_SCOPE, STR_CONV_MODE_LEADING_ZEROS, 2));
    // StringCopy(gStringVar4, gText_NumberClear01) + StringAppend(gStringVar4, gStringVar1)
    BuyMenuPrint(6, K.FONT_SMALL, [...strBody(text('gText_NumberClear01')), ...gStringVar1.get(), EOS], 0, 0, 0, 0, TEXT_SKIP_DRAW, 1);
    BuyMenuPrint(6, K.FONT_NORMAL, moveName(ItemIdToBattleMoveId(item)), 0, 0x10, 0, 0, 0, 1);
  } else {
    BuyMenuPrint(6, K.FONT_SMALL, text('gText_ThreeHyphens'), 0, 0, 0, 0, TEXT_SKIP_DRAW, 1);
    BuyMenuPrint(6, K.FONT_NORMAL, text('gText_SevenHyphens'), 0, 0x10, 0, 0, 0, 1);
  }
}

function BuyMenuPrintCursor(listTaskId: number, a1: number): void {
  BuyMenuPrintCursorAtYPosition(ListMenuGetYCoordForPrintingArrowCursor(listTaskId), a1);
}

function BuyMenuPrintCursorAtYPosition(y: number, a1: number): void {
  if (a1 === 0xff) {
    FillWindowPixelRect(4, 0, 1, y, GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_WIDTH), GetFontAttribute(K.FONT_NORMAL, FONTATTR_MAX_LETTER_HEIGHT));
    CopyWindowToVram(4, COPYWIN_GFX);
  } else {
    BuyMenuPrint(4, K.FONT_NORMAL, text('gText_SelectorArrow2'), 1, y, 0, 0, 0, a1);
  }
}

function BuyMenuFreeMemory(): void {
  sShopMenuListMenu = [];
  FreeAllWindowBuffers();
}

function BuyMenuAddScrollIndicatorArrows(): void {
  const fullyDown = sShopData.itemCount - sShopData.itemsShowed + 1;
  const bottomY = sShopData.martType !== MART_TYPE_TMHM ? 104 : 88;
  sShopData.scrollArrowsTask = AddScrollIndicatorArrowPairParameterized(SCROLL_ARROW_UP, 160, 8, bottomY, fullyDown, 110, 110, () => sShopData.scrollOffset);
}

function BuyQuantityAddScrollIndicatorArrows(): void {
  sShopData.quantityArrowsOffset = 1;
  sShopData.scrollArrowsTask = AddScrollIndicatorArrowPairParameterized(SCROLL_ARROW_UP, 0x98, 0x48, 0x68, 2, 0x6e, 0x6e, () => sShopData.quantityArrowsOffset);
}

function BuyMenuRemoveScrollIndicatorArrows(): void {
  if (sShopData.scrollArrowsTask === NO_SCROLL_ARROWS) return;
  RemoveScrollIndicatorArrowPair(sShopData.scrollArrowsTask);
  sShopData.scrollArrowsTask = NO_SCROLL_ARROWS;
}

function BuyMenuDrawMapView(): void {
  BuyMenuCollectObjectEventData();
  BuyMenuDrawObjectEvents();
  BuyMenuDrawMapBg();
}

function BuyMenuDrawMapBg(): void {
  const field = sField!;
  const primary = gfx16(field.primaryTileset.metatiles);
  const secondary = gfx16(field.secondaryTileset.metatiles);
  const x = field.facing.x - 2;
  const y = field.facing.y - 3;
  for (let j = 0; j < 10; j++) {
    for (let i = 0; i < 5; i++) {
      const metatile = field.MapGridGetMetatileIdAt(x + i, y + j);
      const metatileLayerType = field.MapGridGetMetatileLayerTypeAt(x + i, y + j);
      if (metatile < NUM_METATILES_IN_PRIMARY) BuyMenuDrawMapMetatile(i, j, primary.subarray(metatile * NUM_TILES_PER_METATILE), metatileLayerType);
      else BuyMenuDrawMapMetatile(i, j, secondary.subarray((metatile - NUM_METATILES_IN_PRIMARY) * NUM_TILES_PER_METATILE), metatileLayerType);
    }
  }
}

// global.fieldmap.h
const METATILE_LAYER_TYPE_NORMAL = 0;
const METATILE_LAYER_TYPE_COVERED = 1;
const METATILE_LAYER_TYPE_SPLIT = 2;

function BuyMenuDrawMapMetatile(x: number, y: number, src: Uint16Array, metatileLayerType: number): void {
  const offset1 = x * 2;
  const offset2 = y * 64 + 64;
  switch (metatileLayerType) {
    case METATILE_LAYER_TYPE_NORMAL:
      BuyMenuDrawMapMetatileLayer(gShopTilemapBuffer4, offset1, offset2, src);
      BuyMenuDrawMapMetatileLayer(gShopTilemapBuffer2, offset1, offset2, src.subarray(4));
      break;
    case METATILE_LAYER_TYPE_COVERED:
      BuyMenuDrawMapMetatileLayer(gShopTilemapBuffer3, offset1, offset2, src);
      BuyMenuDrawMapMetatileLayer(gShopTilemapBuffer4, offset1, offset2, src.subarray(4));
      break;
    case METATILE_LAYER_TYPE_SPLIT:
      BuyMenuDrawMapMetatileLayer(gShopTilemapBuffer3, offset1, offset2, src);
      BuyMenuDrawMapMetatileLayer(gShopTilemapBuffer2, offset1, offset2, src.subarray(4));
      break;
  }
}

function BuyMenuDrawMapMetatileLayer(dest: Uint16Array, offset1: number, offset2: number, src: Uint16Array): void {
  dest[offset1 + offset2] = src[0]; // top left
  dest[offset1 + offset2 + 1] = src[1]; // top right
  dest[offset1 + offset2 + 32] = src[2]; // bottom left
  dest[offset1 + offset2 + 33] = src[3]; // bottom right
}

interface ViewportObjectEvent {
  graphicsId: string;
  x: number;
  y: number;
  animNum: number;
}

/** sViewportObjectEvents */
let sViewportObjectEvents: ViewportObjectEvent[] = [];

/** The objects in the 7x5 tiles around the tile in front of the player, as BuyMenuCollectObjectEventData finds them. */
function viewportObjectEvents(field: ShopFieldView): ViewportObjectEvent[] {
  const out: ViewportObjectEvent[] = [];
  const { x: facingX, y: facingY } = field.facing;
  const elevation = field.playerElevation;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 7; x++) {
      const obj = field.objectAt(facingX - 3 + x, facingY - 2 + y, elevation);
      if (!obj) continue;
      let animNum: number;
      switch (obj.facingDirection) {
        case K.DIR_SOUTH:
          animNum = 0;
          break;
        case K.DIR_NORTH:
          animNum = 1;
          break;
        case K.DIR_WEST:
          animNum = 2;
          break;
        case K.DIR_EAST:
        default:
          animNum = 3;
          break;
      }
      out.push({ graphicsId: obj.graphicsId, x, y, animNum });
    }
  }
  return out;
}

function BuyMenuCollectObjectEventData(): void {
  sViewportObjectEvents = viewportObjectEvents(sField!);
}

function BuyMenuDrawObjectEvents(): void {
  for (const o of sViewportObjectEvents) {
    const graphicsInfo = GetObjectEventGraphicsInfo(o.graphicsId);
    const spriteId = CreateObjectGraphicsSprite(o.graphicsId, SpriteCallbackDummy, o.x * 16 - 8, o.y * 16 + 48 - graphicsInfo.frameHeight / 2, 2);
    // An inanimate object's table has one anim; the C would read past it for one not facing south.
    const sprite = gSprites[spriteId];
    StartSpriteAnim(sprite, o.animNum < sprite.anims.length ? o.animNum : 0);
  }
}

function BuyMenuCopyTilemapData(): void {
  const dst = gShopTilemapBuffer2;
  const src = gShopTilemapBuffer1;
  for (let i = 0; i < 0x400; i++) {
    if (src[i] === 0) continue;
    dst[i] = (src[i] + 0xb3dc) & 0xffff;
  }
}

function BuyMenuPrintItemQuantityAndPrice(taskId: number): void {
  const data = gTasks[taskId].data;
  FillWindowPixelBuffer(3, PIXEL_FILL(1));
  PrintMoneyAmount(3, 0x36, 0xa, sShopData.itemPrice, TEXT_SKIP_DRAW);
  gStringVar1.set(ConvertIntToDecimalStringN(data[tItemCount], STR_CONV_MODE_LEADING_ZEROS, 2));
  BuyMenuPrint(3, K.FONT_SMALL, StringExpandPlaceholders(text('gText_TimesStrVar1')), 2, 0xa, 0, 0, 0, 1);
}

function Task_BuyMenu(taskId: number): void {
  const data = gTasks[taskId].data;
  if (gPaletteFade.active) return;
  const itemId = ListMenu_ProcessInput(data[tListTaskId]);
  const { cursorPos, itemsAbove } = ListMenuGetScrollAndRow(data[tListTaskId]);
  sShopData.scrollOffset = cursorPos;
  sShopData.selectedRow = itemsAbove;
  switch (itemId) {
    case LIST_NOTHING_CHOSEN:
      break;
    case LIST_CANCEL:
      PlaySE(K.SE_SELECT);
      ExitBuyMenu(taskId);
      break;
    default:
      PlaySE(K.SE_SELECT);
      data[tItemId] = itemId;
      ClearWindowTilemap(5);
      BuyMenuRemoveScrollIndicatorArrows();
      BuyMenuPrintCursor(data[tListTaskId], 2);
      RecolorItemDescriptionBox(true);
      sShopData.itemPrice = ItemId_GetPrice(itemId);
      if (state.money < sShopData.itemPrice) {
        // !IsEnoughMoney
        BuyMenuDisplayMessage(taskId, text('gText_YouDontHaveMoney'), BuyMenuReturnToItemList);
      } else {
        gStringVar1.set(CopyItemName(itemId));
        BuyMenuDisplayMessage(taskId, text('gText_Var1CertainlyHowMany'), Task_BuyHowManyDialogueInit);
      }
      break;
  }
}

function Task_BuyHowManyDialogueInit(taskId: number): void {
  const data = gTasks[taskId].data;
  const quantityInBag = BagGetQuantityByItemId(data[tItemId]);
  BuyMenuQuantityBoxThinBorder(1, false);
  gStringVar1.set(ConvertIntToDecimalStringN(quantityInBag, STR_CONV_MODE_RIGHT_ALIGN, 3));
  BuyMenuPrint(1, K.FONT_NORMAL, StringExpandPlaceholders(text('gText_InBagVar1')), 0, 2, 0, 0, 0, 1);
  data[tItemCount] = 1;
  BuyMenuQuantityBoxNormalBorder(3, false);
  BuyMenuPrintItemQuantityAndPrice(taskId);
  ScheduleBgCopyTilemapToVram(0);
  // u16 maxQuantity: the cap compares the truncated quotient
  const maxQuantity = Math.trunc(state.money / ItemId_GetPrice(data[tItemId])) & 0xffff;
  sShopData.maxQuantity = maxQuantity > 99 ? 99 : maxQuantity & 0xff;
  if (maxQuantity !== 1) BuyQuantityAddScrollIndicatorArrows();
  gTasks[taskId].func = Task_BuyHowManyDialogueHandleInput;
}

function Task_BuyHowManyDialogueHandleInput(taskId: number): void {
  const data = gTasks[taskId].data;
  if (AdjustQuantityAccordingToDPadInput(data, tItemCount, sShopData.maxQuantity) === true) {
    sShopData.itemPrice = ItemId_GetPrice(data[tItemId]) * data[tItemCount];
    BuyMenuPrintItemQuantityAndPrice(taskId);
  } else if (JOY_NEW(A_BUTTON)) {
    PlaySE(K.SE_SELECT);
    BuyMenuRemoveScrollIndicatorArrows();
    ClearStdWindowAndFrameToTransparent(3, false);
    ClearStdWindowAndFrameToTransparent(1, false);
    ClearWindowTilemap(3);
    ClearWindowTilemap(1);
    PutWindowTilemap(4);
    gStringVar1.set(CopyItemName(data[tItemId]));
    gStringVar2.set(ConvertIntToDecimalStringN(data[tItemCount], STR_CONV_MODE_LEFT_ALIGN, 2));
    gStringVar3.set(ConvertIntToDecimalStringN(sShopData.itemPrice, STR_CONV_MODE_LEFT_ALIGN, 8));
    BuyMenuDisplayMessage(taskId, text('gText_Var1AndYouWantedVar2'), CreateBuyMenuConfirmPurchaseWindow);
  } else if (JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    BuyMenuRemoveScrollIndicatorArrows();
    ClearStdWindowAndFrameToTransparent(3, false);
    ClearStdWindowAndFrameToTransparent(1, false);
    ClearWindowTilemap(3);
    ClearWindowTilemap(1);
    BuyMenuReturnToItemList(taskId);
  }
}

function CreateBuyMenuConfirmPurchaseWindow(taskId: number): void {
  BuyMenuConfirmPurchase(taskId, sShopMenuActions_BuyQuit);
}

function BuyMenuTryMakePurchase(taskId: number): void {
  const data = gTasks[taskId].data;
  PutWindowTilemap(4);
  if (state.bag.add(data[tItemId], data[tItemCount])) {
    BuyMenuDisplayMessage(taskId, text('gText_HereYouGoThankYou'), BuyMenuSubtractMoney);
    RecordItemTransaction(data[tItemId], data[tItemCount], K.QL_EVENT_BOUGHT_ITEM - K.QL_EVENT_USED_POKEMART);
  } else {
    BuyMenuDisplayMessage(taskId, text('gText_NoMoreRoomForThis'), BuyMenuReturnToItemList);
  }
}

function BuyMenuSubtractMoney(taskId: number): void {
  state.incrementGameStat(K.GAME_STAT_SHOPPED);
  state.removeMoney(sShopData.itemPrice);
  PlaySE(K.SE_SHOP);
  PrintMoneyAmountInMoneyBox(0, state.money, 0);
  gTasks[taskId].func = Task_ReturnToItemListAfterItemPurchase;
}

function Task_ReturnToItemListAfterItemPurchase(taskId: number): void {
  if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
    PlaySE(K.SE_SELECT);
    BuyMenuReturnToItemList(taskId);
  }
}

function BuyMenuReturnToItemList(taskId: number): void {
  const data = gTasks[taskId].data;
  ClearDialogWindowAndFrameToTransparent(2, false);
  BuyMenuPrintCursor(data[tListTaskId], 1);
  RecolorItemDescriptionBox(false);
  PutWindowTilemap(4);
  PutWindowTilemap(5);
  if (sShopData.martType === MART_TYPE_TMHM) PutWindowTilemap(6);
  ScheduleBgCopyTilemapToVram(0);
  BuyMenuAddScrollIndicatorArrows();
  gTasks[taskId].func = Task_BuyMenu;
}

/** ExitBuyMenu: gFieldCallback = MapPostLoadHook_ReturnToShopMenu, which the field's shop menu runs on return. */
function ExitBuyMenu(taskId: number): void {
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
  gTasks[taskId].func = Task_ExitBuyMenu;
}

function Task_ExitBuyMenu(taskId: number): void {
  const data = gTasks[taskId].data;
  if (!gPaletteFade.active) {
    DestroyListMenuTask(data[tListTaskId]);
    BuyMenuFreeMemory();
    SetMainCallback2(CB2_ReturnToField);
    DestroyTask(taskId);
  }
}
