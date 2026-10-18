// Port of field_door.c: door animations drawn over the map at a door metatile. The GBA copies a frame's
// tiles into the last 8 BG tiles and points the door's tilemap entries at them (bottom layer only, as a
// COVERED metatile); here each frame is drawn with the map's palettes into small textures laid over the
// door, with the map's own tiles there hidden until the door is drawn closed again.

import Phaser from 'phaser';
import { K } from '../battle/constants';
import { gfx } from '../gba/gfx';
import type { MapChunk } from './MapChunk';
import { LAYER_DEPTH, TILE } from './MapChunk';
import { ATLAS_LAYERS, type AtlasLayer, type TilesetPair } from './TilesetPair';
import { tilesetVram, type MetatileImages } from './TilesetVram';

/** doors.json (tools/extract_field.py): sDoorGraphics and the DoorAnimFrame lists. */
export interface DoorData {
  /** CLOSED_DOOR_TILES_OFFSET */
  closedOffset: number;
  /** sDoorAnimFrames_*: [duration, tileOffset in bytes] */
  frames: Record<'OpenSmall' | 'OpenLarge' | 'CloseSmall' | 'CloseLarge', [number, number][]>;
  doors: DoorGraphics[];
}

interface DoorGraphics {
  metatileId: number;
  /** DOOR_SOUND_NORMAL / DOOR_SOUND_SLIDING */
  sound: number;
  /** DOOR_SIZE_1x1 / DOOR_SIZE_1x2 */
  size: number;
  /** sDoorAnimTiles_* (gfx symbol) */
  tiles: string;
  paletteNums: number[];
}

const DOOR_SIZE_1x1 = 0;
/** field_door.c's local enum (DOOR_SOUND_SLIDING = 1) */
const DOOR_SOUND_NORMAL = 0;
// NUM_TILES_TOTAL - 8: where CopyDoorTilesToVram puts a frame's 8 tiles.
const DOOR_TILE_START = 1024 - 8;
const METATILE_LAYER_TYPE_COVERED = 1;

/** What the doors need from the field. */
export interface DoorField {
  readonly scene: Phaser.Scene;
  /** MapGridGetMetatileIdAt / MapGridGetMetatileBehaviorAt, world coords. */
  metatileAt(x: number, y: number): { metatile: number; behavior: number; chunk?: MapChunk };
  tilesetPair(chunk: MapChunk): TilesetPair;
  /** MetatileBehavior_IsWarpDoor_2 */
  isWarpDoor(behavior: number): boolean;
}

/** A door drawn in a non-closed frame: the map tiles it hides and the images over them. */
interface DoorOverlay {
  chunk: MapChunk;
  cells: [number, number][];
  textures: Partial<Record<AtlasLayer, Phaser.Textures.CanvasTexture>>;
  images: Phaser.GameObjects.Image[];
  height: number;
}

/** Task_AnimateDoor's data */
interface DoorTask {
  gfx: DoorGraphics;
  frames: [number, number][];
  frameId: number;
  counter: number;
  x: number;
  y: number;
}

let overlaySerial = 0;

export class FieldDoors {
  private task?: DoorTask;
  private overlays = new Map<string, DoorOverlay>();

  constructor(
    private readonly data: DoorData,
    private readonly field: DoorField,
  ) {}

  /** Every door tile graphic, to preload. */
  static gfxSymbols(data: DoorData): string[] {
    return [...new Set(data.doors.map((d) => d.tiles))];
  }

  /** FieldIsDoorAnimationRunning */
  get running(): boolean {
    return this.task !== undefined;
  }

  /** FieldAnimateDoorOpen: false (-1) if there's no door animation for that tile or one is running. */
  animateOpen(x: number, y: number): boolean {
    if (!this.field.isWarpDoor(this.field.metatileAt(x, y).behavior)) return false;
    const gfx = this.doorGraphics(x, y);
    if (!gfx) return false;
    return this.startTask(gfx, gfx.size === DOOR_SIZE_1x1 ? this.data.frames.OpenSmall : this.data.frames.OpenLarge, x, y);
  }

  /** FieldAnimateDoorClose */
  animateClose(x: number, y: number): boolean {
    if (!this.field.isWarpDoor(this.field.metatileAt(x, y).behavior)) return false;
    const gfx = this.doorGraphics(x, y);
    if (!gfx) return false;
    return this.startTask(gfx, gfx.size === DOOR_SIZE_1x1 ? this.data.frames.CloseSmall : this.data.frames.CloseLarge, x, y);
  }

  /**
   * GetDoorSoundEffect (world coords): SE_DOOR for a DOOR_SOUND_NORMAL door, else SE_SLIDING_DOOR (also for a
   * tile without door graphics: GetDoorSoundType's -1).
   */
  getDoorSoundEffect(x: number, y: number): number {
    return this.doorGraphics(x, y)?.sound === DOOR_SOUND_NORMAL ? K.SE_DOOR : K.SE_SLIDING_DOOR;
  }

  /** FieldSetDoorOpened: draw the open-animation's last frame. */
  setOpened(x: number, y: number): void {
    if (!this.field.isWarpDoor(this.field.metatileAt(x, y).behavior)) return;
    const gfx = this.doorGraphics(x, y);
    if (!gfx) return;
    const frames = gfx.size === DOOR_SIZE_1x1 ? this.data.frames.OpenSmall : this.data.frames.OpenLarge;
    this.drawDoor(gfx, frames[frames.length - 1], x, y); // GetLastDoorAnimFrame
  }

  /** FieldSetDoorClosed */
  setClosed(x: number, y: number): void {
    if (!this.field.isWarpDoor(this.field.metatileAt(x, y).behavior)) return;
    // DrawClosedDoor doesn't look the door up, so its size isn't known: both cells are redrawn as the map's.
    this.drawClosed(x, y);
  }

  /** Task_AnimateDoor, from RunTasks. */
  tick(): void {
    const t = this.task;
    if (t && !this.animateDoorFrame(t)) this.task = undefined;
  }

  /** The map was reloaded (warp): the door overlays and any running animation are gone with it. */
  clear(): void {
    this.task = undefined;
    for (const key of [...this.overlays.keys()]) this.removeOverlay(key);
  }

  private startTask(gfx: DoorGraphics, frames: [number, number][], x: number, y: number): boolean {
    if (this.task) return false; // FuncIsActiveTask(Task_AnimateDoor)
    this.task = { gfx, frames, frameId: 0, counter: 0, x, y };
    return true;
  }

  /** AnimateDoorFrame */
  private animateDoorFrame(t: DoorTask): boolean {
    if (t.counter === 0) this.drawDoor(t.gfx, t.frames[t.frameId], t.x, t.y);
    if (t.counter === t.frames[t.frameId][0]) {
      t.counter = 0;
      t.frameId++;
      return t.frameId < t.frames.length; // the {} terminator: final frame reached
    }
    t.counter++;
    return true;
  }

  /** GetDoorGraphics for the metatile at (x, y) */
  private doorGraphics(x: number, y: number): DoorGraphics | undefined {
    const id = this.field.metatileAt(x, y).metatile;
    return this.data.doors.find((d) => d.metatileId === id);
  }

  /** DrawDoor */
  private drawDoor(gfxInfo: DoorGraphics, frame: [number, number], x: number, y: number): void {
    const offset = frame[1];
    if (offset === this.data.closedOffset) {
      this.drawClosed(x, y, gfxInfo.size);
      return;
    }
    const { chunk } = this.field.metatileAt(x, y);
    if (!chunk) return;
    const pair = this.field.tilesetPair(chunk);
    // CopyDoorTilesToVram: the frame's 8 tiles become VRAM tiles DOOR_TILE_START..+7.
    const tiles = { start: DOOR_TILE_START, data: gfx(gfxInfo.tiles).subarray(offset, offset + 8 * 32) };
    const pals = gfxInfo.paletteNums;
    const large = gfxInfo.size !== DOOR_SIZE_1x1;
    const height = large ? 32 : 16;
    const images: MetatileImages = { bottom: new ImageData(16, height), middle: new ImageData(16, height), top: new ImageData(16, height) };
    // DrawCurrentDoorAnimFrame: a 1x2 door's upper half takes palettes 0-7, its lower half the next 8
    // (past the end of the 8-entry table on the GBA; those entries only colour tile 0).
    if (large) tilesetVram.renderEntries(pair, buildDoorTiles(DOOR_TILE_START, pals, 0), METATILE_LAYER_TYPE_COVERED, tiles, height, images, 0);
    tilesetVram.renderEntries(pair, buildDoorTiles(DOOR_TILE_START + (large ? 4 : 0), pals, large ? 4 : 0), METATILE_LAYER_TYPE_COVERED, tiles, height, images, large ? 16 : 0);
    const top = large ? y - 1 : y;
    const overlay = this.overlayAt(chunk, x, top, height);
    for (const layer of ATLAS_LAYERS) {
      const tex = overlay.textures[layer]!;
      tex.context.putImageData(images[layer], 0, 0);
      tex.refresh();
    }
  }

  /** DrawClosedDoorTiles: CurrentMapDrawMetatileAt on the door (and the tile above for a 1x2 door). */
  private drawClosed(x: number, y: number, size?: number): void {
    this.removeOverlay(`${x},${y}`);
    if (size !== DOOR_SIZE_1x1) this.removeOverlay(`${x},${y - 1}`);
  }

  private overlayAt(chunk: MapChunk, x: number, top: number, height: number): DoorOverlay {
    const key = `${x},${top}`;
    let o = this.overlays.get(key);
    if (o && o.height === height) return o;
    if (o) this.removeOverlay(key);
    const scene = this.field.scene;
    const cells: [number, number][] = [];
    for (let dy = 0; dy < height / TILE; dy++) cells.push([x - chunk.originX, top + dy - chunk.originY]);
    o = { chunk, cells, textures: {}, images: [], height };
    const serial = overlaySerial++;
    for (const layer of ATLAS_LAYERS) {
      const tex = scene.textures.createCanvas(`door_${serial}_${layer}`, 16, height)!;
      o.textures[layer] = tex;
      // Just over the map layer it replaces, under the objects of the next priority band.
      o.images.push(scene.add.image(x * TILE, top * TILE, tex.key).setOrigin(0, 0).setDepth(LAYER_DEPTH[layer] + 0.5));
    }
    for (const [cx, cy] of cells) chunk.setCellVisible(cx, cy, false);
    this.overlays.set(key, o);
    return o;
  }

  private removeOverlay(key: string): void {
    const o = this.overlays.get(key);
    if (!o) return;
    this.overlays.delete(key);
    for (const img of o.images) img.destroy();
    for (const tex of Object.values(o.textures)) tex?.destroy();
    for (const [cx, cy] of o.cells) o.chunk.setCellVisible(cx, cy, true);
  }
}

/**
 * BuildDoorTiles: the bottom layer's 4 entries use the door tiles, the top layer's 4 use tile 0, each
 * with the next palette number. `first` indexes paletteNums (the C passes &paletteNums[4]).
 */
function buildDoorTiles(tileNum: number, paletteNums: number[], first: number): number[] {
  const tiles: number[] = [];
  for (let i = 0; i < 8; i++) {
    const pal = (paletteNums[first + i] ?? 0) << 12;
    tiles.push(i < 4 ? pal | (tileNum + i) : pal);
  }
  return tiles;
}
