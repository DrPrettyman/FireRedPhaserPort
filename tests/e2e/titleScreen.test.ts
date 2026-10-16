// The title screen (title_screen.c) in front of the main menu: booting shows it, its intro plays through to the
// run scene (PRESS START blinking, flames), START goes to the main menu with a save and to the new game without,
// B on the main menu comes back to it, it restarts itself after 2700 frames, and B+SELECT+UP opens the clear
// save data screen (clear_save_data_screen.c), which soft-resets back to the title screen.

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

test('boot shows the title screen; its intro plays to PRESS START; START with no save starts the new game', async () => {
  const game = await session.start({ title: true });
  // The intro's scenes each last only a few dozen frames, so read them from the event log (SetTitleScreenScene)
  await titleRunning(game);
  const scenes = (await game.events()).filter((e) => e.type === 'titleScene').map((e) => e.scene);
  expect(scenes).toEqual(['FLASHSPRITE', 'FADEIN', 'RUN']);
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
  await game.waitFor((t) => t.events().some((e) => e.type === 'titleScene' && e.scene === 'CRY'), { what: 'the cry scene' });
  // No save: the main menu goes on to the new game at once
  await game.waitForEvent('mainMenu', { since });
  await game.waitForEvent('ready', { since, timeout: 60_000 });
  expect(await game.eval((t) => t.field()!.map)).toBe('PalletTown_PlayersHouse_2F');
});

test('A during the intro skips to PRESS START; START with a save opens the main menu, B there goes back to the title', async () => {
  let game = await session.start({ start: 'after-rival' });
  await saveNow(game);
  game = await game.load({ title: true, keepSave: true });
  // Press A in the page as soon as the flash starts: from outside, the intro could be over before the press lands
  await game.eval(async (t) => {
    await t.until(() => t.titleScreen()?.scene === 'FLASHSPRITE');
    await t.press('A');
  });
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
