import { beforeAll, describe, expect, test } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import { CHAMPION_SAVEWARP, IncrementResortGorgeousStepCounter, POSTGAME_SPECIALS } from '../../src/script/postgameSpecials';
import type { SpecialEnv } from '../../src/script/specials';
import { seedRng } from '../../src/util/random';
import { newGame, readGen } from './gameData';

// Five Island and Celio's Sapphire (W-sevii unit 4): field_specials.c's Resort Gorgeous request
// (SampleResortGorgeousMonAndReward, IncrementResortGorgeousStepCounter) and save_location.c's SetPostgameFlags /
// SetUnlockedPokedexFlags.

beforeAll(() => initConstants(readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines));

const env = (g: ReturnType<typeof newGame>) => ({ state: g.state }) as unknown as SpecialEnv;

describe('Resort Gorgeous', () => {
  test('SampleResortGorgeousMonAndReward asks for a seen mon and a reward, and keeps an open request', () => {
    const g = newGame();
    const s = g.state;
    const pikachu = g.d('SPECIES_PIKACHU');
    s.setDexFlags(g.pokemon.nationalDex(pikachu), true, false); // the only mon seen
    const deluxe = ['ITEM_BIG_PEARL', 'ITEM_PEARL', 'ITEM_STARDUST', 'ITEM_STAR_PIECE', 'ITEM_NUGGET', 'ITEM_RARE_CANDY'].map(g.d);
    const rewards = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      seedRng(seed);
      s.setVar('VAR_RESORT_GORGEOUS_REQUESTED_MON', seed % 2 ? 0 : 0xffff); // none, or the last one ran out
      s.setVar('VAR_RESORT_GOREGEOUS_STEP_COUNTER', 7);
      POSTGAME_SPECIALS.SampleResortGorgeousMonAndReward(env(g));
      // a random try hits it, or after 100 the search walks down (wrapping past Bulbasaur) to it
      expect(s.getVar('VAR_RESORT_GORGEOUS_REQUESTED_MON')).toBe(pikachu);
      expect(s.getVar('VAR_RESORT_GOREGEOUS_STEP_COUNTER')).toBe(0);
      rewards.add(s.getVar('VAR_RESORT_GORGEOUS_REWARD'));
      expect(g.charmap.decodePlain(s.stringVars[0])).toBe('PIKACHU');
    }
    // A Luxury Ball 70% of the time, else one of sResortGorgeousDeluxeRewards
    expect(rewards.has(g.d('ITEM_LUXURY_BALL'))).toBe(true);
    expect([...rewards].every((r) => r === g.d('ITEM_LUXURY_BALL') || deluxe.includes(r))).toBe(true);
    expect([...rewards].some((r) => deluxe.includes(r))).toBe(true);

    // An open request stays (only gStringVar1 is filled), the step count too
    s.setVar('VAR_RESORT_GORGEOUS_REQUESTED_MON', g.d('SPECIES_MEW'));
    s.setVar('VAR_RESORT_GORGEOUS_REWARD', g.d('ITEM_NUGGET'));
    s.setVar('VAR_RESORT_GOREGEOUS_STEP_COUNTER', 12);
    POSTGAME_SPECIALS.SampleResortGorgeousMonAndReward(env(g));
    expect([s.getVar('VAR_RESORT_GORGEOUS_REQUESTED_MON'), s.getVar('VAR_RESORT_GORGEOUS_REWARD'), s.getVar('VAR_RESORT_GOREGEOUS_STEP_COUNTER')]).toEqual([g.d('SPECIES_MEW'), g.d('ITEM_NUGGET'), 12]);
    expect(g.charmap.decodePlain(s.stringVars[0])).toBe('MEW');
  });

  test('IncrementResortGorgeousStepCounter: 250 steps close an open request; none open, no count', () => {
    const g = newGame();
    const s = g.state;
    IncrementResortGorgeousStepCounter(s);
    expect(s.getVar('VAR_RESORT_GOREGEOUS_STEP_COUNTER')).toBe(0);
    s.setVar('VAR_RESORT_GORGEOUS_REQUESTED_MON', g.d('SPECIES_PIKACHU'));
    for (let i = 0; i < 249; i++) IncrementResortGorgeousStepCounter(s);
    expect([s.getVar('VAR_RESORT_GORGEOUS_REQUESTED_MON'), s.getVar('VAR_RESORT_GOREGEOUS_STEP_COUNTER')]).toEqual([g.d('SPECIES_PIKACHU'), 249]);
    IncrementResortGorgeousStepCounter(s);
    expect([s.getVar('VAR_RESORT_GORGEOUS_REQUESTED_MON'), s.getVar('VAR_RESORT_GOREGEOUS_STEP_COUNTER')]).toEqual([0xffff, 0]);
    // 0xFFFF isn't SPECIES_NONE: the counter keeps running (as in the C) until Selphy samples a new request
    IncrementResortGorgeousStepCounter(s);
    expect(s.getVar('VAR_RESORT_GOREGEOUS_STEP_COUNTER')).toBe(1);
  });
});

describe('save_location.c', () => {
  test('SetPostgameFlags and SetUnlockedPokedexFlags', () => {
    const g = newGame();
    g.state.specialSaveWarpFlags = 1; // CONTINUE_GAME_WARP stays
    POSTGAME_SPECIALS.SetUnlockedPokedexFlags(env(g));
    expect(g.state.gcnLinkFlags).toBe(0x31);
    POSTGAME_SPECIALS.SetPostgameFlags(env(g));
    expect(g.state.specialSaveWarpFlags).toBe(1 | CHAMPION_SAVEWARP);
    expect(CHAMPION_SAVEWARP).toBe(0x80);
    expect(g.state.gcnLinkFlags).toBe(0x803f);
  });
});
