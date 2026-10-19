# Mail, the Fame Checker, Teachy TV (and the quest log's start)

The single-player gaps left after [GAPS_PLAN.md](GAPS_PLAN.md): Teachy TV (the Viridian old man gives it after
his catching tutorial), the Fame Checker (the rival gives it in Cerulean after his battle), mail (Celadon Dept. Store
4F sells Retro Mail, Six Island's mart Dream Mail; DONTAE's Jynx holds a Fab Mail) and the quest log ("Previously on
your quest" on CONTINUE). Mail, the Fame Checker and Teachy TV are this plan; the quest log has its own plan,
[QUEST_LOG_PLAN.md](QUEST_LOG_PLAN.md), whose first two units run in this batch as the fourth workstream. Batch 12.

## What was checked

Checked against the decomp and master at `560f185` (2026-10-19):

- **Mail** (mail.c 734 lines: the mail screen; mail_data.c 187: the mail slots and the mon's mail id; mailbox_pc.c
  140 and player_pc.c's mailbox half, ~350 of its 740; party_menu.c's mail actions, ~110 lines that mention it;
  daycare.c's struct DayCareMail; trade_scene.c / the in-game trade's mail (sIngameTradeMail, GetInGameTradeMail);
  pokemon.c's MON_DATA_MAIL; load_save.c / new_game.c's ClearMailData). The port has: ItemIsMail
  (`menus/common.ts`), the party menu's MAIL / READ / TAKE entries and windows that log "not implemented",
  `gText_CantWriteMailHere` in the bag, the PC box refusing mail (`menus/pokemonStorage.ts`), Easy Chat's
  EASY_CHAT_TYPE_MAIL layout in `menus/easyChatScreenModel.ts` but no caller, the player's PC MAILBOX always empty
  (`ui/PlayerPcMenu.ts` countPcMail = 0), daycare and the Fab Mail trade without mail. Graphics:
  `graphics/mail/` (12 mail types), not extracted. Save: gSaveBlock1Ptr->mail[MAIL_COUNT] (6 party + 10 PC).
- **The Fame Checker** (fame_checker.c 1,739 lines, data/text/fame_checker.inc, `graphics/fame_checker/`): the key
  item from the bag, the field and SELECT; the screen (the persons list, their pics, the six flavor texts per
  person, the "?" sprites, the spinning Poké Ball, the cursor); gSaveBlock1Ptr->fameChecker[NUM_FAMECHECKER_PERSONS]
  (pickState, flavorTextFlags); new_game.c's ResetFameChecker. 37 maps use the `famechecker` macro (expanded by
  the extractor already) into `special SetFlavorTextFlagFromSpecialVars` / `UpdatePickStateFromSpecialVar8005`,
  both `NO_OP` in `script/specials.ts` today. `menus/registeredItem.ts` and `menus/itemUse.ts` log "not
  implemented" for it.
- **Teachy TV** (teachy_tv.c 1,400 lines, `graphics/teachy_tv/`): the key item and its screen (the TV room drawn
  from a map layout, the Pokédude's object, the six-option list, the TTVcmd sequences, the grass animation).
  Four options run a scripted battle: battle_controller_pokedude.c (2,698 lines, the scripted inputs for
  TTVSCR_BATTLE / _STATUS / _MATCHUPS / _CATCHING), battle_setup.c's StartPokedudeBattle / EndPokedudeBattle,
  BATTLE_TYPE_POKEDUDE in battle_main.c (B quits: CB2_QuitPokedudeBattle) and friends, the bag's InitPokedudeBag
  (item_menu.c, ~240 lines: the ITEMMENULOCATION_TTVSCR_* scripted bags), party_menu.c's Pokédude tasks
  (Task_PartyMenu_Pokedude, Pokedude_OpenPartyMenuInBattle, Pokedude_ChooseMonForInBattleItem). Two run scripted
  menus in the field: TTVSCR_TMS (tm_case.c's TMCASE_POKEDUDE, ~100 lines) and TTVSCR_REGISTER (the scripted bag).
  The port has `battle/controllerOakOldMan.ts` (the closest model for the Pokédude controller) and logs "not
  implemented" from the bag, SELECT and the TM case.
- **The quest log:** [QUEST_LOG_PLAN.md](QUEST_LOG_PLAN.md).

## Workstreams

One PR per unit, merged as it hands back; a workstream's next unit starts on a fresh branch from the updated
`origin/master` (as GAPS_PLAN.md). Each unit leaves the branch green: typecheck, unit tests, its own e2e file.

### W-mail: mail (2 units)

1. **The data, the screen, the party menu:** mail_data.c whole (ClearMailData, ClearMail, MonHasMail,
   GiveMailToMon / GiveMailToMon2, TakeMailFromMon / TakeMailFromMon2, SpeciesToMailSpecies / MailSpeciesToSpecies
   (move `gameCornerSpecials.ts`' and `trainerCard.ts`' copies onto it), ItemIsMail stays in `menus/common.ts`),
   MON_DATA_MAIL on the mon (the mail id; saved with the mon), gSaveBlock1Ptr->mail in the save (version bump),
   new_game.c's ClearMailData; mail.c whole (ReadMail: every mail type's layout, the mon icon, the gender colours,
   the easy chat words); `graphics/mail/` through the extractor; the party menu: give mail from the bag (writing it
   on the Easy Chat screen, EASY_CHAT_TYPE_MAIL; "Stop giving POKéMON mail?"), MAIL → READ / TAKE / CANCEL, the
   swap with a held mail, TAKE into the bag ("The MAIL was taken…") and the "send to PC" path stubbed until
   unit 2 if it needs the mailbox; the bag's CHECK on a mail item (ItemUseOutOfBattle_Mail: a blank mail). New
   `world/mail.ts` (data), `menus/mail.ts` (the screen). E2e `tests/e2e/mail.test.ts`: buy a Retro Mail (Celadon Dept. Store 4F), give it from the
   bag (write words), read it from the party menu, take it back; a held mail survives a save and reload. Plus
   `easyChat.test.ts` and `fieldItems.test.ts`.
2. **The mailbox, the daycare, the trade:** player_pc.c's mailbox (Task_PlayerPcMailbox, the mailbox list from
   mailbox_pc.c, READ / MOVE TO BAG / GIVE / CANCEL, PARTY_ACTION_GIVE_MAILBOX_MAIL, the bag-full message), the
   party menu's "send the removed mail to your PC" path, daycare.c's struct DayCareMail (StorePokemonInDaycare /
   TakePokemonFromDaycare moving a mon's mail), the in-game trade's mail (DONTAE's Jynx's Fab Mail:
   GetInGameTradeMail, sIngameTradeMail into the received mon), field_specials.c's mail lines, and every
   DEVIATIONS / "mail isn't modelled" note this leaves fixed. mail.test.ts grows: the PC mailbox (read, move to bag,
   give), a mon with mail into the daycare and back, the Fab Mail read after the trade. Plus `daycare.test.ts`,
   `inGameTrades.test.ts` and `pcStorage.test.ts`.

### W-fame: the Fame Checker (1 unit; hand back with what's left if it runs over)

1. fame_checker.c whole: UseFameChecker / UseFameCheckerFromMenu from the bag, the field and SELECT, the screen (BGs,
   windows, the persons list, the pics, the flavor texts, the "?" and spinning Poké Ball sprites, the cursor, the
   scroll arrows, the A/B/START flow), the save data (fameChecker[], version bump), ResetFameChecker on a new game,
   the two specials out of `NO_OP` (SetFlavorTextFlagFromSpecialVars, UpdatePickStateFromSpecialVar8005), the
   help context it sets, `graphics/fame_checker/` and the text through the extractor. New `menus/fameChecker.ts`.
   E2e `tests/e2e/fameChecker.test.ts`: get the item from the rival in Cerulean, open it from the bag and from SELECT, a person unlocked by a
   story script (e.g. Brock after his gym) shows their pic and text, a locked one shows "?", B back to the bag /
   the field; the flags survive a save. Plus `registeredItems.test.ts` and `fieldItems.test.ts`.

### W-teachy: Teachy TV (3 units)

1. **The screen:** teachy_tv.c whole (InitTeachyTvController, the main callback, the BGs and the TV room map, the
   Pokédude object, the list and its scroll arrows, the TTVcmd sequences, the grass animation, quitting back to the
   bag or the field), FieldUseFunc_TeachyTv from the bag, the field and SELECT, `graphics/teachy_tv/` through the
   extractor. TeachyTvPrepBattle and the TMS / REGISTER options call the units 2-3 entry points; until then they
   return to the list (logged). New `menus/teachyTv.ts`. E2e `tests/e2e/teachyTv.test.ts`: get it from the Viridian old man,
   open it from the bag and from SELECT, pick each option's intro text, B back. Plus `registeredItems.test.ts`.
2. **The Pokédude's battles:** battle_controller_pokedude.c whole (`battle/controllerPokedude.ts`, beside
   controllerOakOldMan.ts), battle_setup.c's StartPokedudeBattle / EndPokedudeBattle and
   InitPokedudePartyAndOpponent, BATTLE_TYPE_POKEDUDE wherever battle_*.c checks it (B quits: CB2_QuitPokedudeBattle),
   the bag's ITEMMENULOCATION_TTVSCR_STATUS / _CATCHING (InitPokedudeBag's battle half), party_menu.c's Pokédude
   tasks (Pokedude_OpenPartyMenuInBattle, Pokedude_ChooseMonForInBattleItem, Task_PartyMenu_Pokedude); back to Teachy
   TV after (sWhereToReturnToFromBattle, CB2_ReturnToTeachyTV). teachyTv.test.ts grows the four battle demos run
   to their end and one quit with B. Plus `wildBattle.test.ts`, `trainerBattle.test.ts` and
   `audioBattleControllers.test.ts` (the Old Man's controller).
3. **The field demos:** the scripted bag's ITEMMENULOCATION_TTVSCR_REGISTER and _TMS (InitPokedudeBag's field half,
   Task_Pokedude_FadeFromBag), tm_case.c's TMCASE_POKEDUDE (Pokedude_InitTMCase and its scripted steps), the return
   to Teachy TV; the DEVIATIONS entries about Teachy TV removed. teachyTv.test.ts grows both demos. Plus
   `tmCase.test.ts`.

### W-qlog: the quest log, units 1-2 of [QUEST_LOG_PLAN.md](QUEST_LOG_PLAN.md)

Units QL1 (recording and the save) and QL2 (playback on CONTINUE) as that plan describes them; QL3 onwards wait for
batch 13 (they add event calls to the party menu, the bag and the PC, which this batch's other workstreams change).

## Shared files

- `state/saveData.ts`: W-mail 1 (the mail slots, the mon's mail id), W-fame (fameChecker), W-qlog 1 (the scenes).
  Each bumps SAVE_VERSION by one from master's and adds its `upgradeSave` step; the merger renumbers whichever
  merges later (a mechanical conflict).
- `menus/itemUse.ts`, `menus/registeredItem.ts`: W-mail (mail's CHECK), W-fame (the Fame Checker), W-teachy 1
  (Teachy TV): each only its own item's functions.
- `menus/partyMenu.ts`: W-mail (the mail actions), W-teachy 2 (the Pokédude tasks). Distinct functions.
- `menus/itemMenu.ts`: W-teachy 2-3 (InitPokedudeBag, the TTVSCR locations), W-mail (the mail item's flows).
- `menus/tmCase.ts`: W-teachy 3. `src/battle/`: W-teachy 2.
- `ui/PlayerPcMenu.ts`, `world/daycare.ts`, `script/tradeSpecials.ts`: W-mail 2.
- `scenes/OverworldScene.ts`: W-qlog (CB1_Overworld's recording and playback hooks, the CONTINUE path); the others
  only to open their screens from the field (small).
- `script/specials.ts`: W-fame (its two specials), W-qlog (the quest log specials it ports).
- `tools/extract_gfx.py` GFX_PREFIXES: each adds its own line (`graphics/mail/`, `graphics/fame_checker/`,
  `graphics/teachy_tv/`, `graphics/quest_log/`).
- `ui/helpSystemContext.ts`: each sets its own screen's context.
- `tests/unit/scriptCoverageGaps.ts`: each removes its own entries.

## Batches

| Batch | Workers | Why together |
|---|---|---|
| 12 | W-mail (1, 2), W-fame (1), W-teachy (1, 2, 3), W-qlog (QL1, QL2) | Four workstreams; the shared files above take one-line or distinct-function changes |
| 13 | QUEST_LOG_PLAN.md QL3 onwards, and whatever batch 12 leaves | The quest log's events land in the screens batch 12 changes |

## Batch 12 result

Complete: W-fame (#137), W-mail 1-2 (#138, #141), W-teachy 1-3 (#139, #144, #148). W-qlog went further than
planned: QL1, QL2a-b, QL3a-b and QL4a (#140, #142, #143, #145, #146, #147; QUEST_LOG_PLAN.md "Batch 12 result").
The save-shape changes landed as versions 10 (Fame Checker), 11 (mail), 12 (the quest log's scenes) and 13 (the
daycare's mail), renumbered at each merge as decision 4 says.

## Rules

Worker and merger rules: docs/WORKFLOW.md sections 3 and 4. Each worker's e2e file is named in its unit above.
**Testing:** workers run typecheck, `npm test`, their own e2e files and a few named files covering shared code
they touch, never the full e2e suite; each merge runs typecheck, unit tests and the PR's own e2e files; the full
suite runs once, at the end of the batch, on master with everything merged (failures there: rerun the failing
files only). Docs-only PRs: no tests. Workers kill any headless Chrome they started before handing back.

## Decisions

1. **A new plan doc for mail, the Fame Checker and Teachy TV, and its own doc for the quest log** (coordinator,
   revisit if you disagree): GAPS_PLAN.md is complete; the quest log spans batches.
2. **Four workers at once, one PR per unit** (coordinator, revisit if you disagree): W-mail, W-fame, W-teachy and
   W-qlog own distinct files; the shared ones take small changes.
3. **The quest log starts in this batch with recording and playback only** (coordinator, revisit if you disagree):
   its event calls (party menu, bag, PC, shops, battles) wait for batch 13 so they land after this batch's changes
   to the same screens.
4. **Each save-shape change bumps the version; the merger renumbers** (coordinator, revisit if you disagree).
5. **Link play stays out** (needs the user: networking).

## Not in this plan

Link play (the cable club, the Union Room, the e-Reader room, link trades and battles, Mystery Gift: needs a
decision from the user about networking), the unused weathers, the quest log after QL2 (QUEST_LOG_PLAN.md).
