import { beforeEach, describe, expect, test } from 'vitest';
import type { Pokemon } from '../../src/pokemon/Pokemon';
import type { SpecialEnv } from '../../src/script/specials';
import { SPECIALS } from '../../src/script/specials';
import { BufferInGameTradeMonName, initInGameTrades, TradeMons, type TradesData } from '../../src/script/tradeSpecials';
import { newGame, readGen, type TestGame } from './gameData';

let t: TestGame;
const species = (name: string) => t.d(`SPECIES_${name}`);
const ownMon = (name: string, level: number): Pokemon =>
  t.pokemon.createMon(species(name), level, { otId: t.state.trainerId, otName: t.state.playerName, otGender: 'male', metLocation: 'MAPSEC_PALLET_TOWN' });
const name = (s: string) => t.charmap.encodePlain(s);

/** A SpecialEnv whose fades end after `fadeTicks` polls; `waits` collects what the special asked the script to wait on. */
function env(fadeTicks = 3) {
  const waits: (() => boolean)[] = [];
  const fades: number[] = [];
  let hidden = 0;
  const e = {
    state: t.state,
    host: {
      fadeScreen(mode: number) {
        fades.push(mode);
        let n = fadeTicks;
        return () => --n <= 0;
      },
    },
    setWaitState: (w: () => boolean) => waits.push(w),
    hideFieldMessageBox: () => hidden++,
  } as unknown as SpecialEnv;
  return { e, waits, fades, hidden: () => hidden };
}
const run = (special: string, e: SpecialEnv) => SPECIALS[special](e);

beforeEach(() => {
  t = newGame();
  initInGameTrades(readGen<TradesData>('trades.json'));
});

describe('sInGameTrades (trades.json)', () => {
  test('all nine FireRed trades, Mr. Mime first, with the FireRed side of the #if blocks', () => {
    const { ingameTrades } = readGen<TradesData>('trades.json');
    expect(ingameTrades).toHaveLength(9);
    const mime = ingameTrades[t.d('INGAME_TRADE_MR_MIME')];
    expect(mime).toEqual({
      nickname: 'MIMIEN$', species: species('MR_MIME'), ivs: [20, 15, 17, 24, 23, 22], abilityNum: 0, otId: 1985,
      conditions: [5, 5, 5, 30, 5], personality: 0x9cae, heldItem: t.d('ITEM_NONE'), mailNum: 255, otName: 'REYLEY$',
      otGender: t.d('MALE'), sheen: 10, requestedSpecies: species('ABRA'),
    });
    const nido = ingameTrades[t.d('INGAME_TRADE_NIDORAN')];
    expect([nido.nickname, nido.species, nido.requestedSpecies]).toEqual(['MS. NIDO$', species('NIDORAN_F'), species('NIDORAN_M')]);
    expect(ingameTrades[t.d('INGAME_TRADE_NIDORINOA')].species).toBe(species('NIDORINA'));
  });
});

describe('in-game trade specials (trade_scene.c)', () => {
  beforeEach(() => {
    t.state.party.push(ownMon('PIDGEY', 9), ownMon('ABRA', 12));
    t.state.setVar('VAR_0x8004', t.d('INGAME_TRADE_MR_MIME'));
  });

  test('GetInGameTradeSpeciesInfo: requested species returned, names in STR_VAR_1 / STR_VAR_2', () => {
    expect(run('GetInGameTradeSpeciesInfo', env().e)).toBe(species('ABRA'));
    expect(t.state.stringVars[0]).toEqual(name('ABRA'));
    expect(t.state.stringVars[1]).toEqual(name('MR. MIME'));
  });

  test('GetTradeSpecies: the species of slot VAR_0x8005, SPECIES_NONE for an egg', () => {
    t.state.setVar('VAR_0x8005', 1);
    expect(run('GetTradeSpecies', env().e)).toBe(species('ABRA'));
    t.state.party[1].isEgg = true;
    expect(run('GetTradeSpecies', env().e)).toBe(t.d('SPECIES_NONE'));
  });

  test("CreateInGameTradePokemon: REYLEY's Mr. Mime at the level of the mon offered", () => {
    t.state.setVar('VAR_0x8005', 1);
    run('CreateInGameTradePokemon', env().e);
    const mon = t.state.enemyParty[0];
    expect(mon.species).toBe(species('MR_MIME'));
    expect(mon.level).toBe(12);
    expect(mon.personality).toBe(0x9cae);
    expect(mon.otId).toBe(1985);
    expect(mon.otName).toBe('REYLEY');
    expect(mon.otGender).toBe('male');
    expect(mon.nickname).toEqual(name('MIMIEN'));
    expect(mon.ivs).toEqual({ hp: 20, attack: 15, defense: 17, speed: 24, spAttack: 23, spDefense: 22 });
    expect(mon.abilityNum).toBe(0);
    expect(mon.heldItem).toBe(t.d('ITEM_NONE'));
    expect(mon.metLocation).toBe('METLOC_IN_GAME_TRADE');
    expect(mon.metLevel).toBe(12);
    // Mr. Mime: base HP 40, Atk 45, Speed 90; 0x9cae % 25 = 10 = Timid (+Speed, -Atk); no EVs.
    // HP = (2*40 + 20) * 12 / 100 + 12 + 10; Atk = ((2*45 + 15) * 12 / 100 + 5) * 90 / 100; Speed = ((2*90 + 24) * 12 / 100 + 5) * 110 / 100
    expect(mon.maxHP).toBe(34);
    expect(mon.stats.attack).toBe(15);
    expect(mon.stats.speed).toBe(31);
    expect(t.state.party[1].species).toBe(species('ABRA')); // nothing traded yet
  });

  test('held items, a female OT and abilityNum 1 come from the table', () => {
    t.state.setVar('VAR_0x8005', 0);
    t.state.setVar('VAR_0x8004', t.d('INGAME_TRADE_NIDORAN'));
    run('CreateInGameTradePokemon', env().e);
    expect(t.state.enemyParty[0].heldItem).toBe(t.d('ITEM_TINY_MUSHROOM'));
    expect(t.state.enemyParty[0].otGender).toBe('female');
    t.state.setVar('VAR_0x8004', t.d('INGAME_TRADE_JYNX'));
    run('CreateInGameTradePokemon', env().e);
    expect(t.state.enemyParty[0].heldItem).toBe(t.d('ITEM_FAB_MAIL')); // the mail's message isn't modelled
    t.state.setVar('VAR_0x8004', t.d('INGAME_TRADE_ELECTRODE'));
    run('CreateInGameTradePokemon', env().e);
    expect(t.state.enemyParty[0].abilityNum).toBe(1);
  });

  test('TradeMons + BufferInGameTradeMonName (the trade scene\'s end): the mons swap (friendship 70, Pokédex), names buffered', () => {
    t.state.setVar('VAR_0x8005', 1);
    run('CreateInGameTradePokemon', env().e);
    const abra = t.state.party[1];
    TradeMons(t.state, 1, 0);
    BufferInGameTradeMonName(t.state);
    const mime = t.state.party[1];
    expect(mime.species).toBe(species('MR_MIME'));
    expect(mime.friendship).toBe(70);
    expect(t.state.enemyParty[0]).toBe(abra);
    expect(t.state.party[0].species).toBe(species('PIDGEY'));
    const dex = t.pokemon.nationalDex(species('MR_MIME'));
    expect(t.state.dexSeen.has(dex)).toBe(true);
    expect(t.state.dexCaught.has(dex)).toBe(true);
    expect(t.state.stringVars[0]).toEqual(name('MIMIEN'));
    expect(t.state.stringVars[1]).toEqual(name('MR. MIME'));
  });
});

describe('the Name Rater (field_specials.c)', () => {
  beforeEach(() => {
    t.state.party.push(ownMon('PIDGEY', 9), ownMon('ABRA', 12));
    t.state.setVar('VAR_0x8004', t.d('INGAME_TRADE_MR_MIME'));
    t.state.setVar('VAR_0x8005', 1);
    run('CreateInGameTradePokemon', env().e);
    t.state.party[1] = t.state.enemyParty[0];
  });

  test("IsMonOTIDNotPlayers writes VAR_RESULT: FALSE for the player's mon, TRUE for a traded one", () => {
    t.state.setVar('VAR_0x8004', 0);
    t.state.setVar('VAR_RESULT', 7);
    run('IsMonOTIDNotPlayers', env().e);
    expect(t.state.getVar('VAR_RESULT')).toBe(0);
    t.state.setVar('VAR_0x8004', 1);
    run('IsMonOTIDNotPlayers', env().e);
    expect(t.state.getVar('VAR_RESULT')).toBe(1);
  });

  test('IsMonOTNameNotPlayers: OT name into STR_VAR_1, TRUE when it is not the player name', () => {
    t.state.setVar('VAR_0x8004', 0);
    expect(run('IsMonOTNameNotPlayers', env().e)).toBe(0);
    expect(t.state.stringVars[0]).toEqual(name(t.state.playerName));
    t.state.setVar('VAR_0x8004', 1);
    expect(run('IsMonOTNameNotPlayers', env().e)).toBe(1);
    expect(t.state.stringVars[0]).toEqual(name('REYLEY'));
    // same OT id, another name (a mon traded with a namesake's game) still counts as not the player's
    t.state.party[0].otName = 'GARY';
    t.state.setVar('VAR_0x8004', 0);
    expect(run('IsMonOTNameNotPlayers', env().e)).toBe(1);
  });

  test('NameRaterWasNicknameChanged compares the nickname with STR_VAR_3 and buffers it in STR_VAR_1', () => {
    t.state.setVar('VAR_0x8004', 0);
    t.state.stringVars[2] = name('PIDGEY');
    expect(run('NameRaterWasNicknameChanged', env().e)).toBe(0);
    expect(t.state.stringVars[0]).toEqual(name('PIDGEY'));
    t.state.party[0].nickname = name('PIDGE');
    expect(run('NameRaterWasNicknameChanged', env().e)).toBe(1);
    expect(t.state.stringVars[0]).toEqual(name('PIDGE'));
  });
});
