// pokedex_screen.c on the GBA layer: the Pokédex from the start menu (CB2_OpenPokedexFromStartMenu → the top menu
// (Task_PokedexScreen) → the numerical lists (Task_DexScreen_NumericalOrder) → CB2_ClosePokedex back to the field
// with the start menu open).
//
// Structure (for the units that add the rest): `sPokedexScreenData` is struct PokedexScreenData, allocated by
// DexScreen_LoadResources. The screen is one task whose function is swapped like the C's (`gTasks[taskId].func =
// Task_DexScreen_X; sPokedexScreenData.state = 0`), each task a `switch (state)`. Not ported yet (later units):
// Task_DexScreen_CharacteristicOrder (A TO Z / TYPE / LIGHTEST / SMALLEST), Task_DexScreen_CategorySubmenu (the
// habitat pages), Task_DexScreen_ShowMonPage (the mon page and the area page) and the registering after a catch.
// Picking them leaves the screen where it is (see the STUB comments).
//
// The data (gPokedexEntries, the orders, the categories, the footprints) comes from menus/pokedex.ts. No audio:
// the SE_* calls are no-ops.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import {
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  FillBgTilemapBufferRect,
  HideBg,
  InitBgsFromTemplates,
  IsDma3ManagerBusyWithBgCopy,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
  UnsetBgTilemapBuffer,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import { ClearGpuRegBits, DISPCNT_WIN0_ON, DISPCNT_WIN1_ON, PALETTES_ALL, REG_OFFSET_BLDALPHA, REG_OFFSET_BLDCNT, REG_OFFSET_BLDY, REG_OFFSET_DISPCNT, RGB_BLACK, RGB_WHITE, SetGpuReg, SetGpuRegBits } from '../gba/hw';
import {
  BlitMenuInfoIcon,
  DestroyListMenuTask,
  LIST_CANCEL,
  LIST_HEADER,
  ListMenu_ProcessInput,
  ListMenuDefaultCursorMoveFunc,
  ListMenuGetScrollAndRow,
  ListMenuInit,
  ListMenuInitInRect,
  ListMenuLoadStdPalAt,
  ListMenuOverrideSetColors,
  type ListMenuItem,
  type ListMenuTemplate,
  type ListMenuWindowRect,
} from '../gba/listMenu';
import { A_BUTTON, B_BUTTON, gMain, JOY_NEW, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { DecompressAndCopyTileDataToVram, TEXT_COLOR_LIGHT_GRAY, TEXT_COLOR_TRANSPARENT, TEXT_COLOR_WHITE } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import { AnimateSprites, BuildOamBuffer, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks } from '../gba/task';
import {
  AddTextPrinterParameterized4,
  AddWindow,
  COPYWIN_GFX,
  CopyToWindowPixelBuffer,
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  GetStringWidth,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  RemoveWindow,
  RunTextPrinters,
  WINDOW_NONE,
  type WindowTemplate,
} from '../gba/window';
import { isNationalDexEnabled } from '../script/specials';
import { EOS } from '../text/charmap';
import { FONT_NORMAL, FONT_SMALL } from '../text/Font';
import { speciesName, text } from './common';
import { CB2_ReturnToFieldWithOpenMenu } from './fieldCallbacks';
import { RemoveScrollIndicatorArrowPair, AddScrollIndicatorArrowPair, type ScrollArrowsTemplate } from './menuIndicators';
import { DexScreen_GetSetPokedexFlag, FLAG_GET_CAUGHT, FLAG_GET_SEEN, NationalPokedexNumToSpecies, pokedexData } from './pokedex';

// include/pokedex_screen.h
const DEX_CATEGORY_COUNT = 9;
const DEX_ORDER_NUMERICAL_KANTO = 0;
const DEX_ORDER_ATOZ = 1;
const DEX_ORDER_TYPE = 2;
const DEX_ORDER_LIGHTEST = 3;
const DEX_ORDER_SMALLEST = 4;
const DEX_ORDER_NUMERICAL_NATIONAL = 5;
/** DEX_MODE(name) */
const DEX_MODE = (order: number) => DEX_CATEGORY_COUNT + order;

const FONT_NORMAL_COPY_1 = 1;
const TEXT_DYNAMIC_COLOR_1 = 10;
const TEXT_DYNAMIC_COLOR_2 = 11;
/** RGB_WHITEALPHA (RGB_WHITE | RGB_ALPHA): the alpha bit doesn't change BlendPalette's result. */
const RGB_WHITEALPHA = RGB_WHITE | 0x8000;
const BG_SCREEN_SIZE = 0x800;

// enum TextMode
const TEXT_LEFT = 0;
const TEXT_CENTER = 1;
const TEXT_RIGHT = 2;

/** struct PokedexScreenData. Window and task ids are 0xFF when unset, like the C's u8 -1. */
export interface PokedexScreenData {
  taskId: number;
  state: number;
  data: [number, number];
  areaMarkersTaskId: number;
  unlockedCategories: number;
  modeSelectInput: number;
  modeSelectItemsAbove: number;
  modeSelectCursorPos: number;
  modeSelectWindowId: number;
  selectionIconWindowId: number;
  dexCountsWindowId: number;
  modeSelectListMenuId: number;
  pageSpecies: number[];
  categoryMonWindowIds: number[];
  categoryMonInfoWindowIds: number[];
  category: number;
  firstPageInCategory: number;
  lastPageInCategory: number;
  pageNum: number;
  numMonsOnPage: number;
  categoryCursorPosInPage: number;
  categoryPageSelectionCursorTimer: number;
  parentOfCategoryMenu: number;
  characteristicMenuInput: number;
  kantoOrderMenuItemsAbove: number;
  kantoOrderMenuCursorPos: number;
  characteristicOrderMenuItemsAbove: number;
  characteristicOrderMenuCursorPos: number;
  nationalOrderMenuItemsAbove: number;
  nationalOrderMenuCursorPos: number;
  numericalOrderWindowId: number;
  orderedListMenuTaskId: number;
  dexOrderId: number;
  listItems: ListMenuItem[];
  orderedDexCount: number;
  windowIds: number[];
  dexSpecies: number;
  scrollArrowsTaskId: number;
  categoryPageCursorTaskId: number;
  modeSelectCursorPosBak: number;
  unlockedSeviiAreas: number;
  numSeenKanto: number;
  numOwnedKanto: number;
  numSeenNational: number;
  numOwnedNational: number;
}

/** sPokedexScreenData (EWRAM; null while the screen isn't up) */
export let sPokedexScreenData: PokedexScreenData | null = null;

function sd(): PokedexScreenData {
  return sPokedexScreenData!;
}

/** sDexScreenDataInitialState */
function initialState(): PokedexScreenData {
  return {
    taskId: 0,
    state: 0,
    data: [0, 0],
    areaMarkersTaskId: 0,
    unlockedCategories: 0,
    modeSelectInput: 0,
    modeSelectItemsAbove: 1,
    modeSelectCursorPos: 0,
    modeSelectWindowId: WINDOW_NONE,
    selectionIconWindowId: WINDOW_NONE,
    dexCountsWindowId: WINDOW_NONE,
    modeSelectListMenuId: 0,
    pageSpecies: [0xffff, 0xffff, 0xffff, 0xffff],
    categoryMonWindowIds: [WINDOW_NONE, WINDOW_NONE, WINDOW_NONE, WINDOW_NONE],
    categoryMonInfoWindowIds: [WINDOW_NONE, WINDOW_NONE, WINDOW_NONE, WINDOW_NONE],
    category: 0,
    firstPageInCategory: 0,
    lastPageInCategory: 0,
    pageNum: 0,
    numMonsOnPage: 0,
    categoryCursorPosInPage: 0,
    categoryPageSelectionCursorTimer: 0,
    parentOfCategoryMenu: 0,
    characteristicMenuInput: 0,
    kantoOrderMenuItemsAbove: 0,
    kantoOrderMenuCursorPos: 0,
    characteristicOrderMenuItemsAbove: 0,
    characteristicOrderMenuCursorPos: 0,
    nationalOrderMenuItemsAbove: 0,
    nationalOrderMenuCursorPos: 0,
    numericalOrderWindowId: WINDOW_NONE,
    orderedListMenuTaskId: 0,
    dexOrderId: 0,
    listItems: [],
    orderedDexCount: 0,
    windowIds: new Array(16).fill(WINDOW_NONE),
    dexSpecies: 0,
    scrollArrowsTaskId: 0xff,
    categoryPageCursorTaskId: 0xff,
    modeSelectCursorPosBak: 0,
    unlockedSeviiAreas: 0,
    numSeenKanto: 0,
    numOwnedKanto: 0,
    numSeenNational: 0,
    numOwnedNational: 0,
  };
}

// ------------------------------------------------------------------ templates

const sBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 5, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 },
  { bg: 1, charBaseIndex: 2, mapBaseIndex: 4, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0 },
  { bg: 2, charBaseIndex: 2, mapBaseIndex: 6, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0 },
  { bg: 3, charBaseIndex: 0, mapBaseIndex: 7, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0 },
];

const sWindowTemplates: WindowTemplate[] = [
  { bg: 0, tilemapLeft: 0, tilemapTop: 0, width: 30, height: 2, paletteNum: 15, baseBlock: 0x03c4 },
  { bg: 0, tilemapLeft: 0, tilemapTop: 18, width: 30, height: 2, paletteNum: 15, baseBlock: 0x0388 },
  DUMMY_WIN_TEMPLATE,
];

const sWindowTemplate_ModeSelect: WindowTemplate = { bg: 1, tilemapLeft: 1, tilemapTop: 2, width: 20, height: 16, paletteNum: 0, baseBlock: 0x0008 };
const sWindowTemplate_SelectionIcon: WindowTemplate = { bg: 1, tilemapLeft: 21, tilemapTop: 11, width: 8, height: 6, paletteNum: 1, baseBlock: 0x0148 };
const sWindowTemplate_DexCounts: WindowTemplate = { bg: 1, tilemapLeft: 21, tilemapTop: 2, width: 9, height: 9, paletteNum: 0, baseBlock: 0x0178 };
const sWindowTemplate_OrderedListMenu: WindowTemplate = { bg: 1, tilemapLeft: 2, tilemapTop: 2, width: 23, height: 16, paletteNum: 0, baseBlock: 0x0008 };

/** sListMenuItems_KantoDexModeSelect / sListMenuItems_NatDexModeSelect */
function modeSelectItems(natDex: boolean): ListMenuItem[] {
  const items: [string, number][] = [
    ['gText_PokemonList', LIST_HEADER],
    ...((natDex
      ? [
          ['gText_NumericalModeKanto', DEX_MODE(DEX_ORDER_NUMERICAL_KANTO)],
          ['gText_NumericalModeNational', DEX_MODE(DEX_ORDER_NUMERICAL_NATIONAL)],
        ]
      : [['gText_NumericalMode', DEX_MODE(DEX_ORDER_NUMERICAL_KANTO)]]) as [string, number][]),
    ['gText_PokemonHabitats', LIST_HEADER],
    ['gText_DexCategory_GrasslandPkmn', K.DEX_CATEGORY_GRASSLAND],
    ['gText_DexCategory_ForestPkmn', K.DEX_CATEGORY_FOREST],
    ['gText_DexCategory_WatersEdgePkmn', K.DEX_CATEGORY_WATERS_EDGE],
    ['gText_DexCategory_SeaPkmn', K.DEX_CATEGORY_SEA],
    ['gText_DexCategory_CavePkmn', K.DEX_CATEGORY_CAVE],
    ['gText_DexCategory_MountainPkmn', K.DEX_CATEGORY_MOUNTAIN],
    ['gText_DexCategory_RoughTerrainPkmn', K.DEX_CATEGORY_ROUGH_TERRAIN],
    ['gText_DexCategory_UrbanPkmn', K.DEX_CATEGORY_URBAN],
    ['gText_DexCategory_RarePkmn', K.DEX_CATEGORY_RARE],
    ['gText_Search', LIST_HEADER],
    ['gText_AToZMode', DEX_MODE(DEX_ORDER_ATOZ)],
    ['gText_TypeMode', DEX_MODE(DEX_ORDER_TYPE)],
    ['gText_LightestMode', DEX_MODE(DEX_ORDER_LIGHTEST)],
    ['gText_SmallestMode', DEX_MODE(DEX_ORDER_SMALLEST)],
    ['gText_PokedexOther', LIST_HEADER],
    ['gText_ClosePokedex', LIST_CANCEL],
  ];
  return items.map(([label, index]) => ({ label: text(label), index }));
}

/** sListMenuTemplate_KantoDexModeSelect / sListMenuTemplate_NatDexModeSelect */
function modeSelectTemplate(natDex: boolean): ListMenuTemplate {
  const items = modeSelectItems(natDex);
  return {
    items,
    moveCursorFunc: MoveCursorFunc_DexModeSelect,
    itemPrintFunc: ItemPrintFunc_DexModeSelect,
    totalItems: items.length,
    maxShowed: 9,
    windowId: 0,
    header_X: 0,
    item_X: 12,
    cursor_X: 4,
    upText_Y: 2,
    cursorPal: 1,
    fillValue: 0,
    cursorShadowPal: 3,
    lettersSpacing: 1,
    itemVerticalPadding: 0,
    scrollMultiple: 0,
    fontId: FONT_NORMAL,
    cursorKind: 0,
  };
}

const sScrollArrowsTemplate_KantoDex: ScrollArrowsTemplate = {
  firstArrowType: 2,
  firstX: 200,
  firstY: 19,
  secondArrowType: 3,
  secondX: 200,
  secondY: 141,
  fullyUpThreshold: 0,
  fullyDownThreshold: 10,
  tileTag: 2000,
  palTag: 0xffff,
  palNum: 1,
};

const sScrollArrowsTemplate_NatDex: ScrollArrowsTemplate = { ...sScrollArrowsTemplate_KantoDex, fullyDownThreshold: 11 };

/** sTopMenuSelectionIconGfxPtrs: [tiles, palette] by DEX_CATEGORY_* / DEX_MODE(*) */
const sTopMenuSelectionIconGfxPtrs: [string, string][] = [
  ['sTopMenuIconTiles_Grassland', 'sTopMenuIconPals_Grassland'],
  ['sTopMenuIconTiles_Forest', 'sTopMenuIconPals_Forest'],
  ['sTopMenuIconTiles_WatersEdge', 'sTopMenuIconPals_WatersEdge'],
  ['sTopMenuIconTiles_Sea', 'sTopMenuIconPals_Sea'],
  ['sTopMenuIconTiles_Cave', 'sTopMenuIconPals_Cave'],
  ['sTopMenuIconTiles_Mountain', 'sTopMenuIconPals_Mountain'],
  ['sTopMenuIconTiles_RoughTerrain', 'sTopMenuIconPals_RoughTerrain'],
  ['sTopMenuIconTiles_Urban', 'sTopMenuIconPals_Urban'],
  ['sTopMenuIconTiles_Rare', 'sTopMenuIconPals_Rare'],
  ['sTopMenuIconTiles_Numerical', 'sTopMenuIconPals_Numerical'], // DEX_MODE(NUMERICAL_KANTO)
  ['gDexScreen_TopMenuIconTiles_AtoZ', 'gDexScreen_TopMenuIconPals_AtoZ'],
  ['sTopMenuIconTiles_Type', 'sTopMenuIconPals_Type'],
  ['sTopMenuIconTiles_Lightest', 'sTopMenuIconPals_Lightest'],
  ['sTopMenuIconTiles_Smallest', 'sTopMenuIconPals_Smallest'],
  ['sTopMenuIconTiles_Numerical', 'sTopMenuIconPals_Numerical'], // DEX_MODE(NUMERICAL_NATIONAL)
];

/** sListMenuTemplate_OrderedListMenu (items, windowId and totalItems are filled in) */
const sListMenuTemplate_OrderedListMenu: ListMenuTemplate = {
  items: [],
  moveCursorFunc: ListMenuDefaultCursorMoveFunc,
  itemPrintFunc: ItemPrintFunc_OrderedListMenu,
  totalItems: 0,
  maxShowed: 9,
  windowId: 0,
  header_X: 0,
  item_X: 56,
  cursor_X: 4,
  upText_Y: 2,
  cursorPal: 1,
  fillValue: 0,
  cursorShadowPal: 3,
  lettersSpacing: 1,
  itemVerticalPadding: 0,
  scrollMultiple: 1,
  fontId: FONT_NORMAL,
  cursorKind: 0,
};

/** sListMenuRects_OrderedList: the caught ball's column in palette 1, the type icons' in palette 2 */
const sListMenuRects_OrderedList: ListMenuWindowRect[] = [
  { x: 0, y: 0, width: 5, height: 16, palNum: 0 },
  { x: 5, y: 0, width: 2, height: 16, palNum: 1 },
  { x: 7, y: 0, width: 8, height: 16, palNum: 0 },
  { x: 15, y: 0, width: 8, height: 16, palNum: 2 },
  { x: 0xff, y: 0xff, width: 0xff, height: 0xff, palNum: 0xff },
];

const sDexOrderScrollArrowsTemplate: ScrollArrowsTemplate = { ...sScrollArrowsTemplate_KantoDex, fullyDownThreshold: 0 };

/** Every graphics symbol the screen loads (preload them before it opens). */
export function pokedexScreenGfxSymbols(): string[] {
  const syms = new Set([
    'sKantoDexTiles',
    'sNatDexTiles',
    'sKantoDexPalette',
    'sNationalDexPalette',
    'sTopMenuSelectionIconTiles_Cancel',
    'sTopMenuSelectionIconPals_Cancel',
    // ListMenuLoadStdPalAt / BlitMenuInfoIcon, AddScrollIndicatorArrowPair
    'gMenuInfoElements_Gfx',
    'gMenuInfoElements1_Pal',
    'gMenuInfoElements2_Pal',
    'sRedArrowOtherGfx',
    'sRedArrowPal',
  ]);
  for (const [tiles, pal] of sTopMenuSelectionIconGfxPtrs) syms.add(tiles).add(pal);
  return [...syms];
}

// ------------------------------------------------------------------ open / close

function VBlankCB(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/** CB2_PokedexScreen */
function CB2_PokedexScreen(): void {
  if (!gPaletteFade.active || IsDma3ManagerBusyWithBgCopy()) {
    RunTasks();
    RunTextPrinters();
    AnimateSprites();
    BuildOamBuffer();
  } else {
    UpdatePaletteFade();
  }
}

/** DexScreen_LoadResources */
export function DexScreen_LoadResources(): void {
  const natDex = isNationalDexEnabled(state);
  SetVBlankCallback(null);
  ResetPaletteFade();
  ResetSpriteData();
  ResetTasks();
  ScanlineEffect_Stop();
  ResetBgsAndClearDma3BusyFlags(true);
  InitBgsFromTemplates(0, sBgTemplates);
  for (const bg of [3, 2, 1, 0]) SetBgTilemapBuffer(bg, new Uint16Array(BG_SCREEN_SIZE / 2));
  // DecompressAndLoadBgGfxUsingHeap(3, tiles, BG_SCREEN_SIZE, 0, 0): reserves 64 tiles of char base 0
  DecompressAndCopyTileDataToVram(3, gfx(natDex ? 'sNatDexTiles' : 'sKantoDexTiles'), BG_SCREEN_SIZE, 0, 0);
  InitWindows(sWindowTemplates);
  DeactivateAllTextPrinters();
  SetVBlankCallback(VBlankCB);
  const taskId = CreateTask(Task_PokedexScreen, 0);
  sPokedexScreenData = initialState();
  const d = sd();
  d.taskId = taskId;
  d.listItems = Array.from({ length: K.NATIONAL_DEX_COUNT }, () => ({ label: [EOS], index: 0 }));
  d.numSeenNational = DexScreen_GetDexCount(FLAG_GET_SEEN, 1);
  d.numOwnedNational = DexScreen_GetDexCount(FLAG_GET_CAUGHT, 1);
  d.numSeenKanto = DexScreen_GetDexCount(FLAG_GET_SEEN, 0);
  d.numOwnedKanto = DexScreen_GetDexCount(FLAG_GET_CAUGHT, 0);
  // SetBGMVolume_SuppressHelpSystemReduction(0x80): no audio
  for (let bg = 0; bg < 4; bg++) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }
  gPaletteFade.bufferTransferDisabled = true;
  const pal = gfx16(natDex ? 'sNationalDexPalette' : 'sKantoDexPalette');
  LoadPalette(pal, BG_PLTT_ID(0), pal.length * 2);
  FillBgTilemapBufferRect(3, 0x001, 0, 0, 32, 32, 0);
  FillBgTilemapBufferRect(2, 0x000, 0, 0, 32, 32, 17);
  FillBgTilemapBufferRect(1, 0x000, 0, 0, 32, 32, 17);
  FillBgTilemapBufferRect(0, 0x003, 0, 0, 32, 2, 15);
  FillBgTilemapBufferRect(0, 0x000, 0, 2, 32, 16, 17);
  FillBgTilemapBufferRect(0, 0x003, 0, 18, 32, 2, 15);
}

/** CB2_OpenPokedexFromStartMenu */
export function CB2_OpenPokedexFromStartMenu(): void {
  DexScreen_LoadResources();
  ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON | DISPCNT_WIN1_ON);
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  SetGpuReg(REG_OFFSET_BLDY, 0);
  SetMainCallback2(CB2_PokedexScreen);
  // SetHelpContext(HELPCONTEXT_POKEDEX): no help system
}

/** DoClosePokedex */
function DoClosePokedex(): boolean {
  switch (gMain.state) {
    case 0:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
      gMain.state++;
      return false;
    case 1:
      if (!gPaletteFade.active) gMain.state = 2;
      else UpdatePaletteFade();
      return false;
    case 2:
      sPokedexScreenData = null;
      FreeAllWindowBuffers();
      for (let bg = 0; bg < 4; bg++) UnsetBgTilemapBuffer(bg);
      // BGMVolumeMax_EnableHelpSystemReduction: no audio
      break;
  }
  return true;
}

/** CB2_ClosePokedex */
function CB2_ClosePokedex(): void {
  if (DoClosePokedex()) {
    SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON | DISPCNT_WIN1_ON);
    SetMainCallback2(CB2_ReturnToFieldWithOpenMenu);
  }
}

// ------------------------------------------------------------------ the top menu

/** DestroyListMenuTask(listTaskId, &d.modeSelectCursorPos, &d.modeSelectItemsAbove) */
function destroyModeSelectList(d: PokedexScreenData): void {
  const out = { cursorPos: 0, itemsAbove: 0 };
  DestroyListMenuTask(d.modeSelectListMenuId, out);
  d.modeSelectCursorPos = out.cursorPos;
  d.modeSelectItemsAbove = out.itemsAbove;
}

/** Task_PokedexScreen */
function Task_PokedexScreen(taskId: number): void {
  const d = sd();
  switch (d.state) {
    case 0:
      d.unlockedCategories = 0;
      for (let i = 0; i < 9; i++) d.unlockedCategories |= (DexScreen_IsCategoryUnlocked(i) ? 1 : 0) << i;
      d.state = 2;
      break;
    case 1:
      RemoveScrollIndicatorArrowPair(d.scrollArrowsTaskId);
      DexScreen_RemoveWindow(d, 'modeSelectWindowId');
      DexScreen_RemoveWindow(d, 'selectionIconWindowId');
      DexScreen_RemoveWindow(d, 'dexCountsWindowId');
      SetMainCallback2(CB2_ClosePokedex);
      DestroyTask(taskId);
      break;
    case 2:
      DexScreen_InitGfxForTopMenu();
      d.state = 3;
      break;
    case 3:
      CopyBgTilemapBufferToVram(3);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(0);
      d.state = 4;
      break;
    case 4:
      ShowBg(3);
      ShowBg(2);
      ShowBg(1);
      ShowBg(0);
      if (gPaletteFade.bufferTransferDisabled) {
        gPaletteFade.bufferTransferDisabled = false;
        BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0, RGB_WHITEALPHA);
      } else {
        BeginNormalPaletteFade(~0x8000 >>> 0, 0, 16, 0, RGB_WHITEALPHA);
      }
      d.state = 5;
      break;
    case 5:
      d.modeSelectCursorPosBak = ListMenuGetScrollAndRow(d.modeSelectListMenuId).cursorPos;
      d.scrollArrowsTaskId = AddScrollIndicatorArrowPair(
        isNationalDexEnabled(state) ? sScrollArrowsTemplate_NatDex : sScrollArrowsTemplate_KantoDex,
        () => sd().modeSelectCursorPosBak,
      );
      d.state = 6;
      break;
    case 6:
      d.modeSelectInput = ListMenu_ProcessInput(d.modeSelectListMenuId);
      d.modeSelectCursorPosBak = ListMenuGetScrollAndRow(d.modeSelectListMenuId).cursorPos;
      if (JOY_NEW(A_BUTTON)) {
        const input = d.modeSelectInput;
        if (input === LIST_CANCEL) {
          d.state = 1;
        } else if (input >= K.DEX_CATEGORY_GRASSLAND && input <= K.DEX_CATEGORY_RARE) {
          if (DexScreen_IsCategoryUnlocked(input)) {
            // STUB (W-dex unit 3): Task_DexScreen_CategorySubmenu isn't ported, so a habitat stays inert. The C:
            // RemoveScrollIndicatorArrowPair; d.category = input; fade out; state 7.
            console.warn('[pokedex] the habitat pages are not implemented yet');
          }
        } else if (input === DEX_MODE(DEX_ORDER_NUMERICAL_KANTO) || input === DEX_MODE(DEX_ORDER_NUMERICAL_NATIONAL)) {
          RemoveScrollIndicatorArrowPair(d.scrollArrowsTaskId);
          d.dexOrderId = input - DEX_CATEGORY_COUNT;
          BeginNormalPaletteFade(~0x8000 >>> 0, 0, 0, 16, RGB_WHITEALPHA);
          d.state = 9;
        } else if (input >= DEX_MODE(DEX_ORDER_ATOZ) && input <= DEX_MODE(DEX_ORDER_SMALLEST)) {
          // STUB (W-dex unit 2): Task_DexScreen_CharacteristicOrder isn't ported, so these stay inert. The C:
          // RemoveScrollIndicatorArrowPair; d.dexOrderId = input - DEX_CATEGORY_COUNT; reset the characteristic
          // list's cursor; fade out; state 8.
          console.warn('[pokedex] the search lists are not implemented yet');
        }
        break;
      }
      if (JOY_NEW(B_BUTTON)) d.state = 1;
      break;
    case 7:
    case 8:
      // Task_DexScreen_CategorySubmenu / Task_DexScreen_CharacteristicOrder: later units (see case 6).
      break;
    case 9:
      destroyModeSelectList(d);
      HideBg(1);
      DexScreen_RemoveWindow(d, 'modeSelectWindowId');
      DexScreen_RemoveWindow(d, 'selectionIconWindowId');
      DexScreen_RemoveWindow(d, 'dexCountsWindowId');
      gTasks[taskId].func = Task_DexScreen_NumericalOrder;
      d.state = 0;
      break;
  }
}

/** DexScreen_InitGfxForTopMenu */
function DexScreen_InitGfxForTopMenu(): void {
  const d = sd();
  FillBgTilemapBufferRect(3, 0x00e, 0, 0, 30, 20, 0);
  FillBgTilemapBufferRect(2, 0x000, 0, 0, 30, 20, 17);
  FillBgTilemapBufferRect(1, 0x000, 0, 0, 30, 20, 17);
  d.modeSelectWindowId = AddWindow(sWindowTemplate_ModeSelect);
  d.selectionIconWindowId = AddWindow(sWindowTemplate_SelectionIcon);
  d.dexCountsWindowId = AddWindow(sWindowTemplate_DexCounts);
  const counts = d.dexCountsWindowId;
  if (isNationalDexEnabled(state)) {
    const listMenuTemplate = { ...modeSelectTemplate(true), windowId: d.modeSelectWindowId };
    d.modeSelectListMenuId = ListMenuInit(listMenuTemplate, d.modeSelectCursorPos, d.modeSelectItemsAbove);
    FillWindowPixelBuffer(counts, PIXEL_FILL(0));
    DexScreen_AddTextPrinterParameterized(counts, FONT_SMALL, text('gText_Seen'), 0, 2, 0);
    DexScreen_AddTextPrinterParameterized(counts, FONT_SMALL, text('gText_Kanto'), 8, 13, 0);
    DexScreen_PrintNum3RightAlign(counts, 0, d.numSeenKanto, 52, 13, 2);
    DexScreen_AddTextPrinterParameterized(counts, FONT_SMALL, text('gText_National'), 8, 24, 0);
    DexScreen_PrintNum3RightAlign(counts, 0, d.numSeenNational, 52, 24, 2);
    DexScreen_AddTextPrinterParameterized(counts, FONT_SMALL, text('gText_Owned'), 0, 37, 0);
    DexScreen_AddTextPrinterParameterized(counts, FONT_SMALL, text('gText_Kanto'), 8, 48, 0);
    DexScreen_PrintNum3RightAlign(counts, 0, d.numOwnedKanto, 52, 48, 2);
    DexScreen_AddTextPrinterParameterized(counts, FONT_SMALL, text('gText_National'), 8, 59, 0);
    DexScreen_PrintNum3RightAlign(counts, 0, d.numOwnedNational, 52, 59, 2);
  } else {
    const listMenuTemplate = { ...modeSelectTemplate(false), windowId: d.modeSelectWindowId };
    d.modeSelectListMenuId = ListMenuInit(listMenuTemplate, d.modeSelectCursorPos, d.modeSelectItemsAbove);
    FillWindowPixelBuffer(counts, PIXEL_FILL(0));
    DexScreen_AddTextPrinterParameterized(counts, FONT_NORMAL_COPY_1, text('gText_Seen'), 0, 9, 0);
    DexScreen_PrintNum3RightAlign(counts, 1, d.numSeenKanto, 32, 21, 2);
    DexScreen_AddTextPrinterParameterized(counts, FONT_NORMAL_COPY_1, text('gText_Owned'), 0, 37, 0);
    DexScreen_PrintNum3RightAlign(counts, 1, d.numOwnedKanto, 32, 49, 2);
  }
  FillWindowPixelBuffer(0, PIXEL_FILL(15));
  DexScreen_PrintStringWithAlignment(text('gText_PokedexTableOfContents'), TEXT_CENTER);
  FillWindowPixelBuffer(1, PIXEL_FILL(15));
  DexScreen_PrintControlInfo(text('gText_PickOK'));
  PutWindowTilemap(0);
  CopyWindowToVram(0, COPYWIN_GFX);
  PutWindowTilemap(1);
  CopyWindowToVram(1, COPYWIN_GFX);
  PutWindowTilemap(counts);
  CopyWindowToVram(counts, COPYWIN_GFX);
}

/** MoveCursorFunc_DexModeSelect: the selection's icon in the window bottom right */
function MoveCursorFunc_DexModeSelect(itemIndex: number, onInit: boolean): void {
  const d = sd();
  if (!onInit) PlaySE(K.SE_SELECT);
  const [tiles, pal] = itemIndex === LIST_CANCEL ? ['sTopMenuSelectionIconTiles_Cancel', 'sTopMenuSelectionIconPals_Cancel'] : sTopMenuSelectionIconGfxPtrs[itemIndex];
  CopyToWindowPixelBuffer(d.selectionIconWindowId, gfx(tiles), 0, 0);
  LoadPalette(gfx16(pal), BG_PLTT_ID(1), PLTT_SIZE_4BPP);
  PutWindowTilemap(d.selectionIconWindowId);
  CopyWindowToVram(d.selectionIconWindowId, COPYWIN_GFX);
}

/** ItemPrintFunc_DexModeSelect: a locked habitat is greyed out */
function ItemPrintFunc_DexModeSelect(_windowId: number, itemId: number, _y: number): void {
  // itemId is a u32 in the C: LIST_HEADER / LIST_CANCEL count as >= DEX_CATEGORY_COUNT
  if (itemId >>> 0 >= DEX_CATEGORY_COUNT || sd().unlockedCategories & (1 << itemId)) {
    ListMenuOverrideSetColors(TEXT_COLOR_WHITE, TEXT_COLOR_TRANSPARENT, TEXT_COLOR_LIGHT_GRAY);
  } else {
    ListMenuOverrideSetColors(TEXT_DYNAMIC_COLOR_1, TEXT_COLOR_TRANSPARENT, TEXT_DYNAMIC_COLOR_2);
  }
}

// ------------------------------------------------------------------ the numerical lists

/** Task_DexScreen_NumericalOrder: KANTO, or NATIONAL with the National Dex */
function Task_DexScreen_NumericalOrder(taskId: number): void {
  const d = sd();
  switch (d.state) {
    case 0:
      ListMenuLoadStdPalAt(BG_PLTT_ID(1), 0);
      ListMenuLoadStdPalAt(BG_PLTT_ID(2), 1);
      d.orderedDexCount = DexScreen_CountMonsInOrderedList(d.dexOrderId);
      d.state = 2;
      break;
    case 1:
      DexScreen_DestroyDexOrderListMenu(d.dexOrderId);
      HideBg(1);
      DexScreen_RemoveWindow(d, 'numericalOrderWindowId');
      gTasks[taskId].func = Task_PokedexScreen;
      d.state = 0;
      break;
    case 2:
      DexScreen_InitGfxForNumericalOrderList();
      d.state = 3;
      break;
    case 3:
      CopyBgTilemapBufferToVram(3);
      CopyBgTilemapBufferToVram(1);
      d.state = 4;
      break;
    case 4:
      ShowBg(1);
      BeginNormalPaletteFade(~0x8000 >>> 0, 0, 16, 0, RGB_WHITEALPHA);
      d.state = 5;
      break;
    case 5:
      // The C reads modeSelectListMenuId here: the top menu's list task was destroyed and the ordered list's
      // task took its slot, so it's the same task as orderedListMenuTaskId.
      d.modeSelectCursorPosBak = ListMenuGetScrollAndRow(d.orderedListMenuTaskId).cursorPos;
      d.scrollArrowsTaskId = DexScreen_CreateDexOrderScrollArrows();
      d.state = 6;
      break;
    case 6:
      d.characteristicMenuInput = ListMenu_ProcessInput(d.orderedListMenuTaskId);
      d.modeSelectCursorPosBak = ListMenuGetScrollAndRow(d.orderedListMenuTaskId).cursorPos;
      if (JOY_NEW(A_BUTTON)) {
        if ((d.characteristicMenuInput >>> 16) & 1) {
          // STUB (W-dex unit 2): Task_DexScreen_ShowMonPage isn't ported, so A on a seen mon does nothing. The C:
          // d.dexSpecies = input & 0xFFFF; RemoveScrollIndicatorArrowPair; fade out; state 7 (→ the mon page).
        }
      } else if (JOY_NEW(B_BUTTON)) {
        RemoveScrollIndicatorArrowPair(d.scrollArrowsTaskId);
        BeginNormalPaletteFade(~0x8000 >>> 0, 0, 0, 16, RGB_WHITEALPHA);
        d.state = 1;
      }
      break;
    case 7:
      // Task_DexScreen_ShowMonPage: a later unit (see case 6).
      break;
  }
}

/** DexScreen_InitGfxForNumericalOrderList */
function DexScreen_InitGfxForNumericalOrderList(): void {
  const d = sd();
  FillBgTilemapBufferRect(3, 0x00e, 0, 0, 30, 20, 0);
  FillBgTilemapBufferRect(1, 0x000, 0, 0, 32, 32, 17);
  d.numericalOrderWindowId = AddWindow(sWindowTemplate_OrderedListMenu);
  const template: ListMenuTemplate = {
    ...sListMenuTemplate_OrderedListMenu,
    items: d.listItems,
    windowId: d.numericalOrderWindowId,
    totalItems: d.orderedDexCount,
  };
  DexScreen_InitListMenuForOrderedList(template, d.dexOrderId);
  FillWindowPixelBuffer(0, PIXEL_FILL(15));
  DexScreen_PrintStringWithAlignment(text('gText_PokemonListNoColor'), TEXT_CENTER);
  FillWindowPixelBuffer(1, PIXEL_FILL(15));
  DexScreen_PrintControlInfo(text('gText_PickOKExit'));
  CopyWindowToVram(0, COPYWIN_GFX);
  CopyWindowToVram(1, COPYWIN_GFX);
}

/** The list item index: (caught << 17) + (seen << 16) + species */
function listItemIndex(ndexNum: number, seen: boolean, caught: boolean): number {
  return ((caught ? 1 : 0) << 17) + ((seen ? 1 : 0) << 16) + NationalPokedexNumToSpecies(state, ndexNum);
}

/**
 * DexScreen_CountMonsInOrderedList: fills d.listItems for the order. The numerical orders list every number up to
 * the last one seen ("-----" for the unseen ones); A TO Z lists the seen mons, the others the caught ones.
 */
function DexScreen_CountMonsInOrderedList(orderIdx: number): number {
  const d = sd();
  const maxN = isNationalDexEnabled(state) ? K.NATIONAL_DEX_COUNT : K.KANTO_DEX_COUNT;
  const seenOf = (n: number) => DexScreen_GetSetPokedexFlag(state, n, FLAG_GET_SEEN, false);
  const caughtOf = (n: number) => DexScreen_GetSetPokedexFlag(state, n, FLAG_GET_CAUGHT, false);
  const label = (n: number) => speciesName(NationalPokedexNumToSpecies(state, n));
  let ret = 0; // NATIONAL_DEX_NONE
  /** The filtered orders: append the mons that pass `keep`. */
  const appendFiltered = (order: number[], keep: (seen: boolean, caught: boolean) => boolean) => {
    for (const ndexNum of order) {
      if (ndexNum > maxN) continue;
      const seen = seenOf(ndexNum);
      const caught = caughtOf(ndexNum);
      if (!keep(seen, caught)) continue;
      d.listItems[ret] = { label: label(ndexNum), index: listItemIndex(ndexNum, seen, caught) };
      ret++;
    }
  };
  const numerical = (count: number) => {
    for (let i = 0; i < count; i++) {
      const ndexNum = i + 1;
      const seen = seenOf(ndexNum);
      const caught = caughtOf(ndexNum);
      d.listItems[i] = { label: seen ? label(ndexNum) : text('gText_5Dashes'), index: listItemIndex(ndexNum, seen, caught) };
      if (seen) ret = ndexNum;
    }
  };
  const { orders } = pokedexData;
  switch (orderIdx) {
    default:
    case DEX_ORDER_NUMERICAL_KANTO:
      numerical(K.KANTO_DEX_COUNT);
      break;
    case DEX_ORDER_ATOZ:
      // for (i = 0; i < NUM_SPECIES - 1; i++): the table is that long
      appendFiltered(orders.alphabetical, (seen) => seen);
      break;
    case DEX_ORDER_TYPE:
      appendFiltered(
        orders.type.map((species) => state.pokemon.nationalDex(species)),
        (_seen, caught) => caught,
      );
      break;
    case DEX_ORDER_LIGHTEST:
      appendFiltered(orders.weight.slice(0, K.NATIONAL_DEX_COUNT), (_seen, caught) => caught);
      break;
    case DEX_ORDER_SMALLEST:
      appendFiltered(orders.height.slice(0, K.NATIONAL_DEX_COUNT), (_seen, caught) => caught);
      break;
    case DEX_ORDER_NUMERICAL_NATIONAL:
      numerical(K.NATIONAL_DEX_COUNT);
      break;
  }
  return ret;
}

/** DexScreen_InitListMenuForOrderedList: each order remembers its own cursor */
function DexScreen_InitListMenuForOrderedList(template: ListMenuTemplate, order: number): void {
  const d = sd();
  switch (order) {
    default:
    case DEX_ORDER_NUMERICAL_KANTO:
      d.orderedListMenuTaskId = ListMenuInitInRect(template, sListMenuRects_OrderedList, d.kantoOrderMenuCursorPos, d.kantoOrderMenuItemsAbove);
      break;
    case DEX_ORDER_ATOZ:
    case DEX_ORDER_TYPE:
    case DEX_ORDER_LIGHTEST:
    case DEX_ORDER_SMALLEST:
      d.orderedListMenuTaskId = ListMenuInitInRect(template, sListMenuRects_OrderedList, d.characteristicOrderMenuCursorPos, d.characteristicOrderMenuItemsAbove);
      break;
    case DEX_ORDER_NUMERICAL_NATIONAL:
      d.orderedListMenuTaskId = ListMenuInitInRect(template, sListMenuRects_OrderedList, d.nationalOrderMenuCursorPos, d.nationalOrderMenuItemsAbove);
      break;
  }
}

/** DexScreen_DestroyDexOrderListMenu: saves the order's cursor */
function DexScreen_DestroyDexOrderListMenu(order: number): void {
  const d = sd();
  const out = { cursorPos: 0, itemsAbove: 0 };
  DestroyListMenuTask(d.orderedListMenuTaskId, out);
  switch (order) {
    default:
    case DEX_ORDER_NUMERICAL_KANTO:
      d.kantoOrderMenuCursorPos = out.cursorPos;
      d.kantoOrderMenuItemsAbove = out.itemsAbove;
      break;
    case DEX_ORDER_ATOZ:
    case DEX_ORDER_TYPE:
    case DEX_ORDER_LIGHTEST:
    case DEX_ORDER_SMALLEST:
      d.characteristicOrderMenuCursorPos = out.cursorPos;
      d.characteristicOrderMenuItemsAbove = out.itemsAbove;
      break;
    case DEX_ORDER_NUMERICAL_NATIONAL:
      d.nationalOrderMenuCursorPos = out.cursorPos;
      d.nationalOrderMenuItemsAbove = out.itemsAbove;
      break;
  }
}

/** DexScreen_CreateDexOrderScrollArrows */
function DexScreen_CreateDexOrderScrollArrows(): number {
  const d = sd();
  const maxShowed = sListMenuTemplate_OrderedListMenu.maxShowed;
  const template = { ...sDexOrderScrollArrowsTemplate, fullyDownThreshold: d.orderedDexCount > maxShowed ? d.orderedDexCount - maxShowed : 0 };
  return AddScrollIndicatorArrowPair(template, () => sd().modeSelectCursorPosBak);
}

/** ItemPrintFunc_OrderedListMenu: No. 001, the caught ball and the type icons */
function ItemPrintFunc_OrderedListMenu(_windowId: number, itemId: number, y: number): void {
  const d = sd();
  const species = itemId & 0xffff;
  const caught = (itemId >>> 17) & 1;
  DexScreen_PrintMonDexNo(d.numericalOrderWindowId, FONT_SMALL, species, 12, y);
  if (caught) {
    BlitMenuInfoIcon(d.numericalOrderWindowId, K.MENU_INFO_ICON_CAUGHT, 0x28, y);
    const types = state.pokemon.species[species].types;
    BlitMenuInfoIcon(d.numericalOrderWindowId, types[0] + 1, 0x78, y);
    if (types[0] !== types[1]) BlitMenuInfoIcon(d.numericalOrderWindowId, types[1] + 1, 0x98, y);
  }
}

// ------------------------------------------------------------------ helpers

/** DexScreen_RemoveWindow */
function DexScreen_RemoveWindow(d: PokedexScreenData, field: 'modeSelectWindowId' | 'selectionIconWindowId' | 'dexCountsWindowId' | 'numericalOrderWindowId'): void {
  if (d[field] !== WINDOW_NONE) {
    RemoveWindow(d[field]);
    d[field] = WINDOW_NONE;
  }
}

/** DexScreen_AddTextPrinterParameterized: colorIdx picks one of five [bg, fg, shadow] sets */
export function DexScreen_AddTextPrinterParameterized(windowId: number, fontId: number, str: number[], x: number, y: number, colorIdx: number): void {
  const textColor = [
    [0, 1, 3],
    [0, 5, 1],
    [0, 15, 14],
    [0, 11, 1],
    [0, 1, 2],
  ][colorIdx];
  AddTextPrinterParameterized4(windowId, fontId, x, y, fontId === FONT_SMALL ? 0 : 1, 0, textColor, -1, str);
}

function num3(num: number): number[] {
  return [K.CHAR_0 + Math.trunc(num / 100), K.CHAR_0 + Math.trunc((num % 100) / 10), K.CHAR_0 + (num % 10), EOS];
}

/** DexScreen_PrintNum3LeadingZeroes */
export function DexScreen_PrintNum3LeadingZeroes(windowId: number, fontId: number, num: number, x: number, y: number, colorIdx: number): void {
  DexScreen_AddTextPrinterParameterized(windowId, fontId, num3(num), x, y, colorIdx);
}

/** DexScreen_PrintNum3RightAlign: leading zeroes become spaces */
export function DexScreen_PrintNum3RightAlign(windowId: number, fontId: number, num: number, x: number, y: number, colorIdx: number): void {
  const buff = num3(num);
  for (let i = 0; i < 3; i++) {
    if (buff[i] !== K.CHAR_0) break;
    buff[i] = K.CHAR_SPACE;
  }
  DexScreen_AddTextPrinterParameterized(windowId, fontId, buff, x, y, colorIdx);
}

/** DexScreen_PrintMonDexNo: "No" and the national number with leading zeroes */
export function DexScreen_PrintMonDexNo(windowId: number, fontId: number, species: number, x: number, y: number): void {
  const dexNum = state.pokemon.nationalDex(species);
  DexScreen_AddTextPrinterParameterized(windowId, fontId, text('gText_PokedexNo'), x, y, 0);
  DexScreen_PrintNum3LeadingZeroes(windowId, fontId, dexNum, x + 9, y, 0);
}

/** DexScreen_GetDexCount: whichDex 0 = Kanto, 1 = national */
export function DexScreen_GetDexCount(caseId: number, whichDex: number): number {
  const n = whichDex === 0 ? K.KANTO_DEX_COUNT : K.NATIONAL_DEX_COUNT;
  let count = 0;
  for (let i = 0; i < n; i++) if (DexScreen_GetSetPokedexFlag(state, i + 1, caseId, false)) count++;
  return count;
}

/** DexScreen_PrintControlInfo: the bottom bar's button help, right-aligned */
export function DexScreen_PrintControlInfo(src: number[]): void {
  DexScreen_AddTextPrinterParameterized(1, FONT_SMALL, src, 236 - GetStringWidth(FONT_SMALL, src, 0), 2, 4);
}

/** DexScreen_PrintStringWithAlignment: the top bar's title */
export function DexScreen_PrintStringWithAlignment(str: number[], mode: number): void {
  let x: number;
  switch (mode) {
    case TEXT_LEFT:
      x = 8;
      break;
    case TEXT_CENTER:
      x = ((240 - GetStringWidth(FONT_NORMAL, str, 0)) >>> 0) / 2;
      x = Math.trunc(x);
      break;
    case TEXT_RIGHT:
    default:
      x = 232 - GetStringWidth(FONT_NORMAL, str, 0);
      break;
  }
  DexScreen_AddTextPrinterParameterized(0, FONT_NORMAL, str, x, 2, 4);
}

/** DexScreen_CanShowMonInDex: a non-Kanto mon only shows with the National Dex */
function DexScreen_CanShowMonInDex(species: number): boolean {
  if (isNationalDexEnabled(state)) return true;
  return state.pokemon.nationalDex(species) <= K.KANTO_DEX_COUNT;
}

/** DexScreen_IsPageUnlocked: a habitat page with a mon that's been seen */
export function DexScreen_IsPageUnlocked(categoryNum: number, pageNum: number): boolean {
  const page = pokedexData.categories[categoryNum][pageNum];
  for (let i = 0; i < 4 && i < page.length; i++) {
    const species = page[i];
    if (DexScreen_CanShowMonInDex(species) && DexScreen_GetSetPokedexFlag(state, species, FLAG_GET_SEEN, true)) return true;
  }
  return false;
}

/** DexScreen_IsCategoryUnlocked */
export function DexScreen_IsCategoryUnlocked(categoryNum: number): boolean {
  const count = pokedexData.categories[categoryNum].length;
  for (let i = 0; i < count; i++) if (DexScreen_IsPageUnlocked(categoryNum, i)) return true;
  return false;
}

// ------------------------------------------------------------------ test probe

/** The screen while it's up: the task and its state, the counts, the top menu and the ordered list. */
export function pokedexScreenProbe():
  | {
      task: string;
      state: number;
      /** The task takes input (Task_PokedexScreen / Task_DexScreen_NumericalOrder state 6) and no fade runs. */
      ready: boolean;
      counts: { seenKanto: number; ownedKanto: number; seenNational: number; ownedNational: number };
      unlockedCategories: number;
      /** The top menu's list: its scroll and row, and the selected item's index (DEX_CATEGORY_* / DEX_MODE(*) / LIST_CANCEL) */
      modeSelect?: { cursorPos: number; itemsAbove: number; selected: number };
      /** The numerical list: DEX_ORDER_*, how many rows, its scroll and row, the selected row's species, seen, caught */
      orderedList?: { order: number; count: number; cursorPos: number; itemsAbove: number; species: number; seen: boolean; caught: boolean; arrows: number };
    }
  | undefined {
  const d = sPokedexScreenData;
  if (!d) return undefined;
  const task = gTasks[d.taskId];
  const taskName = task.isActive ? task.func.name : '';
  const result: ReturnType<typeof pokedexScreenProbe> = {
    task: taskName,
    state: d.state,
    ready: task.isActive && d.state === 6 && !gPaletteFade.active,
    counts: { seenKanto: d.numSeenKanto, ownedKanto: d.numOwnedKanto, seenNational: d.numSeenNational, ownedNational: d.numOwnedNational },
    unlockedCategories: d.unlockedCategories,
  };
  if (taskName === 'Task_PokedexScreen' && d.state >= 5 && d.state <= 6) {
    const { cursorPos, itemsAbove } = ListMenuGetScrollAndRow(d.modeSelectListMenuId);
    const items = modeSelectItems(isNationalDexEnabled(state));
    result.modeSelect = { cursorPos, itemsAbove, selected: items[cursorPos + itemsAbove].index };
  }
  if (taskName === 'Task_DexScreen_NumericalOrder' && d.state >= 5 && d.state <= 6) {
    const { cursorPos, itemsAbove } = ListMenuGetScrollAndRow(d.orderedListMenuTaskId);
    const index = d.listItems[cursorPos + itemsAbove].index;
    result.orderedList = {
      order: d.dexOrderId,
      count: d.orderedDexCount,
      cursorPos,
      itemsAbove,
      species: index & 0xffff,
      seen: !!((index >>> 16) & 1),
      caught: !!((index >>> 17) & 1),
      arrows: d.scrollArrowsTaskId,
    };
  }
  return result;
}
