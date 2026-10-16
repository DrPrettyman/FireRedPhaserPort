// Scripted wild battles (battle_setup.c): `dowildbattle` (StartScriptedWildBattle) for the Snorlax on Routes 12
// and 16, `special StartLegendaryBattle` for Zapdos and Mewtwo, and CB2_EndScriptedWildBattle: back to the field
// with the map's ON_RESUME script (FLAG_SYS_SPECIAL_WILD_BATTLE still set), then the script reads
// GetBattleOutcome; a loss whites out.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

const outcomeOf = async (game: Game, since: number) => {
  const end = await game.waitForEvent('battleEnd', { since });
  return game.eval((t, o) => t.nameOf('B_OUTCOME_', o), end.outcome as number);
};

const objectWithGfx = (game: Game, graphicsId: string) => game.eval((t, g) => t.objects().find((o) => o.graphicsId === g), graphicsId);

/** Talk to what's in front and fight until the battle is over; returns the `battleStart` and `battleTransition` events. */
async function talkAndBattle(game: Game, since: number, finish: 'mash' | 'run' = 'mash') {
  await game.press('A');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleStart'), { what: 'the battle' });
  const start = await game.waitForEvent('battleStart', { since });
  const transition = await game.waitForEvent('battleTransition', { since });
  if (finish === 'run') await game.chooseAction('RUN');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  return { start, transition };
}

/** Mash through the script after the battle until the field is free. */
async function finishScript(game: Game) {
  await game.mashUntil((t) => t.idle() && !t.field()!.script && !t.field()!.fading, { what: 'the script to end', trace: false });
}

test('the Poké Flute wakes Route 12\'s Snorlax for a dowildbattle; beaten, it stays gone', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route12', x: 14, y: 69, party: [MEWTWO] });
  await game.eval((t) => t.state!.setFlag('FLAG_GOT_POKE_FLUTE', true));
  await game.eval((t) => t.face('down'));
  expect(await objectWithGfx(game, 'OBJ_EVENT_GFX_SNORLAX')).toMatchObject({ x: 14, y: 70 });
  const since = await game.mark();
  // "Want to use the POKé FLUTE?" → YES, "{PLAYER} played the POKé FLUTE.", "SNORLAX woke up!"
  const { start, transition } = await talkAndBattle(game, since);
  expect(start.flags).toBe(await game.eval((t) => t.define('BATTLE_TYPE_WILD_SCRIPTED')));
  // GetWildBattleTransition: a normal route, the enemy's level under the lead's.
  expect(transition.transition).toBe(await game.eval((t) => t.define('B_TRANSITION_SLICE')));
  expect(await game.eval((t) => t.state!.enemyParty.map((m) => [m.species, m.level]))).toEqual([[await game.eval((t) => t.define('SPECIES_SNORLAX')), 30]]);
  expect(await outcomeOf(game, since)).toBe('B_OUTCOME_WON');
  // Route12_OnResume removed it already; then "SNORLAX calmed down! It gave a huge yawn and returned to the mountains!"
  await finishScript(game);
  expect(await objectWithGfx(game, 'OBJ_EVENT_GFX_SNORLAX')).toBeUndefined();
  expect(await game.eval((t) => [t.flag('FLAG_HIDE_ROUTE_12_SNORLAX'), t.flag('FLAG_WOKE_UP_ROUTE_12_SNORLAX'), t.flag('FLAG_SYS_SPECIAL_WILD_BATTLE')])).toEqual([true, true, false]);
  expect(await game.eval((t) => t.field()!)).toMatchObject({ map: 'Route12', x: 14, y: 69 });

  // Coming back to the map: still gone, and the way south is open.
  const mapMark = await game.mark();
  await game.eval(() => (window as any).game.scene.getScene('Overworld').warp('MAP_ROUTE12', -1, 14, 66));
  await game.waitForEvent('map', { since: mapMark, what: 'Route 12 again' });
  await game.waitIdle();
  expect(await objectWithGfx(game, 'OBJ_EVENT_GFX_SNORLAX')).toBeUndefined();
  expect(await game.eval((t) => t.walkTo(14, 71))).toMatchObject({ arrived: true });
});

test('Route 16\'s Snorlax: running away also sends it back to the mountains', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route16', x: 30, y: 13, party: [MEWTWO] });
  await game.eval((t) => t.state!.setFlag('FLAG_GOT_POKE_FLUTE', true));
  await game.eval((t) => t.face('right'));
  expect(await objectWithGfx(game, 'OBJ_EVENT_GFX_SNORLAX')).toMatchObject({ x: 31, y: 13 });
  const since = await game.mark();
  await talkAndBattle(game, since, 'run');
  expect(await outcomeOf(game, since)).toBe('B_OUTCOME_RAN');
  await finishScript(game);
  expect(await objectWithGfx(game, 'OBJ_EVENT_GFX_SNORLAX')).toBeUndefined();
  expect(await game.eval((t) => t.flag('FLAG_HIDE_ROUTE_16_SNORLAX'))).toBe(true);
});

test('without the Poké Flute, Snorlax just sleeps', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route12', x: 14, y: 69, party: [MEWTWO] });
  await game.eval((t) => t.face('down'));
  const since = await game.mark();
  await game.press('A');
  await game.mashUntil((t) => /sprawled out/.test(t.message() ?? ''), { what: '"A POKéMON is sprawled out in slumber"' });
  await finishScript(game);
  expect((await game.events(since)).some((e) => e.type === 'battleStart')).toBe(false);
  expect(await objectWithGfx(game, 'OBJ_EVENT_GFX_SNORLAX')).toMatchObject({ x: 14, y: 70 });
});

test('Zapdos (special StartLegendaryBattle): a LEGENDARY battle behind BLUR; beaten, it is gone for good', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PowerPlant', x: 5, y: 12, party: [MEWTWO] });
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
  await game.eval((t) => t.face('up'));
  expect(await objectWithGfx(game, 'OBJ_EVENT_GFX_ZAPDOS')).toMatchObject({ x: 5, y: 11 });
  const since = await game.mark();
  // "Gyaoo!"
  const { start, transition } = await talkAndBattle(game, since);
  expect(start.flags).toBe(await game.eval((t) => t.define('BATTLE_TYPE_LEGENDARY') | t.define('BATTLE_TYPE_LEGENDARY_FRLG')));
  expect(transition.transition).toBe(await game.eval((t) => t.define('B_TRANSITION_BLUR')));
  expect(await game.eval((t) => t.state!.enemyParty.map((m) => [m.species, m.level]))).toEqual([[await game.eval((t) => t.define('SPECIES_ZAPDOS')), 50]]);
  expect(await outcomeOf(game, since)).toBe('B_OUTCOME_WON');
  // PowerPlant_EventScript_DefeatedZapdos → EventScript_RemoveStaticMon
  await finishScript(game);
  expect(await objectWithGfx(game, 'OBJ_EVENT_GFX_ZAPDOS')).toBeUndefined();
  expect(await game.eval((t) => [t.flag('FLAG_FOUGHT_ZAPDOS'), t.flag('FLAG_HIDE_ZAPDOS'), t.flag('FLAG_SYS_SPECIAL_WILD_BATTLE')])).toEqual([true, true, false]);
});

test('Mewtwo caught with a Master Ball: CeruleanCave_B1F_OnResume removes it (B_OUTCOME_CAUGHT)', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeruleanCave_B1F', x: 7, y: 13, party: [{ species: 'ALAKAZAM', level: 80, moves: ['PSYCHIC'] }] });
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_MASTER_BALL'), 1));
  await game.eval((t) => t.face('up'));
  expect(await objectWithGfx(game, 'OBJ_EVENT_GFX_MEWTWO')).toMatchObject({ x: 7, y: 12 });
  const since = await game.mark();
  await game.press('A');
  // "Mew!", then the battle
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleStart'), { what: 'the battle' });
  expect((await game.waitForEvent('battleTransition', { since })).transition).toBe(await game.eval((t) => t.define('B_TRANSITION_BLUR')));
  // BAG → the POKé BALLS pocket → MASTER BALL → throw it; no nickname.
  await game.chooseAction('BAG');
  await game.eval((t) => t.waitFrames(60));
  await game.pressTimes('RIGHT', 2);
  await game.pressTimes('A', 2);
  await game.mashUntil((t) => /nickname/.test(t.battle()?.message ?? ''), { what: '"Give a nickname...?"' });
  // No nickname: mash B (a single B can land while the question is still printing, and A would then pick YES)
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { button: 'B', what: 'the battle to end' });
  expect(await outcomeOf(game, since)).toBe('B_OUTCOME_CAUGHT');
  await finishScript(game);
  expect(await objectWithGfx(game, 'OBJ_EVENT_GFX_MEWTWO')).toBeUndefined();
  expect(await game.eval((t) => [t.flag('FLAG_FOUGHT_MEWTWO'), t.flag('FLAG_HIDE_MEWTWO')])).toEqual([true, true]);
  expect(await game.eval((t) => t.party().map((m: any) => m.species))).toEqual(['ALAKAZAM', 'MEWTWO']);
});

test('losing to Mewtwo whites out, and Mewtwo is still there to fight', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeruleanCave_B1F', x: 7, y: 13, party: [{ species: 'MAGIKARP', level: 2, moves: ['SPLASH'] }] });
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
  await game.eval((t) => t.face('up'));
  const since = await game.mark();
  await talkAndBattle(game, since);
  expect(await outcomeOf(game, since)).toBe('B_OUTCOME_LOST');
  await game.waitForEvent('whiteOut', { since });
  await game.mashUntil((t) => t.idle() && !t.field()!.script && t.field()!.map !== 'CeruleanCave_B1F', { what: 'the white-out' });
  expect(await game.eval((t) => [t.flag('FLAG_FOUGHT_MEWTWO'), t.flag('FLAG_HIDE_MEWTWO'), t.flag('FLAG_SYS_SPECIAL_WILD_BATTLE')])).toEqual([false, false, false]);
});
