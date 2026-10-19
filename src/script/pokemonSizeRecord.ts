// pokemon_size_record.c: the size records (the Route 12 fishing guru's Magikarp, VAR_MAGIKARP_SIZE_RECORD; the Six
// Island Water Path beauty's Heracross, VAR_HERACROSS_SIZE_RECORD). A record var holds the biggest mon's size hash
// (GetMonSizeHash: personality and IVs), not its size; DEFAULT_MAX_SIZE is 0 in FRLG, which a new game's vars
// already are (InitHeracrossSizeRecord / InitMagikarpSizeRecord). The specials: miscSpecials.ts (Magikarp),
// postgameSpecials.ts (Heracross).

import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEFT_ALIGN } from '../battle/stringUtil';
import { GetPokedexHeightWeight, loadPokedexData, pokedexData } from '../menus/pokedex';
import type { Pokemon } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import type { SpecialEnv } from './specials';

/** sBigMonSizeTable: { unk0, unk2, unk4 } */
const sBigMonSizeTable: [number, number, number][] = [
  [290, 1, 0],
  [300, 1, 10],
  [400, 2, 110],
  [500, 4, 310],
  [600, 20, 710],
  [700, 50, 2710],
  [800, 100, 7710],
  [900, 150, 17710],
  [1000, 150, 32710],
  [1100, 100, 47710],
  [1200, 50, 57710],
  [1300, 20, 62710],
  [1400, 5, 64710],
  [1500, 2, 65210],
  [1600, 1, 65410],
  [1700, 1, 65510],
];

/** GetMonSizeHash: from the low 16 bits of the personality and the low 4 bits of each IV (u16). */
export function GetMonSizeHash(mon: Pokemon): number {
  const personality = mon.personality & 0xffff;
  const { hp, attack, defense, speed, spAttack, spDefense } = mon.ivs;
  const hibyte = (((attack & 0xf) ^ (defense & 0xf)) * (hp & 0xf)) ^ (personality & 0xff);
  const lobyte = (((spAttack & 0xf) ^ (spDefense & 0xf)) * (speed & 0xf)) ^ (personality >> 8);
  return ((hibyte << 8) + lobyte) & 0xffff;
}

/** TranslateBigMonSizeTableIndex */
function TranslateBigMonSizeTableIndex(a: number): number {
  let i: number;
  for (i = 1; i < 15; i++) if (a < sBigMonSizeTable[i][2]) return i - 1;
  return i;
}

/** GetMonSize: the Pokédex height (decimetres) scaled by the size hash, in millimetres. */
export function GetMonSize(height: number, b: number): number {
  const [unk0, unk2, unk4] = sBigMonSizeTable[TranslateBigMonSizeTableIndex(b)];
  const scale = unk0 + Math.floor((b - unk4) / unk2);
  return Math.floor((height * scale) / 10);
}

/** FormatMonSizeRecord (UNITS_IMPERIAL, the English build): inches with one decimal, e.g. "11.5". */
export function FormatMonSizeRecord(size: number, decimalPoint: number[]): number[] {
  size = Math.floor((size * 100) / 254);
  return [
    ...ConvertIntToDecimalStringN(Math.floor(size / 10), STR_CONV_MODE_LEFT_ALIGN, 8),
    ...decimalPoint,
    ...ConvertIntToDecimalStringN(size % 10, STR_CONV_MODE_LEFT_ALIGN, 1),
  ];
}

/** The Pokédex height of `species` (pokedex.json, loaded with the Pokédex screens). */
function monHeight(state: GameState, species: number): number {
  return GetPokedexHeightWeight(state.pokemon.nationalDex(species), 0);
}

/**
 * CompareMonSize: VAR_RESULT is the party slot. 0 = none chosen, 1 = not that species (or an egg), 2 = smaller
 * than the record, 3 = a new record (stored), 4 = the same size. STR_VAR_3 = the record, STR_VAR_2 = this one.
 */
export function CompareMonSize(state: GameState, species: number, recordVar: string, decimalPoint: number[]): number {
  const slot = state.getVar('VAR_RESULT');
  if (slot >= 6) return 0;
  const mon = state.party[slot];
  if (!mon || mon.isEgg || mon.species !== species) return 1;
  const height = monHeight(state, species);
  const sizeParams = GetMonSizeHash(mon);
  const newSize = GetMonSize(height, sizeParams);
  const oldSize = GetMonSize(height, state.getVar(recordVar));
  state.stringVars[2] = FormatMonSizeRecord(oldSize, decimalPoint);
  state.stringVars[1] = FormatMonSizeRecord(newSize, decimalPoint);
  if (newSize === oldSize) return 4;
  if (newSize < oldSize) return 2;
  state.setVar(recordVar, sizeParams);
  return 3;
}

/** GetMonSizeRecordInfo: STR_VAR_1 = the species name, STR_VAR_3 = the record's size. */
export function GetMonSizeRecordInfo(state: GameState, species: number, recordVar: string, decimalPoint: number[]): void {
  state.stringVars[2] = FormatMonSizeRecord(GetMonSize(monHeight(state, species), state.getVar(recordVar)), decimalPoint);
  state.stringVars[0] = [...state.pokemon.speciesName(species)];
}

/**
 * The size record needs pokedex.json's heights, which the field doesn't load: if it isn't loaded yet, the script
 * waits for it before its next command (the message that prints the size).
 */
export function withPokedexData(env: SpecialEnv, fn: () => void): void {
  if (pokedexData) {
    fn();
    return;
  }
  let done = false;
  void loadPokedexData('gen').then(() => {
    fn();
    done = true;
  });
  env.stopScript(() => done);
}

/** GetHeracrossSizeRecordInfo: STR_VAR_1 "HERACROSS", STR_VAR_3 the record (VAR_HERACROSS_SIZE_RECORD) in inches. */
export function GetHeracrossSizeRecordInfo(env: SpecialEnv): void {
  const { state, encodeText } = env;
  withPokedexData(env, () => GetMonSizeRecordInfo(state, state.defines.require('SPECIES_HERACROSS'), 'VAR_HERACROSS_SIZE_RECORD', encodeText('gText_DecimalPoint')));
}

/** CompareHeracrossSize: gSpecialVar_Result = CompareMonSize(SPECIES_HERACROSS, VAR_HERACROSS_SIZE_RECORD). */
export function CompareHeracrossSize(env: SpecialEnv): void {
  const { state, encodeText } = env;
  withPokedexData(env, () => state.setVar('VAR_RESULT', CompareMonSize(state, state.defines.require('SPECIES_HERACROSS'), 'VAR_HERACROSS_SIZE_RECORD', encodeText('gText_DecimalPoint'))));
}
