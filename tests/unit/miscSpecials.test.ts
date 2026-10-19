import { describe, expect, test } from 'vitest';
import {
  GetLeadMonFriendship,
  GetMartClerkObjectId,
  GetNumFansOfPlayerInTrainerFanClub,
  TryGainNewFanFromCounter,
  TryLoseFansFromPlayTime,
  UpdateTrainerFanClubGameClear,
} from '../../src/script/miscSpecials';
import { newGame, type TestGame } from './gameData';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mon = (t: TestGame, species: string, opts: { personality?: number; iv?: number } = {}) =>
  t.pokemon.createMon(t.d(species), 10, { otId: 1, otName: 'RED', otGender: 'male', metLocation: 'MAPSEC_PALLET_TOWN', ...opts });

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

// GetMartClerkObjectId (sMartMaps): the local id is the mart's clerk in the extracted map (object events are local
// ids 1, 2, ... in order); a map that isn't a mart gets 1.
describe('GetMartClerkObjectId', () => {
  test("every Poké Mart's clerk", () => {
    const dir = resolve(__dirname, '../../public/gen/maps');
    const marts = readdirSync(dir).filter((f) => /_Mart\.json$/.test(f));
    expect(marts.length).toBe(12);
    for (const file of marts) {
      const map = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
      const id = GetMartClerkObjectId(map.id);
      expect(map.objectEvents[id - 1]?.graphics_id, map.id).toBe('OBJ_EVENT_GFX_CLERK');
    }
    expect(GetMartClerkObjectId('MAP_PEWTER_CITY_MART')).toBe(3);
    expect(GetMartClerkObjectId('MAP_PALLET_TOWN')).toBe(1);
  });
});
