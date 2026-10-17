import Phaser from 'phaser';
import { EMOTICONS_TEXTURE, fieldEffectTextureKey, reflectionTextureKey, type EmoticonData } from '../data/assets';
import type { Behaviors } from '../world/behaviors';
import type { Direction } from '../world/direction';
import { TILE, objectDepth } from '../world/MapChunk';
import { ELEVATION_TO_SUBPRIORITY, type ObjectEvent, type ObjectEventField } from './ObjectEvent';

/** The emote icons' FLDEFF_* ids → sSpriteAnimTable_Emoticons index and the subpriority their
 * FldEff_*Icon function creates the sprite with (trainer_see.c). */
const ICONS: Record<string, { anim: number; subpriority: number }> = {
  FLDEFF_EXCLAMATION_MARK_ICON: { anim: 0, subpriority: 0x53 }, // FldEff_ExclamationMarkIcon1
  FLDEFF_DOUBLE_EXCL_MARK_ICON: { anim: 1, subpriority: 0x52 }, // FldEff_DoubleExclMarkIcon
  FLDEFF_X_ICON: { anim: 2, subpriority: 0x52 }, // FldEff_XIcon
  FLDEFF_SMILEY_FACE_ICON: { anim: 3, subpriority: 0x52 }, // FldEff_SmileyFaceIcon
  FLDEFF_QUESTION_MARK_ICON: { anim: 4, subpriority: 0x52 }, // FldEff_QuestionMarkIcon
};

/** [imageValue, duration, hFlip, vFlip] / ["end"] / ["jump", index] / ["loop", count] (tools/extract_field.py) */
export type AnimCmd = [number, number, number, number] | ['end'] | ['jump', number] | ['loop', number];
/** [xScale, yScale, rotation, duration] / ["jump", index] / ["end"] */
type AffineAnimCmd = [number, number, number, number] | ['jump', number] | ['end'];

/** A gFieldEffectObjectTemplate_* (field_effects/objects.json). */
export interface FieldEffectTemplate {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  anims: AnimCmd[][];
  callback: string;
  paletteTag: string;
}

export interface FieldEffectObjects {
  templates: Record<string, FieldEffectTemplate>;
  /** sAffineAnims_ReflectionDistortion: OAM matrices 0 and 1 that water reflections draw with. */
  reflectionDistortion: AffineAnimCmd[][];
  /** Object events' anim tables by name (sAnimTable_*, object_event_anims.h); SpriteInfo.anims names one. */
  objectEventAnims: Record<string, AnimCmd[][]>;
}

/** What the field effects need from the field. */
export interface FieldEffectsField extends ObjectEventField {
  readonly behaviors: Behaviors;
  /** MapGridGetMetatileBehaviorAt, world coords */
  behaviorAt(x: number, y: number): number;
  /** The active object events (gObjectEvents), for UpdateGrassFieldEffectSubpriority. */
  objects(): readonly ObjectEvent[];
}

// SHADOW_SIZE_S..XL → gShadowEffectTemplateIds / gShadowVerticalOffsets
const SHADOW_TEMPLATES = ['ShadowSmall', 'ShadowMedium', 'ShadowLarge', 'ShadowExtraLarge'];
const SHADOW_VERTICAL_OFFSETS = [4, 4, 4, 16];
/** DIR_* numbers, which index the footprint/tire track anim tables. */
const DIR_NUM: Record<Direction, number> = { down: 1, up: 2, left: 3, right: 4 };
/** DoTracksGroundEffect_BikeTireTracks' bikeTireTracks_Transitions[previous - 1][facing - 1] */
const BIKE_TIRE_TRACKS_TRANSITIONS = [
  [1, 2, 7, 8],
  [1, 2, 6, 5],
  [5, 8, 3, 4],
  [6, 7, 3, 4],
];

/**
 * A sprite's sprite.c animation state (struct Sprite's anim fields) and AnimateSprite for plain (non-affine)
 * anims: field effect sprites, and anything that runs an object event's anim table itself (world/fishing.ts).
 */
export class SpriteAnim {
  // sprite.c animation state
  anims: AnimCmd[][];
  animNum = 0;
  animCmdIndex = 0;
  animDelayCounter = 0;
  animBeginning = true;
  animEnded = false;
  animPaused = false;
  animLoopCounter = 0;
  image = 0;
  /** OAM flip bits (from the anim frame, or set directly). */
  hFlip = false;
  vFlip = false;

  constructor(anims: AnimCmd[][]) {
    this.anims = anims;
  }

  /** StartSpriteAnim */
  startAnim(animNum: number): void {
    this.animNum = animNum;
    this.animBeginning = true;
    this.animEnded = false;
  }

  /** SeekSpriteAnim */
  seekAnim(animCmdIndex: number): void {
    const temp = this.animPaused;
    this.animCmdIndex = animCmdIndex - 1;
    this.animDelayCounter = 0;
    this.animBeginning = false;
    this.animEnded = false;
    this.animPaused = false;
    this.continueAnim();
    if (this.animDelayCounter) this.animDelayCounter++;
    this.animPaused = temp;
  }

  /** AnimateSprite (no affine anims) */
  animate(): void {
    if (this.animBeginning) this.beginAnim();
    else this.continueAnim();
  }

  private cmd(): AnimCmd {
    return this.anims[this.animNum][this.animCmdIndex];
  }

  private applyFrame(cmd: AnimCmd): void {
    const [image, dur, h, v] = cmd as [number, number, number, number];
    let duration = dur & 0x3f;
    if (duration) duration--;
    this.animDelayCounter = duration;
    this.hFlip = !!h;
    this.vFlip = !!v;
    this.image = image;
  }

  private beginAnim(): void {
    this.animCmdIndex = 0;
    this.animEnded = false;
    this.animLoopCounter = 0;
    const cmd = this.cmd();
    if (cmd[0] !== 'end') {
      this.animBeginning = false;
      this.applyFrame(cmd);
    }
  }

  private continueAnim(): void {
    if (this.animDelayCounter) {
      if (!this.animPaused) this.animDelayCounter--;
      const cmd = this.cmd();
      if (typeof cmd[0] === 'number') {
        this.hFlip = !!cmd[2];
        this.vFlip = !!cmd[3];
      }
    } else if (!this.animPaused) {
      this.animCmdIndex++;
      const cmd = this.cmd();
      switch (cmd[0]) {
        case 'loop':
          if (this.animLoopCounter) this.animLoopCounter--;
          else this.animLoopCounter = cmd[1] as number;
          if (this.animLoopCounter) {
            // JumpToTopOfAnimLoop
            this.animCmdIndex--;
            while (this.anims[this.animNum][this.animCmdIndex - 1]?.[0] !== 'loop' && this.animCmdIndex > 0) this.animCmdIndex--;
            this.animCmdIndex--;
          }
          this.continueAnim();
          break;
        case 'jump':
          this.animCmdIndex = cmd[1] as number;
          this.applyFrame(this.cmd());
          break;
        case 'end':
          this.animCmdIndex--;
          this.animEnded = true;
          break;
        default:
          this.applyFrame(cmd);
      }
    }
  }
}

/**
 * A field effect sprite: struct Sprite's fields the field effect code uses, with sprite.c's frame
 * animation (AnimateSprite), drawn as a Phaser sprite. Positions are world pixels of the sprite's
 * centre (coordOffsetEnabled sprites' x/y), x2/y2 an offset on top.
 */
export class FieldEffectSprite extends SpriteAnim {
  readonly sprite: Phaser.GameObjects.Sprite;
  x: number;
  y: number;
  x2 = 0;
  y2 = 0;
  priority = 0;
  subpriority: number;
  invisible = false;
  /** An affine x scale (reflections); the OAM flip bits are SpriteAnim's. */
  scaleX = 1;
  /** The rest of an OAM matrix (world/fly.ts' bird): y scale, rotation (radians, clockwise) and the
   *  ST_OAM_AFFINE_DOUBLE box as a crop of the frame [x, y, width, height]. */
  scaleY = 1;
  rotation = 0;
  crop?: [number, number, number, number];
  data = [0, 0, 0, 0, 0, 0, 0, 0];
  inUse = true;
  /** The object this effect follows, standing in for its localId/mapNum/mapGroup in data. */
  obj?: ObjectEvent;
  readonly width: number;
  readonly height: number;

  constructor(
    scene: Phaser.Scene,
    readonly fldEff: string,
    texture: string,
    template: { frameWidth: number; frameHeight: number; anims: AnimCmd[][] },
    x: number,
    y: number,
    subpriority: number,
    public callback: (s: FieldEffectSprite) => void,
  ) {
    super(template.anims);
    this.x = x;
    this.y = y;
    this.subpriority = subpriority;
    this.width = template.frameWidth;
    this.height = template.frameHeight;
    this.sprite = scene.add.sprite(0, 0, texture, 0).setOrigin(0.5, 0.5).setVisible(false);
  }

  /** The OAM entry: position, frame, flips and depth (SortSprites' priority/subpriority/screen top). */
  render(cameraTop: number): void {
    const s = this.sprite;
    s.setPosition(this.x + this.x2, this.y + this.y2);
    if (s.frame.name !== String(this.image) && typeof this.image === 'number') s.setFrame(this.image);
    s.setFlip(this.hFlip, this.vFlip);
    s.setScale(this.scaleX, this.scaleY);
    s.setRotation(this.rotation);
    if (this.crop) s.setCrop(...this.crop);
    else if (s.isCropped) s.setCrop();
    s.setVisible(!this.invisible);
    s.setDepth(objectDepth(this.priority, this.subpriority, this.y + this.y2 - this.height / 2 - cameraTop));
  }

  destroy(): void {
    this.sprite.destroy();
    this.inUse = false;
  }
}

/** An emote icon over an object (SetIconSpriteData + SpriteCB_TrainerIcons). */
class EmoteIcon {
  readonly sprite: Phaser.GameObjects.Sprite;
  /** sData3 / sData4: the bounce's velocity and offset. */
  private velocity = -5;
  private offset = 0;
  private frame = 0;
  done = false;

  constructor(
    scene: Phaser.Scene,
    readonly fldEff: string,
    private readonly obj: ObjectEvent,
    private readonly anim: [number, number][],
    private readonly subpriority: number,
    private readonly field: ObjectEventField,
  ) {
    this.sprite = scene.add.sprite(0, 0, EMOTICONS_TEXTURE, anim[0][0]);
  }

  private get duration(): number {
    return this.anim.reduce((n, [, d]) => n + d, 0);
  }

  /** SpriteCB_TrainerIcons, then AnimateSprite. Stops once the object is gone or the anim has ended. */
  tick(): void {
    if (!this.obj.sprite.active || this.frame >= this.duration) {
      this.destroy();
      return;
    }
    this.offset += this.velocity;
    if (this.offset) this.velocity++;
    else this.velocity = 0;
    // sprite->x/y = the object's centre, 16 px up; x2/y2 = the object's (jump lift) plus the bounce
    const o = this.obj.sprite;
    const y = o.y - o.height / 2 - 16 + this.offset;
    this.sprite.setPosition(o.x, y);
    let t = this.frame++;
    for (const [image, d] of this.anim) {
      if (t < d) {
        this.sprite.setFrame(image);
        break;
      }
      t -= d;
    }
    // oam.priority 1, its own subpriority; ties sort by screen top like the field's objects
    this.sprite.setDepth(objectDepth(1, this.subpriority, y - 8 - this.field.cameraTop));
  }

  destroy(): void {
    this.sprite.destroy();
    this.done = true;
  }
}

/** sprite.c's affine anim state for one OAM matrix, reduced to its x scale (all reflections need). */
class AffineState {
  xScale = 0;
  private index = 0;
  private delay = 0;

  constructor(private readonly cmds: AffineAnimCmd[]) {
    this.apply(cmds[0] as number[], true); // BeginAffineAnim: the first frame is absolute
  }

  /** ContinueAffineAnim */
  tick(): void {
    if (this.delay) {
      this.delay--;
      this.apply(this.cmds[this.index] as number[], false);
      return;
    }
    this.index++;
    let cmd = this.cmds[this.index];
    if (cmd[0] === 'end') {
      this.index--;
      return;
    }
    if (cmd[0] === 'jump') {
      this.index = cmd[1] as number;
      cmd = this.cmds[this.index];
    }
    this.applyFrame(cmd as number[]);
  }

  /** ApplyAffineAnimFrame: a frame with a duration adds itself now and on each of its remaining frames. */
  private applyFrame(cmd: number[]): void {
    if (cmd[3]) {
      this.delay = cmd[3] - 1;
      this.apply(cmd, false);
    } else {
      this.apply(cmd, true);
    }
  }

  private apply(cmd: number[], absolute: boolean): void {
    this.xScale = absolute ? cmd[0] : this.xScale + cmd[0];
  }
}

/**
 * Field effect sprites that aren't object events (field_effect_helpers.c and the emote icons), and the
 * FieldEffectStart/FieldEffectStop active list scripts wait on.
 */
export class FieldEffects {
  private icons: EmoteIcon[] = [];
  private sprites: FieldEffectSprite[] = [];
  /** sFieldEffectActiveList */
  private active: string[] = [];
  /** CreateReflectionEffectSprites: the two sprites animating OAM matrices 0 and 1. */
  private distortion: AffineState[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly emoticons: EmoticonData,
    private readonly objects: FieldEffectObjects,
    private readonly field: FieldEffectsField,
  ) {
    this.resetDistortion();
  }

  /** FieldEffectStart for an emote icon over `obj`. Returns false for field effects that aren't ported. */
  start(fldEff: string, obj: ObjectEvent): boolean {
    const icon = ICONS[fldEff];
    if (!icon) return false;
    this.active.push(fldEff);
    // Created at the end of the sprite list, so its callback first runs this same frame (in `tick`).
    this.icons.push(new EmoteIcon(this.scene, fldEff, obj, this.emoticons.anims[icon.anim], icon.subpriority, this.field));
    return true;
  }

  /** Dev: the live field effect sprites' FLDEFF_* names ('reflection' for reflections), or only those following `obj`. */
  liveEffects(obj?: ObjectEvent): string[] {
    if (obj) return this.sprites.filter((s) => s.inUse && s.obj === obj).map((s) => s.fldEff);
    return [...this.icons.filter((e) => !e.done), ...this.sprites.filter((s) => s.inUse)].map((e) => e.fldEff);
  }

  /** FieldEffectActiveListContains */
  isActive(fldEff: string): boolean {
    return this.active.includes(fldEff) || this.icons.some((e) => e.fldEff === fldEff && !e.done);
  }

  /** AnimateSprites for the field effect sprites, then their OAM entries. */
  tick(): void {
    for (const d of this.distortion) d.tick();
    for (const e of this.icons) e.tick();
    this.icons = this.icons.filter((e) => {
      if (e.done) this.removeActive(e.fldEff);
      return !e.done;
    });
    for (const s of [...this.sprites]) {
      if (!s.inUse) continue;
      s.callback(s);
      if (s.inUse) s.animate();
    }
    this.sprites = this.sprites.filter((s) => s.inUse);
    for (const s of this.sprites) s.render(this.field.cameraTop);
  }

  /** Warps destroy every field effect sprite along with the map's objects (and recreate the distortion sprites). */
  clear(): void {
    for (const e of this.icons) e.destroy();
    for (const s of this.sprites) s.destroy();
    this.icons = [];
    this.sprites = [];
    this.active = [];
    this.resetDistortion();
  }

  private resetDistortion(): void {
    this.distortion = this.objects.reflectionDistortion.map((cmds) => new AffineState(cmds));
  }

  private removeActive(fldEff: string): void {
    const i = this.active.indexOf(fldEff);
    if (i >= 0) this.active.splice(i, 1);
  }

  /** CreateSpriteAtEnd with a field effect object template, as part of FieldEffectStart(fldEff). */
  private create(fldEff: string, template: string, x: number, y: number, subpriority: number, callback?: (s: FieldEffectSprite) => void): FieldEffectSprite {
    const t = this.objects.templates[template];
    const s = new FieldEffectSprite(this.scene, fldEff, fieldEffectTextureKey(template), t, x, y, subpriority, callback ?? this.callbackFor(t.callback));
    this.sprites.push(s);
    return s;
  }

  /** CreateSpriteAtEnd for a field effect ported in its own module (world/surf.ts's surf blob). */
  createSprite(fldEff: string, template: string, x: number, y: number, subpriority: number, callback: (s: FieldEffectSprite) => void): FieldEffectSprite {
    return this.create(fldEff, template, x, y, subpriority, callback);
  }

  /** FieldEffectStart: the effect is on the active list until its sprite stops it. */
  private begin(fldEff: string): void {
    this.active.push(fldEff);
  }

  /** FieldEffectStop */
  private stop(s: FieldEffectSprite, fldEff = s.fldEff): void {
    s.destroy();
    this.removeActive(fldEff);
  }

  private callbackFor(name: string): (s: FieldEffectSprite) => void {
    switch (name) {
      case 'UpdateShadowFieldEffect':
        return (s) => this.updateShadow(s);
      case 'UpdateTallGrassFieldEffect':
        return (s) => this.updateTallGrass(s);
      case 'UpdateJumpImpactEffect':
        return (s) => this.updateJumpImpact(s);
      case 'WaitFieldEffectSpriteAnim':
        return (s) => this.waitSpriteAnim(s);
      case 'UpdateSplashFieldEffect':
        return (s) => this.updateSplash(s);
      case 'UpdateFootprintsTireTracksFieldEffect':
        return (s) => this.updateFootprintsTireTracks(s);
      case 'UpdateHotSpringsWaterFieldEffect':
        return (s) => this.updateHotSpringsWater(s);
      default:
        return () => {}; // SpriteCallbackDummy
    }
  }

  // ------------------------------------------------------------------ field_effect_helpers.c

  /** SetUpReflection: a copy of the object's sprite, flipped, at OAM priority 3 with its reflection palette. */
  setUpReflection(obj: ObjectEvent, stillReflection: boolean): void {
    const info = obj.info;
    const texture = info.reflection ? reflectionTextureKey(info) : obj.sprite.texture.key;
    const s = new FieldEffectSprite(
      this.scene,
      'reflection',
      texture,
      { frameWidth: info.frameWidth, frameHeight: info.frameHeight, anims: [[['end']]] },
      obj.spriteX,
      obj.spriteY,
      0x98, // CreateCopySpriteAt(sprite, x, y, 0x98)
      (r) => this.updateObjectReflection(r, stillReflection),
    );
    s.obj = obj;
    s.priority = 3;
    s.animBeginning = false; // gDummySpriteAnimTable: the frame comes from the object
    s.animPaused = true;
    s.data[2] = 0; // LoadObjectReflectionPalette: FRLG has no bridges (MetatileBehavior_GetBridgeType is FALSE)
    this.sprites.push(s);
  }

  /** UpdateObjectReflectionSprite */
  private updateObjectReflection(r: FieldEffectSprite, still: boolean): void {
    const obj = r.obj!;
    if (!obj.sprite.active || !obj.hasReflection) {
      r.destroy();
      return;
    }
    const main = obj.sprite;
    r.image = Number(main.frame.name);
    r.invisible = !main.visible;
    r.x = obj.spriteX;
    // reflectionSprite->y = mainSprite->y + GetReflectionVerticalOffset (height - 2) + data[2]
    r.y = obj.spriteY + obj.info.frameHeight - 2 + r.data[2];
    r.y2 = -obj.lift;
    // A still (ice) reflection is the sprite with ST_OAM_VFLIP added; a water one uses OAM matrix 0, or 1
    // when the object is flipped (facing east): a vertical flip whose x scale the distortion sprites wobble.
    r.hFlip = main.flipX;
    r.vFlip = true;
    r.scaleX = still ? 1 : Math.abs(this.distortion[main.flipX ? 1 : 0]?.xScale ?? 256) / 256;
  }

  /** DoShadowFieldEffect → FldEff_Shadow */
  shadow(obj: ObjectEvent, shadowSize: number): void {
    this.begin('FLDEFF_SHADOW');
    const s = this.create('FLDEFF_SHADOW', SHADOW_TEMPLATES[shadowSize], 0, 0, 0x94);
    s.obj = obj;
    s.data[3] = (obj.info.frameHeight >> 1) - SHADOW_VERTICAL_OFFSETS[shadowSize];
    // First positioned by its callback, which runs this frame.
  }

  /** UpdateShadowFieldEffect */
  private updateShadow(s: FieldEffectSprite): void {
    const obj = s.obj!;
    if (!obj.sprite.active) {
      this.stop(s);
      return;
    }
    const b = this.field.behaviors;
    s.priority = obj.priority;
    s.x = obj.spriteX;
    s.y = obj.spriteY + s.data[3];
    if (
      !obj.hasShadow ||
      b.isPokeGrass(obj.currentMetatileBehavior) ||
      b.isSurfable(obj.currentMetatileBehavior) ||
      b.isSurfable(obj.previousMetatileBehavior) ||
      b.isReflective(obj.currentMetatileBehavior) ||
      b.isReflective(obj.previousMetatileBehavior)
    ) {
      this.stop(s);
    }
  }

  /** FldEff_TallGrass. `spawn` (gFieldEffectArguments[7]) starts the anim at its last frame. */
  tallGrass(x: number, y: number, elevation: number, priority: number, obj: ObjectEvent, spawn: boolean): void {
    this.begin('FLDEFF_TALL_GRASS');
    const s = this.create('FLDEFF_TALL_GRASS', 'TallGrass', x * TILE + 8, y * TILE + 8, 0);
    s.priority = priority;
    s.data[0] = elevation;
    s.data[1] = x;
    s.data[2] = y;
    s.obj = obj;
    if (spawn) s.seekAnim(4);
  }

  /** UpdateTallGrassFieldEffect (world coords don't need the gCamera map-change fixup). */
  private updateTallGrass(s: FieldEffectSprite): void {
    const obj = s.obj!;
    const behavior = this.field.behaviorAt(s.data[1], s.data[2]);
    if (!obj.sprite.active || !this.field.behaviors.isTallGrass(behavior) || (s.data[7] && s.animEnded)) {
      this.stop(s);
      return;
    }
    const { current, previous } = obj;
    if ((current.x !== s.data[1] || current.y !== s.data[2]) && (previous.x !== s.data[1] || previous.y !== s.data[2])) s.data[7] = 1;
    s.invisible = false; // UpdateObjectEventSpriteInvisibility(sprite, FALSE)
    this.updateGrassSubpriority(s, s.data[0], s.animCmdIndex === 0 ? 4 : 0);
  }

  /** FieldEffectStart(FLDEFF_JUMP_TALL_GRASS) */
  jumpTallGrass(x: number, y: number, elevation: number, priority: number): void {
    this.jumpImpact('FLDEFF_JUMP_TALL_GRASS', 'JumpTallGrass', x * TILE + 8, y * TILE + 12, elevation, priority);
  }

  /** FindTallGrassFieldEffectSpriteId */
  hasTallGrass(obj: ObjectEvent, x: number, y: number): boolean {
    return this.sprites.some((s) => s.inUse && s.fldEff === 'FLDEFF_TALL_GRASS' && s.obj === obj && s.data[1] === x && s.data[2] === y);
  }

  /** FldEff_Dust */
  dust(x: number, y: number, elevation: number, priority: number): void {
    this.jumpImpact('FLDEFF_DUST', 'GroundImpactDust', x * TILE + 8, y * TILE + 12, elevation, priority);
  }

  /** FldEff_JumpSmallSplash */
  jumpSmallSplash(x: number, y: number, elevation: number, priority: number): void {
    this.jumpImpact('FLDEFF_JUMP_SMALL_SPLASH', 'JumpSmallSplash', x * TILE + 8, y * TILE + 12, elevation, priority);
  }

  /** FldEff_JumpBigSplash */
  jumpBigSplash(x: number, y: number, elevation: number, priority: number): void {
    this.jumpImpact('FLDEFF_JUMP_BIG_SPLASH', 'JumpBigSplash', x * TILE + 8, y * TILE + 8, elevation, priority);
  }

  private jumpImpact(fldEff: string, template: string, x: number, y: number, elevation: number, priority: number): void {
    this.begin(fldEff);
    const s = this.create(fldEff, template, x, y, 0);
    s.priority = priority;
    s.data[0] = elevation;
  }

  /** UpdateJumpImpactEffect */
  private updateJumpImpact(s: FieldEffectSprite): void {
    if (s.animEnded) {
      this.stop(s);
    } else {
      s.invisible = false;
      this.setSubpriorityByElevation(s, s.data[0], 0);
    }
  }

  /** WaitFieldEffectSpriteAnim */
  private waitSpriteAnim(s: FieldEffectSprite): void {
    if (s.animEnded) this.stop(s);
    else s.invisible = false;
  }

  /** DoRippleFieldEffect → FldEff_Ripple */
  ripple(obj: ObjectEvent): void {
    this.begin('FLDEFF_RIPPLE');
    const s = this.create('FLDEFF_RIPPLE', 'Ripple', obj.spriteX, obj.spriteY + (obj.info.frameHeight >> 1) - 2, 151);
    s.priority = 3;
  }

  /** FldEff_Splash (stepping in a puddle). PlaySE(SE_PUDDLE) is silent: no audio yet. */
  splash(obj: ObjectEvent): void {
    this.begin('FLDEFF_SPLASH');
    const s = this.create('FLDEFF_SPLASH', 'Splash', 0, 0, 0);
    s.obj = obj;
    s.priority = obj.priority;
    s.y2 = (obj.info.frameHeight >> 1) - 4;
  }

  /** UpdateSplashFieldEffect */
  private updateSplash(s: FieldEffectSprite): void {
    const obj = s.obj!;
    if (s.animEnded || !obj.sprite.active) {
      this.stop(s);
      return;
    }
    s.x = obj.spriteX;
    s.y = obj.spriteY;
    s.invisible = false;
  }

  /** FldEff_FeetInFlowingWater: the splash sprite, anim 1, following the object while it wades. */
  feetInFlowingWater(obj: ObjectEvent): void {
    this.begin('FLDEFF_FEET_IN_FLOWING_WATER');
    const s = this.create('FLDEFF_FEET_IN_FLOWING_WATER', 'Splash', 0, 0, 0, (sp) => this.updateFeetInFlowingWater(sp));
    s.obj = obj;
    s.priority = obj.priority;
    s.data[3] = -1;
    s.data[4] = -1;
    s.y2 = (obj.info.frameHeight >> 1) - 4;
    s.startAnim(1);
  }

  /** UpdateFeetInFlowingWaterFieldEffect (its PlaySE(SE_PUDDLE) on each new tile is silent) */
  private updateFeetInFlowingWater(s: FieldEffectSprite): void {
    const obj = s.obj!;
    if (!obj.sprite.active || !obj.inShallowFlowingWater) {
      this.stop(s);
      return;
    }
    s.x = obj.spriteX;
    s.y = obj.spriteY;
    s.subpriority = obj.subpriority;
    s.invisible = false;
    const { current } = obj;
    if (current.x !== s.data[3] || current.y !== s.data[4]) {
      s.data[3] = current.x;
      s.data[4] = current.y;
    }
  }

  /** FldEff_SandFootprints / FldEff_DeepSandFootprints */
  footprints(x: number, y: number, subpriority: number, priority: number, facing: Direction, deep: boolean): void {
    const fldEff = deep ? 'FLDEFF_DEEP_SAND_FOOTPRINTS' : 'FLDEFF_SAND_FOOTPRINTS';
    this.begin(fldEff);
    const s = this.create(fldEff, deep ? 'DeepSandFootprints' : 'SandFootprints', x * TILE + 8, y * TILE + 8, subpriority);
    s.priority = priority;
    s.startAnim(DIR_NUM[facing]);
  }

  /** FldEff_BikeTireTracks, with the track shape picked by DoTracksGroundEffect_BikeTireTracks. */
  bikeTireTracks(x: number, y: number, subpriority: number, priority: number, previous: Direction, facing: Direction): void {
    this.begin('FLDEFF_BIKE_TIRE_TRACKS');
    const s = this.create('FLDEFF_BIKE_TIRE_TRACKS', 'BikeTireTracks', x * TILE + 8, y * TILE + 8, subpriority);
    s.priority = priority;
    s.startAnim(BIKE_TIRE_TRACKS_TRANSITIONS[DIR_NUM[previous] - 1][DIR_NUM[facing] - 1]);
  }

  /** UpdateFootprintsTireTracksFieldEffect: 40 frames shown, then flickering until frame 56. */
  private updateFootprintsTireTracks(s: FieldEffectSprite): void {
    if (s.data[0] === 0) {
      if (++s.data[1] > 40) s.data[0] = 1;
      s.invisible = false;
    } else {
      s.invisible = !s.invisible;
      s.data[1]++;
      if (s.data[1] > 56) this.stop(s);
    }
  }

  /** FldEff_HotSpringsWater */
  hotSpringsWater(obj: ObjectEvent): void {
    this.begin('FLDEFF_HOT_SPRINGS_WATER');
    const s = this.create('FLDEFF_HOT_SPRINGS_WATER', 'HotSpringsWater', 0, 0, 0);
    s.obj = obj;
    s.priority = obj.priority;
    s.data[3] = obj.spriteX;
    s.data[4] = obj.spriteY;
  }

  /** UpdateHotSpringsWaterFieldEffect */
  private updateHotSpringsWater(s: FieldEffectSprite): void {
    const obj = s.obj!;
    if (!obj.sprite.active || !obj.inHotSprings) {
      this.stop(s);
      return;
    }
    s.x = obj.spriteX;
    s.y = (obj.info.frameHeight >> 1) + obj.spriteY - 8;
    s.subpriority = obj.subpriority - 1;
    s.invisible = false;
  }

  /** SetObjectSubpriorityByElevation: the 16 px screen row of the sprite's bottom edge, as for objects. */
  private setSubpriorityByElevation(s: FieldEffectSprite, elevation: number, offset: number): void {
    const y = (s.y + s.height / 2 - this.field.cameraTop + 8) & 0xff;
    s.subpriority = ELEVATION_TO_SUBPRIORITY[elevation] + ((16 - (y >> 4)) << 1) + offset;
  }

  /** UpdateGrassFieldEffectSubpriority: grass goes behind an object standing over its upper part. */
  private updateGrassSubpriority(s: FieldEffectSprite, elevation: number, offset: number): void {
    this.setSubpriorityByElevation(s, elevation, offset);
    for (const obj of this.field.objects()) {
      if (!obj.sprite.active) continue;
      const left = s.x - s.width / 2;
      const right = s.x + s.width / 2;
      if (left < obj.spriteX && right > obj.spriteX) {
        const objTop = obj.spriteY - obj.info.frameHeight / 2;
        const bottom = s.y + s.height / 2;
        const yhi = bottom - obj.info.frameHeight / 2;
        if ((objTop < yhi || objTop < bottom) && obj.spriteY > yhi && s.subpriority <= obj.subpriority) {
          s.subpriority = obj.subpriority + 2;
          break;
        }
      }
    }
  }
}

