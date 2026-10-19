// pokemon_storage_system_tasks.c's SetPokeStorageQuestLogEvent, the part that picks the QL_EVENT_* and fills
// gStorage->questLogData: no screen state here, so the unit tests drive it (menus/pokemonStorage.ts gathers the
// inputs and records the event).

import { K } from '../battle/constants';
import type { QuestLogEventMovedBoxMon } from '../world/questLogEventCodecs';

export interface PokeStorageQuestLogInputs {
  /** GetMovingMonOriginalBoxId (TOTAL_BOXES_COUNT: the party) */
  box1: number;
  /** gStorage->displayMonSpecies (the moving mon) */
  species1: number;
  /** sInPartyMenu */
  inPartyMenu: boolean;
  /** TOTAL_BOXES_COUNT in the party menu, else StorageGetCurrentBox() */
  box2: number;
  /** MON_DATA_SPECIES_OR_EGG of the mon under the cursor (party or current box) */
  species2: number;
  /** sDepositBoxId */
  depositBoxId: number;
}

/**
 * SetPokeStorageQuestLogEvent's choice. action: 0 shift (Task_ShiftMon), 1 place (Task_PlaceMon, a withdraw's
 * Task_WithdrawMon), 2 deposit (Task_DepositMenu), 3 the multi-move's place. null: no event.
 */
export function pokeStorageQuestLogEvent(
  action: number,
  inp: PokeStorageQuestLogInputs,
): { eventId: number; data: QuestLogEventMovedBoxMon } | null {
  const { box1, box2, species1, species2, inPartyMenu } = inp;
  const PARTY = K.TOTAL_BOXES_COUNT;
  let eventId: number;
  let data: QuestLogEventMovedBoxMon;
  switch (action) {
    default:
      return null;
    case 0:
      if (inPartyMenu) {
        if (box1 === PARTY) return null;
        eventId = K.QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON;
      } else if (box1 === PARTY) {
        // Should upmerge but doesn't
        eventId = K.QL_EVENT_SWITCHED_PARTY_MON_FOR_PC_MON;
      } else {
        eventId = box1 !== box2 ? K.QL_EVENT_SWITCHED_MONS_BETWEEN_BOXES : K.QL_EVENT_SWITCHED_MONS_WITHIN_BOX;
      }
      data = { species1, species2, box1, box2 };
      break;
    case 1:
      data = { species1, species2: K.SPECIES_NONE, box1, box2: 0xff };
      if (inPartyMenu) {
        if (box1 === PARTY) return null;
        eventId = K.QL_EVENT_WITHDREW_MON_PC;
      } else if (box1 === PARTY) {
        eventId = K.QL_EVENT_DEPOSITED_MON_PC;
        data.box1 = box2;
      } else if (box1 !== box2) {
        eventId = K.QL_EVENT_MOVED_MON_BETWEEN_BOXES;
        data.box2 = box2;
      } else {
        eventId = K.QL_EVENT_MOVED_MON_WITHIN_BOX;
      }
      break;
    case 2:
      eventId = K.QL_EVENT_DEPOSITED_MON_PC;
      data = { species1, species2: K.SPECIES_NONE, box1: inp.depositBoxId, box2: 0xff };
      break;
    case 3:
      eventId = K.QL_EVENT_SWITCHED_MULTIPLE_MONS;
      data = { species1: K.SPECIES_NONE, species2: K.SPECIES_NONE, box1, box2 };
      break;
  }
  return { eventId, data };
}
