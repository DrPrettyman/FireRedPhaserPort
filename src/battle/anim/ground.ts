// battle_anim_ground.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { StoreSpriteCallbackInData6, type SpriteCallback } from '../../gba/sprite';
import type { TaskFunc } from '../../gba/task';
import { random } from '../../util/random';
import { K } from '../constants';
import {
  DestroySpriteAndMatrix,
  GetBattlerSpriteCoord,
  GetBattlerSpriteCoord2,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  StartAnimLinearTranslation,
} from './animMons';
import { anim, DestroyAnimSprite, gBattleAnimArgs } from './state';
import { getBattlerSide } from '../util';

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

export const groundSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimDirtScatter,
  AnimBoneHitProjectile,
};

export const groundTasks: Record<string, TaskFunc> = {};
