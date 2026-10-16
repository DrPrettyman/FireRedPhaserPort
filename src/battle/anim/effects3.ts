// battle_anim_effects_3.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { gSprites, StartSpriteAnim, StoreSpriteCallbackInData6, type Sprite, type SpriteCallback } from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { getBattlerSide } from '../util';
import {
  GetAnimBattlerSpriteId,
  GetBattlerSpriteCoord,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  RunStoredCallbackWhenAnimEnds,
  SetSpriteRotScale,
  SetAnimSpriteInitialXOffset,
  SetSpriteCoordsToAnimAttackerCoords,
} from './animMons';
import { LoadBattleMonGfxAndAnimate } from '../gfx';
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

export const effects3SpriteCallbacks: Record<string, SpriteCallback> = {
  AnimLeer,
  AnimRoarNoiseLine,
};

export const effects3Tasks: Record<string, TaskFunc> = {
  AnimTask_MonToSubstitute,
};
