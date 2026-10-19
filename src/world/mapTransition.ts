// What a warp looks like between maps of different types: fldeff_flash.c's sTransitionTypes (the
// white fades in and out of caves, MapTransitionIsEnter / MapTransitionIsExit), CB2_DoChangeMap's
// TryDoMapTransition and its FlashTransition_Enter / FlashTransition_Exit screens, which run on the
// GBA layer between the fade out and the new map, and RunMapPreviewScreen's cave banner before the flash into a
// section with an MPS_TYPE_CAVE preview (world/mapPreviewScreen.ts is map_preview_screen.c).

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
  PALETTES_ALL,
  RGB_BLACK,
  RGB_WHITE,
  SetGpuReg,
  vram,
} from '../gba/hw';
import { IsDma3ManagerBusyWithBgCopy } from '../gba/bg';
import { B_BUTTON, gMain, JOY_HELD, SetVBlankCallback } from '../gba/main';
import {
  BeginNormalPaletteFade,
  BG_PLTT_ID,
  BlendPalettes,
  gPlttBufferFaded,
  gPlttBufferUnfaded,
  LoadPalette,
  ResetPaletteFade,
  TransferPlttBuffer,
  UpdatePaletteFade,
} from '../gba/palette';
import { CopyWindowToVram, COPYWIN_FULL } from '../gba/window';
import { testEvent } from '../dev/testHooks';
import {
  InitFieldBg0AndWindows,
  MapHasPreviewScreen,
  MapHasPreviewScreen_HandleQLState2,
  MapPreview_CreateMapNameWindow,
  MapPreview_GetDuration,
  MapPreview_InitBgs,
  MapPreview_IsGfxLoadFinished,
  MapPreview_LoadGfx,
  MapPreview_Unload,
  MPS_TYPE_CAVE,
  MPS_TYPE_FOREST,
} from './mapPreviewScreen';
import { ProcessSpriteCopyRequests, ResetOamRange, ResetSpriteData } from '../gba/sprite';
import { CreateTask, gTasks, ResetTasks } from '../gba/task';
import { constant, K } from '../battle/constants';

/** struct FlashStruct (func2, RunMapPreviewScreen for every entry, is never called through the table) */
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

/** A region map section's id from its MAPSEC_* name (MAPSEC_NONE if unknown). */
function mapsecId(name: string): number {
  return constant(name) ?? K.MAPSEC_NONE;
}

/** MapHasPreviewScreen(mapsec, MPS_TYPE_FOREST), for the map load's MapPreview_StartForestTransition */
export function MapHasForestPreviewScreen(mapsec: string): boolean {
  return MapHasPreviewScreen_HandleQLState2(mapsecId(mapsec), MPS_TYPE_FOREST);
}

/** MapHasPreviewScreen(mapsec, MPS_TYPE_CAVE), for WarpFadeOutScreen */
export function MapHasCavePreviewScreen(mapsec: string): boolean {
  return MapHasPreviewScreen(mapsecId(mapsec), MPS_TYPE_CAVE);
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
  InitFieldBg0AndWindows(); // what the field left on the GBA side (its BG0 and windows), for RunMapPreviewScreen
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

/** TryDoMapTransition */
function TryDoMapTransition(change: MapChange): boolean {
  if (change.fromMapsec !== change.toMapsec && MapHasPreviewScreen_HandleQLState2(mapsecId(change.toMapsec), MPS_TYPE_CAVE)) {
    RunMapPreviewScreen(mapsecId(change.toMapsec));
    return true;
  }
  const t = findTransitionType(change.fromType, change.toType);
  if (!t) return false;
  t.func1();
  return true;
}

/** RunMapPreviewScreen */
function RunMapPreviewScreen(mapSecId: number): void {
  const taskId = CreateTask(Task_MapPreviewScreen_0, 0);
  gTasks[taskId].data[3] = mapSecId;
}

/** gMain.vblankCallback, saved in the task's data[5..6] (SetWordTaskArg) */
let sSavedVBlankCallback: (() => void) | null = null;

/** The cave banner on the GBA layer: shown from black, `duration` frames (B cuts it short), then a fade to white. */
function Task_MapPreviewScreen_0(taskId: number): void {
  const data = gTasks[taskId].data;
  switch (data[0]) {
    case 0:
      sSavedVBlankCallback = gMain.vblankCallback;
      SetVBlankCallback(null);
      MapPreview_InitBgs();
      MapPreview_LoadGfx(data[3]);
      BlendPalettes(PALETTES_ALL, 0x10, RGB_BLACK);
      data[0]++;
      break;
    case 1:
      if (!MapPreview_IsGfxLoadFinished()) {
        data[4] = MapPreview_CreateMapNameWindow(data[3]);
        CopyWindowToVram(data[4], COPYWIN_FULL);
        data[0]++;
      }
      break;
    case 2:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        BeginNormalPaletteFade(PALETTES_ALL, -1, 16, 0, RGB_BLACK);
        SetVBlankCallback(sSavedVBlankCallback);
        data[0]++;
      }
      break;
    case 3:
      if (!UpdatePaletteFade()) {
        data[2] = MapPreview_GetDuration(data[3]);
        testEvent('mapPreview', { kind: 'cave', mapsec: data[3], duration: data[2] });
        data[0]++;
      }
      break;
    case 4:
      data[1]++;
      if (data[1] > data[2] || JOY_HELD(B_BUTTON)) {
        BeginNormalPaletteFade(PALETTES_ALL, -2, 0, 16, RGB_WHITE);
        data[0]++;
      }
      break;
    case 5:
      if (!UpdatePaletteFade()) {
        for (let i = 0; i < 16; i++) data[i] = 0;
        MapPreview_Unload(data[4]);
        gTasks[taskId].func = Task_FlashTransition_Enter_1;
      }
      break;
  }
}

/** Dev probe: the task CB2_DoChangeMap runs (its function's name), until the map load goes on. */
export function changeMapTaskProbe(): string | undefined {
  if (sChangeMapDone) return undefined;
  return gTasks.find((t) => t.isActive)?.func.name;
}

/** Dev probe: the cave banner's task while it runs (its state, frames shown, duration). */
export function mapPreviewCaveProbe(): { mapsec: number; state: number; timer: number; duration: number } | undefined {
  for (const t of gTasks) {
    if (t.isActive && t.func === Task_MapPreviewScreen_0) return { mapsec: t.data[3], state: t.data[0], timer: t.data[1], duration: t.data[2] };
  }
  return undefined;
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
