// In-game trades (trade_scene.c's in-game path; the scene itself is menus/tradeScene.ts) and the Name Rater
// (field_specials.c).
// The trade data is sInGameTrades and sInGameTradeMailMessages (src/data/ingame_trades.h) through
// tools/extract_trades.py (public/gen/trades.json), set once at boot with initInGameTrades. No Phaser here: SPECIALS spreads TRADE_SPECIALS in.

import { loadGfx } from '../gba/gfx';
import { SetMainCallback2 } from '../gba/main';
import { CB2_InitInGameTrade, tradeSceneGfxSymbols } from '../menus/tradeScene';
import { FLAG_SET_CAUGHT, FLAG_SET_SEEN, GetSetPokedexFlag, HandleSetPokedexFlag } from '../menus/pokedex';
import type { Pokemon } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import type { Special } from './specials';
import { HelpSystem_Disable } from '../ui/helpSystemContext';
import { ClearMailStruct, GetMonMailId, GiveMailToMon2, newMail, type Mail } from '../world/mail';

/** struct InGameTrade (trade_scene.c), as trades.json has it. Names are raw decomp strings ending in `$`. */
export interface InGameTrade {
  nickname: string;
  species: number;
  /** HP, Atk, Def, Speed, SpAtk, SpDef */
  ivs: number[];
  abilityNum: number;
  otId: number;
  /** cool, beauty, cute, smart, tough */
  conditions: number[];
  personality: number;
  heldItem: number;
  mailNum: number;
  otName: string;
  /** MALE / FEMALE */
  otGender: number;
  sheen: number;
  requestedSpecies: number;
}

export interface TradesData {
  ingameTrades: InGameTrade[];
  /** sInGameTradeMailMessages: by mailNum, the easy chat words */
  mailMessages: number[][];
}

/** sInGameTrades, set once at boot (Assets.init → OverworldScene). */
let sInGameTrades: InGameTrade[] = [];
/** sInGameTradeMailMessages */
let sInGameTradeMailMessages: number[][] = [];

/** gLinkPartnerMail (trade.c): the trade partner's mails; an in-game trade's mon brings its mail in slot 0. */
export const gLinkPartnerMail: Mail[] = [];

export function initInGameTrades(data: TradesData): void {
  sInGameTrades = data.ingameTrades;
  sInGameTradeMailMessages = data.mailMessages ?? [];
}

/** Friendship of a mon received in a trade (TradeMons). */
const TRADE_FRIENDSHIP = 70;

export function inGameTrade(idx: number): InGameTrade {
  const trade = sInGameTrades[idx];
  if (!trade) throw new Error(`[trade] no in-game trade ${idx} (trades.json not loaded?)`);
  return trade;
}

/**
 * GetInGameTradeSpeciesInfo: gStringVar1 = the requested species' name, gStringVar2 = the offered species' name;
 * returns the requested species. The trade is VAR_0x8004.
 */
export function GetInGameTradeSpeciesInfo(state: GameState): number {
  const trade = inGameTrade(state.getVar('VAR_0x8004'));
  state.stringVars[0] = [...state.pokemon.speciesName(trade.requestedSpecies)];
  state.stringVars[1] = [...state.pokemon.speciesName(trade.species)];
  return trade.requestedSpecies;
}

/**
 * BufferInGameTradeMonName: gStringVar1 = the nickname of party slot VAR_0x8005 (after TradeMons, the mon just
 * received), gStringVar2 = the offered species' name.
 */
export function BufferInGameTradeMonName(state: GameState): void {
  const trade = inGameTrade(state.getVar('VAR_0x8004'));
  state.stringVars[0] = [...(state.party[state.getVar('VAR_0x8005')]?.nickname ?? [])]; // StringCopy_Nickname
  state.stringVars[1] = [...state.pokemon.speciesName(trade.species)];
}

/** GetTradeSpecies: the species of party slot VAR_0x8005, SPECIES_NONE for an egg. */
export function GetTradeSpecies(state: GameState): number {
  const mon = state.party[state.getVar('VAR_0x8005')];
  if (!mon || mon.isEgg) return state.defines.require('SPECIES_NONE');
  return mon.species;
}

/**
 * CreateInGameTradePokemonInternal: the trade's mon into gEnemyParty[0] at the level of the player's mon in
 * `playerSlot`, with the trade's fixed personality, OT id, IVs, nickname, OT name and gender, ability and held
 * item, met in a trade (METLOC_IN_GAME_TRADE). CreateMon still rolls random IVs before they're overwritten, as
 * on the GBA. A mail item comes with its message (GetInGameTradeMail into gLinkPartnerMail[0], the mon's mail id
 * 0: TradeMons gives it a slot). Not modelled: the contest conditions and sheen (Pokémon have no such fields).
 */
export function CreateInGameTradePokemonInternal(state: GameState, playerSlot: number, inGameTradeIdx: number): Pokemon {
  const trade = inGameTrade(inGameTradeIdx);
  const data = state.pokemon;
  const d = state.defines;
  const level = state.party[playerSlot].level;
  const mon = data.createMon(trade.species, level, {
    personality: trade.personality >>> 0,
    otId: trade.otId >>> 0,
    // CreateBoxMon copies the player's name and gender; SetMonData overwrites them just below
    otName: state.playerName,
    otGender: state.playerGender,
    metLocation: 'METLOC_IN_GAME_TRADE',
  });
  const [hp, attack, defense, speed, spAttack, spDefense] = trade.ivs;
  mon.ivs = { hp, attack, defense, speed, spAttack, spDefense };
  mon.nickname = data.encodeName(trade.nickname);
  mon.otName = trade.otName.replace(/\$$/, '');
  mon.otGender = trade.otGender === d.require('FEMALE') ? 'female' : 'male';
  mon.abilityNum = trade.abilityNum;
  // SetMonData(MON_DATA_BEAUTY / CUTE / COOL / SMART / TOUGH / SHEEN): contest stats aren't modelled
  const mailNum = 0;
  if (trade.heldItem !== d.require('ITEM_NONE')) {
    if (isMailItem(state, trade.heldItem)) {
      gLinkPartnerMail[0] = GetInGameTradeMail(state, trade);
      mon.mail = mailNum; // SetMonData(MON_DATA_MAIL)
    }
    mon.heldItem = trade.heldItem;
  }
  data.calculateStats(mon);
  state.enemyParty[0] = mon;
  return mon;
}

/** ItemIsMail */
function isMailItem(state: GameState, itemId: number): boolean {
  return itemId >= state.defines.require('ITEM_ORANGE_MAIL') && itemId <= state.defines.require('ITEM_RETRO_MAIL');
}

/**
 * GetInGameTradeMail: the trade's message (sInGameTradeMailMessages[mailNum]) from its OT (the name, the OT id
 * big-endian, as the C writes it), on the offered species, with the trade's mail item. The name's bytes past its EOS
 * are the C's uninitialised stack: EOS here.
 */
export function GetInGameTradeMail(state: GameState, trade: InGameTrade): Mail {
  const d = state.defines;
  const mail = newMail(d);
  const words = sInGameTradeMailMessages[trade.mailNum] ?? [];
  for (let i = 0; i < d.require('MAIL_WORDS_COUNT'); i++) mail.words[i] = words[i] ?? 0xffff;
  const otName = state.pokemon.encodeName(trade.otName.replace(/\$$/, ''));
  const size = d.require('PLAYER_NAME_LENGTH') + 1;
  mail.playerName = new Array<number>(size).fill(0xff);
  for (let i = 0; i < size && i < otName.length && otName[i] !== 0xff; i++) mail.playerName[i] = otName[i]; // StringCopy
  const otId = trade.otId >>> 0;
  mail.trainerId = [(otId >>> 24) & 0xff, (otId >>> 16) & 0xff, (otId >>> 8) & 0xff, otId & 0xff];
  mail.species = trade.species;
  mail.itemId = trade.heldItem;
  return mail;
}

/**
 * TradeMons(playerPartyIdx, partnerPartyIdx): swaps the player's mon with gEnemyParty[partnerPartyIdx]. The mail the
 * player's mon held is cleared from its slot (it leaves with the mon); the mon received has 70 friendship (unless
 * it's an egg), holds its partner mail in a party mail slot (GiveMailToMon2 from gLinkPartnerMail) and goes in the
 * Pokédex.
 */
export function TradeMons(state: GameState, playerPartyIdx: number, partnerPartyIdx: number): void {
  const d = state.defines;
  const MAIL_NONE = d.require('MAIL_NONE');
  const playerMon = state.party[playerPartyIdx];
  const playerMail = GetMonMailId(d, playerMon);
  const partnerMon = state.enemyParty[partnerPartyIdx];
  const partnerMail = GetMonMailId(d, partnerMon);
  if (playerMail !== MAIL_NONE) ClearMailStruct(d, state.mail[playerMail]);
  state.party[playerPartyIdx] = partnerMon;
  state.enemyParty[partnerPartyIdx] = playerMon;
  if (!partnerMon.isEgg) partnerMon.friendship = TRADE_FRIENDSHIP;
  if (partnerMail !== MAIL_NONE) GiveMailToMon2(state, partnerMon, gLinkPartnerMail[partnerMail]);
  UpdatePokedexForReceivedMon(state, playerPartyIdx);
}

/** UpdatePokedexForReceivedMon: seen and caught (HandleSetPokedexFlag), unless it's an egg. */
export function UpdatePokedexForReceivedMon(state: GameState, partyIdx: number): void {
  const mon = state.party[partyIdx];
  if (mon.isEgg) return;
  const nationalNum = state.pokemon.nationalDex(mon.species);
  GetSetPokedexFlag(state, nationalNum, FLAG_SET_SEEN);
  HandleSetPokedexFlag(state, nationalNum, FLAG_SET_CAUGHT, mon.personality);
}

/** GetPlayerTrainerId vs MON_DATA_OT_ID of party slot VAR_0x8004. */
export function isMonOTIDNotPlayers(state: GameState): boolean {
  return state.party[state.getVar('VAR_0x8004')].otId >>> 0 !== state.trainerId >>> 0;
}

export const TRADE_SPECIALS: Record<string, Special> = {
  // ------------------------------------------------ in-game trades (EventScript_DoInGameTrade etc.)
  GetInGameTradeSpeciesInfo: ({ state }) => GetInGameTradeSpeciesInfo(state),
  GetTradeSpecies: ({ state }) => GetTradeSpecies(state),
  /** CreateInGameTradePokemon: the trade VAR_0x8004 for party slot VAR_0x8005. */
  CreateInGameTradePokemon({ state }) {
    CreateInGameTradePokemonInternal(state, state.getVar('VAR_0x8005'), state.getVar('VAR_0x8004'));
  },
  /**
   * DoInGameTradeScene: the fade to black (BeginNormalPaletteFade), then Task_InGameTrade hands the field over to
   * CB2_InitInGameTrade (menus/tradeScene.ts) once it's over. The scene swaps the mons (STATE_TRY_EVOLUTION:
   * TradeMons(VAR_0x8005, 0)), buffers the names (BufferInGameTradeMonName) and returns through
   * CB2_ReturnToField, where FieldCB_ContinueScriptHandleMusic fades the field in and ends the script's
   * `waitstate`. The scene's graphics (the two mon pics too) load during the fade.
   */
  DoInGameTradeScene({ state, host, setWaitState }) {
    const fadeOut = host.fadeScreen(state.defines.require('FADE_TO_BLACK'));
    HelpSystem_Disable();
    const playerMon = state.party[state.getVar('VAR_0x8005')];
    let loaded = false;
    void loadGfx(tradeSceneGfxSymbols(playerMon, state.enemyParty[0])).then(() => (loaded = true));
    let scene: (() => boolean) | undefined;
    setWaitState(() => {
      if (!scene) {
        // Task_InGameTrade
        if (!fadeOut() || !loaded) return false;
        scene = host.runScreenFromScript(() => SetMainCallback2(CB2_InitInGameTrade));
      }
      return scene();
    });
  },

  // ------------------------------------------------ the Name Rater (LavenderTown_House2)
  /** IsMonOTIDNotPlayers (field_specials.c): a `special`, so it writes VAR_RESULT itself. */
  IsMonOTIDNotPlayers({ state }) {
    state.setVar('VAR_RESULT', isMonOTIDNotPlayers(state) ? 1 : 0);
  },
  /** IsMonOTNameNotPlayers (field_specials.c): gStringVar1 = the OT name of party slot VAR_0x8004. */
  IsMonOTNameNotPlayers({ state }) {
    const mon = state.party[state.getVar('VAR_0x8004')];
    state.stringVars[0] = state.pokemon.encodeName(mon.otName);
    return mon.otName === state.playerName ? 0 : 1;
  },
  /**
   * NameRaterWasNicknameChanged (field_specials.c): gStringVar1 = the nickname of party slot VAR_0x8004; whether
   * it differs from gStringVar3 (ChangePokemonNickname left the old one there).
   */
  NameRaterWasNicknameChanged({ state }) {
    const nickname = [...state.party[state.getVar('VAR_0x8004')].nickname];
    state.stringVars[0] = nickname;
    const old = state.stringVars[2];
    return old.length === nickname.length && old.every((b, i) => b === nickname[i]) ? 0 : 1;
  },
};
