// The battle-facing parts of pokemon.c: CalculateBaseDamage, party/battler bookkeeping, EXP, EVs,
// friendship, move learning. Party Pokémon are the TS `Pokemon` objects; an empty slot is undefined
// (GetMonData returns 0 for SPECIES_NONE slots on the GBA, so callers treat undefined as all-zero).

import type { Pokemon } from '../pokemon/Pokemon';
import { random } from '../util/random';
import { K } from './constants';
import { bdata, g, gBattleMoves, gSpeciesInfo, itemHoldEffect, itemHoldEffectParam, pokemon, state } from './env';
import { bit } from './globals';
import type { BattlePokemon } from './structs';
import { abilityBattleEffects, getBattlerAtPosition, getBattlerPosition, getBattlerSide, updateSentPokesToOpponentValue, weatherHasEffect2 } from './util';
import { clearTemporarySpeciesSpriteData } from './gfx';
import { HandleSetPokedexFlag } from '../menus/pokedex';

const mech = () => bdata.tables.mech as Record<string, number[]>;

/** gPlayerParty or gEnemyParty for a battler's side. */
export function partyOf(battler: number): (Pokemon | undefined)[] {
  return getBattlerSide(battler) === K.B_SIDE_PLAYER ? g.playerParty : g.enemyParty;
}

/** &gPlayerParty/gEnemyParty[gBattlerPartyIndexes[battler]] */
export function battlerPartyMon(battler: number): Pokemon | undefined {
  return partyOf(battler)[g.battlerPartyIndexes[battler]];
}

/** GetMonData(mon, MON_DATA_SPECIES_OR_EGG) */
export function speciesOrEgg(mon: Pokemon | undefined): number {
  if (!mon) return K.SPECIES_NONE;
  return mon.isEgg ? K.SPECIES_EGG : mon.species;
}

/** GetMonData(mon, MON_DATA_SPECIES) */
export function speciesOf(mon: Pokemon | undefined): number {
  return mon?.species ?? K.SPECIES_NONE;
}

export function hpOf(mon: Pokemon | undefined): number {
  return mon?.hp ?? 0;
}

/** GetAbilityBySpecies */
export function getAbilityBySpecies(species: number, abilityNum: number): number {
  const abilities = gSpeciesInfo[species]?.abilities ?? [0, 0];
  return abilityNum ? abilities[1] : abilities[0];
}

/** GetMonAbility */
export function getMonAbility(mon: Pokemon): number {
  return getAbilityBySpecies(mon.species, mon.abilityNum);
}

/** GetGenderFromSpeciesAndPersonality */
export function getGenderFromSpeciesAndPersonality(species: number, personality: number): number {
  const ratio = gSpeciesInfo[species]?.genderRatio ?? K.MON_GENDERLESS;
  if (ratio === K.MON_MALE || ratio === K.MON_FEMALE || ratio === K.MON_GENDERLESS) return ratio;
  return ratio > (personality & 0xff) ? K.MON_FEMALE : K.MON_MALE;
}

/** CalculatePPWithBonus */
export function calculatePPWithBonus(move: number, ppBonuses: number, moveIndex: number): number {
  const basePP = gBattleMoves[move]?.pp ?? 0;
  return (basePP + Math.trunc((basePP * 20 * ((mech().gPPUpGetMask[moveIndex] & ppBonuses) >> (2 * moveIndex))) / 100)) & 0xff;
}

/** GetNatureFromPersonality */
export function getNatureFromPersonality(personality: number): number {
  return (personality >>> 0) % K.NUM_NATURES;
}

/** GetFlavorRelationByPersonality */
export function getFlavorRelationByPersonality(personality: number, flavor: number): number {
  return mech().sPokeblockFlavorCompatibilityTable[getNatureFromPersonality(personality) * K.FLAVOR_COUNT + flavor];
}

/** IsOtherTrainer: the OT id and name differ from the player's. */
export function isOtherTrainer(otId: number, otName: number[]): boolean {
  if (otId >>> 0 !== state.trainerId >>> 0) return true;
  const player = pokemon.encodeName(state.playerName);
  for (let i = 0; i < otName.length && otName[i] !== 0xff; i++) if (otName[i] !== player[i]) return true;
  return false;
}

/** HandleSetPokedexFlag (FLAG_SET_SEEN / FLAG_SET_CAUGHT; the first Unown / Spinda's personality) */
export function handleSetPokedexFlag(nationalNum: number, caseId: number, personality: number): void {
  HandleSetPokedexFlag(state, nationalNum, caseId, personality);
}

/** SpeciesToNationalPokedexNum */
export function speciesToNationalPokedexNum(species: number): number {
  return pokemon.nationalDex(species);
}

/** CountAliveMonsInBattle */
export function countAliveMonsInBattle(caseId: number): number {
  let retVal = 0;
  for (let i = 0; i < K.MAX_BATTLERS_COUNT; i++) {
    switch (caseId) {
      case K.BATTLE_ALIVE_EXCEPT_ACTIVE:
        if (i !== g.activeBattler && !(g.absentBattlerFlags & bit(i))) retVal++;
        break;
      case K.BATTLE_ALIVE_ATK_SIDE:
        if (getBattlerSide(i) === getBattlerSide(g.battlerAttacker) && !(g.absentBattlerFlags & bit(i))) retVal++;
        break;
      case K.BATTLE_ALIVE_DEF_SIDE:
        if (getBattlerSide(i) === getBattlerSide(g.battlerTarget) && !(g.absentBattlerFlags & bit(i))) retVal++;
        break;
    }
  }
  return retVal;
}

/** GetDefaultMoveTarget */
export function getDefaultMoveTarget(battlerId: number): number {
  const opposing = (getBattlerPosition(battlerId) & K.BIT_SIDE) ^ 1;
  if (!(g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE)) return getBattlerAtPosition(opposing);
  if (countAliveMonsInBattle(K.BATTLE_ALIVE_EXCEPT_ACTIVE) > 1) {
    const position = (random() & 1) === 0 ? opposing ^ 2 : opposing;
    return getBattlerAtPosition(position);
  }
  if (g.absentBattlerFlags & bit(opposing)) return getBattlerAtPosition(opposing ^ 2);
  return getBattlerAtPosition(opposing);
}

function shouldGetStatBadgeBoost(flag: string, battler: number): boolean {
  return !(g.battleTypeFlags & (K.BATTLE_TYPE_LINK | K.BATTLE_TYPE_EREADER_TRAINER)) && state.getFlag(flag) && getBattlerSide(battler) === K.B_SIDE_PLAYER;
}

function applyStatMod(mon: BattlePokemon, stat: number, statIndex: number): number {
  const r = bdata.tables.statStageRatios[mon.statStages[statIndex]];
  return Math.trunc((stat * r[0]) / r[1]);
}

/** CalculateBaseDamage (pokemon.c). attack/defense etc. are u16 like the original. */
export function calculateBaseDamage(
  attacker: BattlePokemon,
  defender: BattlePokemon,
  move: number,
  sideStatus: number,
  powerOverride: number,
  typeOverride: number,
  battlerIdAtk: number,
  battlerIdDef: number,
): number {
  let damage = 0;
  let damageHelper: number;
  g.battleMovePower = powerOverride ? powerOverride : gBattleMoves[move].power;
  const type = typeOverride ? typeOverride & K.DYNAMIC_TYPE_MASK : gBattleMoves[move].type;

  let attack = attacker.attack;
  let defense = defender.defense;
  let spAttack = attacker.spAttack;
  let spDefense = defender.spDefense;
  const u16 = (v: number) => v & 0xffff;

  let attackerHoldEffect: number, attackerHoldEffectParam: number, defenderHoldEffect: number;
  if (attacker.item === K.ITEM_ENIGMA_BERRY) {
    attackerHoldEffect = g.enigmaBerries[battlerIdAtk].holdEffect;
    attackerHoldEffectParam = g.enigmaBerries[battlerIdAtk].holdEffectParam;
  } else {
    attackerHoldEffect = itemHoldEffect(attacker.item);
    attackerHoldEffectParam = itemHoldEffectParam(attacker.item);
  }
  if (defender.item === K.ITEM_ENIGMA_BERRY) defenderHoldEffect = g.enigmaBerries[battlerIdDef].holdEffect;
  else defenderHoldEffect = itemHoldEffect(defender.item);

  if (attacker.ability === K.ABILITY_HUGE_POWER || attacker.ability === K.ABILITY_PURE_POWER) attack = u16(attack * 2);

  if (shouldGetStatBadgeBoost('FLAG_BADGE01_GET', battlerIdAtk)) attack = u16(Math.trunc((110 * attack) / 100));
  if (shouldGetStatBadgeBoost('FLAG_BADGE05_GET', battlerIdDef)) defense = u16(Math.trunc((110 * defense) / 100));
  if (shouldGetStatBadgeBoost('FLAG_BADGE07_GET', battlerIdAtk)) spAttack = u16(Math.trunc((110 * spAttack) / 100));
  if (shouldGetStatBadgeBoost('FLAG_BADGE07_GET', battlerIdDef)) spDefense = u16(Math.trunc((110 * spDefense) / 100));

  // Apply type-bonus hold item (sHoldEffectToType)
  const holdEffectToType = mech().sHoldEffectToType;
  for (let i = 0; i < holdEffectToType.length; i += 2) {
    if (attackerHoldEffect === holdEffectToType[i] && type === holdEffectToType[i + 1]) {
      if (type < K.TYPE_MYSTERY) attack = u16(Math.trunc((attack * (attackerHoldEffectParam + 100)) / 100));
      else spAttack = u16(Math.trunc((spAttack * (attackerHoldEffectParam + 100)) / 100));
      break;
    }
  }

  if (attackerHoldEffect === K.HOLD_EFFECT_CHOICE_BAND) attack = u16(Math.trunc((150 * attack) / 100));
  if (attackerHoldEffect === K.HOLD_EFFECT_SOUL_DEW && !(g.battleTypeFlags & K.BATTLE_TYPE_BATTLE_TOWER) && (attacker.species === K.SPECIES_LATIAS || attacker.species === K.SPECIES_LATIOS))
    spAttack = u16(Math.trunc((150 * spAttack) / 100));
  if (defenderHoldEffect === K.HOLD_EFFECT_SOUL_DEW && !(g.battleTypeFlags & K.BATTLE_TYPE_BATTLE_TOWER) && (defender.species === K.SPECIES_LATIAS || defender.species === K.SPECIES_LATIOS))
    spDefense = u16(Math.trunc((150 * spDefense) / 100));
  if (attackerHoldEffect === K.HOLD_EFFECT_DEEP_SEA_TOOTH && attacker.species === K.SPECIES_CLAMPERL) spAttack = u16(spAttack * 2);
  if (defenderHoldEffect === K.HOLD_EFFECT_DEEP_SEA_SCALE && defender.species === K.SPECIES_CLAMPERL) spDefense = u16(spDefense * 2);
  if (attackerHoldEffect === K.HOLD_EFFECT_LIGHT_BALL && attacker.species === K.SPECIES_PIKACHU) spAttack = u16(spAttack * 2);
  if (defenderHoldEffect === K.HOLD_EFFECT_METAL_POWDER && defender.species === K.SPECIES_DITTO) defense = u16(defense * 2);
  if (attackerHoldEffect === K.HOLD_EFFECT_THICK_CLUB && (attacker.species === K.SPECIES_CUBONE || attacker.species === K.SPECIES_MAROWAK)) attack = u16(attack * 2);
  if (defender.ability === K.ABILITY_THICK_FAT && (type === K.TYPE_FIRE || type === K.TYPE_ICE)) spAttack = Math.trunc(spAttack / 2);
  if (attacker.ability === K.ABILITY_HUSTLE) attack = u16(Math.trunc((150 * attack) / 100));
  if (attacker.ability === K.ABILITY_PLUS && abilityBattleEffects(K.ABILITYEFFECT_FIELD_SPORT, 0, K.ABILITY_MINUS, 0, 0))
    spAttack = u16(Math.trunc((150 * spAttack) / 100));
  if (attacker.ability === K.ABILITY_MINUS && abilityBattleEffects(K.ABILITYEFFECT_FIELD_SPORT, 0, K.ABILITY_PLUS, 0, 0))
    spAttack = u16(Math.trunc((150 * spAttack) / 100));
  if (attacker.ability === K.ABILITY_GUTS && attacker.status1) attack = u16(Math.trunc((150 * attack) / 100));
  if (defender.ability === K.ABILITY_MARVEL_SCALE && defender.status1) defense = u16(Math.trunc((150 * defense) / 100));
  if (type === K.TYPE_ELECTRIC && abilityBattleEffects(K.ABILITYEFFECT_FIELD_SPORT, 0, 0, K.ABILITYEFFECT_MUD_SPORT, 0))
    g.battleMovePower = Math.trunc(g.battleMovePower / 2);
  if (type === K.TYPE_FIRE && abilityBattleEffects(K.ABILITYEFFECT_FIELD_SPORT, 0, 0, K.ABILITYEFFECT_WATER_SPORT, 0))
    g.battleMovePower = Math.trunc(g.battleMovePower / 2);
  const pinch = attacker.hp <= Math.trunc(attacker.maxHP / 3);
  if (type === K.TYPE_GRASS && attacker.ability === K.ABILITY_OVERGROW && pinch) g.battleMovePower = u16(Math.trunc((150 * g.battleMovePower) / 100));
  if (type === K.TYPE_FIRE && attacker.ability === K.ABILITY_BLAZE && pinch) g.battleMovePower = u16(Math.trunc((150 * g.battleMovePower) / 100));
  if (type === K.TYPE_WATER && attacker.ability === K.ABILITY_TORRENT && pinch) g.battleMovePower = u16(Math.trunc((150 * g.battleMovePower) / 100));
  if (type === K.TYPE_BUG && attacker.ability === K.ABILITY_SWARM && pinch) g.battleMovePower = u16(Math.trunc((150 * g.battleMovePower) / 100));

  // Self-destruct / Explosion cut defense in half
  if (gBattleMoves[g.currentMove].effect === K.EFFECT_EXPLOSION) defense = Math.trunc(defense / 2);

  const crit = g.critMultiplier === 2;
  if (type < K.TYPE_MYSTERY) {
    // Critical hit: ignore the attacker's lowered attack stages / the defender's raised defense stages
    if (crit) damage = attacker.statStages[K.STAT_ATK] > K.DEFAULT_STAT_STAGE ? applyStatMod(attacker, attack, K.STAT_ATK) : attack;
    else damage = applyStatMod(attacker, attack, K.STAT_ATK);

    damage = damage * g.battleMovePower;
    damage *= Math.trunc((2 * attacker.level) / 5) + 2;

    if (crit) damageHelper = defender.statStages[K.STAT_DEF] < K.DEFAULT_STAT_STAGE ? applyStatMod(defender, defense, K.STAT_DEF) : defense;
    else damageHelper = applyStatMod(defender, defense, K.STAT_DEF);

    damage = Math.trunc(damage / damageHelper);
    damage = Math.trunc(damage / 50);

    // Burn cuts attack in half
    if (attacker.status1 & K.STATUS1_BURN && attacker.ability !== K.ABILITY_GUTS) damage = Math.trunc(damage / 2);

    // Apply Reflect
    if (sideStatus & K.SIDE_STATUS_REFLECT && g.critMultiplier === 1) {
      if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && countAliveMonsInBattle(K.BATTLE_ALIVE_DEF_SIDE) === 2) damage = 2 * Math.trunc(damage / 3);
      else damage = Math.trunc(damage / 2);
    }

    // Moves hitting both targets do half damage in double battles
    if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && gBattleMoves[move].target === K.MOVE_TARGET_BOTH && countAliveMonsInBattle(K.BATTLE_ALIVE_DEF_SIDE) === 2)
      damage = Math.trunc(damage / 2);

    // Moves always do at least 1 damage.
    if (damage === 0) damage = 1;
  }

  if (type === K.TYPE_MYSTERY) damage = 0; // is ??? type. does 0 damage.

  if (type > K.TYPE_MYSTERY) {
    if (crit) damage = attacker.statStages[K.STAT_SPATK] > K.DEFAULT_STAT_STAGE ? applyStatMod(attacker, spAttack, K.STAT_SPATK) : spAttack;
    else damage = applyStatMod(attacker, spAttack, K.STAT_SPATK);

    damage = damage * g.battleMovePower;
    damage *= Math.trunc((2 * attacker.level) / 5) + 2;

    if (crit) damageHelper = defender.statStages[K.STAT_SPDEF] < K.DEFAULT_STAT_STAGE ? applyStatMod(defender, spDefense, K.STAT_SPDEF) : spDefense;
    else damageHelper = applyStatMod(defender, spDefense, K.STAT_SPDEF);

    damage = Math.trunc(damage / damageHelper);
    damage = Math.trunc(damage / 50);

    // Apply Lightscreen
    if (sideStatus & K.SIDE_STATUS_LIGHTSCREEN && g.critMultiplier === 1) {
      if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && countAliveMonsInBattle(K.BATTLE_ALIVE_DEF_SIDE) === 2) damage = 2 * Math.trunc(damage / 3);
      else damage = Math.trunc(damage / 2);
    }

    if (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE && gBattleMoves[move].target === K.MOVE_TARGET_BOTH && countAliveMonsInBattle(K.BATTLE_ALIVE_DEF_SIDE) === 2)
      damage = Math.trunc(damage / 2);

    // Are effects of weather negated with cloud nine or air lock
    if (weatherHasEffect2()) {
      if (g.battleWeather & K.B_WEATHER_RAIN_TEMPORARY) {
        if (type === K.TYPE_FIRE) damage = Math.trunc(damage / 2);
        else if (type === K.TYPE_WATER) damage = Math.trunc((15 * damage) / 10);
      }
      // Any weather except sun weakens solar beam
      if (g.battleWeather & (K.B_WEATHER_RAIN | K.B_WEATHER_SANDSTORM | K.B_WEATHER_HAIL_TEMPORARY) && g.currentMove === K.MOVE_SOLAR_BEAM)
        damage = Math.trunc(damage / 2);
      if (g.battleWeather & K.B_WEATHER_SUN) {
        if (type === K.TYPE_FIRE) damage = Math.trunc((15 * damage) / 10);
        else if (type === K.TYPE_WATER) damage = Math.trunc(damage / 2);
      }
    }

    // Flash fire triggered
    if (g.battleResources.flags[battlerIdAtk] & K.RESOURCE_FLAG_FLASH_FIRE && type === K.TYPE_FIRE) damage = Math.trunc((15 * damage) / 10);
  }

  return damage + 2;
}

/** CopyPlayerPartyMonToBattleData */
export function copyPlayerPartyMonToBattleData(battlerId: number, partyIndex: number): void {
  const mon = g.playerParty[partyIndex]!;
  const bm = g.battleMons[battlerId];
  bm.species = mon.species;
  bm.item = mon.heldItem;
  for (let i = 0; i < K.MAX_MON_MOVES; i++) {
    bm.moves[i] = mon.moves[i];
    bm.pp[i] = mon.pp[i];
  }
  bm.ppBonuses = mon.ppBonuses;
  bm.friendship = mon.friendship;
  bm.experience = mon.exp;
  bm.hpIV = mon.ivs.hp;
  bm.attackIV = mon.ivs.attack;
  bm.defenseIV = mon.ivs.defense;
  bm.speedIV = mon.ivs.speed;
  bm.spAttackIV = mon.ivs.spAttack;
  bm.spDefenseIV = mon.ivs.spDefense;
  bm.personality = mon.personality;
  bm.status1 = mon.status;
  bm.level = mon.level;
  bm.hp = mon.hp;
  bm.maxHP = mon.maxHP;
  bm.attack = mon.stats.attack;
  bm.defense = mon.stats.defense;
  bm.speed = mon.stats.speed;
  bm.spAttack = mon.stats.spAttack;
  bm.spDefense = mon.stats.spDefense;
  bm.isEgg = mon.isEgg ? 1 : 0;
  bm.abilityNum = mon.abilityNum;
  bm.otId = mon.otId;
  bm.type1 = gSpeciesInfo[bm.species].types[0];
  bm.type2 = gSpeciesInfo[bm.species].types[1];
  bm.ability = getAbilityBySpecies(bm.species, bm.abilityNum);
  bm.nickname = [...mon.nickname, 0xff];
  bm.otName = [...pokemon.encodeName(mon.otName), 0xff];
  g.battleStruct.hpOnSwitchout[getBattlerSide(battlerId)] = bm.hp;
  for (let i = 0; i < K.NUM_BATTLE_STATS; i++) bm.statStages[i] = K.DEFAULT_STAT_STAGE;
  bm.status2 = 0;
  updateSentPokesToOpponentValue(battlerId);
  clearTemporarySpeciesSpriteData(battlerId, false);
}

/** GiveMoveToBattleMon */
export function giveMoveToBattleMon(mon: BattlePokemon, move: number): number {
  for (let i = 0; i < K.MAX_MON_MOVES; i++) {
    if (!mon.moves[i]) {
      mon.moves[i] = move;
      mon.pp[i] = gBattleMoves[move].pp;
      return move;
    }
  }
  return K.MON_HAS_MAX_MOVES;
}

/** SetMonMoveSlot */
export function setMonMoveSlot(mon: Pokemon, move: number, slot: number): void {
  mon.moves[slot] = move;
  mon.pp[slot] = gBattleMoves[move].pp;
}

/** SetBattleMonMoveSlot */
export function setBattleMonMoveSlot(mon: BattlePokemon, move: number, slot: number): void {
  mon.moves[slot] = move;
  mon.pp[slot] = gBattleMoves[move].pp;
}

/** GiveMoveToMon */
export function giveMoveToMon(mon: Pokemon, move: number): number {
  for (let i = 0; i < K.MAX_MON_MOVES; i++) {
    if (!mon.moves[i]) {
      mon.moves[i] = move;
      mon.pp[i] = gBattleMoves[move].pp;
      return move;
    }
    if (mon.moves[i] === move) return K.MON_ALREADY_KNOWS_MOVE;
  }
  return K.MON_HAS_MAX_MOVES;
}

let sLearningMoveTableID = 0;

/** MonTryLearningNewMove: the level-up learnset is [level, move] pairs in learn order. */
export function monTryLearningNewMove(mon: Pokemon, firstMove: boolean): number {
  const learnset = gSpeciesInfo[mon.species].learnset;
  const level = mon.level;
  if (firstMove) {
    sLearningMoveTableID = 0;
    while (learnset[sLearningMoveTableID]?.[0] !== level) {
      sLearningMoveTableID++;
      if (sLearningMoveTableID >= learnset.length) return K.MOVE_NONE;
    }
  }
  const entry = learnset[sLearningMoveTableID];
  if (entry && entry[0] === level) {
    g.moveToLearn = entry[1];
    sLearningMoveTableID++;
    return giveMoveToMon(mon, g.moveToLearn);
  }
  return K.MOVE_NONE;
}

/** AdjustFriendship (in battle: enigma berry from gEnigmaBerries[0]) */
export function adjustFriendship(mon: Pokemon, event: number): void {
  const species = speciesOrEgg(mon);
  const holdEffect = mon.heldItem === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[0].holdEffect : itemHoldEffect(mon.heldItem);
  if (!species || species === K.SPECIES_EGG) return;
  let friendship = mon.friendship;
  let friendshipLevel = 0;
  if (friendship >= 100) friendshipLevel++;
  if (friendship >= 200) friendshipLevel++;
  if (event === K.FRIENDSHIP_EVENT_WALKING && random() & 1) return;
  if (event === K.FRIENDSHIP_EVENT_LEAGUE_BATTLE) {
    if (!(g.battleTypeFlags & K.BATTLE_TYPE_TRAINER)) return;
    const cls = bdata.tables.trainers[g.trainerBattleOpponent_A]?.trainerClass;
    if (!(cls === K.TRAINER_CLASS_LEADER || cls === K.TRAINER_CLASS_ELITE_FOUR || cls === K.TRAINER_CLASS_CHAMPION)) return;
  }
  let delta = mech().sFriendshipEventDeltas[event * 3 + friendshipLevel];
  if (delta > 0 && holdEffect === K.HOLD_EFFECT_FRIENDSHIP_UP) delta = Math.trunc((150 * delta) / 100);
  friendship += delta;
  if (delta > 0) {
    if (mon.pokeball === K.ITEM_LUXURY_BALL) friendship++;
    if (mon.metLocation === state.currentMapSection) friendship++;
  }
  if (friendship < 0) friendship = 0;
  if (friendship > K.MAX_FRIENDSHIP) friendship = K.MAX_FRIENDSHIP;
  mon.friendship = friendship;
}

/** MonGainEVs (Pokérus doesn't exist yet, so the multiplier is always 1). */
export function monGainEVs(mon: Pokemon, defeatedSpecies: number): void {
  const keys = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'] as const;
  const yields = ['evYield_HP', 'evYield_Attack', 'evYield_Defense', 'evYield_Speed', 'evYield_SpAttack', 'evYield_SpDefense'];
  const info = gSpeciesInfo[defeatedSpecies] as unknown as Record<string, number>;
  let totalEVs = keys.reduce((n, k) => n + mon.evs[k], 0);
  for (let i = 0; i < K.NUM_STATS; i++) {
    if (totalEVs >= K.MAX_TOTAL_EVS) break;
    const multiplier = (mon.pokerus ?? 0) ? 2 : 1; // CheckPartyHasHadPokerus
    let evIncrease = (info[yields[i]] ?? 0) * multiplier;
    const holdEffect = mon.heldItem === K.ITEM_ENIGMA_BERRY ? g.enigmaBerries[0].holdEffect : itemHoldEffect(mon.heldItem);
    if (holdEffect === K.HOLD_EFFECT_MACHO_BRACE) evIncrease *= 2;
    if (totalEVs + evIncrease > K.MAX_TOTAL_EVS) evIncrease = evIncrease + K.MAX_TOTAL_EVS - (totalEVs + evIncrease);
    if (mon.evs[keys[i]] + evIncrease > K.MAX_PER_STAT_EVS) evIncrease = evIncrease + K.MAX_PER_STAT_EVS - (mon.evs[keys[i]] + evIncrease);
    mon.evs[keys[i]] = (mon.evs[keys[i]] + evIncrease) & 0xff;
    totalEVs += evIncrease;
  }
}

/** TryIncrementMonLevel (+ SetMonExpWithMaxLevelCheck) */
export function tryIncrementMonLevel(mon: Pokemon): boolean {
  const table = pokemon.tables.experience[gSpeciesInfo[mon.species].growthRate];
  const level = mon.level;
  const newLevel = level + 1;
  const capExp = () => {
    if (mon.exp > table[K.MAX_LEVEL]) mon.exp = table[K.MAX_LEVEL];
  };
  if (level < K.MAX_LEVEL) {
    if (mon.exp > table[newLevel]) {
      mon.level = newLevel;
      capExp();
      return true;
    }
    return false;
  }
  capExp();
  return false;
}

/** DeleteFirstMoveAndGiveMoveToMon */
export function deleteFirstMoveAndGiveMoveToMon(mon: Pokemon, move: number): void {
  mon.moves = [...mon.moves.slice(1, 4), move];
  mon.pp = [...mon.pp.slice(1, 4), gBattleMoves[move].pp];
  mon.ppBonuses = (mon.ppBonuses >> 2) & 0xff;
}

/** RemoveMonPPBonus */
export function removeMonPPBonus(mon: Pokemon, moveIndex: number): void {
  mon.ppBonuses &= mech().gPPUpClearMask[moveIndex];
}

/** RemoveBattleMonPPBonus */
export function removeBattleMonPPBonus(mon: BattlePokemon, moveIndex: number): void {
  mon.ppBonuses &= mech().gPPUpClearMask[moveIndex];
}

/** CalculateMonStats */
export function calculateMonStats(mon: Pokemon): void {
  pokemon.calculateStats(mon);
}

export { bit };
