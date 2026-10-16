// field_effect.c's FLDEFF_FIELD_MOVE_SHOW_MON(_INIT): the banner with the mon that uses a field move
// (FldEff_FieldMoveShowMonInit, FldEff_FieldMoveShowMon, Task_ShowMon_Outdoors / Task_ShowMon_Indoors and
// the mon sprite's callbacks).
//
// The banner works on the field's own video registers (BG0, WIN0/WIN1, BG0 scroll in a VBlank callback),
// so while it runs the field is put on the GBA layer (world/fieldGbaScreen.ts, as for battle transitions)
// and the C runs as written on top of it: the streaks are copied straight into BG0's VRAM and the mon is
// a GBA pic sprite. Graphics are loaded asynchronously, so `loadShowMonGfx` must have finished first
// (CreateFieldEffectShowMon starts it while the player's pose animation plays).
// Not ported: the cry (no audio).

import { monPalSymbols, monPicSymbol, GetMonSpritePalStructFromOtIdPersonality } from '../battle/gfx';
import { state } from '../battle/env';
import { ChangeBgX, ChangeBgY } from '../gba/bg';
import { gfx, gfx16, loadGfx } from '../gba/gfx';
import {
  GetGpuReg,
  REG_OFFSET_BG0CNT,
  REG_OFFSET_BG0HOFS,
  REG_OFFSET_BG0VOFS,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WIN1H,
  REG_OFFSET_WIN1V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  SetGpuReg,
  vram,
  WIN_RANGE,
  WININ_WIN0_BG_ALL,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
  WININ_WIN1_BG0,
  WININ_WIN1_OBJ,
  WINOUT_WIN01_BG1,
  WINOUT_WIN01_BG2,
  WINOUT_WIN01_BG3,
  WINOUT_WIN01_CLR,
  WINOUT_WIN01_OBJ,
} from '../gba/hw';
import { gMain, SetVBlankCallback, type MainCallback } from '../gba/main';
import { BG_PLTT_ID, LoadPalette } from '../gba/palette';
import { gSprites, MAX_SPRITES, SpriteCallbackDummy, type Sprite } from '../gba/sprite';
import { CreateTask, DestroyTask, FindTaskIdByFunc, gTasks, type Task } from '../gba/task';
import { CreateMonPicSprite_HandleDeoxys, FreeAndDestroyMonPicSprite } from '../menus/picSprites';
import { testEvent } from '../dev/testHooks';
import { FieldEffectActiveListRemove, FieldEffectStart, gFieldEffectArguments, registerFieldEffectNatives } from './fieldEffectScripts';

/** What the banner needs from the field. */
export interface ShowMonHost {
  /** IsMapTypeOutdoors(GetCurrentMapType()) */
  isOutdoors(): boolean;
  /** Put the field on the GBA layer (FieldGbaScreen.start); its graphics must be loaded. */
  startGbaScreen(): void;
  /** Back to the Phaser-drawn field. */
  stopGbaScreen(): void;
}

let host: ShowMonHost | undefined;

export function setShowMonHost(h: ShowMonHost): void {
  host = h;
}

const STREAK_GFX = [
  'sFieldMoveStreaksOutdoors_Gfx',
  'sFieldMoveStreaksOutdoors_Pal',
  'sFieldMoveStreaksOutdoors_Tilemap',
  'sFieldMoveStreaksIndoors_Gfx',
  'sFieldMoveStreaksIndoors_Pal',
  'sFieldMoveStreaksIndoors_Tilemap',
];

/** The banner's graphics for any party mon (and the field's own, `extra`): load before FLDEFF_FIELD_MOVE_SHOW_MON_INIT. */
export function loadShowMonGfx(extra: string[]): Promise<void> {
  const syms = [...STREAK_GFX, ...extra];
  for (const mon of state.party) if (!mon.isEgg) syms.push(monPicSymbol(true, mon.species, mon.personality), ...monPalSymbols(mon.species));
  return loadGfx(syms);
}

/** FldEff_FieldMoveShowMonInit: gFieldEffectArguments[0] is a party index (bit 31: play the cry without ducking). */
function FldEff_FieldMoveShowMonInit(): number {
  const noDucking = gFieldEffectArguments[0] & 0x80000000;
  const partyIdx = gFieldEffectArguments[0] & 0xff;
  const mon = state.party[partyIdx];
  gFieldEffectArguments[0] = mon?.species ?? 0;
  gFieldEffectArguments[1] = mon?.otId ?? 0;
  gFieldEffectArguments[2] = mon?.personality ?? 0;
  gFieldEffectArguments[0] |= noDucking;
  FieldEffectStart('FLDEFF_FIELD_MOVE_SHOW_MON');
  FieldEffectActiveListRemove('FLDEFF_FIELD_MOVE_SHOW_MON_INIT');
  return 0;
}

/** FldEff_FieldMoveShowMon */
function FldEff_FieldMoveShowMon(): number {
  host!.startGbaScreen();
  const outdoors = host!.isOutdoors();
  const taskId = CreateTask(outdoors ? Task_ShowMon_Outdoors : Task_ShowMon_Indoors, 0xff);
  gTasks[taskId].data[15] = InitFieldMoveMonSprite(gFieldEffectArguments[0], gFieldEffectArguments[1], gFieldEffectArguments[2]);
  testEvent('fieldMoveShowMon', { species: gFieldEffectArguments[0] & 0x7fffffff, outdoors });
  return 0;
}

// The task saves the VBlank callback in data[13..14] (StoreWordInTwoHalfwords); JS keeps it here.
let savedVBlank: MainCallback | null = null;

const u16 = (v: number) => v & 0xffff;
const vram16 = () => new Uint16Array(vram.buffer, vram.byteOffset, vram.byteLength >> 1);

function CpuFill32Zero(offset: number, size: number): void {
  vram.fill(0, offset, offset + size);
}

// ------------------------------------------------------------------ outdoors

const sShowMonOutdoorsEffectFuncs = [
  ShowMonEffect_Outdoors_1,
  ShowMonEffect_Outdoors_2,
  ShowMonEffect_Outdoors_3,
  ShowMonEffect_Outdoors_4,
  ShowMonEffect_Outdoors_5,
  ShowMonEffect_Outdoors_6,
  ShowMonEffect_Outdoors_7,
];

function Task_ShowMon_Outdoors(taskId: number): void {
  sShowMonOutdoorsEffectFuncs[gTasks[taskId].data[0]](gTasks[taskId]);
}

function ShowMonEffect_Outdoors_1(task: Task): void {
  task.data[11] = GetGpuReg(REG_OFFSET_WININ);
  task.data[12] = GetGpuReg(REG_OFFSET_WINOUT);
  savedVBlank = gMain.vblankCallback;
  task.data[1] = WIN_RANGE(0xf0, 0xf1);
  task.data[2] = WIN_RANGE(0x50, 0x51);
  task.data[3] = WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR;
  task.data[4] = WINOUT_WIN01_BG1 | WINOUT_WIN01_BG2 | WINOUT_WIN01_BG3 | WINOUT_WIN01_OBJ | WINOUT_WIN01_CLR;
  SetGpuReg(REG_OFFSET_WIN0H, u16(task.data[1]));
  SetGpuReg(REG_OFFSET_WIN0V, u16(task.data[2]));
  SetGpuReg(REG_OFFSET_WININ, u16(task.data[3]));
  SetGpuReg(REG_OFFSET_WINOUT, u16(task.data[4]));
  SetVBlankCallback(VBlankCB_ShowMonEffect_Outdoors);
  task.data[0]++;
}

function ShowMonEffect_Outdoors_2(task: Task): void {
  const charbase = ((GetGpuReg(REG_OFFSET_BG0CNT) >> 2) & 3) << 14;
  const screenbase = ((GetGpuReg(REG_OFFSET_BG0CNT) >> 8) & 0x1f) << 11;
  vram.set(gfx('sFieldMoveStreaksOutdoors_Gfx').subarray(0, 0x200), charbase);
  CpuFill32Zero(screenbase, 0x800);
  LoadPalette(gfx16('sFieldMoveStreaksOutdoors_Pal'), BG_PLTT_ID(15), 0x20);
  LoadFieldMoveStreaksTilemapToVram(screenbase);
  task.data[0]++;
}

function ShowMonEffect_Outdoors_3(task: Task): void {
  task.data[5] -= 16;
  let win0hLo = u16(task.data[1]) >> 8;
  let win0vLo = u16(task.data[2]) >> 8;
  let win0vHi = u16(task.data[2]) & 0xff;
  win0hLo -= 16;
  win0vLo -= 2;
  win0vHi += 2;
  if (win0hLo < 0) win0hLo = 0;
  if (win0vLo < 0x28) win0vLo = 0x28;
  if (win0vHi > 0x78) win0vHi = 0x78;
  task.data[1] = WIN_RANGE(win0hLo, task.data[1] & 0xff);
  task.data[2] = WIN_RANGE(win0vLo, win0vHi);
  if (win0hLo === 0 && win0vLo === 0x28 && win0vHi === 0x78) {
    gSprites[task.data[15]].callback = SpriteCB_FieldMoveMonSlideOnscreen;
    task.data[0]++;
  }
}

function ShowMonEffect_Outdoors_4(task: Task): void {
  task.data[5] -= 16;
  if (gSprites[task.data[15]].data[7]) task.data[0]++;
}

function ShowMonEffect_Outdoors_5(task: Task): void {
  task.data[5] -= 16;
  let win0vLo = u16(task.data[2]) >> 8;
  let win0vHi = u16(task.data[2]) & 0xff;
  win0vLo += 6;
  win0vHi -= 6;
  if (win0vLo > 0x50) win0vLo = 0x50;
  if (win0vHi < 0x51) win0vHi = 0x51;
  task.data[2] = WIN_RANGE(win0vLo, win0vHi);
  if (win0vLo === 0x50 && win0vHi === 0x51) task.data[0]++;
}

function ShowMonEffect_Outdoors_6(task: Task): void {
  const bg0cnt = ((GetGpuReg(REG_OFFSET_BG0CNT) >> 8) & 0x1f) << 11;
  CpuFill32Zero(bg0cnt, 0x800);
  task.data[1] = WIN_RANGE(0x00, 0xf1);
  task.data[2] = WIN_RANGE(0x00, 0xa1);
  task.data[3] = task.data[11];
  task.data[4] = task.data[12];
  task.data[0]++;
}

function ShowMonEffect_Outdoors_7(task: Task): void {
  SetVBlankCallback(savedVBlank);
  ChangeBgX(0, 0, 0);
  ChangeBgY(0, 0, 0);
  // Menu_LoadStdPal: the field's windows are Phaser's
  FreeResourcesAndDestroySprite(task.data[15]);
  FieldEffectActiveListRemove('FLDEFF_FIELD_MOVE_SHOW_MON');
  DestroyTask(FindTaskIdByFunc(Task_ShowMon_Outdoors));
  host!.stopGbaScreen();
}

function VBlankCB_ShowMonEffect_Outdoors(): void {
  const task = gTasks[FindTaskIdByFunc(Task_ShowMon_Outdoors)];
  savedVBlank?.();
  SetGpuReg(REG_OFFSET_WIN0H, u16(task.data[1]));
  SetGpuReg(REG_OFFSET_WIN0V, u16(task.data[2]));
  SetGpuReg(REG_OFFSET_WININ, u16(task.data[3]));
  SetGpuReg(REG_OFFSET_WINOUT, u16(task.data[4]));
  SetGpuReg(REG_OFFSET_BG0HOFS, u16(task.data[5]));
  SetGpuReg(REG_OFFSET_BG0VOFS, u16(task.data[6]));
}

function LoadFieldMoveStreaksTilemapToVram(screenbase: number): void {
  const tilemap = gfx16('sFieldMoveStreaksOutdoors_Tilemap');
  const dest = vram16();
  const start = (10 * 32 + screenbase) >> 1;
  for (let i = 0; i < 10 * 32; i++) dest[start + i] = tilemap[i] | 0xf000;
}

// ------------------------------------------------------------------ indoors

const sShowMonIndoorsEffectFuncs = [
  ShowMonEffect_Indoors_1,
  ShowMonEffect_Indoors_2,
  ShowMonEffect_Indoors_3,
  ShowMonEffect_Indoors_4,
  ShowMonEffect_Indoors_5,
  ShowMonEffect_Indoors_6,
  ShowMonEffect_Indoors_7,
];

function Task_ShowMon_Indoors(taskId: number): void {
  sShowMonIndoorsEffectFuncs[gTasks[taskId].data[0]](gTasks[taskId]);
}

function ShowMonEffect_Indoors_1(task: Task): void {
  SetGpuReg(REG_OFFSET_BG0HOFS, u16(task.data[1]));
  SetGpuReg(REG_OFFSET_BG0VOFS, u16(task.data[2]));
  savedVBlank = gMain.vblankCallback;
  SetVBlankCallback(VBlankCB_ShowMonEffect_Indoors);
  task.data[0]++;
}

function ShowMonEffect_Indoors_2(task: Task): void {
  const charbase = ((GetGpuReg(REG_OFFSET_BG0CNT) >> 2) & 3) << 14;
  const screenbase = ((GetGpuReg(REG_OFFSET_BG0CNT) >> 8) & 0x1f) << 11;
  task.data[12] = screenbase;
  vram.set(gfx('sFieldMoveStreaksIndoors_Gfx').subarray(0, 0x80), charbase);
  CpuFill32Zero(screenbase, 0x800);
  LoadPalette(gfx16('sFieldMoveStreaksIndoors_Pal'), BG_PLTT_ID(15), 0x20);
  task.data[0]++;
}

function ShowMonEffect_Indoors_3(task: Task): void {
  if (SlideIndoorBannerOnscreen(task)) {
    task.data[5] = GetGpuReg(REG_OFFSET_WININ);
    SetGpuReg(REG_OFFSET_WININ, (task.data[5] & 0xff) | WININ_WIN1_BG0 | WININ_WIN1_OBJ);
    SetGpuReg(REG_OFFSET_WIN1H, WIN_RANGE(0x00, 0xf0));
    SetGpuReg(REG_OFFSET_WIN1V, WIN_RANGE(0x28, 0x78));
    gSprites[task.data[15]].callback = SpriteCB_FieldMoveMonSlideOnscreen;
    task.data[0]++;
  }
  AnimateIndoorShowMonBg(task);
}

function ShowMonEffect_Indoors_4(task: Task): void {
  AnimateIndoorShowMonBg(task);
  if (gSprites[task.data[15]].data[7]) task.data[0]++;
}

function ShowMonEffect_Indoors_5(task: Task): void {
  AnimateIndoorShowMonBg(task);
  task.data[3] = task.data[1] & 7;
  task.data[4] = 0;
  SetGpuReg(REG_OFFSET_WIN1H, WIN_RANGE(0xff, 0xff));
  SetGpuReg(REG_OFFSET_WIN1V, WIN_RANGE(0xff, 0xff));
  SetGpuReg(REG_OFFSET_WININ, u16(task.data[5]));
  task.data[0]++;
}

function ShowMonEffect_Indoors_6(task: Task): void {
  AnimateIndoorShowMonBg(task);
  if (SlideIndoorBannerOffscreen(task)) task.data[0]++;
}

function ShowMonEffect_Indoors_7(task: Task): void {
  const screenbase = ((GetGpuReg(REG_OFFSET_BG0CNT) >> 8) & 0x1f) << 11;
  CpuFill32Zero(screenbase, 0x800);
  SetVBlankCallback(savedVBlank);
  ChangeBgX(0, 0, 0);
  ChangeBgY(0, 0, 0);
  FreeResourcesAndDestroySprite(task.data[15]);
  FieldEffectActiveListRemove('FLDEFF_FIELD_MOVE_SHOW_MON');
  DestroyTask(FindTaskIdByFunc(Task_ShowMon_Indoors));
  host!.stopGbaScreen();
}

function VBlankCB_ShowMonEffect_Indoors(): void {
  const task = gTasks[FindTaskIdByFunc(Task_ShowMon_Indoors)];
  savedVBlank?.();
  SetGpuReg(REG_OFFSET_BG0HOFS, u16(task.data[1]));
  SetGpuReg(REG_OFFSET_BG0VOFS, u16(task.data[2]));
}

function AnimateIndoorShowMonBg(task: Task): void {
  task.data[1] -= 16;
  task.data[3] += 16;
}

function SlideIndoorBannerOnscreen(task: Task): boolean {
  if (task.data[4] >= 32) return true;
  let dstOffs = (task.data[3] >> 3) & 0x1f;
  if (dstOffs >= task.data[4]) {
    dstOffs = (32 - dstOffs) & 0x1f;
    const srcOffs = (32 - task.data[4]) & 0x1f;
    const tilemap = gfx16('sFieldMoveStreaksIndoors_Tilemap');
    const dest = vram16();
    const base = (0x140 + u16(task.data[12])) >> 1;
    for (let i = 0; i < 10; i++) {
      dest[base + dstOffs + i * 32] = tilemap[srcOffs + i * 32] | 0xf000;
      dest[base + ((dstOffs + 1) & 0x1f) + i * 32] = tilemap[((srcOffs + 1) & 0x1f) + i * 32] | 0xf000;
    }
    task.data[4] += 2;
  }
  return false;
}

function SlideIndoorBannerOffscreen(task: Task): boolean {
  if (task.data[4] >= 32) return true;
  let dstOffs = task.data[3] >> 3;
  if (dstOffs >= task.data[4]) {
    dstOffs = (task.data[1] >> 3) & 0x1f;
    const dest = vram16();
    const base = (0x140 + u16(task.data[12])) >> 1;
    for (let i = 0; i < 10; i++) {
      dest[base + dstOffs + i * 32] = 0xf000;
      dest[base + ((dstOffs + 1) & 0x1f) + i * 32] = 0xf000;
    }
    task.data[4] += 2;
  }
  return false;
}

// ------------------------------------------------------------------ the mon

/** InitFieldMoveMonSprite → CreateMonSprite_FieldMove */
function InitFieldMoveMonSprite(speciesArg: number, otId: number, personality: number): number {
  const playCry = (speciesArg & 0x80000000) !== 0;
  const species = speciesArg & 0x7fffffff;
  const pal = GetMonSpritePalStructFromOtIdPersonality(species, otId >>> 0, personality >>> 0);
  let spriteId = CreateMonPicSprite_HandleDeoxys(species, otId >>> 0, personality >>> 0, true, 0x140, 0x50, 0, pal.tag);
  if (spriteId === 0xffff) spriteId = MAX_SPRITES; // (PreservePaletteInWeather: no weather palettes)
  const sprite = gSprites[spriteId];
  sprite.callback = SpriteCallbackDummy;
  sprite.oam.priority = 0;
  sprite.data[0] = species;
  sprite.data[6] = playCry ? 1 : 0;
  return spriteId;
}

/** FreeResourcesAndDestroySprite on the pic sprite */
function FreeResourcesAndDestroySprite(spriteId: number): void {
  FreeAndDestroyMonPicSprite(spriteId);
}

function SpriteCB_FieldMoveMonSlideOnscreen(sprite: Sprite): void {
  if ((sprite.x -= 20) <= 0x78) {
    sprite.x = 0x78;
    sprite.data[1] = 30;
    sprite.callback = SpriteCB_FieldMoveMonWaitAfterCry;
    // PlayCry_NormalNoDucking / PlayCry_Normal: no audio
  }
}

function SpriteCB_FieldMoveMonWaitAfterCry(sprite: Sprite): void {
  if (--sprite.data[1] === 0) sprite.callback = SpriteCB_FieldMoveMonSlideOffscreen;
}

function SpriteCB_FieldMoveMonSlideOffscreen(sprite: Sprite): void {
  if (sprite.x < -0x40) sprite.data[7] = 1;
  else sprite.x -= 20;
}

registerFieldEffectNatives({ FldEff_FieldMoveShowMonInit, FldEff_FieldMoveShowMon });
