// Item effects from pokemon.c: gItemEffectTable, GetItemEffectParamOffset, PokemonUseItemEffects /
// ExecuteTableBasedItemEffect, PokemonItemUseNoEffect, Battle_PrintStatBoosterEffectMessage, and the
// GetEvolutionTargetSpecies / CanMonLearnTMHM lookups the party menu uses. Like the C, the battle
// globals are touched even outside battle (gActiveBattler = 0, X items read gBattleMons).

import { gMain } from '../gba/main';
import { menusData } from '../menus/data';
import { BeginEvolutionScene } from '../menus/evolutionScene';
import type { Pokemon, Stat } from '../pokemon/Pokemon';
import { IsNationalPokedexEnabled } from '../state/nationalDex';
import { K } from './constants';
import { emitGetMonData, markBattlerForControllerExec } from './controllers';
import { bdata, g, gSpeciesInfo, itemHoldEffect, pokemon, state } from './env';
import { bit } from './globals';
import { battleStringExpandPlaceholdersToDisplayedString, encodeBattleText } from './message';
import { getPartyIdFromBattlePartyId } from './partyOrder';
import { calculateMonStats, calculatePPWithBonus, copyPlayerPartyMonToBattleData } from './pokemonBattle';
import { getBattlerSide, moveIsPermanent } from './util';

const mech = () => bdata.tables.mech as Record<string, number[]>;

/** gItemEffectTable[item - ITEM_POTION] (undefined = NULL) */
export function itemEffectTable(item: number): number[] | undefined {
  const t = (bdata.tables.mech as { itemEffects: Record<string, number[]> }).itemEffects;
  return t[item];
}

/** gEnigmaBerries[battler] in battle, gSaveBlock1Ptr->enigmaBerry outside (no e-Reader berry: empty). */
function enigmaEffect(battler: number): number[] {
  return gMain.inBattle ? Array.from(g.enigmaBerries[battler].itemEffect) : new Array(K.ITEM_EFFECT_ARG_START + 1).fill(0);
}

function effectFor(item: number): number[] | undefined {
  if (item === K.ITEM_ENIGMA_BERRY) return enigmaEffect(g.activeBattler);
  return itemEffectTable(item);
}

/** GetItemEffectParamOffset */
export function getItemEffectParamOffset(itemId: number, effectByte: number, effectBit: number): number {
  let offset = K.ITEM_EFFECT_ARG_START;
  const itemEffect = effectFor(itemId);
  if (!itemEffect) return 0;
  for (let i = 0; i < K.ITEM_EFFECT_ARG_START; i++) {
    switch (i) {
      case 0:
      case 1:
      case 2:
      case 3:
        if (i === effectByte) return 0;
        break;
      case 4: {
        let val = itemEffect[4];
        if (val & K.ITEM4_PP_UP) val &= ~K.ITEM4_PP_UP;
        let j = 0;
        while (val) {
          if (val & 1) {
            switch (j) {
              case 2: // ITEM4_HEAL_HP
                if (val & (K.ITEM4_REVIVE >> 2)) val &= ~(K.ITEM4_REVIVE >> 2);
              // fallthrough
              case 0: // ITEM4_EV_HP
              case 1: // ITEM4_EV_ATK
              case 3: // ITEM4_HEAL_PP
                if (i === effectByte && val & effectBit) return offset;
                offset++;
                break;
              case 7: // ITEM4_EVO_STONE
                if (i === effectByte) return 0;
                break;
            }
          }
          j++;
          val >>= 1;
          if (i === effectByte) effectBit >>= 1;
        }
        break;
      }
      case 5: {
        let val = itemEffect[5];
        let j = 0;
        while (val) {
          if (val & 1) {
            if (j <= 6) {
              // EV_DEF, EV_SPEED, EV_SPDEF, EV_SPATK, PP_MAX, FRIENDSHIP_LOW, FRIENDSHIP_MID
              if (i === effectByte && val & effectBit) return offset;
              offset++;
            } else if (i === effectByte) {
              return 0; // ITEM5_FRIENDSHIP_HIGH
            }
          }
          j++;
          val >>= 1;
          if (i === effectByte) effectBit >>= 1;
        }
        break;
      }
    }
  }
  return offset;
}

/** HealStatusConditions: false if something was healed. */
function healStatusConditions(mon: Pokemon, healMask: number, battleId: number): boolean {
  const status = mon.status >>> 0;
  if (status & healMask) {
    mon.status = (status & ~healMask) >>> 0;
    if (gMain.inBattle && battleId !== K.MAX_BATTLERS_COUNT) g.battleMons[battleId].status1 &= ~healMask;
    return false;
  }
  return true;
}

/** PartyMonHasStatus */
function partyMonHasStatus(mon: Pokemon, healMask: number): boolean {
  return ((mon.status >>> 0) & healMask) !== 0;
}

/** sGetMonDataEVConstants */
const EV_STATS: Stat[] = ['hp', 'attack', 'defense', 'speed', 'spDefense', 'spAttack'];

/** GetMonEVCount */
function GetMonEVCount(mon: Pokemon): number {
  return EV_STATS.reduce((n, s) => n + mon.evs[s], 0);
}

const s8 = (v: number) => (v << 24) >> 24;

/** The hold effect of a mon's item (gEnigmaBerries / the save block's Enigma Berry for ITEM_ENIGMA_BERRY). */
function heldItemEffect(mon: Pokemon): number {
  if (mon.heldItem === K.ITEM_ENIGMA_BERRY) return gMain.inBattle ? g.enigmaBerries[g.battlerInMenuId].holdEffect : 0;
  return itemHoldEffect(mon.heldItem);
}

/** Find the battler using party slot `partyIndex` on the side of gBattlerInMenuId (in battle only). */
function battlerForPartyIndex(partyIndex: number): number {
  g.potentialItemEffectBattler = g.battlerInMenuId;
  if (gMain.inBattle) {
    g.activeBattler = g.battlerInMenuId;
    for (let cmdIndex = getBattlerSide(g.activeBattler) !== K.B_SIDE_PLAYER ? 1 : 0; cmdIndex < g.battlersCount; cmdIndex += 2) {
      if (g.battlerPartyIndexes[cmdIndex] === partyIndex) return cmdIndex;
    }
    return K.MAX_BATTLERS_COUNT;
  }
  g.activeBattler = 0;
  return K.MAX_BATTLERS_COUNT;
}

/** ExecuteTableBasedItemEffect: true = the item had no effect. */
export function ExecuteTableBasedItemEffect(mon: Pokemon, item: number, partyIndex: number, moveIndex: number): boolean {
  return pokemonUseItemEffects(mon, item, partyIndex, moveIndex, false);
}

/** PokemonUseItemEffects: true = the item had no effect. */
export function pokemonUseItemEffects(mon: Pokemon, item: number, partyIndex: number, moveIndex: number, usedByAI: boolean): boolean {
  let retVal = true;
  let idx = K.ITEM_EFFECT_ARG_START;
  let friendshipChange = 0;
  const holdEffect = heldItemEffect(mon);
  const battleMonId = battlerForPartyIndex(partyIndex);

  // Skip using the item if it won't do anything
  if (!(item >= K.ITEM_POTION && item <= K.MAX_BERRY_INDEX)) return true;
  if (!itemEffectTable(item) && item !== K.ITEM_ENIGMA_BERRY) return true;
  const itemEffect = effectFor(item)!;

  const ab = g.battleMons[g.activeBattler];
  const raise = (stat: number, by: number) => {
    ab.statStages[stat] += by;
    if (ab.statStages[stat] > K.MAX_STAT_STAGE) ab.statStages[stat] = K.MAX_STAT_STAGE;
    retVal = false;
  };
  const updateFriendshipFromItem = () => {
    // UPDATE_FRIENDSHIP_FROM_ITEM
    if (retVal === false && friendshipChange === 0) {
      friendshipChange = s8(itemEffect[idx]);
      let friendship = mon.friendship;
      if (friendshipChange > 0 && holdEffect === K.HOLD_EFFECT_FRIENDSHIP_UP) friendship += Math.trunc((150 * friendshipChange) / 100);
      else friendship += friendshipChange;
      if (friendshipChange > 0) {
        if (mon.pokeball === K.ITEM_LUXURY_BALL) friendship++;
        if (mon.metLocation === state.currentMapSection) friendship++;
      }
      if (friendship < 0) friendship = 0;
      if (friendship > K.MAX_FRIENDSHIP) friendship = K.MAX_FRIENDSHIP;
      mon.friendship = friendship;
    }
  };

  for (let cmdIndex = 0; cmdIndex < K.ITEM_EFFECT_ARG_START; cmdIndex++) {
    const e = itemEffect[cmdIndex] ?? 0;
    switch (cmdIndex) {
      // Handle ITEM0 effects (infatuation, Dire Hit, X Attack). ITEM0_SACRED_ASH is handled in party_menu.c
      case 0:
        if (e & K.ITEM0_INFATUATION && gMain.inBattle && battleMonId !== K.MAX_BATTLERS_COUNT && g.battleMons[battleMonId].status2 & K.STATUS2_INFATUATION) {
          g.battleMons[battleMonId].status2 &= ~K.STATUS2_INFATUATION;
          retVal = false;
        }
        if (e & K.ITEM0_DIRE_HIT && !(ab.status2 & K.STATUS2_FOCUS_ENERGY)) {
          ab.status2 |= K.STATUS2_FOCUS_ENERGY;
          retVal = false;
        }
        if (e & K.ITEM0_X_ATTACK && ab.statStages[K.STAT_ATK] < K.MAX_STAT_STAGE) raise(K.STAT_ATK, e & K.ITEM0_X_ATTACK);
        break;
      // Handle ITEM1 effects (in-battle stat boosting effects)
      case 1:
        if (e & K.ITEM1_X_DEFEND && ab.statStages[K.STAT_DEF] < K.MAX_STAT_STAGE) raise(K.STAT_DEF, (e & K.ITEM1_X_DEFEND) >> 4);
        if (e & K.ITEM1_X_SPEED && ab.statStages[K.STAT_SPEED] < K.MAX_STAT_STAGE) raise(K.STAT_SPEED, e & K.ITEM1_X_SPEED);
        break;
      // Handle ITEM2 effects (more stat boosting effects)
      case 2:
        if (e & K.ITEM2_X_ACCURACY && ab.statStages[K.STAT_ACC] < K.MAX_STAT_STAGE) raise(K.STAT_ACC, (e & K.ITEM2_X_ACCURACY) >> 4);
        if (e & K.ITEM2_X_SPATK && ab.statStages[K.STAT_SPATK] < K.MAX_STAT_STAGE) raise(K.STAT_SPATK, e & K.ITEM2_X_SPATK);
        break;
      // Handle ITEM3 effects (Guard Spec, Rare Candy, cure status)
      case 3: {
        const st = g.sideTimers[getBattlerSide(g.activeBattler)];
        if (e & K.ITEM3_GUARD_SPEC && st.mistTimer === 0) {
          st.mistTimer = 5;
          retVal = false;
        }
        if (e & K.ITEM3_LEVEL_UP && mon.level !== K.MAX_LEVEL) {
          mon.exp = pokemon.tables.experience[gSpeciesInfo[mon.species].growthRate][mon.level + 1];
          calculateMonStats(mon);
          retVal = false;
        }
        if (e & K.ITEM3_SLEEP && !healStatusConditions(mon, K.STATUS1_SLEEP, battleMonId)) {
          if (battleMonId !== K.MAX_BATTLERS_COUNT) g.battleMons[battleMonId].status2 &= ~K.STATUS2_NIGHTMARE;
          retVal = false;
        }
        if (e & K.ITEM3_POISON && !healStatusConditions(mon, K.STATUS1_PSN_ANY | K.STATUS1_TOXIC_COUNTER, battleMonId)) retVal = false;
        if (e & K.ITEM3_BURN && !healStatusConditions(mon, K.STATUS1_BURN, battleMonId)) retVal = false;
        if (e & K.ITEM3_FREEZE && !healStatusConditions(mon, K.STATUS1_FREEZE, battleMonId)) retVal = false;
        if (e & K.ITEM3_PARALYSIS && !healStatusConditions(mon, K.STATUS1_PARALYSIS, battleMonId)) retVal = false;
        if (e & K.ITEM3_CONFUSION && gMain.inBattle && battleMonId !== K.MAX_BATTLERS_COUNT && g.battleMons[battleMonId].status2 & K.STATUS2_CONFUSION) {
          g.battleMons[battleMonId].status2 &= ~K.STATUS2_CONFUSION;
          retVal = false;
        }
        break;
      }
      // Handle ITEM4 effects (Change HP/Atk EVs, HP heal, PP heal, PP up, Revive, and evolution stones)
      case 4: {
        let val = e;
        if (val & K.ITEM4_PP_UP) {
          val &= ~K.ITEM4_PP_UP;
          const ups = (mon.ppBonuses & mech().gPPUpGetMask[moveIndex]) >> (moveIndex * 2);
          const before = calculatePPWithBonus(mon.moves[moveIndex], mon.ppBonuses, moveIndex);
          if (ups < 3 && before > 4) {
            mon.ppBonuses += mech().gPPUpAddValues[moveIndex];
            mon.pp[moveIndex] += calculatePPWithBonus(mon.moves[moveIndex], mon.ppBonuses, moveIndex) - before;
            retVal = false;
          }
        }
        let i = 0;
        // Loop through and try each of the remaining ITEM4 effects
        while (val !== 0) {
          if (val & 1) {
            switch (i) {
              case 0: // ITEM4_EV_HP
              case 1: {
                // ITEM4_EV_ATK
                const count = GetMonEVCount(mon);
                // Has EV increase limit already been reached?
                if (count >= K.MAX_TOTAL_EVS) return true;
                let data = mon.evs[EV_STATS[i]];
                if (data < K.EV_ITEM_RAISE_LIMIT) {
                  // Limit the increase
                  let evDelta = data + itemEffect[idx] > K.EV_ITEM_RAISE_LIMIT ? K.EV_ITEM_RAISE_LIMIT - (data + itemEffect[idx]) + itemEffect[idx] : itemEffect[idx];
                  if (count + evDelta > K.MAX_TOTAL_EVS) evDelta += K.MAX_TOTAL_EVS - (count + evDelta);
                  data += evDelta;
                  mon.evs[EV_STATS[i]] = data;
                  calculateMonStats(mon);
                  idx++;
                  retVal = false;
                }
                break;
              }
              case 2: {
                // ITEM4_HEAL_HP
                // If Revive, update number of times revive has been used
                if (val & (K.ITEM4_REVIVE >> 2)) {
                  if (mon.hp !== 0) {
                    idx++;
                    break;
                  }
                  if (gMain.inBattle) {
                    if (battleMonId !== K.MAX_BATTLERS_COUNT) {
                      g.absentBattlerFlags &= ~bit(battleMonId);
                      copyPlayerPartyMonToBattleData(battleMonId, getPartyIdFromBattlePartyId(g.battlerPartyIndexes[battleMonId]));
                      if (getBattlerSide(g.activeBattler) === K.B_SIDE_PLAYER && g.battleResults.numRevivesUsed < 255) g.battleResults.numRevivesUsed++;
                    } else {
                      g.absentBattlerFlags &= ~bit(g.activeBattler ^ 2);
                      if (getBattlerSide(g.activeBattler) === K.B_SIDE_PLAYER && g.battleResults.numRevivesUsed < 255) g.battleResults.numRevivesUsed++;
                    }
                  }
                } else if (mon.hp === 0) {
                  idx++;
                  break;
                }
                // Get amount of HP to restore
                let data = itemEffect[idx++];
                switch (data) {
                  case K.ITEM6_HEAL_HP_FULL:
                    data = mon.maxHP - mon.hp;
                    break;
                  case K.ITEM6_HEAL_HP_HALF:
                    data = Math.trunc(mon.maxHP / 2);
                    if (data === 0) data = 1;
                    break;
                  case K.ITEM6_HEAL_HP_LVL_UP:
                    data = g.battleScripting.levelUpHP;
                    break;
                }
                // Only restore HP if not at max health
                if (mon.maxHP !== mon.hp) {
                  if (!usedByAI) {
                    // Restore HP
                    data = Math.min(mon.hp + data, mon.maxHP);
                    mon.hp = data;
                    // Update battler (if applicable)
                    if (gMain.inBattle && battleMonId !== K.MAX_BATTLERS_COUNT) {
                      g.battleMons[battleMonId].hp = data;
                      if (!(val & (K.ITEM4_REVIVE >> 2)) && getBattlerSide(g.activeBattler) === K.B_SIDE_PLAYER) {
                        if (g.battleResults.numHealingItemsUsed < 255) g.battleResults.numHealingItemsUsed++;
                        const r5 = g.activeBattler;
                        g.activeBattler = battleMonId;
                        emitGetMonData(K.BUFFER_A, K.REQUEST_ALL_BATTLE, 0);
                        markBattlerForControllerExec(g.activeBattler);
                        g.activeBattler = r5;
                      }
                    }
                  } else {
                    g.battleMoveDamage = -data;
                  }
                  retVal = false;
                }
                val &= ~(K.ITEM4_REVIVE >> 2);
                break;
              }
              case 3: // ITEM4_HEAL_PP
                if (!(val & (K.ITEM4_HEAL_PP_ONE >> 3))) {
                  // Heal PP for all moves
                  for (let r5 = 0; r5 < K.MAX_MON_MOVES; r5++) {
                    const max = calculatePPWithBonus(mon.moves[r5], mon.ppBonuses, r5);
                    if (mon.pp[r5] !== max) {
                      mon.pp[r5] = Math.min(mon.pp[r5] + itemEffect[idx], max);
                      // Heal battler PP too (if applicable)
                      if (gMain.inBattle && battleMonId !== K.MAX_BATTLERS_COUNT && moveIsPermanent(battleMonId, r5)) g.battleMons[battleMonId].pp[r5] = mon.pp[r5];
                      retVal = false;
                    }
                  }
                  idx++;
                } else {
                  // Heal PP for one move
                  const max = calculatePPWithBonus(mon.moves[moveIndex], mon.ppBonuses, moveIndex);
                  if (mon.pp[moveIndex] !== max) {
                    mon.pp[moveIndex] = Math.min(mon.pp[moveIndex] + itemEffect[idx++], max);
                    if (gMain.inBattle && battleMonId !== K.MAX_BATTLERS_COUNT && moveIsPermanent(battleMonId, moveIndex)) g.battleMons[battleMonId].pp[moveIndex] = mon.pp[moveIndex];
                    retVal = false;
                  }
                }
                break;
              // cases 4-6 are ITEM4_HEAL_PP_ONE, ITEM4_PP_UP, and ITEM4_REVIVE, which
              // are already handled above by other cases or before the loop
              case 7: {
                // ITEM4_EVO_STONE
                const targetSpecies = GetEvolutionTargetSpecies(mon, K.EVO_MODE_ITEM_USE, item);
                if (targetSpecies !== K.SPECIES_NONE) {
                  BeginEvolutionScene(mon, targetSpecies, 0, partyIndex);
                  return false;
                }
                break;
              }
            }
          }
          i++;
          val >>= 1;
        }
        break;
      }
      // Handle ITEM5 effects (Change Def/SpDef/SpAtk/Speed EVs, PP Max, and friendship changes)
      case 5: {
        let val = e;
        let i = 0;
        while (val !== 0) {
          if (val & 1) {
            switch (i) {
              case 0: // ITEM5_EV_DEF
              case 1: // ITEM5_EV_SPEED
              case 2: // ITEM5_EV_SPDEF
              case 3: {
                // ITEM5_EV_SPATK
                const count = GetMonEVCount(mon);
                if (count >= K.MAX_TOTAL_EVS) return true;
                let data = mon.evs[EV_STATS[i + 2]];
                if (data < K.EV_ITEM_RAISE_LIMIT) {
                  let evDelta = data + itemEffect[idx] > K.EV_ITEM_RAISE_LIMIT ? K.EV_ITEM_RAISE_LIMIT - (data + itemEffect[idx]) + itemEffect[idx] : itemEffect[idx];
                  if (count + evDelta > K.MAX_TOTAL_EVS) evDelta += K.MAX_TOTAL_EVS - (count + evDelta);
                  data += evDelta;
                  mon.evs[EV_STATS[i + 2]] = data;
                  calculateMonStats(mon);
                  retVal = false;
                  idx++;
                }
                break;
              }
              case 4: {
                // ITEM5_PP_MAX
                const ups = (mon.ppBonuses & mech().gPPUpGetMask[moveIndex]) >> (moveIndex * 2);
                // Check if 3 PP Ups have been applied already
                if (ups < 3) {
                  const before = calculatePPWithBonus(mon.moves[moveIndex], mon.ppBonuses, moveIndex);
                  let data = mon.ppBonuses & mech().gPPUpClearMask[moveIndex];
                  data += mech().gPPUpAddValues[moveIndex] * 3; // Apply 3 PP Ups (max)
                  mon.ppBonuses = data;
                  mon.pp[moveIndex] += calculatePPWithBonus(mon.moves[moveIndex], data, moveIndex) - before;
                  retVal = false;
                }
                break;
              }
              case 5: // ITEM5_FRIENDSHIP_LOW
                // Changes to friendship are given differently depending on how much friendship the
                // Pokémon already has: lower friendship receives more, higher receives less.
                if (mon.friendship < 100) updateFriendshipFromItem();
                idx++;
                break;
              case 6: // ITEM5_FRIENDSHIP_MID
                if (mon.friendship >= 100 && mon.friendship < 200) updateFriendshipFromItem();
                idx++;
                break;
              case 7: // ITEM5_FRIENDSHIP_HIGH
                if (mon.friendship >= 200) updateFriendshipFromItem();
                idx++;
                break;
            }
          }
          i++;
          val >>= 1;
        }
        break;
      }
    }
  }
  return retVal;
}

/** PokemonItemUseNoEffect: true if using `item` on `mon` would do nothing. */
export function PokemonItemUseNoEffect(mon: Pokemon, item: number, partyIndex: number, moveIndex: number): boolean {
  let retVal = true;
  let idx = K.ITEM_EFFECT_ARG_START;
  let sp18 = 0;
  heldItemEffect(mon);
  const battlerId = battlerForPartyIndex(partyIndex);

  // Skip using the item if it won't do anything
  if (!(item >= K.ITEM_POTION && item <= K.MAX_BERRY_INDEX)) return true;
  if (!itemEffectTable(item) && item !== K.ITEM_ENIGMA_BERRY) return true;
  const itemEffect = effectFor(item)!;
  const ab = g.battleMons[g.activeBattler];

  for (let cmdIndex = 0; cmdIndex < K.ITEM_EFFECT_ARG_START; cmdIndex++) {
    const e = itemEffect[cmdIndex] ?? 0;
    switch (cmdIndex) {
      // status healing effects
      case 0:
        if (e & K.ITEM0_INFATUATION && gMain.inBattle && battlerId !== K.MAX_BATTLERS_COUNT && g.battleMons[battlerId].status2 & K.STATUS2_INFATUATION) retVal = false;
        if (e & K.ITEM0_DIRE_HIT && !(ab.status2 & K.STATUS2_FOCUS_ENERGY)) retVal = false;
        if (e & K.ITEM0_X_ATTACK && ab.statStages[K.STAT_ATK] < K.MAX_STAT_STAGE) retVal = false;
        break;
      case 1:
        if (e & K.ITEM1_X_DEFEND && ab.statStages[K.STAT_DEF] < K.MAX_STAT_STAGE) retVal = false;
        if (e & K.ITEM1_X_SPEED && ab.statStages[K.STAT_SPEED] < K.MAX_STAT_STAGE) retVal = false;
        break;
      case 2:
        if (e & K.ITEM2_X_ACCURACY && ab.statStages[K.STAT_ACC] < K.MAX_STAT_STAGE) retVal = false;
        if (e & K.ITEM2_X_SPATK && ab.statStages[K.STAT_SPATK] < K.MAX_STAT_STAGE) retVal = false;
        break;
      case 3:
        if (e & K.ITEM3_GUARD_SPEC && g.sideTimers[getBattlerSide(g.activeBattler)].mistTimer === 0) retVal = false;
        if (e & K.ITEM3_LEVEL_UP && mon.level !== K.MAX_LEVEL) retVal = false;
        if (e & K.ITEM3_SLEEP && partyMonHasStatus(mon, K.STATUS1_SLEEP)) retVal = false;
        if (e & K.ITEM3_POISON && partyMonHasStatus(mon, K.STATUS1_PSN_ANY | K.STATUS1_TOXIC_COUNTER)) retVal = false;
        if (e & K.ITEM3_BURN && partyMonHasStatus(mon, K.STATUS1_BURN)) retVal = false;
        if (e & K.ITEM3_FREEZE && partyMonHasStatus(mon, K.STATUS1_FREEZE)) retVal = false;
        if (e & K.ITEM3_PARALYSIS && partyMonHasStatus(mon, K.STATUS1_PARALYSIS)) retVal = false;
        if (e & K.ITEM3_CONFUSION && gMain.inBattle && battlerId !== K.MAX_BATTLERS_COUNT && g.battleMons[battlerId].status2 & K.STATUS2_CONFUSION) retVal = false;
        break;
      case 4: {
        let curEffect = e;
        if (curEffect & K.ITEM4_PP_UP) {
          curEffect &= ~K.ITEM4_PP_UP;
          const ups = (mon.ppBonuses & mech().gPPUpGetMask[moveIndex]) >> (moveIndex * 2);
          const pp = calculatePPWithBonus(mon.moves[moveIndex], mon.ppBonuses, moveIndex);
          if (ups < 3 && pp > 4) retVal = false;
        }
        let i = 0;
        while (curEffect) {
          if (curEffect & 1) {
            switch (i) {
              case 0: // ITEM4_EV_HP
              case 1: // ITEM4_EV_ATK
                if (GetMonEVCount(mon) >= K.MAX_TOTAL_EVS) return true;
                if (mon.evs[EV_STATS[i]] < K.EV_ITEM_RAISE_LIMIT) {
                  idx++;
                  retVal = false;
                }
                break;
              case 2: // ITEM4_HEAL_HP
                if (curEffect & (K.ITEM4_REVIVE >> 2)) {
                  if (mon.hp !== 0) {
                    idx++;
                    break;
                  }
                } else if (mon.hp === 0) {
                  idx++;
                  break;
                }
                if (mon.maxHP !== mon.hp) retVal = false;
                idx++;
                curEffect &= ~(K.ITEM4_REVIVE >> 2);
                break;
              case 3:
                if (!(curEffect & (K.ITEM4_HEAL_PP_ONE >> 3))) {
                  for (let tmp = 0; tmp < K.MAX_MON_MOVES; tmp++) {
                    if (mon.pp[tmp] !== calculatePPWithBonus(mon.moves[tmp], mon.ppBonuses, tmp)) retVal = false;
                  }
                  idx++;
                } else if (mon.pp[moveIndex] !== calculatePPWithBonus(mon.moves[moveIndex], mon.ppBonuses, moveIndex)) {
                  idx++;
                  retVal = false;
                }
                break;
              case 7: // ITEM4_EVO_STONE
                if (GetEvolutionTargetSpecies(mon, K.EVO_MODE_ITEM_USE, item) !== K.SPECIES_NONE) return false;
                break;
            }
          }
          i++;
          curEffect >>= 1;
        }
        break;
      }
      case 5: {
        let curEffect = e;
        let i = 0;
        while (curEffect) {
          if (curEffect & 1) {
            switch (i) {
              case 0: // ITEM5_EV_DEF
              case 1: // ITEM5_EV_SPEED
              case 2: // ITEM5_EV_SPDEF
              case 3: // ITEM5_EV_SPATK
                if (GetMonEVCount(mon) >= K.MAX_TOTAL_EVS) return true;
                if (mon.evs[EV_STATS[i + 2]] < K.EV_ITEM_RAISE_LIMIT) {
                  retVal = false;
                  idx++;
                }
                break;
              case 4: {
                // ITEM5_PP_MAX
                const ups = (mon.ppBonuses & mech().gPPUpGetMask[moveIndex]) >> (moveIndex * 2);
                const tmp = calculatePPWithBonus(mon.moves[moveIndex], mon.ppBonuses, moveIndex);
                // Check if 3 PP Ups have been applied already, and that the move has a total PP of at least 5 (excludes Sketch)
                if (ups < 3 && tmp >= 5) retVal = false;
                break;
              }
              case 5: // ITEM5_FRIENDSHIP_LOW
                if (mon.friendship < 100 && retVal === false && sp18 === 0) sp18 = itemEffect[idx];
                idx++;
                break;
              case 6: // ITEM5_FRIENDSHIP_MID
                if (mon.friendship >= 100 && mon.friendship < 200 && retVal === false && sp18 === 0) sp18 = itemEffect[idx];
                idx++;
                break;
              case 7: // ITEM5_FRIENDSHIP_HIGH
                if (mon.friendship >= 200 && retVal === false && sp18 === 0) sp18 = itemEffect[idx];
                idx++;
                break;
            }
          }
          i++;
          curEffect >>= 1;
        }
        break;
      }
    }
  }
  return retVal;
}

/** BufferStatRoseMessage */
function BufferStatRoseMessage(statIdx: number): void {
  g.battlerTarget = g.battlerInMenuId;
  const statName = encodeBattleText(bdata.strings.pointerTables.gStatNamesTable[mech().sStatsToRaise[statIdx]] ?? '');
  const rose = encodeBattleText('gBattleText_Rose');
  g.battleTextBuff1.fill(0xff).set(statName.slice(0, g.battleTextBuff1.length));
  g.battleTextBuff2.fill(0xff).set(rose.slice(0, g.battleTextBuff2.length));
  battleStringExpandPlaceholdersToDisplayedString(encodeBattleText('gText_DefendersStatRose'));
}

/** Battle_PrintStatBoosterEffectMessage: the message for an X item / Dire Hit / Guard Spec. (gDisplayedStringBattle) */
export function Battle_PrintStatBoosterEffectMessage(itemId: number): number[] {
  const itemEffect = itemId === K.ITEM_ENIGMA_BERRY ? enigmaEffect(g.battlerInMenuId) : itemEffectTable(itemId)!;
  g.potentialItemEffectBattler = g.battlerInMenuId;
  for (let i = 0; i < 3; i++) {
    if (itemEffect[i] & (K.ITEM0_X_ATTACK | K.ITEM1_X_SPEED | K.ITEM2_X_SPATK)) BufferStatRoseMessage(i * 2);
    if (itemEffect[i] & (K.ITEM0_DIRE_HIT | K.ITEM1_X_DEFEND | K.ITEM2_X_ACCURACY)) {
      if (i !== 0) {
        // Dire Hit is the only ITEM0 above
        BufferStatRoseMessage(i * 2 + 1);
      } else {
        g.battlerAttacker = g.battlerInMenuId;
        battleStringExpandPlaceholdersToDisplayedString(encodeBattleText('gBattleText_GetPumped'));
      }
    }
  }
  if (itemEffect[3] & K.ITEM3_GUARD_SPEC) {
    g.battlerAttacker = g.battlerInMenuId;
    battleStringExpandPlaceholdersToDisplayedString(encodeBattleText('gBattleText_MistShroud'));
  }
  return g.displayedStringBattle;
}

/** GetEvolutionTargetSpecies (no beauty stat or RTC, as in FRLG) */
export function GetEvolutionTargetSpecies(mon: Pokemon, type: number, evolutionItem: number): number {
  let targetSpecies = 0;
  const species = mon.species;
  let heldItem = mon.heldItem;
  const upperPersonality = (mon.personality >>> 16) & 0xffff;
  const holdEffect = heldItem === K.ITEM_ENIGMA_BERRY ? 0 : itemHoldEffect(heldItem);
  const evos = menusData.evolutions[species] ?? [];

  // Prevent evolution with Everstone, unless we're just viewing the party menu with an evolution item
  if (holdEffect === K.HOLD_EFFECT_PREVENT_EVOLVE && type !== K.EVO_MODE_ITEM_CHECK) return 0;

  switch (type) {
    case K.EVO_MODE_NORMAL: {
      const level = mon.level;
      const friendship = mon.friendship;
      for (const [method, param, target] of evos) {
        switch (method) {
          case K.EVO_FRIENDSHIP:
            if (friendship >= 220) targetSpecies = target;
            break;
          // FR/LG removed the time of day evolutions due to having no RTC.
          case K.EVO_FRIENDSHIP_DAY:
          case K.EVO_FRIENDSHIP_NIGHT:
            break;
          case K.EVO_LEVEL:
            if (param <= level) targetSpecies = target;
            break;
          case K.EVO_LEVEL_ATK_GT_DEF:
            if (param <= level && mon.stats.attack > mon.stats.defense) targetSpecies = target;
            break;
          case K.EVO_LEVEL_ATK_EQ_DEF:
            if (param <= level && mon.stats.attack === mon.stats.defense) targetSpecies = target;
            break;
          case K.EVO_LEVEL_ATK_LT_DEF:
            if (param <= level && mon.stats.attack < mon.stats.defense) targetSpecies = target;
            break;
          case K.EVO_LEVEL_SILCOON:
            if (param <= level && upperPersonality % 10 <= 4) targetSpecies = target;
            break;
          case K.EVO_LEVEL_CASCOON:
            if (param <= level && upperPersonality % 10 > 4) targetSpecies = target;
            break;
          case K.EVO_LEVEL_NINJASK:
            if (param <= level) targetSpecies = target;
            break;
          case K.EVO_BEAUTY:
            // MON_DATA_BEAUTY isn't tracked; contest stats are always 0 in FRLG play.
            if (param <= 0) targetSpecies = target;
            break;
        }
      }
      break;
    }
    case K.EVO_MODE_TRADE:
      for (const [method, param, target] of evos) {
        switch (method) {
          case K.EVO_TRADE:
            targetSpecies = target;
            break;
          case K.EVO_TRADE_ITEM:
            if (param === heldItem) {
              targetSpecies = target;
              // Prevent cross-generational evolutions like Scizor and Steelix until the National Pokedex is obtained
              if (IsNationalPokedexEnabled(state) || targetSpecies <= K.KANTO_SPECIES_END) {
                heldItem = K.ITEM_NONE;
                mon.heldItem = heldItem;
                targetSpecies = target;
              }
            }
            break;
        }
      }
      break;
    case K.EVO_MODE_ITEM_USE:
    case K.EVO_MODE_ITEM_CHECK:
      for (const [method, param, target] of evos) {
        if (method === K.EVO_ITEM && param === evolutionItem) {
          targetSpecies = target;
          break;
        }
      }
      break;
  }
  return targetSpecies;
}

/** CanMonLearnTMHM */
export function CanMonLearnTMHM(mon: Pokemon, tm: number): boolean {
  if (mon.isEgg) return false;
  const set = menusData.tmhmLearnsets[mon.species] ?? [0, 0];
  return tm < 32 ? ((set[0] >>> tm) & 1) !== 0 : ((set[1] >>> (tm - 32)) & 1) !== 0;
}

/** CheckPartyPokerus(mon, 0): the mon's current Pokérus strain (low nibble). */
export function CheckPartyPokerus(mon: Pokemon): boolean {
  return ((mon.pokerus ?? 0) & 0xf) !== 0;
}
