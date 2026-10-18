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
  const watcher = game.eval(async (t) => {
    const seen: FerryFrame[] = [];
    await t.until(() => t.seagallop()?.running, 20000);
    (window as any).__ferrySince = t.lastSeq();
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
  // The map Task_Seagallop_3 warped to (not one loaded before the scene, e.g. leaving a Pokémon Center)
  const arrival = await game.waitForEvent('map', { since: await game.eval(() => (window as any).__ferrySince as number) });
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

/** The Seagallop object on the field from when it appears until the ferry scene starts: where it came and stopped. */
function watchSeagallopObject(game: Game) {
  return game.eval(async (t) => {
    type Obj = { graphicsId?: string; x: number; y: number };
    const boat = () => (t.objects() as Obj[]).find((o) => o.graphicsId === 'OBJ_EVENT_GFX_SEAGALLOP');
    await t.until(() => boat() !== undefined, 20000);
    const start = { ...boat()! };
    let end = start;
    await t.until(() => {
      const b = boat();
      if (b) end = { ...b };
      return t.seagallop() !== undefined;
    }, 20000);
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
  });
}

test("declining Bill: he waits in the Pokémon Center; from there the ferry leaves from the shore (FLAG_TEMP_2's path)", async () => {
  const game = await session.start({ start: 'after-rival', map: 'CinnabarIsland_Gym', x: 25, y: 21, party: [MEWTWO] });
  await afterBlaine(game);
  // Out of the Pokémon Center's door (14, 11): left of x 18, so ReadyObjectsSailToOneIsland sets FLAG_TEMP_2 and
  // Bill waits at (18, 12) facing up.
  await warp(game, 'MAP_CINNABAR_ISLAND', 14, 12);
  expect(await game.eval((t) => t.flag('FLAG_TEMP_2'))).toBe(true);
  // BillScene: he walks left to the player; NO → "I'll be waiting in the POKéMON CENTER", back in through the door
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_CINNABAR_ISLAND') === 2 && t.idle() && !t.field()!.script, { what: 'declining Bill', answers: [[/coming with me\?/, 'B']] });
  expect(await game.eval((t) => [t.flag('FLAG_HIDE_CINNABAR_POKECENTER_BILL'), t.field()!.x, t.field()!.y])).toEqual([false, 13, 12]);
  expect(await game.eval((t) => (t.objects() as { graphicsId?: string }[]).some((o) => o.graphicsId === 'OBJ_EVENT_GFX_BILL'))).toBe(false);

  // In the Pokémon Center: Bill at (11, 5). Talking from the east (facing west): ExitWithBillWest, then the warp
  // out to (14, 11) with VAR_MAP_SCENE_CINNABAR_ISLAND_2 = 1.
  await warp(game, 'MAP_CINNABAR_ISLAND_POKEMON_CENTER_1F', 12, 6);
  expect(await game.eval((t) => t.walkTo(12, 5))).toMatchObject({ arrived: true });
  await game.eval((t) => t.face('left'));
  const boat = watchSeagallopObject(game);
  const ride = await rideFerry(game, 'Bill in the Pokémon Center');
  // CinnabarIsland_EventScript_ExitPokeCenterForOneIsland: both walk to the shore, the boat sails in along row 12
  expect(await boat).toEqual({ start: { x: 30, y: 12 }, end: { x: 25, y: 12 } });
  checkRide(ride.frames, true);
  expect(ride.map).toBe('OneIsland_Harbor');
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_CINNABAR_ISLAND'), t.var('VAR_MAP_SCENE_CINNABAR_ISLAND_2'), t.flag('FLAG_HIDE_CINNABAR_POKECENTER_BILL')])).toEqual([2, 2, true]);
}, 240_000);

/** Vermilion after the S.S. Anne left, with the Tri-Pass (Celio's scene done) and Bill's trip over. */
async function triPassState(game: Game) {
  await game.eval((t) => {
    t.state!.setVar('VAR_MAP_SCENE_VERMILION_CITY', 3);
    t.state!.setVar('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F', 3);
    t.state!.setVar('VAR_MAP_SCENE_CINNABAR_ISLAND', 4);
    t.state!.setVar('VAR_MAP_SCENE_ONE_ISLAND_HARBOR', 3);
    t.state!.bag.add(t.define('ITEM_TRI_PASS'), 1);
    t.state!.setFlag('FLAG_SYS_SEVII_MAP_123', true);
  });
}

/**
 * From (23, 31) down onto Vermilion's ticket check at (23, 33). The step onto (23, 32) runs ExitedTicketCheck
 * (VAR_TEMP_1 is 0 after the load), which eats the next step while it locks the field.
 */
async function toTicketCheck(game: Game) {
  const since = await game.mark();
  await game.walk('down');
  await game.eval((t, s) => t.until(() => t.events(s).some((e) => e.type === 'script' && e.label === 'VermilionCity_EventScript_ExitedTicketCheck') && t.idle() && !t.field()!.script, 20000), since);
  expect(await game.walk('down')).toMatchObject({ x: 23, y: 33 });
}

/**
 * Until a multichoice menu opened since `since`: press A at each page break of the message before it (only while
 * the text waits for a button, so no press can reach the menu), then let it settle a few ticks. Returns its mcId.
 * `pressPages` false for a menu with no message before it (the message box of the last one still waits).
 */
async function waitForMenu(game: Game, since: number, pressPages = true) {
  if (pressPages) await game.eval(async (t, s) => {
    const box = (window as any).game.scene.getScene('Overworld').messageBox;
    for (let i = 0; i < 2000 && !t.events(s).some((e) => e.type === 'multichoice'); i++) {
      if (box.waitingForButton) await t.press('A');
      else await t.waitFrames(1);
    }
  }, since);
  const e = await game.waitForEvent('multichoice', { since });
  await game.eval((t) => t.waitFrames(4));
  return e.mcId as number;
}

test('Vermilion → Two Island with the Tri-Pass (SEAGALLOP HI-SPEED 7), and back from Two Island', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 23, y: 31, party: [MEWTWO] });
  await triPassState(game);
  await warp(game, 'MAP_VERMILION_CITY', 23, 31);
  // Down onto the ticket check (23, 33): CheckSeagallopPresentTrigger → "Ah, you have a TRI-PASS." and the 1-2-3 menu
  let since = await game.mark();
  await toTicketCheck(game);
  expect(await waitForMenu(game, since)).toBe(await game.eval((t) => t.define('MULTICHOICE_SEAGALLOP_123')));
  await game.press('DOWN'); // TWO ISLAND
  await game.press('A');
  await game.mashUntil((t) => t.message()?.includes('HI-SPEED 7'), { what: 'Seagallop7Departing' });
  const ride = await rideFerry(game, 'Vermilion → Two Island');
  checkRide(ride.frames, true); // sTravelDirectionMatrix[VERMILION] bit TWO_ISLAND
  expect(ride.map).toBe('TwoIsland_Harbor');
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y])).toEqual([8, 5]);

  // The Two Island sailor at (8, 6): "Where would you like to sail?" VERMILION / ONE / THREE (Bill's trip is over)
  since = await game.mark();
  await game.eval((t) => t.face('down'));
  await game.press('A');
  expect(await waitForMenu(game, since)).toBe(await game.eval((t) => t.define('MULTICHOICE_SEAGALLOP_V13')));
  await game.press('A'); // VERMILION
  // GetSeagallopNumber (TWO_ISLAND → VERMILION_CITY): 7
  await game.mashUntil((t) => t.message()?.includes('All aboard SEAGALLOP HI-SPEED 7!'), { what: 'Text_AllAboardSeagallopNum' });
  const back = await rideFerry(game, 'Two Island → Vermilion');
  checkRide(back.frames, false);
  expect(back.map).toBe('VermilionCity');
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y])).toEqual([23, 32]); // sSeag[SEAGALLOP_VERMILION_CITY]
}, 240_000);

test('cancelling the ferry left of the Vermilion sailor walks the player up the pier; to his face, it just ends', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 23, y: 31, party: [MEWTWO] });
  await triPassState(game);
  await warp(game, 'MAP_VERMILION_CITY', 23, 31);
  let since = await game.mark();
  await toTicketCheck(game);
  await waitForMenu(game, since);
  await game.press('B'); // EventScript_CancelSail: IsPlayerLeftOfVermilionSailor (x 23 < 24) → WalkUpPier
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the walk up the pier', button: 'B' });
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y, t.field()!.map])).toEqual([23, 32, 'VermilionCity']);

  // From above the sailor (24, 32), facing down: cancelling just releases the player where they stand.
  await game.eval((t) => t.state!.setVar('VAR_VERMILION_CITY_TICKET_CHECK_TRIGGER', 1)); // past the ticket check
  expect(await game.eval((t) => t.walkTo(24, 32))).toMatchObject({ arrived: true });
  await game.eval((t) => t.face('down'));
  since = await game.mark();
  await game.press('A');
  await waitForMenu(game, since);
  await game.press('B');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the cancel', button: 'B' });
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y])).toEqual([24, 32]);
}, 240_000);

test("the Rainbow Pass menu (DrawSeagallopDestinationMenu): page 1, OTHER → page 2, FIVE ISLAND", async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 23, y: 31, party: [MEWTWO] });
  await triPassState(game);
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F', 5)); // the Rainbow Pass
  await warp(game, 'MAP_VERMILION_CITY', 23, 31);
  let since = await game.mark();
  await toTicketCheck(game);
  // EventScript_SeviiDestinationsPage1: ONE, TWO, THREE, FOUR ISLAND, OTHER, EXIT (Vermilion is the origin)
  expect(await waitForMenu(game, since)).toBe(await game.eval((t) => t.define('MULTICHOICE_NONE')));
  expect(await game.eval((t) => [t.var('VAR_0x8004'), t.var('VAR_0x8005')])).toEqual([0, 0]);
  await game.screenshot('seagallop-menu-page1');
  since = await game.mark();
  await game.pressTimes('DOWN', 4); // OTHER
  await game.press('A');
  // GetSelectedSeagallopDestination → SEAGALLOP_MORE → page 2: FIVE, SIX, SEVEN ISLAND, OTHER, EXIT
  await waitForMenu(game, since, false);
  expect(await game.eval((t) => [t.var('VAR_0x8005'), t.var('VAR_0x8006')])).toEqual([1, 254]); // SEAGALLOP_MORE;
  await game.screenshot('seagallop-menu-page2');
  await game.press('A'); // FIVE ISLAND
  await game.mashUntil((t) => t.message()?.includes('HI-SPEED 7'), { what: 'Seagallop7Departing' });
  const ride = await rideFerry(game, 'Vermilion → Five Island');
  checkRide(ride.frames, true);
  expect(ride.map).toBe('FiveIsland_Harbor');
}, 240_000);
