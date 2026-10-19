// The Trainer Tower (POSTGAME_PLAN.md W-ttower units 1-3; trainer_tower.c in world/trainerTower.ts): the lobby's
// receptionist starts a challenge (TrainerTower_Lobby_EventScript_EntryTrigger), the timer counts, 1F's layout and
// trainers are the challenge's (TrainerTower_OnTransition: ttower_initfloor), a trainer's trigger runs up to
// `ttower_dobattle`: the battle (DoTrainerTowerBattle: BATTLE_TYPE_TRAINER_TOWER, BuildEnemyParty at the party's top
// level, the opponent's class / name / pic / texts from sTrainerTowerOpponent), the floor is cleared, and a loss sends
// the player back out of the challenge at the lobby (TrainerTower_EventScript_WarpToLobbyLost, ..._LostChallenge).
// Unit 3: battle_records.c's records screen (the lobby's TIME BOARD, the Pokémon Center's link records) and a full
// climb: eight floors, the roof's owner and prize, the record time, the elevator down, a slower climb.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 70, moves: ['PSYCHIC'] };
const RATTATA = { species: 'RATTATA', level: 5, moves: ['TACKLE'] };

/** Start in the lobby, below the entry trigger at (9, 7); the tower's data is in by then (Assets.init). */
async function lobby(party = [MEWTWO], boost = true, speed?: number): Promise<Game> {
  const game = await session.start({ start: 'after-rival', map: 'TrainerTower_Lobby', x: 9, y: 9, party, speed });
  // So that the battles are won whatever the dice say: the floors' mons come at the party's top level with EVs
  if (boost) {
    await game.eval((t) => {
      for (const m of t.state!.party) {
        m.hp = m.maxHP = 999;
        m.stats = { hp: 999, attack: 999, defense: 999, speed: 999, spAttack: 999, spDefense: 999 };
      }
    });
  }
  return game;
}

interface SeenBattle {
  flags: number;
  /** The foes' battle mons as "SPECIES:level" */
  foes: string[];
  /** Each battle message as it was expanded (gDisplayedStringBattle) */
  msgs: string[];
  /** The palette tags of the visible GBA sprites (a trainer front pic's is its TRAINER_PIC_*) */
  tags: number[];
}

/**
 * Record every battle from now on, tick by tick in the page (messages and sprites last only a few ticks), until
 * `stopWatching`: resolves with the battles seen.
 */
async function watchBattles(game: Game): Promise<{ done: Promise<SeenBattle[]> }> {
  await game.eval(() => {
    const w = window as any;
    w.__ttBattles = [];
    w.__ttIn = false;
    w.__ttStop = false;
  });
  const done = game.watch(
    (t) => {
      const w = window as any;
      const b = t.battle();
      if (b && b.mons.length) {
        if (!w.__ttIn) {
          w.__ttIn = true;
          w.__ttBattles.push({ flags: b.typeFlags, foes: [], msgs: [], tags: [] });
        }
        const cur = w.__ttBattles[w.__ttBattles.length - 1];
        for (let i = 1; i < b.mons.length; i += 2) {
          const k = `${b.mons[i].species}:${b.mons[i].level}`;
          if (b.mons[i].species && b.mons[i].species !== 'NONE' && !cur.foes.includes(k)) cur.foes.push(k);
        }
        const msg = b.message?.trim(); // (consecutive repeats are one message)
        if (msg && cur.msgs[cur.msgs.length - 1] !== msg) cur.msgs.push(msg);
        for (const sp of t.gbaSprites()) if (!sp.invisible && !cur.tags.includes(sp.paletteTag)) cur.tags.push(sp.paletteTag);
      } else w.__ttIn = false;
      return w.__ttStop ? (w.__ttBattles as SeenBattle[]) : undefined;
    },
    { maxFrames: 1_000_000, what: 'the battles' },
  );
  return { done }; // (not the promise itself: an async function would wait for it)
}

async function stopWatching(game: Game, watching: { done: Promise<SeenBattle[]> }): Promise<SeenBattle[]> {
  await game.eval(() => void ((window as any).__ttStop = true));
  return watching.done;
}

/**
 * Walk onto a trigger `at` (null: already there) and mash through the floor's `battles` battles until the script is over: on the floor, or
 * (`lost`) back in the lobby once the receptionist has ended the challenge.
 */
async function fightFloor(game: Game, at: [number, number] | null, battles: number, lost = false, since?: number): Promise<void> {
  since ??= await game.mark();
  await game.eval((_t, since, n, lost) => void Object.assign(window as any, { __ttSince: since, __ttN: n, __ttLost: lost }), since, battles, lost);
  if (at) await game.eval((t, x, y) => t.walkTo(x, y), at[0], at[1]);
  await game.mashUntil(
    (t) => {
      const w = window as any;
      return (
        t.events(w.__ttSince).filter((e) => e.type === 'battleEnd').length >= w.__ttN &&
        t.idle() &&
        !t.field()!.script &&
        (!w.__ttLost || (t.field()!.map === 'TrainerTower_Lobby' && t.var('VAR_MAP_SCENE_TRAINER_TOWER') === 0))
      );
    },
    { what: "the floor's battles", maxFrames: 200_000, timeout: 600_000 },
  );
}

/**
 * A trainer's speech as the battle prints it: TT_ConvertEasyChatMessageToString of challenge `type`'s floor
 * `floor`, trainer `trainer`, speech `which`, decoded as t.battle().message decodes.
 */
function speech(game: Game, type: number, floor: number, trainer: number, which: 'speechWin' | 'speechLose') {
  return game.eval(
    async (t, type, floor, trainer, which) => {
      const tt = await new Function('p', 'return import(p)')('/src/world/trainerTower.ts');
      const s = (window as any).game.scene.getScene('Overworld');
      const d = tt.trainerTowerData();
      const words = d.floors[d.sets[type][floor]].trainers[trainer][which];
      const bytes = tt.TT_ConvertEasyChatMessageToString(t.state, words);
      return (s.charmap.decodePlain(bytes.slice(0, bytes.indexOf(0xff))) as string).replace(/\\[nlp]|\s+/g, ' ').trim();
    },
    type,
    floor,
    trainer,
    which,
  );
}

/** A trainer's name (the raw decomp string without its `$`). */
function trainerName(game: Game, type: number, floor: number, trainer: number) {
  return game.eval(
    async (_t, type, floor, trainer) => {
      const tt = await new Function('p', 'return import(p)')('/src/world/trainerTower.ts');
      const d = tt.trainerTowerData();
      return (d.floors[d.sets[type][floor]].trainers[trainer].name as string).replace(/\$$/, '');
    },
    type,
    floor,
    trainer,
  );
}

const flags = (game: Game, ...names: string[]) => game.eval((t, names) => names.reduce((f, n) => f | t.state!.defines.require(n), 0), names);
const define = (game: Game, name: string) => game.eval((t, name) => t.state!.defines.require(name), name);

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

test('a Single challenge: 1F has its trainer, the battle is won (the opponent, the party\'s level, the lose text); the timer runs', async () => {
  const game = await lobby([MEWTWO, RATTATA]);
  // The SET battle style: no "Will you change POKéMON?" between the foe's two mons (the mash would answer YES)
  await game.eval((t) => void (t.state!.battleStyleSet = true));
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

  // The singles trigger at (10, 13): the trainer walks up and says his intro (gStringVar4)
  const watching = await watchBattles(game);
  const since = await game.mark();
  await game.eval((t) => t.walkTo(10, 13));
  const intro = await game.mashUntil((t) => t.message(), { what: 'the intro speech', maxFrames: 4000 });
  expect(intro).toBe(await stringVar4(game));
  expect(intro!.length).toBeGreaterThan(5);
  // The battle (DoTrainerTowerBattle): won, the floor cleared
  await fightFloor(game, null, 1, false, since);
  const [battle] = await stopWatching(game, watching);
  expect(await game.waitForEvent('battleStart', { since })).toMatchObject({ flags: await flags(game, 'BATTLE_TYPE_TRAINER', 'BATTLE_TYPE_TRAINER_TOWER'), trainer: 0 });
  // BattleSetup_GetBattleTowerBattleTransition: the foes are at the party's top level, never below the lead's
  expect(await game.waitForEvent('battleTransition', { since })).toMatchObject({ transition: await define(game, 'B_TRANSITION_BIG_POKEBALL') });
  // BuildEnemyParty: sSingleBattleChallengeMonIdxs[0] = ALBERTO's FERALIGATR and KANGASKHAN, at Lv70 (MEWTWO's, not RATTATA's)
  expect(battle.foes).toEqual(['FERALIGATR:70', 'KANGASKHAN:70']);
  // battle_message.c's BATTLE_TYPE_TRAINER_TOWER paths: GetTrainerTowerOpponentClass / Name, the lose text
  expect(battle.msgs).toContain('SAILOR ALBERTO would like to battle!');
  const lose = await speech(game, 0, 0, 0, 'speechLose');
  const won = battle.msgs.findIndex((m) => m === 'Player defeated SAILOR ALBERTO!');
  expect(won).toBeGreaterThan(0);
  expect(battle.msgs[won + 1]).toBe(lose);
  // battle_controller_opponent.c: GetTrainerTowerTrainerFrontSpriteId (gFacilityClassToPicIndex[FACILITY_CLASS_SAILOR])
  expect(battle.tags).toContain(await define(game, 'TRAINER_PIC_SAILOR'));
  expect(await game.eval((t) => t.lastOutcome())).toBe('B_OUTCOME_WON');
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
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the speech closed' });

  // The floor's clock (MB_TRAINER_TOWER_MONITOR: TrainerTower_EventScript_ShowTime, ttower_gettime)
  const monitor = await game.eval((t) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const f = t.field()!;
    const mb = s.assets.behaviorIds.MB_TRAINER_TOWER_MONITOR;
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (s.world.tileAt(f.worldX - f.x + x, f.worldY - f.y + y)?.behavior === mb) return { x, y };
    return undefined;
  });
  expect(monitor).toBeDefined();
  await game.eval((t, x, y) => t.walkTo(x, y + 1), monitor!.x, monitor!.y);
  await game.eval((t) => t.face('up'));
  await game.press('A');
  const time = await game.mashUntil((t) => t.message(), { what: 'the clock', maxFrames: 2000 });
  const [, min, sec] = /(\d+) ?min\. ?(\d+)\.\d\d ?sec/i.exec(time!) ?? [];
  const frames = (await record(game)).timer;
  expect(Number(min) * 60 + Number(sec)).toBeLessThanOrEqual(Math.floor(frames / 60));
  expect(Number(min) * 60 + Number(sec)).toBeGreaterThan(0);
}, 400_000);

test('a Double challenge swaps in 1F_DOUBLES and the pair\'s graphics; the double battles on 1F and 2F are won (both trainers\' texts)', async () => {
  const surfer = { ...MEWTWO, moves: ['SURF'] }; // HOUNDOOM is immune to PSYCHIC; SURF hits both foes
  const game = await lobby([surfer, surfer]);
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
  const watching = await watchBattles(game);
  const since = await game.mark();
  await fightFloor(game, [9, 12], 1);
  const [battle] = await stopWatching(game, watching);
  expect(await game.waitForEvent('battleStart', { since })).toMatchObject({
    flags: await flags(game, 'BATTLE_TYPE_TRAINER', 'BATTLE_TYPE_TRAINER_TOWER', 'BATTLE_TYPE_DOUBLE'),
  });
  // sDoubleBattleChallengeMonIdxs[0]: JEN's JOLTEON and KIRA's ESPEON
  expect(battle.foes).toEqual(['JOLTEON:70', 'ESPEON:70']);
  expect(battle.msgs).toContain('TWINS JEN & KIRA would like to battle!');
  expect(battle.tags).toContain(await define(game, 'TRAINER_PIC_TWINS'));
  // BattleScript_BattleTowerTrainerBattleWon: STRINGID_TRAINER1LOSETEXT, then (DOUBLE) STRINGID_TRAINER2LOSETEXT (the
  // twins both say WAAAH!, so 2F's pair shows the two texts apart)
  let won = battle.msgs.indexOf('Player defeated TWINS JEN & KIRA!');
  expect(won).toBeGreaterThan(0);
  expect(battle.msgs[won + 1]).toBe(await speech(game, 1, 0, 0, 'speechLose'));
  expect((await record(game)).floorsCleared).toBe(1);

  // 2F: JO & HALEY (CRUSH KIN), sDoubleBattleChallengeMonIdxs[1]: JO's ALAKAZAM and HALEY's HOUNDOOM
  await takeWarp(game, 15, 6, 'TrainerTower_2F');
  const watching2 = await watchBattles(game);
  await fightFloor(game, [9, 12], 1);
  const [battle2] = await stopWatching(game, watching2);
  expect(battle2.foes).toEqual(['ALAKAZAM:70', 'HOUNDOOM:70']);
  expect(battle2.msgs).toContain('CRUSH KIN JO & HALEY would like to battle!');
  expect(battle2.tags).toContain(await define(game, 'TRAINER_PIC_CRUSH_KIN'));
  won = battle2.msgs.indexOf('Player defeated CRUSH KIN JO & HALEY!');
  expect(won).toBeGreaterThan(0);
  const lose1 = await speech(game, 1, 1, 0, 'speechLose');
  const lose2 = await speech(game, 1, 1, 1, 'speechLose');
  expect(lose1).not.toBe(lose2);
  expect(battle2.msgs.slice(won + 1, won + 3)).toEqual([lose1, lose2]);
  expect((await record(game)).floorsCleared).toBe(2);
}, 400_000);

test('a Knockout challenge: three battles in a row on 1F, one mon each at the party\'s level', async () => {
  const game = await lobby();
  await startChallenge(game, 2);
  await takeWarp(game, 9, 2, 'TrainerTower_1F');
  const watching = await watchBattles(game);
  await fightFloor(game, [10, 13], 3);
  const battles = await stopWatching(game, watching);
  expect(battles).toHaveLength(3);
  const single = await flags(game, 'BATTLE_TYPE_TRAINER', 'BATTLE_TYPE_TRAINER_TOWER');
  // sKnockoutChallengeMonIdxs[0] = {0, 2, 4}: JORDY's MAGBY, ERNEST's TOGEPI, GABRIEL's SMOOCHUM
  const kinds = await flags(game, 'BATTLE_TYPE_TRAINER', 'BATTLE_TYPE_TRAINER_TOWER', 'BATTLE_TYPE_DOUBLE');
  expect(battles.map((b) => [b.flags & kinds, b.foes])).toEqual([
    [single, ['MAGBY:70']],
    [single, ['TOGEPI:70']],
    [single, ['SMOOCHUM:70']],
  ]);
  for (let i = 0; i < 3; i++) {
    const name = await trainerName(game, 2, 0, i);
    expect(battles[i].msgs.some((m) => m.endsWith(`${name} would like to battle!`))).toBe(true);
    expect(battles[i].msgs).toContain(await speech(game, 2, 0, i, 'speechLose'));
  }
  expect((await record(game)).floorsCleared).toBe(1);
}, 400_000);

test('a lost battle: the trainer\'s win text, no white-out; healed and back in the lobby, where the challenge ends', async () => {
  const game = await lobby([{ species: 'MAGIKARP', level: 2, moves: ['SPLASH'] }], false);
  await startChallenge(game, 0);
  await takeWarp(game, 9, 2, 'TrainerTower_1F');
  const watching = await watchBattles(game);
  const since = await game.mark();
  await fightFloor(game, [10, 13], 1, true);
  const [battle] = await stopWatching(game, watching);
  expect(await game.eval((t) => t.lastOutcome())).toBe('B_OUTCOME_LOST');
  expect(battle.foes[0]).toBe('FERALIGATR:2');
  // BattleScript_BattleTowerLost: the trainer slides back in and says his win text (STRINGID_TRAINER1WINTEXT)
  expect(battle.msgs).toContain(await speech(game, 0, 0, 0, 'speechWin'));
  expect(battle.msgs.some((m) => /whited out/i.test(m))).toBe(false);
  const events = (await game.eval((t, since) => t.events(since), since)).map((e) => e.type);
  expect(events).not.toContain('whiteOut');
  // TrainerTower_EventScript_WarpToLobbyLost: HealPlayerParty, ttower_setlost, the lobby; the receptionist's TOO BAD
  const party = await game.eval((t) => t.party());
  expect(party[0].hp).toBe(party[0].maxHP);
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'TrainerTower_Lobby' });
  const rec = await record(game);
  expect(rec).toMatchObject({ hasLost: false, floorsCleared: 0 });
}, 400_000);

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

test('whiting out during a challenge: back to the lobby (SetWhiteoutRespawnWarpAndHealerNpc), the challenge over', async () => {
  const game = await lobby([{ species: 'MAGIKARP', level: 2, moves: ['SPLASH'] }], false);
  await startChallenge(game, 0);
  await takeWarp(game, 9, 2, 'TrainerTower_1F');
  // The tower's own battles never white out (CB2_EndTrainerTowerBattle); any other lost battle will do (a fainting
  // poison step would too): spokeToOwner is FALSE, so the challenge ends
  const since = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }));
  await game.eval((_t, since) => ((window as any).__ttSince = since), since);
  await game.mashUntil((t) => t.events((window as any).__ttSince).some((e) => e.type === 'whiteOut'), { what: 'the white-out', timeout: 240_000 });
  await game.mashUntil((t) => t.field()?.map === 'TrainerTower_Lobby' && t.idle(), { what: 'the lobby' });
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'TrainerTower_Lobby', x: 4, y: 11 });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_TRAINER_TOWER'))).toBe(0);
});

// ---------------------------------------------------------------- the records (battle_records.c) and the full climb

interface Printed {
  x: number;
  y: number;
  text: string;
}

/**
 * Read a records board (`special ShowBattleRecords` after `fadescreen`): wait for battle_records.c's MainCB2 with the
 * fade in over, take what it printed, then A (Task_WaitButton: SE_SELECT, the fade out) back to the field.
 */
async function readRecords(game: Game, map: string, shot: string): Promise<{ printed: Printed[]; select: boolean }> {
  await game.waitForScreen('MainCB2', { what: 'the records screen' });
  const printed = (await game.eval((t) => (t as any).battleRecords())) as Printed[];
  await game.screenshot(shot);
  const mark = await game.mark();
  await game.press('A');
  await game.eval((_t, map) => ((window as any).__ttMap = map), map);
  await game.waitFor((t) => t.idle() && !t.field()!.script && t.field()!.map === (window as any).__ttMap, { what: 'back on the field' });
  const select = (await game.eval((t, s) => t.audioEvents(s), mark)).some((e) => e.type === 'se' && e.name === 'SE_SELECT');
  return { printed, select };
}

/** The lobby's TIME BOARD (TrainerTower_Lobby_EventScript_ShowRecords: VAR_0x8004 = 1) from the sign at (8, 10). */
async function timeBoard(game: Game, shot: string): Promise<Printed[]> {
  await game.eval((t) => t.walkTo(8, 11));
  await game.eval((t) => t.face('up'));
  await game.press('A');
  const { printed, select } = await readRecords(game, 'TrainerTower_Lobby', shot);
  expect(select).toBe(true);
  return printed;
}

/** "59MIN. 59.99SEC." as PRINT_TOWER_TIME prints `frames` (the probe's decode collapses spaces). */
function towerTime(frames: number): string {
  const min = Math.floor(frames / 3600);
  const sec = Math.floor((frames % 3600) / 60);
  const cs = Math.floor(((frames % 60) * 168) / 100);
  return `${min}MIN. ${sec}.${String(cs).padStart(2, '0')}SEC.`.replace(/ +/g, ' ');
}

/** PrintTrainerTowerRecords' lines: TIME BOARD at (74, 0), each type's name at (24, 36 + 20i) and time at (96, ...). */
function board(times: number[]): Printed[] {
  const names = ['SINGLE', 'DOUBLE', 'KNOCKOUT', 'MIXED'];
  return [{ x: 0x4a, y: 0, text: 'TIME BOARD' }, ...times.flatMap((t, i) => [
    { x: 0x18, y: 0x24 + 0x14 * i, text: names[i] },
    { x: 0x60, y: 0x24 + 0x14 * i, text: towerTime(t) },
  ])];
}

const MAX_TIME = 215999; // TRAINER_TOWER_MAX_TIME (ResetTrainerTowerResults)

test('the link records machine (CableClub_EventScript_ShowBattleRecords, VAR_0x8004 = 0): the totals and five empty rows', async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity_PokemonCenter_2F', x: 13, y: 4, party: [MEWTWO] });
  // The MB_BATTLE_RECORDS metatile is at (12, 3)
  await game.eval((t) => t.walkTo(12, 4));
  await game.eval((t) => t.face('up'));
  await game.press('A');
  const { printed, select } = await readRecords(game, 'ViridianCity_PokemonCenter_2F', 'battle-records-link');
  expect(select).toBe(true);
  const name = await game.eval((t) => t.state!.playerName);
  // PrintBattleRecords: the title centred in 0xD0, the total record at (12, 24), the column headers at (0x54, 0x30)
  expect(printed[0]).toMatchObject({ y: 4, text: `${name}’s BATTLE RESULTS` });
  expect(printed[1]).toEqual({ x: 12, y: 24, text: 'TOTAL RECORD W:0 L:0 D:0 ' });
  expect(printed[2]).toMatchObject({ x: 0x54, y: 0x30 });
  expect(printed[2].text).toMatch(/^WIN ?LOSE ?DRAW$/);
  // PrintOpponentBattleRecord: no link battles, so every row is dashes at 0, 0x54, 0x84, 0xB4, 14 px apart
  const rows = printed.slice(3);
  expect(rows).toHaveLength(5 * 4);
  for (let i = 0; i < 5; i++) {
    const y = 0x3d + 14 * i;
    expect(rows.slice(i * 4, i * 4 + 4)).toEqual([
      { x: 0, y, text: '-------' },
      { x: 0x54, y, text: '----' },
      { x: 0x84, y, text: '----' },
      { x: 0xb4, y, text: '----' },
    ]);
  }
});

test('the lobby\'s records board shows each challenge\'s record time (a new game: 59 min. 59.99 sec.)', async () => {
  const game = await lobby();
  expect(await timeBoard(game, 'time-board-new')).toEqual(board([MAX_TIME, MAX_TIME, MAX_TIME, MAX_TIME]));
});

/** Record each field message from now on (in the page, tick by tick) until `stop` resolves them. */
async function watchMessages(game: Game): Promise<{ stop: () => Promise<string[]> }> {
  await game.eval(() => void Object.assign(window as any, { __ttMsgs: [], __ttMsgStop: false }));
  const done = game.watch(
    (t) => {
      const w = window as any;
      const m = t.message();
      if (m && w.__ttMsgs[w.__ttMsgs.length - 1] !== m) w.__ttMsgs.push(m);
      return w.__ttMsgStop ? (w.__ttMsgs as string[]) : undefined;
    },
    { maxFrames: 1_000_000, what: 'the messages' },
  );
  return {
    stop: async () => {
      await game.eval(() => void ((window as any).__ttMsgStop = true));
      return done;
    },
  };
}

/** Talk to the owner on the roof (TrainerTower_EventScript_Owner at (9, 7)) and mash through what he says. */
async function talkToOwner(game: Game): Promise<string[]> {
  await game.eval((t) => t.walkTo(9, 8));
  await game.eval((t) => t.face('up'));
  const messages = await watchMessages(game);
  await game.press('A');
  await game.mashUntil((t) => t.idle() && !t.field()!.script && t.state!.trainerTower[0].checkedFinalTime, { what: 'the owner', maxFrames: 20_000 });
  return messages.stop();
}

/** The roof's elevator (13, 5) down to the lobby: the panel at (0, 2), LOBBY, the ride, the exit scene. */
async function elevatorToLobby(game: Game): Promise<void> {
  await takeWarp(game, 13, 5, 'TrainerTower_Elevator');
  await game.eval((t) => t.walkTo(0, 3));
  await game.eval((t) => t.face('up'));
  const since = await game.mark();
  await game.eval((_t, since) => ((window as any).__ttSince = since), since);
  await game.press('A');
  // TrainerTower_Elevator_EventScript_FloorSelectFromRoof: MULTICHOICE_ROOFTOP_B1F on ROOFTOP; LOBBY is next
  await menuOpened(game, 'MULTICHOICE_ROOFTOP_B1F', true);
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN');
  await game.press('A');
  await game.waitForEvent('map', { since: await game.mark(), what: 'the lobby', timeout: 60_000 });
  // TrainerTower_Lobby_EventScript_ExitElevator: two steps down, the counter's barrier back
  await game.waitFor((t) => t.field()!.map === 'TrainerTower_Lobby' && t.idle() && !t.field()!.script && t.var('VAR_TEMP_D') === 0, { what: 'out of the elevator' });
}

test('a full Single climb: eight floors, the owner\'s prize and a record time on the TIME BOARD; a slower climb keeps it', async () => {
  // (twice the usual ticks per frame, and the battle scene off: eight battles)
  const game = await lobby([MEWTWO, MEWTWO], true, 16);
  await game.eval((t) => void Object.assign(t.state!, { battleStyleSet: true, battleSceneOff: true }));
  await startChallenge(game, 0);
  await takeWarp(game, 9, 2, 'TrainerTower_1F');
  const watching = await watchBattles(game);
  for (let floor = 1; floor <= 8; floor++) {
    // HealPlayerParty before each floor, as a player would walk down to the lobby's nurse (the confusion and sleep
    // moves of the upper floors wear the party down, and PSYCHIC has 10 PP)
    await game.eval(async (t) => {
      const specials = await new Function('p', 'return import(p)')('/src/script/specials.ts');
      specials.healPlayerParty(t.state);
    });
    await fightFloor(game, [10, 13], 1);
    expect((await record(game)).floorsCleared).toBe(floor);
    await takeWarp(game, 15, 6, floor < 8 ? `TrainerTower_${floor + 1}F` : 'TrainerTower_Roof');
  }
  const battles = await stopWatching(game, watching);
  expect(battles).toHaveLength(8);
  for (let i = 0; i < 8; i++) {
    const name = await trainerName(game, 0, i, 0);
    expect(battles[i].msgs.some((m) => m.endsWith(`${name} would like to battle!`))).toBe(true);
    expect(battles[i].msgs).toContain(await speech(game, 0, i, 0, 'speechLose'));
  }

  // The roof: InitTrainerTowerFloor past the set's last floor (LAYOUT_TRAINER_TOWER_ROOF); the clock still runs
  expect(await game.eval((t) => t.state!.mapLayoutId === t.state!.defines.require('LAYOUT_TRAINER_TOWER_ROOF'))).toBe(true);
  const arrived = await record(game);
  const said = await talkToOwner(game);
  const rec = await record(game);
  // TrainerTower_EventScript_SpeakToOwner: GetOwnerState 0 (the timer stops), GiveChallengePrize (floor 0's prize:
  // sPrizeList[14], UP-GRADE), CheckFinalTime 0: a new record
  expect(rec).toMatchObject({ spokeToOwner: true, receivedPrize: true, checkedFinalTime: true, floorsCleared: 8 });
  expect(rec.timer).toBeGreaterThan(arrived.timer);
  expect(rec.bestTime).toBe(rec.timer);
  expect(await game.eval((t) => t.itemCount('UP_GRADE'))).toBe(1);
  const joined = said.join(' | ');
  expect(joined).toMatch(/I am the owner of this TOWER/);
  expect(joined).toMatch(/This is for you/);
  expect(joined).toMatch(/obtained the UP-GRADE/i);
  expect(joined).toMatch(/Stupendous/);
  expect(joined).toMatch(/better time out of you/);
  expect(joined).not.toMatch(/sweet time/);
  // GetOwnerState's DisableVBlankCounter1: stopped
  await game.eval((t) => t.waitFrames(60));
  expect((await record(game)).timer).toBe(rec.timer);
  // Again: state 2, only the farewell
  const again = await talkToOwner(game);
  expect(again.join(' | ')).not.toMatch(/owner of this TOWER|This is for you|Stupendous/);
  expect(again.join(' | ')).toMatch(/better time out of you/);

  // Down by the elevator; the lobby's TIME BOARD has the new SINGLE record
  await elevatorToLobby(game);
  // (the warp at (17, 8), a step out of the door, the script's two steps down: below the barrier at (17, 10))
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'TrainerTower_Lobby', x: 17, y: 11 });
  expect(await timeBoard(game, 'time-board-record')).toEqual(board([rec.bestTime, MAX_TIME, MAX_TIME, MAX_TIME]));

  // A second Single challenge: out of the tower (SevenIsland_TrainerTower's ON_TRANSITION ends the challenge) and back
  await takeWarp(game, 9, 15, 'SevenIsland_TrainerTower');
  // (out on the door at (58, 7): a step down and back up through it)
  await game.walk('down');
  const back = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since: back, what: 'the lobby again' });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.map)).toBe('TrainerTower_Lobby');
  await game.eval((t) => t.walkTo(9, 9));
  await startChallenge(game, 0);
  // A slower climb: its floors counted cleared (their battles were won above) and the clock 10 s past the record
  await game.eval((t, best) => void Object.assign(t.state!.trainerTower[0], { floorsCleared: 8, timer: best + 600 }), rec.bestTime);
  await takeWarp(game, 9, 2, 'TrainerTower_1F');
  for (let floor = 1; floor <= 8; floor++) await takeWarp(game, 15, 6, floor < 8 ? `TrainerTower_${floor + 1}F` : 'TrainerTower_Roof');
  const said2 = (await talkToOwner(game)).join(' | ');
  const rec2 = await record(game);
  expect(rec2.timer).toBeGreaterThan(rec.bestTime + 600);
  // GiveChallengePrize 2 (already given), CheckFinalTime 1: no new record
  expect(said2).toMatch(/I am the owner of this TOWER/);
  expect(said2).toMatch(/sweet time/);
  expect(said2).not.toMatch(/This is for you|Stupendous/);
  expect(rec2.bestTime).toBe(rec.bestTime);
  expect(await game.eval((t) => t.itemCount('UP_GRADE'))).toBe(1);
  await elevatorToLobby(game);
  expect(await timeBoard(game, 'time-board-kept')).toEqual(board([rec.bestTime, MAX_TIME, MAX_TIME, MAX_TIME]));
}, 900_000);
