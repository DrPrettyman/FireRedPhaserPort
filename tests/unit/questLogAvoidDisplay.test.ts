// QL_AvoidDisplay (quest_log.c) with Task_AvoidDisplay, and its callers in the script engine (script_menu.c's
// QL_DestroyAbortedDisplay, ScriptMenu_YesNo / _Multichoice / _MultichoiceGrid, ScrCmd_showmoneybox, WaitForAorBPress'
// playback timeout): recording cuts the scene and shows the display; playback skips it, and 127 frames later ends
// the scene, the script replaced by EventScript_ReleaseEnd.

import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import { ScriptEngine, type ScriptsData } from '../../src/script/ScriptEngine';
import {
  decodeQuestLogScript,
  gQL,
  initQuestLogData,
  QL_AvoidDisplay,
  QL_ResetOnSoftReset,
  QL_TryRunActions,
  ResetQuestLog,
  RunQuestLogCB,
  SaveQuestLogData,
  setQuestLogHost,
  type QuestLogData,
} from '../../src/world/questLog';
import { SetQuestLogEvent } from '../../src/world/questLogEvents';
import {
  QL_HandleInput,
  QL_ResetPlayback,
  QL_StartPlaybackScene,
  questLogPlaybackDebugState,
  setQuestLogPlaybackHost,
  TryStartQuestLogPlayback,
  type QuestLogPlaybackHost,
} from '../../src/world/questLogPlayback';
import { newGame, readGen, type TestGame } from './gameData';

const strings = readGen<Record<string, string>>('text/strings.json');
const scripts = readGen<ScriptsData>('scripts/scripts.json');

let t: TestGame;
let d: (name: string) => number;
/** The playback host's field tasks (CreateTask), run once a frame by `frame`. */
let tasks: (() => boolean)[];
/** The palette fade: frames left (FadeScreen(FADE_TO_BLACK, 0) takes 16 + 1 here, enough for the test). */
let fadeFrames: number;
let sceneLoads: number;
let finalScene: number;
let keys: { a: boolean; b: boolean };

beforeAll(() => {
  initConstants(readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines);
  initQuestLogData(readGen<QuestLogData>('questLog.json'));
});

beforeEach(() => {
  t = newGame();
  d = t.d;
  tasks = [];
  fadeFrames = 0;
  sceneLoads = 0;
  finalScene = 0;
  keys = { a: false, b: false };
  setQuestLogHost({
    state: t.state,
    location: () => ({ mapId: 'MAP_PALLET_TOWN', warpId: 0, x: 6, y: 8 }),
    mapSec: () => d('MAPSEC_PALLET_TOWN'),
    playerFacing: () => 'down',
    fieldControlsLocked: () => false,
    objectEvents: () => [],
    objectEventTemplates: () => [],
  });
  const host: Partial<QuestLogPlaybackHost> = {
    setUpOverworldForQLPlayback: () => void sceneLoads++,
    enterFieldFromQuestLog: () => void finalScene++,
    fadeScreenToBlack: () => void (fadeFrames = 17),
    paletteFadeActive: () => fadeFrames > 0,
    lockPlayerFieldControls: () => {},
    unlockPlayerFieldControls: () => {},
    createTask: (tick) => void tasks.push(tick),
    disableWildEncounters: () => {},
    newKeys: () => keys,
  };
  setQuestLogPlaybackHost(host as QuestLogPlaybackHost);
  ResetQuestLog(t.state);
  QL_ResetPlayback();
});

/** A field frame: the tasks (RunTasks), UpdatePaletteFade, then CB1's quest log part (the scene is ending: RunQuestLogCB runs). */
function frame(n = 1): void {
  for (let i = 0; i < n; i++) {
    tasks = tasks.filter((tick) => !tick());
    if (fadeFrames > 0) fadeFrames--;
    QL_TryRunActions();
    RunQuestLogCB();
  }
}

/** One recorded scene in the save, then CONTINUE: TryStartQuestLogPlayback and the scene's load (QL_StartPlaybackScene). */
function startPlayback(): void {
  SetQuestLogEvent(d('QL_EVENT_DEPARTED'), { mapSec: d('MAPSEC_PALLET_TOWN'), locationId: d('QL_LOCATION_HOME') });
  for (let i = 0; i < 5; i++) {
    QL_TryRunActions();
    RunQuestLogCB();
  }
  SaveQuestLogData();
  QL_ResetOnSoftReset();
  expect(TryStartQuestLogPlayback(t.state)).toBe(true);
  expect(sceneLoads).toBe(1);
  QL_StartPlaybackScene();
}

describe('QL_AvoidDisplay', () => {
  test('without a quest log it lets the display through and does nothing else', () => {
    const cb = vi.fn();
    expect(QL_AvoidDisplay(cb)).toBe(false);
    expect(tasks.length).toBe(0);
    expect(cb).not.toHaveBeenCalled();
  });

  test('RECORDING: the scene is cut (a one-frame wait, the end) and the display goes ahead', () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), { mapSec: d('MAPSEC_PALLET_TOWN'), locationId: d('QL_LOCATION_HOME') });
    expect(gQL.state).toBe(d('QL_STATE_RECORDING'));
    const cb = vi.fn();
    expect(QL_AvoidDisplay(cb)).toBe(false);
    expect(gQL.state).toBe(0);
    expect(gQL.playbackState).toBe(d('QL_PLAYBACK_STATE_STOPPED'));
    const cmds = decodeQuestLogScript(t.state.questLog[0].script);
    expect(cmds.slice(-2).map((c) => c.words)).toEqual([[d('QL_EVENT_WAIT'), 1], [d('QL_EVENT_SCENE_END')]]);
    expect(cb).not.toHaveBeenCalled();
    expect(tasks.length).toBe(0);
  });

  test('PLAYBACK: the display is skipped, the actions stop; 127 frames later the scene fades out, then the callback and the next scene', () => {
    startPlayback();
    const cb = vi.fn(() => expect(gQL.playbackState).toBe(d('QL_PLAYBACK_STATE_STOPPED')));
    expect(QL_AvoidDisplay(cb)).toBe(true);
    expect(gQL.playbackState).toBe(d('QL_PLAYBACK_STATE_ACTION_END'));
    expect(tasks.length).toBe(1);
    frame(126);
    expect(questLogPlaybackDebugState().control.endMode).toBe(0);
    expect(fadeFrames).toBe(0);
    frame(1); // tTimer 127: BeginNormalPaletteFade, END_MODE_SCENE
    expect(questLogPlaybackDebugState().control.endMode).toBe(2);
    expect(questLogPlaybackDebugState().avoidDisplay.live).toEqual([{ tTimer: 127, tState: 1 }]);
    expect(cb).not.toHaveBeenCalled();
    while (fadeFrames > 0) frame();
    expect(cb).not.toHaveBeenCalled(); // (the fade ended after this frame's tasks)
    expect(finalScene).toBe(0);
    frame(); // the task: the callback, sQuestLogCB = QuestLog_AdvancePlayhead, which runs in CB1
    expect(cb).toHaveBeenCalledTimes(1);
    expect(tasks.length).toBe(0);
    expect(finalScene).toBe(1); // the only scene: QuestLog_StartFinalScene
    expect(gQL.state).toBe(d('QL_STATE_PLAYBACK_LAST'));
  });

  test('PLAYBACK: a map load meanwhile (B skipped to the end) ends the task without its callback (ResetTasks)', () => {
    startPlayback();
    const cb = vi.fn();
    QL_AvoidDisplay(cb);
    frame(10);
    keys = { a: false, b: true };
    QL_HandleInput(); // DoSkipToEndTransition
    keys = { a: false, b: false };
    frame(30);
    expect(finalScene).toBe(1);
    frame(200);
    expect(cb).not.toHaveBeenCalled();
    expect(questLogPlaybackDebugState().avoidDisplay.live).toEqual([]);
  });
});

describe('the script menus (QL_AvoidDisplay(QL_DestroyAbortedDisplay))', () => {
  function engine(code: (string | number)[][]) {
    const labels: Record<string, number> = { Test: 0 };
    const all = [...code, ['end']];
    labels.EventScript_ReleaseEnd = all.length; // (its `release` needs the field: only the label matters here)
    all.push(['end']);
    const data = { ...scripts, code: all, labels };
    const messageBox = { show: vi.fn(), isPrinting: false, hide: vi.fn() };
    const yesNo = vi.fn(() => ({ tick: () => false, result: false }));
    const multichoice = vi.fn(() => ({ tick: () => false, result: 0 }));
    const moneyBox = vi.fn();
    const host = {
      openYesNo: yesNo,
      openMultichoice: multichoice,
      showMoneyBox: moneyBox,
      cancelMonPic: vi.fn(),
      startFieldTask: () => {},
      listMenuHost: () => undefined,
      releaseAll: () => {},
      release: () => {},
    };
    const input = { pressedAorB: () => false, held: () => false, pressed: () => false };
    const eng = new ScriptEngine(data as unknown as ScriptsData, t.defines, t.state, strings, t.charmap, messageBox as never, input as never, host as never);
    return { eng, yesNo, multichoice, moneyBox };
  }

  test('RECORDING: a multichoice cuts the scene and opens; the nurse\'s (ignoreBPress bit 1) neither cuts nor is skipped', () => {
    SetQuestLogEvent(d('QL_EVENT_DEPARTED'), { mapSec: d('MAPSEC_PALLET_TOWN'), locationId: d('QL_LOCATION_HOME') });
    const nurse = engine([['multichoice', '19', '8', 'MULTICHOICE_YES_NO', '2']]);
    nurse.eng.start('Test');
    nurse.eng.tick();
    expect(nurse.multichoice).toHaveBeenCalledTimes(1);
    expect(gQL.state).toBe(d('QL_STATE_RECORDING'));
    const mc = engine([['multichoice', '19', '8', 'MULTICHOICE_YES_NO', 'FALSE']]);
    mc.eng.start('Test');
    mc.eng.tick();
    expect(mc.multichoice).toHaveBeenCalledTimes(1);
    expect(gQL.state).toBe(0);
  });

  test('PLAYBACK: yesnobox, multichoice, multichoicegrid and showmoneybox are skipped; the script waits, then becomes EventScript_ReleaseEnd', () => {
    startPlayback();
    for (const cmd of [
      ['yesnobox', '0', '0'],
      ['multichoice', '19', '8', 'MULTICHOICE_YES_NO', 'FALSE'],
      ['multichoicegrid', '7', '1', 'MULTICHOICE_TRAINER_SCHOOL_WHITEBOARD', '3', 'FALSE'],
    ]) {
      QL_ResetPlayback();
      tasks = [];
      startPlayback2();
      const e = engine([cmd, ['setvar', 'VAR_0x8000', '1']]);
      e.eng.start('Test');
      e.eng.tick();
      expect(e.yesNo).not.toHaveBeenCalled();
      expect(e.multichoice).not.toHaveBeenCalled();
      expect(t.state.getVar('VAR_RESULT')).toBe(d('SCR_MENU_UNSET'));
      expect(tasks.length, cmd[0]).toBe(1);
      for (let i = 0; i < 160 && e.eng.runningLabel === 'Test'; i++) {
        frame();
        e.eng.tick();
      }
      expect(e.eng.runningLabel, cmd[0]).not.toBe('Test');
      expect(t.state.getVar('VAR_0x8000'), cmd[0]).toBe(0); // the script never went on past the menu
    }
    // showmoneybox goes on at once without the box
    QL_ResetPlayback();
    tasks = [];
    startPlayback2();
    const m = engine([['showmoneybox', '0', '0'], ['setvar', 'VAR_0x8000', '2']]);
    m.eng.start('Test');
    m.eng.tick();
    expect(m.moneyBox).not.toHaveBeenCalled();
    expect(t.state.getVar('VAR_0x8000')).toBe(2);
    expect(tasks.length).toBe(1);
  });

  test("PLAYBACK: waitbuttonpress ends by itself after 120 frames (sQuestLogWaitButtonPressTimer)", () => {
    startPlayback();
    const e = engine([['waitbuttonpress'], ['setvar', 'VAR_0x8000', '3']]);
    e.eng.start('Test');
    let frames = 0;
    for (; frames < 200 && t.state.getVar('VAR_0x8000') !== 3; frames++) e.eng.tick();
    // the command's frame, then WaitForAorBPress 121 times (the 121st sees the timer at 120)
    expect(frames).toBe(1 + 121);
  });
});

/** startPlayback for a game whose scene is already saved: CONTINUE again. */
function startPlayback2(): void {
  QL_ResetOnSoftReset();
  expect(TryStartQuestLogPlayback(t.state)).toBe(true);
  QL_StartPlaybackScene();
}
