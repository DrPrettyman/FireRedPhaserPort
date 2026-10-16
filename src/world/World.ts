import Phaser from 'phaser';
import type { Assets } from '../data/assets';
import type { MapConnection, MapData, MapLayoutData } from '../data/types';
import {
  LAYER_DEPTH,
  MAPGRID_COLLISION_MASK,
  MAPGRID_COLLISION_SHIFT,
  MAPGRID_ELEVATION_SHIFT,
  MAPGRID_METATILE_ID_MASK,
  MapChunk,
  createLayer,
} from './MapChunk';
import { ATLAS_LAYERS } from './TilesetPair';

/** How far past the current map's edges the border pattern is drawn (screen is 15x10 tiles). */
const BORDER_PAD_X = 9;
const BORDER_PAD_Y = 7;

export interface TileInfo {
  chunk?: MapChunk;
  metatile: number;
  collision: number;
  elevation: number;
  behavior: number;
  /** METATILE_ATTRIBUTE_ENCOUNTER_TYPE (TILE_ENCOUNTER_*) */
  encounterType: number;
  /** METATILE_ATTRIBUTE_TERRAIN (TILE_TERRAIN_*) */
  terrain: number;
}

/**
 * The loaded slice of the overworld: the current map plus its connected neighbours,
 * all positioned in a shared world tile space so walking across a seam is seamless.
 */
export class World {
  current!: MapChunk;
  private chunks: MapChunk[] = [];
  private borderMaps: Phaser.Tilemaps.Tilemap[] = [];
  private generation = 0;

  constructor(
    private scene: Phaser.Scene,
    private assets: Assets,
  ) {}

  /** Throw away everything and load `name` with its origin at (originX, originY). */
  async load(name: string, originX = 0, originY = 0): Promise<MapChunk> {
    const data = await this.assets.loadMap(name);
    await this.assets.loadTilesetTextures(this.scene, data.tilesetPair);
    this.clear();
    const chunk = new MapChunk(data, originX, originY);
    chunk.render(this.scene, this.assets.tilesetPair(data.tilesetPair));
    this.chunks = [chunk];
    this.current = chunk;
    await this.loadConnections();
    return chunk;
  }

  /**
   * The current map with another layout (SetCurrentMapLayout before InitMap's InitMapLayoutData): its grid,
   * border and tilesets replaced, the header (events, connections, layoutId) kept.
   */
  async setCurrentLayout(layout: MapLayoutData): Promise<void> {
    const old = this.current;
    const { id: _id, ...grid } = layout;
    const data: MapData = { ...old.data, ...grid };
    await this.assets.loadTilesetTextures(this.scene, data.tilesetPair);
    const chunk = new MapChunk(data, old.originX, old.originY);
    chunk.render(this.scene, this.assets.tilesetPair(data.tilesetPair));
    old.destroy();
    this.chunks[this.chunks.indexOf(old)] = chunk;
    this.current = chunk;
    this.renderBorder();
  }

  /** Make an already-loaded neighbour the current map and stream in its own neighbours. */
  async setCurrent(chunk: MapChunk): Promise<void> {
    if (chunk === this.current) return;
    this.current = chunk;
    await this.loadConnections();
  }

  /** The current map and its connected neighbours. */
  get loaded(): readonly MapChunk[] {
    return this.chunks;
  }

  /** Every map tilemap layer on screen: the loaded maps' and the border's (the GBA's BG1-3). */
  get mapLayers(): Phaser.Tilemaps.TilemapLayer[] {
    return [...this.chunks.flatMap((c) => c.layers), ...this.borderMaps.flatMap((m) => m.layers.map((l) => l.tilemapLayer))];
  }

  chunkAt(wx: number, wy: number): MapChunk | undefined {
    if (this.current?.contains(wx, wy)) return this.current;
    return this.chunks.find((c) => c.contains(wx, wy));
  }

  tileAt(wx: number, wy: number): TileInfo {
    const chunk = this.chunkAt(wx, wy);
    if (chunk) {
      const block = chunk.blockAt(wx, wy)!;
      return this.describe(chunk.data, block, chunk);
    }
    // Outside every loaded map: the border, which is always impassable (GetBorderBlockAt).
    const d = this.current.data;
    const block = this.borderBlock(d, wx - this.current.originX, wy - this.current.originY) | MAPGRID_COLLISION_MASK;
    return this.describe(d, block);
  }

  private describe(data: MapData, block: number, chunk?: MapChunk): TileInfo {
    const metatile = block & MAPGRID_METATILE_ID_MASK;
    const pair = this.assets.tilesetPair(data.tilesetPair);
    return {
      chunk,
      metatile,
      collision: (block & MAPGRID_COLLISION_MASK) >> MAPGRID_COLLISION_SHIFT,
      elevation: block >> MAPGRID_ELEVATION_SHIFT,
      behavior: pair.behavior(metatile),
      encounterType: pair.encounterType(metatile),
      terrain: pair.terrain(metatile),
    };
  }

  private borderBlock(d: MapData, mx: number, my: number): number {
    const bx = ((mx % d.borderWidth) + d.borderWidth) % d.borderWidth;
    const by = ((my % d.borderHeight) + d.borderHeight) % d.borderHeight;
    return d.border[by * d.borderWidth + bx];
  }

  private async loadConnections(): Promise<void> {
    const gen = ++this.generation;
    const cur = this.current;
    const wanted = await Promise.all(
      cur.data.connections
        .filter((c) => c.direction !== 'dive' && c.direction !== 'emerge')
        .map(async (c) => {
          const name = this.assets.mapNameForId(c.map);
          if (!name) return undefined;
          const data = await this.assets.loadMap(name);
          await this.assets.loadTilesetTextures(this.scene, data.tilesetPair);
          return { data, ...connectionOrigin(cur, c, data) };
        }),
    );
    if (gen !== this.generation || cur !== this.current) return; // superseded

    const keep: MapChunk[] = [cur];
    for (const w of wanted) {
      if (!w) continue;
      let chunk = this.chunks.find((c) => c.name === w.data.name && c.originX === w.x && c.originY === w.y);
      if (!chunk) {
        chunk = new MapChunk(w.data, w.x, w.y);
        chunk.render(this.scene, this.assets.tilesetPair(w.data.tilesetPair));
      }
      keep.push(chunk);
    }
    for (const c of this.chunks) if (!keep.includes(c)) c.destroy();
    this.chunks = keep;
    this.renderBorder();
  }

  private renderBorder(): void {
    for (const m of this.borderMaps) m.destroy();
    const cur = this.current;
    const d = cur.data;
    const ox = cur.originX - BORDER_PAD_X;
    const oy = cur.originY - BORDER_PAD_Y;
    const grid: number[][] = [];
    for (let y = 0; y < d.height + BORDER_PAD_Y * 2; y++) {
      const row: number[] = [];
      for (let x = 0; x < d.width + BORDER_PAD_X * 2; x++) {
        const wx = ox + x;
        const wy = oy + y;
        row.push(this.chunkAt(wx, wy) ? -1 : this.borderBlock(d, wx - cur.originX, wy - cur.originY) & MAPGRID_METATILE_ID_MASK);
      }
      grid.push(row);
    }
    const pair = this.assets.tilesetPair(d.tilesetPair);
    this.borderMaps = ATLAS_LAYERS.map((layer) => createLayer(this.scene, grid, pair, layer, ox, oy, LAYER_DEPTH[layer] - 1));
  }

  private clear(): void {
    this.generation++;
    for (const c of this.chunks) c.destroy();
    for (const m of this.borderMaps) m.destroy();
    this.chunks = [];
    this.borderMaps = [];
  }
}

function connectionOrigin(from: MapChunk, c: MapConnection, to: MapData): { x: number; y: number } {
  const { originX: ox, originY: oy } = from;
  switch (c.direction) {
    case 'up':
      return { x: ox + c.offset, y: oy - to.height };
    case 'down':
      return { x: ox + c.offset, y: oy + from.data.height };
    case 'left':
      return { x: ox - to.width, y: oy + c.offset };
    case 'right':
    default:
      return { x: ox + from.data.width, y: oy + c.offset };
  }
}
