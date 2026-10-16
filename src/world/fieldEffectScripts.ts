// field_effect.c's field effect script interpreter: FieldEffectStart runs gFieldEffectScriptPointers[fldeff]
// (data/field_effect_scripts.s, extracted to field_effects/scripts.json) through sFldEffScrcmdTable, plus
// gFieldEffectArguments and sFieldEffectActiveList.
//
// The scripts' palette and tile commands (loadtiles, loadfadedpal, loadpal and the *_callnative forms'
// loading half) have nothing to do here: the field's sprites are Phaser textures with their palettes baked
// in, and screens on the GBA layer load their own graphics. `callnative` calls a function registered by
// name with `registerFieldEffectNatives` (FldEff_UseCutOnTree, FldEff_FieldMoveShowMon, ...). A native that
// isn't ported warns once and takes its effect off the active list again, so a script's waitfieldeffect
// doesn't hang (e.g. FLDEFF_POKECENTER_HEAL).
//
// The field's own Phaser-drawn effects (entities/FieldEffects.ts: grass, splashes, emote icons) keep
// their own active list; FieldEffectActiveListContains looks at both.

/** A native: its return value is FieldEffectStart's result. */
export type FieldEffectNative = () => number | boolean | void;

/** [command, ...symbol arguments], as tools/extract.py writes them. */
export type FieldEffectScript = string[][];

/** What the interpreter needs from the field. */
export interface FieldEffectScriptHost {
  /** FieldEffectActiveListContains for the effects entities/FieldEffects.ts runs. */
  isPhaserEffectActive(fldeff: string): boolean;
}

/** gFieldEffectArguments (s32[8]) */
export const gFieldEffectArguments: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

/** sFieldEffectActiveList (FLDEFF_* names) */
const sFieldEffectActiveList: string[] = [];

const natives: Record<string, FieldEffectNative> = {};
let scripts: Record<string, FieldEffectScript> = {};
let host: FieldEffectScriptHost | undefined;
const warned = new Set<string>();

/** gFieldEffectScriptPointers, by FLDEFF_* name (field_effects/scripts.json). */
export function setFieldEffectScripts(table: Record<string, FieldEffectScript>): void {
  scripts = table;
}

export function setFieldEffectScriptHost(h: FieldEffectScriptHost): void {
  host = h;
}

/** Make `callnative <name>` call these functions. */
export function registerFieldEffectNatives(table: Record<string, FieldEffectNative>): void {
  Object.assign(natives, table);
}

/** FieldEffectStart: put `fldeff` on the active list and run its script. */
export function FieldEffectStart(fldeff: string): number {
  FieldEffectActiveListAdd(fldeff);
  const script = scripts[fldeff];
  if (!script) {
    warnOnce(fldeff, `[fldeff] no field effect script for ${fldeff}`);
    FieldEffectActiveListRemove(fldeff);
    return 0;
  }
  let result = 0;
  // sFldEffScrcmdTable: every command but `end` returns TRUE
  for (const [op, ...args] of script) {
    if (op === 'end') break;
    switch (op) {
      case 'loadtiles': // FieldEffectScript_LoadTiles
      case 'loadfadedpal': // FieldEffectScript_LoadFadedPal
      case 'loadpal': // FieldEffectScript_LoadPal
        break;
      case 'callnative':
      case 'loadgfx_callnative':
      case 'loadtiles_callnative':
      case 'loadfadedpal_callnative':
        result = callNative(fldeff, args[args.length - 1]);
        break;
      default:
        warnOnce(op, `[fldeff] unknown field effect script command ${op}`);
    }
  }
  return result;
}

/** FieldEffectScript_CallNative */
function callNative(fldeff: string, name: string): number {
  const fn = natives[name];
  if (!fn) {
    warnOnce(name, `[fldeff] ${name} (${fldeff}) is not implemented`);
    FieldEffectActiveListRemove(fldeff);
    return 0;
  }
  const r = fn();
  return typeof r === 'number' ? r : r ? 1 : 0;
}

/** FieldEffectActiveListClear (warps: the effects' tasks and sprites are gone with the map) */
export function FieldEffectActiveListClear(): void {
  sFieldEffectActiveList.length = 0;
}

function FieldEffectActiveListAdd(fldeff: string): void {
  sFieldEffectActiveList.push(fldeff);
}

/** FieldEffectActiveListRemove: one entry. */
export function FieldEffectActiveListRemove(fldeff: string): void {
  const i = sFieldEffectActiveList.indexOf(fldeff);
  if (i >= 0) sFieldEffectActiveList.splice(i, 1);
}

/** FieldEffectActiveListContains */
export function FieldEffectActiveListContains(fldeff: string): boolean {
  return sFieldEffectActiveList.includes(fldeff) || (host?.isPhaserEffectActive(fldeff) ?? false);
}

/** Dev: the scripted effects on the active list. */
export function activeFieldEffects(): string[] {
  return [...sFieldEffectActiveList];
}

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}
