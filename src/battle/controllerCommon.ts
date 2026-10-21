// What battle_controller_player.c, _opponent.c and _oak_old_man.c share verbatim apart from the
// party they read: CopyXMonData / SetXMonData (the REQUEST_* switch), the hit-blink effect and
// the exp-bar tasks of the player-side controllers.

import { m4aSongNumStop } from '../audio/m4a';
import { testEvent } from '../dev/testHooks';
import { PlaySE } from '../gba/sound';
import { gSprites } from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, type TaskFunc } from '../gba/task';
import { IsTextPrinterActive } from '../gba/window';
import type { Pokemon, Stat } from '../pokemon/Pokemon';
import { MoveBattleBar, SetBattleBarStruct, SetHealthboxSpriteVisible, UpdateHealthboxAttribute, UpdateHpTextInHealthbox } from './battleInterface';
import { MoveBattlerSpriteToBG, ResetBattleAnimBg } from './anim/battleAnim';
import { CreateLevelUpVerticalSpritesTask, LevelUpVerticalSpritesTaskIsRunning } from '../menus/pokemonSpecialAnimScene';
import { IsMonGettingExpSentOut } from './bsCommands3';
import { K } from './constants';
import { emitDataTransfer, emitTwoReturnValues, u16, u32 } from './controllers';
import { g, gSpeciesInfo, pokemon } from './env';
import { GetBattlerSpriteBGPriorityRank, HandleLowHpMusicChange, InitAndLaunchSpecialAnimation, IsBattlerSpriteVisible, LoadBattleBarGfx } from './gfx';
import { calculateMonStats, getAbilityBySpecies } from './pokemonBattle';
import { BattlePokemon } from './structs';

const STAT_ORDER: Stat[] = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'];

/** struct BattlePokemon from a party mon (REQUEST_ALL_BATTLE) */
export function battlePokemonOf(mon: Pokemon): BattlePokemon {
  const b = new BattlePokemon();
  b.species = mon.species;
  b.item = mon.heldItem;
  for (let i = 0; i < K.MAX_MON_MOVES; i++) {
    b.moves[i] = mon.moves[i];
    b.pp[i] = mon.pp[i];
  }
  b.ppBonuses = mon.ppBonuses;
  b.friendship = mon.friendship;
  b.experience = mon.exp;
  b.hpIV = mon.ivs.hp;
  b.attackIV = mon.ivs.attack;
  b.defenseIV = mon.ivs.defense;
  b.speedIV = mon.ivs.speed;
  b.spAttackIV = mon.ivs.spAttack;
  b.spDefenseIV = mon.ivs.spDefense;
  b.personality = mon.personality;
  b.status1 = mon.status;
  b.level = mon.level;
  b.hp = mon.hp;
  b.maxHP = mon.maxHP;
  b.attack = mon.stats.attack;
  b.defense = mon.stats.defense;
  b.speed = mon.stats.speed;
  b.spAttack = mon.stats.spAttack;
  b.spDefense = mon.stats.spDefense;
  b.isEgg = mon.isEgg ? 1 : 0;
  b.abilityNum = mon.abilityNum;
  b.otId = mon.otId;
  b.nickname = [...mon.nickname, K.EOS];
  b.otName = [...pokemon.encodeName(mon.otName), K.EOS];
  b.ability = getAbilityBySpecies(b.species, b.abilityNum);
  return b;
}

/** CopyPlayerMonData / CopyOpponentMonData: the requested field's bytes (and struct for ALL). */
function copyMonData(mon: Pokemon, request: number): { bytes: number[]; obj?: unknown } {
  const R = (n: string) => K[`REQUEST_${n}_BATTLE`];
  if (request === R('ALL')) return { bytes: [], obj: battlePokemonOf(mon) };
  if (request === R('SPECIES')) return { bytes: u16(mon.species) };
  if (request === R('HELDITEM')) return { bytes: u16(mon.heldItem) };
  if (request === R('MOVES_PP')) return { bytes: [...mon.moves.flatMap(u16), ...mon.pp, mon.ppBonuses] };
  if (request >= R('MOVE1') && request <= R('MOVE4')) return { bytes: u16(mon.moves[request - R('MOVE1')]) };
  if (request === R('PP_DATA')) return { bytes: [...mon.pp, mon.ppBonuses] };
  if (request >= R('PPMOVE1') && request <= R('PPMOVE4')) return { bytes: [mon.pp[request - R('PPMOVE1')]] };
  if (request === R('OTID')) return { bytes: u32(mon.otId).slice(0, 3) };
  if (request === R('EXP')) return { bytes: u32(mon.exp).slice(0, 3) };
  const evs = ['HP_EV', 'ATK_EV', 'DEF_EV', 'SPEED_EV', 'SPATK_EV', 'SPDEF_EV'];
  const evStat: Stat[] = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'];
  for (let i = 0; i < evs.length; i++) if (request === R(evs[i])) return { bytes: [mon.evs[evStat[i]]] };
  if (request === R('FRIENDSHIP')) return { bytes: [mon.friendship] };
  if (request === R('POKERUS')) return { bytes: [mon.pokerus ?? 0] };
  if (request === R('MET_LEVEL')) return { bytes: [mon.metLevel] };
  if (request === R('POKEBALL')) return { bytes: [mon.pokeball] };
  if (request === R('ALL_IVS')) return { bytes: STAT_ORDER.map((s) => mon.ivs[s]) };
  const ivs = ['HP_IV', 'ATK_IV', 'DEF_IV', 'SPEED_IV', 'SPATK_IV', 'SPDEF_IV'];
  for (let i = 0; i < ivs.length; i++) if (request === R(ivs[i])) return { bytes: [mon.ivs[evStat[i]]] };
  if (request === R('PERSONALITY')) return { bytes: u32(mon.personality) };
  if (request === R('STATUS')) return { bytes: u32(mon.status) };
  if (request === R('LEVEL')) return { bytes: [mon.level] };
  if (request === R('HP')) return { bytes: u16(mon.hp) };
  if (request === R('MAX_HP')) return { bytes: u16(mon.maxHP) };
  const stats = ['ATK', 'DEF', 'SPEED', 'SPATK', 'SPDEF'];
  const statKeys: Stat[] = ['attack', 'defense', 'speed', 'spAttack', 'spDefense'];
  for (let i = 0; i < stats.length; i++) if (request === R(stats[i])) return { bytes: u16(mon.stats[statKeys[i]]) };
  // MET_LOCATION/MET_GAME/CHECKSUM, contest stats and ribbons aren't modelled: read as zero.
  return { bytes: [0] };
}

/** XHandleGetMonData */
export function handleGetMonData(party: (Pokemon | undefined)[]): void {
  const bufA = g.battleBufferA[g.activeBattler];
  const out: number[] = [];
  let obj: unknown;
  const add = (monId: number) => {
    const r = copyMonData(party[monId]!, bufA[1]);
    out.push(...r.bytes);
    obj ??= r.obj;
  };
  if (bufA[2] === 0) {
    add(g.battlerPartyIndexes[g.activeBattler]);
  } else {
    let monToCheck = bufA[2];
    for (let i = 0; i < K.PARTY_SIZE; i++) {
      if (monToCheck & 1) add(i);
      monToCheck >>= 1;
    }
  }
  emitDataTransfer(K.BUFFER_B, out, obj);
}

const rd16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const rd32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** SetPlayerMonData / SetOpponentMonData */
function setMonData(mon: Pokemon, bufA: Uint8Array, objA: unknown): void {
  const R = (n: string) => K[`REQUEST_${n}_BATTLE`];
  const req = bufA[1];
  const v = 3; // data starts at gBattleBufferA[battler][3]
  if (req === R('ALL')) {
    const b = objA as BattlePokemon;
    mon.species = b.species;
    mon.heldItem = b.item;
    for (let i = 0; i < K.MAX_MON_MOVES; i++) {
      mon.moves[i] = b.moves[i];
      mon.pp[i] = b.pp[i];
    }
    mon.ppBonuses = b.ppBonuses;
    mon.friendship = b.friendship;
    mon.exp = b.experience;
    mon.ivs = { hp: b.hpIV, attack: b.attackIV, defense: b.defenseIV, speed: b.speedIV, spAttack: b.spAttackIV, spDefense: b.spDefenseIV };
    mon.personality = b.personality;
    mon.status = b.status1;
    mon.level = b.level;
    mon.hp = b.hp;
    mon.maxHP = b.maxHP;
    mon.stats = { hp: b.maxHP, attack: b.attack, defense: b.defense, speed: b.speed, spAttack: b.spAttack, spDefense: b.spDefense };
  } else if (req === R('SPECIES')) mon.species = rd16(bufA, v);
  else if (req === R('HELDITEM')) mon.heldItem = rd16(bufA, v);
  else if (req === R('MOVES_PP')) {
    for (let i = 0; i < K.MAX_MON_MOVES; i++) {
      mon.moves[i] = rd16(bufA, v + i * 2);
      mon.pp[i] = bufA[v + 8 + i];
    }
    mon.ppBonuses = bufA[v + 12];
  } else if (req >= R('MOVE1') && req <= R('MOVE4')) mon.moves[req - R('MOVE1')] = rd16(bufA, v);
  else if (req === R('PP_DATA')) {
    for (let i = 0; i < 4; i++) mon.pp[i] = bufA[v + i];
    mon.ppBonuses = bufA[v + 4];
  } else if (req >= R('PPMOVE1') && req <= R('PPMOVE4')) mon.pp[req - R('PPMOVE1')] = bufA[v];
  else if (req === R('OTID')) mon.otId = rd32(bufA, v);
  else if (req === R('EXP')) mon.exp = rd32(bufA, v) & 0xffffff;
  else if (req === R('FRIENDSHIP')) mon.friendship = bufA[v];
  else if (req === R('POKERUS')) mon.pokerus = bufA[v];
  else if (req === R('MET_LEVEL')) mon.metLevel = bufA[v];
  else if (req === R('POKEBALL')) mon.pokeball = bufA[v];
  else if (req === R('PERSONALITY')) mon.personality = rd32(bufA, v);
  else if (req === R('STATUS')) mon.status = rd32(bufA, v);
  else if (req === R('LEVEL')) mon.level = bufA[v];
  else if (req === R('HP')) mon.hp = rd16(bufA, v);
  else if (req === R('MAX_HP')) mon.maxHP = mon.stats.hp = rd16(bufA, v);
  else {
    const evs = ['HP_EV', 'ATK_EV', 'DEF_EV', 'SPEED_EV', 'SPATK_EV', 'SPDEF_EV'];
    const ivs = ['HP_IV', 'ATK_IV', 'DEF_IV', 'SPEED_IV', 'SPATK_IV', 'SPDEF_IV'];
    const stats = ['ATK', 'DEF', 'SPEED', 'SPATK', 'SPDEF'];
    const keys: Stat[] = ['hp', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'];
    for (let i = 0; i < 6; i++) {
      if (req === R(evs[i])) return void (mon.evs[keys[i]] = bufA[v]);
      if (req === R(ivs[i])) return void (mon.ivs[keys[i]] = bufA[v]);
    }
    if (req === R('ALL_IVS')) {
      for (let i = 0; i < 6; i++) mon.ivs[keys[i]] = bufA[v + i];
      return;
    }
    for (let i = 0; i < stats.length; i++) if (req === R(stats[i])) return void (mon.stats[keys[i + 1]] = rd16(bufA, v));
    // CHECKSUM, MET_LOCATION/GAME, contest stats and ribbons aren't modelled
  }
}

/** XHandleSetMonData */
export function handleSetMonData(party: (Pokemon | undefined)[]): void {
  const ab = g.activeBattler;
  const bufA = g.battleBufferA[ab];
  if (bufA[2] === 0) {
    setMonData(party[g.battlerPartyIndexes[ab]]!, bufA, g.battleBufferAObj[ab]);
  } else {
    let monToCheck = bufA[2];
    for (let i = 0; i < K.PARTY_SIZE; i++) {
      if (monToCheck & 1) setMonData(party[i]!, bufA, g.battleBufferAObj[ab]);
      monToCheck >>= 1;
    }
  }
}

/** XHandleStatusXor */
export function handleStatusXor(party: (Pokemon | undefined)[]): void {
  const mon = party[g.battlerPartyIndexes[g.activeBattler]]!;
  mon.status = (mon.status ^ g.battleBufferA[g.activeBattler][1]) & 0xff; // the C stores it via a u8
}

/** DoHitAnimBlinkSpriteEffect: returns true when done */
export function hitAnimBlinkStep(): boolean {
  const s = gSprites[g.battlerSpriteIds[g.activeBattler]];
  if (s.data[1] === 32) {
    s.data[1] = 0;
    s.invisible = false;
    g.doingBattleAnim = false;
    return true;
  }
  if (s.data[1] % 4 === 0) s.invisible = !s.invisible;
  ++s.data[1];
  return false;
}

/** CompleteOnHealthbarDone: returns true when done (the caller then completes) */
export function healthbarStep(party: (Pokemon | undefined)[], lowHpMusic = true): boolean {
  const ab = g.activeBattler;
  const hpValue = MoveBattleBar(ab, g.healthboxSpriteIds[ab], K.HEALTH_BAR, 0);
  SetHealthboxSpriteVisible(g.healthboxSpriteIds[ab]);
  if (hpValue !== -1) {
    UpdateHpTextInHealthbox(g.healthboxSpriteIds[ab], hpValue, K.HP_CURRENT);
    return false;
  }
  if (lowHpMusic) HandleLowHpMusicChange(party[g.battlerPartyIndexes[ab]]!, ab);
  return true;
}

// ---------------------------------------------------------------- exp tasks (player & oak/old man)

const tExpTask_monId = 0;
const tExpTask_gainedExp = 1;
const tExpTask_battler = 2;
const tExpTask_frames = 10;

const expTable = (mon: Pokemon) => pokemon.tables.experience[gSpeciesInfo[mon.species].growthRate];
const isDouble = () => (g.battleTypeFlags & K.BATTLE_TYPE_DOUBLE) !== 0;

/**
 * The Task_GiveExpToMon chain. `onDone(battlerId)` sets the controller to its
 * CompleteOnInactiveTextPrinter; `levelUpEffects` is the player's Task_CreateLevelUpVerticalStripes (the
 * Oak/Old Man controller skips it).
 */
export function startExpTask(monId: number, gainedExp: number, battlerId: number, onDone: (battlerId: number) => void, levelUpEffects: boolean): void {
  const taskId = CreateTask(makeGiveExpToMon(onDone, levelUpEffects), 10);
  const d = gTasks[taskId].data;
  d[tExpTask_monId] = monId;
  d[tExpTask_gainedExp] = gainedExp;
  d[tExpTask_battler] = battlerId;
}

function makeGiveExpToMon(onDone: (b: number) => void, levelUpEffects: boolean): TaskFunc {
  const createLevelUpVerticalStripes: TaskFunc = (taskId) => {
    // Task_CreateLevelUpVerticalStripes (battle_controller_player.c)
    const data = gTasks[taskId].data;
    const battlerId = data[tExpTask_battler];
    const isOnBg2 = (GetBattlerSpriteBGPriorityRank(battlerId) ^ 1) !== 0;
    const sprite = gSprites[g.battlerSpriteIds[battlerId]];
    switch (data[15]) {
      case 0:
        if (!IsTextPrinterActive(0)) {
          if (!isOnBg2) {
            data[14] = g.battle_BG1_X;
            data[13] = g.battle_BG1_Y;
            g.battle_BG1_X = -(sprite.x + sprite.x2) + 32;
            g.battle_BG1_Y = -(sprite.y + sprite.y2) + 32;
          } else {
            data[14] = g.battle_BG2_X;
            data[13] = g.battle_BG2_Y;
            g.battle_BG2_X = -(sprite.x + sprite.x2) + 32;
            g.battle_BG2_Y = -(sprite.y + sprite.y2) + 32;
          }
          ++data[15];
        }
        break;
      case 1:
        MoveBattlerSpriteToBG(battlerId, isOnBg2);
        ++data[15];
        break;
      case 2:
        PlaySE(K.SE_RS_SHOP);
        if (IsMonGettingExpSentOut()) CreateLevelUpVerticalSpritesTask(sprite.x + sprite.x2, sprite.y + sprite.y2, 10000, 10000, 1, 0);
        testEvent('levelUpStripes', { phase: 'start', battler: battlerId, stripes: LevelUpVerticalSpritesTaskIsRunning() });
        ++data[15];
        break;
      case 3:
        if (!LevelUpVerticalSpritesTaskIsRunning()) {
          testEvent('levelUpStripes', { phase: 'end', battler: battlerId });
          sprite.invisible = false;
          ++data[15];
        }
        break;
      case 5:
        ResetBattleAnimBg(isOnBg2);
        ++data[15];
        break;
      case 4:
        ++data[15];
        break;
      case 6:
        if (!isOnBg2) {
          g.battle_BG1_X = data[14];
          g.battle_BG1_Y = data[13];
        } else {
          g.battle_BG2_X = data[14];
          g.battle_BG2_Y = data[13];
        }
        onDone(battlerId);
        DestroyTask(taskId);
        break;
    }
  };
  const destroyExpTaskAndComplete: TaskFunc = (taskId) => {
    // DestroyExpTaskAndCompleteOnInactiveTextPrinter: the player's runs Task_CreateLevelUpVerticalStripes first
    // when its battler's sprite is visible; the Oak/Old Man controller's completes at once
    const battlerId = gTasks[taskId].data[tExpTask_battler];
    if (levelUpEffects && IsBattlerSpriteVisible(battlerId)) {
      gTasks[taskId].func = createLevelUpVerticalStripes;
      gTasks[taskId].data[15] = 0;
    } else {
      onDone(battlerId);
      DestroyTask(taskId);
    }
  };
  const updateLvlInHealthbox: TaskFunc = (taskId) => {
    const d = gTasks[taskId].data;
    const battlerId = d[tExpTask_battler];
    if (!g.battleSpritesDataPtr.healthBoxesData[battlerId].specialAnimActive) {
      const monIndex = d[tExpTask_monId];
      const target = isDouble() && monIndex === g.battlerPartyIndexes[battlerId ^ K.BIT_FLANK] ? battlerId ^ K.BIT_FLANK : battlerId;
      UpdateHealthboxAttribute(g.healthboxSpriteIds[target], g.playerParty[monIndex]!, K.HEALTHBOX_ALL);
      gTasks[taskId].func = destroyExpTaskAndComplete;
    }
  };
  const launchLvlUpAnim: TaskFunc = (taskId) => {
    const d = gTasks[taskId].data;
    let battlerId = d[tExpTask_battler];
    if (isDouble() && d[tExpTask_monId] === g.battlerPartyIndexes[battlerId ^ K.BIT_FLANK]) battlerId ^= K.BIT_FLANK;
    InitAndLaunchSpecialAnimation(battlerId, battlerId, battlerId, K.B_ANIM_LVL_UP);
    gTasks[taskId].func = updateLvlInHealthbox;
  };
  const levelUp = (taskId: number, mon: Pokemon, gainedExp: number, currExp: number, nextLvlExp: number): number => {
    mon.exp = nextLvlExp;
    calculateMonStats(mon);
    gainedExp -= nextLvlExp - currExp;
    const saved = g.activeBattler;
    g.activeBattler = gTasks[taskId].data[tExpTask_battler];
    emitTwoReturnValues(K.BUFFER_B, K.RET_VALUE_LEVELED_UP, gainedExp);
    g.activeBattler = saved;
    return gainedExp;
  };
  const giveExpWithExpBar: TaskFunc = (taskId) => {
    const d = gTasks[taskId].data;
    if (d[tExpTask_frames] < 13) {
      ++d[tExpTask_frames];
      return;
    }
    const monId = d[tExpTask_monId];
    const gainedExp = d[tExpTask_gainedExp];
    const battlerId = d[tExpTask_battler];
    const newExpPoints = MoveBattleBar(battlerId, g.healthboxSpriteIds[battlerId], K.EXP_BAR, 0);
    SetHealthboxSpriteVisible(g.healthboxSpriteIds[battlerId]);
    if (newExpPoints === -1) {
      // The bar has been filled with given exp points.
      m4aSongNumStop(K.SE_EXP);
      const mon = g.playerParty[monId]!;
      const expOnNextLvl = expTable(mon)[mon.level + 1];
      if (mon.exp + gainedExp >= expOnNextLvl) {
        levelUp(taskId, mon, gainedExp, mon.exp, expOnNextLvl);
        gTasks[taskId].func = launchLvlUpAnim;
      } else {
        mon.exp += gainedExp;
        onDone(battlerId);
        DestroyTask(taskId);
      }
    }
  };
  const prepareToGiveExpWithExpBar: TaskFunc = (taskId) => {
    const d = gTasks[taskId].data;
    const mon = g.playerParty[d[tExpTask_monId]]!;
    const table = expTable(mon);
    const currLvlExp = table[mon.level];
    SetBattleBarStruct(d[tExpTask_battler], g.healthboxSpriteIds[d[tExpTask_battler]], table[mon.level + 1] - currLvlExp, mon.exp - currLvlExp, -d[tExpTask_gainedExp]);
    PlaySE(K.SE_EXP);
    gTasks[taskId].func = giveExpWithExpBar;
  };
  return (taskId) => {
    // Task_GiveExpToMon
    const d = gTasks[taskId].data;
    const monId = d[tExpTask_monId] & 0xff;
    const battlerId = d[tExpTask_battler];
    let gainedExp = d[tExpTask_gainedExp];
    if (isDouble() || monId !== g.battlerPartyIndexes[battlerId]) {
      // Give exp without moving the expbar.
      const mon = g.playerParty[monId]!;
      const nextLvlExp = expTable(mon)[mon.level + 1];
      if (mon.exp + gainedExp >= nextLvlExp) {
        gainedExp = levelUp(taskId, mon, gainedExp, mon.exp, nextLvlExp);
        if (isDouble() && (monId === g.battlerPartyIndexes[battlerId] || monId === g.battlerPartyIndexes[battlerId ^ K.BIT_FLANK])) gTasks[taskId].func = launchLvlUpAnim;
        else gTasks[taskId].func = destroyExpTaskAndComplete;
      } else {
        mon.exp += gainedExp;
        onDone(battlerId);
        DestroyTask(taskId);
      }
    } else {
      gTasks[taskId].func = prepareToGiveExpWithExpBar;
    }
  };
}

/** XHandleExpUpdate (player side) */
export function handleExpUpdate(onDone: (b: number) => void, levelUpEffects: boolean): boolean {
  const ab = g.activeBattler;
  const monId = g.battleBufferA[ab][1];
  if (g.playerParty[monId]!.level >= K.MAX_LEVEL) return false;
  LoadBattleBarGfx(1);
  const expPointsToGive = (rd16(g.battleBufferA[ab], 2) << 16) >> 16;
  startExpTask(monId, expPointsToGive, ab, onDone, levelUpEffects);
  return true;
}
