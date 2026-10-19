// battle_script_commands.c, part 3: Cmd_handlelearnnewmove (0x59) .. Cmd_copymovepermanently (0xA8),
// plus ChangeStatBuffs, AttacksThisTurn, IsTwoTurnsMove, TrySetDestinyBondToHappen, UproarWakeUpCheck.

import { random } from '../util/random';
import { recordAbilityBattle, recordItemEffectBattle } from './ai';
import { BG_PLTT_ID, BeginNormalPaletteFade, gPaletteFade, LoadPalette } from '../gba/palette';
import { PALETTES_ALL, RGB_BLACK } from '../gba/hw';
import { IsDma3ManagerBusyWithBgCopy, SetBgAttribute, ShowBg, BG_ATTR_PRIORITY } from '../gba/bg';
import { gfx, gfx16 } from '../gba/gfx';
import { gMain } from '../gba/main';
import { GetMoveSlotToReplace, ShowSelectMovePokemonSummaryScreen } from '../menus/summaryScreen';
import { BattleMainCB2 } from './battleCallbacks';
import { ReshowBattleScreenAfterMenu } from './reshowBattleScreen';
import { AddTextPrinter, AddTextPrinterParameterized3, FreeAllWindowBuffers, ClearWindowTilemap, COPYWIN_FULL, COPYWIN_GFX, COPYWIN_MAP, CopyToWindowPixelBuffer, CopyWindowToVram, FillWindowPixelBuffer, PIXEL_FILL, PutWindowTilemap, TEXT_SKIP_DRAW } from '../gba/window';
import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEFT_ALIGN, strBody } from './stringUtil';
import type { Pokemon } from '../pokemon/Pokemon';
import { ui } from './battleUi';
import { IsFanfareTaskInactive, PlaySE } from '../gba/sound';
import { BattleCreateYesNoCursorAt, BattleDestroyYesNoCursorAt, BattlePutTextOnWindow, HandleBattleWindow } from './battleWindow';
import { adv, b, h, typeAtk, typeDef, typeMul, w } from './bsCommands1';
import { K } from './constants';
import {
  emitDrawPartyStatusSummary,
  emitGetMonData,
  emitHealthBarUpdate,
  emitHidePartyStatusSummary,
  emitHitAnimation,
  emitResetActionMoveSelection,
  emitReturnMonToBall,
  emitSetMonData,
  emitSpriteInvisibility,
  emitStatusAnimation,
  emitStatusIconUpdate,
  markBattlerForControllerExec,
  u16,
  u32,
} from './controllers';
import { bdata, g, gBattleMoves, gSpeciesInfo, itemHoldEffect, mem, pokemon, state } from './env';
import { bit } from './globals';
import { pokemonUseItemEffects } from './items';
import { isRunningFromBattleImpossible, tryRunFromBattle } from './main';
import { isMultiBattle, switchPartyOrderLinkMulti } from './partyOrder';
import {
  calculateBaseDamage,
  countAliveMonsInBattle,
  getGenderFromSpeciesAndPersonality,
  giveMoveToBattleMon,
  monTryLearningNewMove,
  partyOf,
  removeBattleMonPPBonus,
  removeMonPPBonus,
  setBattleMonMoveSlot,
  setMonMoveSlot,
} from './pokemonBattle';
import {
  prepareByteNumberBuffer,
  prepareHwordNumberBuffer,
  prepareMonNickBuffer,
  prepareMoveBuffer,
  prepareSpeciesBuffer,
  prepareStatBuffer,
  prepareTypeBuffer,
  prepareWordNumberBuffer,
} from './textBuffers';
import {
  battleScriptPush,
  bs,
  cancelMultiTurnMoves,
  getBattlerAtPosition,
  getBattlerForBattleScript,
  getBattlerPosition,
  getBattlerSide,
  getMoveTarget,
  isBattlerOfType,
  isGhostWithoutScope,
  moveIsPermanent,
  prepareStringBattle,
  resetSentPokesToOpponentValue,
  setBattlerType,
  weatherHasEffect,
} from './util';
import { updatePartyOwnerOnSwitch_NonMulti } from './main';

const mech = () => bdata.tables.mech as Record<string, number[]>;
const hitmarkerFainted = (battler: number) => (bit(battler) << 28) >>> 0;
const effectScript = (move: number) => mem.u32(mem.label('gBattleScriptsForMoveEffects') + gBattleMoves[move].effect * 4);
const WINDOW_CLEAR = 1;

export function Cmd_handlelearnnewmove(): void {
  const learnedMovePtr = w(1);
  const nothingToLearnPtr = w(5);
  const mon = g.playerParty[g.battleStruct.expGetterMonId]!;
  let learnMove = monTryLearningNewMove(mon, !!b(9));
  while (learnMove === K.MON_ALREADY_KNOWS_MOVE) learnMove = monTryLearningNewMove(mon, false);
  if (learnMove === K.MOVE_NONE) {
    g.battlescriptCurrInstr = nothingToLearnPtr;
  } else if (learnMove === K.MON_HAS_MAX_MOVES) {
    adv(10);
  } else {
    const give = (pos: number) => {
      g.activeBattler = getBattlerAtPosition(pos);
      if (g.battlerPartyIndexes[g.activeBattler] === g.battleStruct.expGetterMonId && !(g.battleMons[g.activeBattler].status2 & K.STATUS2_TRANSFORMED))
        giveMoveToBattleMon(g.battleMons[g.activeBattler], learnMove);
    };
    give(K.B_POSITION_PLAYER_LEFT);
    if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) give(K.B_POSITION_PLAYER_RIGHT);
    g.battlescriptCurrInstr = learnedMovePtr;
  }
}

/** The YES/NO box loop shared by yesnoboxlearnmove / yesnoboxstoplearningmove / yesnobox. */
function yesNoMove(): void {
  const mc = g.battleCommunication;
  if (ui.joyNew('UP') && mc[K.CURSOR_POSITION] !== 0) {
    PlaySE(K.SE_SELECT);
    BattleDestroyYesNoCursorAt(mc[K.CURSOR_POSITION]);
    mc[K.CURSOR_POSITION] = 0;
    BattleCreateYesNoCursorAt(0);
  }
  if (ui.joyNew('DOWN') && mc[K.CURSOR_POSITION] === 0) {
    PlaySE(K.SE_SELECT);
    BattleDestroyYesNoCursorAt(mc[K.CURSOR_POSITION]);
    mc[K.CURSOR_POSITION] = 1;
    BattleCreateYesNoCursorAt(1);
  }
}

function openYesNo(): void {
  HandleBattleWindow(23, 8, 29, 13, 0);
  BattlePutTextOnWindow(textOf('gText_BattleYesNoChoice'), K.B_WIN_YESNO);
  g.battleCommunication[K.CURSOR_POSITION] = 0;
  BattleCreateYesNoCursorAt(0);
}

import { encodeBattleText } from './message';
function textOf(sym: string): number[] {
  return encodeBattleText(sym);
}

export function Cmd_yesnoboxlearnmove(): void {
  g.activeBattler = 0;
  const scr = g.battleScripting;
  const id = g.battleStruct.expGetterMonId;
  switch (scr.learnMoveState) {
    case 0:
      openYesNo();
      scr.learnMoveState++;
      break;
    case 1:
      yesNoMove();
      if (ui.joyNew('A')) {
        PlaySE(K.SE_SELECT);
        if (g.battleCommunication[1] === 0) {
          HandleBattleWindow(23, 8, 29, 13, WINDOW_CLEAR);
          BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK);
          scr.learnMoveState++;
        } else {
          scr.learnMoveState = 4;
        }
      } else if (ui.joyNew('B')) {
        PlaySE(K.SE_SELECT);
        scr.learnMoveState = 4;
      }
      break;
    case 2:
      if (!gPaletteFade.active) {
        FreeAllWindowBuffers();
        ShowSelectMovePokemonSummaryScreen(state.party, id, state.party.length - 1, ReshowBattleScreenAfterMenu, g.moveToLearn);
        scr.learnMoveState++;
      }
      break;
    case 3: {
      if (gPaletteFade.active || gMain.callback2 !== BattleMainCB2) break;
      const movePosition = GetMoveSlotToReplace();
      if (movePosition === K.MAX_MON_MOVES) {
        scr.learnMoveState = 4;
      } else {
        const mon = g.playerParty[id]!;
        const moveId = mon.moves[movePosition];
        if (isHMMove2(moveId)) {
          prepareStringBattle(K.STRINGID_HMMOVESCANTBEFORGOTTEN, g.activeBattler);
          scr.learnMoveState = 5;
        } else {
          g.battlescriptCurrInstr = w(1);
          prepareMoveBuffer(g.battleTextBuff2, moveId);
          removeMonPPBonus(mon, movePosition);
          setMonMoveSlot(mon, g.moveToLearn, movePosition);
          if (g.battlerPartyIndexes[0] === id && moveIsPermanent(0, movePosition)) {
            removeBattleMonPPBonus(g.battleMons[0], movePosition);
            setBattleMonMoveSlot(g.battleMons[0], g.moveToLearn, movePosition);
          }
          if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && g.battlerPartyIndexes[2] === id && moveIsPermanent(2, movePosition)) {
            removeBattleMonPPBonus(g.battleMons[2], movePosition);
            setBattleMonMoveSlot(g.battleMons[2], g.moveToLearn, movePosition);
          }
        }
      }
      break;
    }
    case 4:
      HandleBattleWindow(23, 8, 29, 13, WINDOW_CLEAR);
      adv(5);
      break;
    case 5:
      if (g.battleControllerExecFlags === 0) scr.learnMoveState = 2;
      break;
  }
}

/** IsHMMove2 */
export function isHMMove2(move: number): boolean {
  const hm = mech().sHMMoves;
  for (let i = 0; hm[i] !== 0xffff; i++) if (hm[i] === move) return true;
  return false;
}

export function Cmd_yesnoboxstoplearningmove(): void {
  const scr = g.battleScripting;
  switch (scr.learnMoveState) {
    case 0:
      openYesNo();
      scr.learnMoveState++;
      break;
    case 1:
      yesNoMove();
      if (ui.joyNew('A')) {
        PlaySE(K.SE_SELECT);
        if (g.battleCommunication[1] !== 0) g.battlescriptCurrInstr = w(1);
        else adv(5);
        HandleBattleWindow(23, 8, 29, 13, WINDOW_CLEAR);
      } else if (ui.joyNew('B')) {
        PlaySE(K.SE_SELECT);
        g.battlescriptCurrInstr = w(1);
        HandleBattleWindow(23, 8, 29, 13, WINDOW_CLEAR);
      }
      break;
  }
}

export function Cmd_hitanimation(): void {
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  if (g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) {
    adv(2);
  } else if (!(g.hitMarker & K.HITMARKER_IGNORE_SUBSTITUTE) || !(g.battleMons[ab].status2 & K.STATUS2_SUBSTITUTE) || g.disableStructs[ab].substituteHP === 0) {
    emitHitAnimation(K.BUFFER_A);
    markBattlerForControllerExec(ab);
    adv(2);
  } else {
    adv(2);
  }
}

/** ComputeWhiteOutMoneyLoss (overworld.c) */
export function computeWhiteOutMoneyLoss(): number {
  const flags = mech().sWhiteOutMoneyLossBadgeFlagIDs;
  const nbadges = flags.filter((f) => state.getFlag(f)).length;
  const toplevel = g.playerParty.reduce((m, p) => (p && p.species && !p.isEgg && p.level > m ? p.level : m), 0); // GetPlayerPartyHighestLevel
  const losings = toplevel * 4 * mech().sWhiteOutMoneyLossMultipliers[nbadges];
  return losings > state.money ? state.money : losings;
}

export function Cmd_getmoneyreward(): void {
  let moneyReward: number;
  if (g.battleOutcome === K.B_OUTCOME_WON) {
    const trainer = bdata.tables.trainers[g.trainerBattleOpponent_A]!;
    const lastMonLevel = trainer.party[trainer.party.length - 1].lvl;
    const money = bdata.tables.trainerMoney;
    let i = 0;
    for (; money[i][0] !== 0xff; i++) if (money[i][0] === trainer.trainerClass) break;
    moneyReward = 4 * lastMonLevel * g.battleStruct.moneyMultiplier * (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE ? 2 : 1) * money[i][1];
    state.addMoney(moneyReward);
  } else {
    moneyReward = computeWhiteOutMoneyLoss();
  }
  prepareWordNumberBuffer(g.battleTextBuff1, 5, moneyReward);
  if (moneyReward) adv(5);
  else g.battlescriptCurrInstr = w(1);
}

/** Command is never used */
export function Cmd_updatebattlermoves(): void {
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  switch (g.battleCommunication[0]) {
    case 0:
      emitGetMonData(K.BUFFER_A, K.REQUEST_ALL_BATTLE, 0);
      markBattlerForControllerExec(ab);
      g.battleCommunication[0]++;
      break;
    case 1:
      if (g.battleControllerExecFlags === 0) {
        const p = g.battleBufferBObj[ab] as import('./structs').BattlePokemon;
        for (let i = 0; i < K.MAX_MON_MOVES; i++) {
          g.battleMons[ab].moves[i] = p.moves[i];
          g.battleMons[ab].pp[i] = p.pp[i];
        }
        adv(2);
      }
      break;
  }
}

export function Cmd_swapattackerwithtarget(): void {
  g.activeBattler = g.battlerAttacker;
  g.battlerAttacker = g.battlerTarget;
  g.battlerTarget = g.activeBattler;
  if (g.hitMarker & K.HITMARKER_SWAP_ATTACKER_TARGET) g.hitMarker &= ~K.HITMARKER_SWAP_ATTACKER_TARGET;
  else g.hitMarker |= K.HITMARKER_SWAP_ATTACKER_TARGET;
  adv(1);
}

export function Cmd_incrementgamestat(): void {
  // IncrementGameStat: game stats aren't tracked yet
  adv(2);
}

export function Cmd_drawpartystatussummary(): void {
  if (g.battleControllerExecFlags) return;
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  const party = partyOf(ab);
  const hpStatuses = [];
  for (let i = 0; i < K.PARTY_SIZE; i++) {
    const mon = party[i];
    if (!mon || mon.species === K.SPECIES_NONE || mon.isEgg) hpStatuses.push({ hp: 0xffff, status: 0 });
    else hpStatuses.push({ hp: mon.hp, status: mon.status });
  }
  emitDrawPartyStatusSummary(K.BUFFER_A, hpStatuses, 1);
  markBattlerForControllerExec(ab);
  adv(2);
}

export function Cmd_hidepartystatussummary(): void {
  g.activeBattler = getBattlerForBattleScript(b(1));
  emitHidePartyStatusSummary(K.BUFFER_A);
  markBattlerForControllerExec(g.activeBattler);
  adv(2);
}

export function Cmd_jumptocalledmove(): void {
  if (b(1)) g.currentMove = g.calledMove;
  else g.chosenMove = g.currentMove = g.calledMove;
  g.battlescriptCurrInstr = effectScript(g.currentMove);
}

function canAnimateStatus(battler: number): boolean {
  return !(g.statuses3[battler] & K.STATUS3_SEMI_INVULNERABLE) && g.disableStructs[battler].substituteHP === 0 && !(g.hitMarker & K.HITMARKER_NO_ANIMATIONS);
}

export function Cmd_statusanimation(): void {
  if (g.battleControllerExecFlags === 0) {
    const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
    if (canAnimateStatus(ab)) {
      emitStatusAnimation(K.BUFFER_A, false, g.battleMons[ab].status1);
      markBattlerForControllerExec(ab);
    }
    adv(2);
  }
}

export function Cmd_status2animation(): void {
  if (g.battleControllerExecFlags === 0) {
    const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
    const wantedToAnimate = w(2);
    if (canAnimateStatus(ab)) {
      emitStatusAnimation(K.BUFFER_A, true, g.battleMons[ab].status2 & wantedToAnimate);
      markBattlerForControllerExec(ab);
    }
    adv(6);
  }
}

export function Cmd_chosenstatusanimation(): void {
  if (g.battleControllerExecFlags === 0) {
    const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
    const wantedStatus = w(3);
    if (canAnimateStatus(ab)) {
      emitStatusAnimation(K.BUFFER_A, b(2), wantedStatus);
      markBattlerForControllerExec(ab);
    }
    adv(7);
  }
}

export function Cmd_yesnobox(): void {
  const mc = g.battleCommunication;
  switch (mc[0]) {
    case 0:
      openYesNo();
      mc[0]++;
      break;
    case 1:
      yesNoMove();
      if (ui.joyNew('B')) {
        mc[K.CURSOR_POSITION] = 1;
        PlaySE(K.SE_SELECT);
        HandleBattleWindow(23, 8, 29, 13, WINDOW_CLEAR);
        adv(1);
      } else if (ui.joyNew('A')) {
        PlaySE(K.SE_SELECT);
        HandleBattleWindow(23, 8, 29, 13, WINDOW_CLEAR);
        adv(1);
      }
      break;
  }
}

export function Cmd_cancelallactions(): void {
  for (let i = 0; i < g.battlersCount; i++) g.actionsByTurnOrder[i] = K.B_ACTION_CANCEL_PARTNER;
  adv(1);
}

/** The same as adjustnormaldamage, except there's no random damage multiplier. */
export function Cmd_adjustsetdamage(): void {
  const tgt = g.battlerTarget;
  const def = g.battleMons[tgt];
  const holdEffect = def.item === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[tgt].holdEffect : itemHoldEffect(def.item);
  const param = def.item === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[tgt].holdEffectParam : bdata && (gItemsParam(def.item));
  g.potentialItemEffectBattler = tgt;
  if (holdEffect === K.HOLD_EFFECT_FOCUS_BAND && random() % 100 < param) {
    recordItemEffectBattle(tgt, holdEffect);
    g.specialStatuses[tgt].focusBanded = 1;
  }
  if (
    !(def.status2 & K.STATUS2_SUBSTITUTE) &&
    (gBattleMoves[g.currentMove].effect === K.EFFECT_FALSE_SWIPE || g.protectStructs[tgt].endured || g.specialStatuses[tgt].focusBanded) &&
    def.hp <= g.battleMoveDamage
  ) {
    g.battleMoveDamage = def.hp - 1;
    if (g.protectStructs[tgt].endured) {
      g.moveResultFlags |= K.MOVE_RESULT_FOE_ENDURED;
    } else if (g.specialStatuses[tgt].focusBanded) {
      g.moveResultFlags |= K.MOVE_RESULT_FOE_HUNG_ON;
      g.lastUsedItem = def.item;
    }
  }
  adv(1);
}
import { itemHoldEffectParam as gItemsParam } from './env';

export function Cmd_removeitem(): void {
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  g.battleStruct.usedHeldItems[ab] = g.battleMons[ab].item;
  g.battleMons[ab].item = K.ITEM_NONE;
  emitSetMonData(K.BUFFER_A, K.REQUEST_HELDITEM_BATTLE, 0, u16(0));
  markBattlerForControllerExec(ab);
  adv(2);
}

export function Cmd_atknameinbuff1(): void {
  prepareMonNickBuffer(g.battleTextBuff1, g.battlerAttacker, g.battlerPartyIndexes[g.battlerAttacker]);
  adv(1);
}

const LEVEL_UP_BANNER_START = 416;
const LEVEL_UP_BANNER_END = 512;

/** IsMonGettingExpSentOut */
function isMonGettingExpSentOut(): boolean {
  if (g.battlerPartyIndexes[0] === g.battleStruct.expGetterMonId) return true;
  return !!(g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && g.battlerPartyIndexes[2] === g.battleStruct.expGetterMonId);
}

/** GetMonLevelUpWindowStats (pokemon_special_anim.c) */
export function GetMonLevelUpWindowStats(mon: Pokemon): number[] {
  return [mon.maxHP, mon.stats.attack, mon.stats.defense, mon.stats.speed, mon.stats.spAttack, mon.stats.spDefense];
}

/** sLevelUpWindowStatNames (pokemon_special_anim_scene.c) */
const sLevelUpWindowStatNames = ['gText_LevelUp_MaxHP', 'gText_LevelUp_Attack', 'gText_LevelUp_Defense', 'gText_LevelUp_SpAtk', 'gText_LevelUp_SpDef', 'gText_LevelUp_Speed'];

/** DrawLevelUpWindowPg1 (pokemon_special_anim_scene.c) */
export function DrawLevelUpWindowPg1(windowId: number, beforeStats: ArrayLike<number>, afterStats: ArrayLike<number>, bgColor: number, fgColor: number, shadowColor: number): void {
  FillWindowPixelBuffer(windowId, PIXEL_FILL(bgColor));
  const s16 = (v: number) => (v << 16) >> 16;
  const diffStats = [
    s16(afterStats[0] - beforeStats[0]),
    s16(afterStats[1] - beforeStats[1]),
    s16(afterStats[2] - beforeStats[2]),
    s16(afterStats[4] - beforeStats[4]),
    s16(afterStats[5] - beforeStats[5]),
    s16(afterStats[3] - beforeStats[3]),
  ];
  const textColor = [bgColor, fgColor, shadowColor];
  for (let i = 0; i < 6; i++) {
    AddTextPrinterParameterized3(windowId, K.FONT_NORMAL, 0, i * 15, textColor, TEXT_SKIP_DRAW, encodeBattleText(sLevelUpWindowStatNames[i]));
    AddTextPrinterParameterized3(windowId, K.FONT_NORMAL, 56, i * 15, textColor, TEXT_SKIP_DRAW, encodeBattleText(diffStats[i] >= 0 ? 'gText_LevelUp_Plus' : 'gText_LevelUp_Minus'));
    const x = Math.abs(diffStats[i]) < 10 ? 12 : 6;
    const textbuf = [K.CHAR_SPACE, ...ConvertIntToDecimalStringN(Math.abs(diffStats[i]), STR_CONV_MODE_LEFT_ALIGN, 2), K.EOS];
    AddTextPrinterParameterized3(windowId, K.FONT_NORMAL, x + 56, i * 15, textColor, TEXT_SKIP_DRAW, textbuf);
  }
}

/** DrawLevelUpWindowPg2 (pokemon_special_anim_scene.c) */
export function DrawLevelUpWindowPg2(windowId: number, currStats: ArrayLike<number>, bgColor: number, fgColor: number, shadowColor: number): void {
  FillWindowPixelBuffer(windowId, PIXEL_FILL(bgColor));
  const statsRearrange = [currStats[0], currStats[1], currStats[2], currStats[4], currStats[5], currStats[3]];
  const textColor = [bgColor, fgColor, shadowColor];
  for (let i = 0; i < 6; i++) {
    const ndigits = statsRearrange[i] >= 100 ? 3 : statsRearrange[i] >= 10 ? 2 : 1;
    const textbuf = [...ConvertIntToDecimalStringN(statsRearrange[i], STR_CONV_MODE_LEFT_ALIGN, ndigits), K.EOS];
    const x = 6 * (4 - ndigits);
    AddTextPrinterParameterized3(windowId, K.FONT_NORMAL, 0, i * 15, textColor, TEXT_SKIP_DRAW, encodeBattleText(sLevelUpWindowStatNames[i]));
    AddTextPrinterParameterized3(windowId, K.FONT_NORMAL, 56 + x, i * 15, textColor, TEXT_SKIP_DRAW, textbuf);
  }
}

function DrawLevelUpWindow1(): void {
  const currStats = GetMonLevelUpWindowStats(g.playerParty[g.battleStruct.expGetterMonId]!);
  DrawLevelUpWindowPg1(K.B_WIN_LEVEL_UP_BOX, g.battleResources.beforeLvlUp, currStats, K.TEXT_DYNAMIC_COLOR_5, K.TEXT_DYNAMIC_COLOR_4, K.TEXT_DYNAMIC_COLOR_6);
}

function DrawLevelUpWindow2(): void {
  const currStats = GetMonLevelUpWindowStats(g.playerParty[g.battleStruct.expGetterMonId]!);
  DrawLevelUpWindowPg2(K.B_WIN_LEVEL_UP_BOX, currStats, K.TEXT_DYNAMIC_COLOR_5, K.TEXT_DYNAMIC_COLOR_4, K.TEXT_DYNAMIC_COLOR_6);
}

/** InitLevelUpBanner */
function InitLevelUpBanner(): void {
  g.battle_BG2_Y = 0;
  g.battle_BG2_X = LEVEL_UP_BANNER_START;
  const pal = gfx16('sLevelUpBanner_Pal');
  LoadPalette(pal, BG_PLTT_ID(6), pal.length * 2);
  CopyToWindowPixelBuffer(K.B_WIN_LEVEL_UP_BANNER, gfx('sLevelUpBanner_Gfx'), 0, 0);
  PutWindowTilemap(K.B_WIN_LEVEL_UP_BANNER);
  CopyWindowToVram(K.B_WIN_LEVEL_UP_BANNER, COPYWIN_FULL);
  // PutMonIconOnLvlUpBanner: mon icons aren't extracted yet
  console.warn('[battle] level up banner mon icon not implemented');
}

/** SlideInLevelUpBanner */
function SlideInLevelUpBanner(): boolean {
  if (IsDma3ManagerBusyWithBgCopy()) return true;
  if (g.battle_BG2_X === LEVEL_UP_BANNER_END) return false;
  if (g.battle_BG2_X === LEVEL_UP_BANNER_START) DrawLevelUpBannerText();
  g.battle_BG2_X += 8;
  if (g.battle_BG2_X >= LEVEL_UP_BANNER_END) g.battle_BG2_X = LEVEL_UP_BANNER_END;
  return g.battle_BG2_X !== LEVEL_UP_BANNER_END;
}

/** WriteColorChangeControlCode (string_util.c) */
function WriteColorChangeControlCode(dest: number[], at: number, colorType: number, color: number): number {
  dest[at++] = K.EXT_CTRL_CODE_BEGIN;
  dest[at++] = colorType === 0 ? K.EXT_CTRL_CODE_COLOR : colorType === 1 ? K.EXT_CTRL_CODE_SHADOW : K.EXT_CTRL_CODE_HIGHLIGHT;
  dest[at++] = color;
  dest[at] = K.EOS;
  return at;
}

/** DrawLevelUpBannerText */
function DrawLevelUpBannerText(): void {
  const mon = g.playerParty[g.battleStruct.expGetterMonId]!;
  const monLevel = mon.level;
  const monGender = pokemon.gender(mon);
  const printerTemplate = {
    currentChar: [...strBody(mon.nickname), K.EOS], // GetMonNickname
    windowId: K.B_WIN_LEVEL_UP_BANNER,
    fontId: K.FONT_SMALL,
    x: 32,
    y: 0,
    letterSpacing: 0,
    lineSpacing: 0,
    fgColor: K.TEXT_COLOR_WHITE,
    bgColor: K.TEXT_COLOR_TRANSPARENT,
    shadowColor: K.TEXT_COLOR_DARK_GRAY,
  };
  AddTextPrinter(printerTemplate, TEXT_SKIP_DRAW);
  // gStringVar4 = {CHAR_EXTRA_SYMBOL, CHAR_LV_2, 0, level (left-aligned), five spaces}; gender at [7]
  const buf: number[] = [K.CHAR_EXTRA_SYMBOL, K.CHAR_LV_2, 0];
  buf.push(...ConvertIntToDecimalStringN(monLevel, STR_CONV_MODE_LEFT_ALIGN, 3));
  for (let i = 0; i < 5; i++) buf.push(0);
  buf.push(K.EOS);
  if (monGender !== K.MON_GENDERLESS) {
    let at = 7;
    if (monGender === K.MON_MALE) {
      at = WriteColorChangeControlCode(buf, at, 0, K.TEXT_DYNAMIC_COLOR_3);
      at = WriteColorChangeControlCode(buf, at, 1, K.TEXT_DYNAMIC_COLOR_4);
      buf[at++] = K.CHAR_MALE;
    } else {
      at = WriteColorChangeControlCode(buf, at, 0, K.TEXT_DYNAMIC_COLOR_5);
      at = WriteColorChangeControlCode(buf, at, 1, K.TEXT_DYNAMIC_COLOR_6);
      buf[at++] = K.CHAR_FEMALE;
    }
    buf[at++] = K.EOS;
  }
  AddTextPrinter({ ...printerTemplate, currentChar: buf, y: 10 }, TEXT_SKIP_DRAW);
  CopyWindowToVram(K.B_WIN_LEVEL_UP_BANNER, COPYWIN_GFX);
}

/** SlideOutLevelUpBanner */
function SlideOutLevelUpBanner(): boolean {
  if (g.battle_BG2_X === LEVEL_UP_BANNER_START) return false;
  if (g.battle_BG2_X - 16 < LEVEL_UP_BANNER_START) g.battle_BG2_X = LEVEL_UP_BANNER_START;
  else g.battle_BG2_X -= 16;
  return g.battle_BG2_X !== LEVEL_UP_BANNER_START;
}

export function Cmd_drawlvlupbox(): void {
  const scr = g.battleScripting;
  if (scr.drawlvlupboxState === 0) {
    // If the Pokémon getting exp is not in-battle then slide out a banner with their name and icon.
    scr.drawlvlupboxState = isMonGettingExpSentOut() ? 3 : 1;
  }
  switch (scr.drawlvlupboxState) {
    case 1: // Start level up banner
      g.battle_BG2_Y = 96;
      SetBgAttribute(2, BG_ATTR_PRIORITY, 0);
      ShowBg(2);
      InitLevelUpBanner();
      scr.drawlvlupboxState = 2;
      break;
    case 2:
      if (!SlideInLevelUpBanner()) scr.drawlvlupboxState = 3;
      break;
    case 3: // Init level up box
      g.battle_BG1_X = 0;
      g.battle_BG1_Y = 256;
      SetBgAttribute(0, BG_ATTR_PRIORITY, 1);
      SetBgAttribute(1, BG_ATTR_PRIORITY, 0);
      ShowBg(0);
      ShowBg(1);
      HandleBattleWindow(18, 7, 29, 19, K.WINDOW_BG1);
      scr.drawlvlupboxState = 4;
      break;
    case 4: // Draw page 1 of level up box
      DrawLevelUpWindow1();
      PutWindowTilemap(K.B_WIN_LEVEL_UP_BOX);
      CopyWindowToVram(K.B_WIN_LEVEL_UP_BOX, COPYWIN_FULL);
      scr.drawlvlupboxState++;
      break;
    case 5:
    case 7: // Wait for draw after each page
      if (!IsDma3ManagerBusyWithBgCopy()) {
        g.battle_BG1_Y = 0;
        scr.drawlvlupboxState++;
      }
      break;
    case 6:
      if (ui.anyNewKeys()) {
        // Draw page 2 of level up box
        PlaySE(K.SE_SELECT);
        DrawLevelUpWindow2();
        CopyWindowToVram(K.B_WIN_LEVEL_UP_BOX, COPYWIN_GFX);
        scr.drawlvlupboxState++;
      }
      break;
    case 8:
      if (ui.anyNewKeys()) {
        // Close level up box
        PlaySE(K.SE_SELECT);
        HandleBattleWindow(18, 7, 29, 19, K.WINDOW_BG1 | WINDOW_CLEAR);
        scr.drawlvlupboxState++;
      }
      break;
    case 9:
      if (!SlideOutLevelUpBanner()) {
        ClearWindowTilemap(K.B_WIN_LEVEL_UP_BANNER);
        CopyWindowToVram(K.B_WIN_LEVEL_UP_BANNER, COPYWIN_MAP);
        ClearWindowTilemap(K.B_WIN_LEVEL_UP_BOX);
        CopyWindowToVram(K.B_WIN_LEVEL_UP_BOX, COPYWIN_MAP);
        SetBgAttribute(2, BG_ATTR_PRIORITY, 2);
        ShowBg(2);
        scr.drawlvlupboxState = 10;
      }
      break;
    case 10:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        SetBgAttribute(0, BG_ATTR_PRIORITY, 0);
        SetBgAttribute(1, BG_ATTR_PRIORITY, 1);
        ShowBg(0);
        ShowBg(1);
        adv(1);
      }
      break;
  }
}

export function Cmd_resetsentmonsvalue(): void {
  resetSentPokesToOpponentValue();
  adv(1);
}

export function Cmd_setatktoplayer0(): void {
  g.battlerAttacker = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
  adv(1);
}

export function Cmd_makevisible(): void {
  g.activeBattler = getBattlerForBattleScript(b(1));
  emitSpriteInvisibility(K.BUFFER_A, false);
  markBattlerForControllerExec(g.activeBattler);
  adv(2);
}

export function Cmd_recordlastability(): void {
  g.activeBattler = getBattlerForBattleScript(b(1));
  recordAbilityBattle(g.activeBattler, g.lastUsedAbility);
  adv(1); // the decomp only advances by one byte here (fixed under BUGFIX)
}

/** BufferMoveToLearnIntoBattleTextBuff2 */
export function bufferMoveToLearnIntoBattleTextBuff2(): void {
  prepareMoveBuffer(g.battleTextBuff2, g.moveToLearn);
}

export function Cmd_buffermovetolearn(): void {
  bufferMoveToLearnIntoBattleTextBuff2();
  adv(1);
}

export function Cmd_jumpifplayerran(): void {
  if (tryRunFromBattle(g.battlerFainted)) g.battlescriptCurrInstr = w(1);
  else adv(5);
}

export function Cmd_hpthresholds(): void {
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE)) {
    g.activeBattler = getBattlerForBattleScript(b(1));
    const opp = g.battleMons[g.activeBattler ^ K.BIT_SIDE];
    let result = Math.trunc((opp.hp * 100) / opp.maxHP);
    if (result === 0) result = 1;
    if (result > 69 || opp.hp === 0) g.battleStruct.hpScale = 0;
    else if (result > 39) g.battleStruct.hpScale = 1;
    else if (result > 9) g.battleStruct.hpScale = 2;
    else g.battleStruct.hpScale = 3;
  }
  adv(2);
}

export function Cmd_hpthresholds2(): void {
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE)) {
    g.activeBattler = getBattlerForBattleScript(b(1));
    const oppId = g.activeBattler ^ K.BIT_SIDE;
    const opp = g.battleMons[oppId];
    const hpSwitchout = g.battleStruct.hpOnSwitchout[getBattlerSide(oppId)] & 0xff; // read into a u8
    const result = Math.trunc(((hpSwitchout - opp.hp) * 100) / hpSwitchout);
    if (opp.hp >= hpSwitchout) g.battleStruct.hpScale = 0;
    else if (result <= 29) g.battleStruct.hpScale = 1;
    else if (result <= 69) g.battleStruct.hpScale = 2;
    else g.battleStruct.hpScale = 3;
  }
  adv(2);
}

export function Cmd_useitemonopponent(): void {
  g.battlerInMenuId = g.battlerAttacker;
  const idx = g.battlerPartyIndexes[g.battlerAttacker];
  pokemonUseItemEffects(g.enemyParty[idx]!, g.lastUsedItem, idx, 0, true);
  adv(1);
}

export function Cmd_various(): void {
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  const mc = g.battleCommunication;
  switch (b(2)) {
    case K.VARIOUS_CANCEL_MULTI_TURN_MOVES:
      cancelMultiTurnMoves(ab);
      break;
    case K.VARIOUS_SET_MAGIC_COAT_TARGET: {
      g.battlerAttacker = g.battlerTarget;
      const side = getBattlerSide(g.battlerAttacker) ^ K.BIT_SIDE;
      if (g.sideTimers[side].followmeTimer !== 0 && g.battleMons[g.sideTimers[side].followmeTarget].hp !== 0) g.battlerTarget = g.sideTimers[side].followmeTarget;
      else g.battlerTarget = ab;
      break;
    }
    case K.VARIOUS_IS_RUNNING_IMPOSSIBLE:
      mc[0] = isRunningFromBattleImpossible();
      break;
    case K.VARIOUS_GET_MOVE_TARGET:
      g.battlerTarget = getMoveTarget(g.currentMove, K.NO_TARGET_OVERRIDE);
      break;
    case K.VARIOUS_GET_BATTLER_FAINTED:
      mc[0] = g.hitMarker & hitmarkerFainted(ab) ? 1 : 0;
      break;
    case K.VARIOUS_RESET_INTIMIDATE_TRACE_BITS:
      g.specialStatuses[ab].intimidatedMon = 0;
      g.specialStatuses[ab].traced = 0;
      break;
    case K.VARIOUS_UPDATE_CHOICE_MOVE_ON_LVL_UP:
      if (g.battlerPartyIndexes[0] === g.battleStruct.expGetterMonId || g.battlerPartyIndexes[2] === g.battleStruct.expGetterMonId) {
        g.activeBattler = g.battlerPartyIndexes[0] === g.battleStruct.expGetterMonId ? 0 : 2;
        const choiced = g.battleStruct.choicedMove;
        let i = 0;
        for (; i < K.MAX_MON_MOVES; i++) if (g.battleMons[g.activeBattler].moves[i] === choiced[g.activeBattler]) break;
        if (i === K.MAX_MON_MOVES) choiced[g.activeBattler] = K.MOVE_NONE;
      }
      break;
    case K.VARIOUS_RESET_PLAYER_FAINTED:
      if (
        !(g.battleTypeFlags & (K.BATTLE_TYPE_LINK | K.BATTLE_TYPE_DOUBLE)) &&
        g.battleTypeFlags & K.BATTLE_TYPE_TRAINER &&
        g.battleMons[0].hp !== 0 &&
        g.battleMons[1].hp !== 0
      )
        g.hitMarker &= ~K.HITMARKER_PLAYER_FAINTED;
      break;
    case K.VARIOUS_GET_BATTLERS_FOR_RECALL:
      mc[K.MULTISTRING_CHOOSER] = 0;
      g.activeBattler = 1;
      for (let i = 0; g.activeBattler < K.MAX_BATTLERS_COUNT; g.activeBattler += 2) {
        if (g.activeBattler < g.battlersCount && g.battleMons[g.activeBattler].hp !== 0) mc[K.MULTISTRING_CHOOSER] |= bit(i);
        i++;
      }
      break;
    case K.VARIOUS_RETURN_OPPONENT_MON1:
      g.activeBattler = 1;
      if (g.battleMons[1].hp !== 0) {
        emitReturnMonToBall(K.BUFFER_A, false);
        markBattlerForControllerExec(1);
      }
      break;
    case K.VARIOUS_RETURN_OPPONENT_MON2:
      if (g.battlersCount > 3) {
        g.activeBattler = 3;
        if (g.battleMons[3].hp !== 0) {
          emitReturnMonToBall(K.BUFFER_A, false);
          markBattlerForControllerExec(3);
        }
      }
      break;
    case K.VARIOUS_CHECK_POKEFLUTE: {
      mc[K.MULTISTRING_CHOOSER] = 0;
      for (let i = 0; i < g.battlersCount; i++) {
        if (g.battleMons[i].ability !== K.ABILITY_SOUNDPROOF) {
          g.battleMons[i].status1 &= ~K.STATUS1_SLEEP;
          g.battleMons[i].status2 &= ~K.STATUS2_NIGHTMARE;
        }
      }
      const sleepers = (party: typeof g.playerParty) => {
        let monToCheck = 0;
        for (let i = 0; i < K.PARTY_SIZE; i++) {
          const m = party[i];
          if (!m || !m.species || m.isEgg) continue;
          if (m.status & K.AILMENT_FNT && getAbility(m.species, m.abilityNum) !== K.ABILITY_SOUNDPROOF) monToCheck |= 1 << i;
        }
        return monToCheck;
      };
      let monToCheck = sleepers(g.playerParty);
      if (monToCheck) {
        g.activeBattler = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
        emitSetMonData(K.BUFFER_A, K.REQUEST_STATUS_BATTLE, monToCheck, u32(0));
        markBattlerForControllerExec(g.activeBattler);
        mc[K.MULTISTRING_CHOOSER] = 1;
      }
      monToCheck = sleepers(g.enemyParty);
      if (monToCheck) {
        g.activeBattler = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
        emitSetMonData(K.BUFFER_A, K.REQUEST_STATUS_BATTLE, monToCheck, u32(0));
        markBattlerForControllerExec(g.activeBattler);
        mc[5] = 1;
      }
      break;
    }
    case K.VARIOUS_WAIT_FANFARE:
      if (!IsFanfareTaskInactive()) return;
      break;
  }
  adv(3);
}
import { getAbilityBySpecies as getAbility } from './pokemonBattle';

/** Protect and Endure */
export function Cmd_setprotectlike(): void {
  let notLastTurn = true;
  const atk = g.battlerAttacker;
  const lastMove = g.lastResultingMoves[atk];
  const d = g.disableStructs[atk];
  if (lastMove !== K.MOVE_PROTECT && lastMove !== K.MOVE_DETECT && lastMove !== K.MOVE_ENDURE) d.protectUses = 0;
  if (g.currentTurnActionNumber === g.battlersCount - 1) notLastTurn = false;
  if (mech().sProtectSuccessRates[d.protectUses] >= random() && notLastTurn) {
    if (gBattleMoves[g.currentMove].effect === K.EFFECT_PROTECT) {
      g.protectStructs[atk].protected = 1;
      g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_PROTECTED_ITSELF;
    }
    if (gBattleMoves[g.currentMove].effect === K.EFFECT_ENDURE) {
      g.protectStructs[atk].endured = 1;
      g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_BRACED_ITSELF;
    }
    d.protectUses++;
  } else {
    d.protectUses = 0;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_PROTECT_FAILED;
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
  }
  adv(1);
}

export function Cmd_tryexplosion(): void {
  if (g.battleControllerExecFlags) return;
  // Explosion can only fail if any battler has Damp
  for (g.battlerTarget = 0; g.battlerTarget < g.battlersCount; g.battlerTarget++) if (g.battleMons[g.battlerTarget].ability === K.ABILITY_DAMP) break;
  if (g.battlerTarget === g.battlersCount) {
    // Success, no battlers with Damp. Drop user's HP bar to 0
    g.activeBattler = g.battlerAttacker;
    g.battleMoveDamage = g.battleMons[g.activeBattler].hp;
    emitHealthBarUpdate(K.BUFFER_A, K.INSTANT_HP_BAR_DROP);
    markBattlerForControllerExec(g.activeBattler);
    adv(1);
    // Find first target
    for (g.battlerTarget = 0; g.battlerTarget < g.battlersCount; g.battlerTarget++) {
      if (g.battlerTarget === g.battlerAttacker) continue;
      if (!(g.absentBattlerFlags & bit(g.battlerTarget))) break;
    }
  } else {
    g.lastUsedAbility = K.ABILITY_DAMP;
    recordAbilityBattle(g.battlerTarget, g.battleMons[g.battlerTarget].ability);
    g.battlescriptCurrInstr = bs('BattleScript_DampStopsExplosion');
  }
}

export function Cmd_setatkhptozero(): void {
  if (g.battleControllerExecFlags) return;
  g.activeBattler = g.battlerAttacker;
  g.battleMons[g.activeBattler].hp = 0;
  emitSetMonData(K.BUFFER_A, K.REQUEST_HP_BATTLE, 0, u16(0));
  markBattlerForControllerExec(g.activeBattler);
  adv(1);
}

export function Cmd_jumpifnexttargetvalid(): void {
  const jumpPtr = w(1);
  if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
    for (g.battlerTarget++; ; g.battlerTarget++) {
      if (g.battlerTarget === g.battlerAttacker) continue;
      if (!(g.absentBattlerFlags & bit(g.battlerTarget))) break;
    }
    if (g.battlerTarget >= g.battlersCount) adv(5);
    else g.battlescriptCurrInstr = jumpPtr;
  } else {
    adv(5);
  }
}

export function Cmd_tryhealhalfhealth(): void {
  const failPtr = w(1);
  if (b(5) === K.BS_ATTACKER) g.battlerTarget = g.battlerAttacker;
  const t = g.battleMons[g.battlerTarget];
  g.battleMoveDamage = Math.trunc(t.maxHP / 2) || 1;
  g.battleMoveDamage *= -1;
  if (t.hp === t.maxHP) g.battlescriptCurrInstr = failPtr;
  else adv(6);
}

export function Cmd_trymirrormove(): void {
  const validMoves: number[] = [];
  const atk = g.battlerAttacker;
  for (let i = 0; i < g.battlersCount; i++) {
    if (i !== atk) {
      const move = g.battleStruct.lastTakenMoveFrom[atk][i];
      if (move !== K.MOVE_NONE && move !== K.MOVE_UNAVAILABLE) validMoves.push(move);
    }
  }
  const move = g.battleStruct.lastTakenMove[atk];
  if (move !== K.MOVE_NONE && move !== K.MOVE_UNAVAILABLE) {
    g.hitMarker &= ~K.HITMARKER_ATTACKSTRING_PRINTED;
    g.currentMove = move;
    g.battlerTarget = getMoveTarget(g.currentMove, K.NO_TARGET_OVERRIDE);
    g.battlescriptCurrInstr = effectScript(g.currentMove);
  } else if (validMoves.length !== 0) {
    g.hitMarker &= ~K.HITMARKER_ATTACKSTRING_PRINTED;
    g.currentMove = validMoves[random() % validMoves.length];
    g.battlerTarget = getMoveTarget(g.currentMove, K.NO_TARGET_OVERRIDE);
    g.battlescriptCurrInstr = effectScript(g.currentMove);
  } else {
    // no valid moves found
    g.specialStatuses[atk].ppNotAffectedByPressure = 1;
    adv(1);
  }
}

function setWeather(already: number, set: number, startedMsg: number): void {
  if (g.battleWeather & already) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_WEATHER_FAILED;
  } else {
    g.battleWeather = set;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = startedMsg;
    g.wishFutureKnock.weatherDuration = 5;
  }
  adv(1);
}

export function Cmd_setrain(): void {
  setWeather(K.B_WEATHER_RAIN, K.B_WEATHER_RAIN_TEMPORARY, K.B_MSG_STARTED_RAIN);
}

function setScreen(flag: number, timerKey: 'reflectTimer' | 'lightscreenTimer', idKey: 'reflectBattlerId' | 'lightscreenBattlerId', single: number, double: number): void {
  const side = getBattlerSide(g.battlerAttacker);
  if (g.sideStatuses[side] & flag) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_SIDE_STATUS_FAILED;
  } else {
    g.sideStatuses[side] |= flag;
    g.sideTimers[side][timerKey] = 5;
    g.sideTimers[side][idKey] = g.battlerAttacker;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && countAliveMonsInBattle(K.BATTLE_ALIVE_ATK_SIDE) === 2 ? double : single;
  }
  adv(1);
}

export function Cmd_setreflect(): void {
  setScreen(K.SIDE_STATUS_REFLECT, 'reflectTimer', 'reflectBattlerId', K.B_MSG_SET_REFLECT_SINGLE, K.B_MSG_SET_REFLECT_DOUBLE);
}

export function Cmd_setseeded(): void {
  const tgt = g.battlerTarget;
  if (g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT || g.statuses3[tgt] & K.STATUS3_LEECHSEED) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_LEECH_SEED_MISS;
  } else if (isBattlerOfType(tgt, K.TYPE_GRASS)) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_LEECH_SEED_FAIL;
  } else {
    g.statuses3[tgt] |= g.battlerAttacker;
    g.statuses3[tgt] |= K.STATUS3_LEECHSEED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_LEECH_SEED_SET;
  }
  adv(1);
}

export function Cmd_manipulatedamage(): void {
  switch (b(1)) {
    case K.DMG_CHANGE_SIGN:
      g.battleMoveDamage *= -1;
      break;
    case K.DMG_RECOIL_FROM_MISS:
      g.battleMoveDamage = Math.trunc(g.battleMoveDamage / 2) || 1;
      if (Math.trunc(g.battleMons[g.battlerTarget].maxHP / 2) < g.battleMoveDamage) g.battleMoveDamage = Math.trunc(g.battleMons[g.battlerTarget].maxHP / 2);
      break;
    case K.DMG_DOUBLED:
      g.battleMoveDamage *= 2;
      break;
  }
  adv(2);
}

export function Cmd_trysetrest(): void {
  const failJump = w(1);
  g.activeBattler = g.battlerTarget = g.battlerAttacker;
  const t = g.battleMons[g.battlerTarget];
  g.battleMoveDamage = t.maxHP * -1;
  if (t.hp === t.maxHP) {
    g.battlescriptCurrInstr = failJump;
  } else {
    g.battleCommunication[K.MULTISTRING_CHOOSER] = t.status1 & (~K.STATUS1_SLEEP & 0xff) ? K.B_MSG_REST_STATUSED : K.B_MSG_REST;
    t.status1 = 3; // STATUS1_SLEEP_TURN(3)
    emitSetMonData(K.BUFFER_A, K.REQUEST_STATUS_BATTLE, 0, u32(t.status1));
    markBattlerForControllerExec(g.activeBattler);
    adv(5);
  }
}

export function Cmd_jumpifnotfirstturn(): void {
  const failJump = w(1);
  if (g.disableStructs[g.battlerAttacker].isFirstTurn) adv(5);
  else g.battlescriptCurrInstr = failJump;
}

export function Cmd_nop(): void {
  adv(1);
}

/** UproarWakeUpCheck */
export function uproarWakeUpCheck(battlerId: number): boolean {
  let i = 0;
  for (; i < g.battlersCount; i++) {
    if (!(g.battleMons[i].status2 & K.STATUS2_UPROAR) || g.battleMons[battlerId].ability === K.ABILITY_SOUNDPROOF) continue;
    g.battleScripting.battler = i;
    if (g.battlerTarget === 0xff) g.battlerTarget = i;
    else if (g.battlerTarget === i) g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_CANT_SLEEP_UPROAR;
    else g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_UPROAR_KEPT_AWAKE;
    break;
  }
  return i !== g.battlersCount;
}

export function Cmd_jumpifcantmakeasleep(): void {
  const jumpPtr = w(1);
  const tgt = g.battlerTarget;
  if (uproarWakeUpCheck(tgt)) {
    g.battlescriptCurrInstr = jumpPtr;
  } else if (g.battleMons[tgt].ability === K.ABILITY_INSOMNIA || g.battleMons[tgt].ability === K.ABILITY_VITAL_SPIRIT) {
    g.lastUsedAbility = g.battleMons[tgt].ability;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_STAYED_AWAKE_USING;
    g.battlescriptCurrInstr = jumpPtr;
    recordAbilityBattle(tgt, g.lastUsedAbility);
  } else {
    adv(5);
  }
}

export function Cmd_stockpile(): void {
  const d = g.disableStructs[g.battlerAttacker];
  if (d.stockpileCounter === 3) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_CANT_STOCKPILE;
  } else {
    d.stockpileCounter++;
    prepareByteNumberBuffer(g.battleTextBuff1, 1, d.stockpileCounter);
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_STOCKPILED;
  }
  adv(1);
}

export function Cmd_stockpiletobasedamage(): void {
  const jumpPtr = w(1);
  const atk = g.battlerAttacker;
  const d = g.disableStructs[atk];
  if (d.stockpileCounter === 0) {
    g.battlescriptCurrInstr = jumpPtr;
  } else {
    if (g.battleCommunication[K.MISS_TYPE] !== K.B_MSG_PROTECTED) {
      g.battleMoveDamage =
        calculateBaseDamage(g.battleMons[atk], g.battleMons[g.battlerTarget], g.currentMove, g.sideStatuses[getBattlerSide(g.battlerTarget)], 0, 0, atk, g.battlerTarget) *
        d.stockpileCounter;
      g.battleScripting.animTurn = d.stockpileCounter;
      if (g.protectStructs[atk].helpingHand) g.battleMoveDamage = Math.trunc((g.battleMoveDamage * 15) / 10);
    }
    d.stockpileCounter = 0;
    adv(5);
  }
}

export function Cmd_stockpiletohpheal(): void {
  const jumpPtr = w(1);
  const atk = g.battlerAttacker;
  const d = g.disableStructs[atk];
  const m = g.battleMons[atk];
  if (d.stockpileCounter === 0) {
    g.battlescriptCurrInstr = jumpPtr;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_SWALLOW_FAILED;
  } else if (m.maxHP === m.hp) {
    d.stockpileCounter = 0;
    g.battlescriptCurrInstr = jumpPtr;
    g.battlerTarget = atk;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_SWALLOW_FULL_HP;
  } else {
    g.battleMoveDamage = Math.trunc(m.maxHP / (1 << (3 - d.stockpileCounter))) || 1;
    g.battleMoveDamage *= -1;
    g.battleScripting.animTurn = d.stockpileCounter;
    d.stockpileCounter = 0;
    adv(5);
    g.battlerTarget = atk;
  }
}

export function Cmd_negativedamage(): void {
  g.battleMoveDamage = -Math.trunc(g.hpDealt / 2);
  if (g.battleMoveDamage === 0) g.battleMoveDamage = -1;
  adv(1);
}

const STAT_CHANGE_WORKED = 0;
const STAT_CHANGE_DIDNT_WORK = 1;

/** ChangeStatBuffs: statValue is an s8 (sign bit = decrease, bits 4-6 = amount). */
export function changeStatBuffs(statValue: number, statId: number, flags: number, bsPtr: number): number {
  let certain = false;
  let notProtectAffected = false;
  statValue = (statValue << 24) >> 24;
  g.activeBattler = flags & K.MOVE_EFFECT_AFFECTS_USER ? g.battlerAttacker : g.battlerTarget;
  const ab = g.activeBattler;
  const m = g.battleMons[ab];
  flags &= ~K.MOVE_EFFECT_AFFECTS_USER;
  if (flags & K.MOVE_EFFECT_CERTAIN) certain = true;
  flags &= ~K.MOVE_EFFECT_CERTAIN;
  if (flags & K.STAT_CHANGE_NOT_PROTECT_AFFECTED) notProtectAffected = true;
  flags &= ~K.STAT_CHANGE_NOT_PROTECT_AFFECTED;

  prepareStatBuffer(g.battleTextBuff1, statId);
  const t2 = g.battleTextBuff2;
  const blocked = (label: string, recordAbility: boolean, onceOnly: boolean) => {
    if (flags === K.STAT_CHANGE_ALLOW_PTR) {
      if (onceOnly && g.specialStatuses[ab].statLowered) {
        g.battlescriptCurrInstr = bsPtr;
      } else {
        battleScriptPush(bsPtr);
        g.battleScripting.battler = ab;
        g.battlescriptCurrInstr = bs(label);
        if (recordAbility) {
          g.lastUsedAbility = m.ability;
          recordAbilityBattle(ab, g.lastUsedAbility);
        }
        if (onceOnly) g.specialStatuses[ab].statLowered = 1;
      }
    }
    return STAT_CHANGE_DIDNT_WORK;
  };

  if (statValue <= -1) {
    // Stat decrease.
    if (g.sideTimers[getBattlerSide(ab)].mistTimer && !certain && g.currentMove !== K.MOVE_CURSE) {
      return blocked('BattleScript_MistProtected', false, true);
    } else if (g.currentMove !== K.MOVE_CURSE && !notProtectAffected && jumpIfMoveAffectedByProtect0()) {
      g.battlescriptCurrInstr = bs('BattleScript_ButItFailed');
      return STAT_CHANGE_DIDNT_WORK;
    } else if ((m.ability === K.ABILITY_CLEAR_BODY || m.ability === K.ABILITY_WHITE_SMOKE) && !certain && g.currentMove !== K.MOVE_CURSE) {
      return blocked('BattleScript_AbilityNoStatLoss', true, true);
    } else if (m.ability === K.ABILITY_KEEN_EYE && !certain && statId === K.STAT_ACC) {
      return blocked('BattleScript_AbilityNoSpecificStatLoss', true, false);
    } else if (m.ability === K.ABILITY_HYPER_CUTTER && !certain && statId === K.STAT_ATK) {
      return blocked('BattleScript_AbilityNoSpecificStatLoss', true, false);
    } else if (m.ability === K.ABILITY_SHIELD_DUST && flags === 0) {
      return STAT_CHANGE_DIDNT_WORK;
    } else {
      // try to decrease
      statValue = -((statValue >> 4) & 7);
      t2[0] = K.B_BUFF_PLACEHOLDER_BEGIN;
      let index = 1;
      if (statValue === -2) {
        t2[1] = K.B_BUFF_STRING;
        t2[2] = K.STRINGID_STATHARSHLY;
        t2[3] = K.STRINGID_STATHARSHLY >> 8;
        index = 4;
      }
      t2[index++] = K.B_BUFF_STRING;
      t2[index++] = K.STRINGID_STATFELL;
      t2[index++] = K.STRINGID_STATFELL >> 8;
      t2[index] = K.B_BUFF_EOS;
      if (m.statStages[statId] === K.MIN_STAT_STAGE) g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_STAT_WONT_DECREASE;
      else g.battleCommunication[K.MULTISTRING_CHOOSER] = g.battlerTarget === ab ? 1 : 0; // B_MSG_ATTACKER_STAT_FELL or B_MSG_DEFENDER_STAT_FELL
    }
  } else {
    // stat increase
    statValue = (statValue >> 4) & 7;
    t2[0] = K.B_BUFF_PLACEHOLDER_BEGIN;
    let index = 1;
    if (statValue === 2) {
      t2[1] = K.B_BUFF_STRING;
      t2[2] = K.STRINGID_STATSHARPLY;
      t2[3] = K.STRINGID_STATSHARPLY >> 8;
      index = 4;
    }
    t2[index++] = K.B_BUFF_STRING;
    t2[index++] = K.STRINGID_STATROSE;
    t2[index++] = K.STRINGID_STATROSE >> 8;
    t2[index] = K.B_BUFF_EOS;
    if (m.statStages[statId] === K.MAX_STAT_STAGE) g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_STAT_WONT_INCREASE;
    else g.battleCommunication[K.MULTISTRING_CHOOSER] = g.battlerTarget === ab ? 1 : 0; // B_MSG_ATTACKER_STAT_ROSE or B_MSG_DEFENDER_STAT_ROSE
  }

  m.statStages[statId] += statValue;
  if (m.statStages[statId] < K.MIN_STAT_STAGE) m.statStages[statId] = K.MIN_STAT_STAGE;
  if (m.statStages[statId] > K.MAX_STAT_STAGE) m.statStages[statId] = K.MAX_STAT_STAGE;

  if (g.battleCommunication[K.MULTISTRING_CHOOSER] === K.B_MSG_STAT_WONT_INCREASE && flags & K.STAT_CHANGE_ALLOW_PTR) g.moveResultFlags |= K.MOVE_RESULT_MISSED;
  if (g.battleCommunication[K.MULTISTRING_CHOOSER] === K.B_MSG_STAT_WONT_INCREASE && !(flags & K.STAT_CHANGE_ALLOW_PTR)) return STAT_CHANGE_DIDNT_WORK;
  return STAT_CHANGE_WORKED;
}

/** JumpIfMoveAffectedByProtect(0), as called from ChangeStatBuffs (jumps relative to the current command). */
function jumpIfMoveAffectedByProtect0(): boolean {
  if (g.protectStructs[g.battlerTarget].protected && gBattleMoves[g.currentMove].flags & K.FLAG_PROTECT_AFFECTED) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    // JumpIfMoveFailed(7, 0) with MOVE_RESULT_NO_EFFECT set: jump to the pointer at +1
    g.lastLandedMoves[g.battlerTarget] = 0;
    g.lastHitByType[g.battlerTarget] = 0;
    g.battlescriptCurrInstr = w(1);
    g.battleCommunication[K.MISS_TYPE] = K.B_MSG_PROTECTED;
    return true;
  }
  return false;
}

export function Cmd_statbuffchange(): void {
  const jumpPtr = w(2);
  const sc = g.battleScripting.statChanger;
  if (changeStatBuffs(sc & 0xf0, sc & 0xf, b(1), jumpPtr) === STAT_CHANGE_WORKED) adv(6);
}

/** Haze */
export function Cmd_normalisebuffs(): void {
  for (let i = 0; i < g.battlersCount; i++) for (let j = 0; j < K.NUM_BATTLE_STATS; j++) g.battleMons[i].statStages[j] = K.DEFAULT_STAT_STAGE;
  adv(1);
}

export function Cmd_setbide(): void {
  const atk = g.battlerAttacker;
  g.battleMons[atk].status2 |= K.STATUS2_MULTIPLETURNS;
  g.lockedMoves[atk] = g.currentMove;
  g.takenDmg[atk] = 0;
  g.battleMons[atk].status2 |= (2 << 8) & K.STATUS2_BIDE; // STATUS2_BIDE_TURN(2)
  adv(1);
}

export function Cmd_confuseifrepeatingattackends(): void {
  if (!(g.battleMons[g.battlerAttacker].status2 & K.STATUS2_LOCK_CONFUSE))
    g.battleCommunication[K.MOVE_EFFECT_BYTE] = K.MOVE_EFFECT_THRASH | K.MOVE_EFFECT_AFFECTS_USER;
  adv(1);
}

export function Cmd_setmultihitcounter(): void {
  if (b(1)) {
    g.multiHitCounter = b(1);
  } else {
    g.multiHitCounter = random() & 3;
    if (g.multiHitCounter > 1) g.multiHitCounter = (random() & 3) + 2;
    else g.multiHitCounter += 2;
  }
  adv(2);
}

export function Cmd_initmultihitstring(): void {
  prepareByteNumberBuffer(g.battleScripting.multihitString, 1, 0);
  adv(1);
}

/** TryDoForceSwitchOut */
function tryDoForceSwitchOut(): boolean {
  const atk = g.battleMons[g.battlerAttacker];
  const tgt = g.battleMons[g.battlerTarget];
  if (atk.level >= tgt.level) {
    g.battleStruct.battlerPartyIndexes[g.battlerTarget] = g.battlerPartyIndexes[g.battlerTarget];
  } else {
    const rnd = random() & 0xff;
    if (((rnd * (atk.level + tgt.level)) >> 8) + 1 <= Math.trunc(tgt.level / 4)) {
      g.battlescriptCurrInstr = w(1);
      return false;
    }
    g.battleStruct.battlerPartyIndexes[g.battlerTarget] = g.battlerPartyIndexes[g.battlerTarget];
  }
  g.battlescriptCurrInstr = bs('BattleScript_SuccessForceOut');
  return true;
}

export function Cmd_forcerandomswitch(): void {
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_TRAINER)) {
    tryDoForceSwitchOut();
    return;
  }
  const tgt = g.battlerTarget;
  const party = partyOf(tgt);
  const canBattle = (i: number) => !!party[i] && !!party[i]!.species && !party[i]!.isEgg && party[i]!.hp !== 0;
  let valid = 0;
  for (let i = 0; i < K.PARTY_SIZE; i++) if (canBattle(i)) valid++;
  // Fails if there's only 1 mon left in single battle or there's less than 3 left in non-multi double battle.
  if (
    (valid < 2 && (g.battleTypeFlags & (K.BATTLE_TYPE_DOUBLE | K.BATTLE_TYPE_MULTI)) !== K.BATTLE_TYPE_DOUBLE) ||
    (valid < 3 && g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && !(g.battleTypeFlags & K.BATTLE_TYPE_MULTI))
  ) {
    g.battlescriptCurrInstr = w(1);
  } else if (tryDoForceSwitchOut()) {
    let i: number;
    if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
      do {
        i = random() % K.PARTY_SIZE;
      } while (i === g.battlerPartyIndexes[tgt] || i === g.battlerPartyIndexes[tgt ^ 2] || !canBattle(i));
    } else {
      do {
        i = random() % K.PARTY_SIZE;
      } while (i === g.battlerPartyIndexes[tgt] || !canBattle(i));
    }
    g.battleStruct.monToSwitchIntoId[tgt] = i;
    if (!isMultiBattle()) updatePartyOwnerOnSwitch_NonMulti(tgt);
    switchPartyOrderLinkMulti(tgt, i, 0);
    switchPartyOrderLinkMulti(tgt ^ K.BIT_FLANK, i, 1);
  }
}

/** Randomly changes user's type to one of its moves' type */
export function Cmd_tryconversiontypechange(): void {
  const atk = g.battlerAttacker;
  const m = g.battleMons[atk];
  let validMoves = 0;
  while (validMoves < K.MAX_MON_MOVES) {
    if (m.moves[validMoves] === K.MOVE_NONE) break;
    validMoves++;
  }
  const typeOf = (slot: number) => {
    let t = gBattleMoves[m.moves[slot]].type;
    if (t === K.TYPE_MYSTERY) t = isBattlerOfType(atk, K.TYPE_GHOST) ? K.TYPE_GHOST : K.TYPE_NORMAL;
    return t;
  };
  let moveChecked = 0;
  for (; moveChecked < validMoves; moveChecked++) {
    const t = typeOf(moveChecked);
    if (t !== m.type1 && t !== m.type2) break;
  }
  if (moveChecked === validMoves) {
    g.battlescriptCurrInstr = w(1);
  } else {
    let moveType: number;
    do {
      while ((moveChecked = random() & (K.MAX_MON_MOVES - 1)) >= validMoves);
      moveType = typeOf(moveChecked);
    } while (moveType === m.type1 || moveType === m.type2);
    setBattlerType(atk, moveType);
    prepareTypeBuffer(g.battleTextBuff1, moveType);
    adv(5);
  }
}

export function Cmd_givepaydaymoney(): void {
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_LINK) && g.paydayMoney !== 0) {
    const bonusMoney = g.paydayMoney * g.battleStruct.moneyMultiplier;
    state.addMoney(bonusMoney);
    prepareHwordNumberBuffer(g.battleTextBuff1, 5, bonusMoney);
    battleScriptPush(g.battlescriptCurrInstr + 1);
    g.battlescriptCurrInstr = bs('BattleScript_PrintPayDayMoneyString');
  } else {
    adv(1);
  }
}

export function Cmd_setlightscreen(): void {
  setScreen(K.SIDE_STATUS_LIGHTSCREEN, 'lightscreenTimer', 'lightscreenBattlerId', K.B_MSG_SET_LIGHTSCREEN_SINGLE, K.B_MSG_SET_LIGHTSCREEN_DOUBLE);
}

export function Cmd_tryKO(): void {
  const tgt = g.battlerTarget;
  const atk = g.battlerAttacker;
  const def = g.battleMons[tgt];
  const holdEffect = def.item === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[tgt].holdEffect : itemHoldEffect(def.item);
  const param = def.item === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[tgt].holdEffectParam : gItemsParam(def.item);
  g.potentialItemEffectBattler = tgt;
  if (holdEffect === K.HOLD_EFFECT_FOCUS_BAND && random() % 100 < param) {
    recordItemEffectBattle(tgt, K.HOLD_EFFECT_FOCUS_BAND);
    g.specialStatuses[tgt].focusBanded = 1;
  }
  if (def.ability === K.ABILITY_STURDY) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.lastUsedAbility = K.ABILITY_STURDY;
    g.battlescriptCurrInstr = bs('BattleScript_SturdyPreventsOHKO');
    recordAbilityBattle(tgt, K.ABILITY_STURDY);
    return;
  }
  const levelOk = g.battleMons[atk].level >= def.level;
  const roll = () => {
    const chance = (gBattleMoves[g.currentMove].accuracy + (g.battleMons[atk].level - def.level)) & 0xffff;
    return (random() % 100) + 1 < chance && levelOk;
  };
  let hit: boolean;
  if (!(g.statuses3[tgt] & K.STATUS3_ALWAYS_HITS)) hit = roll();
  else if (g.disableStructs[tgt].battlerWithSureHit === atk && levelOk) hit = true;
  else hit = roll();
  if (hit) {
    if (g.protectStructs[tgt].endured) {
      g.battleMoveDamage = def.hp - 1;
      g.moveResultFlags |= K.MOVE_RESULT_FOE_ENDURED;
    } else if (g.specialStatuses[tgt].focusBanded) {
      g.battleMoveDamage = def.hp - 1;
      g.moveResultFlags |= K.MOVE_RESULT_FOE_HUNG_ON;
      g.lastUsedItem = def.item;
    } else {
      g.battleMoveDamage = def.hp;
      g.moveResultFlags |= K.MOVE_RESULT_ONE_HIT_KO;
    }
    adv(5);
  } else {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = levelOk ? K.B_MSG_KO_MISS : K.B_MSG_KO_UNAFFECTED;
    g.battlescriptCurrInstr = w(1);
  }
}

/** Super Fang */
export function Cmd_damagetohalftargethp(): void {
  g.battleMoveDamage = Math.trunc(g.battleMons[g.battlerTarget].hp / 2) || 1;
  adv(1);
}

export function Cmd_setsandstorm(): void {
  setWeather(K.B_WEATHER_SANDSTORM, K.B_WEATHER_SANDSTORM_TEMPORARY, K.B_MSG_STARTED_SANDSTORM);
}

export function Cmd_weatherdamage(): void {
  const atk = g.battlerAttacker;
  const m = g.battleMons[atk];
  if (isGhostWithoutScope(g.battleTypeFlags) && getBattlerSide(atk) === K.B_SIDE_OPPONENT) {
    g.battleMoveDamage = 0;
    adv(1);
    return;
  }
  if (weatherHasEffect()) {
    const hidden = g.statuses3[atk] & K.STATUS3_UNDERGROUND || g.statuses3[atk] & K.STATUS3_UNDERWATER;
    if (g.battleWeather & K.B_WEATHER_SANDSTORM) {
      const immune = [K.TYPE_ROCK, K.TYPE_STEEL, K.TYPE_GROUND].some((t) => m.type1 === t || m.type2 === t);
      if (!immune && m.ability !== K.ABILITY_SAND_VEIL && !hidden) g.battleMoveDamage = Math.trunc(m.maxHP / 16) || 1;
      else g.battleMoveDamage = 0;
    }
    if (g.battleWeather & K.B_WEATHER_HAIL) {
      if (!isBattlerOfType(atk, K.TYPE_ICE) && !hidden) g.battleMoveDamage = Math.trunc(m.maxHP / 16) || 1;
      else g.battleMoveDamage = 0;
    }
  } else {
    g.battleMoveDamage = 0;
  }
  if (g.absentBattlerFlags & bit(atk)) g.battleMoveDamage = 0;
  adv(1);
}

export function Cmd_tryinfatuating(): void {
  const monAttacker = partyOf(g.battlerAttacker)[g.battlerPartyIndexes[g.battlerAttacker]];
  const monTarget = partyOf(g.battlerTarget)[g.battlerPartyIndexes[g.battlerTarget]];
  const gA = getGenderFromSpeciesAndPersonality(monAttacker?.species ?? 0, monAttacker?.personality ?? 0);
  const gT = getGenderFromSpeciesAndPersonality(monTarget?.species ?? 0, monTarget?.personality ?? 0);
  if (g.battleMons[g.battlerTarget].ability === K.ABILITY_OBLIVIOUS) {
    g.battlescriptCurrInstr = bs('BattleScript_ObliviousPreventsAttraction');
    g.lastUsedAbility = K.ABILITY_OBLIVIOUS;
    recordAbilityBattle(g.battlerTarget, K.ABILITY_OBLIVIOUS);
  } else if (gA === gT || g.battleMons[g.battlerTarget].status2 & K.STATUS2_INFATUATION || gA === K.MON_GENDERLESS || gT === K.MON_GENDERLESS) {
    g.battlescriptCurrInstr = w(1);
  } else {
    g.battleMons[g.battlerTarget].status2 |= bit(g.battlerAttacker) << 16; // STATUS2_INFATUATED_WITH
    adv(5);
  }
}

export function Cmd_updatestatusicon(): void {
  if (g.battleControllerExecFlags) return;
  const send = (battler: number) => {
    g.activeBattler = battler;
    emitStatusIconUpdate(K.BUFFER_A, g.battleMons[battler].status1, g.battleMons[battler].status2);
    markBattlerForControllerExec(battler);
  };
  if (b(1) === K.BS_PLAYER2) {
    for (let i = g.battleControllerExecFlags; i < g.battlersCount; i++) if (!(g.absentBattlerFlags & bit(i))) send(i);
    adv(2);
  } else if (b(1) === K.BS_ATTACKER_WITH_PARTNER) {
    if (!(g.absentBattlerFlags & bit(g.battlerAttacker))) send(g.battlerAttacker);
    if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
      const partner = getBattlerAtPosition(getBattlerPosition(g.battlerAttacker) ^ K.BIT_FLANK);
      if (!(g.absentBattlerFlags & bit(partner))) send(partner);
    }
    adv(2);
  } else {
    send(getBattlerForBattleScript(b(1)));
    adv(2);
  }
}

export function Cmd_setmist(): void {
  const side = getBattlerSide(g.battlerAttacker);
  if (g.sideTimers[side].mistTimer) {
    g.moveResultFlags |= K.MOVE_RESULT_FAILED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_MIST_FAILED;
  } else {
    g.sideTimers[side].mistTimer = 5;
    g.sideTimers[side].mistBattlerId = g.battlerAttacker;
    g.sideStatuses[side] |= K.SIDE_STATUS_MIST;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_SET_MIST;
  }
  adv(1);
}

export function Cmd_setfocusenergy(): void {
  const m = g.battleMons[g.battlerAttacker];
  if (m.status2 & K.STATUS2_FOCUS_ENERGY) {
    g.moveResultFlags |= K.MOVE_RESULT_FAILED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_FOCUS_ENERGY_FAILED;
  } else {
    m.status2 |= K.STATUS2_FOCUS_ENERGY;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_GETTING_PUMPED;
  }
  adv(1);
}

export function Cmd_transformdataexecution(): void {
  g.chosenMove = K.MOVE_UNAVAILABLE;
  adv(1);
  const atk = g.battlerAttacker;
  const tgt = g.battlerTarget;
  if (g.battleMons[tgt].status2 & K.STATUS2_TRANSFORMED || g.statuses3[tgt] & K.STATUS3_SEMI_INVULNERABLE) {
    g.moveResultFlags |= K.MOVE_RESULT_FAILED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_TRANSFORM_FAILED;
    return;
  }
  const a = g.battleMons[atk];
  const t = g.battleMons[tgt];
  a.status2 |= K.STATUS2_TRANSFORMED;
  g.disableStructs[atk].disabledMove = K.MOVE_NONE;
  g.disableStructs[atk].disableTimer = 0;
  g.disableStructs[atk].transformedMonPersonality = t.personality;
  g.disableStructs[atk].mimickedMoves = 0;
  prepareSpeciesBuffer(g.battleTextBuff1, t.species);
  // Copy every field before `pp` (species .. unknown)
  a.species = t.species;
  a.attack = t.attack;
  a.defense = t.defense;
  a.speed = t.speed;
  a.spAttack = t.spAttack;
  a.spDefense = t.spDefense;
  a.moves.set(t.moves);
  a.hpIV = t.hpIV;
  a.attackIV = t.attackIV;
  a.defenseIV = t.defenseIV;
  a.speedIV = t.speedIV;
  a.spAttackIV = t.spAttackIV;
  a.spDefenseIV = t.spDefenseIV;
  a.isEgg = t.isEgg;
  a.abilityNum = t.abilityNum;
  a.statStages.set(t.statStages);
  a.ability = t.ability;
  a.type1 = t.type1;
  a.type2 = t.type2;
  a.unknown = t.unknown;
  for (let i = 0; i < K.MAX_MON_MOVES; i++) {
    const pp = gBattleMoves[a.moves[i]].pp;
    a.pp[i] = pp < 5 ? pp : 5;
  }
  g.activeBattler = atk;
  emitResetActionMoveSelection(K.BUFFER_A, K.RESET_MOVE_SELECTION);
  markBattlerForControllerExec(atk);
  g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_TRANSFORMED;
}

export function Cmd_setsubstitute(): void {
  const atk = g.battlerAttacker;
  const m = g.battleMons[atk];
  let hp = Math.trunc(m.maxHP / 4);
  if (Math.trunc(m.maxHP / 4) === 0) hp = 1;
  if (m.hp <= hp) {
    g.battleMoveDamage = 0;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_SUBSTITUTE_FAILED;
  } else {
    g.battleMoveDamage = Math.trunc(m.maxHP / 4) || 1;
    m.status2 |= K.STATUS2_SUBSTITUTE;
    m.status2 &= ~K.STATUS2_WRAPPED;
    g.disableStructs[atk].substituteHP = g.battleMoveDamage & 0xff;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_SET_SUBSTITUTE;
    g.hitMarker |= K.HITMARKER_IGNORE_SUBSTITUTE;
  }
  adv(1);
}

/** IsMoveUncopyableByMimic */
function isMoveUncopyableByMimic(move: number): boolean {
  const t = mech().sMovesForbiddenToCopy;
  let i = 0;
  for (; t[i] !== 0xfffe && t[i] !== move; i++);
  return t[i] !== 0xfffe;
}

export function Cmd_mimicattackcopy(): void {
  g.chosenMove = K.MOVE_UNAVAILABLE;
  const atk = g.battlerAttacker;
  const last = g.lastMoves[g.battlerTarget];
  if (isMoveUncopyableByMimic(last) || g.battleMons[atk].status2 & K.STATUS2_TRANSFORMED || last === K.MOVE_NONE || last === K.MOVE_UNAVAILABLE) {
    g.battlescriptCurrInstr = w(1);
    return;
  }
  let i = 0;
  for (; i < K.MAX_MON_MOVES; i++) if (g.battleMons[atk].moves[i] === last) break;
  if (i === K.MAX_MON_MOVES) {
    g.battleMons[atk].moves[g.currMovePos] = last;
    const pp = gBattleMoves[last].pp;
    g.battleMons[atk].pp[g.currMovePos] = pp < 5 ? pp : 5;
    prepareMoveBuffer(g.battleTextBuff1, last);
    g.disableStructs[atk].mimickedMoves |= bit(g.currMovePos);
    adv(5);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_metronome(): void {
  const t = mech().sMovesForbiddenToCopy;
  for (;;) {
    g.currentMove = (random() & 0x1ff) + 1;
    if (g.currentMove >= K.MOVES_COUNT) continue;
    let i = -1;
    for (;;) {
      i++;
      if (t[i] === g.currentMove) break;
      if (t[i] === 0xffff) break;
    }
    if (t[i] === 0xffff) {
      g.hitMarker &= ~K.HITMARKER_ATTACKSTRING_PRINTED;
      g.battlescriptCurrInstr = effectScript(g.currentMove);
      g.battlerTarget = getMoveTarget(g.currentMove, K.NO_TARGET_OVERRIDE);
      return;
    }
  }
}

export function Cmd_dmgtolevel(): void {
  g.battleMoveDamage = g.battleMons[g.battlerAttacker].level;
  adv(1);
}

export function Cmd_psywavedamageeffect(): void {
  let randDamage: number;
  while ((randDamage = random() % 16) > 10);
  randDamage *= 10;
  g.battleMoveDamage = Math.trunc((g.battleMons[g.battlerAttacker].level * (randDamage + 50)) / 100);
  adv(1);
}

function counterLike(physical: boolean): void {
  const atk = g.battlerAttacker;
  const p = g.protectStructs[atk];
  const byId = physical ? p.physicalBattlerId : p.specialBattlerId;
  const dmg = physical ? p.physicalDmg : p.specialDmg;
  const sideAttacker = getBattlerSide(atk);
  const sideTarget = getBattlerSide(byId);
  if (dmg && sideAttacker !== sideTarget && g.battleMons[byId].hp) {
    g.battleMoveDamage = dmg * 2;
    if (g.sideTimers[sideTarget].followmeTimer && g.battleMons[g.sideTimers[sideTarget].followmeTarget].hp) g.battlerTarget = g.sideTimers[sideTarget].followmeTarget;
    else g.battlerTarget = byId;
    adv(5);
  } else {
    g.specialStatuses[atk].ppNotAffectedByPressure = 1;
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_counterdamagecalculator(): void {
  counterLike(true);
}

/** A copy of Cmd_counterdamagecalculator with the physical -> special field changes */
export function Cmd_mirrorcoatdamagecalculator(): void {
  counterLike(false);
}

export function Cmd_disablelastusedattack(): void {
  const tgt = g.battlerTarget;
  let i = 0;
  for (; i < K.MAX_MON_MOVES; i++) if (g.battleMons[tgt].moves[i] === g.lastMoves[tgt]) break;
  const d = g.disableStructs[tgt];
  if (d.disabledMove === K.MOVE_NONE && i !== K.MAX_MON_MOVES && g.battleMons[tgt].pp[i] !== 0) {
    prepareMoveBuffer(g.battleTextBuff1, g.battleMons[tgt].moves[i]);
    d.disabledMove = g.battleMons[tgt].moves[i];
    d.disableTimer = (random() & 3) + 2;
    d.disableTimerStartValue = d.disableTimer; // used to save the random amount of turns?
    adv(5);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_trysetencore(): void {
  const tgt = g.battlerTarget;
  let i = 0;
  for (; i < K.MAX_MON_MOVES; i++) if (g.battleMons[tgt].moves[i] === g.lastMoves[tgt]) break;
  const last = g.lastMoves[tgt];
  if (last === K.MOVE_STRUGGLE || last === K.MOVE_ENCORE || last === K.MOVE_MIRROR_MOVE) i = K.MAX_MON_MOVES;
  const d = g.disableStructs[tgt];
  if (d.encoredMove === K.MOVE_NONE && i !== K.MAX_MON_MOVES && g.battleMons[tgt].pp[i] !== 0) {
    d.encoredMove = g.battleMons[tgt].moves[i];
    d.encoredMovePos = i;
    d.encoreTimer = (random() & 3) + 3;
    d.encoreTimerStartValue = d.encoreTimer;
    adv(5);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_painsplitdmgcalc(): void {
  const a = g.battleMons[g.battlerAttacker];
  const t = g.battleMons[g.battlerTarget];
  if (!(t.status2 & K.STATUS2_SUBSTITUTE)) {
    const hpDiff = Math.trunc((a.hp + t.hp) / 2);
    const painSplitHp = (g.battleMoveDamage = t.hp - hpDiff);
    g.battleScripting.painSplitHp = painSplitHp;
    g.battleMoveDamage = a.hp - hpDiff;
    g.specialStatuses[g.battlerTarget].dmg = 0xffff;
    adv(5);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

/** Conversion 2 */
export function Cmd_settypetorandomresistance(): void {
  const atk = g.battlerAttacker;
  const landed = g.lastLandedMoves[atk];
  if (landed === K.MOVE_NONE || landed === K.MOVE_UNAVAILABLE) {
    g.battlescriptCurrInstr = w(1);
  } else if (isTwoTurnsMove(landed) && g.battleMons[g.lastHitBy[atk]].status2 & K.STATUS2_MULTIPLETURNS) {
    g.battlescriptCurrInstr = w(1);
  } else {
    const chartLen = bdata.tables.typeEffectiveness.length; // sizeof(gTypeEffectiveness)
    let i = 0;
    for (let rands = 0; rands < 1000; rands++) {
      while ((i = random() % 128) > Math.trunc(chartLen / 3));
      i *= 3;
      if (typeAtk(i) === g.lastHitByType[atk] && typeMul(i) <= K.TYPE_MUL_NOT_EFFECTIVE && !isBattlerOfType(atk, typeDef(i))) {
        setBattlerType(atk, typeDef(i));
        prepareTypeBuffer(g.battleTextBuff1, typeDef(i));
        adv(5);
        return;
      }
    }
    for (let j = 0, rands = 0; rands < chartLen; j += 3, rands += 3) {
      const a = typeAtk(j);
      if (a === K.TYPE_ENDTABLE || a === K.TYPE_FORESIGHT) continue;
      // Note: checks TYPE_EFFECT_DEF_TYPE(i) but sets (rands), like the decomp.
      if (a === g.lastHitByType[atk] && typeMul(j) <= 5 && !isBattlerOfType(atk, typeDef(i))) {
        setBattlerType(atk, typeDef(rands));
        prepareTypeBuffer(g.battleTextBuff1, typeDef(rands));
        adv(5);
        return;
      }
    }
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_setalwayshitflag(): void {
  const tgt = g.battlerTarget;
  g.statuses3[tgt] &= ~K.STATUS3_ALWAYS_HITS;
  g.statuses3[tgt] |= (2 << 3) & K.STATUS3_ALWAYS_HITS; // STATUS3_ALWAYS_HITS_TURN(2)
  g.disableStructs[tgt].battlerWithSureHit = g.battlerAttacker;
  adv(1);
}

/** Sketch */
export function Cmd_copymovepermanently(): void {
  g.chosenMove = K.MOVE_UNAVAILABLE;
  const atk = g.battlerAttacker;
  const last = g.lastPrintedMoves[g.battlerTarget];
  if (
    !(g.battleMons[atk].status2 & K.STATUS2_TRANSFORMED) &&
    last !== K.MOVE_STRUGGLE &&
    last !== K.MOVE_NONE &&
    last !== K.MOVE_UNAVAILABLE &&
    last !== K.MOVE_SKETCH
  ) {
    let i = 0;
    for (; i < K.MAX_MON_MOVES; i++) {
      if (g.battleMons[atk].moves[i] === K.MOVE_SKETCH) continue;
      if (g.battleMons[atk].moves[i] === last) break;
    }
    if (i !== K.MAX_MON_MOVES) {
      g.battlescriptCurrInstr = w(1);
    } else {
      // sketch worked
      const m = g.battleMons[atk];
      m.moves[g.currMovePos] = last;
      m.pp[g.currMovePos] = gBattleMoves[last].pp;
      g.activeBattler = atk;
      // struct MovePpInfo: u16 moves[4], u8 pp[4], u8 ppBonuses
      const data = [...Array.from(m.moves).flatMap(u16), ...m.pp, m.ppBonuses];
      emitSetMonData(K.BUFFER_A, K.REQUEST_MOVES_PP_BATTLE, 0, data);
      markBattlerForControllerExec(atk);
      prepareMoveBuffer(g.battleTextBuff1, last);
      adv(5);
    }
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

/** IsTwoTurnsMove */
export function isTwoTurnsMove(move: number): boolean {
  const e = gBattleMoves[move].effect;
  return (
    e === K.EFFECT_SKULL_BASH ||
    e === K.EFFECT_RAZOR_WIND ||
    e === K.EFFECT_SKY_ATTACK ||
    e === K.EFFECT_SOLAR_BEAM ||
    e === K.EFFECT_SEMI_INVULNERABLE ||
    e === K.EFFECT_BIDE
  );
}

/** IsInvalidForSleepTalkOrAssist */
export function isInvalidForSleepTalkOrAssist(move: number): boolean {
  return move === K.MOVE_NONE || move === K.MOVE_SLEEP_TALK || move === K.MOVE_ASSIST || move === K.MOVE_MIRROR_MOVE || move === K.MOVE_METRONOME;
}

/** AttacksThisTurn: returns 1 if it's a charging turn, otherwise 2 (first argument is unused) */
export function attacksThisTurn(_battlerId: number, move: number): number {
  if (gBattleMoves[move].effect === K.EFFECT_SOLAR_BEAM && g.battleWeather & K.B_WEATHER_SUN) return 2;
  if (isTwoTurnsMove(move) && g.hitMarker & K.HITMARKER_CHARGING) return 1;
  return 2;
}

/** TrySetDestinyBondToHappen */
export function trySetDestinyBondToHappen(): void {
  const sideAttacker = getBattlerSide(g.battlerAttacker);
  const sideTarget = getBattlerSide(g.battlerTarget);
  if (g.battleMons[g.battlerTarget].status2 & K.STATUS2_DESTINY_BOND && sideAttacker !== sideTarget && !(g.hitMarker & K.HITMARKER_GRUDGE))
    g.hitMarker |= K.HITMARKER_DESTINYBOND;
}

export { gSpeciesInfo, h };
