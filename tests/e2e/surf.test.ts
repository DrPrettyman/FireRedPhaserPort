// Surf and Waterfall (world/surf.ts): pressing A at the water (GetInteractedWaterScript → EventScript_UseSurf),
// Surf from the party menu, FldEff_UseSurf's jump onto the surf blob, riding (the blob follows and turns,
// the player bobs on it), getting off, a wild encounter on the water, Waterfall up Icefall Cave's waterfall,
// and the refusals. The party menu is a GBA screen: its steps are timed presses, its messages the
// `partyMenuMessage` events.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const LAPRAS = { species: 'LAPRAS', level: 40, moves: ['SURF', 'WATERFALL'] };
const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };
/** Pallet Town's pond (x 7-10, y 17-19, elevation 1); (8, 16) is the shore above it. */
const PALLET_SHORE = { start: 'after-rival', map: 'PalletTown', x: 8, y: 16 } as const;
/**
 * Four Island's Icefall Cave entrance: a waterfall (MB_WATERFALL) at x 15-19, y 14-20, with water above and
 * below it; (17, 21) is the water at its foot.
 */
const WATERFALL_FOOT = { start: 'after-rival', map: 'FourIsland_IcefallCave_Entrance', x: 17, y: 21 } as const;

async function repel(game: Game) {
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
}

/** START → POKéMON → party slot `mon` → its action menu's entry `action` (SUMMARY, then the field moves) → A. */
async function useFieldMove(game: Game, action = 1, mon = 0) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // POKéMON
  await game.waitForPartyMenu();
  for (let i = 0; i < mon; i++) {
    await game.press('DOWN');
    await game.eval((t) => t.waitFrames(4));
  }
  await game.press('A'); // the mon's action menu
  await game.eval((t) => t.waitFrames(10));
  for (let i = 0; i < action; i++) {
    await game.press('DOWN');
    await game.eval((t) => t.waitFrames(4));
  }
  await game.press('A');
}

/** Wait until the surf / waterfall field effect is over and the field is free. */
async function waitFieldMoveDone(game: Game, what: string) {
  await game.waitFor((t) => t.gbaScreen() === undefined && t.idle() && !t.field()!.fieldEffects.some((e) => /^FLDEFF_(FIELD_MOVE_SHOW_MON|USE_)/.test(e)), { what });
}

/**
 * Watches in the page for the player's movement action to be `action` and returns the field probe at that tick
 * (undefined if it never comes). Start it before the action can happen and await it later: polling from Node
 * can miss an action that lasts a few ticks when the machine is busy.
 */
function watchAction(game: Game, action: string) {
  // the field as it was in that tick: by the time the promise settles (the frame's batch of ticks is over) the
  // action can be done
  return game.eval(async (t, a) => {
    let f = t.field();
    return (await t.until(() => (f = t.field())?.avatar.action === a, 3600)) ? f : undefined;
  }, action);
}

/** The world pixel centre the blob sits at under a player on world tile (x, y): the sprite's y + 8. */
const blobAt = (worldX: number, worldY: number) => ({ x: worldX * 16 + 8, y: worldY * 16 + 8 });

test('pressing A at the water with the badge and a mon that knows SURF: the question, the banner, the jump on', async () => {
  const game = await session.start({ ...PALLET_SHORE, party: [LAPRAS] });
  await repel(game);
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE05_GET', true));
  await game.eval((t) => t.face('down'));
  await game.waitIdle();
  const since = await game.mark();
  // The jump lasts a few ticks: watch for it in the page from now, so a busy machine can't poll past it.
  const jump = watchAction(game, 'JUMP_SPECIAL_DOWN');
  await game.press('A');
  expect((await game.waitForEvent('script', { since })).label).toBe('EventScript_UseSurf');
  await game.waitFor((t) => t.message()?.includes('SURF'), { what: '"The water is dyed a deep blue… Would you like to SURF?"' });
  // YES (the cursor starts there), then "LAPRAS used SURF!"
  await game.mashUntil((t) => t.events().some((e) => e.type === 'fieldMoveShowMon'), { what: 'the banner' });
  expect(await game.waitForEvent('fieldMoveShowMon', { since })).toMatchObject({ species: await game.eval((t) => t.define('SPECIES_LAPRAS')), outdoors: true });

  // UseSurfEffect_4: the RIDE graphics, the jump onto the water, and the blob waiting there (BOB_NONE)
  let f = (await jump)!;
  expect(f, 'the jump onto the water').toBeDefined();
  expect(f.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_SURF');
  expect(f.avatar.flags).toContain('SURFING');
  expect(f.surfBlob).toMatchObject({ ...blobAt(f.worldX, f.worldY), bobState: 0 });

  await waitFieldMoveDone(game, 'the player to land on the blob');
  f = await game.eval((t) => t.field()!);
  expect(f).toMatchObject({ x: 8, y: 17 });
  expect(f.avatar.flags).toContain('SURFING');
  expect(f.avatar.flags).not.toContain('CONTROLLABLE'); // UseSurfEffect_5 clears it
  expect(f.playerEffects).toContain('FLDEFF_SURF_BLOB');
  expect(f.surfBlob).toMatchObject({ ...blobAt(f.worldX, f.worldY), bobState: 1, anim: 0, invisible: false });
});

test('without the badge, or without a mon that knows SURF, A at the water does nothing', async () => {
  const game = await session.start({ ...PALLET_SHORE, party: [LAPRAS] });
  await repel(game);
  await game.eval((t) => t.face('down'));
  await game.waitIdle();
  let since = await game.mark();
  await game.press('A'); // no Soul Badge
  await game.eval((t) => t.waitFrames(30));
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'script')).toBe(false);

  await game.eval((t) => t.state!.setFlag('FLAG_BADGE05_GET', true));
  await game.eval((t, mon) => t.setParty([mon]), MEWTWO); // nobody knows SURF
  await game.waitIdle();
  since = await game.mark();
  await game.press('A');
  await game.eval((t) => t.waitFrames(30));
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'script')).toBe(false);
  expect(await game.eval((t) => t.field()!.avatar.flags)).toContain('ON_FOOT');
});

test('Surf from the party menu jumps onto the water in front (FieldCallback_Surf → FldEff_UseSurf)', async () => {
  const game = await session.start({ ...PALLET_SHORE, party: [LAPRAS] });
  await repel(game);
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE05_GET', true));
  await game.eval((t) => t.face('down'));
  const since = await game.mark();
  await useFieldMove(game, 1); // SURF
  expect(await game.waitForEvent('fieldMoveShowMon', { since })).toMatchObject({ species: await game.eval((t) => t.define('SPECIES_LAPRAS')) });
  await waitFieldMoveDone(game, 'the player to land on the blob');
  const f = await game.eval((t) => t.field()!);
  expect(f).toMatchObject({ x: 8, y: 17 });
  expect(f.avatar).toMatchObject({ graphicsId: 'OBJ_EVENT_GFX_RED_SURF', flags: expect.arrayContaining(['SURFING']) });
  expect(f.surfBlob).toMatchObject({ ...blobAt(f.worldX, f.worldY), bobState: 1 });
  // No script ran: the party menu's callback starts the field effect itself.
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'script')).toBe(false);
});

test('Surf is refused where it can\'t be used, with the party menu\'s reasons', async () => {
  const game = await session.start({ ...PALLET_SHORE, party: [LAPRAS] });
  await repel(game);
  const msg = async (name: string) => game.eval((t, name) => t.define(name), name);
  const lastMessage = (since: number) =>
    game.eval((t, since) => t.events(since).filter((e) => e.type === 'partyMenuMessage').map((e) => e.msgId as number).pop(), since);
  const backToField = () => game.mashUntil((t) => t.gbaScreen() === undefined && t.idle(), { button: 'B', what: 'back on the field' });

  // No Soul Badge: "This can't be used until a new BADGE is obtained." (not a std message), no banner
  await game.eval((t) => t.face('down'));
  let since = await game.mark();
  await useFieldMove(game, 1);
  await game.eval((t) => t.waitFrames(60));
  expect(await game.eval((t) => t.gbaScreen())).toBe('CB2_UpdatePartyMenu');
  await backToField();
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'fieldMoveShowMon')).toBe(false);

  // Facing land: PARTY_MSG_CANT_SURF_HERE
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE05_GET', true));
  await game.eval((t) => t.face('up'));
  since = await game.mark();
  await useFieldMove(game, 1);
  await game.eval((t) => t.waitFrames(60));
  expect(await lastMessage(since)).toBe(await msg('PARTY_MSG_CANT_SURF_HERE'));
  await backToField();
  expect(await game.eval((t) => t.field()!.avatar.flags)).toContain('ON_FOOT');

  // Already on the water: PARTY_MSG_ALREADY_SURFING
  const water = await session.start({ start: 'after-rival', map: 'PalletTown', x: 8, y: 18, party: [LAPRAS] });
  await repel(water);
  await water.eval((t) => t.state!.setFlag('FLAG_BADGE05_GET', true));
  await water.eval((t) => t.face('down'));
  expect(await water.eval((t) => t.field()!.avatar.flags)).toContain('SURFING');
  since = await water.mark();
  await useFieldMove(water, 1);
  await water.eval((t) => t.waitFrames(60));
  expect(await water.eval((t, since) => t.events(since).filter((e) => e.type === 'partyMenuMessage').map((e) => e.msgId as number).pop(), since)).toBe(
    await msg('PARTY_MSG_ALREADY_SURFING'),
  );
  await water.mashUntil((t) => t.gbaScreen() === undefined && t.idle(), { button: 'B', what: 'back on the field' });
  expect((await water.eval((t, since) => t.events(since), since)).some((e) => e.type === 'fieldMoveShowMon')).toBe(false);
});

test('riding: the blob follows the player and turns with them, and the player bobs on it', async () => {
  // Arriving on water starts surfing (GetInitialPlayerAvatarState), and with it the blob (QL_GfxTransition_StartSurf).
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 8, y: 18, party: [MEWTWO] });
  await repel(game);
  await game.waitIdle();
  let f = await game.eval((t) => t.field()!);
  expect(f.avatar.flags).toContain('SURFING');
  expect(f.surfBlob).toMatchObject({ ...blobAt(f.worldX, f.worldY), bobState: 1, anim: 0 });

  expect(await game.walk('right', 1)).toMatchObject({ arrived: true, x: 9 });
  await game.waitIdle();
  f = await game.eval((t) => t.field()!);
  expect(f.surfBlob).toMatchObject({ ...blobAt(f.worldX, f.worldY), anim: 3 }); // facing east
  await game.eval((t) => t.face('up'));
  expect((await game.eval((t) => t.field()!.surfBlob))?.anim).toBe(1);

  // The blob's anim alternates its two frames every 48 frames, and the player rides 1 px lower on the second.
  const y2s = await game.eval(async (t) => {
    const seen: number[] = [];
    for (let i = 0; i < 120; i++) {
      const y2 = t.field()!.surfBlob!.playerY2;
      if (seen[seen.length - 1] !== y2) seen.push(y2);
      await t.waitFrames(1);
    }
    return seen;
  });
  expect(new Set(y2s)).toEqual(new Set([0, 1]));
  expect(y2s.length).toBeGreaterThanOrEqual(3); // 0 → 1 → 0 (or 1 → 0 → 1) in 120 frames
});

test('getting off on the shore: the blob stays on the water during the jump, then goes', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 7, y: 18, party: [MEWTWO] });
  await repel(game);
  await game.waitIdle();
  const start = await game.eval((t) => t.field()!);
  expect(start.surfBlob).toBeDefined();
  await game.eval((t) => t.face('left'));
  const jumping = game.eval((t) =>
    t.until(() => t.field()?.avatar.action === 'JUMP_SPECIAL_WITH_EFFECT_LEFT' && t.field()!.surfBlob, 60).then(() => t.field()!.surfBlob),
  );
  await game.eval((t) => t.walk('left', 1));
  // Task_StopSurfingInit: BOB_MON_ONLY leaves the blob where the player was
  expect(await jumping).toMatchObject({ ...blobAt(start.worldX, start.worldY), bobState: 2 });
  await game.waitFor((t) => t.idle() && t.field()!.avatar.flags.includes('ON_FOOT'), { what: 'the player on land' });
  const f = await game.eval((t) => t.field()!);
  expect(f).toMatchObject({ x: 6, y: 18 });
  expect(f.surfBlob).toBeUndefined();
  expect(f.playerEffects).not.toContain('FLDEFF_SURF_BLOB');
  expect(f.avatar.graphicsId).toBe('OBJ_EVENT_GFX_RED_NORMAL');
});

test('surfing over water meets the map\'s water Pokémon', async () => {
  // Icefall Cave's entrance (water_mons rate 2: Seel, Psyduck, Dewgong, Wooper), the pond at rows 9-11.
  const game = await session.start({ start: 'after-rival', map: 'FourIsland_IcefallCave_Entrance', x: 12, y: 10, party: [MEWTWO] });
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_WHITE_FLUTE_ACTIVE', true)); // ×1.5 (ApplyFluteEncounterRateMod)
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.avatar.flags)).toContain('SURFING');
  for (let i = 0; i < 150 && !(await game.events()).some((e) => e.type === 'battleStart'); i++) {
    await game.walk(i % 2 ? 'left' : 'right', 3);
  }
  const start = await game.waitForEvent('battleStart', { timeout: 1000, what: 'an encounter on the water' });
  expect(start.trainer).toBe(0);
  const wild = await game.waitFor((t) => t.battle()?.mons.length === 2 && t.battle()!.mons[1].species !== 'NONE' && t.battle()!.mons[1], { what: 'the wild mon' });
  expect(['SEEL', 'PSYDUCK', 'DEWGONG', 'WOOPER']).toContain(wild.species);
  // Back on the field after the battle, still surfing, with a (new) blob.
  await game.chooseAction('RUN');
  await game.mashUntil((t) => t.idle(), { what: 'the field to fade back in' });
  const f = await game.eval((t) => t.field()!);
  expect(f.avatar.flags).toContain('SURFING');
  expect(f.surfBlob).toMatchObject({ ...blobAt(f.worldX, f.worldY), bobState: 1 });
  expect(f.fieldEffects.filter((e) => e === 'FLDEFF_SURF_BLOB')).toHaveLength(1);
});

test('Waterfall: a wall of water without it; with the badge and the move, the player rides up', async () => {
  const game = await session.start({ ...WATERFALL_FOOT, party: [LAPRAS] });
  await repel(game);
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.avatar.flags)).toContain('SURFING');
  await game.eval((t) => t.face('up'));
  await game.waitIdle();

  // No Volcano Badge: EventScript_CantUseWaterfall
  let since = await game.mark();
  await game.press('A');
  expect((await game.waitForEvent('script', { since })).label).toBe('EventScript_CantUseWaterfall');
  await game.waitFor((t) => t.message()?.includes('wall of water'), { what: '"A wall of water is crashing down with a mighty roar."' });
  await game.mashUntil((t) => t.idle(), { what: 'the message to close' });

  // With it: "It's a large waterfall. Would you like to use WATERFALL?" → YES, the banner, then up the falls
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE07_GET', true));
  since = await game.mark();
  const climb = watchAction(game, 'WALK_SLOWER_UP');
  await game.press('A');
  expect((await game.waitForEvent('script', { since })).label).toBe('EventScript_Waterfall');
  await game.waitFor((t) => t.message()?.includes('WATERFALL?'), { what: 'the question' });
  await game.mashUntil((t) => t.events().some((e) => e.type === 'fieldMoveShowMon'), { what: 'the banner' });
  expect(await game.waitForEvent('fieldMoveShowMon', { since })).toMatchObject({ species: await game.eval((t) => t.define('SPECIES_LAPRAS')) });
  expect(await climb, 'the climb').toBeDefined();
  await waitFieldMoveDone(game, 'the top of the waterfall');
  const f = await game.eval((t) => t.field()!);
  expect(f).toMatchObject({ x: 17, y: 13 }); // the first tile that isn't MB_WATERFALL
  expect(f.avatar.flags).toContain('SURFING');
  expect(f.surfBlob).toMatchObject({ ...blobAt(f.worldX, f.worldY), bobState: 1, anim: 1 });
  // The controls are back: north on the pond above.
  expect(await game.walk('up', 1)).toMatchObject({ arrived: true, y: 12 });
});

test('Waterfall from the party menu, and refused unless surfing north into one', async () => {
  const game = await session.start({ ...WATERFALL_FOOT, party: [LAPRAS] });
  await repel(game);
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE07_GET', true));
  await game.waitIdle();

  // Facing west, away from the falls: PARTY_MSG_CANT_USE_HERE (sFieldMoveCursorCallbacks' msgId)
  await game.eval((t) => t.face('left'));
  let since = await game.mark();
  await useFieldMove(game, 2); // WATERFALL
  await game.eval((t) => t.waitFrames(60));
  const msgs = await game.eval((t, since) => t.events(since).filter((e) => e.type === 'partyMenuMessage').map((e) => e.msgId as number), since);
  expect(msgs).toContain(await game.eval((t) => t.define('PARTY_MSG_CANT_USE_HERE')));
  await game.mashUntil((t) => t.gbaScreen() === undefined && t.idle(), { button: 'B', what: 'back on the field' });

  await game.eval((t) => t.face('up'));
  since = await game.mark();
  await useFieldMove(game, 2);
  await game.waitForEvent('fieldMoveShowMon', { since });
  await waitFieldMoveDone(game, 'the top of the waterfall');
  expect(await game.eval((t) => t.field()!)).toMatchObject({ x: 17, y: 13 });
});
