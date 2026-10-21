// The quest log's menu-side calls (QUEST_LOG_PLAN.md QL4b), each driven as a player would and played back to its
// line on CONTINUE: a Poké Mart session's purchases and sales (shop.c's RecordItemTransaction from the buy menu and
// the SELL paths of the bag, the TM case and the berry pouch; RecordTransactionForQuestLog on SEE YA!), the
// Pokémon Center nurse (SetUsedPkmnCenterQuestLogEvent), a story item from a script's `giveitem` (item.c's
// TrySetObtainedItemQuestLogEvent from ScrCmd_additem), a won trainer battle and a won wild one (battle_main.c's
// TrySetQuestLogBattleEvent, CB2_EndTrainerBattle's QuestLogEvents_HandleEndTrainerBattle), and the slots
// (slot_machine.c's SetQLPlayedTheSlots: leaving the Game Corner then counts as QL_EVENT_DEPARTED).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

// ------------------------------------------------------------------ helpers (as tests/e2e/questLog.test.ts has them)

const QL = (game: Game) => game.eval((t) => t.questLog());
const define = (game: Game, name: string) => game.eval((t, n) => t.define(n), name);

/** START → SAVE → YES (and YES to overwrite a file saved earlier), then wait for the field. */
async function save(game: Game): Promise<void> {
  await game.waitIdle();
  await game.press('START');
  const menu = await game.waitFor((t) => t.startMenu(), { what: 'the start menu' });
  const downs = (menu.items.indexOf('SAVE') - menu.cursor + menu.items.length) % menu.items.length;
  await game.pressTimes('DOWN', downs);
  await game.press('A');
  await game.waitFor((t) => t.saveDialog()?.statsWindow, { what: 'the save info window' });
  await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the YES/NO menu' });
  await game.press('UP');
  await game.press('A');
  // A file saved before in this test asks to overwrite it: YES
  const msg = await game.waitFor((t) => /saved the game|already a saved file/.test(t.message() ?? '') && t.message(), { what: 'the saved message' });
  if (/already a saved file/.test(msg)) {
    await game.mashUntil((t) => t.saveDialog()?.yesNo, { button: 'B', what: 'the overwrite YES/NO' });
    await game.press('UP');
    await game.press('A');
    await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  }
  await game.waitIdle();
}

/** In the page: gStringVar4 (menus/common.ts) up to its EOS. */
const stringVar4 = (game: Game) =>
  game.eval(async () => {
    const m = await new Function("return import('/src/menus/common.ts')")();
    const s = m.gStringVar4 as number[];
    return s.slice(0, s.indexOf(0xff) + 1);
  });

/** The index of the first scene with an `event` command (or -1). */
const sceneWith = async (game: Game, event: string) => {
  const [ql, id] = await Promise.all([QL(game), define(game, event)]);
  return ql.scenes.findIndex((s) => s.commands.some((c) => c.id === id));
};

/** The line `event` plays back (QL_LoadEvent → gStringVar4) and its encoded bytes; the event must be recorded. */
async function eventLine(game: Game, event: string): Promise<{ line: string; bytes: number[] }> {
  const scene = await sceneWith(game, event);
  expect(scene, `${event} in a scene`).toBeGreaterThanOrEqual(0);
  const line = await game.eval((t, [s, e]) => t.questLogEventLine(s, e), [scene, event] as [number, string]);
  return { line: line!, bytes: await stringVar4(game) };
}

/** The data words of every `event` command recorded (after the two header words). */
async function eventWords(game: Game, event: string): Promise<number[][]> {
  const [ql, id] = await Promise.all([QL(game), define(game, event)]);
  return ql.scenes.flatMap((s) => s.commands.filter((c) => c.id === id).map((c) => c.words.slice(2)));
}

/**
 * Save, reload and CONTINUE: the lines the playback shows (gStringVar4 while sPlaybackControl.state is 1), up to
 * the end of the playback. Mashes nothing: the scenes play on their own.
 */
async function playBack(game: Game): Promise<number[][]> {
  await save(game);
  await game.load({ keepSave: true, mainMenu: true });
  const watch = game.eval(async (t) => {
    const m = await new Function("return import('/src/menus/common.ts')")();
    const shown: number[][] = [];
    let last: number[] | undefined;
    const ok = await t.until(() => {
      if (!t.field()) return false; // (the main menu)
      const ql = t.questLog();
      // a line is up; the next one can follow in the same frame
      if (ql.playback.active && ql.playback.control.state === 1 && m.gStringVar4 !== last) {
        last = m.gStringVar4 as number[];
        shown.push(last.slice(0, last.indexOf(0xff) + 1));
      }
      return shown.length > 0 && !ql.playback.active;
    }, 60000);
    const f = t.field();
    const p = t.questLog().playback;
    return { ok, shown, end: { map: f?.map, x: f?.x, y: f?.y, script: f?.script, message: t.message(), control: p.control, scene: p, gba: t.gbaScreen() } };
  });
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading, { what: 'the main menu' });
  await game.press('A'); // CONTINUE
  const seen = await watch;
  expect(seen.ok, `the playback to show its lines and end: ${JSON.stringify(seen.end)}`).toBe(true);
  return seen.shown;
}

/** Put `items` (ITEM_* names) in the bag (the first TM adds the TM case, the first berry the berry pouch). */
async function addItems(game: Game, items: [string, number][]) {
  await game.eval((t, list) => {
    for (const [name, n] of list) t.state!.bag.add(t.define(`ITEM_${name}`), n);
  }, items);
}

/** In the bag: the row of `item` in the open pocket (from its cursor), then A. */
async function pickBagItem(game: Game, item: string) {
  const { row, target } = await game.eval(async (t, name) => {
    const m = await new Function("return import('/src/menus/itemMenuState.ts')")();
    const s = m.gBagMenuState;
    const pocket = s.pocket as number;
    const target = t.state!.bag.pockets[pocket].findIndex((slot) => slot.itemId === t.define(`ITEM_${name}`));
    return { row: (s.cursorPos[pocket] as number) + (s.itemsAbove[pocket] as number), target };
  }, item);
  expect(target, `${item} in the open pocket`).toBeGreaterThanOrEqual(0);
  for (let i = row; i !== target; i += Math.sign(target - i)) await game.press(target > i ? 'DOWN' : 'UP');
  await game.eval((t) => t.waitFrames(10));
  await game.press('A');
}

/** In the bag: LEFT / RIGHT to `pocket` (POCKET_* name). */
async function toPocket(game: Game, pocket: string) {
  const want = (await define(game, pocket)) - 1;
  for (let i = 0; i < 4; i++) {
    const now = await game.eval((t) => t.bagPocket());
    if (now === want) return;
    await game.press(want > now ? 'RIGHT' : 'LEFT');
    await game.eval((t) => t.waitFrames(20));
  }
  expect(await game.eval((t) => t.bagPocket())).toBe(want);
}

/** Talk to the clerk on the left; wait for BUY / SELL / SEE YA! to take input. */
async function talkToClerk(game: Game) {
  await game.waitIdle();
  await game.eval((t) => t.face('left'));
  await game.press('A');
  await game.waitFor((t) => t.field()?.overlay, { what: 'BUY / SELL / SEE YA!' });
  await game.eval((t) => t.waitFrames(60));
}

/** The shop's SELL → the bag. */
async function sell(game: Game) {
  await game.press('DOWN');
  await game.press('A');
  await game.waitForBag();
}

// ------------------------------------------------------------------ the Poké Mart

test('a Poké Mart: BUY and SELL (the TM case; the berry pouch and the bag) record BOUGHT / SOLD on SEE YA!, which play back', { timeout: 300_000 }, async () => {
  const game = await session.start({ start: 'after-rival', map: 'PewterCity_Mart', x: 4, y: 3 });
  await game.waitIdle();
  await game.eval((t) => t.state!.bag.pockets[0].forEach((s) => ((s.itemId = 0), (s.quantity = 0))));
  await addItems(game, [
    ['TM28', 1],
    ['ORAN_BERRY', 3],
    ['POTION', 1],
  ]);
  const price = (name: string) => game.eval((t, n) => t.state!.pokemon.items[t.define(`ITEM_${n}`)].price, name);
  const [ball, tm, oran, potion] = await Promise.all(['POKE_BALL', 'TM28', 'ORAN_BERRY', 'POTION'].map(price));

  // Session 1: BUY two Poké Balls, SELL TM28 from the TM case, SEE YA!
  await talkToClerk(game);
  await game.press('A'); // BUY
  await game.waitFor((t) => t.gbaScreen() === 'CB2_BuyMenu', { what: 'the buy menu' });
  await game.eval((t) => t.waitFrames(30));
  await game.press('A'); // POKé BALL
  await game.eval((t) => t.waitFrames(90));
  await game.press('UP'); // ×02
  await game.eval((t) => t.waitFrames(10));
  await game.press('A');
  await game.mashUntil((t) => t.itemCount('POKE_BALL') === 2, { what: 'the purchase', maxFrames: 600 });
  await game.mashUntil((t) => !t.gbaScreen() && !!t.field()?.overlay, { button: 'B', what: 'the shop menu again' });
  await game.eval((t) => t.waitFrames(60));
  await sell(game);
  await toPocket(game, 'POCKET_KEY_ITEMS');
  await pickBagItem(game, 'TM_CASE');
  await game.waitFor((t) => t.tmCase()?.task === 'Task_HandleListInput' && !t.tmCase()!.fading, { what: 'the TM case' });
  await game.press('A'); // TM28 (the only one): "I can pay ¥… Would that be okay?" → YES
  await game.mashUntil((t) => t.itemCount('TM28') === 0, { what: 'the TM sale', maxFrames: 1200 });
  await game.mashUntil((t) => t.tmCase()?.task === 'Task_HandleListInput', { what: 'the list after the sale' });
  await game.press('B');
  await game.waitForBag();
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the shop to close' });

  const [PEWTER, BALL, TM28, POTION] = await Promise.all(['MAPSEC_PEWTER_CITY', 'ITEM_POKE_BALL', 'ITEM_TM28', 'ITEM_POTION'].map((n) => define(game, n)));
  expect(await eventWords(game, 'QL_EVENT_BOUGHT_ITEM')).toEqual([[BALL, 2, 0, ball * 2, PEWTER | (1 << 8)]]);
  expect(await eventWords(game, 'QL_EVENT_SOLD_ITEM')).toEqual([[TM28, 1, 0, tm >> 1, PEWTER]]);
  const bought = await eventLine(game, 'QL_EVENT_BOUGHT_ITEM');
  const soldOne = await eventLine(game, 'QL_EVENT_SOLD_ITEM');
  expect(bought.line).toBe(`Went to the POKéMON MART in PEWTER CITY and spent ¥${ball * 2} for items including POKé BALL(s).`);
  expect(soldOne.line).toMatch(/^\S+ went to the POKéMON MART in PEWTER CITY and sold just one of the item TM28\.$/);

  // Session 2 (a few steps later): SELL two Oran Berries from the berry pouch, then the Potion from the bag's ITEMS
  await game.walk('down');
  await game.walk('up');
  await talkToClerk(game);
  await sell(game);
  await toPocket(game, 'POCKET_KEY_ITEMS');
  await pickBagItem(game, 'BERRY_POUCH');
  await game.waitFor((t) => t.berryPouch()?.task === 'Task_BerryPouchMain' && !t.berryPouch()!.fading, { what: 'the berry pouch' });
  await game.press('A'); // ORAN BERRY: how many? ×2 → YES
  await game.waitFor((t) => t.berryPouch()?.task === 'Task_Sell_SelectMultiple', { what: 'the quantity box' });
  await game.press('UP');
  await game.eval((t) => t.waitFrames(5));
  await game.press('A');
  await game.mashUntil((t) => t.itemCount('ORAN_BERRY') === 1, { what: 'the berry sale', maxFrames: 1200 });
  await game.mashUntil((t) => t.berryPouch()?.task === 'Task_BerryPouchMain', { what: 'the pouch after the sale' });
  await game.press('B');
  await game.waitForBag();
  await toPocket(game, 'POCKET_ITEMS');
  await pickBagItem(game, 'POTION'); // one: "I can pay ¥… Would that be okay?" → YES
  await game.mashUntil((t) => t.itemCount('POTION') === 0, { what: 'the Potion sale', maxFrames: 1200 });
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the shop to close again' });

  const sold = await eventWords(game, 'QL_EVENT_SOLD_ITEM');
  expect(sold).toEqual([
    [TM28, 1, 0, tm >> 1, PEWTER],
    [POTION, 3, 0, (oran >> 1) * 2 + (potion >> 1), PEWTER | (1 << 8)],
  ]);

  const shown = await playBack(game);
  expect(shown).toContainEqual(bought.bytes);
  expect(shown).toContainEqual(soldOne.bytes);
  expect(shown.length).toBeGreaterThanOrEqual(3);
  const lines = (await game.eval((t, all) => all.map((b) => t.decode(b)), shown)).map((l) => l.replace(/\s+/g, ' '));
  expect(lines).toContain(`Sold items including POTION at the POKéMON MART in PEWTER CITY, worth ¥${(oran >> 1) * 2 + (potion >> 1)}.`);
});

/** Walk `dir` into a door (or onto a mat's push warp: `mat`), until the map changes and the field is idle. */
async function throughDoor(game: Game, dir: 'up' | 'down', mat = false): Promise<string> {
  const from = (await game.eval((t) => t.field()))!.map;
  if (mat) await game.eval((t) => t.enterWarp());
  else await game.eval((t, d) => t.walk(d), dir);
  expect(await game.eval((t, f) => t.until(() => t.field()?.map !== f && t.idle(), 20000), from), `out of ${from}`).toBe(true);
  return (await game.eval((t) => t.field()))!.map;
}

// ------------------------------------------------------------------ the Pokémon Center

test('the Pokémon Center nurse records USED_PKMN_CENTER into the scene that arriving in a town started, and it plays back', { timeout: 300_000 }, async () => {
  const game = await session.start({ start: 'after-rival', map: 'LavenderTown', x: 6, y: 6 });
  await game.waitIdle();
  await game.eval((t) => t.state!.party.forEach((m) => (m.hp = 1)));
  // Arriving in Lavender Town for the first time (setworldmapflag → QL_EVENT_ARRIVED) started the scene: the
  // nurse's event never starts one (ShouldRegisterEvent_HandlePartyActions)
  expect((await QL(game)).state).toBe(await define(game, 'QL_STATE_RECORDING'));
  expect(await eventWords(game, 'QL_EVENT_ARRIVED')).toEqual([[await define(game, 'MAPSEC_LAVENDER_TOWN')]]);
  // Into the Pokémon Center and to the nurse
  expect(await throughDoor(game, 'up')).toBe('LavenderTown_PokemonCenter_1F');
  await game.eval((t) => t.walkTo(7, 4));
  await game.eval((t) => t.face('up'));
  await game.mashUntil((t) => t.message() !== undefined, { what: 'the nurse' });
  await game.mashUntil((t) => t.idle(), { what: 'the nurse to finish' });
  expect(await game.eval((t) => t.party().every((m) => m.hp === m.maxHP))).toBe(true);

  const center = await eventLine(game, 'QL_EVENT_USED_PKMN_CENTER');
  expect(center.line).toBe('POKéMON were fully restored at a POKéMON CENTER.');
  const shown = await playBack(game);
  expect(shown).toContainEqual(center.bytes);
});

// ------------------------------------------------------------------ a story item

test("a story item from a script's giveitem (Oak's Parcel) starts a scene with OBTAINED_STORY_ITEM; it plays back", { timeout: 300_000 }, async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity', x: 36, y: 20 });
  await game.waitIdle();
  // Arriving in Viridian City for the first time (QL_EVENT_ARRIVED) is recording a scene, in which a story item
  // isn't recorded; saving closes it (SaveQuestLogData)
  await save(game);
  expect((await QL(game)).playbackState).toBe(await define(game, 'QL_PLAYBACK_STATE_STOPPED'));
  // Into the mart: the clerk's ViridianCity_Mart_EventScript_ParcelScene (ON_FRAME) gives OAK's PARCEL
  await game.eval((t) => t.walk('up'));
  await game.mashUntil((t) => t.itemCount('OAKS_PARCEL') === 1 && t.idle(), { what: "Oak's Parcel", maxFrames: 6000 });
  const [PARCEL, VIRIDIAN] = await Promise.all(['ITEM_OAKS_PARCEL', 'MAPSEC_VIRIDIAN_CITY'].map((n) => define(game, n)));
  expect(await eventWords(game, 'QL_EVENT_OBTAINED_STORY_ITEM')).toEqual([[PARCEL, VIRIDIAN]]);
  const story = await eventLine(game, 'QL_EVENT_OBTAINED_STORY_ITEM');
  expect(story.line).toMatch(/^Here in VIRIDIAN CITY, \S+ obtained the item OAK’S PARCEL\.$/);
  const shown = await playBack(game);
  expect(shown).toContainEqual(story.bytes);
});

// ------------------------------------------------------------------ the battles

test('a won trainer battle and a won wild battle (after the Hall of Fame) each start a scene with their event; the trainer ends its scene', { timeout: 300_000 }, async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianForest', x: 41, y: 45, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await game.waitIdle();
  expect((await QL(game)).playbackState).toBe(await define(game, 'QL_PLAYBACK_STATE_STOPPED'));
  // Before the Hall of Fame neither a wild battle nor a trainer outside the story's classes starts a scene
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_GAME_CLEAR'));
  const [TRAINER, WILD, SCENE_END, RATTATA, FOREST, MEWTWO, RICK] = await Promise.all(
    ['QL_EVENT_DEFEATED_TRAINER', 'QL_EVENT_DEFEATED_WILD_MON', 'QL_EVENT_SCENE_END', 'SPECIES_RATTATA', 'MAPSEC_VIRIDIAN_FOREST', 'SPECIES_MEWTWO', 'TRAINER_BUG_CATCHER_RICK'].map(
      (n) => define(game, n),
    ),
  );

  // Bug Catcher Rick spots the player one step right. His event waits for CB2_EndTrainerBattle
  // (QuestLogEvents_HandleEndTrainerBattle), which starts the scene after the battle (so its playback starts with
  // Rick beaten) and ends it
  const mark = await game.mark();
  await game.walk('right');
  await game.waitForEvent('trainerApproach', { since: mark, what: 'Rick to spot the player' });
  await game.mashUntil((t) => t.events().find((e) => e.type === 'battleEnd'), { what: "Rick's battle to end" });
  await game.mashUntil((t) => t.idle(), { what: "Rick's post-battle line" });
  let ql = await QL(game);
  const trainerScene = ql.scenes.findIndex((s) => s.commands.some((c) => c.id === TRAINER));
  expect(trainerScene).toBeGreaterThanOrEqual(0);
  const words = ql.scenes[trainerScene].commands.find((c) => c.id === TRAINER)!.words.slice(2);
  // [speciesOpponent, speciesPlayer, trainerId, mapSec | hpFractionId << 8]: Rick's last mon, a full-HP Mewtwo
  expect(words.slice(1)).toEqual([MEWTWO, RICK, FOREST]);
  expect(ql.scenes[trainerScene].commands.at(-1)!.id).toBe(SCENE_END); // QL_FinishRecordingScene
  expect(ql.playbackState).toBe(await define(game, 'QL_PLAYBACK_STATE_STOPPED'));
  const trainerLine = await eventLine(game, 'QL_EVENT_DEFEATED_TRAINER');
  expect(trainerLine.line).toBe('In VIRIDIAN FOREST, took on RICK’s CATERPIE with MEWTWO and won handily!');

  // A wild Rattata: DEFEATED_WILD_MON starts the next scene
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 3 }));
  await game.mashUntil((t) => t.events().filter((e) => e.type === 'battleEnd').length >= 2, { what: 'the wild battle to end' });
  await game.mashUntil((t) => t.idle(), { what: 'back to the field' });
  ql = await QL(game);
  const wildScene = ql.scenes.findIndex((s) => s.commands.some((c) => c.id === WILD));
  expect(wildScene).toBe((trainerScene + 1) % 4);
  // the scene's one wild battle record: defeated species, caught species (none), the counts and the map section
  expect(ql.scenes[wildScene].commands.find((c) => c.id === WILD)!.words.slice(2, 4)).toEqual([RATTATA, 0]);
  const wildLine = await eventLine(game, 'QL_EVENT_DEFEATED_WILD_MON');
  expect(wildLine.line).toMatch(/^\S+ managed to defeat the POKéMON RATTATA in VIRIDIAN FOREST\.$/);

  const shown = await playBack(game);
  expect(shown).toContainEqual(trainerLine.bytes);
  expect(shown).toContainEqual(wildLine.bytes);
});

// ------------------------------------------------------------------ the slots

test('leaving the Game Corner records DEPARTED only after playing the slots (SetQLPlayedTheSlots); it plays back', { timeout: 300_000 }, async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeladonCity', x: 34, y: 22 });
  await game.waitIdle();
  await game.eval((t) => {
    t.state!.setFlag('FLAG_GOT_COIN_CASE', true);
    t.state!.bag.add(t.define('ITEM_COIN_CASE'), 1);
    t.state!.coins = 50;
  });
  const departures = async () => (await eventWords(game, 'QL_EVENT_DEPARTED')).length;
  const before = await departures();
  // In and straight out: ShouldRegisterEvent_DepartedGameCorner drops it
  expect(await throughDoor(game, 'up')).toBe('CeladonCity_GameCorner');
  await game.eval((t) => t.walkTo(9, 13)); // the exit mat (MB_SOUTH_ARROW_WARP)
  expect(await throughDoor(game, 'down', true)).toBe('CeladonCity');
  expect(await departures()).toBe(before);

  // In again, one spin at the machine left of (1, 7), quit, out
  expect(await throughDoor(game, 'up')).toBe('CeladonCity_GameCorner');
  await game.eval((t) => t.walkTo(1, 7));
  await game.eval((t) => t.face('left'));
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_InitSlotMachine' || t.gbaScreen() === 'CB2_RunSlotMachine', { what: 'playslotmachine' });
  await game.waitFor((t) => t.slotMachine()?.ready && t.slotMachine()?.mainTask === 'MainTask_SlotsGameLoop' && t.slotMachine()?.step === 0, { what: 'the betting step' });
  await game.press('DOWN'); // bet one
  await game.waitFor((t) => t.slotMachine()?.bet === 1 && t.slotMachine()?.step === 0, { what: 'the bet' });
  await game.press('A'); // spin (MainTask_SlotsGameLoop's step 2: SetQLPlayedTheSlots)
  for (let reel = 0; reel < 3; reel++) {
    await game.eval((t, r) => t.until(() => t.slotMachine()?.step === 3 && t.slotMachine()?.currentReel === r && t.slotMachine()?.reelIsSpinning[r]), reel);
    await game.press('A');
  }
  await game.mashUntil((t) => t.slotMachine()?.mainTask === 'MainTask_ConfirmExitGame' && t.slotMachine()?.step === 2, { button: 'B', what: 'Quit playing?', maxFrames: 6000 });
  await game.press('A');
  await game.waitFor((t) => t.idle() && !t.field()!.script && t.gbaScreen() === undefined, { what: 'the field after the slot machine', timeout: 30000 });
  await game.eval((t) => t.walkTo(9, 13)); // the exit mat (MB_SOUTH_ARROW_WARP)
  expect(await throughDoor(game, 'down', true)).toBe('CeladonCity');
  expect(await departures()).toBe(before + 1);
  const departed = await game.eval(async (t) => {
    const ql = t.questLog();
    const id = t.define('QL_EVENT_DEPARTED');
    let scene = -1;
    ql.scenes.forEach((s, i) => {
      if (s.commands.some((c) => c.id === id)) scene = i;
    });
    return { scene, line: t.questLogEventLine(scene, 'QL_EVENT_DEPARTED') };
  });
  expect(departed.line).toBe('Played a lot of games at the ROCKET GAME CORNER in CELADON CITY.');
  const bytes = await stringVar4(game);
  const shown = await playBack(game);
  expect(shown).toContainEqual(bytes);
});
