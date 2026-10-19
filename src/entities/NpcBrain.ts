import type { ObjectEventData } from '../data/types';
import { DELTA, DIRECTIONS, OPPOSITE, type Direction } from '../world/direction';
import type { ObjectEvent } from './ObjectEvent';
import { random } from '../util/random';
import { gSineTable } from '../battle/trig';
import { directionalAction } from './movementActions';

/** ANIM_RAISE_HAND's frame (sAnim_RaiseHand: frame 9, then END) */
const RAISE_HAND_FRAME = 9;

/**
 * The MOVEMENT_TYPE_RAISE_HAND_AND_* types (event_object_movement.c), which the VS Seeker gives trainers who want
 * a rematch: the type's sprite->data[1] step and its single movement action's (MOVEMENT_ACTION_RAISE_HAND_AND_*)
 * data[2] / data[4..7], plus the sprite's x2/y2.
 */
interface RaiseHandState {
  /** sprite->data[1]: 0 = Step0 (set the single movement), 1 = Step1 (run it), 2 = RaiseHandAndStop_Step2 */
  step: number;
  /** the action's data[2]: 0 = RaiseHand_Step0 next, 1 = its Step1 */
  action: number;
  d4: number;
  d5: number;
  d6: number;
  d7: number;
  x2: number;
  y2: number;
}

const DIR_NAMES: Record<string, Direction> = { DIR_SOUTH: 'down', DIR_NORTH: 'up', DIR_WEST: 'left', DIR_EAST: 'right' };
let initialFacing: Record<string, string> = {};

/** gInitialMovementTypeFacingDirections, from the extracted constants (set at boot). */
export function setInitialMovementTypeFacing(table: Record<string, string>): void {
  initialFacing = table;
}

/** Decides what an NPC does each frame, following its MOVEMENT_TYPE_* from the map data. */
export class NpcBrain {
  private wait: number;
  private readonly homeX: number;
  private readonly homeY: number;
  private kind!: string;
  private lookDirs!: Direction[];
  private walkDir: Direction | undefined;
  private raiseHand?: RaiseHandState;
  /** objectEvent->singleMovementActive, as the raise-hand jump sets it (in the air); FreezeObjectEvent waits for it. */
  singleMovementActive = false;
  /** ObjectEventSetSingleMovement's quest log hook (QuestLogRecordNPCStep while recording): the action started. */
  onSingleMovement?: (movementActionId: number) => void;

  constructor(
    readonly obj: ObjectEvent,
    readonly data: ObjectEventData,
    private canMove: (obj: ObjectEvent, dir: Direction) => boolean,
  ) {
    this.homeX = obj.tileX;
    this.homeY = obj.tileY;
    this.wait = randomWait();
    this.setMovementType(data.movement_type);
    if (this.lookDirs.length) obj.face(this.lookDirs[0]);
  }

  /** SetTrainerMovementType: switch to another MOVEMENT_TYPE_* from the next frame on. */
  setMovementType(movementType: string): void {
    const wasRaisingHand = this.raiseHand !== undefined;
    this.kind = movementType.replace('MOVEMENT_TYPE_', '');
    this.obj.originalFacing = DIR_NAMES[initialFacing[movementType]] ?? 'down';
    this.lookDirs = parseLookDirections(this.kind);
    this.walkDir = this.lookDirs[0];
    this.singleMovementActive = false;
    if (this.kind.startsWith('RAISE_HAND_AND_')) {
      this.raiseHand = { step: 0, action: 0, d4: 0, d5: 0, d6: 0, d7: 0, x2: this.raiseHand?.x2 ?? 0, y2: this.raiseHand?.y2 ?? 0 };
    } else if (wasRaisingHand) {
      // The next type's first step (e.g. MovementType_FaceDirection_Step0's face action) shows the standing frame.
      // The GBA leaves x2/y2 where they were unless ResetMovementOfRematchableTrainers zeroes them; they're zeroed here.
      this.raiseHand = undefined;
      this.renderOffset(0, 0);
      this.obj.face(this.obj.facing);
    }
  }

  /** objectEvent->movementType */
  get movementType(): string {
    return `MOVEMENT_TYPE_${this.kind}`;
  }

  /** The raise-hand sprite offset (sprite->x2 / y2), for tests. */
  get spriteOffset(): { x2: number; y2: number } {
    return { x2: this.raiseHand?.x2 ?? 0, y2: this.raiseHand?.y2 ?? 0 };
  }

  /** Paused NPCs (e.g. while talking) hold still. */
  paused = false;

  tick(): void {
    this.obj.tick();
    if (this.raiseHand) {
      // A frozen object stops where it is; the jump lands first (lock waits for singleMovementActive).
      if (!this.paused || this.singleMovementActive) this.raiseHandTick(this.raiseHand);
      return;
    }
    if (this.paused || this.obj.isMoving) return;
    if (--this.wait > 0) return;
    this.wait = randomWait();

    switch (true) {
      case this.kind === 'WANDER_AROUND':
        return this.wander(DIRECTIONS);
      case this.kind.startsWith('WANDER_UP_AND_DOWN') || this.kind.startsWith('WANDER_DOWN_AND_UP'):
        return this.wander(['up', 'down']);
      case this.kind.startsWith('WANDER_LEFT_AND_RIGHT') || this.kind.startsWith('WANDER_RIGHT_AND_LEFT'):
        return this.wander(['left', 'right']);
      case this.kind.startsWith('WALK_') && this.walkDir !== undefined:
        return this.pace();
      case this.kind === 'LOOK_AROUND':
        return this.face(pick(DIRECTIONS));
      case this.kind.startsWith('FACE_') && this.lookDirs.length > 1:
        return this.face(pick(this.lookDirs));
    }
  }

  /**
   * MovementType_RaiseHandAndStop / _Jump / _Swim with their actions (MovementAction_RaiseHand_Step0 and
   * MovementAction_RaiseHandAnd{Stop,Jump,Swim}_Step1). Stop holds the raised hand; Jump hops twice (13 frames
   * up and down, 3 px * sin), 17 frames apart, facing south in between, then rests 81 frames and starts over;
   * Swim sways x2 by sin >> 7 over 64 frames.
   */
  private raiseHandTick(r: RaiseHandState): void {
    const kind = this.kind;
    if (r.step === 0) {
      // Step0: ClearObjectEventMovement + ObjectEventSetSingleMovement. Stop's returns TRUE (Step1 runs too).
      this.singleMovementActive = false;
      r.step = 1;
      r.action = 0;
      if (kind !== 'RAISE_HAND_AND_STOP') return;
    }
    if (r.step === 2) {
      this.singleMovementActive = false; // RaiseHandAndStop_Step2
      return;
    }
    // Step1: ObjectEventExecSingleMovementAction
    if (r.action === 0) {
      // MovementAction_RaiseHand_Step0: StartSpriteAnim(ANIM_RAISE_HAND)
      this.showFrame(RAISE_HAND_FRAME, false);
      r.action = 1;
      r.d4 = r.d5 = r.d6 = r.d7 = 0;
      return;
    }
    let done = false;
    if (kind === 'RAISE_HAND_AND_STOP') {
      done = true; // sprite->animEnded (a one-frame anim)
    } else if (kind === 'RAISE_HAND_AND_JUMP') {
      done = this.raiseHandJump(r);
    } else {
      r.d7 = (r.d7 + 4) & 0xff;
      this.renderOffset(gSineTable(r.d7) >> 7, 0);
      done = r.d7 === 0;
    }
    if (!done) return;
    if (kind === 'RAISE_HAND_AND_STOP') r.step = 2;
    else r.step = 0; // MovementType_RaiseHandAndMove_Step1
  }

  /** MovementAction_RaiseHandAndJump_Step1 */
  private raiseHandJump(r: RaiseHandState): boolean {
    switch (r.d7) {
      case 0:
        if ((r.d6 += 10) > 127) {
          r.d6 = 0;
          r.d5++;
          r.d7 = r.d5;
          this.showFrame(FACE_SOUTH_FRAME, false); // StartSpriteAnim(ANIM_STD_FACE_SOUTH)
        }
        this.renderOffset(0, -((3 * gSineTable(r.d6)) >> 7));
        this.singleMovementActive = r.y2 !== 0;
        return false;
      case 1:
        if (++r.d4 > 16) {
          r.d4 = 0;
          this.showFrame(RAISE_HAND_FRAME, false);
          r.d7 = 0;
        } else {
          this.singleMovementActive = false;
        }
        return false;
      case 2:
        this.singleMovementActive = false;
        if (++r.d4 > 80) {
          r.d4 = 0;
          return true;
        }
        return false;
    }
    return false;
  }

  private showFrame(frame: number, flip: boolean): void {
    this.obj.sprite.setFrame(frame);
    this.obj.sprite.setFlipX(flip);
  }

  /** sprite->x2 / y2 on the drawn sprite (the object stays on its tile). */
  private renderOffset(x2: number, y2: number): void {
    if (this.raiseHand) {
      this.raiseHand.x2 = x2;
      this.raiseHand.y2 = y2;
    }
    const obj = this.obj;
    obj.sprite.setPosition(obj.anchor.x + x2, obj.feetY + obj.lift + y2);
  }

  private wander(dirs: readonly Direction[]): void {
    const dir = pick(dirs);
    this.face(dir);
    if (this.withinRange(dir) && this.canMove(this.obj, dir)) this.walk(dir);
  }

  /** A face single movement (GetFaceDirectionMovementAction) */
  private face(dir: Direction): void {
    this.onSingleMovement?.(directionalAction('FACE', dir));
    this.obj.face(dir);
  }

  /** A step single movement (GetWalkNormalMovementAction) */
  private walk(dir: Direction): void {
    this.onSingleMovement?.(directionalAction('WALK_NORMAL', dir));
    this.obj.move(dir);
  }

  /** WALK_* types pace back and forth along an axis, reversing at the range edge or when blocked. */
  private pace(): void {
    let dir = this.walkDir!;
    if (!this.withinRange(dir) || !this.canMove(this.obj, dir)) {
      dir = OPPOSITE[dir];
      this.walkDir = dir;
    }
    this.wait = 1;
    if (this.withinRange(dir) && this.canMove(this.obj, dir)) this.walk(dir);
    else if (this.obj.facing !== dir) this.face(dir);
    else this.obj.face(dir); // blocked: the C walks in place every 16 frames; the port stands (and records nothing)
  }

  private withinRange(dir: Direction): boolean {
    const { dx, dy } = DELTA[dir];
    const rx = this.data.movement_range_x;
    const ry = this.data.movement_range_y;
    const nx = this.obj.tileX + dx - this.homeX;
    const ny = this.obj.tileY + dy - this.homeY;
    return (rx === 0 || Math.abs(nx) <= rx) && (ry === 0 || Math.abs(ny) <= ry) && (dx === 0 || rx > 0) && (dy === 0 || ry > 0);
  }
}

/** sAnim_FaceSouth's frame */
const FACE_SOUTH_FRAME = 0;

function parseLookDirections(kind: string): Direction[] {
  const m = /^(?:FACE|WALK)_(.+)$/.exec(kind);
  if (!m) return [];
  const map: Record<string, Direction> = { UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' };
  return m[1]
    .split('_')
    .map((w) => map[w])
    .filter((d): d is Direction => d !== undefined);
}

// The GBA rolls these on the global RNG (Random() & 3 / & 1), so they share the seed with everything else.
function pick<T>(arr: readonly T[]): T {
  return arr[random() % arr.length];
}

function randomWait(): number {
  // GBA wanderers idle 32/64/96/128 frames between moves (gMovementDelaysMedium[Random() & 3]).
  return 32 * (1 + (random() & 3));
}
