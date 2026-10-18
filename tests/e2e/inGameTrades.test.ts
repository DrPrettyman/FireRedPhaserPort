// In-game trades (trade_scene.c's specials, script/tradeSpecials.ts; the scene is a fade stand-in until W-trade
// unit 2) on Route 2's trade (Reyley: Abra for Mr. Mime, INGAME_TRADE_MR_MIME), and Lavender Town's Name Rater.

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
  // The swap happens behind the fade (it fades back in from that tick on): watch it from the page, since a poll
  // from here could come after the fade is over.
  const fadingAtSwap = game.eval(async (t) => {
    let fading: boolean | undefined;
    await t.until(() => {
      if (t.party()[1]?.species !== 'MR_MIME') return false;
      fading = !!t.field()?.fading;
      return true;
    }, 20000);
    return fading;
  });
  await choose(game, 1);
  const messages = await mashOn(game, 'idle');
  expect(await fadingAtSwap).toBe(true);
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
