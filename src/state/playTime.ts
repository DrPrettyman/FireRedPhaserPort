// play_time.c: gSaveBlock2Ptr->playTime*, counted in VBlanks while running. AgbMain's PlayTimeCounter_Update runs
// once per frame on every screen: OverworldScene.tick and GbaHostScene's loop call it. The field starts the counter
// (CB2_NewGame / CB2_ContinueSavedGame); see docs/DEV_NOTES.md "Saving and continuing".

/** gSaveBlock2Ptr->playTimeHours / Minutes / Seconds / VBlanks */
export interface PlayTime {
  hours: number;
  minutes: number;
  seconds: number;
  vblanks: number;
}

const STOPPED = 0;
const RUNNING = 1;
const MAXED_OUT = 2;

/** sPlayTimeCounterState */
let sPlayTimeCounterState = STOPPED;

/** PlayTimeCounter_Reset */
export function PlayTimeCounter_Reset(t: PlayTime): void {
  sPlayTimeCounterState = STOPPED;
  t.hours = 0;
  t.minutes = 0;
  t.seconds = 0;
  t.vblanks = 0;
}

/** PlayTimeCounter_Start */
export function PlayTimeCounter_Start(t: PlayTime): void {
  sPlayTimeCounterState = RUNNING;
  if (t.hours > 999) PlayTimeCounter_SetToMax(t);
}

/** PlayTimeCounter_Stop */
export function PlayTimeCounter_Stop(): void {
  sPlayTimeCounterState = STOPPED;
}

/** PlayTimeCounter_Update: once per frame. */
export function PlayTimeCounter_Update(t: PlayTime): void {
  if (sPlayTimeCounterState !== RUNNING) return;
  t.vblanks++;
  if (t.vblanks > 59) {
    t.vblanks = 0;
    t.seconds++;
    if (t.seconds > 59) {
      t.seconds = 0;
      t.minutes++;
      if (t.minutes > 59) {
        t.minutes = 0;
        t.hours++;
        if (t.hours > 999) PlayTimeCounter_SetToMax(t);
      }
    }
  }
}

/** PlayTimeCounter_SetToMax */
export function PlayTimeCounter_SetToMax(t: PlayTime): void {
  sPlayTimeCounterState = MAXED_OUT;
  t.hours = 999;
  t.minutes = 59;
  t.seconds = 59;
  t.vblanks = 59;
}
