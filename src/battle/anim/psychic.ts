// battle_anim_psychic.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { BLDALPHA_BLEND, REG_OFFSET_BLDALPHA, SetGpuReg } from '../../gba/hw';
import { gPlttBufferFaded, OBJ_PLTT_ID } from '../../gba/palette';
import { gSprites, IndexOfSpritePaletteTag, type Sprite, type SpriteCallback } from '../../gba/sprite';
import type { TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { g } from '../env';
import { GetBattlerSpriteBGPriorityRank } from '../gfx';
import { getBattlerAtPosition, getBattlerSide } from '../util';
import {
  BATTLE_PARTNER,
  DestroySpriteAndMatrix,
  GetBattlerSpriteCoord,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  IsBattlerSpriteVisible,
  IsDoubleBattle,
} from './animMons';
import { MoveBattlerSpriteToBG, ResetBattleAnimBg } from './battleAnim';
import { anim, DestroyAnimSprite, gBattleAnimArgs } from './state';

// AnimDefensiveWall (Reflect, Light Screen, Barrier, Mirror Coat, Magic Coat): the wall fades in in front
// of the attacker's side, cycles colours 1-8 of its palette, and fades out. The foes move to the anim
// BGs meanwhile so the (blended) wall draws over them. Args: x, y, palette tag.
const AnimDefensiveWall: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    sprite.oam.priority = 2;
    sprite.subpriority = 200;
  }
  const battler = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
  const toBG2 = (GetBattlerSpriteBGPriorityRank(battler) ^ 1) !== 0;
  if (IsBattlerSpriteVisible(battler)) MoveBattlerSpriteToBG(battler, toBG2);
  if (IsBattlerSpriteVisible(BATTLE_PARTNER(battler))) MoveBattlerSpriteToBG(BATTLE_PARTNER(battler), !toBG2);
  if (IsDoubleBattle()) {
    if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
      sprite.x = 72;
      sprite.y = 80;
    } else {
      sprite.x = 176;
      sprite.y = 40;
    }
  } else {
    if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    sprite.x = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X) + gBattleAnimArgs[0];
    sprite.y = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y) + gBattleAnimArgs[1];
  }
  sprite.data[0] = OBJ_PLTT_ID(IndexOfSpritePaletteTag(gBattleAnimArgs[2]));
  sprite.callback = AnimDefensiveWall_Step2;
  sprite.callback(sprite);
};

function AnimDefensiveWall_Step2(sprite: Sprite): void {
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(sprite.data[3], 16 - sprite.data[3]));
  if (sprite.data[3] === 13) sprite.callback = AnimDefensiveWall_Step3;
  else ++sprite.data[3];
}

function AnimDefensiveWall_Step3(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[1] === 2) {
    d[1] = 0;
    const startOffset = d[0] & 0xffff;
    const color = gPlttBufferFaded[startOffset + 8];
    for (let i = 8; i > 0; --i) gPlttBufferFaded[startOffset + i] = gPlttBufferFaded[startOffset + i - 1];
    gPlttBufferFaded[startOffset + 1] = color;
    if (++d[2] === 16) sprite.callback = AnimDefensiveWall_Step4;
  }
}

function AnimDefensiveWall_Step4(sprite: Sprite): void {
  SetGpuReg(REG_OFFSET_BLDALPHA, BLDALPHA_BLEND(sprite.data[3], 16 - sprite.data[3]));
  if (--sprite.data[3] === -1) {
    const battler = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
    if (IsBattlerSpriteVisible(battler)) gSprites[g.battlerSpriteIds[battler]].invisible = false;
    if (IsBattlerSpriteVisible(BATTLE_PARTNER(battler))) gSprites[g.battlerSpriteIds[BATTLE_PARTNER(battler)]].invisible = false;
    sprite.invisible = true;
    sprite.callback = AnimDefensiveWall_Step5;
  }
}

function AnimDefensiveWall_Step5(sprite: Sprite): void {
  const battler = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
  const toBG2 = (GetBattlerSpriteBGPriorityRank(battler) ^ 1) !== 0;
  if (IsBattlerSpriteVisible(battler)) ResetBattleAnimBg(toBG2);
  if (IsBattlerSpriteVisible(battler ^ 2)) ResetBattleAnimBg(!toBG2);
  sprite.callback = DestroyAnimSprite;
}

/** AnimWallSparkle: a sparkle on the wall (doubles: at the side's centre). Args: x, y, battler (0 attacker), ignore pic offsets. */
const AnimWallSparkle: SpriteCallback = (sprite) => {
  if (sprite.data[0] === 0) {
    const respectMonPicOffsets = !gBattleAnimArgs[3];
    if (IsDoubleBattle()) {
      if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
        sprite.x = 72 - gBattleAnimArgs[0];
        sprite.y = gBattleAnimArgs[1] + 80;
      } else {
        sprite.x = gBattleAnimArgs[0] + 176;
        sprite.y = gBattleAnimArgs[1] + 40;
      }
    } else if (gBattleAnimArgs[2] === 0) {
      InitSpritePosToAnimAttacker(sprite, respectMonPicOffsets);
    } else {
      InitSpritePosToAnimTarget(sprite, respectMonPicOffsets);
    }
    ++sprite.data[0];
  } else if (sprite.animEnded || sprite.affineAnimEnded) {
    DestroySpriteAndMatrix(sprite);
  }
};

export const psychicSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimDefensiveWall,
  AnimWallSparkle,
};

export const psychicTasks: Record<string, TaskFunc> = {};
