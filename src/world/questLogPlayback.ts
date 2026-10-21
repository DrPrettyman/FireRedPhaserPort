// quest_log.c's playback (QUEST_LOG_PLAN.md QL2a): CONTINUE with saved scenes plays them back before the field
// (TryStartQuestLogPlayback), each scene from its snapshot (QLPlayback_InitOverworldState and overworld.c's
// LoadMap_QLPlayback: the scene's flags and vars, placeholder party and boxes, the objects and templates), driven by
// its recorded actions (questLog.ts: QL_TryRunActions, QL_UpdateObject, gQuestLogFieldInput) and events
// (QLogCB_Playback); A skips to the next scene, B to the end (QL_HandleInput). The end reloads the save
// (QuestLog_StartFinalScene's LoadGameSave), so nothing playback changed survives, and hands the field back
// (Task_FinalScene_WaitFade ... Task_EndQuestLog).
//
// The screen (the tints, the top and bottom bars, the description window, the texts and the music) is
// world/questLogScreen.ts: each C function that draws has its seam below (`questLogScreen`), which it fills in
// (installQuestLogScreen; unit tests run without it).
//
// No Phaser here: OverworldScene implements QuestLogPlaybackHost (the map loads, the fades, the controls, the tasks).

import { K } from '../battle/constants';
import { ClearPCItemSlots } from '../state/pcItems';
import { boxMonFromMon } from '../state/PokemonStorage';
import { EOS, gStringVar4 } from '../menus/common';
import type { GameState } from '../state/GameState';
import { CHAR_NEWLINE } from '../text/charmap';
import { HelpSystem_Disable, HelpSystem_Enable } from '../ui/helpSystemContext';
import { HandleEnforcedLookDirectionOnPlayerStopMoving, StopPlayerAvatar } from './playerAvatar';
import {
  gQL,
  QL_InitSceneActions,
  QUEST_LOG_EVENT_DATA_COUNT,
  QUEST_LOG_SCENE_COUNT,
  questLogEventData,
  questLogHost,
  ReadQuestLogScriptFromSav1,
  registerAvoidDisplayTask,
  registerQLogCBPlayback,
  SetQuestLogState,
  setQuestLogCB,
  type QuestLogScene,
} from './questLog';
import { gQuestLogRepeatEventTracker, QL_EnableRecordingSteps, QL_LoadEvent, QL_TryRepeatEvent } from './questLogEvents';

// ------------------------------------------------------------------ state

const END_MODE_NONE = 0;
const END_MODE_FINISH = 1;
const END_MODE_SCENE = 2;

/** struct PlaybackControl (sPlaybackControl) */
interface PlaybackControl {
  /** 0 running, 1 an event's text up (the overworld waits), 2 the scene just loaded */
  state: number;
  playingEvent: boolean;
  /** END_MODE_NONE / FINISH (B) / SCENE (A, or the scene ran out) */
  endMode: number;
  /** the next sEventData entry */
  cursor: number;
  /** u8: frames the event's text stays up */
  timer: number;
  overlapTimer: number;
}

const emptyPlaybackControl = (): PlaybackControl => ({ state: 0, playingEvent: false, endMode: END_MODE_NONE, cursor: 0, timer: 0, overlapTimer: 0 });

let sPlaybackControl = emptyPlaybackControl();
/** sNumScenes: the scenes left to play (DrawPreviouslyOnQuestHeader numbers them) */
let sNumScenes = 0;
/** From TryStartQuestLogPlayback to Task_EndQuestLog's last step: the field isn't the player's. */
let sPlaybackActive = false;
/**
 * The playback's map loads so far: the GBA's map loads (ResumeMap's ResetTasks) end every task, and the port's field
 * tasks outlive a map load, so a task of one scene (Task_AvoidDisplay) ends itself when the next one loads.
 */
let sMapLoads = 0;
/** For tests: the Task_AvoidDisplay tasks created so far and the live ones' tTimer / tState. */
let sAvoidDisplayCount = 0;
const sAvoidDisplayTasks = new Set<{ tTimer: number; tState: number }>();

/** What quest_log.c's playback asks of the field. OverworldScene implements it. */
export interface QuestLogPlaybackHost {
  /**
   * QLPlayback_SetInitialPlayerPosition + CB2_SetUpOverworldForQLPlayback(WithWarpExit): load the scene's map as
   * LoadMap_QLPlayback does (QL_CopySaveState, QL_ResetPartyAndPC, the map, QL_InitSceneObjectsAndActions, the
   * objects, QL_TryStopSurfing), then FieldCB2_QuestLogStartPlayback*: QL_StartPlaybackScene and the warp exit (or
   * the fade in from black). Asynchronous: the field ticks on, its CB1 held off, while it loads.
   */
  setUpOverworldForQLPlayback(scene: QuestLogScene, isWarp: boolean): void;
  /**
   * QuestLog_StartFinalScene's LoadGameSave(SAVE_NORMAL), then CB2_EnterFieldFromQuestLog (CB2_ContinueSavedGame's
   * steps) with FieldCB2_FinalScene as the field callback. Asynchronous too.
   */
  enterFieldFromQuestLog(): void;
  /** FadeScreen(FADE_TO_BLACK, delay) */
  fadeScreenToBlack(delay: number): void;
  /** gPaletteFade.active */
  paletteFadeActive(): boolean;
  /** FieldCB_WarpExitFadeFromBlack (FieldCB2_FinalScene) */
  warpExitFadeFromBlack(): void;
  lockPlayerFieldControls(): void;
  unlockPlayerFieldControls(): void;
  /** CreateTask: `tick` runs once per frame until it returns true */
  createTask(tick: () => boolean): void;
  freezeObjectEvents(): void;
  /** ClearPlayerHeldMovementAndUnfreezeObjectEvents */
  clearPlayerHeldMovementAndUnfreezeObjectEvents(): void;
  /** DisableWildEncounters */
  disableWildEncounters(disabled: boolean): void;
  /** ShowMapNamePopup(TRUE) */
  showMapNamePopup(): void;
  /** JOY_NEW(A_BUTTON) / JOY_NEW(B_BUTTON) this frame */
  newKeys(): { a: boolean; b: boolean };
}

let sHost: QuestLogPlaybackHost | undefined;

export function setQuestLogPlaybackHost(host: QuestLogPlaybackHost | undefined): void {
  sHost = host;
}

function host(): QuestLogPlaybackHost {
  if (!sHost) throw new Error('[quest log] no playback host');
  return sHost;
}

function state(): GameState {
  const h = questLogHost();
  if (!h) throw new Error('[quest log] no host');
  return h.state;
}

// ------------------------------------------------------------------ the screen's seams

/**
 * The C functions that draw the playback's screen and play its music: world/questLogScreen.ts fills them in. Each call
 * is noted too (for tests: `questLogPlaybackDebugState().screenCalls`).
 */
export const questLogScreen = {
  /** gGlobalFieldTintMode = mode (QL_TINT_*): CB2_SetUpOverworldForQLPlayback* GRAYSCALE, CB2_EnterFieldFromQuestLog BACKUP_GRAYSCALE, Task_EndQuestLog NONE */
  setGlobalFieldTintMode: (_mode: number): void => {},
  /** DrawPreviouslyOnQuestHeader(sceneNum): the top and bottom bars, "Previously on your quest…" and the scene number */
  drawPreviouslyOnQuestHeader: (_sceneNum: number): void => {},
  /** DrawSceneDescription: gStringVar4 in the description window */
  drawSceneDescription: (): void => {},
  /** QuestLog_CloseTextWindow */
  closeTextWindow: (): void => {},
  /** Task_QuestLogScene_SavedGame: "<player> saved the game at <place>." (gText_QuestLog_SavedGameAtLocation) */
  drawSavedGameText: (): void => {},
  /** Task_EndQuestLog's state 0: gDisableMapMusicChangeOnMapLoad = 0, Overworld_PlaySpecialMapMusic, QL_SlightlyDarkenSomePals, the top bar cleared */
  beginEnd: (): void => {},
  /** RestoreScreenAfterPlayback's frame `timer` (0-15): the bars scroll off, the tint fades */
  restoreScreenAfterPlayback: (_timer: number): void => {},
  /** Task_EndQuestLog's case 1, after RestoreScreenAfterPlayback: ClearWindowTilemap / RemoveWindow for the three windows */
  removeWindows: (): void => {},
  /** Task_EndQuestLog's last step: sPalettesBackup back into gPlttBufferUnfaded */
  finishEnd: (): void => {},
  /** Task_BeginQuestLogPlayback: gDisableMapMusicChangeOnMapLoad = 1 */
  disableMapMusicChange: (): void => {},
  /** A new game or a soft reset: gGlobalFieldTintMode and the windows as at boot */
  reset: (): void => {},
};

const sScreenCalls: string[] = [];

function screen<Kk extends keyof typeof questLogScreen>(name: Kk, ...args: Parameters<(typeof questLogScreen)[Kk]>): void {
  sScreenCalls.push(name);
  if (sScreenCalls.length > 64) sScreenCalls.shift();
  (questLogScreen[name] as (...a: unknown[]) => void)(...args);
}

// ------------------------------------------------------------------ starting

/**
 * TryStartQuestLogPlayback (main_menu.c's CONTINUE): with saved scenes, the help system off and the first scene
 * loads (Task_BeginQuestLogPlayback); true. Without, false: CB2_ContinueSavedGame.
 */
export function TryStartQuestLogPlayback(gs: GameState): boolean {
  QL_EnableRecordingSteps();
  sNumScenes = 0;
  for (let i = 0; i < QUEST_LOG_SCENE_COUNT; i++) if (gs.questLog[i].startType !== 0) sNumScenes++;
  if (sNumScenes === 0) return false;
  HelpSystem_Disable(); // gHelpSystemEnabled = FALSE
  sPlaybackActive = true;
  Task_BeginQuestLogPlayback();
  return true;
}

/** Task_BeginQuestLogPlayback (gSaveBlock1Ptr->location = Route 1 / WARP_ID_NONE: the scene's own replaces it) */
function Task_BeginQuestLogPlayback(): void {
  gQL.currentSceneNum = 0;
  registerAvoidDisplayTask(startAvoidDisplayTask); // (as QL_StartPlaybackScene: a scene's map scripts run before it)
  screen('disableMapMusicChange');
  host().disableWildEncounters(true);
  QLPlayback_InitOverworldState();
}

/** ResetSpecialVars: gSpecialVar_0x8000 ... gSpecialVar_0x8014 */
export function ResetSpecialVars(gs: GameState): void {
  for (let v = 0x8000; v <= 0x8014; v++) gs.setVar(v, 0);
}

/** ClearBag */
function ClearBag(gs: GameState): void {
  const none = gs.defines.require('ITEM_NONE');
  for (const pocket of gs.bag.pockets) for (const slot of pocket) Object.assign(slot, { itemId: none, quantity: 0 });
}

/**
 * QLPlayback_InitOverworldState: playback state, the special vars, the bag and the PC's items cleared, then the
 * scene's map (standing in place, or arriving through its warp).
 */
function QLPlayback_InitOverworldState(): void {
  const gs = state();
  sMapLoads++; // (CB2_SetUpOverworldForQLPlayback's ResetTasks)
  gQL.state = K.QL_STATE_PLAYBACK;
  setQuestLogCB(null); // (CB1_Overworld doesn't run while CB2 loads the map)
  ResetSpecialVars(gs);
  ClearBag(gs);
  ClearPCItemSlots(gs.pcItems, gs.defines.require('ITEM_NONE'));
  const scene = gs.questLog[gQL.currentSceneNum];
  screen('setGlobalFieldTintMode', K.QL_TINT_GRAYSCALE); // CB2_SetUpOverworldForQLPlayback(WithWarpExit)
  host().setUpOverworldForQLPlayback(scene, scene.startType !== K.QL_START_NORMAL);
}

/** QL_CopySaveState (LoadMap_QLPlayback): the scene's flags and vars replace the save's, then RestoreTrainerRematches. */
export function QL_CopySaveState(gs: GameState): void {
  const questLog = gs.questLog[gQL.currentSceneNum];
  for (const f of gs.flagIds()) if (f < K.SPECIAL_FLAGS_START) gs.setFlag(f, false);
  for (const f of questLog.flags) gs.setFlag(f, true);
  for (const [v] of gs.varEntries()) if (v >= K.VARS_START && v <= K.VARS_END) gs.setVar(v, 0);
  for (const [v, value] of questLog.vars) gs.setVar(v, value);
  RestoreTrainerRematches(gs);
}

/** RestoreTrainerRematches: BackUpTrainerRematches' bits back (30 for a set one). */
function RestoreTrainerRematches(gs: GameState): void {
  for (let i = 0; i < 4; i++) {
    let v = gs.getVar(K.VAR_QLBAK_TRAINER_REMATCHES + i);
    for (let j = 0; j < 16; j++) {
      gs.trainerRematches[16 * i + j] = v & 1 ? 30 : 0;
      v >>= 1;
    }
  }
}

const NUM_PC_COUNT_BITS = 12;

/**
 * QL_ResetPartyAndPC: the party and the boxes as many as the scene had (VAR_QUEST_LOG_MON_COUNTS): extra party slots
 * from the end and extra box mons from the first emptied, missing ones filled with a level 1 Rattata (with too few
 * in the party, box 0's first five slots are cleared too, as the C does).
 */
export function QL_ResetPartyAndPC(gs: GameState): void {
  const packed = gs.getVar(K.VAR_QUEST_LOG_MON_COUNTS);
  const prevPartyCount = packed >> NUM_PC_COUNT_BITS;
  const prevBoxMonCount = packed % (1 << NUM_PC_COUNT_BITS);
  // CreateMon(SPECIES_RATTATA, 1, USE_RANDOM_IVS, FALSE, 0, OT_ID_PLAYER_ID, 0), copied into every slot
  const placeholder = () =>
    gs.pokemon.createMon(gs.defines.require('SPECIES_RATTATA'), 1, {
      otId: gs.trainerId,
      otName: gs.playerName,
      otGender: gs.playerGender,
      metLocation: gs.currentMapSection,
    });
  const PARTY_SIZE = 6;
  const slots: (GameState['party'][number] | null)[] = Array.from({ length: PARTY_SIZE }, (_, i) => gs.party[i] ?? null);
  let count = slots.filter((m) => m && m.species !== 0).length; // QuestLog_GetPartyCount
  if (count > prevPartyCount) {
    for (let i = 0; i < count - prevPartyCount; i++) slots[PARTY_SIZE - 1 - i] = null; // ZeroMonData
  } else if (count < prevPartyCount) {
    for (let i = 0; i < PARTY_SIZE - 1; i++) gs.storage.zeroBoxMonAt(0, i);
    for (let i = count; i < prevPartyCount; i++) slots[i] = placeholder();
  }
  gs.party = slots.filter((m): m is NonNullable<typeof m> => m !== null);

  const boxes = gs.storage.boxes;
  count = 0;
  for (const box of boxes) for (const mon of box) if (mon && mon.species !== 0) count++; // QuestLog_GetBoxMonCount
  if (count > prevBoxMonCount) {
    outer: for (let i = 0; i < boxes.length; i++) {
      for (let j = 0; j < boxes[i].length; j++) {
        const mon = boxes[i][j];
        if (mon && mon.species !== 0) {
          gs.storage.zeroBoxMonAt(i, j);
          if (--count === prevBoxMonCount) break outer;
        }
      }
    }
  } else if (count < prevBoxMonCount) {
    outer: for (let i = 0; i < boxes.length; i++) {
      for (let j = 0; j < boxes[i].length; j++) {
        const mon = boxes[i][j];
        if (!mon || mon.species === 0) {
          gs.storage.setBoxMonAt(i, j, boxMonFromMon(placeholder()));
          if (++count === prevBoxMonCount) break outer;
        }
      }
    }
  }
}

/** QL_RestoreMapLayoutId (QL_LoadMapNormal): VAR_QLBAK_MAP_LAYOUT, or the map header's layout when it's 0. */
export function QL_RestoreMapLayoutId(gs: GameState, headerLayoutId: number): number {
  gs.mapLayoutId = gs.getVar(K.VAR_QLBAK_MAP_LAYOUT);
  if (gs.mapLayoutId === 0) gs.mapLayoutId = headerLayoutId;
  return gs.mapLayoutId;
}

/** QL_InitSceneObjectsAndActions' actions (the objects and templates are the host's: questLogObjects.ts) */
export { QL_InitSceneActions };

/**
 * FieldCB2_QuestLogStartPlaybackWithWarpExit / _StandingInPlace's quest log part (the host then runs the warp exit
 * or FieldCB_WarpExitFadeFromBlack): playback state with QLogCB_Playback, sPlaybackControl reset to "just loaded".
 */
export function QL_StartPlaybackScene(): void {
  // (registered here, not at module load: questLog.ts and this module import each other through trainerSee.ts)
  registerQLogCBPlayback(QLogCB_Playback);
  registerAvoidDisplayTask(startAvoidDisplayTask);
  SetQuestLogState(K.QL_STATE_PLAYBACK);
  sPlaybackControl = emptyPlaybackControl();
  sPlaybackControl.state = 2;
}

// ------------------------------------------------------------------ CB1: the events and the input

/**
 * QLogCB_Playback (RunQuestLogCB while the controls are free): play the scene's events as their action indices come
 * up; when the actions have stopped and no event is left, end the scene (fade to black, then the next).
 */
function QLogCB_Playback(): void {
  if (sPlaybackControl.state === 2) sPlaybackControl.state = 0;
  if (sPlaybackControl.endMode !== END_MODE_NONE) return;
  if (
    gQL.playbackState !== K.QL_PLAYBACK_STATE_STOPPED ||
    sPlaybackControl.state === 1 ||
    (sPlaybackControl.cursor < QUEST_LOG_EVENT_DATA_COUNT && questLogEventData(sPlaybackControl.cursor) !== null)
  ) {
    QuestLog_PlayCurrentEvent();
  } else {
    sPlaybackControl.endMode = END_MODE_SCENE;
    host().lockPlayerFieldControls();
    DoSceneEndTransition(0);
  }
}

/** QuestLog_PlayCurrentEvent */
function QuestLog_PlayCurrentEvent(): void {
  if (sPlaybackControl.state === 1) {
    if (--sPlaybackControl.timer !== 0) return;
    sPlaybackControl.state = 0;
    sPlaybackControl.playingEvent = true;
    TogglePlaybackStateForOverworldLock(2);
  }
  if (sPlaybackControl.playingEvent) {
    if (++sPlaybackControl.overlapTimer > 15) {
      QuestLog_CloseTextWindow();
      sPlaybackControl.playingEvent = false;
      sPlaybackControl.overlapTimer = 0;
    }
  }
  if (sPlaybackControl.cursor < QUEST_LOG_EVENT_DATA_COUNT) {
    const ev = questLogEventData(sPlaybackControl.cursor);
    // QL_TryRepeatEvent reads its pointer only through the loaders (NULL is fine while the counter is 0)
    if ((ev && QL_TryRepeatEvent(ev)) || QL_LoadEvent(ev, gQL.curActionIdx)) HandleShowQuestLogMessage();
  }
}

/** HandleShowQuestLogMessage: the event's text up for GetQuestLogTextDisplayDuration frames; the overworld waits. */
function HandleShowQuestLogMessage(): void {
  if (sPlaybackControl.state === 0) {
    sPlaybackControl.state = 1;
    sPlaybackControl.playingEvent = false;
    sPlaybackControl.overlapTimer = 0;
    sPlaybackControl.timer = GetQuestLogTextDisplayDuration();
    if (gQuestLogRepeatEventTracker.counter === 0) sPlaybackControl.cursor++;
    if (sPlaybackControl.cursor > QUEST_LOG_EVENT_DATA_COUNT) return;
    screen('drawSceneDescription'); // DrawSceneDescription: gStringVar4, as the event's loader left it
  }
  TogglePlaybackStateForOverworldLock(1);
}

/** GetQuestLogTextDisplayDuration: by gStringVar4's length (newlines not counted). */
export function GetQuestLogTextDisplayDuration(text: readonly number[] = gStringVar4): number {
  let count = 0;
  for (let i = 0; i < 0x400 && i < text.length && text[i] !== EOS; i++) if (text[i] !== CHAR_NEWLINE) count++;
  if (count < 20) return 0x5f;
  if (count < 36) return 0x7f;
  if (count < 46) return 0xbf;
  return 0xff;
}

/** TogglePlaybackStateForOverworldLock: 1 holds the actions (RUNNING → ACTION_END) while a text is up, 2 lets them go. */
function TogglePlaybackStateForOverworldLock(a0: number): void {
  if (a0 === 1) {
    if (gQL.playbackState === K.QL_PLAYBACK_STATE_RUNNING) gQL.playbackState = K.QL_PLAYBACK_STATE_ACTION_END;
  } else if (a0 === 2) {
    if (gQL.playbackState === K.QL_PLAYBACK_STATE_ACTION_END) gQL.playbackState = K.QL_PLAYBACK_STATE_RUNNING;
  }
}

/** QuestLog_CloseTextWindow */
function QuestLog_CloseTextWindow(): void {
  screen('closeTextWindow');
}

/**
 * QL_IsTrainerSightDisabled (CheckForTrainersWantingBattle): in playback, trainers don't see the player while the
 * actions are stopped, an event's text is up or the scene has just loaded.
 */
export function QL_IsTrainerSightDisabled(): boolean {
  if (gQL.state !== K.QL_STATE_PLAYBACK) return false;
  return gQL.playbackState === K.QL_PLAYBACK_STATE_STOPPED || sPlaybackControl.state === 1 || sPlaybackControl.state === 2;
}

/** QL_HandleInput (DoCB1_Overworld_QuestLogPlayback): A skips to the next scene, B to the end. */
export function QL_HandleInput(): void {
  if (sPlaybackControl.endMode !== END_MODE_NONE) return;
  const keys = host().newKeys();
  if (keys.a) {
    sPlaybackControl.endMode = END_MODE_SCENE;
    gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
    DoSceneEndTransition(-3);
  } else if (keys.b) {
    sPlaybackControl.endMode = END_MODE_FINISH;
    gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
    DoSkipToEndTransition(-3);
  }
}

/** QuestLogScenePlaybackIsEnding */
export function QuestLogScenePlaybackIsEnding(): boolean {
  return sPlaybackControl.endMode !== END_MODE_NONE;
}

/** QuestLog_DrawPreviouslyOnQuestHeaderIfInPlaybackMode (the field effects that redraw the bars: QL5 calls it) */
export function QuestLog_DrawPreviouslyOnQuestHeaderIfInPlaybackMode(): void {
  if (gQL.state === K.QL_STATE_PLAYBACK) screen('drawPreviouslyOnQuestHeader', sNumScenes);
}

/** The scene number DrawPreviouslyOnQuestHeader shows for the scene being loaded (FieldCB2_QuestLogStartPlayback*'s field effects). */
export function questLogScenesLeft(): number {
  return sNumScenes;
}

// ------------------------------------------------------------------ scene ends

/** DoSceneEndTransition: fade to black, then QuestLog_AdvancePlayhead. */
function DoSceneEndTransition(delay: number): void {
  host().fadeScreenToBlack(delay);
  setQuestLogCB(QuestLog_AdvancePlayhead);
}

/** QuestLog_AdvancePlayhead: once the fade is done, the next scene, or the final one after the last. */
function QuestLog_AdvancePlayhead(): void {
  if (host().paletteFadeActive()) return;
  host().lockPlayerFieldControls();
  const gs = state();
  if (++gQL.currentSceneNum < QUEST_LOG_SCENE_COUNT && gs.questLog[gQL.currentSceneNum].startType !== 0) {
    sNumScenes--;
    QLPlayback_InitOverworldState();
  } else {
    gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
    QuestLog_StartFinalScene();
  }
}

/** QuestLog_AdvancePlayhead_ (CB2_LoadMap2: a warp in playback into a disabled location ends the scene) */
export function QuestLog_AdvancePlayhead_(): void {
  QuestLog_AdvancePlayhead();
}

/** QL_AvoidDisplay's PLAYBACK case: CreateTask(Task_AvoidDisplay, 80) with the callback. */
function startAvoidDisplayTask(callback: (() => void) | null): void {
  host().createTask(Task_AvoidDisplay(callback));
}

/**
 * Task_AvoidDisplay: instead of the display, 127 frames, then the scene ends (a fade to black, END_MODE_SCENE);
 * after the fade, the actions stop, the callback (QL_DestroyAbortedDisplay: the script becomes
 * EventScript_ReleaseEnd) runs and QuestLog_AdvancePlayhead loads the next scene. A map load ends it (ResetTasks:
 * A or B skipped the scene meanwhile).
 */
function Task_AvoidDisplay(callback: (() => void) | null): () => boolean {
  const data = { tTimer: 0, tState: 0 };
  const mapLoads = sMapLoads;
  sAvoidDisplayCount++;
  sAvoidDisplayTasks.add(data);
  const destroy = () => {
    sAvoidDisplayTasks.delete(data);
    return true;
  };
  return () => {
    if (sMapLoads !== mapLoads) return destroy();
    switch (data.tState) {
      case 0:
        if (++data.tTimer === 127) {
          // BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK): FadeScreen(FADE_TO_BLACK, 0)'s palette fade
          host().fadeScreenToBlack(0);
          sPlaybackControl.endMode = END_MODE_SCENE;
          data.tState++;
        }
        return false;
      default:
        if (host().paletteFadeActive()) return false;
        gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
        if (callback !== null) callback();
        setQuestLogCB(QuestLog_AdvancePlayhead);
        return destroy(); // DestroyTask
    }
  };
}

/** DoSkipToEndTransition: fade to black, then QuestLog_WaitFadeAndCancelPlayback. */
function DoSkipToEndTransition(delay: number): void {
  host().fadeScreenToBlack(delay);
  setQuestLogCB(QuestLog_WaitFadeAndCancelPlayback);
}

/** QuestLog_WaitFadeAndCancelPlayback: the remaining scenes read (sLastDepartedLocation as after them), then the end. */
function QuestLog_WaitFadeAndCancelPlayback(): void {
  if (host().paletteFadeActive()) return;
  host().lockPlayerFieldControls();
  const gs = state();
  for (; gQL.currentSceneNum < QUEST_LOG_SCENE_COUNT; gQL.currentSceneNum++) {
    if (gs.questLog[gQL.currentSceneNum].startType === 0) break;
    ReadQuestLogScriptFromSav1(gQL.currentSceneNum);
  }
  gQL.playbackState = K.QL_PLAYBACK_STATE_STOPPED;
  QuestLog_StartFinalScene();
}

/**
 * QuestLog_StartFinalScene: the special vars reset, the save loaded again (LoadGameSave: everything playback
 * changed goes), and the saved field entered (CB2_EnterFieldFromQuestLog, FieldCB2_FinalScene).
 */
function QuestLog_StartFinalScene(): void {
  ResetSpecialVars(state());
  // Save_ResetSaveCounters: the port's save has no sector counters
  gQL.state = K.QL_STATE_PLAYBACK_LAST;
  sMapLoads++; // (CB2_EnterFieldFromQuestLog's ResetTasks)
  setQuestLogCB(null);
  screen('setGlobalFieldTintMode', K.QL_TINT_BACKUP_GRAYSCALE); // CB2_EnterFieldFromQuestLog
  host().enterFieldFromQuestLog();
}

// ------------------------------------------------------------------ the final scene

/** FieldCB2_FinalScene (the host calls it once the saved field is loaded): the header, the fade in, Task_FinalScene_WaitFade. */
export function FieldCB2_FinalScene(): void {
  screen('drawPreviouslyOnQuestHeader', 0);
  host().warpExitFadeFromBlack();
  host().createTask(Task_FinalScene_WaitFade());
}

/** Task_FinalScene_WaitFade: once the fade in gave the controls back, stop everything and show where the game was saved. */
function Task_FinalScene_WaitFade(): () => boolean {
  let next: (() => boolean) | undefined;
  return () => {
    if (next) return next();
    if (questLogHost()?.fieldControlsLocked() !== true) {
      host().freezeObjectEvents();
      HandleEnforcedLookDirectionOnPlayerStopMoving();
      StopPlayerAvatar();
      host().lockPlayerFieldControls();
      next = Task_QuestLogScene_SavedGame();
    }
    return false;
  };
}

/** Task_QuestLogScene_SavedGame: after the fade, "saved the game at" (not after B), then wait. */
function Task_QuestLogScene_SavedGame(): () => boolean {
  let next: (() => boolean) | undefined;
  return () => {
    if (next) return next();
    if (!host().paletteFadeActive()) {
      if (sPlaybackControl.endMode !== END_MODE_FINISH) screen('drawSavedGameText');
      next = Task_WaitAtEndOfQuestLog();
      host().freezeObjectEvents();
      host().lockPlayerFieldControls();
    }
    return false;
  };
}

/** Task_WaitAtEndOfQuestLog: A, B, 127 frames, or at once after B. */
function Task_WaitAtEndOfQuestLog(): () => boolean {
  let timer = 0;
  let next: (() => boolean) | undefined;
  return () => {
    if (next) return next();
    const keys = host().newKeys();
    if (keys.a || keys.b || timer >= 127 || sPlaybackControl.endMode === END_MODE_FINISH) {
      QuestLog_CloseTextWindow();
      next = Task_EndQuestLog();
      gQL.state = 0;
    } else {
      timer++;
    }
    return false;
  };
}

/**
 * Task_EndQuestLog: the music and the palettes (questLogScreen.ts), the bars scrolled off over 16 frames, 32 frames more, then
 * the field is the player's: the map name (after B), the controls, wild encounters and the help system back.
 */
function Task_EndQuestLog(): () => boolean {
  let tState = 0;
  let tTimer = 0;
  return () => {
    switch (tState) {
      case 0:
        screen('beginEnd');
        tState++;
        return false;
      case 1:
        if (RestoreScreenAfterPlayback(tTimer)) {
          screen('removeWindows');
          tTimer = 0;
          tState++;
        } else {
          tTimer++;
        }
        return false;
      case 2:
        if (tTimer < 32) tTimer++;
        else tState++;
        return false;
      default:
        if (sPlaybackControl.endMode === END_MODE_FINISH) host().showMapNamePopup();
        screen('finishEnd');
        sPlaybackControl = emptyPlaybackControl();
        host().clearPlayerHeldMovementAndUnfreezeObjectEvents();
        host().unlockPlayerFieldControls();
        // gTextFlags.autoScroll = FALSE: the playback's auto-scrolling text is QL5's
        screen('setGlobalFieldTintMode', K.QL_TINT_NONE);
        host().disableWildEncounters(false);
        HelpSystem_Enable(); // gHelpSystemEnabled = TRUE
        sPlaybackActive = false;
        return true;
    }
  };
}

/** RestoreScreenAfterPlayback: 16 frames (the bars scroll off, the tint fades: questLogScreen.ts); true after them. */
function RestoreScreenAfterPlayback(timer: number): boolean {
  if (timer > 15) return true;
  screen('restoreScreenAfterPlayback', timer);
  return false;
}

// ------------------------------------------------------------------ for the field and the tests

/** From CONTINUE's TryStartQuestLogPlayback to Task_EndQuestLog's end: the field plays scenes, not the player. */
export function questLogPlaybackActive(): boolean {
  return sPlaybackActive;
}

/** For tests (__test.questLog().playback). */
export function questLogPlaybackDebugState() {
  return {
    active: sPlaybackActive,
    numScenes: sNumScenes,
    control: { ...sPlaybackControl },
    screenCalls: [...sScreenCalls],
    avoidDisplay: { created: sAvoidDisplayCount, live: [...sAvoidDisplayTasks].map((d) => ({ ...d })) },
  };
}

/** A new game or a soft reset: nothing is playing. */
export function QL_ResetPlayback(): void {
  questLogScreen.reset();
  sPlaybackControl = emptyPlaybackControl();
  sNumScenes = 0;
  sPlaybackActive = false;
  sScreenCalls.length = 0;
  sMapLoads++;
  sAvoidDisplayTasks.clear();
}
