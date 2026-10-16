// Battle anim scripts: the ported sprite callbacks and tasks cover the scripts we expect to run.
// (Running them is checked end to end in tests/e2e/battleAnims.test.ts.)

import { beforeAll, describe, expect, test } from 'vitest';
import { battleAnimCoverage } from '../../src/battle/anim/battleAnim';
import { newBattleEnv } from './gameData';

let coverage: Record<string, string[]>;

beforeAll(async () => {
  await newBattleEnv();
  coverage = battleAnimCoverage();
});

describe('battle anim coverage', () => {
  test.each([
    'Move_POUND', 'Move_SCRATCH', 'Move_TACKLE', 'Move_GROWL', 'Move_TAIL_WHIP', 'Move_LEER', 'Move_EMBER',
    'Move_WATER_GUN', 'Move_VINE_WHIP', 'Move_BUBBLE', 'Move_THUNDER_SHOCK', 'Move_QUICK_ATTACK',
    'Move_SAND_ATTACK', 'Move_GUST', 'Move_PECK', 'Move_STRING_SHOT', 'Move_POISON_STING', 'Move_HARDEN',
    'Move_BITE', 'Move_SUPERSONIC', 'Move_ABSORB', 'Move_LEECH_SEED', 'Move_POISON_POWDER', 'Move_SLEEP_POWDER',
    'Move_STUN_SPORE', 'Move_THUNDER_WAVE', 'Move_FLAMETHROWER',
    'Status_Poison', 'Status_Confusion', 'Status_Burn', 'Status_Infatuation', 'Status_Sleep', 'Status_Paralysis',
    'Status_Freeze', 'Status_Curse', 'Status_Nightmare',
    'General_StatsChange', 'General_MonHit', 'General_BaitThrow', 'General_SafariRockThrow', 'General_SubstituteFade',
    'General_SubstituteAppear',
    // every special anim: InitAndLaunchSpecialAnimation has no fallback
    'Special_LevelUp', 'Special_SwitchOutPlayerMon', 'Special_SwitchOutOpponentMon', 'Special_BallThrow',
    'Special_BallThrowWithTrainer', 'Special_SubstituteToMon', 'Special_MonToSubstitute',
  ])('%s is fully ported', (label) => {
    expect(coverage[label]).toEqual([]);
  });

  test('every script resolves (no unknown commands or C symbols)', () => {
    // 355 moves (Move_NONE / Mirror Move / Pound share one script, as do a few others) + status,
    // general and special anims; building the coverage walks every script and template.
    expect(Object.keys(coverage).length).toBe(397);
  });
});
