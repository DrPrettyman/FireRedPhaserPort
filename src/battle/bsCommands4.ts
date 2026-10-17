// battle_script_commands.c, part 4: Cmd_trychoosesleeptalkmove (0xA9) .. Cmd_finishturn (0xF7).

import { IsDma3ManagerBusyWithBgCopy, ShowBg } from '../gba/bg';
import { PALETTES_ALL, RGB_BLACK, RGB_WHITE, vram } from '../gba/hw';
import { BeginFastPaletteFade, BeginNormalPaletteFade, FAST_FADE_OUT_TO_BLACK, gPaletteFade, gPlttBufferFaded } from '../gba/palette';
import { gMain, SetVBlankCallback } from '../gba/main';
import { gTasks } from '../gba/task';
import { FreeAllWindowBuffers } from '../gba/window';
import { DoNamingScreen } from '../menus/namingScreen';
import { CreateMonPicSprite_HandleDeoxys } from '../menus/picSprites';
import { DexScreen_RegisterMonToPokedex } from '../menus/pokedexScreen';
import { random } from '../util/random';
import { recordAbilityBattle } from './ai';
import { InitBattleBgsVideo, LoadBattleTextboxAndBackground } from './battleBg';
import { BattleMainCB2, VBlankCB_Battle } from './battleCallbacks';
import { ui } from './battleUi';
import { BattleCreateYesNoCursorAt, BattleDestroyYesNoCursorAt, BattlePutTextOnWindow, HandleBattleWindow } from './battleWindow';
import { adv, b, isItemMail, w } from './bsCommands1';
import { isInvalidForSleepTalkOrAssist, isTwoTurnsMove, trySetDestinyBondToHappen } from './bsCommands3';
import { K } from './constants';
import {
  emitBallThrowAnim,
  emitBattleAnimation,
  emitHealthBarUpdate,
  emitSetMonData,
  markBattlerForControllerExec,
  u16,
  u32,
} from './controllers';
import { bdata, g, gBattleMoves, gSpeciesInfo, mem, pokemon, state } from './env';
import { bit } from './globals';
import { encodeBattleText } from './message';
import {
  calculateBaseDamage,
  getAbilityBySpecies,
  handleSetPokedexFlag,
  partyOf,
  speciesOrEgg,
  speciesToNationalPokedexNum,
} from './pokemonBattle';
import {
  prepareAbilityBuffer,
  prepareByteNumberBuffer,
  prepareItemBuffer,
  prepareMonNickWithPrefixBuffer,
  prepareMoveBuffer,
  prepareTypeBuffer,
} from './textBuffers';
import {
  battleScriptPush,
  battleScriptPushCursor,
  battleScriptPushCursorAndCallback,
  bs,
  cancelMultiTurnMoves,
  castformDataTypeChange,
  checkMoveLimitations,
  getBattlerAtPosition,
  getBattlerForBattleScript,
  getBattlerPosition,
  getBattlerSide,
  getMoveTarget,
  isBattlerOfType,
  pressurePPLoseOnUsingImprison,
  pressurePPLoseOnUsingPerishSong,
  setBattlerType,
  weatherHasEffect,
} from './util';

const mech = () => bdata.tables.mech as Record<string, number[]>;
const effectScript = (move: number) => mem.u32(mem.label('gBattleScriptsForMoveEffects') + gBattleMoves[move].effect * 4);

export function Cmd_trychoosesleeptalkmove(): void {
  const atk = g.battlerAttacker;
  const m = g.battleMons[atk];
  let unusable = 0;
  for (let i = 0; i < K.MAX_MON_MOVES; i++) {
    const mv = m.moves[i];
    if (isInvalidForSleepTalkOrAssist(mv) || mv === K.MOVE_FOCUS_PUNCH || mv === K.MOVE_UPROAR || isTwoTurnsMove(mv)) unusable |= bit(i);
  }
  unusable = checkMoveLimitations(atk, unusable, ~K.MOVE_LIMITATION_PP & 0xff);
  if (unusable === (1 << K.MAX_MON_MOVES) - 1) {
    adv(5); // all 4 moves cannot be chosen
  } else {
    let movePosition: number;
    do {
      movePosition = random() & (K.MAX_MON_MOVES - 1);
    } while (bit(movePosition) & unusable);
    g.calledMove = m.moves[movePosition];
    g.currMovePos = movePosition;
    g.hitMarker &= ~K.HITMARKER_ATTACKSTRING_PRINTED;
    g.battlerTarget = getMoveTarget(g.calledMove, K.NO_TARGET_OVERRIDE);
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_setdestinybond(): void {
  g.battleMons[g.battlerAttacker].status2 |= K.STATUS2_DESTINY_BOND;
  adv(1);
}

export function Cmd_trysetdestinybondtohappen(): void {
  trySetDestinyBondToHappen();
  adv(1);
}

/** GetScaledHPFraction (battle_interface.c): u8 result of s16 math */
export function getScaledHPFraction(hp: number, maxhp: number, scale: number): number {
  const result = Math.trunc((((hp << 16) >> 16) * scale) / ((maxhp << 16) >> 16)) & 0xff;
  if (result === 0 && hp > 0) return 1;
  return result;
}

export function Cmd_remaininghptopower(): void {
  const m = g.battleMons[g.battlerAttacker];
  const hpFraction = getScaledHPFraction(m.hp, m.maxHP, 48);
  const t = mech().sFlailHpScaleToPowerTable;
  let i = 0;
  for (; i < t.length; i += 2) if (hpFraction <= t[i]) break;
  g.dynamicBasePower = t[i + 1];
  adv(1);
}

export function Cmd_tryspiteppreduce(): void {
  const tgt = g.battlerTarget;
  const last = g.lastMoves[tgt];
  if (last !== K.MOVE_NONE && last !== K.MOVE_UNAVAILABLE) {
    const m = g.battleMons[tgt];
    let i = 0;
    for (; i < K.MAX_MON_MOVES; i++) if (last === m.moves[i]) break;
    if (i !== K.MAX_MON_MOVES && m.pp[i] > 1) {
      let ppToDeduct = (random() & 3) + 2;
      if (m.pp[i] < ppToDeduct) ppToDeduct = m.pp[i];
      prepareMoveBuffer(g.battleTextBuff1, last);
      prepareByteNumberBuffer(g.battleTextBuff2, 1, ppToDeduct);
      m.pp[i] -= ppToDeduct;
      g.activeBattler = tgt;
      // if (MOVE_IS_PERMANENT(gActiveBattler, i)), but backwards
      if (!(g.disableStructs[tgt].mimickedMoves & bit(i)) && !(m.status2 & K.STATUS2_TRANSFORMED)) {
        emitSetMonData(K.BUFFER_A, K.REQUEST_PPMOVE1_BATTLE + i, 0, [m.pp[i]]);
        markBattlerForControllerExec(tgt);
      }
      adv(5);
      if (m.pp[i] === 0) cancelMultiTurnMoves(tgt);
      return;
    }
  }
  g.battlescriptCurrInstr = w(1);
}

export function Cmd_healpartystatus(): void {
  let toHeal = 0;
  const atk = g.battlerAttacker;
  const mc = g.battleCommunication;
  if (g.currentMove === K.MOVE_HEAL_BELL) {
    mc[K.MULTISTRING_CHOOSER] = K.B_MSG_BELL;
    const party = partyOf(atk);
    if (g.battleMons[atk].ability !== K.ABILITY_SOUNDPROOF) {
      g.battleMons[atk].status1 = 0;
      g.battleMons[atk].status2 &= ~K.STATUS2_NIGHTMARE;
    } else {
      recordAbilityBattle(atk, g.battleMons[atk].ability);
      mc[K.MULTISTRING_CHOOSER] |= K.B_MSG_BELL_SOUNDPROOF_ATTACKER;
    }
    g.activeBattler = g.battleScripting.battler = getBattlerAtPosition(getBattlerPosition(atk) ^ K.BIT_FLANK);
    const ab = g.activeBattler;
    if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && !(g.absentBattlerFlags & bit(ab))) {
      if (g.battleMons[ab].ability !== K.ABILITY_SOUNDPROOF) {
        g.battleMons[ab].status1 = 0;
        g.battleMons[ab].status2 &= ~K.STATUS2_NIGHTMARE;
      } else {
        recordAbilityBattle(ab, g.battleMons[ab].ability);
        mc[K.MULTISTRING_CHOOSER] |= K.B_MSG_BELL_SOUNDPROOF_PARTNER;
      }
    }
    for (let i = 0; i < K.PARTY_SIZE; i++) {
      const mon = party[i];
      const species = speciesOrEgg(mon);
      if (species !== K.SPECIES_NONE && species !== K.SPECIES_EGG) {
        let ability: number;
        if (g.battlerPartyIndexes[atk] === i) ability = g.battleMons[atk].ability;
        else if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && g.battlerPartyIndexes[ab] === i && !(g.absentBattlerFlags & bit(ab))) ability = g.battleMons[ab].ability;
        else ability = getAbilityBySpecies(species, mon!.abilityNum);
        if (ability !== K.ABILITY_SOUNDPROOF) toHeal |= 1 << i;
      }
    }
  } else {
    // Aromatherapy
    mc[K.MULTISTRING_CHOOSER] = K.B_MSG_SOOTHING_AROMA;
    toHeal = (1 << K.PARTY_SIZE) - 1;
    g.battleMons[atk].status1 = 0;
    g.battleMons[atk].status2 &= ~K.STATUS2_NIGHTMARE;
    g.activeBattler = getBattlerAtPosition(getBattlerPosition(atk) ^ K.BIT_FLANK);
    if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && !(g.absentBattlerFlags & bit(g.activeBattler))) {
      g.battleMons[g.activeBattler].status1 = 0;
      g.battleMons[g.activeBattler].status2 &= ~K.STATUS2_NIGHTMARE;
    }
  }
  if (toHeal) {
    g.activeBattler = atk;
    emitSetMonData(K.BUFFER_A, K.REQUEST_STATUS_BATTLE, toHeal, u32(0));
    markBattlerForControllerExec(atk);
  }
  adv(1);
}

export function Cmd_cursetarget(): void {
  if (g.battleMons[g.battlerTarget].status2 & K.STATUS2_CURSED) {
    g.battlescriptCurrInstr = w(1);
  } else {
    g.battleMons[g.battlerTarget].status2 |= K.STATUS2_CURSED;
    g.battleMoveDamage = Math.trunc(g.battleMons[g.battlerAttacker].maxHP / 2) || 1;
    adv(5);
  }
}

export function Cmd_trysetspikes(): void {
  const targetSide = getBattlerSide(g.battlerAttacker) ^ K.BIT_SIDE;
  if (g.sideTimers[targetSide].spikesAmount === 3) {
    g.specialStatuses[g.battlerAttacker].ppNotAffectedByPressure = 1;
    g.battlescriptCurrInstr = w(1);
  } else {
    g.sideStatuses[targetSide] |= K.SIDE_STATUS_SPIKES;
    g.sideTimers[targetSide].spikesAmount++;
    adv(5);
  }
}

export function Cmd_setforesight(): void {
  g.battleMons[g.battlerTarget].status2 |= K.STATUS2_FORESIGHT;
  adv(1);
}

export function Cmd_trysetperishsong(): void {
  let notAffectedCount = 0;
  for (let i = 0; i < g.battlersCount; i++) {
    if (g.statuses3[i] & K.STATUS3_PERISH_SONG || g.battleMons[i].ability === K.ABILITY_SOUNDPROOF) {
      notAffectedCount++;
    } else {
      g.statuses3[i] |= K.STATUS3_PERISH_SONG;
      g.disableStructs[i].perishSongTimer = 3;
      g.disableStructs[i].perishSongTimerStartValue = 3;
    }
  }
  pressurePPLoseOnUsingPerishSong(g.battlerAttacker);
  if (notAffectedCount === g.battlersCount) g.battlescriptCurrInstr = w(1);
  else adv(5);
}

export function Cmd_rolloutdamagecalculation(): void {
  const atk = g.battlerAttacker;
  if (g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) {
    cancelMultiTurnMoves(atk);
    g.battlescriptCurrInstr = bs('BattleScript_MoveMissedPause');
    return;
  }
  const d = g.disableStructs[atk];
  const m = g.battleMons[atk];
  if (!(m.status2 & K.STATUS2_MULTIPLETURNS)) {
    // first hit
    d.rolloutTimer = 5;
    d.rolloutTimerStartValue = 5;
    m.status2 |= K.STATUS2_MULTIPLETURNS;
    g.lockedMoves[atk] = g.currentMove;
  }
  if (--d.rolloutTimer === 0) m.status2 &= ~K.STATUS2_MULTIPLETURNS; // last hit
  g.dynamicBasePower = gBattleMoves[g.currentMove].power;
  for (let i = 1; i < 5 - d.rolloutTimer; i++) g.dynamicBasePower *= 2;
  if (m.status2 & K.STATUS2_DEFENSE_CURL) g.dynamicBasePower *= 2;
  adv(1);
}

export function Cmd_jumpifconfusedandstatmaxed(): void {
  const t = g.battleMons[g.battlerTarget];
  if (t.status2 & K.STATUS2_CONFUSION && t.statStages[b(1)] === K.MAX_STAT_STAGE) g.battlescriptCurrInstr = w(2);
  else adv(6);
}

export function Cmd_furycuttercalc(): void {
  const d = g.disableStructs[g.battlerAttacker];
  if (g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) {
    d.furyCutterCounter = 0;
    g.battlescriptCurrInstr = bs('BattleScript_MoveMissedPause');
  } else {
    if (d.furyCutterCounter !== 5) d.furyCutterCounter++;
    g.dynamicBasePower = gBattleMoves[g.currentMove].power;
    for (let i = 1; i < d.furyCutterCounter; i++) g.dynamicBasePower *= 2;
    adv(1);
  }
}

export function Cmd_friendshiptodamagecalculation(): void {
  const f = g.battleMons[g.battlerAttacker].friendship;
  if (gBattleMoves[g.currentMove].effect === K.EFFECT_RETURN) g.dynamicBasePower = Math.trunc((10 * f) / 25);
  else g.dynamicBasePower = Math.trunc((10 * (255 - f)) / 25); // EFFECT_FRUSTRATION
  adv(1);
}

export function Cmd_presentdamagecalculation(): void {
  const rand = random() & 0xff;
  if (rand < 102) g.dynamicBasePower = 40;
  else if (rand < 178) g.dynamicBasePower = 80;
  else if (rand < 204) g.dynamicBasePower = 120;
  else {
    g.battleMoveDamage = Math.trunc(g.battleMons[g.battlerTarget].maxHP / 4) || 1;
    g.battleMoveDamage *= -1;
  }
  const t = g.battleMons[g.battlerTarget];
  if (rand < 204) g.battlescriptCurrInstr = bs('BattleScript_HitFromCritCalc');
  else if (t.maxHP === t.hp) g.battlescriptCurrInstr = bs('BattleScript_AlreadyAtFullHp');
  else {
    g.moveResultFlags &= ~K.MOVE_RESULT_DOESNT_AFFECT_FOE;
    g.battlescriptCurrInstr = bs('BattleScript_PresentHealTarget');
  }
}

export function Cmd_setsafeguard(): void {
  const side = getBattlerSide(g.battlerAttacker);
  if (g.sideStatuses[side] & K.SIDE_STATUS_SAFEGUARD) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_SIDE_STATUS_FAILED;
  } else {
    g.sideStatuses[side] |= K.SIDE_STATUS_SAFEGUARD;
    g.sideTimers[side].safeguardTimer = 5;
    g.sideTimers[side].safeguardBattlerId = g.battlerAttacker;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_SET_SAFEGUARD;
  }
  adv(1);
}

export function Cmd_magnitudedamagecalculation(): void {
  let magnitude = random() % 100;
  const steps: [number, number, number][] = [
    [5, 10, 4],
    [15, 30, 5],
    [35, 50, 6],
    [65, 70, 7],
    [85, 90, 8],
    [95, 110, 9],
  ];
  const step = steps.find(([lt]) => magnitude < lt);
  if (step) {
    g.dynamicBasePower = step[1];
    magnitude = step[2];
  } else {
    g.dynamicBasePower = 150;
    magnitude = 10;
  }
  prepareByteNumberBuffer(g.battleTextBuff1, 2, magnitude);
  for (g.battlerTarget = 0; g.battlerTarget < g.battlersCount; g.battlerTarget++) {
    if (g.battlerTarget === g.battlerAttacker) continue;
    if (!(g.absentBattlerFlags & bit(g.battlerTarget))) break; // a valid target was found
  }
  adv(1);
}

export function Cmd_jumpifnopursuitswitchdmg(): void {
  const atkPlayer = getBattlerSide(g.battlerAttacker) === K.B_SIDE_PLAYER;
  if (g.multiHitCounter === 1) g.battlerTarget = getBattlerAtPosition(atkPlayer ? K.B_POSITION_OPPONENT_LEFT : K.B_POSITION_PLAYER_LEFT);
  else g.battlerTarget = getBattlerAtPosition(atkPlayer ? K.B_POSITION_OPPONENT_RIGHT : K.B_POSITION_PLAYER_RIGHT);
  const tgt = g.battlerTarget;
  if (
    g.chosenActionByBattler[tgt] === K.B_ACTION_USE_MOVE &&
    g.battlerAttacker === g.battleStruct.moveTarget[tgt] &&
    !(g.battleMons[tgt].status1 & (K.STATUS1_SLEEP | K.STATUS1_FREEZE)) &&
    g.battleMons[g.battlerAttacker].hp &&
    !g.disableStructs[tgt].truantCounter &&
    g.chosenMoveByBattler[tgt] === K.MOVE_PURSUIT
  ) {
    for (let i = 0; i < g.battlersCount; i++) if (g.battlerByTurnOrder[i] === tgt) g.actionsByTurnOrder[i] = K.B_ACTION_TRY_FINISH;
    g.currentMove = K.MOVE_PURSUIT;
    g.currMovePos = g.chosenMovePos = g.battleStruct.chosenMovePositions[tgt];
    adv(5);
    g.battleScripting.animTurn = 1;
    g.hitMarker &= ~K.HITMARKER_ATTACKSTRING_PRINTED;
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_setsunny(): void {
  if (g.battleWeather & K.B_WEATHER_SUN) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_WEATHER_FAILED;
  } else {
    g.battleWeather = K.B_WEATHER_SUN_TEMPORARY;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_STARTED_SUNLIGHT;
    g.wishFutureKnock.weatherDuration = 5;
  }
  adv(1);
}

/** Belly Drum */
export function Cmd_maxattackhalvehp(): void {
  const m = g.battleMons[g.battlerAttacker];
  let halfHp = Math.trunc(m.maxHP / 2);
  if (!Math.trunc(m.maxHP / 2)) halfHp = 1;
  if (m.statStages[K.STAT_ATK] < K.MAX_STAT_STAGE && m.hp > halfHp) {
    m.statStages[K.STAT_ATK] = K.MAX_STAT_STAGE;
    g.battleMoveDamage = Math.trunc(m.maxHP / 2) || 1;
    adv(5);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

/** Psych Up */
export function Cmd_copyfoestats(): void {
  for (let i = 0; i < K.NUM_BATTLE_STATS; i++) g.battleMons[g.battlerAttacker].statStages[i] = g.battleMons[g.battlerTarget].statStages[i];
  adv(5); // Has an unused jump ptr(possibly for a failed attempt) parameter.
}

export function Cmd_rapidspinfree(): void {
  const atk = g.battlerAttacker;
  const m = g.battleMons[atk];
  const side = getBattlerSide(atk);
  if (m.status2 & K.STATUS2_WRAPPED) {
    g.battleScripting.battler = g.battlerTarget;
    m.status2 &= ~K.STATUS2_WRAPPED;
    g.battlerTarget = g.battleStruct.wrappedBy[atk];
    const t = g.battleTextBuff1;
    t[0] = K.B_BUFF_PLACEHOLDER_BEGIN;
    t[1] = K.B_BUFF_MOVE;
    t[2] = g.battleStruct.wrappedMove[atk * 2 + 0];
    t[3] = g.battleStruct.wrappedMove[atk * 2 + 1];
    t[4] = K.B_BUFF_EOS;
    battleScriptPushCursor();
    g.battlescriptCurrInstr = bs('BattleScript_WrapFree');
  } else if (g.statuses3[atk] & K.STATUS3_LEECHSEED) {
    g.statuses3[atk] &= ~K.STATUS3_LEECHSEED;
    g.statuses3[atk] &= ~K.STATUS3_LEECHSEED_BATTLER;
    battleScriptPushCursor();
    g.battlescriptCurrInstr = bs('BattleScript_LeechSeedFree');
  } else if (g.sideStatuses[side] & K.SIDE_STATUS_SPIKES) {
    g.sideStatuses[side] &= ~K.SIDE_STATUS_SPIKES;
    g.sideTimers[side].spikesAmount = 0;
    battleScriptPushCursor();
    g.battlescriptCurrInstr = bs('BattleScript_SpikesFree');
  } else {
    adv(1);
  }
}

export function Cmd_setdefensecurlbit(): void {
  g.battleMons[g.battlerAttacker].status2 |= K.STATUS2_DEFENSE_CURL;
  adv(1);
}

export function Cmd_recoverbasedonsunlight(): void {
  g.battlerTarget = g.battlerAttacker;
  const m = g.battleMons[g.battlerAttacker];
  if (m.hp !== m.maxHP) {
    if (g.battleWeather === 0 || !weatherHasEffect()) g.battleMoveDamage = Math.trunc(m.maxHP / 2);
    else if (g.battleWeather & K.B_WEATHER_SUN) g.battleMoveDamage = Math.trunc((20 * m.maxHP) / 30);
    else g.battleMoveDamage = Math.trunc(m.maxHP / 4); // not sunny weather
    if (g.battleMoveDamage === 0) g.battleMoveDamage = 1;
    g.battleMoveDamage *= -1;
    adv(5);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_hiddenpowercalc(): void {
  const m = g.battleMons[g.battlerAttacker];
  const powerBits =
    ((m.hpIV & 2) >> 1) | ((m.attackIV & 2) << 0) | ((m.defenseIV & 2) << 1) | ((m.speedIV & 2) << 2) | ((m.spAttackIV & 2) << 3) | ((m.spDefenseIV & 2) << 4);
  const typeBits =
    ((m.hpIV & 1) << 0) | ((m.attackIV & 1) << 1) | ((m.defenseIV & 1) << 2) | ((m.speedIV & 1) << 3) | ((m.spAttackIV & 1) << 4) | ((m.spDefenseIV & 1) << 5);
  g.dynamicBasePower = Math.trunc((40 * powerBits) / 63) + 30;
  // Subtract 3 instead of 1 below because 2 types are excluded (TYPE_NORMAL and TYPE_MYSTERY)
  let t = Math.trunc(((K.NUMBER_OF_MON_TYPES - 3) * typeBits) / 63) + 1;
  if (t >= K.TYPE_MYSTERY) t++;
  g.battleStruct.dynamicMoveType = t | K.F_DYNAMIC_TYPE_1 | K.F_DYNAMIC_TYPE_2;
  adv(1);
}

export function Cmd_selectfirstvalidtarget(): void {
  for (g.battlerTarget = 0; g.battlerTarget < g.battlersCount; g.battlerTarget++) {
    if (g.battlerTarget === g.battlerAttacker) continue;
    if (!(g.absentBattlerFlags & bit(g.battlerTarget))) break;
  }
  adv(1);
}

export function Cmd_trysetfutureattack(): void {
  const tgt = g.battlerTarget;
  const wf = g.wishFutureKnock;
  if (wf.futureSightCounter[tgt] !== 0) {
    g.battlescriptCurrInstr = w(1);
  } else {
    wf.futureSightMove[tgt] = g.currentMove;
    wf.futureSightAttacker[tgt] = g.battlerAttacker;
    wf.futureSightCounter[tgt] = 3;
    wf.futureSightDmg[tgt] = calculateBaseDamage(
      g.battleMons[g.battlerAttacker],
      g.battleMons[tgt],
      g.currentMove,
      g.sideStatuses[getBattlerSide(tgt)],
      0,
      0,
      g.battlerAttacker,
      tgt,
    );
    if (g.protectStructs[g.battlerAttacker].helpingHand) wf.futureSightDmg[tgt] = Math.trunc((wf.futureSightDmg[tgt] * 15) / 10);
    g.battleCommunication[K.MULTISTRING_CHOOSER] = g.currentMove === K.MOVE_DOOM_DESIRE ? K.B_MSG_DOOM_DESIRE : K.B_MSG_FUTURE_SIGHT;
    adv(5);
  }
}

export function Cmd_trydobeatup(): void {
  const party = partyOf(g.battlerAttacker);
  const mc = g.battleCommunication;
  if (g.battleMons[g.battlerTarget].hp === 0) {
    g.battlescriptCurrInstr = w(1);
    return;
  }
  const beforeLoop = mc[0];
  for (; mc[0] < K.PARTY_SIZE; mc[0]++) {
    const mon = party[mc[0]];
    const sp = speciesOrEgg(mon);
    if (mon?.hp && sp && sp !== K.SPECIES_EGG && !mon.status) break;
  }
  if (mc[0] < K.PARTY_SIZE) {
    const mon = party[mc[0]]!;
    prepareMonNickWithPrefixBuffer(g.battleTextBuff1, g.battlerAttacker, mc[0]);
    adv(9);
    let dmg = gSpeciesInfo[mon.species].baseAttack;
    dmg *= gBattleMoves[g.currentMove].power;
    dmg *= Math.trunc((mon.level * 2) / 5) + 2;
    dmg = Math.trunc(dmg / gSpeciesInfo[g.battleMons[g.battlerTarget].species].baseDefense);
    dmg = Math.trunc(dmg / 50) + 2;
    if (g.protectStructs[g.battlerAttacker].helpingHand) dmg = Math.trunc((dmg * 15) / 10);
    g.battleMoveDamage = dmg;
    mc[0]++;
  } else if (beforeLoop !== 0) g.battlescriptCurrInstr = w(1);
  else g.battlescriptCurrInstr = w(5);
}

function semiInvulnerableFlag(): number {
  switch (g.currentMove) {
    case K.MOVE_FLY:
    case K.MOVE_BOUNCE:
      return K.STATUS3_ON_AIR;
    case K.MOVE_DIG:
      return K.STATUS3_UNDERGROUND;
    case K.MOVE_DIVE:
      return K.STATUS3_UNDERWATER;
  }
  return 0;
}

export function Cmd_setsemiinvulnerablebit(): void {
  g.statuses3[g.battlerAttacker] |= semiInvulnerableFlag();
  adv(1);
}

export function Cmd_clearsemiinvulnerablebit(): void {
  g.statuses3[g.battlerAttacker] &= ~semiInvulnerableFlag();
  adv(1);
}

export function Cmd_setminimize(): void {
  if (g.hitMarker & K.HITMARKER_OBEYS) g.statuses3[g.battlerAttacker] |= K.STATUS3_MINIMIZED;
  adv(1);
}

export function Cmd_sethail(): void {
  if (g.battleWeather & K.B_WEATHER_HAIL) {
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_WEATHER_FAILED;
  } else {
    g.battleWeather = K.B_WEATHER_HAIL_TEMPORARY;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_STARTED_HAIL;
    g.wishFutureKnock.weatherDuration = 5;
  }
  adv(1);
}

export function Cmd_trymemento(): void {
  const t = g.battleMons[g.battlerTarget];
  if (t.statStages[K.STAT_ATK] === K.MIN_STAT_STAGE && t.statStages[K.STAT_SPATK] === K.MIN_STAT_STAGE && g.battleCommunication[K.MISS_TYPE] !== K.B_MSG_PROTECTED) {
    // Failed, unprotected target already has minimum Attack and Special Attack.
    g.battlescriptCurrInstr = w(1);
  } else {
    // Success, drop user's HP bar to 0
    g.activeBattler = g.battlerAttacker;
    g.battleMoveDamage = g.battleMons[g.activeBattler].hp;
    emitHealthBarUpdate(K.BUFFER_A, K.INSTANT_HP_BAR_DROP);
    markBattlerForControllerExec(g.activeBattler);
    adv(5);
  }
}

/** Follow Me */
export function Cmd_setforcedtarget(): void {
  const side = getBattlerSide(g.battlerAttacker);
  g.sideTimers[side].followmeTimer = 1;
  g.sideTimers[side].followmeTarget = g.battlerAttacker;
  adv(1);
}

export function Cmd_setcharge(): void {
  g.statuses3[g.battlerAttacker] |= K.STATUS3_CHARGED_UP;
  g.disableStructs[g.battlerAttacker].chargeTimer = 2;
  g.disableStructs[g.battlerAttacker].chargeTimerStartValue = 2;
  adv(1);
}

/** Nature Power */
export function Cmd_callterrainattack(): void {
  g.hitMarker &= ~K.HITMARKER_ATTACKSTRING_PRINTED;
  g.currentMove = mech().sNaturePowerMoves[g.battleTerrain];
  g.battlerTarget = getMoveTarget(g.currentMove, K.NO_TARGET_OVERRIDE);
  battleScriptPush(effectScript(g.currentMove));
  adv(1);
}

/** Refresh */
export function Cmd_cureifburnedparalysedorpoisoned(): void {
  const m = g.battleMons[g.battlerAttacker];
  if (m.status1 & (K.STATUS1_POISON | K.STATUS1_BURN | K.STATUS1_PARALYSIS | K.STATUS1_TOXIC_POISON)) {
    m.status1 = 0;
    adv(5);
    g.activeBattler = g.battlerAttacker;
    emitSetMonData(K.BUFFER_A, K.REQUEST_STATUS_BATTLE, 0, u32(0));
    markBattlerForControllerExec(g.activeBattler);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_settorment(): void {
  const t = g.battleMons[g.battlerTarget];
  if (t.status2 & K.STATUS2_TORMENT) {
    g.battlescriptCurrInstr = w(1);
  } else {
    t.status2 |= K.STATUS2_TORMENT;
    adv(5);
  }
}

export function Cmd_jumpifnodamage(): void {
  const p = g.protectStructs[g.battlerAttacker];
  if (p.physicalDmg || p.specialDmg) adv(5);
  else g.battlescriptCurrInstr = w(1);
}

export function Cmd_settaunt(): void {
  const d = g.disableStructs[g.battlerTarget];
  if (d.tauntTimer === 0) {
    d.tauntTimer = 2;
    d.tauntTimer2 = 2;
    adv(5);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_trysethelpinghand(): void {
  g.battlerTarget = getBattlerAtPosition(getBattlerPosition(g.battlerAttacker) ^ K.BIT_FLANK);
  if (
    g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE &&
    !(g.absentBattlerFlags & bit(g.battlerTarget)) &&
    !g.protectStructs[g.battlerAttacker].helpingHand &&
    !g.protectStructs[g.battlerTarget].helpingHand
  ) {
    g.protectStructs[g.battlerTarget].helpingHand = 1;
    adv(5);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

/** Trick */
export function Cmd_tryswapitems(): void {
  const atk = g.battlerAttacker;
  const tgt = g.battlerTarget;
  const special = g.battleTypeFlags & (K.BATTLE_TYPE_LINK | K.BATTLE_TYPE_BATTLE_TOWER | K.BATTLE_TYPE_EREADER_TRAINER);
  // opponent can't swap items with player in regular battles
  if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER_TOWER || (getBattlerSide(atk) === K.B_SIDE_OPPONENT && !special && g.trainerBattleOpponent_A !== K.TRAINER_SECRET_BASE)) {
    g.battlescriptCurrInstr = w(1);
    return;
  }
  const sideAttacker = getBattlerSide(atk);
  const sideTarget = getBattlerSide(tgt);
  const kn = g.wishFutureKnock.knockedOffMons;
  const a = g.battleMons[atk];
  const t = g.battleMons[tgt];
  if (
    !special &&
    g.trainerBattleOpponent_A !== K.TRAINER_SECRET_BASE &&
    (kn[sideAttacker] & bit(g.battlerPartyIndexes[atk]) || kn[sideTarget] & bit(g.battlerPartyIndexes[tgt]))
  ) {
    // you can't swap items if they were knocked off in regular battles
    g.battlescriptCurrInstr = w(1);
  } else if (
    (a.item === K.ITEM_NONE && t.item === K.ITEM_NONE) ||
    a.item === K.ITEM_ENIGMA_BERRY ||
    t.item === K.ITEM_ENIGMA_BERRY ||
    isItemMail(a.item) ||
    isItemMail(t.item)
  ) {
    g.battlescriptCurrInstr = w(1);
  } else if (t.ability === K.ABILITY_STICKY_HOLD) {
    g.battlescriptCurrInstr = bs('BattleScript_StickyHoldActivates');
    g.lastUsedAbility = t.ability;
    recordAbilityBattle(tgt, g.lastUsedAbility);
  } else {
    // all checks passed and items can be safely swapped
    const oldItemAtk = a.item;
    const newItemAtk = (g.battleStruct.changedItems[atk] = t.item);
    a.item = K.ITEM_NONE;
    t.item = oldItemAtk;
    g.activeBattler = atk;
    emitSetMonData(K.BUFFER_A, K.REQUEST_HELDITEM_BATTLE, 0, u16(newItemAtk));
    markBattlerForControllerExec(atk);
    g.activeBattler = tgt;
    emitSetMonData(K.BUFFER_A, K.REQUEST_HELDITEM_BATTLE, 0, u16(t.item));
    markBattlerForControllerExec(tgt);
    g.battleStruct.choicedMove[tgt] = 0;
    g.battleStruct.choicedMove[atk] = 0;
    adv(5);
    prepareItemBuffer(g.battleTextBuff1, newItemAtk);
    prepareItemBuffer(g.battleTextBuff2, oldItemAtk);
    if (oldItemAtk !== K.ITEM_NONE && newItemAtk !== K.ITEM_NONE) g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_ITEM_SWAP_BOTH;
    else if (oldItemAtk === K.ITEM_NONE && newItemAtk !== K.ITEM_NONE) g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_ITEM_SWAP_TAKEN;
    else g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_ITEM_SWAP_GIVEN;
  }
}

/** Role Play */
export function Cmd_trycopyability(): void {
  const t = g.battleMons[g.battlerTarget];
  if (t.ability !== K.ABILITY_NONE && t.ability !== K.ABILITY_WONDER_GUARD) {
    g.battleMons[g.battlerAttacker].ability = t.ability;
    g.lastUsedAbility = t.ability;
    adv(5);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_trywish(): void {
  const wf = g.wishFutureKnock;
  switch (b(1)) {
    case 0: // use wish
      if (wf.wishCounter[g.battlerAttacker] === 0) {
        wf.wishCounter[g.battlerAttacker] = 2;
        wf.wishMonId[g.battlerAttacker] = g.battlerPartyIndexes[g.battlerAttacker];
        adv(6);
      } else {
        g.battlescriptCurrInstr = w(2);
      }
      break;
    case 1: {
      // heal effect
      const tgt = g.battlerTarget;
      prepareMonNickWithPrefixBuffer(g.battleTextBuff1, tgt, wf.wishMonId[tgt]);
      g.battleMoveDamage = Math.trunc(g.battleMons[tgt].maxHP / 2) || 1;
      g.battleMoveDamage *= -1;
      if (g.battleMons[tgt].hp === g.battleMons[tgt].maxHP) g.battlescriptCurrInstr = w(2);
      else adv(6);
      break;
    }
  }
}

/** Ingrain */
export function Cmd_trysetroots(): void {
  if (g.statuses3[g.battlerAttacker] & K.STATUS3_ROOTED) {
    g.battlescriptCurrInstr = w(1);
  } else {
    g.statuses3[g.battlerAttacker] |= K.STATUS3_ROOTED;
    adv(5);
  }
}

export function Cmd_doubledamagedealtifdamaged(): void {
  const p = g.protectStructs[g.battlerAttacker];
  if ((p.physicalDmg !== 0 && p.physicalBattlerId === g.battlerTarget) || (p.specialDmg !== 0 && p.specialBattlerId === g.battlerTarget))
    g.battleScripting.dmgMultiplier = 2;
  adv(1);
}

export function Cmd_setyawn(): void {
  const tgt = g.battlerTarget;
  if (g.statuses3[tgt] & K.STATUS3_YAWN || g.battleMons[tgt].status1 & K.STATUS1_ANY) {
    g.battlescriptCurrInstr = w(1);
  } else {
    g.statuses3[tgt] |= (2 << 11) & K.STATUS3_YAWN; // STATUS3_YAWN_TURN(2)
    adv(5);
  }
}

export function Cmd_setdamagetohealthdifference(): void {
  const t = g.battleMons[g.battlerTarget];
  const a = g.battleMons[g.battlerAttacker];
  if (t.hp <= a.hp) {
    g.battlescriptCurrInstr = w(1);
  } else {
    g.battleMoveDamage = t.hp - a.hp;
    adv(5);
  }
}

export function Cmd_scaledamagebyhealthratio(): void {
  if (g.dynamicBasePower === 0) {
    const power = gBattleMoves[g.currentMove].power & 0xff;
    const a = g.battleMons[g.battlerAttacker];
    g.dynamicBasePower = Math.trunc((a.hp * power) / a.maxHP);
    if (g.dynamicBasePower === 0) g.dynamicBasePower = 1;
  }
  adv(1);
}

/** Skill Swap */
export function Cmd_tryswapabilities(): void {
  const a = g.battleMons[g.battlerAttacker];
  const t = g.battleMons[g.battlerTarget];
  if (
    (a.ability === K.ABILITY_NONE && t.ability === K.ABILITY_NONE) ||
    a.ability === K.ABILITY_WONDER_GUARD ||
    t.ability === K.ABILITY_WONDER_GUARD ||
    g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT
  ) {
    g.battlescriptCurrInstr = w(1);
  } else {
    const abilityAtk = a.ability;
    a.ability = t.ability;
    t.ability = abilityAtk;
    adv(5);
  }
}

export function Cmd_tryimprison(): void {
  const atk = g.battlerAttacker;
  if (g.statuses3[atk] & K.STATUS3_IMPRISONED_OTHERS) {
    g.battlescriptCurrInstr = w(1);
    return;
  }
  const sideAttacker = getBattlerSide(atk);
  pressurePPLoseOnUsingImprison(atk);
  let battlerId = 0;
  for (; battlerId < g.battlersCount; battlerId++) {
    if (sideAttacker === getBattlerSide(battlerId)) continue;
    let attackerMoveId = 0;
    for (; attackerMoveId < K.MAX_MON_MOVES; attackerMoveId++) {
      let i = 0;
      const mv = g.battleMons[atk].moves[attackerMoveId];
      for (; i < K.MAX_MON_MOVES; i++) if (mv === g.battleMons[battlerId].moves[i] && mv !== K.MOVE_NONE) break;
      if (i !== K.MAX_MON_MOVES) break;
    }
    if (attackerMoveId !== K.MAX_MON_MOVES) {
      g.statuses3[atk] |= K.STATUS3_IMPRISONED_OTHERS;
      adv(5);
      break;
    }
  }
  // In Generation 3 games, Imprison fails if the user doesn't share any moves with any of the foes
  if (battlerId === g.battlersCount) g.battlescriptCurrInstr = w(1);
}

export function Cmd_trysetgrudge(): void {
  if (g.statuses3[g.battlerAttacker] & K.STATUS3_GRUDGE) {
    g.battlescriptCurrInstr = w(1);
  } else {
    g.statuses3[g.battlerAttacker] |= K.STATUS3_GRUDGE;
    adv(5);
  }
}

/** GetPokedexHeightWeight(dexNum, 1) */
function pokedexWeight(dexNum: number): number {
  const hw = (bdata.tables.mech as unknown as { pokedexHeightWeight: ([number, number] | null)[] }).pokedexHeightWeight[dexNum];
  return hw ? hw[1] : 0;
}

export function Cmd_weightdamagecalculation(): void {
  const t = mech().sWeightToDamageTable;
  const weight = pokedexWeight(speciesToNationalPokedexNum(g.battleMons[g.battlerTarget].species));
  let i = 0;
  for (; t[i] !== 0xffff; i += 2) if (t[i] > weight) break;
  g.dynamicBasePower = t[i] !== 0xffff ? t[i + 1] : 120;
  adv(1);
}

export function Cmd_assistattackselect(): void {
  const atk = g.battlerAttacker;
  const party = partyOf(atk);
  const validMoves = g.battleStruct.assistPossibleMoves;
  const forbidden = mech().sMovesForbiddenToCopy;
  let n = 0;
  for (let monId = 0; monId < K.PARTY_SIZE; monId++) {
    if (monId === g.battlerPartyIndexes[atk]) continue;
    const mon = party[monId];
    const sp = speciesOrEgg(mon);
    if (sp === K.SPECIES_NONE || sp === K.SPECIES_EGG) continue;
    for (let moveId = 0; moveId < K.MAX_MON_MOVES; moveId++) {
      const move = mon!.moves[moveId];
      if (isInvalidForSleepTalkOrAssist(move)) continue;
      let i = 0;
      for (; forbidden[i] !== 0xffff && move !== forbidden[i]; i++);
      if (forbidden[i] !== 0xffff) continue;
      if (move === K.MOVE_NONE) continue;
      validMoves[n++] = move;
    }
  }
  if (n) {
    g.hitMarker &= ~K.HITMARKER_ATTACKSTRING_PRINTED;
    g.calledMove = validMoves[((random() & 0xff) * n) >> 8];
    g.battlerTarget = getMoveTarget(g.calledMove, K.NO_TARGET_OVERRIDE);
    adv(5);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_trysetmagiccoat(): void {
  g.battlerTarget = g.battlerAttacker;
  g.specialStatuses[g.battlerAttacker].ppNotAffectedByPressure = 1;
  if (g.currentTurnActionNumber === g.battlersCount - 1) {
    g.battlescriptCurrInstr = w(1); // moves last turn
  } else {
    g.protectStructs[g.battlerAttacker].bounceMove = 1;
    adv(5);
  }
}

/** Snatch */
export function Cmd_trysetsnatch(): void {
  g.specialStatuses[g.battlerAttacker].ppNotAffectedByPressure = 1;
  if (g.currentTurnActionNumber === g.battlersCount - 1) {
    g.battlescriptCurrInstr = w(1); // moves last turn
  } else {
    g.protectStructs[g.battlerAttacker].stealMove = 1;
    adv(5);
  }
}

export function Cmd_trygetintimidatetarget(): void {
  g.battleScripting.battler = g.battleStruct.intimidateBattler;
  const side = getBattlerSide(g.battleScripting.battler);
  prepareAbilityBuffer(g.battleTextBuff1, g.battleMons[g.battleScripting.battler].ability);
  for (; g.battlerTarget < g.battlersCount; g.battlerTarget++) {
    if (getBattlerSide(g.battlerTarget) === side) continue;
    if (!(g.absentBattlerFlags & bit(g.battlerTarget))) break;
  }
  if (g.battlerTarget >= g.battlersCount) g.battlescriptCurrInstr = w(1);
  else adv(5);
}

export function Cmd_switchoutabilities(): void {
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  if (g.battleMons[ab].ability === K.ABILITY_NATURAL_CURE) {
    g.battleMons[ab].status1 = 0;
    emitSetMonData(K.BUFFER_A, K.REQUEST_STATUS_BATTLE, bit(g.battleStruct.battlerPartyIndexes[ab]), u32(0));
    markBattlerForControllerExec(ab);
  }
  adv(2);
}

export function Cmd_jumpifhasnohp(): void {
  g.activeBattler = getBattlerForBattleScript(b(1));
  if (g.battleMons[g.activeBattler].hp === 0) g.battlescriptCurrInstr = w(2);
  else adv(6);
}

export function Cmd_getsecretpowereffect(): void {
  const mc = g.battleCommunication;
  const E = K.MOVE_EFFECT_BYTE;
  switch (g.battleTerrain) {
    case K.BATTLE_TERRAIN_GRASS:
      mc[E] = K.MOVE_EFFECT_POISON;
      break;
    case K.BATTLE_TERRAIN_LONG_GRASS:
      mc[E] = K.MOVE_EFFECT_SLEEP;
      break;
    case K.BATTLE_TERRAIN_SAND:
      mc[E] = K.MOVE_EFFECT_ACC_MINUS_1;
      break;
    case K.BATTLE_TERRAIN_UNDERWATER:
      mc[E] = K.MOVE_EFFECT_DEF_MINUS_1;
      break;
    case K.BATTLE_TERRAIN_WATER:
      mc[E] = K.MOVE_EFFECT_ATK_MINUS_1;
      break;
    case K.BATTLE_TERRAIN_POND:
      mc[E] = K.MOVE_EFFECT_SPD_MINUS_1;
      break;
    case K.BATTLE_TERRAIN_MOUNTAIN:
      mc[E] = K.MOVE_EFFECT_CONFUSION;
      break;
    case K.BATTLE_TERRAIN_CAVE:
      mc[E] = K.MOVE_EFFECT_FLINCH;
      break;
    default:
      mc[E] = K.MOVE_EFFECT_PARALYSIS;
      break;
  }
  adv(1);
}

export function Cmd_pickup(): void {
  const items = mech().sPickupItems; // {itemId, chance} pairs
  for (let i = 0; i < K.PARTY_SIZE; i++) {
    const mon = g.playerParty[i];
    const species = speciesOrEgg(mon);
    const heldItem = mon?.heldItem ?? 0;
    const abilities = gSpeciesInfo[species]?.abilities ?? [0, 0];
    const ability = (mon?.abilityNum ?? 0) !== K.ABILITY_NONE ? abilities[1] : abilities[0];
    if (ability === K.ABILITY_PICKUP && species !== K.SPECIES_NONE && species !== K.SPECIES_EGG && heldItem === K.ITEM_NONE && !(random() % 10)) {
      const rnd = random() % 100;
      let j = 0;
      for (; j < 15; ++j) if (items[j * 2 + 1] > rnd) break;
      mon!.heldItem = items[j * 2];
    }
  }
  adv(1);
}

export function Cmd_docastformchangeanimation(): void {
  g.activeBattler = g.battleScripting.battler;
  if (g.battleMons[g.activeBattler].status2 & K.STATUS2_SUBSTITUTE) g.battleStruct.formToChangeInto |= K.CASTFORM_SUBSTITUTE;
  emitBattleAnimation(K.BUFFER_A, K.B_ANIM_CASTFORM_CHANGE, g.battleStruct.formToChangeInto);
  markBattlerForControllerExec(g.activeBattler);
  adv(1);
}

export function Cmd_trycastformdatachange(): void {
  adv(1);
  const form = castformDataTypeChange(g.battleScripting.battler);
  if (form) {
    battleScriptPushCursorAndCallback(bs('BattleScript_CastformChange'));
    g.battleStruct.formToChangeInto = form - 1;
  }
}

/** Water and Mud Sport */
export function Cmd_settypebasedhalvers(): void {
  let worked = false;
  const atk = g.battlerAttacker;
  if (gBattleMoves[g.currentMove].effect === K.EFFECT_MUD_SPORT) {
    if (!(g.statuses3[atk] & K.STATUS3_MUDSPORT)) {
      g.statuses3[atk] |= K.STATUS3_MUDSPORT;
      g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_WEAKEN_ELECTRIC;
      worked = true;
    }
  } else if (!(g.statuses3[atk] & K.STATUS3_WATERSPORT)) {
    g.statuses3[atk] |= K.STATUS3_WATERSPORT;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_WEAKEN_FIRE;
    worked = true;
  }
  if (worked) adv(5);
  else g.battlescriptCurrInstr = w(1);
}

export function Cmd_setweatherballtype(): void {
  if (weatherHasEffect()) {
    if (g.battleWeather & K.B_WEATHER_ANY) g.battleScripting.dmgMultiplier = 2;
    let t: number;
    if (g.battleWeather & K.B_WEATHER_RAIN) t = K.TYPE_WATER;
    else if (g.battleWeather & K.B_WEATHER_SANDSTORM) t = K.TYPE_ROCK;
    else if (g.battleWeather & K.B_WEATHER_SUN) t = K.TYPE_FIRE;
    else if (g.battleWeather & K.B_WEATHER_HAIL) t = K.TYPE_ICE;
    else t = K.TYPE_NORMAL;
    g.battleStruct.dynamicMoveType = t | K.F_DYNAMIC_TYPE_2;
  }
  adv(1);
}

export function Cmd_tryrecycleitem(): void {
  const ab = (g.activeBattler = g.battlerAttacker);
  const used = g.battleStruct.usedHeldItems;
  if (used[ab] !== K.ITEM_NONE && g.battleMons[ab].item === K.ITEM_NONE) {
    g.lastUsedItem = used[ab];
    used[ab] = K.ITEM_NONE;
    g.battleMons[ab].item = g.lastUsedItem;
    emitSetMonData(K.BUFFER_A, K.REQUEST_HELDITEM_BATTLE, 0, u16(g.battleMons[ab].item));
    markBattlerForControllerExec(ab);
    adv(5);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_settypetoterrain(): void {
  const type = mech().sTerrainToType[g.battleTerrain];
  if (!isBattlerOfType(g.battlerAttacker, type)) {
    setBattlerType(g.battlerAttacker, type);
    prepareTypeBuffer(g.battleTextBuff1, type);
    adv(5);
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

/** Unused */
export function Cmd_pursuitdoubles(): void {
  const ab = (g.activeBattler = getBattlerAtPosition(getBattlerPosition(g.battlerAttacker) ^ K.BIT_FLANK));
  if (
    g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE &&
    !(g.absentBattlerFlags & bit(ab)) &&
    g.chosenActionByBattler[ab] === K.B_ACTION_USE_MOVE &&
    g.chosenMoveByBattler[ab] === K.MOVE_PURSUIT
  ) {
    g.actionsByTurnOrder[ab] = K.B_ACTION_TRY_FINISH;
    g.currentMove = K.MOVE_PURSUIT;
    adv(5);
    g.battleScripting.animTurn = 1;
    g.battleScripting.pursuitDoublesAttacker = g.battlerAttacker;
    g.battlerAttacker = ab;
  } else {
    g.battlescriptCurrInstr = w(1);
  }
}

export function Cmd_snatchsetbattlers(): void {
  g.effectBattler = g.battlerAttacker;
  if (g.battlerAttacker === g.battlerTarget) g.battlerAttacker = g.battlerTarget = g.battleScripting.battler;
  else g.battlerTarget = g.battleScripting.battler;
  g.battleScripting.battler = g.effectBattler;
  adv(1);
}

/** Brick Break */
export function Cmd_removelightscreenreflect(): void {
  const opposingSide = getBattlerSide(g.battlerAttacker) ^ K.BIT_SIDE;
  const st = g.sideTimers[opposingSide];
  if (st.reflectTimer || st.lightscreenTimer) {
    g.sideStatuses[opposingSide] &= ~K.SIDE_STATUS_REFLECT;
    g.sideStatuses[opposingSide] &= ~K.SIDE_STATUS_LIGHTSCREEN;
    st.reflectTimer = 0;
    st.lightscreenTimer = 0;
    g.battleScripting.animTurn = 1;
    g.battleScripting.animTargetsHit = 1;
  } else {
    g.battleScripting.animTurn = 0;
    g.battleScripting.animTargetsHit = 0;
  }
  adv(1);
}

/** Sqrt (math_util): integer square root */
function isqrt(n: number): number {
  return Math.floor(Math.sqrt(n));
}

export function Cmd_handleballthrow(): void {
  if (g.battleControllerExecFlags) return;
  g.activeBattler = g.battlerAttacker;
  g.battlerTarget = g.battlerAttacker ^ K.BIT_SIDE;
  const tgt = g.battlerTarget;
  const throwAnim = (caseId: number) => {
    emitBallThrowAnim(K.BUFFER_A, caseId);
    markBattlerForControllerExec(g.activeBattler);
  };
  const caught = () => {
    g.battlescriptCurrInstr = bs('BattleScript_SuccessBallThrow');
    g.enemyParty[g.battlerPartyIndexes[tgt]]!.pokeball = g.lastUsedItem;
    g.battleCommunication[K.MULTISTRING_CHOOSER] = g.playerParty.filter((m) => m).length === K.PARTY_SIZE ? 0 : 1;
  };
  if (g.battleTypeFlags & K.BATTLE_TYPE_GHOST) {
    throwAnim(K.BALL_GHOST_DODGE);
    g.battlescriptCurrInstr = bs('BattleScript_GhostBallDodge');
  } else if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER) {
    throwAnim(K.BALL_TRAINER_BLOCK);
    g.battlescriptCurrInstr = bs('BattleScript_TrainerBallBlock');
  } else if (g.battleTypeFlags & (K.BATTLE_TYPE_POKEDUDE | K.BATTLE_TYPE_OLD_MAN_TUTORIAL)) {
    throwAnim(K.BALL_3_SHAKES_SUCCESS);
    g.battlescriptCurrInstr = bs('BattleScript_OldMan_Pokedude_CaughtMessage');
  } else {
    const t = g.battleMons[tgt];
    const ball = g.lastUsedItem;
    const catchRate = ball === K.ITEM_SAFARI_BALL ? Math.trunc((g.battleStruct.safariCatchFactor * 1275) / 100) & 0xff : gSpeciesInfo[t.species].catchRate;
    let ballMultiplier = 0;
    if (ball > K.ITEM_SAFARI_BALL) {
      switch (ball) {
        case K.ITEM_NET_BALL:
          ballMultiplier = isBattlerOfType(tgt, K.TYPE_WATER) || isBattlerOfType(tgt, K.TYPE_BUG) ? 30 : 10;
          break;
        case K.ITEM_DIVE_BALL:
          ballMultiplier = g.mapType === K.MAP_TYPE_UNDERWATER ? 35 : 10;
          break;
        case K.ITEM_NEST_BALL:
          if (t.level < 40) {
            ballMultiplier = 40 - t.level;
            if (ballMultiplier <= 9) ballMultiplier = 10;
          } else ballMultiplier = 10;
          break;
        case K.ITEM_REPEAT_BALL:
          ballMultiplier = state.dexCaught.has(speciesToNationalPokedexNum(t.species)) ? 30 : 10;
          break;
        case K.ITEM_TIMER_BALL:
          ballMultiplier = g.battleResults.battleTurnCounter + 10;
          if (ballMultiplier > 40) ballMultiplier = 40;
          break;
        case K.ITEM_LUXURY_BALL:
        case K.ITEM_PREMIER_BALL:
          ballMultiplier = 10;
          break;
      }
    } else {
      ballMultiplier = mech().sBallCatchBonuses[ball - K.ITEM_ULTRA_BALL];
    }
    let odds = Math.trunc((Math.trunc((catchRate * ballMultiplier) / 10) * (t.maxHP * 3 - t.hp * 2)) / (3 * t.maxHP));
    if (t.status1 & (K.STATUS1_SLEEP | K.STATUS1_FREEZE)) odds *= 2;
    if (t.status1 & (K.STATUS1_POISON | K.STATUS1_BURN | K.STATUS1_PARALYSIS | K.STATUS1_TOXIC_POISON)) odds = Math.trunc((odds * 15) / 10);
    if (ball !== K.ITEM_SAFARI_BALL) {
      if (ball === K.ITEM_MASTER_BALL) g.battleResults.usedMasterBall = 1;
      else if (g.battleResults.catchAttempts[ball - K.ITEM_ULTRA_BALL] < 255) g.battleResults.catchAttempts[ball - K.ITEM_ULTRA_BALL]++;
    }
    if (odds > 254) {
      // mon caught
      throwAnim(K.BALL_3_SHAKES_SUCCESS);
      caught();
    } else {
      // mon may be caught, calculate shakes
      odds = isqrt(isqrt(Math.trunc(16711680 / odds)));
      odds = Math.trunc(1048560 / odds);
      let shakes = 0;
      for (; shakes < K.BALL_3_SHAKES_SUCCESS && random() < odds; shakes++);
      if (ball === K.ITEM_MASTER_BALL) shakes = K.BALL_3_SHAKES_SUCCESS; // why calculate the shakes before that check?
      throwAnim(shakes);
      if (shakes === K.BALL_3_SHAKES_SUCCESS) {
        caught();
      } else {
        g.battleCommunication[K.MULTISTRING_CHOOSER] = shakes;
        g.battlescriptCurrInstr = bs('BattleScript_ShakeBallThrow');
      }
    }
  }
}

export function Cmd_givecaughtmon(): void {
  const idx = g.battlerPartyIndexes[g.battlerAttacker ^ K.BIT_SIDE];
  const mon = g.enemyParty[idx]!;
  if (state.giveMon(mon) !== K.MON_GIVEN_TO_PARTY) {
    const boxName = (boxId: number) => state.storage.getBoxName(boxId) ?? []; // GetBoxNamePtr
    if (!state.shouldShowBoxWasFullMessage()) {
      g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_SENT_SOMEONES_PC;
      state.stringVars[0] = [...boxName(state.getVar('VAR_PC_BOX_TO_SEND_MON'))];
      state.stringVars[1] = [...mon.nickname];
    } else {
      state.stringVars[0] = [...boxName(state.getVar('VAR_PC_BOX_TO_SEND_MON'))]; // box the mon was sent to
      state.stringVars[1] = [...mon.nickname];
      state.stringVars[2] = [...boxName(state.getPCBoxToSendMon())]; // box the mon was going to be sent to
      g.battleCommunication[K.MULTISTRING_CHOOSER] = K.B_MSG_SOMEONES_BOX_FULL;
    }
    // Change to B_MSG_SENT_BILLS_PC or B_MSG_BILLS_BOX_FULL
    if (state.getFlag('FLAG_SYS_NOT_SOMEONES_PC')) g.battleCommunication[K.MULTISTRING_CHOOSER]++;
  }
  g.battleResults.caughtMonSpecies = g.battleMons[g.battlerAttacker ^ K.BIT_SIDE].species;
  g.battleResults.caughtMonNick = [...mon.nickname];
  adv(1);
}

export function Cmd_trysetcaughtmondexflags(): void {
  const mon = g.enemyParty[0]!;
  const dex = speciesToNationalPokedexNum(mon.species);
  if (state.dexCaught.has(dex)) {
    g.battlescriptCurrInstr = w(1);
  } else {
    handleSetPokedexFlag(dex, K.FLAG_SET_CAUGHT);
    adv(5);
  }
}

/** Cmd_displaydexinfo: the "registered in the Pokédex" page (menus/pokedexScreen.ts), then the battle redrawn */
export function Cmd_displaydexinfo(): void {
  const species = g.enemyParty[0]!.species;
  const mc = g.battleCommunication;
  switch (mc[0]) {
    case 0:
      BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_WHITE);
      mc[0]++;
      break;
    case 1:
      if (!gPaletteFade.active) {
        FreeAllWindowBuffers();
        mc[K.TASK_ID] = DexScreen_RegisterMonToPokedex(species);
        mc[0]++;
      }
      break;
    case 2:
      if (!gPaletteFade.active && gMain.callback2 === BattleMainCB2 && !gTasks[mc[K.TASK_ID]].isActive) {
        vram.fill(0); // CpuFill32(0, (void *)VRAM, VRAM_SIZE)
        SetVBlankCallback(VBlankCB_Battle);
        mc[0]++;
      }
      break;
    case 3:
      InitBattleBgsVideo();
      LoadBattleTextboxAndBackground();
      g.battle_BG3_X = 256;
      mc[0]++;
      break;
    case 4:
      if (!IsDma3ManagerBusyWithBgCopy()) {
        const opp = g.battleMons[K.B_POSITION_OPPONENT_LEFT];
        CreateMonPicSprite_HandleDeoxys(species, opp.otId >>> 0, opp.personality >>> 0, true, 120, 64, 0, 0xffff);
        gPlttBufferFaded.fill(0, 0, 0x100); // CpuFill32(0, gPlttBufferFaded, BG_PLTT_SIZE): the 256 BG colours
        BeginNormalPaletteFade(0x1ffff, 0, 16, 0, RGB_BLACK);
        ShowBg(0);
        ShowBg(3);
        mc[0]++;
      }
      break;
    case 5:
      if (!gPaletteFade.active) adv(1);
      break;
  }
}

export function Cmd_trygivecaughtmonnick(): void {
  const mc = g.battleCommunication;
  switch (mc[K.MULTIUSE_STATE]) {
    case 0:
      HandleBattleWindow(23, 8, 29, 13, 0);
      BattlePutTextOnWindow(encodeBattleText('gText_BattleYesNoChoice'), K.B_WIN_YESNO);
      mc[K.MULTIUSE_STATE]++;
      mc[K.CURSOR_POSITION] = 0;
      BattleCreateYesNoCursorAt(0);
      break;
    case 1:
      if (ui.joyNew('UP') && mc[K.CURSOR_POSITION] !== 0) {
        ui.playSE(K.SE_SELECT);
        BattleDestroyYesNoCursorAt(mc[K.CURSOR_POSITION]);
        mc[K.CURSOR_POSITION] = 0;
        BattleCreateYesNoCursorAt(0);
      }
      if (ui.joyNew('DOWN') && mc[K.CURSOR_POSITION] === 0) {
        ui.playSE(K.SE_SELECT);
        BattleDestroyYesNoCursorAt(mc[K.CURSOR_POSITION]);
        mc[K.CURSOR_POSITION] = 1;
        BattleCreateYesNoCursorAt(1);
      }
      if (ui.joyNew('A')) {
        ui.playSE(K.SE_SELECT);
        if (mc[K.CURSOR_POSITION] === 0) {
          mc[K.MULTIUSE_STATE]++;
          BeginFastPaletteFade(FAST_FADE_OUT_TO_BLACK);
        } else {
          mc[K.MULTIUSE_STATE] = 4;
        }
      } else if (ui.joyNew('B')) {
        ui.playSE(K.SE_SELECT);
        mc[K.MULTIUSE_STATE] = 4;
      }
      break;
    case 2:
      if (!gPaletteFade.active) {
        const mon = g.enemyParty[g.battlerPartyIndexes[g.battlerAttacker ^ K.BIT_SIDE]]!;
        g.battleStruct.caughtMonNick = [...mon.nickname, K.EOS];
        FreeAllWindowBuffers();
        DoNamingScreen(K.NAMING_SCREEN_CAUGHT_MON, g.battleStruct.caughtMonNick, mon.species, pokemon.gender(mon), mon.personality, BattleMainCB2);
        mc[K.MULTIUSE_STATE]++;
      }
      break;
    case 3:
      if (gMain.callback2 === BattleMainCB2 && !gPaletteFade.active) {
        const mon = g.enemyParty[g.battlerPartyIndexes[g.battlerAttacker ^ K.BIT_SIDE]]!;
        const nick = g.battleStruct.caughtMonNick;
        mon.nickname = nick.slice(0, nick.indexOf(K.EOS)); // SetMonData(MON_DATA_NICKNAME)
        g.battlescriptCurrInstr = w(1);
      }
      break;
    case 4:
      if (g.playerParty.filter((m) => m).length === K.PARTY_SIZE) adv(5);
      else g.battlescriptCurrInstr = w(1);
      break;
  }
}

export function Cmd_subattackerhpbydmg(): void {
  const m = g.battleMons[g.battlerAttacker];
  m.hp = (m.hp - g.battleMoveDamage) & 0xffff;
  adv(1);
}

export function Cmd_removeattackerstatus1(): void {
  g.battleMons[g.battlerAttacker].status1 = 0;
  adv(1);
}

export function Cmd_finishaction(): void {
  g.currentActionFuncId = K.B_ACTION_FINISHED;
}

export function Cmd_finishturn(): void {
  g.currentActionFuncId = K.B_ACTION_FINISHED;
  g.currentTurnActionNumber = g.battlersCount;
}
