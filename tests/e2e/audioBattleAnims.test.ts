// The battle anim engine's sounds (AUDIO_PLAN.md W-sound 6b): battle_anim.c's PlaySE12WithPanning through
// BattleAnimAdjustPanning, Cmd_end's wait for IsSEPlaying, gMovesWithQuietBGM's BGM volume; a sound task's cries
// (battle_anim_sound_tasks.c); battle_anim_special.c's ball SEs and MUS_CAUGHT_INTRO. The engine runs headless with
// the output off, so these time like the GBA without anything being heard. Frames are logic ticks.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { gMPlayTable, m4aSongNumStart, m4aSoundInit, m4aSoundMain, setVoiceData } from '../../src/audio/m4a';
import { MUSICPLAYER_STATUS_TRACK } from '../../src/audio/m4aInternal';
import { loadSongTable, type SongsJson } from '../../src/audio/songTable';
import { ROUTE1, useMoveSlot } from './battleAnimHelpers';
import { useGame } from './harness';

const session = useGame();

const SOUND_PAN_ATTACKER = -64;
const SOUND_PAN_TARGET = 63;

/** The number of engine ticks after which song `name` alone has no live track left (as audio.test.ts). */
function songTicks(name: string): number {
  const gen = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../public/gen/audio', f), 'utf8'));
  m4aSoundInit();
  const table = loadSongTable(gen('songs.json') as SongsJson);
  setVoiceData(gen('voicegroups.json'), gen('samples.json'), gen('waves.json'));
  const id = table.idByName.get(name)!;
  m4aSongNumStart(id);
  const info = gMPlayTable[table.songs[id].ms].info;
  for (let f = 1; f < 20000; f++) {
    m4aSoundMain();
    if (!(info.status & MUSICPLAYER_STATUS_TRACK)) return f;
  }
  throw new Error(`${name} doesn't end`);
}

test("an attack's SEs are panned by the attacker's side, and Tackle's anim waits for its SE to end", async () => {
  // Mewtwo (faster) tackles first: the attacker is on the player's side, so BattleAnimAdjustPanning keeps
  // SOUND_PAN_TARGET. Then Snorlax's Shadow Punch (it never misses), from the opponent's side onto the player's:
  // the pans are negated (SOUND_PAN_ATTACKER's +64 clamped to SOUND_PAN_TARGET).
  const game = await session.start({ ...ROUTE1, party: [{ species: 'MEWTWO', level: 100, moves: ['TACKLE'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SHADOW_PUNCH'] }));
  const since = await useMoveSlot(game, 0, 0);
  await game.waitForActionMenu();
  const events = await game.events(since);
  const anims = events.filter((e) => e.type === 'battleAnim' && /^Move_(TACKLE|SHADOW_PUNCH)$/.test(e.label as string));
  expect(anims.map((e) => [e.label, e.attacker])).toEqual([['Move_TACKLE', 0], ['Move_SHADOW_PUNCH', 1]]);
  const audio = (await game.eval((t, s) => t.audioEvents(s), since)).filter((e) => /^SE_M_(COMET_PUNCH|JUMP_KICK)$/.test(e.name));
  expect(audio).toMatchObject([
    { name: 'SE_M_COMET_PUNCH', player: 'SE1', pan: SOUND_PAN_TARGET, started: true }, // Tackle
    { name: 'SE_M_JUMP_KICK', pan: SOUND_PAN_TARGET }, // Shadow Punch's SOUND_PAN_ATTACKER: negated to 64, clamped
    { name: 'SE_M_COMET_PUNCH', pan: -SOUND_PAN_TARGET }, // and its SOUND_PAN_TARGET
  ]);
  // Cmd_end: Tackle's visuals are done before its SE is, so `end` waits for IsSEPlaying. The SE started in frame s
  // has its last tick in frame s + len - 1's sound hook, and Cmd_end sees it stopped in frame s + len's logic.
  const end = events.find((e) => e.type === 'battleAnimEnd' && e.label === 'Move_TACKLE')!;
  expect((end.frame as number) - audio[0].frame).toBe(songTicks('SE_M_COMET_PUNCH'));
});

test("Growl plays the attacker's cry twice (CRY_MODE_GROWL_1, then _2 once the first stops), panned to its side", async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 10, moves: ['GROWL'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await game.mark();
  // SoundTask_WaitForCry holds the anim until the second cry is over: read the cry player in the tick after the end.
  const atEnd = game.watch((t) => {
    const end = t.events().find((e) => e.type === 'battleAnimEnd' && e.label === 'Move_GROWL');
    return end && { cry: t.audio().cry };
  }, { what: "Growl's anim end" });
  await useMoveSlot(game, 0, 0);
  const { cry } = await atEnd;
  expect(cry.playing).toBe(false);
  const cries = (await game.eval((t, s) => t.audioEvents(s), since)).filter((e) => e.type === 'cry');
  const K = await game.eval((t) => ({ g1: t.define('CRY_MODE_GROWL_1'), g2: t.define('CRY_MODE_GROWL_2'), rattata: t.define('SPECIES_RATTATA') }));
  expect(cries).toMatchObject([
    { id: K.rattata, mode: K.g1, pan: SOUND_PAN_ATTACKER },
    { id: K.rattata, mode: K.g2, pan: SOUND_PAN_ATTACKER },
  ]);
  // SoundTask_PlayDoubleCry_Step waits 2 frames, then for !IsCryPlaying.
  expect(cries[1].frame - cries[0].frame).toBeGreaterThan(3);
  const end = (await game.events(since)).find((e) => e.type === 'battleAnimEnd' && e.label === 'Move_GROWL')!;
  expect(end.frame as number).toBeGreaterThan(cries[1].frame + 3);
});

test('Perish Song (gMovesWithQuietBGM) halves the BGM volume until its anim ends', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 10, moves: ['PERISH_SONG'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  await game.eval((t) => t.playSong('MUS_VS_WILD'));
  const since = await game.mark();
  // The BGM's volume (volX: 64 = full) read at the start of every tick, until the tick after the anim's end.
  const watched = game.watch((t) => {
    const w = window as unknown as { __volLog?: { f: number; vol: number | null }[] };
    const log = (w.__volLog ??= []);
    log.push({ f: t.frame(), vol: t.audio().players.BGM.volume });
    const end = t.events().find((e) => e.type === 'battleAnimEnd' && e.label === 'Move_PERISH_SONG');
    return end && t.frame() > end.frame && log;
  }, { what: "Perish Song's anim end" });
  await useMoveSlot(game, 0, 0);
  const log = await watched;
  const events = await game.events(since);
  const start = events.find((e) => e.type === 'battleAnim' && e.label === 'Move_PERISH_SONG')!.frame as number;
  const end = events.find((e) => e.type === 'battleAnimEnd' && e.label === 'Move_PERISH_SONG')!.frame as number;
  // LaunchBattleAnimation sets 128 (volX 32) in the start's tick; Cmd_end 256 in the end's.
  const during = log.filter((l) => l.f > start && l.f <= end);
  expect(during.length).toBe(end - start);
  expect(during.every((l) => l.vol === 32)).toBe(true);
  expect(log.filter((l) => l.f <= start).every((l) => l.vol === 64)).toBe(true);
  expect(log.at(-1)).toMatchObject({ f: end + 1, vol: 64 });
});

test('a Master Ball: the ball SEs, then MUS_CAUGHT_INTRO with every other player stopped', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 5, moves: ['TAIL_WHIP'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_MASTER_BALL'), 1));
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2 }));
  await game.eval((t) => t.playSong('MUS_VS_WILD'));
  await game.chooseAction('BAG');
  const since = await game.mark();
  // SpriteCB_ThrowBall_DoClick's m4aMPlayAllStop + PlaySE(MUS_CAUGHT_INTRO): the players in the tick after it.
  const atJingle = game.watch((t) => {
    const e = t.audioEvents().find((a) => a.name === 'MUS_CAUGHT_INTRO');
    return e && t.frame() > e.frame && { players: t.audio().players };
  }, { what: 'MUS_CAUGHT_INTRO' });
  await game.waitForBag();
  await game.pressTimes('RIGHT', 2);
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleAnim' && e.label === 'Special_BallThrow'), { what: 'the ball throw' });
  const { players } = await atJingle;
  expect(players.BGM).toMatchObject({ song: 'MUS_VS_WILD', paused: true });
  expect(players.SE1.paused).toBe(true); // SE_BALL_CLICK's
  expect(players.SE2).toMatchObject({ song: 'MUS_CAUGHT_INTRO', playing: true });

  const audio = (await game.eval((t, s) => t.audioEvents(s), since)).filter((e) => /^SE_BALL|^MUS_CAUGHT_INTRO$/.test(e.name));
  expect(audio.map((e) => e.name)).toEqual([
    'SE_BALL_THROW', // PlaySE12WithPanning(SE_BALL_THROW, 0)
    'SE_BALL_OPEN',
    'SE_BALL_TRADE',
    'SE_BALL_BOUNCE_1',
    'SE_BALL_BOUNCE_2',
    'SE_BALL_BOUNCE_3',
    'SE_BALL_BOUNCE_4',
    'SE_BALL', // three wobbles
    'SE_BALL',
    'SE_BALL',
    'SE_BALL_CLICK',
    'MUS_CAUGHT_INTRO',
  ]);
  expect(audio[0].pan).toBe(0);
});
