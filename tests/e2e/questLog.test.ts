// The quest log's recording (world/questLog*.ts, QUEST_LOG_PLAN.md QL1): leaving a building starts a scene
// (QL_EVENT_DEPARTED), the field records the player's steps, saving closes the scene into the save; a script's
// `special QuestLog_CutRecording` ends a scene; nothing is recorded in a disabled location (the trainer fan club),
// and walking into one cuts the recording.

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
  expect(saved.version).toBe(12);
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
