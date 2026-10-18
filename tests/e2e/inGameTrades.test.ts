// In-game trades (trade_scene.c's specials, script/tradeSpecials.ts, and its scene, menus/tradeScene.ts) on Route
// 2's trade (Reyley: Abra for Mr. Mime, INGAME_TRADE_MR_MIME), and Lavender Town's Name Rater.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** Route2_House: Reyley stands at (7, 2) facing down; talk to him from below. */
const REYLEY = { start: 'after-rival' as const, map: 'Route2_House', x: 7, y: 3 };
/** LavenderTown_House2: the Name Rater at (4, 4); talk to him from below. */
const NAME_RATER = { start: 'after-rival' as const, map: 'LavenderTown_House2', x: 4, y: 5 };

/**
 * Talk to the NPC above and mash A (pressing `answers` while their message shows) until `until` holds, collecting
 * every field message seen on the way.
 */
async function talk(game: Game, until: 'idle' | 'partyMenu', answers: [RegExp, 'A' | 'B'][] = []): Promise<string> {
  await game.eval((t) => t.face('up'));
  await game.press('A');
  return mashOn(game, until, answers);
}

/** Mash A (pressing `answers` while their message shows) until the field is idle or the party menu takes input. */
async function mashOn(game: Game, until: 'idle' | 'partyMenu', answers: [RegExp, 'A' | 'B'][] = []): Promise<string> {
  await game.eval((_t, u) => void Object.assign(window, { __msgs: [], __until: u }), until);
  const seen = await game.mashUntil(
    (t) => {
      const w = window as unknown as { __msgs: string[]; __until: string };
      const m = t.message();
      if (m && w.__msgs[w.__msgs.length - 1] !== m) w.__msgs.push(m);
      const done = w.__until === 'idle' ? t.idle() : t.gbaScreen() === 'CB2_UpdatePartyMenu' && !t.paletteFadeActive();
      return done && w.__msgs;
    },
    { answers, what: `the script to reach ${until}` },
  );
  return seen.join(' | ');
}

test('Reyley: answering NO keeps the party and leaves the trade open', async () => {
  const game = await session.start({ ...REYLEY, party: [{ species: 'ABRA', level: 10 }] });
  const messages = await talk(game, 'idle', [[/Wanna trade one for my MR\. MIME\?/, 'B']]);
  expect(messages).toMatch(/I’m looking for the POKéMON ABRA!/);
  expect(messages).toMatch(/Awww! Oh, well…/);
  expect((await game.eval((t) => t.party())).map((m) => m.species)).toEqual(['ABRA']);
  expect(await game.eval((t) => t.flag('FLAG_DID_MIMIEN_TRADE'))).toBe(false);
});

test('the Name Rater: answering NO sends you off', async () => {
  const game = await session.start({ ...NAME_RATER, party: [{ species: 'PIDGEY', level: 10 }] });
  const messages = await talk(game, 'idle', [[/rate the nicknames of your POKéMON\?/, 'B']]);
  expect(messages).toMatch(/I am the official NAME RATER!/);
  expect(messages).toMatch(/I see\. Do come visit again\./);
});

/** In the party menu (ChoosePartyMon), pick party slot `slot` with A, or cancel with B. */
async function choose(game: Game, slot: number | 'cancel'): Promise<void> {
  await game.waitForPartyMenu();
  if (slot === 'cancel') return game.press('B');
  await game.pressTimes('DOWN', slot);
  await game.press('A');
}

interface SceneFrame {
  /** share of non-black pixels */
  nonBlack: number;
  colours: number;
  /** the player's and the partner's mon sprite: visible, x + x2, y + y2 */
  mons: { visible: boolean; x: number; y: number }[];
  /** per mon sprite: pixels in its 64x64 box drawn in one of its palette's colours (0 if invisible) */
  monPixels: number[];
}

/**
 * Watch the trade scene from the page until the field is back: its states in order, the GBA main callbacks it ran
 * under, whether the party changed while it was up, and a frame (the PPU's renderFrame) at a few points. With
 * TRADE_SHOTS=<dir> in the environment, those frames are saved there as PNGs too.
 */
function watchTradeScene(game: Game) {
  const shots = process.env.TRADE_SHOTS;
  return game
    .eval(async (t, wantShots) => {
      const imp = (p: string) => new Function('p', 'return import(p)')(p);
      const scene = await imp('/src/menus/tradeScene.ts');
      const ppu = await imp('/src/gba/ppu.ts');
      const hw = await imp('/src/gba/hw.ts');
      const spr = await imp('/src/gba/sprite.ts');
      // the frames to capture: [state, ticks into it]
      const want: Record<string, [number, number]> = {
        sendMsg: [11, 5], gbaSend: [126, 10], linkMonOut: [200, 10], crossing: [38, 30], gbaRecv: [146, 5], zoomIn: [51, 5], newMon: [167, 50], end: [71, 1],
      };
      const states: number[] = [];
      const screens: string[] = [];
      const frames: Record<string, unknown> = {};
      const png: Record<string, string> = {};
      let swappedInScene: boolean | undefined;
      let ticks = 0;
      const buf = new Uint32Array(240 * 160);
      const capture = (key: string, ids: number[]) => {
        ppu.renderFrame(buf);
        const colours = new Set<number>();
        let nonBlack = 0;
        for (const px of buf) {
          colours.add(px);
          if ((px & 0xffffff) !== 0) nonBlack++;
        }
        const sprites = ids.map((id) => spr.gSprites[id]);
        const mons = sprites.map((s) => ({ visible: !s.invisible, x: s.x + s.x2, y: s.y + s.y2 }));
        const monPixels = sprites.map((s) => {
          if (s.invisible) return 0;
          const pal = new Set<number>();
          for (let i = 1; i < 16; i++) {
            const c = hw.pltt[256 + s.oam.paletteNum * 16 + i];
            pal.add(((c & 0x1f) << 3) | (((c >> 5) & 0x1f) << 11) | (((c >> 10) & 0x1f) << 19));
          }
          let n = 0;
          const x0 = s.x + s.x2 - 32;
          const y0 = s.y + s.y2 - 32;
          for (let y = Math.max(0, y0); y < Math.min(160, y0 + 64); y++)
            for (let x = Math.max(0, x0); x < Math.min(240, x0 + 64); x++) if (pal.has(buf[y * 240 + x] & 0xf8f8f8)) n++;
          return n;
        });
        frames[key] = { nonBlack: nonBlack / buf.length, colours: colours.size, mons, monPixels };
        if (wantShots) {
          const canvas = document.createElement('canvas');
          canvas.width = 240;
          canvas.height = 160;
          canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer.slice(0)), 240, 160), 0, 0);
          png[key] = canvas.toDataURL('image/png');
        }
      };
      await t.until(() => {
        const p = scene.tradeSceneProbe();
        const screen = t.gbaScreen();
        if (screen && screen !== screens.at(-1) && /Trade/.test(screen)) screens.push(screen);
        if (p) {
          if (states.at(-1) !== p.state) {
            states.push(p.state);
            ticks = 0;
          }
          ticks++;
          for (const [key, [st, n]] of Object.entries(want)) if (st === p.state && n === ticks) capture(key, p.monSpriteIds);
        }
        if (swappedInScene === undefined && t.party()[1]?.species === 'MR_MIME') swappedInScene = !!p;
        return states.length > 0 && !p && !screen;
      }, 20000);
      return { states, screens, frames, swappedInScene, png };
    }, !!shots)
    .then(async (r) => {
      if (shots) {
        const fs = await import('node:fs');
        fs.mkdirSync(shots, { recursive: true });
        for (const [key, url] of Object.entries(r.png)) fs.writeFileSync(`${shots}/${key}.png`, Buffer.from(url.split(',')[1], 'base64'));
      }
      return r as Omit<typeof r, 'frames'> & { frames: Record<string, SceneFrame> };
    });
}

/** The party mon in `slot` as the trade sets it. */
const tradedMon = (game: Game, slot: number) =>
  game.eval((t, i) => {
    const m = t.state!.party[i];
    return { otName: m.otName, otId: m.otId, otGender: m.otGender, metLocation: m.metLocation, friendship: m.friendship, personality: m.personality };
  }, slot);

test('Reyley trades his MR. MIME for an ABRA: species, nickname, OT, level and the Pokédex entry', async () => {
  const game = await session.start({ ...REYLEY, party: [{ species: 'PIDGEY', level: 9 }, { species: 'ABRA', level: 12 }] });
  expect(await game.eval((t) => t.state!.dexCaught.has(122))).toBe(false); // national dex #122 MR. MIME
  await talk(game, 'partyMenu'); // A answers YES
  // The trade scene, watched from the page (a poll from here could miss its states)
  // Load the watcher's modules first: under load, importing them inside the watcher let the trade start (and
  // CB2_InitInGameTrade's one frame pass) before its poll began.
  await game.eval(async () => {
    const imp = (p: string) => new Function('p', 'return import(p)')(p);
    await Promise.all(['/src/menus/tradeScene.ts', '/src/gba/ppu.ts', '/src/gba/hw.ts', '/src/gba/sprite.ts'].map(imp));
  });
  const scene = watchTradeScene(game);
  await choose(game, 1);
  const messages = await mashOn(game, 'idle');
  const seen = await scene;
  // DoTradeAnim_Wireless from start to end (the in-game path never sets isCableTrade); A ends STATE_END_LINK_TRADE
  expect(seen.screens).toEqual(['CB2_InitInGameTrade', 'CB2_InGameTrade']);
  expect(seen.states[0]).toBe(0);
  expect(seen.states).toEqual(expect.arrayContaining([10, 124, 126, 200, 38, 144, 146, 51, 63, 167, 68, 71, 72, 74]));
  expect(seen.states.at(-1)).toBe(74);
  // STATE_TRY_EVOLUTION swaps the mons while the scene is up
  expect(seen.swappedInScene).toBe(true);
  // Every captured frame draws something: none is a black screen (the GBA, the link mon and the signal are drawn
  // on black, so some are mostly black)
  expect(Object.keys(seen.frames).sort()).toEqual(['crossing', 'end', 'gbaRecv', 'gbaSend', 'linkMonOut', 'newMon', 'sendMsg', 'zoomIn']);
  for (const [key, f] of Object.entries(seen.frames)) {
    expect.soft(f.nonBlack, key).toBeGreaterThan(0.01);
    expect.soft(f.colours, key).toBeGreaterThan(2);
  }
  expect(seen.frames.zoomIn.nonBlack).toBeGreaterThan(0.9); // the GBA fills the screen
  // The mon pics: ABRA in the middle when it's sent off, both crossing, MR. MIME in the middle at the end
  expect(seen.frames.sendMsg.mons[0]).toMatchObject({ visible: true, x: 120 });
  expect(seen.frames.sendMsg.mons[1].visible).toBe(false);
  expect(seen.frames.crossing.mons.map((m) => m.visible)).toEqual([true, true]);
  expect(seen.frames.newMon.mons[1].visible).toBe(true);
  expect(seen.frames.end.mons[1]).toMatchObject({ visible: true, x: 120 });
  expect(seen.frames.sendMsg.monPixels[0]).toBeGreaterThan(200);
  expect(seen.frames.end.monPixels[1]).toBeGreaterThan(200);
  expect(messages).toMatch(/Hey, thanks!/);
  const party = await game.eval((t) => t.party());
  expect(party.map((m) => m.species)).toEqual(['PIDGEY', 'MR_MIME']);
  expect(party[1]).toMatchObject({ nickname: 'MIMIEN', level: 12 });
  expect(await tradedMon(game, 1)).toEqual({
    otName: 'REYLEY', otId: 1985, otGender: 'male', metLocation: 'METLOC_IN_GAME_TRADE', friendship: 70, personality: 0x9cae,
  });
  expect(await game.eval((t) => [t.state!.dexSeen.has(122), t.state!.dexCaught.has(122)])).toEqual([true, true]);
  expect(await game.eval((t) => t.flag('FLAG_DID_MIMIEN_TRADE'))).toBe(true);

  // Talking to him again: the trade is done.
  const again = await talk(game, 'idle');
  expect(again).toMatch(/Isn’t my old MR\. MIME great\?/);
  expect((await game.eval((t) => t.party())).map((m) => m.species)).toEqual(['PIDGEY', 'MR_MIME']);
});

test('Reyley: offering the wrong species, or cancelling the party menu, trades nothing', async () => {
  const game = await session.start({ ...REYLEY, party: [{ species: 'PIDGEY', level: 9 }, { species: 'ABRA', level: 12 }] });
  await talk(game, 'partyMenu');
  await choose(game, 0);
  expect(await mashOn(game, 'idle')).toMatch(/What\? That’s no ABRA!/);
  await talk(game, 'partyMenu');
  await choose(game, 'cancel');
  expect(await mashOn(game, 'idle')).toMatch(/Awww! Oh, well…/);
  expect((await game.eval((t) => t.party())).map((m) => m.species)).toEqual(['PIDGEY', 'ABRA']);
  expect(await game.eval((t) => t.flag('FLAG_DID_MIMIEN_TRADE'))).toBe(false);
});

test('the Name Rater renames your own mon', async () => {
  const game = await session.start({ ...NAME_RATER, party: [{ species: 'PIDGEY', level: 10 }] });
  await talk(game, 'partyMenu'); // A answers YES
  await choose(game, 0);
  // "PIDGEY, is it? ... How about it?" YES → "what shall the new nickname be?" → the naming screen
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_NamingScreen', { what: 'the naming screen' });
  await game.waitForScreen('CB2_NamingScreen');
  await game.pressTimes('A', 3); // the cursor starts on "A"
  await game.press('START'); // jump to OK
  await game.press('A');
  const messages = await mashOn(game, 'idle');
  expect(messages).toMatch(/Done! From now on, this POKéMON shall be known as AAA!/);
  expect(messages).toMatch(/It is a better name than before!/);
  expect((await game.eval((t) => t.party()))[0].nickname).toBe('AAA');
});

test('the Name Rater refuses a traded mon', async () => {
  const game = await session.start({ ...NAME_RATER, party: [{ species: 'PIDGEY', level: 10 }, { species: 'ABRA', level: 10 }] });
  await game.eval((t) => {
    const m = t.state!.party[1];
    m.otId = (t.state!.trainerId + 1) >>> 0; // another trainer's mon (IsMonOTIDNotPlayers)
    m.otName = 'REYLEY';
  });
  await talk(game, 'partyMenu');
  await choose(game, 1);
  const messages = await mashOn(game, 'idle');
  expect(messages).toMatch(/ABRA, is it\? That is a truly impeccable name!/);
  expect(messages).toMatch(/Take good care of ABRA!/);
  expect((await game.eval((t) => t.party()))[1].nickname).toBe('ABRA');
});
