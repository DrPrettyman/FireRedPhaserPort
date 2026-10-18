// Cries and the text printer's sounds in the game (AUDIO_PLAN.md W-sound 2): `playmoncry` / `waitmoncry` hold a script
// for the cry's length (IsCryFinished: Task_DuckBGMForPokemonCry gone), and A at a \p plays SE_SELECT. The engine runs
// headless with the output off, so these time like the GBA without anything being heard. Frames are logic ticks
// (`t.frame()`), read in the page tick by tick.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { AgbMainFrameEnd, AgbMainSoundInit } from '../../src/audio/frame';
import { setVoiceData } from '../../src/audio/m4a';
import { IsCryPlaying, PlayCry_Script } from '../../src/gba/sound';
import { useGame } from './harness';

const session = useGame();

/** The frame after which a CRY_MODE_NORMAL cry of `species` (an id) has stopped (IsCryPlaying), on the engine. */
function cryStopFrame(species: number): number {
  const gen = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../public/gen/audio', f), 'utf8'));
  setVoiceData(gen('voicegroups.json'), gen('samples.json'), gen('waves.json'));
  AgbMainSoundInit();
  PlayCry_Script(species, 0);
  for (let f = 1; f < 1000; f++) {
    AgbMainFrameEnd();
    if (!IsCryPlaying()) return f;
  }
  throw new Error(`species ${species}: the cry doesn't end`);
}

test("`waitmoncry` holds the Celadon Condominiums Meowth's script until its cry has ended", async () => {
  // CeladonCity_Condominiums_1F_EventScript_Meowth: lock, faceplayer, waitse, playmoncry SPECIES_MEOWTH,
  // CRY_MODE_NORMAL, msgbox Text_Meowth ("MEOWTH: Meow!"), waitmoncry, release.
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_Condominiums_1F', x: 1, y: 10 });
  await game.eval((t) => t.face('up'));
  const meowth = await game.eval((t) => t.define('SPECIES_MEOWTH'));
  const mark = await game.mark();
  const watched = game.watch(
    (t) => {
      const w = window as unknown as { __cryLog?: { f: number; script: boolean; cry: boolean }[] };
      const log = (w.__cryLog ??= []);
      const f = t.field();
      const a = t.audio();
      log.push({ f: t.frame(), script: !!f?.script, cry: a.cry.playing });
      return log.length > 2 && !f?.script && { seen: t.frame(), log };
    },
    { maxFrames: 3000, what: "the Meowth's script ends" },
  );
  await game.press('A');
  // Mash through the message; `waitmoncry` holds after it.
  await game.mashUntil((t) => !t.field()?.script && t.audioEvents().some((e) => e.type === 'cry'), {
    what: "the Meowth's script ends",
  });
  const { seen, log } = await watched;

  const cry = (await game.eval((t, s) => t.audioEvents(s), mark)).find((e) => e.type === 'cry')!;
  expect(cry).toMatchObject({ id: meowth, name: 'Cry_Meowth', player: 'CRY0', mode: 0 });
  const stop = cryStopFrame(meowth);
  expect(stop).toBeGreaterThan(20);
  // (The message box stays open until `release`, so it can't show when `msgbox`'s waitbuttonpress ended; with A
  // mashed every few frames that is ~20 frames after the cry started, well before it stops.)
  // The cry is IsCryPlaying from frame cry + 1 until after hook cry + stop - 1. Task_DuckBGMForPokemonCry sees it
  // stopped in frame cry + stop's hook, IsCryFinished is TRUE in frame cry + stop + 1's script check, `release` runs
  // in the next frame, and the watcher (at the start of a tick) sees the script gone in the one after.
  const playing = log.filter((l) => l.cry).map((l) => l.f);
  expect(playing[0]).toBe(cry.frame + 1);
  expect(playing.at(-1)).toBe(cry.frame + stop - 1);
  expect(seen - cry.frame).toBe(stop + 3);
});

test('A at a \\p in a field message plays SE_SELECT (text.c TextPrinterWaitWithDownArrow)', async () => {
  // The tea woman's "You shouldn't spend all your money on drinks.\pTry this instead."
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity_Condominiums_1F', x: 2, y: 10 });
  await game.eval((t) => t.face('up'));
  const mark = await game.mark();
  await game.press('A');
  await game.mashUntil((t) => t.flag('FLAG_GOT_TEA'), { what: 'the tea' });
  const selects = (await game.eval((t, s) => t.audioEvents(s), mark)).filter((e) => e.name === 'SE_SELECT');
  expect(selects.length).toBeGreaterThanOrEqual(1);
  expect(selects[0]).toMatchObject({ type: 'se', player: 'SE2', started: true });
});
