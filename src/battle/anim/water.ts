// battle_anim_water.c: sprite callbacks and tasks, ported as the moves that use them come up.

import {
  CreateInvisibleSprite,
  DestroySprite,
  gSprites,
  SpriteCallbackDummy,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { Cos, Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  AnimTranslateLinear,
  DestroySpriteAndMatrix,
  GetBattlerSpriteCoord,
  InitAnimLinearTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  RunStoredCallbackWhenAnimEnds,
  StartAnimLinearTranslation,
  WaitAnimForDuration,
} from './animMons';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

// AnimWaterBubbleProjectile (Bubble, BubbleBeam): bubbles swaying to the target, then popping. A helper
// invisible sprite carries the wave state. Args: x, y, x amplitude, y amplitude, wave offset, wave speed, duration.
const AnimWaterBubbleProjectile: SpriteCallback = (sprite) => {
  const ax = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  const ay = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.x = isOpponent(anim.attacker) ? ax - gBattleAnimArgs[0] : ax + gBattleAnimArgs[0];
  sprite.y = ay + gBattleAnimArgs[1];
  sprite.animPaused = true;
  if (isOpponent(anim.attacker)) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  const d = sprite.data;
  d[0] = gBattleAnimArgs[6];
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  const spriteId = CreateInvisibleSprite(SpriteCallbackDummy);
  d[5] = spriteId;
  sprite.x -= Sin(gBattleAnimArgs[4] & 0xff, gBattleAnimArgs[2]);
  sprite.y -= Cos(gBattleAnimArgs[4] & 0xff, gBattleAnimArgs[3]);
  const o = gSprites[spriteId].data;
  o[0] = gBattleAnimArgs[2];
  o[1] = gBattleAnimArgs[3];
  o[2] = gBattleAnimArgs[5];
  o[3] = (gBattleAnimArgs[4] & 0xff) * 256;
  o[4] = gBattleAnimArgs[6];
  sprite.callback = AnimWaterBubbleProjectile_Step1;
  sprite.callback(sprite);
};

function AnimWaterBubbleProjectile_Step1(sprite: Sprite): void {
  const other = gSprites[sprite.data[5] & 0xff];
  let timer = other.data[4] & 0xff;
  const trigIndex = other.data[3] & 0xffff;
  sprite.data[0] = 1;
  AnimTranslateLinear(sprite);
  sprite.x2 += Sin(trigIndex >> 8, other.data[0]);
  sprite.y2 += Cos(trigIndex >> 8, other.data[1]);
  other.data[3] = trigIndex + other.data[2];
  timer = (timer - 1) & 0xff;
  if (timer !== 0) {
    other.data[4] = timer;
  } else {
    sprite.callback = AnimWaterBubbleProjectile_Step2;
    DestroySprite(other);
  }
}

function AnimWaterBubbleProjectile_Step2(sprite: Sprite): void {
  sprite.animPaused = false;
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, AnimWaterBubbleProjectile_Step3);
}

function AnimWaterBubbleProjectile_Step3(sprite: Sprite): void {
  sprite.data[0] = 10;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
}

// AnimToTargetInSinWave (Flamethrower, Hydro Pump): gBattleAnimArgs[7] is the AnimTask_StartSinAnimTimer phase.
const AnimToTargetInSinWave: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[0] = 30;
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  d[5] = Math.trunc(0xd200 / d[0]);
  d[7] = gBattleAnimArgs[3];
  const retArg = gBattleAnimArgs[7] & 0xffff;
  if (gBattleAnimArgs[7] > 127) {
    d[6] = (retArg - 127) * 256;
    d[7] = -d[7];
  } else {
    d[6] = retArg * 256;
  }
  sprite.callback = AnimToTargetInSinWave_Step;
  sprite.callback(sprite);
};

function AnimToTargetInSinWave_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (AnimTranslateLinear(sprite)) DestroyAnimSprite(sprite);
  sprite.y2 += Sin((d[6] >> 8) & 0xff, d[7]);
  if ((d[6] + d[5]) >> 8 > 127) {
    d[6] = 0;
    d[7] = -d[7];
  } else {
    d[6] += d[5];
  }
}

const AnimTask_StartSinAnimTimer: TaskFunc = (taskId) => {
  gTasks[taskId].data[0] = gBattleAnimArgs[0];
  gBattleAnimArgs[7] = 0;
  gTasks[taskId].func = AnimTask_RunSinAnimTimer;
};

const AnimTask_RunSinAnimTimer: TaskFunc = (taskId) => {
  gBattleAnimArgs[7] = (gBattleAnimArgs[7] + 3) & 0xff;
  if (--gTasks[taskId].data[0] === 0) DestroyAnimVisualTask(taskId);
};

/** AnimWaterGunDroplet: drips down from the impact. Args: x, y, target x, -, duration. */
const AnimWaterGunDroplet: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, true);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = sprite.x + gBattleAnimArgs[2];
  sprite.data[4] = sprite.y + gBattleAnimArgs[4];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimSmallBubblePair: bubbles rising and swaying. Args: x, y, duration, battler. */
const AnimSmallBubblePair: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[3] !== K.ANIM_ATTACKER) InitSpritePosToAnimTarget(sprite, true);
  else InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[7] = gBattleAnimArgs[2];
  sprite.callback = AnimSmallBubblePair_Step;
};

function AnimSmallBubblePair_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[0] = (d[0] + 11) & 0xff;
  sprite.x2 = Sin(d[0], 4);
  d[1] += 48;
  sprite.y2 = -(d[1] >> 8);
  if (d[7]-- === 0) DestroyAnimSprite(sprite);
}

export const waterSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimWaterBubbleProjectile,
  AnimToTargetInSinWave,
  AnimWaterGunDroplet,
  AnimSmallBubblePair,
};

export const waterTasks: Record<string, TaskFunc> = {
  AnimTask_StartSinAnimTimer,
};
