// The field moves and the player's gfx in quest log playback (QUEST_LOG_PLAN.md QL5b2): a scene recorded with
// getting off and on a surfing mon, a Strength push, a cast of the rod and the VS Seeker, saved, then played back
// on CONTINUE. quest_log_player.c's sQLGfxTransitions run from QL_UpdateObject with the recorded gfx change
// (QL_GfxTransition_StopSurf* → CreateStopSurfingTask_NoMusicChange, QL_GfxTransition_StartSurf,
// QL_GfxTransition_Fish → Task_QLFishMovement, QL_GfxTransition_VSSeeker → FLDEFF_USE_VS_SEEKER and
// Task_QLVSSeekerMovement); the Strength push is field_player_avatar.c's QL_TryRecordPlayerStepWithDuration0 /
// QL_TryRecordNPCStepWithDuration32 played back as movement actions. Each scene starts standing in place with an
// ARRIVED event (as escalator.test.ts does).
//
// Task_QLFishMovement, from the C: state 0 takes out the rod (frame F); state 1 runs 61 times (data[1] 0..60);
// state 2 starts the put-away anim on F + 62; state 3 waits for it to end and puts the normal graphics back.

import { expect, test } from 'vitest';
import { useGame, type Game, type StartOptions } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };
const SAFE: StartOptions = { start: 'after-rival', party: [MEWTWO] };

/** QL_PLAYER_GFX_* (include/quest_log_player.h; not in the extracted defines) */
const QL_PLAYER_GFX_NORMAL = 0;
const QL_PLAYER_GFX_FISH = 2;
const QL_PLAYER_GFX_SURF = 3;
const QL_PLAYER_GFX_STOP_SURF_W = 6;
const QL_PLAYER_GFX_VSSEEKER = 8;
/** BOB_* (include/field_effect_helpers.h) */
const BOB_PLAYER_AND_MON = 1;
const BOB_MON_ONLY = 2;

async function repel(game: Game) {
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
}

/** A scene starts standing in place (QL_START_NORMAL) with an ARRIVED event in `mapsec`. */
async function startScene(game: Game, mapsec: string) {
  await game.waitIdle();
  await game.eval((t, mapsec) => t.questLogEvent('QL_EVENT_ARRIVED', { mapSec: t.define(mapsec) }), mapsec);
  const ql = await game.eval((t) => t.questLog());
  expect(ql.playbackState).toBe(await game.eval((t) => t.define('QL_PLAYBACK_STATE_RECORDING')));
}

/** The recorded scene's gfx changes: [gfxState, duration] (QL_EVENT_GFX_CHANGE: data.b.gfxState in the high byte). */
async function recordedGfxChanges(game: Game): Promise<[number, number][]> {
  return game.eval((t) => {
    const GFX = t.define('QL_EVENT_GFX_CHANGE');
    const scene = t.questLog().scenes.find((s) => s.commands.length > 0)!;
    return scene.commands.filter((c) => c.id === GFX).map((c) => [c.words[3] >> 8, c.words[1]] as [number, number]);
  });
}

/** START → SAVE → YES (a new file: no overwrite question), then wait for the field (escalator.test.ts). */
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

/** START → BAG → KEY ITEMS → the first item → USE (fieldItems.test.ts' useFirstItem). */
async function useFirstKeyItem(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN'); // BAG (no POKéDEX yet)
  await game.press('A');
  await game.waitForBag();
  await game.press('RIGHT');
  await game.eval((t) => t.waitFrames(20));
  await game.press('A'); // the item's context menu
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // USE
}

type Sample = {
  frame: number;
  map: string;
  x: number;
  y: number;
  gfx: string;
  flags: string[];
  action?: string;
  locked: boolean;
  blob?: number;
  fishing?: { step: number; questLogState?: number; animNum?: number };
  boulder?: { x: number; y: number };
  /** FLDEFF_USE_VS_SEEKER is in the field effects' active list */
  vsSeekerEffect: boolean;
};

/**
 * CONTINUE, then a sample of the field every tick while the quest log plays back (from the page, so nothing
 * that lasts a few ticks is missed), until playback is over; then the saved field.
 */
async function playBack(game: Game): Promise<{ samples: Sample[]; events: { type: string; frame: number }[] }> {
  await game.load({ keepSave: true, mainMenu: true });
  const watch = game.eval(async (t) => {
    const PLAYBACK = t.define('QL_STATE_PLAYBACK');
    const samples: Sample[] = [];
    const ok = await t.until(() => {
      const f = t.field();
      if (!f) return false; // (the main menu)
      const ql = t.questLog();
      if (ql.state === PLAYBACK && f.map) {
        const b = t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_PUSHABLE_BOULDER' && o.y >= 8 && o.x < 30);
        samples.push({
          frame: t.frame() - 1,
          map: f.map,
          x: f.x,
          y: f.y,
          gfx: f.avatar.graphicsId,
          flags: f.avatar.flags,
          action: f.avatar.action,
          locked: f.locked,
          blob: f.surfBlob?.bobState,
          fishing: f.fishing && { step: f.fishing.step, questLogState: f.fishing.questLogState, animNum: f.fishing.animNum },
          boulder: b && { x: b.x, y: b.y },
          vsSeekerEffect: f.fieldEffects.includes('FLDEFF_USE_VS_SEEKER'),
        });
      }
      return samples.length > 0 && !ql.playback.active;
    }, 30000);
    if (!ok) throw new Error('the playback never ended');
    return samples;
  });
  const since = await game.mark();
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading, { what: 'the main menu' });
  await game.press('A');
  const samples = await watch;
  const events = (await game.events(since)) as { type: string; frame: number }[];
  return { samples, events };
}

test('getting off a surfing mon and on again: the dismount and QL_GfxTransition_StartSurf play back', async () => {
  // Pallet Town's pond (playerAvatar.test.ts): arriving on water at (8, 18) starts the player surfing; west of
  // (7, 18) is the land at (6, 18), elevation 3 (CanStopSurfing).
  const game = await session.start({ ...SAFE, map: 'PalletTown', x: 8, y: 18 });
  await repel(game);
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.avatar.flags)).toContain('SURFING');
  await startScene(game, 'MAPSEC_PALLET_TOWN');
  await game.eval((t) => t.walk('left', 2)); // a step on the water, then the dismount
  await game.waitFor((t) => t.idle() && t.field()?.avatar.flags.includes('ON_FOOT'), { what: 'the player on land' });
  expect(await game.eval((t) => t.field()!)).toMatchObject({ x: 6, y: 18 });
  // Back on the mon: Seafoam B4F's ForcePlayerToStartSurfing (SetPlayerAvatarTransitionFlags → PlayerAvatarTransition_Surfing)
  await game.eval((t) => {
    if (!t.runScript('Test_ForceSurf', [['special', 'ForcePlayerToStartSurfing'], ['end']])) throw new Error('no field');
  });
  await game.waitFor((t) => t.idle() && t.field()?.avatar.flags.includes('SURFING'), { what: 'the player surfing again' });
  // Recorded: the dismount with QuestLogRecordPlayerAvatarGfxTransitionWithDuration's 16 frames before the next
  // action, then the surf
  const gfx = await recordedGfxChanges(game);
  expect(gfx.map((g) => g[0])).toEqual([QL_PLAYER_GFX_STOP_SURF_W, QL_PLAYER_GFX_SURF]);
  expect(gfx[1][1]).toBeGreaterThanOrEqual(16);
  await save(game);

  const { samples } = await playBack(game);
  expect(samples[0]).toMatchObject({ map: 'PalletTown', x: 8, y: 18, gfx: 'OBJ_EVENT_GFX_RED_SURF' });
  expect(samples[0].flags).toContain('SURFING');
  // Off: the jump (JUMP_SPECIAL_WITH_EFFECT_LEFT, the blob left on the water: BOB_MON_ONLY), then on foot at (6, 18)
  const jump = samples.findIndex((s) => s.action === 'JUMP_SPECIAL_WITH_EFFECT_LEFT');
  expect(jump).toBeGreaterThan(0);
  expect(samples[jump].blob).toBe(BOB_MON_ONLY);
  const onFoot = samples.findIndex((s, i) => i > jump && s.gfx === 'OBJ_EVENT_GFX_RED_NORMAL');
  expect(samples[onFoot]).toMatchObject({ x: 6, y: 18 });
  expect(samples[onFoot].flags).toContain('ON_FOOT');
  // On again: the surf graphics and a new blob bobbing with the player (BOB_PLAYER_AND_MON)
  const on = samples.findIndex((s, i) => i > onFoot && s.gfx === 'OBJ_EVENT_GFX_RED_SURF');
  expect(on).toBeGreaterThan(onFoot);
  expect(samples[on]).toMatchObject({ x: 6, y: 18, blob: BOB_PLAYER_AND_MON });
  expect(samples[on].flags).toContain('SURFING');
  // Then the saved field: on land, on foot
  await game.waitIdle();
  const f = (await game.eval((t) => t.field()))!;
  expect([f.map, f.x, f.y]).toEqual(['PalletTown', 6, 18]);
});

test('a Strength push plays back: the player walks in place and the boulder slides on', async () => {
  // Seafoam Islands 1F: a boulder at (22, 12) west of the player at (23, 12) (playerAvatar.test.ts).
  const game = await session.start({ ...SAFE, map: 'SeafoamIslands_1F', x: 23, y: 12 });
  await repel(game);
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_USE_STRENGTH', true));
  await game.eval((t) => t.face('left'));
  await startScene(game, 'MAPSEC_SEAFOAM_ISLANDS');
  const pushed = await game.eval(async (t) => {
    t.hold('LEFT');
    const r = await t.until(() => t.field()?.avatar.action === 'WALK_IN_PLACE_NORMAL_LEFT', 60);
    t.release();
    return r;
  });
  expect(pushed).toBe(true);
  await game.eval((t) => t.until(() => !t.objects().some((o) => o.moving), 120));
  await game.waitIdle();
  // Recorded: the player's WALK_IN_PLACE_NORMAL_LEFT with no wait after it, the boulder's WALK_SLOWER_LEFT with 32
  const moves = await game.eval((t) => {
    const MOVEMENT = t.define('QL_EVENT_MOVEMENT');
    const scene = t.questLog().scenes.find((s) => s.commands.length > 0)!;
    return scene.commands.filter((c) => c.id === MOVEMENT).map((c) => ({ localId: c.words[2] & 0xff, action: c.words[3] >> 8, duration: c.words[1] }));
  });
  const [WALK_IN_PLACE_LEFT, WALK_SLOWER_LEFT] = await game.eval((t) =>
    ['MOVEMENT_ACTION_WALK_IN_PLACE_NORMAL_LEFT', 'MOVEMENT_ACTION_WALK_SLOWER_LEFT'].map((n) => t.define(n)),
  );
  const push = moves.findIndex((m) => m.localId === 0 && m.action === WALK_IN_PLACE_LEFT);
  expect(push).toBeGreaterThanOrEqual(0);
  expect(moves[push + 1]).toMatchObject({ action: WALK_SLOWER_LEFT, duration: 0 });
  expect(moves[push + 1].localId).not.toBe(0);
  expect(await game.eval((t) => t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_PUSHABLE_BOULDER' && o.y >= 8 && o.x < 30))).toMatchObject({ x: 21, y: 12 });
  await save(game);

  const { samples } = await playBack(game);
  expect(samples[0]).toMatchObject({ map: 'SeafoamIslands_1F', x: 23, y: 12, boulder: { x: 22, y: 12 } });
  expect(samples.some((s) => s.action === 'WALK_IN_PLACE_NORMAL_LEFT')).toBe(true);
  expect(samples.some((s) => s.boulder?.x === 21 && s.boulder.y === 12)).toBe(true);
  expect(samples.every((s) => s.x === 23 && s.y === 12)).toBe(true); // the player stays put
});

test('a cast of the rod plays back: Task_QLFishMovement takes the rod out for 62 frames, then puts it away', async () => {
  // Pallet Town's bank at (8, 16), the water to the south (fieldItems.test.ts); seed 3 makes Fishing6's roll odd
  // (no bite), so the cast ends on the field rather than in a battle (which would end the scene).
  const game = await session.start({ ...SAFE, map: 'PalletTown', x: 8, y: 16 });
  await repel(game);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_OLD_ROD'), 1));
  await game.eval((t) => t.face('down'));
  await game.eval((t) => {
    void t.seedWhen(() => t.field()?.fishing?.step === 5, 3);
  });
  await startScene(game, 'MAPSEC_PALLET_TOWN');
  const since = await game.mark();
  await useFirstKeyItem(game);
  expect((await game.waitForEvent('fishingResult', { since })).result).toBe('noBite');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'fishingEnd'), { what: 'the message to close' });
  await game.waitIdle();
  // (the NORMAL first is the return from the bag: SpawnObjectEventsOnReturnToField →
  // SetPlayerAvatarObjectEventIdAndObjectId's SetPlayerAvatarExtraStateTransition, recorded as in the C)
  expect((await recordedGfxChanges(game)).map((g) => g[0])).toEqual([QL_PLAYER_GFX_NORMAL, QL_PLAYER_GFX_FISH]);
  await save(game);

  const [TAKE_OUT, PUT_AWAY] = await game.eval((t) => ['ANIM_TAKE_OUT_ROD_SOUTH', 'ANIM_PUT_AWAY_ROD_SOUTH'].map((n) => t.define(n)));
  const { samples, events } = await playBack(game);
  expect(events.some((e) => e.type === 'questLogFishing')).toBe(true);
  expect(events.some((e) => e.type === 'fishing')).toBe(false); // the cast isn't StartFishing again
  const cast = samples.filter((s) => s.fishing?.step === -1);
  expect(cast.length).toBeGreaterThan(0);
  const out = cast.find((s) => s.fishing!.animNum === TAKE_OUT)!;
  const away = cast.find((s) => s.fishing!.animNum === PUT_AWAY)!;
  expect(out.gfx).toBe('OBJ_EVENT_GFX_RED_FISH');
  expect(out.locked).toBe(true); // LockPlayerFieldControls: the actions wait
  expect(away.frame - out.frame).toBe(62);
  // The anim over: the normal graphics, facing the water still
  const after = samples.find((s) => s.frame > away.frame && !s.fishing)!;
  expect(after.gfx).toBe('OBJ_EVENT_GFX_RED_NORMAL');
  expect(after).toMatchObject({ x: 8, y: 16 });
});

test('the VS Seeker plays back: QL_GfxTransition_VSSeeker runs its anim, Task_QLVSSeekerMovement gives the controls back', async () => {
  // Route 3 at (16, 6): Bug Catcher Colton and Lass Janice are in the VS Seeker's range (vsSeeker.test.ts)
  const game = await session.start({ ...SAFE, map: 'Route3', x: 16, y: 6 });
  await repel(game);
  await game.eval((t) => {
    t.state!.bag.add(t.define('ITEM_VS_SEEKER'), 1);
    t.state!.setFlag('FLAG_GOT_VS_SEEKER', true);
    t.state!.trainerRematchStepCounter = 100;
  });
  await startScene(game, 'MAPSEC_ROUTE_3');
  const since = await game.mark();
  await useFirstKeyItem(game);
  expect((await game.waitForEvent('vsSeeker', { since })).result).toBe('canUse');
  await game.waitForEvent('vsSeekerEnd', { since });
  await game.waitIdle();
  // FldEff_UseVsSeeker: QuestLogRecordPlayerAvatarGfxTransitionWithDuration(8, 89)
  const gfx = await recordedGfxChanges(game);
  // (after the return from the bag's NORMAL, as for the rod)
  expect(gfx.map((g) => g[0])).toEqual([QL_PLAYER_GFX_NORMAL, QL_PLAYER_GFX_VSSEEKER]);
  await save(game);

  const { samples, events } = await playBack(game);
  const start = events.find((e) => e.type === 'questLogVsSeeker');
  const end = events.find((e) => e.type === 'questLogVsSeekerEnd');
  expect(start).toBeDefined();
  expect(end).toBeDefined();
  expect(events.some((e) => e.type === 'vsSeeker')).toBe(false); // no Task_VsSeeker_0: no rematch checks
  const during = samples.filter((s) => s.frame > start!.frame && s.frame < end!.frame);
  expect(during.some((s) => s.gfx === 'OBJ_EVENT_GFX_RED_VS_SEEKER')).toBe(true);
  expect(during.every((s) => s.locked)).toBe(true);
  // Task_QLVSSeekerMovement has priority 0: it runs before the effect's task, so it sees UseVsSeekerEffect_4's
  // FieldEffectActiveListRemove the frame after
  const removed = samples.find((s) => s.frame > start!.frame && !s.vsSeekerEffect)!;
  expect(end!.frame - removed.frame).toBe(1);
  const after = samples.find((s) => s.frame > end!.frame)!;
  expect(after.gfx).toBe('OBJ_EVENT_GFX_RED_NORMAL');
  expect(after.locked).toBe(false);
});
