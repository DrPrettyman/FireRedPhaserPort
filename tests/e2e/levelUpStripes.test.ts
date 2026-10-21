// A battle level-up's effects (FINISH_PLAN.md A2): battle_controller_player.c's Task_CreateLevelUpVerticalStripes
// starts pokemon_special_anim_scene.c's CreateLevelUpVerticalSpritesTask for a mon that is sent out (18 translucent
// stripes rising over it, BLDALPHA 12 / 6) and waits for the last to rise before the battle goes on; for exp to a mon
// that isn't sent out (an Exp. Share), Cmd_drawlvlupbox slides in the level-up banner with the mon's icon
// (PutMonIconOnLvlUpBanner), which follows the banner in and out, and no stripes rise. Frames are logic ticks.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const ROUTE1_GRASS = { start: 'after-rival', map: 'Route1', x: 12, y: 7 } as const;

// In-page tags: the stripes' tileTag in battle is 10000; TAG_LVLUP_BANNER_MON_ICON is 55130.

/** Put party mon `i` one exp point short of `level`. */
const setExpJustBelow = (game: Game, i: number, level: number) =>
  game.eval(
    (t, idx, lv) => {
      const mon = t.state!.party[idx];
      const pk = t.state!.pokemon;
      mon.exp = pk.tables.experience[pk.species[mon.species].growthRate][lv] - 1;
    },
    i,
    level,
  );

test('a sent-out mon levels up: the stripes rise over it, the battle waits for them, then goes on', async () => {
  // Mewtwo (level 50, one exp point short of 51) one-shots a level-2 Rattata.
  const game = await session.start({ ...ROUTE1_GRASS, party: [{ species: 'MEWTWO', level: 50, iv: 31, moves: ['PSYCHIC'] }] });
  await setExpJustBelow(game, 0, 51);
  const mark = await game.mark();
  // Per tick from the task's start to its end: the stripes on screen, their positions, BLDALPHA, the mon's sprite.
  const watched = game.watch(
    (t) => {
      const w = window as unknown as { __stripes?: { counts: number[]; xs: number[]; ys: number[]; bldalpha: number[]; monHidden: boolean[] } };
      const start = t.events().find((e) => e.type === 'levelUpStripes' && e.phase === 'start');
      if (!start) return undefined;
      const rec = (w.__stripes ??= { counts: [], xs: [], ys: [], bldalpha: [], monHidden: [] });
      const stripes = t.gbaSprites().filter((s) => s.tileTag === 10000);
      rec.counts.push(stripes.length);
      for (const s of stripes) {
        rec.xs.push(s.x);
        rec.ys.push(s.y);
      }
      rec.bldalpha.push(t.gpuReg(0x52));
      rec.monHidden.push(!!t.battle()?.mons[0].spriteInvisible);
      if (t.events().some((e) => e.type === 'levelUpStripes' && e.phase === 'end')) {
        delete w.__stripes;
        return rec;
      }
      return undefined;
    },
    { what: 'the level-up stripes', maxFrames: 30000 },
  );
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 2 }));
  await game.mashUntil((t) => t.events().some((e) => e.type === 'levelUpStripes' && e.phase === 'end'), { what: 'the stripes to end' });
  const rec = await watched;
  const evs = (await game.events(mark)).filter((e) => e.type === 'levelUpStripes');
  expect(evs.map((e) => [e.phase, e.stripes])).toEqual([
    ['start', true],
    ['end', undefined],
  ]);
  // 18 stripes, one every other frame, rising at their ISO_RANDOMIZE1 speeds: the 16th (35 / 16 px a frame) is the
  // last off, 60 frames in; the battle's task sees the stripes' task gone on the next. At most 10 are up at once.
  expect(evs[1].frame - evs[0].frame).toBe(61);
  expect(Math.max(...rec.counts)).toBe(10);
  expect(rec.counts.at(-1)).toBe(0);
  // ((n * 219) & 0x3F) + x - 32 and y + 32 as they start, rising 64 px: around the mon (back sprite at x 72).
  expect(Math.max(...rec.xs) - Math.min(...rec.xs)).toBeLessThan(64);
  expect(Math.max(...rec.ys) - Math.min(...rec.ys)).toBeLessThanOrEqual(64);
  // BLDALPHA_BLEND(12, 6) while they rise; the mon is on the BG (its sprite hidden) until they're gone.
  expect(rec.bldalpha.slice(1, -1).every((v) => v === 0x060c)).toBe(true);
  expect(rec.monHidden.slice(0, -1).every(Boolean)).toBe(true);

  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  expect((await game.eval((t) => t.party()))[0]).toMatchObject({ species: 'MEWTWO', level: 51 });
});

test('exp to a mon not sent out: the level-up banner shows its icon, sliding in and out with the banner; no stripes', async () => {
  // Mewtwo (level 100: no exp) beats Rattata; Pidgey, one exp point short of 6, holds the Exp. Share.
  const game = await session.start({
    ...ROUTE1_GRASS,
    party: [
      { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] },
      { species: 'PIDGEY', level: 5, moves: ['TACKLE'], item: 'EXP_SHARE' },
    ],
  });
  await setExpJustBelow(game, 1, 6);
  const mark = await game.mark();
  // The icon sprite per tick, from its creation to its destruction, and the screen once it's all the way in.
  const watched = game.watch(
    (t) => {
      const w = window as unknown as { __icon?: { xs: number[]; ys: number[]; seen: boolean; shot?: string } };
      const rec = (w.__icon ??= { xs: [], ys: [], seen: false });
      const icon = t.gbaSprites().find((s) => s.tileTag === 55130);
      if (icon) {
        rec.seen = true;
        if (rec.xs.at(-1) !== icon.x) {
          rec.xs.push(icon.x);
          rec.ys.push(icon.y);
        }
        return undefined;
      }
      if (rec.seen) {
        delete w.__icon;
        return rec;
      }
      return undefined;
    },
    { what: 'the level-up banner icon', maxFrames: 30000 },
  );
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 2 }));
  const shot = game.mashUntil((t) => (t.gbaSprites().some((s) => s.tileTag === 55130 && s.x === 160) ? true : undefined), {
    what: 'the banner all the way in',
  });
  await shot;
  await game.screenshot('levelUpBanner-icon');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  const rec = await watched;
  // CreateSprite at x 256, x2 = 416 - gBattle_BG2_X: in by 8 a frame to 160, out by 16;
  // destroyed in the tick it's back at 256 (x2 0 with sDestroy set).
  expect(rec.xs[0]).toBe(256);
  expect(rec.xs).toContain(160);
  const peak = rec.xs.indexOf(160);
  expect(rec.xs.slice(0, peak + 1)).toEqual(Array.from({ length: 13 }, (_, i) => 256 - 8 * i));
  expect(rec.xs.slice(peak)).toEqual(Array.from({ length: 6 }, (_, i) => 160 + 16 * i));
  expect(new Set(rec.ys)).toEqual(new Set([10]));

  const party = await game.eval((t) => t.party());
  expect(party[1]).toMatchObject({ species: 'PIDGEY', level: 6 });
  // The controller's task still ran for battler 0 (its sprite is visible), but IsMonGettingExpSentOut made no stripes.
  const evs = (await game.events(mark)).filter((e) => e.type === 'levelUpStripes');
  expect(evs.map((e) => [e.phase, e.stripes])).toEqual([
    ['start', false],
    ['end', undefined],
  ]);
  expect(evs[1].frame - evs[0].frame).toBeLessThanOrEqual(2);
  expect(await game.eval((t) => t.gbaSprites().some((s) => s.tileTag === 55130 || s.tileTag === 10000))).toBe(false);
});
