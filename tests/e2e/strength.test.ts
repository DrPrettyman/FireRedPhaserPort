// Strength (fldeff_strength.c + data/scripts/field_moves.inc): talking to a boulder (EventScript_StrengthBoulder)
// and from the party menu (SetUpFieldMove_Strength → EventScript_FldEffStrength), then pushing a boulder onto
// Victory Road 2F's floor switch (HandleBoulderActivateVictoryRoadSwitch → VictoryRoad_2F_EventScript_FloorSwitch1);
// without the Rainbow Badge the boulder only says what it is; FLAG_SYS_USE_STRENGTH goes with the map.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MACHAMP = { species: 'MACHAMP', level: 60, moves: ['STRENGTH', 'KARATE_CHOP'] };

async function repel(game: Game) {
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 500));
}

/** START → POKéMON → the first mon → its first field move (after SUMMARY) → A. */
async function useFieldMove(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // POKéMON
  await game.waitForPartyMenu();
  await game.press('A'); // the mon's action menu
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN');
  await game.eval((t) => t.waitFrames(4));
  await game.press('A');
}

/** Victory Road 2F's first boulder (LOCALID_VICTORY_ROAD_2F_BOULDER1, at (6, 17) on the map). */
async function boulder1(game: Game) {
  const id = await game.eval(() => (window as any).game.scene.getScene('Overworld').resolveLocalId('LOCALID_VICTORY_ROAD_2F_BOULDER1'));
  return game.eval((t, id) => t.objects().find((o) => o.localId === id), id);
}

/** Face `dir` and walk into the boulder there until it has moved one tile (Task_BumpBoulder). */
async function push(game: Game, dir: 'up' | 'down' | 'left' | 'right') {
  await game.waitIdle();
  const before = await boulder1(game);
  const button = dir.toUpperCase() as 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
  const action = `WALK_IN_PLACE_NORMAL_${button}`;
  // Hold, watch and release in one eval: split up, a busy machine can let the whole push go by before the watch
  // starts, or a second push start before the release arrives.
  const pushed = await game.eval(async (t, b, a) => {
    t.hold(b);
    const ok = await t.until(() => t.field()?.avatar.action === a, 60);
    t.release();
    return ok;
  }, button, action);
  expect(pushed).toBe(true);
  await game.eval((t) => t.until(() => !t.objects().some((o) => o.moving), 120));
  await game.waitIdle();
  const after = await boulder1(game);
  expect(after).not.toMatchObject({ x: before!.x, y: before!.y });
  return after!;
}

/** Wait for the field to be back and free (no menu, script or banner). */
async function waitFieldFree(game: Game, what: string) {
  await game.waitFor((t) => t.gbaScreen() === undefined && t.idle() && !t.field()!.script && !t.field()!.fieldEffects.some((e) => /^FLDEFF_(FIELD_MOVE_SHOW_MON|USE_)/.test(e)), { what });
}

test('talking to a boulder uses Strength; the boulder then goes onto Victory Road 2F\'s floor switch', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VictoryRoad_2F', x: 6, y: 16, party: [MACHAMP] });
  await repel(game);
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE04_GET', true));
  expect(await boulder1(game)).toMatchObject({ x: 6, y: 17, graphicsId: 'OBJ_EVENT_GFX_PUSHABLE_BOULDER' });
  // The rock barrier the switch takes away (VictoryRoad_2F_EventScript_SetRockBarrier1).
  const barrier = await game.eval((t) => t.define('METATILE_Cave_RockBarrier_Top'));
  const metatileAt = (x: number, y: number) =>
    game.eval((t, x, y) => {
      const s = (window as any).game.scene.getScene('Overworld');
      const f = t.field()!;
      return s.world.tileAt(f.worldX - f.x + x, f.worldY - f.y + y).metatile;
    }, x, y);
  expect(await metatileAt(13, 10)).toBe(barrier);

  await game.eval((t) => t.face('down'));
  const since = await game.mark();
  await game.press('A');
  // "It's a big boulder, but a POKéMON may be able to push it aside. Would you like to use STRENGTH?" → YES
  await game.mashUntil((t) => t.events().some((e) => e.type === 'fieldMoveShowMon'), { what: 'the show-mon banner' });
  expect(await game.waitForEvent('fieldMoveShowMon', { since })).toMatchObject({ species: await game.eval((t) => t.define('SPECIES_MACHAMP')), outdoors: false });
  // "MACHAMP used STRENGTH! MACHAMP's STRENGTH made it possible to move boulders around!"
  await game.mashUntil((t) => t.flag('FLAG_SYS_USE_STRENGTH') && t.idle() && !t.field()!.script, { what: 'EventScript_UseStrength' });
  // (FldEff_UseStrength's GetMonNickname: STR_VAR_1 for the message)
  expect(await game.eval((t) => t.state!.stringVars[0].length)).toBe(7);

  // Talking to it again: "STRENGTH made it possible to move boulders around."
  await game.press('A');
  await game.mashUntil((t) => /^STRENGTH made it possible/.test(t.message() ?? ''), { what: 'EventScript_AlreadyUsedStrength' });
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the script to end' });

  // Down, left twice, down, left twice: onto the switch at (2, 19).
  expect(await push(game, 'down')).toMatchObject({ x: 6, y: 18 });
  expect(await game.eval((t) => t.walkTo(7, 18))).toMatchObject({ arrived: true });
  expect(await push(game, 'left')).toMatchObject({ x: 5, y: 18 });
  await game.eval((t) => t.walk('left', 1));
  expect(await push(game, 'left')).toMatchObject({ x: 4, y: 18 });
  expect(await game.eval((t) => t.walkTo(4, 17))).toMatchObject({ arrived: true });
  expect(await push(game, 'down')).toMatchObject({ x: 4, y: 19 });
  expect(await game.eval((t) => t.walkTo(5, 19))).toMatchObject({ arrived: true });
  expect(await push(game, 'left')).toMatchObject({ x: 3, y: 19 });
  await game.eval((t) => t.walk('left', 1));
  const switchMark = await game.mark();
  expect(await push(game, 'left')).toMatchObject({ x: 2, y: 19 });
  expect((await game.waitForEvent('script', { since: switchMark })).label).toBe('VictoryRoad_2F_EventScript_FloorSwitch1');
  await game.waitFor((t) => t.idle() && !t.field()!.script, { what: 'the switch script' });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_VICTORY_ROAD_2F_BOULDER1'))).toBe(100);
  expect(await metatileAt(13, 10)).toBe(await game.eval((t) => t.define('METATILE_Cave_Floor_Ledge_Top')));
  // copyobjectxytoperm: the boulder's template is where the switch is now.
  expect(
    await game.eval(() => {
      const s = (window as any).game.scene.getScene('Overworld');
      const id = s.resolveLocalId('LOCALID_VICTORY_ROAD_2F_BOULDER1');
      const tpl = s.templatesFor(s.world.current)[id - 1];
      return { x: tpl.x, y: tpl.y };
    }),
  ).toEqual({ x: 2, y: 19 });

  // ClearTempFieldEventData: Strength ends with the map (the ladder at (1, 9) down to Victory Road 1F).
  const mapMark = await game.mark();
  expect(await game.eval((t) => t.walkTo(1, 10))).toMatchObject({ arrived: true });
  await game.walk('up');
  await game.waitForEvent('map', { since: mapMark, what: 'Victory Road 1F' });
  expect(await game.eval((t) => t.flag('FLAG_SYS_USE_STRENGTH'))).toBe(false);
});

test('Strength from the party menu (SetUpFieldMove_Strength → EventScript_FldEffStrength), then push', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VictoryRoad_2F', x: 6, y: 16, party: [MACHAMP] });
  await repel(game);
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE04_GET', true));
  await game.eval((t) => t.face('down'));
  const since = await game.mark();
  await useFieldMove(game); // STRENGTH
  await game.waitForEvent('fieldMoveShowMon', { since });
  expect((await game.waitForEvent('script', { since })).label).toBe('EventScript_FldEffStrength');
  await game.mashUntil((t) => t.flag('FLAG_SYS_USE_STRENGTH') && t.idle() && !t.field()!.script, { what: 'EventScript_UseStrength' });
  await waitFieldFree(game, 'the field');
  expect(await push(game, 'down')).toMatchObject({ x: 6, y: 18 });
});

test('Strength from the party menu with no boulder in front says it can\'t be used here', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VictoryRoad_2F', x: 6, y: 16, party: [MACHAMP] });
  await repel(game);
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE04_GET', true));
  await game.eval((t) => t.face('up'));
  const since = await game.mark();
  await useFieldMove(game);
  await game.eval((t) => t.waitFrames(60));
  expect(await game.eval((t) => t.gbaScreen())).toBe('CB2_UpdatePartyMenu');
  await game.mashUntil((t) => t.gbaScreen() === undefined && t.idle(), { button: 'B', what: 'back on the field' });
  expect((await game.events(since)).some((e) => e.type === 'fieldMoveShowMon')).toBe(false);
  expect(await game.eval((t) => t.flag('FLAG_SYS_USE_STRENGTH'))).toBe(false);
});

test('without the Rainbow Badge a boulder can\'t be moved (EventScript_CantMoveBoulder)', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VictoryRoad_2F', x: 6, y: 16, party: [MACHAMP] });
  await repel(game);
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE04_GET', false));
  await game.eval((t) => t.face('down'));
  const since = await game.mark();
  await game.press('A');
  await game.mashUntil((t) => /may be able to push it aside\.$/.test(t.message() ?? ''), { what: 'Text_MonMayPushBoulder' });
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the script to end' });
  expect((await game.events(since)).some((e) => e.type === 'fieldMoveShowMon')).toBe(false);
  expect(await game.eval((t) => t.flag('FLAG_SYS_USE_STRENGTH'))).toBe(false);
  // Walking into it does nothing.
  await game.eval((t) => t.hold('DOWN'));
  await game.eval((t) => t.waitFrames(40));
  await game.eval((t) => t.release());
  expect(await boulder1(game)).toMatchObject({ x: 6, y: 17 });
});
