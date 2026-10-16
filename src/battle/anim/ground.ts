// battle_anim_ground.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { StoreSpriteCallbackInData6, type SpriteCallback } from '../../gba/sprite';
import { type TaskFunc } from '../../gba/task';
import { random } from '../../util/random';
import { K } from '../constants';
import {
  DestroySpriteAndMatrix,
  GetBattlerSpriteCoord2,
  InitSpritePosToAnimAttacker,
  StartAnimLinearTranslation,
} from './animMons';
import { anim, gBattleAnimArgs } from './state';

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

export const groundSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimDirtScatter,
};

export const groundTasks: Record<string, TaskFunc> = {
};
