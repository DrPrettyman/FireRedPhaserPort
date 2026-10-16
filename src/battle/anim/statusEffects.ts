// battle_anim_status_effects.c: the frozen ice cube, AnimTask_StatsChange, and the (unused) flashing
// circle impacts. LaunchStatusAnimation lives in battleAnim.ts.

import { BLDALPHA_BLEND, BLDCNT_EFFECT_BLEND, BLDCNT_TGT2_ALL, REG_OFFSET_BLDALPHA, REG_OFFSET_BLDCNT, SetGpuReg } from '../../gba/hw';
import { gPlttBufferFaded, OBJ_PLTT_ID } from '../../gba/palette';
import {
  CreateSprite,
  DestroySprite,
  DestroySpriteAndFreeResources,
  FreeSpriteOamMatrix,
  GetSpriteTileStartByTag,
  gSprites,
  IndexOfSpritePaletteTag,
  SetSubspriteTables,
  SPRITE_SHAPE,
  type Sprite,
  type SpriteCallback,
  type SubspriteTable,
} from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { g } from '../env';
import { Cos, Sin } from '../trig';
import { GetBattlerSpriteCoord } from './animMons';
import { animSpriteTemplate } from './battleAnim';
import { anim, DestroyAnimVisualTask, gBattleAnimArgs } from './state';
import { InitStatsChangeAnimation } from './utilityFuncs';

const sub = (x: number, y: number, dim: keyof typeof SPRITE_SHAPE, tileOffset: number) => ({ x, y, shape: SPRITE_SHAPE[dim][0], size: SPRITE_SHAPE[dim][1], tileOffset, priority: 2 });

/** sFrozenIceCubeSubspriteTable */
const sFrozenIceCubeSubspriteTable: SubspriteTable[] = [
  { subspriteCount: 4, subsprites: [sub(-16, -16, '64x64', 0), sub(-16, 48, '64x32', 64), sub(48, -16, '32x64', 96), sub(48, 48, '32x32', 128)] },
];

/** AnimFlashingCircleImpact (sFlashingCircleImpactSpriteTemplate, only used by the unused Task_FlashingCircleImpacts) */
const AnimFlashingCircleImpact: SpriteCallback = (sprite) => {
  if (sprite.data[6] === 0) {
    sprite.invisible = false;
    sprite.callback = AnimFlashingCircleImpact_Step;
    sprite.callback(sprite);
  } else {
    sprite.data[6]--;
  }
};

function AnimFlashingCircleImpact_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.x2 = Cos(d[0], 32);
  sprite.y2 = Sin(d[0], 8);
  sprite.subpriority = d[0] < 128 ? 29 : 31;
  d[0] = (d[0] + 8) & 0xff;
  d[5] += d[1];
  sprite.y2 += d[5] >> 8;
  d[2]++;
  if (d[2] === 52) {
    if (d[7]) DestroySpriteAndFreeResources(sprite);
    else DestroySprite(sprite);
  }
}

/** AnimTask_FrozenIceCube: the ice cube fades in over the target, sparkles (palette rotation) and fades out */
const AnimTask_FrozenIceCube: TaskFunc = (taskId) => {
  const x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) - 32;
  const y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) - 36;
  SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_EFFECT_BLEND | BLDCNT_TGT2_ALL);
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(0, 16));
  const spriteId = CreateSprite(animSpriteTemplate('sFrozenIceCubeSpriteTemplate')!, x, y, 4);
  if (GetSpriteTileStartByTag(K.ANIM_TAG_ICE_CUBE) === 0xffff) gSprites[spriteId].invisible = true;
  SetSubspriteTables(gSprites[spriteId], sFrozenIceCubeSubspriteTable);
  gTasks[taskId].data[15] = spriteId;
  gTasks[taskId].func = AnimTask_FrozenIceCube_Step1;
};

const AnimTask_FrozenIceCube_Step1: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[1]++;
  if (d[1] === 10) {
    gTasks[taskId].func = AnimTask_FrozenIceCube_Step2;
    d[1] = 0;
  } else {
    const v = d[1] & 0xff;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(v, 16 - v));
  }
};

const AnimTask_FrozenIceCube_Step2: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const palIndex = IndexOfSpritePaletteTag(K.ANIM_TAG_ICE_CUBE);
  if (d[1]++ > 13) {
    d[2]++;
    if (d[2] === 3) {
      const p = OBJ_PLTT_ID(palIndex);
      const temp = gPlttBufferFaded[p + 13];
      gPlttBufferFaded[p + 13] = gPlttBufferFaded[p + 14];
      gPlttBufferFaded[p + 14] = gPlttBufferFaded[p + 15];
      gPlttBufferFaded[p + 15] = temp;
      d[2] = 0;
      d[3]++;
      if (d[3] === 3) {
        d[3] = 0;
        d[1] = 0;
        d[4]++;
        if (d[4] === 2) {
          d[1] = 9;
          gTasks[taskId].func = AnimTask_FrozenIceCube_Step3;
        }
      }
    }
  }
};

const AnimTask_FrozenIceCube_Step3: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[1]--;
  if (d[1] === -1) {
    gTasks[taskId].func = AnimTask_FrozenIceCube_Step4;
    d[1] = 0;
  } else {
    const v = d[1] & 0xff;
    SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(v, 16 - v));
  }
};

const AnimTask_FrozenIceCube_Step4: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  d[1]++;
  if (d[1] === 37) {
    const sprite = gSprites[d[15]];
    FreeSpriteOamMatrix(sprite);
    DestroySprite(sprite);
  } else if (d[1] === 39) {
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    SetGpuReg(REG_OFFSET_BLDALPHA, 0);
    DestroyAnimVisualTask(taskId);
  }
};

/**
 * AnimTask_StatsChange: animArg is a STAT_ANIM_* id (PLUS1/MINUS1/PLUS2/MINUS2 + stat - 1, or a
 * MULTIPLE_* one); sets up gBattleAnimArgs for InitStatsChangeAnimation.
 */
const AnimTask_StatsChange: TaskFunc = (taskId) => {
  const arg = g.battleSpritesDataPtr.animationData.animArg;
  // animStatId by STAT_ATK .. STAT_EVASION
  const statIds: Record<number, number> = { [K.STAT_ATK]: 0, [K.STAT_DEF]: 1, [K.STAT_SPEED]: 3, [K.STAT_SPATK]: 5, [K.STAT_SPDEF]: 6, [K.STAT_ACC]: 2, [K.STAT_EVASION]: 4 };
  const groups: [number, boolean, boolean][] = [
    [K.STAT_ANIM_PLUS1, false, false],
    [K.STAT_ANIM_MINUS1, true, false],
    [K.STAT_ANIM_PLUS2, false, true],
    [K.STAT_ANIM_MINUS2, true, true],
  ];
  let found: [boolean, number, boolean] | undefined;
  for (const [base, down, sharply] of groups) {
    const stat = arg - base + 1;
    if (stat in statIds) {
      found = [down, statIds[stat], sharply];
      break;
    }
  }
  if (!found) {
    if (arg === K.STAT_ANIM_MULTIPLE_PLUS1) found = [false, 0xff, false];
    else if (arg === K.STAT_ANIM_MULTIPLE_PLUS2) found = [false, 0xff, true];
    else if (arg === K.STAT_ANIM_MULTIPLE_MINUS1) found = [true, 0xff, false];
    else if (arg === K.STAT_ANIM_MULTIPLE_MINUS2) found = [true, 0xff, true];
  }
  if (!found) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  gBattleAnimArgs[0] = +found[0];
  gBattleAnimArgs[1] = found[1];
  gBattleAnimArgs[2] = 0;
  gBattleAnimArgs[3] = 0;
  gBattleAnimArgs[4] = +found[2];
  gTasks[taskId].func = InitStatsChangeAnimation;
  InitStatsChangeAnimation(taskId);
};

export const statusEffectsSpriteCallbacks: Record<string, SpriteCallback> = { AnimFlashingCircleImpact };
export const statusEffectsTasks: Record<string, TaskFunc> = { AnimTask_FrozenIceCube, AnimTask_StatsChange };
