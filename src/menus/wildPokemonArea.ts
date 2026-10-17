// wild_pokemon_area.c: where the Pokédex area page puts a species' markers. Every wild encounter table
// (gWildMonHeaders, wild_encounters.json) that holds the species gives its map's region map section, which
// sDexAreas_Kanto / sDexAreas_Sevii* turn into DEX_AREA_* markers (pokedex_area_markers.c's sAreaMarkers).
// A roamer (Entei / Suicune / Raikou) has one marker, where it is now, and only if it's the one that roams in
// this game (the one paired with the player's starter). Tables: menus.json `pokedexArea`
// (tools/extract_menus.py pokedex_area_data).

import { K } from '../battle/constants';
import { state } from '../battle/env';
import type { WildEncounterData, WildPokemonHeader, WildPokemonInfo } from '../data/types';
import type { Subsprite } from '../gba/sprite';
import { GetUnlockedSeviiAreas } from '../world/regionMap';
import { roamerLocation } from '../world/roamer';
import { menusData } from './data';
import { GetAreaMarkerSubsprite } from './pokedexArea';

/** menus.json `pokedexArea` */
export interface PokedexAreaData {
  /** sDexAreas_Kanto: [MAPSEC_*, DEX_AREA_*] rows (a mapsec may map to more than one area) */
  dexAreasKanto: [number, number][];
  /** sSeviiDexAreas: sDexAreas_Sevii1..7, one table per island */
  dexAreasSevii: [number, number][][];
  /** sRoamerPairs: [roamer species, the starter it roams with] */
  roamerPairs: [number, number][];
  /** sAreaMarkers (pokedex_area_markers.c): [MARKER_*, x, y] by DEX_AREA_* */
  areaMarkers: [number, number, number][];
  /** sSubsprites (pokedex_area_markers.c): [shape, size, priority, tileOffset] by MARKER_* */
  subsprites: [number, number, number, number][];
  /** Each map header's regionMapSectionId by MAP_* id */
  mapSecs: Record<string, number>;
  /** The map at group 0 / num 0, where an unset EWRAM location (the roamer's after a reboot) points. */
  firstMap: string;
}

/** gWildMonHeaders and field_specials.c's sStarterSpecies (wild_encounters.json), set once at boot. */
let wildData: WildEncounterData | undefined;

export function initWildPokemonArea(data: WildEncounterData): void {
  wildData = data;
}

function areaData(): PokedexAreaData {
  return menusData.pokedexArea;
}

/**
 * GetSpeciesPokedexAreaMarkers: fills `subsprites` with the species' area markers (GetAreaMarkerSubsprite) and
 * returns how many there are. Altering Cave counts only with the table VAR_ALTERING_CAVE_WILD_SET picks; the
 * Sevii tables only for the islands GetUnlockedSeviiAreas has unlocked.
 */
export function GetSpeciesPokedexAreaMarkers(species: number, subsprites: Subsprite[]): number {
  if (GetRoamerIndex(species) >= 0) return GetRoamerPokedexAreaMarkers(species, subsprites);

  const d = areaData();
  const seviiAreas = GetUnlockedSeviiAreas();
  let alteringCaveCount = 0;
  let alteringCaveNum = state.getVar('VAR_ALTERING_CAVE_WILD_SET');
  if (alteringCaveNum >= wildData!.numAlteringCaveTables) alteringCaveNum = 0;
  let areaCount = 0;
  for (const header of wildData!.headers) {
    const mapSecId = GetMapSecIdFromWildMonHeader(header);
    if (mapSecId === K.MAPSEC_ALTERING_CAVE) {
      alteringCaveCount++;
      if (alteringCaveNum !== alteringCaveCount - 1) continue;
    }
    if (!IsSpeciesOnMap(header, species)) continue;
    // Search for all dex areas associated with this MAPSEC (in the vanilla game each has at most one).
    const idx = { v: 0 };
    let dexArea: number | undefined;
    while ((dexArea = FindDexAreaByMapSec(mapSecId, d.dexAreasKanto, idx)) !== undefined) {
      if (dexArea !== K.DEX_AREA_NONE) GetAreaMarkerSubsprite(areaCount++, dexArea, subsprites);
    }
    for (let j = 0; j < d.dexAreasSevii.length; j++) {
      if (((seviiAreas >> j) & 1) === 0) continue;
      idx.v = 0;
      while ((dexArea = FindDexAreaByMapSec(mapSecId, d.dexAreasSevii[j], idx)) !== undefined) {
        if (dexArea !== K.DEX_AREA_NONE) GetAreaMarkerSubsprite(areaCount++, dexArea, subsprites);
      }
    }
  }
  return areaCount;
}

/** GetRoamerIndex: the species' sRoamerPairs index, or -1. */
function GetRoamerIndex(species: number): number {
  return areaData().roamerPairs.findIndex(([roamer]) => roamer === species);
}

/** GetRoamerPokedexAreaMarkers: one marker where the roamer is, if it's this game's roamer (by the starter). */
function GetRoamerPokedexAreaMarkers(species: number, subsprites: Subsprite[]): number {
  const roamerIdx = GetRoamerIndex(species);
  if (roamerIdx < 0) return 0;
  if (areaData().roamerPairs[roamerIdx][1] !== GetStarterSpecies()) return 0;
  const mapSecId = GetRoamerLocationMapSectionId();
  const dexArea = FindDexAreaByMapSec(mapSecId, areaData().dexAreasKanto, { v: 0 });
  if (dexArea !== undefined && dexArea !== K.DEX_AREA_NONE) {
    GetAreaMarkerSubsprite(0, dexArea, subsprites);
    return 1;
  }
  return 0;
}

/**
 * IsSpeciesOnMap: land, water, fishing and Rock Smash tables. The C searches the fishing table with
 * LAND_WILD_COUNT (12 of its 10 slots); the two extra slots read the WildPokemonInfo after the array (the
 * encounter rate's padding and a ROM pointer's high half), never a species, so the table's own length gives
 * the same answer.
 */
function IsSpeciesOnMap(header: WildPokemonHeader, species: number): boolean {
  return (
    IsSpeciesInEncounterTable(header.land_mons, species) ||
    IsSpeciesInEncounterTable(header.water_mons, species) ||
    IsSpeciesInEncounterTable(header.fishing_mons, species) ||
    IsSpeciesInEncounterTable(header.rock_smash_mons, species)
  );
}

/** IsSpeciesInEncounterTable (over the table's LAND/WATER/FISH/ROCK_WILD_COUNT slots) */
function IsSpeciesInEncounterTable(info: WildPokemonInfo | undefined, species: number): boolean {
  if (!info) return false;
  return info.mons.some(([, , s]) => K[s] === species);
}

/** GetMapSecIdFromWildMonHeader: Overworld_GetMapHeaderByGroupAndId(...)->regionMapSectionId */
function GetMapSecIdFromWildMonHeader(header: WildPokemonHeader): number {
  return mapSecOfMap(header.map);
}

function mapSecOfMap(mapId: string): number {
  return areaData().mapSecs[mapId] ?? K.MAPSEC_NONE;
}

/**
 * FindDexAreaByMapSec: the DEX_AREA_* of the first row from `index.v` on whose mapsec matches (index.v is left
 * after it), or undefined (the C's FALSE).
 */
function FindDexAreaByMapSec(mapSecId: number, table: [number, number][], index: { v: number }): number | undefined {
  for (let i = index.v; i < table.length; i++) {
    if (table[i][0] === mapSecId) {
      index.v = i + 1;
      return table[i][1];
    }
  }
  return undefined;
}

/** GetStarterSpecies (field_specials.c): GetStarterSpeciesById(VAR_STARTER_MON), out of range = the first. */
function GetStarterSpecies(): number {
  const starters = wildData!.starterSpecies;
  let idx = state.getVar('VAR_STARTER_MON');
  if (idx >= starters.length) idx = 0;
  return K[starters[idx]];
}

/**
 * GetRoamerLocationMapSectionId (roamer.c): MAPSEC_NONE while no roamer is active, else its map's section.
 * The location is EWRAM (not saved), so after a reboot it's map 0/0 (`firstMap`) until the roamer moves on.
 */
function GetRoamerLocationMapSectionId(): number {
  if (!state.roamer.active) return K.MAPSEC_NONE;
  return mapSecOfMap(roamerLocation() || areaData().firstMap);
}
