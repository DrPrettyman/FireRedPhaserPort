// battle_anim_effects_1.c: sprite callbacks and tasks, ported as the moves that use them come up.

import {
  ST_OAM_HFLIP,
  ST_OAM_OBJ_NORMAL,
  ST_OAM_VFLIP,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import type { TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { g } from '../env';
import { Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  DestroySpriteAndMatrix,
  GetBattlerSpriteCoord,
  InitAnimArcTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  PrepareBattlerSpriteForRotScale,
  ResetSpriteRotScale,
  SetAnimSpriteInitialXOffset,
  SetBattlerSpriteYOffsetFromRotation,
  SetSpriteCoordsToAnimAttackerCoords,
  SetSpriteRotScale,
  StartAnimLinearTranslation,
  TranslateAnimHorizontalArc,
  TranslateSpriteLinearById,
  TranslateSpriteLinearFixedPoint,
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

/** AnimGrantingStars (Focus Energy, Wish heal): linear drift. Args: x, y, attacker coords (0) or as-is, x speed, y speed, duration. */
const AnimGrantingStars: SpriteCallback = (sprite) => {
  if (!gBattleAnimArgs[2]) SetSpriteCoordsToAnimAttackerCoords(sprite);
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[5];
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[2] = gBattleAnimArgs[4];
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = TranslateSpriteLinearFixedPoint;
};

/** AnimEndureEnergy (Endure, Focus Energy): rises, speeding up. Args: battler, x, y, frames per extra pixel. */
const AnimEndureEnergy: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X) + gBattleAnimArgs[1];
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y) + gBattleAnimArgs[2];
  sprite.data[0] = 0;
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.callback = AnimEndureEnergy_Step;
};

function AnimEndureEnergy_Step(sprite: Sprite): void {
  if (++sprite.data[0] > sprite.data[1]) {
    sprite.data[0] = 0;
    sprite.y--;
  }
  sprite.y -= sprite.data[0];
  if (sprite.animEnded) DestroyAnimSprite(sprite);
}

/** AnimCuttingSlice (Cut): an arcing slice over the target. Args: x, y, flipped. */
const AnimCuttingSlice: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X);
  sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y);
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) sprite.y += 8;
  sprite.callback = AnimSlice_Step;
  if (gBattleAnimArgs[2] === 0) {
    sprite.x += gBattleAnimArgs[0];
  } else {
    sprite.x -= gBattleAnimArgs[0];
    sprite.hFlip = true;
  }
  sprite.y += gBattleAnimArgs[1];
  sprite.data[1] -= 0x400;
  sprite.data[2] += 0x400;
  sprite.data[5] = gBattleAnimArgs[2];
  if (sprite.data[5] === 1) sprite.data[1] = -sprite.data[1];
};

function AnimSlice_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[3] += d[1];
  d[4] += d[2];
  if (d[5] === 0) d[1] += 0x18;
  else d[1] -= 0x18;
  d[2] -= 0x18;
  sprite.x2 = d[3] >> 8;
  sprite.y2 = d[4] >> 8;
  d[0]++;
  if (d[0] === 20) {
    StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
    d[0] = 3;
    sprite.callback = WaitAnimForDuration;
  }
}

// AnimBowMon (Headbutt, Take Down, ...): an invisible sprite that rocks the attacker. Arg 0 picks the
// step: 0 lean back, 1 lunge forward, 2 rock back upright, else nothing.
const AnimBowMon: SpriteCallback = (sprite) => {
  sprite.invisible = true;
  sprite.data[0] = 0;
  switch (gBattleAnimArgs[0]) {
    case 0:
      sprite.callback = AnimBowMon_Step1;
      break;
    case 1:
      sprite.callback = AnimBowMon_Step2;
      break;
    case 2:
      sprite.callback = AnimBowMon_Step3;
      break;
    default:
      sprite.callback = AnimBowMon_Step4;
      break;
  }
};

function AnimBowMon_Step1(sprite: Sprite): void {
  sprite.data[0] = 6;
  sprite.data[1] = isOpponent(anim.attacker) ? 2 : -2;
  sprite.data[2] = 0;
  sprite.data[3] = g.battlerSpriteIds[anim.attacker];
  StoreSpriteCallbackInData6(sprite, AnimBowMon_Step1_Callback);
  sprite.callback = TranslateSpriteLinearById;
}

function AnimBowMon_Step1_Callback(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] === 0) {
    d[3] = g.battlerSpriteIds[anim.attacker];
    PrepareBattlerSpriteForRotScale(d[3], ST_OAM_OBJ_NORMAL);
    d[6] = getBattlerSide(anim.attacker);
    d[4] = d[6] ? 0x300 : -0x300; // 0xFFFFFD00
    d[5] = 0;
  }
  d[5] += d[4];
  SetSpriteRotScale(d[3], 0x100, 0x100, d[5]);
  SetBattlerSpriteYOffsetFromRotation(d[3]);
  if (++d[0] > 3) {
    d[0] = 0;
    sprite.callback = AnimBowMon_Step4;
  }
}

function AnimBowMon_Step4(sprite: Sprite): void {
  DestroyAnimSprite(sprite);
}

function AnimBowMon_Step2(sprite: Sprite): void {
  sprite.data[0] = 4;
  sprite.data[1] = isOpponent(anim.attacker) ? -3 : 3;
  sprite.data[2] = 0;
  sprite.data[3] = g.battlerSpriteIds[anim.attacker];
  StoreSpriteCallbackInData6(sprite, AnimBowMon_Step4);
  sprite.callback = TranslateSpriteLinearById;
}

function AnimBowMon_Step3(sprite: Sprite): void {
  if (++sprite.data[0] > 8) {
    sprite.data[0] = 0;
    sprite.callback = AnimBowMon_Step3_Callback;
  }
}

function AnimBowMon_Step3_Callback(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] === 0) {
    d[3] = g.battlerSpriteIds[anim.attacker];
    d[6] = getBattlerSide(anim.attacker);
    if (isOpponent(anim.attacker)) {
      d[4] = -0x400; // 0xFC00
      d[5] = 0xc00;
    } else {
      d[4] = 0x400;
      d[5] = -0xc00; // 0xF400
    }
  }
  d[5] += d[4];
  SetSpriteRotScale(d[3], 0x100, 0x100, d[5]);
  SetBattlerSpriteYOffsetFromRotation(d[3]);
  if (++d[0] > 2) {
    ResetSpriteRotScale(d[3]);
    sprite.callback = AnimBowMon_Step4;
  }
}

/** AnimHornHit (Horn Attack, Fury Attack, Horn Drill): the horn thrusts into the target. Args: x, y, duration. */
const AnimHornHit: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[2] < 2) gBattleAnimArgs[2] = 2;
  if (gBattleAnimArgs[2] > 0x7f) gBattleAnimArgs[2] = 0x7f;
  const d = sprite.data;
  d[0] = 0;
  d[1] = gBattleAnimArgs[2];
  sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2) + gBattleAnimArgs[0];
  sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET) + gBattleAnimArgs[1];
  d[6] = sprite.x;
  d[7] = sprite.y;
  if (getBattlerSide(anim.attacker) === K.B_SIDE_PLAYER) {
    sprite.x -= 40;
    sprite.y += 20;
    d[2] = sprite.x << 7;
    d[3] = Math.trunc(0x1400 / d[1]);
    d[4] = sprite.y << 7;
    d[5] = Math.trunc(-0xa00 / d[1]);
  } else {
    sprite.x += 40;
    sprite.y -= 20;
    d[2] = sprite.x << 7;
    d[3] = Math.trunc(-0x1400 / d[1]);
    d[4] = sprite.y << 7;
    d[5] = Math.trunc(0xa00 / d[1]);
    sprite.oam.matrixNum = ST_OAM_HFLIP | ST_OAM_VFLIP;
  }
  sprite.callback = AnimHornHit_Step;
};

function AnimHornHit_Step(sprite: Sprite): void {
  const d = sprite.data;
  d[2] += d[3];
  d[4] += d[5];
  sprite.x = d[2] >> 7;
  sprite.y = d[4] >> 7;
  if (--d[1] === 1) {
    sprite.x = d[6];
    sprite.y = d[7];
  }
  if (d[1] === 0) DestroyAnimSprite(sprite);
}

// AnimConstrictBinding (Constrict, Bind, Wrap): waits for gBattleAnimArgs[7] == -1, then plays its
// affine anim. Args: x, y, affine anim, repeats.
const AnimConstrictBinding: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, false);
  sprite.affineAnimPaused = true;
  StartSpriteAffineAnim(sprite, gBattleAnimArgs[2]);
  sprite.data[6] = gBattleAnimArgs[2];
  sprite.data[7] = gBattleAnimArgs[3];
  sprite.callback = AnimConstrictBinding_Step1;
};

function AnimConstrictBinding_Step1(sprite: Sprite): void {
  if (gBattleAnimArgs[7] === -1) {
    sprite.affineAnimPaused = false;
    sprite.data[0] = 0x100;
    sprite.callback = AnimConstrictBinding_Step2;
  }
}

function AnimConstrictBinding_Step2(sprite: Sprite): void {
  const d = sprite.data;
  if (!d[2]) d[0] += 11;
  else d[0] -= 11;
  if (++d[1] === 6) {
    d[1] = 0;
    d[2] ^= 1;
  }
  if (sprite.affineAnimEnded) {
    if (--d[7] > 0) StartSpriteAffineAnim(sprite, d[6]);
    else DestroyAnimSprite(sprite);
  }
}

export const effects1SpriteCallbacks: Record<string, SpriteCallback> = {
  AnimMovePowderParticle,
  AnimPowerAbsorptionOrb,
  AnimAbsorptionOrb,
  AnimLeechSeed,
  AnimWhipHit,
  AnimSleepLetterZ,
  AnimGrantingStars,
  AnimEndureEnergy,
  AnimCuttingSlice,
  AnimBowMon,
  AnimHornHit,
  AnimConstrictBinding,
};

export const effects1Tasks: Record<string, TaskFunc> = {};
