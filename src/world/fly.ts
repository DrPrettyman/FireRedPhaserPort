// Fly: SetUpFieldMove_Fly (party_menu.c), the fly map's warp destination (overworld.c's SetWarpDestination*),
// and field_effect.c's ReturnToFieldFromFlyMapSelect → FieldCallback_UseFly / Task_UseFly → FLDEFF_FLY_OUT
// (FldEff_FlyOut: the pose, the banner, the bird leaving its ball, swooping down and flying off with the player),
// then the warp and FieldCallback_FlyIntoMap / Task_FlyIntoMap → FLDEFF_FLY_IN (FldEff_FlyIn: the bird flying
// in with the player, who jumps off). The fly map itself is menus/regionMap.ts.
//
// The bird (gFieldEffectObjectTemplate_Bird) is a field effect sprite in screen coordinates
// (coordOffsetEnabled stays FALSE), with its affine anims run here: `BirdSprite` keeps the C's sprite fields
// and the OAM matrix, and draws through FieldEffectSprite's scale / rotation / crop (the double-size box).

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { Cos, Sin } from '../battle/trig';
import { testEvent } from '../dev/testHooks';
import type { FieldEffectSprite } from '../entities/FieldEffects';
import { directionalAction } from '../entities/movementActions';
import { PlaySE } from '../gba/sound';
import { ObjAffineSet } from '../gba/sprite';
import { SetMainCallback2 } from '../gba/main';
import { CB2_ReturnToField, gFieldCallback, type FieldCallbackHost } from '../menus/fieldCallbacks';
import { GetCursorSelectionMonId, registerFieldMoveSetUp } from '../menus/partyMenu';
import { FieldEffectActiveListContains, FieldEffectActiveListRemove, FieldEffectStart, gFieldEffectArguments, registerFieldEffectNatives } from './fieldEffectScripts';
import {
  CreateTask,
  fieldMoveHost as flyHost,
  LoadFieldMoveShowMonGfx,
  LockPlayerFieldControls,
  Overworld_MapTypeAllowsTeleportAndFly,
  Overworld_ResetStateAfterFly,
  StartPlayerAvatarSummonMonForFieldMoveAnim,
  UnlockPlayerFieldControls,
} from './fieldMoves';
import { avatarField, GetPlayerAvatarGraphicsIdByStateId, gPlayerAvatar, PLAYER_AVATAR_FLAG, playerObj, SetPlayerAvatarStateMask, SetPlayerAvatarTransitionFlags } from './playerAvatar';
import { BOB_MON_ONLY, BOB_NONE, BOB_PLAYER_AND_MON, SetPlayerSurfBlobBobState } from './surf';

// ------------------------------------------------------------------ party menu, fly map

/** SetUpFieldMove_Fly: only where Teleport works too (CursorCB_FieldMove then opens the fly map). */
export function SetUpFieldMove_Fly(): boolean {
  return Overworld_MapTypeAllowsTeleportAndFly(flyHost().mapType());
}

/** sWarpDestination as the fly map sets it (x, y -1: the map's centre) */
let sWarpDestination: { map: string; warpId: number; x: number; y: number } | undefined;

/** SetWarpDestinationToHealLocation */
export function SetWarpDestinationToHealLocation(healLocationId: number): void {
  const warp = flyHost().healLocation(healLocationId);
  if (warp) sWarpDestination = { map: warp.map, warpId: -1, x: warp.x, y: warp.y };
}

/** SetWarpDestinationToMapWarp */
export function SetWarpDestinationToMapWarp(map: string, warpId: number): void {
  sWarpDestination = { map, warpId, x: -1, y: -1 };
}

/** ReturnToFieldFromFlyMapSelect */
export function ReturnToFieldFromFlyMapSelect(): void {
  SetMainCallback2(CB2_ReturnToField);
  gFieldCallback.fn = FieldCallback_UseFly;
}

/** The destination the fly map chose (for tests). */
export function flyWarpDestination(): { map: string; x: number; y: number } | undefined {
  return sWarpDestination && { map: sWarpDestination.map, x: sWarpDestination.x, y: sWarpDestination.y };
}

// ------------------------------------------------------------------ field_effect.c: using Fly

/** FieldCallback_UseFly: fade in, then Task_UseFly (the controls stay locked until the fly in ends). */
function FieldCallback_UseFly(f: FieldCallbackHost): () => boolean {
  const faded = f.fadeInFromBlack();
  let started = false;
  CreateTask(() => {
    // Task_UseFly
    if (!started) {
      if (!faded()) return false; // IsWeatherNotFadingIn
      gFieldEffectArguments[0] = GetCursorSelectionMonId();
      if (gFieldEffectArguments[0] >= K.PARTY_SIZE) gFieldEffectArguments[0] = 0;
      FieldEffectStart('FLDEFF_FLY_OUT');
      started = true;
    }
    if (!FieldEffectActiveListContains('FLDEFF_FLY_OUT')) {
      Overworld_ResetStateAfterFly();
      warpToDestination();
      return true;
    }
    return false;
  });
  LockPlayerFieldControls();
  avatarField().freezeObjectEvents();
  gFieldCallback.fn = undefined;
  return () => true;
}

/** WarpIntoMap + SetMainCallback2(CB2_LoadMap) with gFieldCallback = FieldCallback_FlyIntoMap. */
function warpToDestination(): void {
  const dest = sWarpDestination ?? { map: flyHost().mapId(), warpId: -1, ...flyHost().playerLocal() };
  testEvent('flyWarp', { map: dest.map, x: dest.x, y: dest.y });
  if (dest.x >= 0 && dest.y >= 0) {
    flyHost().warpIntoMap(dest.map, dest.x, dest.y, FieldCallback_FlyIntoMap);
    return;
  }
  // SetPlayerCoordsFromWarp: no warp id or position, so the middle of the map
  void flyHost().loadMapHeader(dest.map).then((h) => flyHost().warpIntoMap(dest.map, Math.trunc((h?.width ?? 0) / 2), Math.trunc((h?.height ?? 0) / 2), FieldCallback_FlyIntoMap));
}

/** FieldCallback_FlyIntoMap → Task_FlyIntoMap */
function FieldCallback_FlyIntoMap(): void {
  // Overworld_PlaySpecialMapMusic: no audio; FadeInFromBlack (an outdoor arrival: WarpFadeInScreen fades from black)
  const fadeIn = flyHost().warpFadeInScreen();
  const player = playerObj();
  player.setVisible(false);
  if (gPlayerAvatar.flags & PLAYER_AVATAR_FLAG.SURFING) player.face('left');
  LockPlayerFieldControls();
  avatarField().freezeObjectEvents();
  let started = false;
  CreateTask(() => {
    if (!started) {
      if (!fadeIn()) return false;
      FieldEffectStart('FLDEFF_FLY_IN');
      started = true;
    }
    if (!FieldEffectActiveListContains('FLDEFF_FLY_IN')) {
      UnlockPlayerFieldControls();
      avatarField().unfreezeObjectEvents();
      testEvent('flyDone');
      return true;
    }
    return false;
  });
}

// ------------------------------------------------------------------ the bird

const MAX_SPRITES = 64;

/** sAffineAnims_FlyBirdBall: [xScale, yScale, rotation, duration] / ['jump', i] / ['end'] */
type AffineCmd = [number, number, number, number] | ['jump', number] | ['end'];
const sAffineAnim_FlyBirdLeaveBall: AffineCmd[] = [[8, 8, -30, 0], [28, 28, 0, 30], ['end']];
const sAffineAnim_FlyBirdReturnToBall: AffineCmd[] = [[256, 256, 64, 0], [-10, -10, 0, 22], ['end']];
const sAffineAnims_FlyBirdBall = [sAffineAnim_FlyBirdLeaveBall, sAffineAnim_FlyBirdReturnToBall];
/** sAffineAnims_FlyBirdWithPlayer */
const sAffineAnim_FlyBirdOutOfMap: AffineCmd[] = [[24, 24, 0, 1], ['jump', 0]];
const sAffineAnim_FlyBirdIntoMap: AffineCmd[] = [[512, 512, 0, 1], [-16, -16, 0, 1], ['jump', 1]];
const sAffineAnims_FlyBirdWithPlayer = [sAffineAnim_FlyBirdOutOfMap, sAffineAnim_FlyBirdIntoMap];

const s16 = (v: number): number => (v << 16) >> 16;

/** ConvertScaleParam (sprite.c) */
function ConvertScaleParam(scale: number): number {
  return scale === 0 ? 0 : s16(Math.trunc(0x10000 / scale));
}

/**
 * The bird's struct Sprite: screen position (x, y, x2, y2), data[], its OAM matrix and sprite.c's affine anim
 * state (BeginAffineAnim / ContinueAffineAnim / ApplyAffineAnimFrame) for ST_OAM_AFFINE_DOUBLE.
 */
class BirdSprite {
  x = 0;
  y = 0;
  x2 = 0;
  y2 = 0;
  readonly data = new Int16Array(8);
  affineOn = false;
  matrix = { a: 0x100, b: 0, c: 0, d: 0x100 };
  callback: (b: BirdSprite) => void = () => {};
  private affineAnims: AffineCmd[][] = [];
  private animNum = 0;
  private cmdIndex = 0;
  private delay = 0;
  private beginning = false;
  private xScale = 0x100;
  private yScale = 0x100;
  private rotation = 0;
  /** Set by a callback that destroys the sprite (DestroySprite). */
  destroyed = false;

  constructor(readonly fes: FieldEffectSprite) {}

  /** oam.affineMode = ST_OAM_AFFINE_DOUBLE; affineAnims = ...; InitSpriteAffineAnim; StartSpriteAffineAnim */
  startAffine(anims: AffineCmd[][], animNum: number): void {
    this.affineOn = true;
    this.affineAnims = anims;
    this.animNum = animNum;
    this.xScale = 0x100; // AffineAnimStateReset
    this.yScale = 0x100;
    this.rotation = 0;
    this.cmdIndex = 0;
    this.delay = 0;
    this.beginning = true;
  }

  /** oam.affineMode = ST_OAM_AFFINE_OFF; FreeOamMatrix */
  affineOff(): void {
    this.affineOn = false;
    this.matrix = { a: 0x100, b: 0, c: 0, d: 0x100 };
  }

  /** The affine half of AnimateSprite, after the callback. */
  animateAffine(): void {
    if (!this.affineOn) return;
    const cmds = this.affineAnims[this.animNum];
    if (this.beginning) {
      // BeginAffineAnim
      this.cmdIndex = 0;
      this.delay = 0;
      this.beginning = false;
      this.applyFrame(cmds[this.cmdIndex]);
      return;
    }
    // ContinueAffineAnim
    if (this.delay) {
      this.delay--;
      this.applyRelative(cmds[this.cmdIndex] as number[]);
      return;
    }
    this.cmdIndex++;
    const cmd = cmds[this.cmdIndex];
    if (cmd[0] === 'end') {
      this.cmdIndex--;
      this.applyRelative([0, 0, 0]);
    } else if (cmd[0] === 'jump') {
      this.cmdIndex = cmd[1];
      this.applyFrame(cmds[this.cmdIndex]);
    } else {
      this.applyFrame(cmd);
    }
  }

  /** ApplyAffineAnimFrame: a frame with a duration is relative (and holds for duration - 1 more frames). */
  private applyFrame(cmd: AffineCmd): void {
    const [xs, ys, rot, duration] = cmd as number[];
    if (duration) {
      this.delay = duration - 1;
      this.applyRelative([xs, ys, rot]);
    } else {
      this.delay = 0;
      this.xScale = xs;
      this.yScale = ys;
      this.rotation = (rot << 8) & 0xffff;
      this.applyRelative([0, 0, 0]);
    }
  }

  /** ApplyAffineAnimFrameRelativeAndUpdateMatrix */
  private applyRelative([xs, ys, rot]: number[]): void {
    this.xScale = s16(this.xScale + xs);
    this.yScale = s16(this.yScale + ys);
    this.rotation = (this.rotation + (rot << 8)) & ~0xff & 0xffff;
    this.matrix = ObjAffineSet(ConvertScaleParam(this.xScale), ConvertScaleParam(this.yScale), this.rotation);
  }

  /** The OAM entry: the field effect sprite in world pixels, scaled and rotated by the matrix, clipped to the double-size box. */
  render(): void {
    const s = this.fes;
    const cam = flyHost().camera();
    s.x = cam.x + this.x;
    s.y = cam.y + this.y;
    s.x2 = this.x2;
    s.y2 = this.y2;
    if (!this.affineOn) {
      s.scaleX = 1;
      s.scaleY = 1;
      s.rotation = 0;
      s.crop = undefined;
      return;
    }
    // The matrix maps screen to texture: its inverse is a scale (256 / a, with no shear here) and a rotation.
    const scale = Math.hypot(this.matrix.a, this.matrix.c) / 256;
    const display = scale === 0 ? 0 : 1 / scale;
    s.scaleX = display;
    s.scaleY = display;
    s.rotation = -Math.atan2(this.matrix.c, this.matrix.a);
    // ST_OAM_AFFINE_DOUBLE draws into a 128x128 box around the centre: crop what falls outside it.
    const visible = display > 0 ? 128 / display : 64;
    s.crop = visible < 64 ? [32 - visible / 2, 32 - visible / 2, visible, visible] : undefined;
  }
}

// Sprite data for the bird sprite
const sInitData = 0;
const sPlayerSpriteId = 6;
const sAnimCompleted = 7;

/** The player's sprite while the bird carries it (sPlayerSpriteId): screen centre, coordOffsetEnabled FALSE. */
function setPlayerSpriteScreenPos(x: number, y: number): void {
  const player = playerObj();
  const cam = flyHost().camera();
  player.sprite.setPosition(cam.x + x, cam.y + y + player.info.frameHeight / 2);
}

/** The player sprite's screen centre (sprite->x, y without x2/y2). */
function playerSpriteScreenPos(): { x: number; y: number } {
  const player = playerObj();
  const cam = flyHost().camera();
  return { x: player.sprite.x - cam.x, y: player.sprite.y - player.info.frameHeight / 2 - cam.y };
}

/** CreateFlyBirdSprite: at (255, 180) on screen, oam.priority 1, the player's palette (oam.paletteNum 0). */
function CreateFlyBirdSprite(fldEff: string): BirdSprite {
  let bird: BirdSprite | undefined;
  const fes = flyHost().createFieldEffectSprite(fldEff, 'Bird', 0, 0, 1, () => {
    if (!bird || bird.destroyed) return;
    bird.callback(bird);
    bird.animateAffine();
    bird.render();
  });
  bird = new BirdSprite(fes);
  bird.x = 255;
  bird.y = 180;
  fes.priority = 1;
  bird.callback = SpriteCB_FlyBirdLeaveBall;
  bird.render();
  return bird;
}

function GetFlyBirdAnimCompleted(bird: BirdSprite): boolean {
  return bird.data[sAnimCompleted] !== 0;
}

/** StartFlyBirdSwoopDown */
function StartFlyBirdSwoopDown(bird: BirdSprite): void {
  bird.callback = SpriteCB_FlyBirdSwoopDown;
  bird.x = 120;
  bird.y = 0;
  bird.x2 = 0;
  bird.y2 = 0;
  bird.data.fill(0);
  bird.data[sPlayerSpriteId] = MAX_SPRITES;
}

/** SetFlyBirdPlayerSpriteId (the player's sprite or MAX_SPRITES) */
function SetFlyBirdPlayerSpriteId(bird: BirdSprite, attached: boolean): void {
  bird.data[sPlayerSpriteId] = attached ? 0 : MAX_SPRITES;
}

const isMale = (): boolean => state.playerGender !== 'female';
const genderNum = (): number => (isMale() ? K.MALE : K.FEMALE);

/** SpriteCB_FlyBirdLeaveBall: out of the ball in a spiral, growing. */
function SpriteCB_FlyBirdLeaveBall(sprite: BirdSprite): void {
  if (sprite.data[sAnimCompleted] === 0) {
    if (sprite.data[sInitData] === 0) {
      sprite.startAffine(sAffineAnims_FlyBirdBall, 0);
      sprite.x = isMale() ? 128 : 118;
      sprite.y = -48;
      sprite.data[sInitData]++;
      sprite.data[1] = 64;
      sprite.data[2] = 256;
    }
    sprite.data[1] += sprite.data[2] >> 8;
    sprite.x2 = Cos(sprite.data[1], 120);
    sprite.y2 = Sin(sprite.data[1], 120);
    if (sprite.data[2] < 2048) sprite.data[2] += 96;
    if (sprite.data[1] > 129) {
      sprite.data[sAnimCompleted]++;
      sprite.affineOff(); // ST_OAM_AFFINE_OFF, FreeOamMatrix, CalcCenterToCornerVec
    }
  }
}

/** The bird carrying the player sets the player sprite's position (sPlayerSpriteId). */
function carryPlayer(sprite: BirdSprite): void {
  if (sprite.data[sPlayerSpriteId] !== MAX_SPRITES) setPlayerSpriteScreenPos(sprite.x + sprite.x2, sprite.y + sprite.y2 - 8);
}

/** SpriteCB_FlyBirdSwoopDown: an arc from the right edge, down past the player, to the left edge. */
function SpriteCB_FlyBirdSwoopDown(sprite: BirdSprite): void {
  sprite.x2 = Cos(sprite.data[2], 140);
  sprite.y2 = Sin(sprite.data[2], 72);
  sprite.data[2] = (sprite.data[2] + 4) & 0xff;
  carryPlayer(sprite);
  if (sprite.data[2] >= 128) sprite.data[sAnimCompleted] = 1;
}

/** SpriteCB_FlyBirdReturnToBall: back into the ball, shrinking, then invisible. */
function SpriteCB_FlyBirdReturnToBall(sprite: BirdSprite): void {
  if (sprite.data[sAnimCompleted] === 0) {
    if (sprite.data[sInitData] === 0) {
      sprite.startAffine(sAffineAnims_FlyBirdBall, 1);
      sprite.x = isMale() ? 112 : 100;
      sprite.y = -32;
      sprite.data[sInitData]++;
      sprite.data[1] = 240;
      sprite.data[2] = 2048;
      sprite.data[4] = 128;
    }
    sprite.data[1] += sprite.data[2] >> 8;
    sprite.data[3] += sprite.data[2] >> 8;
    sprite.data[1] &= 0xff;
    sprite.x2 = Cos(sprite.data[1], 32);
    sprite.y2 = Sin(sprite.data[1], 120);
    if (sprite.data[2] > 256) sprite.data[2] -= sprite.data[4];
    if (sprite.data[4] < 256) sprite.data[4] += 24;
    if (sprite.data[2] < 256) sprite.data[2] = 256;
    if (sprite.data[3] >= 60) {
      sprite.data[sAnimCompleted]++;
      sprite.affineOff();
      sprite.fes.invisible = true;
    }
  }
}

/** StartFlyBirdReturnToBall */
function StartFlyBirdReturnToBall(bird: BirdSprite): void {
  StartFlyBirdSwoopDown(bird);
  bird.callback = SpriteCB_FlyBirdReturnToBall;
}

/** DoBirdSpriteWithPlayerAffineAnim */
function DoBirdSpriteWithPlayerAffineAnim(sprite: BirdSprite, affineAnimId: number): void {
  sprite.startAffine(sAffineAnims_FlyBirdWithPlayer, affineAnimId);
}

/** SpriteCB_FlyBirdWithPlayer: a wide arc, carrying the player. */
function SpriteCB_FlyBirdWithPlayer(sprite: BirdSprite): void {
  sprite.x2 = Cos(sprite.data[2], 180);
  sprite.y2 = Sin(sprite.data[2], 72);
  sprite.data[2] = (sprite.data[2] + 2) & 0xff;
  carryPlayer(sprite);
  if (sprite.data[2] >= 128) {
    sprite.data[sAnimCompleted] = 1;
    sprite.affineOff();
  }
}

/** TryChangeBirdSprite: once the shrinking bird is back to its size, it swoops down normally. */
function TryChangeBirdSprite(sprite: BirdSprite): void {
  if (sprite.affineOn && (sprite.matrix.a === 0x100 || sprite.matrix.d === 0x100)) {
    sprite.affineOff();
    sprite.fes.startAnim(0);
    sprite.callback = SpriteCB_FlyBirdSwoopDown;
  }
}

/** ObjectEventSetGraphicsId on the player (the avatar's graphics are preloaded) */
function setPlayerGraphics(stateId: number): void {
  const gfxId = GetPlayerAvatarGraphicsIdByStateId(stateId);
  const info = avatarField().spriteInfo(gfxId);
  if (info) playerObj().setGraphics(info, gfxId);
}

/** StartSpriteAnim(player, ANIM_GET_ON_OFF_POKEMON_WEST): sAnim_GetOnOffSurfWest is frame 11. */
function showGetOnOffWest(): void {
  playerObj().sprite.setFrame(11);
  playerObj().sprite.setFlipX(false);
}

// ------------------------------------------------------------------ FLDEFF_FLY_OUT

/** FldEff_FlyOut → Task_FlyOut (sFlyOutFieldEffectFuncs) */
function FldEff_FlyOut(): boolean {
  const monPartyId = gFieldEffectArguments[0];
  let tState = 0;
  let tTimer = 0;
  let tAvatarFlags = 0;
  let bird: BirdSprite | undefined;
  let pose: () => boolean = () => true;
  let fadeOut: () => boolean = () => true;
  // The banner's graphics load while the pose plays (as CreateFieldEffectShowMon does).
  let loaded = false;
  void LoadFieldMoveShowMonGfx().then(() => (loaded = true));
  testEvent('flyOut');
  CreateTask(() => {
    const player = playerObj();
    switch (tState) {
      case 0: // FlyOutFieldEffect_FieldMovePose
        if (!player.movementOverridden || player.clearHeldMovementIfFinished()) {
          tAvatarFlags = gPlayerAvatar.flags;
          gPlayerAvatar.preventStep = true;
          SetPlayerAvatarStateMask(PLAYER_AVATAR_FLAG.ON_FOOT);
          pose = StartPlayerAvatarSummonMonForFieldMoveAnim(); // + MOVEMENT_ACTION_START_ANIM_IN_DIRECTION
          pose();
          tState++;
        }
        return false;
      case 1: // FlyOutFieldEffect_ShowMon
        if (pose() && loaded) {
          tState++;
          gFieldEffectArguments[0] = monPartyId;
          FieldEffectStart('FLDEFF_FIELD_MOVE_SHOW_MON_INIT');
        }
        return false;
      case 2: // FlyOutFieldEffect_BirdLeaveBall
        if (!FieldEffectActiveListContains('FLDEFF_FIELD_MOVE_SHOW_MON')) {
          if (tAvatarFlags & PLAYER_AVATAR_FLAG.SURFING) SetPlayerSurfBlobBobState(BOB_MON_ONLY); // (+ SetSurfBlob_DontSyncAnim(FALSE): the default)
          bird = CreateFlyBirdSprite('FLDEFF_FLY_OUT');
          tState++;
        }
        return false;
      case 3: // FlyOutFieldEffect_WaitBirdLeave
        if (GetFlyBirdAnimCompleted(bird!)) {
          tState++;
          tTimer = 16;
          SetPlayerAvatarTransitionFlags(PLAYER_AVATAR_FLAG.ON_FOOT);
          player.setHeldMovement(directionalAction('FACE', 'left'));
        }
        return false;
      case 4: // FlyOutFieldEffect_BirdSwoopDown
        if ((tTimer === 0 || --tTimer === 0) && player.clearHeldMovementIfFinished()) {
          tState++;
          PlaySE(K.SE_M_FLY);
          StartFlyBirdSwoopDown(bird!);
        }
        return false;
      case 5: // FlyOutFieldEffect_JumpOnBird
        if (++tTimer >= 8) {
          setPlayerGraphics(K.PLAYER_AVATAR_GFX_RIDE);
          showGetOnOffWest();
          player.inanimate = true;
          player.setHeldMovement(directionalAction('JUMP_IN_PLACE', 'left'));
          tState++;
          tTimer = 0;
        }
        return false;
      case 6: // FlyOutFieldEffect_FlyOffWithBird
        if (++tTimer >= 10) {
          player.clearHeldMovementIfActive();
          player.inanimate = false;
          player.hasShadow = false;
          SetFlyBirdPlayerSpriteId(bird!, true);
          bird!.fes.startAnim(genderNum() * 2 + 1);
          DoBirdSpriteWithPlayerAffineAnim(bird!, 0);
          bird!.callback = SpriteCB_FlyBirdWithPlayer;
          // CameraObjectReset2: the camera stays where it is (it follows the player's tile, not its sprite)
          tState++;
        }
        return false;
      case 7: // FlyOutFieldEffect_WaitFlyOff
        if (GetFlyBirdAnimCompleted(bird!)) {
          fadeOut = flyHost().warpFadeOutScreen(sWarpDestination?.map ?? flyHost().mapId());
          tState++;
        }
        return false;
      default: // FlyOutFieldEffect_End
        if (fadeOut()) {
          FieldEffectActiveListRemove('FLDEFF_FLY_OUT');
          return true;
        }
        return false;
    }
  });
  return false;
}

// ------------------------------------------------------------------ FLDEFF_FLY_IN

/** FldEff_FlyIn → Task_FlyIn (sFlyInFieldEffectFuncs) */
function FldEff_FlyIn(): boolean {
  let tState = 0;
  let tTimer = 0;
  let tAvatarFlags = 0;
  let data1 = 0;
  let bird: BirdSprite | undefined;
  let pose: () => boolean = () => true;
  let jumpBase = { x: 0, y: 0 };
  testEvent('flyIn');
  CreateTask(() => {
    const player = playerObj();
    switch (tState) {
      case 0: // FlyInFieldEffect_BirdSwoopDown
        if (!player.movementOverridden || player.clearHeldMovementIfFinished()) {
          tState++;
          tTimer = 33;
          tAvatarFlags = gPlayerAvatar.flags;
          gPlayerAvatar.preventStep = true;
          SetPlayerAvatarStateMask(PLAYER_AVATAR_FLAG.ON_FOOT);
          if (tAvatarFlags & PLAYER_AVATAR_FLAG.SURFING) SetPlayerSurfBlobBobState(BOB_NONE);
          setPlayerGraphics(K.PLAYER_AVATAR_GFX_RIDE);
          // CameraObjectReset2
          player.face('left');
          showGetOnOffWest();
          player.setVisible(true);
          bird = CreateFlyBirdSprite('FLDEFF_FLY_IN');
          StartFlyBirdSwoopDown(bird);
          SetFlyBirdPlayerSpriteId(bird, true);
          bird.fes.startAnim(genderNum() * 2 + 2);
          DoBirdSpriteWithPlayerAffineAnim(bird, 1);
          bird.callback = SpriteCB_FlyBirdWithPlayer;
          carryPlayer(bird);
        }
        return false;
      case 1: // FlyInFieldEffect_FlyInWithBird
        TryChangeBirdSprite(bird!);
        if (tTimer === 0 || --tTimer === 0) {
          SetFlyBirdPlayerSpriteId(bird!, false);
          // playerSprite->x += x2; y += y2; x2 = y2 = 0 (the bird's callback left no offset)
          jumpBase = playerSpriteScreenPos();
          tState++;
          tTimer = 0;
        }
        return false;
      case 2: {
        // FlyInFieldEffect_JumpOffBird
        const yOffsets = [-2, -4, -5, -6, -7, -8, -8, -8, -7, -7, -6, -5, -3, -2, 0, 2, 4, 8];
        setPlayerSpriteScreenPos(jumpBase.x, jumpBase.y + yOffsets[tTimer]);
        if (++tTimer >= 18) tState++;
        return false;
      }
      case 3: // FlyInFieldEffect_FieldMovePose
        if (GetFlyBirdAnimCompleted(bird!)) {
          player.inanimate = false;
          const { x, y } = player.current;
          player.setPosition(x, y); // MoveObjectEventToMapCoords; x2 = y2 = 0, coordOffsetEnabled = TRUE
          pose = StartPlayerAvatarSummonMonForFieldMoveAnim(); // + MOVEMENT_ACTION_START_ANIM_IN_DIRECTION
          pose();
          tState++;
        }
        return false;
      case 4: // FlyInFieldEffect_BirdReturnToBall
        if (pose()) {
          tState++;
          StartFlyBirdReturnToBall(bird!);
        }
        return false;
      case 5: // FlyInFieldEffect_WaitBirdReturn
        if (GetFlyBirdAnimCompleted(bird!)) {
          bird!.destroyed = true;
          bird!.fes.destroy(); // DestroySprite
          tState++;
          data1 = 16;
        }
        return false;
      default: {
        // FlyInFieldEffect_End
        if (--data1 === 0) {
          let gfxState = K.PLAYER_AVATAR_GFX_NORMAL;
          if (tAvatarFlags & PLAYER_AVATAR_FLAG.SURFING) {
            gfxState = K.PLAYER_AVATAR_GFX_RIDE;
            SetPlayerSurfBlobBobState(BOB_PLAYER_AND_MON);
          }
          setPlayerGraphics(gfxState);
          player.face('down');
          gPlayerAvatar.flags = tAvatarFlags;
          gPlayerAvatar.preventStep = false;
          FieldEffectActiveListRemove('FLDEFF_FLY_IN');
          return true;
        }
        return false;
      }
    }
  });
  return false;
}

// ------------------------------------------------------------------ registration

registerFieldEffectNatives({ FldEff_FlyOut, FldEff_FlyIn });

/** sFieldMoveCursorCallbacks[FIELD_MOVE_FLY] (from registerFieldMoves) */
export function registerFly(): void {
  registerFieldMoveSetUp('FIELD_MOVE_FLY', SetUpFieldMove_Fly);
}
