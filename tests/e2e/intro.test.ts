// intro.c: the copyright screen and the intro movie in front of the title screen. Booting like the game (no
// `?skipIntro`): the copyright screen, then the Game Freak scene (the window opening, the shooting star with
// MUS_GAME_FREAK, the name and the logo fading in), each IntroCallback lasting as many frames as in the C, then the
// title screen. A skips the movie to the title screen; the title screen's 2700-frame timer goes back to the
// copyright screen (CB2_InitCopyrightScreenAfterTitleScreen) and the intro.
// TODO(W-intro unit 2): scenes 1-3 (IntroCB_Scene1 is a stub that ends the movie).

import { expect, test } from 'vitest';
import { useGame } from './harness';

const session = useGame();

type Ev = { type: string; frame: number; cb?: string; name?: string };

/** The introCB events (each SetIntroCB) with their frames. */
const introCallbacks = (events: Ev[]) => events.filter((e) => e.type === 'introCB').map((e) => ({ cb: e.cb!, frame: e.frame }));

const GF_SCENE = ['IntroCB_Init', 'IntroCB_GF_OpenWindow', 'IntroCB_GF_Star', 'IntroCB_GF_RevealName', 'IntroCB_GF_RevealLogo'];

test('boot: the copyright screen, the Game Freak scene with its frame counts, then the title screen', async () => {
  // (speed 2: the copyright screen and the logo stay up long enough for the screenshots)
  const game = await session.start({ intro: true, speed: 2 });
  const copyright = (await game.events()).find((e) => e.type === 'copyrightScreen');
  expect(copyright?.cb2).toBe('CB2_InitCopyrightScreenAfterBootup');
  if ((await game.eval((t) => t.intro()?.screen)) === 'copyright') await game.screenshot('intro-copyright');
  await game.waitFor((t) => (t.intro()?.callback === 'IntroCB_GF_Star' && t.intro()!.state === 2) || t.events().some((e) => e.type === 'titleScreen'), { what: 'the star', timeout: 60_000 });
  if (await game.eval((t) => t.intro()?.callback === 'IntroCB_GF_Star')) await game.screenshot('intro-star');
  await game.waitFor((t) => (t.intro()?.callback === 'IntroCB_GF_RevealLogo' && t.intro()!.state >= 4) || t.events().some((e) => e.type === 'titleScreen'), { what: 'the Game Freak logo', timeout: 60_000 });
  if (await game.eval((t) => t.intro()?.callback === 'IntroCB_GF_RevealLogo')) await game.screenshot('intro-game-freak');

  await game.waitFor((t) => t.events().some((e) => e.type === 'titleScreen'), { what: 'the title screen', timeout: 60_000 });
  const events: Ev[] = await game.events();
  const cbs = introCallbacks(events);
  expect(cbs.map((c) => c.cb)).toEqual([...GF_SCENE, 'IntroCB_Scene1', 'IntroCB_ExitToTitleScreen']);
  const at = Object.fromEntries(cbs.map((c) => [c.cb, c.frame]));
  const frames = {
    // SetUpCopyrightScreen: states 0-139 (one per frame); state 140 starts the fade to black (BeginNormalPaletteFade
    // does its first step); 17 more steps (BG and OBJ palettes on alternate frames, 2 levels a step) and 5
    // finishing frames, the last of them state 141's FALSE; state 142; CB2_WaitFadeBeforeSetUpIntro; CB2_SetUpIntro's
    // states 0 and 1 (state 2 starts the intro)
    copyright: at.IntroCB_Init - events.find((e) => e.type === 'copyrightScreen')!.frame,
    // the task runs from the next frame: state 0, then 1
    init: at.IntroCB_GF_OpenWindow - at.IntroCB_Init,
    openWindow: at.IntroCB_GF_Star - at.IntroCB_GF_OpenWindow, // states 0, 1, then the window opens 8 lines a frame to 48
    star: at.IntroCB_GF_RevealName - at.IntroCB_GF_Star, // state 0, 30 frames, 90 frames
    // 40 frames, the name's blend (48 steps of 2 frames; the blend task starts the frame after), 51 frames
    revealName: at.IntroCB_GF_RevealLogo - at.IntroCB_GF_RevealName,
    // the logo's blend (16 steps), 91 frames, the fade-out blend (20 steps), 21 frames
    revealLogo: at.IntroCB_Scene1 - at.IntroCB_GF_RevealLogo,
  };
  expect(frames).toEqual({ copyright: 140 + 1 + 22 + 1 + 1 + 2, init: 2, openWindow: 8, star: 121, revealName: 189, revealLogo: 187 });

  // MUS_GAME_FREAK (played as an SE) in IntroCB_GF_Star's first frame
  const audio: Ev[] = await game.eval((t) => t.audioEvents());
  const jingle = audio.find((e) => e.name === 'MUS_GAME_FREAK');
  expect(jingle).toMatchObject({ type: 'se' });
  expect(jingle!.frame).toBe(at.IntroCB_GF_Star + 1);

  // The star and its sparkles were sprites; the title screen comes up as at the end of the movie
  await game.waitFor((t) => t.titleScreen()?.scene === 'RUN', { what: 'the title screen to run', timeout: 60_000 });
  expect(await game.eval((t) => t.gbaScreen())).toBe('CB2_TitleScreenRun');
});

test('the star leaves a trail of sparkles; the name sparkles', async () => {
  const game = await session.start({ intro: true });
  const counts = await game.eval(async (t) => {
    let star = 0;
    let name = 0;
    await t.until(() => {
      const p = t.intro();
      if (p?.callback === 'IntroCB_GF_Star' && p.state === 1) star = Math.max(star, p.sprites);
      if (p?.callback === 'IntroCB_GF_RevealName') name = Math.max(name, p.sprites);
      return p?.callback === 'IntroCB_GF_RevealLogo';
    }, 5000);
    return { star, name };
  });
  // the star drops a sparkle 7 frames out of 8 while it crosses the screen (~43 frames); each lives 120 frames
  expect(counts.star).toBeGreaterThan(20);
  expect(counts.name).toBeGreaterThan(3);
});

test('A during the Game Freak scene skips to the title screen', async () => {
  const game = await session.start({ intro: true });
  // Press in the page once the star is out: from outside, the scene could be over before the press lands
  const pressedIn = await game.eval(async (t) => {
    await t.until(() => t.intro()?.callback === 'IntroCB_GF_Star', 5000);
    const cb = t.intro()!.callback;
    await t.press('A');
    return cb;
  });
  expect(pressedIn).toBe('IntroCB_GF_Star');
  await game.waitFor((t) => t.events().some((e) => e.type === 'titleScreen'), { what: 'the title screen', timeout: 60_000 });
  const cbs = introCallbacks(await game.events()).map((c) => c.cb);
  expect(cbs).toEqual(['IntroCB_Init', 'IntroCB_GF_OpenWindow', 'IntroCB_GF_Star', 'IntroCB_ExitToTitleScreen']);
  await game.waitFor((t) => t.titleScreen()?.scene === 'RUN', { what: 'the title screen to run', timeout: 60_000 });
});

test("the title screen's timer runs out: back to the copyright screen and the intro, then the title screen", async () => {
  const game = await session.start({ title: true, speed: 32 });
  await game.waitFor((t) => t.titleScreen()?.scene === 'RUN', { what: 'the title screen to run', timeout: 60_000 });
  const since = await game.mark();
  // 2700 frames, the restart fade, then CB2_InitCopyrightScreenAfterTitleScreen
  const cb2 = await game.eval(async (t, since) => {
    let name: string | undefined;
    await t.until(() => {
      if (t.events(since).some((e) => e.type === 'copyrightScreen')) name ??= t.gbaScreen();
      return !!name;
    }, 6000);
    return name;
  }, since);
  expect(cb2).toBe('CB2_InitCopyrightScreenAfterTitleScreen');
  await game.waitForEvent('titleScreen', { since, timeout: 60_000 });
  const cbs = introCallbacks(await game.events(since)).map((c) => c.cb);
  expect(cbs).toEqual([...GF_SCENE, 'IntroCB_Scene1', 'IntroCB_ExitToTitleScreen']);
});
