// Dive (world/dive.ts), an R/S leftover FRLG compiles but never reaches: EventScript_DeepWater asks, then
// `dofieldeffect FLDEFF_USE_DIVE` (FldEff_UseDive: the banner, then dive_warp through the map's dive connection,
// DoDiveWarp with FieldCB_DefaultWarpExit). No FRLG map has a dive connection or MB_DEEP_WATER, so the test
// gives Six Island one and starts the script by hand with the player surfing on MB_FAST_WATER (diveable).

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';

const session = useGame();

const LAPRAS: MonSpec = { species: 'LAPRAS', level: 40, moves: ['SURF', 'DIVE'] };
/** Six Island: MB_FAST_WATER at (13, 23); arriving on water starts the player surfing. */
const FAST_WATER = { start: 'after-rival', map: 'SixIsland', x: 13, y: 23 } as const;

/** The field scene, the world tile's behavior under the player and the MB_FAST_WATER id; adds a dive connection to `dest`. */
async function setUp(game: Game, dest: string | undefined) {
  return game.eval((t, destMap) => {
    const s = (window as any).game.scene.getScene('Overworld');
    if (destMap) s.world.current.data.connections.push({ map: destMap, offset: 0, direction: 'dive' });
    const f = t.field()!;
    return { behavior: s.world.tileAt(f.worldX, f.worldY).behavior as number, fastWater: s.defines.require('MB_FAST_WATER') as number, flags: f.avatar.flags };
  }, dest);
}

async function startDeepWater(game: Game) {
  await game.waitIdle();
  await game.eval(() => (window as any).game.scene.getScene('Overworld').startFieldScript('EventScript_DeepWater'));
  await game.mashUntil((t) => t.message()?.includes('use DIVE?'), { what: '"The sea is deep here. Would you like to use DIVE?"' });
}

test('EventScript_DeepWater: the question, the banner, then a dive warp to the same tile of the connected map', async () => {
  const game = await session.start({ ...FAST_WATER, party: [LAPRAS] });
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
  const setup = await setUp(game, 'MAP_ROUTE21_NORTH');
  expect(setup.behavior).toBe(setup.fastWater);
  expect(setup.flags).toContain('SURFING');
  const since = await game.mark();
  await startDeepWater(game);
  // YES (the cursor starts there)
  // "LAPRAS used DIVE.", then dofieldeffect, releaseall, end: the effect runs on after the script
  await game.mashUntil((t) => !t.field()!.script, { what: '"LAPRAS used DIVE." and the end of the script' });
  await game.waitForEvent('diveShowMon', { since, timeout: 60_000 });
  await game.waitForEvent('fieldMoveShowMon', { since, timeout: 60_000 });
  const dive = await game.waitForEvent('diveWarp', { since, timeout: 60_000 });
  expect(dive).toMatchObject({ dir: 'dive', map: 'MAP_ROUTE21_NORTH', x: 13, y: 23 });
  expect((await game.waitForEvent('diveDone', { since })).warped).toBe(true);
  await game.waitFor((t) => t.field()?.map === 'Route21_North' && t.idle(), { what: 'on Route 21 North, the field free', timeout: 60_000 });
  const f = (await game.eval((t) => t.field()))!;
  expect([f.x, f.y]).toEqual([13, 23]);
  // FieldCB_DefaultWarpExit's Task_ExitNonDoor: UnfreezeObjectEvents, UnlockPlayerFieldControls
  expect(f.locked).toBe(false);
  expect(f.objectsFrozen).toBe(false);
  expect(f.fieldEffects.filter((e) => /SHOW_MON|USE_DIVE/.test(e))).toEqual([]);
});

test('without a dive connection the banner shows and nothing else happens (the C leaves the player locked)', async () => {
  const game = await session.start({ ...FAST_WATER, party: [LAPRAS] });
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
  await setUp(game, undefined);
  const since = await game.mark();
  await startDeepWater(game);
  // "LAPRAS used DIVE.", then dofieldeffect, releaseall, end: the effect runs on after the script
  await game.mashUntil((t) => !t.field()!.script, { what: '"LAPRAS used DIVE." and the end of the script' });
  await game.waitForEvent('fieldMoveShowMon', { since, timeout: 60_000 });
  const done = await game.waitForEvent('diveDone', { since, timeout: 60_000 });
  expect(done.warped).toBe(false);
  const f = (await game.eval((t) => t.field()))!;
  expect([f.map, f.x, f.y]).toEqual(['SixIsland', 13, 23]);
  // DiveFieldEffect_ShowMon's LockPlayerFieldControls and _Init's preventStep are never undone.
  expect(f.locked).toBe(true);
});
