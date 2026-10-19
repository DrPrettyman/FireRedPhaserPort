// The weather's gamma shift and fog blend on the field's sprites (world/weather.ts ApplyGammaShift's OBJ palettes,
// ApplyFogBlend's lightened ones, UpdateSpritePaletteWithWeather). On the GBA they rewrite OBJ palette RAM; the
// port's object and field effect sprites are Phaser sprite sheets drawn with their palette, so the sheet itself is
// redrawn through the channel tables: each channel of each pixel is a palette colour's channel, so mapping the pixels
// is mapping the palette. A gamma shift maps the three channels through one table, a blend toward a colour (the fog's
// RGB(28, 31, 28)) through one table each.
//
// Which table a sheet takes follows sBasePaletteGammaTypes for the slot its palette sits in: the objects' own
// sheets (`spr_<name>`: PALSLOT_PLAYER, PALSLOT_NPC_1-4, PALSLOT_NPC_SPECIAL) GAMMA_ALT, their reflections
// (`spr_<name>_reflection`) and the field effects loaded with loadfadedpal (`fldeff_obj_<name>`, slots 12-15)
// GAMMA_NORMAL. A sheet is redrawn in place: its texture source becomes a canvas (the same Texture, frames and
// key, so the sprites using it and the GBA layer's copy of the field see the change), and the original pixels are
// kept to shift from or restore. A sheet loaded later is shifted as it's added (Phaser's ADD event).
//
// The quest log's palettes go the same way (world/questLogScreen.ts): its tint (field_effect.c's
// ApplyGlobalFieldPaletteTint, on every object and field effect sheet: gPlttBufferUnfaded), the colours it backs up and
// darkens at the end (QL_SlightlyDarkenSomePals: `setUnfaded`) and RestoreScreenAfterPlayback's writes straight into
// gPlttBufferFaded (`setFaded`, until the weather's next gamma shift). The pixels then go through a 15-bit colour
// table built from all of them.

import Phaser from 'phaser';
import { expand5, type ChannelTables } from './weather';

type GammaType = 'normal' | 'alt';
/** A sheet's palette slot kind: the weather's gamma types, or a field effect the weather leaves alone ('none'). */
export type SheetType = GammaType | 'none';
/** A BGR555 colour to another. */
export type ColorMap = (c: number) => number;
/** By the sheet's type (the slots a palette sits in). */
export type SheetColorMap = (type: SheetType, c: number) => number;

interface Shifted {
  original: ImageData;
  context: CanvasRenderingContext2D;
  /** The mapping the canvas shows now (undefined: the original). */
  shown: Mapping | undefined;
}

/** What a sheet of a type shows: gPlttBufferUnfaded (tint / unfaded), then gPlttBufferFaded (faded, else table). */
interface Mapping {
  table: ChannelTables | undefined;
  tint: ColorMap | undefined;
  unfaded: SheetColorMap | undefined;
  faded: SheetColorMap | undefined;
  lut?: Uint16Array;
}

const sameMapping = (a: Mapping | undefined, b: Mapping | undefined): boolean =>
  a === b || (!!a && !!b && a.table === b.table && a.tint === b.tint && a.unfaded === b.unfaded && a.faded === b.faded);

const isIdentity = (m: Mapping): boolean => !m.table && !m.tint && !m.unfaded && !m.faded;

const EXPAND5 = Uint8Array.from({ length: 32 }, (_, c) => expand5(c));

const instances = new WeakMap<Phaser.Textures.TextureManager, WeatherTextures>();

export class WeatherTextures {
  /** The one per texture manager (the field scene can be created again; the textures and their listeners stay). */
  static for(textures: Phaser.Textures.TextureManager, fadedFieldEffects: ReadonlySet<string>): WeatherTextures {
    let w = instances.get(textures);
    if (!w) instances.set(textures, (w = new WeatherTextures(textures, fadedFieldEffects)));
    return w;
  }

  private sheets = new Map<string, Shifted>();
  private tables: Record<GammaType, ChannelTables | undefined> = { normal: undefined, alt: undefined };
  private tint: ColorMap | undefined;
  private unfaded: SheetColorMap | undefined;
  private faded: SheetColorMap | undefined;
  /** The mapping per type, while the settings stay (its colour table built once). */
  private mappings = new Map<SheetType, Mapping>();

  private constructor(
    private textures: Phaser.Textures.TextureManager,
    /** The field effect templates whose palette the weather shifts (FieldEffectScript_LoadFadedPalette). */
    private fadedFieldEffects: ReadonlySet<string>,
  ) {
    textures.on(Phaser.Textures.Events.ADD, (key: string) => this.syncSheet(key));
    textures.on(Phaser.Textures.Events.REMOVE, (key: string) => this.sheets.delete(key));
  }

  /** The type of a field sprite sheet: the gamma type the weather shifts it with, 'none' for the other field effects. */
  private typeOf(key: string): SheetType | undefined {
    if (key.startsWith('fldeff_obj_')) return this.fadedFieldEffects.has(key.slice('fldeff_obj_'.length)) ? 'normal' : 'none';
    if (!key.startsWith('spr_')) return undefined;
    return key.endsWith('_reflection') ? 'normal' : 'alt';
  }

  /**
   * setObjPaletteGamma: redraw every sheet through its type's tables (undefined = as loaded). ApplyGammaShift writes
   * gPlttBufferFaded from gPlttBufferUnfaded, so a `setFaded` write is gone.
   */
  setTables(normal: ChannelTables | undefined, alt: ChannelTables | undefined): void {
    if (this.tables.normal === normal && this.tables.alt === alt && !this.faded) return;
    this.tables = { normal, alt };
    this.faded = undefined;
    this.syncAll();
  }

  /** The quest log's tint on the sheets' palettes as loaded (ApplyGlobalFieldPaletteTint); undefined: none. */
  setTint(tint: ColorMap | undefined): void {
    if (this.tint === tint) return;
    this.tint = tint;
    this.syncAll();
  }

  /** gPlttBufferUnfaded written by the quest log (QL_SlightlyDarkenSomePals, the backup restored), in place of the tint. */
  setUnfaded(unfaded: SheetColorMap | undefined): void {
    this.unfaded = unfaded;
    this.syncAll();
  }

  /** gPlttBufferFaded written from gPlttBufferUnfaded (CopyPaletteInvertedTint), until the next gamma shift. */
  setFaded(faded: SheetColorMap | undefined): void {
    this.faded = faded;
    this.syncAll();
  }

  private syncAll(): void {
    this.mappings.clear();
    for (const key of this.textures.getTextureKeys()) this.syncSheet(key);
  }

  private mappingFor(type: SheetType): Mapping {
    let m = this.mappings.get(type);
    if (!m) {
      m = { table: type === 'none' ? undefined : this.tables[type], tint: this.tint, unfaded: this.unfaded, faded: this.faded };
      this.mappings.set(type, m);
    }
    return m;
  }

  /** The mapping's 15-bit colour table: unfaded (the quest log's colours or tint), then faded (its writes, or the gamma). */
  private lutOf(type: SheetType, m: Mapping): Uint16Array {
    if (m.lut) return m.lut;
    const lut = new Uint16Array(0x8000);
    const [tr, tg, tb] = !m.table ? [] : m.table instanceof Uint8Array ? [m.table, m.table, m.table] : m.table;
    for (let c = 0; c < 0x8000; c++) {
      let v = m.unfaded ? m.unfaded(type, c) : m.tint ? m.tint(c) : c;
      if (m.faded) v = m.faded(type, v);
      else if (tr) v = tr[v & 31] | (tg![(v >> 5) & 31] << 5) | (tb![(v >> 10) & 31] << 10);
      lut[c] = v;
    }
    return (m.lut = lut);
  }

  /** Back to the colours as loaded (a map load reloads the OBJ palettes: InitObjectEventPalettes). */
  reset(): void {
    if (this.unfaded) {
      // (the palettes reloaded: what the quest log wrote over them is gone, its tint applies again)
      this.unfaded = undefined;
      this.mappings.clear();
    }
    this.tables = { normal: undefined, alt: undefined };
    this.faded = undefined;
    this.syncAll();
  }

  private syncSheet(key: string): void {
    const type = this.typeOf(key);
    if (!type) return;
    const m = this.mappingFor(type);
    const mapping = isIdentity(m) ? undefined : m;
    const sheet = this.sheets.get(key);
    if (sameMapping(sheet?.shown, mapping)) return;
    const s = sheet ?? (mapping ? this.toCanvas(key) : undefined);
    if (!s) return;
    const out = new ImageData(new Uint8ClampedArray(s.original.data), s.original.width, s.original.height);
    if (mapping) {
      const lut = this.lutOf(type, mapping);
      const d = out.data;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        const v = lut[(d[i] >> 3) | ((d[i + 1] >> 3) << 5) | ((d[i + 2] >> 3) << 10)];
        d[i] = EXPAND5[v & 31];
        d[i + 1] = EXPAND5[(v >> 5) & 31];
        d[i + 2] = EXPAND5[(v >> 10) & 31];
      }
    }
    s.context.putImageData(out, 0, 0);
    s.shown = mapping;
    this.textures.get(key).source[0].update(); // re-upload the canvas (WebGL)
  }

  /** Make a sheet's source a canvas with the same pixels, keeping its Texture (and so its frames and users). */
  private toCanvas(key: string): Shifted | undefined {
    if (!this.textures.exists(key)) return undefined;
    const source = this.textures.get(key).source[0];
    const image = source.image as HTMLImageElement | HTMLCanvasElement;
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const shifted: Shifted = { original: context.getImageData(0, 0, canvas.width, canvas.height), context, shown: undefined };
    source.image = canvas;
    source.isCanvas = true;
    this.sheets.set(key, shifted);
    return shifted;
  }

  /**
   * Dev: a pixel of a sheet (the first opaque coloured one, or the one at `index`): its colour now and as loaded, read
   * back from the texture's source.
   */
  pixel(key: string, index?: number): { now: number[]; original: number[]; index: number } | undefined {
    if (!this.textures.exists(key)) return undefined;
    const source = this.textures.get(key).source[0];
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(source.image as CanvasImageSource, 0, 0);
    const now = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const original = this.sheets.get(key)?.original.data ?? now;
    let i = index ?? -1;
    // (a coloured one: black stays black through every table)
    if (i < 0) for (let p = 0; p < original.length / 4 && i < 0; p++) if (original[p * 4 + 3] && original[p * 4] | original[p * 4 + 1] | original[p * 4 + 2]) i = p;
    if (i < 0) return undefined;
    return { now: [now[i * 4], now[i * 4 + 1], now[i * 4 + 2]], original: [original[i * 4], original[i * 4 + 1], original[i * 4 + 2]], index: i };
  }
}
