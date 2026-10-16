// battle_anim.c's EWRAM globals, DestroyAnimSprite / DestroyAnimVisualTask / DestroyAnimSoundTask, and the
// registry that stands in for the function pointers in sprite templates and anim scripts: ported sprite
// callbacks and task functions register under their C names, and the engine looks them up by name.

import { DestroySprite, FreeSpriteOamMatrix, type Sprite, type SpriteCallback } from '../../gba/sprite';
import { DestroyTask, type TaskFunc } from '../../gba/task';
import type { DisableStruct } from '../structs';

/** ANIM_ARGS_COUNT */
export const ANIM_ARGS_COUNT = 8;
/** ARG_RET_ID: the gBattleAnimArgs slot tasks return values in */
export const ARG_RET_ID = ANIM_ARGS_COUNT - 1;

/** gBattleAnimArgs */
export const gBattleAnimArgs = new Int16Array(ANIM_ARGS_COUNT);

/** gBattleAnimBgTileBuffer / gBattleAnimBgTilemapBuffer (AllocateBattleResources) */
export const gBattleAnimBgTileBuffer = new Uint8Array(0x2000);
export const gBattleAnimBgTilemapBuffer = new Uint16Array(0x1000 / 2);

/** The other battle_anim.c globals (gBattleAnimAttacker, gAnimVisualTaskCount, ...). */
export const anim = {
  /** gBattleAnimAttacker / gBattleAnimTarget */
  attacker: 0,
  target: 0,
  /** gAnimVisualTaskCount / gAnimSoundTaskCount (u8) */
  visualTaskCount: 0,
  soundTaskCount: 0,
  /** gAnimScriptActive / gAnimScriptCallback */
  scriptActive: false,
  scriptCallback: (() => {}) as () => void,
  /** gAnimMoveTurn, gAnimMoveDmg, gAnimMovePower, gAnimFriendship, gAnimDisableStructPtr */
  moveTurn: 0,
  moveDmg: 0,
  movePower: 0,
  friendship: 0,
  disableStruct: null as DisableStruct | null,
  /** gWeatherMoveAnim */
  weatherMoveAnim: 0,
  /** gAnimBattlerSpecies */
  battlerSpecies: new Uint16Array(4),
  /** gAnimCustomPanning */
  customPanning: 0,
};

/** DestroyAnimSprite */
export function DestroyAnimSprite(sprite: Sprite): void {
  FreeSpriteOamMatrix(sprite);
  DestroySprite(sprite);
  anim.visualTaskCount = (anim.visualTaskCount - 1) & 0xff;
}

/** DestroyAnimVisualTask */
export function DestroyAnimVisualTask(taskId: number): void {
  DestroyTask(taskId);
  anim.visualTaskCount = (anim.visualTaskCount - 1) & 0xff;
}

/** DestroyAnimSoundTask */
export function DestroyAnimSoundTask(taskId: number): void {
  DestroyTask(taskId);
  anim.soundTaskCount = (anim.soundTaskCount - 1) & 0xff;
}

// ------------------------------------------------------------------ registry

const spriteCallbacks = new Map<string, SpriteCallback>();
const taskFuncs = new Map<string, TaskFunc>();

/** Ported sprite callbacks by C name (what SpriteTemplate.callback points at). */
export function registerSpriteCallbacks(fns: Record<string, SpriteCallback>): void {
  for (const [name, fn] of Object.entries(fns)) spriteCallbacks.set(name, fn);
}

/** Ported task functions by C name (createvisualtask / createsoundtask targets). */
export function registerTaskFuncs(fns: Record<string, TaskFunc>): void {
  for (const [name, fn] of Object.entries(fns)) taskFuncs.set(name, fn);
}

const extraGfx = new Map<string, string[]>();

/** Graphics a callback/task loads itself (not through loadspritegfx), by its C name: preloaded with the script. */
export function registerAnimExtraGfx(byName: Record<string, string[]>): void {
  for (const [name, syms] of Object.entries(byName)) extraGfx.set(name, syms);
}

export function animExtraGfx(name: string): string[] {
  return extraGfx.get(name) ?? [];
}

export function spriteCallbackByName(name: string): SpriteCallback | undefined {
  return spriteCallbacks.get(name);
}

export function taskFuncByName(name: string): TaskFunc | undefined {
  return taskFuncs.get(name);
}
