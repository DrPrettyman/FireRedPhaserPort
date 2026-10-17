// Story checks from Koga to the Hall of Fame (SCREENS_PLAN.md, W-story unit 4): per gym and per story event the
// decomp requires, set up the state the story would have (flags, badges, a strong party), play the event and
// check what the player gets. Koga (Fuchsia Gym's invisible walls), the Safari Zone's Gold Teeth → the Warden's
// HM04 and the Secret House's HM03, the Pokémon Mansion's switch and Secret Key → Cinnabar Gym's door, its quiz
// and Blaine, Viridian Gym (opens with seven badges; spinner tiles; Giovanni), the rival on Route 22, Route 23's
// badge guards, Victory Road, the Elite Four and the Champion up to the Hall of Fame (the ceremony itself:
// hallOfFame.test.ts). Bill's One Island trip after Blaine can be declined, so it isn't here.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC', 'SURF', 'STRENGTH'] };

/** Every badge before `n` (1-based): FLAG_BADGE01_GET .. FLAG_BADGE0{n-1}_GET. */
const badgesBefore = (n: number) => Array.from({ length: n - 1 }, (_, i) => `FLAG_BADGE0${i + 1}_GET`);

/** The metatile id at a map-local cell, and whether its collision bits are set. */
function cell(game: Game, x: number, y: number) {
  return game.eval((t, x, y) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const f = t.field()!;
    const tile = s.world.tileAt(f.worldX - f.x + x, f.worldY - f.y + y);
    return { metatile: tile.metatile as number, impassable: tile.collision !== 0 };
  }, x, y);
}

/** A scripted warp (ScrCmd_warp) to map-local (x, y), waiting for the new map to settle. */
async function warp(game: Game, mapId: string, x: number, y: number) {
  const mark = await game.mark();
  await game.eval((_t, id, x, y) => (window as any).game.scene.getScene('Overworld').warp(id, -1, x, y), mapId, x, y);
  await game.waitForEvent('map', { since: mark, what: mapId });
  await game.waitIdle();
}

/** VAR_REPEL_STEP_COUNT: no wild battles on the way (the party's Lv. 100 lead keeps them all away). */
async function repel(game: Game) {
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 1000));
}

/** Mark trainers beaten (TRAINER_* without the prefix), so none of them walks up mid-test. */
async function beatTrainers(game: Game, trainers: string[]) {
  await game.eval((t, names) => {
    for (const n of names) t.state!.setFlag(t.define('TRAINER_FLAGS_START') + t.define(`TRAINER_${n}`), true);
  }, trainers);
}

async function setFlags(game: Game, flags: string[]) {
  await game.eval((t, names) => {
    for (const f of names) t.state!.setFlag(f, true);
  }, flags);
}

/** Walk to (x, y) (asserting the player got there), face `dir` and press A. */
async function talkFrom(game: Game, x: number, y: number, dir: 'up' | 'down' | 'left' | 'right') {
  expect(await game.eval((t, x, y) => t.walkTo(x, y), x, y), `walking to (${x}, ${y})`).toMatchObject({ arrived: true });
  await game.eval((t, d) => t.face(d), dir);
  await game.press('A');
}

/** Press A until the script has ended and the field is free. */
async function scriptDone(game: Game, what: string) {
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what });
}

/** Press A through a trainer battle (the first move each turn) and the script after it. */
async function winBattle(game: Game, what: string) {
  const since = await game.mark();
  await game.eval((_t, s) => ((window as any).__storySince = s), since);
  await game.mashUntil((t) => t.events((window as any).__storySince).some((e) => e.type === 'battleEnd'), { what: `${what}: the battle` });
  const end = await game.waitForEvent('battleEnd', { since });
  expect(await game.eval((t, o) => t.nameOf('B_OUTCOME_', o), end.outcome as number)).toBe('B_OUTCOME_WON');
  await scriptDone(game, `${what}: the script after the battle`);
}

/** Walk onto a warp at (x, y) and wait for `map` (stairs, ladders and gate exits get a push: t.enterWarp()). */
async function takeWarp(game: Game, x: number, y: number, map: string) {
  const since = await game.mark();
  await game.eval((t, x, y) => t.walkTo(x, y), x, y);
  const arrived = await game.eval((t, map) => {
    let still = 0;
    return t.until(() => {
      const f = t.field();
      if (f?.map === map) return true;
      still = t.idle() && !f?.fading ? still + 1 : 0;
      return still > 30;
    }, 20000).then(() => t.field()?.map === map);
  }, map);
  if (!arrived) await game.eval((t) => t.enterWarp());
  await game.waitForEvent('map', { since, what: map });
}

const trainerDefeated = (game: Game, name: string) => game.eval((t, n) => t.trainerDefeated(n), name);

// ---------------------------------------------------------------- Koga

const FUCHSIA_GYM_TRAINERS = ['TAMER_PHIL', 'TAMER_EDGAR', 'JUGGLER_KIRK', 'JUGGLER_SHAWN', 'JUGGLER_KAYDEN', 'JUGGLER_NATE'];

test('Fuchsia Gym: through the invisible walls to Koga, the Soul Badge and TM06', async () => {
  const game = await session.start({ start: 'after-rival', map: 'FuchsiaCity_Gym', x: 7, y: 20, party: [MEWTWO] });
  await setFlags(game, badgesBefore(5));
  await beatTrainers(game, FUCHSIA_GYM_TRAINERS);
  // The walls are invisible: the floor looks open, but (7, 16) straight ahead is a wall (the layout's collision).
  expect((await cell(game, 7, 16)).impassable).toBe(true);
  expect((await cell(game, 7, 15)).impassable).toBe(false);
  await talkFrom(game, 7, 14, 'up'); // Koga at (7, 13): the way round the walls is the pathfinder's
  await winBattle(game, 'Koga');
  expect(await trainerDefeated(game, 'LEADER_KOGA')).toBe(true);
  expect(await game.eval((t) => [t.flag('FLAG_BADGE05_GET'), t.flag('FLAG_DEFEATED_KOGA'), t.flag('FLAG_GOT_TM06_FROM_KOGA')])).toEqual([true, true, true]);
  expect(await game.eval((t) => t.itemCount('TM06'))).toBe(1);
}, 120_000);

// ---------------------------------------------------------------- The Safari Zone: Surf and Strength

test('Safari Zone: in through the gate, the Gold Teeth and the Secret House\'s HM03; the Warden\'s HM04', async () => {
  const game = await session.start({ start: 'after-rival', map: 'FuchsiaCity_SafariZone_Entrance', x: 4, y: 5, party: [MEWTWO] });
  await setFlags(game, badgesBefore(5));
  await repel(game);
  await game.eval((t) => t.state!.addMoney(5000));
  const money = await game.eval((t) => t.money());
  // The entry trigger at (4, 3): "Would you like to join the hunt?" YES → ¥500, 30 Safari Balls, warp in.
  await game.walk('up');
  await game.walk('up');
  await game.mashUntil((t) => t.field()!.map === 'SafariZone_Center' && t.idle() && !t.field()!.script, { what: 'the Safari Zone' });
  expect(await game.eval((t) => [t.flag('FLAG_SYS_SAFARI_MODE'), t.state!.numSafariBalls, t.money()])).toEqual([true, 30, money - 500]);

  // (The way to the west area is a walk through the zone; warp next to the Gold Teeth's ball.)
  await warp(game, 'MAP_SAFARI_ZONE_WEST', 28, 15);
  await talkFrom(game, 28, 15, 'up'); // the Gold Teeth at (28, 14)
  await game.mashUntil((t) => t.itemCount('GOLD_TEETH') === 1 && t.idle() && !t.field()!.script, { what: 'the Gold Teeth' });
  expect(await game.eval((t) => t.flag('FLAG_HIDE_SAFARI_ZONE_WEST_GOLD_TEETH'))).toBe(true);

  // The Secret House's door at (12, 7); the attendant at (6, 5).
  await takeWarp(game, 12, 7, 'SafariZone_SecretHouse');
  await game.waitIdle();
  await talkFrom(game, 6, 6, 'up');
  await game.mashUntil((t) => t.flag('FLAG_GOT_HM03') && t.idle() && !t.field()!.script, { what: 'HM03' });
  expect(await game.eval((t) => t.itemCount('HM03'))).toBe(1);

  // The Warden in Fuchsia: the Gold Teeth for HM04.
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_SAFARI_MODE', false));
  await warp(game, 'MAP_FUCHSIA_CITY_WARDENS_HOUSE', 3, 7);
  await talkFrom(game, 3, 6, 'up'); // the Warden at (3, 5)
  await game.mashUntil((t) => t.flag('FLAG_GOT_HM04') && t.idle() && !t.field()!.script, { what: 'HM04' });
  expect(await game.eval((t) => [t.itemCount('HM04'), t.itemCount('GOLD_TEETH')])).toEqual([1, 0]);
}, 120_000);

// ---------------------------------------------------------------- Cinnabar: the Pokémon Mansion's Secret Key, the gym

const MANSION_B1F_TRAINERS = ['BURGLAR_LEWIS', 'SCIENTIST_IVAN'];

test('Cinnabar: the gym is locked; the Mansion B1F switch and the Secret Key; then the gym door opens', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CinnabarIsland', x: 20, y: 6, party: [MEWTWO] });
  await setFlags(game, badgesBefore(7));
  // CinnabarIsland_EventScript_GymDoorLocked (the coord event at (20, 5) while VAR_TEMP_1 is 0): pushed back.
  await game.walk('up');
  await game.mashUntil((t) => t.idle() && !t.field()!.script && t.field()!.y === 6, { what: '"The door is locked…"' });
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'CinnabarIsland', x: 20, y: 6 });

  // Pokémon Mansion B1F, from the stairs (34, 29). The Secret Key's room is shut off until the floor's secret
  // switch (the statue at (27, 5)) is pressed.
  await warp(game, 'MAP_POKEMON_MANSION_B1F', 33, 29);
  await repel(game);
  await beatTrainers(game, MANSION_B1F_TRAINERS);
  const canReach = (x: number, y: number) =>
    game.eval((t, x, y) => {
      const f = t.field()!;
      return !!(window as any).game.scene.getScene('Overworld').testFindPath(f.worldX - f.x + x, f.worldY - f.y + y);
    }, x, y);
  expect(await canReach(5, 6)).toBe(false);
  const d = await game.eval((t) => ({ barrierTop: t.define('METATILE_PokemonMansion_Barrier_Horizontal_TopLeft') }));
  expect((await cell(game, 33, 20)).metatile).not.toBe(d.barrierTop);
  await talkFrom(game, 27, 6, 'up');
  // "A secret switch! Press it?" YES (PokemonMansion_EventScript_SecretSwitch → PressSwitch_B1F)
  await game.mashUntil((t) => t.flag('FLAG_POKEMON_MANSION_SWITCH_STATE') && t.idle() && !t.field()!.script, { what: 'the secret switch' });
  expect(await cell(game, 33, 20)).toEqual({ metatile: d.barrierTop, impassable: true });

  await talkFrom(game, 5, 6, 'down'); // the Secret Key at (5, 7)
  await game.mashUntil((t) => t.itemCount('SECRET_KEY') === 1 && t.idle() && !t.field()!.script, { what: 'the Secret Key' });
  expect(await game.eval((t) => t.flag('FLAG_HIDE_POKEMON_MANSION_B1F_SECRET_KEY'))).toBe(true);

  // Back on Cinnabar: CinnabarIsland_EventScript_CheckUnlockGym sets VAR_TEMP_1, the trigger is off.
  await warp(game, 'MAP_CINNABAR_ISLAND', 20, 6);
  expect(await game.eval((t) => t.var('VAR_TEMP_1'))).toBe(1);
  await takeWarp(game, 20, 4, 'CinnabarIsland_Gym');
}, 180_000);

const CINNABAR_GYM_TRAINERS = ['BURGLAR_QUINN', 'SUPER_NERD_ERIK', 'SUPER_NERD_AVERY', 'BURGLAR_RAMON', 'SUPER_NERD_DEREK', 'BURGLAR_DUSTY', 'SUPER_NERD_ZAC'];

test('Cinnabar Gym: a wrong quiz answer brings out the trainer, beating him opens the door; then Blaine', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CinnabarIsland_Gym', x: 25, y: 21, party: [MEWTWO] });
  await setFlags(game, badgesBefore(7));
  const door1 = () => cell(game, 27, 9); // CinnabarIsland_Gym_EventScript_OpenDoor1
  expect((await door1()).impassable).toBe(true);
  // Quiz 1's left machine at (22, 10): "CATERPIE evolves into METAPOD?" NO is wrong → Burglar Quinn walks over.
  await talkFrom(game, 22, 11, 'up');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleStart'), { answers: [[/METAPOD\?$/, 'B']], what: 'the wrong answer and Quinn' });
  await winBattle(game, 'Quinn');
  expect(await trainerDefeated(game, 'BURGLAR_QUINN')).toBe(true);
  expect(await game.eval((t) => t.flag('FLAG_CINNABAR_GYM_QUIZ_1'))).toBe(true);
  expect((await door1()).impassable).toBe(false);

  // The other five rooms: their doors open on load with the quiz flags set; then Blaine at (5, 4).
  await beatTrainers(game, CINNABAR_GYM_TRAINERS);
  await setFlags(game, ['FLAG_CINNABAR_GYM_QUIZ_2', 'FLAG_CINNABAR_GYM_QUIZ_3', 'FLAG_CINNABAR_GYM_QUIZ_4', 'FLAG_CINNABAR_GYM_QUIZ_5', 'FLAG_CINNABAR_GYM_QUIZ_6']);
  await warp(game, 'MAP_CINNABAR_ISLAND_GYM', 25, 21);
  await talkFrom(game, 5, 5, 'up');
  await winBattle(game, 'Blaine');
  expect(await trainerDefeated(game, 'LEADER_BLAINE')).toBe(true);
  expect(await game.eval((t) => [t.flag('FLAG_BADGE07_GET'), t.flag('FLAG_DEFEATED_BLAINE'), t.flag('FLAG_GOT_TM38_FROM_BLAINE')])).toEqual([true, true, true]);
  expect(await game.eval((t) => t.itemCount('TM38'))).toBe(1);
}, 180_000);
