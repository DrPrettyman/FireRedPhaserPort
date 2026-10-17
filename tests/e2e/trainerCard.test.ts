// The trainer card (menus/trainerCard.ts, trainer_card.c) from the start menu's PLAYER: the card front with the
// player's name, ID, money, Pokédex count and play time, the stars (the card's colour), the badges and the pic;
// the play time's colon blinking; A flips to the back (name, Hall of Fame debut, the photo's mon icons, stickers;
// the link stats are 0, so not printed), B flips back, B on the front and A on the back close the card. The card is
// on the GBA layer: its state comes from `t.trainerCard()`, whose `ready` / `backReady` mean that side takes input.

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

/**
 * Press `button` (A on the front, B on the back) and watch the flip in the page until the other side takes input:
 * the flip task's steps, how far the card closed, and whether BG0VOFS was set per line with offsets in it.
 */
async function flipCard(game: Game, button: 'A' | 'B') {
  return game.eval(async (t, b) => {
    const seen = { states: [] as number[], maxTop: 0, squashed: false, minBlendY: 99, maxBlendY: 0 };
    const toBack = !t.trainerCard()!.onBack;
    const done = t.until(() => {
      const p = t.trainerCard()!;
      if (p.flip) {
        if (!seen.states.includes(p.flip.state)) seen.states.push(p.flip.state);
        seen.maxTop = Math.max(seen.maxTop, p.flip.cardTop);
        seen.maxBlendY = Math.max(seen.maxBlendY, p.flip.blendY);
        seen.minBlendY = Math.min(seen.minBlendY, p.flip.blendY);
        if (p.flip.squash && p.flip.vofs.some((v) => v !== 0)) seen.squashed = true;
      }
      return toBack ? p.backReady : p.ready;
    });
    await t.press(b);
    await done;
    return seen;
  }, button);
}

/** The flip both ways: closes to a line at 77 (darkening as it goes), squashing BG0 per line, then opens again. */
function expectFlipped(seen: Awaited<ReturnType<typeof flipCard>>) {
  expect(seen.states).toEqual(expect.arrayContaining([1, 2, 4])); // down, draw the other side, up
  expect(seen.maxTop).toBe(77);
  expect(seen.squashed).toBe(true);
  expect(seen.maxBlendY).toBe(11); // (77 + 40) / 10
  expect(seen.minBlendY).toBe(0);
}

/** B on the front (A on the back): the card fades out and the start menu comes back on PLAYER. */
async function closeTrainerCard(game: Game, button: 'A' | 'B' = 'B') {
  await game.press(button);
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

  // A flips to the back: the name and the Hall of Fame debut; no link battles, trades, Berry Crush or Union Room
  // lines (all 0). No photo or stickers yet.
  expectFlipped(await flipCard(game, 'A'));
  let back = (await game.eval((t) => t.trainerCard()))!;
  expect(back.onBack).toBe(true);
  expect(back.flip).toBeUndefined();
  expect(back.squashActive).toBe(false);
  expect(back.printed.backName).toBe(setup.name);
  expect(back.printed.hofDebut!.trim()).toBe('12:34:56');
  for (const line of ['linkRecord', 'trades', 'berryCrush', 'unionRoom']) expect(back.printed[line]).toBeUndefined();
  expect(back.drawnIcons.every((p) => p === -1)).toBe(true);
  expect(back.drawnStickers.every((p) => p === -1)).toBe(true);
  // The front's badges and stars aren't on the back.
  expect(back.drawnBadges.some((b) => b)).toBe(false);
  expect(back.drawnStars).toBe(0);
  await game.screenshot('wtcard-back');

  // B flips back to the front: the badges, stars, pic and text again.
  expectFlipped(await flipCard(game, 'B'));
  const front = (await game.eval((t) => t.trainerCard()))!;
  expect(front.onBack).toBe(false);
  expect(front.squashActive).toBe(false);
  expect(front.drawnBadges).toEqual(badges);
  expect(front.drawnStars).toBe(1);
  expect(front.picPixels).toBeGreaterThan(500);
  expect(front.printed.money).toBe('¥12345');

  // And to the back again, where A closes the card.
  expectFlipped(await flipCard(game, 'A'));
  back = (await game.eval((t) => t.trainerCard()))!;
  expect(back.printed.hofDebut!.trim()).toBe('12:34:56');
  await closeTrainerCard(game, 'A');
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

test("the back shows the photo's mon icons (sepia) and the stickers, and no Hall of Fame debut before the Hall of Fame", async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  const expected = await game.eval((t) => {
    const s = t.state!;
    // The Celadon Game Corner photo (UpdateTrainerCardPhotoIcons stores mail species: Unown C is 30000 + 2), sepia.
    s.setVar('VAR_TRAINER_CARD_MON_ICON_1', t.define('SPECIES_PIKACHU'));
    s.setVar('VAR_TRAINER_CARD_MON_ICON_2', t.define('SPECIES_BULBASAUR'));
    s.setVar('VAR_TRAINER_CARD_MON_ICON_4', 30000 + 2);
    s.setVar('VAR_TRAINER_CARD_MON_ICON_TINT_IDX', 3); // MON_ICON_TINT_SEPIA
    // The Four Island sticker man: the Hall of Fame and link win stickers.
    s.setVar('VAR_HOF_BRAG_STATE', 1);
    s.setVar('VAR_LINK_WIN_BRAG_STATE', 3);
    return { species: ['SPECIES_PIKACHU', 'SPECIES_BULBASAUR', 'SPECIES_NONE', 'SPECIES_UNOWN_C', 'SPECIES_NONE', 'SPECIES_NONE'].map((n) => t.define(n)) };
  });
  await openTrainerCard(game);
  expectFlipped(await flipCard(game, 'A'));
  const back = (await game.eval((t) => t.trainerCard()))!;
  expect(back.printed.backName).toBeDefined();
  expect(back.printed.hofDebut).toBeUndefined();
  expect(back.monSpecies).toEqual(expected.species);
  // Each photo mon's icon on BG3 with its icon palette (BG palettes 5-7); empty slots aren't drawn.
  back.drawnIcons.forEach((pal, i) => {
    if (expected.species[i]) expect([5, 6, 7]).toContain(pal);
    else expect(pal).toBe(-1);
  });
  // Sepia: every colour of the icon palette has red >= green >= blue.
  for (const c of back.iconPalette) {
    const [r, g, b] = [c & 31, (c >> 5) & 31, (c >> 10) & 31];
    expect(r >= g && g >= b).toBe(true);
  }
  expect(back.iconPalette.some((c) => c !== 0)).toBe(true);
  // The stickers: slot 1 in sticker palette 1 (BG palette 11), slot 3 in palette 3 (BG palette 13).
  expect(back.drawnStickers).toEqual([11, -1, 13]);
  await game.screenshot('wtcard-back-photo');
  await closeTrainerCard(game, 'A');
});
