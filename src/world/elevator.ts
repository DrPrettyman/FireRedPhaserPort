// field_specials.c's elevators: which floor the elevator is on (from the dynamic warp the player
// entered it by), the floor select menu's starting position, the "Now on:" window, and AnimateElevator
// (the camera shake and the scrolling view through the elevator window).

import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';
import type { GameState } from '../state/GameState';

/** sFloorNamePointers, indexed by VAR_ELEVATOR_FLOOR / gSpecialVar_0x8005 */
export const FLOOR_NAMES = [
  'gText_B4F',
  'gText_B3F',
  'gText_B2F',
  'gText_B1F',
  'gText_1F',
  'gText_2F',
  'gText_3F',
  'gText_4F',
  'gText_5F',
  'gText_6F',
  'gText_7F',
  'gText_8F',
  'gText_9F',
  'gText_10F',
  'gText_11F',
  'gText_Rooftop',
];

const TRAINER_TOWER_FLOORS = ['1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', 'ROOF'].map((f) => `MAP_TRAINER_TOWER_${f}`);

/** GetElevatorFloor's switch: the floor of the map the dynamic warp leads back to (default 4, 1F). */
const FLOOR_BY_MAP: Record<string, number> = {
  MAP_SILPH_CO_1F: 4,
  MAP_SILPH_CO_2F: 5,
  MAP_SILPH_CO_3F: 6,
  MAP_SILPH_CO_4F: 7,
  MAP_SILPH_CO_5F: 8,
  MAP_SILPH_CO_6F: 9,
  MAP_SILPH_CO_7F: 10,
  MAP_SILPH_CO_8F: 11,
  MAP_SILPH_CO_9F: 12,
  MAP_SILPH_CO_10F: 13,
  MAP_SILPH_CO_11F: 14,
  MAP_ROCKET_HIDEOUT_B1F: 3,
  MAP_ROCKET_HIDEOUT_B2F: 2,
  MAP_ROCKET_HIDEOUT_B4F: 0,
  MAP_CELADON_CITY_DEPARTMENT_STORE_1F: 4,
  MAP_CELADON_CITY_DEPARTMENT_STORE_2F: 5,
  MAP_CELADON_CITY_DEPARTMENT_STORE_3F: 6,
  MAP_CELADON_CITY_DEPARTMENT_STORE_4F: 7,
  MAP_CELADON_CITY_DEPARTMENT_STORE_5F: 8,
  ...Object.fromEntries(TRAINER_TOWER_FLOORS.map((m) => [m, 15])),
  MAP_TRAINER_TOWER_LOBBY: 3,
};

/** InitElevatorFloorSelectMenuPos's switch: [sElevatorScroll, sElevatorCursorPos] (default [0, 0]). */
const MENU_POS_BY_MAP: Record<string, [number, number]> = {
  MAP_SILPH_CO_11F: [0, 0],
  MAP_SILPH_CO_10F: [0, 1],
  MAP_SILPH_CO_9F: [0, 2],
  MAP_SILPH_CO_8F: [0, 3],
  MAP_SILPH_CO_7F: [0, 4],
  MAP_SILPH_CO_6F: [1, 4],
  MAP_SILPH_CO_5F: [2, 4],
  MAP_SILPH_CO_4F: [3, 4],
  MAP_SILPH_CO_3F: [4, 4],
  MAP_SILPH_CO_2F: [5, 4],
  MAP_SILPH_CO_1F: [5, 5],
  MAP_ROCKET_HIDEOUT_B1F: [0, 0],
  MAP_ROCKET_HIDEOUT_B2F: [0, 1],
  MAP_ROCKET_HIDEOUT_B4F: [0, 2],
  MAP_CELADON_CITY_DEPARTMENT_STORE_5F: [0, 0],
  MAP_CELADON_CITY_DEPARTMENT_STORE_4F: [0, 1],
  MAP_CELADON_CITY_DEPARTMENT_STORE_3F: [0, 2],
  MAP_CELADON_CITY_DEPARTMENT_STORE_2F: [0, 3],
  MAP_CELADON_CITY_DEPARTMENT_STORE_1F: [0, 4],
  ...Object.fromEntries(TRAINER_TOWER_FLOORS.map((m) => [m, [0, 0] as [number, number]])),
  MAP_TRAINER_TOWER_LOBBY: [0, 1],
};

/** GetElevatorFloor */
export function getElevatorFloor(state: GameState): void {
  const map = state.dynamicWarp?.mapId ?? '';
  state.setVar('VAR_ELEVATOR_FLOOR', FLOOR_BY_MAP[map] ?? 4);
}

/** sElevatorScroll / sElevatorCursorPos: where the Silph Co. floor list (special ListMenu) starts. */
export let sElevatorScroll = 0;
export let sElevatorCursorPos = 0;

/** InitElevatorFloorSelectMenuPos: returns sElevatorCursorPos. */
export function initElevatorFloorSelectMenuPos(state: GameState): number {
  const [scroll, cursor] = MENU_POS_BY_MAP[state.dynamicWarp?.mapId ?? ''] ?? [0, 0];
  sElevatorScroll = scroll;
  sElevatorCursorPos = cursor;
  return cursor;
}

// METATILE_SilphCo_ElevatorWindow_* (every elevator map uses gTileset_SilphCo)
const TOP = [0x2e8, 0x2e9, 0x2ea];
const MID = [0x2f0, 0x2f1, 0x2f2];
const BOTTOM = [0x2f8, 0x2f9, 0x2fa];
const sElevatorWindowMetatilesGoingUp = [TOP, MID, BOTTOM];
const sElevatorWindowMetatilesGoingDown = [TOP, MID, BOTTOM].map((r) => [r[0], r[2], r[1]]);

const sElevatorAnimationDuration = [8, 16, 24, 32, 38, 46, 53, 56, 57];
const sElevatorWindowAnimDuration = [3, 6, 9, 12, 15, 18, 21, 24, 27];

export interface ElevatorHost {
  /** SetCameraPanning(0, dy) relative to the standard pan; 0 again for InstallCameraPanAheadCallback. */
  setCameraPanning(dy: number): void;
  /** MapGridSetMetatileIdAt on the current map (map-local coords), impassable, redrawn (DrawWholeMapView). */
  setMetatile(x: number, y: number, metatile: number, impassable: boolean): void;
}

/** A field task, run once per frame; tick returns true when it has destroyed itself. */
export interface FieldTask {
  tick(): boolean;
}

/**
 * AnimateElevator: Task_ElevatorShake (which ends the script's waitstate) and, alongside it,
 * Task_AnimateElevatorWindowView. gSpecialVar_0x8005 is the floor it leaves, 0x8006 the one it goes to.
 */
export function animateElevator(state: GameState, host: ElevatorHost): { shake: FieldTask & { done: boolean }; windowView: FieldTask } {
  const from = state.getVar('VAR_0x8005');
  const to = state.getVar('VAR_0x8006');
  let nfloors = from > to ? from - to : to - from;
  const direction = from > to ? 1 : 0;
  if (nfloors > 8) nfloors = 8;

  // Task_ElevatorShake (SetCameraPanningCallback(NULL) while it runs)
  let frames = 0;
  let shakes = 0;
  let pan = 1;
  const duration = sElevatorAnimationDuration[nfloors];
  const shake = {
    done: false,
    tick(): boolean {
      frames++;
      if (frames % 3 === 0) {
        frames = 0;
        shakes++;
        pan = -pan;
        host.setCameraPanning(pan);
        if (shakes === duration) {
          PlaySE(K.SE_DING_DONG); // then ScriptContext_Enable(); InstallCameraPanAheadCallback()
          host.setCameraPanning(0);
          shake.done = true;
        }
      }
      return shake.done;
    },
  };

  // Task_AnimateElevatorWindowView
  let step = 0;
  let timer = 0;
  const steps = sElevatorWindowAnimDuration[nfloors];
  const table = direction === 0 ? sElevatorWindowMetatilesGoingUp : sElevatorWindowMetatilesGoingDown;
  const windowView = {
    tick(): boolean {
      let destroyed = false;
      if (timer === 6) {
        step++;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) host.setMetatile(j + 1, i, table[i][step % 3], true);
        timer = 0;
        if (step === steps) destroyed = true;
      }
      timer++;
      return destroyed;
    },
  };
  PlaySE(K.SE_ELEVATOR);
  return { shake, windowView };
}
