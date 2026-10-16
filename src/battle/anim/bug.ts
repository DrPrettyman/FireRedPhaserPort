// battle_anim_bug.c: sprite callbacks and tasks, ported as the moves that use them come up.

import { StoreSpriteCallbackInData6, type Sprite, type SpriteCallback } from '../../gba/sprite';
import type { TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { Sin } from '../trig';
import { getBattlerPosition, getBattlerSide } from '../util';
import {
  AnimTranslateLinear,
  ArcTan2Neg,
  GetBattlerSpriteCoord,
  InitAnimArcTranslation,
  InitAnimLinearTranslationWithSpeed,
  InitSpritePosToAnimAttacker,
  SetAverageBattlerPositions,
  StartAnimLinearTranslation,
  TranslateAnimHorizontalArc,
  TrySetSpriteRotScale,
} from './animMons';
import { anim, DestroyAnimSprite, gBattleAnimArgs } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

// AnimTranslateWebThread (String Shot). Args: x, y, speed, amplitude, both targets.
const AnimTranslateWebThread: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  const d = sprite.data;
  d[0] = gBattleAnimArgs[2];
  d[1] = sprite.x;
  d[3] = sprite.y;
  if (!gBattleAnimArgs[4]) {
    d[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
    d[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  } else {
    const p = SetAverageBattlerPositions(anim.target, true);
    d[2] = p.x;
    d[4] = p.y;
  }
  InitAnimLinearTranslationWithSpeed(sprite);
  d[5] = gBattleAnimArgs[3];
  sprite.callback = AnimTranslateWebThread_Step;
};

function AnimTranslateWebThread_Step(sprite: Sprite): void {
  if (AnimTranslateLinear(sprite)) {
    DestroyAnimSprite(sprite);
    return;
  }
  sprite.x2 += Sin(sprite.data[6], sprite.data[5]);
  sprite.data[6] = (sprite.data[6] + 13) & 0xff;
}

/** AnimStringWrap: the string around the target, flickering. Args: x, y. */
const AnimStringWrap: SpriteCallback = (sprite) => {
  const p = SetAverageBattlerPositions(anim.target, false);
  sprite.x = p.x;
  sprite.y = p.y;
  if (isOpponent(anim.attacker)) sprite.x -= gBattleAnimArgs[0];
  else sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) sprite.y += 8;
  sprite.callback = AnimStringWrap_Step;
};

function AnimStringWrap_Step(sprite: Sprite): void {
  if (++sprite.data[0] === 3) {
    sprite.data[0] = 0;
    sprite.invisible = !sprite.invisible;
  }
  if (++sprite.data[1] === 51) DestroyAnimSprite(sprite);
}

/** AnimTranslateStinger (Poison Sting, Twineedle): rotated to point along its path. Args: x, y, target x, target y, duration. */
const AnimTranslateStinger: SpriteCallback = (sprite) => {
  if (isOpponent(anim.attacker)) {
    gBattleAnimArgs[2] = -gBattleAnimArgs[2];
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
  }
  if (getBattlerSide(anim.attacker) === getBattlerSide(anim.target)) {
    const pos = getBattlerPosition(anim.target);
    if (pos === K.B_POSITION_PLAYER_LEFT || pos === K.B_POSITION_OPPONENT_LEFT) {
      gBattleAnimArgs[2] = -gBattleAnimArgs[2];
      gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    }
  }
  InitSpritePosToAnimAttacker(sprite, true);
  const lVarX = (GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[2]) << 16 >> 16;
  const lVarY = (GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3]) << 16 >> 16;
  const rot = (ArcTan2Neg(lVarX - sprite.x, lVarY - sprite.y) + 0xc000) & 0xffff;
  TrySetSpriteRotScale(sprite, false, 0x100, 0x100, rot);
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = lVarX;
  sprite.data[4] = lVarY;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

// AnimMissileArc (Pin Missile, Icicle Spear): arcs to the target, rotated along the arc by looking one
// step ahead. Args: x, y, target x, target y, duration, arc height.
const AnimMissileArc: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  if (getBattlerSide(anim.attacker) !== K.B_SIDE_PLAYER) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[3];
  sprite.data[5] = gBattleAnimArgs[5];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimMissileArc_Step;
  sprite.invisible = true;
};

function AnimMissileArc_Step(sprite: Sprite): void {
  sprite.invisible = false;
  if (TranslateAnimHorizontalArc(sprite)) {
    DestroyAnimSprite(sprite);
    return;
  }
  const tempData = sprite.data.slice();
  const x2 = ((sprite.x2 + sprite.x) << 16) >> 16;
  const y2 = ((sprite.y2 + sprite.y) << 16) >> 16;
  // The look-ahead step's x2/y2 are what this frame shows; data rewinds so the next frame redoes it.
  if (!TranslateAnimHorizontalArc(sprite)) {
    const rotation = (ArcTan2Neg(sprite.x + sprite.x2 - x2, sprite.y + sprite.y2 - y2) + 0xc000) & 0xffff;
    TrySetSpriteRotScale(sprite, false, 0x100, 0x100, rotation);
    sprite.data.set(tempData);
  }
}

export const bugSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimTranslateWebThread,
  AnimStringWrap,
  AnimTranslateStinger,
  AnimMissileArc,
};

export const bugTasks: Record<string, TaskFunc> = {};
