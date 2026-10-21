// FINISH_PLAN.md units 6 and 1 (W-small): the L=A button mode on the field (ReadKeys' remap, gba/main.ts and
// input/Input.ts), the GAME_STAT increments the C does (field_control_avatar.c's GAME_STAT_STEPS, start_menu.c's
// GAME_STAT_SAVED_GAME, battle_setup.c's battle counts, fldeff_cut.c's GAME_STAT_USED_CUT).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const stat = (game: Game, name: string) => game.eval((t, name) => t.state!.getGameStat(t.define(name)), name);

test('L=A: in that button mode L reads a sign on the field (in LR it does nothing), and the help system stays shut', async () => {
  // Pallet Town's town sign (9, 11): PalletTown_EventScript_TownSign
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 9, y: 12 });
  // (turning to it walks into it: TrySetUpWalkIntoSignpostScript shows the sign once; B closes it)
  await game.eval((t) => t.face('up'));
  await game.mashUntil((t) => !t.field()!.script && t.idle(), { button: 'B', what: 'the field' });
  // The LR mode: L is nothing on the field
  await game.eval((t) => (t.state!.optionsButtonMode = t.define('OPTIONS_BUTTON_MODE_LR')));
  await game.press('L');
  expect(await game.eval(async (t) => (await t.waitFrames(10), t.field()!.script))).toBeUndefined();

  await game.eval((t) => (t.state!.optionsButtonMode = t.define('OPTIONS_BUTTON_MODE_L_EQUALS_A')));
  const script = await game.eval(async (t) => {
    t.hold('L');
    const ok = await t.until(() => !!t.field()!.script, 30);
    const label = t.field()!.script;
    t.release('L');
    return ok ? label : undefined;
  });
  expect(script).toBe('PalletTown_EventScript_TownSign');
  expect(await game.eval((t) => t.helpSystem().videoState)).toBe(0);
  // L also closes the message, as A would
  const closed = await game.eval(async (t) => {
    for (let i = 0; i < 60 && t.field()!.script; i++) {
      t.hold('L');
      await t.waitFrames(2);
      t.release('L');
      await t.waitFrames(6);
    }
    return !t.field()!.script;
  });
  expect(closed).toBe(true);
});

test('GAME_STAT_STEPS counts every step the player takes; GAME_STAT_SAVED_GAME every save', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 10, y: 14 });
  await game.waitIdle();
  const steps = await stat(game, 'GAME_STAT_STEPS');
  await game.eval((t) => t.walk('right', 3));
  await game.waitIdle();
  expect(await stat(game, 'GAME_STAT_STEPS')).toBe(steps + 3);

  const saves = await stat(game, 'GAME_STAT_SAVED_GAME');
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  const downs = (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length;
  await game.pressTimes('DOWN', downs);
  await game.press('A');
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press('UP');
  await game.press('A');
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  expect(await stat(game, 'GAME_STAT_SAVED_GAME')).toBe(saves + 1);
  // ... and the count is in the save (IncrementGameStat runs before TrySavingData)
  const saved = await game.eval((t) => JSON.parse(localStorage.getItem('firered-phaser:save') ?? 'null'));
  expect(saved.gameStats[await game.eval((t) => t.define('GAME_STAT_SAVED_GAME'))]).toBe(saves + 1);
});

test('a wild battle counts GAME_STAT_TOTAL_BATTLES and _WILD_BATTLES', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 9, y: 30, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await game.waitIdle();
  const total = await stat(game, 'GAME_STAT_TOTAL_BATTLES');
  const wild = await stat(game, 'GAME_STAT_WILD_BATTLES');
  const trainer = await stat(game, 'GAME_STAT_TRAINER_BATTLES');
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2 }));
  await game.mashUntil((t) => t.events().find((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  expect(await stat(game, 'GAME_STAT_TOTAL_BATTLES')).toBe(total + 1);
  expect(await stat(game, 'GAME_STAT_WILD_BATTLES')).toBe(wild + 1);
  expect(await stat(game, 'GAME_STAT_TRAINER_BATTLES')).toBe(trainer);
});

test('cutting a tree counts GAME_STAT_USED_CUT', async () => {
  // Vermilion City's tree by the gym (19, 24), as in fieldMoves.test.ts
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 19, y: 25, party: [{ species: 'FARFETCHD', level: 30, moves: ['CUT', 'PECK'] }] });
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE02_GET', true));
  await game.eval((t) => t.face('up'));
  const cuts = await stat(game, 'GAME_STAT_USED_CUT');
  await game.press('A');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'fieldMoveShowMon'), { what: 'the show-mon banner' });
  expect(await stat(game, 'GAME_STAT_USED_CUT')).toBe(cuts + 1);
});
