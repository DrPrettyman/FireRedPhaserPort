// quest_log.c's state globals, in a module with no imports of its own so the low layers (gba/sound.ts,
// text/TextPrinter.ts, the help system) can read gQuestLogState without an import cycle through world/questLog.ts
// (which re-exports everything here).

import { K } from '../battle/constants';

/** A pointer into a scene's script (u16 *): the scene and the u16 index. */
export interface ScriptPtr {
  scene: number;
  pos: number;
}

/** quest_log.c's (and quest_log_events.c's) globals the other quest log files share. */
export const gQL = {
  /** gQuestLogState: 0, QL_STATE_RECORDING, QL_STATE_PLAYBACK, QL_STATE_PLAYBACK_LAST */
  state: 0,
  /** gQuestLogPlaybackState: QL_PLAYBACK_STATE_* */
  playbackState: 0,
  /** sCurrentSceneNum */
  currentSceneNum: 0,
  /** gQuestLogRecordingPointer */
  recordingPointer: null as ScriptPtr | null,
  /** gQuestLogDefeatedWildMonRecord */
  defeatedWildMonRecord: null as ScriptPtr | null,
  /** gQuestLogCurActionIdx */
  curActionIdx: 0,
};

/** gQuestLogState == QL_STATE_PLAYBACK (a recorded scene; not the final scene, PLAYBACK_LAST). */
export function QL_InPlaybackState(): boolean {
  return gQL.state !== 0 && gQL.state === K.QL_STATE_PLAYBACK;
}

/** QL_IS_PLAYBACK_STATE (constants/quest_log.h): QL_STATE_PLAYBACK or QL_STATE_PLAYBACK_LAST. */
export function QL_IS_PLAYBACK_STATE(): boolean {
  return gQL.state !== 0 && (gQL.state === K.QL_STATE_PLAYBACK || gQL.state === K.QL_STATE_PLAYBACK_LAST);
}
