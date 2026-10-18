// Screen transitions: battle_setup.c's choice of battle transition and battle_transition.c's effects
// over the field, the warp fades (black, or white in and out of caves), a cave exit's flash and the barn
// door wipe when leaving through a door.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** Route 1's northern grass patch covers (10..21, 6..10). */
const ROUTE1_GRASS = { start: 'after-rival', map: 'Route1', x: 12, y: 7 } as const;
const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };
const MAGIKARP = { species: 'MAGIKARP', level: 2, moves: ['SPLASH'] };

const transitionName = async (game: Game, since: number) => {
  const e = await game.waitForEvent('battleTransition', { since });
  return game.eval((t, id) => t.nameOf('B_TRANSITION_', id), e.transition as number);
};

test('a wild battle opens with Slice when the lead mon is stronger, White Bars Fade when it isn’t', async () => {
  // GetWildBattleTransition on TRANSITION_TYPE_NORMAL ground: the wild mon's level against the lead's.
  let game = await session.start({ ...ROUTE1_GRASS, party: [MEWTWO] });
  let mark = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 3 }));
  expect(await transitionName(game, mark)).toBe('B_TRANSITION_SLICE');

  game = await session.start({ ...ROUTE1_GRASS, party: [MAGIKARP] });
  mark = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 5 }));
  expect(await transitionName(game, mark)).toBe('B_TRANSITION_WHITE_BARS_FADE');
});

test('a trainer battle opens with the Poké Ball trail when the player is stronger, Angled Wipes when not', async () => {
  // Bug Catcher Rick (Viridian Forest) sees the player one step right of (41, 45). His Weedle is level 6.
  for (const [party, expected] of [
    [MEWTWO, 'B_TRANSITION_POKEBALLS_TRAIL'],
    [MAGIKARP, 'B_TRANSITION_ANGLED_WIPES'],
  ] as const) {
    const game = await session.start({ start: 'after-rival', map: 'ViridianForest', x: 41, y: 45, party: [party] });
    const mark = await game.mark();
    await game.walk('right');
    await game.waitForEvent('trainerApproach', { since: mark, what: 'Rick to spot the player' });
    await game.mashUntil((t) => t.events().some((e) => e.type === 'battleTransition'), { what: 'Rick’s battle transition' });
    expect(await transitionName(game, mark)).toBe(expected);
  }
});

test('every battle transition plays over the field and ends on a black screen', async () => {
  const names = ['BLUR', 'SWIRL', 'SHUFFLE', 'BIG_POKEBALL', 'POKEBALLS_TRAIL', 'CLOCKWISE_WIPE', 'RIPPLE', 'WAVE', 'SLICE', 'WHITE_BARS_FADE', 'GRID_SQUARES', 'ANGLED_WIPES', 'LORELEI', 'BRUNO', 'AGATHA', 'LANCE', 'BLUE'];
  for (const name of names) {
    const game = await session.start({ ...ROUTE1_GRASS, party: [MEWTWO] });
    await game.waitIdle();
    await game.eval((t, n) => t.forceBattleTransition(n), name);
    const mark = await game.mark();
    await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 3 }));
    const begin = await game.waitForEvent('battleTransition', { since: mark });
    const end = await game.waitForEvent('battleTransitionEnd', { since: mark, timeout: 60_000, what: `${name} to finish` });
    // Every transition starts with the intro's two grey blinks (32 frames) before its own effect.
    expect(end.frame - begin.frame, name).toBeGreaterThan(60);
    expect(end.black, name).toBe(1);
    await game.waitForEvent('battleStart', { since: mark });
  }
});

test('leaving a house, the barn doors open while the field fades in', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_1F', x: 4, y: 8 });
  await game.waitIdle();
  const mark = await game.mark();
  const arrived = game.eval((t) => t.enterWarp());
  // SetUpWarpExitTask on a door: Task_ExitDoor starts DoOutwardBarnDoorWipe with a black fade in.
  // Read the field in the page on the tick the wipe starts: a round trip after waitForEvent can land after the
  // fade has ended under load (batch 2's merge run).
  const atWipe = await game.eval(async (t, since) => {
    let field: ReturnType<typeof t.field> | undefined;
    await t.until(() => {
      if (!t.events(since).some((e) => e.type === 'barnDoorWipe')) return false;
      field = t.field();
      return true;
    });
    return field;
  }, mark);
  expect(atWipe).toMatchObject({ map: 'PalletTown', fading: true, fadeWhite: false, playerVisible: false });
  await arrived;
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'PalletTown', x: 6, y: 8, playerVisible: true });
});

test('leaving Mt. Moon flashes white, and Route 4 fades in from white', async () => {
  // MtMoon_1F's exit at (18, 37) leads out to Route 4: UNDERGROUND to ROUTE, so CB2_DoChangeMap runs
  // FlashTransition_Exit and WarpFadeInScreen fades in from white (MapTransitionIsExit).
  const game = await session.start({ start: 'after-rival', map: 'MtMoon_1F', x: 18, y: 37 });
  await game.waitIdle();
  const mark = await game.mark();
  // Watched in the page from before the warp, and the fade's colour read in the tick it's seen: a separate read
  // can come after the fade is over. The limit allows for the game ticking on while Route 4 loads.
  const fadeIn = game.eval((t) => {
    let white: boolean | undefined;
    return t.until(() => t.field()?.map === 'Route4' && t.field()?.fading && ((white = t.field()?.fadeWhite), true), 20000).then((seen) => seen && white);
  });
  const arrived = game.eval((t) => t.enterWarp());
  const flash = await game.waitForEvent('mapTransition', { since: mark });
  expect(flash).toMatchObject({ from: 'MtMoon_1F', to: 'Route4' });
  expect(await fadeIn).toBe(true);
  expect(await arrived).toBe('Route4');
});

test('walking into Mt. Moon fades to black (it has a cave preview screen)', async () => {
  // WarpFadeOutScreen: into another region map section with a MPS_TYPE_CAVE preview, black rather than
  // MapTransitionIsEnter's white. Route 4's (19, 5) is the cave mouth.
  const game = await session.start({ start: 'after-rival', map: 'Route4', x: 19, y: 6 });
  await game.waitIdle();
  // (The fade out starts once Mt. Moon's map has loaded, which takes a while the first time.)
  const leaving = game.eval((t) => {
    let white: boolean | undefined;
    return t.until(() => t.field()?.map === 'Route4' && t.field()?.fading && ((white = t.field()?.fadeWhite), true), 20000).then((seen) => (seen ? white : 'no fade'));
  });
  await game.eval((t) => t.walk('up', 1));
  expect(await leaving).toBe(false);
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.map)).toBe('MtMoon_1F');
});
