// The Itemfinder (itemfinder.c, world/itemfinder.ts) used from the bag: the arrows toward a hidden item and
// "The ITEMFINDER's responding!", the stars and "There's an item buried underfoot!" (then the item dug up), "Nope!
// There's no response." with nothing in range or once the item is picked up, and an item in a connected map.
// Route 3's hidden Oran Berry is at (26, 9) (no trainer sees (24, 9) or (25, 9)); Cape Brink's PP Max at (16, 28)
// is underfoot; Route 12's Rare Candy (9, 116) is in range of Route 13's (62, 1), 5 left and 5 up.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

async function giveItemfinder(game: Game) {
  await game.eval((t) => {
    t.state!.bag.add(t.define('ITEM_ITEMFINDER'), 1);
    t.state!.setVar('VAR_REPEL_STEP_COUNT', 200);
  });
}

/**
 * START → BAG → KEY ITEMS → the first item → USE. The start menu and the bag remember where they were: the
 * first time, BAG is one down from POKéMON (no POKéDEX yet) and KEY ITEMS one right of ITEMS; after that, neither.
 */
async function useItemfinder(game: Game, again = false) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  if (!again) await game.press('DOWN');
  await game.press('A');
  await game.eval((t) => t.waitFrames(60)); // the bag fades in
  if (!again) {
    await game.press('RIGHT');
    await game.eval((t) => t.waitFrames(20));
  }
  await game.press('A'); // the item's context menu
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // USE
}

/** Press A until event `type` (reported after `since`) comes, and return it. (mashUntil's check can't take arguments.) */
async function mashUntilEvent(game: Game, type: string, since: number, what: string) {
  await game.eval((_t, w) => ((globalThis as { __ifWait?: unknown }).__ifWait = w), { type, since });
  return game.mashUntil(
    (t) => {
      const w = (globalThis as { __ifWait?: { type: string; since: number } }).__ifWait!;
      return t.events(w.since).find((e) => e.type === w.type);
    },
    { what },
  );
}

interface Watched {
  sprites: { anim: number; affineAnim: number; xs: number[]; ys: number[] }[];
  maxOut: number;
  messages: string[];
}

/** In the page, until `itemfinderEnd`: each sprite's anims and screen positions, and the messages shown. */
function watch(game: Game, since: number): Promise<Watched> {
  return game.eval(async (t, since) => {
    const seen: Watched = { sprites: [], maxOut: 0, messages: [] };
    await t.until(() => {
      const f = t.field();
      const out = f?.itemfinder?.sprites ?? [];
      seen.maxOut = Math.max(seen.maxOut, out.length);
      // sprites are appended in creation order and removed from the front (they live the same time)
      const created = t.events(since).filter((e) => e.type === 'itemfinderArrow' || e.type === 'itemfinderStar').length;
      while (seen.sprites.length < created) seen.sprites.push({ anim: -1, affineAnim: -1, xs: [], ys: [] });
      const first = created - out.length;
      out.forEach((s, i) => {
        const w = seen.sprites[first + i];
        if (!w) return;
        w.anim = s.anim;
        w.affineAnim = s.affineAnim;
        if (w.xs.at(-1) !== s.x) w.xs.push(s.x);
        if (w.ys.at(-1) !== s.y) w.ys.push(s.y);
      });
      const m = t.message();
      if (m && seen.messages.at(-1) !== m) seen.messages.push(m);
      return t.events(since).some((e) => e.type === 'itemfinderEnd');
    }, 30000);
    return seen;
  }, since) as Promise<Watched>;
}

test('near a hidden item: arrows toward it and "responding"; once picked up, no response', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route3', x: 24, y: 9, party: [MEWTWO] });
  await giveItemfinder(game);
  await game.eval((t) => t.face('up'));
  let since = await game.mark();
  const watched = watch(game, since);
  await useItemfinder(game);
  const ev = await game.waitForEvent('itemfinder', { since });
  // two tiles right: 4 dings, GetPlayerDirectionTowardsHiddenItem's DIR_NORTH (2), the arrows move right
  expect(ev).toMatchObject({ result: 'response', itemX: 2, itemY: 0, dings: 4, direction: 2 });
  await game.waitForEvent('itemfinderArrow', { since });
  await mashUntilEvent(game, 'itemfinderEnd', since, 'the response message to close');
  const w = await watched;
  const arrows = (await game.events(since)).filter((e) => e.type === 'itemfinderArrow');
  expect(arrows.map((e) => e.anim)).toEqual([0, 1, 2, 3]);
  expect(arrows.every((e) => e.affineAnim === 2 && e.deltaX === 100 && e.deltaY === 0)).toBe(true);
  // each arrow runs from the centre (120, 76) right until it passes x = 132
  expect(w.sprites).toHaveLength(4);
  for (const s of w.sprites) {
    expect(s.xs[0]).toBe(120);
    expect(s.xs.at(-1)).toBe(133);
    expect(s.ys).toEqual([76]);
  }
  expect(w.maxOut).toBe(2); // a new arrow every 25 frames, each out for 41
  expect(w.messages.some((m) => m.includes('ITEMFINDER') && m.includes('responding'))).toBe(true);
  expect(w.messages.some((m) => m.includes('item buried around here'))).toBe(true);
  // The player doesn't turn (FRLG); the controls are back
  let f = await game.eval((t) => t.field()!);
  expect([f.facing, f.message, f.itemfinder]).toEqual(['up', undefined, undefined]);

  // Pick the Oran Berry up (one step right, face it), then nothing responds
  await game.eval((t) => t.walk('right', 1));
  await game.waitIdle();
  await game.eval((t) => t.face('right'));
  await game.press('A');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the hidden item script' });
  expect(await game.eval((t) => [t.itemCount('ORAN_BERRY'), t.flag('FLAG_HIDDEN_ITEM_ROUTE3_ORAN_BERRY')])).toEqual([1, true]);
  since = await game.mark();
  await useItemfinder(game, true);
  expect((await game.waitForEvent('itemfinder', { since })).result).toBe('none');
  await game.mashUntil((t) => t.message()?.includes('no response'), { what: '"Nope! There’s no response."' });
  await mashUntilEvent(game, 'itemfinderEnd', since, 'the message to close');
  f = await game.eval((t) => t.field()!);
  expect(f.message).toBeUndefined();
  expect((await game.events(since)).some((e) => e.type === 'itemfinderArrow')).toBe(false);
  // The controls are back
  await game.eval((t) => t.walk('left', 1));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.x)).toBe(24);
});

test('standing on an underfoot item: stars, "shaking wildly", and the item is dug up', async () => {
  const game = await session.start({ start: 'after-rival', map: 'TwoIsland_CapeBrink', x: 16, y: 28, party: [MEWTWO] });
  await giveItemfinder(game);
  let since = await game.mark();
  const watched = watch(game, since);
  await useItemfinder(game);
  expect(await game.waitForEvent('itemfinder', { since })).toMatchObject({ result: 'underfoot', itemX: 0, itemY: 0, dings: 3 });
  await mashUntilEvent(game, 'itemfinderEnd', since, 'the underfoot message');
  const w = await watched;
  expect((await game.events(since)).filter((e) => e.type === 'itemfinderStar')).toHaveLength(3);
  for (const s of w.sprites) {
    expect(s.anim).toBe(4);
    expect(s.xs).toEqual([120]);
    expect(s.ys[0]).toBe(75); // (-100 >> 8 = -1 in the first frame)
    expect(s.ys.at(-1)).toBe(60); // rises until y <= 60
  }
  expect(w.messages.some((m) => m.includes('shaking wildly'))).toBe(true);
  // EventScript_ItemfinderDigUpUnderfootItem
  const script = await game.waitForEvent('script', { since });
  expect(script.label).toBe('EventScript_ItemfinderDigUpUnderfootItem');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the dig-up script' });
  expect(await game.eval((t) => [t.itemCount('PP_MAX'), t.flag('FLAG_HIDDEN_ITEM_TWO_ISLAND_CAPE_BRINK_PP_MAX')])).toEqual([1, true]);
  // Dug up: nothing left to find here
  since = await game.mark();
  await useItemfinder(game, true);
  expect((await game.waitForEvent('itemfinder', { since })).result).toBe('none');
  await mashUntilEvent(game, 'itemfinderEnd', since, '"Nope!" to close');
});

test('nothing in range: no response', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 13, party: [MEWTWO] });
  await giveItemfinder(game);
  const since = await game.mark();
  await useItemfinder(game);
  expect((await game.waitForEvent('itemfinder', { since })).result).toBe('none');
  await game.mashUntil((t) => t.message()?.includes('Nope!'), { what: '"Nope!"' });
  await mashUntilEvent(game, 'itemfinderEnd', since, 'the message to close');
  expect(await game.eval((t) => t.field()!.message)).toBeUndefined();
});

test("an item in a connected map: Route 12's Rare Candy from Route 13", async () => {
  // a step below Route 13's border with Route 12
  const game = await session.start({ start: 'after-rival', map: 'Route13', x: 62, y: 1, party: [MEWTWO] });
  await giveItemfinder(game);
  await game.eval((t) => t.waitFrames(30)); // the connected maps load
  const since = await game.mark();
  await useItemfinder(game);
  // 5 left, 5 up: 2 dings, DIR_SOUTH (1), the arrows move up
  expect(await game.waitForEvent('itemfinder', { since })).toMatchObject({ result: 'response', itemX: -5, itemY: -5, dings: 2, direction: 1 });
  await mashUntilEvent(game, 'itemfinderEnd', since, 'the response message to close');
  const arrows = (await game.events(since)).filter((e) => e.type === 'itemfinderArrow');
  expect(arrows.map((e) => [e.anim, e.affineAnim, e.deltaX, e.deltaY])).toEqual([
    [0, 3, 0, -100],
    [1, 3, 0, -100],
  ]);
});
