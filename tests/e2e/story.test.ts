// Headless story checks, Brock to Lt. Surge: each gym from the state the story would have reached (flags,
// badges, a strong party), the gym walked and its leader beaten (the badge flag and the TM), plus the story
// events the decomp makes required between them (Bill's Sea Cottage, the S.S. Anne captain and HM01 Cut, the
// cut tree in front of Vermilion Gym). Gym trainers are set as beaten unless the check is about them.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

/** Set trainers' flags (TRAINER_FLAGS_START + TRAINER_*), as if beaten. */
async function beatTrainers(game: Game, names: string[]): Promise<void> {
  await game.eval((t, names) => {
    for (const n of names) t.state!.setFlag(t.define('TRAINER_FLAGS_START') + t.define(`TRAINER_${n}`));
  }, names);
}

async function setFlags(game: Game, flags: string[]): Promise<void> {
  await game.eval((t, flags) => {
    for (const f of flags) t.state!.setFlag(f);
  }, flags);
}

/** Facing something to talk to (an NPC, a sign): press A until a message shows, then through it until the field is free. */
async function talk(game: Game, what: string): Promise<void> {
  await game.waitIdle();
  await game.mashUntil((t) => t.message() !== undefined || !t.idle(), { what: `${what} to start` });
  await game.mashUntil((t) => t.idle(), { what: `${what} to end` });
}

/** Walk next to (x, y) from the side `from` and face it. */
async function approach(game: Game, x: number, y: number, from: 'below' | 'above' | 'left' | 'right'): Promise<void> {
  const [dx, dy, face] = { below: [0, 1, 'up'], above: [0, -1, 'down'], left: [-1, 0, 'right'], right: [1, 0, 'left'] }[from] as [number, number, 'up' | 'down' | 'left' | 'right'];
  const r = await game.eval((t, x, y) => t.walkTo(x, y), x + dx, y + dy);
  expect(r, `walking next to (${x}, ${y})`).toMatchObject({ arrived: true });
  await game.eval((t, f) => t.face(f), face);
}

/** A leader's battle: talk, fight to the end, then press through the badge and TM text until the field is free. */
async function beatLeader(game: Game, x: number, y: number, from: 'below' | 'above' | 'left' | 'right'): Promise<void> {
  await approach(game, x, y, from);
  const since = await game.mark();
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleStart'), { what: 'the leader battle' });
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  const end = await game.waitForEvent('battleEnd', { since });
  expect(await game.eval((t, n) => t.nameOf('B_OUTCOME_', n), end.outcome as number)).toBe('B_OUTCOME_WON');
  await game.mashUntil((t) => t.idle(), { what: 'the badge and TM text' });
}

// ------------------------------------------------------------------ Lt. Surge (VermilionCity_Gym)

/** Map-local position of trash can `i` (1-15; five per row, rows at y = 10, 12, 14). */
function canPos(i: number): [number, number] {
  return [1 + 2 * ((i - 1) % 5), 10 + 2 * Math.floor((i - 1) / 5)];
}

async function checkCan(game: Game, i: number): Promise<void> {
  const [x, y] = canPos(i);
  await approach(game, x, y, 'below');
  await talk(game, `trash can ${i}`);
}

/** The beam's middle cell (5, 6): impassable while either lock is on. */
async function beamBlocked(game: Game): Promise<boolean> {
  return game.eval((t) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const f = t.field()!;
    return s.world.tileAt(f.worldX - f.x + 5, f.worldY - f.y + 6).collision !== 0;
  });
}

test('Lt. Surge: the trash can switches (a wrong second can resets them), then the battle, the badge and TM34', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity_Gym', x: 5, y: 19, party: [MEWTWO] });
  await setFlags(game, ['FLAG_BADGE01_GET', 'FLAG_BADGE02_GET', 'FLAG_GOT_HM01']);
  await beatTrainers(game, ['SAILOR_DWAYNE', 'ENGINEER_BAILY', 'GENTLEMAN_TUCKER']);
  // VermilionCity_Gym_OnTransition: SetVermilionTrashCans → VAR_TEMP_0 / VAR_TEMP_1, neighbouring cans.
  const cans = () => game.eval((t) => [t.var('VAR_TEMP_0'), t.var('VAR_TEMP_1')] as [number, number]);
  let [first, second] = await cans();
  expect(first).toBeGreaterThanOrEqual(1);
  expect(first).toBeLessThanOrEqual(15);
  const [fx, fy] = canPos(first);
  const [sx, sy] = canPos(second);
  expect(Math.abs(fx - sx) + Math.abs(fy - sy)).toBe(2);
  expect(await beamBlocked(game)).toBe(true);

  // The first switch, then a can that isn't the second: the locks reset and new cans are picked.
  await checkCan(game, first);
  expect(await game.eval((t) => t.flag('FLAG_TEMP_1'))).toBe(true);
  const wrong = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].find((i) => i !== first && i !== second)!;
  await checkCan(game, wrong);
  expect(await game.eval((t) => t.flag('FLAG_TEMP_1'))).toBe(false);
  expect(await beamBlocked(game)).toBe(true);

  // Both switches: the beam is gone.
  [first, second] = await cans();
  await checkCan(game, first);
  expect(await game.eval((t) => t.flag('FLAG_TEMP_1'))).toBe(true);
  await checkCan(game, second);
  expect(await game.eval((t) => t.flag('FLAG_FOUND_BOTH_VERMILION_GYM_SWITCHES'))).toBe(true);
  expect(await beamBlocked(game)).toBe(false);

  await beatLeader(game, 5, 2, 'below');
  expect(await game.eval((t) => t.flag('FLAG_BADGE03_GET'))).toBe(true);
  expect(await game.eval((t) => t.flag('FLAG_DEFEATED_LT_SURGE'))).toBe(true);
  expect(await game.eval((t) => t.itemCount('TM34'))).toBe(1);
});
