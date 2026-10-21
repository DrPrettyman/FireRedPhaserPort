// CONTINUE puts back what the save holds of the field (save version 14): load_save.c's SaveObjectEvents /
// LoadObjectEvents (gSaveBlock1Ptr->objectEvents), gSaveBlock1Ptr->objectEventTemplates with the scripts' edits
// (setobjectxyperm, copyobjectxytoperm, setobjectmovementtype; LoadSaveblockObjEventScripts takes the header's
// scripts) and fieldmap.c's SaveMapView / LoadSavedMapView (the 15 x 14 cells around the player, before ON_LOAD).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MACHAMP = { species: 'MACHAMP', level: 60, moves: ['STRENGTH', 'KARATE_CHOP'] };

/** START → SAVE → YES, then reload, CONTINUE, and skip the quest log's recap with B (tests/README.md item 12). */
async function saveAndContinue(game: Game) {
  await game.waitIdle();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  await game.pressTimes('DOWN', (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length);
  await game.press('A');
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press('UP');
  await game.press('A');
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
  await game.load({ keepSave: true, mainMenu: true });
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading && t.mainMenu(), { what: 'the main menu' });
  await game.press('A');
  await game.waitForEvent('ready', { timeout: 60_000 });
  await game.mashUntil((t) => !t.field()?.questLogPlayback && t.idle(), { button: 'B', what: 'the quest log skipped to the end', timeout: 60_000 });
  await game.waitIdle();
}

/** The current map's templates (OverworldScene.templatesFor), by local id. */
const templates = (game: Game) =>
  game.eval(() => {
    const s = (window as any).game.scene.getScene('Overworld');
    return (s.templatesFor(s.world.current) as { x: number; y: number; movement_type: string; script: string }[]).map((t, i) => ({
      localId: i + 1,
      x: t.x,
      y: t.y,
      movementType: t.movement_type,
      script: t.script,
    }));
  });

const objects = (game: Game) => game.eval((t) => t.objects().map((o) => ({ localId: o.localId, x: o.x, y: o.y, facing: o.facing, movementType: o.movementType })));

/** Run raw script commands as a field script and wait for it to end. */
async function run(game: Game, code: string[][]) {
  await game.waitIdle();
  expect(await game.eval((t, code) => t.runScript('ContinueObjects_Test', code), code)).toBe(true);
  await game.waitFor((t) => t.idle() && !t.field()!.script, { what: 'the test script' });
}

test("Victory Road 1F: the boulder pushed onto the switch stays there after CONTINUE, and the barrier stays open", async () => {
  const game = await session.start({ start: 'after-rival', map: 'VictoryRoad_1F', x: 20, y: 13, party: [MACHAMP] });
  await game.eval((t) => {
    t.state!.setVar('VAR_REPEL_STEP_COUNT', 500);
    t.state!.setFlag('FLAG_BADGE04_GET', true);
    t.state!.setFlag('FLAG_SYS_USE_STRENGTH', true);
  });
  const boulder = await game.eval(() => (window as any).game.scene.getScene('Overworld').resolveLocalId('LOCALID_VICTORY_ROAD_1F_BOULDER') as number);
  const barrierTop = await game.eval((t) => t.define('METATILE_Cave_RockBarrier_Top'));
  const ledgeTop = await game.eval((t) => t.define('METATILE_Cave_Floor_Ledge_Top'));
  expect((await game.eval((t) => t.metatileAt(12, 14)))!.metatile).toBe(barrierTop);
  // The boulder (at (7, 18) in the header) next to the switch at (20, 16): one push down puts it on.
  await run(game, [['setobjectxy', 'LOCALID_VICTORY_ROAD_1F_BOULDER', '20', '15']]);
  expect(await game.eval((t) => t.walk('down', 1))).toBeTruthy();
  await game.waitIdle();
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y])).toEqual([20, 14]);
  const since = await game.mark();
  const pushed = await game.eval(async (t) => {
    t.hold('DOWN');
    const ok = await t.until(() => t.field()?.avatar.action === 'WALK_IN_PLACE_NORMAL_DOWN', 60);
    t.release();
    return ok;
  });
  expect(pushed).toBe(true);
  expect((await game.waitForEvent('script', { since })).label).toBe('VictoryRoad_1F_EventScript_FloorSwitch');
  await game.waitFor((t) => t.idle() && !t.field()!.script, { what: 'the switch script' });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_VICTORY_ROAD_1F'))).toBe(100);
  expect((await objects(game)).find((o) => o.localId === boulder)).toMatchObject({ x: 20, y: 16 });
  expect((await templates(game))[boulder - 1]).toMatchObject({ x: 20, y: 16 }); // copyobjectxytoperm
  expect((await game.eval((t) => t.metatileAt(12, 14)))!.metatile).toBe(ledgeTop);
  // Another boulder pushed by hand (no script): only gSaveBlock1Ptr->objectEvents has it where it is now
  const other = 6; // at (4, 12) in the header
  await run(game, [['setobjectxy', String(other), '5', '13']]);

  await saveAndContinue(game);
  expect(await game.eval((t) => [t.field()!.map, t.field()!.x, t.field()!.y])).toEqual(['VictoryRoad_1F', 20, 14]);
  const after = await objects(game);
  expect(after.find((o) => o.localId === boulder)).toMatchObject({ x: 20, y: 16 });
  expect(after.find((o) => o.localId === other)).toMatchObject({ x: 5, y: 13 });
  const tpl = await templates(game);
  expect(tpl[boulder - 1]).toMatchObject({ x: 20, y: 16, script: 'EventScript_StrengthBoulder' }); // the header's script
  expect(tpl[other - 1]).toMatchObject({ x: 4, y: 12 });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_VICTORY_ROAD_1F'))).toBe(100);
  expect((await game.eval((t) => t.metatileAt(12, 14)))!.metatile).toBe(ledgeTop);
  expect((await game.eval((t) => t.metatileAt(12, 15)))!.collision).toBe(0);
});

test('an NPC moved by a script, setobjectxyperm / setobjectmovementtype and a setmetatile near the player survive CONTINUE', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PokemonTower_1F', x: 4, y: 10 });
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 500));
  const header = await templates(game);
  expect(header.slice(0, 3)).toMatchObject([
    { x: 18, y: 13, movementType: 'MOVEMENT_TYPE_FACE_UP' },
    { x: 18, y: 7, movementType: 'MOVEMENT_TYPE_FACE_LEFT' },
    { x: 15, y: 6, movementType: 'MOVEMENT_TYPE_FACE_UP' },
  ]);
  const near = await game.eval((t) => t.metatileAt(5, 11));
  const far = await game.eval((t) => t.metatileAt(16, 9)); // 12 tiles right of the player: outside SaveMapView's 15 x 14
  await run(game, [
    ['setobjectxy', '1', '12', '14'],
    ['turnobject', '1', 'DIR_WEST'],
    ['setobjectxyperm', '2', '17', '4'],
    ['setobjectmovementtype', '3', 'MOVEMENT_TYPE_FACE_RIGHT'],
    ['setmetatile', '5', '11', 'METATILE_General_Plain_Mowed', 'TRUE'],
    ['setmetatile', '16', '9', 'METATILE_General_Plain_Mowed', 'TRUE'],
  ]);
  const changed = { metatile: await game.eval((t) => t.define('METATILE_General_Plain_Mowed')), collision: 3 }; // MAPGRID_COLLISION_MASK
  expect(await game.eval((t) => t.metatileAt(5, 11))).toMatchObject(changed);
  expect(await game.eval((t) => t.metatileAt(16, 9))).toMatchObject(changed);
  expect((await objects(game)).slice(0, 3)).toMatchObject([
    { localId: 1, x: 12, y: 14, facing: 'left' },
    { localId: 2, x: 18, y: 7, facing: 'left' }, // setobjectxyperm moves the template only
    { localId: 3, x: 15, y: 6, movementType: 'MOVEMENT_TYPE_FACE_UP' }, // and setobjectmovementtype too
  ]);

  await saveAndContinue(game);
  expect(await game.eval((t) => [t.field()!.map, t.field()!.x, t.field()!.y])).toEqual(['PokemonTower_1F', 4, 10]);
  // LoadObjectEvents: the objects as saved
  expect((await objects(game)).slice(0, 3)).toMatchObject([
    { localId: 1, x: 12, y: 14, facing: 'left', movementType: 'MOVEMENT_TYPE_FACE_UP' },
    { localId: 2, x: 18, y: 7, facing: 'left' },
    { localId: 3, x: 15, y: 6, facing: 'up', movementType: 'MOVEMENT_TYPE_FACE_UP' },
  ]);
  // gSaveBlock1Ptr->objectEventTemplates: the scripts' edits, with the header's scripts
  const tpl = await templates(game);
  expect(tpl.slice(0, 3)).toMatchObject([
    { x: 18, y: 13, movementType: 'MOVEMENT_TYPE_FACE_UP', script: header[0].script },
    { x: 17, y: 4, movementType: 'MOVEMENT_TYPE_FACE_LEFT', script: header[1].script },
    { x: 15, y: 6, movementType: 'MOVEMENT_TYPE_FACE_RIGHT', script: header[2].script },
  ]);
  // LoadSavedMapView: the cell in the saved view keeps its metatile; the one outside it is the layout's again
  expect(await game.eval((t) => t.metatileAt(5, 11))).toMatchObject({ ...changed, drawn: true });
  expect(await game.eval((t) => t.metatileAt(16, 9))).toMatchObject({ metatile: far!.metatile, collision: far!.collision, drawn: true });
  expect(near).not.toMatchObject(changed);
  // ClearSavedMapView: CONTINUE used it up
  expect(await game.eval((t) => t.state!.mapView)).toBeUndefined();
});

test('leaving the map after CONTINUE brings back the header\'s templates (LoadObjEventTemplatesFromHeader)', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PokemonTower_1F', x: 11, y: 18 });
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 500));
  await run(game, [['setobjectxyperm', '2', '17', '4']]);
  await saveAndContinue(game);
  expect((await templates(game))[1]).toMatchObject({ x: 17, y: 4 });
  // Out to Lavender Town (the mat at (11, 18)) and back in through the door
  expect(await game.eval((t) => t.enterWarp())).toBe('LavenderTown');
  await game.walk('down'); // off the tower's door at (18, 6)
  const since = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since, what: 'Pokémon Tower 1F' });
  await game.eval((t) => t.until(() => t.idle(), 20000));
  expect(await game.eval((t) => t.field()!.map)).toBe('PokemonTower_1F');
  expect((await templates(game))[1]).toMatchObject({ x: 18, y: 7 });
  expect((await objects(game)).find((o) => o.localId === 2)).toMatchObject({ x: 18, y: 7 });
});
