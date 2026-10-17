// Story specials from field_specials.c that the main path between Brock and Lt. Surge needs (W-story unit 2).
// Kept apart from specials.ts so story workers can add theirs without touching each other's entries; SPECIALS
// spreads this table in. No Phaser here: specials that draw go through `registerSpecials` from their module.

import { random } from '../util/random';
import type { Special } from './specials';

/**
 * SetVermilionTrashCans (field_specials.c): picks Lt. Surge's two switch cans. VAR_0x8004 is a random can
 * (1-15, five per row); VAR_0x8005 one of its neighbours (left / right in the row, up / down a row).
 */
export function SetVermilionTrashCans(rand: () => number = random): { first: number; second: number } {
  const idx = (rand() % 15) + 1;
  const first = idx;
  let second = idx;
  switch (first) {
    case 1:
      second += rand() % 2 === 0 ? 1 : 5;
      break;
    case 2:
    case 3:
    case 4: {
      const r = rand() % 3;
      second += r === 0 ? 1 : r === 1 ? 5 : -1;
      break;
    }
    case 5:
      second += rand() % 2 === 0 ? 5 : -1;
      break;
    case 6: {
      const r = rand() % 3;
      second += r === 0 ? -5 : r === 1 ? 1 : 5;
      break;
    }
    case 7:
    case 8:
    case 9: {
      const r = rand() % 4;
      second += r === 0 ? -5 : r === 1 ? 1 : r === 2 ? 5 : -1;
      break;
    }
    case 10: {
      const r = rand() % 3;
      second += r === 0 ? -5 : r === 1 ? 5 : -1;
      break;
    }
    case 11:
      second += rand() % 2 === 0 ? -5 : 1;
      break;
    case 12:
    case 13:
    case 14: {
      const r = rand() % 3;
      second += r === 0 ? -5 : r === 1 ? 1 : -1;
      break;
    }
    case 15:
      second += rand() % 2 === 0 ? -5 : -1;
      break;
  }
  // Can't happen with the cases above (a bottom-row can never adds 5), but the C has it.
  if (second > 15) {
    if (first % 5 === 1) second = first + 1;
    else if (first % 5 === 0) second = first - 1;
    else second = first + 1;
  }
  return { first, second };
}

export const STORY_SPECIALS: Record<string, Special> = {
  /** SetVermilionTrashCans: VAR_0x8004 / VAR_0x8005 = the first / second switch can (VermilionCity_Gym). */
  SetVermilionTrashCans({ state }) {
    const { first, second } = SetVermilionTrashCans();
    state.setVar('VAR_0x8004', first);
    state.setVar('VAR_0x8005', second);
  },
};
