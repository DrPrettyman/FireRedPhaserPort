// fldeff_strength.c: Strength from the party menu (SetUpFieldMove_Strength → FieldCB_UseStrength →
// EventScript_FldEffStrength) and FLDEFF_USE_STRENGTH (FldEff_UseStrength), which the boulders' own script
// (EventScript_StrengthBoulder, data/scripts/field_moves.inc) also starts. Both end in EventScript_UseStrength,
// which sets FLAG_SYS_USE_STRENGTH; with it, walking into a boulder pushes it (TryPushBoulder in
// world/playerAvatar.ts). The flag is cleared by ClearTempFieldEventData on every map load (warp or
// connection), by a white-out and by Fly / Teleport / Dig / the Escape Rope (Overworld_ResetStateAfter*).

import { state } from '../battle/env';
import { FieldCallback_PrepareFadeInFromMenu, GetCursorSelectionMonId, setPostMenuFieldCallback } from '../menus/partyMenu';
import { gFieldCallback2 } from '../menus/fieldCallbacks';
import { FieldEffectActiveListRemove, gFieldEffectArguments, registerFieldEffectNatives } from './fieldEffectScripts';
import { CheckObjectGraphicsInFrontOfPlayer, CreateFieldEffectShowMon, ScriptContext_Enable, ScriptContext_SetupScript } from './fieldMoves';
import { PLAYER_AVATAR_FLAG, TestPlayerAvatarFlags } from './playerAvatar';

/** SetUpFieldMove_Strength: not while surfing, and only with a boulder right in front of the player. */
export function SetUpFieldMove_Strength(): boolean {
  if (TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG.SURFING) || CheckObjectGraphicsInFrontOfPlayer('OBJ_EVENT_GFX_PUSHABLE_BOULDER') !== true) {
    return false;
  }
  state.setVar('VAR_RESULT', GetCursorSelectionMonId());
  gFieldCallback2.fn = FieldCallback_PrepareFadeInFromMenu;
  setPostMenuFieldCallback(FieldCB_UseStrength);
  return true;
}

/** FieldCB_UseStrength */
function FieldCB_UseStrength(): void {
  gFieldEffectArguments[0] = GetCursorSelectionMonId();
  ScriptContext_SetupScript('EventScript_FldEffStrength');
}

/** FldEff_UseStrength: the mon banner; EventScript_UseStrength's message names the mon (STR_VAR_1). */
function FldEff_UseStrength(): boolean {
  CreateFieldEffectShowMon(ShowMonCB_UseStrength);
  const mon = state.party[gFieldEffectArguments[0]];
  state.stringVars[0] = mon ? [...mon.nickname] : []; // GetMonNickname(&gPlayerParty[gFieldEffectArguments[0]], gStringVar1)
  return false;
}

/** ShowMonCB_UseStrength: the script waiting after `dofieldeffect FLDEFF_USE_STRENGTH` runs on. */
function ShowMonCB_UseStrength(): void {
  FieldEffectActiveListRemove('FLDEFF_USE_STRENGTH');
  ScriptContext_Enable();
}

registerFieldEffectNatives({ FldEff_UseStrength });
