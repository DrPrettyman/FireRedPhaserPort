// Staircase warps (world/stairWarp.ts) and the warp arrow (world/playerAvatar.ts' HandleWarpArrowSpriteHideShow).
//
// field_control_avatar.c's TryArrowWarp runs DoStairWarp on MB_*_STAIR_WARP when the player pushes the stairs' way
// (west for the *_LEFT ones, east for *_RIGHT); off the bike first, with a 12-frame delay. field_fadetransition.c's
// Task_StairWarp: state 0 locks and freezes; state 1 waits for the player's held movement, counts the delay down,
// then TryFadeOutOldMapMusic, PlayRainStoppingSoundEffect, oam.priority 1, the walk in place and SE_EXIT; states 2-3
// slide the sprite (UpdateStairsMovement: speed in 1/32 px, y going up only after 6 frames) and start the fade on
// the 12th frame; then WarpIntoMap. On arrival SetUpWarpExitTask picks Task_ExitStairs (unless
// gExitStairsMovementDisabled: CONTINUE sets it): the sprite starts 16 frames' worth into the stairs and slides
// out, walking in place fast away from them.
//
// Frames: the port's CB1 at the end of tick N is the GBA's CB1 of frame N + 1, whose RunTasks is the port's tick
// N + 1: so Task_StairWarp's state 1 runs the tick after the push (delay 0), 13 ticks after it on the bike.

import { expect, test } from 'vitest';
import { useGame, type Game, type StartOptions } from './harness';

const session = useGame();

const SAFE: StartOptions = { start: 'after-rival', party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] };

/** GetStairsMovementDirection */
const SPEED: Record<string, [number, number]> = {
  MB_UP_RIGHT_STAIR_WARP: [16, -10],
  MB_UP_LEFT_STAIR_WARP: [-17, -10],
  MB_DOWN_RIGHT_STAIR_WARP: [17, 3],
  MB_DOWN_LEFT_STAIR_WARP: [-17, 3],
};

type Tick = { frame: number; map: string; x2: number; y2: number; priority: number; action?: string; facing: string; flags: string[]; gfx: string };

/**
 * Hold `dir` (on the stairs, or a tile before them) until the stair warp starts, and watch each tick until the walk out
 * on the other floor is over (or, with `noExit`, the field is idle there). One eval: hold, watch and release.
 */
async function takeStairs(game: Game, dir: 'LEFT' | 'RIGHT', noExit = false) {
  // Facing the stairs first: pushing them while still turning, the stair warp starts at once but waits for the
  // turn's walk in place (Task_StairWarp's state 1), which would shift the frames below.
  if ((await game.eval((t) => t.field()!.avatar.flags)).includes('ON_FOOT')) {
    await game.eval((t, d) => t.face(d), dir.toLowerCase() as 'left' | 'right');
    await game.waitIdle();
  }
  const since = await game.mark();
  const { ok, ticks } = await game.eval(
    async (t, dir, since, noExit) => {
      const ticks: Tick[] = [];
      const from = t.field()!.map;
      t.hold(dir);
      let held = true;
      const ok = await t.until(() => {
        const f = t.field();
        if (!f) return false;
        const evs = t.events(since);
        if (held && evs.some((e) => e.type === 'stairWarp')) {
          t.release();
          held = false;
        }
        const a = f.avatar;
        ticks.push({ frame: t.frame() - 1, map: f.map, x2: a.spriteX2, y2: a.spriteY2, priority: a.priority, action: a.action, facing: f.facing, flags: a.flags, gfx: a.graphicsId });
        if (f.map === from) return false;
        return noExit ? t.idle() : evs.some((e) => e.type === 'exitStairsDone') && t.idle();
      }, 20000);
      if (held) t.release();
      return { ok, ticks };
    },
    dir,
    since,
    noExit,
  );
  expect(ok).toBe(true);
  const events = await game.events(since);
  const audio = await game.eval((t, s) => t.audioEvents(s), since);
  const at = (type: string) => events.find((e) => e.type === type)?.frame as number;
  const tick = (frame: number) => ticks.find((k) => k.frame === frame)!;
  return { ticks, events, audio, at, tick };
}

/** The walk in: Task_StairWarp's frames and the sprite's slide, for a staircase of `behavior`. */
function checkWalkIn(r: Awaited<ReturnType<typeof takeStairs>>, behavior: string, delay: number) {
  const S = r.at('stairWarp');
  const M = r.at('stairWarpMove');
  expect(r.events.find((e) => e.type === 'stairWarp')).toMatchObject({ delay });
  expect(M - S).toBe(1 + delay);
  expect(r.at('stairWarpFadeOut') - M).toBe(12);
  // SE_EXIT with the walk in place (ForceStairsMovement), the player's OAM priority 1
  expect(r.audio.find((e) => e.type === 'se' && e.name === 'SE_EXIT')?.frame).toBe(M);
  expect(r.tick(M)).toMatchObject({ x2: 0, y2: 0, priority: 1 });
  expect(r.tick(M).action).toBe(`WALK_IN_PLACE_NORMAL_${r.tick(M).facing.toUpperCase()}`);
  // UpdateStairsMovement: y only after the first 6 frames going up
  const [sx, sy] = SPEED[behavior];
  let ox = 0;
  let oy = 0;
  for (let k = 1; k <= 12; k++) {
    if (sy > 0 || k - 1 > 6) oy += sy;
    ox += sx;
    expect([k, r.tick(M + k).x2, r.tick(M + k).y2, r.tick(M + k).priority]).toEqual([k, ox >> 5, oy >> 5, 1]);
  }
}

/** The walk out: Task_ExitStairs on a staircase of `behavior` (the first tick of the walk in place fast is state 0). */
function checkWalkOut(r: Awaited<ReturnType<typeof takeStairs>>, map: string, behavior: string) {
  const away = behavior.includes('RIGHT') ? 'LEFT' : 'RIGHT';
  const arrived = r.ticks.filter((k) => k.map === map);
  const i0 = arrived.findIndex((k) => k.action === `WALK_IN_PLACE_FAST_${away}`);
  expect(i0).toBeGreaterThanOrEqual(0);
  const T0 = arrived[i0].frame;
  const [sx, sy] = SPEED[behavior];
  const expected: [number, number][] = [];
  for (let j = 0; j <= 17; j++) {
    const ox = sx * 16 - sx * Math.min(j, 16);
    const oy = sy * 16 - sy * Math.min(j, 16);
    expected.push([ox >> 5, oy >> 5]);
  }
  expect(arrived.filter((k) => k.frame >= T0 && k.frame <= T0 + 17).map((k) => [k.x2, k.y2])).toEqual(expected);
  // the field's fade in is longer than the 17 frames: Task_ExitStairs waits for it, then gives the controls back
  expect(r.at('exitStairsDone')).toBeGreaterThanOrEqual(T0 + 17);
  expect(arrived.at(-1)).toMatchObject({ x2: 0, y2: 0, facing: away.toLowerCase() });
}

test('on foot: down the stairs of the player\'s house, the walk in, the warp and the walk out', async () => {
  const game = await session.start({ ...SAFE, map: 'PalletTown_PlayersHouse_2F', x: 10, y: 2 });
  await game.waitIdle();
  const r = await takeStairs(game, 'LEFT');
  checkWalkIn(r, 'MB_DOWN_LEFT_STAIR_WARP', 0);
  // 1F's (10, 2) is MB_UP_RIGHT_STAIR_WARP: the player comes out walking west
  checkWalkOut(r, 'PalletTown_PlayersHouse_1F', 'MB_UP_RIGHT_STAIR_WARP');
  const f = await game.eval((t) => t.field()!);
  expect(f).toMatchObject({ map: 'PalletTown_PlayersHouse_1F', x: 10, y: 2, facing: 'left', locked: false });
  // and back up (UP_RIGHT: y waits 6 frames), out of 2F's DOWN_LEFT stairs walking east
  const up = await takeStairs(game, 'RIGHT');
  checkWalkIn(up, 'MB_UP_RIGHT_STAIR_WARP', 0);
  checkWalkOut(up, 'PalletTown_PlayersHouse_2F', 'MB_DOWN_LEFT_STAIR_WARP');
});

test('on the bike: a stair warp gets the player off it and waits 12 frames first', async () => {
  // Route 16's north gate allows cycling; its stairs at (9, 16) are MB_UP_RIGHT_STAIR_WARP to 2F (10, 9)
  const game = await session.start({ ...SAFE, map: 'Route16_NorthEntrance_1F', x: 8, y: 16 });
  await game.waitIdle();
  await game.eval((t) => t.setAvatarState('MACH_BIKE'));
  await game.waitFor((t) => t.idle() && t.field()?.avatar.flags.includes('MACH_BIKE'), { what: 'the player on the bike' });
  const r = await takeStairs(game, 'RIGHT');
  const S = r.at('stairWarp');
  // SetPlayerAvatarTransitionFlags(PLAYER_AVATAR_FLAG_ON_FOOT) before DoStairWarp
  expect(r.tick(S)).toMatchObject({ gfx: 'OBJ_EVENT_GFX_RED_NORMAL' });
  expect(r.tick(S).flags).toContain('ON_FOOT');
  checkWalkIn(r, 'MB_UP_RIGHT_STAIR_WARP', 12);
  checkWalkOut(r, 'Route16_NorthEntrance_2F', 'MB_DOWN_LEFT_STAIR_WARP');
  const f = await game.eval((t) => t.field()!);
  expect(f).toMatchObject({ map: 'Route16_NorthEntrance_2F', x: 10, y: 9 });
  expect(f.avatar.flags).toContain('ON_FOOT');
});

/** START → SAVE → YES (a new file), then wait for the field. */
async function save(game: Game): Promise<void> {
  await game.waitIdle();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  const downs = (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length;
  await game.pressTimes('DOWN', downs);
  await game.press('A');
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press('UP');
  await game.press('A');
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
}

test('CONTINUE on a staircase doesn\'t walk out of it (gExitStairsMovementDisabled); the next stair warp does', async () => {
  const game = await session.start({ ...SAFE, map: 'PalletTown_PlayersHouse_2F', x: 10, y: 2 });
  await game.waitIdle();
  await save(game);
  await game.load({ keepSave: true, mainMenu: true });
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading, { what: 'the main menu' });
  const since = await game.mark();
  const watch = game.eval(
    (t, since) => {
      let maxX2 = 0;
      return t
        .until(() => {
          const f = t.field();
          if (!f) return false;
          maxX2 = Math.max(maxX2, Math.abs(f.avatar.spriteX2), Math.abs(f.avatar.spriteY2));
          return f.map === 'PalletTown_PlayersHouse_2F' && !f.questLogPlayback && t.idle() && t.events(since).some((e) => e.type === 'map');
        }, 20000)
        .then((ok) => ({ ok, maxX2 }));
    },
    since,
  );
  await game.press('A'); // CONTINUE
  await game.mashUntil((t) => !t.field()?.questLogPlayback && t.idle() && t.field()?.map === 'PalletTown_PlayersHouse_2F', { button: 'B', what: 'the saved field' });
  const seen = await watch;
  expect(seen.ok).toBe(true);
  expect(seen.maxX2).toBe(0);
  expect((await game.events(since)).map((e) => e.type)).not.toContain('exitStairs');
  expect(await game.eval((t) => ({ x: t.field()!.x, y: t.field()!.y }))).toEqual({ x: 10, y: 2 });
  // SetUpWarpExitTask cleared it: the stairs down walk out on 1F
  const r = await takeStairs(game, 'LEFT');
  checkWalkOut(r, 'PalletTown_PlayersHouse_1F', 'MB_UP_RIGHT_STAIR_WARP');
});

test('the warp arrow shows on an arrow mat while the player faces its way, and hides when they turn away', async () => {
  // The player's house 1F (4, 8) is MB_SOUTH_ARROW_WARP
  const game = await session.start({ ...SAFE, map: 'PalletTown_PlayersHouse_1F', x: 4, y: 7 });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.warpArrow?.visible ?? false)).toBe(false);
  // one step down onto the mat; the arrow shows under it (anim 0: sArrowAnim_South, frames 2 and 3) as the
  // step's PlayerStep calls see the mat (the warp itself needs DOWN held at the tile's centre)
  const seen = await game.eval(async (t) => {
    t.hold('DOWN');
    const ok = await t.until(() => {
      const f = t.field()!;
      if (f.moving || f.y === 8) t.release();
      return f.y === 8 && !f.moving && t.idle();
    }, 600);
    t.release();
    return { ok, map: t.field()!.map };
  });
  expect(seen.ok).toBe(true);
  expect(seen.map).toBe('PalletTown_PlayersHouse_1F');
  const f = await game.eval((t) => t.field()!);
  expect(f.warpArrow).toMatchObject({ visible: true, x: f.worldX, y: f.worldY + 1, animNum: 0 });
  expect([2, 3]).toContain(f.warpArrow!.image);
  // its anim alternates every 32 frames
  const images = await game.eval(async (t) => {
    const seen = new Set<number>();
    await t.until(() => (seen.add(t.field()!.warpArrow!.image), seen.size === 2), 80);
    return [...seen].sort();
  });
  expect(images).toEqual([2, 3]);
  // turning west (movementDirection) hides it; back south shows it again
  await game.eval((t) => t.face('left'));
  await game.eval((t) => t.waitFrames(2));
  expect(await game.eval((t) => t.field()!.warpArrow?.visible)).toBe(false);
  await game.eval((t) => t.face('down'));
  await game.eval((t) => t.waitFrames(2));
  expect(await game.eval((t) => t.field()!.warpArrow)).toMatchObject({ visible: true, animNum: 0 });
  expect(await game.eval((t) => t.field()!.map)).toBe('PalletTown_PlayersHouse_1F');
  // pushing on: DoWarp to Pallet Town; the arrow stays up through the fade, and the new map has none until a mat
  expect(await game.eval((t) => t.enterWarp())).toBe('PalletTown');
  expect(await game.eval((t) => t.field()!.warpArrow?.visible ?? false)).toBe(false);
});
