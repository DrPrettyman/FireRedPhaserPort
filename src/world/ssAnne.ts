// ss_anne.c: the S.S. Anne's departure after the captain gives HM01 (SSAnne_Exterior_ExitSSAnne:
// `special DoSSAnneDepartureCutscene` + `waitstate`). The boat is the map's object 1 (LOCALID_SS_ANNE, a 128x64
// OBJ_EVENT_GFX_SS_ANNE); the cutscene slides its sprite left through sprite->x2 (the object itself never moves),
// with a wake behind it and a puff of smoke from its funnel every 70 frames, until it's off screen. Then
// Task_SSAnneFinish's ScriptContext_Enable lets the script's `waitstate` end, and the script removes the object.
//
// The wake and smoke aren't object events or gFieldEffectObjectTemplate_*s, so they're drawn here as
// FieldEffectSprites with textures built from sWakeTiles / sSmokeTiles (graphics/ss_anne/) on OBJ palette 10
// (PALSLOT_NPC_SPECIAL: the boat's gObjectEventPal_SSAnne). Like the C, positions are screen coordinates: the
// camera doesn't move during the cutscene. The horn (SE_SS_ANNE_HORN) sounds as it starts and as the ship leaves.

import Phaser from 'phaser';
import { K } from '../battle/constants';
import { testEvent } from '../dev/testHooks';
import { FieldEffectSprite, type AnimCmd } from '../entities/FieldEffects';
import type { ObjectEvent } from '../entities/ObjectEvent';
import { gfx, gfx16 } from '../gba/gfx';
import { PlaySE } from '../gba/sound';
import { registerSpecials } from '../script/specials';
import { CreateTask } from './fieldMoves';
import { canvasTexture, drawFrames } from './hallOfFameRecord';

/** Graphics the cutscene draws (preload at boot). */
export const SS_ANNE_GFX = ['sWakeTiles', 'sSmokeTiles', 'gObjectEventPal_SSAnne'];

export interface SSAnneHost {
  scene: Phaser.Scene;
  /** The world pixel at the screen's top left (gSprites' x/y are screen coordinates). */
  screenOrigin(): { x: number; y: number };
  /** field.cameraTop, for the sprites' depth. */
  cameraTop(): number;
  /** TryGetObjectEventIdByLocalIdAndMap(localId, the current map) */
  objectByLocalId(localId: number): ObjectEvent | undefined;
}

let host: SSAnneHost | undefined;

export function setSSAnneHost(h: SSAnneHost): void {
  host = h;
}

const WAKE_TEXTURE = 'ss_anne_wake';
const SMOKE_TEXTURE = 'ss_anne_smoke';

/** LOCALID_SS_ANNE: the C looks the boat up as local id 1 of the current map. */
const LOCALID_SS_ANNE = 1;

// sWakeAnim / sSmokeAnim. The templates have no image table (tileTag sprites), so ANIMCMD_FRAME's value is a tile
// offset: the wake's 16x32 frames are 8 tiles each (0, 8 → frames 0, 1), the smoke's 16x16 frames 4 (0-12 → 0-3).
const sWakeAnim: AnimCmd[] = [
  [0, 12, 0, 0],
  [1, 12, 0, 0],
  ['jump', 0],
];
const sSmokeAnim: AnimCmd[] = [
  [0, 10, 0, 0],
  [1, 20, 0, 0],
  [2, 20, 0, 0],
  [3, 30, 0, 0],
  ['end'],
];

type Kind = 'wake' | 'smoke';

/** One DoSSAnneDepartureCutscene: the task (data[0..3]), the wake and smoke sprites. */
class Departure {
  /** gTasks[taskId].data */
  private readonly data = [0, 0, 0, 0];
  private func: 'init' | 'run' | 'finish' | 'done' = 'init';
  private readonly sprites: { s: FieldEffectSprite; kind: Kind }[] = [];
  /** How many smoke sprites CreateSmokeSprite made (for the probe). */
  smokeCreated = 0;
  frames = 0;
  /** ScriptContext_Enable has run. */
  enabled = false;

  constructor(private readonly h: SSAnneHost) {
    this.data[0] = 50;
  }

  get state(): string {
    return this.func;
  }

  /** gObjectEvents[objectEventId] for local id 1 of the current map */
  boat(): ObjectEvent | undefined {
    return this.h.objectByLocalId(LOCALID_SS_ANNE);
  }

  /** The boat's gSprites[spriteId].x2 */
  boatX2 = 0;

  /** gSprites[boatObject->spriteId].x + .x2, in screen coordinates */
  private boatScreenX(): number {
    const boat = this.boat();
    if (!boat) return -0x8000;
    return boat.spriteX - this.h.screenOrigin().x + this.boatX2;
  }

  /** The boat's sprite drawn x2 px off its position (the object stays on its tile). */
  private applyBoatX2(): void {
    const boat = this.boat();
    if (boat) boat.sprite.setX(boat.spriteX + this.boatX2);
  }

  /** RunTasks (Task_SSAnne*), then AnimateSprites (the sprites' callbacks and anims) and the OAM. */
  tick(): boolean {
    this.frames++;
    this.runTask();
    this.applyBoatX2();
    for (const e of this.sprites) {
      if (!e.s.inUse) continue;
      if (e.kind === 'wake') this.WakeSpriteCallback(e.s);
      else this.SmokeSpriteCallback(e.s);
      if (e.s.inUse) e.s.animate();
    }
    const origin = this.h.screenOrigin();
    for (const e of this.sprites) {
      if (!e.s.inUse) continue;
      // FieldEffectSprite draws at world coordinates
      const { x, y } = e.s;
      e.s.x = x + origin.x;
      e.s.y = y + origin.y;
      e.s.render(this.h.cameraTop());
      e.s.x = x;
      e.s.y = y;
    }
    for (let i = this.sprites.length - 1; i >= 0; i--) if (!this.sprites[i].s.inUse) this.sprites.splice(i, 1);
    if (this.func === 'done' && this.sprites.length === 0) return true;
    return false;
  }

  private runTask(): void {
    const data = this.data;
    switch (this.func) {
      case 'init': // Task_SSAnneInit
        if (--data[0] === 0) {
          // LoadSpriteSheets(sSpriteSheets)
          drawFrames(canvasTexture(this.h.scene, WAKE_TEXTURE, 16, 32, 2), gfx('sWakeTiles'), gfx16('gObjectEventPal_SSAnne'), 16, 32, 2);
          drawFrames(canvasTexture(this.h.scene, SMOKE_TEXTURE, 16, 16, 4), gfx('sSmokeTiles'), gfx16('gObjectEventPal_SSAnne'), 16, 16, 4);
          this.CreateWakeBehindBoat();
          this.func = 'run';
          testEvent('ssAnneDeparture', { phase: 'run' });
        }
        break;
      case 'run': {
        // Task_SSAnneRun
        data[1]++;
        data[2]++;
        if (data[1] === 70) {
          data[1] = 0;
          this.CreateSmokeSprite();
        }
        if (!this.boat() || this.boatScreenX() < -120) {
          PlaySE(K.SE_SS_ANNE_HORN);
          this.func = 'finish';
          testEvent('ssAnneDeparture', { phase: 'finish', boatX2: this.boatX2 });
        } else {
          const x = Math.trunc(data[2] / 5);
          this.boatX2 = -x;
        }
        break;
      }
      case 'finish': // Task_SSAnneFinish
        if (++data[3] === 40) {
          // FreeSpriteTilesByTag(SPRITE_TAG_WAKE / _SMOKE), DestroyTask, ScriptContext_Enable
          this.func = 'done';
          this.enabled = true;
          testEvent('ssAnneDeparture', { phase: 'done', frames: this.frames });
        }
        break;
    }
  }

  private createSprite(kind: Kind, x: number, y: number, subpriority: number): FieldEffectSprite {
    const [texture, w, hgt, anim] = kind === 'wake' ? [WAKE_TEXTURE, 16, 32, sWakeAnim] : [SMOKE_TEXTURE, 16, 16, sSmokeAnim];
    const s = new FieldEffectSprite(this.h.scene, 'DoSSAnneDepartureCutscene', texture, { frameWidth: w, frameHeight: hgt, anims: [anim] }, x, y, subpriority, () => {});
    this.sprites.push({ s, kind });
    return s;
  }

  /** CreateWakeBehindBoat: CreateSprite(&sWakeSpriteTemplate, boat x + 80, 109, 0xFF), oam.priority 2 */
  private CreateWakeBehindBoat(): void {
    const x = this.boatScreenX() + 80;
    const s = this.createSprite('wake', x, 109, 0xff);
    s.priority = 2;
  }

  /** WakeSpriteCallback: follows the boat 80 px behind it, drifting up to 22 px further back. */
  private WakeSpriteCallback(sprite: FieldEffectSprite): void {
    sprite.x = this.boatScreenX() + 80;
    if (Math.trunc(sprite.data[0] / 6) < 22) sprite.data[0]++;
    sprite.x2 = Math.trunc(sprite.data[0] / 6);
    if (sprite.x + sprite.x2 < -18) sprite.destroy();
  }

  /** CreateSmokeSprite: a puff at the funnel (boat x + 49, y 78) while that's on screen, subpriority 8 */
  private CreateSmokeSprite(): void {
    const x = this.boatScreenX() + 49;
    if (x >= -32) {
      this.createSprite('smoke', x, 78, 8);
      this.smokeCreated++;
    }
  }

  /** SmokeSpriteCallback: drifts right a pixel every 4 frames until its anim ends. */
  private SmokeSpriteCallback(sprite: FieldEffectSprite): void {
    sprite.data[0]++;
    sprite.x2 = Math.trunc(sprite.data[0] / 4);
    if (sprite.animEnded) sprite.destroy();
  }

  probe(): SSAnneProbe {
    const sprite = (e: { s: FieldEffectSprite }) => ({ x: e.s.x, x2: e.s.x2, y: e.s.y, image: e.s.image, visible: e.s.sprite.visible });
    const boat = this.boat();
    return {
      state: this.func,
      frames: this.frames,
      boatX2: this.boatX2,
      boatScreenX: boat ? this.boatScreenX() : undefined,
      boatSpriteX: boat ? boat.sprite.x - this.h.screenOrigin().x : undefined,
      wake: this.sprites.filter((e) => e.kind === 'wake' && e.s.inUse).map(sprite),
      smoke: this.sprites.filter((e) => e.kind === 'smoke' && e.s.inUse).map(sprite),
      smokeCreated: this.smokeCreated,
    };
  }
}

export interface SSAnneProbe {
  state: string;
  frames: number;
  boatX2: number;
  /** gSprites[boat].x + x2 (screen) */
  boatScreenX?: number;
  /** Where the boat's Phaser sprite is drawn (screen x of its centre). */
  boatSpriteX?: number;
  wake: { x: number; x2: number; y: number; image: number; visible: boolean }[];
  smoke: { x: number; x2: number; y: number; image: number; visible: boolean }[];
  smokeCreated: number;
}

let active: Departure | undefined;

/** Dev: the last departure cutscene (state 'done' once it's over), for `__test.ssAnne()`. */
export function ssAnneProbe(): SSAnneProbe | undefined {
  return active?.probe();
}

/** DoSSAnneDepartureCutscene: PlaySE(SE_SS_ANNE_HORN), then Task_SSAnneInit with data[0] = 50. */
function DoSSAnneDepartureCutscene(): Departure {
  if (!host) throw new Error('[ss anne] no host');
  PlaySE(K.SE_SS_ANNE_HORN);
  const d = new Departure(host);
  active = d;
  testEvent('ssAnneDeparture', { phase: 'start' });
  CreateTask(() => d.tick()); // CreateTask(Task_SSAnneInit, 8)
  return d;
}

/** `special DoSSAnneDepartureCutscene`: the script's `waitstate` waits for Task_SSAnneFinish's ScriptContext_Enable. */
export function registerSSAnne(): void {
  registerSpecials({
    DoSSAnneDepartureCutscene({ setWaitState }) {
      const d = DoSSAnneDepartureCutscene();
      setWaitState(() => d.enabled);
    },
  });
}
