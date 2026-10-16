// The title screen (title_screen.c) in front of the main menu, and NEW GAME's Oak's speech (oak_speech.c). Booting
// shows the title, its intro plays through to the run scene (PRESS START blinking, flames), START goes to the main
// menu with a save and to Oak's speech without, B on the main menu comes back to it, it restarts itself after 2700
// frames, and B+SELECT+UP opens the clear save data screen (clear_save_data_screen.c), which soft-resets back to the
// title screen. Oak's speech: the gender and the names chosen through the naming screen (or a preset) end up in the
// new game's GameState, and the game starts in the player's room.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** Wait for the title screen's run scene (where START is read). */
const titleRunning = (game: Game) => game.waitFor((t) => t.titleScreen()?.scene === 'RUN' && t.titleScreen(), { what: 'the title screen to run', timeout: 60_000 });

/** Save the current game straight into the slot (storeLocationForSave + TrySavingData), as the save dialog does. */
async function saveNow(game: Game): Promise<void> {
  await game.waitIdle();
  await game.eval(async (t) => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>;
    const save = await imp('/src/state/save.ts');
    (window as any).game.scene.getScene('Overworld').storeLocationForSave();
    save.TrySavingData(save.SAVE_NORMAL, t.state);
  });
}

const titleEvents = async (game: Game, since = 0) => (await game.events(since)).filter((e) => e.type === 'titleScreen').length;

test("boot shows the title screen; its intro plays to PRESS START; START with no save starts Oak's speech", async () => {
  const game = await session.start({ title: true });
  // Watch the intro's scenes in the page: each lasts only a few dozen frames.
  const scenes = await game.eval(async (t) => {
    const seen: string[] = [];
    await t.until(() => {
      const s = t.titleScreen()?.scene;
      if (s && seen[seen.length - 1] !== s) seen.push(s);
      return s === 'RUN';
    });
    return seen;
  });
  // (INIT lasts one frame and may be over by the time the harness sees the title screen's event)
  expect(scenes.filter((s) => s !== 'INIT')).toEqual(['FLASHSPRITE', 'FADEIN', 'RUN']);
  expect(await game.eval((t) => t.scenes())).toEqual(['MainMenu']);
  expect(await game.eval((t) => t.gbaScreen())).toBe('CB2_TitleScreenRun');

  // PRESS START blinks (60 frames shown, 30 hidden) and flames rise
  const blink = await game.eval(async (t) => {
    const states = new Set<boolean>();
    let flames = 0;
    await t.until(() => {
      const p = t.titleScreen()!;
      states.add(p.pressStartShown);
      flames = Math.max(flames, p.flames);
      return states.size === 2 && flames > 0;
    });
    return { states: [...states].sort(), flames };
  });
  expect(blink.states).toEqual([false, true]);
  expect(blink.flames).toBeGreaterThan(0);
  await game.screenshot('title-screen');

  const since = await game.mark();
  await game.press('START');
  await game.waitFor((t) => t.titleScreen()?.scene === 'CRY', { what: 'the cry scene' });
  // No save: the main menu goes on to NEW GAME at once
  await game.waitForEvent('mainMenu', { since });
  await game.waitForEvent('oakSpeech', { since, timeout: 60_000 });
  await game.waitFor((t) => t.oakSpeech()?.task === 'Task_ControlsGuide_HandleInput', { what: 'the controls guide' });
});

test('A during the intro skips to PRESS START; START with a save opens the main menu, B there goes back to the title', async () => {
  let game = await session.start({ start: 'after-rival' });
  await saveNow(game);
  game = await game.load({ title: true, keepSave: true });
  await game.waitFor((t) => t.titleScreen()?.scene === 'FLASHSPRITE', { what: 'the flash' });
  await game.press('A');
  const run = await titleRunning(game);
  expect(run.state).toBe(1);

  let since = await game.mark();
  await game.press('START');
  await game.waitForEvent('mainMenu', { since });
  const menu = await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading && t.mainMenu(), { what: 'the main menu' });
  expect(menu).toMatchObject({ menuType: 1, cursorPos: 0 });

  // B: Task_ReturnToTileScreen → CB2_InitTitleScreen
  since = await game.mark();
  await game.press('B');
  await game.waitForEvent('titleScreen', { since });
  await titleRunning(game);
  since = await game.mark();
  await game.press('START');
  await game.waitForEvent('mainMenu', { since });
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading, { what: 'the main menu again' });
  // CONTINUE
  await game.press('A');
  await game.waitForEvent('ready', { since, timeout: 60_000 });
  expect(await game.eval((t) => t.field()!.map)).toBe('PalletTown_ProfessorOaksLab');
});

test('the title screen restarts itself after 2700 frames without input', async () => {
  const game = await session.start({ title: true, speed: 32 });
  await titleRunning(game);
  expect(await titleEvents(game)).toBe(1);
  const restart = await game.eval(async (t) => {
    const timer = t.titleScreen()!.timer!;
    const at = t.frame();
    // (read the frame in the predicate, the first time it holds: code after the await runs once the frame's batch
    // of ticks is over, and `until` checks the predicate once more then)
    let restartAt = 0;
    await t.until(() => t.titleScreen()?.scene === 'RESTART' && (restartAt ||= t.frame()));
    const waited = restartAt - at;
    // Fade to black, then (intro.c isn't ported) CB2_InitTitleScreen again
    await t.until(() => t.events().filter((e) => e.type === 'titleScreen').length === 2);
    return { timer, waited };
  });
  expect(restart.timer).toBeLessThan(2700);
  expect(Math.abs(restart.waited - (2700 - restart.timer))).toBeLessThanOrEqual(2);
  await titleRunning(game);
});

test('B+SELECT+UP: the clear save data screen; NO keeps the save, YES clears it; both soft-reset to the title', async () => {
  let game = await session.start({ start: 'after-rival' });
  await saveNow(game);
  const hasSave = () => game.eval(() => localStorage.getItem('firered-phaser:save') !== null);
  expect(await hasSave()).toBe(true);

  for (const answer of ['NO', 'YES'] as const) {
    game = await game.load({ title: true, keepSave: true });
    await titleRunning(game);
    await game.eval((t) => t.press(['B', 'SELECT', 'UP'], 4));
    await game.waitFor((t) => t.clearSaveData()?.waitingForAnswer, { what: 'the clear save data YES/NO' });
    await game.screenshot(`clear-save-data-${answer}`);
    if (answer === 'YES') await game.press('UP'); // NO is the default
    const since = await game.mark();
    await game.press('A');
    // DoSoftReset: back to the title screen
    await game.waitForEvent('titleScreen', { since, timeout: 60_000 });
    expect(await hasSave()).toBe(answer === 'NO');
    await titleRunning(game);
  }
});

/** Press A through the controls guide and the Pikachu intro (each page takes input once its fade is over). */
async function throughIntroPages(game: Game): Promise<void> {
  for (const task of ['Task_ControlsGuide_HandleInput', 'Task_PikachuIntro_HandleInput']) {
    for (let page = 0; page < 3; page++) {
      // (waits in the page: the functions are sent as source, so they get `task` as an argument)
      await game.eval(
        (t, task) => t.until(() => t.oakSpeech()?.task === task && !t.oakSpeech()!.fading && (task !== 'Task_PikachuIntro_HandleInput' || t.oakSpeech()!.pikachuState === 1)),
        task,
      );
      await game.press('A');
    }
  }
}

/** The naming screen: type `n` "A"s (the cursor starts on A), then OK. */
async function typeName(game: Game, n: number): Promise<void> {
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_NamingScreen', { what: 'the naming screen' });
  await game.eval((t) => t.waitFrames(30)); // the screen fades in
  await game.pressTimes('A', n);
  await game.press('START'); // jump to OK
  await game.press('A');
}

test("NEW GAME: Oak's speech, GIRL, both names from the naming screen; the game starts in the player's room", async () => {
  const game = await session.start({ title: true });
  await titleRunning(game);
  await game.press('START');
  // No save: the main menu goes on to NEW GAME → StartNewGameScene
  await game.waitForEvent('oakSpeech', { timeout: 60_000 });
  await throughIntroPages(game);
  await game.mashUntil((t) => t.oakSpeech()?.menu === 'gender', { what: 'BOY / GIRL' });
  await game.press('DOWN');
  await game.press('A');
  expect(await game.eval((t) => t.oakSpeech()!.playerGender)).toBe('female');

  // "Your name, what is it?" → the naming screen at once (the player gets no preset list); "AAAA", YES
  await typeName(game, 4);
  await game.waitFor((t) => t.oakSpeech()?.menu === 'yesNo', { what: 'the name confirmation', timeout: 60_000 });
  expect(await game.eval((t) => t.oakSpeech()!.playerName)).toBe('AAAA');
  await game.screenshot('oak-speech-confirm-name');
  await game.press('A');

  // The rival: NEW NAME → the naming screen; "AA", YES
  await game.mashUntil((t) => t.oakSpeech()?.menu === 'names', { what: "the rival's name list" });
  await game.screenshot('oak-speech-rival-names');
  await game.press('A');
  await typeName(game, 2);
  await game.waitFor((t) => t.oakSpeech()?.menu === 'yesNo', { what: "the rival's name confirmation", timeout: 60_000 });
  await game.press('A');

  // "Let's go!", the shrink, then CB2_NewGame
  await game.mashUntil((t) => t.oakSpeech()?.task === 'Task_OakSpeech_ShrinkPlayerPic', { what: 'the shrinking pic' });
  await game.waitForEvent('ready', { timeout: 60_000 });
  const field = await game.eval((t) => ({ map: t.field()!.map, x: t.field()!.x, y: t.field()!.y, player: t.state!.playerName, rival: t.state!.rivalName, gender: t.state!.playerGender, avatar: t.field()!.avatar.graphicsId }));
  expect(field).toMatchObject({ map: 'PalletTown_PlayersHouse_2F', x: 6, y: 6, player: 'AAAA', rival: 'AA', gender: 'female' });
  expect(field.avatar).toMatch(/GREEN|LEAF|FEMALE/);
});

test("Oak's speech: B on NO renames; a preset rival name; BOY keeps the male avatar", async () => {
  const game = await session.start({ title: true });
  await titleRunning(game);
  await game.press('START');
  await game.waitForEvent('oakSpeech', { timeout: 60_000 });
  await throughIntroPages(game);
  await game.mashUntil((t) => t.oakSpeech()?.menu === 'gender', { what: 'BOY / GIRL' });
  await game.press('A'); // BOY
  await typeName(game, 1);
  await game.waitFor((t) => t.oakSpeech()?.menu === 'yesNo', { what: 'the name confirmation', timeout: 60_000 });
  // NO: the naming screen again (GetDefaultName first, so a blank name would keep a preset)
  await game.press('B');
  await typeName(game, 3);
  await game.waitFor((t) => t.oakSpeech()?.menu === 'yesNo', { what: 'the second confirmation', timeout: 60_000 });
  expect(await game.eval((t) => t.oakSpeech()!.playerName)).toBe('AAA');
  await game.press('A');
  await game.mashUntil((t) => t.oakSpeech()?.menu === 'names', { what: "the rival's name list" });
  await game.pressTimes('DOWN', 2); // GARY
  await game.press('A');
  await game.waitFor((t) => t.oakSpeech()?.menu === 'yesNo', { what: "the rival's name confirmation", timeout: 60_000 });
  await game.press('A');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'ready'), { what: 'the new game', timeout: 120_000 });
  expect(await game.eval((t) => ({ player: t.state!.playerName, rival: t.state!.rivalName, gender: t.state!.playerGender }))).toEqual({ player: 'AAA', rival: 'GARY', gender: 'male' });
});
