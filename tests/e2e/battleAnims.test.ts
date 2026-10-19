// Battle animation scripts (src/battle/anim/): ported move, general and status anims run to their end
// and the battle carries on afterwards.

import { expect, test } from 'vitest';
import { animEvent, expectMovesRun, pressSeeded, ROUTE1, useFirstMove } from './battleAnimHelpers';
import { useGame, type Game } from './harness';

const session = useGame();

test('Tackle runs its anim script to the end, then the turn carries on', async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'RATTATA', level: 30, moves: ['TACKLE'] }] });
  // Splash only: a Lv. 30 Magikarp knows Tackle too, and when it's faster its Tackle is the first one
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 30, moves: ['SPLASH'] }));
  await game.waitForActionMenu();
  // Mid-animation the hit splat exists alongside the battlers and healthboxes (watched in the page: it's up for
  // only a few ticks).
  const sprites = game.watch((t) => {
    const n = t.gbaSprites().filter((s) => s.tileTag === t.define('ANIM_TAG_IMPACT')).length;
    return n > 0 && n;
  }, { what: 'the hit splat sprite' });
  const since = await useFirstMove(game);

  const start = await animEvent(game, 'battleAnim', 'Move_TACKLE', since);
  expect(start).toMatchObject({ ran: true, attacker: 0, target: 1 });
  expect(await sprites).toBeGreaterThan(0);
  await animEvent(game, 'battleAnimEnd', 'Move_TACKLE', since);

  await game.waitForActionMenu();
  const mons = (await game.eval((t) => t.battle()))!.mons;
  expect(mons[1].hp).toBeLessThan(mons[1].maxHP);
  // Nothing of the anim is left behind.
  expect(await game.eval((t) => t.gbaSprites().filter((s) => s.tileTag === t.define('ANIM_TAG_IMPACT')).length)).toBe(0);
});

test('Growl plays, then the stat change anim lowers the target', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 30, moves: ['GROWL'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 30 }));
  const since = await useFirstMove(game);

  expect(await animEvent(game, 'battleAnim', 'Move_GROWL', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'Move_GROWL', since);
  expect(await animEvent(game, 'battleAnim', 'General_StatsChange', since)).toMatchObject({ ran: true, target: 1 });
  await animEvent(game, 'battleAnimEnd', 'General_StatsChange', since);
  await game.waitForActionMenu();
});

/** At the action menu: BAG → the POKé BALLS pocket → the first ball → throw. */
async function throwFirstBall(game: Game): Promise<number> {
  await game.chooseAction('BAG');
  const since = await game.mark();
  await game.waitForBag();
  await game.pressTimes('RIGHT', 2);
  // A (item) then A (USE); presses during the pocket slide are dropped, so keep pressing until the throw starts
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleAnim' && e.label === 'Special_BallThrow'), { what: 'the ball throw' });
  return since;
}

test('a Poké Ball the wild mon breaks out of', async () => {
  // (a Lv. 100 Mewtwo survives the wild one's counterattack)
  const game = await session.start({ ...ROUTE1, party: [{ species: 'MEWTWO', level: 100, moves: ['TAIL_WHIP'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_POKE_BALL'), 1));
  await game.eval((t) => t.startWildBattle({ species: 'MEWTWO', level: 70 })); // catch rate 3 at full HP
  // The ball lands, the target shrinks into it... (the burst is up for a few ticks: watched in the page)
  const burst = game.watch((t) => t.gbaSprites().some((s) => s.tileTag === 55000) && t.battle()!.mons[1].hp > 0 && t.gbaSprites().filter((s) => s.tileTag >= 55020 && s.tileTag < 55032).length > 0, { what: 'the ball open burst' });
  const since = await throwFirstBall(game);

  expect(await animEvent(game, 'battleAnim', 'Special_BallThrow', since)).toMatchObject({ ran: true, target: 1 });
  await burst;
  await animEvent(game, 'battleAnimEnd', 'Special_BallThrow', since);
  // ...and breaks out: it's back, the ball gone, and the battle goes on.
  await game.waitForActionMenu();
  const sprites = await game.eval((t) => t.gbaSprites());
  expect(sprites.some((s) => s.tileTag === 55000)).toBe(false);
  expect(await game.eval((t) => t.battle()!.outcome)).toBe(0);
});

test('a Master Ball shakes three times and clicks', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 5, moves: ['TAIL_WHIP'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_MASTER_BALL'), 1));
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2 }));
  const since = await throwFirstBall(game);

  expect(await animEvent(game, 'battleAnim', 'Special_BallThrow', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'Special_BallThrow', since);
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { answers: [[/nickname/i, 'B']], what: 'the battle to end' });
  expect(await game.eval((t) => t.lastOutcome())).toBe('B_OUTCOME_CAUGHT');
});

test('switching out plays the ball effect and shrinks the mon', async () => {
  const game = await session.start({
    ...ROUTE1,
    party: [
      { species: 'RATTATA', level: 30, moves: ['TAIL_WHIP'] },
      { species: 'PIDGEY', level: 30, moves: ['GUST'] },
    ],
  });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 30 }));
  await game.chooseAction('POKEMON');
  const since = await game.mark();
  await game.waitForPartyMenu();
  await game.press('DOWN');
  await game.press('A'); // PIDGEY
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // SHIFT

  expect(await animEvent(game, 'battleAnim', 'Special_SwitchOutPlayerMon', since)).toMatchObject({ ran: true, attacker: 0 });
  await animEvent(game, 'battleAnimEnd', 'Special_SwitchOutPlayerMon', since);
  await game.waitForActionMenu();
  expect((await game.eval((t) => t.battle()))!.mons[0].species).toBe('PIDGEY');
});

test('levelling up flashes the healthbox', async () => {
  // A Lv. 2 Rattata (8 exp) beating a Lv. 10 Magikarp (28 exp) reaches Lv. 3 (27).
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 2, moves: ['TACKLE'], iv: 31 }] });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 10 }));
  const since = await game.mark();
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  expect(await animEvent(game, 'battleAnim', 'Special_LevelUp', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'Special_LevelUp', since);
  expect((await game.eval((t) => t.party()))[0].level).toBe(3);
});

test('a substitute swaps back to the mon to attack, then back to the doll', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 30, moves: ['TACKLE', 'SUBSTITUTE'] }] });
  // A Lv. 12 Magikarp only knows Splash, so nothing breaks the substitute (Flail at Lv. 30 can)
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 12 }));
  // Turn 1: SUBSTITUTE (move 2, right of move 1)
  await game.waitForActionMenu();
  let since = await game.mark();
  await game.press('A');
  await game.eval((t) => t.waitFrames(10));
  await game.press('RIGHT');
  await game.press('A');
  expect(await animEvent(game, 'battleAnim', 'Move_SUBSTITUTE', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'Move_SUBSTITUTE', since);
  // Turn 2: TACKLE from behind the substitute
  await game.waitForActionMenu();
  since = await game.mark();
  await game.press('A');
  await game.eval((t) => t.waitFrames(10));
  await game.press('LEFT');
  await pressSeeded(game, 'A');
  expect(await animEvent(game, 'battleAnim', 'Special_SubstituteToMon', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'Move_TACKLE', since);
  expect(await animEvent(game, 'battleAnim', 'Special_MonToSubstitute', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'Special_MonToSubstitute', since);
});

test("the old man's catching tutorial: his throw and the catch", async () => {
  // The coord trigger at (22, 8) starts the tutorial once Oak's parcel has set the scene var to 1.
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity', x: 22, y: 9 });
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_VIRIDIAN_CITY_OLD_MAN', 1));
  const since = await game.mark();
  // The Poké Ball leaves his hand (AnimTask_ThrowBallSpecial waits for his throw frame).
  const ball = game.watch((t) => t.gbaSprites().some((s) => s.tileTag === 55000 && !s.invisible), { what: 'the ball in flight' });
  await game.walk('up');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleAnim' && e.label === 'Special_BallThrowWithTrainer'), { what: 'the old man’s throw' });
  expect(await animEvent(game, 'battleAnim', 'Special_BallThrowWithTrainer', since)).toMatchObject({ ran: true });
  await ball;
  // The ball click clears gDoingBattleAnim at frame 95 of 315, so (as on the GBA) the battle can end
  // before the anim script does.
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the tutorial battle to end' });
  expect(await game.eval((t) => t.lastOutcome())).toBe('B_OUTCOME_CAUGHT');
});

test('a trainer blocks the ball', async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianForest', x: 41, y: 45, party: [{ species: 'MEWTWO', level: 100, moves: ['TAIL_WHIP'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_POKE_BALL'), 1));
  await game.walk('right'); // into Bug Catcher Rick's view
  await game.mashUntil((t) => t.battle()?.controller?.startsWith('HandleInputChooseAction'), { what: 'Rick’s battle' });
  const since = await throwFirstBall(game);
  await animEvent(game, 'battleAnimEnd', 'Special_BallThrow', since);
  // TrainerBallBlock knocks the ball off-screen; the battle goes on and nothing was caught.
  await game.waitForActionMenu();
  expect(await game.eval((t) => t.battle()!.outcome)).toBe(0);
  expect(await game.eval((t) => t.gbaSprites().some((s) => s.tileTag === 55000))).toBe(false);
});

test('a ghost dodges the ball', async () => {
  // Pokémon Tower without the Silph Scope: the wild mon is an unidentified GHOST.
  const game = await session.start({ start: 'after-rival', map: 'PokemonTower_3F', x: 4, y: 10, party: [{ species: 'MEWTWO', level: 100, moves: ['TAIL_WHIP'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_POKE_BALL'), 1));
  await game.eval((t) => t.startWildBattle({ species: 'GASTLY', level: 15 }));
  const since = await throwFirstBall(game);
  await animEvent(game, 'battleAnimEnd', 'Special_BallThrow', since);
  await game.waitForActionMenu();
  expect(await game.eval((t) => t.battle()!.typeFlags & t.define('BATTLE_TYPE_GHOST'))).toBeTruthy();
  expect(await game.eval((t) => t.battle()!.outcome)).toBe(0);
});

test("a shiny's sparkles", async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'MEWTWO', level: 100, moves: ['TAIL_WHIP'] }] });
  // (the sparkles are up for a few ticks: watched in the page from before the battle starts)
  const stars = game.watch((t) => {
    const tag = t.define('ANIM_TAG_GOLD_STARS');
    const n = t.gbaSprites().filter((s) => s.tileTag === tag).length;
    return n > 0 && n;
  }, { what: 'the shiny sparkles' });
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 5, shiny: true }));
  expect(await stars).toBeGreaterThan(0);
  await game.waitForActionMenu();
  expect(await game.eval((t) => t.gbaSprites().filter((s) => s.tileTag === t.define('ANIM_TAG_GOLD_STARS')).length)).toBe(0);
});

test('Safari Zone: throwing bait and a rock', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SafariZone_Center', x: 26, y: 29 });
  await game.eval((t) => {
    t.state!.setFlag('FLAG_SYS_SAFARI_MODE');
    t.state!.numSafariBalls = 30;
  });
  // The Safari menu is laid out like the action menu: BALL, BAIT / ROCK, RUN. A wild mon may flee after
  // any turn, so each throw gets its own battle.
  await game.eval((t) => t.startWildBattle({ species: 'RHYHORN', level: 25 }));
  let since = await game.mark();
  // The bait flies from the player's throw at the wild mon (for a few ticks: watched in the page).
  const bait = game.watch((t) => t.gbaSprites().some((s) => s.tileTag === t.define('ANIM_TAG_SAFARI_BAIT')), { what: 'the bait in flight' });
  await game.chooseAction('BAG'); // BAIT
  // (the event's attacker/target are the launch's; AnimTask_SafariOrGhost_DecideAnimSides then sets them)
  expect(await animEvent(game, 'battleAnim', 'General_BaitThrow', since)).toMatchObject({ ran: true });
  await bait;
  await animEvent(game, 'battleAnimEnd', 'General_BaitThrow', since);
  await game.mashUntil((t) => t.idle() || t.battle()?.controller?.startsWith('HandleInputChooseAction'), { what: 'the next turn or the field' });
  if (await game.eval((t) => !t.battle())) {
    await game.eval((t) => t.startWildBattle({ species: 'RHYHORN', level: 25 }));
  }
  since = await game.mark();
  await game.chooseAction('POKEMON'); // ROCK
  expect(await animEvent(game, 'battleAnim', 'General_SafariRockThrow', since)).toMatchObject({ ran: true });
  await animEvent(game, 'battleAnimEnd', 'General_SafariRockThrow', since);
});

test("a poisoned mon's status anim runs at the end of the turn", async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'RATTATA', level: 30, moves: ['TAIL_WHIP'], status: 'POISON' }] });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 30 }));
  const since = await useFirstMove(game);

  expect(await animEvent(game, 'battleAnim', 'Move_TAIL_WHIP', since)).toMatchObject({ ran: true });
  expect(await animEvent(game, 'battleAnim', 'Status_Poison', since)).toMatchObject({ ran: true, attacker: 0 });
  await animEvent(game, 'battleAnimEnd', 'Status_Poison', since);
  await game.waitForActionMenu();
  const mons = (await game.eval((t) => t.battle()))!.mons;
  expect(mons[0].hp).toBeLessThan(mons[0].maxHP);
});

// Battle anims step 1 (BATTLE_ANIMS_PLAN.md): one move per newly ported sprite callback / task, four to a
// battle against a Snorlax that only splashes (and has the HP to take it).
test.each([
  ['CONFUSION', 'ROCK_SLIDE', 'PIN_MISSILE', 'RAIN_DANCE'],
  ['CONSTRICT', 'HEADBUTT', 'FIRE_SPIN', 'MIST'],
  ['CUT', 'ROLLING_KICK', 'BONE_CLUB', 'WING_ATTACK'],
  ['SUNNY_DAY', 'RAGE', 'FOCUS_ENERGY', 'METAL_CLAW'],
  ['HORN_ATTACK', 'JUMP_KICK', 'COMET_PUNCH', 'BARRIER'],
])('%s, %s, %s and %s run to the end', (...moves) => expectMovesRun(session, moves));

test('Transform mosaics the attacker into a copy of the target', async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'DITTO', level: 30, moves: ['TRANSFORM'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 30, moves: ['SPLASH'] }));
  await game.waitForActionMenu();
  // AnimTask_TransformMon mosaics the mon's BG copy (monbg) up to 16x16 blocks, swaps the pic, and back down.
  const mosaic = game.watch((t) => t.gpuReg(0x4c) === 0xff, { what: 'the full mosaic' });
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_TRANSFORM', since)).toMatchObject({ ran: true, attacker: 0, target: 1 });
  await mosaic;
  await animEvent(game, 'battleAnimEnd', 'Move_TRANSFORM', since);
  await game.waitForActionMenu();
  const ditto = (await game.eval((t) => t.battle()))!.mons[0];
  expect(ditto).toMatchObject({ species: 'MAGIKARP', transformSpecies: 'MAGIKARP', spriteInvisible: false });
  expect(await game.eval((t) => t.gpuReg(0x4c))).toBe(0);
});

test('the Silph Scope unveils the ghost Marowak', async () => {
  // Pokémon Tower 6F: the step below is PokemonTower_6F_EventScript_MarowakGhost's trigger.
  const game = await session.start({ start: 'after-rival', map: 'PokemonTower_6F', x: 11, y: 14, party: [{ species: 'MEWTWO', level: 100, moves: ['TAIL_WHIP'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_SILPH_SCOPE'), 1));
  const since = await game.mark();
  await game.walk('down');
  // "Begone… Intruders…", then special StartMarowakBattle
  const start = await game.mashUntil((t) => t.events().find((e) => e.type === 'battleStart'), { what: 'the Marowak battle' });
  expect(start.flags).toBe(await game.eval((t) => t.define('BATTLE_TYPE_GHOST') | t.define('BATTLE_TYPE_GHOST_UNVEILED')));
  // past "The GHOST appeared!" and "SILPH SCOPE unveiled the GHOST's identity!"; the name is read in the tick
  // after the anim starts (AnimTask_TransformMon renames it ~50 ticks in, which a read from here can come after).
  const nickname = await game.mashUntil((t) => t.events().some((e) => e.type === 'battleAnim' && e.label === 'General_SilphScoped') && t.battle()!.mons[1].nickname, { what: 'the unveiling' });
  expect(await animEvent(game, 'battleAnim', 'General_SilphScoped', since)).toMatchObject({ ran: true, attacker: 1 });
  expect(nickname).toBe('GHOST');
  await animEvent(game, 'battleAnimEnd', 'General_SilphScoped', since);
  // HandleSpeciesGfxDataChange(…, 255) loaded the real pic and renamed it after its species.
  await game.waitForActionMenu();
  expect((await game.eval((t) => t.battle()))!.mons[1]).toMatchObject({ species: 'MAROWAK', nickname: 'MAROWAK', level: 30, spriteInvisible: false });
});

test("Surf's wave blends in a band at a time and clears up after", async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'LAPRAS', level: 30, moves: ['SURF'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 100, moves: ['SPLASH'] }));
  await game.waitForActionMenu();
  // BG1 (the wave) blends over everything else
  const blend = game.watch((t) => t.gpuReg(0x50) === 0x3f42, { what: 'the wave blend' });
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_SURF', since)).toMatchObject({ ran: true });
  await blend;
  await animEvent(game, 'battleAnimEnd', 'Move_SURF', since);
  await game.waitForActionMenu();
  expect(await game.eval((t) => [t.gpuReg(0x50), t.gpuReg(0x52)])).toEqual([0, 0]);
});

test('Reflect: the foe moves to an anim BG under the wall and comes back', async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'MEWTWO', level: 30, moves: ['REFLECT'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'MAGIKARP', level: 30, moves: ['SPLASH'] }));
  await game.waitForActionMenu();
  // (watched in the page: the foe is on the BG only while the wall is up)
  const onBg = game.watch((t) => t.battle()?.mons[1].spriteInvisible, { what: 'the foe drawn on a BG' });
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_REFLECT', since)).toMatchObject({ ran: true });
  await onBg;
  await animEvent(game, 'battleAnimEnd', 'Move_REFLECT', since);
  await game.waitForActionMenu();
  expect((await game.eval((t) => t.battle()))!.mons[1].spriteInvisible).toBe(false);
});

// AnimTask_BlendBattleAnimPal(F_PAL_BG) blends BG palettes 1-3 only (GetBattlePalettesMask: 0xE). The healthboxes
// are sprites in their own OBJ palette (TAG_HEALTHBOX_PAL), so they keep their colours, shadow included: the
// shadow's 1-px edge (healthbox palette colour 5) stays lit next to the dimmed BG and shows as faint diagonal lines
// at the healthbox corners. That's how the GBA draws it too (docs/DEV_NOTES.md, battle anims).
test('Thunder Shock dims BG palettes 1-3 and leaves the healthboxes as they are', async () => {
  const game = await session.start({ ...ROUTE1, speed: 1, party: [{ species: 'PIKACHU', level: 30, moves: ['THUNDER_SHOCK'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'SNORLAX', level: 30, moves: ['SPLASH'] }));
  await game.waitForActionMenu();
  // (the palettes as the action menu shows them, to compare against)
  await game.eval(async () => {
    const w = window as unknown as Record<string, unknown>;
    w.__pal = await new Function("return import('/src/gba/palette.ts')")();
    w.__spr = await new Function("return import('/src/gba/sprite.ts')")();
    w.__before = (w.__pal as { gPlttBufferFaded: Uint16Array }).gPlttBufferFaded.slice();
  });
  const dimmed = game.watch((t) => {
    const w = window as unknown as Record<string, any>;
    const faded = w.__pal.gPlttBufferFaded;
    const changed = (pal: number) => [...Array(16).keys()].some((i) => faded[pal * 16 + i] !== w.__before[pal * 16 + i]);
    if (!changed(2)) return null;
    const hb = 16 + w.__spr.IndexOfSpritePaletteTag(t.define('TAG_HEALTHBOX_PAL'));
    // BG palettes 0-1 are the textbox's and the menu windows', 2-4 the terrain's (battle_bg.c); 5 is left out:
    // picking the move changes it too
    return { bg: [0, 1, 2, 3, 4].filter(changed), healthbox: changed(hb) };
  }, { what: 'the BG dimmed' });
  const since = await useFirstMove(game);
  expect(await animEvent(game, 'battleAnim', 'Move_THUNDER_SHOCK', since)).toMatchObject({ ran: true });
  const d = await dimmed;
  expect(d.bg).toEqual([1, 2, 3]);
  expect(d.healthbox).toBe(false);
  await animEvent(game, 'battleAnimEnd', 'Move_THUNDER_SHOCK', since);
});
