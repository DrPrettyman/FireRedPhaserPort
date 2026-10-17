// Headless story checks, Brock to Lt. Surge: each gym from the state the story would have reached (flags,
// badges, a strong party), the gym walked and its leader beaten (the badge flag and the TM), plus the story
// events the decomp makes required between them (Bill's Sea Cottage, the S.S. Anne captain and HM01 Cut, the
// cut tree in front of Vermilion Gym). Gym trainers are set as beaten unless the check is about them.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

/** Set trainers' flags (TRAINER_FLAGS_START + TRAINER_*), as if beaten. */
async function beatTrainers(game: Game, names: string[]): Promise<void> {
  await game.eval((t, names) => {
    for (const n of names) t.state!.setFlag(t.define('TRAINER_FLAGS_START') + t.define(`TRAINER_${n}`));
  }, names);
}

async function setFlags(game: Game, flags: string[]): Promise<void> {
  await game.eval((t, flags) => {
    for (const f of flags) t.state!.setFlag(f);
  }, flags);
}

/** Facing something to talk to (an NPC, a sign): press A until a message shows, then through it until the field is free. */
async function talk(game: Game, what: string): Promise<void> {
  await game.waitIdle();
  await game.mashUntil((t) => t.message() !== undefined || !t.idle(), { what: `${what} to start` });
  await game.mashUntil((t) => t.idle(), { what: `${what} to end` });
}

/** Walk next to (x, y) from the side `from` and face it. */
async function approach(game: Game, x: number, y: number, from: 'below' | 'above' | 'left' | 'right'): Promise<void> {
  const [dx, dy, face] = { below: [0, 1, 'up'], above: [0, -1, 'down'], left: [-1, 0, 'right'], right: [1, 0, 'left'] }[from] as [number, number, 'up' | 'down' | 'left' | 'right'];
  const r = await game.eval((t, x, y) => t.walkTo(x, y), x + dx, y + dy);
  expect(r, `walking next to (${x}, ${y})`).toMatchObject({ arrived: true });
  await game.eval((t, f) => t.face(f), face);
}

/** A leader's battle: talk, fight to the end, then press through the badge and TM text until the field is free. */
async function beatLeader(game: Game, x: number, y: number, from: 'below' | 'above' | 'left' | 'right'): Promise<void> {
  await approach(game, x, y, from);
  const since = await game.mark();
  // (mashUntil's check is sent as source text: the mark goes through the page)
  await game.eval((_t, since) => ((window as any).__storySince = since), since);
  await game.mashUntil((t) => t.events((window as any).__storySince).some((e) => e.type === 'battleStart'), { what: 'the leader battle' });
  await game.mashUntil((t) => t.events((window as any).__storySince).some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  const end = await game.waitForEvent('battleEnd', { since });
  expect(await game.eval((t, n) => t.nameOf('B_OUTCOME_', n), end.outcome as number)).toBe('B_OUTCOME_WON');
  await game.mashUntil((t) => t.idle(), { what: 'the badge and TM text' });
}

// ------------------------------------------------------------------ Lt. Surge (VermilionCity_Gym)

/** Map-local position of trash can `i` (1-15; five per row, rows at y = 10, 12, 14). */
function canPos(i: number): [number, number] {
  return [1 + 2 * ((i - 1) % 5), 10 + 2 * Math.floor((i - 1) / 5)];
}

async function checkCan(game: Game, i: number): Promise<void> {
  const [x, y] = canPos(i);
  await approach(game, x, y, 'below');
  await talk(game, `trash can ${i}`);
}

/** The beam's middle cell (5, 6): impassable while either lock is on. */
async function beamBlocked(game: Game): Promise<boolean> {
  return game.eval((t) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const f = t.field()!;
    return s.world.tileAt(f.worldX - f.x + 5, f.worldY - f.y + 6).collision !== 0;
  });
}

test('Lt. Surge: the trash can switches (a wrong second can resets them), then the battle, the badge and TM34', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity_Gym', x: 5, y: 19, party: [MEWTWO] });
  await setFlags(game, ['FLAG_BADGE01_GET', 'FLAG_BADGE02_GET', 'FLAG_GOT_HM01']);
  await beatTrainers(game, ['SAILOR_DWAYNE', 'ENGINEER_BAILY', 'GENTLEMAN_TUCKER']);
  // VermilionCity_Gym_OnTransition: SetVermilionTrashCans → VAR_TEMP_0 / VAR_TEMP_1, neighbouring cans.
  const cans = () => game.eval((t) => [t.var('VAR_TEMP_0'), t.var('VAR_TEMP_1')] as [number, number]);
  let [first, second] = await cans();
  expect(first).toBeGreaterThanOrEqual(1);
  expect(first).toBeLessThanOrEqual(15);
  const [fx, fy] = canPos(first);
  const [sx, sy] = canPos(second);
  expect(Math.abs(fx - sx) + Math.abs(fy - sy)).toBe(2);
  expect(await beamBlocked(game)).toBe(true);

  // The first switch, then a can that isn't the second: the locks reset and new cans are picked.
  await checkCan(game, first);
  expect(await game.eval((t) => t.flag('FLAG_TEMP_1'))).toBe(true);
  const wrong = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].find((i) => i !== first && i !== second)!;
  await checkCan(game, wrong);
  expect(await game.eval((t) => t.flag('FLAG_TEMP_1'))).toBe(false);
  expect(await beamBlocked(game)).toBe(true);

  // Both switches: the beam is gone.
  [first, second] = await cans();
  await checkCan(game, first);
  expect(await game.eval((t) => t.flag('FLAG_TEMP_1'))).toBe(true);
  await checkCan(game, second);
  expect(await game.eval((t) => t.flag('FLAG_FOUND_BOTH_VERMILION_GYM_SWITCHES'))).toBe(true);
  expect(await beamBlocked(game)).toBe(false);

  await beatLeader(game, 5, 2, 'below');
  expect(await game.eval((t) => t.flag('FLAG_BADGE03_GET'))).toBe(true);
  expect(await game.eval((t) => t.flag('FLAG_DEFEATED_LT_SURGE'))).toBe(true);
  expect(await game.eval((t) => t.itemCount('TM34'))).toBe(1);
});

// ------------------------------------------------------------------ Misty (CeruleanCity_Gym)

/**
 * Walk to (x, y), fighting the trainers who spot the player on the way (their battles run to the end) and
 * pressing through their text, until the player gets there.
 */
async function walkFighting(game: Game, x: number, y: number): Promise<number> {
  let battles = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const since = await game.mark();
    const r = await game.eval((t, x, y) => t.walkTo(x, y), x, y);
    // A trainer can spot the player on the last step: give him the frames to (checkForTrainersWantingBattle).
    if (r.arrived && (await game.eval((t) => t.waitFrames(8).then(() => t.idle())))) return battles;
    await game.mashUntil((t) => t.idle(), { what: 'a trainer battle on the way' });
    if ((await game.events(since)).some((e) => e.type === 'battleEnd')) battles++;
  }
  throw new Error(`Couldn't walk to (${x}, ${y})`);
}

test('Misty: the gym trainers spot the player on the way, then Misty, the Cascade Badge and TM03', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeruleanCity_Gym', x: 8, y: 17, party: [MEWTWO] });
  await setFlags(game, ['FLAG_BADGE01_GET']);
  const battles = await walkFighting(game, 8, 7);
  expect(battles).toBeGreaterThanOrEqual(1);
  expect(await game.eval((t) => t.trainerDefeated('PICNICKER_DIANA') || t.trainerDefeated('SWIMMER_MALE_LUIS'))).toBe(true);
  await beatLeader(game, 8, 6, 'below');
  expect(await game.eval((t) => t.flag('FLAG_BADGE02_GET'))).toBe(true);
  expect(await game.eval((t) => t.flag('FLAG_DEFEATED_MISTY'))).toBe(true);
  expect(await game.eval((t) => t.itemCount('TM03'))).toBe(1);
  // set_gym_trainers 2: the gym's trainers count as beaten now.
  expect(await game.eval((t) => t.trainerDefeated('PICNICKER_DIANA') && t.trainerDefeated('SWIMMER_MALE_LUIS'))).toBe(true);
});

// ------------------------------------------------------------------ Bill (Route25_SeaCottage)

test("Bill's Sea Cottage: Bill the Clefairy goes into the teleporter, the PC's cell separator, the S.S. Ticket", async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route25_SeaCottage', x: 10, y: 7, party: [MEWTWO] });
  await setFlags(game, ['FLAG_BADGE01_GET', 'FLAG_BADGE02_GET']);
  const bill = (gfx: string) => game.eval((t, gfx) => t.objects().find((o) => o.graphicsId === gfx), gfx);
  expect(await bill('OBJ_EVENT_GFX_CLEFAIRY')).toMatchObject({ x: 10, y: 6 });
  expect(await bill('OBJ_EVENT_GFX_BILL')).toBeUndefined();

  // "Help me out, pal?" YES: he walks into the right teleporter.
  await game.eval((t) => t.face('up'));
  await talk(game, 'Bill the Clefairy');
  expect(await bill('OBJ_EVENT_GFX_CLEFAIRY')).toBeUndefined();
  expect(await game.eval((t) => t.flag('FLAG_TEMP_2'))).toBe(true);

  // The PC: the cell separator runs (the teleporters flash, the cable's ball), Bill walks out of the left one.
  await approach(game, 4, 5, 'below');
  await talk(game, 'the cell separator');
  expect(await game.eval((t) => t.flag('FLAG_HELPED_BILL_IN_SEA_COTTAGE'))).toBe(true);
  // AnimateTeleporterHousing / AnimateTeleporterCable leave the lights green and the cable plain.
  const metatile = (x: number, y: number) => game.eval((t, x, y) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const f = t.field()!;
    return s.world.tileAt(f.worldX - f.x + x, f.worldY - f.y + y).metatile as number;
  }, x, y);
  const green = await game.eval((t) => t.define('METATILE_SeaCottage_Teleporter_Light_Green'));
  expect(await metatile(10, 1)).toBe(green);
  expect(await metatile(3, 1)).toBe(green);
  const human = await bill('OBJ_EVENT_GFX_BILL');
  expect(human).toBeDefined();

  await approach(game, human!.x, human!.y, 'below');
  await talk(game, 'Bill');
  expect(await game.eval((t) => t.flag('FLAG_GOT_SS_TICKET'))).toBe(true);
  expect(await game.eval((t) => t.itemCount('SS_TICKET'))).toBe(1);
});

// ------------------------------------------------------------------ The S.S. Anne, HM01 and the way to Lt. Surge

/** Walk onto a warp at (x, y) (a door, stairs, a mat: pushing on if it needs it) and wait for `map` to settle. */
async function takeWarp(game: Game, x: number, y: number, map: string): Promise<void> {
  const since = await game.mark();
  await game.eval((t, x, y) => t.walkTo(x, y), x, y);
  // A door or a mat warps by itself (its anim and fade take a while, and the field can look idle on the way);
  // stairs and arrows need a push: push once the player has stood still on the old map for 30 frames.
  const arrived = await game.eval((t, map) => {
    let still = 0;
    return t.until(() => {
      const f = t.field();
      if (f?.map === map) return t.idle();
      still = t.idle() && !f?.fading ? still + 1 : 0;
      return still > 30;
    }, 1200).then(() => t.field()?.map === map);
  }, map);
  if (!arrived) await game.eval((t) => t.enterWarp());
  await game.waitForEvent('map', { since, what: map });
  await game.waitIdle();
}

test('The S.S. Anne: the ticket check, the rival on 2F, the captain gives HM01, the ship sails', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 23, y: 30, party: [{ ...MEWTWO, moves: ['PSYCHIC', 'CUT'] }] });
  await setFlags(game, ['FLAG_BADGE01_GET', 'FLAG_BADGE02_GET', 'FLAG_GOT_SS_TICKET']);
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_SS_TICKET'), 1));
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 500));

  // The sailor checks the ticket (coord event at (23, 33)), then the gangway to the ship.
  await game.eval((t) => t.walkTo(23, 33));
  await game.mashUntil((t) => t.idle(), { what: 'the ticket check' });
  expect(await game.eval((t) => t.var('VAR_VERMILION_CITY_TICKET_CHECK_TRIGGER'))).toBe(1);
  await takeWarp(game, 23, 34, 'SSAnne_Exterior');
  await takeWarp(game, 32, 14, 'SSAnne_1F_Corridor');
  await takeWarp(game, 3, 8, 'SSAnne_2F_Corridor');

  // The rival on 2F, in front of the captain's office.
  await game.eval((t) => t.walkTo(31, 6));
  await game.mashUntil((t) => t.idle() && t.var('VAR_MAP_SCENE_S_S_ANNE_2F_CORRIDOR') !== 0, { what: 'the rival battle' });
  expect(await game.eval((t) => t.trainerDefeated('RIVAL_SS_ANNE_SQUIRTLE') || t.trainerDefeated('RIVAL_SS_ANNE_BULBASAUR') || t.trainerDefeated('RIVAL_SS_ANNE_CHARMANDER'))).toBe(true);

  // The captain: rub his back, HM01.
  await takeWarp(game, 30, 2, 'SSAnne_CaptainsOffice');
  await approach(game, 5, 4, 'below');
  await talk(game, 'the captain');
  expect(await game.eval((t) => t.flag('FLAG_GOT_HM01'))).toBe(true);
  expect(await game.eval((t) => t.itemCount('HM01'))).toBe(1);
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_VERMILION_CITY'))).toBe(1);

  // Back out: SSAnne_Exterior_ExitSSAnne (the ship sails off), then Vermilion's pier.
  await takeWarp(game, 3, 7, 'SSAnne_2F_Corridor');
  await takeWarp(game, 2, 2, 'SSAnne_1F_Corridor');
  const since = await game.mark();
  await game.eval((t) => t.walkTo(19, 1));
  await game.waitForEvent('map', { since, what: 'SSAnne_Exterior' });
  await game.waitForEvent('map', { since, what: 'VermilionCity', timeout: 60_000 });
  await game.waitIdle();
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_VERMILION_CITY'))).toBe(3);
  expect(await game.eval((t) => t.field()!)).toMatchObject({ map: 'VermilionCity', x: 23, y: 32 });
}, 240_000);

test('Back in Vermilion with HM01: Cut the tree in front of the gym, then the gym door', async () => {
  // Where SSAnne_Exterior_ExitSSAnne / VermilionCity_EventScript_ExitSSAnne leave the player.
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 23, y: 32, party: [{ ...MEWTWO, moves: ['PSYCHIC', 'CUT'] }] });
  await setFlags(game, ['FLAG_BADGE01_GET', 'FLAG_BADGE02_GET', 'FLAG_GOT_SS_TICKET', 'FLAG_GOT_HM01']);
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_VERMILION_CITY', 3));
  await approach(game, 19, 24, 'above');
  await talk(game, 'the cut tree');
  expect(await game.eval((t) => t.flag('FLAG_TEMP_12'))).toBe(true);
  await takeWarp(game, 14, 25, 'VermilionCity_Gym');
});

// ------------------------------------------------------------------ Movement actions the story's NPCs use

test('face_original_direction: the Pewter house Nidoran turns to the player, then back to its own direction', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PewterCity_House1', x: 7, y: 5 });
  const nidoran = () => game.eval((t) => t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_NIDORAN_M')!);
  expect(await nidoran()).toMatchObject({ x: 6, y: 3, facing: 'left' });
  await approach(game, 6, 3, 'right');
  // faceplayer, the cry's text, then Common_Movement_FaceOriginalDirection (MOVEMENT_TYPE_FACE_LEFT → DIR_WEST).
  await game.press('A');
  await game.mashUntil((t) => t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_NIDORAN_M')!.facing === 'right', { what: 'the Nidoran to face the player' });
  await game.mashUntil((t) => t.idle(), { what: 'the script to end' });
  expect(await nidoran()).toMatchObject({ facing: 'left' });
});

// ------------------------------------------------------------------ The Pokémon Center nurse (EventScript_PkmnCenterNurse)

test('The Pokémon Center nurse: the heal machine (FLDEFF_POKECENTER_HEAL), her bow, the party healed, the game stat', async () => {
  const game = await session.start({ start: 'after-rival', map: 'CeruleanCity_PokemonCenter_1F', x: 7, y: 4, party: [MEWTWO, { species: 'PIDGEY', level: 10 }] });
  await game.eval((t) => {
    for (const mon of t.state!.party) mon.hp = 1;
  });
  await game.eval((t) => t.face('up'));
  // Watch in the page: the effect's sprites (the balls, then the monitor) and the bow are short-lived.
  const watch = game.eval(async (t) => {
    const s = (window as any).game.scene.getScene('Overworld');
    const seen = { heal: false, monitor: false, balls: 0, bow: false };
    await t.until(() => {
      const f = t.field();
      if (f?.fieldEffects.includes('FLDEFF_POKECENTER_HEAL')) seen.heal = true;
      const shown = (key: string) =>
        (s.children.list as { texture?: { key: string }; visible: boolean; active: boolean }[]).filter((c) => c.active && c.visible && c.texture?.key === key).length;
      seen.balls = Math.max(seen.balls, shown('fldeff_pokeball_glow'));
      if (shown('fldeff_pokecenter_monitor')) seen.monitor = true;
      const nurse = t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_NURSE');
      if (nurse?.frame === 9) seen.bow = true;
      return seen.bow;
    }, 4000);
    return seen;
  });
  await game.mashUntil((t) => t.message() !== undefined, { what: 'the nurse' });
  await game.mashUntil((t) => t.idle(), { what: 'the nurse to finish' });
  const seen = await watch;
  // One ball per party member on the machine, the monitor flickering, then the bow.
  expect(seen).toMatchObject({ heal: true, monitor: true, balls: 2, bow: true });
  expect(await game.eval((t) => t.party().map((m) => m.hp === m.maxHP))).toEqual([true, true]);
  expect(await game.eval((t) => t.state!.getGameStat(t.define('GAME_STAT_USED_POKECENTER')))).toBe(1);
});
