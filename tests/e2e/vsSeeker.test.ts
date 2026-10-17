// The VS Seeker (vs_seeker.c, world/vsSeeker.ts): using it from the bag charged near a beaten trainer (the
// player's VS Seeker anim, the trainers' emotes, the raise-hand movement, the rematch state), talking to him for
// the rematch party, the 100-step charges (in the bag; after a use, EventScript_VsSeekerChargingDone) and its
// messages. Route 3's Youngster Ben (local id 9) stands at (17, 4) facing down with a sight range of 2; Bug
// Catcher Colton (12, 6, facing right, range 3) and Lass Janice (19, 9) are the other trainers in VS Seeker range
// of (16, 6) and (17, 6).
// sRematches' row for Ben is BEN, BEN_2, SKIP, BEN_3, BEN_4; with FLAG_GOT_VS_SEEKER his first rematch is BEN_2.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };
const BEN = 9;
/**
 * GetVsSeekerResponseInArea's roll for Ben is the first Random() of its tick (Random() % 100 < 30 refuses):
 * seed 1 gives 38 (a rematch).
 */
const REMATCH_SEED = 1;

async function repel(game: Game) {
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
}

/** The VS Seeker in the bag, FLAG_GOT_VS_SEEKER, and `steps` on the in-bag charge counter. */
async function giveVsSeeker(game: Game, steps: number) {
  await game.eval((t, steps) => {
    t.state!.bag.add(t.define('ITEM_VS_SEEKER'), 1);
    t.state!.setFlag('FLAG_GOT_VS_SEEKER', true);
    t.state!.trainerRematchStepCounter = steps;
  }, steps);
}

/**
 * START → BAG → KEY ITEMS → the first item → USE. The start menu and the bag remember where they were: the
 * first time, BAG is one down from POKéMON (no POKéDEX yet) and KEY ITEMS one right of ITEMS; after that, neither.
 */
async function useVsSeeker(game: Game, again = false) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  if (!again) await game.press('DOWN');
  await game.press('A');
  // The bag's graphics load asynchronously, so a fixed wait can end before it's up on a loaded machine.
  await game.waitFor((t) => t.gbaScreen() === 'CB2_BagMenuRun', { what: 'the bag' });
  await game.eval((t) => t.waitFrames(30)); // the bag's fade in
  if (!again) {
    await game.press('RIGHT');
    await game.eval((t) => t.waitFrames(20));
  }
  await game.press('A'); // the item's context menu
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // USE
}

/** Seed the RNG at the start of the tick GetVsSeekerResponseInArea runs (FLDEFF_USE_VS_SEEKER has just ended). */
async function seedResponse(game: Game, seed: number) {
  await game.eval((t, seed) => {
    void t.seedWhen(() => {
      const f = t.field();
      return f?.vsSeeker?.func === 2 && !f.fieldEffects.includes('FLDEFF_USE_VS_SEEKER');
    }, seed);
  }, seed);
}

/** Press A until event `type` (reported after `since`) comes, and return it. (mashUntil's check can't take arguments.) */
async function mashUntilEvent(game: Game, type: string, since: number, what: string) {
  await game.eval((_t, w) => ((globalThis as { __vsWait?: unknown }).__vsWait = w), { type, since });
  return game.mashUntil(
    (t) => {
      const w = (globalThis as { __vsWait?: { type: string; since: number } }).__vsWait!;
      return t.events(w.since).find((e) => e.type === w.type);
    },
    { what },
  );
}

const ben = (game: Game) => game.eval((t, id) => t.objects().find((o) => o.localId === id)!, BEN);

test('beat Ben, use the charged VS Seeker: "!!" and a raised hand, and talking to him starts his rematch', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route3', x: 16, y: 6, party: [MEWTWO] });
  await repel(game);
  // Beat him first: one step right into his view
  let since = await game.mark();
  await game.eval((t) => t.walk('right', 1));
  await game.waitForEvent('trainerApproach', { since, what: 'Ben to spot the player' });
  const first = await mashUntilEvent(game, 'battleStart', since, 'Ben’s battle');
  expect(first.trainer).toBe(await game.eval((t) => t.define('TRAINER_YOUNGSTER_BEN')));
  await mashUntilEvent(game, 'battleEnd', since, 'the battle to end');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'Ben’s post-battle line' });
  expect(await game.eval((t) => t.trainerDefeated('YOUNGSTER_BEN'))).toBe(true);
  expect(await game.eval((t) => t.field()!)).toMatchObject({ x: 17, y: 6 });
  expect(await ben(game)).toMatchObject({ x: 17, y: 5, movementType: 'MOVEMENT_TYPE_FACE_DOWN' });

  await repel(game);
  await giveVsSeeker(game, 100);
  await seedResponse(game, REMATCH_SEED);
  // Watch in the page: the player's VS Seeker graphics and anim, the emotes, Ben's jump with his hand up
  const watched = game.eval(async (t, id) => {
    const seen = { gfx: '', animNum: -1, emotes: new Set<string>(), jumpY2: 0, raiseHandFrame: false };
    await t.until(() => {
      const f = t.field();
      if (f?.vsSeeker?.animNum !== undefined) {
        seen.gfx ||= f.avatar.graphicsId;
        seen.animNum = f.vsSeeker.animNum;
      }
      for (const e of f?.fieldEffects ?? []) if (e.endsWith('_ICON')) seen.emotes.add(e);
      const b = t.objects().find((o) => o.localId === id);
      if (b && b.movementType === 'MOVEMENT_TYPE_RAISE_HAND_AND_JUMP') {
        seen.jumpY2 = Math.min(seen.jumpY2, b.y2);
        seen.raiseHandFrame ||= b.frame === 9;
      }
      return seen.jumpY2 < 0 && seen.raiseHandFrame;
    }, 20000);
    return { ...seen, emotes: [...seen.emotes].sort() };
  }, BEN);
  since = await game.mark();
  await useVsSeeker(game);
  expect((await game.waitForEvent('vsSeeker', { since })).result).toBe('canUse');
  expect((await game.waitForEvent('vsSeekerResponse', { since })).response).toBe('foundRematches');
  await game.waitForEvent('vsSeekerEnd', { since });
  const w = await watched;
  expect(w.gfx).toBe('OBJ_EVENT_GFX_RED_VS_SEEKER');
  expect(w.animNum).toBe(await game.eval((t) => t.define('ANIM_VS_SEEKER')));
  // Ben wants a rematch; Colton and Janice haven't been fought
  expect(w.emotes).toEqual(['FLDEFF_DOUBLE_EXCL_MARK_ICON', 'FLDEFF_EXCLAMATION_MARK_ICON']);
  expect(w.jumpY2).toBeLessThan(0);
  const f = await game.eval((t) => t.field()!);
  expect(f.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_NORMAL');
  expect(f.vsSeeker).toBeUndefined();
  expect(await ben(game)).toMatchObject({ x: 17, y: 5, facing: 'down', movementType: 'MOVEMENT_TYPE_RAISE_HAND_AND_JUMP' });
  const st = await game.eval((t) => ({
    rematches: t.state!.trainerRematches,
    counter: t.state!.trainerRematchStepCounter,
    charging: t.flag('FLAG_SYS_VS_SEEKER_CHARGING'),
  }));
  expect(st.rematches[BEN]).toBe(1); // BEN_2's index in the row
  expect(st.counter).toBe(0); // in-bag charge used up, charging from 0
  expect(st.charging).toBe(true);

  // Talk to him (he's one tile up, facing down): his rematch party
  await game.eval((t) => t.face('up'));
  since = await game.mark();
  await game.press('A');
  const rematch = await mashUntilEvent(game, 'battleStart', since, 'the rematch');
  expect(rematch.trainer).toBe(await game.eval((t) => t.define('TRAINER_YOUNGSTER_BEN_2')));
  await mashUntilEvent(game, 'battleEnd', since, 'the rematch to end');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'back on the field' });
  expect(await game.eval((t) => t.trainerDefeated('YOUNGSTER_BEN_2'))).toBe(true);
  expect(await game.eval((t, id) => t.state!.trainerRematches[id], BEN)).toBe(0);
  expect((await ben(game)).movementType).toBe('MOVEMENT_TYPE_FACE_DOWN');
  // Talking again: the post-battle line, no battle
  since = await game.mark();
  await game.press('A');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'his post-battle line' });
  expect((await game.events(since)).some((e) => e.type === 'battleStart')).toBe(false);
});

test('uncharged: the steps still needed; charged with no trainers in range: turned off', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 13, party: [MEWTWO] });
  await giveVsSeeker(game, 0);
  // UpdateVsSeekerStepCounter: each step with it in the bag charges it
  await game.eval((t) => t.walk('down', 3));
  await game.waitIdle();
  expect(await game.eval((t) => t.state!.trainerRematchStepCounter)).toBe(3);
  let since = await game.mark();
  await useVsSeeker(game);
  expect((await game.waitForEvent('vsSeeker', { since })).result).toBe('notCharged');
  await game.mashUntil((t) => t.message()?.includes('battery: 97'), { what: '"No. of steps required … 97"' });
  await mashUntilEvent(game, 'vsSeekerEnd', since, 'the message to close');
  let f = await game.eval((t) => t.field()!);
  expect(f.message).toBeUndefined();
  expect(f.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_NORMAL');
  // The controls are back
  await game.eval((t) => t.walk('up', 1));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.y)).toBe(15);

  // Fully charged, but Pallet Town has no trainers
  await game.eval((t) => (t.state!.trainerRematchStepCounter = 100));
  since = await game.mark();
  await useVsSeeker(game, true);
  expect((await game.waitForEvent('vsSeeker', { since })).result).toBe('noOneInRange');
  await game.mashUntil((t) => t.message()?.includes('turned off'), { what: '"The VS SEEKER was turned off."' });
  await mashUntilEvent(game, 'vsSeekerEnd', since, 'the message to close');
  f = await game.eval((t) => t.field()!);
  expect(f.message).toBeUndefined();
  expect(await game.eval((t) => t.state!.trainerRematchStepCounter)).toBe(100); // not used up
});

test('100 steps after a use, EventScript_VsSeekerChargingDone: the rematch is off and Ben looks around again', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route3', x: 16, y: 6, party: [MEWTWO] });
  await repel(game);
  await game.eval((t) => t.state!.setFlag(t.define('TRAINER_FLAGS_START') + t.define('TRAINER_YOUNGSTER_BEN'), true));
  await giveVsSeeker(game, 100);
  await seedResponse(game, REMATCH_SEED);
  let since = await game.mark();
  await useVsSeeker(game);
  expect((await game.waitForEvent('vsSeekerResponse', { since })).response).toBe('foundRematches');
  await game.waitForEvent('vsSeekerEnd', { since });
  await game.waitIdle();
  expect((await ben(game)).movementType).toBe('MOVEMENT_TYPE_RAISE_HAND_AND_JUMP');
  // 99 of the 100 charging steps done: the next step finishes the charge
  await game.eval((t) => (t.state!.trainerRematchStepCounter = (99 << 8) | (t.state!.trainerRematchStepCounter & 0xff)));
  since = await game.mark();
  await game.eval((t) => t.walk('right', 1)); // (not left: that's in Colton's view)
  const script = await game.waitForEvent('script', { since });
  expect(script.label).toBe('EventScript_VsSeekerChargingDone');
  await game.waitFor((t) => t.idle() && !t.field()!.script, { what: 'the script to end' });
  const b = await ben(game);
  expect(b.movementType).toMatch(/^MOVEMENT_TYPE_FACE_(UP|DOWN|LEFT|RIGHT)$/);
  expect(b.y2).toBe(0);
  const st = await game.eval((t) => ({ rematch: t.state!.trainerRematches[9] ?? 0, counter: t.state!.trainerRematchStepCounter, charging: t.flag('FLAG_SYS_VS_SEEKER_CHARGING') }));
  expect(st).toEqual({ rematch: 0, counter: 1, charging: false });
  // Talking to him now (from (17, 5)): the post-battle line, no rematch
  await game.eval((t) => t.walk('up', 1));
  await game.waitIdle();
  await game.eval((t) => t.face('up'));
  since = await game.mark();
  await game.press('A');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'his post-battle line' });
  expect((await game.events(since)).some((e) => e.type === 'battleStart')).toBe(false);
});
