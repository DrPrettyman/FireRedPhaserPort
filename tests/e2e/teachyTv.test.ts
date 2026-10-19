// Teachy TV (teachy_tv.c, menus/teachyTv.ts): the Viridian old man gives it after his catching tutorial; it opens
// from the bag (FieldUseFunc_TeachyTv → InitTeachyTvFromBag, back to the bag) and with SELECT
// (Task_InitTeachyTvFromField, back to the field). `__test.teachyTv()` is the probe: the mode, option, scroll/row,
// the task and its TTVcmd step, the text printed last, the Pokédude's sprite, the grass sprites. The four battle
// options run the Pokédude's battle (battle_controller_pokedude.c, battle/controllerPokedude.ts: `__test.battle()`'s
// `pokedude` is its probe, the voiceover printed last); B quits it from the battle, his bag or his party menu. The
// two field options run his scripted bag (Task_Bag_TeachyTvRegister / _TMs) and, for TMs, his TM case
// (TMCASE_POKEDUDE, `__test.tmCase()`'s `pokedudeState`), then come back to the option's closing text.

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
  /** the Pokédude's voiceovers in his battle (Pokedude_Text_*) */
  voiceovers: string[];
  transitions: number[];
  battleFlags: number[];
  outcomes: number[];
  /** the GBA screens (main callbacks) gone through */
  screens: string[];
  /** the registered item's values seen */
  registered: number[];
  /** the Pokédude's TM case: its items, and the furthest step of Task_Pokedude_Run */
  tmItems: number[];
  tmState: number;
  /** the bag's scripted tasks seen */
  bagTasks: string[];
}

/**
 * Press A from the list (choosing the option under the cursor) through the option's sequence until the list is
 * back; what it went through is recorded in the page every tick: the texts printed, the TTVcmds, the tasks, the
 * modes (2 after the demo), the most grass sprites up at once, the battle's voiceovers; then the music and the
 * battle events.
 */
async function runOption(game: Game, what: string): Promise<Seen> {
  const mark = await game.mark();
  const audioMark = await game.eval((t) => t.audioEvents().at(-1)?.seq ?? 0);
  await game.eval(() => {
    (window as any).__ttvSeen = { texts: [], cmds: [], tasks: [], modes: [], grass: 0, voiceovers: [], screens: [], registered: [], tmItems: [], tmState: -1, bagTasks: [] };
  });
  const seen = await game.mashUntil(
    (t) => {
      const r = (window as any).__ttvSeen;
      const push = (list: unknown[], v: unknown) => v !== undefined && list.at(-1) !== v && list.push(v);
      const pd = t.battle()?.pokedude;
      if (pd?.textActive) push(r.voiceovers, pd.text);
      push(r.screens, t.gbaScreen());
      push(r.registered, t.state!.registeredItem);
      for (const task of t.gbaTasks()) if (/^Task_Bag_TeachyTv/.test(task) && !r.bagTasks.includes(task)) r.bagTasks.push(task);
      const tm = t.tmCase();
      if (tm?.menuType === 4) {
        if (tm.pokedudeState >= 0 && tm.pokedudeState < 21) r.tmItems = tm.items; // (restored at 21)
        r.tmState = Math.max(r.tmState, tm.pokedudeState);
      }
      const p = t.teachyTv();
      if (p) {
        if (p.textActive) push(r.texts, p.text);
        push(r.cmds, p.cmd);
        push(r.tasks, p.task);
        push(r.modes, p.mode);
        r.grass = Math.max(r.grass, p.grass);
      }
      return r.texts.length >= 3 && p?.listReady && r;
    },
    { what, timeout: 400_000, maxFrames: 60000 },
  );
  const events = await game.events(mark);
  return {
    ...(seen as Seen),
    bgm: await game.eval((t, m) => t.audioEvents(m).filter((e) => e.type === 'bgm').map((e) => e.name), audioMark),
    transitions: events.filter((e) => e.type === 'battleTransition').map((e) => e.transition as number),
    battleFlags: events.filter((e) => e.type === 'battleStart').map((e) => e.flags as number),
    outcomes: events.filter((e) => e.type === 'battleEnd').map((e) => e.outcome as number),
  };
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

/** Each battle option's voiceovers (sPokedudeTexts_*: a header without a callback prints nothing), and its outcome. */
const DEMOS: { voiceovers: string[]; outcome: string; transition: string }[] = [
  {
    voiceovers: ['SpeedierBattlerGoesFirst', 'MyRattataFasterThanPidgey', 'BattlersTakeTurnsAttacking', 'MyRattataWonGetsEXP'],
    outcome: 'B_OUTCOME_WON',
    transition: 'B_TRANSITION_WHITE_BARS_FADE',
  },
  { voiceovers: ['UhOhRattataPoisoned', 'HealStatusRightAway', 'UsingItemTakesTurn', 'YayWeManagedToWin'], outcome: 'B_OUTCOME_WON', transition: 'B_TRANSITION_SLICE' },
  {
    voiceovers: [
      'WaterNotVeryEffectiveAgainstGrass',
      'GrassEffectiveAgainstWater',
      'LetsTryShiftingMons',
      'ShiftingUsesTurn',
      'ButterfreeDoubleResistsGrass',
      'ButterfreeGoodAgainstOddish',
      'YeahWeWon',
    ],
    outcome: 'B_OUTCOME_WON',
    transition: 'B_TRANSITION_SLICE',
  },
  {
    voiceovers: ['WeakenMonBeforeCatching', 'BestIfTargetStatused', 'CantDoubleUpOnStatus', 'LetMeThrowBall', 'PickBestKindOfBall'],
    outcome: 'B_OUTCOME_CAUGHT',
    transition: 'B_TRANSITION_SLICE',
  },
];

/** The party and the bag's slots, which the Pokédude's demos borrow (SavePlayerParty, BackUpPlayerBag) and give back. */
async function partyAndBag(game: Game) {
  return game.eval((t) => ({ party: t.party(), bag: t.state!.bag.pockets.map((p) => p.filter((s) => s.itemId).map((s) => ({ ...s }))), registered: t.state!.registeredItem }));
}

test("each option's sequence: the title, the Pokédude's hello and intro, the demo (his battle), his closing words, back to the list", async () => {
  const game = await session.start(PALLET);
  // The player's own TM and registered item, which the field demos put aside for the Pokédude's
  await setUp(game, ['ITEM_TEACHY_TV', 'ITEM_TM_CASE', 'ITEM_BICYCLE', 'ITEM_TM05'], 'ITEM_BICYCLE');
  const before = await partyAndBag(game);
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
    if (battle) {
      // The Pokédude's battle: his transition, BATTLE_TYPE_POKEDUDE, his voiceovers in order, the outcome.
      const demo = DEMOS[option];
      expect(seen.transitions, name).toEqual([await game.eval((t, n) => t.define(n), demo.transition)]);
      expect(seen.battleFlags, name).toEqual([await game.eval((t) => t.define('BATTLE_TYPE_POKEDUDE'))]);
      expect(seen.voiceovers, name).toEqual(demo.voiceovers.map((v) => `Pokedude_Text_${v}`));
      expect(seen.outcomes, name).toEqual([await game.eval((t, n) => t.define(n), demo.outcome)]);
      // the battle's music (PlayMapChosenOrBattleBGM(MUS_DUMMY): a wild battle's), then MUS_FOLLOW_ME again
      expect(seen.bgm, name).toContain('MUS_VS_WILD');
      expect(seen.bgm.indexOf('MUS_FOLLOW_ME', 1), name).toBeGreaterThan(seen.bgm.indexOf('MUS_VS_WILD'));
    } else {
      expect(seen.battleFlags, name).toEqual([]);
      // His bag (InitPokedudeBag), scripted by the option's task, back to Teachy TV; for TMs through his TM case.
      const tms = option === 4;
      expect(seen.bagTasks, name).toEqual([tms ? 'Task_Bag_TeachyTvTMs' : 'Task_Bag_TeachyTvRegister']);
      expect(seen.screens, name).toContain('CB2_BagMenuRun');
      expect(seen.screens.indexOf('TeachyTvCallback', seen.screens.indexOf('CB2_BagMenuRun')), name).toBeGreaterThan(0);
      if (tms) {
        // Pokedude_InitTMCase: TM01, TM03, TM09, TM35; Task_Pokedude_Run to its last step (21: the fade out)
        expect(seen.tmItems, name).toEqual(await game.eval((t) => ['ITEM_TM01', 'ITEM_TM03', 'ITEM_TM09', 'ITEM_TM35'].map((i) => t.define(i))));
        expect(seen.tmState, name).toBeGreaterThanOrEqual(21);
        expect(seen.registered, name).toEqual([before.registered, 0, before.registered]);
      } else {
        // REGISTER: his bag's TEACHY TV registered (none before: BackUpPlayerBag clears it), the player's back after
        expect(seen.tmState, name).toBe(-1);
        expect(seen.registered, name).toEqual([before.registered, 0, await game.eval((t) => t.define('ITEM_TEACHY_TV')), before.registered]);
      }
    }
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
  // The player's party and bag as they were (LoadPlayerParty, RestorePlayerBag).
  expect(await partyAndBag(game)).toEqual(before);
}, 900_000);

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

test("B quits the Pokédude's demo from his battle, his bag and his party menu, back to the list on the same option", async () => {
  const game = await session.start(PALLET);
  await setUp(game, ['ITEM_TEACHY_TV']);
  const before = await partyAndBag(game);
  await openFromBag(game);
  const quits: { option: number; what: string; at: (t: any) => boolean }[] = [
    // BattleMainCB2: JOY_HELD(B_BUTTON) → B_OUTCOME_DREW, CB2_QuitPokedudeBattle (here during his first voiceover)
    { option: 0, what: 'his first voiceover', at: (t) => t.battle()?.pokedude?.text === 'Pokedude_Text_SpeedierBattlerGoesFirst' },
    // Task_BButtonInterruptTeachyTv: FreeRestoreBattleData, LoadPlayerParty, CB2_ReturnToTeachyTV
    { option: 1, what: 'his bag', at: (t) => t.gbaTasks().includes('Task_Bag_TeachyTvStatus') && !t.paletteFadeActive() },
    // PartyMenuPokedudeIsCancelled → PartyMenuHandlePokedudeCancel
    { option: 2, what: 'his party menu', at: (t) => t.gbaTasks().includes('Task_PartyMenu_PokedudeStep') && !t.paletteFadeActive() },
  ];
  for (const { option, what, at } of quits) {
    if (option > 0) {
      await game.press('DOWN');
      expect(await game.eval((t, o) => t.until(() => t.teachyTv()!.scrollOffset + t.teachyTv()!.selectedRow === o, 600), option)).toBe(true);
    }
    const mark = await game.mark();
    await game.mashUntil(at, { what, timeout: 300_000, maxFrames: 40000 }); // (sent to the page as source)
    const r = await game.eval(async (t) => {
      const screens: string[] = [];
      const done = t.until(() => {
        const s = t.gbaScreen();
        if (s && screens.at(-1) !== s) screens.push(s);
        return !!t.teachyTv()?.listReady;
      }, 20000);
      void t.press('B');
      return { ok: await done, screens, list: t.teachyTv(), battle: t.battle() };
    });
    expect(r.ok, what).toBe(true);
    // SetTeachyTvControllerModeToResume: the list again (mode 1 → 0), no closing words, on the same option
    expect(r.list, what).toMatchObject({ mode: 0, whichScript: option, task: 'TeachyTvOptionListController' });
    expect(r.list!.scrollOffset + r.list!.selectedRow, what).toBe(option);
    expect(r.battle, what).toBeUndefined(); // gMain.inBattle off (FreeRestoreBattleData)
    // No battle end: the quit doesn't go through ReturnFromBattleToOverworld
    expect((await game.events(mark)).filter((e) => e.type === 'battleEnd'), what).toEqual([]);
    expect(await game.eval((t) => t.audioEvents().filter((e) => e.type === 'bgm').at(-1)?.name), what).toBe('MUS_TEACHY_TV_MENU');
    expect(await partyAndBag(game), what).toEqual(before);
  }
  // A demo runs to its end after the quits (the battle's state starts afresh).
  const seen = await runOption(game, "the matchups demo after the quits");
  expect(seen.voiceovers).toEqual(DEMOS[2].voiceovers.map((v) => `Pokedude_Text_${v}`));
  expect(await partyAndBag(game)).toEqual(before);
}, 600_000);

test("B quits the field demos from his bag and his TM case, back to the list with the player's bag as it was", async () => {
  const game = await session.start(PALLET);
  await setUp(game, ['ITEM_TEACHY_TV', 'ITEM_TM_CASE', 'ITEM_BICYCLE', 'ITEM_TM05'], 'ITEM_BICYCLE');
  const before = await partyAndBag(game);
  await openFromBag(game);
  for (let i = 0; i < 4; i++) await game.press('DOWN');
  const quits: { option: number; what: string; at: (t: any) => boolean }[] = [
    // Task_BButtonInterruptTeachyTv: RestorePlayerBag, CB2_ReturnToTeachyTV in mode 1
    { option: 4, what: 'his bag (TMs)', at: (t) => t.gbaTasks().includes('Task_Bag_TeachyTvTMs') && !t.paletteFadeActive() },
    // Task_Pokedude_Run: state 21 (his TMs and the key items given back), SetTeachyTvControllerModeToResume
    { option: 4, what: 'his TM case', at: (t) => (t.tmCase()?.pokedudeState ?? -1) >= 5 },
    // after REGISTER: RestorePlayerBag gives the player's registered item back too
    { option: 5, what: 'his bag (REGISTER)', at: (t) => t.gbaTasks().includes('Task_Bag_TeachyTvRegister') && t.state!.registeredItem === t.define('ITEM_TEACHY_TV') },
  ];
  for (const { option, what, at } of quits) {
    if (option === 5) await game.press('DOWN');
    expect(await game.eval((t, o) => t.until(() => t.teachyTv()!.scrollOffset + t.teachyTv()!.selectedRow === o, 600), option), what).toBe(true);
    await game.mashUntil(at, { what, timeout: 300_000, maxFrames: 40000 });
    await game.screenshot(`teachyTv-field-${what}`);
    const r = await game.eval(async (t) => {
      const done = t.until(() => !!t.teachyTv()?.listReady, 20000);
      void t.press('B');
      return { ok: await done, list: t.teachyTv() };
    });
    expect(r.ok, what).toBe(true);
    expect(r.list, what).toMatchObject({ mode: 0, whichScript: option, task: 'TeachyTvOptionListController' });
    expect(r.list!.scrollOffset + r.list!.selectedRow, what).toBe(option);
    expect(await game.eval((t) => t.audioEvents().filter((e) => e.type === 'bgm').at(-1)?.name), what).toBe('MUS_TEACHY_TV_MENU');
    expect(await partyAndBag(game), what).toEqual(before);
  }
}, 600_000);

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

