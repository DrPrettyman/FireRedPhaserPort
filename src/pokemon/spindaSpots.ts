// pokemon.c's DrawSpindaSpots (the DRAW_SPINDA_SPOTS macro): Spinda's four spots, drawn on its front pic by
// decompress.c's LoadSpecialPokePic (battle/gfx.ts) after the pic is decompressed. The spot data
// (sSpindaSpotGraphics: base x / y and a 16x16 bit image each) is extracted into pokemon/tables.json.

import { K } from '../battle/constants';
import { pokemon } from '../battle/env';
import type { SpindaSpot } from '../data/types';

/** SPINDA_SPOT_WIDTH / SPINDA_SPOT_HEIGHT (pokemon.h) */
const SPINDA_SPOT_WIDTH = 16;
const SPINDA_SPOT_HEIGHT = 16;
// Spots can be drawn on Spinda's color indexes 1, 2, or 3; a spot pixel adds 4 to the color index.
const FIRST_SPOT_COLOR = 1;
const LAST_SPOT_COLOR = 3;
const SPOT_COLOR_ADJUSTMENT = 4;
const TILE_SIZE_4BPP = 32;

/**
 * DRAW_SPINDA_SPOTS(personality, dest): each spot i uses personality byte i, its low nibble for x and its high nibble
 * for y (base + nibble - 8, as u8 like the C: spot 0's y wraps to 255 for a nibble of 0, so its first row lands past
 * the 64x64 frame). A spot pixel turns colour 1-3 of the 4bpp tile data into 5-7. Writes past `dest` are dropped
 * (the C's 0x2000-byte sprite buffers take them, outside the first frame).
 */
export function drawSpindaSpotsWith(spots: readonly SpindaSpot[], personality: number, dest: Uint8Array): void {
  let p = personality >>> 0;
  for (const spot of spots) {
    const x = (spot.x + ((p & 0x0f) - 8)) & 0xff;
    let y = (spot.y + (((p & 0xf0) >> 4) - 8)) & 0xff;
    for (let row = 0; row < SPINDA_SPOT_HEIGHT; row++) {
      let spotPixelRow = spot.image[row] ?? 0;
      for (let column = x; column < x + SPINDA_SPOT_WIDTH; column++) {
        // Target pixels on Spinda's sprite: one byte holds two pixels (the low nibble is the left one)
        const i = ((column / 8) | 0) * TILE_SIZE_4BPP + (((column % 8) / 2) | 0) + ((y / 8) | 0) * TILE_SIZE_4BPP * 8 + (y % 8) * 4;
        if (spotPixelRow & 1 && i < dest.length) {
          if (column & 1) {
            if ((((dest[i] & 0xf0) - (FIRST_SPOT_COLOR << 4)) & 0xff) <= (LAST_SPOT_COLOR - FIRST_SPOT_COLOR) << 4) dest[i] = (dest[i] + (SPOT_COLOR_ADJUSTMENT << 4)) & 0xff;
          } else if ((((dest[i] & 0xf) - FIRST_SPOT_COLOR) & 0xff) <= LAST_SPOT_COLOR - FIRST_SPOT_COLOR) {
            dest[i] = (dest[i] + SPOT_COLOR_ADJUSTMENT) & 0xff;
          }
        }
        spotPixelRow >>= 1;
      }
      y = (y + 1) & 0xff;
    }
    p >>>= 8;
  }
}

/** DrawSpindaSpots: only Spinda's front pic gets spots. */
export function DrawSpindaSpots(species: number, personality: number, dest: Uint8Array, isFrontPic: boolean): void {
  if (species === K.SPECIES_SPINDA && isFrontPic) drawSpindaSpotsWith(pokemon.tables.spindaSpots, personality, dest);
}
