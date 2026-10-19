// Five Island and the Sapphire back to Celio, played (POSTGAME_PLAN.md W-sevii unit 4), from the state the Sapphire
// theft in the Dotted Hole leaves: the Meadow's Rocket and the warehouse's password door, the Rocket Warehouse (its
// grunts and admins, the arrows for re-entry, Gideon and the Sapphire), Celio's network machine
// (OneIsland_PokemonCenter_1F_EventScript_GiveCelioSapphire: SetPostgameFlags, saved; InitRoamer), Cerulean Cave
// open (the guard gone, Mewtwo's battle start); the Lost Cave (fogged) and Selphy taken home to Resort Gorgeous,
// her requests (SampleResortGorgeousMonAndReward, IncrementResortGorgeousStepCounter on every step) and the
// Memorial Pillar. Warps skip the walking between scenes, as postgame.test.ts does.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';
import { afterHallOfFame, battlesSince, MEWTWO, rainbowPassState, SCENE, scriptsSince, talk, warp } from './postgameHelpers';

const session = useGame();

/** Surf first: the second admin's Houndoom is immune to Psychic. */
const MEWTWO_SURF = { ...MEWTWO, moves: ['SURF', 'PSYCHIC', 'STRENGTH'] };

/** A fresh Mewtwo (full HP and PP) before the next battle. */
function fresh(game: Game) {
  return game.eval((t, mon) => t.setParty([mon]), MEWTWO_SURF);
}

/** The metatile id at a map-local cell of the current map. */
function metatileAt(game: Game, x: number, y: number) {
  return game.eval((t, x, y) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const f = t.field()!;
    return s.world.tileAt(f.worldX - f.x + x, f.worldY - f.y + y).metatile as number;
  }, x, y);
}

/** Once the script the last press started is running, press A until the field is free again; the messages seen. */
function mashScript(game: Game) {
  return game.eval(async (t) => {
    await t.until(() => !!t.field()?.script || !t.idle(), 600);
    const r = await (t as any).mash((u: any) => u.idle() && !u.field()!.script, 'A', 60000, []);
    return (r.messages as string[]).map((m) => m.replace(/\s+/g, ' '));
  });
}

/** The SEs played since `since` (the audio events). */
function sesSince(game: Game, since: number) {
  return game.eval((t, s) => t.audioEvents(s).filter((e) => e.type === 'se').map((e) => e.name as string), since);
}

/**
 * The state the Sapphire theft leaves (SixIsland_DottedHole_SapphireRoom_EventScript_Sapphire, W-sevii unit 3):
 * `removeobject LOCALID_SAPPHIRE` (FLAG_HIDE_SAPPHIRE), the thief's `removeobject LOCALID_DOTTED_HOLE_THIEF`
 * (FLAG_HIDE_DOTTED_HOLE_SCIENTIST) and `setflag FLAG_LEARNED_YES_NAH_CHANSEY` (the warehouse's second password).
 */
async function sapphireTheftState(game: Game) {
  await game.eval((t) => {
    for (const f of ['FLAG_HIDE_SAPPHIRE', 'FLAG_HIDE_DOTTED_HOLE_SCIENTIST', 'FLAG_LEARNED_YES_NAH_CHANSEY']) t.state!.setFlag(f, true);
  });
}

/** START → SAVE → YES, then reload the page and CONTINUE (as postgameFourIsland.test.ts). */
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
  await game.waitIdle();
}

/** Every Five Island scene starts here: after the Hall of Fame, the Rainbow Pass, battle scenes off. */
async function postgameStart(game: Game) {
  await afterHallOfFame(game);
  await rainbowPassState(game);
  await game.eval((t) => {
    t.state!.battleSceneOff = true;
  });
}

const objectsWith = async (game: Game, gfx: string) =>
  ((await game.eval((t) => t.objects())) as { graphicsId: string; x: number; y: number }[]).filter((o) => o.graphicsId === gfx).map((o) => [o.x, o.y]);

test('the Meadow, the Rocket Warehouse and the Sapphire, Celio (SetPostgameFlags, saved; the roamer), Cerulean Cave', async () => {
  const game = await session.start({ start: 'after-rival', map: 'FiveIsland_Meadow', x: 13, y: 29, party: [MEWTWO_SURF] });
  await postgameStart(game);

  // The Meadow's Rocket (TRAINER_TEAM_ROCKET_GRUNT_50 at (11, 27), facing right, sight 3) sees the player
  let since = await game.mark();
  await game.walk('up', 2);
  await game.waitForEvent('trainerApproach', { since });
  await game.mashUntil((t) => t.trainerDefeated('TEAM_ROCKET_GRUNT_50') && t.idle() && !t.field()!.script, { what: "the Meadow's Rocket", ...SCENE });
  expect(await battlesSince(game, since)).toEqual([await game.eval((t) => t.define('TRAINER_TEAM_ROCKET_GRUNT_50'))]);

  // The warehouse door before the Sapphire theft: one password (Mt. Ember's "GOLDEEN need log") isn't enough
  const locked = await metatileAt(game, 12, 21);
  await talk(game, 12, 22, 'up');
  const door1 = await mashScript(game);
  expect(door1.some((m) => /Another password is needed/.test(m))).toBe(true);
  expect(await game.eval((t) => t.flag('FLAG_UNLOCKED_ROCKET_WAREHOUSE'))).toBe(false);

  // After the theft (Gideon told the second password): FiveIsland_Meadow_EventScript_OpenWarehouseDoor
  await sapphireTheftState(game);
  since = await game.mark();
  await game.press('A');
  const door2 = await mashScript(game);
  expect(door2.some((m) => /entered two passwords/.test(m))).toBe(true);
  expect(door2.some((m) => /The WAREHOUSE.s door opened!/.test(m))).toBe(true);
  const unlocked = await game.eval((t) => t.define('METATILE_SeviiIslands45_RocketWarehouseDoor_Unlocked'));
  expect(locked).not.toBe(unlocked);
  expect(await metatileAt(game, 12, 21)).toBe(unlocked);
  expect(await game.eval((t) => t.flag('FLAG_UNLOCKED_ROCKET_WAREHOUSE'))).toBe(true);
  expect(await sesSince(game, since)).toContain('SE_PIN');

  // In through the door: FiveIsland_RocketWarehouse_OnTransition's setworldmapflag
  since = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since, what: 'FiveIsland_RocketWarehouse' });
  await game.eval((t) => t.until(() => t.field()?.map === 'FiveIsland_RocketWarehouse' && t.idle(), 20000));
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y, t.flag('FLAG_WORLD_MAP_FIVE_ISLAND_ROCKET_WAREHOUSE')])).toEqual([24, 25, true]);

  await fresh(game);
  // A grunt in the spin maze (TRAINER_TEAM_ROCKET_GRUNT_48 at (17, 15), facing right, sight 1)
  await warp(game, 'MAP_FIVE_ISLAND_ROCKET_WAREHOUSE', 18, 16);
  since = await game.mark();
  await game.walk('up');
  await game.waitForEvent('trainerApproach', { since });
  await game.mashUntil((t) => t.trainerDefeated('TEAM_ROCKET_GRUNT_48') && t.idle() && !t.field()!.script, { what: 'the grunt', ...SCENE });

  await fresh(game);
  // The first admin (TRAINER_TEAM_ROCKET_ADMIN at (27, 16), facing left, sight 3): DefeatedAdmin1 walks her to the
  // switch (SE_PIN) and SetArrowsForReEntry turns the spinners at (26, 20) and (27, 20) to arrows up.
  await warp(game, 'MAP_FIVE_ISLAND_ROCKET_WAREHOUSE', 24, 18);
  const arrowUp = await game.eval((t) => t.define('METATILE_SilphCo_Arrow_Up'));
  expect(await metatileAt(game, 26, 20)).not.toBe(arrowUp);
  since = await game.mark();
  await game.walk('up', 2);
  await game.waitForEvent('trainerApproach', { since });
  await game.mashUntil((t) => t.trainerDefeated('TEAM_ROCKET_ADMIN') && t.idle() && !t.field()!.script, { what: 'the first admin', ...SCENE });
  expect(await battlesSince(game, since)).toEqual([await game.eval((t) => t.define('TRAINER_TEAM_ROCKET_ADMIN'))]);
  expect([await metatileAt(game, 26, 20), await metatileAt(game, 27, 20)]).toEqual([arrowUp, arrowUp]);
  expect(await sesSince(game, since)).toContain('SE_PIN');
  // ON_LOAD sets them again on the next visit (call_if_defeated TRAINER_TEAM_ROCKET_ADMIN)
  await warp(game, 'MAP_FIVE_ISLAND_ROCKET_WAREHOUSE', 24, 25);
  expect([await metatileAt(game, 26, 20), await metatileAt(game, 27, 20)]).toEqual([arrowUp, arrowUp]);

  await fresh(game);
  // The second admin: the coord event at (24, 11) turns him left (VAR_MAP_SCENE_ROCKET_WAREHOUSE 1), he sees the
  // player; DefeatedAdmin2 fades out, every Rocket gone (FLAG_HIDE_FIVE_ISLAND_ROCKETS), FLAG_DEFEATED_ROCKETS_IN_WAREHOUSE.
  await warp(game, 'MAP_FIVE_ISLAND_ROCKET_WAREHOUSE', 24, 12);
  since = await game.mark();
  await game.walk('up');
  await game.mashUntil((t) => t.flag('FLAG_DEFEATED_ROCKETS_IN_WAREHOUSE') && t.idle() && !t.field()!.script, { what: 'the second admin', ...SCENE });
  expect(await scriptsSince(game, since)).toEqual(['FiveIsland_RocketWarehouse_EventScript_Admin2Trigger', 'EventScript_DoTrainerBattleFromApproach']);
  expect(await battlesSince(game, since)).toEqual([await game.eval((t) => t.define('TRAINER_TEAM_ROCKET_ADMIN_2'))]);
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_ROCKET_WAREHOUSE'), t.flag('FLAG_HIDE_FIVE_ISLAND_ROCKETS')])).toEqual([1, true]);
  // (the four with local ids are removed; the grunt at (6, 6) stays until the map loads again, as in the C)
  expect([...(await objectsWith(game, 'OBJ_EVENT_GFX_ROCKET_M')), ...(await objectsWith(game, 'OBJ_EVENT_GFX_ROCKET_F'))]).toEqual([[6, 6]]);
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y, t.field()!.facing])).toEqual([24, 11, 'right']);

  await fresh(game);
  // Gideon (27, 4): his battle, then the Sapphire (FLAG_RECOVERED_SAPPHIRE)
  since = await game.mark();
  await talk(game, 27, 5, 'up');
  await game.mashUntil((t) => t.flag('FLAG_RECOVERED_SAPPHIRE') && t.idle() && !t.field()!.script, { what: 'Gideon', ...SCENE });
  expect(await battlesSince(game, since)).toEqual([await game.eval((t) => t.define('TRAINER_SCIENTIST_GIDEON'))]);
  expect(await game.eval((t) => t.itemCount('SAPPHIRE'))).toBe(1);
  await talk(game, 27, 5, 'up');
  expect((await mashScript(game)).some((m) => /Get lost/i.test(m))).toBe(true);

  // Back on the Meadow, ON_LOAD keeps the door open
  await warp(game, 'MAP_FIVE_ISLAND_MEADOW', 12, 22);
  expect(await metatileAt(game, 12, 21)).toBe(unlocked);

  // Celio: GiveCelioSapphire (VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F 5 → 6)
  await warp(game, 'MAP_ONE_ISLAND_POKEMON_CENTER_1F', 15, 8);
  const machine = await game.eval((t) => ({
    left: t.define('METATILE_PokemonCenter_NetworkMachine_ScreenLeft_On'),
    right: t.define('METATILE_PokemonCenter_NetworkMachine_ScreenRight_On'),
    sapphire: t.define('METATILE_PokemonCenter_NetworkMachine_Sapphire'),
    ruby: t.define('METATILE_PokemonCenter_NetworkMachine_Ruby'),
  }));
  const machineTiles = async () => [await metatileAt(game, 13, 4), await metatileAt(game, 14, 4), await metatileAt(game, 15, 4), await metatileAt(game, 16, 4)];
  const before = await machineTiles();
  expect(before[0]).toBe(machine.ruby); // ON_LOAD's SetRubyMetatile (VAR ≥ 5)
  expect(before.slice(1)).not.toContain(machine.sapphire);
  expect(before.slice(1)).not.toContain(machine.left);
  since = await game.mark();
  await talk(game, 15, 7, 'up');
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F') === 6 && t.idle() && !t.field()!.script, { what: 'the Sapphire to Celio', ...SCENE });
  expect(await scriptsSince(game, since)).toEqual(['OneIsland_PokemonCenter_1F_EventScript_Celio']); // → GiveCelioSapphire
  expect(await machineTiles()).toEqual([machine.ruby, machine.left, machine.right, machine.sapphire]);
  const ses = await sesSince(game, since);
  expect(ses.indexOf('SE_CLICK')).toBeGreaterThanOrEqual(0);
  expect(ses.indexOf('SE_PC_ON')).toBeGreaterThan(ses.indexOf('SE_CLICK'));
  expect(await game.eval((t) => [t.itemCount('SAPPHIRE'), t.flag('FLAG_SYS_CAN_LINK_WITH_RS'), t.flag('FLAG_HIDE_CERULEAN_CAVE_GUARD'), t.flag('FLAG_HIDE_LORELEI_IN_HER_HOUSE')])).toEqual([0, true, true, true]);
  // SetPostgameFlags: CHAMPION_SAVEWARP and gcnLinkFlags bits 1, 2, 3, 15
  expect(await game.eval((t) => [t.state!.specialSaveWarpFlags & 0x80, t.state!.gcnLinkFlags])).toEqual([0x80, 0x800e]);
  // InitRoamer: a level-50 Raikou, Entei or Suicune (by the starter) roaming from one of the location sets' first map
  const roamer = async () =>
    game.eval(async (t) => {
      const m = await new Function("return import('/src/world/roamer.ts')")();
      const r = t.state!.roamer;
      return { active: r.active, level: r.level, species: r.species, location: m.roamerLocation() as string };
    });
  const r1 = await roamer();
  expect(r1).toMatchObject({ active: true, level: 50 });
  expect(await game.eval((t, s) => ['SPECIES_RAIKOU', 'SPECIES_ENTEI', 'SPECIES_SUICUNE'].map((n) => t.define(n)).includes(s), r1.species)).toBe(true);
  expect(r1.location).toMatch(/^MAP_ROUTE/);

  // Saved and continued: the flags are in the save; ON_LOAD's SetNetworkMachineOn (FLAG_SYS_CAN_LINK_WITH_RS)
  await saveAndContinue(game);
  expect(await game.eval((t) => [t.field()!.map, t.state!.specialSaveWarpFlags & 0x80, t.state!.gcnLinkFlags, t.var('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F')])).toEqual(['OneIsland_PokemonCenter_1F', 0x80, 0x800e, 6]);
  expect(await machineTiles()).toEqual([machine.ruby, machine.left, machine.right, machine.sapphire]);
  expect((await roamer()).active).toBe(true);
  await talk(game, 15, 7, 'up');
  expect((await mashScript(game)).some((m) => /best of luck/.test(m))).toBe(true);
  // The next visit's ON_TRANSITION: SetCelioQuestDone (VAR 7)
  await warp(game, 'MAP_ONE_ISLAND_POKEMON_CENTER_1F', 15, 8);
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F'))).toBe(7);

  // Cerulean Cave: the guard at (1, 13) is gone, the way to the entrance at (1, 12) is open
  await warp(game, 'MAP_CERULEAN_CITY', 1, 14);
  expect(await objectsWith(game, 'OBJ_EVENT_GFX_COOLTRAINER_M')).not.toContainEqual([1, 13]);
  since = await game.mark();
  await game.walk('up', 2);
  await game.waitForEvent('map', { since, what: 'CeruleanCave_1F' });
  await game.eval((t) => t.until(() => t.field()?.map === 'CeruleanCave_1F' && t.idle(), 20000));

  // Mewtwo on B1F (CeruleanCave_B1F_OnTransition shows it): StartLegendaryBattle
  await warp(game, 'MAP_CERULEAN_CAVE_B1F', 7, 14);
  expect(await objectsWith(game, 'OBJ_EVENT_GFX_MEWTWO')).toEqual([[7, 12]]);
  since = await game.mark();
  await talk(game, 7, 13, 'up');
  expect(await game.mashUntil((t) => ([undefined, 'NONE'].includes(t.battle()?.mons[1]?.species) ? undefined : t.battle()!.mons[1].species), { what: "Mewtwo's battle", ...SCENE })).toBe('MEWTWO');
  expect(await battlesSince(game, since)).toEqual([0]);
  expect(await game.eval((t) => t.flag('FLAG_SYS_SPECIAL_WILD_BATTLE'))).toBe(true);
}, 900_000);

test('the Lost Cave and Selphy, her requests at Resort Gorgeous, the Memorial Pillar', async () => {
  const game = await session.start({ start: 'after-rival', map: 'FiveIsland_LostCave_Room1', x: 8, y: 4, party: [MEWTWO_SURF] });
  await postgameStart(game);
  await sapphireTheftState(game);

  // Lost Cave room 10 (fogged): FiveIsland_LostCave_Room10_EventScript_FindSelphyScene, her battle, the warp to
  // Resort Gorgeous (39, 10), where ON_WARP turns the player north and ON_FRAME's SelphyReturnHomeScene sees her in.
  let since = await game.mark();
  await warp(game, 'MAP_FIVE_ISLAND_LOST_CAVE_ROOM10', 5, 8);
  const fog = await game.eval((t) => [t.weather()!.currWeather, t.define('WEATHER_FOG_HORIZONTAL'), t.fog()?.sprites.length]);
  expect(fog[0]).toBe(fog[1]);
  expect(fog[2]).toBe(20);
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_FIVE_ISLAND_RESORT_GORGEOUS') === 2 && t.field()!.map === 'FiveIsland_ResortGorgeous' && t.idle() && !t.field()!.script, { what: "Selphy's scenes", ...SCENE });
  expect(await scriptsSince(game, since)).toEqual(['FiveIsland_LostCave_Room10_EventScript_FindSelphyScene', 'FiveIsland_ResortGorgeous_EventScript_SelphyReturnHomeScene']);
  expect(await battlesSince(game, since)).toEqual([await game.eval((t) => t.define('TRAINER_LADY_SELPHY'))]);
  expect(await game.eval((t) => [t.flag('FLAG_HIDE_LOST_CAVE_SELPHY'), t.flag('FLAG_HIDE_RESORT_GORGEOUS_INSIDE_SELPHY'), t.var('VAR_MAP_SCENE_FIVE_ISLAND_LOST_CAVE_ROOM10')])).toEqual([true, false, 1]);
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y, t.field()!.facing])).toEqual([39, 10, 'up']);
  expect(await objectsWith(game, 'OBJ_EVENT_GFX_WOMAN_2')).not.toContainEqual([39, 9]);

  // Into her house (the door at (39, 8)); only Pikachu seen, so SampleResortGorgeousMon can only pick it
  await game.eval((t) => {
    t.state!.dexSeen.clear();
    t.state!.setDexFlags(t.state!.pokemon.nationalDex(t.define('SPECIES_PIKACHU')), true, false);
  });
  since = await game.mark();
  await game.walk('up', 2);
  await game.waitForEvent('map', { since, what: 'FiveIsland_ResortGorgeous_House' });
  await game.eval((t) => t.until(() => t.field()?.map === 'FiveIsland_ResortGorgeous_House' && t.idle(), 20000));
  const PIKACHU = await game.eval((t) => t.define('SPECIES_PIKACHU'));
  const rg = () => game.eval((t) => [t.var('VAR_RESORT_GORGEOUS_REQUESTED_MON'), t.var('VAR_RESORT_GOREGEOUS_STEP_COUNTER')]);

  // The first visit: her wish (SampleResortGorgeousMonAndReward)
  await talk(game, 4, 5, 'up');
  const wish = await mashScript(game);
  expect(wish.some((m) => /Do I know you from somewhere/.test(m))).toBe(true);
  expect(wish.some((m) => /A darling PIKACHU/.test(m))).toBe(true);
  expect(await rg()).toEqual([PIKACHU, 0]);
  const reward = await game.eval((t) => t.var('VAR_RESORT_GORGEOUS_REWARD'));
  const rewards = await game.eval((t) => ['LUXURY_BALL', 'BIG_PEARL', 'PEARL', 'STARDUST', 'STAR_PIECE', 'NUGGET', 'RARE_CANDY'].map((n) => t.define(`ITEM_${n}`)));
  expect(rewards).toContain(reward);

  // Without a Pikachu in the party she asks again
  await talk(game, 4, 5, 'up');
  expect((await mashScript(game)).some((m) => /A darling PIKACHU/.test(m))).toBe(true);

  // 250 steps (IncrementResortGorgeousStepCounter, every step) and the request runs out (0xFFFF)
  const walked = await game.eval(async (t) => {
    await t.walk('down', 1);
    let dir: 'left' | 'right' = 'right';
    while (t.var('VAR_RESORT_GOREGEOUS_STEP_COUNTER') < 249) {
      await t.walk(dir, 1);
      dir = dir === 'right' ? 'left' : 'right';
    }
    const at249 = [t.var('VAR_RESORT_GORGEOUS_REQUESTED_MON'), t.var('VAR_RESORT_GOREGEOUS_STEP_COUNTER')];
    await t.walk(dir, 1);
    return at249;
  });
  expect(walked).toEqual([PIKACHU, 249]);
  expect(await rg()).toEqual([0xffff, 0]);
  // ... she's tired of waiting and asks anew (Pikachu again, the counter restarted)
  await talk(game, 4, 5, 'up');
  const tired = await mashScript(game);
  expect(tired.some((m) => /I.m tired of waiting for you/.test(m))).toBe(true);
  expect(tired.some((m) => /A darling PIKACHU/.test(m))).toBe(true);
  expect((await rg())[0]).toBe(PIKACHU);

  // With a Pikachu: the butler brings her thanks (the reward), FLAG_TEMP_2, the request cleared
  const reward2 = await game.eval((t) => t.var('VAR_RESORT_GORGEOUS_REWARD'));
  await game.eval((t) => t.setParty([{ species: 'MEWTWO', level: 100, moves: ['SURF'] }, { species: 'PIKACHU', level: 20 }]));
  const count = (id: number) => game.eval((t, id) => t.state!.bag.pockets.flat().find((s) => s.itemId === id)?.quantity ?? 0, id);
  const had = await count(reward2);
  since = await game.mark();
  await talk(game, 4, 5, 'up');
  const thanks = await mashScript(game);
  expect(thanks.some((m) => /That must be the PIKACHU you caught for me/.test(m))).toBe(true);
  expect(await count(reward2)).toBe(had + 1);
  expect(await game.eval((t) => [t.flag('FLAG_TEMP_2'), t.var('VAR_RESORT_GORGEOUS_REQUESTED_MON')])).toEqual([true, 0]);
  expect(await objectsWith(game, 'OBJ_EVENT_GFX_GENTLEMAN')).toHaveLength(1);
  await talk(game, 4, 5, 'up');
  expect((await mashScript(game)).some((m) => /I wish you the best of luck/.test(m))).toBe(true);

  // The Memorial Pillar: a Lemonade for Tectonix, TM42 from the man
  await warp(game, 'MAP_FIVE_ISLAND_MEMORIAL_PILLAR', 9, 45);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_LEMONADE'), 1));
  await talk(game, 9, 44, 'up');
  const memorial = await mashScript(game);
  expect(memorial.some((m) => /TECTONIX/.test(m))).toBe(true);
  expect(await game.eval((t) => [t.flag('FLAG_GOT_TM42_AT_MEMORIAL_PILLAR'), t.itemCount('TM42'), t.itemCount('LEMONADE')])).toEqual([true, 1, 0]);
}, 900_000);
