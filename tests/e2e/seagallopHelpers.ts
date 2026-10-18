// Helpers for the Seagallop ferry's e2e tests (seagallop.test.ts, seviiQuest.test.ts): warps, the story state after
// Blaine, riding the ferry and checking the scene, opening a multichoice menu without mashing into it.

import { expect } from 'vitest';
import type { Game } from './harness';

export const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC', 'SURF', 'STRENGTH'] };

/** Every badge up to Blaine's. */
export const BADGES = Array.from({ length: 7 }, (_, i) => `FLAG_BADGE0${i + 1}_GET`);

/** A scripted warp (ScrCmd_warp) to map-local (x, y), waiting for the new map to settle. */
export async function warp(game: Game, mapId: string, x: number, y: number) {
  const mark = await game.mark();
  await game.eval((_t, id, x, y) => (window as any).game.scene.getScene('Overworld').warp(id, -1, x, y), mapId, x, y);
  await game.waitForEvent('map', { since: mark, what: mapId });
}

/** The story state after Blaine (CinnabarIsland_Gym_EventScript_DefeatedBlaine). */
export async function afterBlaine(game: Game) {
  await game.eval((t, badges) => {
    for (const f of badges) t.state!.setFlag(f, true);
    t.state!.setFlag('FLAG_DEFEATED_BLAINE', true);
    t.state!.setFlag('FLAG_GOT_TM38_FROM_BLAINE', true);
    t.state!.setVar('VAR_MAP_SCENE_CINNABAR_ISLAND', 1);
    t.state!.setFlag('FLAG_HIDE_CINNABAR_BILL', false);
    t.state!.setVar('VAR_REPEL_STEP_COUNT', 1000);
  }, BADGES);
}

/** One frame of the ferry scene as the in-page watcher saw it. */
export interface FerryFrame {
  frames: number;
  bg3X: number;
  x2?: number;
  ferryX?: number;
  hFlip?: boolean;
  wakes: number;
  eastbound: boolean;
}

/**
 * Mash A until the ferry scene is up, watching it in the page from its first frame until the field is back: the
 * scene's frames (BG3's x, the ferry's x and x2, wakes). Returns them and the map the ferry arrived at.
 */
export async function rideFerry(game: Game, what: string, button: 'A' | 'B' = 'A') {
  const watcher = game.eval(async (t) => {
    const seen: FerryFrame[] = [];
    let up = false;
    await t.until(() => {
      const s = t.seagallop();
      if (!s?.running) return up; // (not yet, or over)
      if (!up) (window as any).__ferrySince = t.lastSeq();
      up = true;
      seen.push({ frames: s.frames, bg3X: s.bg3X, x2: s.ferry?.x2, ferryX: s.ferry?.x, hFlip: s.ferry?.hFlip, wakes: s.wakes, eastbound: s.eastbound });
      return false;
    }, 40000);
    return seen;
  });
  await game.mashUntil((t) => t.seagallop() !== undefined, { what: `${what}: the ferry scene`, button });
  const frames = (await watcher) as FerryFrame[];
  // The map Task_Seagallop_3 warped to (not one loaded before the scene, e.g. leaving a Pokémon Center)
  const sceneUp = await game.eval(() => (window as any).__ferrySince as number);
  const arrival = await game.waitForEvent('map', { since: sceneUp });
  // The script that ran DoSeagallopFerryScene stays stopped until the warp, so the mash can't start another one on
  // the way (an A press used to talk to the Vermilion sailor, whose script then ran on at the destination): what
  // runs once the departing script has reached its `end` (a few ticks after the warp) is the destination's own.
  const running = await game.eval(async (t, map) => {
    let label: string | undefined;
    await t.until(() => {
      label = t.field()?.script;
      return !label || label.startsWith(map);
    }, 120);
    return label;
  }, arrival.map as string);
  if (running) expect(running.startsWith(arrival.map as string), running).toBe(true);
  await game.eval((t) => t.until(() => t.field()?.map !== undefined && !t.field()?.fading, 20000));
  return { frames, map: arrival.map as string };
}

/** What every ride shows: BG3 scrolls 6 px a frame for 140 frames, the ferry crosses at 3 px a frame with wakes. */
export function checkRide(frames: FerryFrame[], eastbound: boolean) {
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every((f) => f.eastbound === eastbound)).toBe(true);
  const last = frames[frames.length - 1];
  expect(last.frames).toBe(140); // Task_Seagallop_1's 140 frames, then the fade (Task_Seagallop_2)
  // ScrollBG: ChangeBgX(3, 0x600, add or subtract) once a frame
  for (let i = 1; i < frames.length; i++) {
    const step = (frames[i].bg3X - frames[i - 1].bg3X) | 0;
    if (frames[i].frames !== frames[i - 1].frames || frames[i].frames === 140) expect([eastbound ? 0x600 : -0x600, 0]).toContain(step);
  }
  expect(frames.some((f) => f.bg3X !== frames[0].bg3X)).toBe(true);
  // The ferry: from x 0 (eastbound, flipped) or 240, x2 3 px a frame, gone 300 px out (frame 100)
  const withFerry = frames.filter((f) => f.x2 !== undefined);
  expect(withFerry.length).toBeGreaterThan(0);
  for (const f of withFerry) {
    expect(f.ferryX).toBe(eastbound ? 0 : 240);
    // (the anim's flip reaches the OAM in the first AnimateSprites, after the frame the sprite was made in)
    if (f.frames > 0) expect(f.hFlip).toBe(eastbound);
    expect(Math.abs(f.x2!)).toBeLessThanOrEqual(300);
  }
  expect(frames.some((f) => f.frames > 100 && f.x2 === undefined)).toBe(true);
  expect(frames.some((f) => f.wakes > 0)).toBe(true);
}

/** The Seagallop object on the field from when it appears until the ferry scene starts: where it came and stopped. */
export function watchSeagallopObject(game: Game) {
  // Read inside the predicate, tick by tick: after an `await` the page may be a whole frame batch further on.
  return game.eval(async (t) => {
    type Obj = { graphicsId?: string; x: number; y: number };
    let start: { x: number; y: number } | undefined;
    let end: { x: number; y: number } | undefined;
    await t.until(() => {
      const b = (t.objects() as Obj[]).find((o) => o.graphicsId === 'OBJ_EVENT_GFX_SEAGALLOP');
      if (b) {
        start ??= { x: b.x, y: b.y };
        end = { x: b.x, y: b.y };
      }
      return start !== undefined && t.seagallop() !== undefined;
    }, 40000);
    return { start, end };
  });
}

/** Vermilion after the S.S. Anne left, with the Tri-Pass (Celio's scene done) and Bill's trip over. */
export async function triPassState(game: Game) {
  await game.eval((t) => {
    t.state!.setVar('VAR_MAP_SCENE_VERMILION_CITY', 3);
    t.state!.setVar('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F', 3);
    t.state!.setVar('VAR_MAP_SCENE_CINNABAR_ISLAND', 4);
    t.state!.setVar('VAR_MAP_SCENE_ONE_ISLAND_HARBOR', 3);
    t.state!.bag.add(t.define('ITEM_TRI_PASS'), 1);
    t.state!.setFlag('FLAG_SYS_SEVII_MAP_123', true);
  });
}

/**
 * From (23, 31) down onto Vermilion's ticket check at (23, 33). The step onto (23, 32) runs ExitedTicketCheck
 * (VAR_TEMP_1 is 0 after the load), which eats the next step while it locks the field.
 */
export async function toTicketCheck(game: Game) {
  const since = await game.mark();
  await game.walk('down');
  await game.eval((t, s) => t.until(() => t.events(s).some((e) => e.type === 'script' && e.label === 'VermilionCity_EventScript_ExitedTicketCheck') && t.idle() && !t.field()!.script, 20000), since);
  expect(await game.walk('down')).toMatchObject({ x: 23, y: 33 });
}

/**
 * Until a multichoice menu opened since `since`: press A at each page break of the message before it (only while
 * the text waits for a button, so no press can reach the menu), then let it settle a few ticks. Returns its mcId.
 * `pressPages` false for a menu with no message before it (the message box of the last one still waits).
 */
export async function waitForMenu(game: Game, since: number, pressPages = true) {
  if (pressPages) await game.eval(async (t, s) => {
    const box = (window as any).game.scene.getScene('Overworld').messageBox;
    for (let i = 0; i < 2000 && !t.events(s).some((e) => e.type === 'multichoice'); i++) {
      if (box.waitingForButton) await t.press('A');
      else await t.waitFrames(1);
    }
  }, since);
  const e = await game.waitForEvent('multichoice', { since });
  await game.eval((t) => t.waitFrames(4));
  return e.mcId as number;
}

/**
 * At a Sevii harbor's arrival tile (8, 5) (sSeag), talk to the sailor below at (8, 6): "Where would you like to
 * sail?" and the menu. Returns the menu's mcId (MULTICHOICE_NONE for the Rainbow Pass menu).
 */
export async function talkToHarborSailor(game: Game) {
  await game.eval((t) => t.face('down'));
  const since = await game.mark();
  await game.press('A');
  return waitForMenu(game, since);
}

/**
 * The Sevii harbors' state: the Tri-Pass from Celio, Vermilion's dock open. `cinnabar` is
 * VAR_MAP_SCENE_CINNABAR_ISLAND (below 4: Bill's trip isn't over, the island sailors don't sail to Vermilion),
 * `onePc` VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F (5 and up: the Rainbow Pass).
 */
export async function harborState(game: Game, cinnabar: number, onePc: number) {
  await triPassState(game);
  await game.eval((t, c, o) => {
    t.state!.setVar('VAR_MAP_SCENE_CINNABAR_ISLAND', c);
    t.state!.setVar('VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F', o);
    if (o >= 5) t.state!.bag.add(t.define('ITEM_RAINBOW_PASS'), 1);
  }, cinnabar, onePc);
}

/**
 * After a destination is picked: mash through "All aboard SEAGALLOP HI-SPEED n!" (Vermilion's own text says 7 too),
 * checking n (GetSeagallopNumber), then ride. Returns the ride.
 */
export async function sail(game: Game, what: string, number: number) {
  await game.eval((_t, n) => ((window as any).__seagallopNumber = n), number);
  await game.mashUntil((t) => new RegExp(`HI-SPEED ${(window as any).__seagallopNumber}( will|!)`).test(t.message() ?? ''), { what: `${what}: HI-SPEED ${number}` });
  return rideFerry(game, what);
}
