// pokemon.c's GetBattleBGM: the battle music CreateBattleStartTask plays when its song is 0 (battle/battleBgm.ts).
// Expected songs from pokemon.c's switch, the classes from the decomp's trainers (gTrainers).

import { beforeAll, expect, test } from 'vitest';
import { GetBattleBGM } from '../../src/battle/battleBgm';
import { K } from '../../src/battle/constants';
import { bdata } from '../../src/battle/env';
import { newBattleEnv } from './gameData';

beforeAll(async () => {
  await newBattleEnv();
});

const classOf = (trainer: string) => bdata.tables.trainers[K[trainer]]!.trainerClass;

test('wild battles play MUS_VS_WILD, whatever else the flags say', () => {
  expect(GetBattleBGM(0, 0)).toBe(K.MUS_VS_WILD);
  expect(GetBattleBGM(K.BATTLE_TYPE_LEGENDARY | K.BATTLE_TYPE_LEGENDARY_FRLG, 0)).toBe(K.MUS_VS_WILD);
  expect(GetBattleBGM(K.BATTLE_TYPE_OLD_MAN_TUTORIAL, 0)).toBe(K.MUS_VS_WILD);
  expect(GetBattleBGM(K.BATTLE_TYPE_KYOGRE_GROUDON | K.BATTLE_TYPE_LEGENDARY, 0)).toBe(K.MUS_VS_WILD);
  expect(GetBattleBGM(K.BATTLE_TYPE_REGI | K.BATTLE_TYPE_LEGENDARY, 0)).toBe(K.MUS_RS_VS_TRAINER);
});

test('trainer battles: gym leaders and the Elite Four, the Champion, everyone else', () => {
  const T = K.BATTLE_TYPE_TRAINER;
  expect(GetBattleBGM(T, classOf('TRAINER_LEADER_BROCK'))).toBe(K.MUS_VS_GYM_LEADER);
  expect(GetBattleBGM(T, classOf('TRAINER_ELITE_FOUR_LORELEI'))).toBe(K.MUS_VS_GYM_LEADER);
  expect(GetBattleBGM(T, classOf('TRAINER_CHAMPION_FIRST_SQUIRTLE'))).toBe(K.MUS_VS_CHAMPION);
  expect(GetBattleBGM(T, classOf('TRAINER_BUG_CATCHER_RICK'))).toBe(K.MUS_VS_TRAINER);
  expect(GetBattleBGM(T, classOf('TRAINER_BOSS_GIOVANNI'))).toBe(K.MUS_VS_TRAINER);
  expect(GetBattleBGM(T, classOf('TRAINER_RIVAL_OAKS_LAB_SQUIRTLE'))).toBe(K.MUS_VS_TRAINER);
  expect(GetBattleBGM(T | K.BATTLE_TYPE_LINK, classOf('TRAINER_LEADER_BROCK'))).toBe(K.MUS_RS_VS_TRAINER);
});
