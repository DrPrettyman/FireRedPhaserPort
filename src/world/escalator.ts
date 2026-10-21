// The Pokémon Centers' escalators (MB_UP_ESCALATOR / MB_DOWN_ESCALATOR, every FRLG Pokémon Center's way to 2F):
// - field_fadetransition.c's DoEscalatorWarp, started by TryStartWarpEventScript's MetatileBehavior_IsEscalator
//   branch (OverworldScene.tryStartWarpEventScript, after SetupWarp);
// - field_effect.c's escalator warp: StartEscalatorWarp, Task_EscalatorWarpFieldEffect / EscalatorWarpEffect_1-6
//   (the player rides off, the screen fades, WarpIntoMap), FieldCB_EscalatorWarpIn and
//   Task_EscalatorWarpInFieldEffect / EscalatorWarpInEffect_1-7 (the player rides in, then walks off east);
// - special_field_anim.c's escalator half: StartEscalator, Task_DrawEscalator / SetEscalatorMetatile (the steps'
//   metatiles cycle through their three stages), StopEscalator, IsEscalatorMoving;
// - quest_log.c's QuestLog_OnEscalatorWarp calls (QL_ESCALATOR_OUT / QL_ESCALATOR_IN: world/questLog.ts).
//
// The C's tasks run here in a small gTasks list of their own (CreateTask's InsertTask by priority, RunTasks
// following each task's `next`), ticked by one field task: the order between the escalator's draw task
// (priority 0) and the warp tasks (10 out, 0 in) decides in which frame IsEscalatorMoving sees the steps stop.

import { K } from '../battle/constants';
import { Cos, Sin } from '../battle/trig';
import { testEvent } from '../dev/testHooks';
import { directionalAction } from '../entities/movementActions';
import { Overworld_PlaySpecialMapMusic } from '../gba/overworldMusic';
import { PlaySE } from '../gba/sound';
import { MAPGRID_COLLISION_MASK } from './MapChunk';
import { CreateTask as CreateFieldTask, fieldMoveHost, LockPlayerFieldControls, UnlockPlayerFieldControls } from './fieldMoves';
import { avatarField, GetPlayerFacingDirection, PlayerGetDestCoords, playerObj } from './playerAvatar';
import { QL_ESCALATOR_IN, QL_ESCALATOR_OUT, QuestLog_OnEscalatorWarp } from './questLog';
import { QuestLog_DrawPreviouslyOnQuestHeaderIfInPlaybackMode } from './questLogPlayback';

/** What the escalator needs from the field beyond the field move host. Implemented by OverworldScene. */
export interface EscalatorHost {
  /** MapGridSetMetatileIdAt (world coords; `value` is the metatile id | collision bits): the map grid only. */
  setMetatileIdAt(x: number, y: number, value: number): void;
  /** The BG tilemaps' cell at (x, y) redrawn from the map grid (world coords): DrawWholeMapView's part for it. */
  drawMetatileAt(x: number, y: number): void;
}

let host: EscalatorHost | undefined;

export function setEscalatorHost(h: EscalatorHost): void {
  host = h;
}

function escalatorHost(): EscalatorHost {
  if (!host) throw new Error('[escalator] no field host');
  return host;
}

// ------------------------------------------------------------------ task.c, for the escalator's tasks

interface Task {
  func: (task: Task) => void;
  priority: number;
  data: Int16Array;
  isActive: boolean;
  prev: Task | undefined;
  next: Task | undefined;
}

let sHead: Task | undefined;
/** Bumped by ResetEscalatorTasks, so a runner from before a map load stops. */
let sGeneration = 0;
let sRunnerGeneration = -1;

/** CreateTask + InsertTask: before the first task with a larger priority value, else at the end. */
function CreateTask(func: (task: Task) => void, priority: number): Task {
  const task: Task = { func, priority, data: new Int16Array(16), isActive: true, prev: undefined, next: undefined };
  if (!sHead) sHead = task;
  else {
    for (let t: Task = sHead; ; t = t.next!) {
      if (priority < t.priority) {
        task.prev = t.prev;
        task.next = t;
        if (t.prev) t.prev.next = task;
        else sHead = task;
        t.prev = task;
        break;
      }
      if (!t.next) {
        t.next = task;
        task.prev = t;
        break;
      }
    }
  }
  startRunner();
  return task;
}

/** DestroyTask: unlinked, but its `next` stays (RunTasks carries on from it). */
function DestroyTask(task: Task | undefined): void {
  if (!task?.isActive) return;
  task.isActive = false;
  if (task.prev) task.prev.next = task.next;
  else sHead = task.next;
  if (task.next) task.next.prev = task.prev;
}

/** RunTasks over the escalator's tasks, from one field task while any are alive. */
function startRunner(): void {
  if (sRunnerGeneration === sGeneration) return;
  const generation = (sRunnerGeneration = sGeneration);
  CreateFieldTask(() => {
    if (generation !== sGeneration) return true;
    for (let t = sHead; t; t = t.next) t.func(t);
    if (sHead) return false;
    sRunnerGeneration = -1;
    return true;
  });
}

/** The field's ResetTasks (a map load, ResumeMap): the escalator's tasks go with the rest. */
export function ResetEscalatorTasks(): void {
  sHead = undefined;
  sGeneration++;
  sRunnerGeneration = -1;
  sEscalatorTask = undefined;
  sPendingDraws.clear();
}

// ------------------------------------------------------------------ special_field_anim.c

const ESCALATOR_STAGES = 3;
const LAST_ESCALATOR_STAGE = ESCALATOR_STAGES - 1;

/** sEscalatorMetatiles_*: METATILE_PokemonCenter_Escalator_* (constants/metatile_labels.h, from the extracted defines) */
function escalatorMetatiles(section: string, order: readonly string[]): number[] {
  return order.map((stage) => K[`METATILE_PokemonCenter_Escalator_${section}_${stage}`]);
}
const BOTTOM_ORDER = ['Transition2', 'Transition1', 'Normal'] as const;
const TOP_ORDER = ['Normal', 'Transition1', 'Transition2'] as const;
let sEscalatorMetatiles: Record<string, number[]> | undefined;
function metatiles(): Record<string, number[]> {
  return (sEscalatorMetatiles ??= {
    BottomNextRail: escalatorMetatiles('BottomNextRail', BOTTOM_ORDER),
    BottomRail: escalatorMetatiles('BottomRail', BOTTOM_ORDER),
    BottomNext: escalatorMetatiles('BottomNext', BOTTOM_ORDER),
    Bottom: escalatorMetatiles('Bottom', BOTTOM_ORDER),
    TopNext: escalatorMetatiles('TopNext', TOP_ORDER),
    Top: escalatorMetatiles('Top', TOP_ORDER),
    TopNextRail: escalatorMetatiles('TopNextRail', TOP_ORDER),
  });
}

/** sEscalatorTaskId */
let sEscalatorTask: Task | undefined;

// Task_DrawEscalator's data
const tState = 0;
const tTransitionStage = 1;
const tGoingUp = 2;
const tDrawingEscalator = 3;
const tPlayerX = 4;
const tPlayerY = 5;

/** The cells MapGridSetMetatileIdAt changed since the last DrawWholeMapView (world "x,y"). */
const sPendingDraws = new Set<string>();

function MapGridGetMetatileIdAt(x: number, y: number): number {
  return fieldMoveHost().tileAt(x, y).metatile;
}

function MapGridSetMetatileIdAt(x: number, y: number, value: number): void {
  escalatorHost().setMetatileIdAt(x, y, value);
  sPendingDraws.add(`${x},${y}`);
}

/**
 * DrawWholeMapView: the BG shows the map grid again. The port draws every other grid change at once, so only the
 * escalator's cells are behind.
 */
function DrawWholeMapView(): void {
  const h = escalatorHost();
  for (const cell of sPendingDraws) {
    const [x, y] = cell.split(',').map(Number);
    h.drawMetatileAt(x, y);
  }
  sPendingDraws.clear();
}

/** SetEscalatorMetatile: the 3x3 around the player; each cell of this section moves on to its next stage. */
function SetEscalatorMetatile(task: Task, metatileIds: readonly number[], metatileMasks: number): void {
  const x = task.data[tPlayerX] - 1;
  const y = task.data[tPlayerY] - 1;
  const transitionStage = task.data[tTransitionStage];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const id = MapGridGetMetatileIdAt(x + j, y + i);
      if (!task.data[tGoingUp]) {
        if (metatileIds[transitionStage] === id) {
          if (transitionStage !== LAST_ESCALATOR_STAGE) MapGridSetMetatileIdAt(x + j, y + i, metatileMasks | metatileIds[transitionStage + 1]);
          else MapGridSetMetatileIdAt(x + j, y + i, metatileMasks | metatileIds[0]);
        }
      } else if (metatileIds[LAST_ESCALATOR_STAGE - transitionStage] === id) {
        if (transitionStage !== LAST_ESCALATOR_STAGE) MapGridSetMetatileIdAt(x + j, y + i, metatileMasks | metatileIds[1 - transitionStage]);
        else MapGridSetMetatileIdAt(x + j, y + i, metatileMasks | metatileIds[LAST_ESCALATOR_STAGE]);
      }
    }
  }
}

/**
 * Task_DrawEscalator: one section of the escalator a frame (states 0-6; 7 does nothing), then DrawWholeMapView and
 * the next transition stage: the steps move every 8 frames.
 */
function Task_DrawEscalator(task: Task): void {
  const data = task.data;
  const m = metatiles();
  data[tDrawingEscalator] = 1;
  switch (data[tState]) {
    case 0:
      SetEscalatorMetatile(task, m.BottomNextRail, 0);
      break;
    case 1:
      SetEscalatorMetatile(task, m.BottomRail, 0);
      break;
    case 2:
      SetEscalatorMetatile(task, m.BottomNext, MAPGRID_COLLISION_MASK);
      break;
    case 3:
      SetEscalatorMetatile(task, m.Bottom, 0);
      break;
    case 4:
      SetEscalatorMetatile(task, m.TopNext, MAPGRID_COLLISION_MASK);
      break;
    case 5:
      SetEscalatorMetatile(task, m.Top, 0);
      break;
    case 6:
      SetEscalatorMetatile(task, m.TopNextRail, 0);
      break;
  }
  data[tState] = (data[tState] + 1) & 7;
  if ((data[tState] & 7) === 0) {
    DrawWholeMapView();
    data[tTransitionStage] = (data[tTransitionStage] + 1) % ESCALATOR_STAGES;
    data[tDrawingEscalator] = 0;
  }
}

/** CreateEscalatorTask: priority 0, around the player's tile; its first section is drawn at once. */
function CreateEscalatorTask(goingUp: boolean): Task {
  const task = CreateTask(Task_DrawEscalator, 0);
  const { x, y } = PlayerGetDestCoords();
  task.data[tPlayerX] = x;
  task.data[tPlayerY] = y;
  task.data[tState] = 0;
  task.data[tTransitionStage] = 0;
  task.data[tGoingUp] = goingUp ? 1 : 0;
  Task_DrawEscalator(task);
  return task;
}

/** StartEscalator */
export function StartEscalator(goingUp: boolean): void {
  sEscalatorTask = CreateEscalatorTask(goingUp);
  testEvent('escalatorStart', { goingUp });
}

/** StopEscalator: what the grid has and the BG doesn't show yet stays undrawn, as on the GBA. */
export function StopEscalator(): void {
  DestroyTask(sEscalatorTask);
  testEvent('escalatorStop');
}

/** IsEscalatorMoving: until a stage's last section is drawn with the stage at LAST_ESCALATOR_STAGE. */
export function IsEscalatorMoving(): boolean {
  const data = sEscalatorTask?.data;
  if (!data) return false;
  if (data[tDrawingEscalator] === 0) return data[tTransitionStage] !== LAST_ESCALATOR_STAGE;
  return true;
}

// ------------------------------------------------------------------ field_effect.c

/** The player's sprite drawn (x2, y2) px off its tile (CameraObjectReset2: the camera stays on the tile). */
function setPlayerSpriteOffset(x2: number, y2: number): void {
  const p = playerObj();
  p.sprite.setPosition(p.anchor.x + x2, p.feetY + p.lift + y2);
}

/** The destination SetupWarp stored, once its header has loaded (null while it loads). */
let sWarpDestination: { mapId: string; warpId: number; x: number; y: number } | undefined | null = null;

/** DoEscalatorWarp (field_fadetransition.c): LockPlayerFieldControls, StartEscalatorWarp(metatileBehavior, 10) */
export function DoEscalatorWarp(metatileBehavior: number): void {
  LockPlayerFieldControls();
  StartEscalatorWarp(metatileBehavior, 10);
}

/** StartEscalatorWarp: data[1] = TRUE on an up escalator. */
export function StartEscalatorWarp(metatileBehavior: number, priority: number): void {
  sWarpDestination = null;
  void fieldMoveHost()
    .warpDestination()
    .then((dest) => (sWarpDestination = dest));
  const task = CreateTask(Task_EscalatorWarpFieldEffect, priority);
  task.data[1] = metatileBehavior === K.MB_UP_ESCALATOR ? 1 : 0;
  testEvent('escalatorWarp', { up: task.data[1] === 1 });
}

/** Task_EscalatorWarpFieldEffect: sEscalatorWarpFieldEffectFuncs all return FALSE (one a frame). */
function Task_EscalatorWarpFieldEffect(task: Task): void {
  while (sEscalatorWarpFieldEffectFuncs[task.data[0]](task));
}

const sEscalatorWarpFieldEffectFuncs: ((task: Task) => boolean)[] = [
  // EscalatorWarpEffect_1: FreezeObjectEvents, CameraObjectReset2 (the camera stays on the tile)
  (task) => {
    avatarField().freezeObjectEvents();
    StartEscalator(task.data[1] !== 0);
    QuestLog_OnEscalatorWarp(QL_ESCALATOR_OUT);
    task.data[0]++;
    return false;
  },
  // EscalatorWarpEffect_2: once the step onto the escalator is over, face the way the player was going
  (task) => {
    const player = playerObj();
    if (!player.movementOverridden || player.clearHeldMovementIfFinished()) {
      player.setHeldMovement(directionalAction('FACE', GetPlayerFacingDirection()));
      task.data[0]++;
      task.data[2] = 0;
      task.data[3] = 0;
      if ((task.data[1] & 0xff) === 0) task.data[0] = 4;
      PlaySE(K.SE_ESCALATOR);
    }
    return false;
  },
  // EscalatorWarpEffect_3 (up escalators)
  (task) => {
    Escalator_AnimatePlayerGoingDown(task);
    if (task.data[2] > 3) {
      if (!Escalator_BeginFadeOutToNewMap()) return false;
      task.data[0]++;
    }
    return false;
  },
  // EscalatorWarpEffect_4
  (task) => {
    Escalator_AnimatePlayerGoingDown(task);
    Escalator_TransitionToWarpInEffect(task);
    return false;
  },
  // EscalatorWarpEffect_5 (down escalators)
  (task) => {
    Escalator_AnimatePlayerGoingUp(task);
    if (task.data[2] > 3) {
      if (!Escalator_BeginFadeOutToNewMap()) return false;
      task.data[0]++;
    }
    return false;
  },
  // EscalatorWarpEffect_6
  (task) => {
    Escalator_AnimatePlayerGoingUp(task);
    Escalator_TransitionToWarpInEffect(task);
    return false;
  },
];

/** Escalator_AnimatePlayerGoingDown (the C's name; it runs on the up escalators): up and left, a pixel every 2 frames. */
function Escalator_AnimatePlayerGoingDown(task: Task): void {
  setPlayerSpriteOffset(Cos(0x84, task.data[2]), Sin(0x94, task.data[2]));
  task.data[3]++;
  if (task.data[3] & 1) task.data[2]++;
}

/** Escalator_AnimatePlayerGoingUp (it runs on the down escalators): down and left. */
function Escalator_AnimatePlayerGoingUp(task: Task): void {
  setPlayerSpriteOffset(Cos(0x7c, task.data[2]), Sin(0x76, task.data[2]));
  task.data[3]++;
  if (task.data[3] & 1) task.data[2]++;
}

let sFadeOut: (() => boolean) | undefined;

/**
 * Escalator_BeginFadeOutToNewMap: TryFadeOutOldMapMusic, WarpFadeOutScreen (toward the destination, whose header
 * the port loads first: false while SetupWarp's load is still running, which holds the state a frame).
 */
function Escalator_BeginFadeOutToNewMap(): boolean {
  if (sWarpDestination === null) return false;
  if (!sWarpDestination) {
    console.warn('[warp] no warp destination set');
    sFadeOut = () => false;
    return true;
  }
  sFadeOut = fieldMoveHost().warpFadeOutScreen(sWarpDestination.mapId, true);
  testEvent('escalatorFadeOut');
  return true;
}

/** Escalator_TransitionToWarpInEffect: once faded and the music stopped, StopEscalator, WarpIntoMap, CB2_LoadMap. */
function Escalator_TransitionToWarpInEffect(task: Task): void {
  if (sFadeOut?.() && sWarpDestination) {
    StopEscalator();
    const dest = sWarpDestination;
    sFadeOut = undefined;
    fieldMoveHost().warpIntoMap(dest.mapId, dest.x, dest.y, FieldCB_EscalatorWarpIn, dest.warpId);
    DestroyTask(task);
  }
}

/**
 * FieldCB_EscalatorWarpIn: Overworld_PlaySpecialMapMusic, WarpFadeInScreen, the quest log's header in playback,
 * LockPlayerFieldControls, FreezeObjectEvents, then Task_EscalatorWarpInFieldEffect (priority 0).
 */
function FieldCB_EscalatorWarpIn(): void {
  Overworld_PlaySpecialMapMusic();
  fieldMoveHost().warpFadeInScreen();
  QuestLog_DrawPreviouslyOnQuestHeaderIfInPlaybackMode();
  LockPlayerFieldControls();
  avatarField().freezeObjectEvents();
  CreateTask(Task_EscalatorWarpInFieldEffect, 0);
  testEvent('escalatorWarpIn');
}

/** Task_EscalatorWarpInFieldEffect */
function Task_EscalatorWarpInFieldEffect(task: Task): void {
  while (task.isActive && sEscalatorWarpInFieldEffectFuncs[task.data[0]](task));
}

const sEscalatorWarpInFieldEffectFuncs: ((task: Task) => boolean)[] = [
  // EscalatorWarpInEffect_1: CameraObjectReset2, face east; the steps run the other way on a down escalator
  (task) => {
    const player = playerObj();
    player.setHeldMovement(directionalAction('FACE', 'right'));
    const { x, y } = PlayerGetDestCoords();
    const behavior = avatarField().behaviorAt(x, y);
    task.data[0]++;
    task.data[1] = 16;
    let goingUp = false;
    if (behavior === K.MB_DOWN_ESCALATOR) {
      goingUp = true;
      task.data[0] = 3;
    }
    StartEscalator(goingUp);
    return true;
  },
  // EscalatorWarpInEffect_2 (arriving on an up escalator: from 2F)
  (task) => {
    setPlayerSpriteOffset(Cos(0x84, task.data[1]), Sin(0x94, task.data[1]));
    task.data[0]++;
    return false;
  },
  // EscalatorWarpInEffect_3
  (task) => {
    setPlayerSpriteOffset(Cos(0x84, task.data[1]), Sin(0x94, task.data[1]));
    task.data[2]++;
    if (task.data[2] & 1) task.data[1]--;
    if (task.data[1] === 0) {
      setPlayerSpriteOffset(0, 0);
      task.data[0] = 5;
    }
    return false;
  },
  // EscalatorWarpInEffect_4 (arriving on a down escalator: from 1F)
  (task) => {
    setPlayerSpriteOffset(Cos(0x7c, task.data[1]), Sin(0x76, task.data[1]));
    task.data[0]++;
    return false;
  },
  // EscalatorWarpInEffect_5
  (task) => {
    setPlayerSpriteOffset(Cos(0x7c, task.data[1]), Sin(0x76, task.data[1]));
    task.data[2]++;
    if (task.data[2] & 1) task.data[1]--;
    if (task.data[1] === 0) {
      setPlayerSpriteOffset(0, 0);
      task.data[0]++;
    }
    return false;
  },
  // EscalatorWarpInEffect_6: wait for the steps to come to rest
  (task) => {
    if (IsEscalatorMoving()) return false;
    StopEscalator();
    task.data[0]++;
    return true;
  },
  // EscalatorWarpInEffect_7: CameraObjectReset1, the controls back, then the step off east
  (task) => {
    const player = playerObj();
    if (player.clearHeldMovementIfFinished()) {
      UnlockPlayerFieldControls();
      avatarField().unfreezeObjectEvents();
      player.setHeldMovement(directionalAction('WALK_NORMAL', 'right'));
      DestroyTask(task);
      QuestLog_OnEscalatorWarp(QL_ESCALATOR_IN);
      testEvent('escalatorDone');
    }
    return false;
  },
];

/** Dev: the escalator's draw task and the player's sprite offset, for `__test.field().escalator`. */
export function escalatorProbe(): { moving: boolean; state: number; transitionStage: number; goingUp: boolean; drawing: boolean } | undefined {
  const data = sEscalatorTask?.isActive ? sEscalatorTask.data : undefined;
  if (!data) return undefined;
  return {
    moving: IsEscalatorMoving(),
    state: data[tState],
    transitionStage: data[tTransitionStage],
    goingUp: data[tGoingUp] !== 0,
    drawing: data[tDrawingEscalator] !== 0,
  };
}
