// Main-path leftovers: Silph Co.'s card key doors (data/scripts/silphco_doors.inc), `setmaplayoutindex`
// (Seafoam Islands B3F/B4F's stopped currents), `special Field_AskSaveTheGame` (EventScript_AskSaveGame) and
// `seteventmon` (special CreateEnemyEventMon).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

/** The metatile id at a map-local cell, and whether its collision bits are set. */
function cell(game: Game, x: number, y: number) {
  return game.eval((t, x, y) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const f = t.field()!;
    const tile = s.world.tileAt(f.worldX - f.x + x, f.worldY - f.y + y);
    return { metatile: tile.metatile, impassable: tile.collision !== 0 };
  }, x, y);
}

async function scriptDone(game: Game, what: string) {
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what });
}

/** Mark the floor's trainers beaten, so none of them walks up mid-test. */
async function beatTrainers(game: Game, trainers: string[]) {
  await game.eval((t, names) => {
    for (const n of names) t.state!.setFlag(t.define('TRAINER_FLAGS_START') + t.define(`TRAINER_${n}`), true);
  }, trainers);
}

const SILPH_5F_TRAINERS = ['SCIENTIST_BEAU', 'TEAM_ROCKET_GRUNT_28', 'TEAM_ROCKET_GRUNT_29', 'JUGGLER_DALTON'];

test('Silph Co. 5F: a card key door blocks, needs the Card Key, opens and stays open', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SilphCo_5F', x: 9, y: 9, party: [MEWTWO] });
  await beatTrainers(game, SILPH_5F_TRAINERS);
  const d = await game.eval((t) => ({
    midLeft: t.define('METATILE_SilphCo_VerticalBarrier_MidLeft'),
    midRight: t.define('METATILE_SilphCo_VerticalBarrier_MidRight'),
    shade: t.define('METATILE_SilphCo_Floor_ShadeFull'),
  }));
  // SilphCo_5F_OnLoad → EventScript_Close5FDoor1
  expect(await cell(game, 7, 9)).toEqual({ metatile: d.midLeft, impassable: true });
  expect(await cell(game, 8, 9)).toEqual({ metatile: d.midRight, impassable: true });
  expect(await game.walk('left')).toMatchObject({ x: 9, y: 9 });

  // Without the key: EventScript_NeedCardKey
  await game.eval((t) => t.face('left'));
  await game.press('A');
  await game.mashUntil((t) => /needs a CARD KEY/i.test(t.message() ?? ''), { what: 'Text_ItNeedsCardKey' });
  await scriptDone(game, 'EventScript_NeedCardKey');
  expect(await game.eval((t) => t.flag('FLAG_SILPH_5F_DOOR_1'))).toBe(false);

  // With it (FLAG_HIDE_SILPH_CO_5F_CARD_KEY: the item ball is gone): EventScript_OpenDoor
  await game.eval((t) => t.state!.setFlag('FLAG_HIDE_SILPH_CO_5F_CARD_KEY', true));
  await game.press('A');
  await game.mashUntil((t) => /CARD KEY opened the door/i.test(t.message() ?? ''), { what: 'Text_CardKeyOpenedDoor' });
  await scriptDone(game, 'EventScript_OpenDoor');
  expect(await game.eval((t) => t.flag('FLAG_SILPH_5F_DOOR_1'))).toBe(true); // SetHiddenItemFlag
  expect(await cell(game, 7, 9)).toEqual({ metatile: d.shade, impassable: false });
  expect(await cell(game, 8, 9)).toEqual({ metatile: d.shade, impassable: false });
  expect(await game.walk('left', 2)).toMatchObject({ x: 7, y: 9, arrived: true });

  // Talking to it again: EventScript_DoorUnlocked
  await game.eval((t) => t.walkTo(9, 9));
  await game.eval((t) => t.face('left'));
  await game.press('A');
  await game.mashUntil((t) => /door is open/i.test(t.message() ?? ''), { what: 'Text_TheDoorIsOpen' });
  await scriptDone(game, 'EventScript_DoorUnlocked');

  // The warp pad at (15, 7) to 3F's (4, 6) and back: ON_LOAD leaves the open door alone.
  let mark = await game.mark();
  await game.eval((t) => t.walkTo(15, 7));
  await game.waitForEvent('map', { since: mark, what: 'Silph Co. 3F' });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.map)).toBe('SilphCo_3F');
  await game.walk('down');
  mark = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since: mark, what: 'Silph Co. 5F' });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.map)).toBe('SilphCo_5F');
  expect(await cell(game, 7, 9)).toEqual({ metatile: d.shade, impassable: false });
  // Door 2 is still shut.
  expect(await cell(game, 7, 18)).toEqual({ metatile: d.midLeft, impassable: true });
  console.log(game.log.filter((l) => /warn/.test(l)).join('\n'));
});

test('Silph Co. 5F: picking up the Card Key sets FLAG_HIDE_SILPH_CO_5F_CARD_KEY', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SilphCo_5F', x: 22, y: 20, party: [MEWTWO] });
  await beatTrainers(game, SILPH_5F_TRAINERS);
  await game.eval((t) => t.face('down'));
  await game.press('A');
  await game.mashUntil((t) => t.flag('FLAG_HIDE_SILPH_CO_5F_CARD_KEY') && t.idle() && !t.field()!.script, { what: 'the Card Key item ball' });
  expect(await game.eval((t) => t.itemCount('CARD_KEY'))).toBe(1);
});
