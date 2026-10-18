// The browser's sound output (src/audio/output.ts, AUDIO_PLAN.md W-out 1): off headless, `?audio=1` creates the
// AudioContext suspended and the first real key press resumes it (a hidden tab suspends it again), the m4a mixer's
// frames play (the title screen's music), M toggles the output and the setting survives a
// reload (but not when typed into a text field), and `?audio=tone` plays a tone through pushFrame's path (the
// worklet reports the peak it wrote; headless Chrome runs the audio graph on a fake output device).
// The boots go to the title screen (`title: true`), the quickest place where the page is up.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const output = (game: Game) => game.eval((t) => t.audioOutput.state());

test('headless, the output is off (the engine runs without it)', async () => {
  const game = await session.start({ title: true, speed: 1 });
  expect(await output(game)).toMatchObject({ enabled: false, reason: 'headless', context: 'none', ready: false });
  expect(await game.eval((t) => t.audioOutput.tone(true))).toBe(false);
});

test('?audio=1: the context starts suspended and the first key press resumes it', async () => {
  const game = await session.start({ title: true, query: { audio: '1' } });
  await game.waitFor((t) => t.audioOutput.state().ready, { what: 'the worklet to load' });
  expect(await output(game)).toMatchObject({ enabled: true, reason: 'flag', context: 'suspended', unlocked: false });
  await game.realKey('KeyQ');
  const s = await game.waitFor((t) => t.audioOutput.state().context === 'running' && t.audioOutput.state(), { what: 'the context to run' });
  expect(s.unlocked).toBe(true);
  // The mixer's frames reach the speakers: the title screen's MUS_TITLE (its DirectSound parts; samples.bin loads in
  // the background).
  const stats = await game.waitFor((t) => {
    const st = t.audioOutput.state().stats;
    return st && st.frames > 30 && st.peak > 0 && st;
  }, { what: 'MUS_TITLE to play' });
  expect(stats.peak).toBeLessThanOrEqual(1);

  // A hidden tab suspends it, and it resumes when the tab is back (document.hidden faked for the page's handlers).
  const setHidden = (hidden: boolean) =>
    game.eval((_t, h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await game.waitFor((t) => t.audioOutput.state().context === 'suspended', { what: 'the context to suspend' });
  await setHidden(false);
  await game.waitFor((t) => t.audioOutput.state().context === 'running', { what: 'the context to resume' });
});

test('M toggles the output; the setting survives a reload; M in a text field is the field\'s', async () => {
  let game = await session.start({ title: true, query: { audio: '1' } });
  expect((await output(game)).muted).toBe(false);
  await game.realKey('KeyM');
  expect((await output(game)).muted).toBe(true);
  expect(await game.eval(() => localStorage.getItem('firered-phaser:audio-muted'))).toBe('1');

  game = await session.start({ title: true, query: { audio: '1' }, keepSave: true });
  expect((await output(game)).muted).toBe(true);
  // Typed into a text field (as on the battle test panel), M doesn't toggle.
  await game.eval(() => {
    const input = document.body.appendChild(document.createElement('input'));
    input.focus();
  });
  await game.realKey('KeyM');
  expect(await game.eval(() => (document.activeElement as HTMLInputElement).value)).toBe('m');
  expect((await output(game)).muted).toBe(true);
  await game.eval(() => (document.activeElement as HTMLElement).blur());
  await game.realKey('KeyM');
  expect((await output(game)).muted).toBe(false);

  // The output off (headless) still takes the key and remembers it.
  game = await session.start({ title: true, keepSave: true });
  expect(await output(game)).toMatchObject({ enabled: false, muted: false });
  await game.realKey('KeyM');
  expect((await output(game)).muted).toBe(true);
});

test('?audio=tone: the test tone reaches the speakers through the worklet, and M silences it', async () => {
  const game = await session.start({ title: true, query: { audio: 'tone' } });
  expect(await output(game)).toMatchObject({ enabled: true, tone: true, muted: false });
  await game.realKey('KeyQ');
  // A ±40 square wave in both FIFOs: the DAC writes 40 / 128 = 0.3125.
  const playing = await game.waitFor((t) => {
    const s = t.audioOutput.state().stats;
    return s && s.frames > 30 && s.peak > 0 && s;
  }, { what: 'the tone to play' });
  expect(playing.peak).toBe(0.3125);
  expect(playing.dropped).toBe(0);

  await game.realKey('KeyM');
  await game.waitFor((t) => {
    const s = t.audioOutput.state();
    return s.muted && s.stats && s.stats.peak === 0;
  }, { what: 'silence while muted' });
  // Muted, the frames still flow (only the speakers go quiet).
  const before = (await output(game)).stats!.frames;
  for (let i = 0; i < 100 && (await output(game)).stats!.frames < before + 30; i++) await new Promise((r) => setTimeout(r, 100));
  expect((await output(game)).stats!.frames).toBeGreaterThanOrEqual(before + 30);

  await game.realKey('KeyM');
  await game.waitFor((t) => t.audioOutput.state().stats?.peak === 0.3125, { what: 'the tone again' });
});
