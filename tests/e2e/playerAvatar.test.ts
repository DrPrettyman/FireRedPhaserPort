// The player avatar (field_player_avatar.c, bike.c): turning, bumping, running, ledges, forced movement
// tiles, the bike, the surfing state and pushing boulders. `__test.field().avatar` shows gPlayerAvatar
// and the player's held movement action.

import { expect, test } from 'vitest';
import { useGame, type Game, type StartOptions } from './harness';

const session = useGame();

/** A level-100 lead, with a repel set once the field is up, keeps wild Pokémon away. */
const SAFE: StartOptions = { start: 'after-rival', party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] };
async function repel(game: Game) {
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
}

test('a tap turns the player on the spot; holding walks', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await game.waitIdle();
  // PlayerTurnInPlace: an 8-frame walk in place, and no step
  const turning = await game.eval(async (t) => {
    const press = t.press('LEFT', 1, 1);
    await t.until(() => t.field()?.avatar.action === 'WALK_IN_PLACE_FAST_LEFT', 10);
    const f = t.field()!;
    await press;
    return f;
  });
  expect(turning.avatar.action).toBe('WALK_IN_PLACE_FAST_LEFT');
  expect(turning.avatar.runningState).toBe(1); // TURN_DIRECTION
  expect(turning).toMatchObject({ x: 12, y: 14, facing: 'left' });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.x)).toBe(12);
  // Held, the next step is a normal walk
  expect(await game.walk('left', 2)).toMatchObject({ arrived: true, x: 10 });
});

test('walking into something bumps on the spot', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_1F', x: 8, y: 5 });
  await game.waitIdle();
  // Mom stands at (8, 4): an object in the way bumps the same as a wall (PlayerNotOnBikeCollide).
  await game.eval((t) => t.face('up'));
  // Hold, watch and release in one eval, so a busy machine can't miss the action or overshoot.
  const bump = await game.eval(async (t) => {
    t.hold('UP');
    const r = await t.until(() => t.field()?.avatar.action === 'WALK_IN_PLACE_SLOW_UP', 60);
    t.release();
    return r;
  });
  expect(bump).toBe(true);
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!)).toMatchObject({ x: 8, y: 5, facing: 'up' });
});

test('B runs once the running shoes are on (FLAG_SYS_B_DASH)', async () => {
  const game = await session.start({ ...SAFE, map: 'Route1', x: 10, y: 30 });
  await repel(game);
  await game.waitIdle();
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_B_DASH', true));
  await game.eval((t) => t.face('up'));
  // Hold, watch and release in one eval, so a busy machine can't miss the action or overshoot.
  const ran = await game.eval(async (t) => {
    t.hold('B'); t.hold('UP');
    const r = await t.until(() => t.field()?.avatar.action === 'PLAYER_RUN_UP' && t.field()?.avatar.flags.includes('DASH'), 60);
    t.release();
    return r;
  });
  expect(ran).toBe(true);
});

test('a ledge jump carries the player two tiles', async () => {
  // Route 1's ledges (MB_JUMP_SOUTH) run along y = 5.
  const game = await session.start({ ...SAFE, map: 'Route1', x: 3, y: 4 });
  await repel(game);
  await game.waitIdle();
  await game.eval((t) => t.face('down'));
  // Hold, watch and release in one eval, so a busy machine can't miss the action or overshoot.
  const jumped = await game.eval(async (t) => {
    t.hold('DOWN');
    const r = await t.until(() => t.field()?.avatar.action === 'JUMP_2_DOWN', 60);
    t.release();
    return r;
  });
  expect(jumped).toBe(true);
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!)).toMatchObject({ x: 3, y: 6 });
});

test('ice slides the player until something stops them', async () => {
  // Icefall Cave B1F: an ice floor from x = 14 to 19 on row 7, with rock at x = 13.
  const game = await session.start({ ...SAFE, map: 'FourIsland_IcefallCave_B1F', x: 20, y: 7 });
  await repel(game);
  await game.waitIdle();
  await game.eval((t) => t.face('left'));
  // Hold, watch and release in one eval, so a busy machine can't miss the action or overshoot.
  const slid = await game.eval(async (t) => {
    t.hold('LEFT');
    const r = await t.until(() => t.field()?.avatar.action === 'WALK_FAST_LEFT' && t.field()?.avatar.flags.includes('FORCED'), 60);
    t.release();
    return r;
  });
  expect(slid).toBe(true);
  // ForcedMovement_Slip keeps going without input until the rock
  await game.waitIdle();
  const f = await game.eval((t) => t.field()!);
  expect(f).toMatchObject({ x: 14, y: 7 });
  expect(f.avatar.flags).not.toContain('FORCED');
});

test('a spinner tile spins the player on to the next stop tile', async () => {
  // Rocket Hideout B2F: MB_SPIN_RIGHT at (9, 20), floor to MB_STOP_SPINNING at (13, 20).
  const game = await session.start({ ...SAFE, map: 'RocketHideout_B2F', x: 9, y: 19 });
  await repel(game);
  await game.waitIdle();
  await game.eval((t) => t.face('down'));
  // Hold, watch and release in one eval, so a busy machine can't miss the action or overshoot.
  const spun = await game.eval(async (t) => {
    t.hold('DOWN');
    const r = await t.until(() => t.field()?.avatar.action === 'SPIN_RIGHT', 60);
    t.release();
    return r;
  });
  expect(spun).toBe(true);
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!)).toMatchObject({ x: 13, y: 20 });
});

/**
 * START → BAG → the KEY ITEMS pocket (one to the right of ITEMS) → the first item → the first action (USE /
 * WALK). `again`: the start menu's cursor is still on BAG and the bag reopens on KEY ITEMS.
 */
async function useFirstKeyItem(game: Game, again = false) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  if (!again) await game.press('DOWN');
  await game.press('A');
  await game.eval((t) => t.waitFrames(60)); // the bag fades in
  if (!again) {
    await game.press('RIGHT');
    await game.eval((t) => t.waitFrames(20));
  }
  await game.press('A'); // the item's context menu
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // USE (WALK while riding)
}

test('the Bicycle from the bag gets the player on and off the bike', async () => {
  const game = await session.start({ ...SAFE, map: 'Route1', x: 16, y: 30 });
  await repel(game);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_BICYCLE'), 1));
  await useFirstKeyItem(game);
  await game.waitFor((t) => t.idle() && t.field()?.avatar.flags.includes('MACH_BIKE'), { what: 'the player on the bike' });
  expect(await game.eval((t) => t.field()!.avatar.graphicsId)).toBe('OBJ_EVENT_GFX_RED_BIKE');

  // On the bike a step is RIDE_WATER_CURRENT: MOVE_SPEED_FAST_2, 6 frames a tile (BikeTransition_MoveDirection)
  await game.eval((t) => t.face('left'));
  // One eval: split into several, the time between them would count as frames on a busy machine.
  const { rode, frames } = await game.eval(async (t) => {
    const start = t.frame();
    t.hold('LEFT');
    const rode = await t.until(() => t.field()?.avatar.action === 'RIDE_WATER_CURRENT_LEFT', 60);
    await t.until(() => t.field()!.x <= 12, 120);
    const frames = t.frame() - start;
    t.release();
    return { rode, frames };
  });
  expect(rode).toBe(true);
  expect(frames).toBeLessThan(4 * 16); // four tiles, faster than walking them

  await useFirstKeyItem(game, true); // WALK
  await game.waitFor((t) => t.idle() && t.field()?.avatar.flags.includes('ON_FOOT'), { what: 'the player off the bike' });
  expect(await game.eval((t) => t.field()!.avatar.graphicsId)).toBe('OBJ_EVENT_GFX_RED_NORMAL');
});

test('Cycling Road puts the player on the bike and keeps them on it', async () => {
  // Route 16's west gate: walking west sets VAR_MAP_SCENE_ROUTE16 (EventScript_SetEnteringCyclingRoad), and
  // Route 16's map scripts then set FLAG_SYS_ON_CYCLING_ROAD and ForcePlayerOntoBike.
  const game = await session.start({ ...SAFE, map: 'Route16_NorthEntrance_1F', x: 4, y: 12 });
  await repel(game);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_BICYCLE'), 1));
  await game.waitIdle();
  await game.eval((t) => t.walkTo(1, 12)); // the trigger at (2, 12) runs on the way
  await game.waitIdle();
  if ((await game.eval((t) => t.field()!.x)) !== 1) await game.eval((t) => t.walkTo(1, 12));
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_ROUTE16'))).toBe(1);
  expect(await game.eval((t) => t.enterWarp())).toBe('Route16');
  const f = await game.eval((t) => t.field()!);
  expect(f.avatar.flags).toContain('MACH_BIKE');
  expect(f.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_BIKE');
  expect(await game.eval((t) => t.flag('FLAG_SYS_ON_CYCLING_ROAD'))).toBe(true);

  // FieldUseFunc_Bike: "You can't dismount your BIKE here." (the bag stays open)
  await useFirstKeyItem(game);
  await game.eval((t) => t.waitFrames(60));
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'back on the field' });
  expect(await game.eval((t) => t.field()!.avatar.flags)).toContain('MACH_BIKE');
});

test('a Cycling Road slope rolls the bike south unless B is held', async () => {
  const game = await session.start({ ...SAFE, map: 'Route17', x: 7, y: 2 });
  await repel(game);
  await game.waitIdle();
  await game.eval((t) => {
    t.state!.setFlag('FLAG_SYS_ON_CYCLING_ROAD', true);
    t.setAvatarState('MACH_BIKE');
  });
  // BikeInputHandler_Normal on MB_CYCLING_ROAD_PULL_DOWN with nothing held: BIKE_TRANS_DOWNHILL (WALK_FASTER_DOWN)
  const rolled = await game.eval((t) => t.until(() => t.field()?.avatar.action === 'WALK_FASTER_DOWN', 60));
  expect(rolled).toBe(true);
  await game.eval((t) => t.until(() => t.field()!.y >= 5, 120));
  // Holding B stops the roll
  await game.eval((t) => t.hold('B'));
  await game.eval((t) => t.waitFrames(10));
  const y = await game.eval((t) => t.field()!.y);
  await game.eval((t) => t.waitFrames(30));
  expect(await game.eval((t) => t.field()!.y)).toBe(y);
  await game.eval((t) => t.release());
});

test('surfing: faster steps on water, and jumping off onto the shore', async () => {
  // Pallet Town's pond (x 7-10, y 17-19, elevation 1). Arriving on water starts the player surfing
  // (GetInitialPlayerAvatarState: MetatileBehavior_IsSurfable).
  const game = await session.start({ ...SAFE, map: 'PalletTown', x: 8, y: 18 });
  await repel(game);
  await game.waitIdle();
  let f = await game.eval((t) => t.field()!);
  expect(f.avatar.flags).toContain('SURFING');
  expect(f.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_SURF');
  await game.eval((t) => t.face('right'));
  const surfed = game.eval((t) => t.until(() => t.field()?.avatar.action === 'WALK_FAST_RIGHT', 60));
  expect(await game.walk('right', 1)).toMatchObject({ arrived: true, x: 9 });
  expect(await surfed).toBe(true);

  // West onto the land at (6, 18): CanStopSurfing → JUMP_SPECIAL_WITH_EFFECT, then on foot
  await game.eval((t) => t.walk('left', 3));
  await game.waitFor((t) => t.idle() && t.field()?.avatar.flags.includes('ON_FOOT'), { what: 'the player on land' });
  f = await game.eval((t) => t.field()!);
  expect(f).toMatchObject({ x: 6, y: 18 });
  expect(f.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_NORMAL');
  expect(f.avatar.flags).not.toContain('SURFING');
});

test('a current carries a surfing player along until something blocks it', async () => {
  // Seafoam Islands B4F: an eastward current along row 6 from x = 8 to 16, then northward from (17, 6) to
  // the rock at (17, 0). Arriving on water here doesn't start surfing (MetatileBehavior_IsSurfableInSeafoamIslands).
  const game = await session.start({ ...SAFE, map: 'SeafoamIslands_B4F', x: 7, y: 6 });
  await repel(game);
  await game.waitIdle();
  // A dev start skips Route20_OnTransition, so both boulders count as down and the currents have stopped
  // (setmaplayoutindex): hide them as Route 20 would and come in again.
  await game.eval((t) => {
    t.state!.setFlag('FLAG_STOPPED_SEAFOAM_B4F_CURRENT', false);
    t.state!.setFlag('FLAG_HIDE_SEAFOAM_B4F_BOULDER_1', true);
    t.state!.setFlag('FLAG_HIDE_SEAFOAM_B4F_BOULDER_2', true);
  });
  const mark = await game.mark();
  await game.eval(() => (window as any).game.scene.getScene('Overworld').warp('MAP_SEAFOAM_ISLANDS_B4F', -1, 7, 6));
  await game.waitForEvent('map', { since: mark });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.avatar.flags)).toContain('ON_FOOT');
  await game.eval((t) => t.setAvatarState('SURFING'));
  await game.eval((t) => t.face('right'));
  const pushed = game.eval((t) => t.until(() => t.field()?.avatar.action === 'RIDE_WATER_CURRENT_UP', 300));
  await game.walk('right', 1);
  expect(await pushed).toBe(true);
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!)).toMatchObject({ x: 17, y: 1 });
});

test('the test hook puts the player in a state and its graphics', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 6, y: 18 });
  await game.waitIdle();
  await game.eval((t) => t.setAvatarState('SURFING'));
  expect(await game.eval((t) => t.field()!.avatar)).toMatchObject({ graphicsId: 'OBJ_EVENT_GFX_RED_SURF', flags: expect.arrayContaining(['SURFING']) });
  await game.eval((t) => t.setAvatarState('ON_FOOT'));
  expect(await game.eval((t) => t.field()!.avatar)).toMatchObject({ graphicsId: 'OBJ_EVENT_GFX_RED_NORMAL', flags: expect.arrayContaining(['ON_FOOT']) });
});

test('with Strength in use, walking into a boulder pushes it, and it can fall through a hole', async () => {
  // Seafoam Islands 1F: a boulder at (22, 12), a hole (MB_FALL_WARP) at (21, 8).
  const game = await session.start({ ...SAFE, map: 'SeafoamIslands_1F', x: 23, y: 12 });
  await repel(game);
  await game.waitIdle();
  const boulder = () => game.eval((t) => t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_PUSHABLE_BOULDER' && o.y >= 8 && o.x < 30));
  expect(await boulder()).toMatchObject({ x: 22, y: 12 });

  // Without FLAG_SYS_USE_STRENGTH it's just in the way
  await game.eval((t) => t.face('left'));
  await game.eval((t) => t.hold('LEFT'));
  await game.eval((t) => t.waitFrames(40));
  await game.eval((t) => t.release());
  expect(await boulder()).toMatchObject({ x: 22, y: 12 });

  await game.eval((t) => t.state!.setFlag('FLAG_SYS_USE_STRENGTH', true));
  await game.waitIdle();
  // Hold, watch and release in one eval, so a busy machine can't miss the action or overshoot.
  const pushed = await game.eval(async (t) => {
    t.hold('LEFT');
    const r = await t.until(() => t.field()?.avatar.action === 'WALK_IN_PLACE_NORMAL_LEFT', 60);
    t.release();
    return r;
  });
  expect(pushed).toBe(true);
  await game.eval((t) => t.until(() => !t.objects().some((o) => o.moving), 120));
  await game.waitIdle();
  expect(await boulder()).toMatchObject({ x: 21, y: 12 });
  expect(await game.eval((t) => t.field()!)).toMatchObject({ x: 23, y: 12 }); // the player stays put

  // Up the column to the hole: HandleBoulderFallThroughHole removes it and reveals its twin on B1F.
  expect(await game.eval((t) => t.walkTo(21, 13))).toMatchObject({ arrived: true });
  await game.eval((t) => t.face('up'));
  await game.eval((t) => t.hold('UP'));
  await game.eval((t) => t.until(() => t.flag('FLAG_HIDE_SEAFOAM_1F_BOULDER_1'), 900));
  await game.eval((t) => t.release());
  expect(await game.eval((t) => t.flag('FLAG_HIDE_SEAFOAM_1F_BOULDER_1'))).toBe(true);
  expect(await game.eval((t) => t.flag('FLAG_HIDE_SEAFOAM_B1F_BOULDER_1'))).toBe(false);
  expect(await boulder()).toBeUndefined();
});
