// Small side events (SIDE_PLAN.md W-daycare unit 1): Prof. Oak's Pokédex rating in his lab and through
// "PROF. OAK's PC" (prof_pc.c GetProfOaksRatingMessage, pokedex.c HasAllMons), the Pewter Museum's fossil pics
// (script_menu.c OpenMuseumFossilPic / CloseMuseumFossilPic), and the Cinnabar lab's fossil revival.

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO: MonSpec = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

/** Mark national dex numbers 1..seen as seen and 1..caught as caught (skipping `except`). */
const setDex = (game: Game, seen: number, caught: number, except: number[] = []) =>
  game.eval(
    (t, sn, cn, ex) => {
      const s = t.state!;
      s.dexSeen.clear();
      s.dexCaught.clear();
      for (let n = 1; n <= sn; n++) if (!ex.includes(n)) s.dexSeen.add(n);
      for (let n = 1; n <= cn; n++) if (!ex.includes(n)) s.dexCaught.add(n);
      s.setFlag('FLAG_SYS_POKEDEX_GET', true);
    },
    seen,
    caught,
    except,
  );

/** Press A until the field message matches `re`; returns it. */
async function untilMessage(game: Game, re: RegExp, what: string): Promise<string> {
  // mashUntil's check is sent as source text: the pattern goes through the page
  await game.eval((_t, src, flags) => ((window as any).__sideRe = new RegExp(src, flags)), re.source, re.flags);
  return (await game.mashUntil((t) => (window as any).__sideRe.test(t.message() ?? '') && t.message(), { what })) as string;
}

/** Press B until the script has ended and the field is free (B can't talk to the person in front again). */
const scriptDone = (game: Game, what: string) => game.mashUntil((t) => t.idle() && !t.field()!.script, { what, button: 'B' });

// ---------------------------------------------------------------- Oak's rating

test('Oak rates the Pokédex in person by the Kanto mons caught', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_ProfessorOaksLab', x: 6, y: 4, party: [MEWTWO] });
  // VAR 6 (after the Pokédex scene) with more than the starter caught: PalletTown_ProfessorOaksLab_EventScript_RatePokedex
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB', 6));
  await setDex(game, 30, 25);
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await untilMessage(game, /How is your POK.DEX coming along/, 'Oak: "How is your POKéDEX coming along?"');
  expect(await untilMessage(game, /POK.MON owned/, 'the counts')).toMatch(/30 POK.MON seen and\s+25 POK.MON owned/);
  // GetProfOaksRatingMessage: 20-29 caught → PokedexRating_Text_LessThan30; VAR_RESULT FALSE (MUS_DEX_RATING)
  await untilMessage(game, /could use a bit more/, 'the rating (LessThan30)');
  expect(await game.eval((t) => t.var('VAR_RESULT'))).toBe(0);
  await scriptDone(game, 'the end of the rating');
  expect(await game.eval((t) => t.flag('FLAG_OAK_SAW_DEX_COMPLETION'))).toBe(false);
});

test('Oak calls a Kanto dex without Mew complete', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_ProfessorOaksLab', x: 6, y: 4, party: [MEWTWO] });
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB', 6));
  await setDex(game, 151, 151, [151]); // all but Mew
  await game.eval((t) => t.face('up'));
  await game.press('A');
  expect(await untilMessage(game, /POK.MON owned/, 'the counts')).toMatch(/150 POK.MON seen and\s+150 POK.MON owned/);
  await untilMessage(game, /entirely complete/, 'the rating (Complete)');
  expect(await game.eval((t) => t.var('VAR_RESULT'))).toBe(1);
  await scriptDone(game, 'the end of the rating');
});

/** Viridian City's Pokémon Center: the PC is above (11, 2). */
const PC = { start: 'after-rival' as const, map: 'ViridianCity_PokemonCenter_1F', x: 11, y: 2, party: [MEWTWO] };

/** Turn on the PC and pick PROF. OAK's PC (the third entry). */
async function openOaksPc(game: Game): Promise<void> {
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /Which PC/.test(t.message() ?? ''), { what: 'the PC menu' });
  await game.eval((t) => t.waitFrames(60)); // the message prints, then CreatePCMenu
  await game.pressTimes('DOWN', 2);
  await game.press('A');
}

test('PROF. OAK\'s PC rates the Pokédex, and the national dex once it is on', async () => {
  const game = await session.start(PC);
  // National dex on, every mon HasAllMons asks for: the completion text and FLAG_OAK_SAW_DEX_COMPLETION
  await game.eval((t) => {
    const s = t.state!;
    s.nationalDexEnabled = true;
    s.setVar('VAR_NATIONAL_DEX', 0x6258);
    s.setFlag('FLAG_SYS_NATIONAL_DEX', true);
  });
  const MEW = 151, LUGIA = 249, HO_OH = 250, CELEBI = 251, JIRACHI = 385, DEOXYS = 386;
  await setDex(game, 386, 386, [MEW, LUGIA, HO_OH, CELEBI, JIRACHI, DEOXYS]);
  await openOaksPc(game);
  await untilMessage(game, /Accessed PROF. OAK.s PC/, 'Accessed PROF. OAK\'s PC');
  await untilMessage(game, /POK.DEX rated\?/, 'the YES/NO'); // A on the YES/NO: YES
  expect(await untilMessage(game, /POK.MON owned/, 'the Kanto counts')).toMatch(/150 POK.MON seen and\s+150 POK.MON owned/);
  await untilMessage(game, /entirely complete/, 'the Kanto rating');
  expect(await untilMessage(game, /NATIONAL POK.DEX is/, 'the national counts')).toBeTruthy();
  expect(await untilMessage(game, /POK.MON owned/, 'the national counts')).toMatch(/380 POK.MON seen and\s+380 POK.MON owned/);
  await untilMessage(game, /completed the\s+POK.DEX/, 'HasAllMons: the completion text');
  expect(await game.eval((t) => t.flag('FLAG_OAK_SAW_DEX_COMPLETION'))).toBe(true);
  // EventScript_ExitOaksPC → the PC menu again; B turns the PC off
  await untilMessage(game, /Closed link to PROF. OAK.s PC/, 'the link closing');
  expect(await game.eval((t) => t.flag('FLAG_OAKS_RATING_IS_VIA_PC'))).toBe(false);
  await untilMessage(game, /Which PC/, 'the PC menu again');
  await scriptDone(game, 'the PC turning off');
});

test('PROF. OAK\'s PC: saying NO closes the link', async () => {
  const game = await session.start(PC);
  await setDex(game, 12, 11);
  await openOaksPc(game);
  await untilMessage(game, /POK.DEX rated\?/, 'the YES/NO');
  // NO on the YES/NO (mash B: B is NO)
  await game.mashUntil((t) => /Closed link/.test(t.message() ?? ''), { what: 'the link closing', button: 'B' });
  await scriptDone(game, 'the PC turning off');
});

// ---------------------------------------------------------------- the museum's fossil pics

for (const [species, y, from, text] of [
  ['SPECIES_AERODACTYL', 4, 'Aerodactyl', /AERODACTYL Fossil/],
  ['SPECIES_KABUTOPS', 7, 'Kabutops', /KABUTOPS Fossil/],
] as const) {
  test(`the museum's ${from} fossil shows its pic while the text is up`, async () => {
    const game = await session.start({ start: 'after-rival', map: 'PewterCity_Museum_1F', x: 5, y, party: [MEWTWO] });
    await game.eval((t) => t.face('left'));
    await game.press('A');
    const shown = await untilMessage(game, text, 'the fossil text');
    expect(shown).toBeTruthy();
    // OpenMuseumFossilPic (VAR_0x8005 = 10, VAR_0x8006 = 3): the 64x64 sprite's centre at (10*8+40, 3*8+40)
    expect(await game.eval((t) => t.museumFossilPic())).toMatchObject({ species, state: 1, sprite: true, window: true, x: 120, y: 64 });
    // CloseMuseumFossilPic after the text: Task_WaitMuseumFossilPic takes the sprite, then the window, down
    await scriptDone(game, 'the fossil script');
    expect(await game.eval((t) => t.until(() => !t.museumFossilPic(), 600))).toBe(true);
  });
}

// ---------------------------------------------------------------- the Cinnabar lab's fossil revival

test('the Cinnabar lab revives a Dome Fossil into a Kabuto after a walk', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CinnabarIsland_PokemonLab_ExperimentRoom', x: 12, y: 4, party: [MEWTWO] });
  await game.eval((t) => {
    t.state!.setFlag('FLAG_GOT_DOME_FOSSIL', true);
    t.state!.bag.add(t.define('ITEM_DOME_FOSSIL'), 1);
  });
  await game.eval((t) => t.face('up'));
  await game.press('A');
  // MULTICHOICE_DOME (DOME FOSSIL / CANCEL): A picks the fossil, then YES
  await untilMessage(game, /KABUTO/, 'the scientist naming the fossil\'s mon');
  await untilMessage(game, /go for walk/, '"It takes time"');
  await scriptDone(game, 'handing the fossil over');
  expect(await game.eval((t) => t.itemCount('DOME_FOSSIL'))).toBe(0);
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_CINNABAR_ISLAND_POKEMON_LAB_EXPERIMENT_ROOM_REVIVE_STATE'))).toBe(1);

  // Talking again: still reviving
  await game.press('A');
  await untilMessage(game, /go for walk/, 'still reviving');
  await scriptDone(game, 'still reviving');

  // Leave for the entrance hall (its ON_TRANSITION sets the state to 2) and come back
  let mark = await game.mark();
  await game.eval((t) => t.walkTo(7, 9));
  await game.eval((t) => t.enterWarp());
  expect((await game.waitForEvent('map', { since: mark, what: 'the entrance hall' })).map).toBe('CinnabarIsland_PokemonLab_Entrance');
  await game.waitIdle();
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_CINNABAR_ISLAND_POKEMON_LAB_EXPERIMENT_ROOM_REVIVE_STATE'))).toBe(2);
  mark = await game.mark();
  // the testing room's door at (25, 5): walk up into it from below
  await game.eval((t) => t.walkTo(25, 6));
  await game.walk('up');
  expect((await game.waitForEvent('map', { since: mark, what: 'the experiment room' })).map).toBe('CinnabarIsland_PokemonLab_ExperimentRoom');
  await game.waitIdle();

  expect(await game.eval((t) => t.walkTo(12, 4))).toMatchObject({ arrived: true });
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await untilMessage(game, /received the KABUTO/, 'receiving Kabuto');
  // No nickname (B on the YES/NO)
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the end of the gift', answers: [[/nickname/, 'B']] });
  const party = await game.eval((t) => t.party());
  expect(party.map((m) => [m.species, m.level])).toEqual([['MEWTWO', 100], ['KABUTO', 5]]);
  expect(await game.eval((t) => t.flag('FLAG_REVIVED_DOME'))).toBe(true);
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_CINNABAR_ISLAND_POKEMON_LAB_EXPERIMENT_ROOM_REVIVE_STATE'))).toBe(0);
});
