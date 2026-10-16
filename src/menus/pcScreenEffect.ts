// pc_screen_effect.c: the screen opens and closes like a CRT monitor (WIN0 grows from a line in the middle
// while everything outside it is hidden), used when the Pokémon Storage System is entered and left.

import {
  BLDCNT_EFFECT_LIGHTEN,
  BLDCNT_TGT1_BD,
  BLDCNT_TGT1_BG0,
  BLDCNT_TGT1_BG1,
  BLDCNT_TGT1_BG2,
  BLDCNT_TGT1_BG3,
  BLDCNT_TGT1_OBJ,
  ClearGpuRegBits,
  DISPCNT_WIN0_ON,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  GetGpuReg,
  REG_OFFSET_BLDCNT,
  REG_OFFSET_BLDY,
  REG_OFFSET_DISPCNT,
  REG_OFFSET_WIN0H,
  REG_OFFSET_WIN0V,
  REG_OFFSET_WININ,
  REG_OFFSET_WINOUT,
  RGB_BLACK,
  SetGpuReg,
  SetGpuRegBits,
  WIN_RANGE,
  WININ_WIN0_BG_ALL,
  WININ_WIN0_CLR,
  WININ_WIN0_OBJ,
} from '../gba/hw';
import { BG_PLTT_ID, BlendPalettes, gPlttBufferFaded } from '../gba/palette';
import { CreateTask, DestroyTask, FuncIsActiveTask, gTasks, type TaskFunc } from '../gba/task';

const PALETTES_ALL = 0xffffffff;

const tState = 0;
const tXSpeed = 1;
const tYSpeed = 2;
const tWin0Left = 3;
const tWin0Right = 4;
const tWin0Top = 5;
const tWin0Bottom = 6;
const tBldCntBak = 7;
const tBldYBak = 8;

const BLDCNT_LIGHTEN_ALL = BLDCNT_TGT1_BG0 | BLDCNT_TGT1_BG1 | BLDCNT_TGT1_BG2 | BLDCNT_TGT1_BG3 | BLDCNT_TGT1_OBJ | BLDCNT_TGT1_BD | BLDCNT_EFFECT_LIGHTEN;

export function BeginPCScreenEffect_TurnOn(xspeed: number, yspeed: number, priority: number): void {
  BeginPCScreenEffect(Task_PCScreenEffect_TurnOn, xspeed, yspeed, priority);
}

export function BeginPCScreenEffect_TurnOff(xspeed: number, yspeed: number, priority: number): void {
  BeginPCScreenEffect(Task_PCScreenEffect_TurnOff, xspeed, yspeed, priority);
}

export function IsPCScreenEffectRunning_TurnOn(): boolean {
  return FuncIsActiveTask(Task_PCScreenEffect_TurnOn);
}

export function IsPCScreenEffectRunning_TurnOff(): boolean {
  return FuncIsActiveTask(Task_PCScreenEffect_TurnOff);
}

function BeginPCScreenEffect(func: TaskFunc, speed: number, _unused: number, priority: number): void {
  const taskId = CreateTask(func, priority);
  const data = gTasks[taskId].data;
  data[tState] = 0;
  data[tXSpeed] = speed === 0 ? 16 : speed;
  data[tYSpeed] = speed === 0 ? 20 : speed; // Bug? should be the unused param, not speed
  gTasks[taskId].func(taskId);
}

function Task_PCScreenEffect_TurnOn(taskId: number): void {
  const data = gTasks[taskId].data;
  switch (data[tState]) {
    case 0:
      data[tWin0Left] = 120;
      data[tWin0Right] = 120;
      data[tWin0Top] = 80;
      data[tWin0Bottom] = 81;
      SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
      SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(data[tWin0Left], data[tWin0Right]));
      SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(data[tWin0Top], data[tWin0Bottom]));
      SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR);
      SetGpuReg(REG_OFFSET_WINOUT, 0);
      break;
    case 1:
      data[tBldCntBak] = GetGpuReg(REG_OFFSET_BLDCNT);
      data[tBldYBak] = GetGpuReg(REG_OFFSET_BLDY);
      SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_LIGHTEN_ALL);
      SetGpuReg(REG_OFFSET_BLDY, 16);
      break;
    case 2:
      data[tWin0Left] -= data[tXSpeed];
      data[tWin0Right] += data[tXSpeed];
      if (data[tWin0Left] <= 0 || data[tWin0Right] >= DISPLAY_WIDTH) {
        data[tWin0Left] = 0;
        data[tWin0Right] = DISPLAY_WIDTH;
        SetGpuReg(REG_OFFSET_BLDY, 0);
        SetGpuReg(REG_OFFSET_BLDCNT, data[tBldCntBak]);
        BlendPalettes(PALETTES_ALL, 0, RGB_BLACK);
        gPlttBufferFaded[BG_PLTT_ID(0)] = 0;
      }
      SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(data[tWin0Left], data[tWin0Right]));
      if (data[tWin0Left]) return;
      break;
    case 3:
      data[tWin0Top] -= data[tYSpeed];
      data[tWin0Bottom] += data[tYSpeed];
      if (data[tWin0Top] <= 0 || data[tWin0Bottom] >= DISPLAY_HEIGHT) {
        data[tWin0Top] = 0;
        data[tWin0Bottom] = DISPLAY_HEIGHT;
        ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
      }
      SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(data[tWin0Top], data[tWin0Bottom]));
      if (data[tWin0Top]) return;
      break;
    default:
      SetGpuReg(REG_OFFSET_BLDCNT, data[tBldCntBak]);
      DestroyTask(taskId);
      return;
  }
  ++data[tState];
}

function Task_PCScreenEffect_TurnOff(taskId: number): void {
  const data = gTasks[taskId].data;
  switch (data[tState]) {
    case 0:
      gPlttBufferFaded[BG_PLTT_ID(0)] = 0;
      break;
    case 1:
      data[tWin0Left] = 0;
      data[tWin0Right] = DISPLAY_WIDTH;
      data[tWin0Top] = 0;
      data[tWin0Bottom] = DISPLAY_HEIGHT;
      SetGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
      SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(data[tWin0Left], data[tWin0Right]));
      SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(data[tWin0Top], data[tWin0Bottom]));
      SetGpuReg(REG_OFFSET_WININ, WININ_WIN0_BG_ALL | WININ_WIN0_OBJ | WININ_WIN0_CLR);
      SetGpuReg(REG_OFFSET_WINOUT, 0);
      break;
    case 2:
      data[tWin0Top] += data[tYSpeed];
      data[tWin0Bottom] -= data[tYSpeed];
      if (data[tWin0Top] >= 80 || data[tWin0Bottom] <= 81) {
        data[tWin0Top] = 80;
        data[tWin0Bottom] = 81;
        SetGpuReg(REG_OFFSET_BLDCNT, BLDCNT_LIGHTEN_ALL);
        SetGpuReg(REG_OFFSET_BLDY, 16);
      }
      SetGpuReg(REG_OFFSET_WIN0V, WIN_RANGE(data[tWin0Top], data[tWin0Bottom]));
      if (data[tWin0Top] !== 80) return;
      break;
    case 3:
      data[tWin0Left] += data[tXSpeed];
      data[tWin0Right] -= data[tXSpeed];
      if (data[tWin0Left] >= 120 || data[tWin0Right] <= 120) {
        data[tWin0Left] = 120;
        data[tWin0Right] = 120;
        BlendPalettes(PALETTES_ALL, 0x10, RGB_BLACK);
        gPlttBufferFaded[BG_PLTT_ID(0)] = 0;
      }
      SetGpuReg(REG_OFFSET_WIN0H, WIN_RANGE(data[tWin0Left], data[tWin0Right]));
      if (data[tWin0Left] !== 120) return;
      break;
    default:
      ClearGpuRegBits(REG_OFFSET_DISPCNT, DISPCNT_WIN0_ON);
      SetGpuReg(REG_OFFSET_BLDY, 0);
      SetGpuReg(REG_OFFSET_BLDCNT, 0);
      DestroyTask(taskId);
      return;
  }
  ++data[tState];
}
