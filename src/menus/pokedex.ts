// pokedex.c and the Pokédex data (public/gen/pokedex.json, tools/extract_pokedex.py): gPokedexEntries,
// pokedex_orders.h, pokedex_categories.h and gMonFootprintTable, plus pokedex_screen.c's
// DexScreen_GetSetPokedexFlag, which pokedex.c's GetSetPokedexFlag wraps.
//
// The Pokédex flags live in GameState (`dexSeen` / `dexCaught`, national dex numbers). The C keeps the seen bits
// three times (gSaveBlock2Ptr->pokedex.seen, gSaveBlock1Ptr->seen1 / seen2) for its anticheat; the port keeps one
// copy, so the anticheat's checks reduce to "caught counts only if also seen".

import type { GameState } from '../state/GameState';

/** gPokedexEntries[n] (struct PokedexEntry): strings are raw decomp text with the EOS `$`. */
export interface PokedexEntry {
  categoryName: string;
  height: number;
  weight: number;
  description: string;
  pokemonScale: number;
  pokemonOffset: number;
  trainerScale: number;
  trainerOffset: number;
}

export interface PokedexData {
  /** gPokedexEntries by national dex number (0 = NATIONAL_DEX_NONE) */
  entries: PokedexEntry[];
  orders: {
    /** gPokedexOrder_Alphabetical: national dex numbers (incl. the old Unown letters past NATIONAL_DEX_COUNT) */
    alphabetical: number[];
    /** gPokedexOrder_Weight: national dex numbers */
    weight: number[];
    /** gPokedexOrder_Height: national dex numbers */
    height: number[];
    /** gPokedexOrder_Type: species */
    type: number[];
  };
  /** gDexCategories[DEX_CATEGORY_*].page[n].species */
  categories: number[][][];
  /** gMonFootprintTable: species -> gMonFootprint_* graphics symbol (1bpp, 2x2 tiles) */
  footprints: string[];
}

export let pokedexData: PokedexData;
let loading: Promise<PokedexData> | undefined;

export async function loadPokedexData(base: string): Promise<PokedexData> {
  loading ??= fetch(`${base}/pokedex.json`).then((res) => {
    if (!res.ok) throw new Error(`Failed to load pokedex.json: ${res.status}`);
    return res.json() as Promise<PokedexData>;
  });
  pokedexData = await loading;
  return pokedexData;
}

// enum { FLAG_GET_SEEN, FLAG_GET_CAUGHT, FLAG_SET_SEEN, FLAG_SET_CAUGHT } (include/pokedex.h)
export const FLAG_GET_SEEN = 0;
export const FLAG_GET_CAUGHT = 1;
export const FLAG_SET_SEEN = 2;
export const FLAG_SET_CAUGHT = 3;

/** NationalPokedexNumToSpecies (pokemon.c), by a reverse lookup of the species' national dex numbers. */
export function NationalPokedexNumToSpecies(state: GameState, nationalNum: number): number {
  const table = nationalToSpecies(state);
  return table[nationalNum] ?? 0;
}

let sNationalToSpecies: { species: readonly unknown[]; table: number[] } | undefined;
function nationalToSpecies(state: GameState): number[] {
  const species = state.pokemon.species;
  if (sNationalToSpecies?.species !== species) {
    const table: number[] = [];
    // NationalPokedexNumToSpecies: the first species with that number (SPECIES_NONE..)
    species.forEach((s, id) => {
      const n = s?.nationalDex;
      if (n && table[n] === undefined) table[n] = id;
    });
    sNationalToSpecies = { species, table };
  }
  return sNationalToSpecies.table;
}

/** DexScreen_GetSetPokedexFlag (pokedex_screen.c) */
export function DexScreen_GetSetPokedexFlag(state: GameState, nationalDexNo: number, caseId: number, indexIsSpecies: boolean): boolean {
  if (indexIsSpecies) nationalDexNo = state.pokemon.nationalDex(nationalDexNo);
  switch (caseId) {
    case FLAG_GET_SEEN:
      return state.dexSeen.has(nationalDexNo);
    case FLAG_GET_CAUGHT:
      // Anticheat: owned only counts if the seen bits agree
      return state.dexCaught.has(nationalDexNo) && state.dexSeen.has(nationalDexNo);
    case FLAG_SET_SEEN:
      state.setDexFlags(nationalDexNo, true, false);
      break;
    case FLAG_SET_CAUGHT:
      state.setDexFlags(nationalDexNo, false, true);
      break;
  }
  return false;
}

/** GetSetPokedexFlag */
export function GetSetPokedexFlag(state: GameState, nationalDexNo: number, caseId: number): boolean {
  return DexScreen_GetSetPokedexFlag(state, nationalDexNo, caseId, false);
}

/**
 * HandleSetPokedexFlag (pokemon.c): FLAG_SET_SEEN / FLAG_SET_CAUGHT, and the first Unown / Spinda seen (or caught)
 * keeps its personality in the save for the Pokédex's pic (DexScreen_GetDefaultPersonality).
 */
export function HandleSetPokedexFlag(state: GameState, nationalNum: number, caseId: number, personality: number): void {
  const getFlagCaseId = caseId === FLAG_SET_SEEN ? FLAG_GET_SEEN : FLAG_GET_CAUGHT;
  if (!GetSetPokedexFlag(state, nationalNum, getFlagCaseId)) {
    GetSetPokedexFlag(state, nationalNum, caseId);
    const species = NationalPokedexNumToSpecies(state, nationalNum);
    if (species === state.defines.require('SPECIES_UNOWN')) state.dexUnownPersonality = personality >>> 0;
    if (species === state.defines.require('SPECIES_SPINDA')) state.dexSpindaPersonality = personality >>> 0;
  }
}

/** GetPokedexCategoryName (unused in the C) */
export function GetPokedexCategoryName(dexNum: number): string {
  return pokedexData.entries[dexNum].categoryName;
}

/** GetPokedexHeightWeight: 0 = height, 1 = weight */
export function GetPokedexHeightWeight(dexNum: number, data: number): number {
  switch (data) {
    case 0:
      return pokedexData.entries[dexNum].height;
    case 1:
      return pokedexData.entries[dexNum].weight;
    default:
      return 1;
  }
}

/** GetNationalPokedexCount */
export function GetNationalPokedexCount(state: GameState, caseId: number): number {
  let count = 0;
  for (let i = 0; i < state.pokemon.tables.nationalDexCount; i++) if (GetSetPokedexFlag(state, i + 1, caseId)) count++;
  return count;
}

/** GetKantoPokedexCount */
export function GetKantoPokedexCount(state: GameState, caseId: number): number {
  let count = 0;
  for (let i = 0; i < state.pokemon.tables.kantoDexCount; i++) if (GetSetPokedexFlag(state, i + 1, caseId)) count++;
  return count;
}

/** HasAllKantoMons: -1 excludes Mew */
export function HasAllKantoMons(state: GameState): boolean {
  for (let i = 0; i < state.pokemon.tables.kantoDexCount - 1; i++) if (!GetSetPokedexFlag(state, i + 1, FLAG_GET_CAUGHT)) return false;
  return true;
}

/** HasAllMons: every mon but Mew, Lugia, Ho-Oh, Celebi, Jirachi and Deoxys */
export function HasAllMons(state: GameState): boolean {
  const { kantoDexCount, nationalDexCount } = state.pokemon.tables;
  const johtoDexCount = state.defines.require('JOHTO_DEX_COUNT');
  for (let i = 0; i < kantoDexCount - 1; i++) if (!GetSetPokedexFlag(state, i + 1, FLAG_GET_CAUGHT)) return false;
  for (let i = kantoDexCount; i < johtoDexCount - 3; i++) if (!GetSetPokedexFlag(state, i + 1, FLAG_GET_CAUGHT)) return false;
  for (let i = johtoDexCount; i < nationalDexCount - 2; i++) if (!GetSetPokedexFlag(state, i + 1, FLAG_GET_CAUGHT)) return false;
  return true;
}
// HasAllHoennMons needs HoennToNationalOrder (the Hoenn dex order), which nothing in FRLG calls: not ported.
