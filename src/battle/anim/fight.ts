// battle_anim_fight.c: every sprite callback and task in the file.

import { REG_OFFSET_BLDCNT, SetGpuReg } from '../../gba/hw';
import {
  CreateSprite,
  DestroySprite,
  FreeOamMatrix,
  gSprites,
  MAX_SPRITES,
  SpriteCallbackDummy,
  StartSpriteAffineAnim,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  ST_OAM_HFLIP,
  ST_OAM_VFLIP,
  type Sprite,
  type SpriteCallback,
} from '../../gba/sprite';
import { gTasks, type TaskFunc } from '../../gba/task';
import { random } from '../../util/random';
import { K } from '../constants';
import { g } from '../env';
import { Sin } from '../trig';
import { getBattlerPosition, getBattlerSide } from '../util';
import {
  AnimTranslateLinear,
  AnimTranslateLinear_WithFollowup,
  AnimTravelDiagonally,
  BATTLE_PARTNER,
  DestroySpriteAndMatrix,
  GetBattlerSpriteBGPriority,
  GetBattlerSpriteCoord,
  GetBattlerSpriteCoordAttr,
  InitAnimLinearTranslation,
  InitSpritePosToAnimAttacker,
  InitSpritePosToAnimTarget,
  RunStoredCallbackWhenAnimEnds,
  SetAnimSpriteInitialXOffset,
  StartAnimLinearTranslation,
  ToggleBg3Mode,
  WaitAnimForDuration,
} from './animMons';
import { animSpriteTemplate } from './battleAnim';
import { anim, DestroyAnimSprite, DestroyAnimVisualTask, gBattleAnimArgs } from './state';

const isOpponent = (battler: number) => getBattlerSide(battler) !== K.B_SIDE_PLAYER;

/** AnimUnusedHumanoidFoot (sUnusedHumanoidFootSpriteTemplate, which no script uses) */
const AnimUnusedHumanoidFoot: SpriteCallback = (sprite) => {
  SetAnimSpriteInitialXOffset(sprite, gBattleAnimArgs[0]);
  sprite.y += gBattleAnimArgs[1];
  sprite.data[0] = 15;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimSlideHandOrFootToTarget (Karate Chop): AnimTravelDiagonally with anim arg 6; arg 7 == 1 mirrors y for an opponent attacker. */
const AnimSlideHandOrFootToTarget: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[7] === 1 && isOpponent(anim.attacker)) {
    gBattleAnimArgs[1] = -gBattleAnimArgs[1];
    gBattleAnimArgs[3] = -gBattleAnimArgs[3];
  }
  StartSpriteAnim(sprite, gBattleAnimArgs[6]);
  gBattleAnimArgs[6] = 0;
  AnimTravelDiagonally(sprite);
};

/** AnimJumpKick (Jump Kick, Hi Jump Kick): AnimSlideHandOrFootToTarget (the contest flip never applies) */
const AnimJumpKick: SpriteCallback = (sprite) => {
  AnimSlideHandOrFootToTarget(sprite);
};

/** AnimBasicFistOrFoot: shows a fist or foot on a battler. Args: x, y, duration, battler (0 attacker), anim. */
const AnimBasicFistOrFoot: SpriteCallback = (sprite) => {
  StartSpriteAnim(sprite, gBattleAnimArgs[4]);
  if (gBattleAnimArgs[3] === 0) InitSpritePosToAnimAttacker(sprite, true);
  else InitSpritePosToAnimTarget(sprite, true);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

// AnimFistOrFootRandomPos (Double Kick, Thrash): a fist/foot at a random spot on a battler, over a still hit
// splat. Args: battler (0 attacker), duration, anim (< 0: random).
const AnimFistOrFootRandomPos: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  if (gBattleAnimArgs[2] < 0) gBattleAnimArgs[2] = random() % 5;
  StartSpriteAnim(sprite, gBattleAnimArgs[2]);
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET);
  const xMod = Math.trunc(GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_WIDTH) / 2);
  const yMod = Math.trunc(GetBattlerSpriteCoordAttr(battler, K.BATTLER_COORD_ATTR_HEIGHT) / 4);
  let x = random() % xMod;
  let y = random() % yMod;
  if (random() & 1) x = -x;
  if (random() & 1) y = -y;
  if ((g.battlerPositions[battler] & K.BIT_SIDE) === K.B_SIDE_PLAYER) y -= 16; // y += 0xFFF0
  sprite.x += x;
  sprite.y += y;
  sprite.data[0] = gBattleAnimArgs[1];
  sprite.data[7] = CreateSprite(animSpriteTemplate('gBasicHitSplatSpriteTemplate', true)!, sprite.x, sprite.y, sprite.subpriority + 1);
  if (sprite.data[7] !== MAX_SPRITES) {
    StartSpriteAffineAnim(gSprites[sprite.data[7]], 0);
    gSprites[sprite.data[7]].callback = SpriteCallbackDummy;
  }
  sprite.callback = AnimFistOrFootRandomPos_Step;
};

function AnimFistOrFootRandomPos_Step(sprite: Sprite): void {
  if (sprite.data[0] === 0) {
    if (sprite.data[7] !== MAX_SPRITES) {
      FreeOamMatrix(gSprites[sprite.data[7]].oam.matrixNum);
      DestroySprite(gSprites[sprite.data[7]]);
    }
    DestroyAnimSprite(sprite);
  } else {
    sprite.data[0]--;
  }
}

/** AnimCrossChopHand: a hand slides up and in, then back across. Args: x, y, side (0 left, else right, flipped). */
const AnimCrossChopHand: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, true);
  sprite.data[0] = 30;
  if (gBattleAnimArgs[2] === 0) {
    sprite.data[2] = sprite.x - 20;
  } else {
    sprite.data[2] = sprite.x + 20;
    sprite.hFlip = true;
  }
  sprite.data[4] = sprite.y - 20;
  sprite.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(sprite, AnimCrossChopHand_Step);
};

function AnimCrossChopHand_Step(sprite: Sprite): void {
  if (++sprite.data[5] === 11) {
    sprite.data[2] = sprite.x - sprite.x2;
    sprite.data[4] = sprite.y - sprite.y2;
    sprite.data[0] = 8;
    sprite.x += sprite.x2;
    sprite.y += sprite.y2;
    sprite.y2 = 0;
    sprite.x2 = 0;
    sprite.callback = StartAnimLinearTranslation;
    StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  }
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

// AnimSpinningKickOrPunch (Mega Punch, Mega Kick, Blaze Kick, Meteor Mash): waits, then spins and shrinks
// (its affine anim). Args: x, y, anim, wait.
const AnimSpinningKickOrPunch: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, true);
  StartSpriteAnim(sprite, gBattleAnimArgs[2]);
  sprite.data[0] = gBattleAnimArgs[3];
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, AnimSpinningKickOrPunchFinish);
};

function AnimSpinningKickOrPunchFinish(sprite: Sprite): void {
  StartSpriteAffineAnim(sprite, 0);
  sprite.affineAnimPaused = true;
  sprite.data[0] = 20;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

/** AnimStompFoot: waits, then slides down onto the target. Args: x, y, wait. */
const AnimStompFoot: SpriteCallback = (sprite) => {
  InitSpritePosToAnimTarget(sprite, true);
  sprite.data[0] = gBattleAnimArgs[2];
  sprite.callback = AnimStompFootStep;
};

function AnimStompFootStep(sprite: Sprite): void {
  if (--sprite.data[0] === -1) {
    sprite.data[0] = 6;
    sprite.data[2] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
    sprite.data[4] = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
    sprite.callback = StartAnimLinearTranslation;
    StoreSpriteCallbackInData6(sprite, AnimStompFootEnd);
  }
}

function AnimStompFootEnd(sprite: Sprite): void {
  sprite.data[0] = 15;
  sprite.callback = WaitAnimForDuration;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
}

/** AnimDizzyPunchDuck: a duck circling over the target, flickering out. Args: x, y, x speed, amplitude. */
const AnimDizzyPunchDuck: SpriteCallback = (sprite) => {
  const d = sprite.data;
  if (d[0] === 0) {
    InitSpritePosToAnimTarget(sprite, true);
    d[1] = gBattleAnimArgs[2];
    d[2] = gBattleAnimArgs[3];
    d[0]++;
  } else {
    d[4] += d[1];
    sprite.x2 = d[4] >> 8;
    sprite.y2 = Sin(d[3], d[2]);
    d[3] = (d[3] + 3) & 0xff;
    if (d[3] > 100) sprite.invisible = (d[3] % 2) !== 0;
    if (d[3] > 120) DestroyAnimSprite(sprite);
  }
};

/** AnimBrickBreakWall: the target's wall, shaking before it breaks. Args: battler, x, y, wait, shake duration (0: none). */
const AnimBrickBreakWall: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === 0 ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X);
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y);
  sprite.x += gBattleAnimArgs[1];
  sprite.y += gBattleAnimArgs[2];
  sprite.data[0] = 0;
  sprite.data[1] = gBattleAnimArgs[3];
  sprite.data[2] = gBattleAnimArgs[4];
  sprite.data[3] = 0;
  sprite.callback = AnimBrickBreakWall_Step;
};

function AnimBrickBreakWall_Step(sprite: Sprite): void {
  const d = sprite.data;
  switch (d[0]) {
    case 0:
      if (--d[1] === 0) {
        if (d[2] === 0) DestroyAnimSprite(sprite);
        else d[0]++;
      }
      break;
    case 1:
      if (++d[1] > 1) {
        d[1] = 0;
        d[3]++;
        sprite.x2 = d[3] & 1 ? 2 : -2;
      }
      if (--d[2] === 0) DestroyAnimSprite(sprite);
      break;
  }
}

/** AnimBrickBreakWallShard: a quarter of the broken wall flies off diagonally. Args: battler, quarter (0-3), x, y. */
const AnimBrickBreakWallShard: SpriteCallback = (sprite) => {
  const battler = gBattleAnimArgs[0] === K.ANIM_ATTACKER ? anim.attacker : anim.target;
  sprite.x = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X) + gBattleAnimArgs[2];
  sprite.y = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y) + gBattleAnimArgs[3];
  sprite.oam.tileNum += gBattleAnimArgs[1] * 16;
  sprite.data[0] = 0;
  const v = [[-3, -3], [3, -3], [-3, 3], [3, 3]][gBattleAnimArgs[1]];
  if (!v) {
    DestroyAnimSprite(sprite);
    return;
  }
  sprite.data[6] = v[0];
  sprite.data[7] = v[1];
  sprite.callback = AnimBrickBreakWallShard_Step;
};

function AnimBrickBreakWallShard_Step(sprite: Sprite): void {
  sprite.x += sprite.data[6];
  sprite.y += sprite.data[7];
  if (++sprite.data[0] > 40) DestroyAnimSprite(sprite);
}

// AnimSuperpowerOrb: the orb grows on a battler for 180 frames, then flies to the other one. Arg 0: on the
// attacker (0) or target. Uses gBattlerAttacker, not gBattleAnimAttacker, like the C.
const AnimSuperpowerOrb: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[0] === 0) {
    sprite.x = GetBattlerSpriteCoord(g.battlerAttacker, K.BATTLER_COORD_X_2);
    sprite.y = GetBattlerSpriteCoord(g.battlerAttacker, K.BATTLER_COORD_Y_PIC_OFFSET);
    sprite.oam.priority = GetBattlerSpriteBGPriority(anim.attacker);
    sprite.data[7] = anim.target;
  } else {
    sprite.oam.priority = GetBattlerSpriteBGPriority(anim.target);
    sprite.data[7] = anim.attacker;
  }
  sprite.data[0] = 0;
  sprite.data[1] = 12;
  sprite.data[2] = 8;
  sprite.callback = AnimSuperpowerOrb_Step;
};

function AnimSuperpowerOrb_Step(sprite: Sprite): void {
  const d = sprite.data;
  if (++d[0] === 180) {
    SetGpuReg(REG_OFFSET_BLDCNT, 0);
    d[0] = 16;
    d[1] = sprite.x;
    d[2] = GetBattlerSpriteCoord(d[7], K.BATTLER_COORD_X_2);
    d[3] = sprite.y;
    d[4] = GetBattlerSpriteCoord(d[7], K.BATTLER_COORD_Y_PIC_OFFSET);
    InitAnimLinearTranslation(sprite);
    StoreSpriteCallbackInData6(sprite, DestroySpriteAndMatrix);
    sprite.callback = AnimTranslateLinear_WithFollowup;
  }
}

// AnimSuperpowerRock: a rock rises from the bottom of the screen, then flies off along the attacker-to-target
// line. Args: x, rise speed (Q8), image (rock size), rise duration.
const AnimSuperpowerRock: SpriteCallback = (sprite) => {
  sprite.x = gBattleAnimArgs[0];
  sprite.y = 120;
  sprite.data[0] = gBattleAnimArgs[3];
  // StorePointerInVars(&data[4], &data[5], y << 8): a 32-bit value split over two halves
  storeVars(sprite, sprite.y << 8);
  sprite.data[6] = gBattleAnimArgs[1];
  sprite.oam.tileNum += gBattleAnimArgs[2] * 4;
  sprite.callback = AnimSuperpowerRock_Step1;
};

const loadVars = (sprite: Sprite) => (sprite.data[4] & 0xffff) | (sprite.data[5] << 16);
function storeVars(sprite: Sprite, v: number): void {
  sprite.data[4] = v & 0xffff;
  sprite.data[5] = v >> 16;
}

function AnimSuperpowerRock_Step1(sprite: Sprite): void {
  const d = sprite.data;
  if (d[0] !== 0) {
    const v = (loadVars(sprite) - d[6]) | 0;
    storeVars(sprite, v);
    sprite.y = (v >> 8) << 16 >> 16;
    if (sprite.y < -8) DestroyAnimSprite(sprite);
    else d[0]--;
  } else {
    const pos0 = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_X_2);
    const pos1 = GetBattlerSpriteCoord(anim.attacker, K.BATTLER_COORD_Y_PIC_OFFSET);
    const pos2 = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
    const pos3 = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
    d[0] = pos2 - pos0;
    d[1] = pos3 - pos1;
    d[2] = sprite.x << 4;
    d[3] = sprite.y << 4;
    sprite.callback = AnimSuperpowerRock_Step2;
  }
}

function AnimSuperpowerRock_Step2(sprite: Sprite): void {
  const d = sprite.data;
  d[2] += d[0];
  d[3] += d[1];
  sprite.x = d[2] >> 4;
  sprite.y = d[3] >> 4;
  const edgeX = (sprite.x + 8) & 0xffff;
  if (edgeX > 256 || sprite.y < -8 || sprite.y > 120) DestroyAnimSprite(sprite);
}

/** AnimSuperpowerFireball: flies from one battler to the other, flipped to face it. Arg 0: from the attacker (0) or target. */
const AnimSuperpowerFireball: SpriteCallback = (sprite) => {
  let battler: number;
  if (gBattleAnimArgs[0] === K.ANIM_ATTACKER) {
    sprite.x = GetBattlerSpriteCoord(g.battlerAttacker, K.BATTLER_COORD_X_2);
    sprite.y = GetBattlerSpriteCoord(g.battlerAttacker, K.BATTLER_COORD_Y_PIC_OFFSET);
    battler = anim.target;
    sprite.oam.priority = GetBattlerSpriteBGPriority(anim.attacker);
  } else {
    battler = anim.attacker;
    sprite.oam.priority = GetBattlerSpriteBGPriority(anim.target);
  }
  if (getBattlerSide(battler) === K.B_SIDE_PLAYER) sprite.oam.matrixNum |= ST_OAM_HFLIP | ST_OAM_VFLIP;
  const d = sprite.data;
  d[0] = 16;
  d[1] = sprite.x;
  d[2] = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_X_2);
  d[3] = sprite.y;
  d[4] = GetBattlerSpriteCoord(battler, K.BATTLER_COORD_Y_PIC_OFFSET);
  InitAnimLinearTranslation(sprite);
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
  sprite.callback = AnimTranslateLinear_WithFollowup;
};

function AnimArmThrustHit_Step(sprite: Sprite): void {
  if (sprite.data[0] === sprite.data[4]) DestroyAnimSprite(sprite);
  sprite.data[0]++;
}

/** AnimArmThrustHit: a palm on the target, alternating sides each hit (gAnimMoveTurn). Args: x, y, duration, anim. */
const AnimArmThrustHit: SpriteCallback = (sprite) => {
  sprite.x = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_X_2);
  sprite.y = GetBattlerSpriteCoord(anim.target, K.BATTLER_COORD_Y_PIC_OFFSET);
  const d = sprite.data;
  d[1] = gBattleAnimArgs[3];
  d[2] = gBattleAnimArgs[0];
  d[3] = gBattleAnimArgs[1];
  d[4] = gBattleAnimArgs[2];
  let turn = anim.moveTurn & 0xff;
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) turn = (turn + 1) & 0xff;
  if (turn & 1) {
    d[2] = -d[2];
    d[1]++;
  }
  StartSpriteAnim(sprite, d[1]);
  sprite.x2 = d[2];
  sprite.y2 = d[3];
  sprite.callback = AnimArmThrustHit_Step;
};

/** AnimRevengeScratch: plays its anim once (mirrored for an opponent attacker). Arg 2: battler. */
const AnimRevengeScratch: SpriteCallback = (sprite) => {
  if (gBattleAnimArgs[2] === K.ANIM_ATTACKER) InitSpritePosToAnimAttacker(sprite, false);
  else InitSpritePosToAnimTarget(sprite, false);
  if (isOpponent(anim.attacker)) StartSpriteAnim(sprite, 1);
  sprite.callback = RunStoredCallbackWhenAnimEnds;
  StoreSpriteCallbackInData6(sprite, DestroyAnimSprite);
};

/** AnimFocusPunchFist: shrinks onto the target (its affine anim), then shakes. */
const AnimFocusPunchFist: SpriteCallback = (sprite) => {
  if (sprite.affineAnimEnded) {
    sprite.data[1] = (sprite.data[1] + 40) & 0xff;
    sprite.x2 = Sin(sprite.data[1], 2);
    if (++sprite.data[0] > 40) DestroyAnimSprite(sprite);
  }
};

// AnimTask_MoveSkyUppercutBg: scrolls BG3 (the upward-streaks background) diagonally, speeding up after a
// wait (arg 0), until the script sets arg 7 to -1.
const AnimTask_MoveSkyUppercutBg: TaskFunc = (taskId) => {
  const d = gTasks[taskId].data;
  switch (d[0]) {
    case 0:
      ToggleBg3Mode(false);
      d[8] = gBattleAnimArgs[0];
      d[0]++;
      break;
    case 1:
      if (--d[8] === -1) d[0]++;
      break;
    default:
      d[9] += 1280;
      break;
  }
  d[10] += 2816;
  if (getBattlerSide(anim.target) === K.B_SIDE_PLAYER) g.battle_BG3_X += d[9] >> 8;
  else g.battle_BG3_X -= d[9] >> 8;
  g.battle_BG3_Y += d[10] >> 8;
  d[9] &= 0xff;
  d[10] &= 0xff;
  if (gBattleAnimArgs[7] === -1) {
    g.battle_BG3_X = 0;
    g.battle_BG3_Y = 0;
    ToggleBg3Mode(true);
    DestroyAnimVisualTask(taskId);
  }
};

export const fightSpriteCallbacks: Record<string, SpriteCallback> = {
  AnimUnusedHumanoidFoot,
  AnimSlideHandOrFootToTarget,
  AnimJumpKick,
  AnimBasicFistOrFoot,
  AnimFistOrFootRandomPos,
  AnimCrossChopHand,
  AnimSlidingKick,
  AnimSpinningKickOrPunch,
  AnimStompFoot,
  AnimDizzyPunchDuck,
  AnimBrickBreakWall,
  AnimBrickBreakWallShard,
  AnimSuperpowerOrb,
  AnimSuperpowerRock,
  AnimSuperpowerFireball,
  AnimArmThrustHit,
  AnimRevengeScratch,
  AnimFocusPunchFist,
};

export const fightTasks: Record<string, TaskFunc> = {
  AnimTask_MoveSkyUppercutBg,
};
