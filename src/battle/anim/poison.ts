// battle_anim_poison.c: every sprite callback in the file (it has no tasks).

import { StartSpriteAnim, StoreSpriteCallbackInData6, type AnimCmd, type Sprite, type SpriteCallback } from '../../gba/sprite';
import type { TaskFunc } from '../../gba/task';
import { K } from '../constants';
import { animTable } from '../gfx';
import { Sin } from '../trig';
import { getBattlerSide } from '../util';
import {
  GetBattlerSpriteCoord,
  InitAnimArcTranslation,
  InitSpriteDataForLinearTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  SetAverageBattlerPositions,
  StartAnimLinearTranslation,
  TranslateAnimHorizontalArc,
  TranslateSpriteLinearFixedPoint,
} from './animMons';
import { anim, DestroyAnimSprite, gBattleAnimArgs } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

let sPoisonProjectileAnimsPastEnd: AnimCmd[][] | undefined;

/**
 * StartSpriteAnim(sprite, 2) on a sAnims_PoisonProjectile sprite: that table has one entry, so the C reads past
 * its end into the tables declared after it (sAnims_AcidPoisonDroplet, sAnims_SludgeBombHit), and anim 2 is
 * sAnim_SludgeBombHit. The sprite gets a table laid out like that ROM data.
 */
function StartPoisonProjectileAnim2(sprite: Sprite): void {
  const unit = 'battle_anim_poison.c';
  sPoisonProjectileAnimsPastEnd ??= [
    ...animTable(unit, 'sAnims_PoisonProjectile'),
    ...animTable(unit, 'sAnims_AcidPoisonDroplet'),
    ...animTable(unit, 'sAnims_SludgeBombHit'),
  ];
  sprite.anims = sPoisonProjectileAnimsPastEnd;
  StartSpriteAnim(sprite, 2);
}

/** AnimSludgeProjectile (Sludge, Sludge Bomb): arcs to the target. Args: x, y, duration, keep the bubble frame. */
const AnimSludgeProjectile: SpriteCallback = (sprite) => {
  if (!gBattleAnimArgs[3]) StartPoisonProjectileAnim2(sprite);
  InitSpritePosToAnimAttacker(sprite, true);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  sprite.data[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  sprite.data[5] = -30;
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimSludgeProjectile_Step;
};

function AnimSludgeProjectile_Step(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) DestroyAnimSprite(sprite);
}

/** AnimAcidPoisonBubble (Acid): arcs to the targets' middle. Args: x, y, duration, keep the bubble frame, target x, target y. */
const AnimAcidPoisonBubble: SpriteCallback = (sprite) => {
  if (!gBattleAnimArgs[3]) StartPoisonProjectileAnim2(sprite);
  InitSpritePosToAnimAttacker(sprite, true);
  const p = SetAverageBattlerPositions(anim.target, true);
  if (getBattlerSide(anim.attacker)) gBattleAnimArgs[4] = -gBattleAnimArgs[4];
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.data[2] = p.x + gBattleAnimArgs[4];
  sprite.data[4] = p.y + gBattleAnimArgs[5];
  sprite.data[5] = -30;
  InitAnimArcTranslation(sprite);
  sprite.callback = AnimAcidPoisonBubble_Step;
};

function AnimAcidPoisonBubble_Step(sprite: Sprite): void {
  if (TranslateAnimHorizontalArc(sprite)) DestroyAnimSprite(sprite);
}

/** AnimSludgeBombHitParticle: a splash flying out, slowing to a stop. Args: x distance, y distance, duration. */
const AnimSludgeBombHitParticle: SpriteCallback = (sprite) => {
  const d = sprite.data;
  d[0] = gBattleAnimArgs[2];
  d[1] = sprite.x;
  d[2] = sprite.x + gBattleAnimArgs[0];
  d[3] = sprite.y;
  d[4] = sprite.y + gBattleAnimArgs[1];
  InitSpriteDataForLinearTranslation(sprite);
  d[5] = Math.trunc(d[1] / gBattleAnimArgs[2]);
  d[6] = Math.trunc(d[2] / gBattleAnimArgs[2]);
  sprite.callback = AnimSludgeBombHitParticle_Step;
};

function AnimSludgeBombHitParticle_Step(sprite: Sprite): void {
  TranslateSpriteLinearFixedPoint(sprite);
  sprite.data[1] -= sprite.data[5];
  sprite.data[2] -= sprite.data[6];
  if (!sprite.data[0]) DestroyAnimSprite(sprite);
}

/** AnimAcidPoisonDroplet (Acid): drips down from the targets' middle. Args: x, y, x distance, -, duration. */
const AnimAcidPoisonDroplet: SpriteCallback = (sprite) => {
  const p = SetAverageBattlerPositions(anim.target, true);
  sprite.x = p.x;
  sprite.y = p.y;
  if (isOpponent(anim.attacker)) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
  sprite.x += gBattleAnimArgs[0];
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = gBattleAnimArgs[4];
  sprite.data[2] = sprite.x + gBattleAnimArgs[2];
  sprite.data[4] = sprite.y + sprite.data[0];
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimBubbleEffect: a bubble rising and growing (poison moves, Bubble). Args: x, y, both targets. */
const AnimBubbleEffect: SpriteCallback = (sprite) => {
  if (!gBattleAnimArgs[2]) {
    InitSpritePosToAnimTarget(sprite, true);
  } else {
    const p = SetAverageBattlerPositions(anim.target, true);
    sprite.x = p.x;
    sprite.y = p.y;
    if (isOpponent(anim.attacker)) gBattleAnimArgs[0] = -gBattleAnimArgs[0];
    sprite.x += gBattleAnimArgs[0];
    sprite.y += gBattleAnimArgs[1];
  }
  sprite.callback = AnimBubbleEffect_Step;
};

function AnimBubbleEffect_Step(sprite: Sprite): void {
  sprite.data[0] = (sprite.data[0] + 0xb) & 0xff;
  sprite.x2 = Sin(sprite.data[0], 4);
  sprite.data[1] += 0x30;
  sprite.y2 = -(sprite.data[1] >> 8);
  if (sprite.affineAnimEnded) DestroyAnimSprite(sprite);
}

export const poisonSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimSludgeProjectile,
  AnimAcidPoisonBubble,
  AnimSludgeBombHitParticle,
  AnimAcidPoisonDroplet,
  AnimBubbleEffect,
};

export const poisonTasks: Record<string, TaskFunc> = {};
