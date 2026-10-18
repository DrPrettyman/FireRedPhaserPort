// Easy Chat (SIDE_PLAN.md W-easychat): the Pewter Pokémon Center's profile woman (data/scripts/mystery_event_club.inc,
// talked to from (13, 3)) → Common_ShowEasyChatScreen → the Easy Chat screen (menus/easyChatScreen.ts) → back, and
// the saved words in the field (ShowEasyChatMessage).
//
// Choosing words (the groups / keyboard / word list, ECInterfaceCmd_09-22) is unit 4: until then a test that needs a
// changed profile writes the word into the screen's buffer through the probe, where unit 4 will type it.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** Press A (or `button`) until the field message matches `re`; returns it. */
async function untilMessage(game: Game, re: RegExp, what: string): Promise<string> {
  await game.eval((_t, src, flags) => ((window as any).__ecRe = new RegExp(src, flags)), re.source, re.flags);
  return (await game.mashUntil((t) => (window as any).__ecRe.test(t.message() ?? '') && t.message(), { what })) as string;
}

/** The profile woman with `profile` (EC_WORD_* names) saved: talk, YES, through to the Easy Chat screen taking input. */
async function openProfileScreen(profile: string[]): Promise<Game> {
  const game = await session.start({ start: 'after-rival', map: 'PewterCity_PokemonCenter_1F', x: 13, y: 3 });
  await game.eval((t, words) => {
    const d = t.state!.defines;
    t.state!.easyChatProfile.splice(0, 4, ...words.map((n: string) => d.require(n)));
  }, profile);
  await game.eval((t) => t.face('up'));
  // Her greeting, YES at the multichoice (A picks the first item), "What's your profile?", the fade, the screen.
  // The mash stops as soon as the screen's callback is set, two ticks before Task_RunEasyChat reads the keys.
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_EasyChatScreen', { what: 'the Easy Chat screen' });
  await game.waitForScreen('CB2_EasyChatScreen');
  return game;
}

/** The screen's probe (menus/easyChatScreen.ts easyChatProbe), minus the live model and the reprint hook. */
function probe(game: Game) {
  return game.eval((t) => {
    const p = t.easyChat();
    if (!p) return undefined;
    const s = p.screen!;
    return { state: s.state, lastCommand: p.lastCommand, cursor: p.cursor, buffer: [...s.ecWordBuffer], startSelectVisible: p.startSelectVisible };
  });
}

/** Wait (in the page) until the screen has run interface command `cmd` and is back reading input in `state`. */
async function waitForCommand(game: Game, cmd: number, state: number): Promise<void> {
  const ok = await game.eval(
    (t, c, s) =>
      t.until(() => {
        const p = t.easyChat();
        return !!p && p.lastCommand === c && p.screen!.state === s && p.idle;
      }, 600),
    cmd,
    state,
  );
  expect(ok, `command ${cmd} / state ${state}`).toBe(true);
}

/** Wait (in the page) until the screen is gone and the field is back. */
async function waitForField(game: Game): Promise<void> {
  expect(await game.eval((t) => t.until(() => !t.easyChat() && !t.gbaScreen(), 20000))).toBe(true);
}

async function wordIds(game: Game, names: string[]): Promise<number[]> {
  return game.eval((t, n) => n.map((name: string) => t.state!.defines.require(name)), names);
}

const PROFILE = ['EC_WORD_HELLO', 'EC_WORD_TRAINER', 'EC_WORD_SEE_YA', 'EC_WORD_EXCL'];

// EC_CMD / EC_STATE (menus/easyChatScreenModel.ts)
const CMD = { UPDATE_MAIN_CURSOR: 2, UPDATE_MAIN_CURSOR_ON_BUTTONS: 3, PROMPT_DELETE_ALL: 4, PROMPT_EXIT: 5, PROMPT_CONFIRM: 6, CLOSE_PROMPT: 7, CLOSE_PROMPT_AFTER_DELETE: 8 };
const STATE = { SELECT_FIELD: 0, SELECT_FOOTER: 1, CANCEL_YES_NO: 4, DEL_ALL_YES_NO: 5, CONFIRM_YES_NO: 6 };

test('the profile screen: B → YES quits (EventScript_CancelGiveProfile)', async () => {
  const game = await openProfileScreen(PROFILE);
  // The PROFILE frame (sPhraseFrameDimensions[0]: left 3, top 4): the triangle cursor left of the first field.
  const p = (await probe(game))!;
  expect(p.state).toBe(STATE.SELECT_FIELD);
  expect(p.cursor).toMatchObject({ x: 3 * 8 + 13, y: (4 + 1) * 8 + 1, bouncing: true });
  expect(p.startSelectVisible).toBe(false);
  await game.screenshot('easyChat-profile');

  await game.press('B');
  await waitForCommand(game, CMD.PROMPT_EXIT, STATE.CANCEL_YES_NO);
  expect((await probe(game))!.cursor).toMatchObject({ bouncing: false, x2: 0 });
  await game.screenshot('easyChat-quit-editing');
  // The cursor starts on NO: B closes the prompt, back to the fields.
  await game.press('B');
  await waitForCommand(game, CMD.CLOSE_PROMPT, STATE.SELECT_FIELD);
  expect((await probe(game))!.cursor!.bouncing).toBe(true);
  await game.press('B');
  await waitForCommand(game, CMD.PROMPT_EXIT, STATE.CANCEL_YES_NO);
  await game.press('UP');
  await game.press('A');
  await waitForField(game);
  await untilMessage(game, /decided not to/, 'EventScript_CancelGiveProfile');
  expect(await game.eval((t) => t.state!.easyChatProfile.slice(0, 4))).toEqual(await wordIds(game, PROFILE));
  // Task_RunEasyChat sets the flag on leaving the profile, cancelled or not.
  expect(await game.eval((t) => t.flag('FLAG_SYS_SET_TRAINER_CARD_PROFILE'))).toBe(true);
  expect(await game.eval((t) => t.var('VAR_TEMP_1'))).toBe(0);
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the script over', button: 'B' });
});

test('the cursor moves over the fields and the footer; DEL. ALL → YES empties the fields', async () => {
  const game = await openProfileScreen(PROFILE);
  // RIGHT: the second field, after HELLO (5 glyphs 6 px wide in FONT_NORMAL_COPY_1) + 17 (ECInterfaceCmd_02).
  await game.press('RIGHT');
  await waitForCommand(game, CMD.UPDATE_MAIN_CURSOR, STATE.SELECT_FIELD);
  expect((await probe(game))!.cursor).toMatchObject({ x: 37 + 30 + 17, y: 41 });
  // DOWN: the second row; DOWN again: the footer, same column (1 = CANCEL at x 115, y 97: ECInterfaceCmd_03).
  await game.press('DOWN');
  await waitForCommand(game, CMD.UPDATE_MAIN_CURSOR, STATE.SELECT_FIELD);
  expect((await probe(game))!.cursor!.y).toBe(8 * (4 + 2 + 1) + 1);
  await game.press('DOWN');
  await waitForCommand(game, CMD.UPDATE_MAIN_CURSOR_ON_BUTTONS, STATE.SELECT_FOOTER);
  expect((await probe(game))!.cursor).toMatchObject({ x: 115, y: 97 });
  await game.press('LEFT');
  await waitForCommand(game, CMD.UPDATE_MAIN_CURSOR_ON_BUTTONS, STATE.SELECT_FOOTER);
  expect((await probe(game))!.cursor).toMatchObject({ x: 28, y: 97 });
  // DEL. ALL: the prompt starts on NO.
  await game.press('A');
  await waitForCommand(game, CMD.PROMPT_DELETE_ALL, STATE.DEL_ALL_YES_NO);
  await game.screenshot('easyChat-del-all');
  await game.press('UP');
  await game.press('A');
  await waitForCommand(game, CMD.CLOSE_PROMPT_AFTER_DELETE, STATE.SELECT_FOOTER);
  expect((await probe(game))!.buffer).toEqual([0xffff, 0xffff, 0xffff, 0xffff]);
  await game.screenshot('easyChat-empty');
  // START with every field empty asks "Quit editing?" (Confirm_CreateYesNoMenu); YES leaves without saving.
  await game.press('START');
  await waitForCommand(game, CMD.PROMPT_EXIT, STATE.CANCEL_YES_NO);
  await game.press('UP');
  await game.press('A');
  await waitForField(game);
  await untilMessage(game, /decided not to/, 'EventScript_CancelGiveProfile');
  expect(await game.eval((t) => t.state!.easyChatProfile.slice(0, 4))).toEqual(await wordIds(game, PROFILE));
});

test('START → YES on an unchanged profile keeps it (VAR_RESULT FALSE: EventScript_CancelGiveProfile)', async () => {
  const game = await openProfileScreen(PROFILE);
  await game.press('START');
  await waitForCommand(game, CMD.PROMPT_CONFIRM, STATE.CONFIRM_YES_NO);
  await game.screenshot('easyChat-confirm');
  await game.press('A'); // the cursor starts on YES
  await waitForField(game);
  // Confirm_HandleYesNoMenu: VAR_RESULT = HasECMessageChanged(), FALSE here, so the script says "decided not to".
  await untilMessage(game, /decided not to/, 'EventScript_CancelGiveProfile');
  expect(await game.eval((t) => t.state!.easyChatProfile.slice(0, 4))).toEqual(await wordIds(game, PROFILE));
  expect(await game.eval((t) => t.flag('FLAG_SYS_SET_TRAINER_CARD_PROFILE'))).toBe(true);
});

test('START → YES saves a changed profile (EventScript_GaveProfile), which she reads back', async () => {
  const game = await openProfileScreen(PROFILE);
  // Unit 4 types the word through the groups; until then it goes straight into the edited buffer.
  await game.eval((t) => {
    const p = t.easyChat()!;
    p.screen!.ecWordBuffer[3] = t.state!.defines.require('EC_WORD_QUES');
    p.reprint();
  });
  await game.screenshot('easyChat-changed');
  await game.press('START');
  await waitForCommand(game, CMD.PROMPT_CONFIRM, STATE.CONFIRM_YES_NO);
  await game.press('A');
  await waitForField(game);
  expect(await untilMessage(game, /HELLO/, 'the profile in the message box')).toBe('HELLO TRAINER SEE YA ?');
  await untilMessage(game, /says something/, 'Text_ProfileSaysSomethingAboutYou');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the script over', button: 'B' });
  expect(await game.eval((t) => t.var('VAR_TEMP_1'))).toBe(1); // GAVE_PROFILE
  expect(await game.eval((t) => t.state!.easyChatProfile.slice(0, 4))).toEqual(await wordIds(game, ['EC_WORD_HELLO', 'EC_WORD_TRAINER', 'EC_WORD_SEE_YA', 'EC_WORD_QUES']));
  await game.press('A');
  await untilMessage(game, /tell me more about/, 'EventScript_AlreadyGaveProfile');
});

test('MYSTERY EVENT IS EXCITING confirmed: EventScript_GaveSpecialProfile', async () => {
  const game = await openProfileScreen(['EC_WORD_MYSTERY', 'EC_WORD_EVENT', 'EC_WORD_IS', 'EC_WORD_EXCITING']);
  await game.press('START');
  await waitForCommand(game, CMD.PROMPT_CONFIRM, STATE.CONFIRM_YES_NO);
  await game.press('A');
  await waitForField(game);
  // CompareProfileResponseWithPassphrase: VAR_0x8004 = 0, which the script checks before VAR_RESULT.
  expect(await untilMessage(game, /MYSTERY/, 'the profile in the message box')).toBe('MYSTERY EVENT IS EXCITING');
  await untilMessage(game, /heard that before/, 'Text_HeardThatBefore');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the script over', button: 'B' });
  expect(await game.eval((t) => t.var('VAR_TEMP_1'))).toBe(1);
});
