// battle_anim_fire.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { StoreSpriteCallbackInData6, type SpriteCallback } from '../../gba/sprite';
import type { TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { getBattlerAtPosition, getBattlerSide } from '../util';
import { AnimTravelDiagonally, StartAnimLinearTranslation } from './animMons';
import { anim, DestroyAnimSprite, gBattleAnimArgs } from './state';

/** AnimEmberFlare: AnimTravelDiagonally, mirrored for a right-hand attacker on the target's side */
const AnimEmberFlare: SpriteCallback = (sprite) => {
  if (
    getBattlerSide(anim.attacker) === getBattlerSide(anim.target) &&
    (anim.attacker === getBattlerAtPosition(K.B_POSITION_PLAYER_RIGHT) || anim.attacker === getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT))
  )
    gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.callback = AnimTravelDiagonally;
  sprite.callback(sprite);
};

/** AnimBurnFlame (Status_Burn) */
const AnimBurnFlame: SpriteCallback = (sprite) => {
  gBattleAnimArgs[0] = -gBattleAnimArgs[0];
  gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.callback = AnimTravelDiagonally;
};

/** AnimSunlight (Sunny Day, Synthesis): a ray sliding down from the top left */
const AnimSunlight: SpriteCallback = (sprite) => {
  sprite.x = 0;
  sprite.y = 0;
  sprite.data[0] = 60;
  sprite.data[2] = 140;
  sprite.data[4] = 80;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

export const fireSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimEmberFlare,
  AnimBurnFlame,
  AnimSunlight,
};

export const fireTasks: Record<string, TaskFunc> = {};
