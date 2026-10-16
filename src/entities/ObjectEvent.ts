import Phaser from 'phaser';
import { spriteTextureKey } from '../data/assets';
import type { SpriteInfo } from '../data/types';
import { DELTA, type Direction } from '../world/direction';
import { TILE, objectDepth } from '../world/MapChunk';
import { heldActionSpec, movementActionNone } from './movementActions';

/** Standard 9-frame overworld sheet: face S/N/W, then two step frames per direction. East = west flipped. */
const FACE_FRAME: Record<Direction, number> = { down: 0, up: 1, left: 2, right: 2 };
const STEP_FRAMES: Record<Direction, [number, number]> = { down: [3, 4], up: [5, 6], left: [7, 8], right: [7, 8] };
/** Player-only run frames (sAnim_Run*): indices 9-17 of the player's pic table. */
const RUN_FRAMES: Record<Direction, [number, number, number]> = {
  down: [9, 10, 11],
  up: [12, 13, 14],
  left: [15, 16, 17],
  right: [15, 16, 17],
};
/** sAnim_Spin*: [frame, hFlip], 2 frames each, looped once (two turns over a SPIN step). */
const SPIN_FRAMES: Record<Direction, [number, boolean][]> = {
  down: [[0, false], [2, true], [1, false], [2, false]],
  up: [[1, false], [2, false], [0, false], [2, true]],
  left: [[2, true], [1, false], [2, false], [0, false]],
  right: [[2, false], [0, false], [2, true], [1, false]],
};

/** sElevationToPriority: the OAM priority an object gets from its (previous) elevation. */
export const ELEVATION_TO_PRIORITY = [2, 2, 2, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 0, 0, 2];
/** sElevationToSubpriority: base of the y-sort key within a priority (lower draws in front). */
export const ELEVATION_TO_SUBPRIORITY = [115, 115, 83, 115, 83, 115, 83, 115, 83, 115, 83, 115, 83, 0, 0, 115];

/** When DoGroundEffects_* runs: OnSpawn, OnBeginStep, OnFinishStep. */
export type GroundEffectPhase = 'spawn' | 'beginStep' | 'finishStep';

/** What an object needs from the field. */
export interface ObjectEventField {
  /** MapGridGetElevationAt, in world tile coords. */
  elevationAt(x: number, y: number): number;
  /**
   * World pixel y of the screen's top edge as of the last camera update (gSpriteCoordOffsetY).
   * Objects update their subpriority before the camera moves each frame, so they see last frame's.
   */
  cameraTop: number;
  /** GetAllGroundEffectFlags_* + DoFlaggedGroundEffects for one of the DoGroundEffects_* hooks. */
  groundEffects?(obj: ObjectEvent, phase: GroundEffectPhase): void;
  /** DoShadowFieldEffect's FieldEffectStart(FLDEFF_SHADOW) */
  startShadow?(obj: ObjectEvent): void;
}

// sJumpY_High / sJumpY_Normal: sprite->y2 through a jump, indexed by its timer >> shift.
const JUMP_Y_HIGH = [-4, -6, -8, -10, -11, -12, -12, -12, -11, -10, -9, -8, -6, -4, 0, 0];
const JUMP_Y_NORMAL = [-2, -4, -6, -8, -9, -10, -10, -10, -9, -8, -6, -5, -3, -2, 0, 0];

export type MoveKind =
  | 'walk'
  | 'run'
  | 'runSlow' // PLAYER_RUN_*_SLOW (running up or down rock stairs)
  | 'jump' // ledge (JUMP_2): 2 tiles
  | 'jump1' // jump_*: 1 tile
  | 'jumpSpecial' // JUMP_SPECIAL(_WITH_EFFECT): 1 tile over 32 frames (getting off a surfing mon)
  | 'jumpInPlace' // JUMP_IN_PLACE_*
  | 'slowest'
  | 'slower'
  | 'slow'
  | 'fast'
  | 'fast2' // MOVE_SPEED_FAST_2 (RIDE_WATER_CURRENT: currents and the bike)
  | 'faster'
  | 'spin' // SPIN_* (spinner tiles)
  | 'inPlaceSlow' // WALK_IN_PLACE_SLOW (bumping into something on foot): 32 frames
  | 'inPlaceNormal' // WALK_IN_PLACE_NORMAL (bumping on the bike, pushing a boulder): 16 frames
  | 'inPlaceFast' // WALK_IN_PLACE_FAST (turning on the spot): 8 frames
  | 'inPlaceFaster'; // 4 frames

interface MoveSpec {
  tiles: number;
  frames: number;
  anim: 'walk' | 'run' | 'spin' | 'none';
  /** DoJumpSpriteMovement / DoJumpSpecialSpriteMovement: the y2 table and the timer's shift into it. */
  jump?: { table: number[]; shift: number };
  /** Pixels covered after each frame where the speed isn't constant (UpdateRunSlowAnim, DoJumpSpecialSpriteMovement). */
  steps?: number[];
}

/** Frames per tile follow the GBA movement speeds (1px/frame = 16 frames for a normal step). */
const MOVES: Record<MoveKind, MoveSpec> = {
  slowest: { tiles: 1, frames: 64, anim: 'walk' },
  slower: { tiles: 1, frames: 48, anim: 'walk' },
  slow: { tiles: 1, frames: 32, anim: 'walk' },
  walk: { tiles: 1, frames: 16, anim: 'walk' },
  fast: { tiles: 1, frames: 8, anim: 'walk' },
  fast2: { tiles: 1, frames: 6, anim: 'walk' }, // sSpeedFast2StepFuncs: 2,3,3,2,3,3 px
  faster: { tiles: 1, frames: 4, anim: 'walk' },
  run: { tiles: 1, frames: 8, anim: 'run' },
  runSlow: { tiles: 1, frames: 11, anim: 'run', steps: [1, 3, 4, 6, 7, 9, 10, 12, 13, 15, 16] },
  spin: { tiles: 1, frames: 8, anim: 'spin' },
  jump: { tiles: 2, frames: 32, anim: 'none', jump: { table: JUMP_Y_HIGH, shift: 1 } },
  jump1: { tiles: 1, frames: 16, anim: 'none', jump: { table: JUMP_Y_NORMAL, shift: 0 } },
  jumpSpecial: {
    tiles: 1,
    frames: 32,
    anim: 'none',
    jump: { table: JUMP_Y_HIGH, shift: 1 },
    steps: Array.from({ length: 32 }, (_, i) => (i >> 1) + 1), // Step1 on even timer values
  },
  jumpInPlace: { tiles: 0, frames: 16, anim: 'none', jump: { table: JUMP_Y_HIGH, shift: 0 } },
  inPlaceSlow: { tiles: 0, frames: 32, anim: 'walk' },
  inPlaceNormal: { tiles: 0, frames: 16, anim: 'walk' },
  inPlaceFast: { tiles: 0, frames: 8, anim: 'walk' },
  inPlaceFaster: { tiles: 0, frames: 4, anim: 'walk' },
};

export interface MoveOptions {
  /** Animate without changing tile (walk_in_place_*, jump_in_place_*). */
  inPlace?: boolean;
  /** Keep the current facing (lock_facing_direction). */
  keepFacing?: boolean;
}

interface Movement {
  dir: Direction;
  spec: MoveSpec;
  tiles: number;
  elapsed: number;
  fromX: number;
  fromY: number;
}

/**
 * Anything that stands on the map grid: the player and NPCs.
 * Positions are world tile coordinates; the sprite's feet sit on the tile's bottom edge.
 */
export class ObjectEvent {
  readonly sprite: Phaser.GameObjects.Sprite;
  /** The sprite's position without jump lift (sprite->x/y minus y2): what the camera follows (CameraObject_1). */
  readonly anchor = new Phaser.Math.Vector2();
  /** The graphics info (ObjectEventSetGraphicsId changes it). */
  info: SpriteInfo;
  /** graphicsId: the OBJ_EVENT_GFX_* the info is for, as its spawner set it. */
  graphicsId = '';
  tileX: number;
  tileY: number;
  /** facingDirection */
  facing: Direction = 'down';
  /** movementDirection: the direction of the last movement, which a locked facing doesn't follow. */
  movementDirection: Direction = 'down';
  /** facingDirectionLocked: steps don't turn the object (slide tiles, lock_facing_direction). */
  facingDirectionLocked = false;
  /** disableAnim: steps don't animate (sliding on ice and slide tiles). */
  disableAnim = false;
  /** enableAnim: TryEnableObjectEventAnim clears disableAnim on the next update. */
  enableAnim = false;
  /** heldMovementActive / heldMovementFinished / movementActionId (ObjectEventSetHeldMovement) */
  heldMovementActive = false;
  heldMovementFinished = false;
  movementActionId = 0xff;
  /** playerCopyableMovement (PlayerSetCopyableMovement): what copycat NPCs read. */
  playerCopyableMovement = 0;
  /** Elevation used for collision; 0 (e.g. stairs) is compatible with every elevation. */
  currentElevation: number;
  /** The last non-zero elevation, which picks the sprite's priority. */
  previousElevation: number;
  /** oam.priority: 2 = drawn under the map's top layer (BG1), 1 = over it (e.g. on a bridge). */
  priority: number;
  /** Sprite y-sort key within its priority; lower draws in front. */
  subpriority = 0;
  /**
   * currentCoords: the tile the GBA has the object on, for elevation and ground effects. Same as
   * tileX/tileY except during a jump, which shifts it a tile at the start and (a 2-tile ledge jump)
   * another at its halfway point, while tileX/tileY already hold the landing tile for collisions.
   */
  private currentX: number;
  private currentY: number;
  /** previousCoords: the tile a step started from; equal to the current tile when still. */
  private previousX: number;
  private previousY: number;
  /** previousMovementDirection: the facing before the last SetObjectEventDirection. */
  previousMovementDirection: Direction = 'down';
  // struct ObjectEvent's ground effect state
  currentMetatileBehavior = 0;
  previousMetatileBehavior = 0;
  triggerGroundEffectsOnMove = true; // set on spawn
  triggerGroundEffectsOnStop = false;
  disableCoveringGroundEffects = false;
  landingJump = false;
  disableJumpLandingGroundEffect = false;
  hasShadow = false;
  hasReflection = false;
  inShallowFlowingWater = false;
  inSandPile = false;
  inShortGrass = false;
  inHotSprings = false;
  /** sprite->y2 from a jump: the pixels the sprite is lifted (negative is up). */
  lift = 0;
  /** World pixel y of the sprite's bottom edge, ignoring jump lift (sprite->y - centerToCornerVecY). */
  feetY = 0;
  /** World pixel y of the sprite's top edge, including jump lift (oam.y before the camera offset). */
  private topY = 0;
  private movement?: Movement;
  /** Frames left of a held MOVEMENT_ACTION_DELAY_*. */
  private delayFrames = 0;
  private stepParity = 0;

  constructor(
    scene: Phaser.Scene,
    info: SpriteInfo,
    tileX: number,
    tileY: number,
    private readonly field: ObjectEventField,
    elevation = 3,
  ) {
    this.info = info;
    this.tileX = tileX;
    this.tileY = tileY;
    this.currentX = tileX;
    this.currentY = tileY;
    this.previousX = tileX;
    this.previousY = tileY;
    this.currentElevation = elevation;
    this.previousElevation = elevation;
    this.priority = ELEVATION_TO_PRIORITY[elevation]; // InitObjectPriorityByElevation
    this.sprite = scene.add.sprite(0, 0, spriteTextureKey(info), 0).setOrigin(0.5, 1);
    this.syncSprite(0, 0, 0);
    this.showFacing();
  }

  /** The sheet has the player's run frames (sAnimTable_RedGreenNormal). */
  get hasRunFrames(): boolean {
    return this.info.frameCount >= 18;
  }

  get isMoving(): boolean {
    return this.movement !== undefined;
  }

  /** previousCoords (DoesObjectCollideWithObjectAt checks it as well as the current tile). */
  get previous(): { x: number; y: number } {
    return { x: this.previousX, y: this.previousY };
  }

  /** currentCoords (see currentX): where ground effects look. */
  get current(): { x: number; y: number } {
    return { x: this.currentX, y: this.currentY };
  }

  /** sprite->x: the sprite's centre, world pixels. */
  get spriteX(): number {
    return this.anchor.x;
  }

  /** sprite->y: the sprite's centre without the jump lift (y2), world pixels. */
  get spriteY(): number {
    return this.feetY - this.info.frameHeight / 2;
  }

  /** !sprite->invisible */
  get visible(): boolean {
    return this.sprite.visible;
  }

  /** Tile this object will occupy once its current move finishes. */
  get destination(): { x: number; y: number } {
    return { x: this.tileX, y: this.tileY };
  }

  /** SetObjectEventDirection: the facing follows unless it's locked; the movement direction always does. */
  private setDirection(dir: Direction): void {
    this.previousMovementDirection = this.facing;
    if (!this.facingDirectionLocked) this.facing = dir;
    this.movementDirection = dir;
  }

  /** ObjectEventTurn: face a direction (shown at once unless a step is animating). */
  face(dir: Direction): void {
    this.setDirection(dir);
    if (!this.movement) this.showFacing();
  }

  /** ObjectEventSetGraphicsId: swap the sprite sheet (its texture must be loaded) and keep everything else. */
  setGraphics(info: SpriteInfo, graphicsId: string): void {
    this.graphicsId = graphicsId;
    if (info === this.info) return;
    this.info = info;
    this.sprite.setTexture(spriteTextureKey(info), 0);
    this.topY = this.feetY + this.lift - info.frameHeight;
    this.showFacing();
  }

  // ------------------------------------------------------------------ held movements

  /** ObjectEventIsMovementOverridden (single movements aren't modelled: scripts use MovementRunner). */
  get movementOverridden(): boolean {
    return this.heldMovementActive;
  }

  /**
   * ObjectEventSetHeldMovement: start a MOVEMENT_ACTION_* unless one is already held. Returns true when
   * refused. The action's first frame (Step0) is set up now; `tick` runs the rest, so the object's tile
   * changes here, as the GBA's currentCoords do before the other objects update.
   */
  setHeldMovement(actionId: number): boolean {
    if (this.movementOverridden) return true;
    this.movementActionId = actionId;
    this.heldMovementActive = true;
    this.heldMovementFinished = false;
    const action = heldActionSpec(actionId);
    switch (action.type) {
      case 'face':
        // FaceDirection: SetObjectEventDirection + ShiftStillObjectEventCoords; the action ends this frame.
        this.setDirection(action.dir);
        this.previousX = this.currentX;
        this.previousY = this.currentY;
        this.showFacing();
        this.heldMovementFinished = true;
        break;
      case 'move':
        this.beginMove(action.dir, action.kind, { inPlace: action.inPlace });
        break;
      case 'delay':
        this.delayFrames = action.frames;
        break;
      default:
        console.debug('[object] unported held movement action', actionId);
        this.heldMovementFinished = true;
    }
    return false;
  }

  /** ObjectEventForceSetHeldMovement */
  forceSetHeldMovement(actionId: number): void {
    this.clearHeldMovementIfActive();
    this.setHeldMovement(actionId);
  }

  /** ObjectEventClearHeldMovementIfActive */
  clearHeldMovementIfActive(): void {
    if (this.heldMovementActive) this.clearHeldMovement();
  }

  /**
   * ObjectEventClearHeldMovement. An animation in place stops where it is (the GBA resets the sprite's
   * action state); a step between tiles can't be cut short.
   */
  clearHeldMovement(): void {
    this.movementActionId = movementActionNone();
    this.heldMovementActive = false;
    this.heldMovementFinished = false;
    this.delayFrames = 0;
    if (this.movement && this.movement.tiles === 0) {
      this.movement = undefined;
      this.syncSprite(0, 0, 0);
      this.showFacing();
    }
  }

  /** ObjectEventCheckHeldMovementStatus: 1 finished, 0 running, 16 when nothing is held. */
  checkHeldMovementStatus(): number {
    if (this.heldMovementActive) return this.heldMovementFinished ? 1 : 0;
    return 16;
  }

  /** ObjectEventClearHeldMovementIfFinished: returns the status from before. */
  clearHeldMovementIfFinished(): number {
    const status = this.checkHeldMovementStatus();
    if (status !== 0 && status !== 16) this.clearHeldMovementIfActive();
    return status;
  }

  /** ObjectEventGetHeldMovementActionId */
  get heldMovementActionId(): number {
    return this.heldMovementActive ? this.movementActionId : movementActionNone();
  }

  // ------------------------------------------------------------------ movement

  /**
   * Start a grid move outside the held-movement system (movement scripts, trainer approach, doors).
   * A script's movement replaces whatever the object held (ScriptMovement_TakeStep clears it first).
   */
  move(dir: Direction, kind: MoveKind = 'walk', opts: MoveOptions = {}): void {
    this.clearHeldMovementIfActive();
    this.beginMove(dir, kind, opts);
  }

  /**
   * The Step0 of a movement action. Logical position updates immediately (as on the GBA, where the
   * object's currentCoords switch at the start of a step) so collision checks stay simple.
   */
  private beginMove(dir: Direction, kind: MoveKind, opts: MoveOptions): void {
    const spec = MOVES[kind];
    const tiles = opts.inPlace ? 0 : spec.tiles;
    const { dx, dy } = DELTA[dir];
    const locked = this.facingDirectionLocked;
    if (opts.keepFacing) this.facingDirectionLocked = true;
    this.setDirection(dir);
    this.facingDirectionLocked = locked;
    this.movement = { dir, spec, tiles, elapsed: 0, fromX: this.tileX, fromY: this.tileY };
    this.tileX += dx * tiles;
    this.tileY += dy * tiles;
    if (spec.jump) {
      // InitJump: ShiftObjectEventCoords by sJumpInitDisplacements (a tile unless jumping in place),
      // then InitJumpRegular's DoShadowFieldEffect.
      const init = tiles > 0 ? 1 : 0;
      this.shiftCoords(this.currentX + dx * init, this.currentY + dy * init);
      this.triggerGroundEffectsOnMove = true;
      this.disableCoveringGroundEffects = true;
      if (!this.hasShadow) {
        this.hasShadow = true;
        this.field.startShadow?.(this);
      }
    } else if (tiles > 0) {
      // InitNpcForMovement: ShiftObjectEventCoords. Walking in place doesn't shift them or trigger effects.
      this.shiftCoords(this.tileX, this.tileY);
      this.triggerGroundEffectsOnMove = true;
    }
    this.doGroundEffectsAfterMovement();
  }

  /** ShiftObjectEventCoords */
  private shiftCoords(x: number, y: number): void {
    this.previousX = this.currentX;
    this.previousY = this.currentY;
    this.currentX = x;
    this.currentY = y;
  }

  /** DoGroundEffects_OnSpawn: the first part of each object update, for a trigger set at spawn or by a warp. */
  private doGroundEffectsOnSpawn(): void {
    if (!this.triggerGroundEffectsOnMove) return;
    this.updateElevationAndPriority();
    this.field.groundEffects?.(this, 'spawn');
    this.triggerGroundEffectsOnMove = false;
    this.disableCoveringGroundEffects = false;
  }

  /** DoGroundEffects_OnBeginStep + DoGroundEffects_OnFinishStep, after the movement callback. */
  private doGroundEffectsAfterMovement(): void {
    if (this.triggerGroundEffectsOnMove) {
      this.updateElevationAndPriority();
      this.field.groundEffects?.(this, 'beginStep');
      this.triggerGroundEffectsOnMove = false;
      this.disableCoveringGroundEffects = false;
    }
    if (this.triggerGroundEffectsOnStop) {
      this.updateElevationAndPriority();
      this.field.groundEffects?.(this, 'finishStep');
      this.triggerGroundEffectsOnStop = false;
      this.landingJump = false;
    }
  }

  /**
   * UpdateObjectEventElevationAndPriority, run by the GBA's ground-effect hooks: on spawn, when a
   * step begins and when it ends. Skipped entirely while either coord is on elevation 15.
   */
  updateElevationAndPriority(): void {
    const cur = this.field.elevationAt(this.currentX, this.currentY);
    const prev = this.field.elevationAt(this.previousX, this.previousY);
    if (cur !== 15 && prev !== 15) {
      // ObjectEventUpdateElevation
      this.currentElevation = cur;
      if (cur !== 0) this.previousElevation = cur;
    }
    this.priority = ELEVATION_TO_PRIORITY[this.previousElevation];
    this.updateSubpriority();
  }

  /**
   * ObjectEventUpdateSubpriority → SetObjectSubpriorityByElevation(previousElevation, sprite, 1):
   * the screen is cut into 16 px rows (offset by 8) and lower rows get lower subpriorities. The GBA
   * runs this for every object every frame, since the camera moving changes the rows.
   */
  updateSubpriority(): void {
    const y = (this.feetY - this.field.cameraTop + 8) & 0xff;
    this.subpriority = ELEVATION_TO_SUBPRIORITY[this.previousElevation] + ((16 - (y >> 4)) << 1) + 1;
    this.sprite.setDepth(objectDepth(this.priority, this.subpriority, this.topY - this.field.cameraTop));
  }

  setVisible(v: boolean): void {
    this.sprite.setVisible(v);
  }

  /** Advance one 60Hz frame. Returns true on the frame a move completes. */
  tick(): boolean {
    this.doGroundEffectsOnSpawn();
    // TryEnableObjectEventAnim
    if (this.enableAnim) {
      this.disableAnim = false;
      this.enableAnim = false;
    }
    if (this.delayFrames > 0 && --this.delayFrames === 0 && this.heldMovementActive) this.heldMovementFinished = true;
    const m = this.movement;
    if (!m) return false;
    m.elapsed++;
    const t = m.elapsed / m.spec.frames;
    const { dx, dy } = DELTA[m.dir];
    const px = m.spec.steps ? m.spec.steps[m.elapsed - 1] * m.tiles : Math.floor(t * m.tiles * TILE);
    let lift = 0;
    const jump = m.spec.jump;
    if (jump && m.elapsed < m.spec.frames) lift = jump.table[(m.elapsed - 1) >> jump.shift];
    if (jump && m.tiles === 2 && m.elapsed === m.spec.frames >> 1) {
      // UpdateJumpAnim at JUMP_HALFWAY: a ledge jump (sJumpDisplacements[JUMP_DISTANCE_FAR]) shifts another tile.
      this.shiftCoords(this.tileX, this.tileY);
      this.triggerGroundEffectsOnMove = true;
      this.disableCoveringGroundEffects = true;
    }
    const sx = this.tileX - m.fromX === 0 ? 0 : (m.fromX - this.tileX) * TILE + dx * px;
    const sy = this.tileY - m.fromY === 0 ? 0 : (m.fromY - this.tileY) * TILE + dy * px;
    this.syncSprite(sx, sy, lift);
    this.showStepFrame(m);
    let finished = false;
    if (m.elapsed >= m.spec.frames) {
      this.movement = undefined;
      // ShiftStillObjectEventCoords + the trigger for DoGroundEffects_OnFinishStep (walking in place has
      // neither). A jump lands (landingJump) and its action clears hasShadow.
      if (m.tiles > 0 || jump) {
        this.previousX = this.currentX;
        this.previousY = this.currentY;
        this.triggerGroundEffectsOnStop = true;
      }
      if (jump) {
        this.landingJump = true;
        this.hasShadow = false;
      }
      this.stepParity ^= 1;
      this.syncSprite(0, 0, 0);
      this.showFacing();
      if (this.heldMovementActive) this.heldMovementFinished = true;
      finished = true;
    }
    this.doGroundEffectsAfterMovement();
    return finished;
  }

  /** MoveObjectEventToMapCoords: SetObjectEventCoords, then the spawn ground effects run again. */
  setPosition(tileX: number, tileY: number): void {
    this.tileX = tileX;
    this.tileY = tileY;
    this.currentX = tileX;
    this.currentY = tileY;
    this.previousX = tileX;
    this.previousY = tileY;
    this.movement = undefined;
    this.clearHeldMovement();
    this.triggerGroundEffectsOnMove = true;
    this.updateElevationAndPriority();
    this.syncSprite(0, 0, 0);
    this.showFacing();
  }

  destroy(): void {
    this.sprite.destroy();
  }

  private syncSprite(offX: number, offY: number, lift: number): void {
    const x = this.tileX * TILE + TILE / 2 + offX;
    const y = this.tileY * TILE + TILE + offY;
    this.feetY = y;
    this.lift = lift;
    this.topY = y + lift - this.info.frameHeight;
    this.sprite.setPosition(x, y + lift);
    this.anchor.set(x, y);
    this.updateSubpriority();
  }

  private showFacing(): void {
    if (this.info.inanimate) return;
    this.sprite.setFrame(FACE_FRAME[this.facing]);
    this.sprite.setFlipX(this.facing === 'right');
  }

  private showStepFrame(m: Movement): void {
    if (this.info.inanimate) return;
    const dir = this.facing;
    const t = m.elapsed / m.spec.frames;
    let frame: number;
    let flip = dir === 'right';
    if (this.disableAnim) {
      // UpdateObjectEventSpriteAnimPause: the step's anim stays paused on its first (standing) frame
      frame = FACE_FRAME[dir];
    } else if (m.spec.anim === 'spin') {
      [frame, flip] = SPIN_FRAMES[dir][((m.elapsed - 1) >> 1) & 3];
    } else if (m.spec.anim === 'run' && this.hasRunFrames) {
      const [stand, a, b] = RUN_FRAMES[dir];
      frame = t < 0.5 ? (this.stepParity ? b : a) : stand;
    } else if (m.spec.anim === 'none') {
      frame = FACE_FRAME[dir];
    } else {
      const [a, b] = STEP_FRAMES[dir];
      frame = t < 0.5 ? (this.stepParity ? b : a) : FACE_FRAME[dir];
    }
    this.sprite.setFrame(frame);
    this.sprite.setFlipX(flip);
  }
}
