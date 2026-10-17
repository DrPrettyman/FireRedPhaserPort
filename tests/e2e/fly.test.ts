// The region map (menus/regionMap.ts) and Fly (world/fly.ts): the Town Map from the bag (incl. a dungeon's
// preview), a wall map, the fly map from the party menu, flying to a visited town and landing at its heal
// location, and the refusals (indoors, no Thunder Badge, a town not visited yet). The region map is a GBA
// screen: its state comes from `t.regionMap()`; `ready` means its main task takes input.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const PIDGEOT = { species: 'PIDGEOT', level: 40, moves: ['FLY'] };
// sMapSectionTopLeftCorners (region_map_sections.json): Pallet Town (4, 11), Viridian City (4, 8), Pewter City (4, 4)
const PALLET = { x: 4, y: 11 };
const VIRIDIAN = { x: 4, y: 8 };
// heal_locations.json: HEAL_LOCATION_VIRIDIAN_CITY
const VIRIDIAN_HEAL = { x: 26, y: 27 };

async function setFlags(game: Game, flags: string[]) {
  await game.eval((t, flags) => {
    for (const f of flags) t.state!.setFlag(f, true);
  }, flags);
}

/** START → POKéMON → the first mon → its first field move (the action menu's second entry) → A. */
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

/** Wait (in the page) for the region map's main task to take input: the open animation and fade are done. */
async function waitRegionMapReady(game: Game) {
  await game.eval((t) => t.until(() => !!t.regionMap()?.ready));
}

/** Move the region map's cursor: each press moves it a cell over 4 frames (MoveMapCursor). */
async function moveCursor(game: Game, dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', n = 1) {
  for (let i = 0; i < n; i++) {
    await game.press(dir);
    await game.eval((t) => t.until(() => !!t.regionMap()?.ready && !t.regionMap()!.moving));
  }
}

/** START → BAG → KEY ITEMS → the first item (the Town Map) → USE. */
async function useTownMap(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN');
  await game.press('A'); // BAG
  await game.waitForBag();
  await game.press('RIGHT'); // KEY ITEMS
  await game.eval((t) => t.waitFrames(20));
  await game.press('A'); // TOWN MAP
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // USE
  await waitRegionMapReady(game);
}

test('the Town Map opens from the bag on the player\'s town, shows a dungeon\'s preview and goes back to the bag', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_TOWN_MAP'), 1));
  await setFlags(game, ['FLAG_WORLD_MAP_VIRIDIAN_FOREST']);
  await useTownMap(game);
  const map = (await game.eval((t) => t.regionMap()))!;
  // REGIONMAP_TYPE_NORMAL, the cursor and the player icon on Pallet Town
  expect(map).toMatchObject({ type: 0, cursor: PALLET, player: PALLET, mapName: 'PALLET TOWN', selectedRegion: 0, mapsecType: 2 });
  expect(map.flyIcons).toEqual([]); // only the fly map has fly icons

  // Up the map to Viridian Forest: a visited dungeon, so A opens its preview.
  await moveCursor(game, 'UP', 5);
  const forest = (await game.eval((t) => t.regionMap()))!;
  expect(forest).toMatchObject({ cursor: { x: 4, y: 6 }, mapName: 'ROUTE 2', dungeonType: 2 }); // MAPSECTYPE_VISITED
  expect(forest.topBarRight).toContain('GUIDE');
  await game.press('A');
  await game.eval((t) => t.until(() => t.regionMap()?.task === 'Task_DrawDungeonMapPreviewFlavorText'));
  await game.eval((t) => t.waitFrames(90)); // the tint, then the name and description
  expect(await game.eval((t) => t.regionMap()!.preview)).toBe(true);
  await game.press('B');
  await game.eval((t) => t.until(() => t.regionMap()?.preview === false && !!t.regionMap()?.ready));

  // B closes the map (the close animation) and goes back to the bag.
  await game.press('B');
  await game.waitForBag({ what: 'back to the bag' });
  expect(await game.eval((t) => t.regionMap())).toBeUndefined();
  await game.press('B');
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
});

test('with the Sevii Islands, the Town Map switches between Kanto and the islands', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_TOWN_MAP'), 1));
  await setFlags(game, ['FLAG_SYS_SEVII_MAP_123']);
  await useTownMap(game);
  // START snaps the cursor to the switch button (SnapToIconOrButton), A opens the switch menu.
  await game.press('START');
  await game.eval((t) => t.waitFrames(4));
  const atSwitch = (await game.eval((t) => t.regionMap()))!;
  expect(atSwitch.cursor).toEqual({ x: 21, y: 11 });
  expect(atSwitch.topBarRight).toContain('SWITCH');
  await game.press('A');
  await game.eval((t) => t.until(() => t.regionMap()?.task === 'Task_SwitchMapMenu'));
  await game.eval((t) => t.waitFrames(40)); // the menu fades in and the screen dims
  await game.press('DOWN'); // SEVII ISLANDS 1-3
  await game.eval((t) => t.waitFrames(4));
  await game.press('A');
  await game.eval((t) => t.until(() => t.regionMap()?.switchMenu === false && !!t.regionMap()?.ready));
  expect(await game.eval((t) => t.regionMap())).toMatchObject({ selectedRegion: 1, playersRegion: 0 });
});

test('on the Sevii Islands, the Town Map opens on their map', async () => {
  // InitRegionMapType: a section in sSeviiMapsecs picks REGIONMAP_SEVII123; One Island is at (1, 8) there.
  const game = await session.start({ start: 'after-rival', map: 'OneIsland', x: 12, y: 18 });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_TOWN_MAP'), 1));
  await useTownMap(game);
  expect(await game.eval((t) => t.regionMap())).toMatchObject({ selectedRegion: 1, playersRegion: 1, cursor: { x: 1, y: 8 }, mapName: 'ONE ISLAND' });
});

test('indoors, the Town Map puts the player where the escape warp leads', async () => {
  // GetPlayerPositionOnRegionMap: an indoor map's position is gSaveBlock1Ptr->escapeWarp's.
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity_PokemonCenter_1F', x: 7, y: 6 });
  await game.eval((t) => {
    t.state!.bag.add(t.define('ITEM_TOWN_MAP'), 1);
    t.state!.escapeWarp = { mapId: 'MAP_VIRIDIAN_CITY', warpId: -1, x: 26, y: 27 };
  });
  await useTownMap(game);
  expect(await game.eval((t) => t.regionMap())).toMatchObject({ cursor: VIRIDIAN, player: VIRIDIAN, mapName: 'VIRIDIAN CITY' });
});

test('a wall map (special ShowTownMap) returns to the script', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await game.waitIdle();
  await game.eval(() =>
    (window as unknown as { game: { scene: { getScene(k: string): { startFieldScript(l: string): void } } } }).game.scene
      .getScene('Overworld')
      .startFieldScript('EventScript_WallTownMap'),
  );
  // "A TOWN MAP." then the map
  await game.mashUntil((t) => !!t.regionMap()?.ready, { what: 'the wall map' });
  // REGIONMAP_TYPE_WALL: no open animation, switch button, previews or fly icons
  expect(await game.eval((t) => t.regionMap())).toMatchObject({ type: 1, cursor: PALLET, flyIcons: [] });
  await game.press('B');
  await game.waitFor((t) => t.gbaScreen() === undefined, { what: 'back on the field' });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.script)).toBeFalsy();
});

test('Fly takes the player to a visited town\'s heal location', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14, party: [PIDGEOT] });
  await setFlags(game, ['FLAG_BADGE03_GET', 'FLAG_WORLD_MAP_VIRIDIAN_CITY']);
  await useFieldMove(game); // FLY
  await waitRegionMapReady(game);
  const map = (await game.eval((t) => t.regionMap()))!;
  // REGIONMAP_TYPE_FLY, a fly icon on each visited town
  expect(map).toMatchObject({ type: 2, cursor: PALLET, player: PALLET });
  expect(map.flyIcons.map((i) => ({ x: i.x, y: i.y }))).toEqual([VIRIDIAN, PALLET]);

  await moveCursor(game, 'UP', 3);
  const viridian = (await game.eval((t) => t.regionMap()))!;
  expect(viridian).toMatchObject({ cursor: VIRIDIAN, mapName: 'VIRIDIAN CITY', mapsecType: 2 });
  expect(viridian.topBarRight).toContain('OK');
  const since = await game.mark();
  await game.press('A');
  await game.waitForEvent('flyOut', { since });
  await game.waitForEvent('fieldMoveShowMon', { since });
  expect(await game.waitForEvent('flyWarp', { since })).toMatchObject({ map: 'MAP_VIRIDIAN_CITY', ...VIRIDIAN_HEAL });
  await game.waitForEvent('flyIn', { since, timeout: 60_000 });
  await game.waitForEvent('flyDone', { since, timeout: 60_000 });
  await game.waitIdle();
  // At the heal location, facing south, on foot
  expect(await game.eval((t) => t.field()!)).toMatchObject({
    map: 'ViridianCity',
    ...VIRIDIAN_HEAL,
    facing: 'down',
    playerVisible: true,
    avatar: { graphicsId: 'OBJ_EVENT_GFX_RED_NORMAL', flags: ['ON_FOOT', 'CONTROLLABLE'] },
  });
  expect(await game.eval((t) => t.field()!.fieldEffects)).not.toContain('FLDEFF_FLY_IN');
  // The controls are back.
  expect((await game.walk('down')).y).toBe(VIRIDIAN_HEAL.y + 1);
});

test('a town not visited yet can\'t be chosen; B goes back to the party menu', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14, party: [PIDGEOT] });
  await setFlags(game, ['FLAG_BADGE03_GET']);
  await useFieldMove(game); // FLY
  await waitRegionMapReady(game);
  await moveCursor(game, 'UP', 7); // Pewter City, not visited
  expect(await game.eval((t) => t.regionMap())).toMatchObject({ cursor: { x: 4, y: 4 }, mapName: 'PEWTER CITY', mapsecType: 3 }); // MAPSECTYPE_NOT_VISITED
  await game.press('A');
  await game.eval((t) => t.waitFrames(30));
  expect(await game.eval((t) => t.regionMap())).toMatchObject({ ready: true, cursor: { x: 4, y: 4 } }); // still choosing
  await game.press('B');
  await game.waitForPartyMenu({ what: 'the party menu again (CB2_ReturnToPartyMenuFromFlyMap)' });
  await game.mashUntil((t) => t.gbaScreen() === undefined && t.idle(), { button: 'B', what: 'back on the field' });
  expect(await game.eval((t) => t.field()!.map)).toBe('PalletTown');
});

test('Fly can\'t be used indoors: "Can\'t use that here."', async () => {
  // SetUpFieldMove_Fly: Overworld_MapTypeAllowsTeleportAndFly
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity_PokemonCenter_1F', x: 7, y: 6, party: [PIDGEOT] });
  await setFlags(game, ['FLAG_BADGE03_GET', 'FLAG_WORLD_MAP_VIRIDIAN_CITY']);
  const since = await game.mark();
  await useFieldMove(game);
  // (after the menu's own "Choose a POKéMON." message)
  await game.eval(
    (t, since) => t.until(() => t.events(since).some((e) => e.type === 'partyMenuMessage' && e.msgId === t.define('PARTY_MSG_CANT_USE_HERE'))),
    since,
  );
  await game.eval((t) => t.waitFrames(30));
  expect(await game.eval((t) => [t.gbaScreen(), !!t.regionMap()])).toEqual(['CB2_UpdatePartyMenu', false]);
  await game.press('A'); // Task_CancelAfterAorBPress
  await game.mashUntil((t) => t.gbaScreen() === undefined && t.idle(), { button: 'B', what: 'back on the field' });
});

test('Fly needs the Thunder Badge', async () => {
  // CursorCB_FieldMove: "This can't be used until a new BADGE is obtained." (no FLAG_BADGE03_GET)
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity', x: 26, y: 28, party: [PIDGEOT] });
  await setFlags(game, ['FLAG_WORLD_MAP_VIRIDIAN_CITY']);
  const since = await game.mark();
  await useFieldMove(game);
  await game.eval((t) => t.waitFrames(60));
  expect(await game.eval((t) => [t.gbaScreen(), !!t.regionMap()])).toEqual(['CB2_UpdatePartyMenu', false]);
  await game.mashUntil((t) => t.gbaScreen() === undefined && t.idle(), { button: 'B', what: 'back on the field' });
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'flyOut')).toBe(false);
});
