// quest_log.c's recording half: the quest log's state (gQuestLogState, gQuestLogPlaybackState, sQuestLogCB,
// sCurrentSceneNum), the four scenes in the save (gSaveBlock1Ptr->questLog, here GameState.questLog), starting a
// scene (QL_StartRecordingAction and its snapshot), the action buffer the field fills every frame
// (sQuestLogActionRecordBuffer: QuestLogRecordPlayerStep, QuestLogRecordNPCStep, QL_RecordFieldInput, ...), its
// encoding into the scene's command stream (TryRecordActionSequence, the codecs in questLogEvents.ts), and the
// ways a scene ends (QLogCB_Recording, QL_FinishRecordingScene, QuestLog_CutRecording, SaveQuestLogData).
//
// The playback half (TryStartQuestLogPlayback, QLPlayback_InitOverworldState, QL_TryRunActions's RUNNING case,
// QL_UpdateObject, the windows and tints) is QUEST_LOG_PLAN.md's QL2. No Phaser here: the field hands over what the
// C reads from gObjectEvents / gSaveBlock1Ptr through `setQuestLogHost` (OverworldScene.create).

import { constant, K } from '../battle/constants';
import type { ObjectEventData } from '../data/types';
import type { ObjectEvent } from '../entities/ObjectEvent';
import type { GameState } from '../state/GameState';
import type { Direction } from './direction';
import { QL_RecordObjects, emptyQuestLogObjectEvent, type QuestLogObjectEvent } from './questLogObjects';
import {
  QL_RecordAction_Input,
  QL_RecordAction_MovementOrGfxChange,
  QL_RecordAction_SceneEnd,
  QL_RecordWait,
  QL_ResetEventStates,
  QL_ResetRepeatEventTracker,
  ResetDeferredLinkEvent,
} from './questLogEvents';

// ------------------------------------------------------------------ constants

/** QUEST_LOG_SCENE_COUNT */
export const QUEST_LOG_SCENE_COUNT = 4;
/** sizeof(questLog[0].script) / sizeof(u16): a scene's command stream */
export const QL_SCRIPT_LENGTH = 128;
/** struct QuestLogAction is 8 bytes (4 data, u16 duration, u8 type, padding) */
const QUEST_LOG_ACTION_SIZE = 8;
/** SCRIPT_BUFFER_SIZE: sQuestLogActionRecordBuffer holds as many actions as a script could (32) */
export const SCRIPT_BUFFER_SIZE = (QL_SCRIPT_LENGTH * 2) / QUEST_LOG_ACTION_SIZE;
/** OBJECT_EVENTS_COUNT / OBJECT_EVENT_TEMPLATES_COUNT (global.fieldmap.h; tests/unit/questLog.test.ts checks them) */
export const OBJECT_EVENTS_COUNT = 16;
export const OBJECT_EVENT_TEMPLATES_COUNT = 64;
/** MAP_OFFSET (fieldmap.h): map coordinates are map-local + 7 */
export const MAP_OFFSET = 7;
/** NUM_PC_COUNT_BITS (SetPokemonCounts) */
const NUM_PC_COUNT_BITS = 12;

// ------------------------------------------------------------------ the scene (struct QuestLogScene)

/** struct QuestLogObjectEventTemplate: a gSaveBlock1Ptr->objectEventTemplates entry's position and movement. */
export interface QuestLogObjectEventTemplate {
  /** u8: |x| (negx says the sign) */
  x: number;
  negx: number;
  y: number;
  negy: number;
  elevation: number;
  /** MOVEMENT_TYPE_* */
  movementType: number;
}

/**
 * struct QuestLogScene (gSaveBlock1Ptr->questLog[i]): what a scene starts from and its command stream. The flags
 * and vars are kept as the save keeps them (set flag ids below SPECIAL_FLAGS_START; non-zero vars as [id, value])
 * rather than as the C's byte arrays.
 */
export interface QuestLogScene {
  /** 0 (empty), QL_START_NORMAL or QL_START_WARP */
  startType: number;
  mapGroup: number;
  mapNum: number;
  /** u8: the warp the player arrived through (WARP_ID_NONE = 0xFF) */
  warpId: number;
  /** gSaveBlock1Ptr->pos: the player's map-local tile */
  x: number;
  y: number;
  /** QL_RecordObjects: gObjectEvents[OBJECT_EVENTS_COUNT] */
  objectEvents: QuestLogObjectEvent[];
  flags: number[];
  vars: [number, number][];
  /** gSaveBlock1Ptr->objectEventTemplates[OBJECT_EVENT_TEMPLATES_COUNT] */
  objectEventTemplates: QuestLogObjectEventTemplate[];
  /** u16 script[128]: the command stream (questLogEvents.ts) */
  script: number[];
}

export function emptyQuestLogObjectEventTemplate(): QuestLogObjectEventTemplate {
  return { x: 0, negx: 0, y: 0, negy: 0, elevation: 0, movementType: 0 };
}

/** A zeroed scene (ClearSavedScene's memset). */
export function emptyQuestLogScene(): QuestLogScene {
  return {
    startType: 0,
    mapGroup: 0,
    mapNum: 0,
    warpId: 0,
    x: 0,
    y: 0,
    objectEvents: Array.from({ length: OBJECT_EVENTS_COUNT }, emptyQuestLogObjectEvent),
    flags: [],
    vars: [],
    objectEventTemplates: Array.from({ length: OBJECT_EVENT_TEMPLATES_COUNT }, emptyQuestLogObjectEventTemplate),
    script: new Array<number>(QL_SCRIPT_LENGTH).fill(0),
  };
}

/** gSaveBlock1Ptr->questLog, zeroed */
export function emptyQuestLogScenes(): QuestLogScene[] {
  return Array.from({ length: QUEST_LOG_SCENE_COUNT }, emptyQuestLogScene);
}

// ------------------------------------------------------------------ data (questLog.json)

/** public/gen/questLog.json (tools/extract_quest_log.py) */
export interface QuestLogData {
  /** MAP_* → [mapGroup, mapNum, MAPSEC_*] */
  maps: Record<string, [number, number, string]>;
  /** field_specials.c's sInsideOutsidePairs by QL_LOCATION_*: [inside, outside] */
  insideOutsidePairs: [string, string][];
  /** sWorldMapFlags */
  worldMapFlags: string[];
  /** InQuestLogDisabledLocation's maps */
  disabledLocations: string[];
  cmdHeaderSize: number;
  /** sQuestLogEventCmdSizes by QL_EVENT_* name */
  eventCmdSizes: Record<string, number>;
  /** IsSpeciesFromSpecialEncounter */
  specialEncounterSpecies: string[];
  /** ShouldRegisterEvent_HandleBeatStoryTrainer's classes (the trainers that register before the Hall of Fame) */
  storyTrainerClasses: string[];
}

let sData: QuestLogData | undefined;

/** Assets.init (and the unit tests) hand over questLog.json. */
export function initQuestLogData(data: QuestLogData): void {
  sData = data;
}

export function questLogData(): QuestLogData {
  if (!sData) throw new Error('[quest log] questLog.json not loaded');
  return sData;
}

/** MAP_GROUP / MAP_NUM of a MAP_* id ([0, 0] for an unknown one). */
export function mapGroupAndNum(mapId: string): { mapGroup: number; mapNum: number } {
  const m = questLogData().maps[mapId];
  return { mapGroup: m?.[0] ?? 0, mapNum: m?.[1] ?? 0 };
}

/** The MAP_* id of a group and number (QL2's playback map), if there is one. */
export function mapIdOf(mapGroup: number, mapNum: number): string | undefined {
  for (const [id, [g, n]] of Object.entries(questLogData().maps)) if (g === mapGroup && n === mapNum) return id;
  return undefined;
}

// ------------------------------------------------------------------ the field (gObjectEvents, gSaveBlock1Ptr)

/** gSaveBlock1Ptr->location + pos */
export interface QuestLogLocation {
  mapId: string;
  /** location.warpId: the warp the player arrived through, WARP_ID_NONE (-1) after a connection or a script warp */
  warpId: number;
  /** pos: map-local */
  x: number;
  y: number;
}

/** What quest_log.c reads from the field. OverworldScene implements it. */
export interface QuestLogHost {
  state: GameState;
  /** gSaveBlock1Ptr->location and pos, as the field has them now */
  location(): QuestLogLocation;
  /** gMapHeader.regionMapSectionId */
  mapSec(): number;
  /** GetPlayerFacingDirection */
  playerFacing(): Direction;
  /** ArePlayerFieldControlsLocked */
  fieldControlsLocked(): boolean;
  /** gObjectEvents for QL_RecordObjects (questLogObjects.ts builds the records) */
  objectEvents(): QuestLogObjectEvent[];
  /** gSaveBlock1Ptr->objectEventTemplates: the current map's templates as the scripts left them */
  objectEventTemplates(): ObjectEventData[];
  /** objectEvent->localId / mapNum / mapGroup of a field object (QL_TryRecordNPCStepWithDuration32) */
  objectIdentity?(obj: ObjectEvent): { localId: number; mapNum: number; mapGroup: number } | undefined;
  /** gTrainers[trainerId].trainerClass (ShouldRegisterEvent_HandleBeatStoryTrainer); QL3 wires it */
  trainerClass?(trainerId: number): number;
}

let sHost: QuestLogHost | undefined;

export function setQuestLogHost(host: QuestLogHost | undefined): void {
  sHost = host;
}

export function questLogHost(): QuestLogHost | undefined {
  return sHost;
}

function host(): QuestLogHost {
  if (!sHost) throw new Error('[quest log] no host');
  return sHost;
}

// ------------------------------------------------------------------ state

/** A pointer into a scene's script (u16 *): the scene and the u16 index. */
export interface ScriptPtr {
  scene: number;
  pos: number;
}

/** struct QuestLogAction */
export interface QuestLogAction {
  /**
   * data: the movement's {localId, mapNum, mapGroup, movementActionId}, the gfx change's {localId, mapNum,
   * mapGroup, gfxState} or the field input's four bytes.
   */
  data: [number, number, number, number];
  duration: number;
  /** QL_ACTION_* */
  type: number;
}

export function emptyQuestLogAction(): QuestLogAction {
  return { data: [0, 0, 0, 0], duration: 0, type: 0 };
}

/** quest_log.c's (and quest_log_events.c's) globals the other quest log files share. */
export const gQL = {
  /** gQuestLogState: 0, QL_STATE_RECORDING, QL_STATE_PLAYBACK, QL_STATE_PLAYBACK_LAST */
  state: 0,
  /** gQuestLogPlaybackState: QL_PLAYBACK_STATE_* */
  playbackState: 0,
  /** sCurrentSceneNum */
  currentSceneNum: 0,
  /** gQuestLogRecordingPointer */
  recordingPointer: null as ScriptPtr | null,
  /** gQuestLogDefeatedWildMonRecord */
  defeatedWildMonRecord: null as ScriptPtr | null,
  /** gQuestLogCurActionIdx */
  curActionIdx: 0,
};

/** sQuestLogCB: QLogCB_Recording (or QL2's QLogCB_Playback), run from CB1_Overworld by RunQuestLogCB */
let sQuestLogCB: (() => void) | null = null;
/** sRecordSequenceStartIdx */
let sRecordSequenceStartIdx = 0;
/** sQuestLogActionRecordBuffer */
const sQuestLogActionRecordBuffer: QuestLogAction[] = Array.from({ length: SCRIPT_BUFFER_SIZE }, emptyQuestLogAction);
/** sCurSceneActions (NULL until the first ResetActions) and sMaxActionsInScene */
let sCurSceneActions: QuestLogAction[] | null = null;
let sMaxActionsInScene = 0;
/** sNextActionDelay: frames (with the controls free) since the last recorded action */
let sNextActionDelay = 0;
/** sLastQuestLogCursor: the player's last recorded step */
let sLastQuestLogCursor = 0;

/** The current scenes (gSaveBlock1Ptr->questLog). */
function scenes(): QuestLogScene[] {
  return host().state.questLog;
}

/** gSaveBlock1Ptr->questLog[ptr.scene].script */
export function scriptOf(ptr: ScriptPtr): number[] {
  return scenes()[ptr.scene].script;
}

/** The action buffer, for tests and QL2. */
export function questLogActionBuffer(): QuestLogAction[] {
  return sQuestLogActionRecordBuffer;
}

/** For tests (__test.questLog): the module state. */
export function questLogDebugState() {
  return {
    state: gQL.state,
    playbackState: gQL.playbackState,
    currentSceneNum: gQL.currentSceneNum,
    curActionIdx: gQL.curActionIdx,
    recordingPointer: gQL.recordingPointer && { ...gQL.recordingPointer },
    nextActionDelay: sNextActionDelay,
    recording: sQuestLogCB === QLogCB_Recording,
  };
}

// ------------------------------------------------------------------ reset

/** ResetQuestLog (NewGameInitData) */
export function ResetQuestLog(state: GameState): void {
  state.questLog = emptyQuestLogScenes();
  gQL.currentSceneNum = 0;
  gQL.state = 0;
  sQuestLogCB = null;
  gQL.recordingPointer = null;
  gQL.defeatedWildMonRecord = null;
  QL_ResetEventStates();
  ResetDeferredLinkEvent();
  // main.c's DoSoftReset clears EWRAM and sets gQuestLogPlaybackState = QL_PLAYBACK_STATE_STOPPED; the port's
  // module state outlives a soft reset, so a new game starts from there too.
  gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
  sCurSceneActions = null;
  sMaxActionsInScene = 0;
  gQL.curActionIdx = 0;
}

/**
 * CONTINUE without a playback (QL2 brings TryStartQuestLogPlayback): the module state as a soft reset leaves it
 * (EWRAM cleared, gQuestLogPlaybackState STOPPED), with sCurrentSceneNum where QuestLog_AdvancePlayhead would leave
 * it after playing the saved scenes (SortQuestLogInSav1 put them first, oldest first): the next free slot, or the
 * oldest when all four are used (QL_StartRecordingAction wraps 4 to 0).
 */
export function QL_ResetForContinue(state: GameState): void {
  gQL.state = 0;
  gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
  sQuestLogCB = null;
  gQL.recordingPointer = null;
  gQL.defeatedWildMonRecord = null;
  sCurSceneActions = null;
  sMaxActionsInScene = 0;
  gQL.curActionIdx = 0;
  QL_ResetEventStates();
  ResetDeferredLinkEvent();
  let n = 0;
  while (n < QUEST_LOG_SCENE_COUNT && state.questLog[n].startType !== 0) n++;
  gQL.currentSceneNum = n;
}

/** ClearSavedScene */
function ClearSavedScene(sceneNum: number): void {
  scenes()[sceneNum] = emptyQuestLogScene();
  gQL.defeatedWildMonRecord = null;
}

/** QL_ResetDefeatedWildMonRecord (the map loads) */
export function QL_ResetDefeatedWildMonRecord(): void {
  gQL.defeatedWildMonRecord = null;
}

/** RunQuestLogCB (CB1_Overworld, last) */
export function RunQuestLogCB(): void {
  if (sQuestLogCB !== null) sQuestLogCB();
}

/**
 * QL_IsRoomToSaveEvent / QL_IsRoomToSaveAction (identical): `size` bytes fit at the cursor inside the current
 * scene's script. A cursor into another scene is outside its range (the C compares addresses).
 */
export function QL_IsRoomToSaveEvent(cursor: ScriptPtr | null, size: number): boolean {
  if (cursor === null || cursor.scene !== gQL.currentSceneNum) return false;
  return cursor.pos >= 0 && cursor.pos * 2 <= QL_SCRIPT_LENGTH * 2 - size;
}
export const QL_IsRoomToSaveAction = QL_IsRoomToSaveEvent;

/** SetQuestLogState (only RECORDING here: QL2 adds QLogCB_Playback) */
function SetQuestLogState(state: number): void {
  gQL.state = state;
  if (state === K.QL_STATE_RECORDING) sQuestLogCB = QLogCB_Recording;
  else sQuestLogCB = null; // QLogCB_Playback: QL2
}

/** QLogCB_Recording: encode this frame's actions; when the stream or the buffer is full, end the scene. */
function QLogCB_Recording(): void {
  if (!TryRecordActionSequence(sQuestLogActionRecordBuffer)) {
    gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
    RecordSceneEnd();
    gQL.state = 0;
    sQuestLogCB = null;
  }
}

/** GetQuestLogState (special): gSpecialVar_Result = gQuestLogState */
export function GetQuestLogState(state: GameState): void {
  state.setVar('VAR_RESULT', gQL.state);
}

/** GetQuestLogStartType */
export function GetQuestLogStartType(): number {
  return scenes()[gQL.currentSceneNum].startType;
}

// ------------------------------------------------------------------ starting a scene

/** QL_StartRecordingAction: a new scene in the next slot, with the snapshot it plays back from. */
export function QL_StartRecordingAction(eventId: number): void {
  if (gQL.currentSceneNum >= QUEST_LOG_SCENE_COUNT) gQL.currentSceneNum = 0;
  ClearSavedScene(gQL.currentSceneNum);
  QL_ResetRepeatEventTracker();
  gQL.recordingPointer = { scene: gQL.currentSceneNum, pos: 0 };
  const isLink = eventId >= K.QL_EVENT_LINK_TRADED && eventId <= K.QL_EVENT_LINK_BATTLED_UNION; // IS_LINK_QL_EVENT
  scenes()[gQL.currentSceneNum].startType = isLink || eventId === K.QL_EVENT_DEPARTED ? K.QL_START_WARP : K.QL_START_NORMAL;
  SetPokemonCounts();
  SetPlayerInitialCoordsAtScene(gQL.currentSceneNum);
  SetNPCInitialCoordsAtScene(gQL.currentSceneNum);
  BackUpTrainerRematches();
  BackUpMapLayout();
  SetGameStateAtScene(gQL.currentSceneNum);
  sRecordSequenceStartIdx = 0;
  ResetActions(K.QL_PLAYBACK_STATE_RECORDING, sQuestLogActionRecordBuffer);
  TryRecordActionSequence(sQuestLogActionRecordBuffer);
  SetQuestLogState(K.QL_STATE_RECORDING);
}

/** SetPlayerInitialCoordsAtScene */
function SetPlayerInitialCoordsAtScene(sceneNum: number): void {
  const questLog = scenes()[sceneNum];
  const loc = host().location();
  const { mapGroup, mapNum } = mapGroupAndNum(loc.mapId);
  questLog.mapGroup = mapGroup;
  questLog.mapNum = mapNum;
  questLog.warpId = loc.warpId & 0xff; // u8
  questLog.x = loc.x;
  questLog.y = loc.y;
}

/** SetNPCInitialCoordsAtScene: QL_RecordObjects, then the templates' positions and movement types. */
function SetNPCInitialCoordsAtScene(sceneNum: number): void {
  const questLog = scenes()[sceneNum];
  QL_RecordObjects(questLog, host().objectEvents());
  const templates = host().objectEventTemplates();
  for (let i = 0; i < OBJECT_EVENT_TEMPLATES_COUNT; i++) {
    const t = templates[i];
    const out = questLog.objectEventTemplates[i];
    if (!t) continue; // gSaveBlock1Ptr->objectEventTemplates past the map's count are zero
    if (t.x < 0) {
      out.x = -t.x & 0xff;
      out.negx = 1;
    } else {
      out.x = t.x & 0xff;
      out.negx = 0;
    }
    if (t.y < 0) {
      out.y = -t.y & 0xff; // (-y << 24) >> 24 into the u8 bitfield
      out.negy = 1;
    } else {
      out.y = t.y & 0xff;
      out.negy = 0;
    }
    out.elevation = t.elevation & 0x3f;
    out.movementType = (constant(t.movement_type) ?? 0) & 0xff;
  }
}

/** SetGameStateAtScene: the flags and vars. */
function SetGameStateAtScene(sceneNum: number): void {
  const questLog = scenes()[sceneNum];
  const state = host().state;
  questLog.flags = state.flagIds().filter((f) => f < K.SPECIAL_FLAGS_START);
  questLog.vars = state.varEntries().filter(([v]) => v >= K.VARS_START && v <= K.VARS_END);
}

/**
 * BackUpTrainerRematches: gSaveBlock1Ptr->trainerRematches (0 or not, by local id) as bits in the four vars from
 * VAR_QLBAK_TRAINER_REMATCHES (64 entries, OBJECT_EVENT_TEMPLATES_COUNT).
 */
function BackUpTrainerRematches(): void {
  const state = host().state;
  for (let i = 0; i < 4; i++) {
    let v = 0;
    for (let j = 0; j < 16; j++) if (state.trainerRematches[16 * i + j]) v += 1 << j;
    state.setVar(K.VAR_QLBAK_TRAINER_REMATCHES + i, v);
  }
}

/** BackUpMapLayout */
function BackUpMapLayout(): void {
  const state = host().state;
  state.setVar(K.VAR_QLBAK_MAP_LAYOUT, state.mapLayoutId);
}

/** SetPokemonCounts: the party and box counts in VAR_QUEST_LOG_MON_COUNTS (QL_ResetPartyAndPC reads them). */
function SetPokemonCounts(): void {
  const state = host().state;
  const partyCount = QuestLog_GetPartyCount(state);
  const boxesCount = QuestLog_GetBoxMonCount(state);
  state.setVar(K.VAR_QUEST_LOG_MON_COUNTS, ((partyCount << NUM_PC_COUNT_BITS) + boxesCount) & 0xffff);
}

/** QuestLog_GetPartyCount: party slots with a species */
export function QuestLog_GetPartyCount(state: GameState): number {
  return state.party.filter((m) => m && m.species !== 0).length;
}

/** QuestLog_GetBoxMonCount */
export function QuestLog_GetBoxMonCount(state: GameState): number {
  let count = 0;
  for (const box of state.storage.boxes) for (const mon of box) if (mon && mon.species !== 0) count++;
  return count;
}

// ------------------------------------------------------------------ ending a scene

/** RecordSceneEnd: a SCENE_END at the cursor (if it fits; the cursor stays), then the next slot. */
function RecordSceneEnd(): void {
  QL_RecordAction_SceneEnd(gQL.recordingPointer);
  if (++gQL.currentSceneNum >= QUEST_LOG_SCENE_COUNT) gQL.currentSceneNum = 0;
}

/**
 * TryRecordActionSequence: encode the actions recorded since the last call. False (and the playback state
 * STOPPED) when one doesn't fit; also false, after a SCENE_END, when the state was already STOPPED.
 */
function TryRecordActionSequence(actions: QuestLogAction[]): boolean {
  for (let i = sRecordSequenceStartIdx; i < gQL.curActionIdx; i++) {
    if (gQL.recordingPointer === null) return false;
    switch (actions[i].type) {
      case K.QL_ACTION_MOVEMENT:
      case K.QL_ACTION_GFX_CHANGE:
        gQL.recordingPointer = QL_RecordAction_MovementOrGfxChange(gQL.recordingPointer, actions[i]);
        break;
      default:
        gQL.recordingPointer = QL_RecordAction_Input(gQL.recordingPointer, actions[i]);
        break;
    }
    if (gQL.recordingPointer === null) {
      gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
      return false;
    }
  }
  if (gQL.playbackState === K.QL_PLAYBACK_STATE_STOPPED) {
    gQL.recordingPointer = QL_RecordAction_SceneEnd(gQL.recordingPointer);
    return false;
  }
  sRecordSequenceStartIdx = gQL.curActionIdx;
  return true;
}

/** QL_FinishRecordingScene: the events that end a scene (a trainer rematch, a deferred trainer battle, ...). */
export function QL_FinishRecordingScene(): void {
  if (gQL.state === K.QL_STATE_RECORDING) {
    TryRecordActionSequence(sQuestLogActionRecordBuffer);
    RecordSceneEnd();
    gQL.state = 0;
    sQuestLogCB = null;
    gQL.defeatedWildMonRecord = null;
    gQL.recordingPointer = null;
    gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
  }
}

/** QuestLog_CutRecording (also `special QuestLog_CutRecording`): end the scene with a one-frame wait. */
export function QuestLog_CutRecording(): void {
  if (gQL.playbackState !== K.QL_PLAYBACK_STATE_STOPPED && gQL.state === K.QL_STATE_RECORDING) {
    TryRecordActionSequence(sQuestLogActionRecordBuffer);
    QL_RecordWait(1);
    RecordSceneEnd();
    gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
    gQL.state = 0;
    sQuestLogCB = null;
  }
  gQL.defeatedWildMonRecord = null;
  gQL.recordingPointer = null;
}

/** SortQuestLogInSav1: the used scenes in recording order, oldest first; the next scene goes after them. */
function SortQuestLogInSav1(): void {
  const state = host().state;
  const buffer: QuestLogScene[] = [];
  let sceneNum = gQL.currentSceneNum;
  for (let i = 0; i < QUEST_LOG_SCENE_COUNT; i++) {
    if (sceneNum >= QUEST_LOG_SCENE_COUNT) sceneNum = 0;
    if (state.questLog[sceneNum].startType !== 0) buffer.push(state.questLog[sceneNum]);
    sceneNum++;
  }
  gQL.currentSceneNum = buffer.length % QUEST_LOG_SCENE_COUNT;
  while (buffer.length < QUEST_LOG_SCENE_COUNT) buffer.push(emptyQuestLogScene());
  state.questLog = buffer;
}

/** SaveQuestLogData (the save dialog, the Hall of Fame): close the recording scene into the save. */
export function SaveQuestLogData(): void {
  if (!sHost) return; // no field (a screen tested on its own)
  // MenuHelpers_IsLinkActive: never in the port (no link play)
  QuestLog_CutRecording();
  SortQuestLogInSav1();
}

// ------------------------------------------------------------------ the actions the field records

/** QuestLogRecordNPCStep (ObjectEventSetSingleMovement while RECORDING) */
export function QuestLogRecordNPCStep(localId: number, mapNum: number, mapGroup: number, movementActionId: number): void {
  if (!RecordHeadAtEndOfEntryOrScriptContext2Enabled()) {
    const a = sCurSceneActions![gQL.curActionIdx];
    a.duration = sNextActionDelay;
    a.type = K.QL_ACTION_MOVEMENT;
    a.data = [localId & 0xff, mapNum & 0xff, mapGroup & 0xff, movementActionId & 0xff];
    gQL.curActionIdx++;
    sNextActionDelay = 0;
  }
}

/** QuestLogRecordNPCStepWithDuration (the boulder Strength pushes) */
export function QuestLogRecordNPCStepWithDuration(localId: number, mapNum: number, mapGroup: number, movementActionId: number, duration: number): void {
  if (!RecordHeadAtEndOfEntry()) {
    const a = sCurSceneActions![gQL.curActionIdx];
    a.duration = sNextActionDelay;
    a.type = K.QL_ACTION_MOVEMENT;
    a.data = [localId & 0xff, mapNum & 0xff, mapGroup & 0xff, movementActionId & 0xff];
    gQL.curActionIdx++;
    sNextActionDelay = duration;
  }
}

/**
 * QuestLogRecordPlayerStep (PlayerSetAnimId): a step, or a turn that isn't the last recorded one. data.a keeps
 * the slot's mapNum / mapGroup (the reset left them 0).
 */
export function QuestLogRecordPlayerStep(movementActionId: number): void {
  if (!RecordHeadAtEndOfEntryOrScriptContext2Enabled()) {
    if (movementActionId !== sCurSceneActions![sLastQuestLogCursor].data[3] || movementActionId > K.MOVEMENT_ACTION_FACE_RIGHT) {
      const a = sCurSceneActions![gQL.curActionIdx];
      a.duration = sNextActionDelay;
      a.type = K.QL_ACTION_MOVEMENT;
      a.data[0] = 0;
      a.data[3] = movementActionId & 0xff;
      sLastQuestLogCursor = gQL.curActionIdx;
      gQL.curActionIdx++;
      sNextActionDelay = 0;
    }
  }
}

/** QuestLogRecordPlayerStepWithDuration (QL_TryRecordPlayerStepWithDuration0: Strength, getting off Surf) */
export function QuestLogRecordPlayerStepWithDuration(movementActionId: number, duration: number): void {
  if (!RecordHeadAtEndOfEntry()) {
    const a = sCurSceneActions![gQL.curActionIdx];
    a.duration = sNextActionDelay;
    a.type = K.QL_ACTION_MOVEMENT;
    a.data[0] = 0;
    a.data[3] = movementActionId & 0xff;
    sLastQuestLogCursor = gQL.curActionIdx;
    gQL.curActionIdx++;
    sNextActionDelay = duration;
  }
}

/** QuestLogRecordPlayerAvatarGfxTransition (QL_PLAYER_GFX_*) */
export function QuestLogRecordPlayerAvatarGfxTransition(gfxState: number): void {
  if (!RecordHeadAtEndOfEntry()) {
    const a = sCurSceneActions![gQL.curActionIdx];
    a.duration = sNextActionDelay;
    a.type = K.QL_ACTION_GFX_CHANGE;
    a.data[0] = 0;
    a.data[3] = gfxState & 0xff;
    gQL.curActionIdx++;
    sNextActionDelay = 0;
  }
}

/** QuestLogRecordPlayerAvatarGfxTransitionWithDuration (getting off Surf: 16; the VS Seeker: 89) */
export function QuestLogRecordPlayerAvatarGfxTransitionWithDuration(gfxState: number, duration: number): void {
  if (!RecordHeadAtEndOfEntry()) {
    const a = sCurSceneActions![gQL.curActionIdx];
    a.duration = sNextActionDelay;
    a.type = K.QL_ACTION_GFX_CHANGE;
    a.data[0] = 0;
    a.data[3] = gfxState & 0xff;
    gQL.curActionIdx++;
    sNextActionDelay = duration;
  }
}

/**
 * struct FieldInput as the u32 the C reads: bit 0 pressedAButton, 1 checkStandardWildEncounter, 2
 * pressedStartButton, 3 pressedSelectButton, 4 heldDirection, 5 heldDirection2, 6 tookStep, 7 pressedBButton,
 * 8 pressedRButton (byte 1: the unused input_field_1_*), byte 2 dpadDirection (DIR_*).
 */
export interface QuestLogFieldInput {
  pressedAButton?: boolean;
  checkStandardWildEncounter?: boolean;
  pressedStartButton?: boolean;
  pressedSelectButton?: boolean;
  heldDirection?: boolean;
  heldDirection2?: boolean;
  tookStep?: boolean;
  pressedBButton?: boolean;
  pressedRButton?: boolean;
  /** DIR_* */
  dpadDirection: number;
}

/** *(u32 *)&fieldInput */
export function fieldInputToU32(input: QuestLogFieldInput): number {
  const bits = [
    input.pressedAButton,
    input.checkStandardWildEncounter,
    input.pressedStartButton,
    input.pressedSelectButton,
    input.heldDirection,
    input.heldDirection2,
    input.tookStep,
    input.pressedBButton,
    input.pressedRButton,
  ];
  let v = 0;
  bits.forEach((b, i) => {
    if (b) v |= 1 << i;
  });
  return (v | ((input.dpadDirection & 0xff) << 16)) >>> 0;
}

/** The inverse, for QL2 (gQuestLogFieldInput from a recorded INPUT action). */
export function fieldInputFromU32(v: number): Required<QuestLogFieldInput> {
  const bit = (i: number) => (v & (1 << i)) !== 0;
  return {
    pressedAButton: bit(0),
    checkStandardWildEncounter: bit(1),
    pressedStartButton: bit(2),
    pressedSelectButton: bit(3),
    heldDirection: bit(4),
    heldDirection2: bit(5),
    tookStep: bit(6),
    pressedBButton: bit(7),
    pressedRButton: bit(8),
    dpadDirection: (v >>> 16) & 0xff,
  };
}

/**
 * QL_RecordFieldInput (DoCB1_Overworld, when ProcessPlayerFieldInput took the controls while RECORDING):
 * gFieldInputRecord without START and SELECT (& 0x00FF00F3).
 */
export function QL_RecordFieldInput(fieldInput: QuestLogFieldInput): void {
  if (gQL.curActionIdx < sMaxActionsInScene) {
    const data = fieldInputToU32(fieldInput) & 0x00ff00f3;
    const a = sCurSceneActions![gQL.curActionIdx];
    a.duration = sNextActionDelay;
    a.type = K.QL_ACTION_INPUT;
    a.data = [data & 0xff, (data >>> 8) & 0xff, (data >>> 16) & 0xff, (data >>> 24) & 0xff];
    gQL.curActionIdx++;
    sNextActionDelay = host().fieldControlsLocked() ? 1 : 0;
  }
}

/** QuestLog_OnEscalatorWarp's recording half (QL5 calls it from the escalator field effects) */
export function QuestLog_OnEscalatorWarp(direction: number): void {
  const state = QL_GetPlaybackState();
  if (direction === QL_ESCALATOR_OUT) {
    if (state === K.QL_PLAYBACK_STATE_RUNNING) gQL.playbackState = K.QL_PLAYBACK_STATE_ACTION_END;
    else if (state === K.QL_PLAYBACK_STATE_RECORDING) {
      const a = sCurSceneActions![gQL.curActionIdx];
      a.duration = sNextActionDelay;
      a.type = K.QL_ACTION_EMPTY;
      gQL.curActionIdx++;
      sNextActionDelay = 0;
      gQL.playbackState = K.QL_PLAYBACK_STATE_RECORDING_NO_DELAY;
    }
  } else if (direction === QL_ESCALATOR_IN) {
    if (state === K.QL_PLAYBACK_STATE_RUNNING) gQL.playbackState = K.QL_PLAYBACK_STATE_RUNNING;
    else if (state === K.QL_PLAYBACK_STATE_RECORDING) gQL.playbackState = K.QL_PLAYBACK_STATE_RECORDING;
  }
}
/** QL_ESCALATOR_OUT / QL_ESCALATOR_IN (quest_log.h) */
export const QL_ESCALATOR_OUT = 1;
export const QL_ESCALATOR_IN = 2;

/**
 * ResetActions's RECORDING case: the buffer emptied (SCENE_END, duration 0xFFFF), then a face in the player's
 * direction and an empty input as the scene's first two actions. (The RUNNING case is QL2's.)
 */
function ResetActions(kind: number, actions: QuestLogAction[]): void {
  if (kind !== K.QL_PLAYBACK_STATE_RECORDING) {
    gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
    return;
  }
  sCurSceneActions = actions;
  sMaxActionsInScene = actions.length;
  for (let i = 0; i < sMaxActionsInScene; i++) actions[i] = { data: [0, 0, 0, 0], duration: 0xffff, type: K.QL_ACTION_SCENE_END };
  gQL.curActionIdx = 0;
  sNextActionDelay = 0;
  const face = actions[0];
  face.duration = 0;
  face.type = K.QL_ACTION_MOVEMENT;
  face.data[0] = 0;
  const FACE: Record<Direction, number> = {
    down: K.MOVEMENT_ACTION_FACE_DOWN,
    right: K.MOVEMENT_ACTION_FACE_RIGHT,
    up: K.MOVEMENT_ACTION_FACE_UP,
    left: K.MOVEMENT_ACTION_FACE_LEFT,
  };
  face.data[3] = FACE[host().playerFacing()];
  sLastQuestLogCursor = 0;
  gQL.curActionIdx++;
  const input = actions[1];
  input.duration = 0;
  input.type = K.QL_ACTION_INPUT;
  input.data = [0, 0, 0, 0];
  gQL.curActionIdx++;
  gQL.playbackState = K.QL_PLAYBACK_STATE_RECORDING;
}

/**
 * QL_TryRunActions (DoCB1_Overworld, first): while recording, count the frames the controls are free (each
 * action's duration) and stop when the buffer is full. The RUNNING case (playback) is QL2's.
 */
export function QL_TryRunActions(): void {
  switch (gQL.playbackState) {
    case K.QL_PLAYBACK_STATE_RECORDING:
      if (host().fieldControlsLocked() !== true) {
        sNextActionDelay++;
        if (gQL.curActionIdx >= sMaxActionsInScene) gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
      }
      break;
    default:
      break; // STOPPED, ACTION_END, RECORDING_NO_DELAY; RUNNING: QL2
  }
}

/** QL_AfterRecordFishActionSuccessful */
export function QL_AfterRecordFishActionSuccessful(): void {
  sNextActionDelay++;
}

/** QL_GetPlaybackState: STOPPED, RUNNING (incl. ACTION_END) or RECORDING (incl. RECORDING_NO_DELAY) */
export function QL_GetPlaybackState(): number {
  switch (gQL.playbackState) {
    case K.QL_PLAYBACK_STATE_RUNNING:
    case K.QL_PLAYBACK_STATE_ACTION_END:
      return K.QL_PLAYBACK_STATE_RUNNING;
    case K.QL_PLAYBACK_STATE_RECORDING:
    case K.QL_PLAYBACK_STATE_RECORDING_NO_DELAY:
      return K.QL_PLAYBACK_STATE_RECORDING;
    default:
      return K.QL_PLAYBACK_STATE_STOPPED;
  }
}

/** RecordHeadAtEndOfEntryOrScriptContext2Enabled */
function RecordHeadAtEndOfEntryOrScriptContext2Enabled(): boolean {
  return gQL.curActionIdx >= sMaxActionsInScene || (sHost?.fieldControlsLocked() ?? false) === true;
}

/** RecordHeadAtEndOfEntry */
function RecordHeadAtEndOfEntry(): boolean {
  return gQL.curActionIdx >= sMaxActionsInScene;
}

// QuestLogGetFlagOrVarPtr / QuestLogSetFlagOrVar (event_data.c's flag and var hooks) aren't ported: their records
// are only set up by QuestLogResetFlagsOrVars, which nothing calls, so sNumFlagsOrVars stays 0 and both return
// at once.

// ------------------------------------------------------------------ the save (state/saveData.ts)

/**
 * A scene as the save file keeps it: the scene's fields, with an inactive object slot as null and the templates
 * as [x, negx, y, negy, elevation, movementType] (trailing empty ones left out).
 */
export interface QuestLogSceneSave {
  startType: number;
  mapGroup: number;
  mapNum: number;
  warpId: number;
  x: number;
  y: number;
  objectEvents: (QuestLogObjectEvent | null)[];
  flags: number[];
  vars: [number, number][];
  objectEventTemplates: [number, number, number, number, number, number][];
  script: number[];
}

/** gSaveBlock1Ptr->questLog for the save file */
export function questLogScenesSave(scenes: QuestLogScene[]): QuestLogSceneSave[] {
  return scenes.map((s) => {
    const templates = s.objectEventTemplates.map((t): [number, number, number, number, number, number] => [t.x, t.negx, t.y, t.negy, t.elevation, t.movementType]);
    while (templates.length && templates[templates.length - 1].every((v) => v === 0)) templates.pop();
    return {
      startType: s.startType,
      mapGroup: s.mapGroup,
      mapNum: s.mapNum,
      warpId: s.warpId,
      x: s.x,
      y: s.y,
      objectEvents: s.objectEvents.map((o) => (o.active || Object.values(o).some((v) => v !== 0) ? { ...o } : null)),
      flags: [...s.flags],
      vars: s.vars.map(([k, v]): [number, number] => [k, v]),
      objectEventTemplates: templates,
      script: [...s.script],
    };
  });
}

/** The save file's scenes back into gSaveBlock1Ptr->questLog (absent: a save from before version 10, no scenes). */
export function loadQuestLogScenes(saved: QuestLogSceneSave[] | undefined): QuestLogScene[] {
  const scenes = emptyQuestLogScenes();
  saved?.forEach((s, i) => {
    if (i >= QUEST_LOG_SCENE_COUNT) return;
    const scene = scenes[i];
    scene.startType = s.startType;
    scene.mapGroup = s.mapGroup;
    scene.mapNum = s.mapNum;
    scene.warpId = s.warpId;
    scene.x = s.x;
    scene.y = s.y;
    s.objectEvents.forEach((o, j) => {
      if (o && j < OBJECT_EVENTS_COUNT) scene.objectEvents[j] = { ...emptyQuestLogObjectEvent(), ...o };
    });
    scene.flags = [...s.flags];
    scene.vars = s.vars.map(([k, v]): [number, number] => [k, v]);
    s.objectEventTemplates.forEach(([x, negx, y, negy, elevation, movementType], j) => {
      if (j < OBJECT_EVENT_TEMPLATES_COUNT) scene.objectEventTemplates[j] = { x, negx, y, negy, elevation, movementType };
    });
    s.script.forEach((w, j) => {
      if (j < QL_SCRIPT_LENGTH) scene.script[j] = w & 0xffff;
    });
  });
  return scenes;
}

// ------------------------------------------------------------------ tests

/**
 * The commands of a script up to and including its first SCENE_END, or up to `end` (the recording cursor of a
 * scene still being recorded) or the last whole command, decoded for tests.
 */
export function decodeQuestLogScript(script: number[], end = script.length): { id: number; words: number[] }[] {
  const out: { id: number; words: number[] }[] = [];
  let pos = 0;
  while (pos < end) {
    const id = script[pos] & 0x0fff;
    let n: number;
    if (id === K.QL_EVENT_INPUT || id === K.QL_EVENT_MOVEMENT || id === K.QL_EVENT_GFX_CHANGE) n = 4;
    else if (id === K.QL_EVENT_WAIT) n = 2;
    else if (id === K.QL_EVENT_SCENE_END) n = 1;
    else {
      const size = questLogData().eventCmdSizes[Object.keys(questLogData().eventCmdSizes).find((k) => K[k] === id) ?? ''];
      if (!size) break;
      // (QL_SkipCommand: DEFEATED_CHAMPION's count of 2 is its three lines, not repeats)
      n = (size + (size - 4) * (id === K.QL_EVENT_DEFEATED_CHAMPION ? 0 : script[pos] >> 12)) / 2;
    }
    if (pos + n > end) break;
    out.push({ id, words: script.slice(pos, pos + n) });
    pos += n;
    if (id === K.QL_EVENT_SCENE_END) break;
  }
  return out;
}

/** __test.questLog(): the state and the scenes, their commands decoded. */
export function questLogTestProbe(state: GameState) {
  return {
    ...questLogDebugState(),
    scenes: state.questLog.map((s, i) => ({
      startType: s.startType,
      map: mapIdOf(s.mapGroup, s.mapNum),
      mapGroup: s.mapGroup,
      mapNum: s.mapNum,
      warpId: s.warpId,
      x: s.x,
      y: s.y,
      objects: s.objectEvents.filter((o) => o.active).map((o) => ({ localId: o.localId, x: o.x, y: o.y, isPlayer: o.isPlayer, facingDirection: o.facingDirection })),
      commands: decodeQuestLogScript(s.script, gQL.state === K.QL_STATE_RECORDING && gQL.recordingPointer?.scene === i ? gQL.recordingPointer.pos : undefined),
      script: [...s.script],
    })),
  };
}
