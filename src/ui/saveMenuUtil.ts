// save_menu_util.c's SaveStatToString and pokedex.c's GetKantoPokedexCount / GetNationalPokedexCount: what the
// start menu's save info window and the main menu's CONTINUE window show about a save block. Both read either
// the live GameState or a save file that hasn't been loaded (the main menu's), through SaveBlockView.

import { ConvertIntToDecimalStringN, STR_CONV_MODE_LEADING_ZEROS, STR_CONV_MODE_LEFT_ALIGN } from '../battle/stringUtil';
import type { Defines } from '../script/Defines';
import type { SaveData } from '../state/saveData';
import type { PlayTime } from '../state/playTime';
import { EOS, type Charmap } from '../text/charmap';

/** The parts of gSaveBlock1/2 the save stats read. GameState is one. */
export interface SaveBlockView {
  readonly defines: Defines;
  playerName: string;
  playerGender: 'male' | 'female';
  readonly playTime: PlayTime;
  nationalDexEnabled: boolean;
  readonly dexSeen: ReadonlySet<number>;
  readonly dexCaught: ReadonlySet<number>;
  getFlag(flag: number): boolean;
}

/** A save file seen as a save block (what LoadGameSave leaves in gSaveBlock1/2 before CONTINUE loads the game). */
export function saveDataView(data: SaveData, defines: Defines): SaveBlockView {
  const flags = new Set(data.flags);
  return {
    defines,
    playerName: data.playerName,
    playerGender: data.playerGender,
    playTime: data.playTime,
    nationalDexEnabled: data.pokedex.nationalDexEnabled,
    dexSeen: new Set(data.pokedex.seen),
    dexCaught: new Set(data.pokedex.caught),
    getFlag: (flag) => flags.has(flag),
  };
}

/** GetSetPokedexFlag(nationalNum, FLAG_GET_SEEN / FLAG_GET_CAUGHT) */
function getDexFlag(sb: SaveBlockView, nationalNum: number, caseId: number): boolean {
  return caseId === sb.defines.require('FLAG_GET_CAUGHT') ? sb.dexCaught.has(nationalNum) : sb.dexSeen.has(nationalNum);
}

/** GetKantoPokedexCount */
export function GetKantoPokedexCount(sb: SaveBlockView, caseId: number): number {
  let count = 0;
  for (let i = 0; i < sb.defines.require('KANTO_DEX_COUNT'); i++) if (getDexFlag(sb, i + 1, caseId)) count++;
  return count;
}

/** GetNationalPokedexCount */
export function GetNationalPokedexCount(sb: SaveBlockView, caseId: number): number {
  let count = 0;
  for (let i = 0; i < sb.defines.require('NATIONAL_DEX_COUNT'); i++) if (getDexFlag(sb, i + 1, caseId)) count++;
  return count;
}

/** The badges the player has (FLAG_BADGE01_GET .. +8), as SaveStatToString and PrintBadgeCount count them. */
export function countBadges(sb: SaveBlockView): number {
  const first = sb.defines.require('FLAG_BADGE01_GET');
  let n = 0;
  for (let flagId = first; flagId < first + 8; flagId++) if (sb.getFlag(flagId)) n++;
  return n;
}

/** The caught count the save stats show: national when the National Dex is on, else Kanto (IsNationalPokedexEnabled). */
export function caughtDexCount(sb: SaveBlockView): number {
  const caught = sb.defines.require('FLAG_GET_CAUGHT');
  return sb.nationalDexEnabled ? GetNationalPokedexCount(sb, caught) : GetKantoPokedexCount(sb, caught);
}

/**
 * SaveStatToString(gameStatId, dest, color): the stat (SAVE_STAT_*) as an encoded string with EOS, after a
 * {COLOR color}{SHADOW color + 1} prefix. `mapName` is GetMapNameGeneric(gMapHeader.regionMapSectionId), for
 * SAVE_STAT_LOCATION.
 */
export function SaveStatToString(sb: SaveBlockView, charmap: Charmap, gameStatId: number, color: number, mapName: () => number[] = () => [EOS]): number[] {
  const d = sb.defines;
  const begin = d.require('EXT_CTRL_CODE_BEGIN');
  const dest = [begin, d.require('EXT_CTRL_CODE_COLOR'), color, begin, d.require('EXT_CTRL_CODE_SHADOW'), color + 1];
  const t = sb.playTime;
  switch (gameStatId) {
    case d.require('SAVE_STAT_NAME'):
      dest.push(...charmap.encodePlain(sb.playerName));
      break;
    case d.require('SAVE_STAT_POKEDEX'):
      dest.push(...ConvertIntToDecimalStringN(caughtDexCount(sb), STR_CONV_MODE_LEFT_ALIGN, 3));
      break;
    case d.require('SAVE_STAT_TIME'):
      dest.push(...ConvertIntToDecimalStringN(t.hours, STR_CONV_MODE_LEFT_ALIGN, 3), d.require('CHAR_COLON'));
      dest.push(...ConvertIntToDecimalStringN(t.minutes, STR_CONV_MODE_LEADING_ZEROS, 2));
      break;
    case d.require('SAVE_STAT_LOCATION'): {
      const name = mapName();
      dest.push(...name.slice(0, name.indexOf(EOS) < 0 ? name.length : name.indexOf(EOS)));
      break;
    }
    case d.require('SAVE_STAT_BADGES'):
      // nBadges + CHAR_0, then 10 ('こ', the Japanese counter; its Latin glyph is blank)
      dest.push(countBadges(sb) + d.require('CHAR_0'), 10);
      break;
  }
  dest.push(EOS);
  return dest;
}
