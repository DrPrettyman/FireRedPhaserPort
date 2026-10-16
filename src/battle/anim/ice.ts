// battle_anim_ice.c: sprite callbacks and tasks, ported as the moves that use them come up.

import type { Sprite, SpriteCallback } from '../../gba/sprite';
import type { TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { Cos, Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  AnimTranslateLinear,
  GetBattlerSpriteBGPriority,
  InitAnimLinearTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  IsDoubleBattle,
  SetAverageBattlerPositions,
} from './animMons';
import { anim, DestroyAnimSprite, gBattleAnimArgs } from './state';

// InitSwirlingFogAnim (Mist, Smog, Haze, ...): a cloud drifting around a battler, passing behind it on
// the far half of the circle. Args: x, y, y distance, duration, battler (0 attacker), both mons.
const InitSwirlingFogAnim: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[4] === 0 ? anim.attacker : anim.target;
  if (gBattleAnimArgs[5] === 0) {
    if (gBattleAnimArgs[4] === 0) InitSpritePosToAnimAttacker(sprite, false);
    else InitSpritePosToAnimTarget(sprite, false);
  } else {
    const p = SetAverageBattlerPositions(battler, false);
    sprite.x = p.x;
    sprite.y = p.y;
    if (getBattlerSide(battler) !== K.B_SIDE_PLAYER) sprite.x -= gBattleAnimArgs[0];
    else sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
  }
  const d = sprite.data;
  d[7] = battler;
  d[6] = gBattleAnimArgs[5] === 0 || !IsDoubleBattle() ? 0x20 : 0x40;
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) sprite.y += 8;
  d[0] = gBattleAnimArgs[3];
  d[1] = sprite.x;
  d[2] = sprite.x;
  d[3] = sprite.y;
  d[4] = sprite.y + gBattleAnimArgs[2];
  InitAnimLinearTranslation(sprite);
  d[5] = 64;
  sprite.callback = AnimSwirlingFogAnim;
  sprite.callback(sprite);
};

function AnimSwirlingFogAnim(sprite: Sprite): void {
  const d = sprite.data;
  if (!AnimTranslateLinear(sprite)) {
    sprite.x2 += Sin(d[5], d[6]);
    sprite.y2 += Cos(d[5], -6);
    if (((d[5] - 64) & 0xffff) <= 0x7f) sprite.oam.priority = GetBattlerSpriteBGPriority(d[7]);
    else sprite.oam.priority = GetBattlerSpriteBGPriority(d[7]) + 1;
    d[5] = (d[5] + 3) & 0xff;
  } else {
    DestroyAnimSprite(sprite);
  }
}

export const iceSpriteCallbacks: Record<string, SpriteCallback> = {
  InitSwirlingFogAnim,
};

export const iceTasks: Record<string, TaskFunc> = {};
