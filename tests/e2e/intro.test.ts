// intro.c: the copyright screen and the intro movie in front of the title screen. Booting like the game (no
// `?skipIntro`): the copyright screen, then the Game Freak scene (the window opening, the shooting star with
// MUS_GAME_FREAK, the name and the logo fading in), scene 1 (the grass; MUS_INTRO_FIGHT starts), scene 2 (the forest
// pan, Gengar and Nidorino close up), scene 3 (they slide in and fight: Nidorino's cry, Gengar's swipe, the recoil
// and its dust, Nidorino's jump, the zoom and the fade), each IntroCallback lasting as many frames as in the C, then
// the title screen. A skips the movie to the title screen; the title screen's 2700-frame timer goes back to the
// copyright screen (CB2_InitCopyrightScreenAfterTitleScreen) and the intro.

import { expect, test } from 'vitest';
import { useGame } from './harness';

const session = useGame();

type Ev = { type: string; frame: number; cb?: string; name?: string };

/** The introCB events (each SetIntroCB) with their frames. */
const introCallbacks = (events: Ev[]) => events.filter((e) => e.type === 'introCB').map((e) => ({ cb: e.cb!, frame: e.frame }));

const GF_SCENE = ['IntroCB_Init', 'IntroCB_GF_OpenWindow', 'IntroCB_GF_Star', 'IntroCB_GF_RevealName', 'IntroCB_GF_RevealLogo'];
const FIGHT_SCENES = ['IntroCB_Scene1', 'IntroCB_Scene2', 'IntroCB_Scene3_Entrance', 'IntroCB_Scene3_Fight'];
/** The whole movie's callbacks, in order. */
const MOVIE = [...GF_SCENE, ...FIGHT_SCENES, 'IntroCB_ExitToTitleScreen'];

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
  expect(cbs.map((c) => c.cb)).toEqual(MOVIE);
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

test('the whole movie: scenes 1-3 last as many frames as in the C, with MUS_INTRO_FIGHT and the cry', async () => {
  // (speed 2: each scene stays up long enough for its screenshot)
  const game = await session.start({ intro: true, speed: 2 });
  // A screenshot of each scene, if the poll catches it (or once a later callback has started: go on)
  await game.waitFor((t) => (t.intro()?.callback === 'IntroCB_Scene1' && t.intro()!.state === 4) || t.events().some((e) => e.type === 'introCB' && e.cb === 'IntroCB_Scene2'), { what: 'scene 1', timeout: 60_000 });
  if (await game.eval((t) => t.intro()?.callback === 'IntroCB_Scene1')) await game.screenshot('intro-scene1-grass');
  await game.waitFor((t) => (t.intro()?.callback === 'IntroCB_Scene2' && t.intro()!.state === 4 && t.intro()!.timer! >= 20) || t.events().some((e) => e.type === 'introCB' && e.cb === 'IntroCB_Scene3_Entrance'), { what: 'scene 2', timeout: 60_000 });
  if (await game.eval((t) => t.intro()?.callback === 'IntroCB_Scene2')) await game.screenshot('intro-scene2-forest');
  await game.waitFor((t) => (t.intro()?.callback === 'IntroCB_Scene2' && t.intro()!.state === 6 && t.intro()!.timer! >= 20) || t.events().some((e) => e.type === 'introCB' && e.cb === 'IntroCB_Scene3_Entrance'), { what: 'the close-up', timeout: 60_000 });
  if (await game.eval((t) => t.intro()?.callback === 'IntroCB_Scene2')) await game.screenshot('intro-scene2-close-up');
  await game.waitFor((t) => (t.intro()?.callback === 'IntroCB_Scene3_Fight' && t.intro()!.state === 2) || t.events().some((e) => e.type === 'introCB' && e.cb === 'IntroCB_ExitToTitleScreen'), { what: "Nidorino's cry", timeout: 60_000 });
  if (await game.eval((t) => t.intro()?.callback === 'IntroCB_Scene3_Fight')) await game.screenshot('intro-scene3-cry');
  // The fight's sprites: Nidorino, the grass gone; Gengar's swipes and the recoil's dust come and go
  const fightSprites = await game.eval(async (t) => {
    let max = 0;
    await t.until(() => {
      const p = t.intro();
      if (p?.callback === 'IntroCB_Scene3_Fight') max = Math.max(max, p.sprites);
      return !p || p.callback === 'IntroCB_ExitToTitleScreen' || (p.callback === 'IntroCB_Scene3_Fight' && p.state >= 12);
    }, 20_000);
    return max;
  });
  // Nidorino + the 2 swipes + 2 pairs of dust at a time (each pair lives 38 frames, one a frame from the 7th of 13)
  expect(fightSprites).toBeGreaterThanOrEqual(5);
  await game.waitFor((t) => (t.intro()?.callback === 'IntroCB_Scene3_Fight' && t.intro()!.state === 12 && t.intro()!.timer! >= 20) || t.events().some((e) => e.type === 'introCB' && e.cb === 'IntroCB_ExitToTitleScreen'), { what: "Nidorino's jump", timeout: 60_000 });
  if (await game.eval((t) => t.intro()?.callback === 'IntroCB_Scene3_Fight')) await game.screenshot('intro-scene3-jump');

  await game.waitFor((t) => t.events().some((e) => e.type === 'titleScreen'), { what: 'the title screen', timeout: 60_000 });
  const events: Ev[] = await game.events();
  const cbs = introCallbacks(events);
  expect(cbs.map((c) => c.cb)).toEqual(MOVIE);
  const at = Object.fromEntries(cbs.map((c) => [c.cb, c.frame]));
  const frames = {
    // states 0-2 (one a frame; state 2 starts the white fade-in, -2: 4 levels a step, BG and OBJ steps on alternate
    // frames: 16 → 0 in 8 frames after BeginNormalPaletteFade's own step, then 5 finishing frames), state 3 the frame
    // after the fade ends (MUS_INTRO_FIGHT), then 30 frames
    scene1: at.IntroCB_Scene2 - at.IntroCB_Scene1,
    // states 0-2, the same fade-in, state 3, 60 frames of the wide shot, state 5, 60 frames of the close-up
    scene2: at.IntroCB_Scene3_Entrance - at.IntroCB_Scene2,
    // states 0-2; Gengar's scroll (Scene3_Task_GengarEnter, from the next frame: 39 moves of 0x400, then 18 slowing
    // ones to 0xEF00) ends after Nidorino's slide (55 frames: 39 at 55/16 px, then 16 slowing); the intro task runs
    // after the scroll task in that frame
    entrance: at.IntroCB_Scene3_Fight - at.IntroCB_Scene3_Entrance,
    // 31 frames, the cry (59 frames), 31 frames, Gengar's attack (it lands on its 31st frame), the recoil (77 frames
    // with the hop back), 17 frames, two hops (13 frames each), 21 frames, Gengar's bounce at rest (its 30-frame
    // timer), the hide, 121 frames (the white fade on BG palettes 1-2 at 48), 9 frames, the black fade (13 frames),
    // 61 frames
    fight: at.IntroCB_ExitToTitleScreen - at.IntroCB_Scene3_Fight,
  };
  expect(frames).toEqual({ scene1: 47, scene2: 138, entrance: 60, fight: 501 });

  // m4aSongNumStart(MUS_INTRO_FIGHT) in scene 1's state 3; Nidorino's cry (PlayCry_ByMode, CRY_MODE_DOUBLES, pan 0x3F)
  // on its cry callback's 10th frame
  const audio: (Ev & { pan?: number; mode?: number; id?: number })[] = await game.eval((t) => t.audioEvents());
  const music = audio.find((e) => e.name === 'MUS_INTRO_FIGHT');
  expect(music).toMatchObject({ type: 'bgm' });
  expect(music!.frame).toBe(at.IntroCB_Scene1 + 17);
  const cry = audio.find((e) => e.type === 'cry');
  expect(cry).toMatchObject({ name: 'Cry_Nidorino', pan: 0x3f, mode: 1 });
  expect(cry!.frame).toBe(at.IntroCB_Scene3_Fight + 41);
  await game.waitFor((t) => t.titleScreen()?.scene === 'RUN', { what: 'the title screen to run', timeout: 60_000 });
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

test("A during the fight (scene 3) skips to the title screen; MUS_TITLE takes over from MUS_INTRO_FIGHT", async () => {
  const game = await session.start({ intro: true });
  // Press in the page during Gengar's attack (IntroCB_Scene3_Fight's state 4: the swipe is coming)
  const pressedIn = await game.eval(async (t) => {
    await t.until(() => t.intro()?.callback === 'IntroCB_Scene3_Fight' && t.intro()!.state === 4);
    const p = t.intro()!;
    await t.press('A');
    return { cb: p.callback, state: p.state };
  });
  expect(pressedIn).toEqual({ cb: 'IntroCB_Scene3_Fight', state: 4 });
  await game.waitFor((t) => t.titleScreen()?.scene === 'RUN', { what: 'the title screen to run', timeout: 60_000 });
  const cbs = introCallbacks(await game.events());
  expect(cbs.map((c) => c.cb)).toEqual(MOVIE);
  const at = Object.fromEntries(cbs.map((c) => [c.cb, c.frame]));
  // the state 4 wait is over at the fight's 153rd frame; the skip comes before it
  expect(at.IntroCB_ExitToTitleScreen - at.IntroCB_Scene3_Fight).toBeLessThanOrEqual(153);
  const audio: Ev[] = await game.eval((t) => t.audioEvents());
  const bgm = audio.filter((e) => e.type === 'bgm').map((e) => e.name);
  expect(bgm.slice(-2)).toEqual(['MUS_INTRO_FIGHT', 'MUS_TITLE']);
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
  expect(cbs).toEqual(MOVIE);
});
