// battle_anim_effects_3.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { LoadBgTiles } from '../../gba/bg';
import { REG_OFFSET_MOSAIC, SetGpuReg } from '../../gba/hw';
import { BG_PLTT_ID, gPlttBufferFaded } from '../../gba/palette';
import { gSprites, ST_OAM_OBJ_NORMAL, StartSpriteAnim, StoreSpriteCallbackInData6, type Sprite, type SpriteCallback } from '../../gba/sprite';
import { DestroyTask, gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { g } from '../env';
import { getBattlerPosition, getBattlerSide } from '../util';
import {
  GetAnimBattlerSpriteId,
  GetBattleAnimBgDataByPriorityRank,
  GetBattleBgPaletteNum,
  GetBattlerSpriteCoord,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  RunStoredCallbackWhenAnimEnds,
  SetAnimBgAttribute,
  SetBattlerSpriteYOffsetFromRotation,
  SetSpriteRotScale,
  SetAnimSpriteInitialXOffset,
  SetSpriteCoordsToAnimAttackerCoords,
} from './animMons';
import { GetBattlerSpriteBGPriorityRank, gMonSpritesGfxPtr, HandleSpeciesGfxDataChange, LoadBattleMonGfxAndAnimate, SetBattlerShadowSpriteCallback } from '../gfx';
import { BattleAnimAdjustPanning, PlaySE12WithPanning } from './battleAnim';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

/** AnimLeer: the eyes appear by the attacker. Args: x, y. */
const AnimLeer: SpriteCallback = (sprite) => {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimRoarNoiseLine (Growl, Roar). Args: x, y, direction (0 up, 1 down, 2 horizontal). */
const AnimRoarNoiseLine: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) === K.B_SIDE_OPPONENT) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
  sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X) + gBattleAnimArgs[0];
  sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + gBattleAnimArgs[1];
  if (gBattleAnimArgs[2] === 0) {
    sprite.data[0] = 0x280;
    sprite.data[1] = -0x280;
  } else if (gBattleAnimArgs[2] === 1) {
    sprite.vFlip = true;
    sprite.data[0] = 0x280;
    sprite.data[1] = 0x280;
  } else {
    StartSpriteAnim(sprite, 1);
    sprite.data[0] = 0x280;
  }
  if (isOpponent(anim.attacker)) {
    sprite.data[0] = -sprite.data[0];
    sprite.hFlip = true;
  }
  sprite.callback = AnimRoarNoiseLine_Step;
};

function AnimRoarNoiseLine_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[6] += d[0];
  d[7] += d[1];
  sprite.x2 = d[6] >> 8;
  sprite.y2 = d[7] >> 8;
  if (++d[5] === 14) DestroyAnimSprite(sprite);
}

/** AnimTask_MonToSubstitute (General_SubstituteAppear): the mon squashes away and the doll drops in */
const AnimTask_MonToSubstitute: TaskFunc = (taskId) => {
  const spriteId = GetAnimBattlerSpriteId(K.ANIM_ATTACKER);
  const d = gTasks[taskId].data;
  if (d[0] === 0) {
    PrepareBattlerSpriteForRotScale(spriteId, 0);
    d[1] = 0x100;
    d[2] = 0x100;
    d[0]++;
  } else if (d[0] === 1) {
    d[1] += 0x60;
    d[2] -= 0xd;
    SetSpriteRotScale(spriteId, d[1], d[2], 0);
    if (++d[3] === 9) {
      d[3] = 0;
      ResetSpriteRotScale(spriteId);
      gSprites[spriteId].invisible = true;
      d[0]++;
    }
  } else {
    LoadBattleMonGfxAndAnimate(anim.attacker, false, spriteId);
    d.fill(0);
    gTasks[taskId].func = AnimTask_MonToSubstituteDoll;
  }
};

const AnimTask_MonToSubstituteDoll: TaskFunc = (taskId) => {
  const s = gSprites[GetAnimBattlerSpriteId(K.ANIM_ATTACKER)];
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      s.y2 = -200;
      s.x2 = 200;
      s.invisible = false;
      d[10] = 0;
      d[0]++;
      break;
    case 1:
      d[10] += 112;
      s.y2 += d[10] >> 8;
      if (s.y + s.y2 >= -32) s.x2 = 0;
      if (s.y2 > 0) s.y2 = 0;
      if (s.y2 === 0) {
        PlaySE12WithPanning(K.SE_M_BUBBLE2, BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER));
        d[10] -= 0x800;
        d[0]++;
      }
      break;
    case 2:
      d[10] -= 112;
      if (d[10] < 0) d[10] = 0;
      s.y2 -= d[10] >> 8;
      if (d[10] === 0) d[0]++;
      break;
    case 3:
      d[10] += 112;
      s.y2 += d[10] >> 8;
      if (s.y2 > 0) s.y2 = 0;
      if (s.y2 === 0) {
        PlaySE12WithPanning(K.SE_M_BUBBLE2, BattleAnimAdjustPanning(K.SOUND_PAN_ATTACKER));
        DestroyAnimVisualTask(taskId);
      }
      break;
  }
};

// AnimTask_SetPsychicBackground: cycles colours 1-11 of the battle BG palette every 4 frames until a
// script sets gBattleAnimArgs[7] to -1. It doesn't count as a visual task (waitforvisualfinish skips it).
const AnimTask_SetPsychicBackground: TaskFunc = (taskId) => {
  gTasks[taskId].func = SetPsychicBackground_Step;
  anim.visualTaskCount = (anim.visualTaskCount - 1) & 0xff;
};

const SetPsychicBackground_Step: TaskFunc = (taskId) => {
  const paletteIndex = GetBattleBgPaletteNum();
  const d = gTasks[taskId].data;
  if (++d[5] === 4) {
    const base = BG_PLTT_ID(paletteIndex);
    const lastColor = gPlttBufferFaded[base + 11];
    for (let i = 10; i > 0; i--) gPlttBufferFaded[base + i + 1] = gPlttBufferFaded[base + i];
    gPlttBufferFaded[base + 1] = lastColor;
    d[5] = 0;
  }
  if (gBattleAnimArgs[7] === -1) DestroyTask(taskId);
};

// AnimTask_TransformMon (Transform, General_SilphScoped): mosaics the attacker's BG copy (monbg) up,
// swaps its pic (HandleSpeciesGfxDataChange; arg 0 is the transform type), and mosaics back down.
const AnimTask_TransformMon: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      SetGpuReg(REG_OFFSET_MOSAIC, 0);
      if (GetBattlerSpriteBGPriorityRank(anim.attacker) === 1) SetAnimBgAttribute(1, K.BG_ANIM_MOSAIC, 1);
      else SetAnimBgAttribute(2, K.BG_ANIM_MOSAIC, 1);
      d[10] = gBattleAnimArgs[0];
      d[0]++;
      break;
    case 1:
      if (d[2]++ > 1) {
        d[2] = 0;
        d[1]++;
        const stretch = d[1] & 0xffff;
        SetGpuReg(REG_OFFSET_MOSAIC, (stretch << 4) | stretch);
        if (stretch === 15) d[0]++;
      }
      break;
    case 2: {
      HandleSpeciesGfxDataChange(anim.attacker, anim.target, d[10] & 0xff);
      const animBg = GetBattleAnimBgDataByPriorityRank();
      const position = getBattlerPosition(anim.attacker);
      const start = g.battleMonForms[anim.attacker] << 11;
      animBg.bgTiles.set(gMonSpritesGfxPtr!.sprites[position].subarray(start, start + 0x800)); // MON_PIC_SIZE
      LoadBgTiles(1, animBg.bgTiles, 0x800, animBg.tilesOffset);
      d[0]++;
      break;
    }
    case 3:
      if (d[2]++ > 1) {
        d[2] = 0;
        d[1]--;
        const stretch = d[1] & 0xffff;
        SetGpuReg(REG_OFFSET_MOSAIC, (stretch << 4) | stretch);
        if (stretch === 0) d[0]++;
      }
      break;
    case 4:
      SetGpuReg(REG_OFFSET_MOSAIC, 0);
      if (GetBattlerSpriteBGPriorityRank(anim.attacker) === 1) SetAnimBgAttribute(1, K.BG_ANIM_MOSAIC, 0);
      else SetAnimBgAttribute(2, K.BG_ANIM_MOSAIC, 0);
      if (getBattlerSide(anim.attacker) === K.B_SIDE_OPPONENT && d[10] === 0)
        SetBattlerShadowSpriteCallback(anim.attacker, g.battleSpritesDataPtr.battlerData[anim.attacker].transformSpecies);
      DestroyAnimVisualTask(taskId);
      break;
  }
};

// AnimTask_RockMonBackAndForth (Rock Slide, Muddy Water, ...): tilts and sways a battler. Args: battler,
// times, speed (0-2).
const AnimTask_RockMonBackAndForth: TaskFunc = (taskId) => {
  const task = gTasks[taskId];
  const d = task.data;
  if (!gBattleAnimArgs[1]) {
    DestroyAnimVisualTask(taskId);
    return;
  }
  if (gBattleAnimArgs[2] < 0) gBattleAnimArgs[2] = 0;
  if (gBattleAnimArgs[2] > 2) gBattleAnimArgs[2] = 2;
  d[0] = 0;
  d[1] = 0;
  d[2] = 0;
  d[3] = 8 - 2 * gBattleAnimArgs[2];
  d[4] = 0x100 + gBattleAnimArgs[2] * 128;
  d[5] = gBattleAnimArgs[2] + 2;
  d[6] = gBattleAnimArgs[1] - 1;
  d[15] = GetAnimBattlerSpriteId(gBattleAnimArgs[0]);
  const side = getBattlerSide(gBattleAnimArgs[0] === K.ANIM_ATTACKER ? anim.attacker : anim.target);
  if (side === K.B_SIDE_OPPONENT) {
    d[4] *= -1;
    d[5] *= -1;
  }
  PrepareBattlerSpriteForRotScale(d[15], ST_OAM_OBJ_NORMAL);
  task.func = AnimTask_RockMonBackAndForth_Step;
};

const AnimTask_RockMonBackAndForth_Step: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  const sway = (dir: number) => {
    gSprites[d[15]].x2 += dir * d[5];
    d[2] -= dir * d[4];
    SetSpriteRotScale(d[15], 0x100, 0x100, d[2]);
    SetBattlerSpriteYOffsetFromRotation(d[15]);
  };
  switch (d[0]) {
    case 0:
      sway(1);
      if (++d[1] >= d[3]) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 1:
      sway(-1);
      if (++d[1] >= d[3] * 2) {
        d[1] = 0;
        d[0]++;
      }
      break;
    case 2:
      sway(1);
      if (++d[1] >= d[3]) {
        if (d[6]) {
          d[6]--;
          d[1] = 0;
          d[0] = 0;
        } else {
          d[0]++;
        }
      }
      break;
    case 3:
      ResetSpriteRotScale(d[15]);
      DestroyAnimVisualTask(taskId);
      break;
  }
};

export const effects3SpriteCallbacks: Record<string, SpriteCallback> = {
  AnimLeer,
  AnimRoarNoiseLine,
};

export const effects3Tasks: Record<string, TaskFunc> = {
  AnimTask_MonToSubstitute,
  AnimTask_SetPsychicBackground,
  AnimTask_TransformMon,
  AnimTask_RockMonBackAndForth,
};
