// The item-use animation (pokemon_special_anim.c / pokemon_special_anim_scene.c, menus/pokemonSpecialAnim*.ts): what
// party_menu.c's CB2_DoUseItemAnim and CB2_ReturnToPartyMenuWhileLearningMove run between choosing the mon and the
// item's effect. Rare Candy (the zoom by friendship, the item's sparkle, the message, the SEs and their frames), a
// vitamin, a Potion with A held (the cancel), an evolution stone (the anim, then the evolution scene from it), a stone
// whose evolution is past the Kanto dex ("Huh?"), a TM over a forgotten move ("1, 2, and... Poof!", Machine set!), a TM
// cancelled with B, and a Potion in battle (no anim there: item_use.c's ItemUseCB_MedicineStep).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const ROUTE1 = { start: 'after-rival' as const, map: 'Route1', x: 12, y: 7 };

interface Ev {
  seq: number;
  frame: number;
  type: string;
  name: string;
}

const audioEvents = (game: Game, since: number): Promise<Ev[]> => game.eval((t, s) => t.audioEvents(s), since) as Promise<Ev[]>;
const ses = (evs: Ev[]) => evs.filter((e) => e.type === 'se');

/** START → BAG (on the ITEMS pocket, whose first item is the one to use) → A → USE → the party menu. */
async function openPartyMenuForFirstItem(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN'); // POKéMON → BAG
  await game.press('A');
  await game.waitForBag();
  await game.press('A'); // the item
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // USE
  await game.waitForPartyMenu();
}

/**
 * Start a watcher that records the anim's probe once per tick until it's over (the `itemUseAnim` end event):
 * the messages it printed, the states it went through, and the probe in the tick its message was all printed.
 */
function watchAnim(game: Game) {
  return game.watch(
    (t) => {
      const w = window as unknown as { __anim?: { messages: string[]; states: string[]; atMessageEnd?: unknown; ended?: boolean } };
      const rec = (w.__anim ??= { messages: [], states: [] });
      const p = t.itemUseAnim();
      if (p) {
        const st = `${p.task}:${p.state}`;
        if (rec.states.at(-1) !== st) rec.states.push(st);
        if (p.message && rec.messages.at(-1) !== p.message) rec.messages.push(p.message as string);
        if (!p.printing && p.message && !rec.atMessageEnd) rec.atMessageEnd = p;
      }
      if (t.events().some((e) => e.type === 'itemUseAnim' && e.phase === 'end')) {
        const out = rec;
        delete w.__anim;
        return out;
      }
      return undefined;
    },
    { what: 'the item-use anim to end', maxFrames: 30000 },
  );
}

test('Rare Candy: the mon zooms in by friendship, the candy sparkles, the message, then the party menu levels it up', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'PIDGEY', level: 10, moves: ['TACKLE'] }] });
  await game.eval((t) => {
    t.state!.bag.add(t.define('ITEM_RARE_CANDY'), 1);
    t.state!.party[0].friendship = 255; // closeness 3: three zoom steps
  });
  await openPartyMenuForFirstItem(game);
  const mark = await game.mark();
  const anim = watchAnim(game);
  // Nothing pressed until the message is out and the mon has zoomed back (state 12 waits for A or B).
  await game.press('A'); // PIDGEY
  const atPrompt = await game.watch((t) => {
    const p = t.itemUseAnim();
    return p && p.task === 'Task_UseItem_Normal' && p.state === 12 ? p : undefined;
  }, { what: 'the anim waiting for A' });
  expect(atPrompt).toMatchObject({ animType: 0, closeness: 3, lastCloseness: 0, cancelDisabled: true, message: 'RARE CANDY was used on\\nPIDGEY.' });
  const start = (await game.events(mark)).find((e) => e.type === 'itemUseAnim' && e.phase === 'start');
  expect(start).toMatchObject({ task: 'Task_UseItem_Normal', closeness: 3 });
  await game.screenshot('itemUseAnim-rareCandy');

  // The SEs: three zoom steps in (Task_ZoomAnim, 9 frames apart), the candy (20 frames on: SE_M_SWAGGER2, 31 later
  // SE_M_MILK_DRINK as it shrinks, then SE_M_REVERSAL with the first dots), the cry at closeness 3, three zoom steps out.
  const evs = await audioEvents(game, mark);
  const names = ses(evs).map((e) => e.name);
  expect(names).toEqual(['SE_SELECT', 'SE_BALL_TRAY_EXIT', 'SE_BALL_TRAY_EXIT', 'SE_BALL_TRAY_EXIT', 'SE_M_SWAGGER2', 'SE_M_MILK_DRINK', 'SE_M_REVERSAL', 'SE_BALL_TRAY_EXIT', 'SE_BALL_TRAY_EXIT', 'SE_BALL_TRAY_EXIT']);
  const frames = ses(evs).map((e) => e.frame);
  expect(frames[2] - frames[1]).toBe(9);
  expect(frames[3] - frames[2]).toBe(9);
  expect(frames[5] - frames[4]).toBe(31);
  expect(evs.some((e) => e.type === 'cry')).toBe(true);

  // A: fade out, then the party menu's ItemUseCB_RareCandyStep ("PIDGEY's level rose to 11!" and the stats).
  await game.press('A');
  const rec = await anim;
  expect(rec.messages).toEqual(['RARE CANDY was used on\\nPIDGEY.']);
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_BagMenuRun', { what: 'the bag after the level up' });
  expect((await game.eval((t) => t.party()))[0]).toMatchObject({ species: 'PIDGEY', level: 11 });
  expect(await game.eval((t) => t.itemCount('RARE_CANDY'))).toBe(0);
  await game.waitForBag();
  await game.press('B');
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
});

test('a vitamin at closeness 0: no zoom, the HP UP sparkle and message, then "PIDGEY\'s HP rose."', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'PIDGEY', level: 10, moves: ['TACKLE'] }] });
  await game.eval((t) => {
    t.state!.bag.add(t.define('ITEM_HP_UP'), 1);
    t.state!.party[0].friendship = 0;
  });
  const evBefore = await game.eval((t) => t.state!.party[0].evs.hp);
  await openPartyMenuForFirstItem(game);
  const mark = await game.mark();
  const anim = watchAnim(game);
  await game.press('A');
  const atPrompt = await game.watch((t) => {
    const p = t.itemUseAnim();
    return p && p.state === 12 ? p : undefined;
  }, { what: 'the anim waiting for A' });
  expect(atPrompt).toMatchObject({ task: 'Task_UseItem_Normal', closeness: 0, lastCloseness: 0, message: 'HP UP was used on\\nPIDGEY.' });
  expect(ses(await audioEvents(game, mark)).map((e) => e.name)).toEqual(['SE_SELECT', 'SE_M_SWAGGER2', 'SE_M_MILK_DRINK', 'SE_M_REVERSAL']);
  await game.press('B'); // A or B
  expect((await anim).messages).toEqual(['HP UP was used on\\nPIDGEY.']);
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_BagMenuRun', { what: 'the bag after "HP rose"' });
  expect(await game.eval((t) => t.state!.party[0].evs.hp)).toBe(evBefore + 10);
  expect(await game.eval((t) => t.itemCount('HP_UP'))).toBe(0);
});

test('holding A cancels the anim (Task_CleanUp): the party menu heals with the Potion as without it', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'PIDGEY', level: 10, moves: ['TACKLE'] }] });
  await game.eval((t) => {
    t.state!.bag.add(t.define('ITEM_POTION'), 1);
    t.state!.party[0].hp = 5;
  });
  await openPartyMenuForFirstItem(game);
  const mark = await game.mark();
  // Hold A from the choice until the anim has ended.
  await game.eval(async (t) => {
    t.hold('A');
    await t.until(() => t.events().some((e) => e.type === 'itemUseAnim' && e.phase === 'end'), 3000);
    t.release('A');
  });
  const end = (await game.events(mark)).find((e) => e.type === 'itemUseAnim' && e.phase === 'end');
  expect(end).toMatchObject({ cancelDisabled: false });
  expect(ses(await audioEvents(game, mark)).map((e) => e.name)).not.toContain('SE_M_SWAGGER2');
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_BagMenuRun', { what: 'the bag after the Potion' });
  const mon = await game.eval((t) => t.state!.party[0]);
  expect(mon.hp).toBe(Math.min(mon.maxHP, 25));
  expect(await game.eval((t) => t.itemCount('POTION'))).toBe(0);
});

test('a Fire Stone: the anim, then the evolution scene starts from it (no fade)', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'GROWLITHE', level: 20 }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_FIRE_STONE'), 1));
  await openPartyMenuForFirstItem(game);
  const anim = watchAnim(game);
  await game.press('A');
  await game.watch((t) => t.itemUseAnim()?.state === 12, { what: 'the anim waiting for A' });
  // A: Task_UseItem_Normal skips the fade for a stone (state 12 → 14) and CB2_UseEvolutionStone starts the scene.
  const handOver = game.watch((t) => (t.gbaScreen() !== 'CB2_PSA' ? { screen: t.gbaScreen(), fading: t.paletteFadeActive() } : undefined), { what: 'the hand-over' });
  await game.press('A');
  expect((await anim).messages).toEqual(['FIRE STONE was used on\\nGROWLITHE.']);
  expect(await handOver).toEqual({ screen: 'CB2_UseEvolutionStone', fading: false });
  const evolved = await game.waitForEvent('evolution', { timeout: 60_000 });
  expect(evolved).toMatchObject({ stopped: false });
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_BagMenuRun', { what: 'the bag after the evolution' });
  expect((await game.eval((t) => t.party()))[0]).toMatchObject({ species: 'ARCANINE' });
  expect(await game.eval((t) => t.itemCount('FIRE_STONE'))).toBe(0);
});

test('a Sun Stone on Gloom without the National Dex: "Huh?" (Task_EvoStone_CantEvolve), back to the bag with the stone', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'GLOOM', level: 25 }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_SUN_STONE'), 1));
  await openPartyMenuForFirstItem(game);
  const mark = await game.mark();
  const anim = watchAnim(game);
  await game.press('A');
  const huh = await game.watch((t) => {
    const p = t.itemUseAnim();
    return p && p.task === 'Task_EvoStone_CantEvolve' && p.state === 8 ? p : undefined;
  }, { what: '"Huh?"' });
  expect(huh).toMatchObject({ message: 'Huh?', cancelDisabled: true });
  await game.screenshot('itemUseAnim-huh');
  await game.press('A');
  expect((await anim).messages).toEqual(['Huh?']);
  // The item anim with a2 = FALSE leaves the stone's sprite; no SE_M_REVERSAL dots skipped: the same SEs as an item use.
  expect(ses(await audioEvents(game, mark)).map((e) => e.name)).toEqual(['SE_SELECT', 'SE_M_SWAGGER2', 'SE_M_MILK_DRINK', 'SE_M_REVERSAL']);
  await game.waitForBag();
  expect((await game.eval((t) => t.party()))[0]).toMatchObject({ species: 'GLOOM' });
  expect(await game.eval((t) => t.itemCount('SUN_STONE'))).toBe(1);
});

/** START → BAG → KEY ITEMS → TM CASE → OPEN → the first TM → USE → the party menu (as tmCase.test.ts). */
async function useFirstTmFromField(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN');
  await game.press('A');
  await game.waitForBag();
  await game.press('RIGHT'); // ITEMS → KEY ITEMS
  await game.eval((t) => t.waitFrames(20));
  const index = await game.eval((t) => t.state!.bag.pockets[t.define('POCKET_KEY_ITEMS') - 1].findIndex((s) => s.itemId === t.define('ITEM_TM_CASE')));
  await game.pressTimes('DOWN', index);
  await game.press('A');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // OPEN
  await game.waitFor((t) => t.tmCase()?.task === 'Task_HandleListInput' && !t.tmCase()?.fading, { what: 'the TM case list' });
  await game.press('A');
  await game.waitFor((t) => t.tmCase()?.task === 'Task_ContextMenu_HandleInput', { what: 'the USE / GIVE / EXIT menu' });
  await game.press('A'); // USE
  await game.waitForPartyMenu();
}

test('a TM over a forgotten move: "1, 2, and... Poof!", Machine set!, the wobble and zoom out, the fanfare; the move replaced', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'CHARMANDER', level: 10, moves: ['SCRATCH', 'GROWL', 'EMBER', 'LEER'] }] });
  await game.eval((t) => {
    t.state!.bag.add(t.define('ITEM_TM06'), 2);
    // the party / item quest log events count only after the Hall of Fame and once linking with R/S is allowed
    t.state!.setFlag('FLAG_SYS_GAME_CLEAR');
    t.state!.setFlag('FLAG_SYS_CAN_LINK_WITH_RS');
  });
  await useFirstTmFromField(game);
  // CHARMANDER → "...can't learn more than four moves" YES → the summary screen → A on SCRATCH.
  await game.press('A');
  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_RunPokemonSummaryScreen'), { what: 'the summary screen' });
  await game.eval((t) => t.waitFrames(30));
  const mark = await game.mark();
  const anim = watchAnim(game);
  const start = game.watch((t) => t.itemUseAnim()?.task === 'Task_ForgetMove' && t.itemUseAnim()!.state === 1 && t.itemUseAnim(), { what: 'Task_ForgetMove' });
  await game.press('A'); // SCRATCH
  expect(await start).toMatchObject({ animType: 4, lastCloseness: 3 });
  // A through the \p prompts (B would cancel Task_MachineSet).
  await game.mashUntil((t) => t.tmCase() !== undefined, { what: 'the TM case after the anim', maxFrames: 30000 });
  const rec = await anim;
  expect(rec.messages).toEqual(['1, ', '2, and … … … ', 'Poof!\\p', 'CHARMANDER forgot\\nSCRATCH.\\p', 'And…\\p', 'Machine set!\\p', 'CHARMANDER learned\\nTOXIC!']);
  expect(rec.states).toContain('Task_MachineSet:9');
  const sounds = (await audioEvents(game, mark)).filter((e) => e.type === 'se' || e.name === 'MUS_LEVEL_UP').map((e) => e.name);
  const order = ['SE_M_SPIT_UP', 'SE_SWITCH', 'SE_BALL_TRAY_EXIT', 'SE_M_MEGA_KICK', 'SE_EXP_MAX', 'MUS_LEVEL_UP'];
  let i = -1;
  for (const s of order) {
    const j = sounds.indexOf(s, i + 1);
    expect(j, `${s} after ${order[order.indexOf(s) - 1]} in ${sounds.join(' ')}`).toBeGreaterThan(i);
    i = j;
  }
  // CB2_UseTMHMAfterForgettingMove (PSA_IsCancelDisabled): the move replaced, one TM06 used, straight back to the TM case.
  expect((await game.eval((t) => t.party()))[0].moves).toEqual(['TOXIC', 'GROWL', 'EMBER', 'LEER']);
  expect(await game.eval((t) => t.itemCount('TM06'))).toBe(1);
  // ...and its quest log event (ItemUse_SetQuestLogEvent with the forgotten move), which the cancelled path leaves to
  // Task_ReplaceMoveWithTMHM.
  const used = await game.eval((t) => {
    const id = t.define('QL_EVENT_USED_ITEM');
    const scene = t.questLog().scenes.findIndex((sc: { commands: { id: number }[] }) => sc.commands.some((c) => c.id === id));
    return scene < 0 ? null : t.questLogEventLine(scene, 'QL_EVENT_USED_ITEM');
  });
  expect(used).toMatch(/SCRATCH/);
  expect(used).toMatch(/TOXIC/);
});

test('a TM the mon has room for, cancelled with B: the party menu teaches it ("CHARMANDER learned TOXIC!")', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'CHARMANDER', level: 10, moves: ['SCRATCH', 'GROWL'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_TM06'), 1));
  await useFirstTmFromField(game);
  const mark = await game.mark();
  const anim = watchAnim(game);
  await game.press('A');
  await game.watch((t) => t.itemUseAnim()?.task === 'Task_MachineSet', { what: 'Task_MachineSet' });
  await game.press('B');
  await anim;
  expect((await game.events(mark)).find((e) => e.type === 'itemUseAnim' && e.phase === 'end')).toMatchObject({ cancelDisabled: false });
  await game.mashUntil((t) => t.tmCase() !== undefined, { what: 'the TM case after the party menu' });
  expect((await game.eval((t) => t.party()))[0].moves).toEqual(['SCRATCH', 'GROWL', 'TOXIC']);
  expect(await game.eval((t) => t.itemCount('TM06'))).toBe(0);
});

test('a Potion in battle has no anim: item_use.c sets ItemUseCB_MedicineStep, not ItemUseCB_Medicine', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'PIDGEY', level: 30, moves: ['SPLASH'] }] });
  await game.eval((t) => {
    t.state!.party[0].hp = 10;
    t.state!.bag.add(t.define('ITEM_POTION'), 1);
  });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 2, moves: ['SPLASH'] }));
  await game.chooseAction('BAG');
  await game.waitForBag();
  await game.press('A'); // POTION
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // USE
  await game.waitForPartyMenu();
  const mark = await game.mark();
  await game.press('A');
  await game.mashUntil((t) => t.battle()?.controller?.startsWith('HandleInputChooseAction'), { what: 'the next turn' });
  expect(await game.eval((t) => t.state!.party[0].hp)).toBe(30);
  expect((await game.events(mark)).filter((e) => e.type === 'itemUseAnim')).toEqual([]);
});
