// The sound half of AgbMain's frame (main.c), shared by every host that ticks the game: OverworldScene.tick and
// GbaHostScene.update (which also runs BattleScene, in the game and on battle-test.html). Only one host ticks at a
// time (the field sleeps while a GbaHostScene runs), so AgbMainFrameEnd runs exactly once per logic tick.
//
// Game logic must time the same with the audio output on or off: nothing here may look at the output.

import { m4aSoundInit, m4aSoundMain } from './m4a';
import { MapMusicMain, ResetSoundState, RunSoundTasks } from '../gba/sound';

/**
 * Once per frame, after the frame's callbacks: the sound tasks (Task_Fanfare: gTasks in the C, run by the screen's
 * RunTasks; here from the hook, AUDIO_PLAN.md decision 5), MapMusicMain (the end of AgbMain's loop, main.c:215),
 * then m4aSoundMain (VBlankIntr, main.c:406: the music players' sequencers, later the mixer).
 */
export function AgbMainFrameEnd(): void {
  RunSoundTasks();
  MapMusicMain();
  m4aSoundMain();
}

/** AgbMain's m4aSoundInit and InitMapMusic, at boot and on a soft reset (which clears sound.c's statics). The song
 *  table (audio/audioData.ts) stays loaded. */
export function AgbMainSoundInit(): void {
  m4aSoundInit();
  ResetSoundState();
}
