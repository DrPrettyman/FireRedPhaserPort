// pokedex.c (src/menus/pokedex.ts) and the Pokédex data the extractor writes (pokedex.json, the footprints).
// Expected values are the decomp's (data/pokemon/pokedex_entries.h, pokedex_orders.h, pokedex_categories.h,
// graphics/pokemon/bulbasaur/footprint.png).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  FLAG_GET_CAUGHT,
  FLAG_GET_SEEN,
  FLAG_SET_CAUGHT,
  FLAG_SET_SEEN,
  GetKantoPokedexCount,
  GetNationalPokedexCount,
  GetSetPokedexFlag,
  HasAllKantoMons,
  NationalPokedexNumToSpecies,
  type PokedexData,
} from '../../src/menus/pokedex';
import { newGame, readGen, type TestGame } from './gameData';

let t: TestGame;

beforeEach(() => {
  t = newGame();
});

describe('pokedex.json', () => {
  const dex = readGen<PokedexData>('pokedex.json');

  test('gPokedexEntries by national number: category, size, the FireRed text, the scales', () => {
    expect(dex.entries[25]).toMatchObject({ categoryName: 'MOUSE$', height: 4, weight: 60, pokemonScale: 479, pokemonOffset: 16, trainerScale: 256, trainerOffset: -2 });
    expect(dex.entries[1].description).toBe('There is a plant seed on its back right\\nfrom the day this POKéMON is born.\\nThe seed slowly grows larger.$');
    expect(dex.entries).toHaveLength(387); // NATIONAL_DEX_NONE .. DEOXYS
  });

  test('the orders: lightest first is Gastly, the type order starts with the Normal types', () => {
    expect(dex.orders.weight[0]).toBe(92); // NATIONAL_DEX_GASTLY
    expect(dex.orders.weight).toHaveLength(386);
    expect(dex.orders.type[0]).toBe(t.d('SPECIES_RATTATA'));
  });

  test('gDexCategories: nine habitats of up to four mons a page', () => {
    expect(dex.categories).toHaveLength(9);
    expect(dex.categories[0][0]).toEqual(['RATTATA', 'RATICATE', 'SENTRET', 'FURRET'].map((s) => t.d(`SPECIES_${s}`)));
    expect(dex.categories.flat().every((page) => page.length >= 1 && page.length <= 4)).toBe(true);
  });

  test('the footprints are 1bpp: a set bit for each black pixel, the leftmost pixel in bit 0', () => {
    expect(dex.footprints[t.d('SPECIES_BULBASAUR')]).toBe('gMonFootprint_Bulbasaur');
    const bytes = readFileSync(resolve(__dirname, '../../public/gen/gfx/gMonFootprint_Bulbasaur.bin'));
    expect(bytes).toHaveLength(32); // 2x2 tiles of 8 bytes
    // Row 5 of the PNG: "#####.#...#.####" (. = black): x = 5, 7 in the top-left tile, x = 8, 9, 11 in the top-right
    expect(bytes[5]).toBe(0b10100000);
    expect(bytes[8 + 5]).toBe(0b00001011);
  });
});

describe('pokedex.c', () => {
  test('GetSetPokedexFlag sets and gets; a caught mon only counts once seen (the anticheat)', () => {
    const s = t.state;
    GetSetPokedexFlag(s, 4, FLAG_SET_CAUGHT);
    expect(GetSetPokedexFlag(s, 4, FLAG_GET_CAUGHT)).toBe(false);
    GetSetPokedexFlag(s, 4, FLAG_SET_SEEN);
    expect(GetSetPokedexFlag(s, 4, FLAG_GET_SEEN)).toBe(true);
    expect(GetSetPokedexFlag(s, 4, FLAG_GET_CAUGHT)).toBe(true);
  });

  test('the Kanto and national counts', () => {
    const s = t.state;
    for (const n of [1, 25, 151, 152, 386]) s.setDexFlags(n, true, false);
    s.setDexFlags(25, false, true);
    s.setDexFlags(152, false, true);
    expect(GetKantoPokedexCount(s, FLAG_GET_SEEN)).toBe(3);
    expect(GetNationalPokedexCount(s, FLAG_GET_SEEN)).toBe(5);
    expect(GetKantoPokedexCount(s, FLAG_GET_CAUGHT)).toBe(1);
    expect(GetNationalPokedexCount(s, FLAG_GET_CAUGHT)).toBe(2);
  });

  test('HasAllKantoMons leaves out Mew', () => {
    const s = t.state;
    for (let n = 1; n < 151; n++) s.setDexFlags(n, true, true);
    expect(HasAllKantoMons(s)).toBe(true);
    s.dexCaught.delete(150);
    expect(HasAllKantoMons(s)).toBe(false);
  });

  test('NationalPokedexNumToSpecies: the Hoenn mons have species ids out of dex order', () => {
    expect(NationalPokedexNumToSpecies(t.state, 25)).toBe(t.d('SPECIES_PIKACHU'));
    expect(NationalPokedexNumToSpecies(t.state, 252)).toBe(t.d('SPECIES_TREECKO'));
  });
});
