// Teachy TV (teachy_tv.c, menus/teachyTv.ts): the Viridian old man gives it after his catching tutorial; it opens
// from the bag (FieldUseFunc_TeachyTv → InitTeachyTvFromBag, back to the bag) and with SELECT
// (Task_InitTeachyTvFromField, back to the field). `__test.teachyTv()` is the probe: the mode, option, scroll/row,
// the task and its TTVcmd step, the text printed last, the Pokédude's sprite, the grass sprites. The Pokédude's
// demos (battles, bag, TM case) aren't ported yet (W-teachy units 2-3): they're skipped (PokedudeDemoNotPorted),
// and the screen comes back as from the demo's end, to the option's closing text.

import { expect, test } from 'vitest';
import { useGame, type Game, type StartOptions } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };
/** Pallet Town, away from the pond and the NPCs (registeredItems.test.ts). */
const PALLET: StartOptions = { start: 'after-rival', map: 'PalletTown', x: 12, y: 14, party: [MEWTWO] };

async function setUp(game: Game, items: string[], registered?: string) {
  await game.eval(
    (t, items, registered) => {
      t.state!.setVar('VAR_REPEL_STEP_COUNT', 200);
      for (const item of items) t.state!.bag.add(t.define(item), 1);
      t.state!.registeredItem = registered ? t.define(registered) : 0;
    },
    items,
    registered,
  );
  await game.waitIdle();
}

/** The bag's list is taking input: the bag task, no fade, no window animation. */
async function waitForBagList(game: Game, what: string) {
  await game.waitFor((t) => t.gbaScreen() === 'CB2_BagMenuRun' && !t.paletteFadeActive() && t.gbaTasks().includes('Task_BagMenu_HandleInput') && !t.gbaTasks().includes('Task_AnimateWin0v'), { what });
}

/** START → BAG → KEY ITEMS → the first key item → USE: Teachy TV's list, faded in. */
async function openFromBag(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.waitFor((t) => !!t.startMenu(), { what: 'the start menu' });
  await game.press('DOWN'); // BAG (no POKéDEX yet)
  await game.press('A');
  await waitForBagList(game, 'the bag');
  await game.press('RIGHT');
  await waitForBagList(game, 'the key items pocket');
  await game.press('A');
  await game.waitFor((t) => t.gbaTasks().includes('Task_FieldItemContextMenuHandleInput'), { what: 'the context menu' });
  await game.press('A'); // USE
  await waitForList(game, 'Teachy TV from the bag');
}

async function waitForList(game: Game, what: string) {
  await game.waitFor((t) => !!t.teachyTv()?.listReady, { what, timeout: 60_000 });
}

test('the Viridian old man gives Teachy TV after his catching tutorial; it opens from the bag and B goes back to it', async () => {
  // The coord trigger at (22, 8) starts the tutorial once Oak's parcel has set the scene var to 1.
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity', x: 22, y: 9 });
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_VIRIDIAN_CITY_OLD_MAN', 1));
  expect(await game.eval((t) => t.itemCount('TEACHY_TV'))).toBe(0);
  await game.walk('up');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the tutorial battle to end' });
  // ViridianCity_EventScript_TutorialOldMan's end: "That was educational… Take this." giveitem ITEM_TEACHY_TV
  await game.mashUntil((t) => t.itemCount('TEACHY_TV') === 1 && t.idle(), { what: 'Teachy TV given', timeout: 180_000 });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_VIRIDIAN_CITY_OLD_MAN'))).toBe(2);

  await openFromBag(game);
  // No TM case: sListMenuItems_NoTMCase (four options and CANCEL), no scroll arrows; the menu music.
  const probe = await game.eval((t) => t.teachyTv());
  expect(probe).toMatchObject({ mode: 0, whichScript: 0, scrollOffset: 0, selectedRow: 0, listItems: 5, arrows: false, task: 'TeachyTvOptionListController' });
  expect(await game.eval((t) => t.audioEvents().filter((e) => e.type === 'bgm').at(-1)?.name)).toBe('MUS_TEACHY_TV_MENU');
  await game.screenshot('teachyTv-list-noTmCase');
  // SELECT does nothing when it came from the bag (sStaticResources.callback == CB2_BagMenuFromStartMenu).
  await game.press('SELECT');
  await game.eval((t) => t.waitFrames(10));
  expect(await game.eval((t) => t.teachyTv()?.listReady)).toBe(true);
  // B: LIST_CANCEL, the fade out, back to the bag with the map's music.
  await game.press('B');
  await waitForBagList(game, 'back to the bag');
  expect(await game.eval((t) => t.teachyTv())).toBeUndefined();
  expect(await game.eval((t) => t.audioEvents().filter((e) => e.type === 'bgm').at(-1)?.name)).toBe('MUS_PEWTER');
});

interface Seen {
  texts: string[];
  cmds: string[];
  tasks: string[];
  modes: number[];
  grass: number;
  bgm: string[];
}

/**
 * Press A from the list (choosing the option under the cursor) through the option's sequence until the list is
 * back; what it went through is recorded in the page every tick: the texts printed, the TTVcmds, the tasks, the
 * modes (2 after the demo), the most grass sprites up at once.
 */
async function runOption(game: Game, what: string): Promise<Seen> {
  const mark = await game.eval((t) => t.audioEvents().at(-1)?.seq ?? 0);
  await game.eval(() => {
    (window as any).__ttvSeen = { texts: [], cmds: [], tasks: [], modes: [], grass: 0, bgm: [] };
  });
  const seen = await game.mashUntil(
    (t) => {
      const r = (window as any).__ttvSeen;
      const p = t.teachyTv();
      if (p) {
        const push = (list: unknown[], v: unknown) => v !== undefined && list.at(-1) !== v && list.push(v);
        if (p.textActive) push(r.texts, p.text);
        push(r.cmds, p.cmd);
        push(r.tasks, p.task);
        push(r.modes, p.mode);
        r.grass = Math.max(r.grass, p.grass);
      }
      return r.texts.length >= 3 && p?.listReady && r;
    },
    { what, timeout: 180_000 },
  );
  seen.bgm = await game.eval((t, m) => t.audioEvents(m).filter((e) => e.type === 'bgm').map((e) => e.name), mark);
  return seen as Seen;
}

const BATTLE_CMDS = [
  'TTVcmd_TransitionRenderBg2TeachyTvGraphicInitNpcPos',
  'TTVcmd_ClearBg2TeachyTvGraphic',
  'TTVcmd_NpcMoveAndSetupTextPrinter',
  'TTVcmd_IdleIfTextPrinterIsActive',
  'TTVcmd_IdleIfTextPrinterIsActive2',
  'TTVcmd_TextPrinterSwitchStringByOptionChosen',
  'TTVcmd_IdleIfTextPrinterIsActive2',
  'TTVcmd_EraseTextWindowIfKeyPressed',
  'TTVcmd_StartAnimNpcWalkIntoGrass',
  'TTVcmd_DudeMoveUp',
  'TTVcmd_DudeMoveRight',
  'TTVcmd_TaskBattleOrFadeByOptionChosen',
];
const CLOSING_CMDS = [
  'TTVcmd_TextPrinterSwitchStringByOptionChosen2',
  'TTVcmd_IdleIfTextPrinterIsActive2',
  'TTVcmd_EraseTextWindowIfKeyPressed',
  'TTVcmd_DudeTurnLeft',
  'TTVcmd_DudeMoveLeft',
  'TTVcmd_RenderAndRemoveBg1EndGraphic',
  'TTVcmd_End',
];

test("each option's sequence: the title, the Pokédude's hello and intro, the (skipped) demo, his closing words, back to the list", async () => {
  const game = await session.start(PALLET);
  await setUp(game, ['ITEM_TEACHY_TV', 'ITEM_TM_CASE']);
  await openFromBag(game);
  // With the TM case: six options and CANCEL, six shown, the scroll arrows.
  expect(await game.eval((t) => t.teachyTv())).toMatchObject({ listItems: 7, arrows: true });
  await game.screenshot('teachyTv-list');
  const scripts = ['Battle', 'Status', 'Matchups', 'Catching', 'TMs', 'Register'];
  for (let option = 0; option < 6; option++) {
    if (option > 0) {
      await game.press('DOWN');
      const moved = await game.eval((t, o) => t.until(() => t.teachyTv()!.scrollOffset + t.teachyTv()!.selectedRow === o, 600), option);
      expect(moved, `the cursor on option ${option}`).toBe(true);
    }
    const seen = await runOption(game, `option ${option}'s sequence`);
    const name = scripts[option];
    expect(seen.texts, name).toEqual(['gTeachyTvText_PokedudeSaysHello', `gTeachyTvText_${name}Script1`, `gTeachyTvText_${name}Script2`]);
    // The demo comes back to the screen in mode 2 (TeachyTvPostBattleFadeControl), which goes on with the closing
    // text; the mode stays 2 (only InitTeachyTvController sets it) while the list is up again.
    expect(seen.modes, name).toEqual(option === 0 ? [0, 2] : [2]);
    expect(seen.tasks, name).toContain('TeachyTvPostBattleFadeControl');
    const battle = option < 4;
    const intro = battle ? BATTLE_CMDS : BATTLE_CMDS.filter((c) => !/Grass|DudeMove/.test(c));
    expect(seen.cmds, name).toEqual([...intro, ...CLOSING_CMDS]);
    // The Pokédude walks into the tall grass in the battle options only.
    if (battle) expect(seen.grass, name).toBeGreaterThan(0);
    else expect(seen.grass, name).toBe(0);
    // MUS_FOLLOW_ME with the title (and after the battle), MUS_TEACHY_TV_MENU back at the list
    expect(seen.bgm[0], name).toBe('MUS_FOLLOW_ME');
    expect(seen.bgm.at(-1), name).toBe('MUS_TEACHY_TV_MENU');
    // Back at the list on the same option, the Pokédude at the left edge.
    const p = await game.eval((t) => t.teachyTv());
    expect(p, name).toMatchObject({ mode: 2, whichScript: option, task: 'TeachyTvOptionListController', arrows: true });
    expect(p!.scrollOffset + p!.selectedRow, name).toBe(option);
    expect(p!.dude, name).toMatchObject({ x2: 8, invisible: false });
  }
  // CANCEL (scrolled into view), back to the bag.
  await game.press('DOWN');
  await game.waitFor((t) => t.teachyTv()?.scrollOffset === 1 && t.teachyTv()?.selectedRow === 5, { what: 'the list scrolled to CANCEL' });
  await game.press('A');
  await waitForBagList(game, 'back to the bag');
});

test('B during a sequence stops it: the noise, then the list again on the same option', async () => {
  const game = await session.start(PALLET);
  await setUp(game, ['ITEM_TEACHY_TV']);
  await openFromBag(game);
  await game.press('DOWN');
  await game.press('A'); // What are status problems?
  await game.waitFor((t) => t.teachyTv()?.text === 'gTeachyTvText_PokedudeSaysHello', { what: 'the hello' });
  await game.screenshot('teachyTv-hello');
  const r = await game.eval(async (t) => {
    // read in the tick TTVcmd_End starts (it lasts 64 frames)
    let atEnd: ReturnType<typeof t.teachyTv>;
    const ended = t.until(() => t.teachyTv()?.task === 'TTVcmd_End' && !!(atEnd = t.teachyTv()));
    void t.press('B');
    await ended;
    let list: ReturnType<typeof t.teachyTv>;
    await t.until(() => !!t.teachyTv()?.listReady && !!(list = t.teachyTv()));
    return { atEnd: atEnd!, list: list! };
  });
  // TeachyTvRenderMsgAndSwitchClusterFuncs's B: the grass off, the Pokédude to (0, 0), the text window cleared.
  expect(r.atEnd).toMatchObject({ grassDisabled: 1, dude: { x2: 0, y2: 0 } });
  expect(r.list).toMatchObject({ mode: 0, whichScript: 1, scrollOffset: 0, selectedRow: 1, grassDisabled: 0, listItems: 5 });
});

/**
 * Close Teachy TV opened with SELECT with `button`: back on the field (never through the bag), the objects frozen
 * and the controls locked while it fades in (FieldCB2_UseItemFromField), then both given back. The press is made
 * in the page, after the watch has started (registeredItems.test.ts' closeBackToField).
 */
async function closeBackToField(game: Game, button: 'B' | 'SELECT', what: string) {
  const r = await game.eval(async (t, button) => {
    let bag = false;
    let onReturn: { locked: boolean; objectsFrozen: boolean } | undefined;
    const ok = t.until(() => {
      if (t.gbaScreen() === 'CB2_BagMenuRun') bag = true;
      const f = t.field();
      if (!f || t.gbaScreen() !== undefined) return false;
      onReturn ??= { locked: f.locked, objectsFrozen: f.objectsFrozen };
      return t.idle() && !f.locked && !f.message;
    }, 20000);
    void t.press(button);
    return { ok: await ok, bag, onReturn, objectsFrozen: t.field()?.objectsFrozen };
  }, button);
  expect(r.ok, what).toBe(true);
  expect(r.bag).toBe(false);
  expect(r.onReturn).toEqual({ locked: true, objectsFrozen: true });
  expect(r.objectsFrozen).toBe(false);
}

test('SELECT with Teachy TV registered opens it from the field; SELECT and CANCEL close it back to the field', async () => {
  const game = await session.start(PALLET);
  await setUp(game, ['ITEM_TEACHY_TV'], 'ITEM_TEACHY_TV');
  await game.press('SELECT');
  await waitForList(game, 'Teachy TV from the field');
  expect(await game.eval((t) => t.teachyTv())).toMatchObject({ mode: 0, whichScript: 0, listItems: 5 });
  // SetHelpContextDontCheckBattle(HELPCONTEXT_BAG): the help system's bag topics, even from the field
  expect(await game.eval((t) => t.helpSystem().context === t.define('HELPCONTEXT_BAG'))).toBe(true);
  // SELECT closes it when it came from the field (InitTeachyTvController(0, CB2_ReturnToField)).
  await closeBackToField(game, 'SELECT', 'SELECT closed Teachy TV back to the field');
  expect(await game.eval((t) => t.audioEvents().filter((e) => e.type === 'bgm').at(-1)?.name)).toBe('MUS_PALLET');

  // Again, an option's sequence from the field, then CANCEL (B) back to the field.
  await game.press('SELECT');
  await waitForList(game, 'Teachy TV from the field again');
  await game.pressTimes('DOWN', 3);
  const seen = await runOption(game, 'I want to catch POKéMON.');
  expect(seen.texts.at(-1)).toBe('gTeachyTvText_CatchingScript2');
  await closeBackToField(game, 'B', 'CANCEL closed Teachy TV back to the field');
  const x = await game.eval((t) => t.field()!.x);
  await game.eval((t) => t.walk('left', 1));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!.x)).toBe(x - 1);
});
