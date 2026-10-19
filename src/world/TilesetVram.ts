import type Phaser from 'phaser';
import { gfx, gfx16 } from '../gba/gfx';
import { ATLAS_LAYERS, NUM_METATILES_IN_PRIMARY, type AtlasLayer, type TilesetPair } from './TilesetPair';

// include/fieldmap.h
export const NUM_TILES_IN_PRIMARY = 640;
const NUM_PALS_IN_PRIMARY = 7;
const NUM_METATILES_IN_SECONDARY = 1024 - NUM_METATILES_IN_PRIMARY;
const TILE_SIZE_4BPP = 32;
const ATLAS_COLS = 32; // tools/extract.py ATLAS_COLS

// METATILE_LAYER_TYPE_*
const LAYER_COVERED = 1;
const LAYER_SPLIT = 2;

/** The palettes the atlases were drawn with, per tileset: 16 palettes of 16 [r, g, b] (palettes.json). */
export type TilesetPalettes = Record<string, number[][]>;

/**
 * A tileset's tiles as the field's BG VRAM holds them: a copy of the tileset's GBA-native tile data
 * that tile animations write into (tileset_anims.c), so the metatiles using those tiles can be redrawn.
 */
class TileStore {
  readonly tiles: Uint8Array;
  readonly metatiles: Uint16Array;
  /** Tiles that no longer match the atlas PNGs (written by an animation at least once). */
  readonly modified = new Set<number>();
  /** The palettes as BG palette RAM holds them now (gPlttBufferFaded): `basePalettes` with any load on top. */
  readonly palettes: number[][];
  /** gPlttBufferUnfaded: what `loadBgPalette` loaded; `loadBgPaletteFaded` (the weather's gamma shift) leaves it. */
  readonly unfaded: number[][];
  /** Palette slots that no longer match the atlas PNGs (`loadBgPalette`). */
  readonly modifiedPalettes = new Set<number>();
  /** The quest log's sPalettesBackup: the colours a tinted load had before the tint (QuestLog_BackUpPalette). */
  readonly backup: (number[] | undefined)[] = [];

  constructor(
    readonly name: string,
    tilesSymbol: string,
    metatilesSymbol: string,
    /** The tileset's own palettes (palettes.json), which the atlases were drawn with. */
    readonly basePalettes: number[][],
  ) {
    this.tiles = gfx(tilesSymbol).slice();
    this.metatiles = gfx16(metatilesSymbol);
    this.palettes = basePalettes.slice();
    this.unfaded = basePalettes.slice();
  }

  get tileCount(): number {
    return this.tiles.length / TILE_SIZE_4BPP;
  }
}

export interface MetatileImages {
  bottom: ImageData;
  middle: ImageData;
  top: ImageData;
}

/** Tile pixels for one tile index of the field's VRAM (0..639 primary, 640.. secondary). */
type TileSource = (tile: number) => { data: Uint8Array; offset: number } | undefined;

/**
 * Draw one metatile (8 tilemap entries) the way tools/extract.py render_atlas does: DrawMetatile's split
 * of the two layers over BG3/BG2/BG1 by layer type, the bottom BG filled with the backdrop colour.
 */
export function renderMetatile(
  entries: ArrayLike<number>,
  layerType: number,
  tileAt: TileSource,
  palettes: number[][],
  height = 16,
  into?: MetatileImages,
  oy = 0,
): MetatileImages {
  const out = into ?? { bottom: new ImageData(16, height), middle: new ImageData(16, height), top: new ImageData(16, height) };
  const backdrop = palettes[0];
  const bottom = out.bottom.data;
  for (let y = oy; y < oy + 16; y++) {
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      bottom[i] = backdrop[0];
      bottom[i + 1] = backdrop[1];
      bottom[i + 2] = backdrop[2];
      bottom[i + 3] = 255;
    }
  }
  const [lower, upper] =
    layerType === LAYER_COVERED ? [out.bottom, out.middle] : layerType === LAYER_SPLIT ? [out.bottom, out.top] : [out.middle, out.top];
  for (let i = 0; i < 8; i++) {
    const entry = entries[i];
    const src = tileAt(entry & 0x3ff);
    if (!src) continue;
    const pal = palettes[(entry >> 12) & 0xf];
    const hflip = entry & 0x400;
    const vflip = entry & 0x800;
    const img = (i < 4 ? lower : upper).data;
    const ox = (i & 1) * 8;
    const ty = oy + ((i >> 1) & 1) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const sx = hflip ? 7 - x : x;
        const sy = vflip ? 7 - y : y;
        const b = src.data[src.offset + sy * 4 + (sx >> 1)];
        const c = sx & 1 ? b >> 4 : b & 0xf;
        if (!c) continue;
        const p = ((ty + y) * 16 + ox + x) * 4;
        img[p] = pal[c * 3];
        img[p + 1] = pal[c * 3 + 1];
        img[p + 2] = pal[c * 3 + 2];
        img[p + 3] = 255;
      }
    }
  }
  return out;
}

/** One atlas (all three layers), turned into canvas textures so its slots can be redrawn. */
class AtlasCanvas {
  /** Global tile index (0..1023) → the slots whose metatile uses it. */
  private tileSlots = new Map<number, Set<number>>();
  /** Palette slot (0..15) → the slots whose metatile uses it. */
  private paletteSlots = new Map<number, Set<number>>();
  private textures: Record<AtlasLayer, Phaser.Textures.CanvasTexture>;
  private dirty = false;

  constructor(
    textures: Phaser.Textures.TextureManager,
    keys: Record<AtlasLayer, string>,
    readonly primary: TileStore,
    readonly secondary: TileStore | undefined,
    /** Slot → [metatile entries offset in its store, store, layer type]. */
    private slots: ([number, TileStore, number] | undefined)[],
  ) {
    this.textures = {} as Record<AtlasLayer, Phaser.Textures.CanvasTexture>;
    for (const layer of ATLAS_LAYERS) this.textures[layer] = toCanvasTexture(textures, keys[layer]);
    slots.forEach((s, slot) => {
      if (!s) return;
      const [offset, store] = s;
      for (let i = 0; i < 8; i++) {
        const tile = store.metatiles[offset + i] & 0x3ff;
        let set = this.tileSlots.get(tile);
        if (!set) this.tileSlots.set(tile, (set = new Set()));
        set.add(slot);
        const pal = store.metatiles[offset + i] >> 12;
        let pset = this.paletteSlots.get(pal);
        if (!pset) this.paletteSlots.set(pal, (pset = new Set()));
        pset.add(slot);
      }
    });
  }

  uses(store: TileStore): boolean {
    return store === this.primary || store === this.secondary;
  }

  /** The store this atlas takes palette slot `pal` from (a pair atlas: the primary's 0-6, the secondary's 7-15). */
  paletteStore(pal: number): TileStore {
    return this.secondary && pal >= NUM_PALS_IN_PRIMARY ? this.secondary : this.primary;
  }

  /** Redraw every slot using palette slot `pal`. */
  redrawPalette(pal: number): void {
    for (const s of this.paletteSlots.get(pal) ?? []) this.redrawSlot(s);
  }

  /**
   * Dev: a pixel the atlas drew with palette slot `pal` (the first one in slot order, of colour index
   * `colorIndex` if given, else any but 0), as the canvas holds it, with the colour index it was drawn from.
   */
  palettePixel(pal: number, colorIndex?: number): { rgb: number[]; colorIndex: number } | undefined {
    for (const slot of this.paletteSlots.get(pal) ?? []) {
      const s = this.slots[slot];
      if (!s) continue;
      const [offset, store, layerType] = s;
      for (let i = 0; i < 8; i++) {
        const entry = store.metatiles[offset + i];
        if (entry >> 12 !== pal) continue;
        const src = this.tile(entry & 0x3ff);
        if (!src) continue;
        const upper = i >= 4; // the two layers go to different atlases, so nothing is drawn over the pixel
        for (let p = 0; p < 64; p++) {
          const sx = p & 7, sy = p >> 3;
          const b = src.data[src.offset + sy * 4 + (sx >> 1)];
          const c = sx & 1 ? b >> 4 : b & 0xf;
          if (!c || (colorIndex !== undefined && c !== colorIndex)) continue;
          const x = (entry & 0x400 ? 7 - sx : sx) + (i & 1) * 8 + (slot % ATLAS_COLS) * 16;
          const y = (entry & 0x800 ? 7 - sy : sy) + ((i >> 1) & 1) * 8 + Math.floor(slot / ATLAS_COLS) * 16;
          const layer: AtlasLayer =
            layerType === LAYER_COVERED ? (upper ? 'middle' : 'bottom') : layerType === LAYER_SPLIT ? (upper ? 'top' : 'bottom') : upper ? 'top' : 'middle';
          const d = this.textures[layer].context.getImageData(x, y, 1, 1).data;
          return { rgb: [d[0], d[1], d[2]], colorIndex: c };
        }
      }
    }
    return undefined;
  }

  /** Redraw every slot using one of `tiles` (global tile indices). */
  redrawTiles(tiles: Iterable<number>): void {
    const slots = new Set<number>();
    for (const t of tiles) for (const s of this.tileSlots.get(t) ?? []) slots.add(s);
    for (const s of slots) this.redrawSlot(s);
  }

  private redrawSlot(slot: number): void {
    const s = this.slots[slot];
    if (!s) return;
    const [offset, store, layerType] = s;
    const palettes = this.secondary
      ? [...this.primary.palettes.slice(0, NUM_PALS_IN_PRIMARY), ...this.secondary.palettes.slice(NUM_PALS_IN_PRIMARY)]
      : this.primary.palettes;
    const images = renderMetatile(store.metatiles.subarray(offset, offset + 8), layerType, (t) => this.tile(t), palettes);
    const x = (slot % ATLAS_COLS) * 16;
    const y = Math.floor(slot / ATLAS_COLS) * 16;
    for (const layer of ATLAS_LAYERS) this.textures[layer].context.putImageData(images[layer], x, y);
    this.dirty = true;
  }

  tile(t: number): { data: Uint8Array; offset: number } | undefined {
    const store = t < NUM_TILES_IN_PRIMARY ? this.primary : this.secondary;
    const local = t < NUM_TILES_IN_PRIMARY ? t : t - NUM_TILES_IN_PRIMARY;
    if (!store || local >= store.tileCount) return undefined;
    return { data: store.tiles, offset: local * TILE_SIZE_4BPP };
  }

  /** Upload redrawn slots to the GPU (once per frame at most). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const layer of ATLAS_LAYERS) this.textures[layer].refresh();
  }
}

function sameColors(a: number[], b: number[]): boolean {
  return a === b || (a.length === b.length && a.every((c, i) => c === b[i]));
}

/** Redraw (and upload) what every live atlas drew with `store`'s palette `slot`. */
function redrawPalette(store: TileStore, slot: number): void {
  for (const atlas of atlases.values()) {
    if (!atlas.uses(store) || atlas.paletteStore(slot) !== store) continue;
    atlas.redrawPalette(slot);
    atlas.flush();
  }
}

/** Replace a loaded image texture by a canvas texture with the same key and content. */
function toCanvasTexture(textures: Phaser.Textures.TextureManager, key: string): Phaser.Textures.CanvasTexture {
  const existing = textures.get(key);
  // No runtime Phaser import here: test hooks (loaded by the Node unit tests via battle code) import this module.
  if ('context' in existing) return existing as Phaser.Textures.CanvasTexture;
  const img = existing.getSourceImage() as HTMLImageElement;
  textures.remove(key);
  const canvas = textures.createCanvas(key, img.width, img.height)!;
  canvas.context.drawImage(img, 0, 0);
  canvas.refresh();
  return canvas;
}

const stores = new Map<string, TileStore>();
const atlases = new Map<string, AtlasCanvas>();

/** The quest log's gGlobalFieldTintMode on the map's palette loads (`setBgPaletteTint`). */
let bgTint: { tint: (colors: number[]) => number[]; backup: boolean; makeLive: () => void } | undefined;

/**
 * The field's BG VRAM as far as the overworld needs it: each loaded tileset's tiles, which tile
 * animations overwrite, and the atlases drawn from them.
 */
export const tilesetVram = {
  /** Register a tileset's tile data (its gfx symbols must be loaded). */
  addStore(name: string, tilesSymbol: string, metatilesSymbol: string, palettes: number[][]): void {
    if (!stores.has(name)) stores.set(name, new TileStore(name, tilesSymbol, metatilesSymbol, palettes));
  },

  hasStore(name: string): boolean {
    return stores.has(name);
  },

  /** A tileset's tiles as VRAM holds them now (animated frames included), or undefined if not loaded. */
  tiles(name: string): Uint8Array | undefined {
    return stores.get(name)?.tiles;
  },

  /** A tile's current 4bpp data (tests). */
  tileData(name: string, tile: number): Uint8Array | undefined {
    const store = stores.get(name);
    return store && tile < store.tileCount ? store.tiles.slice(tile * TILE_SIZE_4BPP, (tile + 1) * TILE_SIZE_4BPP) : undefined;
  },

  /**
   * Make a pair's primary and pair atlases redrawable (canvas textures). Slots whose tiles an animation
   * already changed are redrawn at once, since the PNGs show the tileset's original tiles.
   */
  makeAtlasesLive(textures: Phaser.Textures.TextureManager, pair: TilesetPair): void {
    const primary = stores.get(pair.info.primary)!;
    const secondary = stores.get(pair.info.secondary)!;
    const keys = (f: (l: AtlasLayer) => string) => ({ bottom: f('bottom'), middle: f('middle'), top: f('top') });
    const overrides = new Set(pair.info.overrides);
    if (!atlases.has(pair.primaryTexture('bottom'))) {
      const slots = Array.from({ length: Math.min(NUM_METATILES_IN_PRIMARY, primary.metatiles.length >> 3) }, (_, i) =>
        overrides.has(i) ? undefined : ([i * 8, primary, pair.layerType(i)] as [number, TileStore, number]),
      );
      this.addAtlas(new AtlasCanvas(textures, keys((l) => pair.primaryTexture(l)), primary, undefined, slots), pair.primaryTexture('bottom'));
    }
    if (!atlases.has(pair.pairTexture('bottom'))) {
      const slots: ([number, TileStore, number] | undefined)[] = [];
      for (let i = 0; i < NUM_METATILES_IN_SECONDARY; i++) {
        slots.push(i < secondary.metatiles.length >> 3 ? [i * 8, secondary, pair.layerType(NUM_METATILES_IN_PRIMARY + i)] : undefined);
      }
      for (const m of pair.info.overrides) slots.push([m * 8, primary, pair.layerType(m)]);
      this.addAtlas(new AtlasCanvas(textures, keys((l) => pair.pairTexture(l)), primary, secondary, slots), pair.pairTexture('bottom'));
    }
  },

  addAtlas(atlas: AtlasCanvas, key: string): void {
    atlases.set(key, atlas);
    for (const store of [atlas.primary, atlas.secondary]) {
      if (!store) continue;
      for (const pal of store.modifiedPalettes) if (atlas.paletteStore(pal) === store) atlas.redrawPalette(pal);
      if (!store.modified.size) continue;
      const base = store === atlas.primary ? 0 : NUM_TILES_IN_PRIMARY;
      atlas.redrawTiles([...store.modified].map((t) => t + base));
    }
    atlas.flush();
  },

  /**
   * LoadPalette(colors, BG_PLTT_ID(slot), PLTT_SIZE_4BPP) for the field's map BGs: the pair's palette slot
   * (0-6 the primary's, 7-12 the secondary's) becomes `colors` (16 [r, g, b] in palettes.json's colour space),
   * and the metatiles drawn with it are redrawn at once (the atlases become live canvases the first time).
   * Loading the colours the slot already has costs nothing.
   */
  loadBgPalette(textures: Phaser.Textures.TextureManager, pair: TilesetPair, slot: number, colors: number[]): void {
    const store = stores.get(slot < NUM_PALS_IN_PRIMARY ? pair.info.primary : pair.info.secondary);
    if (store) store.unfaded[slot] = colors;
    this.loadBgPaletteFaded(textures, pair, slot, colors);
  },

  /**
   * Only gPlttBufferFaded's copy of a map BG palette (the weather's ApplyGammaShift): the slot shows `colors`, its
   * unfaded colours (`bgPaletteUnfaded`) stay.
   */
  loadBgPaletteFaded(textures: Phaser.Textures.TextureManager, pair: TilesetPair, slot: number, colors: number[]): void {
    const store = stores.get(slot < NUM_PALS_IN_PRIMARY ? pair.info.primary : pair.info.secondary);
    if (!store || sameColors(store.palettes[slot], colors)) return;
    store.palettes[slot] = colors;
    if (sameColors(store.basePalettes[slot], colors)) store.modifiedPalettes.delete(slot);
    else store.modifiedPalettes.add(slot);
    this.makeAtlasesLive(textures, pair); // (redraws the slot when it makes them live)
    redrawPalette(store, slot);
  },

  /**
   * LoadMapTilesetPalettes, as far as `loadBgPalette` changed them: every tileset's palettes back to its own
   * (a map load or a return to the field reloads BG palette RAM). Nothing to redraw if none was changed.
   */
  resetBgPalettes(): void {
    for (const store of stores.values()) {
      store.basePalettes.forEach((p, slot) => {
        // LoadTilesetPalette's ApplyGlobalTintToPaletteEntries: the tint on gPlttBufferUnfaded and Faded both
        const colors = bgTint ? bgTint.tint(p) : p;
        if (bgTint?.backup) store.backup[slot] = p; // QuestLog_BackUpPalette
        store.unfaded[slot] = colors;
        if (sameColors(store.palettes[slot], colors)) return;
        store.palettes[slot] = colors;
        if (colors === p || sameColors(p, colors)) store.modifiedPalettes.delete(slot);
        else store.modifiedPalettes.add(slot);
        redrawPalette(store, slot);
      });
    }
    bgTint?.makeLive(); // the current pair's atlases show the tinted palettes (the PNGs are untinted)
  },

  /**
   * The quest log's tint (fieldmap.c's ApplyGlobalTintToPaletteEntries, gGlobalFieldTintMode): `resetBgPalettes`
   * (LoadMapTilesetPalettes) loads the map's palettes through `tint` from now on, backing up the untinted colours if
   * `backup` (QL_TINT_BACKUP_GRAYSCALE); `makeLive` makes the current pair's atlases canvases. Undefined: no tint.
   */
  setBgPaletteTint(tint: ((colors: number[]) => number[]) | undefined, backup = false, makeLive: () => void = () => {}): void {
    bgTint = tint ? { tint, backup, makeLive } : undefined;
  },

  /** sPalettesBackup's copy of a map BG palette (the untinted colours), or gPlttBufferUnfaded's if none was backed up. */
  bgPaletteBackup(pair: TilesetPair, slot: number): number[] | undefined {
    const store = stores.get(slot < NUM_PALS_IN_PRIMARY ? pair.info.primary : pair.info.secondary);
    return store ? (store.backup[slot] ?? store.unfaded[slot]) : undefined;
  },

  /** Only gPlttBufferUnfaded's copy of a map BG palette (the slot shows what it showed). */
  setBgPaletteUnfaded(pair: TilesetPair, slot: number, colors: number[]): void {
    const store = stores.get(slot < NUM_PALS_IN_PRIMARY ? pair.info.primary : pair.info.secondary);
    if (store) store.unfaded[slot] = colors;
  },

  /** Task_EndQuestLog's CpuCopy16(sPalettesBackup, gPlttBufferUnfaded): the backed-up colours back (unfaded only). */
  restoreBgPaletteBackups(): void {
    for (const store of stores.values()) {
      store.backup.forEach((p, slot) => {
        if (p) store.unfaded[slot] = p;
      });
      store.backup.length = 0;
    }
  },

  /** A pair's map BG palette (0-6 the primary's, 7-12 the secondary's) as gPlttBufferUnfaded holds it. */
  bgPaletteUnfaded(pair: TilesetPair, slot: number): number[] | undefined {
    return stores.get(slot < NUM_PALS_IN_PRIMARY ? pair.info.primary : pair.info.secondary)?.unfaded[slot];
  },

  /** A tileset's palette slot as BG palette RAM holds it now (16 [r, g, b]), or undefined if not loaded. */
  bgPalette(name: string, slot: number): number[] | undefined {
    return stores.get(name)?.palettes[slot];
  },

  /** The palette slots of a tileset that `loadBgPalette` changed, with their colours (the GBA layer's copy of the map). */
  bgPaletteOverrides(name: string): Map<number, number[]> {
    const store = stores.get(name);
    return new Map(store ? [...store.modifiedPalettes].map((slot) => [slot, store.palettes[slot]]) : []);
  },

  /** Dev: a pixel the pair atlas drew with palette slot `pal`, as its canvas holds it (undefined if not live). */
  palettePixel(pair: TilesetPair, pal: number, colorIndex?: number): { rgb: number[]; colorIndex: number } | undefined {
    return atlases.get(pair.pairTexture('bottom'))?.palettePixel(pal, colorIndex);
  },

  /** DmaCopy16 into BG VRAM: `count` tiles of `src` to the named tileset's tile `destTile` (local index). */
  writeTiles(name: string, destTile: number, src: Uint8Array, count: number): void {
    const store = stores.get(name);
    if (!store) return;
    const n = Math.min(count, store.tileCount - destTile);
    if (n <= 0) return;
    store.tiles.set(src.subarray(0, n * TILE_SIZE_4BPP), destTile * TILE_SIZE_4BPP);
    const changed: number[] = [];
    for (let i = 0; i < n; i++) {
      store.modified.add(destTile + i);
      changed.push(destTile + i);
    }
    for (const atlas of atlases.values()) {
      if (!atlas.uses(store)) continue;
      const base = store === atlas.primary ? 0 : NUM_TILES_IN_PRIMARY;
      atlas.redrawTiles(changed.map((t) => t + base));
    }
  },

  /** Send this frame's redraws to the GPU. */
  flush(): void {
    for (const atlas of atlases.values()) atlas.flush();
  },

  /**
   * Draw a metatile from explicit tilemap entries with a pair's current tiles and palettes, e.g. a door
   * frame. `extraTiles` stands in for VRAM tiles from `extraStart` on (the door tiles' slot).
   */
  renderEntries(
    pair: TilesetPair,
    entries: ArrayLike<number>,
    layerType: number,
    extra?: { start: number; data: Uint8Array },
    height = 16,
    into?: MetatileImages,
    oy = 0,
  ): MetatileImages {
    const primary = stores.get(pair.info.primary)!;
    const secondary = stores.get(pair.info.secondary)!;
    const palettes = [...primary.palettes.slice(0, NUM_PALS_IN_PRIMARY), ...secondary.palettes.slice(NUM_PALS_IN_PRIMARY)];
    const tileAt: TileSource = (t) => {
      if (extra && t >= extra.start && (t - extra.start) * TILE_SIZE_4BPP < extra.data.length) {
        return { data: extra.data, offset: (t - extra.start) * TILE_SIZE_4BPP };
      }
      const store = t < NUM_TILES_IN_PRIMARY ? primary : secondary;
      const local = t < NUM_TILES_IN_PRIMARY ? t : t - NUM_TILES_IN_PRIMARY;
      return local < store.tileCount ? { data: store.tiles, offset: local * TILE_SIZE_4BPP } : undefined;
    };
    return renderMetatile(entries, layerType, tileAt, palettes, height, into, oy);
  },
};
