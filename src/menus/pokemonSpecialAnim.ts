// pokemon_special_anim.c: the animation the party menu runs when an item is used on a mon (party_menu.c's
// CB2_DoUseItemAnim and CB2_ReturnToPartyMenuWhileLearningMove), from the field and in battle. It takes over the main
// callback (CB2_PSA) on whichever GBA host runs the party menu, plays the scene (pokemonSpecialAnimScene.ts) and then
// sets the callback it was given:
// - StartUseItemAnim_Normal: Rare Candy, the vitamins, PP items, healing items, an evolution stone the mon evolves
//   with (Task_UseItem_Normal), a TM / HM the mon has room for (Task_UseTM_NoForget → Task_MachineSet);
// - StartUseItemAnim_CantEvolve: a stone whose evolution is past the Kanto dex without the National Dex ("Huh?");
// - StartUseItemAnim_ForgetMoveAndLearnTMorHM: a TM / HM over a forgotten move ("1, 2, and... Poof!", then Task_MachineSet).
// A or B held before the message (B only for the stone and the TM) cancels it: Task_CleanUp, with PSA_IsCancelDisabled()
// FALSE, and the party menu then does what the anim would have shown (its own message and the item's effect).

import { testEvent } from '../dev/testHooks';
import { charmap } from '../battle/env';
import { moveName } from '../battle/message';
import { K } from '../battle/constants';
import { PALETTES_ALL, RGB_BLACK } from '../gba/hw';
import { B_BUTTON, A_BUTTON, gMain, JOY_HELD, JOY_NEW, SetMainCallback2, SetVBlankCallback, type MainCallback } from '../gba/main';
import { BeginNormalPaletteFade, BlendPalettes, gPaletteFade, TransferPlttBuffer, UpdatePaletteFade } from '../gba/palette';
import { IsCryFinished, IsFanfareTaskInactive, PlayCry_Normal, PlayFanfare, PlaySE } from '../gba/sound';
import { AnimateSprites, BuildOamBuffer, FreeAllSpritePalettes, ProcessSpriteCopyRequests, ResetSpriteData } from '../gba/sprite';
import { CreateTask, DestroyTask, gTasks, ResetTasks, RunTasks, type TaskFunc } from '../gba/task';
import { RunTextPrinters } from '../gba/window';
import type { Pokemon } from '../pokemon/Pokemon';
import { GetMonNickname, partyMon } from './common';
import { CheckIfItemIsTMHMOrEvolutionStone } from './itemUse';
import { ItemIdToBattleMoveId } from './partyMenu';
import {
  CreateItemIconSpriteAtMaxCloseness,
  InitPokemonSpecialAnimScene,
  newPokemonSpecialAnimScene,
  PokemonSpecialAnimSceneInitIsNotFinished,
  PSA_AfterPoof_ClearMessageWindow,
  PSA_CreateMonSpriteAtCloseness,
  PSA_DarkenMonSprite,
  PSA_FreeWindowBuffers,
  PSA_HideMessageWindow,
  PSA_IsItemUseOnMonAnimActive,
  PSA_IsMessagePrintTaskActive,
  PSA_IsZoomTaskActive,
  PSA_LevelUpVerticalSpritesTaskIsRunning,
  PSA_PrintMessage,
  PSA_RunPoofAnim,
  PSA_SetUpItemUseOnMonAnim,
  PSA_SetUpZoomAnim,
  PSA_ShowMessageWindow,
  PSA_TEXT_FORGET_1,
  PSA_TEXT_FORGET_2_AND,
  PSA_TEXT_FORGET_AND,
  PSA_TEXT_FORGET_FORGOT,
  PSA_TEXT_FORGET_POOF,
  PSA_TEXT_HUH,
  PSA_TEXT_ITEM_USED,
  PSA_TEXT_LEARNED_MOVE,
  PSA_TEXT_MACHINE_SET,
  PSA_UseItem_CleanUpForCancel,
  PSA_UseTM_CleanUpForCancel,
  PSA_UseTM_RunMachineSetWobble,
  PSA_UseTM_RunZoomOutAnim,
  PSA_UseTM_SetUpMachineSetWobble,
  PSA_UseTM_SetUpZoomOutAnim,
  type PokemonSpecialAnimScene,
} from './pokemonSpecialAnimScene';

// constants/pokemon_special_anim.h's PSA_ITEM_ANIM_TYPE_*
export const PSA_ITEM_ANIM_TYPE_DEFAULT = 0;
export const PSA_ITEM_ANIM_TYPE_POTION = 1;
export const PSA_ITEM_ANIM_TYPE_UNUSED1 = 2;
export const PSA_ITEM_ANIM_TYPE_UNUSED2 = 3;
export const PSA_ITEM_ANIM_TYPE_TMHM = 4;

/** struct PokemonSpecialAnim */
interface PokemonSpecialAnim {
  savedCallback: MainCallback;
  /** a copy of the party mon, as it was when the anim started */
  pokemon: Pokemon;
  nickname: number[];
  nameOfMoveForgotten: number[];
  nameOfMoveToTeach: number[];
  cancelDisabled: boolean;
  state: number;
  species: number;
  itemId: number;
  animType: number;
  slotId: number;
  closeness: number;
  delayTimer: number;
  personality: number;
  /** field_00a4: Task_CleanUp waits for the cry when it's 1 (nothing sets it) */
  field_00a4: number;
  sceneResources: PokemonSpecialAnimScene;
}

let sCancelDisabled = false;
let sPSAWork: PokemonSpecialAnim | null = null;

/** StartUseItemAnim_Normal */
export function StartUseItemAnim_Normal(slotId: number, itemId: number, callback: MainCallback): void {
  SetUpUseItemAnim_Normal(AllocPSA(slotId, itemId, callback));
}

/** StartUseItemAnim_ForgetMoveAndLearnTMorHM: `moveId` is the move being forgotten. */
export function StartUseItemAnim_ForgetMoveAndLearnTMorHM(slotId: number, itemId: number, moveId: number, callback: MainCallback): void {
  const ptr = AllocPSA(slotId, itemId, callback);
  ptr.nameOfMoveForgotten = moveName(moveId);
  SetUpUseItemAnim_ForgetMoveAndLearnTMorHM(ptr);
}

/** StartUseItemAnim_CantEvolve */
export function StartUseItemAnim_CantEvolve(slotId: number, itemId: number, callback: MainCallback): void {
  SetUpUseItemAnim_CantEvolve(AllocPSA(slotId, itemId, callback));
}

/** AllocPSA (the Alloc can't fail here) */
function AllocPSA(slotId: number, itemId: number, callback: MainCallback): PokemonSpecialAnim {
  if (!gMain.inBattle) ResetTasks();
  ResetSpriteData();
  FreeAllSpritePalettes();
  const pokemon = partyMon(slotId)!;
  const animType = GetAnimTypeByItemId(itemId);
  const ptr: PokemonSpecialAnim = {
    state: 0,
    savedCallback: callback,
    species: pokemon.species,
    closeness: GetClosenessFromFriendship(pokemon.friendship),
    personality: pokemon.personality,
    slotId,
    itemId,
    animType,
    pokemon: { ...pokemon, nickname: [...pokemon.nickname], moves: [...pokemon.moves], pp: [...pokemon.pp] },
    field_00a4: 0,
    nickname: GetMonNickname(pokemon),
    nameOfMoveForgotten: [],
    nameOfMoveToTeach: animType === PSA_ITEM_ANIM_TYPE_TMHM ? moveName(ItemIdToBattleMoveId(itemId)) : [],
    cancelDisabled: false,
    delayTimer: 0,
    sceneResources: newPokemonSpecialAnimScene(),
  };
  return ptr;
}

function VBlankCB_PSA(): void {
  TransferPlttBuffer();
  // LoadOam: the PPU reads the OAM buffer directly
  ProcessSpriteCopyRequests();
}

function CB2_PSA(): void {
  RunTextPrinters();
  RunTasks();
  AnimateSprites();
  BuildOamBuffer();
  UpdatePaletteFade();
}

function SetUseItemAnimCallback(taskId: number, func: TaskFunc): void {
  sPSAWork!.state = 0;
  gTasks[taskId].func = func;
}

/** Start the anim's task: the PSA struct is the module's sPSAWork (the C keeps it in the task's data[0..1]). */
function startTask(ptr: PokemonSpecialAnim, func: TaskFunc): void {
  CreateTask(func, 0);
  sPSAWork = ptr;
  SetMainCallback2(CB2_PSA);
  testEvent('itemUseAnim', { phase: 'start', task: func.name, itemId: ptr.itemId, animType: ptr.animType, closeness: ptr.closeness });
}

function SetUpUseItemAnim_Normal(ptr: PokemonSpecialAnim): void {
  let func: TaskFunc;
  switch (ptr.animType) {
    case PSA_ITEM_ANIM_TYPE_DEFAULT:
    case PSA_ITEM_ANIM_TYPE_POTION:
    case PSA_ITEM_ANIM_TYPE_UNUSED2:
      func = Task_UseItem_Normal;
      break;
    case PSA_ITEM_ANIM_TYPE_TMHM:
      func = Task_UseTM_NoForget;
      break;
    default:
      SetMainCallback2(ptr.savedCallback);
      return;
  }
  ptr.cancelDisabled = false;
  startTask(ptr, func);
}

function SetUpUseItemAnim_ForgetMoveAndLearnTMorHM(ptr: PokemonSpecialAnim): void {
  startTask(ptr, Task_ForgetMove);
  ptr.cancelDisabled = false;
}

function SetUpUseItemAnim_CantEvolve(ptr: PokemonSpecialAnim): void {
  startTask(ptr, Task_EvoStone_CantEvolve);
}

/** The anim's last step: back to the callback it was given. */
function finish(taskId: number, ptr: PokemonSpecialAnim): void {
  SetMainCallback2(ptr.savedCallback);
  PSA_FreeWindowBuffers();
  DestroyTask(taskId);
  testEvent('itemUseAnim', { phase: 'end', itemId: ptr.itemId, cancelDisabled: ptr.cancelDisabled });
}

function Task_UseItem_Normal(taskId: number): void {
  const ptr = sPSAWork!;
  if (!ptr.cancelDisabled && JOY_HELD(A_BUTTON | B_BUTTON)) {
    PSA_UseItem_CleanUpForCancel();
    SetUseItemAnimCallback(taskId, Task_CleanUp);
    return;
  }

  switch (ptr.state) {
    case 0:
      SetVBlankCallback(null);
      InitPokemonSpecialAnimScene(ptr.sceneResources, ptr.animType);
      PSA_CreateMonSpriteAtCloseness(0);
      ptr.state++;
      break;
    case 1:
      if (!PokemonSpecialAnimSceneInitIsNotFinished()) {
        BeginNormalPaletteFade(PALETTES_ALL, -1, 16, 0, RGB_BLACK);
        ptr.state++;
        SetVBlankCallback(VBlankCB_PSA);
      }
      break;
    case 2:
      if (!gPaletteFade.active) ptr.state++;
      break;
    case 3:
      PSA_SetUpZoomAnim(ptr.closeness);
      ptr.state++;
      break;
    case 4:
      if (!PSA_IsZoomTaskActive()) {
        ptr.delayTimer = 0;
        ptr.state++;
      }
      break;
    case 5:
      if (!PSA_LevelUpVerticalSpritesTaskIsRunning()) ptr.state++;
      break;
    case 6:
      PSA_SetUpItemUseOnMonAnim(ptr.itemId, ptr.closeness, true);
      ptr.state++;
      break;
    case 7:
      if (!PSA_IsItemUseOnMonAnimActive()) {
        ptr.cancelDisabled = true;
        if (ptr.closeness === 3) PlayCry_Normal(ptr.species, 0);
        PSA_ShowMessageWindow();
        ptr.state++;
      }
      break;
    case 8:
      PSA_PrintMessage(PSA_TEXT_ITEM_USED);
      ptr.state++;
      break;
    case 9:
      if (!PSA_IsMessagePrintTaskActive()) ptr.state++;
      break;
    case 10:
      PSA_SetUpZoomAnim(0);
      ptr.state++;
      break;
    case 11:
      if (!PSA_IsZoomTaskActive()) {
        ptr.cancelDisabled = true;
        ptr.state++;
      }
      break;
    case 12:
      if (JOY_NEW(A_BUTTON | B_BUTTON)) {
        if (CheckIfItemIsTMHMOrEvolutionStone(ptr.itemId) !== 2) {
          // not an evolution stone: the stone's evolution scene starts from this screen
          BeginNormalPaletteFade(PALETTES_ALL, -1, 0, 16, RGB_BLACK);
          ptr.state++;
        } else {
          ptr.state += 2;
        }
      }
      break;
    case 13:
      if (!gPaletteFade.active) ptr.state++;
      break;
    case 14:
      finish(taskId, ptr);
      break;
  }
}

function Task_ForgetMove(taskId: number): void {
  const ptr = sPSAWork!;
  switch (ptr.state) {
    case 0:
      SetVBlankCallback(null);
      InitPokemonSpecialAnimScene(ptr.sceneResources, ptr.animType);
      PSA_CreateMonSpriteAtCloseness(3);
      ptr.state++;
      break;
    case 1:
      if (!PokemonSpecialAnimSceneInitIsNotFinished()) {
        BeginNormalPaletteFade(PALETTES_ALL, -1, 16, 0, RGB_BLACK);
        ptr.state++;
        SetVBlankCallback(VBlankCB_PSA);
      }
      break;
    case 2:
      if (!gPaletteFade.active) {
        ptr.delayTimer = 0;
        ptr.state++;
      }
      break;
    case 3:
      ptr.delayTimer++;
      if (ptr.delayTimer > 30) {
        PSA_ShowMessageWindow();
        ptr.state++;
      }
      break;
    case 4:
      PSA_PrintMessage(PSA_TEXT_FORGET_1);
      ptr.state++;
      break;
    case 5:
      if (!PSA_IsMessagePrintTaskActive()) {
        ptr.delayTimer = 0;
        ptr.state++;
      }
      break;
    case 6:
      ptr.delayTimer++;
      if (ptr.delayTimer > 30) {
        PSA_PrintMessage(PSA_TEXT_FORGET_2_AND);
        ptr.state++;
      }
      break;
    case 7:
      if (!PSA_IsMessagePrintTaskActive()) {
        ptr.delayTimer = 0;
        ptr.state++;
      }
      break;
    case 8:
      ptr.delayTimer++;
      if (ptr.delayTimer > 30) {
        PlaySE(K.SE_M_SPIT_UP);
        PSA_PrintMessage(PSA_TEXT_FORGET_POOF);
        PSA_DarkenMonSprite();
        ptr.state++;
      }
      break;
    case 9: {
      const r4 = PSA_RunPoofAnim();
      if (!(r4 || PSA_IsMessagePrintTaskActive())) {
        PSA_AfterPoof_ClearMessageWindow();
        ptr.state++;
      }
      break;
    }
    case 10:
      PSA_PrintMessage(PSA_TEXT_FORGET_FORGOT);
      ptr.state++;
      break;
    case 11:
      if (!PSA_IsMessagePrintTaskActive()) {
        PSA_PrintMessage(PSA_TEXT_FORGET_AND);
        ptr.state++;
      }
      break;
    case 12:
      if (!PSA_IsMessagePrintTaskActive()) {
        PSA_HideMessageWindow();
        ptr.state++;
      }
      break;
    case 13:
      SetUseItemAnimCallback(taskId, Task_MachineSet);
      break;
  }
}

function Task_EvoStone_CantEvolve(taskId: number): void {
  const ptr = sPSAWork!;
  if (!ptr.cancelDisabled && JOY_HELD(B_BUTTON)) {
    SetUseItemAnimCallback(taskId, Task_CleanUp);
    return;
  }

  switch (ptr.state) {
    case 0:
      SetVBlankCallback(null);
      InitPokemonSpecialAnimScene(ptr.sceneResources, ptr.animType);
      PSA_CreateMonSpriteAtCloseness(0);
      ptr.state++;
      break;
    case 1:
      if (!PokemonSpecialAnimSceneInitIsNotFinished()) {
        BeginNormalPaletteFade(PALETTES_ALL, -1, 16, 0, RGB_BLACK);
        ptr.state++;
        SetVBlankCallback(VBlankCB_PSA);
      }
      break;
    case 2:
      if (!gPaletteFade.active) ptr.state++;
      break;
    case 3:
      PSA_SetUpZoomAnim(ptr.closeness);
      ptr.state++;
      break;
    case 4:
      PSA_SetUpItemUseOnMonAnim(ptr.itemId, ptr.closeness, false);
      ptr.state++;
      break;
    case 5:
      if (!PSA_IsItemUseOnMonAnimActive()) {
        PSA_ShowMessageWindow();
        ptr.state++;
      }
      break;
    case 6:
      PSA_PrintMessage(PSA_TEXT_HUH);
      ptr.state++;
      break;
    case 7:
      if (!PSA_IsMessagePrintTaskActive()) {
        ptr.cancelDisabled = true;
        ptr.state++;
      }
      break;
    case 8:
      if (JOY_NEW(A_BUTTON | B_BUTTON)) {
        BeginNormalPaletteFade(PALETTES_ALL, -1, 0, 16, RGB_BLACK);
        ptr.state++;
      }
      break;
    case 9:
      if (!gPaletteFade.active) finish(taskId, ptr);
      break;
  }
}

function Task_UseTM_NoForget(taskId: number): void {
  const ptr = sPSAWork!;
  if (JOY_NEW(B_BUTTON)) {
    SetUseItemAnimCallback(taskId, Task_CleanUp);
    return;
  }

  switch (ptr.state) {
    case 0:
      SetVBlankCallback(null);
      InitPokemonSpecialAnimScene(ptr.sceneResources, ptr.animType);
      PSA_CreateMonSpriteAtCloseness(3);
      ptr.state++;
      break;
    case 1:
      if (!PokemonSpecialAnimSceneInitIsNotFinished()) {
        BeginNormalPaletteFade(PALETTES_ALL, -1, 16, 0, RGB_BLACK);
        ptr.state++;
        SetVBlankCallback(VBlankCB_PSA);
      }
      break;
    case 2:
      if (!gPaletteFade.active) {
        ptr.delayTimer = 0;
        ptr.state++;
      }
      break;
    case 3:
      ptr.delayTimer++;
      if (ptr.delayTimer > 20) SetUseItemAnimCallback(taskId, Task_MachineSet);
      break;
  }
}

function Task_MachineSet(taskId: number): void {
  const ptr = sPSAWork!;
  if (!ptr.cancelDisabled && JOY_NEW(B_BUTTON)) {
    PSA_UseTM_CleanUpForCancel();
    SetUseItemAnimCallback(taskId, Task_CleanUp);
    return;
  }

  switch (ptr.state) {
    case 0:
      CreateItemIconSpriteAtMaxCloseness(ptr.itemId);
      ptr.delayTimer = 0;
      ptr.state++;
      break;
    case 1:
      PSA_ShowMessageWindow();
      PSA_PrintMessage(PSA_TEXT_MACHINE_SET);
      ptr.state++;
      break;
    case 2:
      if (!PSA_IsMessagePrintTaskActive()) {
        PSA_HideMessageWindow();
        ptr.state++;
      }
      break;
    case 3:
      PSA_UseTM_SetUpMachineSetWobble();
      ptr.state++;
      break;
    case 4:
      if (!PSA_UseTM_RunMachineSetWobble()) ptr.state++;
      break;
    case 5:
      PSA_UseTM_SetUpZoomOutAnim();
      ptr.state++;
      break;
    case 6:
      if (!PSA_UseTM_RunZoomOutAnim()) {
        ptr.delayTimer = 0;
        ptr.state++;
      }
      break;
    case 7:
      ptr.delayTimer++;
      if (ptr.delayTimer > 30) {
        PSA_ShowMessageWindow();
        PSA_PrintMessage(PSA_TEXT_LEARNED_MOVE);
        ptr.state++;
      }
      break;
    case 8:
      if (!PSA_IsMessagePrintTaskActive()) {
        PlayFanfare(K.MUS_LEVEL_UP);
        ptr.cancelDisabled = true;
        ptr.state++;
      }
      break;
    case 9:
      if (IsFanfareTaskInactive()) SetUseItemAnimCallback(taskId, Task_CleanUp);
      break;
  }
}

function Task_CleanUp(taskId: number): void {
  const ptr = sPSAWork!;
  switch (ptr.state) {
    case 0:
      SetVBlankCallback(VBlankCB_PSA);
      BlendPalettes(PALETTES_ALL, 16, RGB_BLACK);
      ptr.state++;
      break;
    case 1:
      if (!gPaletteFade.active && (ptr.field_00a4 !== 1 || IsCryFinished())) {
        sCancelDisabled = ptr.cancelDisabled;
        finish(taskId, ptr);
      }
      break;
  }
}

/** sItemAnimMap */
const sItemAnimMap = (): [number, number][] => [
  [K.ITEM_RARE_CANDY, PSA_ITEM_ANIM_TYPE_DEFAULT],
  [K.ITEM_POTION, PSA_ITEM_ANIM_TYPE_POTION],
];

function GetAnimTypeByItemId(itemId: number): number {
  for (const [item, animType] of sItemAnimMap()) if (item === itemId) return animType;
  if (itemId >= K.ITEM_TM01 && itemId <= K.ITEM_HM08) return PSA_ITEM_ANIM_TYPE_TMHM;
  return PSA_ITEM_ANIM_TYPE_DEFAULT;
}

function GetClosenessFromFriendship(friendship: number): number {
  if (friendship <= 100) return 0;
  if (friendship <= 150) return 1;
  if (friendship <= 200) return 2;
  return 3;
}

const psa = (): PokemonSpecialAnim => sPSAWork!;

/** PSA_GetPokemon: the copy of the mon */
export function PSA_GetPokemon(): Pokemon {
  return psa().pokemon;
}

/** PSA_GetSceneWork */
export function PSA_GetSceneWork(): PokemonSpecialAnimScene {
  return psa().sceneResources;
}

export function PSA_GetItemId(): number {
  return psa().itemId;
}

export function PSA_GetNameOfMoveForgotten(): number[] {
  return psa().nameOfMoveForgotten;
}

export function PSA_GetNameOfMoveToTeach(): number[] {
  return psa().nameOfMoveToTeach;
}

export function PSA_GetMonNickname(): number[] {
  return psa().nickname;
}

export function PSA_GetAnimType(): number {
  return psa().animType;
}

export function PSA_GetMonSpecies(): number {
  return psa().species;
}

export function PSA_GetMonPersonality(): number {
  return psa().personality;
}

/**
 * PSA_IsCancelDisabled: whether the last anim got past its point of no return (the message for a normal item use, the
 * fanfare for a TM / HM) before Task_CleanUp, i.e. it wasn't cancelled. Only Task_CleanUp sets it, as in the C, so a
 * normal item use that ends at its last state keeps the previous value (party_menu.c reads it only after a TM / HM).
 */
export function PSA_IsCancelDisabled(): boolean {
  return sCancelDisabled;
}

/** For `__test.itemUseAnim()`: the running anim's task, state and sprites, or null. */
export function itemUseAnimProbe(): Record<string, unknown> | null {
  const ptr = sPSAWork;
  if (!ptr || gMain.callback2 !== CB2_PSA) return null;
  const task = gTasks.find((t) => t.isActive && [Task_UseItem_Normal, Task_ForgetMove, Task_EvoStone_CantEvolve, Task_UseTM_NoForget, Task_MachineSet, Task_CleanUp].includes(t.func as never));
  const scene = ptr.sceneResources;
  const sprite = (s: typeof scene.monSprite) => (s && s.inUse ? { x: s.x, y: s.y, x2: s.x2, y2: s.y2, invisible: s.invisible, matrixNum: s.oam.matrixNum } : null);
  return {
    task: task?.func.name,
    state: ptr.state,
    animType: ptr.animType,
    itemId: ptr.itemId,
    closeness: ptr.closeness,
    lastCloseness: scene.lastCloseness,
    cancelDisabled: ptr.cancelDisabled,
    zooming: PSA_IsZoomTaskActive(),
    itemAnim: PSA_IsItemUseOnMonAnimActive(),
    printing: PSA_IsMessagePrintTaskActive(),
    message: charmap.decodePlain(scene.textBuf.includes(0xff) ? scene.textBuf.slice(0, scene.textBuf.indexOf(0xff)) : scene.textBuf),
    monSprite: sprite(scene.monSprite),
    itemSprite: sprite(scene.itemIconSprite),
    fadeActive: gPaletteFade.active,
  };
}
