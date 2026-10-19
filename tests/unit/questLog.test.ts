// The quest log's recording half (world/questLog*.ts): the command stream's codecs against quest_log_events.c's
// layout, the ring of four scenes, a scene filling up, SetQuestLogEvent's filters, the departed locations, and the
// scenes in the save.

import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import type { ObjectEventData } from '../../src/data/types';
import { fromSaveData, SAVE_VERSION, toSaveData, upgradeSave, type SaveData } from '../../src/state/saveData';
import type { Direction } from '../../src/world/direction';
import type { ObjectEvent } from '../../src/entities/ObjectEvent';
import {
  clearQuestLogFieldInput,
  decodeQuestLogScript,
  emptyQuestLogAction,
  fieldInputFromU32,
  fieldInputToU32,
  gQL,
  initQuestLogData,
  mapGroupAndNum,
  mapIdOf,
  OBJECT_EVENT_TEMPLATES_COUNT,
  OBJECT_EVENTS_COUNT,
  QL_FinishRecordingScene,
  QL_InitSceneActions,
  QL_RecordFieldInput,
  QL_ResetOnSoftReset,
  QL_TryRunActions,
  QL_UpdateObject,
  questLogFieldInput,
  QL_SCRIPT_LENGTH,
  QuestLog_CutRecording,
  QuestLogRecordNPCStep,
  QuestLogRecordPlayerStep,
  QUEST_LOG_SCENE_COUNT,
  ResetQuestLog,
  RunQuestLogCB,
  SaveQuestLogData,
  SCRIPT_BUFFER_SIZE,
  setQuestLogHost,
  type QuestLogAction,
  type QuestLogData,
  type QuestLogLocation,
} from '../../src/world/questLog';
import {
  QL_LoadAction_Input,
  QL_LoadAction_MovementOrGfxChange,
  QL_LoadAction_SceneEnd,
  QL_LoadAction_Wait,
  QL_RecordAction_Input,
  QL_RecordAction_MovementOrGfxChange,
  QL_RecordAction_SceneEnd,
  QL_RecordAction_Wait,
  QL_SkipCommand,
  QuestLog_RecordEnteredMap,
  QuestLog_ShouldEndSceneOnMapChange,
  SetQLPlayedTheSlots,
  SetQuestLogEvent,
  SetQuestLogEvent_Arrived,
} from '../../src/world/questLogEvents';
import { QuestLog_CheckDepartingIndoorsMap, QuestLog_TryRecordDepartedLocation } from '../../src/world/questLogLocations';
import { newGame, readGen, type TestGame } from './gameData';

let t: TestGame;
let d: (name: string) => number;
let loc: QuestLogLocation;
let facing: Direction;
let locked: boolean;
let templates: ObjectEventData[];

beforeAll(() => {
  initConstants(readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines);
  initQuestLogData(readGen<QuestLogData>('questLog.json'));
});

beforeEach(() => {
  t = newGame();
  d = t.d;
  loc = { mapId: 'MAP_PALLET_TOWN', warpId: 0, x: 6, y: 8 };
  facing = 'down';
  locked = false;
  templates = [];
  setQuestLogHost({
    state: t.state,
    location: () => loc,
    mapSec: () => d('MAPSEC_PALLET_TOWN'),
    playerFacing: () => facing,
    fieldControlsLocked: () => locked,
    objectEvents: () => [],
    objectEventTemplates: () => templates,
  });
  ResetQuestLog(t.state);
});

const departed = (locationId: string, mapSec = 'MAPSEC_PALLET_TOWN') => ({ mapSec: d(mapSec), locationId: d(locationId) });
const scene = (i: number) => t.state.questLog[i];
/** A frame of CB1_Overworld with the controls free: QL_TryRunActions ... RunQuestLogCB */
const frame = (n = 1) => {
  for (let i = 0; i < n; i++) {
    QL_TryRunActions();
    RunQuestLogCB();
  }
};

describe('constants', () => {
  test('the struct sizes the port fixes match the decomp', () => {
    expect(OBJECT_EVENTS_COUNT).toBe(d('OBJECT_EVENTS_COUNT'));
    expect(OBJECT_EVENT_TEMPLATES_COUNT).toBe(d('OBJECT_EVENT_TEMPLATES_COUNT'));
    expect(QUEST_LOG_SCENE_COUNT).toBe(d('QUEST_LOG_SCENE_COUNT'));
    expect(SCRIPT_BUFFER_SIZE).toBe(32); // sizeof(u16[128]) / sizeof(struct QuestLogAction) (8 bytes)
  });

  test('maps by group and number (map_groups.json order)', () => {
    expect(mapGroupAndNum('MAP_PALLET_TOWN')).toEqual({ mapGroup: 3, mapNum: 0 });
    expect(mapGroupAndNum('MAP_PALLET_TOWN_PLAYERS_HOUSE_1F')).toEqual({ mapGroup: 4, mapNum: 0 });
    expect(mapIdOf(3, 0)).toBe('MAP_PALLET_TOWN');
  });
});

describe('the command stream', () => {
  beforeEach(() => {
    gQL.currentSceneNum = 0; // the room checks are against the current scene
  });
  const at = (pos: number, s = 0) => ({ scene: s, pos });

  test('actions encode as the C lays them out and decode back', () => {
    const input: QuestLogAction = { type: d('QL_ACTION_INPUT'), duration: 12, data: [0x41, 0, 2, 0] };
    const move: QuestLogAction = { type: d('QL_ACTION_MOVEMENT'), duration: 300, data: [3, 5, 4, d('MOVEMENT_ACTION_WALK_NORMAL_UP')] };
    const gfx: QuestLogAction = { type: d('QL_ACTION_GFX_CHANGE'), duration: 0, data: [0, 0, 0, 1] };
    let p = QL_RecordAction_Input(at(0), input);
    p = QL_RecordAction_MovementOrGfxChange(p, move);
    p = QL_RecordAction_MovementOrGfxChange(p, gfx);
    p = QL_RecordAction_Wait(p, 1);
    p = QL_RecordAction_SceneEnd(p);
    expect(p).toEqual(at(15));
    // [id, duration, bytes 0-1, bytes 2-3] little-endian
    expect(scene(0).script.slice(0, 15)).toEqual([
      d('QL_EVENT_INPUT'), 12, 0x41, 2,
      d('QL_EVENT_MOVEMENT'), 300, 3 | (5 << 8), 4 | (d('MOVEMENT_ACTION_WALK_NORMAL_UP') << 8),
      d('QL_EVENT_GFX_CHANGE'), 0, 0, 1 << 8,
      d('QL_EVENT_WAIT'), 1,
      d('QL_EVENT_SCENE_END'),
    ]);
    const a = emptyQuestLogAction();
    let q = QL_LoadAction_Input(at(0), a);
    expect(a).toEqual(input);
    q = QL_LoadAction_MovementOrGfxChange(q, a);
    expect(a).toEqual(move);
    q = QL_LoadAction_MovementOrGfxChange(q, a);
    expect(a).toEqual(gfx);
    q = QL_LoadAction_Wait(q, a);
    expect(a).toEqual({ type: d('QL_ACTION_WAIT'), duration: 1, data: [0, 0, 0, 0] });
    q = QL_LoadAction_SceneEnd(q, a);
    expect(a.type).toBe(d('QL_ACTION_SCENE_END'));
    expect(q).toEqual(at(15));
  });

  test('a command that would run past the 128 u16s is refused (QL_IsRoomToSaveAction)', () => {
    const move: QuestLogAction = { type: d('QL_ACTION_MOVEMENT'), duration: 0, data: [0, 0, 0, 1] };
    expect(QL_RecordAction_MovementOrGfxChange(at(QL_SCRIPT_LENGTH - 4), move)).toEqual(at(QL_SCRIPT_LENGTH));
    expect(QL_RecordAction_MovementOrGfxChange(at(QL_SCRIPT_LENGTH - 3), move)).toBeNull();
    expect(QL_RecordAction_SceneEnd(at(QL_SCRIPT_LENGTH - 1))).toEqual(at(QL_SCRIPT_LENGTH));
    expect(QL_RecordAction_SceneEnd(at(QL_SCRIPT_LENGTH))).toBeNull();
    expect(QL_RecordAction_SceneEnd(null)).toBeNull();
    // a cursor into another scene than the current one is out of range, as the C's address compare has it
    expect(QL_RecordAction_SceneEnd(at(0, 1))).toBeNull();
  });

  test('the field input keeps A, the wild check, both held directions, the step, B and the d-pad', () => {
    const all = { pressedAButton: true, checkStandardWildEncounter: true, pressedStartButton: true, pressedSelectButton: true, heldDirection: true, heldDirection2: true, tookStep: true, pressedBButton: true, pressedRButton: true, dpadDirection: d('DIR_EAST') };
    expect(fieldInputToU32(all)).toBe(0x000401ff);
    expect(fieldInputFromU32(fieldInputToU32(all))).toEqual(all);
    // QL_RecordFieldInput's & 0x00FF00F3 (START, SELECT and R dropped)
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_HOME'));
    QL_RecordFieldInput(all);
    frame();
    const cmds = decodeQuestLogScript(scene(0).script, gQL.recordingPointer!.pos);
    const input = cmds.filter((c) => c.id === d('QL_EVENT_INPUT')).at(-1)!;
    expect(input.words.slice(2)).toEqual([0xf3, d('DIR_EAST')]);
  });
});

describe('a scene', () => {
  test('a departure starts a QL_START_WARP scene: the face, an empty input, then the event', () => {
    facing = 'left';
    loc = { mapId: 'MAP_PALLET_TOWN', warpId: 1, x: 6, y: 8 };
    t.state.setFlag('FLAG_BADGE01_GET');
    t.state.setVar('VAR_MAP_SCENE_PALLET_TOWN_OAK', 3);
    t.state.trainerRematches[2] = 1;
    t.state.trainerRematches[20] = 3;
    templates = [{ ...({} as ObjectEventData), x: -2, y: 5, elevation: 3, movement_type: 'MOVEMENT_TYPE_WANDER_AROUND' }];
    const mon = () => t.pokemon.createMon(d('SPECIES_PIDGEY'), 5, { otId: 1, otName: 'RED', otGender: 'male', metLocation: 'MAPSEC_ROUTE_1' });
    t.state.party = [mon(), mon()];
    t.state.sendMonToPC(mon());
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_HOME'));
    expect(gQL.state).toBe(d('QL_STATE_RECORDING'));
    const s = scene(0);
    expect(s.startType).toBe(d('QL_START_WARP'));
    expect({ map: mapIdOf(s.mapGroup, s.mapNum), warpId: s.warpId, x: s.x, y: s.y }).toEqual({ map: 'MAP_PALLET_TOWN', warpId: 1, x: 6, y: 8 });
    expect(s.flags).toContain(d('FLAG_BADGE01_GET'));
    expect(s.vars).toContainEqual([d('VAR_MAP_SCENE_PALLET_TOWN_OAK'), 3]);
    // BackUpTrainerRematches (bits by local id) and SetPokemonCounts happen before the vars are copied
    expect(t.state.getVar('VAR_QLBAK_TRAINER_REMATCHES')).toBe(1 << 2);
    expect(t.state.getVar(d('VAR_QLBAK_TRAINER_REMATCHES') + 1)).toBe(1 << (20 - 16));
    expect(s.vars).toContainEqual([d('VAR_QLBAK_TRAINER_REMATCHES'), 1 << 2]);
    expect(s.vars).toContainEqual([d('VAR_QUEST_LOG_MON_COUNTS'), (2 << 12) + 1]); // party count << 12 + boxed mons
    expect(s.objectEventTemplates[0]).toEqual({ x: 2, negx: 1, y: 5, negy: 0, elevation: 3, movementType: d('MOVEMENT_TYPE_WANDER_AROUND') });
    const cmds = decodeQuestLogScript(s.script, gQL.recordingPointer!.pos);
    expect(cmds.map((c) => c.words)).toEqual([
      [d('QL_EVENT_MOVEMENT'), 0, 0, d('MOVEMENT_ACTION_FACE_LEFT') << 8],
      [d('QL_EVENT_INPUT'), 0, 0, 0],
      [d('QL_EVENT_DEPARTED'), 2, d('MAPSEC_PALLET_TOWN') | (d('QL_LOCATION_HOME') << 8)],
    ]);
  });

  test('steps and NPC steps are recorded with the frames between them; a cut ends the scene with a wait', () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_HOME'));
    frame(5);
    QuestLogRecordPlayerStep(d('MOVEMENT_ACTION_WALK_NORMAL_DOWN'));
    frame();
    QuestLogRecordPlayerStep(d('MOVEMENT_ACTION_FACE_DOWN'));
    QuestLogRecordPlayerStep(d('MOVEMENT_ACTION_FACE_DOWN')); // the same turn again isn't recorded
    locked = true;
    frame(10); // frames with the controls locked don't count
    locked = false;
    frame(3);
    QuestLogRecordNPCStep(2, 0, 3, d('MOVEMENT_ACTION_WALK_NORMAL_LEFT'));
    frame();
    QuestLog_CutRecording();
    expect(gQL.state).toBe(0);
    expect(gQL.currentSceneNum).toBe(1);
    const cmds = decodeQuestLogScript(scene(0).script).slice(3);
    expect(cmds.map((c) => c.words)).toEqual([
      [d('QL_EVENT_MOVEMENT'), 5, 0, d('MOVEMENT_ACTION_WALK_NORMAL_DOWN') << 8],
      [d('QL_EVENT_MOVEMENT'), 1, 0, d('MOVEMENT_ACTION_FACE_DOWN') << 8],
      [d('QL_EVENT_MOVEMENT'), 3, 2, 3 | (d('MOVEMENT_ACTION_WALK_NORMAL_LEFT') << 8)],
      [d('QL_EVENT_WAIT'), 1],
      [d('QL_EVENT_SCENE_END')],
    ]);
  });

  test('the stream fills up: 32 actions, then the scene ends by itself', () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_HOME'));
    let steps = 0;
    while (gQL.state === d('QL_STATE_RECORDING') && steps < 100) {
      QuestLogRecordPlayerStep(d('MOVEMENT_ACTION_WALK_NORMAL_UP'));
      frame(16);
      steps++;
    }
    // 2 starting actions + 30 steps fill sQuestLogActionRecordBuffer; the 16-byte head + the 6-byte event + 30 * 8
    // bytes is 262: the 30th step doesn't fit in the 256-byte script, which ends the scene there
    expect(steps).toBe(30);
    expect(gQL.state).toBe(0);
    expect(gQL.currentSceneNum).toBe(1);
    const cmds = decodeQuestLogScript(scene(0).script);
    expect(cmds.filter((c) => c.id === d('QL_EVENT_MOVEMENT')).length).toBe(1 + 29);
    // no room left for a SCENE_END: the script is full to its last u16
    expect(cmds.reduce((n, c) => n + c.words.length, 0)).toBe(127);
    // the next event starts the next scene
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_OAKS_LAB'));
    expect(gQL.state).toBe(d('QL_STATE_RECORDING'));
    expect(scene(1).startType).toBe(d('QL_START_WARP'));
  });

  test('steps past the 32-action buffer are dropped; QL_TryRunActions then stops the scene', () => {
    SetQuestLogEvent(d('QL_EVENT_ARRIVED'), { mapSec: d('MAPSEC_VIRIDIAN_CITY') });
    expect(scene(0).startType).toBe(d('QL_START_NORMAL'));
    for (let i = 0; i < 30; i++) QuestLogRecordPlayerStep(d('MOVEMENT_ACTION_WALK_NORMAL_UP')); // no frames between: one encode
    expect(gQL.curActionIdx).toBe(32);
    QuestLogRecordPlayerStep(d('MOVEMENT_ACTION_WALK_NORMAL_UP')); // past the buffer: dropped
    frame();
    expect(gQL.state).toBe(0);
  });

  test('a repeated event at the same action index adds to the last command, up to five copies', () => {
    SetQuestLogEvent(d('QL_EVENT_ARRIVED'), { mapSec: 1 });
    for (let i = 2; i <= 7; i++) SetQuestLogEvent(d('QL_EVENT_ARRIVED'), { mapSec: i });
    const ev = decodeQuestLogScript(scene(0).script).find((c) => c.id === d('QL_EVENT_ARRIVED'))!;
    // MAX_CMD_REPEAT = 4 repeats after the first; the oldest are dropped
    expect(ev.words).toEqual([d('QL_EVENT_ARRIVED') | (4 << 12), 2, 3, 4, 5, 6, 7]);
    const prev = { ptr: null as null | { scene: number; pos: number } };
    expect(QL_SkipCommand({ scene: 0, pos: 8 }, prev)).toEqual({ scene: 0, pos: 8 + 7 });
  });

  test('the ring of four scenes: the fifth goes in the first slot; the save sorts them oldest first', () => {
    const locations = ['QL_LOCATION_HOME', 'QL_LOCATION_OAKS_LAB', 'QL_LOCATION_VIRIDIAN_GYM', 'QL_LOCATION_PEWTER_MUSEUM', 'QL_LOCATION_PEWTER_GYM'];
    for (const l of locations) {
      SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed(l));
      QL_FinishRecordingScene();
    }
    const locOf = (i: number) => decodeQuestLogScript(scene(i).script).find((c) => c.id === d('QL_EVENT_DEPARTED'))!.words[2] >> 8;
    expect([0, 1, 2, 3].map(locOf)).toEqual(['QL_LOCATION_PEWTER_GYM', 'QL_LOCATION_OAKS_LAB', 'QL_LOCATION_VIRIDIAN_GYM', 'QL_LOCATION_PEWTER_MUSEUM'].map(d));
    expect(gQL.currentSceneNum).toBe(1);
    SaveQuestLogData();
    expect([0, 1, 2, 3].map(locOf)).toEqual(['QL_LOCATION_OAKS_LAB', 'QL_LOCATION_VIRIDIAN_GYM', 'QL_LOCATION_PEWTER_MUSEUM', 'QL_LOCATION_PEWTER_GYM'].map(d));
    expect(gQL.currentSceneNum).toBe(0); // 4 % 4: the next one replaces the oldest
  });

  test('saving cuts the recording and puts the scene first', () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_HOME'));
    QL_FinishRecordingScene();
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_OAKS_LAB'));
    QuestLogRecordPlayerStep(d('MOVEMENT_ACTION_WALK_NORMAL_UP'));
    SaveQuestLogData();
    expect(gQL.state).toBe(0);
    expect(gQL.currentSceneNum).toBe(2);
    const cmds = decodeQuestLogScript(scene(1).script);
    expect(cmds.slice(-3).map((c) => c.id)).toEqual(['QL_EVENT_MOVEMENT', 'QL_EVENT_WAIT', 'QL_EVENT_SCENE_END'].map(d));
    expect(scene(2).startType).toBe(0);
    // CONTINUE starts from a soft reset's state (questLogPlayback.ts plays the saved scenes from scene 0)
    QL_ResetOnSoftReset();
    expect(gQL.currentSceneNum).toBe(0);
    expect(gQL.state).toBe(0);
  });
});

describe("SetQuestLogEvent's filters", () => {
  test('nothing is recorded in a disabled location, and walking into one cuts the recording', () => {
    loc = { mapId: 'MAP_SAFFRON_CITY_POKEMON_TRAINER_FAN_CLUB', warpId: 0, x: 4, y: 8 };
    SetQuestLogEvent(d('QL_EVENT_ARRIVED'), { mapSec: 1 });
    expect(gQL.state).toBe(0);
    expect(scene(0).startType).toBe(0);
    loc = { mapId: 'MAP_SAFFRON_CITY', warpId: 0, x: 4, y: 8 };
    SetQuestLogEvent(d('QL_EVENT_ARRIVED'), { mapSec: 1 });
    expect(gQL.state).toBe(d('QL_STATE_RECORDING'));
    loc = { mapId: 'MAP_CELADON_CITY_DEPARTMENT_STORE_ELEVATOR', warpId: 0, x: 1, y: 1 };
    expect(QuestLog_ShouldEndSceneOnMapChange()).toBe(false);
    expect(gQL.state).toBe(0);
    expect(decodeQuestLogScript(scene(0).script).slice(-2).map((c) => c.id)).toEqual([d('QL_EVENT_WAIT'), d('QL_EVENT_SCENE_END')]);
  });

  test('the same departure twice in a row is recorded once; the Game Corner only after the slots', () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_HOME'));
    QL_FinishRecordingScene();
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_HOME'));
    expect(gQL.state).toBe(0);
    expect(gQL.currentSceneNum).toBe(1);
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_GAME_CORNER', 'MAPSEC_CELADON_CITY'));
    expect(gQL.state).toBe(0);
    SetQLPlayedTheSlots();
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_GAME_CORNER', 'MAPSEC_CELADON_CITY'));
    expect(gQL.state).toBe(d('QL_STATE_RECORDING'));
  });

  test('field moves and the Pokémon Center never start a scene', () => {
    SetQuestLogEvent(d('QL_EVENT_USED_PKMN_CENTER'), null);
    SetQuestLogEvent(d('QL_EVENT_USED_FIELD_MOVE'), { species: 1, fieldMove: 0, mapSec: 1 });
    expect(gQL.state).toBe(0);
    expect(scene(0).startType).toBe(0);
  });

  test('ARRIVED: a world map flag set for the first time records the map section on the next frame', () => {
    QuestLog_RecordEnteredMap(d('FLAG_WORLD_MAP_VIRIDIAN_CITY'));
    t.state.setFlag('FLAG_WORLD_MAP_VIRIDIAN_CITY');
    SetQuestLogEvent_Arrived();
    expect(decodeQuestLogScript(scene(0).script)[2].words).toEqual([d('QL_EVENT_ARRIVED'), 2, d('MAPSEC_PALLET_TOWN')]);
    QL_FinishRecordingScene();
    QuestLog_RecordEnteredMap(d('FLAG_WORLD_MAP_VIRIDIAN_CITY')); // already set: nothing
    SetQuestLogEvent_Arrived();
    expect(scene(1).startType).toBe(0);
  });
});

describe('the departed locations (field_specials.c)', () => {
  test("into the player's house and back out records QL_LOCATION_HOME with the house's map section", () => {
    loc = { mapId: 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F', warpId: 1, x: 3, y: 8 };
    QuestLog_CheckDepartingIndoorsMap();
    QuestLog_TryRecordDepartedLocation();
    expect(t.state.getFlag('FLAG_SYS_QL_DEPARTED')).toBe(true);
    expect(gQL.state).toBe(0);
    loc = { mapId: 'MAP_PALLET_TOWN', warpId: 0, x: 6, y: 8 };
    QuestLog_CheckDepartingIndoorsMap();
    QuestLog_TryRecordDepartedLocation();
    expect(t.state.getFlag('FLAG_SYS_QL_DEPARTED')).toBe(false);
    expect(gQL.state).toBe(d('QL_STATE_RECORDING'));
    expect(decodeQuestLogScript(scene(0).script)[2].words[2]).toBe(d('MAPSEC_PALLET_TOWN') | (d('QL_LOCATION_HOME') << 8));
  });

  test("Rock Tunnel's south exit is the second location; the hideout hands over to the Game Corner", () => {
    loc = { mapId: 'MAP_ROCK_TUNNEL_1F', warpId: 0, x: 1, y: 1 };
    QuestLog_CheckDepartingIndoorsMap();
    loc = { mapId: 'MAP_ROUTE10', warpId: 1, x: 8, y: 57 };
    QuestLog_TryRecordDepartedLocation();
    expect(decodeQuestLogScript(scene(0).script)[2].words[2] >> 8).toBe(d('QL_LOCATION_ROCK_TUNNEL_2'));
    QL_FinishRecordingScene();
    loc = { mapId: 'MAP_ROCKET_HIDEOUT_B1F', warpId: 0, x: 1, y: 1 };
    QuestLog_CheckDepartingIndoorsMap();
    loc = { mapId: 'MAP_CELADON_CITY_GAME_CORNER', warpId: 2, x: 1, y: 1 };
    QuestLog_CheckDepartingIndoorsMap(); // the Game Corner doesn't replace the hideout
    QuestLog_TryRecordDepartedLocation();
    expect(decodeQuestLogScript(scene(1).script)[2].words[2] >> 8).toBe(d('QL_LOCATION_ROCKET_HIDEOUT'));
    expect(t.state.getVar('VAR_QL_ENTRANCE')).toBe(d('QL_LOCATION_GAME_CORNER'));
    expect(t.state.getFlag('FLAG_SYS_QL_DEPARTED')).toBe(true);
  });
});

describe('the save', () => {
  test('the scenes round-trip through the save file; a version 11 save has none', () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_HOME'));
    QuestLogRecordPlayerStep(d('MOVEMENT_ACTION_WALK_NORMAL_UP'));
    SaveQuestLogData();
    const data = JSON.parse(JSON.stringify(toSaveData(t.state))) as SaveData;
    expect(data.version).toBe(SAVE_VERSION);
    const loaded = fromSaveData(data, newGame().state);
    expect(loaded.questLog).toEqual(t.state.questLog);
    const v11 = { ...data, version: 11 } as Partial<SaveData>;
    delete v11.questLog;
    const upgraded = upgradeSave(v11 as SaveData);
    expect(upgraded.version).toBe(SAVE_VERSION);
    expect(fromSaveData(upgraded, newGame().state).questLog.every((s) => s.startType === 0)).toBe(true);
  });
});

describe('playback (QL_TryRunActions RUNNING, QL_UpdateObject)', () => {
  test('a recorded scene plays back: each action after its recorded frames, the NPC by local id, the input', () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_HOME'));
    frame(5);
    QuestLogRecordPlayerStep(d('MOVEMENT_ACTION_WALK_NORMAL_RIGHT'));
    frame(16);
    QuestLogRecordNPCStep(3, 0, 3, d('MOVEMENT_ACTION_WALK_NORMAL_DOWN'));
    frame(7);
    QL_RecordFieldInput({ pressedAButton: true, dpadDirection: d('DIR_EAST') });
    frame(1);
    SaveQuestLogData();
    const recorded = decodeQuestLogScript(scene(0).script).filter((c) => [d('QL_EVENT_MOVEMENT'), d('QL_EVENT_INPUT')].includes(c.id));
    expect(recorded.map((c) => c.id)).toEqual(['QL_EVENT_MOVEMENT', 'QL_EVENT_INPUT', 'QL_EVENT_MOVEMENT', 'QL_EVENT_MOVEMENT', 'QL_EVENT_INPUT'].map(d));

    // CONTINUE: the scene's actions from the top (ResetActions(RUNNING) queues the first for the player)
    QL_ResetOnSoftReset();
    QL_InitSceneActions();
    expect(gQL.playbackState).toBe(d('QL_PLAYBACK_STATE_RUNNING'));
    const held: { frame: number; who: string; action: number }[] = [];
    const inputs: { frame: number; a: boolean; dir: number }[] = [];
    const obj = (who: string) => ({ setHeldMovement: (action: number) => (held.push({ frame: f, who, action }), false) }) as unknown as ObjectEvent;
    const player = obj('player');
    const npc = obj('npc3');
    let f = 0;
    for (; f < 200 && gQL.playbackState !== d('QL_PLAYBACK_STATE_STOPPED'); f++) {
      QL_TryRunActions();
      const input = questLogFieldInput();
      if (input.pressedAButton) inputs.push({ frame: f, a: true, dir: input.dpadDirection });
      clearQuestLogFieldInput();
      QL_UpdateObject(player, d('LOCALID_PLAYER'), true);
      QL_UpdateObject(npc, 3, false);
    }
    expect(gQL.playbackState).toBe(d('QL_PLAYBACK_STATE_STOPPED')); // SCENE_END
    expect(held.map((h) => [h.who, h.action])).toEqual([
      ['player', d('MOVEMENT_ACTION_FACE_DOWN')],
      ['player', d('MOVEMENT_ACTION_WALK_NORMAL_RIGHT')],
      ['npc3', d('MOVEMENT_ACTION_WALK_NORMAL_DOWN')],
    ]);
    // each action comes its recorded duration (frames with the controls free) after the one before
    const dur = recorded.map((c) => c.words[1]);
    expect(held[1].frame - held[0].frame).toBe(dur[1] + dur[2] + (dur[1] ? 1 : 0) + (dur[2] ? 1 : 0));
    expect(held[2].frame - held[1].frame).toBe(dur[3] + (dur[3] ? 1 : 0));
    expect(inputs).toEqual([{ frame: held[2].frame + dur[4] + (dur[4] ? 1 : 0), a: true, dir: d('DIR_EAST') }]);
  });

  test('locked controls hold the actions back (RecordHeadAtEndOfEntryOrScriptContext2Enabled)', () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), departed('QL_LOCATION_HOME'));
    frame(4);
    QuestLogRecordPlayerStep(d('MOVEMENT_ACTION_WALK_NORMAL_UP'));
    SaveQuestLogData();
    QL_ResetOnSoftReset();
    QL_InitSceneActions();
    locked = true;
    for (let i = 0; i < 50; i++) QL_TryRunActions();
    expect(gQL.curActionIdx).toBeLessThan(3);
    locked = false;
    for (let i = 0; i < 50; i++) QL_TryRunActions();
    expect(gQL.playbackState).toBe(d('QL_PLAYBACK_STATE_STOPPED'));
  });
});
