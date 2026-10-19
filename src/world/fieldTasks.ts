// field_tasks.c's per-step callback task: Task_RunPerStepCallback runs one of sPerStepCallbacks every frame on the
// field (`setstepcallback` / ActivatePerStepCallback picks it). FRLG sets only STEP_CB_ICE (Icefall Cave 1F's
// ON_RESUME): IcefallCaveIcePerStepCallback cracks the thin ice the player steps on and breaks the cracked ice,
// which sets VAR_TEMP_1 for the map's ON_FRAME fall (FourIsland_IcefallCave_1F_EventScript_FallDownHole).
// Task_RunTimeBasedEvents (the ambient cries) is OverworldScene's `ambientCry`. No Phaser import: the field is
// reached through the PerStepCallbackHost OverworldScene passes in.

import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';
import type { GameState } from '../state/GameState';
import { testEvent } from '../dev/testHooks';

/** What the per-step callbacks read and change on the field, in map-local coordinates. */
export interface PerStepCallbackHost {
  state(): GameState;
  /** PlayerGetDestCoords */
  playerDestCoords(): { x: number; y: number };
  /** MapGridGetMetatileBehaviorAt */
  metatileBehaviorAt(x: number, y: number): number;
  /** MapGridSetMetatileIdAt + CurrentMapDrawMetatileAt */
  setMetatileIdAt(x: number, y: number, metatile: number): void;
}

/** NUM_TASK_DATA */
const NUM_TASK_DATA = 16;

/**
 * The Task_RunPerStepCallback task: its data[] (tCallbackId is data[0]). The field always has one (SetUpFieldTasks
 * on every map load); this one stands in until the first.
 */
let sTask = new Int16Array(NUM_TASK_DATA);

// tCallbackId and IcefallCaveIcePerStepCallback's data
const tCallbackId = 0;
const tState = 1;
const tPrevX = 2;
const tPrevY = 3;
const tIceX = 4;
const tIceY = 5;
const tDelay = 6;

/** The positions of each map space with crackable ice in Icefall Cave (sIcefallCaveIceCoords, map-local). */
export const sIcefallCaveIceCoords: readonly (readonly [number, number])[] = [
  [8, 3],
  [10, 5],
  [15, 5],
  [8, 9],
  [9, 9],
  [16, 9],
  [8, 10],
  [9, 10],
  [8, 14],
];

/**
 * SetUpFieldTasks, as ResumeMap runs it after ResetTasks (a warp, CONTINUE, coming back from a battle or a menu): a
 * new Task_RunPerStepCallback with STEP_CB_DUMMY. (A connection keeps the task: LoadMapFromCameraTransition's
 * ResetFieldTasksArgs leaves it alone.)
 */
export function SetUpFieldTasks(): void {
  sTask = new Int16Array(NUM_TASK_DATA);
  sTask[tCallbackId] = K.STEP_CB_DUMMY;
}

/** ActivatePerStepCallback (`setstepcallback`): the task's data cleared, then the callback id. */
export function ActivatePerStepCallback(callbackId: number): void {
  sTask.fill(0);
  sTask[tCallbackId] = callbackId >= sPerStepCallbacks().length ? K.STEP_CB_DUMMY : callbackId;
}

/** Test probe: the step callback that's running and its state. */
export function perStepCallbackProbe(): { callbackId: number; state: number } {
  return { callbackId: sTask[tCallbackId], state: sTask[tState] };
}

/** Task_RunPerStepCallback: once a frame, sPerStepCallbacks[tCallbackId]. */
export function Task_RunPerStepCallback(host: PerStepCallbackHost): void {
  sPerStepCallbacks()[sTask[tCallbackId]]?.(sTask, host);
}

type PerStepCallback = (data: Int16Array, host: PerStepCallbackHost) => void;

let sCallbacks: PerStepCallback[] | undefined;

/** sPerStepCallbacks (built on first use: the STEP_CB_* ids come from the extracted constants). */
function sPerStepCallbacks(): PerStepCallback[] {
  if (sCallbacks) return sCallbacks;
  const table: PerStepCallback[] = [];
  table[K.STEP_CB_DUMMY] = DummyPerStepCallback;
  table[K.STEP_CB_ASH] = unportedCallback('AshGrassPerStepCallback');
  table[K.STEP_CB_FORTREE_BRIDGE] = DummyPerStepCallback;
  table[K.STEP_CB_PACIFIDLOG_BRIDGE] = DummyPerStepCallback;
  table[K.STEP_CB_ICE] = IcefallCaveIcePerStepCallback;
  table[K.STEP_CB_TRUCK] = DummyPerStepCallback;
  table[K.STEP_CB_SECRET_BASE] = DummyPerStepCallback;
  table[K.STEP_CB_CRACKED_FLOOR] = unportedCallback('CrackedFloorPerStepCallback');
  return (sCallbacks = table);
}

function DummyPerStepCallback(): void {}

const warned = new Set<string>();

/**
 * AshGrassPerStepCallback and CrackedFloorPerStepCallback are R/S leftovers no FRLG script sets (no FRLG map has ash
 * grass or cracked floors): they log once and do nothing.
 */
function unportedCallback(name: string): PerStepCallback {
  return () => {
    if (warned.has(name)) return;
    warned.add(name);
    console.warn(`[fieldTasks] ${name} isn't ported (no FRLG script sets it)`);
  };
}

/** MarkIcePuzzleCoordVisited: FlagSet(i + 1), FLAG_TEMP_1.. for the ice at sIcefallCaveIceCoords[i]. */
function MarkIcePuzzleCoordVisited(state: GameState, x: number, y: number): void {
  const i = sIcefallCaveIceCoords.findIndex(([cx, cy]) => cx === x && cy === y);
  if (i >= 0) state.setFlag(i + 1);
}

/**
 * SetIcefallCaveCrackedIceMetatiles (FourIsland_IcefallCave_1F's ON_LOAD): the ice whose temp flag is set (cracked
 * on this visit, or saved with the game) is cracked again in the freshly loaded map grid.
 */
export function SetIcefallCaveCrackedIceMetatiles(state: GameState, setMetatileIdAt: (x: number, y: number, metatile: number) => void): void {
  sIcefallCaveIceCoords.forEach(([x, y], i) => {
    if (state.getFlag(i + 1)) setMetatileIdAt(x, y, K.METATILE_SeafoamIslands_CrackedIce);
  });
}

/**
 * IcefallCaveIcePerStepCallback: when the player's destination changes, thin ice cracks and cracked ice breaks 4
 * frames later (tDelay counts 4 down to 0, then the fifth frame changes the metatile). A broken tile sets VAR_TEMP_1.
 */
function IcefallCaveIcePerStepCallback(data: Int16Array, host: PerStepCallbackHost): void {
  switch (data[tState]) {
    case 0: {
      const { x, y } = host.playerDestCoords();
      data[tPrevX] = x;
      data[tPrevY] = y;
      data[tState] = 1;
      break;
    }
    case 1: {
      const { x, y } = host.playerDestCoords();
      // End if player hasn't moved
      if (x === data[tPrevX] && y === data[tPrevY]) return;
      data[tPrevX] = x;
      data[tPrevY] = y;
      const tileBehavior = host.metatileBehaviorAt(x, y);
      if (tileBehavior === K.MB_THIN_ICE) {
        // Thin ice, set it to cracked ice
        MarkIcePuzzleCoordVisited(host.state(), x, y);
        data[tDelay] = 4;
        data[tState] = 2;
        data[tIceX] = x;
        data[tIceY] = y;
      } else if (tileBehavior === K.MB_CRACKED_ICE) {
        // Cracked ice, set it to broken ice
        data[tDelay] = 4;
        data[tState] = 3;
        data[tIceX] = x;
        data[tIceY] = y;
      }
      break;
    }
    case 2:
      if (data[tDelay] !== 0) {
        data[tDelay]--;
      } else {
        // Crack ice
        PlaySE(K.SE_ICE_CRACK);
        host.setMetatileIdAt(data[tIceX], data[tIceY], K.METATILE_SeafoamIslands_CrackedIce);
        testEvent('iceCracked', { x: data[tIceX], y: data[tIceY] });
        data[tState] = 1;
      }
      break;
    case 3:
      if (data[tDelay] !== 0) {
        data[tDelay]--;
      } else {
        // Break ice
        PlaySE(K.SE_ICE_BREAK);
        host.setMetatileIdAt(data[tIceX], data[tIceY], K.METATILE_SeafoamIslands_IceHole);
        testEvent('iceBroken', { x: data[tIceX], y: data[tIceY] });
        host.state().setVar('VAR_TEMP_1', 1);
        data[tState] = 1;
      }
      break;
  }
}
