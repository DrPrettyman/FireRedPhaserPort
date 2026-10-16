// The movement actions (MOVEMENT_ACTION_*) an object can be given as a held movement
// (ObjectEventSetHeldMovement), as ObjectEvent runs them. event_object_movement.c's sMovementActionFuncs
// step functions are folded into a few shapes: face (done in one frame), a step or jump between tiles,
// an animation in place, or a delay. Ids come from the extracted constants; the Get*MovementAction
// helpers (dirn_to_anim) build the name for a direction.

import { constant, K } from '../battle/constants';
import type { Direction } from '../world/direction';
import type { MoveKind } from './ObjectEvent';

export type HeldAction =
  | { type: 'face'; dir: Direction }
  | { type: 'move'; dir: Direction; kind: MoveKind; inPlace?: boolean }
  | { type: 'delay'; frames: number }
  | { type: 'none' };

const DIR_SUFFIX: Record<Direction, string> = { down: 'DOWN', up: 'UP', left: 'LEFT', right: 'RIGHT' };
const SUFFIX_DIR: Record<string, Direction> = { DOWN: 'down', UP: 'up', LEFT: 'left', RIGHT: 'right' };

/** Step-type actions by name prefix (MOVEMENT_ACTION_<prefix>_<DIR>). */
const MOVES: [string, MoveKind][] = [
  ['WALK_SLOWER', 'slower'], // MOVE_SPEED via SetWalkSlowerSpriteData: 1 px every 3rd frame
  ['WALK_SLOW', 'slow'],
  ['WALK_NORMAL', 'walk'],
  ['WALK_FASTER', 'faster'],
  ['WALK_FAST', 'fast'],
  ['RIDE_WATER_CURRENT', 'fast2'], // MOVE_SPEED_FAST_2
  ['GLIDE', 'fast'],
  ['SLIDE', 'fast'],
  ['PLAYER_RUN', 'run'],
  ['SPIN', 'spin'],
  ['JUMP_2', 'jump'],
  ['JUMP_SPECIAL_WITH_EFFECT', 'jumpSpecial'],
  ['JUMP_SPECIAL', 'jumpSpecial'],
  ['JUMP', 'jump1'],
];

const IN_PLACE: [string, MoveKind][] = [
  ['WALK_IN_PLACE_SLOW', 'inPlaceSlow'],
  ['WALK_IN_PLACE_NORMAL', 'inPlaceNormal'],
  ['WALK_IN_PLACE_FASTER', 'inPlaceFaster'],
  ['WALK_IN_PLACE_FAST', 'inPlaceFast'],
  ['JUMP_IN_PLACE', 'jumpInPlace'],
];

let names: Map<number, string> | undefined;
const cache = new Map<number, HeldAction>();

/** MOVEMENT_ACTION_NONE */
export function movementActionNone(): number {
  return K.MOVEMENT_ACTION_NONE;
}

/** A MOVEMENT_ACTION_* id by name (without the prefix). */
export function movementAction(name: string): number {
  return K[`MOVEMENT_ACTION_${name}`];
}

/** Get<name>MovementAction(direction): the action `name` toward `dir`, e.g. ('WALK_NORMAL', 'up'). */
export function directionalAction(name: string, dir: Direction): number {
  // PLAYER_RUN_*_SLOW puts the direction before the suffix
  if (name === 'PLAYER_RUN_SLOW') return K[`MOVEMENT_ACTION_PLAYER_RUN_${DIR_SUFFIX[dir]}_SLOW`];
  return K[`MOVEMENT_ACTION_${name}_${DIR_SUFFIX[dir]}`];
}

/** How ObjectEvent runs a held movement action id. */
export function heldActionSpec(id: number): HeldAction {
  let spec = cache.get(id);
  if (spec) return spec;
  if (!names) {
    names = new Map();
    // K is a proxy over the extracted defines; walk the known action names once.
    for (const prefix of [...MOVES, ...IN_PLACE].map(([p]) => p).concat(['FACE', 'PLAYER_RUN'])) {
      for (const d of Object.values(DIR_SUFFIX)) {
        for (const n of [`${prefix}_${d}`, `${prefix}_${d}_FAST`, `${prefix}_${d}_SLOW`]) {
          const v = constant(`MOVEMENT_ACTION_${n}`);
          if (v !== undefined && !names.has(v)) names.set(v, n);
        }
      }
    }
    for (const n of [1, 2, 4, 8, 16]) names.set(K[`MOVEMENT_ACTION_DELAY_${n}`], `DELAY_${n}`);
  }
  spec = parse(names.get(id));
  cache.set(id, spec);
  return spec;
}

function parse(name: string | undefined): HeldAction {
  if (!name) return { type: 'none' };
  let m = /^DELAY_(\d+)$/.exec(name);
  if (m) return { type: 'delay', frames: Number(m[1]) };
  m = /^FACE_(DOWN|UP|LEFT|RIGHT)(_FAST)?$/.exec(name);
  if (m) return { type: 'face', dir: SUFFIX_DIR[m[1]] };
  m = /^PLAYER_RUN_(DOWN|UP|LEFT|RIGHT)_SLOW$/.exec(name);
  if (m) return { type: 'move', dir: SUFFIX_DIR[m[1]], kind: 'runSlow' };
  for (const [prefix, kind] of IN_PLACE) {
    m = new RegExp(`^${prefix}_(DOWN|UP|LEFT|RIGHT)$`).exec(name);
    if (m) return { type: 'move', dir: SUFFIX_DIR[m[1]], kind, inPlace: true };
  }
  for (const [prefix, kind] of MOVES) {
    m = new RegExp(`^${prefix}_(DOWN|UP|LEFT|RIGHT)$`).exec(name);
    if (m) return { type: 'move', dir: SUFFIX_DIR[m[1]], kind };
  }
  return { type: 'none' };
}

/** The MOVEMENT_ACTION_* name of an id, for debugging and tests. */
export function movementActionName(id: number): string | undefined {
  heldActionSpec(id);
  return names?.get(id);
}
