// The event islands (POSTGAME_PLAN.md W-events unit 1): the Hall of Fame gives the Mystic and Aurora Tickets
// (EnterHallOfFame's REVISION 0xA block, a deliberate QOL change), Vermilion's sailor shows them and sails to Navel
// Rock and Birth Island; Navel Rock's base (ShakeScreen twice, then Lugia), its summit (SpawnCameraObject,
// LoopWingFlapSound, Ho-Oh), Birth Island's triangle (DoDeoxysTriangleInteraction, FLDEFF_MOVE_DEOXYS_ROCK, the step
// caps, FLDEFF_DESTROY_DEOXYS_ROCK, Deoxys). The flags the postgame leaves are set inline.

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';
import { checkRide, harborState, sail, talkToHarborSailor, toTicketCheck, waitForMenu, warp } from './seagallopHelpers';

const session = useGame();

const MEWTWO: MonSpec = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

const where = (game: Game) => game.eval((t) => [t.field()!.map, t.field()!.x, t.field()!.y]);

/** Pick row `row` of the menu that is up: DOWN `row` times, then A. */
async function pick(game: Game, row: number) {
  await game.pressTimes('DOWN', row);
  await game.press('A');
}

/** The legendary's battle: its species and level once the battle is up. */
async function foe(game: Game, what: string) {
  return game.waitFor((t) => {
    const m = t.battle()?.mons?.[1];
    return m && m.species !== 'NONE' && [m.species, m.level];
  }, { what, timeout: 60_000 });
}

/** The audio events of type `type` named `name` since `since`, by frame. */
async function seFrames(game: Game, since: number, name: string): Promise<number[]> {
  return game.eval((t, s, n) => t.audioEvents(s).filter((e) => e.type === 'se' && e.name === n).map((e) => e.frame), since, name);
}

test('the Hall of Fame gives the Mystic and Aurora Tickets (REVISION 0xA), once', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PokemonLeague_HallOfFame', x: 5, y: 12, party: [MEWTWO], speed: 16 });
  const before = await game.eval((t) => [t.itemCount('MYSTIC_TICKET'), t.itemCount('AURORA_TICKET'), t.flag('FLAG_ENABLE_SHIP_NAVEL_ROCK')]);
  expect(before).toEqual([0, 0, false]);
  // Oak's speech, then `special EnterHallOfFame`: the tickets come before the screen saves the game.
  const since = await game.mark();
  await game.mashUntil((t) => t.events().some((e) => e.type === 'hallOfFameSaved'), { what: 'the Hall of Fame save', maxFrames: 40000 });
  await game.waitForEvent('hallOfFameSaved', { since });
  const after = await game.eval((t) => ({
    items: [t.itemCount('MYSTIC_TICKET'), t.itemCount('AURORA_TICKET')],
    flags: ['FLAG_ENABLE_SHIP_NAVEL_ROCK', 'FLAG_RECEIVED_MYSTIC_TICKET', 'FLAG_ENABLE_SHIP_BIRTH_ISLAND', 'FLAG_RECEIVED_AURORA_TICKET'].map((f) => t.flag(f)),
  }));
  expect(after).toEqual({ items: [1, 1], flags: [true, true, true, true] });
  // ...and the save the Hall of Fame wrote has them (the bag and flags of SAVE_HALL_OF_FAME)
  const saved = await game.eval(() => localStorage.getItem('firered-phaser:save') ?? '');
  expect(saved.length).toBeGreaterThan(0);

  // The next entry: the bag already has the Aurora Ticket, so CheckBagHasItem keeps them from coming twice.
  const again = await game.eval(async (t) => {
    const { GiveEventTickets } = await new Function("return import('/src/menus/hallOfFame.ts')")();
    GiveEventTickets(t.state);
    return [t.itemCount('MYSTIC_TICKET'), t.itemCount('AURORA_TICKET')];
  });
  expect(again).toEqual([1, 1]);
}, 240_000);

test("Vermilion's sailor shows the tickets and sails to Navel Rock and Birth Island", async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 23, y: 31, party: [MEWTWO] });
  await harborState(game, 4, 5); // the Rainbow Pass (VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F 5)
  // What the Hall of Fame gives (GiveEventTickets)
  await game.eval((t) => {
    t.state!.bag.add(t.define('ITEM_MYSTIC_TICKET'), 1);
    t.state!.bag.add(t.define('ITEM_AURORA_TICKET'), 1);
    for (const f of ['FLAG_ENABLE_SHIP_NAVEL_ROCK', 'FLAG_RECEIVED_MYSTIC_TICKET', 'FLAG_ENABLE_SHIP_BIRTH_ISLAND', 'FLAG_RECEIVED_AURORA_TICKET']) t.state!.setFlag(f, true);
  });
  await warp(game, 'MAP_VERMILION_CITY', 23, 31);
  // VermilionCity_EventScript_HasMysticAndAuroraTickets: "Oh! That's a MYSTIC TICKET!" and the AURORA TICKET's, then
  // MULTICHOICE_SEVII_NAVEL_BIRTH (SEVII ISLANDS, NAVEL ROCK, BIRTH ISLAND, EXIT)
  let since = await game.mark();
  await toTicketCheck(game);
  // (the tickets' msgboxes wait for a button at their end: mash through them to the ferry question)
  await game.mashUntil((t) => /AURORATICKET/.test(t.message() ?? ''), { what: "the Aurora Ticket's text" });
  await game.mashUntil((t) => /board/.test(t.message() ?? ''), { what: 'Would you like to board a SEAGALLOP ferry?' });
  expect(await waitForMenu(game, since)).toBe(await game.eval((t) => t.define('MULTICHOICE_SEVII_NAVEL_BIRTH')));
  expect(await game.eval((t) => [t.flag('FLAG_SHOWN_MYSTIC_TICKET'), t.flag('FLAG_SHOWN_AURORA_TICKET')])).toEqual([true, true]);
  await pick(game, 1); // NAVEL ROCK: EventScript_SailToNavelRock
  let ride = await sail(game, 'Vermilion → Navel Rock', 10);
  checkRide(ride.frames, true);
  expect(await where(game)).toEqual(['NavelRock_Harbor', 8, 5]);

  // Back to Vermilion with the harbor's sailor (VERMILION), then the tickets' menu again, without their texts
  await talkToHarborSailor(game);
  await pick(game, 0);
  ride = await sail(game, 'Navel Rock → Vermilion', 7);
  expect(await where(game)).toEqual(['VermilionCity', 23, 32]);
  await game.walk('up');
  since = await game.mark();
  await toTicketCheck(game);
  expect(await waitForMenu(game, since)).toBe(await game.eval((t) => t.define('MULTICHOICE_SEVII_NAVEL_BIRTH')));
  await pick(game, 2); // BIRTH ISLAND: EventScript_SailToBirthIsland
  ride = await sail(game, 'Vermilion → Birth Island', 12);
  checkRide(ride.frames, true);
  expect(await where(game)).toEqual(['BirthIsland_Harbor', 8, 5]);
}, 300_000);

test("Navel Rock's base: the screen shakes twice (ShakeScreen), then Lugia's battle", async () => {
  const game = await session.start({ start: 'after-rival', map: 'NavelRock_Base', x: 10, y: 17, party: [MEWTWO] });
  // Every tick from the talk to the battle: SetCameraPanning's horizontal and vertical offsets
  const pans = game.watch((t) => {
    const w = ((window as any).__pans ??= []) as [number, number][];
    const f = t.field();
    if (f) w.push([f.avatar.cameraPanX, f.avatar.cameraPanY]);
    return t.events().some((e) => e.type === 'battleStart') && w;
  }, { what: "Lugia's battle start", maxFrames: 20000 });
  const since = await game.mark();
  await game.walk('up'); // (10, 16), below Lugia
  await game.eval((t) => t.face('up'));
  await game.press('A');
  const samples = await pans;
  // VAR_0x8004 0, 0x8005 3, 0x8006 4, 0x8007 2: the view moves 3 px left / right every 2 frames, 4 times; the 4th
  // flip goes straight back to the standard pan. Twice, 30 frames apart (+ the SE).
  const runs: number[][] = [];
  let run: number[] | undefined;
  for (const [x, y] of samples) {
    expect(y).toBe(0);
    if (x !== 0) (run ??= []).push(x);
    else if (run) runs.push(run), (run = undefined);
  }
  expect(runs).toEqual([
    [-3, -3, 3, 3, -3, -3],
    [-3, -3, 3, 3, -3, -3],
  ]);
  expect(await game.eval((t) => t.field()?.avatar.cameraPanX ?? 0)).toBe(0);
  // PlaySE(SE_M_STRENGTH) with each shake
  expect((await seFrames(game, since, 'SE_M_STRENGTH')).length).toBe(2);
  expect(await foe(game, "Lugia's battle")).toEqual(['LUGIA', 70]);
}, 180_000);

test("Navel Rock's summit: Ho-Oh flies down (LoopWingFlapSound) to the battle", async () => {
  const game = await session.start({ start: 'after-rival', map: 'NavelRock_Summit', x: 9, y: 13, party: [MEWTWO] });
  const since = await game.mark();
  await game.walk('up'); // onto the coord event at (9, 12): NavelRock_Summit_EventScript_HoOh
  expect(await foe(game, "Ho-Oh's battle")).toEqual(['HO_OH', 70]);
  // LoopWingFlapSound twice (VAR_0x8004 3, VAR_0x8005 35): three flaps each time. The special's PlaySE, then
  // Task_WingFlapSound's in the same frame counts 1, so the next comes 34 frames later, the last 35 after that.
  const flaps = await seFrames(game, since, 'SE_M_WING_ATTACK');
  expect(flaps.length).toBe(6);
  for (const i of [0, 3]) expect([flaps[i + 1] - flaps[i], flaps[i + 2] - flaps[i + 1]]).toEqual([34, 35]);
}, 180_000);

// Birth Island's triangle: sDeoxysCoords' corners and where to stand to touch each, within sDeoxysStepCaps' steps.
const TRIANGLE: { rock: [number, number]; stand: [number, number]; face: 'up' | 'down' | 'left' | 'right'; cap: number }[] = [
  { rock: [11, 14], stand: [12, 14], face: 'left', cap: 4 },
  { rock: [15, 8], stand: [15, 9], face: 'up', cap: 8 },
  { rock: [19, 14], stand: [19, 13], face: 'down', cap: 8 },
  { rock: [12, 11], stand: [13, 11], face: 'left', cap: 8 },
  { rock: [18, 11], stand: [17, 11], face: 'right', cap: 4 },
  { rock: [15, 14], stand: [15, 13], face: 'down', cap: 4 },
  { rock: [11, 14], stand: [12, 14], face: 'left', cap: 4 },
  { rock: [19, 14], stand: [18, 14], face: 'right', cap: 6 },
  { rock: [15, 15], stand: [15, 14], face: 'down', cap: 3 },
  { rock: [15, 10], stand: [15, 11], face: 'up', cap: 3 },
];

/** The triangle's map-local tile. */
const rockAt = (game: Game) =>
  game.eval((t) => {
    const ow = (window as any).game.scene.getScene('Overworld');
    const rock = ow.objectByLocalId(ow.resolveLocalId('LOCALID_BIRTH_ISLAND_EXTERIOR_ROCK'));
    const f = t.field()!;
    return rock ? [rock.tileX - (f.worldX - f.x), rock.tileY - (f.worldY - f.y)] : null;
  });

/** Walk to (x, y), face `dir`, touch the triangle; resolves once its move is over and the script has ended. */
async function touch(game: Game, x: number, y: number, dir: 'up' | 'down' | 'left' | 'right') {
  await game.eval(async (t, x, y, dir) => {
    await t.walkTo(x, y);
    await t.face(dir);
  }, x, y, dir);
  const steps = await game.eval((t) => t.var('VAR_DEOXYS_INTERACTION_STEP_COUNTER'));
  const since = await game.mark();
  await game.press('A');
  const moved = await game.waitForEvent('deoxysRockMoved', { since, what: 'the triangle moving' });
  await game.waitFor((t) => t.idle() && !t.field()!.script, { what: 'the script over' });
  return { steps, moved, since };
}

test("Birth Island: the triangle's ten corners within the step caps, the rock breaks, Deoxys", async () => {
  const game = await session.start({ start: 'after-rival', map: 'BirthIsland_Exterior', x: 15, y: 13, party: [MEWTWO], speed: 16 });
  expect(await rockAt(game)).toEqual([15, 12]);
  // First touch: on to sDeoxysCoords[1] (SE_DEOXYS_MOVE, 5 frames); then too many steps: back to the start
  // (SE_M_CONFUSE_RAY, 60 frames), VAR_RESULT 0, the count starts over.
  await game.eval((t) => t.face('up'));
  let since = await game.mark();
  await game.press('A');
  await game.waitForEvent('deoxysRockMoved', { since });
  await game.waitFor((t) => t.idle() && !t.field()!.script, { what: 'the script over' });
  expect(await rockAt(game)).toEqual([11, 14]);
  expect(await seFrames(game, since, 'SE_DEOXYS_MOVE')).toHaveLength(1);
  await game.eval((t) => t.walkTo(11, 16));
  const fail = await touch(game, 11, 15, 'up');
  expect(fail.steps).toBeGreaterThan(4);
  expect(await game.eval((t) => [t.var('VAR_RESULT'), t.var('VAR_DEOXYS_INTERACTION_NUM')])).toEqual([0, 0]);
  expect(await rockAt(game)).toEqual([15, 12]);
  expect(await seFrames(game, fail.since, 'SE_M_CONFUSE_RAY')).toHaveLength(1);

  // From the start again: every corner within its cap
  await touch(game, 15, 13, 'up');
  expect(await rockAt(game)).toEqual([11, 14]);
  for (const [i, c] of TRIANGLE.entries()) {
    if (i === TRIANGLE.length - 1) break;
    const r = await touch(game, c.stand[0], c.stand[1], c.face);
    expect(r.steps, `steps to corner ${i + 1}`).toBeLessThanOrEqual(c.cap);
    expect(await game.eval((t) => [t.var('VAR_RESULT'), t.var('VAR_DEOXYS_INTERACTION_NUM')])).toEqual([1, i + 2]);
    expect(await rockAt(game)).toEqual(TRIANGLE[i + 1].rock);
    const pal = await game.eval((t, s) => t.events(s).filter((e) => e.type === 'deoxysRockPalette').map((e) => e.num), r.since);
    expect(pal).toEqual([i + 2]);
  }

  // The 11th touch: FLAG_SYS_DEOXYS_AWAKENED, Deoxys appears, FLDEFF_DESTROY_DEOXYS_ROCK: the camera shakes ±4
  // (Task_DeoxysRockCameraShake), 121 frames on the rock vanishes, four fragments fly off, the shake dies down.
  const last = TRIANGLE[TRIANGLE.length - 1];
  await game.eval(async (t, x, y, dir) => {
    await t.walkTo(x, y);
    await t.face(dir);
  }, last.stand[0], last.stand[1], last.face);
  expect(await game.eval((t) => t.var('VAR_DEOXYS_INTERACTION_STEP_COUNTER'))).toBeLessThanOrEqual(last.cap);
  const shake = game.watch((t) => {
    const w = ((window as any).__deoxysPans ??= []) as number[];
    const f = t.field();
    if (f) w.push(f.avatar.cameraPanY);
    return t.events().some((e) => e.type === 'deoxysRockDestroyed') && w;
  }, { what: 'the rock destroyed' });
  since = await game.mark();
  await game.press('A');
  const pans = await shake;
  expect(await game.eval((t) => t.flag('FLAG_SYS_DEOXYS_AWAKENED'))).toBe(true);
  // Up to the rock's end: 0, -4, 0, +4, ... (Task_DestroyDeoxysRock resets the pan every frame, the shake sets it
  // every other one), then 1 px less every 21 frames
  const nonZero = pans.filter((p) => p !== 0);
  expect(nonZero.slice(0, 4)).toEqual([-4, 4, -4, 4]);
  expect(Math.max(...nonZero.map(Math.abs))).toBe(4);
  expect(nonZero.some((p) => Math.abs(p) === 1)).toBe(true);
  // The fragments in their first frame: 16 px left / right, 12 up / down of the rock's screen position (y - 4)
  const first = (await game.waitForEvent('deoxysRockFragments', { since })).fragments as { x: number; y: number }[];
  expect(first).toHaveLength(4);
  expect(first[1].x - first[0].x).toBe(32);
  expect(first[2].y - first[0].y).toBe(24);
  const s = await game.eval((t, s) => t.audioEvents(s).filter((e) => e.type === 'se').map((e) => e.name), since);
  expect(s).toEqual(expect.arrayContaining(['SE_THUNDER2', 'SE_THUNDER']));
  expect(s.indexOf('SE_THUNDER2')).toBeLessThan(s.indexOf('SE_THUNDER'));
  // The rock is gone (RemoveObjectEventByLocalIdAndMap sets its flag); Deoxys walks down and the battle starts.
  expect(await game.eval((t) => t.flag('FLAG_HIDE_BIRTH_ISLAND_METEORITE'))).toBe(true);
  expect(await rockAt(game)).toBeNull();
  expect(await foe(game, "Deoxys's battle")).toEqual(['DEOXYS', 30]);
}, 300_000);
