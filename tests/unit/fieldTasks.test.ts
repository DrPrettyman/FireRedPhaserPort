import { beforeAll, describe, expect, test } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import { POSTGAME_SPECIALS } from '../../src/script/postgameSpecials';
import type { SpecialEnv } from '../../src/script/specials';
import { ActivatePerStepCallback, perStepCallbackProbe, SetUpFieldTasks, sIcefallCaveIceCoords, Task_RunPerStepCallback, type PerStepCallbackHost } from '../../src/world/fieldTasks';
import { newGame, readGen } from './gameData';

// field_tasks.c's per-step callback task (Task_RunPerStepCallback, IcefallCaveIcePerStepCallback), and the Four
// Island specials (field_specials.c's UpdateLoreleiDollCollection, StickerManGetBragFlags).

beforeAll(() => initConstants(readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines));

/** A field of thin ice everywhere (Icefall Cave 1F's puzzle), with the player at `pos`. */
function iceField() {
  const g = newGame();
  const pos = { x: 5, y: 17 };
  const grid = new Map<string, number>();
  const host: PerStepCallbackHost = {
    state: () => g.state,
    playerDestCoords: () => ({ ...pos }),
    metatileBehaviorAt: (x, y) => {
      const m = grid.get(`${x},${y}`);
      if (m === g.d('METATILE_SeafoamIslands_CrackedIce')) return g.d('MB_CRACKED_ICE');
      if (m === g.d('METATILE_SeafoamIslands_IceHole')) return g.d('MB_FALL_WARP');
      return g.d('MB_THIN_ICE');
    },
    setMetatileIdAt: (x, y, m) => grid.set(`${x},${y}`, m),
  };
  return { g, pos, grid, host, run: (n: number) => Array.from({ length: n }, () => Task_RunPerStepCallback(host)) };
}

describe('IcefallCaveIcePerStepCallback', () => {
  test('a step onto thin ice cracks it on the fifth frame after, marks FLAG_TEMP_n; a step back onto it breaks it', () => {
    const { g, pos, grid, host, run } = iceField();
    SetUpFieldTasks();
    expect(perStepCallbackProbe()).toEqual({ callbackId: g.d('STEP_CB_DUMMY'), state: 0 });
    ActivatePerStepCallback(g.d('STEP_CB_ICE'));
    run(1); // tState 0: the start position
    expect(perStepCallbackProbe().state).toBe(1);
    run(3); // no move, nothing
    const [x, y] = sIcefallCaveIceCoords[3]; // (8, 9): FLAG_TEMP_4
    Object.assign(pos, { x, y });
    run(1); // seen: tDelay 4
    expect(g.state.getFlag('FLAG_TEMP_4')).toBe(true);
    run(4);
    expect(grid.size).toBe(0);
    run(1);
    expect(grid.get(`${x},${y}`)).toBe(g.d('METATILE_SeafoamIslands_CrackedIce'));
    expect(g.state.getVar('VAR_TEMP_1')).toBe(0);
    // off and back on
    Object.assign(pos, { x: x + 1, y });
    run(6); // thin ice again elsewhere: (9, 9) is FLAG_TEMP_5
    expect(g.state.getFlag('FLAG_TEMP_5')).toBe(true);
    Object.assign(pos, { x, y });
    run(5);
    expect(grid.get(`${x},${y}`)).toBe(g.d('METATILE_SeafoamIslands_CrackedIce'));
    run(1);
    expect(grid.get(`${x},${y}`)).toBe(g.d('METATILE_SeafoamIslands_IceHole'));
    expect(g.state.getVar('VAR_TEMP_1')).toBe(1);
  });

  test('ice off sIcefallCaveIceCoords cracks without a flag; an out-of-range id is STEP_CB_DUMMY', () => {
    const { g, pos, grid, run } = iceField();
    SetUpFieldTasks();
    ActivatePerStepCallback(g.d('STEP_CB_ICE'));
    run(1);
    pos.y++;
    run(6);
    expect(grid.size).toBe(1);
    for (let i = 1; i <= 9; i++) expect(g.state.getFlag(i)).toBe(false);
    ActivatePerStepCallback(99);
    expect(perStepCallbackProbe().callbackId).toBe(g.d('STEP_CB_DUMMY'));
  });

  test('SetIcefallCaveCrackedIceMetatiles cracks the ice whose temp flag is set', () => {
    const g = newGame();
    const set: [number, number, number, boolean][] = [];
    g.state.setFlag('FLAG_TEMP_1', true);
    g.state.setFlag('FLAG_TEMP_9', true);
    POSTGAME_SPECIALS.SetIcefallCaveCrackedIceMetatiles({ state: g.state, host: { setMetatile: (...a: [number, number, number, boolean]) => set.push(a) } } as unknown as SpecialEnv);
    const cracked = g.d('METATILE_SeafoamIslands_CrackedIce');
    expect(set).toEqual([
      [8, 3, cracked, false],
      [8, 14, cracked, false],
    ]);
  });
});

describe('Four Island specials', () => {
  const env = (g: ReturnType<typeof newGame>) => ({ state: g.state }) as unknown as SpecialEnv;

  test('UpdateLoreleiDollCollection: a doll every 25 Hall of Fame entries from 25', () => {
    const dolls = [
      'FLAG_HIDE_LORELEI_HOUSE_MEOWTH_DOLL',
      'FLAG_HIDE_LORELEI_HOUSE_CHANSEY_DOLL',
      'FLAG_HIDE_LORELEIS_HOUSE_NIDORAN_F_DOLL',
      'FLAG_HIDE_LORELEI_HOUSE_JIGGLYPUFF_DOLL',
      'FLAG_HIDE_LORELEIS_HOUSE_NIDORAN_M_DOLL',
      'FLAG_HIDE_LORELEIS_HOUSE_FEAROW_DOLL',
      'FLAG_HIDE_LORELEIS_HOUSE_PIDGEOT_DOLL',
      'FLAG_HIDE_LORELEIS_HOUSE_LAPRAS_DOLL',
    ];
    for (const [hof, shown] of [
      [24, 0],
      [25, 1],
      [74, 2],
      [125, 5],
      [200, 8],
      [999, 8],
    ]) {
      const g = newGame();
      for (const f of dolls) g.state.setFlag(f, true); // EventScript_ResetAllMapFlags
      g.state.setGameStat(g.d('GAME_STAT_ENTERED_HOF'), hof);
      POSTGAME_SPECIALS.UpdateLoreleiDollCollection(env(g));
      expect(dolls.map((f) => !g.state.getFlag(f))).toEqual(dolls.map((_, i) => i < shown));
    }
  });

  test('StickerManGetBragFlags: the three stats into VAR_0x8004-6, a bit for each that is not 0', () => {
    const g = newGame();
    expect(POSTGAME_SPECIALS.StickerManGetBragFlags(env(g))).toBe(0);
    g.state.setGameStat(g.d('GAME_STAT_ENTERED_HOF'), 3);
    expect(POSTGAME_SPECIALS.StickerManGetBragFlags(env(g))).toBe(1);
    g.state.setGameStat(g.d('GAME_STAT_HATCHED_EGGS'), 0x12345);
    g.state.setGameStat(g.d('GAME_STAT_LINK_BATTLE_WINS'), 7);
    expect(POSTGAME_SPECIALS.StickerManGetBragFlags(env(g))).toBe(7);
    expect(['VAR_0x8004', 'VAR_0x8005', 'VAR_0x8006'].map((v) => g.state.getVar(v))).toEqual([3, 0xffff, 7]);
  });
});
