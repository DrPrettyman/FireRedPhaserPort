// quest_log_events.c: the scene's command stream and SetQuestLogEvent.
//
// A scene's script is 128 u16s of commands, ported as the C writes them (QUEST_LOG_PLAN.md decision 1):
// - actions (TryRecordActionSequence): QL_EVENT_INPUT / QL_EVENT_GFX_CHANGE / QL_EVENT_MOVEMENT [id, duration,
//   data bytes 0-1, data bytes 2-3] (8 bytes); QL_EVENT_WAIT [id, duration]; QL_EVENT_SCENE_END [id];
// - events (QL_EVENT_* 3-42, RecordEventHeader): [id | repeats << 12, gQuestLogCurActionIdx] then the event's data,
//   once per repeat (a repeated event adds its data to the last command, up to MAX_CMD_REPEAT + 1 copies).
// Bytes go into the u16s little-endian, as on the GBA.
//
// SetQuestLogEvent runs the C's filters and starts a scene (QL_StartRecordingAction) when none is recording. The
// per-event recorders are in sRecordEventFuncs: QL_EVENT_DEPARTED and QL_EVENT_ARRIVED here, QL_EVENT_* 3-29 in
// questLogEventCodecs.ts (QL3a); 30-34, 37, 38, 40 are QUEST_LOG_PLAN.md's QL3b (`registerQuestLogEvent`).
// The loaders (playback) for the two here decode the data; their texts are QL2's.

import { constant, K } from '../battle/constants';
import { registerQuestLogEventCodecs } from './questLogEventCodecs';
import {
  QuestLog_CutRecording,
  QL_FinishRecordingScene,
  QL_IsRoomToSaveAction,
  QL_IsRoomToSaveEvent,
  QL_StartRecordingAction,
  gQL,
  questLogData,
  questLogHost,
  scriptOf,
  type QuestLogAction,
  type ScriptPtr,
} from './questLog';

/** CMD_HEADER_SIZE (bytes): the event id (with the repeat count) and the action index it came at */
export const CMD_HEADER_SIZE = 4;
/** MAX_CMD_REPEAT */
export const MAX_CMD_REPEAT = 4;
/** QL_CMD_EVENT_MASK / QL_CMD_COUNT_SHIFT / QL_CMD_COUNT_MASK (quest_log.h) */
export const QL_CMD_EVENT_MASK = 0x0fff;
export const QL_CMD_COUNT_SHIFT = 12;
export const QL_CMD_COUNT_MASK = 0xf << QL_CMD_COUNT_SHIFT;

/** sStepRecordingMode */
const STEP_RECORDING_MODE_ENABLED = 0;
const STEP_RECORDING_MODE_DISABLED = 1;
const STEP_RECORDING_MODE_DISABLED_UNTIL_DEPART = 2;

/** QL_EVENT_DEPARTED's data (struct QuestLogEvent_Departed) */
export interface QuestLogEventDeparted {
  mapSec: number;
  /** QL_LOCATION_* */
  locationId: number;
}
/** QL_EVENT_ARRIVED's data (a u16 mapSec) */
export interface QuestLogEventArrived {
  mapSec: number;
}
/**
 * An event's data (the C's `const u16 *` to its struct). QL3's events bring their own shapes; the pipeline reads
 * `defeatedSpecies` / `caughtSpecies` (QL_EVENT_DEFEATED_WILD_MON), `trainerId` (the trainer battles) and
 * `locationId` (QL_EVENT_DEPARTED).
 */
export type QuestLogEventData = Record<string, unknown> | null;

/** A RecordEvent_*: writes the event at `dest` (RecordEventHeader first), returns the cursor after it or null. */
export type RecordEventFunc = (dest: ScriptPtr | null, data: QuestLogEventData) => ScriptPtr | null;
/** A LoadEvent_* (playback): reads the event at `eventData`; QL2 prints its text. */
export type LoadEventFunc = (eventData: ScriptPtr) => unknown;

/** struct QuestLogRepeatEventTracker */
export const gQuestLogRepeatEventTracker = { id: 0, numRepeats: 0, counter: 0 };

/** struct DeferredLinkEvent (the link events and the trainer battles wait for the battle's end) */
let sDeferredEvent: { id: number; data: QuestLogEventData } = { id: 0, data: null };
let sStepRecordingMode = STEP_RECORDING_MODE_ENABLED;
let sNewlyEnteredMap = false;
let sLastDepartedLocation = 0;
let sPlayedTheSlots = false;

// ------------------------------------------------------------------ the tables

/** sQuestLogEventCmdSizes by event id (questLog.json) */
let sCmdSizes: number[] | undefined;
export function QL_EventCmdSize(eventId: number): number {
  if (!sCmdSizes) {
    sCmdSizes = [];
    for (const [name, size] of Object.entries(questLogData().eventCmdSizes)) sCmdSizes[K[name]] = size;
  }
  return sCmdSizes[eventId] ?? 0;
}

/** sRecordEventFuncs (QL3 adds the events it ports) */
const sRecordEventFuncs = new Map<number, RecordEventFunc>();
/** sLoadEventFuncs */
const sLoadEventFuncs = new Map<number, LoadEventFunc>();

/** Add an event's recorder and loader (QL3: every QL_EVENT_* other than DEPARTED / ARRIVED). */
export function registerQuestLogEvent(eventId: number, record: RecordEventFunc, load: LoadEventFunc): void {
  sRecordEventFuncs.set(eventId, record);
  sLoadEventFuncs.set(eventId, load);
}

function recordEvent(eventId: number, dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  ensureEventTables();
  const f = sRecordEventFuncs.get(eventId);
  if (!f) {
    // an event QL3 hasn't ported: nothing is written (the scene goes on as if it didn't fit)
    console.debug('[quest log] no recorder for event', eventId);
    return null;
  }
  return f(dest, data);
}

let sTablesReady = false;
function ensureEventTables(): void {
  if (sTablesReady) return;
  sTablesReady = true;
  if (!sRecordEventFuncs.has(K.QL_EVENT_DEPARTED)) registerQuestLogEvent(K.QL_EVENT_DEPARTED, RecordEvent_DepartedLocation, LoadEvent_DepartedLocation);
  if (!sRecordEventFuncs.has(K.QL_EVENT_ARRIVED)) registerQuestLogEvent(K.QL_EVENT_ARRIVED, RecordEvent_ArrivedInLocation, LoadEvent_ArrivedInLocation);
  registerQuestLogEventCodecs(); // QL_EVENT_* 3-29
}

/** IS_LINK_QL_EVENT */
export function IS_LINK_QL_EVENT(eventId: number): boolean {
  return eventId >= K.QL_EVENT_LINK_TRADED && eventId <= K.QL_EVENT_LINK_BATTLED_UNION;
}
/** IS_VALID_QL_EVENT */
export function IS_VALID_QL_EVENT(eventId: number): boolean {
  return eventId >= K.QL_EVENT_SWITCHED_PARTY_ORDER && eventId <= K.QL_EVENT_ARRIVED;
}

// ------------------------------------------------------------------ SetQuestLogEvent

/** MenuHelpers_IsLinkActive / InUnionRoom: never in the port (no link play) */
function linkActive(): boolean {
  return false;
}

/** SetQuestLogEvent: record an event, starting a scene if none is recording. */
export function SetQuestLogEvent(eventId: number, data: QuestLogEventData): void {
  const host = questLogHost();
  if (!host) return;
  if (eventId === K.QL_EVENT_DEPARTED && sStepRecordingMode === STEP_RECORDING_MODE_DISABLED_UNTIL_DEPART) {
    QL_EnableRecordingSteps();
    return;
  }
  QL_EnableRecordingSteps();

  if (gQL.state === K.QL_STATE_PLAYBACK) return;
  if (!IS_VALID_QL_EVENT(eventId)) return;
  // (an event QL3 hasn't ported yet has no recorder: it's left out as if it never happened)
  ensureEventTables();
  if (!sRecordEventFuncs.has(eventId)) return;
  // Certain locations like Trainer Tower do not allow Quest Log events to be recorded
  if (InQuestLogDisabledLocation()) return;
  if (TryDeferLinkEvent(eventId, data)) return;
  // Link events handled above. If we're in an active link, don't record any other events.
  if (linkActive()) return;
  if (TryDeferTrainerBattleEvent(eventId, data)) return;
  // Wild battles with static encounter species (Snorlax, Mewtwo, etc.) are not recorded.
  if (IsEventWithSpecialEncounterSpecies(eventId, data)) return;
  // If player departed Game Corner without using the slots, don't record it
  if (!ShouldRegisterEvent_DepartedGameCorner(eventId, data)) return;

  if (gQL.playbackState === K.QL_PLAYBACK_STATE_STOPPED) {
    if (ShouldRegisterEvent_HandlePartyActions(eventId, data)) return;
    if (eventId !== K.QL_EVENT_DEFEATED_WILD_MON || gQL.defeatedWildMonRecord === null) {
      if (!ShouldRegisterEvent_HandleDeparted(eventId, data)) return;
      QL_StartRecordingAction(eventId);
    }
  } else if (eventId === K.QL_EVENT_OBTAINED_STORY_ITEM) {
    return;
  }

  UpdateRepeatEventCounter(eventId);
  let r1: ScriptPtr | null;
  if (eventId === K.QL_EVENT_DEFEATED_WILD_MON) {
    if (gQL.defeatedWildMonRecord === null) {
      gQL.defeatedWildMonRecord = gQL.recordingPointer;
      r1 = recordEvent(eventId, gQL.defeatedWildMonRecord, data);
    } else {
      recordEvent(eventId, gQL.defeatedWildMonRecord, data);
      return;
    }
  } else {
    gQL.defeatedWildMonRecord = null;
    r1 = recordEvent(eventId, gQL.recordingPointer, data);
  }

  if (r1 === null) {
    // No room: end the scene and start the event in a new one
    QL_FinishRecordingScene();
    r1 = ShouldRegisterEvent(eventId, data);
    if (!r1) return;
  }

  gQL.recordingPointer = r1;
  if (sStepRecordingMode === STEP_RECORDING_MODE_ENABLED) return;
  QL_FinishRecordingScene();
}

/** InQuestLogDisabledLocation: the Trainer Tower, the trainer fan club, the e-Reader house, the elevators. */
export function InQuestLogDisabledLocation(): boolean {
  const host = questLogHost();
  if (!host) return false;
  return questLogData().disabledLocations.includes(host.location().mapId);
}

/**
 * QuestLog_ShouldEndSceneOnMapChange (DoMapLoadLoop, CB2_LoadMap2): into a disabled location, a recording is cut
 * (and QL2's playback ends the scene: TRUE).
 */
export function QuestLog_ShouldEndSceneOnMapChange(): boolean {
  if (!InQuestLogDisabledLocation()) return false;
  if (gQL.state === K.QL_STATE_PLAYBACK) return true;
  if (gQL.state === K.QL_STATE_RECORDING) QuestLog_CutRecording();
  return false;
}

/**
 * ShouldRegisterEvent_HandlePartyActions: TRUE when the event isn't recorded (field moves and the Pokémon Center
 * never start a scene; before the Hall of Fame, nor do party reorders, wild battles and trainers other than the
 * story's; before linking with R/S is allowed, nor do item and PC uses).
 */
function ShouldRegisterEvent_HandlePartyActions(eventId: number, data: QuestLogEventData): boolean {
  const state = questLogHost()!.state;
  if (eventId === K.QL_EVENT_USED_FIELD_MOVE || eventId === K.QL_EVENT_USED_PKMN_CENTER) return true;
  if (!state.getFlag(K.FLAG_SYS_GAME_CLEAR)) {
    if (eventId === K.QL_EVENT_SWITCHED_PARTY_ORDER || eventId === K.QL_EVENT_DEFEATED_WILD_MON || ShouldRegisterEvent_HandleBeatStoryTrainer(eventId, data)) {
      return true;
    }
  }
  if (!state.getFlag(K.FLAG_SYS_CAN_LINK_WITH_RS)) {
    const blocked = [
      'QL_EVENT_USED_ITEM',
      'QL_EVENT_GAVE_HELD_ITEM',
      'QL_EVENT_GAVE_HELD_ITEM_BAG',
      'QL_EVENT_GAVE_HELD_ITEM_PC',
      'QL_EVENT_TOOK_HELD_ITEM',
      'QL_EVENT_SWAPPED_HELD_ITEM',
      'QL_EVENT_SWAPPED_HELD_ITEM_PC',
      'QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON',
      'QL_EVENT_WITHDREW_MON_PC',
      'QL_EVENT_DEPOSITED_MON_PC',
    ];
    if (blocked.some((n) => K[n] === eventId)) return true;
  }
  return false;
}

/** ShouldRegisterEvent_HandleBeatStoryTrainer: TRUE (don't record) for a defeated trainer outside the story's classes. */
function ShouldRegisterEvent_HandleBeatStoryTrainer(eventId: number, data: QuestLogEventData): boolean {
  if (eventId !== K.QL_EVENT_DEFEATED_TRAINER) return false;
  const trainerId = Number(data?.trainerId ?? 0);
  const trainerClass = questLogHost()?.trainerClass?.(trainerId) ?? -1;
  return !questLogData().storyTrainerClasses.some((c) => K[c] === trainerClass);
}

/** QL_EnableRecordingSteps */
export function QL_EnableRecordingSteps(): void {
  sStepRecordingMode = STEP_RECORDING_MODE_ENABLED;
}

/** sStepRecordingMode = STEP_RECORDING_MODE_DISABLED_UNTIL_DEPART (RecordEvent_UsedItem: an Escape Rope ends the scene) */
export function QL_DisableRecordingStepsUntilDepart(): void {
  sStepRecordingMode = STEP_RECORDING_MODE_DISABLED_UNTIL_DEPART;
}

/** ShouldRegisterEvent: start the event in a new scene (after the last one ran out of room). */
function ShouldRegisterEvent(eventId: number, data: QuestLogEventData): ScriptPtr | null {
  if (ShouldRegisterEvent_HandlePartyActions(eventId, data)) return null;
  if (!ShouldRegisterEvent_HandleDeparted(eventId, data)) return null;
  QL_StartRecordingAction(eventId);
  UpdateRepeatEventCounter(eventId);
  if (eventId === K.QL_EVENT_DEFEATED_WILD_MON) gQL.defeatedWildMonRecord = gQL.recordingPointer;
  else gQL.defeatedWildMonRecord = null;
  return recordEvent(eventId, gQL.recordingPointer, data);
}

/** TryDeferLinkEvent: the link events wait for QuestLog_StartRecordingInputsAfterDeferredEvent. */
function TryDeferLinkEvent(eventId: number, data: QuestLogEventData): boolean {
  if (!IS_LINK_QL_EVENT(eventId)) return false;
  ResetDeferredLinkEvent();
  sDeferredEvent.id = eventId;
  // These two events have no data, so no need to copy
  if (eventId !== K.QL_EVENT_USED_UNION_ROOM && eventId !== K.QL_EVENT_USED_UNION_ROOM_CHAT) sDeferredEvent.data = structuredClone(data);
  return true;
}

/** ResetDeferredLinkEvent */
export function ResetDeferredLinkEvent(): void {
  sDeferredEvent = { id: 0, data: null };
}

/** QuestLog_StartRecordingInputsAfterDeferredEvent (the cable club's return to the field; no callers until link play) */
export function QuestLog_StartRecordingInputsAfterDeferredEvent(): void {
  if (sDeferredEvent.id !== 0) {
    sLastDepartedLocation = 0;
    QL_StartRecordingAction(sDeferredEvent.id);
    gQL.recordingPointer = recordEvent(sDeferredEvent.id, gQL.recordingPointer, sDeferredEvent.data);
    ResetDeferredLinkEvent();
  }
}

/** TryDeferTrainerBattleEvent: a trainer battle's event waits for the battle's end (QuestLogEvents_HandleEndTrainerBattle). */
function TryDeferTrainerBattleEvent(eventId: number, data: QuestLogEventData): boolean {
  if (
    eventId !== K.QL_EVENT_DEFEATED_TRAINER &&
    eventId !== K.QL_EVENT_DEFEATED_GYM_LEADER &&
    eventId !== K.QL_EVENT_DEFEATED_E4_MEMBER &&
    eventId !== K.QL_EVENT_DEFEATED_CHAMPION
  ) {
    return false;
  }
  ResetDeferredLinkEvent();
  const state = questLogHost()!.state;
  if (gQL.playbackState !== K.QL_PLAYBACK_STATE_STOPPED || state.getFlag(K.FLAG_SYS_GAME_CLEAR) || !ShouldRegisterEvent_HandleBeatStoryTrainer(eventId, data)) {
    sDeferredEvent.id = eventId;
    sDeferredEvent.data = structuredClone(data);
  }
  return true;
}

/** QuestLogEvents_HandleEndTrainerBattle (CB2_EndTrainerBattle): the deferred trainer battle, then the scene ends. */
export function QuestLogEvents_HandleEndTrainerBattle(): void {
  if (sDeferredEvent.id !== 0) {
    if (gQL.playbackState === K.QL_PLAYBACK_STATE_STOPPED) {
      sLastDepartedLocation = 0;
      QL_StartRecordingAction(sDeferredEvent.id);
    }
    UpdateRepeatEventCounter(sDeferredEvent.id);
    gQL.recordingPointer = recordEvent(sDeferredEvent.id, gQL.recordingPointer, sDeferredEvent.data);
    QL_RecordWait(1);
    ResetDeferredLinkEvent();
    QL_FinishRecordingScene();
  }
}

/** QL_RecordWait: a WAIT command, and the action index moves on. */
export function QL_RecordWait(duration: number): void {
  gQL.recordingPointer = QL_RecordAction_Wait(gQL.recordingPointer, duration);
  gQL.curActionIdx++;
}

/** IsEventWithSpecialEncounterSpecies (a wild battle with Snorlax, the legendaries, ...) */
function IsEventWithSpecialEncounterSpecies(eventId: number, data: QuestLogEventData): boolean {
  if (eventId !== K.QL_EVENT_DEFEATED_WILD_MON) return false;
  return IsSpeciesFromSpecialEncounter(Number(data?.defeatedSpecies ?? 0)) || IsSpeciesFromSpecialEncounter(Number(data?.caughtSpecies ?? 0));
}

/** IsSpeciesFromSpecialEncounter */
function IsSpeciesFromSpecialEncounter(species: number): boolean {
  return questLogData().specialEncounterSpecies.some((s) => constant(s) === species);
}

// ------------------------------------------------------------------ reading the stream (playback)

/**
 * QL_SkipCommand: the cursor after the event command at `cur` (null for an invalid one); `prev` gets `cur`.
 * (QL_EVENT_DEFEATED_CHAMPION never repeats: its count is ignored.)
 */
export function QL_SkipCommand(cur: ScriptPtr, prev: { ptr: ScriptPtr | null }): ScriptPtr | null {
  const word = scriptOf(cur)[cur.pos];
  const eventId = word & QL_CMD_EVENT_MASK;
  let count = word >> QL_CMD_COUNT_SHIFT;
  if (eventId === K.QL_EVENT_DEFEATED_CHAMPION) count = 0;
  if (!IS_VALID_QL_EVENT(eventId)) return null;
  prev.ptr = cur;
  const size = QL_EventCmdSize(eventId);
  return { scene: cur.scene, pos: cur.pos + (size + (size - CMD_HEADER_SIZE) * count) / 2 };
}

/** QL_UpdateLastDepartedLocation (the scene's first event, when playback reads it) */
export function QL_UpdateLastDepartedLocation(eventData: ScriptPtr): void {
  const script = scriptOf(eventData);
  if ((script[eventData.pos] & QL_CMD_EVENT_MASK) !== K.QL_EVENT_DEPARTED) sLastDepartedLocation = 0;
  else sLastDepartedLocation = (script[eventData.pos + 2] >> 8) + 1; // r2[1]: the locationId byte
}

/** QL_LoadEvent: the event at `eventData` once the playback reached its action index. */
export function QL_LoadEvent(eventData: ScriptPtr | null, curActionIdx: number): boolean {
  if (eventData === null) return false;
  const script = scriptOf(eventData);
  if (script[eventData.pos + 1] > curActionIdx) return false;
  ensureEventTables();
  sLoadEventFuncs.get(script[eventData.pos] & QL_CMD_EVENT_MASK)?.(eventData);
  gQuestLogRepeatEventTracker.id = script[eventData.pos] & 0xff;
  gQuestLogRepeatEventTracker.numRepeats = (script[eventData.pos] & QL_CMD_COUNT_MASK) >> QL_CMD_COUNT_SHIFT;
  if (gQuestLogRepeatEventTracker.numRepeats !== 0) gQuestLogRepeatEventTracker.counter = 1;
  return true;
}

/** QL_TryRepeatEvent: the next copy of a repeated event. */
export function QL_TryRepeatEvent(eventData: ScriptPtr): boolean {
  // This is the first for a new event, do nothing. Counter may be changed later by QL_LoadEvent.
  if (gQuestLogRepeatEventTracker.counter === 0) return false;
  ensureEventTables();
  sLoadEventFuncs.get(gQuestLogRepeatEventTracker.id)?.(eventData);
  if (++gQuestLogRepeatEventTracker.counter > gQuestLogRepeatEventTracker.numRepeats) QL_ResetRepeatEventTracker();
  return true;
}

/** QL_ResetRepeatEventTracker */
export function QL_ResetRepeatEventTracker(): void {
  gQuestLogRepeatEventTracker.id = 0;
  gQuestLogRepeatEventTracker.numRepeats = 0;
  gQuestLogRepeatEventTracker.counter = 0;
}

/** UpdateRepeatEventCounter: the same event again at the same action index is a repeat (up to one over the max). */
function UpdateRepeatEventCounter(eventId: number): void {
  const t = gQuestLogRepeatEventTracker;
  if (t.id !== (eventId & 0xff) || t.counter !== gQL.curActionIdx) {
    t.id = eventId & 0xff;
    t.numRepeats = 0;
    t.counter = gQL.curActionIdx & 0xffff;
  } else if (t.numRepeats < MAX_CMD_REPEAT + 1) {
    // Allow 1 over the max. It will be recorded temporarily, ultimately replacing the oldest record.
    t.numRepeats++;
  }
}

/** QL_ResetEventStates */
export function QL_ResetEventStates(): void {
  sNewlyEnteredMap = false;
  sLastDepartedLocation = 0;
  sPlayedTheSlots = false;
}

// ------------------------------------------------------------------ the action codecs

function writeBytes(script: number[], pos: number, b: readonly number[]): void {
  script[pos] = (b[0] & 0xff) | ((b[1] & 0xff) << 8);
  script[pos + 1] = (b[2] & 0xff) | ((b[3] & 0xff) << 8);
}

function readBytes(script: number[], pos: number): [number, number, number, number] {
  return [script[pos] & 0xff, script[pos] >> 8, script[pos + 1] & 0xff, script[pos + 1] >> 8];
}

const advance = (p: ScriptPtr, n: number): ScriptPtr => ({ scene: p.scene, pos: p.pos + n });

/** QL_RecordAction_SceneEnd */
export function QL_RecordAction_SceneEnd(a0: ScriptPtr | null): ScriptPtr | null {
  if (!QL_IsRoomToSaveAction(a0, QL_EventCmdSize(K.QL_EVENT_SCENE_END))) return null;
  scriptOf(a0!)[a0!.pos] = K.QL_EVENT_SCENE_END;
  return advance(a0!, 1);
}

/** QL_LoadAction_SceneEnd */
export function QL_LoadAction_SceneEnd(a0: ScriptPtr | null, a1: QuestLogAction): ScriptPtr | null {
  if (!QL_IsRoomToSaveAction(a0, QL_EventCmdSize(K.QL_EVENT_SCENE_END))) return null;
  a1.type = K.QL_ACTION_SCENE_END;
  a1.duration = 0;
  a1.data = [0, 0, 0, 0];
  return advance(a0!, 1);
}

/** QL_RecordAction_Wait */
export function QL_RecordAction_Wait(a0: ScriptPtr | null, duration: number): ScriptPtr | null {
  if (!QL_IsRoomToSaveAction(a0, QL_EventCmdSize(K.QL_EVENT_WAIT))) return null;
  const script = scriptOf(a0!);
  script[a0!.pos] = K.QL_EVENT_WAIT;
  script[a0!.pos + 1] = duration & 0xffff;
  return advance(a0!, 2);
}

/** QL_LoadAction_Wait */
export function QL_LoadAction_Wait(a0: ScriptPtr | null, a1: QuestLogAction): ScriptPtr | null {
  if (!QL_IsRoomToSaveAction(a0, QL_EventCmdSize(K.QL_EVENT_WAIT))) return null;
  a1.type = K.QL_ACTION_WAIT;
  a1.duration = scriptOf(a0!)[a0!.pos + 1];
  a1.data = [0, 0, 0, 0];
  return advance(a0!, 2);
}

/** QL_RecordAction_Input (also what TryRecordActionSequence writes for any action that isn't a movement or gfx change) */
export function QL_RecordAction_Input(script: ScriptPtr | null, a1: QuestLogAction): ScriptPtr | null {
  if (!QL_IsRoomToSaveAction(script, QL_EventCmdSize(K.QL_EVENT_INPUT))) return null;
  const s = scriptOf(script!);
  s[script!.pos] = K.QL_EVENT_INPUT;
  s[script!.pos + 1] = a1.duration & 0xffff;
  writeBytes(s, script!.pos + 2, a1.data);
  return advance(script!, 4);
}

/** QL_LoadAction_Input */
export function QL_LoadAction_Input(a0: ScriptPtr | null, a1: QuestLogAction): ScriptPtr | null {
  if (!QL_IsRoomToSaveAction(a0, QL_EventCmdSize(K.QL_EVENT_INPUT))) return null;
  const s = scriptOf(a0!);
  a1.type = K.QL_ACTION_INPUT;
  a1.duration = s[a0!.pos + 1];
  a1.data = readBytes(s, a0!.pos + 2);
  return advance(a0!, 4);
}

/** QL_RecordAction_MovementOrGfxChange */
export function QL_RecordAction_MovementOrGfxChange(script: ScriptPtr | null, a1: QuestLogAction): ScriptPtr | null {
  if (!QL_IsRoomToSaveAction(script, QL_EventCmdSize(K.QL_EVENT_MOVEMENT))) return null;
  const s = scriptOf(script!);
  s[script!.pos] = a1.type === K.QL_ACTION_MOVEMENT ? K.QL_EVENT_MOVEMENT : K.QL_EVENT_GFX_CHANGE;
  s[script!.pos + 1] = a1.duration & 0xffff;
  writeBytes(s, script!.pos + 2, a1.data);
  return advance(script!, 4);
}

/** QL_LoadAction_MovementOrGfxChange */
export function QL_LoadAction_MovementOrGfxChange(a0: ScriptPtr | null, a1: QuestLogAction): ScriptPtr | null {
  if (!QL_IsRoomToSaveAction(a0, QL_EventCmdSize(K.QL_EVENT_MOVEMENT))) return null;
  const s = scriptOf(a0!);
  a1.type = s[a0!.pos] === K.QL_EVENT_MOVEMENT ? K.QL_ACTION_MOVEMENT : K.QL_ACTION_GFX_CHANGE;
  a1.duration = s[a0!.pos + 1];
  a1.data = readBytes(s, a0!.pos + 2);
  return advance(a0!, 4);
}

// ------------------------------------------------------------------ the event header

/**
 * RecordEventHeader: the header (or, for a repeat, the header's count) and the cursor where the event's data goes.
 * A repeat past MAX_CMD_REPEAT drops the oldest copy.
 */
export function RecordEventHeader(eventId: number, dest: ScriptPtr | null): ScriptPtr | null {
  const t = gQuestLogRepeatEventTracker;
  // in u16s (every size is even)
  const cmdSize = (t.numRepeats === 0 ? QL_EventCmdSize(eventId) : QL_EventCmdSize(eventId) - CMD_HEADER_SIZE) / 2;
  const header = CMD_HEADER_SIZE / 2;
  if (!QL_IsRoomToSaveEvent(dest, cmdSize * 2)) return null;
  let record = dest!;
  if (t.numRepeats !== 0) record = advance(record, -(t.numRepeats * cmdSize + header));
  const script = scriptOf(record);
  let count: number;
  if (t.numRepeats === MAX_CMD_REPEAT + 1) {
    // Shift back one, replacing oldest
    for (let i = 0; i < MAX_CMD_REPEAT; i++) {
      const to = record.pos + i * cmdSize + header;
      const from = record.pos + (i + 1) * cmdSize + header;
      for (let k = 0; k < cmdSize; k++) script[to + k] = script[from + k];
    }
    count = MAX_CMD_REPEAT;
  } else {
    count = t.numRepeats;
  }
  script[record.pos] = (eventId + (count << QL_CMD_COUNT_SHIFT)) & 0xffff;
  script[record.pos + 1] = gQL.curActionIdx & 0xffff;
  return advance(record, count * cmdSize + header);
}

/** LoadEvent: the data of the repeat the tracker is on. */
export function LoadEvent(eventId: number, eventData: ScriptPtr): ScriptPtr {
  const size = QL_EventCmdSize(eventId);
  return advance(eventData, (gQuestLogRepeatEventTracker.counter * (size - CMD_HEADER_SIZE) + CMD_HEADER_SIZE) / 2);
}

// ------------------------------------------------------------------ QL_EVENT_DEPARTED

/** RecordEvent_DepartedLocation: [mapSec, locationId] bytes. Leaving the Safari Zone stops recording steps. */
function RecordEvent_DepartedLocation(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const record = RecordEventHeader(K.QL_EVENT_DEPARTED, dest);
  if (record === null) return null;
  const d = data as unknown as QuestLogEventDeparted;
  scriptOf(record)[record.pos] = (d.mapSec & 0xff) | ((d.locationId & 0xff) << 8);
  if (d.locationId === K.QL_LOCATION_SAFARI_ZONE) sStepRecordingMode = STEP_RECORDING_MODE_DISABLED;
  return advance(record, 1);
}

/** LoadEvent_DepartedLocation's data (QL2 picks the text: sLocationToDepartedTextId, the gym's badge check). */
function LoadEvent_DepartedLocation(eventData: ScriptPtr): QuestLogEventDeparted & { next: ScriptPtr } {
  const record = LoadEvent(K.QL_EVENT_DEPARTED, eventData);
  const w = scriptOf(record)[record.pos];
  return { mapSec: w & 0xff, locationId: w >> 8, next: advance(record, 1) };
}

/** SetQLPlayedTheSlots (the slot machine; QL4 calls it) */
export function SetQLPlayedTheSlots(): void {
  sPlayedTheSlots = true;
}

/** ShouldRegisterEvent_HandleDeparted: the same departure twice in a row isn't recorded again. */
function ShouldRegisterEvent_HandleDeparted(eventId: number, data: QuestLogEventData): boolean {
  if (eventId !== K.QL_EVENT_DEPARTED) {
    sLastDepartedLocation = 0;
    return true;
  }
  const d = data as unknown as QuestLogEventDeparted;
  if (sLastDepartedLocation === d.locationId + 1) return false;
  sLastDepartedLocation = d.locationId + 1;
  return true;
}

/** ShouldRegisterEvent_DepartedGameCorner: leaving the Game Corner counts only after playing the slots. */
function ShouldRegisterEvent_DepartedGameCorner(eventId: number, data: QuestLogEventData): boolean {
  if (eventId !== K.QL_EVENT_DEPARTED) return true;
  const d = data as unknown as QuestLogEventDeparted;
  if (d.locationId === K.QL_LOCATION_GAME_CORNER && !sPlayedTheSlots) return false;
  sPlayedTheSlots = false;
  return true;
}

// ------------------------------------------------------------------ QL_EVENT_ARRIVED

/** QuestLog_RecordEnteredMap (`setworldmapflag`, before it sets the flag): a town entered for the first time. */
export function QuestLog_RecordEnteredMap(worldMapFlag: number): void {
  const host = questLogHost();
  if (!host) return;
  if (gQL.state === K.QL_STATE_PLAYBACK || gQL.state === K.QL_STATE_PLAYBACK_LAST) return; // QL_IS_PLAYBACK_STATE
  for (const name of questLogData().worldMapFlags) {
    if (worldMapFlag === K[name]) {
      sNewlyEnteredMap = !host.state.getFlag(worldMapFlag);
      break;
    }
  }
}

/** SetQuestLogEvent_Arrived (OverworldBasic, every frame) */
export function SetQuestLogEvent_Arrived(): void {
  const host = questLogHost();
  if (!host) return;
  if (gQL.state === K.QL_STATE_PLAYBACK || gQL.state === K.QL_STATE_PLAYBACK_LAST) return;
  if (sNewlyEnteredMap) {
    SetQuestLogEvent(K.QL_EVENT_ARRIVED, { mapSec: host.mapSec() });
    sNewlyEnteredMap = false;
  }
}

/** RecordEvent_ArrivedInLocation: [mapSec] */
function RecordEvent_ArrivedInLocation(dest: ScriptPtr | null, data: QuestLogEventData): ScriptPtr | null {
  const record = RecordEventHeader(K.QL_EVENT_ARRIVED, dest);
  if (record === null) return null;
  scriptOf(record)[record.pos] = Number((data as unknown as QuestLogEventArrived).mapSec) & 0xffff;
  return advance(record, 1);
}

/** LoadEvent_ArrivedInLocation's data (QL2: gText_QuestLog_ArrivedInLocation with the map name) */
function LoadEvent_ArrivedInLocation(eventData: ScriptPtr): QuestLogEventArrived & { next: ScriptPtr } {
  const record = LoadEvent(K.QL_EVENT_ARRIVED, eventData);
  return { mapSec: scriptOf(record)[record.pos] & 0xff, next: advance(record, 1) };
}

/** For tests: the step recording mode and the departure filter's memory. */
export function questLogEventsDebugState() {
  return { stepRecordingMode: sStepRecordingMode, lastDepartedLocation: sLastDepartedLocation, newlyEnteredMap: sNewlyEnteredMap, deferredEvent: sDeferredEvent.id };
}
