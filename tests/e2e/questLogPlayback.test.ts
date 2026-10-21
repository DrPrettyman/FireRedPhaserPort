// The quest log's playback paths (QUEST_LOG_PLAN.md QL5a1): QL_AvoidDisplay (quest_log.c) and its callers. While
// recording, a script menu cuts the scene (QuestLog_CutRecording), except the nurse's YES/NO (ignoreBPress bit 1);
// in playback the menu isn't shown, the script waits, and Task_AvoidDisplay ends the scene 127 frames later, the
// script replaced by EventScript_ReleaseEnd (script_menu.c's QL_DestroyAbortedDisplay). A recorded trainer battle
// plays back through trainer_battle.inc's `goto_if_questlog EventScript_EndQuestLogBattle`: no battle, the trainer's
// flag set (SetBattledTrainerFlag), no encounter music; the intro's `waitbuttonpress` ends by itself after 120 frames.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const QL = (game: Game) => game.eval((t) => t.questLog());

/** START → SAVE → YES (a new file: no overwrite question), then wait for the field. */
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

/** Start recording a scene where the player stands (QL_START_NORMAL), as an ARRIVED event would. */
const startScene = (game: Game, mapSec: string) =>
  game.eval((t, m) => t.questLogEvent('QL_EVENT_ARRIVED', { mapSec: t.define(m) }), mapSec);

/** The main menu up, then CONTINUE. */
async function continueGame(game: Game): Promise<void> {
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading, { what: 'the main menu' });
  await game.press('A');
}

const defines = (game: Game, names: string[]) => game.eval((t, n) => n.map((x) => t.define(x)), names);

test("recording: the nurse's YES/NO (multichoice with ignoreBPress bit 1) doesn't cut the scene", async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity_PokemonCenter_1F', x: 7, y: 4 });
  await game.waitIdle();
  const [RECORDING] = await defines(game, ['QL_STATE_RECORDING']);
  await startScene(game, 'MAPSEC_VIRIDIAN_CITY');
  expect((await QL(game)).state).toBe(RECORDING);
  await game.eval((t) => t.face('up'));
  const since = await game.mark();
  await game.mashUntil((t) => t.events().some((e) => e.type === 'multichoice'), { what: "the nurse's YES/NO" });
  expect((await QL(game)).state).toBe(RECORDING); // MULTICHOICE_YES_NO, FALSE | (TRUE << 1): no cut
  expect((await game.events(since)).find((e) => e.type === 'multichoice')!.mcId).toBe((await defines(game, ['MULTICHOICE_YES_NO']))[0]);
  await game.mashUntil((t) => t.idle(), { button: 'B', what: "the nurse's goodbye" });
  expect((await QL(game)).state).toBe(RECORDING);
});

test("recording: a multichoice cuts the scene (the Trainer School blackboard's grid) when it opens", async () => {
  // The blackboard (5, 1) of the Trainer School: its msgbox, then multichoicegrid MULTICHOICE_TRAINER_SCHOOL_WHITEBOARD
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity_School', x: 5, y: 2 });
  await game.waitIdle();
  const [RECORDING, WAIT, SCENE_END] = await defines(game, ['QL_STATE_RECORDING', 'QL_EVENT_WAIT', 'QL_EVENT_SCENE_END']);
  await startScene(game, 'MAPSEC_VIRIDIAN_CITY');
  expect((await QL(game)).state).toBe(RECORDING);
  const scene = (await QL(game)).currentSceneNum;
  await game.eval((t) => t.face('up'));
  const cut = game.eval((t) => t.until(() => t.events().some((e) => e.type === 'multichoice') && t.questLog().state === 0, 3000));
  await game.mashUntil((t) => t.events().some((e) => e.type === 'multichoice'), { what: 'the blackboard menu' });
  expect(await cut).toBe(true);
  const ql = await QL(game);
  expect(ql.scenes[scene].commands.slice(-2).map((c) => c.words)).toEqual([[WAIT, 1], [SCENE_END]]);
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the blackboard to close' });
});

test('playback skips a YES/NO: the script stops at it, 127 frames later the scene fades out and the script becomes EventScript_ReleaseEnd', async () => {
  // The Safari Zone's info attendant (1, 6) asks "Is it your first time here at the SAFARI ZONE?" (msgbox MSGBOX_YESNO)
  const game = await session.start({ start: 'after-rival', map: 'FuchsiaCity_SafariZone_Entrance', x: 2, y: 6 });
  await game.waitIdle();
  const [RECORDING, PLAYBACK, PLAYBACK_LAST, ACTION_END, INPUT, WAIT, SCENE_END] = await defines(game, [
    'QL_STATE_RECORDING',
    'QL_STATE_PLAYBACK',
    'QL_STATE_PLAYBACK_LAST',
    'QL_PLAYBACK_STATE_ACTION_END',
    'QL_EVENT_INPUT',
    'QL_EVENT_WAIT',
    'QL_EVENT_SCENE_END',
  ]);
  await startScene(game, 'MAPSEC_FUCHSIA_CITY');
  expect((await QL(game)).state).toBe(RECORDING);
  await game.eval((t) => t.face('left'));
  await game.eval((t) => t.waitFrames(10));
  // Recording: the A press that talks to him is recorded, then the YES/NO cuts the scene
  await game.mashUntil((t) => t.events().some((e) => e.type === 'yesNoMenu'), { what: 'the YES/NO' });
  let ql = await QL(game);
  expect(ql.state).toBe(0);
  const cmds = ql.scenes[0].commands;
  expect(cmds.slice(-2).map((c) => c.words)).toEqual([[WAIT, 1], [SCENE_END]]);
  expect(cmds.some((c) => c.id === INPUT && (c.words[2] & 1) === 1)).toBe(true); // pressedAButton
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'his answer to NO' });
  await save(game);
  const saved = await game.eval((t) => ({ map: t.field()!.map, x: t.field()!.x, y: t.field()!.y }));

  await game.load({ keepSave: true, mainMenu: true });
  // In the page, through the whole playback: when the actions stopped for the avoided display, when the scene began
  // to end, the scripts that ran, the messages, and whether any menu opened
  const watch = game.eval(
    async (t, [PLAYBACK, PLAYBACK_LAST]) => {
      const seen = { avoidedAt: -1, endingAt: -1, messages: [] as string[], lastScene: false, playbackStateAtAvoid: -1 };
      const ok = await t.until(() => {
        const f = t.field();
        if (!f) return false; // (the main menu)
        const ql = t.questLog();
        const frame = t.frame();
        const msg = t.message();
        if (msg && !seen.messages.includes(msg)) seen.messages.push(msg);
        if (ql.state === PLAYBACK && seen.avoidedAt < 0 && ql.playback.avoidDisplay.created > 0) {
          seen.avoidedAt = frame;
          seen.playbackStateAtAvoid = ql.playbackState;
        }
        if (seen.avoidedAt >= 0 && seen.endingAt < 0 && ql.playback.control.endMode === 2) seen.endingAt = frame;
        if (ql.state === PLAYBACK_LAST) seen.lastScene = true;
        return seen.lastScene && !ql.playback.active;
      }, 30000);
      return { ok, seen };
    },
    [PLAYBACK, PLAYBACK_LAST],
  );
  await continueGame(game);
  const { ok, seen } = await watch;
  expect(ok).toBe(true);
  expect(seen.messages.some((m) => /first time here at/.test(m))).toBe(true); // the recorded A started his script
  expect(seen.playbackStateAtAvoid).toBe(ACTION_END);
  // Task_AvoidDisplay: ++tTimer == 127 starts the fade (counted from the frame the yesnobox ran)
  expect(seen.endingAt - seen.avoidedAt).toBe(127 - 1);
  const events = await game.events();
  // QL_DestroyAbortedDisplay, after the fade: ScriptContext_SetupScript(EventScript_ReleaseEnd)
  const releaseEnd = events.filter((e) => e.type === 'script' && e.label === 'EventScript_ReleaseEnd');
  expect(releaseEnd.length).toBe(1);
  expect(releaseEnd[0].frame).toBeGreaterThan(seen.endingAt + 16);
  expect(events.filter((e) => e.type === 'yesNoMenu')).toEqual([]); // no menu in playback
  await game.waitIdle();
  expect(await game.eval((t) => ({ map: t.field()!.map, x: t.field()!.x, y: t.field()!.y }))).toEqual(saved);
  expect((await QL(game)).state).toBe(0);
});

test("playback of a trainer battle: no battle, EventScript_EndQuestLogBattle sets the trainer's flag, the intro's waitbuttonpress ends after 120 frames", async () => {
  // Bug Catcher Charlie (16, 5) of Viridian Forest faces up into the trees; talked to from below, his
  // EventScript_TryDoNormalTrainerBattle gets to `goto_if_questlog` after a one-line intro ("Did you know that POKéMON
  // evolve?"), which playback prints without a press.
  const game = await session.start({ start: 'after-rival', map: 'ViridianForest', x: 16, y: 6, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await game.waitIdle();
  const [RECORDING, PLAYBACK, PLAYBACK_LAST] = await defines(game, ['QL_STATE_RECORDING', 'QL_STATE_PLAYBACK', 'QL_STATE_PLAYBACK_LAST']);
  await startScene(game, 'MAPSEC_VIRIDIAN_FOREST');
  expect((await QL(game)).state).toBe(RECORDING);
  await game.eval((t) => t.face('up'));
  await game.eval((t) => t.waitFrames(10));
  const end = await game.mashUntil((t) => t.events().find((e) => e.type === 'battleEnd'), { what: "Charlie's battle to end" });
  expect(end).toBeTruthy();
  await game.mashUntil((t) => t.idle(), { what: "Charlie's post-battle line" });
  expect(await game.eval((t) => t.trainerDefeated('BUG_CATCHER_CHARLIE'))).toBe(true);
  // (the battle's own end of the scene is QL4b's TrySetQuestLogBattleEvent: here the save cuts it)
  await save(game);

  await game.load({ keepSave: true, mainMenu: true });
  const watch = game.eval(
    async (t, [PLAYBACK, PLAYBACK_LAST]) => {
      const seen = { flagInPlayback: false, intro: -1, introGone: -1, lastScene: false, messages: [] as string[] };
      const ok = await t.until(() => {
        const f = t.field();
        if (!f) return false;
        const ql = t.questLog();
        const msg = t.message();
        if (msg && !seen.messages.includes(msg)) seen.messages.push(msg);
        if (ql.state === PLAYBACK) {
          if (msg && /POKéMON evolve/.test(msg) && seen.intro < 0) seen.intro = t.frame();
          if (seen.intro >= 0 && seen.introGone < 0 && !msg) seen.introGone = t.frame();
          if (t.trainerDefeated('BUG_CATCHER_CHARLIE')) seen.flagInPlayback = true;
        }
        if (ql.state === PLAYBACK_LAST) seen.lastScene = true;
        return seen.lastScene && !ql.playback.active;
      }, 40000);
      return { ok, seen };
    },
    [PLAYBACK, PLAYBACK_LAST],
  );
  await continueGame(game);
  const { ok, seen } = await watch;
  expect(ok).toBe(true);
  expect(seen.intro).toBeGreaterThan(0);
  expect(seen.flagInPlayback).toBe(true); // SetBattledTrainerFlag in the scene's own flags
  const events = await game.events();
  expect(events.filter((e) => e.type === 'battleStart' || e.type === 'battleTransition')).toEqual([]);
  const scripts = events.filter((e) => e.type === 'script').map((e) => e.label);
  expect(scripts).toContain('ViridianForest_EventScript_Charlie'); // the recorded A press
  // (the encounter music isn't played: PlayTrainerEncounterMusic's QL_IS_PLAYBACK_STATE)
  const songs = await game.eval((t) => t.audioEvents().filter((e) => e.type === 'bgm').map((e) => e.name));
  expect(songs.filter((s) => /ENCOUNTER/.test(s ?? ''))).toEqual([]);
  // The intro stays up through printing plus WaitForAorBPress' 120 frames
  expect(seen.introGone - seen.intro).toBeGreaterThan(120);
  await game.waitIdle();
  expect((await QL(game)).state).toBe(0);
});

// ------------------------------------------------------------------------------------------- QL5a2: audio and text

/**
 * The playback through to the saved field, watched in the page every tick: per PLAYBACK tick the message, whether its
 * printer waits (`messageWaiting`), the frame it's in, gTextFlags.autoScroll, the fanfare task; `extra` adds more.
 */
function watchPlayback(game: Game, [PLAYBACK, PLAYBACK_LAST]: number[], maxFrames = 40000) {
  return game.eval(
    async (t, [PLAYBACK, PLAYBACK_LAST, maxFrames]) => {
      const log: { f: number; msg?: string; waiting: boolean; qlFrame: boolean; auto: boolean; fanfare: boolean; approaching: boolean }[] = [];
      let lastScene = false;
      const ok = await t.until(() => {
        const f = t.field();
        if (!f) return false; // (the main menu)
        const ql = t.questLog();
        if (ql.state === PLAYBACK) {
          log.push({
            f: t.frame(),
            msg: t.message(),
            waiting: f.messageWaiting,
            qlFrame: f.messageQuestLogFrame,
            auto: f.textAutoScroll,
            fanfare: t.audio().fanfareTaskActive,
            approaching: f.approaching,
          });
        }
        if (ql.state === PLAYBACK_LAST) lastScene = true;
        return lastScene && !ql.playback.active;
      }, maxFrames);
      return { ok, log };
    },
    [PLAYBACK, PLAYBACK_LAST, maxFrames],
  );
}

/** The lengths of the runs of consecutive log entries where `pred` holds. */
function runs<T>(log: T[], pred: (e: T) => boolean): number[] {
  const out: number[] = [];
  let n = 0;
  for (const e of log) {
    if (pred(e)) n++;
    else if (n) {
      out.push(n);
      n = 0;
    }
  }
  if (n) out.push(n);
  return out;
}

test("playback: a trainer spots the player; his two-page intro auto-scrolls (50 frames at the \\p), no battle, no music", async () => {
  // Youngster Ben (17, 4) of Route 3 faces down with a sight of 2: one step right from (16, 6) and he walks up.
  // "Hi! I like shorts!\p They're delightfully comfy..." (Route3_Text_BenIntro).
  const game = await session.start({ start: 'after-rival', map: 'Route3', x: 16, y: 6, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await game.waitIdle();
  const [RECORDING, PLAYBACK, PLAYBACK_LAST] = await defines(game, ['QL_STATE_RECORDING', 'QL_STATE_PLAYBACK', 'QL_STATE_PLAYBACK_LAST']);
  await startScene(game, 'MAPSEC_ROUTE_3');
  expect((await QL(game)).state).toBe(RECORDING);
  await game.eval((t) => t.walk('right', 1));
  await game.waitForEvent('trainerApproach');
  await game.mashUntil((t) => t.events().find((e) => e.type === 'battleEnd'), { what: "Ben's battle to end" });
  await game.mashUntil((t) => t.idle(), { what: "Ben's post-battle line" });
  expect(await game.eval((t) => t.trainerDefeated('YOUNGSTER_BEN'))).toBe(true);
  await save(game);

  await game.load({ keepSave: true, mainMenu: true });
  const mark = await game.mark();
  const watch = watchPlayback(game, [PLAYBACK, PLAYBACK_LAST]);
  await continueGame(game);
  const { ok, log } = await watch;
  expect(ok).toBe(true);
  expect(log.some((l) => l.approaching)).toBe(true); // he saw the player in playback (QL_IsTrainerSightDisabled: FALSE)
  const intro = log.filter((l) => /I like shorts/.test(l.msg ?? ''));
  expect(intro.length).toBeGreaterThan(0);
  // The quest log's frame and the auto mode while it's up
  expect(intro.every((l) => l.qlFrame && l.auto)).toBe(true);
  // The \p: TextPrinterWaitAutoMode's 50 FALSE frames and its TRUE one, no key pressed
  expect(runs(intro, (l) => l.waiting)).toEqual([51]);
  // Then the intro's waitbuttonpress (120 frames) and EventScript_EndQuestLogBattle: no battle
  const events = await game.events(mark);
  expect(events.filter((e) => e.type === 'battleStart' || e.type === 'battleTransition')).toEqual([]);
  expect(events.filter((e) => e.type === 'script').map((e) => e.label)).toContain('EventScript_DoTrainerBattleFromApproach');
  // No song started in the playback until its end (the scene loads' StopMapMusic starts MUS_DUMMY; PlayTrainerEncounterMusic skipped)
  const audio = await game.eval((t, s) => t.audioEvents(s), mark);
  const endFrame = log.at(-1)!.f;
  expect(audio.filter((e) => e.frame >= log[0].f && e.frame <= endFrame && (e.type === 'bgm' || e.type === 'fanfare') && e.name !== 'MUS_DUMMY').map((e) => e.name)).toEqual([]);
  await game.waitIdle();
  // Task_EndQuestLog: gTextFlags.autoScroll = FALSE
  expect(await game.eval((t) => t.field()!.textAutoScroll)).toBe(false);
});

test("playback: an item ball's fanfare plays no song and holds the script for sFanfareCounter = 0xFF frames", async () => {
  // Viridian Forest's Potion ball (21, 34), as audio.test.ts: Std_FindItem's playfanfare MUS_LEVEL_UP (80 frames),
  // `waitfanfare`, then `msgbox Text_PutItemAway`, whose waitbuttonpress ends by itself in playback.
  const game = await session.start({ start: 'after-rival', map: 'ViridianForest', x: 21, y: 35 });
  await game.waitIdle();
  const [RECORDING, PLAYBACK, PLAYBACK_LAST] = await defines(game, ['QL_STATE_RECORDING', 'QL_STATE_PLAYBACK', 'QL_STATE_PLAYBACK_LAST']);
  await startScene(game, 'MAPSEC_VIRIDIAN_FOREST');
  expect((await QL(game)).state).toBe(RECORDING);
  await game.eval((t) => t.face('up'));
  await game.eval((t) => t.waitFrames(10));
  await game.mashUntil((t) => /put the POTION/.test(t.message() ?? ''), { what: 'Text_PutItemAway' });
  await game.mashUntil((t) => t.idle(), { what: 'the message to close' });
  await save(game);

  await game.load({ keepSave: true, mainMenu: true });
  const mark = await game.mark();
  const watch = watchPlayback(game, [PLAYBACK, PLAYBACK_LAST]);
  await continueGame(game);
  const { ok, log } = await watch;
  expect(ok).toBe(true);
  expect(log.some((l) => /found one POTION/.test(l.msg ?? ''))).toBe(true);
  expect(log.some((l) => /put the POTION/.test(l.msg ?? ''))).toBe(true);
  // Task_Fanfare runs in the frame PlayFanfare made it: 255 frames count sFanfareCounter down, the next ends it (seen
  // at the start of each tick: 255 ticks active, as audio.test.ts' 80 for MUS_LEVEL_UP outside the playback)
  expect(runs(log, (l) => l.fanfare)).toEqual([255]);
  const audio = await game.eval((t, s) => t.audioEvents(s), mark);
  const endFrame = log.at(-1)!.f;
  expect(audio.filter((e) => e.frame >= log[0].f && e.frame <= endFrame && (e.type === 'fanfare' || e.type === 'se')).map((e) => e.name)).toEqual([]);
  await game.waitIdle();
});

test('playback: playbgm and fadedefaultbgm do nothing (the Pewter City gym guide)', async () => {
  // PewterCity_EventScript_GymGuide (42, 20), talked to from the west: "You're a TRAINER, right?\p BROCK's looking
  // for new challengers. Follow me!", playbgm MUS_FOLLOW_ME, the walk to the gym, fadedefaultbgm.
  const game = await session.start({ start: 'after-rival', map: 'PewterCity', x: 41, y: 20 });
  await game.waitIdle();
  const [RECORDING, PLAYBACK, PLAYBACK_LAST] = await defines(game, ['QL_STATE_RECORDING', 'QL_STATE_PLAYBACK', 'QL_STATE_PLAYBACK_LAST']);
  await startScene(game, 'MAPSEC_PEWTER_CITY');
  expect((await QL(game)).state).toBe(RECORDING);
  await game.eval((t) => t.face('right'));
  await game.eval((t) => t.waitFrames(10));
  const recMark = await game.mark();
  await game.mashUntil((t) => t.idle() && !t.field()!.script && t.events().some((e) => e.type === 'script' && e.label === 'PewterCity_EventScript_GymGuide'), {
    what: 'the guide to lead the player to the gym',
  });
  const recorded = await game.eval((t, s) => t.audioEvents(s), recMark);
  expect(recorded.some((e) => e.type === 'bgm' && e.name === 'MUS_FOLLOW_ME')).toBe(true);
  await save(game);

  await game.load({ keepSave: true, mainMenu: true });
  const mark = await game.mark();
  const watch = watchPlayback(game, [PLAYBACK, PLAYBACK_LAST]);
  await continueGame(game);
  const { ok, log } = await watch;
  expect(ok).toBe(true);
  expect(log.some((l) => /Follow me/.test(l.msg ?? ''))).toBe(true);
  const audio = await game.eval((t, s) => t.audioEvents(s), mark);
  const endFrame = log.at(-1)!.f;
  // no MUS_FOLLOW_ME, and no fade back to the map's music (the BGM stays stopped: the scene loads' StopMapMusic is
  // MUS_DUMMY)
  expect(audio.filter((e) => e.frame >= log[0].f && e.frame <= endFrame && (e.type === 'bgm' || e.type === 'fade') && e.name !== 'MUS_DUMMY').map((e) => [e.type, e.name])).toEqual([]);
  await game.waitIdle();
});
