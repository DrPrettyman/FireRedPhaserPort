// menu2.c: StartBlendTask / IsBlendTaskActive, the task that steps BLDALPHA's EVA and EVB from one pair of
// coefficients to another (the intro's Game Freak scene fades its name and logo in and out with it).

import { REG_OFFSET_BLDALPHA, SetGpuReg } from './hw';
import { CreateTask, DestroyTask, FuncIsActiveTask, gTasks, type TaskFunc } from './task';

const tEvA = 0;
const tEvB = 1;
const tEvAEnd = 2;
const tEvBEnd = 3;
const tEvADelta = 4;
const tEvBDelta = 5;
const tEvWhich = 6;
const tEvStepCount = 8;

/** StartBlendTask: `ev_step` steps, each two frames (EVA moves on one, EVB on the next). */
export function StartBlendTask(evaStart: number, evbStart: number, evaEnd: number, evbEnd: number, evStep: number, priority: number): void {
  const taskId = CreateTask(Task_SmoothBlendLayers, priority);
  const data = gTasks[taskId].data;
  data[tEvA] = evaStart << 8;
  data[tEvB] = evbStart << 8;
  data[tEvAEnd] = evaEnd;
  data[tEvBEnd] = evbEnd;
  data[tEvADelta] = Math.trunc(((evaEnd - evaStart) * 256) / evStep);
  data[tEvBDelta] = Math.trunc(((evbEnd - evbStart) * 256) / evStep);
  data[tEvStepCount] = evStep;
  SetGpuReg(REG_OFFSET_BLDALPHA, (evbStart << 8) | evaStart);
}

/** IsBlendTaskActive */
export function IsBlendTaskActive(): boolean {
  return FuncIsActiveTask(Task_SmoothBlendLayers);
}

const Task_SmoothBlendLayers: TaskFunc = (taskId) => {
  const data = gTasks[taskId].data;
  if (data[tEvStepCount] !== 0) {
    if (data[tEvWhich] === 0) {
      data[tEvA] += data[tEvADelta];
      data[tEvWhich] = 1;
    } else {
      if (--data[tEvStepCount] !== 0) {
        data[tEvB] += data[tEvBDelta];
      } else {
        data[tEvA] = data[tEvAEnd] << 8;
        data[tEvB] = data[tEvBEnd] << 8;
      }
      data[tEvWhich] = 0;
    }
    SetGpuReg(REG_OFFSET_BLDALPHA, (data[tEvB] & ~0xff) | ((data[tEvA] & 0xffff) >> 8));
    if (data[tEvStepCount] === 0) DestroyTask(taskId);
  }
};
