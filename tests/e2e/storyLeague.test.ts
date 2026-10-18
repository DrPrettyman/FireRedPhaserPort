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

/**
 * Press B until the script has ended and the field is free. (B closes messages as A does, but can't talk to
 * the person in front again: mashing A, a press in the first free tick restarted Bruno's post-battle script.)
 */
async function scriptDone(game: Game, what: string) {
  await game.mashUntil((t) => t.idle() && !t.field()!.script, { what, button: 'B' });
}

/** Press A until `cond` holds (a gift, a switch), then B until the script is over. */
// A whole battle mashed through runs ~10k frames; mashUntil's frame budget (maxFrames) is the real bound. Its
// 120 s wall-clock default ran out on the Champion battle with the machine at load ~230 (batch 2's merge run).
const BATTLE_WALL_TIMEOUT = 300_000;

async function talkUntil(game: Game, cond: Parameters<Game['mashUntil']>[0], what: string) {
  await game.mashUntil(cond, { what });
  await scriptDone(game, `${what}: the end of the script`);
}

/** Press A through a trainer battle (the first move each turn), then B through the script after it. */
async function winBattle(game: Game, what: string) {
  const since = await game.mark();
  await game.eval((_t, s) => ((window as any).__storySince = s), since);
  await game.mashUntil((t) => t.events((window as any).__storySince).some((e) => e.type === 'battleEnd'), { what: `${what}: the battle`, timeout: BATTLE_WALL_TIMEOUT });
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
  await talkUntil(game, (t) => t.itemCount('GOLD_TEETH') === 1, 'the Gold Teeth');
  expect(await game.eval((t) => t.flag('FLAG_HIDE_SAFARI_ZONE_WEST_GOLD_TEETH'))).toBe(true);

  // The Secret House's door at (12, 7); the attendant at (6, 5).
  await takeWarp(game, 12, 7, 'SafariZone_SecretHouse');
  await game.waitIdle();
  await talkFrom(game, 6, 6, 'up');
  await talkUntil(game, (t) => t.flag('FLAG_GOT_HM03'), 'HM03');
  expect(await game.eval((t) => t.itemCount('HM03'))).toBe(1);

  // The Warden in Fuchsia: the Gold Teeth for HM04.
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_SAFARI_MODE', false));
  await warp(game, 'MAP_FUCHSIA_CITY_WARDENS_HOUSE', 3, 7);
  await talkFrom(game, 3, 6, 'up'); // the Warden at (3, 5)
  await talkUntil(game, (t) => t.flag('FLAG_GOT_HM04'), 'HM04');
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
  await talkUntil(game, (t) => t.flag('FLAG_POKEMON_MANSION_SWITCH_STATE'), 'the secret switch');
  expect(await cell(game, 33, 20)).toEqual({ metatile: d.barrierTop, impassable: true });

  await talkFrom(game, 5, 6, 'down'); // the Secret Key at (5, 7)
  await talkUntil(game, (t) => t.itemCount('SECRET_KEY') === 1, 'the Secret Key');
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

// ---------------------------------------------------------------- Giovanni (Viridian Gym)

/**
 * A walking route over spinner tiles (map-local): breadth-first over single steps, where a step onto an
 * MB_SPIN_* tile carries the player on as TryUpdatePlayerSpinDirection does (on in the last spin tile's
 * direction until an MB_STOP_SPINNING tile or a wall). Returns the steps to press.
 */
function spinnerRoute(game: Game, x: number, y: number) {
  return game.eval((t, x, y) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const b = s.behaviors;
    const f = t.field()!;
    const ox = f.worldX - f.x;
    const oy = f.worldY - f.y;
    const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as Record<string, [number, number]>;
    const SPIN: [string, string][] = [['SPIN_RIGHT', 'right'], ['SPIN_LEFT', 'left'], ['SPIN_UP', 'up'], ['SPIN_DOWN', 'down']];
    const occupied = new Set((t.objects() as { x: number; y: number }[]).map((o) => `${o.x},${o.y}`));
    const open = (cx: number, cy: number) => s.world.tileAt(ox + cx, oy + cy).collision === 0 && !occupied.has(`${cx},${cy}`);
    const spinDir = (cx: number, cy: number) => {
      const beh = s.world.tileAt(ox + cx, oy + cy).behavior;
      return SPIN.find(([name]) => b.is(beh, name))?.[1];
    };
    const prev = new Map<string, { from: string; dir: string } | null>([[`${f.x},${f.y}`, null]]);
    const queue: [number, number][] = [[f.x, f.y]];
    for (let i = 0; i < queue.length; i++) {
      const [cx, cy] = queue[i];
      if (cx === x && cy === y) {
        const steps: string[] = [];
        for (let k = `${cx},${cy}`, p = prev.get(k); p; k = p.from, p = prev.get(k)) steps.unshift(p.dir);
        return steps;
      }
      for (const dir of Object.keys(D)) {
        let nx = cx + D[dir][0];
        let ny = cy + D[dir][1];
        if (!open(nx, ny)) continue;
        let spin = spinDir(nx, ny);
        for (let n = 0; spin && n < 64; n++) {
          const sx = nx + D[spin][0];
          const sy = ny + D[spin][1];
          if (!open(sx, sy)) break;
          nx = sx;
          ny = sy;
          if (b.is(s.world.tileAt(ox + nx, oy + ny).behavior, 'STOP_SPINNING')) break;
          spin = spinDir(nx, ny) ?? spin;
        }
        const k = `${nx},${ny}`;
        if (prev.has(k)) continue;
        prev.set(k, { from: `${cx},${cy}`, dir });
        queue.push([nx, ny]);
      }
    }
    return undefined;
  }, x, y);
}

const VIRIDIAN_GYM_TRAINERS = ['TAMER_JASON', 'TAMER_COLE', 'BLACK_BELT_ATSUSHI', 'BLACK_BELT_KIYO', 'BLACK_BELT_TAKASHI', 'COOLTRAINER_SAMUEL', 'COOLTRAINER_YUJI', 'COOLTRAINER_WARREN'];

test('Viridian Gym: locked until the seventh badge; over the spinner tiles to Giovanni, the Earth Badge and TM26', async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity', x: 37, y: 11, party: [MEWTWO] });
  await setFlags(game, badgesBefore(7)); // no Volcano Badge yet
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_VIRIDIAN_CITY_OLD_MAN', 2));
  await warp(game, 'MAP_VIRIDIAN_CITY', 37, 11);
  // ViridianCity_EventScript_GymDoorLocked (the coord event at (36, 11), in front of the door): "The GYM's
  // doors are locked…", and the player jumps back down the ledge.
  await game.walk('left');
  await game.mashUntil((t) => t.idle() && !t.field()!.script && t.field()!.y > 11, { what: 'the locked gym doors' });
  expect(await game.eval((t) => t.field())).toMatchObject({ x: 36, y: 13 });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_VIRIDIAN_CITY_GYM_DOOR'))).toBe(0);

  // With all seven: ViridianCity_EventScript_TryUnlockGym on the map's transition.
  await setFlags(game, ['FLAG_BADGE07_GET']);
  await warp(game, 'MAP_VIRIDIAN_CITY', 37, 11);
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_VIRIDIAN_CITY_GYM_DOOR'))).toBe(1);
  await takeWarp(game, 36, 10, 'ViridianCity_Gym');
  await game.waitIdle();
  await beatTrainers(game, VIRIDIAN_GYM_TRAINERS);

  // A spinner: (13, 21) is MB_SPIN_LEFT; stepping on it carries the player left to the MB_STOP_SPINNING tile at
  // (5, 21).
  expect(await game.eval((t) => t.walkTo(14, 21))).toMatchObject({ arrived: true });
  await game.eval((t) => t.walk('left', 1));
  await game.waitFor((t) => t.idle() && !t.field()!.moving, { what: 'the spin to end' });
  expect(await game.eval((t) => t.field())).toMatchObject({ x: 5, y: 21 });

  // Giovanni at (2, 2), along a route that allows for the spinners.
  const steps = await spinnerRoute(game, 2, 3);
  expect(steps, 'a route to Giovanni').toBeDefined();
  for (const dir of steps!) {
    await game.eval((t, d) => t.walk(d as 'up', 1), dir);
    await game.waitFor((t) => t.idle() && !t.field()!.moving, { what: `a step ${dir}` });
  }
  expect(await game.eval((t) => t.field())).toMatchObject({ x: 2, y: 3 });
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await winBattle(game, 'Giovanni');
  expect(await trainerDefeated(game, 'LEADER_GIOVANNI')).toBe(true);
  expect(await game.eval((t) => [t.flag('FLAG_BADGE08_GET'), t.flag('FLAG_DEFEATED_LEADER_GIOVANNI'), t.flag('FLAG_GOT_TM26_FROM_GIOVANNI')])).toEqual([true, true, true]);
  expect(await game.eval((t) => [t.itemCount('TM26'), t.var('VAR_MAP_SCENE_ROUTE22')])).toEqual([1, 3]);
}, 180_000);

// ---------------------------------------------------------------- The rival on Route 22, Route 23's badge guards

test('Route 22: with the Earth Badge, the rival stops the player on the way to the League', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route22', x: 35, y: 5, party: [MEWTWO] });
  await setFlags(game, badgesBefore(9));
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_ROUTE22', 3)); // ViridianCity_Gym_EventScript_DefeatedGiovanni
  await repel(game);
  await game.walk('left');
  await game.walk('left'); // Route22_EventScript_LateRivalTriggerMid at (33, 5)
  await winBattle(game, 'the rival');
  expect(await game.eval((t) => ['SQUIRTLE', 'BULBASAUR', 'CHARMANDER'].some((s) => t.trainerDefeated(`RIVAL_ROUTE22_LATE_${s}`)))).toBe(true);
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_ROUTE22'))).toBe(4);
  expect(await game.eval((t) => t.objects().some((o) => o.graphicsId === 'OBJ_EVENT_GFX_BLUE'))).toBe(false);
}, 120_000);

test('Route 23: the badge guards turn the player back without the badge and let them on with it', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route22_NorthEntrance', x: 7, y: 4, party: [MEWTWO] });
  await setFlags(game, badgesBefore(9).filter((f) => f !== 'FLAG_BADGE02_GET'));
  // The gate's Boulder Badge check (Route22_NorthEntrance_EventScript_BoulderBadgeGuardTrigger at (7, 2)).
  await game.walk('up');
  await game.walk('up');
  await scriptDone(game, 'the Boulder Badge check');
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_ROUTE23'), t.field()!.y])).toEqual([1, 2]);
  await takeWarp(game, 7, 1, 'Route23');
  await game.waitIdle();
  await repel(game);

  // No Cascade Badge: Route23_EventScript_MissingBadgeTrigger walks the player back down.
  expect(await game.eval((t) => t.walkTo(13, 150))).toMatchObject({ arrived: true });
  await game.walk('up');
  await scriptDone(game, 'the Cascade Badge guard');
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_ROUTE23'), t.field()!.y])).toEqual([1, 150]);

  await setFlags(game, ['FLAG_BADGE02_GET']);
  await game.walk('up');
  await scriptDone(game, 'the Cascade Badge guard again');
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_ROUTE23'), t.field()!.y])).toEqual([2, 149]);
}, 120_000);

// ---------------------------------------------------------------- The Elite Four and the Champion

/**
 * Heal the party for the next battle (a fresh Lv. 100 Mewtwo: full HP and PP). Mashing A only ever picks PSYCHIC,
 * whose 10 PP ran out against the Champion once (Exeggutor and Alakazam take several hits; the rolls vary from
 * run to run) and left the mash pressing A at "There's no PP left": three PP Ups make it 16.
 */
async function heal(game: Game) {
  await game.eval((t, mon) => {
    t.setParty([mon]);
    const m = t.state!.party[0];
    m.ppBonuses = 0x03; // move 0: three PP Ups
    m.pp[0] = 16;
  }, MEWTWO);
}

/**
 * An Elite Four room: the walk in (PokemonLeague_EventScript_EnterRoom: five steps up, the entry closes behind),
 * talk to the member at (x, y) from below, win, and the door at the top opens.
 */
async function eliteFourRoom(game: Game, member: string, x: number, y: number, defeatedFlag: string) {
  await game.waitIdle({ timeout: 60_000 });
  await heal(game);
  await talkFrom(game, x, y + 1, 'up');
  await winBattle(game, member);
  expect(await game.eval((t, f) => [t.flag(f), t.flag('FLAG_TEMP_4')], defeatedFlag)).toEqual([true, true]);
}

test('The Elite Four and the Champion: each room in turn, then Oak takes the player to the Hall of Fame', async () => {
  const game = await session.start({ start: 'after-rival', map: 'IndigoPlateau_PokemonCenter_1F', x: 4, y: 3, party: [MEWTWO], speed: 16 });
  await setFlags(game, badgesBefore(9));

  // Lorelei: PokemonLeague_LoreleisRoom_OnFrame walks the player in (VAR_MAP_SCENE_POKEMON_LEAGUE 0 → 1).
  await takeWarp(game, 4, 1, 'PokemonLeague_LoreleisRoom');
  await game.waitFor((t) => t.var('VAR_MAP_SCENE_POKEMON_LEAGUE') === 1 && t.idle() && !t.field()!.script, { what: 'the walk into Lorelei\'s room' });
  expect(await game.eval((t) => t.field())).toMatchObject({ x: 6, y: 7 });
  const entry = await game.eval((t) => t.define('METATILE_PokemonLeague_Entry_TopMid_Closed'));
  expect(await cell(game, 6, 11)).toEqual({ metatile: entry, impassable: true });
  await eliteFourRoom(game, 'Lorelei', 6, 5, 'FLAG_DEFEATED_LORELEI');
  expect((await cell(game, 6, 2)).metatile).toBe(await game.eval((t) => t.define('METATILE_PokemonLeague_Door_Mid_Open')));

  await takeWarp(game, 6, 2, 'PokemonLeague_BrunosRoom');
  await game.waitFor((t) => t.var('VAR_MAP_SCENE_POKEMON_LEAGUE') === 2 && t.idle() && !t.field()!.script, { what: 'the walk into Bruno\'s room' });
  await eliteFourRoom(game, 'Bruno', 6, 5, 'FLAG_DEFEATED_BRUNO');

  await takeWarp(game, 6, 2, 'PokemonLeague_AgathasRoom');
  await game.waitFor((t) => t.var('VAR_MAP_SCENE_POKEMON_LEAGUE') === 3 && t.idle() && !t.field()!.script, { what: 'the walk into Agatha\'s room' });
  await eliteFourRoom(game, 'Agatha', 6, 5, 'FLAG_DEFEATED_AGATHA');

  // Lance's room: the long corridor walk (PokemonLeague_LancesRoom_Movement_WalkThroughCorridor).
  await takeWarp(game, 6, 2, 'PokemonLeague_LancesRoom');
  await game.waitFor((t) => t.var('VAR_MAP_SCENE_POKEMON_LEAGUE') === 4 && t.idle() && !t.field()!.script, { what: 'the corridor into Lance\'s room' });
  await eliteFourRoom(game, 'Lance', 6, 8, 'FLAG_DEFEATED_LANCE');
  expect((await cell(game, 6, 5)).metatile).toBe(await game.eval((t) => t.define('METATILE_PokemonLeague_Door_Mid_Open')));

  // The Champion's room: PokemonLeague_ChampionsRoom_EventScript_EnterRoom runs it all: the walk in, the rival,
  // the battle, Oak's congratulations (GetStarterSpecies → STR_VAR_1), then the warp to the Hall of Fame.
  await heal(game);
  const starter = ['BULBASAUR', 'SQUIRTLE', 'CHARMANDER'][await game.eval((t) => t.var('VAR_STARTER_MON'))];
  const oak = game.eval(async (t) => {
    let said: string | undefined;
    await t.until(() => {
      const m = t.message();
      if (m && /first left with/.test(m)) said = m;
      return t.field()?.map === 'PokemonLeague_HallOfFame';
    }, 200000);
    return said;
  });
  await takeWarp(game, 6, 5, 'PokemonLeague_ChampionsRoom');
  const since = await game.mark();
  await game.eval((_t, s) => ((window as any).__storySince = s), since);
  await game.mashUntil((t) => t.events((window as any).__storySince).some((e) => e.type === 'battleEnd'), { what: 'the Champion battle', timeout: BATTLE_WALL_TIMEOUT });
  const end = await game.waitForEvent('battleEnd', { since });
  expect(await game.eval((t, o) => t.nameOf('B_OUTCOME_', o), end.outcome as number)).toBe('B_OUTCOME_WON');
  await game.mashUntil((t) => t.field()?.map === 'PokemonLeague_HallOfFame', { what: 'Oak and the warp to the Hall of Fame' });
  expect(await game.eval((t) => t.flag('FLAG_DEFEATED_CHAMP'))).toBe(true);
  expect(await oak).toMatch(new RegExp(`first left with ${starter} to work`));
}, 600_000);
