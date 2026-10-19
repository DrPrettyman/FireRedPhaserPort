// battle_controller_player.c: the human player's controller (action/move/target selection,
// sprites and healthbox updates for the player's side, handing off to the bag and party menu).

import { CopyBgTilemapBufferToVram, CopyToBgTilemapBufferRect_ChangePalette, IsDma3ManagerBusyWithBgCopy } from '../gba/bg';
import { gfx16 } from '../gba/gfx';
import { PALETTES_ALL, RGB_BLACK, RGB_WHITE } from '../gba/hw';
import { BeginFastPaletteFade, BeginNormalPaletteFade, BG_PLTT_ID, gPaletteFade, gPlttBufferFaded, gPlttBufferUnfaded, ResetPaletteFadeControl } from '../gba/palette';
import {
  CreateSprite,
  DestroySprite,
  FreeOamMatrix,
  FreeSpriteOamMatrix,
  FreeSpritePaletteByTag,
  GetSpritePaletteTagByPaletteNum,
  gSprites,
  AllocSpritePalette,
  SpriteCallbackDummy,
  StartSpriteAnim,
  StoreSpriteCallbackInData6,
  type Sprite,
} from '../gba/sprite';
import { FadeOutMapMusic, IsCryPlayingOrClearCrySongs, PlayBGM, PlayCry_ByMode, PlayFanfare, PlaySE, PlaySE12WithPanning } from '../gba/sound';
import { CreateTask, DestroyTask, gTasks, TaskDummy } from '../gba/task';
import { gMPlayInfo_BGM, m4aMPlayContinue, m4aMPlayVolumeControl } from '../audio/m4a';
import { TRACKS_ALL } from '../audio/m4aInternal';
import { FreeAllWindowBuffers, IsTextPrinterActive } from '../gba/window';
import { gMain } from '../gba/main';
import { CB2_BagMenuFromBattle } from '../menus/itemMenu';
import { SpecialVar } from '../menus/itemMenuState';
import { gPartyMenuUseExitCallback, gSelectedMonPartyId, OpenPartyMenuInTutorialBattle } from '../menus/partyMenu';
import { DoMoveAnim, SetMoveAnimGlobalsFromBuffer } from './anim/battleAnim';
import { TryShinyAnimation as TryShinyAnimationSpecial } from './anim/special';
import { anim } from './anim/state';
import { BattleMainCB2 } from './battleCallbacks';
import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from '../gba/hw';
import { CreatePartyStatusSummarySprites, SetBattleBarStruct, SetHealthboxSpriteInvisible, SetHealthboxSpriteVisible, SwapHpBarsWithHpText, Task_HidePartyStatusSummary, UpdateHealthboxAttribute, UpdateHpTextInHealthbox } from './battleInterface';
import { HandleIntroSlide } from './battleIntro';
import { ui } from './battleUi';
import { BattlePutTextOnWindow } from './battleWindow';
import { K } from './constants';
import { handleExpUpdate, handleGetMonData, handleSetMonData, handleStatusXor, healthbarStep, hitAnimBlinkStep } from './controllerCommon';
import { emitChosenMonReturnValue, emitOneReturnValue, emitOneReturnValue_Duplicate, emitTwoReturnValues } from './controllers';
import { bdata, g, gBattleMoves } from './env';
import { bit } from './globals';
import {
  BattleLoadPlayerMonSpriteGfx,
  ClearTemporarySpeciesSpriteData,
  CopyAllBattleSpritesInvisibilities,
  CopyBattleSpriteInvisibility,
  CreateInvisibleSpriteWithCallback,
  DecompressTrainerBackPalette,
  DoBounceEffect,
  DoHitAnimHealthboxEffect,
  DoPokeballSendOutAnimation,
  EndBounceEffect,
  GetBattlerSpriteCoord,
  GetBattlerSpriteDefault_Y,
  GetBattlerSpriteSubpriority,
  gMultiuseSpriteTemplate,
  HandleLowHpMusicChange,
  InitAndLaunchChosenStatusAnimation,
  InitAndLaunchSpecialAnimation,
  IsBattlerSpritePresent,
  IsMoveWithoutAnimation,
  LoadBattleBarGfx,
  PlayerThrowBall_StartAnimLinearTranslation,
  SetBattlerSpriteAffineMode,
  SetMultiuseSpriteTemplateToPokemon,
  SetMultiuseSpriteTemplateToTrainerBack,
  SetSpritePrimaryCoordsFromSecondaryCoords,
  SpriteCB_FaintSlideAnim,
  SpriteCB_HideAsMoveTarget,
  SpriteCB_ShowAsMoveTarget,
  SpriteCB_TrainerSlideIn,
  SpriteCB_WaitForBattlerBallReleaseAnim,
  StartAnimLinearTranslation,
  StartHealthboxSlideIn,
  TryHandleLaunchBattleTableAnimation,
  TrySetBehindSubstituteSpriteBit,
  BattleStopLowHpSound,
  IsBattleSEPlaying,
} from './gfx';
import { battleStringExpandPlaceholders, battleStringShouldBeColored, bufferStringBattle, encodeBattleText, getCurrentPpToMaxPpState, moveName, typeName } from './message';
import { countAliveMonsInBattle, getDefaultMoveTarget } from './pokemonBattle';
import { ConvertIntToDecimalStringN, STR_CONV_MODE_RIGHT_ALIGN, strBody } from './stringUtil';
import type { ChooseMoveStruct, HpAndStatus } from './structs';
import { getBattlerAtPosition, getBattlerPosition, getBattlerSide } from './util';

const ab = () => g.activeBattler;
const bufA = () => g.battleBufferA[g.activeBattler];
const party = () => g.playerParty;
const monOf = (battler: number) => g.playerParty[g.battlerPartyIndexes[battler]]!;
const sbd = () => g.battleSpritesDataPtr;
const isDoubleBattle = () => (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) !== 0;
const moveInfo = () => g.battleBufferAObj[g.activeBattler] as ChooseMoveStruct;

export const BattleControllerDummy = (): void => {};
export const battleControllerDummy = BattleControllerDummy;

export function SetControllerToPlayer(): void {
  g.battlerControllerFuncs[ab()] = PlayerBufferRunCommand;
  g.doingBattleAnim = false;
}
export const setControllerToPlayer = SetControllerToPlayer;

function PlayerBufferExecCompleted(): void {
  g.battlerControllerFuncs[ab()] = PlayerBufferRunCommand;
  g.battleControllerExecFlags = (g.battleControllerExecFlags & ~bit(ab())) >>> 0;
}
export { PlayerBufferExecCompleted };

function PlayerBufferRunCommand(): void {
  if (g.battleControllerExecFlags & bit(ab())) {
    const cmd = sPlayerBufferCommands()[bufA()[0]];
    if (cmd) cmd();
    else PlayerBufferExecCompleted();
  }
}

function CompleteOnBattlerSpritePosX_0(): void {
  if (gSprites[g.battlerSpriteIds[ab()]].x2 === 0) PlayerBufferExecCompleted();
}

// ---------------------------------------------------------------- action selection

/** HandleInputChooseAction (also used by the Oak/Old Man controller with its own completion) */
export function makeHandleInputChooseAction(complete: () => void): () => void {
  // Named so the controller shows up as HandleInputChooseAction in devtools / e2e probes.
  const HandleInputChooseAction = () => {
    const a = ab();
    const itemId = bufA()[2] | (bufA()[3] << 8);
    DoBounceEffect(a, K.BOUNCE_HEALTHBOX, 7, 1);
    DoBounceEffect(a, K.BOUNCE_MON, 7, 1);
    const cur = g.actionSelectionCursor;
    const move = (xor: number) => {
      PlaySE(K.SE_SELECT);
      ActionSelectionDestroyCursorAt(cur[a]);
      cur[a] ^= xor;
      ActionSelectionCreateCursorAt(cur[a], 0);
    };
    if (ui.joyNew('A')) {
      PlaySE(K.SE_SELECT);
      const actions = [K.B_ACTION_USE_MOVE, K.B_ACTION_USE_ITEM, K.B_ACTION_SWITCH, K.B_ACTION_RUN];
      emitTwoReturnValues(K.BUFFER_B, actions[cur[a]], 0);
      complete();
    } else if (ui.joyNew('LEFT')) {
      if (cur[a] & 1) move(1); // if is B_ACTION_USE_ITEM or B_ACTION_RUN
    } else if (ui.joyNew('RIGHT')) {
      if (!(cur[a] & 1)) move(1); // if is B_ACTION_USE_MOVE or B_ACTION_SWITCH
    } else if (ui.joyNew('UP')) {
      if (cur[a] & 2) move(2); // if is B_ACTION_SWITCH or B_ACTION_RUN
    } else if (ui.joyNew('DOWN')) {
      if (!(cur[a] & 2)) move(2); // if is B_ACTION_USE_MOVE or B_ACTION_USE_ITEM
    } else if (ui.joyNew('B')) {
      if (
        isDoubleBattle() &&
        getBattlerPosition(a) === K.B_POSITION_PLAYER_RIGHT &&
        !(g.absentBattlerFlags & bit(getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT))) &&
        !(g.battleTypeFlags & K.BATTLE_TYPE_MULTI)
      ) {
        if (bufA()[1] === K.B_ACTION_USE_ITEM) {
          // Add item to bag if it is a ball
          if (itemId <= K.ITEM_PREMIER_BALL) ui.addBagItem(itemId, 1);
          else return;
        }
        PlaySE(K.SE_SELECT);
        emitTwoReturnValues(K.BUFFER_B, K.B_ACTION_CANCEL_PARTNER, 0);
        complete();
      }
    } else if (ui.joyNew('START')) {
      SwapHpBarsWithHpText();
    }
  };
  return HandleInputChooseAction;
}

const HandleInputChooseAction = makeHandleInputChooseAction(PlayerBufferExecCompleted);

/** sTargetIdentities */
const sTargetIdentities = () => [K.B_POSITION_PLAYER_LEFT, K.B_POSITION_PLAYER_RIGHT, K.B_POSITION_OPPONENT_RIGHT, K.B_POSITION_OPPONENT_LEFT];

function HandleInputChooseTarget(): void {
  const a = ab();
  const identities = sTargetIdentities();
  DoBounceEffect(g.multiUsePlayerCursor, K.BOUNCE_HEALTHBOX, 15, 1);
  for (let i = 0; i < g.battlersCount; i++) if (i !== g.multiUsePlayerCursor) EndBounceEffect(i, K.BOUNCE_HEALTHBOX);
  const targetSprite = () => gSprites[g.battlerSpriteIds[g.multiUsePlayerCursor]];
  if (ui.joyNew('A')) {
    PlaySE(K.SE_SELECT);
    targetSprite().callback = SpriteCB_HideAsMoveTarget;
    emitTwoReturnValues(K.BUFFER_B, 10, g.moveSelectionCursor[a] | (g.multiUsePlayerCursor << 8));
    EndBounceEffect(g.multiUsePlayerCursor, K.BOUNCE_HEALTHBOX);
    PlayerBufferExecCompleted();
  } else if (ui.joyNew('B')) {
    PlaySE(K.SE_SELECT);
    targetSprite().callback = SpriteCB_HideAsMoveTarget;
    g.battlerControllerFuncs[a] = HandleInputChooseMove;
    DoBounceEffect(a, K.BOUNCE_HEALTHBOX, 7, 1);
    DoBounceEffect(a, K.BOUNCE_MON, 7, 1);
    EndBounceEffect(g.multiUsePlayerCursor, K.BOUNCE_HEALTHBOX);
  } else if (ui.joyNew('LEFT') || ui.joyNew('UP') || ui.joyNew('RIGHT') || ui.joyNew('DOWN')) {
    const back = ui.joyNew('LEFT') || ui.joyNew('UP');
    PlaySE(K.SE_SELECT);
    targetSprite().callback = SpriteCB_HideAsMoveTarget;
    let ok = 0;
    do {
      const currSelIdentity = getBattlerPosition(g.multiUsePlayerCursor);
      let i = 0;
      for (; i < K.MAX_BATTLERS_COUNT; ++i) if (currSelIdentity === identities[i]) break;
      do {
        if (back) {
          if (--i < 0) i = K.MAX_BATTLERS_COUNT; // UB: array out of range
        } else if (++i > 3) i = 0;
        g.multiUsePlayerCursor = getBattlerAtPosition(identities[i] ?? 0);
      } while (g.multiUsePlayerCursor === g.battlersCount);
      ok = 0;
      switch (getBattlerPosition(g.multiUsePlayerCursor)) {
        case K.B_POSITION_PLAYER_LEFT:
        case K.B_POSITION_PLAYER_RIGHT:
          if (a !== g.multiUsePlayerCursor) ++ok;
          else if (gBattleMoves[monOf(a).moves[g.moveSelectionCursor[a]]].target & K.MOVE_TARGET_USER_OR_SELECTED) ++ok;
          break;
        case K.B_POSITION_OPPONENT_LEFT:
        case K.B_POSITION_OPPONENT_RIGHT:
          ++ok;
          break;
      }
      if (g.absentBattlerFlags & bit(g.multiUsePlayerCursor)) ok = 0;
    } while (ok === 0);
    targetSprite().callback = SpriteCB_ShowAsMoveTarget;
  }
}

/** HandleInputChooseMove */
export function HandleInputChooseMove(): void {
  const a = ab();
  let canSelectTarget = false;
  const info = moveInfo();
  PreviewDeterminativeMoveTargets();
  const cur = g.moveSelectionCursor;
  const moveCursor = (xor: number) => {
    MoveSelectionDestroyCursorAt(cur[a]);
    cur[a] ^= xor;
    PlaySE(K.SE_SELECT);
    MoveSelectionCreateCursorAt(cur[a], 0);
    MoveSelectionDisplayPpNumber();
    MoveSelectionDisplayMoveType();
    BeginNormalPaletteFade(0xf0000, 0, 0, 0, RGB_WHITE);
  };
  if (ui.joyNew('A')) {
    PlaySE(K.SE_SELECT);
    let moveTarget: number;
    if (info.moves[cur[a]] === K.MOVE_CURSE) moveTarget = info.monType1 !== K.TYPE_GHOST && info.monType2 !== K.TYPE_GHOST ? K.MOVE_TARGET_USER : K.MOVE_TARGET_SELECTED;
    else moveTarget = gBattleMoves[info.moves[cur[a]]].target;
    if (moveTarget & K.MOVE_TARGET_USER) g.multiUsePlayerCursor = a;
    else g.multiUsePlayerCursor = getBattlerAtPosition((getBattlerPosition(a) & K.BIT_SIDE) ^ K.BIT_SIDE);
    if (!bufA()[1]) {
      // not a double battle
      if (moveTarget & K.MOVE_TARGET_USER_OR_SELECTED && !bufA()[2]) canSelectTarget = true;
    } else {
      // double battle
      if (!(moveTarget & (K.MOVE_TARGET_RANDOM | K.MOVE_TARGET_BOTH | K.MOVE_TARGET_DEPENDS | K.MOVE_TARGET_FOES_AND_ALLY | K.MOVE_TARGET_OPPONENTS_FIELD | K.MOVE_TARGET_USER)))
        canSelectTarget = true; // either selected or user
      if (info.currentPp[cur[a]] === 0) {
        canSelectTarget = false;
      } else if (!(moveTarget & (K.MOVE_TARGET_USER | K.MOVE_TARGET_USER_OR_SELECTED)) && countAliveMonsInBattle(K.BATTLE_ALIVE_EXCEPT_ACTIVE) <= 1) {
        g.multiUsePlayerCursor = getDefaultMoveTarget(a);
        canSelectTarget = false;
      }
    }
    ResetPaletteFadeControl();
    BeginNormalPaletteFade(0xf0000, 0, 0, 0, RGB_WHITE);
    if (!canSelectTarget) {
      emitTwoReturnValues(K.BUFFER_B, 10, cur[a] | (g.multiUsePlayerCursor << 8));
      PlayerBufferExecCompleted();
    } else {
      g.battlerControllerFuncs[a] = HandleInputChooseTarget;
      if (moveTarget & (K.MOVE_TARGET_USER | K.MOVE_TARGET_USER_OR_SELECTED)) g.multiUsePlayerCursor = a;
      else if (g.absentBattlerFlags & bit(getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT))) g.multiUsePlayerCursor = getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT);
      else g.multiUsePlayerCursor = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
      gSprites[g.battlerSpriteIds[g.multiUsePlayerCursor]].callback = SpriteCB_ShowAsMoveTarget;
    }
  } else if (ui.joyNew('B')) {
    PlaySE(K.SE_SELECT);
    emitTwoReturnValues(K.BUFFER_B, 10, 0xffff);
    PlayerBufferExecCompleted();
    ResetPaletteFadeControl();
    BeginNormalPaletteFade(0xf0000, 0, 0, 0, RGB_WHITE);
  } else if (ui.joyNew('LEFT')) {
    if (cur[a] & 1) moveCursor(1);
  } else if (ui.joyNew('RIGHT')) {
    if (!(cur[a] & 1) && (cur[a] ^ 1) < g.numberOfMovesToChoose) moveCursor(1);
  } else if (ui.joyNew('UP')) {
    if (cur[a] & 2) moveCursor(2);
  } else if (ui.joyNew('DOWN')) {
    if (!(cur[a] & 2) && (cur[a] ^ 2) < g.numberOfMovesToChoose) moveCursor(2);
  } else if (ui.joyNew('SELECT')) {
    if (g.numberOfMovesToChoose > 1 && !(g.battleTypeFlags & K.BATTLE_TYPE_LINK)) {
      MoveSelectionCreateCursorAt(cur[a], 29);
      g.multiUsePlayerCursor = cur[a] !== 0 ? 0 : cur[a] + 1;
      MoveSelectionCreateCursorAt(g.multiUsePlayerCursor, 27);
      BattlePutTextOnWindow(encodeBattleText('gText_BattleSwitchWhich'), K.B_WIN_SWITCH_PROMPT);
      g.battlerControllerFuncs[a] = HandleMoveSwitching;
    }
  }
}

/** The Oak/Old Man controller's move-input wrapper, registered by that module. */
let oakOldManHandleInputChooseMove: () => void = HandleInputChooseMove;
export function setOakOldManHandleInputChooseMove(f: () => void): void {
  oakOldManHandleInputChooseMove = f;
}

function HandleMoveSwitching(): void {
  const a = ab();
  const cur = g.moveSelectionCursor;
  const back = () => (g.battleTypeFlags & K.BATTLE_TYPE_FIRST_BATTLE ? oakOldManHandleInputChooseMove : HandleInputChooseMove);
  if (ui.joyNew('A') || ui.joyNew('SELECT')) {
    PlaySE(K.SE_SELECT);
    if (cur[a] !== g.multiUsePlayerCursor) {
      const info = moveInfo();
      const x = cur[a];
      const y = g.multiUsePlayerCursor;
      // swap moves and pp
      [info.moves[x], info.moves[y]] = [info.moves[y], info.moves[x]];
      [info.currentPp[x], info.currentPp[y]] = [info.currentPp[y], info.currentPp[x]];
      [info.maxPp[x], info.maxPp[y]] = [info.maxPp[y], info.maxPp[x]];
      const d = g.disableStructs[a];
      if (d.mimickedMoves & bit(x)) {
        d.mimickedMoves &= ~bit(x);
        d.mimickedMoves |= bit(y);
      }
      MoveSelectionDisplayMoveNames();
      const swapBonuses = (bonuses: number) => {
        const per = [0, 1, 2, 3].map((i) => (bonuses & (3 << (i * 2))) >> (i * 2));
        [per[x], per[y]] = [per[y], per[x]];
        return per.reduce((acc, v, i) => acc | (v << (i * 2)), 0);
      };
      const bm = g.battleMons[a];
      bm.ppBonuses = swapBonuses(bm.ppBonuses);
      for (let i = 0; i < K.MAX_MON_MOVES; ++i) {
        bm.moves[i] = info.moves[i];
        bm.pp[i] = info.currentPp[i];
      }
      if (!(bm.status2 & K.STATUS2_TRANSFORMED)) {
        const mon = monOf(a);
        [mon.moves[x], mon.moves[y]] = [mon.moves[y], mon.moves[x]];
        [mon.pp[x], mon.pp[y]] = [mon.pp[y], mon.pp[x]];
        mon.ppBonuses = swapBonuses(mon.ppBonuses);
      }
    }
    g.battlerControllerFuncs[a] = back();
    cur[a] = g.multiUsePlayerCursor;
    MoveSelectionCreateCursorAt(cur[a], 0);
    MoveSelectionDisplayPpString();
    MoveSelectionDisplayPpNumber();
    MoveSelectionDisplayMoveType();
  }
  if (ui.joyNew('B')) {
    PlaySE(K.SE_SELECT);
    MoveSelectionDestroyCursorAt(g.multiUsePlayerCursor);
    MoveSelectionCreateCursorAt(cur[a], 0);
    g.battlerControllerFuncs[a] = back();
    MoveSelectionDisplayPpString();
    MoveSelectionDisplayPpNumber();
    MoveSelectionDisplayMoveType();
  }
  const moveSwitchCursor = (xor: number) => {
    if (g.multiUsePlayerCursor === cur[a]) MoveSelectionCreateCursorAt(cur[a], 29);
    else MoveSelectionDestroyCursorAt(g.multiUsePlayerCursor);
    g.multiUsePlayerCursor ^= xor;
    PlaySE(K.SE_SELECT);
    MoveSelectionCreateCursorAt(g.multiUsePlayerCursor, g.multiUsePlayerCursor === cur[a] ? 0 : 27);
  };
  if (ui.joyNew('LEFT') && g.multiUsePlayerCursor & 1) moveSwitchCursor(1);
  if (ui.joyNew('RIGHT') && !(g.multiUsePlayerCursor & 1) && (g.multiUsePlayerCursor ^ 1) < g.numberOfMovesToChoose) moveSwitchCursor(1);
  if (ui.joyNew('UP') && g.multiUsePlayerCursor & 2) moveSwitchCursor(2);
  if (ui.joyNew('DOWN') && !(g.multiUsePlayerCursor & 2) && (g.multiUsePlayerCursor ^ 2) < g.numberOfMovesToChoose) moveSwitchCursor(2);
}

// ---------------------------------------------------------------- move menu drawing

function MoveSelectionDisplayMoveNames(): void {
  const info = moveInfo();
  g.numberOfMovesToChoose = 0;
  for (let i = 0; i < K.MAX_MON_MOVES; ++i) {
    MoveSelectionDestroyCursorAt(i);
    const str = [...strBody(encodeBattleText('gText_MoveInterfaceDynamicColors')), ...strBody(moveName(info.moves[i])), K.EOS];
    g.displayedStringBattle = str;
    BattlePutTextOnWindow(str, i + 3);
    if (info.moves[i] !== K.MOVE_NONE) ++g.numberOfMovesToChoose;
  }
}

function MoveSelectionDisplayPpString(): void {
  BattlePutTextOnWindow(encodeBattleText('gText_MoveInterfacePP'), K.B_WIN_PP);
}

/** SetPpNumbersPaletteInMoveSelection */
function SetPpNumbersPaletteInMoveSelection(): void {
  const info = moveInfo();
  const pal = gfx16('gPPTextPalette');
  const v = getCurrentPpToMaxPpState(info.currentPp[g.moveSelectionCursor[ab()]], info.maxPp[g.moveSelectionCursor[ab()]]);
  gPlttBufferUnfaded[BG_PLTT_ID(5) + 12] = pal[v * 2 + 0];
  gPlttBufferUnfaded[BG_PLTT_ID(5) + 11] = pal[v * 2 + 1];
  gPlttBufferFaded[BG_PLTT_ID(5) + 12] = gPlttBufferUnfaded[BG_PLTT_ID(5) + 12];
  gPlttBufferFaded[BG_PLTT_ID(5) + 11] = gPlttBufferUnfaded[BG_PLTT_ID(5) + 11];
}

function MoveSelectionDisplayPpNumber(): void {
  if (bufA()[2] === 1) return; // check if we didn't want to display pp number
  SetPpNumbersPaletteInMoveSelection();
  const info = moveInfo();
  const c = g.moveSelectionCursor[ab()];
  const str = [...ConvertIntToDecimalStringN(info.currentPp[c], STR_CONV_MODE_RIGHT_ALIGN, 2), K.CHAR_SLASH, ...ConvertIntToDecimalStringN(info.maxPp[c], STR_CONV_MODE_RIGHT_ALIGN, 2), K.EOS];
  g.displayedStringBattle = str;
  BattlePutTextOnWindow(str, K.B_WIN_PP_REMAINING);
}

function MoveSelectionDisplayMoveType(): void {
  const info = moveInfo();
  const type = gBattleMoves[info.moves[g.moveSelectionCursor[ab()]]].type;
  const str = [
    ...strBody(encodeBattleText('gText_MoveInterfaceType')),
    K.EXT_CTRL_CODE_BEGIN,
    6,
    1,
    ...strBody(encodeBattleText('gText_MoveInterfaceDynamicColors')),
    ...strBody(typeName(type)),
    K.EOS,
  ];
  g.displayedStringBattle = str;
  BattlePutTextOnWindow(str, K.B_WIN_MOVE_TYPE);
}

export function MoveSelectionCreateCursorAt(cursorPosition: number, arg1: number): void {
  CopyToBgTilemapBufferRect_ChangePalette(0, [arg1 + 1, arg1 + 2], 9 * (cursorPosition & 1) + 1, 55 + (cursorPosition & 2), 1, 2, 0x11);
  CopyBgTilemapBufferToVram(0);
}

export function MoveSelectionDestroyCursorAt(cursorPosition: number): void {
  CopyToBgTilemapBufferRect_ChangePalette(0, [32, 32], 9 * (cursorPosition & 1) + 1, 55 + (cursorPosition & 2), 1, 2, 0x11);
  CopyBgTilemapBufferToVram(0);
}

export function ActionSelectionCreateCursorAt(cursorPosition: number, _arg1: number): void {
  CopyToBgTilemapBufferRect_ChangePalette(0, [1, 2], 7 * (cursorPosition & 1) + 16, 35 + (cursorPosition & 2), 1, 2, 0x11);
  CopyBgTilemapBufferToVram(0);
}

export function ActionSelectionDestroyCursorAt(cursorPosition: number): void {
  CopyToBgTilemapBufferRect_ChangePalette(0, [32, 32], 7 * (cursorPosition & 1) + 16, 35 + (cursorPosition & 2), 1, 2, 0x11);
  CopyBgTilemapBufferToVram(0);
}

/** InitMoveSelectionsVarsAndStrings */
export function InitMoveSelectionsVarsAndStrings(): void {
  MoveSelectionDisplayMoveNames();
  g.multiUsePlayerCursor = 0xff;
  MoveSelectionCreateCursorAt(g.moveSelectionCursor[ab()], 0);
  MoveSelectionDisplayPpString();
  MoveSelectionDisplayPpNumber();
  MoveSelectionDisplayMoveType();
}

/** PreviewDeterminativeMoveTargets (doubles only) */
function PreviewDeterminativeMoveTargets(): void {
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE)) return;
  const info = moveInfo();
  const move = info.moves[g.moveSelectionCursor[ab()]];
  const moveTarget = move === K.MOVE_CURSE ? (info.monType1 !== K.TYPE_GHOST && info.monType2 !== K.TYPE_GHOST ? K.MOVE_TARGET_USER : K.MOVE_TARGET_SELECTED) : gBattleMoves[move].target;
  let bitMask = 0;
  let startY = 0;
  const opp = () => (bit(getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT)) | bit(getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT))) << 16;
  switch (moveTarget) {
    case K.MOVE_TARGET_SELECTED:
    case K.MOVE_TARGET_DEPENDS:
    case K.MOVE_TARGET_USER_OR_SELECTED:
    case K.MOVE_TARGET_RANDOM:
      bitMask = 0xf0000;
      startY = 0;
      break;
    case K.MOVE_TARGET_BOTH:
    case K.MOVE_TARGET_OPPONENTS_FIELD:
      bitMask = opp();
      startY = 8;
      break;
    case K.MOVE_TARGET_USER:
      if ([K.MOVE_HAZE, K.MOVE_SANDSTORM, K.MOVE_PERISH_SONG, K.MOVE_RAIN_DANCE, K.MOVE_SUNNY_DAY, K.MOVE_HAIL, K.MOVE_MUD_SPORT, K.MOVE_WATER_SPORT].includes(move)) bitMask = 0xf0000;
      else if ([K.MOVE_SAFEGUARD, K.MOVE_REFLECT, K.MOVE_LIGHT_SCREEN, K.MOVE_MIST, K.MOVE_HEAL_BELL, K.MOVE_AROMATHERAPY].includes(move))
        bitMask = (bit(getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT)) | bit(getBattlerAtPosition(K.B_POSITION_PLAYER_RIGHT))) << 16;
      else if (move === K.MOVE_HELPING_HAND) bitMask = bit(getBattlerAtPosition(getBattlerPosition(ab()) ^ K.BIT_FLANK)) << 16;
      else bitMask = bit(ab()) << 16;
      startY = 8;
      break;
    case K.MOVE_TARGET_FOES_AND_ALLY:
      bitMask = opp() | (bit(getBattlerAtPosition(getBattlerPosition(ab()) ^ K.BIT_FLANK)) << 16);
      startY = 8;
      break;
  }
  BeginNormalPaletteFade(bitMask >>> 0, 8, startY, 0, RGB_WHITE);
}

// ---------------------------------------------------------------- completion helpers

function CompleteOnBattlerSpriteCallbackDummy(): void {
  if (gSprites[g.battlerSpriteIds[ab()]].callback === SpriteCallbackDummy) PlayerBufferExecCompleted();
}

function FreeTrainerSpriteAfterSlide(): void {
  const s = gSprites[g.battlerSpriteIds[ab()]];
  if (s.callback === SpriteCallbackDummy) {
    FreeSpriteOamMatrix(s);
    DestroySprite(s);
    PlayerBufferExecCompleted();
  }
}

function Intro_DelayAndEnd(): void {
  const h = sbd().healthBoxesData[ab()];
  h.introEndDelay = (h.introEndDelay - 1) & 0xff;
  if (h.introEndDelay === 0xff) {
    h.introEndDelay = 0;
    PlayerBufferExecCompleted();
  }
}

function Intro_WaitForShinyAnimAndHealthbox(): void {
  const a = ab();
  const h = sbd().healthBoxesData;
  let v = false;
  if (!isDoubleBattle() || g.battleTypeFlags & K.BATTLE_TYPE_MULTI) {
    if (gSprites[g.healthboxSpriteIds[a]].callback === SpriteCallbackDummy) v = true;
  } else if (gSprites[g.healthboxSpriteIds[a]].callback === SpriteCallbackDummy && gSprites[g.healthboxSpriteIds[a ^ K.BIT_FLANK]].callback === SpriteCallbackDummy) {
    v = true;
  }
  if (IsCryPlayingOrClearCrySongs()) v = false;
  if (v && h[a].finishedShinyMonAnim && h[a ^ K.BIT_FLANK].finishedShinyMonAnim) {
    h[a].triedShinyMonAnim = h[a].finishedShinyMonAnim = 0;
    h[a ^ K.BIT_FLANK].triedShinyMonAnim = h[a ^ K.BIT_FLANK].finishedShinyMonAnim = 0;
    if (g.battleTypeFlags & K.BATTLE_TYPE_MULTI) m4aMPlayContinue(gMPlayInfo_BGM);
    else m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 256);
    HandleLowHpMusicChange(monOf(a), a);
    if (isDoubleBattle()) HandleLowHpMusicChange(monOf(a ^ K.BIT_FLANK), a ^ K.BIT_FLANK);
    h[a].introEndDelay = 3;
    g.battlerControllerFuncs[a] = Intro_DelayAndEnd;
  }
}

/** TryShinyAnimation(battler, &party[gBattlerPartyIndexes[battler]]): every caller passes the battler's own mon */
export function TryShinyAnimation(battler: number): void {
  const party = getBattlerSide(battler) === K.B_SIDE_PLAYER ? g.playerParty : g.enemyParty;
  TryShinyAnimationSpecial(battler, party[g.battlerPartyIndexes[battler]]!);
}

function Intro_TryShinyAnimShowHealthbox(): void {
  const a = ab();
  const h = sbd().healthBoxesData;
  if (!h[a].ballAnimActive && !h[a ^ K.BIT_FLANK].ballAnimActive) {
    if (!h[a].triedShinyMonAnim) TryShinyAnimation(a);
    if (!h[a ^ K.BIT_FLANK].triedShinyMonAnim) TryShinyAnimation(a ^ K.BIT_FLANK);
    if (isDoubleBattle() && !(g.battleTypeFlags & K.BATTLE_TYPE_MULTI)) {
      DestroySprite(gSprites[g.battleControllerData[a ^ K.BIT_FLANK]]);
      UpdateHealthboxAttribute(g.healthboxSpriteIds[a ^ K.BIT_FLANK], monOf(a ^ K.BIT_FLANK), K.HEALTHBOX_ALL);
      StartHealthboxSlideIn(a ^ K.BIT_FLANK);
      SetHealthboxSpriteVisible(g.healthboxSpriteIds[a ^ K.BIT_FLANK]);
    }
    DestroySprite(gSprites[g.battleControllerData[a]]);
    UpdateHealthboxAttribute(g.healthboxSpriteIds[a], monOf(a), K.HEALTHBOX_ALL);
    StartHealthboxSlideIn(a);
    SetHealthboxSpriteVisible(g.healthboxSpriteIds[a]);
    sbd().animationData.introAnimActive = 0;
    g.battlerControllerFuncs[a] = Intro_WaitForShinyAnimAndHealthbox;
  }
}

function SwitchIn_CleanShinyAnimShowSubstitute(): void {
  const a = ab();
  const h = sbd().healthBoxesData[a];
  if (gSprites[g.healthboxSpriteIds[a]].callback === SpriteCallbackDummy && h.finishedShinyMonAnim) {
    h.triedShinyMonAnim = h.finishedShinyMonAnim = 0;
    if (sbd().battlerData[a].behindSubstitute) InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_MON_TO_SUBSTITUTE);
    g.battlerControllerFuncs[a] = SwitchIn_HandleSoundAndEnd;
  }
}

function SwitchIn_HandleSoundAndEnd(): void {
  const a = ab();
  if (!sbd().healthBoxesData[a].specialAnimActive && !IsCryPlayingOrClearCrySongs()) {
    m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 0x100);
    HandleLowHpMusicChange(monOf(a), a);
    PlayerBufferExecCompleted();
  }
}

/** Task_PlayerController_RestoreBgmAfterCry (the Oak/Old Man controller creates it at the end of its intro) */
export function Task_PlayerController_RestoreBgmAfterCry(taskId: number): void {
  if (!IsCryPlayingOrClearCrySongs()) {
    m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 0x100);
    DestroyTask(taskId);
  }
}

function SwitchIn_TryShinyAnimShowHealthbox(): void {
  const a = ab();
  const h = sbd().healthBoxesData[a];
  if (!h.triedShinyMonAnim && !h.ballAnimActive) TryShinyAnimation(a);
  if (gSprites[g.battleControllerData[a]].callback === SpriteCallbackDummy && !h.ballAnimActive) {
    DestroySprite(gSprites[g.battleControllerData[a]]);
    UpdateHealthboxAttribute(g.healthboxSpriteIds[a], monOf(a), K.HEALTHBOX_ALL);
    StartHealthboxSlideIn(a);
    SetHealthboxSpriteVisible(g.healthboxSpriteIds[a]);
    CopyBattleSpriteInvisibility(a);
    g.battlerControllerFuncs[a] = SwitchIn_CleanShinyAnimShowSubstitute;
  }
}

function CompleteOnHealthbarDone(): void {
  if (healthbarStep(party())) PlayerBufferExecCompleted();
}

export function CompleteOnInactiveTextPrinter(): void {
  if (!IsTextPrinterActive(0)) PlayerBufferExecCompleted();
}

function FreeMonSpriteAfterFaintAnim(): void {
  const s = gSprites[g.battlerSpriteIds[ab()]];
  if (s.y + s.y2 > DISPLAY_HEIGHT) {
    FreeOamMatrix(s.oam.matrixNum);
    DestroySprite(s);
    SetHealthboxSpriteInvisible(g.healthboxSpriteIds[ab()]);
    PlayerBufferExecCompleted();
  }
}

function FreeMonSpriteAfterSwitchOutAnim(): void {
  if (!sbd().healthBoxesData[ab()].specialAnimActive) {
    const s = gSprites[g.battlerSpriteIds[ab()]];
    FreeSpriteOamMatrix(s);
    DestroySprite(s);
    SetHealthboxSpriteInvisible(g.healthboxSpriteIds[ab()]);
    PlayerBufferExecCompleted();
  }
}

function OpenPartyMenuToChooseMon(): void {
  if (!gPaletteFade.active) {
    g.battlerControllerFuncs[ab()] = WaitForMonSelection;
    const caseId = gTasks[g.battleControllerData[ab()]].data[0];
    DestroyTask(g.battleControllerData[ab()]);
    FreeAllWindowBuffers();
    OpenPartyMenuInTutorialBattle(caseId);
  }
}

function WaitForMonSelection(): void {
  if (gMain.callback2 === BattleMainCB2 && !gPaletteFade.active) {
    if (gPartyMenuUseExitCallback === true) emitChosenMonReturnValue(K.BUFFER_B, gSelectedMonPartyId, g.battlePartyCurrentOrder);
    else emitChosenMonReturnValue(K.BUFFER_B, K.PARTY_SIZE, [0, 0, 0]);
    // PrintLinkStandbyMsg: link battles only
    PlayerBufferExecCompleted();
  }
}

function OpenBagAndChooseItem(): void {
  if (!gPaletteFade.active) {
    g.battlerControllerFuncs[ab()] = CompleteWhenChoseItem;
    // ReshowBattleScreenDummy
    FreeAllWindowBuffers();
    CB2_BagMenuFromBattle();
  }
}

function CompleteWhenChoseItem(): void {
  if (gMain.callback2 === BattleMainCB2 && !gPaletteFade.active) {
    emitOneReturnValue(K.BUFFER_B, SpecialVar.ItemId);
    PlayerBufferExecCompleted();
  }
}

function CompleteOnSpecialAnimDone(): void {
  if (!g.doingBattleAnim || !sbd().healthBoxesData[ab()].specialAnimActive) PlayerBufferExecCompleted();
}

function DoHitAnimBlinkSpriteEffect(): void {
  if (hitAnimBlinkStep()) PlayerBufferExecCompleted();
}

function CompleteOnFinishedStatusAnimation(): void {
  if (!sbd().healthBoxesData[ab()].statusAnimActive) PlayerBufferExecCompleted();
}

function CompleteOnFinishedBattleAnimation(): void {
  if (!sbd().healthBoxesData[ab()].animFromTableActive) PlayerBufferExecCompleted();
}

// ---------------------------------------------------------------- handlers

function PlayerHandleGetMonData(): void {
  handleGetMonData(party());
  PlayerBufferExecCompleted();
}

function PlayerHandleSetMonData(): void {
  handleSetMonData(party());
  HandleLowHpMusicChange(monOf(ab()), ab());
  PlayerBufferExecCompleted();
}

function PlayerHandleLoadMonSprite(): void {
  BattleLoadPlayerMonSpriteGfx(monOf(ab()), ab());
  gSprites[g.battlerSpriteIds[ab()]].oam.paletteNum = ab();
  g.battlerControllerFuncs[ab()] = CompleteOnBattlerSpritePosX_0;
}

function PlayerHandleSwitchInAnim(): void {
  const a = ab();
  ClearTemporarySpeciesSpriteData(a, bufA()[2]);
  g.battlerPartyIndexes[a] = bufA()[1];
  BattleLoadPlayerMonSpriteGfx(monOf(a), a);
  g.actionSelectionCursor[a] = 0;
  g.moveSelectionCursor[a] = 0;
  StartSendOutAnim(a, !!bufA()[2]);
  g.battlerControllerFuncs[a] = SwitchIn_TryShinyAnimShowHealthbox;
}

/** StartSendOutAnim (shared with the Oak/Old Man controller) */
export function StartSendOutAnim(battlerId: number, dontClearSubstituteBit: boolean): void {
  ClearTemporarySpeciesSpriteData(battlerId, dontClearSubstituteBit);
  g.battlerPartyIndexes[battlerId] = g.battleBufferA[battlerId][1];
  const species = monOf(battlerId).species;
  g.battleControllerData[battlerId] = CreateInvisibleSpriteWithCallback(SpriteCB_WaitForBattlerBallReleaseAnim);
  SetMultiuseSpriteTemplateToPokemon(species, getBattlerPosition(battlerId));
  const id = (g.battlerSpriteIds[battlerId] = CreateSprite(gMultiuseSpriteTemplate, GetBattlerSpriteCoord(battlerId, K.BATTLER_COORD_X_2), GetBattlerSpriteDefault_Y(battlerId), GetBattlerSpriteSubpriority(battlerId)));
  gSprites[g.battleControllerData[battlerId]].data[1] = id;
  const s = gSprites[id];
  s.data[0] = battlerId;
  s.data[2] = species;
  s.oam.paletteNum = battlerId;
  StartSpriteAnim(s, g.battleMonForms[battlerId]);
  s.invisible = true;
  s.callback = SpriteCallbackDummy;
  const saved = g.activeBattler;
  g.activeBattler = battlerId; // DoPokeballSendOutAnimation reads gActiveBattler
  gSprites[g.battleControllerData[battlerId]].data[0] = DoPokeballSendOutAnimation(0, K.POKEBALL_PLAYER_SENDOUT);
  g.activeBattler = saved;
}

function PlayerHandleReturnMonToBall(): void {
  const a = ab();
  if (bufA()[1] === 0) {
    sbd().healthBoxesData[a].animationState = 0;
    g.battlerControllerFuncs[a] = DoSwitchOutAnimation;
  } else {
    const s = gSprites[g.battlerSpriteIds[a]];
    FreeSpriteOamMatrix(s);
    DestroySprite(s);
    SetHealthboxSpriteInvisible(g.healthboxSpriteIds[a]);
    PlayerBufferExecCompleted();
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
        InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_SWITCH_OUT_PLAYER_MON);
        g.battlerControllerFuncs[a] = FreeMonSpriteAfterSwitchOutAnim;
      }
      break;
  }
}

/** gSaveBlock2Ptr->playerGender as a TRAINER_BACK_PIC id */
export function playerBackPic(): number {
  return ui.playerGender();
}

function trainerBackY(picId: number): number {
  const size = bdata.tables.coords.trainerBack[picId]?.[0] ?? 8;
  return (8 - size) * 4 + 80;
}

function PlayerHandleDrawTrainerPic(): void {
  const a = ab();
  let xPos: number;
  if (g.battleTypeFlags & K.BATTLE_TYPE_MULTI) xPos = (getBattlerPosition(a) & K.BIT_FLANK) !== K.B_FLANK_LEFT ? 90 : 32;
  else xPos = 80;
  const trainerPicId = playerBackPic();
  DecompressTrainerBackPalette(trainerPicId, a);
  SetMultiuseSpriteTemplateToTrainerBack(trainerPicId, getBattlerPosition(a));
  const id = (g.battlerSpriteIds[a] = CreateSprite(gMultiuseSpriteTemplate, xPos, trainerBackY(trainerPicId), GetBattlerSpriteSubpriority(a)));
  gSprites[id].oam.paletteNum = a;
  gSprites[id].x2 = DISPLAY_WIDTH;
  gSprites[id].data[0] = -2;
  gSprites[id].callback = SpriteCB_TrainerSlideIn;
  g.battlerControllerFuncs[a] = CompleteOnBattlerSpriteCallbackDummy;
}

function PlayerHandleTrainerSlide(): void {
  const a = ab();
  const trainerPicId = playerBackPic();
  DecompressTrainerBackPalette(trainerPicId, a);
  SetMultiuseSpriteTemplateToTrainerBack(trainerPicId, getBattlerPosition(a));
  const id = (g.battlerSpriteIds[a] = CreateSprite(gMultiuseSpriteTemplate, 80, trainerBackY(trainerPicId), 30));
  gSprites[id].oam.paletteNum = a;
  gSprites[id].x2 = -96;
  gSprites[id].data[0] = 2;
  gSprites[id].callback = SpriteCB_TrainerSlideIn;
  g.battlerControllerFuncs[a] = CompleteOnBattlerSpriteCallbackDummy;
}

function PlayerHandleTrainerSlideBack(): void {
  const s = gSprites[g.battlerSpriteIds[ab()]];
  SetSpritePrimaryCoordsFromSecondaryCoords(s);
  s.data[0] = 50;
  s.data[2] = -40;
  s.data[4] = s.y;
  s.callback = StartAnimLinearTranslation;
  StoreSpriteCallbackInData6(s, SpriteCallbackDummy);
  StartSpriteAnim(s, 1);
  g.battlerControllerFuncs[ab()] = FreeTrainerSpriteAfterSlide;
}

function PlayerHandleFaintAnimation(): void {
  const a = ab();
  const h = sbd().healthBoxesData[a];
  if (h.animationState === 0) {
    if (sbd().battlerData[a].behindSubstitute) InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_SUBSTITUTE_TO_MON);
    ++h.animationState;
  } else if (!h.specialAnimActive) {
    h.animationState = 0;
    HandleLowHpMusicChange(monOf(a), a);
    PlaySE12WithPanning(K.SE_FAINT, K.SOUND_PAN_ATTACKER);
    const s = gSprites[g.battlerSpriteIds[a]];
    s.data[1] = 0;
    s.data[2] = 5;
    s.callback = SpriteCB_FaintSlideAnim;
    g.battlerControllerFuncs[a] = FreeMonSpriteAfterFaintAnim;
  }
}

function PlayerHandlePaletteFade(): void {
  BeginNormalPaletteFade(PALETTES_ALL, 2, 0, 16, RGB_BLACK);
  PlayerBufferExecCompleted();
}

function PlayerHandleSuccessBallThrowAnim(): void {
  sbd().animationData.ballThrowCaseId = K.BALL_3_SHAKES_SUCCESS;
  g.doingBattleAnim = true;
  InitAndLaunchSpecialAnimation(ab(), ab(), getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT), K.B_ANIM_BALL_THROW);
  g.battlerControllerFuncs[ab()] = CompleteOnSpecialAnimDone;
}

function PlayerHandleBallThrowAnim(): void {
  sbd().animationData.ballThrowCaseId = bufA()[1];
  g.doingBattleAnim = true;
  InitAndLaunchSpecialAnimation(ab(), ab(), getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT), K.B_ANIM_BALL_THROW);
  g.battlerControllerFuncs[ab()] = CompleteOnSpecialAnimDone;
}

/** PlayerHandleMoveAnimation: held (run again next frame) while IsBattleSEPlaying */
function PlayerHandleMoveAnimation(): void {
  if (IsBattleSEPlaying(ab())) return;
  const move = bufA()[1] | (bufA()[2] << 8);
  SetMoveAnimGlobalsFromBuffer(ab());
  if (IsMoveWithoutAnimation(move, anim.moveTurn)) {
    PlayerBufferExecCompleted();
  } else {
    sbd().healthBoxesData[ab()].animationState = 0;
    g.battlerControllerFuncs[ab()] = PlayerDoMoveAnimation;
  }
}

/** XDoMoveAnimation (shared by all three controllers): returns true when done */
export function doMoveAnimationStep(substituteNeedsFlag: boolean): boolean {
  const a = ab();
  const move = bufA()[1] | (bufA()[2] << 8);
  const multihit = bufA()[11];
  const h = sbd().healthBoxesData[a];
  const bd = sbd().battlerData[a];
  switch (h.animationState) {
    case 0:
      if (bd.behindSubstitute && (!substituteNeedsFlag || !bd.flag_x8)) {
        bd.flag_x8 = 1;
        InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_SUBSTITUTE_TO_MON);
      }
      h.animationState = 1;
      break;
    case 1:
      if (!h.specialAnimActive) {
        SetBattlerSpriteAffineMode(0);
        DoMoveAnim(move);
        h.animationState = 2;
      }
      break;
    case 2:
      anim.scriptCallback();
      if (!anim.scriptActive) {
        SetBattlerSpriteAffineMode(1);
        if (bd.behindSubstitute && (!substituteNeedsFlag || multihit < 2)) {
          InitAndLaunchSpecialAnimation(a, a, a, K.B_ANIM_MON_TO_SUBSTITUTE);
          bd.flag_x8 = 0;
        }
        h.animationState = 3;
      }
      break;
    case 3:
      if (!h.specialAnimActive) {
        CopyAllBattleSpritesInvisibilities();
        TrySetBehindSubstituteSpriteBit(a, move);
        h.animationState = 0;
        return true;
      }
      break;
  }
  return false;
}

function PlayerDoMoveAnimation(): void {
  if (doMoveAnimationStep(true)) PlayerBufferExecCompleted();
}

function PlayerHandlePrintString(): void {
  g.battle_BG0_X = 0;
  g.battle_BG0_Y = 0;
  const stringId = bufA()[2] | (bufA()[3] << 8);
  bufferStringBattle(stringId);
  BattlePutTextOnWindow(g.displayedStringBattle, battleStringShouldBeColored(stringId) ? K.B_WIN_MSG | K.B_TEXT_FLAG_NPC_CONTEXT_FONT : K.B_WIN_MSG);
  g.battlerControllerFuncs[ab()] = CompleteOnInactiveTextPrinter;
}

function PlayerHandlePrintSelectionString(): void {
  if (getBattlerSide(ab()) === K.B_SIDE_PLAYER) PlayerHandlePrintString();
  else PlayerBufferExecCompleted();
}

function HandleChooseActionAfterDma3(): void {
  if (!IsDma3ManagerBusyWithBgCopy()) {
    g.battle_BG0_X = 0;
    g.battle_BG0_Y = 160;
    g.battlerControllerFuncs[ab()] = HandleInputChooseAction;
  }
}

/** The action menu text (shared by PlayerHandleChooseAction and the Oak/Old Man version). */
export function drawActionMenu(promptSym: string): void {
  BattlePutTextOnWindow(encodeBattleText('gText_EmptyString3'), K.B_WIN_MSG);
  BattlePutTextOnWindow(encodeBattleText('gText_BattleMenu'), K.B_WIN_ACTION_MENU);
  for (let i = 0; i < 4; ++i) ActionSelectionDestroyCursorAt(i);
  ActionSelectionCreateCursorAt(g.actionSelectionCursor[ab()], 0);
  g.displayedStringBattle = battleStringExpandPlaceholders(encodeBattleText(promptSym));
  BattlePutTextOnWindow(g.displayedStringBattle, K.B_WIN_ACTION_PROMPT);
}

function PlayerHandleChooseAction(): void {
  g.battlerControllerFuncs[ab()] = HandleChooseActionAfterDma3;
  drawActionMenu('gText_WhatWillPkmnDo');
}

function HandleChooseMoveAfterDma3(): void {
  if (!IsDma3ManagerBusyWithBgCopy()) {
    g.battle_BG0_X = 0;
    g.battle_BG0_Y = 320;
    g.battlerControllerFuncs[ab()] = HandleInputChooseMove;
  }
}

function PlayerHandleChooseMove(): void {
  InitMoveSelectionsVarsAndStrings();
  g.battlerControllerFuncs[ab()] = HandleChooseMoveAfterDma3;
}

function PlayerHandleChooseItem(): void {
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0x10, RGB_BLACK);
  g.battlerControllerFuncs[ab()] = OpenBagAndChooseItem;
  g.battlerInMenuId = ab();
  for (let i = 0; i < 3; ++i) g.battlePartyCurrentOrder[i] = bufA()[1 + i];
}

/** XHandleChoosePokemon (player and Oak/Old Man) */
export function handleChoosePokemon(next: () => void): void {
  const a = ab();
  g.battleControllerData[a] = CreateTask(TaskDummy, 0xff);
  gTasks[g.battleControllerData[a]].data[0] = bufA()[1] & 0xf;
  g.battleStruct.battlerPreventingSwitchout = bufA()[1] >> 4;
  g.battleStruct.playerPartyIdx = bufA()[2];
  g.battleStruct.abilityPreventingSwitchout = bufA()[3];
  for (let i = 0; i < 3; ++i) g.battlePartyCurrentOrder[i] = bufA()[4 + i];
  BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 0x10, RGB_BLACK);
  g.battlerControllerFuncs[a] = next;
  g.battlerInMenuId = a;
}

function PlayerHandleChoosePokemon(): void {
  handleChoosePokemon(OpenPartyMenuToChooseMon);
}

function PlayerHandleCmd23(): void {
  BattleStopLowHpSound();
  BeginNormalPaletteFade(PALETTES_ALL, 2, 0, 16, RGB_BLACK);
  PlayerBufferExecCompleted();
}

/** XHandleHealthBarUpdate (player side) */
export function handleHealthBarUpdate(next: () => void): void {
  const a = ab();
  LoadBattleBarGfx(0);
  const hpVal = ((bufA()[2] | (bufA()[3] << 8)) << 16) >> 16;
  const mon = monOf(a);
  if (hpVal !== K.INSTANT_HP_BAR_DROP) {
    SetBattleBarStruct(a, g.healthboxSpriteIds[a], mon.maxHP, mon.hp, hpVal);
  } else {
    SetBattleBarStruct(a, g.healthboxSpriteIds[a], mon.maxHP, 0, hpVal);
    UpdateHpTextInHealthbox(g.healthboxSpriteIds[a], 0, K.HP_CURRENT);
  }
  g.battlerControllerFuncs[a] = next;
}

function PlayerHandleHealthBarUpdate(): void {
  handleHealthBarUpdate(CompleteOnHealthbarDone);
}

function PlayerHandleExpUpdate(): void {
  const started = handleExpUpdate((b) => (g.battlerControllerFuncs[b] = CompleteOnInactiveTextPrinter), true);
  if (!started) PlayerBufferExecCompleted();
  else g.battlerControllerFuncs[ab()] = BattleControllerDummy;
}

function PlayerHandleStatusIconUpdate(): void {
  if (IsBattleSEPlaying(ab())) return;
  UpdateHealthboxAttribute(g.healthboxSpriteIds[ab()], monOf(ab()), K.HEALTHBOX_STATUS_ICON);
  sbd().healthBoxesData[ab()].statusAnimActive = 0;
  g.battlerControllerFuncs[ab()] = CompleteOnFinishedStatusAnimation;
}

function PlayerHandleStatusAnimation(): void {
  if (IsBattleSEPlaying(ab())) return;
  const b = bufA();
  InitAndLaunchChosenStatusAnimation(!!b[1], (b[2] | (b[3] << 8) | (b[4] << 16) | (b[5] << 24)) >>> 0);
  g.battlerControllerFuncs[ab()] = CompleteOnFinishedStatusAnimation;
}

function PlayerHandleStatusXor(): void {
  handleStatusXor(party());
  PlayerBufferExecCompleted();
}

function PlayerHandlePlayBGM(): void {
  PlayBGM(bufA()[1] | (bufA()[2] << 8));
  PlayerBufferExecCompleted();
}

function PlayerHandleTwoReturnValues(): void {
  emitTwoReturnValues(K.BUFFER_B, 0, 0);
  PlayerBufferExecCompleted();
}

function PlayerHandleChosenMonReturnValue(): void {
  emitChosenMonReturnValue(K.BUFFER_B, 0, [0, 0, 0]);
  PlayerBufferExecCompleted();
}

function PlayerHandleOneReturnValue(): void {
  emitOneReturnValue(K.BUFFER_B, 0);
  PlayerBufferExecCompleted();
}

function PlayerHandleOneReturnValue_Duplicate(): void {
  emitOneReturnValue_Duplicate(K.BUFFER_B, 0);
  PlayerBufferExecCompleted();
}

function PlayerHandleHitAnimation(): void {
  const s = gSprites[g.battlerSpriteIds[ab()]];
  if (s.invisible) {
    PlayerBufferExecCompleted();
  } else {
    g.doingBattleAnim = true;
    s.data[1] = 0;
    DoHitAnimHealthboxEffect(ab());
    g.battlerControllerFuncs[ab()] = DoHitAnimBlinkSpriteEffect;
  }
}

function PlayerHandlePlaySE(): void {
  const pan = getBattlerSide(ab()) === K.B_SIDE_PLAYER ? K.SOUND_PAN_ATTACKER : K.SOUND_PAN_TARGET;
  PlaySE12WithPanning(bufA()[1] | (bufA()[2] << 8), pan);
  PlayerBufferExecCompleted();
}

function PlayerHandlePlayFanfare(): void {
  PlayFanfare(bufA()[1] | (bufA()[2] << 8));
  PlayerBufferExecCompleted();
}

function PlayerHandleFaintingCry(): void {
  PlayCry_ByMode(monOf(ab()).species, -25, K.CRY_MODE_FAINT);
  PlayerBufferExecCompleted();
}

function PlayerHandleIntroSlide(): void {
  HandleIntroSlide(bufA()[1]);
  g.introSlideFlags |= 1;
  PlayerBufferExecCompleted();
}

/** XHandleIntroTrainerBallThrow (player and Oak/Old Man in the first battle) */
export function handleIntroTrainerBallThrow(throwCallback: (s: Sprite) => void, startSendOut: (taskId: number) => void): void {
  const a = ab();
  const s = gSprites[g.battlerSpriteIds[a]];
  SetSpritePrimaryCoordsFromSecondaryCoords(s);
  s.data[0] = 50;
  s.data[2] = -40;
  s.data[4] = s.y;
  s.callback = throwCallback;
  s.data[5] = a;
  StoreSpriteCallbackInData6(s, SpriteCB_FreePlayerSpriteLoadMonSprite);
  StartSpriteAnim(s, 1);
  const paletteNum = AllocSpritePalette(0xd6f8);
  DecompressTrainerBackPaletteAt(playerBackPic(), paletteNum);
  s.oam.paletteNum = paletteNum;
  const taskId = CreateTask(startSendOut, 5);
  gTasks[taskId].data[0] = a;
  if (sbd().healthBoxesData[a].partyStatusSummaryShown) gTasks[g.battlerStatusSummaryTaskId[a]].func = Task_HidePartyStatusSummary;
  sbd().animationData.introAnimActive = 1;
  g.battlerControllerFuncs[a] = BattleControllerDummy;
}

function DecompressTrainerBackPaletteAt(picId: number, paletteNum: number): void {
  DecompressTrainerBackPalette(picId, paletteNum);
}

function PlayerHandleIntroTrainerBallThrow(): void {
  handleIntroTrainerBallThrow(PlayerThrowBall_StartAnimLinearTranslation, Task_StartSendOutAnim);
}

/** SpriteCB_FreePlayerSpriteLoadMonSprite */
export function SpriteCB_FreePlayerSpriteLoadMonSprite(sprite: Sprite): void {
  const battlerId = sprite.data[5];
  FreeSpriteOamMatrix(sprite);
  FreeSpritePaletteByTag(GetSpritePaletteTagByPaletteNum(sprite.oam.paletteNum));
  DestroySprite(sprite);
  BattleLoadPlayerMonSpriteGfx(monOf(battlerId), battlerId);
  StartSpriteAnim(gSprites[g.battlerSpriteIds[battlerId]], 0);
}

function Task_StartSendOutAnim(taskId: number): void {
  const d = gTasks[taskId].data;
  if (d[1] < 31) {
    ++d[1];
    return;
  }
  const saved = g.activeBattler;
  g.activeBattler = d[0];
  const a = g.activeBattler;
  g.battleBufferA[a][1] = g.battlerPartyIndexes[a];
  StartSendOutAnim(a, false);
  if (isDoubleBattle() && !(g.battleTypeFlags & K.BATTLE_TYPE_MULTI)) {
    const b = a ^ K.BIT_FLANK;
    g.battleBufferA[b][1] = g.battlerPartyIndexes[b];
    BattleLoadPlayerMonSpriteGfx(monOf(b), b);
    StartSendOutAnim(b, false);
  }
  g.battlerControllerFuncs[a] = Intro_TryShinyAnimShowHealthbox;
  g.activeBattler = saved;
  DestroyTask(taskId);
}

function PlayerHandleDrawPartyStatusSummary(): void {
  const a = ab();
  if (bufA()[1] && getBattlerSide(a) === K.B_SIDE_PLAYER) {
    PlayerBufferExecCompleted();
  } else {
    const h = sbd().healthBoxesData[a];
    h.partyStatusSummaryShown = 1;
    g.battlerStatusSummaryTaskId[a] = CreatePartyStatusSummarySprites(a, g.battleBufferAObj[a] as HpAndStatus[], !!bufA()[1], !!bufA()[2]);
    h.partyStatusDelayTimer = 0;
    if (bufA()[2] !== 0) h.partyStatusDelayTimer = 93;
    g.battlerControllerFuncs[a] = EndDrawPartyStatusSummary;
  }
}

function EndDrawPartyStatusSummary(): void {
  const h = sbd().healthBoxesData[ab()];
  if (h.partyStatusDelayTimer++ > 0x5c) {
    h.partyStatusDelayTimer = 0;
    PlayerBufferExecCompleted();
  }
}

function PlayerHandleHidePartyStatusSummary(): void {
  if (sbd().healthBoxesData[ab()].partyStatusSummaryShown) gTasks[g.battlerStatusSummaryTaskId[ab()]].func = Task_HidePartyStatusSummary;
  PlayerBufferExecCompleted();
}

function PlayerHandleEndBounceEffect(): void {
  EndBounceEffect(ab(), K.BOUNCE_HEALTHBOX);
  EndBounceEffect(ab(), K.BOUNCE_MON);
  PlayerBufferExecCompleted();
}

function PlayerHandleSpriteInvisibility(): void {
  if (IsBattlerSpritePresent(ab())) {
    gSprites[g.battlerSpriteIds[ab()]].invisible = !!bufA()[1];
    CopyBattleSpriteInvisibility(ab());
  }
  PlayerBufferExecCompleted();
}

function PlayerHandleBattleAnimation(): void {
  if (IsBattleSEPlaying(ab())) return;
  const animationId = bufA()[1];
  const argument = bufA()[2] | (bufA()[3] << 8);
  if (TryHandleLaunchBattleTableAnimation(ab(), ab(), ab(), animationId, argument)) PlayerBufferExecCompleted();
  else g.battlerControllerFuncs[ab()] = CompleteOnFinishedBattleAnimation;
}

function PlayerHandleLinkStandbyMsg(): void {
  switch (bufA()[1]) {
    case 0:
    case 1:
      EndBounceEffect(ab(), K.BOUNCE_HEALTHBOX);
      EndBounceEffect(ab(), K.BOUNCE_MON);
      break;
  }
  PlayerBufferExecCompleted();
}

function PlayerHandleResetActionMoveSelection(): void {
  switch (bufA()[1]) {
    case K.RESET_ACTION_MOVE_SELECTION:
      g.actionSelectionCursor[ab()] = 0;
      g.moveSelectionCursor[ab()] = 0;
      break;
    case K.RESET_ACTION_SELECTION:
      g.actionSelectionCursor[ab()] = 0;
      break;
    case K.RESET_MOVE_SELECTION:
      g.moveSelectionCursor[ab()] = 0;
      break;
  }
  PlayerBufferExecCompleted();
}

/** PlayerHandleCmd55: only link battles send it to this controller; their SetBattleEndCallbacks isn't ported */
function PlayerHandleCmd55(): void {
  g.battleOutcome = bufA()[1];
  FadeOutMapMusic(5);
  BeginFastPaletteFade(3);
  PlayerBufferExecCompleted();
}

const complete = PlayerBufferExecCompleted;

let commands: Record<number, () => void> | undefined;
function sPlayerBufferCommands(): Record<number, () => void> {
  return (commands ??= {
    [K.CONTROLLER_GETMONDATA]: PlayerHandleGetMonData,
    [K.CONTROLLER_GETRAWMONDATA]: complete, // raw struct reads aren't used by FRLG battle scripts
    [K.CONTROLLER_SETMONDATA]: PlayerHandleSetMonData,
    [K.CONTROLLER_SETRAWMONDATA]: complete,
    [K.CONTROLLER_LOADMONSPRITE]: PlayerHandleLoadMonSprite,
    [K.CONTROLLER_SWITCHINANIM]: PlayerHandleSwitchInAnim,
    [K.CONTROLLER_RETURNMONTOBALL]: PlayerHandleReturnMonToBall,
    [K.CONTROLLER_DRAWTRAINERPIC]: PlayerHandleDrawTrainerPic,
    [K.CONTROLLER_TRAINERSLIDE]: PlayerHandleTrainerSlide,
    [K.CONTROLLER_TRAINERSLIDEBACK]: PlayerHandleTrainerSlideBack,
    [K.CONTROLLER_FAINTANIMATION]: PlayerHandleFaintAnimation,
    [K.CONTROLLER_PALETTEFADE]: PlayerHandlePaletteFade,
    [K.CONTROLLER_SUCCESSBALLTHROWANIM]: PlayerHandleSuccessBallThrowAnim,
    [K.CONTROLLER_BALLTHROWANIM]: PlayerHandleBallThrowAnim,
    [K.CONTROLLER_PAUSE]: complete,
    [K.CONTROLLER_MOVEANIMATION]: PlayerHandleMoveAnimation,
    [K.CONTROLLER_PRINTSTRING]: PlayerHandlePrintString,
    [K.CONTROLLER_PRINTSTRINGPLAYERONLY]: PlayerHandlePrintSelectionString,
    [K.CONTROLLER_CHOOSEACTION]: PlayerHandleChooseAction,
    [K.CONTROLLER_UNKNOWNYESNOBOX]: () => {},
    [K.CONTROLLER_CHOOSEMOVE]: PlayerHandleChooseMove,
    [K.CONTROLLER_OPENBAG]: PlayerHandleChooseItem,
    [K.CONTROLLER_CHOOSEPOKEMON]: PlayerHandleChoosePokemon,
    [K.CONTROLLER_23]: PlayerHandleCmd23,
    [K.CONTROLLER_HEALTHBARUPDATE]: PlayerHandleHealthBarUpdate,
    [K.CONTROLLER_EXPUPDATE]: PlayerHandleExpUpdate,
    [K.CONTROLLER_STATUSICONUPDATE]: PlayerHandleStatusIconUpdate,
    [K.CONTROLLER_STATUSANIMATION]: PlayerHandleStatusAnimation,
    [K.CONTROLLER_STATUSXOR]: PlayerHandleStatusXor,
    [K.CONTROLLER_DATATRANSFER]: complete,
    [K.CONTROLLER_DMA3TRANSFER]: complete,
    [K.CONTROLLER_PLAYBGM]: PlayerHandlePlayBGM,
    [K.CONTROLLER_32]: complete,
    [K.CONTROLLER_TWORETURNVALUES]: PlayerHandleTwoReturnValues,
    [K.CONTROLLER_CHOSENMONRETURNVALUE]: PlayerHandleChosenMonReturnValue,
    [K.CONTROLLER_ONERETURNVALUE]: PlayerHandleOneReturnValue,
    [K.CONTROLLER_ONERETURNVALUE_DUPLICATE]: PlayerHandleOneReturnValue_Duplicate,
    [K.CONTROLLER_CLEARUNKVAR]: complete,
    [K.CONTROLLER_SETUNKVAR]: complete,
    [K.CONTROLLER_CLEARUNKFLAG]: complete,
    [K.CONTROLLER_TOGGLEUNKFLAG]: complete,
    [K.CONTROLLER_HITANIMATION]: PlayerHandleHitAnimation,
    [K.CONTROLLER_CANTSWITCH]: complete,
    [K.CONTROLLER_PLAYSE]: PlayerHandlePlaySE,
    [K.CONTROLLER_PLAYFANFARE]: PlayerHandlePlayFanfare,
    [K.CONTROLLER_FAINTINGCRY]: PlayerHandleFaintingCry,
    [K.CONTROLLER_INTROSLIDE]: PlayerHandleIntroSlide,
    [K.CONTROLLER_INTROTRAINERBALLTHROW]: PlayerHandleIntroTrainerBallThrow,
    [K.CONTROLLER_DRAWPARTYSTATUSSUMMARY]: PlayerHandleDrawPartyStatusSummary,
    [K.CONTROLLER_HIDEPARTYSTATUSSUMMARY]: PlayerHandleHidePartyStatusSummary,
    [K.CONTROLLER_ENDBOUNCE]: PlayerHandleEndBounceEffect,
    [K.CONTROLLER_SPRITEINVISIBILITY]: PlayerHandleSpriteInvisibility,
    [K.CONTROLLER_BATTLEANIMATION]: PlayerHandleBattleAnimation,
    [K.CONTROLLER_LINKSTANDBYMSG]: PlayerHandleLinkStandbyMsg,
    [K.CONTROLLER_RESETACTIONMOVESELECTION]: PlayerHandleResetActionMoveSelection,
    [K.CONTROLLER_ENDLINKBATTLE]: PlayerHandleCmd55,
    [K.CONTROLLER_TERMINATOR_NOP]: () => {},
  });
}
