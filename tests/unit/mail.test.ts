// mail_data.c (src/world/mail.ts): the mail slots, giving and taking a mon's mail, the mail species; the save;
// player_pc.c's mailbox data (CountPCMail, PCMailCompaction, SELECTED_MAIL).

import { describe, expect, it } from 'vitest';
import { fromSaveData, toSaveData } from '../../src/state/saveData';
import { GameState } from '../../src/state/GameState';
import {
  ClearMailData,
  CountPCMail,
  gPlayerPcMenuManager,
  PCMailCompaction,
  selectedPcMail,
  GiveMailToMon,
  GiveMailToMon2,
  MailSpeciesToSpecies,
  MonHasMail,
  SpeciesToMailSpecies,
  TakeMailFromMon,
  TakeMailFromMon2,
  UNOWN_OFFSET,
} from '../../src/world/mail';
import { newGame } from './gameData';

function setup() {
  const game = newGame();
  const { state, d } = game;
  state.playerName = 'RED';
  state.trainerId = 0x12345678;
  const mon = game.pokemon.createMon(d('SPECIES_PIKACHU'), 10, { otId: state.trainerId, otName: 'RED', otGender: 'male', metLocation: 'MAPSEC_PALLET_TOWN' });
  state.party = [mon];
  return { ...game, mon };
}

describe('mail data (mail_data.c)', () => {
  it('ClearMailData: MAIL_COUNT blank slots (InitEasyChatPhrases leaves the words EC_WORD_UNDEFINED)', () => {
    const { state, d } = newGame();
    expect(state.mail).toHaveLength(d('MAIL_COUNT'));
    expect(d('MAIL_COUNT')).toBe(16);
    for (const m of state.mail) {
      expect(m.words).toEqual(new Array(9).fill(0xffff));
      expect(m.playerName).toEqual(new Array(8).fill(0xff));
      expect(m.trainerId).toEqual([0, 0, 0, 0]);
      expect(m.species).toBe(d('SPECIES_BULBASAUR'));
      expect(m.itemId).toBe(d('ITEM_NONE'));
    }
  });

  it('GiveMailToMon: the first free party slot, the name padded to 6 chars, the trainer id bytes, the species', () => {
    const { state, d, mon, charmap, defines } = setup();
    expect(MonHasMail(defines, mon)).toBe(false);
    state.mail[0].itemId = d('ITEM_ORANGE_MAIL'); // slot 0 taken
    const id = GiveMailToMon(state, mon, d('ITEM_RETRO_MAIL'));
    expect(id).toBe(1);
    expect(mon.mail).toBe(1);
    expect(mon.heldItem).toBe(d('ITEM_RETRO_MAIL'));
    expect(MonHasMail(defines, mon)).toBe(true);
    const mail = state.mail[1];
    // "RED" + 3 spaces (CHAR_SPACE = 0) + EOS, the last byte as it was
    expect(mail.playerName).toEqual([...charmap.encodePlain('RED'), 0, 0, 0, 0xff, 0xff]);
    expect(mail.trainerId).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect(mail.species).toBe(d('SPECIES_PIKACHU'));
    expect(mail.itemId).toBe(d('ITEM_RETRO_MAIL'));
    expect(mail.words).toEqual(new Array(9).fill(0xffff));
  });

  it('GiveMailToMon: 0xFF when every party slot is taken', () => {
    const { state, d, mon } = setup();
    for (let i = 0; i < 6; i++) state.mail[i].itemId = d('ITEM_ORANGE_MAIL');
    expect(GiveMailToMon(state, mon, d('ITEM_RETRO_MAIL'))).toBe(0xff);
    expect(mon.mail).toBeUndefined();
    expect(mon.heldItem).toBe(d('ITEM_NONE'));
  });

  it('TakeMailFromMon frees the slot; TakeMailFromMon2 moves the mail into the PC mailbox', () => {
    const { state, d, mon, defines } = setup();
    GiveMailToMon(state, mon, d('ITEM_RETRO_MAIL'));
    state.mail[0].words[0] = 42;
    TakeMailFromMon(state, mon);
    expect(state.mail[0].itemId).toBe(d('ITEM_NONE'));
    expect(mon.mail).toBeUndefined();
    expect(mon.heldItem).toBe(d('ITEM_NONE'));

    GiveMailToMon(state, mon, d('ITEM_RETRO_MAIL'));
    state.mail[0].words[0] = 42;
    state.mail[6].itemId = d('ITEM_WOOD_MAIL'); // first PC slot taken
    expect(TakeMailFromMon2(state, mon)).toBe(7);
    expect(state.mail[7].words[0]).toBe(42);
    expect(state.mail[7].itemId).toBe(d('ITEM_RETRO_MAIL'));
    expect(state.mail[0].itemId).toBe(d('ITEM_NONE'));
    expect(mon.heldItem).toBe(d('ITEM_NONE'));
    expect(MonHasMail(defines, mon)).toBe(false);

    // GiveMailToMon2: the mailbox's mail back onto a mon
    expect(GiveMailToMon2(state, mon, state.mail[7])).toBe(0);
    expect(state.mail[0].words[0]).toBe(42);
    expect(mon.heldItem).toBe(d('ITEM_RETRO_MAIL'));
  });

  it('TakeMailFromMon2: 0xFF with the mailbox full', () => {
    const { state, d, mon } = setup();
    GiveMailToMon(state, mon, d('ITEM_RETRO_MAIL'));
    for (let i = 6; i < 16; i++) state.mail[i].itemId = d('ITEM_ORANGE_MAIL');
    expect(TakeMailFromMon2(state, mon)).toBe(0xff);
    expect(mon.mail).toBe(0);
  });

  it('SpeciesToMailSpecies / MailSpeciesToSpecies: Unown by letter', () => {
    const { d, defines } = newGame();
    expect(SpeciesToMailSpecies(defines, d('SPECIES_PIKACHU'), 1234)).toBe(d('SPECIES_PIKACHU'));
    // personality 0x00000001: letter B (1)
    expect(SpeciesToMailSpecies(defines, d('SPECIES_UNOWN'), 1)).toBe(UNOWN_OFFSET + 1);
    expect(MailSpeciesToSpecies(defines, UNOWN_OFFSET + 27)).toEqual({ species: d('SPECIES_UNOWN'), unownLetter: 27 });
    expect(MailSpeciesToSpecies(defines, UNOWN_OFFSET + 28)).toEqual({ species: UNOWN_OFFSET + 28 });
    expect(MailSpeciesToSpecies(defines, d('SPECIES_MEW'))).toEqual({ species: d('SPECIES_MEW') });
  });

  it('a held mail survives the save (the slots and the mon\'s mail id)', () => {
    const { state, d, mon, defines, pokemon } = setup();
    GiveMailToMon(state, mon, d('ITEM_RETRO_MAIL'));
    state.mail[0].words.splice(0, 3, 1, 2, 3);
    const data = JSON.parse(JSON.stringify(toSaveData(state)));
    const fresh = new GameState(defines, [], pokemon, {});
    fromSaveData(data, fresh);
    expect(fresh.party[0].mail).toBe(0);
    expect(fresh.mail).toEqual(state.mail);
    expect(MonHasMail(defines, fresh.party[0])).toBe(true);
  });

  it('a version-9 save loads with the new-game mail slots', () => {
    const { state, defines, pokemon } = setup();
    const data = JSON.parse(JSON.stringify(toSaveData(state)));
    data.version = 9;
    delete data.mail;
    const fresh = new GameState(defines, [], pokemon, {});
    fromSaveData(data, fresh);
    expect(fresh.mail).toHaveLength(16);
    ClearMailData(state);
    expect(fresh.mail).toEqual(state.mail);
  });
});

describe("the player's PC mailbox data (player_pc.c)", () => {
  /** PC slot `i` (6 + i) holding `item` with words [i]. */
  const putPcMail = (state: GameState, i: number, item: number) => Object.assign(state.mail[6 + i], { itemId: item, words: [i, ...new Array(8).fill(0xffff)] });

  it('CountPCMail counts the PC slots 6-15 only; PCMailCompaction moves them to the front in order', () => {
    const { state, d } = setup();
    expect(CountPCMail(state)).toBe(0);
    GiveMailToMon(state, state.party[0], d('ITEM_RETRO_MAIL')); // a party slot: not the mailbox's
    putPcMail(state, 2, d('ITEM_BEAD_MAIL'));
    putPcMail(state, 5, d('ITEM_WOOD_MAIL'));
    putPcMail(state, 9, d('ITEM_DREAM_MAIL'));
    expect(CountPCMail(state)).toBe(3);
    PCMailCompaction(state);
    expect(state.mail.slice(6).map((m) => m.itemId)).toEqual([d('ITEM_BEAD_MAIL'), d('ITEM_WOOD_MAIL'), d('ITEM_DREAM_MAIL'), 0, 0, 0, 0, 0, 0, 0]);
    expect(state.mail.slice(6, 9).map((m) => m.words[0])).toEqual([2, 5, 9]);
    expect(state.mail[0].itemId).toBe(d('ITEM_RETRO_MAIL'));
  });

  it('SELECTED_MAIL: PC slot cursorPos (the scroll) + itemsAbove (the row)', () => {
    const { state, d } = setup();
    for (let i = 0; i < 10; i++) putPcMail(state, i, d('ITEM_ORANGE_MAIL'));
    Object.assign(gPlayerPcMenuManager, { cursorPos: 2, itemsAbove: 5 });
    expect(selectedPcMail(state)).toBe(state.mail[6 + 7]);
    Object.assign(gPlayerPcMenuManager, { cursorPos: 0, itemsAbove: 0 });
  });

  it('a version-11 save frees the party mail slots no party mon points at (a daycare mon lost its slot before 12)', () => {
    const { state, d, mon, defines, pokemon } = setup();
    GiveMailToMon(state, mon, d('ITEM_RETRO_MAIL')); // slot 0, held
    state.mail[1].itemId = d('ITEM_WOOD_MAIL'); // slot 1: leaked
    putPcMail(state, 0, d('ITEM_BEAD_MAIL')); // a PC slot stays
    const data = JSON.parse(JSON.stringify(toSaveData(state)));
    data.version = 11;
    const fresh = new GameState(defines, [], pokemon, {});
    fromSaveData(data, fresh);
    expect(fresh.mail.map((m) => m.itemId).slice(0, 7)).toEqual([d('ITEM_RETRO_MAIL'), 0, 0, 0, 0, 0, d('ITEM_BEAD_MAIL')]);
    expect(fresh.mail[1].words).toEqual(state.mail[1].words);
  });
});
