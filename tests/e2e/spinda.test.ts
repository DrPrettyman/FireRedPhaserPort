// Spinda's spots (pokemon.c's DrawSpindaSpots through decompress.c's LoadSpecialPokePic, src/pokemon/spindaSpots.ts)
// on the screens that load a front pic with a personality: a wild Spinda in battle (its sprite's tiles in OBJ
// VRAM), a party Spinda's summary screen; and the Pokédex's personalities (HandleSetPokedexFlag: the first Unown /
// Spinda seen), which its mon page draws them with (DexScreen_GetDefaultPersonality). The expected pics come from
// a pixel model of the C's macro written out here, applied to the plain pic.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const P_BATTLE = 0x12345678;
const P_LATER = 0xdeadbeef;
const P_PARTY = 0x88888888;
// GET_UNOWN_LETTER: bits 0-1 | 8-9 << 2 | 16-17 << 4 | 24-25 << 6, % 28: 0x0101 → 1 | 1 << 2 = 5, F
const P_UNOWN_F = 0x00000101;

/** In the page: the modules the checks read, and the spot model (window.__sp). */
async function installHelpers(game: Game) {
  await game.eval(async () => {
    const imp = (p: string) => new Function(`return import('${p}')`)();
    const [env, gfx, hw, spr, win] = await Promise.all([imp('/src/battle/env.ts'), imp('/src/gba/gfx.ts'), imp('/src/gba/hw.ts'), imp('/src/gba/sprite.ts'), imp('/src/gba/window.ts')]);
    const idx = (x: number, y: number, widthTiles: number): [number, boolean] => [((y >> 3) * widthTiles + (x >> 3)) * 32 + (y & 7) * 4 + ((x & 7) >> 1), (x & 1) === 1];
    const get = (b: Uint8Array, x: number, y: number, w = 8) => {
      const [i, hi] = idx(x, y, w);
      return hi ? b[i] >> 4 : b[i] & 0xf;
    };
    const set = (b: Uint8Array, x: number, y: number, c: number) => {
      const [i, hi] = idx(x, y, 8);
      b[i] = hi ? (b[i] & 0x0f) | (c << 4) : (b[i] & 0xf0) | c;
    };
    /** DRAW_SPINDA_SPOTS by pixels: spot i at its base + personality nibbles 2i / 2i+1 - 8 (y as a u8); colours 1-3 → +4. */
    const spotted = (plain: Uint8Array, p: number): Uint8Array => {
      const out = plain.slice(0, 0x800);
      (env.pokemon.tables.spindaSpots as { x: number; y: number; image: number[] }[]).forEach((spot, i) => {
        const dx = ((p >>> (8 * i)) & 0xf) - 8;
        const dy = ((p >>> (8 * i + 4)) & 0xf) - 8;
        for (let r = 0; r < 16; r++) {
          const y = (spot.y + dy + r) & 0xff;
          if (y >= 64) continue;
          for (let c = 0; c < 16; c++) {
            if (!((spot.image[r] >> c) & 1)) continue;
            const colour = get(out, spot.x + dx + c, y);
            if (colour >= 1 && colour <= 3) set(out, spot.x + dx + c, y, colour + 4);
          }
        }
      });
      return out;
    };
    const plainPic = async (species: number) => {
      const sym = env.bdata.anims.monFrontPics[species] as string;
      await gfx.loadGfx([sym]);
      return gfx.gfx(sym) as Uint8Array;
    };
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
    /** A visible sprite whose tiles in OBJ VRAM are `pic`. */
    const spriteShows = (pic: Uint8Array) =>
      (spr.gSprites as { inUse: boolean; invisible: boolean; images: unknown; oam: { tileNum: number } }[]).some(
        (s) => s.inUse && !s.invisible && s.images && same(hw.vram.subarray(hw.OBJ_VRAM0 + s.oam.tileNum * 32, hw.OBJ_VRAM0 + s.oam.tileNum * 32 + 0x800), pic),
      );
    /** A window whose top-left 64x64 has `pic`'s opaque pixels (BlitBitmapRectToWindow skips colour 0). */
    const windowShows = (pic: Uint8Array) =>
      (win.gWindows as { tileData: Uint8Array | null; window: { width: number; height: number } }[]).some((w) => {
        if (!w.tileData || w.window.width < 8 || w.window.height < 8) return false;
        for (let y = 0; y < 64; y++)
          for (let x = 0; x < 64; x++) {
            const c = get(pic, x, y);
            if (c && get(w.tileData, x, y, w.window.width) !== c) return false;
          }
        return true;
      });
    Object.assign(window, { __sp: { env, spotted, plainPic, same, spriteShows, windowShows } });
  });
}

/** A wild Spinda at `personality`: whether its spots change the pic, a visible sprite shows them, and the Pokédex personality. */
async function wildBattleShows(game: Game, personality: number) {
  await game.eval((t, personality) => t.startWildBattle({ species: 'SPINDA', level: 5, personality }), personality);
  await game.waitForActionMenu();
  return game.eval(
    async (t, personality) => {
      const sp = (window as unknown as { __sp: any }).__sp;
      const spinda = t.define('SPECIES_SPINDA');
      const plain = await sp.plainPic(spinda);
      const pic = sp.spotted(plain, personality);
      return { differs: !sp.same(pic, plain.subarray(0, 0x800)), shown: await t.until(() => sp.spriteShows(pic), 120), seen: t.state!.dexSpindaPersonality >>> 0 };
    },
    personality,
  );
}

async function runAway(game: Game) {
  await game.chooseAction('RUN');
  await game.mashUntil((t) => t.idle() && !t.battle(), { what: 'back on the field' });
}

test('a wild Spinda has its spots in battle; the Pokédex keeps the first Spinda and Unown seen and draws them', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14, party: [{ species: 'MEWTWO', level: 100 }] });
  await installHelpers(game);
  // The National Dex, for the A TO Z list to show Spinda (#327) and Unown (#201); nothing seen yet
  await game.eval((t) => {
    const s = t.state!;
    s.dexSeen.clear();
    s.dexCaught.clear();
    s.setFlag('FLAG_SYS_POKEDEX_GET', true);
    s.nationalDexEnabled = true;
    s.setVar('VAR_NATIONAL_DEX', 0x6258);
    s.setFlag('FLAG_SYS_NATIONAL_DEX', true);
  });

  // First Spinda: its spots in battle, and the Pokédex keeps its personality
  let r = await wildBattleShows(game, P_BATTLE);
  expect(r.differs, 'the spots change the pic').toBe(true);
  expect(r.shown, "the foe's sprite shows the spots").toBe(true);
  expect(r.seen).toBe(P_BATTLE);
  await runAway(game);
  // A second one: its own spots, but the Pokédex keeps the first
  r = await wildBattleShows(game, P_LATER);
  expect(r.shown, "the second Spinda's spots").toBe(true);
  expect(r.seen).toBe(P_BATTLE);
  await runAway(game);
  // An Unown F: its letter's pic in battle, the Pokédex keeps the personality
  await game.eval((t, p) => t.startWildBattle({ species: 'UNOWN', level: 5, personality: p }), P_UNOWN_F);
  await game.waitForActionMenu();
  expect(await game.eval((t) => t.state!.dexUnownPersonality >>> 0)).toBe(P_UNOWN_F);
  await runAway(game);

  // The Pokédex: A TO Z lists SPINDA, UNOWN; each mon page draws the kept personality
  await game.press('START');
  await game.eval((t) => t.until(() => !!t.startMenu()));
  expect(await game.eval((t) => t.startMenu()!.items[t.startMenu()!.cursor])).toBe('POKEDEX');
  await game.press('A');
  await game.waitFor((t) => t.gbaScreen() === 'CB2_PokedexScreen' && t.pokedex()?.task === 'Task_PokedexScreen' && !!t.pokedex()?.ready, { what: 'the Pokédex' });
  const DEX_MODE_ATOZ = 10;
  for (let i = 0; i < 20 && (await game.eval((t) => t.pokedex()!.modeSelect?.selected)) !== DEX_MODE_ATOZ; i++) await game.press('DOWN');
  await game.press('A');
  await game.eval((t) => t.until(() => t.pokedex()?.task === 'Task_DexScreen_CharacteristicOrder' && !!t.pokedex()?.ready));
  const spinda = await game.eval((t) => t.define('SPECIES_SPINDA'));
  const unown = await game.eval((t) => t.define('SPECIES_UNOWN'));
  expect((await game.eval((t) => t.pokedex()!.orderedList!.items))).toEqual([spinda, unown]);
  const monPageShows = (species: number, which: 'spinda' | 'unown') =>
    game.eval(
      async (t, species, which, pBattle, pUnown) => {
        const sp = (window as unknown as { __sp: any }).__sp;
        let pic: Uint8Array;
        let other: Uint8Array;
        if (which === 'spinda') {
          const plain = await sp.plainPic(species);
          pic = sp.spotted(plain, pBattle);
          other = plain;
        } else {
          // GET_UNOWN_LETTER, worked out here; the letters after Unown A are past NUM_SPECIES
          const letter = ((((pUnown >>> 24) & 3) << 6) | (((pUnown >>> 16) & 3) << 4) | (((pUnown >>> 8) & 3) << 2) | (pUnown & 3)) % 28;
          pic = await sp.plainPic(t.define('NUM_SPECIES') + letter);
          other = await sp.plainPic(species);
        }
        // The habitat page (A on a search list) or the mon page, whichever is up
        const up = await t.until(() => !!t.pokedex()?.ready && sp.windowShows(pic));
        return { up, notOther: !sp.windowShows(other), monPage: t.pokedex()?.monPage?.species ?? null };
      },
      species,
      which,
      P_BATTLE,
      P_UNOWN_F,
    );
  // A on a search list: the habitat page (its slot's pic), then A: the mon page
  await game.press('A');
  expect(await monPageShows(spinda, 'spinda'), "Spinda's habitat page: the first one's spots").toEqual({ up: true, notOther: true, monPage: null });
  await game.screenshot('spinda-pokedex-habitat');
  await game.press('A');
  await game.eval((t, species) => t.until(() => t.pokedex()?.monPage?.species === species && !!t.pokedex()?.ready), spinda);
  expect(await monPageShows(spinda, 'spinda'), "Spinda's mon page: the first one's spots").toEqual({ up: true, notOther: true, monPage: spinda });
  await game.screenshot('spinda-pokedex');
  // Back to the list, DOWN to Unown, A: its habitat page with the F
  await game.press('B');
  await game.eval((t) => t.until(() => !t.pokedex()?.monPage && !!t.pokedex()?.ready));
  await game.press('B');
  await game.eval((t) => t.until(() => t.pokedex()?.task === 'Task_DexScreen_CharacteristicOrder' && !!t.pokedex()?.ready));
  await game.press('DOWN');
  await game.press('A');
  expect(await monPageShows(unown, 'unown'), "Unown's habitat page: the F").toEqual({ up: true, notOther: true, monPage: null });
  await game.screenshot('unown-pokedex-habitat');
}, 300_000);

test("a party Spinda's summary screen shows its spots", async () => {
  const game = await session.start({
    start: 'after-rival',
    map: 'PalletTown',
    x: 12,
    y: 14,
    party: [
      { species: 'MEWTWO', level: 100 },
      { species: 'SPINDA', level: 20, personality: P_PARTY },
    ],
  });
  await installHelpers(game);
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.until(() => !!t.startMenu()));
  for (let i = 0; i < 8 && (await game.eval((t) => t.startMenu()!.items[t.startMenu()!.cursor])) !== 'POKEMON'; i++) await game.press('DOWN');
  await game.press('A');
  await game.waitForPartyMenu();
  await game.press('DOWN'); // slot 1
  await game.press('A');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // SUMMARY
  await game.waitForScreen('CB2_RunPokemonSummaryScreen');
  const r = await game.eval(async (t, p) => {
    const sp = (window as unknown as { __sp: any }).__sp;
    const plain = await sp.plainPic(t.define('SPECIES_SPINDA'));
    const pic = sp.spotted(plain, p);
    return { differs: !sp.same(pic, plain.subarray(0, 0x800)), shown: await t.until(() => sp.spriteShows(pic), 600), plainShown: sp.spriteShows(plain.subarray(0, 0x800)) };
  }, P_PARTY);
  expect(r).toEqual({ differs: true, shown: true, plainShown: false });
  await game.screenshot('spinda-summary');
}, 180_000);
