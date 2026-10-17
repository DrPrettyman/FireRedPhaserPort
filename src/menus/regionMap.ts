// region_map.c: the region map screen on the GBA layer, in its three modes (REGIONMAP_TYPE_*): the Town Map
// key item from the bag (NORMAL: the map opening animation, the Kanto / Sevii switch menu and the dungeon map
// previews), the wall maps in Pokémon Centers (WALL, `special ShowTownMap`) and the fly map (FLY, CB2_OpenFlyMap
// from the party menu's FLY). The tables come from menus.json `regionMap` (tools/extract_menus.py), the
// graphics from graphics/region_map/ and graphics/map_preview/. GetMapName stays in world/regionMap.ts.
//
// What the screen reads from the overworld (gMapHeader, gSaveBlock1Ptr->location / pos / escapeWarp /
// dynamicWarp) is handed over before it opens: `setRegionMapField` (world/fieldMoves.ts prepareFieldMoveMenu).

import { K } from '../battle/constants';
import { state } from '../battle/env';
import {
  ChangeBgX,
  ChangeBgY,
  CopyBgTilemapBufferToVram,
  CopyToBgTilemapBufferRect,
  FillBgTilemapBufferRect,
  FillBgTilemapBufferRect_Palette0,
  HideBg,
  InitBgsFromTemplates,
  IsDma3ManagerBusyWithBgCopy,
  LoadBgTiles,
  ResetBgsAndClearDma3BusyFlags,
  SetBgTilemapBuffer,
  ShowBg,
  WriteSequenceToBgTilemapBuffer,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  BLDCNT_EFFECT_BLEND,
  BLDCNT_EFFECT_DARKEN,
  BLDCNT_EFFECT_LIGHTEN,
  BLDCNT_EFFECT_NONE,
  BLDCNT_TGT1_BD,
  BLDCNT_TGT1_BG0,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT1_BG2,
  BLDCNT_TGT1_BG3,
  BLDCNT_TGT1_OBJ,
  BLDCNT_TGT2_BG0,
  BLDCNT_TGT2_BG1,
  BLDCNT_TGT2_BG3,
  BLDCNT_TGT2_OBJ,
  ClearGpuRegBits,
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  DISPCNT_WIN1_ON,
  GetGpuReg,
  PALETTES_ALL,
  pltt,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WIN1H,
  REG_OFFSET_WIN1V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  SetGpuReg,
  vram,
  WIN_RANGE,
  WININ_WIN0_ALL,
  WININ_WIN0_BG0,
  WININ_WIN0_BG1,
  WININ_WIN0_BG3,
  WININ_WIN0_BG_ALL,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
  WININ_WIN1_BG0,
  WININ_WIN1_BG2,
  WININ_WIN1_BG3,
  WININ_WIN1_CLR,
  WININ_WIN1_OBJ,
  WINOUT_WIN01_BG0,
  WINOUT_WIN01_BG1,
  WINOUT_WIN01_BG3,
  WINOUT_WIN01_BG_ALL,
  WINOUT_WIN01_CLR,
  WINOUT_WIN01_OBJ,
} from '../gba/hw';
import { A_BUTTON, B_BUTTON, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_UP, gMain, JOY_HELD, JOY_NEW, JOY_REPT, SELECT_BUTTON, SetHBlankCallback, SetMainCallback2, SetVBlankCallback, START_BUTTON, type MainCallback } from '../gba/main';
import { FreeTempTileDataBuffersIfPossible, ResetTempTileDataBuffers } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TintPalette_CustomTone, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import {
  AnimateSprites,
  BuildOamBuffer,
  CreateSprite,
  DestroySprite,
  FreeAllSpritePalettes,
  FreeSpritePaletteByTag,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gSprites,
  LoadSpritePalette,
  LoadSpriteSheet,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  SPRITE_SHAPE,
  SpriteCallbackDummy,
  StartSpriteAnim,
  ANIMCMD_END,
  ANIMCMD_FRAME,
  ANIMCMD_JUMP,
  type AnimCmd,
  type OamData,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks, type TaskFunc } from '../gba/task';
import {
  AddTextPrinterParameterized3,
  ClearWindowTilemap,
  CopyWindowToVram,
  COPYWIN_FULL,
  COPYWIN_GFX,
  COPYWIN_MAP,
  DeactivateAllTextPrinters,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  FreeAllWindowBuffers,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  TEXT_SKIP_DRAW,
  type WindowTemplate,
} from '../gba/window';
import { GetMapName } from '../world/regionMap';
import { ReturnToFieldFromFlyMapSelect, SetWarpDestinationToHealLocation, SetWarpDestinationToMapWarp } from '../world/fly';
import { encodeRaw, text } from './common';
import { menusData } from './data';
import { CB2_ReturnToField } from './fieldCallbacks';
import { CB2_ReturnToPartyMenuFromFlyMap } from './partyMenu';

// ------------------------------------------------------------------ data

/** menus.json `regionMap` (tools/extract_menus.py region_map_data) */
export interface RegionMapData {
  /** MAP_NUM() of every MAP_* id */
  mapNums: Record<string, number>;
  /** sRegionMapSections_Kanto / _Sevii123 / _Sevii45 / _Sevii67: [REGIONMAP_*][LAYER_*][y][x] mapsecs */
  layouts: number[][][][];
  /** sMapSectionTopLeftCorners / sMapSectionDimensions, by mapsec - KANTO_MAPSEC_START */
  topLeftCorners: ([number, number] | null)[];
  dimensions: ([number, number] | null)[];
  /** sSeviiMapsecs[REGIONMAP_SEVII* - 1], MAPSEC_NONE-terminated */
  seviiMapsecs: number[][];
  /** sMapFlyDestinations: [MAP_* id, HEAL_LOCATION_* (0: none)] by mapsec - KANTO_MAPSEC_START */
  flyDestinations: ([string, number] | null)[];
  /** sDungeonInfo: [mapsec, description string label] (the name is the mapsec's) */
  dungeonInfo: [number, string][];
  /** map_preview_screen.c sMapPreviewScreenData: [mapsec, flag, tiles, tilemap, palette symbols] */
  mapPreviews: [number, string, string, string, string][];
}

function data(): RegionMapData {
  return menusData.regionMap;
}

/** The overworld state the screen reads (gMapHeader, gSaveBlock1Ptr), handed over before it opens. */
export interface RegionMapField {
  /** gSaveBlock1Ptr->location: its MAP_* id and the type of its header (GetMapTypeByGroupAndId) */
  mapId: string;
  mapType: number;
  /** gMapHeader.regionMapSectionId and its layout's size */
  mapsec: number;
  width: number;
  height: number;
  /** gSaveBlock1Ptr->pos (map-local) */
  x: number;
  y: number;
  /** gSaveBlock1Ptr->escapeWarp / dynamicWarp with their maps' headers (section, layout size) */
  escapeWarp?: RegionMapWarp;
  dynamicWarp?: RegionMapWarp;
}

export interface RegionMapWarp {
  mapsec: number;
  width: number;
  height: number;
  x: number;
  y: number;
}

let field: RegionMapField | undefined;

export function setRegionMapField(f: RegionMapField): void {
  field = f;
}

function location(): RegionMapField {
  if (!field) throw new Error('[region_map] no field info (setRegionMapField)');
  return field;
}

/** The graphics the screen can load (preload them with loadGfx before it opens). */
export function regionMapGfxSymbols(withPreviews: boolean): string[] {
  const syms = [
    'sTopBar_Pal',
    'sMapCursor_Pal',
    'sPlayerIcon_RedPal',
    'sPlayerIcon_LeafPal',
    'sMiscIcon_Pal',
    'sRegionMap_Pal',
    'sSwitchMapCursor_Pal',
    'sMapEdge_Pal',
    'sSwitchMapCursorLeft_Gfx',
    'sSwitchMapCursorRight_Gfx',
    'sMapCursor_Gfx',
    'sPlayerIcon_Red',
    'sPlayerIcon_Leaf',
    'sRegionMap_Gfx',
    'sMapEdge_Gfx',
    'sSwitchMapMenu_Gfx',
    'sKanto_Tilemap',
    'sSevii123_Tilemap',
    'sSevii45_Tilemap',
    'sSevii67_Tilemap',
    'sMapEdge_Tilemap',
    'sSwitchMap_KantoSeviiAll_Tilemap',
    'sSwitchMap_KantoSevii123_Tilemap',
    'sSwitchMap_KantoSeviiAll2_Tilemap',
    'sMapEdge_TopLeft',
    'sMapEdge_TopRight',
    'sMapEdge_MidLeft',
    'sMapEdge_MidRight',
    'sMapEdge_BottomLeft',
    'sMapEdge_BottomRight',
    'sDungeonIcon',
    'sFlyIcon',
    'sBackground_Gfx',
    'sBackground_Tilemap',
  ];
  if (withPreviews) for (const [, , tiles, tilemap, pal] of data().mapPreviews) syms.push(tiles, tilemap, pal);
  return syms;
}

// ------------------------------------------------------------------ constants

const MAP_WIDTH = 22;
const MAP_HEIGHT = 15;
const CANCEL_BUTTON_X = 21;
const CANCEL_BUTTON_Y = 13;
const SWITCH_BUTTON_X = 21;
const SWITCH_BUTTON_Y = 11;

// include/region_map.h
export const REGIONMAP_TYPE_NORMAL = 0;
export const REGIONMAP_TYPE_WALL = 1;
export const REGIONMAP_TYPE_FLY = 2;

const REGIONMAP_KANTO = 0;
const REGIONMAP_SEVII123 = 1;
const REGIONMAP_SEVII45 = 2;
const REGIONMAP_SEVII67 = 3;
const REGIONMAP_COUNT = 4;

const MAPSECTYPE_NONE = 0;
const MAPSECTYPE_ROUTE = 1;
const MAPSECTYPE_VISITED = 2;
const MAPSECTYPE_NOT_VISITED = 3;
const MAPSECTYPE_UNKNOWN = 4; // Checked but never used

const LAYER_MAP = 0;
const LAYER_DUNGEON = 1;

const WIN_MAP_NAME = 0;
const WIN_DUNGEON_NAME = 1;
const WIN_MAP_PREVIEW = 2;
const WIN_TOPBAR_LEFT = 3;
const WIN_TOPBAR_RIGHT = 4;
const CLEAR_NAME = 2;

const MAP_INPUT_NONE = 0;
const MAP_INPUT_MOVE_START = 1;
const MAP_INPUT_MOVE_CONT = 2;
const MAP_INPUT_MOVE_END = 3;
const MAP_INPUT_A_BUTTON = 4;
const MAP_INPUT_SWITCH = 5;
const MAP_INPUT_CANCEL = 6;

const MAPPERM_HAS_SWITCH_BUTTON = 0;
const MAPPERM_HAS_MAP_PREVIEW = 1;
const MAPPERM_HAS_OPEN_ANIM = 2;
const MAPPERM_HAS_FLY_DESTINATIONS = 3;

const MAPEDGE_TOP_LEFT = 0;
const MAPEDGE_MID_LEFT = 1;
const MAPEDGE_BOT_LEFT = 2;
const MAPEDGE_TOP_RIGHT = 3;
const MAPEDGE_MID_RIGHT = 4;
const MAPEDGE_BOT_RIGHT = 5;

const NUM_ICONS = 25; // NELEMS(sMapIcons->flyIcons) / dungeonIcons
const BG_SCREEN_SIZE = 0x800;

// ------------------------------------------------------------------ state (the C's EWRAM structs)

interface GpuWindowParams {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface RegionMap {
  mapName: number[];
  dungeonName: number[];
  /** [REGIONMAP_COUNT + 1][600]: the four maps' tilemaps and the background's */
  layouts: Uint16Array[];
  bgTilemapBuffers: Uint16Array[];
  type: number;
  permissions: boolean[];
  selectedRegion: number;
  playersRegion: number;
  mainState: number;
  openState: number;
  loadGfxState: number;
  mainTask: TaskFunc;
  savedCallback: MainCallback | null;
}

interface SwitchMapMenu {
  switchMapTiles: Uint8Array;
  switchMapTilemap: Uint16Array;
  cursorSubsprite: { tiles: Uint8Array; sprite: Sprite | null; tileTag: number; palTag: number; x: number }[];
  mainState: number;
  cursorLoadState: number;
  currentSelection: number;
  chosenRegion: number;
  maxSelection: number;
  alpha: number;
  yOffset: number;
  exitTask: TaskFunc;
  highlight: GpuWindowParams;
  blendY: number;
}

interface DungeonMapPreview {
  tiles: Uint8Array;
  tilemap: Uint16Array;
  mapPreviewInfo: [number, string, string, string, string];
  savedTask: TaskFunc;
  mainState: number;
  drawState: number;
  loadState: number;
  updateCounter: number;
  timer: number;
  palette: Uint16Array;
  red: number;
  green: number;
  blue: number;
  blendY: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  leftIncrement: number;
  topIncrement: number;
  rightIncrement: number;
  bottomIncrement: number;
}

interface MapEdge {
  tiles: Uint8Array;
  sprite: Sprite | null;
  x: number;
  y: number;
  tileTag: number;
  palTag: number;
}

interface MapOpenCloseAnim {
  mapEdges: MapEdge[];
  tiles: Uint8Array;
  tilemap: Uint16Array;
  exitTask: TaskFunc;
  openState: number;
  loadGfxState: number;
  moveState: number;
  closeState: number;
  blendY: number;
}

interface MapCursor {
  x: number;
  y: number;
  spriteX: number;
  spriteY: number;
  horizontalMove: number;
  verticalMove: number;
  moveCounter: number;
  snapId: number;
  inputHandler: () => number;
  selectedMapsec: number;
  selectedMapsecType: number;
  selectedDungeonType: number;
  sprite: Sprite | null;
  tileTag: number;
  palTag: number;
  tiles: Uint8Array;
}

interface PlayerIcon {
  x: number;
  y: number;
  sprite: Sprite | null;
  tileTag: number;
  palTag: number;
  tiles: Uint8Array;
}

interface MapIconSprite {
  region: number;
  sprite: Sprite | null;
  tileTag: number;
  palTag: number;
}

interface MapIcons {
  dungeonIconTiles: Uint8Array;
  flyIconTiles: Uint8Array;
  dungeonIcons: MapIconSprite[];
  flyIcons: MapIconSprite[];
  state: number;
  exitTask: TaskFunc;
}

interface RegionMapGpuRegs {
  bldcnt: number;
  bldy: number;
  bldalpha: number;
  winin: number;
  winout: number;
  win0h: number;
  win1h: number;
  win0v: number;
  win1v: number;
}

let sRegionMap: RegionMap | null = null;
let sSwitchMapMenu: SwitchMapMenu | null = null;
let sDungeonMapPreview: DungeonMapPreview | null = null;
let sMapOpenCloseAnim: MapOpenCloseAnim | null = null;
let sMapCursor: MapCursor | null = null;
let sPlayerIcon: PlayerIcon | null = null;
let sMapIcons: MapIcons | null = null;
const sRegionMapGpuRegs: (RegionMapGpuRegs | null)[] = [null, null, null];
let sFlyMap: { state: number; selectedDestination: boolean } | null = null;

const rm = (): RegionMap => sRegionMap!;
const cursor = (): MapCursor => sMapCursor!;

/** A decompressed graphic copied into a buffer of the C's size (LZ77UnCompWram into a fixed array). */
function bytes(symbol: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const src = gfx(symbol);
  out.set(src.subarray(0, size));
  return out;
}

function words(symbol: string, count: number): Uint16Array {
  const out = new Uint16Array(count);
  const src = gfx16(symbol);
  out.set(src.subarray(0, count));
  return out;
}

// ------------------------------------------------------------------ tables

const sRegionMapBgTemplates: BgTemplate[] = [
  { bg: 0, charBaseIndex: 0, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 2, baseTile: 0x000 },
  { bg: 1, charBaseIndex: 1, mapBaseIndex: 15, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0x000 },
  { bg: 2, charBaseIndex: 2, mapBaseIndex: 23, screenSize: 0, paletteMode: 0, priority: 1, baseTile: 0x000 },
  { bg: 3, charBaseIndex: 3, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0x000 },
];

const sRegionMapWindowTemplates: WindowTemplate[] = [
  { bg: 3, tilemapLeft: 3, tilemapTop: 2, width: 15, height: 2, paletteNum: 12, baseBlock: 0x001 }, // WIN_MAP_NAME
  { bg: 3, tilemapLeft: 3, tilemapTop: 4, width: 15, height: 2, paletteNum: 12, baseBlock: 0x01f }, // WIN_DUNGEON_NAME
  { bg: 3, tilemapLeft: 3, tilemapTop: 6, width: 25, height: 11, paletteNum: 12, baseBlock: 0x03d }, // WIN_MAP_PREVIEW
  { bg: 3, tilemapLeft: 18, tilemapTop: 0, width: 5, height: 2, paletteNum: 12, baseBlock: 0x150 }, // WIN_TOPBAR_LEFT
  { bg: 3, tilemapLeft: 24, tilemapTop: 0, width: 5, height: 2, paletteNum: 12, baseBlock: 0x15a }, // WIN_TOPBAR_RIGHT
  DUMMY_WIN_TEMPLATE,
];

const sTextColor_White = (): number[] => [K.TEXT_COLOR_TRANSPARENT, K.TEXT_COLOR_WHITE, K.TEXT_COLOR_DARK_GRAY];
const sTextColor_Green = (): number[] => [K.TEXT_COLOR_TRANSPARENT, K.TEXT_COLOR_LIGHT_GREEN, K.TEXT_COLOR_DARK_GRAY];
const sTextColor_Red = (): number[] => [K.TEXT_COLOR_TRANSPARENT, K.TEXT_DYNAMIC_COLOR_1, K.TEXT_COLOR_DARK_GRAY];

/** sTextColorTable[MAPSECTYPE_VISITED - 2], [MAPSECTYPE_NOT_VISITED - 2] */
const sTextColorTable = (): number[][] => [sTextColor_Green(), sTextColor_Red()];

/** sTextColors: the top bar's */
const sTextColors = (): number[] => [K.TEXT_DYNAMIC_COLOR_6, K.TEXT_COLOR_WHITE, K.TEXT_COLOR_DARK_GRAY];

/** sRegionMapPermissions[REGIONMAP_TYPE_*][MAPPERM_*] */
const sRegionMapPermissions: boolean[][] = [
  [true, true, true, false], // REGIONMAP_TYPE_NORMAL
  [false, false, false, false], // REGIONMAP_TYPE_WALL
  [false, false, false, true], // REGIONMAP_TYPE_FLY
];

const sMapsecNameWindowDims: GpuWindowParams[] = [
  { left: 24, top: 16, right: 144, bottom: 32 }, // WIN_MAP_NAME
  { left: 24, top: 32, right: 144, bottom: 48 }, // WIN_DUNGEON_NAME
  { left: 0, top: 0, right: 0, bottom: 0 }, // CLEAR_NAME
];

const shape = (s: keyof typeof SPRITE_SHAPE, priority = 0): OamData => oam({ shape: SPRITE_SHAPE[s][0], size: SPRITE_SHAPE[s][1], priority });

const sOamData_SwitchMapCursor = shape('32x32');
const sAnims_SwitchMapCursor: AnimCmd[][] = [[ANIMCMD_FRAME(0, 20), ANIMCMD_FRAME(16, 20), ANIMCMD_JUMP(0)]];
const sOamData_MapEdge = shape('32x64');
const sAnims_MapEdge: AnimCmd[][] = [[ANIMCMD_FRAME(0, 0), ANIMCMD_JUMP(0)]];
const sMapWindowDim: GpuWindowParams = { left: 24, top: 16, right: 216, bottom: 160 };
const sOamData_MapCursor = shape('16x16', 2);
const sAnims_MapCursor: AnimCmd[][] = [[ANIMCMD_FRAME(0, 20), ANIMCMD_FRAME(4, 20), ANIMCMD_JUMP(0)]];
const sOamData_PlayerIcon = shape('16x16', 2);
const sAnims_PlayerIcon: AnimCmd[][] = [[ANIMCMD_FRAME(0, 5), ANIMCMD_END]];
const sOamData_FlyIcon = shape('16x16', 2);
const sOamData_DungeonIcon = shape('8x8', 2);
const sAnims_FlyIcon: AnimCmd[][] = [[ANIMCMD_FRAME(0, 30), ANIMCMD_FRAME(4, 60), ANIMCMD_JUMP(0)]];
const sAnims_DungeonIcon: AnimCmd[][] = [
  [ANIMCMD_FRAME(1, 20), ANIMCMD_JUMP(0)], // sAnim_DungeonIconVisited
  [ANIMCMD_FRAME(0, 20), ANIMCMD_JUMP(0)], // sAnim_DungeonIconNotVisited
];

const sWinFlags = [DISPCNT_WIN0_ON, DISPCNT_WIN1_ON];
const sWinRegs = [
  [REG_OFFSET_WIN0V, REG_OFFSET_WIN0H],
  [REG_OFFSET_WIN1V, REG_OFFSET_WIN1H],
];

const flag = (name: string): boolean => state.getFlag(name) === true;

// ------------------------------------------------------------------ palettes

/** RegionMap_DarkenPalette */
function RegionMap_DarkenPalette(pal: Uint16Array, size: number, tint: number): void {
  for (let i = 0; i < size; i++) {
    let r = pal[i] & 0x1f;
    let g = (pal[i] >> 5) & 0x1f;
    let b = (pal[i] >> 10) & 0x1f;
    r = ((Math.trunc((r << 8) / 100) * tint) >> 8) & 0x1f;
    g = ((Math.trunc((g << 8) / 100) * tint) >> 8) & 0x1f;
    b = ((Math.trunc((b << 8) / 100) * tint) >> 8) & 0x1f;
    pal[i] = r | (g << 5) | (b << 10);
  }
}

/** TintMapEdgesPalette */
function TintMapEdgesPalette(): void {
  const regionMapPal = gfx16('sRegionMap_Pal');
  const mapEdgesPal = new Uint16Array(regionMapPal.subarray(0x20, 0x30));
  RegionMap_DarkenPalette(mapEdgesPal, mapEdgesPal.length, 95);
  LoadPalette(mapEdgesPal, BG_PLTT_ID(2), 32);
  LoadPalette(regionMapPal.subarray(0x2f, 0x30), BG_PLTT_ID(2) + 15, 2);
}

// ------------------------------------------------------------------ opening and closing

function allocRegionMap(type: number, savedCallback: MainCallback | null): void {
  sRegionMap = {
    mapName: [],
    dungeonName: [],
    layouts: Array.from({ length: REGIONMAP_COUNT + 1 }, () => new Uint16Array(600)),
    bgTilemapBuffers: Array.from({ length: 3 }, () => new Uint16Array(BG_SCREEN_SIZE)),
    type,
    permissions: [false, false, false, false],
    selectedRegion: 0,
    playersRegion: 0,
    mainState: 0,
    openState: 0,
    loadGfxState: 0,
    mainTask: Task_RegionMap,
    savedCallback,
  };
  // (gExitStairsMovementDisabled = TRUE: the field's walk out of a staircase warp isn't ported)
  InitRegionMapType();
  SetMainCallback2(CB2_OpenRegionMap);
}

/** InitRegionMap */
function InitRegionMap(type: number): void {
  allocRegionMap(type, null);
}

/** InitRegionMapWithExitCB */
export function InitRegionMapWithExitCB(type: number, cb: MainCallback): void {
  allocRegionMap(type, cb);
}

/** InitRegionMapType */
function InitRegionMapType(): void {
  const r = rm();
  switch (r.type) {
    default:
    case REGIONMAP_TYPE_NORMAL:
    case REGIONMAP_TYPE_WALL:
      r.mainTask = Task_RegionMap;
      break;
    case REGIONMAP_TYPE_FLY:
      r.mainTask = Task_FlyMap;
      break;
  }
  for (let i = 0; i < 4; i++) r.permissions[i] = sRegionMapPermissions[r.type][i];
  if (!flag('FLAG_SYS_SEVII_MAP_123')) r.permissions[MAPPERM_HAS_SWITCH_BUTTON] = false;
  let region = REGIONMAP_KANTO;
  let j = REGIONMAP_KANTO;
  const mapsec = location().mapsec;
  if (mapsec >= K.SEVII_MAPSEC_START) {
    // Mapsec is in Sevii Islands, determine which map to use
    const sevii = data().seviiMapsecs;
    while (region === REGIONMAP_KANTO && j < sevii.length) {
      for (let i = 0; sevii[j][i] !== K.MAPSEC_NONE; i++) {
        if (mapsec === sevii[j][i]) {
          region = j + 1;
          break;
        }
      }
      j++;
    }
  }
  r.selectedRegion = region;
  r.playersRegion = region;
}

/** CB2_OpenRegionMap */
function CB2_OpenRegionMap(): void {
  const r = rm();
  switch (r.openState) {
    case 0:
      NullVBlankHBlankCallbacks();
      break;
    case 1:
      InitRegionMapBgs();
      break;
    case 2:
      ResetOamForRegionMap();
      break;
    case 3:
      if (!LoadRegionMapGfx()) return;
      break;
    case 4:
      FillBgTilemapBufferRect_Palette0(1, 0, 0, 0, 30, 20);
      CopyBgTilemapBufferToVramDma(1);
      break;
    case 5:
      BufferRegionMapBg(0, r.layouts[r.selectedRegion]);
      CopyBgTilemapBufferToVramDma(0);
      if (r.type !== REGIONMAP_TYPE_NORMAL) {
        BufferRegionMapBg(1, r.layouts[REGIONMAP_COUNT]);
        CopyBgTilemapBufferToVramDma(1);
      }
      break;
    case 6:
      DisplayCurrentMapName();
      PutWindowTilemap(WIN_MAP_NAME);
      break;
    case 7:
      DisplayCurrentDungeonName();
      PutWindowTilemap(WIN_DUNGEON_NAME);
      break;
    case 8:
      if (GetRegionMapPermission(MAPPERM_HAS_OPEN_ANIM)) SetBg0andBg3Hidden(true);
      break;
    default:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      CreateMainMapTask();
      SetRegionMapVBlankCB();
      break;
  }
  r.openState++;
}

/** LoadRegionMapGfx */
function LoadRegionMapGfx(): boolean {
  const r = rm();
  switch (r.loadGfxState) {
    case 0:
      LoadPalette(gfx16('sTopBar_Pal'), BG_PLTT_ID(12), PLTT_SIZE_4BPP);
      break;
    case 1: {
      const pal = gfx16('sRegionMap_Pal');
      LoadPalette(pal, 0, pal.length * 2);
      TintMapEdgesPalette();
      if (r.type !== REGIONMAP_TYPE_NORMAL) {
        const top15 = gfx16('sTopBar_Pal').subarray(15, 16);
        for (let i = 0; i < 5; i++) LoadPalette(top15, BG_PLTT_ID(i), 2);
      }
      break;
    }
    case 2:
      ResetTempTileDataBuffers();
      break;
    case 3:
      LoadBgTiles(0, gfx('sRegionMap_Gfx'), gfx('sRegionMap_Gfx').length, 0); // DecompressAndCopyTileDataToVram
      if (r.type !== REGIONMAP_TYPE_NORMAL) LoadBgTiles(1, gfx('sBackground_Gfx'), gfx('sBackground_Gfx').length, 0);
      break;
    case 4:
      if (FreeTempTileDataBuffersIfPossible()) return false;
      break;
    case 5:
      r.layouts[REGIONMAP_KANTO] = words('sKanto_Tilemap', 600);
      break;
    case 6:
      r.layouts[REGIONMAP_SEVII123] = words('sSevii123_Tilemap', 600);
      break;
    case 7:
      r.layouts[REGIONMAP_SEVII45] = words('sSevii45_Tilemap', 600);
      break;
    case 8:
      r.layouts[REGIONMAP_SEVII67] = words('sSevii67_Tilemap', 600);
      break;
    default:
      r.layouts[REGIONMAP_COUNT] = words('sBackground_Tilemap', 600);
      return true;
  }
  r.loadGfxState++;
  return false;
}

/** CreateMainMapTask */
function CreateMainMapTask(): void {
  CreateTask(rm().mainTask, 0);
  SetMainCallback2(CB2_RegionMap);
}

/** SelectedMapsecSEEnabled */
function SelectedMapsecSEEnabled(): boolean {
  return GetSelectedMapSection(GetSelectedRegionMap(), LAYER_MAP, GetMapCursorY(), GetMapCursorX()) !== K.MAPSEC_ROUTE_4_POKECENTER;
}

/** PlaySEForSelectedMapsec */
function PlaySEForSelectedMapsec(): void {
  if (SelectedMapsecSEEnabled()) {
    if (
      (GetSelectedMapsecType(LAYER_MAP) !== MAPSECTYPE_ROUTE && GetSelectedMapsecType(LAYER_MAP) !== MAPSECTYPE_NONE) ||
      (GetSelectedMapsecType(LAYER_DUNGEON) !== MAPSECTYPE_ROUTE && GetSelectedMapsecType(LAYER_DUNGEON) !== MAPSECTYPE_NONE)
    )
      PlaySE(K.SE_DEX_SCROLL);
    if (GetMapCursorX() === SWITCH_BUTTON_X && GetMapCursorY() === SWITCH_BUTTON_Y && GetRegionMapPermission(MAPPERM_HAS_SWITCH_BUTTON)) PlaySE(K.SE_M_SPIT_UP);
    else if (GetMapCursorX() === CANCEL_BUTTON_X && GetMapCursorY() === CANCEL_BUTTON_Y) PlaySE(K.SE_M_SPIT_UP);
  }
}

/** Task_RegionMap */
function Task_RegionMap(taskId: number): void {
  const r = rm();
  switch (r.mainState) {
    case 0:
      InitMapIcons(GetSelectedRegionMap(), taskId, r.mainTask);
      CreateMapCursor(0, 0);
      CreatePlayerIcon(1, 1);
      r.mainState++;
      break;
    case 1:
      if (r.permissions[MAPPERM_HAS_OPEN_ANIM]) {
        InitMapOpenAnim(taskId, r.mainTask);
      } else {
        ShowBg(0);
        ShowBg(3);
        ShowBg(1);
        PrintTopBarTextLeft(text('gText_RegionMap_DPadMove'));
        PrintTopBarTextRight(text('gText_RegionMap_Space'));
        ClearOrDrawTopBar(false);
        SetPlayerIconInvisibility(false);
        SetMapCursorInvisibility(false);
        SetFlyIconInvisibility(GetSelectedRegionMap(), NUM_ICONS, false);
        SetDungeonIconInvisibility(GetSelectedRegionMap(), NUM_ICONS, false);
      }
      r.mainState++;
      break;
    case 2:
      if (!gPaletteFade.active && !IsDma3ManagerBusyWithBgCopy()) {
        DisplayCurrentMapName();
        PutWindowTilemap(WIN_MAP_NAME);
        DisplayCurrentDungeonName();
        PutWindowTilemap(WIN_DUNGEON_NAME);
        r.mainState++;
      }
      break;
    case 3:
      switch (GetRegionMapInput()) {
        case MAP_INPUT_MOVE_START:
          ResetCursorSnap();
          break;
        case MAP_INPUT_MOVE_CONT:
          break;
        case MAP_INPUT_MOVE_END:
          DisplayCurrentMapName();
          DisplayCurrentDungeonName();
          DrawDungeonNameBox();
          PlaySEForSelectedMapsec();
          if (GetDungeonMapsecUnderCursor() !== K.MAPSEC_NONE) {
            if (GetRegionMapPermission(MAPPERM_HAS_MAP_PREVIEW)) {
              if (GetSelectedMapsecType(LAYER_DUNGEON) === MAPSECTYPE_VISITED) PrintTopBarTextRight(text('gText_RegionMap_AButtonGuide'));
              else PrintTopBarTextRight(text('gText_RegionMap_Space'));
            }
          } else if (GetMapCursorX() === SWITCH_BUTTON_X && GetMapCursorY() === SWITCH_BUTTON_Y && GetRegionMapPermission(MAPPERM_HAS_SWITCH_BUTTON)) {
            PrintTopBarTextRight(text('gText_RegionMap_AButtonSwitch'));
          } else if (GetMapCursorX() === CANCEL_BUTTON_X && GetMapCursorY() === CANCEL_BUTTON_Y) {
            PrintTopBarTextRight(text('gText_RegionMap_AButtonCancel'));
          } else {
            PrintTopBarTextRight(text('gText_RegionMap_Space'));
          }
          break;
        case MAP_INPUT_A_BUTTON:
          if (GetSelectedMapsecType(LAYER_DUNGEON) === MAPSECTYPE_VISITED && r.permissions[MAPPERM_HAS_MAP_PREVIEW]) InitDungeonMapPreview(0, taskId, SaveMainMapTask);
          break;
        case MAP_INPUT_SWITCH:
          InitSwitchMapMenu(r.selectedRegion, taskId, SaveMainMapTask);
          break;
        case MAP_INPUT_CANCEL:
          r.mainState++;
          break;
      }
      break;
    case 4:
      if (GetRegionMapPermission(MAPPERM_HAS_OPEN_ANIM)) {
        DoMapCloseAnim(taskId);
        r.mainState++; // (the C's goto INCREMENT_MAIN_STATE_AND_BREAK: the fade waits until the close anim is back)
      } else {
        r.mainState++;
      }
      break;
    case 5:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
      r.mainState++;
      break;
    default:
      if (!gPaletteFade.active) FreeRegionMap(taskId);
      break;
  }
}

/** GetMainMapTask */
function GetMainMapTask(): TaskFunc {
  return rm().mainTask;
}

/** SaveMainMapTask */
function SaveMainMapTask(taskId: number): void {
  gTasks[taskId].func = rm().mainTask;
}

/** FreeRegionMap */
function FreeRegionMap(taskId: number): void {
  if (GetRegionMapPermission(MAPPERM_HAS_OPEN_ANIM)) FreeMapOpenCloseAnim();
  FreeMapIcons();
  FreeMapCursor();
  FreePlayerIcon();
  FreeAndResetGpuRegs();
  DestroyTask(taskId);
  FreeAllWindowBuffers();
  const cb = rm().savedCallback;
  sRegionMap = null;
  SetMainCallback2(cb ?? gMain.savedCallback);
}

/** FreeRegionMapForFlyMap */
function FreeRegionMapForFlyMap(): void {
  sRegionMap = null;
}

/** CB2_RegionMap */
function CB2_RegionMap(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

/** VBlankCB_RegionMap */
function VBlankCB_RegionMap(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
  ProcessTilemapCopyRequests();
}

/**
 * The port's BG copies happen at once, the GBA's DMA3 requests at VBlank, from the buffer as it is by then:
 * a tilemap put after a copy request in the same frame (ClearOrDrawTopBar after PrintTopBarTextRight) shows
 * on the GBA. So each tilemap copy is made again at VBlank.
 */
const sPendingTilemapCopies = new Set<number>();

function CopyBgTilemapBufferToVramDma(bg: number): void {
  CopyBgTilemapBufferToVram(bg);
  sPendingTilemapCopies.add(bg);
}

/** CopyWindowToVram (every window here is on BG3) */
function CopyWindowToVramDma(windowId: number, mode: number): void {
  CopyWindowToVram(windowId, mode);
  if (mode === COPYWIN_FULL || mode === COPYWIN_MAP) sPendingTilemapCopies.add(sRegionMapWindowTemplates[windowId].bg);
}

function ProcessTilemapCopyRequests(): void {
  for (const bg of sPendingTilemapCopies) CopyBgTilemapBufferToVram(bg);
  sPendingTilemapCopies.clear();
}

function NullVBlankHBlankCallbacks(): void {
  SetVBlankCallback(null);
  SetHBlankCallback(null);
}

function SetRegionMapVBlankCB(): void {
  SetVBlankCallback(VBlankCB_RegionMap);
}

/** InitRegionMapBgs */
function InitRegionMapBgs(): void {
  vram.fill(0); // DmaFillLarge16(VRAM)
  pltt.fill(0); // DmaFill16Defvars(PLTT) (OAM: ResetSpriteData)
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, sRegionMapBgTemplates, sRegionMapBgTemplates.length);
  for (let bg = 0; bg < 4; bg++) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }
  InitWindows(sRegionMapWindowTemplates);
  DeactivateAllTextPrinters();
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_WIN0_ON | DISPCNT_WIN1_ON);
  SetBgTilemapBuffers();
  UpdateMapsecNameBox();
}

function SetBgTilemapBuffers(): void {
  for (let i = 0; i < 3; i++) SetBgTilemapBuffer(i, rm().bgTilemapBuffers[i]);
}

/** ResetOamForRegionMap */
function ResetOamForRegionMap(): void {
  ResetSpriteData();
  ResetPaletteFade();
  FreeAllSpritePalettes();
  ResetTasks();
  ScanlineEffect_Stop();
}

function SetBg0andBg3Hidden(hide: boolean): void {
  if (hide) {
    HideBg(0);
    HideBg(3);
  } else {
    ShowBg(0);
    ShowBg(3);
  }
}

/** UpdateMapsecNameBox */
function UpdateMapsecNameBox(): void {
  ResetGpuRegs();
  SetBldCnt(0, BLDCNT_TGT1_BG0 | BLDCNT_TGT1_OBJ, BLDCNT_EFFECT_DARKEN);
  SetBldY(BLDCNT_TGT1_BG1 | BLDCNT_TGT1_BG2);
  SetWinIn(WININ_WIN0_BG0 | WININ_WIN0_BG3 | WININ_WIN0_OBJ | WININ_WIN0_CLR, (WININ_WIN1_BG0 | WININ_WIN1_BG3 | WININ_WIN1_OBJ | WININ_WIN1_CLR) >> 8);
  SetWinOut(WINOUT_WIN01_BG0 | WINOUT_WIN01_BG1 | WINOUT_WIN01_BG3 | WINOUT_WIN01_OBJ);
  SetGpuWindowDims(0, sMapsecNameWindowDims[WIN_MAP_NAME]);
  SetGpuWindowDims(1, sMapsecNameWindowDims[WIN_DUNGEON_NAME]);
  SetDispCnt(0, false);
  if (GetDungeonMapsecUnderCursor() !== K.MAPSEC_NONE) SetDispCnt(1, false);
}

/** DisplayCurrentMapName */
function DisplayCurrentMapName(): void {
  ClearWindowTilemap(WIN_MAP_NAME);
  FillWindowPixelBuffer(WIN_MAP_NAME, PIXEL_FILL(0));
  if (GetMapsecUnderCursor() === K.MAPSEC_NONE) {
    SetGpuWindowDims(0, sMapsecNameWindowDims[CLEAR_NAME]);
  } else {
    rm().mapName = GetMapName(GetMapsecUnderCursor(), 0);
    AddTextPrinterParameterized3(WIN_MAP_NAME, K.FONT_NORMAL, 2, 2, sTextColor_White(), 0, rm().mapName);
    PutWindowTilemap(WIN_MAP_NAME);
    CopyWindowToVramDma(WIN_MAP_NAME, COPYWIN_GFX);
    SetGpuWindowDims(0, sMapsecNameWindowDims[WIN_MAP_NAME]);
  }
}

/** DrawDungeonNameBox */
function DrawDungeonNameBox(): void {
  SetGpuWindowDims(1, sMapsecNameWindowDims[WIN_DUNGEON_NAME]);
}

/** sMapNames[mapsec - KANTO_MAPSEC_START], encoded */
function mapsecName(mapsec: number): number[] {
  return encodeRaw(menusData.mapsecNames[mapsec - K.KANTO_MAPSEC_START] ?? '$');
}

/** DisplayCurrentDungeonName (dungeonWin*: fields the C sets and never reads) */
function DisplayCurrentDungeonName(): void {
  SetDispCnt(1, true);
  ClearWindowTilemap(WIN_DUNGEON_NAME);
  const mapsecId = GetDungeonMapsecUnderCursor();
  if (mapsecId !== K.MAPSEC_NONE) {
    SetDispCnt(1, false);
    FillWindowPixelBuffer(WIN_DUNGEON_NAME, PIXEL_FILL(0));
    rm().dungeonName = mapsecName(mapsecId);
    AddTextPrinterParameterized3(WIN_DUNGEON_NAME, K.FONT_NORMAL, 12, 2, sTextColorTable()[GetSelectedMapsecType(LAYER_DUNGEON) - 2] ?? sTextColor_Red(), 0, rm().dungeonName);
    PutWindowTilemap(WIN_DUNGEON_NAME);
    CopyWindowToVramDma(WIN_DUNGEON_NAME, COPYWIN_FULL);
  }
}

/** ClearMapsecNameText */
function ClearMapsecNameText(): void {
  FillWindowPixelBuffer(WIN_MAP_NAME, PIXEL_FILL(0));
  CopyWindowToVramDma(WIN_MAP_NAME, COPYWIN_FULL);
  FillWindowPixelBuffer(WIN_DUNGEON_NAME, PIXEL_FILL(0));
  CopyWindowToVramDma(WIN_DUNGEON_NAME, COPYWIN_FULL);
}

/** BufferRegionMapBg */
function BufferRegionMapBg(bg: number, map: Uint16Array): void {
  const buffer = rm().bgTilemapBuffers[bg];
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 32; j++) buffer[32 * i + j] = j < 30 ? map[30 * i + j] : map[0];
  }
  if (rm().permissions[MAPPERM_HAS_SWITCH_BUTTON]) {
    WriteSequenceToBgTilemapBuffer(0, 0x0f0, 0x18, 14, 3, 1, 0x3, 0x001);
    WriteSequenceToBgTilemapBuffer(0, 0x100, 0x18, 15, 3, 1, 0x3, 0x001);
    WriteSequenceToBgTilemapBuffer(0, 0x110, 0x18, 16, 3, 1, 0x3, 0x001);
  }
  const whichMap = sSwitchMapMenu ? sSwitchMapMenu.currentSelection : rm().selectedRegion;
  if (whichMap === REGIONMAP_SEVII45 && !flag('FLAG_WORLD_MAP_NAVEL_ROCK_EXTERIOR')) FillBgTilemapBufferRect_Palette0(0, 0x003, 13, 11, 3, 2);
  if (whichMap === REGIONMAP_SEVII67 && !flag('FLAG_WORLD_MAP_BIRTH_ISLAND_EXTERIOR')) FillBgTilemapBufferRect_Palette0(0, 0x003, 21, 16, 3, 3);
}

function GetRegionMapPermission(attr: number): boolean {
  return rm().permissions[attr];
}

function GetSelectedRegionMap(): number {
  return rm().selectedRegion;
}

function GetRegionMapPlayerIsOn(): number {
  return rm().playersRegion;
}

function SetSelectedRegionMap(region: number): void {
  rm().selectedRegion = region;
}

// ------------------------------------------------------------------ the Kanto / Sevii switch menu

/** InitSwitchMapMenu */
function InitSwitchMapMenu(whichMap: number, taskId: number, taskFunc: TaskFunc): void {
  let maxSelection = 0;
  if (flag('FLAG_SYS_SEVII_MAP_4567')) maxSelection = 3;
  else if (flag('FLAG_SYS_SEVII_MAP_123')) maxSelection = 1;
  let tilemap: string;
  let yOffset: number;
  switch (maxSelection) {
    case 1:
      tilemap = 'sSwitchMap_KantoSevii123_Tilemap';
      yOffset = 6;
      break;
    case 2: // never reached
      tilemap = 'sSwitchMap_KantoSeviiAll2_Tilemap';
      yOffset = 4;
      break;
    case 3:
    default:
      yOffset = 3;
      tilemap = 'sSwitchMap_KantoSeviiAll_Tilemap';
      break;
  }
  sSwitchMapMenu = {
    switchMapTiles: bytes('sSwitchMapMenu_Gfx', 0x1000),
    switchMapTilemap: words(tilemap, 600),
    cursorSubsprite: [
      { tiles: new Uint8Array(0x400), sprite: null, tileTag: 0, palTag: 0, x: 88 },
      { tiles: new Uint8Array(0x400), sprite: null, tileTag: 0, palTag: 0, x: 152 },
    ],
    mainState: 0,
    cursorLoadState: 0,
    currentSelection: whichMap,
    chosenRegion: GetRegionMapPlayerIsOn(),
    maxSelection,
    alpha: 0,
    yOffset,
    exitTask: taskFunc,
    highlight: { left: 0, top: 0, right: 0, bottom: 0 },
    blendY: 0,
  };
  SaveRegionMapGpuRegs(0);
  PrintTopBarTextRight(text('gText_RegionMap_AButtonOK'));
  gTasks[taskId].func = Task_SwitchMapMenu;
}

const sw = (): SwitchMapMenu => sSwitchMapMenu!;

function ResetGpuRegsForSwitchMapMenu(): void {
  ResetGpuRegs();
  SetBldCnt((BLDCNT_TGT2_BG0 | BLDCNT_TGT2_BG1 | BLDCNT_TGT2_BG3 | BLDCNT_TGT2_OBJ) >> 8, BLDCNT_TGT1_BG2, BLDCNT_EFFECT_BLEND);
  SetBldAlpha(16 - sw().alpha, sw().alpha);
}

function FadeSwitchMapMenuIn(): boolean {
  if (sw().alpha < 16) {
    SetBldAlpha(16 - sw().alpha, sw().alpha);
    sw().alpha += 2;
    return false;
  }
  return true;
}

function FadeSwitchMapMenuOut(): boolean {
  if (sw().alpha >= 2) {
    sw().alpha -= 2;
    SetBldAlpha(16 - sw().alpha, sw().alpha);
    return false;
  }
  return true;
}

/** Task_SwitchMapMenu */
function Task_SwitchMapMenu(taskId: number): void {
  const s = sw();
  switch (s.mainState) {
    case 0:
      NullVBlankHBlankCallbacks();
      PrintTopBarTextLeft(text('gText_RegionMap_UpDownPick'));
      s.mainState++;
      break;
    case 1:
      LoadBgTiles(2, s.switchMapTiles, s.switchMapTiles.length, 0);
      s.mainState++;
      break;
    case 2:
      LoadSwitchMapTilemap(2, s.switchMapTilemap);
      CopyBgTilemapBufferToVramDma(2);
      s.mainState++;
      break;
    case 3:
      ClearMapsecNameText();
      s.mainState++;
      break;
    case 4:
      ResetGpuRegsForSwitchMapMenu();
      ShowBg(2);
      s.mainState++;
      break;
    case 5:
      SetRegionMapVBlankCB();
      s.mainState++;
      break;
    case 6:
      if (FadeSwitchMapMenuIn()) {
        SetGpuRegsToDimScreen();
        s.mainState++;
      }
      break;
    case 7:
      if (DimScreenForSwitchMapMenu()) s.mainState++;
      break;
    case 8:
      if (CreateSwitchMapCursor()) s.mainState++;
      break;
    case 9:
      if (HandleSwitchMapInput()) {
        SetSelectedRegionMap(s.currentSelection);
        if (GetRegionMapPlayerIsOn() === s.currentSelection) {
          SetPlayerIconInvisibility(false);
          SetFlyIconInvisibility(s.currentSelection, NUM_ICONS, false);
          SetDungeonIconInvisibility(s.currentSelection, NUM_ICONS, false);
        }
        s.mainState++;
      }
      break;
    case 10:
      if (BrightenScreenForSwitchMapMenu()) {
        FreeSwitchMapCursor();
        ResetGpuRegsForSwitchMapMenu();
        s.mainState++;
      }
      break;
    case 11:
      if (FadeSwitchMapMenuOut()) s.mainState++;
      break;
    case 12:
      SetMapCursorInvisibility(false);
      s.mainState++;
      break;
    default:
      FreeSwitchMapMenu(taskId);
      break;
  }
}

/** FreeSwitchMapMenu */
function FreeSwitchMapMenu(taskId: number): void {
  gTasks[taskId].func = sw().exitTask;
  HideBg(2);
  PrintTopBarTextLeft(text('gText_RegionMap_DPadMove'));
  PrintTopBarTextRight(text('gText_RegionMap_AButtonSwitch'));
  UpdateMapsecNameBox();
  DrawDungeonNameBox();
  SetGpuWindowDims(0, sMapsecNameWindowDims[CLEAR_NAME]);
  sSwitchMapMenu = null;
}

function BrightenScreenForSwitchMapMenu(): boolean {
  if (sw().blendY !== 0) {
    sw().blendY--;
    SetGpuReg(REG_OFFSET_BLDY, sw().blendY);
    return false;
  }
  SetGpuReg(REG_OFFSET_BLDY, 0);
  return true;
}

/** LoadSwitchMapTilemap */
function LoadSwitchMapTilemap(bg: number, map: Uint16Array): void {
  const buffer = rm().bgTilemapBuffers[bg];
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 32; j++) buffer[32 * i + j] = j < 30 ? map[30 * i + j] : map[0];
  }
}

function switchHighlight(): GpuWindowParams {
  const s = sw();
  s.highlight.left = 72;
  s.highlight.top = 8 * (s.yOffset + 4 * s.currentSelection);
  s.highlight.right = 168;
  s.highlight.bottom = s.highlight.top + 32;
  return { ...s.highlight };
}

/** SetGpuRegsToDimScreen */
function SetGpuRegsToDimScreen(): void {
  const d = switchHighlight();
  ResetGpuRegs();
  SetBldCnt(0, BLDCNT_TGT1_BG0 | BLDCNT_TGT1_BG2 | BLDCNT_TGT1_OBJ, BLDCNT_EFFECT_DARKEN);
  SetWinIn(WININ_WIN0_BG_ALL | WININ_WIN0_OBJ, (WININ_WIN1_BG0 | WININ_WIN1_BG2 | WININ_WIN1_OBJ) >> 8);
  SetWinOut(WINOUT_WIN01_BG_ALL | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR);
  SetDispCnt(1, false);
  SetGpuWindowDims(1, d);
}

function DimScreenForSwitchMapMenu(): boolean {
  if (sw().blendY < 6) {
    sw().blendY++;
    SetBldY(sw().blendY);
    return false;
  }
  return true;
}

/** HandleSwitchMapInput */
function HandleSwitchMapInput(): boolean {
  const s = sw();
  let changedSelection = false;
  const d = switchHighlight();
  if (JOY_NEW(DPAD_UP) && s.currentSelection !== 0) {
    PlaySE(K.SE_BAG_CURSOR);
    s.currentSelection--;
    changedSelection = true;
  }
  if (JOY_NEW(DPAD_DOWN) && s.currentSelection < s.maxSelection) {
    PlaySE(K.SE_BAG_CURSOR);
    s.currentSelection++;
    changedSelection = true;
  }
  if (JOY_NEW(A_BUTTON) && s.blendY === 6) {
    PlaySE(K.SE_M_SWIFT);
    s.chosenRegion = s.currentSelection;
    return true;
  }
  if (JOY_NEW(B_BUTTON)) {
    s.currentSelection = s.chosenRegion;
    BufferRegionMapBg(0, rm().layouts[s.currentSelection]);
    CopyBgTilemapBufferToVramDma(0);
    SetFlyIconInvisibility(0xff, NUM_ICONS, true);
    SetDungeonIconInvisibility(0xff, NUM_ICONS, true);
    return true;
  }
  if (changedSelection) {
    BufferRegionMapBg(0, rm().layouts[s.currentSelection]);
    PrintTopBarTextRight(text('gText_RegionMap_AButtonOK'));
    CopyBgTilemapBufferToVramDma(0);
    CopyBgTilemapBufferToVramDma(3);
    SetFlyIconInvisibility(0xff, NUM_ICONS, true);
    SetDungeonIconInvisibility(0xff, NUM_ICONS, true);
    SetFlyIconInvisibility(s.currentSelection, NUM_ICONS, false);
    SetDungeonIconInvisibility(s.currentSelection, NUM_ICONS, false);
  }
  SetPlayerIconInvisibility(s.currentSelection !== GetRegionMapPlayerIsOn());
  SetGpuWindowDims(1, d);
  return false;
}

function SpriteCB_SwitchMapCursor(sprite: Sprite): void {
  sprite.y = sw().highlight.top + 16;
}

/** CreateSwitchMapCursor */
function CreateSwitchMapCursor(): boolean {
  const s = sw();
  switch (s.cursorLoadState) {
    case 0:
      s.cursorSubsprite[0].tiles = bytes('sSwitchMapCursorLeft_Gfx', 0x400);
      break;
    case 1:
      s.cursorSubsprite[1].tiles = bytes('sSwitchMapCursorRight_Gfx', 0x400);
      break;
    case 2:
      CreateSwitchMapCursorSubsprite(0, 2, 2);
      CreateSwitchMapCursorSubsprite(1, 3, 3);
      break;
    default:
      return true;
  }
  s.cursorLoadState++;
  return false;
}

/** CreateSwitchMapCursorSubsprite(_) */
function CreateSwitchMapCursorSubsprite(whichSprite: number, tileTag: number, palTag: number): void {
  const s = sw();
  const sub = s.cursorSubsprite[whichSprite];
  const template: SpriteTemplate = {
    tileTag,
    paletteTag: palTag,
    oam: sOamData_SwitchMapCursor,
    anims: sAnims_SwitchMapCursor,
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCB_SwitchMapCursor,
  };
  sub.tileTag = tileTag;
  sub.palTag = palTag;
  LoadSpriteSheet({ data: sub.tiles, size: sub.tiles.length, tag: tileTag });
  LoadSpritePalette({ data: gfx16('sSwitchMapCursor_Pal'), tag: palTag });
  const spriteId = CreateSprite(template, sub.x, 8 * (s.yOffset + 4 * s.currentSelection), 0);
  sub.sprite = gSprites[spriteId];
  gSprites[spriteId].invisible = false;
}

function FreeSwitchMapCursor(): void {
  for (const sub of sw().cursorSubsprite) {
    if (sub.sprite) {
      DestroySprite(sub.sprite);
      FreeSpriteTilesByTag(sub.tileTag);
      FreeSpritePaletteByTag(sub.palTag);
    }
  }
}

// ------------------------------------------------------------------ the dungeon map preview

function GetDungeonFlavorText(mapsec: number): number[] {
  const info = data().dungeonInfo.find(([id]) => id === mapsec);
  return text(info ? info[1] : 'gText_RegionMap_NoData');
}

function GetDungeonName(mapsec: number): number[] {
  const info = data().dungeonInfo.find(([id]) => id === mapsec);
  return info ? mapsecName(info[0]) : text('gText_RegionMap_NoData');
}

/** GetDungeonMapPreviewScreenInfo (map_preview_screen.c) */
function GetDungeonMapPreviewScreenInfo(mapsec: number): [number, string, string, string, string] | undefined {
  return data().mapPreviews.find(([id]) => id === mapsec);
}

/** InitDungeonMapPreview */
function InitDungeonMapPreview(_unused: number, taskId: number, taskFunc: TaskFunc): void {
  let mapsec = GetDungeonMapsecUnderCursor();
  if (mapsec === K.MAPSEC_TANOBY_CHAMBERS) mapsec = K.MAPSEC_MONEAN_CHAMBER;
  const info = GetDungeonMapPreviewScreenInfo(mapsec) ?? GetDungeonMapPreviewScreenInfo(K.MAPSEC_ROCK_TUNNEL)!;
  sDungeonMapPreview = {
    tiles: new Uint8Array(7200 * 2),
    tilemap: new Uint16Array(640),
    mapPreviewInfo: info,
    savedTask: taskFunc,
    mainState: 0,
    drawState: 0,
    loadState: 0,
    updateCounter: 0,
    timer: 0,
    palette: new Uint16Array(0x30),
    red: 0,
    green: 0,
    blue: 0,
    blendY: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    leftIncrement: 0,
    topIncrement: 0,
    rightIncrement: 0,
    bottomIncrement: 0,
  };
  SaveRegionMapGpuRegs(0);
  ResetGpuRegs();
  ClearMapsecNameText();
  gTasks[taskId].func = Task_DungeonMapPreview;
}

const dp = (): DungeonMapPreview => sDungeonMapPreview!;

/**
 * The preview's three palettes (LoadPalette(palptr, BG_PLTT_ID(13), 3 * PLTT_SIZE_4BPP)). The palette files hold
 * two; the C's third is whatever follows them in the ROM, which no preview tilemap uses.
 */
function previewPalette(): Uint16Array {
  const pal = new Uint16Array(0x30);
  const src = gfx16(dp().mapPreviewInfo[4]);
  pal.set(src.subarray(0, 0x30));
  return pal;
}

/** LoadMapPreviewGfx */
function LoadMapPreviewGfx(): boolean {
  const p = dp();
  switch (p.loadState) {
    case 0:
      p.tiles = bytes(p.mapPreviewInfo[2], 7200 * 2);
      break;
    case 1:
      p.tilemap = words(p.mapPreviewInfo[3], 640);
      break;
    case 2:
      LoadBgTiles(2, p.tiles, p.tiles.length, 0);
      break;
    case 3:
      LoadPalette(previewPalette(), BG_PLTT_ID(13), 3 * PLTT_SIZE_4BPP);
      break;
    default:
      return true;
  }
  p.loadState++;
  return false;
}

/** Task_DungeonMapPreview */
function Task_DungeonMapPreview(taskId: number): void {
  const p = dp();
  switch (p.mainState) {
    case 0:
      NullVBlankHBlankCallbacks();
      p.mainState++;
      break;
    case 1:
      if (LoadMapPreviewGfx()) p.mainState++;
      break;
    case 2:
      InitScreenForDungeonMapPreview();
      PrintTopBarTextRight(text('gText_RegionMap_AButtonCancel2'));
      p.mainState++;
      break;
    case 3:
      CopyToBgTilemapBufferRect(2, p.tilemap, 0, 0, 32, 20); // CopyMapPreviewTilemapToBgTilemapBuffer
      CopyBgTilemapBufferToVramDma(2);
      p.mainState++;
      break;
    case 4:
      ShowBg(2);
      p.mainState++;
      break;
    case 5:
      SetRegionMapVBlankCB();
      p.mainState++;
      break;
    case 6:
      if (UpdateDungeonMapPreview(false)) p.mainState++;
      break;
    case 7:
      gTasks[taskId].func = Task_DrawDungeonMapPreviewFlavorText;
      break;
    case 8:
      if (UpdateDungeonMapPreview(true)) p.mainState++;
      break;
    case 9:
      FreeDungeonMapPreview(taskId);
      break;
  }
}

/** Task_DrawDungeonMapPreviewFlavorText: tints the preview and prints the dungeon's name and description over it */
function Task_DrawDungeonMapPreviewFlavorText(taskId: number): void {
  const p = dp();
  switch (p.drawState) {
    case 0:
      p.red = 0x0133;
      p.green = 0x0100;
      p.blue = 0x00f0;
      p.drawState++;
      break;
    case 1:
      // Delay
      if (p.timer++ > 40) {
        p.timer = 0;
        p.drawState++;
      }
      break;
    case 2:
      FillWindowPixelBuffer(WIN_MAP_PREVIEW, PIXEL_FILL(0));
      CopyWindowToVramDma(WIN_MAP_PREVIEW, COPYWIN_FULL);
      PutWindowTilemap(WIN_MAP_PREVIEW);
      p.drawState++;
      break;
    case 3:
      if (p.timer > 25) {
        // Draw text
        AddTextPrinterParameterized3(WIN_MAP_PREVIEW, K.FONT_NORMAL, 4, 0, sTextColor_Green(), TEXT_SKIP_DRAW, GetDungeonName(GetDungeonMapsecUnderCursor()));
        AddTextPrinterParameterized3(WIN_MAP_PREVIEW, K.FONT_NORMAL, 2, 14, sTextColor_White(), TEXT_SKIP_DRAW, GetDungeonFlavorText(GetDungeonMapsecUnderCursor()));
        CopyWindowToVramDma(WIN_MAP_PREVIEW, COPYWIN_FULL);
        p.drawState++;
      } else if (p.timer > 20) {
        // Tint image
        p.red -= 6;
        p.green -= 5;
        p.blue -= 5;
        p.palette = previewPalette();
        TintPalette_CustomTone(p.palette, 48, p.red, p.green, p.blue);
        LoadPalette(p.palette, BG_PLTT_ID(13), p.palette.length * 2);
      }
      p.timer++;
      break;
    case 4:
      if (JOY_NEW(B_BUTTON) || JOY_NEW(A_BUTTON)) {
        FillWindowPixelBuffer(WIN_MAP_PREVIEW, PIXEL_FILL(0));
        CopyWindowToVramDma(WIN_MAP_PREVIEW, COPYWIN_FULL);
        p.mainState++;
        p.drawState++;
      }
      break;
    default:
      gTasks[taskId].func = Task_DungeonMapPreview;
      break;
  }
}

/** FreeDungeonMapPreview */
function FreeDungeonMapPreview(taskId: number): void {
  gTasks[taskId].func = dp().savedTask;
  HideBg(2);
  SetRegionMapGpuRegs(0);
  DisplayCurrentMapName();
  DisplayCurrentDungeonName();
  UpdateMapsecNameBox();
  DrawDungeonNameBox();
  PrintTopBarTextRight(text('gText_RegionMap_AButtonGuide'));
  sDungeonMapPreview = null;
}

/** InitScreenForDungeonMapPreview */
function InitScreenForDungeonMapPreview(): void {
  const p = dp();
  ResetGpuRegs();
  SetBldCnt(0, BLDCNT_TGT1_BG0 | BLDCNT_TGT1_OBJ, BLDCNT_EFFECT_DARKEN);
  SetBldY(p.blendY);
  SetWinIn(0, (WININ_WIN1_BG0 | WININ_WIN1_BG2 | WININ_WIN1_BG3) >> 8);
  SetWinOut(WINOUT_WIN01_BG0 | WINOUT_WIN01_BG1 | WINOUT_WIN01_BG3 | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR);
  SetDispCnt(1, false);
  const x = GetMapCursorX();
  const y = GetMapCursorY();
  // (u16 fields: the increments wrap like the C's)
  p.left = (8 * x + 32) & 0xffff;
  p.top = (8 * y + 24) & 0xffff;
  p.right = (p.left + 8) & 0xffff;
  p.bottom = (p.top + 8) & 0xffff;
  p.leftIncrement = Math.trunc((16 - p.left) / 8) & 0xffff;
  p.topIncrement = Math.trunc((32 - p.top) / 8) & 0xffff;
  p.rightIncrement = Math.trunc((224 - p.right) / 8) & 0xffff;
  p.bottomIncrement = Math.trunc((136 - p.bottom) / 8) & 0xffff;
}

/** UpdateDungeonMapPreview */
function UpdateDungeonMapPreview(closing: boolean): boolean {
  const p = dp();
  if (!closing) {
    if (p.updateCounter < 8) {
      p.left = (p.left + p.leftIncrement) & 0xffff;
      p.top = (p.top + p.topIncrement) & 0xffff;
      p.right = (p.right + p.rightIncrement) & 0xffff;
      p.bottom = (p.bottom + p.bottomIncrement) & 0xffff;
      p.updateCounter++;
      if (p.blendY < 6) p.blendY++;
    } else {
      return true;
    }
  } else if (p.updateCounter === 0) {
    return true;
  } else {
    p.left = (p.left - p.leftIncrement) & 0xffff;
    p.top = (p.top - p.topIncrement) & 0xffff;
    p.right = (p.right - p.rightIncrement) & 0xffff;
    p.bottom = (p.bottom - p.bottomIncrement) & 0xffff;
    p.updateCounter--;
    if (p.blendY > 0) p.blendY--;
  }
  SetGpuWindowDims(1, { left: p.left, top: p.top, right: p.right, bottom: p.bottom });
  SetBldY(p.blendY);
  return false;
}

// ------------------------------------------------------------------ the map opening / closing animation

function SpriteCB_MapEdge(_sprite: Sprite): void {}

/** CreateMapEdgeSprite */
function CreateMapEdgeSprite(mapEdgeNum: number, tileTag: number, palTag: number): void {
  const edge = sMapOpenCloseAnim!.mapEdges[mapEdgeNum];
  const template: SpriteTemplate = {
    tileTag,
    paletteTag: palTag,
    oam: sOamData_MapEdge,
    anims: sAnims_MapEdge,
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCB_MapEdge,
  };
  edge.tileTag = tileTag;
  edge.palTag = palTag;
  // (the C's sheet points at the struct itself, whose first 0x400 bytes are the tiles)
  LoadSpriteSheet({ data: edge.tiles, size: 0x400, tag: tileTag });
  LoadSpritePalette({ data: gfx16('sMapEdge_Pal'), tag: palTag });
  const spriteId = CreateSprite(template, edge.x, edge.y, 0);
  edge.sprite = gSprites[spriteId];
  gSprites[spriteId].invisible = true;
}

/** InitMapOpenAnim */
function InitMapOpenAnim(taskId: number, taskFunc: TaskFunc): void {
  sMapOpenCloseAnim = {
    mapEdges: Array.from({ length: 6 }, (_, i) => ({ tiles: new Uint8Array(0x400), sprite: null, x: 32 * Math.trunc(i / 3) + 104, y: 64 * (i % 3) + 40, tileTag: 0, palTag: 0 })),
    tiles: new Uint8Array(0x800),
    tilemap: new Uint16Array(600),
    exitTask: taskFunc,
    openState: 0,
    loadGfxState: 0,
    moveState: 0,
    closeState: 0,
    blendY: 0,
  };
  SaveRegionMapGpuRegs(0);
  ResetGpuRegs();
  InitScreenForMapOpenAnim();
  SetBg0andBg3Hidden(true);
  gTasks[taskId].func = Task_MapOpenAnim;
}

const anim = (): MapOpenCloseAnim => sMapOpenCloseAnim!;

/** SetMapEdgeInvisibility */
function SetMapEdgeInvisibility(mapEdgeNum: number, invisible: boolean): void {
  const edges = anim().mapEdges;
  if (mapEdgeNum === edges.length) {
    for (const e of edges) if (e.sprite) e.sprite.invisible = invisible;
  } else if (edges[mapEdgeNum].sprite) {
    edges[mapEdgeNum].sprite!.invisible = invisible;
  }
}

/** LoadMapEdgeGfx */
function LoadMapEdgeGfx(): boolean {
  const a = anim();
  const edge = (num: number, sym: string, tag: number): void => {
    a.mapEdges[num].tiles = bytes(sym, 0x400);
    CreateMapEdgeSprite(num, tag, tag);
  };
  switch (a.loadGfxState) {
    case 0:
      edge(MAPEDGE_TOP_LEFT, 'sMapEdge_TopLeft', 4);
      break;
    case 1:
      edge(MAPEDGE_MID_LEFT, 'sMapEdge_MidLeft', 5);
      break;
    case 2:
      edge(MAPEDGE_BOT_LEFT, 'sMapEdge_BottomLeft', 6);
      break;
    case 3:
      edge(MAPEDGE_TOP_RIGHT, 'sMapEdge_TopRight', 7);
      break;
    case 4:
      edge(MAPEDGE_MID_RIGHT, 'sMapEdge_MidRight', 8);
      break;
    case 5:
      edge(MAPEDGE_BOT_RIGHT, 'sMapEdge_BottomRight', 9);
      break;
    case 6:
      a.tiles = bytes('sMapEdge_Gfx', 0x800);
      break;
    case 7:
      a.tilemap = words('sMapEdge_Tilemap', 600);
      break;
    case 8:
      LoadBgTiles(1, a.tiles, BG_SCREEN_SIZE, 0);
      break;
    default:
      return true;
  }
  a.loadGfxState++;
  return false;
}

/** InitScreenForMapOpenAnim */
function InitScreenForMapOpenAnim(): void {
  const a = anim();
  SetBldCnt(0, BLDCNT_TGT1_BG1, BLDCNT_EFFECT_NONE);
  SetWinIn(WININ_WIN0_BG1 | WININ_WIN0_OBJ, 0);
  SetWinOut(WINOUT_WIN01_OBJ);
  SetGpuWindowDims(0, { left: a.mapEdges[MAPEDGE_TOP_LEFT].x + 8, top: 16, right: a.mapEdges[MAPEDGE_TOP_RIGHT].x - 8, bottom: 160 });
  SetDispCnt(0, false);
}

/** SetGpuRegsToFadeMapToWhite */
function SetGpuRegsToFadeMapToWhite(): void {
  ResetGpuRegs();
  SetBldCnt(BLDCNT_TGT2_BG1 >> 8, BLDCNT_TGT1_BG0 | BLDCNT_TGT1_BG3 | BLDCNT_TGT1_BD, BLDCNT_EFFECT_LIGHTEN);
  SetBldY(anim().blendY);
  SetWinIn(WININ_WIN0_ALL & ~WININ_WIN0_BG3, 0);
  SetWinOut(WINOUT_WIN01_BG1 | WINOUT_WIN01_OBJ);
  SetGpuWindowDims(0, sMapWindowDim);
  SetDispCnt(0, false);
}

function FinishMapOpenAnim(taskId: number): void {
  gTasks[taskId].func = anim().exitTask;
}

/** FreeMapOpenCloseAnim */
function FreeMapOpenCloseAnim(): void {
  FreeMapEdgeSprites();
  sMapOpenCloseAnim = null;
}

/** FreeMapEdgeSprites */
function FreeMapEdgeSprites(): void {
  for (const e of anim().mapEdges) {
    if (e.sprite) {
      e.x = e.sprite.x;
      e.y = e.sprite.y;
      DestroySprite(e.sprite);
      FreeSpriteTilesByTag(e.tileTag);
      FreeSpritePaletteByTag(e.palTag);
      e.sprite = null;
    }
  }
}

/** Task_MapOpenAnim */
function Task_MapOpenAnim(taskId: number): void {
  const a = anim();
  switch (a.openState) {
    case 0:
      NullVBlankHBlankCallbacks();
      a.openState++;
      break;
    case 1:
      if (LoadMapEdgeGfx()) a.openState++;
      break;
    case 2:
      CopyToBgTilemapBufferRect(1, a.tilemap, 0, 0, 30, 20);
      a.openState++;
      break;
    case 3:
      CopyBgTilemapBufferToVramDma(1);
      BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      SetRegionMapVBlankCB();
      a.openState++;
      break;
    case 4:
      ShowBg(0);
      ShowBg(3);
      ShowBg(1);
      SetMapEdgeInvisibility(6, false);
      SetGpuWindowDimsToMapEdges();
      a.openState++;
      break;
    case 5:
      if (!gPaletteFade.active) {
        a.openState++;
        PlaySE(K.SE_CARD_OPEN);
      }
      break;
    case 6:
      if (MoveMapEdgesOutward()) a.openState++;
      break;
    case 7:
      SetPlayerIconInvisibility(false);
      SetMapCursorInvisibility(false);
      a.openState++;
      break;
    case 8:
      a.blendY = 15;
      SetGpuRegsToFadeMapToWhite();
      SetBg0andBg3Hidden(false);
      SetFlyIconInvisibility(GetSelectedRegionMap(), NUM_ICONS, false);
      SetDungeonIconInvisibility(GetSelectedRegionMap(), NUM_ICONS, false);
      a.openState++;
      break;
    case 9:
      PrintTopBarTextLeft(text('gText_RegionMap_DPadMove'));
      if (GetSelectedMapsecType(LAYER_DUNGEON) !== MAPSECTYPE_VISITED) PrintTopBarTextRight(text('gText_RegionMap_Space'));
      else PrintTopBarTextRight(text('gText_RegionMap_AButtonGuide'));
      ClearOrDrawTopBar(false);
      a.openState++;
      break;
    case 10: {
      const top15 = gfx16('sTopBar_Pal').subarray(15, 16);
      for (let i = 0; i < 5; i++) LoadPalette(top15, BG_PLTT_ID(i), 2);
      a.openState++;
      break;
    }
    case 11:
      FillBgTilemapBufferRect(1, 0x002, 0, 1, 1, 1, 2);
      FillBgTilemapBufferRect(1, 0x003, 1, 1, 1, 1, 2);
      FillBgTilemapBufferRect(1, 0x03e, 28, 1, 1, 1, 2);
      FillBgTilemapBufferRect(1, 0x03f, 29, 1, 1, 1, 2);
      FillBgTilemapBufferRect(1, 0x03d, 2, 1, 26, 1, 2);
      CopyBgTilemapBufferToVramDma(1);
      // m4aSongNumStop(SE_CARD_OPEN); PlaySE(SE_ROTATING_GATE)
      PlaySE(K.SE_ROTATING_GATE);
      a.openState++;
      break;
    case 12:
      if (a.blendY === 2) {
        SetMapEdgeInvisibility(6, true);
        a.openState++;
        SetBldY(0);
      } else {
        a.blendY--;
        SetBldY(a.blendY);
      }
      break;
    case 13:
      SetRegionMapGpuRegs(0);
      DisplayCurrentDungeonName();
      a.openState++;
      break;
    default:
      FreeMapEdgeSprites();
      FinishMapOpenAnim(taskId);
      break;
  }
}

/** The left edges move by -step and the right ones by +step (MoveMapEdgesOutward / -Inward). */
function moveMapEdges(step: number): void {
  const e = anim().mapEdges;
  for (const i of [MAPEDGE_TOP_LEFT, MAPEDGE_MID_LEFT, MAPEDGE_BOT_LEFT]) e[i].sprite!.x -= step;
  for (const i of [MAPEDGE_TOP_RIGHT, MAPEDGE_MID_RIGHT, MAPEDGE_BOT_RIGHT]) e[i].sprite!.x += step;
}

/** The edges' speed for moveState: 1 px after 17 frames, 2 after 14, 3 after 10, 5 after 6, else 8. */
function edgeStep(moveState: number): number {
  if (moveState > 17) return 1;
  if (moveState > 14) return 2;
  if (moveState > 10) return 3;
  if (moveState > 6) return 5;
  return 8;
}

/** MoveMapEdgesOutward */
function MoveMapEdgesOutward(): boolean {
  SetGpuWindowDimsToMapEdges();
  const a = anim();
  if (a.mapEdges[MAPEDGE_TOP_LEFT].sprite!.x === 0) return true;
  moveMapEdges(edgeStep(a.moveState));
  a.moveState++;
  return false;
}

/** SetGpuWindowDimsToMapEdges */
function SetGpuWindowDimsToMapEdges(): void {
  const e = anim().mapEdges;
  SetGpuWindowDims(0, { left: e[MAPEDGE_TOP_LEFT].sprite!.x, top: 16, right: e[MAPEDGE_TOP_RIGHT].sprite!.x, bottom: 160 });
}

/** InitScreenForMapCloseAnim */
function InitScreenForMapCloseAnim(): void {
  const e = anim().mapEdges;
  SetBldCnt(0, BLDCNT_TGT1_BG1, BLDCNT_EFFECT_NONE);
  SetWinIn(WININ_WIN0_BG1 | WININ_WIN0_OBJ, 0);
  SetWinOut(WINOUT_WIN01_OBJ);
  SetGpuWindowDims(0, { left: e[MAPEDGE_TOP_LEFT].x + 16, top: 16, right: e[MAPEDGE_TOP_RIGHT].x - 16, bottom: 160 });
  SetDispCnt(0, false);
}

/** DoMapCloseAnim */
function DoMapCloseAnim(taskId: number): void {
  gTasks[taskId].func = Task_MapCloseAnim;
}

function CreateMapEdgeSprites(): void {
  for (let i = 0; i < 6; i++) CreateMapEdgeSprite(i, i + 4, i + 4);
}

/** Task_MapCloseAnim */
function Task_MapCloseAnim(taskId: number): void {
  const a = anim();
  switch (a.closeState) {
    case 0:
      ClearOrDrawTopBar(true);
      CopyWindowToVramDma(WIN_TOPBAR_LEFT, COPYWIN_FULL);
      CopyWindowToVramDma(WIN_TOPBAR_RIGHT, COPYWIN_FULL);
      a.closeState++;
      break;
    case 1:
      CreateMapEdgeSprites();
      a.closeState++;
      break;
    case 2: {
      const pal = gfx16('sRegionMap_Pal');
      LoadPalette(pal, BG_PLTT_ID(0), pal.length * 2);
      a.closeState++;
      break;
    }
    case 3:
      SetMapEdgeInvisibility(6, false);
      SetPlayerIconInvisibility(true);
      SetMapCursorInvisibility(true);
      SetDungeonIconInvisibility(0xff, NUM_ICONS, true);
      SetFlyIconInvisibility(0xff, NUM_ICONS, true);
      a.moveState = 0;
      a.blendY = 0;
      a.closeState++;
      break;
    case 4:
      SetGpuRegsToFadeMapToWhite();
      a.closeState++;
      break;
    case 5:
      if (a.blendY === 15) {
        SetBldY(a.blendY);
        a.closeState++;
      } else {
        a.blendY++;
        SetBldY(a.blendY);
      }
      break;
    case 6:
      InitScreenForMapCloseAnim();
      SetGpuWindowDimsToMapEdges();
      PlaySE(K.SE_CARD_FLIPPING);
      a.closeState++;
      break;
    case 7:
      if (MoveMapEdgesInward()) a.closeState++;
      break;
    default:
      gTasks[taskId].func = a.exitTask;
      break;
  }
}

/** MoveMapEdgesInward */
function MoveMapEdgesInward(): boolean {
  SetGpuWindowDimsToMapEdges();
  const a = anim();
  if (a.mapEdges[MAPEDGE_TOP_LEFT].sprite!.x === 104) return true;
  moveMapEdges(-edgeStep(a.moveState));
  a.moveState++;
  return false;
}

// ------------------------------------------------------------------ the cursor

function SpriteCB_MapCursor(sprite: Sprite): void {
  const c = cursor();
  if (c.moveCounter !== 0) {
    sprite.x += c.horizontalMove;
    sprite.y += c.verticalMove;
    c.moveCounter--;
  } else {
    c.sprite!.x = 8 * c.x + 36;
    c.sprite!.y = 8 * c.y + 36;
  }
}

/** CreateMapCursor */
function CreateMapCursor(tileTag: number, palTag: number): void {
  sMapCursor = {
    x: 0,
    y: 0,
    spriteX: 0,
    spriteY: 0,
    horizontalMove: 0,
    verticalMove: 0,
    moveCounter: 0,
    snapId: 0,
    inputHandler: HandleRegionMapInput,
    selectedMapsec: 0,
    selectedMapsecType: 0,
    selectedDungeonType: 0,
    sprite: null,
    tileTag,
    palTag,
    tiles: bytes('sMapCursor_Gfx', 0x100),
  };
  const c = cursor();
  GetPlayerPositionOnRegionMap_HandleOverrides();
  c.spriteX = 8 * c.x + 36;
  c.spriteY = 8 * c.y + 36;
  c.inputHandler = HandleRegionMapInput;
  c.selectedMapsecType = GetMapsecType(c.selectedMapsec);
  c.selectedDungeonType = GetDungeonMapsecType(GetSelectedMapSection(GetSelectedRegionMap(), LAYER_DUNGEON, c.y, c.x));
  CreateMapCursorSprite();
}

/** CreateMapCursorSprite */
function CreateMapCursorSprite(): void {
  const c = cursor();
  const template: SpriteTemplate = {
    tileTag: c.tileTag,
    paletteTag: c.palTag,
    oam: sOamData_MapCursor,
    anims: sAnims_MapCursor,
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCB_MapCursor,
  };
  LoadSpriteSheet({ data: c.tiles, size: c.tiles.length, tag: c.tileTag });
  LoadSpritePalette({ data: gfx16('sMapCursor_Pal'), tag: c.palTag });
  const spriteId = CreateSprite(template, c.spriteX, c.spriteY, 0);
  c.sprite = gSprites[spriteId];
  SetMapCursorInvisibility(true);
}

function SetMapCursorInvisibility(invisible: boolean): void {
  cursor().sprite!.invisible = invisible;
}

function ResetCursorSnap(): void {
  cursor().snapId = 0;
}

function FreeMapCursor(): void {
  const c = cursor();
  if (c.sprite) {
    DestroySprite(c.sprite);
    FreeSpriteTilesByTag(c.tileTag);
    FreeSpritePaletteByTag(c.palTag);
  }
  sMapCursor = null;
}

/** HandleRegionMapInput */
function HandleRegionMapInput(): number {
  const c = cursor();
  let input = MAP_INPUT_NONE;
  c.horizontalMove = 0;
  c.verticalMove = 0;
  if (JOY_HELD(DPAD_UP) && c.y > 0) {
    c.verticalMove = -2;
    input = MAP_INPUT_MOVE_START;
  }
  if (JOY_HELD(DPAD_DOWN) && c.y < MAP_HEIGHT - 1) {
    c.verticalMove = 2;
    input = MAP_INPUT_MOVE_START;
  }
  if (JOY_HELD(DPAD_RIGHT) && c.x < MAP_WIDTH - 1) {
    c.horizontalMove = 2;
    input = MAP_INPUT_MOVE_START;
  }
  if (JOY_HELD(DPAD_LEFT) && c.x > 0) {
    c.horizontalMove = -2;
    input = MAP_INPUT_MOVE_START;
  }
  if (JOY_NEW(A_BUTTON)) {
    input = MAP_INPUT_A_BUTTON;
    if (c.x === CANCEL_BUTTON_X && c.y === CANCEL_BUTTON_Y) {
      PlaySE(K.SE_M_HYPER_BEAM2);
      input = MAP_INPUT_CANCEL;
    }
    if (c.x === SWITCH_BUTTON_X && c.y === SWITCH_BUTTON_Y && GetRegionMapPermission(MAPPERM_HAS_SWITCH_BUTTON)) {
      PlaySE(K.SE_M_HYPER_BEAM2);
      input = MAP_INPUT_SWITCH;
    }
  } else if (!JOY_NEW(B_BUTTON)) {
    if (JOY_REPT(START_BUTTON)) {
      SnapToIconOrButton();
      c.selectedMapsec = GetSelectedMapSection(GetSelectedRegionMap(), LAYER_MAP, c.y, c.x);
      c.selectedMapsecType = GetMapsecType(c.selectedMapsec);
      c.selectedDungeonType = GetDungeonMapsecType(GetSelectedMapSection(GetSelectedRegionMap(), LAYER_DUNGEON, c.y, c.x));
      return MAP_INPUT_MOVE_END;
    } else if (JOY_NEW(SELECT_BUTTON) && rm().savedCallback === CB2_ReturnToField) {
      input = MAP_INPUT_CANCEL;
    }
  } else {
    input = MAP_INPUT_CANCEL;
  }
  if (input === MAP_INPUT_MOVE_START) {
    c.moveCounter = 4;
    c.inputHandler = MoveMapCursor;
  }
  return input;
}

/** MoveMapCursor */
function MoveMapCursor(): number {
  const c = cursor();
  if (c.moveCounter !== 0) return MAP_INPUT_MOVE_CONT;
  if (c.horizontalMove > 0) c.x++;
  if (c.horizontalMove < 0) c.x--;
  if (c.verticalMove > 0) c.y++;
  if (c.verticalMove < 0) c.y--;
  c.selectedMapsec = GetSelectedMapSection(GetSelectedRegionMap(), LAYER_MAP, c.y, c.x);
  c.selectedMapsecType = GetMapsecType(c.selectedMapsec);
  c.selectedDungeonType = GetDungeonMapsecType(GetSelectedMapSection(GetSelectedRegionMap(), LAYER_DUNGEON, c.y, c.x));
  c.inputHandler = HandleRegionMapInput;
  return MAP_INPUT_MOVE_END;
}

function GetRegionMapInput(): number {
  return cursor().inputHandler();
}

/** SnapToIconOrButton: Start snaps the cursor to the player icon / the buttons, cycling through them. */
function SnapToIconOrButton(): void {
  const c = cursor();
  if (GetRegionMapPermission(MAPPERM_HAS_SWITCH_BUTTON)) {
    c.snapId = (c.snapId + 1) % 3;
    // Player icon not present on this map, skip it
    if (c.snapId === 0 && GetSelectedRegionMap() !== GetRegionMapPlayerIsOn()) c.snapId++;
    switch (c.snapId) {
      case 0:
      default:
        c.x = GetPlayerIconX();
        c.y = GetPlayerIconY();
        break;
      case 1:
        c.x = SWITCH_BUTTON_X;
        c.y = SWITCH_BUTTON_Y;
        break;
      case 2:
        c.y = CANCEL_BUTTON_Y;
        c.x = CANCEL_BUTTON_X;
        break;
    }
  } else {
    c.snapId = (c.snapId + 1) % 2;
    switch (c.snapId) {
      case 0:
      default:
        c.x = GetPlayerIconX();
        c.y = GetPlayerIconY();
        break;
      case 1:
        c.y = CANCEL_BUTTON_Y;
        c.x = CANCEL_BUTTON_X;
        break;
    }
  }
  c.sprite!.x = 8 * c.x + 36;
  c.sprite!.y = 8 * c.y + 36;
  c.selectedMapsec = GetSelectedMapSection(GetSelectedRegionMap(), LAYER_MAP, c.y, c.x);
}

function GetMapCursorX(): number {
  return cursor().x;
}

function GetMapCursorY(): number {
  return cursor().y;
}

/** GetMapsecUnderCursor */
function GetMapsecUnderCursor(): number {
  // (CB2_OpenRegionMap names the section before the cursor exists; the C reads a NULL sMapCursor there)
  if (!sMapCursor) return K.MAPSEC_NONE;
  const c = cursor();
  if (c.y < 0 || c.y >= MAP_HEIGHT || c.x < 0 || c.x >= MAP_WIDTH) return K.MAPSEC_NONE;
  let mapsec = GetSelectedMapSection(GetSelectedRegionMap(), LAYER_MAP, c.y, c.x);
  if ((mapsec === K.MAPSEC_NAVEL_ROCK || mapsec === K.MAPSEC_BIRTH_ISLAND) && !flag('FLAG_WORLD_MAP_NAVEL_ROCK_EXTERIOR')) mapsec = K.MAPSEC_NONE;
  return mapsec;
}

/** GetDungeonMapsecUnderCursor */
function GetDungeonMapsecUnderCursor(): number {
  if (!sMapCursor) return K.MAPSEC_NONE;
  const c = cursor();
  if (c.y < 0 || c.y >= MAP_HEIGHT || c.x < 0 || c.x >= MAP_WIDTH) return K.MAPSEC_NONE;
  let mapsec = GetSelectedMapSection(GetSelectedRegionMap(), LAYER_DUNGEON, c.y, c.x);
  if (mapsec === K.MAPSEC_CERULEAN_CAVE && !flag('FLAG_SYS_CAN_LINK_WITH_RS')) mapsec = K.MAPSEC_NONE;
  return mapsec;
}

const visited = (f: string): number => (flag(f) ? MAPSECTYPE_VISITED : MAPSECTYPE_NOT_VISITED);

/** GetMapsecType: towns are VISITED once their FLAG_WORLD_MAP_* is set. */
function GetMapsecType(mapsec: number): number {
  switch (mapsec) {
    case K.MAPSEC_PALLET_TOWN:
      return visited('FLAG_WORLD_MAP_PALLET_TOWN');
    case K.MAPSEC_VIRIDIAN_CITY:
      return visited('FLAG_WORLD_MAP_VIRIDIAN_CITY');
    case K.MAPSEC_PEWTER_CITY:
      return visited('FLAG_WORLD_MAP_PEWTER_CITY');
    case K.MAPSEC_CERULEAN_CITY:
      return visited('FLAG_WORLD_MAP_CERULEAN_CITY');
    case K.MAPSEC_LAVENDER_TOWN:
      return visited('FLAG_WORLD_MAP_LAVENDER_TOWN');
    case K.MAPSEC_VERMILION_CITY:
      return visited('FLAG_WORLD_MAP_VERMILION_CITY');
    case K.MAPSEC_CELADON_CITY:
      return visited('FLAG_WORLD_MAP_CELADON_CITY');
    case K.MAPSEC_FUCHSIA_CITY:
      return visited('FLAG_WORLD_MAP_FUCHSIA_CITY');
    case K.MAPSEC_CINNABAR_ISLAND:
      return visited('FLAG_WORLD_MAP_CINNABAR_ISLAND');
    case K.MAPSEC_INDIGO_PLATEAU:
      return visited('FLAG_WORLD_MAP_INDIGO_PLATEAU_EXTERIOR');
    case K.MAPSEC_SAFFRON_CITY:
      return visited('FLAG_WORLD_MAP_SAFFRON_CITY');
    case K.MAPSEC_ONE_ISLAND:
      return visited('FLAG_WORLD_MAP_ONE_ISLAND');
    case K.MAPSEC_TWO_ISLAND:
      return visited('FLAG_WORLD_MAP_TWO_ISLAND');
    case K.MAPSEC_THREE_ISLAND:
      return visited('FLAG_WORLD_MAP_THREE_ISLAND');
    case K.MAPSEC_FOUR_ISLAND:
      return visited('FLAG_WORLD_MAP_FOUR_ISLAND');
    case K.MAPSEC_FIVE_ISLAND:
      return visited('FLAG_WORLD_MAP_FIVE_ISLAND');
    case K.MAPSEC_SEVEN_ISLAND:
      return visited('FLAG_WORLD_MAP_SEVEN_ISLAND');
    case K.MAPSEC_SIX_ISLAND:
      return visited('FLAG_WORLD_MAP_SIX_ISLAND');
    case K.MAPSEC_ROUTE_4_POKECENTER:
      if (!GetRegionMapPermission(MAPPERM_HAS_FLY_DESTINATIONS)) return MAPSECTYPE_NONE;
      return visited('FLAG_WORLD_MAP_ROUTE4_POKEMON_CENTER_1F');
    case K.MAPSEC_ROUTE_10_POKECENTER:
      return visited('FLAG_WORLD_MAP_ROUTE10_POKEMON_CENTER_1F');
    case K.MAPSEC_NONE:
      return MAPSECTYPE_NONE;
    default:
      return MAPSECTYPE_ROUTE;
  }
}

/** GetDungeonMapsecType */
function GetDungeonMapsecType(mapsec: number): number {
  const flags: Record<string, string> = {
    MAPSEC_VIRIDIAN_FOREST: 'FLAG_WORLD_MAP_VIRIDIAN_FOREST',
    MAPSEC_MT_MOON: 'FLAG_WORLD_MAP_MT_MOON_1F',
    MAPSEC_S_S_ANNE: 'FLAG_WORLD_MAP_SSANNE_EXTERIOR',
    MAPSEC_UNDERGROUND_PATH: 'FLAG_WORLD_MAP_UNDERGROUND_PATH_NORTH_SOUTH_TUNNEL',
    MAPSEC_UNDERGROUND_PATH_2: 'FLAG_WORLD_MAP_UNDERGROUND_PATH_EAST_WEST_TUNNEL',
    MAPSEC_DIGLETTS_CAVE: 'FLAG_WORLD_MAP_DIGLETTS_CAVE_B1F',
    MAPSEC_KANTO_VICTORY_ROAD: 'FLAG_WORLD_MAP_VICTORY_ROAD_1F',
    MAPSEC_ROCKET_HIDEOUT: 'FLAG_WORLD_MAP_ROCKET_HIDEOUT_B1F',
    MAPSEC_SILPH_CO: 'FLAG_WORLD_MAP_SILPH_CO_1F',
    MAPSEC_POKEMON_MANSION: 'FLAG_WORLD_MAP_POKEMON_MANSION_1F',
    MAPSEC_KANTO_SAFARI_ZONE: 'FLAG_WORLD_MAP_SAFARI_ZONE_CENTER',
    MAPSEC_POKEMON_LEAGUE: 'FLAG_WORLD_MAP_POKEMON_LEAGUE_LORELEIS_ROOM',
    MAPSEC_ROCK_TUNNEL: 'FLAG_WORLD_MAP_ROCK_TUNNEL_1F',
    MAPSEC_SEAFOAM_ISLANDS: 'FLAG_WORLD_MAP_SEAFOAM_ISLANDS_1F',
    MAPSEC_POKEMON_TOWER: 'FLAG_WORLD_MAP_POKEMON_TOWER_1F',
    MAPSEC_CERULEAN_CAVE: 'FLAG_WORLD_MAP_CERULEAN_CAVE_1F',
    MAPSEC_POWER_PLANT: 'FLAG_WORLD_MAP_POWER_PLANT',
    MAPSEC_NAVEL_ROCK: 'FLAG_WORLD_MAP_NAVEL_ROCK_EXTERIOR',
    MAPSEC_MT_EMBER: 'FLAG_WORLD_MAP_MT_EMBER_EXTERIOR',
    MAPSEC_BERRY_FOREST: 'FLAG_WORLD_MAP_THREE_ISLAND_BERRY_FOREST',
    MAPSEC_ICEFALL_CAVE: 'FLAG_WORLD_MAP_FOUR_ISLAND_ICEFALL_CAVE_ENTRANCE',
    MAPSEC_ROCKET_WAREHOUSE: 'FLAG_WORLD_MAP_FIVE_ISLAND_ROCKET_WAREHOUSE',
    MAPSEC_TRAINER_TOWER_2: 'FLAG_WORLD_MAP_TRAINER_TOWER_LOBBY',
    MAPSEC_DOTTED_HOLE: 'FLAG_WORLD_MAP_SIX_ISLAND_DOTTED_HOLE_1F',
    MAPSEC_LOST_CAVE: 'FLAG_WORLD_MAP_FIVE_ISLAND_LOST_CAVE_ENTRANCE',
    MAPSEC_PATTERN_BUSH: 'FLAG_WORLD_MAP_SIX_ISLAND_PATTERN_BUSH',
    MAPSEC_ALTERING_CAVE: 'FLAG_WORLD_MAP_SIX_ISLAND_ALTERING_CAVE',
    MAPSEC_TANOBY_CHAMBERS: 'FLAG_WORLD_MAP_SEVEN_ISLAND_TANOBY_RUINS_MONEAN_CHAMBER',
    MAPSEC_THREE_ISLE_PATH: 'FLAG_WORLD_MAP_THREE_ISLAND_DUNSPARCE_TUNNEL',
    MAPSEC_TANOBY_KEY: 'FLAG_WORLD_MAP_SEVEN_ISLAND_SEVAULT_CANYON_TANOBY_KEY',
    MAPSEC_BIRTH_ISLAND: 'FLAG_WORLD_MAP_BIRTH_ISLAND_EXTERIOR',
  };
  if (mapsec === K.MAPSEC_NONE) return MAPSECTYPE_NONE;
  for (const [sec, f] of Object.entries(flags)) if (K[sec] === mapsec) return visited(f);
  return MAPSECTYPE_ROUTE;
}

/** GetSelectedMapsecType */
function GetSelectedMapsecType(layer: number): number {
  if (!sMapCursor) return MAPSECTYPE_NONE;
  return layer === LAYER_DUNGEON ? cursor().selectedDungeonType : cursor().selectedMapsecType;
}

/** GetPlayerCurrentMapSectionId: the section of gSaveBlock1Ptr->location's header (the current map's). */
function GetPlayerCurrentMapSectionId(): number {
  return location().mapsec;
}

/** GetPlayerPositionOnRegionMap: the player's map position scaled into their section's cells. */
function GetPlayerPositionOnRegionMap(): void {
  const c = cursor();
  const loc = location();
  let width: number;
  let height: number;
  let x: number;
  let y: number;
  const fromWarp = (warp: RegionMapWarp | undefined): void => {
    // (an unset warp: the C reads MAP 0.0's header, its map type is never this)
    const w = warp ?? { mapsec: K.MAPSEC_NONE, width: 1, height: 1, x: 0, y: 0 };
    width = w.width;
    height = w.height;
    x = w.x;
    y = w.y;
  };
  switch (loc.mapType) {
    default:
    case K.MAP_TYPE_TOWN:
    case K.MAP_TYPE_CITY:
    case K.MAP_TYPE_ROUTE:
    case K.MAP_TYPE_UNDERWATER:
    case K.MAP_TYPE_OCEAN_ROUTE:
      c.selectedMapsec = loc.mapsec;
      width = loc.width;
      height = loc.height;
      x = loc.x;
      y = loc.y;
      break;
    case K.MAP_TYPE_UNDERGROUND:
    case K.MAP_TYPE_UNKNOWN:
      c.selectedMapsec = loc.escapeWarp?.mapsec ?? K.MAPSEC_NONE;
      fromWarp(loc.escapeWarp);
      break;
    case K.MAP_TYPE_SECRET_BASE:
      c.selectedMapsec = loc.dynamicWarp?.mapsec ?? K.MAPSEC_NONE;
      fromWarp(loc.dynamicWarp);
      break;
    case K.MAP_TYPE_INDOOR:
      if ((c.selectedMapsec = loc.mapsec) !== K.MAPSEC_SPECIAL_AREA) {
        fromWarp(loc.escapeWarp);
      } else {
        fromWarp(loc.dynamicWarp);
        c.selectedMapsec = loc.dynamicWarp?.mapsec ?? K.MAPSEC_NONE;
      }
      break;
  }
  c.selectedMapsec -= K.KANTO_MAPSEC_START;
  const dims = data().dimensions[c.selectedMapsec] ?? [1, 1];
  const corner = data().topLeftCorners[c.selectedMapsec] ?? [0, 0];
  let divisor = Math.trunc(width! / dims[0]);
  if (divisor === 0) divisor = 1;
  x = Math.trunc(x! / divisor);
  if (x >= dims[0]) x = dims[0] - 1;
  divisor = Math.trunc(height! / dims[1]);
  if (divisor === 0) divisor = 1;
  y = Math.trunc(y! / divisor);
  if (y >= dims[1]) y = dims[1] - 1;
  c.x = x + corner[0];
  c.y = y + corner[1];
}

/** MAP_NUM(map) */
function mapNum(mapId: string): number {
  return data().mapNums[mapId] ?? -1;
}

/** GetPlayerPositionOnRegionMap_HandleOverrides: fixed cells for dungeons and a few sections. */
function GetPlayerPositionOnRegionMap_HandleOverrides(): void {
  const c = cursor();
  // (these compare only gSaveBlock1Ptr->location.mapNum, like the C)
  const num = mapNum(location().mapId);
  const at = (x: number, y: number): void => {
    c.x = x;
    c.y = y;
  };
  switch (GetPlayerCurrentMapSectionId()) {
    case K.MAPSEC_KANTO_SAFARI_ZONE:
      at(12, 12);
      break;
    case K.MAPSEC_SILPH_CO:
      at(14, 6);
      break;
    case K.MAPSEC_POKEMON_MANSION:
      at(4, 14);
      break;
    case K.MAPSEC_POKEMON_TOWER:
      at(18, 6);
      break;
    case K.MAPSEC_POWER_PLANT:
      at(18, 4);
      break;
    case K.MAPSEC_S_S_ANNE:
      at(14, 9);
      break;
    case K.MAPSEC_POKEMON_LEAGUE:
      at(2, 3);
      break;
    case K.MAPSEC_ROCKET_HIDEOUT:
      at(11, 6);
      break;
    case K.MAPSEC_UNDERGROUND_PATH:
      at(14, 7);
      if (num === mapNum('MAP_UNDERGROUND_PATH_NORTH_ENTRANCE')) at(14, 5);
      break;
    case K.MAPSEC_UNDERGROUND_PATH_2:
      at(12, 6);
      if (num === mapNum('MAP_UNDERGROUND_PATH_EAST_ENTRANCE')) at(15, 6);
      break;
    case K.MAPSEC_BIRTH_ISLAND:
      at(18, 13);
      break;
    case K.MAPSEC_NAVEL_ROCK:
      at(10, 8);
      break;
    case K.MAPSEC_TRAINER_TOWER_2:
      at(5, 6);
      break;
    case K.MAPSEC_MT_EMBER:
      at(2, 3);
      break;
    case K.MAPSEC_BERRY_FOREST:
      at(14, 12);
      break;
    case K.MAPSEC_PATTERN_BUSH:
      at(17, 3);
      break;
    case K.MAPSEC_ROCKET_WAREHOUSE:
      at(17, 11);
      break;
    case K.MAPSEC_DILFORD_CHAMBER:
    case K.MAPSEC_LIPTOO_CHAMBER:
    case K.MAPSEC_MONEAN_CHAMBER:
    case K.MAPSEC_RIXY_CHAMBER:
    case K.MAPSEC_SCUFIB_CHAMBER:
    case K.MAPSEC_TANOBY_CHAMBERS:
    case K.MAPSEC_VIAPOIS_CHAMBER:
    case K.MAPSEC_WEEPTH_CHAMBER:
      at(9, 12);
      break;
    case K.MAPSEC_DOTTED_HOLE:
      at(16, 8);
      break;
    case K.MAPSEC_VIRIDIAN_FOREST:
      at(4, 6);
      break;
    case K.MAPSEC_ROUTE_2:
      if (num === mapNum('MAP_PALLET_TOWN')) at(4, 7);
      else if (num === mapNum('MAP_CERULEAN_CITY')) at(4, 5);
      else GetPlayerPositionOnRegionMap();
      break;
    case K.MAPSEC_ROUTE_21:
      if (num === mapNum('MAP_ROUTE21_NORTH')) at(4, 12);
      else if (num === mapNum('MAP_ROUTE21_SOUTH')) at(4, 13);
      break;
    case K.MAPSEC_ROUTE_5:
      if (num === mapNum('MAP_VIRIDIAN_CITY')) at(14, 5);
      else GetPlayerPositionOnRegionMap();
      break;
    case K.MAPSEC_ROUTE_6:
      if (num === mapNum('MAP_PALLET_TOWN')) at(14, 7);
      else GetPlayerPositionOnRegionMap();
      break;
    case K.MAPSEC_ROUTE_7:
      if (num === mapNum('MAP_PALLET_TOWN')) at(13, 6);
      else GetPlayerPositionOnRegionMap();
      break;
    case K.MAPSEC_ROUTE_8:
      if (num === mapNum('MAP_PALLET_TOWN')) at(15, 6);
      else GetPlayerPositionOnRegionMap();
      break;
    default:
      GetPlayerPositionOnRegionMap();
      break;
  }
  c.selectedMapsec = GetSelectedMapSection(GetSelectedRegionMap(), LAYER_MAP, c.y, c.x);
}

/** GetSelectedMapSection */
function GetSelectedMapSection(whichMap: number, layer: number, y: number, x: number): number {
  return data().layouts[whichMap]?.[layer]?.[y]?.[x] ?? K.MAPSEC_NONE;
}

// ------------------------------------------------------------------ the player icon

/** CreatePlayerIcon */
function CreatePlayerIcon(tileTag: number, palTag: number): void {
  const female = state.playerGender === 'female';
  sPlayerIcon = {
    x: GetMapCursorX(),
    y: GetMapCursorY(),
    sprite: null,
    tileTag,
    palTag,
    tiles: bytes(female ? 'sPlayerIcon_Leaf' : 'sPlayerIcon_Red', 0x80),
  };
  CreatePlayerIconSprite();
}

/** CreatePlayerIconSprite */
function CreatePlayerIconSprite(): void {
  const p = sPlayerIcon!;
  const template: SpriteTemplate = {
    tileTag: p.tileTag,
    paletteTag: p.palTag,
    oam: sOamData_PlayerIcon,
    anims: sAnims_PlayerIcon,
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  };
  LoadSpriteSheet({ data: p.tiles, size: p.tiles.length, tag: p.tileTag });
  LoadSpritePalette({ data: gfx16(state.playerGender === 'female' ? 'sPlayerIcon_LeafPal' : 'sPlayerIcon_RedPal'), tag: p.palTag });
  const spriteId = CreateSprite(template, 8 * p.x + 36, 8 * p.y + 36, 2);
  p.sprite = gSprites[spriteId];
  SetPlayerIconInvisibility(true);
}

function SetPlayerIconInvisibility(invisible: boolean): void {
  sPlayerIcon!.sprite!.invisible = invisible;
}

function FreePlayerIcon(): void {
  const p = sPlayerIcon!;
  if (p.sprite) {
    DestroySprite(p.sprite);
    FreeSpriteTilesByTag(p.tileTag);
    FreeSpritePaletteByTag(p.palTag);
  }
  sPlayerIcon = null;
}

function GetPlayerIconX(): number {
  return sPlayerIcon!.x;
}

function GetPlayerIconY(): number {
  return sPlayerIcon!.y;
}

// ------------------------------------------------------------------ fly and dungeon icons

/** InitMapIcons */
function InitMapIcons(_whichMap: number, taskId: number, taskFunc: TaskFunc): void {
  const icon = (): MapIconSprite => ({ region: 0, sprite: null, tileTag: 0, palTag: 0 });
  sMapIcons = {
    dungeonIconTiles: bytes('sDungeonIcon', 0x40),
    flyIconTiles: bytes('sFlyIcon', 0x100),
    dungeonIcons: Array.from({ length: NUM_ICONS }, icon),
    flyIcons: Array.from({ length: NUM_ICONS }, icon),
    state: 0,
    exitTask: taskFunc,
  };
  gTasks[taskId].func = LoadMapIcons;
}

/** LoadMapIcons */
function LoadMapIcons(taskId: number): void {
  const m = sMapIcons!;
  switch (m.state) {
    case 0:
      NullVBlankHBlankCallbacks();
      m.state++;
      break;
    case 1:
      CreateDungeonIcons();
      m.state++;
      break;
    case 2:
      CreateFlyIcons();
      m.state++;
      break;
    case 3:
      BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      m.state++;
      break;
    case 4:
      SetRegionMapVBlankCB();
      m.state++;
      break;
    default:
      SetGpuReg(REG_OFFSET_DISPCNT, GetGpuReg(REG_OFFSET_DISPCNT) | DISPCNT_OBJ_ON);
      gTasks[taskId].func = m.exitTask; // FinishMapIconLoad
      break;
  }
}

/** CreateFlyIconSprite (like the C, it leaves the icon's tileTag / palTag at 0, which is what FreeMapIcons frees) */
function CreateFlyIconSprite(whichMap: number, numIcons: number, x: number, y: number, tileTag: number, palTag: number): void {
  const m = sMapIcons!;
  const template: SpriteTemplate = {
    tileTag,
    paletteTag: palTag,
    oam: sOamData_FlyIcon,
    anims: sAnims_FlyIcon,
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  };
  LoadSpriteSheet({ data: m.flyIconTiles, size: m.flyIconTiles.length, tag: tileTag });
  LoadSpritePalette({ data: gfx16('sMiscIcon_Pal'), tag: palTag });
  const spriteId = CreateSprite(template, 8 * x + 36, 8 * y + 36, 1);
  m.flyIcons[numIcons].sprite = gSprites[spriteId];
  gSprites[spriteId].invisible = true;
  m.flyIcons[numIcons].region = whichMap;
}

/** CreateDungeonIconSprite */
function CreateDungeonIconSprite(whichMap: number, numIcons: number, x: number, y: number, tileTag: number, palTag: number): void {
  const m = sMapIcons!;
  const template: SpriteTemplate = {
    tileTag,
    paletteTag: palTag,
    oam: sOamData_DungeonIcon,
    anims: sAnims_DungeonIcon,
    images: null,
    affineAnims: gDummySpriteAffineAnimTable,
    callback: SpriteCallbackDummy,
  };
  LoadSpriteSheet({ data: m.dungeonIconTiles, size: m.dungeonIconTiles.length, tag: tileTag });
  LoadSpritePalette({ data: gfx16('sMiscIcon_Pal'), tag: palTag });
  const mapsec = GetSelectedMapSection(whichMap, LAYER_MAP, y, x);
  // If mapsec has a town, push dungeon icon to bottom right corner
  let offset = 0;
  if ((GetMapsecType(mapsec) === MAPSECTYPE_VISITED || GetMapsecType(mapsec) === MAPSECTYPE_NOT_VISITED) && mapsec !== K.MAPSEC_ROUTE_10_POKECENTER) offset = 2;
  const spriteId = CreateSprite(template, 8 * x + 36 + offset, 8 * y + 36 + offset, 3);
  m.dungeonIcons[numIcons].sprite = gSprites[spriteId];
  gSprites[spriteId].invisible = true;
  m.dungeonIcons[numIcons].region = whichMap;
}

/** CreateFlyIcons: a blinking icon on every visited town (the fly map only). */
function CreateFlyIcons(): void {
  let numIcons = 0;
  if (GetRegionMapPermission(MAPPERM_HAS_FLY_DESTINATIONS)) {
    for (let i = 0; i < REGIONMAP_COUNT; i++) {
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          if (GetMapsecType(GetSelectedMapSection(i, LAYER_MAP, y, x)) === MAPSECTYPE_VISITED && numIcons < NUM_ICONS) {
            CreateFlyIconSprite(i, numIcons, x, y, numIcons + 10, 10);
            numIcons++;
          }
        }
      }
    }
  }
}

/** CreateDungeonIcons */
function CreateDungeonIcons(): void {
  let numIcons = 0;
  for (let i = 0; i < REGIONMAP_COUNT; i++) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const mapsec = GetSelectedMapSection(i, LAYER_DUNGEON, y, x);
        if (mapsec === K.MAPSEC_NONE) continue;
        if (mapsec === K.MAPSEC_CERULEAN_CAVE && !flag('FLAG_SYS_CAN_LINK_WITH_RS')) continue;
        if (numIcons >= NUM_ICONS) continue;
        CreateDungeonIconSprite(i, numIcons, x, y, numIcons + 35, 10);
        if (GetDungeonMapsecType(mapsec) !== MAPSECTYPE_VISITED) StartSpriteAnim(sMapIcons!.dungeonIcons[numIcons].sprite!, 1);
        numIcons++;
      }
    }
  }
}

/** SetFlyIconInvisibility (whichMap 0xFF: every region; the C writes through the empty slots' NULL sprites) */
function SetFlyIconInvisibility(whichMap: number, iconNum: number, invisible: boolean): void {
  const icons = sMapIcons!.flyIcons;
  if (iconNum === NUM_ICONS) {
    for (const icon of icons) if ((icon.region === whichMap || whichMap === 0xff) && icon.sprite) icon.sprite.invisible = invisible;
  } else if (icons[iconNum].region === whichMap && icons[iconNum].sprite) {
    icons[iconNum].sprite!.invisible = invisible;
  }
}

/** SetDungeonIconInvisibility */
function SetDungeonIconInvisibility(whichMap: number, iconNum: number, invisible: boolean): void {
  const icons = sMapIcons!.dungeonIcons;
  if (iconNum === NUM_ICONS) {
    for (const icon of icons) if ((icon.region === whichMap || whichMap === 0xff) && icon.sprite) icon.sprite.invisible = invisible;
  } else if (icons[iconNum].region !== whichMap && icons[iconNum].sprite) {
    icons[iconNum].sprite!.invisible = invisible;
  }
}

/** FreeMapIcons */
function FreeMapIcons(): void {
  const m = sMapIcons!;
  for (const icon of [...m.flyIcons, ...m.dungeonIcons]) {
    if (icon.sprite) {
      DestroySprite(icon.sprite);
      FreeSpriteTilesByTag(icon.tileTag);
      FreeSpritePaletteByTag(icon.palTag);
    }
  }
  sMapIcons = null;
}

// ------------------------------------------------------------------ GPU registers

/** SaveRegionMapGpuRegs */
function SaveRegionMapGpuRegs(idx: number): boolean {
  if (sRegionMapGpuRegs[idx]) return false;
  sRegionMapGpuRegs[idx] = {
    bldcnt: GetGpuReg(REG_OFFSET_BLDCNT),
    bldy: GetGpuReg(REG_OFFSET_BLDY),
    bldalpha: GetGpuReg(REG_OFFSET_BLDALPHA),
    winin: GetGpuReg(REG_OFFSET_WININ),
    winout: GetGpuReg(REG_OFFSET_WINOUT),
    win0h: GetGpuReg(REG_OFFSET_WIN0H),
    win1h: GetGpuReg(REG_OFFSET_WIN1H),
    win0v: GetGpuReg(REG_OFFSET_WIN0V),
    win1v: GetGpuReg(REG_OFFSET_WIN1V),
  };
  return true;
}

/** SetRegionMapGpuRegs */
function SetRegionMapGpuRegs(idx: number): boolean {
  const r = sRegionMapGpuRegs[idx];
  if (!r) return false;
  SetGpuReg(REG_OFFSET_BLDCNT, r.bldcnt);
  SetGpuReg(REG_OFFSET_BLDY, r.bldy);
  SetGpuReg(REG_OFFSET_BLDALPHA, r.bldalpha);
  SetGpuReg(REG_OFFSET_WININ, r.winin);
  SetGpuReg(REG_OFFSET_WINOUT, r.winout);
  SetGpuReg(REG_OFFSET_WIN0H, r.win0h);
  SetGpuReg(REG_OFFSET_WIN1H, r.win1h);
  SetGpuReg(REG_OFFSET_WIN0V, r.win0v);
  SetGpuReg(REG_OFFSET_WIN1V, r.win1v);
  sRegionMapGpuRegs[idx] = null;
  return true;
}

function FreeRegionMapGpuRegs(): void {
  sRegionMapGpuRegs.fill(null);
}

/** ResetGpuRegs */
function ResetGpuRegs(): void {
  const zero = { left: 0, top: 0, right: 0, bottom: 0 };
  SetBldCnt(0, 0, BLDCNT_EFFECT_NONE);
  SetBldY(0);
  SetGpuWindowDims(0, zero);
  SetGpuWindowDims(1, zero);
  SetWinIn(0, 0);
  SetDispCnt(0, true);
  SetDispCnt(1, true);
}

function SetBldCnt(tgt2: number, tgt1: number, effect: number): void {
  SetGpuReg(REG_OFFSET_BLDCNT, ((tgt2 << 8) | tgt1 | effect) & 0xffff);
}

function SetBldY(tgt: number): void {
  SetGpuReg(REG_OFFSET_BLDY, tgt);
}

function SetBldAlpha(tgt2: number, tgt1: number): void {
  SetGpuReg(REG_OFFSET_BLDALPHA, ((tgt2 << 8) | tgt1) & 0xffff);
}

function SetWinIn(b: number, a: number): void {
  SetGpuReg(REG_OFFSET_WININ, ((a << 8) | b) & 0xffff);
}

function SetWinOut(regval: number): void {
  SetGpuReg(REG_OFFSET_WINOUT, regval);
}

/** SetDispCnt(idx, clear): WIN0 / WIN1 on or off */
function SetDispCnt(idx: number, clear: boolean): void {
  if (!clear) SetGpuReg(REG_OFFSET_DISPCNT, GetGpuReg(REG_OFFSET_DISPCNT) | sWinFlags[idx]);
  else ClearGpuRegBits(REG_OFFSET_DISPCNT, sWinFlags[idx]);
}

function SetGpuWindowDims(winIdx: number, d: GpuWindowParams): void {
  SetGpuReg(sWinRegs[winIdx][0], WIN_RANGE(d.top, d.bottom));
  SetGpuReg(sWinRegs[winIdx][1], WIN_RANGE(d.left, d.right));
}

function FreeAndResetGpuRegs(): void {
  FreeRegionMapGpuRegs();
  ResetGpuRegs();
}

// ------------------------------------------------------------------ the top bar

function PrintTopBarTextLeft(str: number[]): void {
  FillWindowPixelBuffer(WIN_TOPBAR_LEFT, PIXEL_FILL(rm().permissions[MAPPERM_HAS_OPEN_ANIM] ? 0 : 15));
  AddTextPrinterParameterized3(WIN_TOPBAR_LEFT, K.FONT_SMALL, 0, 0, sTextColors(), 0, str);
  CopyWindowToVramDma(WIN_TOPBAR_LEFT, COPYWIN_GFX);
}

function PrintTopBarTextRight(str: number[]): void {
  FillWindowPixelBuffer(WIN_TOPBAR_RIGHT, PIXEL_FILL(rm().permissions[MAPPERM_HAS_OPEN_ANIM] ? 0 : 15));
  AddTextPrinterParameterized3(WIN_TOPBAR_RIGHT, K.FONT_SMALL, 0, 0, sTextColors(), 0, str);
  CopyWindowToVramDma(WIN_TOPBAR_RIGHT, COPYWIN_FULL);
  topBarRight = str;
}

/** The top bar's right text, for the test probe. */
let topBarRight: number[] = [];

function ClearOrDrawTopBar(clear: boolean): void {
  if (!clear) {
    PutWindowTilemap(WIN_TOPBAR_LEFT);
    PutWindowTilemap(WIN_TOPBAR_RIGHT);
  } else {
    ClearWindowTilemap(WIN_TOPBAR_LEFT);
    ClearWindowTilemap(WIN_TOPBAR_RIGHT);
  }
}

// ------------------------------------------------------------------ the fly map

/** CB2_OpenFlyMap: the party menu's FLY. */
export function CB2_OpenFlyMap(): void {
  InitFlyMap();
  InitRegionMap(REGIONMAP_TYPE_FLY);
}

/** Task_FlyMap */
function Task_FlyMap(taskId: number): void {
  const f = sFlyMap!;
  switch (f.state) {
    case 0:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      InitMapIcons(GetSelectedRegionMap(), taskId, GetMainMapTask());
      CreateMapCursor(0, 0);
      CreatePlayerIcon(1, 1);
      SetMapCursorInvisibility(false);
      SetPlayerIconInvisibility(false);
      f.state++;
      break;
    case 1:
      if (GetRegionMapPermission(MAPPERM_HAS_OPEN_ANIM)) {
        InitMapOpenAnim(taskId, GetMainMapTask());
      } else {
        ShowBg(0);
        ShowBg(3);
        ShowBg(1);
        PrintTopBarTextLeft(text('gText_RegionMap_DPadMove'));
        SetFlyIconInvisibility(GetSelectedRegionMap(), NUM_ICONS, false);
        SetDungeonIconInvisibility(GetSelectedRegionMap(), NUM_ICONS, false);
      }
      f.state++;
      break;
    case 2:
      PrintTopBarTextRight(text('gText_RegionMap_AButtonOK'));
      ClearOrDrawTopBar(false);
      f.state++;
      break;
    case 3:
      if (!gPaletteFade.active) {
        DisplayCurrentMapName();
        PutWindowTilemap(WIN_MAP_NAME);
        DisplayCurrentDungeonName();
        PutWindowTilemap(WIN_DUNGEON_NAME);
        f.state++;
      }
      break;
    case 4:
      switch (GetRegionMapInput()) {
        case MAP_INPUT_MOVE_START:
        case MAP_INPUT_MOVE_CONT:
          break;
        case MAP_INPUT_CANCEL:
          f.state = 6;
          break;
        case MAP_INPUT_MOVE_END:
          if (GetSelectedMapsecType(LAYER_MAP) === MAPSECTYPE_VISITED) PlaySE(K.SE_DEX_PAGE);
          else PlaySEForSelectedMapsec();
          ResetCursorSnap();
          DisplayCurrentMapName();
          DisplayCurrentDungeonName();
          DrawDungeonNameBox();
          if (GetMapCursorX() === CANCEL_BUTTON_X && GetMapCursorY() === CANCEL_BUTTON_Y) {
            PlaySE(K.SE_M_SPIT_UP);
            PrintTopBarTextRight(text('gText_RegionMap_AButtonCancel'));
          } else if (GetSelectedMapsecType(LAYER_MAP) === MAPSECTYPE_VISITED || GetSelectedMapsecType(LAYER_MAP) === MAPSECTYPE_UNKNOWN) {
            PrintTopBarTextRight(text('gText_RegionMap_AButtonOK'));
          } else {
            PrintTopBarTextRight(text('gText_RegionMap_Space'));
          }
          break;
        case MAP_INPUT_A_BUTTON:
          if ((GetSelectedMapsecType(LAYER_MAP) === MAPSECTYPE_VISITED || GetSelectedMapsecType(LAYER_MAP) === MAPSECTYPE_UNKNOWN) && GetRegionMapPermission(MAPPERM_HAS_FLY_DESTINATIONS)) {
            switch (location().mapType) {
              case K.MAP_TYPE_UNDERGROUND:
              case K.MAP_TYPE_INDOOR:
                f.selectedDestination = false;
                f.state++;
                break;
              default:
                PlaySE(K.SE_USE_ITEM);
                f.selectedDestination = true;
                f.state++;
                break;
            }
          }
          break;
        case MAP_INPUT_SWITCH:
          InitSwitchMapMenu(GetSelectedRegionMap(), taskId, SaveMainMapTask);
          break;
      }
      break;
    case 5:
      if (GetRegionMapPermission(MAPPERM_HAS_OPEN_ANIM)) DoMapCloseAnim(taskId);
      f.state++;
      break;
    case 6:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
      f.state++;
      break;
    default:
      if (!gPaletteFade.active) {
        if (f.selectedDestination) SetFlyWarpDestination(GetMapsecUnderCursor());
        FreeFlyMap(taskId);
      }
      break;
  }
}

function InitFlyMap(): void {
  sFlyMap = { state: 0, selectedDestination: false };
}

/** FreeFlyMap: back to the field to fly, or to the party menu. */
function FreeFlyMap(taskId: number): void {
  if (GetRegionMapPermission(MAPPERM_HAS_OPEN_ANIM)) FreeMapOpenCloseAnim();
  FreeMapIcons();
  FreeMapCursor();
  FreePlayerIcon();
  FreeAndResetGpuRegs();
  FreeRegionMapForFlyMap();
  DestroyTask(taskId);
  FreeAllWindowBuffers();
  const selected = sFlyMap!.selectedDestination;
  sFlyMap = null;
  if (selected) SetMainCallback2(CB2_ReturnToField);
  else SetMainCallback2(CB2_ReturnToPartyMenuFromFlyMap);
}

/** SetFlyWarpDestination: the mapsec's heal location, else the map's centre (warp -1). */
function SetFlyWarpDestination(mapsec: number): void {
  const dest = data().flyDestinations[mapsec - K.KANTO_MAPSEC_START];
  if (dest && dest[1]) {
    SetWarpDestinationToHealLocation(dest[1]);
    // (SetUsedFlyQuestLogEvent: no quest log)
  } else {
    SetWarpDestinationToMapWarp(dest?.[0] ?? 'MAP_PALLET_TOWN', -1);
  }
  ReturnToFieldFromFlyMapSelect();
}

// ------------------------------------------------------------------ test probe

/** The screen while it runs: its type, the cursor, what's under it, the regions and the icons. */
export function regionMapProbe():
  | {
      type: number;
      task: string;
      /** The main task is at its input state (Task_RegionMap 3, Task_FlyMap 4). */
      ready: boolean;
      cursor: { x: number; y: number };
      /** The cursor is between two cells (MoveMapCursor). */
      moving: boolean;
      player: { x: number; y: number } | undefined;
      selectedRegion: number;
      playersRegion: number;
      mapsec: number;
      mapsecType: number;
      dungeonMapsec: number;
      dungeonType: number;
      flyIcons: { region: number; x: number; y: number; invisible: boolean }[];
      mapName: number[];
      topBarRight: number[];
      switchMenu: boolean;
      preview: boolean;
    }
  | undefined {
  if (!sRegionMap || !sMapCursor) return undefined;
  const main = gTasks.find((t) => t.isActive && t.func === sRegionMap!.mainTask);
  const task = main ? main.func.name : (gTasks.find((t) => t.isActive)?.func.name ?? '');
  const ready = !!main && (sFlyMap ? sFlyMap.state === 4 : sRegionMap.mainState === 3);
  return {
    type: sRegionMap.type,
    task,
    ready,
    cursor: { x: sMapCursor.x, y: sMapCursor.y },
    moving: sMapCursor.inputHandler === MoveMapCursor,
    player: sPlayerIcon ? { x: sPlayerIcon.x, y: sPlayerIcon.y } : undefined,
    selectedRegion: sRegionMap.selectedRegion,
    playersRegion: sRegionMap.playersRegion,
    mapsec: GetMapsecUnderCursor(),
    mapsecType: sMapCursor.selectedMapsecType,
    dungeonMapsec: GetDungeonMapsecUnderCursor(),
    dungeonType: sMapCursor.selectedDungeonType,
    flyIcons: (sMapIcons?.flyIcons ?? [])
      .filter((i) => i.sprite)
      .map((i) => ({ region: i.region, x: (i.sprite!.x - 36) / 8, y: (i.sprite!.y - 36) / 8, invisible: i.sprite!.invisible })),
    mapName: sRegionMap.mapName,
    topBarRight,
    switchMenu: !!sSwitchMapMenu,
    preview: !!sDungeonMapPreview,
  };
}
