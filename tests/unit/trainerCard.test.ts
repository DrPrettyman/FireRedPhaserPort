// trainer_card.c's TrainerCard_GenerateCardForLinkPlayer (the card the start menu's PLAYER shows): the FRLG stars
// (the Hall of Fame, every Kanto mon but Mew, HasAllMons) and the Hall of Fame debut time, read from the decomp's
// rules rather than the screen.

import { beforeAll, expect, test } from 'vitest';
import { emptyTrainerCard, TrainerCard_GenerateCardForLinkPlayer } from '../../src/menus/trainerCard';
import { newBattleEnv, type TestGame } from './gameData';

let game: TestGame;

beforeAll(async () => {
  game = await newBattleEnv();
});

function card() {
  const c = emptyTrainerCard();
  TrainerCard_GenerateCardForLinkPlayer(c);
  return c;
}

/** Caught national dex numbers 1..n */
function catchUpTo(n: number) {
  for (let i = 1; i <= n; i++) {
    game.state.dexSeen.add(i);
    game.state.dexCaught.add(i);
  }
}

test('stars: none, then the Hall of Fame, every Kanto mon but Mew, and every mon but the event legendaries', () => {
  const { state, d } = game;
  state.money = 4321;
  let c = card();
  expect(c.version).toBe(d('VERSION_FIRE_RED'));
  expect(c.rse.stars).toBe(0);
  expect(c.rse.money).toBe(4321);
  expect(c.rse.trainerId).toBe(state.trainerId & 0xffff);
  expect(c.shouldDrawStickers).toBe(true);

  // The Hall of Fame play time only counts once GAME_STAT_ENTERED_HOF is set.
  state.setGameStat(d('GAME_STAT_FIRST_HOF_PLAY_TIME'), (25 << 16) | (3 << 8) | 9);
  expect(card().rse.stars).toBe(0);
  state.setGameStat(d('GAME_STAT_ENTERED_HOF'), 1);
  c = card();
  expect([c.rse.hofDebutHours, c.rse.hofDebutMinutes, c.rse.hofDebutSeconds]).toEqual([25, 3, 9]);
  expect(c.rse.stars).toBe(1);

  // Every Kanto mon but Mew (150 of 151).
  catchUpTo(150);
  c = card();
  expect(c.rse.caughtAllHoenn).toBe(true); // HasAllKantoMons, in the RSE field
  expect(c.rse.caughtMonsCount).toBe(150);
  expect(c.rse.stars).toBe(2);

  // HasAllMons: also skips Lugia, Ho-Oh, Celebi (249-251), Jirachi and Deoxys (385, 386).
  catchUpTo(248);
  for (let i = 252; i <= 384; i++) {
    state.dexSeen.add(i);
    state.dexCaught.add(i);
  }
  c = card();
  expect(c.hasAllMons).toBe(true);
  expect(c.rse.stars).toBe(3);
});

test('a Hall of Fame debut past 999 hours shows as 999:59:59', () => {
  const { state, d } = game;
  state.setGameStat(d('GAME_STAT_ENTERED_HOF'), 1);
  state.setGameStat(d('GAME_STAT_FIRST_HOF_PLAY_TIME'), (1000 << 16) | (1 << 8) | 2);
  const c = card();
  expect([c.rse.hofDebutHours, c.rse.hofDebutMinutes, c.rse.hofDebutSeconds]).toEqual([999, 59, 59]);
});
