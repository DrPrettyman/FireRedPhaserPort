import Phaser from 'phaser';
import { spriteTextureKey, type Assets } from '../data/assets';
import type { MapData, ObjectEventData, WarpEventData } from '../data/types';
import { bdata, initBattleEnv } from '../battle/env';
import { K } from '../battle/constants';
import { PlaySE } from '../gba/sound'; // field_control_avatar.c's SEs (W-sound 4)
import { PlayMapChosenOrBattleBGM } from '../battle/battleBgm';
import { BattleTransition_StartOnField, battleTransitionGfxSymbols, IsBattleTransitionDone, setTransitionFieldCamera } from '../battle/transition';
import { loadGfx } from '../gba/gfx';
import { RGB_BLACK, RGB_WHITE } from '../gba/hw';
import { loadMenusData } from '../menus/data';
import { expandPlaceholders } from '../text/placeholders';
import { FieldEffects } from '../entities/FieldEffects';
import { GroundEffects } from '../entities/groundEffects';
import { FieldPoisonEffect } from '../entities/FieldPoisonEffect';
import { NpcBrain, setInitialMovementTypeFacing } from '../entities/NpcBrain';
import { applyStartPreset, type StartPreset } from '../dev/startPresets';
import { ObjectEvent, type ObjectEventField } from '../entities/ObjectEvent';
import { healPlayerParty } from '../script/specials';
import { WhiteOutText } from '../ui/WhiteOutText';
import { Input } from '../input/Input';
import { PokemonData, readPokemonConstants, type Pokemon } from '../pokemon/Pokemon';
import { Defines } from '../script/Defines';
import { directionId, ScriptEngine, textColorFromId, type MultichoiceRequest, type ScriptHost, type TrainerBattle, type TrainerBattleRun, type Wait } from '../script/ScriptEngine';
import { GameState } from '../state/GameState';
import { Charmap } from '../text/charmap';
import { FONT_NORMAL, Fonts } from '../text/Font';
import { MessageBox } from '../text/MessageBox';
import { Behaviors } from '../world/behaviors';
import { DELTA, type Direction } from '../world/direction';
import { MAPGRID_COLLISION_MASK, TILE, type MapChunk } from '../world/MapChunk';
import type { BgEventData } from '../data/types';
import { WildEncounters } from '../world/WildEncounters';
import { World } from '../world/World';
import { StartMenu } from '../ui/StartMenu';
import { helpMessageWindowGfxSymbols } from '../ui/HelpMessageWindow';
import { helpSystemGfxSymbols } from '../ui/helpSystem';
import { HelpSystemFieldHost } from '../ui/helpSystemField';
import { HelpSystem_Disable, HelpSystem_Enable, SetHelpContextForMap } from '../ui/helpSystemContext';
import { SAVECB_RETURN_CANCEL, SAVECB_RETURN_CONTINUE, SaveDialog } from '../ui/SaveDialog';
import { ClearContinueGameWarpStatus, gSave, UseContinueGameWarp } from '../state/save';
import { fromSaveData, type SaveData } from '../state/saveData';
import { PlayTimeCounter_Reset, PlayTimeCounter_Start, PlayTimeCounter_Update } from '../state/playTime';
import { AgbMainFrameEnd } from '../audio/frame';
import { BGMusicStopped, StopMapMusic } from '../gba/sound';
import {
  type AmbientCryTaskData,
  ChooseAmbientCrySpecies,
  Overworld_ClearSavedMusic,
  Overworld_PlaySpecialMapMusic,
  Overworld_TryMapConnectionMusicTransition,
  setOverworldMusicHost,
  TryFadeOutOldMapMusic,
  UpdateAmbientCry,
} from '../gba/overworldMusic';
import type { PlayerLocation } from '../state/GameState';
import { GetMapName } from '../world/regionMap';
import { YesNoMenu } from '../ui/YesNoMenu';
import { MonPicBox } from '../ui/MonPicBox';
import { museumFossilPicGfxSymbols, registerMuseumFossilPic } from '../ui/MuseumFossilPic';
import { brailleCursorGfxSymbols, IncrementResortGorgeousStepCounter } from '../script/postgameSpecials';
import { MoneyBox } from '../ui/MoneyBox';
import { CoinsBox } from '../ui/CoinsBox';
import { loadSlotMachineData } from '../menus/slotMachineLogic';
import { DEPTH_FADE, ScreenFade } from '../ui/ScreenFade';
import { BarnDoorWipe } from '../ui/BarnDoorWipe';
import { FieldGbaScreen, fieldGbaScreenGfxSymbols, type FieldGbaSource } from '../world/fieldGbaScreen';
import { CB2_DoChangeMap, IsChangeMapDone, MapHasCavePreviewScreen, MapHasForestPreviewScreen, mapTransitionGfxSymbols, MapTransitionIsEnter, MapTransitionIsExit } from '../world/mapTransition';
import { DEPTH_MIDDLE, DEPTH_TOP } from '../world/MapChunk';
import { DEPTH_UI } from '../text/TextWindow';
import { FieldDoors } from '../world/doors';
import { InitSecondaryTilesetAnimation, InitTilesetAnimations, TransferTilesetAnimsBuffer, UpdateTilesetAnimations } from '../world/tilesetAnims';
import {
  ApplyWeatherGammaShiftToBgPals,
  DoCurrentWeather,
  fadedFieldEffectPaletteTags,
  loadWeatherData,
  ResetWeatherTask,
  ResumePausedWeather,
  SetSavedWeatherFromCurrMapHeader,
  setWeatherHost,
  SetMapHeaderWeather,
  setWeatherPaletteFadeActive,
  StartWeather,
  WeatherFadeInBlend,
  WeatherFadeScreen,
  weatherProbe,
  WeatherTask,
} from '../world/weather';
import { WeatherTextures } from '../world/weatherTextures';
import { FogHorizontal } from '../world/fogHorizontal';
import { leagueLightingProbe, loadLeagueLightingData, registerLeagueLighting, ResetLeagueLightingTasks, setLeagueLightingHost, StopPokemonLeagueLightingEffectTask } from '../world/leagueLighting';
import { tilesetVram } from '../world/TilesetVram';
import { ShopMenu, type ShopHost } from '../ui/ShopMenu';
import { StoragePcMenu } from '../ui/StoragePcMenu';
import { PlayerPcMenu } from '../ui/PlayerPcMenu';
import { ItemPc_SetInitializedFlag } from '../menus/itemPc';
import { CountItemsInPC } from '../state/pcItems';
import { GetPreviousBoxOption } from '../menus/pokemonStorage';
import { MenuWindow, setUserFrameTypeSource } from '../ui/MenuWindow';
import { MapNamePopup } from '../ui/MapNamePopup';
import { FLOOR_NAMES, type FieldTask } from '../world/elevator';
import { gFieldCallback, gFieldCallback2, type FieldCallbackHost } from '../menus/fieldCallbacks';
import { RunMassageCooldownStepCounter } from '../script/miscSpecials';
import { IncrementBirthIslandRockStepCount } from '../script/eventIslandSpecials';
import { SetUpFieldTasks, Task_RunPerStepCallback, type PerStepCallbackHost } from '../world/fieldTasks'; // W-sevii
import { DEOXYS_ROCK_GFX, registerDeoxysRock, setDeoxysRockHost } from '../world/deoxysRock';
import { UseRegisteredKeyItemOnField } from '../menus/registeredItem';
import { activeFieldEffects, setFieldEffectScriptHost, setFieldEffectScripts } from '../world/fieldEffectScripts';
import { fieldMoveGfxSymbols, prepareFieldMoveMenu, prepareRegionMap, registerFieldMoves, setFieldMoveHost, UnlockPlayerFieldControls, UpdateEscapeWarp, type FieldMoveHost } from '../world/fieldMoves';
import { setDiveHost } from '../world/dive';
import {
  BOB_MON_ONLY,
  DestroyPlayerSurfBlob,
  GetInteractedWaterScript,
  SetPlayerSurfBlobBobState,
  SetPlayerSurfBlobInvisible,
  setSurfHost,
  StartPlayerSurfBlob,
  surfBlobProbe,
} from '../world/surf';
import { setFieldItemsHost, type FieldItemsHost } from '../world/fieldItems';
import { fishingProbe, registerFieldItems } from '../world/fishing';
import { ITEMFINDER_GFX, itemfinderProbe, registerItemfinder, setItemfinderHost } from '../world/itemfinder';
import { ClearRematchStateByTrainerId, registerVsSeeker, ResetMovementOfRematchableTrainers, setVsSeekerHost, vsSeekerBikeGraphicsId, vsSeekerProbe, type VsSeekerHost } from '../world/vsSeeker';
import { FieldFlash, FldEff_UseFlash, IsMapTypeOutdoors, Overworld_GetFlashLevel, SetDefaultFlashLevel } from '../world/flash';
import { fieldListMenuGfxSymbols, fieldListMenuProbe, type ListMenuHost } from '../ui/FieldListMenu';
import { stringWidth } from '../text/stringWidth';
import { setTrainerTowerStringWidth } from '../world/trainerTower';
import { currentTrainerTowerRecord } from '../state/trainerTowerRecord';
import { VBlankCounter1Update } from '../gba/main';
import { MultichoiceGridMenu, MultichoiceMenu } from '../ui/MultichoiceMenu';
import type { ShopFieldView } from '../menus/shop';
import { setBgMosaic } from '../world/BgMosaic';
import { initRoamerTables, roamerMove, roamerMoveToOtherLocationSet, updateLocationHistoryForRoamer } from '../world/roamer';
import { initWildPokemonArea } from '../menus/wildPokemonArea';
import { initInGameTrades } from '../script/tradeSpecials';
import {
  checkForTrainersWantingBattle,
  COLLISION_FLAG_ELEVATION_MISMATCH,
  COLLISION_FLAG_IMPASSABLE,
  COLLISION_FLAG_OBJECT,
  type TrainerApproach,
  type TrainerSeeHost,
} from '../world/trainerSee';
import { mapResetTrainerRematches, shouldEggHatch, updateHappinessStepCounter, updatePoisonStepCounter, updateVsSeekerStepCounter } from '../world/stepCounters';
import { sharedBattleData, type BattleStart } from './BattleScene';
import { softReset } from './BootScene';
import { forcedBattleTransition, logicSpeed, testEvent, testHooks, type FieldObjectProbe, type FieldProbe } from '../dev/testHooks';
import {
  GetInitialPlayerAvatarState,
  GetPlayerAvatarGraphicsIdByStateIdAndGender,
  gPlayerAvatar,
  InitPlayerAvatar,
  PLAYER_AVATAR_FLAG,
  PlayerStep,
  ResetInitialPlayerAvatarState,
  ReturnPlayerAvatarToField,
  SetPlayerAvatarTransitionFlags,
  setPlayerAvatarHost,
  StoreInitialPlayerAvatarState,
  TestPlayerAvatarFlags,
  UpdatePlayerAvatarTransitionState,
  type PlayerAvatarHost,
} from '../world/playerAvatar';
import { GetPlayerSpeed } from '../world/bike';
import { movementActionName } from '../entities/movementActions';
import type { FieldMenuStart, NamingScreenRequest } from './FieldMenuScene';
import { EnterHallOfFame } from '../menus/hallOfFame';
import { CB2_Credits, CREDITS_MAPS, creditsEnv, creditsGfxSymbols, DoCredits } from '../menus/credits';
import { configureMenuEnv } from '../menus/host';
import { setTextStrings } from '../battle/env';
import { initGbaText } from '../gba/window';
import { InitStandardTextBoxWindows, InitTextBoxGfxAndPrinters } from '../gba/menu';
import { TEXT_SPEED } from '../text/TextPrinter';
import { HALL_OF_FAME_RECORD_GFX, setHallOfFameRecordHost } from '../world/hallOfFameRecord';
import { registerSSAnne, setSSAnneHost, SS_ANNE_GFX, ssAnneProbe } from '../world/ssAnne';
import type { WarpData } from '../state/GameState';

/** GBA runs at ~59.73Hz; we tick game logic at a fixed 60Hz regardless of display refresh. */
const FRAME_MS = 1000 / 60;
const PLAYER_GFX = 'OBJ_EVENT_GFX_RED_NORMAL';
/** The camera centres on the middle of the player's tile, 8 px above its feet (ignoring jump lift). */
const CAMERA_FOLLOW_OFFSET_Y = TILE / 2;
/** Sweet Scent's red tint: over the map and its objects (all OAM priorities), under the player and the windows. */
const DEPTH_SWEET_SCENT = 1_500_000;

export interface OverworldStart {
  map: string;
  x: number;
  y: number;
  facing?: Direction;
  /** Dev: start from a story preset instead of a new game. */
  preset?: StartPreset;
  /** CONTINUE from the main menu: the save to load (CB2_ContinueSavedGame); map/x/y are unused then. */
  continueGame?: SaveData;
  /** NEW GAME after Oak's speech: the names and gender it put in gSaveBlock1/2 (NewGameInitData keeps them). */
  newGameProfile?: { playerName: string; rivalName: string; playerGender: 'male' | 'female' };
}

/** struct FieldInput: the parts ProcessPlayerFieldInput uses. */
interface FieldInput {
  pressedAButton: boolean;
  pressedStartButton: boolean;
  pressedSelectButton: boolean;
  heldDirection: boolean;
  heldDirection2: boolean;
  tookStep: boolean;
  checkStandardWildEncounter: boolean;
  dpadDirection: Direction | undefined;
}

interface Npc {
  localId: number;
  /** The loaded map whose template spawned it; it lives while that map is current or adjacent. */
  chunk: MapChunk;
  /** The template as it was at spawn, to notice when a map reload changes where it belongs. */
  spawnedAs: ObjectEventData;
  /** Its graphics id with any OBJ_EVENT_GFX_VAR_* resolved, as it was at spawn. */
  graphicsId: string;
  /** Set when its map was re-entered and its template no longer matches; respawned once off screen. */
  stale: boolean;
  brain: NpcBrain;
}

export class OverworldScene extends Phaser.Scene implements ScriptHost {
  private assets!: Assets;
  private world!: World;
  private behaviors!: Behaviors;
  private state!: GameState;
  private defines!: Defines;
  private scripts!: ScriptEngine;
  private messageBox!: MessageBox;
  private fonts!: Fonts;
  private charmap!: Charmap;
  /** A field UI overlay (start menu, notices) that owns input while open. */
  private overlay?: { tick(): boolean };
  private screenFade!: ScreenFade;
  /** The weather's gamma shift on the field's sprite sheets (world/weatherTextures.ts). */
  private weatherTextures!: WeatherTextures;
  /** WEATHER_FOG_HORIZONTAL's sprites (world/fogHorizontal.ts). */
  private fog!: FogHorizontal;
  /** The camera's left edge in world pixels as of the last camera update (cameraTop's counterpart). */
  private cameraLeft = 0;
  /**
   * The camera's top-left when InitObjectEventsLocal zeroed gTotalCameraPixelOffsetX / Y (a warp's map load,
   * ResumeMap): gSpriteCoordOffsetX / Y count the camera's movement from there.
   */
  private cameraOrigin = { left: 0, top: 0 };
  /** The field on the GBA layer, while a battle transition (or a cave's map change screen) runs. */
  private gbaScreen!: FieldGbaScreen;
  /** The L/R help system (ui/helpSystemField.ts): RunHelpSystemCallback before the field's logic each frame. */
  private help!: HelpSystemFieldHost;
  private fieldEffects!: FieldEffects;
  private doors!: FieldDoors;
  private monPic?: MonPicBox;
  /** Task_MapNamePopup, while it runs */
  private mapNamePopup?: MapNamePopup;
  private wild!: WildEncounters;
  private moneyBox?: MoneyBox;
  private coinsBox?: CoinsBox;
  /** DrawElevatorCurrentFloorWindow's window while it's up. */
  private elevatorWindow?: MenuWindow;
  /** Tasks started by specials that run on their own, after the script each frame (RunTasks). */
  private fieldTasks: FieldTask[] = [];
  /** What field_tasks.c's per-step callbacks read and change (world/fieldTasks.ts), map-local. */
  private readonly perStepCallbackHost: PerStepCallbackHost = {
    state: () => this.state,
    playerDestCoords: () => {
      const { x, y } = this.player.current; // PlayerGetDestCoords
      return { x: x - this.world.current.originX, y: y - this.world.current.originY };
    },
    metatileBehaviorAt: (x, y) => this.world.tileAt(x + this.world.current.originX, y + this.world.current.originY).behavior,
    setMetatileIdAt: (x, y, metatile) => this.setMetatile(x, y, metatile, false),
  };
  /** Flash's darkness in caves (world/flash.ts) */
  private flash!: FieldFlash;
  /** The facing a map load was asked for (undefined: GetInitialPlayerAvatarState's). */
  private arrivalFacing?: Direction;
  /** sVerticalCameraPan - 32: SetCameraPanning's offset from the standard framing. */
  private cameraPanY = 0;
  /** sHorizontalCameraPan (ShakeScreen's horizontal shake). */
  private cameraPanX = 0;
  /** sWarpDestination as set by `setwarp` (only Safari Zone's out-of-balls exit reads it so far). */
  private warpDestination?: { mapId: string; warpId: number; x: number; y: number };
  /** A fall warp's SetupWarp, which loads the destination's header before warpDestination is set. */
  private warpSetup: Promise<void> = Promise.resolve();
  /** FldEffPoison's task while it runs. */
  private poisonEffect?: FieldPoisonEffect;
  /** The approach task of the trainer that last saw the player (trainer_see.c), until it ends. */
  private trainerApproach?: TrainerApproach;
  /** LOCALID_CAMERA: the invisible object the camera follows while it pans up to a trainer. */
  private cameraObject?: ObjectEvent;
  private trainerSee!: TrainerSeeHost;
  player!: ObjectEvent;
  selectedObject?: ObjectEvent;
  private npcs: Npc[] = [];
  /**
   * Object templates per loaded map, editable by setobjectxyperm/setobjectmovementtype. The current
   * map's are reloaded from the header on entry (LoadObjEventTemplatesFromHeader), so script edits
   * only last until the map is left; a neighbour keeps the ones it had while it was current.
   */
  private templates = new Map<string, ObjectEventData[]>();
  /** OBJ_EVENT_GFX_* name by number, for resolving the values of VAR_OBJ_GFX_ID_*. */
  private graphicsIdNames = new Map<number, string>();
  /** Graphics ids already warned about as unloadable, so the per-step spawn check doesn't spam. */
  private missingSprites = new Set<string>();
  /** What objects see of the field: tile elevations and the sprite camera offset. */
  private readonly field: ObjectEventField = {
    elevationAt: (x, y) => this.world.tileAt(x, y).elevation,
    cameraTop: 0,
    groundEffects: (obj, phase) => this.groundEffects.run(obj, phase),
    startShadow: (obj) => this.fieldEffects.shadow(obj, this.defines.require(obj.info.shadowSize)), // FldEff_Shadow
  };
  private groundEffects!: GroundEffects;
  private buttons!: Input;
  private accumulator = 0;
  private busy = true;
  /** SetupWarp has run and the destination isn't loaded yet. */
  private warping = false;
  /** LockPlayerFieldControls from field tasks (a boulder push, getting off a surfing mon): a count of holders. */
  private controlsLocked = 0;
  /** Task_RunTimeBasedEvents' ambient cry data: zeroed when the task is made (ResumeMap's SetUpFieldTasks) and by
   *  ResetFieldTasksArgs (a connection). */
  private ambientCry: AmbientCryTaskData = { state: 0, delayCounter: 0 };
  /** FreezeObjectEvents from field tasks: the NPCs hold still. */
  private objectsFrozen = false;
  /** Task_QuestLogPlayback_OpenStartMenu: START cancelled a walked-into sign; open the menu once the controls are free. */
  private startMenuWhenFree = false;
  private hud!: Phaser.GameObjects.Text;

  constructor() {
    super('Overworld');
  }

  init(): void {
    this.assets = this.registry.get('assets');
    this.behaviors = new Behaviors(this.assets.behaviorIds);
    this.defines = new Defines(this.assets.scripts.defines);
    for (const [name, n] of Object.entries(this.assets.scripts.defines)) {
      if (name.startsWith('OBJ_EVENT_GFX_') && this.assets.sprites[name] && !this.graphicsIdNames.has(n)) this.graphicsIdNames.set(n, name);
    }
    this.charmap = new Charmap(this.assets.charmap);
    const a = this.assets;
    const pokemon = new PokemonData(readPokemonConstants(this.defines), a.species, a.moves, a.items, a.pokemonTables, this.charmap);
    this.state = new GameState(this.defines, a.constants.newGameFlags, pokemon, a.strings);
    setInitialMovementTypeFacing(a.constants.initialMovementTypeFacing);
  }

  async create(start: OverworldStart): Promise<void> {
    if (start.continueGame) fromSaveData(start.continueGame, this.state); // LoadSerializedGame & co. (load_save.c)
    if (start.newGameProfile) Object.assign(this.state, start.newGameProfile);
    const kb = this.input.keyboard!;
    this.buttons = new Input(this);

    this.cameras.main.setRoundPixels(true);
    this.hud = this.add.text(2, 2, '', { fontFamily: 'monospace', fontSize: '8px', color: '#fff', backgroundColor: '#0008' });
    this.hud.setScrollFactor(0).setDepth(Number.MAX_SAFE_INTEGER).setResolution(4).setVisible(false);
    kb.on('keydown-BACKTICK', () => this.hud.setVisible(!this.hud.visible));

    await this.assets.loadTextTextures(this);
    // The field shares pokemon.c functions with the battle engine (AdjustFriendship), which reads its tables.
    initBattleEnv(await sharedBattleData(), this.assets.scripts.defines, this.state.pokemon, this.state, this.charmap);
    setTextStrings(this.assets.strings); // the gText_* the field items print (a registered item needs no bag first)
    await loadMenusData('gen'); // sTMHMMoves, for BufferTMHMMoveName
    await loadSlotMachineData('gen'); // sSlotMachineIndices, for GetRandomSlotMachineId
    await loadLeagueLightingData('gen'); // the Elite Four / Champion rooms' lighting palettes and timers
    await loadWeatherData('gen'); // field_weather.c's tables
    await FogHorizontal.load(); // the fog's tiles and the weather palette
    await this.assets.loadFieldEffectTextures(this);
    const field = this.field;
    const behaviorAt = (x: number, y: number) => this.world.tileAt(x, y).behavior;
    this.fieldEffects = new FieldEffects(this, this.assets.emoticons, this.assets.fieldEffectObjects, {
      elevationAt: field.elevationAt,
      get cameraTop() {
        return field.cameraTop;
      },
      behaviors: this.behaviors,
      behaviorAt,
      objects: () => [this.player, ...this.npcs.map((n) => n.brain.obj)],
    });
    this.groundEffects = new GroundEffects({
      behaviors: this.behaviors,
      fx: this.fieldEffects,
      behaviorAt,
      define: (name) => this.defines.require(name),
      isCameraObject: (obj) => obj === this.cameraObject,
    });
    this.trainerSee = this.createTrainerSeeHost();
    const charmap = this.charmap;
    const d = this.defines;
    this.screenFade = new ScreenFade(this, {
      FADE_FROM_BLACK: d.require('FADE_FROM_BLACK'),
      FADE_TO_BLACK: d.require('FADE_TO_BLACK'),
      FADE_FROM_WHITE: d.require('FADE_FROM_WHITE'),
      FADE_TO_WHITE: d.require('FADE_TO_WHITE'),
    });
    this.setUpWeather();
    this.gbaScreen = new FieldGbaScreen(this, DEPTH_FADE + 10);
    setTransitionFieldCamera(() => this.gbaScreen.cameraPixelOffset());
    await loadGfx([...mapTransitionGfxSymbols, ...fieldListMenuGfxSymbols, ...helpMessageWindowGfxSymbols, ...museumFossilPicGfxSymbols, ...brailleCursorGfxSymbols, ...helpSystemGfxSymbols]);
    setUserFrameTypeSource(() => this.state.optionsWindowFrameType + 1); // the options' FRAME for field windows
    this.flash = new FieldFlash(this);
    this.fonts = new Fonts(this, this.assets.fonts);
    this.help = new HelpSystemFieldHost(this, DEPTH_FADE + 100, this.fonts, (str) => this.charmap.encodePlain(str), {
      mapType: () => this.world.current.data.mapType ?? '',
      surfing: () => TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG.SURFING) !== 0,
    });
    setTrainerTowerStringWidth((str) => stringWidth(this.fonts, FONT_NORMAL, str, -1)); // TT_ConvertEasyChatMessageToString
    this.messageBox = new MessageBox(this, this.fonts, this.buttons, charmap, this.state);
    registerMuseumFossilPic({ scene: this, fonts: this.fonts, input: this.buttons });
    this.scripts = new ScriptEngine(
      this.assets.scripts,
      this.defines,
      this.state,
      this.assets.strings,
      charmap,
      this.messageBox,
      this.buttons,
      this,
    );

    this.world = new World(this, this.assets);
    this.doors = new FieldDoors(this.assets.doors, {
      scene: this,
      metatileAt: (x, y) => this.world.tileAt(x, y),
      tilesetPair: (chunk) => this.assets.tilesetPair(chunk.data.tilesetPair),
      isWarpDoor: (behavior) => this.behaviors.isDoor(behavior),
    });
    initRoamerTables(this.assets.wildEncounters);
    initWildPokemonArea(this.assets.wildEncounters);
    initInGameTrades(this.assets.trades);
    this.wild = new WildEncounters(this.assets.wildEncounters, this.state, this.defines, {
      startWildBattle: (mon) => this.startWildBattle(mon),
      startRoamerBattle: (mon) => this.runWildBattle(this.defines.require('BATTLE_TYPE_ROAMER'), mon, K.MUS_VS_LEGEND), // StartRoamerBattle
    });
    const playerInfo = await this.assets.loadSprite(this, PLAYER_GFX);
    if (!playerInfo) throw new Error(`Missing player sprite ${PLAYER_GFX}`);
    this.player = new ObjectEvent(this, playerInfo, 0, 0, this.field);
    this.player.graphicsId = PLAYER_GFX;
    // The avatar's other looks (bike, surfing, field move, fishing, VS Seeker), so ObjectEventSetGraphicsId can swap at once.
    const gender = this.playerGender();
    await Promise.all([
      ...['PLAYER_AVATAR_GFX_NORMAL', 'PLAYER_AVATAR_GFX_BIKE', 'PLAYER_AVATAR_GFX_RIDE', 'PLAYER_AVATAR_GFX_FIELD_MOVE', 'PLAYER_AVATAR_GFX_FISH', 'PLAYER_AVATAR_GFX_VSSEEKER'].map((s) =>
        this.assets.loadSprite(this, GetPlayerAvatarGraphicsIdByStateIdAndGender(this.defines.require(s), gender)),
      ),
      this.assets.loadSprite(this, vsSeekerBikeGraphicsId(gender)),
    ]);
    setPlayerAvatarHost(this.createAvatarHost());
    setOverworldMusicHost({
      state: this.state,
      currentMap: () => this.world.current.data,
      playerLocal: () => this.playerLocal(),
      getLocalWildMon: () => this.wild.getLocalWildMon(),
      playerDestIsSurfable: () => this.behaviors.isSurfable(this.world.tileAt(this.player.tileX, this.player.tileY).behavior),
    });
    // Field moves: field_effect.c's script table, the moves' field side and their graphics
    setFieldEffectScripts(this.assets.fieldEffectScripts);
    setFieldEffectScriptHost({ isPhaserEffectActive: (fldeff) => this.fieldEffects.isActive(fldeff) });
    setFieldMoveHost(this.createFieldMoveHost());
    setFieldItemsHost(this.createFieldItemsHost());
    registerFieldItems();
    setVsSeekerHost(this.createVsSeekerHost());
    registerVsSeeker();
    setItemfinderHost({
      currentMap: () => this.world.current.data,
      mapHeader: (mapId) => this.world.loaded.find((c) => c.data.id === mapId)?.data,
      playerLocal: () => this.playerLocal(),
    });
    registerItemfinder();
    await loadGfx(ITEMFINDER_GFX);
    setLeagueLightingHost({
      loadBgPalette: (slot, colors) =>
        tilesetVram.loadBgPalette(this.textures, this.assets.tilesetPair(this.world.current.data.tilesetPair), slot, colors),
      paletteFadeActive: () => this.screenFade.active,
      createTask: (tick) => this.fieldTasks.push({ tick }),
    });
    registerLeagueLighting();
    setSurfHost({
      terrainAt: (x, y) => this.world.tileAt(x, y).terrain,
      createFieldEffectSprite: (fldEff, template, x, y, subpriority, callback) => this.fieldEffects.createSprite(fldEff, template, x, y, subpriority, callback),
    });
    setDiveHost({
      connections: () => this.world.current.data.connections,
      runOnDiveWarpMapScript: () => {
        const script = this.scripts.mapScript(this.world.current.name, 'MAP_SCRIPT_ON_DIVE_WARP');
        if (script) this.scripts.runImmediately(script);
      },
      setWarpDestination: (mapId, warpId, x, y) => this.setWarpDestination(mapId, warpId, x, y),
    });
    registerFieldMoves();
    await loadGfx(fieldMoveGfxSymbols());
    // FLDEFF_HALL_OF_FAME_RECORD (world/hallOfFameRecord.ts) draws at screen coordinates
    setHallOfFameRecordHost({
      scene: this,
      screenOrigin: () => ({ x: this.cameras.main.scrollX, y: this.cameras.main.scrollY }),
      cameraTop: () => this.field.cameraTop,
      partyCount: () => this.state.party.length,
    });
    await loadGfx(HALL_OF_FAME_RECORD_GFX);
    // special DoSSAnneDepartureCutscene (world/ssAnne.ts) draws at screen coordinates too
    setSSAnneHost({
      scene: this,
      screenOrigin: () => ({ x: this.cameras.main.scrollX, y: this.cameras.main.scrollY }),
      cameraTop: () => this.field.cameraTop,
      objectByLocalId: (localId) => this.npcByLocalId(localId)?.brain.obj,
    });
    registerSSAnne();
    await loadGfx(SS_ANNE_GFX);
    // Birth Island's triangle and FLDEFF_MOVE_DEOXYS_ROCK / FLDEFF_DESTROY_DEOXYS_ROCK (world/deoxysRock.ts)
    setDeoxysRockHost({
      scene: this,
      cameraOrigin: () => ({ x: (this.cameraObject ?? this.player).anchor.x - this.cameras.main.width / 2, y: this.field.cameraTop - this.cameraPanY }),
      cameraPan: () => ({ x: this.cameraPanX, y: this.cameraPanY }),
      cameraTop: () => this.field.cameraTop,
      objectByLocalId: (localId) => this.npcByLocalId(localId)?.brain.obj,
      localToWorld: (x, y) => ({ x: this.world.current.originX + x, y: this.world.current.originY + y }),
      removeObject: (localId) => this.removeObject(localId),
      setCameraPanning: (dx, dy) => this.setCameraPanning(dy, dx),
      bgWhiteFlash: () => this.screenFade.beginBlend(16, 0, 0xffffff, 0),
      paletteFadeActive: () => this.screenFade.active,
    });
    registerDeoxysRock();
    await loadGfx(DEOXYS_ROCK_GFX);
    this.cameras.main.startFollow(this.player.anchor, true, 1, 1, 0, CAMERA_FOLLOW_OFFSET_Y);

    if (start.continueGame) {
      await this.continueSavedGame(start);
    } else {
      // CB2_NewGame: NewGameInitData's gDifferentSaveFile and PlayTimeCounter_Reset, then PlayTimeCounter_Start
      gSave.differentSaveFile = true;
      PlayTimeCounter_Reset(this.state.playTime);
      PlayTimeCounter_Start(this.state.playTime);
      testHooks.applyTestOptions(this.state);
      if (start.preset) await applyStartPreset(this.state, start.preset, this.assets.scripts.healLocations);
      StopMapMusic(); // CB2_NewGame
      ResetInitialPlayerAvatarState();
      await this.enterMap(start.map, start.x, start.y, start.facing ?? 'down', true);
      // CB2_NewGame's FieldCB_WarpExitFadeFromBlack fades in with FadeScreen; the port shows the field at once, but
      // the weather's half of it runs (its InitAll and palettes: a dev start in a shaded map is shaded)
      WeatherFadeScreen(this.defines.require('FADE_FROM_BLACK'));
      this.showMapNameOnWarpArrival(undefined); // CB2_NewGame loads the map like a warp
      Overworld_PlaySpecialMapMusic(); // FieldCB_WarpExitFadeFromBlack
    }
    this.busy = false;
    testEvent('ready');
  }

  /** Dev: the S.S. Anne's departure while it runs (world/ssAnne.ts), for `__test.ssAnne()`. */
  testSSAnne() {
    return ssAnneProbe();
  }

  /** Dev: what the field is doing, for the e2e tests' `__test.field()` / `__test.idle()`. */
  testProbe(): FieldProbe | undefined {
    if (!this.player || !this.world?.current) return undefined; // still booting
    const { x, y } = this.playerLocal();
    return {
      map: this.state.currentMap,
      x,
      y,
      worldX: this.player.tileX,
      worldY: this.player.tileY,
      facing: this.player.facing,
      busy: this.busy,
      script: this.scripts.runningLabel,
      overlay: this.overlay !== undefined,
      locked: this.controlsLocked > 0,
      objectsFrozen: this.objectsFrozen,
      moving: this.player.isMoving,
      approaching: this.trainerApproach !== undefined,
      fading: this.screenFade.active,
      fadeWhite: this.screenFade.white,
      message: this.messageBox.visible ? this.messageBox.text : undefined,
      playerVisible: this.player.visible,
      doorAnimating: this.doors.running,
      fieldEffects: [...this.fieldEffects.liveEffects(), ...activeFieldEffects()],
      playerEffects: this.fieldEffects.liveEffects(this.player),
      mapNamePopup: this.mapNamePopup?.text,
      mapNamePopupHeight: this.mapNamePopup?.visibleHeight ?? 0,
      flash: { level: this.state.flashLevel, dark: this.flash.darkFraction() },
      gbaScreenBlack: this.gbaScreen.active ? this.gbaScreen.blackFraction() : undefined,
      listMenu: fieldListMenuProbe(),
      surfBlob: surfBlobProbe(),
      fishing: fishingProbe(),
      vsSeeker: vsSeekerProbe(),
      itemfinder: itemfinderProbe(),
      avatar: {
        flags: Object.keys(this.assets.scripts.defines)
          .filter((k) => k.startsWith('PLAYER_AVATAR_FLAG_') && gPlayerAvatar.flags & this.defines.require(k))
          .map((k) => k.slice('PLAYER_AVATAR_FLAG_'.length)),
        runningState: gPlayerAvatar.runningState,
        tileTransitionState: gPlayerAvatar.tileTransitionState,
        graphicsId: this.player.graphicsId,
        action: this.player.heldMovementActive ? movementActionName(this.player.movementActionId) : undefined,
        movementDirection: this.player.movementDirection,
        spriteY2: this.player.sprite.y - (this.player.feetY + this.player.lift),
        cameraPanY: this.cameraPanY,
        cameraPanX: this.cameraPanX,
      },
    };
  }

  /**
   * Dev: the league lighting for `__test.leagueLighting()`: its tasks, BG palette 7 as the field holds it, and a
   * pixel the current map's atlas drew with palette 7 (of colour index `colorIndex`; read back from the canvas).
   */
  testLeagueLighting(colorIndex?: number) {
    const pair = this.assets.tilesetPair(this.world.current.data.tilesetPair);
    return {
      tasks: leagueLightingProbe(),
      palette7: tilesetVram.bgPalette(pair.info.secondary, 7),
      pixel: tilesetVram.palettePixel(pair, 7, colorIndex),
    };
  }

  /**
   * Dev: the weather for `__test.weather()`: its state, BG palette `slot` (unfaded and as shown), a pixel the current
   * map's pair atlas drew with it (of colour index `colorIndex`; read back from the canvas) and a pixel of the
   * sprite sheet `texture` (now and as loaded).
   */
  testWeather(slot = 7, colorIndex?: number, texture?: string) {
    const pair = this.assets.tilesetPair(this.world.current.data.tilesetPair);
    return {
      ...weatherProbe(),
      unfaded: tilesetVram.bgPaletteUnfaded(pair, slot),
      palette: tilesetVram.bgPalette(slot < 7 ? pair.info.primary : pair.info.secondary, slot),
      pixel: tilesetVram.palettePixel(pair, slot, colorIndex),
      sprite: texture ? this.weatherTextures.pixel(texture) : undefined,
      fading: this.screenFade.active,
    };
  }

  /**
   * Dev: the fog for `__test.fog()`: its sprites' screen positions, the blend, the fog's colour at screen pixel
   * (px, py), gSpriteCoordOffsetX / Y as the fog takes them, and the GBA layer's semi-transparent OBJ pixels. `visible`
   * shows or hides the fog (to read the field under it).
   */
  testFog(px?: number, py?: number, visible?: boolean) {
    if (visible !== undefined) this.fog.setVisible(visible);
    return {
      ...this.fog.probe(px, py),
      spriteCoordOffset: { x: -(this.cameraLeft - this.cameraOrigin.left), y: -(this.field.cameraTop - this.cameraOrigin.top) - 40 },
      gbaSemiPixels: this.gbaScreen.semiObjPixels(),
    };
  }

  /**
   * field_weather.c on the field: the palettes the weather shifts (the current map's BG palettes through tilesetVram,
   * the sprite sheets through WeatherTextures) and FadeScreen's weather half in the screen fade.
   */
  private setUpWeather(): void {
    this.weatherTextures = WeatherTextures.for(this.textures, new Set(
      Object.entries(this.assets.fieldEffectObjects.templates)
        .filter(([, t]) => fadedFieldEffectPaletteTags().includes(t.paletteTag))
        .map(([name]) => name),
    ));
    const pair = () => this.assets.tilesetPair(this.world.current.data.tilesetPair);
    // UpdateCameraPanning: gSpriteCoordOffsetX = gTotalCameraPixelOffsetX - sHorizontalCameraPan (0 on the field),
    // gSpriteCoordOffsetY = gTotalCameraPixelOffsetY - sVerticalCameraPan (32) - 8; cameraTop has the pan in it
    const spriteCoordOffsetX = () => -(this.cameraLeft - this.cameraOrigin.left);
    const spriteCoordOffsetY = () => -(this.field.cameraTop - this.cameraOrigin.top) - 32 - 8;
    this.fog = new FogHorizontal({ scene: this, spriteCoordOffsetY });
    setWeatherHost({
      bgPaletteUnfaded: (slot) => (slot < 13 && this.world.current ? tilesetVram.bgPaletteUnfaded(pair(), slot) : undefined),
      setBgPaletteFaded: (slot, colors) => tilesetVram.loadBgPaletteFaded(this.textures, pair(), slot, colors),
      setObjPaletteGamma: (normal, alt) => this.weatherTextures.setTables(normal, alt),
      setBlendAlpha: (eva, evb) => this.fog.setBlendAlpha(eva, evb),
      createFogHorizontalSprites: () => this.fog.create(),
      destroyFogHorizontalSprites: () => this.fog.destroy(),
      spriteCoordOffsetX,
    });
    setWeatherPaletteFadeActive(() => this.screenFade.active);
    this.screenFade.weather = {
      fadeScreen: (mode) => WeatherFadeScreen(mode),
      fadeInBlend: () => WeatherFadeInBlend(),
    };
  }

  /**
   * ResumeMap's StartWeather + ResumePausedWeather (a warp's map load, a return to the field, CONTINUE), after its
   * InitObjectEventPalettes: the sprite sheets back to their colours as loaded.
   */
  private startWeatherOnResumeMap(): void {
    this.weatherTextures.reset();
    this.cameraOrigin = { left: this.cameraLeft, top: this.field.cameraTop }; // InitObjectEventsLocal
    StartWeather();
    ResumePausedWeather();
  }

  /** Dev: the current map's objects, for `__test.objects()`. */
  testObjects(): FieldObjectProbe[] {
    const cur = this.world.current;
    return this.npcs
      .filter((n) => n.chunk === cur)
      .map((n) => ({
        localId: n.localId,
        graphicsId: n.graphicsId,
        x: n.brain.obj.tileX - cur.originX,
        y: n.brain.obj.tileY - cur.originY,
        moving: n.brain.obj.isMoving,
        facing: n.brain.obj.facing,
        movementType: n.brain.movementType,
        frame: Number(n.brain.obj.sprite.frame.name),
        ...n.brain.spriteOffset,
      }));
  }

  /** Dev: the direction to push to take the warp the player stands on (stairs, arrow mats), if it is one. */
  testPushWarpDirection(): Direction | undefined {
    const here = this.world.tileAt(this.player.tileX, this.player.tileY);
    if (!this.warpAt(this.player.tileX, this.player.tileY)) return undefined;
    return (['up', 'down', 'left', 'right'] as Direction[]).find((d) => this.behaviors.isPushWarp(here.behavior, d));
  }

  /**
   * Dev: a shortest walking route (world coords) from the player to (tx, ty), by breadth-first search over
   * the same rules as canMove: collision bits, directional blocks, elevation (carried along the path as
   * ObjectEventUpdateElevation does: 15 keeps it), objects where they stand now. Ledges and warps aren't
   * stepped through, but the target itself may be a warp (a door, entered from below). Undefined if
   * there's no route within `limit` tiles searched.
   */
  testFindPath(tx: number, ty: number, limit = 20000): Direction[] | undefined {
    const key = (x: number, y: number, e: number) => `${x},${y},${e}`;
    const start = { x: this.player.tileX, y: this.player.tileY, e: this.player.currentElevation };
    const prev = new Map<string, { from: string; dir: Direction } | null>([[key(start.x, start.y, start.e), null]]);
    const queue = [start];
    const occupied = new Set(this.npcs.map((n) => `${n.brain.obj.tileX},${n.brain.obj.tileY}`));
    for (let i = 0; i < queue.length && i < limit; i++) {
      const cur = queue[i];
      const curKey = key(cur.x, cur.y, cur.e);
      if (cur.x === tx && cur.y === ty) {
        const path: Direction[] = [];
        for (let k = curKey, p = prev.get(k); p; k = p.from, p = prev.get(k)) path.unshift(p.dir);
        return path;
      }
      if ((cur.x !== start.x || cur.y !== start.y) && this.warpAt(cur.x, cur.y)) continue;
      const from = this.world.tileAt(cur.x, cur.y);
      for (const dir of ['up', 'down', 'left', 'right'] as Direction[]) {
        const { dx, dy } = DELTA[dir];
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const to = this.world.tileAt(nx, ny);
        // A door is entered by walking up into it, whatever its collision (TryDoorWarp / Task_DoorWarp).
        const door = dir === 'up' && nx === tx && ny === ty && this.behaviors.isDoor(to.behavior) && this.warpAt(nx, ny);
        if (!door && (to.collision !== 0 || this.behaviors.blocksMove(from.behavior, to.behavior, dir) || this.behaviors.isAnyJump(to.behavior))) continue;
        if (isElevationMismatchAt(cur.e, to.elevation) || occupied.has(`${nx},${ny}`)) continue;
        const e = to.elevation === 15 ? cur.e : to.elevation;
        const k = key(nx, ny, e);
        if (prev.has(k)) continue;
        prev.set(k, { from: curKey, dir });
        queue.push({ x: nx, y: ny, e });
      }
    }
    return undefined;
  }

  update(_time: number, delta: number): void {
    if (!this.player || !this.scripts || !this.world.current) return;
    this.accumulator = Math.min(this.accumulator + delta * logicSpeed, FRAME_MS * 5 * logicSpeed);
    while (this.accumulator >= FRAME_MS) {
      this.accumulator -= FRAME_MS;
      this.tick();
    }
    this.updateHud();
  }

  // ------------------------------------------------------------------ frame logic

  private tick(): void {
    this.buttons.sample();
    // CallCallbacks: RunHelpSystemCallback first; while the help is up the field's callbacks and VBlank don't run
    const help = this.help?.tick(this.buttons) ?? false;
    if (!help) this.tickField();
    PlayTimeCounter_Update(this.state.playTime); // AgbMain, once per frame
    VBlankCounter1Update(); // VBlankIntr: the Trainer Tower's timer (world/trainerTower.ts)
    AgbMainFrameEnd(!help); // the sound tasks (not while the help is up), MapMusicMain, m4aSoundMain
    if (help) return;
    this.flash.vblank(); // VBlankCB_Field's ScanlineEffect_InitHBlankDmaTransfer
    this.gbaScreen.frame(); // the GBA layer's half of the frame, when it's in use
  }

  private tickField(): void {
    // OverworldBasic's UpdateTilesetAnimations, and VBlank's transfer of what it queued. CB2_Overworld
    // removes the VBlank callback while a palette fade runs, so no frames are copied then (and on the GBA
    // layer, VBlankCB_Field does the transfer until a battle transition replaces it).
    if (!this.creditsCamera) UpdateTilesetAnimations(); // the credits run them every other frame themselves
    if (!this.screenFade.active && !this.gbaScreen.active) TransferTilesetAnimsBuffer();
    // FieldGetPlayerInput: QuestLogOverrideJoyVars replays the key that closed the last script's message.
    if (!this.scripts.running) {
      const replay = this.scripts.takeRegisteredInput();
      if (replay) this.buttons.override(replay);
    }
    // FieldInput_HandleCancelSignpost (pressedStartButton needs the player standing on a tile)
    const startPressed = this.buttons.pressed('START') && !this.player.isMoving;
    if (this.scripts.handleCancelSignpost(this.heldDirection(), this.player.facing, startPressed)) this.startMenuWhenFree = true;
    // Like the GBA, field input is only considered if the controls were free at the start of the
    // frame (CB1_Overworld checks ArePlayerFieldControlsLocked before tasks run), so the A press that
    // dismisses a message or picks EXIT on the start menu can't also start a new interaction.
    const lockedAtFrameStart = this.scripts.running || this.overlay !== undefined || this.controlsLocked > 0;
    const freeAtFrameStart = !this.busy && !lockedAtFrameStart && this.trainerApproach === undefined;
    this.trainerApproach?.tick();
    if (this.trainerApproach?.done) this.trainerApproach = undefined;
    this.scripts.tick();
    // (a task may create another, which must survive this frame's filtering)
    const tasks = this.fieldTasks;
    this.fieldTasks = [];
    this.fieldTasks = [...tasks.filter((t) => !t.tick()), ...this.fieldTasks];
    // Task_RunPerStepCallback (priority 80, created before Task_RunTimeBasedEvents): world/fieldTasks.ts
    if (!this.busy) Task_RunPerStepCallback(this.perStepCallbackHost);
    // Task_RunTimeBasedEvents (priority 80): the ambient cries, while ArePlayerFieldControlsLocked is FALSE
    if (!this.busy && !this.warping && !this.scripts.running && this.overlay === undefined && this.controlsLocked === 0 && this.trainerApproach === undefined) {
      UpdateAmbientCry(this.ambientCry);
    }
    this.flash.tick(); // UpdateFlashLevelEffect / Task_WaitForFlashUpdate (priority 80)
    WeatherTask(); // Task_WeatherInit / Task_WeatherMain (priority 80)
    this.fog.update(); // AnimateSprites' FogHorizontalSpriteCallback, against last frame's camera
    this.messageBox.tick();
    this.screenFade.tick();
    this.monPic?.tick();
    if (this.monPic?.gone) this.monPic = undefined;
    const overlay = this.overlay;
    // An overlay may hand off to another (start menu → notice); only clear it if it wasn't replaced.
    if (overlay && overlay.tick() && this.overlay === overlay) this.overlay = undefined;
    this.doors.tick(); // Task_AnimateDoor (priority 80) runs after the tasks that start it
    if (this.mapNamePopup?.tick()) this.mapNamePopup = undefined; // Task_MapNamePopup (priority 90)
    const scripted = this.scripts.running || this.overlay !== undefined || this.objectsFrozen;
    for (const n of this.npcs) {
      n.brain.paused = scripted;
      n.brain.tick();
    }
    const arrived = this.player.tick();
    this.cameraObject?.tick();
    if (arrived) this.updateObjectsForCamera(); // the camera moved a tile, scripted or not
    if (arrived && !this.scripts.running && this.overlay === undefined) this.onPlayerArrived();
    // DoCB1_Overworld (next frame's, as the GBA's CB1 sees this frame's sprite updates):
    // UpdatePlayerAvatarTransitionState and FieldGetPlayerInput run whether or not the controls are locked.
    UpdatePlayerAvatarTransitionState();
    const input = this.fieldGetPlayerInput();
    // A script or warp started this frame also blocks the player (ArePlayerFieldControlsLocked).
    const blocked = this.scripts.running || this.overlay !== undefined || this.controlsLocked > 0;
    if (!this.busy && !lockedAtFrameStart && !blocked) {
      if (this.startMenuWhenFree) {
        this.startMenuWhenFree = false;
        PlaySE(K.SE_WIN_OPEN);
        this.openStartMenu();
        return;
      }
      if (!this.processPlayerFieldInput(input)) PlayerStep(input.dpadDirection, this.buttons);
    }
    // ProcessPlayerFieldInput returned TRUE (a script, menu, warp or trainer started): LockPlayerFieldControls
    // and DismissMapNamePopup. Crossing a connection isn't one of them (the popup is reshown instead).
    if (freeAtFrameStart && (this.scripts.running || this.overlay !== undefined || this.trainerApproach !== undefined || this.warping)) {
      this.mapNamePopup?.dismiss();
    }

    // AnimateSprites runs every object's ObjectEventUpdateSubpriority against last frame's camera;
    // only then do CameraUpdate and UpdateCameraPanning move it.
    for (const n of this.npcs) n.brain.obj.updateSubpriority();
    this.player.updateSubpriority();
    this.fieldEffects.tick(); // created after the objects, so their callbacks run after the objects'
    this.poisonEffect?.tick();
    if (this.poisonEffect && !this.poisonEffect.active) this.poisonEffect = undefined;
    this.updateFieldCamera();
  }

  /**
   * gSpriteCoordOffsetY: the camera follows the player, whose feet sit at screen y 88 as on the GBA
   * (SetSpritePosToOffsetMapCoords puts them 7 tiles + 16 px down; UpdateCameraPanning subtracts the
   * 32 px vertical pan and 8). The Phaser camera is framed the same way by CAMERA_FOLLOW_OFFSET_Y.
   */
  private updateFieldCamera(): void {
    const focus = this.cameraObject ?? this.player;
    this.field.cameraTop = focus.feetY - CAMERA_FOLLOW_OFFSET_Y + this.cameraPanY - this.cameras.main.height / 2;
    this.cameraLeft = focus.anchor.x - this.cameras.main.width / 2;
  }

  /** FieldGetPlayerInput: which buttons count this frame, given where the player is in their step. */
  private fieldGetPlayerInput(): FieldInput {
    const runningState = gPlayerAvatar.runningState;
    const tileTransitionState = gPlayerAvatar.tileTransitionState;
    const { x, y } = this.player.current;
    const forcedMove = this.behaviors.isForcedMovementTile(this.world.tileAt(x, y).behavior); // GetPlayerCurMetatileBehavior
    const input: FieldInput = {
      pressedAButton: false,
      pressedStartButton: false,
      pressedSelectButton: false,
      heldDirection: false,
      heldDirection2: false,
      tookStep: false,
      checkStandardWildEncounter: false,
      dpadDirection: this.heldDirection(),
    };
    if ((tileTransitionState === K.T_TILE_CENTER && !forcedMove) || tileTransitionState === K.T_NOT_MOVING) {
      if (GetPlayerSpeed() !== K.PLAYER_SPEED_FASTEST) {
        const forced = gPlayerAvatar.flags & PLAYER_AVATAR_FLAG.FORCED;
        if (this.buttons.pressed('START') && !forced) input.pressedStartButton = true;
        if (!forced && this.buttons.pressed('SELECT')) input.pressedSelectButton = true;
        if (!forced && this.buttons.pressed('A')) input.pressedAButton = true; // (B / R: no field use yet)
      }
      if (input.dpadDirection) {
        input.heldDirection = true;
        input.heldDirection2 = true;
      }
    }
    if (!forcedMove) {
      if (tileTransitionState === K.T_TILE_CENTER && runningState === K.MOVING) input.tookStep = true;
      if (tileTransitionState === K.T_TILE_CENTER) input.checkStandardWildEncounter = true;
    }
    return input;
  }

  /**
   * ProcessPlayerFieldInput: trainers, ON_FRAME scripts, what a finished step starts (step-based scripts,
   * walking into a sign, wild encounters), then arrow/stair warps, signs, A, doors, START and SELECT (the
   * registered item), in the C's order. True when something took the controls; otherwise PlayerStep moves the
   * player.
   */
  private processPlayerFieldInput(input: FieldInput): boolean {
    this.scripts.msgSetNotSignpost(); // ResetFacingNpcOrSignpostVars
    const facing = this.player.facing;
    const { x, y } = this.player.current; // GetPlayerPosition
    const tile = this.world.tileAt(x, y);
    // CheckForTrainersWantingBattle runs on every frame the controls are free (mid-step too).
    const approach = checkForTrainersWantingBattle(this.trainerSee);
    if (approach) {
      this.trainerApproach = approach;
      testEvent('trainerApproach');
      return true;
    }
    if (this.tryOnFrameScript()) return true;
    if (input.tookStep) RunMassageCooldownStepCounter(this.state);
    if (input.tookStep) IncrementResortGorgeousStepCounter(this.state);
    if (input.tookStep) IncrementBirthIslandRockStepCount(this.state, this.world.current.data.id);
    if (input.tookStep && this.tryStartStepBasedScript(x, y, tile.behavior)) return true;
    if (input.checkStandardWildEncounter) {
      if ((!input.dpadDirection || input.dpadDirection === facing) && this.tryWalkIntoSignpost()) return true;
      if (this.wild.tryStandardWildEncounter(tile)) return true; // CheckStandardWildEncounter
    }
    const facingHeld = input.heldDirection && input.dpadDirection === facing;
    if (facingHeld && this.tryArrowWarp(x, y, tile.behavior, facing)) return true;
    if (facingHeld && this.tryWalkIntoSignpost()) return true;
    if (input.pressedAButton && this.interact()) return true;
    if (input.heldDirection2 && input.dpadDirection === facing && this.tryDoorWarp(facing)) return true;
    if (input.pressedStartButton) {
      PlaySE(K.SE_WIN_OPEN);
      this.openStartMenu();
      return true;
    }
    if (input.pressedSelectButton && UseRegisteredKeyItemOnField()) return true;
    return false;
  }

  /** TryStartStepBasedScript */
  private tryStartStepBasedScript(x: number, y: number, behavior: number): boolean {
    if (this.tryCoordEvent(x, y)) return true;
    if (this.tryStartWarpEventScript(x, y, behavior)) return true;
    // TryStartMiscWalkingScripts is dummied out
    const forced = (gPlayerAvatar.flags & PLAYER_AVATAR_FLAG.FORCED) !== 0 || this.behaviors.isForcedMovementTile(behavior);
    if (this.tryStartStepCountScript(forced)) return true;
    if (!forced && this.wild.updateRepelCounter()) return this.startFieldScript('EventScript_RepelWoreOff');
    return false;
  }

  /** TryStartWarpEventScript: warps that fire on stepping onto them. */
  private tryStartWarpEventScript(x: number, y: number, behavior: number): boolean {
    const warp = this.warpAt(x, y);
    if (!warp || !this.behaviors.isStepWarp(behavior)) return false;
    StoreInitialPlayerAvatarState();
    if (this.behaviors.is(behavior, 'FALL_WARP')) {
      // SetupWarp, then ResetInitialPlayerAvatarState and EventScript_DoFallWarp (world/fallWarp.ts)
      this.warpSetup = this.setupWarp(warp).then((dest) => {
        if (dest) this.warpDestination = dest;
      });
      ResetInitialPlayerAvatarState();
      return this.startFieldScript('EventScript_DoFallWarp');
    }
    void this.takeWarp(warp);
    return true;
  }

  /** TryArrowWarp: pushing the way an arrow mat or a directional stair warp points. */
  private tryArrowWarp(x: number, y: number, behavior: number, dir: Direction): boolean {
    const warp = this.warpAt(x, y);
    if (!warp || !this.behaviors.isPushWarp(behavior, dir)) return false;
    // A stair warp gets the player off the bike first (DoStairWarp's delay isn't ported).
    if (this.behaviors.isDirectionalStairWarp(behavior, dir) && TestPlayerAvatarFlags(PLAYER_AVATAR_FLAG.MACH_BIKE | PLAYER_AVATAR_FLAG.ACRO_BIKE)) {
      SetPlayerAvatarTransitionFlags(PLAYER_AVATAR_FLAG.ON_FOOT);
    }
    StoreInitialPlayerAvatarState();
    void this.takeWarp(warp);
    return true;
  }

  /** TryDoorWarp: holding north while facing a door with a warp on it. */
  private tryDoorWarp(dir: Direction): boolean {
    if (dir !== 'up') return false;
    const { x, y } = this.player.current;
    const door = this.world.tileAt(x, y - 1);
    const warp = this.behaviors.isDoor(door.behavior) && this.warpAt(x, y - 1);
    if (!warp) return false;
    StoreInitialPlayerAvatarState();
    this.doDoorWarp(warp);
    return true;
  }

  /**
   * A finished step onto another map's tile: LoadMapFromCameraTransition. The step's tile already
   * belongs to the new map, so the rest of the step (tookStep) is handled against it once it's loaded:
   * the player's finished held movement keeps the next free frame's tile transition state at T_TILE_CENTER.
   */
  private onPlayerArrived(): void {
    const { tileX: x, tileY: y } = this.player;
    const chunk = this.world.chunkAt(x, y);
    if (!chunk || chunk === this.world.current) return;
    this.busy = true;
    const fromMapsec = this.mapSection();
    Overworld_TryMapConnectionMusicTransition(chunk.data); // before the new map's header is loaded
    void this.world.setCurrent(chunk).then(async () => {
      InitSecondaryTilesetAnimation(this.assets.tilesetAnimInfo(chunk.data.tilesetPair).secondary);
      await this.onMapLoaded(false);
      // LoadMapFromCameraTransition (GetLastUsedWarpMapSectionId is the map just left)
      if (fromMapsec !== this.mapSection()) this.showMapNamePopup();
      this.busy = false;
    });
  }

  /** TryStartStepCountScript */
  private tryStartStepCountScript(forced: boolean): boolean {
    updateHappinessStepCounter(this.state);
    if (!forced) {
      if (updateVsSeekerStepCounter(this.state)) return this.startFieldScript('EventScript_VsSeekerChargingDone');
      if (updatePoisonStepCounter(this.state, this.world.current.data.mapType, () => this.startPoisonEffect())) {
        return this.startFieldScript('EventScript_FieldPoison');
      }
      if (shouldEggHatch(this.state)) {
        this.state.incrementGameStat(this.defines.require('GAME_STAT_HATCHED_EGGS'));
        return this.startFieldScript('EventScript_EggHatch');
      }
    }
    return this.safariZoneTakeStep();
  }

  /** SafariZoneTakeStep: the PA calls time after 600 steps. */
  private safariZoneTakeStep(): boolean {
    if (!this.state.getFlag('FLAG_SYS_SAFARI_MODE')) return false;
    if (--this.state.safariZoneStepCounter === 0) return this.startFieldScript('SafariZone_EventScript_TimesUp');
    return false;
  }

  /** FldEffPoison_Start */
  private startPoisonEffect(): void {
    this.poisonEffect = new FieldPoisonEffect((value) => setBgMosaic(this, this.world.mapLayers, value));
  }

  private startFieldScript(script: string): boolean {
    this.selectedObject = undefined;
    this.scripts.npcTextColor = 'neutral';
    return this.scripts.start(script);
  }

  /**
   * TryStartInteractionScript / GetInteractionScript: the object in front (or across a counter), then a bg
   * event, then the metatile, then the water (GetInteractedWaterScript: Surf, Waterfall; world/surf.ts).
   */
  private interact(): boolean {
    const dir = this.player.facing;
    const { dx, dy } = DELTA[dir];
    let tx = this.player.tileX + dx;
    let ty = this.player.tileY + dy;
    const behavior = this.world.tileAt(tx, ty).behavior;
    let npc = this.npcAt(tx, ty);
    if (!npc && this.behaviors.is(behavior, 'COUNTER')) npc = this.npcAt(tx + dx, ty + dy);
    if (npc) {
      const script = npc.brain.data.script;
      if (script && script !== '0x0' && script !== '0') {
        this.selectedObject = npc.brain.obj;
        this.scripts.npcTextColor = textColorFromId(npc.brain.obj.info.textColor, this.defines);
        this.state.setVar('VAR_LAST_TALKED', npc.localId);
        this.state.setVar('VAR_FACING', directionId(dir, this.defines));
        return this.startInteractionScript(script);
      }
    }
    const script = this.interactedBackgroundEventScript(behavior, dir) ?? this.interactedMetatileScript(behavior, dir) ?? GetInteractedWaterScript(behavior);
    if (!script) return false;
    this.selectedObject = undefined;
    this.scripts.npcTextColor = 'neutral';
    return this.startInteractionScript(script);
  }

  /** TryStartInteractionScript: SE_SELECT (except for the PCs), then ScriptContext_SetupScript. */
  private startInteractionScript(script: string): boolean {
    if (script !== 'PalletTown_PlayersHouse_2F_EventScript_PC' && script !== 'EventScript_PC') PlaySE(K.SE_SELECT);
    return this.scripts.start(script);
  }

  /** GetInFrontOfPlayerPosition: the tile in front, at the player's elevation unless they stand on elevation 0. */
  private inFrontOfPlayer(): { x: number; y: number; elevation: number } {
    const { dx, dy } = DELTA[this.player.facing];
    const elevation = this.world.tileAt(this.player.tileX, this.player.tileY).elevation !== 0 ? this.player.currentElevation : 0;
    return { x: this.player.tileX + dx, y: this.player.tileY + dy, elevation };
  }

  /** GetBackgroundEventAtPosition: the current map's first bg event there at this elevation (or at 0). */
  private bgEventAt(x: number, y: number, elevation: number): BgEventData | undefined {
    const cur = this.world.current;
    const lx = x - cur.originX;
    const ly = y - cur.originY;
    return cur.data.bgEvents.find((e) => e.x === lx && e.y === ly && (e.elevation === elevation || e.elevation === 0));
  }

  /** GetInteractedBackgroundEventScript: signs (by the way the player faces) and hidden items. */
  private interactedBackgroundEventScript(behavior: number, dir: Direction): string | undefined {
    const pos = this.inFrontOfPlayer();
    const bg = this.bgEventAt(pos.x, pos.y, pos.elevation);
    if (!bg) return undefined;
    if (bg.type === 'hidden_item') {
      if (bg.underfoot) return undefined;
      const flag = this.defines.require(String(bg.flag));
      this.state.setVar('VAR_0x8005', this.defines.require(String(bg.item)));
      this.state.setVar('VAR_0x8004', flag);
      this.state.setVar('VAR_0x8006', Number(bg.quantity));
      if (this.state.getFlag(flag)) return undefined;
      this.state.setVar('VAR_FACING', directionId(dir, this.defines));
      return 'EventScript_HiddenItemScript';
    }
    if (!bg.script || bg.script === '0x0') return 'EventScript_TestSignpostMsg';
    const signpostType = this.facingSignpostType(behavior, dir);
    if (!signFacingOk(String(bg.player_facing_dir ?? ''), dir)) return undefined;
    if (signpostType !== 'NA') this.scripts.msgSetSignpost();
    this.state.setVar('VAR_FACING', directionId(dir, this.defines));
    return bg.script;
  }

  /** GetInteractedMetatileScript: PCs, bookshelves and the other flavour-text metatiles. */
  private interactedMetatileScript(behavior: number, dir: Direction): string | undefined {
    this.state.setVar('VAR_FACING', directionId(dir, this.defines));
    const name = Object.keys(METATILE_SCRIPTS).find((mb) => this.behaviors.is(behavior, mb));
    if (!name) return undefined;
    const [script, needsNorth, signpost] = METATILE_SCRIPTS[name];
    if (needsNorth && dir !== 'up') return undefined;
    if (signpost) this.scripts.msgSetSignpost();
    return script;
  }

  /** GetFacingSignpostType */
  private facingSignpostType(behavior: number, dir: Direction): 'POKECENTER' | 'POKEMART' | 'INDIGO_1' | 'INDIGO_2' | 'SCRIPTED' | 'NA' {
    const b = this.behaviors;
    if (dir === 'up' && b.is(behavior, 'POKEMON_CENTER_SIGN')) return 'POKECENTER';
    if (dir === 'up' && b.is(behavior, 'POKEMART_SIGN')) return 'POKEMART';
    if (b.is(behavior, 'INDIGO_PLATEAU_SIGN_1')) return 'INDIGO_1';
    if (b.is(behavior, 'INDIGO_PLATEAU_SIGN_2')) return 'INDIGO_2';
    if (b.is(behavior, 'SIGNPOST')) return 'SCRIPTED';
    return 'NA';
  }

  /** TrySetUpWalkIntoSignpostScript: holding up or down into a sign shows it without pressing A. */
  private tryWalkIntoSignpost(): boolean {
    if (this.buttons.held('LEFT') || this.buttons.held('RIGHT')) return false;
    const dir = this.player.facing;
    if (dir === 'left' || dir === 'right') return false;
    const pos = this.inFrontOfPlayer();
    const type = this.facingSignpostType(this.world.tileAt(pos.x, pos.y).behavior, dir);
    let script: string;
    if (type === 'POKECENTER') script = 'EventScript_PokecenterSign';
    else if (type === 'POKEMART') script = 'EventScript_PokemartSign';
    else if (type === 'INDIGO_1') script = 'EventScript_Indigo_UltimateGoal';
    else if (type === 'INDIGO_2') script = 'EventScript_Indigo_HighestAuthority';
    else {
      // GetSignpostScriptAtMapPosition
      const bg = this.bgEventAt(pos.x, pos.y, pos.elevation);
      if (!bg || bg.type === 'hidden_item') return false;
      if (type !== 'SCRIPTED') return false;
      script = bg.script && bg.script !== '0x0' ? bg.script : 'EventScript_TestSignpostMsg';
    }
    // SetUpWalkIntoSignScript
    this.state.setVar('VAR_FACING', directionId(dir, this.defines));
    if (!this.startFieldScript(script)) return false;
    this.scripts.setWalkingIntoSignVars();
    this.scripts.msgSetSignpost();
    return true;
  }

  /** TryStartCoordEventScript */
  private tryCoordEvent(x: number, y: number): boolean {
    const cur = this.world.current;
    const lx = x - cur.originX;
    const ly = y - cur.originY;
    for (const e of cur.data.coordEvents) {
      if (e.type !== 'trigger' || e.x !== lx || e.y !== ly) continue;
      if (this.state.getVar(e.var) !== this.state.value(e.var_value)) continue;
      return !!e.script && e.script !== '0x0' && this.startFieldScript(e.script);
    }
    return false;
  }

  /** TryRunOnFrameMapScript */
  private tryOnFrameScript(): boolean {
    const table = this.scripts.mapScript(this.world.current.name, 'MAP_SCRIPT_ON_FRAME_TABLE');
    const script = table && this.scripts.mapScriptTable(table);
    if (!script) return false;
    return this.startFieldScript(script);
  }

  // ------------------------------------------------------------------ collision

  /**
   * GetCollisionAtCoords: COLLISION_IMPASSABLE (the collision bit, the map border, a directionally blocked
   * edge), COLLISION_ELEVATION_MISMATCH, COLLISION_OBJECT_EVENT or COLLISION_NONE. The movement range
   * check (COLLISION_OUTSIDE_RANGE) is NpcBrain's; the camera check (trackedByCamera) is covered by the
   * border, which tileAt makes impassable.
   */
  private collisionAt(obj: ObjectEvent, x: number, y: number, dir: Direction): number {
    const t = this.world.tileAt(x, y);
    if (t.collision !== 0 || this.behaviors.blocksMove(obj.currentMetatileBehavior, t.behavior, dir)) return K.COLLISION_IMPASSABLE;
    if (isElevationMismatchAt(obj.currentElevation, t.elevation)) return K.COLLISION_ELEVATION_MISMATCH;
    if (this.objectCollidesAt(obj, x, y)) return K.COLLISION_OBJECT_EVENT;
    return K.COLLISION_NONE;
  }

  /** GetCollisionInDirection == COLLISION_NONE: whether an NPC may step that way. */
  private canMove(obj: ObjectEvent, dir: Direction): boolean {
    const { dx, dy } = DELTA[dir];
    return this.collisionAt(obj, obj.tileX + dx, obj.tileY + dy, dir) === K.COLLISION_NONE;
  }

  private npcAt(x: number, y: number): Npc | undefined {
    return this.npcs.find((n) => n.brain.obj.tileX === x && n.brain.obj.tileY === y);
  }

  // ------------------------------------------------------------------ maps & warps

  private warpAt(wx: number, wy: number): WarpEventData | undefined {
    const cur = this.world.current;
    return cur.data.warpEvents.find((w) => w.x === wx - cur.originX && w.y === wy - cur.originY);
  }

  /**
   * SetupWarp (field_control_avatar.c): the warp destination (SetWarpDestinationToDynamicWarp / ToMapWarp),
   * UpdateEscapeWarp, and SetDynamicWarp into a map whose matching warp is dynamic. Undefined if unsupported.
   */
  private async setupWarp(w: WarpEventData): Promise<{ mapId: string; warpId: number; x: number; y: number } | undefined> {
    if (w.dest_map === 'MAP_DYNAMIC') {
      const dyn = this.state.dynamicWarp;
      if (!dyn || !this.assets.mapNameForId(dyn.mapId)) {
        console.warn('[warp] no dynamic warp set');
        return undefined;
      }
      return { ...dyn };
    }
    const name = this.assets.mapNameForId(w.dest_map);
    const destIndex = Number(w.dest_warp_id);
    if (!name || !Number.isInteger(destIndex)) {
      console.warn('[warp] unsupported destination', w.dest_map, w.dest_warp_id);
      return undefined;
    }
    const cur = this.world.current;
    const { tileX: x, tileY: y } = this.player; // gSaveBlock1Ptr->pos
    const destData = await this.assets.loadMap(name);
    UpdateEscapeWarp(this.mapType(cur.data), this.mapType(destData), w.x, w.y);
    if (destData.warpEvents[destIndex]?.dest_map === 'MAP_DYNAMIC') {
      this.state.dynamicWarp = { mapId: cur.data.id, warpId: cur.data.warpEvents.indexOf(w), x: x - cur.originX, y: y - cur.originY };
    }
    return { mapId: w.dest_map, warpId: destIndex, x: -1, y: -1 };
  }

  /** SetupWarp, then the warp (`kind`: see warpTo). */
  private async takeWarp(w: WarpEventData, kind: WarpKind = 'warp'): Promise<void> {
    // Lock the controls now: the destination may still be loading on the next frames, and a held push
    // direction (stairs, arrow mats) must not set up the same warp again meanwhile.
    this.busy = true;
    this.warping = true;
    const dest = await this.setupWarp(w);
    const name = dest && this.assets.mapNameForId(dest.mapId);
    if (!dest || !name) {
      this.busy = false;
      this.warping = false;
      return;
    }
    await this.warpTo(name, dest.warpId, dest.x, dest.y, kind);
  }

  /**
   * DoDoorWarp → Task_DoorWarp (field_fadetransition.c): the door opens, the player walks in, the door
   * closes behind them, then the warp's fade. Runs as an overlay, which freezes the other objects and
   * the player's input like FreezeObjectEvents / LockPlayerFieldControls.
   */
  private doDoorWarp(warp: WarpEventData): void {
    const { tileX: x, tileY: y } = this.player; // PlayerGetDestCoords
    let state = 0;
    this.overlay = {
      tick: () => {
        switch (state) {
          case 0:
            PlaySE(this.doors.getDoorSoundEffect(x, y - 1)); // GetDoorSoundEffect
            this.doors.animateOpen(x, y - 1);
            state = 1;
            break;
          case 1:
            if (!this.doors.running) {
              this.player.move('up'); // MOVEMENT_ACTION_WALK_NORMAL_UP
              state = 2;
            }
            break;
          case 2:
            if (!this.player.isMoving) {
              this.doors.animateClose(x, y - 1);
              this.player.setVisible(false);
              state = 3;
            }
            break;
          case 3:
            if (!this.doors.running) state = 4;
            break;
          case 4:
            // TryFadeOutOldMapMusic, WarpFadeOutScreen, then Task_Teleport2Warp's WarpIntoMap
            void this.takeWarp(warp, 'door');
            return true;
        }
        return false;
      },
    };
  }

  /**
   * Task_ExitDoor: arriving on a door, the player is hidden while the barn door wipe opens and the screen
   * fades in (WarpFadeInScreenWithDelay); 25 frames on the door opens, the player walks out, and 14 frames
   * into the step it closes again. Case 5 runs at once (the screen is still filled).
   */
  private exitDoor(isExit: boolean): void {
    let state = 5;
    let delay = 0; // data[15]
    let walkFrames = 0; // data[14]
    let doorX = 0;
    let doorY = 0;
    // case 5
    this.player.setVisible(false); // FreezeObjectEvents: the overlay
    const wipe = new BarnDoorWipe(this); // DoOutwardBarnDoorWipe
    testEvent('barnDoorWipe');
    this.warpFadeInScreen(isExit, 3); // WarpFadeInScreenWithDelay
    state = 6;
    this.overlay = {
      tick: () => {
        switch (state) {
          case 6:
            if (++delay === 25) {
              PlaySE(this.doors.getDoorSoundEffect(this.player.tileX, this.player.tileY));
              this.doors.animateOpen(this.player.tileX, this.player.tileY);
              state = 7;
            }
            break;
          case 7:
            if (!this.doors.running) {
              doorX = this.player.tileX;
              doorY = this.player.tileY;
              this.player.setVisible(true);
              this.player.move('down'); // MOVEMENT_ACTION_WALK_NORMAL_DOWN
              state = 8;
            }
            break;
          case 8:
            if (++walkFrames === 14) {
              this.doors.animateClose(doorX, doorY);
              state = 9;
            }
            break;
          case 9:
            // FieldFadeTransitionBackgroundEffectIsFinished, !FuncIsActiveTask(Task_BarnDoorWipe)
            if (!this.screenFade.active && !this.player.isMoving && !this.doors.running && wipe.done) return true; // case 4
            break;
        }
        if (!wipe.done) wipe.tick(); // Task_BarnDoorWipe (priority 80) runs after Task_ExitDoor
        return false;
      },
    };
  }

  /** The MAP_TYPE_* of a map's header. */
  private mapType(data: MapData): number {
    return this.defines.get(data.mapType ?? '') ?? 0;
  }

  /**
   * WarpFadeOutScreen: to white when entering a cave (MapTransitionIsEnter), else to black, which is also
   * used into another region map section with a cave preview screen. Returns whether it fades to white.
   */
  private warpFadeOutScreen(from: MapData, to: MapData): boolean {
    const d = this.defines;
    const toMapsec = to.regionMapSection ?? 'MAPSEC_NONE';
    const white = toMapsec !== (from.regionMapSection ?? 'MAPSEC_NONE') && MapHasCavePreviewScreen(toMapsec) ? false : MapTransitionIsEnter(this.mapType(from), this.mapType(to));
    this.screenFade.begin(d.require(white ? 'FADE_TO_WHITE' : 'FADE_TO_BLACK'));
    return white;
  }

  /** WarpFadeInScreen / WarpFadeInScreenWithDelay: from white when leaving a cave (MapTransitionIsExit), else from black. */
  private warpFadeInScreen(isExit: boolean, delay = 0): void {
    this.screenFade.fill(isExit); // palette_bg_faded_fill_white / _black
    this.screenFade.begin(this.defines.require(isExit ? 'FADE_FROM_WHITE' : 'FADE_FROM_BLACK'), delay);
  }

  /** Resolves on the first frame (tick) on which `done` holds. */
  private waitFrames(done: () => boolean): Promise<void> {
    return new Promise((resolve) => {
      this.fieldTasks.push({
        tick: () => {
          if (!done()) return false;
          resolve();
          return true;
        },
      });
    });
  }

  /**
   * CB2_LoadMap → CB2_DoChangeMap: in and out of caves, a flash transition on the GBA layer between the
   * fade out (`fadedWhite`: to white) and the new map.
   */
  private async doChangeMap(from: MapData, to: MapData, fadedWhite: boolean): Promise<void> {
    const change = { fromType: this.mapType(from), toType: this.mapType(to), fromMapsec: from.regionMapSection ?? 'MAPSEC_NONE', toMapsec: to.regionMapSection ?? 'MAPSEC_NONE' };
    this.gbaScreen.startBare();
    CB2_DoChangeMap(change, fadedWhite ? RGB_WHITE : RGB_BLACK);
    if (!IsChangeMapDone()) {
      testEvent('mapTransition', { from: from.name, to: to.name });
      await this.waitFrames(IsChangeMapDone);
    }
    this.gbaScreen.stop();
  }

  /**
   * Warp to a warp event index, or to explicit coordinates when warpId < 0. `kind`: 'warp' is DoWarp (stepping onto
   * a warp, arrow mats, stairs, `warp`: SE_EXIT), 'silent' DoDiveWarp (`warpsilent`), 'door' Task_DoorWarp's case 4
   * (after the door's SE and walk in; `warpdoor`). Each starts TryFadeOutOldMapMusic with the fade out, and
   * Task_Teleport2Warp waits for both (WaitWarpFadeOutScreen, BGMusicStopped): 32 or 64 more frames when the music
   * changes.
   */
  private async warpTo(name: string, warpId: number, x: number, y: number, kind: WarpKind = 'warp'): Promise<void> {
    this.busy = true;
    const from = this.world.current.data;
    const data = await this.assets.loadMap(name);
    TryFadeOutOldMapMusic(data);
    const white = this.warpFadeOutScreen(from, data);
    // PlayRainStoppingSoundEffect: no field weather yet
    if (kind === 'warp') PlaySE(K.SE_EXIT);
    await this.waitFrames(() => !this.screenFade.active && BGMusicStopped());
    const isExit = await this.loadWarpedMap(name, warpId, x, y, white);
    await this.defaultWarpExit(isExit);
    this.busy = false;
  }

  /**
   * FieldCB_DefaultWarpExit → SetUpWarpExitTask: a door (MetatileBehavior_IsWarpDoor_2) gets Task_ExitDoor;
   * otherwise ExitWarpFadeInScreen(FALSE) and a task that waits for the fade.
   */
  private async defaultWarpExit(isExit: boolean): Promise<void> {
    Overworld_PlaySpecialMapMusic();
    const arrival = this.world.tileAt(this.player.tileX, this.player.tileY);
    if (this.behaviors.isDoor(arrival.behavior)) this.exitDoor(isExit);
    else this.warpFadeInScreen(isExit);
    await this.waitFrames(() => !this.screenFade.active);
  }

  /**
   * CB2_LoadMap from the faded-out screen (`white`): the map transition, the new map and its name popup.
   * Returns MapTransitionIsExit, for the fade in that the warp's field callback does.
   */
  private async loadWarpedMap(name: string, warpId: number, x: number, y: number, white: boolean): Promise<boolean> {
    this.busy = true;
    const from = this.world.current.data;
    const data = await this.assets.loadMap(name);
    this.messageBox.hide(); // CB2_LoadMap frees the field's windows (the Escape Rope's message is still up)
    await this.doChangeMap(from, data, white);
    const dest = warpDestCoords(data, warpId, x, y);
    await this.enterMap(name, dest.x, dest.y, undefined, true);
    this.showMapNameOnWarpArrival(from);
    return MapTransitionIsExit(this.mapType(from), this.mapType(data));
  }

  /**
   * LoadMapInStepsLocal's state 12: into another region map section with a forest preview screen,
   * MapPreview_StartForestTransition (not ported, so nothing is shown); else the map name popup if the
   * header asks for one.
   */
  private showMapNameOnWarpArrival(from: MapData | undefined): void {
    const to = this.world.current.data;
    const fromMapsec = from?.regionMapSection ?? 'MAPSEC_NONE';
    if (fromMapsec !== this.mapSection() && MapHasForestPreviewScreen(this.mapSection())) return;
    if (to.showMapName) this.showMapNamePopup();
  }

  /** ShowMapNamePopup: start Task_MapNamePopup, or have the running one slide out and back with the new name. */
  private showMapNamePopup(): void {
    if (this.state.getFlag('FLAG_DONT_SHOW_MAP_NAME_POPUP')) return;
    if (this.mapNamePopup && !this.mapNamePopup.closing) {
      this.mapNamePopup.reshowName();
      return;
    }
    // A task already clearing its window has no window left to reprint into; start over.
    this.mapNamePopup?.destroy();
    this.mapNamePopup = new MapNamePopup(this, this.fonts, this.buttons, this.charmap, this.assets.strings, () => ({
      mapsec: this.defines.require(this.mapSection()),
      floorNum: this.world.current.data.floorNumber,
    }));
    testEvent('mapNamePopup', { map: this.state.currentMap });
  }

  /** Load a map fresh (origin at 0,0) and put the player at local (x, y). */
  /**
   * `facing`: the direction to face on arrival, or undefined for the one GetInitialPlayerAvatarState
   * picks (by the arrival tile: south out of doors, north off a mat, ...).
   */
  private async enterMap(name: string, x: number, y: number, facing: Direction | undefined, warped: boolean, continued?: PlayerLocation): Promise<void> {
    this.warping = false;
    this.mapNamePopup?.destroy(); // the map load's ResetTasks
    ResetLeagueLightingTasks();
    ResetWeatherTask(); // (GBA tasks don't run between LoadMapFromWarp's scripts and ResumeMap's StartWeather)
    this.mapNamePopup = undefined;
    this.fieldEffects.clear();
    this.doors.clear();
    this.trainerApproach = undefined;
    this.removeCameraObject();
    this.objectsFrozen = false; // the map's objects are created anew
    await this.world.load(name);
    const anims = this.assets.tilesetAnimInfo(this.world.current.data.tilesetPair);
    InitTilesetAnimations(anims.primary, anims.secondary);
    this.player.setVisible(true); // the GBA recreates the player object on every warp
    this.player.setPosition(x, y); // also updates elevation and priority, as on spawn
    this.updateFieldCamera(); // the warp resets the camera onto the player
    this.player.updateSubpriority();
    this.arrivalFacing = facing;
    await this.onMapLoaded(warped, continued);
  }

  /**
   * InitObjectEventsLocal's player part: InitPlayerAvatar facing the way GetInitialPlayerAvatarState
   * says (or `arrivalFacing`), with the state the warp brought along (on the bike, surfing), then
   * ResetInitialPlayerAvatarState.
   */
  private initPlayerAvatarOnWarp(): void {
    const data = this.world.current.data;
    const { x, y } = this.player.current;
    const initial = GetInitialPlayerAvatarState(this.mapType(data), this.world.tileAt(x, y).behavior, data.id);
    InitPlayerAvatar(this.arrivalFacing ?? initial.direction, this.playerGender(), initial.transitionFlags);
    ResetInitialPlayerAvatarState();
  }

  /** gSaveBlock2Ptr->playerGender as MALE / FEMALE */
  private playerGender(): number {
    return this.defines.require(this.state.playerGender === 'female' ? 'FEMALE' : 'MALE');
  }

  /**
   * Before a save (state/saveData.ts): what gSaveBlock1Ptr->location / pos and the saved player object hold:
   * the current map, the player's map-local tile, facing and avatar state (SaveObjectEvents).
   */
  storeLocationForSave(): void {
    const cur = this.world.current;
    const F = PLAYER_AVATAR_FLAG;
    this.state.location = {
      mapId: cur.data.id,
      x: this.player.tileX - cur.originX,
      y: this.player.tileY - cur.originY,
      facing: this.player.facing,
      avatarFlags: gPlayerAvatar.flags & (F.ON_FOOT | F.MACH_BIKE | F.ACRO_BIKE | F.SURFING),
      mapLayoutId: this.state.mapLayoutId,
    };
  }

  /**
   * Map entry sequence: templates reloaded, temps cleared, ON_TRANSITION, ON_LOAD, objects spawned, ON_WARP_INTO.
   * `continued` (CONTINUE: CB2_ContinueSavedGame's InitMapFromSavedGame) runs only ON_LOAD, keeps the saved temps
   * and flash level, and puts the player back as saved.
   */
  private async onMapLoaded(warped: boolean, continued?: PlayerLocation): Promise<void> {
    const cur = this.world.current;
    const name = cur.name;
    await this.preloadMapSprites();
    this.templates.set(name, cur.data.objectEvents.map((e) => ({ ...e }))); // LoadObjEventTemplatesFromHeader
    this.state.currentMap = name;
    this.state.currentMapId = cur.data.id;
    this.state.currentMapSection = this.mapSection();
    this.state.mapHeaderLayoutId = this.defines.require(cur.data.layoutId); // gMapHeader (LoadCurrentMapData)
    testEvent('map', { map: name });
    SetMapHeaderWeather(this.defines.require(cur.data.weather ?? 'WEATHER_NONE')); // LoadCurrentMapData's gMapHeader
    // A warp's (and CONTINUE's) ResumeMap makes a new Task_RunTimeBasedEvents; a connection's ResetFieldTasksArgs zeroes it
    this.ambientCry = { state: 0, delayCounter: 0 };
    if (!continued) {
      this.state.clearTemps();
      this.wild.resetEncounterRateModifiers(); // RestartWildEncounterImmunitySteps
      mapResetTrainerRematches(this.state);
      ResetMovementOfRematchableTrainers();
      // LoadMapFromWarp / LoadMapFromCameraTransition
      SetSavedWeatherFromCurrMapHeader();
      ChooseAmbientCrySpecies();
      updateLocationHistoryForRoamer(this.state);
      if (warped) roamerMoveToOtherLocationSet(this.state);
      else roamerMove(this.state);
      if (warped && IsMapTypeOutdoors(cur.data.mapType)) this.state.setFlag('FLAG_SYS_FLASH_ACTIVE', false);
      SetDefaultFlashLevel(this.state, cur.data.cave);
      this.state.mapLayoutId = this.defines.require(cur.data.layoutId); // LoadCurrentMapData
      Overworld_ClearSavedMusic(); // before RunOnTransitionMapScript (Cycling Road's sets it again)
      const transition = this.scripts.mapScript(name, 'MAP_SCRIPT_ON_TRANSITION');
      if (transition) this.scripts.runImmediately(transition);
    } else {
      this.state.mapLayoutId = continued.mapLayoutId ?? this.defines.require(cur.data.layoutId); // LoadSaveblockMapHeader
    }
    await this.initMapLayout();
    const load = this.scripts.mapScript(name, 'MAP_SCRIPT_ON_LOAD');
    if (load) this.scripts.runImmediately(load);
    await this.preloadMapSprites(); // again, now the map scripts have set any VAR_OBJ_GFX_ID_*
    if (!continued) {
      // LoadMapInStepsLocal's ResumeMap / LoadMapFromCameraTransition's RunOnResumeMapScript (CONTINUE runs it from
      // resumeMap). A warp then reloads the BG palettes (LoadMapTilesetPalettes, after it); a connection loaded
      // the secondary's before it (LoadSecondaryTilesetPalette).
      if (!warped) {
        tilesetVram.resetBgPalettes();
        // LoadMapFromCameraTransition: ApplyWeatherGammaShiftToPal on the reloaded palettes, then DoCurrentWeather
        ApplyWeatherGammaShiftToBgPals();
        DoCurrentWeather();
      } else {
        this.startWeatherOnResumeMap();
      }
      if (warped) SetUpFieldTasks(); // ResumeMap's ResetTasks + SetUpFieldTasks (a connection keeps the task)
      const resume = this.scripts.mapScript(name, 'MAP_SCRIPT_ON_RESUME');
      if (resume) this.scripts.runImmediately(resume);
      if (warped) tilesetVram.resetBgPalettes();
    }
    if (warped || continued) this.clearNpcs(); // ResetObjectEvents
    if (warped) this.initPlayerAvatarOnWarp();
    if (continued) {
      // The saved player object (LoadObjectEvents) and SpawnObjectEventsOnReturnToField: its graphics give the state
      const F = PLAYER_AVATAR_FLAG;
      const flags = continued.avatarFlags;
      const state = flags & F.MACH_BIKE ? F.MACH_BIKE : flags & F.ACRO_BIKE ? F.ACRO_BIKE : flags & F.SURFING ? F.SURFING : F.ON_FOOT;
      InitPlayerAvatar(continued.facing, this.playerGender(), state);
    }
    if (warped || continued) SetHelpContextForMap(); // LoadMapInStepsLocal's (ReturnToFieldLocal's), after the objects
    this.syncNpcsWithLoadedMaps();
    if (warped) {
      const table = this.scripts.mapScript(name, 'MAP_SCRIPT_ON_WARP_INTO_MAP_TABLE');
      const script = table && this.scripts.mapScriptTable(table);
      if (script) this.scripts.runImmediately(script);
    }
    // LoadMapInStepsLocal's (ReturnToFieldLocal's) InitCurrentFlashLevelScanlineEffect (a connection keeps the running effect)
    if (warped || continued) this.flash.initCurrentFlashLevelScanlineEffect(Overworld_GetFlashLevel(this.state));
  }

  /**
   * InitMap's InitMapLayoutData with gMapHeader.mapLayout = GetMapLayout(): when an ON_TRANSITION script's
   * `setmaplayoutindex` (or the save) names another layout than the header's, the map takes that one's grid.
   */
  private async initMapLayout(): Promise<void> {
    const cur = this.world.current;
    if (this.state.mapLayoutId === this.defines.require(cur.data.layoutId)) return;
    const id = Object.entries(this.assets.scripts.defines).find(([k, v]) => k.startsWith('LAYOUT_') && v === this.state.mapLayoutId)?.[0];
    if (!id) {
      console.warn('[map] unknown layout', this.state.mapLayoutId);
      return;
    }
    const layout = await this.assets.loadLayout(id);
    await this.world.setCurrentLayout(layout);
    if (layout.tilesetPair !== cur.data.tilesetPair) {
      const anims = this.assets.tilesetAnimInfo(layout.tilesetPair);
      InitTilesetAnimations(anims.primary, anims.secondary);
    }
  }

  /**
   * CB2_ContinueSavedGame, once the main menu's CONTINUE has loaded the save into the state: ResetMenuAndMonGlobals'
   * gDifferentSaveFile, Overworld_ResetStateOnContinue and PlayTimeCounter_Start, then either the continue-game
   * warp (UseContinueGameWarp: WarpIntoMap + CB2_LoadMap, FieldCB_DefaultWarpExit) or the saved map and position
   * (InitMapFromSavedGame, CB2_ReturnToField's ResumeMap and return-to-field scripts, FieldCB_ShowMapNameOnContinue).
   */
  private async continueSavedGame(start: OverworldStart): Promise<void> {
    const s = this.state;
    gSave.differentSaveFile = false;
    StopMapMusic(); // CB2_ContinueSavedGame
    // A save always has a location (the save dialog stores it); `start` is only a fallback.
    const loc = s.location ?? { mapId: '', x: start.x, y: start.y, facing: start.facing ?? 'down', avatarFlags: PLAYER_AVATAR_FLAG.ON_FOOT };
    // LoadSaveblockMapHeader, then Overworld_ResetStateOnContinue
    s.currentMapId = loc.mapId;
    s.setFlag('FLAG_SYS_SAFARI_MODE', false);
    s.setVar('VAR_MAP_SCENE_FUCHSIA_CITY_SAFARI_ZONE_ENTRANCE', 0);
    ChooseAmbientCrySpecies();
    updateLocationHistoryForRoamer(s);
    roamerMoveToOtherLocationSet(s);
    PlayTimeCounter_Start(s.playTime);
    // gExitStairsMovementDisabled = TRUE: the port has no Task_ExitStairs
    if (UseContinueGameWarp(s) && s.continueGameWarp) {
      ClearContinueGameWarpStatus(s);
      const w = s.continueGameWarp;
      const name = this.assets.mapNameForId(w.mapId) ?? start.map;
      const dest = warpDestCoords(await this.assets.loadMap(name), w.warpId, w.x, w.y);
      ResetInitialPlayerAvatarState();
      await this.enterMap(name, dest.x, dest.y, undefined, true);
      this.showMapNameOnWarpArrival(undefined);
      // FieldCB_DefaultWarpExit → SetUpWarpExitTask(FALSE)
      Overworld_PlaySpecialMapMusic();
      if (this.behaviors.isDoor(this.world.tileAt(this.player.tileX, this.player.tileY).behavior)) this.exitDoor(false);
      else this.warpFadeInScreen(false);
    } else {
      const name = this.assets.mapNameForId(loc.mapId) ?? start.map;
      await this.enterMap(name, loc.x, loc.y, loc.facing, false, loc);
      this.resumeMap(); // ResumeMap's RunOnResumeMapScript, ReloadObjectsAndRunReturnToFieldMapScript
      // FieldCB_ShowMapNameOnContinue, then FieldCB_WarpExitFadeFromBlack → SetUpWarpExitTask(TRUE): FadeInFromBlack
      if (this.world.current.data.showMapName) this.showMapNamePopup();
      Overworld_PlaySpecialMapMusic();
      this.warpFadeInScreen(false);
    }
    // Task_ExitNonDoor: the controls stay locked until the fade is done
    if (!this.overlay) this.overlay = { tick: () => !this.screenFade.active };
  }

  /** A loaded map's templates; a neighbour that was never current starts from its header. */
  private templatesFor(chunk: MapChunk): ObjectEventData[] {
    let t = this.templates.get(chunk.name);
    if (!t) {
      t = chunk.data.objectEvents.map((e) => ({ ...e }));
      this.templates.set(chunk.name, t);
    }
    return t;
  }

  /**
   * Load the sprite sheet of every object the loaded maps might show, including currently hidden
   * ones, so that `addobject` can spawn synchronously mid-script (as on the GBA).
   */
  private async preloadMapSprites(): Promise<void> {
    const ids = new Set(this.world.loaded.flatMap((c) => c.data.objectEvents.map((e) => this.resolveGraphicsId(e.graphics_id))));
    await Promise.all([...ids].map((id) => this.assets.loadSprite(this, id)));
  }

  /** OBJ_EVENT_GFX_VAR_0..F: the graphics id is whatever a map script put in VAR_OBJ_GFX_ID_0..F. */
  private isDynamicGraphicsId(id: string): boolean {
    return (this.defines.get(id) ?? 0) >= this.defines.require('OBJ_EVENT_GFX_VARS');
  }

  /** SetObjectEventDynamicGraphicsId / GetObjectEventGraphicsInfo (out-of-range ids become LITTLE_BOY). */
  private resolveGraphicsId(id: string): string {
    if (!this.isDynamicGraphicsId(id)) return id;
    const n = this.defines.require(id) - this.defines.require('OBJ_EVENT_GFX_VARS');
    const gfx = this.state.getVar(this.defines.require('VAR_OBJ_GFX_ID_0') + n); // VarGetObjectEventGraphicsId
    return this.graphicsIdNames.get(gfx) ?? 'OBJ_EVENT_GFX_LITTLE_BOY';
  }

  private clearNpcs(): void {
    for (const n of this.npcs) n.brain.obj.destroy();
    this.npcs = [];
  }

  /** Objects are addressed by local id within the current map (GetObjectEventIdByLocalIdAndMap). */
  private npcByLocalId(localId: number, chunk = this.world.current): Npc | undefined {
    return this.npcs.find((n) => n.localId === localId && n.chunk === chunk);
  }

  /**
   * QOL (not the GBA): objects of the current map *and its connected neighbours* are spawned, so
   * what's on screen across a seam is populated. The GBA only spawns the current map's objects in
   * the view window (TrySpawnObjectEvents) and leaves the old map's until they scroll off
   * (RemoveObjectEventsOutsideView), so neighbours' objects pop in at the crossing.
   * Run after every map load: drops objects (and templates) of maps no longer loaded, marks the
   * current map's objects stale where the reloaded templates disagree, then spawns what's missing.
   */
  private syncNpcsWithLoadedMaps(): void {
    const loaded = this.world.loaded;
    for (const name of this.templates.keys()) {
      if (!loaded.some((c) => c.name === name)) this.templates.delete(name);
    }
    const cur = this.world.current;
    this.npcs = this.npcs.filter((n) => {
      if (loaded.includes(n.chunk)) return true;
      n.brain.obj.destroy();
      return false;
    });
    const templates = this.templatesFor(cur);
    for (const n of this.npcs) {
      if (n.chunk !== cur) continue;
      const t = templates[n.localId - 1];
      if (!t || this.isHidden(t) || !sameSpawn(n.spawnedAs, t) || this.resolveGraphicsId(t.graphics_id) !== n.graphicsId) {
        n.stale = true;
      }
    }
    this.updateObjectsForCamera();
  }

  /**
   * Each camera step: respawn stale objects once they're off screen (so a template change made by
   * the map's ON_TRANSITION never visibly teleports anyone), then spawn any loaded map's object
   * that isn't out yet and whose hide flag is clear. The latter is TrySpawnObjectEvents minus the
   * view check; it's how scripts bring an object back after `removeobject` + `clearflag`.
   */
  private updateObjectsForCamera(): void {
    const { tileX: px, tileY: py } = this.player;
    this.npcs = this.npcs.filter((n) => {
      if (!n.stale || onScreen(n.brain.obj.tileX, n.brain.obj.tileY, px, py)) return true;
      n.brain.obj.destroy();
      return false;
    });
    for (const chunk of this.world.loaded) {
      this.templatesFor(chunk).forEach((t, i) => {
        const localId = i + 1;
        if (this.npcByLocalId(localId, chunk)) return;
        const n = this.spawnNpc(t, localId, chunk);
        if (n) this.npcs.push(n);
      });
    }
  }

  private isHidden(e: ObjectEventData): boolean {
    return !!e.flag && e.flag !== '0' && this.state.getFlag(e.flag);
  }

  private spawnNpc(e: ObjectEventData, localId: number, chunk = this.world.current): Npc | undefined {
    if (e.type !== 'object' || e.movement_type === 'MOVEMENT_TYPE_INVISIBLE') return undefined;
    if (this.isHidden(e)) return undefined;
    // A neighbour's VAR_OBJ_GFX_ID_* are only set by its own ON_TRANSITION, so its dynamic-graphics
    // objects wait until it becomes the current map (as on the GBA, where neighbours never spawn).
    if (chunk !== this.world.current && this.isDynamicGraphicsId(e.graphics_id)) return undefined;
    const graphicsId = this.resolveGraphicsId(e.graphics_id);
    const info = this.assets.sprites[graphicsId];
    if (!info || !this.textures.exists(spriteTextureKey(info))) {
      if (!this.missingSprites.has(graphicsId)) console.warn(`[overworld] no sprite loaded for ${graphicsId} (${e.graphics_id})`);
      this.missingSprites.add(graphicsId);
      return undefined;
    }
    const obj = new ObjectEvent(this, info, chunk.originX + e.x, chunk.originY + e.y, this.field, e.elevation);
    obj.graphicsId = graphicsId;
    obj.updateElevationAndPriority(); // DoGroundEffects_OnSpawn
    const data = { ...e };
    return { localId, chunk, spawnedAs: data, graphicsId, stale: false, brain: new NpcBrain(obj, data, (o, d) => this.canMove(o, d)) };
  }

  // ------------------------------------------------------------------ UI

  /**
   * The start menu. `fadingIn`: reopened by FieldCB_ReturnToFieldOpenStartMenu, so input waits for
   * the fade from black (FadeTransition_FadeInOnReturnToStartMenu).
   */
  private openStartMenu(fadingIn = false): void {
    const menu = new StartMenu(this, this.fonts, this.buttons, this.charmap, this.assets.strings, this.state);
    this.overlay = {
      tick: () => {
        if (fadingIn && this.screenFade.active) return false;
        const r = menu.tick();
        if (r === undefined) return false;
        if (r === 'POKEDEX') this.openFieldMenu('pokedex');
        else if (r === 'POKEMON') this.openFieldMenu('party');
        else if (r === 'BAG') this.openFieldMenu('bag');
        else if (r === 'OPTION') this.openFieldMenu('options'); // StartMenuOptionCallback
        else if (r === 'PLAYER') this.openFieldMenu('trainerCard'); // StartMenuPlayerCallback
        else if (r === 'RETIRE') this.startFieldScript('SafariZone_EventScript_RetirePrompt'); // SafariZoneRetirePrompt
        else if (r === 'SAVE') this.openSaveDialog();
        else if (r !== 'close') this.showNotice(`${r} isn't implemented yet.`);
        return true;
      },
    };
  }

  /**
   * StartMenuSaveCallback → StartCB_Save1 / StartCB_Save2: the save dialog (ui/SaveDialog.ts). NO goes back to the
   * start menu (DrawStartMenuInOneGo); after saving (or a save error) the message box is cleared and the field resumes.
   */
  private openSaveDialog(): void {
    const dialog = this.createSaveDialog();
    this.overlay = {
      tick: () => {
        const r = dialog.tick();
        if (r === SAVECB_RETURN_CONTINUE) return false;
        if (r === SAVECB_RETURN_CANCEL) this.openStartMenu();
        else this.messageBox.hide(); // ClearDialogWindowAndFrameToTransparent
        return true;
      },
    };
  }

  /**
   * Field_AskSaveTheGame's StartMenu_PrepareForSave: the dialog its task50_save_game runs, with the script waiting
   * (`special Field_AskSaveTheGame` + `waitstate`). Unlike the start menu's, it leaves the message box as it is.
   */
  createSaveDialog(): SaveDialog {
    return new SaveDialog({
      scene: this,
      fonts: this.fonts,
      input: this.buttons,
      charmap: this.charmap,
      strings: this.assets.strings,
      state: this.state,
      messageBox: this.messageBox,
      mapName: () => GetMapName(this.defines.require(this.mapSection())), // GetMapNameGeneric
      storeLocationForSave: () => this.storeLocationForSave(),
    });
  }

  /**
   * StartMenu_FadeScreenIfLeavingOverworld + StartMenuPokedexCallback / StartMenuPokemonCallback /
   * StartMenuBagCallback / StartMenuOptionCallback / StartMenuPlayerCallback: fade to black, then hand over to the
   * Pokédex, party menu, bag, option menu or trainer card (FieldMenuScene). They come back through
   * CB2_ReturnToFieldWithOpenMenu (start menu reopened while the field fades in) or CB2_ReturnToField.
   */
  private openFieldMenu(menu: 'party' | 'bag' | 'pokedex' | 'options' | 'trainerCard'): void {
    const d = this.defines;
    StopPokemonLeagueLightingEffectTask();
    this.screenFade.begin(d.require('FADE_TO_BLACK'));
    let launched = false;
    // The party menu's Teleport / Dig prompts name maps whose headers it reads synchronously, and the fly map
    // and the Town Map read the player's location.
    let ready = false;
    void prepareFieldMoveMenu().then(() => (ready = true));
    this.overlay = {
      tick: () => {
        if (launched || this.screenFade.active || !ready) return false;
        launched = true;
        if (menu === 'pokedex') this.state.incrementGameStat(d.require('GAME_STAT_CHECKED_POKEDEX'));
        this.runFieldMenu({ menu }, (openStartMenu) => this.runFieldCallback(openStartMenu));
        return false;
      },
    };
  }

  /**
   * RunFieldCallback after a field menu's CB2_ReturnToField(WithOpenMenu), with the screen still black:
   * gFieldCallback2 (a field move's FieldCallback_PrepareFadeInFromMenu, item_use.c's FieldCB2_UseItemFromField)
   * before gFieldCallback, which fade in themselves; without one, fade in (and reopen the start menu).
   */
  private runFieldCallback(openStartMenu: boolean): void {
    const d = this.defines;
    const fieldCallback = gFieldCallback2.fn ?? gFieldCallback.fn;
    gFieldCallback.fn = undefined;
    gFieldCallback2.fn = undefined;
    if (fieldCallback) {
      // gFieldCallback (e.g. item_use.c's FieldCB_FadeInFromBlack for the Bicycle) fades in itself.
      const tick = fieldCallback({
        fadeInFromBlack: () => {
          this.screenFade.begin(d.require('FADE_FROM_BLACK'));
          return () => !this.screenFade.active;
        },
      } satisfies FieldCallbackHost);
      this.overlay = { tick };
      return;
    }
    this.screenFade.begin(d.require('FADE_FROM_BLACK'));
    if (openStartMenu) {
      this.openStartMenu(true);
    } else {
      this.overlay = { tick: () => !this.screenFade.active };
    }
  }

  /**
   * item_use.c's Task_*FromField for a registered item (SELECT): CleanupOverworldWindowsAndTilemaps, then the
   * screen `init` starts (FieldMenuScene 'itemFromField') from the black field. It comes back through
   * CB2_ReturnToField and RunFieldCallback (FieldCB2_UseItemFromField). The controls stay locked meanwhile
   * (UseRegisteredKeyItemOnField's LockPlayerFieldControls).
   */
  private openItemScreenFromField(init: () => void, gfxSymbols: string[]): void {
    this.messageBox.hide(); // CleanupOverworldWindowsAndTilemaps
    // The Town Map reads the player's location; the TM case's and the pouch's party menu, the map headers.
    void prepareFieldMoveMenu().then(() => this.runFieldMenu({ menu: 'itemFromField', itemScreen: { init, gfxSymbols } }, (openStartMenu) => this.runFieldCallback(openStartMenu)));
  }

  /**
   * A special's SetMainCallback2 from the field to a GBA-layer screen (menus/partyMenuSpecials.ts: ChoosePartyMon,
   * SelectMoveDeleterMove, ChooseMonForMoveTutor). The field is gone (black) until the screen returns through
   * CB2_ReturnToField; then RunFieldCallback runs gFieldCallback2 / gFieldCallback (or a plain fade in), and the
   * wait ends once that has finished (its ScriptContext_Enable).
   *
   * The map music: a screen that leaves no field callback here returns through one that starts with
   * Overworld_PlaySpecialMapMusic, as each does in the C: FieldCB_ContinueScriptHandleMusic (the in-game trade's
   * Task_InGameTrade, egg hatching's Task_EggHatch, the move relearner's Task_InitMoveRelearnerMenu, the move tutor's
   * and the slot machine's CB2_ReturnToFieldContinueScriptPlayMapMusic), the diploma's FieldCB_WarpExitFadeFromBlack,
   * or RunFieldCallback's FieldCB_DefaultWarpExit. It brings the map's song back after a screen that changed it
   * (egg hatching's MUS_EVOLUTION; a trade restores its cached song itself, so there nothing changes). The screens
   * that set a callback of their own (the party menu's CB2_FadeFromPartyMenu, Easy Chat's FieldCB_ContinueScript)
   * play none.
   */
  runScreenFromScript(init: () => void, gfxSymbols: string[] = []): Wait {
    let overlay: { tick(): boolean } | undefined;
    this.messageBox.hide(); // CleanupOverworldWindowsAndTilemaps
    this.screenFade.fill(false); // CB2_ReturnToField reloads the field's palettes black
    this.runFieldMenu({ menu: 'itemFromField', itemScreen: { init, gfxSymbols } }, () => {
      if (!gFieldCallback2.fn && !gFieldCallback.fn) Overworld_PlaySpecialMapMusic();
      this.runFieldCallback(false);
      overlay = this.overlay;
    });
    return () => overlay !== undefined && this.overlay !== overlay;
  }

  /**
   * Hand over to a GBA-layer screen (FieldMenuScene) from a black field. When it returns through
   * CB2_ReturnToField(WithOpenMenu), the field runs its return-to-field map scripts and calls `onReturn`
   * with the screen still black.
   */
  private runFieldMenu(start: Pick<FieldMenuStart, 'menu' | 'shopField' | 'naming' | 'storageOption' | 'itemScreen'>, onReturn: (openStartMenu: boolean) => void): void {
    const d = this.defines;
    const launch: FieldMenuStart = {
      ...start,
      state: this.state,
      pokemon: this.state.pokemon,
      charmap: this.charmap,
      mapBattleScene: d.get(this.world.current.data.battleScene ?? '') ?? d.require('MAP_BATTLE_SCENE_NORMAL'),
      onExit: (openStartMenu: boolean, warp?: WarpData) => {
        this.scene.stop('FieldMenu');
        this.scene.wake('Overworld');
        if (warp) {
          void this.warpFromScreen(warp); // DoWarp: CB2_LoadMap, not back to this map
          return;
        }
        this.resumeMap();
        onReturn(openStartMenu);
      },
    };
    this.scene.launch('FieldMenu', launch);
    this.scene.sleep();
  }

  openMultichoice(req: MultichoiceRequest): { tick(): boolean; result: number } {
    const d = this.defines;
    testEvent('multichoice', { mcId: req.mcId });
    const cursor = this.charmap.encode(this.assets.strings.gText_SelectorArrow2);
    const frameType = this.state.optionsWindowFrameType + 1;
    if (req.columns !== undefined) {
      const lrMode = this.state.optionsButtonMode === d.require('OPTIONS_BUTTON_MODE_LR');
      return new MultichoiceGridMenu(this, this.fonts, this.buttons, { ...req, columnCount: req.columns, cursor, frameType, lrMode });
    }
    // sDelay: the cable club menus ignore input for 12 frames
    const delayed = ['MULTICHOICE_TRADE_CENTER_COLOSSEUM', 'MULTICHOICE_TRADE_COLOSSEUM_CRUSH', 'MULTICHOICE_TRADE_COLOSSEUM_2'].some((n) => d.get(n) === req.mcId);
    return new MultichoiceMenu(this, this.fonts, this.buttons, { ...req, cursor, frameType, delay: delayed ? 12 : 0, fadeActive: () => this.screenFade.active });
  }

  /**
   * ShowPokemonStorageSystemPC: the PC's storage menu runs as a field overlay while the script waits for it
   * (`waitstate`); its options enter the box screen (FieldMenuScene 'storage').
   */
  openPokemonStoragePc(): Wait {
    const d = this.defines;
    const menu = new StoragePcMenu(this, this.fonts, this.buttons, {
      text: (symbol) => this.charmap.encode(this.assets.strings[symbol] ?? '?$'),
      partyCount: () => this.state.party.length,
      constants: {
        PARTY_SIZE: d.require('PARTY_SIZE'),
        OPTION_WITHDRAW: d.require('OPTION_WITHDRAW'),
        OPTION_DEPOSIT: d.require('OPTION_DEPOSIT'),
        OPTION_EXIT: d.require('OPTION_EXIT'),
      },
      showDescription: (str) => this.messageBox.show(str, 'neutral', false, true),
      hideDescription: () => this.messageBox.hide(),
      fadeToBlack: () => this.fadeScreen(d.require('FADE_TO_BLACK')),
      enterPokeStorage: (option, onReturn) => {
        this.messageBox.hide(); // CleanupOverworldWindowsAndTilemaps
        this.runFieldMenu({ menu: 'storage', storageOption: option }, () => onReturn());
      },
      previousBoxOption: () => GetPreviousBoxOption(),
      fadeInFromBlack: () => this.fadeScreen(d.require('FADE_FROM_BLACK')),
    });
    this.overlay = menu;
    return () => menu.done;
  }

  /** PlayerPC / BedroomPC (player_pc.c): the item storage menus run as a field overlay while the script waits. */
  openPlayerPc(notInRoom = true): Wait {
    const d = this.defines;
    const menu = new PlayerPcMenu(this, this.fonts, this.buttons, {
      text: (symbol) => this.charmap.encode(this.assets.strings[symbol] ?? '?$'),
      countItemsInPc: () => CountItemsInPC(this.state.pcItems, d.require('ITEM_NONE')),
      countPcMail: () => 0,
      displayItemMessageOnField: (str) => {
        this.messageBox.show(str);
        return () => !this.messageBox.isPrinting;
      },
      showDescription: (str) => this.messageBox.show(str, 'neutral', false, true),
      fadeToBlack: () => this.fadeScreen(d.require('FADE_TO_BLACK')),
      enter: (screen, onReturn) => {
        this.messageBox.hide(); // CleanupOverworldWindowsAndTilemaps
        if (screen === 'itemPc') ItemPc_SetInitializedFlag(false); // Task_WithdrawItemBeginFade
        this.runFieldMenu({ menu: screen }, () => onReturn());
      },
      fadeInFromBlack: () => this.fadeScreen(d.require('FADE_FROM_BLACK')),
    }, notInRoom);
    this.overlay = menu;
    return () => menu.done;
  }

  /**
   * EnterHallOfFame (special): post_battle_event_funcs.c's set-up, then CB2_DoHallOfFameScreen on the GBA layer
   * (FieldMenuScene 'hallOfFame') from the black field. The screen saves the game (so the location is stored
   * first) and leaves through SetWarpsToRollCredits' warp into Indigo Plateau (`warpFromScreen`).
   */
  enterHallOfFame(): void {
    const pallet = this.assets.scripts.healLocations[this.defines.require('HEAL_LOCATION_PALLET_TOWN') - 1];
    EnterHallOfFame(this.state, pallet, () => healPlayerParty(this.state));
    this.messageBox.hide();
    this.storeLocationForSave();
    this.runFieldMenu({ menu: 'hallOfFame' }, () => {
      // CB2_ReturnToField isn't one of the screen's exits; come back faded in anyway
      this.screenFade.begin(this.defines.require('FADE_FROM_BLACK'));
    });
  }

  /**
   * HallOfFamePCBeginFade (hof_pc.c): fade to black, then CB2_InitHofPC (FieldMenuScene 'hallOfFamePc').
   * ReturnFromHallOfFamePC comes back through ReshowPCMenuAfterHallOfFamePC: the PC menu and its prompt, and a
   * fade in. The wait ends when that menu's choice is made (its ScriptContext_Enable), with the choice in `result`.
   */
  openHallOfFamePc(): { tick(): boolean; result: number } {
    const d = this.defines;
    const fade = this.fadeScreen(d.require('FADE_TO_BLACK')); // BeginNormalPaletteFade(PALETTES_ALL, 0, 0, 16, RGB_BLACK)
    let launched = false;
    let menu: { tick(): boolean; result: number } | undefined;
    return {
      get result() {
        return menu?.result ?? 0;
      },
      tick: () => {
        if (!launched) {
          if (!fade()) return false; // Task_WaitFadeAndSetCallback
          launched = true;
          this.messageBox.hide();
          this.runFieldMenu({ menu: 'hallOfFamePc' }, () => {
            // ReshowPCMenuAfterHallOfFamePC: Overworld_PlaySpecialMapMusic, CreatePCMenu,
            // ScriptMenu_DisplayPCStartupPrompt, fade in
            Overworld_PlaySpecialMapMusic();
            menu = this.openPcMenu();
            this.messageBox.show(this.charmap.encode(this.assets.strings.Text_AccessWhichPC ?? '$'), 'neutral', false, true);
            this.screenFade.begin(d.require('FADE_FROM_BLACK'));
          });
          return false;
        }
        return menu?.tick() ?? false;
      },
    };
  }

  /**
   * DoCredits (special): menus/credits.ts on the field's GBA layer, from the field as it is (Indigo Plateau). The
   * credits' maps, graphics and text are loaded first (a few frames). It never returns to the field: the credits
   * end in SoftReset, which here restarts the boot flow (BootScene).
   */
  doCredits(): void {
    this.busy = true;
    this.clearNpcs(); // the credits' maps replace the field's
    let started = false;
    void this.prepareCredits().then(() => {
      this.creditsCamera = { x: Math.round(this.cameras.main.worldView.x), y: Math.round(this.cameras.main.worldView.y) };
      this.gbaScreen.start(this.creditsGbaSource());
      InitStandardTextBoxWindows(); // the field's windows (InitOverworldBgs)
      InitTextBoxGfxAndPrinters();
      DoCredits();
      started = true;
    });
    let running = true;
    this.overlay = {
      tick: () => {
        if (started && running) running = CB2_Credits();
        return false;
      },
    };
  }

  /** The camera while the credits run (world px of the screen's top left); undefined otherwise. */
  private creditsCamera?: { x: number; y: number };

  /** What the credits load: their maps and tilesets, their graphics, the GBA layer's text. */
  private async prepareCredits(): Promise<void> {
    const maps = await Promise.all(CREDITS_MAPS.map((id) => this.assets.loadMap(this.assets.mapNameForId(id)!)));
    const syms = new Set(creditsGfxSymbols());
    for (const data of maps) {
      await this.assets.loadTilesetTextures(this, data.tilesetPair);
      const t = this.assets.tilesetSymbols(data.tilesetPair);
      for (const sym of fieldGbaScreenGfxSymbols({ primary: { name: '', symbols: t.primary }, secondary: { name: '', symbols: t.secondary } })) syms.add(sym);
    }
    for (const sym of fieldGbaScreenGfxSymbols(this.fieldGbaSource())) syms.add(sym);
    const frame = `sUserFrame_Type${this.state.optionsWindowFrameType + 1}`;
    for (const sym of ['gMenuMessageWindow_Gfx', 'gStdTextWindow_Gfx', 'gTextWindowPalettes', `${frame}_Gfx`, `${frame}_Pal`]) syms.add(sym);
    await loadGfx(syms);
    setTextStrings(this.assets.strings);
    configureMenuEnv(this.state);
    initGbaText(this.fonts, this.buttons, TEXT_SPEED[this.state.textSpeed].scroll);
    Object.assign(creditsEnv, {
      loadMap: (mapId: string, x: number, y: number) => {
        let done = false;
        void this.world.load(this.assets.mapNameForId(mapId)!).then(() => {
          const anims = this.assets.tilesetAnimInfo(this.world.current.data.tilesetPair);
          InitTilesetAnimations(anims.primary, anims.secondary);
          // gSaveBlock1Ptr->pos = (x, y): the camera frames that tile where it frames the player
          this.creditsCamera = { x: x * 16 - 112, y: y * 16 - 72 };
          this.gbaScreen.reloadField(this.creditsGbaSource());
          done = true;
        });
        return () => done;
      },
      moveCamera: (dx: number, dy: number) => {
        this.creditsCamera!.x += dx;
        this.creditsCamera!.y += dy;
      },
      updateTilesetAnimations: () => UpdateTilesetAnimations(),
      bareScreen: () => this.gbaScreen.startBare(),
      softReset: () => {
        this.gbaScreen.stop();
        softReset(this);
      },
      playerGender: () => this.playerGender(),
    } satisfies Partial<typeof creditsEnv>);
  }

  /** The current map on the GBA layer for the credits: their camera, and no objects (ResetSpriteData). */
  private creditsGbaSource(): FieldGbaSource {
    return { ...this.fieldGbaSource(), camera: () => ({ ...this.creditsCamera! }), sprites: () => [], fog: () => undefined, flashLevel: 0 };
  }

  /**
   * DoWarp from a GBA screen (the Hall of Fame's SetWarpsToRollCredits): ResetInitialPlayerAvatarState, then
   * CB2_LoadMap into the destination from the black screen and FieldCB_DefaultWarpExit's fade in.
   */
  private async warpFromScreen(w: WarpData): Promise<void> {
    const name = this.assets.mapNameForId(w.mapId);
    if (!name) {
      console.warn('[warp] unknown map', w.mapId);
      return;
    }
    this.busy = true;
    ResetInitialPlayerAvatarState();
    const isExit = await this.loadWarpedMap(name, w.warpId, w.x, w.y, false);
    Overworld_PlaySpecialMapMusic(); // FieldCB_DefaultWarpExit
    const arrival = this.world.tileAt(this.player.tileX, this.player.tileY);
    if (this.behaviors.isDoor(arrival.behavior)) this.exitDoor(isExit);
    else this.warpFadeInScreen(isExit);
    await this.waitFrames(() => !this.screenFade.active);
    this.busy = false;
  }

  /** CreatePokemartMenu: the shop menu runs as a field overlay while the script waits for it. */
  openPokemart(items: number[]): Wait {
    const shop = new ShopMenu(this, this.fonts, this.buttons, this.createShopHost(), items);
    this.overlay = shop;
    return () => shop.done;
  }

  private createShopHost(): ShopHost {
    const d = this.defines;
    return {
      contextTextColor: () => this.scripts.contextTextColor(),
      windowFrameType: () => this.state.optionsWindowFrameType + 1,
      text: (symbol) => this.charmap.encode(this.assets.strings[symbol] ?? '?$'),
      fadeToBlack: () => this.fadeScreen(d.require('FADE_TO_BLACK')),
      goToBuyOrSellMenu: (menu, onReturn) => {
        this.messageBox.hide(); // the field's windows are freed with it
        this.runFieldMenu({ menu, shopField: menu === 'buy' ? this.shopFieldView() : undefined }, () => onReturn());
      },
      fadeInFromBlack: () => this.fadeScreen(d.require('FADE_FROM_BLACK')),
      displayItemMessageOnField: (color, str) => {
        this.messageBox.show(str, color);
        return () => !this.messageBox.isPrinting;
      },
    };
  }

  /** The field as shop.c's buy menu reads it: map metatiles and the objects around the player. */
  private shopFieldView(): ShopFieldView {
    const d = this.defines;
    const pairKey = this.world.current.data.tilesetPair;
    const pair = this.assets.tilesetPair(pairKey);
    const tilesets = this.assets.tilesetSymbols(pairKey);
    const { dx, dy } = DELTA[this.player.facing];
    // gObjectEvents: the current map's objects and the player (see "Deliberate QOL changes")
    const objects = [
      ...this.npcs.filter((n) => n.chunk === this.world.current).map((n) => ({ obj: n.brain.obj, graphicsId: n.graphicsId })),
      { obj: this.player, graphicsId: PLAYER_GFX },
    ];
    return {
      primaryTileset: tilesets.primary,
      secondaryTileset: tilesets.secondary,
      facing: { x: this.player.tileX + dx, y: this.player.tileY + dy },
      playerElevation: this.player.currentElevation,
      MapGridGetMetatileIdAt: (x, y) => this.world.tileAt(x, y).metatile,
      // gMapHeader's tilesets interpret every block, the neighbours' too
      MapGridGetMetatileLayerTypeAt: (x, y) => pair.layerType(this.world.tileAt(x, y).metatile),
      objectAt: (x, y, elevation) => {
        // GetObjectEventIdByPosition: currentCoords and ObjectEventDoesElevationMatch
        const found = objects.find(({ obj }) => {
          const at = obj.destination;
          if (at.x !== x || at.y !== y) return false;
          return obj.currentElevation === 0 || elevation === 0 || obj.currentElevation === elevation;
        });
        return found && { graphicsId: found.graphicsId, facingDirection: directionId(found.obj.facing, d) };
      },
    };
  }

  /** A one-off message (our own text, not game text) dismissed with A/B. */
  private showNotice(text: string): void {
    this.messageBox.show(this.charmap.encode(`${text}$`));
    let opened = false;
    this.overlay = {
      tick: () => {
        if (!opened) {
          opened = true; // skip the frame that opened it
          return false;
        }
        if (this.messageBox.isPrinting || !this.buttons.pressedAorB()) return false;
        this.messageBox.hide();
        return true;
      },
    };
  }

  // ------------------------------------------------------------------ ScriptHost

  openYesNo(): YesNoMenu {
    const text = (label: string) => this.charmap.encode(this.assets.strings[label] ?? '?$');
    return new YesNoMenu(this, this.fonts, this.buttons, { yesNo: text('gText_YesNo'), cursor: text('gText_SelectorArrow2') }, { seOnNo: true });
  }

  showMoneyBox(x: number, y: number): void {
    this.moneyBox?.destroy();
    this.moneyBox = new MoneyBox(this, this.fonts, this.buttons, this.charmap, this.assets.strings, this.state.money, x, y);
  }

  updateMoneyBox(): void {
    this.moneyBox?.change(this.state.money);
  }

  elevatorFloorWindow(floor: number | undefined): void {
    this.elevatorWindow?.destroy();
    this.elevatorWindow = undefined;
    if (floor === undefined) return; // CloseElevatorCurrentFloorWindow
    // sElevatorCurrentFloorWindowTemplate (22, 1, 7x4) with LoadStdWindowGfx's frame
    const win = new MenuWindow(this, { left: 22, top: 1, width: 7, height: 4 }, this.fonts, this.buttons, 'std');
    const text = (label: string) => this.charmap.encode(this.assets.strings[label] ?? '?$');
    win.print(text('gText_NowOn'), 0, 2);
    const name = text(FLOOR_NAMES[floor] ?? 'gText_1F');
    win.print(name, 56 - stringWidth(this.fonts, FONT_NORMAL, name, 0), 16);
    win.flush();
    this.elevatorWindow = win;
  }

  startFieldTask(task: FieldTask): void {
    this.fieldTasks.push(task);
  }

  /** SetCameraPanning(dx, dy) (field_camera.c); 0, 0 for InstallCameraPanAheadCallback's standard pan. */
  setCameraPanning(dy: number, dx = 0): void {
    // A bigger sVerticalCameraPan scrolls the view down, a bigger sHorizontalCameraPan right
    this.cameraPanY = dy;
    this.cameraPanX = dx;
    this.cameras.main.setFollowOffset(-dx, CAMERA_FOLLOW_OFFSET_Y - dy);
    this.updateFieldCamera();
  }

  hideMoneyBox(): void {
    this.moneyBox?.destroy();
    this.moneyBox = undefined;
  }

  showCoinsBox(x: number, y: number): void {
    this.coinsBox?.destroy();
    this.coinsBox = new CoinsBox(this, this.fonts, this.buttons, this.charmap, this.assets.strings, this.state.coins, x, y);
  }

  updateCoinsBox(): void {
    this.coinsBox?.change(this.state.coins);
  }

  hideCoinsBox(): void {
    this.coinsBox?.destroy();
    this.coinsBox = undefined;
  }

  setWarpDestination(mapId: string, warpId: number, x: number, y: number): void {
    this.warpDestination = { mapId, warpId, x, y };
  }

  showMonPic(species: number, x: number, y: number): void {
    if (this.monPic) return; // FindTaskIdByFunc(Task_ScriptShowMonPic) != TASK_NONE
    this.monPic = new MonPicBox(this, this.fonts, this.buttons, x, y, this.assets.loadMonFrontPic(this, species));
  }

  hideMonPic(): Wait | undefined {
    const box = this.monPic;
    if (!box) return undefined;
    box.hide();
    return () => box.gone;
  }

  cancelMonPic(): void {
    this.monPic?.cancel();
    this.monPic = undefined;
  }

  /**
   * CreatePCMenuWindow: a std-framed window at (0, 0), 13 tiles wide (14 with the Pokédex: GetStringTilesWide
   * of gText_SPc is 0, since GetStringWidth gives up on the {PLAYER} placeholder), 16 px rows.
   */
  openPcMenu(): { tick(): boolean; result: number } {
    const strings = this.assets.strings;
    const encode = (label: string) => this.charmap.encode(strings[label]);
    const hasDex = this.state.getFlag('FLAG_SYS_POKEDEX_GET');
    const gameClear = this.state.getFlag('FLAG_SYS_GAME_CLEAR');
    const items = [
      encode(this.state.getFlag('FLAG_SYS_NOT_SOMEONES_PC') ? 'gText_BillSPc' : 'gText_SomeoneSPc'),
      expandPlaceholders(encode('gText_SPc'), this.charmap, this.state), // Menu_PrintFormatIntlPlayerName
    ];
    if (gameClear || hasDex) items.push(encode('gText_ProfOakSPc'));
    if (gameClear) items.push(encode('gText_HallOfFame_2'));
    items.push(encode('gText_LogOff'));
    return new MultichoiceMenu(this, this.fonts, this.buttons, {
      left: 0,
      top: 0,
      items,
      ignoreBPress: false,
      initPos: 0,
      cursor: this.charmap.encode(this.assets.strings.gText_SelectorArrow2),
      frameType: this.state.optionsWindowFrameType + 1,
      delay: 0,
      fadeActive: () => this.screenFade.active,
      layout: { width: hasDex ? 14 : 13, height: items.length * 2, rowHeight: 16 },
    });
  }

  fadeScreen(mode: number, delay = 0): Wait {
    this.screenFade.begin(mode, delay);
    return () => !this.screenFade.active;
  }

  /**
   * DoNamingScreen (FieldMenuScene) from the black field. CB2_ReturnToFieldContinueScriptPlayMapMusic
   * reloads the field, so the message box is gone, and FieldCB_ContinueScriptHandleMusic fades it back in.
   */
  doNamingScreen(req: NamingScreenRequest): Wait {
    let fadeIn: Wait | undefined;
    this.messageBox.hide();
    this.runFieldMenu({ menu: 'naming', naming: req }, () => {
      Overworld_PlaySpecialMapMusic(); // FieldCB_ContinueScriptHandleMusic
      fadeIn = this.fadeScreen(this.defines.require('FADE_FROM_BLACK'));
    });
    return () => fadeIn?.() ?? false;
  }

  /** ShowTownMap: the wall map (FieldMenuScene 'townMap') from the black field, then fade back in. */
  showTownMap(): Wait {
    let fadeIn: Wait | undefined;
    this.messageBox.hide();
    void prepareRegionMap().then(() =>
      this.runFieldMenu({ menu: 'townMap' }, () => {
        fadeIn = this.fadeScreen(this.defines.require('FADE_FROM_BLACK'));
      }),
    );
    return () => fadeIn?.() ?? false;
  }

  /**
   * StartTrainerBattle + DoTrainerBattle (battle_setup.c): the trainer's battle transition, then the battle
   * scene. The field stays black afterwards until the script engine either returns to it (`returnToField`)
   * or whites out.
   */
  startTrainerBattle(battle: TrainerBattle): TrainerBattleRun {
    const d = this.defines;
    let battleTypeFlags = d.require('BATTLE_TYPE_TRAINER');
    if (battle.mode === d.require('TRAINER_BATTLE_EARLY_RIVAL') && battle.localIdOrFlags & d.require('RIVAL_BATTLE_TUTORIAL')) {
      battleTypeFlags |= d.require('BATTLE_TYPE_FIRST_BATTLE');
    }
    const speech = (label?: string) => (label && this.assets.strings[label] !== undefined ? this.charmap.encode(this.assets.strings[label]) : undefined);
    return this.runBattle({
      battleTypeFlags,
      trainerBattleOpponent_A: battle.trainer,
      trainerBattleMode: battle.mode,
      rivalBattleFlags: battle.mode === d.require('TRAINER_BATTLE_EARLY_RIVAL') ? battle.localIdOrFlags : 0,
      defeatSpeech: speech(battle.defeatText),
      victorySpeech: speech(battle.victoryText),
    }, this.trainerBattleTransition(battle.trainer));
  }

  /**
   * Scripted non-trainer battles (StartOldManTutorialBattle etc.): gEnemyParty is set up by the caller. `song`
   * is CreateBattleStartTask's (0: the battle's default music).
   */
  startScriptedBattle(battleTypeFlags: number, enemyParty: Pokemon[], transition: number, song = 0, battleStartTask = true): TrainerBattleRun {
    return this.runBattle({ battleTypeFlags, trainerBattleOpponent_A: 0, trainerBattleMode: 0, rivalBattleFlags: 0, enemyParty }, transition, song, battleStartTask);
  }

  /** GetBattleTransitionTypeByMap: TRANSITION_TYPE_NORMAL (0), _CAVE (1), _FLASH (2) or _WATER (3). */
  private battleTransitionTypeByMap(): number {
    const behavior = this.world.tileAt(this.player.tileX, this.player.tileY).behavior; // PlayerGetDestCoords
    if (Overworld_GetFlashLevel(this.state)) return TRANSITION_TYPE_FLASH;
    if (this.behaviors.isSurfable(behavior)) return TRANSITION_TYPE_WATER;
    switch (this.mapType(this.world.current.data)) {
      case K.MAP_TYPE_UNDERGROUND:
        return TRANSITION_TYPE_CAVE;
      case K.MAP_TYPE_UNDERWATER:
        return TRANSITION_TYPE_WATER;
      default:
        return TRANSITION_TYPE_NORMAL;
    }
  }

  /** GetSumOfPlayerPartyLevel: the levels of the first `numMons` healthy, non-egg party mons (a u8). */
  private sumOfPlayerPartyLevel(numMons: number): number {
    let sum = 0;
    for (const mon of this.state.party) {
      if (mon.isEgg || !mon.species || mon.hp === 0) continue;
      sum = (sum + mon.level) & 0xff;
      if (--numMons === 0) break;
    }
    return sum;
  }

  /** GetWildBattleTransition: gEnemyParty[0] against the player's lead mon. */
  wildBattleTransition(enemy: Pokemon): number {
    const transitionType = this.battleTransitionTypeByMap();
    const enemyLevel = enemy.level;
    const playerLevel = this.sumOfPlayerPartyLevel(1);
    return K[sBattleTransitionTable_Wild[transitionType][enemyLevel < playerLevel ? 0 : 1]];
  }

  /** GetTrainerBattleTransition */
  private trainerBattleTransition(opponent: number): number {
    if (opponent === K.TRAINER_SECRET_BASE) return K.B_TRANSITION_BLUE;
    const trainer = bdata.tables.trainers[opponent];
    if (!trainer) return K.B_TRANSITION_POKEBALLS_TRAIL;
    if (trainer.trainerClass === K.TRAINER_CLASS_ELITE_FOUR) {
      if (opponent === K.TRAINER_ELITE_FOUR_LORELEI || opponent === K.TRAINER_ELITE_FOUR_LORELEI_2) return K.B_TRANSITION_LORELEI;
      if (opponent === K.TRAINER_ELITE_FOUR_BRUNO || opponent === K.TRAINER_ELITE_FOUR_BRUNO_2) return K.B_TRANSITION_BRUNO;
      if (opponent === K.TRAINER_ELITE_FOUR_AGATHA || opponent === K.TRAINER_ELITE_FOUR_AGATHA_2) return K.B_TRANSITION_AGATHA;
      if (opponent === K.TRAINER_ELITE_FOUR_LANCE || opponent === K.TRAINER_ELITE_FOUR_LANCE_2) return K.B_TRANSITION_LANCE;
      return K.B_TRANSITION_BLUE;
    }
    if (trainer.trainerClass === K.TRAINER_CLASS_CHAMPION) return K.B_TRANSITION_BLUE;
    // double battles always at least have 2 pokemon.
    const minPartyCount = trainer.doubleBattle ? 2 : 1;
    const transitionType = this.battleTransitionTypeByMap();
    // GetSumOfEnemyPartyLevel (a u8)
    const enemyLevel = trainer.party.slice(0, minPartyCount).reduce((sum, mon) => (sum + mon.lvl) & 0xff, 0);
    const playerLevel = this.sumOfPlayerPartyLevel(minPartyCount);
    return K[sBattleTransitionTable_Trainer[transitionType][enemyLevel < playerLevel ? 0 : 1]];
  }

  /**
   * StartWildBattle (battle_setup.c) with gEnemyParty[0] = `enemy`: DoGhostBattle in Pokémon Tower
   * without the Silph Scope, else DoStandardWildBattle. Field controls and objects stay frozen until
   * CB2_EndWildBattle has either whited out or faded back in (FieldCB_SafariZoneRanOutOfBalls).
   */
  private startWildBattle(enemy: Pokemon): void {
    const d = this.defines;
    let battleTypeFlags = 0;
    if (this.state.getFlag('FLAG_SYS_SAFARI_MODE')) {
      this.doSafariBattle(enemy);
      return;
    } else if (POKEMON_TOWER_MAPS.includes(this.state.currentMapId) && !this.state.bag.has(d.require('ITEM_SILPH_SCOPE'), 1)) {
      // DoGhostBattle
      battleTypeFlags = d.require('BATTLE_TYPE_GHOST');
      enemy.nickname = this.charmap.encodePlain(this.assets.strings.gText_Ghost);
    }
    this.runWildBattle(battleTypeFlags, enemy);
  }

  /**
   * DoSafariBattle + CB2_EndSafariBattle (safari_zone.c): with balls left, back to the field; out of balls
   * mid-battle, SafariZone_EventScript_OutOfBallsMidBattle sets the entrance as the warp and the map is
   * loaded there (FieldCB_SafariZoneRanOutOfBalls fades in); out of balls by catching with the last one,
   * the field fades back in and SafariZone_EventScript_OutOfBalls runs.
   */
  private doSafariBattle(enemy: Pokemon): void {
    const d = this.defines;
    const run = this.runBattle({ battleTypeFlags: d.require('BATTLE_TYPE_SAFARI'), trainerBattleOpponent_A: 0, trainerBattleMode: 0, rivalBattleFlags: 0, enemyParty: [enemy] }, this.wildBattleTransition(enemy));
    let fadeIn: (() => boolean) | undefined;
    let afterFade: (() => void) | undefined;
    let warping = false;
    this.overlay = {
      tick: () => {
        if (warping) return false;
        if (fadeIn) {
          if (!fadeIn()) return false;
          afterFade?.();
          return true;
        }
        if (!run.done()) return false;
        const outcome = this.state.battleOutcome;
        if (this.state.numSafariBalls !== 0) {
          fadeIn = run.returnToField(); // CB2_ReturnToField
        } else if (outcome === d.require('B_OUTCOME_NO_SAFARI_BALLS')) {
          this.scripts.runImmediately('SafariZone_EventScript_OutOfBallsMidBattle');
          warping = true;
          void this.warpIntoMapFromBlack().then(() => {
            warping = false;
            Overworld_PlaySpecialMapMusic(); // FieldCB_SafariZoneRanOutOfBalls
            this.screenFade.begin(d.require('FADE_FROM_BLACK'));
            fadeIn = () => !this.screenFade.active;
          });
        } else if (outcome === d.require('B_OUTCOME_CAUGHT')) {
          // ScriptContext_SetupScript + CB2_ReturnToFieldContinueScriptPlayMapMusic: the script waits for the fade
          fadeIn = run.returnToField();
          afterFade = () => this.startFieldScript('SafariZone_EventScript_OutOfBalls');
        } else {
          // Not reachable: the last ball either catches or ends the battle with B_OUTCOME_NO_SAFARI_BALLS.
          fadeIn = run.returnToField();
        }
        return false;
      },
    };
  }

  /** WarpIntoMap + CB2_LoadMap to the `setwarp` destination, from a black screen that stays black. */
  private async warpIntoMapFromBlack(): Promise<void> {
    const w = this.warpDestination;
    const name = w && this.assets.mapNameForId(w.mapId);
    if (!w || !name) {
      console.warn('[warp] no warp destination set');
      return;
    }
    this.busy = true;
    const data = await this.assets.loadMap(name);
    const dest = warpDestCoords(data, w.warpId, w.x, w.y);
    await this.enterMap(name, dest.x, dest.y, undefined, true);
    this.busy = false;
  }

  /** The DoStandardWildBattle / StartRoamerBattle / DoGhostBattle part: battle, then CB2_EndWildBattle. */
  private runWildBattle(battleTypeFlags: number, enemy: Pokemon, song = 0): void {
    const run = this.runBattle({ battleTypeFlags, trainerBattleOpponent_A: 0, trainerBattleMode: 0, rivalBattleFlags: 0, enemyParty: [enemy] }, this.wildBattleTransition(enemy), song);
    let fadeIn: (() => boolean) | undefined;
    this.overlay = {
      tick: () => {
        if (fadeIn) return fadeIn();
        if (!run.done()) return false;
        // CB2_EndWildBattle
        if (!run.playerWon()) {
          this.whiteOut();
          return true;
        }
        fadeIn = run.returnToField();
        return false;
      },
    };
  }

  /**
   * CreateBattleStartTask + Task_BattleStart: the battle's music (PlayMapChosenOrBattleBGM: `song`, or the
   * default for the battle type and trainer class when 0), the battle transition (B_TRANSITION_*) over the
   * field on the GBA layer, then BattleScene; the field is left black for the caller.
   */
  private runBattle(
    setup: Pick<BattleStart, 'battleTypeFlags' | 'trainerBattleOpponent_A' | 'trainerBattleMode' | 'rivalBattleFlags' | 'defeatSpeech' | 'victorySpeech' | 'enemyParty'>,
    transition: number,
    song = 0,
    battleStartTask = true,
  ): TrainerBattleRun {
    const d = this.defines;
    PlayMapChosenOrBattleBGM(song, setup.battleTypeFlags, bdata.tables.trainers[setup.trainerBattleOpponent_A]?.trainerClass ?? 0);
    const color = this.scripts.contextTextColor();
    const map = this.world.current.data;
    let phase: 'poison' | 'transition' | 'battle' | 'done' = 'poison';
    transition = forcedBattleTransition ?? transition;
    const source = this.fieldGbaSource();
    let loaded = false;
    void loadGfx([...battleTransitionGfxSymbols(transition), ...fieldGbaScreenGfxSymbols(source)]).then(() => (loaded = true));
    let outcome = 0;
    const start: BattleStart = {
      ...setup,
      npcTextColor: d.require(color === 'male' ? 'NPC_TEXT_COLOR_MALE' : color === 'female' ? 'NPC_TEXT_COLOR_FEMALE' : 'NPC_TEXT_COLOR_NEUTRAL'),
      terrain: this.battleTerrainId(),
      mapBattleScene: d.get(map.battleScene ?? '') ?? d.require('MAP_BATTLE_SCENE_NORMAL'),
      mapType: d.get(map.mapType ?? '') ?? 0,
      overworldWeather: d.get(map.weather ?? '') ?? 0,
      state: this.state,
      pokemon: this.state.pokemon,
      charmap: this.charmap,
      onEnd: (o) => {
        testEvent('battleEnd', { outcome: o });
        outcome = o;
        this.state.battleOutcome = o;
        this.scene.stop('Battle');
        this.scene.wake('Overworld');
        phase = 'done';
      },
    };
    return {
      done: () => {
        // Task_BattleStart: the transition waits for FldEffPoison to finish (and here for its graphics); another
        // task (Task_DoTrainerTowerBattle) starts it at once
        if (phase === 'poison' && (!battleStartTask || !this.poisonEffect) && loaded) {
          phase = 'transition';
          testEvent('battleTransition', { transition });
          this.gbaScreen.start(source);
          if (battleStartTask) HelpSystem_Disable(); // Task_BattleStart
          BattleTransition_StartOnField(transition);
        }
        if (phase === 'transition' && IsBattleTransitionDone()) {
          phase = 'battle';
          testEvent('battleTransitionEnd', { black: this.gbaScreen.blackFraction() });
          // Every palette is black now (FadeScreenBlack); the field stays black behind the battle.
          this.gbaScreen.stop();
          this.screenFade.fill(false);
          if (battleStartTask) {
            HelpSystem_Enable();
            this.wild.resetEncounterRateModifiers(); // RestartWildEncounterImmunitySteps
            this.state.setVar('VAR_POISON_STEP_COUNTER', 0); // ClearPoisonStepCounter
          }
          testEvent('battleStart', { flags: start.battleTypeFlags, trainer: start.trainerBattleOpponent_A });
          this.scene.launch('Battle', start);
          this.scene.sleep();
        }
        return phase === 'done';
      },
      // IsPlayerDefeated: B_OUTCOME_LOST or B_OUTCOME_DREW
      playerWon: () => outcome !== d.require('B_OUTCOME_LOST') && outcome !== d.require('B_OUTCOME_DREW'),
      returnToField: () => {
        this.resumeMap();
        // FieldCB_DefaultWarpExit (CB2_EndWildBattle) / FieldCB_ContinueScriptHandleMusic (a trainer's
        // CB2_ReturnToFieldContinueScriptPlayMapMusic): the map's music again after the battle's
        Overworld_PlaySpecialMapMusic();
        this.screenFade.begin(d.require('FADE_FROM_BLACK'));
        return () => !this.screenFade.active;
      },
    };
  }

  /** The field as the GBA layer draws it (battle transitions). */
  private fieldGbaSource(): FieldGbaSource {
    const pairKey = this.world.current.data.tilesetPair;
    const pair = this.assets.tilesetPair(pairKey);
    const symbols = this.assets.tilesetSymbols(pairKey);
    const cam = this.cameras.main;
    return {
      primary: { name: pair.info.primary, symbols: symbols.primary },
      secondary: { name: pair.info.secondary, symbols: symbols.secondary },
      metatileAt: (x, y) => this.world.tileAt(x, y).metatile,
      layerType: (metatile) => pair.layerType(metatile),
      camera: () => ({ x: Math.round(cam.worldView.x), y: Math.round(cam.worldView.y) }),
      sprites: () => this.fieldSprites(),
      fog: () => this.fog.gbaLayer(),
      flashLevel: Overworld_GetFlashLevel(this.state),
    };
  }

  /** The object and field effect sprites (OAM on the GBA), back to front, with the priority their depth band stands for. */
  private fieldSprites(): { sprite: Phaser.GameObjects.Sprite; priority: number }[] {
    return this.children.list
      .filter((o): o is Phaser.GameObjects.Sprite => o instanceof Phaser.GameObjects.Sprite && o.visible && o.depth < DEPTH_UI)
      .sort((a, b) => a.depth - b.depth)
      .map((sprite) => ({ sprite, priority: sprite.depth >= DEPTH_TOP ? 1 : sprite.depth >= DEPTH_MIDDLE ? 2 : 3 }));
  }

  /**
   * CB2_ReturnToField → ReturnToFieldLocal, for coming back from a battle or a field menu: ResumeMap's
   * RunOnResumeMapScript, then ReloadObjectsAndRunReturnToFieldMapScript's RunOnReturnToFieldMapScript.
   */
  private resumeMap(): void {
    ResetLeagueLightingTasks(); // ResumeMap's ResetTasks
    ResetWeatherTask();
    this.startWeatherOnResumeMap();
    this.ambientCry = { state: 0, delayCounter: 0 }; // and SetUpFieldTasks' new Task_RunTimeBasedEvents
    SetUpFieldTasks(); // and its new Task_RunPerStepCallback (world/fieldTasks.ts)
    ReturnPlayerAvatarToField(); // SpawnObjectEventsOnReturnToField
    this.objectsFrozen = false; // FieldCB_ReturnToFieldNoScript's UnfreezeObjectEvents (a rod's bite froze them)
    this.player.clearHeldMovementIfFinished(); // (a finished step isn't processed again after a battle)
    const name = this.world.current.name;
    for (const type of ['MAP_SCRIPT_ON_RESUME', 'MAP_SCRIPT_ON_RETURN_TO_FIELD']) {
      const script = this.scripts.mapScript(name, type);
      if (script) this.scripts.runImmediately(script);
    }
    tilesetVram.resetBgPalettes(); // InitViewGraphics' LoadMapTilesetPalettes
    SetHelpContextForMap(); // ReturnToFieldLocal, after InitViewGraphics
    // ResumeMap's ResetTasks + ScanlineEffect_Clear, then InitCurrentFlashLevelScanlineEffect
    this.flash.initCurrentFlashLevelScanlineEffect(Overworld_GetFlashLevel(this.state));
  }

  /**
   * FldEff_UseFlash: Flash from the party menu (FieldCallback_Flash's mon banner hands over to this)
   * sets FLAG_SYS_FLASH_ACTIVE and lights the cave with EventScript_FldEffFlash.
   */
  useFlash(): void {
    FldEff_UseFlash(this.state, (label) => this.scripts.start(label));
  }

  /** AnimateFlash (field_screen_effect.c) from the current flash level. */
  animateFlash(newFlashLevel: number): Wait {
    return this.flash.animateFlash(Overworld_GetFlashLevel(this.state), newFlashLevel);
  }

  listMenuHost(): ListMenuHost {
    return {
      scene: this,
      fonts: this.fonts,
      input: this.buttons,
      frameType: () => this.state.optionsWindowFrameType + 1,
      cursorGlyph: () => this.charmap.encode(this.assets.strings.gText_SelectorArrow2),
      labels: (id) => this.assets.scripts.listMenus[id]?.map((label) => this.charmap.encode(this.assets.strings[label] ?? '?$')),
      startFieldTask: (task) => this.startFieldTask(task),
    };
  }

  /**
   * CB2_WhiteOut, run from the black screen a lost battle leaves: 120 frames, then DoWhiteOut, then
   * FieldCB_RushInjuredPokemonToCenter's task (the "scurried" text, the player turned north, a fade in,
   * and the nurse's or Mom's healing script).
   */
  whiteOut(): void {
    const d = this.defines;
    let frames = 0;
    let step: 'wait' | 'warp' | 'text' | 'fade' = 'wait';
    let text: WhiteOutText | undefined;
    let home = false;
    this.overlay = {
      tick: () => {
        switch (step) {
          case 'wait':
            if (++frames < 120) return false;
            step = 'warp';
            void this.doWhiteOut().then(() => {
              // Task_RushInjuredPokemonToCenter: the scene changes if the last heal location is home
              const pallet = this.assets.scripts.healLocations[d.require('HEAL_LOCATION_PALLET_TOWN') - 1];
              const last = this.state.lastHealLocation;
              home = !!last && last.map === pallet.map && last.x === pallet.x && last.y === pallet.y;
              const label = home ? 'gText_PlayerScurriedBackHome' : 'gText_PlayerScurriedToCenter';
              text = new WhiteOutText(this, this.fonts, this.buttons, this.charmap, this.state, this.charmap.encode(this.assets.strings[label]));
              step = 'text';
            });
            return false;
          case 'warp':
            return false;
          case 'text':
            if (!text!.tick()) return false;
            this.player.face('up'); // ObjectEventTurn(player, DIR_NORTH)
            text!.destroy();
            this.screenFade.begin(d.require('FADE_FROM_BLACK')); // FadeInFromBlack
            step = 'fade';
            return false;
          case 'fade':
            if (this.screenFade.active) return false;
            this.scripts.start(home ? 'EventScript_AfterWhiteOutMomHeal' : 'EventScript_AfterWhiteOutHeal');
            return true;
        }
      },
    };
  }

  /** DoWhiteOut: lose money, heal, reset field state and warp to the respawn point facing north. */
  private async doWhiteOut(): Promise<void> {
    this.busy = true;
    testEvent('whiteOut');
    StopMapMusic(); // CB2_WhiteOut (EventScript_AfterWhiteOutHeal's fadedefaultbgm brings it back)
    this.scripts.runImmediately('EventScript_ResetEliteFourEnd');
    this.state.removeMoney(this.whiteOutMoneyLoss());
    healPlayerParty(this.state);
    // Overworld_ResetStateAfterWhitingOut (+ ResetSafariZoneFlag_)
    for (const f of ['FLAG_SYS_ON_CYCLING_ROAD', 'FLAG_SYS_CRUISE_MODE', 'FLAG_SYS_SAFARI_MODE', 'FLAG_SYS_USE_STRENGTH', 'FLAG_SYS_FLASH_ACTIVE', 'FLAG_SYS_QL_DEPARTED']) {
      this.state.setFlag(f, false);
    }
    for (const v of ['VAR_MAP_SCENE_ROUTE16', 'VAR_MAP_SCENE_FUCHSIA_CITY_SAFARI_ZONE_ENTRANCE', 'VAR_QL_ENTRANCE']) this.state.setVar(v, 0);
    ResetInitialPlayerAvatarState();
    const respawn = this.whiteOutRespawn();
    const name = this.assets.mapNameForId(respawn.map);
    if (name) {
      const from = this.world.current.data;
      await this.enterMap(name, respawn.x, respawn.y, 'up', true); // WarpIntoMap, DIR_NORTH
      this.showMapNameOnWarpArrival(from); // CB2_WhiteOut loads the map in steps like a warp
    } else console.warn('[whiteout] unknown respawn map', respawn.map);
    if (respawn.healer) {
      // SetWhiteoutRespawnHealerNpcAsLastTalked
      const id = this.resolveLocalId(respawn.healer);
      if (id !== undefined) this.state.setVar('VAR_LAST_TALKED', id);
    }
    this.busy = false;
  }

  /** SetWhiteoutRespawnWarpAndHealerNpc (heal_location.c). */
  private whiteOutRespawn(): { map: string; x: number; y: number; healer?: string } {
    if (this.state.getVar('VAR_MAP_SCENE_TRAINER_TOWER') === 1) {
      if (!currentTrainerTowerRecord(this.state).spokeToOwner) this.state.setVar('VAR_MAP_SCENE_TRAINER_TOWER', 0);
      this.state.setVar('VAR_LAST_TALKED', 1);
      return { map: 'MAP_TRAINER_TOWER_LOBBY', x: 4, y: 11 };
    }
    const locs = this.assets.scripts.healLocations;
    const last = this.state.lastHealLocation;
    let i = last ? locs.findIndex((h) => h.map === last.map) : -1; // GetHealLocationIndexFromMapGroupAndNum
    if (i < 0) {
      console.warn('[whiteout] no heal location for', last?.map, '- using Pallet Town');
      i = this.defines.require('HEAL_LOCATION_PALLET_TOWN') - 1;
    }
    const { respawnMap: map, respawnNpc: healer } = locs[i];
    const at = (x: number, y: number) => ({ map, x, y, healer });
    switch (map) {
      case 'MAP_PALLET_TOWN_PLAYERS_HOUSE_1F':
        return at(8, 5);
      case 'MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F':
        return at(13, 12);
      case 'MAP_ONE_ISLAND_POKEMON_CENTER_1F':
        return at(5, 4);
      case 'MAP_TRAINER_TOWER_LOBBY':
        this.state.setVar('VAR_MAP_SCENE_TRAINER_TOWER', 0);
        return at(4, 11);
      default:
        return at(7, 4);
    }
  }

  /** ComputeWhiteOutMoneyLoss: highest party level * 4 * a multiplier by badge count, capped at your money. */
  whiteOutMoneyLoss(): number {
    const { moneyLossMultipliers, moneyLossBadgeFlags } = this.assets.scripts.whiteOut;
    const badges = moneyLossBadgeFlags.filter((f) => this.state.getFlag(f)).length;
    const topLevel = this.state.party.reduce((m, p) => (!p.isEgg && p.level > m ? p.level : m), 0); // GetPlayerPartyHighestLevel
    return Math.min(topLevel * 4 * moneyLossMultipliers[badges], this.state.money);
  }

  /** BattleSetup_GetTerrainId (no surfing yet, so the PLAYER_AVATAR_FLAG_SURFING checks are skipped) */
  private battleTerrainId(): number {
    const d = this.defines;
    const b = this.behaviors;
    const behavior = this.world.tileAt(this.player.tileX, this.player.tileY).behavior;
    if (b.isTallGrass(behavior)) return d.require('BATTLE_TERRAIN_GRASS');
    // MetatileBehavior_IsLongGrass is always FALSE in FRLG
    if (b.isSandOrShallowFlowingWater(behavior)) return d.require('BATTLE_TERRAIN_SAND');
    switch (this.world.current.data.mapType) {
      case 'MAP_TYPE_TOWN':
      case 'MAP_TYPE_CITY':
      case 'MAP_TYPE_ROUTE':
        break;
      case 'MAP_TYPE_UNDERGROUND':
        if (b.isIndoorEncounter(behavior)) return d.require('BATTLE_TERRAIN_BUILDING');
        if (b.isSurfable(behavior)) return d.require('BATTLE_TERRAIN_POND');
        return d.require('BATTLE_TERRAIN_CAVE');
      case 'MAP_TYPE_INDOOR':
      case 'MAP_TYPE_SECRET_BASE':
        return d.require('BATTLE_TERRAIN_BUILDING');
      case 'MAP_TYPE_UNDERWATER':
        return d.require('BATTLE_TERRAIN_UNDERWATER');
      case 'MAP_TYPE_OCEAN_ROUTE':
        if (b.isSurfable(behavior)) return d.require('BATTLE_TERRAIN_WATER');
        return d.require('BATTLE_TERRAIN_PLAIN');
    }
    if (b.isDeepWaterTerrain(behavior)) return d.require('BATTLE_TERRAIN_WATER');
    if (b.isSurfable(behavior)) return d.require('BATTLE_TERRAIN_POND');
    if (b.isMountain(behavior)) return d.require('BATTLE_TERRAIN_MOUNTAIN');
    return d.require('BATTLE_TERRAIN_PLAIN');
  }

  // ------------------------------------------------------------------ player avatar

  /** What field_player_avatar.c (world/playerAvatar.ts) reads and does on the field. */
  private createAvatarHost(): PlayerAvatarHost {
    const scene = this;
    const objects = () => [this.player, ...this.npcs.map((n) => n.brain.obj)];
    return {
      get player() {
        return scene.player;
      },
      behaviors: this.behaviors,
      behaviorAt: (x, y) => this.world.tileAt(x, y).behavior,
      elevationAt: (x, y) => this.world.tileAt(x, y).elevation,
      collisionAt: (obj, x, y, dir) => this.collisionAt(obj, x, y, dir),
      objectAt: (x, y) => objects().find((o) => o.tileX === x && o.tileY === y), // GetObjectEventIdByXY
      // GetObjectEventIdByPosition (ObjectEventDoesElevationMatch)
      objectAtPosition: (x, y, elevation) =>
        objects().find((o) => o.tileX === x && o.tileY === y && (o.currentElevation === 0 || elevation === 0 || o.currentElevation === elevation)),
      graphicsIdOf: (obj) => obj.graphicsId || undefined,
      flag: (name) => this.state.getFlag(name),
      allowRunning: () => this.world.current.data.allowRunning,
      allowCycling: () => this.world.current.data.allowCycling,
      mapId: () => this.world.current.data.id,
      spriteInfo: (gfxId) => {
        const info = this.assets.sprites[gfxId];
        return info && this.textures.exists(spriteTextureKey(info)) ? info : undefined;
      },
      lockPlayerFieldControls: () => this.controlsLocked++,
      unlockPlayerFieldControls: () => (this.controlsLocked = Math.max(0, this.controlsLocked - 1)),
      freezeObjectEvents: () => (this.objectsFrozen = true),
      unfreezeObjectEvents: () => (this.objectsFrozen = false),
      createTask: (tick) => this.fieldTasks.push({ tick }),
      startDust: (x, y, elevation, priority) => this.fieldEffects.dust(x, y, elevation, priority),
      boulderPushed: (boulder) => this.boulderPushed(boulder),
      startSurfBlob: () => StartPlayerSurfBlob(),
      stopSurfBlob: () => SetPlayerSurfBlobBobState(BOB_MON_ONLY),
      destroySurfBlob: () => DestroyPlayerSurfBlob(),
      setSurfBlobInvisible: (invisible) => SetPlayerSurfBlobInvisible(invisible),
      partyKnowsSurf: () => {
        const surf = this.defines.require('MOVE_SURF');
        return this.state.party.some((m) => m.moves.includes(surf));
      },
    };
  }

  // ------------------------------------------------------------------ field items

  /** What the bag's field items (menus/itemUse.ts' ItemUseOnFieldCB_*, world/fishing.ts) read and do on the field. */
  private createFieldItemsHost(): FieldItemsHost {
    return {
      openMessageBox: () => this.messageBox.open(),
      printMessage: (str, x, speed, fill) => this.messageBox.print(str, { x, speed, fill }),
      showMessage: (str, fontId) => this.messageBox.show(str, 'neutral', false, false, fontId),
      messagePrinting: () => this.messageBox.isPrinting,
      clearMessageBox: () => this.messageBox.hide(),
      dismissMapNamePopup: () => this.mapNamePopup?.dismiss(),
      aButtonNew: () => this.buttons.pressed('A'),
      objectEventAnims: (table) => this.assets.fieldEffectObjects.objectEventAnims?.[table],
      doesCurrentMapHaveFishingMons: () => this.wild.doesCurrentMapHaveFishingMons(),
      fishingWildEncounter: (rod) => this.wild.fishingWildEncounter(rod),
      fadeScreen: (mode, delay) => this.screenFade.begin(mode, delay),
      paletteFadeActive: () => this.screenFade.active,
      openScreenFromField: (init, gfxSymbols) => this.openItemScreenFromField(init, gfxSymbols),
    };
  }

  /** What the VS Seeker (world/vsSeeker.ts) reads and does on the field. */
  private createVsSeekerHost(): VsSeekerHost {
    const brainOf = (obj: ObjectEvent) => this.npcs.find((n) => n.brain.obj === obj)?.brain;
    return {
      objectTemplates: () => {
        const cur = this.world.current;
        return this.templatesFor(cur).map((template, i) => {
          const n = this.npcByLocalId(i + 1, cur);
          return { localId: i + 1, template, obj: n?.brain.obj };
        });
      },
      objectEvents: () => this.npcs.map((n) => n.brain.obj),
      movementType: (obj) => brainOf(obj)?.movementType,
      setTrainerMovementType: (obj, movementType) => brainOf(obj)?.setMovementType(movementType),
      singleMovementActive: (obj) => !!brainOf(obj)?.singleMovementActive,
      setTemplateMovementType: (localId, movementType) => this.setObjectTemplate(localId, { movementType }),
      trainerOfScript: (script) => this.scripts.trainerScriptBattle(script)?.trainer ?? 0,
      selectedObject: () => this.selectedObject,
      startFieldEffect: (fldEff, obj) => this.fieldEffects.start(fldEff, obj),
      rematches: this.assets.scripts.rematches,
    };
  }

  // ------------------------------------------------------------------ field moves

  /** What the field moves (world/fieldMoves.ts, world/fieldMoveShowMon.ts) read and do on the field. */
  private createFieldMoveHost(): FieldMoveHost {
    const d = this.defines;
    let sweetScent: ScreenFade | undefined;
    let lastWarpIsExit = false;
    return {
      scene: this,
      mapType: () => this.mapType(this.world.current.data),
      allowEscaping: () => !!this.world.current.data.allowEscaping,
      cave: () => !!this.world.current.data.cave,
      useFlash: () => this.useFlash(),
      mapId: () => this.world.current.data.id,
      playerLocal: () => this.playerLocal(),
      tileAt: (x, y) => this.world.tileAt(x, y),
      setMetatileIdAt: (x, y, metatile) => {
        const chunk = this.world.chunkAt(x, y);
        chunk?.setBlock(x - chunk.originX, y - chunk.originY, metatile);
      },
      localToWorld: (x, y) => ({ x: this.world.current.originX + x, y: this.world.current.originY + y }),
      localIdOf: (obj) => this.npcs.find((n) => n.brain.obj === obj)?.localId,
      setupScript: (label) => this.startFieldScript(label),
      scriptContextEnable: () => this.scripts.scriptContextEnable(),
      rockSmashWildEncounter: () => this.wild.rockSmashWildEncounter(),
      sweetScentWildEncounter: () => {
        const { x, y } = this.player.current; // PlayerGetDestCoords
        return this.wild.sweetScentWildEncounter(this.world.tileAt(x, y));
      },
      // Over the field but under the player, whose palette the fade leaves out (see docs/DEVIATIONS.md).
      sweetScentFade: (from, to) => {
        sweetScent ??= new ScreenFade(this, { FADE_FROM_BLACK: 0, FADE_TO_BLACK: 1, FADE_FROM_WHITE: 2, FADE_TO_WHITE: 3 }, DEPTH_SWEET_SCENT);
        this.player.fixedPriority = true;
        this.player.sprite.setDepth(DEPTH_SWEET_SCENT + 1);
        sweetScent.beginBlend(from, to, 0xff0000, 4);
        return () => {
          sweetScent!.tick();
          return !sweetScent!.active;
        };
      },
      clearSweetScentFade: () => {
        sweetScent?.clear();
        this.player.fixedPriority = false;
      },
      gbaScreenGfxSymbols: () => fieldGbaScreenGfxSymbols(this.fieldGbaSource()),
      startGbaScreen: () => this.gbaScreen.start(this.fieldGbaSource()),
      stopGbaScreen: () => this.gbaScreen.stop(),
      cameraTop: () => this.field.cameraTop,
      warpFadeOutScreen: (mapId, fadeOutMusic = false) => {
        let started = false;
        const name = this.assets.mapNameForId(mapId);
        if (name) {
          void this.assets.loadMap(name).then((to) => {
            if (fadeOutMusic) TryFadeOutOldMapMusic(to);
            this.warpFadeOutScreen(this.world.current.data, to);
            started = true;
          });
        } else {
          this.screenFade.begin(d.require('FADE_TO_BLACK'));
          started = true;
        }
        return () => started && !this.screenFade.active && (!fadeOutMusic || BGMusicStopped());
      },
      warpIntoMap: (mapId, x, y, fieldCallback, warpId = -1) => {
        const name = this.assets.mapNameForId(mapId);
        if (!name) {
          console.warn('[warp] unknown map', mapId);
          return;
        }
        void this.loadWarpedMap(name, warpId, x, y, this.screenFade.white).then(async (isExit) => {
          lastWarpIsExit = isExit;
          if (fieldCallback) {
            fieldCallback(); // gFieldCallback, instead of FieldCB_DefaultWarpExit
          } else {
            // FieldCB_DefaultWarpExit (DoDiveWarp); Task_ExitNonDoor / Task_ExitDoor end in UnfreezeObjectEvents
            // and UnlockPlayerFieldControls
            await this.defaultWarpExit(isExit);
            this.objectsFrozen = false;
            UnlockPlayerFieldControls();
          }
          this.busy = false;
        });
      },
      warpDestination: async () => {
        await this.warpSetup;
        return this.warpDestination;
      },
      setCameraPanning: (dy) => this.setCameraPanning(dy),
      warpFadeInScreen: () => {
        this.warpFadeInScreen(lastWarpIsExit);
        return () => !this.screenFade.active;
      },
      loadMapSection: async (mapId) => {
        const name = this.assets.mapNameForId(mapId);
        if (!name) return d.require('MAPSEC_NONE');
        return d.get((await this.assets.loadMap(name)).regionMapSection ?? '') ?? d.require('MAPSEC_NONE');
      },
      loadMapHeader: async (mapId) => {
        const name = this.assets.mapNameForId(mapId);
        if (!name) return undefined;
        const m = await this.assets.loadMap(name);
        return { mapsec: d.get(m.regionMapSection ?? '') ?? d.require('MAPSEC_NONE'), mapType: this.mapType(m), width: m.width, height: m.height };
      },
      healLocation: (id) => this.assets.scripts.healLocations[id - 1],
      camera: () => {
        const view = this.cameras.main.worldView;
        return { x: Math.round(view.x), y: Math.round(view.y) };
      },
      createFieldEffectSprite: (fldEff, template, x, y, subpriority, callback) => this.fieldEffects.createSprite(fldEff, template, x, y, subpriority, callback),
    };
  }

  /** HandleBoulderFallThroughHole + HandleBoulderActivateVictoryRoadSwitch (field_control_avatar.c) */
  private boulderPushed(boulder: ObjectEvent): void {
    const { x, y } = boulder.current;
    const behavior = this.world.tileAt(x, y).behavior;
    const cur = this.world.current;
    const npc = this.npcs.find((n) => n.brain.obj === boulder && n.chunk === cur);
    if (this.behaviors.is(behavior, 'FALL_WARP') && npc) {
      // RemoveObjectEventByLocalIdAndMap, then FlagClear(GetBoulderRevealFlagByLocalIdAndMap): a boulder's
      // template keeps the flag of its twin on the floor below in its trainer type.
      PlaySE(K.SE_FALL);
      const reveal = this.templatesFor(cur)[npc.localId - 1]?.trainer_type;
      this.removeObject(npc.localId);
      if (reveal && reveal.startsWith('FLAG_')) this.state.setFlag(reveal, false);
    }
    if (this.behaviors.is(behavior, 'STRENGTH_BUTTON')) {
      for (const e of cur.data.coordEvents) {
        if (e.x === x - cur.originX && e.y === y - cur.originY && e.script && e.script !== '0x0') this.startFieldScript(e.script);
      }
    }
  }

  // ------------------------------------------------------------------ trainer sight

  private createTrainerSeeHost(): TrainerSeeHost {
    const scene = this;
    return {
      get player() {
        return scene.player;
      },
      // QOL: only the current map's objects. The GBA has no others alive, except the previous map's
      // until they scroll off screen; those can spot the player there.
      sightCandidates: () =>
        this.npcs
          .filter((n) => n.chunk === this.world.current)
          .map((n) => ({
            obj: n.brain.obj,
            localId: n.localId,
            trainerType: n.brain.data.trainer_type,
            range: this.state.value(n.brain.data.trainer_sight_or_berry_tree_id || '0'),
            script: n.brain.data.script,
          })),
      collisionFlagsAt: (obj, x, y, dir) => this.collisionFlagsAt(obj, x, y, dir),
      trainerScriptBattle: (script) => this.scripts.trainerScriptBattle(script),
      trainerFlag: (trainer) => this.scripts.trainerFlag(trainer),
      cannotDoubleBattle: () => this.scripts.monsStateToDoubles() !== this.defines.require('PLAYER_HAS_TWO_USABLE_MONS'),
      configureAndSetUpOneTrainerBattle: (c) => {
        this.selectedObject = c.obj; // gSelectedObjectEvent
        this.scripts.npcTextColor = textColorFromId(c.obj.info.textColor, this.defines);
        this.scripts.setUpTrainerBattleFromApproach(c.localId, c.script);
      },
      startFieldEffect: (fldEff, obj) => this.fieldEffects.start(fldEff, obj),
      fieldEffectActive: (fldEff) => this.fieldEffects.isActive(fldEff),
      isActive: (obj) => obj.sprite.active,
      settleTrainer: (obj, movementType) => {
        const n = this.npcs.find((o) => o.brain.obj === obj);
        if (!n) return;
        n.brain.setMovementType(movementType); // SetTrainerMovementType
        if (n.chunk !== this.world.current) return;
        // OverrideMovementTypeForObjectEvent + OverrideTemplateCoordsForObjectEvent
        const cur = this.world.current;
        this.setObjectTemplate(n.localId, { x: obj.tileX - cur.originX, y: obj.tileY - cur.originY, movementType });
      },
      spawnCameraObject: () => this.spawnCameraObject(),
      removeCameraObject: () => this.removeCameraObject(),
    };
  }

  /**
   * SpawnCameraObject (field_specials.c): an invisible object (LOCALID_CAMERA) on the player's tile, elevation 3,
   * that the camera follows instead of the player.
   */
  spawnCameraObject(): ObjectEvent {
    this.removeCameraObject();
    // OBJ_EVENT_GFX_YOUNGSTER in the C; it's invisible, so any loaded sprite will do.
    const cam = new ObjectEvent(this, this.player.info, this.player.tileX, this.player.tileY, this.field, 3);
    cam.setVisible(false);
    this.cameraObject = cam;
    this.cameras.main.startFollow(cam.anchor, true, 1, 1, 0, CAMERA_FOLLOW_OFFSET_Y);
    return cam;
  }

  /** RemoveCameraObject: CameraObjectSetFollowedObjectId(player) + RemoveObjectEventByLocalIdAndMap(LOCALID_CAMERA) */
  removeCameraObject(): void {
    if (!this.cameraObject) return;
    this.cameraObject.destroy();
    this.cameraObject = undefined;
    this.cameras.main.startFollow(this.player.anchor, true, 1, 1, 0, CAMERA_FOLLOW_OFFSET_Y);
  }

  /**
   * GetCollisionFlagsAtCoords without bit 0 (outside the movement range), which trainer sight masks
   * out. Only `obj` that isn't the player is passed, so the camera check (trackedByCamera) never applies.
   */
  private collisionFlagsAt(obj: ObjectEvent, x: number, y: number, dir: Direction): number {
    const t = this.world.tileAt(x, y);
    const from = this.world.tileAt(obj.tileX, obj.tileY); // currentMetatileBehavior
    let flags = 0;
    // MapGridGetCollisionAt, GetMapBorderIdAt == CONNECTION_INVALID (tileAt makes the border impassable),
    // IsMetatileDirectionallyImpassable
    if (t.collision !== 0 || this.behaviors.blocksMove(from.behavior, t.behavior, dir)) flags |= COLLISION_FLAG_IMPASSABLE;
    if (isElevationMismatchAt(obj.currentElevation, t.elevation)) flags |= COLLISION_FLAG_ELEVATION_MISMATCH;
    if (this.objectCollidesAt(obj, x, y)) flags |= COLLISION_FLAG_OBJECT;
    return flags;
  }

  /** DoesObjectCollideWithObjectAt: another object on (x, y) or just leaving it, at a compatible elevation. */
  private objectCollidesAt(obj: ObjectEvent, x: number, y: number): boolean {
    for (const o of [this.player, ...this.npcs.map((n) => n.brain.obj)]) {
      if (o === obj) continue;
      const p = o.previous;
      if (!((o.tileX === x && o.tileY === y) || (p.x === x && p.y === y))) continue;
      if (areElevationsCompatible(obj.currentElevation, o.currentElevation)) return true;
    }
    return false;
  }

  clearRematchStateByTrainerId(trainer: number): void {
    ClearRematchStateByTrainerId(trainer);
  }

  endTrainerApproach(): Wait {
    return this.trainerApproach?.start() ?? (() => true);
  }

  startFieldEffect(fldEff: string, obj: ObjectEvent): boolean {
    return this.fieldEffects.start(fldEff, obj);
  }

  mapSection(): string {
    return this.world.current.data.regionMapSection ?? 'MAPSEC_NONE';
  }

  resolveLocalId(name: string): number | undefined {
    const i = this.templatesFor(this.world.current).findIndex((t) => t.local_id === name);
    return i < 0 ? undefined : i + 1;
  }

  selectObject(localId: number): void {
    this.selectedObject = this.objectByLocalId(localId);
  }

  setObjectMovementType(obj: ObjectEvent, movementType: string): void {
    this.npcs.find((n) => n.brain.obj === obj)?.brain.setMovementType(movementType);
  }

  objectByLocalId(localId: number): ObjectEvent | undefined {
    if (localId === this.defines.require('LOCALID_PLAYER')) return this.player;
    return this.npcByLocalId(localId)?.brain.obj;
  }

  removeObject(localId: number): void {
    const t = this.templatesFor(this.world.current)[localId - 1];
    if (t?.flag && t.flag !== '0') this.state.setFlag(t.flag, true);
    const n = this.npcByLocalId(localId);
    if (n) {
      n.brain.obj.destroy();
      this.npcs.splice(this.npcs.indexOf(n), 1);
    }
  }

  addObject(localId: number): void {
    if (this.npcByLocalId(localId)) return;
    const t = this.templatesFor(this.world.current)[localId - 1];
    if (!t) return;
    const n = this.spawnNpc({ ...t, flag: '0' }, localId);
    if (n) this.npcs.push(n);
  }

  setObjectTemplate(localId: number, patch: { x?: number; y?: number; movementType?: string }): void {
    const t = this.templatesFor(this.world.current)[localId - 1];
    if (!t) return;
    if (patch.x !== undefined) t.x = patch.x;
    if (patch.y !== undefined) t.y = patch.y;
    if (patch.movementType !== undefined) t.movement_type = patch.movementType;
  }

  setObjectPosition(localId: number, x: number, y: number): void {
    const cur = this.world.current;
    this.objectByLocalId(localId)?.setPosition(cur.originX + x, cur.originY + y);
  }

  /** FieldAnimateDoorOpen / FieldAnimateDoorClose at map-local coords (opendoor / closedoor). */
  animateDoor(x: number, y: number, open: boolean): void {
    const { originX, originY } = this.world.current;
    if (open) this.doors.animateOpen(x + originX, y + originY);
    else this.doors.animateClose(x + originX, y + originY);
  }

  /** GetDoorSoundEffect at map-local coords (opendoor) */
  doorSoundEffect(x: number, y: number): number {
    const { originX, originY } = this.world.current;
    return this.doors.getDoorSoundEffect(x + originX, y + originY);
  }

  /** FieldIsDoorAnimationRunning (waitdooranim) */
  doorAnimationRunning(): boolean {
    return this.doors.running;
  }

  /** FieldSetDoorOpened / FieldSetDoorClosed at map-local coords (setdooropen / setdoorclosed). */
  setDoor(x: number, y: number, open: boolean): void {
    const { originX, originY } = this.world.current;
    if (open) this.doors.setOpened(x + originX, y + originY);
    else this.doors.setClosed(x + originX, y + originY);
  }

  setMetatile(x: number, y: number, metatile: number, impassable: boolean): void {
    this.world.current.setBlock(x, y, metatile | (impassable ? MAPGRID_COLLISION_MASK : 0));
  }

  warp(mapId: string, warpId: number, x: number, y: number, kind: WarpKind = 'warp'): void {
    const name = this.assets.mapNameForId(mapId);
    if (!name) {
      console.warn('[warp] unknown map', mapId);
      return;
    }
    ResetInitialPlayerAvatarState(); // ScrCmd_warp
    void this.warpTo(name, warpId, x, y, kind);
  }

  playerLocal(): { x: number; y: number } {
    const cur = this.world.current;
    return { x: this.player.tileX - cur.originX, y: this.player.tileY - cur.originY };
  }

  // ------------------------------------------------------------------ input helpers

  /** FieldGetPlayerInput priority: up, down, left, right. */
  private heldDirection(): Direction | undefined {
    if (this.buttons.held('UP')) return 'up';
    if (this.buttons.held('DOWN')) return 'down';
    if (this.buttons.held('LEFT')) return 'left';
    if (this.buttons.held('RIGHT')) return 'right';
    return undefined;
  }

  private updateHud(): void {
    if (!this.hud.visible) return;
    const cur = this.world.current;
    const t = this.world.tileAt(this.player.tileX, this.player.tileY);
    this.hud.setText(
      `${cur.name} (${this.player.tileX - cur.originX},${this.player.tileY - cur.originY})\n` +
        `mt ${t.metatile} beh 0x${t.behavior.toString(16)} col ${t.collision} elev ${t.elevation}/${this.player.currentElevation} pri ${this.player.priority}`,
    );
  }
}

/** SetPlayerCoordsFromWarp: the warp event if the map has it, else (x, y), else the map's centre. */
/** Which of field_fadetransition.c's warps (OverworldScene.warpTo). */
type WarpKind = 'warp' | 'silent' | 'door';

function warpDestCoords(data: MapData, warpId: number, x: number, y: number): { x: number; y: number } {
  if (warpId >= 0 && warpId < data.warpEvents.length) return data.warpEvents[warpId];
  if (x >= 0 && y >= 0) return { x, y };
  return { x: Math.trunc(data.width / 2), y: Math.trunc(data.height / 2) };
}

/** CheckSilphScopeInPokemonTower: the floors whose wild mons are ghosts without the Silph Scope. */
// battle_setup.c: GetBattleTransitionTypeByMap's types, and the transitions for each. The first is used
// if the enemy pokemon are lower level than our pokemon, otherwise the second.
const TRANSITION_TYPE_NORMAL = 0;
const TRANSITION_TYPE_CAVE = 1;
const TRANSITION_TYPE_FLASH = 2;
const TRANSITION_TYPE_WATER = 3;
const sBattleTransitionTable_Wild = [
  ['B_TRANSITION_SLICE', 'B_TRANSITION_WHITE_BARS_FADE'], // TRANSITION_TYPE_NORMAL
  ['B_TRANSITION_CLOCKWISE_WIPE', 'B_TRANSITION_GRID_SQUARES'], // TRANSITION_TYPE_CAVE
  ['B_TRANSITION_BLUR', 'B_TRANSITION_GRID_SQUARES'], // TRANSITION_TYPE_FLASH
  ['B_TRANSITION_WAVE', 'B_TRANSITION_RIPPLE'], // TRANSITION_TYPE_WATER
];
const sBattleTransitionTable_Trainer = [
  ['B_TRANSITION_POKEBALLS_TRAIL', 'B_TRANSITION_ANGLED_WIPES'],
  ['B_TRANSITION_SHUFFLE', 'B_TRANSITION_BIG_POKEBALL'],
  ['B_TRANSITION_BLUR', 'B_TRANSITION_GRID_SQUARES'],
  ['B_TRANSITION_SWIRL', 'B_TRANSITION_RIPPLE'],
];

const POKEMON_TOWER_MAPS = ['1F', '2F', '3F', '4F', '5F', '6F', '7F'].map((f) => `MAP_POKEMON_TOWER_${f}`);

/** Whether a tile can be on the 15x10 screen around the player (with a tile's slack for scrolling). */
function onScreen(x: number, y: number, px: number, py: number): boolean {
  return Math.abs(x - px) <= 8 && y >= py - 6 && y <= py + 6;
}

/** Whether an object spawned from `a` is where and how template `b` would spawn it. */
function sameSpawn(a: ObjectEventData, b: ObjectEventData): boolean {
  return a.x === b.x && a.y === b.y && a.graphics_id === b.graphics_id && a.movement_type === b.movement_type;
}

/**
 * GetInteractedMetatileScript's behaviors (MB_* without the prefix): [script, player must face north,
 * MsgSetSignpost]. IsPolishedWindow and IsBeautifulSkyWindow are always FALSE in FRLG, so they're left out.
 */
const METATILE_SCRIPTS: Record<string, [string, boolean, boolean]> = {
  PC: ['EventScript_PC', false, false],
  REGION_MAP: ['EventScript_WallTownMap', false, false],
  BOOKSHELF: ['EventScript_Bookshelf', false, false],
  POKEMART_SHELF: ['EventScript_PokeMartShelf', false, false],
  FOOD: ['EventScript_Food', false, false],
  IMPRESSIVE_MACHINE: ['EventScript_ImpressiveMachine', false, false],
  BLUEPRINTS: ['EventScript_Blueprints', false, false],
  VIDEO_GAME: ['EventScript_VideoGame', false, false],
  BURGLARY: ['EventScript_Burglary', false, false],
  COMPUTER: ['EventScript_Computer', false, false],
  TRAINER_TOWER_MONITOR: ['TrainerTower_EventScript_ShowTime', false, false],
  TELEVISION: ['EventScript_PlayerFacingTVScreen', true, false],
  CABINET: ['EventScript_Cabinet', false, false],
  KITCHEN: ['EventScript_Kitchen', false, false],
  DRESSER: ['EventScript_Dresser', false, false],
  SNACKS: ['EventScript_Snacks', false, false],
  PAINTING: ['EventScript_Painting', false, false],
  POWER_PLANT_MACHINE: ['EventScript_PowerPlantMachine', false, false],
  TELEPHONE: ['EventScript_Telephone', false, false],
  ADVERTISING_POSTER: ['EventScript_AdvertisingPoster', false, false],
  FOOD_SMELLS_TASTY: ['EventScript_TastyFood', false, false],
  TRASH_BIN: ['EventScript_TrashBin', false, false],
  CUP: ['EventScript_Cup', false, false],
  BLINKING_LIGHTS: ['EventScript_BlinkingLights', false, false],
  NEATLY_LINED_UP_TOOLS: ['EventScript_NeatlyLinedUpTools', false, false],
  CABLE_CLUB_WIRELESS_MONITOR: ['CableClub_EventScript_ShowWirelessCommunicationScreen', true, false],
  QUESTIONNAIRE: ['EventScript_Questionnaire', false, false],
  BATTLE_RECORDS: ['CableClub_EventScript_ShowBattleRecords', true, false],
  INDIGO_PLATEAU_SIGN_1: ['EventScript_Indigo_UltimateGoal', false, true],
  INDIGO_PLATEAU_SIGN_2: ['EventScript_Indigo_HighestAuthority', false, true],
  POKEMART_SIGN: ['EventScript_PokemartSign', true, true],
  POKEMON_CENTER_SIGN: ['EventScript_PokecenterSign', true, true],
};

/** bg event player_facing_dir: BG_EVENT_PLAYER_FACING_ANY / _NORTH / _SOUTH / _EAST / _WEST. */
function signFacingOk(req: string, facing: Direction): boolean {
  const m = /FACING_(\w+)$/.exec(req);
  if (!m || m[1] === 'ANY') return true;
  return { NORTH: 'up', SOUTH: 'down', EAST: 'right', WEST: 'left' }[m[1]] === facing;
}

/** IsElevationMismatchAt */
function isElevationMismatchAt(elevation: number, mapElevation: number): boolean {
  if (elevation === 0) return false;
  if (mapElevation === 0 || mapElevation === 15) return false;
  return mapElevation !== elevation;
}

/** AreElevationsCompatible */
function areElevationsCompatible(a: number, b: number): boolean {
  if (a === 0 || b === 0) return true;
  return a === b;
}
