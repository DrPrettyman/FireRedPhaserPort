// The script features the port doesn't handle yet: what tests/unit/scriptCoverage.test.ts expects to find
// missing. Names only. Each is tagged by where the game needs it (read the decomp scripts that use it):
//   main      on the main path to the Hall of Fame (a gym, a story event, a Pokémon Center). "BLOCKER" in the
//             note: the story can't go on without it; otherwise the script logs it once and runs on.
//   side      optional content before the Hall of Fame (NPCs, trades, the Game Corner, the Route 5 daycare,
//             the Sevii 1-3 trip, which can be declined).
//   postgame  only after the Hall of Fame (Sevii 4-7, Trainer Tower, the event islands), incl. features that
//             postgame areas share with the link rooms.
//   link      link cable / wireless (union room, cable club, minigames, Mystery Gift, e-Reader).
// What FRLG compiles but no FRLG map reaches (Std_ObtainDecoration, EventScript_DeepWater) is ported as the C has
// it, stubs included, so it needs no tag.
// `where` lists the maps whose scripts reach it, or `(Label)` for code no map reaches (started from C);
// it isn't checked. When you port one, take it off the list (the test says so).

export type GapKind = 'command' | 'special' | 'std' | 'movement' | 'fieldeffect';
export type GapTag = 'main' | 'side' | 'postgame' | 'link';

export interface KnownGap {
  kind: GapKind;
  /** The command / special / movement macro name, the STD_* or MSGBOX_* id, or the FLDEFF_* id. */
  name: string;
  tag: GapTag;
  where: string;
  note?: string;
}

export const KNOWN_GAPS: KnownGap[] = [
  // ---------------------------------------------------------------- main: on the main path to the Hall of Fame. BLOCKER in the note = the story can't go on without it.
  // (none left: the S.S. Anne departure and the league lighting were the last two, batch 2 of SIDE_PLAN.md)
  // ---------------------------------------------------------------- side: optional content before the Hall of Fame (NPCs, trades, the Game Corner, the daycare, the Sevii 1-3 trip).
  // ---------------------------------------------------------------- postgame: after the Hall of Fame (Sevii 4-7, Trainer Tower, the event islands) or the link features postgame areas share.
  { kind: 'command', name: 'doweather', tag: 'postgame', where: "NavelRock_Summit, SevenIsland_TanobyRuins_DilfordChamber, SevenIsland_TanobyRuins_LiptooChamber, SevenIsland_TanobyRuins_MoneanChamber, SevenIsland_TanobyRuins_RixyChamber, ... (8 in all)" },
  { kind: 'command', name: 'setstepcallback', tag: 'postgame', where: "FourIsland_IcefallCave_1F" },
  { kind: 'command', name: 'setweather', tag: 'postgame', where: "NavelRock_Summit, SevenIsland_TanobyRuins_DilfordChamber, SevenIsland_TanobyRuins_LiptooChamber, SevenIsland_TanobyRuins_MoneanChamber, SevenIsland_TanobyRuins_RixyChamber, ... (8 in all)" },
  { kind: 'command', name: 'ttower_checkdoubles', tag: 'postgame', where: "TrainerTower_1F, TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, ... (8 in all)" },
  { kind: 'command', name: 'ttower_checkfinaltime', tag: 'postgame', where: "TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, TrainerTower_6F, ... (8 in all)" },
  { kind: 'command', name: 'ttower_clearedfloor', tag: 'postgame', where: "TrainerTower_1F, TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, ... (10 in all)" },
  { kind: 'command', name: 'ttower_dobattle', tag: 'postgame', where: "TrainerTower_1F, TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, ... (10 in all)" },
  { kind: 'command', name: 'ttower_encountermusic', tag: 'postgame', where: "TrainerTower_1F, TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, ... (10 in all)" },
  { kind: 'command', name: 'ttower_getbeatchallenge', tag: 'postgame', where: "TrainerTower_Lobby" },
  { kind: 'command', name: 'ttower_getchallengestatus', tag: 'postgame', where: "TrainerTower_Lobby" },
  { kind: 'command', name: 'ttower_getchallengetype', tag: 'postgame', where: "TrainerTower_1F, TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, ... (10 in all)" },
  { kind: 'command', name: 'ttower_getnumfloors', tag: 'postgame', where: "TrainerTower_Lobby" },
  { kind: 'command', name: 'ttower_getownerstate', tag: 'postgame', where: "TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, TrainerTower_6F, ... (8 in all)" },
  { kind: 'command', name: 'ttower_getspeech', tag: 'postgame', where: "TrainerTower_1F, TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, ... (10 in all)" },
  { kind: 'command', name: 'ttower_gettime', tag: 'postgame', where: "(TrainerTower_EventScript_ShowTime)" },
  { kind: 'command', name: 'ttower_giveprize', tag: 'postgame', where: "TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, TrainerTower_6F, ... (8 in all)" },
  { kind: 'command', name: 'ttower_initfloor', tag: 'postgame', where: "TrainerTower_1F, TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, ... (8 in all)" },
  { kind: 'command', name: 'ttower_isfloorcleared', tag: 'postgame', where: "TrainerTower_1F, TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, ... (10 in all)" },
  { kind: 'command', name: 'ttower_resumetimer', tag: 'postgame', where: "TrainerTower_1F, TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, ... (11 in all)" },
  { kind: 'command', name: 'ttower_setlost', tag: 'postgame', where: "TrainerTower_1F, TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, ... (10 in all)" },
  { kind: 'command', name: 'ttower_shouldexit', tag: 'postgame', where: "TrainerTower_1F, TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, ... (11 in all)" },
  { kind: 'command', name: 'ttower_startchallenge', tag: 'postgame', where: "TrainerTower_Lobby" },
  { kind: 'command', name: 'warphole', tag: 'postgame', where: "(EventScript_FallDownHole), FourIsland_IcefallCave_1F" },
  { kind: 'special', name: 'CallTrainerTowerFunc', tag: 'postgame', where: "TrainerTower_1F, TrainerTower_2F, TrainerTower_3F, TrainerTower_4F, TrainerTower_5F, ... (10 in all)" },
  { kind: 'special', name: 'CompareHeracrossSize', tag: 'postgame', where: "SixIsland_WaterPath_House1" },
  { kind: 'special', name: 'DoDeoxysTriangleInteraction', tag: 'postgame', where: "BirthIsland_Exterior" },
  { kind: 'special', name: 'GetHeracrossSizeRecordInfo', tag: 'postgame', where: "SixIsland_WaterPath_House1" },
  { kind: 'special', name: 'LoopWingFlapSound', tag: 'postgame', where: "NavelRock_Summit" },
  { kind: 'special', name: 'SampleResortGorgeousMonAndReward', tag: 'postgame', where: "FiveIsland_ResortGorgeous_House" },
  { kind: 'special', name: 'SetDeoxysTrianglePalette', tag: 'postgame', where: "BirthIsland_Exterior" },
  { kind: 'special', name: 'SetIcefallCaveCrackedIceMetatiles', tag: 'postgame', where: "FourIsland_IcefallCave_1F" },
  { kind: 'special', name: 'SetPostgameFlags', tag: 'postgame', where: "OneIsland_PokemonCenter_1F" },
  { kind: 'special', name: 'ShakeScreen', tag: 'postgame', where: "(CaveOfOrigin_EventScript_Shake), NavelRock_Base, SevenIsland_SevaultCanyon_TanobyKey, SixIsland_DottedHole_SapphireRoom" },
  { kind: 'special', name: 'ShowBattleRecords', tag: 'postgame', where: "(CableClub_EventScript_ShowBattleRecords), TrainerTower_Lobby" },
  { kind: 'special', name: 'StickerManGetBragFlags', tag: 'postgame', where: "FourIsland_House2" },
  { kind: 'special', name: 'UpdateLoreleiDollCollection', tag: 'postgame', where: "FourIsland_LoreleisHouse" },
  { kind: 'movement', name: 'disable_anim', tag: 'postgame', where: "SixIsland_DottedHole_SapphireRoom" },
  { kind: 'movement', name: 'restore_anim', tag: 'postgame', where: "SixIsland_DottedHole_SapphireRoom" },
  { kind: 'fieldeffect', name: 'FLDEFF_DESTROY_DEOXYS_ROCK', tag: 'postgame', where: "BirthIsland_Exterior" },
  // ---------------------------------------------------------------- link: link cable / wireless features (union room, cable club, minigames, Mystery Gift, e-Reader).
  { kind: 'command', name: 'erasebox', tag: 'link', where: "(TradeCenter_ConfirmLeaveRoom), CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, ... (21 in all)" },
  { kind: 'command', name: 'hideobjectat', tag: 'link', where: "CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, FourIsland_PokemonCenter_2F, ... (20 in all)" },
  { kind: 'command', name: 'trywondercardscript', tag: 'link', where: "CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, FourIsland_PokemonCenter_2F, ... (19 in all)" },
  { kind: 'command', name: 'warpspinenter', tag: 'link', where: "CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, FourIsland_PokemonCenter_2F, ... (19 in all)" },
  { kind: 'special', name: 'BufferEReaderTrainerGreeting', tag: 'link', where: "SevenIsland_House_Room2" },
  { kind: 'special', name: 'BufferEReaderTrainerName', tag: 'link', where: "SevenIsland_House_Room1" },
  { kind: 'special', name: 'ChooseHalfPartyForBattle', tag: 'link', where: "BattleColosseum_4P, SevenIsland_House_Room1" },
  { kind: 'special', name: 'ChooseMonForWirelessMinigame', tag: 'link', where: "TwoIsland_JoyfulGameCorner" },
  { kind: 'special', name: 'CleanupLinkRoomState', tag: 'link', where: "(CableClub_EventScript_DoLinkRoomExit)" },
  { kind: 'special', name: 'DisplayBerryPowderVendorMenu', tag: 'link', where: "CeruleanCity_House5" },
  { kind: 'special', name: 'DoCableClubWarp', tag: 'link', where: "(CableClub_EventScript_CableClubWarp), CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, ... (20 in all)" },
  { kind: 'special', name: 'DoesPartyHaveEnigmaBerry', tag: 'link', where: "CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, FourIsland_PokemonCenter_2F, ... (19 in all)" },
  { kind: 'special', name: 'EnterColosseumPlayerSpot', tag: 'link', where: "BattleColosseum_2P, BattleColosseum_4P" },
  { kind: 'special', name: 'EnterTradeSeat', tag: 'link', where: "(TradeCenter_EventScript_Chair2), (TradeCenter_EventScript_Chair3), TradeCenter" },
  { kind: 'special', name: 'ExitLinkRoom', tag: 'link', where: "(TradeCenter_TerminateLink)" },
  { kind: 'special', name: 'HasAtLeastOneBerry', tag: 'link', where: "CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, FourIsland_PokemonCenter_2F, ... (19 in all)" },
  { kind: 'special', name: 'IsDodrioInParty', tag: 'link', where: "TwoIsland_JoyfulGameCorner" },
  { kind: 'special', name: 'IsPokemonJumpSpeciesInParty', tag: 'link', where: "TwoIsland_JoyfulGameCorner" },
  { kind: 'special', name: 'LoadPlayerBag', tag: 'link', where: "CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, FourIsland_PokemonCenter_2F, ... (19 in all)" },
  { kind: 'special', name: 'LoadPlayerParty', tag: 'link', where: "SevenIsland_House_Room1, SevenIsland_House_Room2" },
  { kind: 'special', name: 'PrintPlayerBerryPowderAmount', tag: 'link', where: "CeruleanCity_House5" },
  { kind: 'special', name: 'QuestLog_StartRecordingInputsAfterDeferredEvent', tag: 'link', where: "CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, FourIsland_PokemonCenter_2F, ... (20 in all)" },
  { kind: 'special', name: 'ReducePlayerPartyToThree', tag: 'link', where: "SevenIsland_House_Room1" },
  { kind: 'special', name: 'RemoveBerryPowderVendorMenu', tag: 'link', where: "CeruleanCity_House5" },
  { kind: 'special', name: 'ReturnFromLinkRoom', tag: 'link', where: "(CableClub_EventScript_DoLinkRoomExit)" },
  { kind: 'special', name: 'RunUnionRoom', tag: 'link', where: "CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, FourIsland_PokemonCenter_2F, ... (20 in all)" },
  { kind: 'special', name: 'SavePlayerParty', tag: 'link', where: "CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, FourIsland_PokemonCenter_2F, ... (20 in all)" },
  { kind: 'special', name: 'Script_ClearHeldMovement', tag: 'link', where: "BattleColosseum_2P, TradeCenter" },
  { kind: 'special', name: 'Script_FacePlayer', tag: 'link', where: "BattleColosseum_2P, TradeCenter" },
  { kind: 'special', name: 'Script_HasEnoughBerryPowder', tag: 'link', where: "CeruleanCity_House5" },
  { kind: 'special', name: 'Script_ResetUnionRoomTrade', tag: 'link', where: "CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, FourIsland_PokemonCenter_2F, ... (19 in all)" },
  { kind: 'special', name: 'Script_ShowLinkTrainerCard', tag: 'link', where: "(CableClub_EventScript_ReadTrainerCard), (CableClub_EventScript_ReadTrainerCardColored)" },
  { kind: 'special', name: 'Script_TakeBerryPowder', tag: 'link', where: "CeruleanCity_House5" },
  { kind: 'special', name: 'SetCableClubWarp', tag: 'link', where: "(CableClub_EventScript_CableClubWarp), CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, ... (20 in all)" },
  { kind: 'special', name: 'SetEReaderTrainerGfxId', tag: 'link', where: "SevenIsland_House_Room2" },
  { kind: 'special', name: 'ShowBerryCrushRankings', tag: 'link', where: "CeruleanCity_House5" },
  { kind: 'special', name: 'ShowDodrioBerryPickingRecords', tag: 'link', where: "TwoIsland_JoyfulGameCorner" },
  { kind: 'special', name: 'ShowPokemonJumpRecords', tag: 'link', where: "TwoIsland_JoyfulGameCorner" },
  { kind: 'special', name: 'ShowWirelessCommunicationScreen', tag: 'link', where: "(CableClub_EventScript_ShowWirelessCommunicationScreen)" },
  { kind: 'special', name: 'StartSpecialBattle', tag: 'link', where: "SevenIsland_House_Room2" },
  { kind: 'special', name: 'TryBecomeLinkLeader', tag: 'link', where: "CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, FourIsland_PokemonCenter_2F, ... (20 in all)" },
  { kind: 'special', name: 'TryJoinLinkGroup', tag: 'link', where: "CeladonCity_PokemonCenter_2F, CeruleanCity_PokemonCenter_2F, CinnabarIsland_PokemonCenter_2F, FiveIsland_PokemonCenter_2F, FourIsland_PokemonCenter_2F, ... (20 in all)" },
  { kind: 'special', name: 'ValidateEReaderTrainer', tag: 'link', where: "SevenIsland_House_Room1" },
  { kind: 'special', name: 'WonderNews_GetRewardInfo', tag: 'link', where: "CeruleanCity_House4" },
];
