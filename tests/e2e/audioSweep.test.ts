// AUDIO_PLAN.md W-sound 8, the sweep: what it ported or found already live. The ambient cries (overworld.c's
// ChooseAmbientCrySpecies / UpdateAmbientCry / PlayAmbientCry, run by field_tasks.c's Task_RunTimeBasedEvents), a
// script's `playse` in Lt. Surge's gym, and the battle controllers' IsBattleSEPlaying wait before a move's anim. The
// engine runs headless with the output off, so these time like the GBA without anything being heard. Frames are logic
// ticks (`t.frame()`), read in the page tick by tick.

import { expect, test } from 'vitest';
import { useGame } from './harness';

const session = useGame();

test("ambient cries: a Route 1 mon cries within 3600 frames of the map's load, then every 1200-2399 frames", async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 12, y: 7 });
  await game.waitIdle();
  const start = await game.eval((t) => {
    (window as unknown as { __sweepMark: number }).__sweepMark = t.lastSeq();
    return t.frame();
  });
  // The player stands still with the field controls free: the task counts down, the cry plays (NoDucking).
  const cries = await game.watch(
    (t) => {
      const since = (window as unknown as { __sweepMark: number }).__sweepMark;
      const c = t.audioEvents(since).filter((e) => e.type === 'cry');
      return c.length >= 2 && c;
    },
    { maxFrames: 8000, what: 'two ambient cries' },
  );
  const species = await game.eval((t) => [t.define('SPECIES_PIDGEY'), t.define('SPECIES_RATTATA')]);
  for (const c of cries) {
    // Route 1's land table (it has no water mons); pan = s8((Random() % 88) + 212)
    expect(species).toContain(c.id);
    expect(c.pan).toBeGreaterThanOrEqual(-44);
    expect(c.pan).toBeLessThanOrEqual(43);
    expect(c.mode).toBe(0); // CRY_MODE_NORMAL
  }
  // The first: 1200-3599 frames after the task's roll (its second frame, before the harness saw the field idle).
  expect(cries[0].frame - start).toBeLessThanOrEqual(3600);
  // The next: 1200-2399 frames after the first (state 2's roll in the frame after the cry, then the countdown).
  const gap = cries[1].frame - cries[0].frame;
  expect(gap).toBeGreaterThanOrEqual(1201);
  expect(gap).toBeLessThanOrEqual(2400);
  // No ducking: the BGM stays at full volume.
  expect(await game.eval((t) => t.audio().cry.duckTaskActive)).toBe(false);
});

test("a map without wild mons has no ambient cry", async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_1F', x: 8, y: 5 });
  await game.waitIdle();
  const mark = await game.mark();
  await game.eval((t) => t.waitFrames(3700));
  const cries = (await game.eval((t, s) => t.audioEvents(s), mark)).filter((e) => e.type === 'cry');
  expect(cries).toEqual([]);
});

test("Lt. Surge's trash can: the first switch plays the script's SE_PIN", async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity_Gym', x: 5, y: 19 });
  await game.eval((t) => {
    for (const n of ['SAILOR_DWAYNE', 'ENGINEER_BAILY', 'GENTLEMAN_TUCKER']) {
      t.state!.setFlag(t.define('TRAINER_FLAGS_START') + t.define(`TRAINER_${n}`), true);
    }
  });
  await game.waitIdle();
  const first = await game.eval((t) => t.var('VAR_TEMP_0'));
  // Trash can i (1-15): five per row, rows at y = 10, 12, 14; talk to it from below.
  const x = 1 + 2 * ((first - 1) % 5);
  const y = 10 + 2 * Math.floor((first - 1) / 5);
  await game.eval((t, x, y) => t.walkTo(x, y + 1), x, y);
  await game.waitIdle();
  await game.eval((t) => t.face('up'));
  const mark = await game.mark();
  await game.mashUntil((t) => t.flag('FLAG_TEMP_1') && t.idle(), { what: 'the first switch' });
  const names = (await game.eval((t, s) => t.audioEvents(s), mark)).filter((e) => e.type === 'se').map((e) => e.name);
  expect(names).toContain('SE_PIN');
});

test('the controller holds a move anim while an SE plays (IsBattleSEPlaying), then stops SE1 / SE2 after 30 frames', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 12, y: 7, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2 }));
  await game.waitForActionMenu();
  // Per tick from FIGHT: once the controller has PSYCHIC's CONTROLLER_MOVEANIMATION (PlayerBufferRunCommand with
  // the command waiting), start SE_EXP (100 frames) on its SE player; then log until PlayerDoMoveAnimation runs.
  const watched = game.watch(
    (t) => {
      const w = window as unknown as { __seLog?: { f: number; ctl: string; se: boolean; started?: boolean }[]; __seStarted?: boolean };
      const log = (w.__seLog ??= []);
      const ctl = t.battle()?.controller ?? '';
      const players = t.audio().players as Record<string, { playing: boolean }>;
      const se = players.SE1.playing || players.SE2.playing;
      const msg = t.battle()?.message ?? '';
      if (!w.__seStarted && /used\s+PSYCHIC/.test(msg)) {
        w.__seStarted = true;
        t.playSong('SE_EXP');
        log.push({ f: t.frame(), ctl, se: true, started: true });
        return false;
      }
      if (w.__seStarted) log.push({ f: t.frame(), ctl, se });
      return ctl === 'PlayerDoMoveAnimation' && log;
    },
    { maxFrames: 3000, what: 'the move anim' },
  );
  await game.press('A'); // FIGHT
  await game.waitFor((t) => t.battle()?.controller?.startsWith('HandleInputChooseMove'), { what: 'the move menu' });
  await game.press('A'); // PSYCHIC
  const log = await watched;
  const started = log.find((l) => l.started)!;
  const anim = log.find((l) => l.ctl === 'PlayerDoMoveAnimation')!;
  // The command waited in PlayerBufferRunCommand while SE_EXP played: IsBattleSEPlaying's 30 calls (29 TRUE), then
  // m4aMPlayStop of SE1 / SE2 long before SE_EXP's 100 frames, and the anim starts in that tick.
  const held = log.filter((l) => l.ctl === 'PlayerBufferRunCommand' && l.se);
  expect(held.length).toBeGreaterThanOrEqual(29);
  const lastPlaying = log.filter((l) => l.se && l.f < anim.f).at(-1)!;
  expect(lastPlaying.f - started.f).toBeLessThan(95);
  expect(anim.f - lastPlaying.f).toBeLessThanOrEqual(2);
});
