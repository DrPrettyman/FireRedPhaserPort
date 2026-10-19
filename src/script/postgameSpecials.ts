// The postgame's specials (W-sevii, POSTGAME_PLAN.md), spread into SPECIALS: field_specials.c's
// BrailleCursorToggle (the braille messages' cursor, `braillemessage_wait`), UpdateLoreleiDollCollection and
// StickerManGetBragFlags (Four Island), field_tasks.c's SetIcefallCaveCrackedIceMetatiles (world/fieldTasks.ts),
// Six Island's Heracross record (pokemon_size_record.c, in pokemonSizeRecord.ts). The braille commands themselves
// (`braillemessage`, `getbraillestringwidth`) are in ScriptEngine.ts. No Phaser import here: the cursor is drawn
// through the field's scene (ScriptHost.listMenuHost()).

import type Phaser from 'phaser';
import { gfx, gfx16 } from '../gba/gfx';
import { DEPTH_UI } from '../text/TextWindow';
import type { FieldTask } from '../world/elevator';
import { SetIcefallCaveCrackedIceMetatiles } from '../world/fieldTasks';
import { CompareHeracrossSize, GetHeracrossSizeRecordInfo } from './pokemonSizeRecord';
import type { Special } from './specials';

/** text.c's CURSOR_DELAY: frames between the cursor's bob steps. */
const CURSOR_DELAY = 8;

/** CreateTextCursorSprite's sheet 0 and palette (text.c sSpriteSheets_TextCursor[0], sSpritePalettes_TextCursor). */
export const brailleCursorGfxSymbols = ['sDoubleArrowTiles1', 'gStandardMenuPalette'];

/** The text cursor sprite on the field: struct Sprite's x, y, y2 and data[0] (sDelay), data[1] (sState). */
export interface FieldTextCursor {
  x: number;
  y: number;
  y2: number;
  sDelay: number;
  sState: number;
  destroyed: boolean;
  image?: Phaser.GameObjects.Image;
}

/** sBrailleTextCursorSpriteID (field_specials.c): the cursor BrailleCursorToggle made last. */
let sBrailleTextCursor: FieldTextCursor | undefined;

/** SpriteCB_TextCursor (text.c): y2 steps 0, 1, 2, 1 every CURSOR_DELAY + 1 frames. */
export function SpriteCB_TextCursor(sprite: FieldTextCursor): void {
  if (sprite.sDelay) {
    sprite.sDelay--;
    return;
  }
  sprite.sDelay = CURSOR_DELAY;
  switch (sprite.sState) {
    case 0:
      sprite.y2 = 0;
      break;
    case 1:
      sprite.y2 = 1;
      break;
    case 2:
      sprite.y2 = 2;
      break;
    case 3:
      sprite.y2 = 1;
      sprite.sState = 0;
      return;
  }
  sprite.sState++;
}

/** sDoubleArrowTiles1 in gStandardMenuPalette: a 16x16 1D-mapped 4bpp OBJ (four tiles), as a texture. */
function textCursorTexture(scene: Phaser.Scene): string {
  const key = 'field_text_cursor';
  if (scene.textures.exists(key)) return key;
  const tiles = gfx('sDoubleArrowTiles1');
  const pal = gfx16('gStandardMenuPalette');
  const tex = scene.textures.createCanvas(key, 16, 16)!;
  const img = tex.context.createImageData(16, 16);
  const ch = (v: number) => (v << 3) | (v >> 2);
  for (let t = 0; t < 4; t++) {
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const byte = tiles[t * 32 + py * 4 + (px >> 1)];
        const ci = px & 1 ? byte >> 4 : byte & 0xf;
        if (ci === 0) continue;
        const c = pal[ci];
        const o = (((t >> 1) * 8 + py) * 16 + (t & 1) * 8 + px) * 4;
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
 * CreateTextCursorSprite(0, x, y, 0, 0) on the field: the sprite's centre at (x + 3, y + 4), its callback run once
 * a frame (AnimateSprites) by a field task until DestroyTextCursorSprite. `scene` undefined: no drawing (unit tests).
 */
export function CreateFieldTextCursor(scene: Phaser.Scene | undefined, startFieldTask: (task: FieldTask) => void, x: number, y: number): FieldTextCursor {
  const sprite: FieldTextCursor = { x: (x + 3) & 0xffff, y: (y + 4) & 0xffff, y2: 0, sDelay: CURSOR_DELAY, sState: 0, destroyed: false };
  // OBJ priority 0 over the message box (BG0), centred (the 16x16 sprite's centerToCornerVec)
  sprite.image = scene?.add.image(sprite.x, sprite.y, textCursorTexture(scene)).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH_UI + 5);
  startFieldTask({
    tick: () => {
      if (sprite.destroyed) return true;
      SpriteCB_TextCursor(sprite);
      sprite.image?.setPosition(sprite.x, sprite.y + sprite.y2);
      return false;
    },
  });
  return sprite;
}

/** DestroyTextCursorSprite */
export function DestroyFieldTextCursor(sprite: FieldTextCursor): void {
  sprite.destroyed = true;
  sprite.image?.destroy();
  sprite.image = undefined;
}

/** Test probe: the braille cursor that's up (its sprite position and y2), or undefined. */
export function brailleCursorProbe(): { x: number; y: number; y2: number } | undefined {
  const s = sBrailleTextCursor;
  return s && !s.destroyed ? { x: s.x, y: s.y, y2: s.y2 } : undefined;
}

export const POSTGAME_SPECIALS: Record<string, Special> = {
  /**
   * BrailleCursorToggle (field_specials.c): VAR_0x8006 0 creates the text cursor at (VAR_0x8004 + 27, VAR_0x8005)
   * (VAR_0x8004 = the message's width from getbraillestringwidth), 1 destroys it. (The quest log's playback, which
   * skips it, isn't ported.)
   */
  BrailleCursorToggle({ state, host }) {
    const x = (state.getVar('VAR_0x8004') + 27) & 0xffff;
    if (state.getVar('VAR_0x8006') === 0) {
      const lm = host.listMenuHost?.();
      sBrailleTextCursor = CreateFieldTextCursor(lm?.scene, (task) => host.startFieldTask(task), x, state.getVar('VAR_0x8005'));
    } else if (sBrailleTextCursor) {
      DestroyFieldTextCursor(sBrailleTextCursor);
    }
  },
  /** SetIcefallCaveCrackedIceMetatiles (field_tasks.c; FourIsland_IcefallCave_1F's ON_LOAD) */
  SetIcefallCaveCrackedIceMetatiles({ state, host }) {
    SetIcefallCaveCrackedIceMetatiles(state, (x, y, metatile) => host.setMetatile(x, y, metatile, false));
  },

  /**
   * UpdateLoreleiDollCollection (field_specials.c; FourIsland_LoreleisHouse's ON_TRANSITION): from 25 Hall of Fame
   * entries (GAME_STAT_ENTERED_HOF) on, one more doll every 25, up to the Lapras doll at 200.
   */
  UpdateLoreleiDollCollection({ state }) {
    const numHofClears = state.getGameStat(state.defines.require('GAME_STAT_ENTERED_HOF'));
    if (numHofClears < 25) return;
    state.setFlag('FLAG_HIDE_LORELEI_HOUSE_MEOWTH_DOLL', false);
    const dolls: [number, string][] = [
      [50, 'FLAG_HIDE_LORELEI_HOUSE_CHANSEY_DOLL'],
      [75, 'FLAG_HIDE_LORELEIS_HOUSE_NIDORAN_F_DOLL'],
      [100, 'FLAG_HIDE_LORELEI_HOUSE_JIGGLYPUFF_DOLL'],
      [125, 'FLAG_HIDE_LORELEIS_HOUSE_NIDORAN_M_DOLL'],
      [150, 'FLAG_HIDE_LORELEIS_HOUSE_FEAROW_DOLL'],
      [175, 'FLAG_HIDE_LORELEIS_HOUSE_PIDGEOT_DOLL'],
      [200, 'FLAG_HIDE_LORELEIS_HOUSE_LAPRAS_DOLL'],
    ];
    for (const [n, flag] of dolls) if (numHofClears >= n) state.setFlag(flag, false);
  },

  /**
   * StickerManGetBragFlags (field_specials.c; FourIsland_House2_EventScript_StickerMan's `specialvar VAR_0x8008`):
   * VAR_0x8004 = Hall of Fame entries, VAR_0x8005 = eggs hatched (capped at 0xFFFF), VAR_0x8006 = link battle wins;
   * bit 0, 1, 2 set for each that isn't 0.
   */
  StickerManGetBragFlags({ state }) {
    const stat = (name: string) => state.getGameStat(state.defines.require(name));
    state.setVar('VAR_0x8004', stat('GAME_STAT_ENTERED_HOF'));
    const numEggs = stat('GAME_STAT_HATCHED_EGGS');
    state.setVar('VAR_0x8006', stat('GAME_STAT_LINK_BATTLE_WINS'));
    state.setVar('VAR_0x8005', numEggs > 0xffff ? 0xffff : numEggs);
    let result = 0;
    if (state.getVar('VAR_0x8004') !== 0) result |= 1 << 0;
    if (state.getVar('VAR_0x8005') !== 0) result |= 1 << 1;
    if (state.getVar('VAR_0x8006') !== 0) result |= 1 << 2;
    return result;
  },

  // W-sevii unit 3, Six Island: the Water Path beauty's Heracross record (pokemon_size_record.c)
  GetHeracrossSizeRecordInfo,
  CompareHeracrossSize,
};
