import { moveName } from '../battle/message';
import { adjustFriendship } from '../battle/pokemonBattle';
import { ItemIdToBattleMoveId } from '../menus/partyMenu';
import type { Input } from '../input/Input';
import type { GameState } from '../state/GameState';
import { IsNationalPokedexEnabled } from '../state/nationalDex';
import type { Pokemon } from '../pokemon/Pokemon';
import { DELTA } from '../world/direction';
import { animateElevator, getElevatorFloor, initElevatorFloorSelectMenuPos } from '../world/elevator';
import { initRoamer } from '../world/roamer';
import { isPoisoned } from '../world/stepCounters';
import { directionId, type ScriptHost, type TrainerBattle } from './ScriptEngine';
import { ListMenu, ReturnToListMenu } from '../ui/FieldListMenu';
import { SAVECB_RETURN_CONTINUE, SAVECB_RETURN_OKAY } from '../ui/SaveDialog';
import { ForcePlayerOntoBike, GetPlayerAvatarBike } from '../world/bike';
import { ForcePlayerToStartSurfing, GetPlayerFacingDirection, SeafoamIslandsB4F_CurrentDumpsPlayerOnLand } from '../world/playerAvatar';
import { RockSmashWildEncounter } from '../world/fieldMoves';
import { STORY_SPECIALS } from './storySpecials';
import { SIDE_SPECIALS } from './sideSpecials';
import { DAYCARE_SPECIALS } from './daycareSpecials';
import { GAME_CORNER_SPECIALS } from './gameCornerSpecials';
import { PARTY_MENU_SPECIALS } from '../menus/partyMenuSpecials';
import { TRADE_SPECIALS } from './tradeSpecials';
import { MISC_SPECIALS } from './miscSpecials';
import { EGG_HATCH_SPECIALS } from '../menus/eggHatch';
import { EASY_CHAT_SPECIALS } from './easyChatSpecials';
import { FERRY_SPECIALS } from './ferrySpecials';
import { AUDIO_SPECIALS } from './audioSpecials';
import { POSTGAME_SPECIALS } from './postgameSpecials';
import { EVENT_ISLAND_SPECIALS } from './eventIslandSpecials';
import { TRAINER_TOWER_SPECIALS } from './trainerTowerSpecials';
import * as Help from '../ui/helpSystemContext';
import { GetQuestLogState, QuestLog_CutRecording } from '../world/questLog';
import { QuestLog_StartRecordingInputsAfterDeferredEvent } from '../world/questLogEvents';
import { SetFlavorTextFlagFromSpecialVars, UpdatePickStateFromSpecialVar8005 } from '../state/fameChecker';

export interface SpecialEnv {
  state: GameState;
  host: ScriptHost;
  /** For specials that start a task the script then blocks on with `waitstate` (ScriptContext_Stop/Enable). */
  setWaitState(done: () => boolean): void;
  /**
   * The special left the field (SetMainCallback2) without a `waitstate` after it: the script doesn't run again
   * until the field is back, so it waits on `done` before its next command (SelectMoveDeleterMove).
   */
  stopScript(done: () => boolean): void;
  /**
   * ShowFieldMessage(label), or of an encoded string (e.g. gStringVar4); the wait ends once it has printed
   * (IsFieldMessageBoxHidden).
   */
  showFieldMessage(label: string | number[]): () => boolean;
  /** The special left the field (SetMainCallback2), so the script never resumes. */
  endScript(): void;
  /** ScriptContext_SetupScript: the running script ends and `label` starts in its place. */
  setupScript(label: string): void;
  warnOnce(key: string, message: string): void;
  /** DisableMsgBoxWalkaway (script.c) */
  disableMsgBoxWalkaway(): void;
  /** SetWalkingIntoSignVars (script.c) */
  setWalkingIntoSignVars(): void;
  /** The trainer battle the last `trainerbattle` configured (sTrainerBattleMode, gTrainerBattleOpponent_A). */
  trainerBattle(): TrainerBattle | undefined;
  /** The extracted text `label` (e.g. gText_Ghost), encoded without the terminator. */
  encodeText(label: string): number[];
  /** The field's buttons (gMain.newKeys / heldKeys for specials' tasks). */
  input: Input;
  /** HideFieldMessageBox */
  hideFieldMessageBox(): void;
}

/** A gSpecials entry (data/specials.inc). The return value is stored by `specialvar`. */
export type Special = (env: SpecialEnv) => number | void;

/** Specials with no effect yet because the system they feed (quest log) doesn't exist. */
const NO_OP = [
  'InitUnionRoom', // wireless only (and stubbed out from REVISION 0xA): CableClub_OnResume in every Pokémon Center
  'CloseLink', // link play: nothing was opened (TryBattleLinkup below never connects)
];

/** help_system.c / help_system_util.c's specials (data/specials.inc): ui/helpSystemContext.ts. */
const HELP_SPECIALS: Record<string, Special> = {
  /** Script_SetHelpContext: the context is VAR_0x8004 (the Pokédex rating, the Hall of Fame PC, ...). */
  Script_SetHelpContext({ state }) {
    Help.Script_SetHelpContext(state.getVar('VAR_0x8004'));
  },
  BackupHelpContext: () => Help.BackupHelpContext(),
  RestoreHelpContext: () => Help.RestoreHelpContext(),
  SetHelpContextForMap: () => Help.SetHelpContextForMap(),
  HelpSystem_Disable: () => Help.HelpSystem_Disable(),
  HelpSystem_Enable: () => Help.HelpSystem_Enable(),
};

/** fame_checker.c's specials (the `famechecker` macro): state/fameChecker.ts. */
const FAME_CHECKER_SPECIALS: Record<string, Special> = {
  SetFlavorTextFlagFromSpecialVars: ({ state }) => SetFlavorTextFlagFromSpecialVars(state),
  UpdatePickStateFromSpecialVar8005: ({ state }) => UpdatePickStateFromSpecialVar8005(state),
};

export const SPECIALS: Record<string, Special> = {
  ...Object.fromEntries(NO_OP.map((name) => [name, () => {}])),
  ...PARTY_MENU_SPECIALS, // menus/partyMenuSpecials.ts: party_menu_specials.c, ChooseMonForMoveTutor
  ...STORY_SPECIALS, // storySpecials.ts: field_specials.c's story specials (Lt. Surge's trash cans, ...)
  ...HELP_SPECIALS,
  ...FAME_CHECKER_SPECIALS,
  ...SIDE_SPECIALS, // sideSpecials.ts: Oak's Pokédex rating, money.c's cost specials
  ...DAYCARE_SPECIALS, // daycareSpecials.ts: daycare.c's Route 5 daycare specials
  ...GAME_CORNER_SPECIALS, // gameCornerSpecials.ts: GetRandomSlotMachineId
  ...TRADE_SPECIALS, // tradeSpecials.ts: in-game trades and the Name Rater
  ...MISC_SPECIALS, // miscSpecials.ts: Daisy's grooming, the Magikarp size record, the diploma, SetSeenMon, ...
  ...EGG_HATCH_SPECIALS, // menus/eggHatch.ts: daycare.c's EggHatch scene, ScriptHatchMon
  ...EASY_CHAT_SPECIALS, // easyChatSpecials.ts: easy_chat.c's ShowEasyChatMessage, BufferRandomHobbyOrLifestyleString
  ...FERRY_SPECIALS, // ferrySpecials.ts: the Seagallop ferry scene (menus/seagallop.ts) and the Rainbow Pass menu
  ...AUDIO_SPECIALS, // audioSpecials.ts: PlayTrainerEncounterMusic, Script_FadeOutMapMusic
  ...POSTGAME_SPECIALS, // postgameSpecials.ts: the postgame's specials (BrailleCursorToggle, ...)
  ...EVENT_ISLAND_SPECIALS, // eventIslandSpecials.ts: ShakeScreen, LoopWingFlapSound, Birth Island's triangle
  ...TRAINER_TOWER_SPECIALS, // trainerTowerSpecials.ts: trainer_tower.c's CallTrainerTowerFunc (world/trainerTower.ts), battle_records.c's ShowBattleRecords

  // field_player_avatar.c / bike.c / field_specials.c's player avatar specials
  ForcePlayerOntoBike,
  ForcePlayerToStartSurfing,
  SeafoamIslandsB4F_CurrentDumpsPlayerOnLand,
  GetPlayerAvatarBike,
  /** GetPlayerFacingDirection: DIR_* */
  GetPlayerFacingDirection({ state }) {
    return directionId(GetPlayerFacingDirection(), state.defines);
  },

  /**
   * RockSmashWildEncounter (wild_encounter.c): VAR_RESULT = whether a battle started. The battle's return
   * (FieldCB_ReturnToFieldNoScriptCheckMusic) ends the script that waits for it (ScriptContext_Init).
   */
  RockSmashWildEncounter({ endScript }) {
    if (RockSmashWildEncounter()) endScript();
  },

  /** DrawWholeMapView (field_camera.c): `setmetatile` already redraws its cell (MapChunk.setBlock). */
  DrawWholeMapView() {},

  DisableMsgBoxWalkaway({ disableMsgBoxWalkaway }) {
    disableMsgBoxWalkaway();
  },

  /** SetHiddenItemFlag: FlagSet(gSpecialVar_0x8004), the flag GetInteractedBackgroundEventScript stored. */
  SetHiddenItemFlag({ state }) {
    state.setFlag(state.getVar('VAR_0x8004'));
  },

  /** BufferTMHMMoveName: STR_VAR_1 = the move of TM/HM item VAR_0x8004; returns whether it is one. */
  BufferTMHMMoveName({ state }) {
    const item = state.getVar('VAR_0x8004');
    const d = state.defines;
    if (item < d.require('ITEM_TM01') || item > d.require('ITEM_HM08')) return 0;
    state.stringVars[0] = moveName(ItemIdToBattleMoveId(item)).filter((b) => b !== 0xff);
    return 1;
  },

  /** CheckAddCoins: whether VAR_RESULT (the coins checkcoins read) + VAR_0x8006 fits under MAX_COINS. */
  CheckAddCoins({ state }) {
    return state.getVar('VAR_RESULT') + state.getVar('VAR_0x8006') > state.defines.require('MAX_COINS') ? 0 : 1;
  },

  /**
   * DoPicboxCancel (EventScript_CancelMessageBox): PicboxCancel tears the mon pic box down at once. Its
   * empty text printer on window 0 only stops the message, which the script's `release` hides anyway.
   */
  DoPicboxCancel({ host }) {
    host.cancelMonPic();
  },

  /** AnimatePcTurnOn: Task_AnimatePcTurnOn flickers the PC (on, off, on, off, on) every 6 frames. */
  AnimatePcTurnOn({ state, host }) {
    let tState = 0;
    let tTimer = 0;
    host.startFieldTask({
      tick() {
        if (tTimer === 6) {
          setPcMetatile(state, host, (tState & 1) !== 0);
          tTimer = 0;
          tState++;
          if (tState === 5) return true;
        }
        tTimer++;
        return false;
      },
    });
  },

  /** AnimatePcTurnOff */
  AnimatePcTurnOff({ state, host }) {
    setPcMetatile(state, host, true);
  },

  /**
   * Field_AskSaveTheGame (start_menu.c; EventScript_AskSaveGame): StartMenu_PrepareForSave + task50_save_game,
   * which runs the save dialog each frame and ends the script's `waitstate` with gSpecialVar_Result = TRUE once
   * saved, FALSE for NO / B (SAVECB_RETURN_CANCEL) or a failed write (SAVECB_RETURN_ERROR).
   */
  Field_AskSaveTheGame({ state, host, setWaitState }) {
    const dialog = host.createSaveDialog();
    setWaitState(() => {
      const r = dialog.tick();
      if (r === SAVECB_RETURN_CONTINUE) return false;
      state.setVar('VAR_RESULT', r === SAVECB_RETURN_OKAY ? 1 : 0);
      return true;
    });
  },

  /**
   * CreateEnemyEventMon (pokemon.c; the `seteventmon` macro): ZeroEnemyPartyMons, then CreateEventMon(gEnemyParty[0],
   * VAR_0x8004 species, VAR_0x8005 level, random IVs, OT = player) holding VAR_0x8006 if set. The port keeps no
   * MON_DATA_MODERN_FATEFUL_ENCOUNTER (IsBattlerModernFatefulEncounter treats every mon as legal).
   */
  CreateEnemyEventMon({ state, host }) {
    const mon = state.pokemon.createMon(state.getVar('VAR_0x8004'), state.getVar('VAR_0x8005'), {
      otId: state.trainerId,
      otName: state.playerName,
      otGender: state.playerGender,
      metLocation: host.mapSection(),
    });
    const item = state.getVar('VAR_0x8006');
    if (item) mon.heldItem = item;
    state.enemyParty = [mon];
  },

  /** IsBadEggInParty (field_specials.c): MON_DATA_SANITY_IS_BAD_EGG reads FALSE in the port, so never. */
  IsBadEggInParty() {
    return 0;
  },
  /** IsWirelessAdapterConnected (link.c): no wireless adapter, so the cable club's direct corner (cable link) menus. */
  IsWirelessAdapterConnected() {
    return 0;
  },
  /** ValidateSavedWonderCard (mystery_gift.c): no Mystery Gift, so no saved Wonder Card (the deliveryman stays hidden). */
  ValidateSavedWonderCard() {
    return 0;
  },
  /**
   * TryBattleLinkup / TryTradeLinkup (cable_club.c) with nothing on the other end of the link: CreateLinkupTask's
   * Task_LinkupStart (10 frames), then Task_LinkupAwaitConnection, which never sees a second player, so only B ends
   * it (CheckLinkCanceledBeforeConnection → Task_LinkupFailed: LINKUP_FAILED, HideFieldMessageBox, ScriptContext_Enable).
   */
  TryBattleLinkup: linkupWithNoPartner,
  TryTradeLinkup: linkupWithNoPartner,

  /** CreatePCMenu (script_menu.c): VAR_RESULT = the choice, or SCR_MENU_CANCEL, once the menu closes. */
  CreatePCMenu({ state, host, setWaitState }) {
    const menu = host.openPcMenu();
    state.setVar('VAR_RESULT', menu.result);
    setWaitState(() => {
      if (!menu.tick()) return false;
      state.setVar('VAR_RESULT', menu.result);
      return true;
    });
  },

  /** PlayerPC (player_pc.c): ITEM STORAGE / MAILBOX / TURN OFF, ended by ScriptContext_Enable. */
  PlayerPC({ host, setWaitState }) {
    setWaitState(host.openPlayerPc());
  },

  /** BedroomPC (player_pc.c): the same menus; turning off sets up EventScript_PalletTown_PlayersHouse_2F_ShutDownPC. */
  BedroomPC({ host, setWaitState, setupScript }) {
    const menu = host.openPlayerPc(false);
    setWaitState(() => {
      if (!menu()) return false;
      setupScript('EventScript_PalletTown_PlayersHouse_2F_ShutDownPC'); // Task_PlayerPcTurnOff
      return true;
    });
  },

  /** ShowPokemonStorageSystemPC (pokemon_storage_system_menu.c): Task_PCMainMenu, ended by ScriptContext_Enable. */
  ShowPokemonStorageSystemPC({ host, setWaitState }) {
    setWaitState(host.openPokemonStoragePc());
  },

  /**
   * HallOfFamePCBeginFade (hof_pc.c): the Hall of Fame PC (menus/hallOfFame.ts CB2_InitHofPC). Its return
   * (ReshowPCMenuAfterHallOfFamePC) puts the PC menu back up; the script's `waitstate` ends with that menu's
   * choice in VAR_RESULT, which EventScript_ChoosePCMenu then switches on.
   */
  HallOfFamePCBeginFade({ state, host, setWaitState }) {
    const pc = host.openHallOfFamePc();
    setWaitState(() => {
      if (!pc.tick()) return false;
      state.setVar('VAR_RESULT', pc.result);
      return true;
    });
  },

  /**
   * EnterHallOfFame (post_battle_event_funcs.c): SetMainCallback2(CB2_DoHallOfFameScreen). The screen ends in
   * a warp to Indigo Plateau, so the script that called it never resumes.
   */
  EnterHallOfFame({ host, endScript }) {
    endScript();
    host.enterHallOfFame();
    return 0;
  },

  /** DoCredits (credits.c): SetMainCallback2(CB2_Credits), which ends in SoftReset, so the `waitstate` never ends. */
  DoCredits({ host, setWaitState }) {
    host.doCredits();
    setWaitState(() => false);
  },

  /** IsNationalPokedexEnabled (pokedex.c), as a `specialvar` (EventScript_SetDefeatedEliteFourFlagsVars). */
  IsNationalPokedexEnabled({ state }) {
    return isNationalDexEnabled(state) ? 1 : 0;
  },

  /** SpawnCameraObject (field_specials.c): the camera stays where the player stands while scripts move them. */
  SpawnCameraObject({ host }) {
    host.spawnCameraObject();
  },

  /** RemoveCameraObject: the camera follows the player again. */
  RemoveCameraObject({ host }) {
    host.removeCameraObject();
  },

  /** EnterSafariMode (safari_zone.c; GAME_STAT_ENTERED_SAFARI_ZONE isn't kept) */
  EnterSafariMode({ state }) {
    state.setFlag('FLAG_SYS_SAFARI_MODE', true);
    state.numSafariBalls = 30;
    state.safariZoneStepCounter = 600;
  },

  /** ExitSafariMode */
  ExitSafariMode({ state }) {
    state.setFlag('FLAG_SYS_SAFARI_MODE', false);
    state.numSafariBalls = 0;
    state.safariZoneStepCounter = 0;
  },

  /** IsThereRoomInAnyBoxForMorePokemon (field_specials.c) */
  IsThereRoomInAnyBoxForMorePokemon({ state }) {
    return state.isThereRoomInAnyBoxForMorePokemon() ? 1 : 0;
  },

  /** ShouldShowBoxWasFullMessage (field_specials.c): EventScript_TransferredToPC's box-full branch. */
  ShouldShowBoxWasFullMessage({ state }) {
    return state.shouldShowBoxWasFullMessage() ? 1 : 0;
  },

  /** GetPCBoxToSendMon (field_specials.c): the box SendMonToPC started from. */
  GetPCBoxToSendMon({ state }) {
    return state.getPCBoxToSendMon();
  },

  /** CountPartyNonEggMons (pokemon_storage_system_menu.c) */
  CountPartyNonEggMons({ state }) {
    return state.countPartyNonEggMons();
  },

  /** CountPartyAliveNonEggMons_IgnoreVar0x8004Slot (pokemon_storage_system_menu.c) */
  CountPartyAliveNonEggMons_IgnoreVar0x8004Slot({ state }) {
    return state.countPartyAliveNonEggMonsIgnoreVar0x8004Slot();
  },

  /**
   * ChangeBoxPokemonNickname (field_specials.c): the naming screen for the mon SendMonToPC just stored
   * (gSpecialVar_MonBoxId/Pos), writing into gStringVar2; ChangeBoxPokemonNickname_CB stores it (SetBoxMonNickAt).
   */
  ChangeBoxPokemonNickname({ state, host, setWaitState }) {
    const boxId = state.getVar('VAR_MON_BOX_ID');
    const pos = state.getVar('VAR_MON_BOX_POS');
    const mon = state.storage.getBoxedMon(boxId, pos);
    if (!mon) return;
    const d = state.defines;
    state.stringVars[2] = [...mon.nickname];
    state.stringVars[1] = [...mon.nickname];
    const dest = [...mon.nickname, d.require('EOS')];
    setWaitState(
      host.doNamingScreen({
        templateNum: d.require('NAMING_SCREEN_NICKNAME'),
        dest,
        monSpecies: mon.species,
        monGender: state.pokemon.genderFromPersonality(mon.species, mon.personality), // GetBoxMonGender
        monPersonality: mon.personality,
        onReturn: () => {
          const name = dest.slice(0, dest.indexOf(d.require('EOS')));
          state.stringVars[1] = name;
          state.storage.setBoxMonNickAt(boxId, pos, name);
        },
      }),
    );
  },

  /** InitRoamer (roamer.c) */
  InitRoamer({ state }) {
    initRoamer(state);
  },

  /** GetElevatorFloor (field_specials.c): VAR_ELEVATOR_FLOOR from the dynamic warp's map */
  GetElevatorFloor({ state }) {
    getElevatorFloor(state);
  },

  /** InitElevatorFloorSelectMenuPos: the floor select menu's starting cursor */
  InitElevatorFloorSelectMenuPos({ state }) {
    return initElevatorFloorSelectMenuPos(state);
  },

  /** ListMenu (field_specials.c): a scrolling list; VAR_RESULT = the item's index or SCR_MENU_CANCEL. */
  ListMenu({ state, host, setWaitState }) {
    const wait = ListMenu(state, host.listMenuHost());
    if (wait) setWaitState(wait);
  },

  /** ReturnToListMenu: back to a list that stayed up while the script talked (the Cerulean badge list). */
  ReturnToListMenu({ setWaitState }) {
    const wait = ReturnToListMenu();
    if (wait) setWaitState(wait);
  },

  /** DrawElevatorCurrentFloorWindow: "Now on:" and the floor gSpecialVar_0x8005 names */
  DrawElevatorCurrentFloorWindow({ state, host }) {
    host.elevatorFloorWindow(state.getVar('VAR_0x8005'));
  },

  CloseElevatorCurrentFloorWindow({ host }) {
    host.elevatorFloorWindow(undefined);
  },

  /** AnimateElevator: the shake ends the script's waitstate; the window view may scroll on after it. */
  AnimateElevator(env) {
    const { shake, windowView } = animateElevator(env.state, env.host);
    // RunTasks order: Task_AnimateElevatorWindowView (priority 8) before Task_ElevatorShake (9)
    env.host.startFieldTask(windowView);
    env.host.startFieldTask(shake);
    env.setWaitState(() => shake.done);
  },

  /** EndTrainerApproach (trainer_see.c): the script's waitstate ends once the trainer has walked up. */
  EndTrainerApproach(env) {
    env.setWaitState(env.host.endTrainerApproach());
  },

  /** GetBattleOutcome (battle_setup.c): gBattleOutcome */
  GetBattleOutcome({ state }) {
    return state.battleOutcome;
  },

  /**
   * TryFieldPoisonWhiteOut (field_poison.c): for each mon the field poison knocked out, "X fainted…"
   * (FaintFromFieldPoison clears its status), then VAR_RESULT = whether every mon has fainted.
   */
  TryFieldPoisonWhiteOut(env) {
    const { state } = env;
    let partyId = 0;
    let message: (() => boolean) | undefined;
    env.setWaitState(() => {
      if (message && !message()) return false;
      message = undefined;
      for (; partyId < state.party.length; partyId++) {
        const mon = state.party[partyId];
        if (!mon.isEgg && mon.hp === 0 && isPoisoned(state, mon)) {
          adjustFriendship(mon, state.defines.require('FRIENDSHIP_EVENT_FAINT_OUTSIDE_BATTLE'));
          mon.status = 0;
          state.stringVars[0] = [...mon.nickname];
          message = env.showFieldMessage('gText_PkmnFainted3');
          return false;
        }
      }
      // AllMonsFainted
      state.setVar('VAR_RESULT', state.party.every((mon) => mon.isEgg || mon.hp === 0) ? 1 : 0);
      return true;
    });
  },

  /** OverworldWhiteOutGetMoneyLoss: STR_VAR_1 = ComputeWhiteOutMoneyLoss() */
  OverworldWhiteOutGetMoneyLoss({ state, host }) {
    state.stringVars[0] = state.pokemon.encodeName(String(host.whiteOutMoneyLoss()));
  },

  /** SetCB2WhiteOut (post_battle_event_funcs.c), from the black screen EventScript_FieldWhiteOutFade leaves. */
  SetCB2WhiteOut({ host, endScript }) {
    endScript();
    host.whiteOut();
  },

  HealPlayerParty({ state }) {
    healPlayerParty(state);
  },

  /**
   * GetQuestLogState: gSpecialVar_Result = gQuestLogState (QL_STATE_*; 0 = not recording or playing back). It's
   * a `special`, so the result has to go into VAR_RESULT here: returning it left a stale VAR_RESULT, and a 2
   * (QL_STATE_PLAYBACK) sent EventScript_DoNoIntroTrainerBattle to EventScript_EndQuestLogBattle (Giovanni).
   */
  GetQuestLogState({ state }) {
    GetQuestLogState(state);
  },

  /** QuestLog_CutRecording (quest_log.c): the scene being recorded ends here (world/questLog.ts). */
  QuestLog_CutRecording() {
    QuestLog_CutRecording();
  },

  /** QuestLog_StartRecordingInputsAfterDeferredEvent: a link event's scene, back from the cable club (none until link play). */
  QuestLog_StartRecordingInputsAfterDeferredEvent() {
    QuestLog_StartRecordingInputsAfterDeferredEvent();
  },

  /** EnableNationalPokedex */
  EnableNationalPokedex({ state }) {
    state.nationalDexEnabled = true; // gSaveBlock2Ptr->pokedex.nationalMagic = 0xB9
    state.setVar('VAR_NATIONAL_DEX', 0x6258);
    state.setFlag('FLAG_SYS_NATIONAL_DEX');
  },

  /** GetPokedexCount (prof_pc.c): seen/caught into 0x8005/0x8006; returns IsNationalPokedexEnabled. */
  GetPokedexCount({ state }) {
    const national = state.getVar('VAR_0x8004') !== 0;
    const count = national ? state.pokemon.tables.nationalDexCount : state.pokemon.tables.kantoDexCount;
    const inRange = (set: Set<number>) => [...set].filter((n) => n >= 1 && n <= count).length;
    state.setVar('VAR_0x8005', inRange(state.dexSeen));
    state.setVar('VAR_0x8006', inRange(state.dexCaught));
    return isNationalDexEnabled(state) ? 1 : 0;
  },

  /**
   * ChangePokemonNickname (field_specials.c): the naming screen for party slot VAR_0x8004, writing into
   * gStringVar2; ChangePokemonNickname_CB stores it as the nickname. A blank entry keeps the old name.
   */
  ChangePokemonNickname({ state, host, setWaitState }) {
    const mon = state.party[state.getVar('VAR_0x8004')];
    const d = state.defines;
    state.stringVars[2] = [...mon.nickname];
    const dest = [...mon.nickname, d.require('EOS')];
    setWaitState(
      host.doNamingScreen({
        templateNum: d.require('NAMING_SCREEN_NICKNAME'),
        dest,
        monSpecies: mon.species,
        monGender: state.pokemon.gender(mon),
        monPersonality: mon.personality,
        onReturn: () => {
          const name = dest.slice(0, dest.indexOf(d.require('EOS')));
          state.stringVars[1] = name;
          mon.nickname = [...name];
        },
      }),
    );
  },

  /** ShowTownMap (field_specials.c): the wall map, back through CB2_ReturnToFieldContinueScriptPlayMapMusic. */
  ShowTownMap({ host, setWaitState }) {
    QuestLog_CutRecording();
    setWaitState(host.showTownMap());
  },

  /** GetPartyMonSpecies: MON_DATA_SPECIES_OR_EGG of party slot VAR_0x8004. */
  GetPartyMonSpecies({ state }) {
    const mon = state.party[state.getVar('VAR_0x8004')];
    if (!mon) return 0;
    return mon.isEgg ? state.pokemon.c.SPECIES_EGG : mon.species;
  },

  /**
   * StartOldManTutorialBattle (battle_setup.c): a male Lv5 Weedle for the old man to catch, then
   * CB2_ReturnToFieldContinueScriptPlayMapMusic, which the script waits for with `waitstate`.
   */
  StartOldManTutorialBattle({ state, host, setWaitState }) {
    const weedle = state.pokemon.createMaleMon(state.defines.require('SPECIES_WEEDLE'), 5, {
      otName: state.playerName, // CreateBoxMon always copies the player's name and gender
      otGender: state.playerGender,
      metLocation: host.mapSection(),
    });
    const run = host.startScriptedBattle(state.defines.require('BATTLE_TYPE_OLD_MAN_TUTORIAL'), [weedle], state.defines.require('B_TRANSITION_SLICE'));
    let fadeIn: (() => boolean) | undefined;
    setWaitState(() => {
      if (fadeIn) return fadeIn();
      if (run.done()) fadeIn = run.returnToField();
      return false;
    });
  },

  /**
   * StartMarowakBattle + CB2_EndMarowakBattle (battle_setup.c): Pokémon Tower 6F's ghost. With the Silph Scope
   * it's a GHOST | GHOST_UNVEILED battle against a Lv30 female Serious Marowak (the intro unveils it with
   * General_SilphScoped); without, a GHOST battle against the `setwildbattle` mon. Either way it's nicknamed
   * GHOST. Back on the field VAR_RESULT = FALSE if the player won, TRUE otherwise (ran away: the script
   * forces the player back from the stairs); losing whites out.
   */
  StartMarowakBattle({ state, host, setWaitState, endScript, encodeText, warnOnce }) {
    const d = state.defines;
    let battleTypeFlags: number;
    if (state.bag.has(d.require('ITEM_SILPH_SCOPE'), 1)) {
      battleTypeFlags = d.require('BATTLE_TYPE_GHOST') | d.require('BATTLE_TYPE_GHOST_UNVEILED');
      state.enemyParty[0] = state.pokemon.createMonWithGenderNatureLetter(
        d.require('SPECIES_MAROWAK'), 30, 31, d.require('MON_FEMALE'), d.require('NATURE_SERIOUS'),
        { otId: state.trainerId, otName: state.playerName, otGender: state.playerGender, metLocation: host.mapSection() },
      );
    } else {
      battleTypeFlags = d.require('BATTLE_TYPE_GHOST');
    }
    const enemy = state.enemyParty[0];
    if (!enemy) {
      warnOnce('StartMarowakBattle', '[special] StartMarowakBattle without a `setwildbattle` mon');
      return;
    }
    enemy.nickname = encodeText('gText_Ghost');
    // IncrementGameStat(GAME_STAT_TOTAL_BATTLES / _WILD_BATTLES): game stats aren't tracked yet
    const run = host.startScriptedBattle(battleTypeFlags, [enemy], host.wildBattleTransition(enemy));
    let fadeIn: (() => boolean) | undefined;
    setWaitState(() => {
      if (fadeIn) return fadeIn();
      if (!run.done()) return false;
      if (!run.playerWon()) {
        endScript();
        host.whiteOut();
        return true;
      }
      // If result is TRUE player didnt defeat Marowak, force player back from stairs
      state.setVar('VAR_RESULT', state.battleOutcome === d.require('B_OUTCOME_WON') ? 0 : 1);
      fadeIn = run.returnToField(); // CB2_ReturnToFieldContinueScriptPlayMapMusic
      return false;
    });
  },

  /**
   * StartLegendaryBattle (battle_setup.c): Mewtwo, the legendary birds (and Deoxys, Lugia, Ho-Oh) against the
   * `setwildbattle` mon, always behind B_TRANSITION_BLUR, then CB2_EndScriptedWildBattle; the script waits
   * with `waitstate` and reads the outcome with GetBattleOutcome.
   */
  StartLegendaryBattle(env) {
    const { state, setWaitState, warnOnce } = env;
    const d = state.defines;
    const enemy = state.enemyParty[0];
    if (!enemy) {
      warnOnce('StartLegendaryBattle', '[special] StartLegendaryBattle without a `setwildbattle` mon');
      return;
    }
    // CreateBattleStartTask(B_TRANSITION_BLUR, song)
    let song: number;
    switch (enemy.species) {
      case d.require('SPECIES_MEWTWO'):
        song = d.require('MUS_VS_MEWTWO');
        break;
      case d.require('SPECIES_DEOXYS'):
        song = d.require('MUS_VS_DEOXYS');
        break;
      case d.require('SPECIES_MOLTRES'):
      case d.require('SPECIES_ARTICUNO'):
      case d.require('SPECIES_ZAPDOS'):
      case d.require('SPECIES_HO_OH'):
      case d.require('SPECIES_LUGIA'):
        song = d.require('MUS_VS_LEGEND');
        break;
      default:
        song = d.require('MUS_RS_VS_TRAINER');
        break;
    }
    const flags = d.require('BATTLE_TYPE_LEGENDARY') | d.require('BATTLE_TYPE_LEGENDARY_FRLG');
    setWaitState(runScriptedWildBattle(env, flags, [enemy], d.require('B_TRANSITION_BLUR'), song));
  },

  /** BufferMonNickname: nickname of party slot VAR_0x8004 into STR_VAR_1. */
  BufferMonNickname({ state }) {
    state.stringVars[0] = [...(state.party[state.getVar('VAR_0x8004')]?.nickname ?? [])];
  },
};

/**
 * StartScriptedWildBattle (battle_setup.c), for ScrCmd_dowildbattle: a BATTLE_TYPE_WILD_SCRIPTED battle against
 * the `setwildbattle` mon behind GetWildBattleTransition (Snorlax, Route 12 / 16; the Power Plant's Electrode;
 * Berry Forest's Hypno). Returns the wait for the script, which dowildbattle stops (ScriptContext_Stop) until
 * CB2_EndScriptedWildBattle is done; undefined (the script runs on) without a mon.
 */
/**
 * Add specials from field modules that draw with Phaser (world/vsSeeker.ts), registered at boot: this file is
 * reached from screens the battle unit tests load (isNationalDexEnabled), so it can't import them.
 */
export function registerSpecials(table: Record<string, Special>): void {
  Object.assign(SPECIALS, table);
}

export function StartScriptedWildBattle(env: SpecialEnv): (() => boolean) | undefined {
  const { state, host, warnOnce } = env;
  const enemy = state.enemyParty[0];
  if (!enemy) {
    warnOnce('dowildbattle', '[script] dowildbattle without a `setwildbattle` mon');
    return undefined;
  }
  // CreateBattleStartTask(GetWildBattleTransition(), 0): the battle's default music (MUS_VS_WILD)
  return runScriptedWildBattle(env, state.defines.require('BATTLE_TYPE_WILD_SCRIPTED'), [enemy], host.wildBattleTransition(enemy));
}

/**
 * The battle of StartScriptedWildBattle / StartLegendaryBattle (and StartSouthernIslandBattle /
 * StartGroudonKyogreBattle / StartRegiBattle, which nothing in FireRed calls), then CB2_EndScriptedWildBattle:
 * a loss whites out (CB2_WhiteOut never comes back to the script); otherwise
 * CB2_ReturnToFieldContinueScriptPlayMapMusic, whose ResumeMap runs the map's ON_RESUME script first (with
 * FLAG_SYS_SPECIAL_WILD_BATTLE still set, so Route 12 / 16 and the legendaries' maps remove the mon), and the
 * script continues once the field has faded back in. gBattleOutcome stays for GetBattleOutcome.
 */
function runScriptedWildBattle(env: SpecialEnv, battleTypeFlags: number, enemyParty: Pokemon[], transition: number, song = 0): () => boolean {
  const { host, endScript } = env;
  // LockPlayerFieldControls: the waiting script holds the field's input.
  // IncrementGameStat(GAME_STAT_TOTAL_BATTLES / _WILD_BATTLES): game stats aren't tracked yet
  const run = host.startScriptedBattle(battleTypeFlags, enemyParty, transition, song);
  let fadeIn: (() => boolean) | undefined;
  return () => {
    if (fadeIn) return fadeIn();
    if (!run.done()) return false;
    if (!run.playerWon()) {
      endScript();
      host.whiteOut();
      return true;
    }
    fadeIn = run.returnToField();
    return false;
  };
}

/**
 * PcTurnOnUpdateMetatileId / AnimatePcTurnOff: the PC is in front of the player (or diagonally above,
 * facing sideways); VAR_0x8004 picks a Pokémon Center PC (0) or the player's (1, 2).
 */
function setPcMetatile(state: GameState, host: ScriptHost, off: boolean): void {
  const d = state.defines;
  const facing = host.player.facing;
  const dx = facing === 'up' || facing === 'down' ? 0 : DELTA[facing].dx;
  const dy = facing === 'down' ? 0 : -1;
  const kind = state.getVar('VAR_0x8004');
  let metatile = 0;
  if (kind === 0) metatile = d.require(off ? 'METATILE_Building_PCOff' : 'METATILE_Building_PCOn');
  else if (kind === 1 || kind === 2) metatile = d.require(off ? 'METATILE_GenericBuilding1_PlayersPCOff' : 'METATILE_GenericBuilding1_PlayersPCOn');
  const { x, y } = host.playerLocal();
  host.setMetatile(x + dx, y + dy, metatile, true);
}

/** HealPlayerParty: full HP, PP (with PP Ups) and no status. */
export function healPlayerParty(state: GameState): void {
  for (const mon of state.party) {
    mon.hp = mon.maxHP;
    for (let j = 0; j < state.pokemon.c.MAX_MON_MOVES; j++) mon.pp[j] = state.pokemon.ppWithBonus(mon.moves[j], mon.ppBonuses, j);
    mon.status = 0;
  }
}

/** IsNationalPokedexEnabled (state/nationalDex.ts) */
export function isNationalDexEnabled(state: GameState): boolean {
  return IsNationalPokedexEnabled(state);
}

/** TryBattleLinkup / TryTradeLinkup without a link partner (see SPECIALS). */
function linkupWithNoPartner({ state, input, hideFieldMessageBox, setWaitState }: SpecialEnv): void {
  let tState = 0; // Task_LinkupStart's data[0]
  setWaitState(() => {
    if (tState <= 10) {
      tState++; // OpenLinkTimed etc. on the first frame; Task_LinkupAwaitConnection once data[0] > 9
      return false;
    }
    if (!input.pressed('B')) return false; // GetLinkPlayerCount_2() stays below 2
    state.setVar('VAR_RESULT', state.defines.require('LINKUP_FAILED'));
    hideFieldMessageBox();
    return true;
  });
}
