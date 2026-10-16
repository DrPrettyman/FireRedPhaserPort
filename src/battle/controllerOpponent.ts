// battle_controller_opponent.c: the AI-driven opponent's controller.

import { FreeSpriteOamMatrix, FreeSpritePaletteByTag, FreeSpriteTilesByTag, GetSpriteTileStartByTag, gSprites, CreateSprite, DestroySprite, IndexOfSpritePaletteTag, SpriteCallbackDummy, StartSpriteAnim, StoreSpriteCallbackInData6, type Sprite } from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks } from '../gba/task';
import { IsTextPrinterActive } from '../gba/window';
import { DISPLAY_WIDTH } from '../gba/hw';
import { random } from '../util/random';
import { battleAI_ChooseMoveOrAction, battleAI_SetupAIData } from './ai';
import { AI_TrySwitchOrUseItem, getMostSuitableMonToSwitchInto } from './aiSwitchItems';
import { CreatePartyStatusSummarySprites, SetBattleBarStruct, SetHealthboxSpriteInvisible, SetHealthboxSpriteVisible, Task_HidePartyStatusSummary, UpdateHealthboxAttribute } from './battleInterface';
import { HandleIntroSlide } from './battleIntro';
import { ui } from './battleUi';
import { BattlePutTextOnWindow } from './battleWindow';
import { K } from './constants';
import { handleGetMonData, handleSetMonData, healthbarStep, hitAnimBlinkStep } from './controllerCommon';
import { BtlCtrl_OakOldMan_SetState2Flag, btlCtrlOakOldManTestState2Flag, PrintOakText_HowDisappointing, PrintOakText_InflictingDamageIsKey, PrintOakText_OakNoRunningFromATrainer } from './controllerOakOldMan';
import { SetMoveAnimGlobalsFromBuffer } from './anim/battleAnim';
import { doMoveAnimationStep, TryShinyAnimation } from './controllerPlayer';
import { emitChosenMonReturnValue, emitOneReturnValue, emitTwoReturnValues } from './controllers';
import { bdata, g, gBattleMoves } from './env';
import { bit } from './globals';
import {
  BattleLoadOpponentMonSpriteGfx,
  DecompressGhostFrontPic,
  ClearTemporarySpeciesSpriteData,
  CopyBattleSpriteInvisibility,
  CreateInvisibleSpriteWithCallback,
  DecompressTrainerFrontPic,
  DoHitAnimHealthboxEffect,
  DoPokeballSendOutAnimation,
  FreeTrainerFrontPicPaletteAndTile,
  GetBattlerSpriteCoord,
  GetBattlerSpriteDefault_Y,
  GetGhostSpriteDefault_Y,
  GetBattlerSpriteSubpriority,
  gMultiuseSpriteTemplate,
  HideBattlerShadowSprite,
  InitAndLaunchChosenStatusAnimation,
  InitAndLaunchSpecialAnimation,
  IsBattlerSpritePresent,
  IsMoveWithoutAnimation,
  LoadBattleBarGfx,
  SetBattlerShadowSpriteCallback,
  SetMultiuseSpriteTemplateToPokemon,
  SetMultiuseSpriteTemplateToTrainerBack,
  SetSpritePrimaryCoordsFromSecondaryCoords,
  SpriteCB_FaintOpponentMon,
  SpriteCB_TrainerSlideIn,
  SpriteCB_WaitForBattlerBallReleaseAnim,
  StartAnimLinearTranslation,
  StartHealthboxSlideIn,
  TryHandleLaunchBattleTableAnimation,
} from './gfx';
import { battleStringShouldBeColored, bufferStringBattle } from './message';
import type { ChooseMoveStruct, HpAndStatus } from './structs';
import { getBattlerAtPosition, getBattlerPosition, getBattlerSide } from './util';

const ab = () => g.activeBattler;
const bufA = () => g.battleBufferA[g.activeBattler];
const party = () => g.enemyParty;
const monOf = (battler: number) => g.enemyParty[g.battlerPartyIndexes[battler]]!;
const sbd = () => g.battleSpritesDataPtr;
const isDoubleBattle = () => (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) !== 0;
const ANIM_TAG_GOLD_STARS = () => K.ANIM_TAG_GOLD_STARS;

const OpponentDummy = (): void => {};

export function SetControllerToOpponent(): void {
  g.battlerControllerFuncs[ab()] = OpponentBufferRunCommand;
}
export const setControllerToOpponent = SetControllerToOpponent;

function OpponentBufferRunCommand(): void {
  if (g.battleControllerExecFlags & bit(ab())) {
    const cmd = sOpponentBufferCommands()[bufA()[0]];
    if (cmd) cmd();
    else OpponentBufferExecCompleted();
  }
}

export function OpponentBufferExecCompleted(): void {
  g.battlerControllerFuncs[ab()] = OpponentBufferRunCommand;
  g.battleControllerExecFlags = (g.battleControllerExecFlags & ~bit(ab())) >>> 0;
}

function CompleteOnBattlerSpriteCallbackDummy(): void {
  if (gSprites[g.battlerSpriteIds[ab()]].callback === SpriteCallbackDummy) OpponentBufferExecCompleted();
}

function FreeTrainerSpriteAfterSlide(): void {
  const s = gSprites[g.battlerSpriteIds[ab()]];
  if (s.callback === SpriteCallbackDummy) {
    FreeTrainerFrontPicPaletteAndTile(s.oam.affineParam);
    s.oam.tileNum = s.data[5];
    FreeSpriteOamMatrix(s);
    DestroySprite(s);
    OpponentBufferExecCompleted();
  }
}

function Intro_DelayAndEnd(): void {
  const h = sbd().healthBoxesData[ab()];
  h.introEndDelay = (h.introEndDelay - 1) & 0xff;
  if (h.introEndDelay === 0xff) {
    h.introEndDelay = 0;
    OpponentBufferExecCompleted();
  }
}

function Intro_WaitForShinyAnimAndHealthbox(): void {
  const a = ab();
  const h = sbd().healthBoxesData;
  let v = false;
  if (!isDoubleBattle() || g.battleTypeFlags & K.BATTLE_TYPE_MULTI) {
    if (gSprites[g.healthboxSpriteIds[a]].callback === SpriteCallbackDummy) v = true;
  } else if (gSprites[g.healthboxSpriteIds[a]].callback === SpriteCallbackDummy && gSprites[g.healthboxSpriteIds[a ^ K.BIT_FLANK]].callback === gSprites[g.healthboxSpriteIds[a]].callback) {
    v = true;
  }
  // IsCryPlayingOrClearCrySongs: no audio
  if (v && h[a].finishedShinyMonAnim && h[a ^ K.BIT_FLANK].finishedShinyMonAnim) {
    h[a].triedShinyMonAnim = h[a].finishedShinyMonAnim = 0;
    h[a ^ K.BIT_FLANK].triedShinyMonAnim = h[a ^ K.BIT_FLANK].finishedShinyMonAnim = 0;
    FreeSpriteTilesByTag(ANIM_TAG_GOLD_STARS());
    FreeSpritePaletteByTag(ANIM_TAG_GOLD_STARS());
    h[a].introEndDelay = 3;
    g.battlerControllerFuncs[a] = Intro_DelayAndEnd;
  }
}

function Intro_TryShinyAnimShowHealthbox(): void {
  const a = ab();
  const b = a ^ K.BIT_FLANK;
  const h = sbd().healthBoxesData;
  if (!h[a].triedShinyMonAnim && !h[a].ballAnimActive) TryShinyAnimation(a);
  if (!h[b].triedShinyMonAnim && !h[b].ballAnimActive) TryShinyAnimation(b);
  if (!h[a].ballAnimActive && !h[b].ballAnimActive) {
    if (isDoubleBattle() && !(g.battleTypeFlags & K.BATTLE_TYPE_MULTI)) {
      DestroySprite(gSprites[g.battleControllerData[b]]);
      UpdateHealthboxAttribute(g.healthboxSpriteIds[b], monOf(b), K.HEALTHBOX_ALL);
      StartHealthboxSlideIn(b);
      SetHealthboxSpriteVisible(g.healthboxSpriteIds[b]);
      SetBattlerShadowSpriteCallback(b, monOf(b).species);
    }
    DestroySprite(gSprites[g.battleControllerData[a]]);
    UpdateHealthboxAttribute(g.healthboxSpriteIds[a], monOf(a), K.HEALTHBOX_ALL);
    StartHealthboxSlideIn(a);
    SetHealthboxSpriteVisible(g.healthboxSpriteIds[a]);
    SetBattlerShadowSpriteCallback(a, monOf(a).species);
    sbd().animationData.introAnimActive = 0;
    g.battlerControllerFuncs[a] = Intro_WaitForShinyAnimAndHealthbox;
  }
}

function TryShinyAnimAfterMonAnim(): void {
  const a = ab();
  const s = gSprites[g.battlerSpriteIds[a]];
  const h = sbd().healthBoxesData[a];
  if (s.animEnded && s.x2 === 0) {
    if (!h.triedShinyMonAnim) {
      TryShinyAnimation(a);
    } else if (h.finishedShinyMonAnim) {
      h.triedShinyMonAnim = h.finishedShinyMonAnim = 0;
      FreeSpriteTilesByTag(ANIM_TAG_GOLD_STARS());
      FreeSpritePaletteByTag(ANIM_TAG_GOLD_STARS());
      OpponentBufferExecCompleted();
    }
  }
}

function CompleteOnHealthbarDone(): void {
  if (!healthbarStep(party(), false)) return;
  if (!btlCtrlOakOldManTestState2Flag(K.FIRST_BATTLE_MSG_FLAG_INFLICT_DMG) && g.battleTypeFlags & K.BATTLE_TYPE_FIRST_BATTLE) {
    BtlCtrl_OakOldMan_SetState2Flag(K.FIRST_BATTLE_MSG_FLAG_INFLICT_DMG);
    g.battlerControllerFuncs[ab()] = PrintOakText_InflictingDamageIsKey;
  } else {
    OpponentBufferExecCompleted();
  }
}

function HideHealthboxAfterMonFaint(): void {
  if (!gSprites[g.battlerSpriteIds[ab()]].inUse) {
    SetHealthboxSpriteInvisible(g.healthboxSpriteIds[ab()]);
    OpponentBufferExecCompleted();
  }
}

function FreeMonSpriteAfterSwitchOutAnim(): void {
  if (!sbd().healthBoxesData[ab()].specialAnimActive) {
    const s = gSprites[g.battlerSpriteIds[ab()]];
    FreeSpriteOamMatrix(s);
    DestroySprite(s);
    HideBattlerShadowSprite(ab());
    SetHealthboxSpriteInvisible(g.healthboxSpriteIds[ab()]);
    OpponentBufferExecCompleted();
  }
}

function CompleteOnInactiveTextPrinter(): void {
  if (!IsTextPrinterActive(0)) OpponentBufferExecCompleted();
}

function DoHitAnimBlinkSpriteEffect(): void {
  if (hitAnimBlinkStep()) OpponentBufferExecCompleted();
}

function SwitchIn_ShowSubstitute(): void {
  const a = ab();
  if (gSprites[g.healthboxSpriteIds[a]].callback === SpriteCallbackDummy) {
    if (sbd().battlerData[a].behindSubstitute) InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_MON_TO_SUBSTITUTE);
    g.battlerControllerFuncs[a] = SwitchIn_HandleSoundAndEnd;
  }
}

function SwitchIn_HandleSoundAndEnd(): void {
  if (!sbd().healthBoxesData[ab()].specialAnimActive) OpponentBufferExecCompleted();
}

function SwitchIn_ShowHealthbox(): void {
  const a = ab();
  const h = sbd().healthBoxesData[a];
  if (h.finishedShinyMonAnim) {
    h.triedShinyMonAnim = h.finishedShinyMonAnim = 0;
    FreeSpriteTilesByTag(ANIM_TAG_GOLD_STARS());
    FreeSpritePaletteByTag(ANIM_TAG_GOLD_STARS());
    StartSpriteAnim(gSprites[g.battlerSpriteIds[a]], 0);
    UpdateHealthboxAttribute(g.healthboxSpriteIds[a], monOf(a), K.HEALTHBOX_ALL);
    StartHealthboxSlideIn(a);
    SetHealthboxSpriteVisible(g.healthboxSpriteIds[a]);
    CopyBattleSpriteInvisibility(a);
    g.battlerControllerFuncs[a] = SwitchIn_ShowSubstitute;
  }
}

function SwitchIn_TryShinyAnim(): void {
  const a = ab();
  const h = sbd().healthBoxesData[a];
  if (!h.triedShinyMonAnim && !h.ballAnimActive) TryShinyAnimation(a);
  if (gSprites[g.battleControllerData[a]].callback === SpriteCallbackDummy && !h.ballAnimActive) {
    DestroySprite(gSprites[g.battleControllerData[a]]);
    SetBattlerShadowSpriteCallback(a, monOf(a).species);
    g.battlerControllerFuncs[a] = SwitchIn_ShowHealthbox;
  }
}

function CompleteOnFinishedStatusAnimation(): void {
  if (!sbd().healthBoxesData[ab()].statusAnimActive) OpponentBufferExecCompleted();
}

function CompleteOnFinishedBattleAnimation(): void {
  if (!sbd().healthBoxesData[ab()].animFromTableActive) OpponentBufferExecCompleted();
}

// ---------------------------------------------------------------- handlers

function OpponentHandleGetMonData(): void {
  handleGetMonData(party());
  OpponentBufferExecCompleted();
}

function OpponentHandleSetMonData(): void {
  handleSetMonData(party());
  OpponentBufferExecCompleted();
}

function OpponentHandleLoadMonSprite(): void {
  const a = ab();
  const species = monOf(a).species;
  let y: number;
  if (g.battleTypeFlags & K.BATTLE_TYPE_GHOST) {
    DecompressGhostFrontPic(monOf(a), a);
    y = GetGhostSpriteDefault_Y(a);
    sbd().healthBoxesData[a].triedShinyMonAnim = 1;
    sbd().healthBoxesData[a].finishedShinyMonAnim = 1;
  } else {
    BattleLoadOpponentMonSpriteGfx(monOf(a), a);
    y = GetBattlerSpriteDefault_Y(a);
  }
  SetMultiuseSpriteTemplateToPokemon(species, getBattlerPosition(a));
  const id = (g.battlerSpriteIds[a] = CreateSprite(gMultiuseSpriteTemplate, GetBattlerSpriteCoord(a, K.BATTLER_COORD_X_2), y, GetBattlerSpriteSubpriority(a)));
  const s = gSprites[id];
  s.x2 = -DISPLAY_WIDTH;
  s.data[0] = a;
  s.data[2] = species;
  s.oam.paletteNum = a;
  StartSpriteAnim(s, g.battleMonForms[a]);
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_GHOST)) SetBattlerShadowSpriteCallback(a, species);
  g.battlerControllerFuncs[a] = TryShinyAnimAfterMonAnim;
}

function OpponentHandleSwitchInAnim(): void {
  const a = ab();
  g.battleStruct.monToSwitchIntoId[a] = K.PARTY_SIZE;
  g.battlerPartyIndexes[a] = bufA()[1];
  StartSendOutAnim(a, !!bufA()[2]);
  g.battlerControllerFuncs[a] = SwitchIn_TryShinyAnim;
}

function StartSendOutAnim(battlerId: number, dontClearSubstituteBit: boolean): void {
  ClearTemporarySpeciesSpriteData(battlerId, dontClearSubstituteBit);
  g.battlerPartyIndexes[battlerId] = g.battleBufferA[battlerId][1];
  const species = monOf(battlerId).species;
  g.battleControllerData[battlerId] = CreateInvisibleSpriteWithCallback(SpriteCB_WaitForBattlerBallReleaseAnim);
  BattleLoadOpponentMonSpriteGfx(monOf(battlerId), battlerId);
  SetMultiuseSpriteTemplateToPokemon(species, getBattlerPosition(battlerId));
  const id = (g.battlerSpriteIds[battlerId] = CreateSprite(gMultiuseSpriteTemplate, GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_X_2), GetBattlerSpriteDefault_Y(battlerId), GetBattlerSpriteSubpriority(battlerId)));
  const s = gSprites[id];
  s.data[0] = battlerId;
  s.data[2] = species;
  gSprites[g.battleControllerData[battlerId]].data[1] = id;
  s.oam.paletteNum = battlerId;
  StartSpriteAnim(s, g.battleMonForms[battlerId]);
  s.invisible = true;
  s.callback = SpriteCallbackDummy;
  const saved = g.activeBattler;
  g.activeBattler = battlerId; // DoPokeballSendOutAnimation reads gActiveBattler
  gSprites[g.battleControllerData[battlerId]].data[0] = DoPokeballSendOutAnimation(0, K.POKEBALL_OPPONENT_SENDOUT);
  g.activeBattler = saved;
}

function OpponentHandleReturnMonToBall(): void {
  const a = ab();
  if (!bufA()[1]) {
    sbd().healthBoxesData[a].animationState = 0;
    g.battlerControllerFuncs[a] = DoSwitchOutAnimation;
  } else {
    const s = gSprites[g.battlerSpriteIds[a]];
    FreeSpriteOamMatrix(s);
    DestroySprite(s);
    HideBattlerShadowSprite(a);
    SetHealthboxSpriteInvisible(g.healthboxSpriteIds[a]);
    OpponentBufferExecCompleted();
  }
}

function DoSwitchOutAnimation(): void {
  const a = ab();
  const h = sbd().healthBoxesData[a];
  switch (h.animationState) {
    case 0:
      if (sbd().battlerData[a].behindSubstitute) InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_SUBSTITUTE_TO_MON);
      h.animationState = 1;
      break;
    case 1:
      if (!h.specialAnimActive) {
        h.animationState = 0;
        InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_SWITCH_OUT_OPPONENT_MON);
        g.battlerControllerFuncs[a] = FreeMonSpriteAfterSwitchOutAnim;
      }
      break;
  }
}

/** gTrainers[gTrainerBattleOpponent_A].trainerPic (secret base / towers / e-reader don't exist in this port) */
function opponentTrainerPicId(): number {
  return bdata.tables.trainers[g.trainerBattleOpponent_A]?.trainerPic ?? 0;
}

function trainerFrontY(picId: number): number {
  return (8 - (bdata.tables.coords.trainerFront[picId]?.[0] ?? 8)) * 4 + 40;
}

function createTrainerFrontSprite(subpriority: number): Sprite {
  const a = ab();
  const trainerPicId = opponentTrainerPicId();
  DecompressTrainerFrontPic(trainerPicId, a);
  SetMultiuseSpriteTemplateToTrainerBack(trainerPicId, getBattlerPosition(a));
  const id = (g.battlerSpriteIds[a] = CreateSprite(gMultiuseSpriteTemplate, 176, trainerFrontY(trainerPicId), subpriority));
  const s = gSprites[id];
  return s;
}

function finishTrainerFrontSprite(s: Sprite): void {
  const trainerPicId = opponentTrainerPicId();
  // gTrainerFrontPicPaletteTable[id].tag and gTrainerFrontPicTable[id].tag are both the pic id
  s.oam.paletteNum = IndexOfSpritePaletteTag(trainerPicId);
  s.data[5] = s.oam.tileNum;
  s.oam.tileNum = GetSpriteTileStartByTag(trainerPicId);
  s.oam.affineParam = trainerPicId;
  s.callback = SpriteCB_TrainerSlideIn;
}

function OpponentHandleDrawTrainerPic(): void {
  const s = createTrainerFrontSprite(GetBattlerSpriteSubpriority(ab()));
  s.x2 = -DISPLAY_WIDTH;
  s.data[0] = 2;
  finishTrainerFrontSprite(s);
  g.battlerControllerFuncs[ab()] = CompleteOnBattlerSpriteCallbackDummy;
}

function OpponentHandleTrainerSlide(): void {
  const s = createTrainerFrontSprite(30);
  s.x2 = 96;
  s.x += 32;
  s.data[0] = -2;
  finishTrainerFrontSprite(s);
  g.battlerControllerFuncs[ab()] = CompleteOnBattlerSpriteCallbackDummy; // CompleteOnBattlerSpriteCallbackDummy2
}

function OpponentHandleTrainerSlideBack(): void {
  const s = gSprites[g.battlerSpriteIds[ab()]];
  SetSpritePrimaryCoordsFromSecondaryCoords(s);
  s.data[0] = 35;
  s.data[2] = 280;
  s.data[4] = s.y;
  s.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(s, SpriteCallbackDummy);
  g.battlerControllerFuncs[ab()] = FreeTrainerSpriteAfterSlide;
}

function OpponentHandleFaintAnimation(): void {
  const a = ab();
  const h = sbd().healthBoxesData[a];
  if (!h.animationState) {
    if (sbd().battlerData[a].behindSubstitute) InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_SUBSTITUTE_TO_MON);
    ++h.animationState;
  } else if (!h.specialAnimActive) {
    h.animationState = 0;
    ui.playSE(K.SE_FAINT);
    gSprites[g.battlerSpriteIds[a]].callback = SpriteCB_FaintOpponentMon;
    g.battlerControllerFuncs[a] = HideHealthboxAfterMonFaint;
  }
}

function OpponentHandleMoveAnimation(): void {
  const move = bufA()[1] | (bufA()[2] << 8);
  SetMoveAnimGlobalsFromBuffer(ab());
  if (IsMoveWithoutAnimation(move, bufA()[3])) {
    OpponentBufferExecCompleted();
  } else {
    sbd().healthBoxesData[ab()].animationState = 0;
    g.battlerControllerFuncs[ab()] = OpponentDoMoveAnimation;
  }
}

function OpponentDoMoveAnimation(): void {
  if (doMoveAnimationStep(true)) OpponentBufferExecCompleted();
}

function OpponentHandlePrintString(): void {
  g.battle_BG0_X = 0;
  g.battle_BG0_Y = 0;
  const stringId = bufA()[2] | (bufA()[3] << 8);
  bufferStringBattle(stringId);
  BattlePutTextOnWindow(g.displayedStringBattle, battleStringShouldBeColored(stringId) ? K.B_WIN_MSG | K.B_TEXT_FLAG_NPC_CONTEXT_FONT : K.B_WIN_MSG);
  if (g.battleTypeFlags & K.BATTLE_TYPE_FIRST_BATTLE) {
    switch (stringId) {
      case K.STRINGID_TRAINER1WINTEXT: // 0x17F
        g.battlerControllerFuncs[ab()] = PrintOakText_HowDisappointing;
        return;
      case K.STRINGID_DONTLEAVEBIRCH: // 0xE3
        g.battlerControllerFuncs[ab()] = PrintOakText_OakNoRunningFromATrainer;
        return;
    }
  }
  g.battlerControllerFuncs[ab()] = CompleteOnInactiveTextPrinter;
}

function OpponentHandleChooseAction(): void {
  AI_TrySwitchOrUseItem();
  OpponentBufferExecCompleted();
}

function OpponentHandleChooseMove(): void {
  const a = ab();
  const moveInfo = g.battleBufferAObj[a] as ChooseMoveStruct;
  if (g.battleTypeFlags & (K.BATTLE_TYPE_TRAINER | K.BATTLE_TYPE_FIRST_BATTLE | K.BATTLE_TYPE_SAFARI | K.BATTLE_TYPE_ROAMER)) {
    battleAI_SetupAIData();
    const chosenMoveId = battleAI_ChooseMoveOrAction();
    switch (chosenMoveId) {
      case K.AI_CHOICE_WATCH:
        emitTwoReturnValues(K.BUFFER_B, K.B_ACTION_SAFARI_WATCH_CAREFULLY, 0);
        break;
      case K.AI_CHOICE_FLEE:
        emitTwoReturnValues(K.BUFFER_B, K.B_ACTION_RUN, 0);
        break;
      default: {
        const target = gBattleMoves[moveInfo.moves[chosenMoveId]].target;
        if (target & (K.MOVE_TARGET_USER_OR_SELECTED | K.MOVE_TARGET_USER)) g.battlerTarget = a;
        if (target & K.MOVE_TARGET_BOTH) {
          g.battlerTarget = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
          if (g.absentBattlerFlags & bit(g.battlerTarget)) g.battlerTarget = getBattlerAtPosition(K.B_POSITION_PLAYER_RIGHT);
        }
        emitTwoReturnValues(K.BUFFER_B, 10, chosenMoveId | (g.battlerTarget << 8));
        break;
      }
    }
    OpponentBufferExecCompleted();
  } else {
    let chosenMoveId: number;
    let move: number;
    do {
      chosenMoveId = random() & 3;
      move = moveInfo.moves[chosenMoveId];
    } while (move === K.MOVE_NONE);
    if (gBattleMoves[move].target & (K.MOVE_TARGET_USER_OR_SELECTED | K.MOVE_TARGET_USER)) emitTwoReturnValues(K.BUFFER_B, 10, chosenMoveId | (a << 8));
    else if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) emitTwoReturnValues(K.BUFFER_B, 10, chosenMoveId | (getBattlerAtPosition(random() & 2) << 8));
    else emitTwoReturnValues(K.BUFFER_B, 10, chosenMoveId | (getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT) << 8));
    OpponentBufferExecCompleted();
  }
}

function OpponentHandleChooseItem(): void {
  emitOneReturnValue(K.BUFFER_B, g.battleStruct.chosenItem[(ab() >> 1) * 2]);
  OpponentBufferExecCompleted();
}

function OpponentHandleChoosePokemon(): void {
  const slot = getBattlerPosition(ab()) >> 1;
  let chosenMonId: number;
  if (g.battleStruct.AI_monToSwitchIntoId[slot] === K.PARTY_SIZE) {
    chosenMonId = getMostSuitableMonToSwitchInto();
    if (chosenMonId === K.PARTY_SIZE) {
      let battler1: number, battler2: number;
      if (!(g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE)) {
        battler2 = battler1 = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
      } else {
        battler1 = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
        battler2 = getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT);
      }
      for (chosenMonId = 0; chosenMonId < K.PARTY_SIZE; ++chosenMonId) {
        const m = g.enemyParty[chosenMonId];
        if (m && m.hp !== 0 && chosenMonId !== g.battlerPartyIndexes[battler1] && chosenMonId !== g.battlerPartyIndexes[battler2]) break;
      }
    }
  } else {
    chosenMonId = g.battleStruct.AI_monToSwitchIntoId[slot];
    g.battleStruct.AI_monToSwitchIntoId[slot] = K.PARTY_SIZE;
  }
  g.battleStruct.monToSwitchIntoId[ab()] = chosenMonId;
  emitChosenMonReturnValue(K.BUFFER_B, chosenMonId, [0, 0, 0]);
  OpponentBufferExecCompleted();
}

function OpponentHandleHealthBarUpdate(): void {
  const a = ab();
  LoadBattleBarGfx(0);
  const hpVal = ((bufA()[2] | (bufA()[3] << 8)) << 16) >> 16;
  const mon = monOf(a);
  if (hpVal !== K.INSTANT_HP_BAR_DROP) SetBattleBarStruct(a, g.healthboxSpriteIds[a], mon.maxHP, mon.hp, hpVal);
  else SetBattleBarStruct(a, g.healthboxSpriteIds[a], mon.maxHP, 0, hpVal);
  g.battlerControllerFuncs[a] = CompleteOnHealthbarDone;
}

function OpponentHandleStatusIconUpdate(): void {
  UpdateHealthboxAttribute(g.healthboxSpriteIds[ab()], monOf(ab()), K.HEALTHBOX_STATUS_ICON);
  sbd().healthBoxesData[ab()].statusAnimActive = 0;
  g.battlerControllerFuncs[ab()] = CompleteOnFinishedStatusAnimation;
}

function OpponentHandleStatusAnimation(): void {
  const b = bufA();
  InitAndLaunchChosenStatusAnimation(!!b[1], (b[2] | (b[3] << 8) | (b[4] << 16) | (b[5] << 24)) >>> 0);
  g.battlerControllerFuncs[ab()] = CompleteOnFinishedStatusAnimation;
}

function OpponentHandleHitAnimation(): void {
  const s = gSprites[g.battlerSpriteIds[ab()]];
  if (s.invisible) {
    OpponentBufferExecCompleted();
  } else {
    g.doingBattleAnim = true;
    s.data[1] = 0;
    DoHitAnimHealthboxEffect(ab());
    g.battlerControllerFuncs[ab()] = DoHitAnimBlinkSpriteEffect;
  }
}

function OpponentHandlePlaySE(): void {
  ui.playSE(bufA()[1] | (bufA()[2] << 8));
  OpponentBufferExecCompleted();
}

function OpponentHandlePlayFanfare(): void {
  ui.playFanfare(bufA()[1] | (bufA()[2] << 8));
  OpponentBufferExecCompleted();
}

function OpponentHandleFaintingCry(): void {
  ui.playCry(monOf(ab()).species);
  OpponentBufferExecCompleted();
}

function OpponentHandleIntroSlide(): void {
  HandleIntroSlide(bufA()[1]);
  g.introSlideFlags |= 1;
  OpponentBufferExecCompleted();
}

function OpponentHandleIntroTrainerBallThrow(): void {
  const a = ab();
  const s = gSprites[g.battlerSpriteIds[a]];
  SetSpritePrimaryCoordsFromSecondaryCoords(s);
  s.data[0] = 35;
  s.data[2] = 280;
  s.data[4] = s.y;
  s.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(s, SpriteCB_FreeOpponentSprite);
  const taskId = CreateTask(Task_StartSendOutAnim, 5);
  gTasks[taskId].data[0] = a;
  if (sbd().healthBoxesData[a].partyStatusSummaryShown) gTasks[g.battlerStatusSummaryTaskId[a]].func = Task_HidePartyStatusSummary;
  sbd().animationData.introAnimActive = 1;
  g.battlerControllerFuncs[a] = OpponentDummy;
}

function SpriteCB_FreeOpponentSprite(sprite: Sprite): void {
  FreeTrainerFrontPicPaletteAndTile(sprite.oam.affineParam);
  sprite.oam.tileNum = sprite.data[5];
  FreeSpriteOamMatrix(sprite);
  DestroySprite(sprite);
}

function Task_StartSendOutAnim(taskId: number): void {
  const saved = g.activeBattler;
  g.activeBattler = gTasks[taskId].data[0];
  const a = g.activeBattler;
  g.battleBufferA[a][1] = g.battlerPartyIndexes[a];
  StartSendOutAnim(a, false);
  if (isDoubleBattle() && !(g.battleTypeFlags & K.BATTLE_TYPE_MULTI)) {
    const b = a ^ K.BIT_FLANK;
    g.battleBufferA[b][1] = g.battlerPartyIndexes[b];
    StartSendOutAnim(b, false);
  }
  g.battlerControllerFuncs[a] = Intro_TryShinyAnimShowHealthbox;
  g.activeBattler = saved;
  DestroyTask(taskId);
}

function OpponentHandleDrawPartyStatusSummary(): void {
  const a = ab();
  if (bufA()[1] && getBattlerSide(a) === K.B_SIDE_PLAYER) {
    OpponentBufferExecCompleted();
    return;
  }
  const h = sbd().healthBoxesData[a];
  h.partyStatusSummaryShown = 1;
  if (bufA()[2]) {
    if (h.opponentDrawPartyStatusSummaryDelay < 2) {
      ++h.opponentDrawPartyStatusSummaryDelay;
      return;
    }
    h.opponentDrawPartyStatusSummaryDelay = 0;
  }
  g.battlerStatusSummaryTaskId[a] = CreatePartyStatusSummarySprites(a, g.battleBufferAObj[a] as HpAndStatus[], !!bufA()[1], !!bufA()[2]);
  h.partyStatusDelayTimer = 0;
  if (bufA()[2]) h.partyStatusDelayTimer = 0x5d;
  g.battlerControllerFuncs[a] = EndDrawPartyStatusSummary;
}

function EndDrawPartyStatusSummary(): void {
  const h = sbd().healthBoxesData[ab()];
  if (h.partyStatusDelayTimer++ > 0x5c) {
    h.partyStatusDelayTimer = 0;
    OpponentBufferExecCompleted();
  }
}

function OpponentHandleHidePartyStatusSummary(): void {
  if (sbd().healthBoxesData[ab()].partyStatusSummaryShown) gTasks[g.battlerStatusSummaryTaskId[ab()]].func = Task_HidePartyStatusSummary;
  OpponentBufferExecCompleted();
}

function OpponentHandleSpriteInvisibility(): void {
  if (IsBattlerSpritePresent(ab())) {
    gSprites[g.battlerSpriteIds[ab()]].invisible = !!bufA()[1];
    CopyBattleSpriteInvisibility(ab());
  }
  OpponentBufferExecCompleted();
}

function OpponentHandleBattleAnimation(): void {
  const animationId = bufA()[1];
  const argument = bufA()[2] | (bufA()[3] << 8);
  if (TryHandleLaunchBattleTableAnimation(ab(), ab(), ab(), animationId, argument)) OpponentBufferExecCompleted();
  else g.battlerControllerFuncs[ab()] = CompleteOnFinishedBattleAnimation;
}

const complete = OpponentBufferExecCompleted;

let commands: Record<number, () => void> | undefined;
function sOpponentBufferCommands(): Record<number, () => void> {
  return (commands ??= {
    [K.CONTROLLER_GETMONDATA]: OpponentHandleGetMonData,
    [K.CONTROLLER_GETRAWMONDATA]: complete,
    [K.CONTROLLER_SETMONDATA]: OpponentHandleSetMonData,
    [K.CONTROLLER_SETRAWMONDATA]: complete,
    [K.CONTROLLER_LOADMONSPRITE]: OpponentHandleLoadMonSprite,
    [K.CONTROLLER_SWITCHINANIM]: OpponentHandleSwitchInAnim,
    [K.CONTROLLER_RETURNMONTOBALL]: OpponentHandleReturnMonToBall,
    [K.CONTROLLER_DRAWTRAINERPIC]: OpponentHandleDrawTrainerPic,
    [K.CONTROLLER_TRAINERSLIDE]: OpponentHandleTrainerSlide,
    [K.CONTROLLER_TRAINERSLIDEBACK]: OpponentHandleTrainerSlideBack,
    [K.CONTROLLER_FAINTANIMATION]: OpponentHandleFaintAnimation,
    [K.CONTROLLER_PALETTEFADE]: complete,
    [K.CONTROLLER_SUCCESSBALLTHROWANIM]: complete,
    [K.CONTROLLER_BALLTHROWANIM]: complete,
    [K.CONTROLLER_PAUSE]: complete,
    [K.CONTROLLER_MOVEANIMATION]: OpponentHandleMoveAnimation,
    [K.CONTROLLER_PRINTSTRING]: OpponentHandlePrintString,
    [K.CONTROLLER_PRINTSTRINGPLAYERONLY]: complete,
    [K.CONTROLLER_CHOOSEACTION]: OpponentHandleChooseAction,
    [K.CONTROLLER_UNKNOWNYESNOBOX]: complete,
    [K.CONTROLLER_CHOOSEMOVE]: OpponentHandleChooseMove,
    [K.CONTROLLER_OPENBAG]: OpponentHandleChooseItem,
    [K.CONTROLLER_CHOOSEPOKEMON]: OpponentHandleChoosePokemon,
    [K.CONTROLLER_23]: complete,
    [K.CONTROLLER_HEALTHBARUPDATE]: OpponentHandleHealthBarUpdate,
    [K.CONTROLLER_EXPUPDATE]: complete,
    [K.CONTROLLER_STATUSICONUPDATE]: OpponentHandleStatusIconUpdate,
    [K.CONTROLLER_STATUSANIMATION]: OpponentHandleStatusAnimation,
    [K.CONTROLLER_STATUSXOR]: complete,
    [K.CONTROLLER_DATATRANSFER]: complete,
    [K.CONTROLLER_DMA3TRANSFER]: complete,
    [K.CONTROLLER_PLAYBGM]: complete,
    [K.CONTROLLER_32]: complete,
    [K.CONTROLLER_TWORETURNVALUES]: complete,
    [K.CONTROLLER_CHOSENMONRETURNVALUE]: complete,
    [K.CONTROLLER_ONERETURNVALUE]: complete,
    [K.CONTROLLER_ONERETURNVALUE_DUPLICATE]: complete,
    [K.CONTROLLER_CLEARUNKVAR]: complete,
    [K.CONTROLLER_SETUNKVAR]: complete,
    [K.CONTROLLER_CLEARUNKFLAG]: complete,
    [K.CONTROLLER_TOGGLEUNKFLAG]: complete,
    [K.CONTROLLER_HITANIMATION]: OpponentHandleHitAnimation,
    [K.CONTROLLER_CANTSWITCH]: complete,
    [K.CONTROLLER_PLAYSE]: OpponentHandlePlaySE,
    [K.CONTROLLER_PLAYFANFARE]: OpponentHandlePlayFanfare,
    [K.CONTROLLER_FAINTINGCRY]: OpponentHandleFaintingCry,
    [K.CONTROLLER_INTROSLIDE]: OpponentHandleIntroSlide,
    [K.CONTROLLER_INTROTRAINERBALLTHROW]: OpponentHandleIntroTrainerBallThrow,
    [K.CONTROLLER_DRAWPARTYSTATUSSUMMARY]: OpponentHandleDrawPartyStatusSummary,
    [K.CONTROLLER_HIDEPARTYSTATUSSUMMARY]: OpponentHandleHidePartyStatusSummary,
    [K.CONTROLLER_ENDBOUNCE]: complete,
    [K.CONTROLLER_SPRITEINVISIBILITY]: OpponentHandleSpriteInvisibility,
    [K.CONTROLLER_BATTLEANIMATION]: OpponentHandleBattleAnimation,
    [K.CONTROLLER_LINKSTANDBYMSG]: complete,
    [K.CONTROLLER_RESETACTIONMOVESELECTION]: complete,
    [K.CONTROLLER_ENDLINKBATTLE]: complete,
    [K.CONTROLLER_TERMINATOR_NOP]: () => {},
  });
}
