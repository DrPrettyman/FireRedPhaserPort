// The Seagallop ferry (W-ferry unit 1): seagallop.c's scene and warp, script_menu.c's destination menus, and Bill's
// One Island trip after Blaine (CinnabarIsland_EventScript_BillScene → the ferry → One Island's Pokémon Center and
// Celio → back to Cinnabar). Lostelle's rescue, which opens the way back, is stood in for by
// VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F = 2 (SIDE_PLAN.md decision 7).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC', 'SURF', 'STRENGTH'] };

/** Every badge up to Blaine's. */
const BADGES = Array.from({ length: 7 }, (_, i) => `FLAG_BADGE0${i + 1}_GET`);

/** A scripted warp (ScrCmd_warp) to map-local (x, y), waiting for the new map to settle. */
async function warp(game: Game, mapId: string, x: number, y: number) {
  const mark = await game.mark();
  await game.eval((_t, id, x, y) => (window as any).game.scene.getScene('Overworld').warp(id, -1, x, y), mapId, x, y);
  await game.waitForEvent('map', { since: mark, what: mapId });
}

/** The story state after Blaine (CinnabarIsland_Gym_EventScript_DefeatedBlaine). */
async function afterBlaine(game: Game) {
  await game.eval((t, badges) => {
    for (const f of badges) t.state!.setFlag(f, true);
    t.state!.setFlag('FLAG_DEFEATED_BLAINE', true);
    t.state!.setFlag('FLAG_GOT_TM38_FROM_BLAINE', true);
    t.state!.setVar('VAR_MAP_SCENE_CINNABAR_ISLAND', 1);
    t.state!.setFlag('FLAG_HIDE_CINNABAR_BILL', false);
    t.state!.setVar('VAR_REPEL_STEP_COUNT', 1000);
  }, BADGES);
}

/** One frame of the ferry scene as the in-page watcher saw it. */
interface FerryFrame {
  frames: number;
  bg3X: number;
  x2?: number;
  ferryX?: number;
  hFlip?: boolean;
  wakes: number;
  eastbound: boolean;
}

/**
 * Mash A until the ferry scene is up, watching it in the page from its first frame until the field is back: the
 * scene's frames (BG3's x, the ferry's x and x2, wakes). Returns them and the map the ferry arrived at.
 */
async function rideFerry(game: Game, what: string, button: 'A' | 'B' = 'A') {
  const since = await game.mark();
  const watcher = game.eval(async (t) => {
    const seen: FerryFrame[] = [];
    await t.until(() => t.seagallop()?.running, 20000);
    await t.until(() => {
      const s = t.seagallop();
      if (!s) return true;
      seen.push({ frames: s.frames, bg3X: s.bg3X, x2: s.ferry?.x2, ferryX: s.ferry?.x, hFlip: s.ferry?.hFlip, wakes: s.wakes, eastbound: s.eastbound });
      return false;
    }, 20000);
    return seen;
  });
  await game.mashUntil((t) => t.seagallop() !== undefined, { what: `${what}: the ferry scene`, button });
  const frames = (await watcher) as FerryFrame[];
  const arrival = await game.waitForEvent('map', { since });
  await game.eval((t) => t.until(() => t.field()?.map !== undefined && !t.field()?.fading, 20000));
  return { frames, map: arrival.map as string };
}

/** What every ride shows: BG3 scrolls 6 px a frame for 140 frames, the ferry crosses at 3 px a frame with wakes. */
function checkRide(frames: FerryFrame[], eastbound: boolean) {
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every((f) => f.eastbound === eastbound)).toBe(true);
  const last = frames[frames.length - 1];
  expect(last.frames).toBe(140); // Task_Seagallop_1's 140 frames, then the fade (Task_Seagallop_2)
  // ScrollBG: ChangeBgX(3, 0x600, add or subtract) once a frame
  for (let i = 1; i < frames.length; i++) {
    const step = (frames[i].bg3X - frames[i - 1].bg3X) | 0;
    if (frames[i].frames !== frames[i - 1].frames || frames[i].frames === 140) expect([eastbound ? 0x600 : -0x600, 0]).toContain(step);
  }
  expect(frames.some((f) => f.bg3X !== frames[0].bg3X)).toBe(true);
  // The ferry: from x 0 (eastbound, flipped) or 240, x2 3 px a frame, gone 300 px out (frame 100)
  const withFerry = frames.filter((f) => f.x2 !== undefined);
  expect(withFerry.length).toBeGreaterThan(0);
  for (const f of withFerry) {
    expect(f.ferryX).toBe(eastbound ? 0 : 240);
    expect(f.hFlip).toBe(eastbound);
    expect(Math.abs(f.x2!)).toBeLessThanOrEqual(300);
  }
  expect(frames.some((f) => f.frames > 100 && f.x2 === undefined)).toBe(true);
  expect(frames.some((f) => f.wakes > 0)).toBe(true);
}

test("Bill's trip: YES on Cinnabar, the Seagallop arrives, the ferry to One Island, Celio; the way back and Bill's goodbye", async () => {
  const game = await session.start({ start: 'after-rival', map: 'CinnabarIsland_Gym', x: 25, y: 21, party: [MEWTWO] });
  await afterBlaine(game);
  // Out of the gym's door (20, 4) onto (20, 5): OnTransition leaves Bill at (20, 7) and moves the Seagallop to (30, 8)
  await warp(game, 'MAP_CINNABAR_ISLAND', 20, 5);
  // CinnabarIsland_EventScript_BillScene: Bill walks up, "Come with me to ONE ISLAND?" YES; the Seagallop sails in
  // from (30, 8) and both board it.
  await game.mashUntil((t) => t.message()?.includes('ONE ISLAND'), { what: "Bill's question" });
  const seagallop = game.eval(async (t) => {
    await t.until(() => (t.objects() as { localId?: number; graphicsId?: string }[]).some((o) => o.graphicsId === 'OBJ_EVENT_GFX_SEAGALLOP'), 20000);
    const boat = () => (t.objects() as { graphicsId?: string; x: number; y: number }[]).find((o) => o.graphicsId === 'OBJ_EVENT_GFX_SEAGALLOP');
    const start = boat();
    await t.until(() => !boat() || boat()!.x !== start!.x, 20000);
    let end = boat();
    await t.until(() => {
      const b = boat();
      if (b) end = b;
      return t.seagallop() !== undefined;
    }, 20000);
    return { start, end };
  });
  const ride = await rideFerry(game, 'Bill');
  const boat = await seagallop;
  expect(boat.start).toMatchObject({ x: 30, y: 8 });
  expect(boat.end).toMatchObject({ x: 25, y: 8 }); // CinnabarIsland_Movement_BoatArrive: 5 steps left
  checkRide(ride.frames, true); // Cinnabar → One Island is eastbound (sTravelDirectionMatrix)
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_CINNABAR_ISLAND'), t.flag('FLAG_HIDE_CINNABAR_SEAGALLOP')])).toEqual([2, true]);
  expect(ride.map).toBe('OneIsland_Harbor');

  // The harbor walks the player out to One Island, Bill takes them to the Pokémon Center: MeetCelioScene.
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F') === 1 && t.idle() && !t.field()!.script, { what: 'Celio' });
  expect(await game.eval((t) => t.field()!.map)).toBe('OneIsland_PokemonCenter_1F');
  expect(await game.eval((t) => [t.itemCount('TRI_PASS'), t.itemCount('METEORITE'), t.flag('FLAG_SYS_SEVII_MAP_123'), t.var('VAR_MAP_SCENE_ONE_ISLAND_HARBOR')])).toEqual([1, 1, true, 3]);

  // Lostelle's rescue (unit 2 plays it) sets the var; back in, Bill and Celio wait at the machine.
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F', 2));
  await warp(game, 'MAP_ONE_ISLAND_POKEMON_CENTER_1F', 9, 8);
  await game.walk('right', 3); // onto (12, 8): LeaveOneIslandTriggerMidBottom
  const back = await rideFerry(game, 'the leave scene');
  checkRide(back.frames, false); // One Island → Cinnabar is westbound
  expect(back.map).toBe('CinnabarIsland');
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y])).toEqual([21, 7]); // sSeag[SEAGALLOP_CINNABAR_ISLAND]
  // CinnabarIsland_EventScript_ReturnFromSeviiIslands: Bill's goodbye, he walks off
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_CINNABAR_ISLAND') === 4 && t.idle() && !t.field()!.script, { what: "Bill's goodbye" });
  expect(await game.eval((t) => [t.flag('FLAG_HIDE_TWO_ISLAND_GAME_CORNER_LOSTELLE'), t.flag('FLAG_HIDE_LOSTELLE_IN_HER_HOME'), t.var('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F')])).toEqual([true, false, 3]);
}, 240_000);
