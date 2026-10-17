// Story checks from Erika to Sabrina (SCREENS_PLAN.md, W-story unit 3): per gym and per story event the decomp
// requires, set up the state the story would have (flags, badges, a strong party), play the event and check what
// the player gets. Celadon Gym (Erika, the Cut tree), the Game Corner's poster switch, Rocket Hideout's barriers
// (call_if_defeated / call_if_not_defeated), Giovanni and the Silph Scope, ...

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC', 'CUT'] };

/** The metatile id at a map-local cell, and whether its collision bits are set. */
function cell(game: Game, x: number, y: number) {
  return game.eval((t, x, y) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const f = t.field()!;
    const tile = s.world.tileAt(f.worldX - f.x + x, f.worldY - f.y + y);
    return { metatile: tile.metatile, impassable: tile.collision !== 0 };
  }, x, y);
}

/** A scripted warp (ScrCmd_warp) to map-local (x, y), waiting for the new map to settle. */
async function warp(game: Game, mapId: string, x: number, y: number) {
  const mark = await game.mark();
  await game.eval((_t, id, x, y) => (window as any).game.scene.getScene('Overworld').warp(id, -1, x, y), mapId, x, y);
  await game.waitForEvent('map', { since: mark, what: mapId });
  await game.waitIdle();
}

/** Mark trainers beaten (TRAINER_* without the prefix), so none of them walks up mid-test. */
async function beatTrainers(game: Game, trainers: string[]) {
  await game.eval((t, names) => {
    for (const n of names) t.state!.setFlag(t.define('TRAINER_FLAGS_START') + t.define(`TRAINER_${n}`), true);
  }, trainers);
}

async function setFlags(game: Game, flags: string[]) {
  await game.eval((t, names) => {
    for (const f of names) t.state!.setFlag(f, true);
  }, flags);
}

/** Walk to (x, y), face `dir` and press A. */
async function talkFrom(game: Game, x: number, y: number, dir: 'up' | 'down' | 'left' | 'right') {
  await game.eval((t, x, y) => t.walkTo(x, y), x, y);
  expect(await game.eval((t) => t.field())).toMatchObject({ x, y });
  await game.eval((t, d) => t.face(d), dir);
  await game.press('A');
}

/** Press A until the script has ended and the field is free. */
async function scriptDone(game: Game, what: string) {
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what });
}

/** Press A through a trainer battle (the first move each turn) and the script after it. */
async function winBattle(game: Game, what: string) {
  const since = await game.mark();
  await game.eval((_t, s) => ((window as any).__storySince = s), since);
  await game.mashUntil((t) => t.events((window as any).__storySince).some((e) => e.type === 'battleEnd'), { what: `${what}: the battle` });
  const end = await game.waitForEvent('battleEnd', { since });
  expect(await game.eval((t, o) => t.nameOf('B_OUTCOME_', o), end.outcome as number)).toBe('B_OUTCOME_WON');
  await scriptDone(game, `${what}: the script after the battle`);
}

const trainerDefeated = (game: Game, name: string) => game.eval((t, n) => t.trainerDefeated(n), name);

// ---------------------------------------------------------------- Erika

const CELADON_GYM_TRAINERS = ['LASS_KAY', 'LASS_LISA', 'PICNICKER_TINA', 'BEAUTY_BRIDGET', 'BEAUTY_TAMIA', 'BEAUTY_LORI', 'COOLTRAINER_MARY'];

test('Celadon Gym: cut the tree, beat Erika, get the Rainbow Badge and TM19', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_Gym', x: 6, y: 9, party: [MEWTWO] });
  await setFlags(game, ['FLAG_BADGE01_GET', 'FLAG_BADGE02_GET', 'FLAG_BADGE03_GET']);
  await beatTrainers(game, CELADON_GYM_TRAINERS);
  // EventScript_CutTree at (6, 8): YES, "MEWTWO used CUT!"
  expect((await game.eval((t) => t.objects().find((o) => o.x === 6 && o.y === 8)))?.graphicsId).toBe('OBJ_EVENT_GFX_CUT_TREE');
  await talkFrom(game, 6, 9, 'up');
  await game.mashUntil((t) => t.flag('FLAG_TEMP_12') && t.idle() && !t.field()!.script, { what: 'the tree to be cut' });
  expect(await game.eval((t) => t.objects().find((o) => o.x === 6 && o.y === 8))).toBeUndefined();

  await talkFrom(game, 6, 5, 'up'); // Erika at (6, 4)
  await winBattle(game, 'Erika');
  expect(await trainerDefeated(game, 'LEADER_ERIKA')).toBe(true);
  expect(await game.eval((t) => [t.flag('FLAG_BADGE04_GET'), t.flag('FLAG_DEFEATED_ERIKA'), t.flag('FLAG_GOT_TM19_FROM_ERIKA')])).toEqual([true, true, true]);
  expect(await game.eval((t) => t.itemCount('TM19'))).toBe(1);
});

// ---------------------------------------------------------------- Rocket Game Corner and Hideout

test('Game Corner: beat the grunt, push the poster switch, take the stairs to Rocket Hideout B1F', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_GameCorner', x: 11, y: 3, party: [MEWTWO] });
  const d = await game.eval((t) => ({
    shade: t.define('METATILE_GameCorner_Floor_ShadeFull'),
    stairsTop: t.define('METATILE_GameCorner_StairsTop'),
  }));
  // CeladonCity_GameCorner_OnLoad → EventScript_HideRocketHideout
  expect((await cell(game, 16, 2)).metatile).toBe(d.shade);

  await talkFrom(game, 11, 3, 'up'); // the grunt at (11, 2) in front of the poster
  await winBattle(game, 'the Game Corner grunt');
  expect(await trainerDefeated(game, 'TEAM_ROCKET_GRUNT_7')).toBe(true);
  // CeladonCity_GameCorner_Text_DefeatedGrunt: he walks off and is removed.
  expect(await game.eval((t) => t.objects().some((o) => o.graphicsId === 'OBJ_EVENT_GFX_ROCKET_M'))).toBe(false);

  await talkFrom(game, 11, 2, 'up'); // the poster (11, 1)
  await game.mashUntil((t) => t.flag('FLAG_OPENED_ROCKET_HIDEOUT') && t.idle() && !t.field()!.script, { what: 'the poster switch' });
  expect((await cell(game, 16, 2)).metatile).toBe(d.stairsTop);

  // (15, 2) is MB_DOWN_RIGHT_STAIR_WARP: push right on it (TryArrowWarp → DoStairWarp).
  await game.eval((t) => t.walkTo(15, 2));
  expect(await game.eval((t) => t.enterWarp())).toBe('RocketHideout_B1F');
});

const BARRIER = (t: { define(n: string): number }) => ({
  topLeft: t.define('METATILE_SilphCo_HideoutBarrier_TopLeft_Floor'),
  bottomLeft: t.define('METATILE_SilphCo_HideoutBarrier_BottomLeft'),
  shade: t.define('METATILE_SilphCo_HideoutFloor_ShadeFull'),
  floor: t.define('METATILE_SilphCo_HideoutFloor'),
});

test('Rocket Hideout B1F: the barrier stands until grunt 12 is beaten (call_if_not_defeated)', async () => {
  const game = await session.start({ start: 'after-rival', map: 'RocketHideout_B1F', x: 12, y: 3, party: [MEWTWO] });
  const d = await game.eval(BARRIER);
  // RocketHideout_B1F_OnLoad → RocketHideout_B1F_EventScript_SetBarrier
  expect(await cell(game, 20, 19)).toEqual({ metatile: d.topLeft, impassable: true });
  expect(await cell(game, 20, 20)).toEqual({ metatile: d.bottomLeft, impassable: true });
  await beatTrainers(game, ['TEAM_ROCKET_GRUNT_12']);
  await warp(game, 'MAP_ROCKET_HIDEOUT_B1F', 12, 3);
  // (the layout's own floor: the barrier is only ever set by the script)
  const top = await cell(game, 20, 19);
  const bottom = await cell(game, 20, 20);
  expect(top.metatile).not.toBe(d.topLeft);
  expect(bottom.metatile).not.toBe(d.bottomLeft);
  expect([top.impassable, bottom.impassable]).toEqual([false, false]);
});

test('Rocket Hideout: with the Lift Key, the elevator goes from B1F to B4F', async () => {
  const game = await session.start({ start: 'after-rival', map: 'RocketHideout_B1F', x: 24, y: 26, party: [MEWTWO] });
  await setFlags(game, ['FLAG_CAN_USE_ROCKET_HIDEOUT_LIFT']); // RocketHideout_B4F_EventScript_LiftKey
  let mark = await game.mark();
  await game.walk('up'); // the elevator door (MB_WARP_DOOR) at (24, 25)
  await game.waitForEvent('map', { since: mark, what: 'the elevator' });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.map)).toBe('RocketHideout_Elevator');
  await game.eval((t) => t.walkTo(0, 3)); // the panel is the bg event at (0, 2)
  await game.eval((t) => t.face('up'));
  mark = await game.mark();
  await game.eval((_t, s) => ((window as any).__storySince = s), mark);
  // RocketHideout_Elevator_EventScript_FloorSelect: multichoicedefault MULTICHOICE_ROCKET_HIDEOUT_ELEVATOR
  await game.mashUntil((t) => t.events((window as any).__storySince).some((e) => e.type === 'multichoice'), { what: 'the floor menu' });
  await game.eval((t) => t.waitFrames(10));
  await game.pressTimes('DOWN', 2); // B1F → B4F
  await game.press('A');
  await game.waitIdle({ timeout: 60_000 });
  expect(await game.eval((t) => t.var('VAR_ELEVATOR_FLOOR'))).toBe(0);
  await game.eval((t) => t.walkTo(2, 5));
  expect(await game.eval((t) => t.enterWarp())).toBe('RocketHideout_B4F');
  // setdynamicwarp MAP_ROCKET_HIDEOUT_B4F, 255, 20, 23: the door at (20, 23), then the player steps out of it.
  expect(await game.eval((t) => t.field())).toMatchObject({ x: 20, y: 24 });
});

const B4F_GRUNTS = ['TEAM_ROCKET_GRUNT_16', 'TEAM_ROCKET_GRUNT_17'];

test('Rocket Hideout B4F: beating both door grunts opens the barrier; Giovanni leaves the Silph Scope', async () => {
  const game = await session.start({ start: 'after-rival', map: 'RocketHideout_B4F', x: 16, y: 15, party: [MEWTWO] });
  const d = await game.eval(BARRIER);
  // RocketHideout_B4F_OnLoad: neither grunt beaten → SetBarrier
  expect(await cell(game, 17, 12)).toEqual({ metatile: d.topLeft, impassable: true });
  expect(await cell(game, 17, 13)).toEqual({ metatile: d.bottomLeft, impassable: true });

  await talkFrom(game, 16, 15, 'up'); // Grunt2 (TEAM_ROCKET_GRUNT_16) at (16, 14)
  await winBattle(game, 'grunt 16');
  expect(await game.eval((t) => t.var('VAR_TEMP_1'))).toBe(1);
  expect((await cell(game, 17, 13)).impassable).toBe(true);

  await talkFrom(game, 19, 15, 'up'); // Grunt3 (TEAM_ROCKET_GRUNT_17) at (19, 14)
  await winBattle(game, 'grunt 17');
  expect(await game.eval((t) => t.var('VAR_TEMP_1'))).toBe(2);
  // RocketHideout_B4F_EventScript_RemoveBarrier
  expect(await cell(game, 17, 12)).toEqual({ metatile: d.shade, impassable: false });
  expect(await cell(game, 18, 13)).toEqual({ metatile: d.floor, impassable: false });

  await talkFrom(game, 19, 5, 'up'); // Giovanni at (19, 4)
  await winBattle(game, 'Giovanni');
  expect(await trainerDefeated(game, 'BOSS_GIOVANNI')).toBe(true);
  expect(await game.eval((t) => [t.flag('FLAG_HIDE_HIDEOUT_GIOVANNI'), t.flag('FLAG_HIDE_SILPH_SCOPE'), t.flag('FLAG_HIDE_CELADON_ROCKETS')])).toEqual([true, false, true]);
  expect(await game.eval((t) => t.objects().some((o) => o.graphicsId === 'OBJ_EVENT_GFX_GIOVANNI'))).toBe(false);

  await talkFrom(game, 19, 5, 'right'); // the Silph Scope ball at (20, 5)
  await game.mashUntil((t) => t.itemCount('SILPH_SCOPE') === 1 && t.idle() && !t.field()!.script, { what: 'the Silph Scope' });
  expect(await game.eval((t) => t.flag('FLAG_HIDE_SILPH_SCOPE'))).toBe(true);

  // Back on the floor later (OnLoad with both grunts beaten): no barrier.
  await warp(game, 'MAP_ROCKET_HIDEOUT_B4F', 16, 15);
  expect(await trainerDefeated(game, B4F_GRUNTS[0])).toBe(true);
  expect(await cell(game, 17, 12)).toEqual({ metatile: d.shade, impassable: false });
});

// ---------------------------------------------------------------- Pokémon Tower and the Poké Flute
// (The ghost Marowak on 6F: pokemonTower.test.ts. Snorlax with the flute: scriptedBattles.test.ts.)

test('Pokémon Tower 7F: Mr. Fuji takes the player home and gives the Poké Flute', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PokemonTower_7F', x: 11, y: 5, party: [MEWTWO] });
  await beatTrainers(game, ['TEAM_ROCKET_GRUNT_19', 'TEAM_ROCKET_GRUNT_20', 'TEAM_ROCKET_GRUNT_21']);
  await talkFrom(game, 11, 5, 'up'); // Mr. Fuji at (11, 4)
  // PokemonTower_7F_EventScript_MrFuji: "Thank you, follow me", warp to the Volunteer Pokémon House (4, 7)
  await game.mashUntil((t) => t.field()!.map === 'LavenderTown_VolunteerPokemonHouse' && t.idle() && !t.field()!.script, { what: 'the warp to the Volunteer House' });
  expect(await game.eval((t) => t.field())).toMatchObject({ x: 4, y: 7 });
  expect(await game.eval((t) => [t.flag('FLAG_RESCUED_MR_FUJI'), t.flag('FLAG_HIDE_TOWER_FUJI'), t.flag('FLAG_HIDE_POKEHOUSE_FUJI')])).toEqual([true, true, false]);

  await talkFrom(game, 3, 4, 'up'); // Mr. Fuji at (3, 3)
  await game.mashUntil((t) => t.flag('FLAG_GOT_POKE_FLUTE') && t.idle() && !t.field()!.script, { what: 'the Poké Flute' });
  expect(await game.eval((t) => t.itemCount('POKE_FLUTE'))).toBe(1);
});

// ---------------------------------------------------------------- Saffron's gate guards

test('Saffron gates: the guard turns the player back until he gets the Tea from Celadon Mansion', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_Condominiums_1F', x: 3, y: 10, party: [MEWTWO] });
  await talkFrom(game, 3, 9, 'left'); // the old woman at (2, 9)
  await game.mashUntil((t) => t.flag('FLAG_GOT_TEA') && t.idle() && !t.field()!.script, { what: 'the Tea' });
  expect(await game.eval((t) => t.itemCount('TEA'))).toBe(1);

  // Without the Tea: Route5_SouthEntrance_EventScript_GuardTrigger pushes the player back up.
  await game.eval((t) => t.state!.bag.remove(t.define('ITEM_TEA'), 1));
  await game.eval((t) => t.state!.setFlag('FLAG_GOT_TEA', false));
  await warp(game, 'MAP_ROUTE5_SOUTH_ENTRANCE', 4, 3);
  await game.walk('down');
  await game.walk('down');
  await game.mashUntil((t) => t.idle() && !t.field()!.script && t.field()!.y === 4, { what: '"I\'m on guard duty... thirsty"' });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_ROUTE5_ROUTE6_ROUTE7_ROUTE8_GATES'))).toBe(0);

  // With it: the guard drinks it and shares it with the other gates.
  await game.eval((t) => {
    t.state!.setFlag('FLAG_GOT_TEA', true);
    t.state!.bag.add(t.define('ITEM_TEA'), 1);
  });
  await game.walk('down');
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_ROUTE5_ROUTE6_ROUTE7_ROUTE8_GATES') === 1 && t.idle() && !t.field()!.script, { what: 'the guard to drink the Tea' });
  expect(await game.eval((t) => t.itemCount('TEA'))).toBe(0);
  await game.eval((t) => t.walkTo(4, 9));
  expect(await game.eval((t) => t.enterWarp())).toBe('SaffronCity');
});

// ---------------------------------------------------------------- Silph Co.
// (The card key doors: mainPathLeftovers.test.ts.)

test('Silph Co. 7F: the rival\'s trigger battle', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SilphCo_7F', x: 3, y: 5, party: [MEWTWO] });
  await beatTrainers(game, ['SCIENTIST_JOSHUA', 'TEAM_ROCKET_GRUNT_33', 'TEAM_ROCKET_GRUNT_34', 'TEAM_ROCKET_GRUNT_35']);
  expect(await game.eval((t) => t.objects().some((o) => o.graphicsId === 'OBJ_EVENT_GFX_BLUE'))).toBe(true);
  await game.walk('left'); // onto SilphCo_7F_EventScript_RivalTriggerBottom at (2, 5)
  await winBattle(game, 'the rival');
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_SILPH_CO_7F'))).toBe(1);
  expect(await game.eval((t) => t.objects().some((o) => o.graphicsId === 'OBJ_EVENT_GFX_BLUE'))).toBe(false);
});

test('Silph Co. 11F: Giovanni\'s trigger battle, then the president\'s Master Ball', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SilphCo_11F', x: 6, y: 16, party: [MEWTWO] });
  await beatTrainers(game, ['TEAM_ROCKET_GRUNT_40', 'TEAM_ROCKET_GRUNT_41']);
  await game.walk('up'); // SilphCo_11F_EventScript_GiovanniTriggerRight at (6, 15)
  await winBattle(game, 'Giovanni');
  expect(await trainerDefeated(game, 'BOSS_GIOVANNI_2')).toBe(true);
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_SILPH_CO_11F'), t.flag('FLAG_HIDE_SAFFRON_ROCKETS'), t.flag('FLAG_HIDE_SAFFRON_CIVILIANS')])).toEqual([1, true, false]);
  expect(await game.eval((t) => t.objects().some((o) => o.graphicsId === 'OBJ_EVENT_GFX_GIOVANNI'))).toBe(false);

  await talkFrom(game, 9, 10, 'up'); // the president at (9, 9)
  await game.mashUntil((t) => t.flag('FLAG_GOT_MASTER_BALL_FROM_SILPH') && t.idle() && !t.field()!.script, { what: 'the Master Ball' });
  expect(await game.eval((t) => t.itemCount('MASTER_BALL'))).toBe(1);
});

// ---------------------------------------------------------------- Sabrina

const SAFFRON_GYM_TRAINERS = ['PSYCHIC_JOHAN', 'PSYCHIC_TYRON', 'PSYCHIC_CAMERON', 'PSYCHIC_PRESTON', 'CHANNELER_AMANDA', 'CHANNELER_STACY', 'CHANNELER_TASHA'];

test('Saffron Gym: the teleport pads lead to Sabrina; beat her for the Marsh Badge and TM04', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SaffronCity_Gym', x: 14, y: 22, party: [MEWTWO] });
  await beatTrainers(game, SAFFRON_GYM_TRAINERS);
  // The pads (warp events onto the same map; the rooms are a 3 x 3 grid): the entrance's (18, 20) → the
  // bottom right room (28, 23); its (20, 20) → the top right room (28, 4); its (20, 7) → the top left room (0, 4);
  // its (0, 7) → Sabrina's room (18, 15).
  for (const [x, y, toX, toY] of [[18, 20, 28, 23], [20, 20, 28, 4], [20, 7, 0, 4], [0, 7, 18, 15]]) {
    await game.eval((t, x, y) => t.walkTo(x, y), x, y);
    await game.waitFor((t) => t.idle() && !t.field()!.busy && !t.field()!.fading, { what: `the pad at (${x}, ${y})` });
    expect(await game.eval((t) => t.field())).toMatchObject({ map: 'SaffronCity_Gym', x: toX, y: toY });
  }
  await talkFrom(game, 14, 12, 'up'); // Sabrina at (14, 11)
  await winBattle(game, 'Sabrina');
  expect(await trainerDefeated(game, 'LEADER_SABRINA')).toBe(true);
  expect(await game.eval((t) => [t.flag('FLAG_BADGE06_GET'), t.flag('FLAG_DEFEATED_SABRINA'), t.flag('FLAG_GOT_TM04_FROM_SABRINA')])).toEqual([true, true, true]);
  expect(await game.eval((t) => t.itemCount('TM04'))).toBe(1);
});
