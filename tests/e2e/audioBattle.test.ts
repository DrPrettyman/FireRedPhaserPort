// Battle music and the battle's own sound calls (AUDIO_PLAN.md W-sound 5a): CreateBattleStartTask's
// PlayMapChosenOrBattleBGM starts the battle's song with the transition (the default by battle type and trainer
// class, or a legendary's own), battle_transition.c's mugshots play SE_MUGSHOT, the victory music (getexp's
// MUS_VICTORY_WILD, HandleEndTurn_BattleWon's MUS_VICTORY_TRAINER), the level-up fanfare pausing it, the
// battle's end fading it out (FadeOutMapMusic(5)), and the map's music back on the field. The battle script's
// `waitfanfare` (the Poké Flute) holds its message until the fanfare is over. Frames are logic ticks.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const ROUTE1_GRASS = { start: 'after-rival', map: 'Route1', x: 12, y: 7 } as const;
const RICK = { start: 'after-rival', map: 'ViridianForest', x: 41, y: 45 } as const;
const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

type AudioEvent = { seq: number; frame: number; type: string; name: string; player: string; started?: boolean };

const audioEvents = (game: Game, since: number): Promise<AudioEvent[]> => game.eval((t, s) => t.audioEvents(s), since);

/** Put the first party mon one exp point short of `level` (as evolution.test.ts). */
const setExpJustBelow = (game: Game, level: number) =>
  game.eval((t, lv) => {
    const mon = t.state!.party[0];
    const pk = t.state!.pokemon;
    mon.exp = pk.tables.experience[pk.species[mon.species].growthRate][lv] - 1;
  }, level);

test('a wild battle: MUS_VS_WILD with the transition, MUS_VICTORY_WILD, the level-up fanfare, the map music after', async () => {
  // Mewtwo (level 50, one exp point short of 51) one-shots a level-2 Rattata. Mewtwo learns nothing at 51.
  const game = await session.start({ ...ROUTE1_GRASS, party: [{ species: 'MEWTWO', level: 50, iv: 31, moves: ['PSYCHIC'] }] });
  await setExpJustBelow(game, 51);
  const mark = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 2 }));
  const transition = await game.waitForEvent('battleTransition', { since: mark });
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  const end = await game.waitForEvent('battleEnd', { since: mark });
  await game.mashUntil((t) => t.idle(), { what: 'the field after the battle' });
  const events = await audioEvents(game, mark);

  // PlayMapChosenOrBattleBGM(0) in CreateBattleStartTask: before Task_BattleStart starts the transition.
  const vs = events.find((e) => e.type === 'bgm' && e.name === 'MUS_VS_WILD')!;
  expect(vs).toMatchObject({ player: 'BGM', started: true });
  expect(vs.seq).toBeLessThan(transition.seq);

  // getexp: the foe fainted with the player's mon standing, so BattleStopLowHpSound + PlayBGM(MUS_VICTORY_WILD).
  const victory = events.find((e) => e.type === 'bgm' && e.name === 'MUS_VICTORY_WILD')!;
  expect(victory).toMatchObject({ player: 'BGM', started: true });
  expect(victory.seq).toBeGreaterThan(vs.seq);

  // BattleScript_LevelUp's `fanfare MUS_LEVEL_UP` (through the player's controller): the victory music pauses
  // for sFanfares' 80 frames. The "grew to" message doesn't wait for it (no waitfanfare there in the C).
  const fanfare = events.find((e) => e.type === 'fanfare' && e.name === 'MUS_LEVEL_UP')!;
  expect(fanfare).toMatchObject({ player: 'SE2', started: true });
  expect(fanfare.seq).toBeGreaterThan(victory.seq);
  const paused = events.find((e) => e.type === 'stop' && e.player === 'BGM' && e.seq > fanfare.seq - 2)!;
  expect(paused).toMatchObject({ name: 'MUS_VICTORY_WILD', frame: fanfare.frame });
  const resumed = events.find((e) => e.type === 'continue' && e.player === 'BGM' && e.seq > fanfare.seq)!;
  expect(resumed.frame - fanfare.frame).toBe(80);

  // HandleEndTurn_FinishBattle: FadeOutMapMusic(5) with the screen's fade, before the battle ends.
  const fade = events.find((e) => e.type === 'fade' && e.seq > victory.seq)!;
  expect(fade).toMatchObject({ player: 'BGM' });
  expect(fade.seq).toBeLessThan(end.seq);

  // CB2_EndWildBattle → FieldCB_DefaultWarpExit: Route 1's music again.
  const back = events.find((e) => e.type === 'bgm' && e.seq > end.seq)!;
  expect(back).toMatchObject({ name: 'MUS_ROUTE1', player: 'BGM' });
  expect(await game.eval((t) => t.audio().players.BGM)).toMatchObject({ song: 'MUS_ROUTE1', playing: true });
  expect(await game.eval((t) => t.party()[0].level)).toBe(51);
});

test('a level-100 mon gains no exp, so a wild battle won with it plays no victory music', async () => {
  // getexp skips a MAX_LEVEL mon before the music change (as the C: the PlayBGM is in the other branch).
  const game = await session.start({ ...ROUTE1_GRASS, party: [MEWTWO] });
  const mark = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 2 }));
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  const events = await audioEvents(game, mark);
  expect(events.some((e) => e.type === 'bgm' && e.name === 'MUS_VS_WILD')).toBe(true);
  expect(events.some((e) => e.name?.startsWith('MUS_VICTORY'))).toBe(false);
});

test('a trainer battle: the encounter music, MUS_VS_TRAINER with the transition, MUS_VICTORY_TRAINER, the map music after', async () => {
  const game = await session.start({ ...RICK, party: [MEWTWO] });
  const mark = await game.mark();
  await game.walk('right');
  await game.waitForEvent('trainerApproach', { since: mark, what: 'Rick to spot the player' });
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleTransition'), { what: 'Rick’s battle transition' });
  const transition = await game.waitForEvent('battleTransition', { since: mark });
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  const end = await game.waitForEvent('battleEnd', { since: mark });
  await game.mashUntil((t) => t.idle(), { what: 'Rick’s post-battle line' });
  const events = await audioEvents(game, mark);

  const encounter = events.find((e) => e.type === 'bgm' && e.name === 'MUS_ENCOUNTER_BOY')!;
  const vs = events.find((e) => e.type === 'bgm' && e.name === 'MUS_VS_TRAINER')!;
  expect(vs).toMatchObject({ player: 'BGM', started: true });
  expect(encounter.seq).toBeLessThan(vs.seq);
  expect(vs.seq).toBeLessThan(transition.seq);

  // HandleEndTurn_BattleWon: a Bug Catcher's class plays MUS_VICTORY_TRAINER; then FadeOutMapMusic(5).
  const victory = events.find((e) => e.type === 'bgm' && e.name?.startsWith('MUS_VICTORY'))!;
  expect(victory).toMatchObject({ name: 'MUS_VICTORY_TRAINER', player: 'BGM', started: true });
  expect(victory.seq).toBeLessThan(end.seq);
  const fade = events.find((e) => e.type === 'fade' && e.seq > victory.seq)!;
  expect(fade.seq).toBeLessThan(end.seq);

  // CB2_ReturnToFieldContinueScriptPlayMapMusic: Viridian Forest's music for his post-battle line.
  const back = events.find((e) => e.type === 'bgm' && e.seq > end.seq)!;
  expect(back).toMatchObject({ name: 'MUS_VIRIDIAN_FOREST', player: 'BGM' });
});

test('a mugshot transition (Lorelei\'s) plays SE_MUGSHOT as her picture slides in', async () => {
  const game = await session.start({ ...ROUTE1_GRASS, party: [MEWTWO] });
  await game.waitIdle();
  await game.eval((t) => t.forceBattleTransition('LORELEI'));
  const mark = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 3 }));
  const begin = await game.waitForEvent('battleTransition', { since: mark });
  const end = await game.waitForEvent('battleTransitionEnd', { since: mark, timeout: 60_000 });
  const ses = (await audioEvents(game, mark)).filter((e) => e.type === 'se' && e.name === 'SE_MUGSHOT');
  // Mugshot_StartOpponentSlide, once, during the transition.
  expect(ses).toHaveLength(1);
  expect(ses[0].seq).toBeGreaterThan(begin.seq);
  expect(ses[0].seq).toBeLessThan(end.seq);
  expect(ses[0].started).toBe(true);
});

test('Zapdos (StartLegendaryBattle) plays MUS_VS_LEGEND with its BLUR transition', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PowerPlant', x: 5, y: 12, party: [MEWTWO] });
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
  await game.eval((t) => t.face('up'));
  const mark = await game.mark();
  await game.press('A'); // "Gyaoo!", then the battle
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleTransition'), { what: 'the battle transition' });
  const transition = await game.waitForEvent('battleTransition', { since: mark });
  const vs = (await audioEvents(game, mark)).find((e) => e.type === 'bgm' && e.name?.startsWith('MUS_VS'))!;
  expect(vs).toMatchObject({ name: 'MUS_VS_LEGEND', player: 'BGM', started: true });
  expect(vs.seq).toBeLessThan(transition.seq);
});

test('the Poké Flute in battle: `waitfanfare` holds "...hearing the FLUTE awoke!" until MUS_POKE_FLUTE\'s 450 frames are over', async () => {
  // BattleScript_PokeFluteWakeUp: printstring, waitmessage, fanfare MUS_POKE_FLUTE, waitfanfare (VARIOUS_WAIT_FANFARE:
  // IsFanfareTaskInactive), printstring STRINGID_MONHEARINGFLUTEAWOKE.
  const game = await session.start({ ...ROUTE1_GRASS, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'], status: 'SLEEP' }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_POKE_FLUTE'), 1));
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 2 }));
  // BAG → the KEY ITEMS pocket (one to the right of ITEMS) → POKé FLUTE → USE.
  await game.chooseAction('BAG');
  await game.waitForBag();
  await game.press('RIGHT');
  const mark = await game.mark();
  // Watch the battle's messages tick by tick from the flute's use to "...awoke!".
  const watched = game.watch(
    (t) => {
      const msg = t.battle()?.message ?? '';
      return /hearing the FLUTE/.test(msg) && { frame: t.frame() };
    },
    { maxFrames: 3000, what: 'the wake-up message' },
  );
  await game.mashUntil((t) => t.audioEvents(0).some((e: { type: string }) => e.type === 'fanfare'), { what: 'the flute\'s fanfare' });
  const woke = await watched;
  const events = await audioEvents(game, mark);
  const fanfare = events.find((e) => e.type === 'fanfare')!;
  expect(fanfare).toMatchObject({ name: 'MUS_POKE_FLUTE', started: true });
  const resumed = events.find((e) => e.type === 'continue' && e.player === 'BGM' && e.seq > fanfare.seq)!;
  expect(resumed.frame - fanfare.frame).toBe(450);
  // The script checks IsFanfareTaskInactive each frame; the message prints once the task is gone.
  expect(woke.frame).toBeGreaterThan(resumed.frame);
  expect(woke.frame - resumed.frame).toBeLessThan(10);
});
