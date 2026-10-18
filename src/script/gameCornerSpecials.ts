// The Game Corner's specials (W-slots), spread into SPECIALS like STORY_SPECIALS. No Phaser here.

import { GetRandomSlotMachineId } from '../menus/slotMachineLogic';
import type { Special } from './specials';

export const GAME_CORNER_SPECIALS: Record<string, Special> = {
  /** GetRandomSlotMachineId (field_specials.c): the machine's sReelBiasChances row, for `playslotmachine`. */
  GetRandomSlotMachineId() {
    return GetRandomSlotMachineId();
  },
};
