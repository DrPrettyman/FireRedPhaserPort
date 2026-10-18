// seagallop.c: the Seagallop ferry scene (DoSeagallopFerryScene) on the GBA layer, its warp to the harbor
// (sSeag, FieldCB_DefaultWarpExit), and the small helpers its scripts call: GetSeagallopNumber,
// IsPlayerLeftOfVermilionSailor. BG3 is the scrolling water (graphics/seagallop, through the extractor; the WB or
// EB tilemap by the direction of travel), the ferry and its wake are sprites, WIN0 letterboxes the scene to lines
// 24-136. After 140 frames the screen fades out (WarpFadeOutScreen) and Task_Seagallop_3 warps to the destination
// in VAR_0x8006. The script specials are in script/ferrySpecials.ts.

import { state } from '../battle/env';
import { ChangeBgX, ChangeBgY, CopyBgTilemapBufferToVram, CopyToBgTilemapBufferRect, GetBgX, InitBgsFromTemplates, IsDma3ManagerBusyWithBgCopy, LoadBgTiles, ResetBgsAndClearDma3BusyFlags, SetBgTilemapBuffer, ShowBg, type BgTemplate } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import {
  DISPCNT_BG0_ON,
  DISPCNT_BG3_ON,
  DISPCNT_MODE_0,
  DISPCNT_OBJ_1D_MAP,
  DISPCNT_OBJ_ON,
  DISPCNT_WIN0_ON,
  PALETTES_ALL,
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
  REG_OFFSET_BG3CNT,
  REG_OFFSET_BG3HOFS,
  REG_OFFSET_BG3VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  SetGpuReg,
  SetGpuRegBits,
  vram,
} from '../gba/hw';
import { gMain, SetMainCallback2, SetVBlankCallback } from '../gba/main';
import { GetTextWindowPalette } from '../gba/menu';
import { BeginNormalPaletteFade, BG_PLTT_ID, BlendPalettes, gPaletteFade, LoadPalette, PLTT_SIZE_4BPP, ResetPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { ScanlineEffect_Stop } from '../gba/scanline';
import { PlaySE } from '../gba/sound';
import {
  AnimateSprites,
  ANIMCMD_END,
  ANIMCMD_FRAME,
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
  MAX_SPRITES,
  oam,
  ProcessSpriteCopyRequests,
  ResetSpriteData,
  StartSpriteAnim,
  type AnimCmd,
  type Sprite,
  type SpriteTemplate,
} from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks, type TaskFunc } from '../gba/task';
import { FreeAllWindowBuffers } from '../gba/window';
import type { WarpData } from '../state/GameState';
import { fieldReturn, gFieldCallback } from './fieldCallbacks';
import { ResetAllPicSprites } from './picSprites';
import { BGMusicStopped } from '../gba/sound'; // Task_Seagallop_2's wait (W-sound 3)
import { Overworld_FadeOutMapMusic } from '../gba/overworldMusic';

const TILESTAG_FERRY = 3000;
const TILESTAG_WAKE = 4000;
const PALTAG_FERRY_WAKE = 3000;

const SE_SHIP = 0; // (no audio)
const SE_EXIT = 0;

/** The graphics the scene draws (runScreenFromScript preloads them). */
export const SEAGALLOP_GFX = ['sWaterTiles', 'sWaterPal', 'sWaterTilemap_WB', 'sWaterTilemap_EB', 'sFerrySpriteTiles', 'sFerryAndWakePal', 'sWakeSpriteTiles'];

// include/constants/seagallop.h
export const SEAGALLOP_VERMILION_CITY = 0;
export const SEAGALLOP_ONE_ISLAND = 1;
export const SEAGALLOP_TWO_ISLAND = 2;
export const SEAGALLOP_THREE_ISLAND = 3;
export const SEAGALLOP_FOUR_ISLAND = 4;
export const SEAGALLOP_FIVE_ISLAND = 5;
export const SEAGALLOP_SIX_ISLAND = 6;
export const SEAGALLOP_SEVEN_ISLAND = 7;
export const SEAGALLOP_CINNABAR_ISLAND = 8;
export const SEAGALLOP_NAVEL_ROCK = 9;
export const SEAGALLOP_BIRTH_ISLAND = 10;

/** sBg3TilemapBuffer */
let sBg3TilemapBuffer: Uint16Array | null = null;

const sBGTemplates: BgTemplate[] = [{ bg: 3, charBaseIndex: 3, mapBaseIndex: 30, screenSize: 0, paletteMode: 0, priority: 3, baseTile: 0x000 }];

/** sSeag: each SEAGALLOP_* port's arrival (map, map-local x, y). */
const sSeag: [string, number, number][] = [
  ['MAP_VERMILION_CITY', 0x17, 0x20],
  ['MAP_ONE_ISLAND_HARBOR', 0x08, 0x05],
  ['MAP_TWO_ISLAND_HARBOR', 0x08, 0x05],
  ['MAP_THREE_ISLAND_HARBOR', 0x08, 0x05],
  ['MAP_FOUR_ISLAND_HARBOR', 0x08, 0x05],
  ['MAP_FIVE_ISLAND_HARBOR', 0x08, 0x05],
  ['MAP_SIX_ISLAND_HARBOR', 0x08, 0x05],
  ['MAP_SEVEN_ISLAND_HARBOR', 0x08, 0x05],
  ['MAP_CINNABAR_ISLAND', 0x15, 0x07],
  ['MAP_NAVEL_ROCK_HARBOR', 0x08, 0x05],
  ['MAP_BIRTH_ISLAND_HARBOR', 0x08, 0x05],
];

const DIRN_WESTBOUND = 0;
const DIRN_EASTBOUND = 1;

/**
 * sTravelDirectionMatrix: bit `dest` of row `origin` is set when that trip is eastbound (the ferry faces right and
 * the water scrolls the other way).
 */
const sTravelDirectionMatrix = [
  0x6fe, // SEAGALLOP_VERMILION_CITY  11011111110
  0x6fc, // SEAGALLOP_ONE_ISLAND      11011111100
  0x6f8, // SEAGALLOP_TWO_ISLAND      11011111000
  0x6f0, // SEAGALLOP_THREE_ISLAND    11011110000
  0x6e0, // SEAGALLOP_FOUR_ISLAND     11011100000
  0x4c0, // SEAGALLOP_FIVE_ISLAND     10011000000
  0x400, // SEAGALLOP_SIX_ISLAND      10000000000
  0x440, // SEAGALLOP_SEVEN_ISLAND    10001000000
  0x7ff, // SEAGALLOP_CINNABAR_ISLAND 11111111111
  0x6e0, // SEAGALLOP_NAVEL_ROCK      11011100000
  0x000, // SEAGALLOP_BIRTH_ISLAND    00000000000
];

const sSpriteAnimTable_Ferry: AnimCmd[][] = [
  [ANIMCMD_FRAME(0, 10), ANIMCMD_END], // sSpriteAnims_Ferry_WB
  [ANIMCMD_FRAME(0, 10, true), ANIMCMD_END], // sSpriteAnims_Ferry_EB
];

const sFerrySpriteTemplate: SpriteTemplate = {
  tileTag: TILESTAG_FERRY,
  paletteTag: PALTAG_FERRY_WAKE,
  oam: oam({ size: 3 }), // 64x64; the sheet is 64x40, the rest reads cleared VRAM
  anims: sSpriteAnimTable_Ferry,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCB_Ferry,
};

const sSpriteAnimTable_Wake: AnimCmd[][] = [
  [ANIMCMD_FRAME(0x00, 0x14), ANIMCMD_FRAME(0x10, 0x14), ANIMCMD_FRAME(0x20, 0x0f), ANIMCMD_END], // sSpriteAnims_Wake_WB
  [ANIMCMD_FRAME(0x00, 0x14, true), ANIMCMD_FRAME(0x10, 0x14, true), ANIMCMD_FRAME(0x20, 0x0f, true), ANIMCMD_END], // sSpriteAnims_Wake_EB
];

const sWakeSpriteTemplate: SpriteTemplate = {
  tileTag: TILESTAG_WAKE,
  paletteTag: PALTAG_FERRY_WAKE,
  oam: oam({ size: 2 }), // 32x32
  anims: sSpriteAnimTable_Wake,
  images: null,
  affineAnims: gDummySpriteAffineAnimTable,
  callback: SpriteCB_Wake,
};

/**
 * DoSeagallopFerryScene (the screen half): SetMainCallback2(CB2_SetUpSeagallopScene). The field (its VBlank
 * callback) is already gone and the help system has no port; gMain.state is 0, as the field leaves it.
 */
export function DoSeagallopFerryScene(): void {
  SetVBlankCallback(null);
  // HelpSystem_Disable: no help system
  gMain.state = 0;
  SetMainCallback2(CB2_SetUpSeagallopScene);
}

function CB2_SetUpSeagallopScene(): void {
  switch (gMain.state) {
    case 0:
      SetVBlankCallback(null); // redundant since the setup routine already did this
      ResetGPU();
      gMain.state++;
      break;
    case 1:
      ResetAllAssets();
      gMain.state++;
      break;
    case 2:
      sBg3TilemapBuffer = new Uint16Array(0x400); // AllocZeroed(0x800)
      ResetBgsAndClearDma3BusyFlags(false);
      InitBgsFromTemplates(0, sBGTemplates, sBGTemplates.length);
      SetBgTilemapBuffer(3, sBg3TilemapBuffer);
      ResetBGPos();
      gMain.state++;
      break;
    case 3: {
      const tiles = gfx('sWaterTiles');
      LoadBgTiles(3, tiles, tiles.length, 0);
      if (GetDirectionOfTravel() === DIRN_EASTBOUND) CopyToBgTilemapBufferRect(3, gfx16('sWaterTilemap_EB'), 0, 0, 32, 32);
      else CopyToBgTilemapBufferRect(3, gfx16('sWaterTilemap_WB'), 0, 0, 32, 32);
      const pal = gfx16('sWaterPal');
      LoadPalette(pal, BG_PLTT_ID(4), pal.length * 2);
      LoadPalette(GetTextWindowPalette(2), BG_PLTT_ID(15), PLTT_SIZE_4BPP);
      gMain.state++;
      break;
    }
    case 4:
      // (the C compares against DIRN_EASTBOUND, i.e. TRUE)
      if (IsDma3ManagerBusyWithBgCopy() !== true) {
        ShowBg(0);
        ShowBg(3);
        CopyBgTilemapBufferToVram(3);
        gMain.state++;
      }
      break;
    case 5:
      LoadFerrySpriteResources();
      BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
      gMain.state++;
      break;
    case 6:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 16, 0, RGB_BLACK);
      gMain.state++;
      break;
    case 7:
      SetDispcnt();
      SetVBlankCallback(VBlankCB_SeaGallop);
      PlaySE(SE_SHIP);
      CreateFerrySprite();
      SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
      SetGpuReg(REG_OFFSET_WININ, 0x3f);
      SetGpuReg(REG_OFFSET_WINOUT, 0x00);
      SetGpuReg(REG_OFFSET_WIN0H, 0x00f0);
      SetGpuReg(REG_OFFSET_WIN0V, 0x1888); // lines 24-136
      CreateTask(Task_Seagallop_0, 8);
      SetMainCallback2(MainCB2_SeaGallop);
      gMain.state = 0;
      break;
  }
}

function VBlankCB_SeaGallop(): void {
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
  TransferPlttBuffer();
}

function MainCB2_SeaGallop(): void {
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

const Task_Seagallop_0: TaskFunc = (taskId) => {
  gTasks[taskId].func = Task_Seagallop_1;
};

/** ScrollBG: 6 px a frame, the other way when eastbound. */
function ScrollBG(): void {
  if (GetDirectionOfTravel() === DIRN_EASTBOUND) ChangeBgX(3, 0x600, 1);
  else ChangeBgX(3, 0x600, 2);
}

const Task_Seagallop_1: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  ScrollBG();
  if (++task.data[1] === 140) {
    Overworld_FadeOutMapMusic();
    WarpFadeOutScreen();
    task.func = Task_Seagallop_2;
  }
};

const Task_Seagallop_2: TaskFunc = (taskId) => {
  ScrollBG();
  if (BGMusicStopped() && !gPaletteFade.active) {
    Task_Seagallop_3();
    // HelpSystem_Enable: no help system
    DestroyTask(taskId);
  }
};

/**
 * WarpFadeOutScreen (overworld.c) from this screen: FadeScreen(FADE_TO_BLACK, 0), a palette fade to black. (The
 * fade to white is only for a warp into or out of an underwater map, and no Seagallop port is one.)
 */
function WarpFadeOutScreen(): void {
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
}

/** The warp Task_Seagallop_3 set up (SetWarpDestination); CB2_LoadMap takes it. */
let sWarpDestination: WarpData | null = null;

function Task_Seagallop_3(): void {
  let dest = state.getVar('VAR_0x8006');
  if (dest >= sSeag.length) {
    dest = 0;
    state.setVar('VAR_0x8006', 0);
  }
  const [mapId, x, y] = sSeag[dest];
  sWarpDestination = { mapId, warpId: -1, x, y }; // SetWarpDestination(group, num, -1, x, y)
  // PlayRainStoppingSoundEffect: no audio
  PlaySE(SE_EXIT);
  // gFieldCallback = FieldCB_DefaultWarpExit: the field's arrival from a screen's warp (fade in, or the door's walk out)
  gFieldCallback.fn = undefined;
  // WarpIntoMap + SetMainCallback2(CB2_LoadMap); ResetInitialPlayerAvatarState is the field's warp from a screen
  SetMainCallback2(CB2_LoadMap);
  FreeFerrySpriteResources();
  sBg3TilemapBuffer = null; // Free(sBg3TilemapBuffer)
  FreeAllWindowBuffers();
}

/** Set once the scene hands over to CB2_LoadMap (the script that started it is still stopped until then). */
let sWarpStarted = false;

/**
 * For DoSeagallopFerryScene's `waitstate`: a wait that ends once this ride's scene has warped (CB2_LoadMap, whose
 * ScriptContext_Init ends the script; until then the script stays stopped, so the field takes no input). Call it
 * when the special runs, before the screen starts: the flag still holds the last ride's warp until then.
 */
export function SeagallopWarpWait(): () => boolean {
  sWarpStarted = false;
  return () => sWarpStarted;
}

/** CB2_LoadMap from this screen: the field loads the map Task_Seagallop_3 chose. */
function CB2_LoadMap(): void {
  const warp = sWarpDestination!;
  sWarpDestination = null;
  SetMainCallback2(null);
  sWarpStarted = true;
  fieldReturn.warp(warp);
}

function ResetGPU(): void {
  vram.fill(0); // DmaClearLarge16(VRAM)
  // DmaClear32(OAM): the PPU reads the OAM buffer, which ResetSpriteData clears
  pltt.fill(0); // DmaClear16(PLTT)
  for (const reg of [
    REG_OFFSET_DISPCNT,
    REG_OFFSET_BG0CNT,
    REG_OFFSET_BG0HOFS,
    REG_OFFSET_BG0VOFS,
    REG_OFFSET_BG1CNT,
    REG_OFFSET_BG1HOFS,
    REG_OFFSET_BG1VOFS,
    REG_OFFSET_BG2CNT,
    REG_OFFSET_BG2HOFS,
    REG_OFFSET_BG2VOFS,
    REG_OFFSET_BG3CNT,
    REG_OFFSET_BG3HOFS,
    REG_OFFSET_BG3VOFS,
    REG_OFFSET_WIN0H,
    REG_OFFSET_WIN0V,
    REG_OFFSET_WININ,
    REG_OFFSET_WINOUT,
    REG_OFFSET_BLDCNT,
    REG_OFFSET_BLDALPHA,
    REG_OFFSET_BLDY,
  ]) {
    SetGpuReg(reg, 0);
  }
}

function ResetAllAssets(): void {
  ScanlineEffect_Stop();
  ResetTasks();
  ResetSpriteData();
  ResetAllPicSprites();
  ResetPaletteFade();
  FreeAllSpritePalettes();
}

function SetDispcnt(): void {
  SetGpuReg(REG_OFFSET_DISPCNT, DISPCNT_MODE_0 | DISPCNT_OBJ_1D_MAP | DISPCNT_BG0_ON | DISPCNT_BG3_ON | DISPCNT_OBJ_ON);
}

function ResetBGPos(): void {
  for (let bg = 0; bg < 4; bg++) {
    ChangeBgX(bg, 0, 0);
    ChangeBgY(bg, 0, 0);
  }
}

/** LoadSpriteSheets(sFerryAndWakeSpriteSheets) + LoadSpritePalettes(sFerryAndWakeSpritePalettes) */
function LoadFerrySpriteResources(): void {
  const wake = gfx('sWakeSpriteTiles');
  const ferry = gfx('sFerrySpriteTiles');
  LoadSpriteSheet({ data: wake, size: wake.length, tag: TILESTAG_WAKE });
  LoadSpriteSheet({ data: ferry, size: ferry.length, tag: TILESTAG_FERRY });
  LoadSpritePalette({ data: gfx16('sFerryAndWakePal'), tag: PALTAG_FERRY_WAKE });
}

function FreeFerrySpriteResources(): void {
  FreeSpriteTilesByTag(TILESTAG_FERRY);
  FreeSpriteTilesByTag(TILESTAG_WAKE);
  FreeSpritePaletteByTag(PALTAG_FERRY_WAKE);
}

function CreateFerrySprite(): void {
  const spriteId = CreateSprite(sFerrySpriteTemplate, 0, 92, 0);
  gSprites[spriteId].data[0] = 48;
  if (GetDirectionOfTravel() === DIRN_EASTBOUND) {
    StartSpriteAnim(gSprites[spriteId], 1);
  } else {
    gSprites[spriteId].x = 240;
    gSprites[spriteId].data[0] *= -1;
  }
}

/** 3 px a frame (data[1] in 1/16 px), a wake every 5 frames; gone once 300 px off its start. */
function SpriteCB_Ferry(sprite: Sprite): void {
  sprite.data[1] += sprite.data[0];
  sprite.x2 = sprite.data[1] >> 4;
  if (sprite.data[2] % 5 === 0) CreateWakeSprite(sprite.x + sprite.x2);
  sprite.data[2]++;
  if (((300 + sprite.x2) & 0xffff) > 600) DestroySprite(sprite);
}

function CreateWakeSprite(x: number): void {
  const spriteId = CreateSprite(sWakeSpriteTemplate, (x << 16) >> 16, 92, 8);
  if (spriteId !== MAX_SPRITES) {
    if (GetDirectionOfTravel() === DIRN_EASTBOUND) StartSpriteAnim(gSprites[spriteId], 1);
  }
}

function SpriteCB_Wake(sprite: Sprite): void {
  if (sprite.animEnded) DestroySprite(sprite);
}

/** GetDirectionOfTravel: from VAR_0x8004 (origin) to VAR_0x8006 (destination). */
function GetDirectionOfTravel(): number {
  return TravelDirection(state.getVar('VAR_0x8004'), state.getVar('VAR_0x8006'));
}

/** GetDirectionOfTravel's lookup: DIRN_EASTBOUND (1) or DIRN_WESTBOUND (0). An unknown origin is eastbound. */
export function TravelDirection(origin: number, dest: number): number {
  if (origin >= sTravelDirectionMatrix.length) return DIRN_EASTBOUND;
  // (a u16 shifted by up to 0xffff in C: anything past bit 15 is 0)
  return dest >= 16 ? DIRN_WESTBOUND : (sTravelDirectionMatrix[origin] >> dest) & 1;
}

/** GetSeagallopNumber: the "SEAGALLOP HI-SPEED ##" of a trip from `originId` to `destId`. */
export function GetSeagallopNumber(originId: number, destId: number): number {
  const either = (...ids: number[]) => ids.includes(originId) || ids.includes(destId);
  const both = (...ids: number[]) => ids.includes(originId) && ids.includes(destId);
  if (either(SEAGALLOP_CINNABAR_ISLAND)) return 1;
  if (either(SEAGALLOP_VERMILION_CITY)) return 7;
  if (either(SEAGALLOP_NAVEL_ROCK)) return 10;
  if (either(SEAGALLOP_BIRTH_ISLAND)) return 12;
  if (both(SEAGALLOP_ONE_ISLAND, SEAGALLOP_TWO_ISLAND, SEAGALLOP_THREE_ISLAND)) return 2;
  if (both(SEAGALLOP_FOUR_ISLAND, SEAGALLOP_FIVE_ISLAND)) return 3;
  if (both(SEAGALLOP_SIX_ISLAND, SEAGALLOP_SEVEN_ISLAND)) return 5;
  return 6;
}

/** IsPlayerLeftOfVermilionSailor: in Vermilion City, left of the ferry sailor's column (map-local x < 24). */
export function IsPlayerLeftOfVermilionSailor(mapId: string, x: number): boolean {
  return mapId === 'MAP_VERMILION_CITY' && x < 24;
}

/** Dev: the scene for the e2e tests (undefined when it isn't up). */
export function seagallopProbe():
  | { setupState: number; running: boolean; frames: number; bg3X: number; eastbound: boolean; ferry?: { x: number; x2: number; hFlip: boolean }; wakes: number }
  | undefined {
  const cb = gMain.callback2;
  if (cb !== CB2_SetUpSeagallopScene && cb !== MainCB2_SeaGallop) return undefined;
  const task = gTasks.find((t) => t.isActive && (t.func === Task_Seagallop_1 || t.func === Task_Seagallop_2));
  const ferry = gSprites.find((s) => s.inUse && s.template === sFerrySpriteTemplate);
  return {
    setupState: cb === CB2_SetUpSeagallopScene ? gMain.state : 8,
    running: cb === MainCB2_SeaGallop,
    frames: task?.data[1] ?? 0,
    bg3X: GetBgX(3),
    eastbound: GetDirectionOfTravel() === DIRN_EASTBOUND,
    ferry: ferry && { x: ferry.x, x2: ferry.x2, hFlip: (ferry.oam.matrixNum & 8) !== 0 },
    wakes: gSprites.filter((s) => s.inUse && s.template === sWakeSpriteTemplate).length,
  };
}
