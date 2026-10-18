import { describe, expect, test } from 'vitest';
import { GetProfOaksRatingMessageByCount } from '../../src/script/sideSpecials';
import { newGame } from './gameData';

// prof_pc.c GetProfOaksRatingMessageByCount, worked by hand from the C's if-chain.
describe("Prof. Oak's rating", () => {
  test('one message per ten mons caught, below 150', () => {
    const { state } = newGame();
    const cases: [number, string][] = [
      [0, 'LessThan10'],
      [9, 'LessThan10'],
      [10, 'LessThan20'],
      [59, 'LessThan60'],
      [60, 'LessThan70'],
      [140, 'LessThan150'],
      [149, 'LessThan150'],
    ];
    for (const [count, msg] of cases) {
      expect(GetProfOaksRatingMessageByCount(state, count), `${count} caught`).toEqual({ label: `PokedexRating_Text_${msg}`, complete: false });
    }
  });

  test('150 caught is complete unless Mew is one of them; 151 is complete', () => {
    const { state, pokemon, d } = newGame();
    expect(GetProfOaksRatingMessageByCount(state, 150)).toEqual({ label: 'PokedexRating_Text_Complete', complete: true });
    const mew = pokemon.nationalDex(d('SPECIES_MEW'));
    state.dexSeen.add(mew); // caught only counts if seen too (the C's anticheat)
    state.dexCaught.add(mew);
    expect(GetProfOaksRatingMessageByCount(state, 150)).toEqual({ label: 'PokedexRating_Text_LessThan150', complete: false });
    expect(GetProfOaksRatingMessageByCount(state, 151)).toEqual({ label: 'PokedexRating_Text_Complete', complete: true });
    // Out of range (the C falls through to the first message)
    expect(GetProfOaksRatingMessageByCount(state, 152)).toEqual({ label: 'PokedexRating_Text_LessThan10', complete: false });
  });
});
