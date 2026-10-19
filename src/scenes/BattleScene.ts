// The battle screen: sets up the battle globals from BattleStart and runs CB2_InitBattle
// (battle/battleCallbacks.ts) on the GBA host loop. The bag and party menu open inside it.

import type { Assets } from '../data/assets';
import { battleAnimGfxSymbols } from '../battle/anim/battleAnim';
import { shinyGfxSymbols } from '../battle/anim/special';
import { battleBgGfxSymbols } from '../battle/battleBg';
import { CB2_InitBattle } from '../battle/battleCallbacks';
import { setBattleUi, type BattleUi, type GbaButton } from '../battle/battleUi';
import { setBattleTextSpeed } from '../battle/battleWindow';
import { K } from '../battle/constants';
import { loadBattleData, type BattleData } from '../battle/data';
import { g, bdata, initBattleEnv, setTextStrings } from '../battle/env';
import { battleSpriteGfxSymbols, GET_UNOWN_LETTER } from '../battle/gfx';
import { initBattleMessages } from '../battle/message';
import { loadGfx } from '../gba/gfx';
import {
  A_BUTTON,
  B_BUTTON,
  DPAD_DOWN,
  DPAD_LEFT,
  DPAD_RIGHT,
  DPAD_UP,
  gMain,
  JOY_HELD,
  JOY_NEW,
  L_BUTTON,
  R_BUTTON,
  SELECT_BUTTON,
  SetMainCallback1,
  SetMainCallback2,
  SetVBlankCallback,
  START_BUTTON,
} from '../gba/main';
import { initGbaText } from '../gba/window';
import { prepareMenus } from '../menus/host';
import { NAMING_SCREEN_CAUGHT_MON, namingScreenGfxSymbols } from '../menus/namingScreen';
import { loadPokedexData } from '../menus/pokedex';
import { dexRegisterGfxSymbols } from '../menus/pokedexScreen';
import type { Pokemon, PokemonData } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import type { Charmap } from '../text/charmap';
import { Fonts } from '../text/Font';
import { TEXT_SPEED } from '../text/TextPrinter';
import { GbaHostScene } from './GbaHostScene';

const TEXTURE = 'battle_screen';

/** Everything BattleSetup_StartTrainerBattle / StartTrainerBattle leave in globals for the battle. */
export interface BattleStart {
  battleTypeFlags: number;
  trainerBattleOpponent_A: number;
  trainerBattleMode: number;
  rivalBattleFlags: number;
  /** sTrainerADefeatSpeech / sTrainerVictorySpeech, encoded */
  defeatSpeech?: number[];
  victorySpeech?: number[];
  /** ContextNpcGetTextColor: NPC_TEXT_COLOR_* */
  npcTextColor: number;
  /** BattleSetup_GetTerrainId */
  terrain: number;
  /** gMapHeader.battleType (MAP_BATTLE_SCENE_*) and mapType (MAP_TYPE_*) */
  mapBattleScene: number;
  mapType: number;
  /** GetCurrentWeather */
  overworldWeather: number;
  state: GameState;
  pokemon: PokemonData;
  charmap: Charmap;
  /**
   * gEnemyParty for a non-trainer battle (the wild/scripted mon(s) the field set up). The test harness
   * (battle-test.html) also uses it to replace the party CreateNPCTrainerParty builds.
   */
  enemyParty?: Pokemon[];
  /** Test harness only: forces BATTLE_TYPE_DOUBLE on or off after the trainer's own flag is applied. */
  double?: boolean;
  /** gMain.savedCallback: called with gBattleOutcome once the screen has faded to black. */
  onEnd(outcome: number): void;
}

let battleData: Promise<BattleData> | undefined;

/** The battle data, loaded once (the field menus need it too). */
export function sharedBattleData(): Promise<BattleData> {
  battleData ??= loadBattleData('gen');
  return battleData;
}

/** Graphics the battle can touch: interface, terrain, balls, and pics for everyone involved. */
function gfxSymbolsFor(data: BattleData, start: BattleStart): string[] {
  const a = data.anims;
  const syms = new Set<string>([...battleBgGfxSymbols(), ...battleSpriteGfxSymbols(), 'gPPTextPalette', 'sLevelUpBanner_Gfx', 'sLevelUpBanner_Pal']);
  const add = (s: string | null | undefined) => {
    if (s) syms.add(s);
  };
  const addMon = (species: number, personality = 0) => {
    add(a.monFrontPics[species]);
    add(a.monBackPics[species]);
    add(a.monPalettes[species]);
    add(a.monShinyPalettes[species]);
    // LoadSpecialPokePic: Unown letter forms live after NUM_SPECIES in the pic tables (monPicSymbol)
    if (species === K.SPECIES_UNOWN && GET_UNOWN_LETTER(personality)) {
      add(a.monFrontPics[K.NUM_SPECIES + GET_UNOWN_LETTER(personality)]);
      add(a.monBackPics[K.NUM_SPECIES + GET_UNOWN_LETTER(personality)]);
    }
  };
  addMon(0);
  for (const mon of start.state.party) addMon(mon.species, mon.personality);
  for (const mon of start.enemyParty ?? []) addMon(mon.species, mon.personality);
  const trainer = data.tables.trainers[start.trainerBattleOpponent_A];
  for (const m of trainer?.party ?? []) addMon(m.species);
  if (trainer) {
    add(a.trainerFrontPics[trainer.trainerPic]?.pic);
    add(a.trainerFrontPalettes[trainer.trainerPic]);
  }
  if (start.battleTypeFlags & K.BATTLE_TYPE_GHOST) {
    add('gGhostFrontPic');
    add('gGhostPalette');
  }
  a.trainerBackPics.forEach(add);
  a.trainerBackPalettes.forEach(add);
  // Battle anims: every move anyone can use (trainer mons without a set moveset know their level-up
  // moves up to their level), plus the status/general/special anims. Anything else loads on first use.
  const moves = new Set<number>();
  for (const mon of [...start.state.party, ...(start.enemyParty ?? [])]) mon.moves.forEach((m) => moves.add(m));
  for (const m of trainer?.party ?? []) {
    if (m.moves) m.moves.forEach((mv) => moves.add(mv));
    else for (const [lvl, mv] of start.pokemon.species[m.species].learnset) if (lvl <= m.lvl) moves.add(mv);
  }
  battleAnimGfxSymbols(moves).forEach(add);
  shinyGfxSymbols().forEach(add);
  return [...syms];
}

export class BattleScene extends GbaHostScene implements BattleUi {
  private start!: BattleStart;

  constructor() {
    super('Battle');
  }

  async create(start: BattleStart): Promise<void> {
    this.start = start;
    this.initHost(TEXTURE, start.state.playTime);
    const assets: Assets = this.registry.get('assets');

    const data = await sharedBattleData();
    initBattleEnv(data, assets.scripts.defines, start.pokemon, start.state, start.charmap);
    await loadGfx(gfxSymbolsFor(data, start));
    setTextStrings(assets.strings);
    // The bag and party menu open from inside the battle and use the same GBA screen.
    await prepareMenus(start.state);
    // So does the naming screen for a caught mon (Cmd_trygivecaughtmonnick).
    if (!(start.battleTypeFlags & K.BATTLE_TYPE_TRAINER)) {
      await loadGfx((start.enemyParty ?? []).flatMap((mon) => namingScreenGfxSymbols(NAMING_SCREEN_CAUGHT_MON, mon.species, mon.personality)));
      // ... and before it the Pokédex's registered page for a new species (Cmd_displaydexinfo).
      const newSpecies = (start.enemyParty ?? []).filter((mon) => !start.state.dexCaught.has(start.pokemon.nationalDex(mon.species)));
      if (newSpecies.length) {
        await loadPokedexData('gen');
        await loadGfx(newSpecies.flatMap((mon) => dexRegisterGfxSymbols(mon.species)));
      }
    }
    initBattleMessages();
    const speed = TEXT_SPEED[start.state.textSpeed];
    initGbaText(new Fonts(this, assets.fonts), this.buttons, speed.scroll);
    setBattleTextSpeed(speed.delay);
    setBattleUi(this);
    this.lEqualsA = start.state.optionsButtonMode === K.OPTIONS_BUTTON_MODE_L_EQUALS_A;

    // StartTrainerBattle and the globals battle_setup.c leaves behind
    g.battleTypeFlags = start.battleTypeFlags;
    g.trainerBattleOpponent_A = start.trainerBattleOpponent_A;
    g.trainerBattleMode = start.trainerBattleMode;
    g.rivalBattleFlags = start.rivalBattleFlags;
    g.trainerADefeatSpeech = start.defeatSpeech;
    g.trainerVictorySpeech = start.victorySpeech;
    g.npcTextColor = start.npcTextColor;
    g.mapBattleScene = start.mapBattleScene;
    g.mapType = start.mapType;
    g.overworldWeather = start.overworldWeather;
    g.playerParty = start.state.party;
    g.numSafariBalls = start.state.numSafariBalls; // EWRAM on the GBA: it outlives the battle
    // gEnemyParty as the field left it (the wild/scripted mon); CreateNPCTrainerParty replaces it for trainers
    if (start.enemyParty) g.enemyParty = Array.from({ length: K.PARTY_SIZE }, (_, i) => start.enemyParty![i]);
    g.onBattleEnd = (outcome) => this.endBattle(outcome);

    SetMainCallback1(null);
    CB2_InitBattle(start.terrain, () => this.applyTestOverrides());
    this.startHost();
  }

  /** battle-test.html: its configured trainer party and battle type swapped in after CreateNPCTrainerParty. */
  private applyTestOverrides(): void {
    const { enemyParty, double } = this.start;
    if (enemyParty && g.battleTypeFlags & K.BATTLE_TYPE_TRAINER) {
      g.enemyParty = Array.from({ length: K.PARTY_SIZE }, (_, i) => enemyParty[i]);
    }
    if (double !== undefined) {
      g.battleTypeFlags = double ? g.battleTypeFlags | K.BATTLE_TYPE_DOUBLE : g.battleTypeFlags & ~K.BATTLE_TYPE_DOUBLE;
    }
  }

  /** ReturnFromBattleToOverworld: SetMainCallback2(gMain.savedCallback) */
  private endBattle(outcome: number): void {
    this.stopHost();
    SetMainCallback1(null);
    SetMainCallback2(null);
    SetVBlankCallback(null);
    gMain.inBattle = false;
    setBattleUi(undefined as unknown as BattleUi);
    this.start.state.numSafariBalls = g.numSafariBalls;
    this.start.onEnd(outcome);
  }

  // ------------------------------------------------------------ BattleUi

  joyNew(button: GbaButton): boolean {
    return JOY_NEW(BUTTON_BITS[button]) !== 0;
  }

  joyHeld(button: GbaButton): boolean {
    return JOY_HELD(BUTTON_BITS[button]) !== 0;
  }

  anyNewKeys(): boolean {
    return gMain.newKeys !== 0;
  }

  addBagItem(itemId: number, count: number): void {
    this.start.state.bag.add(itemId, count);
  }

  playerGender(): number {
    return this.start.state.playerGender === 'female' ? K.FEMALE : K.MALE;
  }
}

/** GbaButton -> key bit (include/gba/io_reg.h) */
const BUTTON_BITS: Record<GbaButton, number> = {
  A: A_BUTTON,
  B: B_BUTTON,
  SELECT: SELECT_BUTTON,
  START: START_BUTTON,
  RIGHT: DPAD_RIGHT,
  LEFT: DPAD_LEFT,
  UP: DPAD_UP,
  DOWN: DPAD_DOWN,
  R: R_BUTTON,
  L: L_BUTTON,
};

/** For devtools: the battle's globals and data. */
export function battleDebug(): { g: typeof g; bdata: typeof bdata } {
  return { g, bdata };
}
