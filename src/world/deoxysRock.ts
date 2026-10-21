// Birth Island's triangle (the meteorite, LOCALID_BIRTH_ISLAND_EXTERIOR_ROCK, OBJ_EVENT_GFX_METEORITE on OBJ palette
// 10, PALSLOT_NPC_SPECIAL) and its two field effects:
// - field_specials.c's palette half of MoveDeoxysObject / SetDeoxysTrianglePalette: LoadPalette(sDeoxysObjectPals[n],
//   OBJ_PLTT_ID(10), PLTT_SIZEOF(4)) puts colours 0-3 of deoxys_rock_n.gbapal over gObjectEventPal_Meteorite;
// - field_effect.c's FLDEFF_MOVE_DEOXYS_ROCK (FldEff_MoveDeoxysRock, Task_MoveDeoxysRock_Step): the object moves to
//   its new tile at once and its sprite slides there in gFieldEffectArguments[5] frames;
// - field_effect.c's FLDEFF_DESTROY_DEOXYS_ROCK (FldEff_DestroyDeoxysRock, Task_DestroyDeoxysRock,
//   Task_DeoxysRockCameraShake, CreateDeoxysRockFragments, SpriteCB_DeoxysRockFragment): the camera shakes, after 121
//   frames the rock vanishes in a white flash, four fragments fly off, the shake dies down, the object is removed.
//
// The field's object sprites are Phaser textures with their palette baked in, so a palette load redraws the rock's
// texture from gObjectEventPic_BirthIslandStone (`deoxys_rock`, one 32x32 frame) and the fragments' from
// sRockFragment_* on the same palette. ApplyGlobalFieldPaletteTint(10) is the quest log's sepia / grey tint: the rock
// is drawn with it in a playback scene (not in the final scene's BACKUP_GRAYSCALE: the end's palette restore doesn't
// redraw the rock, so it keeps its colours there).
// The fragments are drawn at screen coordinates, as the C's (coordOffsetEnabled is off: they don't shake).

import Phaser from 'phaser';
import { testEvent } from '../dev/testHooks';
import { FieldEffectSprite, type AnimCmd } from '../entities/FieldEffects';
import type { ObjectEvent } from '../entities/ObjectEvent';
import { gfx, gfx16 } from '../gba/gfx';
import { PlaySE } from '../gba/sound';
import { K } from '../battle/constants';
import { setLoadDeoxysObjectPal } from '../script/eventIslandSpecials';
import { CreateTask } from './fieldMoves';
import { FieldEffectActiveListRemove, gFieldEffectArguments, registerFieldEffectNatives } from './fieldEffectScripts';
import { canvasTexture, drawFrames } from './hallOfFameRecord';
import { globalFieldTintMode, tintForMode } from './questLogScreen';

/** Graphics the triangle and its effects draw (preload at boot). */
export const DEOXYS_ROCK_GFX = [
  'sDeoxysObjectPals',
  'gObjectEventPal_Meteorite',
  'gObjectEventPic_BirthIslandStone',
  'sRockFragment_TopLeft',
  'sRockFragment_TopRight',
  'sRockFragment_BottomLeft',
  'sRockFragment_BottomRight',
];

export interface DeoxysRockHost {
  scene: Phaser.Scene;
  /** gTotalCameraPixelOffset's counterpart: the world pixel at the screen's top left without SetCameraPanning's pan. */
  cameraOrigin(): { x: number; y: number };
  /** The current SetCameraPanning offset (the Phaser camera is drawn that far off cameraOrigin). */
  cameraPan(): { x: number; y: number };
  /** field.cameraTop, for the sprites' depth. */
  cameraTop(): number;
  /** TryGetObjectEventIdByLocalIdAndMap on the current map. */
  objectByLocalId(localId: number): ObjectEvent | undefined;
  /** A world tile from a map-local one of the current map. */
  localToWorld(x: number, y: number): { x: number; y: number };
  /** RemoveObjectEventByLocalIdAndMap (sets the object's flag, as the C does). */
  removeObject(localId: number): void;
  /** SetCameraPanning(dx, dy); 0, 0 for InstallCameraPanAheadCallback. */
  setCameraPanning(dx: number, dy: number): void;
  /**
   * BlendPalettes(PALETTES_BG, 16, RGB_WHITE) + BeginNormalPaletteFade(PALETTES_BG, 0, 16, 0, RGB_WHITE). The field's
   * fades are an overlay over everything, so the objects flash too (docs/DEVIATIONS.md).
   */
  bgWhiteFlash(): void;
  /** gPaletteFade.active */
  paletteFadeActive(): boolean;
}

let host: DeoxysRockHost | undefined;

export function setDeoxysRockHost(h: DeoxysRockHost): void {
  host = h;
}

function field(): DeoxysRockHost {
  if (!host) throw new Error('[deoxys rock] no host');
  return host;
}

const ROCK_TEXTURE = 'deoxys_rock';
const FRAGMENT_TEXTURE = 'deoxys_rock_fragment';

/** OBJ palette 10 as the meteorite's sprites see it (gPlttBuffer's 16 colours). */
let sObjPal10: Uint16Array | undefined;

function objPal10(): Uint16Array {
  if (!sObjPal10) sObjPal10 = gfx16('gObjectEventPal_Meteorite').slice(0, 16);
  return sObjPal10;
}

/** Dev: palette 10's first four colours (what sDeoxysObjectPals loads), for tests. */
export function deoxysRockPaletteProbe(): number[] {
  return [...objPal10().slice(0, 4)];
}

/**
 * LoadPalette(sDeoxysObjectPals[num], OBJ_PLTT_ID(10), PLTT_SIZEOF(4)) + ApplyGlobalFieldPaletteTint(10): the
 * first 4 colours, then the rock (local id `rockLocalId`) is redrawn on them.
 */
export function LoadDeoxysObjectPal(num: number, rockLocalId: number): void {
  const pals = gfx16('sDeoxysObjectPals');
  const pal = objPal10();
  for (let i = 0; i < 4; i++) pal[i] = pals[num * 16 + i];
  // ApplyGlobalFieldPaletteTint(10): QL_TINT_GRAYSCALE / QL_TINT_SEPIA (a copy: the C's tinted gPlttBufferUnfaded
  // is gone with the playback's save reload)
  const mode = globalFieldTintMode();
  const tint = mode === K.QL_TINT_GRAYSCALE || mode === K.QL_TINT_SEPIA ? tintForMode(mode) : undefined;
  const rock = field().objectByLocalId(rockLocalId);
  if (rock) {
    drawFrames(canvasTexture(field().scene, ROCK_TEXTURE, 32, 32, 1), gfx('gObjectEventPic_BirthIslandStone'), tint ? pal.map(tint) : pal, 32, 32, 1);
    if (rock.sprite.texture.key !== ROCK_TEXTURE) rock.sprite.setTexture(ROCK_TEXTURE, '0');
  }
  testEvent('deoxysRockPalette', { num });
}

// ------------------------------------------------------------------ FLDEFF_MOVE_DEOXYS_ROCK

/**
 * FldEff_MoveDeoxysRock: args 0-2 the object (local id, map num, group; the port looks on the current map), 3-4 its
 * new map-local tile, 5 the frames the slide takes. ShiftObjectEventCoords moves the object at once; then
 * Task_MoveDeoxysRock_Step slides its sprite there in 1/16 px steps (data[4..7]) and ends with
 * ShiftStillObjectEventCoords and the effect off the active list.
 */
function FldEff_MoveDeoxysRock(): boolean {
  const h = field();
  const obj = h.objectByLocalId(gFieldEffectArguments[0]);
  if (!obj) return false; // (the C leaves the effect on the list then)
  const to = h.localToWorld(gFieldEffectArguments[3], gFieldEffectArguments[4]);
  const from = obj.current;
  // data[2] / data[3]: the sprite's x / y at the new tile
  const spriteX = obj.spriteX;
  const spriteY = obj.spriteY;
  const targetX = spriteX + (to.x - from.x) * 16;
  const targetY = spriteY + (to.y - from.y) * 16;
  obj.shiftObjectEventCoords(to.x, to.y);
  const data = [0, 0, targetX, targetY, 0, 0, 0, 0, gFieldEffectArguments[5]];
  // the sprite is drawn where it was until the slide moves it
  const place = (x: number, y: number) => obj.setSpriteOffset(x - targetX, y - targetY);
  place(spriteX, spriteY);
  CreateTask(() => {
    // Task_MoveDeoxysRock_Step
    switch (data[0]) {
      case 0: {
        data[4] = spriteX << 4;
        data[5] = spriteY << 4;
        // SAFE_DIV (the C's UB divide by zero)
        data[6] = data[8] ? Math.trunc(((data[2] << 4) - data[4]) / data[8]) : 0;
        data[7] = data[8] ? Math.trunc(((data[3] << 4) - data[5]) / data[8]) : 0;
        data[0]++;
      }
      // fallthrough
      case 1:
        if (data[8] !== 0) {
          data[8]--;
          data[4] += data[6];
          data[5] += data[7];
          place(data[4] >> 4, data[5] >> 4);
          return false;
        }
        place(data[2], data[3]);
        obj.shiftStillObjectEventCoords();
        obj.triggerGroundEffectsOnStop = true;
        FieldEffectActiveListRemove('FLDEFF_MOVE_DEOXYS_ROCK');
        testEvent('deoxysRockMoved', { x: to.x, y: to.y });
        return true;
    }
    return true;
  });
  return false;
}

// ------------------------------------------------------------------ FLDEFF_DESTROY_DEOXYS_ROCK

// sAnims_DeoxysRockFragment: one frame each (sImages_DeoxysRockFragment: top left, top right, bottom left, right)
const sAnims_DeoxysRockFragment: AnimCmd[][] = [0, 1, 2, 3].map((i) => [[i, 0, 0, 0], ['end']]);

interface DestroyProbe {
  state: number;
  timer: number;
  shake: number;
  ending: boolean;
  fragments: { x: number; y: number }[];
  done: boolean;
}

let lastDestroy: DestroyProbe | undefined;

/** Dev: the last FLDEFF_DESTROY_DEOXYS_ROCK, for `__test`. */
export function destroyDeoxysRockProbe(): DestroyProbe | undefined {
  return lastDestroy && { ...lastDestroy, fragments: lastDestroy.fragments.map((f) => ({ ...f })) };
}

/**
 * FldEff_DestroyDeoxysRock: Task_DestroyDeoxysRock (priority 80) and, from its first state, Task_DeoxysRockCameraShake
 * (90), run here as one field task in that order; the fragments' callbacks and anims run after them (AnimateSprites).
 */
function FldEff_DestroyDeoxysRock(): boolean {
  const h = field();
  const localId = gFieldEffectArguments[0];
  const obj = h.objectByLocalId(localId);
  if (!obj) {
    FieldEffectActiveListRemove('FLDEFF_DESTROY_DEOXYS_ROCK');
    return false;
  }
  // Task_DestroyDeoxysRock's data: tState, tTimer
  let tState = 0;
  let tTimer = 0;
  // Task_DeoxysRockCameraShake's data[0] (delay), [1] (up/down), [5] (shake), [6] (end delay), [7] (ending)
  let shakeTask: number[] | undefined;
  const fragments: FieldEffectSprite[] = [];
  let fragmentsCreated = false;
  const probe: DestroyProbe = { state: 0, timer: 0, shake: 0, ending: false, fragments: [], done: false };
  lastDestroy = probe;

  const cameraShake = (data: number[]) => {
    // Task_DeoxysRockCameraShake
    if (data[7] !== 0) {
      if (++data[6] > 20) {
        data[6] = 0;
        if (data[5] !== 0) data[5]--;
      }
    } else data[5] = 4;
    if (++data[0] > 1) {
      data[0] = 0;
      if (++data[1] & 1) h.setCameraPanning(0, -data[5]);
      else h.setCameraPanning(0, data[5]);
    }
    // (UpdateCameraPanning: the pan shows this frame)
    if (data[5] === 0) shakeTask = undefined; // DestroyTask
  };

  /** CreateDeoxysRockFragments: at the rock's screen position (its sprite's x + x2, y + y2 - 4), without the pan. */
  const createFragments = () => {
    const origin = h.cameraOrigin();
    const xPos = obj.spriteX - origin.x;
    const yPos = obj.spriteY - origin.y - 4;
    const tiles = new Uint8Array(4 * 32);
    ['sRockFragment_TopLeft', 'sRockFragment_TopRight', 'sRockFragment_BottomLeft', 'sRockFragment_BottomRight'].forEach((sym, i) => tiles.set(gfx(sym).subarray(0, 32), i * 32));
    // oam.paletteNum = the rock's (OBJ palette 10, as the triangle's last palette load left it)
    drawFrames(canvasTexture(h.scene, FRAGMENT_TEXTURE, 8, 8, 4), tiles, objPal10(), 8, 8, 4);
    for (let i = 0; i < 4; i++) {
      const s = new FieldEffectSprite(h.scene, 'FLDEFF_DESTROY_DEOXYS_ROCK', FRAGMENT_TEXTURE, { frameWidth: 8, frameHeight: 8, anims: sAnims_DeoxysRockFragment }, xPos, yPos, 0, () => {});
      s.startAnim(i);
      s.data[0] = i;
      fragments.push(s);
    }
  };

  /** SpriteCB_DeoxysRockFragment */
  const fragmentCallback = (sprite: FieldEffectSprite) => {
    switch (sprite.data[0]) {
      case 0:
        sprite.x -= 16;
        sprite.y -= 12;
        break;
      case 1:
        sprite.x += 16;
        sprite.y -= 12;
        break;
      case 2:
        sprite.x -= 16;
        sprite.y += 12;
        break;
      case 3:
        sprite.x += 16;
        sprite.y += 12;
        break;
    }
    if (sprite.x < -4 || sprite.x > 240 + 4 || sprite.y < -4 || sprite.y > 160 + 4) sprite.destroy();
  };

  let done = false;
  let fragmentsReported = false;
  CreateTask(() => {
    if (!done) {
      // Task_DestroyDeoxysRock: InstallCameraPanAheadCallback(); SetCameraPanningCallback(NULL)
      h.setCameraPanning(0, 0);
      switch (tState) {
        case 0: // DestroyDeoxysRockEffect_CameraShake
          shakeTask = [0, 0, 0, 0, 0, 0, 0, 0];
          PlaySE(K.SE_THUNDER2);
          tState++;
          break;
        case 1: // DestroyDeoxysRockEffect_RockFragments
          if (++tTimer > 120) {
            obj.setVisible(false); // gObjectEvents[tObjectEventId].invisible = TRUE
            h.bgWhiteFlash();
            createFragments();
            fragmentsCreated = true;
            PlaySE(K.SE_THUNDER);
            if (shakeTask) shakeTask[7] = 1; // StartEndingDeoxysRockCameraShake
            tTimer = 0;
            tState++;
          }
          break;
        case 2: // DestroyDeoxysRockEffect_WaitAndEnd
          if (!h.paletteFadeActive() && !shakeTask) {
            h.setCameraPanning(0, 0); // InstallCameraPanAheadCallback
            h.removeObject(localId);
            FieldEffectActiveListRemove('FLDEFF_DESTROY_DEOXYS_ROCK');
            done = true;
            probe.done = true;
            testEvent('deoxysRockDestroyed');
          }
          break;
      }
      if (shakeTask) cameraShake(shakeTask);
    }
    // AnimateSprites: the fragments, then their OAM at screen coordinates (+ the camera's pan: they don't shake)
    const origin = h.cameraOrigin();
    const pan = h.cameraPan();
    for (const s of fragments) {
      if (!s.inUse) continue;
      fragmentCallback(s);
      if (!s.inUse) continue;
      s.animate();
      const { x, y } = s;
      s.x = x + origin.x + pan.x;
      s.y = y + origin.y + pan.y;
      s.render(h.cameraTop());
      s.x = x;
      s.y = y;
    }
    if (fragmentsCreated && !fragmentsReported) {
      fragmentsReported = true;
      testEvent('deoxysRockFragments', { fragments: fragments.map((s) => ({ x: s.x, y: s.y })) }); // as first drawn
    }
    for (let i = fragments.length - 1; i >= 0; i--) if (!fragments[i].inUse) fragments.splice(i, 1);
    probe.state = tState;
    probe.timer = tTimer;
    probe.shake = shakeTask?.[5] ?? 0;
    probe.ending = !!shakeTask?.[7];
    probe.fragments = fragments.map((s) => ({ x: s.x, y: s.y }));
    return done && fragments.length === 0;
  });
  return false;
}

/** The two field effects' natives (callnative FldEff_MoveDeoxysRock / FldEff_DestroyDeoxysRock) and the palette load. */
export function registerDeoxysRock(): void {
  registerFieldEffectNatives({ FldEff_MoveDeoxysRock, FldEff_DestroyDeoxysRock });
  setLoadDeoxysObjectPal(LoadDeoxysObjectPal);
}
