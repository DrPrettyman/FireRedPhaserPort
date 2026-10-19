// help_system.c's contexts and lists (ui/helpSystemContext.ts) on helpSystem.json: SetHelpContext's battle rule,
// BackupHelpContext / RestoreHelpContext, SetHelpContextForMap, the topics each context lists, a submenu's items by
// the story's flags, the basic terms after Brock, HelpSystem_UpdateHasntSeenIntro. Expected values are written out
// from the decomp's tables (sHelpSystemContextTopicFlags, sWhatToDo_Overworld, sTerms_Basic, ...).

import { beforeEach, describe, expect, test } from 'vitest';
import { setTextStrings } from '../../src/battle/env';
import {
  BackupHelpContext,
  BuildMainTopicsListAndMoveToH00,
  GetHelpContext,
  gHelpSystemState,
  gHelpSystemToggleWithRButtonDisabled,
  HelpSystem_DisableToggleWithRButton,
  HelpSystem_UpdateHasntSeenIntro,
  initHelpSystemData,
  ResetHelpSystemState,
  RestoreHelpContext,
  SetHelpContext,
  SetHelpContextDontCheckBattle,
  SetHelpContextForMap,
  SetHelpSystemFieldQuery,
  SetHelpSystemSubmenuItems,
  type HelpListMenuItem,
  type HelpSystemData,
  type HelpSystemListMenu,
} from '../../src/ui/helpSystemContext';
import { newBattleEnv, readGen, type TestGame } from './gameData';

let game: TestGame;
const data = readGen<HelpSystemData>('helpSystem.json');
const id = (name: string) => data.helpIds[name];
const ctx = (name: string) => game.d(`HELPCONTEXT_${name}`);

const newMenu = (): { menu: HelpSystemListMenu; items: HelpListMenuItem[] } => {
  const items = Array.from({ length: 52 }, () => ({ label: [0xff], index: 0 }));
  return { menu: { sub: { items, totalItems: 0, maxShowed: 0, left: 0, top: 0 }, itemsAbove: 0, cursorPos: 0, state: 0 }, items };
};

/** The topic indices BuildMainTopicsListAndMoveToH00 lists for `context` (EXIT as -2). */
function topics(context: string): number[] {
  SetHelpContextDontCheckBattle(ctx(context));
  const { menu, items } = newMenu();
  BuildMainTopicsListAndMoveToH00(menu, items);
  return items.slice(0, menu.sub.totalItems).map((it) => it.index);
}

/** The submenu ids SetHelpSystemSubmenuItems lists for `context` and `topic` (CANCEL as -2). */
function submenu(context: string, topic: number): number[] {
  SetHelpContextDontCheckBattle(ctx(context));
  gHelpSystemState.topic = topic;
  const { menu, items } = newMenu();
  SetHelpSystemSubmenuItems(menu, items);
  return items.slice(0, menu.sub.totalItems).map((it) => it.index);
}

beforeEach(async () => {
  game = await newBattleEnv();
  setTextStrings(readGen('text/strings.json'));
  initHelpSystemData(data);
  ResetHelpSystemState();
});

describe('contexts', () => {
  test("SetHelpContext keeps a battle's context for its bag, party and summary screens", () => {
    SetHelpContext(ctx('WILD_BATTLE'));
    for (const screen of ['BAG', 'PARTY_MENU', 'POKEMON_INFO', 'POKEMON_SKILLS', 'POKEMON_MOVES']) {
      SetHelpContext(ctx(screen));
      expect(GetHelpContext()).toBe(ctx('WILD_BATTLE'));
    }
    SetHelpContext(ctx('OVERWORLD'));
    expect(GetHelpContext()).toBe(ctx('OVERWORLD'));
    SetHelpContext(ctx('BAG'));
    expect(GetHelpContext()).toBe(ctx('BAG'));
    SetHelpContextDontCheckBattle(ctx('SAFARI_BATTLE'));
    SetHelpContextDontCheckBattle(ctx('BAG'));
    expect(GetHelpContext()).toBe(ctx('BAG'));
  });

  test('BackupHelpContext / RestoreHelpContext', () => {
    SetHelpContext(ctx('GYM'));
    BackupHelpContext();
    SetHelpContext(ctx('PC'));
    RestoreHelpContext();
    expect(GetHelpContext()).toBe(ctx('GYM'));
  });

  test('SetHelpContextForMap: surfing, dungeons, the special rooms, indoors, outdoors', () => {
    let mapType = 'MAP_TYPE_INDOOR';
    let surfing = false;
    SetHelpSystemFieldQuery({ mapType: () => mapType, surfing: () => surfing });
    const at = (map: string) => {
      game.state.currentMapId = map;
      SetHelpContextForMap();
      return GetHelpContext();
    };
    expect(at('MAP_PALLET_TOWN_PLAYERS_HOUSE_2F')).toBe(ctx('PLAYERS_HOUSE'));
    expect(at('MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB')).toBe(ctx('OAKS_LAB'));
    expect(at('MAP_ROUTE10_POKEMON_CENTER_2F')).toBe(ctx('POKECENTER'));
    expect(at('MAP_CELADON_CITY_DEPARTMENT_STORE_ROOF')).toBe(ctx('MART'));
    expect(at('MAP_VIRIDIAN_CITY_GYM')).toBe(ctx('GYM'));
    expect(at('MAP_VIRIDIAN_CITY_SCHOOL')).toBe(ctx('INDOORS'));
    // sDungeonMaps: MAP_SEAFOAM_ISLANDS_1F and the 4 maps after it; Mt. Moon 1F and the 2 after it
    mapType = 'MAP_TYPE_UNDERGROUND';
    expect(at('MAP_SEAFOAM_ISLANDS_B4F')).toBe(ctx('DUNGEON'));
    expect(at('MAP_MT_MOON_B2F')).toBe(ctx('DUNGEON'));
    mapType = 'MAP_TYPE_ROUTE';
    expect(at('MAP_VIRIDIAN_FOREST')).toBe(ctx('DUNGEON'));
    expect(at('MAP_ROUTE1')).toBe(ctx('OVERWORLD'));
    // The Tanoby chambers only once FLAG_SYS_UNLOCKED_TANOBY_RUINS is set
    mapType = 'MAP_TYPE_UNDERGROUND';
    expect(at('MAP_SEVEN_ISLAND_TANOBY_RUINS_RIXY_CHAMBER')).toBe(ctx('OVERWORLD'));
    game.state.setFlag('FLAG_SYS_UNLOCKED_TANOBY_RUINS');
    expect(at('MAP_SEVEN_ISLAND_TANOBY_RUINS_RIXY_CHAMBER')).toBe(ctx('DUNGEON'));
    surfing = true;
    expect(at('MAP_ROUTE21_NORTH')).toBe(ctx('SURFING'));
    // and it lets R open the help again
    HelpSystem_DisableToggleWithRButton();
    at('MAP_ROUTE1');
    expect(gHelpSystemToggleWithRButtonDisabled).toBe(false);
  });

  test('HelpSystem_UpdateHasntSeenIntro: the welcome page once, and FLAG_SYS_SAW_HELP_SYSTEM_INTRO set', () => {
    expect(HelpSystem_UpdateHasntSeenIntro()).toBe(true);
    expect(game.state.getFlag('FLAG_SYS_SAW_HELP_SYSTEM_INTRO')).toBe(true);
    expect(HelpSystem_UpdateHasntSeenIntro()).toBe(false);
  });
});

describe('lists', () => {
  // TOPIC_WHAT_TO_DO 0, TOPIC_HOW_TO_DO 1, TOPIC_TERMS 2, TOPIC_ABOUT_GAME 3, TOPIC_TYPE_MATCHUP 4; EXIT is -2
  test("each context's topics in sHelpSystemContextTopicOrder (ABOUT_GAME first)", () => {
    expect(topics('NONE')).toEqual([-2]);
    expect(topics('TITLE_SCREEN')).toEqual([3, -2]);
    expect(topics('BAG')).toEqual([1, 2, -2]);
    expect(topics('PLAYERS_HOUSE')).toEqual([3, 0, -2]);
    expect(topics('POKECENTER')).toEqual([3, 0, 1, 2, -2]);
    expect(topics('OVERWORLD')).toEqual([0, 1, 2, -2]);
    expect(topics('GYM')).toEqual([0, 1, 2, 4, -2]);
    expect(topics('TRAINER_BATTLE_DOUBLE')).toEqual([0, 1, 2, 4, -2]);
  });

  test("a submenu lists the context's enabled items, then CANCEL", () => {
    // A new game: sWhatToDo_Overworld's items without a flag (IsHelpSystemSubmenuEnabled)
    expect(submenu('OVERWORLD', 0)).toEqual([id('HELP_WHAT_SHOULD_I_BE_DOING'), id('HELP_TALKED_TO_EVERYONE_NOW_WHAT'), id('HELP_OUT_OF_THINGS_TO_DO'), -2]);
    // sHowTo_Overworld: OPENING_MENU, (USING_POKEDEX: dex), (USING_POKEMON: a mon), BAG, PLAYER, SAVE, OPTION, (MOVE_OUTSIDE_OF_BATTLE: an HM)
    expect(submenu('OVERWORLD', 1)).toEqual(['HELP_OPENING_MENU', 'HELP_USING_BAG', 'HELP_USING_PLAYER', 'HELP_USING_SAVE', 'HELP_USING_OPTION'].map(id).concat(-2));
    game.state.setFlag('FLAG_SYS_POKEDEX_GET');
    game.state.setFlag('FLAG_SYS_POKEMON_GET');
    game.state.setFlag('FLAG_GOT_HM01');
    // prettier-ignore
    expect(submenu('OVERWORLD', 1)).toEqual(['HELP_OPENING_MENU', 'HELP_USING_POKEDEX', 'HELP_USING_POKEMON', 'HELP_USING_BAG', 'HELP_USING_PLAYER', 'HELP_USING_SAVE', 'HELP_USING_OPTION', 'HELP_USING_MOVE_OUTSIDE_OF_BATTLE'].map(id).concat(-2));
    // TYPE_MATCHUP: all 35 (HELP_TYPE_MATCHUPS)
    expect(submenu('GYM', 4)).toEqual([...Array.from({ length: 35 }, (_, i) => i + 1), -2]);
    // ABOUT_GAME (sAboutGame_PokeCenter): the fundamentals 2 and 3 after the first two badges
    const about = () => submenu('POKECENTER', 3).filter((i) => i === id('HELP_GAME_FUNDAMENTALS_2') || i === id('HELP_GAME_FUNDAMENTALS_3'));
    expect(about()).toEqual([]);
    game.state.setFlag('FLAG_BADGE01_GET');
    game.state.setFlag('FLAG_BADGE02_GET');
    expect(about()).toEqual([id('HELP_GAME_FUNDAMENTALS_2'), id('HELP_GAME_FUNDAMENTALS_3')]);
  });

  test('after Brock, TERMS ends with sTerms_Basic, without listing its terms twice', () => {
    game.state.setFlag('FLAG_SYS_POKEMON_GET');
    // sTerms_Overworld: LEVEL, HP, EXP, TYPE, OT, ITEM, ABILITY, FNT, POKEMON
    expect(submenu('OVERWORLD', 2)).toEqual(['LEVEL', 'HP', 'EXP', 'TYPE', 'OT', 'ITEM', 'ABILITY', 'FNT', 'POKEMON'].map((t) => id(`HELP_TERM_${t}`)).concat(-2));
    game.state.setFlag('FLAG_DEFEATED_BROCK');
    // prettier-ignore
    const basic = ['LEVEL', 'HP', 'EXP', 'MOVES', 'TM', 'HM_MOVE', 'HM', 'ATTACK', 'DEFENSE', 'SPATK', 'SPDEF', 'SPEED', 'TYPE', 'OT', 'ITEM', 'ABILITY', 'MOVE_TYPE', 'NATURE', 'ID_NO', 'PP', 'POWER', 'ACCURACY', 'STATUS_PROBLEM', 'FNT', 'EVOLUTION', 'ITEMS', 'KEYITEMS', 'POKEBALLS', 'PLAY_TIME', 'MONEY', 'BADGES'];
    expect(submenu('OVERWORLD', 2)).toEqual([id('HELP_TERM_POKEMON'), ...basic.map((t) => id(`HELP_TERM_${t}`)), -2]);
  });
});
