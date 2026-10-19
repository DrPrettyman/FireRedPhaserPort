// field_specials.c: the Elite Four and Champion rooms' lighting. DoPokemonLeagueLightingEffect (the rooms'
// ON_RESUME script, PokemonLeague_EventScript_DoLightingEffect) cycles BG palette 7 through
// sEliteFourLightingPalettes / sChampionRoomLightingPalettes on their timers; after the battle
// Task_CancelPokemonLeagueLightingEffect sets the last palette once the door opens (FLAG_TEMP_4).
//
// The field draws metatiles from atlases, so a BG palette load goes through world/TilesetVram.ts's
// loadBgPalette, which redraws the metatiles that use the slot. The field's palette fades are an overlay
// over everything, so a palette loaded mid-fade is faded with the rest. No Phaser import: menus/itemUse.ts
// (loaded by the battle unit tests) calls StopPokemonLeagueLightingEffectTask.

import { state } from '../battle/env';
import { K } from '../battle/constants';
import { registerSpecials } from '../script/specials';
import { globalFieldTintMode, mapJascColors, tintForMode } from './questLogScreen';

/** public/gen/leagueLighting.json (tools/extract_field.py extract_league_lighting) */
interface LeagueLightingData {
  /** sEliteFourLightingPalettes: 12 palettes of 16 [r, g, b] */
  eliteFourPalettes: number[][];
  /** sChampionRoomLightingPalettes: 9 palettes */
  championRoomPalettes: number[][];
  /** sEliteFourLightingTimers (frames per palette) */
  eliteFourTimers: number[];
  /** sChampionRoomLightingTimers */
  championRoomTimers: number[];
}

/** What the lighting needs from the field. */
export interface LeagueLightingHost {
  /** LoadPalette(colors, BG_PLTT_ID(slot), PLTT_SIZE_4BPP) into the field's BG palettes, then redraw. */
  loadBgPalette(slot: number, colors: number[]): void;
  /** gPaletteFade.active */
  paletteFadeActive(): boolean;
  /** CreateTask on the field: `tick` runs once a frame (after the scripts) until it returns true. */
  createTask(tick: () => boolean): void;
}

const LIGHTING_PALETTE = 7; // BG_PLTT_ID(7)
const MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM = 'MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM';

let data: LeagueLightingData | undefined;
let loading: Promise<LeagueLightingData> | undefined;
let host: LeagueLightingHost | undefined;

export async function loadLeagueLightingData(base: string): Promise<void> {
  loading ??= fetch(`${base}/leagueLighting.json`).then((res) => {
    if (!res.ok) throw new Error(`Failed to load leagueLighting.json: ${res.status}`);
    return res.json() as Promise<LeagueLightingData>;
  });
  data = await loading;
}

export function setLeagueLightingHost(h: LeagueLightingHost): void {
  host = h;
}

type LightingFunc = 'Task_RunPokemonLeagueLightingEffect' | 'Task_CancelPokemonLeagueLightingEffect';

/** One lighting task: its func and gTasks[taskId].data[0..2] (timer, palette index, palette count). */
interface LightingTask {
  func: LightingFunc;
  data: Int16Array;
}

/** The lighting tasks alive (the GBA's gTasks entries running one of the two funcs). */
const tasks = new Set<LightingTask>();

function inChampionsRoom(): boolean {
  // gSaveBlock1Ptr->location == MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM
  return state.currentMapId === MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM;
}

/**
 * LoadPalette(pal, BG_PLTT_ID(7), PLTT_SIZE_4BPP) + ApplyGlobalTintToPaletteSlot(7, 1): the quest log's tint on it
 * (its backup in BACKUP_GRAYSCALE is the tileset's palette, which the lighting replaces again on its next step).
 */
function loadLightingPalette(pal: number[]): void {
  const tint = tintForMode(globalFieldTintMode());
  host?.loadBgPalette(LIGHTING_PALETTE, tint ? mapJascColors(pal, tint) : pal);
}

function CreateTask(func: LightingFunc): LightingTask {
  const task: LightingTask = { func, data: new Int16Array(3) };
  tasks.add(task);
  host?.createTask(() => {
    if (!tasks.has(task)) return true; // DestroyTask / ResetTasks
    if (task.func === 'Task_RunPokemonLeagueLightingEffect') Task_RunPokemonLeagueLightingEffect(task);
    else Task_CancelPokemonLeagueLightingEffect(task);
    return !tasks.has(task);
  });
  return task;
}

/** `special DoPokemonLeagueLightingEffect` */
export function DoPokemonLeagueLightingEffect(): void {
  if (!data) return;
  const task = CreateTask('Task_RunPokemonLeagueLightingEffect');
  const d = task.data;
  if (state.getFlag('FLAG_TEMP_3')) {
    task.func = 'Task_CancelPokemonLeagueLightingEffect';
  } else {
    if (inChampionsRoom()) {
      d[0] = data.championRoomTimers[0];
      d[2] = 8;
      loadLightingPalette(data.championRoomPalettes[0]);
    } else {
      d[0] = data.eliteFourTimers[0];
      d[2] = 11;
      loadLightingPalette(data.eliteFourPalettes[0]);
    }
    d[1] = 0;
  }
}

/** Task_RunPokemonLeagueLightingEffect: the next palette each time the timer runs out, while FLAG_TEMP_2 is set. */
function Task_RunPokemonLeagueLightingEffect(task: LightingTask): void {
  const d = task.data;
  if (
    !host?.paletteFadeActive() &&
    state.getFlag('FLAG_TEMP_2') &&
    !state.getFlag('FLAG_TEMP_5') &&
    globalFieldTintMode() !== K.QL_TINT_BACKUP_GRAYSCALE &&
    --d[0] === 0
  ) {
    if (++d[1] === d[2]) d[1] = 0;
    if (inChampionsRoom()) {
      d[0] = data!.championRoomTimers[d[1]];
      loadLightingPalette(data!.championRoomPalettes[d[1]]);
    } else {
      d[0] = data!.eliteFourTimers[d[1]];
      loadLightingPalette(data!.eliteFourPalettes[d[1]]);
    }
  }
}

/**
 * Task_CancelPokemonLeagueLightingEffect: once FLAG_TEMP_4 is set (the door opened), the last palette, and
 * the task ends. While a palette fade runs the GBA blends the new palette to black at once
 * (BlendPalettes(0x00000080, 16, RGB_BLACK)) so it doesn't flash before the fade's next step; the field's
 * fade is an overlay over all of it, so that needs nothing here.
 */
function Task_CancelPokemonLeagueLightingEffect(task: LightingTask): void {
  if (!state.getFlag('FLAG_TEMP_4')) return;
  if (inChampionsRoom()) loadLightingPalette(data!.championRoomPalettes[8]);
  else loadLightingPalette(data!.eliteFourPalettes[11]);
  tasks.delete(task); // DestroyTask
}

/** StopPokemonLeagueLightingEffectTask: the start menu and the registered items' screens, as they fade out. */
export function StopPokemonLeagueLightingEffectTask(): void {
  // FuncIsActiveTask + DestroyTask(FindTaskIdByFunc(...)): the first one
  for (const task of tasks) {
    if (task.func === 'Task_RunPokemonLeagueLightingEffect') {
      tasks.delete(task);
      return;
    }
  }
}

/** The field's ResetTasks (a map load, ResumeMap): the lighting tasks are gone with the rest. */
export function ResetLeagueLightingTasks(): void {
  tasks.clear();
}

export function registerLeagueLighting(): void {
  registerSpecials({
    DoPokemonLeagueLightingEffect() {
      DoPokemonLeagueLightingEffect();
    },
  });
}

/** Dev: the lighting tasks, for `__test.leagueLighting()`. */
export function leagueLightingProbe(): { func: LightingFunc; timer: number; index: number; count: number }[] {
  return [...tasks].map((t) => ({ func: t.func, timer: t.data[0], index: t.data[1], count: t.data[2] }));
}
