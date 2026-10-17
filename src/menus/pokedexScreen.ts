// pokedex_screen.c on the GBA layer: the Pokédex from the start menu (CB2_OpenPokedexFromStartMenu → the top menu
// (Task_PokedexScreen) → the numerical lists (Task_DexScreen_NumericalOrder) → the mon page
// (Task_DexScreen_ShowMonPage); the habitat pages (Task_DexScreen_CategorySubmenu, from the top menu's habitats and
// from A on a search list); the search lists (Task_DexScreen_CharacteristicOrder); CB2_ClosePokedex back to the
// field with the start menu open), and the "registered in the Pokédex" page after a catch
// (DexScreen_RegisterMonToPokedex, from the battle's Cmd_displaydexinfo).
//
// Structure: `sPokedexScreenData` is struct PokedexScreenData, allocated by DexScreen_LoadResources. The screen is
// one task whose function is swapped like the C's (`gTasks[taskId].func = Task_DexScreen_X;
// sPokedexScreenData.state = 0`), each task a `switch (state)`. The area page (DexScreen_DrawMonAreaPage) is a
// placeholder until W-dexarea's area page replaces it.
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
  CopyToBgTilemapBufferRect_ChangePalette,
  FillBgTilemapBufferRect,
  FillBgTilemapBufferRect_Palette0,
  GetBgTilemapBuffer,
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
import { ClearGpuRegBits, DISPCNT_WIN0_ON, DISPCNT_WIN1_ON, PALETTES_ALL, REG_OFFSET_BLDALPHA, REG_OFFSET_BLDCNT, REG_OFFSET_BLDY, REG_OFFSET_DISPCNT, RGB, RGB_BLACK, RGB_WHITE, SetGpuReg, SetGpuRegBits } from '../gba/hw';
import {
  BlitMenuInfoIcon,
  DestroyListMenuTask,
  LIST_CANCEL,
  LIST_HEADER,
  ListMenu_ProcessInput,
  ListMenuAddCursorObjectInternal,
  ListMenuDefaultCursorMoveFunc,
  ListMenuGetScrollAndRow,
  ListMenuInit,
  ListMenuInitInRect,
  ListMenuLoadStdPalAt,
  ListMenuOverrideSetColors,
  ListMenuRemoveCursorObject,
  ListMenuUpdateCursorObject,
  type CursorStruct,
  type ListMenuItem,
  type ListMenuTemplate,
  type ListMenuWindowRect,
} from '../gba/listMenu';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_UP, gMain, JOY_HELD, JOY_NEW, JOY_REPT, L_BUTTON, R_BUTTON, SetMainCallback2, SetVBlankCallback, START_BUTTON } from '../gba/main';
import { DecompressAndCopyTileDataToVram, TEXT_COLOR_LIGHT_GRAY, TEXT_COLOR_TRANSPARENT, TEXT_COLOR_WHITE } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, LoadPalette, OBJ_PLTT_ID, PLTT_ID, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
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
import { concat, ConvertIntToDecimalStringN, encodeRaw, speciesName, STR_CONV_MODE_RIGHT_ALIGN, text } from './common';
import { CB2_ReturnToFieldWithOpenMenu } from './fieldCallbacks';
import { RemoveScrollIndicatorArrowPair, AddScrollIndicatorArrowPair, type ScrollArrowsTemplate } from './menuIndicators';
import { DexScreen_GetSetPokedexFlag, FLAG_GET_CAUGHT, FLAG_GET_SEEN, FLAG_SET_CAUGHT, FLAG_SET_SEEN, NationalPokedexNumToSpecies, pokedexData } from './pokedex';

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
  /** The page turn's copy of BG3 / BG2 / BG1's tilemaps (0x400 entries each), while a page flips */
  bgBufsMem: Uint16Array | null;
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
    bgBufsMem: null,
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

/** sDexScreen_CategoryCursorPals: the page's unselected frame colours, then the selection's pulse (4 steps) */
const sDexScreen_CategoryCursorPals = [
  RGB(24, 22, 17), RGB(26, 24, 20),
  RGB(26, 20, 15), RGB(27, 23, 19),
  RGB(28, 18, 15), RGB(28, 22, 19),
  RGB(30, 16, 13), RGB(29, 21, 18),
  RGB(28, 18, 15), RGB(28, 22, 19),
  RGB(26, 20, 15), RGB(27, 23, 19),
]; // prettier-ignore

/** sWindowTemplate_CategoryMonIcon / sWindowTemplate_CategoryMonInfo (placed per slot) */
const sWindowTemplate_CategoryMonIcon: WindowTemplate = { bg: 2, tilemapLeft: 0, tilemapTop: 0, width: 8, height: 8, paletteNum: 0, baseBlock: 0x0000 };
const sWindowTemplate_CategoryMonInfo: WindowTemplate = { bg: 1, tilemapLeft: 0, tilemapTop: 0, width: 8, height: 5, paletteNum: 0, baseBlock: 0x0000 };

/** sDexCategoryNamePtrs */
const sDexCategoryNamePtrs = [
  'gText_DexCategory_GrasslandPkmn',
  'gText_DexCategory_ForestPkmn',
  'gText_DexCategory_WatersEdgePkmn',
  'gText_DexCategory_SeaPkmn',
  'gText_DexCategory_CavePkmn',
  'gText_DexCategory_MountainPkmn',
  'gText_DexCategory_RoughTerrainPkmn',
  'gText_DexCategory_UrbanPkmn',
  'gText_DexCategory_RarePkmn',
];

/** sDexScreenPageTurnColumns[step][column]: the old page's column shown there (30 = blank) */
const sDexScreenPageTurnColumns: number[][] = [
  [30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [5, 11, 17, 23, 29, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [2, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [2, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19, 20, 22, 23, 25, 26, 28, 29, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 19, 20, 21, 23, 24, 25, 27, 28, 29, 30, 30, 30, 30, 30, 30, 30],
  [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30, 30, 30, 30],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 30, 30],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
];

const sScrollArrowsTemplate_CategoryMenu: ScrollArrowsTemplate = {
  firstArrowType: 0,
  firstX: 16,
  firstY: 80,
  secondArrowType: 1,
  secondX: 224,
  secondY: 80,
  fullyUpThreshold: 0,
  fullyDownThreshold: 0,
  tileTag: 2000,
  palTag: 0xffff,
  palNum: 1,
};

/** sCursorStruct_CategoryPage: the red outline around the selected mon's info box */
const sCursorStruct_CategoryPage: CursorStruct = { left: 0, top: 160, rowWidth: 64, rowHeight: 40, tileTag: 2002, palTag: 0xffff, palNum: 4 };

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
    // the habitat pages
    'sCategoryMonInfoBgTiles',
    'sCategoryPageIconWindowBg',
    'sDexScreen_CaughtIcon',
    'sSelectorOutlineGfx',
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
            RemoveScrollIndicatorArrowPair(d.scrollArrowsTaskId);
            d.category = input;
            BeginNormalPaletteFade(~0x8000 >>> 0, 0, 0, 16, RGB_WHITEALPHA);
            d.state = 7;
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
      destroyModeSelectList(d);
      FillBgTilemapBufferRect_Palette0(1, 0, 0, 0, 32, 20);
      CopyBgTilemapBufferToVram(1);
      DexScreen_RemoveWindow(d, 'modeSelectWindowId');
      DexScreen_RemoveWindow(d, 'selectionIconWindowId');
      DexScreen_RemoveWindow(d, 'dexCountsWindowId');
      d.pageNum = 0;
      d.categoryCursorPosInPage = 0;
      d.parentOfCategoryMenu = 0;
      gTasks[taskId].func = Task_DexScreen_CategorySubmenu;
      d.state = 0;
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
      d.parentOfCategoryMenu = 1;
      gTasks[taskId].func = Task_DexScreen_CategorySubmenu;
      d.state = 0;
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

// ------------------------------------------------------------------ the habitat pages

/** u8 arithmetic for sPokedexScreenData->data[] */
const u8 = (v: number) => v & 0xff;

/**
 * Port: the pics, palettes and footprints of the mons on a habitat page load on demand (see DexScreen_LoadMonGfx).
 * Starts their loads and returns whether they're all in.
 */
function DexScreen_LoadCategoryPageGfx(category: number, pageNum: number): boolean {
  const page = pokedexData.categories[category]?.[pageNum] ?? [];
  return page.map((species) => !(DexScreen_CanShowMonInDex(species) && DexScreen_GetSetPokedexFlag(state, species, FLAG_GET_SEEN, true)) || DexScreen_LoadMonGfx(species)).every(Boolean);
}

/** The graphics the registered page after catching `species` draws: the screen's and its habitat page's mons'. */
export function dexRegisterGfxSymbols(species: number): string[] {
  const syms = new Set(pokedexScreenGfxSymbols());
  for (const category of pokedexData.categories) {
    for (const page of category) {
      if (!page.includes(species)) continue;
      for (const s of page) dexMonGfxSymbols(s).forEach((sym) => syms.add(sym));
    }
  }
  return [...syms];
}

/** Task_DexScreen_CategorySubmenu: a habitat's pages (from the top menu, or a search list's A), and its mons' pages */
function Task_DexScreen_CategorySubmenu(taskId: number): void {
  const d = sd();
  switch (d.state) {
    case 0:
      HideBg(3);
      HideBg(2);
      HideBg(1);
      DexScreen_GetPageLimitsForCategory(d.category);
      if (d.pageNum < d.firstPageInCategory) d.pageNum = d.firstPageInCategory;
      d.state = 2;
      break;
    case 1:
      DexScreen_DestroyCategoryPageMonIconAndInfoWindows();
      HideBg(2);
      HideBg(1);
      switch (d.parentOfCategoryMenu) {
        case 0:
        default:
          gTasks[taskId].func = Task_PokedexScreen;
          break;
        case 1:
          gTasks[taskId].func = Task_DexScreen_CharacteristicOrder;
          break;
      }
      d.state = 0;
      break;
    case 2:
      // Port: wait for the page's mon graphics (a frame or two the first time)
      if (!DexScreen_LoadCategoryPageGfx(d.category, d.pageNum)) break;
      DexScreen_CreateCategoryListGfx(false);
      CopyBgTilemapBufferToVram(3);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      DexScreen_CreateCategoryPageSelectionCursor(0xff);
      d.state = 3;
      break;
    case 3:
      BeginNormalPaletteFade(~0x8000 >>> 0, 0, 16, 0, RGB_WHITEALPHA);
      ShowBg(3);
      ShowBg(2);
      ShowBg(1);
      d.state = 4;
      break;
    case 4:
      d.scrollArrowsTaskId = DexScreen_CreateCategoryMenuScrollArrows();
      d.categoryPageCursorTaskId = ListMenuAddCursorObjectInternal(sCursorStruct_CategoryPage, 0);
      d.state = 5;
      break;
    case 5: {
      DexScreen_CreateCategoryPageSelectionCursor(d.categoryCursorPosInPage);
      DexScreen_UpdateCategoryPageCursorObject(d.categoryPageCursorTaskId, d.categoryCursorPosInPage, d.numMonsOnPage);
      d.modeSelectCursorPosBak = d.pageNum;
      let pageFlipCmd = 0;
      if (JOY_NEW(A_BUTTON) && DexScreen_GetSetPokedexFlag(state, d.pageSpecies[d.categoryCursorPosInPage], FLAG_GET_SEEN, true)) {
        RemoveScrollIndicatorArrowPair(d.scrollArrowsTaskId);
        ListMenuRemoveCursorObject(d.categoryPageCursorTaskId, 0);
        d.state = 12;
        break;
      }
      if (!JOY_HELD(R_BUTTON) && JOY_REPT(DPAD_LEFT)) {
        if (d.categoryCursorPosInPage !== 0) {
          d.categoryCursorPosInPage--;
          PlaySE(K.SE_SELECT);
          break;
        } else {
          pageFlipCmd = 1;
        }
      }
      if (!JOY_HELD(R_BUTTON) && JOY_REPT(DPAD_RIGHT)) {
        if (d.categoryCursorPosInPage < d.numMonsOnPage - 1) {
          d.categoryCursorPosInPage++;
          PlaySE(K.SE_SELECT);
          break;
        } else {
          pageFlipCmd = 2;
        }
      }
      if (pageFlipCmd === 0) pageFlipCmd = DexScreen_InputHandler_GetShoulderInput();
      switch (pageFlipCmd) {
        case 0: // No action
          break;
        case 1: // Left: the previous unlocked page, or leave the habitat at the first
          while (d.pageNum > d.firstPageInCategory) {
            d.pageNum--;
            if (DexScreen_IsPageUnlocked(d.category, d.pageNum)) {
              d.state = 8;
              break;
            }
          }
          if (d.state !== 8) d.state = 6;
          break;
        case 2: // Right: the next unlocked page, or leave the habitat at the last
          while (d.pageNum < d.lastPageInCategory - 1) {
            d.pageNum++;
            if (DexScreen_IsPageUnlocked(d.category, d.pageNum)) {
              d.state = 10;
              break;
            }
          }
          if (d.state !== 10) d.state = 6;
          break;
      }
      if (JOY_NEW(B_BUTTON)) d.state = 6;
      break;
    }
    case 6:
    case 7:
      RemoveScrollIndicatorArrowPair(d.scrollArrowsTaskId);
      ListMenuRemoveCursorObject(d.categoryPageCursorTaskId, 0);
      BeginNormalPaletteFade(~0x8000 >>> 0, 0, 0, 16, RGB_WHITEALPHA);
      d.state = 1;
      break;
    case 8:
    case 10:
      DexScreen_DestroyCategoryPageMonIconAndInfoWindows();
      DexScreen_CreateCategoryPageSelectionCursor(0xff);
      ListMenuUpdateCursorObject(d.categoryPageCursorTaskId, 0, 0xa0, 0);
      d.categoryPageSelectionCursorTimer = 0;
      d.data[0] = 0;
      d.state++;
      break;
    case 9:
      if (DexScreen_FlipCategoryPageInDirection(0)) {
        d.categoryCursorPosInPage = d.numMonsOnPage - 1;
        d.state = 5;
      }
      break;
    case 11:
      if (DexScreen_FlipCategoryPageInDirection(1)) {
        d.categoryCursorPosInPage = 0;
        d.state = 5;
      }
      break;
    case 12:
      d.dexSpecies = d.pageSpecies[d.categoryCursorPosInPage];
      PlaySE(K.SE_SELECT);
      d.state = 14;
      break;
    case 13:
      RemoveDexPageWindows();
      d.state = 4;
      break;
    case 14:
      if (!DexScreen_LoadMonGfx(d.dexSpecies)) break; // port: loaded with the page already
      DexScreen_DrawMonDexPage(false);
      d.state = 15;
      break;
    case 15:
      d.data[0] = 0;
      d.data[1] = 0;
      d.state++;
    // fallthrough
    case 16:
      if (!DexScreen_ZoomInFrame()) break;
      CopyBgTilemapBufferToVram(3);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(0);
      PlayCry_NormalNoDucking(d.dexSpecies, 0, K.CRY_VOLUME_RS, K.CRY_PRIORITY_NORMAL);
      d.data[0] = 0;
      d.state = 17;
      break;
    case 17:
      if (JOY_NEW(A_BUTTON)) {
        RemoveDexPageWindows();
        FillBgTilemapBufferRect_Palette0(1, 0x000, 0, 2, 30, 16);
        CopyBgTilemapBufferToVram(1);
        d.state = 21;
      } else if (JOY_NEW(B_BUTTON)) {
        d.state = 18;
      } else {
        DexScreen_InputHandler_StartToCry();
      }
      break;
    case 18:
      DexScreen_CreateCategoryListGfx(false);
      DexScreen_DexPageZoomEffectFrame(0, 6);
      CopyBgTilemapBufferToVram(3);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(0);
      d.state = 19;
      break;
    case 19:
      d.data[0] = 0;
      d.data[1] = 6;
      d.state++;
    // fallthrough
    case 20:
      if (d.data[1]) {
        if (d.data[0]) {
          d.data[1]--;
          FillBgTilemapBufferRect_Palette0(0, 0x000, 0, 2, 30, 16);
          DexScreen_DexPageZoomEffectFrame(0, d.data[1]);
          CopyBgTilemapBufferToVram(0);
          d.data[0] = 1;
        } else {
          d.data[0] = u8(d.data[0] - 1);
        }
      } else {
        FillBgTilemapBufferRect_Palette0(0, 0x000, 0, 2, 30, 16);
        CopyBgTilemapBufferToVram(0);
        d.state = 13;
      }
      break;
    // The area page (DexScreen_DrawMonAreaPage / DexScreen_DestroyAreaScreenResources)
    case 21:
      DexScreen_DrawMonAreaPage();
      d.state = 22;
      break;
    case 22:
      CopyBgTilemapBufferToVram(3);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(0);
      d.state = 23;
      break;
    case 23:
      if (JOY_NEW(A_BUTTON) || JOY_NEW(B_BUTTON)) {
        const back = JOY_NEW(B_BUTTON) && !JOY_NEW(A_BUTTON);
        FillBgTilemapBufferRect_Palette0(2, 0x000, 0, 2, 30, 16);
        FillBgTilemapBufferRect_Palette0(1, 0x000, 0, 2, 30, 16);
        FillBgTilemapBufferRect_Palette0(0, 0x000, 0, 2, 30, 16);
        CopyBgTilemapBufferToVram(2);
        CopyBgTilemapBufferToVram(1);
        CopyBgTilemapBufferToVram(0);
        d.state = back ? 24 : 26; // A: back to the habitat page; B: back to the mon page
      } else {
        DexScreen_InputHandler_StartToCry();
      }
      break;
    case 24:
      DexScreen_DestroyAreaScreenResources();
      d.state = 25;
      break;
    case 25:
      DexScreen_DrawMonDexPage(false);
      CopyBgTilemapBufferToVram(3);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(0);
      d.state = 17;
      break;
    case 26:
      DexScreen_DestroyAreaScreenResources();
      d.state = 18;
      break;
  }
}

/**
 * The mon page's zoom in (Task_DexScreen_CategorySubmenu 16 / Task_DexScreen_RegisterMonToPokedex 10): the frame
 * grows from the selected box over 6 steps (one wait frame first, data[0] being a u8). TRUE once it's done and BG0's
 * frame is cleared (the full-size one is on BG3).
 */
function DexScreen_ZoomInFrame(): boolean {
  const d = sd();
  if (d.data[1] < 6) {
    if (d.data[0]) {
      DexScreen_DexPageZoomEffectFrame(0, d.data[1]);
      CopyBgTilemapBufferToVram(0);
      d.data[0] = 4;
      d.data[1]++;
    } else {
      d.data[0] = u8(d.data[0] - 1);
    }
    return false;
  }
  FillBgTilemapBufferRect_Palette0(0, 0x000, 0, 2, 30, 16);
  return true;
}

/** DexScreen_CreateCategoryMenuScrollArrows: the left / right arrows, hidden at the first / last unlocked page */
function DexScreen_CreateCategoryMenuScrollArrows(): number {
  const d = sd();
  const template = { ...sScrollArrowsTemplate_CategoryMenu, fullyUpThreshold: d.firstPageInCategory, fullyDownThreshold: d.lastPageInCategory - 1 };
  d.modeSelectCursorPosBak = d.pageNum;
  return AddScrollIndicatorArrowPair(template, () => sd().modeSelectCursorPosBak);
}

/** DexScreen_InputHandler_GetShoulderInput: 1 flips left, 2 right, 0 nothing (only with BUTTON MODE LR or L=A) */
function DexScreen_InputHandler_GetShoulderInput(): number {
  switch (state.optionsButtonMode) {
    case K.OPTIONS_BUTTON_MODE_L_EQUALS_A:
      if (gMain.heldKeys & R_BUTTON && gMain.newKeys & DPAD_LEFT) return 1;
      else if (gMain.heldKeys & R_BUTTON && gMain.newKeys & DPAD_RIGHT) return 2;
      else return 0;
    case K.OPTIONS_BUTTON_MODE_LR:
      if (gMain.newKeys & L_BUTTON) return 1;
      else if (gMain.newKeys & R_BUTTON) return 2;
      else return 0;
    case K.OPTIONS_BUTTON_MODE_HELP:
    default:
      return 0;
  }
}

/** DexScreen_DrawMonPicInCategoryPage: the slot's round pic window (BG2) and its info box (BG1: No., name, caught ball) */
function DexScreen_DrawMonPicInCategoryPage(species: number, slot: number, numSlots: number): boolean {
  const d = sd();
  const coords = sCategoryPageIconCoords[numSlots - 1][slot];
  CopyToBgTilemapBufferRect_ChangePalette(3, gfx16('sCategoryPageIconWindowBg'), coords[0], coords[1], 8, 8, slot + 5);
  if (d.categoryMonWindowIds[slot] === WINDOW_NONE) {
    const template = { ...sWindowTemplate_CategoryMonIcon, tilemapLeft: coords[0], tilemapTop: coords[1], paletteNum: slot + 1, baseBlock: slot * 64 + 8 };
    d.categoryMonWindowIds[slot] = AddWindow(template);
    FillWindowPixelBuffer(d.categoryMonWindowIds[slot], PIXEL_FILL(0));
    DexScreen_LoadMonPicInWindow(d.categoryMonWindowIds[slot], species, slot * 16 + 16);
    PutWindowTilemap(d.categoryMonWindowIds[slot]);
    CopyWindowToVram(d.categoryMonWindowIds[slot], COPYWIN_GFX);
  } else {
    PutWindowTilemap(d.categoryMonWindowIds[slot]);
  }

  if (d.categoryMonInfoWindowIds[slot] === WINDOW_NONE) {
    if (species !== K.SPECIES_NONE) {
      const template = { ...sWindowTemplate_CategoryMonInfo, tilemapLeft: coords[2], tilemapTop: coords[3], baseBlock: slot * 40 + 0x108 };
      const win = (d.categoryMonInfoWindowIds[slot] = AddWindow(template));
      CopyToWindowPixelBuffer(win, gfx('sCategoryMonInfoBgTiles'), 0, 0);
      DexScreen_PrintMonDexNo(win, FONT_SMALL, species, 12, 0);
      DexScreen_AddTextPrinterParameterized(win, FONT_NORMAL, speciesName(species), 2, 13, 0);
      if (DexScreen_GetSetPokedexFlag(state, species, FLAG_GET_CAUGHT, true)) BlitBitmapRectToWindow(win, gfx('sDexScreen_CaughtIcon'), 0, 0, 8, 8, 2, 3, 8, 8);
      PutWindowTilemap(win);
      CopyWindowToVram(win, COPYWIN_GFX);
    }
  } else {
    PutWindowTilemap(d.categoryMonInfoWindowIds[slot]);
  }
  return true;
}

/** DexScreen_DestroyCategoryPageMonIconAndInfoWindows */
function DexScreen_DestroyCategoryPageMonIconAndInfoWindows(): void {
  const d = sd();
  for (let i = 0; i < 4; i++) {
    for (const ids of [d.categoryMonWindowIds, d.categoryMonInfoWindowIds]) {
      if (ids[i] !== WINDOW_NONE) {
        RemoveWindow(ids[i]);
        ids[i] = WINDOW_NONE;
      }
    }
  }
}

/** DexScreen_PrintCategoryPageNumbers: "PAGE  1/ 3" on the top bar's right (x / y are unused, as in the C) */
function DexScreen_PrintCategoryPageNumbers(_windowId: number, currentPage: number, totalPages: number, _x: number, _y: number): void {
  const buffer = concat(text('gText_Page'), ConvertIntToDecimalStringN(currentPage, STR_CONV_MODE_RIGHT_ALIGN, 2), [K.CHAR_SLASH, EOS], ConvertIntToDecimalStringN(totalPages, STR_CONV_MODE_RIGHT_ALIGN, 2));
  DexScreen_PrintStringWithAlignment(buffer, TEXT_RIGHT);
}

/** DexScreen_CreateCategoryListGfx: the habitat page (justRegistered: the name centred, no page numbers or controls) */
function DexScreen_CreateCategoryListGfx(justRegistered: boolean): boolean {
  const d = sd();
  FillBgTilemapBufferRect_Palette0(3, 2, 0, 0, 30, 20);
  FillBgTilemapBufferRect_Palette0(2, 0, 0, 0, 32, 20);
  FillBgTilemapBufferRect_Palette0(1, 0, 0, 0, 32, 20);
  DexScreen_CreateCategoryPageSpeciesList(d.category, d.pageNum);
  FillWindowPixelBuffer(0, PIXEL_FILL(15));
  if (justRegistered) {
    DexScreen_PrintStringWithAlignment(text(sDexCategoryNamePtrs[d.category]), TEXT_CENTER);
  } else {
    DexScreen_PrintStringWithAlignment(text(sDexCategoryNamePtrs[d.category]), TEXT_LEFT);
    DexScreen_PrintCategoryPageNumbers(0, DexScreen_PageNumberToRenderablePages(d.pageNum), DexScreen_PageNumberToRenderablePages(d.lastPageInCategory - 1), 160, 2);
  }
  CopyWindowToVram(0, COPYWIN_GFX);
  FillWindowPixelBuffer(1, PIXEL_FILL(15));
  if (!justRegistered) DexScreen_PrintControlInfo(text('gText_PickFlipPageCheckCancel'));
  CopyWindowToVram(1, COPYWIN_GFX);
  for (let i = 0; i < 4; i++) {
    if (d.pageSpecies[i] !== 0xffff) DexScreen_DrawMonPicInCategoryPage(d.pageSpecies[i], i, d.numMonsOnPage);
  }
  return false;
}

/**
 * DexScreen_CreateCategoryPageSelectionCursor: the round windows' frame colours (BG palettes 5-8, colours 2 and 8);
 * the selected slot's pulse every 4 frames, and the outline cursor's colour (OBJ palette 4, colour 1). 0xFF resets.
 */
function DexScreen_CreateCategoryPageSelectionCursor(cursorPos: number): void {
  const d = sd();
  const pal = (i: number) => [sDexScreen_CategoryCursorPals[i]];
  if (cursorPos === 0xff) {
    for (let i = 0; i < 4; i++) {
      LoadPalette(pal(0), PLTT_ID(i) + PLTT_ID(5) + 2, 2);
      LoadPalette(pal(1), PLTT_ID(i) + PLTT_ID(5) + 8, 2);
    }
    LoadPalette(pal(0), 0x141, 2);
    d.categoryPageSelectionCursorTimer = 0;
  } else {
    d.categoryPageSelectionCursorTimer++;
    if (d.categoryPageSelectionCursorTimer === 16) d.categoryPageSelectionCursorTimer = 0;
    const palIdx = d.categoryPageSelectionCursorTimer >> 2;
    for (let i = 0; i < 4; i++) {
      if (i === cursorPos) {
        LoadPalette(pal(2 * palIdx + 2), PLTT_ID(i) + PLTT_ID(5) + 2, 2);
        LoadPalette(pal(2 * palIdx + 3), PLTT_ID(i) + PLTT_ID(5) + 8, 2);
      } else {
        LoadPalette(pal(0), PLTT_ID(i) + PLTT_ID(5) + 2, 2);
        LoadPalette(pal(1), PLTT_ID(i) + PLTT_ID(5) + 8, 2);
      }
    }
    LoadPalette(pal(2 * palIdx + 2), OBJ_PLTT_ID(4) + 1, 2);
  }
}

/** DexScreen_UpdateCategoryPageCursorObject: the outline around the selected slot's info box */
function DexScreen_UpdateCategoryPageCursorObject(taskId: number, cursorPos: number, numMonsInPage: number): void {
  const coords = sCategoryPageIconCoords[numMonsInPage - 1][cursorPos];
  ListMenuUpdateCursorObject(taskId, coords[2] * 8, coords[3] * 8, 0);
}

/** DexPage_TileBuffer_CopyCol: one 20-tile column of a 32-wide tilemap */
function DexPage_TileBuffer_CopyCol(srcBuf: Uint16Array, srcCol: number, dstBuf: Uint16Array, dstCol: number): boolean {
  for (let i = 0; i < 20; i++) dstBuf[dstCol + i * 32] = srcBuf[srcCol + i * 32];
  return false;
}

/** DexPage_TileBuffer_FillCol */
function DexPage_TileBuffer_FillCol(tileNo: number, tileBuf: Uint16Array, x: number): boolean {
  for (let i = 0; i < 20; i++) tileBuf[x + i * 32] = tileNo;
  return false;
}

/** DexScreen_TurnCategoryPage_BgEffect: step `page` of the page turn (the saved page squeezed into the left columns) */
function DexScreen_TurnCategoryPage_BgEffect(page: number): boolean {
  const d = sd();
  const bg1buff = GetBgTilemapBuffer(1)!;
  const bg2buff = GetBgTilemapBuffer(2)!;
  const bg3buff = GetBgTilemapBuffer(3)!;
  const mem = d.bgBufsMem!;
  const bg1mem = mem.subarray(0x800);
  const bg2mem = mem.subarray(0x400);
  const bg3mem = mem.subarray(0x000);
  for (let dstCol = 0; dstCol < 30; dstCol++) {
    const srcCol = sDexScreenPageTurnColumns[page][dstCol];
    if (srcCol === 30) {
      DexPage_TileBuffer_FillCol(0x000, bg1buff, dstCol);
      DexPage_TileBuffer_FillCol(0x000, bg2buff, dstCol);
      DexPage_TileBuffer_FillCol(0x00c, bg3buff, dstCol);
    } else {
      DexPage_TileBuffer_CopyCol(bg1mem, srcCol, bg1buff, dstCol);
      DexPage_TileBuffer_CopyCol(bg2mem, srcCol, bg2buff, dstCol);
      DexPage_TileBuffer_CopyCol(bg3mem, srcCol, bg3buff, dstCol);
    }
  }
  CopyBgTilemapBufferToVram(1);
  CopyBgTilemapBufferToVram(2);
  CopyBgTilemapBufferToVram(3);
  return false;
}

/**
 * DexScreen_FlipCategoryPageInDirection: 0 = left (the new page unfolds from the left), 1 = right (the old page
 * folds away to the left, then the new one fades in). TRUE when done.
 */
function DexScreen_FlipCategoryPageInDirection(direction: number): boolean {
  const d = sd();
  const color = gfx16(isNationalDexEnabled(state) ? 'sNationalDexPalette' : 'sKantoDexPalette')[7];
  const saveTilemaps = () => {
    const mem = d.bgBufsMem!;
    mem.set(GetBgTilemapBuffer(3)!.subarray(0, 0x400), 0x000);
    mem.set(GetBgTilemapBuffer(2)!.subarray(0, 0x400), 0x400);
    mem.set(GetBgTilemapBuffer(1)!.subarray(0, 0x400), 0x800);
  };
  switch (d.data[0]) {
    case 0:
      // Port: the new page's mon graphics load first (a frame or two the first time)
      if (!DexScreen_LoadCategoryPageGfx(d.category, d.pageNum)) break;
      d.bgBufsMem = new Uint16Array((3 * BG_SCREEN_SIZE) / 2);
      d.data[0] = direction ? 6 : 2;
      break;
    case 1:
      d.bgBufsMem = null;
      return true;
    // Go left
    case 2:
      BeginNormalPaletteFade(0x00007fff, 0, 0, 16, color);
      d.data[0]++;
      break;
    case 3:
      FillBgTilemapBufferRect_Palette0(3, 0x00c, 0, 0, 30, 20);
      FillBgTilemapBufferRect_Palette0(2, 0x000, 0, 0, 32, 20);
      FillBgTilemapBufferRect_Palette0(1, 0x000, 0, 0, 32, 20);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(3);
      d.data[0]++;
      break;
    case 4:
      BeginNormalPaletteFade(0x00007fff, 0, 0, 0, color);
      DexScreen_CreateCategoryListGfx(false);
      saveTilemaps();
      FillBgTilemapBufferRect_Palette0(3, 0x00c, 0, 0, 30, 20);
      FillBgTilemapBufferRect_Palette0(2, 0x000, 0, 0, 32, 20);
      FillBgTilemapBufferRect_Palette0(1, 0x000, 0, 0, 32, 20);
      d.data[1] = 0;
      d.data[0]++;
      PlaySE(K.SE_BALL_TRAY_ENTER);
      break;
    case 5:
      if (d.data[1] < 10) {
        DexScreen_TurnCategoryPage_BgEffect(d.data[1]);
        d.data[1]++;
      } else {
        d.data[0] = 1;
      }
      break;
    // Go right
    case 6:
      saveTilemaps();
      d.data[1] = 9;
      d.data[0]++;
      PlaySE(K.SE_BALL_TRAY_ENTER);
      break;
    case 7:
      if (d.data[1] !== 0) {
        DexScreen_TurnCategoryPage_BgEffect(d.data[1]);
        d.data[1]--;
      } else {
        // Not BUGFIX: data[0] (7) instead of step 0, so the old page's last step shows a 7-step squeeze
        DexScreen_TurnCategoryPage_BgEffect(d.data[0]);
        BeginNormalPaletteFade(0x00007fff, 0, 16, 16, color);
        d.data[0]++;
      }
      break;
    case 8:
      gPaletteFade.bufferTransferDisabled = true;
      DexScreen_CreateCategoryListGfx(false);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(3);
      d.data[0]++;
      break;
    case 9:
      gPaletteFade.bufferTransferDisabled = false;
      BeginNormalPaletteFade(0x00007fff, 0, 16, 0, color);
      d.data[0] = 1;
      break;
  }
  return false;
}

/** DexScreen_CreateCategoryPageSpeciesList: the page's mons that can be shown (seen; Kanto without the National Dex) */
function DexScreen_CreateCategoryPageSpeciesList(categoryNum: number, pageNum: number): void {
  const d = sd();
  const page = pokedexData.categories[categoryNum][pageNum];
  d.numMonsOnPage = 0;
  for (let i = 0; i < 4; i++) d.pageSpecies[i] = 0xffff;
  for (const species of page) {
    if (DexScreen_CanShowMonInDex(species) && DexScreen_GetSetPokedexFlag(state, species, FLAG_GET_SEEN, true)) {
      d.pageSpecies[d.numMonsOnPage] = species;
      d.numMonsOnPage++;
    }
  }
}

/** DexScreen_GetPageLimitsForCategory: the first and (one past the) last unlocked page; TRUE if none */
function DexScreen_GetPageLimitsForCategory(category: number): boolean {
  const d = sd();
  const count = pokedexData.categories[category].length;
  let firstPage = 0xff;
  let lastPage = 0xff;
  for (let i = 0; i < count; i++) {
    if (DexScreen_IsPageUnlocked(category, i)) {
      if (firstPage === 0xff) firstPage = i;
      lastPage = i;
    }
  }
  if (lastPage !== 0xff) {
    d.firstPageInCategory = firstPage;
    d.lastPageInCategory = lastPage + 1;
    return false;
  }
  d.firstPageInCategory = 0;
  d.lastPageInCategory = 0;
  return true;
}

/** DexScreen_PageNumberToRenderablePages: the page's number counting only the unlocked pages */
function DexScreen_PageNumberToRenderablePages(page: number): number {
  const d = sd();
  let count = 0;
  for (let i = 0; i < page; i++) if (DexScreen_IsPageUnlocked(d.category, i)) count++;
  return count + 1;
}

// ------------------------------------------------------------------ registering a catch

/**
 * DexScreen_RegisterMonToPokedex: sets the seen / caught flags and starts the "registered" page on the GBA layer
 * (called from the battle's Cmd_displaydexinfo, which waits until the returned task ends). A non-Kanto mon before the
 * National Dex only gets a task that ends at once.
 */
export function DexScreen_RegisterMonToPokedex(species: number): number {
  DexScreen_GetSetPokedexFlag(state, species, FLAG_SET_SEEN, true);
  DexScreen_GetSetPokedexFlag(state, species, FLAG_SET_CAUGHT, true);
  if (!isNationalDexEnabled(state) && state.pokemon.nationalDex(species) > K.KANTO_DEX_COUNT) {
    return CreateTask(Task_DexScreen_RegisterNonKantoMonBeforeNationalDex, 0);
  }
  DexScreen_LoadResources();
  gTasks[sd().taskId].func = Task_DexScreen_RegisterMonToPokedex;
  DexScreen_LookUpCategoryBySpecies(species);
  return sd().taskId;
}

/** Task_DexScreen_RegisterNonKantoMonBeforeNationalDex */
function Task_DexScreen_RegisterNonKantoMonBeforeNationalDex(taskId: number): void {
  DestroyTask(taskId);
}

/** Task_DexScreen_RegisterMonToPokedex: the mon's habitat page with it selected, then its page zooming in; A / B close */
function Task_DexScreen_RegisterMonToPokedex(taskId: number): void {
  const d = sd();
  switch (d.state) {
    case 0:
      DexScreen_GetPageLimitsForCategory(d.category);
      if (d.pageNum < d.firstPageInCategory) d.pageNum = d.firstPageInCategory;
      d.state = 3;
      break;
    case 1:
      RemoveDexPageWindows();
      DexScreen_DestroyCategoryPageMonIconAndInfoWindows();
      gMain.state = 0;
      d.state = 2;
      break;
    case 2:
      if (DoClosePokedex()) DestroyTask(taskId);
      break;
    case 3:
      // Port: wait for the page's mon graphics (the battle preloads them: dexRegisterGfxSymbols)
      if (!DexScreen_LoadCategoryPageGfx(d.category, d.pageNum)) break;
      DexScreen_CreateCategoryListGfx(true);
      PutWindowTilemap(0);
      PutWindowTilemap(1);
      CopyBgTilemapBufferToVram(3);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(0);
      DexScreen_CreateCategoryPageSelectionCursor(0xff);
      d.state = 4;
      break;
    case 4:
      gPaletteFade.bufferTransferDisabled = false;
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, 0xffff);
      ShowBg(3);
      ShowBg(2);
      ShowBg(1);
      ShowBg(0);
      d.state = 5;
      break;
    case 5:
      gTasks[taskId].data[0] = 30;
      d.categoryPageCursorTaskId = ListMenuAddCursorObjectInternal(sCursorStruct_CategoryPage, 0);
      d.state = 6;
      break;
    case 6:
      DexScreen_CreateCategoryPageSelectionCursor(d.categoryCursorPosInPage);
      DexScreen_UpdateCategoryPageCursorObject(d.categoryPageCursorTaskId, d.categoryCursorPosInPage, d.numMonsOnPage);
      if (gTasks[taskId].data[0]) {
        gTasks[taskId].data[0]--;
      } else {
        ListMenuRemoveCursorObject(d.categoryPageCursorTaskId, 0);
        d.state = 7;
      }
      break;
    case 7:
      d.dexSpecies = d.pageSpecies[d.categoryCursorPosInPage];
      d.state = 8;
      break;
    case 8:
      DexScreen_DrawMonDexPage(true);
      d.state = 9;
      break;
    case 9:
      d.data[0] = 0;
      d.data[1] = 0;
      d.state++;
    // fallthrough
    case 10:
      if (!DexScreen_ZoomInFrame()) break;
      CopyBgTilemapBufferToVram(3);
      CopyBgTilemapBufferToVram(2);
      CopyBgTilemapBufferToVram(1);
      CopyBgTilemapBufferToVram(0);
      PlayCry_NormalNoDucking(d.dexSpecies, 0, K.CRY_VOLUME_RS, K.CRY_PRIORITY_NORMAL);
      d.data[0] = 0;
      d.state = 11;
      break;
    case 11:
      if (JOY_NEW(A_BUTTON | B_BUTTON)) d.state = 2;
      break;
  }
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
        // STUB / TODO(W-dexarea unit 2): the area page (DexScreen_DrawMonAreaPage) isn't ported, so A stays inert.
        // Wire it like the C: RemoveDexPageWindows(); FillBgTilemapBufferRect_Palette0(1, 0x000, 0, 2, 30, 16);
        // CopyBgTilemapBufferToVram(1); d.state = 7;  (states 7-12 below are ported and call the area page's
        // DexScreen_DrawMonAreaPage / DexScreen_DestroyAreaScreenResources.)
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
    // The area page (W-dexarea unit 2 provides DexScreen_DrawMonAreaPage / DexScreen_DestroyAreaScreenResources).
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

/** DexScreen_DrawMonAreaPage: TODO(W-dexarea unit 2), replace with the area page (menus/pokedexArea.ts). */
function DexScreen_DrawMonAreaPage(): number {
  return 1;
}

/** DexScreen_DestroyAreaScreenResources: TODO(W-dexarea unit 2), replace with the area page's. */
function DexScreen_DestroyAreaScreenResources(): number {
  return 0;
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
  // From the numerical lists (numMonsOnPage = 1) the C indexes past sPageIconCoords_1Mon when a habitat page left
  // the cursor off slot 0; the clamps make that not matter at scale 6 (the only scale that page uses), so the port
  // clamps the index. The habitat and registered pages zoom from their selected slot (scales 0-6).
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
function DexScreen_GetDefaultPersonality(_species: number): number {
  return 0;
}

/** The graphics the mon page draws for `species`: its front pic, its palettes and its footprint. */
export function dexMonGfxSymbols(species: number): string[] {
  const syms = [monPicSymbol(true, species, DexScreen_GetDefaultPersonality(species)), ...monPalSymbols(species)];
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

/** The states each task takes input in (the C's; the others take it in state 6). */
const sInputStates: Record<string, number[]> = {
  Task_DexScreen_ShowMonPage: [5],
  Task_DexScreen_CategorySubmenu: [5, 17],
  Task_DexScreen_RegisterMonToPokedex: [11],
};

/**
 * The screen while it's up: the task and its state, the counts, the top menu, the ordered lists, the habitat page,
 * the mon page.
 */
export function pokedexScreenProbe():
  | {
      task: string;
      state: number;
      /**
       * The task takes input (Task_PokedexScreen / the ordered lists in state 6, the mon page in 5, the habitat page in 5
       * and its mon page in 17, the registered page in 11) and no fade runs.
       */
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
      /**
       * The habitat page (Task_DexScreen_CategorySubmenu / Task_DexScreen_RegisterMonToPokedex): DEX_CATEGORY_*, the
       * page and the unlocked pages' range, the shown mons, the selected slot, and how many pixels each slot's pic drew.
       */
      categoryPage?: { category: number; pageNum: number; firstPage: number; lastPage: number; species: number[]; cursor: number; picPixels: number[] };
    }
  | undefined {
  const d = sPokedexScreenData;
  if (!d) return undefined;
  const task = gTasks[d.taskId];
  const taskName = task.isActive ? task.func.name : '';
  const inputStates = sInputStates[taskName] ?? [6];
  const result: ReturnType<typeof pokedexScreenProbe> = {
    task: taskName,
    state: d.state,
    ready: task.isActive && inputStates.includes(d.state) && !gPaletteFade.active,
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
  if (d.categoryMonWindowIds[0] !== WINDOW_NONE) {
    result.categoryPage = {
      category: d.category,
      pageNum: d.pageNum,
      firstPage: d.firstPageInCategory,
      lastPage: d.lastPageInCategory,
      species: d.pageSpecies.slice(0, d.numMonsOnPage),
      cursor: d.categoryCursorPosInPage,
      picPixels: d.categoryMonWindowIds.slice(0, d.numMonsOnPage).map((id) => (id === WINDOW_NONE ? 0 : windowPixelsInRect(id, 0, 0, 64, 64))),
    };
  }
  if (d.windowIds[1] !== WINDOW_NONE && sMonPageText) {
    result.monPage = {
      species: d.dexSpecies,
      ...sMonPageText,
      picPixels: windowPixelsInRect(d.windowIds[0], 0, 0, 64, 64),
      footprintPixels: windowPixelsInRect(d.windowIds[1], 88, 40, 16, 16),
    };
  }
  return result;
}
