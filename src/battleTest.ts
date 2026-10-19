// Battle test harness (battle-test.html): build both parties by hand and launch BattleScene
// directly, without the overworld. Dev-only tooling; nothing here is part of the game.

import Phaser from 'phaser';
import { startAudioOutput } from './audio/output';
import { listenForOutputKeys } from './input/Input';
import type { BattleTablesData } from './battle/data';
import { Assets } from './data/assets';
import { loadAudioData } from './audio/audioData';
import { AgbMainSoundInit } from './audio/frame';
import { BattleScene, type BattleStart } from './scenes/BattleScene';
import { PlayMapChosenOrBattleBGM } from './battle/battleBgm';
import { initConstants } from './battle/constants';
import { PokemonData, readPokemonConstants, type Pokemon } from './pokemon/Pokemon';
import { Defines } from './script/Defines';
import { GameState } from './state/GameState';
import { Charmap } from './text/charmap';
import type { TextSpeed } from './text/TextPrinter';

interface MonConfig {
  species: string;
  level: number;
  /** All four blank keeps the level-up moveset CreateMon gives; otherwise blank slots are empty. */
  moves: string[];
  item: string;
}

interface TestConfig {
  mode: 'trainer' | 'wild';
  trainer: string;
  double: boolean;
  ivs: 'random' | 'max' | 'zero';
  terrain: string;
  textSpeed: TextSpeed;
  player: MonConfig[];
  enemy: MonConfig[];
  /** Scripted runs only: bag contents as [ITEM_* name, quantity]. */
  bag?: [string, number][];
}

const STORAGE_KEY = 'battleTest.config';
const MAX_PARTY = 6;

const DEFAULT_CONFIG: TestConfig = {
  mode: 'trainer',
  trainer: 'TRAINER_LEADER_GIOVANNI',
  double: false,
  ivs: 'random',
  terrain: 'BATTLE_TERRAIN_PLAIN',
  textSpeed: 'fast',
  player: [{ species: 'CHARIZARD', level: 50, moves: ['FLAMETHROWER', 'SLASH', 'DRAGON RAGE', 'SWORDS DANCE'], item: '' }],
  enemy: [{ species: 'BLASTOISE', level: 50, moves: ['', '', '', ''], item: '' }],
};

/** Loads the same assets BootScene does, then hands control to the panel. */
class BattleTestBoot extends Phaser.Scene {
  constructor(private onReady: (assets: Assets, trainerIds: string[]) => void) {
    super('BattleTestBoot');
  }

  async create(): Promise<void> {
    const assets = new Assets();
    try {
      await Promise.all([assets.init(), loadAudioData()]);
    } catch (err) {
      console.error(err);
      this.add.text(8, 8, 'Assets missing.\nRun: npm run extract', { fontFamily: 'monospace', fontSize: '10px', color: '#f88' }).setResolution(4);
      return;
    }
    AgbMainSoundInit(); // the audio data: BattleScene's frame (GbaHostScene) runs the engine
    await assets.loadTextTextures(this);
    const tables: BattleTablesData = await (await fetch('gen/battle/tables.json')).json();
    this.registry.set('assets', assets);
    trainerClasses = tables.trainers.map((t) => t?.trainerClass ?? 0);
    this.onReady(assets, tables.trainers.flatMap((t, i) => (t && i > 0 ? [t.id] : [])));
  }
}

const clean = (name: string) => name.replace(/\$$/, '');

/** gTrainers[i].trainerClass, for the battle music before the battle data is loaded */
let trainerClasses: number[] = [];

class Harness {
  private defines: Defines;
  private charmap: Charmap;
  private pokemon: PokemonData;
  private speciesByName = new Map<string, number>();
  private movesByName = new Map<string, number>();
  private itemsByName = new Map<string, number>();
  private config: TestConfig;
  private status!: HTMLElement;

  constructor(
    private game: Phaser.Game,
    private assets: Assets,
    /** gTrainers ids (the trainer sets the name, pic, AI flags and items; the party is replaced). */
    private trainerIds: string[],
    private panel: HTMLElement,
  ) {
    this.defines = new Defines(assets.scripts.defines);
    this.charmap = new Charmap(assets.charmap);
    this.pokemon = new PokemonData(readPokemonConstants(this.defines), assets.species, assets.moves, assets.items, assets.pokemonTables, this.charmap);
    const index = (map: Map<string, number>, list: { id: string; name: string }[], prefix: string) =>
      list.forEach((e, i) => {
        if (i === 0 || !e) return;
        map.set(e.id.toUpperCase(), i);
        map.set(e.id.slice(prefix.length).replace(/_/g, ' '), i);
        if (!map.has(clean(e.name).toUpperCase())) map.set(clean(e.name).toUpperCase(), i);
      });
    index(this.speciesByName, this.realSpecies(), 'SPECIES_');
    index(this.movesByName, assets.moves, 'MOVE_');
    index(this.itemsByName, assets.items, 'ITEM_');
    this.config = loadConfig();
    // Phaser listens for keys on window: keep typing in the form out of the game's input.
    for (const t of ['keydown', 'keyup'] as const) panel.addEventListener(t, (e) => e.stopPropagation());
    document.getElementById('game')!.addEventListener('pointerdown', () => (document.activeElement as HTMLElement | null)?.blur());
    this.render();
  }

  /** Species table without the placeholder slots (SPECIES_OLD_UNOWN_*), indices preserved. */
  private realSpecies(): { id: string; name: string }[] {
    return this.assets.species.map((s) => (s && !s.id.startsWith('SPECIES_OLD_UNOWN') ? s : (undefined as never)));
  }

  // ------------------------------------------------------------------ panel

  private render(): void {
    const c = this.config;
    const p = this.panel;
    p.innerHTML = '';
    p.append(
      datalist('dl-species', this.realSpecies().filter(Boolean).slice(1).map((s) => clean(s.name))),
      datalist('dl-moves', this.assets.moves.slice(1).map((m) => clean(m.name))),
      datalist('dl-items', this.assets.items.slice(1).filter((i) => clean(i.name) !== '????????').map((i) => clean(i.name))),
    );
    const head = el('div');
    head.innerHTML = '<b>Battle test</b> <span class="hint">Z=A X=B Enter=START · arrows<br>All four moves blank = level-up moveset.</span>';
    p.append(head);

    const trainers = this.trainerIds.length ? this.trainerIds : [DEFAULT_CONFIG.trainer];
    const mode = select(['trainer', 'wild'], c.mode, (v) => ((c.mode = v as TestConfig['mode']), this.render()));
    const trainer = select(trainers, c.trainer, (v) => (c.trainer = v));
    trainer.disabled = c.mode === 'wild';
    trainer.style.maxWidth = '260px';
    p.append(row('Mode', mode, trainer));
    p.append(
      row(
        'IVs',
        select(['random', 'max', 'zero'], c.ivs, (v) => (c.ivs = v as TestConfig['ivs'])),
        'Text',
        select(['slow', 'mid', 'fast'], c.textSpeed, (v) => (c.textSpeed = v as TextSpeed)),
        checkbox('Double', c.double, (v) => (c.double = v)),
      ),
    );
    const terrains = Object.keys(this.assets.scripts.defines).filter((k) => k.startsWith('BATTLE_TERRAIN_') && k !== 'BATTLE_TERRAIN_COUNT');
    p.append(row('Terrain', select(terrains, c.terrain, (v) => (c.terrain = v))));

    p.append(this.partyEditor('Player party', c.player), this.partyEditor(c.mode === 'wild' ? 'Wild mon(s)' : "Opponent's party", c.enemy));

    const startBtn = button('Start battle', () => this.launch());
    startBtn.className = 'primary';
    p.append(
      row(
        startBtn,
        button('Random teams', () => {
          c.player = this.randomParty();
          c.enemy = this.randomParty();
          this.render();
        }),
        button('Random moves', () => {
          for (const m of [...c.player, ...c.enemy]) m.moves = this.randomMoves();
          this.render();
        }),
        button('Reset', () => {
          this.config = structuredClone(DEFAULT_CONFIG);
          this.render();
        }),
      ),
    );
    this.status = el('div');
    this.status.id = 'status';
    p.append(this.status);
  }

  private partyEditor(title: string, party: MonConfig[]): HTMLElement {
    const box = el('div');
    const h = el('h2');
    h.textContent = title;
    box.append(h);
    party.forEach((mon, i) => {
      const card = el('div');
      card.className = 'mon';
      const species = input('species', 'dl-species', mon.species, (v) => (mon.species = v), (v) => this.speciesByName.has(norm(v)));
      const level = el('input');
      level.type = 'number';
      level.min = '1';
      level.max = '100';
      level.className = 'level';
      level.value = String(mon.level);
      level.oninput = () => (mon.level = clamp(Number(level.value) || 1, 1, 100));
      const item = input('item', 'dl-items', mon.item, (v) => (mon.item = v), (v) => !v || this.itemsByName.has(norm(v)));
      item.placeholder = 'held item';
      const remove = button('×', () => {
        party.splice(i, 1);
        this.render();
      });
      remove.className = 'x';
      remove.disabled = party.length === 1;
      card.append(row(species, 'Lv', level, item, remove));
      const moves = el('div');
      moves.className = 'moves';
      for (let j = 0; j < 4; j++) {
        const m = input('move', 'dl-moves', mon.moves[j] ?? '', (v) => (mon.moves[j] = v), (v) => !v || this.movesByName.has(norm(v)));
        m.placeholder = '—';
        moves.append(m);
      }
      card.append(moves);
      box.append(card);
    });
    if (party.length < MAX_PARTY) {
      box.append(
        button('+ add mon', () => {
          party.push({ species: 'PIKACHU', level: 50, moves: ['', '', '', ''], item: '' });
          this.render();
        }),
      );
    }
    return box;
  }

  private randomParty(): MonConfig[] {
    const species = this.realSpecies().filter(Boolean).slice(1);
    const n = 1 + Math.floor(Math.random() * 3);
    return Array.from({ length: n }, () => ({
      species: clean(species[Math.floor(Math.random() * species.length)].name),
      level: 50,
      moves: ['', '', '', ''],
      item: '',
    }));
  }

  private randomMoves(): string[] {
    // MOVE_STRUGGLE is only ever chosen by the engine itself
    const moves = this.assets.moves.slice(1).filter((m) => m.id !== 'MOVE_STRUGGLE');
    const picked = new Set<string>();
    while (picked.size < 4) picked.add(clean(moves[Math.floor(Math.random() * moves.length)].name));
    return [...picked];
  }

  // ------------------------------------------------------------------ battle

  private buildMon(state: GameState, m: MonConfig): Pokemon {
    const species = this.speciesByName.get(norm(m.species));
    if (species === undefined) throw new Error(`Unknown species "${m.species}"`);
    const fixedIV = this.config.ivs === 'max' ? 31 : this.config.ivs === 'zero' ? 0 : undefined;
    const mon = this.pokemon.createMon(species, clamp(m.level, 1, 100), {
      fixedIV,
      otId: state.trainerId,
      otName: state.playerName,
      otGender: state.playerGender,
      metLocation: 'MAPSEC_NONE',
    });
    const moves = m.moves.filter((v) => v.trim());
    if (moves.length) {
      moves.forEach((name, j) => {
        const id = this.movesByName.get(norm(name));
        if (id === undefined) throw new Error(`Unknown move "${name}"`);
        mon.moves[j] = id;
        mon.pp[j] = this.assets.moves[id].pp;
      });
      for (let j = moves.length; j < 4; j++) mon.moves[j] = mon.pp[j] = 0;
    }
    if (m.item.trim()) {
      const item = this.itemsByName.get(norm(m.item));
      if (item === undefined) throw new Error(`Unknown item "${m.item}"`);
      mon.heldItem = item;
    }
    return mon;
  }

  /** Start a battle from the panel, or from a script: `battleTest.launch({...config})`. */
  launch(config: TestConfig = this.config): void {
    if (config !== this.config) {
      this.config = { ...structuredClone(DEFAULT_CONFIG), ...config };
      this.render();
      config = this.config;
    }
    saveConfig(config);
    const d = this.defines;
    const state = new GameState(d, this.assets.constants.newGameFlags, this.pokemon, this.assets.strings);
    state.textSpeed = config.textSpeed;
    for (const [item, n] of config.bag ?? []) state.bag.add(d.require(item), n);
    let enemyParty: Pokemon[];
    try {
      state.party = config.player.map((m) => this.buildMon(state, m));
      enemyParty = config.enemy.map((m) => this.buildMon(state, m));
    } catch (err) {
      this.setStatus(String((err as Error).message));
      return;
    }
    const trainer = config.mode === 'trainer';
    const start: BattleStart = {
      battleTypeFlags: trainer ? d.require('BATTLE_TYPE_TRAINER') : 0,
      trainerBattleOpponent_A: trainer ? d.require(config.trainer) : 0,
      trainerBattleMode: d.require('TRAINER_BATTLE_SINGLE'),
      rivalBattleFlags: 0,
      npcTextColor: d.require('NPC_TEXT_COLOR_MALE'),
      terrain: d.require(config.terrain),
      mapBattleScene: d.require('MAP_BATTLE_SCENE_NORMAL'),
      mapType: d.require('MAP_TYPE_ROUTE'),
      overworldWeather: d.require('WEATHER_NONE'),
      state,
      pokemon: this.pokemon,
      charmap: this.charmap,
      enemyParty,
      double: config.double,
      onEnd: (outcome) => {
        this.game.scene.stop('Battle');
        const name = Object.keys(this.assets.scripts.defines).find((k) => k.startsWith('B_OUTCOME_') && this.assets.scripts.defines[k] === outcome);
        this.lastOutcome = name ?? String(outcome);
        this.setStatus(`Battle over: ${this.lastOutcome}\n${state.party.map(describe(this.pokemon)).join('\n')}`);
      },
    };
    this.lastOutcome = undefined;
    const scenes = this.game.scene;
    if (scenes.isActive('Battle')) scenes.stop('Battle');
    // CreateBattleStartTask's PlayMapChosenOrBattleBGM(0): the battle's music, as the field starts it (no
    // transition here). K reads the defines before BattleScene's initBattleEnv has run.
    initConstants(this.assets.scripts.defines);
    PlayMapChosenOrBattleBGM(0, start.battleTypeFlags, trainer ? (trainerClasses[start.trainerBattleOpponent_A] ?? 0) : 0);
    scenes.start('Battle', start);
    this.setStatus('Battle running…');
    (document.activeElement as HTMLElement | null)?.blur();
  }

  lastOutcome: string | undefined;

  private setStatus(text: string): void {
    this.status.textContent = text;
  }

  get currentConfig(): TestConfig {
    return this.config;
  }
}

function describe(pokemon: PokemonData) {
  return (m: Pokemon) => `  ${clean(pokemon.species[m.species].name)} Lv${m.level} ${m.hp}/${m.maxHP} HP`;
}

const norm = (s: string) => s.trim().toUpperCase();
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function loadConfig(): TestConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...structuredClone(DEFAULT_CONFIG), ...JSON.parse(raw) };
  } catch {
    // private window / blocked storage: defaults
  }
  return structuredClone(DEFAULT_CONFIG);
}

function saveConfig(c: TestConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // ignore
  }
}

// ------------------------------------------------------------------ tiny DOM helpers

function el<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElement(tag);
}

function row(...items: (HTMLElement | string)[]): HTMLElement {
  const r = el('div');
  r.className = 'row';
  for (const it of items) {
    if (typeof it === 'string') {
      const s = el('span');
      s.textContent = it;
      r.append(s);
    } else r.append(it);
  }
  return r;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button');
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function select(options: string[], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = el('select');
  for (const o of options) {
    const opt = el('option');
    opt.value = opt.textContent = o;
    s.append(opt);
  }
  s.value = value;
  s.onchange = () => onChange(s.value);
  return s;
}

function checkbox(label: string, value: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
  const l = el('label');
  const c = el('input');
  c.type = 'checkbox';
  c.checked = value;
  c.onchange = () => onChange(c.checked);
  l.append(c, ` ${label}`);
  return l;
}

function input(cls: string, list: string, value: string, onChange: (v: string) => void, valid: (v: string) => boolean): HTMLInputElement {
  const i = el('input');
  i.className = cls;
  i.setAttribute('list', list);
  i.value = value;
  const check = () => i.classList.toggle('bad', !valid(i.value));
  i.oninput = () => {
    onChange(i.value);
    check();
  };
  check();
  return i;
}

function datalist(id: string, values: string[]): HTMLDataListElement {
  const dl = el('datalist');
  dl.id = id;
  for (const v of values) {
    const o = el('option');
    o.value = v;
    dl.append(o);
  }
  return dl;
}

// ------------------------------------------------------------------ boot

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 240,
  height: 160,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [new BattleTestBoot((assets, trainerIds) => {
    const harness = new Harness(game, assets, trainerIds, document.getElementById('panel')!);
    (window as unknown as { battleTest: unknown }).battleTest = harness;
  }), BattleScene],
  audio: { noAudio: true }, // the sound output is audio/output.ts's, as in main.ts
});

// The same sound output as the game (AUDIO_PLAN.md decision 12): starts on the first key press or click; M mutes.
startAudioOutput(listenForOutputKeys);

(window as unknown as { game: Phaser.Game }).game = game;
