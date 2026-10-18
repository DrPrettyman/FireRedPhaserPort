// The Game Corner's specials and `playslotmachine` (W-slots), spread into SPECIALS like STORY_SPECIALS. No Phaser here.

import { loadGfx } from '../gba/gfx';
import { CB2_ReturnToFieldContinueScriptPlayMapMusic } from '../menus/fieldCallbacks';
import { PlaySlotMachine, slotMachineGfxSymbols } from '../menus/slotMachine';
import { GetRandomSlotMachineId } from '../menus/slotMachineLogic';
import { REG_OFFSET_WIN0V, SetGpuReg, WIN_RANGE } from '../gba/hw';
import type { ScriptHost, Wait } from './ScriptEngine';
import type { Special } from './specials';

export const GAME_CORNER_SPECIALS: Record<string, Special> = {
  /** GetRandomSlotMachineId (field_specials.c): the machine's sReelBiasChances row, for `playslotmachine`. */
  GetRandomSlotMachineId() {
    return GetRandomSlotMachineId();
  },
};

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
