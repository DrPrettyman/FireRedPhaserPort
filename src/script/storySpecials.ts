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
  // ------------------------------------------------ the Pokémon Center nurse (EventScript_PkmnCenterNurse)
  /** IsPlayerNotInTrainerTowerLobby (field_specials.c) */
  IsPlayerNotInTrainerTowerLobby({ state }) {
    return state.currentMap === 'TrainerTower_Lobby' ? 0 : 1;
  },
  /**
   * BufferUnionRoomPlayerName (union_room.c): whether a wireless player was seen in the union room
   * (sUnionRoomPlayerName). There's no wireless play, so never.
   */
  BufferUnionRoomPlayerName() {
    return 0;
  },
  /** SetUsedPkmnCenterQuestLogEvent: the quest log isn't kept (like the other quest log specials). */
  SetUsedPkmnCenterQuestLogEvent() {},

  /** SetVermilionTrashCans: VAR_0x8004 / VAR_0x8005 = the first / second switch can (VermilionCity_Gym). */
  SetVermilionTrashCans({ state }) {
    const { first, second } = SetVermilionTrashCans();
    state.setVar('VAR_0x8004', first);
    state.setVar('VAR_0x8005', second);
  },

  /**
   * AnimateTeleporterHousing (special_field_anim.c; Bill's cell separator): Task_DrawTeleporterHousing flashes
   * a teleporter's light (yellow / red) and door (half / full glow) every 16 frames, 13 times, then leaves it
   * green and plain. VAR_0x8004 0 is the right teleporter (player + (6, -5)), 1 the left one (player + (-1, -5)).
   */
  AnimateTeleporterHousing({ state, host }) {
    const d = state.defines;
    const p = host.playerLocal(); // PlayerGetDestCoords
    const tX = p.x + (state.getVar('VAR_0x8004') === 0 ? 6 : -1);
    const tY = p.y - 5;
    let tTimer = 0;
    let tState = 0;
    host.startFieldTask({
      tick() {
        if (tTimer === 0) {
          const on = (tState & 1) === 0;
          host.setMetatile(tX, tY, d.require(on ? 'METATILE_SeaCottage_Teleporter_Light_Yellow' : 'METATILE_SeaCottage_Teleporter_Light_Red'), true);
          host.setMetatile(tX, tY + 2, d.require(on ? 'METATILE_SeaCottage_Teleporter_Door_HalfGlowing' : 'METATILE_SeaCottage_Teleporter_Door_FullGlowing'), true);
        }
        if (++tTimer !== 16) return false;
        tTimer = 0;
        if (++tState !== 13) return false;
        host.setMetatile(tX, tY, d.require('METATILE_SeaCottage_Teleporter_Light_Green'), true);
        host.setMetatile(tX, tY + 2, d.require('METATILE_SeaCottage_Teleporter_Door'), true);
        return true;
      },
    });
  },

  /**
   * AnimateTeleporterCable (special_field_anim.c): Task_DrawTeleporterCable moves a ball along the cable between
   * the teleporters, from player + (4, -5) one tile left every 4 frames, and clears it after four tiles.
   */
  AnimateTeleporterCable({ state, host }) {
    const d = state.defines;
    const p = host.playerLocal();
    let tX = p.x + 4;
    const tY = p.y - 5;
    let tTimer = 0;
    let tState = 0;
    const draw = (top: string, bottom: string) => {
      host.setMetatile(tX, tY, d.require(top), true);
      host.setMetatile(tX, tY + 1, d.require(bottom), true);
    };
    host.startFieldTask({
      tick() {
        if (tTimer === 0) {
          if (tState !== 0) {
            draw('METATILE_SeaCottage_Teleporter_Cable_Top', 'METATILE_SeaCottage_Teleporter_Cable_Bottom');
            if (tState === 4) return true;
            tX--;
          }
          draw('METATILE_SeaCottage_Teleporter_CableBall_Top', 'METATILE_SeaCottage_Teleporter_CableBall_Bottom');
        }
        if (++tTimer === 4) {
          tTimer = 0;
          tState++;
        }
        return false;
      },
    });
  },
};
