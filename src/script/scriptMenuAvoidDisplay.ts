// script_menu.c's QL_DestroyAbortedDisplay, the callback every QL_AvoidDisplay caller passes (world/questLog.ts):
// in the quest log's playback, the displays a scene can't show (the script menus, the money and coins boxes, the
// elevator's floor window, the field ListMenu, the mon and fossil pics, the Seagallop menu) are skipped, and once
// Task_AvoidDisplay has ended the scene this replaces the script that wanted them with EventScript_ReleaseEnd.
//
// No Phaser here (ScriptEngine imports it): the pictures' modules hand over their part (registerAbortedDisplayCleanup).

import { QL_AvoidDisplay } from '../world/questLog';
import type { SpecialEnv } from './specials';

/** What QL_DestroyAbortedDisplay needs: ScriptContext_SetupScript and the field (the mon pic). */
export type AbortedDisplayEnv = Pick<SpecialEnv, 'setupScript' | 'host'>;

/** The pictures' own frees (ui/MuseumFossilPic.ts: Task_WaitMuseumFossilPic's sprite), by name. */
const sCleanups = new Map<string, () => void>();

export function registerAbortedDisplayCleanup(name: string, cleanup: () => void): void {
  sCleanups.set(name, cleanup);
}

/**
 * QL_DestroyAbortedDisplay: the global script context set up with EventScript_ReleaseEnd (the running script, which
 * waits for the display that never came, ends), then the sprites of a mon pic (Task_ScriptShowMonPic) and of a fossil
 * pic (Task_WaitMuseumFossilPic) still up are freed. (In playback neither can be up: their displays are avoided too.
 * The C frees only the mon pic's sprite; the port's PicboxCancel takes its window too, which the next scene's map
 * load would have cleared.)
 */
export function QL_DestroyAbortedDisplay(env: AbortedDisplayEnv): void {
  env.setupScript('EventScript_ReleaseEnd');
  env.host.cancelMonPic();
  for (const cleanup of sCleanups.values()) cleanup();
}

/** `QL_AvoidDisplay(QL_DestroyAbortedDisplay)`, as every caller in the C writes it. */
export function avoidDisplay(env: AbortedDisplayEnv): boolean {
  return QL_AvoidDisplay(() => QL_DestroyAbortedDisplay(env));
}
