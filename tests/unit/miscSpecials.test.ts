import { describe, expect, test } from 'vitest';
import { FormatMonSizeRecord, GetLeadMonFriendship, GetMonSize, GetMonSizeHash } from '../../src/script/miscSpecials';
import { newGame, type TestGame } from './gameData';

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

describe("Daisy's friendship rating", () => {
  test('GetLeadMonFriendship by the first mon that is not an egg', () => {
    const t = newGame();
    const egg = mon(t, 'SPECIES_PICHU');
    egg.isEgg = true;
    egg.friendship = 255;
    const lead = mon(t, 'SPECIES_PIKACHU');
    t.state.party = [egg, lead];
    const cases: [number, number][] = [[0, 0], [1, 1], [49, 1], [50, 2], [100, 3], [150, 4], [199, 4], [200, 5], [254, 5], [255, 6]];
    for (const [friendship, rating] of cases) {
      lead.friendship = friendship;
      expect(GetLeadMonFriendship(t.state), `friendship ${friendship}`).toBe(rating);
    }
  });
});
