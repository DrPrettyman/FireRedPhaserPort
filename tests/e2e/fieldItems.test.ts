// Field items from the bag (item_use.c): the rods (FieldUseFunc_Rod → StartFishing / Task_Fishing,
// world/fishing.ts) and the Escape Rope (ItemUseOutOfBattle_EscapeRope → Dig's escape warp). The bag is a
// GBA screen with no message probe: its steps are timed button presses. `field().fishing.step` is
// Task_Fishing's tStep (5 = Fishing6, the bite roll: Random() & 1, so the seed decides it).

import { expect, test } from 'vitest';
import { useGame, type Game, type StartOptions } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };
/** Pallet Town's pond: the bank at (8, 16), the water one step south (as in surf.test.ts). */
const PALLET_SHORE: StartOptions = { start: 'after-rival', map: 'PalletTown', x: 8, y: 16, party: [MEWTWO] };
/** Fishing6's roll is the first Random() of its tick: seed 0 gives an even one (a bite), seed 3 an odd one. */
const BITE_SEED = 0;
const NO_BITE_SEED = 3;
const FISHING6 = 5;

async function repel(game: Game) {
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
}

/** START → BAG → the ITEMS or KEY ITEMS pocket → its first item → the context menu's first entry (USE). */
async function useFirstItem(game: Game, pocket: 'items' | 'key') {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN'); // BAG (no POKéDEX yet)
  await game.press('A');
  // The bag's graphics load asynchronously, so a fixed wait can end before it's up on a loaded machine.
  await game.waitFor((t) => t.gbaScreen() === 'CB2_BagMenuRun', { what: 'the bag' });
  await game.eval((t) => t.waitFrames(30)); // the bag's fade in
  if (pocket === 'key') {
    await game.press('RIGHT');
    await game.eval((t) => t.waitFrames(20));
  }
  await game.press('A'); // the item's context menu
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // USE
}

/** Seed the RNG inside the tick Fishing6 rolls for a bite (registered in the page before the cast). */
async function seedBiteRoll(game: Game, seed: number) {
  await game.eval(
    (t, seed, step) => {
      void t.seedWhen(() => t.field()?.fishing?.step === step, seed);
    },
    seed,
    FISHING6,
  );
}

test('the Old Rod facing water: a bite, "A POKéMON\'s on the hook!" and a wild Magikarp', async () => {
  const game = await session.start(PALLET_SHORE);
  await repel(game);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_OLD_ROD'), 1));
  await game.eval((t) => t.face('down'));
  await seedBiteRoll(game, BITE_SEED);
  const since = await game.mark();
  await useFirstItem(game, 'key');
  expect((await game.waitForEvent('fishing', { since })).rod).toBe(0); // OLD_ROD
  // The cast: the fishing graphics (QL_GfxTransition_Fish) and the take-out-rod anim, the player held still
  const cast = await game.waitFor((t) => t.field()?.fishing?.animNum !== undefined && t.field()!, { what: 'the cast' });
  expect(cast.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_FISH');
  expect(cast.fishing!.animNum).toBe(await game.eval((t) => t.define('ANIM_TAKE_OUT_ROD_SOUTH')));
  await game.waitForEvent('fishingBite', { since });
  expect((await game.waitForEvent('fishingResult', { since })).result).toBe('onHook');
  await game.waitFor((t) => t.message()?.includes('on the hook'), { what: '"A POKéMON\'s on the hook!"' });
  // FRLG: no A-press window; the message's {PAUSE_UNTIL_PRESS}, then the battle
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleStart'), { what: 'the wild battle' });
  const start = await game.waitForEvent('battleStart', { since });
  expect(start.trainer).toBe(0);
  const wild = await game.waitFor((t) => t.battle()?.mons.length === 2 && t.battle()!.mons[1].species !== 'NONE' && t.battle()!.mons[1], { what: 'the wild mon' });
  // Pallet Town's old rod slots (0 and 1): Magikarp, levels 5-10
  expect(wild.species).toBe('MAGIKARP');
  expect(wild.level).toBeGreaterThanOrEqual(5);
  expect(wild.level).toBeLessThanOrEqual(10);
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  await game.mashUntil((t) => t.idle(), { what: 'the field to fade back in' });
  const f = await game.eval((t) => t.field()!);
  expect(f).toMatchObject({ map: 'PalletTown', x: 8, y: 16, facing: 'down' });
  expect(f.fishing).toBeUndefined();
  expect(f.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_NORMAL');
  expect(f.avatar.flags).toContain('ON_FOOT');
});

test('no bite: "Not even a nibble…", the rod put away and the player free again', async () => {
  const game = await session.start(PALLET_SHORE);
  await repel(game);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_GOOD_ROD'), 1));
  await game.eval((t) => t.face('down'));
  await seedBiteRoll(game, NO_BITE_SEED);
  // Fishing12's put-away anim lasts 22 frames: watch for it in the page
  const putAway = game.eval(async (t) => {
    let seen = false;
    await t.until(() => (seen ||= t.field()?.fishing?.animNum === t.define('ANIM_PUT_AWAY_ROD_SOUTH')), 20000);
    return seen;
  });
  const since = await game.mark();
  await useFirstItem(game, 'key');
  expect((await game.waitForEvent('fishing', { since })).rod).toBe(1); // GOOD_ROD
  expect((await game.waitForEvent('fishingResult', { since })).result).toBe('noBite');
  expect(await putAway).toBe(true);
  await game.waitFor((t) => t.message()?.includes('nibble'), { what: '"Not even a nibble…"' });
  // Fishing16 waits for the message's {PAUSE_UNTIL_PRESS}
  await game.mashUntil((t) => t.events().some((e) => e.type === 'fishingEnd'), { what: 'the message to close' });
  expect(await game.eval((t) => t.events().some((e) => e.type === 'battleStart'))).toBe(false);
  const f = await game.eval((t) => t.field()!);
  expect(f).toMatchObject({ x: 8, y: 16, facing: 'down' });
  expect(f.message).toBeUndefined();
  expect(f.fishing).toBeUndefined();
  expect(f.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_NORMAL');
  // The controls are back: a step west
  await game.eval((t) => t.walk('left', 1));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.x)).toBe(7);
});

test('a rod not facing water: Oak says it isn\'t the time, and the bag stays open', async () => {
  const game = await session.start(PALLET_SHORE);
  await repel(game);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_OLD_ROD'), 1));
  await game.eval((t) => t.face('up'));
  const since = await game.mark();
  await useFirstItem(game, 'key');
  await game.eval((t) => t.waitFrames(60));
  expect(await game.eval((t) => t.gbaScreen())).toBe('CB2_BagMenuRun');
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'back on the field' });
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'fishing')).toBe(false);
  expect(await game.eval((t) => t.field()!.avatar.graphicsId)).toBe('OBJ_EVENT_GFX_RED_NORMAL');
});

test('an Escape Rope in a cave takes the player back to the escape warp', async () => {
  // Route 4's Mt. Moon entrance (19, 5): walking in from (19, 6) sets the escape warp to (19, 6).
  const game = await session.start({ start: 'after-rival', map: 'Route4', x: 19, y: 6, party: [MEWTWO] });
  await repel(game);
  await game.eval((t) => t.walk('up', 1));
  await game.waitFor((t) => t.field()?.map === 'MtMoon_1F' && t.idle(), { what: 'Mt. Moon' });
  expect(await game.eval((t) => t.state!.escapeWarp)).toEqual({ mapId: 'MAP_ROUTE4', warpId: -1, x: 19, y: 6 });
  await repel(game);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_ESCAPE_ROPE'), 2));
  const since = await game.mark();
  await useFirstItem(game, 'items');
  // ItemUseOnFieldCB_EscapeRope: "RED used the ESCAPE ROPE." on the field, then Task_UseDigEscapeRopeOnField
  await game.waitFor((t) => t.message()?.includes('ESCAPE ROPE'), { what: '"… used the ESCAPE ROPE."' });
  expect(await game.eval((t) => t.itemCount('ESCAPE_ROPE'))).toBe(1);
  await game.mashUntil((t) => t.events().some((e) => e.type === 'fieldMoveWarp'), { what: 'the warp out' });
  expect((await game.waitForEvent('fieldMoveWarp', { since })).map).toBe('MAP_ROUTE4');
  await game.waitForEvent('fieldMoveWarpDone', { since });
  await game.waitFor((t) => t.gbaScreen() === undefined && t.idle() && !t.field()!.script, { what: 'the warp in' });
  const f = await game.eval((t) => t.field()!);
  expect(f).toMatchObject({ map: 'Route4', x: 19, y: 6, playerVisible: true });
  expect(f.message).toBeUndefined();
  // No banner: the rope isn't a field move
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'fieldMoveShowMon')).toBe(false);
});

test('an Escape Rope outdoors: Oak says it isn\'t the time, and the rope is kept', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 9, y: 13, party: [MEWTWO] });
  await repel(game);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_ESCAPE_ROPE'), 1));
  const since = await game.mark();
  await useFirstItem(game, 'items');
  await game.eval((t) => t.waitFrames(60));
  expect(await game.eval((t) => t.gbaScreen())).toBe('CB2_BagMenuRun');
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'back on the field' });
  expect(await game.eval((t) => t.itemCount('ESCAPE_ROPE'))).toBe(1);
  expect(await game.eval((t) => t.field()!.map)).toBe('Route1');
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'fieldMoveWarp')).toBe(false);
});
