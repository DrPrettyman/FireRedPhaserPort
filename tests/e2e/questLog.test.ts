// The quest log's recording (world/questLog*.ts, QUEST_LOG_PLAN.md QL1): leaving a building starts a scene
// (QL_EVENT_DEPARTED), the field records the player's steps, saving closes the scene into the save; a script's
// `special QuestLog_CutRecording` ends a scene; nothing is recorded in a disabled location (the trainer fan club),
// and walking into one cuts the recording. Its playback (world/questLogPlayback.ts, QL2a): CONTINUE plays the saved
// scenes (the player and the NPCs move as recorded, the scene's flags, empty bag and party count in effect), A skips
// a scene, B skips to the end, and afterwards the field is the saved one.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** START → SAVE → YES (a new file: no overwrite question), then wait for the field. */
async function save(game: Game): Promise<void> {
  await game.waitIdle();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  const downs = (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length;
  await game.pressTimes('DOWN', downs);
  await game.press('A');
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press('UP');
  await game.press('A');
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
}

/** The save slot's contents (parsed), straight from localStorage. */
const savedGame = (game: Game) => game.eval(() => JSON.parse(localStorage.getItem('firered-phaser:save') ?? 'null'));

const QL = (game: Game) => game.eval((t) => t.questLog());

test('leaving the house starts a scene; the steps are recorded; saving closes it into the save', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_1F', x: 4, y: 8 });
  await game.waitIdle();
  expect((await QL(game)).state).toBe(0);
  // The dev start loaded the house like a warp: QuestLog_CheckDepartingIndoorsMap remembered it
  expect(await game.eval((t) => [t.flag('FLAG_SYS_QL_DEPARTED'), t.var('VAR_QL_ENTRANCE')])).toEqual([true, 0]);
  await game.eval((t) => t.enterWarp());
  await game.waitIdle();
  const d = (name: string) => game.eval((t, n) => t.define(n), name);
  const [RECORDING, START_WARP, DEPARTED, MOVEMENT, INPUT, WAIT, SCENE_END, HOME, MAPSEC, FACE_DOWN, WALK_RIGHT, LOCALID_PLAYER] = await Promise.all(
    [
      'QL_STATE_RECORDING',
      'QL_START_WARP',
      'QL_EVENT_DEPARTED',
      'QL_EVENT_MOVEMENT',
      'QL_EVENT_INPUT',
      'QL_EVENT_WAIT',
      'QL_EVENT_SCENE_END',
      'QL_LOCATION_HOME',
      'MAPSEC_PALLET_TOWN',
      'MOVEMENT_ACTION_FACE_DOWN',
      'MOVEMENT_ACTION_WALK_NORMAL_RIGHT',
      'LOCALID_PLAYER',
    ].map(d),
  );
  let ql = await QL(game);
  expect(ql.state).toBe(RECORDING);
  expect(ql.currentSceneNum).toBe(0);
  // The scene starts where the warp put the player: Pallet Town's warp 0, the door at (6, 7)
  expect(ql.scenes[0]).toMatchObject({ startType: START_WARP, map: 'MAP_PALLET_TOWN', warpId: 0, x: 6, y: 7 });
  expect(ql.scenes[0].objects[0]).toMatchObject({ localId: LOCALID_PLAYER, isPlayer: 1, x: 6 + 7, y: 7 + 7 });
  expect(ql.scenes[0].objects.length).toBeGreaterThan(1); // Pallet Town's people
  expect(ql.scenes[0].commands.slice(0, 3).map((c) => c.words)).toEqual([
    [MOVEMENT, 0, 0, FACE_DOWN << 8], // the arrival's facing
    [INPUT, 0, 0, 0],
    [DEPARTED, 2, MAPSEC | (HOME << 8)],
  ]);
  expect(await game.eval((t) => t.flag('FLAG_SYS_QL_DEPARTED'))).toBe(false);

  await game.walk('right', 3);
  ql = await QL(game);
  expect(ql.state).toBe(RECORDING);
  const steps = ql.scenes[0].commands.filter((c) => c.id === MOVEMENT && (c.words[2] & 0xff) === 0 && c.words[3] >> 8 === WALK_RIGHT);
  expect(steps.length).toBe(3);
  // a step's duration counts the frames since the last action; the second and third steps follow the first
  expect(steps.slice(1).every((s) => s.words[1] > 0 && s.words[1] <= 16)).toBe(true);

  await save(game);
  ql = await QL(game);
  expect(ql.state).toBe(0);
  expect(ql.currentSceneNum).toBe(1);
  const saved = await savedGame(game);
  expect(saved.version).toBeGreaterThanOrEqual(12); // 12 brought the scenes
  expect(saved.questLog.length).toBe(4);
  const scene = saved.questLog[0];
  expect(scene).toMatchObject({ startType: START_WARP, mapGroup: 3, mapNum: 0, warpId: 0, x: 6, y: 7 });
  expect(saved.questLog.slice(1).every((s: { startType: number }) => s.startType === 0)).toBe(true);
  // The saved script is the recorded one: the departure, the steps, START's input, then the cut's wait and the end
  const savedCmds = ql.scenes[0].commands;
  expect(scene.script).toEqual(ql.scenes[0].script);
  expect(savedCmds.slice(-3).map((c) => c.id)).toEqual([INPUT, WAIT, SCENE_END]);
  expect(savedCmds.at(-2)!.words).toEqual([WAIT, 1]);
  // the START press that opened the save: QL_RecordFieldInput drops START (& 0x00FF00F3), the d-pad was idle
  expect(savedCmds.at(-3)!.words.slice(2)).toEqual([0, 0]);
});

test('a script cuts the recording (Daisy grooming: special QuestLog_CutRecording)', async () => {
  // After the rival battle, Daisy stands at her table (5, 4) facing right (PalletTown_RivalsHouse_OnTransition).
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_RivalsHouse', x: 6, y: 4 });
  await game.waitIdle();
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_GAME_CLEAR')); // her grooming offer, which cuts first
  // A scene starts as a QL3 event would start one (here QL_EVENT_ARRIVED, standing in place)
  await game.eval((t) => t.questLogEvent('QL_EVENT_ARRIVED', { mapSec: t.define('MAPSEC_PALLET_TOWN') }));
  const [RECORDING, START_NORMAL, WAIT, SCENE_END] = await game.eval((t) =>
    ['QL_STATE_RECORDING', 'QL_START_NORMAL', 'QL_EVENT_WAIT', 'QL_EVENT_SCENE_END'].map((n) => t.define(n)),
  );
  let ql = await QL(game);
  expect(ql.state).toBe(RECORDING);
  expect(ql.scenes[0]).toMatchObject({ startType: START_NORMAL, map: 'MAP_PALLET_TOWN_RIVALS_HOUSE', x: 6, y: 4 });
  await game.eval((t) => t.face('left'));
  // Talk to her and watch, in the page, for the cut while her script runs
  const cut = game.eval((t) => t.until(() => t.field()?.script && t.questLog().state === 0, 600));
  await game.press('A');
  expect(await cut).toBe(true);
  ql = await QL(game);
  expect(ql.currentSceneNum).toBe(1);
  expect(ql.scenes[0].commands.slice(-2).map((c) => c.words)).toEqual([[WAIT, 1], [SCENE_END]]);
  await game.mashUntil((t) => t.idle(), { button: 'B', what: "Daisy's script to end" });
  expect((await QL(game)).state).toBe(0);
});

test('a disabled location records nothing, and walking into one cuts the recording', async () => {
  // The trainer fan club's door in Saffron City is at (47, 21)
  const game = await session.start({ start: 'after-rival', map: 'SaffronCity', x: 47, y: 22 });
  await game.waitIdle();
  await game.eval((t) => t.questLogEvent('QL_EVENT_ARRIVED', { mapSec: t.define('MAPSEC_SAFFRON_CITY') }));
  const RECORDING = await game.eval((t) => t.define('QL_STATE_RECORDING'));
  expect((await QL(game)).state).toBe(RECORDING);
  const r = await game.eval((t) => t.walkTo(47, 21));
  expect(r.interrupted).toBe(true); // the door warp
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.map)).toBe('SaffronCity_PokemonTrainerFanClub');
  let ql = await QL(game);
  expect(ql.state).toBe(0); // QuestLog_ShouldEndSceneOnMapChange cut it
  expect(ql.currentSceneNum).toBe(1);
  // In here, an event starts nothing
  await game.eval((t) => t.questLogEvent('QL_EVENT_ARRIVED', { mapSec: t.define('MAPSEC_SAFFRON_CITY') }));
  await game.walk('up');
  ql = await QL(game);
  expect(ql.state).toBe(0);
  expect(ql.scenes[1].startType).toBe(0);
  await save(game);
  const saved = await savedGame(game);
  expect(saved.questLog.filter((s: { startType: number }) => s.startType !== 0).length).toBe(1);
});

// ------------------------------------------------------------------ playback

const SAVE_KEY = 'firered-phaser:save';
/** The save the first playback test records (two scenes), reused by the skip test. */
let twoScenesSave: string | undefined;
/** Where the scenes ended when they were recorded: the player and the objects, map-local. */
let recordedEnds: { player: { x: number; y: number }; objects: { localId: number; x: number; y: number }[] }[] = [];

const cutRecording = (game: Game) =>
  game.eval(async (t) => {
    const m = await new Function("return import('/src/world/questLog.ts')")();
    m.QuestLog_CutRecording();
    const f = t.field()!;
    return { player: { x: f.x, y: f.y }, objects: t.objects().map((o) => ({ localId: o.localId, x: o.x, y: o.y })) };
  });

/** What the field holds that playback must not keep. */
const fieldState = (game: Game) =>
  game.eval((t) => ({
    field: { map: t.field()!.map, x: t.field()!.x, y: t.field()!.y, facing: t.field()!.facing },
    party: t.party().map((m) => m.species),
    potions: t.itemCount('POTION'),
    flags: t.snapshot().flags,
    badge: t.flag('FLAG_BADGE01_GET'),
  }));

/** The main menu up, then CONTINUE. */
async function continueGame(game: Game): Promise<void> {
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading, { what: 'the main menu' });
  await game.press('A');
}

test('CONTINUE plays the saved scenes back, then the field is the saved one', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_1F', x: 4, y: 8 });
  await game.waitIdle();
  await game.eval((t) => t.setParty([{ species: 'BULBASAUR', level: 5 }, { species: 'PIDGEY', level: 3 }]));
  // Scene 0 (QL_START_WARP): leave the house, three steps right; Pallet Town's people wander meanwhile
  await game.eval((t) => t.enterWarp());
  await game.waitIdle();
  await game.walk('right', 3);
  const LOCALID_PLAYER = await game.eval((t) => t.define('LOCALID_PLAYER'));
  const MOVEMENT = await game.eval((t) => t.define('QL_EVENT_MOVEMENT'));
  // wait for an NPC's recorded step (or the scene filling up and ending itself)
  const npcStep = await game.eval(
    (t, MOVEMENT) =>
      t.until(() => t.questLog().state === 0 || t.questLog().scenes[0].commands.some((c) => c.id === MOVEMENT && (c.words[2] & 0xff) !== 0), 3000),
    MOVEMENT,
  );
  expect(npcStep).toBe(true);
  const end0 = await cutRecording(game);
  let ql = await QL(game);
  expect(ql.scenes[0].commands.some((c) => c.id === MOVEMENT && (c.words[2] & 0xff) !== 0 && (c.words[2] & 0xff) !== LOCALID_PLAYER)).toBe(true);
  expect(ql.currentSceneNum).toBe(1);
  // Scene 1 (QL_START_NORMAL, standing in place) with the first badge set, two steps left
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE01_GET'));
  await game.eval((t) => t.questLogEvent('QL_EVENT_ARRIVED', { mapSec: t.define('MAPSEC_PALLET_TOWN') }));
  ql = await QL(game);
  expect(ql.scenes[1]).toMatchObject({ startType: await game.eval((t) => t.define('QL_START_NORMAL')), map: 'MAP_PALLET_TOWN' });
  await game.walk('left', 2);
  // What the save holds differs from the scenes: no badge, three potions, one mon
  await game.eval((t) => {
    t.state!.setFlag('FLAG_BADGE01_GET', false);
    t.state!.bag.add(t.define('ITEM_POTION'), 3);
  });
  await game.eval((t) => t.setParty([{ species: 'BULBASAUR', level: 5 }]));
  await save(game);
  const end1 = (await game.eval((t) => ({ player: { x: t.field()!.x, y: t.field()!.y } }))) as (typeof recordedEnds)[number];
  const saved = await fieldState(game);
  expect(saved.party.length).toBe(1);
  twoScenesSave = await game.eval((_t, key) => localStorage.getItem(key)!, SAVE_KEY);
  recordedEnds = [end0, end1];
  expect(JSON.parse(twoScenesSave).questLog.filter((sc: { startType: number }) => sc.startType !== 0).length).toBe(2);

  await game.load({ keepSave: true, mainMenu: true });
  const [PLAYBACK, PLAYBACK_LAST] = await game.eval((t) => [t.define('QL_STATE_PLAYBACK'), t.define('QL_STATE_PLAYBACK_LAST')]);
  // Watch the whole playback in the page: each scene's start (its flags, bag, party) and end (the positions)
  type Seen = { flag: boolean; potions: number; party: string[]; map: string };
  type End = { player: { x: number; y: number }; objects: { localId: number; x: number; y: number }[] };
  const watch = game.eval(
    async (t, PLAYBACK, PLAYBACK_LAST) => {
      const start: Record<number, Seen> = {};
      const end: Record<number, End> = {};
      let last = false;
      const ok = await t.until(() => {
        const f = t.field();
        if (!f) return false; // (the main menu)
        const ql = t.questLog();
        const n = ql.currentSceneNum;
        if (ql.state === PLAYBACK && !f.busy && ql.playback.control.state === 0 && ql.playback.control.endMode === 0 && !start[n]) {
          start[n] = { flag: t.flag('FLAG_BADGE01_GET'), potions: t.itemCount('POTION'), party: t.party().map((m) => m.species ?? ''), map: f.map };
        }
        // (AdvancePlayhead moves on to the next scene with endMode still SCENE, as its map starts loading)
        if (ql.state === PLAYBACK && ql.playback.control.endMode === 2 && !f.busy && !end[n]) {
          end[n] = { player: { x: f.x, y: f.y }, objects: t.objects().map((o) => ({ localId: o.localId, x: o.x, y: o.y })) };
        }
        if (ql.state === PLAYBACK_LAST) last = true;
        return last && !ql.playback.active;
      }, 30000);
      return { ok, start, end };
    },
    PLAYBACK,
    PLAYBACK_LAST,
  );
  await continueGame(game);
  const seen = await watch;
  expect(seen.ok).toBe(true);
  // The scenes' state: the badge only in scene 1, the bag empty, the party as many as when recorded (two: a
  // placeholder Rattata for the missing one, QL_ResetPartyAndPC)
  const party = [...saved.party, 'RATTATA'];
  expect(seen.start[0]).toEqual({ flag: false, potions: 0, party, map: 'PalletTown' });
  expect(seen.start[1]).toEqual({ flag: true, potions: 0, party, map: 'PalletTown' });
  // The player and the people end each scene where they were when it was recorded
  expect(seen.end[0].player).toEqual(end0.player);
  const byId = (objs: { localId: number; x: number; y: number }[]) => Object.fromEntries(objs.map((o) => [o.localId, [o.x, o.y]]));
  expect(byId(seen.end[0].objects)).toEqual(byId(end0.objects));
  expect(seen.end[1].player).toEqual(end1.player);
  // "saved the game at" (QL2b draws it) was asked for, then the field is the player's again
  expect((await QL(game)).playback.screenCalls).toContain('drawSavedGameText');
  await game.waitIdle();
  expect(await fieldState(game)).toEqual(saved);
  expect((await QL(game)).state).toBe(0);
  // The next scene goes after the two saved ones (sCurrentSceneNum as QuestLog_AdvancePlayhead left it)
  expect((await QL(game)).currentSceneNum).toBe(2);
});

test('during playback, A skips to the next scene and B to the end', async () => {
  expect(twoScenesSave).toBeDefined();
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 6, y: 8 });
  await game.eval((_t, key, json) => localStorage.setItem(key, json), SAVE_KEY, twoScenesSave!);
  await game.load({ keepSave: true, mainMenu: true });
  const PLAYBACK = await game.eval((t) => t.define('QL_STATE_PLAYBACK'));
  const running = async (n: number) =>
    expect(
      await game.eval(
        (t, n, PLAYBACK) =>
          t.until(() => {
            if (!t.field()) return false; // (the main menu)
            const ql = t.questLog();
            return ql.state === PLAYBACK && ql.currentSceneNum === n && !t.field()?.busy && ql.playback.control.state === 0 && ql.playback.control.endMode === 0;
          }, 20000),
        n,
        PLAYBACK,
      ),
    ).toBe(true);
  await continueGame(game);
  await running(0);
  // A: the scene ends at once (its actions stop) and scene 1 loads
  const actionsLeft = await game.eval((t) => t.questLog().curActionIdx);
  await game.press('A');
  await running(1);
  expect(actionsLeft).toBeLessThan(10); // scene 0 hadn't played through
  // B: straight to the end, without "saved the game at" (Task_QuestLogScene_SavedGame), with the map's name
  const since = await game.eval((t) => t.events().length);
  await game.press('B');
  await game.waitForEvent('mapNamePopupText', { since, timeout: 60_000 });
  await game.waitIdle();
  const ql = await QL(game);
  expect(ql.state).toBe(0);
  expect(ql.playback.screenCalls).not.toContain('drawSavedGameText');
  const after = await fieldState(game);
  expect(after).toMatchObject({ field: { map: 'PalletTown' }, potions: 3, badge: false });
  expect(after.party.length).toBe(1);
});

test("QL3a's events go into the scene's stream as the C lays them out, and the save keeps them", async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 6, y: 8 });
  await game.waitIdle();
  const d = (name: string) => game.eval((t, n) => t.define(n), name);
  const [DEPOSITED, MOVED, CENTER, POTION, ANTIDOTE, PIDGEY] = await Promise.all(
    ['QL_EVENT_DEPOSITED_ITEM_PC', 'QL_EVENT_MOVED_MON_BETWEEN_BOXES', 'QL_EVENT_USED_PKMN_CENTER', 'ITEM_POTION', 'ITEM_ANTIDOTE', 'SPECIES_PIDGEY'].map(d),
  );
  // (the events SetQuestLogEvent keeps before the Hall of Fame and FLAG_SYS_CAN_LINK_WITH_RS)
  await game.eval(
    (t, [potion, antidote, pidgey]) => {
      t.questLogEvent('QL_EVENT_DEPOSITED_ITEM_PC', { itemId: potion });
      t.questLogEvent('QL_EVENT_DEPOSITED_ITEM_PC', { itemId: antidote }); // a repeat at the same action index
      t.questLogEvent('QL_EVENT_MOVED_MON_BETWEEN_BOXES', { species1: pidgey, box1: 0, box2: 3 });
      t.questLogEvent('QL_EVENT_USED_PKMN_CENTER', null);
    },
    [POTION, ANTIDOTE, PIDGEY],
  );
  const ql = await QL(game);
  const events = ql.scenes[0].commands.filter((c) => [DEPOSITED, MOVED, CENTER].includes(c.id));
  const idx = events[0].words[1];
  expect(events.map((c) => c.words)).toEqual([
    [DEPOSITED | (1 << 12), idx, POTION, ANTIDOTE],
    [MOVED, idx, PIDGEY, 0 | (3 << 8)],
    [CENTER, idx],
  ]);
  await save(game);
  const saved = await savedGame(game);
  expect(saved.questLog[0].script).toEqual((await QL(game)).scenes[0].script);
  const savedEvents = (await QL(game)).scenes[0].commands.filter((c) => [DEPOSITED, MOVED, CENTER].includes(c.id));
  expect(savedEvents.map((c) => c.words)).toEqual(events.map((c) => c.words));
});

test("QL3b's events: a field move ends the preset's scene, a story item starts one, a shop goes into it; each plays back its line", async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity', x: 20, y: 20 });
  await game.waitIdle();
  const d = (name: string) => game.eval((t, n) => t.define(n), name);
  const [STORY, BOUGHT, FIELD_MOVE, SCENE_END, TOWN_MAP, POTION, BULBASAUR, CUT, VIRIDIAN] = await Promise.all(
    [
      'QL_EVENT_OBTAINED_STORY_ITEM',
      'QL_EVENT_BOUGHT_ITEM',
      'QL_EVENT_USED_FIELD_MOVE',
      'QL_EVENT_SCENE_END',
      'ITEM_TOWN_MAP',
      'ITEM_POTION',
      'SPECIES_BULBASAUR',
      'FIELD_MOVE_CUT',
      'MAPSEC_VIRIDIAN_CITY',
    ].map(d),
  );
  // The preset is recording the scene that leaving the house started.
  expect((await QL(game)).state).toBe(await d('QL_STATE_RECORDING'));
  // (all three are kept before the Hall of Fame; a field move only inside a scene, a story item only outside one)
  await game.eval(
    (t, [townMap, potion, bulbasaur, cut, viridian]) => {
      t.questLogEvent('QL_EVENT_USED_FIELD_MOVE', { species: bulbasaur, fieldMove: cut, mapSec: viridian });
      t.questLogEvent('QL_EVENT_OBTAINED_STORY_ITEM', { itemId: townMap, mapSec: viridian });
      t.questLogEvent('QL_EVENT_BOUGHT_ITEM', { lastItemId: potion, itemQuantity: 4, totalMoney: 1200, mapSec: viridian, hasMultipleTransactions: false });
    },
    [TOWN_MAP, POTION, BULBASAUR, CUT, VIRIDIAN],
  );
  const ql = await QL(game);
  const sceneOf = (id: number) => ql.scenes.findIndex((s) => s.commands.some((c) => c.id === id));
  const fieldScene = sceneOf(FIELD_MOVE);
  const storyScene = sceneOf(STORY);
  expect(fieldScene).toBeGreaterThanOrEqual(0);
  expect(storyScene).toBe(fieldScene + 1);
  expect(ql.scenes[fieldScene].commands.at(-1)!.id).toBe(SCENE_END); // the field move ended it (STEP_RECORDING_MODE_DISABLED)
  const words = (scene: number, id: number) => ql.scenes[scene].commands.find((c) => c.id === id)!.words.slice(2);
  expect(words(fieldScene, FIELD_MOVE)).toEqual([BULBASAUR, CUT | (VIRIDIAN << 8)]);
  expect(words(storyScene, STORY)).toEqual([TOWN_MAP, VIRIDIAN]);
  expect(words(storyScene, BOUGHT)).toEqual([POTION, 4, 0, 1200, VIRIDIAN | (1 << 8)]);
  const line = (scene: number, event: string) => game.eval((t, [s, e]) => t.questLogEventLine(s, e), [scene, event] as [number, string]);
  expect(await line(fieldScene, 'QL_EVENT_USED_FIELD_MOVE')).toBe('BULBASAUR used the Hidden Move CUT here.');
  expect(await line(storyScene, 'QL_EVENT_OBTAINED_STORY_ITEM')).toMatch(/^Here in VIRIDIAN CITY, \S+ obtained the item TOWN MAP\.$/);
  expect(await line(storyScene, 'QL_EVENT_BOUGHT_ITEM')).toBe('Went to the POKéMON MART in VIRIDIAN CITY and spent ¥1200 for items including POTION(s).');
});

// ------------------------------------------------------------------ QL4a: the menus' calls

/** In the page: gStringVar4 (menus/common.ts) up to its EOS. */
const stringVar4 = (game: Game) =>
  game.eval(async () => {
    const m = await new Function("return import('/src/menus/common.ts')")();
    const s = m.gStringVar4 as number[];
    return s.slice(0, s.indexOf(0xff) + 1);
  });

/** The index of the first scene with an `event` command (or -1). */
const sceneWith = async (game: Game, event: string) => {
  const [ql, id] = await Promise.all([QL(game), game.eval((t, e) => t.define(e), event)]);
  return ql.scenes.findIndex((s) => s.commands.some((c) => c.id === id));
};

/** The line `event` plays back (QL_LoadEvent → gStringVar4) and its encoded bytes; the event must be recorded. */
async function eventLine(game: Game, event: string): Promise<{ line: string; bytes: number[] }> {
  const scene = await sceneWith(game, event);
  expect(scene, `${event} in a scene`).toBeGreaterThanOrEqual(0);
  const line = await game.eval((t, [s, e]) => t.questLogEventLine(s, e), [scene, event] as [number, string]);
  return { line: line!, bytes: await stringVar4(game) };
}

/** The party / item events count only after the Hall of Fame and once linking with R/S is allowed. */
const allowPartyEvents = (game: Game) =>
  game.eval((t) => {
    t.state!.setFlag('FLAG_SYS_GAME_CLEAR');
    t.state!.setFlag('FLAG_SYS_CAN_LINK_WITH_RS');
  });

/** Wait (in the page) until the GBA task `name` runs with no fade. */
async function waitForTask(game: Game, name: string): Promise<void> {
  expect(await game.eval((t, n) => t.until(() => t.gbaTasks().includes(n) && !t.paletteFadeActive(), 20000), name), name).toBe(true);
}

/** START, then the start menu's `item`. */
async function startMenu(game: Game, item: string): Promise<void> {
  await game.waitIdle();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  const to = menu.items.indexOf(item as (typeof menu.items)[number]);
  for (let i = menu.cursor; i !== to; i += Math.sign(to - i)) await game.press(to > i ? 'DOWN' : 'UP');
  await game.press('A');
}

/** In the party menu (choosing a mon): A on the cursor's mon, then down `downs` rows of its action menu and A. */
async function partyAction(game: Game, downs: number): Promise<void> {
  await game.press('A');
  await waitForTask(game, 'Task_HandleSelectionMenuInput');
  await game.pressTimes('DOWN', downs);
  await game.press('A');
}

test("QL4a: the party menu's GIVE / TAKE / SWITCH and a Potion used from the bag each record their event, which plays back on CONTINUE", async () => {
  const game = await session.start({
    start: 'after-rival',
    map: 'Route1',
    x: 11,
    y: 30,
    party: [
      { species: 'RATTATA', level: 5 },
      { species: 'PIDGEY', level: 3 },
    ],
  });
  await game.waitIdle();
  await allowPartyEvents(game);
  await game.eval((t) => {
    t.state!.bag.pockets[0].forEach((s) => ((s.itemId = 0), (s.quantity = 0)));
    t.state!.bag.add(t.define('ITEM_POTION'), 1);
    t.state!.bag.add(t.define('ITEM_SILK_SCARF'), 1);
    t.state!.party[0].hp = 1;
  });

  // RATTATA: SUMMARY / SWITCH / ITEM / CANCEL → ITEM: GIVE / TAKE / CANCEL → GIVE → the bag's SILK SCARF (second)
  await startMenu(game, 'POKEMON');
  await game.waitForPartyMenu();
  await partyAction(game, 2);
  await waitForTask(game, 'Task_HandleSelectionMenuInput');
  await game.press('A');
  await game.waitForBag();
  await game.press('DOWN');
  await game.press('A');
  await game.mashUntil((t) => t.state!.party[0].heldItem !== 0 && t.gbaTasks().includes('Task_HandleChooseMonInput'), { button: 'B', what: 'the scarf given' });
  // ITEM → TAKE: "Received the SILK SCARF from RATTATA."
  await partyAction(game, 2);
  await waitForTask(game, 'Task_HandleSelectionMenuInput');
  await game.press('DOWN');
  await game.press('A');
  await game.mashUntil((t) => t.state!.party[0].heldItem === 0 && t.gbaTasks().includes('Task_HandleChooseMonInput'), { button: 'B', what: 'the scarf taken' });
  // SWITCH with PIDGEY
  await partyAction(game, 1);
  await waitForTask(game, 'Task_HandleChooseMonInput');
  await game.press('DOWN');
  await game.press('A');
  await game.waitFor((t) => t.party()[0].species === 'PIDGEY' && t.gbaTasks().includes('Task_HandleChooseMonInput'), { what: 'the switch' });
  await game.mashUntil((t) => !t.gbaScreen() && t.idle(), { button: 'B', what: 'the field' });

  // BAG → POTION → USE → RATTATA (now second)
  await startMenu(game, 'BAG');
  await game.waitForBag();
  await game.press('UP'); // (the bag kept its cursor on the scarf)
  await game.press('A');
  await waitForTask(game, 'Task_FieldItemContextMenuHandleInput');
  await game.press('A');
  await game.waitForPartyMenu();
  await game.press('DOWN');
  await game.press('A');
  await game.waitFor((t) => t.itemCount('POTION') === 0, { what: 'the Potion used' });
  await game.mashUntil((t) => !t.gbaScreen() && t.idle(), { button: 'B', what: 'the field again' });

  const lines = {
    gave: await eventLine(game, 'QL_EVENT_GAVE_HELD_ITEM'),
    took: await eventLine(game, 'QL_EVENT_TOOK_HELD_ITEM'),
    switched: await eventLine(game, 'QL_EVENT_SWITCHED_PARTY_ORDER'),
    used: await eventLine(game, 'QL_EVENT_USED_ITEM'),
  };
  expect(Object.values(lines).map((l) => l.line)).toEqual([
    'Made RATTATA hold the item SILK SCARF.',
    'Took the item SILK SCARF from RATTATA.',
    'PLAYER switched the POKéMON RATTATA with PIDGEY.',
    'Used the item POTION on RATTATA at this location.',
  ]);

  // Saved, then CONTINUE: the scene plays each event's line (HandleShowQuestLogMessage with gStringVar4)
  await save(game);
  await game.load({ keepSave: true, mainMenu: true });
  const watch = game.eval(async (t) => {
    const m = await new Function("return import('/src/menus/common.ts')")();
    const shown: number[][] = [];
    let last: number[] | undefined;
    const ok = await t.until(() => {
      if (!t.field()) return false; // (the main menu)
      const ql = t.questLog();
      // a line is up (sPlaybackControl.state 1); the next one can follow in the same frame
      if (ql.playback.active && ql.playback.control.state === 1 && m.gStringVar4 !== last) {
        last = m.gStringVar4 as number[];
        shown.push(last.slice(0, last.indexOf(0xff) + 1));
      }
      return shown.length > 0 && !ql.playback.active;
    }, 60000);
    return { ok, shown };
  });
  await continueGame(game);
  const seen = await watch;
  expect(seen.ok).toBe(true);
  for (const l of Object.values(lines)) expect(seen.shown, l.line).toContainEqual(l.bytes);
});
