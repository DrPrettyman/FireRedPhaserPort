// Field moves (field_effect.c's script table, party_menu.c's CursorCB_FieldMove, fldeff_*.c): Cut from a
// tree's script and from the party menu, cutting grass, Rock Smash with and without an encounter, Sweet
// Scent, Dig and Teleport warping out, Soft-Boiled in the party menu, and an HM without its badge.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

async function repel(game: Game) {
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
}

/** START → POKéMON → the first mon → its action menu's entry `action` (0 = the first field move). */
async function openFieldMove(game: Game, action = 0, mon = 0) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // POKéMON (the start menu's cursor starts on it)
  await game.waitFor((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the party menu' });
  await game.eval((t) => t.waitFrames(30));
  for (let i = 0; i < mon; i++) {
    await game.press('DOWN');
    await game.eval((t) => t.waitFrames(4));
  }
  await game.press('A'); // the mon's action menu
  await game.eval((t) => t.waitFrames(10));
  for (let i = 0; i < action; i++) {
    await game.press('DOWN');
    await game.eval((t) => t.waitFrames(4));
  }
  await game.press('A');
}

/** The current map's object at map-local (x, y). */
async function objectAt(game: Game, x: number, y: number) {
  return game.eval((t, x, y) => t.objects().find((o) => o.x === x && o.y === y), x, y);
}

test('Cut: talking to a cut tree with a badge and a mon that knows CUT cuts it down', async () => {
  // Vermilion City's tree by the gym (19, 24): EventScript_CutTree → dofieldeffect FLDEFF_USE_CUT_ON_TREE
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 19, y: 25, party: [{ species: 'FARFETCHD', level: 30, moves: ['CUT', 'PECK'] }] });
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE02_GET', true));
  await game.eval((t) => t.face('up'));
  expect((await objectAt(game, 19, 24))?.graphicsId).toBe('OBJ_EVENT_GFX_CUT_TREE');
  const since = await game.mark();
  await game.press('A');
  // "This tree looks like it can be CUT down! Would you like to CUT it?" → YES, "FARFETCH'D used CUT!"
  await game.mashUntil((t) => t.events().some((e) => e.type === 'fieldMoveShowMon'), { what: 'the show-mon banner' });
  const banner = await game.waitForEvent('fieldMoveShowMon', { since });
  await game.eval((t) => t.waitFrames(14));
  console.log(await game.screenshot('fieldmove-banner'));
  await game.eval((t) => t.waitFrames(30));
  console.log(await game.screenshot('fieldmove-banner2'));
  expect(banner.species).toBe(await game.eval((t) => t.define('SPECIES_FARFETCHD')));
  await game.waitFor((t) => t.idle() && !t.field()!.script, { what: 'the script to end' });
  expect(await objectAt(game, 19, 24)).toBeUndefined();
  expect(await game.eval((t) => t.flag('FLAG_TEMP_12'))).toBe(true);
  expect(await game.eval((t) => t.field()!.avatar.graphicsId)).toBe('OBJ_EVENT_GFX_RED_NORMAL');
});
