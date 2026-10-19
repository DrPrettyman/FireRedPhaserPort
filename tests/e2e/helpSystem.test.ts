// The L/R help system (ui/helpSystem.ts: help_system_util.c; ui/helpSystemMenu.ts and ui/helpSystemContext.ts:
// help_system.c). In the HELP button mode L or R opens it over whatever runs (RunHelpSystemCallback before the main
// callbacks: the field's tick, the GBA layer's main loop), which is paused until it closes: the welcome page on the
// first open only, the context's topics, a topic's submenu, a help item, B back out. SE_HELP_OPEN / _CLOSE, and the
// BGM at half volume while it's up. `t.helpSystem()`: videoState 5 = up and taking input; menuState is
// RunHelpMenuSubroutine's (9 the welcome page, 0 the topics, 3 a submenu, 6 a help item).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const gen = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../public/gen', f), 'utf8'));
const strings: Record<string, string> = gen('text/strings.json');
const helpJson = gen('helpSystem.json');
const helpIds: Record<string, number> = helpJson.helpIds;
/**
 * The topics BuildMainTopicsListAndMoveToH00 lists for a context: sHelpSystemContextTopicFlags[context]'s, in
 * sHelpSystemContextTopicOrder; the last (EXIT) has index -2.
 */
function topicsFor(context: number): number[] {
  const ids = (helpJson.contextTopicOrder as number[]).filter((i) => helpJson.contextTopicFlags[context][i]);
  ids[ids.length - 1] = -2;
  return ids;
}
/** A strings.json string as `t.helpSystem()` decodes it (without the EOS). */
const str = (label: string) => strings[label].replace(/\$$/, '');

/** Viridian City, outdoors: HELPCONTEXT_OVERWORLD. */
const VIRIDIAN = { start: 'after-rival', map: 'ViridianCity', x: 21, y: 30 } as const;

/** Wait until the help is up and RunHelpMenuSubroutine is in `menuState`; resolves with `t.helpSystem()`. */
async function waitMenuState(game: Game, menuState: number, what: string) {
  const ok = await game.eval((t, s) => t.until(() => t.helpSystem().videoState === 5 && t.helpSystem().menuState === s, 2000), menuState);
  expect(ok, what).toBe(true);
  return game.eval((t) => t.helpSystem());
}

/**
 * The context is `contextName` (HELPCONTEXT_*): L opens the help (A past the welcome page if it shows), its topics
 * are the context's, B closes it again.
 */
async function checkHelpContext(game: Game, contextName: string, what: string): Promise<void> {
  const context = await game.eval((t, n) => t.define(n), contextName);
  expect(await game.eval((t) => t.helpSystem().context), `the context: ${what}`).toBe(context);
  await game.press('L');
  const up = await game.eval((t) => t.until(() => t.helpSystem().videoState === 5 && [0, 9].includes(t.helpSystem().menuState), 2000));
  expect(up, `the help opens: ${what}`).toBe(true);
  if ((await game.eval((t) => t.helpSystem().menuState)) === 9) await game.press('A');
  const help = await waitMenuState(game, 0, `the topics: ${what}`);
  expect(help.items.map((i) => i.index), `the topics: ${what}`).toEqual(topicsFor(context));
  await game.press('B');
  expect(await game.eval((t) => t.until(() => t.helpSystem().videoState === 0, 600)), `the help closes: ${what}`).toBe(true);
}

test('L in the field opens the help: the welcome page once, a topic and an item, B back out; the field and the BGM as before', async () => {
  const game = await session.start(VIRIDIAN);
  await game.waitIdle();
  await game.eval((t) => (t.state!.optionsButtonMode = t.define('OPTIONS_BUTTON_MODE_HELP')));
  if (!(await game.eval((t) => t.audio().players.BGM.playing))) await game.eval((t) => t.playSong('MUS_VIRIDIAN'));
  const bgm = await game.eval((t) => t.audio().players.BGM);
  expect(bgm.volume).toBe(64);
  const where = await game.eval((t) => ({ x: t.field()!.x, y: t.field()!.y }));
  expect(await game.eval((t) => t.helpSystem().context)).toBe(await game.eval((t) => t.define('HELPCONTEXT_OVERWORLD')));

  const mark = await game.mark();
  await game.press('L');
  let help = await waitMenuState(game, 9, 'the welcome page');
  const events = await game.eval((t, s) => t.audioEvents(s), mark);
  expect(events.find((e) => e.type === 'se')).toMatchObject({ name: 'SE_HELP_OPEN', started: true });
  expect(await game.eval((t) => t.audio().players.BGM)).toMatchObject({ song: bgm.song, playing: true, volume: 32 });

  // A: the topics HELPCONTEXT_OVERWORLD has, in sHelpSystemContextTopicOrder; the last (EXIT) is -2
  await game.press('A');
  help = await waitMenuState(game, 0, 'the topics');
  expect(help.items).toEqual([
    { label: str('Help_Text_WhatShouldIDo'), index: 0 },
    { label: str('Help_Text_HowDoIDoThis'), index: 1 },
    { label: str('Help_Text_WhatDoesThisTermMean'), index: 2 },
    { label: str('Help_Text_Exit'), index: -2 },
  ]);
  // The field is paused: DOWN moves the help's cursor, not the player
  await game.press('DOWN');
  expect(await game.eval((t) => t.until(() => t.helpSystem().cursorPos === 1, 600))).toBe(true);
  await game.press('UP');
  expect(await game.eval((t) => t.until(() => t.helpSystem().cursorPos === 0, 600))).toBe(true);

  // WHAT SHOULD I DO?: sWhatToDo_Overworld's enabled items (HELP_WHAT_SHOULD_I_BE_DOING always), then CANCEL
  await game.press('A');
  help = await waitMenuState(game, 3, 'the WHAT SHOULD I DO? submenu');
  expect(help.level).toBe(1);
  expect(help.items[0]).toEqual({ label: str('Help_Text_WhatShouldIBeDoing'), index: helpIds.HELP_WHAT_SHOULD_I_BE_DOING });
  expect(help.items.at(-1)).toEqual({ label: str('Help_Text_Cancel'), index: -2 });

  // A on the first item: its question and answer
  await game.press('A');
  help = await waitMenuState(game, 6, 'the help item');
  expect(help).toMatchObject({ level: 2, scrollSub: helpIds.HELP_WHAT_SHOULD_I_BE_DOING });

  // B: back to the submenu (its cursor kept), B: the topics, B: closed
  await game.press('B');
  help = await waitMenuState(game, 3, 'back to the submenu');
  expect(help.level).toBe(1);
  await game.press('B');
  help = await waitMenuState(game, 0, 'back to the topics');
  expect(help.level).toBe(0);
  const closeMark = await game.mark();
  await game.press('B');
  expect(await game.eval((t) => t.until(() => t.helpSystem().videoState === 0 && !t.helpSystem().open, 600))).toBe(true);
  const closeEvents = await game.eval((t, s) => t.audioEvents(s), closeMark);
  expect(closeEvents.filter((e) => e.type === 'se').map((e) => e.name)).toEqual(['SE_SELECT', 'SE_HELP_CLOSE']);
  expect(await game.eval((t) => t.audio().players.BGM)).toMatchObject({ song: bgm.song, playing: true, volume: 64 });
  expect(await game.eval((t) => ({ x: t.field()!.x, y: t.field()!.y }))).toEqual(where);

  // The field runs again
  await game.eval((t) => t.walk('down', 1));
  expect(await game.eval((t) => t.field()!.y)).toBe(where.y + 1);

  // The second time there's no welcome page: straight to the topics; L closes it from anywhere
  await game.press('L');
  help = await waitMenuState(game, 0, 'the topics, no welcome page');
  await game.press('L');
  expect(await game.eval((t) => t.until(() => t.helpSystem().videoState === 0, 600))).toBe(true);
});

test('in the LR button mode L and R do nothing to it; HelpSystem_Disable makes them play SE_HELP_ERROR', async () => {
  const game = await session.start(VIRIDIAN);
  await game.waitIdle();
  await game.eval((t) => (t.state!.optionsButtonMode = t.define('OPTIONS_BUTTON_MODE_LR')));
  const mark = await game.mark();
  await game.press('L');
  await game.press('R');
  await game.eval((t) => t.waitFrames(10));
  expect(await game.eval((t) => t.helpSystem().videoState)).toBe(0);
  expect((await game.eval((t, s) => t.audioEvents(s), mark)).filter((e) => e.type === 'se')).toEqual([]);

  await game.eval((t) => (t.state!.optionsButtonMode = t.define('OPTIONS_BUTTON_MODE_HELP')));
  await game.eval(async (_t, path) => (await new Function('p', 'return import(p)')(path)).HelpSystem_Disable(), '/src/ui/helpSystemContext.ts');
  const mark2 = await game.mark();
  await game.press('R');
  await game.eval((t) => t.waitFrames(10));
  expect(await game.eval((t) => t.helpSystem().videoState)).toBe(0);
  expect((await game.eval((t, s) => t.audioEvents(s), mark2)).filter((e) => e.type === 'se').map((e) => e.name)).toEqual(['SE_HELP_ERROR']);
  await game.eval(async (_t, path) => (await new Function('p', 'return import(p)')(path)).HelpSystem_Enable(), '/src/ui/helpSystemContext.ts');
});

test('the help opens over a GBA-layer screen (the bag) and pauses it', async () => {
  const game = await session.start(VIRIDIAN);
  await game.waitIdle();
  await game.eval((t) => (t.state!.optionsButtonMode = t.define('OPTIONS_BUTTON_MODE_HELP')));
  await game.press('START');
  await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  const items = (await game.eval((t) => t.startMenu()!.items))!;
  for (let i = 0; i < items.indexOf('BAG'); i++) await game.press('DOWN');
  await game.press('A');
  await game.waitForBag();
  // The welcome page shows on the first open, whatever the screen
  await game.press('R');
  await waitMenuState(game, 9, 'the welcome page over the bag');
  expect(await game.eval((t) => t.gbaScreen())).toBe('CB2_BagMenuRun');
  await game.press('A');
  await waitMenuState(game, 0, 'the topics over the bag');
  // B closes the help, not the bag: its callbacks didn't run while the help was up
  await game.press('B');
  expect(await game.eval((t) => t.until(() => t.helpSystem().videoState === 0, 600))).toBe(true);
  await game.eval((t) => t.waitFrames(10));
  expect(await game.eval((t) => t.gbaScreen())).toBe('CB2_BagMenuRun');
  // and the bag takes input again: B leaves it for the field
  await game.press('B');
  await game.waitFor((t) => !t.gbaScreen() && t.startMenu(), { what: 'back to the start menu' });
});

test('the title screen: HELPCONTEXT_TITLE_SCREEN, its one topic (ABOUT THE GAME)', async () => {
  const game = await session.start({ title: true });
  await game.waitFor((t) => t.titleScreen()?.scene === 'RUN', { what: 'the title screen to run', timeout: 60_000 });
  expect(topicsFor(await game.eval((t) => t.define('HELPCONTEXT_TITLE_SCREEN')))).toEqual([3, -2]); // TOPIC_ABOUT_GAME, EXIT
  await checkHelpContext(game, 'HELPCONTEXT_TITLE_SCREEN', 'the title screen');
  // The title screen runs on
  await game.eval((t) => t.waitFrames(10));
  expect(await game.eval((t) => t.gbaScreen())).toBe('CB2_TitleScreenRun');
});

test("each screen's context: the save dialog, the Pokédex, the party menu, the bag, the summary, Bill's PC, a wild battle", async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity_PokemonCenter_1F', x: 11, y: 2 });
  await game.waitIdle();
  await game.eval((t) => {
    t.state!.optionsButtonMode = t.define('OPTIONS_BUTTON_MODE_HELP');
    t.state!.setFlag('FLAG_SYS_POKEDEX_GET', true);
  });
  await checkHelpContext(game, 'HELPCONTEXT_POKECENTER', 'a Pokémon Center');

  /** START, then the start menu's entry `item`. */
  const startMenu = async (item: string) => {
    await game.waitIdle();
    await game.press('START');
    await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
    const menu = (await game.eval((t) => t.startMenu()))!;
    const to = menu.items.indexOf(item as (typeof menu.items)[number]);
    for (let i = menu.cursor; i !== to; i += Math.sign(to - i)) await game.press(to > i ? 'DOWN' : 'UP');
    await game.press('A');
  };
  const backToField = async (what: string) => {
    await game.mashUntil((t) => !t.gbaScreen() && t.idle(), { button: 'B', what });
  };

  // The save dialog: BackupHelpContext + HELPCONTEXT_SAVE; NO restores the Pokémon Center's
  await startMenu('SAVE');
  await game.waitFor((t) => t.saveDialog(), { what: 'the save dialog' });
  await checkHelpContext(game, 'HELPCONTEXT_SAVE', 'the save dialog');
  await game.mashUntil((t) => !!t.startMenu(), { button: 'B', what: 'NO: back to the start menu' });
  expect(await game.eval((t) => t.helpSystem().context)).toBe(await game.eval((t) => t.define('HELPCONTEXT_POKECENTER')));
  await game.press('B');

  await startMenu('POKEDEX');
  await game.waitFor((t) => t.gbaScreen() === 'CB2_PokedexScreen' && t.pokedex()?.ready, { what: 'the Pokédex' });
  await checkHelpContext(game, 'HELPCONTEXT_POKEDEX', 'the Pokédex');
  await backToField('out of the Pokédex');

  await startMenu('POKEMON');
  await game.waitForPartyMenu();
  await checkHelpContext(game, 'HELPCONTEXT_PARTY_MENU', 'the party menu');
  // The summary (the first mon's action menu, SUMMARY): POKéMON INFO, then RIGHT to the skills page
  await game.press('A');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A');
  await game.waitForScreen('CB2_RunPokemonSummaryScreen');
  await checkHelpContext(game, 'HELPCONTEXT_POKEMON_INFO', 'the summary');
  await game.press('RIGHT');
  const skills = await game.eval((t) => t.define('HELPCONTEXT_POKEMON_SKILLS'));
  expect(await game.eval((t, c) => t.until(() => t.helpSystem().context === c, 600), skills), 'the skills page').toBe(true);
  await backToField('out of the party menu');

  await startMenu('BAG');
  await game.waitForBag();
  await checkHelpContext(game, 'HELPCONTEXT_BAG', 'the bag');
  await backToField('out of the bag');

  // The PC (Someone's PC): Task_PCMainMenu's HELPCONTEXT_BILLS_PC
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /withdraw a POK/.test(t.message() ?? ''), { what: 'the storage menu' });
  await checkHelpContext(game, 'HELPCONTEXT_BILLS_PC', "Bill's PC");
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the PC off' });

  // A wild battle: CB2_InitBattle's HELPCONTEXT_WILD_BATTLE; the bag in it keeps it (SetHelpContext)
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 2 }));
  await game.waitForActionMenu();
  await checkHelpContext(game, 'HELPCONTEXT_WILD_BATTLE', 'a wild battle');
  await game.chooseAction('BAG');
  await game.waitForBag();
  expect(await game.eval((t) => t.helpSystem().context), 'the bag in a battle').toBe(await game.eval((t) => t.define('HELPCONTEXT_WILD_BATTLE')));
});

test('Surf: HELPCONTEXT_SURFING on the water, SetHelpContextForMap once off it (Task_WaitStopSurfing)', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 7, y: 18, party: [{ species: 'LAPRAS', level: 40, moves: ['SURF'] }] });
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
  await game.waitIdle();
  expect(await game.eval((t) => t.helpSystem().context)).toBe(await game.eval((t) => t.define('HELPCONTEXT_SURFING')));
  await game.eval((t) => t.face('left'));
  await game.eval((t) => t.walk('left', 1));
  await game.waitFor((t) => t.idle() && t.field()!.avatar.flags.includes('ON_FOOT'), { what: 'the player on land' });
  expect(await game.eval((t) => t.helpSystem().context)).toBe(await game.eval((t) => t.define('HELPCONTEXT_OVERWORLD')));
});
