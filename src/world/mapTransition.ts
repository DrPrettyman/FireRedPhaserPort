// What a warp looks like between maps of different types: fldeff_flash.c's sTransitionTypes (the
// white fades in and out of caves, MapTransitionIsEnter / MapTransitionIsExit), CB2_DoChangeMap's
// TryDoMapTransition and its FlashTransition_Enter / FlashTransition_Exit screens, which run on the
// GBA layer between the fade out and the new map. Map preview screens (map_preview_screen.c) aren't
// ported: where one would show, the warp goes straight on to the map.

import { gfx, gfx16 } from '../gba/gfx';
import {
  BG_CHAR_ADDR,
  BG_SCREEN_ADDR,
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT1_BG0,
  BLDCNT_TGT2_BD,
  BLDCNT_TGT2_BG1,
  BLDCNT_TGT2_BG2,
  BLDCNT_TGT2_BG3,
  BLDCNT_TGT2_OBJ,
  DISPCNT_BG0_ON,
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
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
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  SetGpuReg,
  vram,
} from '../gba/hw';
import { SetVBlankCallback } from '../gba/main';
import { BG_PLTT_ID, gPlttBufferFaded, gPlttBufferUnfaded, LoadPalette, ResetPaletteFade, TransferPlttBuffer } from '../gba/palette';
import { ProcessSpriteCopyRequests, ResetOamRange, ResetSpriteData } from '../gba/sprite';
import { CreateTask, gTasks, ResetTasks } from '../gba/task';
import { K } from '../battle/constants';

/** struct FlashStruct (func2 is RunMapPreviewScreen for every entry) */
interface FlashStruct {
  fromType: number;
  toType: number;
  isEnter: boolean;
  isExit: boolean;
  func1: () => void;
}

let sTransitionTypesTable: FlashStruct[] | undefined;

/** sTransitionTypes: into MAP_TYPE_UNDERGROUND from every other type, and back out. */
function sTransitionTypes(): FlashStruct[] {
  if (!sTransitionTypesTable) {
    const others = ['TOWN', 'CITY', 'ROUTE', 'UNDERWATER', 'OCEAN_ROUTE', 'UNKNOWN', 'INDOOR', 'SECRET_BASE'].map((t) => K[`MAP_TYPE_${t}`]);
    const underground = K.MAP_TYPE_UNDERGROUND;
    sTransitionTypesTable = [
      ...others.map((fromType) => ({ fromType, toType: underground, isEnter: true, isExit: false, func1: FlashTransition_Enter })),
      ...others.map((toType) => ({ fromType: underground, toType, isEnter: false, isExit: true, func1: FlashTransition_Exit })),
    ];
  }
  return sTransitionTypesTable;
}

function findTransitionType(fromType: number, toType: number): FlashStruct | undefined {
  return sTransitionTypes().find((t) => t.fromType === fromType && t.toType === toType);
}

/** MapTransitionIsEnter */
export function MapTransitionIsEnter(fromType: number, toType: number): boolean {
  return findTransitionType(fromType, toType)?.isEnter ?? false;
}

/** MapTransitionIsExit */
export function MapTransitionIsExit(fromType: number, toType: number): boolean {
  return findTransitionType(fromType, toType)?.isExit ?? false;
}

// map_preview_screen.c
const MPS_TYPE_CAVE = 0;
const MPS_TYPE_FOREST = 1;
const MPS_TYPE_ANY = 2;

/** sMapPreviewScreenData: mapsec -> MPS_TYPE_* */
const sMapPreviewScreenData: Record<string, number> = {
  MAPSEC_VIRIDIAN_FOREST: MPS_TYPE_FOREST,
  MAPSEC_MT_MOON: MPS_TYPE_CAVE,
  MAPSEC_DIGLETTS_CAVE: MPS_TYPE_CAVE,
  MAPSEC_ROCK_TUNNEL: MPS_TYPE_CAVE,
  MAPSEC_POKEMON_TOWER: MPS_TYPE_CAVE,
  MAPSEC_KANTO_SAFARI_ZONE: MPS_TYPE_FOREST,
  MAPSEC_SEAFOAM_ISLANDS: MPS_TYPE_CAVE,
  MAPSEC_POKEMON_MANSION: MPS_TYPE_FOREST,
  MAPSEC_ROCKET_HIDEOUT: MPS_TYPE_FOREST,
  MAPSEC_SILPH_CO: MPS_TYPE_CAVE,
  MAPSEC_KANTO_VICTORY_ROAD: MPS_TYPE_CAVE,
  MAPSEC_CERULEAN_CAVE: MPS_TYPE_CAVE,
  MAPSEC_POWER_PLANT: MPS_TYPE_FOREST,
  MAPSEC_MT_EMBER: MPS_TYPE_CAVE,
  MAPSEC_ROCKET_WAREHOUSE: MPS_TYPE_FOREST,
  MAPSEC_MONEAN_CHAMBER: MPS_TYPE_CAVE,
  MAPSEC_DOTTED_HOLE: MPS_TYPE_CAVE,
  MAPSEC_BERRY_FOREST: MPS_TYPE_FOREST,
  MAPSEC_ICEFALL_CAVE: MPS_TYPE_CAVE,
  MAPSEC_LOST_CAVE: MPS_TYPE_CAVE,
  MAPSEC_ALTERING_CAVE: MPS_TYPE_CAVE,
  MAPSEC_PATTERN_BUSH: MPS_TYPE_FOREST,
  MAPSEC_LIPTOO_CHAMBER: MPS_TYPE_CAVE,
  MAPSEC_WEEPTH_CHAMBER: MPS_TYPE_CAVE,
  MAPSEC_DILFORD_CHAMBER: MPS_TYPE_CAVE,
  MAPSEC_SCUFIB_CHAMBER: MPS_TYPE_CAVE,
  MAPSEC_RIXY_CHAMBER: MPS_TYPE_CAVE,
  MAPSEC_VIAPOIS_CHAMBER: MPS_TYPE_CAVE,
};

/** MapHasPreviewScreen */
export function MapHasPreviewScreen(mapsec: string, type: number): boolean {
  const previewType = sMapPreviewScreenData[mapsec];
  if (previewType === undefined) return false;
  return type === MPS_TYPE_ANY || previewType === type;
}

/** MapHasPreviewScreen(mapsec, MPS_TYPE_FOREST), for the map load's MapPreview_StartForestTransition */
export function MapHasForestPreviewScreen(mapsec: string): boolean {
  return MapHasPreviewScreen(mapsec, MPS_TYPE_FOREST);
}

/** MapHasPreviewScreen(mapsec, MPS_TYPE_CAVE), for WarpFadeOutScreen */
export function MapHasCavePreviewScreen(mapsec: string): boolean {
  return MapHasPreviewScreen(mapsec, MPS_TYPE_CAVE);
}

/** The warp's ends, as GetLastUsedWarpMapType / GetCurrentMapType and their region map sections see them. */
export interface MapChange {
  fromType: number;
  toType: number;
  fromMapsec: string;
  toMapsec: string;
}

/** SetMainCallback2(gMain.savedCallback) has run: the map load goes on. */
let sChangeMapDone = true;

export function IsChangeMapDone(): boolean {
  return sChangeMapDone;
}

/** VBC_ChangeMapVBlank */
function VBC_ChangeMapVBlank(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

/**
 * CB2_DoChangeMap: the GBA host keeps running CB2_ChangeMapMain (RunTasks, AnimateSprites,
 * BuildOamBuffer, UpdatePaletteFade) until IsChangeMapDone. `fadedTo` is the colour the warp's fade
 * left every palette at: the palette buffers still hold the old map's, faded (only PLTT is cleared).
 */
export function CB2_DoChangeMap(change: MapChange, fadedTo: number): void {
  gPlttBufferUnfaded.fill(fadedTo);
  gPlttBufferFaded.fill(fadedTo);
  pltt[0] = fadedTo;
  SetVBlankCallback(null);
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  SetGpuReg(REG_OFFSET_BG2CNT, 0);
  SetGpuReg(REG_OFFSET_BG1CNT, 0);
  SetGpuReg(REG_OFFSET_BG0CNT, 0);
  SetGpuReg(REG_OFFSET_BG2HOFS, 0);
  SetGpuReg(REG_OFFSET_BG2VOFS, 0);
  SetGpuReg(REG_OFFSET_BG1HOFS, 0);
  SetGpuReg(REG_OFFSET_BG1VOFS, 0);
  SetGpuReg(REG_OFFSET_BG0HOFS, 0);
  SetGpuReg(REG_OFFSET_BG0VOFS, 0);
  vram.fill(0);
  ResetOamRange(0, 128);
  pltt.fill(0, 1);
  ResetPaletteFade();
  ResetTasks();
  ResetSpriteData();
  SetVBlankCallback(VBC_ChangeMapVBlank);
  sChangeMapDone = !TryDoMapTransition(change);
}

/** TryDoMapTransition (RunMapPreviewScreen isn't ported, so a map with a cave preview gets none) */
function TryDoMapTransition(change: MapChange): boolean {
  if (change.fromMapsec !== change.toMapsec && MapHasPreviewScreen(change.toMapsec, MPS_TYPE_CAVE)) return false;
  const t = findTransitionType(change.fromType, change.toType);
  if (!t) return false;
  t.func1();
  return true;
}

function caveTransitionGfx(): void {
  vram.set(gfx('sCaveTransitionTiles'), BG_CHAR_ADDR(3));
  vram.set(gfx('sCaveTransitionTilemap'), BG_SCREEN_ADDR(31));
}

/** Graphics the flash transitions load (to preload before the warp). */
export const mapTransitionGfxSymbols = ['sCaveTransitionTiles', 'sCaveTransitionTilemap', 'sCaveTransitionPalette', 'sCaveTransitionPalette_White', 'sCaveTransitionPalette_Black'];

const BG0CNT = /* BGCNT_PRIORITY(0) | BGCNT_CHARBASE(3) | BGCNT_SCREENBASE(31) */ (3 << 2) | (31 << 8);
const BLEND_BG0_OVER_ALL = BLDCNT_TGT1_BG0 | BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_BG1 | BLDCNT_TGT2_BG2 | BLDCNT_TGT2_BG3 | BLDCNT_TGT2_OBJ | BLDCNT_TGT2_BD;

/** SetMainCallback2(gMain.savedCallback) */
function finishChangeMap(): void {
  sChangeMapDone = true;
}

function FlashTransition_Exit(): void {
  CreateTask(Task_FlashTransition_Exit_0, 0);
}

function Task_FlashTransition_Exit_0(taskId: number): void {
  gTasks[taskId].func = Task_FlashTransition_Exit_1;
}

function Task_FlashTransition_Exit_1(taskId: number): void {
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  caveTransitionGfx();
  const pal = gfx16('sCaveTransitionPalette');
  LoadPalette(gfx16('sCaveTransitionPalette_White'), BG_PLTT_ID(14), 0x20);
  LoadPalette(pal.subarray(8), BG_PLTT_ID(14), 8 * 2);
  SetGpuReg(REG_OFFSET_BLDCNT, BLEND_BG0_OVER_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  SetGpuReg(REG_OFFSET_BLDY, 0);
  SetGpuReg(REG_OFFSET_BG0CNT, BG0CNT);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG0_ON | DISPCNT_OBJ_ON);
  gTasks[taskId].func = Task_FlashTransition_Exit_2;
  gTasks[taskId].data[0] = 16;
  gTasks[taskId].data[1] = 0;
}

function Task_FlashTransition_Exit_2(taskId: number): void {
  const r4 = gTasks[taskId].data[1] & 0xffff;
  SetGpuReg(REG_OFFSET_BLDALPHA, (16 << 8) + r4);
  if (r4 <= 16) {
    gTasks[taskId].data[1]++;
  } else {
    gTasks[taskId].data[2] = 0;
    gTasks[taskId].func = Task_FlashTransition_Exit_3;
  }
}

function Task_FlashTransition_Exit_3(taskId: number): void {
  SetGpuReg(REG_OFFSET_BLDALPHA, (16 << 8) + 16);
  const count = gTasks[taskId].data[2] & 0xffff;
  if (count < 8) {
    gTasks[taskId].data[2]++;
    LoadPalette(gfx16('sCaveTransitionPalette').subarray(count + 8), BG_PLTT_ID(14), 8 * 2 - count * 2);
  } else {
    LoadPalette(gfx16('sCaveTransitionPalette_White'), BG_PLTT_ID(0), 0x20);
    gTasks[taskId].func = Task_FlashTransition_Exit_4;
    gTasks[taskId].data[2] = 8;
  }
}

function Task_FlashTransition_Exit_4(taskId: number): void {
  if (gTasks[taskId].data[2] !== 0) gTasks[taskId].data[2]--;
  else finishChangeMap();
}

function FlashTransition_Enter(): void {
  CreateTask(Task_FlashTransition_Enter_0, 0);
}

function Task_FlashTransition_Enter_0(taskId: number): void {
  gTasks[taskId].func = Task_FlashTransition_Enter_1;
}

function Task_FlashTransition_Enter_1(taskId: number): void {
  SetGpuReg(REG_OFFSET_DISPCNT, 0);
  caveTransitionGfx();
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
  SetGpuReg(REG_OFFSET_BLDY, 0);
  SetGpuReg(REG_OFFSET_BG0CNT, BG0CNT);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG0_ON | DISPCNT_OBJ_ON);
  LoadPalette(gfx16('sCaveTransitionPalette_White'), BG_PLTT_ID(14), 0x20);
  LoadPalette(gfx16('sCaveTransitionPalette_Black'), BG_PLTT_ID(0), 0x20);
  gTasks[taskId].func = Task_FlashTransition_Enter_2;
  gTasks[taskId].data[0] = 16;
  gTasks[taskId].data[1] = 0;
  gTasks[taskId].data[2] = 0;
}

function Task_FlashTransition_Enter_2(taskId: number): void {
  const count = gTasks[taskId].data[2] & 0xffff;
  if (count < 16) {
    gTasks[taskId].data[2]++;
    gTasks[taskId].data[2]++;
    LoadPalette(gfx16('sCaveTransitionPalette').subarray(15 - count), BG_PLTT_ID(14), (count + 1) * 2);
  } else {
    SetGpuReg(REG_OFFSET_BLDALPHA, (16 << 8) + 16);
    SetGpuReg(REG_OFFSET_BLDCNT, BLEND_BG0_OVER_ALL);
    gTasks[taskId].func = Task_FlashTransition_Enter_3;
  }
}

function Task_FlashTransition_Enter_3(taskId: number): void {
  const r4 = (16 - gTasks[taskId].data[1]) & 0xffff;
  SetGpuReg(REG_OFFSET_BLDALPHA, (16 << 8) + r4);
  if (r4 !== 0) {
    gTasks[taskId].data[1]++;
  } else {
    LoadPalette(gfx16('sCaveTransitionPalette_Black'), BG_PLTT_ID(0), 0x20);
    finishChangeMap();
  }
}
