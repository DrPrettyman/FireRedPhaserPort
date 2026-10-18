// Easy Chat (SIDE_PLAN.md W-easychat): the saved words in the field (ShowEasyChatMessage), at the Pewter Pokémon
// Center's profile woman (data/scripts/mystery_event_club.inc).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** Press A until the field message matches `re`; returns it. */
async function untilMessage(game: Game, re: RegExp, what: string): Promise<string> {
  await game.eval((_t, src, flags) => ((window as any).__ecRe = new RegExp(src, flags)), re.source, re.flags);
  return (await game.mashUntil((t) => (window as any).__ecRe.test(t.message() ?? '') && t.message(), { what })) as string;
}

test("the Pewter Pokémon Center's profile woman reads the saved profile back", async () => {
  const game = await session.start({ start: 'after-rival', map: 'PewterCity_PokemonCenter_1F', x: 13, y: 3 });
  await game.eval((t) => {
    const d = t.state!.defines;
    t.state!.easyChatProfile = ['EC_WORD_HELLO', 'EC_WORD_TRAINER', 'EC_WORD_SEE_YA', 'EC_WORD_EXCL', 'EC_WORD_UNDEFINED', 'EC_WORD_UNDEFINED'].map((n) => d.require(n));
  });
  await game.eval((t) => t.face('up'));
  // YES at the multichoice (A picks the first item), "What's your profile?", then Common_ShowEasyChatScreen.
  // The Easy Chat screen isn't ported yet (the special is a known gap that runs on), so VAR_0x8004 is still
  // EASY_CHAT_TYPE_PROFILE (0) where CompareProfileResponseWithPassphrase would have set it, and the script takes
  // EventScript_GaveSpecialProfile: ShowEasyChatMessage, then "I've heard that before". Once the screen is in, a
  // profile other than MYSTERY EVENT IS EXCITING goes through EventScript_GaveProfile instead.
  expect(await untilMessage(game, /HELLO/, 'the profile in the message box')).toBe('HELLO TRAINER SEE YA !');
  await untilMessage(game, /heard that before/, 'her reply');
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what: 'the script over', button: 'B' });
  expect(await game.eval((t) => t.var('VAR_TEMP_1'))).toBe(1); // GAVE_PROFILE
  await game.press('A');
  await untilMessage(game, /tell me more about/, 'EventScript_AlreadyGaveProfile');
});
