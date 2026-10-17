// Field moves (field_effect.c's script table, party_menu.c's CursorCB_FieldMove, fldeff_*.c): Cut from a
// tree's script and from the party menu, cutting grass, Rock Smash with and without an encounter, Sweet
// Scent, Dig and Teleport warping out, Soft-Boiled in the party menu, and an HM without its badge.
// The party menu is a GBA screen with no message probe: its steps are timed button presses.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

async function repel(game: Game) {
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 200));
}

/** START → POKéMON → party slot `mon` → its action menu's entry `action` (SUMMARY, then the field moves) → A. */
async function useFieldMove(game: Game, action = 1, mon = 0) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A'); // POKéMON (the start menu's cursor starts on it)
  await game.waitForPartyMenu();
  for (let i = 0; i < mon; i++) {
    await game.press('DOWN');
    await game.eval((t) => t.waitFrames(4));
  }
  await game.press('A'); // the mon's action menu
  await game.eval((t) => t.waitFrames(10));
  for (let i = 0; i < action; i++) {
    await game.press('DOWN');
    await game.eval((t) => t.waitFrames(4));
  }
  await game.press('A');
}

/** The current map's object at map-local (x, y). */
async function objectAt(game: Game, x: number, y: number) {
  return game.eval((t, x, y) => t.objects().find((o) => o.x === x && o.y === y), x, y);
}

/** Wait for the field to be back and free (no menu, script, banner or warp). */
async function waitFieldFree(game: Game, what: string) {
  // (the field move effects; FLDEFF_TALL_GRASS and the like come and go with the field)
  await game.waitFor(
    (t) => t.gbaScreen() === undefined && t.idle() && !t.field()!.script && !t.field()!.fieldEffects.some((e) => /^FLDEFF_(FIELD_MOVE_SHOW_MON|USE_|CUT_GRASS|SWEET_SCENT)/.test(e)),
    { what },
  );
}

const FARFETCHD = { species: 'FARFETCHD', level: 30, moves: ['CUT', 'PECK'] };

test('Cut: talking to a cut tree with the badge and a mon that knows CUT cuts it down', async () => {
  // Vermilion City's tree by the gym (19, 24): EventScript_CutTree → dofieldeffect FLDEFF_USE_CUT_ON_TREE
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 19, y: 25, party: [FARFETCHD] });
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE02_GET', true));
  await game.eval((t) => t.face('up'));
  expect((await objectAt(game, 19, 24))?.graphicsId).toBe('OBJ_EVENT_GFX_CUT_TREE');
  const since = await game.mark();
  await game.press('A');
  // "This tree looks like it can be CUT down! Would you like to CUT it?" → YES, "FARFETCH'D used CUT!"
  // The player holds the field move pose until the banner is over: read it in the tick the banner starts (a read
  // from node after the mash can land after the banner under load).
  const pose = await game.mashUntil((t) => t.events().some((e) => e.type === 'fieldMoveShowMon') && t.field()!.avatar.graphicsId, { what: 'the show-mon banner' });
  const banner = await game.waitForEvent('fieldMoveShowMon', { since });
  expect(banner).toMatchObject({ species: await game.eval((t) => t.define('SPECIES_FARFETCHD')), outdoors: true });
  expect(pose).toBe('OBJ_EVENT_GFX_RED_FIELD_MOVE');
  await waitFieldFree(game, 'the tree to be cut');
  expect(await objectAt(game, 19, 24)).toBeUndefined();
  expect(await game.eval((t) => t.flag('FLAG_TEMP_12'))).toBe(true);
  expect(await game.eval((t) => t.field()!.avatar.graphicsId)).toBe('OBJ_EVENT_GFX_RED_NORMAL');
  // The way is open: the player can walk where the tree was.
  await game.eval((t) => t.walk('up', 1));
  expect(await game.eval((t) => t.field()!)).toMatchObject({ x: 19, y: 24 });
});

test('Cut from the party menu cuts the tree in front (FieldCallback_CutTree → EventScript_FldEffCut)', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 19, y: 25, party: [FARFETCHD] });
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE02_GET', true));
  await game.eval((t) => t.face('up'));
  const since = await game.mark();
  await useFieldMove(game); // CUT
  await game.waitForEvent('fieldMoveShowMon', { since });
  const script = await game.waitForEvent('script', { since });
  expect(script.label).toBe('EventScript_FldEffCut');
  await waitFieldFree(game, 'the tree to be cut');
  expect(await objectAt(game, 19, 24)).toBeUndefined();
});

test('Cut on grass mows the tall grass around the player (FldEff_CutGrass)', async () => {
  // Route 1's tall grass: (14, 8) is in the middle of a field of METATILE_General_Plain_Grass.
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 14, y: 8, party: [FARFETCHD] });
  await repel(game);
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE02_GET', true));
  const metatiles = (game: Game) =>
    game.eval((t) => {
      const s = (window as any).game.scene.getScene('Overworld');
      const f = t.field()!;
      const out: number[] = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) out.push(s.world.tileAt(f.worldX + dx, f.worldY + dy).metatile);
      return out;
    });
  const grass = await game.eval((t) => t.define('METATILE_General_Plain_Grass'));
  const mowed = await game.eval((t) => t.define('METATILE_General_Plain_Mowed'));
  expect(await metatiles(game)).toEqual(Array(25).fill(grass));
  const since = await game.mark();
  await useFieldMove(game);
  await game.waitForEvent('cutGrass', { since });
  await waitFieldFree(game, 'the cut grass effect to end');
  // The 3x3 square around the player is mowed, the ring outside it isn't.
  const after = await metatiles(game);
  for (let i = 0; i < 25; i++) {
    const inner = Math.abs((i % 5) - 2) <= 1 && Math.abs(Math.floor(i / 5) - 2) <= 1;
    expect(after[i]).toBe(inner ? mowed : grass);
  }
  // The controls are back.
  await game.eval((t) => t.walk('left', 1));
  expect(await game.eval((t) => t.field()!.x)).toBe(13);
});

test('Rock Smash: talking to a rock breaks it; no wild Pokémon when the dice say no', async () => {
  // Mt. Ember's exterior (rock smash rate 50): the rock at (29, 41), from below. EventScript_RockSmash
  const game = await session.start({ start: 'after-rival', map: 'MtEmber_Exterior', x: 29, y: 42, party: [{ species: 'MACHAMP', level: 50, moves: ['ROCK_SMASH'] }] });
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE06_GET', true));
  await game.eval((t) => t.face('up'));
  expect((await objectAt(game, 29, 41))?.graphicsId).toBe('OBJ_EVENT_GFX_ROCK_SMASH_ROCK');
  // WildEncounterRandom's next value is 16838 from this seed: 838 % 1600 isn't under 800, no encounter.
  await game.eval(() => (window as any).game.scene.getScene('Overworld').wild.seed(1));
  const since = await game.mark();
  await game.press('A');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'fieldMoveShowMon'), { what: 'the show-mon banner' });
  await waitFieldFree(game, 'the rock to break');
  expect(await objectAt(game, 29, 41)).toBeUndefined();
  expect(await game.eval((t) => t.var('VAR_RESULT'))).toBe(0);
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'battleStart')).toBe(false);
});

test('Rock Smash from the party menu can find a wild Pokémon (RockSmashWildEncounter)', async () => {
  // Mt. Ember's exterior (rock smash rate 50): the rock at (29, 41), from below.
  const game = await session.start({ start: 'after-rival', map: 'MtEmber_Exterior', x: 29, y: 42, party: [{ species: 'MACHAMP', level: 100, moves: ['ROCK_SMASH'] }] });
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE06_GET', true));
  await game.eval((t) => t.face('up'));
  expect((await objectAt(game, 29, 41))?.graphicsId).toBe('OBJ_EVENT_GFX_ROCK_SMASH_ROCK');
  // WildEncounterRandom's next value is 0 from this seed, so DoWildEncounterRateTest passes.
  await game.eval(() => (window as any).game.scene.getScene('Overworld').wild.seed(0));
  const since = await game.mark();
  await useFieldMove(game); // ROCK SMASH
  const script = await game.waitForEvent('script', { since });
  expect(script.label).toBe('EventScript_FldEffRockSmash');
  await game.waitForEvent('battleStart', { since });
  expect(await objectAt(game, 29, 41)).toBeUndefined();
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  await waitFieldFree(game, 'back on the field');
  expect(await game.eval((t) => t.field()!.map)).toBe('MtEmber_Exterior');
});

test('Sweet Scent in tall grass starts a wild battle; elsewhere there is nothing', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 14, y: 8, party: [{ species: 'ODDISH', level: 100, moves: ['ABSORB', 'SWEET_SCENT'] }] });
  await repel(game); // Sweet Scent ignores the repel (TryGenerateWildMon without WILD_CHECK_REPEL)
  let since = await game.mark();
  await useFieldMove(game); // SWEET SCENT (no badge needed)
  await game.waitForEvent('sweetScent', { since });
  await game.waitForEvent('battleStart', { since });
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  await waitFieldFree(game, 'back on the field');

  // On the path (no encounter tile): EventScript_FailSweetScent, "Looks like there's nothing here…"
  await game.eval((t) => t.walkTo(9, 13));
  await game.waitIdle();
  since = await game.mark();
  await useFieldMove(game);
  await game.waitForEvent('sweetScent', { since });
  const script = await game.waitForEvent('script', { since });
  expect(script.label).toBe('EventScript_FailSweetScent');
  await game.waitFor((t) => t.message()?.includes('nothing here'), { what: 'the fail message' });
  await game.mashUntil((t) => t.idle(), { what: 'the message to close' });
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'battleStart')).toBe(false);
});

test('Dig in a cave takes the player back to where they came in (the escape warp)', async () => {
  // Route 4's Mt. Moon entrance (19, 5): walking in from (19, 6) sets the escape warp to (19, 6).
  const game = await session.start({ start: 'after-rival', map: 'Route4', x: 19, y: 6, party: [{ species: 'DIGLETT', level: 30, moves: ['DIG'] }] });
  await repel(game);
  await game.eval((t) => t.walk('up', 1));
  await game.waitFor((t) => t.field()?.map === 'MtMoon_1F' && t.idle(), { what: 'Mt. Moon' });
  expect(await game.eval((t) => t.state!.escapeWarp)).toEqual({ mapId: 'MAP_ROUTE4', warpId: -1, x: 19, y: 6 });
  await repel(game);
  const since = await game.mark();
  await useFieldMove(game); // DIG
  // "Want to escape from here and return to ROUTE 4?" → YES
  await game.mashUntil((t) => t.gbaScreen() === undefined, { what: 'YES and the party menu closing' });
  await game.waitForEvent('fieldMoveShowMon', { since });
  const warp = await game.waitForEvent('fieldMoveWarp', { since });
  expect(warp.map).toBe('MAP_ROUTE4');
  await game.waitForEvent('fieldMoveWarpDone', { since });
  await waitFieldFree(game, 'the warp in');
  expect(await game.eval((t) => t.field()!)).toMatchObject({ map: 'Route4', x: 19, y: 6, playerVisible: true });
});

test('Teleport takes the player back to the last heal location', async () => {
  // after-rival's last heal location is Pallet Town (HEAL_LOCATION_PALLET_TOWN).
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 9, y: 13, party: [{ species: 'ABRA', level: 20, moves: ['TELEPORT'] }] });
  await repel(game);
  const heal = await game.eval((t) => t.state!.lastHealLocation!);
  const since = await game.mark();
  await useFieldMove(game); // TELEPORT
  // "Want to return to the healing spot used last in PALLET TOWN?" → YES
  await game.mashUntil((t) => t.gbaScreen() === undefined, { what: 'YES and the party menu closing' });
  await game.waitForEvent('fieldMoveShowMon', { since });
  await game.waitForEvent('fieldMoveWarpDone', { since });
  await waitFieldFree(game, 'the teleport in');
  expect(await game.eval((t) => t.field()!)).toMatchObject({ map: 'PalletTown', x: heal.x, y: heal.y, playerVisible: true });
});

test('Teleport and Dig can\'t be used where they don\'t work', async () => {
  // Teleport indoors (Overworld_MapTypeAllowsTeleportAndFly) and Dig outdoors (no allowEscaping): the menu stays.
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 9, y: 13, party: [{ species: 'DIGLETT', level: 30, moves: ['DIG'] }] });
  await repel(game);
  const since = await game.mark();
  await useFieldMove(game);
  await game.eval((t) => t.waitFrames(60));
  expect(await game.eval((t) => t.gbaScreen())).toBe('CB2_UpdatePartyMenu');
  await game.press('A'); // Task_CancelAfterAorBPress
  await game.eval((t) => t.waitFrames(10));
  await game.mashUntil((t) => t.gbaScreen() === undefined && t.idle(), { button: 'B', what: 'back on the field' });
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'fieldMoveShowMon')).toBe(false);
});

test('Soft-Boiled gives a fifth of the user\'s max HP to another party mon', async () => {
  const game = await session.start({
    start: 'after-rival',
    map: 'PalletTown',
    x: 12,
    y: 14,
    party: [
      { species: 'CHANSEY', level: 50, moves: ['SOFT_BOILED'] },
      { species: 'PIDGEY', level: 50, moves: ['TACKLE'] },
    ],
  });
  await game.eval((t) => (t.state!.party[1].hp = 10));
  const [chansey, pidgey] = await game.eval((t) => t.party());
  const amount = Math.floor(chansey.maxHP / 5);
  await useFieldMove(game); // SOFT-BOILED
  await game.eval((t) => t.waitFrames(20)); // "Use on which POKéMON?"
  await game.press('DOWN');
  await game.eval((t) => t.waitFrames(6));
  await game.press('A');
  await game.waitFor((t) => t.party()[1].hp === Math.min(10 + Math.floor(t.party()[0].maxHP / 5), t.party()[1].maxHP), { what: 'the HP to move over' });
  const after = await game.eval((t) => t.party());
  expect(after[0].hp).toBe(chansey.hp - amount);
  expect(after[1].hp).toBe(Math.min(10 + amount, pidgey.maxHP));
  await game.mashUntil((t) => t.gbaScreen() === undefined && t.idle(), { button: 'B', what: 'back on the field' });
});

test('An HM without its badge is refused: "This can\'t be used until a new BADGE is obtained."', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 19, y: 25, party: [FARFETCHD] });
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE02_GET', false));
  await game.eval((t) => t.face('up'));
  const since = await game.mark();
  await useFieldMove(game); // CUT
  await game.eval((t) => t.waitFrames(60));
  expect(await game.eval((t) => t.gbaScreen())).toBe('CB2_UpdatePartyMenu');
  await game.mashUntil((t) => t.gbaScreen() === undefined && t.idle(), { button: 'B', what: 'back on the field' });
  expect((await game.eval((t, since) => t.events(since), since)).some((e) => e.type === 'fieldMoveShowMon')).toBe(false);
  expect((await objectAt(game, 19, 24))?.graphicsId).toBe('OBJ_EVENT_GFX_CUT_TREE');
});

test('Flash from the party menu lights Rock Tunnel (FieldCallback_Flash → FldEff_UseFlash)', async () => {
  // Route 10's northern Rock Tunnel entrance at (8, 19); FIELD_MOVE_FLASH needs the Boulder Badge.
  const game = await session.start({ start: 'after-rival', map: 'Route10', x: 8, y: 20, party: [{ species: 'PIKACHU', level: 30, moves: ['FLASH', 'THUNDER_SHOCK'] }] });
  await game.eval((t) => t.state!.setFlag('FLAG_BADGE01_GET', true));
  await repel(game);
  const mark = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since: mark, what: 'Rock Tunnel' });
  await game.waitIdle();
  expect((await game.eval((t) => t.field()!.flash)).level).toBe(4);
  const since = await game.mark();
  await useFieldMove(game); // FLASH
  expect(await game.waitForEvent('fieldMoveShowMon', { since })).toMatchObject({ outdoors: false });
  expect((await game.waitForEvent('script', { since })).label).toBe('EventScript_FldEffFlash');
  await waitFieldFree(game, 'Flash to light the cave');
  expect(await game.eval((t) => t.flag('FLAG_SYS_FLASH_ACTIVE'))).toBe(true);
  expect(await game.eval((t) => t.field()!.flash)).toEqual({ level: 0, dark: 0 });
});
