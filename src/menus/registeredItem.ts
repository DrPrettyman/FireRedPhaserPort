// item_menu.c's UseRegisteredKeyItemOnField: SELECT on the field (field_control_avatar.c's
// ProcessPlayerFieldInput, OverworldScene.processPlayerFieldInput) uses the key item registered in the bag. The
// item's field func (menus/itemUse.ts) runs as a task with data[3] = 1, which its from-the-field branches check.
// The field doesn't run the GBA task list (RunTasks) outside the GBA screens, so the item's task is stepped
// by a field task of its own until it's destroyed.

import { K } from '../battle/constants';
import { state } from '../battle/env';
import { CreateTask, DestroyTask, gTasks } from '../gba/task';
import { avatarField, ClearPlayerHeldMovement, HandleEnforcedLookDirectionOnPlayerStopMoving, StopPlayerAvatar } from '../world/playerAvatar';
import { CheckBagHasItem, ItemId_GetFieldFunc } from './common';
import { FIELD_USE_FUNCS, fieldFuncs } from './itemUse';
import { SpecialVar } from './itemMenuState';

/**
 * UseRegisteredKeyItemOnField. Always TRUE (InUnionRoom is never TRUE here: no Union Room). ChangeBgY(0, 0, 0)
 * resets BG0's scroll for the message window, which the field's message box doesn't have.
 */
export function UseRegisteredKeyItemOnField(): boolean {
  const f = fieldFuncs();
  f.DismissMapNamePopup();
  if (state.registeredItem !== K.ITEM_NONE) {
    if (CheckBagHasItem(state.registeredItem, 1)) {
      f.LockPlayerFieldControls();
      avatarField().freezeObjectEvents(); // FreezeObjectEvents
      HandleEnforcedLookDirectionOnPlayerStopMoving();
      StopPlayerAvatar();
      SpecialVar.ItemId = state.registeredItem;
      const taskId = CreateTask(registeredItemFieldFunc(state.registeredItem), 8);
      gTasks[taskId].data[3] = 1;
      runItemTaskOnField(taskId);
      return true;
    }
    state.registeredItem = K.ITEM_NONE;
  }
  f.ScriptContext_SetupScript('EventScript_BagItemCanBeRegistered');
  return true;
}

/** ItemId_GetFieldFunc(registeredItem), resolved to the ported function. */
function registeredItemFieldFunc(itemId: number): (taskId: number) => void {
  const name = ItemId_GetFieldFunc(itemId);
  const func = FIELD_USE_FUNCS[name];
  if (func) return func;
  // The Fame Checker and Teachy TV (no screens yet): log, and give the controls back.
  return (taskId) => {
    console.warn(`[item_use] ${name} from the field (SELECT) is not implemented`);
    DestroyTask(taskId);
    ClearPlayerHeldMovement(); // ClearPlayerHeldMovementAndUnfreezeObjectEvents
    avatarField().unfreezeObjectEvents();
    fieldFuncs().UnlockPlayerFieldControls();
  };
}

/**
 * RunTasks for the item's task: its first step runs now (on the GBA, RunTasks follows the input callback in the
 * same frame), then once a frame with the field's tasks until it's destroyed.
 */
function runItemTaskOnField(taskId: number): void {
  const task = gTasks[taskId];
  const step = (): boolean => {
    if (!task.isActive) return true;
    task.func(taskId);
    return !task.isActive;
  };
  if (!step()) avatarField().createTask(step);
}
