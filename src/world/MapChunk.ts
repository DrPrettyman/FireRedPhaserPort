import Phaser from 'phaser';
import type { MapData } from '../data/types';
import { ATLAS_LAYERS, NUM_METATILES_IN_PRIMARY, type AtlasLayer, type TilesetPair } from './TilesetPair';

export const TILE = 16;

export const MAPGRID_METATILE_ID_MASK = 0x03ff;
export const MAPGRID_COLLISION_MASK = 0x0c00;
export const MAPGRID_COLLISION_SHIFT = 10;
export const MAPGRID_ELEVATION_SHIFT = 12;

// Depth bands mirror the field's BG/OAM priorities: `bottom`, `middle` and `top` hold BG3, BG2 and BG1
// (DrawMetatile), and a sprite of OAM priority p draws over the BGs of priority >= p. Within a band
// objects sort like SortSprites: by subpriority, then by screen top.
export const DEPTH_BOTTOM = -1;
const DEPTH_OBJECTS_PRIORITY_3 = 0;
export const DEPTH_MIDDLE = 300_000;
const DEPTH_OBJECTS_PRIORITY_2 = 400_000;
export const DEPTH_TOP = 700_000;
const DEPTH_OBJECTS_PRIORITY_1 = 800_000;

/** The depth of each map layer (a border layer sits just under the map's own). */
export const LAYER_DEPTH: Record<AtlasLayer, number> = { bottom: DEPTH_BOTTOM, middle: DEPTH_MIDDLE, top: DEPTH_TOP };

/**
 * Depth of an object sprite (higher draws in front). SortSprites orders OAM by
 * `oam.priority << 8 | subpriority`, and on a tie puts the sprite whose top (oam.y) is lower on screen
 * first, i.e. in front. Priority 3 draws over BG3 only (reflections, ripples), 2 over BG2 and under
 * BG1, 1 over BG1 too. (Priority 0 would also draw over the text window on BG0; no map elevation gives
 * it, so it shares 1's band.) Any remaining tie keeps creation order.
 */
export function objectDepth(priority: number, subpriority: number, screenTop: number): number {
  const base = priority <= 1 ? DEPTH_OBJECTS_PRIORITY_1 : priority === 2 ? DEPTH_OBJECTS_PRIORITY_2 : DEPTH_OBJECTS_PRIORITY_3;
  const top = Math.max(-512, Math.min(511, screenTop)) + 512; // only on-screen sprites can tie
  return base + (255 - subpriority) * 1024 + top;
}

/**
 * One map placed in world tile space at (originX, originY), drawn as three tilemaps: the field's
 * bottom, middle and top BGs, with object sprites between them by OAM priority.
 */
export class MapChunk {
  private maps: Phaser.Tilemaps.Tilemap[] = [];
  private pair?: TilesetPair;
  /** Per-visit copy of the map grid, so setmetatile edits don't leak into the cached map data. */
  readonly blocks: number[];

  constructor(
    readonly data: MapData,
    readonly originX: number,
    readonly originY: number,
  ) {
    this.blocks = data.blocks.slice();
  }

  get name(): string {
    return this.data.name;
  }

  contains(wx: number, wy: number): boolean {
    const x = wx - this.originX;
    const y = wy - this.originY;
    return x >= 0 && y >= 0 && x < this.data.width && y < this.data.height;
  }

  /** Raw map grid value at a world tile, or undefined if outside this map. */
  blockAt(wx: number, wy: number): number | undefined {
    if (!this.contains(wx, wy)) return undefined;
    return this.blocks[(wy - this.originY) * this.data.width + (wx - this.originX)];
  }

  /** MapGridSetMetatileIdAt with map-local coords; `value` is the full grid value (metatile | collision). */
  setBlock(x: number, y: number, value: number, draw = true): void {
    if (x < 0 || y < 0 || x >= this.data.width || y >= this.data.height) return;
    const old = this.blocks[y * this.data.width + x];
    this.blocks[y * this.data.width + x] = (old & ~0x0fff) | (value & 0x0fff);
    if (draw) this.drawBlock(x, y);
  }

  /**
   * The BG tilemaps' cell redrawn from the map grid (map-local coords): what DrawWholeMapView does for a cell
   * that `setBlock(..., false)` changed (the escalator sets the grid first and draws it later, as the C does).
   */
  drawBlock(x: number, y: number): void {
    if (!this.pair || x < 0 || y < 0 || x >= this.data.width || y >= this.data.height) return;
    const gid = this.pair.gid(this.blocks[y * this.data.width + x] & MAPGRID_METATILE_ID_MASK);
    for (const m of this.maps) m.putTileAt(gid, x, y);
  }

  /** Dev: whether the BG tilemaps' cell shows the map grid's metatile (map-local coords). */
  drawnMatchesGrid(x: number, y: number): boolean {
    if (!this.pair) return false;
    const gid = this.pair.gid(this.blocks[y * this.data.width + x] & MAPGRID_METATILE_ID_MASK);
    return this.maps.every((m) => m.getTileAt(x, y, true)?.index === gid);
  }

  /** Show or hide this map's tiles at a map-local cell on every layer (a door drawn over it). */
  setCellVisible(x: number, y: number, visible: boolean): void {
    for (const m of this.maps) m.getTileAt(x, y, false)?.setVisible(visible);
  }

  render(scene: Phaser.Scene, pair: TilesetPair): void {
    this.pair = pair;
    const { width, height } = this.data;
    const blocks = this.blocks;
    const grid: number[][] = [];
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) row.push(blocks[y * width + x] & MAPGRID_METATILE_ID_MASK);
      grid.push(row);
    }
    for (const layer of ATLAS_LAYERS) this.maps.push(createLayer(scene, grid, pair, layer, this.originX, this.originY, LAYER_DEPTH[layer]));
  }

  /** The bottom/middle/top tilemap layers. */
  get layers(): Phaser.Tilemaps.TilemapLayer[] {
    return this.maps.flatMap((m) => m.layers.map((l) => l.tilemapLayer));
  }

  destroy(): void {
    for (const m of this.maps) m.destroy();
    this.maps = [];
  }
}

/** Build one tilemap layer from a grid of metatile ids (-1 = empty). */
export function createLayer(
  scene: Phaser.Scene,
  grid: number[][],
  pair: TilesetPair,
  atlas: AtlasLayer,
  originX: number,
  originY: number,
  depth: number,
): Phaser.Tilemaps.Tilemap {
  const gids = grid.map((row) => row.map((m) => (m < 0 ? -1 : pair.gid(m))));
  const map = scene.make.tilemap({ data: gids, tileWidth: TILE, tileHeight: TILE });
  const tilesets = [
    map.addTilesetImage(pair.primaryTexture(atlas), pair.primaryTexture(atlas), TILE, TILE, 0, 0, 0),
    map.addTilesetImage(pair.pairTexture(atlas), pair.pairTexture(atlas), TILE, TILE, 0, 0, NUM_METATILES_IN_PRIMARY),
  ];
  if (tilesets.some((t) => !t)) throw new Error(`Missing tileset textures for ${pair.key}`);
  const layer = map.createLayer(0, tilesets as Phaser.Tilemaps.Tileset[], originX * TILE, originY * TILE);
  layer?.setDepth(depth);
  return map;
}
