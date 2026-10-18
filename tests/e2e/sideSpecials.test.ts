// Small side specials (SIDE_PLAN.md W-misc): falling through a hole (EventScript_DoFallWarp, DoFallWarp,
// FieldCB_FallWarpExit), Daisy's grooming, the Route 12 Magikarp size record, the diploma, and the rest of
// script/miscSpecials.ts.

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO: MonSpec = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

/** Press A until the field message matches `re`; returns it. */
async function untilMessage(game: Game, re: RegExp, what: string, button: 'A' | 'B' = 'A'): Promise<string> {
  await game.eval((_t, src, flags) => ((window as any).__sideRe = new RegExp(src, flags)), re.source, re.flags);
  return (await game.mashUntil((t) => (window as any).__sideRe.test(t.message() ?? '') && t.message(), { what, button })) as string;
}

/** Press B until the script has ended and the field is free. */
const scriptDone = (game: Game, what: string) => game.mashUntil((t) => t.idle() && !t.field()!.script, { what, button: 'B' });

// ---------------------------------------------------------------- falling through a hole

test('falling through a hole in the Pokémon Mansion lands on the floor below', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PokemonMansion_3F', x: 18, y: 17, party: [MEWTWO] });
  // Watched in the page: the drop lasts a few dozen ticks.
  const dropped = game.watch((t) => {
    const f = t.field();
    return f?.map === 'PokemonMansion_1F' && f.playerVisible && f.avatar.spriteY2 < -40 && f.avatar.spriteY2;
  }, { what: 'the player dropping in from above the screen' });
  const shook = game.watch((t) => t.field()?.map === 'PokemonMansion_1F' && t.field()!.avatar.cameraPanY === 4, { what: 'the landing shake' });
  const since = await game.mark();
  await game.walk('down');
  await game.waitForEvent('fallWarp', { since });
  expect(await dropped).toBeLessThan(-40);
  await shook;
  await game.waitForEvent('fallWarpDone', { since });
  const f = (await game.eval((t) => t.field()))!;
  // PokemonMansion_1F's warp 7 (the 3F hole at (18, 18) leads to it)
  expect([f.map, f.x, f.y]).toEqual(['PokemonMansion_1F', 19, 22]);
  expect(f.avatar.spriteY2).toBe(0);
  expect(f.avatar.cameraPanY).toBe(0);
  expect(f.locked).toBe(false);
  await game.mashUntil((t) => t.idle(), { what: 'the field free again', button: 'B' });
});

test('falling into Seafoam Islands B4F lands the player surfing', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SeafoamIslands_B3F', x: 6, y: 17, party: [MEWTWO] });
  // No boulders pushed down to B4F yet, so the current runs (with both, EventScript_CurrentBlocked leaves the
  // player surfing where they land).
  await game.eval((t) => {
    t.state!.setFlag('FLAG_HIDE_SEAFOAM_B4F_BOULDER_1', true);
    t.state!.setFlag('FLAG_HIDE_SEAFOAM_B4F_BOULDER_2', true);
  });
  // FallWarpEffect_7: MetatileBehavior_IsSurfableInSeafoamIslands → VAR_TEMP_1 = 1 and surfing, read in the
  // tick it ends (the map's ON_FRAME script SeafoamIslands_B4F_EventScript_EnterByFalling takes it from there).
  const landed = game.watch((t) => {
    const f = t.field();
    return f?.map === 'SeafoamIslands_B4F' && f.avatar.flags.includes('SURFING') && t.var('VAR_TEMP_1') === 1 && { x: f.x, y: f.y };
  }, { what: 'landing in the water, surfing' });
  const since = await game.mark();
  await game.walk('down');
  await game.waitForEvent('fallWarpDone', { since });
  expect(await landed).toEqual({ x: 8, y: 17 }); // SeafoamIslands_B4F's warp 2
  // The current carries the player off and dumps them on land (SeafoamIslandsB4F_CurrentDumpsPlayerOnLand)
  await game.mashUntil((t) => t.idle() && !t.field()!.script && t.var('VAR_TEMP_1') === 0, { what: 'the current ride', button: 'B' });
  const f = (await game.eval((t) => t.field()))!;
  expect(f.avatar.flags).not.toContain('SURFING');
  expect([f.x, f.y]).not.toEqual([8, 17]);
});

/** Mash A until the party menu (ChoosePartyMon) takes input, then pick party slot 0. */
async function chooseFirstMon(game: Game, what: string): Promise<void> {
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu' && !t.paletteFadeActive(), { what });
  await game.press('A');
}

// ---------------------------------------------------------------- Daisy (PalletTown_RivalsHouse, after the Hall of Fame)

test('Daisy rates the lead mon, then grooms one after 500 steps', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_RivalsHouse', x: 5, y: 5, party: [MEWTWO] });
  await game.eval((t) => {
    t.state!.setFlag('FLAG_SYS_GAME_CLEAR', true);
    t.state!.party[0].friendship = 160;
    t.state!.party[0].metLocation = 'MAPSEC_CERULEAN_CAVE'; // (met in Pallet Town would add 1)
  });
  // A fresh cooldown: GetLeadMonFriendship 4 (150-199) → PalletTown_RivalsHouse_EventScript_MonFriendshipHigh
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await untilMessage(game, /may I see\s+your first/, 'Daisy: "may I see your first POKéMON?"');
  await scriptDone(game, 'the rating');
  expect(await game.eval((t) => t.var('VAR_RESULT'))).toBe(4);

  // Walk 500 steps' worth (RunMassageCooldownStepCounter caps it at 500): one real step counts too.
  await game.eval((t) => t.state!.setVar('VAR_MASSAGE_COOLDOWN_STEP_COUNTER', 499));
  await game.walk('down');
  expect(await game.eval((t) => t.var('VAR_MASSAGE_COOLDOWN_STEP_COUNTER'))).toBe(500);
  await game.walk('up');
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await untilMessage(game, /like me to groom one/, 'Daisy: "Would you like me to groom one?"');
  await chooseFirstMon(game, "Daisy's party menu");
  await untilMessage(game, /There you go/, 'Daisy: "There you go! All done."');
  await scriptDone(game, 'the grooming');
  const after = await game.eval((t) => ({ friendship: t.state!.party[0].friendship, cooldown: t.var('VAR_MASSAGE_COOLDOWN_STEP_COUNTER') }));
  // FRIENDSHIP_EVENT_MASSAGE at 100-199: +3 (sFriendshipEventDeltas); no Luxury Ball
  expect(after).toEqual({ friendship: 163, cooldown: 0 });
});

// ---------------------------------------------------------------- the Magikarp size record (Route12_FishingHouse)

test('the fishing guru measures a Magikarp and keeps the record', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route12_FishingHouse', x: 4, y: 5, party: [{ species: 'MAGIKARP', level: 10, moves: ['SPLASH'] }] });
  await game.eval((t) => {
    t.state!.setFlag('FLAG_GOT_SUPER_ROD', true);
    const m = t.state!.party[0];
    m.personality = 0x12345678;
    m.ivs = { hp: 31, attack: 31, defense: 31, speed: 31, spAttack: 31, spDefense: 31 };
  });
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await untilMessage(game, /Allow me to see it/, 'the guru asks to see it');
  await chooseFirstMon(game, "the guru's party menu");
  // CompareMagikarpSize: 34.9 inches, a new record → Route12_FishingHouse_EventScript_NewRecordMagikarp
  await untilMessage(game, /34\.9 inches!/, 'the new record');
  await scriptDone(game, 'the Net Ball');
  const after = await game.eval((t) => ({ record: t.var('VAR_MAGIKARP_SIZE_RECORD'), flag: t.flag('FLAG_GOT_RECORD_SETTING_MAGIKARP'), balls: t.itemCount('NET_BALL') }));
  expect(after).toEqual({ record: 0x7856, flag: true, balls: 1 });

  // The same Magikarp again ties the record (CompareMonSize 4)
  await game.press('A');
  await chooseFirstMon(game, "the guru's party menu again");
  await untilMessage(game, /34\.9 inches\?/, 'the tie');
  await untilMessage(game, /same size as the one/, 'the tie (Route12_FishingHouse_Text_HuhXInchesSameSizeAsLast)');
  await scriptDone(game, 'the tie');
});

// ---------------------------------------------------------------- the diploma (CeladonCity_Condominiums_3F)

/** Mark national dex numbers 1..n as seen and caught. */
const catchDex = (game: Game, n: number) =>
  game.eval((t, count) => {
    const s = t.state!;
    for (let i = 1; i <= count; i++) {
      s.dexSeen.add(i);
      s.dexCaught.add(i);
    }
    s.setFlag('FLAG_SYS_POKEDEX_GET', true);
  }, n);

test('the game designer hands over the diploma for a complete Kanto Pokédex', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_Condominiums_3F', x: 3, y: 9, party: [MEWTWO] });
  await catchDex(game, 150); // all but Mew: HasAllKantoMons
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await untilMessage(game, /Congratulations/i, 'the designer: "Congratulations!"');
  // ShowDiploma: the screen fades in, then takes A (Task_HandleDiplomaInput)
  const shown = await game.mashUntil((t) => t.gbaScreen() === 'CB2_Diploma' && !t.paletteFadeActive() && (t as any).diploma(), { what: 'the diploma', button: 'B' });
  expect(shown.national).toBe(false); // the KANTO half (HasAllMons needs the Johto and Hoenn mons too)
  await game.screenshot('diploma-kanto');
  await game.mashUntil((t) => t.idle() && !t.field()!.script && t.field()!.map === 'CeladonCity_Condominiums_3F', { what: 'back on the field' });
  expect(await game.eval((t) => (t as any).diploma())).toBeUndefined();
});

test('without a complete Kanto Pokédex the designer only asks to see it', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_Condominiums_3F', x: 3, y: 9, party: [MEWTWO] });
  await catchDex(game, 149);
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await untilMessage(game, /come tell me/, 'the designer: "When you finish, come tell me!"');
  expect(await game.eval((t) => t.var('VAR_RESULT'))).toBe(0);
  await scriptDone(game, 'the designer');
});

test('with every mon caught the diploma shows its NATIONAL half', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_Condominiums_3F', x: 3, y: 9, party: [MEWTWO] });
  await catchDex(game, 386); // HasAllMons (the event mons don't count, so catching them too is fine)
  await game.eval((t) => t.face('up'));
  await game.press('A');
  const shown = await game.mashUntil((t) => t.gbaScreen() === 'CB2_Diploma' && !t.paletteFadeActive() && (t as any).diploma(), { what: 'the diploma' });
  expect(shown.national).toBe(true); // BG1HOFS 0x100
  await game.mashUntil((t) => t.idle() && !t.field()!.script && t.field()!.map === 'CeladonCity_Condominiums_3F', { what: 'back on the field' });
});

// ---------------------------------------------------------------- SetSeenMon (SSAnne_2F_Room1)

test("the S.S. Anne gentleman's Snorlax picture marks Snorlax as seen", async () => {
  const game = await session.start({ start: 'after-rival', map: 'SSAnne_2F_Room1', x: 2, y: 4, party: [MEWTWO] });
  const snorlax = await game.eval((t) => t.state!.pokemon.nationalDex(t.state!.defines.require('SPECIES_SNORLAX')));
  expect(await game.eval((t, n) => t.state!.dexSeen.has(n), snorlax)).toBe(false);
  await game.eval((t) => t.face('left'));
  await game.press('A');
  await scriptDone(game, 'the gentleman');
  expect(await game.eval((t, n) => t.state!.dexSeen.has(n), snorlax)).toBe(true);
});

// ---------------------------------------------------------------- the Trainer Fan Club (SaffronCity_PokemonTrainerFanClub, trainer_fan_club.c)

test('the Trainer Fan Club: no fans before the Hall of Fame, the first three after it', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SaffronCity_PokemonTrainerFanClub', x: 7, y: 14, party: [MEWTWO] });
  // VAR_MAP_SCENE_SAFFRON_CITY_POKEMON_TRAINER_FAN_CLUB 0: the crush girl (FANCLUB_MEMBER1, above) isn't anyone's fan yet
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await untilMessage(game, /TRAINERS are so cool when\s+they.re battling/, 'the crush girl before the Hall of Fame');
  await scriptDone(game, 'the crush girl');

  // The Hall of Fame (EventScript_SetDefeatedEliteFourFlagsVars): special Script_UpdateTrainerFanClubGameClear
  const club = await game.eval(async (t) => {
    // (through Function, so vitest's transform leaves the page's dynamic import alone)
    const { SPECIALS } = await new Function("return import('/src/script/specials.ts')")();
    SPECIALS.Script_UpdateTrainerFanClubGameClear({ state: t.state });
    return {
      scene: t.var('VAR_MAP_SCENE_SAFFRON_CITY_POKEMON_TRAINER_FAN_CLUB'),
      fans: SPECIALS.Script_GetNumFansOfPlayerInTrainerFanClub({ state: t.state }),
      hidden: ['ROCKER', 'WOMAN', 'BEAUTY', 'BLACK_BELT'].map((m) => t.flag(`FLAG_HIDE_SAFFRON_FAN_CLUB_${m}`)),
    };
  });
  expect(club).toEqual({ scene: 1, fans: 3, hidden: [false, false, false, false] });

  // Coming in again: ON_TRANSITION seats members 4-8 at the far tables, ON_FRAME's MeetFirstFans walks the crush
  // girl up to the player, and the scene moves on to 2.
  const mark = await game.mark();
  await game.eval((_t) => (window as any).game.scene.getScene('Overworld').warp('MAP_SAFFRON_CITY_POKEMON_TRAINER_FAN_CLUB', 0, -1, -1));
  await game.waitForEvent('map', { since: mark, what: 'the fan club again' });
  await untilMessage(game, /You are!/, 'MeetFirstFans');
  await scriptDone(game, 'MeetFirstFans');
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_SAFFRON_CITY_POKEMON_TRAINER_FAN_CLUB'))).toBe(2);
  const objects = await game.eval((t) => t.objects().map((o) => [o.localId, o.x, o.y]));
  // (local ids 2 and 5-8: the little girl, woman, rocker, beauty and black belt, FANCLUB_MEMBER4-8)
  expect(objects).toEqual(expect.arrayContaining([[1, 6, 15], [2, 3, 4], [5, 10, 3], [6, 4, 6], [7, 7, 5], [8, 9, 6]]));

  // The crush girl is a fan now (one of three); the rocker (FANCLUB_MEMBER5) isn't.
  await game.eval((t) => t.face('right'));
  await game.press('A');
  await untilMessage(game, /always be cheering for you/, 'the crush girl, a fan');
  await scriptDone(game, 'the crush girl, a fan');
  expect(await game.eval((t) => t.walkTo(4, 7))).toMatchObject({ arrived: true });
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await untilMessage(game, /.s cool, huh\?\s+I love the way he talks/, 'the rocker, not a fan');
  await scriptDone(game, 'the rocker');
});
