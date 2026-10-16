// PC boxes: a Pokémon given (`givemon`) or caught with a full party goes to the PC, with the "transferred to
// Someone's PC" messages (and the "BOX ... was full" variant when the current box has no room).

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';

const session = useGame();

const FULL_PARTY: MonSpec[] = [
  { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] },
  ...Array.from({ length: 5 }, () => ({ species: 'RATTATA', level: 5 })),
];

/** Celadon Condominiums roof: the Eevee ball is at (7, 3); stand below it. */
const EEVEE_ROOF = { start: 'after-rival', map: 'CeladonCity_Condominiums_RoofRoom', x: 7, y: 4, party: FULL_PARTY } as const;
const ROUTE1_GRASS = { start: 'after-rival', map: 'Route1', x: 12, y: 7, party: FULL_PARTY } as const;

/** What's in a box slot: species name and decoded nickname, or null. */
const boxSlot = (game: Game, box: number, pos: number) =>
  game.eval(
    (t, b, p) => {
      const m = t.state!.storage.getBoxedMon(b, p);
      return m && { species: t.nameOf('SPECIES_', m.species), nickname: t.decode(m.nickname) };
    },
    box,
    pos,
  );

/** Fill box `box` with Pidgeys. */
const fillBox = (game: Game, box: number) =>
  game.eval((t, b) => {
    const s = t.state!;
    for (let i = 0; i < 30; i++) {
      s.storage.setBoxMonAt(b, i, s.pokemon.createMon(t.define('SPECIES_PIDGEY'), 2, { otId: s.trainerId, otName: s.playerName, otGender: s.playerGender, metLocation: 'MAPSEC_ROUTE_1' }));
    }
  }, box);

/** Mash through the field until it's idle again, collecting every field message seen. */
const mashToIdle = async (game: Game) => {
  const seen = await game.mashUntil(
    (t) => {
      const w = window as unknown as { __pcMsgs?: string[] };
      const m = t.message();
      w.__pcMsgs ??= [];
      if (m && w.__pcMsgs[w.__pcMsgs.length - 1] !== m) w.__pcMsgs.push(m);
      return t.idle() && w.__pcMsgs;
    },
    { answers: [[/nickname/, 'B']], what: 'the Eevee script to end' },
  );
  return seen.join(' | ');
};

test('givemon with a full party sends the Eevee to the PC', async () => {
  const game = await session.start(EEVEE_ROOF);
  await game.eval((t) => t.face('up'));
  await game.press('A');
  const messages = await mashToIdle(game);
  expect(messages).toMatch(/EEVEE was transferred to Someone’s PC\. It was placed in BOX “BOX1\.”/);
  expect(await game.eval((t) => t.party().length)).toBe(6);
  expect(await boxSlot(game, 0, 0)).toEqual({ species: 'SPECIES_EEVEE', nickname: 'EEVEE' });
  expect(await game.eval((t) => [t.flag('FLAG_GOT_EEVEE'), t.state!.dexCaught.has(133), t.var('VAR_PC_BOX_TO_SEND_MON')])).toEqual([true, true, 0]);
});

test('givemon with the current box full says so and uses the next box', async () => {
  const game = await session.start(EEVEE_ROOF);
  await fillBox(game, 0);
  await game.eval((t) => t.face('up'));
  await game.press('A');
  const messages = await mashToIdle(game);
  expect(messages).toMatch(/BOX “BOX1” on Someone’s PC was full\. EEVEE was transferred to BOX “BOX2\.”/);
  expect(await boxSlot(game, 1, 0)).toEqual({ species: 'SPECIES_EEVEE', nickname: 'EEVEE' });
  expect(await game.eval((t) => [t.var('VAR_PC_BOX_TO_SEND_MON'), t.flag('FLAG_SHOWN_BOX_WAS_FULL_MESSAGE')])).toEqual([1, true]);
});

/** Start a wild Pidgey battle with a Master Ball in the bag and throw it. */
async function catchPidgey(game: Game): Promise<void> {
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_MASTER_BALL'), 1));
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2 }));
  // BAG → the POKé BALLS pocket (two to the right of ITEMS) → MASTER BALL → throw it.
  await game.chooseAction('BAG');
  await game.eval((t) => t.waitFrames(60)); // the bag fades in
  await game.pressTimes('RIGHT', 2);
  await game.pressTimes('A', 2);
  await game.mashUntil((t) => /nickname/.test(t.battle()?.message ?? ''), { what: '"Give a nickname...?"' });
}

test('a catch with a full party goes to the PC with the battle\'s "transferred" message', async () => {
  const game = await session.start(ROUTE1_GRASS);
  await catchPidgey(game);
  await game.eval((t) => t.waitFrames(30));
  await game.press('B'); // no nickname
  const sent = await game.mashUntil((t) => /transferred/.test(t.battle()?.message ?? '') && t.battle()!.message, { what: 'the PC message' });
  expect(sent).toMatch(/PIDGEY was transferred to Someone’s PC\. It was placed in BOX “BOX1\.”/);
  await game.mashUntil((t) => t.idle(), { what: 'the field after the battle' });
  expect(await game.eval((t) => t.lastOutcome())).toBe('B_OUTCOME_CAUGHT');
  expect(await game.eval((t) => t.party().length)).toBe(6);
  expect(await boxSlot(game, 0, 0)).toEqual({ species: 'SPECIES_PIDGEY', nickname: 'PIDGEY' });
});

test('a catch with a full party and a full current box: "BOX1 was full"', async () => {
  const game = await session.start(ROUTE1_GRASS);
  await fillBox(game, 0);
  await catchPidgey(game);
  await game.eval((t) => t.waitFrames(30));
  await game.press('B');
  const sent = await game.mashUntil((t) => /transferred/.test(t.battle()?.message ?? '') && t.battle()!.message, { what: 'the PC message' });
  expect(sent).toMatch(/BOX “BOX1” on Someone’s PC was full\. PIDGEY was transferred to BOX “BOX2\.”/);
  await game.mashUntil((t) => t.idle(), { what: 'the field after the battle' });
  expect(await boxSlot(game, 1, 0)).toEqual({ species: 'SPECIES_PIDGEY', nickname: 'PIDGEY' });
});

test('a nicknamed catch with a full party goes to the PC under its nickname', async () => {
  const game = await session.start(ROUTE1_GRASS);
  await catchPidgey(game);
  // YES → the naming screen, "AAA", OK; the naming screen shows the "sent to PC" message itself.
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_NamingScreen', { what: 'the naming screen' });
  await game.eval((t) => t.waitFrames(30));
  await game.pressTimes('A', 3);
  await game.press('START');
  await game.press('A');
  await game.mashUntil((t) => t.idle(), { what: 'the field after the battle' });
  expect(await game.eval((t) => t.party().length)).toBe(6);
  expect(await boxSlot(game, 0, 0)).toEqual({ species: 'SPECIES_PIDGEY', nickname: 'AAA' });
});

test('the field stores the player location for a save, and the save slot round-trips in the browser', async () => {
  const game = await session.start(EEVEE_ROOF);
  await game.eval((t) => t.face('up'));
  const r = await game.eval(async (t) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<typeof import('../../src/state/saveData')>;
    const sd = await load('/src/state/saveData.ts');
    const w = window as unknown as { game: { scene: { getScene(k: string): { storeLocationForSave(): void } } } };
    w.game.scene.getScene('Overworld').storeLocationForSave();
    const data = sd.toSaveData(t.state!);
    const written = sd.writeSave(data);
    const back = sd.readSave();
    sd.clearSave();
    return { written, location: data.location, same: JSON.stringify(back) === JSON.stringify(data), cleared: !sd.hasSave() };
  });
  const onFoot = await game.eval((t) => t.define('PLAYER_AVATAR_FLAG_ON_FOOT'));
  expect(r).toEqual({
    written: true,
    location: { mapId: 'MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM', x: 7, y: 4, facing: 'up', avatarFlags: onFoot },
    same: true,
    cleared: true,
  });
});
