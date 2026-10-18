// daycare.c's storage: the Route 5 daycare man's one mon (gSaveBlock1Ptr->route5DayCareMon) and the Four Island
// daycare (gSaveBlock1Ptr->daycare: two mons, the pending egg's personality, the egg-cycle step counter), with
// the level / cost helpers, ShouldEggHatch's per-step part, and eggs: the compatibility, the egg species,
// inherited IVs and moves, CreateEgg / ScriptGiveEgg. The script specials that call these are
// script/daycareSpecials.ts; the hatching scene is menus/eggHatch.ts. Mail isn't modelled, so DaycareMon has no
// struct DayCareMail.

import { CanMonLearnTMHM } from '../battle/items';
import { deleteFirstMoveAndGiveMoveToMon, monTryLearningNewMove, tryIncrementMonLevel, calculateMonStats } from '../battle/pokemonBattle';
import { g } from '../battle/env';
import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEFT_ALIGN } from '../battle/stringUtil';
import { setStringVar4, strBody, text } from '../menus/common';
import { menusData } from '../menus/data';
import type { Pokemon, Stat } from '../pokemon/Pokemon';
import { random } from '../util/random';
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
 * TryProduceOrHatchEgg: each Four Island daycare mon counts the step; when both are in, no egg is pending and the
 * second's steps reach 0xFF (mod 256), an egg comes with a chance of the compatibility score in 100
 * (TriggerPendingDaycareEgg). Every 256 steps (the u8 stepCounter reaching 255) each party egg loses an egg cycle
 * (kept in its friendship); TRUE with VAR_0x8004 = its slot when one with none left should hatch.
 */
function tryProduceOrHatchEgg(state: GameState, daycare: DayCare): boolean {
  let validEggs = 0;
  for (const m of daycare.mons) {
    if (m.mon !== null) {
      m.steps = (m.steps + 1) >>> 0; // MON_DATA_SANITY_HAS_SPECIES
      validEggs++;
    }
  }

  // Check if an egg should be produced
  if (daycare.offspringPersonality === 0 && validEggs === daycare.mons.length && (daycare.mons[1].steps & 0xff) === 0xff) {
    const compatibility = getDaycareCompatibilityScore(state, daycare);
    if (compatibility > Math.trunc((random() * 100) / USHRT_MAX)) triggerPendingDaycareEgg(state, daycare);
  }

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

// ------------------------------------------------------------------ the Four Island daycare

/** USHRT_MAX (TryProduceOrHatchEgg's roll) */
const USHRT_MAX = 0xffff;

const def = (state: GameState, name: string) => state.defines.require(name);

/** GetBoxMonGender */
function boxMonGender(state: GameState, mon: BoxPokemon): number {
  return state.pokemon.genderFromPersonality(mon.species, mon.personality);
}

/** Daycare_FindEmptySpot: the first empty slot, or -1. */
function daycareFindEmptySpot(daycare: DayCare): number {
  return daycare.mons.findIndex((m) => m.mon === null);
}

/** StoreSelectedPokemonInDaycare (StorePokemonInEmptyDaycareSlot): the party mon the party menu chose. */
export function storeSelectedPokemonInDaycare(state: GameState, monIdx: number): void {
  storePokemonInDaycare(state, monIdx, state.daycare.mons[daycareFindEmptySpot(state.daycare)]);
}

/** TakePokemonFromDaycare (TakeSelectedPokemonMonFromDaycareShiftSlots): slot `slotId` (VAR_0x8004); its species. */
export function takePokemonFromDaycare(state: GameState, slotId: number): number {
  const species = takeSelectedPokemonFromDaycare(state, state.daycare.mons[slotId]);
  shiftDaycareSlots(state.daycare);
  return species;
}

/** GetDaycareCost (GetDaycareCostForMon): the cost for slot `slotId`, as the u16 the special leaves in VAR_0x8005. */
export function getDaycareCost(state: GameState, slotId: number): number {
  return getDaycareCostForSelectedMon(state, state.daycare.mons[slotId]) & 0xffff;
}

/** GetNumLevelsGainedFromDaycare: slot `slotId`'s levels gained (gStringVar1/2 set), 0 for an empty slot. */
export function getNumLevelsGainedFromDaycare(state: GameState, slotId: number): number {
  const daycareMon = state.daycare.mons[slotId];
  if (daycareMon.mon !== null) return getNumLevelsGainedForDaycareMon(state, daycareMon);
  return 0;
}

/** IsEggPending */
export function isEggPending(daycare: DayCare): boolean {
  return daycare.offspringPersonality !== 0;
}

/**
 * _GetDaycareMonNicknames: gStringVar1 = the first mon's nickname, gStringVar3 = its OT's name, gStringVar2 = the
 * second mon's nickname (each only when the slot is filled).
 */
export function getDaycareMonNicknames(state: GameState): void {
  const [first, second] = state.daycare.mons;
  if (first.mon !== null) {
    state.stringVars[0] = boxMonNickname(state, first.mon);
    state.stringVars[2] = state.pokemon.encodeName(first.mon.otName);
  }
  if (second.mon !== null) state.stringVars[1] = boxMonNickname(state, second.mon);
}

/** GetDaycareState: DAYCARE_EGG_WAITING, DAYCARE_ONE_MON, DAYCARE_TWO_MONS or DAYCARE_NO_MONS. */
export function getDaycareState(state: GameState): number {
  if (isEggPending(state.daycare)) return def(state, 'DAYCARE_EGG_WAITING');
  const numMons = countPokemonInDaycare(state.daycare);
  if (numMons !== 0) return numMons + 1; // DAYCARE_ONE_MON or DAYCARE_TWO_MONS
  return def(state, 'DAYCARE_NO_MONS');
}

/** GetDaycarePokemonCount */
export function getDaycarePokemonCount(state: GameState): number {
  return countPokemonInDaycare(state.daycare);
}

// ------------------------------------------------------------------ compatibility

/** EggGroupsOverlap: do the two EGG_GROUPS_PER_MON lists share a group? */
export function eggGroupsOverlap(eggGroups1: number[], eggGroups2: number[]): boolean {
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      if (eggGroups1[i] === eggGroups2[j]) return true;
    }
  }
  return false;
}

/** GetDaycareCompatibilityScore: PARENTS_INCOMPATIBLE (0), _LOW (20), _MED (50) or _MAX (70). */
export function getDaycareCompatibilityScore(state: GameState, daycare: DayCare): number {
  const species: number[] = [];
  const trainerIds: number[] = [];
  const genders: number[] = [];
  const eggGroups: number[][] = [];
  for (const m of daycare.mons) {
    const mon = m.mon;
    const sp = mon?.species ?? 0;
    species.push(sp);
    trainerIds.push(mon ? mon.otId >>> 0 : 0);
    genders.push(state.pokemon.genderFromPersonality(sp, mon?.personality ?? 0));
    eggGroups.push([...(state.pokemon.species[sp].eggGroups ?? [0, 0])]);
  }
  const INCOMPATIBLE = def(state, 'PARENTS_INCOMPATIBLE');
  const LOW = def(state, 'PARENTS_LOW_COMPATIBILITY');
  const MED = def(state, 'PARENTS_MED_COMPATIBILITY');
  const MAX = def(state, 'PARENTS_MAX_COMPATIBILITY');
  const UNDISCOVERED = def(state, 'EGG_GROUP_UNDISCOVERED');
  const DITTO = def(state, 'EGG_GROUP_DITTO');

  // check unbreedable egg group
  if (eggGroups[0][0] === UNDISCOVERED || eggGroups[1][0] === UNDISCOVERED) return INCOMPATIBLE;
  // two Ditto can't breed
  if (eggGroups[0][0] === DITTO && eggGroups[1][0] === DITTO) return INCOMPATIBLE;

  // one parent is Ditto
  if (eggGroups[0][0] === DITTO || eggGroups[1][0] === DITTO) {
    if (trainerIds[0] === trainerIds[1]) return LOW;
    return MED;
  }
  // neither parent is Ditto
  if (genders[0] === genders[1]) return INCOMPATIBLE;
  const GENDERLESS = def(state, 'MON_GENDERLESS');
  if (genders[0] === GENDERLESS || genders[1] === GENDERLESS) return INCOMPATIBLE;
  if (!eggGroupsOverlap(eggGroups[0], eggGroups[1])) return INCOMPATIBLE;

  if (species[0] === species[1]) {
    if (trainerIds[0] === trainerIds[1]) return MED; // same species, same trainer
    return MAX; // same species, different trainers
  }
  if (trainerIds[0] !== trainerIds[1]) return MED; // different species, different trainers
  return LOW; // different species, same trainer
}

/** sCompatibilityMessages */
const COMPATIBILITY_MESSAGES = ['gDaycareText_GetAlongVeryWell', 'gDaycareText_GetAlong', 'gDaycareText_DontLikeOther', 'gDaycareText_PlayOther'];

/** SetDaycareCompatibilityString: gStringVar4 = how well the two get along. Returns the sCompatibilityMessages index. */
export function setDaycareCompatibilityString(state: GameState): number {
  const relationshipScore = getDaycareCompatibilityScore(state, state.daycare);
  let whichString = 0;
  if (relationshipScore === def(state, 'PARENTS_INCOMPATIBLE')) whichString = 3;
  if (relationshipScore === def(state, 'PARENTS_LOW_COMPATIBILITY')) whichString = 2;
  if (relationshipScore === def(state, 'PARENTS_MED_COMPATIBILITY')) whichString = 1;
  if (relationshipScore === def(state, 'PARENTS_MAX_COMPATIBILITY')) whichString = 0;
  setStringVar4([...text(COMPATIBILITY_MESSAGES[whichString])]); // StringCopy
  return whichString;
}

// ------------------------------------------------------------------ the egg

/**
 * GetEggSpecies: back through gEvolutionTable (up to EVOS_PER_MON times) to the species nothing evolves into.
 */
export function getEggSpecies(state: GameState, species: number): number {
  const EVOS_PER_MON = def(state, 'EVOS_PER_MON');
  const NUM_SPECIES = def(state, 'NUM_SPECIES');
  for (let i = 0; i < EVOS_PER_MON; i++) {
    let j: number;
    let found = false;
    for (j = 1; j < NUM_SPECIES; j++) {
      for (const [, , targetSpecies] of menusData.evolutions[j] ?? []) {
        if (targetSpecies === species) {
          species = j;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (j === NUM_SPECIES) break;
  }
  return species;
}

/** _TriggerPendingDaycareEgg: a u16 personality of 1..0xFFFE (FRLG left out the Everstone's nature). */
export function triggerPendingDaycareEgg(state: GameState, daycare: DayCare): void {
  daycare.offspringPersonality = (random() % 0xfffe) + 1;
  state.setFlag('FLAG_PENDING_DAYCARE_EGG');
}

/** _TriggerPendingDaycareMaleEgg (unused by the scripts): EGG_GENDER_MALE set. */
export function triggerPendingDaycareMaleEgg(state: GameState, daycare: DayCare): void {
  daycare.offspringPersonality = (random() | def(state, 'EGG_GENDER_MALE')) & 0xffff;
  state.setFlag('FLAG_PENDING_DAYCARE_EGG');
}

/** RemoveEggFromDayCare */
export function removeEggFromDayCare(daycare: DayCare): void {
  daycare.offspringPersonality = 0;
  daycare.stepCounter = 0;
}

/** RejectEggFromDayCare */
export function rejectEggFromDayCare(state: GameState): void {
  removeEggFromDayCare(state.daycare);
}

/**
 * RemoveIVIndexFromList, as the C writes it: it clears the entry at index `selectedIv` (the stat id, not its
 * position in the shrinking list), so after the first pick a different stat can drop out and one can come twice.
 */
function removeIVIndexFromList(ivs: number[], selectedIv: number): void {
  ivs[selectedIv] = 0xff;
  const temp = [...ivs];
  let j = 0;
  for (let i = 0; i < temp.length; i++) {
    if (temp[i] !== 0xff) ivs[j++] = temp[i];
  }
}

/** IV order of MON_DATA_HP_IV .. MON_DATA_SPDEF_IV in InheritIVs' switch. */
const IV_STATS: Stat[] = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'];

/** InheritIVs: INHERITED_IV_COUNT random stats each copy a random parent's IV. */
export function inheritIVs(state: GameState, egg: Pokemon, daycare: DayCare): void {
  const NUM_STATS = def(state, 'NUM_STATS');
  const INHERITED_IV_COUNT = def(state, 'INHERITED_IV_COUNT');
  const availableIVs = Array.from({ length: NUM_STATS }, (_, i) => i);
  const selectedIvs: number[] = [];
  const whichParent: number[] = [];
  // Select the 3 IVs that will be inherited.
  for (let i = 0; i < INHERITED_IV_COUNT; i++) {
    selectedIvs[i] = availableIVs[random() % (NUM_STATS - i)];
    removeIVIndexFromList(availableIVs, selectedIvs[i]);
  }
  // Determine which parent each of the selected IVs should inherit from.
  for (let i = 0; i < INHERITED_IV_COUNT; i++) whichParent[i] = random() % daycare.mons.length;
  // Set each of inherited IVs on the egg mon.
  for (let i = 0; i < INHERITED_IV_COUNT; i++) {
    const stat = IV_STATS[selectedIvs[i]];
    if (stat === undefined) continue; // the switch has no case for 0xFF
    egg.ivs[stat] = daycare.mons[whichParent[i]].mon!.ivs[stat];
  }
}

/** GetEggMoves: the species' gEggMoves block (at most EGG_MOVES_ARRAY_COUNT moves). */
export function getEggMoves(state: GameState, species: number): number[] {
  const { eggMoves: gEggMoves, eggMovesSpeciesOffset: OFFSET } = state.pokemon.tables;
  let eggMoveIdx = 0;
  for (let i = 0; i < gEggMoves.length - 1; i++) {
    if (gEggMoves[i] === species + OFFSET) {
      eggMoveIdx = i + 1;
      break;
    }
  }
  const eggMoves: number[] = [];
  for (let i = 0; i < def(state, 'EGG_MOVES_ARRAY_COUNT'); i++) {
    if (gEggMoves[eggMoveIdx + i] > OFFSET) break;
    eggMoves.push(gEggMoves[eggMoveIdx + i]);
  }
  return eggMoves;
}

/** GetLevelUpMovesBySpecies: the first MAX_LEVEL_UP_MOVES of the species' level-up moves, at any level. */
function getLevelUpMovesBySpecies(state: GameState, species: number): number[] {
  return state.pokemon.species[species].learnset.slice(0, def(state, 'MAX_LEVEL_UP_MOVES')).map(([, move]) => move);
}

/** GiveMoveToMon, and DeleteFirstMoveAndGiveMoveToMon when it has four. */
function giveOrPushMove(state: GameState, egg: Pokemon, move: number): void {
  if (state.pokemon.giveMove(egg, move) === 'full') deleteFirstMoveAndGiveMoveToMon(egg, move);
}

/**
 * BuildEggMoveset: on top of the egg's level-5 moves, the father's moves that are the species' egg moves, then
 * the father's TM/HM moves the egg can learn, then the moves both parents know that the species learns by level
 * up; each pushes the first move out when it already has four.
 */
export function buildEggMoveset(state: GameState, egg: Pokemon, father: BoxPokemon, mother: BoxPokemon): void {
  const MAX_MON_MOVES = def(state, 'MAX_MON_MOVES');
  const levelUpMoves = getLevelUpMovesBySpecies(state, egg.species);
  const fatherMoves = Array.from({ length: MAX_MON_MOVES }, (_, i) => father.moves[i] ?? 0);
  const motherMoves = Array.from({ length: MAX_MON_MOVES }, (_, i) => mother.moves[i] ?? 0);
  const finalMoves = new Array<number>(MAX_MON_MOVES).fill(0);
  const eggMoves = getEggMoves(state, egg.species);

  for (let i = 0; i < MAX_MON_MOVES; i++) {
    if (fatherMoves[i] === 0) break;
    if (eggMoves.includes(fatherMoves[i])) giveOrPushMove(state, egg, fatherMoves[i]);
  }
  const numTMHMs = def(state, 'NUM_TECHNICAL_MACHINES') + def(state, 'NUM_HIDDEN_MACHINES');
  for (let i = 0; i < MAX_MON_MOVES; i++) {
    if (fatherMoves[i] === 0) continue;
    for (let j = 0; j < numTMHMs; j++) {
      // ItemIdToBattleMoveId(ITEM_TM01 + j)
      if (fatherMoves[i] === menusData.tmhmMoves[j] && CanMonLearnTMHM(egg, j)) giveOrPushMove(state, egg, fatherMoves[i]);
    }
  }
  let numSharedParentMoves = 0;
  for (let i = 0; i < MAX_MON_MOVES; i++) {
    if (fatherMoves[i] === 0) break;
    for (let j = 0; j < MAX_MON_MOVES; j++) {
      if (fatherMoves[i] === motherMoves[j] && fatherMoves[i] !== 0) finalMoves[numSharedParentMoves++] = fatherMoves[i];
    }
  }
  for (let i = 0; i < MAX_MON_MOVES; i++) {
    if (finalMoves[i] === 0) break;
    for (const move of levelUpMoves) {
      if (move !== 0 && finalMoves[i] === move) {
        giveOrPushMove(state, egg, finalMoves[i]);
        break;
      }
    }
  }
}

/** AlterEggSpeciesWithIncenseItem: Wynaut / Azurill only with a parent holding Lax / Sea Incense. */
export function alterEggSpeciesWithIncenseItem(state: GameState, species: number, daycare: DayCare): number {
  const WYNAUT = def(state, 'SPECIES_WYNAUT');
  const AZURILL = def(state, 'SPECIES_AZURILL');
  if (species === WYNAUT || species === AZURILL) {
    const motherItem = daycare.mons[0].mon?.heldItem ?? 0;
    const fatherItem = daycare.mons[1].mon?.heldItem ?? 0;
    const LAX = def(state, 'ITEM_LAX_INCENSE');
    const SEA = def(state, 'ITEM_SEA_INCENSE');
    if (species === WYNAUT && motherItem !== LAX && fatherItem !== LAX) species = def(state, 'SPECIES_WOBBUFFET');
    if (species === AZURILL && motherItem !== SEA && fatherItem !== SEA) species = def(state, 'SPECIES_MARILL');
  }
  return species;
}

/**
 * DetermineEggSpeciesAndParentSlots: [species, [mother slot, father slot]]. The mother is the female or the
 * Ditto's partner; the egg is her species' first stage (a male egg turns Nidoran♀ into Nidoran♂ and Illumise into
 * Volbeat); then Ditto becomes the "mother" if its partner isn't female.
 */
export function determineEggSpeciesAndParentSlots(state: GameState, daycare: DayCare): [number, number[]] {
  const DITTO = def(state, 'SPECIES_DITTO');
  const parentSlots = [0, 1]; // uninitialised in the C when neither is female nor Ditto (never compatible)
  const species: number[] = [];
  for (let i = 0; i < daycare.mons.length; i++) {
    const mon = daycare.mons[i].mon!;
    species[i] = mon.species;
    if (species[i] === DITTO) {
      parentSlots[0] = i ^ 1;
      parentSlots[1] = i;
    } else if (boxMonGender(state, mon) === def(state, 'MON_FEMALE')) {
      parentSlots[0] = i;
      parentSlots[1] = i ^ 1;
    }
  }

  let eggSpecies = getEggSpecies(state, species[parentSlots[0]]);
  const male = (daycare.offspringPersonality & def(state, 'EGG_GENDER_MALE')) !== 0;
  if (eggSpecies === def(state, 'SPECIES_NIDORAN_F') && male) eggSpecies = def(state, 'SPECIES_NIDORAN_M');
  if (eggSpecies === def(state, 'SPECIES_ILLUMISE') && male) eggSpecies = def(state, 'SPECIES_VOLBEAT');

  // Make Ditto the "mother" slot if the other daycare mon is male.
  if (species[parentSlots[1]] === DITTO && boxMonGender(state, daycare.mons[parentSlots[0]].mon!) !== def(state, 'MON_FEMALE')) {
    const ditto = parentSlots[1];
    parentSlots[1] = parentSlots[0];
    parentSlots[0] = ditto;
  }
  return [eggSpecies, parentSlots];
}

/** sJapaneseEggNickname (タマゴ, "egg"), encoded without EOS. */
function eggNickname(): number[] {
  return strBody(text('sJapaneseEggNickname'));
}

/**
 * The part CreateEgg and SetInitialEggData share: CreateMon at EGG_HATCH_LEVEL with random IVs and the player as
 * OT (met here), then a Poké Ball, the Japanese egg nickname, the species' egg cycles in its friendship, met
 * level 0. (MON_DATA_LANGUAGE = LANGUAGE_JAPANESE isn't modelled.)
 */
function createEggMon(state: GameState, species: number, personality: number | undefined): Pokemon {
  const mon = state.pokemon.createMon(species, def(state, 'EGG_HATCH_LEVEL'), {
    personality, // undefined: CreateMon's Random32()
    otId: state.trainerId, // OT_ID_PLAYER_ID
    otName: state.playerName,
    otGender: state.playerGender,
    metLocation: state.currentMapSection, // GetCurrentRegionMapSectionId
  });
  mon.pokeball = def(state, 'ITEM_POKE_BALL');
  mon.nickname = eggNickname();
  mon.friendship = state.pokemon.species[species].eggCycles;
  mon.metLevel = 0;
  return mon;
}

/**
 * CreateEgg: an egg of `species` with a random personality (ScriptGiveEgg; the hatching code's helper too).
 * `setHotSpringsLocation` marks it METLOC_SPECIAL_EGG, as an egg someone gave you.
 */
export function createEgg(state: GameState, species: number, setHotSpringsLocation: boolean): Pokemon {
  const mon = createEggMon(state, species, undefined);
  if (setHotSpringsLocation) mon.metLocation = 'METLOC_SPECIAL_EGG';
  mon.isEgg = true;
  return mon;
}

/** SetInitialEggData: the pending egg's personality in the low half, Random() in the high half. */
function setInitialEggData(state: GameState, species: number, daycare: DayCare): Pokemon {
  const personality = (daycare.offspringPersonality | (random() << 16)) >>> 0;
  return createEggMon(state, species, personality);
}

/**
 * _GiveEggFromDaycare (GiveEggFromDaycare): the egg (species, incense, IVs, moves) joins the end of the party (the
 * script checked there's room) and the daycare's pending egg is cleared. Returns the egg.
 */
export function giveEggFromDaycare(state: GameState): Pokemon {
  const daycare = state.daycare;
  let [species, parentSlots] = determineEggSpeciesAndParentSlots(state, daycare);
  species = alterEggSpeciesWithIncenseItem(state, species, daycare);
  const egg = setInitialEggData(state, species, daycare);
  inheritIVs(state, egg, daycare);
  buildEggMoveset(state, egg, daycare.mons[parentSlots[1]].mon!, daycare.mons[parentSlots[0]].mon!);
  egg.isEgg = true; // (its party stats stay CreateMon's, from before InheritIVs, as on the GBA)
  const partySize = def(state, 'PARTY_SIZE');
  if (state.party.length >= partySize) state.party[partySize - 1] = egg;
  else state.party.push(egg); // gPlayerParty[PARTY_SIZE - 1] = egg; CompactPartySlots
  removeEggFromDayCare(daycare);
  return egg;
}

/**
 * ScriptGiveEgg (script_pokemon_util.c, `giveegg`): CreateEgg with the special-egg met location, then
 * GiveMonToPlayer. Returns MON_GIVEN_TO_PARTY, MON_GIVEN_TO_PC or MON_CANT_GIVE.
 */
export function scriptGiveEgg(state: GameState, species: number): number {
  const mon = createEgg(state, species, true);
  return state.giveMon(mon);
}

// ------------------------------------------------------------------ gender symbols (the level menu)

/** NameHasGenderSymbol: the name has only ♂ (genderRatio MON_MALE) / only ♀ (MON_FEMALE) symbols. */
export function nameHasGenderSymbol(state: GameState, name: number[], genderRatio: number): boolean {
  const CHAR_MALE = def(state, 'CHAR_MALE');
  const CHAR_FEMALE = def(state, 'CHAR_FEMALE');
  let males = 0;
  let females = 0;
  for (const c of name) {
    if (c === 0xff) break; // EOS
    if (c === CHAR_MALE) males++;
    if (c === CHAR_FEMALE) females++;
  }
  if (genderRatio === def(state, 'MON_MALE') && males !== 0 && females === 0) return true;
  if (genderRatio === def(state, 'MON_FEMALE') && females !== 0 && males === 0) return true;
  return false;
}

/**
 * AppendGenderSymbol (trade.c's gText_MaleSymbol4 / gText_FemaleSymbol4 / gText_GenderlessSymbol), on a name
 * without EOS. As in the C, a male or female name that already has its symbol gets the genderless (empty) one.
 */
export function appendGenderSymbol(state: GameState, name: number[], gender: number): number[] {
  if (gender === def(state, 'MON_MALE')) {
    if (!nameHasGenderSymbol(state, name, gender)) return [...name, ...strBody(text('gText_MaleSymbol4'))];
  } else if (gender === def(state, 'MON_FEMALE')) {
    if (!nameHasGenderSymbol(state, name, gender)) return [...name, ...strBody(text('gText_FemaleSymbol4'))];
  }
  return [...name, ...strBody(text('gText_GenderlessSymbol'))];
}

/** AppendMonGenderSymbol */
export function appendMonGenderSymbol(state: GameState, name: number[], mon: BoxPokemon): number[] {
  return appendGenderSymbol(state, name, boxMonGender(state, mon));
}
