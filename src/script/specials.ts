import { moveName } from '../battle/message';
import { adjustFriendship } from '../battle/pokemonBattle';
import { ItemIdToBattleMoveId } from '../menus/partyMenu';
import type { GameState } from '../state/GameState';
import { DELTA } from '../world/direction';
import { animateElevator, getElevatorFloor, initElevatorFloorSelectMenuPos } from '../world/elevator';
import { initRoamer } from '../world/roamer';
import { isPoisoned } from '../world/stepCounters';
import { directionId, type ScriptHost } from './ScriptEngine';
import { ForcePlayerOntoBike, GetPlayerAvatarBike } from '../world/bike';
import { ForcePlayerToStartSurfing, GetPlayerFacingDirection, SeafoamIslandsB4F_CurrentDumpsPlayerOnLand } from '../world/playerAvatar';

export interface SpecialEnv {
  state: GameState;
  host: ScriptHost;
  /** For specials that start a task the script then blocks on with `waitstate` (ScriptContext_Stop/Enable). */
  setWaitState(done: () => boolean): void;
  /** ShowFieldMessage(label); the wait ends once it has printed (IsFieldMessageBoxHidden). */
  showFieldMessage(label: string): () => boolean;
  /** The special left the field (SetMainCallback2), so the script never resumes. */
  endScript(): void;
  warnOnce(key: string, message: string): void;
  /** DisableMsgBoxWalkaway (script.c) */
  disableMsgBoxWalkaway(): void;
  /** The extracted text `label` (e.g. gText_Ghost), encoded without the terminator. */
  encodeText(label: string): number[];
}

/** A gSpecials entry (data/specials.inc). The return value is stored by `specialvar`. */
export type Special = (env: SpecialEnv) => number | void;

/** Specials with no effect yet because the system they feed (audio, quest log, help, fame checker) doesn't exist. */
const NO_OP = [
  'PlayTrainerEncounterMusic', // audio
  'QuestLog_CutRecording', // quest log
  'SetHelpContextForMap', // help system
  'Script_SetHelpContext',
  'SetFlavorTextFlagFromSpecialVars', // fame checker
  'UpdatePickStateFromSpecialVar8005',
  'SetUnlockedPokedexFlags', // gcnLinkFlags, only used for GameCube link
  'Script_FadeOutMapMusic', // audio: its waitstate ends at once
  'InitUnionRoom', // wireless only (and stubbed out from REVISION 0xA): CableClub_OnResume in every Pokémon Center
];

export const SPECIALS: Record<string, Special> = {
  ...Object.fromEntries(NO_OP.map((name) => [name, () => {}])),

  // field_player_avatar.c / bike.c / field_specials.c's player avatar specials
  ForcePlayerOntoBike,
  ForcePlayerToStartSurfing,
  SeafoamIslandsB4F_CurrentDumpsPlayerOnLand,
  GetPlayerAvatarBike,
  /** GetPlayerFacingDirection: DIR_* */
  GetPlayerFacingDirection({ state }) {
    return directionId(GetPlayerFacingDirection(), state.defines);
  },

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

  /** PlayerPC (player_pc.c): the item storage menus aren't ported, so it goes straight back to the PC menu. */
  PlayerPC({ warnOnce }) {
    warnOnce('PlayerPC', '[special] PlayerPC (item storage) not implemented');
  },

  /** ShowPokemonStorageSystemPC (pokemon_storage_system.c): not ported, back to the PC menu. */
  ShowPokemonStorageSystemPC({ warnOnce }) {
    warnOnce('ShowPokemonStorageSystemPC', '[special] Pokémon Storage System not implemented');
  },

  /** HallOfFamePCBeginFade (hof_pc.c): the Hall of Fame screen isn't ported (only after the credits). */
  HallOfFamePCBeginFade({ warnOnce }) {
    warnOnce('HallOfFamePCBeginFade', '[special] Hall of Fame PC not implemented');
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

  /** GetQuestLogState: QL_STATE_* (0 = not recording or playing back). */
  GetQuestLogState() {
    return 0;
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

  /** BufferMonNickname: nickname of party slot VAR_0x8004 into STR_VAR_1. */
  BufferMonNickname({ state }) {
    state.stringVars[0] = [...(state.party[state.getVar('VAR_0x8004')]?.nickname ?? [])];
  },
};

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

/** IsNationalPokedexEnabled */
export function isNationalDexEnabled(state: GameState): boolean {
  return state.nationalDexEnabled && state.getVar('VAR_NATIONAL_DEX') === 0x6258 && state.getFlag('FLAG_SYS_NATIONAL_DEX');
}
