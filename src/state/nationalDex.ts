// event_data.c's IsNationalPokedexEnabled and pokemon.c's SpeciesToPokedexNum: the one check every National Dex
// branch outside the Pokédex goes through (main_menu.c, save_menu_util.c, trainer_card.c, prof_pc.c, party_menu.c,
// pokemon.c, evolution_scene.c, easy_chat.c, hall_of_fame.c, pokemon_summary_screen.c).

import type { Defines } from '../script/Defines';
import type { GameState } from './GameState';

/** What IsNationalPokedexEnabled reads: GameState, or a save file seen as a save block (ui/saveMenuUtil.ts). */
export interface NationalDexView {
  readonly defines: Defines;
  /** gSaveBlock2Ptr->pokedex.nationalMagic == 0xB9 */
  nationalDexEnabled: boolean;
  getVar(v: number): number;
  getFlag(flag: number): boolean;
}

/** IsNationalPokedexEnabled (event_data.c): the magic, VAR_NATIONAL_DEX and FLAG_SYS_NATIONAL_DEX, all three. */
export function IsNationalPokedexEnabled(sb: NationalDexView): boolean {
  const d = sb.defines;
  return sb.nationalDexEnabled && sb.getVar(d.require('VAR_NATIONAL_DEX')) === 0x6258 && sb.getFlag(d.require('FLAG_SYS_NATIONAL_DEX'));
}

/** SpeciesToPokedexNum (pokemon.c): the national number, or 0xFFFF past Kanto without the National Dex. */
export function SpeciesToPokedexNum(state: GameState, species: number): number {
  const n = state.pokemon.nationalDex(species);
  if (!IsNationalPokedexEnabled(state) && n > state.defines.require('KANTO_SPECIES_END')) return 0xffff;
  return n;
}
