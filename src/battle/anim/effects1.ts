// battle_anim_effects_1.c: sprite callbacks and tasks, ported as the moves that use them come up.

import {
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { type TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  DestroySpriteAndMatrix,
  GetBattlerSpriteCoord,
  InitAnimArcTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  SetAnimSpriteInitialXOffset,
  SetSpriteCoordsToAnimAttackerCoords,
  StartAnimLinearTranslation,
  TranslateAnimHorizontalArc,
  WaitAnimForDuration,
} from './animMons';
import { anim, DestroyAnimSprite, gBattleAnimArgs } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

// AnimMovePowderParticle (Sleep Powder, Stun Spore, Poison Powder). Args: x, y, duration, vertical
// speed (subpixel), wave amplitude, wave speed.
const AnimMovePowderParticle: SpriteCallback = (sprite) => {
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[3] = getBattlerSide(anim.attacker) ? -gBattleAnimArgs[4] : gBattleAnimArgs[4];
  sprite.data[4] = gBattleAnimArgs[5];
  sprite.callback = AnimMovePowderParticle_Step;
};

function AnimMovePowderParticle_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] > 0) {
    d[0]--;
    sprite.y2 = d[2] >> 8;
    d[2] += d[1];
    sprite.x2 = Sin(d[5], d[3]);
    d[5] = (d[5] + d[4]) & 0xff;
  } else {
    DestroyAnimSprite(sprite);
  }
}

/** AnimPowerAbsorptionOrb: an orb moving into the attacker. Args: x, y, duration. */
const AnimPowerAbsorptionOrb: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
};

/** AnimAbsorptionOrb: target -> attacker in an arc. Args: x, y, wave amplitude, duration. */
const AnimAbsorptionOrb: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, true);
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.data[2] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[5] = gBattleAnimArgs[2];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimAbsorptionOrb_Step;
};

function AnimAbsorptionOrb_Step(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) DestroyAnimSprite(sprite);
}

// AnimLeechSeed: a seed arcs to the target and sprouts. Args: x, y, target x, target y, duration, amplitude.
const AnimLeechSeed: SpriteCallback = (sprite) => {
  InitSpritePosToAnimAttacker(sprite, true);
  if (isOpponent(anim.attacker)) gBattleAnimArgs[2] = -gBattleAnimArgs[2];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X) + gBattleAnimArgs[2];
  sprite.data[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y) + gBattleAnimArgs[3];
  sprite.data[5] = gBattleAnimArgs[5];
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimLeechSeed_Step;
};

function AnimLeechSeed_Step(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) {
    sprite.invisible = true;
    sprite.data[0] = 10;
    sprite.callback = WaitAnimForDuration;
    StoreSpriteCallbackInData6(sprite, AnimLeechSeedSprouts);
  }
}

function AnimLeechSeedSprouts(sprite: Sprite): void {
  sprite.invisible = false;
  StartSpriteAnim(sprite, 1);
  sprite.data[0] = 60;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

/** AnimWhipHit (Vine Whip, Slam). Args: x, y. */
const AnimWhipHit: SpriteCallback = (sprite) => {
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) StartSpriteAnim(sprite, 1);
  sprite.callback = AnimWhipHit_WaitEnd;
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
};

function AnimWhipHit_WaitEnd(sprite: Sprite): void {
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}

/** AnimSleepLetterZ (Status_Sleep, Rest). Args: x, y. */
const AnimSleepLetterZ: SpriteCallback = (sprite) => {
  SetSpriteCoordsToAnimAttackerCoords(sprite);
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    sprite.data[3] = 1;
  } else {
    sprite.x -= gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
    sprite.data[3] = -1; // 0xFFFF
    StartSpriteAffineAnim(sprite, 1);
  }
  sprite.callback = AnimSleepLetterZ_Step;
};

function AnimSleepLetterZ_Step(sprite: Sprite): void {
  const d = sprite.data;
  sprite.y2 = -Math.trunc(d[0] / 0x28);
  sprite.x2 = Math.trunc(d[4] / 10);
  d[4] += d[3] * 2;
  d[0] += d[1];
  if (++d[1] > 60) DestroySpriteAndMatrix(sprite);
}

export const effects1SpriteCallbacks: Record<string, SpriteCallback> = {
  AnimMovePowderParticle,
  AnimPowerAbsorptionOrb,
  AnimAbsorptionOrb,
  AnimLeechSeed,
  AnimWhipHit,
  AnimSleepLetterZ,
};

export const effects1Tasks: Record<string, TaskFunc> = {
};
