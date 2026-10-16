// The region map (menus/regionMap.ts) and Fly (world/fly.ts): the Town Map from the bag, the fly map from the
// party menu, flying to a visited town and landing at its heal location, and the refusals (indoors, no badge,
// a town not visited yet). The region map is a GBA screen: its state comes from `t.regionMap()`.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const PIDGEOT = { species: 'PIDGEOT', level: 40, moves: ['FLY'] };

/** Thunder Badge (FLAG_BADGE03_GET: Fly's HM badge) and the towns' FLAG_WORLD_MAP_* flags. */
async function setFlags(game: Game, flags: string[]) {
  await game.eval((t, flags) => {
    for (const f of flags) t.state!.setFlag(f, true);
  }, flags);
}

/** START → POKéMON → the first mon → its action menu's second entry (the first field move) → A. */
async function useFieldMove(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // POKéMON
  await game.waitFor((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu', { what: 'the party menu' });
  await game.eval((t) => t.waitFrames(40));
  await game.press('A'); // the mon's action menu
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN');
  await game.eval((t) => t.waitFrames(4));
  await game.press('A');
}

/** Wait for the region map's main task to take input (the open animation / fade done). */
async function waitRegionMapInput(game: Game) {
  await game.eval((t) => t.until(() => !!t.regionMap()?.ready));
}

/** Move the region map's cursor one cell (each step takes 4 frames plus the input frame). */
async function moveCursor(game: Game, dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', n = 1) {
  for (let i = 0; i < n; i++) {
    await game.press(dir);
    await game.eval((t) => t.waitFrames(8));
  }
}

test('the Town Map opens from the bag on the player\'s town and goes back to the bag', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await game.eval((t) => {
    t.state!.bag.add(t.define('ITEM_TOWN_MAP'), 1);
    t.state!.setFlag('FLAG_WORLD_MAP_VIRIDIAN_FOREST', true);
  });
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN');
  await game.press('A'); // BAG
  await game.eval((t) => t.waitFrames(60));
  await game.press('RIGHT'); // KEY ITEMS
  await game.eval((t) => t.waitFrames(20));
  await game.press('A'); // TOWN MAP
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // USE
  await waitRegionMapInput(game);
  const map = (await game.eval((t) => t.regionMap()))!;
  // REGIONMAP_TYPE_NORMAL, the cursor and player icon on Pallet Town's cell (sMapSectionTopLeftCorners: 4, 11)
  expect(map).toMatchObject({ type: 0, cursor: { x: 4, y: 11 }, player: { x: 4, y: 11 }, mapName: 'PALLET TOWN', selectedRegion: 0 });
  expect(map.flyIcons).toEqual([]); // the Town Map shows no fly icons

  // Up the map to Viridian Forest (4, 6): a visited dungeon, so A opens its preview.
  await moveCursor(game, 'UP', 5);
  const forest = (await game.eval((t) => t.regionMap()))!;
  expect(forest.cursor).toEqual({ x: 4, y: 6 });
  expect(forest.dungeonType).toBe(2); // MAPSECTYPE_VISITED
  expect(forest.topBarRight).toContain('GUIDE');
  await game.press('A');
  await game.waitFor((t) => t.regionMap()?.task === 'Task_DrawDungeonMapPreviewFlavorText', { what: 'the dungeon preview' });
  await game.eval((t) => t.waitFrames(90));
  await game.press('B');
  await game.waitFor((t) => t.regionMap()?.preview === false && t.regionMap()?.ready, { what: 'the preview closing' });

  // B closes the map (the close animation) and goes back to the bag.
  await game.press('B');
  await game.waitFor((t) => t.gbaScreen() === 'CB2_BagMenuRun', { what: 'back to the bag' });
  expect(await game.eval((t) => t.regionMap())).toBeUndefined();
  await game.eval((t) => t.waitFrames(30));
  await game.press('B');
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
});
