// pokemon.c's DrawSpindaSpots (src/pokemon/spindaSpots.ts) through decompress.c's LoadSpecialPokePic
// (battle/gfx.ts), and the Pokédex's Unown / Spinda personalities (HandleSetPokedexFlag, the save fields).
// The expected spots come from a pixel-coordinate model of the C's macro, not its byte addressing.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { DecompressPicFromTable, LoadSpecialPokePic, monPicSymbol } from '../../src/battle/gfx';
import type { SpindaSpot } from '../../src/data/types';
import { loadGfx, setGfxBase } from '../../src/gba/gfx';
import { FLAG_SET_CAUGHT, FLAG_SET_SEEN, HandleSetPokedexFlag } from '../../src/menus/pokedex';
import { drawSpindaSpotsWith } from '../../src/pokemon/spindaSpots';
import { fromSaveData, toSaveData, upgradeSave, type SaveData } from '../../src/state/saveData';
import { newBattleEnv, newGame, readGen, type TestGame } from './gameData';

const PUBLIC = resolve(__dirname, '../../public');
const spots = readGen<{ spindaSpots: SpindaSpot[] }>('pokemon/tables.json').spindaSpots;

/** The 4bpp tile data's pixel at (x, y) of a 64x64 pic (8x8 tiles, row-major; the low nibble is the left pixel). */
function pixelIndex(x: number, y: number): [number, boolean] {
  return [((y >> 3) * 8 + (x >> 3)) * 32 + (y & 7) * 4 + ((x & 7) >> 1), (x & 1) === 1];
}
function getPixel(buf: Uint8Array, x: number, y: number): number {
  const [i, high] = pixelIndex(x, y);
  return high ? buf[i] >> 4 : buf[i] & 0xf;
}
function setPixel(buf: Uint8Array, x: number, y: number, c: number): void {
  const [i, high] = pixelIndex(x, y);
  buf[i] = high ? (buf[i] & 0x0f) | (c << 4) : (buf[i] & 0xf0) | c;
}

/** DRAW_SPINDA_SPOTS by pixels: spot i at (x + nibble 2i - 8, y + nibble 2i+1 - 8), y as a u8; colours 1-3 → +4. */
function expectedSpots(pic: Uint8Array, personality: number): Uint8Array {
  const out = pic.slice(0, 0x800);
  spots.forEach((spot, i) => {
    const dx = ((personality >>> (8 * i)) & 0xf) - 8;
    const dy = ((personality >>> (8 * i + 4)) & 0xf) - 8;
    for (let r = 0; r < 16; r++) {
      const y = (spot.y + dy + r) & 0xff;
      if (y >= 64) continue; // past the 64x64 frame
      for (let c = 0; c < 16; c++) {
        if (!((spot.image[r] >> c) & 1)) continue;
        const x = spot.x + dx + c;
        const colour = getPixel(out, x, y);
        if (colour >= 1 && colour <= 3) setPixel(out, x, y, colour + 4);
      }
    }
  });
  return out;
}

function filled(colour: number): Uint8Array {
  return new Uint8Array(4 * 0x800).fill(colour | (colour << 4));
}

describe('DRAW_SPINDA_SPOTS', () => {
  test('the four spots are extracted from sSpindaSpotGraphics', () => {
    expect(spots.map((s) => [s.x, s.y])).toEqual([
      [16, 7],
      [40, 8],
      [22, 25],
      [34, 26],
    ]);
    expect(spots.every((s) => s.image.length === 16)).toBe(true);
    expect(spots[0].image[0]).toBe(0x0070); // spot_0.bin's first row
  });

  test.each([0x88888888, 0x12345678, 0xfedcba98, 0x0f0f0f0f, 0xa5c3e1f7])('personality %s: the spots at its nibbles', (p) => {
    for (const colour of [1, 2, 3]) {
      const buf = filled(colour);
      drawSpindaSpotsWith(spots, p, buf);
      expect(buf.subarray(0, 0x800)).toEqual(expectedSpots(filled(colour), p));
      // Something changed, only to colour + 4
      const pixels = new Set<number>();
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) pixels.add(getPixel(buf, x, y));
      expect([...pixels].sort()).toEqual([colour, colour + 4]);
    }
  });

  test('colours 0 and 4-15 are left alone', () => {
    for (const colour of [0, 4, 7, 8, 15]) {
      const buf = filled(colour);
      drawSpindaSpotsWith(spots, 0x12345678, buf);
      expect(buf).toEqual(filled(colour));
    }
  });

  test("spot 0's y nibble 0 wraps its first row past the frame (u8), the rest from row 0; a small buffer drops it", () => {
    const small = new Uint8Array(0x800).fill(0x11);
    drawSpindaSpotsWith(spots, 0x88888808, small); // spot 0 at y = 7 - 8
    expect(small).toEqual(expectedSpots(new Uint8Array(0x800).fill(0x11), 0x88888808));
    // Its second row (0x01fc: x 18-24 at a y nibble of 0, x nibble 8) is on pic row 0
    for (let x = 16; x < 32; x++) expect(getPixel(small, x, 0)).toBe((0x01fc >> (x - 16)) & 1 ? 5 : 1);
    // The 0x2000 buffer takes the wrapped row past the first frame (rows 255 → tile row 31), as the GBA's does
    const big = filled(1);
    drawSpindaSpotsWith(spots, 0x88888808, big);
    expect(big.subarray(0, 0x800)).toEqual(small);
    expect(big.subarray(0x800).some((b) => b !== 0x11)).toBe(true);
  });
});

/** Runs `fn` with fetch reading files under public/ (loadGfx fetches relative URLs). */
async function withLocalFetch<T>(fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const path = resolve(PUBLIC, String(url).replace(/^\//, ''));
    if (!existsSync(path)) return new Response(null, { status: 404 });
    return new Response(readFileSync(path));
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe('LoadSpecialPokePic', () => {
  let game: TestGame;
  beforeAll(async () => {
    game = await newBattleEnv();
    const spinda = game.d('SPECIES_SPINDA');
    await withLocalFetch(async () => {
      setGfxBase('gen');
      await loadGfx([monPicSymbol(true, spinda, 0), monPicSymbol(false, spinda, 0), monPicSymbol(true, game.d('SPECIES_PIKACHU'), 0)]);
    });
  });

  test("Spinda's front pic gets the personality's spots; its back pic and other species don't", () => {
    const spinda = game.d('SPECIES_SPINDA');
    const plain = new Uint8Array(4 * 0x800);
    DecompressPicFromTable(monPicSymbol(true, spinda, 0), plain);
    for (const p of [0x12345678, 0x88888888, 0xdeadbeef]) {
      const pic = new Uint8Array(4 * 0x800);
      LoadSpecialPokePic(true, spinda, p, pic);
      expect(pic.subarray(0, 0x800)).toEqual(expectedSpots(plain, p));
      expect(pic.subarray(0, 0x800)).not.toEqual(plain.subarray(0, 0x800));
    }
    const a = new Uint8Array(4 * 0x800);
    const b = new Uint8Array(4 * 0x800);
    LoadSpecialPokePic(true, spinda, 0x12345678, a);
    LoadSpecialPokePic(true, spinda, 0x87654321, b);
    expect(a).not.toEqual(b);
    const back = new Uint8Array(4 * 0x800);
    const plainBack = new Uint8Array(4 * 0x800);
    LoadSpecialPokePic(false, spinda, 0x12345678, back);
    DecompressPicFromTable(monPicSymbol(false, spinda, 0), plainBack);
    expect(back).toEqual(plainBack);
    const pikachu = game.d('SPECIES_PIKACHU');
    const pk = new Uint8Array(4 * 0x800);
    const plainPk = new Uint8Array(4 * 0x800);
    LoadSpecialPokePic(true, pikachu, 0x12345678, pk);
    DecompressPicFromTable(monPicSymbol(true, pikachu, 0), plainPk);
    expect(pk).toEqual(plainPk);
  });
});

describe('the Pokédex personalities (HandleSetPokedexFlag)', () => {
  let t: TestGame;
  beforeEach(() => {
    t = newGame();
  });
  const dex = (name: string) => t.pokemon.nationalDex(t.d(`SPECIES_${name}`));

  test('the first Unown / Spinda seen keeps its personality; later ones do not', () => {
    expect(t.state.dexUnownPersonality).toBe(0);
    expect(t.state.dexSpindaPersonality).toBe(0);
    HandleSetPokedexFlag(t.state, dex('UNOWN'), FLAG_SET_SEEN, 0xdeadbeef);
    HandleSetPokedexFlag(t.state, dex('UNOWN'), FLAG_SET_SEEN, 0x11111111);
    HandleSetPokedexFlag(t.state, dex('SPINDA'), FLAG_SET_SEEN, 0x12345678);
    HandleSetPokedexFlag(t.state, dex('SPINDA'), FLAG_SET_SEEN, 0x22222222);
    HandleSetPokedexFlag(t.state, dex('PIKACHU'), FLAG_SET_SEEN, 0x33333333);
    expect(t.state.dexSeen.has(dex('UNOWN'))).toBe(true);
    expect(t.state.dexUnownPersonality).toBe(0xdeadbeef);
    expect(t.state.dexSpindaPersonality).toBe(0x12345678);
  });

  test('the first one caught replaces it (FLAG_SET_CAUGHT checks the caught flag)', () => {
    HandleSetPokedexFlag(t.state, dex('SPINDA'), FLAG_SET_SEEN, 0x12345678);
    HandleSetPokedexFlag(t.state, dex('SPINDA'), FLAG_SET_CAUGHT, 0x9abcdef0);
    expect(t.state.dexCaught.has(dex('SPINDA'))).toBe(true);
    expect(t.state.dexSpindaPersonality).toBe(0x9abcdef0);
    HandleSetPokedexFlag(t.state, dex('SPINDA'), FLAG_SET_CAUGHT, 0x1);
    expect(t.state.dexSpindaPersonality).toBe(0x9abcdef0);
  });

  test('they round-trip through the save; a version 14 save loads with 0', () => {
    t.state.dexUnownPersonality = 0xfedcba98;
    t.state.dexSpindaPersonality = 0x01234567;
    const data = JSON.parse(JSON.stringify(toSaveData(t.state))) as SaveData;
    expect(data.pokedex).toMatchObject({ unownPersonality: 0xfedcba98, spindaPersonality: 0x01234567 });
    const loaded = fromSaveData(data, newGame().state);
    expect([loaded.dexUnownPersonality, loaded.dexSpindaPersonality]).toEqual([0xfedcba98, 0x01234567]);
    const { unownPersonality: _u, spindaPersonality: _s, ...oldDex } = data.pokedex;
    const v14 = { ...data, version: 14, pokedex: oldDex } as unknown as SaveData;
    const upgraded = upgradeSave(v14);
    expect(upgraded.pokedex).toMatchObject({ unownPersonality: 0, spindaPersonality: 0 });
    const loaded14 = fromSaveData(v14, newGame().state);
    expect([loaded14.dexUnownPersonality, loaded14.dexSpindaPersonality]).toEqual([0, 0]);
  });
});
