// battle_anim_fire.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { type SpriteCallback } from '../../gba/sprite';
import { type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { getBattlerAtPosition, getBattlerSide } from '../util';
import { AnimTravelDiagonally } from './animMons';
import { anim, gBattleAnimArgs } from './state';

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

export const fireSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimEmberFlare,
  AnimBurnFlame,
};

export const fireTasks: Record<string, TaskFunc> = {
};
