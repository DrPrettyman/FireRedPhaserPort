// mail_data.c: the mail slots (gSaveBlock1Ptr->mail[MAIL_COUNT]: PARTY_SIZE for the party's held mail, then the
// PC mailbox's 10) and a party mon's mail id (MON_DATA_MAIL, `Pokemon.mail`; absent = MAIL_NONE), plus
// pokemon_icon.c's MailSpeciesToIconSpecies. ItemIsMail stays in menus/common.ts (the screens' K-based copy);
// these functions read the constants from the state's defines, so they run in the unit tests too. The mail screen is
// menus/mail.ts; the party menu's mail actions are in menus/partyMenu.ts. No Phaser here.

import type { Pokemon } from '../pokemon/Pokemon';
import type { Defines } from '../script/Defines';
import type { GameState } from '../state/GameState';
import { GetIconSpecies, GetUnownLetterByPersonality } from '../menus/pokemonIcon';

/** UNOWN_OFFSET (mail_data.c): an Unown's mail species is UNOWN_OFFSET + its letter. */
export const UNOWN_OFFSET = 30000;

const EOS = 0xff;
const CHAR_SPACE = 0x00;

/** struct Mail */
export interface Mail {
  /** MAIL_WORDS_COUNT easy chat words (0xFFFF = EC_WORD_UNDEFINED) */
  words: number[];
  /** PLAYER_NAME_LENGTH + 1 encoded bytes: the writer's name, padded with spaces to 6 chars, then EOS */
  playerName: number[];
  /** TRAINER_ID_LENGTH bytes, gSaveBlock2Ptr->playerTrainerId (little-endian) */
  trainerId: number[];
  /** SpeciesToMailSpecies of the mon it was first given to */
  species: number;
  /** ITEM_NONE for an empty slot */
  itemId: number;
}

/**
 * gPlayerPcMenuManager (player_pc.c's struct PlayerPCItemPageStruct, EWRAM): `notInRoom` is set by the player's PC
 * and read by ReadMail's help context; the mailbox keeps its list here: `cursorPos` (the list's scroll offset) and
 * `itemsAbove` (the cursor's row) as ListMenuGetScrollAndRow leaves them (the selected mail is PC slot
 * cursorPos + itemsAbove: SELECTED_MAIL, and party_menu.c's TryGiveMailToSelectedMon), `count` the mails in the
 * PC (CountPCMail) and `pageItems` the rows shown (Task_SetPageItemVars).
 */
export const gPlayerPcMenuManager = { itemsAbove: 0, cursorPos: 0, pageItems: 0, count: 0, notInRoom: false };

function isMailItem(d: Defines, itemId: number): boolean {
  return itemId >= d.require('ITEM_ORANGE_MAIL') && itemId <= d.require('ITEM_RETRO_MAIL');
}

/** A new, cleared struct Mail. */
export function newMail(d: Defines): Mail {
  const mail: Mail = { words: [], playerName: [], trainerId: [], species: 0, itemId: 0 };
  ClearMailStruct(d, mail);
  return mail;
}

/** ClearMailData (new_game.c's NewGameInitData): every slot cleared. */
export function ClearMailData(state: Pick<GameState, 'defines' | 'mail'>): void {
  const d = state.defines;
  state.mail = Array.from({ length: d.require('MAIL_COUNT') }, () => newMail(d));
}

/** ClearMailStruct */
export function ClearMailStruct(d: Defines, mail: Mail): void {
  mail.words = new Array<number>(d.require('MAIL_WORDS_COUNT')).fill(0xffff);
  mail.playerName = new Array<number>(d.require('PLAYER_NAME_LENGTH') + 1).fill(EOS);
  mail.trainerId = new Array<number>(d.require('TRAINER_ID_LENGTH')).fill(0);
  mail.species = d.require('SPECIES_BULBASAUR');
  mail.itemId = d.require('ITEM_NONE');
}

/** GetMonData(mon, MON_DATA_MAIL) */
export function GetMonMailId(d: Defines, mon: Pokemon): number {
  return mon.mail ?? d.require('MAIL_NONE');
}

/** MonHasMail: holding a mail item with a mail slot. */
export function MonHasMail(d: Defines, mon: Pokemon): boolean {
  return isMailItem(d, mon.heldItem) && GetMonMailId(d, mon) !== d.require('MAIL_NONE');
}

/**
 * GiveMailToMon: the first free party mail slot (0..PARTY_SIZE-1) gets a blank message from the player, the mon's
 * mail species and the item; the mon holds the item with that mail id. 0xFF (and nothing changes) if none is free.
 */
export function GiveMailToMon(state: GameState, mon: Pokemon, itemId: number): number {
  const d = state.defines;
  const nameLength = d.require('PLAYER_NAME_LENGTH');
  const playerName = state.pokemon.encodeName(state.playerName);
  for (let id = 0; id < d.require('PARTY_SIZE'); id++) {
    const mail = state.mail[id];
    if (mail.itemId !== 0) continue;
    mail.words.fill(0xffff);
    let i = 0;
    for (; i < nameLength && i < playerName.length && playerName[i] !== EOS; i++) mail.playerName[i] = playerName[i];
    for (; i <= 5; i++) mail.playerName[i] = CHAR_SPACE;
    mail.playerName[i] = EOS;
    const tid = state.trainerId >>> 0;
    for (let b = 0; b < d.require('TRAINER_ID_LENGTH'); b++) mail.trainerId[b] = (tid >>> (8 * b)) & 0xff;
    mail.species = SpeciesToMailSpecies(d, mon.species, mon.personality);
    mail.itemId = itemId;
    mon.mail = id;
    mon.heldItem = itemId;
    return id;
  }
  return 0xff;
}

/** SpeciesToMailSpecies: Unown as UNOWN_OFFSET + its letter, other species as they are. */
export function SpeciesToMailSpecies(d: Defines, species: number, personality: number): number {
  if (species === d.require('SPECIES_UNOWN')) return GetUnownLetterByPersonality(personality) + UNOWN_OFFSET;
  return species;
}

/** MailSpeciesToSpecies: the species, and the Unown letter for an Unown's mail species (`unownLetter` is left alone otherwise). */
export function MailSpeciesToSpecies(d: Defines, mailSpecies: number): { species: number; unownLetter?: number } {
  if (mailSpecies >= UNOWN_OFFSET && mailSpecies < UNOWN_OFFSET + d.require('NUM_UNOWN_FORMS')) {
    return { species: d.require('SPECIES_UNOWN'), unownLetter: mailSpecies - UNOWN_OFFSET };
  }
  return { species: mailSpecies };
}

/** MailSpeciesToIconSpecies (pokemon_icon.c): a mail species to its icon species (Unown by letter; past the old Unown letters SPECIES_NONE's). */
export function MailSpeciesToIconSpecies(d: Defines, species: number): number {
  const r = MailSpeciesToSpecies(d, species);
  const unownB = d.require('SPECIES_UNOWN_B');
  if (r.species === d.require('SPECIES_UNOWN')) {
    const letter = r.unownLetter ?? 0; // the C's `value` is uninitialised for a plain SPECIES_UNOWN (no caller passes one)
    return letter === 0 ? d.require('SPECIES_UNOWN') : letter + (unownB - 1);
  }
  if (species > unownB - 1) species = d.require('SPECIES_NONE');
  return GetIconSpecies(species, 0);
}

/** GiveMailToMon2: a copy of `mail` into a new party mail slot for `mon` (the mailbox's GIVE, the daycare). 0xFF if none is free. */
export function GiveMailToMon2(state: GameState, mon: Pokemon, mail: Mail): number {
  const itemId = mail.itemId;
  const mailId = GiveMailToMon(state, mon, itemId);
  if (mailId === 0xff) return 0xff;
  state.mail[mailId] = structuredClone(mail);
  mon.mail = mailId;
  mon.heldItem = itemId;
  return mailId;
}

/** TakeMailFromMon: the mail slot freed, the mon holds nothing (the message is lost). */
export function TakeMailFromMon(state: GameState, mon: Pokemon): void {
  const d = state.defines;
  if (!MonHasMail(d, mon)) return;
  state.mail[GetMonMailId(d, mon)].itemId = d.require('ITEM_NONE');
  delete mon.mail; // MAIL_NONE
  mon.heldItem = d.require('ITEM_NONE');
}

/** ClearMailItemId */
export function ClearMailItemId(state: GameState, mailId: number): void {
  state.mail[mailId].itemId = state.defines.require('ITEM_NONE');
}

/**
 * TakeMailFromMon2: the mon's mail moved into the first free PC mailbox slot (PARTY_SIZE..MAIL_COUNT-1), which is
 * returned; the mon holds nothing. 0xFF (and nothing changes) if the mailbox is full.
 */
export function TakeMailFromMon2(state: GameState, mon: Pokemon): number {
  const d = state.defines;
  const none = d.require('ITEM_NONE');
  for (let i = d.require('PARTY_SIZE'); i < d.require('MAIL_COUNT'); i++) {
    if (state.mail[i].itemId !== none) continue;
    const from = GetMonMailId(d, mon);
    // (the C copies mail[MAIL_NONE], past the array, for a mon whose mail item has no slot: a blank one here)
    state.mail[i] = structuredClone(state.mail[from] ?? { ...newMail(d), itemId: mon.heldItem });
    if (state.mail[from]) state.mail[from].itemId = none;
    delete mon.mail; // MAIL_NONE
    mon.heldItem = none;
    return i;
  }
  return 0xff;
}

// ------------------------------------------------------------------ player_pc.c's mailbox data

/** PC_MAIL_NUM(i): the mail slot of the mailbox's i-th mail (after the party's PARTY_SIZE). */
export function PC_MAIL_NUM(d: Defines, i: number): number {
  return d.require('PARTY_SIZE') + i;
}

/** CountPCMail (player_pc.c): the mailbox's slots holding a mail. */
export function CountPCMail(state: Pick<GameState, 'defines' | 'mail'>): number {
  const d = state.defines;
  let count = 0;
  for (let i = PC_MAIL_NUM(d, 0); i < d.require('MAIL_COUNT'); i++) if (state.mail[i].itemId !== d.require('ITEM_NONE')) count++;
  return count & 0xff;
}

/** PCMailCompaction (player_pc.c): the mailbox's mails moved to its first slots, in order (the C's swap loop). */
export function PCMailCompaction(state: Pick<GameState, 'defines' | 'mail'>): void {
  const d = state.defines;
  const count = d.require('MAIL_COUNT');
  for (let i = PC_MAIL_NUM(d, 0); i < count - 1; i++) {
    for (let j = i + 1; j < count; j++) {
      if (state.mail[i].itemId === d.require('ITEM_NONE')) {
        const mail = state.mail[i];
        state.mail[i] = state.mail[j];
        state.mail[j] = mail;
      }
    }
  }
}

/** SELECTED_MAIL (player_pc.c): the mailbox's mail under the list's cursor. */
export function selectedPcMail(state: Pick<GameState, 'defines' | 'mail'>): Mail {
  return state.mail[PC_MAIL_NUM(state.defines, gPlayerPcMenuManager.cursorPos) + gPlayerPcMenuManager.itemsAbove];
}
