// vs_seeker.c's sRematches lookups (src/world/rematches.ts) on the extracted table. Expected parties are read
// off the decomp's sRematches rows and TryGetRematchTrainerIdGivenGameState's tiers by hand: a tier's party once
// its flag is set (FLAG_GOT_VS_SEEKER, FLAG_WORLD_MAP_CELADON_CITY, FLAG_WORLD_MAP_FUCHSIA_CITY,
// FLAG_SYS_GAME_CLEAR, FLAG_SYS_CAN_LINK_WITH_RS), otherwise one step down (past SKIPs).

import { describe, expect, test } from 'vitest';
import {
  GetNextAvailableRematchTrainer,
  GetRematchTrainerId,
  GetRunningBehaviorFromGraphicsId,
  IsTrainerReadyForRematch,
  LookupVsSeekerOpponentInArray,
  ShouldTryRematchBattle,
  type RematchEnv,
} from '../../src/world/rematches';
import { readGen } from './gameData';

const scripts = readGen<{ defines: Record<string, number>; rematches: number[][] }>('scripts/scripts.json');
const T = (name: string) => {
  const v = scripts.defines[`TRAINER_${name}`];
  if (v === undefined) throw new Error(`no TRAINER_${name}`);
  return v;
};

/** A game where `fought` trainers are beaten and `flags` are set. */
function env(fought: string[], flags: string[] = []): RematchEnv {
  const beaten = new Set(fought.map(T));
  return { rematches: scripts.rematches, hasTrainerBeenFought: (t) => beaten.has(t), flagGet: (f) => flags.includes(f) };
}

const TIERS = ['FLAG_GOT_VS_SEEKER', 'FLAG_WORLD_MAP_CELADON_CITY', 'FLAG_WORLD_MAP_FUCHSIA_CITY', 'FLAG_SYS_GAME_CLEAR', 'FLAG_SYS_CAN_LINK_WITH_RS'];

describe('GetRematchTrainerId', () => {
  // { YOUNGSTER_BEN, BEN_2, SKIP, BEN_3, BEN_4 }
  test('Ben: the next unbeaten party, once its tier is unlocked', () => {
    expect(GetRematchTrainerId(env(['YOUNGSTER_BEN'], TIERS), T('YOUNGSTER_BEN'))).toBe(T('YOUNGSTER_BEN_2'));
    expect(GetRematchTrainerId(env(['YOUNGSTER_BEN', 'YOUNGSTER_BEN_2'], TIERS), T('YOUNGSTER_BEN'))).toBe(T('YOUNGSTER_BEN_3'));
    expect(GetRematchTrainerId(env(['YOUNGSTER_BEN', 'YOUNGSTER_BEN_2', 'YOUNGSTER_BEN_3'], TIERS), T('YOUNGSTER_BEN'))).toBe(T('YOUNGSTER_BEN_4'));
    // all beaten: the last party again
    expect(GetRematchTrainerId(env(['YOUNGSTER_BEN', 'YOUNGSTER_BEN_2', 'YOUNGSTER_BEN_3', 'YOUNGSTER_BEN_4'], TIERS), T('YOUNGSTER_BEN'))).toBe(T('YOUNGSTER_BEN_4'));
  });

  test('Ben: a locked tier falls back one step, past the SKIP', () => {
    // no VS Seeker: tier 1 is locked, so the original party
    expect(GetRematchTrainerId(env(['YOUNGSTER_BEN']), T('YOUNGSTER_BEN'))).toBe(T('YOUNGSTER_BEN'));
    // BEN_3 is tier 3 (Fuchsia): without it, tier 2 is SKIP, so BEN_2
    expect(GetRematchTrainerId(env(['YOUNGSTER_BEN', 'YOUNGSTER_BEN_2'], ['FLAG_GOT_VS_SEEKER']), T('YOUNGSTER_BEN'))).toBe(T('YOUNGSTER_BEN_2'));
    // BEN_4 is tier 4 (the credits): one step down only, to BEN_3, whatever Fuchsia's flag says
    expect(GetRematchTrainerId(env(['YOUNGSTER_BEN', 'YOUNGSTER_BEN_2', 'YOUNGSTER_BEN_3'], ['FLAG_GOT_VS_SEEKER']), T('YOUNGSTER_BEN'))).toBe(T('YOUNGSTER_BEN_3'));
  });

  test('a trainer who repeats one party (Calvin: { CALVIN, CALVIN }), and one outside the table', () => {
    expect(GetRematchTrainerId(env(['YOUNGSTER_CALVIN'], TIERS), T('YOUNGSTER_CALVIN'))).toBe(T('YOUNGSTER_CALVIN'));
    expect(GetRematchTrainerId(env(['BUG_CATCHER_RICK'], TIERS), T('BUG_CATCHER_RICK'))).toBe(0);
  });

  test('Franklin ({ FRANKLIN, SKIP, FRANKLIN_2 }): tier 2 or nothing', () => {
    expect(GetNextAvailableRematchTrainer(env(['HIKER_FRANKLIN']), T('HIKER_FRANKLIN')).index).toBe(2);
    expect(GetRematchTrainerId(env(['HIKER_FRANKLIN'], TIERS), T('HIKER_FRANKLIN'))).toBe(T('HIKER_FRANKLIN_2'));
    // Celadon locked: down from 2 past the SKIP to the original
    expect(GetRematchTrainerId(env(['HIKER_FRANKLIN'], ['FLAG_GOT_VS_SEEKER']), T('HIKER_FRANKLIN'))).toBe(T('HIKER_FRANKLIN'));
  });
});

describe('the rematch specials', () => {
  test('LookupVsSeekerOpponentInArray finds any party of a row, ShouldTryRematchBattle only the original', () => {
    const ben = LookupVsSeekerOpponentInArray(scripts.rematches, T('YOUNGSTER_BEN'));
    expect(ben).toBeGreaterThanOrEqual(0);
    expect(LookupVsSeekerOpponentInArray(scripts.rematches, T('YOUNGSTER_BEN_3'))).toBe(ben);
    expect(LookupVsSeekerOpponentInArray(scripts.rematches, T('BUG_CATCHER_RICK'))).toBe(-1);
    // a beaten table trainer takes the rematch script; an unbeaten one only with a rematch state
    expect(ShouldTryRematchBattle(env(['YOUNGSTER_BEN']), T('YOUNGSTER_BEN'), false)).toBe(true);
    expect(ShouldTryRematchBattle(env([]), T('YOUNGSTER_BEN'), false)).toBe(false);
    expect(ShouldTryRematchBattle(env([]), T('YOUNGSTER_BEN'), true)).toBe(true);
    expect(ShouldTryRematchBattle(env(['BUG_CATCHER_RICK']), T('BUG_CATCHER_RICK'), true)).toBe(false);
    // IsTrainerReadyForRematch: the rematch party (gTrainerBattleOpponent_A after GetRematchTrainerId) and the state
    expect(IsTrainerReadyForRematch(env(['YOUNGSTER_BEN']), T('YOUNGSTER_BEN_2'), true)).toBe(true);
    expect(IsTrainerReadyForRematch(env(['YOUNGSTER_BEN']), T('YOUNGSTER_BEN_2'), false)).toBe(false);
  });

  test('GetRunningBehaviorFromGraphicsId', () => {
    expect(GetRunningBehaviorFromGraphicsId('OBJ_EVENT_GFX_YOUNGSTER')).toBe('MOVEMENT_TYPE_RAISE_HAND_AND_JUMP');
    expect(GetRunningBehaviorFromGraphicsId('OBJ_EVENT_GFX_SWIMMER_F_WATER')).toBe('MOVEMENT_TYPE_RAISE_HAND_AND_SWIM');
    expect(GetRunningBehaviorFromGraphicsId('OBJ_EVENT_GFX_GENTLEMAN')).toBe('MOVEMENT_TYPE_RAISE_HAND_AND_STOP');
  });
});
