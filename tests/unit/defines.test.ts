// Defines: names, numbers and the constant expressions script arguments carry (GAS folds them).

import { expect, test } from 'vitest';
import { Defines } from '../../src/script/Defines';

test('Defines folds constant expressions over known names', () => {
  const d = new Defines({ MAX_COINS: 9999, NUM_TRAINER_FAN_CLUB_MEMBERS: 8 });
  expect(d.get('MAX_COINS')).toBe(9999);
  expect(d.get('0x10')).toBe(16);
  // EventScript_PkmnCenterNurse's multichoice: ignoreBPress FALSE, bit 1 set
  expect(d.get('FALSE | (TRUE << 1)')).toBe(2);
  expect(d.get('(MAX_COINS + 1) - 20')).toBe(9980);
  expect(d.get('(NUM_TRAINER_FAN_CLUB_MEMBERS - 1)')).toBe(7);
  expect(d.get('UNKNOWN_NAME + 1')).toBeUndefined();
  expect(d.get('SOME_LABEL')).toBeUndefined();
  expect(() => d.require('alert(1)')).toThrow();
});
