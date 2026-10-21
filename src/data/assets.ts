import Phaser from 'phaser';
import type { FieldEffectObjects } from '../entities/FieldEffects';
import type { ScriptsData } from '../script/ScriptEngine';
import type { TradesData } from '../script/tradeSpecials';
import type { CharmapData } from '../text/charmap';
import { fontTextureKey, type FontsData } from '../text/Font';
import { MESSAGE_TEXTURES } from '../text/MessageBox';
import { STD_FRAME_TEXTURE, userFrameTexture } from '../ui/MenuWindow';
import { loadGfx } from '../gba/gfx';
import { initEasyChatData, type EasyChatData } from '../menus/easyChatData';
import { initTrainerTowerData, type TrainerTowerData } from '../world/trainerTower';
import { initFameCheckerData, type FameCheckerData } from '../state/fameChecker';
import { initRenewableHiddenItems } from '../world/renewableHiddenItems';
import { initHelpSystemData, type HelpSystemData } from '../ui/helpSystemContext';
import { initQuestLogData, type QuestLogData } from '../world/questLog';
import { FieldDoors, type DoorData } from '../world/doors';
import { ATLAS_LAYERS, TilesetPair } from '../world/TilesetPair';
import { TILESET_ANIM_SYMBOLS, type TilesetAnimInfo } from '../world/tilesetAnims';
import { tilesetVram, type TilesetPalettes } from '../world/TilesetVram';
import type { Constants, ItemInfo, MapData, MapLayoutData, MoveInfo, PokemonTables, SpeciesInfo, SpriteInfo, TilesetIndex, TilesetSymbols, WildEncounterData } from './types';

const GEN = 'gen';

/**
 * Central registry for extracted data. Small indexes are loaded once at boot;
 * maps and textures are fetched on demand and cached.
 */
export class Assets {
  mapIndex: Record<string, string> = {}; // MAP_* id -> map name
  sprites: Record<string, SpriteInfo> = {}; // OBJ_EVENT_GFX_* -> sheet
  /** Sprite sheets being loaded, by texture key. */
  private spriteLoads = new Map<string, Promise<void>>();
  private tilesets!: TilesetIndex;
  private pairs = new Map<string, TilesetPair>();
  private tilesetPalettes?: Promise<TilesetPalettes>;
  constants!: Constants;
  fonts!: FontsData;
  charmap!: CharmapData;
  strings: Record<string, string> = {};
  scripts!: ScriptsData;
  behaviorIds: Record<string, number> = {};
  species: SpeciesInfo[] = [];
  moves: MoveInfo[] = [];
  items: ItemInfo[] = [];
  pokemonTables!: PokemonTables;
  emoticons!: EmoticonData;
  wildEncounters!: WildEncounterData;
  doors!: DoorData;
  fieldEffectObjects!: FieldEffectObjects;
  /** gFieldEffectScriptPointers by FLDEFF_* name (data/field_effect_scripts.s) */
  fieldEffectScripts: Record<string, string[][]> = {};
  /** sInGameTrades (trades.json, tools/extract_trades.py) */
  trades!: TradesData;

  private maps = new Map<string, Promise<MapData>>();
  private loadedMaps = new Map<string, MapData>();
  private layoutIndex?: Promise<Record<string, string>>;

  async init(): Promise<void> {
    const [index, sprites, tilesets, constants, fonts, charmap, strings, scripts, species, moves, items, tables, emoticons, wildEncounters] = await Promise.all([
      fetchJson<Record<string, string>>(`${GEN}/maps/index.json`),
      fetchJson<Record<string, SpriteInfo>>(`${GEN}/sprites/manifest.json`),
      fetchJson<TilesetIndex>(`${GEN}/tilesets/index.json`),
      fetchJson<Constants>(`${GEN}/constants.json`),
      fetchJson<FontsData>(`${GEN}/text/fonts.json`),
      fetchJson<CharmapData>(`${GEN}/text/charmap.json`),
      fetchJson<Record<string, string>>(`${GEN}/text/strings.json`),
      fetchJson<ScriptsData>(`${GEN}/scripts/scripts.json`),
      fetchJson<SpeciesInfo[]>(`${GEN}/pokemon/species.json`),
      fetchJson<MoveInfo[]>(`${GEN}/pokemon/moves.json`),
      fetchJson<ItemInfo[]>(`${GEN}/pokemon/items.json`),
      fetchJson<PokemonTables>(`${GEN}/pokemon/tables.json`),
      fetchJson<EmoticonData>(`${GEN}/field_effects/emoticons.json`),
      fetchJson<WildEncounterData>(`${GEN}/wild_encounters.json`),
    ]);
    this.doors = await fetchJson<DoorData>(`${GEN}/doors.json`);
    this.fieldEffectObjects = await fetchJson<FieldEffectObjects>(`${GEN}/field_effects/objects.json`);
    this.fieldEffectScripts = await fetchJson<Record<string, string[][]>>(`${GEN}/field_effects/scripts.json`);
    this.trades = await fetchJson<TradesData>(`${GEN}/trades.json`);
    initEasyChatData(await fetchJson<EasyChatData>(`${GEN}/easyChat.json`)); // before any GameState (InitEasyChatPhrases)
    initTrainerTowerData(await fetchJson<TrainerTowerData>(`${GEN}/trainerTower.json`)); // world/trainerTower.ts
    initFameCheckerData(await fetchJson<FameCheckerData>(`${GEN}/fameChecker.json`)); // state/fameChecker.ts
    initRenewableHiddenItems(constants.renewableHiddenItems); // before any GameState (NewGameInitData's SetAllRenewableItemFlags)
    initHelpSystemData(await fetchJson<HelpSystemData>(`${GEN}/helpSystem.json`)); // ui/helpSystemMenu.ts
    initQuestLogData(await fetchJson<QuestLogData>(`${GEN}/questLog.json`)); // world/questLog.ts
    await loadGfx(FieldDoors.gfxSymbols(this.doors));
    this.wildEncounters = wildEncounters;
    this.species = species;
    this.moves = moves;
    this.items = items;
    this.pokemonTables = tables;
    this.emoticons = emoticons;
    this.fonts = fonts;
    this.charmap = charmap;
    this.strings = strings;
    this.scripts = scripts;
    this.mapIndex = index;
    this.sprites = sprites;
    this.tilesets = tilesets;
    this.constants = constants;
    this.behaviorIds = constants.metatileBehaviors;
  }

  mapNameForId(id: string): string | undefined {
    return this.mapIndex[id];
  }

  loadMap(name: string): Promise<MapData> {
    let p = this.maps.get(name);
    if (!p) {
      p = fetchJson<MapData>(`${GEN}/maps/${name}.json`).then((data) => (this.loadedMaps.set(name, data), data));
      this.maps.set(name, p);
    }
    return p;
  }

  /** A map loadMap has finished loading, synchronously (undefined until then). */
  loadedMap(name: string): MapData | undefined {
    return this.loadedMaps.get(name);
  }

  /**
   * gMapLayouts[id - 1] by LAYOUT_* name: a layout a map header uses comes from that map's file
   * (maps/layouts/index.json says which), any other from its own file.
   */
  async loadLayout(id: string): Promise<MapLayoutData> {
    this.layoutIndex ??= fetchJson<Record<string, string>>(`${GEN}/maps/layouts/index.json`);
    const mapName = (await this.layoutIndex)[id];
    if (!mapName) return fetchJson<MapLayoutData>(`${GEN}/maps/layouts/${id}.json`);
    const { width, height, blocks, borderWidth, borderHeight, border, tilesetPair } = await this.loadMap(mapName);
    return { id, width, height, blocks, borderWidth, borderHeight, border, tilesetPair };
  }

  /** The GBA-native symbols of a pair's primary and secondary tilesets (CopyMapTilesetsToVram's sources). */
  tilesetSymbols(key: string): { primary: TilesetSymbols; secondary: TilesetSymbols } {
    const info = this.tilesets.pairs[key];
    return { primary: this.tilesets.symbols[info.primary], secondary: this.tilesets.symbols[info.secondary] };
  }

  tilesetPair(key: string): TilesetPair {
    let pair = this.pairs.get(key);
    if (!pair) {
      const info = this.tilesets.pairs[key];
      if (!info) throw new Error(`Unknown tileset pair ${key}`);
      pair = new TilesetPair(key, info, this.tilesets.primaries[info.primary], this.tilesets.secondaries[info.secondary]);
      this.pairs.set(key, pair);
    }
    return pair;
  }

  /** Ensure the primary and pair atlases (bottom/middle/top) for a tileset pair are in the texture manager. */
  loadTilesetTextures(scene: Phaser.Scene, key: string): Promise<void> {
    const pair = this.tilesetPair(key);
    const files = ATLAS_LAYERS.flatMap((layer): [string, string][] => [
      [pair.primaryTexture(layer), `${GEN}/tilesets/${pair.info.primary}_${layer}.png`],
      [pair.pairTexture(layer), `${GEN}/tilesets/${key}_${layer}.png`],
    ]);
    return loadImages(scene, files).then(() => this.loadTilesetVram(scene, key));
  }

  /**
   * The pair's GBA-native tiles, metatiles and palettes as `tilesetVram` stores (door frames are drawn
   * from them), and for tilesets with an animation callback its frames, with the atlases made redrawable.
   */
  private async loadTilesetVram(scene: Phaser.Scene, key: string): Promise<void> {
    const pair = this.tilesetPair(key);
    const names = [pair.info.primary, pair.info.secondary];
    const syms = names.map((n) => this.tilesets.symbols[n]);
    this.tilesetPalettes ??= fetchJson<TilesetPalettes>(`${GEN}/tilesets/palettes.json`);
    const [palettes] = await Promise.all([
      this.tilesetPalettes,
      loadGfx(syms.flatMap((s) => [s.tiles, s.metatiles, ...(s.callback ? (TILESET_ANIM_SYMBOLS[s.callback] ?? []) : [])])),
    ]);
    names.forEach((n, i) => tilesetVram.addStore(n, syms[i].tiles, syms[i].metatiles, palettes[n]));
    if (syms.some((s) => s.callback)) tilesetVram.makeAtlasesLive(scene.textures, pair);
  }

  /** The animation callback (tileset_anims.c InitTilesetAnim_*) of each tileset of a pair. */
  tilesetAnimInfo(key: string): { primary: TilesetAnimInfo; secondary: TilesetAnimInfo } {
    const info = this.tilesets.pairs[key];
    return {
      primary: { name: info.primary, callback: this.tilesets.symbols[info.primary].callback },
      secondary: { name: info.secondary, callback: this.tilesets.symbols[info.secondary].callback },
    };
  }

  /** Font sheets and message box graphics, needed before any text can be shown. */
  loadTextTextures(scene: Phaser.Scene): Promise<void> {
    const images = new Set(Object.values(this.fonts.fonts).map((f) => f.image));
    return loadImages(scene, [
      ...[...images].map((img): [string, string] => [fontTextureKey(img), `${GEN}/text/${img}.png`]),
      [MESSAGE_TEXTURES.frame, `${GEN}/text/dialogue_frame.png`],
      [MESSAGE_TEXTURES.signpostFrame, `${GEN}/text/signpost_frame.png`],
      [MESSAGE_TEXTURES.arrows, `${GEN}/text/down_arrows.png`],
      ...Array.from({ length: 10 }, (_, i): [string, string] => [userFrameTexture(i + 1), `${GEN}/text/frame_type${i + 1}.png`]),
      [STD_FRAME_TEXTURE, `${GEN}/text/frame_std.png`],
    ]);
  }

  /** Field effect sprite sheets: the emote icons and every gFieldEffectObjectTemplate_*. */
  loadFieldEffectTextures(scene: Phaser.Scene): Promise<void> {
    if (scene.textures.exists(EMOTICONS_TEXTURE)) return Promise.resolve();
    const { frameWidth, frameHeight } = this.emoticons;
    return new Promise((resolve) => {
      scene.load.spritesheet(EMOTICONS_TEXTURE, `${GEN}/field_effects/emoticons.png`, { frameWidth, frameHeight });
      for (const [name, t] of Object.entries(this.fieldEffectObjects.templates)) {
        scene.load.spritesheet(fieldEffectTextureKey(name), `${GEN}/field_effects/obj_${name}.png`, { frameWidth: t.frameWidth, frameHeight: t.frameHeight });
      }
      scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      scene.load.start();
    });
  }

  /** Ensure a species' front pic (64x64) is loaded; returns its texture key. */
  async loadMonFrontPic(scene: Phaser.Scene, species: number): Promise<string> {
    const key = monFrontPicKey(species);
    await loadImages(scene, [[key, `${GEN}/pokemon/front/${species}.png`]]);
    return key;
  }

  /** Ensure the sprite sheet for an OBJ_EVENT_GFX_* id is loaded. Returns its info, or undefined. */
  async loadSprite(scene: Phaser.Scene, gfxId: string): Promise<SpriteInfo | undefined> {
    const info = this.sprites[gfxId];
    if (!info) return undefined;
    const key = spriteTextureKey(info);
    if (scene.textures.exists(key)) return info;
    // Overlapping calls share one load: queueing the same key twice makes Phaser reject the second.
    let loading = this.spriteLoads.get(key);
    if (!loading) {
      loading = new Promise<void>((resolve) => {
        // The sheet, and the copy in its reflection palette if it has one.
        const sheets: [string, string][] = [[key, `${GEN}/sprites/${info.key}.png`]];
        if (info.reflection) sheets.push([reflectionTextureKey(info), `${GEN}/sprites/${info.key}_reflection.png`]);
        let remaining = sheets.length;
        for (const [k, url] of sheets) {
          scene.load.spritesheet(k, url, { frameWidth: info.frameWidth, frameHeight: info.frameHeight });
          scene.load.once(`filecomplete-spritesheet-${k}`, () => {
            if (--remaining === 0) resolve();
          });
        }
        scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
        scene.load.start();
      }).finally(() => this.spriteLoads.delete(key));
      this.spriteLoads.set(key, loading);
    }
    await loading;
    return info;
  }
}

export function monFrontPicKey(species: number): string {
  return `mon_front_${species}`;
}

export const EMOTICONS_TEXTURE = 'fldeff_emoticons';

/** trainer_see.c's emote icons: sSpriteAnimTable_Emoticons as [frame, duration] lists. */
export interface EmoticonData {
  frameWidth: number;
  frameHeight: number;
  anims: [number, number][][];
}

export function spriteTextureKey(info: SpriteInfo): string {
  return `spr_${info.key}`;
}

/** The sheet drawn in the object's reflection palette (SetUpReflection). */
export function reflectionTextureKey(info: SpriteInfo): string {
  return `spr_${info.key}_reflection`;
}

/** A gFieldEffectObjectTemplate_<name>'s sprite sheet. */
export function fieldEffectTextureKey(name: string): string {
  return `fldeff_obj_${name}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

function loadImages(scene: Phaser.Scene, images: [string, string][]): Promise<void> {
  const missing = images.filter(([key]) => !scene.textures.exists(key));
  if (missing.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let remaining = missing.length;
    const done = () => {
      if (--remaining === 0) resolve();
    };
    for (const [key, url] of missing) {
      scene.load.image(key, url);
      scene.load.once(`filecomplete-image-${key}`, done);
    }
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
    scene.load.start();
  });
}
