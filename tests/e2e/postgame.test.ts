// The postgame's first stretch, played (POSTGAME_PLAN.md W-sevii unit 1): Oak's OakRatingScene in Pallet Town and
// the National Dex in the lab, Celio's Ruby request, the ferry to One Island, Kindle Road (trainers, the Ember
// Spa), Mt. Ember (the Rockets' password scene and battles, the Ruby Path's braille, the Ruby, Moltres on the
// summit), and the Ruby back to Celio for the Rainbow Pass. Warps skip the walking between scenes, as
// seviiQuest.test.ts does.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';
import { checkRide, sail, talkToHarborSailor } from './seagallopHelpers';
import { afterHallOfFame, battlesSince, fillPokedex, MEWTWO, SCENE, scriptsSince, talk, warp } from './postgameHelpers';

const session = useGame();

const MEWTWO2 = { ...MEWTWO, moves: ['PSYCHIC'] };

/** The field message box's bytes (the braille has no charmap text for t.message()). */
function messageBytes(game: Game) {
  return game.eval(() => {
    const box = (window as any).game.scene.getScene('Overworld').messageBox;
    return box.visible ? (box.text as number[]) : undefined;
  });
}

test("Oak's National Dex, Celio's Ruby, Kindle Road, Mt. Ember, the Rainbow Pass", async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_1F', x: 8, y: 6, party: [MEWTWO, MEWTWO2] });
  await afterHallOfFame(game);
  await fillPokedex(game, 60);
  // OPTIONS: battle style SET (no "Will you change POKéMON?" to mash through with two in the party), scene OFF
  await game.eval((t) => {
    t.state!.battleStyleSet = true;
    t.state!.battleSceneOff = true;
  });

  // Out of the player's house: PalletTown_OnFrame's OakRatingScene (VAR_MAP_SCENE_PALLET_TOWN_OAK 2). One Island is
  // on the map and 60 are caught: Oak walks the player to the lab (VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB 7),
  // where EnterForNationalDexScene gives the National Dex (EnableNationalPokedex) and ends at 8.
  let since = await game.mark();
  await warp(game, 'MAP_PALLET_TOWN', 6, 8);
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB') === 8 && t.idle() && !t.field()!.script, { what: 'the National Dex', ...SCENE });
  expect(await game.eval((t) => [t.field()!.map, t.var('VAR_MAP_SCENE_PALLET_TOWN_OAK'), t.flag('FLAG_HIDE_OAK_IN_PALLET_TOWN'), t.state!.nationalDexEnabled])).toEqual([
    'PalletTown_ProfessorOaksLab',
    3,
    true,
    true,
  ]);
  expect(await scriptsSince(game, since)).toEqual(expect.arrayContaining(['PalletTown_EventScript_OakRatingScene', 'PalletTown_ProfessorOaksLab_EventScript_EnterForNationalDexScene']));

  // Three Island's harbor → One Island (the Tri-Pass menu: VERMILION, ONE ISLAND, TWO ISLAND, EXIT), then Celio: IsNationalPokedexEnabled, so
  // CelioRequestRuby (VAR_MAP_SCENE_MT_EMBER_EXTERIOR 1, VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F 4).
  await warp(game, 'MAP_THREE_ISLAND_HARBOR', 8, 5);
  // (Bill's trip is over, VAR_MAP_SCENE_CINNABAR_ISLAND 4: EventScript_ChooseDestFromIslandVermilionAllowed)
  expect(await talkToHarborSailor(game)).toBe(await game.eval((t) => t.define('MULTICHOICE_SEAGALLOP_V12')));
  await game.press('DOWN');
  await game.press('A'); // ONE ISLAND
  const toOne = await sail(game, 'Three → One Island', 2);
  checkRide(toOne.frames, false);
  expect(toOne.map).toBe('OneIsland_Harbor');
  await warp(game, 'MAP_ONE_ISLAND_POKEMON_CENTER_1F', 15, 8);
  since = await game.mark();
  await talk(game, 15, 7, 'up');
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F') === 4 && t.idle() && !t.field()!.script, { what: "Celio's Ruby request", ...SCENE });
  expect(await scriptsSince(game, since)).toEqual(['OneIsland_PokemonCenter_1F_EventScript_Celio']); // → CelioRequestRuby
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_MT_EMBER_EXTERIOR'))).toBe(1);

  // One Island → Kindle Road over the map connection (One Island's east edge)
  await warp(game, 'MAP_ONE_ISLAND', 22, 12);
  await game.walk('right', 2);
  expect(await game.eval(async (t) => {
    await t.until(() => t.field()?.map === 'OneIsland_KindleRoad', 600);
    return [t.field()!.map, t.field()!.x, t.field()!.y];
  })).toEqual(['OneIsland_KindleRoad', 0, 132]);

  // Kindle Road: Swimmer Abigail (17, 132; facing down, sight 2) sees the player at (17, 134); Crush Kin Mik & Kia
  // (8, 68) / (9, 68) see the two Mewtwo from (8, 70) for their double battle.
  await warp(game, 'MAP_ONE_ISLAND_KINDLE_ROAD', 17, 136);
  since = await game.mark();
  await game.walk('up', 2);
  await game.mashUntil((t) => t.trainerDefeated('SWIMMER_FEMALE_ABIGAIL') && t.idle() && !t.field()!.script, { what: 'Abigail', ...SCENE });
  await warp(game, 'MAP_ONE_ISLAND_KINDLE_ROAD', 8, 71);
  await game.walk('up', 2);
  await game.mashUntil((t) => t.trainerDefeated('CRUSH_KIN_MIK_KIA') && t.idle() && !t.field()!.script, { what: 'Mik & Kia', ...SCENE });
  expect(await battlesSince(game, since)).toEqual(await game.eval((t) => [t.define('TRAINER_SWIMMER_FEMALE_ABIGAIL'), t.define('TRAINER_CRUSH_KIN_MIK_KIA')]));

  // The Ember Spa: HM06 from the Rock Smash man (10, 5), the hot spring's heal on (13, 13) (SpaHeal: FADE_TO_WHITE,
  // HealPlayerParty).
  await warp(game, 'MAP_ONE_ISLAND_KINDLE_ROAD', 15, 59);
  since = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since, what: 'OneIsland_KindleRoad_EmberSpa' });
  await game.eval((t) => t.until(() => t.idle(), 20000));
  await talk(game, 10, 6, 'up');
  await game.mashUntil((t) => t.flag('FLAG_GOT_HM06') && t.idle() && !t.field()!.script, { what: 'HM06', ...SCENE });
  expect(await game.eval((t) => t.itemCount('HM06'))).toBe(1);
  await game.eval((t) => {
    const mon = t.state!.party[0];
    mon.hp = 1;
  });
  // (walkTo's route may cross (13, 13) itself)
  since = await game.mark();
  await game.eval((t) => t.walkTo(13, 13));
  await game.mashUntil((t) => t.var('VAR_TEMP_1') === 1 && t.idle() && !t.field()!.script, { what: 'the spa', ...SCENE });
  expect(await scriptsSince(game, since)).toContain('OneIsland_KindleRoad_EmberSpa_EventScript_SpaHeal');
  expect(await game.eval((t) => t.party()[0].hp === t.party()[0].maxHP)).toBe(true);

  // Mt. Ember: onto (38, 43) with VAR_MAP_SCENE_MT_EMBER_EXTERIOR 1, the Rockets' password scene (→ 2); both grunts
  // battle (VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F 4) and leave; the cave (OnLoad's open entrance at (42, 39)).
  await warp(game, 'MAP_MT_EMBER_EXTERIOR', 38, 44);
  since = await game.mark();
  await game.walk('up');
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_MT_EMBER_EXTERIOR') === 2 && t.idle() && !t.field()!.script, { what: 'the password scene', ...SCENE });
  expect(await scriptsSince(game, since)).toContain('MtEmber_Exterior_EventScript_RocketPasswordScene');
  await talk(game, 42, 41, 'up');
  await game.mashUntil((t) => t.trainerDefeated('TEAM_ROCKET_GRUNT_44') && t.idle() && !t.field()!.script, { what: 'grunt 2', ...SCENE });
  await talk(game, 41, 41, 'up');
  await game.mashUntil((t) => t.trainerDefeated('TEAM_ROCKET_GRUNT_43') && t.flag('FLAG_HIDE_MT_EMBER_EXTERIOR_ROCKETS') && t.idle() && !t.field()!.script, { what: 'grunt 1', ...SCENE });
  expect(await game.eval((t) => (t.objects() as { graphicsId: string }[]).some((o) => o.graphicsId === 'OBJ_EVENT_GFX_ROCKET_M'))).toBe(false);
  await game.eval((t) => t.walkTo(42, 40));
  since = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since, what: 'MtEmber_RubyPath_1F' });

  // The Ruby Path's B4F: the braille alphabet (BrailleABC from (4, 8) facing north), at once in FONT_BRAILLE
  await warp(game, 'MAP_MT_EMBER_RUBY_PATH_B4F', 4, 8);
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.eval((t) => t.until(() => (window as any).game.scene.getScene('Overworld').messageBox.visible, 600));
  expect(await messageBytes(game)).toEqual([0x01, 0x05, 0x03, 0xff]);
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'BrailleABC' });

  // B5F: the braille on the north wall, eight messages; each braillemessage_wait has the cursor after the text
  // ((width + 27) + 3, 130 + 4: getbraillestringwidth, BrailleCursorToggle)
  await warp(game, 'MAP_MT_EMBER_RUBY_PATH_B5F', 7, 3);
  await game.eval((t) => t.face('up'));
  await game.eval(() => new Function("return import('/src/script/postgameSpecials.ts')")());
  await game.press('A');
  const cursors = (await game.eval(async (t) => {
    const { brailleCursorProbe } = await new Function("return import('/src/script/postgameSpecials.ts')")();
    const box = (window as any).game.scene.getScene('Overworld').messageBox;
    const seen: { x: number; y: number; width: number }[] = [];
    let last: string | undefined;
    for (let i = 0; i < 7; i++) {
      // (the A that closes one message runs the next braillemessage_wait in the same frame: wait for its text)
      let c: { x: number; y: number } | undefined;
      const ok = await t.until(() => String(box.text) !== last && (c = brailleCursorProbe()) !== undefined, 2000);
      if (!ok) throw new Error(`braille message ${i}: no new message with a cursor (${String(box.text)})`);
      last = String(box.text);
      seen.push({ x: c!.x, y: c!.y, width: t.var('VAR_0x8004') });
      await t.press('A');
    }
    return seen;
  })) as { x: number; y: number; width: number }[];
  // EVERYTHING, HAS MEANING, EXISTENCE, HAS MEANING, BEING ALIVE, HAS MEANING, HAVE DREAMS: 16 px a cell
  expect(cursors.map((c) => c.width)).toEqual([10, 11, 9, 11, 11, 11, 11].map((n) => n * 16));
  expect(cursors.map((c) => [c.x, c.y])).toEqual(cursors.map((c) => [c.width + 27 + 3, 134]));
  await game.eval((t) => t.until(() => (window as any).game.scene.getScene('Overworld').messageBox.visible, 600));
  expect(await messageBytes(game)).toEqual([0x31, 0x16, 0x09, 0x00, 0x17, 0x19, 0x2e, 0x09, 0x1d, 0x2c, 0xff]); // USE POWER.
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the B5F braille' });

  // The Ruby (7, 7)
  await talk(game, 7, 8, 'up');
  await game.mashUntil((t) => t.flag('FLAG_GOT_RUBY') && t.idle() && !t.field()!.script, { what: 'the Ruby', ...SCENE });
  expect(await game.eval((t) => [t.itemCount('RUBY'), t.flag('FLAG_HIDE_RUBY')])).toEqual([1, true]);

  // The summit: Moltres (StartLegendaryBattle), beaten
  await warp(game, 'MAP_MT_EMBER_SUMMIT', 9, 8);
  since = await game.mark();
  await talk(game, 9, 7, 'up');
  // (Text_Gyaoo, waitmoncry, then `waitbuttonpress` before StartLegendaryBattle)
  expect(await game.mashUntil((t) => [undefined, 'NONE'].includes(t.battle()?.mons[1]?.species) ? undefined : t.battle()!.mons[1].species, { what: "Moltres's battle", ...SCENE })).toBe('MOLTRES');
  expect(await battlesSince(game, since)).toEqual([0]);
  await game.mashUntil((t) => t.flag('FLAG_FOUGHT_MOLTRES') && t.idle() && !t.field()!.script, { what: 'Moltres', ...SCENE });

  // Back to Celio: GiveCelioRuby, YES, the Rainbow Pass (FLAG_SYS_SEVII_MAP_4567, VAR 5)
  await warp(game, 'MAP_ONE_ISLAND_POKEMON_CENTER_1F', 15, 8);
  since = await game.mark();
  await talk(game, 15, 7, 'up');
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F') === 5 && t.idle() && !t.field()!.script, { what: 'the Rainbow Pass', ...SCENE });
  expect(await scriptsSince(game, since)).toEqual(['OneIsland_PokemonCenter_1F_EventScript_Celio']); // → GiveCelioRuby
  expect(await game.eval((t) => [t.flag('FLAG_SYS_SEVII_MAP_4567'), t.itemCount('RAINBOW_PASS'), t.itemCount('RUBY'), t.itemCount('TRI_PASS')])).toEqual([true, 1, 0, 0]);
}, 900_000);
