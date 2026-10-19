// battle_script_commands.c, part 2: Cmd_getexp (0x23) .. Cmd_returntoball (0x58).

import { recordAbilityBattle } from './ai';
import { adv, b, compare, h, typeAtk, typeDef, typeMul, w } from './bsCommands1';
import { K } from './constants';
import { PlayBGM } from '../gba/sound';
import { HandleLowHpMusicChange } from './gfx';
import {
  emitBattleAnimation,
  emitCantSwitch,
  emitChoosePokemon,
  emitEndLinkBattle,
  emitExpUpdate,
  emitFaintingCry,
  emitGetMonData,
  emitHealthBarUpdate,
  emitLinkStandbyMsg,
  emitPlayFanfare,
  emitPlaySE,
  emitReturnMonToBall,
  emitSetMonData,
  emitSpriteInvisibility,
  emitSwitchInAnim,
  emitTrainerSlide,
  markBattlerForControllerExec,
  u32,
} from './controllers';
import { g, gBattleMoves, gSpeciesInfo, itemHoldEffect, mem, pokemon } from './env';
import { bit } from './globals';
import { switchInClearSetData, updatePartyOwnerOnSwitch_NonMulti } from './main';
import {
  adjustFriendship,
  getAbilityBySpecies,
  handleSetPokedexFlag,
  isOtherTrainer,
  monGainEVs,
  speciesToNationalPokedexNum,
} from './pokemonBattle';
import type { BattlePokemon } from './structs';
import {
  prepareByteNumberBuffer,
  prepareMonNickBuffer,
  prepareMonNickWithPrefixBuffer,
  prepareSpeciesBuffer,
  prepareStringBuffer,
  prepareWordNumberBuffer,
} from './textBuffers';
import {
  abilityBattleEffects,
  battleScriptPop,
  battleScriptPush,
  battleScriptPushCursor,
  bs,
  getBattlerAtPosition,
  getBattlerForBattleScript,
  getBattlerPosition,
  getBattlerSide,
  getMoveType,
  hasNoMonsToSwitch,
  isBattlerOfType,
  itemBattleEffects,
  prepareStringBattle,
  targetTurnDamaged,
  updateSentPokesToOpponentValue,
  wasUnableToUseMove,
} from './util';

export { attacksThisTurn, changeStatBuffs, isTwoTurnsMove, trySetDestinyBondToHappen } from './bsCommands3';

const hitmarkerFainted = (battler: number) => (bit(battler) << 28) >>> 0;

/** IsTradedMon */
function isTradedMon(partyIndex: number): boolean {
  const mon = g.playerParty[partyIndex]!;
  return isOtherTrainer(mon.otId, [...pokemon.encodeName(mon.otName), 0xff]);
}

export function Cmd_getexp(): void {
  const bst = g.battleStruct;
  const scr = g.battleScripting;
  g.battlerFainted = getBattlerForBattleScript(b(1));
  const fainted = g.battlerFainted;
  const sentIn = g.sentPokesToOpponent[(fainted & 2) >> 1];
  const party = g.playerParty;

  const heldEffect = (i: number) => itemHoldEffect(party[i]?.heldItem ?? 0); // enigma berry: gSaveBlock1Ptr->enigmaBerry (none)

  switch (scr.getexpState) {
    case 0: // check if should receive exp at all
      if (
        getBattlerSide(fainted) !== K.B_SIDE_OPPONENT ||
        g.battleTypeFlags & (K.BATTLE_TYPE_LINK | K.BATTLE_TYPE_TRAINER_TOWER | K.BATTLE_TYPE_BATTLE_TOWER | K.BATTLE_TYPE_SAFARI | K.BATTLE_TYPE_EREADER_TRAINER)
      ) {
        scr.getexpState = 6; // goto last case
      } else {
        scr.getexpState++;
        bst.givenExpMons |= bit(g.battlerPartyIndexes[fainted]);
      }
      break;
    case 1: // calculate experience points to redistribute
    case 2:
      if (scr.getexpState === 1) {
        let viaSentIn = 0;
        let viaExpShare = 0;
        for (let i = 0; i < K.PARTY_SIZE; i++) {
          if (!party[i] || party[i]!.species === K.SPECIES_NONE || party[i]!.hp === 0) continue;
          if (bit(i) & sentIn) viaSentIn++;
          if (heldEffect(i) === K.HOLD_EFFECT_EXP_SHARE) viaExpShare++;
        }
        const calculatedExp = Math.trunc((gSpeciesInfo[g.battleMons[fainted].species].expYield * g.battleMons[fainted].level) / 7) & 0xffff;
        if (viaExpShare) {
          // at least one mon is getting exp via exp share
          bst.expValue = viaSentIn ? Math.trunc(Math.trunc(calculatedExp / 2) / viaSentIn) : 0;
          if (bst.expValue === 0) bst.expValue = 1;
          g.expShareExp = Math.trunc(Math.trunc(calculatedExp / 2) / viaExpShare);
          if (g.expShareExp === 0) g.expShareExp = 1;
        } else {
          bst.expValue = viaSentIn ? Math.trunc(calculatedExp / viaSentIn) : 0;
          if (bst.expValue === 0) bst.expValue = 1;
          g.expShareExp = 0;
        }
        scr.getexpState++;
        bst.expGetterMonId = 0;
        bst.sentInPokes = sentIn;
      }
      // fall through: set exp value to the poke in expgetter_id and print message
      if (g.battleControllerExecFlags === 0) {
        const id = bst.expGetterMonId;
        const holdEffect = heldEffect(id);
        if (holdEffect !== K.HOLD_EFFECT_EXP_SHARE && !(bst.sentInPokes & 1)) {
          bst.sentInPokes >>= 1;
          scr.getexpState = 5;
          g.battleMoveDamage = 0; // used for exp
        } else if (party[id]?.level === K.MAX_LEVEL) {
          bst.sentInPokes >>= 1;
          scr.getexpState = 5;
          g.battleMoveDamage = 0;
        } else {
          // music change in wild battle after fainting a poke
          if (!(g.battleTypeFlags & (K.BATTLE_TYPE_TRAINER | K.BATTLE_TYPE_POKEDUDE)) && g.battleMons[0].hp !== 0 && !bst.wildVictorySong) {
            // TODO(W-sound 6a): BattleStopLowHpSound (battle_gfx_sfx_util.c, battle/gfx.ts)
            PlayBGM(K.MUS_VICTORY_WILD);
            bst.wildVictorySong++;
          }
          if (party[id]?.hp) {
            g.battleMoveDamage = bst.sentInPokes & 1 ? bst.expValue : 0;
            if (holdEffect === K.HOLD_EFFECT_EXP_SHARE) g.battleMoveDamage += g.expShareExp;
            if (holdEffect === K.HOLD_EFFECT_LUCKY_EGG) g.battleMoveDamage = Math.trunc((g.battleMoveDamage * 150) / 100);
            if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER) g.battleMoveDamage = Math.trunc((g.battleMoveDamage * 150) / 100);
            let stringId: number;
            if (isTradedMon(id) && !(g.battleTypeFlags & K.BATTLE_TYPE_POKEDUDE)) {
              g.battleMoveDamage = Math.trunc((g.battleMoveDamage * 150) / 100);
              stringId = K.STRINGID_ABOOSTED;
            } else {
              stringId = K.STRINGID_EMPTYSTRING4;
            }
            // get exp getter battlerId
            if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
              if (g.battlerPartyIndexes[2] === id && !(g.absentBattlerFlags & bit(2))) bst.expGetterBattlerId = 2;
              else bst.expGetterBattlerId = !(g.absentBattlerFlags & bit(0)) ? 0 : 2;
            } else {
              bst.expGetterBattlerId = 0;
            }
            prepareMonNickWithPrefixBuffer(g.battleTextBuff1, bst.expGetterBattlerId, id);
            // buffer 'gained' or 'gained a boosted'
            prepareStringBuffer(g.battleTextBuff2, stringId);
            prepareWordNumberBuffer(g.battleTextBuff3, 5, g.battleMoveDamage);
            prepareStringBattle(K.STRINGID_PKMNGAINEDEXP, bst.expGetterBattlerId);
            monGainEVs(party[id]!, g.battleMons[fainted].species);
          }
          bst.sentInPokes >>= 1;
          scr.getexpState++;
        }
      }
      break;
    case 3: // Set stats and give exp
      if (g.battleControllerExecFlags === 0) {
        g.battleBufferB[bst.expGetterBattlerId][0] = 0;
        const mon = party[bst.expGetterMonId];
        if (mon?.hp && mon.level !== K.MAX_LEVEL) {
          const s = g.battleResources.beforeLvlUp;
          s[K.STAT_HP] = mon.maxHP;
          s[K.STAT_ATK] = mon.stats.attack;
          s[K.STAT_DEF] = mon.stats.defense;
          s[K.STAT_SPEED] = mon.stats.speed;
          s[K.STAT_SPATK] = mon.stats.spAttack;
          s[K.STAT_SPDEF] = mon.stats.spDefense;
          g.activeBattler = bst.expGetterBattlerId;
          emitExpUpdate(K.BUFFER_A, bst.expGetterMonId, g.battleMoveDamage);
          markBattlerForControllerExec(g.activeBattler);
        }
        scr.getexpState++;
      }
      break;
    case 4: // lvl up if necessary
      if (g.battleControllerExecFlags === 0) {
        const ab = (g.activeBattler = bst.expGetterBattlerId);
        const bufB = g.battleBufferB[ab];
        if (bufB[0] === K.CONTROLLER_TWORETURNVALUES && bufB[1] === K.RET_VALUE_LEVELED_UP) {
          const id = bst.expGetterMonId;
          const mon = party[id]!;
          if (g.battleTypeFlags & K.BATTLE_TYPE_TRAINER && g.battlerPartyIndexes[ab] === id) HandleLowHpMusicChange(mon, ab);
          prepareMonNickWithPrefixBuffer(g.battleTextBuff1, ab, id);
          prepareByteNumberBuffer(g.battleTextBuff2, 3, mon.level);
          battleScriptPushCursor();
          g.leveledUpInBattle |= bit(id);
          g.battlescriptCurrInstr = bs('BattleScript_LevelUp');
          g.battleMoveDamage = bufB[2] | (bufB[3] << 8);
          adjustFriendship(mon, K.FRIENDSHIP_EVENT_GROW_LEVEL);
          // update battle mon structure after level up
          if (g.battlerPartyIndexes[0] === id && g.battleMons[0].hp) {
            const bm = g.battleMons[0];
            bm.level = mon.level;
            bm.hp = mon.hp;
            bm.maxHP = mon.maxHP;
            bm.attack = mon.stats.attack;
            bm.defense = mon.stats.defense;
            bm.speed = mon.stats.speed; // Speed is duplicated, likely due to a copy-paste error.
            bm.spAttack = mon.stats.spAttack;
            bm.spDefense = mon.stats.spDefense;
          }
          // What is else if?
          if (g.battlerPartyIndexes[2] === id && g.battleMons[2].hp && g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
            const bm = g.battleMons[2];
            bm.level = mon.level;
            bm.hp = mon.hp;
            bm.maxHP = mon.maxHP;
            bm.attack = mon.stats.attack;
            bm.defense = mon.stats.defense;
            bm.speed = mon.stats.speed; // Speed is duplicated again, but Special Defense is missing.
            bm.spAttack = mon.stats.spAttack;
          }
          scr.getexpState = 5;
        } else {
          g.battleMoveDamage = 0;
          scr.getexpState = 5;
        }
      }
      break;
    case 5: // looper increment
      if (g.battleMoveDamage) {
        // there is exp to give, goto case 3 that gives exp
        scr.getexpState = 3;
      } else {
        bst.expGetterMonId++;
        scr.getexpState = bst.expGetterMonId < K.PARTY_SIZE ? 2 : 6;
      }
      break;
    case 6: // increment instruction
      if (g.battleControllerExecFlags === 0) {
        // not sure why gf clears the item and ability here
        g.battleMons[fainted].item = K.ITEM_NONE;
        g.battleMons[fainted].ability = K.ABILITY_NONE;
        adv(2);
      }
      break;
  }
}

/** For non-link battles: total each team's HP and set gBattleOutcome. */
export function Cmd_checkteamslost(): void {
  if (g.battleControllerExecFlags) return;
  const hpOf = (party: typeof g.playerParty) =>
    party.reduce((n, m) => (m && m.species && !m.isEgg ? (n + m.hp) & 0xffff : n), 0);
  if (hpOf(g.playerParty) === 0) g.battleOutcome |= K.B_OUTCOME_LOST;
  if (hpOf(g.enemyParty) === 0) g.battleOutcome |= K.B_OUTCOME_WON;
  // The link-battle empty-spot check only applies to BATTLE_TYPE_LINK.
  adv(5);
}

/** MoveValuesCleanUp */
export function moveValuesCleanUp(): void {
  g.moveResultFlags = 0;
  g.battleScripting.dmgMultiplier = 1;
  g.critMultiplier = 1;
  g.battleCommunication[K.MOVE_EFFECT_BYTE] = 0;
  g.battleCommunication[K.MISS_TYPE] = 0;
  g.hitMarker &= ~K.HITMARKER_DESTINYBOND;
  g.hitMarker &= ~K.HITMARKER_SYNCHRONISE_EFFECT;
}

export function Cmd_movevaluescleanup(): void {
  moveValuesCleanUp();
  adv(1);
}

export function Cmd_setmultihit(): void {
  g.multiHitCounter = b(1);
  adv(2);
}

export function Cmd_decrementmultihit(): void {
  g.multiHitCounter = (g.multiHitCounter - 1) & 0xff;
  if (g.multiHitCounter === 0) adv(5);
  else g.battlescriptCurrInstr = w(1);
}

export function Cmd_goto(): void {
  g.battlescriptCurrInstr = w(1);
}

export function Cmd_jumpifbyte(): void {
  const caseID = b(1);
  const memByte = w(2);
  const value = b(6);
  const jumpPtr = w(7);
  adv(11);
  if (compare(caseID, mem.u8(memByte), value)) g.battlescriptCurrInstr = jumpPtr;
}

export function Cmd_jumpifhalfword(): void {
  const caseID = b(1);
  const memHword = w(2);
  const value = h(6);
  const jumpPtr = w(8);
  adv(12);
  if (compare(caseID, mem.u16(memHword), value)) g.battlescriptCurrInstr = jumpPtr;
}

export function Cmd_jumpifword(): void {
  const caseID = b(1);
  const memWord = w(2);
  const value = w(6);
  const jumpPtr = w(10);
  adv(14);
  const v = mem.u32(memWord);
  // compare() works on JS numbers; mask bit tests to u32
  const ok =
    caseID === K.CMP_COMMON_BITS ? (v & value) >>> 0 !== 0 : caseID === K.CMP_NO_COMMON_BITS ? (v & value) >>> 0 === 0 : compare(caseID, v, value);
  if (ok) g.battlescriptCurrInstr = jumpPtr;
}

export function Cmd_jumpifarrayequal(): void {
  const mem1 = w(1);
  const mem2 = w(5);
  const size = b(9);
  const jumpPtr = w(10);
  let i = 0;
  for (; i < size; i++) {
    if (mem.u8(mem1 + i) !== mem.u8(mem2 + i)) {
      adv(14);
      break;
    }
  }
  if (i === size) g.battlescriptCurrInstr = jumpPtr;
}

export function Cmd_jumpifarraynotequal(): void {
  let equalBytes = 0;
  const mem1 = w(1);
  const mem2 = w(5);
  const size = b(9);
  const jumpPtr = w(10);
  for (let i = 0; i < size; i++) if (mem.u8(mem1 + i) === mem.u8(mem2 + i)) equalBytes++;
  if (equalBytes !== size) g.battlescriptCurrInstr = jumpPtr;
  else adv(14);
}

export function Cmd_setbyte(): void {
  mem.setU8(w(1), b(5));
  adv(6);
}

export function Cmd_addbyte(): void {
  const p = w(1);
  mem.setU8(p, mem.u8(p) + b(5));
  adv(6);
}

export function Cmd_subbyte(): void {
  const p = w(1);
  mem.setU8(p, mem.u8(p) - b(5));
  adv(6);
}

export function Cmd_copyarray(): void {
  const dest = w(1);
  const src = w(5);
  const size = b(9);
  for (let i = 0; i < size; i++) mem.setU8(dest + i, mem.u8(src + i));
  adv(10);
}

export function Cmd_copyarraywithindex(): void {
  const dest = w(1);
  const src = w(5);
  const index = mem.u8(w(9));
  const size = b(13);
  for (let i = 0; i < size; i++) mem.setU8(dest + i, mem.u8(src + i + index));
  adv(14);
}

export function Cmd_orbyte(): void {
  const p = w(1);
  mem.setU8(p, mem.u8(p) | b(5));
  adv(6);
}

export function Cmd_orhalfword(): void {
  const p = w(1);
  mem.setU16(p, mem.u16(p) | h(5));
  adv(7);
}

export function Cmd_orword(): void {
  const p = w(1);
  mem.setU32(p, mem.u32(p) | w(5));
  adv(9);
}

export function Cmd_bicbyte(): void {
  const p = w(1);
  mem.setU8(p, mem.u8(p) & ~b(5));
  adv(6);
}

export function Cmd_bichalfword(): void {
  const p = w(1);
  mem.setU16(p, mem.u16(p) & ~h(5));
  adv(7);
}

export function Cmd_bicword(): void {
  const p = w(1);
  mem.setU32(p, mem.u32(p) & ~w(5));
  adv(9);
}

export function Cmd_pause(): void {
  if (g.battleControllerExecFlags === 0) {
    const value = h(1);
    if (++g.pauseCounterBattle >= value) {
      g.pauseCounterBattle = 0;
      adv(3);
    }
  }
}

export function Cmd_waitstate(): void {
  if (g.battleControllerExecFlags === 0) adv(1);
}

export function Cmd_healthbar_update(): void {
  g.activeBattler = b(1) === K.BS_TARGET ? g.battlerTarget : g.battlerAttacker;
  emitHealthBarUpdate(K.BUFFER_A, g.battleMoveDamage);
  markBattlerForControllerExec(g.activeBattler);
  adv(2);
}

export function Cmd_return(): void {
  battleScriptPop();
}

export function Cmd_end(): void {
  g.moveResultFlags = 0;
  g.activeBattler = 0;
  g.currentActionFuncId = K.B_ACTION_TRY_FINISH;
}

export function Cmd_end2(): void {
  g.activeBattler = 0;
  g.currentActionFuncId = K.B_ACTION_TRY_FINISH;
}

/** Pops the main function stack */
export function Cmd_end3(): void {
  battleScriptPop();
  const cb = g.battleResources.battleCallbackStack;
  if (cb.size !== 0) cb.size--;
  g.battleMainFunc = cb.function[cb.size];
}

export function Cmd_call(): void {
  battleScriptPush(g.battlescriptCurrInstr + 5);
  g.battlescriptCurrInstr = w(1);
}

export function Cmd_jumpiftype2(): void {
  const battlerId = getBattlerForBattleScript(b(1));
  if (b(2) === g.battleMons[battlerId].type1 || b(2) === g.battleMons[battlerId].type2) g.battlescriptCurrInstr = w(3);
  else adv(7);
}

export function Cmd_jumpifabilitypresent(): void {
  if (abilityBattleEffects(K.ABILITYEFFECT_CHECK_ON_FIELD, 0, b(1), 0, 0)) g.battlescriptCurrInstr = w(2);
  else adv(6);
}

export function Cmd_endselectionscript(): void {
  g.battleStruct.selectionScriptFinished[g.battlerAttacker] = 1;
}

export function Cmd_playanimation(): void {
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  const anim = b(2);
  const argPtr = w(3);
  const arg = argPtr ? mem.u16(argPtr) : 0;
  const play = () => {
    emitBattleAnimation(K.BUFFER_A, anim, arg);
    markBattlerForControllerExec(ab);
    adv(7);
  };
  if (anim === K.B_ANIM_STATS_CHANGE || anim === K.B_ANIM_SNATCH_MOVE || anim === K.B_ANIM_SUBSTITUTE_FADE || anim === K.B_ANIM_SILPH_SCOPED) {
    play();
  } else if (g.hitMarker & K.HITMARKER_NO_ANIMATIONS) {
    battleScriptPush(g.battlescriptCurrInstr + 7);
    g.battlescriptCurrInstr = bs('BattleScript_Pausex20');
  } else if (anim === K.B_ANIM_RAIN_CONTINUES || anim === K.B_ANIM_SUN_CONTINUES || anim === K.B_ANIM_SANDSTORM_CONTINUES || anim === K.B_ANIM_HAIL_CONTINUES) {
    play();
  } else if (g.statuses3[ab] & K.STATUS3_SEMI_INVULNERABLE) {
    adv(7);
  } else {
    play();
  }
}

/** Same as playanimation, except it takes a pointer to some animation id */
export function Cmd_playanimation_var(): void {
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  const anim = mem.u8(w(2));
  const argPtr = w(6);
  const arg = argPtr ? mem.u16(argPtr) : 0;
  const play = () => {
    emitBattleAnimation(K.BUFFER_A, anim, arg);
    markBattlerForControllerExec(ab);
    adv(10);
  };
  if (anim === K.B_ANIM_STATS_CHANGE || anim === K.B_ANIM_SNATCH_MOVE || anim === K.B_ANIM_SUBSTITUTE_FADE) play();
  else if (g.hitMarker & K.HITMARKER_NO_ANIMATIONS) adv(10);
  else if (anim === K.B_ANIM_RAIN_CONTINUES || anim === K.B_ANIM_SUN_CONTINUES || anim === K.B_ANIM_SANDSTORM_CONTINUES || anim === K.B_ANIM_HAIL_CONTINUES)
    play();
  else if (g.statuses3[ab] & K.STATUS3_SEMI_INVULNERABLE) adv(10);
  else play();
}

const SET_STAT_BUFF_VALUE = (n: number) => (n << 4) & 0xf0;

export function Cmd_setgraphicalstatchangevalues(): void {
  let value = 0;
  const sc = g.battleScripting.statChanger;
  switch (sc & 0xf0) {
    case SET_STAT_BUFF_VALUE(1): // +1
      value = K.STAT_ANIM_PLUS1;
      break;
    case SET_STAT_BUFF_VALUE(2): // +2
      value = K.STAT_ANIM_PLUS2;
      break;
    case SET_STAT_BUFF_VALUE(1) | K.STAT_BUFF_NEGATIVE: // -1
      value = K.STAT_ANIM_MINUS1;
      break;
    case SET_STAT_BUFF_VALUE(2) | K.STAT_BUFF_NEGATIVE: // -2
      value = K.STAT_ANIM_MINUS2;
      break;
  }
  g.battleScripting.animArg1 = (sc & 0xf) + value - 1;
  g.battleScripting.animArg2 = 0;
  adv(1);
}

export function Cmd_playstatchangeanimation(): void {
  let currStat = 0;
  let statAnimId = 0;
  let changeableStatsCount = 0;
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  let statsToCheck = b(2);
  const flags = b(3);
  const m = g.battleMons[ab];
  if (flags & K.STAT_CHANGE_NEGATIVE) {
    // goes down
    const start = flags & K.STAT_CHANGE_BY_TWO ? K.STAT_ANIM_MINUS2 - 1 : K.STAT_ANIM_MINUS1 - 1;
    while (statsToCheck !== 0) {
      if (statsToCheck & 1) {
        if (flags & K.STAT_CHANGE_CANT_PREVENT) {
          if (m.statStages[currStat] > K.MIN_STAT_STAGE) {
            statAnimId = start + currStat;
            changeableStatsCount++;
          }
        } else if (
          !g.sideTimers[getBattlerSide(ab)].mistTimer &&
          m.ability !== K.ABILITY_CLEAR_BODY &&
          m.ability !== K.ABILITY_WHITE_SMOKE &&
          !(m.ability === K.ABILITY_KEEN_EYE && currStat === K.STAT_ACC) &&
          !(m.ability === K.ABILITY_HYPER_CUTTER && currStat === K.STAT_ATK)
        ) {
          if (m.statStages[currStat] > K.MIN_STAT_STAGE) {
            statAnimId = start + currStat;
            changeableStatsCount++;
          }
        }
      }
      statsToCheck >>= 1;
      currStat++;
    }
    if (changeableStatsCount > 1) statAnimId = flags & K.STAT_CHANGE_BY_TWO ? K.STAT_ANIM_MULTIPLE_MINUS2 : K.STAT_ANIM_MULTIPLE_MINUS1;
  } else {
    // goes up
    const start = flags & K.STAT_CHANGE_BY_TWO ? K.STAT_ANIM_PLUS2 - 1 : K.STAT_ANIM_PLUS1 - 1;
    while (statsToCheck !== 0) {
      if (statsToCheck & 1 && m.statStages[currStat] < K.MAX_STAT_STAGE) {
        statAnimId = start + currStat;
        changeableStatsCount++;
      }
      statsToCheck >>= 1;
      currStat++;
    }
    if (changeableStatsCount > 1) statAnimId = flags & K.STAT_CHANGE_BY_TWO ? K.STAT_ANIM_MULTIPLE_PLUS2 : K.STAT_ANIM_MULTIPLE_PLUS1;
  }
  if (flags & K.STAT_CHANGE_MULTIPLE_STATS && changeableStatsCount < 2) {
    adv(4);
  } else if (changeableStatsCount !== 0 && !g.battleScripting.statAnimPlayed) {
    emitBattleAnimation(K.BUFFER_A, K.B_ANIM_STATS_CHANGE, statAnimId);
    markBattlerForControllerExec(ab);
    if (flags & K.STAT_CHANGE_MULTIPLE_STATS && changeableStatsCount > 1) g.battleScripting.statAnimPlayed = 1;
    adv(4);
  } else {
    adv(4);
  }
}

export function Cmd_moveend(): void {
  let effect = false;
  const originallyUsedMove = g.chosenMove === K.MOVE_UNAVAILABLE ? K.MOVE_NONE : g.chosenMove;
  const endMode = b(1);
  const endState = b(2);
  const atk0 = g.battlerAttacker;
  const holdEffectAtk = g.battleMons[atk0].item === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[atk0].holdEffect : itemHoldEffect(g.battleMons[atk0].item);
  const choiced = g.battleStruct.choicedMove;
  const moveType = getMoveType(g.currentMove);
  const scr = g.battleScripting;

  do {
    const atk = g.battlerAttacker;
    const tgt = g.battlerTarget;
    switch (scr.moveendState) {
      case K.MOVEEND_RAGE: // rage check
        if (
          g.battleMons[tgt].status2 & K.STATUS2_RAGE &&
          g.battleMons[tgt].hp !== 0 &&
          atk !== tgt &&
          getBattlerSide(atk) !== getBattlerSide(tgt) &&
          !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) &&
          targetTurnDamaged() &&
          gBattleMoves[g.currentMove].power !== 0 &&
          g.battleMons[tgt].statStages[K.STAT_ATK] < K.MAX_STAT_STAGE
        ) {
          g.battleMons[tgt].statStages[K.STAT_ATK]++;
          battleScriptPushCursor();
          g.battlescriptCurrInstr = bs('BattleScript_RageIsBuilding');
          effect = true;
        }
        scr.moveendState++;
        break;
      case K.MOVEEND_DEFROST: // defrosting check
        if (
          g.battleMons[tgt].status1 & K.STATUS1_FREEZE &&
          g.battleMons[tgt].hp !== 0 &&
          atk !== tgt &&
          g.specialStatuses[tgt].specialDmg &&
          !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT) &&
          moveType === K.TYPE_FIRE
        ) {
          g.battleMons[tgt].status1 &= ~K.STATUS1_FREEZE;
          g.activeBattler = tgt;
          emitSetMonData(K.BUFFER_A, K.REQUEST_STATUS_BATTLE, 0, u32(g.battleMons[tgt].status1));
          markBattlerForControllerExec(g.activeBattler);
          battleScriptPushCursor();
          g.battlescriptCurrInstr = bs('BattleScript_DefrostedViaFireMove');
          effect = true;
        }
        scr.moveendState++;
        break;
      case K.MOVEEND_SYNCHRONIZE_TARGET: // target synchronize
        if (abilityBattleEffects(K.ABILITYEFFECT_SYNCHRONIZE, tgt, 0, 0, 0)) effect = true;
        scr.moveendState++;
        break;
      case K.MOVEEND_ON_DAMAGE_ABILITIES: // abilities activating on contact (Effect Spore, Rough Skin, etc.)
        if (abilityBattleEffects(K.ABILITYEFFECT_ON_DAMAGE, tgt, 0, 0, 0)) effect = true;
        scr.moveendState++;
        break;
      case K.MOVEEND_IMMUNITY_ABILITIES: // status immunities
        if (abilityBattleEffects(K.ABILITYEFFECT_IMMUNITY, 0, 0, 0, 0)) effect = true;
        else scr.moveendState++;
        break;
      case K.MOVEEND_SYNCHRONIZE_ATTACKER: // attacker synchronize
        if (abilityBattleEffects(K.ABILITYEFFECT_ATK_SYNCHRONIZE, atk, 0, 0, 0)) effect = true;
        scr.moveendState++;
        break;
      case K.MOVEEND_CHOICE_MOVE: {
        // update choice band move
        if (
          g.hitMarker & K.HITMARKER_OBEYS &&
          holdEffectAtk === K.HOLD_EFFECT_CHOICE_BAND &&
          g.chosenMove !== K.MOVE_STRUGGLE &&
          (choiced[atk0] === K.MOVE_NONE || choiced[atk0] === K.MOVE_UNAVAILABLE)
        ) {
          if (g.chosenMove === K.MOVE_BATON_PASS && !(g.moveResultFlags & K.MOVE_RESULT_FAILED)) {
            scr.moveendState++;
            break;
          }
          choiced[atk0] = g.chosenMove;
        }
        let i = 0;
        for (; i < K.MAX_MON_MOVES; i++) if (g.battleMons[atk0].moves[i] === choiced[atk0]) break;
        if (i === K.MAX_MON_MOVES) choiced[atk0] = K.MOVE_NONE;
        scr.moveendState++;
        break;
      }
      case K.MOVEEND_CHANGED_ITEMS: // changed held items
        for (let i = 0; i < g.battlersCount; i++) {
          if (g.battleStruct.changedItems[i] !== K.ITEM_NONE) {
            g.battleMons[i].item = g.battleStruct.changedItems[i];
            g.battleStruct.changedItems[i] = K.ITEM_NONE;
          }
        }
        scr.moveendState++;
        break;
      case K.MOVEEND_ITEM_EFFECTS_ALL: // item effects for all battlers
        if (itemBattleEffects(K.ITEMEFFECT_MOVE_END, 0, false)) effect = true;
        else scr.moveendState++;
        break;
      case K.MOVEEND_KINGSROCK_SHELLBELL: // king's rock and shell bell
        if (itemBattleEffects(K.ITEMEFFECT_KINGSROCK_SHELLBELL, 0, false)) effect = true;
        scr.moveendState++;
        break;
      case K.MOVEEND_ATTACKER_INVISIBLE: // make attacker sprite invisible
        if (g.statuses3[atk] & K.STATUS3_SEMI_INVULNERABLE && g.hitMarker & K.HITMARKER_NO_ANIMATIONS) {
          g.activeBattler = atk;
          emitSpriteInvisibility(K.BUFFER_A, true);
          markBattlerForControllerExec(g.activeBattler);
          scr.moveendState++;
          return;
        }
        scr.moveendState++;
        break;
      case K.MOVEEND_ATTACKER_VISIBLE: // make attacker sprite visible
        if (g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT || !(g.statuses3[atk] & K.STATUS3_SEMI_INVULNERABLE) || wasUnableToUseMove(atk)) {
          g.activeBattler = atk;
          emitSpriteInvisibility(K.BUFFER_A, false);
          markBattlerForControllerExec(g.activeBattler);
          g.statuses3[atk] &= ~K.STATUS3_SEMI_INVULNERABLE;
          g.specialStatuses[atk].restoredBattlerSprite = 1;
          scr.moveendState++;
          return;
        }
        scr.moveendState++;
        break;
      case K.MOVEEND_TARGET_VISIBLE: // make target sprite visible
        if (!g.specialStatuses[tgt].restoredBattlerSprite && tgt < g.battlersCount && !(g.statuses3[tgt] & K.STATUS3_SEMI_INVULNERABLE)) {
          g.activeBattler = tgt;
          emitSpriteInvisibility(K.BUFFER_A, false);
          markBattlerForControllerExec(g.activeBattler);
          g.statuses3[tgt] &= ~K.STATUS3_SEMI_INVULNERABLE;
          scr.moveendState++;
          return;
        }
        scr.moveendState++;
        break;
      case K.MOVEEND_SUBSTITUTE: // update substitute
        for (let i = 0; i < g.battlersCount; i++) if (g.disableStructs[i].substituteHP === 0) g.battleMons[i].status2 &= ~K.STATUS2_SUBSTITUTE;
        scr.moveendState++;
        break;
      case K.MOVEEND_UPDATE_LAST_MOVES:
        if (g.hitMarker & K.HITMARKER_SWAP_ATTACKER_TARGET) {
          g.activeBattler = g.battlerAttacker;
          g.battlerAttacker = g.battlerTarget;
          g.battlerTarget = g.activeBattler;
          g.hitMarker &= ~K.HITMARKER_SWAP_ATTACKER_TARGET;
        }
        {
          const a = g.battlerAttacker;
          const t = g.battlerTarget;
          if (g.hitMarker & K.HITMARKER_ATTACKSTRING_PRINTED) g.lastPrintedMoves[a] = g.chosenMove;
          if (!(g.absentBattlerFlags & bit(a)) && !(g.battleStruct.absentBattlerFlags & bit(a)) && gBattleMoves[originallyUsedMove].effect !== K.EFFECT_BATON_PASS) {
            if (g.hitMarker & K.HITMARKER_OBEYS) {
              g.lastMoves[a] = g.chosenMove;
              g.lastResultingMoves[a] = g.currentMove;
            } else {
              g.lastMoves[a] = K.MOVE_UNAVAILABLE;
              g.lastResultingMoves[a] = K.MOVE_UNAVAILABLE;
            }
            if (!(g.hitMarker & hitmarkerFainted(t))) g.lastHitBy[t] = a;
            if (g.hitMarker & K.HITMARKER_OBEYS && !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT)) {
              if (g.chosenMove === K.MOVE_UNAVAILABLE) {
                g.lastLandedMoves[t] = g.chosenMove;
              } else {
                g.lastLandedMoves[t] = g.currentMove;
                g.lastHitByType[t] = getMoveType(g.currentMove);
              }
            } else {
              g.lastLandedMoves[t] = K.MOVE_UNAVAILABLE;
            }
          }
        }
        scr.moveendState++;
        break;
      case K.MOVEEND_MIRROR_MOVE: {
        const a = g.battlerAttacker;
        const t = g.battlerTarget;
        if (
          !(g.absentBattlerFlags & bit(a)) &&
          !(g.battleStruct.absentBattlerFlags & bit(a)) &&
          gBattleMoves[originallyUsedMove].flags & K.FLAG_MIRROR_MOVE_AFFECTED &&
          g.hitMarker & K.HITMARKER_OBEYS &&
          a !== t &&
          !(g.hitMarker & hitmarkerFainted(t)) &&
          !(g.moveResultFlags & K.MOVE_RESULT_NO_EFFECT)
        ) {
          g.battleStruct.lastTakenMove[t] = g.chosenMove;
          g.battleStruct.lastTakenMoveFrom[t][a] = g.chosenMove;
        }
        scr.moveendState++;
        break;
      }
      case K.MOVEEND_NEXT_TARGET: // For moves hitting two opposing Pokemon.
        if (
          !(g.hitMarker & K.HITMARKER_UNABLE_TO_USE_MOVE) &&
          g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE &&
          !g.protectStructs[g.battlerAttacker].chargingTurn &&
          gBattleMoves[g.currentMove].target === K.MOVE_TARGET_BOTH &&
          !(g.hitMarker & K.HITMARKER_NO_ATTACKSTRING)
        ) {
          const battlerId = getBattlerAtPosition(getBattlerPosition(g.battlerTarget) ^ 2);
          if (g.battleMons[battlerId].hp !== 0) {
            g.battlerTarget = battlerId;
            g.hitMarker |= K.HITMARKER_NO_ATTACKSTRING;
            scr.moveendState = 0;
            moveValuesCleanUp();
            battleScriptPush(mem.u32(mem.label('gBattleScriptsForMoveEffects') + gBattleMoves[g.currentMove].effect * 4));
            g.battlescriptCurrInstr = bs('BattleScript_FlushMessageBox');
            return;
          } else {
            g.hitMarker |= K.HITMARKER_NO_ATTACKSTRING;
          }
        }
        scr.moveendState++;
        break;
      case K.MOVEEND_COUNT:
        break;
    }
    if (endMode === 1 && !effect) scr.moveendState = K.MOVEEND_COUNT;
    if (endMode === 2 && endState === scr.moveendState) scr.moveendState = K.MOVEEND_COUNT;
  } while (scr.moveendState !== K.MOVEEND_COUNT && !effect);

  if (scr.moveendState === K.MOVEEND_COUNT && !effect) adv(3);
}

export function Cmd_typecalc2(): void {
  let flags = 0;
  let i = 0;
  const moveType = gBattleMoves[g.currentMove].type;
  const tgt = g.battlerTarget;
  const def = g.battleMons[tgt];
  if (def.ability === K.ABILITY_LEVITATE && moveType === K.TYPE_GROUND) {
    g.lastUsedAbility = def.ability;
    g.moveResultFlags |= K.MOVE_RESULT_MISSED | K.MOVE_RESULT_DOESNT_AFFECT_FOE;
    g.lastLandedMoves[tgt] = 0;
    g.battleCommunication[K.MISS_TYPE] = K.B_MSG_GROUND_MISS;
    recordAbilityBattle(tgt, g.lastUsedAbility);
  } else {
    while (typeAtk(i) !== K.TYPE_ENDTABLE) {
      if (typeAtk(i) === K.TYPE_FORESIGHT) {
        if (def.status2 & K.STATUS2_FORESIGHT) break;
        i += 3;
        continue;
      }
      if (typeAtk(i) === moveType) {
        // check type1
        if (typeDef(i) === def.type1) {
          if (typeMul(i) === K.TYPE_MUL_NO_EFFECT) {
            g.moveResultFlags |= K.MOVE_RESULT_DOESNT_AFFECT_FOE;
            break;
          }
          if (typeMul(i) === K.TYPE_MUL_NOT_EFFECTIVE) flags |= K.MOVE_RESULT_NOT_VERY_EFFECTIVE;
          if (typeMul(i) === K.TYPE_MUL_SUPER_EFFECTIVE) flags |= K.MOVE_RESULT_SUPER_EFFECTIVE;
        }
        // check type2
        if (typeDef(i) === def.type2) {
          if (def.type1 !== def.type2 && typeMul(i) === K.TYPE_MUL_NO_EFFECT) {
            g.moveResultFlags |= K.MOVE_RESULT_DOESNT_AFFECT_FOE;
            break;
          }
          if (def.type1 !== def.type2 && typeMul(i) === K.TYPE_MUL_NOT_EFFECTIVE) flags |= K.MOVE_RESULT_NOT_VERY_EFFECTIVE;
          if (def.type1 !== def.type2 && typeMul(i) === K.TYPE_MUL_SUPER_EFFECTIVE) flags |= K.MOVE_RESULT_SUPER_EFFECTIVE;
        }
      }
      i += 3;
    }
  }
  const SE = K.MOVE_RESULT_SUPER_EFFECTIVE;
  const NVE = K.MOVE_RESULT_NOT_VERY_EFFECTIVE;
  if (
    def.ability === K.ABILITY_WONDER_GUARD &&
    !(flags & K.MOVE_RESULT_NO_EFFECT) &&
    attacksThisTurn2(g.battlerAttacker, g.currentMove) === 2 &&
    (!(flags & SE) || (flags & (SE | NVE)) === (SE | NVE)) &&
    gBattleMoves[g.currentMove].power
  ) {
    g.lastUsedAbility = K.ABILITY_WONDER_GUARD;
    g.moveResultFlags |= K.MOVE_RESULT_MISSED;
    g.lastLandedMoves[tgt] = 0;
    g.battleCommunication[K.MISS_TYPE] = K.B_MSG_AVOIDED_DMG;
    recordAbilityBattle(tgt, g.lastUsedAbility);
  }
  if (g.moveResultFlags & K.MOVE_RESULT_DOESNT_AFFECT_FOE) g.protectStructs[g.battlerAttacker].targetNotAffected = 1;
  adv(1);
}
import { attacksThisTurn as attacksThisTurn2 } from './bsCommands3';

export function Cmd_returnatktoball(): void {
  g.activeBattler = g.battlerAttacker;
  if (!(g.hitMarker & hitmarkerFainted(g.activeBattler))) {
    emitReturnMonToBall(K.BUFFER_A, false);
    markBattlerForControllerExec(g.activeBattler);
  }
  adv(1);
}

export function Cmd_getswitchedmondata(): void {
  if (g.battleControllerExecFlags) return;
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  g.battlerPartyIndexes[ab] = g.battleStruct.monToSwitchIntoId[ab];
  emitGetMonData(K.BUFFER_A, K.REQUEST_ALL_BATTLE, bit(g.battlerPartyIndexes[ab]));
  markBattlerForControllerExec(ab);
  adv(2);
}

export function Cmd_switchindataupdate(): void {
  if (g.battleControllerExecFlags) return;
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  const oldData = g.battleMons[ab].clone();
  const incoming = (g.battleBufferBObj[ab] as BattlePokemon).clone();
  g.battleMons[ab] = incoming;
  const m = incoming;
  m.type1 = gSpeciesInfo[m.species].types[0];
  m.type2 = gSpeciesInfo[m.species].types[1];
  m.ability = getAbilityBySpecies(m.species, m.abilityNum);
  // check knocked off item
  const side = getBattlerSide(ab);
  if (g.wishFutureKnock.knockedOffMons[side] & bit(g.battlerPartyIndexes[ab])) m.item = K.ITEM_NONE;
  if (gBattleMoves[g.currentMove].effect === K.EFFECT_BATON_PASS) {
    for (let i = 0; i < K.NUM_BATTLE_STATS; i++) m.statStages[i] = oldData.statStages[i];
    m.status2 = oldData.status2;
  }
  switchInClearSetData();
  g.battleScripting.battler = ab;
  prepareMonNickBuffer(g.battleTextBuff1, ab, g.battlerPartyIndexes[ab]);
  adv(2);
}

export function Cmd_switchinanim(): void {
  if (g.battleControllerExecFlags) return;
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  if (
    getBattlerSide(ab) === K.B_SIDE_OPPONENT &&
    !(
      g.battleTypeFlags &
      (K.BATTLE_TYPE_LINK | K.BATTLE_TYPE_LEGENDARY | K.BATTLE_TYPE_OLD_MAN_TUTORIAL | K.BATTLE_TYPE_POKEDUDE | K.BATTLE_TYPE_EREADER_TRAINER | K.BATTLE_TYPE_GHOST)
    )
  )
    handleSetPokedexFlag(speciesToNationalPokedexNum(g.battleMons[ab].species), K.FLAG_SET_SEEN);
  g.absentBattlerFlags &= ~bit(ab);
  emitSwitchInAnim(K.BUFFER_A, g.battlerPartyIndexes[ab], b(2));
  markBattlerForControllerExec(ab);
  adv(3);
}

export function Cmd_jumpifcantswitch(): void {
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1) & ~K.SWITCH_IGNORE_ESCAPE_PREVENTION));
  if (!(b(1) & K.SWITCH_IGNORE_ESCAPE_PREVENTION) && (g.battleMons[ab].status2 & (K.STATUS2_WRAPPED | K.STATUS2_ESCAPE_PREVENTION) || g.statuses3[ab] & K.STATUS3_ROOTED)) {
    g.battlescriptCurrInstr = w(2);
    return;
  }
  let battlerIn1: number, battlerIn2: number, party: typeof g.playerParty;
  if (getBattlerSide(ab) === K.B_SIDE_OPPONENT) {
    battlerIn1 = getBattlerAtPosition(K.B_POSITION_OPPONENT_LEFT);
    battlerIn2 = g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE ? getBattlerAtPosition(K.B_POSITION_OPPONENT_RIGHT) : battlerIn1;
    party = g.enemyParty;
  } else {
    battlerIn1 = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
    battlerIn2 = g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE ? getBattlerAtPosition(K.B_POSITION_PLAYER_RIGHT) : battlerIn1;
    party = g.playerParty;
  }
  let i = 0;
  for (; i < K.PARTY_SIZE; i++) {
    const mon = party[i];
    if (mon && mon.hp !== 0 && mon.species !== K.SPECIES_NONE && !mon.isEgg && i !== g.battlerPartyIndexes[battlerIn1] && i !== g.battlerPartyIndexes[battlerIn2]) break;
  }
  if (i === K.PARTY_SIZE) g.battlescriptCurrInstr = w(2);
  else adv(6);
}

/** ChooseMonToSendOut: not used by the Switch action, only replacing fainted Pokémon or Baton Pass */
function chooseMonToSendOut(slotId: number): void {
  const ab = g.activeBattler;
  g.battleStruct.battlerPartyIndexes[ab] = g.battlerPartyIndexes[ab];
  emitChoosePokemon(K.BUFFER_A, K.PARTY_ACTION_SEND_OUT, slotId, K.ABILITY_NONE, g.battleStruct.battlerPartyOrders[ab]);
  markBattlerForControllerExec(ab);
}

export function Cmd_openpartyscreen(): void {
  let flags = 0;
  const jumpPtr = w(2);
  const arg = b(1);
  const standby = () => {
    emitLinkStandbyMsg(K.BUFFER_A, K.LINK_STANDBY_MSG_ONLY);
    markBattlerForControllerExec(g.activeBattler);
  };
  const cantSwitch = () => {
    g.absentBattlerFlags |= bit(g.activeBattler);
    g.hitMarker &= ~hitmarkerFainted(g.activeBattler);
    emitCantSwitch(K.BUFFER_A);
    markBattlerForControllerExec(g.activeBattler);
  };
  if (arg === K.BS_FAINTED_LINK_MULTIPLE_1) {
    if ((g.battleTypeFlags & (K.BATTLE_TYPE_DOUBLE | K.BATTLE_TYPE_MULTI)) !== K.BATTLE_TYPE_DOUBLE) {
      for (g.activeBattler = 0; g.activeBattler < g.battlersCount; g.activeBattler++) {
        const ab = g.activeBattler;
        if (g.hitMarker & hitmarkerFainted(ab)) {
          if (hasNoMonsToSwitch(ab, K.PARTY_SIZE, K.PARTY_SIZE)) {
            g.absentBattlerFlags |= bit(ab);
            g.hitMarker &= ~hitmarkerFainted(ab);
            standby();
          } else if (!g.specialStatuses[ab].faintedHasReplacement) {
            chooseMonToSendOut(K.PARTY_SIZE);
            g.specialStatuses[ab].faintedHasReplacement = 1;
          }
        } else {
          standby();
        }
      }
    } else if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
      const faintBits = g.hitMarker >>> 28;
      const doSlot = (battler: number, partnerSlot: number, flagBit: number, skipIf: boolean) => {
        g.activeBattler = battler;
        if (hasNoMonsToSwitch(battler, K.PARTY_SIZE, K.PARTY_SIZE)) cantSwitch();
        else if (!g.specialStatuses[battler].faintedHasReplacement) {
          chooseMonToSendOut(g.battleStruct.monToSwitchIntoId[partnerSlot]);
          g.specialStatuses[battler].faintedHasReplacement = 1;
        } else if (flagBit) {
          standby();
          flags |= flagBit;
        } else if (!skipIf) {
          standby();
        }
      };
      if (bit(0) & faintBits) doSlot(0, 2, 1, false);
      if (bit(2) & faintBits && !(bit(0) & faintBits)) doSlot(2, 0, 0, !!(flags & 1));
      if (bit(1) & faintBits) doSlot(1, 3, 2, false);
      if (bit(3) & faintBits && !(bit(1) & faintBits)) doSlot(3, 1, 0, !!(flags & 2));
      if (!g.specialStatuses[0].faintedHasReplacement && !g.specialStatuses[2].faintedHasReplacement && faintBits !== 0) {
        g.activeBattler = g.absentBattlerFlags & bit(0) ? 2 : 0;
        standby();
      }
      if (!g.specialStatuses[1].faintedHasReplacement && !g.specialStatuses[3].faintedHasReplacement && faintBits !== 0) {
        g.activeBattler = g.absentBattlerFlags & bit(1) ? 3 : 1;
        standby();
      }
    }
    adv(6);
  } else if (arg === K.BS_FAINTED_LINK_MULTIPLE_2) {
    if (!(g.battleTypeFlags & K.BATTLE_TYPE_MULTI) && g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) {
      const faintBits = g.hitMarker >>> 28;
      if (bit(2) & faintBits && bit(0) & faintBits) {
        g.activeBattler = 2;
        if (hasNoMonsToSwitch(2, g.battleBufferB[0][1], K.PARTY_SIZE)) cantSwitch();
        else if (!g.specialStatuses[2].faintedHasReplacement) {
          chooseMonToSendOut(g.battleStruct.monToSwitchIntoId[0]);
          g.specialStatuses[2].faintedHasReplacement = 1;
        }
      }
      if (bit(3) & faintBits && faintBits & bit(1)) {
        g.activeBattler = 3;
        if (hasNoMonsToSwitch(3, g.battleBufferB[1][1], K.PARTY_SIZE)) cantSwitch();
        else if (!g.specialStatuses[3].faintedHasReplacement) {
          chooseMonToSendOut(g.battleStruct.monToSwitchIntoId[1]);
          g.specialStatuses[3].faintedHasReplacement = 1;
        }
      }
    }
    adv(6);
    const faintBits = g.hitMarker >>> 28;
    g.battlerFainted = 0;
    while (!(bit(g.battlerFainted) & faintBits) && g.battlerFainted < g.battlersCount) g.battlerFainted++;
    if (g.battlerFainted === g.battlersCount) g.battlescriptCurrInstr = jumpPtr;
  } else {
    const caseId = arg & K.PARTY_SCREEN_OPTIONAL ? K.PARTY_ACTION_CHOOSE_MON : K.PARTY_ACTION_SEND_OUT;
    const battlerId = getBattlerForBattleScript(arg & ~K.PARTY_SCREEN_OPTIONAL);
    if (g.specialStatuses[battlerId].faintedHasReplacement) {
      adv(6);
    } else if (hasNoMonsToSwitch(battlerId, K.PARTY_SIZE, K.PARTY_SIZE)) {
      g.activeBattler = battlerId;
      g.absentBattlerFlags |= bit(battlerId);
      g.hitMarker &= ~hitmarkerFainted(battlerId);
      g.battlescriptCurrInstr = jumpPtr;
    } else {
      g.activeBattler = battlerId;
      g.battleStruct.battlerPartyIndexes[battlerId] = g.battlerPartyIndexes[battlerId];
      emitChoosePokemon(K.BUFFER_A, caseId, g.battleStruct.monToSwitchIntoId[battlerId ^ 2], 0, g.battleStruct.battlerPartyOrders[battlerId]);
      markBattlerForControllerExec(battlerId);
      adv(6);
      if (getBattlerPosition(battlerId) === K.B_POSITION_PLAYER_LEFT && g.battleResults.playerSwitchesCounter < 255) g.battleResults.playerSwitchesCounter++;
      g.activeBattler = getBattlerAtPosition(getBattlerPosition(battlerId) ^ K.BIT_SIDE);
      if (g.absentBattlerFlags & bit(g.activeBattler)) g.activeBattler ^= K.BIT_FLANK;
      standby();
    }
  }
}

export function Cmd_switchhandleorder(): void {
  if (g.battleControllerExecFlags) return;
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  switch (b(2)) {
    case 0:
      for (let i = 0; i < g.battlersCount; i++)
        if (g.battleBufferB[i][0] === K.CONTROLLER_CHOSENMONRETURNVALUE) g.battleStruct.monToSwitchIntoId[i] = g.battleBufferB[i][1];
      break;
    case 1:
      if (!(g.battleTypeFlags & K.BATTLE_TYPE_MULTI)) updatePartyOwnerOnSwitch_NonMulti(ab);
      break;
    case 2:
      g.battleCommunication[0] = g.battleBufferB[ab][1];
      g.battleStruct.monToSwitchIntoId[ab] = g.battleBufferB[ab][1];
      updatePartyOwnerOnSwitch_NonMulti(ab);
      prepareSpeciesBuffer(g.battleTextBuff1, g.battleMons[g.battlerAttacker].species);
      prepareMonNickBuffer(g.battleTextBuff2, ab, g.battleBufferB[ab][1]);
      break;
  }
  adv(3);
}

export function Cmd_switchineffects(): void {
  const ab = (g.activeBattler = getBattlerForBattleScript(b(1)));
  updateSentPokesToOpponentValue(ab);
  g.hitMarker &= ~hitmarkerFainted(ab);
  g.specialStatuses[ab].faintedHasReplacement = 0;
  const side = getBattlerSide(ab);
  if (
    !(g.sideStatuses[side] & K.SIDE_STATUS_SPIKES_DAMAGED) &&
    g.sideStatuses[side] & K.SIDE_STATUS_SPIKES &&
    !isBattlerOfType(ab, K.TYPE_FLYING) &&
    g.battleMons[ab].ability !== K.ABILITY_LEVITATE
  ) {
    g.sideStatuses[side] |= K.SIDE_STATUS_SPIKES_DAMAGED;
    const spikesDmg = ((5 - g.sideTimers[side].spikesAmount) * 2) & 0xff;
    g.battleMoveDamage = Math.trunc(g.battleMons[ab].maxHP / spikesDmg) || 1;
    g.battleScripting.battler = ab;
    battleScriptPushCursor();
    if (b(1) === K.BS_TARGET) g.battlescriptCurrInstr = bs('BattleScript_SpikesOnTarget');
    else if (b(1) === K.BS_ATTACKER) g.battlescriptCurrInstr = bs('BattleScript_SpikesOnAttacker');
    else g.battlescriptCurrInstr = bs('BattleScript_SpikesOnFaintedBattler');
  } else {
    if (g.battleMons[ab].ability === K.ABILITY_TRUANT) g.disableStructs[ab].truantCounter = 1;
    if (!abilityBattleEffects(K.ABILITYEFFECT_ON_SWITCHIN, ab, 0, 0, 0) && !itemBattleEffects(K.ITEMEFFECT_ON_SWITCH_IN, ab, false)) {
      g.sideStatuses[side] &= ~K.SIDE_STATUS_SPIKES_DAMAGED;
      for (let i = 0; i < g.battlersCount; i++) if (g.battlerByTurnOrder[i] === ab) g.actionsByTurnOrder[i] = K.B_ACTION_CANCEL_PARTNER;
      for (let i = 0; i < g.battlersCount; i++) g.battleStruct.hpOnSwitchout[getBattlerSide(i)] = g.battleMons[i].hp;
      if (b(1) === K.BS_FAINTED_LINK_MULTIPLE_1) {
        const faintBits = g.hitMarker >>> 28;
        g.battlerFainted++;
        for (;;) {
          if (faintBits & bit(g.battlerFainted) && !(g.absentBattlerFlags & bit(g.battlerFainted))) break;
          if (g.battlerFainted >= g.battlersCount) break;
          g.battlerFainted++;
        }
      }
      adv(2);
    }
  }
}

export function Cmd_trainerslidein(): void {
  g.activeBattler = getBattlerAtPosition(!b(1) ? K.B_POSITION_PLAYER_LEFT : K.B_POSITION_OPPONENT_LEFT);
  emitTrainerSlide(K.BUFFER_A);
  markBattlerForControllerExec(g.activeBattler);
  adv(2);
}

export function Cmd_playse(): void {
  g.activeBattler = g.battlerAttacker;
  emitPlaySE(K.BUFFER_A, h(1));
  markBattlerForControllerExec(g.activeBattler);
  adv(3);
}

export function Cmd_fanfare(): void {
  g.activeBattler = g.battlerAttacker;
  emitPlayFanfare(K.BUFFER_A, h(1));
  markBattlerForControllerExec(g.activeBattler);
  adv(3);
}

export function Cmd_playfaintcry(): void {
  g.activeBattler = getBattlerForBattleScript(b(1));
  emitFaintingCry(K.BUFFER_A);
  markBattlerForControllerExec(g.activeBattler);
  adv(2);
}

export function Cmd_endlinkbattle(): void {
  g.activeBattler = getBattlerAtPosition(K.B_POSITION_PLAYER_LEFT);
  emitEndLinkBattle(K.BUFFER_A, g.battleOutcome);
  markBattlerForControllerExec(g.activeBattler);
  adv(1);
}

export function Cmd_returntoball(): void {
  g.activeBattler = getBattlerForBattleScript(b(1));
  emitReturnMonToBall(K.BUFFER_A, true);
  markBattlerForControllerExec(g.activeBattler);
  adv(2);
}
