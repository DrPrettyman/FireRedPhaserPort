// field_weather.c, field_weather_util.c and the FRLG weathers of field_weather_effects.c: the weather state
// (gWeatherPtr), the weather task (Task_WeatherInit / Task_WeatherMain), its palette processing (the gamma shift
// tables, ApplyGammaShift, the screen fade-in with the weather's palettes) and the saved weather
// (gSaveBlock1Ptr->weather: SetSavedWeather, SetSavedWeatherFromCurrMapHeader, DoCurrentWeather,
// ResumePausedWeather).
//
// FRLG's maps and scripts reach WEATHER_NONE, WEATHER_SUNNY, WEATHER_SHADE and WEATHER_FOG_HORIZONTAL
// (POSTGAME_PLAN.md decision 1). The fog's sprites and blend are W-weather unit 2: until then its rows of
// sWeatherFuncs run None's callbacks and asking for it logs once, as asking for any other weather does (rain, snow,
// thunder, ash, sandstorm, diagonal fog, underwater bubbles, drought, downpour: no FRLG map or script reaches them).
//
// The field draws from atlases and Phaser textures, not from palette RAM: the host (OverworldScene) loads the
// gamma-shifted BG palettes through tilesetVram (gPlttBufferFaded; tilesetVram keeps gPlttBufferUnfaded beside it)
// and shifts the object and field effect sprite sheets (world/weatherTextures.ts). The screen fades are overlays
// (ui/ScreenFade.ts): when the weather fades the screen in itself (FadeInScreen_RainShowShade), the overlay takes its
// blend coefficient from here. No Phaser import: the unit tests build the gamma tables.

import { state } from '../battle/env';

// The gamma types of sBasePaletteGammaTypes (field_weather.c's anonymous enum)
const GAMMA_NONE = 0;
const GAMMA_NORMAL = 1;
const GAMMA_ALT = 2;
const GAMMA_TYPES: Record<string, number> = { GAMMA_NONE, GAMMA_NORMAL, GAMMA_ALT };

// include/constants/field_weather.h
const WEATHER_PAL_STATE_CHANGING_WEATHER = 0;
const WEATHER_PAL_STATE_SCREEN_FADING_IN = 1;
const WEATHER_PAL_STATE_SCREEN_FADING_OUT = 2;
const WEATHER_PAL_STATE_IDLE = 3;

/** The number of BG palettes (the OBJ palettes are 16-31 in the C's indexing). */
const NUM_BG_PALS = 16;
/** gammaShifts[19][32] / altGammaShifts[19][32] */
const NUM_GAMMA_LEVELS = 19;

/** public/gen/weather.json (tools/extract_field.py extract_weather) */
interface WeatherData {
  /** sBasePaletteGammaTypes: GAMMA_NONE / GAMMA_NORMAL / GAMMA_ALT per palette (16 BG, then 16 OBJ). */
  paletteGammaTypes: string[];
  /** sWeatherFuncs by weather id: the callbacks' prefix ("None", "Sunny", "Shade", "FogHorizontal", ...). */
  funcs: string[];
  /** The field effect palette tags loaded with loadfadedpal (UpdateSpritePaletteWithWeather). */
  fadedFieldEffectPaletteTags: string[];
}

/** What the weather needs from the field. */
export interface WeatherHost {
  /** gPlttBufferUnfaded for one of the map's BG palettes (16 JASC [r, g, b]), undefined outside the map's 0-12. */
  bgPaletteUnfaded(slot: number): number[] | undefined;
  /** gPlttBufferFaded: the colours BG palette `slot` shows now (the map's atlases are redrawn with them). */
  setBgPaletteFaded(slot: number, colors: number[]): void;
  /**
   * The OBJ palettes' gamma shift: the sprites drawn with GAMMA_NORMAL palettes (reflections, field effects) through
   * `normal`, the GAMMA_ALT ones (the objects themselves) through `alt`; a table maps a 5-bit channel to its shifted
   * value, undefined = the colours as loaded.
   */
  setObjPaletteGamma(normal: Uint8Array | undefined, alt: Uint8Array | undefined): void;
}

/** One sWeatherFuncs row. */
interface WeatherCallbacks {
  initVars(): void;
  main(): void;
  initAll(): void;
  /** TRUE while the weather is still cleaning up. */
  finish(): boolean;
}

let data: WeatherData | undefined;
let loading: Promise<WeatherData> | undefined;
let host: WeatherHost | undefined;

export async function loadWeatherData(base: string): Promise<void> {
  loading ??= fetch(`${base}/weather.json`).then((res) => {
    if (!res.ok) throw new Error(`Failed to load weather.json: ${res.status}`);
    return res.json() as Promise<WeatherData>;
  });
  data = await loading;
  sBasePaletteGammaTypes = data.paletteGammaTypes.map((t) => GAMMA_TYPES[t] ?? GAMMA_NORMAL);
  sPaletteGammaTypes = sBasePaletteGammaTypes;
}

export function setWeatherHost(h: WeatherHost | undefined): void {
  host = h;
}

/** The field effect palette tags whose sprites the weather shifts (FieldEffectScript_LoadFadedPalette). */
export function fadedFieldEffectPaletteTags(): readonly string[] {
  return data?.fadedFieldEffectPaletteTags ?? [];
}

// ------------------------------------------------------------------ sWeather (gWeatherPtr)

/** The part of struct Weather the ported weathers use. */
const sWeather = {
  gammaShifts: Array.from({ length: NUM_GAMMA_LEVELS }, () => new Uint8Array(32)),
  altGammaShifts: Array.from({ length: NUM_GAMMA_LEVELS }, () => new Uint8Array(32)),
  gammaIndex: 0,
  gammaTargetIndex: 0,
  gammaStepDelay: 0,
  gammaStepFrameCounter: 0,
  palProcessingState: WEATHER_PAL_STATE_IDLE,
  fadeScreenCounter: 0,
  readyForInit: false,
  fadeInActive: 0,
  fadeInCounter: 0,
  initStep: 0,
  finishStep: 0,
  currWeather: 0,
  nextWeather: 0,
  weatherChangeComplete: true,
};

/** The weather task: Task_WeatherInit until the screen fades in, then Task_WeatherMain; undefined once ResetTasks killed it. */
let task: 'Task_WeatherInit' | 'Task_WeatherMain' | undefined;
let tablesBuilt = false;
let sBasePaletteGammaTypes: number[] = [];
let sPaletteGammaTypes: number[] = [];

// ------------------------------------------------------------------ the weathers (field_weather_effects.c)

function None_Init(): void {
  sWeather.gammaTargetIndex = 0;
  sWeather.gammaStepDelay = 0;
}

const NONE: WeatherCallbacks = { initVars: None_Init, main: () => {}, initAll: None_Init, finish: () => false };

/** Sunny_InitVars: no gamma shift, no sprites (FRLG's WEATHER_SUNNY looks like WEATHER_NONE). */
function Sunny_InitVars(): void {
  sWeather.gammaTargetIndex = 0;
  sWeather.gammaStepDelay = 20;
}

const SUNNY: WeatherCallbacks = {
  initVars: Sunny_InitVars,
  main: () => {}, // Sunny_Main
  initAll: Sunny_InitVars, // Sunny_InitAll
  finish: () => false, // Sunny_Finish
};

/** Shade_InitVars: the palettes three steps darker (gamma index 3), one step per 20 frames. */
function Shade_InitVars(): void {
  sWeather.initStep = 0;
  sWeather.gammaTargetIndex = 3;
  sWeather.gammaStepDelay = 20;
}

const SHADE: WeatherCallbacks = {
  initVars: Shade_InitVars,
  main: () => {}, // Shade_Main
  initAll: Shade_InitVars, // Shade_InitAll
  finish: () => false, // Shade_Finish
};

/** sWeatherFuncs rows the port has. FogHorizontal (W-weather unit 2) and the rest run None's callbacks. */
const PORTED: Record<string, WeatherCallbacks> = { None: NONE, Sunny: SUNNY, Shade: SHADE };

const loggedUnported = new Set<number>();

/** sWeatherFuncs[weather] */
function weatherFuncs(weather: number): WeatherCallbacks {
  const name = data?.funcs[weather];
  const funcs = name ? PORTED[name] : undefined;
  if (funcs) return funcs;
  if (!loggedUnported.has(weather)) {
    loggedUnported.add(weather);
    console.warn(`[weather] weather ${weather} (${name ?? 'unknown'}) isn't ported: it runs as WEATHER_NONE`);
  }
  return NONE;
}

/** The weathers FadeScreen fades in with the weather's palettes (useWeatherPal), as far as they're ported. */
function fadesInWithWeatherPalettes(weather: number): boolean {
  // RAIN, RAIN_THUNDERSTORM, DOWNPOUR, SNOW, FOG_HORIZONTAL, SHADE, DROUGHT in the C; only SHADE is ported
  return weather === define('WEATHER_SHADE');
}

function define(name: string): number {
  return state.defines.require(name);
}

// ------------------------------------------------------------------ field_weather.c

/** StartWeather: a new weather task (Task_WeatherInit), unless one is running; the weather is NONE until ResumePausedWeather. */
export function StartWeather(): void {
  if (task === 'Task_WeatherMain') return; // FuncIsActiveTask(Task_WeatherMain)
  // AllocSpritePalette(PALTAG_WEATHER) + gDefaultWeatherSpritePalette: the fog's sprites (unit 2)
  BuildGammaShiftTables();
  // Weather_SetBlendCoeffs(16, 0) and the sprite counters: the fog's (unit 2)
  sWeather.currWeather = define('WEATHER_NONE');
  sWeather.palProcessingState = WEATHER_PAL_STATE_IDLE;
  sWeather.readyForInit = false;
  sWeather.weatherChangeComplete = true;
  task = 'Task_WeatherInit'; // CreateTask(Task_WeatherInit, 80)
}

/** The field's ResetTasks (a warp's map load, ResumeMap): the weather task is gone until StartWeather. */
export function ResetWeatherTask(): void {
  task = undefined;
}

/** SetNextWeather: Task_WeatherMain finishes the current weather and starts this one. */
export function SetNextWeather(weather: number): void {
  // PlayRainStoppingSoundEffect: only sounds in rain (not ported, decision 1)
  if (sWeather.nextWeather !== weather && sWeather.currWeather === weather) weatherFuncs(weather).initVars();
  sWeather.weatherChangeComplete = false;
  sWeather.nextWeather = weather;
  sWeather.finishStep = 0;
}

/** SetCurrentAndNextWeather: switch at once (the new weather's InitAll runs when the task inits). */
export function SetCurrentAndNextWeather(weather: number): void {
  // PlayRainStoppingSoundEffect (not ported)
  sWeather.currWeather = weather;
  sWeather.nextWeather = weather;
}

/** The weather task, once a frame (priority 80, with the field's other tasks). */
export function WeatherTask(): void {
  if (task === 'Task_WeatherInit') Task_WeatherInit();
  else if (task === 'Task_WeatherMain') Task_WeatherMain();
}

/** Task_WeatherInit: waits until the screen fades in (FadeScreen sets readyForInit), then the weather's InitAll. */
function Task_WeatherInit(): void {
  if (sWeather.readyForInit) {
    weatherFuncs(sWeather.currWeather).initAll();
    task = 'Task_WeatherMain'; // from the next frame
  }
}

function Task_WeatherMain(): void {
  if (sWeather.currWeather !== sWeather.nextWeather) {
    if (!weatherFuncs(sWeather.currWeather).finish()) {
      // Finished cleaning up the previous weather: on to the next one
      weatherFuncs(sWeather.nextWeather).initVars();
      sWeather.gammaStepFrameCounter = 0;
      sWeather.palProcessingState = WEATHER_PAL_STATE_CHANGING_WEATHER;
      sWeather.currWeather = sWeather.nextWeather;
      sWeather.weatherChangeComplete = true;
    }
  } else {
    weatherFuncs(sWeather.currWeather).main();
  }
  // sWeatherPalStateFuncs[palProcessingState]
  switch (sWeather.palProcessingState) {
    case WEATHER_PAL_STATE_CHANGING_WEATHER:
      UpdateWeatherGammaShift();
      break;
    case WEATHER_PAL_STATE_SCREEN_FADING_IN:
      FadeInScreenWithWeather();
      break;
    default: // DoNothing
      break;
  }
}

/**
 * BuildGammaShiftTables: gammaShifts (each row darker by 1/16 for indices 0-2, then lighter up to white) and
 * altGammaShifts (the same without the darkening: rows 0-2 leave the colours alone). The C keeps the u16
 * arithmetic of its loops; so does this.
 */
function BuildGammaShiftTables(): void {
  sPaletteGammaTypes = sBasePaletteGammaTypes;
  if (tablesBuilt) return; // the same two tables every time
  tablesBuilt = true;
  for (let v0 = 0; v0 <= 1; v0++) {
    const gammaTable = v0 === 0 ? sWeather.gammaShifts : sWeather.altGammaShifts;
    for (let v2 = 0; v2 < 32; v2++) {
      let v4 = v2 << 8;
      const v5 = v0 === 0 ? Math.floor((v2 << 8) / 16) : 0;
      let gammaIndex = 0;
      for (; gammaIndex <= 2; gammaIndex++) {
        v4 = (v4 - v5) & 0xffff;
        gammaTable[gammaIndex][v2] = v4 >> 8;
      }
      const v9 = v4;
      let v10 = (0x1f00 - v4) >>> 0; // u32
      if (0x1f00 - v4 < 0) v10 = (v10 + 0xf) >>> 0;
      const v11 = (v10 >>> 4) & 0xffff;
      for (; gammaIndex < NUM_GAMMA_LEVELS; gammaIndex++) {
        v4 = (v4 + v11) & 0xffff;
        if (v2 < 12) {
          const dunno = ((v4 - v9) << 16) >> 16; // s16
          if (dunno > 0) v4 = (v4 - ((dunno + ((dunno & 0xffff) >> 15)) >> 1)) & 0xffff;
        }
        gammaTable[gammaIndex][v2] = Math.min((v4 >> 8) & 0xff, 0x1f);
      }
    }
  }
}

/** UpdateWeatherGammaShift: one gamma step toward the target every gammaStepDelay frames. */
function UpdateWeatherGammaShift(): void {
  if (sWeather.gammaIndex === sWeather.gammaTargetIndex) {
    sWeather.palProcessingState = WEATHER_PAL_STATE_IDLE;
  } else if (++sWeather.gammaStepFrameCounter >= sWeather.gammaStepDelay) {
    sWeather.gammaStepFrameCounter = 0;
    if (sWeather.gammaIndex < sWeather.gammaTargetIndex) sWeather.gammaIndex++;
    else sWeather.gammaIndex--;
    ApplyGammaShift(0, 32, sWeather.gammaIndex);
  }
}

/** FadeInScreenWithWeather */
function FadeInScreenWithWeather(): void {
  if (++sWeather.fadeInCounter > 1) sWeather.fadeInActive = 0;
  if (fadesInWithWeatherPalettes(sWeather.currWeather)) {
    // WEATHER_SHADE (and the unported RAIN, THUNDERSTORM, DOWNPOUR, SNOW)
    if (!FadeInScreen_RainShowShade()) {
      sWeather.gammaIndex = 3;
      sWeather.palProcessingState = WEATHER_PAL_STATE_IDLE;
    }
  } else if (!paletteFadeActive()) {
    // default: wait for the normal palette fade (WEATHER_DROUGHT and WEATHER_FOG_HORIZONTAL have their own: not ported)
    sWeather.gammaIndex = sWeather.gammaTargetIndex;
    sWeather.palProcessingState = WEATHER_PAL_STATE_IDLE;
  }
}

/**
 * FadeInScreen_RainShowShade: 16 frames from the fade colour to the palettes at gamma index 3. The blend
 * (ApplyGammaShiftWithBlend's 16 - fadeScreenCounter) is the screen fade overlay's (`WeatherFadeInBlend`); the
 * palettes under it are shifted from the first step.
 */
function FadeInScreen_RainShowShade(): boolean {
  if (sWeather.fadeScreenCounter === 16) return false;
  if (++sWeather.fadeScreenCounter >= 16) {
    ApplyGammaShift(0, 32, 3);
    sWeather.fadeScreenCounter = 16;
    return false;
  }
  ApplyGammaShift(0, 32, 3); // ApplyGammaShiftWithBlend(0, 32, 3, 16 - fadeScreenCounter, fadeDestColor)
  return true;
}

let paletteFadeActive: () => boolean = () => false;

/** gPaletteFade.active, for FadeInScreenWithWeather's default case (the field's screen fade). */
export function setWeatherPaletteFadeActive(f: () => boolean): void {
  paletteFadeActive = f;
}

/** A 5-bit channel → shifted 5-bit channel table, or undefined where the row leaves the colours alone. */
function gammaRow(table: Uint8Array[], gammaIndex: number): Uint8Array | undefined {
  const row = table[gammaIndex - 1];
  return row.every((v, i) => v === i) ? undefined : row;
}

/**
 * ApplyGammaShift: palettes startPalIndex .. startPalIndex + numPalettes - 1 (0-15 BG, 16-31 OBJ) from the unfaded
 * colours through gamma row gammaIndex - 1 (GAMMA_ALT palettes through altGammaShifts); 0 copies them back unshifted,
 * a negative index (drought) does nothing in FRLG.
 */
function ApplyGammaShift(startPalIndex: number, numPalettes: number, gammaIndex: number): void {
  if (gammaIndex < 0 || !host) return; // Dummied out in FRLG
  const end = startPalIndex + numPalettes;
  for (let pal = startPalIndex; pal < Math.min(end, NUM_BG_PALS); pal++) {
    const unfaded = host.bgPaletteUnfaded(pal);
    if (!unfaded) continue;
    const type = sPaletteGammaTypes[pal];
    const table = gammaIndex === 0 || type === GAMMA_NONE ? undefined : gammaRow(type === GAMMA_ALT ? sWeather.altGammaShifts : sWeather.gammaShifts, gammaIndex);
    host.setBgPaletteFaded(pal, table ? shiftColors(unfaded, table) : unfaded);
  }
  if (end > NUM_BG_PALS) {
    // The port's sprites aren't in palette slots: the field's object and field effect sheets take the GAMMA_NORMAL
    // and GAMMA_ALT rows (sPaletteGammaTypes: the objects' slots 0, 2-5 and 10 and the weather's are ALT, their
    // reflections' and the field effects' NORMAL). PreservePaletteInWeather's GAMMA_NONE (the field move's mon) isn't
    // needed: that pic is drawn outside the field's sprites.
    objGammaIndex = gammaIndex;
    host.setObjPaletteGamma(objGammaTable('normal'), objGammaTable('alt'));
  }
}

/** The gamma index the OBJ palettes were last shifted with. */
let objGammaIndex = 0;

/** UpdateSpritePaletteWithWeather / ApplyWeatherGammaShiftToPal for a sprite sheet the field loads now: its table. */
export function objGammaTable(type: 'normal' | 'alt'): Uint8Array | undefined {
  if (objGammaIndex <= 0) return undefined;
  return gammaRow(type === 'alt' ? sWeather.altGammaShifts : sWeather.gammaShifts, objGammaIndex);
}

/** JASC [r, g, b] × 16 through a 5-bit table: gbagfx's 8 → 5 bits (>> 3), then back as the .pal files expand them. */
function shiftColors(colors: number[], table: Uint8Array): number[] {
  return colors.map((c) => expand5(table[c >> 3]));
}

/** A 5-bit channel as the decomp's JASC palettes hold it (floor(c * 255 / 31): 10 → 82, 31 → 255). */
export function expand5(c: number): number {
  return Math.floor((c * 255) / 31);
}

/**
 * ApplyWeatherGammaShiftToPal for the map's BG palettes: LoadMapFromCameraTransition reloads the new secondary
 * tileset's palettes and shifts them with the current gamma index (the port reloads all of them).
 */
export function ApplyWeatherGammaShiftToBgPals(): void {
  ApplyGammaShift(0, 13, sWeather.gammaIndex);
}

/**
 * FadeScreen's weather part (the palette fade itself is the overlay's: ui/ScreenFade.ts). Returns true when the
 * weather fades the screen in itself (useWeatherPal on a fade in): the overlay then follows `WeatherFadeInBlend`.
 */
export function WeatherFadeScreen(mode: number): boolean {
  let fadeOut: boolean;
  switch (mode) {
    case define('FADE_FROM_BLACK'):
    case define('FADE_FROM_WHITE'):
      fadeOut = false;
      break;
    case define('FADE_TO_BLACK'):
    case define('FADE_TO_WHITE'):
      fadeOut = true;
      break;
    default:
      return false;
  }
  const useWeatherPal = fadesInWithWeatherPalettes(sWeather.currWeather);
  if (fadeOut) {
    // useWeatherPal: CpuFastCopy(gPlttBufferFaded, gPlttBufferUnfaded) so the fade starts from the weather's colours;
    // the overlay fades whatever the field shows (see docs/DEVIATIONS.md)
    sWeather.palProcessingState = WEATHER_PAL_STATE_SCREEN_FADING_OUT;
    return false;
  }
  // fadeDestColor (RGB_BLACK / RGB_WHITEALPHA): the overlay's colour
  if (useWeatherPal) sWeather.fadeScreenCounter = 0;
  sWeather.palProcessingState = WEATHER_PAL_STATE_SCREEN_FADING_IN;
  sWeather.fadeInActive = 1;
  sWeather.fadeInCounter = 0;
  // Weather_SetBlendCoeffs(currBlendEVA, currBlendEVB): the fog's (unit 2)
  sWeather.readyForInit = true;
  return useWeatherPal;
}

/**
 * While the weather fades the screen in itself: the fade colour's share of the screen (16 = all fade colour, the
 * blend coefficient ApplyGammaShiftWithBlend uses), else undefined (done, or no weather task to do it).
 */
export function WeatherFadeInBlend(): number | undefined {
  if (task === undefined || sWeather.palProcessingState !== WEATHER_PAL_STATE_SCREEN_FADING_IN) return undefined;
  if (!fadesInWithWeatherPalettes(sWeather.currWeather)) return undefined;
  return 16 - sWeather.fadeScreenCounter;
}

/** IsWeatherNotFadingIn */
export function IsWeatherNotFadingIn(): boolean {
  return sWeather.palProcessingState !== WEATHER_PAL_STATE_SCREEN_FADING_IN;
}

/** GetCurrentWeather */
export function GetCurrentWeather(): number {
  return sWeather.currWeather;
}

/** IsWeatherChangeComplete */
export function IsWeatherChangeComplete(): boolean {
  return sWeather.weatherChangeComplete;
}

/** SetWeatherScreenFadeOut (Sweet Scent, the battle transitions) */
export function SetWeatherScreenFadeOut(): void {
  sWeather.palProcessingState = WEATHER_PAL_STATE_SCREEN_FADING_OUT;
}

/** WeatherProcessingIdle */
export function WeatherProcessingIdle(): void {
  sWeather.palProcessingState = WEATHER_PAL_STATE_IDLE;
}

// ------------------------------------------------------------------ field_weather_util.c (the saved weather)

/** TranslateWeatherNum: the Route 119 / 123 cycles (R/S leftovers) at weatherCycleStage 0 (FRLG never sets it). */
function TranslateWeatherNum(weather: number): number {
  if (weather === define('WEATHER_ROUTE119_CYCLE') || weather === define('WEATHER_ROUTE123_CYCLE')) return define('WEATHER_SUNNY');
  if (weather >= define('WEATHER_NONE') && weather <= define('WEATHER_UNDERWATER_BUBBLES')) return weather;
  return define('WEATHER_NONE');
}

/** UpdateRainCounter: GAME_STAT_GOT_RAINED_ON when the saved weather turns to rain. */
function UpdateRainCounter(newWeather: number, oldWeather: number): void {
  if (newWeather !== oldWeather && (newWeather === define('WEATHER_RAIN') || newWeather === define('WEATHER_RAIN_THUNDERSTORM'))) {
    state.incrementGameStat(define('GAME_STAT_GOT_RAINED_ON'));
  }
}

/** SetSavedWeather (`setweather`) */
export function SetSavedWeather(weather: number): void {
  const oldWeather = state.weather;
  state.weather = TranslateWeatherNum(weather);
  UpdateRainCounter(state.weather, oldWeather);
}

/** GetSav1Weather */
export function GetSav1Weather(): number {
  return state.weather;
}

/** gMapHeader.weather of the current map. */
let mapHeaderWeather = 0;

/** LoadCurrentMapData / LoadSaveblockMapHeader: the current map header's weather. */
export function SetMapHeaderWeather(weather: number): void {
  mapHeaderWeather = weather;
}

/** SetSavedWeatherFromCurrMapHeader (map loads, `resetweather`) */
export function SetSavedWeatherFromCurrMapHeader(): void {
  const oldWeather = state.weather;
  state.weather = TranslateWeatherNum(mapHeaderWeather);
  UpdateRainCounter(state.weather, oldWeather);
}

/** DoCurrentWeather (`doweather`, a map connection): change to the saved weather the usual way. */
export function DoCurrentWeather(): void {
  SetNextWeather(GetSav1Weather());
}

/** ResumePausedWeather (ResumeMap): the saved weather at once. */
export function ResumePausedWeather(): void {
  SetCurrentAndNextWeather(GetSav1Weather());
}

// ------------------------------------------------------------------ dev

export interface WeatherProbe {
  currWeather: number;
  nextWeather: number;
  savedWeather: number;
  gammaIndex: number;
  gammaTargetIndex: number;
  palProcessingState: number;
  task: string | undefined;
  /** The gamma index the field's sprite sheets are shifted with. */
  objGammaIndex: number;
}

/** Dev: the weather's state, for `__test.weather()`. */
export function weatherProbe(): WeatherProbe {
  return {
    currWeather: sWeather.currWeather,
    nextWeather: sWeather.nextWeather,
    savedWeather: state.weather,
    gammaIndex: sWeather.gammaIndex,
    gammaTargetIndex: sWeather.gammaTargetIndex,
    palProcessingState: sWeather.palProcessingState,
    task,
    objGammaIndex,
  };
}

/** Unit tests: BuildGammaShiftTables' two tables. */
export function gammaShiftTables(): { gammaShifts: Uint8Array[]; altGammaShifts: Uint8Array[] } {
  BuildGammaShiftTables();
  return { gammaShifts: sWeather.gammaShifts, altGammaShifts: sWeather.altGammaShifts };
}
