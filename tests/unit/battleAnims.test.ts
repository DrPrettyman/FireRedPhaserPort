// Battle anim scripts: every one of the 397 is fully ported. (Running them is checked end to end in
// tests/e2e/battleAnims*.test.ts.)

import { beforeAll, describe, expect, test } from 'vitest';
import { battleAnimCoverage } from '../../src/battle/anim/battleAnim';
import { newBattleEnv } from './gameData';

let coverage: Record<string, string[]>;

beforeAll(async () => {
  await newBattleEnv();
  coverage = battleAnimCoverage();
});

describe('battle anim coverage', () => {
  test('every script is fully ported (every sprite callback and task it can reach is registered)', () => {
    const missing = Object.entries(coverage).filter(([, symbols]) => symbols.length > 0);
    expect(Object.fromEntries(missing)).toEqual({});
  });

  test('every script resolves (no unknown commands or C symbols)', () => {
    // 355 moves (Move_NONE / Mirror Move / Pound share one script, as do a few others) + status,
    // general and special anims; building the coverage walks every script and template.
    expect(Object.keys(coverage).length).toBe(397);
  });
});
