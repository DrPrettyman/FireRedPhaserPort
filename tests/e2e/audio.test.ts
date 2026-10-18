// sound.c's waits in the game (AUDIO_PLAN.md W-sound 1): a fanfare holds its script for sFanfares' frame count with
// the BGM paused, and `waitse` holds a script until the SE's music player stops. The engine runs headless with the
// output off, so these time like the GBA without anything being heard. Frames are logic ticks (`t.frame()`), read
// in the page tick by tick.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { gMPlayTable, m4aSongNumStart, m4aSoundInit, m4aSoundMain, setVoiceData } from '../../src/audio/m4a';
import { MUSICPLAYER_STATUS_TRACK } from '../../src/audio/m4aInternal';
import { loadSongTable, type SongsJson } from '../../src/audio/songTable';
import { useGame } from './harness';

const session = useGame();

/** The frame after which song `name` alone has no live track left (the engine on songs.json, as m4a.test.ts). */
function songStopFrame(name: string): number {
  const gen = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../public/gen/audio', f), 'utf8'));
  m4aSoundInit();
  const table = loadSongTable(gen('songs.json') as SongsJson);
  setVoiceData(gen('voicegroups.json'), gen('samples.json'), gen('waves.json')); // as the game's boot does
  const id = table.idByName.get(name)!;
  m4aSongNumStart(id);
  const info = gMPlayTable[table.songs[id].ms].info;
  for (let f = 1; f < 20000; f++) {
    m4aSoundMain();
    if (!(info.status & MUSICPLAYER_STATUS_TRACK)) return f;
  }
  throw new Error(`${name} doesn't end`);
}

test("an item ball's fanfare (MUS_LEVEL_UP) holds the message for sFanfares' 80 frames, the BGM paused", async () => {
  // Viridian Forest's Potion ball at (21, 34). Std_FindItem → EventScript_BufferPocketNameTryFanfare plays
  // MUS_LEVEL_UP (FANFARE_LEVEL_UP, 80 frames) for every pocket in FRLG, then `message`, `waitfanfare`, `waitmessage`,
  // `msgbox Text_PutItemAway`.
  const game = await session.start({ start: 'after-rival', map: 'ViridianForest', x: 21, y: 35 });
  await game.eval((t) => t.face('up'));
  await game.eval((t) => t.playSong('MUS_VIRIDIAN_FOREST')); // a BGM for the fanfare to pause (map music: W-sound 3)
  const mark = await game.mark();

  // Per tick, from now until "put the POTION" shows: the BGM's pause bit and the fanfare task.
  const watched = game.watch(
    (t) => {
      const w = window as unknown as { __audioLog?: { f: number; paused: boolean; task: boolean }[] };
      const log = (w.__audioLog ??= []);
      const a = t.audio();
      log.push({ f: t.frame(), paused: a.players.BGM.paused, task: a.fanfareTaskActive });
      return /put the POTION/.test(t.message() ?? '') && { seen: t.frame(), log };
    },
    { maxFrames: 3000, what: 'Text_PutItemAway' },
  );
  await game.press('A');
  const { seen, log } = await watched;

  const events = await game.eval((t, s) => t.audioEvents(s), mark);
  const fanfare = events.find((e) => e.type === 'fanfare')!;
  expect(fanfare).toMatchObject({ name: 'MUS_LEVEL_UP', player: 'SE2', started: true });
  const stop = events.find((e) => e.type === 'stop')!;
  expect(stop).toMatchObject({ name: 'MUS_VIRIDIAN_FOREST', player: 'BGM', frame: fanfare.frame });
  const resumed = events.find((e) => e.type === 'continue')!;
  expect(resumed).toMatchObject({ name: 'MUS_VIRIDIAN_FOREST', player: 'BGM' });
  // Task_Fanfare runs in the frame PlayFanfare made it: 80 frames count sFanfareCounter down, the next resumes the BGM.
  expect(resumed.frame - fanfare.frame).toBe(80);
  // `waitfanfare` sees the task gone the frame after (the C's native script check runs before RunTasks), goes back
  // to bytecode that frame and runs `waitmessage` + `msgbox` in the next; the watcher reads at the start of a tick.
  expect(seen - resumed.frame).toBe(3);

  // The BGM was paused from the fanfare's frame until the task resumed it, and playing again after.
  const during = log.filter((l) => l.f > fanfare.frame && l.f <= resumed.frame);
  expect(during.length).toBe(80);
  expect(during.every((l) => l.paused && l.task)).toBe(true);
  expect(log.filter((l) => l.f > resumed.frame).every((l) => !l.paused && !l.task)).toBe(true);
  expect(await game.eval((t) => t.audio().players.BGM)).toMatchObject({ song: 'MUS_VIRIDIAN_FOREST', playing: true });
});

test('`waitse` holds the Game Corner fisher\'s script until SE_SHOP\'s player stops', async () => {
  // CeladonCity_GameCorner_EventScript_Fisher: msgbox Received10CoinsFromMan, playse SE_SHOP, waitse,
  // setflag FLAG_GOT_10_COINS_FROM_GAMBLER.
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_GameCorner', x: 5, y: 7 });
  await game.eval((t) => {
    t.state!.setFlag('FLAG_GOT_COIN_CASE', true);
    t.state!.bag.add(t.define('ITEM_COIN_CASE'), 1);
    t.state!.coins = 0;
  });
  await game.eval((t) => t.face('left'));
  const mark = await game.mark();
  const watched = game.watch(
    (t) => {
      const w = window as unknown as { __seLog?: { f: number; playing: boolean }[] };
      const log = (w.__seLog ??= []);
      const a = t.audio();
      log.push({ f: t.frame(), playing: a.players.SE1.playing || a.players.SE2.playing });
      return t.flag('FLAG_GOT_10_COINS_FROM_GAMBLER') && { seen: t.frame(), log };
    },
    { maxFrames: 5000, what: 'FLAG_GOT_10_COINS_FROM_GAMBLER' },
  );
  await game.mashUntil((t) => t.flag('FLAG_GOT_10_COINS_FROM_GAMBLER'), { what: 'the fisher\'s coins' });
  const { seen, log } = await watched;
  expect(await game.eval((t) => t.state!.coins)).toBe(10);

  const se = (await game.eval((t, s) => t.audioEvents(s), mark)).find((e) => e.name === 'SE_SHOP')!;
  expect(se).toMatchObject({ type: 'se', player: 'SE1', started: true });
  // SE_SHOP's player has a live track from the engine's first tick (the hook at the end of the playse frame) until
  // after its `stop`-th frame; IsSEPlaying turns FALSE then.
  const stop = songStopFrame('SE_SHOP');
  const playing = log.filter((l) => l.playing).map((l) => l.f);
  expect(playing[0]).toBe(se.frame + 1);
  expect(playing.at(-1)).toBe(se.frame + stop - 1);
  // `waitse` (a native script) sees it stopped in frame se + stop, runs `setflag` in the next; the watcher reads at
  // the start of a tick.
  expect(seen - se.frame).toBe(stop + 2);
});
