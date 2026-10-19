// trainer_tower.c (src/world/trainerTower.ts): CallTrainerTowerFunc's functions on a new-game state, with the
// expected values from the decomp (trainer_tower_sets.c's floors, trainer_tower.c's tables, PRINT_TOWER_TIME).

import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { gMain, VBlankCounter1Update } from '../../src/gba/main';
import { gStringVar4 } from '../../src/menus/common';
import { ConvertEasyChatWordsToString, CopyEasyChatWord } from '../../src/menus/easyChat';
import type { FontsData } from '../../src/text/Font';
import type { Pokemon } from '../../src/pokemon/Pokemon';
import {
  CallTrainerTowerFunc,
  currentTrainerTowerRecord,
  FreeTrainerTowerBattleStruct,
  GetPartyMaxLevel,
  GetTrainerTowerOpponentClass,
  GetTrainerTowerOpponentLoseText,
  GetTrainerTowerOpponentName,
  GetTrainerTowerOpponentWinText,
  GetTrainerTowerTrainerFrontSpriteId,
  InitTrainerTowerBattleStruct,
  PrintTrainerTowerRecords,
  trainerTowerOpponentPicId,
  initTrainerTowerData,
  setTrainerTowerStringWidth,
  trainerTowerData,
  trainerTowerTimeStrings,
  TT_ConvertEasyChatMessageToString,
  type TrainerTowerData,
} from '../../src/world/trainerTower';
import { newBattleEnv, newGame, readGen, type TestGame } from './gameData';
import { setTextStrings } from '../../src/battle/env';
import { InitBgsFromTemplates, ResetBgsAndClearDma3BusyFlags } from '../../src/gba/bg';
import { DUMMY_WIN_TEMPLATE, InitWindows } from '../../src/gba/window';

let t: TestGame;
const warnings: string[] = [];
const battles: { flags: number; party: Pokemon[]; transition: number }[] = [];

/** GetStringWidth(FONT_NORMAL, str, -1) from fonts.json's glyph widths: the widest line. */
function normalWidth(str: number[]): number {
  const widths = readGen<FontsData>('text/fonts.json').fonts['2'].widths;
  let width = 0;
  let line = 0;
  for (const c of str) {
    if (c === 0xff) break;
    if (c === 0xfe) {
      width = Math.max(width, line);
      line = 0;
    } else line += widths[c] ?? 0;
  }
  return Math.max(width, line);
}

beforeAll(() => {
  initTrainerTowerData(readGen<TrainerTowerData>('trainerTower.json'));
  setTrainerTowerStringWidth(normalWidth);
});

beforeEach(() => {
  t = newGame();
  warnings.length = 0;
  battles.length = 0;
  gMain.vblankCounter1 = null;
  on('LAYOUT_TRAINER_TOWER_LOBBY');
});

/** The map header's layout (gMapHeader.mapLayoutId), as a map load sets it. */
function on(layout: string): void {
  t.state.mapHeaderLayoutId = t.d(layout);
  t.state.mapLayoutId = t.d(layout);
}

/** `ttower_*`: VAR_0x8004 = TRAINER_TOWER_FUNC_<func> (+ VAR_0x8005 / 0x8006), special CallTrainerTowerFunc; VAR_RESULT. */
function call(func: string, v8005?: number, v8006?: number): number {
  t.state.setVar('VAR_0x8004', t.d(`TRAINER_TOWER_FUNC_${func}`));
  if (v8005 !== undefined) t.state.setVar('VAR_0x8005', v8005);
  if (v8006 !== undefined) t.state.setVar('VAR_0x8006', v8006);
  CallTrainerTowerFunc({ state: t.state, warnOnce: (_k, m) => warnings.push(m), startTowerBattle: (flags, party, transition) => battles.push({ flags, party, transition }) });
  return t.state.getVar('VAR_RESULT');
}

const start = (type: string) => call('START_CHALLENGE', t.d(`CHALLENGE_TYPE_${type}`));
const record = () => currentTrainerTowerRecord(t.state);
const str = (i: number) => t.charmap.decodePlain(t.state.stringVars[i]);

describe('the data (trainer_tower_sets.c)', () => {
  test('gTrainerTowerFloors: 4 challenge types of 8 floors; Mixed borrows other sets\' floors', () => {
    const d = trainerTowerData();
    expect(d.localHeader).toEqual({ numFloors: 8, id: 1 });
    expect(d.sets.map((s) => s.length)).toEqual([8, 8, 8, 8]);
    expect(d.sets[3][3]).toBe('sTrainerTowerFloor_Double_8');
    const single1 = d.floors.sTrainerTowerFloor_Single_1;
    expect(single1).toMatchObject({ id: 19, floorIdx: 8, challengeType: 0, prize: t.d('TTPRIZE_UP_GRADE') });
    expect(single1.trainers[0]).toMatchObject({ name: 'ALBERTO$', facilityClass: t.d('FACILITY_CLASS_SAILOR'), textColor: 5 });
    expect(single1.trainers[1].name).toBe('$'); // DUMMY_TOWER_TEAM(0)
    const cole = d.floors.sTrainerTowerFloor_Single_4.trainers[0];
    expect(cole.speechBefore).toEqual(['AHAHA', 'YOU_RE', 'NOT', 'GOING', 'ANYWHERE', 'EXCL'].map((w) => t.d(`EC_WORD_${w}`)));
    expect(cole.mons[0]).toMatchObject({
      species: t.d('SPECIES_RATICATE'),
      heldItem: t.d('ITEM_SITRUS_BERRY'),
      moves: [t.d('MOVE_SHOCK_WAVE'), t.d('MOVE_HYPER_FANG'), t.d('MOVE_SCARY_FACE'), t.d('MOVE_ENDEAVOR')],
      hpEV: 110,
      otId: 4096 << 16,
      hpIV: 20,
      abilityNum: 1,
      personality: 0x16,
      nickname: 'RATICATE$',
      friendship: 255,
    });
  });

  test("trainer_tower.c's tables", () => {
    const d = trainerTowerData();
    expect(d.floorLayouts[7]).toEqual(['LAYOUT_TRAINER_TOWER_8F', 'LAYOUT_TRAINER_TOWER_8F_DOUBLES', 'LAYOUT_TRAINER_TOWER_8F_KNOCKOUT']);
    expect(d.prizeList[t.d('TTPRIZE_UP_GRADE')]).toBe(t.d('ITEM_UP_GRADE'));
    expect(d.encounterMusic[t.d('TRAINER_ENCOUNTER_MUSIC_SUSPICIOUS')]).toBe(t.d('MUS_ENCOUNTER_ROCKET'));
    expect(d.trainerEncounterMusicLUT).toHaveLength(105);
    expect(d.knockoutChallengeMonIdxs[7]).toEqual([1, 4, 5]);
  });
});

describe('PRINT_TOWER_TIME', () => {
  test('minutes and seconds right-aligned, hundredths as frames * 168 / 100', () => {
    const dec = (s: number[]) => t.charmap.decodePlain(s);
    expect(trainerTowerTimeStrings(0).map(dec)).toEqual([' 0', ' 0', '00']);
    expect(trainerTowerTimeStrings(3600 + 125).map(dec)).toEqual([' 1', ' 2', '08']); // 5 frames: 8.4
    expect(trainerTowerTimeStrings(t.d('TRAINER_TOWER_MAX_TIME')).map(dec)).toEqual(['59', '59', '99']);
  });

  test('GetCurrentTime buffers the timer; a maxed-out timer stops', () => {
    start('SINGLE');
    record().timer = 60 * 60 * 12 + 60 * 34 + 30;
    call('GET_TIME');
    expect([str(0), str(1), str(2)]).toEqual(['12', '34', '50']);
    record().timer = t.d('TRAINER_TOWER_MAX_TIME') + 10;
    call('GET_TIME');
    expect(record().timer).toBe(t.d('TRAINER_TOWER_MAX_TIME'));
    expect(gMain.vblankCounter1).toBeNull();
  });
});

describe('the challenge', () => {
  test('ResetTrainerTowerResults: a new game has every record time at the max', () => {
    expect(t.state.trainerTower).toHaveLength(4);
    expect(t.state.trainerTower.every((r) => r.bestTime === t.d('TRAINER_TOWER_MAX_TIME'))).toBe(true);
  });

  test('StartTrainerTowerChallenge picks the type, resets the record and starts the timer', () => {
    t.state.trainerTower[1].floorsCleared = 5;
    t.state.trainerTower[1].spokeToOwner = true;
    start('DOUBLE');
    expect(t.state.towerChallengeId).toBe(1);
    expect(record()).toMatchObject({ floorsCleared: 0, timer: 0, spokeToOwner: false, checkedFinalTime: false, validated: true, unk9: 1 });
    expect(gMain.vblankCounter1).toBe(record());
    for (let i = 0; i < 90; i++) VBlankCounter1Update();
    expect(record().timer).toBe(90);
    call('START_CHALLENGE', 7); // >= NUM_TOWER_CHALLENGE_TYPES
    expect(t.state.towerChallengeId).toBe(0);
  });

  test('ValidateOrResetCurTrainerTowerRecord: a record of another set loses its time and prize', () => {
    Object.assign(t.state.trainerTower[0], { unk9: 7, bestTime: 1234, receivedPrize: true });
    call('GET_CHALLENGE_STATUS');
    expect(t.state.trainerTower[0]).toMatchObject({ unk9: 1, bestTime: t.d('TRAINER_TOWER_MAX_TIME'), receivedPrize: false });
  });

  test('floors cleared: only the next floor to clear reads as not cleared', () => {
    start('SINGLE');
    on('LAYOUT_TRAINER_TOWER_1F');
    expect(call('GET_FLOOR_CLEARED')).toBe(0);
    call('CLEARED_FLOOR');
    expect(record().floorsCleared).toBe(1);
    expect(call('GET_FLOOR_CLEARED')).toBe(1);
    on('LAYOUT_TRAINER_TOWER_2F');
    expect(call('GET_FLOOR_CLEARED')).toBe(0);
    on('LAYOUT_TRAINER_TOWER_3F');
    expect(call('GET_FLOOR_CLEARED')).toBe(1);
  });

  test('the lost status reads once, then normal', () => {
    start('KNOCKOUT');
    expect(call('GET_CHALLENGE_STATUS')).toBe(t.d('CHALLENGE_STATUS_NORMAL'));
    call('SET_LOST');
    expect(call('GET_CHALLENGE_STATUS')).toBe(t.d('CHALLENGE_STATUS_LOST'));
    expect(call('GET_CHALLENGE_STATUS')).toBe(t.d('CHALLENGE_STATUS_NORMAL'));
  });

  test('the owner, the prize and the final time', () => {
    start('SINGLE');
    on('LAYOUT_TRAINER_TOWER_ROOF');
    record().timer = 5000;
    expect(call('GET_BEAT_CHALLENGE')).toBe(0);
    expect(call('GET_OWNER_STATE')).toBe(0);
    expect(gMain.vblankCounter1).toBeNull(); // the timer stops at the owner
    expect(call('GET_BEAT_CHALLENGE')).toBe(1);
    // The Single set's prize is floor 0's (sTrainerTowerFloor_Single_1: TTPRIZE_UP_GRADE)
    expect(call('GIVE_PRIZE')).toBe(0);
    expect(t.state.bag.has(t.d('ITEM_UP_GRADE'), 1)).toBe(true);
    expect(str(1)).toBe('UP-GRADE');
    expect(call('GIVE_PRIZE')).toBe(2);
    expect(call('CHECK_FINAL_TIME')).toBe(0);
    expect(record().bestTime).toBe(5000);
    expect(call('CHECK_FINAL_TIME')).toBe(2);
    expect(call('GET_OWNER_STATE')).toBe(2);
    // ResumeTimer doesn't restart a finished challenge
    call('RESUME_TIMER');
    expect(gMain.vblankCounter1).toBeNull();
    // A slower run is no record; the prize was already given (records keep it per set)
    start('SINGLE');
    record().timer = 6000;
    expect(call('GIVE_PRIZE')).toBe(2);
    expect(call('CHECK_FINAL_TIME')).toBe(1);
    expect(record().bestTime).toBe(5000);
  });

  test('no room for the prize', () => {
    start('DOUBLE');
    for (let i = 0; t.state.bag.add(t.d('ITEM_POTION') + (i % 3), 999); i++) if (i > 400) break;
    const prize = trainerTowerData().prizeList[trainerTowerData().floors.sTrainerTowerFloor_Double_1.prize];
    while (t.state.bag.add(prize, 1));
    expect(call('GIVE_PRIZE')).toBe(1);
    expect(record().receivedPrize).toBe(false);
  });

  test('ResumeTimer: on again during the challenge, capped at the max', () => {
    start('SINGLE');
    gMain.vblankCounter1 = null;
    call('RESUME_TIMER');
    expect(gMain.vblankCounter1).toBe(record());
    gMain.vblankCounter1 = null;
    record().timer = t.d('TRAINER_TOWER_MAX_TIME') + 3;
    call('RESUME_TIMER');
    expect(record().timer).toBe(t.d('TRAINER_TOWER_MAX_TIME'));
    expect(gMain.vblankCounter1).toBeNull();
  });

  test('the dummied and fixed answers', () => {
    expect(call('GET_NUM_FLOORS')).toBe(0); // local sets: all 8 floors
    expect(call('SHOULD_WARP_TO_COUNTER')).toBe(0);
    t.state.party = [];
    expect(call('CHECK_DOUBLES')).toBe(t.d('PLAYER_HAS_ONE_USABLE_MON'));
  });
});

describe('the floors', () => {
  test('InitTrainerTowerFloor: the layout and the trainers\' graphics by challenge type', () => {
    start('SINGLE');
    on('LAYOUT_TRAINER_TOWER_1F');
    expect(call('INIT_FLOOR')).toBe(t.d('CHALLENGE_TYPE_SINGLE'));
    expect(t.state.mapLayoutId).toBe(t.d('LAYOUT_TRAINER_TOWER_1F'));
    expect(t.state.getVar('VAR_OBJ_GFX_ID_1')).toBe(t.d('OBJ_EVENT_GFX_SAILOR')); // ALBERTO, FACILITY_CLASS_SAILOR

    start('DOUBLE');
    on('LAYOUT_TRAINER_TOWER_1F');
    expect(call('INIT_FLOOR')).toBe(t.d('CHALLENGE_TYPE_DOUBLE'));
    expect(t.state.mapLayoutId).toBe(t.d('LAYOUT_TRAINER_TOWER_1F_DOUBLES'));
    expect(t.state.getVar('VAR_OBJ_GFX_ID_0')).toBe(t.d('OBJ_EVENT_GFX_LITTLE_GIRL')); // JEN & KIRA, FACILITY_CLASS_TWINS
    expect(t.state.getVar('VAR_OBJ_GFX_ID_3')).toBe(t.d('OBJ_EVENT_GFX_LITTLE_GIRL'));

    start('KNOCKOUT');
    on('LAYOUT_TRAINER_TOWER_1F');
    expect(call('INIT_FLOOR')).toBe(t.d('CHALLENGE_TYPE_KNOCKOUT'));
    expect(t.state.mapLayoutId).toBe(t.d('LAYOUT_TRAINER_TOWER_1F_KNOCKOUT'));
    expect(t.state.getVar('VAR_OBJ_GFX_ID_2')).toBe(t.d('OBJ_EVENT_GFX_BIKER')); // JORDY, BIKER
    expect(t.state.getVar('VAR_OBJ_GFX_ID_0')).toBe(t.d('OBJ_EVENT_GFX_BIKER')); // ERNEST, BIKER
    expect(t.state.getVar('VAR_OBJ_GFX_ID_1')).toBe(t.d('OBJ_EVENT_GFX_BIKER')); // GABRIEL, CUE_BALL

    // Mixed: 4F is sTrainerTowerFloor_Double_8
    start('MIXED');
    on('LAYOUT_TRAINER_TOWER_4F');
    expect(call('INIT_FLOOR')).toBe(t.d('CHALLENGE_TYPE_DOUBLE'));
    expect(t.state.mapLayoutId).toBe(t.d('LAYOUT_TRAINER_TOWER_4F_DOUBLES'));
    expect(call('GET_CHALLENGE_TYPE', 0)).toBe(t.d('CHALLENGE_TYPE_DOUBLE'));
  });

  test('BufferTowerOpponentSpeech: the speech in gStringVar4 and the text colour by gender', () => {
    start('SINGLE');
    on('LAYOUT_TRAINER_TOWER_1F');
    const alberto = trainerTowerData().floors.sTrainerTowerFloor_Single_1.trainers[0];
    t.state.setVar('VAR_TEXT_COLOR', t.d('NPC_TEXT_COLOR_NEUTRAL'));
    call('GET_SPEECH', t.d('TRAINER_TOWER_TEXT_INTRO'), 0);
    const intro = [...gStringVar4];
    const rows3 = ConvertEasyChatWordsToString(t.state, alberto.speechBefore, 3, 2);
    if (normalWidth(rows3) <= 196) expect(intro).toEqual(rows3);
    else expect(intro.filter((c) => c === 0xfa)).toHaveLength(1);
    expect(t.state.getVar('VAR_TEXT_COLOR')).toBe(t.d('MALE'));
    expect(t.state.getVar('VAR_PREV_TEXT_COLOR')).toBe(t.d('NPC_TEXT_COLOR_NEUTRAL'));
    call('GET_SPEECH', t.d('TRAINER_TOWER_TEXT_AFTER'), 0);
    expect([...gStringVar4]).not.toEqual(intro);

    // A doubles pair: JEN & KIRA (FACILITY_CLASS_TWINS, both FEMALE)
    start('DOUBLE');
    t.state.setVar('VAR_TEMP_3', 1);
    call('GET_SPEECH', t.d('TRAINER_TOWER_TEXT_INTRO'), 1);
    expect(t.state.getVar('VAR_TEXT_COLOR')).toBe(t.d('FEMALE'));
  });

  test('TT_ConvertEasyChatMessageToString: too wide for 3 words a row, it prints 2 a row with \\l after row 2', () => {
    // The six widest words the sets' speeches use
    const words = [
      ...new Set(Object.values(trainerTowerData().floors).flatMap((f) => f.trainers.flatMap((tr) => [...tr.speechBefore, ...tr.speechWin, ...tr.speechLose, ...tr.speechAfter]))),
    ].filter((w) => w !== 0xffff);
    const width = (w: number) => normalWidth([...CopyEasyChatWord(t.state, w), 0xff]);
    const wide = words.sort((x, y) => width(y) - width(x)).slice(0, 6);
    expect(normalWidth(ConvertEasyChatWordsToString(t.state, wide, 3, 2))).toBeGreaterThan(196);
    const expected = ConvertEasyChatWordsToString(t.state, wide, 2, 3);
    expected[expected.indexOf(0xfe, expected.indexOf(0xfe) + 1)] = 0xfa; // CHAR_PROMPT_SCROLL
    expect(TT_ConvertEasyChatMessageToString(t.state, wide)).toEqual(expected);
    // A short one stays 3 x 2
    const short = trainerTowerData().floors.sTrainerTowerFloor_Single_4.trainers[0].speechWin;
    expect(TT_ConvertEasyChatMessageToString(t.state, short)).toEqual(ConvertEasyChatWordsToString(t.state, short, 3, 2));
  });
});

describe('the battles (DoTrainerTowerBattle, BuildEnemyParty, the battle\'s opponent)', () => {
  /** A party mon of `species` at `level`. */
  const partyMon = (species: string, level: number) =>
    t.pokemon.createMon(t.d(`SPECIES_${species}`), level, { otId: 1, otName: 'RED', otGender: 'male', metLocation: 'MAPSEC_NONE' });

  /** `ttower_dobattle` on `layout` with VAR_TEMP_1 = `trainer`: the battle it starts. */
  function doBattle(layout: string, trainer: number) {
    on(layout);
    t.state.setVar('VAR_TEMP_1', trainer);
    battles.length = 0;
    call('DO_BATTLE');
    expect(battles).toHaveLength(1);
    return battles[0];
  }

  test('a Single floor: two of the trainer\'s mons at the party\'s top level, TRAINER | TRAINER_TOWER', () => {
    t.state.party = [partyMon('PIDGEY', 30), partyMon('RATTATA', 50), partyMon('MEW', 70)];
    t.state.party[2].isEgg = true; // GetPartyMaxLevel leaves eggs out
    expect(GetPartyMaxLevel(t.state)).toBe(50);
    start('SINGLE');
    const before = JSON.stringify(trainerTowerData().floors.sTrainerTowerFloor_Single_1);
    const b = doBattle('LAYOUT_TRAINER_TOWER_1F', 0);
    expect(b.flags).toBe(t.d('BATTLE_TYPE_TRAINER') | t.d('BATTLE_TYPE_TRAINER_TOWER'));
    // sSingleBattleChallengeMonIdxs[0] = {0, 2}: ALBERTO's FERALIGATR and his third mon
    const trainer = trainerTowerData().floors.sTrainerTowerFloor_Single_1.trainers[0];
    expect(b.party.map((m) => m.species)).toEqual([trainer.mons[0].species, trainer.mons[2].species]);
    expect(b.party.map((m) => m.level)).toEqual([50, 50]);
    expect(t.state.enemyParty).toBe(b.party);
    // The data is untouched (the C sets the level in its own copy)
    expect(JSON.stringify(trainerTowerData().floors.sTrainerTowerFloor_Single_1)).toBe(before);
    // Lv50 FERALIGATR, 15 IVs, 255 Atk / 100 SpA / 155 SpD EVs, personality 50 (Hardy: no nature change); base stats
    // 85 / 105 / 100 / 78 / 79 / 83: floor((2B + IV + EV/4) * L / 100) + 5, HP + L + 10
    const fer = b.party[0];
    expect(fer.species).toBe(t.d('SPECIES_FERALIGATR'));
    const stat = (base: number, ev: number) => Math.floor(((2 * base + 15 + Math.floor(ev / 4)) * 50) / 100) + 5;
    expect(fer.maxHP).toBe(Math.floor(((2 * 85 + 15) * 50) / 100) + 50 + 10);
    expect(fer.hp).toBe(fer.maxHP);
    expect(fer.stats).toMatchObject({ attack: stat(105, 255), defense: stat(100, 0), speed: stat(78, 0), spAttack: stat(79, 100), spDefense: stat(83, 155) });
    expect(fer).toMatchObject({ personality: 50, otId: trainer.mons[0].otId, heldItem: trainer.mons[0].heldItem, friendship: 255, moves: trainer.mons[0].moves });
    expect(fer.pp).toEqual(fer.moves.map((m) => t.pokemon.moves[m].pp));
    expect(t.charmap.decodePlain(fer.nickname)).toBe('FERALIGATR');
    // BattleSetup_GetBattleTowerBattleTransition: the enemy's Lv50 against the lead's Lv30. The enemy is at the party's
    // top level, never below the lead's, so the tower always gets the big Poké Ball
    expect(b.transition).toBe(t.d('B_TRANSITION_BIG_POKEBALL'));
    t.state.party[0] = partyMon('PIDGEY', 60);
    expect(doBattle('LAYOUT_TRAINER_TOWER_1F', 0).transition).toBe(t.d('B_TRANSITION_BIG_POKEBALL'));
  });

  test('the mons go by floors cleared; a Double floor takes one of each trainer\'s, a Knockout one of VAR_TEMP_1\'s', () => {
    t.state.party = [partyMon('PIDGEY', 40)];
    const d = trainerTowerData();
    start('SINGLE');
    record().floorsCleared = 3;
    let b = doBattle('LAYOUT_TRAINER_TOWER_4F', 0);
    const single4 = d.floors[d.sets[0][3]].trainers[0];
    expect(b.party.map((m) => m.species)).toEqual(d.singleBattleChallengeMonIdxs[3].map((i) => single4.mons[i].species));

    start('DOUBLE');
    record().floorsCleared = 1;
    b = doBattle('LAYOUT_TRAINER_TOWER_2F', 0);
    expect(b.flags).toBe(t.d('BATTLE_TYPE_TRAINER') | t.d('BATTLE_TYPE_TRAINER_TOWER') | t.d('BATTLE_TYPE_DOUBLE'));
    const double2 = d.floors[d.sets[1][1]];
    const [i0, i1] = d.doubleBattleChallengeMonIdxs[1];
    expect(b.party.map((m) => [m.species, m.level])).toEqual([
      [double2.trainers[0].mons[i0].species, 40],
      [double2.trainers[1].mons[i1].species, 40],
    ]);

    start('KNOCKOUT');
    record().floorsCleared = 2;
    b = doBattle('LAYOUT_TRAINER_TOWER_3F', 1);
    const ko3 = d.floors[d.sets[2][2]];
    expect(b.flags).toBe(t.d('BATTLE_TYPE_TRAINER') | t.d('BATTLE_TYPE_TRAINER_TOWER'));
    expect(b.party.map((m) => m.species)).toEqual([ko3.trainers[1].mons[d.knockoutChallengeMonIdxs[2][1]].species]);
  });

  test('InitTrainerTowerBattleStruct: the class, name, pic and both trainers\' end-of-battle texts', () => {
    const d = trainerTowerData();
    start('DOUBLE');
    on('LAYOUT_TRAINER_TOWER_1F');
    t.state.setVar('VAR_TEMP_1', 0);
    gMain.vblankCounter1 = null;
    InitTrainerTowerBattleStruct(t.state);
    expect(gMain.vblankCounter1).toBe(record()); // the timer counts during the battle
    const floor = d.floors[d.sets[1][0]];
    const [tr0, tr1] = floor.trainers;
    expect(GetTrainerTowerOpponentName()).toBe(tr0.name);
    expect(GetTrainerTowerOpponentClass()).toBe(d.facilityClassToTrainerClass[tr0.facilityClass]);
    expect(GetTrainerTowerOpponentClass()).toBe(t.d('TRAINER_CLASS_TWINS')); // JEN & KIRA
    expect(GetTrainerTowerTrainerFrontSpriteId()).toBe(t.d('TRAINER_PIC_TWINS'));
    expect(trainerTowerOpponentPicId(t.state)).toBe(t.d('TRAINER_PIC_TWINS'));
    const text = (words: number[]) => TT_ConvertEasyChatMessageToString(t.state, words);
    expect(GetTrainerTowerOpponentWinText(t.state, 0)).toEqual(text(tr0.speechWin));
    expect(GetTrainerTowerOpponentLoseText(t.state, 1)).toEqual(text(tr1.speechLose));
    expect(gStringVar4).toEqual(text(tr1.speechLose));
    expect(t.state.getVar('VAR_TEMP_3')).toBe(1);
    expect(GetTrainerTowerOpponentWinText(t.state, 1)).toEqual(text(tr1.speechWin));
    expect(GetTrainerTowerOpponentLoseText(t.state, 0)).toEqual(text(tr0.speechLose));
    FreeTrainerTowerBattleStruct();
    expect(() => GetTrainerTowerOpponentName()).toThrow();
  });
});

describe('battle_records.c\'s Trainer Tower page', () => {
  test('PrintTrainerTowerRecords: TIME BOARD, each challenge type and its record time; a record of another set starts over', async () => {
    t = await newBattleEnv(); // gText_TimeBoard / gText_XMinYZSec / gTrainerTowerChallengeTypeTexts (battle/strings.json)
    setTextStrings(readGen<Record<string, string>>('text/strings.json')); // gOtherText_Single & co. (strings.c)
    on('LAYOUT_TRAINER_TOWER_LOBBY');
    ResetBgsAndClearDma3BusyFlags(false);
    InitBgsFromTemplates(0, [{ bg: 0, charBaseIndex: 0, mapBaseIndex: 31, screenSize: 0, paletteMode: 0, priority: 0, baseTile: 0 }], 1);
    InitWindows([{ bg: 0, tilemapLeft: 2, tilemapTop: 1, width: 27, height: 18, paletteNum: 15, baseBlock: 0x014 }, DUMMY_WIN_TEMPLATE]);
    start('SINGLE'); // the set's id in the record
    t.state.trainerTower[0].bestTime = 3 * 3600 + 25 * 60 + 45; // 3 min. 25 s and 45 frames: .75 (45 * 168 / 100)
    t.state.trainerTower[2].bestTime = 1000; // a KNOCKOUT time, from another set: the current record is the one checked
    t.state.trainerTower[0].unk9 = 0; // ... so the SINGLE record, of "another set", starts over
    const printed: { x: number; y: number; color: number[]; text: string; win: number }[] = [];
    PrintTrainerTowerRecords(t.state, (win, x, y, color, str) => printed.push({ win, x, y, color, text: t.charmap.decodePlain(str.slice(0, str.indexOf(0xff))) }));
    expect(t.state.trainerTower[0].bestTime).toBe(t.d('TRAINER_TOWER_MAX_TIME'));
    expect(printed.map((p) => [p.x, p.y, p.text])).toEqual([
      [74, 0, 'TIME BOARD'],
      [24, 36, 'SINGLE'],
      [96, 36, '59MIN. 59.99SEC.'],
      [24, 56, 'DOUBLE'],
      [96, 56, '59MIN. 59.99SEC.'],
      [24, 76, 'KNOCKOUT'],
      [96, 76, ' 0MIN. 16.67SEC.'],
      [24, 96, 'MIXED'],
      [96, 96, '59MIN. 59.99SEC.'],
    ]);
    expect(printed.every((p) => p.win === 0 && p.color.join() === '0,2,3')).toBe(true);
    // A record of this set is kept
    t.state.trainerTower[0].bestTime = 3 * 3600 + 25 * 60 + 45;
    printed.length = 0;
    PrintTrainerTowerRecords(t.state, (win, x, y, color, str) => printed.push({ win, x, y, color, text: t.charmap.decodePlain(str.slice(0, str.indexOf(0xff))) }));
    expect(printed[2].text).toBe(' 3MIN. 25.75SEC.');
  });
});
