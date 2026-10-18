// The field's SEs (AUDIO_PLAN.md W-sound 4): the player avatar's bump and ledge, talking (SE_SELECT, not for the
// PCs), the start menu, `opendoor` (GetDoorSoundEffect), the PC, the save dialog's SE_SAVE wait and the Pokémon
// Center's MUS_HEAL wait. The engine runs headless with the output off, so the waits time like the GBA without
// anything being heard. Frames are logic ticks (`t.frame()`).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { gMPlayTable, m4aSongNumStart, m4aSoundInit, m4aSoundMain, setVoiceData } from '../../src/audio/m4a';
import { MUSICPLAYER_STATUS_TRACK } from '../../src/audio/m4aInternal';
import { loadSongTable, type SongsJson } from '../../src/audio/songTable';
import { useGame, type Game } from './harness';

const session = useGame();

/** The frame after which song `name` alone has no live track left (the engine on songs.json, as audio.test.ts). */
function songStopFrame(name: string): number {
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

/** The SEs started since `mark`, by name. */
const ses = (game: Game, mark: number) => game.eval((t, s) => t.audioEvents(s).filter((e) => e.type === 'se'), mark);

test('a bump plays SE_WALL_HIT, a ledge SE_LEDGE', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_1F', x: 8, y: 5 });
  await game.waitIdle();
  // Mom stands at (8, 4): PlayerNotOnBikeCollide → PlayCollisionSoundIfNotFacingWarp.
  await game.eval((t) => t.face('up'));
  let mark = await game.mark();
  const bumped = await game.eval(async (t) => {
    t.hold('UP');
    const r = await t.until(() => t.field()?.avatar.action === 'WALK_IN_PLACE_SLOW_UP', 60);
    t.release();
    return r;
  });
  expect(bumped).toBe(true);
  await game.waitIdle();
  expect((await ses(game, mark)).map((e) => e.name)[0]).toBe('SE_WALL_HIT');

  // Route 1's ledges (MB_JUMP_SOUTH) run along y = 5: PlayerJumpLedge.
  const game2 = await session.start({ start: 'after-rival', map: 'Route1', x: 3, y: 4, party: [{ species: 'MEWTWO', level: 100 }] });
  await game2.waitIdle();
  await game2.eval((t) => t.face('down'));
  mark = await game2.mark();
  const jumped = await game2.eval(async (t) => {
    t.hold('DOWN');
    const r = await t.until(() => t.field()?.avatar.action === 'JUMP_2_DOWN', 60);
    t.release();
    return r;
  });
  expect(jumped).toBe(true);
  await game2.waitIdle();
  const ledge = (await ses(game2, mark)).map((e) => e.name);
  expect(ledge).toContain('SE_LEDGE');
  expect(ledge).not.toContain('SE_WALL_HIT');
});

test("talking plays SE_SELECT; Bill's `opendoor` plays the teleporter's SE_SLIDING_DOOR", async () => {
  // Route25_SeaCottage_EventScript_BillAskForHelp: YES, Bill walks to the teleporter, `opendoor 10, 3`
  // (METATILE_SeaCottage_Teleporter_Door: DOOR_SOUND_SLIDING), then `playse SE_CONTEST_CURTAIN_FALL`.
  const game = await session.start({ start: 'after-rival', map: 'Route25_SeaCottage', x: 10, y: 7, party: [{ species: 'MEWTWO', level: 100 }] });
  await game.eval((t) => {
    t.state!.setFlag('FLAG_BADGE01_GET', true);
    t.state!.setFlag('FLAG_BADGE02_GET', true);
  });
  await game.eval((t) => t.face('up'));
  await game.waitIdle();
  const mark = await game.mark();
  await game.mashUntil((t) => t.flag('FLAG_TEMP_2'), { what: 'Bill in the teleporter' });
  await game.mashUntil((t) => t.idle(), { what: 'the script to end' });
  const events = (await ses(game, mark)).map((e) => e.name);
  // TryStartInteractionScript's SE_SELECT comes first, with the script (the text printer's own SE_SELECT on A
  // presses may follow: W-sound 2).
  expect(events[0]).toBe('SE_SELECT');
  const door = events.indexOf('SE_SLIDING_DOOR');
  expect(door).toBeGreaterThan(0);
  expect(events.indexOf('SE_CONTEST_CURTAIN_FALL')).toBeGreaterThan(door);
  expect(events).not.toContain('SE_DOOR');
});

test('the bedroom PC plays SE_PC_ON without the talk SE_SELECT', async () => {
  // PalletTown_PlayersHouse_2F_EventScript_PC (bg event at (1, 1)): TryStartInteractionScript skips SE_SELECT for it.
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_2F', x: 1, y: 2 });
  await game.eval((t) => t.face('up'));
  await game.waitIdle();
  const mark = await game.mark();
  await game.press('A');
  await game.waitFor((t) => t.audioEvents(0).some((e) => e.name === 'SE_PC_ON'), { what: 'SE_PC_ON' });
  expect((await ses(game, mark)).map((e) => e.name)[0]).toBe('SE_PC_ON');
  // TURN OFF with B (player_pc.c's Task_TopMenuHandleInput: SE_SELECT), then the shut-down script's SE_PC_OFF.
  await game.mashUntil((t) => t.audioEvents(0).some((e) => e.name === 'SE_PC_OFF'), { button: 'B', what: 'SE_PC_OFF' });
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the PC to close' });
});

test('START plays SE_WIN_OPEN; the save holds "saved the game" until SE_SAVE stops, then 60 frames', async () => {
  const game = await session.start({ start: 'after-rival' });
  await game.waitIdle();
  let mark = await game.mark();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  expect((await ses(game, mark)).map((e) => e.name)).toEqual(['SE_WIN_OPEN']);

  // DOWN to SAVE (menu.c's Menu_ProcessInput: SE_SELECT for each move, and for A).
  const downs = (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length;
  mark = await game.mark();
  await game.pressTimes('DOWN', downs);
  await game.press('A');
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
  expect((await ses(game, mark)).map((e) => e.name)).toEqual(Array(downs + 1).fill('SE_SELECT'));
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  mark = await game.mark();

  // From YES on: per tick, whether the dialog is still up; nothing is pressed after YES, so the dialog waits for
  // SE_SAVE to stop (IsSEPlaying) and then SaveDialog_Wait60FramesOrAButtonHeld's 60 frames.
  const watched = game.watch(
    (t) => {
      const w = window as unknown as { __saveSeen?: boolean };
      if (/saved the game/.test(t.message() ?? '')) w.__saveSeen = true;
      return w.__saveSeen && t.saveDialog() === undefined && { closed: t.frame() };
    },
    { maxFrames: 3000, what: 'the save dialog to close' },
  );
  await game.press('A'); // YES (the default)
  const { closed } = await watched;
  const save = (await ses(game, mark)).find((e) => e.name === 'SE_SAVE')!;
  expect(save).toMatchObject({ player: 'SE1', started: true });
  // SaveDialogCB_WaitPrintSuccessAndPlaySE plays it in frame F; IsSEPlaying is TRUE from F + 1 until the SE's
  // last tick, so SaveDialogCB_ReturnSuccess first counts in frame F + stop and closes the dialog in its 60th
  // count (F + stop + 59); the watcher sees it gone at the start of the next tick.
  const stop = songStopFrame('SE_SAVE');
  expect(closed - save.frame).toBe(stop + 60);
});

test("the Pokémon Center heal: SE_BALL per mon, MUS_HEAL holds the machine (and the nurse) until the fanfare's end", async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeruleanCity_PokemonCenter_1F', x: 7, y: 4, party: [{ species: 'MEWTWO', level: 100 }, { species: 'PIDGEY', level: 10 }] });
  await game.eval((t) => {
    for (const mon of t.state!.party) mon.hp = 1;
  });
  await game.eval((t) => t.face('up'));
  await game.eval((t) => t.playSong('MUS_POKE_CENTER')); // a BGM for the fanfare to pause (map music: W-sound 3)
  await game.waitIdle();
  const mark = await game.mark();
  // Per tick: the heal effect (FLDEFF_POKECENTER_HEAL) and the fanfare task.
  const watched = game.watch(
    (t) => {
      const w = window as unknown as { __healLog?: { f: number; heal: boolean; task: boolean }[] };
      const log = (w.__healLog ??= []);
      log.push({ f: t.frame(), heal: t.field()?.fieldEffects.includes('FLDEFF_POKECENTER_HEAL') ?? false, task: t.audio().fanfareTaskActive });
      const started = log.some((l) => l.heal);
      return started && !log.at(-1)!.heal && { log };
    },
    { maxFrames: 6000, what: 'the heal machine' },
  );
  await game.mashUntil((t) => t.field()?.fieldEffects.includes('FLDEFF_POKECENTER_HEAL'), { what: 'the heal machine' });
  const { log } = await watched;
  await game.mashUntil((t) => t.idle(), { what: 'the nurse to finish' });
  expect(await game.eval((t) => t.party().map((m) => m.hp === m.maxHP))).toEqual([true, true]);

  const events = await game.eval((t, s) => t.audioEvents(s), mark);
  const balls = events.filter((e) => e.name === 'SE_BALL');
  expect(balls.length).toBe(2);
  // PokeballGlowEffect_PlaceBalls: a ball every 25 frames
  expect(balls[1].frame - balls[0].frame).toBe(25);
  const heal = events.find((e) => e.type === 'fanfare')!;
  expect(heal).toMatchObject({ name: 'MUS_HEAL', player: 'SE2', started: true });
  // PokeballGlowEffect_TryPlaySe: 32 frames after the last ball
  expect(heal.frame - balls[1].frame).toBe(32);
  const resumed = events.find((e) => e.type === 'continue' && e.name === 'MUS_POKE_CENTER')!;
  expect(resumed).toBeDefined();
  // The machine (and with it the nurse's script, waiting on FLDEFF_POKECENTER_HEAL) runs until the fanfare task
  // has gone: PokeballGlowEffect_WaitForSound.
  const lastHeal = log.filter((l) => l.heal).at(-1)!.f;
  expect(lastHeal).toBeGreaterThanOrEqual(resumed.frame);
  expect(log.filter((l) => l.f > heal.frame && l.f <= resumed.frame).every((l) => l.heal && l.task)).toBe(true);
});
