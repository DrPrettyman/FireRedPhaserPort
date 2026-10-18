// The S.S. Anne (W-ssanne): Vermilion's ticket check (VermilionCity_EventScript_CheckTicket*), the departure
// cutscene (ss_anne.c's DoSSAnneDepartureCutscene, from SSAnne_Exterior_ExitSSAnne) and Vermilion's dock once the
// ship has left (VAR_MAP_SCENE_VERMILION_CITY 3). story.test.ts plays the whole visit (the rival, the captain);
// this file checks the pieces around it.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC', 'CUT'] };

/** Run the next script to its end, pressing A; returns the field messages it showed and the script's label. */
async function runScript(game: Game): Promise<{ script?: string; messages: string[] }> {
  return game.eval((t) => {
    let script: string | undefined;
    return t
      .mash((tt: typeof t) => {
        script ??= tt.field()?.script;
        return !!script && tt.idle() && !tt.field()?.script;
      }, 'A', 6000, [])
      .then((m) => ({ script, messages: m.messages.map((s) => s.replace(/\s+/g, ' ')) }));
  });
}

/** Walk one tile `dir` (a coord event may start a script on arrival). */
async function step(game: Game, dir: 'up' | 'down' | 'left' | 'right'): Promise<void> {
  await game.eval((t, d) => t.walk(d, 1), dir);
}

const sailor = (game: Game) => game.eval((t) => t.objects().find((o) => o.x === 24 && o.y === 33 && o.graphicsId === 'OBJ_EVENT_GFX_SAILOR'));

for (const x of [22, 23]) {
  test(`The ticket check at (${x}, 33) without the S.S. Ticket: refused, back up the pier`, async () => {
    const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x, y: 32, party: [MEWTWO] });
    expect((await sailor(game))?.facing).toBe('up');
    // The sailor and the player turn to each other (Common_Movement_WalkInPlaceFaster*), in the page: it's short.
    const turned = game.watch((t) => {
      const s = t.objects().find((o) => o.x === 24 && o.y === 33);
      return s?.facing === 'left' && t.field()!.facing === 'right' && t.field()!.y === 33;
    });
    const since = await game.mark();
    await step(game, 'down');
    const r = await runScript(game);
    await turned;
    expect(r.script).toBe(x === 22 ? 'VermilionCity_EventScript_CheckTicketLeft' : 'VermilionCity_EventScript_CheckTicketRight');
    expect(r.messages).toEqual([
      'Welcome to the S.S. ANNE! Excuse me, do you have a ticket?',
      expect.stringMatching(/^PLAYER doesn’t have the needed S\.S\. TICKET\. Sorry! You need a ticket to get aboard\.$/),
    ]);
    // VermilionCity_EventScript_WalkUpPier: the sailor faces up again, the player walks up a tile.
    expect(await game.eval((t) => t.field()!)).toMatchObject({ map: 'VermilionCity', x, y: 32 });
    expect((await sailor(game))?.facing).toBe('up');
    expect(await game.eval((t) => t.var('VAR_VERMILION_CITY_TICKET_CHECK_TRIGGER'))).toBe(0);
    // The player's walk_up isn't a step of their own, so (x, 32)'s ExitedTicketCheck didn't run.
    const scripts = await game.eval((t, s) => t.events(s).filter((e) => e.type === 'script').map((e) => e.label), since);
    expect(scripts).not.toContain('VermilionCity_EventScript_ExitedTicketCheck');
  });
}

test('The ticket check with the S.S. Ticket: let through, aboard; walking away resets the trigger', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 22, y: 32, party: [MEWTWO] });
  await game.eval((t) => t.state!.setFlag('FLAG_GOT_SS_TICKET'));
  await step(game, 'down');
  const r = await runScript(game);
  expect(r.script).toBe('VermilionCity_EventScript_CheckTicketLeft');
  expect(r.messages).toEqual(['Welcome to the S.S. ANNE! Excuse me, do you have a ticket?', 'PLAYER flashed the S.S. TICKET! Great! Welcome to the S.S. ANNE!']);
  expect(await game.eval((t) => t.var('VAR_VERMILION_CITY_TICKET_CHECK_TRIGGER'))).toBe(1);
  expect(await game.eval((t) => t.field()!)).toMatchObject({ x: 22, y: 33 });

  // With the trigger at 1, the other column doesn't check again.
  await step(game, 'right');
  expect(await game.eval((t) => [t.field()!.x, t.field()!.y, t.field()!.script ?? null])).toEqual([23, 33, null]);

  // Walking back up the pier: VermilionCity_EventScript_ExitedTicketCheck at (23, 32) resets the trigger.
  await step(game, 'up');
  await game.waitIdle();
  expect(await game.eval((t) => t.var('VAR_VERMILION_CITY_TICKET_CHECK_TRIGGER'))).toBe(0);

  // Checked again, then down the gangway onto the S.S. Anne's dock (SSAnne_Exterior's warp 1).
  await step(game, 'down');
  await runScript(game);
  expect(await game.eval((t) => t.var('VAR_VERMILION_CITY_TICKET_CHECK_TRIGGER'))).toBe(1);
  const since = await game.mark();
  await step(game, 'down');
  await game.eval((t) => t.enterWarp()); // (23, 34) is an arrow warp: keep pushing down
  await game.waitForEvent('map', { since, what: 'SSAnne_Exterior' });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!)).toMatchObject({ map: 'SSAnne_Exterior', x: 32, y: 5 });
  // The ship is there (FLAG_HIDE_SS_ANNE is clear until it sails).
  expect(await game.eval((t) => t.objects().some((o) => o.graphicsId === 'OBJ_EVENT_GFX_SS_ANNE'))).toBe(true);
});

test('The departure: the ship sails off left with its wake and smoke, and the script waits for it', async () => {
  // Where the S.S. Anne's 1F corridor lets the player out (SSAnne_Exterior's warp 2), with HM01 got.
  const game = await session.start({ start: 'after-rival', map: 'SSAnne_Exterior', x: 32, y: 14, party: [MEWTWO] });
  await game.eval((t) => t.state!.setFlag('FLAG_GOT_HM01'));
  const boat = await game.eval((t) => t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_SS_ANNE')!);
  expect(boat).toMatchObject({ x: 30, y: 16 });

  // Watch the cutscene in the page, tick by tick: the boat's x2 and drawn position, the wake and smoke sprites,
  // and that nothing after the `waitstate` runs before Task_SSAnneFinish's ScriptContext_Enable.
  const watch = game.eval((t) => {
    const seen = {
      startX: undefined as number | undefined,
      x2s: [] as number[],
      drawnOk: true,
      wakeFrames: 0,
      wakeImages: new Set<number>(),
      wakeBehind: true,
      smokeCreated: 0,
      smokeImages: new Set<number>(),
      maxSmoke: 0,
      doneFrames: 0,
      earlyExit: false,
      boatGoneAfterDone: false,
    };
    let done = false;
    return t
      .until(() => {
        const p = t.ssAnne();
        const f = t.field()!;
        const boatObj = t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_SS_ANNE');
        if (p && p.state !== 'done') {
          seen.startX ??= p.boatScreenX;
          if (seen.x2s[seen.x2s.length - 1] !== p.boatX2) seen.x2s.push(p.boatX2);
          if (p.boatSpriteX !== p.boatScreenX) seen.drawnOk = false;
          if (p.wake.length) {
            seen.wakeFrames++;
            for (const w of p.wake) {
              seen.wakeImages.add(w.image);
              if (w.x !== p.boatScreenX! + 80 || !w.visible) seen.wakeBehind = false;
            }
          }
          for (const s of p.smoke) seen.smokeImages.add(s.image);
          seen.maxSmoke = Math.max(seen.maxSmoke, p.smoke.length);
          seen.smokeCreated = p.smokeCreated;
          // the script waits: the player stays put and the boat stays on the map
          if (f.map !== 'SSAnne_Exterior' || f.x !== 32 || f.y !== 14 || !boatObj) seen.earlyExit = true;
        }
        if (p?.state === 'done' && !done) {
          done = true;
          seen.doneFrames = p.frames;
        }
        if (done && !boatObj) seen.boatGoneAfterDone = true;
        return seen.boatGoneAfterDone;
      }, 20000)
      .then(() => ({ ...seen, wakeImages: [...seen.wakeImages], smokeImages: [...seen.smokeImages] }));
  });
  const since = await game.mark();
  await game.eval((t) => t.state!.setVar('VAR_MAP_SCENE_VERMILION_CITY', 1));
  const seen = await watch;

  // The boat's sprite starts at screen x 88 (the player on (32, 14) is at 120, the boat's tile two to the left)
  // and moves a pixel left every 5 frames (x2 = -(data[2] / 5)) until x + x2 < -120.
  expect(seen.startX).toBe(88);
  expect(seen.x2s[0]).toBe(0);
  expect(seen.x2s[seen.x2s.length - 1]).toBe(-(88 + 121));
  expect(seen.x2s.every((x, i) => i === 0 || x === seen.x2s[i - 1] - 1)).toBe(true);
  expect(seen.drawnOk).toBe(true);
  // 50 frames before the wake, then 5 frames a pixel until off screen and one more to see it, then 40 frames.
  expect(seen.doneFrames).toBe(50 + 5 * (88 + 121) + 1 + 40);
  // The wake follows 80 px behind the boat and alternates its two frames; a puff of smoke every 70 frames while
  // the funnel is on screen (boat x + 49 >= -32), each one gone once its anim ends (80 frames).
  expect(seen.wakeFrames).toBeGreaterThan(500);
  expect(seen.wakeBehind).toBe(true);
  expect(seen.wakeImages.sort()).toEqual([0, 1]);
  // run frames 70, 140, ... while 88 - floor(frame / 5) + 49 >= -32: frame <= 845
  expect(seen.smokeCreated).toBe(Math.floor(845 / 70));
  expect(seen.smokeImages.sort()).toEqual([0, 1, 2, 3]);
  expect(seen.maxSmoke).toBe(2);
  expect(seen.earlyExit).toBe(false);
  expect(seen.boatGoneAfterDone).toBe(true);

  // Then `removeobject LOCALID_SS_ANNE` (which sets FLAG_HIDE_SS_ANNE), the walk up the pier and the warp.
  expect(await game.eval((t) => t.flag('FLAG_HIDE_SS_ANNE'))).toBe(true);
  await game.waitForEvent('map', { since, what: 'VermilionCity', timeout: 60_000 });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!)).toMatchObject({ map: 'VermilionCity', x: 23, y: 32 });
  expect(await game.eval((t) => [t.var('VAR_MAP_SCENE_VERMILION_CITY'), t.var('VAR_VERMILION_CITY_TICKET_CHECK_TRIGGER')])).toEqual([3, 0]);
  expect(await game.eval((t) => t.ssAnne()?.state)).toBe('done');
}, 120_000);

test('Vermilion once the S.S. Anne has left: the dock sailor, the old man, the sailor on the pier', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 23, y: 32, party: [MEWTWO] });
  await game.eval((t) => {
    t.state!.setFlag('FLAG_GOT_SS_TICKET');
    t.state!.setFlag('FLAG_GOT_HM01');
    t.state!.setFlag('FLAG_HIDE_SS_ANNE');
    t.state!.setVar('VAR_MAP_SCENE_VERMILION_CITY', 3);
  });
  // VermilionCity_EventScript_CheckSeagallopPresentTrigger: no Tri-Pass yet, "The ship set sail.", back up.
  await step(game, 'down');
  const r = await runScript(game);
  expect(r.script).toBe('VermilionCity_EventScript_CheckTicketRight');
  expect(r.messages).toEqual(['The ship set sail.']);
  expect(await game.eval((t) => t.field()!)).toMatchObject({ x: 23, y: 32 });
  expect(await game.eval((t) => t.var('VAR_VERMILION_CITY_TICKET_CHECK_TRIGGER'))).toBe(0);
});
