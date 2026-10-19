// Six Island, played (POSTGAME_PLAN.md W-sevii unit 3): the Pokémon Center's rival scene, Ruin Valley's Dotted
// Hole door (Cut on the braille: CutMoveRuinValleyCheck / CutMoveOpenDottedHoleDoor), the Dotted Hole's floors and
// their braille, the Sapphire room (the thief falls in with disable_anim / restore_anim, ShakeScreen, the Sapphire
// taken: FLAG_LEARNED_YES_NAH_CHANSEY), the Water Path beauty's Heracross record (pokemon_size_record.c), and a
// sweep of Pattern Bush, Green Path, Outcast Island and the Water Path (trainers, items, NPCs). Warps skip the
// walking between scenes, as postgame.test.ts does.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';
import { afterHallOfFame, MEWTWO, SCENE, scriptsSince, warp } from './postgameHelpers';

const session = useGame();

/** CUT first, so it is the party menu's first field move (SetPartyMonFieldSelectionActions goes by move slot). */
const CUTTER = { ...MEWTWO, moves: ['CUT', 'PSYCHIC', 'SURF', 'STRENGTH'] };

/**
 * afterHallOfFame, then the Rainbow Pass as postgame.test.ts plays it: Celio's OneIsland_PokemonCenter_1F_EventScript_
 * GiveRainbowPass (removeitem RUBY / TRI_PASS, VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F 5, RAINBOW_PASS,
 * FLAG_SYS_SEVII_MAP_4567), after CelioRequestRuby (VAR_MAP_SCENE_MT_EMBER_EXTERIOR 1 → the Rockets' scene, 2) and
 * the Ruby Path (FLAG_GOT_RUBY, FLAG_HIDE_RUBY). OPTIONS: battle style SET, battle scene OFF.
 */
async function afterRainbowPass(game: Game) {
  await afterHallOfFame(game);
  await game.eval((t) => {
    const s = t.state!;
    s.setVar('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F', 5);
    s.setVar('VAR_MAP_SCENE_MT_EMBER_EXTERIOR', 2);
    for (const f of ['FLAG_SYS_SEVII_MAP_4567', 'FLAG_GOT_RUBY', 'FLAG_HIDE_RUBY']) s.setFlag(f, true);
    s.bag.remove(t.define('ITEM_TRI_PASS'), t.itemCount('TRI_PASS'));
    s.bag.add(t.define('ITEM_RAINBOW_PASS'), 1);
    s.battleStyleSet = true;
    s.battleSceneOff = true;
  });
}

/** At map-local (x, y) facing `dir`, press A: the object or bg event there starts. */
async function talk(game: Game, x: number, y: number, dir: 'up' | 'down' | 'left' | 'right') {
  await game.eval(async (t, x, y, dir) => {
    await t.walkTo(x, y);
    await t.face(dir);
  }, x, y, dir);
  await game.press('A');
}

/** The field message box's bytes (the braille has no charmap text for t.message()). */
function messageBytes(game: Game) {
  return game.eval(() => {
    const box = (window as any).game.scene.getScene('Overworld').messageBox;
    return box.visible ? (box.text as number[]) : undefined;
  });
}

/** The metatile id at a map-local cell. */
function metatileAt(game: Game, x: number, y: number) {
  return game.eval((t, x, y) => {
    const f = t.field()!;
    return (window as any).game.scene.getScene('Overworld').world.tileAt(f.worldX - f.x + x, f.worldY - f.y + y).metatile as number;
  }, x, y);
}

const where = (game: Game) => game.eval((t) => [t.field()!.map, t.field()!.x, t.field()!.y]);
const scriptOver = (what: string) => ({ what, ...SCENE });

test("Six Island's Pokémon Center: the rival's scene (VAR_MAP_SCENE_FOUR_ISLAND too)", async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_1F', x: 8, y: 6, party: [CUTTER] });
  await afterRainbowPass(game);
  // In through the door (warp 0 of MAP_SIX_ISLAND_POKEMON_CENTER_1F, (7, 8)): OnTransition shows the rival
  // (clearflag FLAG_HIDE_SIX_ISLAND_POKECENTER_RIVAL), OnFrame's RivalScene runs at VAR 0.
  const since = await game.mark();
  await warp(game, 'MAP_SIX_ISLAND_POKEMON_CENTER_1F', 7, 8);
  await game.mashUntil((t) => t.var('VAR_MAP_SCENE_SIX_ISLAND_POKEMON_CENTER_1F') === 1 && t.idle() && !t.field()!.script, scriptOver("the rival's scene"));
  expect(await scriptsSince(game, since)).toContain('SixIsland_PokemonCenter_1F_EventScript_RivalScene');
  const after = await game.eval((t) => ({
    four: t.var('VAR_MAP_SCENE_FOUR_ISLAND'),
    hidden: t.flag('FLAG_HIDE_SIX_ISLAND_POKECENTER_RIVAL'),
    blue: (t.objects() as { graphicsId: string }[]).some((o) => o.graphicsId === 'OBJ_EVENT_GFX_BLUE'),
  }));
  expect(after).toMatchObject({ four: 1, hidden: true, blue: false });
  // PlayerWatchRivalExit: a step left, then facing right
  expect(await where(game)).toEqual(['SixIsland_PokemonCenter_1F', 6, 8]);
  expect(await game.eval((t) => t.field()!.facing)).toBe('right');
  // MUS_ENCOUNTER_RIVAL (playbgm), then fadedefaultbgm
  const songs = await game.eval((t, s) => t.audioEvents(s).filter((e) => e.type === 'bgm').map((e) => e.name), since);
  expect(songs).toContain('MUS_ENCOUNTER_RIVAL');

  // Back in later: VAR 1, no rival and no scene
  await warp(game, 'MAP_SIX_ISLAND', 11, 12);
  const again = await game.mark();
  await warp(game, 'MAP_SIX_ISLAND_POKEMON_CENTER_1F', 7, 8);
  await game.eval((t) => t.waitFrames(30));
  expect(await scriptsSince(game, again)).not.toContain('SixIsland_PokemonCenter_1F_EventScript_RivalScene');
  expect(await game.eval((t) => (t.objects() as { graphicsId: string }[]).some((o) => o.graphicsId === 'OBJ_EVENT_GFX_BLUE'))).toBe(false);
}, 300_000);

/** Fall through the hole at (x, y) (MB_FALL_WARP: DoFallWarp) and wait for the floor below to settle. */
async function fallTo(game: Game, x: number, y: number, map: string) {
  const since = await game.mark();
  await game.eval((t, x, y) => t.walkTo(x, y), x, y);
  await game.waitForEvent('map', { since, what: map });
  await game.eval((t, m) => t.until(() => t.field()?.map === m && t.idle(), 20000), map);
}

/** Read the braille stone at (6, 5) from (6, 6): its one braillemessage, then waitbuttonpress. */
async function readBraille(game: Game, what: string) {
  await talk(game, 6, 6, 'up');
  await game.eval((t) => t.until(() => (window as any).game.scene.getScene('Overworld').messageBox.visible, 600));
  const bytes = await messageBytes(game);
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what });
  return bytes;
}

/** START → POKéMON → the first mon → its first field move (fieldMoves.test.ts' useFieldMove). */
async function useFirstFieldMove(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // POKéMON
  await game.waitForPartyMenu();
  await game.press('A'); // the mon's action menu
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN'); // past SUMMARY
  await game.eval((t) => t.waitFrames(4));
  await game.press('A');
}

test("Ruin Valley's door (Cut on the braille), the Dotted Hole's floors, the Sapphire and the thief", async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_1F', x: 8, y: 6, party: [CUTTER] });
  await afterRainbowPass(game);

  // The scientist stands in front of the door until Lorelei's scene in Icefall Cave
  // (FourIsland_IcefallCave_Back: setflag FLAG_HIDE_RUIN_VALLEY_SCIENTIST).
  await warp(game, 'MAP_SIX_ISLAND_RUIN_VALLEY', 24, 26);
  let since = await game.mark();
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the scientist' });
  expect(await scriptsSince(game, since)).toEqual(['SixIsland_RuinValley_EventScript_Scientist']);
  await game.eval((t) => t.state!.setFlag('FLAG_HIDE_RUIN_VALLEY_SCIENTIST', true));
  await warp(game, 'MAP_SIX_ISLAND_RUIN_VALLEY', 24, 26);
  const closed = await metatileAt(game, 24, 24);

  // The door from (24, 25): "check the door more thoroughly?" YES, the dots: braillemessage Braille_Text_Cut
  // (C = dots 1-4: 0x03, U = 1-3-6: 0x31, T = 2-3-4-5: 0x1E), waitbuttonpress
  since = await game.mark();
  await talk(game, 24, 25, 'up');
  expect(await game.mashUntil(() => {
    const box = (window as any).game.scene.getScene('Overworld').messageBox;
    return box.visible && box.text[0] === 0x03 && (box.text as number[]).slice();
  }, { what: 'the braille on the door' })).toEqual([0x03, 0x31, 0x1e, 0xff]);
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the door' });
  expect(await scriptsSince(game, since)).toEqual(['SixIsland_RuinValley_EventScript_DottedHoleDoor']);
  expect(await metatileAt(game, 24, 24)).toBe(closed);

  // CUT from the party menu at (24, 25) facing north: CutMoveRuinValleyCheck → FLDEFF_USE_CUT_ON_GRASS's banner,
  // then CutMoveOpenDottedHoleDoor (the open door metatile, SE_BANG, FLAG_USED_CUT_ON_RUIN_VALLEY_BRAILLE)
  since = await game.mark();
  await useFirstFieldMove(game);
  await game.waitForEvent('fieldMoveShowMon', { since });
  await game.waitFor((t) => t.flag('FLAG_USED_CUT_ON_RUIN_VALLEY_BRAILLE') && t.idle() && t.gbaScreen() === undefined, { what: 'the door to open' });
  const open = await game.eval((t) => t.define('METATILE_SeviiIslands67_DottedHoleDoor_Open'));
  expect(await metatileAt(game, 24, 24)).toBe(open);
  expect(await game.eval((t, s) => t.audioEvents(s).filter((e) => e.type === 'se').map((e) => e.name), since)).toContain('SE_BANG');
  // No grass cut (FLDEFF_CUT_GRASS isn't started)
  expect(await game.eval((t, s) => t.events(s).some((e) => e.type === 'cutGrass'), since)).toBe(false);

  // Back later: OnLoad's setmetatile keeps it open
  await warp(game, 'MAP_SIX_ISLAND_WATER_PATH', 12, 90);
  await warp(game, 'MAP_SIX_ISLAND_RUIN_VALLEY', 24, 25);
  expect(await metatileAt(game, 24, 24)).toBe(open);

  // In through the door: the Dotted Hole's 1F (setworldmapflag FLAG_WORLD_MAP_SIX_ISLAND_DOTTED_HOLE_1F)
  since = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since, what: 'SixIsland_DottedHole_1F' });
  await game.eval((t) => t.until(() => t.field()?.map === 'SixIsland_DottedHole_1F' && t.idle(), 20000));
  expect(await where(game)).toEqual(['SixIsland_DottedHole_1F', 6, 9]);
  expect(await game.eval((t) => t.flag('FLAG_WORLD_MAP_SIX_ISLAND_DOTTED_HOLE_1F'))).toBe(true);

  // The floors: each one's braille names the hole that leads on (B1F UP, B2F LEFT, B3F RIGHT, B4F DOWN); the
  // others drop back to 1F (6, 7).
  await fallTo(game, 6, 5, 'SixIsland_DottedHole_B1F');
  expect(await where(game)).toEqual(['SixIsland_DottedHole_B1F', 6, 7]);
  expect(await readBraille(game, 'B1F')).toEqual([0x31, 0x17, 0xff]); // UP
  await fallTo(game, 6, 9, 'SixIsland_DottedHole_1F'); // the wrong way
  expect(await where(game)).toEqual(['SixIsland_DottedHole_1F', 6, 7]);
  await fallTo(game, 6, 5, 'SixIsland_DottedHole_B1F');
  await fallTo(game, 6, 1, 'SixIsland_DottedHole_B2F');
  expect(await where(game)).toEqual(['SixIsland_DottedHole_B2F', 6, 7]);
  expect(await readBraille(game, 'B2F')).toEqual([0x15, 0x09, 0x07, 0x1e, 0xff]); // LEFT
  await fallTo(game, 1, 5, 'SixIsland_DottedHole_B3F');
  expect(await readBraille(game, 'B3F')).toEqual([0x1d, 0x06, 0x0f, 0x0d, 0x1e, 0xff]); // RIGHT
  await fallTo(game, 11, 5, 'SixIsland_DottedHole_B4F');
  expect(await readBraille(game, 'B4F')).toEqual([0x0b, 0x19, 0x2e, 0x1b, 0xff]); // DOWN
  await fallTo(game, 6, 9, 'SixIsland_DottedHole_SapphireRoom');
  expect(await where(game)).toEqual(['SixIsland_DottedHole_SapphireRoom', 5, 9]);

  // The braille on the north wall (7, 2): sixteen messages, LET THE TWO ... FOR YOU.
  await talk(game, 7, 3, 'up');
  await game.eval((t) => t.until(() => (window as any).game.scene.getScene('Overworld').messageBox.visible, 600));
  expect(await messageBytes(game)).toEqual([0x15, 0x09, 0x1e, 0x00, 0x1e, 0x0d, 0x09, 0x00, 0x1e, 0x2e, 0x19, 0xff]); // LET THE TWO
  const last = await game.mashUntil(() => {
    const box = (window as any).game.scene.getScene('Overworld').messageBox;
    return box.visible && box.text[0] === 0x07 && box.text[1] === 0x19 && (box.text as number[]).slice();
  }, { what: 'FOR YOU.' });
  expect(last).toEqual([0x07, 0x19, 0x1d, 0x00, 0x3b, 0x19, 0x31, 0x2c, 0xff]);
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the wall braille' });

  // The Sapphire (7, 7), from (7, 8) facing north. Watched every tick: the thief (OBJ_EVENT_GFX_SCIENTIST) and the
  // camera pan, from the talk to the end.
  await game.eval(async (t) => {
    await t.walkTo(7, 8);
    await t.face('up');
  });
  const watch = game.watch((t) => {
    const w = ((window as any).__sapphire ??= []) as { y: number; moving: boolean; frame: number; panX: number; panY: number }[];
    const f = t.field();
    const thief = (t.objects() as { graphicsId: string; y: number; moving: boolean; frame: number }[]).find((o) => o.graphicsId === 'OBJ_EVENT_GFX_SCIENTIST');
    if (f && thief) w.push({ y: thief.y, moving: thief.moving, frame: thief.frame, panX: f.avatar.cameraPanX, panY: f.avatar.cameraPanY });
    return t.flag('FLAG_LEARNED_YES_NAH_CHANSEY') && t.idle() && !f!.script && w;
  }, { what: 'the thief', maxFrames: 30000 });
  since = await game.mark();
  await game.press('A');
  await game.mashUntil((t) => t.flag('FLAG_LEARNED_YES_NAH_CHANSEY') && t.idle() && !t.field()!.script, scriptOver('the Sapphire scene'));
  const samples = (await watch) as { y: number; moving: boolean; frame: number; panX: number; panY: number }[];
  // ThiefFallIn: face_down, disable_anim, slide_down x9 from (5, 0) to (5, 9), restore_anim. The slide keeps the
  // standing frame (objectEvent->inanimate); the walks after it animate again.
  const landed = samples.findIndex((w) => w.y === 9 && !w.moving);
  const fall = samples.slice(0, landed + 1);
  expect(fall[0].y).toBe(0);
  expect(fall.filter((w) => w.moving).length).toBeGreaterThan(9 * 4);
  expect(new Set(fall.map((w) => w.frame))).toEqual(new Set([fall[0].frame]));
  expect(new Set(samples.slice(landed).filter((w) => w.moving).map((w) => w.frame)).size).toBeGreaterThan(1);
  // ShakeScreen with VAR_0x8004 3 (vertical), 0x8005 0, 0x8006 12 flips, 0x8007 3 frames: the view moves 3 px
  // up / down every 3 frames; the 12th flip goes straight back to the standard pan.
  expect(samples.every((w) => w.panX === 0)).toBe(true);
  const runs: number[][] = [];
  let run: number[] | undefined;
  for (const w of samples) {
    if (w.panY !== 0) (run ??= []).push(w.panY);
    else if (run) runs.push(run), (run = undefined);
  }
  expect(runs).toEqual([Array.from({ length: 11 * 3 }, (_, i) => (Math.floor(i / 3) % 2 ? 3 : -3))]);
  // playse SE_FALL, SE_M_STRENGTH (the landing, and ShakeScreen's own), SE_EXIT
  const ses = await game.eval((t, s) => t.audioEvents(s).filter((e) => e.type === 'se').map((e) => e.name), since);
  expect(ses.filter((n) => ['SE_FALL', 'SE_M_STRENGTH', 'SE_EXIT'].includes(n))).toEqual(['SE_FALL', 'SE_M_STRENGTH', 'SE_M_STRENGTH', 'SE_EXIT']);
  // The thief took the Sapphire (removeobject LOCALID_SAPPHIRE) and left; the password learned
  const after = await game.eval((t) => ({
    objects: (t.objects() as { graphicsId: string }[]).map((o) => o.graphicsId),
    sapphire: t.itemCount('SAPPHIRE'),
    flags: ['FLAG_HIDE_SAPPHIRE', 'FLAG_HIDE_DOTTED_HOLE_SCIENTIST', 'FLAG_LEARNED_YES_NAH_CHANSEY'].map((f) => t.flag(f)),
  }));
  expect(after).toEqual({ objects: [], sapphire: 0, flags: [true, true, true] });
  expect(await scriptsSince(game, since)).toEqual(['SixIsland_DottedHole_SapphireRoom_EventScript_Sapphire']);
  // (ThiefExitNorth / PlayerWatchThiefExit: the player looks right after him)
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y, t.field()!.facing])).toEqual([7, 8, 'right']);
}, 600_000);

/** Mash until the message matches `re` (t.message()), returning it. */
async function untilMessage(game: Game, re: RegExp, what: string): Promise<string> {
  await game.eval((_t, src, flags) => ((window as any).__sixRe = new RegExp(src, flags)), re.source, re.flags);
  return (await game.mashUntil((t) => (window as any).__sixRe.test(t.message() ?? '') && t.message(), { what })) as string;
}

/** ChoosePartyMon's menu: once it takes input, party slot `slot`, A. */
async function choosePartyMon(game: Game, slot: number, what: string) {
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu' && !t.paletteFadeActive(), { what });
  for (let i = 0; i < slot; i++) {
    await game.press('DOWN');
    await game.eval((t) => t.waitFrames(4));
  }
  await game.press('A');
}

const scriptDone = (game: Game, what: string) => game.mashUntil((t) => t.idle() && !t.field()!.script, { what, button: 'B' });

test("The Water Path house's Heracross record (CompareHeracrossSize, GetHeracrossSizeRecordInfo)", async () => {
  const game = await session.start({ start: 'after-rival', map: 'SixIsland_WaterPath_House1', x: 3, y: 5, party: [CUTTER] });
  await afterRainbowPass(game);
  // The chart on the wall (9, 1) is blank until a record is set
  await talk(game, 9, 2, 'up');
  await untilMessage(game, /blank chart/, 'the blank chart');
  await scriptDone(game, 'the chart');
  // No Heracross in the party (DoesPlayerPartyContainSpecies)
  await talk(game, 3, 5, 'up');
  await untilMessage(game, /Love it, need it/, 'no Heracross');
  await scriptDone(game, 'no Heracross');

  // Two Heracross. Sizes from GetMonSizeHash (personality 0x12345678): all IVs 31 → 0x7856, 1480 mm, 58.2 in;
  // IVs 3/5/6/2/1/7 → 0x715a, 1462 mm, 57.5 in (tests/unit/pokemonSizeRecord.test.ts works them by hand).
  await game.eval((t) => {
    t.setParty([
      { species: 'HERACROSS', level: 30, moves: ['HORN_ATTACK'] },
      { species: 'HERACROSS', level: 30, moves: ['HORN_ATTACK'] },
    ]);
    const [big, small] = t.state!.party;
    big.personality = small.personality = 0x12345678;
    big.ivs = { hp: 31, attack: 31, defense: 31, speed: 31, spAttack: 31, spDefense: 31 };
    small.ivs = { hp: 3, attack: 5, defense: 6, speed: 2, spAttack: 1, spDefense: 7 };
  });

  // The smaller one first: a bigger one than the empty record (17.1 in): ShownBigHeracross, the Nest Ball
  await talk(game, 3, 5, 'up');
  await untilMessage(game, /may I measure/, 'the beauty asks');
  await choosePartyMon(game, 1, "the beauty's party menu");
  await untilMessage(game, /it.s 57\.5 inches!/, 'the first record');
  await scriptDone(game, 'the Nest Ball');
  expect(await game.eval((t) => [t.var('VAR_HERACROSS_SIZE_RECORD'), t.flag('FLAG_GOT_NEST_BALL_FROM_WATER_PATH_HOUSE_1'), t.itemCount('NEST_BALL')])).toEqual([0x715a, true, 1]);

  // The bigger one: a new record (CompareMonSize 3); ShownBigHeracross gives a Nest Ball for every new record
  await talk(game, 3, 5, 'up');
  await choosePartyMon(game, 0, "the beauty's party menu");
  await untilMessage(game, /it.s 58\.2 inches!/, 'the new record');
  await scriptDone(game, 'the new record');
  expect(await game.eval((t) => [t.var('VAR_HERACROSS_SIZE_RECORD'), t.itemCount('NEST_BALL')])).toEqual([0x7856, 2]);

  // The smaller one again: smaller than the record (2), which stays
  await talk(game, 3, 5, 'up');
  await choosePartyMon(game, 1, "the beauty's party menu");
  await untilMessage(game, /just 57\.5 inches/, 'smaller');
  await untilMessage(game, /It was 58\.2 inches/, 'the record (STR_VAR_3)');
  await scriptDone(game, 'smaller');
  // The same one as the record: the same (4)
  await talk(game, 3, 5, 'up');
  await choosePartyMon(game, 0, "the beauty's party menu");
  await untilMessage(game, /58\.2-inch measurement/, 'the same');
  await scriptDone(game, 'the same');
  expect(await game.eval((t) => t.var('VAR_HERACROSS_SIZE_RECORD'))).toBe(0x7856);

  // The chart: GetHeracrossSizeRecordInfo's STR_VAR_3
  await talk(game, 9, 2, 'up');
  await untilMessage(game, /58\.2 inches!/, 'the chart');
  await scriptDone(game, 'the chart');
}, 300_000);
