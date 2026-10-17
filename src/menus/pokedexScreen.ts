// pokedex_screen.c on the GBA layer: the Pokédex from the start menu (CB2_OpenPokedexFromStartMenu → the top menu
// (Task_PokedexScreen) → the numerical lists (Task_DexScreen_NumericalOrder) → the mon page
// (Task_DexScreen_ShowMonPage); the search lists (Task_DexScreen_CharacteristicOrder); CB2_ClosePokedex back to the
// field with the start menu open).
//
// Structure (for the units that add the rest): `sPokedexScreenData` is struct PokedexScreenData, allocated by
// DexScreen_LoadResources. The screen is one task whose function is swapped like the C's (`gTasks[taskId].func =
// Task_DexScreen_X; sPokedexScreenData.state = 0`), each task a `switch (state)`. Not ported yet (later units):
// Task_DexScreen_CategorySubmenu (the habitat pages, which the search lists' A also opens), the area page
// (DexScreen_DrawMonAreaPage, A on the mon page) and the registering after a catch. Picking them leaves the screen
// where it is (see the STUB comments).
//
// The data (gPokedexEntries, the orders, the categories, the footprints) comes from menus/pokedex.ts. No audio:
// the SE_* and cry calls are no-ops.

import { K } from '../battle/constants';
import { charmap, state } from '../battle/env';
import { GetMonSpritePalFromSpeciesAndPersonality, LoadSpecialPokePic, monPalSymbols, monPicSymbol } from '../battle/gfx';
import {
  ChangeBgX,
  BG_TILE_H_FLIP,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  FillBgTilemapBufferRect,
  FillBgTilemapBufferRect_Palette0,
  HideBg,
  InitBgsFromTemplates,
  IsDma3ManagerBusyWithBgCopy,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
  UnsetBgTilemapBuffer,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16, hasGfx, isGfxLoaded, loadGfx } from '../gba/gfx';
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
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_UP, gMain, JOY_NEW, SetMainCallback2, SetVBlankCallback, START_BUTTON } from '../gba/main';
import { DecompressAndCopyTileDataToVram, TEXT_COLOR_LIGHT_GRAY, TEXT_COLOR_TRANSPARENT, TEXT_COLOR_WHITE } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlayCry_NormalNoDucking, PlaySE } from '../gba/sound';
import { AnimateSprites, BuildOamBuffer, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks } from '../gba/task';
import {
  AddTextPrinterParameterized4,
  AddWindow,
  BlitBitmapRectToWindow,
  COPYWIN_GFX,
  CopyToWindowPixelBuffer,
  CopyWindowToVram,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  GetStringWidth,
  gWindows,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  RemoveWindow,
  RunTextPrinters,
  TEXT_SKIP_DRAW,
  WINDOW_NONE,
  type WindowTemplate,
} from '../gba/window';
import { isNationalDexEnabled } from '../script/specials';
import { EOS, EXT_CTRL_CODE_BEGIN } from '../text/charmap';
import { FONT_NORMAL, FONT_SMALL } from '../text/Font';
import { encodeRaw, speciesName, text } from './common';
import { CB2_ReturnToFieldWithOpenMenu } from './fieldCallbacks';
import { RemoveScrollIndicatorArrowPair, AddScrollIndicatorArrowPair, type ScrollArrowsTemplate } from './menuIndicators';
import { DexScreen_GetSetPokedexFlag, FLAG_GET_CAUGHT, FLAG_GET_SEEN, NationalPokedexNumToSpecies, pokedexData } from './pokedex';
import { DexScreen_DestroyAreaScreenResources, DexScreen_DrawMonAreaPage, pokedexAreaGfxSymbols } from './pokedexArea';
import { GetIconSpecies, monIconSymbol } from './pokemonIcon';

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

const sWindowTemplate_DexEntry_MonPic: WindowTemplate = { bg: 1, tilemapLeft: 19, tilemapTop: 3, width: 8, height: 8, paletteNum: 9, baseBlock: 0x01a8 };
const sWindowTemplate_DexEntry_SpeciesStats: WindowTemplate = { bg: 1, tilemapLeft: 2, tilemapTop: 3, width: 13, height: 8, paletteNum: 0, baseBlock: 0x01e8 };
const sWindowTemplate_DexEntry_FlavorText: WindowTemplate = { bg: 1, tilemapLeft: 0, tilemapTop: 11, width: 30, height: 7, paletteNum: 0, baseBlock: 0x0250 };

/**
 * sCategoryPageIconCoords[numMons - 1][slot]: the circular window's x/y, the rectangular window's x/y (tiles). The
 * mon page's zoom frame grows out of the rectangular one.
 */
const sCategoryPageIconCoords: [number, number, number, number][][] = [
  [[11, 3, 11, 11]],
  [
    [3, 3, 11, 3],
    [18, 9, 10, 11],
  ],
  [
    [1, 2, 9, 2],
    [11, 9, 3, 11],
    [21, 3, 21, 11],
  ],
  [
    [0, 2, 6, 3],
    [7, 10, 0, 12],
    [15, 10, 22, 11],
    [22, 2, 15, 4],
  ],
];

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
  for (const sym of pokedexAreaGfxSymbols()) syms.add(sym); // the area page (menus/pokedexArea.ts)
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
          RemoveScrollIndicatorArrowPair(d.scrollArrowsTaskId);
          d.dexOrderId = input - DEX_CATEGORY_COUNT;
          d.characteristicOrderMenuItemsAbove = d.characteristicOrderMenuCursorPos = 0;
          BeginNormalPaletteFade(~0x8000 >>> 0, 0, 0, 16, RGB_WHITEALPHA);
          d.state = 8;
        }
        break;
      }
      if (JOY_NEW(B_BUTTON)) d.state = 1;
      break;
    case 7:
      // Task_DexScreen_CategorySubmenu: W-dex unit 3 (see case 6).
      break;
    case 8:
      destroyModeSelectList(d);
      HideBg(1);
      DexScreen_RemoveWindow(d, 'modeSelectWindowId');
      DexScreen_RemoveWindow(d, 'selectionIconWindowId');
      DexScreen_RemoveWindow(d, 'dexCountsWindowId');
      gTasks[taskId].func = Task_DexScreen_CharacteristicOrder;
      d.state = 0;
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
          d.dexSpecies = d.characteristicMenuInput & 0xffff;
          DexScreen_LoadMonGfx(d.dexSpecies); // port: start fetching the page's pic during the fade
          RemoveScrollIndicatorArrowPair(d.scrollArrowsTaskId);
          BeginNormalPaletteFade(~0x8000 >>> 0, 0, 0, 16, RGB_WHITEALPHA);
          d.state = 7;
        }
      } else if (JOY_NEW(B_BUTTON)) {
        RemoveScrollIndicatorArrowPair(d.scrollArrowsTaskId);
        BeginNormalPaletteFade(~0x8000 >>> 0, 0, 0, 16, RGB_WHITEALPHA);
        d.state = 1;
      }
      break;
    case 7:
      DexScreen_DestroyDexOrderListMenu(d.dexOrderId);
      FillBgTilemapBufferRect_Palette0(1, 0x000, 0, 0, 32, 20);
      CopyBgTilemapBufferToVram(1);
      DexScreen_RemoveWindow(d, 'numericalOrderWindowId');
      gTasks[taskId].func = Task_DexScreen_ShowMonPage;
      d.state = 0;
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

// ------------------------------------------------------------------ the search lists

/** Task_DexScreen_CharacteristicOrder: A TO Z, TYPE, LIGHTEST, SMALLEST (from the top menu's SEARCH entries) */
function Task_DexScreen_CharacteristicOrder(taskId: number): void {
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
      DexScreen_CreateCharacteristicListMenu();
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
      // modeSelectListMenuId in the C (see Task_DexScreen_NumericalOrder)
      d.modeSelectCursorPosBak = ListMenuGetScrollAndRow(d.orderedListMenuTaskId).cursorPos;
      d.scrollArrowsTaskId = DexScreen_CreateDexOrderScrollArrows();
      d.state = 6;
      break;
    case 6:
      d.characteristicMenuInput = ListMenu_ProcessInput(d.orderedListMenuTaskId);
      d.modeSelectCursorPosBak = ListMenuGetScrollAndRow(d.orderedListMenuTaskId).cursorPos;
      if (JOY_NEW(A_BUTTON)) {
        // A opens the mon's habitat page (DexScreen_LookUpCategoryBySpecies picks the category, page and slot),
        // where A again shows the mon page.
        if ((d.characteristicMenuInput >>> 16) & 1 && !DexScreen_LookUpCategoryBySpecies(d.characteristicMenuInput & 0xffff)) {
          // STUB (W-dex unit 3): Task_DexScreen_CategorySubmenu isn't ported, so A stays inert here. The C:
          // RemoveScrollIndicatorArrowPair(d.scrollArrowsTaskId); BeginNormalPaletteFade(~0x8000, 0, 0, 16,
          // RGB_WHITEALPHA); d.state = 7;
          console.warn('[pokedex] the habitat pages are not implemented yet');
        }
      } else if (JOY_NEW(B_BUTTON)) {
        RemoveScrollIndicatorArrowPair(d.scrollArrowsTaskId);
        BeginNormalPaletteFade(~0x8000 >>> 0, 0, 0, 16, RGB_WHITEALPHA);
        d.state = 1;
      }
      break;
    case 7:
      // STUB (W-dex unit 3), the C: DexScreen_DestroyDexOrderListMenu(d.dexOrderId);
      // FillBgTilemapBufferRect_Palette0(1, 0, 0, 0, 32, 20); CopyBgTilemapBufferToVram(1);
      // DexScreen_RemoveWindow(d, 'numericalOrderWindowId'); d.parentOfCategoryMenu = 1;
      // gTasks[taskId].func = Task_DexScreen_CategorySubmenu; d.state = 0;
      break;
  }
}

/** DexScreen_CreateCharacteristicListMenu */
function DexScreen_CreateCharacteristicListMenu(): void {
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
  DexScreen_PrintStringWithAlignment(text('gText_SearchNoColor'), TEXT_CENTER);
  FillWindowPixelBuffer(1, PIXEL_FILL(15));
  DexScreen_PrintControlInfo(text('gText_PickOKExit'));
  CopyWindowToVram(0, COPYWIN_GFX);
  CopyWindowToVram(1, COPYWIN_GFX);
}

/**
 * DexScreen_LookUpCategoryBySpecies: the habitat, page and slot (counting the shown mons before it) of `species`;
 * FALSE if found.
 */
function DexScreen_LookUpCategoryBySpecies(species: number): boolean {
  const d = sd();
  const { categories } = pokedexData;
  for (let i = 0; i < categories.length; i++) {
    for (let j = 0; j < categories[i].length; j++) {
      const page = categories[i][j];
      let posInPage = 0;
      for (const dexSpecies of page) {
        if (species === dexSpecies) {
          d.category = i;
          d.pageNum = j;
          d.categoryCursorPosInPage = posInPage;
          return false;
        }
        if (DexScreen_CanShowMonInDex(dexSpecies) && DexScreen_GetSetPokedexFlag(state, dexSpecies, FLAG_GET_SEEN, true)) posInPage++;
      }
    }
  }
  return true;
}

// ------------------------------------------------------------------ the mon page

/** Task_DexScreen_ShowMonPage: the mon page from the numerical lists (the area page behind A) */
function Task_DexScreen_ShowMonPage(taskId: number): void {
  const d = sd();
  switch (d.state) {
    case 0:
      HideBg(3);
      HideBg(2);
      HideBg(1);
      d.state = 2;
      break;
    case 1:
      HideBg(2);
      HideBg(1);
      gTasks[taskId].func = Task_DexScreen_NumericalOrder;
      d.state = 0;
      break;
    case 2:
      // Port: the pic, palette and footprint load on demand; wait here until they're in (a frame or two).
      if (!DexScreen_LoadMonGfx(d.dexSpecies)) break;
      d.numMonsOnPage = 1;
      DexScreen_DrawMonDexPage(false);
      d.state = 3;
      break;
    case 3:
      CopyBgTilemapBufferToVram(3);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(0);
      PlayCry_NormalNoDucking(d.dexSpecies, 0, K.CRY_VOLUME_RS, K.CRY_PRIORITY_NORMAL);
      d.state = 4;
      break;
    case 4:
      BeginNormalPaletteFade(~0x8000 >>> 0, 0, 16, 0, RGB_WHITEALPHA);
      ShowBg(3);
      ShowBg(2);
      ShowBg(1);
      d.state = 5;
      break;
    case 5:
      if (JOY_NEW(A_BUTTON)) {
        RemoveDexPageWindows();
        FillBgTilemapBufferRect_Palette0(1, 0x000, 0, 2, 30, 16);
        CopyBgTilemapBufferToVram(1);
        d.state = 7;
      } else if (JOY_NEW(B_BUTTON)) {
        RemoveDexPageWindows();
        BeginNormalPaletteFade(~0x8000 >>> 0, 0, 0, 16, RGB_WHITEALPHA);
        d.state = 1;
      } else if (JOY_NEW(DPAD_UP) && DexScreen_TryScrollMonsVertical(1)) {
        DexScreen_LoadMonGfx(d.characteristicMenuInput & 0xffff);
        RemoveDexPageWindows();
        BeginNormalPaletteFade(~0x8000 >>> 0, 0, 0, 16, RGB_WHITEALPHA);
        d.state = 6;
      } else if (JOY_NEW(DPAD_DOWN) && DexScreen_TryScrollMonsVertical(0)) {
        DexScreen_LoadMonGfx(d.characteristicMenuInput & 0xffff);
        RemoveDexPageWindows();
        BeginNormalPaletteFade(~0x8000 >>> 0, 0, 0, 16, RGB_WHITEALPHA);
        d.state = 6;
      } else {
        DexScreen_InputHandler_StartToCry();
      }
      break;
    case 6:
      HideBg(2);
      HideBg(1);
      d.dexSpecies = d.characteristicMenuInput & 0xffff;
      d.state = 2;
      break;
    // The area page (menus/pokedexArea.ts: DexScreen_DrawMonAreaPage / DexScreen_DestroyAreaScreenResources).
    case 7:
      DexScreen_DrawMonAreaPage();
      d.state = 8;
      break;
    case 8:
      CopyBgTilemapBufferToVram(3);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(0);
      d.state = 9;
      break;
    case 9:
      if (JOY_NEW(A_BUTTON)) {
        BeginNormalPaletteFade(~0x8000 >>> 0, 0, 0, 16, RGB_WHITEALPHA);
        d.state = 12;
      } else if (JOY_NEW(B_BUTTON)) {
        FillBgTilemapBufferRect_Palette0(2, 0x000, 0, 2, 30, 16);
        FillBgTilemapBufferRect_Palette0(1, 0x000, 0, 2, 30, 16);
        FillBgTilemapBufferRect_Palette0(0, 0x000, 0, 2, 30, 16);
        CopyBgTilemapBufferToVram(2);
        CopyBgTilemapBufferToVram(1);
        CopyBgTilemapBufferToVram(0);
        d.state = 10;
      } else {
        DexScreen_InputHandler_StartToCry();
      }
      break;
    case 10:
      DexScreen_DestroyAreaScreenResources();
      d.state = 11;
      break;
    case 11:
      DexScreen_DrawMonDexPage(false);
      CopyBgTilemapBufferToVram(3);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(0);
      d.state = 5;
      break;
    case 12:
      DexScreen_DestroyAreaScreenResources();
      FillBgTilemapBufferRect_Palette0(0, 0x000, 0, 2, 30, 16);
      CopyBgTilemapBufferToVram(0);
      d.state = 1;
      break;
  }
}

/**
 * DexScreen_TryScrollMonsVertical: direction 1 = up. Moves the order's saved list cursor to the previous / next
 * seen mon (characteristicMenuInput = its list item), keeping it 4 rows from the edge like the list would.
 */
function DexScreen_TryScrollMonsVertical(direction: number): boolean {
  const d = sd();
  let cursorField: 'kantoOrderMenuCursorPos' | 'characteristicOrderMenuCursorPos' | 'nationalOrderMenuCursorPos';
  let itemsAboveField: 'kantoOrderMenuItemsAbove' | 'characteristicOrderMenuItemsAbove' | 'nationalOrderMenuItemsAbove';
  switch (d.dexOrderId) {
    default:
    case DEX_ORDER_NUMERICAL_KANTO:
      cursorField = 'kantoOrderMenuCursorPos';
      itemsAboveField = 'kantoOrderMenuItemsAbove';
      break;
    case DEX_ORDER_ATOZ:
    case DEX_ORDER_TYPE:
    case DEX_ORDER_LIGHTEST:
    case DEX_ORDER_SMALLEST:
      cursorField = 'characteristicOrderMenuCursorPos';
      itemsAboveField = 'characteristicOrderMenuItemsAbove';
      break;
    case DEX_ORDER_NUMERICAL_NATIONAL:
      cursorField = 'nationalOrderMenuCursorPos';
      itemsAboveField = 'nationalOrderMenuItemsAbove';
      break;
  }
  const count = d.orderedDexCount;
  let selectedIndex = d[cursorField] + d[itemsAboveField];
  if (direction) {
    if (selectedIndex === 0) return false;
    selectedIndex--;
    while (selectedIndex >= 0) {
      if ((d.listItems[selectedIndex].index >>> 16) & 1) break;
      selectedIndex--;
    }
    if (selectedIndex < 0) return false;
  } else {
    if (selectedIndex === count - 1) return false;
    selectedIndex++;
    while (selectedIndex < count) {
      if ((d.listItems[selectedIndex].index >>> 16) & 1) break;
      selectedIndex++;
    }
    if (selectedIndex >= count) return false;
  }
  d.characteristicMenuInput = d.listItems[selectedIndex].index;
  if (count > 9) {
    if (selectedIndex < 4) {
      d[cursorField] = 0;
      d[itemsAboveField] = selectedIndex;
    } else if (selectedIndex >= count - 4) {
      d[cursorField] = count - 9;
      d[itemsAboveField] = selectedIndex + 9 - count;
    } else {
      d[cursorField] = selectedIndex - 4;
      d[itemsAboveField] = 4;
    }
  } else {
    d[cursorField] = 0;
    d[itemsAboveField] = selectedIndex;
  }
  return true;
}

/** DexScreen_InputHandler_StartToCry */
function DexScreen_InputHandler_StartToCry(): void {
  if (JOY_NEW(START_BUTTON)) PlayCry_NormalNoDucking(sd().dexSpecies, 0, K.CRY_VOLUME_RS, K.CRY_PRIORITY_NORMAL);
}

/**
 * DexScreen_DexPageZoomEffectFrame: the mon page's frame on `bg`, grown from the category page's selected
 * rectangle by `scale` (0-6; at 6 it fills the screen between the bars).
 */
export function DexScreen_DexPageZoomEffectFrame(bg: number, scale: number): void {
  const d = sd();
  // The C indexes past sPageIconCoords_1Mon when the cursor isn't on slot 0; the clamps make that not matter at
  // scale 6 (the only scale the mon page uses), so the port clamps the index.
  const coords = d.numMonsOnPage ? sCategoryPageIconCoords[d.numMonsOnPage - 1] : sCategoryPageIconCoords[0];
  const [, , tileLeft, tileTop] = coords[Math.min(d.numMonsOnPage ? d.categoryCursorPosInPage : 0, coords.length - 1)];

  let width = 6 + scale * 4;
  let height = 3 + scale * 2;
  if (width >= 28) width = 28;
  if (height >= 14) height = 14;

  let left = tileLeft - Math.trunc((scale * 4) / 2);
  let top = tileTop - Math.trunc((scale * 2) / 2);
  if (left + width + 2 >= 30) left -= left + width + 2 - 30;
  else if (left < 0) left = 0;
  if (top + height + 2 >= 18) top -= top + height + 2 - 18;
  else if (top < 2) top = 2;

  const divY = top + 1 + (Math.trunc(height / 2) + 1); // the horizontal divider

  // Top edge
  FillBgTilemapBufferRect_Palette0(bg, 4, left, top, 1, 1);
  FillBgTilemapBufferRect_Palette0(bg, 5, left + 1, top, width, 1);
  FillBgTilemapBufferRect_Palette0(bg, BG_TILE_H_FLIP(4), left + 1 + width, top, 1, 1);
  // Bottom edge
  FillBgTilemapBufferRect_Palette0(bg, 10, left, top + 1 + height, 1, 1);
  FillBgTilemapBufferRect_Palette0(bg, 11, left + 1, top + 1 + height, width, 1);
  FillBgTilemapBufferRect_Palette0(bg, BG_TILE_H_FLIP(10), left + 1 + width, top + 1 + height, 1, 1);
  // Left edge
  FillBgTilemapBufferRect_Palette0(bg, 6, left, top + 1, 1, divY - top - 1);
  FillBgTilemapBufferRect_Palette0(bg, 7, left, divY, 1, 1);
  FillBgTilemapBufferRect_Palette0(bg, 9, left, divY + 1, 1, top + height - divY);
  // Right edge
  FillBgTilemapBufferRect_Palette0(bg, BG_TILE_H_FLIP(6), left + 1 + width, top + 1, 1, divY - top - 1);
  FillBgTilemapBufferRect_Palette0(bg, BG_TILE_H_FLIP(7), left + 1 + width, divY, 1, 1);
  FillBgTilemapBufferRect_Palette0(bg, BG_TILE_H_FLIP(9), left + 1 + width, divY + 1, 1, top + height - divY);
  // Interior
  FillBgTilemapBufferRect_Palette0(bg, 1, left + 1, top + 1, width, divY - top - 1);
  FillBgTilemapBufferRect_Palette0(bg, 8, left + 1, divY, width, 1);
  FillBgTilemapBufferRect_Palette0(bg, 2, left + 1, divY + 1, width, top + height - divY);
}

/** DexScreen_GetDefaultPersonality: the save's Unown / Spinda personalities aren't kept (see DEVIATIONS), so 0. */
export function DexScreen_GetDefaultPersonality(_species: number): number {
  return 0;
}

/** The graphics the mon page draws for `species`: its front pic, its palettes and its footprint. */
export function dexMonGfxSymbols(species: number): string[] {
  const syms = [monPicSymbol(true, species, DexScreen_GetDefaultPersonality(species)), ...monPalSymbols(species)];
  // The area page's icon (ListMenu_DrawMonIconGraphics)
  syms.push(monIconSymbol(GetIconSpecies(species, DexScreen_GetDefaultPersonality(species))));
  const footprint = pokedexData.footprints[species];
  if (footprint && hasGfx(footprint)) syms.push(footprint);
  return syms;
}

const sMonGfxLoading = new Map<number, Promise<void>>();

/**
 * Port: the screen can show any seen mon, so its pic, palettes and footprint load on demand. Starts the load (once)
 * and returns whether they're all in; a task waits in its state until then. Safe if the screen closes meanwhile
 * (the load only fills the graphics cache). W-dex unit 3's category pages and registered page use it too.
 */
export function DexScreen_LoadMonGfx(species: number): boolean {
  const syms = dexMonGfxSymbols(species);
  if (syms.every(isGfxLoaded)) return true;
  if (!sMonGfxLoading.has(species)) {
    sMonGfxLoading.set(
      species,
      loadGfx(syms)
        .catch((e) => console.error('[pokedex] loading graphics', species, e))
        .finally(() => sMonGfxLoading.delete(species)),
    );
  }
  return false;
}

/** DexScreen_LoadMonPicInWindow: LoadMonPicInWindow(species, SHINY_ODDS, personality, TRUE, paletteOffset >> 4, windowId) */
function DexScreen_LoadMonPicInWindow(windowId: number, species: number, paletteOffset: number): void {
  // CreateTrainerCardSprite: the 64x64 front pic blitted into the window, its palette into the BG slot
  const personality = DexScreen_GetDefaultPersonality(species);
  const framePics = new Uint8Array(4 * 0x800);
  LoadSpecialPokePic(true, species, personality, framePics);
  BlitBitmapRectToWindow(windowId, framePics, 0, 0, 0x40, 0x40, 0, 0, 0x40, 0x40);
  LoadPalette(GetMonSpritePalFromSpeciesAndPersonality(species, K.SHINY_ODDS, personality), BG_PLTT_ID(paletteOffset >> 4), PLTT_SIZE_4BPP);
}

/** What the mon page printed last (the test probe reads it). */
let sMonPageText: { name: string; category: string; height: string; weight: string; flavorText: string } | undefined;

/** DexScreen_PrintMonCategory: "SEED POKéMON", or "??????????? POKéMON" until caught */
function DexScreen_PrintMonCategory(windowId: number, species: number, x: number, y: number): string {
  const dexNum = state.pokemon.nationalDex(species);
  // u8 categoryName[12]: the string, EOS, then zeroes (CHAR_SPACE)
  const categoryName = encodeRaw(pokedexData.entries[dexNum].categoryName);
  const categoryStr: number[] = [];
  let index = 0;
  if (DexScreen_GetSetPokedexFlag(state, dexNum, FLAG_GET_CAUGHT, false)) {
    // REVISION 0 stops at the first space ("TINY TURTLE" prints as "TINY POKéMON"; REVISION 1 stops at EOS)
    while ((categoryName[index] ?? K.CHAR_SPACE) !== K.CHAR_SPACE && index < 11) {
      categoryStr[index] = categoryName[index];
      index++;
    }
  } else {
    while (index < 11) {
      categoryStr[index] = K.CHAR_QUESTION_MARK;
      index++;
    }
  }
  categoryStr[index] = EOS;
  DexScreen_AddTextPrinterParameterized(windowId, FONT_SMALL, categoryStr, x, y, 0);
  x += GetStringWidth(FONT_SMALL, categoryStr, 0);
  DexScreen_AddTextPrinterParameterized(windowId, FONT_SMALL, text('gText_PokedexPokemon'), x, y, 0);
  return charmap.decodePlain(categoryStr) + charmap.decodePlain(text('gText_PokedexPokemon'));
}

/** DexScreen_PrintMonHeight: HT and feet'inches" (from decimetres), or ??'??" until caught */
function DexScreen_PrintMonHeight(windowId: number, species: number, x: number, y: number): string {
  const dexNum = state.pokemon.nationalDex(species);
  const height = pokedexData.entries[dexNum].height;
  const buffer: number[] = [EXT_CTRL_CODE_BEGIN, K.EXT_CTRL_CODE_MIN_LETTER_SPACING, 5, K.CHAR_SPACE];
  if (DexScreen_GetSetPokedexFlag(state, dexNum, FLAG_GET_CAUGHT, false)) {
    let inches = Math.trunc((10000 * height) / 254); // tenths of inches here
    if (inches % 10 >= 5) inches += 10;
    const feet = Math.trunc(inches / 120);
    inches = Math.trunc((inches - feet * 120) / 10);
    if (Math.trunc(feet / 10) === 0) {
      buffer.push(0, feet + K.CHAR_0);
    } else {
      buffer.push(Math.trunc(feet / 10) + K.CHAR_0, (feet % 10) + K.CHAR_0);
    }
    buffer.push(K.CHAR_SGL_QUOTE_RIGHT, Math.trunc(inches / 10) + K.CHAR_0, (inches % 10) + K.CHAR_0, K.CHAR_DBL_QUOTE_RIGHT, EOS);
  } else {
    const q = K.CHAR_QUESTION_MARK;
    buffer.push(q, q, K.CHAR_SGL_QUOTE_RIGHT, q, q, K.CHAR_DBL_QUOTE_RIGHT);
  }
  buffer.push(EOS);
  DexScreen_AddTextPrinterParameterized(windowId, FONT_SMALL, text('gText_HT'), x, y, 0);
  x += 30;
  DexScreen_AddTextPrinterParameterized(windowId, FONT_SMALL, buffer, x, y, 0);
  return charmap.decodePlain(text('gText_HT')) + charmap.decodePlain(buffer.slice(3));
}

/** DexScreen_PrintMonWeight: WT and the pounds (from hectograms) to a tenth, or ????.? until caught */
function DexScreen_PrintMonWeight(windowId: number, species: number, x: number, y: number): string {
  const dexNum = state.pokemon.nationalDex(species);
  const weight = pokedexData.entries[dexNum].weight;
  const lbsText = text('gText_Lbs');
  const buffer: number[] = [EXT_CTRL_CODE_BEGIN, K.EXT_CTRL_CODE_MIN_LETTER_SPACING, 5];
  if (DexScreen_GetSetPokedexFlag(state, dexNum, FLAG_GET_CAUGHT, false)) {
    let lbs = Math.trunc((weight * 100000) / 4536); // hundredths of a lb
    if (lbs % 10 >= 5) lbs += 10; // round to the nearest 0.1 lb
    // The leading digits: a space until the first non-zero one
    let output = false;
    for (const div of [100000, 10000, 1000]) {
      const digit = Math.trunc(lbs / div);
      if (digit === 0 && !output) {
        buffer.push(K.CHAR_SPACE);
      } else {
        output = true;
        buffer.push(digit + K.CHAR_0);
      }
      lbs %= div;
    }
    buffer.push(Math.trunc(lbs / 100) + K.CHAR_0);
    lbs %= 100;
    buffer.push(K.CHAR_PERIOD, Math.trunc(lbs / 10) + K.CHAR_0);
  } else {
    const q = K.CHAR_QUESTION_MARK;
    buffer.push(q, q, q, q, K.CHAR_PERIOD, q);
  }
  buffer.push(K.CHAR_SPACE, EXT_CTRL_CODE_BEGIN, K.EXT_CTRL_CODE_MIN_LETTER_SPACING, 0);
  for (let j = 0; buffer.length < 33 && lbsText[j] !== EOS; j++) buffer.push(lbsText[j]);
  buffer.push(EOS);
  DexScreen_AddTextPrinterParameterized(windowId, FONT_SMALL, text('gText_WT'), x, y, 0);
  x += 30;
  DexScreen_AddTextPrinterParameterized(windowId, FONT_SMALL, buffer, x, y, 0);
  const n = buffer.length;
  return charmap.decodePlain(text('gText_WT')) + charmap.decodePlain(buffer.slice(3, n - lbsText.length - 4)) + ' ' + charmap.decodePlain(lbsText);
}

/** DexScreen_PrintMonFlavorText: the entry's description, centred; nothing until caught */
function DexScreen_PrintMonFlavorText(windowId: number, species: number, x: number, y: number): string {
  const dexNum = state.pokemon.nationalDex(species);
  if (!DexScreen_GetSetPokedexFlag(state, dexNum, FLAG_GET_CAUGHT, false)) return '';
  const description = encodeRaw(pokedexData.entries[dexNum].description);
  const length = GetStringWidth(FONT_NORMAL, description, 0) & 0xffff;
  const xCenter = x + Math.trunc((240 - length) / 2);
  x = xCenter > 0 ? xCenter : 0;
  AddTextPrinterParameterized4(windowId, FONT_NORMAL, x, y, 1, 0, [0, 1, 2], TEXT_SKIP_DRAW, description);
  return charmap.decodePlain(description);
}

/** DexScreen_DrawMonFootprint: the 1bpp footprint expanded to 4bpp (colour 1), 16x16 at (x, y); only once caught */
function DexScreen_DrawMonFootprint(windowId: number, species: number, x: number, y: number): void {
  if (!DexScreen_GetSetPokedexFlag(state, species, FLAG_GET_CAUGHT, true)) return;
  const footprint = gfx(pokedexData.footprints[species]);
  const buffer = new Uint8Array(32 * 4); // gDecompressionBuffer
  let tileIdx = 0;
  for (let i = 0; i < 32; i++) {
    const footprintPixel = footprint[i];
    for (let j = 0; j < 8 / 2; j++) {
      let footprintTile = 0;
      if (footprintPixel & (1 << (j * 2))) footprintTile |= 0x01;
      if (footprintPixel & (2 << (j * 2))) footprintTile |= 0x10;
      buffer[tileIdx++] = footprintTile;
    }
  }
  BlitBitmapRectToWindow(windowId, buffer, 0, 0, 16, 16, x, y, 16, 16);
}

/** DexScreen_DrawMonDexPage: the frame, the pic, number / name / category / height / weight / footprint, the entry */
export function DexScreen_DrawMonDexPage(justRegistered: boolean): number {
  const d = sd();
  DexScreen_DexPageZoomEffectFrame(3, 6);
  FillBgTilemapBufferRect_Palette0(2, 0, 0, 0, 30, 20);
  FillBgTilemapBufferRect_Palette0(1, 0, 0, 0, 30, 20);
  FillBgTilemapBufferRect_Palette0(0, 0, 0, 2, 30, 16);

  d.windowIds[0] = AddWindow(sWindowTemplate_DexEntry_MonPic);
  d.windowIds[1] = AddWindow(sWindowTemplate_DexEntry_SpeciesStats);
  d.windowIds[2] = AddWindow(sWindowTemplate_DexEntry_FlavorText);

  // Mon pic
  FillWindowPixelBuffer(d.windowIds[0], PIXEL_FILL(0));
  DexScreen_LoadMonPicInWindow(d.windowIds[0], d.dexSpecies, 144);
  PutWindowTilemap(d.windowIds[0]);
  CopyWindowToVram(d.windowIds[0], COPYWIN_GFX);

  // Species stats
  const stats = d.windowIds[1];
  FillWindowPixelBuffer(stats, PIXEL_FILL(0));
  DexScreen_PrintMonDexNo(stats, FONT_SMALL, d.dexSpecies, 0, 8);
  DexScreen_AddTextPrinterParameterized(stats, FONT_NORMAL, speciesName(d.dexSpecies), 28, 8, 0);
  const category = DexScreen_PrintMonCategory(stats, d.dexSpecies, 0, 24);
  const height = DexScreen_PrintMonHeight(stats, d.dexSpecies, 0, 36);
  const weight = DexScreen_PrintMonWeight(stats, d.dexSpecies, 0, 48);
  DexScreen_DrawMonFootprint(stats, d.dexSpecies, 88, 40);
  PutWindowTilemap(stats);
  CopyWindowToVram(stats, COPYWIN_GFX);

  // Dex entry
  FillWindowPixelBuffer(d.windowIds[2], PIXEL_FILL(0));
  const flavorText = DexScreen_PrintMonFlavorText(d.windowIds[2], d.dexSpecies, 0, 8);
  PutWindowTilemap(d.windowIds[2]);
  CopyWindowToVram(d.windowIds[2], COPYWIN_GFX);

  // Control info
  FillWindowPixelBuffer(1, PIXEL_FILL(15));
  if (!justRegistered) {
    DexScreen_AddTextPrinterParameterized(1, FONT_SMALL, text('gText_Cry'), 8, 2, 4);
    DexScreen_PrintControlInfo(text('gText_NextDataCancel'));
  } else {
    DexScreen_PrintControlInfo(text('gText_Next'));
  }
  PutWindowTilemap(1);
  CopyWindowToVram(1, COPYWIN_GFX);

  sMonPageText = { name: charmap.decodePlain(speciesName(d.dexSpecies)), category, height, weight, flavorText };
  return 1;
}

/** RemoveDexPageWindows */
export function RemoveDexPageWindows(): number {
  const d = sd();
  for (let i = 0; i < 3; i++) {
    if (d.windowIds[i] !== WINDOW_NONE) {
      RemoveWindow(d.windowIds[i]);
      d.windowIds[i] = WINDOW_NONE;
    }
  }
  return 0;
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

/** Non-zero pixels in a window's rect (the probe's check that a pic / footprint was drawn). */
function windowPixelsInRect(windowId: number, x0: number, y0: number, w: number, h: number): number {
  const win = gWindows[windowId];
  const td = win?.tileData;
  if (!td) return 0;
  const widthTiles = win.window.width;
  let n = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const byte = td[((y >> 3) * widthTiles + (x >> 3)) * 32 + (y & 7) * 4 + ((x & 7) >> 1)];
      if ((x & 1 ? byte >> 4 : byte & 0xf) !== 0) n++;
    }
  }
  return n;
}

/** The screen while it's up: the task and its state, the counts, the top menu, the ordered lists, the mon page. */
export function pokedexScreenProbe():
  | {
      task: string;
      state: number;
      /** The task takes input (Task_PokedexScreen / the ordered lists in state 6, the mon page in 5) and no fade runs. */
      ready: boolean;
      counts: { seenKanto: number; ownedKanto: number; seenNational: number; ownedNational: number };
      unlockedCategories: number;
      /** The top menu's list: its scroll and row, and the selected item's index (DEX_CATEGORY_* / DEX_MODE(*) / LIST_CANCEL) */
      modeSelect?: { cursorPos: number; itemsAbove: number; selected: number };
      /**
       * The numerical or search list: DEX_ORDER_*, how many rows, its scroll and row, the selected row's species, seen,
       * caught; `items` is every row's species in order.
       */
      orderedList?: { order: number; count: number; cursorPos: number; itemsAbove: number; species: number; seen: boolean; caught: boolean; arrows: number; items: number[] };
      /**
       * The mon page (Task_DexScreen_ShowMonPage with its windows up): the species, what it printed, and how many
       * pixels the pic and the footprint drew.
       */
      monPage?: { species: number; name: string; category: string; height: string; weight: string; flavorText: string; picPixels: number; footprintPixels: number };
    }
  | undefined {
  const d = sPokedexScreenData;
  if (!d) return undefined;
  const task = gTasks[d.taskId];
  const taskName = task.isActive ? task.func.name : '';
  const inputState = taskName === 'Task_DexScreen_ShowMonPage' ? 5 : 6;
  const result: ReturnType<typeof pokedexScreenProbe> = {
    task: taskName,
    state: d.state,
    ready: task.isActive && d.state === inputState && !gPaletteFade.active,
    counts: { seenKanto: d.numSeenKanto, ownedKanto: d.numOwnedKanto, seenNational: d.numSeenNational, ownedNational: d.numOwnedNational },
    unlockedCategories: d.unlockedCategories,
  };
  if (taskName === 'Task_PokedexScreen' && d.state >= 5 && d.state <= 6) {
    const { cursorPos, itemsAbove } = ListMenuGetScrollAndRow(d.modeSelectListMenuId);
    const items = modeSelectItems(isNationalDexEnabled(state));
    result.modeSelect = { cursorPos, itemsAbove, selected: items[cursorPos + itemsAbove].index };
  }
  if ((taskName === 'Task_DexScreen_NumericalOrder' || taskName === 'Task_DexScreen_CharacteristicOrder') && d.state >= 5 && d.state <= 6) {
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
      items: d.listItems.slice(0, d.orderedDexCount).map((item) => item.index & 0xffff),
    };
  }
  if (taskName === 'Task_DexScreen_ShowMonPage' && d.windowIds[1] !== WINDOW_NONE && sMonPageText) {
    result.monPage = {
      species: d.dexSpecies,
      ...sMonPageText,
      picPixels: windowPixelsInRect(d.windowIds[0], 0, 0, 64, 64),
      footprintPixels: windowPixelsInRect(d.windowIds[1], 88, 40, 16, 16),
    };
  }
  return result;
}
