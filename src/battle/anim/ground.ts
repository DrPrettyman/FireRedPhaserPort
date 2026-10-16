// battle_anim_ground.c: every sprite callback and task in the file.

import { DISPLAY_HEIGHT, REG_OFFSET_BG1HOFS, REG_OFFSET_BG2HOFS } from '../../gba/hw';
import { gScanlineEffect, gScanlineEffectRegBuffers, SCANLINE_EFFECT_DMACNT_16BIT, ScanlineEffect_SetParams } from '../../gba/scanline';
import { gSprites, StoreSpriteCallbackInData6, type Sprite, type SpriteCallback } from '../../gba/sprite';
import { CreateTask, DestroyTask, gTasks, type Task, type TaskFunc } from '../../gba/task';
import { random } from '../../util/random';
import { K } from '../constants';
import { g } from '../env';
import { gSineTable } from '../trig';
import { getBattlerSide } from '../util';
import {
  DestroySpriteAndMatrix,
  GetAnimBattlerSpriteId,
  GetBattlerSpriteBGPriorityRank,
  GetBattlerSpriteCoord,
  GetBattlerSpriteCoord2,
  GetBattlerYCoordWithElevation,
  InitAnimArcTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  IsBattlerSpriteVisible,
  SPRITE_NONE,
  StartAnimLinearTranslation,
  TranslateAnimHorizontalArc,
  WaitAnimForDuration,
} from './animMons';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

/** AnimBonemerangProjectile: arcs to the target and back to the attacker. */
const AnimBonemerangProjectile: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[0] = 20;
  sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[5] = -40;
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimBonemerangProjectile_Step;
};

function AnimBonemerangProjectile_Step(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) {
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    sprite.y2 = 0;
    sprite.x2 = 0;
    sprite.data[0] = 20;
    sprite.data[2] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
    sprite.data[4] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
    sprite.data[5] = 40;
    InitAnimArcTranslation(sprite);
    sprite.callback = AnimBonemerangProjectile_End;
  }
}

function AnimBonemerangProjectile_End(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) DestroyAnimSprite(sprite);
}

/** AnimBoneHitProjectile (Bone Club, Bone Rush): from the target's side into it. Args: x, y, target x, target y, duration. */
const AnimBoneHitProjectile: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, true);
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimDirtScatter (Sand-Attack, Mud-Slap): to a random spot on the target. Args: x, y, duration. */
const AnimDirtScatter: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const targetXPos = GetBattlerSpriteCoord2(anim.target, K.BATTLER_COORD_X_2) & 0xff;
  const targetYPos = GetBattlerSpriteCoord2(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) & 0xff;
  let xOffset = random() & 0x1f;
  let yOffset = random() & 0x1f;
  if (xOffset > 16) xOffset = 16 - xOffset;
  if (yOffset > 16) yOffset = 16 - yOffset;
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = targetXPos + xOffset;
  sprite.data[4] = targetYPos + yOffset;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
};

/** AnimMudSportDirt: dirt rising from the attacker (arg 0 == 0) or falling at a spot. Args: rising/falling, x, y. */
const AnimMudSportDirt: SpriteCallback = (sprite) => {
  sprite.oam.tileNum++;
  if (gBattleAnimArgs[0] === 0) {
    sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2) + gBattleAnimArgs[1];
    sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
    sprite.data[0] = gBattleAnimArgs[1] > 0 ? 1 : -1;
    sprite.callback = AnimMudSportDirtRising;
  } else {
    sprite.x = gBattleAnimArgs[1];
    sprite.y = gBattleAnimArgs[2];
    sprite.y2 = -gBattleAnimArgs[2];
    sprite.callback = AnimMudSportDirtFalling;
  }
};

function AnimMudSportDirtRising(sprite: Sprite): void {
  if (++sprite.data[1] > 1) {
    sprite.data[1] = 0;
    sprite.x += sprite.data[0];
  }
  sprite.y -= 4;
  if (sprite.y < -4) DestroyAnimSprite(sprite);
}

function AnimMudSportDirtFalling(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      sprite.y2 += 4;
      if (sprite.y2 >= 0) {
        sprite.y2 = 0;
        d[0]++;
      }
      break;
    case 1:
      if (++d[1] > 0) {
        d[1] = 0;
        sprite.invisible = !sprite.invisible;
        if (++d[2] === 10) DestroyAnimSprite(sprite);
      }
      break;
  }
}

// ------------------------------------------------------------------ Dig

// The attacker sits on BG1 or BG2 (monbg); a BGxHOFS scanline effect pushes the lines below the hole off
// screen while the BG scrolls down (dig in) or the sprite rises (dig out).

/** AnimTask_DigDownMovement: arg 0 FALSE sinks the attacker's BG copy into the ground, TRUE hides the sprite. */
const AnimTask_DigDownMovement: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  task.func = gBattleAnimArgs[0] === 0 ? AnimTask_DigBounceMovement : AnimTask_DigDisappear;
  task.func(taskId);
};

const AnimTask_DigBounceMovement: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0: {
      d[10] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
      d[11] = GetBattlerSpriteBGPriorityRank(anim.attacker);
      if (d[11] === 1) {
        d[12] = g.battle_BG1_X;
        d[13] = g.battle_BG1_Y;
      } else {
        d[12] = g.battle_BG2_X;
        d[13] = g.battle_BG2_Y;
      }
      const var0 = GetBattlerYCoordWithElevation(anim.attacker) & 0xff;
      d[14] = var0 - 32;
      d[15] = var0 + 32;
      if (d[14] < 0) d[14] = 0;
      gSprites[d[10]].invisible = true;
      d[0]++;
      break;
    }
    case 1:
      SetDigScanlineEffect(d[11], d[14], d[15]);
      d[0]++;
      break;
    case 2:
      d[2] = (d[2] + 6) & 0x7f;
      if (++d[4] > 2) {
        d[4] = 0;
        d[3]++;
      }
      d[5] = d[3] + (gSineTable(d[2]) >> 4);
      if (d[11] === 1) g.battle_BG1_Y = d[13] - d[5];
      else g.battle_BG2_Y = d[13] - d[5];
      if (d[5] > 63) {
        d[5] = 120 - d[14];
        if (d[11] === 1) g.battle_BG1_Y = d[13] - d[5];
        else g.battle_BG2_Y = d[13] - d[5];
        gSprites[d[10]].x2 = 272 - gSprites[d[10]].x;
        d[0]++;
      }
      break;
    case 3:
      gScanlineEffect.state = 3;
      d[0]++;
      break;
    case 4:
      DestroyAnimVisualTask(taskId);
      gSprites[d[10]].invisible = true;
      break;
  }
};

const AnimTask_DigDisappear: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  gSprites[spriteId].invisible = true;
  gSprites[spriteId].x2 = 0;
  gSprites[spriteId].y2 = 0;
  if (GetBattlerSpriteBGPriorityRank(anim.attacker) === 1) g.battle_BG1_Y = 0;
  else g.battle_BG2_Y = 0;
  DestroyAnimVisualTask(taskId);
};

/** AnimTask_DigUpMovement: arg 0 FALSE shows the attacker below the screen, TRUE raises it out of the hole. */
const AnimTask_DigUpMovement: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  task.func = gBattleAnimArgs[0] === 0 ? AnimTask_DigSetVisibleUnderground : AnimTask_DigRiseUpFromHole;
  task.func(taskId);
};

const AnimTask_DigSetVisibleUnderground: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      d[10] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
      gSprites[d[10]].invisible = false;
      gSprites[d[10]].x2 = 0;
      gSprites[d[10]].y2 = DISPLAY_HEIGHT - gSprites[d[10]].y;
      d[0]++;
      break;
    case 1:
      DestroyAnimVisualTask(taskId);
  }
};

const AnimTask_DigRiseUpFromHole: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0: {
      d[10] = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
      d[11] = GetBattlerSpriteBGPriorityRank(anim.attacker);
      if (d[11] === 1) d[12] = g.battle_BG1_X;
      else d[12] = g.battle_BG2_X;
      const var0 = GetBattlerYCoordWithElevation(anim.attacker) & 0xff;
      d[14] = var0 - 32;
      d[15] = var0 + 32;
      d[0]++;
      break;
    }
    case 1:
      SetDigScanlineEffect(d[11], 0, d[15]);
      d[0]++;
      break;
    case 2:
      gSprites[d[10]].y2 = 96;
      d[0]++;
      break;
    case 3:
      gSprites[d[10]].y2 -= 8;
      if (gSprites[d[10]].y2 === 0) {
        gScanlineEffect.state = 3;
        d[0]++;
      }
      break;
    case 4:
      DestroyAnimVisualTask(taskId);
      break;
  }
};

/** SetDigScanlineEffect: lines [y, endY) keep the BG's x scroll; the rest are scrolled 240 px off screen. */
function SetDigScanlineEffect(useBG1: number, y: number, endY: number): void {
  let bgX: number;
  let dmaDest: number;
  if (useBG1 === 1) {
    bgX = g.battle_BG1_X;
    dmaDest = REG_OFFSET_BG1HOFS;
  } else {
    bgX = g.battle_BG2_X;
    dmaDest = REG_OFFSET_BG2HOFS;
  }
  bgX = (bgX << 16) >> 16;
  if (y < 0) y = 0;
  for (; y < endY; y++) {
    gScanlineEffectRegBuffers[0][y] = bgX;
    gScanlineEffectRegBuffers[1][y] = bgX;
  }
  for (; y < 160; y++) {
    gScanlineEffectRegBuffers[0][y] = bgX + 240;
    gScanlineEffectRegBuffers[1][y] = bgX + 240;
  }
  ScanlineEffect_SetParams({ dmaDest, dmaControl: SCANLINE_EFFECT_DMACNT_16BIT, initState: 1 });
}

// AnimDirtPlumeParticle (Fissure, Dig): dirt arcing out from beside a battler. Args: battler, side (1 right),
// x distance, y distance, arc height, duration.
const AnimDirtPlumeParticle: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  let xOffset = 24;
  if (gBattleAnimArgs[1] === 1) {
    xOffset *= -1;
    gBattleAnimArgs[2] *= -1;
  }
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2) + xOffset;
  sprite.y = GetBattlerYCoordWithElevation(battler) + 30;
  sprite.data[0] = gBattleAnimArgs[5];
  sprite.data[2] = sprite.x + gBattleAnimArgs[2];
  sprite.data[4] = sprite.y + gBattleAnimArgs[3];
  sprite.data[5] = gBattleAnimArgs[4];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimDirtPlumeParticle_Step;
};

function AnimDirtPlumeParticle_Step(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) DestroyAnimSprite(sprite);
}

/** AnimDigDirtMound: one half of the dirt mound (two sprites side by side). Args: battler, half (0 left, 1 right), duration. */
const AnimDigDirtMound: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X) - 16 + gBattleAnimArgs[1] * 32;
  sprite.y = GetBattlerYCoordWithElevation(battler) + 32;
  sprite.oam.tileNum += gBattleAnimArgs[1] * 8;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.callback = WaitAnimForDuration;
};

// ------------------------------------------------------------------ AnimTask_HorizontalShake

// Task data: tState 0, tDelay 1, tTimer 2, tMaxTime 3, tbattlerSpriteIds(i) 9+i, tNumBattlers / tInitialX 13,
// tHorizOffset 14, tInitHorizOffset 15.

// AnimTask_HorizontalShake (Earthquake, Magnitude, Fissure, ...): shakes a battler, all battlers
// (MAX_BATTLERS_COUNT) or the terrain (MAX_BATTLERS_COUNT + 1). Args: what, intensity (0: move power / 10),
// duration.
const AnimTask_HorizontalShake: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  if (gBattleAnimArgs[1] !== 0) d[14] = d[15] = gBattleAnimArgs[1] + 3;
  else d[14] = d[15] = Math.trunc(anim.movePower / 10) + 3;
  d[3] = gBattleAnimArgs[2];
  switch (gBattleAnimArgs[0]) {
    case K.MAX_BATTLERS_COUNT + 1: // the terrain
      d[13] = g.battle_BG3_X;
      task.func = AnimTask_ShakeTerrain;
      break;
    case K.MAX_BATTLERS_COUNT: // all battlers
      d[13] = 0;
      for (let i = 0; i < K.MAX_BATTLERS_COUNT; i++) {
        if (IsBattlerSpriteVisible(i)) {
          d[9 + d[13]] = g.battlerSpriteIds[i];
          d[13]++;
        }
      }
      task.func = AnimTask_ShakeBattlers;
      break;
    default: // one battler
      d[9] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
      if (d[9] === SPRITE_NONE) {
        DestroyAnimVisualTask(taskId);
      } else {
        d[13] = 1;
        task.func = AnimTask_ShakeBattlers;
      }
      break;
  }
};

const AnimTask_ShakeTerrain: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      if (++d[1] > 1) {
        d[1] = 0;
        g.battle_BG3_X = (d[2] & 1) === 0 ? d[13] + d[15] : d[13] - d[15];
        if (++d[2] === d[3]) {
          d[2] = 0;
          d[14]--;
          d[0]++;
        }
      }
      break;
    case 1:
      if (++d[1] > 1) {
        d[1] = 0;
        g.battle_BG3_X = (d[2] & 1) === 0 ? d[13] + d[14] : d[13] - d[14];
        if (++d[2] === 4) {
          d[2] = 0;
          if (--d[14] === 0) d[0]++;
        }
      }
      break;
    case 2:
      g.battle_BG3_X = d[13];
      DestroyAnimVisualTask(taskId);
      break;
  }
};

const AnimTask_ShakeBattlers: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  switch (d[0]) {
    case 0:
      if (++d[1] > 1) {
        d[1] = 0;
        SetBattlersXOffsetForShake(task);
        if (++d[2] === d[3]) {
          d[2] = 0;
          d[14]--;
          d[0]++;
        }
      }
      break;
    case 1:
      if (++d[1] > 1) {
        d[1] = 0;
        SetBattlersXOffsetForShake(task);
        if (++d[2] === 4) {
          d[2] = 0;
          if (--d[14] === 0) d[0]++;
        }
      }
      break;
    case 2:
      for (let i = 0; i < d[13]; i++) gSprites[d[9 + i]].x2 = 0;
      DestroyAnimVisualTask(taskId);
      break;
  }
};

function SetBattlersXOffsetForShake(task: Task): void {
  const d = task.data;
  const xOffset = (d[2] & 1) === 0 ? Math.trunc(d[14] / 2) + (d[14] & 1) : -Math.trunc(d[14] / 2);
  for (let i = 0; i < d[13]; i++) gSprites[d[9 + i]].x2 = xOffset;
}

// AnimTask_IsPowerOver99 (Magnitude): the C writes gBattleAnimArgs[15], past the end of the array (the script
// reads it back with jumpargeq 15); state.ts gives gBattleAnimArgs spare slots for it.
const AnimTask_IsPowerOver99: TaskFunc = (taskId) => {
  gBattleAnimArgs[15] = anim.movePower > 99 ? 1 : 0;
  DestroyAnimVisualTask(taskId);
};

// AnimTask_PositionFissureBgOnBattler: puts the Fissure crack (BG3) under a battler until arg 7 equals the
// terminator. Args: battler (bit 0 target, > 1 its partner), helper task priority, terminator.
const AnimTask_PositionFissureBgOnBattler: TaskFunc = (taskId) => {
  let battler = gBattleAnimArgs[0] & 1 ? anim.target : anim.attacker;
  if (gBattleAnimArgs[0] > 1) battler ^= K.BIT_FLANK;
  const newTask = gTasks[CreateTask(WaitForFissureCompletion, gBattleAnimArgs[1] & 0xff)];
  newTask.data[1] = (32 - GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2)) & 0x1ff;
  newTask.data[2] = (64 - GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET)) & 0xff;
  g.battle_BG3_X = newTask.data[1];
  g.battle_BG3_Y = newTask.data[2];
  newTask.data[3] = gBattleAnimArgs[2];
  DestroyAnimVisualTask(taskId);
};

const WaitForFissureCompletion: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  // Holds the BG3 offsets until gBattleAnimArgs[7] is set to the terminator.
  if (gBattleAnimArgs[7] === d[3]) {
    g.battle_BG3_X = 0;
    g.battle_BG3_Y = 0;
    DestroyTask(taskId);
  } else {
    g.battle_BG3_X = d[1];
    g.battle_BG3_Y = d[2];
  }
};

export const groundSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimBonemerangProjectile,
  AnimBoneHitProjectile,
  AnimDirtScatter,
  AnimMudSportDirt,
  AnimDirtPlumeParticle,
  AnimDigDirtMound,
};

export const groundTasks: Record<string, TaskFunc> = {
  AnimTask_DigDownMovement,
  AnimTask_DigUpMovement,
  AnimTask_HorizontalShake,
  AnimTask_IsPowerOver99,
  AnimTask_PositionFissureBgOnBattler,
};
