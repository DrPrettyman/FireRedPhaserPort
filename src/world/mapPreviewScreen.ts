// map_preview_screen.c: the banners that name a dungeon as the player walks in (Mt. Moon, Viridian Forest, the
// Sevii caves...). sMapPreviewScreenData (menus.json `mapPreviewScreens`, tools/extract_menus.py) says which region map
// sections have one and of which kind:
//
// - MPS_TYPE_CAVE: fldeff_flash.c's RunMapPreviewScreen (world/mapTransition.ts) shows it on the GBA layer during
//   CB2_DoChangeMap, between the warp's fade out and the new map, then the cave's flash transition.
// - MPS_TYPE_FOREST: the map load (overworld.c LoadMapInStepsLocal's state 12, OverworldScene.showMapNameOnWarpArrival)
//   loads it into the field's BG0 and starts Task_RunMapPreviewScreenForest, which holds it over the field while the
//   field fades in, then blends it out. The warp's exit task waits for it (FieldFadeTransitionBackgroundEffectIsFinished
//   → ForestMapPreviewScreenIsRunning). The field is drawn by Phaser, so this BG0 is rendered by the software PPU into
//   its own image and blended over the field by the GPU (world/mapPreviewLayer.ts), as world/fogHorizontal.ts does.
//
// Both print the section's name in sMapNameWindow. MapPreview_SetFlag (`setworldmapflag`) and MapPreview_GetDuration
// make the banner shorter on later visits. MapHasPreviewScreen_HandleQLState2 (the caves' check) has none in the quest
// log's playback.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import type { GameState } from '../state/GameState';
import {
  BG_ATTR_PRIORITY,
  CopyBgTilemapBufferToVram,
  CopyToBgTilemapBuffer,
  FillBgTilemapBufferRect_Palette0,
  GetBgTilemapBuffer,
  InitBgsFromTemplates,
  IsDma3ManagerBusyWithBgCopy,
  ResetBgsAndClearDma3BusyFlags,
  SetBgAttribute,
  SetBgTilemapBuffer,
  ShowBg,
  UnsetBgTilemapBuffer,
  type BgTemplate,
} from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import { DISPCNT_BG0_ON, DISPCNT_MODE_0, REG_OFFSET_DISPCNT, resetHardware, SetGpuReg } from '../gba/hw';
import { DecompressAndCopyTileDataToVram, FreeTempTileDataBuffersIfPossible, ResetTempTileDataBuffers } from '../gba/menu';
import { BG_PLTT_ID, LoadPalette, PLTT_SIZE_4BPP } from '../gba/palette';
import {
  AddTextPrinterParameterized4,
  AddWindow,
  CopyWindowToVram,
  COPYWIN_FULL,
  DUMMY_WIN_TEMPLATE,
  FillWindowPixelBuffer,
  GetStringWidth,
  InitWindows,
  PIXEL_FILL,
  PutWindowTilemap,
  RemoveWindow,
  type WindowTemplate,
} from '../gba/window';
import { testEvent } from '../dev/testHooks';
import { menusData } from '../menus/data';
import { GetMapName } from './regionMap';
import { QL_InPlaybackState } from './questLogState';

/** struct MapPreviewScreen (menus.json `mapPreviewScreens`) */
export interface MapPreviewScreen {
  mapsec: number;
  /** MPS_TYPE_* */
  type: number;
  /** FLAG_WORLD_MAP_* */
  flagId: string;
  /** Graphics symbols (decompressed): the 4bpp tiles, the 32x20 tilemap, the palettes */
  tilesptr: string;
  tilemapptr: string;
  palptr: string;
}

// include/map_preview_screen.h
export const MPS_TYPE_CAVE = 0;
export const MPS_TYPE_FOREST = 1;
export const MPS_TYPE_ANY = 2;

/** sMapPreviewScreenData */
function sMapPreviewScreenData(): MapPreviewScreen[] {
  return menusData.mapPreviewScreens;
}

/** EWRAM sHasVisitedMapBefore: set by MapPreview_SetFlag when the flag was clear (so it means "first visit"). */
let sHasVisitedMapBefore = false;
/** EWRAM sAllocedBg0TilemapBuffer */
let sAllocedBg0TilemapBuffer = false;

/** sMapNameWindow */
const sMapNameWindow: WindowTemplate = {
  bg: 0,
  tilemapLeft: 0,
  tilemapTop: 0,
  width: 13,
  height: 2,
  paletteNum: 14,
  baseBlock: 0x1c2,
};

/** sMapPreviewBgTemplate: only .mapBaseIndex = 31, the rest zero */
const sMapPreviewBgTemplate: BgTemplate[] = [
  {
    bg: 0,
    charBaseIndex: 0,
    mapBaseIndex: 31,
    screenSize: 0,
    paletteMode: 0,
    priority: 0,
    baseTile: 0,
  },
];

/** The graphics the screens load (preloaded with the field's, so a warp needn't wait for them). */
export function mapPreviewGfxSymbols(): string[] {
  return sMapPreviewScreenData().flatMap((s) => [s.tilesptr, s.tilemapptr, s.palptr]);
}

/** GetMapPreviewScreenIdx: MPS_COUNT if the section has none */
function GetMapPreviewScreenIdx(mapsec: number): number {
  const data = sMapPreviewScreenData();
  for (let i = 0; i < data.length; i++) if (data[i].mapsec === mapsec) return i;
  return data.length;
}

/** MapHasPreviewScreen */
export function MapHasPreviewScreen(mapsec: number, type: number): boolean {
  const idx = GetMapPreviewScreenIdx(mapsec);
  if (idx === sMapPreviewScreenData().length) return false;
  if (type === MPS_TYPE_ANY) return true;
  return sMapPreviewScreenData()[idx].type === type;
}

/** MapHasPreviewScreen_HandleQLState2: FALSE in the quest log's playback (gQuestLogState == QL_STATE_PLAYBACK). */
export function MapHasPreviewScreen_HandleQLState2(mapsec: number, type: number): boolean {
  if (QL_InPlaybackState()) return false;
  return MapHasPreviewScreen(mapsec, type);
}

/** MapPreview_InitBgs */
export function MapPreview_InitBgs(): void {
  InitBgsFromTemplates(0, sMapPreviewBgTemplate);
  ShowBg(0);
}

/**
 * The preview's three palettes (LoadPalette(palptr, BG_PLTT_ID(13), 3 * PLTT_SIZE_4BPP)). The palette files hold
 * two; the C's third is whatever follows them in the ROM, which no preview tilemap uses (docs/DEVIATIONS.md).
 */
export function mapPreviewPalette(info: MapPreviewScreen): Uint16Array {
  const pal = new Uint16Array(0x30);
  pal.set(gfx16(info.palptr).subarray(0, 0x30));
  return pal;
}

/** MapPreview_LoadGfx */
export function MapPreview_LoadGfx(mapsec: number): void {
  const idx = GetMapPreviewScreenIdx(mapsec);
  if (idx === sMapPreviewScreenData().length) return;
  const info = sMapPreviewScreenData()[idx];
  ResetTempTileDataBuffers();
  LoadPalette(mapPreviewPalette(info), BG_PLTT_ID(13), 3 * PLTT_SIZE_4BPP);
  DecompressAndCopyTileDataToVram(0, gfx(info.tilesptr), 0, 0, 0);
  if (GetBgTilemapBuffer(0) === null) {
    SetBgTilemapBuffer(0, new Uint16Array(0x400)); // Alloc(BG_SCREEN_SIZE)
    sAllocedBg0TilemapBuffer = true;
  } else {
    sAllocedBg0TilemapBuffer = false;
  }
  CopyToBgTilemapBuffer(0, gfx16(info.tilemapptr), 0, 0x000);
  CopyBgTilemapBufferToVram(0);
}

/** MapPreview_Unload */
export function MapPreview_Unload(windowId: number): void {
  RemoveWindow(windowId);
  if (sAllocedBg0TilemapBuffer) UnsetBgTilemapBuffer(0); // Free(GetBgTilemapBuffer(0))
}

/** MapPreview_IsGfxLoadFinished: FALSE once the tile data is in VRAM (named the other way round in the C). */
export function MapPreview_IsGfxLoadFinished(): boolean {
  return FreeTempTileDataBuffersIfPossible();
}

/** MapPreview_CreateMapNameWindow: the section's name centred in white on the window's fill. */
export function MapPreview_CreateMapNameWindow(mapsec: number): number {
  const windowId = AddWindow(sMapNameWindow);
  FillWindowPixelBuffer(windowId, PIXEL_FILL(1));
  PutWindowTilemap(windowId);
  // The C writes these into a zero-length array (u8 color[0]); BUGFIX gives it its three entries.
  const color = [K.TEXT_COLOR_WHITE, K.TEXT_COLOR_RED, K.TEXT_COLOR_LIGHT_GRAY];
  const name = GetMapName(mapsec, 0); // gStringVar4
  const xctr = (104 - GetStringWidth(K.FONT_NORMAL, name, 0)) >>> 0;
  AddTextPrinterParameterized4(windowId, K.FONT_NORMAL, Math.floor(xctr / 2), 2, 0, 0, color, -1, name);
  return windowId;
}

/** GetDungeonMapPreviewScreenInfo (the region map's dungeon previews): NULL if the section has none */
export function GetDungeonMapPreviewScreenInfo(mapsec: number): MapPreviewScreen | null {
  const idx = GetMapPreviewScreenIdx(mapsec);
  return idx === sMapPreviewScreenData().length ? null : sMapPreviewScreenData()[idx];
}

/** MapPreview_GetDuration: frames the banner stays up (120 on the first visit, 40 after). */
export function MapPreview_GetDuration(mapsec: number): number {
  const idx = GetMapPreviewScreenIdx(mapsec);
  if (idx === sMapPreviewScreenData().length) return 0;
  const { flagId, type } = sMapPreviewScreenData()[idx];
  if (type === MPS_TYPE_CAVE) {
    // RunMapPreviewScreen reads it during CB2_DoChangeMap, before the map's ON_TRANSITION script sets the flag
    return !state.getFlag(flagId) ? 120 : 40;
  }
  // The forest's is read after ON_TRANSITION's setworldmapflag, which left sHasVisitedMapBefore
  return sHasVisitedMapBefore ? 120 : 40;
}

/** MapPreview_SetFlag (ScrCmd_setworldmapflag; `flags` is the script engine's GameState) */
export function MapPreview_SetFlag(flagId: string, flags: Pick<GameState, 'getFlag' | 'setFlag'> = state): void {
  sHasVisitedMapBefore = !flags.getFlag(flagId);
  flags.setFlag(flagId, true);
}

// ------------------------------------------------------------------ the forest's banner, over the field

/** BG0 over the field (world/mapPreviewLayer.ts). */
export interface ForestPreviewLayer {
  /** The PPU draws BG0 as VRAM and the palettes now hold it. */
  render(): void;
  /** Blend it over the field with BLDALPHA's coefficients. */
  draw(eva: number, evb: number): void;
  destroy(): void;
}

/** What Task_RunMapPreviewScreenForest needs from the field. */
export interface ForestPreviewHost {
  /** The layer the banner is drawn on, over the field and its windows and under the screen fade. */
  createLayer(): ForestPreviewLayer;
  /** FadeInFromBlack */
  fadeInFromBlack(): void;
  /** IsWeatherNotFadingIn */
  isWeatherNotFadingIn(): boolean;
  /** Overworld_PlaySpecialMapMusic */
  playSpecialMapMusic(): void;
  /** LockPlayerFieldControls (the warp's exit task unlocks them once ForestMapPreviewScreenIsRunning) */
  lockPlayerFieldControls(): void;
  /** CreateTask(func, 0): `tick` runs once a frame until it returns true */
  createTask(tick: () => boolean): void;
}

/** Task_RunMapPreviewScreenForest's data[] (the GPU registers it saves aren't the Phaser field's: see the header). */
interface ForestTask {
  mapsec: number;
  state: number; // data[0]
  timer: number; // data[1]
  eva: number; // data[8]
  evb: number; // data[9]
  duration: number; // data[10]
  windowId: number; // data[11]
  layer: ForestPreviewLayer;
  done: boolean;
}

let sForestTask: ForestTask | undefined;

/** sOverworldBgTemplates[0]: the field's BG0 (its windows) */
const sOverworldBg0Template: BgTemplate = {
  bg: 0,
  charBaseIndex: 2,
  mapBaseIndex: 31,
  screenSize: 0,
  paletteMode: 0,
  priority: 0,
  baseTile: 0,
};

/** sStandardTextBox_WindowTemplates (new_menu_helpers.c) */
const sStandardTextBox_WindowTemplates: WindowTemplate[] = [
  {
    bg: 0,
    tilemapLeft: 2,
    tilemapTop: 15,
    width: 26,
    height: 4,
    paletteNum: 15,
    baseBlock: 0x198,
  },
  DUMMY_WIN_TEMPLATE,
];

/**
 * The field's BG0 and windows on the GBA side, as InitOverworldBgs (ResetBgsAndClearDma3BusyFlags(FALSE),
 * sOverworldBgTemplates) and InitStandardTextBoxWindows leave them; the field's own windows are Phaser's, and another
 * GBA screen may have left these otherwise. What the previews rely on: window tiles at their templates' base blocks,
 * free window slots, and BG0's window tilemap buffer in place, so AddWindow keeps the tilemap the preview is in.
 */
export function InitFieldBg0AndWindows(): void {
  ResetBgsAndClearDma3BusyFlags(false);
  InitBgsFromTemplates(0, [sOverworldBg0Template]);
  InitWindows(sStandardTextBox_WindowTemplates);
}

/** The field's BG0 on the GBA hardware, alone, for MapPreview_LoadGfx to load the forest's banner into. */
export function MapPreview_InitFieldBg0(): void {
  resetHardware();
  InitFieldBg0AndWindows();
  ShowBg(0);
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_BG0_ON);
}

/** MapPreview_StartForestTransition */
export function MapPreview_StartForestTransition(mapsec: number, host: ForestPreviewHost): void {
  sForestTask?.layer.destroy();
  const task: ForestTask = {
    mapsec,
    state: 0,
    timer: 0,
    duration: MapPreview_GetDuration(mapsec),
    eva: 16,
    evb: 0,
    windowId: 0,
    layer: host.createLayer(),
    done: false,
  };
  sForestTask = task;
  testEvent('mapPreview', { kind: 'forest', mapsec, duration: task.duration });
  SetBgAttribute(0, BG_ATTR_PRIORITY, 0);
  // BLDCNT: BG0 over BG1-3, OBJ and the backdrop; BLDALPHA_BLEND(16, 0): the layer's blend (data[8], data[9])
  task.windowId = MapPreview_CreateMapNameWindow(mapsec);
  host.lockPlayerFieldControls();
  host.createTask(() => {
    Task_RunMapPreviewScreenForest(task, host);
    if (!task.done) task.layer.draw(task.eva, task.evb);
    return task.done;
  });
}

/** ForestMapPreviewScreenIsRunning: TRUE once the forest's task is over (named the other way round in the C). */
export function ForestMapPreviewScreenIsRunning(): boolean {
  return !sForestTask;
}

/** The field went away under a running banner (a new map load): drop it. */
export function MapPreview_AbortForestTransition(): void {
  sForestTask?.layer.destroy();
  sForestTask = undefined;
}

/** Task_RunMapPreviewScreenForest */
function Task_RunMapPreviewScreenForest(task: ForestTask, host: ForestPreviewHost): void {
  switch (task.state) {
    case 0:
      if (!MapPreview_IsGfxLoadFinished() && !IsDma3ManagerBusyWithBgCopy()) {
        CopyWindowToVram(task.windowId, COPYWIN_FULL);
        task.layer.render();
        task.state++;
      }
      break;
    case 1:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        host.fadeInFromBlack();
        task.state++;
      }
      break;
    case 2:
      if (host.isWeatherNotFadingIn()) {
        host.playSpecialMapMusic();
        task.state++;
      }
      break;
    case 3:
      task.timer++;
      if (task.timer > task.duration) {
        task.timer = 0;
        task.state++;
      }
      break;
    case 4:
      switch (task.timer) {
        case 0:
          task.evb = Math.min(task.evb + 1, 16);
          break;
        case 1:
          task.eva = Math.max(task.eva - 1, 0);
          break;
      }
      task.timer = (task.timer + 1) % 3;
      // SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(data[8], data[9])): the layer draws with them
      if (task.eva === 0 && task.evb === 16) {
        FillBgTilemapBufferRect_Palette0(0, 0, 0, 0, 32, 32);
        CopyBgTilemapBufferToVram(0);
        task.state++;
      }
      break;
    case 5:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        MapPreview_Unload(task.windowId);
        // (the saved BG0 priority, DISPCNT, BLDCNT, BLDALPHA, WININ and WINOUT go back: the field's are Phaser's)
        task.layer.destroy();
        task.done = true;
        if (sForestTask === task) sForestTask = undefined;
      }
      break;
  }
}

/** Dev probe: the banner while it's up. */
export function mapPreviewForestProbe():
  | {
      mapsec: number;
      state: number;
      timer: number;
      duration: number;
      eva: number;
      evb: number;
    }
  | undefined {
  const t = sForestTask;
  return (
    t && {
      mapsec: t.mapsec,
      state: t.state,
      timer: t.timer,
      duration: t.duration,
      eva: t.eva,
      evb: t.evb,
    }
  );
}
