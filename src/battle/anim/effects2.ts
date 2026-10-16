// battle_anim_effects_2.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { StoreSpriteCallbackInData6, type SpriteCallback } from '../../gba/sprite';
import type { TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { Sin } from '../trig';
import { getBattlerSide } from '../util';
import { DestroySpriteAndMatrix, GetBattlerSpriteCoord, InitSpritePosToAnimAttacker, RunStoredCallbackWhenAffineAnimEnds } from './animMons';
import { anim, DestroyAnimSprite, gBattleAnimArgs } from './state';

/** AnimMagentaHeart (Status_Infatuation) */
const AnimMagentaHeart: SpriteCallback = (sprite) => {
  if (++sprite.data[0] === 1) InitSpritePosToAnimAttacker(sprite, false);
  sprite.x2 = Sin(sprite.data[1], 8);
  sprite.y2 = sprite.data[2] >> 8;
  sprite.data[1] = (sprite.data[1] + 7) & 0xff;
  sprite.data[2] -= 0x80;
  if (sprite.data[0] === 60) DestroyAnimSprite(sprite);
};

/** AnimAngerMark (Rage, Swagger, ...): pops on a battler. Args: battler (0 attacker), x, y. */
const AnimAngerMark: SpriteCallback = (sprite) => {
  const battler = !gBattleAnimArgs[0] ? anim.attacker : anim.target;
  if (getBattlerSide(battler) === K.B_SIDE_OPPONENT) gBattleAnimArgs[1] *= -1;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2) + gBattleAnimArgs[1];
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[2];
  if (sprite.y < 8) sprite.y = 8;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
  sprite.callback = RunStoredCallbackWhenAffineAnimEnds;
};

export const effects2SpriteCallbacks: Record<string, SpriteCallback> = {
  AnimMagentaHeart,
  AnimAngerMark,
};

export const effects2Tasks: Record<string, TaskFunc> = {};
