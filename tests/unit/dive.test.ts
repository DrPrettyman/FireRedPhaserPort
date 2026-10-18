// FireRed's leftovers from R/S, ported as the C has them (batch 3 of SIDE_PLAN.md, W-unused):
// - scrcmd.c's decoration commands: adddecoration / removedecoration / checkdecor / checkdecorspace read the id
//   with VarGet and do nothing else, bufferdecorationname reads its string var and the id and copies nothing
//   (the RSE calls are commented out in FRLG's C).
// - FLDEFF_USE_DIVE (field_effect.c FldEff_UseDive / Task_UseDive / DiveFieldEffect_Init, _ShowMon, _TryWarp),
//   dive_warp (field_control_avatar.c), SetDiveWarpDive / SetDiveWarpEmerge (overworld.c) and DoDiveWarp
//   (field_fadetransition.c: Task_Teleport2Warp, FieldCB_DefaultWarpExit).
// Expected values are read off that C.

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import type { MapConnection } from '../../src/data/types';
import type { ObjectEvent } from '../../src/entities/ObjectEvent';
import { ScriptEngine, type ScriptsData } from '../../src/script/ScriptEngine';
import { Behaviors } from '../../src/world/behaviors';
import { registerDive, setDiveHost } from '../../src/world/dive';
import {
  FieldEffectActiveListContains,
  FieldEffectActiveListRemove,
  FieldEffectStart,
  gFieldEffectArguments,
  registerFieldEffectNatives,
  setFieldEffectScriptHost,
  setFieldEffectScripts,
  type FieldEffectScript,
} from '../../src/world/fieldEffectScripts';
import { setFieldMoveHost, UnlockPlayerFieldControls, type FieldMoveHost } from '../../src/world/fieldMoves';
import { GetInitialPlayerAvatarState, gPlayerAvatar, ResetInitialPlayerAvatarState, setPlayerAvatarHost, type PlayerAvatarHost } from '../../src/world/playerAvatar';
import { newGame, readGen } from './gameData';

// The banner's graphics are fetched in the browser; here they are "loaded" at once.
vi.mock('../../src/world/fieldMoveShowMon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/world/fieldMoveShowMon')>()),
  loadShowMonGfx: () => Promise.resolve(),
}));

const defines = readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines;
const mb = readGen<{ metatileBehaviors: Record<string, number> }>('constants.json').metatileBehaviors;
const d = (name: string): number => defines[name];

beforeAll(() => initConstants(defines));

/** Lets the promise callbacks queued so far run (the banner's graphics load, the warp destination). */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

// ------------------------------------------------------------------ decoration commands

describe('decoration commands (scrcmd.c: no-ops in FRLG)', () => {
  const scripts = readGen<ScriptsData>('scripts/scripts.json');

  /** A ScriptEngine running `code` from label Test (and Test2...), on a fresh new game. */
  function engine(code: Record<string, string[][]>) {
    const game = newGame();
    const data = { ...scripts, code: [] as string[][], labels: {} as Record<string, number> };
    for (const [label, ins] of Object.entries(code)) {
      data.labels[label] = data.code.length;
      data.code.push(...ins);
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const eng = new ScriptEngine(data as unknown as ScriptsData, game.defines, game.state, {}, game.charmap, {} as never, {} as never, {} as never);
    return { eng, state: game.state, warn };
  }

  afterEach(() => vi.restoreAllMocks());

  test('the scripts call them with the macros’ arguments (event.inc: a .2byte id; a stringvar byte + .2byte id)', () => {
    const at = (label: string) => scripts.code[scripts.labels[label]];
    const obtain = scripts.code.slice(scripts.labels.Std_ObtainDecoration, scripts.labels.Std_ObtainDecoration + 5);
    expect(obtain.find((ins) => ins[0] === 'adddecoration')).toEqual(['adddecoration', 'VAR_0x8000']);
    expect(at('EventScript_ObtainDecorMessage')).toEqual(['bufferdecorationname', 'STR_VAR_2', 'VAR_0x8000']);
  });

  test('they read their arguments, leave VAR_RESULT and the string vars alone, and the script runs on', () => {
    const { eng, state, warn } = engine({
      Test: [
        ['adddecoration', 'VAR_0x8000'],
        ['removedecoration', 'VAR_0x8000'],
        ['checkdecor', '5'],
        ['checkdecorspace', 'VAR_0x8000'],
        ['bufferdecorationname', 'STR_VAR_2', 'VAR_0x8000'],
        ['bufferdecorationname', 'STR_VAR_1', '3'],
        ['setvar', 'VAR_0x8001', '7'],
        ['end'],
      ],
    });
    state.setVar('VAR_0x8000', 12);
    state.setVar('VAR_RESULT', 0x1234);
    const before = state.stringVars.map((s) => [...s]);
    state.stringVars[1] = [1, 2, 3];
    before[1] = [1, 2, 3];
    expect(eng.start('Test')).toBe(true);
    eng.tick();
    expect(eng.running).toBe(false);
    expect(state.getVar('VAR_0x8001')).toBe(7); // the command after them ran
    expect(state.getVar('VAR_RESULT')).toBe(0x1234);
    expect(state.getVar('VAR_0x8000')).toBe(12);
    expect(state.stringVars.map((s) => [...s])).toEqual(before);
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/unimplemented/);
  });

  test('a dofieldeffect whose script ends without its waitstate leaves no wait for the next script', () => {
    // EventScript_DeepWater: `dofieldeffect FLDEFF_USE_DIVE` then releaseall/end, with the effect still running
    setFieldEffectScripts({ FLDEFF_TEST_STAYS_ACTIVE: [['callnative', 'FldEff_TestStaysActive'], ['end']] });
    registerFieldEffectNatives({ FldEff_TestStaysActive: () => 0 });
    const { eng, state } = engine({
      Test: [['dofieldeffect', 'FLDEFF_TEST_STAYS_ACTIVE'], ['end']],
      Test2: [['waitstate'], ['setvar', 'VAR_0x8002', '1'], ['end']],
    });
    eng.start('Test');
    eng.tick();
    expect(eng.running).toBe(false);
    expect(FieldEffectActiveListContains('FLDEFF_TEST_STAYS_ACTIVE')).toBe(true);
    eng.start('Test2');
    eng.tick();
    expect(state.getVar('VAR_0x8002')).toBe(1);
    FieldEffectActiveListRemove('FLDEFF_TEST_STAYS_ACTIVE');
  });
});

// ------------------------------------------------------------------ FLDEFF_USE_DIVE

describe('FLDEFF_USE_DIVE', () => {
  const ORIGIN = { x: 40, y: 20 };
  let tasks: (() => boolean)[];
  let locks: number;
  let frozen: boolean;
  let mapType: number;
  let connections: MapConnection[];
  let warpDest: { mapId: string; warpId: number; x: number; y: number } | undefined;
  let diveMapScripts: number;
  let fadeOutTo: string[];
  let fadeDone: boolean;
  let warps: { mapId: string; x: number; y: number; fieldCallback: unknown; warpId: number | undefined }[];
  let showMon: number[];
  const player = { current: { x: 0, y: 0 }, currentMetatileBehavior: 0, facing: 'left' as const };

  /** One frame of the field's tasks (RunTasks). */
  function runTasks(): void {
    tasks = tasks.filter((t) => !t());
  }

  beforeEach(() => {
    tasks = [];
    locks = 0;
    frozen = false;
    mapType = d('MAP_TYPE_OCEAN_ROUTE');
    connections = [];
    warpDest = undefined;
    diveMapScripts = 0;
    fadeOutTo = [];
    fadeDone = false;
    warps = [];
    showMon = [];
    player.current = { x: ORIGIN.x + 5, y: ORIGIN.y + 6 };
    player.currentMetatileBehavior = mb.MB_DEEP_WATER;
    gPlayerAvatar.preventStep = false;
    gPlayerAvatar.flags = d('PLAYER_AVATAR_FLAG_SURFING');
    UnlockPlayerFieldControls(); // (a previous test's lock)
    setPlayerAvatarHost({
      player: player as unknown as ObjectEvent,
      behaviors: new Behaviors(mb),
      flag: () => false,
      allowCycling: () => true,
      mapId: () => 'MAP_TEST',
      createTask: (tick: () => boolean) => tasks.push(tick),
      lockPlayerFieldControls: () => locks++,
      unlockPlayerFieldControls: () => (locks = Math.max(0, locks - 1)),
      freezeObjectEvents: () => (frozen = true),
      unfreezeObjectEvents: () => (frozen = false),
    } as unknown as PlayerAvatarHost);
    setFieldMoveHost({
      mapType: () => mapType,
      localToWorld: (x: number, y: number) => ({ x: x + ORIGIN.x, y: y + ORIGIN.y }),
      gbaScreenGfxSymbols: () => [],
      warpDestination: async () => warpDest,
      warpFadeOutScreen: (mapId: string) => {
        fadeOutTo.push(mapId);
        return () => fadeDone;
      },
      warpIntoMap: (mapId: string, x: number, y: number, fieldCallback: unknown, warpId?: number) => warps.push({ mapId, x, y, fieldCallback, warpId }),
    } as unknown as FieldMoveHost);
    setDiveHost({
      connections: () => connections,
      runOnDiveWarpMapScript: () => diveMapScripts++,
      setWarpDestination: (mapId, warpId, x, y) => (warpDest = { mapId, warpId, x, y }),
    });
    setFieldEffectScripts(readGen<Record<string, FieldEffectScript>>('field_effects/scripts.json'));
    setFieldEffectScriptHost({ isPhaserEffectActive: () => false });
    registerDive();
    // FldEff_FieldMoveShowMonInit: FieldEffectStart(FLDEFF_FIELD_MOVE_SHOW_MON), then off the list itself; the
    // banner (FLDEFF_FIELD_MOVE_SHOW_MON) stays on the list until the test takes it off.
    registerFieldEffectNatives({
      FldEff_FieldMoveShowMonInit: () => {
        showMon.push(gFieldEffectArguments[0]);
        FieldEffectStart('FLDEFF_FIELD_MOVE_SHOW_MON');
        FieldEffectActiveListRemove('FLDEFF_FIELD_MOVE_SHOW_MON_INIT');
        return 0;
      },
      FldEff_FieldMoveShowMon: () => 0,
    });
    ResetInitialPlayerAvatarState();
  });

  afterEach(() => {
    FieldEffectActiveListRemove('FLDEFF_FIELD_MOVE_SHOW_MON');
    FieldEffectActiveListRemove('FLDEFF_USE_DIVE');
  });

  /** EventScript_DeepWater's setfieldeffectargument 0, VAR_RESULT (party slot 2) / 1, 1 and dofieldeffect. */
  async function startDive(): Promise<void> {
    gFieldEffectArguments[0] = 2;
    gFieldEffectArguments[1] = 1;
    FieldEffectStart('FLDEFF_USE_DIVE');
    await flush();
  }

  /** The three steps: Init (at once), ShowMon (next frame), TryWarp (waits for the banner). */
  async function runToTryWarp(): Promise<void> {
    await startDive();
    expect(gPlayerAvatar.preventStep).toBe(true); // DiveFieldEffect_Init ran inside FldEff_UseDive
    expect(showMon).toEqual([]);
    expect(FieldEffectActiveListContains('FLDEFF_USE_DIVE')).toBe(true);
    runTasks(); // DiveFieldEffect_ShowMon
    expect(locks).toBe(1); // LockPlayerFieldControls
    expect(showMon).toEqual([2]); // gFieldEffectArguments[0] = data[15]
    for (let i = 0; i < 30; i++) runTasks(); // DiveFieldEffect_TryWarp: the banner is still up
    expect(FieldEffectActiveListContains('FLDEFF_USE_DIVE')).toBe(true);
    expect(warpDest).toBeUndefined();
    expect(diveMapScripts).toBe(0);
    FieldEffectActiveListRemove('FLDEFF_FIELD_MOVE_SHOW_MON'); // the banner is over
  }

  test('on deep water, it shows the mon, then dives through the map’s dive connection to the same local tile', async () => {
    connections = [
      { map: 'MAP_TEST_EAST', offset: 0, direction: 'right' },
      { map: 'MAP_TEST_UNDERWATER', offset: 0, direction: 'dive' },
    ];
    await runToTryWarp();
    runTasks();
    expect(warpDest).toEqual({ mapId: 'MAP_TEST_UNDERWATER', warpId: -1, x: 5, y: 6 }); // SetWarpDestination
    expect(FieldEffectActiveListContains('FLDEFF_USE_DIVE')).toBe(false);
    expect(tasks.length).toBe(0); // Task_UseDive destroyed; Task_Teleport2Warp waits for the destination
    // StoreInitialPlayerAvatarState: surfing and facing left; arriving underwater keeps the facing
    expect(GetInitialPlayerAvatarState(d('MAP_TYPE_UNDERWATER'), mb.MB_NORMAL, 'MAP_TEST_UNDERWATER')).toEqual({
      transitionFlags: d('PLAYER_AVATAR_FLAG_UNDERWATER'),
      direction: 'left',
    });
    // DoDiveWarp: WarpFadeOutScreen, then Task_Teleport2Warp
    await flush();
    expect(fadeOutTo).toEqual(['MAP_TEST_UNDERWATER']);
    runTasks(); // case 0: FreezeObjectEvents, LockPlayerFieldControls
    expect(frozen).toBe(true);
    for (let i = 0; i < 10; i++) runTasks(); // case 1: the fade out
    expect(warps).toEqual([]);
    fadeDone = true;
    runTasks();
    runTasks(); // case 2: WarpIntoMap + CB2_LoadMap, with FieldCB_DefaultWarpExit
    expect(warps).toEqual([{ mapId: 'MAP_TEST_UNDERWATER', x: 5, y: 6, fieldCallback: undefined, warpId: -1 }]);
    expect(tasks.length).toBe(0);
  });

  test('underwater, it surfaces through the emerge connection, unless the tile is MB_UNDERWATER_BLOCKED_ABOVE', async () => {
    mapType = d('MAP_TYPE_UNDERWATER');
    player.currentMetatileBehavior = mb.MB_NORMAL;
    gPlayerAvatar.flags = d('PLAYER_AVATAR_FLAG_UNDERWATER');
    connections = [
      { map: 'MAP_TEST_UNDERWATER', offset: 0, direction: 'dive' },
      { map: 'MAP_TEST_SURFACE', offset: 0, direction: 'emerge' },
    ];
    await runToTryWarp();
    runTasks();
    expect(warpDest).toEqual({ mapId: 'MAP_TEST_SURFACE', warpId: -1, x: 5, y: 6 });
    await flush();
    fadeDone = true;
    for (let i = 0; i < 3; i++) runTasks();
    expect(warps.map((w) => w.mapId)).toEqual(['MAP_TEST_SURFACE']);
  });

  test('under a MB_UNDERWATER_BLOCKED_ABOVE tile nothing happens (not even the dive check)', async () => {
    mapType = d('MAP_TYPE_UNDERWATER');
    player.currentMetatileBehavior = mb.MB_UNDERWATER_BLOCKED_ABOVE;
    connections = [{ map: 'MAP_TEST_SURFACE', offset: 0, direction: 'emerge' }];
    await runToTryWarp();
    runTasks();
    expect(warpDest).toBeUndefined();
    expect(FieldEffectActiveListContains('FLDEFF_USE_DIVE')).toBe(false);
  });

  test('without a dive connection it runs the ON_DIVE_WARP map script and stops, leaving the player locked as the C does', async () => {
    connections = [{ map: 'MAP_TEST_EAST', offset: 0, direction: 'right' }];
    await runToTryWarp();
    runTasks();
    expect(diveMapScripts).toBe(1); // RunOnDiveWarpMapScript; sFixedDiveWarp is the dummy warp
    expect(warpDest).toBeUndefined();
    expect(FieldEffectActiveListContains('FLDEFF_USE_DIVE')).toBe(false);
    expect(tasks.length).toBe(0);
    await flush();
    expect(fadeOutTo).toEqual([]);
    // Nothing in DiveFieldEffect_TryWarp undoes DiveFieldEffect_Init's preventStep or _ShowMon's lock.
    expect(gPlayerAvatar.preventStep).toBe(true);
    expect(locks).toBe(1);
  });

  test('on water that is not diveable (MB_POND_WATER) nothing happens', async () => {
    player.currentMetatileBehavior = mb.MB_POND_WATER;
    connections = [{ map: 'MAP_TEST_UNDERWATER', offset: 0, direction: 'dive' }];
    await runToTryWarp();
    runTasks();
    expect(diveMapScripts).toBe(0);
    expect(warpDest).toBeUndefined();
  });

  test('MetatileBehavior_IsDiveable is MB_FAST_WATER..MB_DEEP_WATER', () => {
    const b = new Behaviors(mb);
    const diveable = Object.entries(mb)
      .filter(([, id]) => b.isDiveable(id))
      .map(([name]) => name);
    const expected = Object.entries(mb)
      .filter(([, id]) => id >= mb.MB_FAST_WATER && id <= mb.MB_DEEP_WATER)
      .map(([name]) => name);
    expect(diveable).toEqual(expected);
    expect(diveable).toContain('MB_DEEP_WATER');
    expect(b.isUnableToEmerge(mb.MB_UNDERWATER_BLOCKED_ABOVE)).toBe(true);
    expect(b.isUnableToEmerge(mb.MB_DEEP_WATER)).toBe(false);
  });
});
