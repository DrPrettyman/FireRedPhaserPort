// The Game Corner's specials (W-slots), spread into SPECIALS like STORY_SPECIALS, `playslotmachine`, and the field
// effects its scripts start: the smiley over the player before the slot machine, the photo printer's flash. No Phaser here.

import { loadGfx } from '../gba/gfx';
import { CB2_ReturnToFieldContinueScriptPlayMapMusic } from '../menus/fieldCallbacks';
import { PlaySlotMachine, slotMachineGfxSymbols } from '../menus/slotMachine';
import { GetRandomSlotMachineId } from '../menus/slotMachineLogic';
import { REG_OFFSET_WIN0V, SetGpuReg, WIN_RANGE } from '../gba/hw';
import { SpeciesToMailSpecies } from '../world/mail';
import { avatarField } from '../world/playerAvatar';
import { FieldEffectActiveListRemove, gFieldEffectArguments, registerFieldEffectNatives } from '../world/fieldEffectScripts';
import type { Defines } from './Defines';
import type { ScriptHost, Wait } from './ScriptEngine';
import type { Special } from './specials';

const PARTY_SIZE = 6;

export const GAME_CORNER_SPECIALS: Record<string, Special> = {
  /** GetRandomSlotMachineId (field_specials.c): the machine's sReelBiasChances row, for `playslotmachine`. */
  GetRandomSlotMachineId() {
    return GetRandomSlotMachineId();
  },

  /**
   * UpdateTrainerCardPhotoIcons (field_specials.c): the Game Corner's photo printer puts the party on the trainer
   * card's back (VAR_TRAINER_CARD_MON_ICON_1-6, as mail species; eggs as SPECIES_EGG) in the tint VAR_0x8004 chose.
   */
  UpdateTrainerCardPhotoIcons({ state }) {
    const d = state.defines;
    for (let i = 0; i < PARTY_SIZE; i++) {
      const mon = state.party[i];
      const species = !mon ? d.require('SPECIES_NONE') : mon.isEgg ? d.require('SPECIES_EGG') : mon.species; // MON_DATA_SPECIES_OR_EGG
      state.setVar(`VAR_TRAINER_CARD_MON_ICON_${i + 1}`, SpeciesToMailSpecies(d, species, mon?.personality ?? 0));
    }
    state.setVar('VAR_TRAINER_CARD_MON_ICON_TINT_IDX', state.getVar('VAR_0x8004'));
  },
};

/**
 * The Game Corner scripts' field effect natives (ScriptEngine registers them with its host):
 * - FldEff_SmileyFaceIcon (trainer_see.c): the smiley emote over the object gFieldEffectArguments[0] (the slot
 *   machines pass LOCALID_PLAYER, for whom TryGetObjectEventIdByLocalIdAndMap ignores the map arguments, which the
 *   script passes in the wrong order). The field's Phaser emote keeps its own active list, which
 *   `waitfieldeffect` also looks at.
 * - FldEff_PhotoFlash (field_effect.c): the photo printer's flash, all palettes white fading back; Task_PhotoFlash
 *   takes it off the active list when the fade is over.
 */
export function registerGameCornerFieldEffects(host: ScriptHost, defines: Defines): void {
  registerFieldEffectNatives({
    FldEff_SmileyFaceIcon() {
      FieldEffectActiveListRemove('FLDEFF_SMILEY_FACE_ICON');
      const obj = host.objectByLocalId(gFieldEffectArguments[0]);
      if (obj) host.startFieldEffect('FLDEFF_SMILEY_FACE_ICON', obj);
      return 0;
    },
    FldEff_PhotoFlash() {
      // BlendPalettes(PALETTES_ALL, 16, RGB_WHITE) + BeginNormalPaletteFade(PALETTES_ALL, -1, 15, 0, RGB_WHITE): the
      // field's fade goes 16 → 0 in steps of 2 (FADE_FROM_WHITE), the C's 15 → 0 in steps of 3.
      const fade = host.fadeScreen(defines.require('FADE_FROM_WHITE'));
      avatarField().createTask(() => {
        if (!fade()) return false;
        FieldEffectActiveListRemove('FLDEFF_PHOTO_FLASH'); // Task_PhotoFlash
        return true;
      });
      return 0;
    },
  });
}

/**
 * ScrCmd_playslotmachine: the slot machine screen (menus/slotMachine.ts) from the black field; it returns through
 * CB2_ReturnToFieldContinueScriptPlayMapMusic, and the wait (ScriptContext_Stop) ends once the field has faded back
 * in (FieldCB_ContinueScriptHandleMusic's ScriptContext_Enable). The graphics load first.
 */
export function PlaySlotMachineFromScript(host: ScriptHost, machineIdx: number): Wait {
  let loaded = false;
  let screen: Wait | undefined;
  void loadGfx(slotMachineGfxSymbols()).then(() => (loaded = true));
  return () => {
    if (!screen) {
      if (!loaded) return false;
      screen = host.runScreenFromScript(() => {
        // The field leaves WIN0V at WIN_RANGE(0, 255) (InitOverworldGraphicsRegisters) and the slot machine never
        // sets it: its help window (WIN0) spans only WIN0H. FieldMenuScene starts from reset registers.
        SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(0, 255));
        PlaySlotMachine(machineIdx, CB2_ReturnToFieldContinueScriptPlayMapMusic);
      });
    }
    return screen();
  };
}
