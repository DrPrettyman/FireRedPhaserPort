// Dev-only hooks for the automated tests (tests/e2e): a virtual gamepad, an event log, a logic-speed
// multiplier and probes into game state, exposed as `window.__test`. Nothing here changes how the game
// plays; the game reports a few milestones through `testEvent` and samples the pad along with the keyboard.
//
// URL parameters (dev builds only):
//   ?seed=N        seed the GBA RNG (random.c) before anything rolls, e.g. the trainer id
//   ?speed=N       run N logic ticks per 60 Hz frame (fast-forward); timings stay in GBA frames
//   ?textSpeed=fast|mid|slow   the options text speed for the new game

import type Phaser from 'phaser';
import type { Assets } from '../data/assets';
import { g } from '../battle/env';
import { getBattlerSide } from '../battle/util';
import { GetGpuReg } from '../gba/hw';
import { gMain } from '../gba/main';
import { gPaletteFade } from '../gba/palette';
import { gSprites } from '../gba/sprite';
import { gTasks } from '../gba/task';
import type { Button } from '../input/Input';
import type { Pokemon } from '../pokemon/Pokemon';
import type { GameState } from '../state/GameState';
import { TEXT_SPEED, type TextSpeed } from '../text/TextPrinter';
import { seedRng } from '../util/random';
import { DELTA, type Direction } from '../world/direction';
import { tilesetVram } from '../world/TilesetVram';
import { SetPlayerAvatarTransitionFlags } from '../world/playerAvatar';
import { DestroyPlayerSurfBlob } from '../world/surf';
import type { FieldListMenuProbe } from '../ui/FieldListMenu';
import { storageProbe } from '../menus/pokemonStorage';
import { itemPcProbe } from '../menus/itemPc';
import { tmCaseProbe } from '../menus/tmCase';
import { eggHatchProbe } from '../menus/eggHatch';
import { moveRelearnerProbe } from '../menus/learnMove';
import { berryPouchProbe } from '../menus/berryPouch';
import { hallOfFameProbe } from '../menus/hallOfFame';
import { creditsProbe, creditsSkipToClosing } from '../menus/credits';
import { pokedexAreaProbe } from '../menus/pokedexArea';
import { pokedexScreenProbe } from '../menus/pokedexScreen';
import { regionMapProbe } from '../menus/regionMap';
import { trainerCardProbe } from '../menus/trainerCard';
import { slotMachineProbe } from '../menus/slotMachine';
import { mainMenuProbe } from '../menus/mainMenu';
import { titleScreenProbe } from '../menus/titleScreen';
import { clearSaveDataProbe } from '../menus/clearSaveDataScreen';
import { oakSpeechProbe } from '../menus/oakSpeech';
import { saveDialogProbe } from '../ui/SaveDialog';
import { startMenuProbe } from '../ui/StartMenu';
import { helpMessageWindowProbe } from '../ui/HelpMessageWindow';
import { optionMenuProbe } from '../menus/optionMenu';
import { museumFossilPicProbe } from '../ui/MuseumFossilPic';

let enabled = false;
/** `?textSpeed=`: applied to the new game's options by applyTestOptions. */
let textSpeed: TextSpeed | undefined;
/** Logic ticks per 60 Hz frame (`?speed=`). Scenes multiply their frame delta by this. */
export let logicSpeed = 1;
/** `__test.forceBattleTransition(id)`: the B_TRANSITION_* every battle uses instead of battle_setup.c's pick. */
export let forcedBattleTransition: number | undefined;

// ------------------------------------------------------------------ virtual gamepad

interface QueuedPress {
  buttons: Button[];
  /** Ticks left holding the buttons, then ticks left released before the next press may start. */
  frames: number;
  gap: number;
  done: () => void;
}

/**
 * Buttons the tests hold or tap. Input.sample() ORs these with the keyboard once per logic tick, and
 * only one scene samples per tick (the others are asleep), so a tap lasts exactly `frames` ticks.
 * Conditions (`holdWhile`, `until`) are checked at the start of each tick, before the game runs it.
 */
class VirtualPad {
  private holding = new Set<Button>();
  private conditional: { button: Button; keep: () => boolean }[] = [];
  /** Per-tick drivers: return the buttons to hold this tick, or undefined when done. */
  private drivers: (() => Button[] | undefined)[] = [];
  private queue: QueuedPress[] = [];
  private waiters: { ready: () => boolean; done: () => void }[] = [];
  /** Logic ticks sampled so far, across every scene. */
  frame = 0;
  /** Run at the start of every tick, before conditions are checked. */
  onTick?: () => void;

  /** Called by Input.sample once per logic tick. */
  sample(): Button[] {
    this.frame++;
    this.onTick?.();
    this.waiters = this.waiters.filter((w) => (w.ready() ? (w.done(), false) : true));
    this.conditional = this.conditional.filter((c) => c.keep());
    const driven: Button[] = [];
    this.drivers = this.drivers.filter((d) => {
      const b = d();
      if (b) driven.push(...b);
      return b !== undefined;
    });
    const head = this.queue[0];
    let tapped: Button[] = [];
    if (head) {
      if (head.frames > 0) {
        tapped = head.buttons;
        head.frames--;
      } else head.gap--;
      if (head.frames === 0 && head.gap <= 0) {
        this.queue.shift();
        head.done();
      }
    }
    return [...this.holding, ...this.conditional.map((c) => c.button), ...driven, ...tapped];
  }

  /** Hold `buttons` for `frames` ticks, then release for `gap` ticks; resolves once the release is sampled. */
  press(buttons: Button[], frames: number, gap: number): Promise<void> {
    return new Promise((done) => this.queue.push({ buttons, frames: Math.max(1, frames), gap: Math.max(1, gap), done }));
  }

  hold(b: Button): void {
    this.holding.add(b);
  }

  /** Hold `b` on every tick that `keep()` is true at its start; dropped for good the first time it isn't. */
  holdWhile(b: Button, keep: () => boolean): void {
    this.conditional.push({ button: b, keep });
  }

  release(b?: Button): void {
    if (b) this.holding.delete(b);
    else this.holding.clear();
    this.conditional = b ? this.conditional.filter((c) => c.button !== b) : [];
  }

  /** Run `step` at the start of every tick (after conditions) until it returns undefined. */
  drive(step: () => Button[] | undefined): void {
    this.drivers.push(step);
  }

  /** Resolves at the start of the first tick where `ready()` holds. */
  until(ready: () => boolean): Promise<void> {
    return new Promise((done) => this.waiters.push({ ready, done }));
  }

  waitFrames(n: number): Promise<void> {
    const at = this.frame + n;
    return this.until(() => this.frame >= at);
  }
}

const pad = new VirtualPad();

/** Buttons the virtual pad holds this tick (empty unless the hooks are installed). */
export function sampleVirtualPad(): Button[] {
  return enabled ? pad.sample() : [];
}

// ------------------------------------------------------------------ event log

export interface TestEvent {
  seq: number;
  frame: number;
  type: string;
  [key: string]: unknown;
}

const events: TestEvent[] = [];
let seq = 0;

/**
 * Record a milestone for the tests: `ready`, `map` {map}, `script` {label}, `trainerApproach`,
 * `battleTransition` {transition}, `battleTransitionEnd` {black: share of black pixels in its last
 * frame}, `battleStart` {flags, trainer}, `battleEnd` {outcome}, `whiteOut`,
 * `mapTransition` {from, to} (a cave's flash screen), `barnDoorWipe`.
 */
export function testEvent(type: string, data: Record<string, unknown> = {}): void {
  if (!enabled) return;
  events.push({ ...data, seq: ++seq, frame: pad.frame, type });
  if (events.length > 5000) events.splice(0, events.length - 5000);
}

// ------------------------------------------------------------------ probes

/** What OverworldScene.testProbe reports. */
export interface FieldProbe {
  map: string;
  /** Map-local position (as in `?map=&x=&y=` and the map's events). */
  x: number;
  y: number;
  /** World tile position (stable across map connections). */
  worldX: number;
  worldY: number;
  facing: Direction;
  busy: boolean;
  /** Label of the running script, if any. */
  script: string | undefined;
  overlay: boolean;
  /** LockPlayerFieldControls is held (a field task: a registered item, a boulder push, ...). */
  locked: boolean;
  /** FreezeObjectEvents is in effect. */
  objectsFrozen: boolean;
  moving: boolean;
  approaching: boolean;
  fading: boolean;
  /** The screen fade's colour is white (a cave's white fades) rather than black. */
  fadeWhite: boolean;
  /** The field message box's text while it's open (encoded; `__test.message()` decodes it). */
  message: number[] | undefined;
  playerVisible: boolean;
  /** FieldIsDoorAnimationRunning */
  doorAnimating: boolean;
  /** The field effect sprites alive (FLDEFF_* names, 'reflection' for reflections), in creation order. */
  fieldEffects: string[];
  /** The ones following the player (shadow, grass, splashes, reflection). */
  playerEffects: string[];
  /** The map name popup's text while Task_MapNamePopup runs (encoded). */
  mapNamePopup: number[] | undefined;
  /** How many px of the popup window are on screen (0..24). */
  mapNamePopupHeight: number;
  /** gSaveBlock1Ptr->flashLevel, and the share of the screen Flash's darkness covers (0..1). */
  flash: { level: number; dark: number };
  /** While the field is on the GBA layer (battle transitions): the share of its last frame that is black. */
  gbaScreenBlack: number | undefined;
  /** special ListMenu's list while it's open (ui/FieldListMenu.ts). */
  listMenu: FieldListMenuProbe | undefined;
  /**
   * The player's surf blob (world/surf.ts) while it's alive: its centre in world pixels, anim (0 down, 1 up,
   * 2 left, 3 right), BOB_* state, and the player sprite's y2 it sets.
   */
  surfBlob: { x: number; y: number; anim: number; bobState: number; invisible: boolean; playerY2: number } | undefined;
  /** Task_Fishing's tStep and the player's fishing anim (world/fishing.ts) while it runs. */
  fishing: { step: number; animNum?: number; image?: number; x2?: number; y2?: number } | undefined;
  /** The VS Seeker's task (func 0..3 = Task_VsSeeker_0..3) and the player's VS Seeker anim (world/vsSeeker.ts) while it runs. */
  vsSeeker: { func: number; animNum?: number; image?: number } | undefined;
  /**
   * The Itemfinder (world/itemfinder.ts) while its task or sprites are out: `running` until its message closes, and
   * each arrow / star's screen position, anim (0-3 arrows, 4 the star), affine anim (0 left, 1 down, 2 right, 3 up).
   */
  itemfinder: { running: boolean; sprites: { x: number; y: number; anim: number; affineAnim: number; image: number }[] } | undefined;
  /** gPlayerAvatar and the player's held movement (world/playerAvatar.ts). */
  avatar: {
    /** PLAYER_AVATAR_FLAG_* set, without the prefix (ON_FOOT, MACH_BIKE, SURFING, FORCED, ...). */
    flags: string[];
    /** NOT_MOVING / TURN_DIRECTION / MOVING */
    runningState: number;
    /** T_NOT_MOVING / T_TILE_TRANSITION / T_TILE_CENTER */
    tileTransitionState: number;
    /** The player object's OBJ_EVENT_GFX_* */
    graphicsId: string;
    /** The held MOVEMENT_ACTION_* (without the prefix), if any. */
    action: string | undefined;
    movementDirection: Direction;
  };
}

/** An object on the field, for tests. */
export interface FieldObjectProbe {
  localId: number;
  graphicsId: string;
  /** Map-local position (its destination while it moves). */
  x: number;
  y: number;
  moving: boolean;
  facing: Direction;
  /** MOVEMENT_TYPE_* (its NpcBrain's) */
  movementType: string;
  /** The sprite sheet frame shown */
  frame: number;
  /** sprite->x2 / y2 of the raise-hand movement types */
  x2: number;
  y2: number;
}

/** The parts of OverworldScene the hooks use (`startWildBattle` is private there; reached by name). */
interface OverworldLike extends Phaser.Scene {
  testProbe(): FieldProbe | undefined;
  testFindPath(worldX: number, worldY: number): Direction[] | undefined;
  testPushWarpDirection(): Direction | undefined;
  testObjects(): FieldObjectProbe[];
  state: GameState;
  startWildBattle(mon: Pokemon): void;
  useFlash(): void;
}

export interface MonSpec {
  /** SPECIES_* without the prefix, e.g. "MEWTWO". */
  species: string;
  level: number;
  /** MOVE_* without the prefix; omitted keeps CreateMon's level-up moveset. */
  moves?: string[];
  /** Fixed IVs (0-31); omitted rolls them. */
  iv?: number;
  /** ITEM_* without the prefix. */
  item?: string;
  /** STATUS1_* without the prefix, e.g. "POISON". */
  status?: string;
  /** A personality that makes it shiny (for the player's OT id). */
  shiny?: boolean;
  /** An egg with this many egg cycles left, as CreateEgg makes it (isEgg, friendship = cycles, met level 0, Poké Ball, the Japanese egg nickname). */
  egg?: number;
}

/** Argument bytes after FC <code> (as TextPrinter reads them); codes not listed take none. */
const EXT_CTRL_ARGS: Record<number, number> = { 0x01: 1, 0x02: 1, 0x03: 1, 0x04: 3, 0x05: 1, 0x06: 1, 0x08: 1, 0x0b: 2, 0x0c: 1, 0x0d: 1, 0x0e: 1, 0x10: 2, 0x11: 1, 0x12: 1, 0x13: 1, 0x14: 1 };

const DIR_BUTTON: Record<Direction, Button> = { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT' };

function createApi(game: Phaser.Game) {
  const assets = (): Assets => game.registry.get('assets');
  const defines = () => assets().scripts.defines;
  const define = (name: string) => {
    const v = defines()[name];
    if (v === undefined) throw new Error(`Unknown constant ${name}`);
    return v;
  };
  const nameOf = (prefix: string, value: number) => Object.keys(defines()).find((k) => k.startsWith(prefix) && defines()[k] === value);
  const shortName = (prefix: string, value: number) => nameOf(prefix, value)?.slice(prefix.length);
  /** MOVE_* without the prefix, from the move table (other MOVE_* defines such as MOVE_EFFECT_SLEEP share the ids). */
  const moveName = (value: number) => requireState().pokemon.moves[value]?.id.slice('MOVE_'.length);
  const overworld = (): OverworldLike | undefined =>
    game.scene.isActive('Overworld') || game.scene.isSleeping('Overworld') ? (game.scene.getScene('Overworld') as OverworldLike) : undefined;
  const state = () => overworld()?.state;
  const requireState = () => {
    const s = state();
    if (!s) throw new Error('No game state yet');
    return s;
  };
  const field = () => overworld()?.testProbe();
  /** Nothing holds the field right now: no script, menu, fade, movement, trainer or pending warp. */
  const free = () => {
    if (!game.scene.isActive('Overworld')) return false;
    const p = field();
    return !!p && !p.busy && !p.script && !p.overlay && !p.moving && !p.approaching && !p.fading;
  };
  // A free field can still start an ON_FRAME script or a trainer on its next tick, so "idle" means it
  // was free at the start of two ticks in a row.
  let freeTicks = 0;
  // The map name popup is up for only ~150 ticks, which a poll from the tests can miss right after a load: each
  // name it prints is logged as a `mapNamePopupText` event (`text`).
  let popupText: string | undefined;
  pad.onTick = () => {
    freeTicks = free() ? freeTicks + 1 : 0;
    const bytes = field()?.mapNamePopup;
    const text = bytes && decode(bytes);
    if (text !== popupText && (popupText = text)) testEvent('mapNamePopupText', { text });
  };
  const idle = () => freeTicks >= 2 && free();

  let decodeTable: Map<number, string> | undefined;
  /** Encoded bytes back to text (single-byte charmap entries; good enough for names). */
  const decode = (bytes: number[]) => {
    if (!decodeTable) {
      decodeTable = new Map();
      for (const [ch, b] of Object.entries(assets().charmap.chars)) if (b.length === 1 && !decodeTable.has(b[0])) decodeTable.set(b[0], ch);
    }
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0xff) break;
      if (b === 0xfa || b === 0xfb || b === 0xfe) s += ' '; // \l \p \n
      else if (b === 0xfc) i += 1 + (EXT_CTRL_ARGS[bytes[i + 1]] ?? 0); // text colour etc.: skip the code and its args
      else s += decodeTable.get(b) ?? '?';
    }
    return s.replace(/ +/g, ' ');
  };
  const monSummary = (m: Pokemon) => ({
    species: shortName('SPECIES_', m.species),
    nickname: decode(m.nickname),
    level: m.level,
    hp: m.hp,
    maxHP: m.maxHP,
    status: m.status,
    exp: m.exp,
    moves: m.moves.filter((mv) => mv).map(moveName),
  });
  const createMon = (spec: MonSpec): Pokemon => {
    const s = requireState();
    const mon = s.pokemon.createMon(define(`SPECIES_${spec.species}`), spec.level, {
      otId: s.trainerId,
      otName: s.playerName,
      otGender: s.playerGender,
      metLocation: s.currentMapSection,
      fixedIV: spec.iv,
      // shiny value = otId hi ^ otId lo ^ personality hi ^ personality lo = 0
      personality: spec.shiny ? ((((s.trainerId >>> 16) ^ (s.trainerId & 0xffff)) << 16) >>> 0) : undefined,
    });
    if (spec.moves) {
      mon.moves = [0, 0, 0, 0];
      mon.pp = [0, 0, 0, 0];
      spec.moves.slice(0, 4).forEach((name, i) => {
        mon.moves[i] = define(`MOVE_${name}`);
        mon.pp[i] = s.pokemon.moves[mon.moves[i]].pp;
      });
    }
    if (spec.item) mon.heldItem = define(`ITEM_${spec.item}`);
    if (spec.status) mon.status = define(`STATUS1_${spec.status}`);
    if (spec.egg !== undefined) {
      // CreateEgg (daycare.c)
      mon.isEgg = true;
      mon.friendship = spec.egg;
      mon.metLevel = 0;
      mon.pokeball = define('ITEM_POKE_BALL');
      mon.nickname = s.pokemon.encodeName('タマゴ'); // sJapaneseEggNickname
    }
    return mon;
  };

  const walk = async (dir: Direction, tiles = 1, maxFrames = 40 * tiles + 60) => {
    const start = field();
    if (!start) throw new Error('No field');
    const { dx, dy } = DELTA[dir];
    const tx = start.worldX + dx * tiles;
    const ty = start.worldY + dy * tiles;
    const deadline = pad.frame + maxFrames;
    const interrupted = () => {
      const f = field();
      return !f || !game.scene.isActive('Overworld') || !!f.script || f.overlay || f.approaching || f.busy;
    };
    let holding = true;
    pad.holdWhile(DIR_BUTTON[dir], () => {
      const f = field();
      holding = !!f && !(f.worldX === tx && f.worldY === ty) && !interrupted() && pad.frame < deadline;
      return holding;
    });
    await pad.until(() => !holding && (interrupted() || !field()?.moving));
    pad.release(DIR_BUTTON[dir]);
    const f = field()!;
    return { x: f.x, y: f.y, map: f.map, arrived: f.worldX === tx && f.worldY === ty, interrupted: interrupted() };
  };

  const api = {
    /** Logic ticks sampled so far. */
    frame: () => pad.frame,

    // --- input
    /** Tap buttons together for `frames` ticks (default 2), then release for `gap` ticks (default 2). */
    press: (buttons: Button | Button[], frames = 2, gap = 2) => pad.press(Array.isArray(buttons) ? buttons : [buttons], frames, gap),
    hold: (b: Button) => pad.hold(b),
    /** Hold `b` on every tick that `keep()` is true at its start; let go for good the first tick it isn't. */
    holdWhile: (b: Button, keep: () => boolean) => pad.holdWhile(b, keep),
    release: (b?: Button) => pad.release(b),
    waitFrames: (n: number) => pad.waitFrames(n),
    /** A tile of a tileset as the field's BG VRAM holds it now (tile animations write there), as hex. */
    tilesetTile: (tileset: string, tile: number) => {
      const d = tilesetVram.tileData(tileset, tile);
      return d && Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
    },
    /**
     * Hold a direction until the player has started the step onto the tile `tiles` away, then let go, and
     * resolve once they've stopped. Gives up early if anything takes the controls (script, menu, trainer,
     * warp, battle) or after `maxFrames`. Resolves with where the player ended up.
     */
    walk,
    /**
     * Walk to map-local (x, y) along the shortest route (OverworldScene.testFindPath), re-planning if an
     * NPC steps in the way. Stops early like `walk` if something takes the controls, e.g. a trainer or a
     * warp on the target tile. Throws if there's no route.
     */
    walkTo: async (x: number, y: number) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const f = field();
        if (!f) throw new Error('No field');
        const tx = x + f.worldX - f.x;
        const ty = y + f.worldY - f.y;
        if (f.worldX === tx && f.worldY === ty) return { x: f.x, y: f.y, map: f.map, arrived: true, interrupted: false };
        const path = overworld()!.testFindPath(tx, ty);
        if (!path) throw new Error(`No route from (${f.x},${f.y}) to (${x},${y}) on ${f.map}`);
        let result: Awaited<ReturnType<typeof walk>> | undefined;
        for (let i = 0; i < path.length; ) {
          let n = 1;
          while (path[i + n] === path[i]) n++;
          result = await walk(path[i], n);
          if (!result.arrived) break;
          i += n;
        }
        if (result && (result.arrived || result.interrupted)) return result;
      }
      const f = field()!;
      return { x: f.x, y: f.y, map: f.map, arrived: false, interrupted: false };
    },
    /**
     * Standing on a stair or arrow warp: push the way it leads and resolve once the next map is loaded
     * and the field is free again. Returns the new map's name.
     */
    enterWarp: async () => {
      const dir = overworld()?.testPushWarpDirection();
      if (!dir) throw new Error(`Not standing on a push warp: ${JSON.stringify(field())}`);
      const from = field()!.map;
      pad.holdWhile(DIR_BUTTON[dir], () => field()?.map === from && !field()?.busy);
      await pad.until(() => field()?.map !== from && idle());
      return field()!.map;
    },
    /** Turn to face `dir` without moving (a tap shorter than the walk threshold). */
    face: async (dir: Direction) => {
      if (field()?.facing === dir) return;
      await pad.press([DIR_BUTTON[dir]], 1, 1);
      await pad.until(() => !field()?.moving);
    },
    /**
     * Resolves at the start of the first tick where `pred()` is true (checked every tick, in the page), with
     * whether it was (false after `maxFrames`). The result is the one from that tick: the promise settles after
     * the frame's batch of ticks, when a short-lived state can be over, so it isn't checked again then. Read
     * anything else you need from that tick inside `pred`.
     */
    until: (pred: () => unknown, maxFrames = 3600) => {
      const deadline = pad.frame + maxFrames;
      let held = false;
      return pad.until(() => (held = !!pred()) || pad.frame >= deadline).then(() => held);
    },

    // --- events
    events: (since = 0) => events.filter((e) => e.seq > since),
    lastSeq: () => seq,

    // --- probes
    scenes: () => game.scene.getScenes(true).map((s) => s.scene.key),
    /** The GBA-layer screen running (gMain.callback2's name, e.g. BattleMainCB2, CB2_NamingScreen), if any. */
    gbaScreen: () => (game.scene.isActive('Battle') || game.scene.isActive('FieldMenu') || game.scene.isActive('MainMenu') ? gMain.callback2?.name : undefined),
    /** gPaletteFade.active: a GBA-layer screen fading in or out (menus ignore input until it's done). */
    paletteFadeActive: () => gPaletteFade.active,
    /** The main menu while it takes input: menu type (0 NEW GAME only, 1 CONTINUE / NEW GAME), cursor, fading, the CONTINUE values. */
    mainMenu: () => {
      const p = game.scene.isActive('MainMenu') ? mainMenuProbe() : undefined;
      return p && { ...p, stats: p.stats.map(decode) };
    },
    /** The title screen while its main task runs: the scene (INIT .. CRY), its state, the restart timer, whether PRESS START shows, the flames alive. */
    titleScreen: () => (game.scene.isActive('MainMenu') ? titleScreenProbe() : undefined),
    /** The clear save data screen (B+SELECT+UP on the title screen) while it runs: whether its YES/NO takes input. */
    clearSaveData: () => (game.scene.isActive('MainMenu') ? clearSaveDataProbe() : undefined),
    /** Oak's speech (NEW GAME) while it runs: the running task's function name, the page / shrink timer, the menu taking input ('gender' | 'names' | 'yesNo'), fading, the Pikachu intro's state, the gender and names so far. */
    oakSpeech: () => {
      const p = game.scene.isActive('MainMenu') ? oakSpeechProbe() : undefined;
      return p && { ...p, playerName: decode(p.playerName), rivalName: decode(p.rivalName) };
    },
    /** The field start menu while it's open: its items and cursor. */
    startMenu: () => startMenuProbe(),
    /** The help window's text while it's up (the start menu's description in the HELP button mode), decoded. */
    helpMessage: () => {
      const text = helpMessageWindowProbe();
      return text && decode(text);
    },
    /** The option menu while it's up (menus/optionMenu.ts): Task_OptionMenu's loadState (2 = input), the cursor and the settings shown. */
    optionMenu: () => optionMenuProbe(),
    /** The Pewter Museum's fossil pic (ui/MuseumFossilPic.ts), while one is up. */
    museumFossilPic: () => museumFossilPicProbe(),
    /** The start menu's save dialog while it runs: whether its YES/NO menu and save info window are up, and that window's values. */
    saveDialog: () => {
      const p = saveDialogProbe();
      return p && { ...p, stats: p.stats.map(decode) };
    },
    field,
    idle,
    /** The current map's objects: local id, graphics and map-local position. */
    objects: () => overworld()?.testObjects() ?? [],
    /**
     * Put the player in an avatar state the way the game does it (SetPlayerAvatarTransitionFlags with
     * PLAYER_AVATAR_FLAG_<state>): 'MACH_BIKE' gets on the bike, 'SURFING' onto a surfing mon, 'ON_FOOT' off.
     * (The game never leaves the surf blob behind that way, so it goes too.)
     */
    setAvatarState: (state: 'ON_FOOT' | 'MACH_BIKE' | 'SURFING') => {
      if (state !== 'SURFING') DestroyPlayerSurfBlob();
      SetPlayerAvatarTransitionFlags(define(`PLAYER_AVATAR_FLAG_${state}`));
    },
    get state() {
      return state();
    },
    flag: (name: string) => requireState().getFlag(name),
    var: (name: string) => requireState().getVar(name),
    money: () => requireState().money,
    /** The trainer's flag (TRAINER_FLAGS_START + id), e.g. trainerDefeated('BUG_CATCHER_RICK'). */
    trainerDefeated: (name: string) => requireState().getFlag(define('TRAINER_FLAGS_START') + define(`TRAINER_${name}`)),
    party: () => state()?.party.map(monSummary) ?? [],
    /** Every set flag and non-zero var, by name (FLAG_* / VAR_*, numbers for unnamed ones). */
    snapshot: () => {
      const s = requireState() as unknown as { flags: Set<number>; vars: Map<number, number> };
      const flags = [...s.flags].sort((a, b) => a - b).map((f) => nameOf('FLAG_', f) ?? String(f));
      const vars: Record<string, number> = {};
      for (const [v, value] of [...s.vars].sort((a, b) => a[0] - b[0])) if (value) vars[nameOf('VAR_', v) ?? String(v)] = value;
      return { flags, vars };
    },
    /** The field message box's text while it's open, decoded (line breaks become spaces). */
    message: () => {
      const m = field()?.message;
      return m ? decode(m) : undefined;
    },
    /**
     * The Pokémon Storage System's box screen while it runs (CB2_PokeStorage): its task and state, the cursor
     * (CURSOR_AREA_*, position, carrying a mon), the party box, the current box, the mon shown on the left,
     * the bottom message and the open menu's items, decoded.
     */
    pcStorage: () => {
      if (gMain.callback2?.name !== 'CB2_PokeStorage') return undefined;
      const p = storageProbe();
      return { ...p, message: decode(p.message), menu: p.menu.map(decode) };
    },
    /** The Hall of Fame screen or PC while one of its tasks runs (menus/hallOfFame.ts): the task, its data, the teams loaded. */
    hallOfFame: () => hallOfFameProbe(),
    /** The credits while they run (menus/credits.ts): their scene (CREDITSSCENE_*), script position and map / mon index. */
    credits: () => creditsProbe(),
    /** Jump the credits to their closing screens once they're between commands; false if not (try again next tick). */
    creditsSkipToClosing: () => creditsSkipToClosing(),
    /**
     * The region map while it runs (menus/regionMap.ts: the Town Map, the fly map, the wall maps): its
     * REGIONMAP_TYPE_*, the task, the cursor and player icon cells, what's under the cursor (MAPSEC_*,
     * MAPSECTYPE_*), the fly icons, and the map name and top bar's right text, decoded.
     */
    regionMap: () => {
      const p = regionMapProbe();
      return p && { ...p, mapName: decode(p.mapName), topBarRight: decode(p.topBarRight) };
    },
    /**
     * The Pokédex screen while it's up (menus/pokedexScreen.ts): the task and its state, `ready` (input state, no
     * fade), the seen/owned counts it computed, the top menu's list, the numerical / search list (order, rows,
     * cursor, the selected row's species and its seen/caught bits) and the mon page (what it printed).
     */
    pokedex: () => pokedexScreenProbe(),
    /**
     * The Pokédex area page while it's up (menus/pokedexArea.ts): the species, `ready` (its input state, no fade),
     * the Kanto map's offset, the unlocked islands, the markers (count, sprite), "AREA UNKNOWN", the type icons, the
     * icon, and the two silhouettes (OAM, matrix scale, y2).
     */
    pokedexArea: () => pokedexAreaProbe(),
    /**
     * The trainer card while it's up (menus/trainerCard.ts): its state, `ready` / `backReady` (that side takes input,
     * no fade), `onBack`, the flip while it runs (step, card top, BLDY, the per-line BG0VOFS), the stars and badges it
     * has and draws, the back's mon icons and stickers, which card palette is loaded, the trainer pic's pixels and
     * what each side printed, decoded.
     */
    trainerCard: () => {
      const p = trainerCardProbe();
      return p && { ...p, printed: Object.fromEntries(Object.entries(p.printed).map(([k, v]) => [k, decode(v!)])) as Record<string, string> };
    },
    /**
     * The slot machine while it's up (menus/slotMachine.ts): the main task and its step, `ready` (CB2_RunSlotMachine,
     * no fade), the game state (bet, reels, win lines, payout), the CREDIT / PAYOUT digits drawn, Clefairy's anim,
     * the help window's slide, the line lights' palettes and the reel buttons.
     */
    slotMachine: () => slotMachineProbe(),
    /** The item PC's list (WITHDRAW ITEM, item_pc.c) while it runs: its task, scroll/row and item count. */
    itemPc: () => (gMain.callback2?.name === 'ItemPc_MainCB' ? itemPcProbe() : undefined),
    /** The TM case while it's open (menus/tmCase.ts): TMCASE_* type, task, scroll/row and the pocket's item ids in list order. */
    tmCase: () => (gMain.callback2?.name === 'CB2_Idle' ? tmCaseProbe() : undefined),
    /** The egg hatch scene while it's up (menus/eggHatch.ts): CB2_state, the egg's anim / visibility, the mon's, shards. */
    eggHatch: () => eggHatchProbe(),
    /** The move relearner while it's up (menus/learnMove.ts): its MENU_STATE_*, the list's moves and selection. */
    moveRelearner: () => (gMain.callback2?.name === 'CB2_MoveRelearner' ? moveRelearnerProbe() : undefined),
    /** The berry pouch while it's open (menus/berryPouch.ts): BERRYPOUCH_* type, task, scroll/row and the pocket's berries in list order. */
    berryPouch: () => (gMain.callback2?.name === 'CB2_BerryPouchIdle' ? berryPouchProbe() : undefined),
    /** The map name popup while Task_MapNamePopup runs: its text, decoded, and how many px of it are on screen. */
    mapNamePopup: () => {
      const f = field();
      return f?.mapNamePopup ? { text: decode(f.mapNamePopup), height: f.mapNamePopupHeight } : undefined;
    },
    /** The GBA task list's active tasks (gTasks), by function name: e.g. the bag's Task_BagMenu_HandleInput. */
    gbaTasks: () => gTasks.filter((t) => t.isActive).map((t) => t.func.name),
    /** Quantity of the first stack of ITEM_<name> in the bag (0 if none). */
    itemCount: (name: string) => {
      const id = define(`ITEM_${name}`);
      return requireState().bag.pockets.flat().find((s) => s.itemId === id)?.quantity ?? 0;
    },
    /** The live battle (battle globals), or undefined outside one. */
    battle: () => {
      if (!game.scene.isActive('Battle') || !g) return undefined;
      const mons = Array.from({ length: g.battlersCount }, (_, i) => {
        const m = g.battleMons[i];
        const partyMon = (getBattlerSide(i) ? g.enemyParty : g.playerParty)[g.battlerPartyIndexes[i]];
        const sprite = gSprites[g.battlerSpriteIds[i]];
        return {
          species: shortName('SPECIES_', m.species),
          hp: m.hp,
          maxHP: m.maxHP,
          level: m.level,
          // The party mon's nickname (what the healthbox shows), the species its sprite shows when
          // transformed, and whether that sprite is hidden.
          nickname: partyMon && decode(partyMon.nickname),
          transformSpecies: shortName('SPECIES_', g.battleSpritesDataPtr.battlerData[i].transformSpecies),
          spriteInvisible: sprite?.invisible,
        };
      });
      // The player's controller function, e.g. HandleInputChooseAction while the action menu waits.
      const controller = g.battlerControllerFuncs[0]?.name;
      // The battle message as last expanded (gDisplayedStringBattle), decoded.
      const message = decode(g.displayedStringBattle);
      return { typeFlags: g.battleTypeFlags, trainer: g.trainerBattleOpponent_A, mons, outcome: g.battleOutcome, controller, message };
    },
    /** The GBA layer's sprites in use (battle and GBA-hosted menus): template tags, position, visibility. */
    gbaSprites: () =>
      gSprites
        .filter((s) => s.inUse)
        .map((s) => ({ tileTag: s.template.tileTag, paletteTag: s.template.paletteTag, x: s.x + s.x2, y: s.y + s.y2, invisible: s.invisible })),
    /** A GPU register by REG_OFFSET_* (e.g. 0x4c MOSAIC, 0x50 BLDCNT). */
    gpuReg: (offset: number) => GetGpuReg(offset),
    /** gBattleOutcome as the last battle left it, by name (B_OUTCOME_WON, ...). */
    lastOutcome: () => {
      const o = state()?.battleOutcome;
      return o ? nameOf('B_OUTCOME_', o) : undefined;
    },
    define,
    nameOf,
    decode,

    // --- setup
    seed: (n: number) => seedRng(n),
    /**
     * Seeds the RNG with `n` at the start of the first tick where `pred` holds, inside that tick (an awaited
     * `seed()` after `until()` lands wherever the frame's batch of ticks ends). Resolves false if `maxFrames`
     * pass first.
     */
    seedWhen: (pred: () => unknown, n: number, maxFrames = 20000) =>
      new Promise<boolean>((resolve) => {
        const deadline = pad.frame + maxFrames;
        pad.drive(() => {
          if (pred()) {
            seedRng(n);
            resolve(true);
            return undefined;
          }
          if (pad.frame >= deadline) {
            resolve(false);
            return undefined;
          }
          return [];
        });
      }),
    /** Replace the party (CreateMon with the player as OT). */
    setParty: (specs: MonSpec[]) => {
      requireState().party = specs.map(createMon);
    },
    /** StartWildBattle against a fresh mon, skipping the encounter dice. */
    startWildBattle: (spec: MonSpec) => overworld()!.startWildBattle(createMon(spec)),
    /** FldEff_UseFlash: what using Flash from the party menu ends in (FLAG_SYS_FLASH_ACTIVE + EventScript_FldEffFlash). */
    useFlash: () => overworld()!.useFlash(),
    /** Make every battle start with B_TRANSITION_<name> (undefined: back to the game's own choice). */
    forceBattleTransition: (name?: string) => {
      forcedBattleTransition = name === undefined ? undefined : define(`B_TRANSITION_${name}`);
    },

    /**
     * Tap `button` (2 ticks down, 4 up) until `pred(__test)` is truthy, checking at the start of every tick
     * and deciding whether to press in that same tick, so no press lands after the condition comes true
     * (e.g. on a menu that just opened). While the field message matches an `answers` pattern (regex
     * source, flags), that answer's button is tapped instead. Resolves with pred's value (falsy if
     * `maxFrames` ran out) and the distinct messages seen on the way.
     */
    // (pred takes `never` only to keep TestApi's type from referring to itself; it is called with the api.)
    mash: (pred: (t: never) => unknown, button: Button = 'A', maxFrames = 20000, answers: [string, string, Button][] = []) =>
      new Promise<{ value: unknown; messages: string[] }>((resolve, reject) => {
        const patterns = answers.map(([src, flags, b]) => [new RegExp(src, flags), b] as const);
        const messages: string[] = [];
        const deadline = pad.frame + maxFrames;
        let cycle = 0;
        let current: Button = button;
        pad.drive(() => {
          let value: unknown;
          try {
            value = pred(api as never);
          } catch (e) {
            reject(e);
            return undefined;
          }
          const msg = api.message();
          if (msg && messages[messages.length - 1] !== msg) messages.push(msg);
          if (value || pad.frame >= deadline) {
            resolve({ value, messages });
            return undefined;
          }
          const phase = cycle++ % 6;
          if (phase === 0) current = patterns.find(([re]) => msg && re.test(msg))?.[1] ?? button;
          return phase < 2 ? [current] : [];
        });
      }),
  };
  return api;
}

/** `window.__test` */
export type TestApi = ReturnType<typeof createApi>;

function install(game: Phaser.Game): void {
  enabled = true;
  const q = new URLSearchParams(location.search);
  if (q.has('seed')) seedRng(Number(q.get('seed')));
  if (q.has('speed')) logicSpeed = Math.max(1, Math.floor(Number(q.get('speed')) || 1));
  const ts = q.get('textSpeed');
  if (ts && ts in TEXT_SPEED) textSpeed = ts as TextSpeed;
  (window as unknown as { __test: TestApi }).__test = createApi(game);
  testEvent('hooks');
}

/** The URL's new-game options, applied by the overworld once its state exists and before the first map loads. */
function applyTestOptions(state: GameState): void {
  if (textSpeed) state.textSpeed = textSpeed;
}

export const testHooks = { install, applyTestOptions };
