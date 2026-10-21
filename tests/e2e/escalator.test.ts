// The Pokémon Centers' escalators (world/escalator.ts): field_control_avatar.c's TryStartWarpEventScript escalator
// branch → DoEscalatorWarp, field_effect.c's escalator warp (EscalatorWarpEffect_1-6, FieldCB_EscalatorWarpIn,
// EscalatorWarpInEffect_1-7) and special_field_anim.c's Task_DrawEscalator. Every FRLG Pokémon Center has the same
// escalator: 1F (1, 6) is MB_UP_ESCALATOR (warp 3) to 2F (1, 6), MB_DOWN_ESCALATOR (warp 0), and back.
//
// The frame counts below come from the C, worked through by hand:
// - Out: EscalatorWarpEffect_1 starts the steps (StartEscalator draws their first section at once); _2 faces the
//   player the way they walked and plays SE_ESCALATOR a frame later; _3 / _5 move the sprite a pixel every 2 frames
//   and start the fade on their 7th frame (data[2] > 3): the fade starts 8 frames after the steps.
// - The steps: Task_DrawEscalator (priority 0) sets one section a frame (states 0-6, state 7 nothing) and draws the
//   view on the 8th; going up from 1F, stage 0 turns the Bottom section (state 3: (1, 6)) from _Normal to
//   _Transition1, in the grid on the 4th run and on screen on the 8th; BottomNext (state 2: (0, 6)) gets
//   MAPGRID_COLLISION_MASK.
// - In: EscalatorWarpInEffect_1 starts the steps and runs on into _2 / _4 (data[1] = 16); the draw task, created
//   after the warp-in task with the same priority, runs a second time that frame. _3 / _5 count data[1] down every
//   2 frames: 0 after 31 more frames. _6 waits for IsEscalatorMoving: the draw task's 40th run (5 stages of 8, the
//   last one LAST_ESCALATOR_STAGE) is at the warp-in's 39th frame after the start, read there by _6 (it runs first)
//   and _7, whose face east is long over, gives the controls back and walks the player off east that frame.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const SINE: number[] = JSON.parse(readFileSync(resolve(__dirname, '../../public/gen/battle/tables.json'), 'utf8')).mech.gSineTable;
/** trig.c's Sin / Cos (s16) */
const sin = (i: number, a: number) => (a * SINE[i]) >> 8;
const cos = (i: number, a: number) => (a * SINE[i + 64]) >> 8;

const session = useGame();

type Tick = {
  frame: number;
  map: string;
  x: number;
  y: number;
  x2: number;
  y2: number;
  locked: boolean;
  esc?: { state: number; transitionStage: number; goingUp: boolean; drawing: boolean };
  cell?: { metatile: number; collision: number; drawn: boolean };
  next?: { metatile: number; collision: number; drawn: boolean };
};

/**
 * Walk left onto the escalator and watch each tick (as the end of the previous tick left it) until the ride is
 * over and the player has stepped off east. Returns the ticks and the ride's events.
 */
async function ride(game: Game) {
  const since = await game.mark();
  const watch = game.eval(async (t, since) => {
    const ticks: Tick[] = [];
    const ok = await t.until(() => {
      const f = t.field();
      if (!f) return false;
      ticks.push({
        frame: t.frame() - 1,
        map: f.map,
        x: f.x,
        y: f.y,
        x2: f.avatar.spriteX2,
        y2: f.avatar.spriteY2,
        locked: f.locked,
        esc: f.escalator,
        cell: t.metatileAt(1, 6),
        next: t.metatileAt(0, 6),
      });
      return t.events(since).some((e) => e.type === 'escalatorDone') && !f.moving;
    }, 20000);
    return { ok, ticks };
  }, since);
  await game.walk('left');
  const { ok, ticks } = await watch;
  expect(ok).toBe(true);
  const events = await game.events(since);
  const at = (type: string, n = 0) => events.filter((e) => e.type === type)[n]?.frame as number;
  const tick = (frame: number) => ticks.find((k) => k.frame === frame)!;
  return { ticks, events, at, tick };
}

test('up the escalator to 2F and back down: the warps, the steps moving, the ride in GBA frames', async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity_PokemonCenter_1F', x: 2, y: 6 });
  const d = (name: string) => game.eval((t, n) => t.define(n), name);
  await game.waitIdle();
  const [UP, DOWN, BOTTOM_N, BOTTOM_T1, TOP_N, TOP_T2, BOTTOMNEXT_N, BOTTOMNEXT_T1] = await Promise.all(
    [
      'MB_UP_ESCALATOR',
      'MB_DOWN_ESCALATOR',
      'METATILE_PokemonCenter_Escalator_Bottom_Normal',
      'METATILE_PokemonCenter_Escalator_Bottom_Transition1',
      'METATILE_PokemonCenter_Escalator_Top_Normal',
      'METATILE_PokemonCenter_Escalator_Top_Transition2',
      'METATILE_PokemonCenter_Escalator_BottomNext_Normal',
      'METATILE_PokemonCenter_Escalator_BottomNext_Transition1',
    ].map(d),
  );
  expect(UP).not.toBe(DOWN);
  expect((await game.eval((t) => t.metatileAt(1, 6)))!.metatile).toBe(BOTTOM_N);

  // ---- up: 1F (1, 6) → 2F (1, 6)
  const up = await ride(game);
  const S = up.at('escalatorStart');
  expect(up.events.find((e) => e.type === 'escalatorWarp')).toMatchObject({ up: true });
  // The fade starts 8 frames after the steps (EscalatorWarpEffect_3's 7th frame), or later the first time: the port
  // loads 2F's header (SetupWarp) before the fade (see the second ride below)
  expect(up.at('escalatorFadeOut') - S).toBeGreaterThanOrEqual(8);
  // The steps: (1, 6) is _Transition1 in the grid on the draw task's 4th run, on screen on its 8th
  expect(up.tick(S + 2).cell).toEqual({ metatile: BOTTOM_N, collision: 0, drawn: true });
  expect(up.tick(S + 3).cell).toMatchObject({ metatile: BOTTOM_T1, drawn: false });
  expect(up.tick(S + 6).cell).toMatchObject({ metatile: BOTTOM_T1, drawn: false });
  expect(up.tick(S + 7).cell).toMatchObject({ metatile: BOTTOM_T1, drawn: true });
  // BottomNext (0, 6): its own collision, then _Transition1 | MAPGRID_COLLISION_MASK on the 3rd run
  expect(up.tick(S + 1).next).toMatchObject({ metatile: BOTTOMNEXT_N, collision: 1 });
  expect(up.tick(S + 2).next).toMatchObject({ metatile: BOTTOMNEXT_T1, collision: 3 });
  // The sprite: still on Effect_2's frame, then up and left a pixel every 2 frames (Cos(0x84) / Sin(0x94))
  expect([up.tick(S + 1).x2, up.tick(S + 1).y2]).toEqual([0, 0]);
  for (let i = 0; i < 7; i++) {
    const shown = (i + 1) >> 1; // data[2] as Escalator_AnimatePlayerGoingDown's i-th frame draws it (then counts)
    expect([up.tick(S + 2 + i).x2, up.tick(S + 2 + i).y2]).toEqual([cos(0x84, shown), sin(0x94, shown)]);
  }
  expect(up.tick(S).locked).toBe(true);
  // On 2F: warp 0 at (1, 6), the steps run (going up: the down escalator's Top section from _Normal through
  // _Transition2 and back), then the step off east
  const S2 = up.at('escalatorStart', 1);
  expect(up.tick(S2).map).toBe('ViridianCity_PokemonCenter_2F');
  expect([up.tick(S2).x, up.tick(S2).y]).toEqual([1, 6]);
  expect(up.events.filter((e) => e.type === 'escalatorStart')[1]).toMatchObject({ goingUp: true });
  // EscalatorWarpInEffect_4 / _5: from 16 px down the escalator (Cos(0x7c) / Sin(0x76)), a pixel every 2 frames
  expect([up.tick(S2).x2, up.tick(S2).y2]).toEqual([cos(0x7c, 16), sin(0x76, 16)]);
  expect([up.tick(S2 + 1).x2, up.tick(S2 + 1).y2]).toEqual([cos(0x7c, 16), sin(0x76, 16)]); // drawn, then counted down
  expect([up.tick(S2 + 2).x2, up.tick(S2 + 2).y2]).toEqual([cos(0x7c, 15), sin(0x76, 15)]);
  expect([up.tick(S2 + 30).x2, up.tick(S2 + 30).y2]).toEqual([cos(0x7c, 1), sin(0x76, 1)]);
  expect([up.tick(S2 + 31).x2, up.tick(S2 + 31).y2]).toEqual([0, 0]);
  const tops = up.ticks.filter((k) => k.frame >= S2 && k.map === 'ViridianCity_PokemonCenter_2F').map((k) => k.cell!.metatile);
  expect(tops).toContain(TOP_T2);
  expect(up.at('escalatorStop', 1) - S2).toBe(39);
  expect(up.at('escalatorDone') - S2).toBe(39);
  expect(up.tick(S2 + 38).locked).toBe(true);
  expect(up.tick(S2 + 39).locked).toBe(false);
  expect(up.tick(S2 + 39).cell).toEqual({ metatile: TOP_N, collision: 0, drawn: true }); // at rest, _Normal again
  let f = (await game.eval((t) => t.field()))!;
  expect([f.map, f.x, f.y, f.facing]).toEqual(['ViridianCity_PokemonCenter_2F', 2, 6, 'right']);

  // ---- down: 2F (1, 6) → 1F (1, 6)
  const down = await ride(game);
  const D = down.at('escalatorStart');
  expect(down.events.find((e) => e.type === 'escalatorWarp')).toMatchObject({ up: false });
  expect(down.at('escalatorFadeOut') - D).toBeGreaterThanOrEqual(8);
  // EscalatorWarpEffect_5: down and left (Escalator_AnimatePlayerGoingUp: Cos(0x7c) / Sin(0x76))
  expect([down.tick(D + 8).x2, down.tick(D + 8).y2]).toEqual([cos(0x7c, 3), sin(0x76, 3)]);
  const D2 = down.at('escalatorStart', 1);
  expect(down.events.filter((e) => e.type === 'escalatorStart')[1]).toMatchObject({ goingUp: false });
  expect(down.tick(D2).map).toBe('ViridianCity_PokemonCenter_1F');
  expect([down.tick(D2).x2, down.tick(D2).y2]).toEqual([cos(0x84, 16), sin(0x94, 16)]);
  expect(down.at('escalatorDone') - D2).toBe(39);
  expect(down.tick(D2 + 39).cell).toEqual({ metatile: BOTTOM_N, collision: 0, drawn: true });
  f = (await game.eval((t) => t.field()))!;
  expect([f.map, f.x, f.y, f.facing]).toEqual(['ViridianCity_PokemonCenter_1F', 2, 6, 'right']);
  await game.waitIdle();

  // ---- up again, 2F's header loaded: the fade starts on EscalatorWarpEffect_3's 7th frame
  const again = await ride(game);
  expect(again.at('escalatorFadeOut') - again.at('escalatorStart')).toBe(8);
  expect(again.tick(again.at('escalatorStart') + 8).x2).toBe(cos(0x84, 3));
  f = (await game.eval((t) => t.field()))!;
  expect([f.map, f.x, f.y]).toEqual(['ViridianCity_PokemonCenter_2F', 2, 6]);
});

/** START → SAVE → YES (a new file: no overwrite question), then wait for the field (questLog.test.ts). */
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
  await game.waitFor((t) => /saved the game/.test(t.message() ?? ''), { what: 'the saved message' });
  await game.waitIdle();
}

test('a recorded escalator ride: QuestLog_OnEscalatorWarp records the ride without its frames, and CONTINUE plays it back', async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity_PokemonCenter_1F', x: 2, y: 6 });
  await game.waitIdle();
  const [RECORDING, RECORDING_NO_DELAY, RUNNING, ACTION_END, PLAYBACK] = await game.eval((t) =>
    ['QL_PLAYBACK_STATE_RECORDING', 'QL_PLAYBACK_STATE_RECORDING_NO_DELAY', 'QL_PLAYBACK_STATE_RUNNING', 'QL_PLAYBACK_STATE_ACTION_END', 'QL_STATE_PLAYBACK'].map((n) =>
      t.define(n),
    ),
  );
  // A scene starts standing in place (QL_START_NORMAL)
  await game.eval((t) => t.questLogEvent('QL_EVENT_ARRIVED', { mapSec: t.define('MAPSEC_VIRIDIAN_CITY') }));
  expect((await game.eval((t) => t.questLog())).playbackState).toBe(RECORDING);
  // QL_ESCALATOR_OUT: an empty action closes the frames so far and the ride counts none (RECORDING_NO_DELAY);
  // QL_ESCALATOR_IN: RECORDING again
  const states = game.eval(async (t) => {
    const seen: number[] = [];
    await t.until(() => {
      const s = t.questLog().playbackState;
      if (seen[seen.length - 1] !== s) seen.push(s);
      return t.events().some((e) => e.type === 'escalatorDone') && !t.field()!.moving;
    }, 20000);
    return seen;
  });
  const ride1 = await ride(game);
  expect(await states).toEqual([RECORDING, RECORDING_NO_DELAY, RECORDING]);
  expect(ride1.tick(ride1.at('escalatorDone')).map).toBe('ViridianCity_PokemonCenter_2F');
  await save(game);
  const saved = (await game.eval((t) => t.field()))!;
  expect([saved.map, saved.x, saved.y]).toEqual(['ViridianCity_PokemonCenter_2F', 2, 6]);

  // CONTINUE: the scene starts on 1F at (2, 6), the recorded step and input start the escalator; QL_ESCALATOR_OUT
  // holds the actions (ACTION_END) until QL_ESCALATOR_IN lets them run again
  await game.load({ keepSave: true, mainMenu: true });
  const watch = game.eval(
    async (t, PLAYBACK) => {
      const seen: { map: string; x: number; y: number; playbackState: number; frame: number }[] = [];
      let scene0End: { map: string; x: number; y: number } | undefined;
      const ok = await t.until(() => {
        const f = t.field();
        if (!f) return false; // (the main menu)
        const ql = t.questLog();
        if (ql.state === PLAYBACK && f.map) {
          seen.push({ map: f.map, x: f.x, y: f.y, playbackState: ql.playbackState, frame: t.frame() - 1 });
          if (ql.playback.control.endMode === 2 && !f.busy && !scene0End) scene0End = { map: f.map, x: f.x, y: f.y };
        }
        return seen.length > 0 && !ql.playback.active;
      }, 30000);
      return { ok, seen, scene0End };
    },
    PLAYBACK,
  );
  const since = await game.mark();
  await game.waitFor((t) => t.mainMenu() && !t.mainMenu()!.fading, { what: 'the main menu' });
  await game.press('A');
  const played = await watch;
  expect(played.ok).toBe(true);
  expect(played.seen[0]).toMatchObject({ map: 'ViridianCity_PokemonCenter_1F', x: 2, y: 6 });
  const events = await game.events(since);
  const at = (type: string, n = 0) => events.filter((e) => e.type === type)[n]?.frame as number;
  expect(events.find((e) => e.type === 'escalatorWarp')).toMatchObject({ up: true });
  const S = at('escalatorStart');
  const S2 = at('escalatorStart', 1);
  expect(at('escalatorDone') - S2).toBe(39);
  const during = played.seen.filter((k) => k.frame >= S && k.frame < at('escalatorDone'));
  expect(during.length).toBeGreaterThan(0);
  expect(new Set(during.map((k) => k.playbackState))).toEqual(new Set([ACTION_END]));
  expect(played.seen.find((k) => k.frame === at('escalatorDone'))?.playbackState).toBe(RUNNING);
  expect(played.seen.some((k) => k.map === 'ViridianCity_PokemonCenter_2F' && k.x === 2 && k.y === 6)).toBe(true);
  expect(played.scene0End).toEqual({ map: 'ViridianCity_PokemonCenter_2F', x: 2, y: 6 });
  // Then the saved field
  await game.waitIdle();
  const f = (await game.eval((t) => t.field()))!;
  expect([f.map, f.x, f.y]).toEqual(['ViridianCity_PokemonCenter_2F', 2, 6]);
});
