# The quest log: "Previously on your quest"

**Status: Done: QL1-QL4a in batch 12 (PRs #136-#150), QL4b and QL5 in batch 14 (PRs #161-#163).** Plans index: [README.md](README.md).

FireRed's quest log (quest_log.c, quest_log_events.c, quest_log_objects.c, quest_log_player.c, quest_log_battle.c:
~4,500 lines, plus ~400 lines of hooks in 50 other C files). While the player plays, it records up to four scenes;
on CONTINUE it plays them back in grey, with a "Previously on your quest" header and a line of text per event,
then shows where the game was saved. It touches the field, the menus and the battles, so it spans batches:
QL1-QL4a ran in batch 12 ([FIELD_ITEMS_PLAN.md](FIELD_ITEMS_PLAN.md); see "Batch 12 result"), QL4b and QL5 are left.

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

## Batch 12 result

QL1 to QL4a ran in batch 12 (the plan had QL1-QL2; QL3 and QL4's menu half followed once the other workstreams'
screens had merged). Units as they were split:

- **QL1** (#140): recording, the command stream, the objects snapshot, DEPARTED / ARRIVED, the scenes in the save.
- **QL2a** (#143): the playback engine (TryStartQuestLogPlayback, the scene loads, the recorded actions, A / B
  skips, the final scene). **QL2b** (#146): the playback screen (the tints, the bars and the header, the
  description window and its texts, the music).
- **QL3a** (#142): the codecs and texts for QL_EVENT_* 3-29. **QL3b** (#145): 30-40 and quest_log_battle.c.
- **QL4a** (#147): the menus' call sites: item use (ItemUse_SetQuestLogEvent), the party menu (held items, order,
  items used, field moves), Fly, the item PC, the Pokémon storage system.

Left for batch 13:

- **QL4b:** the shops (RecordItemTransaction / RecordTransactionForQuestLog), the TM case's and berry pouch's
  transactions, SetUsedPkmnCenterQuestLogEvent, the story items (QL_EVENT_OBTAINED_STORY_ITEM),
  TrySetQuestLogBattleEvent from the battle's end, the Game Corner (SetQLPlayedTheSlots). These entry points exist
  (QL3) and are called only by unit tests and `__test.questLogEvent` so far.
- **QL5:** as unit 5 above.

## Batch 14

Checked against the decomp and the port before splitting (`grep -n "QuestLog\|QL_" src/*.c` outside quest_log*.c;
`grep -rniE "quest ?log" src` in the port):

- **QL4b is small:** every entry point exists (QL3) and needs only its caller: shop.c's RecordItemTransaction /
  RecordTransactionForQuestLog (the port's ShopMenu.ts / shop.ts), the SELL paths of item_menu.c, tm_case.c and
  berry_pouch.c (RecordItemTransaction), SetUsedPkmnCenterQuestLogEvent (script/storySpecials.ts, a no-op now),
  item.c's TrySetObtainedItemQuestLogEvent from ScrCmd_additem (not in the port), battle_main.c's
  TrySetQuestLogBattleEvent (battle/main.ts:1345 skips it), slot_machine.c's SetQLPlayedTheSlots.
- **QL5 is a mosaic of small playback hooks** plus one real gap: **the escalators aren't ported at all.** Every
  FRLG Pokémon Center's escalator to 2F (MB_UP_ESCALATOR / MB_DOWN_ESCALATOR in the pokemon_center tileset) is a
  plain warp in the port (DEV_NOTES: "Not in the port: escalators"). QuestLog_OnEscalatorWarp's recording half is
  in `world/questLog.ts` with no caller. So QL5's escalators unit ports field_control_avatar.c's DoEscalatorWarp
  path, field_effect.c's escalator warp (StartEscalatorWarp, Task_EscalatorWarpFieldEffect,
  EscalatorWarpEffect_1-6, FieldCB_EscalatorWarpIn, EscalatorWarpInEffect_1-7: ~300 lines) and
  special_field_anim.c's escalator half (StartEscalator, Task_DrawEscalator, IsEscalatorMoving, StopEscalator:
  ~150 lines), with the quest log's two calls (decision 4).
- The rest of QL5: QL_AvoidDisplay (quest_log.c, not in the port) and its callers (script_menu.c: the
  multichoices, YES/NO, the grid, the mon pic, the museum fossil pic, the Seagallop menu; scrcmd.c: the money and
  coins boxes; field_specials.c: the elevator's floor window and ListMenu; berry_powder.c's vendor menu);
  `goto_if_questlog` (a macro over `special GetQuestLogState`, 85 uses; GetQuestLogState is real since QL1, so the
  unit checks it branches in playback, e.g. trainer_battle.inc's EventScript_EndQuestLogBattle); scrcmd.c's music
  commands skipped in playback (playbgm, fadedefaultbgm, fadenewbgm, fadeoutbgm, fadeinbgm), text.c's PLAY_BGM and
  the 50-frame auto-scroll, WaitForAorBPress' 120-frame timeout, sound.c's fanfare (sFanfareCounter = 0xFF) and
  PlayCry_Script's skip, the map music on load; new_menu_helpers.c / field_message_box.c / text_window.c's quest
  log windows (LoadQuestLogWindowTiles, CommitQuestLogWindow1); help_system.c's check, map_preview_screen.c's
  MapHasPreviewScreen_HandleQLState2, trainer_see.c's QL_IsTrainerSightDisabled (check which are already in);
  quest_log_player.c's playback gfx (Task_QLFishMovement, QL_GfxTransition_StartSurf / StopSurf*, VS Seeker),
  field_player_avatar.c's Strength / Surf / fishing recordings (several are in already: check), and
  field_effect.c's QuestLog_DrawPreviouslyOnQuestHeaderIfInPlaybackMode calls (some are in).

### Workstreams

Three at once (load average ~5 at the start; each runs one or two e2e files).

- **W-ql4b** (branch `ql4b-menus`, one unit): every QL4b call site above. Owns `menus/shop.ts`, `ui/ShopMenu.ts`,
  the SELL paths in `menus/itemMenu.ts`, `menus/tmCase.ts`, `menus/berryPouch.ts`, `menus/slotMachine.ts`,
  `script/storySpecials.ts`'s SetUsedPkmnCenterQuestLogEvent, `battle/main.ts`'s TrySetQuestLogBattleEvent call,
  `state/` item helpers for TrySetObtainedItemQuestLogEvent (item.c), and ScrCmd_additem's one-line call in
  `script/ScriptEngine.ts`. E2e: `tests/e2e/questLogMenus.test.ts` (new): a scene per family (bought / sold at a
  mart, sold from the TM case or berry pouch, the Pokémon Center, a story item, a won trainer battle and a wild
  one, the slots) played back to its line.
- **W-ql5a** (branch `ql5-playback`, two units):
  - **QL5a1:** QL_AvoidDisplay with Task_AvoidDisplay and QL_DestroyAbortedDisplay (`world/questLog*.ts`), every
    caller listed above (ScriptEngine.ts's multichoice / YES/NO / money / coins box commands, `ui/FieldListMenu.ts`,
    the elevator, `ui/MuseumFossilPic.ts`, `script/ferrySpecials.ts`, the berry powder vendor, the mon pic), both
    halves (recording: QuestLog_CutRecording; playback: skip and clean up); `goto_if_questlog` checked in playback
    and EventScript_EndQuestLogBattle (a recorded trainer battle in playback). E2e: `tests/e2e/questLogPlayback.test.ts`
    (new): playback through a trainer battle and a multichoice / YES/NO script; a multichoice cuts a recording.
  - **QL5a2:** the audio and text differences in playback (scrcmd.c's music commands, text.c's PLAY_BGM and
    auto-scroll delay, WaitForAorBPress' 120 frames, sound.c's fanfare and PlayCry_Script, PlayNewMapMusic's
    playback check), the quest log windows of new_menu_helpers.c / field_message_box.c / text_window.c
    (LoadQuestLogWindowTiles, CommitQuestLogWindow1's caller), help_system.c, MapHasPreviewScreen_HandleQLState2,
    QL_IsTrainerSightDisabled (whatever isn't in yet). Then **the DEVIATIONS sweep**: every "no quest log" /
    "quest log isn't ported" entry and source comment left after the other workstreams, fixed or reworded to what
    is actually left. E2e: extends `questLogPlayback.test.ts`.
- **W-ql5b** (branch `ql5-field`, two units):
  - **QL5b1: the escalators.** As above: a new `world/escalator.ts` (special_field_anim.c's half) and the escalator
    warp field effect, hooked where `world/behaviors.ts` / the warp code send MB_*_ESCALATOR to a plain warp today;
    QuestLog_OnEscalatorWarp's calls. E2e: `tests/e2e/escalator.test.ts` (new): up and down a Pokémon Center's
    escalator (the player's position, the map, the metatile animation running, the timing in frames), and a
    recorded escalator ride played back.
  - **QL5b2: the field moves and the player's gfx in playback.** quest_log_player.c's playback half
    (Task_QLFishMovement, QL_GfxTransition_StartSurf / StopSurf*, the VS Seeker's), field_player_avatar.c's Surf /
    Strength / fishing recordings checked against the C, field_effect.c's header redraws. E2e:
    `tests/e2e/questLogField.test.ts` (new): playback through Surf, a Strength push and fishing.

### Shared files

- `world/questLog.ts`: W-ql5a adds QL_AvoidDisplay (owner); W-ql5b only calls QuestLog_OnEscalatorWarp (exists).
- `world/questLogPlayback.ts`, `world/questLogScreen.ts`: W-ql5a. `world/questLogPlayer.ts`: W-ql5b.
- `script/ScriptEngine.ts`: W-ql5a's commands; W-ql4b's one line in `additem`.
- `world/questLogEvents.ts` / `questLogBattle.ts`: W-ql4b calls them; small fixes there go in its PR's list.
- `scenes/OverworldScene.ts` / the warp code: W-ql5b's escalator hook only.

## Batch 14 result

Three workstreams, five units, three PRs (merged #163, #161, #162):

- **QL4b** (#163): the shop's history (`menus/shopQuestLog.ts`), the bag's, TM case's and berry pouch's sales, the
  Pokémon Center, story items from `additem` (the list from the C's condition through the extractor), the battles'
  TrySetQuestLogBattleEvent, the slots.
- **QL5b1-2** (#161): the escalators (`world/escalator.ts`: field_effect.c's escalator warp and special_field_anim.c's
  steps, with QuestLog_OnEscalatorWarp), quest_log_player.c's playback gfx (fishing, Surf on / off without the music
  change, the VS Seeker); field_player_avatar.c's recordings were all in already.

- **QL5a1** (branch `ql5-playback`, draft PR): QL_AvoidDisplay / Task_AvoidDisplay / QL_DestroyAbortedDisplay and
  every caller the port has (the berry powder vendor isn't ported), `goto_if_questlog` checked through a recorded
  trainer battle (EventScript_EndQuestLogBattle), PlayTrainerEncounterMusic's playback skip, and WaitForAorBPress'
  120 frames taken from QL5a2's list (the trainer test needs it). QL5a2 follows on the same branch.
- **QL5a2** (same branch and PR, #162): the playback's audio and text as the C has them (scrcmd.c's BGM commands,
  sound.c's fanfare 0xFF / PlaySE / PlayCry_Script, text.c's {PLAY_BGM} and the auto mode with its 50 frames, which
  the port's text printer now honours: the Pokédude's battles auto-scroll too), the field message box's quest log
  frame and CommitQuestLogWindow1, help_system.c's check, MapHasPreviewScreen_HandleQLState2, UpdateRepelCounter,
  BrailleCursorToggle, the Deoxys rock's tint, FieldInput_HandleCancelSignpost on the recorded input (gQL moved to
  `world/questLogState.ts`). QL_IsTrainerSightDisabled was in (QL2a): a trainer spotting the player in playback now
  gets through his intro. The DEVIATIONS sweep (decision 5): what's left is W-ql5b's (Surf / fishing / VS Seeker
  in playback, the escalators) and link play's.

## Shared files (QL1-QL5)

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
4. **The escalators are ported in QL5** (coordinator, revisit if you disagree): they aren't in the port at all
   (every Pokémon Center's escalator is a plain warp), and QuestLog_OnEscalatorWarp needs their field effect. The
   full escalator (special_field_anim.c's metatile animation, field_effect.c's warp effect) goes in, not only the
   quest log's hook.
5. **The DEVIATIONS sweep is QL5a2's** (coordinator, revisit if you disagree): each worker removes the "no quest
   log" entries its own unit fixes; QL5a2 runs last and rewords or removes whatever is left, so the file says
   only what's still missing (link play's events).
