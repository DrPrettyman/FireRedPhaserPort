// The event islands' specials (data/specials.inc), all field_specials.c: ShakeScreen (Navel Rock's base before Lugia;
// Six Island's Dotted Hole and Seven Island's Tanoby Key use it too), LoopWingFlapSound (Navel Rock's summit, Ho-Oh),
// Birth Island's triangle puzzle (DoDeoxysTriangleInteraction, SetDeoxysTrianglePalette) and the step counter it
// reads (IncrementBirthIslandRockStepCount, called by ProcessPlayerFieldInput on every step). The rock's palette and
// field effects are world/deoxysRock.ts. The tickets that take the player there are menus/hallOfFame.ts'
// GiveEventTickets.

import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound';
import type { GameState } from '../state/GameState';
import { FieldEffectActiveListContains, FieldEffectStart, gFieldEffectArguments } from '../world/fieldEffectScripts';
import type { ScriptHost } from './ScriptEngine';
import type { Special, SpecialEnv } from './specials';

/**
 * world/deoxysRock.ts' LoadDeoxysObjectPal (LoadPalette(sDeoxysObjectPals[num], OBJ_PLTT_ID(10), PLTT_SIZEOF(4)) and
 * the triangle redrawn on it), set by its registerDeoxysRock: it draws with Phaser, which the unit tests can't load.
 */
let LoadDeoxysObjectPal: (num: number, rockLocalId: number) => void = () => {};

export function setLoadDeoxysObjectPal(fn: (num: number, rockLocalId: number) => void): void {
  LoadDeoxysObjectPal = fn;
}

/** (s16) of a u16 special var */
const s16 = (v: number) => (v << 16) >> 16;

// field_specials.c: sDeoxysCoords (map-local tiles of the triangle, by VAR_DEOXYS_INTERACTION_NUM) and
// sDeoxysStepCaps (the steps allowed to reach it from the last one).
const sDeoxysCoords: [number, number][] = [
  [15, 12],
  [11, 14],
  [15, 8],
  [19, 14],
  [12, 11],
  [18, 11],
  [15, 14],
  [11, 14],
  [19, 14],
  [15, 15],
  [15, 10],
];
const sDeoxysStepCaps = [4, 8, 8, 8, 4, 4, 4, 6, 3, 3];

/** LOCALID_BIRTH_ISLAND_EXTERIOR_ROCK (the map's object list) */
function rockLocalId(host: ScriptHost): number {
  return host.resolveLocalId('LOCALID_BIRTH_ISLAND_EXTERIOR_ROCK') ?? 1;
}

/**
 * MoveDeoxysObject: the palette (SE_M_CONFUSE_RAY back to the start, SE_DEOXYS_MOVE on), Task_WaitDeoxysFieldEffect
 * (which re-enables the script once FLDEFF_MOVE_DEOXYS_ROCK is over: 60 frames back to the start, 5 to the next
 * corner) and SetObjEventTemplateCoords.
 */
function MoveDeoxysObject(num: number, host: ScriptHost, enable: () => void): void {
  const rock = rockLocalId(host);
  LoadDeoxysObjectPal(num, rock);
  PlaySE(num === 0 ? K.SE_M_CONFUSE_RAY : K.SE_DEOXYS_MOVE);
  // CreateTask(Task_WaitDeoxysFieldEffect, 8): created before the effect's task, so it runs first each frame
  host.startFieldTask({
    tick() {
      if (FieldEffectActiveListContains('FLDEFF_MOVE_DEOXYS_ROCK')) return false;
      enable(); // ScriptContext_Enable
      return true;
    },
  });
  gFieldEffectArguments[0] = rock;
  gFieldEffectArguments[1] = 0; // MAP_NUM / MAP_GROUP(MAP_BIRTH_ISLAND_EXTERIOR): the port looks on the current map
  gFieldEffectArguments[2] = 0;
  gFieldEffectArguments[3] = sDeoxysCoords[num][0];
  gFieldEffectArguments[4] = sDeoxysCoords[num][1];
  gFieldEffectArguments[5] = num === 0 ? 60 : 5;
  FieldEffectStart('FLDEFF_MOVE_DEOXYS_ROCK');
  host.setObjectTemplate(rock, { x: sDeoxysCoords[num][0], y: sDeoxysCoords[num][1] });
}

/** IncrementBirthIslandRockStepCount (ProcessPlayerFieldInput, every step): counts to 99, then wraps to 0. */
export function IncrementBirthIslandRockStepCount(state: GameState, mapId: string): void {
  if (mapId !== 'MAP_BIRTH_ISLAND_EXTERIOR') return;
  const count = state.getVar('VAR_DEOXYS_INTERACTION_STEP_COUNTER') + 1;
  state.setVar('VAR_DEOXYS_INTERACTION_STEP_COUNTER', count > 99 ? 0 : count);
}

export const EVENT_ISLAND_SPECIALS: Record<string, Special> = {
  /**
   * ShakeScreen: Task_ShakeScreen (priority 9) pans the camera by (VAR_0x8005, VAR_0x8004), flipping the sign every
   * VAR_0x8007 frames, VAR_0x8006 times; the last flip goes straight back to the standard pan
   * (InstallCameraPanAheadCallback) and Task_EndScreenShake re-enables the script (no script `waitstate`s on it).
   * SetCameraPanningCallback(NULL) while it runs: the port's camera has no pan-ahead to stop. SE_M_STRENGTH.
   */
  ShakeScreen({ state, host, setWaitState }: SpecialEnv) {
    let tXtrans = s16(state.getVar('VAR_0x8005'));
    let tTimer = 0;
    let tNremain = s16(state.getVar('VAR_0x8006'));
    const tDuration = s16(state.getVar('VAR_0x8007'));
    let tYtrans = s16(state.getVar('VAR_0x8004'));
    let enabled = false;
    host.startFieldTask({
      tick() {
        // Task_ShakeScreen
        tTimer++;
        if (tDuration !== 0 && tTimer % tDuration === 0) {
          tTimer = 0;
          tNremain--;
          tXtrans = -tXtrans;
          tYtrans = -tYtrans;
          host.setCameraPanning(tYtrans, tXtrans);
          if (tNremain === 0) {
            enabled = true; // Task_EndScreenShake: DestroyTask, ScriptContext_Enable
            host.setCameraPanning(0, 0); // InstallCameraPanAheadCallback
            return true;
          }
        }
        return false;
      },
    });
    PlaySE(K.SE_M_STRENGTH);
    setWaitState(() => enabled);
  },

  /**
   * LoopWingFlapSound: SE_M_WING_ATTACK now and every VAR_0x8005 frames after (Task_WingFlapSound), VAR_0x8004 flaps
   * in all. The task reads both vars every frame, as the C does.
   */
  LoopWingFlapSound({ state, host }: SpecialEnv) {
    const data = [0, 0];
    host.startFieldTask({
      tick() {
        // Task_WingFlapSound
        data[1]++;
        if (data[1] === state.getVar('VAR_0x8005')) {
          data[0]++;
          data[1] = 0;
          PlaySE(K.SE_M_WING_ATTACK);
        }
        return data[0] === state.getVar('VAR_0x8004') - 1; // DestroyTask
      },
    });
    PlaySE(K.SE_M_WING_ATTACK);
  },

  /**
   * DoDeoxysTriangleInteraction: Task_DoDeoxysTriangleInteraction, run here at once (the C creates it to run later
   * in the same frame; the tasks it creates run in that frame either way). VAR_RESULT: 0 too many steps (the
   * triangle goes back to the start), 1 on to the next corner, 2 the tenth touch (FLAG_SYS_DEOXYS_AWAKENED), 3
   * already awake. 0 and 1 re-enable the script once the triangle has moved, 2 and 3 at once.
   */
  DoDeoxysTriangleInteraction({ state, host, setWaitState }: SpecialEnv) {
    let enabled = false;
    const enable = () => (enabled = true);
    setWaitState(() => enabled);
    if (state.getFlag('FLAG_SYS_DEOXYS_AWAKENED')) {
      state.setVar('VAR_RESULT', 3);
      enable();
      return;
    }
    let r5 = state.getVar('VAR_DEOXYS_INTERACTION_NUM');
    const r6 = state.getVar('VAR_DEOXYS_INTERACTION_STEP_COUNTER');
    state.setVar('VAR_DEOXYS_INTERACTION_STEP_COUNTER', 0);
    if (r5 !== 0 && sDeoxysStepCaps[r5 - 1] < r6) {
      MoveDeoxysObject(0, host, enable);
      state.setVar('VAR_DEOXYS_INTERACTION_NUM', 0);
      state.setVar('VAR_RESULT', 0);
    } else if (r5 === 10) {
      state.setFlag('FLAG_SYS_DEOXYS_AWAKENED', true);
      state.setVar('VAR_RESULT', 2);
      enable();
    } else {
      r5++;
      MoveDeoxysObject(r5, host, enable);
      state.setVar('VAR_DEOXYS_INTERACTION_NUM', r5);
      state.setVar('VAR_RESULT', 1);
    }
  },

  /** SetDeoxysTrianglePalette (Birth Island's ON_RETURN_TO_FIELD): the triangle's palette for VAR_DEOXYS_INTERACTION_NUM. */
  SetDeoxysTrianglePalette({ state, host }: SpecialEnv) {
    LoadDeoxysObjectPal(state.getVar('VAR_DEOXYS_INTERACTION_NUM'), rockLocalId(host));
  },
};
