// The battle controllers' sounds (AUDIO_PLAN.md W-sound 5b): battle_controller_player.c, _opponent.c,
// _oak_old_man.c and _safari.c call sound.c directly. The send-out cry holds the intro until it has ended
// (Intro_WaitForShinyAnimAndHealthbox's IsCryPlayingOrClearCrySongs), the action and move menus play SE_SELECT, a
// fainting mon plays SE_FAINT panned to its side and its CRY_MODE_FAINT cry, the exp bar plays SE_EXP and stops it
// when the bar is full, and the Old Man's simulated input plays SE_SELECT. The engine runs headless with the output
// off, so these time like the GBA without anything being heard. Frames are logic ticks (`t.frame()`), read in the
// page tick by tick.

import { expect, test } from 'vitest';
import { useGame } from './harness';

const session = useGame();

const ROUTE1 = { start: 'after-rival', map: 'Route1', x: 12, y: 7 } as const;

test("a wild battle's intro waits for the send-out cry to end before the action menu", async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  const mark = await game.mark();
  // Per tick from the battle's start to the action menu: the player's controller and the cry player.
  const watched = game.watch(
    (t) => {
      const w = window as unknown as { __introLog?: { f: number; ctl: string; cry: boolean }[] };
      const log = (w.__introLog ??= []);
      const ctl = t.battle()?.controller ?? '';
      log.push({ f: t.frame(), ctl, cry: t.audio().cry.playing });
      return ctl.startsWith('HandleInputChooseAction') && log;
    },
    { maxFrames: 5000, what: 'the action menu' },
  );
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2 }));
  // Through "Wild PIDGEY appeared!" (the mash checks in the page before each press, so none lands on the menu).
  await game.mashUntil((t) => t.battle()?.controller?.startsWith('HandleInputChooseAction'), { what: 'the action menu' });
  const log = await watched;

  const mewtwo = await game.eval((t) => t.define('SPECIES_MEWTWO'));
  const cries = (await game.eval((t, s) => t.audioEvents(s), mark)).filter((e) => e.type === 'cry');
  // The wild mon's cry as it slides in (battle_main.c), then MEWTWO's as it leaves the ball (pokeball.c).
  const sendOut = cries.find((e) => e.id === mewtwo)!;
  expect(sendOut).toBeTruthy();
  const waiting = log.filter((l) => l.ctl.startsWith('Intro_WaitForShinyAnimAndHealthbox'));
  expect(waiting.length).toBeGreaterThan(0);
  const lastPlaying = log.filter((l) => l.f > sendOut.frame && l.cry).at(-1)!.f;
  // The cry still played while the controller waited, so the wait held the intro ...
  expect(waiting.some((l) => l.cry)).toBe(true);
  // ... until the tick after the watcher last saw it playing (the controller reads it in that tick, then
  // Intro_DelayAndEnd's 3 frames follow).
  const left = log.find((l) => l.f > waiting[0].f && !l.ctl.startsWith('Intro_WaitForShinyAnimAndHealthbox'))!.f;
  expect(left).toBeGreaterThan(lastPlaying);
  expect(left).toBeLessThanOrEqual(lastPlaying + 2);
});

test('the action and move menus play SE_SELECT', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2 }));
  await game.waitForActionMenu();
  const mark = await game.mark();
  // HandleInputChooseAction: RIGHT (to BAG) and LEFT (back) move the cursor, A picks FIGHT; HandleInputChooseMove:
  // DOWN with one move doesn't move (no sound), B goes back to the action menu.
  await game.press('RIGHT');
  await game.press('LEFT');
  await game.press('UP'); // already on the top row: no sound
  await game.press('A');
  await game.waitFor((t) => t.battle()?.controller?.startsWith('HandleInputChooseMove'), { what: 'the move menu' });
  await game.eval((t) => t.waitFrames(2));
  await game.press('DOWN');
  await game.press('B');
  await game.waitForActionMenu();
  const selects = (await game.eval((t, s) => t.audioEvents(s), mark)).filter((e) => e.name === 'SE_SELECT');
  expect(selects.length).toBe(4);
  expect(selects.every((e) => e.type === 'se' && e.started)).toBe(true);
});

test("a fainting wild mon plays SE_FAINT panned to its side and its CRY_MODE_FAINT cry; SE_EXP stops when the exp bar is full", async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'MEWTWO', level: 50, moves: ['PSYCHIC'] }] });
  const mark = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2 }));
  // Per tick: whether a music player is playing SE_EXP.
  const watched = game.watch(
    (t) => {
      const w = window as unknown as { __expLog?: { f: number; exp: boolean }[] };
      const log = (w.__expLog ??= []);
      const players = t.audio().players as Record<string, { song: string | null; playing: boolean }>;
      log.push({ f: t.frame(), exp: Object.values(players).some((p) => p.song === 'SE_EXP' && p.playing) });
      return t.events().some((e) => e.type === 'battleEnd') && log;
    },
    { maxFrames: 20000, what: 'the battle to end' },
  );
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  const log = await watched;

  const [pidgey, faintMode, panTarget] = await game.eval((t) => [t.define('SPECIES_PIDGEY'), t.define('CRY_MODE_FAINT'), t.define('SOUND_PAN_TARGET')]);
  const events = await game.eval((t, s) => t.audioEvents(s), mark);
  // OpponentHandleFaintAnimation: PlaySE12WithPanning(SE_FAINT, SOUND_PAN_TARGET).
  expect(events.find((e) => e.name === 'SE_FAINT')).toMatchObject({ type: 'se', pan: panTarget, started: true });
  // OpponentHandleFaintingCry: PlayCry_ByMode(species, 25, CRY_MODE_FAINT).
  expect(events.find((e) => e.type === 'cry' && e.id === pidgey && e.mode === faintMode)).toBeTruthy();
  // Task_PrepareToGiveExpWithExpBar's PlaySE(SE_EXP); Task_GiveExpWithExpBar stops it once the bar has moved (a
  // level 2 PIDGEY's few points: well before SE_EXP's own 100 frames).
  const exp = events.find((e) => e.name === 'SE_EXP')!;
  expect(exp).toMatchObject({ type: 'se', started: true });
  const playing = log.filter((l) => l.exp && l.f > exp.frame);
  expect(playing.length).toBeGreaterThan(13); // Task_GiveExpWithExpBar's 13 frames before the bar moves
  expect(playing.at(-1)!.f - exp.frame).toBeLessThan(60);
});

test("the Old Man's simulated input plays SE_SELECT 64 frames apart, and his catch fades the music out (speed 5)", async () => {
  // The coord trigger at (22, 8) starts the tutorial once Oak's parcel has set the scene var to 1.
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity', x: 22, y: 9 });
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_VIRIDIAN_CITY_OLD_MAN', 1));
  const mark = await game.mark();
  await game.walk('up');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the tutorial battle to end' });
  expect(await game.eval((t) => t.lastOutcome())).toBe('B_OUTCOME_CAUGHT');
  const events = await game.eval((t, s) => t.audioEvents(s), mark);
  const start = (await game.events(mark)).find((e) => e.type === 'battleStart')!;
  // SimulateInputChooseAction: the cursor to BAG after 64 frames, BAG opened 64 frames later. The bag's own sounds
  // come after; mashed text adds none in battle.
  const battleSeq = events.filter((e) => e.seq > (events.find((x) => x.type === 'cry')?.seq ?? 0));
  const selects = battleSeq.filter((e) => e.name === 'SE_SELECT');
  expect(selects.length).toBeGreaterThanOrEqual(2);
  expect(selects[1].frame - selects[0].frame).toBe(64);
  // OakOldManHandleCmd55 (BattleScript_OldMan_Pokedude_CaughtMessage's endlinkbattle): FadeOutMapMusic(5).
  expect(events.find((e) => e.type === 'fade')).toMatchObject({ speed: 5 });
  expect(start).toBeTruthy();
});
