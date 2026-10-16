// battle_anim_normal.c: hit splats, palette blends and colour cycles, the confusion duck, and shaking a
// battler or the battle terrain.

import { BeginNormalPaletteFade, BlendPalettes, gPaletteFade, InvertPlttBuffer } from '../../gba/palette';
import {
  gSpriteCoordOffsetX,
  gSpriteCoordOffsetY,
  gSprites,
  IndexOfSpritePaletteTag,
  setSpriteCoordOffset,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { random } from '../../util/random';
import { K } from '../constants';
import { g } from '../env';
import { Cos, Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  DestroyAnimSpriteAfterTimer,
  DestroySpriteAndMatrix,
  GetAnimBattlerSpriteId,
  GetBattlePalettesMask,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  RunStoredCallbackWhenAffineAnimEnds,
  TranslateSpriteInGrowingCircle,
  WaitAnimForDuration,
} from './animMons';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

const u16 = (v: number) => v & 0xffff;

// AnimConfusionDuck: a duck circling the mon's head. Args: x, y, initial wave offset, wave period, duration.
const AnimConfusionDuck: SpriteCallback = (sprite) => {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) {
    sprite.data[1] = -gBattleAnimArgs[3];
    sprite.data[4] = 1;
  } else {
    sprite.data[1] = gBattleAnimArgs[3];
    sprite.data[4] = 0;
    StartSpriteAnim(sprite, 1);
  }
  sprite.data[3] = gBattleAnimArgs[4];
  sprite.callback = AnimConfusionDuck_Step;
  sprite.callback(sprite);
};

function AnimConfusionDuck_Step(sprite: Sprite): void {
  sprite.x2 = Cos(sprite.data[0], 30);
  sprite.y2 = Sin(sprite.data[0], 10);
  sprite.oam.priority = u16(sprite.data[0]) < 128 ? 1 : 3;
  sprite.data[0] = (sprite.data[0] + sprite.data[1]) & 0xff;
  if (++sprite.data[2] === sprite.data[3]) DestroyAnimSprite(sprite);
}

/**
 * UnpackSelectedBattlePalettes: bits 0-6 = F_PAL_BG, F_PAL_ATTACKER, F_PAL_TARGET, F_PAL_ATK_PARTNER,
 * F_PAL_DEF_PARTNER, F_PAL_ANIM_1, F_PAL_ANIM_2.
 */
export function UnpackSelectedBattlePalettes(selector: number): number {
  return GetBattlePalettesMask(!!(selector & 1), !!((selector >> 1) & 1), !!((selector >> 2) & 1), !!((selector >> 3) & 1), !!((selector >> 4) & 1), !!((selector >> 5) & 1), !!((selector >> 6) & 1));
}

// AnimSimplePaletteBlend. Args: palette selector, delay, start, end, color.
const AnimSimplePaletteBlend: SpriteCallback = (sprite) => {
  const selected = UnpackSelectedBattlePalettes(gBattleAnimArgs[0]);
  BeginNormalPaletteFade(selected, gBattleAnimArgs[1], gBattleAnimArgs[2], gBattleAnimArgs[3], u16(gBattleAnimArgs[4]));
  sprite.invisible = true;
  sprite.callback = AnimSimplePaletteBlend_Step;
};

function AnimSimplePaletteBlend_Step(sprite: Sprite): void {
  if (!gPaletteFade.active) DestroyAnimSprite(sprite);
}

// AnimComplexPaletteBlend: alternates two blends. Args: selector, delay, count, color 1, coeff 1,
// color 2, coeff 2.
const AnimComplexPaletteBlend: SpriteCallback = (sprite) => {
  const d = sprite.data;
  d[0] = gBattleAnimArgs[1];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = gBattleAnimArgs[4];
  d[5] = gBattleAnimArgs[5];
  d[6] = gBattleAnimArgs[6];
  d[7] = gBattleAnimArgs[0];
  BlendPalettes(UnpackSelectedBattlePalettes(d[7]), gBattleAnimArgs[4], u16(gBattleAnimArgs[3]));
  sprite.invisible = true;
  sprite.callback = AnimComplexPaletteBlend_Step1;
};

function AnimComplexPaletteBlend_Step1(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] > 0) {
    d[0]--;
    return;
  }
  if (gPaletteFade.active) return;
  if (d[2] === 0) {
    sprite.callback = AnimComplexPaletteBlend_Step2;
    return;
  }
  const selected = UnpackSelectedBattlePalettes(d[7]);
  if (d[1] & 0x100) BlendPalettes(selected, d[4], u16(d[3]));
  else BlendPalettes(selected, d[6], u16(d[5]));
  d[1] ^= 0x100;
  d[0] = d[1] & 0xff;
  d[2]--;
}

function AnimComplexPaletteBlend_Step2(sprite: Sprite): void {
  if (!gPaletteFade.active) {
    BlendPalettes(UnpackSelectedBattlePalettes(sprite.data[7]), 0, 0);
    DestroyAnimSprite(sprite);
  }
}

/** AnimCirclingSparkle (unused template) */
const AnimCirclingSparkle: SpriteCallback = (sprite) => {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = 0;
  sprite.data[1] = 10;
  sprite.data[2] = 8;
  sprite.data[3] = 40;
  sprite.data[4] = 112;
  sprite.data[5] = 0;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = TranslateSpriteInGrowingCircle;
  sprite.callback(sprite);
};

// AnimTask_BlendColorCycle and variants: data[0] selector (or tag), [1] delay, [2] blends left,
// [3] initial coeff, [4] target coeff, [5] color, [8] restoring, [9]/[10] palette mask (Exclude).
// Blends to the color and back, tNumBlends times in total.
type PaletteMask = (taskId: number) => number;

function cycleTask(mask: PaletteMask): { start: TaskFunc; loop: TaskFunc } {
  const blend = (taskId: number, startAmount: number, targetAmount: number) => {
    const d = gTasks[taskId].data;
    BeginNormalPaletteFade(mask(taskId), d[1], startAmount & 0xff, targetAmount & 0xff, u16(d[5]));
    d[2]--;
    d[8] ^= 1;
  };
  const loop: TaskFunc = (taskId) => {
    const d = gTasks[taskId].data;
    if (gPaletteFade.active) return;
    if (d[2] > 0) {
      let start = !d[8] ? d[3] : d[4];
      let target = !d[8] ? d[4] : d[3];
      if (d[2] === 1) target = 0;
      start &= 0xff;
      blend(taskId, start, target);
    } else {
      DestroyAnimVisualTask(taskId);
    }
  };
  const start: TaskFunc = (taskId) => {
    const d = gTasks[taskId].data;
    d[0] = gBattleAnimArgs[0];
    d[1] = gBattleAnimArgs[1];
    d[2] = gBattleAnimArgs[2];
    d[3] = gBattleAnimArgs[3];
    d[4] = gBattleAnimArgs[4];
    d[5] = gBattleAnimArgs[5];
    d[8] = 0;
    if (mask === excludeMask) {
      let selected = 0;
      for (let b = 0; b < g.battlersCount; b++) if (b !== anim.attacker && b !== anim.target) selected |= 1 << (b + 16);
      if (gBattleAnimArgs[0] === 1) selected |= 0xe;
      d[9] = selected >>> 16;
      d[10] = selected & 0xff;
    }
    blend(taskId, 0, d[4]);
    gTasks[taskId].func = loop;
  };
  return { start, loop };
}

const selectorMask: PaletteMask = (taskId) => UnpackSelectedBattlePalettes(gTasks[taskId].data[0]);
const excludeMask: PaletteMask = (taskId) => ((u16(gTasks[taskId].data[9]) << 16) | u16(gTasks[taskId].data[10])) >>> 0;
const tagMask: PaletteMask = (taskId) => (1 << (IndexOfSpritePaletteTag(u16(gTasks[taskId].data[0])) + 16)) >>> 0;

/** AnimTask_BlendColorCycle */
const AnimTask_BlendColorCycle = cycleTask(selectorMask).start;
/** AnimTask_BlendColorCycleExclude: all battlers but the attacker and target (and the BG if arg 0 is 1) */
const AnimTask_BlendColorCycleExclude = cycleTask(excludeMask).start;
/** AnimTask_BlendColorCycleByTag: by ANIM_TAG */
const AnimTask_BlendColorCycleByTag = cycleTask(tagMask).start;

// AnimTask_FlashAnimTagWithColor (Hyper Beam's particles). Args: tag, delay, count, color 1, coeff 1,
// color 2, coeff 2.
const AnimTask_FlashAnimTagWithColor: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[1];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[4] = gBattleAnimArgs[4];
  d[5] = gBattleAnimArgs[5];
  d[6] = gBattleAnimArgs[6];
  d[7] = gBattleAnimArgs[0];
  const paletteIndex = IndexOfSpritePaletteTag(u16(gBattleAnimArgs[0]));
  BeginNormalPaletteFade((1 << (paletteIndex + 16)) >>> 0, 0, gBattleAnimArgs[4], gBattleAnimArgs[4], u16(gBattleAnimArgs[3]));
  gTasks[taskId].func = AnimTask_FlashAnimTagWithColor_Step1;
};

const AnimTask_FlashAnimTagWithColor_Step1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[0] > 0) {
    d[0]--;
    return;
  }
  if (gPaletteFade.active) return;
  if (d[2] === 0) {
    gTasks[taskId].func = AnimTask_FlashAnimTagWithColor_Step2;
    return;
  }
  const selected = (1 << (IndexOfSpritePaletteTag(u16(d[7])) + 16)) >>> 0;
  if (d[1] & 0x100) BeginNormalPaletteFade(selected, 0, d[4], d[4], u16(d[3]));
  else BeginNormalPaletteFade(selected, 0, d[6], d[6], u16(d[5]));
  d[1] ^= 0x100;
  d[0] = d[1] & 0xff;
  d[2]--;
};

const AnimTask_FlashAnimTagWithColor_Step2: TaskFunc = (taskId) => {
  if (!gPaletteFade.active) {
    BeginNormalPaletteFade((1 << (IndexOfSpritePaletteTag(u16(gTasks[taskId].data[7])) + 16)) >>> 0, 0, 0, 0, 0);
    DestroyAnimVisualTask(taskId);
  }
};

/** AnimTask_InvertScreenColor. Args: BG, attacker, target (each selected when bit 8 is set). */
const AnimTask_InvertScreenColor: TaskFunc = (taskId) => {
  let selected = 0;
  if (gBattleAnimArgs[0] & 0x100) selected = GetBattlePalettesMask(true, false, false, false, false, false, false);
  if (gBattleAnimArgs[1] & 0x100) selected |= 0x10000 << anim.attacker;
  if (gBattleAnimArgs[2] & 0x100) selected |= 0x10000 << anim.target;
  InvertPlttBuffer(selected >>> 0);
  DestroyAnimVisualTask(taskId);
};

// AnimShakeMonOrBattleTerrain: shakes gBattle_BG3_X/Y or the sprite coord offset (which moves the
// battlers that have coordOffsetEnabled). Args: amplitude, delay, duration, what (0-3), battlers.
// The C keeps a pointer to the shaken variable in data[6..7]; here sprite.ref holds an accessor.
interface ShakeTarget {
  get(): number;
  set(v: number): void;
}

const shakeTargets: ShakeTarget[] = [
  { get: () => g.battle_BG3_X, set: (v) => (g.battle_BG3_X = v) },
  { get: () => g.battle_BG3_Y, set: (v) => (g.battle_BG3_Y = v) },
  { get: () => u16(gSpriteCoordOffsetX), set: (v) => setSpriteCoordOffset((v << 16) >> 16, gSpriteCoordOffsetY) },
  { get: () => u16(gSpriteCoordOffsetY), set: (v) => setSpriteCoordOffset(gSpriteCoordOffsetX, (v << 16) >> 16) },
];

const AnimShakeMonOrBattleTerrain: SpriteCallback = (sprite) => {
  sprite.invisible = true;
  sprite.data[0] = -gBattleAnimArgs[0];
  sprite.data[1] = gBattleAnimArgs[1];
  sprite.data[2] = gBattleAnimArgs[1];
  sprite.data[3] = gBattleAnimArgs[2];
  const target = shakeTargets[gBattleAnimArgs[3] >= 0 && gBattleAnimArgs[3] <= 2 ? gBattleAnimArgs[3] : 3];
  sprite.ref = target;
  sprite.data[4] = target.get();
  sprite.data[5] = gBattleAnimArgs[3];
  if (u16(sprite.data[5] - 2) < 2) AnimShakeMonOrBattleTerrain_UpdateCoordOffsetEnabled();
  sprite.callback = AnimShakeMonOrBattleTerrain_Step;
};

function AnimShakeMonOrBattleTerrain_Step(sprite: Sprite): void {
  const d = sprite.data;
  const target = sprite.ref as ShakeTarget;
  if (d[3] > 0) {
    d[3]--;
    if (d[1] > 0) {
      d[1]--;
    } else {
      d[1] = d[2];
      target.set(u16(target.get() + d[0]));
      d[0] = -d[0];
    }
  } else {
    target.set(u16(d[4]));
    if (u16(d[5] - 2) < 2) for (let i = 0; i < g.battlersCount; i++) gSprites[g.battlerSpriteIds[i]].coordOffsetEnabled = false;
    DestroyAnimSprite(sprite);
  }
}

function AnimShakeMonOrBattleTerrain_UpdateCoordOffsetEnabled(): void {
  const atk = gSprites[g.battlerSpriteIds[anim.attacker]];
  const tgt = gSprites[g.battlerSpriteIds[anim.target]];
  atk.coordOffsetEnabled = false;
  tgt.coordOffsetEnabled = false;
  if (gBattleAnimArgs[4] === 2) {
    atk.coordOffsetEnabled = true;
    tgt.coordOffsetEnabled = true;
  } else if (gBattleAnimArgs[4] === 0) {
    atk.coordOffsetEnabled = true;
  } else {
    tgt.coordOffsetEnabled = true;
  }
}

// AnimTask_ShakeBattleTerrain: x back and forth, y down and back. Args: x, y, shakes, delay.
const AnimTask_ShakeBattleTerrain: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[0] = gBattleAnimArgs[0];
  d[1] = gBattleAnimArgs[1];
  d[2] = gBattleAnimArgs[2];
  d[3] = gBattleAnimArgs[3];
  d[8] = gBattleAnimArgs[3];
  g.battle_BG3_X = gBattleAnimArgs[0];
  g.battle_BG3_Y = gBattleAnimArgs[1];
  gTasks[taskId].func = AnimTask_ShakeBattleTerrain_Step;
  gTasks[taskId].func(taskId);
};

const AnimTask_ShakeBattleTerrain_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  if (d[3] === 0) {
    // gBattle_BG3_X/Y are u16 compared against s16 task data, like the C
    g.battle_BG3_X = g.battle_BG3_X === d[0] ? -d[0] : d[0];
    g.battle_BG3_Y = g.battle_BG3_Y === -d[1] ? 0 : -d[1];
    d[3] = d[8];
    if (--d[2] === 0) {
      g.battle_BG3_X = 0;
      g.battle_BG3_Y = 0;
      DestroyAnimVisualTask(taskId);
    }
  } else {
    d[3]--;
  }
};

// Hit splats. Args: x, y, 0 attacker / 1 target, affine anim (size).
const AnimHitSplatBasic: SpriteCallback = (sprite) => {
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[3]);
  if (gBattleAnimArgs[2] === 0) InitSpritePosToAnimAttacker(sprite, true);
  else InitSpritePosToAnimTarget(sprite, true);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimHitSplatPersistent: arg 4 = frames to stay */
const AnimHitSplatPersistent: SpriteCallback = (sprite) => {
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[3]);
  if (gBattleAnimArgs[2] === 0) InitSpritePosToAnimAttacker(sprite, true);
  else InitSpritePosToAnimTarget(sprite, true);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSpriteAfterTimer);
};

/** AnimHitSplatHandleInvert: y mirrored when the opponent attacks (Twineedle, Spike Cannon) */
const AnimHitSplatHandleInvert: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) gBattleAnimArgs[1] = -gBattleAnimArgs[1];
  AnimHitSplatBasic(sprite);
};

/** AnimHitSplatRandom. Args: battler, affine anim (-1 = random). */
const AnimHitSplatRandom: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[1] === -1) gBattleAnimArgs[1] = random() & 3;
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[1]);
  if (gBattleAnimArgs[0] === K.ANIM_ATTACKER) InitSpritePosToAnimAttacker(sprite, false);
  else InitSpritePosToAnimTarget(sprite, false);
  sprite.x2 += (random() % 48) - 24;
  sprite.y2 += (random() % 24) - 12;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
};

/** AnimHitSplatOnMonEdge. Args: battler, x, y, affine anim. */
const AnimHitSplatOnMonEdge: SpriteCallback = (sprite) => {
  sprite.data[0] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  const mon = gSprites[sprite.data[0]];
  sprite.x = mon.x + mon.x2;
  sprite.y = mon.y + mon.y2;
  sprite.x2 = gBattleAnimArgs[1];
  sprite.y2 = gBattleAnimArgs[2];
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[3]);
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
};

/** AnimCrossImpact. Args: x, y, battler, duration. */
const AnimCrossImpact: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[2] === K.ANIM_ATTACKER) InitSpritePosToAnimAttacker(sprite, true);
  else InitSpritePosToAnimTarget(sprite, true);
  sprite.data[0] = gBattleAnimArgs[3];
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = WaitAnimForDuration;
};

/** AnimFlashingHitSplat */
const AnimFlashingHitSplat: SpriteCallback = (sprite) => {
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[3]);
  if (gBattleAnimArgs[2] === K.ANIM_ATTACKER) InitSpritePosToAnimAttacker(sprite, true);
  else InitSpritePosToAnimTarget(sprite, true);
  sprite.callback = AnimFlashingHitSplat_Step;
};

function AnimFlashingHitSplat_Step(sprite: Sprite): void {
  sprite.invisible = !sprite.invisible;
  if (sprite.data[0]++ > 12) DestroyAnimSprite(sprite);
}

export const normalSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimConfusionDuck,
  AnimSimplePaletteBlend,
  AnimComplexPaletteBlend,
  AnimCirclingSparkle,
  AnimShakeMonOrBattleTerrain,
  AnimHitSplatBasic,
  AnimHitSplatPersistent,
  AnimHitSplatHandleInvert,
  AnimHitSplatRandom,
  AnimHitSplatOnMonEdge,
  AnimCrossImpact,
  AnimFlashingHitSplat,
};

export const normalTasks: Record<string, TaskFunc> = {
  AnimTask_BlendColorCycle,
  AnimTask_BlendColorCycleExclude,
  AnimTask_BlendColorCycleByTag,
  AnimTask_FlashAnimTagWithColor,
  AnimTask_InvertScreenColor,
  AnimTask_ShakeBattleTerrain,
};
