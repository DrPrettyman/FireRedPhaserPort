// The option menu (menus/optionMenu.ts, option_menu.c) from the start menu's OPTION: changing settings, closing
// back to the start menu (CB2_ReturnToFieldWithOpenMenu), reopening with them kept, and saving them; and the start
// menu's help window (ui/HelpMessageWindow.ts, help_message.c), which describes the item under the cursor in the
// HELP button mode only. The option menu is on the GBA layer: `t.optionMenu()` has its state (loadState 2 = input).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** After the first rival battle, in Oak's lab: the start menu has POKéMON, BAG, PLAYER, SAVE, OPTION, EXIT. */
const LAB = { start: 'after-rival' } as const;

// option_menu.c's MENUITEM_*
const MENUITEM_TEXTSPEED = 0;
const MENUITEM_BUTTONMODE = 4;
const MENUITEM_FRAMETYPE = 5;

/** START (from the field), or the start menu already open; resolves with it once it's up. */
async function startMenu(game: Game) {
  if (!(await game.eval((t) => t.startMenu()))) {
    await game.waitIdle();
    await game.press('START');
  }
  return game.waitFor((t) => !t.gbaScreen() && t.startMenu(), { what: 'the start menu' });
}

/** Move the start menu's cursor to `item` (it wraps), one press at a time. */
async function moveTo(game: Game, item: 'SAVE' | 'OPTION') {
  const menu = await startMenu(game);
  const downs = (menu.items.indexOf(item) - menu.cursor + menu.items.length) % menu.items.length;
  for (let i = 0; i < downs; i++) {
    const before = (await game.eval((t) => t.startMenu()!.cursor))!;
    await game.press('DOWN');
    expect(await game.eval((t, before) => t.until(() => t.startMenu()!.cursor !== before), before)).toBe(true);
  }
}

/** START → OPTION → A; resolves once the option menu takes input. */
async function openOptions(game: Game) {
  await moveTo(game, 'OPTION');
  await game.press('A');
  await game.waitFor((t) => t.gbaScreen() === 'CB2_InitOptionMenu' && t.optionMenu()?.loadState === 2, { what: 'the option menu' });
  return (await game.eval((t) => t.optionMenu()))!;
}

/** Press `button` in the option menu and wait until its cursor / an item's value is `check`'s. */
async function optionInput(game: Game, button: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', check: { cursorPos?: number; item?: number; value?: number }) {
  await game.press(button);
  const ok = await game.eval(
    (t, c) =>
      t.until(() => {
        const m = t.optionMenu();
        return !!m && (c.cursorPos === undefined || m.cursorPos === c.cursorPos) && (c.item === undefined || m.option[c.item] === c.value);
      }),
    check,
  );
  expect(ok, `the option menu after ${button}: ${JSON.stringify(await game.eval((t) => t.optionMenu()))}`).toBe(true);
}

/** Close the option menu (A or B) and wait for the start menu it returns to, once the field has faded in (its input waits for that). */
async function closeOptions(game: Game, button: 'A' | 'B' = 'B') {
  await game.press(button);
  return game.waitFor((t) => !t.gbaScreen() && !t.optionMenu() && !t.field()?.fading && t.startMenu(), { what: 'the start menu after the options' });
}

test('OPTION: change the text speed and the frame, close back to the start menu, reopen with them kept, save them', async () => {
  const game = await session.start(LAB);
  const options = await openOptions(game);
  // The harness starts with FAST text, frame 1, HELP, MONO
  expect(options.cursorPos).toBe(MENUITEM_TEXTSPEED);
  expect(options.option.slice(0, 6)).toEqual([2, 0, 0, 0, 0, 0]);

  // FAST → MID (LEFT); RIGHT wraps FAST → SLOW → MID the other way
  await optionInput(game, 'LEFT', { item: MENUITEM_TEXTSPEED, value: 1 });
  // Down to FRAME; LEFT from TYPE 1 wraps to TYPE 10, RIGHT back to 1, RIGHT again to 2
  for (let i = 1; i <= MENUITEM_FRAMETYPE; i++) await optionInput(game, 'DOWN', { cursorPos: i });
  await optionInput(game, 'LEFT', { item: MENUITEM_FRAMETYPE, value: 9 });
  await optionInput(game, 'RIGHT', { item: MENUITEM_FRAMETYPE, value: 0 });
  await optionInput(game, 'RIGHT', { item: MENUITEM_FRAMETYPE, value: 1 });
  await game.screenshot('woptions-option-menu');
  // UP from TEXT SPEED wraps to CANCEL
  for (let i = MENUITEM_FRAMETYPE - 1; i >= 0; i--) await optionInput(game, 'UP', { cursorPos: i });
  await optionInput(game, 'UP', { cursorPos: 6 });

  // B saves and returns to the start menu, still on OPTION
  const menu = await closeOptions(game);
  expect(menu.items[menu.cursor]).toBe('OPTION');
  expect(await game.eval((t) => ({ textSpeed: t.state!.textSpeed, frame: t.state!.optionsWindowFrameType }))).toEqual({ textSpeed: 'mid', frame: 1 });

  // Reopened: the settings are kept and the cursor starts on TEXT SPEED again
  const again = await openOptions(game);
  expect(again.cursorPos).toBe(MENUITEM_TEXTSPEED);
  expect(again.option[MENUITEM_TEXTSPEED]).toBe(1);
  expect(again.option[MENUITEM_FRAMETYPE]).toBe(1);
  await closeOptions(game, 'A'); // A closes too

  // SAVE writes them
  await moveTo(game, 'SAVE');
  await game.press('A');
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press('A');
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  const saved = await game.eval(() => JSON.parse(localStorage.getItem('firered-phaser:save') ?? 'null'));
  expect(saved?.options).toMatchObject({ textSpeed: 'mid', windowFrameType: 1, buttonMode: 0, sound: 0 });
});

test('the start menu help window: the item under the cursor, on open and on cursor moves; gone on close and in LR mode', async () => {
  const game = await session.start(LAB);
  const menu = await startMenu(game);
  expect(menu.items).toEqual(['POKEMON', 'BAG', 'PLAYER', 'SAVE', 'OPTION', 'EXIT']);
  expect(menu.items[menu.cursor]).toBe('POKEMON');
  expect(await game.eval((t) => t.helpMessage())).toMatch(/^Check and organize POKéMON/);

  await game.press('DOWN');
  await game.waitFor((t) => t.startMenu()?.cursor === 1, { what: 'the cursor on BAG' });
  expect(await game.eval((t) => t.helpMessage())).toMatch(/^Equipped with pockets/);
  await game.press('UP');
  await game.press('UP'); // wraps to EXIT
  await game.waitFor((t) => t.startMenu()?.cursor === 5, { what: 'the cursor on EXIT' });
  expect(await game.eval((t) => t.helpMessage())).toBe('Close this MENU window.');
  await game.screenshot('woptions-help-window');

  // B closes the menu and the help window
  await game.press('B');
  await game.waitIdle();
  expect(await game.eval((t) => t.helpMessage())).toBeUndefined();

  // BUTTON MODE → LR in the option menu: the reopened start menu has no help window
  await moveTo(game, 'OPTION');
  expect(await game.eval((t) => t.helpMessage())).toMatch(/^Adjust various game settings/);
  await game.press('A');
  await game.waitFor((t) => t.optionMenu()?.loadState === 2, { what: 'the option menu' });
  for (let i = 1; i <= MENUITEM_BUTTONMODE; i++) await optionInput(game, 'DOWN', { cursorPos: i });
  await optionInput(game, 'RIGHT', { item: MENUITEM_BUTTONMODE, value: 1 });
  const back = await closeOptions(game);
  expect(back.items[back.cursor]).toBe('OPTION');
  expect(await game.eval((t) => t.state!.optionsButtonMode)).toBe(1);
  expect(await game.eval((t) => t.helpMessage())).toBeUndefined();
  await game.press('UP');
  await game.waitFor((t) => t.startMenu()?.cursor === 3, { what: 'the cursor on SAVE' });
  expect(await game.eval((t) => t.helpMessage())).toBeUndefined();
  await game.press('B');
  await game.waitIdle();
  await game.press('START');
  await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  expect(await game.eval((t) => t.helpMessage())).toBeUndefined();
});
