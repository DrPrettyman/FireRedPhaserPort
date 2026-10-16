// Battle animation scripts (src/battle/anim/): ported move, general and status anims run to their end
// and the battle carries on afterwards.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const ROUTE1 = { start: 'after-rival', map: 'Route1', x: 12, y: 7 } as const;

/** The first battleAnim / battleAnimEnd event for `label` after `since` (pressing A through text meanwhile). */
async function animEvent(game: Game, type: 'battleAnim' | 'battleAnimEnd', label: string, since: number) {
  for (let i = 0; i < 300; i++) {
    const e = (await game.events(since)).find((ev) => ev.type === type && ev.label === label);
    if (e) return e;
    await game.eval((t) => t.waitFrames(10));
  }
  throw new Error(`no ${type} event for ${label}: ${JSON.stringify((await game.events(since)).map((e) => [e.type, e.label]))}`);
}

/** Picks the first move at the action menu. */
async function useFirstMove(game: Game): Promise<number> {
  await game.waitForActionMenu();
  const since = await game.mark();
  await game.press('A'); // FIGHT
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // move 1
  return since;
}

test('Tackle runs its anim script to the end, then the turn carries on', async () => {
  // speed 1 so polling from here catches the hit splat while it's up
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'RATTATA', level: 30, moves: ['TACKLE'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 30 }));
  const since = await useFirstMove(game);

  const start = await animEvent(game, 'battleAnim', 'Move_TACKLE', since);
  expect(start).toMatchObject({ ran: true, attacker: 0, target: 1 });
  // Mid-animation the hit splat exists alongside the battlers and healthboxes.
  const sprites = await game.waitFor((t) => {
    const n = t.gbaSprites().filter((s) => s.tileTag === t.define('ANIM_TAG_IMPACT')).length;
    return n > 0 && n;
  }, { what: 'the hit splat sprite' });
  expect(sprites).toBeGreaterThan(0);
  await animEvent(game, 'battleAnimEnd', 'Move_TACKLE', since);

  await game.waitForActionMenu();
  const mons = (await game.eval((t) => t.battle()))!.mons;
  expect(mons[1].hp).toBeLessThan(mons[1].maxHP);
  // Nothing of the anim is left behind.
  expect(await game.eval((t) => t.gbaSprites().filter((s) => s.tileTag === t.define('ANIM_TAG_IMPACT')).length)).toBe(0);
});

test('Growl plays, then the stat change anim lowers the target', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 30, moves: ['GROWL'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 30 }));
  const since = await useFirstMove(game);

  expect(await animEvent(game, 'battleAnim', 'Move_GROWL', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'Move_GROWL', since);
  expect(await animEvent(game, 'battleAnim', 'General_StatsChange', since)).toMatchObject({ ran: true, target: 1 });
  await animEvent(game, 'battleAnimEnd', 'General_StatsChange', since);
  await game.waitForActionMenu();
});

/** At the action menu: BAG → the POKé BALLS pocket → the first ball → throw. */
async function throwFirstBall(game: Game): Promise<number> {
  await game.chooseAction('BAG');
  const since = await game.mark();
  await game.eval((t) => t.waitFrames(60)); // the bag fades in
  await game.pressTimes('RIGHT', 2);
  // A (item) then A (USE); presses during the pocket slide are dropped, so keep pressing until the throw starts
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleAnim' && e.label === 'Special_BallThrow'), { what: 'the ball throw' });
  return since;
}

test('a Poké Ball the wild mon breaks out of', async () => {
  // (a Lv. 100 Mewtwo survives the wild one's counterattack)
  const game = await session.start({ ...ROUTE1, party: [{ species: 'MEWTWO', level: 100, moves: ['TAIL_WHIP'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_POKE_BALL'), 1));
  await game.eval((t) => t.startWildBattle({ species: 'MEWTWO', level: 70 })); // catch rate 3 at full HP
  const since = await throwFirstBall(game);

  expect(await animEvent(game, 'battleAnim', 'Special_BallThrow', since)).toMatchObject({ ran: true, target: 1 });
  // The ball lands, the target shrinks into it...
  await game.waitFor((t) => t.gbaSprites().some((s) => s.tileTag === 55000) && t.battle()!.mons[1].hp > 0 && t.gbaSprites().filter((s) => s.tileTag >= 55020 && s.tileTag < 55032).length > 0, { what: 'the ball open burst' });
  await animEvent(game, 'battleAnimEnd', 'Special_BallThrow', since);
  // ...and breaks out: it's back, the ball gone, and the battle goes on.
  await game.waitForActionMenu();
  const sprites = await game.eval((t) => t.gbaSprites());
  expect(sprites.some((s) => s.tileTag === 55000)).toBe(false);
  expect(await game.eval((t) => t.battle()!.outcome)).toBe(0);
});

test('a Master Ball shakes three times and clicks', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 5, moves: ['TAIL_WHIP'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_MASTER_BALL'), 1));
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2 }));
  const since = await throwFirstBall(game);

  expect(await animEvent(game, 'battleAnim', 'Special_BallThrow', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'Special_BallThrow', since);
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { answers: [[/nickname/i, 'B']], what: 'the battle to end' });
  expect(await game.eval((t) => t.lastOutcome())).toBe('B_OUTCOME_CAUGHT');
});

test('switching out plays the ball effect and shrinks the mon', async () => {
  const game = await session.start({
    ...ROUTE1,
    party: [
      { species: 'RATTATA', level: 30, moves: ['TAIL_WHIP'] },
      { species: 'PIDGEY', level: 30, moves: ['GUST'] },
    ],
  });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 30 }));
  await game.chooseAction('POKEMON');
  const since = await game.mark();
  await game.eval((t) => t.waitFrames(60)); // the party menu fades in
  await game.press('DOWN');
  await game.press('A'); // PIDGEY
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // SHIFT

  expect(await animEvent(game, 'battleAnim', 'Special_SwitchOutPlayerMon', since)).toMatchObject({ ran: true, attacker: 0 });
  await animEvent(game, 'battleAnimEnd', 'Special_SwitchOutPlayerMon', since);
  await game.waitForActionMenu();
  expect((await game.eval((t) => t.battle()))!.mons[0].species).toBe('PIDGEY');
});

test('levelling up flashes the healthbox', async () => {
  // A Lv. 2 Rattata (8 exp) beating a Lv. 10 Magikarp (28 exp) reaches Lv. 3 (27).
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 2, moves: ['TACKLE'], iv: 31 }] });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 10 }));
  const since = await game.mark();
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  expect(await animEvent(game, 'battleAnim', 'Special_LevelUp', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'Special_LevelUp', since);
  expect((await game.eval((t) => t.party()))[0].level).toBe(3);
});

test('a substitute swaps back to the mon to attack, then back to the doll', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 30, moves: ['TACKLE', 'SUBSTITUTE'] }] });
  // A Lv. 12 Magikarp only knows Splash, so nothing breaks the substitute (Flail at Lv. 30 can)
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 12 }));
  // Turn 1: SUBSTITUTE (move 2, right of move 1)
  await game.waitForActionMenu();
  let since = await game.mark();
  await game.press('A');
  await game.eval((t) => t.waitFrames(10));
  await game.press('RIGHT');
  await game.press('A');
  expect(await animEvent(game, 'battleAnim', 'Move_SUBSTITUTE', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'Move_SUBSTITUTE', since);
  // Turn 2: TACKLE from behind the substitute
  await game.waitForActionMenu();
  since = await game.mark();
  await game.press('A');
  await game.eval((t) => t.waitFrames(10));
  await game.press('LEFT');
  await game.press('A');
  expect(await animEvent(game, 'battleAnim', 'Special_SubstituteToMon', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'Move_TACKLE', since);
  expect(await animEvent(game, 'battleAnim', 'Special_MonToSubstitute', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'Special_MonToSubstitute', since);
});

test("the old man's catching tutorial: his throw and the catch", async () => {
  // The coord trigger at (22, 8) starts the tutorial once Oak's parcel has set the scene var to 1.
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity', x: 22, y: 9 });
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_VIRIDIAN_CITY_OLD_MAN', 1));
  const since = await game.mark();
  await game.walk('up');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleAnim' && e.label === 'Special_BallThrowWithTrainer'), { what: 'the old man’s throw' });
  expect(await animEvent(game, 'battleAnim', 'Special_BallThrowWithTrainer', since)).toMatchObject({ ran: true });
  // The Poké Ball leaves his hand (AnimTask_ThrowBallSpecial waits for his throw frame).
  await game.waitFor((t) => t.gbaSprites().some((s) => s.tileTag === 55000 && !s.invisible), { what: 'the ball in flight' });
  // The ball click clears gDoingBattleAnim at frame 95 of 315, so (as on the GBA) the battle can end
  // before the anim script does.
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the tutorial battle to end' });
  expect(await game.eval((t) => t.lastOutcome())).toBe('B_OUTCOME_CAUGHT');
});

test('a trainer blocks the ball', async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianForest', x: 41, y: 45, party: [{ species: 'MEWTWO', level: 100, moves: ['TAIL_WHIP'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_POKE_BALL'), 1));
  await game.walk('right'); // into Bug Catcher Rick's view
  await game.mashUntil((t) => t.battle()?.controller?.startsWith('HandleInputChooseAction'), { what: 'Rick’s battle' });
  const since = await throwFirstBall(game);
  await animEvent(game, 'battleAnimEnd', 'Special_BallThrow', since);
  // TrainerBallBlock knocks the ball off-screen; the battle goes on and nothing was caught.
  await game.waitForActionMenu();
  expect(await game.eval((t) => t.battle()!.outcome)).toBe(0);
  expect(await game.eval((t) => t.gbaSprites().some((s) => s.tileTag === 55000))).toBe(false);
});

test('a ghost dodges the ball', async () => {
  // Pokémon Tower without the Silph Scope: the wild mon is an unidentified GHOST.
  const game = await session.start({ start: 'after-rival', map: 'PokemonTower_3F', x: 4, y: 10, party: [{ species: 'MEWTWO', level: 100, moves: ['TAIL_WHIP'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_POKE_BALL'), 1));
  await game.eval((t) => t.startWildBattle({ species: 'GASTLY', level: 15 }));
  const since = await throwFirstBall(game);
  await animEvent(game, 'battleAnimEnd', 'Special_BallThrow', since);
  await game.waitForActionMenu();
  expect(await game.eval((t) => t.battle()!.typeFlags & t.define('BATTLE_TYPE_GHOST'))).toBeTruthy();
  expect(await game.eval((t) => t.battle()!.outcome)).toBe(0);
});

test("a shiny's sparkles", async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'MEWTWO', level: 100, moves: ['TAIL_WHIP'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 5, shiny: true }));
  const stars = await game.waitFor((t) => {
    const tag = t.define('ANIM_TAG_GOLD_STARS');
    const n = t.gbaSprites().filter((s) => s.tileTag === tag).length;
    return n > 0 && n;
  }, { what: 'the shiny sparkles', timeout: 60_000 });
  expect(stars).toBeGreaterThan(0);
  await game.waitForActionMenu();
  expect(await game.eval((t) => t.gbaSprites().filter((s) => s.tileTag === t.define('ANIM_TAG_GOLD_STARS')).length)).toBe(0);
});

test('Safari Zone: throwing bait and a rock', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SafariZone_Center', x: 26, y: 29 });
  await game.eval((t) => {
    t.state!.setFlag('FLAG_SYS_SAFARI_MODE');
    t.state!.numSafariBalls = 30;
  });
  // The Safari menu is laid out like the action menu: BALL, BAIT / ROCK, RUN. A wild mon may flee after
  // any turn, so each throw gets its own battle.
  await game.eval((t) => t.startWildBattle({ species: 'RHYHORN', level: 25 }));
  let since = await game.mark();
  await game.chooseAction('BAG'); // BAIT
  // (the event's attacker/target are the launch's; AnimTask_SafariOrGhost_DecideAnimSides then sets them)
  expect(await animEvent(game, 'battleAnim', 'General_BaitThrow', since)).toMatchObject({ ran: true });
  // The bait flies from the player's throw at the wild mon.
  await game.waitFor((t) => t.gbaSprites().some((s) => s.tileTag === t.define('ANIM_TAG_SAFARI_BAIT')), { what: 'the bait in flight' });
  await animEvent(game, 'battleAnimEnd', 'General_BaitThrow', since);
  await game.mashUntil((t) => t.idle() || t.battle()?.controller?.startsWith('HandleInputChooseAction'), { what: 'the next turn or the field' });
  if (await game.eval((t) => !t.battle())) {
    await game.eval((t) => t.startWildBattle({ species: 'RHYHORN', level: 25 }));
  }
  since = await game.mark();
  await game.chooseAction('POKEMON'); // ROCK
  expect(await animEvent(game, 'battleAnim', 'General_SafariRockThrow', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'General_SafariRockThrow', since);
});

test("a poisoned mon's status anim runs at the end of the turn", async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 30, moves: ['TAIL_WHIP'], status: 'POISON' }] });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 30 }));
  const since = await useFirstMove(game);

  expect(await animEvent(game, 'battleAnim', 'Move_TAIL_WHIP', since)).toMatchObject({ ran: true });
  expect(await animEvent(game, 'battleAnim', 'Status_Poison', since)).toMatchObject({ ran: true, attacker: 0 });
  await animEvent(game, 'battleAnimEnd', 'Status_Poison', since);
  await game.waitForActionMenu();
  const mons = (await game.eval((t) => t.battle()))!.mons;
  expect(mons[0].hp).toBeLessThan(mons[0].maxHP);
});
