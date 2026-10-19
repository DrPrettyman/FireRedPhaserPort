import { beforeAll, describe, expect, test, vi } from 'vitest';
import { loadPokedexData } from '../../src/menus/pokedex';
import { POSTGAME_SPECIALS } from '../../src/script/postgameSpecials';
import { FormatMonSizeRecord, GetMonSize, GetMonSizeHash } from '../../src/script/pokemonSizeRecord';
import type { SpecialEnv } from '../../src/script/specials';
import { newGame, readGen, type TestGame } from './gameData';

const mon = (t: TestGame, species: string, opts: { personality?: number; iv?: number } = {}) =>
  t.pokemon.createMon(t.d(species), 10, { otId: 1, otName: 'RED', otGender: 'male', metLocation: 'MAPSEC_PALLET_TOWN', ...opts });

const str = (t: TestGame, bytes: number[]) => t.charmap.decodePlain(bytes);

// pokemon_size_record.c, worked by hand.
describe('Magikarp size record', () => {
  test('the size hash, from the low 16 bits of the personality and the IVs', () => {
    const t = newGame();
    const m = mon(t, 'SPECIES_MAGIKARP', { personality: 0x12345678 });
    m.ivs = { hp: 31, attack: 31, defense: 31, speed: 31, spAttack: 31, spDefense: 31 };
    // hibyte = ((15 ^ 15) * 15) ^ 0x78 = 0x78; lobyte = 0 ^ 0x56
    expect(GetMonSizeHash(m)).toBe(0x7856);
    m.ivs = { hp: 3, attack: 5, defense: 6, speed: 2, spAttack: 1, spDefense: 7 };
    // hibyte = ((5 ^ 6) * 3) ^ 0x78 = 9 ^ 0x78 = 0x71; lobyte = ((1 ^ 7) * 2) ^ 0x56 = 12 ^ 0x56 = 0x5a
    expect(GetMonSizeHash(m)).toBe(0x715a);
  });

  test('the size and its inches, for a Magikarp (0.9 m in the Pokédex)', () => {
    const t = newGame();
    const dot = t.charmap.encodePlain('.');
    // 0x7856 = 30806: sBigMonSizeTable[7] {900, 150, 17710}: 900 + 13096 / 150 = 987; 9 * 987 / 10 = 888
    expect(GetMonSize(9, 0x7856)).toBe(888);
    expect(str(t, FormatMonSizeRecord(888, dot))).toBe('34.9'); // 888 * 100 / 254 = 349
    // The empty record (DEFAULT_MAX_SIZE 0): {290, 1, 0}: 9 * 290 / 10 = 261 → 102
    expect(GetMonSize(9, 0)).toBe(261);
    expect(str(t, FormatMonSizeRecord(261, dot))).toBe('10.2');
    // Past the table's last bound: index 15 {1700, 1, 65510}
    expect(GetMonSize(9, 0xffff)).toBe(Math.floor((9 * (1700 + 25)) / 10));
  });
});

// The Water Path beauty's Heracross (SixIsland_WaterPath_House1): the specials through POSTGAME_SPECIALS, the
// numbers by hand. HERACROSS is 1.5 m in the Pokédex (height 15).
describe('Heracross size record', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => readGen('pokedex.json') }));
    await loadPokedexData('gen');
    vi.unstubAllGlobals();
  });

  const env = (t: TestGame) => ({ state: t.state, encodeText: () => t.charmap.encodePlain('.'), stopScript: () => {} }) as unknown as SpecialEnv;
  const heracross = (t: TestGame, ivs: number[]) => {
    const m = mon(t, 'SPECIES_HERACROSS', { personality: 0x12345678 });
    const [hp, attack, defense, speed, spAttack, spDefense] = ivs;
    m.ivs = { hp, attack, defense, speed, spAttack, spDefense };
    return m;
  };
  // hash 0x7856 = 30806: {900, 150, 17710}: 900 + 13096 / 150 = 987; 15 * 987 / 10 = 1480 mm; * 100 / 254 = 582
  const BIG = [31, 31, 31, 31, 31, 31];
  // hash 0x715a = 29018: 900 + 11308 / 150 = 975; 15 * 975 / 10 = 1462 mm; * 100 / 254 = 575
  const SMALL = [3, 5, 6, 2, 1, 7];

  test('CompareHeracrossSize: a bigger one sets the record (3), a smaller one (2) or the same (4) does not', () => {
    const t = newGame();
    const { CompareHeracrossSize, GetHeracrossSizeRecordInfo } = POSTGAME_SPECIALS;
    t.state.party = [heracross(t, BIG), heracross(t, SMALL), mon(t, 'SPECIES_SCYTHER')];
    const compare = (slot: number) => {
      t.state.setVar('VAR_RESULT', slot);
      CompareHeracrossSize(env(t));
      return [t.state.getVar('VAR_RESULT'), str(t, t.state.stringVars[1]), str(t, t.state.stringVars[2]), t.state.getVar('VAR_HERACROSS_SIZE_RECORD')];
    };
    // The empty record (DEFAULT_MAX_SIZE 0): {290, 1, 0}: 15 * 290 / 10 = 435 mm → 17.1
    expect(compare(0)).toEqual([3, '58.2', '17.1', 0x7856]);
    expect(compare(1)).toEqual([2, '57.5', '58.2', 0x7856]);
    expect(compare(0)).toEqual([4, '58.2', '58.2', 0x7856]);
    expect(compare(2)[0]).toBe(1); // not a Heracross
    expect(compare(6)[0]).toBe(0); // none chosen (PARTY_SIZE and up)
    t.state.party[1].isEgg = true;
    expect(compare(1)[0]).toBe(1);
    // GetHeracrossSizeRecordInfo: STR_VAR_1 the species, STR_VAR_3 the record
    GetHeracrossSizeRecordInfo(env(t));
    expect([str(t, t.state.stringVars[0]), str(t, t.state.stringVars[2])]).toEqual(['HERACROSS', '58.2']);
  });
});
