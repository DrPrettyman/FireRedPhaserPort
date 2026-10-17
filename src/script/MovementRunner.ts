import type { ObjectEvent, MoveKind } from '../entities/ObjectEvent';
import { OPPOSITE, type Direction } from '../world/direction';

export type Instruction = string[];

const DIRS = ['down', 'up', 'left', 'right'] as const;

/** Walk speeds per movement-macro prefix (asm/macros/movement.inc). */
const WALKS: [string, MoveKind][] = [
  ['walk_slowest_', 'slowest'],
  ['walk_slower_', 'slower'],
  ['walk_slow_', 'slow'],
  ['walk_faster_', 'faster'],
  ['walk_fast_', 'fast'],
  ['player_run_', 'run'],
  ['slide_', 'fast'],
  ['ride_water_current_', 'fast'],
  ['jump_2_', 'jump'],
  ['jump_special_', 'jump1'],
  ['walk_', 'walk'],
  ['jump_', 'jump1'],
];

const IN_PLACE: [string, MoveKind][] = [
  ['walk_in_place_slow_', 'slow'],
  ['walk_in_place_faster_', 'faster'],
  ['walk_in_place_fast_', 'fast'],
  ['walk_in_place_', 'walk'],
  ['jump_in_place_', 'jump1'],
];

/** MovementAction_Emote*_Step0: the icon field effect each one starts (it runs on its own; the action ends at once). */
const EMOTES: Record<string, string> = {
  emote_exclamation_mark: 'FLDEFF_EXCLAMATION_MARK_ICON',
  emote_question_mark: 'FLDEFF_QUESTION_MARK_ICON',
  emote_x: 'FLDEFF_X_ICON',
  emote_double_exclamation_mark: 'FLDEFF_DOUBLE_EXCL_MARK_ICON',
  emote_smile: 'FLDEFF_SMILEY_FACE_ICON',
};

/** FieldEffectStart for an effect attached to an object; false if that effect isn't ported. */
export type StartFieldEffect = (fldEff: string, obj: ObjectEvent) => boolean;

/**
 * Executes a movement script (applymovement) on one object, one action at a time.
 * Scripted movement ignores collision, as on the GBA.
 */
export class MovementRunner {
  done = false;
  private wait = 0;
  private keepFacing = false;
  /** An action that runs frame by frame (cut_tree, rock_smash_break) until it returns true. */
  private custom?: () => boolean;

  constructor(
    readonly obj: ObjectEvent,
    private code: Instruction[],
    private pc: number,
    private player: ObjectEvent,
    private startFieldEffect: StartFieldEffect,
  ) {}

  tick(): void {
    if (this.done) return;
    if (this.custom) {
      if (!this.custom()) return;
      this.custom = undefined;
    }
    if (this.obj.isMoving) return;
    if (this.wait > 0) {
      this.wait--;
      return;
    }
    for (;;) {
      const ins = this.code[this.pc++];
      if (!ins || ins[0] === 'step_end' || ins[0].startsWith('.')) {
        this.done = true;
        return;
      }
      if (this.exec(ins[0])) return; // action started; resume next tick
    }
  }

  /** Returns true if the action takes time. */
  private exec(op: string): boolean {
    const obj = this.obj;
    const dir = suffixDir(op);

    if (op.startsWith('face_') && dir && !op.includes('player')) {
      obj.face(dir);
      return false;
    }
    if (op.startsWith('delay_')) {
      this.wait = Number(op.slice(6)) - 1;
      return true;
    }
    if (dir) {
      for (const [prefix, kind] of IN_PLACE) {
        if (op.startsWith(prefix)) {
          obj.move(dir, kind, { inPlace: true });
          return true;
        }
      }
      for (const [prefix, kind] of WALKS) {
        if (op.startsWith(prefix)) {
          obj.move(dir, kind, { keepFacing: this.keepFacing });
          return true;
        }
      }
    }
    if (op in EMOTES) {
      if (!this.startFieldEffect(EMOTES[op], obj)) console.debug('[movement] unimplemented', op);
      return false;
    }
    switch (op) {
      case 'face_player':
        obj.face(towards(obj, this.player));
        return false;
      case 'face_original_direction': // MovementAction_FaceOriginalDirection_Step0
        obj.face(obj.originalFacing);
        return false;
      case 'face_away_player':
        obj.face(OPPOSITE[towards(obj, this.player)]);
        return false;
      case 'lock_facing_direction':
        this.keepFacing = true;
        return false;
      case 'unlock_facing_direction':
        this.keepFacing = false;
        return false;
      case 'set_invisible':
        obj.setVisible(false);
        return false;
      case 'set_visible':
        obj.setVisible(true);
        return false;
      case 'cut_tree': // MovementAction_CutTree_Step0..2 (sAnim_TreeCut)
        this.custom = removeObstacle(obj, 6);
        return true;
      case 'rock_smash_break': // MovementAction_RockSmashBreak_Step0..2 (sAnim_RockBreak)
        this.custom = removeObstacle(obj, 8);
        return true;
      case 'nurse_joy_bow': // MovementAction_NurseJoyBowDown_Step0 (ANIM_NURSE_BOW, south), WaitSpriteAnim, PauseSpriteAnim
        obj.face('down');
        this.custom = nurseBow(obj);
        return true;
      case 'reveal_trainer':
        // MovementAction_RevealTrainer only acts on tree/mountain-disguised trainers, which FRLG doesn't use
        return false;
      default:
        // affine anims, bike tricks etc. are not implemented yet
        console.debug('[movement] unimplemented', op);
        return false;
    }
  }
}

/**
 * ANIM_REMOVE_OBSTACLE (frames 0-3, `frameDuration` each, then the anim ends), then SetMovementDelay(32)
 * while the object blinks (invisible ^= TRUE every frame), then it stays invisible.
 */
function removeObstacle(obj: ObjectEvent, frameDuration: number): () => boolean {
  let t = 0;
  const animFrames = 4 * frameDuration;
  return () => {
    if (t < animFrames) {
      obj.sprite.setFrame(Math.floor(t / frameDuration));
    } else if (t <= animFrames + 32) {
      obj.setVisible(t === animFrames + 32 ? false : !obj.sprite.visible);
    }
    t++;
    return t > animFrames + 32;
  };
}

/** sAnim_NurseBow: frame 0 for 8 frames, 9 (the bow) for 32, 0 for 8, END; the action ends once it has. */
function nurseBow(obj: ObjectEvent): () => boolean {
  const frames = [
    [0, 8],
    [9, 32],
    [0, 8],
  ];
  let t = 0;
  return () => {
    let at = t++;
    for (const [frame, duration] of frames) {
      if (at < duration) {
        obj.sprite.setFrame(frame);
        return false;
      }
      at -= duration;
    }
    return true;
  };
}

function suffixDir(op: string): Direction | undefined {
  return DIRS.find((d) => op.endsWith(`_${d}`));
}

/** Direction from `from` towards `to` (GetDirectionToFace-style, preferring the larger axis). */
export function towards(from: ObjectEvent, to: ObjectEvent): Direction {
  const dx = to.tileX - from.tileX;
  const dy = to.tileY - from.tileY;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
