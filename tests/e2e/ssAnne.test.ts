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

/** Walk next to the object `graphicsId` that started near (x, y) (it may wander), face it and run its script. */
async function talkTo(game: Game, graphicsId: string, x: number, y: number): Promise<{ script?: string; messages: string[] }> {
  const sides = [[0, 1, 'up'], [0, -1, 'down'], [-1, 0, 'right'], [1, 0, 'left']] as const;
  for (let k = 0; k < 16; k++) {
    const o = await game.eval(
      (t, g, x, y) => t.objects().filter((o) => o.graphicsId === g).sort((a, b) => Math.abs(a.x - x) + Math.abs(a.y - y) - (Math.abs(b.x - x) + Math.abs(b.y - y)))[0],
      graphicsId,
      x,
      y,
    );
    const [dx, dy, face] = sides[k % 4];
    const r = await game.eval((t, x, y) => t.walkTo(x, y).catch(() => ({ arrived: false })), o.x + dx, o.y + dy);
    if (!r.arrived) continue;
    // (in one go: a wandering NPC may step away between two round trips)
    const facing = await game.eval(
      (t, g, ox, oy, dx, dy, face) => {
        const now = t.objects().find((p) => p.graphicsId === g && p.x === ox && p.y === oy && !p.moving);
        const f = t.field()!;
        if (!now || f.x !== ox + dx || f.y !== oy + dy) return false;
        t.face(face);
        return true;
      },
      graphicsId,
      o.x,
      o.y,
      dx,
      dy,
      face,
    );
    if (facing) return runScript(game);
  }
  throw new Error(`Couldn't get next to ${graphicsId} near (${x}, ${y})`);
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
  expect(await game.eval((t) => t.flag('FLAG_WORLD_MAP_SSANNE_EXTERIOR'))).toBe(true); // SSAnne_Exterior_OnTransition
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

  // The ferry sailor, the old man (VermilionCity_EventScript_OldMan1SSAnneLeft) and the sailor on the pier.
  expect((await talkTo(game, 'OBJ_EVENT_GFX_SAILOR', 24, 33)).messages).toEqual(['The ship set sail.']);
  expect((await talkTo(game, 'OBJ_EVENT_GFX_OLD_MAN_1', 17, 9)).messages).toEqual(['So, the S.S. ANNE has departed? She’ll be back in VERMILION about this time next year.']);
  expect((await talkTo(game, 'OBJ_EVENT_GFX_SAILOR', 31, 30)).messages).toEqual(['The S.S. ANNE is a famous luxury cruise ship. It visits VERMILION once a year.']);
});

test('Vermilion before the S.S. Anne has left: the old man and the ferry sailor talk about the ship', async () => {
  const game = await session.start({ start: 'after-rival', map: 'VermilionCity', x: 23, y: 30, party: [MEWTWO] });
  expect((await talkTo(game, 'OBJ_EVENT_GFX_SAILOR', 24, 33)).messages).toEqual(['Welcome to the S.S. ANNE!']);
  expect((await talkTo(game, 'OBJ_EVENT_GFX_OLD_MAN_1', 17, 9)).messages).toEqual(['Did you see the S.S. ANNE moored in the harbor?']);
});

// story.test.ts takes the middle column (31, 6); the other two triggers bring the rival to the player differently.
for (const [x, side, rivalAt] of [
  [30, 'Left', [30, 5]],
  [32, 'Right', [31, 6]],
] as const) {
  test(`The rival on 2F from the ${side.toLowerCase()} trigger (${x}, 6)`, async () => {
    const game = await session.start({ start: 'after-rival', map: 'SSAnne_2F_Corridor', x: 31, y: 9, party: [MEWTWO] });
    await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 500));
    expect(await game.eval((t) => t.objects().some((o) => o.graphicsId === 'OBJ_EVENT_GFX_BLUE'))).toBe(false);
    await game.eval((t, x) => t.walkTo(x, 7), x);
    // Where the rival stands when the battle starts (watched in the page: the scene moves on after it).
    const atBattle = game.watch((t) => {
      if (!t.battle()) return undefined;
      const r = t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_BLUE');
      return { rival: r && [r.x, r.y], facing: t.field()!.facing };
    });
    const since = await game.mark();
    await step(game, 'up');
    await game.mashUntil((t) => t.idle() && t.var('VAR_MAP_SCENE_S_S_ANNE_2F_CORRIDOR') !== 0, { what: 'the rival scene' });
    const scripts = await game.eval((t, s) => t.events(s).filter((e) => e.type === 'script').map((e) => e.label), since);
    expect(scripts[0]).toBe(`SSAnne_2F_Corridor_EventScript_RivalTrigger${side}`);
    const at = await atBattle;
    expect(at.rival).toEqual(rivalAt);
    if (side === 'Right') expect(at.facing).toBe('left'); // SSAnne_2F_Corridor_Movement_PlayerFaceRivalRight
    expect(await game.eval((t) => ['SQUIRTLE', 'BULBASAUR', 'CHARMANDER'].some((s) => t.trainerDefeated(`RIVAL_SS_ANNE_${s}`)))).toBe(true);
    // RivalExit*, then `removeobject` (FLAG_HIDE_SS_ANNE_RIVAL) and the scene var.
    expect(await game.eval((t) => t.objects().some((o) => o.graphicsId === 'OBJ_EVENT_GFX_BLUE'))).toBe(false);
    expect(await game.eval((t) => t.flag('FLAG_HIDE_SS_ANNE_RIVAL'))).toBe(true);
    expect(await game.eval((t) => t.field()!)).toMatchObject({ x, y: 6 });
  }, 120_000);
}

test('The captain: seasick with his back turned (`lock`, no `faceplayer`), turns once his back is rubbed; then "set sail soon"', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SSAnne_CaptainsOffice', x: 5, y: 5, party: [MEWTWO] });
  const captain = () => game.eval((t) => t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_CAPTAIN')!.facing);
  expect(await captain()).toBe('up');
  await game.eval((t) => t.face('up'));
  // Facing while each message shows (watched in the page).
  const facings = game.eval((t) => {
    const seen: [string, string][] = [];
    return t
      .until(() => {
        const m = t.message();
        const c = t.objects().find((o) => o.graphicsId === 'OBJ_EVENT_GFX_CAPTAIN')!.facing;
        if (m && seen[seen.length - 1]?.[0] !== m.slice(0, 20)) seen.push([m.slice(0, 20), c]);
        return t.flag('FLAG_GOT_HM01') && t.idle();
      }, 20000)
      .then(() => seen);
  });
  const r = await runScript(game);
  expect(r.messages[0]).toBe('CAPTAIN: Ooargh… I feel hideous… Urrp! Seasick…');
  const seen = await facings;
  expect(seen.find(([m]) => m.startsWith('CAPTAIN: Ooargh'))?.[1]).toBe('up');
  expect(seen.find(([m]) => m.startsWith('PLAYER rubbed'))?.[1]).toBe('up');
  expect(seen.find(([m]) => m.startsWith('CAPTAIN: Whew'))?.[1]).toBe('down');
  expect(await game.eval((t) => [t.itemCount('HM01'), t.var('VAR_MAP_SCENE_VERMILION_CITY')])).toEqual([1, 1]);

  // SSAnne_CaptainsOffice_EventScript_AlreadyGotCut
  await game.eval((t) => t.face('up'));
  const again = await runScript(game);
  expect(again.script).toBe('SSAnne_CaptainsOffice_EventScript_Captain');
  expect(again.messages[0]).toMatch(/^CAPTAIN: …Whew! Now that I’m not sick anymore, I guess it’s time\. The S\.S\. ANNE will set sail soon!/);
});

test('Back on the dock from Vermilion with the captain seen (e.g. after a Teleport): walked down to the ship, then it sails', async () => {
  // SSAnne_Exterior_ExitSSAnne's other branch: arriving at the top of the dock (y <= 6), SSAnne_Exterior_WalkDown.
  const game = await session.start({ start: 'after-rival', map: 'SSAnne_Exterior', x: 32, y: 5, party: [MEWTWO] });
  const since = await game.mark();
  const atStart = game.watch((t) => {
    const p = t.ssAnne();
    return p && p.state === 'init' && { x: t.field()!.x, y: t.field()!.y, boatScreenX: p.boatScreenX };
  });
  await game.eval((t) => {
    t.state!.setFlag('FLAG_GOT_HM01');
    t.state!.setVar('VAR_MAP_SCENE_VERMILION_CITY', 1);
  });
  expect(await atStart).toEqual({ x: 32, y: 14, boatScreenX: 88 });
  await game.waitForEvent('map', { since, what: 'VermilionCity', timeout: 60_000 });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()!)).toMatchObject({ map: 'VermilionCity', x: 23, y: 32 });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_VERMILION_CITY'))).toBe(3);
}, 120_000);
