// text.h's gTextFlags, in a module of its own (text/TextPrinter.ts and gba/window.ts re-export it).

/**
 * gTextFlags (text.h). autoScroll is text.c's auto mode: the printer prints a character every other frame and goes
 * on by itself at a \p, \l or {PAUSE_UNTIL_PRESS} after TextPrinterWaitAutoMode's delay, without the down arrow and
 * without A / B. The quest log's playback sets it (field_message_box.c's Task_DrawFieldMessageBox,
 * new_menu_helpers.c's LoadStdWindowFrameGfx / LoadMessageBoxAndFrameGfx) and Task_EndQuestLog clears it; the
 * battle sets it for the Pokédude's (and link) battles. text/TextPrinter.ts reads it.
 */
export const gTextFlags = { canABSpeedUpPrint: false, useAlternateDownArrow: false, autoScroll: false };
