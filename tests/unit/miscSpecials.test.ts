import { describe, expect, test } from 'vitest';
import {
  FormatMonSizeRecord,
  GetLeadMonFriendship,
  GetMonSize,
  GetMonSizeHash,
  GetNumFansOfPlayerInTrainerFanClub,
  TryGainNewFanFromCounter,
  TryLoseFansFromPlayTime,
  UpdateTrainerFanClubGameClear,
} from '../../src/script/miscSpecials';
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

// trainer_fan_club.c, by hand: struct TrainerFanClub in VAR_FANCLUB_FAN_COUNTER (timer:7, gotInitialFans:1, fanFlags).
describe('Trainer Fan Club', () => {
  test('the game clear gives the first three fans once, and the loss timer starts', () => {
    const t = newGame();
    t.state.playTime.hours = 30;
    UpdateTrainerFanClubGameClear(t.state);
    expect(t.state.getVar('VAR_FANCLUB_FAN_COUNTER')).toBe(0x0780); // fans 1-3, gotInitialFans
    expect(t.state.getVar('VAR_FANCLUB_LOSE_FAN_TIMER')).toBe(30);
    expect(t.state.getVar('VAR_MAP_SCENE_SAFFRON_CITY_POKEMON_TRAINER_FAN_CLUB')).toBe(1);
    expect(GetNumFansOfPlayerInTrainerFanClub(t.state)).toBe(3);
    t.state.setVar('VAR_FANCLUB_FAN_COUNTER', 0x0180); // lost two since: a second game clear changes nothing
    UpdateTrainerFanClubGameClear(t.state);
    expect(t.state.getVar('VAR_FANCLUB_FAN_COUNTER')).toBe(0x0180);
  });

  test('the counter gains a fan at 20 while under three fans', () => {
    const t = newGame();
    t.state.setVar('VAR_MAP_SCENE_SAFFRON_CITY_POKEMON_TRAINER_FAN_CLUB', 2);
    t.state.setVar('VAR_FANCLUB_FAN_COUNTER', 0x0180 | 18); // one fan, timer 18
    expect(TryGainNewFanFromCounter(t.state, 1)).toBe(19); // +1
    expect(TryGainNewFanFromCounter(t.state, 0)).toBe(0); // 19 + 2 >= 20: a new fan, timer back to 0
    expect(GetNumFansOfPlayerInTrainerFanClub(t.state)).toBe(2);
    t.state.setVar('VAR_FANCLUB_FAN_COUNTER', 0x0780 | 19); // three fans: the timer sticks at 20
    expect(TryGainNewFanFromCounter(t.state, 1)).toBe(20);
    expect(GetNumFansOfPlayerInTrainerFanClub(t.state)).toBe(3);
  });

  test('five or more fans lose one per 12 hours played, down to four', () => {
    const t = newGame();
    t.state.setVar('VAR_FANCLUB_FAN_COUNTER', 0xff80); // all eight
    t.state.setVar('VAR_FANCLUB_LOSE_FAN_TIMER', 10);
    t.state.playTime.hours = 21; // 11 hours: nothing yet
    TryLoseFansFromPlayTime(t.state);
    expect(GetNumFansOfPlayerInTrainerFanClub(t.state)).toBe(8);
    t.state.playTime.hours = 46; // 36 hours: three leave, the timer moves on by 3 * 12
    TryLoseFansFromPlayTime(t.state);
    expect(GetNumFansOfPlayerInTrainerFanClub(t.state)).toBe(5);
    expect(t.state.getVar('VAR_FANCLUB_LOSE_FAN_TIMER')).toBe(46);
    t.state.playTime.hours = 200; // the next one leaves; at four the timer resets to now
    TryLoseFansFromPlayTime(t.state);
    expect(GetNumFansOfPlayerInTrainerFanClub(t.state)).toBe(4);
    expect(t.state.getVar('VAR_FANCLUB_LOSE_FAN_TIMER')).toBe(200);
  });
});
