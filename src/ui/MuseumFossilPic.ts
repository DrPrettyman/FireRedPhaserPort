import Phaser from 'phaser';
import { gfx, gfx16 } from '../gba/gfx';
import type { Input } from '../input/Input';
import { registerSpecials } from '../script/specials';
import type { Fonts } from '../text/Font';
import { DEPTH_UI, MenuWindow } from './MenuWindow';

/**
 * The Pewter Museum's fossil pics (script_menu.c): OpenMuseumFossilPic / CloseMuseumFossilPic and
 * Task_WaitMuseumFossilPic. Like ScriptMenu_ShowPokemonPic (ui/MonPicBox.ts), an 8x8-tile std-framed window at
 * tile (x+1, y+1) with a 64x64 sprite centred on it at (8x+40, 8y+40), but the sprite is
 * graphics/script_menu/{kabutops,aerodactyl}_fossil (sMuseumKabutopsSprTiles, ...; OBJ palette 13) and the
 * special only works for SPECIES_KABUTOPS / SPECIES_AERODACTYL.
 */

const FOSSIL_GFX: Record<string, { tiles: string; pal: string }> = {
  SPECIES_KABUTOPS: { tiles: 'sMuseumKabutopsSprTiles', pal: 'sMuseumKabutopsSprPalette' },
  SPECIES_AERODACTYL: { tiles: 'sMuseumAerodactylSprTiles', pal: 'sMuseumAerodactylSprPalette' },
};

/** Preload these before the field runs (OverworldScene's loadGfx). */
export const museumFossilPicGfxSymbols = Object.values(FOSSIL_GFX).flatMap((g) => [g.tiles, g.pal]);

export interface MuseumFossilPicHost {
  scene: Phaser.Scene;
  fonts: Fonts;
  input: Input;
}

/** Task_WaitMuseumFossilPic's data (tState, tWindowId, tSpriteId). */
interface FossilPicTask {
  tState: number;
  window?: MenuWindow;
  sprite?: Phaser.GameObjects.Image;
  species: string;
}

/** The running Task_WaitMuseumFossilPic (FindTaskIdByFunc), or undefined. */
let sTask: FossilPicTask | undefined;

/** A 64x64 1D-mapped 4bpp OBJ (8x8 tiles in rows of eight) in its 16-colour palette, as a texture. */
function fossilTexture(scene: Phaser.Scene, tilesSym: string, palSym: string): string {
  const key = `museum_fossil_${tilesSym}`;
  if (scene.textures.exists(key)) return key;
  const tiles = gfx(tilesSym);
  const pal = gfx16(palSym);
  const tex = scene.textures.createCanvas(key, 64, 64)!;
  const img = tex.context.createImageData(64, 64);
  const ch = (v: number) => (v << 3) | (v >> 2);
  for (let t = 0; t < 64; t++) {
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const byte = tiles[t * 32 + py * 4 + (px >> 1)];
        const ci = px & 1 ? byte >> 4 : byte & 0xf;
        if (ci === 0) continue;
        const c = pal[ci];
        const o = (((t >> 3) * 8 + py) * 64 + (t & 7) * 8 + px) * 4;
        img.data[o] = ch(c & 0x1f);
        img.data[o + 1] = ch((c >> 5) & 0x1f);
        img.data[o + 2] = ch((c >> 10) & 0x1f);
        img.data[o + 3] = 255;
      }
    }
  }
  tex.context.putImageData(img, 0, 0);
  tex.refresh();
  return key;
}

/**
 * Registers the two specials with the field's scene (call once per OverworldScene, after its fonts exist).
 * The task runs as a field task, so it outlives the script (CloseMuseumFossilPic is followed by `releaseall`,
 * and the task tears the pic down over the next two frames).
 */
export function registerMuseumFossilPic(field: MuseumFossilPicHost): void {
  sTask = undefined; // a new scene: the old one's task and objects are gone
  registerSpecials({
    /**
     * OpenMuseumFossilPic: VAR_0x8004 = SPECIES_KABUTOPS / SPECIES_AERODACTYL, VAR_0x8005 / 0x8006 = the window's
     * tile x / y (minus one). Returns FALSE if a pic is already up or the species has no fossil pic.
     * (QL_AvoidDisplay: the quest log isn't played back, so it never avoids the display.)
     */
    OpenMuseumFossilPic({ state, host }) {
      if (sTask) return 0;
      const d = state.defines;
      const species = Object.keys(FOSSIL_GFX).find((s) => d.require(s) === state.getVar('VAR_0x8004'));
      if (!species) return 0;
      const x = state.getVar('VAR_0x8005');
      const y = state.getVar('VAR_0x8006');
      const { tiles, pal } = FOSSIL_GFX[species];
      const task: FossilPicTask = { tState: 0, species };
      // CreateSprite(&sMuseumFossilSprTemplate, x * 8 + 40, y * 8 + 40, 0): the sprite's centre
      task.sprite = field.scene.add
        .image(x * 8 + 40, y * 8 + 40, fossilTexture(field.scene, tiles, pal))
        .setScrollFactor(0)
        .setDepth(DEPTH_UI + 12);
      // CreateWindowFromRect(x, y, 8, 8) + SetStdWindowBorderStyle
      task.window = new MenuWindow(field.scene, { left: x + 1, top: y + 1, width: 8, height: 8 }, field.fonts, field.input);
      task.window.flush();
      sTask = task;
      host.startFieldTask({ tick: () => Task_WaitMuseumFossilPic(task) });
      return 1;
    },

    /** CloseMuseumFossilPic: the task tears the pic down (sprite, then window). FALSE if none is up. */
    CloseMuseumFossilPic() {
      if (!sTask) return 0;
      sTask.tState++;
      return 1;
    },
  });
}

/** Task_WaitMuseumFossilPic: true once the task is destroyed. */
function Task_WaitMuseumFossilPic(task: FossilPicTask): boolean {
  switch (task.tState) {
    case 0:
      task.tState++;
      break;
    case 1:
      break;
    case 2:
      // DestroySprite + FreeSpriteTilesByTag(GFXTAG_FOSSIL)
      task.sprite?.destroy();
      task.sprite = undefined;
      task.tState++;
      break;
    case 3:
      // DestroyScriptMenuWindow
      task.window?.destroy();
      task.window = undefined;
      if (sTask === task) sTask = undefined;
      return true;
  }
  return false;
}

/** Test probe: the fossil pic that's up (species, task state, whether its sprite and window are still drawn). */
export function museumFossilPicProbe(): { species: string; state: number; sprite: boolean; window: boolean; x?: number; y?: number } | undefined {
  if (!sTask) return undefined;
  return { species: sTask.species, state: sTask.tState, sprite: !!sTask.sprite, window: !!sTask.window, x: sTask.sprite?.x, y: sTask.sprite?.y };
}
