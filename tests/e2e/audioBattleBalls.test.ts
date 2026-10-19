// The sounds of pokeball.c, battle_gfx_sfx_util.c and battle_interface.c (AUDIO_PLAN.md W-sound 6a): the wild mon's
// intro cry, the send-out cries (Task_PlayCryWhenReleasedFromBall: pan and mode), the party summary's ball tray SEs,
// and the low HP beep (SE_LOW_HEALTH on SE3: HandleLowHpMusicChange, BattleStopLowHpSound,
// HandleBattleLowHpMusicChange). The engine runs headless with the output off, so these time like the GBA without
// anything being heard. Frames are logic ticks.

import { expect, test } from 'vitest';
import { ROUTE1 } from './battleAnimHelpers';
import { useGame, type Game } from './harness';

const session = useGame();

const SOUND_PAN_ATTACKER = -64;
const SOUND_PAN_TARGET = 63;

async function defines(game: Game, names: string[]): Promise<Record<string, number>> {
  return game.eval((t, ns) => Object.fromEntries(ns.map((n) => [n, t.define(n)])), names);
}

/** The SE3 player's state (the low HP beep's). */
const se3 = (game: Game) => game.eval((t) => t.audio().players.SE3);

test("a wild battle: the wild mon's cry at pan 25, the player's send-out cry at pan -25 (CRY_MODE_NORMAL)", async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 5, moves: ['TAIL_WHIP'] }] });
  const since = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2, moves: ['SPLASH'] }));
  await game.waitForActionMenu();
  const K = await defines(game, ['SPECIES_PIDGEY', 'SPECIES_RATTATA', 'CRY_MODE_NORMAL']);
  const audio = await game.eval((t, s) => t.audioEvents(s), since);
  const cries = audio.filter((e) => e.type === 'cry');
  // SpriteCB_MoveWildMonToRight's PlayCry_Normal(species, 25), then SpriteCB_ReleaseMonFromBall's cry task.
  expect(cries).toMatchObject([
    { id: K.SPECIES_PIDGEY, mode: K.CRY_MODE_NORMAL, pan: 25 },
    { id: K.SPECIES_RATTATA, mode: K.CRY_MODE_NORMAL, pan: -25 },
  ]);
  // No ball trays in a wild battle (BattleIntroDrawPartySummaryScreens: trainer battles only).
  expect(audio.some((e) => /^SE_BALL_TRAY/.test(e.name))).toBe(false);
  // No low HP beep for a healthy mon.
  expect(audio.some((e) => e.name === 'SE_LOW_HEALTH')).toBe(false);
});

test("a trainer battle: the trainer's ball tray SEs at SOUND_PAN_ATTACKER, his mons' send-out cries at pan 25", async () => {
  const game = await session.start({
    start: 'after-rival', map: 'ViridianForest', x: 41, y: 45,
    party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }],
  });
  const since = await game.mark();
  await game.walk('right'); // into Bug Catcher Rick's view
  await game.waitForEvent('trainerApproach', { since, what: 'Rick to spot the player' });
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end', timeout: 240_000 });
  const K = await defines(game, ['SPECIES_WEEDLE', 'SPECIES_CATERPIE', 'SPECIES_MEWTWO', 'CRY_MODE_NORMAL', 'CRY_MODE_FAINT']);
  const audio = await game.eval((t, s) => t.audioEvents(s), since);
  // The faint cries (CRY_MODE_FAINT at the same pans, battle_controller_*.c) aren't send-outs.
  const sendOutCries = audio.filter((e) => e.type === 'cry' && (e.pan === 25 || e.pan === -25) && e.mode !== K.CRY_MODE_FAINT);
  expect(sendOutCries[0]).toMatchObject({ id: K.SPECIES_WEEDLE, mode: K.CRY_MODE_NORMAL, pan: 25 });
  expect(sendOutCries[1]).toMatchObject({ id: K.SPECIES_MEWTWO, mode: K.CRY_MODE_NORMAL, pan: -25 });
  // His second mon, sent out after the first fainted.
  expect(sendOutCries.slice(2).filter((e) => e.pan === 25)).toMatchObject([{ id: K.SPECIES_CATERPIE, mode: K.CRY_MODE_NORMAL }]);
  // CreatePartyStatusSummarySprites: each tray slides in with SE_BALL_TRAY_ENTER (pan 0), then each ball plays
  // SE_BALL_TRAY_BALL (SE1) or, for an empty slot, SE_BALL_TRAY_EXIT (SE2), panned to its side.
  // (Both at the start, and the trainer's again before his second mon: `drawpartystatussummary`.)
  expect(audio.filter((e) => e.name === 'SE_BALL_TRAY_ENTER').map((e) => e.pan)).toEqual([0, 0, 0]);
  const tray = audio.filter((e) => /^SE_BALL_TRAY_(BALL|EXIT)$/.test(e.name));
  expect(tray.every((e) => e.pan === SOUND_PAN_ATTACKER || e.pan === SOUND_PAN_TARGET)).toBe(true);
  // Both trays at the battle's start: the opponent's balls at SOUND_PAN_ATTACKER, the player's at SOUND_PAN_TARGET.
  expect(tray.some((e) => e.pan === SOUND_PAN_ATTACKER && e.name === 'SE_BALL_TRAY_BALL' && e.player === 'SE1')).toBe(true);
  expect(tray.some((e) => e.pan === SOUND_PAN_ATTACKER && e.name === 'SE_BALL_TRAY_EXIT' && e.player === 'SE2')).toBe(true);
  expect(tray.some((e) => e.pan === SOUND_PAN_TARGET && e.name === 'SE_BALL_TRAY_BALL')).toBe(true);
});

test('a statused mon sent out cries weakly (ShouldPlayNormalMonCry: CRY_MODE_WEAK)', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 5, moves: ['TAIL_WHIP'] }] });
  await game.eval((t) => (t.state!.party[0].status = t.define('STATUS1_POISON')));
  const since = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2, moves: ['SPLASH'] }));
  await game.waitForActionMenu();
  const K = await defines(game, ['SPECIES_RATTATA', 'CRY_MODE_WEAK']);
  const cries = (await game.eval((t, s) => t.audioEvents(s), since)).filter((e) => e.type === 'cry');
  expect(cries[1]).toMatchObject({ id: K.SPECIES_RATTATA, mode: K.CRY_MODE_WEAK, pan: -25 });
});

test('the low HP beep starts when a hit drops HP into the red, and a Potion stops it', async () => {
  // Snorlax at Lv. 50 (maxHP ~ 220) at 80 HP (yellow); Machop's Seismic Toss takes 50 → red (< 9/48 of the bar).
  const game = await session.start({ ...ROUTE1, party: [{ species: 'SNORLAX', level: 50, moves: ['SPLASH'] }] });
  await game.eval((t) => {
    t.state!.party[0].hp = 80;
    t.state!.bag.add(t.define('ITEM_POTION'), 1);
  });
  await game.eval((t) => t.startWildBattle({ species: 'MACHOP', level: 50, moves: ['SEISMIC_TOSS'] }));
  await game.waitForActionMenu();
  expect((await se3(game)).playing).toBe(false);
  const since = await game.mark();
  await game.chooseAction('FIGHT');
  await game.mashUntil((t) => t.battle()?.controller?.startsWith('HandleInputChooseAction') && t.state!.party[0].hp === 30, { what: 'the Seismic Toss' });
  const beep = (await game.eval((t, s) => t.audioEvents(s), since)).filter((e) => e.name === 'SE_LOW_HEALTH');
  expect(beep).toMatchObject([{ type: 'se', player: 'SE3', started: true }]);
  expect(await se3(game)).toMatchObject({ song: 'SE_LOW_HEALTH', playing: true });

  // BAG → POTION → USE → Snorlax: Task_DisplayHPRestoredMessage's HandleBattleLowHpMusicChange stops it (m4aSongNumStop).
  await game.chooseAction('BAG');
  await game.waitForBag();
  await game.pressTimes('A', 2); // POTION → USE
  await game.waitForPartyMenu();
  const stopped = game.watch((t) => t.state!.party[0].hp === 50 && t.audio().players.SE3.paused && t.frame(), { what: 'the beep to stop' });
  await game.mashUntil((t) => t.itemCount('POTION') === 0, { what: 'the Potion used' });
  expect(await stopped).toBeTruthy();
  expect(await se3(game)).toMatchObject({ song: 'SE_LOW_HEALTH', playing: false });
});

test('the beep starts at a send-out in the red, stops on a switch to a healthy mon, and for good at the end', async () => {
  const game = await session.start({
    ...ROUTE1,
    party: [
      { species: 'RATTATA', level: 30, moves: ['TAIL_WHIP'] },
      { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] },
    ],
  });
  await game.eval((t) => (t.state!.party[0].hp = 1));
  const since = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 5, moves: ['SPLASH'] }));
  await game.waitForActionMenu();
  expect((await game.eval((t, s) => t.audioEvents(s), since)).filter((e) => e.name === 'SE_LOW_HEALTH')).toMatchObject([{ player: 'SE3' }]);
  expect(await se3(game)).toMatchObject({ song: 'SE_LOW_HEALTH', playing: true });

  // POKéMON → Mewtwo → SHIFT: the switch-in's HandleLowHpMusicChange on a mon out of the red stops it.
  await game.chooseAction('POKEMON');
  await game.waitForPartyMenu();
  await game.press('DOWN');
  await game.press('A');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // SHIFT
  await game.waitForActionMenu();
  expect((await game.eval((t) => t.battle()))!.mons[0].species).toBe('MEWTWO');
  expect((await se3(game)).playing).toBe(false);

  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  await game.mashUntil((t) => t.idle(), { what: 'the field' });
  expect((await se3(game)).playing).toBe(false);
});

test("a send-out in the red starts the beep, and winning stops it before the victory music", async () => {
  // Lv. 70, not 100: a level-100 mon gains no exp, and getexp then plays no victory music.
  const game = await session.start({ ...ROUTE1, party: [{ species: 'MEWTWO', level: 70, moves: ['PSYCHIC'] }] });
  await game.eval((t) => (t.state!.party[0].hp = 10));
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 5, moves: ['SPLASH'] }));
  await game.waitForActionMenu();
  expect(await se3(game)).toMatchObject({ song: 'SE_LOW_HEALTH', playing: true });
  // getexp's BattleStopLowHpSound + PlayBGM(MUS_VICTORY_WILD): SE3 in the tick after the victory music starts.
  const atVictory = game.watch((t) => {
    const e = t.audioEvents().find((a) => a.name === 'MUS_VICTORY_WILD');
    return e && t.frame() > e.frame && { se3: t.audio().players.SE3 };
  }, { what: 'MUS_VICTORY_WILD' });
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  expect((await atVictory).se3).toMatchObject({ song: 'SE_LOW_HEALTH', playing: false });
  expect((await se3(game)).playing).toBe(false);
});

test("a double battle's intro: each side's left mon cries in CRY_MODE_DOUBLES, its right one after it, CRY_MODE_NORMAL", async () => {
  // Cool Couple Ray & Tyra (trainerbattle_double) on Victory Road 3F: Ray at (38, 13) faces down, sight 1.
  const game = await session.start({
    start: 'after-rival', map: 'VictoryRoad_3F', x: 38, y: 15,
    party: [
      { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] },
      { species: 'MEW', level: 100, moves: ['PSYCHIC'] },
    ],
  });
  const since = await game.mark();
  // The BGM's volume (volX: 64 = full) when the left mons' balls open: SpriteCB_ReleaseMonFromBall sets 128 (32).
  const halved = game.watch((t) => t.audioEvents().some((e) => e.type === 'cry' && e.mode === 1) && t.audio().players.BGM.volume, { what: 'the first doubles cry' });
  await game.walk('up');
  await game.waitForEvent('trainerApproach', { since, what: 'Ray to spot the player' });
  await game.mashUntil((t) => t.battle()?.controller?.startsWith('HandleInputChooseAction') ?? false, { what: 'the action menu', timeout: 240_000 });
  expect(await halved).toBe(32);
  const K = await defines(game, ['SPECIES_MEWTWO', 'SPECIES_MEW', 'CRY_MODE_NORMAL', 'CRY_MODE_DOUBLES']);
  const cries = (await game.eval((t, s) => t.audioEvents(s), since)).filter((e) => e.type === 'cry');
  const opp = cries.filter((e) => e.pan === 25);
  const player = cries.filter((e) => e.pan === -25);
  expect(opp.map((e) => e.mode)).toEqual([K.CRY_MODE_DOUBLES, K.CRY_MODE_NORMAL]);
  expect(player).toMatchObject([
    { id: K.SPECIES_MEWTWO, mode: K.CRY_MODE_DOUBLES },
    { id: K.SPECIES_MEW, mode: K.CRY_MODE_NORMAL },
  ]);
  // Task_PlayCryWhenReleasedFromBall's case 3 waits 6 frames, then until the first cry is over, then 3 more.
  expect(player[1].frame - player[0].frame).toBeGreaterThan(9);
});
