// The Seagallop ferry (W-ferry): seagallop.c's scene and warp, script_menu.c's destination menus, Bill's One Island
// trip after Blaine (CinnabarIsland_EventScript_BillScene → the ferry → One Island's Pokémon Center and Celio), and
// every harbor's sailor: Vermilion's, the islands' with the Tri-Pass and the Rainbow Pass, Navel Rock's and Birth
// Island's. The Sevii 1-3 quest and the way back to Cinnabar are played in seviiQuest.test.ts.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';
import { afterBlaine, checkRide, harborState, MEWTWO, rideFerry, sail, talkToHarborSailor, toTicketCheck, triPassState, waitForMenu, warp, watchSeagallopObject } from './seagallopHelpers';

const session = useGame();

test("Bill's trip: YES on Cinnabar, the Seagallop arrives, the ferry to One Island, Celio", async () => {
  const game = await session.start({ start: 'after-rival', map: 'CinnabarIsland_Gym', x: 25, y: 21, party: [MEWTWO] });
  await afterBlaine(game);
  // Out of the gym's door (20, 4) onto (20, 5): OnTransition leaves Bill at (20, 7) and moves the Seagallop to (30, 8)
  await warp(game, 'MAP_CINNABAR_ISLAND', 20, 5);
  // CinnabarIsland_EventScript_BillScene: Bill walks up, "Come with me to ONE ISLAND?" YES; the Seagallop sails in
  // from (30, 8) and both board it.
  await game.mashUntil((t) => t.message()?.includes('ONE ISLAND'), { what: "Bill's question" });
  const seagallop = watchSeagallopObject(game);
  const ride = await rideFerry(game, 'Bill');
  // CinnabarIsland_Movement_BoatArrive: 5 steps left
  expect(await seagallop).toEqual({ start: { x: 30, y: 8 }, end: { x: 25, y: 8 } });
  checkRide(ride.frames, true); // Cinnabar → One Island is eastbound (sTravelDirectionMatrix)
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_CINNABAR_ISLAND'), t.flag('FLAG_HIDE_CINNABAR_SEAGALLOP')])).toEqual([2, true]);
  expect(ride.map).toBe('OneIsland_Harbor');

  // The harbor walks the player out to One Island, Bill takes them to the Pokémon Center: MeetCelioScene.
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F') === 1 && t.idle() && !t.field()!.script, { what: 'Celio' });
  expect(await game.eval((t) => t.field()!.map)).toBe('OneIsland_PokemonCenter_1F');
  expect(await game.eval((t) => [t.itemCount('TRI_PASS'), t.itemCount('METEORITE'), t.flag('FLAG_SYS_SEVII_MAP_123'), t.var('VAR_MAP_SCENE_ONE_ISLAND_HARBOR')])).toEqual([1, 1, true, 3]);

  // The way back (Lostelle's rescue, the leave scene, the ferry to Cinnabar, Bill's goodbye): seviiQuest.test.ts
}, 240_000);

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
  // (the Gentleman wanders around (9, 7) and can be in the way: try again)
  let to: { arrived: boolean } | undefined;
  for (let i = 0; i < 10 && !to?.arrived; i++) to = await game.eval((t) => t.walkTo(12, 5));
  expect(to).toMatchObject({ arrived: true });
  await game.eval((t) => t.face('left'));
  const boat = watchSeagallopObject(game);
  const ride = await rideFerry(game, 'Bill in the Pokémon Center');
  // CinnabarIsland_EventScript_ExitPokeCenterForOneIsland: both walk to the shore, the boat sails in along row 12
  expect(await boat).toEqual({ start: { x: 30, y: 12 }, end: { x: 25, y: 12 } });
  checkRide(ride.frames, true);
  expect(ride.map).toBe('OneIsland_Harbor');
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_CINNABAR_ISLAND'), t.var('VAR_MAP_SCENE_CINNABAR_ISLAND_2'), t.flag('FLAG_HIDE_CINNABAR_POKECENTER_BILL')])).toEqual([2, 2, true]);
}, 240_000);

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

/** Where the player stands, as [map, x, y]. */
function where(game: Game) {
  return game.eval((t) => [t.field()!.map, t.field()!.x, t.field()!.y]);
}

/** Cancel a sailor's menu (B, or A on EXIT) away from Vermilion's pier: EventScript_CancelSail just releases. */
async function cancelAtHarbor(game: Game) {
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'EventScript_CancelSail', button: 'B' });
}

/** Pick row `row` of the menu that is up: DOWN `row` times, then A. */
async function pick(game: Game, row: number) {
  await game.pressTimes('DOWN', row);
  await game.press('A');
}

test("the island sailors with the Tri-Pass: each island's menu before and after Bill's trip ends, EXIT and B", async () => {
  const game = await session.start({ start: 'after-rival', map: 'ThreeIsland_Harbor', x: 8, y: 5, party: [MEWTWO] });
  await harborState(game, 2, 2); // Lostelle rescued, Bill's way back not taken yet
  const harbors = [
    ['MAP_ONE_ISLAND_HARBOR', 'OneIsland_Harbor', 'MULTICHOICE_ISLAND_23', 'MULTICHOICE_SEAGALLOP_V23'],
    ['MAP_TWO_ISLAND_HARBOR', 'TwoIsland_Harbor', 'MULTICHOICE_ISLAND_13', 'MULTICHOICE_SEAGALLOP_V13'],
    ['MAP_THREE_ISLAND_HARBOR', 'ThreeIsland_Harbor', 'MULTICHOICE_ISLAND_12', 'MULTICHOICE_SEAGALLOP_V12'],
  ];
  for (const cinnabar of [2, 4]) {
    await game.eval((t, c) => t.state!.setVar('VAR_MAP_SCENE_CINNABAR_ISLAND', c), cinnabar);
    for (const [map, local, before, after] of harbors) {
      await warp(game, map, 8, 5);
      // EventScript_ChooseDestFromOneIsland / _TwoIsland / _Island: VERMILION only once VAR_MAP_SCENE_CINNABAR_ISLAND is 4
      expect(await talkToHarborSailor(game), map).toBe(await game.eval((t, n) => t.define(n), cinnabar < 4 ? before : after));
      if (cinnabar < 4) await pick(game, 2); // EXIT (the third row)
      else await game.press('B'); // SCR_MENU_CANCEL
      await cancelAtHarbor(game);
      expect(await where(game)).toEqual([local, 8, 5]);
    }
  }

  // Three Island → One Island before Bill's way back (ISLAND_12: ONE, TWO, EXIT): HI-SPEED 2, westbound
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_CINNABAR_ISLAND', 2));
  await warp(game, 'MAP_THREE_ISLAND_HARBOR', 8, 5);
  await talkToHarborSailor(game);
  await pick(game, 0);
  const ride = await sail(game, 'Three → One Island', 2);
  checkRide(ride.frames, false);
  expect(await where(game)).toEqual(['OneIsland_Harbor', 8, 5]);

  // After it (V23: VERMILION, TWO, THREE, EXIT): One → Three Island, eastbound
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_CINNABAR_ISLAND', 4));
  await talkToHarborSailor(game);
  await pick(game, 2);
  const ride2 = await sail(game, 'One → Three Island', 2);
  checkRide(ride2.frames, true);
  expect(await where(game)).toEqual(['ThreeIsland_Harbor', 8, 5]);
}, 240_000);

/**
 * The Rainbow Pass menu (EventScript_SeviiDestinationsPage1 / 2) from Vermilion and from each island in turn, every
 * harbor's arrival (sSeag: (8, 5) on the islands, (23, 32) at Vermilion), the direction of each trip
 * (sTravelDirectionMatrix) and its number (GetSeagallopNumber).
 */
test('the Rainbow Pass: Vermilion and every island harbor in turn, both pages, OTHER both ways, EXIT and B', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 23, y: 31, party: [MEWTWO] });
  await harborState(game, 4, 5);
  await warp(game, 'MAP_VERMILION_CITY', 23, 31);
  // Vermilion's page 1: ONE, TWO, THREE, FOUR ISLAND, OTHER, EXIT. EXIT left of the sailor walks the player up.
  let since = await game.mark();
  await toTicketCheck(game);
  expect(await waitForMenu(game, since)).toBe(255); // MULTICHOICE_NONE
  await pick(game, 5);
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the walk up the pier', button: 'B' });
  expect(await where(game)).toEqual(['VermilionCity', 23, 32]);
  await game.walk('up');
  since = await game.mark();
  await toTicketCheck(game);
  await waitForMenu(game, since);
  await pick(game, 2); // THREE ISLAND
  expect(await game.eval((t) => t.field()!.facing)).toBe('right'); // (CheckTicket turned the player to the sailor)
  let ride = await sail(game, 'Vermilion → Three Island', 7);
  checkRide(ride.frames, true);
  expect(await where(game)).toEqual(['ThreeIsland_Harbor', 8, 5]);
  // Nothing stored an initial direction (StoreInitialPlayerAvatarState sets hasDirectionSet FALSE) and (8, 5) is a
  // plain tile: GetAdjustedInitialDirection's DIR_SOUTH
  expect(await game.eval((t) => t.field()!.facing)).toBe('down');

  // Three Island's page 1: VERMILION, ONE, TWO, FOUR ISLAND, OTHER, EXIT
  expect(await talkToHarborSailor(game)).toBe(255);
  await pick(game, 3);
  ride = await sail(game, 'Three → Four Island', 6);
  checkRide(ride.frames, true);
  expect(await where(game)).toEqual(['FourIsland_Harbor', 8, 5]);

  // Four Island: OTHER → page 2: FIVE, SIX, SEVEN ISLAND, OTHER, EXIT
  await talkToHarborSailor(game);
  since = await game.mark();
  await pick(game, 4);
  await waitForMenu(game, since, false);
  await pick(game, 1);
  ride = await sail(game, 'Four → Six Island', 6);
  checkRide(ride.frames, true);
  expect(await where(game)).toEqual(['SixIsland_Harbor', 8, 5]);

  // Six Island's page 2: FOUR, FIVE, SEVEN ISLAND
  await talkToHarborSailor(game);
  since = await game.mark();
  await pick(game, 4);
  await waitForMenu(game, since, false);
  await pick(game, 2);
  ride = await sail(game, 'Six → Seven Island', 5);
  checkRide(ride.frames, false);
  expect(await where(game)).toEqual(['SevenIsland_Harbor', 8, 5]);

  // Seven Island: OTHER, OTHER back to page 1, EXIT; then B on page 2; then FIVE ISLAND
  await talkToHarborSailor(game);
  since = await game.mark();
  await pick(game, 4);
  await waitForMenu(game, since, false);
  since = await game.mark();
  await pick(game, 3); // OTHER on page 2 → page 1
  await waitForMenu(game, since, false);
  expect(await game.eval((t) => t.var('VAR_0x8005'))).toBe(0);
  await pick(game, 5); // EXIT
  await cancelAtHarbor(game);
  expect(await where(game)).toEqual(['SevenIsland_Harbor', 8, 5]);
  await talkToHarborSailor(game);
  since = await game.mark();
  await pick(game, 4);
  await waitForMenu(game, since, false);
  await game.press('B');
  await cancelAtHarbor(game);
  expect(await where(game)).toEqual(['SevenIsland_Harbor', 8, 5]);
  await talkToHarborSailor(game);
  since = await game.mark();
  await pick(game, 4);
  await waitForMenu(game, since, false);
  await pick(game, 1); // FOUR, FIVE, SIX: FIVE
  ride = await sail(game, 'Seven → Five Island', 6);
  checkRide(ride.frames, false);
  expect(await where(game)).toEqual(['FiveIsland_Harbor', 8, 5]);

  // Five Island's page 1: VERMILION, ONE, TWO, THREE ISLAND
  await talkToHarborSailor(game);
  await pick(game, 1);
  ride = await sail(game, 'Five → One Island', 6);
  checkRide(ride.frames, false);
  expect(await where(game)).toEqual(['OneIsland_Harbor', 8, 5]);

  // One Island's page 1: VERMILION, TWO, THREE, FOUR ISLAND
  await talkToHarborSailor(game);
  await pick(game, 1);
  ride = await sail(game, 'One → Two Island', 2);
  checkRide(ride.frames, true);
  expect(await where(game)).toEqual(['TwoIsland_Harbor', 8, 5]);

  // Two Island's page 1: VERMILION first
  await talkToHarborSailor(game);
  await pick(game, 0);
  ride = await sail(game, 'Two Island → Vermilion', 7);
  checkRide(ride.frames, false);
  expect(await where(game)).toEqual(['VermilionCity', 23, 32]);
}, 300_000);

/**
 * Navel Rock and Birth Island. The trip there starts at the ticket menus' targets (the tickets and their menu are
 * played in eventIslands.test.ts), EventScript_SailToNavelRock / _SailToBirthIsland (the sailor's text, VAR_0x8004 VERMILION, VAR_0x8006 the
 * island, EventScript_SetSail), run at Vermilion's sailor. Back, the harbor's sailor has MULTICHOICE_SEAGALLOP_VERMILION.
 */
test('Navel Rock and Birth Island harbors: there from Vermilion (the tickets\' sail-off), back with B, EXIT, VERMILION', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 23, y: 31, party: [MEWTWO] });
  await harborState(game, 4, 5);
  for (const [label, local, number] of [['EventScript_SailToNavelRock', 'NavelRock_Harbor', 10], ['EventScript_SailToBirthIsland', 'BirthIsland_Harbor', 12]] as const) {
    await warp(game, 'MAP_VERMILION_CITY', 24, 32);
    await game.eval((_t, l) => (window as any).game.scene.getScene('Overworld').startFieldScript(l), label);
    const there = await sail(game, `Vermilion → ${local}`, number);
    checkRide(there.frames, true);
    expect(await where(game)).toEqual([local, 8, 5]); // sSeag[SEAGALLOP_NAVEL_ROCK / _BIRTH_ISLAND]

    expect(await talkToHarborSailor(game)).toBe(await game.eval((t) => t.define('MULTICHOICE_SEAGALLOP_VERMILION')));
    await game.press('B');
    await cancelAtHarbor(game);
    expect(await where(game)).toEqual([local, 8, 5]);
    await talkToHarborSailor(game);
    await pick(game, 1); // EXIT
    await cancelAtHarbor(game);
    expect(await where(game)).toEqual([local, 8, 5]);
    await talkToHarborSailor(game);
    await pick(game, 0); // VERMILION: EventScript_SailToVermilionCity
    // GetSeagallopNumber checks Vermilion before Navel Rock / Birth Island: 7 on the way back
    const back = await sail(game, `${local} → Vermilion`, 7);
    checkRide(back.frames, false);
    expect(await where(game)).toEqual(['VermilionCity', 23, 32]);
  }
}, 240_000);
