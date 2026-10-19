// The Trainer Tower without its battles (POSTGAME_PLAN.md W-ttower unit 1; trainer_tower.c in world/trainerTower.ts):
// the lobby's receptionist starts a challenge (TrainerTower_Lobby_EventScript_EntryTrigger), the timer counts, 1F's
// layout and trainers are the challenge's (TrainerTower_OnTransition: ttower_initfloor), a trainer's trigger runs up
// to `ttower_dobattle` (a stand-in until unit 2: it counts as won), the floor is cleared, and a loss sends the player
// back out of the challenge at the lobby (TrainerTower_Lobby_EventScript_LostChallenge).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

/** Start in the lobby, below the entry trigger at (9, 7); the tower's data is in by then (Assets.init). */
async function lobby(party = [MEWTWO]): Promise<Game> {
  return session.start({ start: 'after-rival', map: 'TrainerTower_Lobby', x: 9, y: 9, party });
}

/** A multichoice menu `name` (MULTICHOICE_*) opened since window.__ttSince. */
async function menuOpened(game: Game, name: string, mash: boolean): Promise<void> {
  await game.eval((_t, name) => ((window as any).__ttMenu = name), name);
  const pred = (t: any) =>
    t.events((window as any).__ttSince).some((e: any) => e.type === 'multichoice' && e.mcId === t.state.defines.require((window as any).__ttMenu));
  if (mash) await game.mashUntil(pred, { what: name, maxFrames: 4000 });
  else await game.waitFor(pred, { what: name });
}

/**
 * Walk onto the entry trigger, YES at MULTICHOICE_YES_NO_INFO, the challenge `down` items down
 * MULTICHOICE_TRAINER_TOWER_MODE (SINGLE, DOUBLE, KNOCKOUT, MIXED, EXIT), then through "Get set... Go!".
 * (The mash checks before each press, so its A never lands on a menu that just opened.)
 */
async function startChallenge(game: Game, down: number): Promise<void> {
  const since = await game.mark();
  await game.eval((_t, since) => ((window as any).__ttSince = since), since);
  await game.walk('up', 2);
  await menuOpened(game, 'MULTICHOICE_YES_NO_INFO', true);
  await game.press('A');
  await menuOpened(game, 'MULTICHOICE_TRAINER_TOWER_MODE', false);
  if (down) await game.pressTimes('DOWN', down);
  await game.press('A');
  await game.mashUntil((t) => t.idle() && !t.field()!.script && t.var('VAR_MAP_SCENE_TRAINER_TOWER') === 1, { what: 'the challenge started' });
}

/** Take the stairs (a warp tile) at map-local (x, y) to `map`. */
async function takeWarp(game: Game, x: number, y: number, map: string, idle = true): Promise<void> {
  const since = await game.mark();
  await game.eval((t, x, y) => t.walkTo(x, y), x, y);
  const arrived = await game.eval((t, map) => {
    let still = 0;
    return t.until(() => {
      const f = t.field();
      if (f?.map === map) return true;
      still = t.idle() && !f?.fading ? still + 1 : 0;
      return still > 30;
    }, 20000).then(() => t.field()?.map === map);
  }, map);
  // (enterWarp resolves once the new map is idle: not awaited where a script runs on arrival)
  if (!arrived) await game.eval((t, idle) => (idle ? t.enterWarp() : void t.enterWarp()), idle);
  await game.waitForEvent('map', { since, what: map });
  if (idle) await game.waitIdle();
}

/** The challenge's record: gSaveBlock1Ptr->trainerTower[towerChallengeId]. */
function record(game: Game) {
  return game.eval((t) => ({ id: t.state!.towerChallengeId, ...t.state!.trainerTower[t.state!.towerChallengeId] }));
}

/** gStringVar4 as text (what `msgbox gStringVar4` shows). */
function stringVar4(game: Game) {
  return game.eval(async () => {
    const common = await new Function('p', 'return import(p)')('/src/menus/common.ts');
    const s = (window as any).game.scene.getScene('Overworld');
    // as t.message() reads the box: the lines joined by spaces
    return (s.charmap.decodePlain(common.gStringVar4.slice(0, common.gStringVar4.indexOf(0xff))) as string).replace(/\\[nlp]|\s+/g, ' ');
  });
}

test('the receptionist starts a Single challenge; 1F has its trainer; the battle is reached; the timer runs', async () => {
  const game = await lobby();
  await startChallenge(game, 0);
  let rec = await record(game);
  expect(rec).toMatchObject({ id: 0, floorsCleared: 0, spokeToOwner: false, validated: true });
  // The timer counts in the field's frames (SetVBlankCounter1Ptr): 60 ticks later it is 60 further on
  const counted = await game.eval((t) => {
    const r = t.state!.trainerTower[0];
    let n = 0;
    let from = 0;
    let diff = 0;
    return t
      .until(() => {
        if (n === 0) from = r.timer;
        if (n++ < 60) return false;
        diff = r.timer - from;
        return true;
      })
      .then(() => diff);
  });
  expect(counted).toBe(60);

  // Up the stairs: TrainerTower_OnTransition's ttower_initfloor (Single: 1F's own layout, VAR_OBJ_GFX_ID_1 = the
  // trainer's graphics: ALBERTO, FACILITY_CLASS_SAILOR) and the singles trainer at (15, 13) facing left
  await takeWarp(game, 9, 2, 'TrainerTower_1F');
  const floor = await game.eval((t) => ({
    layout: t.state!.mapLayoutId === t.state!.defines.require('LAYOUT_TRAINER_TOWER_1F'),
    gfx: t.var('VAR_OBJ_GFX_ID_1') === t.state!.defines.require('OBJ_EVENT_GFX_SAILOR'),
    objects: t.objects().map((o) => ({ x: o.x, y: o.y, gfx: o.graphicsId })),
  }));
  expect(floor.layout).toBe(true);
  expect(floor.gfx).toBe(true);
  expect(floor.objects).toEqual([{ x: 15, y: 13, gfx: 'OBJ_EVENT_GFX_SAILOR' }]);
  // The timer kept counting through the warp (ON_RESUME's ttower_resumetimer)
  expect((await record(game)).timer).toBeGreaterThan(rec.timer);

  // The singles trigger at (10, 13): the trainer walks up, says his intro (gStringVar4), the battle (stand-in)
  const since = await game.mark();
  await game.eval((t) => t.walkTo(10, 13));
  const intro = await game.mashUntil((t) => t.message(), { what: 'the intro speech', maxFrames: 4000 });
  expect(intro).toBe(await stringVar4(game));
  expect(intro!.length).toBeGreaterThan(5);
  await game.eval((_t, since) => ((window as any).__ttSince = since), since);
  await game.mashUntil((t) => t.events((window as any).__ttSince).some((e) => e.type === 'trainerTowerBattle'), { what: 'the battle' });
  const battle = await game.waitForEvent('trainerTowerBattle', { since });
  expect(battle).toMatchObject({ challengeType: 0, floor: 0, trainer: 0 });
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the floor cleared' });
  rec = await record(game);
  expect(rec.floorsCleared).toBe(1);

  // Talking to him afterwards: his after-battle speech (TRAINER_TOWER_TEXT_AFTER)
  const trainer = (await game.eval((t) => t.objects()))[0];
  expect(trainer).toMatchObject({ x: 11, y: 13 });
  await game.eval((t) => t.face('right'));
  await game.press('A');
  const after = await game.mashUntil((t) => t.message(), { what: 'the after speech', maxFrames: 2000 });
  expect(after).toBe(await stringVar4(game));
  expect(after).not.toBe(intro);
});

test('a Double challenge swaps in 1F_DOUBLES and the pair\'s graphics; their trigger reaches the battle', async () => {
  const game = await lobby([MEWTWO, MEWTWO]);
  await startChallenge(game, 1);
  expect((await record(game)).id).toBe(1);
  await takeWarp(game, 9, 2, 'TrainerTower_1F');
  const floor = await game.eval((t) => ({
    layout: t.state!.mapLayoutId === t.state!.defines.require('LAYOUT_TRAINER_TOWER_1F_DOUBLES'),
    gfx0: t.var('VAR_OBJ_GFX_ID_0') === t.state!.defines.require('OBJ_EVENT_GFX_LITTLE_GIRL'), // JEN & KIRA: TWINS
    gfx3: t.var('VAR_OBJ_GFX_ID_3') === t.state!.defines.require('OBJ_EVENT_GFX_LITTLE_GIRL'),
    objects: t.objects().map((o) => ({ x: o.x, y: o.y, gfx: o.graphicsId })),
  }));
  expect(floor).toMatchObject({ layout: true, gfx0: true, gfx3: true });
  const girl = 'OBJ_EVENT_GFX_LITTLE_GIRL';
  expect(floor.objects).toEqual(expect.arrayContaining([{ x: 10, y: 12, gfx: girl }, { x: 10, y: 13, gfx: girl }]));
  expect(floor.objects).toHaveLength(2);

  // The 1F_DOUBLES grid is the one in use: TrainerTower_EventScript_DoubleBattleTriggerTop at (9, 12)
  const since = await game.mark();
  await game.eval((t) => t.walkTo(9, 12));
  await game.eval((_t, since) => ((window as any).__ttSince = since), since);
  await game.mashUntil((t) => t.events((window as any).__ttSince).some((e) => e.type === 'trainerTowerBattle'), { what: 'the double battle', maxFrames: 6000 });
  expect(await game.waitForEvent('trainerTowerBattle', { since })).toMatchObject({ challengeType: 1, floor: 0 });
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the floor cleared' });
  expect((await record(game)).floorsCleared).toBe(1);
});

test('a lost challenge: back in the lobby the receptionist ends it; leaving the tower ends it too', async () => {
  const game = await lobby();
  await startChallenge(game, 2);
  expect((await record(game)).id).toBe(2);
  await takeWarp(game, 9, 2, 'TrainerTower_1F');
  // ttower_setlost (TrainerTower_EventScript_WarpToLobbyLost after a lost battle), then back down to the lobby
  await game.eval((t) => (t.state!.trainerTower[2].hasLost = true));
  await takeWarp(game, 4, 6, 'TrainerTower_Lobby', false); // the lobby's ON_FRAME script runs on arrival
  const msg = await game.mashUntil((t) => t.message(), { what: 'TOO BAD', maxFrames: 4000 });
  expect(msg).toMatch(/too bad/i);
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the challenge ended' });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_TRAINER_TOWER'))).toBe(0);
  expect((await record(game)).hasLost).toBe(false);

  // A new challenge, then out of the door: SevenIsland_TrainerTower's ON_TRANSITION ends it
  await game.eval((t) => t.walkTo(9, 9));
  await startChallenge(game, 0);
  await takeWarp(game, 9, 15, 'SevenIsland_TrainerTower');
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_TRAINER_TOWER'))).toBe(0);
});
