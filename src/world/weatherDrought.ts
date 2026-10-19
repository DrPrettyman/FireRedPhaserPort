// WEATHER_DROUGHT: field_weather_effects.c's Drought_* and StartDroughtWeatherBlend (UpdateDroughtBlend), with
// field_weather.c's drought half (FadeInScreen_Drought, ApplyDroughtGammaShiftWithBlend, LoadDroughtWeatherPalette(s),
// ResetDroughtWeatherPaletteLoading, SetDroughtGamma, DroughtStateInit / DroughtStateRun). No FRLG map or script
// reaches it (include/constants/weather.h: "unused and broken in overworld"); `setweather` + `doweather` from a dev
// script or the test hooks (`__test.doWeather`) do.
//
// FRLG dummied out R/S's drought palettes: LoadDroughtWeatherPalette does nothing (so LoadDroughtWeatherPalettes is
// TRUE for ever and Drought_Main never gets past its step 2), ApplyGammaShift does nothing for a negative gamma index
// (SetDroughtGamma's, FadeInScreen_Drought's last step), and ApplyDroughtGammaShiftWithBlend only blends the colours
// as loaded toward the fade colour. There are no drought palette tables to extract. What's left, as the C has it:
// a fade in that ends one blend step short of the colours as loaded (the palettes stay at the coefficient-1 blend
// toward the fade colour) and a weather that otherwise looks like WEATHER_NONE. Drought_InitAll never returns on the
// GBA (the game hangs on a map load or a return to the field in a drought); the port stops its loop where it would
// spin for ever (docs/DEVIATIONS.md). No Phaser.

import { gSineTable } from '../battle/trig';
import {
  ApplyGammaShift,
  expand5,
  gWeatherPtr,
  WEATHER_PAL_STATE_CHANGING_WEATHER,
  weatherHost,
  WeatherShiftGammaIfPalStateIdle,
  type ChannelTables,
  type WeatherCallbacks,
} from './weather';

// field_weather.c's static EWRAM sDroughtFrameDelay
let sDroughtFrameDelay = 0;

export function Drought_InitVars(): void {
  gWeatherPtr.initStep = 0;
  gWeatherPtr.weatherGfxLoaded = false;
  gWeatherPtr.gammaTargetIndex = 0;
  gWeatherPtr.gammaStepDelay = 0;
}

let warnedHang = false;

/**
 * Drought_InitAll: Main until the weather is set up. Main's steps 0 (the palettes changing) and 2
 * (LoadDroughtWeatherPalettes, TRUE for ever in FRLG) can't move on inside the loop, so the GBA never leaves it; the
 * port leaves the loop there instead (the weather task's Main carries on from that step every frame).
 */
export function Drought_InitAll(): void {
  Drought_InitVars();
  while (!gWeatherPtr.weatherGfxLoaded) {
    const step = gWeatherPtr.initStep;
    Drought_Main();
    if ((step === 0 || step === 2) && gWeatherPtr.initStep === step) {
      if (!warnedHang) {
        warnedHang = true;
        console.warn('[weather] Drought_InitAll never returns on the GBA (FRLG dummied LoadDroughtWeatherPalette): the port stops its loop');
      }
      return;
    }
  }
}

export function Drought_Main(): void {
  const w = gWeatherPtr;
  switch (w.initStep) {
    case 0:
      if (w.palProcessingState !== WEATHER_PAL_STATE_CHANGING_WEATHER) w.initStep++;
      break;
    case 1:
      ResetDroughtWeatherPaletteLoading();
      w.initStep++;
      break;
    case 2:
      if (!LoadDroughtWeatherPalettes()) w.initStep++;
      break;
    case 3:
      DroughtStateInit();
      w.initStep++;
      break;
    case 4:
      DroughtStateRun();
      if (w.droughtBrightnessStage === 6) {
        w.weatherGfxLoaded = true;
        w.initStep++;
      }
      break;
    default:
      DroughtStateRun();
      break;
  }
}

export function Drought_Finish(): boolean {
  return false;
}

export const DROUGHT: WeatherCallbacks = { initVars: Drought_InitVars, main: Drought_Main, initAll: Drought_InitAll, finish: Drought_Finish };

// ------------------------------------------------------------------ field_weather.c's drought half

/** LoadDroughtWeatherPalette: dummied out in FRLG (R/S built a palette's drought colours here and moved the index on). */
function LoadDroughtWeatherPalette(): void {
  // *gammaIndexPtr = 0x20;
  // *a1 = 0x20;
}

export function ResetDroughtWeatherPaletteLoading(): void {
  gWeatherPtr.loadDroughtPalsIndex = 1;
  gWeatherPtr.loadDroughtPalsOffset = 1;
}

/** LoadDroughtWeatherPalettes: TRUE while there are palettes left to load (for ever in FRLG: the index never moves). */
export function LoadDroughtWeatherPalettes(): boolean {
  if (gWeatherPtr.loadDroughtPalsIndex < 32) {
    LoadDroughtWeatherPalette();
    if (gWeatherPtr.loadDroughtPalsIndex < 32) return true;
  }
  return false;
}

/** SetDroughtGamma: gamma index -stage - 1 (ApplyGammaShift does nothing for a negative index in FRLG). */
function SetDroughtGamma(gammaIndex: number): void {
  WeatherShiftGammaIfPalStateIdle(-gammaIndex - 1);
}

export function DroughtStateInit(): void {
  gWeatherPtr.droughtBrightnessStage = 0;
  gWeatherPtr.droughtTimer = 0;
  gWeatherPtr.droughtState = 0;
  gWeatherPtr.droughtLastBrightnessStage = 0;
  sDroughtFrameDelay = 5;
}

/** DroughtStateRun: the brightness ramps up a stage every 6 frames to 6, then follows a sine between 2 and 5 (s16 fields). */
export function DroughtStateRun(): void {
  const w = gWeatherPtr;
  switch (w.droughtState) {
    case 0:
      // Ramp up
      if (++w.droughtTimer > sDroughtFrameDelay) {
        w.droughtTimer = 0;
        SetDroughtGamma(w.droughtBrightnessStage++);
        if (w.droughtBrightnessStage > 5) {
          w.droughtLastBrightnessStage = w.droughtBrightnessStage;
          w.droughtState = 1;
          w.droughtTimer = 60;
        }
      }
      break;
    case 1:
      // Oscillate
      w.droughtTimer = (w.droughtTimer + 3) & 0x7f;
      w.droughtBrightnessStage = ((gSineTable(w.droughtTimer) - 1) >> 6) + 2;
      if (w.droughtBrightnessStage !== w.droughtLastBrightnessStage) SetDroughtGamma(w.droughtBrightnessStage);
      w.droughtLastBrightnessStage = w.droughtBrightnessStage;
      break;
    case 2:
      // Ramp down
      if (++w.droughtTimer > sDroughtFrameDelay) {
        w.droughtTimer = 0;
        SetDroughtGamma(--w.droughtBrightnessStage);
        if (w.droughtBrightnessStage === 3) w.droughtState = 0;
      }
      break;
  }
}

/** One 5-bit channel blended toward `target`: c + ((target - c) * coeff >> 4), the C's int arithmetic (an arithmetic shift). */
export function droughtBlendChannel(c: number, target: number, coeff: number): number {
  return c + (((target - c) * coeff) >> 4);
}

/**
 * ApplyDroughtGammaShiftWithBlend(gammaIndex, blendCoeff, blendColor): every palette's colours as loaded
 * (gPlttBufferUnfaded) blended toward blendColor by blendCoeff / 16; the GAMMA_NONE ones through BlendPalette, the
 * rest through the same arithmetic (FRLG dropped the drought tables gammaIndex chose). The port's palettes: the map's
 * BG palettes 0-12 and the sprite sheets' GAMMA_NORMAL / GAMMA_ALT tables.
 */
export function ApplyDroughtGammaShiftWithBlend(_gammaIndex: number, blendCoeff: number, blendColor: number): void {
  const host = weatherHost();
  if (!host) return;
  const target = [blendColor & 0x1f, (blendColor >> 5) & 0x1f, (blendColor >> 10) & 0x1f];
  for (let pal = 0; pal < 16; pal++) {
    const unfaded = host.bgPaletteUnfaded(pal);
    if (!unfaded) continue;
    // (GAMMA_NONE: BlendPalette; the rest: the loop. The same blend)
    host.setBgPaletteFaded(pal, unfaded.map((v, i) => expand5(droughtBlendChannel(v >> 3, target[i % 3], blendCoeff))));
  }
  const tables = target.map((t) => Uint8Array.from({ length: 32 }, (_, c) => droughtBlendChannel(c, t, blendCoeff))) as unknown as ChannelTables;
  host.setObjPaletteGamma(tables, tables);
}

/**
 * FadeInScreen_Drought: 16 frames from the fade colour. Each step's ApplyDroughtGammaShiftWithBlend(-6,
 * 16 - fadeScreenCounter, fadeDestColor) is the screen fade overlay's blend here (`WeatherFadeInBlend`), over the
 * colours as loaded; the last step's ApplyGammaShift(0, 32, -6) does nothing in FRLG, so the palettes stay where
 * the step before left them: blended 1/16 toward the fade colour, which the port draws into them as the overlay goes.
 */
export function FadeInScreen_Drought(): boolean {
  const w = gWeatherPtr;
  if (w.fadeScreenCounter === 16) return false;
  if (++w.fadeScreenCounter >= 16) {
    ApplyGammaShift(0, 32, -6); // Dummied out in FRLG
    w.fadeScreenCounter = 16;
    ApplyDroughtGammaShiftWithBlend(-6, 1, w.fadeDestColor); // (the step before's palettes, from the overlay's)
    return false;
  }
  ApplyGammaShift(0, 32, 0); // the colours as loaded under the overlay's blend
  return true;
}

// ------------------------------------------------------------------ StartDroughtWeatherBlend (special)

/**
 * StartDroughtWeatherBlend: the UpdateDroughtBlend task (priority 0x50): BLDCNT_EFFECT_LIGHTEN on BG1-3 and OBJ
 * (WININ all layers in), BLDY up 3 a frame to 16, then down 1 every 10 frames to 0, then off (WININ restored) and
 * ScriptContext_Enable. No FRLG script calls it.
 */
export function StartDroughtWeatherBlend(createTask: (task: { tick(): boolean }) => void, scriptContextEnable: () => void): void {
  let tState = 0;
  let tBlendY = 0;
  let tBlendDelay = 0;
  const lighten = (evy: number | undefined) => weatherHost()?.setBrightnessLighten?.(evy);
  createTask({
    tick() {
      switch (tState) {
        case 0:
          tBlendY = 0;
          tBlendDelay = 0;
          // tWinRange = GetGpuReg(REG_OFFSET_WININ); SetGpuReg(REG_OFFSET_WININ, WIN_RANGE(63, 63))
          lighten(0); // BLDCNT_TGT1_BG1 | BG2 | BG3 | OBJ | BLDCNT_EFFECT_LIGHTEN, BLDY 0
          tState++;
        // fall through
        case 1:
          tBlendY += 3;
          if (tBlendY > 16) tBlendY = 16;
          lighten(tBlendY);
          if (tBlendY >= 16) tState++;
          break;
        case 2:
          tBlendDelay++;
          if (tBlendDelay > 9) {
            tBlendDelay = 0;
            tBlendY--;
            if (tBlendY <= 0) {
              tBlendY = 0;
              tState++;
            }
            lighten(tBlendY);
          }
          break;
        case 3:
          lighten(undefined); // BLDCNT 0, BLDY 0, WININ back
          tState++;
          break;
        case 4:
          scriptContextEnable();
          return true; // DestroyTask
      }
      return false;
    },
  });
}

/** Dev / unit tests: sDroughtFrameDelay. */
export function droughtFrameDelay(): number {
  return sDroughtFrameDelay;
}
