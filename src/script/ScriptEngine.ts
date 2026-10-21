import { avatarField, ClearPlayerHeldMovement, IsFreezePlayerFinished, ResetInitialPlayerAvatarState } from '../world/playerAvatar';
import { ActivatePerStepCallback } from '../world/fieldTasks'; // setstepcallback (W-sevii)
import type { ObjectEvent } from '../entities/ObjectEvent';
import type { Button, Input } from '../input/Input';
import type { NamingScreenRequest } from '../scenes/FieldMenuScene';
import type { Pokemon } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import type { Charmap } from '../text/charmap';
import type { MessageBox, TextColor } from '../text/MessageBox';
import { FONT_BRAILLE } from '../text/Font';
import { stringWidth } from '../text/stringWidth';
import { SCR_MENU_UNSET } from '../ui/MultichoiceMenu';
import type { YesNoMenu } from '../ui/YesNoMenu';
import { parseDirection, type Direction } from '../world/direction';
import { SPECIAL_VARS_END, SPECIAL_VARS_START, VARS_END, VARS_START, type Defines } from './Defines';
import { MovementRunner, towards, type Instruction } from './MovementRunner';
import { GetRematchTrainerId, IsTrainerReadyForRematch, ShouldTryRematchBattle, type RematchEnv } from '../world/rematches';
import type { FieldTask } from '../world/elevator';
import type { ListMenuHost } from '../ui/FieldListMenu';
import { SetFlashLevel } from '../world/flash';
import { MapPreview_SetFlag } from '../world/mapPreviewScreen';
import { DoCurrentWeather, SetSavedWeather, SetSavedWeatherFromCurrMapHeader } from '../world/weather';
import { SPECIALS, StartScriptedWildBattle, type SpecialEnv } from './specials';
import { PlaySlotMachineFromScript, registerGameCornerFieldEffects } from './gameCornerSpecials';
import { testEvent } from '../dev/testHooks';
import { random } from '../util/random';
import { FieldEffectActiveListContains, FieldEffectStart, gFieldEffectArguments } from '../world/fieldEffectScripts';
import { SetEscapeWarp } from '../world/fieldMoves';
import { scriptGiveEgg } from '../world/daycare';
import { FadeInBGM, FadeOutBGMTemporarily, IsBGMPausedOrStopped, IsFanfareTaskInactive, IsSEPlaying, Overworld_ChangeMusicTo, PlayFanfare, PlayNewMapMusic, PlaySE } from '../gba/sound';
import { IsCryFinished, PlayCry_Script } from '../gba/sound'; // the cries (W-sound 2)
import { Overworld_ChangeMusicToDefault, Overworld_SetSavedMusic } from '../gba/overworldMusic';
import { gStringVar4 } from '../menus/common';
import { K } from '../battle/constants';
import { gQL, QL_FinishRecordingScene, QL_GetPlaybackState } from '../world/questLog';
import { avoidDisplay } from './scriptMenuAvoidDisplay';
import { QuestLog_RecordEnteredMap, QuestLogEvents_HandleEndTrainerBattle } from '../world/questLogEvents';

export interface ScriptsData {
  code: Instruction[];
  labels: Record<string, number>;
  defines: Record<string, number>;
  stdScripts: string[];
  /** vs_seeker.c sRematches: each rematchable trainer's parties, SKIP = 0xFFFF. */
  rematches: number[][];
  /** heal_locations.json, indexed by HEAL_LOCATION_* - 1. */
  healLocations: HealLocation[];
  /** ComputeWhiteOutMoneyLoss tables (overworld.c). */
  whiteOut: { moneyLossMultipliers: number[]; moneyLossBadgeFlags: number[] };
  /** script_menu.c sMultichoiceLists: MULTICHOICE_* -> the list's string symbols */
  multichoices: (string[] | null)[];
  /** field_specials.c sListMenuLabels: LISTMENU_* -> special ListMenu's item strings */
  listMenus: (string[] | null)[];
}

/** sHealLocations + sWhiteoutRespawnHealCenterMapIdxs + sWhiteoutRespawnHealerNpcIds. */
export interface HealLocation {
  map: string;
  x: number;
  y: number;
  /** Where a white-out sends you (a Pokémon Center 1F, or the player's house). */
  respawnMap: string;
  /** LOCALID_* of the nurse (or Mom) on the respawn map. */
  respawnNpc: string;
}

/** What the interpreter needs from the overworld. Implemented by OverworldScene. */
export interface ScriptHost {
  readonly player: ObjectEvent;
  /** gSelectedObjectEvent: the NPC being talked to, if any. */
  readonly selectedObject?: ObjectEvent;
  objectByLocalId(localId: number): ObjectEvent | undefined;
  /** removeobject: set the object's hide flag and despawn it. */
  removeObject(localId: number): void;
  /**
   * addobject: spawn the object from the map template. FALSE while its sprite sheet is still loading (a dynamic
   * object whose VAR_OBJ_GFX_ID_* names a sheet the map didn't preload): nothing spawned yet, try again.
   */
  addObject(localId: number): boolean;
  /** gSelectedObjectEvent = the current map's object with this local id (SetMapVarsToTrainer). */
  selectObject(localId: number): void;
  /** SetTrainerMovementType: switch a live object to another MOVEMENT_TYPE_*. */
  setObjectMovementType(obj: ObjectEvent, movementType: string): void;
  /** setobjectxyperm / setobjectmovementtype: edit the map's object template. */
  setObjectTemplate(localId: number, patch: { x?: number; y?: number; movementType?: string }): void;
  setObjectPosition(localId: number, x: number, y: number): void;
  setMetatile(x: number, y: number, metatile: number, impassable: boolean): void;
  /** opendoor / closedoor (FieldAnimateDoorOpen / FieldAnimateDoorClose), map-local coords */
  animateDoor(x: number, y: number, open: boolean): void;
  /** GetDoorSoundEffect at map-local coords (opendoor) */
  doorSoundEffect(x: number, y: number): number;
  /** FieldIsDoorAnimationRunning */
  doorAnimationRunning(): boolean;
  /** setdooropen / setdoorclosed (FieldSetDoorOpened / FieldSetDoorClosed), map-local coords */
  setDoor(x: number, y: number, open: boolean): void;
  /** DoWarp (`kind` 'warp'), DoDiveWarp ('silent': no SE_EXIT) or DoDoorWarp ('door') to a map's warp or position. */
  warp(mapId: string, warpId: number, x: number, y: number, kind?: 'warp' | 'silent' | 'door'): void;
  /** Map-local player coordinates. */
  playerLocal(): { x: number; y: number };
  /** DisplayYesNoMenuDefaultYes */
  openYesNo(): YesNoMenu;
  /** DrawMoneyBox / ChangeAmountInMoneyBox / HideMoneyBox (money.c) */
  showMoneyBox(x: number, y: number): void;
  updateMoneyBox(): void;
  hideMoneyBox(): void;
  /** ShowCoinsWindow / PrintCoinsString / HideCoinsWindow (coins.c) */
  showCoinsBox(x: number, y: number): void;
  updateCoinsBox(): void;
  hideCoinsBox(): void;
  /** ScriptMenu_Multichoice(WithDefault) or, with `columns`, ScriptMenu_MultichoiceGrid. */
  openMultichoice(opts: MultichoiceRequest): { tick(): boolean; result: number };
  /** DrawElevatorCurrentFloorWindow / CloseElevatorCurrentFloorWindow (FLOOR_NAMES index, or undefined to close) */
  elevatorFloorWindow(floor: number | undefined): void;
  /** CreateTask for a field task that outlives the script command that started it. */
  startFieldTask(task: FieldTask): void;
  /** SetCameraPanning(dx, dy) relative to the standard pan (dx: ShakeScreen's horizontal shake) */
  setCameraPanning(dy: number, dx?: number): void;
  /** CreatePokemartMenu (shop.c): the wait ends when the player leaves the shop menu. */
  openPokemart(items: number[]): Wait;
  /** ShowPokemonStorageSystemPC: the PC's storage menu and box screens; the wait ends when the player leaves it. */
  openPokemonStoragePc(): Wait;
  /** PlayerPC / BedroomPC: the item storage menus; the wait ends when the player turns the PC off. */
  openPlayerPc(notInRoom?: boolean): Wait;
  /** EnterHallOfFame: the Hall of Fame screen; the field comes back through its warp into Indigo Plateau. */
  enterHallOfFame(): void;
  /** HallOfFamePCBeginFade: the Hall of Fame PC, then the PC menu again (its choice in `result`). */
  openHallOfFamePc(): { tick(): boolean; result: number };
  /** DoCredits (credits.c): the credits on the field's GBA layer; they end in a reset, never back to the script. */
  doCredits(): void;
  /** SpawnCameraObject / RemoveCameraObject (field_specials.c) */
  spawnCameraObject(): unknown;
  removeCameraObject(): void;
  /** SetWarpDestination without warping (setwarp): used by the next WarpIntoMap. */
  setWarpDestination(mapId: string, warpId: number, x: number, y: number): void;
  /** LOCALID_* names are generated per map from map.json `local_id` fields. */
  resolveLocalId(name: string): number | undefined;
  /** ScriptMenu_ShowPokemonPic */
  showMonPic(species: number, x: number, y: number): void;
  /** ScriptMenu_HidePokemonPic: a wait that ends once the box is gone, or undefined if none is shown. */
  hideMonPic(): Wait | undefined;
  /** PicboxCancel: remove the picture box at once. */
  cancelMonPic(): void;
  /** Field_AskSaveTheGame: the SAVE dialog (ui/SaveDialog.ts); `tick()` is RunSaveDialogCB (SAVECB_RETURN_*). */
  createSaveDialog(): { tick(): number };
  /** CreatePCMenuWindow + CreateMCMenuInputHandlerTask */
  openPcMenu(): { tick(): boolean; result: number };
  /** FadeScreen(mode, delay): returns a wait for IsPaletteNotActive. */
  fadeScreen(mode: number, delay?: number): Wait;
  /**
   * DoNamingScreen from a black field, returning through CB2_ReturnToFieldContinueScriptPlayMapMusic:
   * the wait ends once the field has faded back in.
   */
  doNamingScreen(req: NamingScreenRequest): Wait;
  /** ShowTownMap: the wall map (menus/regionMap.ts, REGIONMAP_TYPE_WALL) from a black field, like doNamingScreen. */
  showTownMap(): Wait;
  /**
   * A special's SetMainCallback2 to a GBA-layer screen that `init` starts (the party menu, the summary screen).
   * The wait ends when it is back on the field and RunFieldCallback's gFieldCallback(2) has finished.
   * `gfxSymbols`: what the screen draws beyond what prepareMenus loads (e.g. the move relearner's).
   */
  runScreenFromScript(init: () => void, gfxSymbols?: string[]): Wait;
  /** StartTrainerBattle: `done` ends when the battle is over (screen still black), with the outcome. */
  startTrainerBattle(battle: TrainerBattle): TrainerBattleRun;
  /** ClearRematchStateByTrainerId (world/vsSeeker.ts), at the end of every trainer battle. */
  clearRematchStateByTrainerId?(trainer: number): void;
  /** A non-trainer battle against `enemyParty` (gEnemyParty) behind a B_TRANSITION_*, e.g. StartOldManTutorialBattle. */
  /** `battleStartTask` false: the caller's own task starts the transition (Task_DoTrainerTowerBattle), not Task_BattleStart. */
  startScriptedBattle(battleTypeFlags: number, enemyParty: Pokemon[], transition: number, song?: number, battleStartTask?: boolean): TrainerBattleRun;
  /** GetWildBattleTransition against gEnemyParty[0] = `enemy`. */
  wildBattleTransition(enemy: Pokemon): number;
  /** FieldEffectStart for an effect over `obj` (the emote icons); false if it isn't ported. */
  startFieldEffect(fldEff: string, obj: ObjectEvent): boolean;
  /** EndTrainerApproach: start the approach of the trainer that saw the player; the wait ends with it. */
  endTrainerApproach(): Wait;
  /** CB2_WhiteOut: from the black screen after a lost battle to the last heal location. */
  whiteOut(): void;
  /** ComputeWhiteOutMoneyLoss */
  whiteOutMoneyLoss(): number;
  /** GetCurrentRegionMapSectionId, for a new mon's met location. */
  mapSection(): string;
  /** What special ListMenu draws with (ui/FieldListMenu.ts). */
  listMenuHost(): ListMenuHost;
  /** AnimateFlash (world/flash.ts): the wait ends once the flash circle has finished changing. */
  animateFlash(newFlashLevel: number): Wait;
}

export interface MultichoiceRequest {
  left: number;
  top: number;
  /** MULTICHOICE_* */
  mcId: number;
  /** sMultichoiceLists[mcId]'s texts, encoded */
  items: number[][];
  ignoreBPress: boolean;
  initPos: number;
  /** multichoicegrid's column count */
  columns?: number;
  /** A window of a fixed size and row height (a special's own CreateWindowFromRect: DrawSeagallopDestinationMenu). */
  layout?: { width: number; height: number; rowHeight: number };
}

export interface TrainerBattleRun {
  done: Wait;
  playerWon(): boolean;
  /** CB2_ReturnToFieldContinueScriptPlayMapMusic: fade the field back in. */
  returnToField(): Wait;
}

/** The trainer battle configured by `trainerbattle` (battle_setup.c statics). */
export interface TrainerBattle {
  mode: number;
  trainer: number;
  /** Object local id, or the RIVAL_BATTLE_* flags for TRAINER_BATTLE_EARLY_RIVAL. */
  localIdOrFlags: number;
  introText?: string;
  defeatText?: string;
  victoryText?: string;
  cannotBattleText?: string;
  beatenScript?: string;
  /** sTrainerBattleEndScript: the instruction after `trainerbattle`. */
  returnPc: number;
}

export type Wait = () => boolean;

/** Comparison result from `compare`/`checkflag`, consumed by the condition table below. */
const enum Cmp {
  Less,
  Equal,
  Greater,
}

// sScriptConditionTable: rows = condition (LT, EQ, GT, LE, GE, NE), cols = comparison result.
const CONDITIONS: Record<string, [boolean, boolean, boolean]> = {
  lt: [true, false, false],
  eq: [false, true, false],
  gt: [false, false, true],
  le: [true, true, false],
  ge: [false, true, true],
  ne: [true, false, true],
};
const CONDITION_IDS = ['lt', 'eq', 'gt', 'le', 'ge', 'ne'];

const MAX_STEPS_PER_TICK = 10_000;

/** One running script (struct ScriptContext). */
class ScriptContext {
  pc: number;
  stack: number[] = [];
  data: (string | number)[] = [0, 0, 0, 0];
  cmp = Cmp.Equal;
  wait?: Wait;
  done = false;

  constructor(
    pc: number,
    readonly label: string,
  ) {
    this.pc = pc;
  }
}

/**
 * SetupNativeScript + RunScriptCommand's SCRIPT_MODE_NATIVE (script.c): the script stops for this frame; from the
 * next frame on, `native` is called once per frame, and the frame it returns TRUE the script still stops (the
 * mode goes back to bytecode), so the next command runs the frame after. The audio waits (`waitse`, `waitfanfare`,
 * `fadeoutbgm`) use it: their checks read the engine's state, which only changes at the end of a frame.
 */
function SetupNativeScript(ctx: ScriptContext, native: () => boolean): void {
  let setUp = true;
  let finished = false;
  ctx.wait = () => {
    if (setUp) {
      setUp = false;
      return false;
    }
    if (finished) return true;
    finished = native();
    return false;
  };
}

/**
 * Interpreter for the decomp's event scripts at source-macro level (msgbox, goto_if_eq, ...).
 * The decomp's own std scripts (Std_MsgboxNPC etc.) supply higher-level behaviour, so only
 * low-level commands live here.
 */
export class ScriptEngine {
  private ctx?: ScriptContext;
  private movements: MovementRunner[] = [];
  private warned = new Set<string>();
  /** Default colour for the NPC being talked to (GetColorFromTextColorTable). */
  npcTextColor: TextColor = 'neutral';
  /** Set by specials that the script then blocks on with `waitstate`. */
  private waitState?: Wait;
  private battle?: TrainerBattle;
  private specialEnv: SpecialEnv;
  /** sMsgIsSignpost (script.c): the message box uses the signpost frame. */
  private msgIsSignpost = false;
  /** sMsgBoxIsCancelable: a walked-into sign's message can be walked away from. */
  private msgBoxIsCancelable = false;
  /** sMsgBoxWalkawayDisabled (DisableMsgBoxWalkaway) */
  private msgBoxWalkawayDisabled = false;
  /** gWalkAwayFromSignInhibitTimer */
  private walkAwayFromSignInhibitTimer = 0;
  /** sQuestLogInput / sQuestLogInputIsDpad: the key that dismissed a script's last message, replayed as field input. */
  private registeredInput?: Button;
  private registeredInputIsDpad = false;
  /** ScriptContext_Enable was called for a script a field effect stopped (`dofieldeffect` + `waitstate`). */
  private enableRequested = false;
  /**
   * The script stopped mid-frame for a sprite sheet still loading (`addobject` of a dynamic-graphics object): the
   * field holds the rest of the frame (no input, no logic, no VBlank) until it's in, then calls `tick` again to run
   * the frame on from the script, so the object comes out in the frame SpawnObjectEventInternal spawns it in.
   */
  frameHeld = false;

  constructor(
    private data: ScriptsData,
    private defines: Defines,
    private state: GameState,
    private strings: Record<string, string>,
    private charmap: Charmap,
    private messageBox: MessageBox,
    private input: Input,
    private host: ScriptHost,
  ) {
    registerGameCornerFieldEffects(host, defines); // FldEff_SmileyFaceIcon, FldEff_PhotoFlash
    this.specialEnv = {
      state,
      host,
      setWaitState: (w) => (this.waitState = w),
      stopScript: (w) => {
        if (this.ctx) this.ctx.wait = w;
      },
      showFieldMessage: (label) => {
        this.showFieldMessage(label);
        return () => !this.messageBox.isPrinting;
      },
      endScript: () => {
        if (this.ctx) this.ctx.done = true;
      },
      setupScript: (label) => {
        if (this.ctx) this.ctx.done = true;
        this.start(label);
      },
      disableMsgBoxWalkaway: () => (this.msgBoxWalkawayDisabled = true),
      setWalkingIntoSignVars: () => this.setWalkingIntoSignVars(),
      trainerBattle: () => this.battle,
      input,
      hideFieldMessageBox: () => this.messageBox.hide(),
      encodeText: (label) => this.charmap.encodePlain(this.strings[label] ?? ''),
      warnOnce: (key, message) => {
        if (this.warned.has(key)) return;
        this.warned.add(key);
        console.warn(message);
      },
    };
  }

  get running(): boolean {
    return this.ctx !== undefined;
  }

  /** ScriptContext_Init: no script runs (the quest log's playback map loads drop what a scene started). */
  init(): void {
    this.ctx = undefined;
    this.frameHeld = false;
  }

  /** The label the running script was started from (dev/test probes). */
  get runningLabel(): string | undefined {
    return this.ctx?.label;
  }

  hasLabel(label: string): boolean {
    return label in this.data.labels;
  }

  /** Dev / tests: add a script of raw commands ([op, ...args], as the extractor writes them) under `label`. */
  defineScript(label: string, code: Instruction[]): void {
    this.data.labels[label] = this.data.code.length;
    this.data.code.push(...code, ['end']);
  }

  /** ScriptContext_SetupScript: start a script in the global context. */
  start(label: string): boolean {
    const pc = this.data.labels[label];
    if (pc === undefined) {
      console.warn('[script] missing label', label);
      return false;
    }
    this.ctx = new ScriptContext(pc, label);
    this.frameHeld = false;
    // A `dofieldeffect` whose script ended without its `waitstate` (EventScript_DeepWater: FLDEFF_USE_DIVE runs on
    // after the script) leaves no wait for the next script's `waitstate`.
    this.waitState = undefined;
    testEvent('script', { label });
    this.msgBoxIsCancelable = false; // ClearMsgBoxCancelableState
    this.msgBoxWalkawayDisabled = false; // EnableMsgBoxWalkaway
    this.registeredInputIsDpad = false; // ClearQuestLogInputIsDpadFlag
    // ResetContextNpcTextColor (via ResetFacingNpcOrSignpostVars on field input)
    // Approximation: the GBA does this in ProcessPlayerFieldInput before any interaction, not per script.
    this.state.setVar('VAR_TEXT_COLOR', this.defines.require('NPC_TEXT_COLOR_DEFAULT'));
    return true;
  }

  /** ScriptContext_Enable: a field effect lets the script it stopped with `waitstate` run on. */
  scriptContextEnable(): void {
    this.enableRequested = true;
  }

  /** RunScriptImmediately: for map scripts that must finish synchronously (no waits). */
  runImmediately(label: string): void {
    const pc = this.data.labels[label];
    if (pc === undefined) return;
    const ctx = new ScriptContext(pc, label);
    const frameHeld = this.frameHeld; // (an `addobject` here can't hold the frame: the field's own script's state)
    for (let i = 0; i < MAX_STEPS_PER_TICK && !ctx.done; i++) {
      this.step(ctx);
      if (ctx.wait) {
        console.warn('[script] immediate script tried to wait:', label);
        break;
      }
    }
    this.frameHeld = frameHeld;
  }

  /** Advance scripts, movements and the message box by one frame. */
  tick(): void {
    // (a held frame's movements ran before the script stopped)
    if (!this.frameHeld) {
      for (const m of this.movements) m.tick();
      this.movements = this.movements.filter((m) => !m.done);
    }

    const ctx = this.ctx;
    if (!ctx) return;
    for (let i = 0; i < MAX_STEPS_PER_TICK; i++) {
      if (ctx.wait) {
        if (!ctx.wait()) return;
        ctx.wait = undefined;
      }
      if (ctx.done) break;
      this.step(ctx);
    }
    if (ctx.done && this.ctx === ctx) this.ctx = undefined; // (a special may have set up another script: setupScript)
  }

  // ---------------------------------------------------------------- map script tables

  /** Find a MAP_SCRIPT_* entry in a map's `<Map>_MapScripts` header. */
  mapScript(mapName: string, type: string): string | undefined {
    let i = this.data.labels[`${mapName}_MapScripts`];
    if (i === undefined) return undefined;
    for (; i < this.data.code.length; i++) {
      const [op, t, label] = this.data.code[i];
      if (op !== 'map_script') return undefined;
      if (t === type) return label;
    }
    return undefined;
  }

  /** ON_FRAME_TABLE / ON_WARP_INTO_MAP_TABLE: first `map_script_2 VAR, value, script` that matches. */
  mapScriptTable(tableLabel: string): string | undefined {
    let i = this.data.labels[tableLabel];
    if (i === undefined) return undefined;
    for (; i < this.data.code.length; i++) {
      const [op, v, value, label] = this.data.code[i];
      if (op !== 'map_script_2') return undefined;
      if (this.state.getVar(v) === this.state.value(value)) return label;
    }
    return undefined;
  }

  // ---------------------------------------------------------------- interpreter

  private step(ctx: ScriptContext): void {
    const ins = this.data.code[ctx.pc++];
    if (!ins || ins[0].startsWith('.')) {
      ctx.done = true; // ran off the end into data
      return;
    }
    const [op, ...a] = ins;
    const handler = (this.commands as Record<string, (ctx: ScriptContext, a: string[]) => void>)[op];
    if (handler) handler.call(this, ctx, a);
    else this.unimplemented(op, a);
  }

  private unimplemented(op: string, a: string[]): void {
    if (!this.warned.has(op)) {
      this.warned.add(op);
      console.warn('[script] unimplemented command', op, a.join(', '));
    }
  }

  private jump(ctx: ScriptContext, label: string): void {
    const pc = this.data.labels[label];
    if (pc === undefined) {
      console.warn('[script] missing label', label);
      ctx.done = true;
      return;
    }
    ctx.pc = pc;
  }

  private call(ctx: ScriptContext, label: string): void {
    ctx.stack.push(ctx.pc);
    this.jump(ctx, label);
  }

  private compare(ctx: ScriptContext, a: number, b: number): void {
    ctx.cmp = a < b ? Cmp.Less : a === b ? Cmp.Equal : Cmp.Greater;
  }

  private test(ctx: ScriptContext, cond: string): boolean {
    const c = CONDITIONS[cond] ?? CONDITIONS[CONDITION_IDS[Number(this.defines.get(cond))]];
    return c ? c[ctx.cmp] : false;
  }

  /**
   * The `compare` macro's second operand (event.inc, also behind goto_if_eq & co. and `case`): a var
   * (compare_var_to_var) only in VARS_START..VARS_END or SPECIAL_VARS_START..SPECIAL_VARS_END, else a value
   * (compare_var_to_value), so Selphy's `goto_if_eq VAR_RESORT_GORGEOUS_REQUESTED_MON, 0xFFFF` compares with 0xFFFF.
   */
  private compareArg(token: string): number {
    const n = this.defines.get(token) ?? 0;
    const isVar = (n >= VARS_START && n <= VARS_END) || (n >= SPECIAL_VARS_START && n <= SPECIAL_VARS_END);
    return isVar ? this.state.getVar(n) : n;
  }

  /** goto_if_eq/call_if_eq etc.: `VAR, value, label` (or `label` alone to reuse the last compare). */
  private condBranch(ctx: ScriptContext, a: string[], cond: string, isCall: boolean): void {
    let label: string;
    if (a.length >= 3) {
      this.compare(ctx, this.state.getVar(a[0]), this.compareArg(a[1]));
      label = a[2];
    } else {
      label = a[0];
    }
    if (this.test(ctx, cond)) {
      if (isCall) this.call(ctx, label);
      else this.jump(ctx, label);
    }
  }

  private flagBranch(ctx: ScriptContext, a: string[], wantSet: boolean, isCall: boolean): void {
    if (this.state.getFlag(a[0]) === wantSet) {
      if (isCall) this.call(ctx, a[1]);
      else this.jump(ctx, a[1]);
    }
  }

  /** Object id argument: a number, a var (VarGet), or a map-specific LOCALID_* name. */
  private localId(token: string): number {
    if (this.defines.get(token) !== undefined) return this.state.value(token);
    const id = this.host.resolveLocalId(token);
    if (id === undefined) console.warn('[script] unknown object id', token);
    return id ?? 0;
  }

  private objectArg(token: string): ObjectEvent | undefined {
    return this.host.objectByLocalId(this.localId(token));
  }

  private stringFor(ctx: ScriptContext, token: string): number[] | undefined {
    const label = token === '0x0' || token === '0' ? String(ctx.data[0]) : token;
    if (label === 'gStringVar4') return [...gStringVar4]; // `msgbox gStringVar4` (the Trainer Tower's speeches)
    const raw = this.strings[label];
    if (raw === undefined) {
      console.warn('[script] missing text', label);
      return undefined;
    }
    return this.charmap.encode(raw);
  }

  private showMessage(ctx: ScriptContext, token: string): void {
    const bytes = this.stringFor(ctx, token);
    if (bytes) this.messageBox.show(bytes, this.contextTextColor(), this.msgIsSignpost);
  }

  /** MsgSetSignpost */
  msgSetSignpost(): void {
    this.msgIsSignpost = true;
  }

  /** ResetFacingNpcOrSignpostVars' MsgSetNotSignpost, on every frame the field controls are free. */
  msgSetNotSignpost(): void {
    this.msgIsSignpost = false;
  }

  /** SetWalkingIntoSignVars */
  setWalkingIntoSignVars(): void {
    this.walkAwayFromSignInhibitTimer = 6;
    this.msgBoxIsCancelable = true;
  }

  /**
   * FieldInput_HandleCancelSignpost: while a walked-into sign's script runs, a direction other than the
   * player's facing (or START) cancels it with EventScript_CancelMessageBox. Returns true if START did, so
   * the caller opens the start menu once the controls are free (Task_QuestLogPlayback_OpenStartMenu).
   */
  handleCancelSignpost(dpad: Direction | undefined, facing: Direction, pressedStart: boolean): boolean {
    if (!this.ctx) return false;
    if (this.walkAwayFromSignInhibitTimer !== 0) {
      this.walkAwayFromSignInhibitTimer--;
      return false;
    }
    if (!this.msgBoxIsCancelable) return false;
    if (dpad !== undefined && dpad !== facing) {
      if (this.msgBoxWalkawayDisabled) return false;
      this.registeredInput = DPAD_BUTTONS[dpad]; // RegisterQuestLogInput
      this.start('EventScript_CancelMessageBox');
      return false;
    }
    if (pressedStart) {
      this.start('EventScript_CancelMessageBox');
      return true;
    }
    return false;
  }

  /**
   * QuestLogOverrideJoyVars (FieldGetPlayerInput, once the script has ended): the key that dismissed the
   * last message, to be treated as this frame's only held and new key.
   */
  takeRegisteredInput(): Button | undefined {
    if (this.ctx || !this.registeredInputIsDpad) return undefined;
    const b = this.registeredInput;
    this.registeredInput = undefined; // ClearQuestLogInput
    return b;
  }

  /** ScriptContext_NextCommandEndsScript: the next command (or the one a `return` goes back to) is release(all). */
  private nextCommandEndsScript(ctx: ScriptContext): boolean {
    let op = this.data.code[ctx.pc]?.[0];
    if (op === 'return') op = this.data.code[ctx.stack[ctx.stack.length - 1] ?? -1]?.[0];
    return op === 'release' || op === 'releaseall';
  }

  /** ScriptContext_GetQuestLogInput: the input that may dismiss a script's last message besides A/B. */
  private questLogInput(): Button | undefined {
    const inp = this.input;
    const facing = this.state.getVar('VAR_FACING');
    for (const [dir, b] of Object.entries(DPAD_BUTTONS) as [Direction, Button][]) {
      if (inp.held(b) && facing !== directionId(dir, this.defines)) return b;
    }
    if (inp.pressed('L')) return 'L';
    for (const b of ['R', 'START', 'SELECT'] as const) if (inp.held(b)) return b;
    return undefined;
  }

  /**
   * The multichoice commands' arguments are bytes in the script, not vars. DrawVerticalMultichoiceMenu (multichoice,
   * multichoicedefault) asks QL_AvoidDisplay unless bit 1 of ignoreBPress is set (the nurse's YES/NO, which neither
   * cuts a recording nor is skipped in playback); ScriptMenu_MultichoiceGrid always asks. Avoided in playback, the
   * script stays stopped (ScriptContext_Stop) until QL_DestroyAbortedDisplay replaces it.
   */
  private multichoice(ctx: ScriptContext, args: { left: string; top: string; mcId: string; ignoreBPress: string; initPos?: string; columns?: string }): void {
    const d = this.defines;
    const mcId = d.require(args.mcId);
    const items = this.data.multichoices[mcId];
    if (!items) {
      console.warn('[script] unknown multichoice', args.mcId);
      return;
    }
    this.state.setVar('VAR_RESULT', SCR_MENU_UNSET);
    const ignoreBPress = d.require(args.ignoreBPress);
    if ((args.columns !== undefined || (ignoreBPress & 2) === 0) && avoidDisplay(this.specialEnv)) {
      ctx.wait = () => false;
      return;
    }
    const menu = this.host.openMultichoice({
      left: d.require(args.left),
      top: d.require(args.top),
      mcId,
      items: items.map((label) => this.charmap.encode(this.strings[label] ?? '?$')),
      ignoreBPress: (ignoreBPress & 1) !== 0,
      initPos: args.initPos !== undefined ? d.require(args.initPos) : 0,
      columns: args.columns !== undefined ? d.require(args.columns) : undefined,
    });
    ctx.wait = () => {
      if (!menu.tick()) return false;
      this.state.setVar('VAR_RESULT', menu.result);
      // Task_MultichoiceMenu_HandleInput's ScriptContext_Enable: the script goes on in the next frame's
      // ScriptContext_RunScript, so the A that chose can't also pick from a menu the script opens next (the event
      // tickets' MULTICHOICE_SEVII_NAVEL etc. lead on to DrawSeagallopDestinationMenu) or pass a `waitbuttonpress`.
      ctx.wait = () => true;
      return false;
    };
  }

  /** ContextNpcGetTextColor */
  contextTextColor(): TextColor {
    const c = this.state.getVar('VAR_TEXT_COLOR');
    if (c !== this.defines.require('NPC_TEXT_COLOR_DEFAULT')) return textColorFromId(c, this.defines);
    return this.host.selectedObject ? this.npcTextColor : 'neutral';
  }

  /** The `stringvar` macro: STR_VAR_1..3 -> 0..2, anything else is a literal index. */
  private stringVar(token: string): number {
    const m = /^STR_VAR_([123])$/.exec(token.trim());
    return m ? Number(m[1]) - 1 : (this.defines.get(token) ?? 0);
  }

  /** The script commands this interpreter handles (tests/unit/scriptCoverage.test.ts). */
  get commandNames(): string[] {
    return Object.keys(this.commands);
  }

  private callSpecial(name: string): number | void {
    if (TRAINER_SPECIALS.has(name)) return this.trainerSpecial(name);
    const special = SPECIALS[name];
    if (special) return special(this.specialEnv);
    this.unimplemented(`special ${name}`, []);
  }

  private commands = {
    // ------------------------------------------------ flow
    end(ctx: ScriptContext) {
      ctx.done = true;
    },
    return(ctx: ScriptContext) {
      const pc = ctx.stack.pop();
      if (pc === undefined) ctx.done = true;
      else ctx.pc = pc;
    },
    goto(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.jump(ctx, a[0]);
    },
    call(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.call(ctx, a[0]);
    },
    nop() {},
    nop1() {},
    compare(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.compare(ctx, this.state.getVar(a[0]), this.compareArg(a[1]));
    },
    compare_var_to_value(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.compare(ctx, this.state.getVar(a[0]), this.defines.get(a[1]) ?? 0);
    },
    compare_var_to_var(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.compare(ctx, this.state.getVar(a[0]), this.state.getVar(a[1]));
    },
    goto_if(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      if (this.test(ctx, a[0])) this.jump(ctx, a[1]);
    },
    call_if(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      if (this.test(ctx, a[0])) this.call(ctx, a[1]);
    },
    goto_if_set(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.flagBranch(ctx, a, true, false);
    },
    goto_if_unset(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.flagBranch(ctx, a, false, false);
    },
    call_if_set(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.flagBranch(ctx, a, true, true);
    },
    call_if_unset(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.flagBranch(ctx, a, false, true);
    },
    goto_if_lt(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'lt', false);
    },
    goto_if_eq(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'eq', false);
    },
    goto_if_gt(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'gt', false);
    },
    goto_if_le(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'le', false);
    },
    goto_if_ge(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'ge', false);
    },
    goto_if_ne(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'ne', false);
    },
    call_if_lt(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'lt', true);
    },
    call_if_eq(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'eq', true);
    },
    call_if_gt(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'gt', true);
    },
    call_if_le(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'le', true);
    },
    call_if_ge(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'ge', true);
    },
    call_if_ne(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.condBranch(ctx, a, 'ne', true);
    },
    /** switch VAR → copyvar VAR_0x8000; each `case value, label` compares against it. */
    switch(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar('VAR_0x8000', this.state.getVar(a[0]));
    },
    case(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.compare(ctx, this.state.getVar('VAR_0x8000'), this.compareArg(a[0]));
      if (ctx.cmp === Cmp.Equal) this.jump(ctx, a[1]);
    },
    goto_if_defeated(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      if (this.trainerDefeated(a[0])) this.jump(ctx, a[1]);
    },
    goto_if_not_defeated(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      if (!this.trainerDefeated(a[0])) this.jump(ctx, a[1]);
    },
    /** event.inc's call_if_defeated: checktrainerflag + call_if TRUE (Rocket Hideout B4F's door grunts). */
    call_if_defeated(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.cmp = this.trainerDefeated(a[0]) ? Cmp.Equal : Cmp.Less;
      if (this.test(ctx, 'TRUE')) this.call(ctx, a[1]);
    },
    /** call_if_not_defeated: checktrainerflag + call_if FALSE (Rocket Hideout B1F's barrier). */
    call_if_not_defeated(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.cmp = this.trainerDefeated(a[0]) ? Cmp.Equal : Cmp.Less;
      if (this.test(ctx, 'FALSE')) this.call(ctx, a[1]);
    },
    callstd(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      const label = this.data.stdScripts[this.defines.get(a[0]) ?? -1];
      if (label) this.call(ctx, label);
    },
    gotostd(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      const label = this.data.stdScripts[this.defines.get(a[0]) ?? -1];
      if (label) this.jump(ctx, label);
    },

    // ------------------------------------------------ flags & vars
    setflag(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setFlag(a[0], true);
    },
    clearflag(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setFlag(a[0], false);
    },
    checkflag(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.cmp = this.state.getFlag(a[0]) ? Cmp.Equal : Cmp.Less; // goto_if TRUE tests EQ against 1
    },
    setworldmapflag(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      QuestLog_RecordEnteredMap(this.defines.require(a[0])); // before the flag is set
      MapPreview_SetFlag(a[0], this.state);
    },
    setvar(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar(a[0], this.defines.get(a[1]) ?? this.host.resolveLocalId(a[1]) ?? 0);
    },
    addvar(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar(a[0], this.state.getVar(a[0]) + this.state.value(a[1]));
    },
    subvar(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar(a[0], this.state.getVar(a[0]) - this.state.value(a[1]));
    },
    copyvar(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar(a[0], this.state.getVar(a[1]));
    },
    setorcopyvar(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar(a[0], this.state.value(a[1]));
    },
    random(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar('VAR_RESULT', random() % Math.max(1, this.state.value(a[0]))); // ScrCmd_random
    },
    checkplayergender(this: ScriptEngine) {
      this.state.setVar('VAR_RESULT', this.state.playerGender === 'male' ? 0 : 1);
    },
    getplayerxy(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const { x, y } = this.host.playerLocal();
      this.state.setVar(a[0], x);
      this.state.setVar(a[1], y);
    },
    loadword(_ctx: ScriptContext, a: string[]) {
      _ctx.data[Number(a[0])] = a[1];
    },

    // ------------------------------------------------ text
    msgbox(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.data[0] = a[0];
      const label = this.data.stdScripts[this.defines.get(a[1] ?? 'MSGBOX_DEFAULT') ?? 4];
      if (label) this.call(ctx, label);
    },
    message(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.showMessage(ctx, a[0]);
    },
    messageautoscroll(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.showMessage(ctx, a[0]);
    },
    /**
     * ScrCmd_braillemessage: LoadStdWindowFrameGfx, DrawDialogueFrame(0, 1) (the dialogue frame, filled), then
     * AddTextPrinterParameterized(0, FONT_BRAILLE, msg, 0, 1, 0, NULL): at once (speed 0), in gFontInfos'
     * FONT_BRAILLE colours. The script doesn't wait: a `waitbuttonpress` follows.
     */
    braillemessage(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      const bytes = this.stringFor(ctx, a[0]);
      if (bytes) this.messageBox.show(bytes, 'neutral', false, true, FONT_BRAILLE);
    },
    /** ScrCmd_getbraillestringwidth: gSpecialVar_0x8004 = GetStringWidth(FONT_BRAILLE, msg, -1). */
    getbraillestringwidth(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      const bytes = this.stringFor(ctx, a[0]);
      if (bytes) this.state.setVar('VAR_0x8004', stringWidth(this.messageBox.fonts, FONT_BRAILLE, bytes, -1));
    },
    waitmessage(this: ScriptEngine, ctx: ScriptContext) {
      ctx.wait = () => !this.messageBox.isPrinting;
    },
    /**
     * ScrCmd_waitbuttonpress: WaitForAorBPress. Before a release, a held direction (other than the way the
     * player faced), L, R, START or SELECT also closes the message, and is then replayed as field input (not in the
     * quest log's playback). In playback the wait also ends by itself after 120 frames
     * (sQuestLogWaitButtonPressTimer), as A and B are the playback's skips.
     */
    waitbuttonpress(this: ScriptEngine, ctx: ScriptContext) {
      // SetupNativeScript(ctx, WaitForAorBPress): the script stops for this frame, so the A or B that let an
      // earlier wait through in this frame can't also pass this one (braillemessage_wait prints at once: one A
      // went through all of Mt. Ember B5F's messages). (The frame the press holds, the port goes on at once.)
      let setUp = true;
      const inPlayback = () => QL_GetPlaybackState() === K.QL_PLAYBACK_STATE_RUNNING || gQL.state === K.QL_STATE_PLAYBACK;
      let questLogTimer = 0; // sQuestLogWaitButtonPressTimer = 0 (in playback)
      ctx.wait = () => {
        if (setUp) {
          setUp = false;
          return false;
        }
        if (this.input.pressedAorB()) return true;
        if (this.nextCommandEndsScript(ctx)) {
          const b = this.questLogInput();
          if (b !== undefined && gQL.state !== K.QL_STATE_PLAYBACK) {
            this.registeredInput = b; // RegisterQuestLogInput
            this.msgBoxIsCancelable = false; // ClearMsgBoxCancelableState
            this.registeredInputIsDpad = true; // SetQuestLogInputIsDpadFlag (any key but A/B)
            return true;
          }
        }
        if (inPlayback()) {
          if (questLogTimer === 120) return true;
          questLogTimer++;
        }
        return false;
      };
    },
    closemessage(this: ScriptEngine) {
      this.messageBox.hide();
    },
    /** ScrCmd_textcolor: also saves the previous colour for EventScript_RestorePrevTextColor. */
    textcolor(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar('VAR_PREV_TEXT_COLOR', this.state.getVar('VAR_TEXT_COLOR'));
      this.state.setVar('VAR_TEXT_COLOR', this.defines.require(a[0]));
    },
    signmsg(this: ScriptEngine) {
      this.msgSetSignpost();
    },
    normalmsg(this: ScriptEngine) {
      this.msgSetNotSignpost();
    },
    /** ScriptMenu_YesNo: VAR_RESULT = TRUE for YES, FALSE for NO or B. Position args are ignored in FRLG. */
    yesnobox(this: ScriptEngine, ctx: ScriptContext) {
      this.state.setVar('VAR_RESULT', SCR_MENU_UNSET);
      // QL_AvoidDisplay: in playback no menu, and the script stays stopped until QL_DestroyAbortedDisplay
      if (avoidDisplay(this.specialEnv)) {
        ctx.wait = () => false;
        return;
      }
      const menu = this.host.openYesNo();
      ctx.wait = () => {
        if (!menu.tick()) return false;
        this.state.setVar('VAR_RESULT', menu.result ? 1 : 0);
        // Task_HandleYesNoInput's ScriptContext_Enable: the script goes on in the next frame's
        // ScriptContext_RunScript, so the A that chose can't also pass a `waitbuttonpress` or a menu after it.
        ctx.wait = () => true;
        return false;
      };
    },

    /** ScrCmd_multichoice: ScriptMenu_Multichoice, then VAR_RESULT = the choice or SCR_MENU_CANCEL. */
    multichoice(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.multichoice(ctx, { left: a[0], top: a[1], mcId: a[2], ignoreBPress: a[3] });
    },
    /** ScrCmd_multichoicedefault: ScriptMenu_MultichoiceWithDefault */
    multichoicedefault(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.multichoice(ctx, { left: a[0], top: a[1], mcId: a[2], initPos: a[3], ignoreBPress: a[4] });
    },
    /** ScrCmd_multichoicegrid: ScriptMenu_MultichoiceGrid */
    multichoicegrid(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.multichoice(ctx, { left: a[0], top: a[1], mcId: a[2], columns: a[3], ignoreBPress: a[4] });
    },

    // ------------------------------------------------ objects
    /**
     * ScrCmd_lock: FreezeObjects_WaitForPlayerAndSelected. Other objects already hold still while a
     * script runs, so this only waits for the player and the selected object to finish their steps.
     */
    lock(this: ScriptEngine, ctx: ScriptContext) {
      let player = false;
      ctx.wait = () => (player ||= IsFreezePlayerFinished()) && !this.host.selectedObject?.isMoving;
    },
    /** ScrCmd_lockall: FreezeObjects_WaitForPlayer (IsFreezePlayerFinished: the player stops and faces their way) */
    lockall(this: ScriptEngine, ctx: ScriptContext) {
      ctx.wait = () => IsFreezePlayerFinished();
    },
    /**
     * ScrCmd_release / ScrCmd_releaseall: both hide the field message box, and
     * ClearPlayerHeldMovementAndUnfreezeObjectEvents lets go of the player's finished movement and unfreezes
     * the objects a field task froze (FreezeObjectEvents: e.g. a registered Itemfinder's underfoot script).
     */
    release(this: ScriptEngine) {
      this.messageBox.hide();
      ClearPlayerHeldMovement();
      avatarField().unfreezeObjectEvents();
    },
    releaseall(this: ScriptEngine) {
      this.messageBox.hide();
      ClearPlayerHeldMovement();
      avatarField().unfreezeObjectEvents();
    },
    faceplayer(this: ScriptEngine) {
      const obj = this.host.selectedObject;
      if (obj) obj.face(towards(obj, this.host.player));
    },
    turnobject(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const dir = dirArg(a[1], this.defines);
      if (dir) this.objectArg(a[0])?.face(dir);
    },
    applymovement(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const obj = this.objectArg(a[0]);
      const pc = this.data.labels[a[1]];
      if (!obj || pc === undefined) return;
      this.movements = this.movements.filter((m) => m.obj !== obj);
      this.movements.push(new MovementRunner(obj, this.data.code, pc, this.host.player, (f, o) => this.host.startFieldEffect(f, o)));
    },
    waitmovement(this: ScriptEngine, ctx: ScriptContext) {
      ctx.wait = () => this.movements.length === 0;
    },
    removeobject(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.removeObject(this.localId(a[0]));
    },
    addobject(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      const localId = this.localId(a[0]);
      // SpawnObjectEventInternal loads the graphics from ROM in this frame. A sheet still loading (a VAR_OBJ_GFX_ID_*
      // just set to one the map didn't preload) holds the frame here until it's in (frameHeld); the object then
      // comes out and the script runs on, in the same frame.
      if (this.host.addObject(localId)) return;
      this.frameHeld = true;
      ctx.wait = () => {
        this.frameHeld = !this.host.addObject(localId);
        return !this.frameHeld;
      };
    },
    setobjectxy(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.setObjectPosition(this.localId(a[0]), this.state.value(a[1]), this.state.value(a[2]));
    },
    setobjectxyperm(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.setObjectTemplate(this.localId(a[0]), { x: this.state.value(a[1]), y: this.state.value(a[2]) });
    },
    /** ScrCmd_copyobjectxytoperm → TryOverrideObjectEventTemplateCoords: the template takes the object's current tile. */
    copyobjectxytoperm(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const obj = this.objectArg(a[0]);
      if (!obj) return;
      const p = this.host.player;
      const local = this.host.playerLocal(); // the current map's origin from the player's tile
      this.host.setObjectTemplate(this.localId(a[0]), { x: obj.current.x - (p.tileX - local.x), y: obj.current.y - (p.tileY - local.y) });
    },
    setobjectmovementtype(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.setObjectTemplate(this.localId(a[0]), { movementType: a[1] });
    },

    // ------------------------------------------------ world
    setmetatile(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.setMetatile(
        this.state.value(a[0]),
        this.state.value(a[1]),
        this.defines.get(a[2]) ?? 0,
        (this.defines.get(a[3] ?? 'FALSE') ?? 0) !== 0,
      );
    },
    /**
     * ScrCmd_setmaplayoutindex → SetCurrentMapLayout: gSaveBlock1Ptr->mapLayoutId = VarGet(arg). Only ON_TRANSITION
     * scripts use it; the field then loads that layout (OverworldScene.onMapLoaded, as InitMap follows the script).
     */
    setmaplayoutindex(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.mapLayoutId = this.state.value(a[0]);
    },
    warp(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.doWarp(ctx, a);
    },
    /** ScrCmd_setdynamicwarp: SetDynamicWarpWithCoords */
    setdynamicwarp(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const { warpId, x, y } = this.warpArgs(a);
      this.state.dynamicWarp = { mapId: a[0], warpId, x, y };
    },
    setwarp(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const { warpId, x, y } = this.warpArgs(a);
      this.host.setWarpDestination(a[0], warpId, x, y);
    },
    /** ScrCmd_warpsilent: DoDiveWarp (no SE_EXIT) */
    warpsilent(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.doWarp(ctx, a, 'silent');
    },
    /**
     * ScrCmd_warphole (W-sevii): SetWarpDestination(map, WARP_ID_NONE, the player's destination coords), then DoFallWarp
     * (world/fallWarp.ts, as `special DoFallWarp`) and ResetInitialPlayerAvatarState; the `waitstate` after it never
     * ends (the map load ends the script). MAP_UNDEFINED is SetWarpDestinationToFixedHoleWarp, which only R/S's
     * `setholewarp` sets (no FRLG script; only the unused EventScript_FallDownHole reaches it): logged, no warp.
     */
    warphole(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      if (a[0] === 'MAP_UNDEFINED') {
        console.warn('[script] warphole MAP_UNDEFINED: sFixedHoleWarp (setholewarp) is not ported');
        ctx.done = true;
        return;
      }
      const { x, y } = this.host.playerLocal(); // PlayerGetDestCoords
      this.host.setWarpDestination(a[0], -1, x, y);
      this.callSpecial('DoFallWarp');
      ResetInitialPlayerAvatarState();
    },
    /** ScrCmd_setstepcallback: ActivatePerStepCallback (world/fieldTasks.ts; W-sevii) */
    setstepcallback(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      ActivatePerStepCallback(this.state.value(a[0]));
    },
    /** ScrCmd_warpdoor: DoDoorWarp; the port goes straight to Task_DoorWarp's warp (no door anim; no FRLG script uses it) */
    warpdoor(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.doWarp(ctx, a, 'door');
    },
    /** ScrCmd_opendoor: PlaySE(GetDoorSoundEffect), then FieldAnimateDoorOpen */
    opendoor(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const x = this.state.value(a[0]);
      const y = this.state.value(a[1]);
      PlaySE(this.host.doorSoundEffect(x, y));
      this.host.animateDoor(x, y, true);
    },
    closedoor(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.animateDoor(this.state.value(a[0]), this.state.value(a[1]), false);
    },
    /** ScrCmd_waitdooranim: IsDoorAnimationStopped */
    waitdooranim(this: ScriptEngine, ctx: ScriptContext) {
      ctx.wait = () => !this.host.doorAnimationRunning();
    },
    setdooropen(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.setDoor(this.state.value(a[0]), this.state.value(a[1]), true);
    },
    setdoorclosed(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.host.setDoor(this.state.value(a[0]), this.state.value(a[1]), false);
    },
    delay(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      let frames = this.state.value(a[0]);
      ctx.wait = () => --frames <= 0;
    },
    // ------------------------------------------------ flash (scrcmd.c; world/flash.ts)
    /** ScrCmd_animateflash: AnimateFlash(level) + ScriptContext_Stop until Task_WaitForFlashUpdate re-enables it. */
    animateflash(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.wait = this.host.animateFlash(this.defines.require(a[0]));
    },
    /** ScrCmd_setflashlevel: SetFlashLevel(VarGet(level)) */
    setflashlevel(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      SetFlashLevel(this.state, this.state.value(a[0]));
    },
    // ------------------------------------------------ weather (scrcmd.c; world/weather.ts)
    /** ScrCmd_setweather: SetSavedWeather(VarGet(weather)) */
    setweather(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      SetSavedWeather(this.state.value(a[0]));
    },
    /** ScrCmd_resetweather: SetSavedWeatherFromCurrMapHeader */
    resetweather(this: ScriptEngine) {
      SetSavedWeatherFromCurrMapHeader();
    },
    /** ScrCmd_doweather: DoCurrentWeather (the change itself runs in the weather task) */
    doweather() {
      DoCurrentWeather();
    },

    /** ScrCmd_waitstate: block until the task a special started re-enables the script. */
    waitstate(this: ScriptEngine, ctx: ScriptContext) {
      const w = this.waitState;
      this.waitState = undefined;
      if (w) ctx.wait = w;
    },
    special(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.callSpecial(a[0]);
    },
    specialvar(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const r = this.callSpecial(a[1]);
      this.state.setVar(a[0], typeof r === 'number' ? r : 0);
    },

    // ------------------------------------------------ field effects and field moves (W-fieldmove)
    /**
     * ScrCmd_dofieldeffect: FieldEffectStart runs the effect's field effect script. A following `waitstate`
     * waits for the effect's ScriptContext_Enable; if the effect isn't ported (it took itself off the active
     * list again) the script runs on as before.
     */
    dofieldeffect(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const fldeff = this.fieldEffectName(a[0]);
      this.enableRequested = false;
      FieldEffectStart(fldeff);
      if (FieldEffectActiveListContains(fldeff) || this.enableRequested) {
        this.waitState = () => {
          if (!this.enableRequested) return false;
          this.enableRequested = false;
          return true;
        };
      }
    },
    /** ScrCmd_waitfieldeffect: WaitForFieldEffectFinish */
    waitfieldeffect(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      const fldeff = this.fieldEffectName(a[0]);
      ctx.wait = () => !FieldEffectActiveListContains(fldeff);
    },
    /** ScrCmd_setfieldeffectargument: gFieldEffectArguments[n] = (s16)VarGet(value) */
    setfieldeffectargument(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const v = this.defines.get(a[1]) !== undefined ? this.state.value(a[1]) : (this.host.resolveLocalId(a[1]) ?? 0);
      gFieldEffectArguments[Number(a[0])] = (v << 16) >> 16;
    },
    /** ScrCmd_checkpartymove: VAR_RESULT = the first non-egg party mon that knows the move (VAR_0x8004 = its species), else PARTY_SIZE. */
    checkpartymove(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const move = this.state.value(a[0]);
      this.state.setVar('VAR_RESULT', this.defines.require('PARTY_SIZE'));
      for (const [i, mon] of this.state.party.entries()) {
        if (!mon.species) break;
        if (!mon.isEgg && mon.moves.includes(move)) {
          this.state.setVar('VAR_RESULT', i);
          this.state.setVar('VAR_0x8004', mon.species);
          break;
        }
      }
    },
    /** ScrCmd_buffermovename */
    buffermovename(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.stringVars[this.stringVar(a[0])] = this.charmap.encodePlain(this.state.pokemon.moves[this.state.value(a[1])]?.name ?? '$');
    },
    /** ScrCmd_setescapewarp: `MAP, warpId, x, y` or `MAP, x, y` */
    setescapewarp(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const { warpId, x, y } = this.warpArgs(a);
      SetEscapeWarp(a[0], warpId, x, y);
    },

    fadescreen(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.wait = this.host.fadeScreen(this.state.value(a[0]));
    },
    /** ScrCmd_fadescreenspeed: FadeScreen(mode, speed), waiting for IsPaletteNotActive */
    fadescreenspeed(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.wait = this.host.fadeScreen(this.state.value(a[0]), this.state.value(a[1]));
    },

    // ------------------------------------------------ money (a non-zero second argument disables the command)
    addmoney(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      if (!this.state.value(a[1] ?? '0')) this.state.addMoney(this.state.value(a[0]));
    },
    removemoney(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      if (!this.state.value(a[1] ?? '0')) this.state.removeMoney(this.state.value(a[0]));
    },
    /** ScrCmd_showmoneybox: DrawMoneyBox unless `ignore` or QL_AvoidDisplay (the script goes on either way) */
    showmoneybox(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      if (!this.state.value(a[2] ?? '0') && !avoidDisplay(this.specialEnv)) this.host.showMoneyBox(this.state.value(a[0]), this.state.value(a[1]));
    },
    updatemoneybox(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      if (!this.state.value(a[0] ?? '0')) this.host.updateMoneyBox();
    },
    hidemoneybox(this: ScriptEngine) {
      this.host.hideMoneyBox();
    },
    /** ScrCmd_checkmoney: VAR_RESULT = IsEnoughMoney */
    checkmoney(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      if (!this.state.value(a[1] ?? '0')) this.state.setVar('VAR_RESULT', this.state.money >= this.state.value(a[0]) ? 1 : 0);
    },

    /**
     * ScrCmd_pokemart: CreatePokemartMenu with the `.2byte` item list at the label (up to ITEM_NONE), then
     * ScriptContext_Stop until the shop's callback (ScriptContext_Enable) runs.
     */
    pokemart(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      const items: number[] = [];
      let pc = this.data.labels[a[0]];
      if (pc === undefined) {
        console.warn('[script] missing pokemart list', a[0]);
        return;
      }
      for (let ins = this.data.code[pc]; ins?.[0] === '.2byte'; ins = this.data.code[++pc]) {
        const item = this.defines.require(ins[1]);
        items.push(item);
        if (item === 0) break;
      }
      ctx.wait = this.host.openPokemart(items);
    },

    // ------------------------------------------------ items
    additem(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const ok = this.state.bag.add(this.state.value(a[0]), this.state.value(a[1] ?? '1'));
      this.state.setVar('VAR_RESULT', ok ? 1 : 0);
    },
    removeitem(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const ok = this.state.bag.remove(this.state.value(a[0]), this.state.value(a[1] ?? '1'));
      this.state.setVar('VAR_RESULT', ok ? 1 : 0);
    },
    checkitem(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const ok = this.state.bag.has(this.state.value(a[0]), this.state.value(a[1] ?? '1'));
      this.state.setVar('VAR_RESULT', ok ? 1 : 0);
    },
    checkitemspace(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const ok = this.state.bag.hasSpace(this.state.value(a[0]), this.state.value(a[1] ?? '1'));
      this.state.setVar('VAR_RESULT', ok ? 1 : 0);
    },
    /** GetPocketByItemId */
    checkitemtype(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar('VAR_RESULT', this.state.pokemon.itemPocket(this.state.value(a[0])));
    },

    // ------------------------------------------------ decorations (scrcmd.c: FRLG has no secret base, so each one
    // reads its argument with VarGet and does nothing else; the RSE calls are commented out in the C)
    /** ScrCmd_adddecoration: `gSpecialVar_Result = DecorationAdd(decorId)` is commented out; VAR_RESULT is left alone. */
    adddecoration(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.value(a[0]); // VarGet(ScriptReadHalfword(ctx))
    },
    /** ScrCmd_removedecoration: `DecorationRemove` is commented out. */
    removedecoration(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.value(a[0]);
    },
    /** ScrCmd_checkdecor: `CheckHasDecoration` is commented out. */
    checkdecor(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.value(a[0]);
    },
    /** ScrCmd_checkdecorspace: `DecorationCheckSpace` is commented out. */
    checkdecorspace(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.value(a[0]);
    },

    // ------------------------------------------------ coins
    checkcoins(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar(a[0], this.state.coins);
    },
    /** ScrCmd_addcoins: VAR_RESULT is FALSE on success */
    addcoins(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar('VAR_RESULT', this.state.addCoins(this.state.value(a[0])) ? 0 : 1);
    },
    removecoins(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar('VAR_RESULT', this.state.removeCoins(this.state.value(a[0])) ? 0 : 1);
    },
    /** ScrCmd_showcoinsbox: ShowCoinsWindow(GetCoins(), x, y) unless QL_AvoidDisplay */
    showcoinsbox(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      if (!avoidDisplay(this.specialEnv)) this.host.showCoinsBox(this.state.value(a[0]), this.state.value(a[1]));
    },
    /** ScrCmd_updatecoinsbox: PrintCoinsString(GetCoins()); the x, y it reads are unused */
    updatecoinsbox(this: ScriptEngine) {
      this.host.updateCoinsBox();
    },
    /** ScrCmd_hidecoinsbox: HideCoinsWindow(); the x, y it reads are unused */
    hidecoinsbox(this: ScriptEngine) {
      this.host.hideCoinsBox();
    },
    /** ScrCmd_playslotmachine: PlaySlotMachine(VarGet(id), CB2_ReturnToFieldContinueScriptPlayMapMusic), ScriptContext_Stop */
    playslotmachine(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.wait = PlaySlotMachineFromScript(this.host, this.state.value(a[0]) & 0xff);
    },

    // ------------------------------------------------ string buffers
    bufferspeciesname(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.stringVars[this.stringVar(a[0])] = [...this.state.pokemon.speciesName(this.state.value(a[1]))];
    },
    bufferleadmonspeciesname(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const lead = this.state.party.find((m) => !m.isEgg) ?? this.state.party[0]; // GetLeadMonIndex: first non-egg, else slot 0
      this.state.stringVars[this.stringVar(a[0])] = lead ? [...this.state.pokemon.speciesName(lead.species)] : [];
    },
    bufferpartymonnick(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const mon = this.state.party[this.state.value(a[1])];
      this.state.stringVars[this.stringVar(a[0])] = mon ? [...mon.nickname] : [];
    },
    bufferitemname(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.stringVars[this.stringVar(a[0])] = this.state.pokemon.itemName(this.state.value(a[1]));
    },
    /** ScrCmd_bufferitemnameplural: only POKé BALL ("S") and berries ("IES") are pluralised. */
    bufferitemnameplural(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const item = this.state.value(a[1]);
      const quantity = this.state.value(a[2]);
      const name = this.state.pokemon.itemName(item);
      const first = this.defines.get('FIRST_BERRY_INDEX') ?? -1;
      const last = this.defines.get('LAST_BERRY_INDEX') ?? -1;
      if (item === this.defines.get('ITEM_POKE_BALL') && quantity >= 2) name.push(...this.charmap.encodePlain('S'));
      else if (item >= first && item < last && quantity >= 2 && name.length) name.splice(-1, 1, ...this.charmap.encodePlain('IES'));
      this.state.stringVars[this.stringVar(a[0])] = name;
    },
    buffernumberstring(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.stringVars[this.stringVar(a[0])] = this.charmap.encodePlain(String(this.state.value(a[1])));
    },
    bufferstdstring(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const label = this.state.pokemon.tables.stdStrings[this.state.value(a[1])];
      this.state.stringVars[this.stringVar(a[0])] = label ? this.charmap.encodePlain(this.strings[label] ?? '') : [];
    },
    /** ScrCmd_bufferboxname: GetBoxNamePtr(VarGet(var)) */
    bufferboxname(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.stringVars[this.stringVar(a[0])] = [...(this.state.storage.getBoxName(this.state.value(a[1])) ?? [])];
    },
    /**
     * ScrCmd_bufferdecorationname: reads the string var and VarGet's the decoration id; the StringCopy from
     * gDecorations is commented out (FRLG has no decoration table), so the string var keeps what it had.
     */
    bufferdecorationname(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.stringVar(a[0]); // ScriptReadByte(ctx)
      this.state.value(a[1]); // VarGet(ScriptReadHalfword(ctx))
    },
    bufferstring(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.stringVars[this.stringVar(a[0])] = this.charmap.encodePlain(this.strings[a[1]] ?? '');
    },

    // ------------------------------------------------ pokemon
    /** ScriptGiveMon: CreateMon with random IVs, OT = player, then party (or PC) and Pokédex flags. */
    givemon(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const species = this.state.value(a[0]);
      const level = this.defines.get(a[1]) ?? 5;
      const item = this.state.value(a[2] ?? 'ITEM_NONE');
      const mon = this.state.pokemon.createMon(species, level, {
        otId: this.state.trainerId,
        otName: this.state.playerName,
        otGender: this.state.playerGender,
        metLocation: this.host.mapSection(),
      });
      mon.heldItem = item;
      const result = this.state.giveMon(mon);
      const c = this.state.pokemon.c;
      if (result === c.MON_GIVEN_TO_PARTY || result === c.MON_GIVEN_TO_PC) this.state.setDexFlags(this.state.pokemon.nationalDex(species), true, true);
      this.state.setVar('VAR_RESULT', result);
    },
    /** ScrCmd_giveegg → ScriptGiveEgg (world/daycare.ts): VAR_RESULT = MON_GIVEN_TO_PARTY / _PC / MON_CANT_GIVE. */
    giveegg(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.setVar('VAR_RESULT', scriptGiveEgg(this.state, this.state.value(a[0])));
    },
    /**
     * ScrCmd_setwildbattle → CreateScriptedWildMon (script_pokemon_util.c): gEnemyParty = one mon with random
     * IVs and personality, OT = player, for the battle special that follows (StartMarowakBattle).
     */
    setwildbattle(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const mon = this.state.pokemon.createMon(this.state.value(a[0]), this.state.value(a[1]), {
        otId: this.state.trainerId,
        otName: this.state.playerName,
        otGender: this.state.playerGender,
        metLocation: this.host.mapSection(),
      });
      const item = this.state.value(a[2] ?? 'ITEM_NONE');
      if (item) mon.heldItem = item;
      this.state.enemyParty = [mon]; // ZeroEnemyPartyMons
    },
    /** ScrCmd_dowildbattle: StartScriptedWildBattle + ScriptContext_Stop until CB2_EndScriptedWildBattle (specials.ts). */
    dowildbattle(this: ScriptEngine, ctx: ScriptContext) {
      const w = StartScriptedWildBattle(this.specialEnv);
      if (w) ctx.wait = w;
    },
    getpartysize(this: ScriptEngine) {
      this.state.setVar('VAR_RESULT', this.state.party.length);
    },
    /** ScrCmd_showmonpic: ScriptMenu_ShowPokemonPic (not if QL_AvoidDisplay), then PlayCry_Script(species, CRY_MODE_NORMAL). */
    showmonpic(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const species = this.state.value(a[0]);
      if (!avoidDisplay(this.specialEnv)) this.host.showMonPic(species, this.defines.get(a[1]) ?? 0, this.defines.get(a[2]) ?? 0);
      PlayCry_Script(species, this.defines.require('CRY_MODE_NORMAL'));
    },
    hidemonpic(this: ScriptEngine, ctx: ScriptContext) {
      const w = this.host.hideMonPic();
      if (w) ctx.wait = w;
    },

    // ------------------------------------------------ trainers
    /**
     * BattleSetup_ConfigureTrainerBattle: load the mode's arguments (TrainerBattleLoadArgs with the
     * matching s*BattleParams table) and jump to the event script that runs the battle. The script
     * continues after `trainerbattle` (sTrainerBattleEndScript) once the battle is over or skipped.
     */
    trainerbattle(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      this.jump(ctx, this.configureTrainerBattle(a, ctx.pc));
    },
    /** ScrCmd_dotrainerbattle: BattleSetup_StartTrainerBattle, then CB2_EndTrainerBattle. */
    dotrainerbattle(this: ScriptEngine, ctx: ScriptContext) {
      const battle = this.battle;
      if (!battle) return;
      ctx.wait = this.runTrainerBattle(battle, false);
    },
    /** ScrCmd_gotobeatenscript: BattleSetup_GetTrainerPostBattleScript */
    gotobeatenscript(this: ScriptEngine, ctx: ScriptContext) {
      this.jump(ctx, this.battle?.beatenScript ?? 'EventScript_TestSignpostMsg');
    },
    /** BattleSetup_GetScriptAddrAfterBattle */
    gotopostbattlescript(this: ScriptEngine, ctx: ScriptContext) {
      if (this.battle) ctx.pc = this.battle.returnPc;
      else this.jump(ctx, 'EventScript_TestSignpostMsg');
    },
    /** ScrCmd_setrespawn → SetLastHealLocationWarp */
    setrespawn(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const loc = this.data.healLocations[this.state.value(a[0]) - 1];
      if (loc) this.state.lastHealLocation = { map: loc.map, x: loc.x, y: loc.y };
    },
    checktrainerflag(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      ctx.cmp = this.trainerDefeated(a[0]) ? Cmp.Equal : Cmp.Less;
    },
    settrainerflag(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.setTrainerFlag(this.state.value(a[0]));
    },
    cleartrainerflag(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const start = this.defines.get('TRAINER_FLAGS_START') ?? 0;
      this.state.setFlag(start + this.state.value(a[0]), false);
    },
    /** ScrCmd_incrementgamestat → IncrementGameStat (the Pokémon Center nurse: GAME_STAT_USED_POKECENTER) */
    incrementgamestat(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      this.state.incrementGameStat(this.state.value(a[0]));
    },

    // ------------------------------------------------ audio (scrcmd.c:883-990; gba/sound.ts). The quest log's
    // playback (QL_IS_PLAYBACK_STATE), which skips the BGM commands, isn't ported.
    /** ScrCmd_playse */
    playse(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      PlaySE(this.defines.require(a[0]));
    },
    /** ScrCmd_waitse: WaitForSoundEffectFinish (!IsSEPlaying: the SE1 and SE2 players, a fanfare too) */
    waitse(this: ScriptEngine, ctx: ScriptContext) {
      SetupNativeScript(ctx, () => !IsSEPlaying());
    },
    /** ScrCmd_playbgm: PlayNewMapMusic (the song starts in this frame's MapMusicMain); with `save` TRUE also
     *  Overworld_SetSavedMusic, so the next map load plays it again (and the save keeps it). */
    playbgm(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const songId = this.defines.require(a[0]);
      if ((this.defines.require(a[1] ?? 'FALSE') & 0xff) === 1) Overworld_SetSavedMusic(songId); // save == TRUE
      PlayNewMapMusic(songId);
    },
    /** ScrCmd_savebgm: Overworld_SetSavedMusic (MUS_DUMMY clears it). */
    savebgm(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      Overworld_SetSavedMusic(this.defines.require(a[0]));
    },
    /** ScrCmd_fadedefaultbgm: Overworld_ChangeMusicToDefault (fade to the map header's music at speed 8). */
    fadedefaultbgm() {
      Overworld_ChangeMusicToDefault();
    },
    /** ScrCmd_fadenewbgm: Overworld_ChangeMusicTo */
    fadenewbgm(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      Overworld_ChangeMusicTo(this.defines.require(a[0]));
    },
    /** ScrCmd_fadeoutbgm: FadeOutBGMTemporarily(4 × speed, 4 for 0), then wait for IsBGMPausedOrStopped. */
    fadeoutbgm(this: ScriptEngine, ctx: ScriptContext, a: string[]) {
      const speed = this.defines.require(a[0]) & 0xff;
      FadeOutBGMTemporarily(speed !== 0 ? 4 * speed : 4);
      SetupNativeScript(ctx, IsBGMPausedOrStopped);
    },
    /** ScrCmd_fadeinbgm: FadeInBGM(4 × speed, 4 for 0) */
    fadeinbgm(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      const speed = this.defines.require(a[0]) & 0xff;
      FadeInBGM(speed !== 0 ? 4 * speed : 4);
    },
    /** ScrCmd_playfanfare: PlayFanfare (the BGM pauses; Task_Fanfare counts sFanfares' frames). */
    playfanfare(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      PlayFanfare(this.defines.require(a[0]));
    },
    /** ScrCmd_waitfanfare: WaitForFanfareFinish (IsFanfareTaskInactive) */
    waitfanfare(this: ScriptEngine, ctx: ScriptContext) {
      SetupNativeScript(ctx, IsFanfareTaskInactive);
    },
    /** ScrCmd_playmoncry: PlayCry_Script(species, mode) (the BGM ducked until Task_DuckBGMForPokemonCry ends). */
    playmoncry(this: ScriptEngine, _ctx: ScriptContext, a: string[]) {
      PlayCry_Script(this.state.value(a[0]), this.state.value(a[1]));
    },
    /** ScrCmd_waitmoncry: SetupNativeScript(IsCryFinished) */
    waitmoncry(this: ScriptEngine, ctx: ScriptContext) {
      SetupNativeScript(ctx, IsCryFinished);
    },
  };

  /** A `dofieldeffect` / `waitfieldeffect` argument (FLDEFF_* or a var holding one) as its FLDEFF_* name. */
  private fieldEffectName(token: string): string {
    if (token.startsWith('FLDEFF_')) return token;
    const id = this.state.value(token);
    const name = Object.keys(this.data.defines).find((k) => k.startsWith('FLDEFF_') && this.data.defines[k] === id);
    return name ?? token;
  }

  private doWarp(ctx: ScriptContext, a: string[], kind: 'warp' | 'silent' | 'door' = 'warp'): void {
    const { warpId, x, y } = this.warpArgs(a);
    this.host.warp(a[0], warpId, x, y, kind);
    ctx.done = true;
  }

  /** formatwarp: `MAP, warpId` | `MAP, x, y` | `MAP, warpId, x, y` */
  private warpArgs(a: string[]): { warpId: number; x: number; y: number } {
    const warpId = a.length === 3 ? -1 : this.state.value(a[1] ?? '-1');
    const x = a.length === 3 ? this.state.value(a[1]) : this.state.value(a[2] ?? '-1');
    const y = a.length === 3 ? this.state.value(a[2]) : this.state.value(a[3] ?? '-1');
    return { warpId, x, y };
  }

  /**
   * BattleSetup_ConfigureTrainerBattle for a `trainerbattle` with arguments `a` whose next
   * instruction is `returnPc` (sTrainerBattleEndScript). Returns the event script that runs the battle.
   */
  private configureTrainerBattle(a: string[], returnPc: number): string {
    const d = this.defines;
    const mode = d.get(a[0]) ?? 0;
    const is = (...names: string[]) => names.some((n) => mode === d.get(n));
    const battle: TrainerBattle = {
      mode,
      trainer: d.get(a[1]) ?? 0,
      localIdOrFlags: d.get(a[2]) ?? this.host.resolveLocalId(a[2]) ?? 0,
      returnPc,
    };
    let script: string;
    let setMapVars = true;
    if (is('TRAINER_BATTLE_SINGLE_NO_INTRO_TEXT')) {
      [battle.defeatText] = a.slice(3); // sOrdinaryNoIntroBattleParams
      script = 'EventScript_DoNoIntroTrainerBattle';
      setMapVars = false;
    } else if (is('TRAINER_BATTLE_EARLY_RIVAL')) {
      [battle.defeatText, battle.victoryText] = a.slice(3); // sEarlyRivalBattleParams (local id = RIVAL_BATTLE_* flags)
      script = 'EventScript_DoNoIntroTrainerBattle';
      setMapVars = false;
    } else if (is('TRAINER_BATTLE_CONTINUE_SCRIPT', 'TRAINER_BATTLE_CONTINUE_SCRIPT_NO_MUSIC')) {
      [battle.introText, battle.defeatText, battle.beatenScript] = a.slice(3); // sContinueScriptBattleParams
      script = 'EventScript_TryDoNormalTrainerBattle';
    } else if (is('TRAINER_BATTLE_CONTINUE_SCRIPT_DOUBLE', 'TRAINER_BATTLE_CONTINUE_SCRIPT_DOUBLE_NO_MUSIC')) {
      [battle.introText, battle.defeatText, battle.cannotBattleText, battle.beatenScript] = a.slice(3); // sContinueScriptDoubleBattleParams
      script = 'EventScript_TryDoDoubleTrainerBattle';
    } else if (is('TRAINER_BATTLE_DOUBLE', 'TRAINER_BATTLE_REMATCH_DOUBLE')) {
      [battle.introText, battle.defeatText, battle.cannotBattleText] = a.slice(3); // sDoubleBattleParams
      script = is('TRAINER_BATTLE_DOUBLE') ? 'EventScript_TryDoDoubleTrainerBattle' : 'EventScript_TryDoDoubleRematchBattle';
    } else {
      [battle.introText, battle.defeatText] = a.slice(3); // sOrdinaryBattleParams (SINGLE, REMATCH, anything else)
      script = is('TRAINER_BATTLE_REMATCH') ? 'EventScript_TryDoRematchBattle' : 'EventScript_TryDoNormalTrainerBattle';
    }
    this.battle = battle;
    // SetMapVarsToTrainer
    if (setMapVars && battle.localIdOrFlags !== d.require('LOCALID_NONE')) {
      this.state.setVar('VAR_LAST_TALKED', battle.localIdOrFlags);
      this.host.selectObject(battle.localIdOrFlags);
    }
    if (is('TRAINER_BATTLE_REMATCH', 'TRAINER_BATTLE_REMATCH_DOUBLE')) {
      QL_FinishRecordingScene(); // BattleSetup_ConfigureTrainerBattle: a rematch ends the scene
      battle.trainer = GetRematchTrainerId(this.rematchEnv(), battle.trainer);
    }
    return script;
  }

  /** The `trainerbattle` a script starts with, if it does (what trainer_see.c reads from the script pointer). */
  private leadingTrainerBattle(label: string): { a: string[]; pc: number } | undefined {
    const pc = this.data.labels[label];
    const ins = pc === undefined ? undefined : this.data.code[pc];
    if (ins?.[0] !== 'trainerbattle') return undefined;
    return { a: ins.slice(1), pc };
  }

  /**
   * For CheckTrainer: the trainer a script's leading `trainerbattle` fights and whether its mode is
   * TRAINER_BATTLE_DOUBLE (script[1]); undefined if it doesn't start with one.
   */
  trainerScriptBattle(label: string): { trainer: number; double: boolean } | undefined {
    const t = this.leadingTrainerBattle(label);
    if (!t) return undefined;
    return { trainer: this.defines.get(t.a[1]) ?? 0, double: this.defines.get(t.a[0]) === this.defines.require('TRAINER_BATTLE_DOUBLE') };
  }

  /**
   * ConfigureAndSetUpOneTrainerBattle: the trainer that saw the player becomes gSelectedObjectEvent
   * and VAR_LAST_TALKED, its script's battle is configured (the script it would jump to is unused),
   * and EventScript_DoTrainerBattleFromApproach starts.
   */
  setUpTrainerBattleFromApproach(localId: number, label: string): void {
    const t = this.leadingTrainerBattle(label);
    if (!t) return;
    this.state.setVar('VAR_LAST_TALKED', localId);
    this.configureTrainerBattle(t.a, t.pc + 1);
    this.start('EventScript_DoTrainerBattleFromApproach');
  }

  /**
   * DoTrainerBattle, then CB2_EndTrainerBattle: either back to the field to continue the script, or a
   * white-out, which ends the script (ScriptContext_Init) and never comes back to it.
   */
  private runTrainerBattle(battle: TrainerBattle, rematch: boolean): Wait {
    const run = this.host.startTrainerBattle(battle);
    let fadeIn: Wait | undefined;
    return () => {
      if (fadeIn) return fadeIn();
      if (!run.done()) return false;
      this.host.clearRematchStateByTrainerId?.(battle.trainer); // HandleEndTurn_FinishBattle, for every trainer battle
      if (this.endTrainerBattle(battle, run.playerWon(), rematch)) {
        fadeIn = run.returnToField();
        return false;
      }
      if (this.ctx) this.ctx.done = true;
      this.host.whiteOut();
      return true;
    };
  }

  /**
   * CB2_EndTrainerBattle (and CB2_EndRematchBattle, which also clears the trainer's rematch state).
   * Returns false when the player whites out.
   */
  private endTrainerBattle(battle: TrainerBattle, won: boolean, rematch = false): boolean {
    if (battle.mode === this.defines.get('TRAINER_BATTLE_EARLY_RIVAL')) {
      // VAR_RESULT = player lost. Losing heals only with RIVAL_BATTLE_HEAL_AFTER; otherwise it whites out.
      this.state.setVar('VAR_RESULT', won ? 0 : 1);
      if (!won && !(battle.localIdOrFlags & this.defines.require('RIVAL_BATTLE_HEAL_AFTER'))) return false;
      if (!won) this.callSpecial('HealPlayerParty');
    } else if (!won) {
      return false;
    }
    if (rematch) this.state.trainerRematches[this.state.getVar('VAR_LAST_TALKED')] = 0; // ClearRematchStateOfLastTalked
    this.setTrainerFlag(battle.trainer); // SetBattledTrainerFlag
    if (!rematch) QuestLogEvents_HandleEndTrainerBattle(); // CB2_EndTrainerBattle (not CB2_EndRematchBattle)
    return true;
  }

  /**
   * battle_setup.c / vs_seeker.c specials that read the configured battle. A beaten table trainer always goes
   * down the rematch script (ShouldTryRematchBattle); only one the VS Seeker readied (`state.trainerRematches`
   * by local id, world/vsSeeker.ts) battles there, the others fall through to the post-battle text.
   */
  private trainerSpecial(name: string): number | void {
    const battle = this.battle;
    switch (name) {
      case 'Script_HasTrainerBeenFought':
        return battle && this.trainerFlag(battle.trainer) ? 1 : 0;
      case 'SetBattledTrainerFlag':
        if (battle) this.setTrainerFlag(battle.trainer);
        return;
      case 'GetTrainerBattleMode':
        return battle?.mode ?? 0;
      case 'SetUpTrainerMovement': {
        // SetTrainerMovementType(GetTrainerFacingDirectionMovementType(facing)): stop wandering
        const obj = this.host.selectedObject;
        if (obj) this.host.setObjectMovementType(obj, `MOVEMENT_TYPE_FACE_${obj.facing.toUpperCase()}`);
        return;
      }
      case 'ShowTrainerIntroSpeech':
        this.showFieldMessage(battle?.introText);
        return;
      case 'ShowTrainerCantBattleSpeech':
        this.showFieldMessage(battle?.cannotBattleText);
        return;
      case 'HasEnoughMonsForDoubleBattle':
        this.state.setVar('VAR_RESULT', this.monsStateToDoubles());
        return;
      case 'ShouldTryRematchBattle':
        return battle && ShouldTryRematchBattle(this.rematchEnv(), battle.trainer, this.trainerRematchable()) ? 1 : 0;
      case 'IsTrainerReadyForRematch':
        return battle && IsTrainerReadyForRematch(this.rematchEnv(), battle.trainer, this.trainerRematchable()) ? 1 : 0;
      case 'StartRematchBattle': {
        if (battle) this.waitState = this.runTrainerBattle(battle, true);
        return;
      }
    }
  }

  /** GetMonsStateToDoubles: PLAYER_HAS_TWO_USABLE_MONS, PLAYER_HAS_ONE_MON or PLAYER_HAS_ONE_USABLE_MON. */
  monsStateToDoubles(): number {
    const party = this.state.party;
    const alive = party.filter((m) => m.hp !== 0 && m.species !== 0 && !m.isEgg).length;
    const result = party.length === 1 ? 'PLAYER_HAS_ONE_MON' : alive > 1 ? 'PLAYER_HAS_TWO_USABLE_MONS' : 'PLAYER_HAS_ONE_USABLE_MON';
    return this.defines.require(result);
  }

  /** IsThisTrainerRematchable(gSpecialVar_LastTalked) */
  private trainerRematchable(): boolean {
    return !!this.state.trainerRematches[this.state.getVar('VAR_LAST_TALKED')];
  }

  /** What world/rematches.ts' sRematches lookups read. */
  private rematchEnv(): RematchEnv {
    return { rematches: this.data.rematches, hasTrainerBeenFought: (t) => this.trainerFlag(t), flagGet: (f) => this.state.getFlag(f) };
  }

  /** ShowFieldMessage */
  private showFieldMessage(label?: string | number[]): void {
    if (Array.isArray(label)) {
      this.messageBox.show(label, this.contextTextColor(), this.msgIsSignpost); // an encoded string (gStringVar4)
      return;
    }
    const raw = label && this.strings[label];
    this.messageBox.show(raw ? this.charmap.encode(raw) : this.charmap.encode('$'), this.contextTextColor(), this.msgIsSignpost);
  }

  /** FlagGet(TRAINER_FLAGS_START + trainer) */
  trainerFlag(trainer: number): boolean {
    const start = this.defines.get('TRAINER_FLAGS_START');
    return start !== undefined && this.state.getFlag(start + trainer);
  }

  /** SetTrainerFlag */
  private setTrainerFlag(trainer: number): void {
    const start = this.defines.get('TRAINER_FLAGS_START');
    if (start !== undefined) this.state.setFlag(start + trainer, true);
  }

  private trainerDefeated(trainer: string): boolean {
    const start = this.defines.get('TRAINER_FLAGS_START');
    return start !== undefined && this.state.getFlag(start + this.state.value(trainer));
  }
}

/** Specials handled by ScriptEngine.trainerSpecial (some return nothing). Exported for tests/unit/scriptCoverage. */
export const TRAINER_SPECIALS: ReadonlySet<string> = new Set([
  'Script_HasTrainerBeenFought',
  'SetBattledTrainerFlag',
  'GetTrainerBattleMode',
  'SetUpTrainerMovement',
  'ShowTrainerIntroSpeech',
  'ShowTrainerCantBattleSpeech',
  'HasEnoughMonsForDoubleBattle',
  'ShouldTryRematchBattle',
  'IsTrainerReadyForRematch',
  'StartRematchBattle',
]);

/** NPC_TEXT_COLOR_MALE / FEMALE; MON and NEUTRAL both use the default dark-gray text. */
export function textColorFromId(c: number, defines: Defines): TextColor {
  if (c === defines.require('NPC_TEXT_COLOR_MALE')) return 'male';
  if (c === defines.require('NPC_TEXT_COLOR_FEMALE')) return 'female';
  return 'neutral';
}

const DPAD_BUTTONS: Record<Direction, Button> = { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' };

const DIR_NAMES: [string, Direction][] = [
  ['DIR_SOUTH', 'down'],
  ['DIR_NORTH', 'up'],
  ['DIR_WEST', 'left'],
  ['DIR_EAST', 'right'],
];

/** DIR_* id for a direction. */
export function directionId(d: Direction, defines: Defines): number {
  return defines.require(DIR_NAMES.find(([, dir]) => dir === d)![0]);
}

function dirArg(token: string, defines: Defines): Direction | undefined {
  const n = defines.get(token);
  if (n !== undefined) return DIR_NAMES.find(([name]) => defines.get(name) === n)?.[1];
  return parseDirection(token.replace('DIR_', ''));
}
