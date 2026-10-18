// daycare.c's storage: the Route 5 daycare man's one mon (gSaveBlock1Ptr->route5DayCareMon) and the Four Island
// daycare (gSaveBlock1Ptr->daycare: two mons, the pending egg's personality, the egg-cycle step counter), with
// the level / cost helpers and ShouldEggHatch's per-step part. The script specials that call these are
// script/daycareSpecials.ts. Not here yet: eggs (the Four Island daycare's breeding, TriggerPendingDaycareEgg,
// GiveEggFromDaycare, ...) and the hatching scene. Mail isn't modelled, so DaycareMon has no struct DayCareMail.

import { deleteFirstMoveAndGiveMoveToMon, monTryLearningNewMove, tryIncrementMonLevel, calculateMonStats } from '../battle/pokemonBattle';
import { g } from '../battle/env';
import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEFT_ALIGN } from '../battle/stringUtil';
import type { Pokemon } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import { boxMonFromMon, boxMonRestorePP, boxMonToMon, type BoxPokemon } from '../state/PokemonStorage';

/** struct DaycareMon (without its struct DayCareMail: mail isn't modelled). */
export interface DaycareMon {
  /** struct BoxPokemon; null = empty (SPECIES_NONE). */
  mon: BoxPokemon | null;
  /** u32: steps walked since it was left, one experience point each. */
  steps: number;
}

/** struct DayCare (gSaveBlock1Ptr->daycare, the Four Island daycare). */
export interface DayCare {
  /** DAYCARE_MON_COUNT slots. */
  mons: DaycareMon[];
  /** u16: the pending egg's personality, 0 = none (IsEggPending). */
  offspringPersonality: number;
  /** u8: party eggs lose an egg cycle each time it reaches 255 (TryProduceOrHatchEgg). */
  stepCounter: number;
}

/** An empty DaycareMon (ClearDaycareMon). */
export function newDaycareMon(): DaycareMon {
  return { mon: null, steps: 0 };
}

/** An empty DayCare (ClearAllDaycareData); DAYCARE_MON_COUNT is 2. */
export function newDayCare(): DayCare {
  return { mons: [newDaycareMon(), newDaycareMon()], offspringPersonality: 0, stepCounter: 0 };
}

/** DayCare_GetBoxMonNickname: StringCopy_Nickname (at most POKEMON_NAME_LENGTH chars), without the EOS. */
export function boxMonNickname(state: GameState, mon: BoxPokemon): number[] {
  const out: number[] = [];
  for (const c of mon.nickname) {
    if (c === 0xff || out.length >= state.defines.require('POKEMON_NAME_LENGTH')) break; // EOS
    out.push(c);
  }
  return out;
}

/** CountPokemonInDaycare */
export function countPokemonInDaycare(daycare: DayCare): number {
  return daycare.mons.filter((m) => m.mon !== null).length;
}

/**
 * StorePokemonInDaycare: party slot `monIdx` goes into `daycareMon` with its PP restored and the step count
 * reset, and leaves the party (ZeroMonData + CompactPartySlots). The mail part (MonHasMail) isn't modelled.
 */
export function storePokemonInDaycare(state: GameState, monIdx: number, daycareMon: DaycareMon): void {
  const mon = state.party[monIdx];
  daycareMon.mon = boxMonFromMon(mon);
  boxMonRestorePP(state.pokemon, daycareMon.mon);
  daycareMon.steps = 0;
  state.party.splice(monIdx, 1); // ZeroMonData, CompactPartySlots, CalculatePlayerPartyCount
}

/**
 * ApplyDaycareExperience: level up one level at a time while the experience allows (TryIncrementMonLevel), with
 * each level's moves learned as they come (a mon with four moves forgets its first), then CalculateMonStats.
 */
export function applyDaycareExperience(state: GameState, mon: Pokemon): void {
  const maxLevel = state.defines.require('MAX_LEVEL');
  const MON_HAS_MAX_MOVES = state.defines.require('MON_HAS_MAX_MOVES');
  for (let i = 0; i < maxLevel; i++) {
    if (!tryIncrementMonLevel(mon)) break;
    let firstMove = true;
    let learnedMove: number;
    while ((learnedMove = monTryLearningNewMove(mon, firstMove)) !== 0) {
      firstMove = false;
      if (learnedMove === MON_HAS_MAX_MOVES) deleteFirstMoveAndGiveMoveToMon(mon, g.moveToLearn);
    }
  }
  calculateMonStats(mon);
}

/**
 * TakeSelectedPokemonFromDaycare: gStringVar1 = its nickname; the mon (BoxMonToMon: fully healed) gets one
 * experience point per step (ApplyDaycareExperience) unless it's at MAX_LEVEL, and goes into the last party slot
 * (gPlayerParty[PARTY_SIZE - 1], then CompactPartySlots: the end of the party). Returns its species.
 */
export function takeSelectedPokemonFromDaycare(state: GameState, daycareMon: DaycareMon): number {
  const boxMon = daycareMon.mon!;
  state.stringVars[0] = boxMonNickname(state, boxMon);
  const species = boxMon.species;
  const pokemon = boxMonToMon(state.pokemon, boxMon);
  if (pokemon.level !== state.defines.require('MAX_LEVEL')) {
    pokemon.exp = (pokemon.exp + daycareMon.steps) >>> 0;
    applyDaycareExperience(state, pokemon);
  }
  const partySize = state.defines.require('PARTY_SIZE');
  if (state.party.length >= partySize) state.party[partySize - 1] = pokemon;
  else state.party.push(pokemon);
  daycareMon.mon = null; // ZeroBoxMonData
  daycareMon.steps = 0;
  return species;
}

/** TakeSelectedPokemonMonFromDaycareShiftSlots's ShiftDaycareSlots: the second mon moves up into an empty first slot. */
export function shiftDaycareSlots(daycare: DayCare): void {
  const [first, second] = daycare.mons;
  if (second.mon !== null && first.mon === null) {
    first.mon = second.mon;
    second.mon = null;
    first.steps = second.steps;
    second.steps = 0;
  }
}

/** GetLevelAfterDaycareSteps: GetLevelFromBoxMonExp with `steps` more experience. */
export function getLevelAfterDaycareSteps(state: GameState, mon: BoxPokemon, steps: number): number {
  return state.pokemon.levelFromExp({ ...mon, exp: (mon.exp + steps) >>> 0 } as Pokemon);
}

/** GetNumLevelsGainedFromSteps */
export function getNumLevelsGainedFromSteps(state: GameState, daycareMon: DaycareMon): number {
  const mon = daycareMon.mon!;
  const levelBefore = state.pokemon.levelFromExp(mon as Pokemon); // GetLevelFromBoxMonExp
  const levelAfter = getLevelAfterDaycareSteps(state, mon, daycareMon.steps);
  return (levelAfter - levelBefore) & 0xff;
}

/** GetNumLevelsGainedForDaycareMon: gStringVar2 = the levels gained, gStringVar1 = its nickname. */
export function getNumLevelsGainedForDaycareMon(state: GameState, daycareMon: DaycareMon): number {
  const numLevelsGained = getNumLevelsGainedFromSteps(state, daycareMon);
  state.stringVars[1] = ConvertIntToDecimalStringN(numLevelsGained, STR_CONV_MODE_LEFT_ALIGN, 2);
  state.stringVars[0] = boxMonNickname(state, daycareMon.mon!);
  return numLevelsGained;
}

/** GetDaycareCostForSelectedMon: 100 + 100 per level gained; gStringVar1 = its nickname, gStringVar2 = the cost. */
export function getDaycareCostForSelectedMon(state: GameState, daycareMon: DaycareMon): number {
  const numLevelsGained = getNumLevelsGainedFromSteps(state, daycareMon);
  state.stringVars[0] = boxMonNickname(state, daycareMon.mon!);
  const cost = 100 + 100 * numLevelsGained;
  state.stringVars[1] = ConvertIntToDecimalStringN(cost, STR_CONV_MODE_LEFT_ALIGN, 5);
  return cost;
}

// ------------------------------------------------------------------ the Route 5 daycare

/** PutMonInRoute5Daycare: the party mon the party menu chose (GetCursorSelectionMonId). */
export function putMonInRoute5Daycare(state: GameState, monIdx: number): void {
  storePokemonInDaycare(state, monIdx, state.route5DayCareMon);
}

/** GetCostToWithdrawRoute5DaycareMon (the special leaves it in gSpecialVar_0x8005, a u16). */
export function getCostToWithdrawRoute5DaycareMon(state: GameState): number {
  return getDaycareCostForSelectedMon(state, state.route5DayCareMon) & 0xffff;
}

/** IsThereMonInRoute5Daycare */
export function isThereMonInRoute5Daycare(state: GameState): boolean {
  return state.route5DayCareMon.mon !== null;
}

/** GetNumLevelsGainedForRoute5DaycareMon */
export function getNumLevelsGainedForRoute5DaycareMon(state: GameState): number {
  return getNumLevelsGainedForDaycareMon(state, state.route5DayCareMon);
}

/** TakePokemonFromRoute5Daycare: its species. */
export function takePokemonFromRoute5Daycare(state: GameState): number {
  return takeSelectedPokemonFromDaycare(state, state.route5DayCareMon);
}

// ------------------------------------------------------------------ steps

/**
 * TryProduceOrHatchEgg: each Four Island daycare mon counts the step; every 256 steps (the u8 stepCounter
 * reaching 255) each party egg loses an egg cycle (kept in its friendship); TRUE with VAR_0x8004 = its slot when
 * one with none left should hatch. Egg production (the compatibility roll that calls TriggerPendingDaycareEgg
 * when both mons are in and the second's steps reach 0xFF) is W-daycare unit 3: nobody can leave a mon at Four
 * Island yet.
 */
function tryProduceOrHatchEgg(state: GameState, daycare: DayCare): boolean {
  for (const m of daycare.mons) {
    if (m.mon !== null) m.steps = (m.steps + 1) >>> 0; // MON_DATA_SANITY_HAS_SPECIES
  }
  // TODO(W-daycare unit 3): offspringPersonality == 0 && both mons && (mons[1].steps & 0xFF) == 0xFF → the
  // GetDaycareCompatibilityScore roll and TriggerPendingDaycareEgg.

  daycare.stepCounter = (daycare.stepCounter + 1) & 0xff;
  if (daycare.stepCounter === 255) {
    for (let i = 0; i < state.party.length; i++) {
      const mon = state.party[i];
      if (!mon.isEgg) continue; // (no bad eggs: the port never makes one)
      if (mon.friendship !== 0) {
        mon.friendship--;
      } else {
        state.setVar('VAR_0x8004', i);
        return true;
      }
    }
  }
  return false;
}

/**
 * ShouldEggHatch (TryStartStepCountScript, on every step that isn't forced): the Route 5 daycare mon counts the
 * step, then TryProduceOrHatchEgg on the Four Island daycare. TRUE when a party egg should hatch.
 */
export function shouldEggHatch(state: GameState): boolean {
  const route5 = state.route5DayCareMon;
  if (route5.mon !== null) route5.steps = (route5.steps + 1) >>> 0;
  return tryProduceOrHatchEgg(state, state.daycare);
}
