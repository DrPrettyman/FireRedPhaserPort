// battle_anim_fight.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { StartSpriteAnim, StoreSpriteCallbackInData6, type Sprite, type SpriteCallback } from '../../gba/sprite';
import type { TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { Sin } from '../trig';
import { getBattlerPosition, getBattlerSide } from '../util';
import {
  AnimTranslateLinear,
  AnimTravelDiagonally,
  BATTLE_PARTNER,
  InitAnimLinearTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  WaitAnimForDuration,
} from './animMons';
import { anim, DestroyAnimSprite, gBattleAnimArgs } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

/** AnimBasicFistOrFoot: shows a fist or foot on a battler. Args: x, y, duration, battler (0 attacker), anim. */
const AnimBasicFistOrFoot: SpriteCallback = (sprite) => {
  StartSpriteAnim(sprite, gBattleAnimArgs[4]);
  if (gBattleAnimArgs[3] === 0) InitSpritePosToAnimAttacker(sprite, true);
  else InitSpritePosToAnimTarget(sprite, true);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimJumpKick (Jump Kick, Hi Jump Kick): AnimSlideHandOrFootToTarget (the contest flip never applies) */
const AnimJumpKick: SpriteCallback = (sprite) => {
  AnimSlideHandOrFootToTarget(sprite);
};

// AnimSlideHandOrFootToTarget: AnimTravelDiagonally with anim arg 6; arg 7 == 1 mirrors y for an opponent attacker.
function AnimSlideHandOrFootToTarget(sprite: Sprite): void {
  if (gBattleAnimArgs[7] === 1 && isOpponent(anim.attacker)) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
  }
  StartSpriteAnim(sprite, gBattleAnimArgs[6]);
  gBattleAnimArgs[6] = 0;
  AnimTravelDiagonally(sprite);
}

/** AnimSlidingKick (Rolling Kick, Low Kick): slides across the target in a wave. Args: x, y, x distance, duration, wave speed, amplitude. */
const AnimSlidingKick: SpriteCallback = (sprite) => {
  if (BATTLE_PARTNER(anim.attacker) === anim.target && getBattlerPosition(anim.target) < K.B_POSITION_PLAYER_RIGHT) gBattleAnimArgs[0] *= -1;
  InitSpritePosToAnimTarget(sprite, true);
  if (isOpponent(anim.attacker)) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  const d = sprite.data;
  d[0] = gBattleAnimArgs[3];
  d[1] = sprite.x;
  d[2] = sprite.x + gBattleAnimArgs[2];
  d[3] = sprite.y;
  d[4] = sprite.y;
  InitAnimLinearTranslation(sprite);
  d[5] = gBattleAnimArgs[5];
  d[6] = gBattleAnimArgs[4];
  d[7] = 0;
  sprite.callback = AnimSlidingKick_Step;
};

function AnimSlidingKick_Step(sprite: Sprite): void {
  if (!AnimTranslateLinear(sprite)) {
    sprite.y2 += Sin(sprite.data[7] >> 8, sprite.data[5]);
    sprite.data[7] += sprite.data[6];
  } else {
    DestroyAnimSprite(sprite);
  }
}

export const fightSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimBasicFistOrFoot,
  AnimJumpKick,
  AnimSlidingKick,
};

export const fightTasks: Record<string, TaskFunc> = {};
