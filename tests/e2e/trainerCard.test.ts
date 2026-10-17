// The trainer card (menus/trainerCard.ts, trainer_card.c) from the start menu's PLAYER: the card front with the
// player's name, ID, money, Pokédex count and play time, the stars (the card's colour), the badges and the pic;
// the play time's colon blinking; B back to the start menu. The card is on the GBA layer: its state comes from
// `t.trainerCard()`, whose `ready` means the front takes input.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** START → move the cursor to PLAYER → A → the card front, faded in. */
async function openTrainerCard(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.until(() => !!t.startMenu()));
  for (let i = 0; i < 8; i++) {
    const menu = (await game.eval((t) => t.startMenu()))!;
    if (menu.items[menu.cursor] === 'PLAYER') break;
    await game.press('DOWN');
  }
  const menu = (await game.eval((t) => t.startMenu()))!;
  expect(menu.items[menu.cursor]).toBe('PLAYER');
  await game.press('A');
  await game.waitFor((t) => t.gbaScreen() === 'CB2_TrainerCard', { what: 'the trainer card' });
  await game.eval((t) => t.until(() => !!t.trainerCard()?.ready));
  return (await game.eval((t) => t.trainerCard()))!;
}

/** B on the front: the card fades out and the start menu comes back on PLAYER. */
async function closeTrainerCard(game: Game) {
  await game.press('B');
  await game.waitFor((t) => !t.gbaScreen() && !!t.startMenu(), { what: 'the start menu' });
  expect(await game.eval((t) => t.trainerCard())).toBeUndefined();
  await game.eval((t) => t.until(() => !t.field()!.fading));
  const menu = (await game.eval((t) => t.startMenu()))!;
  expect(menu.items[menu.cursor]).toBe('PLAYER');
  await game.press('B');
  await game.waitIdle();
}

test('the card front shows the money, Pokédex, badges and a Hall of Fame star, and B closes it back to the start menu', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  const setup = await game.eval((t) => {
    const s = t.state!;
    s.money = 12345;
    s.setFlag('FLAG_BADGE01_GET', true);
    s.setFlag('FLAG_BADGE03_GET', true);
    s.setFlag('FLAG_BADGE08_GET', true);
    s.setFlag('FLAG_SYS_POKEDEX_GET', true);
    for (const n of [1, 4, 7, 16, 25]) {
      s.dexSeen.add(n);
      s.dexCaught.add(n);
    }
    // A Hall of Fame debut at 12:34:56: one star, the green card.
    s.setGameStat(t.define('GAME_STAT_ENTERED_HOF'), 1);
    s.setGameStat(t.define('GAME_STAT_FIRST_HOF_PLAY_TIME'), (12 << 16) | (34 << 8) | 56);
    s.playTime.hours = 3;
    s.playTime.minutes = 7;
    return { trainerId: s.trainerId & 0xffff, name: s.playerName };
  });

  const card = await openTrainerCard(game);
  expect(card.cardType).toBe(0); // CARD_TYPE_FRLG
  expect(card.printed.name).toBe(`NAME: ${setup.name}`);
  expect(card.printed.id).toBe(`IDNo.${String(setup.trainerId).padStart(5, '0')}`);
  expect(card.printed.money).toBe('¥12345');
  expect(card.printed.pokedex).toBe('5');
  expect(card.printed.hours!.trim()).toBe('3'); // (right-aligned to 3 digits)
  expect(card.printed.minutes).toBe('07');
  expect(card.card.hofDebut).toEqual([12, 34, 56]);
  // The badges it has, drawn in their slots along the bottom.
  const badges = [true, false, true, false, false, false, false, true];
  expect(card.badges).toEqual(badges);
  expect(card.drawnBadges).toEqual(badges);
  // One star (the Hall of Fame), drawn once, and the 1-star card palette (green).
  expect(card.stars).toBe(1);
  expect(card.drawnStars).toBe(1);
  expect(card.cardPalette).toBe(1);
  expect(card.femaleBg).toBe(false);
  // Red's pic in its window.
  expect(card.picPixels).toBeGreaterThan(500);
  await game.screenshot('wtcard-front');

  // The play time's colon blinks (BlinkTimeColon toggles it every 61 frames) and the time is reprinted.
  await game.eval(async (t) => {
    const was = t.trainerCard()!.timeColonInvisible;
    await t.until(() => t.trainerCard()!.timeColonInvisible !== was);
  });

  // A is the flip to the back: not ported yet, so it stays on the front.
  await game.press('A');
  expect((await game.eval((t) => t.trainerCard()))!.ready).toBe(true);

  await closeTrainerCard(game);
});

test("a girl's card without badges, Pokédex or stars: the blue card with the female background", async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await game.eval((t) => {
    t.state!.playerGender = 'female';
    t.state!.money = 0;
  });
  const card = await openTrainerCard(game);
  expect(card.card.gender).toBe(await game.eval((t) => t.define('FEMALE')));
  expect(card.printed.money).toBe('¥0');
  // No Pokédex yet: the line isn't printed.
  expect(card.printed.pokedex).toBeUndefined();
  expect(card.badges.some((b) => b)).toBe(false);
  expect(card.drawnBadges.some((b) => b)).toBe(false);
  expect(card.stars).toBe(0);
  expect(card.drawnStars).toBe(0);
  expect(card.cardPalette).toBe(0);
  expect(card.femaleBg).toBe(true);
  expect(card.picPixels).toBeGreaterThan(500);
  await game.screenshot('wtcard-female');
  await closeTrainerCard(game);
});
