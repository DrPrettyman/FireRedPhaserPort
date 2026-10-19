// quest_log_events.c's codecs for QL_EVENT_* 30-40 (world/questLogEventCodecs2.ts) and quest_log_battle.c
// (world/questLogBattle.ts): each event recorded into a scene's stream as the C lays it out and loaded back
// (QL_LoadEvent / QL_TryRepeatEvent) to its line of text in gStringVar4, compared against the decomp's string with
// the buffers filled as the C fills them; the wild battle record's counting; the trainer battles' split by class.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import { g, setTextStrings } from '../../src/battle/env';
import { gStringVar4 } from '../../src/menus/common';
import { loadMenusData } from '../../src/menus/data';
import { decodeQuestLogScript, gQL, initQuestLogData, ResetQuestLog, setQuestLogHost, type QuestLogData, type ScriptPtr } from '../../src/world/questLog';
import { questLogTrainerBattleEventId, TrySetQuestLogBattleEvent, TrySetQuestLogLinkBattleEvent } from '../../src/world/questLogBattle';
import {
  QL_EnableRecordingSteps,
  QL_LoadEvent,
  QL_ResetRepeatEventTracker,
  QL_TryRepeatEvent,
  questLogEventsDebugState,
  QuestLogEvents_HandleEndTrainerBattle,
  QuestLog_StartRecordingInputsAfterDeferredEvent,
  SetQuestLogEvent,
} from '../../src/world/questLogEvents';
import { newBattleEnv, readGen, type TestGame } from './gameData';

let t: TestGame;
let d: (name: string) => number;
let strings: Record<string, string>;
const PUBLIC = resolve(__dirname, '../../public');

beforeAll(async () => {
  t = await newBattleEnv();
  d = t.d;
  strings = readGen('text/strings.json');
  setTextStrings(strings);
  initConstants(readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines);
  initQuestLogData(readGen<QuestLogData>('questLog.json'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const path = resolve(PUBLIC, String(url));
    if (!existsSync(path)) return new Response(null, { status: 404 });
    return new Response(readFileSync(path));
  }) as typeof fetch;
  try {
    await loadMenusData('gen');
  } finally {
    globalThis.fetch = realFetch;
  }
});

let mapSec = 0;
beforeEach(() => {
  mapSec = d('MAPSEC_PEWTER_CITY');
  setQuestLogHost({
    state: t.state,
    location: () => ({ mapId: 'MAP_PEWTER_CITY', warpId: 0, x: 6, y: 8 }),
    mapSec: () => mapSec,
    playerFacing: () => 'down',
    fieldControlsLocked: () => false,
    objectEvents: () => [],
    objectEventTemplates: () => [],
  });
  ResetQuestLog(t.state);
  QuestLogEvents_HandleEndTrainerBattle(); // (drops a deferred battle a test left behind into the reset log)
  ResetQuestLog(t.state);
  QL_EnableRecordingSteps(); // (ResetQuestLog leaves a Teleport's STEP_RECORDING_MODE_DISABLED_UNTIL_DEPART, as the C does)
  // the wild battles and the other trainers count only after the Hall of Fame (ShouldRegisterEvent_HandlePartyActions)
  t.state.setFlag('FLAG_SYS_GAME_CLEAR', true);
  t.state.setFlag('FLAG_SYS_CAN_LINK_WITH_RS', true);
  t.state.playerName = 'RED';
  t.state.rivalName = 'BLUE';
});

const sp = (name: string) => d(`SPECIES_${name}`);
const it = (name: string) => d(`ITEM_${name}`);
const scene = () => t.state.questLog[0];
const idx = () => gQL.curActionIdx;
/** The recorded commands of the first scene (up to the cursor while it records). */
const commands = () => decodeQuestLogScript(scene().script, gQL.recordingPointer?.scene === 0 ? gQL.recordingPointer.pos : undefined);
function eventPtr(eventId: string): ScriptPtr {
  let pos = 0;
  for (const c of commands()) {
    if (c.id === d(eventId)) return { scene: 0, pos };
    pos += c.words.length;
  }
  throw new Error(`no ${eventId} in the scene`);
}
const eventWords = (eventId: string) => commands().find((c) => c.id === d(eventId))!.words;
/** QL_LoadEvent at the event (the playback reached its action index), and the line it printed. */
function load(eventId: string): string {
  gQL.currentSceneNum = 0; // (playback: sCurrentSceneNum is the scene being played; the wild / champion loaders check it)
  QL_ResetRepeatEventTracker();
  expect(QL_LoadEvent(eventPtr(eventId), 0xffff)).toBe(true);
  return line();
}
const line = () => t.charmap.decodePlain(gStringVar4);
/** The decomp's string with its placeholders filled the way the C fills them (STR_VAR_n / DYNAMIC n / PLAYER). */
function fill(symbol: string, vars: Record<string, string>): string {
  return strings[symbol]
    .replace(/\$$/, '')
    .replace(/'/g, '’') // the charmap's ' is ’
    .replace(/\{(STR_VAR_\d|DYNAMIC 0x0\d|PLAYER)\}/g, (_, k: string) => {
      const key = k === 'PLAYER' ? 'PLAYER' : k.startsWith('DYNAMIC') ? `D${Number(k.slice(8))}` : k;
      if (key === 'PLAYER') return 'RED';
      if (!(key in vars)) throw new Error(`${symbol}: ${key} not given`);
      return vars[key];
    });
}
const word = (s: string) => fill(s, {});
const departed = () => SetQuestLogEvent(d('QL_EVENT_DEPARTED'), { mapSec: d('MAPSEC_PALLET_TOWN'), locationId: d('QL_LOCATION_HOME') });
const trainerBattle = (trainer: string, speciesOpponent: number, speciesPlayer: number, hpFractionId = 0) => ({
  trainerId: d(trainer),
  speciesOpponent,
  speciesPlayer,
  hpFractionId,
  mapSec,
});

describe('the trainer battles', () => {
  test('DEFEATED_GYM_LEADER waits for the battle to end, then ends the scene: [opp, player, trainer, mapSec | hp << 8]', () => {
    t.state.setFlag('FLAG_SYS_GAME_CLEAR', false); // (a gym leader counts before the Hall of Fame)
    SetQuestLogEvent(d('QL_EVENT_DEFEATED_GYM_LEADER'), trainerBattle('TRAINER_LEADER_BROCK', sp('ONIX'), sp('SQUIRTLE'), 1));
    expect(scene().startType).toBe(0); // deferred (TryDeferTrainerBattleEvent)
    expect(questLogEventsDebugState().deferredEvent).toBe(d('QL_EVENT_DEFEATED_GYM_LEADER'));
    QuestLogEvents_HandleEndTrainerBattle(); // CB2_EndTrainerBattle
    expect(questLogEventsDebugState().deferredEvent).toBe(0);
    expect(gQL.state).toBe(0); // QL_FinishRecordingScene
    // the event, QL_RecordWait(1), then QL_FinishRecordingScene's last actions and SCENE_END
    const ids = commands().map((c) => c.id);
    expect(ids.slice(ids.indexOf(d('QL_EVENT_DEFEATED_GYM_LEADER')), ids.indexOf(d('QL_EVENT_DEFEATED_GYM_LEADER')) + 2)).toEqual([d('QL_EVENT_DEFEATED_GYM_LEADER'), d('QL_EVENT_WAIT')]);
    expect(ids.at(-1)).toBe(d('QL_EVENT_SCENE_END'));
    const words = eventWords('QL_EVENT_DEFEATED_GYM_LEADER');
    expect(words.slice(2)).toEqual([sp('ONIX'), sp('SQUIRTLE'), d('TRAINER_LEADER_BROCK'), d('MAPSEC_PEWTER_CITY') | (1 << 8)]);
    expect(load('QL_EVENT_DEFEATED_GYM_LEADER')).toBe(
      fill('gText_QuestLog_TookOnGymLeadersMonWithMonAndWon', { D0: 'PEWTER CITY', D1: 'BROCK', D2: 'ONIX', D3: 'SQUIRTLE', D4: word('gText_QuestLog_Tenaciously') }),
    );
    expect(line()).toBe('Took on PEWTER CITY GYM LEADER\\nBROCK’s ONIX with SQUIRTLE\\nand won tenaciously!');
  });

  test('DEFEATED_E4_MEMBER', () => {
    mapSec = d('MAPSEC_INDIGO_PLATEAU');
    SetQuestLogEvent(d('QL_EVENT_DEFEATED_E4_MEMBER'), trainerBattle('TRAINER_ELITE_FOUR_LORELEI', sp('LAPRAS'), sp('VENUSAUR'), 2));
    QuestLogEvents_HandleEndTrainerBattle();
    expect(eventWords('QL_EVENT_DEFEATED_E4_MEMBER').slice(2, 5)).toEqual([sp('LAPRAS'), sp('VENUSAUR'), d('TRAINER_ELITE_FOUR_LORELEI')]);
    expect(load('QL_EVENT_DEFEATED_E4_MEMBER')).toBe(
      fill('gText_QuestLog_TookOnEliteFoursMonWithMonAndWon', { D0: 'LORELEI', D1: 'LAPRAS', D2: 'VENUSAUR', D3: word('gText_QuestLog_Somehow') }),
    );
  });

  test('DEFEATED_CHAMPION: a fixed count of 2, played back as three lines', () => {
    SetQuestLogEvent(d('QL_EVENT_DEFEATED_CHAMPION'), trainerBattle('TRAINER_CHAMPION_FIRST_SQUIRTLE', sp('BLASTOISE'), sp('CHARIZARD'), 2));
    QuestLogEvents_HandleEndTrainerBattle();
    expect(eventWords('QL_EVENT_DEFEATED_CHAMPION')).toEqual([d('QL_EVENT_DEFEATED_CHAMPION') | (2 << 12), expect.any(Number), sp('BLASTOISE'), sp('CHARIZARD'), 2]);
    const ptr = eventPtr('QL_EVENT_DEFEATED_CHAMPION');
    const ids = commands().map((c) => c.id);
    expect(ids[ids.indexOf(d('QL_EVENT_DEFEATED_CHAMPION')) + 1]).toBe(d('QL_EVENT_WAIT')); // the size ignores the count
    expect(load('QL_EVENT_DEFEATED_CHAMPION')).toBe(fill('gText_QuestLog_PlayerBattledChampionRival', { D0: 'RED', D1: 'BLUE' }));
    expect(QL_TryRepeatEvent(ptr)).toBe(true);
    expect(line()).toBe(fill('gText_QuestLog_PlayerSentOutMon1RivalSentOutMon2', { D0: 'BLUE', D1: 'BLASTOISE', D2: 'RED', D3: 'CHARIZARD' }));
    expect(QL_TryRepeatEvent(ptr)).toBe(true);
    expect(line()).toBe(fill('gText_QuestLog_WonTheMatchAsAResult', { D0: word('gText_QuestLog_Barely') }));
    expect(QL_TryRepeatEvent(ptr)).toBe(false); // done
  });

  test('DEFEATED_TRAINER: a trainer by name, the rival by the player’s name for them', () => {
    mapSec = d('MAPSEC_ROUTE_3');
    SetQuestLogEvent(d('QL_EVENT_DEFEATED_TRAINER'), trainerBattle('TRAINER_BUG_CATCHER_RICK', sp('CATERPIE'), sp('PIDGEY')));
    QuestLogEvents_HandleEndTrainerBattle();
    expect(load('QL_EVENT_DEFEATED_TRAINER')).toBe(
      fill('gText_QuestLog_TookOnTrainersMonWithMonAndWon', { D0: 'ROUTE 3', D1: 'RICK', D2: 'CATERPIE', D3: 'PIDGEY', D4: word('gText_QuestLog_Handily') }),
    );
    ResetQuestLog(t.state);
    SetQuestLogEvent(d('QL_EVENT_DEFEATED_TRAINER'), trainerBattle('TRAINER_RIVAL_OAKS_LAB_SQUIRTLE', sp('SQUIRTLE'), sp('BULBASAUR')));
    QuestLogEvents_HandleEndTrainerBattle();
    expect(load('QL_EVENT_DEFEATED_TRAINER')).toContain('BLUE’s SQUIRTLE with BULBASAUR');
  });

  test('before the Hall of Fame only the story trainers count (ShouldRegisterEvent_HandleBeatStoryTrainer)', () => {
    t.state.setFlag('FLAG_SYS_GAME_CLEAR', false);
    SetQuestLogEvent(d('QL_EVENT_DEFEATED_TRAINER'), trainerBattle('TRAINER_YOUNGSTER_BEN', sp('RATTATA'), sp('PIDGEY')));
    expect(questLogEventsDebugState().deferredEvent).toBe(0);
    QuestLogEvents_HandleEndTrainerBattle();
    expect(scene().startType).toBe(0);
    for (const rival of ['TRAINER_RIVAL_OAKS_LAB_SQUIRTLE', 'TRAINER_BOSS_GIOVANNI']) {
      SetQuestLogEvent(d('QL_EVENT_DEFEATED_TRAINER'), trainerBattle(rival, sp('SQUIRTLE'), sp('BULBASAUR')));
      expect(questLogEventsDebugState().deferredEvent).toBe(d('QL_EVENT_DEFEATED_TRAINER'));
    }
  });
});

describe('quest_log_battle.c', () => {
  /** A battle's end as battle_main.c leaves the globals: the player's mon(s) and the opponent's last one. */
  function battleEnd(flags: string[], outcome: string, opponent = 0) {
    g.battleTypeFlags = flags.reduce((f, n) => f | d(n), 0);
    g.battleOutcome = d(outcome);
    g.trainerBattleOpponent_A = opponent;
    const double = flags.includes('BATTLE_TYPE_DOUBLE');
    g.battlersCount = double ? 4 : 2;
    for (let i = 0; i < 4; i++) g.battlerPositions[i] = i; // B_POSITION_PLAYER_LEFT, OPPONENT_LEFT, PLAYER_RIGHT, OPPONENT_RIGHT
  }
  const setMon = (battler: number, species: number, hp: number, maxHP: number) => {
    Object.assign(g.battleMons[battler], { species, hp, maxHP });
  };

  test('the trainer class picks the event (questLogTrainerBattleEventId)', () => {
    expect(questLogTrainerBattleEventId(d('TRAINER_LEADER_BROCK'))).toBe(d('QL_EVENT_DEFEATED_GYM_LEADER'));
    expect(questLogTrainerBattleEventId(d('TRAINER_LEADER_GIOVANNI'))).toBe(d('QL_EVENT_DEFEATED_GYM_LEADER'));
    expect(questLogTrainerBattleEventId(d('TRAINER_ELITE_FOUR_LORELEI'))).toBe(d('QL_EVENT_DEFEATED_E4_MEMBER'));
    expect(questLogTrainerBattleEventId(d('TRAINER_CHAMPION_FIRST_SQUIRTLE'))).toBe(d('QL_EVENT_DEFEATED_CHAMPION'));
    expect(questLogTrainerBattleEventId(d('TRAINER_RIVAL_OAKS_LAB_SQUIRTLE'))).toBe(d('QL_EVENT_DEFEATED_TRAINER'));
    expect(questLogTrainerBattleEventId(d('TRAINER_BOSS_GIOVANNI'))).toBe(d('QL_EVENT_DEFEATED_TRAINER'));
  });

  test('TrySetQuestLogBattleEvent: a won single trainer battle, the HP fraction from the lead mon', () => {
    for (const [hp, fraction] of [
      [60, 0], // >= 2/3 of 90
      [59, 1],
      [30, 1],
      [29, 2],
    ]) {
      ResetQuestLog(t.state);
      battleEnd(['BATTLE_TYPE_TRAINER'], 'B_OUTCOME_WON', d('TRAINER_LEADER_BROCK'));
      g.battleResults.lastOpponentSpecies = sp('ONIX');
      setMon(0, sp('SQUIRTLE'), hp, 90);
      TrySetQuestLogBattleEvent();
      QuestLogEvents_HandleEndTrainerBattle();
      expect(eventWords('QL_EVENT_DEFEATED_GYM_LEADER').slice(2)).toEqual([sp('ONIX'), sp('SQUIRTLE'), d('TRAINER_LEADER_BROCK'), mapSec | (fraction << 8)]);
    }
  });

  test('TrySetQuestLogBattleEvent: a double battle names the mon that made the last KO, the HP is both mons’', () => {
    battleEnd(['BATTLE_TYPE_TRAINER', 'BATTLE_TYPE_DOUBLE'], 'B_OUTCOME_WON', d('TRAINER_ELITE_FOUR_LORELEI'));
    g.battleResults.lastOpponentSpecies = sp('LAPRAS');
    setMon(0, sp('VENUSAUR'), 0, 100);
    setMon(2, sp('PIKACHU'), 40, 50); // 40 of 150: < 1/3
    g.battleStruct.lastAttackerToFaintOpponent = 1; // the opponent's side (a recoil KO): the left mon has fainted, so the right
    TrySetQuestLogBattleEvent();
    QuestLogEvents_HandleEndTrainerBattle();
    expect(eventWords('QL_EVENT_DEFEATED_E4_MEMBER').slice(2)).toEqual([sp('LAPRAS'), sp('PIKACHU'), d('TRAINER_ELITE_FOUR_LORELEI'), mapSec | (2 << 8)]);
    ResetQuestLog(t.state);
    g.battleStruct.lastAttackerToFaintOpponent = 0;
    TrySetQuestLogBattleEvent();
    QuestLogEvents_HandleEndTrainerBattle();
    expect(eventWords('QL_EVENT_DEFEATED_E4_MEMBER')[3]).toBe(sp('VENUSAUR'));
  });

  test('TrySetQuestLogBattleEvent: nothing for a lost battle, a run, the old man, the Pokédude or a link', () => {
    for (const [flags, outcome] of [
      [['BATTLE_TYPE_TRAINER'], 'B_OUTCOME_LOST'],
      [[], 'B_OUTCOME_RAN'],
      [['BATTLE_TYPE_OLD_MAN_TUTORIAL'], 'B_OUTCOME_CAUGHT'],
      [['BATTLE_TYPE_POKEDUDE', 'BATTLE_TYPE_TRAINER'], 'B_OUTCOME_WON'],
    ] as const) {
      battleEnd([...flags], outcome, d('TRAINER_LEADER_BROCK'));
      g.enemyParty = [{ species: sp('PIDGEY') } as never];
      TrySetQuestLogBattleEvent();
      QuestLogEvents_HandleEndTrainerBattle();
      expect(scene().startType).toBe(0);
    }
  });

  test('TrySetQuestLogBattleEvent: wild battles won and caught count into one record', () => {
    departed();
    for (const [species, outcome] of [
      ['PIDGEY', 'B_OUTCOME_WON'],
      ['RATTATA', 'B_OUTCOME_CAUGHT'],
      ['SPEAROW', 'B_OUTCOME_WON'],
    ]) {
      battleEnd([], outcome);
      g.enemyParty = [{ species: sp(species) } as never];
      TrySetQuestLogBattleEvent();
    }
    const wild = commands().filter((c) => c.id === d('QL_EVENT_DEFEATED_WILD_MON'));
    expect(wild.length).toBe(1);
    expect(wild[0].words).toEqual([d('QL_EVENT_DEFEATED_WILD_MON'), expect.any(Number), sp('SPEAROW'), sp('RATTATA'), 2 | (1 << 8), mapSec]);
    expect(load('QL_EVENT_DEFEATED_WILD_MON')).toBe(
      fill('gText_QuestLog_DefeatedWildMonsAndCaughtWildMon', { D0: 'PEWTER CITY', D1: 'SPEAROW', D2: '2', D3: 'RATTATA', D4: '1', D5: 'RED' }),
    );
  });

  test('TrySetQuestLogLinkBattleEvent: the partner’s name and the outcome (0 won, 1 lost, 2 drew)', () => {
    battleEnd(['BATTLE_TYPE_LINK'], 'B_OUTCOME_LOST');
    const names = ['RED', 'BLUE'].map((n) => [...t.charmap.encodePlain(n)]);
    TrySetQuestLogLinkBattleEvent(names.map((name, id) => ({ id, name })), 0, false);
    QuestLog_StartRecordingInputsAfterDeferredEvent();
    expect(load('QL_EVENT_LINK_BATTLED_SINGLE')).toBe(fill('gText_QuestLog_SingleBattleWithPersonResultedInOutcome', { D0: 'BLUE', D1: word('gText_QuestLog_Loss') }));
  });
});

describe('DEFEATED_WILD_MON', () => {
  const wild = (defeated: string | null, caught: string | null) =>
    SetQuestLogEvent(d('QL_EVENT_DEFEATED_WILD_MON'), { defeatedSpecies: defeated ? sp(defeated) : 0, caughtSpecies: caught ? sp(caught) : 0, mapSec });
  const wildLine = () => load('QL_EVENT_DEFEATED_WILD_MON');
  const vars = (D1: string, D2: string, D3: string, D4: string) => ({ D0: 'PEWTER CITY', D1, D2, D3, D4, D5: 'RED' });

  test('one defeated, then two: the last one is named', () => {
    wild('PIDGEY', null);
    expect(eventWords('QL_EVENT_DEFEATED_WILD_MON')).toEqual([d('QL_EVENT_DEFEATED_WILD_MON'), idx(), sp('PIDGEY'), 0, 1, mapSec]);
    expect(wildLine()).toBe(fill('gText_QuestLog_DefeatedWildMon', vars('PIDGEY', '1', '', '0')));
    wild('RATTATA', null);
    expect(wildLine()).toBe(fill('gText_QuestLog_DefeatedWildMons', vars('RATTATA', '2', '', '0')));
  });

  test('caught one, caught two, defeated and caught', () => {
    wild(null, 'CATERPIE');
    expect(wildLine()).toBe(fill('gText_QuestLog_CaughtWildMon', vars('', '0', 'CATERPIE', '1')));
    wild(null, 'WEEDLE');
    expect(wildLine()).toBe(fill('gText_QuestLog_CaughtWildMons', vars('', '0', 'WEEDLE', '2')));
    wild('PIDGEY', null);
    expect(wildLine()).toBe(fill('gText_QuestLog_DefeatedWildMonAndCaughtWildMons', vars('PIDGEY', '1', 'WEEDLE', '2')));
    ResetQuestLog(t.state);
    wild('PIDGEY', null);
    wild(null, 'WEEDLE');
    expect(wildLine()).toBe(fill('gText_QuestLog_DefeatedWildMonAndCaughtWildMon', vars('PIDGEY', '1', 'WEEDLE', '1')));
    wild('SPEAROW', null);
    wild(null, 'ODDISH');
    expect(wildLine()).toBe(fill('gText_QuestLog_DefeatedWildMonsAndCaughtWildMons', vars('SPEAROW', '2', 'ODDISH', '2')));
  });

  test('the counts stop at 255; another event starts a new record', () => {
    for (let i = 0; i < 300; i++) wild('PIDGEY', null);
    expect(eventWords('QL_EVENT_DEFEATED_WILD_MON')[4]).toBe(255);
    SetQuestLogEvent(d('QL_EVENT_BOUGHT_ITEM'), { lastItemId: it('POTION'), itemQuantity: 1, totalMoney: 300, mapSec, hasMultipleTransactions: false });
    wild('RATTATA', null);
    const records = commands().filter((c) => c.id === d('QL_EVENT_DEFEATED_WILD_MON'));
    expect(records.map((c) => [c.words[2], c.words[4]])).toEqual([
      [sp('PIDGEY'), 255],
      [sp('RATTATA'), 1],
    ]);
  });

  test('not recorded before the Hall of Fame, nor for Snorlax and the legendaries', () => {
    t.state.setFlag('FLAG_SYS_GAME_CLEAR', false);
    wild('PIDGEY', null);
    expect(scene().startType).toBe(0);
    t.state.setFlag('FLAG_SYS_GAME_CLEAR', true);
    wild('SNORLAX', null);
    wild(null, 'MEWTWO');
    expect(scene().startType).toBe(0);
  });
});

describe('the field moves', () => {
  test('USED_FIELD_MOVE: only inside a scene; CUT ends it: [species, fieldMove | mapSec << 8]', () => {
    SetQuestLogEvent(d('QL_EVENT_USED_FIELD_MOVE'), { species: sp('BULBASAUR'), fieldMove: d('FIELD_MOVE_CUT'), mapSec });
    expect(scene().startType).toBe(0); // (ShouldRegisterEvent_HandlePartyActions: never starts a scene)
    departed();
    SetQuestLogEvent(d('QL_EVENT_USED_FIELD_MOVE'), { species: sp('BULBASAUR'), fieldMove: d('FIELD_MOVE_CUT'), mapSec });
    expect(eventWords('QL_EVENT_USED_FIELD_MOVE').slice(2)).toEqual([sp('BULBASAUR'), d('FIELD_MOVE_CUT') | (mapSec << 8)]);
    expect(gQL.state).toBe(0); // STEP_RECORDING_MODE_DISABLED: QL_FinishRecordingScene
    expect(load('QL_EVENT_USED_FIELD_MOVE')).toBe(fill('gText_QuestLog_UsedCut', { STR_VAR_1: 'BULBASAUR' }));
  });

  test('TELEPORT and DIG name the place and stop recording steps until the next departure', () => {
    departed();
    SetQuestLogEvent(d('QL_EVENT_USED_FIELD_MOVE'), { species: sp('ABRA'), fieldMove: d('FIELD_MOVE_TELEPORT'), mapSec: d('MAPSEC_PALLET_TOWN') });
    expect(questLogEventsDebugState().stepRecordingMode).toBe(2); // STEP_RECORDING_MODE_DISABLED_UNTIL_DEPART
    expect(load('QL_EVENT_USED_FIELD_MOVE')).toBe(fill('gText_QuestLog_UsedTeleportToLocation', { STR_VAR_1: 'ABRA', STR_VAR_2: 'PALLET TOWN', STR_VAR_3: 'HOME' }));
    ResetQuestLog(t.state);
    departed(); // (the departure after a Teleport only turns the step recording back on)
    expect(scene().startType).toBe(0);
    departed();
    SetQuestLogEvent(d('QL_EVENT_USED_FIELD_MOVE'), { species: sp('ABRA'), fieldMove: d('FIELD_MOVE_TELEPORT'), mapSec: d('MAPSEC_CERULEAN_CITY') });
    expect(load('QL_EVENT_USED_FIELD_MOVE')).toBe(fill('gText_QuestLog_UsedTeleportToLocation', { STR_VAR_1: 'ABRA', STR_VAR_2: 'CERULEAN CITY', STR_VAR_3: 'POKéMON CENTER' }));
    ResetQuestLog(t.state);
    departed();
    departed();
    SetQuestLogEvent(d('QL_EVENT_USED_FIELD_MOVE'), { species: sp('DIGLETT'), fieldMove: d('FIELD_MOVE_DIG'), mapSec: d('MAPSEC_MT_MOON') });
    expect(load('QL_EVENT_USED_FIELD_MOVE')).toBe(fill('gText_QuestLog_UsedDigInLocation', { STR_VAR_1: 'DIGLETT', STR_VAR_2: 'MT. MOON' }));
  });

  test('every field move has its line', () => {
    const moves = ['FLASH', 'FLY', 'STRENGTH', 'SURF', 'ROCK_SMASH', 'WATERFALL', 'MILK_DRINK', 'SOFT_BOILED', 'SWEET_SCENT'];
    const symbols = ['UsedFlash', 'UsedFly', 'UsedStrength', 'UsedSurf', 'UsedRockSmash', 'UsedWaterfall', 'UsedMilkDrink', 'UsedSoftboiled', 'UsedSweetScent'];
    moves.forEach((move, i) => {
      ResetQuestLog(t.state);
      departed();
      SetQuestLogEvent(d('QL_EVENT_USED_FIELD_MOVE'), { species: sp('PIDGEOT'), fieldMove: d(`FIELD_MOVE_${move}`), mapSec });
      expect(load('QL_EVENT_USED_FIELD_MOVE')).toBe(fill(`gText_QuestLog_${symbols[i]}`, { STR_VAR_1: 'PIDGEOT', STR_VAR_2: 'PEWTER CITY' }));
    });
  });
});

describe('the shops and the story items', () => {
  const shop = (event: string, lastItemId: number, itemQuantity: number, totalMoney: number, hasMultipleTransactions: boolean) =>
    SetQuestLogEvent(d(event), { lastItemId, itemQuantity, totalMoney, mapSec, hasMultipleTransactions });

  test('BOUGHT_ITEM: one item, or the money for several (the u32 in two u16s)', () => {
    shop('QL_EVENT_BOUGHT_ITEM', it('POTION'), 1, 300, false);
    expect(eventWords('QL_EVENT_BOUGHT_ITEM').slice(2)).toEqual([it('POTION'), 1, 0, 300, mapSec | (1 << 8)]); // hasMultipleTransactions: always TRUE
    expect(load('QL_EVENT_BOUGHT_ITEM')).toBe(fill('gText_QuestLog_BoughtItem', { D0: 'PEWTER CITY', D1: 'POTION' }));
    ResetQuestLog(t.state);
    shop('QL_EVENT_BOUGHT_ITEM', it('ULTRA_BALL'), 99, 118800, false);
    expect(eventWords('QL_EVENT_BOUGHT_ITEM').slice(4, 6)).toEqual([118800 >>> 16, 118800 & 0xffff]);
    expect(load('QL_EVENT_BOUGHT_ITEM')).toBe(fill('gText_QuestLog_BoughtItemsIncludingItem', { D0: 'PEWTER CITY', D1: 'ULTRA BALL', D2: '118800' }));
  });

  test('SOLD_ITEM: just one, a number of one item, several transactions', () => {
    shop('QL_EVENT_SOLD_ITEM', it('NUGGET'), 1, 5000, false);
    expect(load('QL_EVENT_SOLD_ITEM')).toBe(fill('gText_QuestLog_SoldNumOfItem', { D0: 'RED', D1: 'PEWTER CITY', D2: 'NUGGET', D3: word('gText_QuestLog_JustOne') }));
    ResetQuestLog(t.state);
    shop('QL_EVENT_SOLD_ITEM', it('NUGGET'), 3, 15000, false);
    expect(load('QL_EVENT_SOLD_ITEM')).toBe(fill('gText_QuestLog_SoldNumOfItem', { D0: 'RED', D1: 'PEWTER CITY', D2: 'NUGGET', D3: '3' }));
    ResetQuestLog(t.state);
    shop('QL_EVENT_SOLD_ITEM', it('NUGGET'), 3, 15700, true);
    expect(eventWords('QL_EVENT_SOLD_ITEM')[6]).toBe(mapSec | (1 << 8));
    expect(load('QL_EVENT_SOLD_ITEM')).toBe(fill('gText_QuestLog_SoldItemsIncludingItem', { D0: 'PEWTER CITY', D1: 'NUGGET', D2: '15700' }));
  });

  test('a shop repeated at the same action is one command with two copies', () => {
    shop('QL_EVENT_BOUGHT_ITEM', it('POTION'), 1, 300, false);
    shop('QL_EVENT_BOUGHT_ITEM', it('ANTIDOTE'), 1, 100, false);
    const words = eventWords('QL_EVENT_BOUGHT_ITEM');
    expect(words[0]).toBe(d('QL_EVENT_BOUGHT_ITEM') | (1 << 12));
    expect(words.length).toBe(2 + 5 * 2);
    expect(load('QL_EVENT_BOUGHT_ITEM')).toContain('POTION');
    expect(QL_TryRepeatEvent(eventPtr('QL_EVENT_BOUGHT_ITEM'))).toBe(true);
    expect(line()).toContain('ANTIDOTE');
  });

  test('OBTAINED_STORY_ITEM starts a scene, but is dropped inside one: [itemId, mapSec]', () => {
    mapSec = d('MAPSEC_S_S_ANNE');
    SetQuestLogEvent(d('QL_EVENT_OBTAINED_STORY_ITEM'), { itemId: it('HM01'), mapSec });
    expect(eventWords('QL_EVENT_OBTAINED_STORY_ITEM').slice(2)).toEqual([it('HM01'), mapSec]);
    expect(load('QL_EVENT_OBTAINED_STORY_ITEM')).toBe(fill('gText_QuestLog_ObtainedItemInLocation', { STR_VAR_1: 'S.S. ANNE', STR_VAR_2: 'HM01' }));
    SetQuestLogEvent(d('QL_EVENT_OBTAINED_STORY_ITEM'), { itemId: it('SS_TICKET'), mapSec });
    expect(commands().filter((c) => c.id === d('QL_EVENT_OBTAINED_STORY_ITEM')).length).toBe(1);
  });
});
