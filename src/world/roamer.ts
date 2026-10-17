import type { WildEncounterData } from '../data/types';
import type { Pokemon } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import { random } from '../util/random';

// roamer.c. The roamer itself (ROAMER) is saved in GameState; where it is and the player's last three
// maps are EWRAM statics, as here. Locations are MAP_* ids ('' = none yet, the C's group/num 0/0); every
// roamer map is in ROAMER_MAP_GROUP, so comparing ids is the C's group + num comparison.

let sRoamerLocations: string[][] = [];
let numLocationsPerSet = 0;
let sStarterSpecies: string[] = [];

/** sRoamerLocation */
let sRoamerLocation = '';
/** sLocationHistory: the player's last three maps, newest first. */
const sLocationHistory = ['', '', ''];

/** The extracted sRoamerLocations / sStarterSpecies (once, at boot). */
export function initRoamerTables(data: WildEncounterData): void {
  sRoamerLocations = data.roamerLocations;
  numLocationsPerSet = data.roamerLocationsPerSet;
  sStarterSpecies = data.starterSpecies;
}

/** NUM_LOCATION_SETS */
function numLocationSets(): number {
  return sRoamerLocations.length;
}

/** ClearRoamerData */
function clearRoamerData(state: GameState): void {
  state.roamer = { ivs: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 }, personality: 0, species: 0, hp: 0, level: 0, status: 0, active: false };
  sRoamerLocation = '';
  sLocationHistory.fill('');
}

/**
 * GetStarterSpecies (field_specials.c): GetStarterSpeciesById(VAR_STARTER_MON), the first starter when the var
 * is out of range.
 */
export function GetStarterSpecies(state: GameState): number {
  let idx = state.getVar('VAR_STARTER_MON');
  if (idx >= sStarterSpecies.length) idx = 0;
  return state.defines.require(sStarterSpecies[idx]);
}

/** GetRoamerSpecies: Raikou, or Entei with Bulbasaur, Suicune with Charmander (GetStarterSpecies). */
function getRoamerSpecies(state: GameState): number {
  const d = state.defines;
  switch (GetStarterSpecies(state)) {
    case d.require('SPECIES_BULBASAUR'):
      return d.require('SPECIES_ENTEI');
    case d.require('SPECIES_CHARMANDER'):
      return d.require('SPECIES_SUICUNE');
    default:
      return d.require('SPECIES_RAIKOU');
  }
}

/** CreateInitialRoamerMon: a Lv50 mon with random IVs and personality, placed at a random set's first map. */
function createInitialRoamerMon(state: GameState): void {
  const species = getRoamerSpecies(state);
  const mon = state.pokemon.createMon(species, 50, playerOt(state)); // USE_RANDOM_IVS, random personality, OT_ID_PLAYER_ID
  state.roamer = { ivs: { ...mon.ivs }, personality: mon.personality, species, hp: mon.maxHP, level: 50, status: 0, active: true };
  sRoamerLocation = sRoamerLocations[random() % numLocationSets()][0];
}

/** InitRoamer (special, after the Network Machine is fixed on One Island) */
export function initRoamer(state: GameState): void {
  clearRoamerData(state);
  createInitialRoamerMon(state);
}

/** UpdateLocationHistoryForRoamer: on every map load. */
export function updateLocationHistoryForRoamer(state: GameState): void {
  sLocationHistory[2] = sLocationHistory[1];
  sLocationHistory[1] = sLocationHistory[0];
  sLocationHistory[0] = state.currentMapId;
}

/** RoamerMoveToOtherLocationSet: jump to the first map of a set that doesn't start where it is. */
export function roamerMoveToOtherLocationSet(state: GameState): void {
  if (!state.roamer.active) return;
  for (;;) {
    const mapNum = sRoamerLocations[random() % numLocationSets()][0];
    if (sRoamerLocation !== mapNum) {
      sRoamerLocation = mapNum;
      return;
    }
  }
}

/** RoamerMove: 1 in 16 a jump to another set, else a neighbouring map not visited two maps ago. */
export function roamerMove(state: GameState): void {
  if (random() % 16 === 0) {
    roamerMoveToOtherLocationSet(state);
    return;
  }
  if (!state.roamer.active) return;
  for (const set of sRoamerLocations) {
    if (sRoamerLocation !== set[0]) continue;
    let mapNum: string | undefined;
    for (;;) {
      // Choose a new map (excluding the first) within this set; empty slots are MAP_UNDEFINED
      mapNum = set[(random() % (numLocationsPerSet - 1)) + 1];
      if (sLocationHistory[2] !== mapNum && mapNum !== undefined) break;
    }
    sRoamerLocation = mapNum;
    return;
  }
}

/** IsRoamerAt */
function isRoamerAt(state: GameState, mapId: string): boolean {
  return state.roamer.active && sRoamerLocation !== '' && mapId === sRoamerLocation;
}

/** CreateRoamerMonInstance: gEnemyParty[0] from the saved roamer (CreateMonWithIVsPersonality + its HP and status). */
function createRoamerMonInstance(state: GameState): Pokemon {
  const r = state.roamer;
  const mon = state.pokemon.createMon(r.species, r.level, { ...playerOt(state), fixedIV: 0, personality: r.personality });
  mon.ivs = { ...r.ivs };
  state.pokemon.calculateStats(mon);
  // SetMonData(MON_DATA_STATUS, &ROAMER->status) reads status plus the contest stats after it as a u32;
  // those are always 0 in FRLG, so only the saved byte comes back.
  mon.status = r.status;
  mon.hp = r.hp;
  return mon;
}

/** TryStartRoamerEncounter: 1 in 4 when the roamer is on this map; the mon to battle, or undefined. */
export function tryStartRoamerEncounter(state: GameState): Pokemon | undefined {
  if (isRoamerAt(state, state.currentMapId) && random() % 4 === 0) return createRoamerMonInstance(state);
  return undefined;
}

/** UpdateRoamerHPStatus: after a roamer battle, keep its HP and status, and send it elsewhere. */
export function updateRoamerHPStatus(state: GameState, mon: Pokemon): void {
  state.roamer.hp = mon.hp;
  state.roamer.status = mon.status & 0xff; // ROAMER->status is a u8
  roamerMoveToOtherLocationSet(state);
}

/** SetRoamerInactive */
export function setRoamerInactive(state: GameState): void {
  state.roamer.active = false;
}

/** The roamer's current map (GetRoamerLocation), for tests. */
export function roamerLocation(): string {
  return sRoamerLocation;
}

/** OT_ID_PLAYER_ID: CreateBoxMon copies the player's id, name and gender. */
function playerOt(state: GameState) {
  return { otId: state.trainerId, otName: state.playerName, otGender: state.playerGender, metLocation: state.currentMapSection };
}
