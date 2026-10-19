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

import Phaser from 'phaser';
import { expand5, type ChannelTables } from './weather';

type GammaType = 'normal' | 'alt';

interface Shifted {
  original: ImageData;
  context: CanvasRenderingContext2D;
  /** The tables the canvas shows now (undefined: the original). */
  table: ChannelTables | undefined;
}

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

  private constructor(
    private textures: Phaser.Textures.TextureManager,
    /** The field effect templates whose palette the weather shifts (FieldEffectScript_LoadFadedPalette). */
    private fadedFieldEffects: ReadonlySet<string>,
  ) {
    textures.on(Phaser.Textures.Events.ADD, (key: string) => this.syncSheet(key));
    textures.on(Phaser.Textures.Events.REMOVE, (key: string) => this.sheets.delete(key));
  }

  /** The gamma type of a texture the weather shifts, or undefined for one it leaves alone. */
  private typeOf(key: string): GammaType | undefined {
    if (key.startsWith('fldeff_obj_')) return this.fadedFieldEffects.has(key.slice('fldeff_obj_'.length)) ? 'normal' : undefined;
    if (!key.startsWith('spr_')) return undefined;
    return key.endsWith('_reflection') ? 'normal' : 'alt';
  }

  /** setObjPaletteGamma: redraw every sheet through its type's tables (undefined = as loaded). */
  setTables(normal: ChannelTables | undefined, alt: ChannelTables | undefined): void {
    if (this.tables.normal === normal && this.tables.alt === alt) return;
    this.tables = { normal, alt };
    for (const key of this.textures.getTextureKeys()) this.syncSheet(key);
  }

  /** Back to the colours as loaded (a map load reloads the OBJ palettes: InitObjectEventPalettes). */
  reset(): void {
    this.setTables(undefined, undefined);
  }

  private syncSheet(key: string): void {
    const type = this.typeOf(key);
    if (!type) return;
    const table = this.tables[type];
    const sheet = this.sheets.get(key);
    if ((sheet?.table ?? undefined) === table) return;
    const s = sheet ?? (table ? this.toCanvas(key) : undefined);
    if (!s) return;
    const out = new ImageData(new Uint8ClampedArray(s.original.data), s.original.width, s.original.height);
    if (table) {
      const [r, g, b] = table instanceof Uint8Array ? [table, table, table] : table;
      const d = out.data;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        d[i] = expand5(r[d[i] >> 3]);
        d[i + 1] = expand5(g[d[i + 1] >> 3]);
        d[i + 2] = expand5(b[d[i + 2] >> 3]);
      }
    }
    s.context.putImageData(out, 0, 0);
    s.table = table;
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
    const shifted: Shifted = { original: context.getImageData(0, 0, canvas.width, canvas.height), context, table: undefined };
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
