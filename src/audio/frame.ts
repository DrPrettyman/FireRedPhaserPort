// The sound half of AgbMain's frame (main.c), shared by every host that ticks the game: OverworldScene.tick and
// GbaHostScene.update (which also runs BattleScene, in the game and on battle-test.html). Only one host ticks at a
// time (the field sleeps while a GbaHostScene runs), so AgbMainFrameEnd runs exactly once per logic tick.
//
// Game logic must time the same with the audio output on or off: the output only decides whether the mixer writes
// samples (m4aSetMixing) and whether the frame is handed over; the engine's state advances the same either way.

import { m4aPcmFrame, m4aSoundInit, m4aSoundMain, m4aSoundVSync } from './m4a';
import { m4aSetMixing } from './m4aMixer';
import { audioOutputWantsFrames, pushFrame } from './output';
import { MapMusicMain, ResetSoundState, RunSoundTasks } from '../gba/sound';

/**
 * Once per frame, after the frame's callbacks: the sound tasks (Task_Fanfare: gTasks in the C, run by the screen's
 * RunTasks; here from the hook, AUDIO_PLAN.md decision 5), MapMusicMain (the end of AgbMain's loop, main.c:215),
 * m4aSoundVSync (VCountIntr, main.c:439: the DMA's slot counter), then m4aSoundMain (VBlankIntr, main.c:406: the
 * music players' sequencers, CgbSound and the mixer), whose frame goes to the output: the DirectSound mix plays
 * during the next frame, as on the GBA; the PSG register writes take effect at once on the GBA (see PsgFrame in
 * soundRegs.ts). `callbacksRan`: FALSE in a frame the help system kept the screen's callbacks (and so their RunTasks)
 * from running (RunHelpSystemCallback, ui/helpSystem.ts): the sound tasks wait too.
 */
export function AgbMainFrameEnd(callbacksRan = true): void {
  if (callbacksRan) RunSoundTasks();
  MapMusicMain();
  m4aSoundVSync();
  const wanted = audioOutputWantsFrames();
  m4aSetMixing(wanted);
  m4aSoundMain();
  // Taken every frame: it also takes the frame's PSG register writes (soundRegs.ts), which mustn't pile up while
  // nothing listens. The output gets the register state with each frame, so it can pick up mid-song.
  const frame = m4aPcmFrame();
  if (wanted) pushFrame(frame);
}

/** AgbMain's m4aSoundInit and InitMapMusic, at boot and on a soft reset (which clears sound.c's statics). The song
 *  table (audio/audioData.ts) stays loaded. */
export function AgbMainSoundInit(): void {
  m4aSoundInit();
  ResetSoundState();
}
