import { beforeEach, describe, expect, test } from 'vitest';
import type { Pokemon } from '../../src/pokemon/Pokemon';
import { boxMonToMon } from '../../src/state/PokemonStorage';
import { newGame, type TestGame } from './gameData';

let t: TestGame;
const species = (name: string) => t.d(`SPECIES_${name}`);
const mon = (name: string, level = 5): Pokemon =>
  t.pokemon.createMon(species(name), level, { otId: 1, otName: 'X', otGender: 'male', metLocation: 'MAPSEC_PALLET_TOWN' });
/** The decomp's text for a box name, encoded ("BOX" + number). */
const boxName = (n: number) => t.charmap.encodePlain(`BOX${n}`);
const fillParty = () => {
  while (t.state.party.length < t.d('PARTY_SIZE')) t.state.party.push(mon('RATTATA'));
};

beforeEach(() => {
  t = newGame();
});

describe('PokemonStorage (ResetPokemonStorageSystem)', () => {
  test('a new game has 14 empty boxes of 30, named BOX1..BOX14, wallpapers 0-3 in turn, box 0 current', () => {
    const st = t.state.storage;
    expect(st.boxes).toHaveLength(14);
    expect(st.boxes.every((b) => b.length === 30 && b.every((m) => m === null))).toBe(true);
    expect(st.getCurrentBox()).toBe(0);
    expect(st.getBoxName(0)).toEqual(boxName(1));
    expect(st.getBoxName(13)).toEqual(boxName(14));
    expect(st.getBoxName(14)).toBeUndefined();
    expect(st.boxWallpapers).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
  });

  test('out-of-range boxes and slots are ignored, as in pokemon_storage_system.c', () => {
    const st = t.state.storage;
    st.setCurrentBox(14);
    expect(st.getCurrentBox()).toBe(0);
    st.setBoxWallpaper(0, t.d('WALLPAPER_COUNT'));
    expect(st.getBoxWallpaper(0)).toBe(0);
    st.setBoxMonAt(0, 30, mon('PIDGEY'));
    expect(st.boxes.flat().every((m) => m === null)).toBe(true);
    expect(st.getBoxMonDataAt(0, 30, 'species')).toBe(0);
    expect(st.getBoxMonDataAt(14, 0, 'species')).toBe(0);
  });

  test('box mons keep only BoxPokemon fields; BoxMonToMon recalculates stats and heals', () => {
    const st = t.state.storage;
    const m = mon('PIDGEY', 10);
    const fullHP = m.hp;
    m.hp = 1;
    m.status = t.d('STATUS1_POISON');
    st.setBoxMonAt(2, 7, m);
    const boxed = st.getBoxedMon(2, 7)!;
    expect(boxed).not.toHaveProperty('hp');
    expect(boxed).not.toHaveProperty('level');
    expect(st.getBoxMonDataAt(2, 7, 'species')).toBe(species('PIDGEY'));
    expect(st.countMonsInBox(2)).toBe(1);
    expect(st.getFirstFreeBoxSpot(2)).toBe(0);
    const back = boxMonToMon(t.pokemon, boxed);
    expect(back).toMatchObject({ level: 10, hp: fullHP, maxHP: fullHP, status: 0, stats: m.stats });
    // SetBoxMonAt copies: changing the original doesn't change the box.
    m.nickname = [0xbb];
    expect(boxed.nickname).toEqual(t.pokemon.speciesName(species('PIDGEY')));
    st.setBoxMonNickAt(2, 7, [0xbb, 0xbc]);
    expect(st.getBoxMonNickAt(2, 7)).toEqual([0xbb, 0xbc]);
    st.zeroBoxMonAt(2, 7);
    expect(st.getBoxedMon(2, 7)).toBeNull();
  });

  test('SeekToNextMonInBox skips empty slots and (unless allowed) eggs, both ways', () => {
    const st = t.state.storage;
    st.setBoxMonAt(0, 3, mon('PIDGEY'));
    st.setBoxMonAt(0, 5, { ...mon('PIDGEY'), isEgg: true });
    st.setBoxMonAt(0, 9, mon('RATTATA'));
    expect(st.seekToNextMonInBox(0, 3, 29, 0)).toBe(9);
    expect(st.seekToNextMonInBox(0, 3, 29, 1)).toBe(5);
    expect(st.seekToNextMonInBox(0, 9, 29, 2)).toBe(3);
    expect(st.seekToNextMonInBox(0, 9, 29, 3)).toBe(5);
    expect(st.seekToNextMonInBox(0, 9, 29, 0)).toBe(-1);
  });
});

describe('GiveMonToPlayer / SendMonToPC (pokemon.c)', () => {
  test('with room in the party, the mon joins it', () => {
    expect(t.state.giveMon(mon('PIDGEY'))).toBe(t.d('MON_GIVEN_TO_PARTY'));
    expect(t.state.party).toHaveLength(1);
  });

  test('with a full party, the mon goes to the first free slot of the current box, PP restored', () => {
    fillParty();
    t.state.storage.setBoxMonAt(0, 0, mon('PIDGEY'));
    const m = mon('PIKACHU');
    m.pp = [0, 0, 0, 0];
    expect(t.state.giveMon(m)).toBe(t.d('MON_GIVEN_TO_PC'));
    expect(t.state.party).toHaveLength(6);
    const boxed = t.state.storage.getBoxedMon(0, 1)!;
    expect(boxed.species).toBe(species('PIKACHU'));
    expect(boxed.otId).toBe(t.state.trainerId); // GiveMonToPlayer sets the OT
    expect(boxed.pp.filter((_, i) => boxed.moves[i])).toEqual(boxed.moves.filter((mv) => mv).map((mv) => t.pokemon.moves[mv].pp));
    expect(t.state.getVar('VAR_MON_BOX_ID')).toBe(0);
    expect(t.state.getVar('VAR_MON_BOX_POS')).toBe(1);
    expect(t.state.getVar('VAR_PC_BOX_TO_SEND_MON')).toBe(0);
  });

  test('when the current box is full it searches on, wrapping round, and the box-full message shows once', () => {
    fillParty();
    const st = t.state.storage;
    st.setCurrentBox(13);
    for (let i = 0; i < 30; i++) st.setBoxMonAt(13, i, mon('PIDGEY'));
    t.state.setVar('VAR_PC_BOX_TO_SEND_MON', 13);
    expect(t.state.giveMon(mon('PIKACHU'))).toBe(t.d('MON_GIVEN_TO_PC'));
    expect(st.getBoxMonDataAt(0, 0, 'species')).toBe(species('PIKACHU'));
    expect(t.state.getVar('VAR_PC_BOX_TO_SEND_MON')).toBe(0);
    expect(t.state.getPCBoxToSendMon()).toBe(13); // where the search started
    // Cmd_givecaughtmon / EventScript_TransferredToPC: "BOX 14 was full", once.
    expect(t.state.shouldShowBoxWasFullMessage()).toBe(true);
    expect(t.state.giveMon(mon('PIKACHU'))).toBe(t.d('MON_GIVEN_TO_PC'));
    expect(t.state.shouldShowBoxWasFullMessage()).toBe(false);
  });

  test('IsDestinationBoxFull points VAR_PC_BOX_TO_SEND_MON at a box with room without storing anything', () => {
    const st = t.state.storage;
    for (let i = 0; i < 30; i++) st.setBoxMonAt(0, i, mon('PIDGEY'));
    expect(t.state.isDestinationBoxFull()).toBe(true);
    expect(t.state.getVar('VAR_PC_BOX_TO_SEND_MON')).toBe(1);
    expect(st.countMonsInBox(1)).toBe(0);
    expect(t.state.isDestinationBoxFull()).toBe(false); // already shown
  });

  test('with every box full, the mon can\'t be given', () => {
    fillParty();
    const st = t.state.storage;
    for (let b = 0; b < 14; b++) for (let i = 0; i < 30; i++) st.setBoxMonAt(b, i, mon('PIDGEY'));
    expect(st.isFull()).toBe(true);
    expect(t.state.isThereRoomInAnyBoxForMorePokemon()).toBe(false);
    expect(t.state.isPlayerPartyAndPokemonStorageFull()).toBe(true);
    expect(t.state.giveMon(mon('PIKACHU'))).toBe(t.d('MON_CANT_GIVE'));
  });
});

describe('party counts (pokemon_storage_system_menu.c)', () => {
  test('CountPartyMons, CountPartyNonEggMons, CountPartyAliveNonEggMonsExcept', () => {
    const s = t.state;
    s.party = [mon('PIDGEY'), { ...mon('PIDGEY'), isEgg: true }, { ...mon('RATTATA'), hp: 0 }, mon('PIKACHU')];
    expect(s.countPartyMons()).toBe(4);
    expect(s.countPartyNonEggMons()).toBe(3);
    expect(s.countPartyAliveNonEggMonsExcept(99)).toBe(2);
    expect(s.countPartyAliveNonEggMonsExcept(0)).toBe(1);
    s.setVar('VAR_0x8004', 3);
    expect(s.countPartyAliveNonEggMonsIgnoreVar0x8004Slot()).toBe(1);
  });
});
