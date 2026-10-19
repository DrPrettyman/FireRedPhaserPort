# The quest log: "Previously on your quest"

FireRed's quest log (quest_log.c, quest_log_events.c, quest_log_objects.c, quest_log_player.c, quest_log_battle.c:
~4,500 lines, plus ~400 lines of hooks in 50 other C files). While the player plays, it records up to four scenes;
on CONTINUE it plays them back in grey, with a "Previously on your quest" header and a line of text per event,
then shows where the game was saved. It touches the field, the menus and the battles, so it spans batches:
QL1-QL2 in batch 12 ([FIELD_ITEMS_PLAN.md](FIELD_ITEMS_PLAN.md)), QL3 onwards in batch 13.

## How the C does it

- **State:** gQuestLogState (0, QL_STATE_RECORDING, QL_STATE_PLAYBACK, QL_STATE_PLAYBACK_LAST),
  gQuestLogPlaybackState (STOPPED, RUNNING, RECORDING, ACTION_END, RECORDING_NO_DELAY), sCurrentSceneNum,
  sQuestLogCB (QLogCB_Recording / QLogCB_Playback, run from CB1_Overworld through RunQuestLogCB).
- **A scene** (struct QuestLogScene, gSaveBlock1Ptr->questLog[QUEST_LOG_SCENE_COUNT = 4], 0x668 bytes each): the
  start type (QL_START_NORMAL standing in place, QL_START_WARP arriving through a warp), the map, warp id and
  position, a snapshot of every object event (QL_RecordObjects) and the object templates, all flags and vars, and
  a 128-u16 command stream (`script`). The scenes are a ring: the fifth overwrites the first.
- **Recording starts** at an event (SetQuestLogEvent → QL_StartRecordingAction): ClearSavedScene, the snapshot
  (SetPokemonCounts into VAR_QUEST_LOG_MON_COUNTS, the player and NPC coordinates, BackUpTrainerRematches,
  BackUpMapLayout, SetGameStateAtScene), then every frame CB1_Overworld records the field input
  (QL_RecordFieldInput) and field_player_avatar.c / event_object_movement.c record movement actions and player
  graphics changes (QuestLogRecordPlayerStep, QuestLogRecordNPCStep, QuestLogTryRecordPlayerAvatarGfxTransition)
  into sQuestLogActionRecordBuffer; TryRecordActionSequence encodes them into the scene's stream with
  QL_EVENT_INPUT / _MOVEMENT / _GFX_CHANGE / _WAIT commands. Events (QL_EVENT_* 3-42) are encoded by
  RecordEventHeader + a per-event recorder; a repeated event bumps a repeat count (MAX_CMD_REPEAT) instead.
  The scene ends when the stream is full (QL_IsRoomToSaveEvent / Action), on a map change out of the scene
  (QuestLog_ShouldEndSceneOnMapChange), on certain events (DEPARTED), at a battle (battle_setup.c), or when a script
  cuts it (`special QuestLog_CutRecording`: the old man's tutorial, link rooms, ...). Some places never record
  (InQuestLogDisabledLocation: the Trainer Tower, the fan club, the Seven Island house, the elevators), and some
  events only count before the Hall of Fame (ShouldRegisterEvent_HandlePartyActions,
  ShouldRegisterEvent_HandleBeatStoryTrainer).
- **Saving** (start_menu.c, hall_of_fame.c: SaveQuestLogData) closes the recording scene into the save.
- **Playback** (main_menu.c's CONTINUE → TryStartQuestLogPlayback, if any scene has a start type): for each scene,
  QLPlayback_InitOverworldState sets QL_STATE_PLAYBACK, clears the bag and the PC items, sets the scene's position
  or warp and runs CB2_SetUpOverworldForQLPlayback(WithWarpExit) → LoadMap_QLPlayback (QL_CopySaveState: the
  scene's flags and vars, RestoreTrainerRematches; QL_ResetPartyAndPC: placeholder Rattatas to match the scene's
  party count; the object snapshot; the tint). CB1_Overworld runs DoCB1_Overworld_QuestLogPlayback: the recorded
  field input and movement actions drive the player and the NPCs (QL_UpdateObject replaces their movement
  callbacks), each event prints its line in the description window for GetQuestLogTextDisplayDuration frames, A
  skips to the next scene and B skips to the end (QL_HandleInput, DoSkipToEndTransition). The field is drawn in
  grey (gGlobalFieldTintMode QL_TINT_GRAYSCALE, ApplyGlobalFieldPaletteTint in fieldmap.c's palette loads;
  QL_TINT_SEPIA for some scenes) with the black top bar ("Previously on your quest…", DrawPreviouslyOnQuestHeader)
  and bottom bar.
- **The end:** QuestLog_StartFinalScene reloads the save (LoadGameSave(SAVE_NORMAL)), CB2_EnterFieldFromQuestLog
  enters the saved map with QL_TINT_BACKUP_GRAYSCALE, Task_QuestLogScene_SavedGame prints "<player> saved the game
  at <place>." (unless skipped to the end), then Task_EndQuestLog fades the tint and the bars out over 16 frames,
  restores the palettes, the music, wild encounters and the help system, and gives the player the controls.
- **Avoided displays:** during playback, menus and windows that a recorded action would open (the shop, the
  multichoice menus, the field message box's windows, ...) are skipped: QL_AvoidDisplay runs the caller's cleanup
  instead (and stops a recording in progress). `goto_if_questlog` branches scripts away during playback. Fanfares,
  cries and the text printer's speed behave differently in playback.

## What the port has

Comments at every call site the port has reached ("no quest log", ~60 of them; `grep -rn "quest log\|QuestLog"
src`), `GetQuestLogState` (always 0), `QuestLog_CutRecording` as a `NO_OP` special, `SetUsedPkmnCenterQuestLogEvent`
empty, `goto_if_questlog` never branching, ApplyGlobalFieldPaletteTint a no-op, the quest log input of a script's
last message (ScriptEngine.registeredInput: QuestLogOverrideJoyVars) ported. The save has no scenes (DEVIATIONS:
"Save data"). The field renders through Phaser, not the GBA layer; the Shade weather already recolours the field's
palettes and sheets (`world/weather*.ts`), which is the hook for the tints.

## Units

Each unit leaves master green (typecheck, unit tests, its e2e file `tests/e2e/questLog.test.ts`).

1. **QL1, recording and the save.** quest_log.c's recording half (state, sQuestLogCB, QL_StartRecordingAction and
   the snapshot, TryRecordActionSequence, RecordSceneEnd, QL_FinishRecordingScene, QuestLog_CutRecording,
   ResetQuestLog on a new game, SaveQuestLogData from the save dialog and the Hall of Fame), quest_log_objects.c
   (QL_RecordObjects / QL_LoadObjects), quest_log_player.c (the player gfx transitions), quest_log_events.c's
   command stream (RecordEventHeader, the repeat tracker, the INPUT / MOVEMENT / GFX_CHANGE / WAIT / SCENE_END
   codecs, QL_SkipCommand) and SetQuestLogEvent's pipeline with its filters (InQuestLogDisabledLocation,
   ShouldRegisterEvent_*, the deferred trainer battle and link events), the DEPARTED / ARRIVED events (the location
   tables, QuestLog_CheckDepartingIndoorsMap, QuestLog_TryRecordDepartedLocation, SetQuestLogEvent_Arrived), the
   hooks that record: CB1_Overworld's field input, field_player_avatar.c's player steps and gfx changes,
   event_object_movement.c's NPC steps, the map change, battle_setup.c's scene end; `QuestLog_CutRecording` and
   `GetQuestLogState` real; the scenes in the save (version bump). The C's u16 encoding is kept as is (decision 1).
   New `world/questLog*.ts`. Unit tests: encode / decode round trips, the ring of four, the stream filling up. E2e:
   leave a house, walk, save; the save holds a scene with the right start, map and commands.
2. **QL2, playback on CONTINUE.** TryStartQuestLogPlayback from the main menu, QLPlayback_InitOverworldState, the
   playback map load (QL_CopySaveState, QL_ResetPartyAndPC, the object snapshot, QL_START_WARP's warp exit), the
   playback CB1 (QL_TryRunActions, QL_HandleInput, QL_UpdateObject on the NPCs, the recorded input driving the
   player), the windows (the top and bottom bars, DrawPreviouslyOnQuestHeader, the description window and
   GetQuestLogTextDisplayDuration), the tints (ApplyGlobalFieldPaletteTint for GRAYSCALE / SEPIA /
   BACKUP_GRAYSCALE through the field's palette path, QL_SlightlyDarkenSomePals, RestoreScreenAfterPlayback), the
   skips (A: next scene, B: to the end), the final scene (QuestLog_StartFinalScene reloading the save,
   CB2_EnterFieldFromQuestLog, "saved the game at", Task_EndQuestLog), the DEPARTED / ARRIVED texts
   (src/data/text/quest_log.h through the extractor), QL_IsTrainerSightDisabled, wild encounters and the help
   system off during playback. E2e: a save with two scenes plays them on CONTINUE (the header, a departed line, the
   grey field), A and B skip, the field afterwards is the saved one (position, bag, party, flags).
3. **QL3, every event's codec and text.** quest_log_events.c's recorders and loaders for QL_EVENT_* 3-42 (the link
   ones too: they have no callers until link play) with their texts, quest_log_battle.c (TrySetQuestLogBattleEvent,
   the defeated wild mon record, QuestLogEvents_HandleEndTrainerBattle), the species / item / location buffers.
   Unit tests: each event recorded and played back to its line of text.
4. **QL4, the menu call sites.** The party menu (switched order, used item, gave / took / swapped held item incl.
   mail, field moves: SetUsedFieldMoveQuestLogEvent), the bag and item use (ItemUse_SetQuestLogEvent), the item PC,
   the Pokémon storage system (SetPokeStorageQuestLogEvent), the shops (RecordItemTransaction /
   RecordTransactionForQuestLog), the Pokémon Center (SetUsedPkmnCenterQuestLogEvent), Fly, the TM case and berry
   pouch, the Game Corner (SetQLPlayedTheSlots), story items (QL_EVENT_OBTAINED_STORY_ITEM). E2e: a scene per family
   played back.
5. **QL5, the field call sites and the playback paths.** QL_AvoidDisplay at every caller (the shop, script_menu.c,
   the field message box, new_menu_helpers.c, text_window.c), `goto_if_questlog`, the escalators
   (QuestLog_OnEscalatorWarp), Surf / Strength / fishing recordings, the field effects that draw the header
   (QuestLog_DrawPreviouslyOnQuestHeaderIfInPlaybackMode), the fanfare / cry / text auto-scroll differences, the
   help contexts, the battles' end in playback (EventScript_EndQuestLogBattle), and every DEVIATIONS "no quest log"
   entry checked and removed. E2e: playback through a trainer battle, a shop and Surf.

QL4 or QL5 may each need two workers; the coordinator of batch 13 sizes them against the code then.

## Shared files

- `scenes/OverworldScene.ts`: CB1_Overworld's hooks (record, playback), the map change. Small hooks; the logic in
  `world/questLog*.ts`.
- `state/saveData.ts`: the scenes (QL1). `menus/mainMenu.ts` (CONTINUE): QL2.
- `entities/` (player and NPC movement): the record calls (QL1), QL_UpdateObject (QL2).
- `world/weather*.ts` or the field's palette path: the tints (QL2).
- The menus and battles in QL4-QL5: one-line calls into `world/questLog*.ts`.

## Decisions

1. **The C's command stream is ported as is** (coordinator, revisit if you disagree): the 128-u16 scene buffer and
   its encodings decide how long a scene runs before it ends, which the player sees.
2. **Playback replays on the port's 60 Hz field tick** (coordinator, revisit if you disagree): the recorded
   durations are GBA frames, as everywhere else.
3. **The end of playback reloads the save slot** (coordinator, revisit if you disagree), as LoadGameSave does, so
   nothing playback changed (the cleared bag, the placeholder party, the scene's flags) survives.
