// Dev-only hooks for the browser's sound output (audio/output.ts), as `window.__test.audioOutput`. Kept apart
// from the engine's audio hooks (W-sound 1's, in testHooks.ts). Reading the output's state is for tests only:
// game logic never branches on it.

import { audioOutputProbe, setTestTone } from '../audio/output';

export function audioOutputTestApi() {
  return {
    /** The output's state: on or off and why, the AudioContext's state, mute, the worklet's last stats. */
    state: () => audioOutputProbe(),
    /** Start / stop the test tone (needs the output on: `?audio=1` or `?audio=tone`). Returns whether it plays. */
    tone: (on: boolean) => setTestTone(on),
  };
}
