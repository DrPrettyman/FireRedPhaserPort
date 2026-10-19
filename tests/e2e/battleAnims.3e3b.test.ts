// Battle anims step 3, worker E3b (BATTLE_ANIMS_PLAN.md): the second half of battle_anim_effects_3.c
// (effects3b.ts) and CreateAdditionalMonSpriteForMoveAnim. One move per newly ported callback / task, plus the
// new engine paths: Acid Armor's 32-bit HBlank DMA (BGnHOFS and BGnVOFS per line) and the extra mon sprite
// Role Play and Snatch make.

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import { animEvent, expectMovesRun, reseed, ROUTE1, useFirstMove, useMoveSlot } from './battleAnimHelpers';
import { useGame, type Game } from './harness';

const session = useGame();

/** expectMovesRun with a chosen party (the first mon uses `moves`) and foe moves. */
async function expectMovesRunWith(party: MonSpec[], foeMoves: string[]): Promise<Game> {
  const moves = party[0].moves!;
  const game = await session.start({ ...ROUTE1, party });
  await game.eval((t, m) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: m }), foeMoves);
  let from = 0;
  for (const [slot, move] of moves.entries()) {
    const since = await useMoveSlot(game, from, slot);
    from = slot;
    expect(await animEvent(game, 'battleAnim', `Move_${move}`, since)).toMatchObject({ ran: true, attacker: 0 });
    await animEvent(game, 'battleAnimEnd', `Move_${move}`, since);
  }
  await game.waitForActionMenu();
  return game;
}

/** The per-line values the PPU uses for a register this frame (hblankRegs: HBlank DMA), or null. */
function hblankLines(game: Game, regOffset: number): Promise<number[] | null> {
  return game.eval(async (_t, path, reg) => {
    const hw = await new Function('p', 'return import(p)')(path);
    const lines = hw.hblankRegs.get(reg) as Uint16Array | undefined;
    return lines ? [...lines] : null;
  }, '/src/gba/hw.ts', regOffset);
}

/** Polls `fn` (in Node) until it returns something truthy. */
async function poll<T>(game: Game, fn: () => Promise<T | null | undefined | false>, what: string): Promise<T> {
  for (let i = 0; i < 600; i++) {
    const r = await fn();
    if (r) return r;
    await game.eval((t) => t.waitFrames(1));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Sprites in use whose template has `tag` as its tile tag (CreateAdditionalMonSpriteForMoveAnim uses 55125). */
function spritesWithTileTag(game: Game, tag: number): Promise<number> {
  return game.eval(async (_t, path, tg) => {
    const { gSprites } = await new Function('p', 'return import(p)')(path);
    return (gSprites as { inUse: boolean; template: { tileTag: number } }[]).filter((s) => s.inUse && s.template.tileTag === tg).length;
  }, '/src/gba/sprite.ts', tag);
}

/**
 * Plays a move or general anim straight from the action menu (attacker 0, target 1), driving the script from a
 * task like the controllers do; for anims whose real trigger is hard to set up in a test.
 */
async function launchAnim(game: Game, table: 'gBattleAnims_Moves' | 'gBattleAnims_General', id: string): Promise<number> {
  const since = await game.mark();
  await game.eval(async (_t, tbl, name) => {
    // (a bare import() in the function gets rewritten by Vitest)
    const imp = (p: string) => new Function('p', 'return import(p)')(p) as Promise<Record<string, any>>;
    const [{ LaunchBattleAnimation }, { anim }, { CreateTask, DestroyTask }, { K }] = await Promise.all([
      imp('/src/battle/anim/battleAnim.ts'),
      imp('/src/battle/anim/state.ts'),
      imp('/src/gba/task.ts'),
      imp('/src/battle/constants.ts'),
    ]);
    anim.attacker = 0;
    anim.target = 1;
    if (!LaunchBattleAnimation(tbl, K[name], tbl === 'gBattleAnims_Moves')) return;
    CreateTask((taskId: number) => {
      anim.scriptCallback();
      if (!anim.scriptActive) DestroyTask(taskId);
    }, 10);
  }, table, id);
  return since;
}

// Each newly ported callback / task, against expectMovesRun's splashing Snorlax.
test.each([
  ['BARRAGE', 'ACID_ARMOR', 'REVERSAL', 'FORESIGHT'],
  ['RETURN', 'FACADE', 'SMELLING_SALT', 'ROLE_PLAY'],
  ['YAWN', 'KNOCK_OFF', 'METEOR_MASH', 'WEATHER_BALL'],
  ['ODOR_SLEUTH', 'BLOCK', 'HOWL', 'ENDEAVOR'],
])('%s, %s, %s and %s run to the end', (...moves) => expectMovesRun(session, moves));

// Assist needs a partner's move to call; Slack Off fails at full HP (poison takes some first); Refresh needs a
// status to cure.
test('Assist, Slack Off and Refresh run to the end', () =>
  expectMovesRunWith(
    [
      { species: 'RATTATA', level: 10, status: 'POISON', moves: ['ASSIST', 'SLACK_OFF', 'REFRESH'] },
      { species: 'PIDGEY', level: 10, moves: ['TACKLE'] },
    ],
    ['SPLASH'],
  ));

// Recycle needs a used-up item: the Pecha Berry cures the poison on the first turn.
test('Recycle runs to the end', () =>
  expectMovesRunWith([{ species: 'RATTATA', level: 10, status: 'POISON', item: 'PECHA_BERRY', moves: ['ODOR_SLEUTH', 'RECYCLE'] }], ['SPLASH']));

test('Smoke Ball: fleeing plays General_SmokeballEscape', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 10, item: 'SMOKE_BALL', moves: ['TACKLE'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await game.mark();
  await game.chooseAction('RUN');
  expect(await animEvent(game, 'battleAnim', 'General_SmokeballEscape', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'General_SmokeballEscape', since);
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
});

test('Snatch: stealing the foe\'s Swords Dance plays General_SnatchMove (a copy of the attacker runs past)', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 10, moves: ['SNATCH'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SWORDS_DANCE'] }));
  // CreateAdditionalMonSpriteForMoveAnim's copy (up for ~40 ticks: watched in the page), freed again afterwards
  const copy = game.watch((t) => t.gbaSprites().some((s) => s.tileTag === 55125), { what: 'the copy of the attacker' });
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'General_SnatchMove', since)).toMatchObject({ ran: true });
  await copy;
  await animEvent(game, 'battleAnimEnd', 'General_SnatchMove', since);
  await game.waitForActionMenu();
  expect(await spritesWithTileTag(game, 55125)).toBe(0);
  const mons = (await game.eval((t) => t.battle()))!.mons;
  expect(mons.map((m) => m.spriteInvisible)).toEqual([false, false]);
});

test("Role Play: a white silhouette of the target's pic appears by the attacker and is freed after", async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'RATTATA', level: 10, moves: ['ROLE_PLAY'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_ROLE_PLAY', since)).toMatchObject({ ran: true });
  await poll(game, () => spritesWithTileTag(game, 55125), 'the silhouette');
  // The player's attacker shows the foe's back pic, filled white.
  const sil = await game.eval(async (_t, path) => {
    const sprite = await new Function('p', 'return import(p)')(path);
    const pal = await new Function('p', 'return import(p)')('/src/gba/palette.ts');
    const s = (sprite.gSprites as any[]).find((x) => x.inUse && x.template.tileTag === 55125);
    const base = pal.OBJ_PLTT_ID(s.oam.paletteNum);
    return { colors: [...pal.gPlttBufferFaded.slice(base + 1, base + 16)], x: s.x };
  }, '/src/gba/sprite.ts');
  expect(new Set(sil.colors)).toEqual(new Set([0x7fff]));
  await animEvent(game, 'battleAnimEnd', 'Move_ROLE_PLAY', since);
  await game.waitForActionMenu();
  expect(await spritesWithTileTag(game, 55125)).toBe(0);
});

test('Acid Armor: the attacker melts on a per-line BG offset table (HOFS and VOFS), cleared after', async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'RATTATA', level: 10, moves: ['ACID_ARMOR'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_ACID_ARMOR', since)).toMatchObject({ ran: true, attacker: 0 });
  // SCANLINE_EFFECT_DMACNT_32BIT on BG1HOFS or BG2HOFS: both the HOFS and the VOFS that follows it vary by line
  const [hofs, vofs] = await poll(game, async () => {
    for (const reg of [0x14, 0x18]) {
      const h = await hblankLines(game, reg);
      const v = await hblankLines(game, reg + 2);
      if (h && v && new Set(h).size > 4 && new Set(v).size > 4) return [h, v];
    }
    return null;
  }, 'the melt');
  expect(hofs.length).toBe(160);
  expect(vofs.length).toBe(160);
  await animEvent(game, 'battleAnimEnd', 'Move_ACID_ARMOR', since);
  await game.waitForActionMenu();
  for (const reg of [0x14, 0x16, 0x18, 0x1a]) expect(await hblankLines(game, reg)).toBeNull();
});

// No double battles in the test hooks (Helping Hand fails in a single battle), and Focus Band only holds on 10%
// of the time: these two are played straight from the action menu.
test('Helping Hand and General_FocusBand run to the end', async () => {
  // (knowing Helping Hand preloads its graphics)
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 10, moves: ['HELPING_HAND'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  await game.waitForActionMenu();
  await reseed(game);
  for (const [table, id, label] of [
    ['gBattleAnims_Moves', 'MOVE_HELPING_HAND', 'Move_HELPING_HAND'],
    ['gBattleAnims_General', 'B_ANIM_FOCUS_BAND', 'General_FocusBand'],
  ] as const) {
    const since = await launchAnim(game, table, id);
    expect(await animEvent(game, 'battleAnim', label, since)).toMatchObject({ ran: true, attacker: 0 });
    await animEvent(game, 'battleAnimEnd', label, since);
    const mons = (await game.eval((t) => t.battle()))!.mons;
    expect(mons.map((m) => m.spriteInvisible)).toEqual([false, false]);
  }
});
