// help_system.c's contexts and lists, without the screen (so any module can set a context, and the unit tests can
// load it): the context (sHelpSystemContextId, a HELPCONTEXT_*) says which topics and submenu items the help shows.
// Every screen sets its own with SetHelpContext (or SetHelpContextDontCheckBattle, BackupHelpContext /
// RestoreHelpContext), the field with SetHelpContextForMap; HelpSystem_Disable / _Enable and
// HelpSystem_DisableToggleWithRButton / _EnableToggleWithRButton say whether L / R open it. The help's engine is
// ui/helpSystem.ts (help_system_util.c), its menus ui/helpSystemMenu.ts.
//
// The tables (the submenu ids, the label tables, the submenu lists by context and topic, the topic flags, the map
// lists) come from tools/extract_help.py (public/gen/helpSystem.json, set by Assets.init); the text is in
// text/strings.json (data/text/help_system.inc, src/strings.c).

import { K } from '../battle/constants';
import { charmap, state, textStrings } from '../battle/env';
import { GetKantoPokedexCount } from '../menus/pokedex';
import { gSave, SAVE_STATUS_EMPTY, SAVE_STATUS_INVALID } from '../state/save';

/** struct ListMenuItem as the help system uses it: an encoded label and an index (-2: EXIT / CANCEL). */
export interface HelpListMenuItem {
  label: number[];
  index: number;
}

/** struct HelpSystemListMenu */
export interface HelpSystemListMenu {
  sub: { items: HelpListMenuItem[]; totalItems: number; maxShowed: number; left: number; top: number };
  itemsAbove: number;
  cursorPos: number;
  state: number;
}

/** gHelpSystemEnabled (help_system_util.c): HelpSystem_Enable / HelpSystem_Disable. FALSE at boot (main.c); the title
 * screen (or BootScene, for the dev starts that skip it) enables it. */
export let gHelpSystemEnabled = false;
/** gHelpSystemToggleWithRButtonDisabled (help_system_util.c) */
export let gHelpSystemToggleWithRButtonDisabled = false;

// ------------------------------------------------------------------ data (helpSystem.json)

/** public/gen/helpSystem.json (tools/extract_help.py) */
export interface HelpSystemData {
  /** enum HelpSystemTopics: TOPIC_WHAT_TO_DO .. TOPIC_EXIT, TOPIC_COUNT */
  topics: Record<string, number>;
  /** The submenu ids (HELP_* of the file's enums), HELP_NONE and HELP_END */
  helpIds: Record<string, number>;
  /** The string tables by name: index -> strings.json label */
  labels: Record<string, (string | null)[]>;
  /** The submenu lists (sHowTo_Bag, sTerms_Basic, ...) without their HELP_END */
  lists: Record<string, number[]>;
  /** sHelpSystemSubmenuItemLists[HELPCONTEXT_COUNT][TOPIC_COUNT - 1]: list names */
  submenuItemLists: (string | null)[][];
  contextTopicOrder: number[];
  /** sHelpSystemContextTopicFlags[HELPCONTEXT_COUNT + 1][TOPIC_COUNT] */
  contextTopicFlags: boolean[][];
  martMaps: string[];
  gymMaps: string[];
  /** sDungeonMaps' rows, each expanded to its maps (row 15 is the Tanoby chambers) */
  dungeonMaps: string[][];
  /** save_location.c's sSaveLocationPokeCenterList (IsCurMapPokeCenter) */
  pokeCenterMaps: string[];
}

let sData: HelpSystemData | undefined;

/** Assets.init (and the unit tests) hand over helpSystem.json. */
export function initHelpSystemData(data: HelpSystemData): void {
  sData = data;
}

function data(): HelpSystemData {
  if (!sData) throw new Error('[help system] helpSystem.json not loaded');
  return sData;
}

/** A submenu id (HELP_*) by name. */
function hid(name: string): number {
  const v = data().helpIds[name];
  if (v === undefined) throw new Error(`[help system] unknown id ${name}`);
  return v;
}

const TOPIC_WHAT_TO_DO = 0;
const TOPIC_HOW_TO_DO = 1;
const TOPIC_TERMS = 2;
const TOPIC_ABOUT_GAME = 3;
export const TOPIC_EXIT = 5;
const TOPIC_COUNT = 6;
const HELP_END = 0xff;

const encoded = new Map<string, number[]>();

/** A help string (data/text/help_system.inc's Help_Text_*, strings.c's gString_* / gText_*) encoded, with EOS. */
export function helpString(label: string): number[] {
  let s = encoded.get(label);
  if (!s) {
    const raw = textStrings[label];
    if (raw === undefined) throw new Error(`[help system] unknown string ${label}`);
    s = charmap.encode(raw);
    encoded.set(label, s);
  }
  return s;
}

/** A label table's entry, encoded. */
export function label(table: string, index: number): number[] {
  const l = data().labels[table][index];
  if (!l) throw new Error(`[help system] ${table}[${index}] is NULL`);
  return helpString(l);
}

// ------------------------------------------------------------------ contexts

/** sHelpSystemContextId */
let sHelpSystemContextId = 0;
/** sSeenHelpSystemIntro */
let sSeenHelpSystemIntro = false;
/** gHelpContextIdBackup */
let gHelpContextIdBackup = 0;

/** struct HelpSystemState gHelpSystemState: level 0 topics / 1 submenu / 2 help item, the topic, the two cursors. */
export const gHelpSystemState = { level: 0, topic: 0, scrollMain: 0, scrollSub: 0 };

/** The current context (HELPCONTEXT_*), for the tests. */
export function GetHelpContext(): number {
  return sHelpSystemContextId;
}

export function SetHelpContextDontCheckBattle(contextId: number): void {
  sHelpSystemContextId = contextId;
}

/** SetHelpContext: a battle's context stays while its bag / party / summary screens are up. */
export function SetHelpContext(contextId: number): void {
  switch (sHelpSystemContextId) {
    case K.HELPCONTEXT_WILD_BATTLE:
    case K.HELPCONTEXT_TRAINER_BATTLE_SINGLE:
    case K.HELPCONTEXT_TRAINER_BATTLE_DOUBLE:
    case K.HELPCONTEXT_SAFARI_BATTLE:
      if (
        contextId === K.HELPCONTEXT_BAG ||
        contextId === K.HELPCONTEXT_PARTY_MENU ||
        contextId === K.HELPCONTEXT_POKEMON_INFO ||
        contextId === K.HELPCONTEXT_POKEMON_SKILLS ||
        contextId === K.HELPCONTEXT_POKEMON_MOVES
      )
        break;
    // fallthrough
    default:
      sHelpSystemContextId = contextId;
      break;
  }
}

/** Script_SetHelpContext (special SetHelpContext... in the scripts: `special Script_SetHelpContext`): VAR_0x8004. */
export function Script_SetHelpContext(var8004: number): void {
  sHelpSystemContextId = var8004;
}

/**
 * The battle's context, as CB2_InitBattle (battle_main.c) and ReshowBattleScreenAfterMenu (reshow_battle_screen.c)
 * both set it inline from gBattleTypeFlags (not in a link battle).
 */
export function SetHelpContextForBattle(battleTypeFlags: number): void {
  if (battleTypeFlags & K.BATTLE_TYPE_LINK) return;
  if (battleTypeFlags & K.BATTLE_TYPE_TRAINER)
    SetHelpContext(battleTypeFlags & K.BATTLE_TYPE_DOUBLE ? K.HELPCONTEXT_TRAINER_BATTLE_DOUBLE : K.HELPCONTEXT_TRAINER_BATTLE_SINGLE);
  else if (battleTypeFlags & K.BATTLE_TYPE_SAFARI) SetHelpContext(K.HELPCONTEXT_SAFARI_BATTLE);
  else SetHelpContext(K.HELPCONTEXT_WILD_BATTLE);
}

export function BackupHelpContext(): void {
  gHelpContextIdBackup = sHelpSystemContextId;
}

export function RestoreHelpContext(): void {
  sHelpSystemContextId = gHelpContextIdBackup;
}

/** What SetHelpContextForMap asks the field (OverworldScene sets it): gMapHeader.mapType and the avatar's flags. */
export interface HelpSystemFieldQuery {
  /** gMapHeader.mapType (MAP_TYPE_*) */
  mapType(): string;
  /** TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG_SURFING) */
  surfing(): boolean;
}

let sFieldQuery: HelpSystemFieldQuery | undefined;

export function SetHelpSystemFieldQuery(query: HelpSystemFieldQuery): void {
  sFieldQuery = query;
}

/** gSaveBlock1Ptr->location as a MAP_* id. */
function currentMapId(): string {
  return state.currentMapId;
}

/** IsInMartMap / IsInGymMap / IsCurMapPokeCenter: IsCurrentMapInArray */
function IsCurrentMapInArray(mapIds: string[]): boolean {
  return mapIds.includes(currentMapId());
}

/** IsInDungeonMap: sDungeonMaps' rows; row 15 (the Tanoby chambers) once FLAG_SYS_UNLOCKED_TANOBY_RUINS is set. */
function IsInDungeonMap(): boolean {
  const map = currentMapId();
  return data().dungeonMaps.some((row, i) => row.includes(map) && (i !== 15 || state.getFlag('FLAG_SYS_UNLOCKED_TANOBY_RUINS') === true));
}

/** IsMapTypeIndoors */
function IsMapTypeIndoors(mapType: string): boolean {
  return mapType === 'MAP_TYPE_INDOOR' || mapType === 'MAP_TYPE_SECRET_BASE';
}

/** SetHelpContextForMap: on every map load and return to the field (overworld.c), and after getting off Surf. */
export function SetHelpContextForMap(): void {
  HelpSystem_EnableToggleWithRButton();
  const field = sFieldQuery;
  if (!field) return;
  const map = currentMapId();
  if (field.surfing()) SetHelpContext(K.HELPCONTEXT_SURFING);
  else if (IsInDungeonMap()) SetHelpContext(K.HELPCONTEXT_DUNGEON);
  else if (IsMapTypeIndoors(field.mapType())) {
    if (map === 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F' || map === 'MAP_PALLET_TOWN_PLAYERS_HOUSE_2F') SetHelpContext(K.HELPCONTEXT_PLAYERS_HOUSE);
    else if (map === 'MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB') SetHelpContext(K.HELPCONTEXT_OAKS_LAB);
    else if (IsCurrentMapInArray(data().pokeCenterMaps)) SetHelpContext(K.HELPCONTEXT_POKECENTER);
    else if (IsCurrentMapInArray(data().martMaps)) SetHelpContext(K.HELPCONTEXT_MART);
    else if (IsCurrentMapInArray(data().gymMaps)) SetHelpContext(K.HELPCONTEXT_GYM);
    else SetHelpContext(K.HELPCONTEXT_INDOORS);
  } else SetHelpContext(K.HELPCONTEXT_OVERWORLD);
}

/** HelpSystem_UpdateHasntSeenIntro: TRUE (once) to show the welcome page; FLAG_SYS_SAW_HELP_SYSTEM_INTRO is saved. */
export function HelpSystem_UpdateHasntSeenIntro(): boolean {
  if (sSeenHelpSystemIntro === true) return false;
  if (gSave.fileStatus !== SAVE_STATUS_EMPTY && gSave.fileStatus !== SAVE_STATUS_INVALID && state.getFlag('FLAG_SYS_SAW_HELP_SYSTEM_INTRO')) return false;
  state.setFlag('FLAG_SYS_SAW_HELP_SYSTEM_INTRO');
  sSeenHelpSystemIntro = true;
  return true;
}

/** HelpSystem_IsSinglePlayer: gReceivedRemoteLinkPlayers is never TRUE (no link play: GAPS_PLAN.md decision 4). */
export function HelpSystem_IsSinglePlayer(): boolean {
  return true;
}

export function HelpSystem_Disable(): void {
  gHelpSystemEnabled = false;
}

/** HelpSystem_Enable (not during a quest log playback: there's no quest log). */
export function HelpSystem_Enable(): void {
  gHelpSystemEnabled = true;
  HelpSystem_EnableToggleWithRButton();
}

export function HelpSystem_DisableToggleWithRButton(): void {
  gHelpSystemToggleWithRButtonDisabled = true;
}

export function HelpSystem_EnableToggleWithRButton(): void {
  gHelpSystemToggleWithRButtonDisabled = false;
}

/** A soft reset's RAM clear: the welcome page shows again, the context is HELPCONTEXT_NONE. */
export function ResetHelpSystemState(): void {
  sSeenHelpSystemIntro = false;
  sHelpSystemContextId = 0;
  gHelpContextIdBackup = 0;
  Object.assign(gHelpSystemState, { level: 0, topic: 0, scrollMain: 0, scrollSub: 0 });
}


// ------------------------------------------------------------------ building the lists

export function BuildMainTopicsListAndMoveToH00(helpListMenu: HelpSystemListMenu, listMenuItemsBuffer: HelpListMenuItem[]): void {
  const d = data();
  let totalItems = 0;
  for (let i = 0; i < TOPIC_COUNT; i++) {
    const topic = d.contextTopicOrder[i];
    if (d.contextTopicFlags[sHelpSystemContextId][topic] === true) {
      listMenuItemsBuffer[totalItems].label = label('sHelpSystemTopicPtrs', topic);
      listMenuItemsBuffer[totalItems].index = topic;
      totalItems++;
    }
  }
  listMenuItemsBuffer[totalItems - 1].index = -2;
  helpListMenu.sub.totalItems = totalItems;
  helpListMenu.sub.maxShowed = totalItems;
  helpListMenu.sub.left = 0;
}

export const QUESTION_TABLES = ['sHelpSystemSpecializedQuestionTextPtrs', 'sHelpSystemMenuTopicTextPtrs', 'sHelpSystemTermTextPtrs', 'sHelpSystemGeneralTopicTextPtrs', 'sHelpSystemTypeMatchupTextPtrs'];
export const ANSWER_TABLES = [
  'sHelpSystemSpecializedAnswerTextPtrs',
  'sHelpSystemHowToUseMenuTextPtrs',
  'sHelpSystemTermDefinitionsTextPtrs',
  'sHelpSystemGeneralTopicDescriptionTextPtrs',
  'sHelpSystemTypeMatchupDescriptionTextPtrs',
];

/** SetHelpSystemSubmenuItems: the context's list for the topic, the enabled items, sTerms_Basic, then CANCEL (-2). */
export function SetHelpSystemSubmenuItems(helpListMenu: HelpSystemListMenu, listMenuItemsBuffer: HelpListMenuItem[]): void {
  const d = data();
  let totalItems = 0;
  const listName = d.submenuItemLists[sHelpSystemContextId][gHelpSystemState.topic];
  const submenuItems = listName ? d.lists[listName] : [];
  for (const id of submenuItems) {
    if (id === HELP_END) break;
    if (IsHelpSystemSubmenuEnabled(id) === true) {
      listMenuItemsBuffer[totalItems].label = label(QUESTION_TABLES[gHelpSystemState.topic], id);
      listMenuItemsBuffer[totalItems].index = id;
      totalItems++;
    }
  }
  if (HelpSystem_ShouldShowBasicTerms() === true) {
    for (const id of d.lists.sTerms_Basic) {
      listMenuItemsBuffer[totalItems].label = label('sHelpSystemTermTextPtrs', id);
      listMenuItemsBuffer[totalItems].index = id;
      totalItems++;
    }
  }
  listMenuItemsBuffer[totalItems].label = helpString('Help_Text_Cancel');
  listMenuItemsBuffer[totalItems].index = -2;
  totalItems++;
  helpListMenu.sub.totalItems = totalItems;
  helpListMenu.sub.maxShowed = 7;
  helpListMenu.sub.left = 0;
  helpListMenu.sub.top = 21;
}

/** HelpSystem_ShouldShowBasicTerms: after Brock, TERMS lists sTerms_Basic too. */
export function HelpSystem_ShouldShowBasicTerms(): boolean {
  return state.getFlag('FLAG_DEFEATED_BROCK') === true && gHelpSystemState.topic === TOPIC_TERMS;
}

const flag = (name: string): boolean => state.getFlag(name);
const anyOf = (id: number, names: string[]): boolean => names.some((n) => hid(n) === id);

/** IsHelpSystemSubmenuEnabled: whether item `id` of gHelpSystemState.topic is shown, by the story's flags. */
export function IsHelpSystemSubmenuEnabled(id: number): boolean {
  const topic = gHelpSystemState.topic;
  if (topic === TOPIC_WHAT_TO_DO) {
    // prettier-ignore
    if (anyOf(id, ['HELP_PLAYING_FOR_FIRST_TIME', 'HELP_WHAT_SHOULD_I_BE_DOING', 'HELP_CANT_GET_OUT_OF_ROOM', 'HELP_TALKED_TO_EVERYONE_NOW_WHAT', 'HELP_OUT_OF_THINGS_TO_DO', 'HELP_NOTHING_I_WANT_TO_KNOW', 'HELP_WHATS_A_MON', 'HELP_WHAT_DO_I_DO_IN_SAFARI', 'HELP_WHAT_ARE_SAFARI_RULES', 'HELP_WANT_TO_END_SAFARI']))
      return true;
    if (anyOf(id, ['HELP_CANT_FIND_PERSON_I_WANT'])) return flag('FLAG_VISITED_OAKS_LAB');
    // prettier-ignore
    if (anyOf(id, ['HELP_SOMEONE_BLOCKING_MY_WAY', 'HELP_WHAT_ARE_MY_ADVENTURE_BASICS', 'HELP_HOW_DO_I_PREPARE_FOR_BATTLE', 'HELP_WHAT_IS_STATUS_PROBLEM', 'HELP_RAN_OUT_OF_POTIONS', 'HELP_WHATS_POKEMON_CENTER', 'HELP_WHATS_POKEMON_MART']))
      return flag('FLAG_WORLD_MAP_VIRIDIAN_CITY');
    if (anyOf(id, ['HELP_I_CANT_GO_ON'])) return flag('FLAG_WORLD_MAP_VERMILION_CITY');
    if (anyOf(id, ['HELP_HOW_ARE_ROADS_FORESTS_DIFFERENT', 'HELP_WHATS_A_TRAINER'])) return flag('FLAG_WORLD_MAP_VIRIDIAN_FOREST');
    // prettier-ignore
    if (anyOf(id, ['HELP_WHAT_HAPPENED_TO_ITEM_I_GOT', 'HELP_WHEN_CAN_I_USE_ITEM', 'HELP_HOW_DO_I_PROGRESS', 'HELP_WHATS_A_BATTLE', 'HELP_WHAT_IS_A_MONS_VITALITY', 'HELP_MY_MONS_ARE_HURT', 'HELP_WHAT_HAPPENS_IF_ALL_MY_MONS_FAINT', 'HELP_WHERE_DO_MONS_APPEAR', 'HELP_WHAT_MOVES_SHOULD_I_USE', 'HELP_WANT_TO_MAKE_MON_STRONGER', 'HELP_WANT_TO_END_GAME']))
      return flag('FLAG_SYS_POKEMON_GET');
    if (anyOf(id, ['HELP_CANT_CATCH_MONS', 'HELP_CAN_I_BUY_POKEBALLS'])) return flag('FLAG_SYS_POKEDEX_GET');
    // prettier-ignore
    if (anyOf(id, ['HELP_HOW_ARE_CAVES_DIFFERENT', 'HELP_WHAT_DO_I_DO_IN_CAVE', 'HELP_HOW_DO_I_WIN_AGAINST_TRAINER', 'HELP_FOE_MONS_TOO_STRONG', 'HELP_WHAT_ARE_MOVES', 'HELP_WANT_TO_ADD_MORE_MOVES']))
      return flag('FLAG_BADGE01_GET');
    if (anyOf(id, ['HELP_WHAT_ARE_HIDDEN_MOVES', 'HELP_WHAT_DOES_HIDDEN_MOVE_DO'])) return HasGottenAtLeastOneHM();
    if (anyOf(id, ['HELP_WHAT_IS_THAT_PERSON_LIKE'])) return flag('FLAG_GOT_FAME_CHECKER');
    if (anyOf(id, ['HELP_WHAT_IS_A_GYM'])) return flag('FLAG_WORLD_MAP_PEWTER_CITY');
    return false;
  }
  if (topic === TOPIC_HOW_TO_DO) {
    // prettier-ignore
    if (anyOf(id, ['HELP_USING_BAG', 'HELP_USING_PLAYER', 'HELP_USING_SAVE', 'HELP_USING_OPTION', 'HELP_ENTERING_NAME', 'HELP_USING_PC', 'HELP_USING_BILLS_PC', 'HELP_USING_WITHDRAW', 'HELP_USING_DEPOSIT', 'HELP_USING_MOVE', 'HELP_MOVING_ITEMS', 'HELP_USING_PLAYERS_PC', 'HELP_USING_WITHDRAW_ITEM', 'HELP_USING_DEPOSIT_ITEM', 'HELP_USING_MAILBOX', 'HELP_OPENING_MENU', 'HELP_USING_BAG2', 'HELP_USING_HOME_PC', 'HELP_USING_ITEM_STORAGE', 'HELP_USING_WITHDRAW_ITEM2', 'HELP_USING_DEPOSIT_ITEM2', 'HELP_USING_MAILBOX2', 'HELP_USING_BALL', 'HELP_USING_BAIT', 'HELP_USING_ROCK']))
      return true;
    if (anyOf(id, ['HELP_USING_POKEDEX', 'HELP_USING_PROF_OAKS_PC', 'HELP_READING_POKEDEX'])) return flag('FLAG_SYS_POKEDEX_GET');
    if (anyOf(id, ['HELP_USING_TOWN_MAP'])) return state.bag.has(K.ITEM_TOWN_MAP, 1);
    // prettier-ignore
    if (anyOf(id, ['HELP_USING_POKEMON', 'HELP_USING_SUMMARY', 'HELP_USING_ITEM', 'HELP_USING_AN_ITEM', 'HELP_USING_KEYITEM', 'HELP_USING_POKEBALL', 'HELP_USING_POTION', 'HELP_USING_FIGHT', 'HELP_USING_POKEMON2', 'HELP_USING_SUMMARY2', 'HELP_USING_RUN', 'HELP_REGISTER_KEY_ITEM']))
      return flag('FLAG_SYS_POKEMON_GET');
    // only once the player has caught a mon after the starter
    if (anyOf(id, ['HELP_USING_SWITCH', 'HELP_USING_SHIFT'])) return GetKantoPokedexCount(state, 1) > 1;
    if (anyOf(id, ['HELP_USING_TM'])) return flag('FLAG_BADGE01_GET');
    if (anyOf(id, ['HELP_USING_HM', 'HELP_USING_MOVE_OUTSIDE_OF_BATTLE'])) return HasGottenAtLeastOneHM();
    if (anyOf(id, ['HELP_RIDING_BICYCLE'])) return flag('FLAG_GOT_BICYCLE');
    if (anyOf(id, ['HELP_USING_HALL_OF_FAME'])) return flag('FLAG_SYS_GAME_CLEAR');
    return false;
  }
  if (topic === TOPIC_TERMS) {
    // After Brock all the basic terms are added at the end: not twice
    if (HelpSystem_ShouldShowBasicTerms() === true && data().lists.sTerms_Basic.includes(id)) return false;
    // prettier-ignore
    if (anyOf(id, ['HELP_TERM_MONEY', 'HELP_TERM_ID_NO', 'HELP_TERM_ITEMS', 'HELP_TERM_KEYITEMS', 'HELP_TERM_POKEBALLS', 'HELP_TERM_POKEDEX', 'HELP_TERM_PLAY_TIME', 'HELP_TERM_BADGES', 'HELP_TERM_TEXT_SPEED', 'HELP_TERM_BATTLE_SCENE', 'HELP_TERM_BATTLE_STYLE', 'HELP_TERM_SOUND', 'HELP_TERM_BUTTON_MODE', 'HELP_TERM_FRAME', 'HELP_TERM_CANCEL', 'HELP_TERM_TM', 'HELP_TERM_EVOLUTION']))
      return true;
    // prettier-ignore
    if (anyOf(id, ['HELP_TERM_HP', 'HELP_TERM_EXP', 'HELP_TERM_ATTACK', 'HELP_TERM_DEFENSE', 'HELP_TERM_SPATK', 'HELP_TERM_SPDEF', 'HELP_TERM_SPEED', 'HELP_TERM_LEVEL', 'HELP_TERM_TYPE', 'HELP_TERM_OT', 'HELP_TERM_ITEM', 'HELP_TERM_ABILITY', 'HELP_TERM_NATURE', 'HELP_TERM_POWER', 'HELP_TERM_ACCURACY', 'HELP_TERM_FNT']))
      return flag('FLAG_SYS_POKEMON_GET');
    if (anyOf(id, ['HELP_TERM_HM', 'HELP_TERM_HM_MOVE'])) return HasGottenAtLeastOneHM();
    if (anyOf(id, ['HELP_TERM_MOVES', 'HELP_TERM_MOVE_TYPE', 'HELP_TERM_PP', 'HELP_TERM_STATUS_PROBLEM'])) return flag('FLAG_WORLD_MAP_VIRIDIAN_FOREST');
    return true;
  }
  if (topic === TOPIC_ABOUT_GAME) {
    if (anyOf(id, ['HELP_GAME_FUNDAMENTALS_2'])) return flag('FLAG_BADGE01_GET');
    if (anyOf(id, ['HELP_GAME_FUNDAMENTALS_3'])) return flag('FLAG_BADGE02_GET');
    return true;
  }
  return true; // TOPIC_TYPE_MATCHUP
}

/** HasGottenAtLeastOneHM: HM01-06's flags, or HM07's ball gone from Icefall Cave. */
export function HasGottenAtLeastOneHM(): boolean {
  return ['FLAG_GOT_HM01', 'FLAG_GOT_HM02', 'FLAG_GOT_HM03', 'FLAG_GOT_HM04', 'FLAG_GOT_HM05', 'FLAG_GOT_HM06', 'FLAG_HIDE_FOUR_ISLAND_ICEFALL_CAVE_1F_HM07'].some(flag);
}

