// battle_anim.c: the battle animation script engine (data/battle_anim_scripts.s, assembled by
// tools/extract_battle_anims.py), LaunchBattleAnimation / DoMoveAnim, and LaunchStatusAnimation from
// battle_anim_status_effects.c.
//
// Script pointers to sprite templates and task functions are looked up by C name in the registry
// (state.ts). A script only runs when every template callback and task it can reach is ported and its
// graphics are loaded (`isAnimRunnable`); otherwise the launch ends at once like before, so a missing
// port never hangs a battle. `battleAnimGfxSymbols` lists the graphics to preload.

import { testEvent } from '../../dev/testHooks';
import { gfx, gfx16, isGfxLoaded, loadGfx } from '../../gba/gfx';
import { BG_CHAR_ADDR, BG_SCREEN_ADDR, LZDecompressVram } from '../../gba/bg';
import {
  BLDCNT_EFFECT_BLEND,
  BLDCNT_TGT2_ALL,
  pltt,
  REG_OFFSET_BG1HOFS,
  REG_OFFSET_BG1VOFS,
  REG_OFFSET_BG2HOFS,
  REG_OFFSET_BG2VOFS,
  REG_OFFSET_BLDALPHA,
  REG_OFFSET_BLDCNT,
  SetGpuReg,
  vram,
} from '../../gba/hw';
import { BeginHardwarePaletteFade, BG_PLTT_ID, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, LoadCompressedPalette, LoadPalette, OBJ_PLTT_ID, PLTT_SIZE_4BPP } from '../../gba/palette';
import {
  CreateSpriteAndAnimate,
  FreeSpritePaletteByTag,
  gDummyOamData,
  FreeSpriteTilesByTag,
  gDummySpriteAffineAnimTable,
  gDummySpriteAnimTable,
  gSprites,
  LoadCompressedSpritePalette,
  LoadCompressedSpriteSheet,
  oam,
  SpriteCallbackDummy,
  type AffineAnimCmd,
  type AnimCmd,
  type SpriteTemplate,
} from '../../gba/sprite';
import { CreateTask, DestroyTask, gTasks, TASK_NONE, type TaskFunc } from '../../gba/task';
import { DrawMainBattleBackground } from '../battleBg';
import { UpdateOamPriorityInAllHealthboxes } from '../battleInterface';
import { ui } from '../battleUi';
import { K } from '../constants';
import { bdata, g } from '../env';
import { affineAnimTable, animTable } from '../gfx';
import type { DisableStruct } from '../structs';
import { getBattlerPosition, getBattlerSide } from '../util';
import {
  CopyBattlerSpriteToBg,
  GetAnimBattlerSpriteId,
  GetBattleAnimBg1Data,
  GetBattleAnimBgData,
  GetBattlerSpriteBGPriorityRank,
  GetBattlerSpriteCoord,
  GetBattlerSpriteSubpriority,
  InitBattleAnimBg,
  InitPrioritiesForVisibleBattlers,
  IsBattlerSpriteVisible,
  IsDoubleBattle,
  SetAnimBgAttribute,
  SPRITE_NONE,
} from './animMons';
import { registerPortedBattleAnims } from './ported';
import { anim, animExtraGfx, gBattleAnimArgs, spriteCallbackByName, taskFuncByName } from './state';

const ANIM_SPRITE_INDEX_COUNT = 8;
const ANIMSPRITE_IS_TARGET = 0x80;

// EWRAM statics
let sBattleAnimScriptPtr = 0;
let sBattleAnimScriptRetAddr = 0;
let sAnimFramesToWait = 0;
const sAnimSpriteIndexArray = new Uint16Array(ANIM_SPRITE_INDEX_COUNT).fill(0xffff);
// sSoundAnimFramesToWait only counts frames of a playing SE, and nothing plays without audio.
const sMonAnimTaskIdArray = [TASK_NONE, TASK_NONE];
let sAnimBackgroundFadeState = 0;
/** The running script's label (for test events) */
let sScriptLabel = '';

// ------------------------------------------------------------------ ROM image

let rom: Uint8Array | undefined;
let externByAddr: Map<number, string> | undefined;
let labelByAddr: Map<number, string> | undefined;

function romImage(): Uint8Array {
  if (!rom) {
    const bin = atob(bdata.animScripts.rom);
    rom = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) rom[i] = bin.charCodeAt(i);
  }
  return rom;
}

const off = (addr: number) => addr - bdata.animScripts.romBase;
const read8 = (addr: number) => romImage()[off(addr)];
const read16 = (addr: number) => read8(addr) | (read8(addr + 1) << 8);
const read32 = (addr: number) => (read16(addr) | (read16(addr + 2) << 16)) >>> 0;
const s8 = (v: number) => (v << 24) >> 24;

/** The C symbol a script pointer names (sprite template or task function). */
function externName(addr: number): string {
  if (!externByAddr) {
    const d = bdata.animScripts;
    externByAddr = new Map(d.externs.map((n, i) => [d.externBase + 4 * i, n]));
  }
  const name = externByAddr.get(addr);
  if (!name) throw new Error(`[battle anim] no C symbol at 0x${addr.toString(16)}`);
  return name;
}

function labelName(addr: number): string {
  if (!labelByAddr) labelByAddr = new Map(Object.entries(bdata.animScripts.labels).map(([k, v]) => [v, k]));
  return labelByAddr.get(addr) ?? `0x${addr.toString(16)}`;
}

/**
 * animsTable[tableId]: the script address in gBattleAnims_Moves etc. Read from the ROM image like the C,
 * since B_ANIM_STATUS_WRAPPED indexes one past the end of gBattleAnims_StatusConditions.
 */
function scriptAddress(table: string, tableId: number): number {
  return read32(bdata.animScripts.labels[table] + 4 * tableId);
}

// ------------------------------------------------------------------ sprite templates

const templates = new Map<string, SpriteTemplate>();

function findAnimTable(unit: string, name: string, affine: boolean): AnimCmd[][] | AffineAnimCmd[][] {
  // `&sAnims_BasicRock[2]`: a pointer into the middle of a table
  const at = /^(\w+)\[(\d+)\]$/.exec(name);
  if (at) return findAnimTable(unit, at[1], affine).slice(Number(at[2])) as AnimCmd[][] | AffineAnimCmd[][];
  if (name === 'gDummySpriteAnimTable') return gDummySpriteAnimTable;
  if (name === 'gDummySpriteAffineAnimTable') return gDummySpriteAffineAnimTable;
  const units = bdata.anims.units;
  const has = (u: string) => (affine ? units[u]?.affineTables[name] : units[u]?.tables[name]);
  const where = has(unit) ? unit : Object.keys(units).find(has);
  if (!where) throw new Error(`[battle anim] unknown ${affine ? 'affine ' : ''}anim table ${name}`);
  return affine ? affineAnimTable(where, name) : animTable(where, name);
}

/**
 * The SpriteTemplate a script's createsprite points at, or undefined if its callback isn't ported.
 * `anyCallback`: for code that creates the sprite with CreateSprite and sets its own callback right away
 * (the template's callback never runs), an unported template callback becomes SpriteCallbackDummy.
 */
export function animSpriteTemplate(name: string, anyCallback = false): SpriteTemplate | undefined {
  const key = anyCallback ? `${name}|any` : name;
  const cached = templates.get(key);
  if (cached) return cached;
  const t = bdata.animScripts.templates[name];
  if (!t) return undefined;
  const callback = t.callback === 'SpriteCallbackDummy' ? SpriteCallbackDummy : (spriteCallbackByName(t.callback) ?? (anyCallback ? SpriteCallbackDummy : undefined));
  if (!callback) return undefined;
  const o = t.oam === 'gDummyOamData' ? gDummyOamData : bdata.animScripts.oam[t.oam];
  if (!o) throw new Error(`[battle anim] unknown OamData ${t.oam}`);
  const template: SpriteTemplate = {
    tileTag: t.tileTag,
    paletteTag: t.paletteTag,
    oam: oam(o),
    anims: findAnimTable(t.unit, t.anims, false) as AnimCmd[][],
    images: null,
    affineAnims: findAnimTable(t.unit, t.affineAnims, true) as AffineAnimCmd[][],
    callback,
  };
  templates.set(key, template);
  return template;
}

/** gBattleAnimPicTable / gBattleAnimPaletteTable entry for an ANIM_TAG */
function picEntry(tag: number) {
  const i = tag - bdata.animScripts.animSpritesStart;
  return { pic: bdata.animScripts.pics[i], pal: bdata.animScripts.palettes[i] };
}

/** The graphics symbols of an ANIM_TAG's sheet and palette (for preloading what code loads itself). */
export function animTagGfx(tag: number): string[] {
  const { pic, pal } = picEntry(tag);
  return [pic?.symbol, pal?.symbol].filter((s): s is string => !!s);
}

/** LoadCompressedSpriteSheetUsingHeap + LoadCompressedSpritePaletteUsingHeap for an ANIM_TAG */
export function LoadAnimSpriteGfx(tag: number): void {
  const { pic, pal } = picEntry(tag);
  if (pic) LoadCompressedSpriteSheet({ data: gfx(pic.symbol), size: pic.size, tag: pic.tag });
  if (pal) LoadCompressedSpritePalette({ data: gfx16(pal.symbol), tag: pal.tag });
}

// ------------------------------------------------------------------ static analysis

interface ScriptNeeds {
  missing: string[];
  gfx: string[];
}
const needsCache = new Map<number, ScriptNeeds>();

/** What a script can reach: C symbols that aren't ported yet, and the graphics it loads. */
function scriptNeeds(start: number): ScriptNeeds {
  registerPortedBattleAnims();
  const cached = needsCache.get(start);
  if (cached) return cached;
  const missing = new Set<string>();
  const syms = new Set<string>();
  const seen = new Set<number>();
  const bgSyms = (bgId: number) => {
    const bg = bdata.animScripts.backgrounds[bgId];
    if (bg) [bg.image, bg.palette, bg.tilemap].forEach((s) => syms.add(s));
  };
  const todo = [start];
  while (todo.length) {
    let p = todo.pop()!;
    for (;;) {
      if (seen.has(p)) break;
      seen.add(p);
      const op = read8(p);
      const args = (at: number) => read8(at) * 2;
      let next = -1;
      switch (op) {
        case 0x00: {
          const { pic, pal } = picEntry(read16(p + 1));
          if (pic) syms.add(pic.symbol);
          if (pal) syms.add(pal.symbol);
          next = p + 3;
          break;
        }
        case 0x01: case 0x0c: case 0x09: case 0x1e:
          next = p + 3;
          break;
        case 0x02: {
          const name = externName(read32(p + 1));
          if (!animSpriteTemplate(name)) missing.add(bdata.animScripts.templates[name] ? `${name} (${bdata.animScripts.templates[name].callback})` : name);
          else animExtraGfx(bdata.animScripts.templates[name].callback).forEach((s) => syms.add(s));
          next = p + 7 + args(p + 6);
          break;
        }
        case 0x03: {
          const name = externName(read32(p + 1));
          if (!taskFuncByName(name)) missing.add(name);
          animExtraGfx(name).forEach((s) => syms.add(s));
          next = p + 7 + args(p + 6);
          break;
        }
        case 0x1f: {
          const name = externName(read32(p + 1));
          if (!taskFuncByName(name)) missing.add(name);
          animExtraGfx(name).forEach((s) => syms.add(s));
          next = p + 6 + args(p + 5);
          break;
        }
        case 0x04: case 0x0a: case 0x0b: case 0x1a: case 0x22: case 0x23: case 0x28: case 0x2a: case 0x2b: case 0x2c: case 0x2d: case 0x2e:
          next = p + 2;
          break;
        case 0x14: case 0x18:
          bgSyms(read8(p + 1));
          next = p + 2;
          break;
        case 0x25:
          bgSyms(read8(p + 1));
          bgSyms(read8(p + 2));
          next = p + 4;
          break;
        case 0x05: case 0x06: case 0x07: case 0x0d: case 0x15: case 0x16: case 0x17: case 0x20: case 0x29: case 0x2f:
          next = p + 1;
          break;
        case 0x08: case 0x0f: // end, return
          break;
        case 0x0e: // call
          todo.push(read32(p + 1));
          next = p + 5;
          break;
        case 0x10:
          next = p + 4;
          break;
        case 0x11: // choosetwoturnanim
          todo.push(read32(p + 1), read32(p + 5));
          break;
        case 0x12: // jumpifmoveturn
          todo.push(read32(p + 2));
          next = p + 6;
          break;
        case 0x13: // goto
          todo.push(read32(p + 1));
          break;
        case 0x19:
          next = p + 4;
          break;
        case 0x1b: case 0x26: case 0x27:
          next = p + 7;
          break;
        case 0x1c:
          next = p + 6;
          break;
        case 0x1d:
          next = p + 5;
          break;
        case 0x21: // jumpargeq
          todo.push(read32(p + 4));
          next = p + 8;
          break;
        case 0x24: // jumpifcontest: never taken
          next = p + 5;
          break;
        default:
          throw new Error(`[battle anim] unknown script command 0x${op.toString(16)} at ${labelName(start)}`);
      }
      if (next < 0) break;
      p = next;
    }
  }
  const result = { missing: [...missing], gfx: [...syms] };
  needsCache.set(start, result);
  return result;
}

const reported = new Set<number>();

/** Whether the script can run now; logs (once) what keeps it from running. */
function isAnimRunnable(start: number): boolean {
  const needs = scriptNeeds(start);
  if (needs.missing.length) {
    if (!reported.has(start)) {
      reported.add(start);
      console.info(`[battle anim] ${labelName(start)} skipped, not ported: ${needs.missing.join(', ')}`);
    }
    return false;
  }
  const unloaded = needs.gfx.filter((s) => !isGfxLoaded(s));
  if (unloaded.length) {
    // A move nobody had when the battle started (Metronome, Mimic, ...): load it for next time.
    void loadGfx(unloaded);
    return false;
  }
  return true;
}

/** Every script by label with the C symbols it still needs (empty when it runs), for tests and tools. */
export function battleAnimCoverage(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const table of Object.values(bdata.animScripts.tables)) for (const addr of table) out[labelName(addr)] = scriptNeeds(addr).missing;
  return out;
}

/** Graphics the move anims of `moves` and every status/general anim can load (to preload). */
export function battleAnimGfxSymbols(moves: Iterable<number>): string[] {
  const syms = new Set<string>();
  const add = (addr: number) => scriptNeeds(addr).gfx.forEach((s) => syms.add(s));
  for (const m of moves) add(scriptAddress('gBattleAnims_Moves', m));
  for (const table of ['gBattleAnims_StatusConditions', 'gBattleAnims_General', 'gBattleAnims_Special']) bdata.animScripts.tables[table].forEach(add);
  return [...syms];
}

// ------------------------------------------------------------------ launching

/** ClearBattleAnimationVars */
export function ClearBattleAnimationVars(): void {
  sAnimFramesToWait = 0;
  anim.scriptActive = false;
  anim.visualTaskCount = 0;
  anim.soundTaskCount = 0;
  anim.disableStruct = null;
  anim.moveDmg = 0;
  anim.movePower = 0;
  anim.friendship = 0;
  sAnimSpriteIndexArray.fill(0xffff);
  gBattleAnimArgs.fill(0);
  sMonAnimTaskIdArray[0] = TASK_NONE;
  sMonAnimTaskIdArray[1] = TASK_NONE;
  anim.moveTurn = 0;
  sAnimBackgroundFadeState = 0;
  anim.attacker = 0;
  anim.target = 0;
  anim.customPanning = 0;
}

/**
 * The gAnim* globals XHandleMoveAnimation reads from the CONTROLLER_MOVEANIMATION buffer (turn, power,
 * damage, friendship, weather, and the DisableStruct copied after them).
 */
export function SetMoveAnimGlobalsFromBuffer(battler: number): void {
  const b = g.battleBufferA[battler];
  anim.moveTurn = b[3];
  anim.movePower = b[4] | (b[5] << 8);
  anim.moveDmg = b[6] | (b[7] << 8) | (b[8] << 16) | (b[9] << 24);
  anim.friendship = b[10];
  anim.weatherMoveAnim = b[12] | (b[13] << 8);
  anim.disableStruct = g.battleBufferAObj[battler] as DisableStruct;
  g.transformedPersonalities[battler] = anim.disableStruct.transformedMonPersonality;
}

/** DoMoveAnim */
export function DoMoveAnim(move: number): void {
  anim.attacker = g.battlerAttacker;
  anim.target = g.battlerTarget;
  LaunchBattleAnimation('gBattleAnims_Moves', move, true);
}

/**
 * LaunchBattleAnimation: `table` is gBattleAnims_Moves / _StatusConditions / _General / _Special.
 * Returns false (and leaves gAnimScriptActive FALSE) when the script can't run yet.
 */
export function LaunchBattleAnimation(table: string, tableId: number, _isMoveAnim: boolean): boolean {
  const start = scriptAddress(table, tableId);
  anim.scriptCallback = () => {};
  anim.scriptActive = false;
  const runnable = isAnimRunnable(start);
  testEvent('battleAnim', { label: labelName(start), ran: runnable, attacker: anim.attacker, target: anim.target });
  if (!runnable) return false;
  sScriptLabel = labelName(start);
  InitPrioritiesForVisibleBattlers();
  UpdateOamPriorityInAllHealthboxes(0);
  for (let i = 0; i < K.MAX_BATTLERS_COUNT; i++) {
    const party = getBattlerSide(i) !== K.B_SIDE_PLAYER ? g.enemyParty : g.playerParty;
    anim.battlerSpecies[i] = party[g.battlerPartyIndexes[i]]?.species ?? 0;
  }
  gBattleAnimArgs.fill(0);
  sMonAnimTaskIdArray[0] = TASK_NONE;
  sMonAnimTaskIdArray[1] = TASK_NONE;
  sBattleAnimScriptPtr = start;
  anim.scriptActive = true;
  sAnimFramesToWait = 0;
  anim.scriptCallback = RunAnimScriptCommand;
  sAnimSpriteIndexArray.fill(0xffff);
  // gMovesWithQuietBGM lowers the BGM volume (no audio yet)
  g.battle_WIN0H = 0;
  g.battle_WIN0V = 0;
  g.battle_WIN1H = 0;
  g.battle_WIN1V = 0;
  return true;
}

/** LaunchStatusAnimation (battle_anim_status_effects.c) */
export function LaunchStatusAnimation(battlerId: number, statusAnimId: number): void {
  anim.attacker = battlerId;
  anim.target = battlerId;
  LaunchBattleAnimation('gBattleAnims_StatusConditions', statusAnimId, false);
  const taskId = CreateTask(Task_DoStatusAnimation, 10);
  gTasks[taskId].data[0] = battlerId;
}

const Task_DoStatusAnimation: TaskFunc = (taskId) => {
  anim.scriptCallback();
  if (!anim.scriptActive) {
    g.battleSpritesDataPtr.healthBoxesData[gTasks[taskId].data[0]].statusAnimActive = 0;
    DestroyTask(taskId);
  }
};

// ------------------------------------------------------------------ the interpreter

function AddSpriteIndex(index: number): void {
  const i = sAnimSpriteIndexArray.indexOf(0xffff);
  if (i >= 0) sAnimSpriteIndexArray[i] = index;
}

function ClearSpriteIndex(index: number): void {
  const i = sAnimSpriteIndexArray.indexOf(index);
  if (i >= 0) sAnimSpriteIndexArray[i] = 0xffff;
}

function WaitAnimFrameCount(): void {
  if (sAnimFramesToWait <= 0) {
    anim.scriptCallback = RunAnimScriptCommand;
    sAnimFramesToWait = 0;
  } else {
    sAnimFramesToWait--;
  }
}

function RunAnimScriptCommand(): void {
  do {
    sScriptCmdTable[read8(sBattleAnimScriptPtr)]();
  } while (sAnimFramesToWait === 0 && anim.scriptActive);
}

const GET_TRUE_SPRITE_INDEX = (tag: number) => tag - bdata.animScripts.animSpritesStart;

function Cmd_loadspritegfx(): void {
  const index = read16(sBattleAnimScriptPtr + 1);
  LoadAnimSpriteGfx(index);
  sBattleAnimScriptPtr += 3;
  AddSpriteIndex(GET_TRUE_SPRITE_INDEX(index));
  sAnimFramesToWait = 1;
  anim.scriptCallback = WaitAnimFrameCount;
}

function freeAnimSpriteGfx(index: number): void {
  const pic = bdata.animScripts.pics[index];
  if (!pic) return;
  FreeSpriteTilesByTag(pic.tag);
  FreeSpritePaletteByTag(pic.tag);
}

function Cmd_unloadspritegfx(): void {
  const index = GET_TRUE_SPRITE_INDEX(read16(sBattleAnimScriptPtr + 1));
  freeAnimSpriteGfx(index);
  sBattleAnimScriptPtr += 3;
  ClearSpriteIndex(index);
}

/** Cmd_createsprite: flags bits 0-6 = subpriority offset, bit 7 = relative to the target */
function Cmd_createsprite(): void {
  const template = animSpriteTemplate(externName(read32(sBattleAnimScriptPtr + 1)))!;
  let argVar = read8(sBattleAnimScriptPtr + 5);
  const argsCount = read8(sBattleAnimScriptPtr + 6);
  sBattleAnimScriptPtr += 7;
  for (let i = 0; i < argsCount; i++) {
    gBattleAnimArgs[i] = read16(sBattleAnimScriptPtr);
    sBattleAnimScriptPtr += 2;
  }
  const isTarget = argVar & ANIMSPRITE_IS_TARGET;
  argVar &= ~ANIMSPRITE_IS_TARGET;
  argVar = argVar >= 64 ? argVar - 64 : -argVar & 0xff;
  let subpriority = GetBattlerSpriteSubpriority(isTarget ? anim.target : anim.attacker) + s8(argVar);
  if (subpriority < 3) subpriority = 3;
  CreateSpriteAndAnimate(template, GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2), GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET), subpriority & 0xff);
  anim.visualTaskCount = (anim.visualTaskCount + 1) & 0xff;
}

function Cmd_createvisualtask(): void {
  const taskFunc = taskFuncByName(externName(read32(sBattleAnimScriptPtr + 1)))!;
  const taskPriority = read8(sBattleAnimScriptPtr + 5);
  const numArgs = read8(sBattleAnimScriptPtr + 6);
  sBattleAnimScriptPtr += 7;
  for (let i = 0; i < numArgs; i++) {
    gBattleAnimArgs[i] = read16(sBattleAnimScriptPtr);
    sBattleAnimScriptPtr += 2;
  }
  const taskId = CreateTask(taskFunc, taskPriority);
  taskFunc(taskId);
  anim.visualTaskCount = (anim.visualTaskCount + 1) & 0xff;
}

function Cmd_delay(): void {
  sAnimFramesToWait = s8(read8(sBattleAnimScriptPtr + 1));
  if (sAnimFramesToWait === 0) sAnimFramesToWait = -1;
  sBattleAnimScriptPtr += 2;
  anim.scriptCallback = WaitAnimFrameCount;
}

function Cmd_waitforvisualfinish(): void {
  if (anim.visualTaskCount === 0) {
    sBattleAnimScriptPtr++;
    sAnimFramesToWait = 0;
  } else {
    sAnimFramesToWait = 1;
  }
}

function Cmd_nop(): void {
  // As in the C: doesn't advance (never used by a script).
}

function Cmd_end(): void {
  // Keep waiting as long as there are animations to be done.
  if (anim.visualTaskCount !== 0 || anim.soundTaskCount !== 0 || sMonAnimTaskIdArray[0] !== TASK_NONE || sMonAnimTaskIdArray[1] !== TASK_NONE) {
    sAnimFramesToWait = 1;
    return;
  }
  // IsSEPlaying() is always FALSE without audio, so there's no 90-frame SE wait.
  for (let i = 0; i < ANIM_SPRITE_INDEX_COUNT; i++) {
    if (sAnimSpriteIndexArray[i] !== 0xffff) {
      freeAnimSpriteGfx(sAnimSpriteIndexArray[i]);
      sAnimSpriteIndexArray[i] = 0xffff;
    }
  }
  InitPrioritiesForVisibleBattlers();
  UpdateOamPriorityInAllHealthboxes(1);
  anim.scriptActive = false;
  testEvent('battleAnimEnd', { label: sScriptLabel });
}

function Cmd_playse(): void {
  ui.playSE(read16(sBattleAnimScriptPtr + 1));
  sBattleAnimScriptPtr += 3;
}

/** Which battler monbg/clearmonbg name, with ANIM_ATTACKER/TARGET widened to include the partner. */
function monBgBattler(animBattler: number): { animBattler: number; battlerId: number } {
  if (animBattler === K.ANIM_ATTACKER) animBattler = K.ANIM_ATK_PARTNER;
  else if (animBattler === K.ANIM_TARGET) animBattler = K.ANIM_DEF_PARTNER;
  const battlerId = animBattler === K.ANIM_ATTACKER || animBattler === K.ANIM_ATK_PARTNER ? anim.attacker : anim.target;
  return { animBattler, battlerId };
}

const isToBg2 = (battlerId: number) => {
  const position = getBattlerPosition(battlerId);
  return !(position === K.B_POSITION_OPPONENT_LEFT || position === K.B_POSITION_PLAYER_RIGHT);
};

function startMonBg(battlerId: number, slot: number): void {
  const toBG_2 = isToBg2(battlerId);
  MoveBattlerSpriteToBG(battlerId, toBG_2);
  const spriteId = g.battlerSpriteIds[battlerId];
  const taskId = CreateTask(Task_InitUpdateMonBg, 10);
  const d = gTasks[taskId].data;
  d[0] = spriteId;
  d[1] = gSprites[spriteId].x + gSprites[spriteId].x2;
  d[2] = gSprites[spriteId].y + gSprites[spriteId].y2;
  d[3] = toBG_2 ? g.battle_BG2_X : g.battle_BG1_X;
  d[4] = toBG_2 ? g.battle_BG2_Y : g.battle_BG1_Y;
  d[5] = +toBG_2;
  d[6] = battlerId;
  sMonAnimTaskIdArray[slot] = taskId;
}

function Cmd_monbg(): void {
  const { animBattler, battlerId } = monBgBattler(read8(sBattleAnimScriptPtr + 1));
  // Move the designated battler (and with the partner variants, its partner) to an anim BG.
  if (IsBattlerSpriteVisible(battlerId)) startMonBg(battlerId, 0);
  const partner = battlerId ^ K.BIT_FLANK;
  if (animBattler > K.ANIM_TARGET && IsBattlerSpriteVisible(partner)) startMonBg(partner, 1);
  sBattleAnimScriptPtr += 2;
}

/** MoveBattlerSpriteToBG: draws the battler's frame on BG1 (toBG_2 FALSE) or BG2 and hides the sprite */
export function MoveBattlerSpriteToBG(battlerId: number, toBG_2: boolean): void {
  const spriteId = g.battlerSpriteIds[battlerId];
  const sprite = gSprites[spriteId];
  if (!toBG_2) {
    vram.fill(0, BG_SCREEN_ADDR(8), BG_SCREEN_ADDR(8) + 0x2000);
    vram.fill(0, BG_SCREEN_ADDR(28), BG_SCREEN_ADDR(28) + 0x1000);
    const animBg = GetBattleAnimBg1Data();
    animBg.bgTiles.fill(0, 0, 0x1000);
    animBg.bgTilemap.fill(0, 0, 0x400);
    SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 2);
    SetAnimBgAttribute(1, K.BG_ANIM_SCREEN_SIZE, 1);
    SetAnimBgAttribute(1, K.BG_ANIM_AREA_OVERFLOW_MODE, 0);
    g.battle_BG1_X = -(sprite.x + sprite.x2) + 0x20;
    g.battle_BG1_Y = -(sprite.y + sprite.y2) + 0x20;
    sprite.invisible = true;
    SetGpuReg(REG_OFFSET_BG1HOFS, g.battle_BG1_X);
    SetGpuReg(REG_OFFSET_BG1VOFS, g.battle_BG1_Y);
    copyBattlerPalToBg(battlerId, animBg.paletteId);
    CopyBattlerSpriteToBg(1, 0, 0, getBattlerPosition(battlerId), animBg.paletteId, animBg.bgTiles, animBg.bgTilemap, 0x200);
  } else {
    vram.fill(0, BG_SCREEN_ADDR(12), BG_SCREEN_ADDR(12) + 0x2000);
    vram.fill(0, BG_SCREEN_ADDR(30), BG_SCREEN_ADDR(30) + 0x1000);
    const animBg = GetBattleAnimBgData(2);
    animBg.bgTiles.fill(0, 0x1000, 0x2000);
    animBg.bgTilemap.fill(0, 0x400, 0x800);
    SetAnimBgAttribute(2, K.BG_ANIM_PRIORITY, 2);
    SetAnimBgAttribute(2, K.BG_ANIM_SCREEN_SIZE, 1);
    SetAnimBgAttribute(2, K.BG_ANIM_AREA_OVERFLOW_MODE, 0);
    g.battle_BG2_X = -(sprite.x + sprite.x2) + 0x20;
    g.battle_BG2_Y = -(sprite.y + sprite.y2) + 0x20;
    sprite.invisible = true;
    SetGpuReg(REG_OFFSET_BG2HOFS, g.battle_BG2_X);
    SetGpuReg(REG_OFFSET_BG2VOFS, g.battle_BG2_Y);
    copyBattlerPalToBg(battlerId, 9);
    CopyBattlerSpriteToBg(2, 0, 0, getBattlerPosition(battlerId), animBg.paletteId, animBg.bgTiles.subarray(0x1000), animBg.bgTilemap.subarray(0x400), 0x300);
  }
}

/** LoadPalette + CpuCopy32 to BG_PLTT: the battler's palette into BG palette `paletteId` */
function copyBattlerPalToBg(battlerId: number, paletteId: number): void {
  const src = gPlttBufferUnfaded.subarray(OBJ_PLTT_ID(battlerId), OBJ_PLTT_ID(battlerId) + 16);
  LoadPalette(src, BG_PLTT_ID(paletteId), PLTT_SIZE_4BPP);
  pltt.set(src, paletteId * 16);
}

/** ResetBattleAnimBg */
export function ResetBattleAnimBg(toBG2: boolean): void {
  if (!toBG2) {
    InitBattleAnimBg(1);
    g.battle_BG1_X = 0;
    g.battle_BG1_Y = 0;
  } else {
    InitBattleAnimBg(2);
    g.battle_BG2_X = 0;
    g.battle_BG2_Y = 0;
  }
}

/** Task_InitUpdateMonBg: keeps the BG copy following the battler sprite and its faded palette */
const Task_InitUpdateMonBg: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const spriteId = d[0];
  const palIndex = d[6];
  const animBg = GetBattleAnimBg1Data();
  const x = d[1] - (gSprites[spriteId].x + gSprites[spriteId].x2);
  const y = d[2] - (gSprites[spriteId].y + gSprites[spriteId].y2);
  const src = OBJ_PLTT_ID(palIndex);
  if (d[5] === 0) {
    g.battle_BG1_X = x + d[3];
    g.battle_BG1_Y = y + d[4];
    gPlttBufferFaded.copyWithin(BG_PLTT_ID(animBg.paletteId), src, src + 16);
  } else {
    g.battle_BG2_X = x + d[3];
    g.battle_BG2_Y = y + d[4];
    gPlttBufferFaded.copyWithin(BG_PLTT_ID(9), src, src + 16);
  }
};

function Cmd_clearmonbg(): void {
  let { animBattler, battlerId } = monBgBattler(read8(sBattleAnimScriptPtr + 1));
  if (sMonAnimTaskIdArray[0] !== TASK_NONE) gSprites[g.battlerSpriteIds[battlerId]].invisible = false;
  if (animBattler > K.ANIM_TARGET && sMonAnimTaskIdArray[1] !== TASK_NONE) gSprites[g.battlerSpriteIds[battlerId ^ K.BIT_FLANK]].invisible = false;
  else animBattler = K.ANIM_ATTACKER;
  const taskId = CreateTask(Task_ClearMonBg, 5);
  gTasks[taskId].data[0] = animBattler;
  gTasks[taskId].data[2] = battlerId;
  sBattleAnimScriptPtr += 2;
}

const Task_ClearMonBg: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[1]++;
  if (d[1] !== 1) {
    const toBG_2 = isToBg2(d[2] & 0xff);
    if (sMonAnimTaskIdArray[0] !== TASK_NONE) {
      ResetBattleAnimBg(toBG_2);
      DestroyTask(sMonAnimTaskIdArray[0]);
      sMonAnimTaskIdArray[0] = TASK_NONE;
    }
    if (d[0] > 1) {
      ResetBattleAnimBg(!toBG_2);
      DestroyTask(sMonAnimTaskIdArray[1]);
      sMonAnimTaskIdArray[1] = TASK_NONE;
    }
    DestroyTask(taskId);
  }
};

/** Cmd_monbg_static: Cmd_monbg without the tasks that follow the sprite */
function Cmd_monbg_static(): void {
  const { animBattler, battlerId } = monBgBattler(read8(sBattleAnimScriptPtr + 1));
  if (IsBattlerSpriteVisible(battlerId)) {
    MoveBattlerSpriteToBG(battlerId, isToBg2(battlerId));
    gSprites[g.battlerSpriteIds[battlerId]].invisible = false;
  }
  const partner = battlerId ^ K.BIT_FLANK;
  if (animBattler > K.ANIM_TARGET && IsBattlerSpriteVisible(partner)) {
    MoveBattlerSpriteToBG(partner, isToBg2(partner));
    gSprites[g.battlerSpriteIds[partner]].invisible = false;
  }
  sBattleAnimScriptPtr += 2;
}

function Cmd_clearmonbg_static(): void {
  let { animBattler, battlerId } = monBgBattler(read8(sBattleAnimScriptPtr + 1));
  if (IsBattlerSpriteVisible(battlerId)) gSprites[g.battlerSpriteIds[battlerId]].invisible = false;
  if (animBattler > K.ANIM_TARGET && IsBattlerSpriteVisible(battlerId ^ K.BIT_FLANK)) gSprites[g.battlerSpriteIds[battlerId ^ K.BIT_FLANK]].invisible = false;
  else animBattler = K.ANIM_ATTACKER;
  const taskId = CreateTask(Task_ClearMonBgStatic, 5);
  gTasks[taskId].data[0] = animBattler;
  gTasks[taskId].data[2] = battlerId;
  sBattleAnimScriptPtr += 2;
}

const Task_ClearMonBgStatic: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[1]++;
  if (d[1] !== 1) {
    const battlerId = d[2] & 0xff;
    const toBG_2 = isToBg2(battlerId);
    if (IsBattlerSpriteVisible(battlerId)) ResetBattleAnimBg(toBG_2);
    if (d[0] > 1 && IsBattlerSpriteVisible(battlerId ^ K.BIT_FLANK)) ResetBattleAnimBg(!toBG_2);
    DestroyTask(taskId);
  }
};

function Cmd_setalpha(): void {
  const eva = read8(sBattleAnimScriptPtr + 1);
  const evb = read8(sBattleAnimScriptPtr + 2) << 8;
  sBattleAnimScriptPtr += 3;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, eva | evb);
}

function Cmd_setbldcnt(): void {
  SetGpuReg(REG_OFFSET_BLDCNT, read16(sBattleAnimScriptPtr + 1));
  sBattleAnimScriptPtr += 3;
}

function Cmd_blendoff(): void {
  sBattleAnimScriptPtr++;
  SetGpuReg(REG_OFFSET_BLDCNT, 0);
  SetGpuReg(REG_OFFSET_BLDALPHA, 0);
}

function Cmd_call(): void {
  sBattleAnimScriptRetAddr = sBattleAnimScriptPtr + 5;
  sBattleAnimScriptPtr = read32(sBattleAnimScriptPtr + 1);
}

function Cmd_return(): void {
  sBattleAnimScriptPtr = sBattleAnimScriptRetAddr;
}

function Cmd_setarg(): void {
  const argId = read8(sBattleAnimScriptPtr + 1);
  gBattleAnimArgs[argId] = read16(sBattleAnimScriptPtr + 2);
  sBattleAnimScriptPtr += 4;
}

function Cmd_choosetwoturnanim(): void {
  sBattleAnimScriptPtr = read32(sBattleAnimScriptPtr + 1 + (anim.moveTurn & 1 ? 4 : 0));
}

function Cmd_jumpifmoveturn(): void {
  const toCheck = read8(sBattleAnimScriptPtr + 1);
  sBattleAnimScriptPtr = toCheck === anim.moveTurn ? read32(sBattleAnimScriptPtr + 2) : sBattleAnimScriptPtr + 6;
}

function Cmd_goto(): void {
  sBattleAnimScriptPtr = read32(sBattleAnimScriptPtr + 1);
}

/** IsContest: FALSE in FRLG */
export function IsContest(): boolean {
  return false;
}

// Task_FadeToBg: data[0] background id, data[10] state
function Cmd_fadetobg(): void {
  const taskId = CreateTask(Task_FadeToBg, 5);
  gTasks[taskId].data[0] = read8(sBattleAnimScriptPtr + 1);
  sBattleAnimScriptPtr += 2;
  sAnimBackgroundFadeState = 1;
}

function Cmd_fadetobgfromset(): void {
  const bg1 = read8(sBattleAnimScriptPtr + 1);
  const bg2 = read8(sBattleAnimScriptPtr + 2);
  sBattleAnimScriptPtr += 4;
  const taskId = CreateTask(Task_FadeToBg, 5);
  gTasks[taskId].data[0] = getBattlerSide(anim.target) === K.B_SIDE_PLAYER ? bg2 : bg1;
  sAnimBackgroundFadeState = 1;
}

const Task_FadeToBg: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[10] === 0) {
    BeginHardwarePaletteFade(0xe8, 0, 0, 16, 0);
    d[10]++;
    return;
  }
  if (gPaletteFade.active) return;
  if (d[10] === 1) {
    d[10]++;
    sAnimBackgroundFadeState = 2;
  } else if (d[10] === 2) {
    if (d[0] === -1) LoadDefaultBg();
    else LoadMoveBg(d[0]);
    BeginHardwarePaletteFade(0xe8, 0, 16, 0, 1);
    d[10]++;
    return;
  }
  if (gPaletteFade.active) return;
  if (d[10] === 3) {
    DestroyTask(taskId);
    sAnimBackgroundFadeState = 0;
  }
};

function LoadMoveBg(bgId: number): void {
  const bg = bdata.animScripts.backgrounds[bgId]!;
  LZDecompressVram(gfx(bg.tilemap), BG_SCREEN_ADDR(26));
  LZDecompressVram(gfx(bg.image), BG_CHAR_ADDR(2));
  LoadCompressedPalette(gfx16(bg.palette), BG_PLTT_ID(2), PLTT_SIZE_4BPP);
}

function LoadDefaultBg(): void {
  DrawMainBattleBackground();
}

function Cmd_restorebg(): void {
  sBattleAnimScriptPtr++;
  const taskId = CreateTask(Task_FadeToBg, 5);
  gTasks[taskId].data[0] = -1;
  sAnimBackgroundFadeState = 1;
}

function Cmd_waitbgfadeout(): void {
  if (sAnimBackgroundFadeState === 2) {
    sBattleAnimScriptPtr++;
    sAnimFramesToWait = 0;
  } else {
    sAnimFramesToWait = 1;
  }
}

function Cmd_waitbgfadein(): void {
  if (sAnimBackgroundFadeState === 0) {
    sBattleAnimScriptPtr++;
    sAnimFramesToWait = 0;
  } else {
    sAnimFramesToWait = 1;
  }
}

function Cmd_changebg(): void {
  LoadMoveBg(read8(sBattleAnimScriptPtr + 1));
  sBattleAnimScriptPtr += 2;
}

/** BattleAnimAdjustPanning */
export function BattleAnimAdjustPanning(pan: number): number {
  const TARGET = K.SOUND_PAN_TARGET;
  const ATTACKER = K.SOUND_PAN_ATTACKER;
  if (g.battleSpritesDataPtr.healthBoxesData[anim.attacker].statusAnimActive) {
    pan = getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER ? TARGET : ATTACKER;
  } else if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) {
      if (pan === TARGET) pan = ATTACKER;
      else if (pan !== ATTACKER) pan = s8(-pan);
    }
  } else if (getBattlerSide(anim.target) === K.B_SIDE_OPPONENT) {
    if (pan === ATTACKER) pan = TARGET;
  } else {
    pan = s8(-pan);
  }
  if (pan > TARGET) pan = TARGET;
  else if (pan < ATTACKER) pan = ATTACKER;
  return pan;
}

/** BattleAnimAdjustPanning2 */
export function BattleAnimAdjustPanning2(pan: number): number {
  if (g.battleSpritesDataPtr.healthBoxesData[anim.attacker].statusAnimActive) return getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER ? K.SOUND_PAN_TARGET : K.SOUND_PAN_ATTACKER;
  return getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER ? s8(-pan) : pan;
}

/** KeepPanInRange */
export function KeepPanInRange(pan: number, _oldPan: number): number {
  return Math.max(K.SOUND_PAN_ATTACKER, Math.min(K.SOUND_PAN_TARGET, pan));
}

/** CalculatePanIncrement */
export function CalculatePanIncrement(sourcePan: number, targetPan: number, incrementPan: number): number {
  if (sourcePan < targetPan) return Math.abs(incrementPan);
  if (sourcePan > targetPan) return -Math.abs(incrementPan);
  return 0;
}

/** PlaySE12WithPanning (no audio yet) */
export function PlaySE12WithPanning(songId: number, _pan: number): void {
  ui.playSE(songId);
}

function Cmd_playsewithpan(): void {
  const songId = read16(sBattleAnimScriptPtr + 1);
  PlaySE12WithPanning(songId, BattleAnimAdjustPanning(s8(read8(sBattleAnimScriptPtr + 3))));
  sBattleAnimScriptPtr += 4;
}

function Cmd_setpan(): void {
  // SE12PanpotControl(BattleAnimAdjustPanning(pan)): no audio yet
  sBattleAnimScriptPtr += 2;
}

// Task_PanFromInitialToTarget: [0] initial, [1] target, [2] increment, [3] frames to wait, [4] current, [8] counter
function startPanTask(songId: number, currentPan: number, targetPan: number, incrementPan: number, framesToWait: number): void {
  const taskId = CreateTask(Task_PanFromInitialToTarget, 1);
  const d = gTasks[taskId].data;
  d[0] = currentPan;
  d[1] = targetPan;
  d[2] = incrementPan;
  d[3] = framesToWait;
  d[4] = currentPan;
  PlaySE12WithPanning(songId, currentPan);
  anim.soundTaskCount = (anim.soundTaskCount + 1) & 0xff;
  sBattleAnimScriptPtr += 7;
}

function Cmd_panse(): void {
  const p = sBattleAnimScriptPtr;
  const currentPan = BattleAnimAdjustPanning(s8(read8(p + 3)));
  const targetPan = BattleAnimAdjustPanning(s8(read8(p + 4)));
  startPanTask(read16(p + 1), currentPan, targetPan, CalculatePanIncrement(currentPan, targetPan, s8(read8(p + 5))), read8(p + 6));
}

function Cmd_panse_adjustnone(): void {
  const p = sBattleAnimScriptPtr;
  startPanTask(read16(p + 1), s8(read8(p + 3)), s8(read8(p + 4)), s8(read8(p + 5)), read8(p + 6));
}

function Cmd_panse_adjustall(): void {
  const p = sBattleAnimScriptPtr;
  startPanTask(read16(p + 1), BattleAnimAdjustPanning2(s8(read8(p + 3))), BattleAnimAdjustPanning2(s8(read8(p + 4))), BattleAnimAdjustPanning2(s8(read8(p + 5))), read8(p + 6));
}

const Task_PanFromInitialToTarget: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[8]++ >= d[3]) {
    d[8] = 0;
    const pan = d[4] + d[2];
    d[4] = pan;
    let destroy = false;
    if (d[2] === 0) destroy = true;
    else if (d[0] < d[1]) destroy = pan >= d[1];
    else destroy = pan <= d[1];
    if (destroy) {
      DestroyTask(taskId);
      anim.soundTaskCount = (anim.soundTaskCount - 1) & 0xff;
    }
    // SE12PanpotControl(pan): no audio yet
  }
};

// Task_LoopAndPlaySE: [0] song, [1] pan, [2] frames to wait, [3] plays left, [8] counter
function Cmd_loopsewithpan(): void {
  const p = sBattleAnimScriptPtr;
  const taskId = CreateTask(Task_LoopAndPlaySE, 1);
  const d = gTasks[taskId].data;
  d[0] = read16(p + 1);
  d[1] = BattleAnimAdjustPanning(s8(read8(p + 3)));
  d[2] = read8(p + 4);
  d[3] = read8(p + 5);
  d[8] = d[2];
  gTasks[taskId].func(taskId);
  anim.soundTaskCount = (anim.soundTaskCount + 1) & 0xff;
  sBattleAnimScriptPtr += 6;
}

const Task_LoopAndPlaySE: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[8]++ >= d[2]) {
    d[8] = 0;
    const plays = --d[3] & 0xff;
    PlaySE12WithPanning(d[0] & 0xffff, d[1]);
    if (plays === 0) {
      DestroyTask(taskId);
      anim.soundTaskCount = (anim.soundTaskCount - 1) & 0xff;
    }
  }
};

// Task_WaitAndPlaySE: [0] song, [1] pan, [2] frames to wait
function Cmd_waitplaysewithpan(): void {
  const p = sBattleAnimScriptPtr;
  const taskId = CreateTask(Task_WaitAndPlaySE, 1);
  const d = gTasks[taskId].data;
  d[0] = read16(p + 1);
  d[1] = BattleAnimAdjustPanning(s8(read8(p + 3)));
  d[2] = read8(p + 4);
  anim.soundTaskCount = (anim.soundTaskCount + 1) & 0xff;
  sBattleAnimScriptPtr += 5;
}

const Task_WaitAndPlaySE: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[2]-- <= 0) {
    PlaySE12WithPanning(d[0] & 0xffff, d[1]);
    DestroyTask(taskId);
    anim.soundTaskCount = (anim.soundTaskCount - 1) & 0xff;
  }
};

function Cmd_createsoundtask(): void {
  const func = taskFuncByName(externName(read32(sBattleAnimScriptPtr + 1)))!;
  const numArgs = read8(sBattleAnimScriptPtr + 5);
  sBattleAnimScriptPtr += 6;
  for (let i = 0; i < numArgs; i++) {
    gBattleAnimArgs[i] = read16(sBattleAnimScriptPtr);
    sBattleAnimScriptPtr += 2;
  }
  const taskId = CreateTask(func, 1);
  func(taskId);
  anim.soundTaskCount = (anim.soundTaskCount + 1) & 0xff;
}

function Cmd_waitsound(): void {
  if (anim.soundTaskCount !== 0) {
    sAnimFramesToWait = 1;
  } else {
    // IsSEPlaying() is always FALSE without audio
    sBattleAnimScriptPtr++;
    sAnimFramesToWait = 0;
  }
}

function Cmd_jumpargeq(): void {
  const argId = read8(sBattleAnimScriptPtr + 1);
  const valueToCheck = (read16(sBattleAnimScriptPtr + 2) << 16) >> 16;
  sBattleAnimScriptPtr = valueToCheck === gBattleAnimArgs[argId] ? read32(sBattleAnimScriptPtr + 4) : sBattleAnimScriptPtr + 8;
}

function Cmd_jumpifcontest(): void {
  sBattleAnimScriptPtr += 5;
}

function splitBgPrio(battlerId: number): void {
  // Only when the battler is the lead (on the left from its team's perspective)
  const position = getBattlerPosition(battlerId);
  if (position === K.B_POSITION_PLAYER_LEFT || position === K.B_POSITION_OPPONENT_RIGHT) {
    SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
    SetAnimBgAttribute(2, K.BG_ANIM_PRIORITY, 2);
  }
}

function Cmd_splitbgprio(): void {
  const wanted = read8(sBattleAnimScriptPtr + 1);
  sBattleAnimScriptPtr += 2;
  splitBgPrio(wanted !== K.ANIM_ATTACKER ? anim.target : anim.attacker);
}

function Cmd_splitbgprio_all(): void {
  sBattleAnimScriptPtr++;
  SetAnimBgAttribute(1, K.BG_ANIM_PRIORITY, 1);
  SetAnimBgAttribute(2, K.BG_ANIM_PRIORITY, 2);
}

function Cmd_splitbgprio_foes(): void {
  const wanted = read8(sBattleAnimScriptPtr + 1);
  sBattleAnimScriptPtr += 2;
  if (getBattlerSide(anim.attacker) !== getBattlerSide(anim.target)) splitBgPrio(wanted !== K.ANIM_ATTACKER ? anim.target : anim.attacker);
}

function Cmd_invisible(): void {
  const spriteId = GetAnimBattlerSpriteId(read8(sBattleAnimScriptPtr + 1));
  if (spriteId !== SPRITE_NONE) gSprites[spriteId].invisible = true;
  sBattleAnimScriptPtr += 2;
}

function Cmd_visible(): void {
  const spriteId = GetAnimBattlerSpriteId(read8(sBattleAnimScriptPtr + 1));
  if (spriteId !== SPRITE_NONE) gSprites[spriteId].invisible = false;
  sBattleAnimScriptPtr += 2;
}

// The two teamattack commands are never used by a script.
function Cmd_teamattack_moveback(): void {
  const wanted = read8(sBattleAnimScriptPtr + 1);
  sBattleAnimScriptPtr += 2;
  if (IsDoubleBattle() && getBattlerSide(anim.attacker) === getBattlerSide(anim.target)) {
    const battler = wanted === K.ANIM_ATTACKER ? anim.attacker : anim.target;
    const priority = GetBattlerSpriteBGPriorityRank(battler);
    const spriteId = GetAnimBattlerSpriteId(wanted === K.ANIM_ATTACKER ? K.ANIM_ATTACKER : K.ANIM_TARGET);
    if (spriteId !== SPRITE_NONE) {
      gSprites[spriteId].invisible = false;
      if (priority === 2) gSprites[spriteId].oam.priority = 3;
      ResetBattleAnimBg(priority !== 1);
    }
  }
}

function Cmd_teamattack_movefwd(): void {
  const wanted = read8(sBattleAnimScriptPtr + 1);
  sBattleAnimScriptPtr += 2;
  if (IsDoubleBattle() && getBattlerSide(anim.attacker) === getBattlerSide(anim.target)) {
    const battler = wanted === K.ANIM_ATTACKER ? anim.attacker : anim.target;
    const priority = GetBattlerSpriteBGPriorityRank(battler);
    const spriteId = GetAnimBattlerSpriteId(wanted === K.ANIM_ATTACKER ? K.ANIM_ATTACKER : K.ANIM_TARGET);
    if (spriteId !== SPRITE_NONE && priority === 2) gSprites[spriteId].oam.priority = 2;
  }
}

function Cmd_stopsound(): void {
  // m4aMPlayStop(&gMPlayInfo_SE1 / SE2): no audio yet
  sBattleAnimScriptPtr++;
}

const sScriptCmdTable: (() => void)[] = [
  Cmd_loadspritegfx, // 0x00
  Cmd_unloadspritegfx, // 0x01
  Cmd_createsprite, // 0x02
  Cmd_createvisualtask, // 0x03
  Cmd_delay, // 0x04
  Cmd_waitforvisualfinish, // 0x05
  Cmd_nop, // 0x06
  Cmd_nop, // 0x07 (nop2)
  Cmd_end, // 0x08
  Cmd_playse, // 0x09
  Cmd_monbg, // 0x0A
  Cmd_clearmonbg, // 0x0B
  Cmd_setalpha, // 0x0C
  Cmd_blendoff, // 0x0D
  Cmd_call, // 0x0E
  Cmd_return, // 0x0F
  Cmd_setarg, // 0x10
  Cmd_choosetwoturnanim, // 0x11
  Cmd_jumpifmoveturn, // 0x12
  Cmd_goto, // 0x13
  Cmd_fadetobg, // 0x14
  Cmd_restorebg, // 0x15
  Cmd_waitbgfadeout, // 0x16
  Cmd_waitbgfadein, // 0x17
  Cmd_changebg, // 0x18
  Cmd_playsewithpan, // 0x19
  Cmd_setpan, // 0x1A
  Cmd_panse, // 0x1B
  Cmd_loopsewithpan, // 0x1C
  Cmd_waitplaysewithpan, // 0x1D
  Cmd_setbldcnt, // 0x1E
  Cmd_createsoundtask, // 0x1F
  Cmd_waitsound, // 0x20
  Cmd_jumpargeq, // 0x21
  Cmd_monbg_static, // 0x22
  Cmd_clearmonbg_static, // 0x23
  Cmd_jumpifcontest, // 0x24
  Cmd_fadetobgfromset, // 0x25
  Cmd_panse_adjustnone, // 0x26
  Cmd_panse_adjustall, // 0x27
  Cmd_splitbgprio, // 0x28
  Cmd_splitbgprio_all, // 0x29
  Cmd_splitbgprio_foes, // 0x2A
  Cmd_invisible, // 0x2B
  Cmd_visible, // 0x2C
  Cmd_teamattack_moveback, // 0x2D
  Cmd_teamattack_movefwd, // 0x2E
  Cmd_stopsound, // 0x2F
];
