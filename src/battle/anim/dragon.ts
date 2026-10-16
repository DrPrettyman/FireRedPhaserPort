// battle_anim_dragon.c: sprite callbacks and tasks (the whole file).

import { REG_OFFSET_BG1HOFS, REG_OFFSET_BG2HOFS } from '../../gba/hw';
import { gScanlineEffect, gScanlineEffectRegBuffers, SCANLINE_EFFECT_DMACNT_16BIT, ScanlineEffect_SetParams } from '../../gba/scanline';
import { StartSpriteAffineAnim, StartSpriteAnim, StoreSpriteCallbackInData6, type Sprite, type SpriteCallback } from '../../gba/sprite';
import { gTasks, type Task, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { g } from '../env';
import { Cos, gSineTable, Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  DestroySpriteAndMatrix,
  GetBattlerSpriteBGPriorityRank,
  GetBattlerSpriteCoord,
  GetBattlerSpriteCoordAttr,
  GetBattlerYCoordWithElevation,
  RunStoredCallbackWhenAnimEnds,
  SetAnimSpriteInitialXOffset,
  SetSpriteCoordsToAnimAttackerCoords,
  StartAnimLinearTranslation,
  TranslateSpriteLinearAndFlicker,
} from './animMons';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

/** AnimOutrageFlame: an invisible-then-flickering flame drifting from the attacker. Args: x, y, duration, x speed, y speed, flicker interval. */
const AnimOutrageFlame: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  if (isOpponent(anim.attacker)) {
    sprite.x -= gBattleAnimArgs[0];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
    gBattleAnimArgs[4] = -gBattleAnimArgs[4];
  } else {
    sprite.x += gBattleAnimArgs[0];
  }
  sprite.y += gBattleAnimArgs[1];
  const d = sprite.data;
  d[0] = gBattleAnimArgs[2];
  d[1] = gBattleAnimArgs[3];
  d[3] = gBattleAnimArgs[4];
  d[5] = gBattleAnimArgs[5];
  sprite.invisible = true;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = TranslateSpriteLinearAndFlicker;
};

/** StartDragonFireTranslation. Args: x, y, target x, target y, duration. */
function StartDragonFireTranslation(sprite: Sprite): void {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  const d = sprite.data;
  d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  if (isOpponent(anim.attacker)) {
    // (sic: the C offsets x by arg 1 here, not arg 0)
    sprite.x -= gBattleAnimArgs[1];
    sprite.y += gBattleAnimArgs[1];
    d[2] -= gBattleAnimArgs[2];
    d[4] += gBattleAnimArgs[3];
  } else {
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    d[2] += gBattleAnimArgs[2];
    d[4] += gBattleAnimArgs[3];
    StartSpriteAnim(sprite, 1);
  }
  d[0] = gBattleAnimArgs[4];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
}

/** AnimDragonRageFirePlume: a plume on a battler's feet. Args: battler (0 attacker), x, y. */
const AnimDragonRageFirePlume: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X);
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y);
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[1]);
  sprite.y += gBattleAnimArgs[2];
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
};

/** AnimDragonFireToTarget (Dragon Breath, Dragon Rage) */
const AnimDragonFireToTarget: SpriteCallback = (sprite) => {
  if (isOpponent(anim.attacker)) StartSpriteAffineAnim(sprite, 1);
  StartDragonFireTranslation(sprite);
};

/** AnimDragonDanceOrb: orbs circling the attacker, speeding up, then flying outwards. Arg 0: start angle. */
const AnimDragonDanceOrb: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  const d = sprite.data;
  d[4] = 0;
  d[5] = 1;
  d[6] = gBattleAnimArgs[0];
  // (sic: gBattlerAttacker, not gBattleAnimAttacker)
  const height = GetBattlerSpriteCoordAttr(g.battlerAttacker, K.BATTLER_COORD_ATTR_HEIGHT);
  const width = GetBattlerSpriteCoordAttr(g.battlerAttacker, K.BATTLER_COORD_ATTR_WIDTH);
  d[7] = height > width ? height >> 1 : width >> 1;
  sprite.x2 = Cos(d[6], d[7]);
  sprite.y2 = Sin(d[6], d[7]);
  sprite.callback = AnimDragonDanceOrb_Step;
};

function AnimDragonDanceOrb_Step(sprite: Sprite): void {
  const d = sprite.data;
  const speedUp = () => {
    if (++d[4] > 5) {
      d[4] = 0;
      if (d[5] <= 15 && ++d[5] > 15) d[5] = 16;
    }
  };
  switch (d[0]) {
    case 0:
      d[6] = (d[6] - d[5]) & 0xff;
      sprite.x2 = Cos(d[6], d[7]);
      sprite.y2 = Sin(d[6], d[7]);
      speedUp();
      if (++d[3] > 60) {
        d[3] = 0;
        d[0]++;
      }
      break;
    case 1:
      d[6] = (d[6] - d[5]) & 0xff;
      if (d[7] <= 0x95 && (d[7] += 8) > 0x95) d[7] = 0x96;
      sprite.x2 = Cos(d[6], d[7]);
      sprite.y2 = Sin(d[6], d[7]);
      speedUp();
      if (++d[3] > 20) DestroyAnimSprite(sprite);
      break;
  }
}

// AnimTask_DragonDanceWaver (Dragon Dance): a sine wave of per-scanline horizontal offsets on the attacker's
// BG (the script puts it there with monbg), 32 lines either side of its centre, growing, holding, then fading.
const AnimTask_DragonDanceWaver: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  let dmaDest: number;
  if (GetBattlerSpriteBGPriorityRank(anim.attacker) === 1) {
    dmaDest = REG_OFFSET_BG1HOFS;
    task.data[2] = g.battle_BG1_X;
  } else {
    dmaDest = REG_OFFSET_BG2HOFS;
    task.data[2] = g.battle_BG2_X;
  }
  const y = GetBattlerYCoordWithElevation(anim.attacker);
  task.data[3] = y - 32;
  task.data[4] = y + 32;
  if (task.data[3] < 0) task.data[3] = 0;
  for (let i = task.data[3]; i <= task.data[4]; i++) {
    gScanlineEffectRegBuffers[0][i] = task.data[2];
    gScanlineEffectRegBuffers[1][i] = task.data[2];
  }
  ScanlineEffect_SetParams({ dmaDest, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
  task.func = AnimTask_DragonDanceWaver_Step;
};

const AnimTask_DragonDanceWaver_Step: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[0]) {
    case 0:
      if (++d[7] > 1) {
        d[7] = 0;
        if (++d[6] === 3) d[0]++;
      }
      UpdateDragonDanceScanlineEffect(task);
      break;
    case 1:
      if (++d[1] > 60) d[0]++;
      UpdateDragonDanceScanlineEffect(task);
      break;
    case 2:
      if (++d[7] > 1) {
        d[7] = 0;
        if (--d[6] === 0) d[0]++;
      }
      UpdateDragonDanceScanlineEffect(task);
      break;
    case 3:
      gScanlineEffect.state = 3;
      d[0]++;
      break;
    case 4:
      DestroyAnimVisualTask(taskId);
      break;
  }
};

function UpdateDragonDanceScanlineEffect(task: Task): void {
  const d = task.data;
  const buf = gScanlineEffectRegBuffers[gScanlineEffect.srcBuffer];
  let index = d[5] & 0xffff;
  for (let i = d[3] & 0xffff; i <= d[4]; i++) {
    buf[i] = ((gSineTable(index) * d[6]) >> 7) + d[2];
    index = (index + 8) & 0xff;
  }
  d[5] = (d[5] + 9) & 0xff;
}

/** AnimOverheatFlame: flames bursting outwards from the attacker. Args: start distance, angle, x speed, duration, y offset. */
const AnimOverheatFlame: SpriteCallback = (sprite) => {
  const yAmplitude = Math.trunc((gBattleAnimArgs[2] * 3) / 5);
  const d = sprite.data;
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[4];
  d[1] = Cos(gBattleAnimArgs[1] & 0xff, gBattleAnimArgs[2]);
  d[2] = Sin(gBattleAnimArgs[1] & 0xff, yAmplitude);
  sprite.x += d[1] * gBattleAnimArgs[0];
  sprite.y += d[2] * gBattleAnimArgs[0];
  d[3] = gBattleAnimArgs[3];
  sprite.callback = AnimOverheatFlame_Step;
  // (the C also copies data[0..6] into the never-read sUnusedOverheatData)
};

function AnimOverheatFlame_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[4] += d[1];
  d[5] += d[2];
  sprite.x2 = Math.trunc(d[4] / 10);
  sprite.y2 = Math.trunc(d[5] / 10);
  if (++d[0] > d[3]) DestroyAnimSprite(sprite);
}

export const dragonSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimOutrageFlame,
  AnimDragonFireToTarget,
  AnimDragonRageFirePlume,
  AnimDragonDanceOrb,
  AnimOverheatFlame,
};

export const dragonTasks: Record<string, TaskFunc> = {
  AnimTask_DragonDanceWaver,
};
